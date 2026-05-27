// Super Synth Lab - Envelope Module
// Extracted from audio-engine.js for modularity
// Loads AFTER audio-engine.js and extends SL.audio
//
// -----------------------------------------------------------------------
// EDUCATIONAL OVERVIEW: ADSR Envelopes
// -----------------------------------------------------------------------
// An envelope shapes how a sound evolves over time. The ADSR model,
// first implemented in voltage-controlled hardware by Robert Moog
// [Moog, 1965], remains the standard in virtually all synthesizers:
//
//   Attack  (A) — time from silence to peak amplitude
//   Decay   (D) — time from peak down to the sustain level
//   Sustain (S) — amplitude held while the key is pressed (a LEVEL,
//                 not a time — this is the most common misconception)
//   Release (R) — time from key-up to silence
//
// Exponential curves are used for decay and release because human
// loudness perception is logarithmic (Weber-Fechner law): an
// exponential amplitude decay sounds like a linear fade-out.
//
// The exponential segment formula is:
//   v(t) = target + (start - target) * e^(-t / tau)
// where tau controls the curve speed (here, tau = stage_time / 5).
//
// This module also provides a filter envelope that modulates the
// filter cutoff frequency over the ADSR shape — the classic technique
// for "brightness sweeps" in subtractive synthesis.
//
// References:
//   Moog, R.A. (1965) "Voltage-Controlled Electronic Music Modules",
//     JAES 13(3), pp. 200-206
//   Roads, C. (1996) The Computer Music Tutorial, MIT Press, Ch. 3
// -----------------------------------------------------------------------
(function() {
  'use strict';

  var SL = window.SynthLab;

  if (!SL || !SL.audio) {
    console.error('[envelope] SynthLab.audio not available');
  } else {

  // ============================================================
  // Envelope Pre-computation Cache
  // ============================================================
  //
  // Pre-computing entire envelope curves trades memory for CPU time.
  // A typical note at 44100 Hz lasting 1 second requires a 44100-
  // element Float32Array (~172 KB). The LRU (Least Recently Used)
  // cache keeps up to 24 curves, evicting the oldest when full.
  // This is effective because players often repeat the same notes
  // with identical ADSR settings — cache hit rates above 80% are
  // common in typical playing patterns.

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
    // Round duration to nearest 10ms to improve cache hits.
    // This quantization is inaudible but dramatically increases
    // the probability of cache hits for similar note lengths.
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
  //
  // The four phases run sequentially:
  //   1. Attack:  linear ramp from 0 to 1 over A seconds
  //   2. Decay:   exponential fall from 1 to S over D seconds
  //   3. Sustain: hold at level S until key release
  //   4. Release: exponential fall from S to 0 over R seconds
  //
  // The exponential factor (-5/tau) gives roughly 99% convergence
  // by the end of each stage — fast enough to sound complete
  // without an abrupt cutoff.

  /**
   * Calculate ADSR envelope value at a given time
   * Used for buffer-based synthesis methods
   * @param {number} t - Current time in seconds
   * @param {number} dur - Total note duration in seconds
   * @param {{a: number, d: number, s: number, r: number}} adsr - ADSR parameters
   * @returns {number} Envelope amplitude (0-1)
   */
  function calcADSR(t, dur, adsr) {
    // 3ms minimum release prevents clicks from instantaneous amplitude drops
    var MIN_RELEASE = 0.003;
    var a = adsr.a, d = adsr.d, s = adsr.s;
    var safeA = a || 0.001;
    var safeD = d || 0.001;
    var r = Math.max(MIN_RELEASE, adsr.r);
    var safeR = r || 0.001;
    var sustainEnd = Math.max(0, dur - r);

    // Attack phase
    if (t < a) {
      return t / safeA;
    }
    // Decay phase: v(t) = sustain + (1 - sustain) * e^(-t * 5 / decay)
    // This is the exponential decay formula where start=1, target=sustain.
    if (t < a + d) {
      var decayT = t - a;
      return s + (1 - s) * Math.exp(-decayT * 5 / safeD);
    }
    // Sustain phase
    if (t < sustainEnd) {
      return s;
    }
    // Release phase: v(t) = sustain * e^(-t * 5 / release)
    // Same exponential formula with start=sustain, target=0.
    if (t < dur) {
      var releaseT = t - sustainEnd;
      return s * Math.exp(-releaseT * 5 / safeR);
    }
    return 0;
  }

  // ============================================================
  // Filter Envelope Functions
  // ============================================================
  //
  // A filter envelope modulates the cutoff frequency over time using
  // the same ADSR shape. This is distinct from the amplitude envelope:
  //   - Amplitude envelope: shapes loudness (how loud over time)
  //   - Filter envelope: shapes brightness (how bright over time)
  //
  // The "amount" parameter (in semitones) controls how far the cutoff
  // sweeps. Positive = brighter at attack, negative = darker at attack.
  // This is the core technique behind classic synth bass "wah" sounds
  // and plucky lead tones.

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

      // Calculate peak frequency based on amount in semitones.
      // pow(2, semitones/12) converts semitones to a frequency ratio —
      // the same equal temperament formula used for musical notes.
      // Positive amount = sweep UP from base, negative = sweep DOWN.
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
