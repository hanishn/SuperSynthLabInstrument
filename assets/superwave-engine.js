// Super Synth Lab - SuperWave Synthesis Engine
// Multiple detuned oscillators (2-16 voices) with stereo spread
// ScriptProcessor fallback, 16-voice polyphony
(function() {
  'use strict';

  var SL = window.SynthLab;

  // ============================================================
  // Constants
  // ============================================================

  var MAX_VOICES_PER_INSTRUMENT = 16;
  var TWO_PI = 2 * Math.PI;

  // Allowed voice counts
  var VOICE_COUNTS = [2, 4, 7, 8, 12, 16];

  // Valid source waveform and mix mode options
  var VALID_SOURCE_WAVES = { 'saw': 1, 'square': 1, 'triangle': 1, 'pulse': 1 };
  var VALID_MIX_MODES = { 'equal': 1, 'center-heavy': 1, 'edge-heavy': 1 };

  /** Default superwave settings */
  var DEFAULT_SUPERWAVE_SETTINGS = {
    sourceWave: 'saw',
    voiceCount: 7,
    detuneSpread: 30,
    stereoSpread: 50,
    mixMode: 'equal'
  };

  // ============================================================
  // State
  // ============================================================

  var audioContext = null;
  var scriptNodes = [null, null, null, null];
  var fallbackVoicesByInst = [[], [], [], []];
  var isEngineReady = false;
  var instrumentSettings = {};
  var superwaveFilterNodes = {};
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
    } else if (type === 'pulse') {
      // Narrow pulse for PWM-like tones
      if (phase < 0.25) {
        return 1.0;
      } else {
        return -1.0;
      }
    }
    return Math.sin(TWO_PI * phase);
  }

  /**
   * Get per-voice gain based on mix mode
   * @param {number} voiceIdx - Index of the voice (0-based)
   * @param {number} voiceCount - Total number of voices
   * @param {string} mixMode - 'equal', 'center-heavy', 'edge-heavy'
   * @returns {number} Gain multiplier
   */
  function getVoiceGain(voiceIdx, voiceCount, mixMode) {
    if (mixMode === 'center-heavy') {
      // Center voice(s) louder, edges quieter
      var center = (voiceCount - 1) / 2.0;
      var dist = Math.abs(voiceIdx - center) / center;
      return 1.0 - dist * 0.6;
    } else if (mixMode === 'edge-heavy') {
      // Edge voices louder, center quieter
      var center2 = (voiceCount - 1) / 2.0;
      var dist2 = Math.abs(voiceIdx - center2) / center2;
      return 0.4 + dist2 * 0.6;
    }
    // equal
    return 1.0;
  }

  // ============================================================
  // Voice
  // ============================================================

  function SuperwaveVoice(sr) {
    this.sampleRate = sr;
    this.active = false;
    this.midiNote = -1;
    this.instId = 0;
    this.velocity = 1.0;

    // Sub-oscillator phases and phase increments (max 16)
    this.phases = new Float64Array(16);
    this.phaseIncs = new Float64Array(16);
    this.voiceGains = new Float64Array(16);
    this.voicePans = new Float64Array(16); // -1 to 1
    this.numVoices = 7;
    this.sourceWave = 'saw';

    // ADSR
    this.envStage = 0;
    this.envLevel = 0;
    this.envReleased = false;
    this.envFinished = false;
    this.attackRate = 0;
    this.decayRate = 0;
    this.sustainLevel = 0.7;
    this.releaseRate = 0;

    this.fadeInSamples = 0;
    this.fadeInCounter = 0;
    this.startDelaySamples = 0;
  }

  SuperwaveVoice.prototype.noteOn = function(midi, vel, freq, settings) {
    this.active = true;
    this.midiNote = midi;
    this.instId = settings.instId || 0;
    this.envStage = 0;
    this.envLevel = 0;
    this.envReleased = false;
    this.envFinished = false;

    this.sourceWave = settings.sourceWave || 'saw';
    this.numVoices = settings.voiceCount || 7;
    var detuneCents = settings.detuneSpread || 30;
    var stereoSpread = (settings.stereoSpread !== undefined ? settings.stereoSpread : 50) / 100;
    var mixMode = settings.mixMode || 'equal';

    // Set up each sub-oscillator with evenly spread detuning
    for (var i = 0; i < this.numVoices; i++) {
      this.phases[i] = Math.random(); // Random initial phase for thickness

      // Spread detuning evenly: -detuneCents to +detuneCents
      var detuneRatio;
      if (this.numVoices === 1) {
        detuneRatio = 0;
      } else {
        detuneRatio = (i / (this.numVoices - 1)) * 2 - 1; // -1 to 1
      }
      var voiceDetune = detuneRatio * detuneCents;
      var voiceFreq = freq * Math.pow(2, voiceDetune / 1200);
      this.phaseIncs[i] = voiceFreq / this.sampleRate;

      // Voice gain based on mix mode
      this.voiceGains[i] = getVoiceGain(i, this.numVoices, mixMode);

      // Stereo panning (mono output - stored for potential stereo use)
      this.voicePans[i] = detuneRatio * stereoSpread;
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

    var safeAttack = Math.max(0.001, aTime);
    var safeDecay = Math.max(0.001, dTime);
    var safeRelease = Math.max(0.001, rTime);
    this.attackRate = 1.0 / (safeAttack * this.sampleRate);
    this.decayRate = 1.0 / (safeDecay * this.sampleRate);
    this.sustainLevel = sLevel;
    this.releaseRate = 1.0 / (safeRelease * this.sampleRate);
  };

  SuperwaveVoice.prototype.noteOff = function() {
    if (!this.envFinished) {
      this.envReleased = true;
      this.envStage = 3;
    }
  };

  SuperwaveVoice.prototype.processEnvelope = function() {
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
      // sustain
    } else if (this.envStage === 3) {
      this.envLevel -= this.releaseRate * this.envLevel;
      if (this.envLevel <= 0.0001) {
        this.envLevel = 0;
        this.envFinished = true;
      }
    }

    return this.envLevel;
  };

  SuperwaveVoice.prototype.process = function() {
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

    // Sum all sub-oscillators
    var sample = 0;
    var gainSum = 0;
    for (var i = 0; i < this.numVoices; i++) {
      sample += generateSample(this.sourceWave, this.phases[i]) * this.voiceGains[i];
      gainSum += this.voiceGains[i];

      this.phases[i] += this.phaseIncs[i];
      if (this.phases[i] >= 1.0) {
        this.phases[i] -= Math.floor(this.phases[i]);
      }
    }

    // Normalize by total gain
    if (gainSum > 0) {
      sample = sample / gainSum;
    }

    sample = sample * env * this.velocity;

    if (this.fadeInCounter < this.fadeInSamples) {
      sample *= this.fadeInCounter / this.fadeInSamples;
      this.fadeInCounter++;
    }

    return sample;
  };

  SuperwaveVoice.prototype.isFinished = function() {
    return this.envFinished;
  };

  // ============================================================
  // Engine Init
  // ============================================================

  function init(ctx) {
    audioContext = ctx || (SL.audio && SL.audio.getCtx ? SL.audio.getCtx() : null);
    if (!audioContext) {
      console.error('[SUPERWAVE] No AudioContext available');
      return Promise.reject(new Error('No AudioContext'));
    }
    return initFallback();
  }

  function initFallback() {
    var sr = audioContext.sampleRate;
    var bufSize = (SL.audio && SL.audio.getScriptProcessorBufferSize) ? SL.audio.getScriptProcessorBufferSize() : 1024;

    for (var i = 0; i < 4; i++) {
      fallbackVoicesByInst[i].length = 0;
      for (var v = 0; v < MAX_VOICES_PER_INSTRUMENT; v++) {
        fallbackVoicesByInst[i].push(new SuperwaveVoice(sr));
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
    if (!superwaveFilterNodes[instId]) {
      var node = audioContext.createBiquadFilter();
      node.type = 'lowpass';
      node.frequency.value = 20000;
      node.Q.value = 0.707;
      superwaveFilterNodes[instId] = node;
    }
    return superwaveFilterNodes[instId];
  }

  function updateFilter(instId) {
    if (instId === undefined) {
      instId = 0;
    }
    var filterNode = superwaveFilterNodes[instId];
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
    if (scriptNodes[instId]) {
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
            scriptNodes[instId].connect(filterNode);
            filterNode.connect(destination);
          } else {
            scriptNodes[instId].connect(destination);
          }

          connectedInsts[instId] = true;
        }
      }
    }
  }

  // ============================================================
  // Settings
  // ============================================================

  function getOrCreateSettings(instId) {
    if (!instrumentSettings[instId]) {
      instrumentSettings[instId] = JSON.parse(JSON.stringify(DEFAULT_SUPERWAVE_SETTINGS));
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
      sourceWave: settings.sourceWave,
      voiceCount: settings.voiceCount,
      detuneSpread: settings.detuneSpread,
      stereoSpread: settings.stereoSpread,
      mixMode: settings.mixMode,
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

  function setSourceWave(instId, wave) {
    var settings = getOrCreateSettings(instId);
    if (VALID_SOURCE_WAVES[wave]) {
      settings.sourceWave = wave;
    }
  }

  function setVoiceCount(instId, count) {
    var settings = getOrCreateSettings(instId);
    // Snap to nearest valid count
    var bestDiff = 999;
    var bestCount = 7;
    for (var i = 0; i < VOICE_COUNTS.length; i++) {
      var diff = Math.abs(VOICE_COUNTS[i] - count);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestCount = VOICE_COUNTS[i];
      }
    }
    settings.voiceCount = bestCount;
  }

  function setDetuneSpread(instId, cents) {
    var settings = getOrCreateSettings(instId);
    settings.detuneSpread = Math.max(0, Math.min(100, cents));
  }

  function setStereoSpread(instId, spread) {
    var settings = getOrCreateSettings(instId);
    settings.stereoSpread = Math.max(0, Math.min(100, spread));
  }

  function setMixMode(instId, mode) {
    var settings = getOrCreateSettings(instId);
    if (VALID_MIX_MODES[mode]) {
      settings.mixMode = mode;
    }
  }

  function getSettings(instId) {
    return JSON.parse(JSON.stringify(getOrCreateSettings(instId)));
  }

  function setSettings(instId, settings) {
    instrumentSettings[instId] = JSON.parse(JSON.stringify(settings));
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
    return JSON.parse(JSON.stringify(DEFAULT_SUPERWAVE_SETTINGS));
  }

  // ============================================================
  // Export
  // ============================================================

  SL.superwave = {
    init: init,
    isReady: isReady,
    noteOn: noteOn,
    noteOff: noteOff,
    allNotesOff: allNotesOff,
    setSourceWave: setSourceWave,
    setVoiceCount: setVoiceCount,
    setDetuneSpread: setDetuneSpread,
    setStereoSpread: setStereoSpread,
    setMixMode: setMixMode,
    getSettings: getSettings,
    setSettings: setSettings,
    getDefaultSettings: getDefaultSettings,
    connectToOutput: connectToOutput,
    updateFilter: updateFilter,
    VOICE_COUNTS: VOICE_COUNTS,
    DEFAULT_SUPERWAVE_SETTINGS: DEFAULT_SUPERWAVE_SETTINGS,
    MAX_VOICES_PER_INSTRUMENT: MAX_VOICES_PER_INSTRUMENT
  };

})();
