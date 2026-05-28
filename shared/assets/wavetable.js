// Super Synth Lab - Wavetable Synthesis Module
// Extracted from audio-engine.js for modularity
// Loads AFTER audio-engine.js and extends SL.audio
//
// -----------------------------------------------------------------------
// EDUCATIONAL OVERVIEW: Wavetable Synthesis
// -----------------------------------------------------------------------
// Wavetable synthesis stores one cycle of a waveform as an array of
// samples, then reads through it at variable speed to produce pitch.
// This is far more efficient than computing waveforms sample-by-sample,
// especially for complex timbres built from many harmonics.
//
// The key challenge is ALIASING: a sawtooth wave at 10 kHz has
// harmonics that exceed the Nyquist frequency (sr/2), which fold
// back as audible artifacts. The solution is MIP-MAPPING — storing
// separate tables for each octave, each with only the harmonics
// that fit below Nyquist for that frequency range. Lower octaves
// get more harmonics (richer sound); higher octaves get fewer.
//
// Waveforms are constructed via additive synthesis (Fourier series):
//   Sawtooth: sum of sin(n*phase)/n for all n
//   Square:   sum of sin(n*phase)/n for odd n only
//   Triangle: sum of cos(n*phase)/n^2 with alternating signs, odd n
//
// The module also provides a fast sine lookup table (4096 samples)
// with linear interpolation — trading a small amount of accuracy
// for significant CPU savings in real-time oscillator code.
//
// References:
//   Smith, J.O. (2007) Mathematics of the DFT, CCRMA
//     (https://ccrma.stanford.edu/~jos/mdft/)
//   Roads, C. (1996) The Computer Music Tutorial, MIT Press, Ch. 4
// -----------------------------------------------------------------------
(function() {
  'use strict';

  var SL = window.SynthLab;

  if (SL && SL.audio) {

  // ============================================================
  // Wavetable Synthesis System
  // ============================================================

  // Power-of-2 size enables bitwise AND masking for fast wrap-around:
  // index & MASK is equivalent to index % SIZE but avoids division.
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
  //
  // Math.sin() is expensive when called thousands of times per audio
  // block. A pre-computed lookup table with linear interpolation gives
  // nearly identical results at a fraction of the CPU cost. At 4096
  // samples, the maximum error is less than 0.01% — inaudible.

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
    // Wrap phase to [0, 2*PI) then index into the table.
    // Linear interpolation between adjacent samples smooths out
    // the staircase that would result from nearest-neighbor lookup.
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
    // Build one cycle of a waveform using its Fourier series.
    // maxHarmonics limits the series to stay below Nyquist for the
    // target octave — this is what makes the table "band-limited."
    var table = new Float32Array(WAVETABLE_SIZE);
    var TWO_PI = Math.PI * 2;

    for (var i = 0; i < WAVETABLE_SIZE; i++) {
      var phase = (i / WAVETABLE_SIZE) * TWO_PI;
      var sample = 0;

      if (waveform === 'sine') {
        // Sine: the fundamental building block — a single harmonic
        sample = Math.sin(phase);
      } else if (waveform === 'sawtooth') {
        // Sawtooth Fourier series: sum of sin(n*phase)/n for all n.
        // The 2/pi normalization scales the result to [-1, 1].
        for (var h = 1; h <= maxHarmonics; h++) {
          var safeH = h || 1;
          sample += Math.sin(phase * h) / safeH;
        }
        sample *= 2 / Math.PI;
      } else if (waveform === 'square') {
        // Square Fourier series: only odd harmonics (1, 3, 5, ...).
        // This is why a square wave sounds "hollow" compared to a saw.
        for (var h = 1; h <= maxHarmonics; h += 2) {
          var safeH = h || 1;
          sample += Math.sin(phase * h) / safeH;
        }
        sample *= 4 / Math.PI;
      } else if (waveform === 'triangle') {
        // Triangle Fourier series: odd harmonics with 1/n^2 rolloff and
        // alternating signs. The steep harmonic rolloff makes triangle
        // the softest/warmest of the classic waveforms.
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
    // Builds all mip-mapped wavetables at startup. For each waveform
    // and each octave (C0-C9), we compute a table with the maximum
    // number of harmonics that fit below Nyquist. Higher octaves get
    // fewer harmonics — e.g., C8 (~4186 Hz) at 44100 Hz sample rate
    // can only fit ~4 harmonics before hitting 22050 Hz.
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
        var safeBaseFreq = baseFreq || 0.001;
        var maxHarmonics = Math.max(1, Math.floor(nyquist / safeBaseFreq) - 1);

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
    // Select the mip-map level: log2(freq/C0) gives the octave number.
    // This ensures we always use a table whose harmonics are below Nyquist.
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
    // Convert phase (0-1) to table index. The bitwise AND with
    // WAVETABLE_MASK handles wrap-around without branching.
    var index = phase * WAVETABLE_SIZE;
    var i0 = Math.floor(index) & WAVETABLE_MASK;
    var i1 = (i0 + 1) & WAVETABLE_MASK;
    var frac = index - Math.floor(index);

    // Linear interpolation between adjacent table entries
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
    // Renders audio by stepping through the wavetable at a rate
    // proportional to the desired frequency: phaseIncrement = freq/sr.
    // Each output sample is: wavetable_value * envelope * level.
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
