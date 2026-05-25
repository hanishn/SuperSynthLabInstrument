// Super Synth Lab - Chord Synthesis Engine
// Plays full chords from single notes, each chord note as independent oscillator with ADSR
// ScriptProcessor fallback, 16-voice polyphony
(function() {
  'use strict';

  var SL = window.SynthLab;

  // ============================================================
  // Constants
  // ============================================================

  var MAX_VOICES_PER_INSTRUMENT = 16;
  var TWO_PI = 2 * Math.PI;

  // Chord intervals in semitones from root
  var CHORD_INTERVALS = {
    major:  [0, 4, 7],
    minor:  [0, 3, 7],
    dim:    [0, 3, 6],
    aug:    [0, 4, 8],
    sus2:   [0, 2, 7],
    sus4:   [0, 5, 7],
    dom7:   [0, 4, 7, 10],
    maj7:   [0, 4, 7, 11],
    min7:   [0, 3, 7, 10],
    '9th':  [0, 4, 7, 10, 14],
    add9:   [0, 4, 7, 14],
    power:  [0, 7]
  };

  // Valid voicing and waveform options
  var VALID_VOICINGS = { 'close': 1, 'open': 1, 'drop2': 1, 'spread': 1 };
  var VALID_SOURCE_WAVES = { 'sine': 1, 'saw': 1, 'square': 1, 'triangle': 1 };

  /** Default chord settings */
  var DEFAULT_CHORD_SETTINGS = {
    chordType: 'major',
    voicing: 'close',
    strum: 0,
    sourceWave: 'saw'
  };

  // ============================================================
  // State
  // ============================================================

  var audioContext = null;
  var scriptNodes = [null, null, null, null];
  var fallbackVoicesByInst = [[], [], [], []];
  var isEngineReady = false;
  var instrumentSettings = {};
  var chordFilterNodes = {};
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
    }
    return Math.sin(TWO_PI * phase);
  }

  /**
   * Apply voicing to chord intervals
   * @param {number[]} intervals - Semitone offsets from root
   * @param {string} voicing - 'close', 'open', 'drop2', 'spread'
   * @returns {number[]} Modified semitone offsets
   */
  function applyVoicing(intervals, voicing) {
    if (voicing === 'close' || intervals.length < 3) {
      return intervals.slice();
    }

    var result = intervals.slice();
    if (voicing === 'open') {
      // Raise every other note by an octave
      for (var i = 1; i < result.length; i += 2) {
        result[i] = result[i] + 12;
      }
    } else if (voicing === 'drop2') {
      // Drop the second highest note down an octave
      if (result.length >= 3) {
        var secondHighest = result.length - 2;
        result[secondHighest] = result[secondHighest] - 12;
      }
    } else if (voicing === 'spread') {
      // Spread notes across two octaves
      for (var j = 0; j < result.length; j++) {
        result[j] = result[j] + Math.floor(j * 12 / result.length);
      }
    }
    return result;
  }

  // ============================================================
  // Voice (represents one note of the chord)
  // ============================================================

  function ChordSubVoice(sr) {
    this.sampleRate = sr;
    this.active = false;
    this.phase = 0;
    this.phaseInc = 0;
    this.wave = 'saw';
    this.velocity = 1.0;

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

  ChordSubVoice.prototype.noteOn = function(freq, vel, wave, adsr, strumDelay) {
    this.active = true;
    this.phase = 0;
    this.phaseInc = freq / this.sampleRate;
    this.wave = wave;
    this.velocity = vel;
    this.envStage = 0;
    this.envLevel = 0;
    this.envReleased = false;
    this.envFinished = false;

    this.fadeInSamples = Math.ceil(this.sampleRate * 0.005);
    this.fadeInCounter = 0;
    this.startDelaySamples = strumDelay || 0;

    var safeAttack = Math.max(0.001, adsr.a);
    var safeDecay = Math.max(0.001, adsr.d);
    var safeRelease = Math.max(0.001, adsr.r);
    this.attackRate = 1.0 / (safeAttack * this.sampleRate);
    this.decayRate = 1.0 / (safeDecay * this.sampleRate);
    this.sustainLevel = adsr.s;
    this.releaseRate = 1.0 / (safeRelease * this.sampleRate);
  };

  ChordSubVoice.prototype.noteOff = function() {
    if (!this.envFinished) {
      this.envReleased = true;
      this.envStage = 3;
    }
  };

  ChordSubVoice.prototype.process = function() {
    if (!this.active) {
      return 0;
    }

    if (this.startDelaySamples > 0) {
      this.startDelaySamples--;
      return 0;
    }

    // Envelope
    if (this.envFinished) {
      this.active = false;
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
        this.active = false;
        return 0;
      }
    }

    var sample = generateSample(this.wave, this.phase) * this.envLevel * this.velocity;

    this.phase += this.phaseInc;
    if (this.phase >= 1.0) {
      this.phase -= Math.floor(this.phase);
    }

    if (this.fadeInCounter < this.fadeInSamples) {
      sample *= this.fadeInCounter / this.fadeInSamples;
      this.fadeInCounter++;
    }

    return sample;
  };

  // ============================================================
  // Chord Voice (groups sub-voices for one played note)
  // ============================================================

  function ChordVoice(sr) {
    this.sampleRate = sr;
    this.active = false;
    this.midiNote = -1;
    this.instId = 0;

    // Up to 5 sub-voices (for 9th chords)
    this.subVoices = [];
    for (var i = 0; i < 5; i++) {
      this.subVoices.push(new ChordSubVoice(sr));
    }
    this.activeSubCount = 0;
  }

  ChordVoice.prototype.noteOn = function(midi, vel, settings) {
    this.active = true;
    this.midiNote = midi;
    this.instId = settings.instId || 0;

    var chordType = settings.chordType || 'major';
    var intervals = CHORD_INTERVALS[chordType] || CHORD_INTERVALS.major;
    var voiced = applyVoicing(intervals, settings.voicing || 'close');
    var wave = settings.sourceWave || 'saw';
    var strumMs = settings.strum || 0;
    var adsr = settings.adsr || { a: 0.01, d: 0.1, s: 0.7, r: 0.2 };

    this.activeSubCount = Math.min(voiced.length, 5);
    var noteGain = 1.0 / this.activeSubCount;

    for (var i = 0; i < this.activeSubCount; i++) {
      var noteMidi = midi + voiced[i];
      var freq = midiToFreq(noteMidi);
      var strumDelay = Math.round((strumMs / 1000) * i * this.sampleRate);
      this.subVoices[i].noteOn(freq, vel * noteGain, wave, adsr, strumDelay);
    }

    // Deactivate unused sub-voices
    for (var j = this.activeSubCount; j < 5; j++) {
      this.subVoices[j].active = false;
    }
  };

  ChordVoice.prototype.noteOff = function() {
    for (var i = 0; i < this.activeSubCount; i++) {
      this.subVoices[i].noteOff();
    }
  };

  ChordVoice.prototype.process = function() {
    if (!this.active) {
      return 0;
    }

    var sample = 0;
    var isAnyActive = false;
    for (var i = 0; i < this.activeSubCount; i++) {
      if (this.subVoices[i].active) {
        sample += this.subVoices[i].process();
        isAnyActive = true;
      }
    }

    if (!isAnyActive) {
      this.active = false;
    }

    return sample;
  };

  ChordVoice.prototype.isFinished = function() {
    if (!this.active) {
      return true;
    }
    for (var i = 0; i < this.activeSubCount; i++) {
      if (this.subVoices[i].active) {
        return false;
      }
    }
    return true;
  };

  // ============================================================
  // Engine Init
  // ============================================================

  function init(ctx) {
    audioContext = ctx || (SL.audio && SL.audio.getCtx ? SL.audio.getCtx() : null);
    if (!audioContext) {
      console.error('[CHORD] No AudioContext available');
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
        fallbackVoicesByInst[i].push(new ChordVoice(sr));
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
    if (!chordFilterNodes[instId]) {
      var node = audioContext.createBiquadFilter();
      node.type = 'lowpass';
      node.frequency.value = 20000;
      node.Q.value = 0.707;
      chordFilterNodes[instId] = node;
    }
    return chordFilterNodes[instId];
  }

  function updateFilter(instId) {
    if (instId === undefined) {
      instId = 0;
    }
    var filterNode = chordFilterNodes[instId];
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
      instrumentSettings[instId] = JSON.parse(JSON.stringify(DEFAULT_CHORD_SETTINGS));
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
    connectToOutput(instId);

    var instruments = SL.audio.getInstruments();
    var rawHum = (instruments && instruments[instId]) ? (instruments[instId].settings.humanization || {}) : {};
    var humVelocity = (typeof rawHum === 'number') ? rawHum : (rawHum.velocity || 0);
    var humAdsr = (typeof rawHum === 'number') ? rawHum : (rawHum.adsr || 0);

    var velRange = Math.round(humVelocity * 1.2);
    var randomizedVel = velocity;
    if (velRange > 0) {
      randomizedVel = velocity + Math.round((Math.random() * 2 - 1) * velRange);
      if (randomizedVel < 1) { randomizedVel = 1; }
      if (randomizedVel > 127) { randomizedVel = 127; }
    }

    var instSettings = instruments[instId].settings;
    var adsrRaw = instSettings.adsr || { a: 10, d: 100, s: 70, r: 200 };
    var sliderToTime = SL.audio.sliderToTime;
    var aTime = sliderToTime(adsrRaw.a, 500, 500) / 1000;
    var dTime = sliderToTime(adsrRaw.d, 500, 500) / 1000;
    var sLevel = adsrRaw.s / 100;
    var rTime = sliderToTime(adsrRaw.r, 1000, 1000) / 1000;

    if (humAdsr > 0) {
      var jA = 1 + (Math.random() * 2 - 1) * humAdsr * 0.015;
      var jD = 1 + (Math.random() * 2 - 1) * humAdsr * 0.015;
      var jR = 1 + (Math.random() * 2 - 1) * humAdsr * 0.015;
      aTime = Math.max(0.001, aTime * jA);
      dTime = Math.max(0.001, dTime * jD);
      rTime = Math.max(0.001, rTime * jR);
    }

    var voiceSettings = {
      instId: instId,
      chordType: settings.chordType,
      voicing: settings.voicing,
      strum: settings.strum,
      sourceWave: settings.sourceWave,
      adsr: { a: aTime, d: dTime, s: sLevel, r: rTime }
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
    voice.noteOn(midi, randomizedVel / 127, voiceSettings);
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

  function setChordType(instId, chordType) {
    var settings = getOrCreateSettings(instId);
    if (CHORD_INTERVALS[chordType]) {
      settings.chordType = chordType;
    }
  }

  function setVoicing(instId, voicing) {
    var settings = getOrCreateSettings(instId);
    if (VALID_VOICINGS[voicing]) {
      settings.voicing = voicing;
    }
  }

  function setStrum(instId, strumMs) {
    var settings = getOrCreateSettings(instId);
    settings.strum = Math.max(0, Math.min(100, strumMs));
  }

  function setSourceWave(instId, wave) {
    var settings = getOrCreateSettings(instId);
    if (VALID_SOURCE_WAVES[wave]) {
      settings.sourceWave = wave;
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
    return JSON.parse(JSON.stringify(DEFAULT_CHORD_SETTINGS));
  }

  // ============================================================
  // Export
  // ============================================================

  SL.chord = {
    init: init,
    isReady: isReady,
    noteOn: noteOn,
    noteOff: noteOff,
    allNotesOff: allNotesOff,
    setChordType: setChordType,
    setVoicing: setVoicing,
    setStrum: setStrum,
    setSourceWave: setSourceWave,
    getSettings: getSettings,
    setSettings: setSettings,
    getDefaultSettings: getDefaultSettings,
    connectToOutput: connectToOutput,
    updateFilter: updateFilter,
    CHORD_INTERVALS: CHORD_INTERVALS,
    DEFAULT_CHORD_SETTINGS: DEFAULT_CHORD_SETTINGS,
    MAX_VOICES_PER_INSTRUMENT: MAX_VOICES_PER_INSTRUMENT
  };

})();
