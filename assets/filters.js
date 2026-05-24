// Super Synth Lab - Filters Module
// Extracted from audio-engine.js for modularity
// Loads AFTER audio-engine.js and extends SL.audio
(function() {
  'use strict';

  const SL = window.SynthLab;

  if (!SL || !SL.audio) {
    console.error('[filters] SynthLab.audio not available');
    return;
  }

  var _pulseWaveCache = {};
  var _ms20CurveCache = {};

  // ============================================================
  // Filter Settings & Creation
  // ============================================================

  /**
   * Convert slider value (0-1000) to frequency (20-20000Hz) using logarithmic scale
   * This gives equal perceptual spacing across the frequency range
   * @param {number} sliderValue - Slider position (0-1000)
   * @returns {number} Frequency in Hz
   */
  function sliderToFreq(sliderValue) {
    const minFreq = 20;
    const maxFreq = 20000;
    const minLog = Math.log10(minFreq);
    const maxLog = Math.log10(maxFreq);
    const logValue = minLog + (sliderValue / 1000) * (maxLog - minLog);
    return Math.pow(10, logValue);
  }

  /**
   * Convert frequency (20-20000Hz) to slider value (0-1000) using logarithmic scale
   * @param {number} freq - Frequency in Hz
   * @returns {number} Slider position (0-1000)
   */
  function freqToSlider(freq) {
    const minFreq = 20;
    const maxFreq = 20000;
    const clampedFreq = Math.max(minFreq, Math.min(maxFreq, freq));
    const minLog = Math.log10(minFreq);
    const maxLog = Math.log10(maxFreq);
    const logFreq = Math.log10(clampedFreq);
    return ((logFreq - minLog) / (maxLog - minLog)) * 1000;
  }

  /**
   * Convert slider value (0-100) to Q factor (0.5-20)
   * Uses a slight exponential curve to make lower Q values more accessible
   * @param {number} sliderValue - Slider position (0-100)
   * @returns {number} Q factor
   */
  function sliderToQ(sliderValue) {
    const minQ = 0.5;
    const maxQ = 20;
    const normalized = sliderValue / 100;
    const curved = Math.pow(normalized, 1.5);
    return minQ + curved * (maxQ - minQ);
  }

  /**
   * Convert Q factor (0.5-20) to slider value (0-100)
   * @param {number} q - Q factor
   * @returns {number} Slider position (0-100)
   */
  function qToSlider(q) {
    const minQ = 0.5;
    const maxQ = 20;
    const clampedQ = Math.max(minQ, Math.min(maxQ, q));
    const normalized = (clampedQ - minQ) / (maxQ - minQ);
    return Math.pow(normalized, 1 / 1.5) * 100;
  }

  /**
   * Calculate key-tracked filter cutoff frequency
   * @param {number} baseFreq - Base cutoff frequency from settings
   * @param {number} noteFreq - Frequency of the note being played
   * @param {number} keyTrack - Key tracking amount (0-2 for 0-200%)
   * @returns {number} Adjusted cutoff frequency
   */
  function calcKeyTrackedFreq(baseFreq, noteFreq, keyTrack) {

    if (keyTrack === 0) {
      return baseFreq;
    }

    // Reference frequency is middle C (C4 = 261.63 Hz)
    const refFreq = 261.63;

    // Calculate how many octaves above/below reference
    const octaveDiff = Math.log2(noteFreq / refFreq);

    // Apply key tracking: each octave shifts cutoff by keyTrack amount
    const multiplier = Math.pow(2, octaveDiff * keyTrack);

    // Clamp to reasonable range
    const result = Math.max(20, Math.min(20000, baseFreq * multiplier));
    return result;
  }

  // ============================================================
  // Filter Model Implementations
  // ============================================================

  /**
   * Create a standard Butterworth filter chain
   * @param {AudioContext} ctx - Web Audio context
   * @param {Object} settings - Filter settings
   * @returns {{input: BiquadFilterNode, output: BiquadFilterNode, filters: BiquadFilterNode[]}}
   */
  function createButterworthFilter(ctx, settings) {
    const filter1 = ctx.createBiquadFilter();
    filter1.type = settings.type;
    filter1.frequency.value = settings.frequency;
    filter1.Q.value = settings.resonance;

    if (settings.slope === 12) {
      return { input: filter1, output: filter1, filters: [filter1] };
    }

    // 24dB/oct: chain two biquads
    const filter2 = ctx.createBiquadFilter();
    filter2.type = settings.type;
    filter2.frequency.value = settings.frequency;
    filter2.Q.value = Math.max(0.1, settings.resonance * 0.707);
    filter1.connect(filter2);

    return { input: filter1, output: filter2, filters: [filter1, filter2] };
  }

  /**
   * Create a Moog-style ladder filter using BiquadFilterNode fallback (non-lowpass types)
   * @param {AudioContext} ctx - Web Audio context
   * @param {Object} settings - Filter settings
   * @returns {{input: AudioNode, output: AudioNode, filters: AudioNode[]}}
   */
  function createMoogFilterFallback(ctx, settings) {
    var filters = [];
    var numStages = settings.slope === 12 ? 2 : 4;
    var baseQ = 0.5;
    var resonanceFactor = Math.pow(settings.resonance / 10, 0.7);

    for (var i = 0; i < numStages; i++) {
      var filter = ctx.createBiquadFilter();
      filter.type = settings.type;
      filter.frequency.value = settings.frequency;
      var stageQ = baseQ + (resonanceFactor * (i + 1) / numStages) * 8;
      filter.Q.value = Math.min(stageQ, 20);
      filters.push(filter);
    }

    for (var j = 0; j < filters.length - 1; j++) {
      filters[j].connect(filters[j + 1]);
    }

    return { input: filters[0], output: filters[filters.length - 1], filters: filters };
  }

  /**
   * Create a TRUE Moog ladder filter with per-stage tanh saturation
   * Uses ScriptProcessor for sample-by-sample 4-pole processing
   * @param {AudioContext} ctx - Web Audio context
   * @param {Object} settings - Filter settings
   * @returns {{input: AudioNode, output: AudioNode, filters: AudioNode[]}}
   */
  function createMoogFilter(ctx, settings) {
    // Non-lowpass types fall back to BiquadFilterNode chain
    if (settings.type !== 'lowpass') {
      return createMoogFilterFallback(ctx, settings);
    }

    var sampleRate = ctx.sampleRate;
    var inputGain = ctx.createGain();
    inputGain.gain.value = 1.0;
    var outputGain = ctx.createGain();
    outputGain.gain.value = 1.0;

    var bufferSize = 512;
    var numChannels = 2;
    var processor = ctx.createScriptProcessor(bufferSize, numChannels, numChannels);

    // Per-channel state: 4 stage outputs
    var state = {
      s: [] // s[channel][stage]
    };
    for (var ch = 0; ch < numChannels; ch++) {
      state.s[ch] = [0, 0, 0, 0];
    }
    processor.moogState = state;

    // Map resonance from 0-20 Q range to 0-4 internal resonance
    var resonance = Math.min(4, settings.resonance / 5);

    processor.moogCutoff = settings.frequency;
    processor.moogResonance = resonance;

    processor.onaudioprocess = function(e) {
      var numCh = e.inputBuffer.numberOfChannels;
      // Recalculate coefficients from live properties
      var fc = Math.max(20, Math.min(20000, processor.moogCutoff));
      var g = Math.min(0.99, Math.max(0.001,
        Math.tan(Math.PI * fc / sampleRate)));
      var res = Math.min(4, Math.max(0, processor.moogResonance));
      // Drive increases with resonance for authentic Moog saturation
      var drive = 1.0 + res * 0.5;
      var st = processor.moogState;

      for (var ch = 0; ch < numCh; ch++) {
        var inp = e.inputBuffer.getChannelData(ch);
        var out = e.outputBuffer.getChannelData(ch);
        var s = st.s[ch];
        if (!s) {
          s = [0, 0, 0, 0];
          st.s[ch] = s;
        }

        for (var n = 0; n < inp.length; n++) {
          // Feedback: subtract resonance-scaled output from input
          var x = inp[n] - res * s[3];
          // Pre-filter drive saturation
          x = Math.tanh(x * drive);

          // 4-pole cascade with per-stage tanh saturation
          s[0] = s[0] + g * (Math.tanh(x) - Math.tanh(s[0]));
          s[1] = s[1] + g * (Math.tanh(s[0]) - Math.tanh(s[1]));
          s[2] = s[2] + g * (Math.tanh(s[1]) - Math.tanh(s[2]));
          s[3] = s[3] + g * (Math.tanh(s[2]) - Math.tanh(s[3]));

          out[n] = s[3];
        }
      }
    };

    inputGain.connect(processor);
    processor.connect(outputGain);

    return {
      input: inputGain,
      output: outputGain,
      filters: [inputGain, processor, outputGain]
    };
  }

  /**
   * Create a State Variable Filter (SVF) approximation
   * @param {AudioContext} ctx - Web Audio context
   * @param {Object} settings - Filter settings
   * @returns {{input: AudioNode, output: AudioNode, filters: BiquadFilterNode[]}}
   */
  function createSVFFilter(ctx, settings) {
    const filters = [];
    const svfQ = 0.5 + (settings.resonance * 2.5);

    if (settings.slope === 12) {
      const filter = ctx.createBiquadFilter();
      filter.type = settings.type;
      filter.frequency.value = settings.frequency;
      filter.Q.value = svfQ;
      filters.push(filter);

      return { input: filter, output: filter, filters: filters };
    }

    const filter1 = ctx.createBiquadFilter();
    filter1.type = settings.type;
    filter1.frequency.value = settings.frequency;
    filter1.Q.value = svfQ;
    filters.push(filter1);

    const filter2 = ctx.createBiquadFilter();
    filter2.type = settings.type;
    filter2.frequency.value = settings.frequency;
    filter2.Q.value = svfQ * 0.8;
    filters.push(filter2);

    filter1.connect(filter2);

    return { input: filter1, output: filter2, filters: filters };
  }

  /**
   * Create an MS-20 style aggressive filter approximation
   * @param {AudioContext} ctx - Web Audio context
   * @param {Object} settings - Filter settings
   * @returns {{input: AudioNode, output: AudioNode, filters: AudioNode[]}}
   */
  function createMS20Filter(ctx, settings) {
    const filters = [];
    const aggressiveQ = 0.5 + Math.pow(settings.resonance / 5, 1.8) * 25;

    const inputGain = ctx.createGain();
    inputGain.gain.value = 1.0 + (settings.resonance / 30);

    const filter1 = ctx.createBiquadFilter();
    filter1.type = settings.type;
    filter1.frequency.value = settings.frequency;
    filter1.Q.value = Math.min(aggressiveQ, 30);
    filters.push(filter1);

    inputGain.connect(filter1);

    if (settings.slope === 12) {
      return { input: inputGain, output: filter1, filters: [inputGain, filter1] };
    }

    const filter2 = ctx.createBiquadFilter();
    filter2.type = settings.type;
    filter2.frequency.value = settings.frequency;
    filter2.Q.value = Math.min(aggressiveQ * 1.2, 35);
    filters.push(filter2);

    filter1.connect(filter2);

    // Add subtle soft-clipping for the MS-20 "grit"
    const waveshaper = ctx.createWaveShaper();
    waveshaper.curve = createMS20SaturationCurve(settings.resonance);
    waveshaper.oversample = '2x';
    filter2.connect(waveshaper);
    filters.push(waveshaper);

    return { input: inputGain, output: waveshaper, filters: [inputGain, filter1, filter2, waveshaper] };
  }

  /**
   * Create a soft saturation curve for MS-20 style grit
   * @param {number} resonance - Resonance value (0-30 typical)
   * @returns {Float32Array} Waveshaper curve
   */
  function createMS20SaturationCurve(resonance) {
    var key = Math.round(resonance * 10);
    if (_ms20CurveCache[key]) {
      return _ms20CurveCache[key];
    }
    var samples = 256;
    var curve = new Float32Array(samples);
    var amount = 0.1 + (resonance / 30) * 0.4;

    for (var i = 0; i < samples; i++) {
      var x = (i / (samples - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * (1 + amount * 2)) / Math.tanh(1 + amount * 2);
    }
    _ms20CurveCache[key] = curve;
    return curve;
  }

  /**
   * Create an Oberheim SEM style filter approximation
   * @param {AudioContext} ctx - Web Audio context
   * @param {Object} settings - Filter settings
   * @returns {{input: AudioNode, output: AudioNode, filters: BiquadFilterNode[]}}
   */
  function createOberheimFilter(ctx, settings) {
    const filters = [];
    const semQ = 0.7 + Math.sqrt(settings.resonance) * 2.5;

    const filter1 = ctx.createBiquadFilter();
    filter1.type = settings.type;
    filter1.frequency.value = settings.frequency;
    filter1.Q.value = semQ;
    filters.push(filter1);

    if (settings.slope === 12) {
      return { input: filter1, output: filter1, filters: filters };
    }

    const filter2 = ctx.createBiquadFilter();
    filter2.type = settings.type;
    filter2.frequency.value = settings.frequency * 0.97;
    filter2.Q.value = semQ * 0.9;
    filters.push(filter2);

    filter1.connect(filter2);

    return { input: filter1, output: filter2, filters: filters };
  }

  /**
   * Create a filter chain based on settings
   * @param {AudioContext} ctx - Web Audio context
   * @param {Object} settings - Filter settings from getFilterSettings()
   * @returns {{input: AudioNode, output: AudioNode, filters: AudioNode[]}|null}
   */
  function createFilterChain(ctx, settings) {
    if (!settings.enabled) return null;

    const model = settings.model || 'butterworth';

    switch (model) {
      case 'moog':
        return createMoogFilter(ctx, settings);
      case 'svf':
        return createSVFFilter(ctx, settings);
      case 'ms20':
        return createMS20Filter(ctx, settings);
      case 'oberheim':
        return createOberheimFilter(ctx, settings);
      case 'butterworth':
      default:
        return createButterworthFilter(ctx, settings);
    }
  }

  // ============================================================
  // PolyBLEP Anti-Aliasing
  // ============================================================

  /**
   * PolyBLEP correction for discontinuities
   * @param {number} t - Phase position [0, 1)
   * @param {number} dt - Phase increment (freq / sampleRate)
   * @returns {number} Correction value
   */
  function polyBlep(t, dt) {
    if (t < dt) {
      t /= dt;
      return t + t - t * t - 1;
    } else if (t > 1 - dt) {
      t = (t - 1) / dt;
      return t * t + t + t + 1;
    }
    return 0;
  }

  /**
   * Generate PolyBLEP-corrected sawtooth sample
   * @param {number} phase - Phase position [0, 1)
   * @param {number} dt - Phase increment
   * @returns {number} Anti-aliased sawtooth sample [-1, 1]
   */
  function polyBlepSaw(phase, dt) {
    let sample = 2 * phase - 1;
    sample -= polyBlep(phase, dt);
    return sample;
  }

  /**
   * Generate PolyBLEP-corrected square wave sample
   * @param {number} phase - Phase position [0, 1)
   * @param {number} dt - Phase increment
   * @returns {number} Anti-aliased square sample [-1, 1]
   */
  function polyBlepSquare(phase, dt) {
    let sample = phase < 0.5 ? 1 : -1;
    sample += polyBlep(phase, dt);
    sample -= polyBlep((phase + 0.5) % 1, dt);
    return sample;
  }

  /**
   * Generate PolyBLEP-corrected pulse wave sample
   * @param {number} phase - Phase position [0, 1)
   * @param {number} dt - Phase increment
   * @param {number} pw - Pulse width [0, 1]
   * @returns {number} Anti-aliased pulse sample [-1, 1]
   */
  function polyBlepPulse(phase, dt, pw) {
    let sample = phase < pw ? 1 : -1;
    sample += polyBlep(phase, dt);
    sample -= polyBlep((phase + (1 - pw)) % 1, dt);
    return sample;
  }

  /**
   * Generate PolyBLEP-corrected triangle wave sample
   * @param {number} phase - Phase position [0, 1)
   * @param {number} dt - Phase increment
   * @returns {number} Anti-aliased triangle sample [-1, 1]
   */
  function polyBlepTriangle(phase, dt) {
    let sample = phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase;
    return sample;
  }

  // ============================================================
  // Pulse Wave (PWM) Generation
  // ============================================================

  /**
   * Create a PeriodicWave for a pulse wave with specified duty cycle
   * @param {AudioContext} ctx - Web Audio context
   * @param {number} pulseWidth - Pulse width as percentage (5-95)
   * @param {number} numHarmonics - Number of harmonics to include
   * @returns {PeriodicWave}
   */
  function createPulseWave(ctx, pulseWidth, numHarmonics) {
    numHarmonics = numHarmonics || 64;
    var key = pulseWidth + '_' + numHarmonics;
    if (_pulseWaveCache[key]) {
      return _pulseWaveCache[key];
    }
    var pw = pulseWidth / 100;

    var real = new Float32Array(numHarmonics + 1);
    var imag = new Float32Array(numHarmonics + 1);

    real[0] = 0;
    imag[0] = 0;

    for (var h = 1; h <= numHarmonics; h++) {
      real[h] = 0;
      imag[h] = (2 / (h * Math.PI)) * Math.sin(h * Math.PI * pw);
    }

    var wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    _pulseWaveCache[key] = wave;
    return wave;
  }

  // Super saw detune offsets in cents (7 voices)
  const SUPERSAW_DETUNES = [-40, -25, -10, 0, 10, 25, 40];

  /**
   * Create multiple detuned sawtooth oscillators for super saw effect
   * @param {AudioContext} ctx - Web Audio context
   * @param {number} freq - Base frequency
   * @param {number} spread - Spread amount (0-100)
   * @param {GainNode} outputNode - Node to connect oscillators to
   * @param {number} level - Overall level (0-1)
   * @returns {OscillatorNode[]} Array of oscillator nodes
   */
  function createSuperSawOscillators(ctx, freq, spread, outputNode, level) {
    const oscillators = [];
    const spreadFactor = spread / 50;
    const voiceGain = level / SUPERSAW_DETUNES.length;

    SUPERSAW_DETUNES.forEach(detuneCents => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      const actualDetune = detuneCents * spreadFactor;
      const voiceFreq = freq * Math.pow(2, actualDetune / 1200);

      osc.type = 'sawtooth';
      osc.frequency.value = voiceFreq;
      gain.gain.value = voiceGain;

      osc.connect(gain);
      gain.connect(outputNode);

      oscillators.push(osc);
    });

    return oscillators;
  }

  // ============================================================
  // Register on SL.audio
  // ============================================================

  SL.audio.sliderToFreq = sliderToFreq;
  SL.audio.freqToSlider = freqToSlider;
  SL.audio.sliderToQ = sliderToQ;
  SL.audio.qToSlider = qToSlider;
  SL.audio.calcKeyTrackedFreq = calcKeyTrackedFreq;
  SL.audio.createFilterChain = createFilterChain;
  SL.audio.createPulseWave = createPulseWave;
  SL.audio.createSuperSawOscillators = createSuperSawOscillators;
  SL.audio.polyBlep = polyBlep;
  SL.audio.polyBlepSaw = polyBlepSaw;
  SL.audio.polyBlepSquare = polyBlepSquare;
  SL.audio.polyBlepPulse = polyBlepPulse;
  SL.audio.polyBlepTriangle = polyBlepTriangle;

  // Expose constants needed by other modules
  SL.audio._SUPERSAW_DETUNES = SUPERSAW_DETUNES;
  SL.audio._createMS20SaturationCurve = createMS20SaturationCurve;

})();
