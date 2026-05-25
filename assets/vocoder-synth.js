// Super Synth Lab - Vocoder Synthesis Engine Module
// 16-band channel vocoder with synthesized vowel formant modulator,
// carrier waveform selection, vowel morphing, and formant shift.
// Real bandpass filter bank per band, proper gain staging.
// v1.1.0 - Fixed: real BPF filters, gain staging, real-time updates, instrument count
(function() {
  'use strict';

  var SL = window.SynthLab;

  // ============================================================
  // Constants
  // ============================================================

  var MAX_VOICES_PER_INSTRUMENT = 16;
  var DEFAULT_BAND_COUNT = 16;
  var NUM_INSTRUMENTS = 4;
  var TWO_PI = 2 * Math.PI;

  // Valid carrier waveform types
  var VALID_CARRIER_WAVEFORMS = { 'saw': 1, 'square': 1, 'noise': 1, 'pulse': 1 };

  // Vowel formant definitions: [F1, F2, F3] frequencies in Hz
  // Based on typical male vocal formant data
  var VOWEL_FORMANTS = {
    A: { freqs: [730, 1090, 2440], amps: [1.0, 0.5, 0.3], bws: [90, 110, 170] },
    E: { freqs: [530, 1840, 2480], amps: [1.0, 0.4, 0.3], bws: [70, 100, 160] },
    I: { freqs: [270, 2290, 3010], amps: [1.0, 0.3, 0.2], bws: [60, 90, 150] },
    O: { freqs: [570, 840, 2410],  amps: [1.0, 0.4, 0.25], bws: [80, 100, 160] },
    U: { freqs: [300, 870, 2240],  amps: [1.0, 0.3, 0.2], bws: [70, 100, 150] }
  };

  var VOWEL_ORDER = ['A', 'E', 'I', 'O', 'U'];

  /** Default vocoder synth settings for a new instrument */
  var DEFAULT_VOCODER_SYNTH_SETTINGS = {
    carrierWaveform: 'saw',      // 'saw', 'square', 'noise', 'pulse'
    vowel: 'A',                  // current vowel target
    morphPosition: 0,            // 0-100 morph between vowels (0=vowel, 100=next vowel)
    bandCount: 16,               // 8, 16, or 32
    formantShift: 0,             // semitones shift (-12 to +12)
    filterQ: 8                   // filter Q for band filters (1-30)
  };

  // ============================================================
  // State
  // ============================================================

  var audioContext = null;
  var isEngineReady = false;

  // Per-instrument settings cache (instId -> settings object)
  var instrumentSettings = {};

  // Per-instrument voice state (instId -> array of voice objects)
  var voicesByInst = [[], [], [], []];

  // Per-instrument filter nodes (instId -> BiquadFilterNode)
  var vocoderFilterNodes = {};

  // Per-instrument output gain nodes (instId -> GainNode)
  var vocoderOutputNodes = {};

  // Track which instruments have been connected
  var connectedInsts = [false, false, false, false];

  // ============================================================
  // MIDI / Frequency Helpers
  // ============================================================

  function midiToFreq(midi) {
    var a4 = 440;
    var refEl = typeof document !== 'undefined' && document.getElementById('refHz');
    if (refEl) {
      a4 = parseFloat(refEl.value) || 440;
    }
    if (SL.tuning && SL.tuning.noteToFreq) {
      return SL.tuning.noteToFreq(midi, a4);
    }
    return a4 * Math.pow(2, (midi - 69) / 12);
  }

  // ============================================================
  // Formant Interpolation
  // ============================================================

  /**
   * Get interpolated formant data based on vowel and morph position
   * @param {string} vowel - base vowel (A, E, I, O, U)
   * @param {number} morphPos - 0-100 morph to next vowel
   * @param {number} formantShift - semitone shift
   * @returns {Object} { freqs: [f1,f2,f3], amps: [a1,a2,a3], bws: [b1,b2,b3] }
   */
  function getInterpolatedFormants(vowel, morphPos, formantShift) {
    var vowelIdx = VOWEL_ORDER.indexOf(vowel);
    if (vowelIdx < 0) {
      vowelIdx = 0;
    }
    var nextIdx = (vowelIdx + 1) % VOWEL_ORDER.length;
    var baseFormant = VOWEL_FORMANTS[VOWEL_ORDER[vowelIdx]];
    var nextFormant = VOWEL_FORMANTS[VOWEL_ORDER[nextIdx]];
    var t = morphPos / 100;

    var shiftRatio = Math.pow(2, formantShift / 12);

    var freqs = [];
    var amps = [];
    var bws = [];
    for (var i = 0; i < 3; i++) {
      freqs.push((baseFormant.freqs[i] * (1 - t) + nextFormant.freqs[i] * t) * shiftRatio);
      amps.push(baseFormant.amps[i] * (1 - t) + nextFormant.amps[i] * t);
      bws.push(baseFormant.bws[i] * (1 - t) + nextFormant.bws[i] * t);
    }

    return { freqs: freqs, amps: amps, bws: bws };
  }

  /**
   * Compute band center frequencies for a given band count
   * Logarithmically spaced from 80 Hz to 12000 Hz
   * @param {number} numBands - 8, 16, or 32
   * @returns {Float64Array} center frequencies
   */
  function computeBandFrequencies(numBands) {
    var minFreq = 80;
    var maxFreq = 12000;
    var logMin = Math.log(minFreq);
    var logMax = Math.log(maxFreq);
    var step = (logMax - logMin) / (numBands - 1);
    var freqs = new Float64Array(numBands);
    for (var i = 0; i < numBands; i++) {
      freqs[i] = Math.exp(logMin + step * i);
    }
    return freqs;
  }

  /**
   * Compute formant envelope gain for each band
   * Generates an amplitude profile shaped by the vowel formants
   * @param {Float64Array} bandFreqs - center frequencies
   * @param {Object} formants - { freqs, amps, bws }
   * @returns {Float64Array} per-band gains
   */
  function computeFormantEnvelope(bandFreqs, formants) {
    var numBands = bandFreqs.length;
    var gains = new Float64Array(numBands);

    for (var b = 0; b < numBands; b++) {
      var totalGain = 0.05; // base floor to let some signal through
      for (var f = 0; f < formants.freqs.length; f++) {
        var centerFreq = formants.freqs[f];
        var amp = formants.amps[f];
        var bw = formants.bws[f];
        // Gaussian-like resonance around each formant
        var diff = bandFreqs[b] - centerFreq;
        var gaussian = Math.exp(-(diff * diff) / (2 * bw * bw));
        totalGain += amp * gaussian;
      }
      if (totalGain > 1.0) {
        totalGain = 1.0;
      }
      gains[b] = totalGain;
    }

    return gains;
  }

  // ============================================================
  // Resonant Bandpass Filter (2nd-order biquad, direct form II)
  // Same proven filter class used in formant-engine.js
  // ============================================================

  function BiquadBPF() {
    this.b0 = 0; this.b1 = 0; this.b2 = 0;
    this.a1 = 0; this.a2 = 0;
    this.z1 = 0; this.z2 = 0;
  }

  /**
   * Set bandpass filter coefficients.
   * @param {number} freq - center frequency (Hz)
   * @param {number} bw - bandwidth (Hz)
   * @param {number} sr - sample rate
   */
  BiquadBPF.prototype.set = function(freq, bw, sr) {
    // Clamp frequency to Nyquist - margin
    var nyq = sr * 0.499;
    if (freq > nyq) { freq = nyq; }
    if (freq < 20) { freq = 20; }
    if (bw < 10) { bw = 10; }

    var w0 = TWO_PI * freq / sr;
    var cosW0 = Math.cos(w0);
    var sinW0 = Math.sin(w0);
    var alpha = sinW0 * Math.sinh(Math.log(2) / 2 * (bw / freq) * (w0 / sinW0));

    var a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.b1 = 0;
    this.b2 = -alpha / a0;
    this.a1 = -2 * cosW0 / a0;
    this.a2 = (1 - alpha) / a0;
  };

  BiquadBPF.prototype.process = function(input) {
    var out = this.b0 * input + this.z1;
    this.z1 = this.b1 * input - this.a1 * out + this.z2;
    this.z2 = this.b2 * input - this.a2 * out;
    return out;
  };

  BiquadBPF.prototype.reset = function() {
    this.z1 = 0;
    this.z2 = 0;
  };

  // ============================================================
  // Vocoder Voice
  // ============================================================

  function VocoderVoice(sr) {
    this.sampleRate = sr;
    this.active = false;
    this.midiNote = -1;
    this.instId = 0;
    this.baseFreq = 440;
    this.velocity = 1.0;

    // ADSR envelope state
    this.envStage = 0;  // 0=attack, 1=decay, 2=sustain, 3=release
    this.envLevel = 0;
    this.envReleased = false;
    this.envFinished = false;
    this.attackRate = 0;
    this.decayRate = 0;
    this.sustainLevel = 0.7;
    this.releaseRate = 0;

    // Carrier oscillator state
    this.carrierPhase = 0;
    this.carrierWaveform = 'saw';
    this.pulseWidth = 0.5;

    // Band filter state
    this.numBands = DEFAULT_BAND_COUNT;
    this.bandFreqs = null;
    this.formantGains = null;

    // Per-band real bandpass filters
    this.bandFilters = [];

    // Fade-in ramp
    this.fadeInSamples = 0;
    this.fadeInCounter = 0;

    // Per-voice timing stagger (humanization)
    this.startDelaySamples = 0;
  }

  /**
   * Initialize or reinitialize the per-band bandpass filter bank.
   * @param {number} numBands - number of bands
   * @param {Float64Array} bandFreqs - center frequencies per band
   * @param {number} filterQ - Q factor for bandwidth calculation
   */
  VocoderVoice.prototype.initFilterBank = function(numBands, bandFreqs, filterQ) {
    this.bandFilters = [];
    for (var b = 0; b < numBands; b++) {
      var filter = new BiquadBPF();
      // Bandwidth derived from Q: bw = freq / Q
      var bw = bandFreqs[b] / filterQ;
      filter.set(bandFreqs[b], bw, this.sampleRate);
      filter.reset();
      this.bandFilters.push(filter);
    }
  };

  /**
   * Update filter bank frequencies and Q (for real-time parameter changes).
   * @param {Float64Array} bandFreqs - center frequencies per band
   * @param {number} filterQ - Q factor
   */
  VocoderVoice.prototype.updateFilterBank = function(bandFreqs, filterQ) {
    for (var b = 0; b < this.bandFilters.length; b++) {
      var bw = bandFreqs[b] / filterQ;
      this.bandFilters[b].set(bandFreqs[b], bw, this.sampleRate);
    }
  };

  /**
   * Update formant gains from current settings (for real-time updates).
   * @param {Float64Array} gains - per-band gains
   */
  VocoderVoice.prototype.updateFormantGains = function(gains) {
    this.formantGains = gains;
  };

  VocoderVoice.prototype.noteOn = function(midi, vel, freq, settings) {
    this.active = true;
    this.midiNote = midi;
    this.baseFreq = freq;
    this.instId = settings.instId || 0;
    this.envStage = 0;
    this.envLevel = 0;
    this.envReleased = false;
    this.envFinished = false;
    this.carrierPhase = 0;

    // Velocity with humanization
    var humVelocity = settings.humVelocity || 0;
    var velRange = Math.round(humVelocity * 1.2);
    var randomizedVel = vel;
    if (velRange > 0) {
      randomizedVel = vel + Math.round((Math.random() * 2 - 1) * velRange);
      if (randomizedVel < 1) { randomizedVel = 1; }
      if (randomizedVel > 127) { randomizedVel = 127; }
    }
    this.velocity = randomizedVel / 127;

    // Fade-in
    this.fadeInSamples = Math.ceil(this.sampleRate * 0.008);
    this.fadeInCounter = 0;

    // Per-voice timing stagger
    var humTiming = settings.humTiming || 0;
    if (humTiming > 0) {
      var maxDelay = Math.round(humTiming * 0.15 * this.sampleRate / 1000);
      this.startDelaySamples = Math.round(Math.random() * maxDelay);
    } else {
      this.startDelaySamples = 0;
    }

    // ADSR
    var adsr = settings.adsr || { a: 0.01, d: 0.1, s: 0.7, r: 0.2 };
    var humAdsr = settings.humAdsr || 0;
    var aTime = adsr.a;
    var dTime = adsr.d;
    var sLevel = adsr.s;
    var rTime = adsr.r;

    if (humAdsr > 0) {
      var jA = 1 + (Math.random() * 2 - 1) * humAdsr * 0.015;
      var jD = 1 + (Math.random() * 2 - 1) * humAdsr * 0.015;
      var jR = 1 + (Math.random() * 2 - 1) * humAdsr * 0.015;
      aTime = Math.max(0.001, aTime * jA);
      dTime = Math.max(0.001, dTime * jD);
      rTime = Math.max(0.001, rTime * jR);
    }

    this.attackRate = 1.0 / (aTime * this.sampleRate);
    this.decayRate = 1.0 / (dTime * this.sampleRate);
    this.sustainLevel = sLevel;
    this.releaseRate = 1.0 / (rTime * this.sampleRate);

    // Vocoder parameters
    var vocSettings = settings.vocoderSynthSettings || DEFAULT_VOCODER_SYNTH_SETTINGS;
    this.carrierWaveform = vocSettings.carrierWaveform || 'saw';
    this.numBands = vocSettings.bandCount || DEFAULT_BAND_COUNT;
    var filterQ = vocSettings.filterQ || 8;

    // Compute band frequencies
    this.bandFreqs = computeBandFrequencies(this.numBands);

    // Compute formant envelope for current vowel/morph
    var formants = getInterpolatedFormants(
      vocSettings.vowel || 'A',
      vocSettings.morphPosition || 0,
      vocSettings.formantShift || 0
    );
    this.formantGains = computeFormantEnvelope(this.bandFreqs, formants);

    // Initialize real bandpass filter bank
    this.initFilterBank(this.numBands, this.bandFreqs, filterQ);
  };

  VocoderVoice.prototype.noteOff = function() {
    if (!this.envFinished) {
      this.envReleased = true;
      this.envStage = 3;
    }
  };

  VocoderVoice.prototype.processEnvelope = function() {
    if (this.envFinished) {
      return 0;
    }

    if (this.envStage === 0) {
      this.envLevel += this.attackRate;
      if (this.envLevel >= 1.0) {
        this.envLevel = 1.0;
        this.envStage = 1;
      }
    } else if (this.envStage === 1) {
      this.envLevel -= this.decayRate * (1.0 - this.sustainLevel);
      if (this.envLevel <= this.sustainLevel) {
        this.envLevel = this.sustainLevel;
        this.envStage = 2;
      }
    } else if (this.envStage === 2) {
      // Sustain (hold level)
    } else if (this.envStage === 3) {
      this.envLevel -= this.releaseRate * this.envLevel;
      if (this.envLevel <= 0.0001) {
        this.envLevel = 0;
        this.envFinished = true;
      }
    }

    return this.envLevel;
  };

  /**
   * Generate one sample of the carrier waveform
   */
  VocoderVoice.prototype.generateCarrier = function() {
    var phase = this.carrierPhase;
    var sample = 0;

    if (this.carrierWaveform === 'saw') {
      sample = 2.0 * phase - 1.0;
    } else if (this.carrierWaveform === 'square') {
      if (phase < 0.5) {
        sample = 1.0;
      } else {
        sample = -1.0;
      }
    } else if (this.carrierWaveform === 'noise') {
      sample = Math.random() * 2 - 1;
    } else if (this.carrierWaveform === 'pulse') {
      if (phase < 0.25) {
        sample = 1.0;
      } else {
        sample = -1.0;
      }
    } else {
      // default to saw
      sample = 2.0 * phase - 1.0;
    }

    // Advance phase
    this.carrierPhase += this.baseFreq / this.sampleRate;
    if (this.carrierPhase >= 1.0) {
      this.carrierPhase -= Math.floor(this.carrierPhase);
    }

    return sample;
  };

  VocoderVoice.prototype.process = function() {
    if (!this.active) {
      return 0;
    }

    // Per-voice timing stagger
    if (this.startDelaySamples > 0) {
      this.startDelaySamples--;
      return 0;
    }

    var env = this.processEnvelope();
    if (this.envFinished) {
      this.active = false;
      return 0;
    }

    // Generate carrier
    var carrier = this.generateCarrier();

    // Channel vocoder: pass carrier through each bandpass filter,
    // then scale by the formant-derived gain for that band.
    var output = 0;
    var nyquist = this.sampleRate / 2;

    for (var b = 0; b < this.numBands; b++) {
      if (this.bandFreqs[b] >= nyquist) {
        continue;
      }
      // Run carrier through real bandpass filter for this band
      var filtered = this.bandFilters[b].process(carrier);
      // Scale by formant envelope gain
      output += filtered * this.formantGains[b];
    }

    // Normalize: bandpass filters are narrow so energy is distributed.
    // Audio validation showed previous 0.5/sqrt(N) was 30dB too quiet.
    // Using 2.0/sqrt(N) brings output to expected performance level
    // while master brickwall limiter handles any transient overshoot.
    var BAND_NORMALIZATION_FACTOR = 2.0;
    var bandNormalization = BAND_NORMALIZATION_FACTOR / Math.sqrt(this.numBands);
    output *= bandNormalization;

    output *= env * this.velocity;

    // Apply fade-in ramp
    if (this.fadeInCounter < this.fadeInSamples) {
      output *= this.fadeInCounter / this.fadeInSamples;
      this.fadeInCounter++;
    }

    return output;
  };

  VocoderVoice.prototype.isFinished = function() {
    return this.envFinished;
  };

  // ============================================================
  // Engine Initialization
  // ============================================================

  function init(ctx) {
    audioContext = ctx || (SL.audio && SL.audio.getCtx ? SL.audio.getCtx() : null);
    if (!audioContext) {
      console.error('[VOCODER_SYNTH] No AudioContext available');
      return Promise.reject(new Error('No AudioContext'));
    }

    return initFallback();
  }

  function initFallback() {
    var sr = audioContext.sampleRate;
    var bufSize = (SL.audio && SL.audio.getScriptProcessorBufferSize) ? SL.audio.getScriptProcessorBufferSize() : 1024;

    // Pre-allocate per-instrument voice pools (4 instruments, matching formant-engine)
    for (var i = 0; i < NUM_INSTRUMENTS; i++) {
      voicesByInst[i].length = 0;
      for (var v = 0; v < MAX_VOICES_PER_INSTRUMENT; v++) {
        voicesByInst[i].push(new VocoderVoice(sr));
      }

      // Create output gain node per instrument
      vocoderOutputNodes[i] = audioContext.createGain();
      vocoderOutputNodes[i].gain.value = 0.9;
    }

    // Create per-instrument ScriptProcessor nodes
    for (var idx = 0; idx < NUM_INSTRUMENTS; idx++) {
      (function(instIdx) {
        var node = audioContext.createScriptProcessor(bufSize, 0, 1);
        var voices = voicesByInst[instIdx];
        node.onaudioprocess = function(event) {
          var output = event.outputBuffer.getChannelData(0);

          // Real-time parameter updates: read current settings every buffer
          var vocSettings = getOrCreateSettings(instIdx);
          var formants = getInterpolatedFormants(
            vocSettings.vowel || 'A',
            vocSettings.morphPosition || 0,
            vocSettings.formantShift || 0
          );
          var bandCount = vocSettings.bandCount || DEFAULT_BAND_COUNT;
          var filterQ = vocSettings.filterQ || 8;
          var bandFreqs = computeBandFrequencies(bandCount);
          var formantGains = computeFormantEnvelope(bandFreqs, formants);

          // Update active voices with current formant gains and filter params
          for (var vi = 0; vi < voices.length; vi++) {
            if (voices[vi].active && voices[vi].numBands === bandCount) {
              voices[vi].updateFormantGains(formantGains);
              voices[vi].updateFilterBank(bandFreqs, filterQ);
              voices[vi].carrierWaveform = vocSettings.carrierWaveform || 'saw';
            }
          }

          // Per-voice mix factor: formant-engine uses 0.75, vocoder uses
          // a similar level since gain staging is now proper
          var PER_VOICE_MIX = 0.4;
          for (var s = 0; s < output.length; s++) {
            var sampleOut = 0;
            for (var vi2 = 0; vi2 < voices.length; vi2++) {
              if (voices[vi2].active) {
                sampleOut += voices[vi2].process() * PER_VOICE_MIX;
              }
            }
            // Soft clip (Pade approximant of tanh)
            var ss = sampleOut * sampleOut;
            output[s] = sampleOut * (27 + ss) / (27 + 9 * ss);
          }
        };

        // Connect ScriptProcessor -> output gain
        node.connect(vocoderOutputNodes[instIdx]);
      })(idx);
    }

    isEngineReady = true;
    return Promise.resolve(true);
  }

  // ============================================================
  // Connection Management
  // ============================================================

  function getOrCreateFilterNode(instId) {
    if (!audioContext) {
      return null;
    }
    if (!vocoderFilterNodes[instId]) {
      var node = audioContext.createBiquadFilter();
      node.type = 'lowpass';
      node.frequency.value = 20000;
      node.Q.value = 0.707;
      vocoderFilterNodes[instId] = node;
    }
    return vocoderFilterNodes[instId];
  }

  function updateFilter(instId) {
    if (instId === undefined) {
      instId = 0;
    }
    var filterNode = vocoderFilterNodes[instId];
    if (filterNode) {
      var filterSettings = SL.audio && SL.audio.getFilterSettings ? SL.audio.getFilterSettings() : null;
      if (!filterSettings || !filterSettings.enabled) {
        filterNode.type = 'lowpass';
        filterNode.frequency.value = 20000;
        filterNode.Q.value = 0.707;
      } else {
        filterNode.type = filterSettings.type || 'lowpass';
        filterNode.frequency.value = Math.max(20, Math.min(20000, filterSettings.frequency || 20000));
        filterNode.Q.value = Math.max(0.1, Math.min(30, filterSettings.resonance || 1));
      }
    }
  }

  function connectToOutput(instId) {
    // If output node not created yet (engine not initialized), skip
    if (vocoderOutputNodes[instId]) {
      if (connectedInsts[instId]) {
        updateFilter(instId);
      } else {
        var instruments = SL.audio && SL.audio.getInstruments ? SL.audio.getInstruments() : null;
        var inst = instruments ? instruments[instId] : null;
        var destination;

        if (inst && inst.masterOutput) {
          destination = inst.masterOutput;
        } else if (audioContext) {
          destination = audioContext.destination;
        }

        if (destination) {
          var filterNode = getOrCreateFilterNode(instId);
          updateFilter(instId);

          if (filterNode) {
            vocoderOutputNodes[instId].connect(filterNode);
            filterNode.connect(destination);
          } else {
            vocoderOutputNodes[instId].connect(destination);
          }

          connectedInsts[instId] = true;
        }
      }
    }
  }

  // ============================================================
  // Settings Management
  // ============================================================

  function getOrCreateSettings(instId) {
    if (!instrumentSettings[instId]) {
      instrumentSettings[instId] = JSON.parse(JSON.stringify(DEFAULT_VOCODER_SYNTH_SETTINGS));
    }
    return instrumentSettings[instId];
  }

  // ============================================================
  // Note On / Off
  // ============================================================

  function noteOn(midi, velocity, instId) {
    if (instId === undefined) {
      instId = 0;
    }
    velocity = velocity || 100;

    var settings = getOrCreateSettings(instId);
    var noteFreq = midiToFreq(midi);

    // Ensure connected to correct instrument output
    connectToOutput(instId);

    // Read humanization amounts
    var instruments = SL.audio.getInstruments();
    var rawHum = (instruments && instruments[instId]) ? (instruments[instId].settings.humanization || {}) : {};
    var humVelocity = (typeof rawHum === 'number') ? rawHum : (rawHum.velocity || 0);
    var humAdsr = (typeof rawHum === 'number') ? rawHum : (rawHum.adsr || 0);
    var humTiming = (typeof rawHum === 'number') ? 0 : (rawHum.timing || 0);

    // Get ADSR from instrument settings
    var instSettings = instruments[instId].settings;
    var adsrRaw = instSettings.adsr || { a: 10, d: 100, s: 70, r: 200 };
    var sliderToTime = SL.audio.sliderToTime;
    var adsr = {
      a: sliderToTime(adsrRaw.a, 500, 500) / 1000,
      d: sliderToTime(adsrRaw.d, 500, 500) / 1000,
      s: adsrRaw.s / 100,
      r: sliderToTime(adsrRaw.r, 1000, 1000) / 1000
    };

    var voiceSettings = {
      instId: instId,
      adsr: adsr,
      humVelocity: humVelocity,
      humAdsr: humAdsr,
      humTiming: humTiming,
      vocoderSynthSettings: settings
    };

    // Find free voice or steal oldest
    var voices = voicesByInst[instId];
    var voice = null;
    for (var i = 0; i < voices.length; i++) {
      if (!voices[i].active) {
        voice = voices[i];
        break;
      }
    }
    if (!voice) {
      voice = voices[0]; // steal oldest
    }
    voice.noteOn(midi, velocity, noteFreq, voiceSettings);
  }

  function noteOff(midi, instId) {
    if (instId === undefined) {
      instId = 0;
    }

    var voices = voicesByInst[instId];
    for (var i = 0; i < voices.length; i++) {
      var v = voices[i];
      if (v.active && v.midiNote === midi) {
        v.noteOff();
      }
    }
  }

  // ============================================================
  // Parameter Control
  // ============================================================

  function setCarrierWaveform(instId, waveform) {
    var settings = getOrCreateSettings(instId);
    if (VALID_CARRIER_WAVEFORMS[waveform]) {
      settings.carrierWaveform = waveform;
    }
  }

  function setVowel(instId, vowel) {
    var settings = getOrCreateSettings(instId);
    if (VOWEL_ORDER.indexOf(vowel) >= 0) {
      settings.vowel = vowel;
    }
  }

  function setMorphPosition(instId, position) {
    var settings = getOrCreateSettings(instId);
    settings.morphPosition = Math.max(0, Math.min(100, position));
  }

  function setBandCount(instId, count) {
    var settings = getOrCreateSettings(instId);
    var isValidBandCount = count === 8 || count === 16 || count === 32;
    if (isValidBandCount) {
      settings.bandCount = count;
    }
  }

  function setFormantShift(instId, shift) {
    var settings = getOrCreateSettings(instId);
    settings.formantShift = Math.max(-12, Math.min(12, shift));
  }

  function setFilterQ(instId, q) {
    var settings = getOrCreateSettings(instId);
    settings.filterQ = Math.max(1, Math.min(30, q));
  }

  function getSettings(instId) {
    return JSON.parse(JSON.stringify(getOrCreateSettings(instId)));
  }

  function setSettings(instId, settings) {
    instrumentSettings[instId] = JSON.parse(JSON.stringify(settings));
  }

  // ============================================================
  // Utility
  // ============================================================

  function allNotesOff(instId) {
    if (instId !== undefined) {
      var voices = voicesByInst[instId];
      for (var i = 0; i < voices.length; i++) {
        if (voices[i].active) {
          voices[i].noteOff();
        }
      }
    } else {
      for (var idx = 0; idx < NUM_INSTRUMENTS; idx++) {
        var pool = voicesByInst[idx];
        for (var j = 0; j < pool.length; j++) {
          if (pool[j].active) {
            pool[j].noteOff();
          }
        }
      }
    }
  }

  function isReady() {
    return isEngineReady;
  }

  function getDefaultSettings() {
    return JSON.parse(JSON.stringify(DEFAULT_VOCODER_SYNTH_SETTINGS));
  }

  // ============================================================
  // Export to SynthLab Namespace
  // ============================================================

  SL.vocoderSynth = {
    // Initialization
    init: init,
    isReady: isReady,

    // Note control
    noteOn: noteOn,
    noteOff: noteOff,
    allNotesOff: allNotesOff,

    // Parameter control
    setCarrierWaveform: setCarrierWaveform,
    setVowel: setVowel,
    setMorphPosition: setMorphPosition,
    setBandCount: setBandCount,
    setFormantShift: setFormantShift,
    setFilterQ: setFilterQ,

    // Settings management
    getSettings: getSettings,
    setSettings: setSettings,
    getDefaultSettings: getDefaultSettings,

    // Connection & filter
    connectToOutput: connectToOutput,
    updateFilter: updateFilter,

    // Constants
    DEFAULT_VOCODER_SYNTH_SETTINGS: DEFAULT_VOCODER_SYNTH_SETTINGS,
    MAX_VOICES_PER_INSTRUMENT: MAX_VOICES_PER_INSTRUMENT,
    VOWEL_ORDER: VOWEL_ORDER
  };

})();
