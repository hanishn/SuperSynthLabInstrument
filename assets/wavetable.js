// Super Synth Lab - Wavetable Synthesis Module
// Extracted from audio-engine.js for modularity
// Loads AFTER audio-engine.js and extends SL.audio
(function() {
  'use strict';

  var SL = window.SynthLab;

  if (SL && SL.audio) {

  // ============================================================
  // Wavetable Synthesis System
  // ============================================================

  /** Wavetable size - power of 2 for fast modulo */
  var WAVETABLE_SIZE = 2048;
  var WAVETABLE_MASK = WAVETABLE_SIZE - 1;

  /** Number of octave-specific tables (C0 to C9 = 10 octaves) */
  var NUM_OCTAVE_TABLES = 10;

  /** Waveform types that have wavetables */
  var WAVETABLE_WAVES = ['sine', 'sawtooth', 'square', 'triangle'];

  /** Wavetable storage: wavetables[waveform][octave] = Float32Array */
  var wavetables = {};

  /** Whether wavetables have been initialized */
  var isWavetablesInitialized = false;

  // ============================================================
  // Sine Lookup Table for Fast Sin Approximation
  // ============================================================

  /** Sine table size - 4096 samples for good accuracy/memory balance */
  var SINE_TABLE_SIZE = 4096;

  /** Pre-computed sine lookup table */
  var sineTable = new Float32Array(SINE_TABLE_SIZE);

  /** Whether sine table has been initialized */
  var isSineTableInitialized = false;

  /** Two PI constant for phase wrapping */
  var TWO_PI_CONST = Math.PI * 2;

  /**
   * Initialize the sine lookup table
   * Called during audio engine initialization
   */
  function initSineTable() {
    if (isSineTableInitialized) return;

    for (var i = 0; i < SINE_TABLE_SIZE; i++) {
      sineTable[i] = Math.sin(TWO_PI_CONST * i / SINE_TABLE_SIZE);
    }

    isSineTableInitialized = true;
  }

  /**
   * Fast sine approximation using lookup table with linear interpolation
   * @param {number} phase - Phase in radians
   * @returns {number} Sine value approximation
   */
  function fastSin(phase) {
    // Wrap phase to [0, 2*PI)
    phase = phase % TWO_PI_CONST;
    if (phase < 0) phase += TWO_PI_CONST;

    // Convert radians to table index (0 to TABLE_SIZE)
    var indexFloat = (phase / TWO_PI_CONST) * SINE_TABLE_SIZE;
    var index0 = Math.floor(indexFloat) % SINE_TABLE_SIZE;
    var index1 = (index0 + 1) % SINE_TABLE_SIZE;
    var frac = indexFloat - Math.floor(indexFloat);

    // Linear interpolation between adjacent samples
    return sineTable[index0] + (sineTable[index1] - sineTable[index0]) * frac;
  }

  /**
   * Generate a single band-limited wavetable
   * @param {string} waveform - Wave type (sine, sawtooth, square, triangle)
   * @param {number} maxHarmonics - Maximum number of harmonics to include
   * @returns {Float32Array} Wavetable
   */
  function generateWavetable(waveform, maxHarmonics) {
    var table = new Float32Array(WAVETABLE_SIZE);
    var TWO_PI = Math.PI * 2;

    for (var i = 0; i < WAVETABLE_SIZE; i++) {
      var phase = (i / WAVETABLE_SIZE) * TWO_PI;
      var sample = 0;

      if (waveform === 'sine') {
        sample = Math.sin(phase);
      } else if (waveform === 'sawtooth') {
        // Sawtooth: sum of sin(n*phase)/n for n=1 to maxHarmonics
        for (var h = 1; h <= maxHarmonics; h++) {
          sample += Math.sin(phase * h) / h;
        }
        sample *= 2 / Math.PI;
      } else if (waveform === 'square') {
        // Square: sum of sin(n*phase)/n for odd n
        for (var h = 1; h <= maxHarmonics; h += 2) {
          sample += Math.sin(phase * h) / h;
        }
        sample *= 4 / Math.PI;
      } else if (waveform === 'triangle') {
        // Triangle: sum of cos(n*phase)/n^2 with alternating signs for odd n
        var sign = 1;
        for (var h = 1; h <= maxHarmonics; h += 2) {
          sample += sign * Math.cos(phase * h) / (h * h);
          sign = -sign;
        }
        sample *= 8 / (Math.PI * Math.PI);
      }

      table[i] = sample;
    }

    return table;
  }

  /**
   * Initialize all wavetables at startup
   * Creates mip-mapped tables (different harmonic counts per octave)
   */
  function initWavetables() {
    if (isWavetablesInitialized) return;

    // Initialize sine lookup table first (used by fastSin)
    initSineTable();

    var sr = SL.SR || 44100;
    var startTime = performance.now();

    WAVETABLE_WAVES.forEach(function(wave) {
      wavetables[wave] = [];

      for (var octave = 0; octave < NUM_OCTAVE_TABLES; octave++) {
        // Calculate max harmonics for this octave to stay below Nyquist
        // Base frequency for octave: C0 = ~16.35 Hz, each octave doubles
        var baseFreq = 16.35 * Math.pow(2, octave);
        var nyquist = sr / 2;
        var maxHarmonics = Math.max(1, Math.floor(nyquist / baseFreq) - 1);

        // Cap at reasonable limit for performance
        var cappedHarmonics = Math.min(maxHarmonics, 256);

        wavetables[wave][octave] = generateWavetable(wave, cappedHarmonics);
      }
    });

    isWavetablesInitialized = true;
  }

  /**
   * Get the appropriate wavetable for a frequency
   * Selects the mip-map level based on the frequency
   * @param {string} waveform - Wave type
   * @param {number} freq - Frequency in Hz
   * @returns {Float32Array} Appropriate wavetable
   */
  function getWavetableForFreq(waveform, freq) {
    if (!wavetables[waveform]) return null;

    // Calculate octave from frequency (C0 = 16.35 Hz)
    var octave = Math.max(0, Math.min(NUM_OCTAVE_TABLES - 1,
      Math.floor(Math.log2(freq / 16.35))));

    return wavetables[waveform][octave];
  }

  /**
   * Sample a wavetable with linear interpolation
   * @param {Float32Array} table - Wavetable to sample
   * @param {number} phase - Phase position (0 to 1)
   * @returns {number} Interpolated sample value
   */
  function sampleWavetable(table, phase) {
    // Convert phase (0-1) to table index
    var index = phase * WAVETABLE_SIZE;
    var i0 = Math.floor(index) & WAVETABLE_MASK;
    var i1 = (i0 + 1) & WAVETABLE_MASK;
    var frac = index - Math.floor(index);

    // Linear interpolation
    return table[i0] + (table[i1] - table[i0]) * frac;
  }

  /**
   * Render a waveform using wavetable synthesis
   * @param {Float32Array} buffer - Output buffer
   * @param {string} waveform - Wave type
   * @param {number} freq - Frequency in Hz
   * @param {number} sr - Sample rate
   * @param {number} startSample - Start index in buffer
   * @param {number} numSamples - Number of samples to render
   * @param {Object} adsr - ADSR envelope settings
   * @param {number} dur - Total duration in seconds
   * @param {number} level - Amplitude level
   */
  function renderWavetable(buffer, waveform, freq, sr, startSample, numSamples, adsr, dur, level) {
    var table = getWavetableForFreq(waveform, freq);
    if (!table) return;

    var phaseIncrement = freq / sr;
    var phase = 0;

    // Get pre-computed envelope curve for the full note duration
    var envCurve = SL.audio.getEnvelopeCurve(dur, adsr, sr);

    for (var i = 0; i < numSamples; i++) {
      // Use pre-computed envelope value (index by absolute sample position)
      var envIndex = startSample + i;
      var env = envIndex < envCurve.length ? envCurve[envIndex] : 0;
      var sample = sampleWavetable(table, phase);

      buffer[startSample + i] += sample * env * level;

      phase += phaseIncrement;
      if (phase >= 1) phase -= 1;
    }
  }

  /**
   * Check if wavetables are ready
   * @returns {boolean} Whether wavetables are initialized
   */
  function areWavetablesReady() {
    return isWavetablesInitialized;
  }

  /**
   * Reset wavetable initialized flag (called when AudioContext is recreated)
   */
  function resetWavetables() {
    isWavetablesInitialized = false;
  }

  // ============================================================
  // Register on SL.audio
  // ============================================================

  SL.audio.initWavetables = initWavetables;
  SL.audio.areWavetablesReady = areWavetablesReady;
  SL.audio.getWavetableForFreq = getWavetableForFreq;
  SL.audio.sampleWavetable = sampleWavetable;
  SL.audio.renderWavetable = renderWavetable;
  SL.audio.fastSin = fastSin;
  SL.audio._resetWavetables = resetWavetables;

  // Expose constants needed by other modules
  SL.audio._WAVETABLE_WAVES = WAVETABLE_WAVES;

  } else {
    console.error('[wavetable] SynthLab.audio not available');
  }

})();
