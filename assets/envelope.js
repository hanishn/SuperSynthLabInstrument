// Super Synth Lab - Envelope Module
// Extracted from audio-engine.js for modularity
// Loads AFTER audio-engine.js and extends SL.audio
(function() {
  'use strict';

  var SL = window.SynthLab;

  if (!SL || !SL.audio) {
    console.error('[envelope] SynthLab.audio not available');
  } else {

  // ============================================================
  // Envelope Pre-computation Cache
  // ============================================================

  /** Maximum number of cached envelope curves (LRU eviction) */
  var ENVELOPE_CACHE_MAX_SIZE = 24;

  /** Cache for pre-computed envelope curves */
  var envelopeCache = new Map();

  /** LRU tracking - stores cache keys in order of last use */
  var envelopeCacheLRU = [];

  /** Envelope cache statistics */
  var envelopeCacheStats = {
    hits: 0,
    misses: 0,
    evictions: 0
  };

  /**
   * Generate a cache key for envelope parameters
   * @param {number} duration - Note duration in seconds
   * @param {{a: number, d: number, s: number, r: number}} adsr - ADSR parameters
   * @param {number} sampleRate - Sample rate
   * @returns {string} Cache key
   */
  function getEnvelopeCacheKey(duration, adsr, sampleRate) {
    // Round duration to nearest 10ms to improve cache hits
    var durRounded = Math.round(duration * 100) / 100;
    return adsr.a + '-' + adsr.d + '-' + adsr.s + '-' + adsr.r + '-' + durRounded + '-' + sampleRate;
  }

  /**
   * Get or compute an envelope curve
   * Pre-computes all envelope values for a note, trading memory for CPU
   * @param {number} duration - Note duration in seconds
   * @param {{a: number, d: number, s: number, r: number}} adsr - ADSR parameters (a, d, r in seconds, s as 0-1)
   * @param {number} sampleRate - Sample rate
   * @returns {Float32Array} Pre-computed envelope multipliers (one per sample)
   */
  function getEnvelopeCurve(duration, adsr, sampleRate) {
    var cacheKey = getEnvelopeCacheKey(duration, adsr, sampleRate);

    // Check cache first
    if (envelopeCache.has(cacheKey)) {
      envelopeCacheStats.hits++;
      // Update LRU order - move to end (most recently used)
      var lruIndex = envelopeCacheLRU.indexOf(cacheKey);
      if (lruIndex > -1) {
        envelopeCacheLRU.splice(lruIndex, 1);
        envelopeCacheLRU.push(cacheKey);
      }
      return envelopeCache.get(cacheKey);
    }

    envelopeCacheStats.misses++;

    // Compute the envelope curve
    var numSamples = Math.floor(sampleRate * duration);
    var curve = new Float32Array(numSamples);

    for (var i = 0; i < numSamples; i++) {
      var t = i / sampleRate;
      curve[i] = calcADSR(t, duration, adsr);
    }

    // Evict oldest entries if cache is full (LRU eviction)
    while (envelopeCache.size >= ENVELOPE_CACHE_MAX_SIZE && envelopeCacheLRU.length > 0) {
      var oldestKey = envelopeCacheLRU.shift();
      envelopeCache.delete(oldestKey);
      envelopeCacheStats.evictions++;
    }

    // Store in cache
    envelopeCache.set(cacheKey, curve);
    envelopeCacheLRU.push(cacheKey);

    return curve;
  }

  /**
   * Clear the envelope cache
   * Call when ADSR settings change dramatically or to free memory
   */
  function clearEnvelopeCache() {
    envelopeCache.clear();
    envelopeCacheLRU = [];
  }

  /**
   * Get envelope cache statistics
   * @returns {Object} Cache stats including hits, misses, evictions, and current size
   */
  function getEnvelopeCacheStats() {
    var hitRate = envelopeCacheStats.hits + envelopeCacheStats.misses > 0
      ? (envelopeCacheStats.hits / (envelopeCacheStats.hits + envelopeCacheStats.misses) * 100).toFixed(1)
      : 0;
    return {
      hits: envelopeCacheStats.hits,
      misses: envelopeCacheStats.misses,
      evictions: envelopeCacheStats.evictions,
      currentSize: envelopeCache.size,
      maxSize: ENVELOPE_CACHE_MAX_SIZE,
      hitRate: hitRate + '%'
    };
  }

  // ============================================================
  // ADSR Envelope Calculation
  // ============================================================

  /**
   * Calculate ADSR envelope value at a given time
   * Used for buffer-based synthesis methods
   * @param {number} t - Current time in seconds
   * @param {number} dur - Total note duration in seconds
   * @param {{a: number, d: number, s: number, r: number}} adsr - ADSR parameters
   * @returns {number} Envelope amplitude (0-1)
   */
  function calcADSR(t, dur, adsr) {
    var MIN_RELEASE = 0.003;
    var a = adsr.a, d = adsr.d, s = adsr.s;
    var r = Math.max(MIN_RELEASE, adsr.r);
    var sustainEnd = Math.max(0, dur - r);

    // Attack phase
    if (t < a) {
      return t / a;
    }
    // Decay phase - exponential curve from peak to sustain
    if (t < a + d) {
      var decayT = t - a;
      return s + (1 - s) * Math.exp(-decayT * 5 / d);
    }
    // Sustain phase
    if (t < sustainEnd) {
      return s;
    }
    // Release phase - exponential curve from sustain to zero
    if (t < dur) {
      var releaseT = t - sustainEnd;
      return s * Math.exp(-releaseT * 5 / r);
    }
    return 0;
  }

  // ============================================================
  // Filter Envelope Functions
  // ============================================================

  /**
   * Apply filter envelope to a filter chain (attack/decay/sustain phases)
   * Called when a note starts - schedules frequency automation
   * @param {Object} filterChain - Filter chain from createFilterChain()
   * @param {number} noteFreq - Frequency of the note being played (for key tracking)
   * @param {Object} filterSettings - Filter settings from getFilterSettings()
   * @param {Object} filterEnvSettings - Filter envelope settings from getFilterEnvSettings()
   * @param {AudioContext} ctx - Web Audio context
   */
  function applyFilterEnvelope(filterChain, noteFreq, filterSettings, filterEnvSettings, ctx) {
    var hasFilterChain = filterChain && filterChain.filters;
    var shouldApplyFilterEnv = filterEnvSettings.enabled && hasFilterChain;
    if (shouldApplyFilterEnv) {
      var now = ctx.currentTime;
      var baseFreq = filterSettings.frequency;

      // Calculate peak frequency based on amount in semitones
      // Positive amount = sweep UP from base, negative = sweep DOWN
      var peakFreq = Math.max(20, Math.min(20000, baseFreq * Math.pow(2, filterEnvSettings.amount / 12)));

      // Calculate sustain frequency (sustain% of the way from base to peak)
      var sustainFreq = baseFreq + (peakFreq - baseFreq) * (filterEnvSettings.sustain / 100);

      // Convert ms to seconds (already converted by getFilterEnvSettings if using log scale)
      var a = filterEnvSettings.attack / 1000;
      var d = filterEnvSettings.decay / 1000;


      // Apply envelope to all BiquadFilterNodes in the chain
      var appliedCount = 0;
      filterChain.filters.forEach(function(filter, idx) {
        if (filter instanceof BiquadFilterNode) {
          var currentFreq = filter.frequency.value;

          // Cancel any existing automation to start fresh
          filter.frequency.cancelScheduledValues(now);

          // Start from base frequency (not current - ensures consistent envelope)
          filter.frequency.setValueAtTime(baseFreq, now);

          // Attack: ramp to peak frequency
          filter.frequency.linearRampToValueAtTime(peakFreq, now + a);

          // Decay: ramp to sustain frequency
          filter.frequency.linearRampToValueAtTime(sustainFreq, now + a + d);

          appliedCount++;
        }
      });
    }
  }

  /**
   * Apply filter envelope release phase
   * Called when a note stops - ramps frequency back to base
   * @param {Object} filterChain - Filter chain from createFilterChain()
   * @param {Object} filterSettings - Filter settings from getFilterSettings()
   * @param {Object} filterEnvSettings - Filter envelope settings from getFilterEnvSettings()
   * @param {AudioContext} ctx - Web Audio context
   */
  function applyFilterEnvelopeRelease(filterChain, filterSettings, filterEnvSettings, ctx) {
    var isFilterEnvDisabled = !filterEnvSettings.enabled || !filterChain || !filterChain.filters;
    if (isFilterEnvDisabled) { return; }

    var now = ctx.currentTime;
    var baseFreq = filterSettings.frequency;
    var r = filterEnvSettings.release / 1000;

    filterChain.filters.forEach(function(filter) {
      if (filter instanceof BiquadFilterNode) {
        // Cancel scheduled values and start from current position
        filter.frequency.cancelScheduledValues(now);
        filter.frequency.setValueAtTime(filter.frequency.value, now);

        // Release: ramp back to base frequency
        filter.frequency.linearRampToValueAtTime(baseFreq, now + r);
      }
    });
  }

  // ============================================================
  // Register on SL.audio
  // ============================================================

  SL.audio.calcADSR = calcADSR;
  SL.audio.getEnvelopeCurve = getEnvelopeCurve;
  SL.audio.clearEnvelopeCache = clearEnvelopeCache;
  SL.audio.getEnvelopeCacheStats = getEnvelopeCacheStats;
  SL.audio.applyFilterEnvelope = applyFilterEnvelope;
  SL.audio.applyFilterEnvelopeRelease = applyFilterEnvelopeRelease;
  }

})();
