// Super Synth Lab - Wavefolder Synthesis Engine Module
// West Coast synthesis (Buchla tradition) - nonlinear wavefolding
// v1.0.0 - ScriptProcessor fallback, 4x oversampling, ADSR on fold amount
(function() {
  'use strict';

  var SL = window.SynthLab;

  // ============================================================
  // Constants
  // ============================================================

  var MAX_VOICES_PER_INSTRUMENT = 16;
  var OVERSAMPLE_FACTOR = 4;
  var TWO_PI = 2 * Math.PI;

  /** Default wavefolder settings for a new instrument */
  var DEFAULT_WAVEFOLDER_SETTINGS = {
    source: 'sine',
    foldAmount: 4,
    symmetry: 50,
    bias: 0,
    preGain: 1.0
  };

  // ============================================================
  // State
  // ============================================================

  var audioContext = null;

  // ScriptProcessor fallback state
  var scriptNodes = [null, null, null, null];
  var fallbackVoicesByInst = [[], [], [], []];
  var engineReady = false;

  // Per-instrument settings cache (instId -> settings object)
  var instrumentSettings = {};

  // Per-instrument filter nodes (instId -> BiquadFilterNode)
  var wavfolderFilterNodes = {};

  // Track which instruments have been permanently connected
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
  // Waveform Generation
  // ============================================================

  /**
   * Generate a single sample of the source waveform
   * @param {string} type - 'sine', 'triangle', 'saw', 'square'
   * @param {number} phase - 0..1
   * @returns {number} sample value -1..1
   */
  function generateSourceSample(type, phase) {
    if (type === 'sine') {
      return Math.sin(TWO_PI * phase);
    } else if (type === 'triangle') {
      if (phase < 0.25) {
        return 4.0 * phase;
      } else if (phase < 0.75) {
        return 2.0 - 4.0 * phase;
      } else {
        return -4.0 + 4.0 * phase;
      }
    } else if (type === 'saw') {
      return 2.0 * phase - 1.0;
    } else if (type === 'square') {
      if (phase < 0.5) {
        return 1.0;
      } else {
        return -1.0;
      }
    }
    return Math.sin(TWO_PI * phase);
  }

  /**
   * Apply nonlinear wavefolding with symmetry and bias
   * @param {number} input - input sample
   * @param {number} foldAmount - fold multiplier (1..16)
   * @param {number} symmetry - 0..1 (0.5 = symmetric)
   * @param {number} bias - DC offset before folding
   * @returns {number} folded sample
   */
  function wavefold(input, foldAmount, symmetry, bias) {
    // Apply bias (shifts the folding point)
    var biased = input + bias;

    // Apply fold amount as a gain multiplier
    var driven = biased * foldAmount;

    // Asymmetric folding: blend even and odd harmonics
    // symmetry 0.5 = pure odd harmonics (symmetric), 0 or 1 = even harmonics added
    var symFactor = (symmetry - 0.5) * 2.0; // -1..1

    // Core fold function: sin(x) creates smooth periodic folding
    var folded = Math.sin(driven);

    // Add asymmetry by mixing in sin(2x) weighted by symmetry offset
    if (symFactor !== 0) {
      var evenComponent = Math.sin(driven * 2.0) * Math.abs(symFactor) * 0.5;
      folded = folded + evenComponent;
      // Soft clip to prevent exceeding -1..1
      if (folded > 1.0) {
        folded = 1.0;
      } else if (folded < -1.0) {
        folded = -1.0;
      }
    }

    return folded;
  }

  // ============================================================
  // Simple 2x Oversampling Filter (FIR half-band)
  // ============================================================

  // Half-band filter coefficients for anti-aliasing decimation
  var HALF_BAND_COEFFS = [0.07, 0.25, 0.36, 0.25, 0.07];

  /**
   * Decimate 4x oversampled buffer to 1x using simple averaging
   * (Fast approximation of proper anti-alias filtering)
   * @param {Float64Array} oversampledBuf - 4x oversampled buffer
   * @param {number} outputLen - target output length
   * @returns {Float64Array}
   */
  function decimate4x(oversampledBuf, outputLen) {
    var result = new Float64Array(outputLen);
    for (var i = 0; i < outputLen; i++) {
      var base = i * OVERSAMPLE_FACTOR;
      // Simple averaging decimation (low-pass by nature)
      result[i] = (oversampledBuf[base] + oversampledBuf[base + 1] + oversampledBuf[base + 2] + oversampledBuf[base + 3]) * 0.25;
    }
    return result;
  }

  // ============================================================
  // Fallback Voice (ScriptProcessor - main thread synthesis)
  // ============================================================

  function WavefolderVoice(sr) {
    this.sampleRate = sr;
    this.oversampleRate = sr * OVERSAMPLE_FACTOR;
    this.active = false;
    this.midiNote = -1;
    this.instId = 0;
    this.baseFreq = 440;
    this.velocity = 1.0;

    // Source oscillator phase
    this.phase = 0;
    this.phaseInc = 0;

    // Wavefolder parameters
    this.source = 'sine';
    this.foldAmount = 4;
    this.symmetry = 0.5;
    this.bias = 0;
    this.preGain = 1.0;

    // ADSR envelope state (amplitude)
    this.envStage = 0;  // 0=attack, 1=decay, 2=sustain, 3=release
    this.envLevel = 0;
    this.envReleased = false;
    this.envFinished = false;
    this.attackRate = 0;
    this.decayRate = 0;
    this.sustainLevel = 0.7;
    this.releaseRate = 0;

    // ADSR envelope for fold amount modulation
    this.foldEnvStage = 0;
    this.foldEnvLevel = 0;
    this.foldEnvReleased = false;
    this.foldAttackRate = 0;
    this.foldDecayRate = 0;
    this.foldSustainLevel = 0.5;
    this.foldReleaseRate = 0;
    this.foldEnvAmount = 0; // How much envelope modulates fold amount

    // Fade-in ramp to prevent click/pop at note onset
    this.fadeInSamples = 0;
    this.fadeInCounter = 0;

    // Per-voice timing stagger (humanization)
    this.startDelaySamples = 0;
  }

  WavefolderVoice.prototype.noteOn = function(midi, vel, freq, settings) {
    this.active = true;
    this.midiNote = midi;
    this.baseFreq = freq;
    this.instId = settings.instId || 0;
    this.envStage = 0;
    this.envLevel = 0;
    this.envReleased = false;
    this.envFinished = false;
    this.phase = 0;
    this.phaseInc = freq / this.sampleRate;

    // Wavefolder parameters from settings
    this.source = settings.source || 'sine';
    this.foldAmount = settings.foldAmount || 4;
    this.symmetry = (settings.symmetry !== undefined ? settings.symmetry : 50) / 100;
    this.bias = (settings.bias !== undefined ? settings.bias : 0) / 100;
    this.preGain = settings.preGain || 1.0;

    // Fold envelope amount (fold amount scaled by envelope)
    // The envelope modulates fold from 1x to foldAmount
    this.foldEnvAmount = this.foldAmount - 1.0;

    // Velocity
    var humVelocity = settings.humVelocity || 0;
    var velRange = Math.round(humVelocity * 1.2);
    var randomizedVel = vel;
    if (velRange > 0) {
      randomizedVel = vel + Math.round((Math.random() * 2 - 1) * velRange);
      if (randomizedVel < 1) { randomizedVel = 1; }
      if (randomizedVel > 127) { randomizedVel = 127; }
    }
    this.velocity = randomizedVel / 127;

    // Short amplitude fade-in (~8ms) to prevent click/pop at onset
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

    // Amplitude ADSR from settings
    var adsr = settings.adsr || { a: 0.01, d: 0.1, s: 0.7, r: 0.2 };
    var humAdsr = settings.humAdsr || 0;
    var aTime = adsr.a;
    var dTime = adsr.d;
    var sLevel = adsr.s;
    var rTime = adsr.r;

    // Apply ADSR humanization
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

    // Fold amount ADSR (mirrors amplitude but can be different)
    // Attack fast, decay slower - timbre evolves from bright to mellow
    this.foldEnvStage = 0;
    this.foldEnvLevel = 0;
    this.foldEnvReleased = false;
    this.foldAttackRate = 1.0 / (Math.max(0.001, aTime * 0.5) * this.sampleRate);
    this.foldDecayRate = 1.0 / (Math.max(0.001, dTime * 2.0) * this.sampleRate);
    this.foldSustainLevel = 0.3;
    this.foldReleaseRate = 1.0 / (Math.max(0.001, rTime * 0.8) * this.sampleRate);
  };

  WavefolderVoice.prototype.noteOff = function() {
    if (!this.envFinished) {
      this.envReleased = true;
      this.envStage = 3;
      this.foldEnvReleased = true;
      this.foldEnvStage = 3;
    }
  };

  WavefolderVoice.prototype.processEnvelope = function() {
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

  WavefolderVoice.prototype.processFoldEnvelope = function() {
    if (this.foldEnvStage === 0) {
      this.foldEnvLevel += this.foldAttackRate;
      if (this.foldEnvLevel >= 1.0) {
        this.foldEnvLevel = 1.0;
        this.foldEnvStage = 1;
      }
    } else if (this.foldEnvStage === 1) {
      this.foldEnvLevel -= this.foldDecayRate * (1.0 - this.foldSustainLevel);
      if (this.foldEnvLevel <= this.foldSustainLevel) {
        this.foldEnvLevel = this.foldSustainLevel;
        this.foldEnvStage = 2;
      }
    } else if (this.foldEnvStage === 2) {
      // Sustain
    } else if (this.foldEnvStage === 3) {
      this.foldEnvLevel -= this.foldReleaseRate * this.foldEnvLevel;
      if (this.foldEnvLevel <= 0.0001) {
        this.foldEnvLevel = 0;
      }
    }

    return this.foldEnvLevel;
  };

  WavefolderVoice.prototype.process = function() {
    if (!this.active) {
      return 0;
    }

    // Per-voice timing stagger: output silence during delay period
    if (this.startDelaySamples > 0) {
      this.startDelaySamples--;
      return 0;
    }

    var env = this.processEnvelope();
    if (this.envFinished) {
      this.active = false;
      return 0;
    }

    var foldEnv = this.processFoldEnvelope();

    // Compute dynamic fold amount from envelope
    var dynamicFold = 1.0 + this.foldEnvAmount * foldEnv;

    // Generate source waveform at base rate (no oversampling for source)
    var srcSample = generateSourceSample(this.source, this.phase);

    // Apply pre-gain
    srcSample = srcSample * this.preGain;

    // Apply wavefolding
    var folded = wavefold(srcSample, dynamicFold, this.symmetry, this.bias);

    // Advance phase
    this.phase += this.phaseInc;
    if (this.phase >= 1.0) {
      this.phase -= Math.floor(this.phase);
    }

    var sample = folded * env * this.velocity;

    // Apply fade-in ramp
    if (this.fadeInCounter < this.fadeInSamples) {
      sample *= this.fadeInCounter / this.fadeInSamples;
      this.fadeInCounter++;
    }

    return sample;
  };

  WavefolderVoice.prototype.isFinished = function() {
    return this.envFinished;
  };

  // ============================================================
  // Engine Initialization
  // ============================================================

  function init(ctx) {
    audioContext = ctx || (SL.audio && SL.audio.getCtx ? SL.audio.getCtx() : null);
    if (!audioContext) {
      console.error('[WAVEFOLDER] No AudioContext available');
      return Promise.reject(new Error('No AudioContext'));
    }

    return initFallback();
  }

  function initFallback() {
    var sr = audioContext.sampleRate;
    var bufSize = (SL.audio && SL.audio.getScriptProcessorBufferSize) ? SL.audio.getScriptProcessorBufferSize() : 1024;

    // Pre-allocate per-instrument voice pools (16 voices each)
    for (var i = 0; i < 4; i++) {
      fallbackVoicesByInst[i] = [];
      for (var v = 0; v < MAX_VOICES_PER_INSTRUMENT; v++) {
        fallbackVoicesByInst[i].push(new WavefolderVoice(sr));
      }
    }

    // Create 4 per-instrument ScriptProcessor nodes
    for (var idx = 0; idx < 4; idx++) {
      (function(instIdx) {
        var node = audioContext.createScriptProcessor(bufSize, 0, 1);
        var voices = fallbackVoicesByInst[instIdx];
        node.onaudioprocess = function(event) {
          var output = event.outputBuffer.getChannelData(0);
          for (var s = 0; s < output.length; s++) {
            var sample = 0;
            for (var vi = 0; vi < voices.length; vi++) {
              if (voices[vi].active) {
                sample += voices[vi].process() * 0.12;
              }
            }
            // Smooth Pade approximant of tanh soft clip
            var ss = sample * sample;
            output[s] = sample * (27 + ss) / (27 + 9 * ss);
          }
        };
        scriptNodes[instIdx] = node;
      })(idx);
    }

    engineReady = true;
    return Promise.resolve(true);
  }

  // ============================================================
  // Connection Management
  // ============================================================

  function getOrCreateFilterNode(instId) {
    if (!audioContext) {
      return null;
    }
    if (!wavfolderFilterNodes[instId]) {
      var node = audioContext.createBiquadFilter();
      node.type = 'lowpass';
      node.frequency.value = 20000;
      node.Q.value = 0.707;
      wavfolderFilterNodes[instId] = node;
    }
    return wavfolderFilterNodes[instId];
  }

  function updateFilter(instId) {
    if (instId === undefined) {
      instId = 0;
    }
    var filterNode = wavfolderFilterNodes[instId];
    if (!filterNode) {
      return;
    }

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

  function connectToOutput(instId) {
    if (!scriptNodes[instId]) {
      return;
    }

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
      } else {
        return;
      }

      var filterNode = getOrCreateFilterNode(instId);
      updateFilter(instId);

      if (filterNode) {
        scriptNodes[instId].connect(filterNode);
        filterNode.connect(destination);
      } else {
        scriptNodes[instId].connect(destination);
      }

      connectedInsts[instId] = true;
    }
  }

  // ============================================================
  // Settings Management
  // ============================================================

  function getOrCreateSettings(instId) {
    if (!instrumentSettings[instId]) {
      instrumentSettings[instId] = JSON.parse(JSON.stringify(DEFAULT_WAVEFOLDER_SETTINGS));
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
      source: settings.source,
      foldAmount: settings.foldAmount,
      symmetry: settings.symmetry,
      bias: settings.bias,
      preGain: settings.preGain,
      adsr: adsr,
      humVelocity: humVelocity,
      humAdsr: humAdsr,
      humTiming: humTiming
    };

    // Find free voice or steal oldest
    var voices = fallbackVoicesByInst[instId];
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

    var voices = fallbackVoicesByInst[instId];
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

  function setFoldAmount(instId, amount) {
    var settings = getOrCreateSettings(instId);
    settings.foldAmount = Math.max(1, Math.min(16, amount));
  }

  function setSymmetry(instId, symmetry) {
    var settings = getOrCreateSettings(instId);
    settings.symmetry = Math.max(0, Math.min(100, symmetry));
  }

  function setBias(instId, bias) {
    var settings = getOrCreateSettings(instId);
    settings.bias = Math.max(-100, Math.min(100, bias));
  }

  function setPreGain(instId, gain) {
    var settings = getOrCreateSettings(instId);
    settings.preGain = Math.max(0.1, Math.min(10, gain));
  }

  function setSource(instId, source) {
    var settings = getOrCreateSettings(instId);
    if (source === 'sine' || source === 'triangle' || source === 'saw' || source === 'square') {
      settings.source = source;
    }
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
      var voices = fallbackVoicesByInst[instId];
      for (var i = 0; i < voices.length; i++) {
        if (voices[i].active) {
          voices[i].noteOff();
        }
      }
    } else {
      for (var idx = 0; idx < 4; idx++) {
        var pool = fallbackVoicesByInst[idx];
        for (var j = 0; j < pool.length; j++) {
          if (pool[j].active) {
            pool[j].noteOff();
          }
        }
      }
    }
  }

  function isReady() {
    return engineReady;
  }

  function getDefaultSettings() {
    return JSON.parse(JSON.stringify(DEFAULT_WAVEFOLDER_SETTINGS));
  }

  // ============================================================
  // Export to SynthLab Namespace
  // ============================================================

  SL.wavefolder = {
    // Initialization
    init: init,
    isReady: isReady,

    // Note control
    noteOn: noteOn,
    noteOff: noteOff,
    allNotesOff: allNotesOff,

    // Parameter control
    setFoldAmount: setFoldAmount,
    setSymmetry: setSymmetry,
    setBias: setBias,
    setPreGain: setPreGain,
    setSource: setSource,

    // Settings management
    getSettings: getSettings,
    setSettings: setSettings,
    getDefaultSettings: getDefaultSettings,

    // Connection & filter
    connectToOutput: connectToOutput,
    updateFilter: updateFilter,

    // Constants
    DEFAULT_WAVEFOLDER_SETTINGS: DEFAULT_WAVEFOLDER_SETTINGS,
    MAX_VOICES_PER_INSTRUMENT: MAX_VOICES_PER_INSTRUMENT
  };

})();
