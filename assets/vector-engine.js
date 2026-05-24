// Super Synth Lab - Vector Synthesis Engine
// 4 sound sources arranged in a 2D space (X/Y) with bilinear interpolation
// Inspired by Sequential Prophet VS / Korg Wavestation vector synthesis
// ScriptProcessor fallback, 16-voice polyphony
(function() {
  'use strict';

  var SL = window.SynthLab;

  // ============================================================
  // Constants
  // ============================================================

  var MAX_VOICES_PER_INSTRUMENT = 16;
  var TWO_PI = 2 * Math.PI;
  var NUM_SOURCES = 4;

  /** Default vector settings */
  var DEFAULT_VECTOR_SETTINGS = {
    sources: [
      { waveform: 'saw',      detune: 0 },
      { waveform: 'square',   detune: 0 },
      { waveform: 'triangle', detune: 0 },
      { waveform: 'sine',     detune: 0 }
    ],
    vectorX: 50,
    vectorY: 50,
    vectorEnvelope: {
      enabled: false,
      loop: false,
      points: [
        { x: 0,   y: 0,   time: 0 },
        { x: 100, y: 0,   time: 500 },
        { x: 100, y: 100, time: 1000 },
        { x: 0,   y: 100, time: 1500 },
        { x: 0,   y: 0,   time: 2000 }
      ]
    }
  };

  // ============================================================
  // State
  // ============================================================

  var audioContext = null;
  var scriptNodes = [null, null, null, null];
  var fallbackVoicesByInst = [[], [], [], []];
  var engineReady = false;
  var instrumentSettings = {};
  var vectorFilterNodes = {};
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
   * @param {string} type - 'sine', 'saw', 'square', 'triangle', 'pulse', 'noise'
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
    } else if (type === 'pulse') {
      // Narrow pulse (25% duty cycle)
      if (phase < 0.25) {
        return 1.0;
      } else {
        return -1.0;
      }
    } else if (type === 'noise') {
      return Math.random() * 2.0 - 1.0;
    }
    return Math.sin(TWO_PI * phase);
  }

  /**
   * Compute bilinear interpolation weights for 4 corners from X/Y position.
   * A(0,0)  B(1,0)
   * C(0,1)  D(1,1)
   * @param {number} x - 0..1
   * @param {number} y - 0..1
   * @returns {Array} [wA, wB, wC, wD]
   */
  function bilinearWeights(x, y) {
    var wA = (1.0 - x) * (1.0 - y);
    var wB = x * (1.0 - y);
    var wC = (1.0 - x) * y;
    var wD = x * y;
    return [wA, wB, wC, wD];
  }

  // ============================================================
  // Vector Envelope Interpolation
  // ============================================================

  /**
   * Evaluate the vector envelope at a given time (ms).
   * Returns {x, y} in 0..100 range.
   * @param {Array} points - array of {x, y, time} sorted by time
   * @param {number} timeMs - current time in ms
   * @param {boolean} loop - whether to loop
   * @returns {object} {x, y}
   */
  function evaluateVectorEnvelope(points, timeMs, loop) {
    if (!points || points.length === 0) {
      return { x: 50, y: 50 };
    }

    if (points.length === 1) {
      return { x: points[0].x, y: points[0].y };
    }

    var totalDuration = points[points.length - 1].time;
    if (totalDuration <= 0) {
      return { x: points[0].x, y: points[0].y };
    }

    var t = timeMs;
    if (loop) {
      t = t % totalDuration;
    } else {
      if (t >= totalDuration) {
        return { x: points[points.length - 1].x, y: points[points.length - 1].y };
      }
    }

    // Find the two points we are between
    var p0 = points[0];
    var p1 = points[1];
    for (var i = 1; i < points.length; i++) {
      if (t < points[i].time) {
        p0 = points[i - 1];
        p1 = points[i];
        break;
      }
      if (i === points.length - 1) {
        p0 = points[i - 1];
        p1 = points[i];
      }
    }

    var segDuration = p1.time - p0.time;
    var frac;
    if (segDuration <= 0) {
      frac = 0;
    } else {
      frac = (t - p0.time) / segDuration;
    }

    return {
      x: p0.x + (p1.x - p0.x) * frac,
      y: p0.y + (p1.y - p0.y) * frac
    };
  }

  // ============================================================
  // Voice
  // ============================================================

  function VectorVoice(sr) {
    this.sampleRate = sr;
    this.active = false;
    this.midiNote = -1;
    this.instId = 0;
    this.velocity = 1.0;

    // 4 source oscillator phases and phase increments
    this.phases = [0, 0, 0, 0];
    this.phaseIncs = [0, 0, 0, 0];
    this.waveforms = ['saw', 'square', 'triangle', 'sine'];

    // Vector position (0..1 normalized)
    this.vectorX = 0.5;
    this.vectorY = 0.5;

    // Vector envelope
    this.vectorEnvEnabled = false;
    this.vectorEnvLoop = false;
    this.vectorEnvPoints = null;
    this.vectorEnvTime = 0;  // ms elapsed since note on

    // ADSR amplitude envelope
    this.envStage = 0;
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

    // Time increment per sample (in ms)
    this.msPerSample = 1000.0 / sr;
  }

  VectorVoice.prototype.noteOn = function(midi, vel, freq, settings) {
    this.active = true;
    this.midiNote = midi;
    this.instId = settings.instId || 0;
    this.envStage = 0;
    this.envLevel = 0;
    this.envReleased = false;
    this.envFinished = false;

    // Setup 4 sources
    var sources = settings.sources;
    for (var s = 0; s < NUM_SOURCES; s++) {
      this.phases[s] = 0;
      var src = sources[s];
      this.waveforms[s] = src.waveform || 'sine';
      var detuneCents = src.detune || 0;
      var detuneMultiplier = Math.pow(2, detuneCents / 1200);
      this.phaseIncs[s] = (freq * detuneMultiplier) / this.sampleRate;
    }

    // Vector position
    this.vectorX = (settings.vectorX !== undefined ? settings.vectorX : 50) / 100;
    this.vectorY = (settings.vectorY !== undefined ? settings.vectorY : 50) / 100;

    // Vector envelope
    var vEnv = settings.vectorEnvelope;
    if (vEnv && vEnv.enabled && vEnv.points && vEnv.points.length > 0) {
      this.vectorEnvEnabled = true;
      this.vectorEnvLoop = vEnv.loop || false;
      this.vectorEnvPoints = vEnv.points;
      this.vectorEnvTime = 0;
    } else {
      this.vectorEnvEnabled = false;
      this.vectorEnvPoints = null;
      this.vectorEnvTime = 0;
    }

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

  VectorVoice.prototype.noteOff = function() {
    if (!this.envFinished) {
      this.envReleased = true;
      this.envStage = 3;
    }
  };

  VectorVoice.prototype.processEnvelope = function() {
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

  VectorVoice.prototype.process = function() {
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

    // Update vector position from envelope if enabled
    var vx = this.vectorX;
    var vy = this.vectorY;
    if (this.vectorEnvEnabled && this.vectorEnvPoints) {
      var envPos = evaluateVectorEnvelope(this.vectorEnvPoints, this.vectorEnvTime, this.vectorEnvLoop);
      vx = envPos.x / 100;
      vy = envPos.y / 100;
      this.vectorEnvTime += this.msPerSample;
    }

    // Compute bilinear weights
    var weights = bilinearWeights(vx, vy);

    // Generate and mix 4 sources
    var sample = 0;
    for (var s = 0; s < NUM_SOURCES; s++) {
      var srcSample = generateSample(this.waveforms[s], this.phases[s]);
      sample += srcSample * weights[s];

      this.phases[s] += this.phaseIncs[s];
      if (this.phases[s] >= 1.0) {
        this.phases[s] -= Math.floor(this.phases[s]);
      }
    }

    sample = sample * env * this.velocity;

    if (this.fadeInCounter < this.fadeInSamples) {
      sample *= this.fadeInCounter / this.fadeInSamples;
      this.fadeInCounter++;
    }

    return sample;
  };

  VectorVoice.prototype.isFinished = function() {
    return this.envFinished;
  };

  // ============================================================
  // Engine Init
  // ============================================================

  function init(ctx) {
    audioContext = ctx || (SL.audio && SL.audio.getCtx ? SL.audio.getCtx() : null);
    if (!audioContext) {
      console.error('[VECTOR] No AudioContext available');
      return Promise.reject(new Error('No AudioContext'));
    }

    return initFallback();
  }

  function initFallback() {
    var sr = audioContext.sampleRate;
    var bufSize = (SL.audio && SL.audio.getScriptProcessorBufferSize) ? SL.audio.getScriptProcessorBufferSize() : 1024;

    for (var i = 0; i < 4; i++) {
      fallbackVoicesByInst[i] = [];
      for (var v = 0; v < MAX_VOICES_PER_INSTRUMENT; v++) {
        fallbackVoicesByInst[i].push(new VectorVoice(sr));
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

    engineReady = true;
    return Promise.resolve(true);
  }

  // ============================================================
  // Connection
  // ============================================================

  function getOrCreateFilterNode(instId) {
    if (!audioContext) {
      return null;
    }
    if (!vectorFilterNodes[instId]) {
      var node = audioContext.createBiquadFilter();
      node.type = 'lowpass';
      node.frequency.value = 20000;
      node.Q.value = 0.707;
      vectorFilterNodes[instId] = node;
    }
    return vectorFilterNodes[instId];
  }

  function updateFilter(instId) {
    if (instId === undefined) {
      instId = 0;
    }
    var filterNode = vectorFilterNodes[instId];
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
  // Settings
  // ============================================================

  function getOrCreateSettings(instId) {
    if (!instrumentSettings[instId]) {
      instrumentSettings[instId] = JSON.parse(JSON.stringify(DEFAULT_VECTOR_SETTINGS));
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
      sources: settings.sources,
      vectorX: settings.vectorX,
      vectorY: settings.vectorY,
      vectorEnvelope: settings.vectorEnvelope,
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

  function setVectorX(instId, x) {
    var settings = getOrCreateSettings(instId);
    settings.vectorX = Math.max(0, Math.min(100, x));
    // Update active voices in real time
    var voices = fallbackVoicesByInst[instId];
    for (var i = 0; i < voices.length; i++) {
      if (voices[i].active && !voices[i].vectorEnvEnabled) {
        voices[i].vectorX = settings.vectorX / 100;
      }
    }
  }

  function setVectorY(instId, y) {
    var settings = getOrCreateSettings(instId);
    settings.vectorY = Math.max(0, Math.min(100, y));
    var voices = fallbackVoicesByInst[instId];
    for (var i = 0; i < voices.length; i++) {
      if (voices[i].active && !voices[i].vectorEnvEnabled) {
        voices[i].vectorY = settings.vectorY / 100;
      }
    }
  }

  function setSource(instId, index, waveform) {
    var settings = getOrCreateSettings(instId);
    if (index >= 0 && index < NUM_SOURCES) {
      if (waveform === 'sine' || waveform === 'saw' || waveform === 'square' ||
          waveform === 'triangle' || waveform === 'pulse' || waveform === 'noise') {
        settings.sources[index].waveform = waveform;
      }
    }
  }

  function setSourceDetune(instId, index, cents) {
    var settings = getOrCreateSettings(instId);
    if (index >= 0 && index < NUM_SOURCES) {
      settings.sources[index].detune = Math.max(-100, Math.min(100, cents));
    }
  }

  function setVectorEnvelope(instId, points) {
    var settings = getOrCreateSettings(instId);
    if (points && points.length > 0) {
      settings.vectorEnvelope.enabled = true;
      settings.vectorEnvelope.points = JSON.parse(JSON.stringify(points));
    } else {
      settings.vectorEnvelope.enabled = false;
    }
  }

  function setVectorEnvelopeLoop(instId, loop) {
    var settings = getOrCreateSettings(instId);
    settings.vectorEnvelope.loop = !!loop;
  }

  function enableVectorEnvelope(instId, enabled) {
    var settings = getOrCreateSettings(instId);
    settings.vectorEnvelope.enabled = !!enabled;
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
    return engineReady;
  }

  function getDefaultSettings() {
    return JSON.parse(JSON.stringify(DEFAULT_VECTOR_SETTINGS));
  }

  // ============================================================
  // Export
  // ============================================================

  SL.vector = {
    init: init,
    isReady: isReady,
    noteOn: noteOn,
    noteOff: noteOff,
    allNotesOff: allNotesOff,
    setVectorX: setVectorX,
    setVectorY: setVectorY,
    setSource: setSource,
    setSourceDetune: setSourceDetune,
    setVectorEnvelope: setVectorEnvelope,
    setVectorEnvelopeLoop: setVectorEnvelopeLoop,
    enableVectorEnvelope: enableVectorEnvelope,
    getSettings: getSettings,
    setSettings: setSettings,
    getDefaultSettings: getDefaultSettings,
    connectToOutput: connectToOutput,
    updateFilter: updateFilter,
    DEFAULT_VECTOR_SETTINGS: DEFAULT_VECTOR_SETTINGS,
    MAX_VOICES_PER_INSTRUMENT: MAX_VOICES_PER_INSTRUMENT,
    NUM_SOURCES: NUM_SOURCES
  };

})();
