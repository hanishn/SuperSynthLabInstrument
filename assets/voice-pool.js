// Super Synth Lab - Voice Pool & Buffer Pool Module
// Extracted from audio-engine.js for modularity
// Loads AFTER audio-engine.js and extends SL.audio
(function() {
  'use strict';

  var SL = window.SynthLab;

  // Wait for SL.audio to be available (created by audio-engine.js)
  if (SL && SL.audio) {

  // ============================================================
  // Voice Pool System
  // ============================================================

  /** Maximum voices per instrument */
  var MAX_VOICES_PER_INSTRUMENT = 16;

  /** Total voice pool size (shared across all instruments) */
  var VOICE_POOL_SIZE = MAX_VOICES_PER_INSTRUMENT * SL.audio.getNumInstruments();

  /** Voice pool - pre-allocated voice structures */
  var voicePool = [];

  /** Free-list stack of available voice pool indices */
  var freeVoiceStack = [];

  /** Map of active voices by key (instrumentId:midiNote) */
  var activeVoices = new Map();

  /** Voice pool statistics for monitoring */
  var voicePoolStats = {
    totalAllocated: 0,
    peakUsage: 0,
    steals: 0,
    created: 0
  };

  // ============================================================
  // RAF-Driven Release Queue (replaces per-voice setTimeout)
  // ============================================================

  /** Time-sorted release queue: { voice, releaseTime, fadeTime } */
  var _releaseQueue = [];
  /** Whether the RAF loop is currently running */
  var isReleaseRAFRunning = false;
  /** RAF handle for cancellation */
  var _releaseRAFHandle = 0;

  /**
   * Process release queue via requestAnimationFrame.
   * Voices whose releaseTime has passed get cleaned up and returned to the pool.
   */
  function _processReleaseQueue() {
    if (_releaseQueue.length === 0) {
      isReleaseRAFRunning = false;
    } else {

    var now = performance.now();
    var remaining = [];

    for (var i = 0; i < _releaseQueue.length; i++) {
      var entry = _releaseQueue[i];
      if (now >= entry.releaseTime) {
        // Clean up and return voice to pool
        var voice = entry.voice;
        voice.inUse = false;
        if (voice._poolIdx >= 0 && voice._poolIdx < VOICE_POOL_SIZE) {
          freeVoiceStack.push(voice._poolIdx);
        }
        if (voice.oscillators) {
          for (var j = 0; j < voice.oscillators.length; j++) {
            try { if (voice.oscillators[j] && voice.oscillators[j].osc) { voice.oscillators[j].osc.disconnect(); } } catch (e) { /* node already disconnected */ }
          }
        }
        if (voice.filterChain && voice.filterChain.output) {
          try { voice.filterChain.output.disconnect(); } catch (e) { /* node already disconnected */ }
        }
        if (voice.filterChain && voice.filterChain.input) {
          try { voice.filterChain.input.disconnect(); } catch (e) { /* node already disconnected */ }
        }
        voice.oscillators.length = 0;
        voice.noiseNode = null;
        voice.filterChain = null;
        voice.filterSettings = null;
        voice.filterEnvSettings = null;
        voice.adsrRelease = null;
        voice.sustainLevel = null;
        voice.masterGain.disconnect();
      } else {
        remaining.push(entry);
      }
    }

    _releaseQueue = remaining;

    if (_releaseQueue.length > 0) {
      _releaseRAFHandle = requestAnimationFrame(_processReleaseQueue);
    } else {
      isReleaseRAFRunning = false;
    }

    } // end else (_releaseQueue.length !== 0)
  }

  /**
   * Enqueue a voice for deferred release via RAF.
   * @param {Object} voice - Voice to release
   * @param {number} fadeMs - Fade time in milliseconds
   */
  function _enqueueRelease(voice, fadeMs) {
    var releaseTime = performance.now() + fadeMs;
    // Insert sorted by releaseTime for efficient processing
    var isInserted = false;
    for (var i = 0; i < _releaseQueue.length; i++) {
      if (releaseTime < _releaseQueue[i].releaseTime) {
        _releaseQueue.splice(i, 0, { voice: voice, releaseTime: releaseTime });
        isInserted = true;
        break;
      }
    }
    if (!isInserted) {
      _releaseQueue.push({ voice: voice, releaseTime: releaseTime });
    }

    if (!isReleaseRAFRunning) {
      isReleaseRAFRunning = true;
      _releaseRAFHandle = requestAnimationFrame(_processReleaseQueue);
    }
  }

  /**
   * Create a single voice structure with pre-allocated nodes
   * @param {AudioContext} ctx - Audio context
   * @returns {Object} Voice structure
   */
  function createVoice(ctx) {
    var voice = {
      id: voicePoolStats.created++,
      inUse: false,
      instrumentId: -1,
      midiNote: -1,
      startTime: 0,

      // Pre-allocated audio nodes
      masterGain: ctx.createGain(),
      oscGains: [
        ctx.createGain(),
        ctx.createGain(),
        ctx.createGain()
      ],

      // Filter chain (created on demand, cached for reuse)
      filterChain: null,

      // Active oscillators for this voice (created per-note, can't be pooled)
      oscillators: [],

      // Noise node (if any)
      noiseNode: null,

      // Settings snapshots for release phase
      filterSettings: null,
      filterEnvSettings: null
    };

    // Connect osc gains to master
    voice.oscGains.forEach(function(g) { g.connect(voice.masterGain); });

    return voice;
  }

  /**
   * Initialize the voice pool
   * Called when audio context is first created
   */
  function initVoicePool() {
    var ctx = SL.audio.getCtx();
    voicePool = [];
    freeVoiceStack = [];

    for (var i = 0; i < VOICE_POOL_SIZE; i++) {
      var v = createVoice(ctx);
      v._poolIdx = i;
      voicePool.push(v);
    }
    for (var fi = 0; fi < voicePool.length; fi++) {
      freeVoiceStack.push(fi);
    }

    voicePoolStats.totalAllocated = VOICE_POOL_SIZE;
  }

  /**
   * Acquire a voice from the pool
   * Uses voice stealing if pool is exhausted
   * @param {number} instrumentId - Instrument index
   * @param {number} midiNote - MIDI note number
   * @returns {Object} Voice structure
   */
  function acquireVoice(instrumentId, midiNote) {
    // First, check if this note is already playing (retrigger)
    var key = instrumentId + ':' + midiNote;
    if (activeVoices.has(key)) {
      var existingVoice = activeVoices.get(key);
      releaseVoice(existingVoice, true); // Quick release for retrigger
    }

    // Find a free voice from the stack
    var voice = null;
    if (freeVoiceStack.length > 0) {
      voice = voicePool[freeVoiceStack.pop()];
    }

    // If no free voice, steal the oldest one
    if (!voice) {
      voice = stealVoice(instrumentId);
      if (!voice) {
        return null;
      }
      voicePoolStats.steals++;
    }

    // Mark voice as in use
    voice.inUse = true;
    voice.instrumentId = instrumentId;
    voice.midiNote = midiNote;
    voice.startTime = performance.now();
    voice.oscillators = [];
    voice.noiseNode = null;

    // Reset gain nodes
    var ctx = SL.audio.getCtx();
    voice.masterGain.gain.cancelScheduledValues(ctx.currentTime);
    voice.masterGain.gain.setValueAtTime(0, ctx.currentTime);
    voice.oscGains.forEach(function(g) {
      g.gain.cancelScheduledValues(ctx.currentTime);
      g.gain.setValueAtTime(0, ctx.currentTime);
    });

    // Track active voice
    activeVoices.set(key, voice);

    // Increment active node counter for diagnostics
    if (SL.audio) { SL.audio._activeNodeCount++; }

    // Update peak usage stat
    if (activeVoices.size > voicePoolStats.peakUsage) {
      voicePoolStats.peakUsage = activeVoices.size;
    }

    return voice;
  }

  /**
   * Steal the quietest/oldest voice for a given instrument
   * @param {number} instrumentId - Instrument that needs a voice
   * @returns {Object} Stolen voice
   */
  function stealVoice(instrumentId) {
    // Find voices for this instrument first, then any voice
    var candidates = [];

    activeVoices.forEach(function(voice, key) {
      candidates.push({ voice: voice, key: key, age: performance.now() - voice.startTime });
    });

    // Sort by age (oldest first) - could also consider amplitude
    candidates.sort(function(a, b) { return b.age - a.age; });

    if (candidates.length > 0) {
      var stolen = candidates[0];
      releaseVoice(stolen.voice, true); // Quick release
      return stolen.voice;
    }

    // Fallback: create a new voice (shouldn't happen if pool is sized correctly)
    // Cap emergency growth at 2x pool size to prevent unbounded allocation
    if (voicePool.length >= VOICE_POOL_SIZE * 2) {
      console.warn('Voice pool hard cap reached, cannot allocate');
      return null;
    }
    console.warn('Voice pool exhausted, creating emergency voice');
    var ctx = SL.audio.getCtx();
    var newVoice = createVoice(ctx);
    newVoice._poolIdx = voicePool.length;
    voicePool.push(newVoice);
    voicePoolStats.totalAllocated++;
    return newVoice;
  }

  /**
   * Release a voice back to the pool
   * @param {Object} voice - Voice to release
   * @param {boolean} quick - If true, use quick fade (for stealing/retrigger)
   */
  var QUICK_RELEASE_S = 0.01;
  var FALLBACK_RELEASE_S = 0.05;
  var SILENCE_FLOOR = 0.001;
  // Minimum release time to avoid audible gate/click on finger-up (seconds).
  // 80ms provides a perceptible fade even for short ADSR release settings.
  var MIN_AUDIBLE_RELEASE_S = 0.08;
  // Time constant divisor: controls how quickly the exponential decay reaches
  // silence. A divisor of 3 means the gain reaches ~5% at fadeTime (3 time
  // constants). Higher divisors = faster decay = more click-like cutoff.
  var RELEASE_TIME_CONSTANT_DIVISOR = 3;

  function releaseVoice(voice, quick) {
    if (!voice || !voice.inUse) return;

    var ctx = SL.audio.getCtx();
    var hasAdsrRelease = (!quick && typeof voice.adsrRelease === 'number' && voice.adsrRelease > 0);
    var fadeTime = QUICK_RELEASE_S;
    if (!quick) {
      if (hasAdsrRelease) {
        fadeTime = Math.max(voice.adsrRelease, MIN_AUDIBLE_RELEASE_S);
      } else {
        fadeTime = Math.max(FALLBACK_RELEASE_S, MIN_AUDIBLE_RELEASE_S);
      }
    }
    var stopTime = ctx.currentTime + fadeTime + 0.01;

    // Fade out master gain using ADSR release curve
    voice.masterGain.gain.cancelScheduledValues(ctx.currentTime);
    voice.masterGain.gain.setValueAtTime(voice.masterGain.gain.value, ctx.currentTime);
    if (hasAdsrRelease) {
      // Use exponential decay with time constant = fadeTime / divisor.
      // With divisor=3, gain reaches ~5% (e^-3) at fadeTime elapsed.
      var timeConstant = fadeTime / RELEASE_TIME_CONSTANT_DIVISOR;
      voice.masterGain.gain.setTargetAtTime(SILENCE_FLOOR, ctx.currentTime, timeConstant);
    } else {
      voice.masterGain.gain.exponentialRampToValueAtTime(SILENCE_FLOOR, ctx.currentTime + fadeTime);
    }

    // Stop all oscillators
    voice.oscillators.forEach(function(o) {
      try {
        if (o.osc) o.osc.stop(stopTime);
      } catch (e) { /* already stopped */ }
    });

    // Stop noise if active
    if (voice.noiseNode && voice.noiseNode.source) {
      try {
        voice.noiseNode.source.stop(stopTime);
      } catch (e) { /* already stopped */ }
    }

    // Remove from active map
    var key = voice.instrumentId + ':' + voice.midiNote;
    activeVoices.delete(key);

    // Decrement active node counter for diagnostics
    if (SL.audio && SL.audio._activeNodeCount > 0) { SL.audio._activeNodeCount--; }

    // Schedule cleanup via RAF-driven release queue (replaces setTimeout)
    var fadeMs = (fadeTime + 0.02) * 1000;
    _enqueueRelease(voice, fadeMs);
  }

  /**
   * Get voice pool statistics
   * @returns {Object} Pool stats
   */
  function getVoicePoolStats() {
    return Object.assign({}, voicePoolStats, {
      currentlyActive: activeVoices.size,
      available: voicePool.filter(function(v) { return !v.inUse; }).length
    });
  }

  // ============================================================
  // Buffer Pool System
  // ============================================================

  /** Buffer size categories for pooling */
  var BUFFER_SIZES = {
    small: 1024,      // ~23ms at 44100Hz
    medium: 4096,     // ~93ms at 44100Hz
    large: 16384,     // ~372ms at 44100Hz
    xlarge: 65536     // ~1.5s at 44100Hz
  };

  /** Number of buffers to pre-allocate per size category */
  var BUFFERS_PER_SIZE = 6;

  /** Buffer pools organized by size */
  var bufferPools = {
    small: [],
    medium: [],
    large: [],
    xlarge: []
  };

  /** Buffer pool statistics for monitoring */
  var bufferPoolStats = {
    hits: 0,          // Successful pool acquisitions
    misses: 0,        // Had to create new buffer
    returns: 0,       // Successful returns to pool
    currentOut: 0,    // Currently checked out buffers
    peakOut: 0        // Peak concurrent buffers out
  };

  /** Map to track buffer sizes for proper return to pool */
  var bufferSizeMap = new WeakMap();

  /**
   * Initialize the buffer pool with pre-allocated Float32Arrays
   * Called during audio engine initialization
   */
  function initBufferPool() {
    var startTime = performance.now();

    // Pre-allocate buffers for each size category
    Object.keys(BUFFER_SIZES).forEach(function(sizeKey) {
      var size = BUFFER_SIZES[sizeKey];
      bufferPools[sizeKey] = [];

      for (var i = 0; i < BUFFERS_PER_SIZE; i++) {
        var buffer = new Float32Array(size);
        bufferPools[sizeKey].push(buffer);
        bufferSizeMap.set(buffer, sizeKey);
      }
    });

    var totalBuffers = Object.keys(BUFFER_SIZES).length * BUFFERS_PER_SIZE;
  }

  /**
   * Get the appropriate size category for a requested buffer size
   * @param {number} minSize - Minimum required buffer size
   * @returns {string|null} Size category key or null if too large
   */
  function getBufferSizeCategory(minSize) {
    if (minSize <= BUFFER_SIZES.small) return 'small';
    if (minSize <= BUFFER_SIZES.medium) return 'medium';
    if (minSize <= BUFFER_SIZES.large) return 'large';
    if (minSize <= BUFFER_SIZES.xlarge) return 'xlarge';
    return null; // Too large for pool
  }

  /**
   * Acquire a buffer from the pool
   * Returns the smallest buffer that fits the requested size
   * Creates a new buffer if none available in pool
   * @param {number} minSize - Minimum required buffer size
   * @returns {Float32Array} Buffer (may be larger than requested)
   */
  function acquireBuffer(minSize) {
    var sizeKey = getBufferSizeCategory(minSize);

    // If size is too large for pool, create a new buffer
    if (!sizeKey) {
      bufferPoolStats.misses++;
      var buffer = new Float32Array(minSize);
      // Don't track oversized buffers - they can't be returned
      return buffer;
    }

    // Try to get a buffer from the appropriate pool
    if (bufferPools[sizeKey].length > 0) {
      var buffer = bufferPools[sizeKey].pop();
      bufferPoolStats.hits++;
      bufferPoolStats.currentOut++;
      if (bufferPoolStats.currentOut > bufferPoolStats.peakOut) {
        bufferPoolStats.peakOut = bufferPoolStats.currentOut;
      }
      // Zero the buffer before returning (clean slate)
      buffer.fill(0);
      return buffer;
    }

    // No buffer available - try larger sizes
    var sizeOrder = ['small', 'medium', 'large', 'xlarge'];
    var startIdx = sizeOrder.indexOf(sizeKey) + 1;

    for (var i = startIdx; i < sizeOrder.length; i++) {
      var largerKey = sizeOrder[i];
      if (bufferPools[largerKey].length > 0) {
        var buffer = bufferPools[largerKey].pop();
        bufferPoolStats.hits++;
        bufferPoolStats.currentOut++;
        if (bufferPoolStats.currentOut > bufferPoolStats.peakOut) {
          bufferPoolStats.peakOut = bufferPoolStats.currentOut;
        }
        buffer.fill(0);
        return buffer;
      }
    }

    // Pool exhausted - create new buffer of requested size category
    bufferPoolStats.misses++;
    bufferPoolStats.currentOut++;
    if (bufferPoolStats.currentOut > bufferPoolStats.peakOut) {
      bufferPoolStats.peakOut = bufferPoolStats.currentOut;
    }
    var newBuffer = new Float32Array(BUFFER_SIZES[sizeKey]);
    bufferSizeMap.set(newBuffer, sizeKey);
    return newBuffer;
  }

  /**
   * Release a buffer back to the pool for reuse
   * Buffers are zeroed on acquire, not release (for efficiency)
   * @param {Float32Array} buffer - Buffer to return to pool
   */
  function releaseBuffer(buffer) {
    if (buffer) {
      var sizeKey = bufferSizeMap.get(buffer);
      if (sizeKey) {
        // Return to appropriate pool
        bufferPools[sizeKey].push(buffer);
        bufferPoolStats.returns++;
        bufferPoolStats.currentOut = Math.max(0, bufferPoolStats.currentOut - 1);
      }
      // else: Oversized buffer or unknown - just let GC handle it
    }
  }

  /**
   * Get buffer pool statistics for debugging/monitoring
   * @returns {Object} Pool statistics
   */
  function getBufferPoolStats() {
    var poolSizes = {};
    Object.keys(bufferPools).forEach(function(key) {
      poolSizes[key] = {
        available: bufferPools[key].length,
        bufferSize: BUFFER_SIZES[key]
      };
    });

    return Object.assign({}, bufferPoolStats, {
      pools: poolSizes,
      hitRate: bufferPoolStats.hits + bufferPoolStats.misses > 0
        ? (bufferPoolStats.hits / (bufferPoolStats.hits + bufferPoolStats.misses) * 100).toFixed(1) + '%'
        : 'N/A'
    });
  }

  // ============================================================
  // Register on SL.audio
  // ============================================================

  SL.audio.initVoicePool = initVoicePool;
  SL.audio.acquireVoice = acquireVoice;
  SL.audio.releaseVoice = releaseVoice;
  SL.audio.getVoicePoolStats = getVoicePoolStats;

  SL.audio.initBufferPool = initBufferPool;
  SL.audio.acquireBuffer = acquireBuffer;
  SL.audio.releaseBuffer = releaseBuffer;
  SL.audio.getBufferPoolStats = getBufferPoolStats;

  } else {
    console.error('[voice-pool] SynthLab.audio not available');
  }

})();
