// Super Synth Lab - Pulsar Synthesis Engine
// Train of micro-sonic events (pulsarets) at controllable rate
// Inspired by Curtis Roads' pulsar synthesis technique
// ScriptProcessor fallback, 16-voice polyphony
(function() {
  'use strict';

  var SL = window.SynthLab;

  // ============================================================
  // Constants
  // ============================================================

  var MAX_VOICES_PER_INSTRUMENT = 16;
  var TWO_PI = 2 * Math.PI;
  var GAUSSIAN_SIGMA = 0.15;
  var GAUSSIAN_DENOM = 2 * GAUSSIAN_SIGMA * GAUSSIAN_SIGMA;

  // Valid pulsaret waveform and envelope types
  var VALID_PULSARET_WAVEFORMS = { 'sine': 1, 'saw': 1, 'square': 1, 'triangle': 1 };
  var VALID_PULSARET_ENVELOPES = { 'gaussian': 1, 'hann': 1, 'triangle': 1, 'rectangle': 1 };

  /** Default pulsar settings */
  var DEFAULT_PULSAR_SETTINGS = {
    pulsaretWaveform: 'sine',
    pulseRate: 100,
    dutyCycle: 50,
    pulsaretEnvelope: 'gaussian',
    formantFreq: 1000,
    masking: 0
  };

  // ============================================================
  // State
  // ============================================================

  var audioContext = null;
  var scriptNodes = [null, null, null, null];
  var fallbackVoicesByInst = [[], [], [], []];
  var isEngineReady = false;
  var instrumentSettings = {};
  var pulsarFilterNodes = {};
  var connectedInsts = [false, false, false, false];

  // ============================================================
  // Helpers
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

  /**
   * Generate a single sample for the given waveform type.
   * @param {string} type - 'sine', 'saw', 'square', 'triangle'
   * @param {number} phase - 0..1
   * @returns {number} sample -1..1
   */
  function generateSample(type, phase) {
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
   * Compute pulsaret window amplitude for a given envelope type.
   * @param {string} envType - 'gaussian', 'hann', 'triangle', 'rectangle'
   * @param {number} t - normalized position within pulsaret, 0..1
   * @returns {number} window amplitude 0..1
   */
  function pulsaretWindow(envType, t) {
    if (envType === 'gaussian') {
      var centered = t - 0.5;
      return Math.exp(-(centered * centered) / GAUSSIAN_DENOM);
    } else if (envType === 'hann') {
      return 0.5 * (1.0 - Math.cos(TWO_PI * t));
    } else if (envType === 'triangle') {
      return 1.0 - Math.abs(2.0 * t - 1.0);
    } else if (envType === 'rectangle') {
      return 1.0;
    }
    return 1.0;
  }

  // ============================================================
  // Voice
  // ============================================================

  function PulsarVoice(sr) {
    this.sampleRate = sr;
    this.active = false;
    this.midiNote = -1;
    this.instId = 0;
    this.velocity = 1.0;

    // Pulse train state
    this.pulsePhase = 0;
    this.pulsePhaseInc = 0;
    this.formantPhase = 0;
    this.formantPhaseInc = 0;
    this.dutyCycle = 0.5;
    this.masked = false;
    this.noiseState = 1;

    // Settings references
    this.pulsaretWaveform = 'sine';
    this.pulsaretEnvelope = 'gaussian';
    this.maskingProb = 0;

    // ADSR amplitude envelope
    this.envStage = 0;       // 0=attack, 1=decay, 2=sustain, 3=release
    this.envLevel = 0;
    this.envReleased = false;
    this.envFinished = false;
    this.attackRate = 0;
    this.decayRate = 0;
    this.sustainLevel = 0.7;
    this.releaseRate = 0;

    // Fade-in ramp
    this.fadeInSamples = 0;
    this.fadeInCounter = 0;
    this.startDelaySamples = 0;
  }

  /**
   * Simple xorshift PRNG for masking decisions (deterministic per voice).
   */
  PulsarVoice.prototype.nextRandom = function() {
    var x = this.noiseState;
    x ^= (x << 13);
    x ^= (x >> 17);
    x ^= (x << 5);
    this.noiseState = x;
    return ((x >>> 0) % 10000) / 10000;
  };

  PulsarVoice.prototype.noteOn = function(midi, vel, freq, settings) {
    this.active = true;
    this.midiNote = midi;
    this.instId = settings.instId || 0;
    this.envStage = 0;
    this.envLevel = 0;
    this.envReleased = false;
    this.envFinished = false;

    // Pulse train parameters
    // pulseRate is the fundamental — scale by MIDI pitch ratio
    var baseRate = settings.pulseRate || 100;
    var midiRatio = freq / midiToFreq(69);
    this.pulsePhaseInc = (baseRate * midiRatio) / this.sampleRate;

    this.pulsePhase = 0;
    this.formantPhase = 0;
    this.formantPhaseInc = (settings.formantFreq || 1000) / this.sampleRate;
    this.dutyCycle = (settings.dutyCycle || 50) / 100;
    this.pulsaretWaveform = settings.pulsaretWaveform || 'sine';
    this.pulsaretEnvelope = settings.pulsaretEnvelope || 'gaussian';
    this.maskingProb = (settings.masking || 0) / 100;
    this.masked = false;
    this.noiseState = (midi * 7919 + 1) | 0;
    if (this.noiseState === 0) {
      this.noiseState = 1;
    }

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

    this.fadeInSamples = Math.ceil(this.sampleRate * 0.008);
    this.fadeInCounter = 0;

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
  };

  PulsarVoice.prototype.noteOff = function() {
    if (!this.envFinished) {
      this.envReleased = true;
      this.envStage = 3;
    }
  };

  PulsarVoice.prototype.processEnvelope = function() {
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
      // sustain - hold level
    } else if (this.envStage === 3) {
      this.envLevel -= this.releaseRate * this.envLevel;
      if (this.envLevel <= 0.0001) {
        this.envLevel = 0;
        this.envFinished = true;
      }
    }

    return this.envLevel;
  };

  PulsarVoice.prototype.process = function() {
    if (!this.active) {
      return 0;
    }

    if (this.startDelaySamples > 0) {
      this.startDelaySamples--;
      return 0;
    }

    var env = this.processEnvelope();
    if (this.envFinished) {
      this.active = false;
      return 0;
    }

    // Advance pulse phase
    var prevPhase = this.pulsePhase;
    this.pulsePhase += this.pulsePhaseInc;

    // Check for phase wrap (new pulse starts)
    if (this.pulsePhase >= 1.0) {
      this.pulsePhase -= Math.floor(this.pulsePhase);
      // Reset formant phase at start of each new pulsaret
      this.formantPhase = 0;
      // Determine masking for this new pulse
      if (this.maskingProb > 0) {
        this.masked = this.nextRandom() < this.maskingProb;
      } else {
        this.masked = false;
      }
    }

    var sample = 0;

    if (!this.masked && this.pulsePhase < this.dutyCycle) {
      // Inside the pulsaret window
      var t = this.pulsePhase / this.dutyCycle;

      // Window envelope
      var window = pulsaretWindow(this.pulsaretEnvelope, t);

      // Generate formant waveform
      var waveSample = generateSample(this.pulsaretWaveform, this.formantPhase);

      sample = waveSample * window * this.velocity * env;
    }

    // Always advance formant phase (continuous within pulsaret duty region)
    if (this.pulsePhase < this.dutyCycle) {
      this.formantPhase += this.formantPhaseInc;
      if (this.formantPhase >= 1.0) {
        this.formantPhase -= Math.floor(this.formantPhase);
      }
    }

    // Fade-in ramp to prevent clicks
    if (this.fadeInCounter < this.fadeInSamples) {
      sample *= this.fadeInCounter / this.fadeInSamples;
      this.fadeInCounter++;
    }

    return sample;
  };

  PulsarVoice.prototype.isFinished = function() {
    return this.envFinished;
  };

  // ============================================================
  // Engine Init
  // ============================================================

  function init(ctx) {
    audioContext = ctx || (SL.audio && SL.audio.getCtx ? SL.audio.getCtx() : null);
    if (!audioContext) {
      console.error('[PULSAR] No AudioContext available');
      return Promise.reject(new Error('No AudioContext'));
    }

    return initFallback();
  }

  function initFallback() {
    var sr = audioContext.sampleRate;
    var bufSize = (SL.audio && SL.audio.getScriptProcessorBufferSize) ? SL.audio.getScriptProcessorBufferSize() : 2048;

    for (var i = 0; i < 4; i++) {
      fallbackVoicesByInst[i].length = 0;
      for (var v = 0; v < MAX_VOICES_PER_INSTRUMENT; v++) {
        fallbackVoicesByInst[i].push(new PulsarVoice(sr));
      }
    }

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
            // Soft clip
            var ss = sample * sample;
            output[s] = sample * (27 + ss) / (27 + 9 * ss);
          }
        };
        scriptNodes[instIdx] = node;
      })(idx);
    }

    isEngineReady = true;
    return Promise.resolve(true);
  }

  // ============================================================
  // Connection
  // ============================================================

  function getOrCreateFilterNode(instId) {
    if (!audioContext) {
      return null;
    }
    if (!pulsarFilterNodes[instId]) {
      var node = audioContext.createBiquadFilter();
      node.type = 'lowpass';
      node.frequency.value = 20000;
      node.Q.value = 0.707;
      pulsarFilterNodes[instId] = node;
    }
    return pulsarFilterNodes[instId];
  }

  function updateFilter(instId) {
    if (instId === undefined) {
      instId = 0;
    }
    var filterNode = pulsarFilterNodes[instId];
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
    } // end if (filterNode)
  }

  function connectToOutput(instId) {
    if (scriptNodes[instId]) {

    if (connectedInsts[instId]) {
      updateFilter(instId);
    } else {
      var instruments = SL.audio && SL.audio.getInstruments ? SL.audio.getInstruments() : null;
      var inst = instruments ? instruments[instId] : null;
      var isDestinationResolved = false;
      var destination;

      if (inst && inst.masterOutput) {
        destination = inst.masterOutput;
        isDestinationResolved = true;
      } else if (audioContext) {
        destination = audioContext.destination;
        isDestinationResolved = true;
      }

      if (isDestinationResolved) {
      var filterNode = getOrCreateFilterNode(instId);
      updateFilter(instId);

      if (filterNode) {
        scriptNodes[instId].connect(filterNode);
        filterNode.connect(destination);
      } else {
        scriptNodes[instId].connect(destination);
      }

      connectedInsts[instId] = true;
      } // end if (isDestinationResolved)
    }
    } // end if (scriptNodes[instId])
  }

  // ============================================================
  // Settings
  // ============================================================

  function getOrCreateSettings(instId) {
    if (!instrumentSettings[instId]) {
      instrumentSettings[instId] = JSON.parse(JSON.stringify(DEFAULT_PULSAR_SETTINGS));
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

    connectToOutput(instId);

    var instruments = SL.audio.getInstruments();
    var rawHum = (instruments && instruments[instId]) ? (instruments[instId].settings.humanization || {}) : {};
    var humVelocity = (typeof rawHum === 'number') ? rawHum : (rawHum.velocity || 0);
    var humAdsr = (typeof rawHum === 'number') ? rawHum : (rawHum.adsr || 0);
    var humTiming = (typeof rawHum === 'number') ? 0 : (rawHum.timing || 0);

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
      pulseRate: settings.pulseRate,
      dutyCycle: settings.dutyCycle,
      pulsaretWaveform: settings.pulsaretWaveform,
      pulsaretEnvelope: settings.pulsaretEnvelope,
      formantFreq: settings.formantFreq,
      masking: settings.masking,
      adsr: adsr,
      humVelocity: humVelocity,
      humAdsr: humAdsr,
      humTiming: humTiming
    };

    var voices = fallbackVoicesByInst[instId];
    var voice = null;
    for (var i = 0; i < voices.length; i++) {
      if (!voices[i].active) {
        voice = voices[i];
        break;
      }
    }
    if (!voice) {
      voice = voices[0];
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

  function setPulseRate(instId, rate) {
    var settings = getOrCreateSettings(instId);
    settings.pulseRate = Math.max(1, Math.min(500, rate));
  }

  function setDutyCycle(instId, duty) {
    var settings = getOrCreateSettings(instId);
    settings.dutyCycle = Math.max(1, Math.min(100, duty));
  }

  function setFormantFreq(instId, freq) {
    var settings = getOrCreateSettings(instId);
    settings.formantFreq = Math.max(50, Math.min(5000, freq));
  }

  function setPulsaretWaveform(instId, waveform) {
    var settings = getOrCreateSettings(instId);
    if (VALID_PULSARET_WAVEFORMS[waveform]) {
      settings.pulsaretWaveform = waveform;
    }
  }

  function setPulsaretEnvelope(instId, envType) {
    var settings = getOrCreateSettings(instId);
    if (VALID_PULSARET_ENVELOPES[envType]) {
      settings.pulsaretEnvelope = envType;
    }
  }

  function setMasking(instId, masking) {
    var settings = getOrCreateSettings(instId);
    settings.masking = Math.max(0, Math.min(100, masking));
  }

  function getSettings(instId) {
    return JSON.parse(JSON.stringify(getOrCreateSettings(instId)));
  }

  function setSettings(instId, newSettings) {
    instrumentSettings[instId] = JSON.parse(JSON.stringify(newSettings));
  }

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
    return isEngineReady;
  }

  function getDefaultSettings() {
    return JSON.parse(JSON.stringify(DEFAULT_PULSAR_SETTINGS));
  }

  // ============================================================
  // Export
  // ============================================================

  SL.pulsar = {
    init: init,
    isReady: isReady,
    noteOn: noteOn,
    noteOff: noteOff,
    allNotesOff: allNotesOff,
    setPulseRate: setPulseRate,
    setDutyCycle: setDutyCycle,
    setFormantFreq: setFormantFreq,
    setPulsaretWaveform: setPulsaretWaveform,
    setPulsaretEnvelope: setPulsaretEnvelope,
    setMasking: setMasking,
    getSettings: getSettings,
    setSettings: setSettings,
    getDefaultSettings: getDefaultSettings,
    connectToOutput: connectToOutput,
    updateFilter: updateFilter,
    DEFAULT_PULSAR_SETTINGS: DEFAULT_PULSAR_SETTINGS,
    MAX_VOICES_PER_INSTRUMENT: MAX_VOICES_PER_INSTRUMENT
  };

})();
