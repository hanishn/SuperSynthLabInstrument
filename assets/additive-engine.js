// Super Synth Lab - Additive Synthesis Engine Module
// 16-partial additive synthesis with PeriodicWave, quick-set waveforms, drawbar mode
// v1.0.0 - ScriptProcessor fallback, filter integration, organ drawbar mapping
(function() {
  'use strict';

  var SL = window.SynthLab;

  // ============================================================
  // Constants
  // ============================================================

  var MAX_VOICES_PER_INSTRUMENT = 16;
  var NUM_PARTIALS = 16;

  // Hammond organ drawbar footages mapped to harmonic ratios
  // Drawbars: 16', 5-1/3', 8', 4', 2-2/3', 2', 1-3/5', 1-1/3', 1'
  // Harmonic multipliers: 0.5, 1.5, 1, 2, 3, 4, 5, 6, 8
  var DRAWBAR_RATIOS = [0.5, 1.5, 1, 2, 3, 4, 5, 6, 8];
  var NUM_DRAWBARS = 9;

  /** Default additive settings for a new instrument */
  var DEFAULT_ADDITIVE_SETTINGS = {
    partials: (function() {
      var arr = [];
      for (var i = 0; i < NUM_PARTIALS; i++) {
        arr.push({
          amplitude: (i === 0) ? 1.0 : 0.0,
          ratio: i + 1,
          phase: 0
        });
      }
      return arr;
    })(),
    drawbarMode: false,
    drawbars: [8, 0, 8, 0, 0, 0, 0, 0, 0]  // Classic organ: 16' and 8' full
  };

  // ============================================================
  // Quick-Set Waveform Definitions (Fourier series coefficients)
  // ============================================================

  /**
   * Compute Fourier series amplitudes for classic waveforms
   * @param {string} type - 'sine', 'saw', 'square', 'triangle', 'clear'
   * @param {number} numPartials - number of partials
   * @returns {Array} array of {amplitude, ratio, phase} objects
   */
  function getQuickSetPartials(type, numPartials) {
    var partials = [];
    for (var i = 0; i < numPartials; i++) {
      var h = i + 1; // harmonic number (1-based)
      var amp = 0;
      var phase = 0;

      if (type === 'sine') {
        if (h === 1) {
          amp = 1.0;
        }
      } else if (type === 'saw') {
        // Sawtooth: sum of 1/h for all harmonics
        amp = 1.0 / h;
      } else if (type === 'square') {
        // Square: only odd harmonics, amplitude 1/h
        if (h % 2 === 1) {
          amp = 1.0 / h;
        }
      } else if (type === 'triangle') {
        // Triangle: only odd harmonics, amplitude 1/h^2, alternating sign
        if (h % 2 === 1) {
          var k = (h - 1) / 2;
          amp = 1.0 / (h * h);
          if (k % 2 === 1) {
            phase = Math.PI; // negate via phase
          }
        }
      }
      // 'clear' leaves amp = 0

      partials.push({
        amplitude: amp,
        ratio: h,
        phase: phase
      });
    }
    return partials;
  }

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
  var additiveFilterNodes = {};

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
  // Fallback Voice (ScriptProcessor - main thread synthesis)
  // ============================================================

  function AdditiveVoice(sr) {
    this.sampleRate = sr;
    this.active = false;
    this.midiNote = -1;
    this.instId = 0;
    this.baseFreq = 440;
    this.velocity = 1.0;

    // Partial state
    this.partialPhases = new Float64Array(NUM_PARTIALS);
    this.partialAmplitudes = new Float64Array(NUM_PARTIALS);
    this.partialRatios = new Float64Array(NUM_PARTIALS);

    // ADSR envelope state
    this.envStage = 0;  // 0=attack, 1=decay, 2=sustain, 3=release
    this.envLevel = 0;
    this.envTarget = 1.0;
    this.envReleased = false;
    this.envFinished = false;
    this.attackRate = 0;
    this.decayRate = 0;
    this.sustainLevel = 0.7;
    this.releaseRate = 0;

    // Fade-in ramp to prevent click/pop at note onset
    this.fadeInSamples = 0;
    this.fadeInCounter = 0;

    // Per-voice timing stagger (humanization)
    this.startDelaySamples = 0;
  }

  AdditiveVoice.prototype.noteOn = function(midi, vel, freq, settings) {
    this.active = true;
    this.midiNote = midi;
    this.baseFreq = freq;
    this.instId = settings.instId || 0;
    this.envStage = 0;
    this.envLevel = 0;
    this.envReleased = false;
    this.envFinished = false;

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

    // ADSR from settings
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

    var safeAttack = Math.max(0.001, aTime);
    var safeDecay = Math.max(0.001, dTime);
    var safeRelease = Math.max(0.001, rTime);
    this.attackRate = 1.0 / (safeAttack * this.sampleRate);
    this.decayRate = 1.0 / (safeDecay * this.sampleRate);
    this.sustainLevel = sLevel;
    this.releaseRate = 1.0 / (safeRelease * this.sampleRate);

    // Copy partial settings
    var partials = settings.partials;
    var nyquist = this.sampleRate / 2;
    for (var i = 0; i < NUM_PARTIALS; i++) {
      if (i < partials.length) {
        var partialFreq = freq * partials[i].ratio;
        // Zero out partials above Nyquist
        if (partialFreq >= nyquist) {
          this.partialAmplitudes[i] = 0;
        } else {
          this.partialAmplitudes[i] = partials[i].amplitude;
        }
        this.partialRatios[i] = partials[i].ratio;
        this.partialPhases[i] = partials[i].phase || 0;
      } else {
        this.partialAmplitudes[i] = 0;
        this.partialRatios[i] = i + 1;
        this.partialPhases[i] = 0;
      }
    }
  };

  AdditiveVoice.prototype.noteOff = function() {
    if (!this.envFinished) {
      this.envReleased = true;
      this.envStage = 3;
    }
  };

  AdditiveVoice.prototype.processEnvelope = function() {
    if (this.envFinished) {
      return 0;
    }

    if (this.envStage === 0) {
      // Attack
      this.envLevel += this.attackRate;
      if (this.envLevel >= 1.0) {
        this.envLevel = 1.0;
        this.envStage = 1;
      }
    } else if (this.envStage === 1) {
      // Decay
      this.envLevel -= this.decayRate * (1.0 - this.sustainLevel);
      if (this.envLevel <= this.sustainLevel) {
        this.envLevel = this.sustainLevel;
        this.envStage = 2;
      }
    } else if (this.envStage === 2) {
      // Sustain (hold level)
    } else if (this.envStage === 3) {
      // Release
      this.envLevel -= this.releaseRate * this.envLevel;
      if (this.envLevel <= 0.0001) {
        this.envLevel = 0;
        this.envFinished = true;
      }
    }

    return this.envLevel;
  };

  AdditiveVoice.prototype.process = function() {
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

    var sample = 0;
    var TWO_PI = 2 * Math.PI;
    for (var i = 0; i < NUM_PARTIALS; i++) {
      if (this.partialAmplitudes[i] > 0) {
        sample += this.partialAmplitudes[i] * Math.sin(TWO_PI * this.partialPhases[i]);
        this.partialPhases[i] += (this.baseFreq * this.partialRatios[i]) / this.sampleRate;
        // Wrap phase to prevent floating point drift
        if (this.partialPhases[i] >= 1.0) {
          this.partialPhases[i] -= Math.floor(this.partialPhases[i]);
        }
      }
    }

    sample *= env * this.velocity;

    // Apply fade-in ramp
    if (this.fadeInCounter < this.fadeInSamples) {
      sample *= this.fadeInCounter / this.fadeInSamples;
      this.fadeInCounter++;
    }

    return sample;
  };

  AdditiveVoice.prototype.isFinished = function() {
    return this.envFinished;
  };

  // ============================================================
  // Engine Initialization
  // ============================================================

  function init(ctx) {
    audioContext = ctx || (SL.audio && SL.audio.getCtx ? SL.audio.getCtx() : null);
    if (!audioContext) {
      console.error('[ADDITIVE] No AudioContext available');
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
        fallbackVoicesByInst[i].push(new AdditiveVoice(sr));
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
    if (!additiveFilterNodes[instId]) {
      var node = audioContext.createBiquadFilter();
      node.type = 'lowpass';
      node.frequency.value = 20000;
      node.Q.value = 0.707;
      additiveFilterNodes[instId] = node;
    }
    return additiveFilterNodes[instId];
  }

  function updateFilter(instId) {
    if (instId === undefined) {
      instId = 0;
    }
    var filterNode = additiveFilterNodes[instId];
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
    // If engine not ready or script node not created yet, skip
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
      instrumentSettings[instId] = JSON.parse(JSON.stringify(DEFAULT_ADDITIVE_SETTINGS));
    }
    return instrumentSettings[instId];
  }

  // ============================================================
  // Drawbar Mode Helpers
  // ============================================================

  /**
   * Convert drawbar values (0-8 each) to partial amplitudes
   * Maps the 9 drawbar positions to their harmonic ratios
   * @param {Array} drawbars - array of 9 values (0-8)
   * @returns {Array} partial settings array
   */
  function drawbarsToPartials(drawbars) {
    var partials = [];
    for (var i = 0; i < NUM_PARTIALS; i++) {
      partials.push({
        amplitude: 0,
        ratio: i + 1,
        phase: 0
      });
    }

    // Map each drawbar to its corresponding harmonic
    for (var d = 0; d < NUM_DRAWBARS; d++) {
      var amp = drawbars[d] / 8;
      var ratio = DRAWBAR_RATIOS[d];

      // Find the closest partial slot for this ratio
      var bestIdx = -1;
      var bestDist = Infinity;
      for (var p = 0; p < NUM_PARTIALS; p++) {
        var dist = Math.abs(partials[p].ratio - ratio);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = p;
        }
      }

      if (bestIdx >= 0) {
        // Set the ratio to the exact drawbar ratio and add amplitude
        partials[bestIdx].ratio = ratio;
        partials[bestIdx].amplitude = Math.max(partials[bestIdx].amplitude, amp);
      }
    }

    return partials;
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

    // Determine partials to use (drawbar mode or direct partials)
    var partials;
    if (settings.drawbarMode) {
      partials = drawbarsToPartials(settings.drawbars);
    } else {
      partials = settings.partials;
    }

    var voiceSettings = {
      instId: instId,
      partials: partials,
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

  function setPartial(instId, partialIndex, params) {
    if (partialIndex < 0 || partialIndex >= NUM_PARTIALS) {
      return;
    }
    var settings = getOrCreateSettings(instId);
    var partial = settings.partials[partialIndex];

    if (params.amplitude !== undefined) {
      partial.amplitude = Math.max(0, Math.min(1, params.amplitude));
    }
    if (params.ratio !== undefined) {
      partial.ratio = Math.max(0.5, Math.min(32, params.ratio));
    }
    if (params.phase !== undefined) {
      partial.phase = params.phase;
    }
  }

  function setDrawbar(instId, drawbarIndex, value) {
    if (drawbarIndex < 0 || drawbarIndex >= NUM_DRAWBARS) {
      return;
    }
    var settings = getOrCreateSettings(instId);
    settings.drawbars[drawbarIndex] = Math.max(0, Math.min(8, Math.round(value)));
  }

  function setDrawbarMode(instId, enabled) {
    var settings = getOrCreateSettings(instId);
    settings.drawbarMode = !!enabled;
  }

  function applyQuickSet(instId, type) {
    var settings = getOrCreateSettings(instId);
    var newPartials = getQuickSetPartials(type, NUM_PARTIALS);
    settings.partials = newPartials;
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
    return JSON.parse(JSON.stringify(DEFAULT_ADDITIVE_SETTINGS));
  }

  // ============================================================
  // Export to SynthLab Namespace
  // ============================================================

  SL.additive = {
    // Initialization
    init: init,
    isReady: isReady,

    // Note control
    noteOn: noteOn,
    noteOff: noteOff,
    allNotesOff: allNotesOff,

    // Parameter control
    setPartial: setPartial,
    setDrawbar: setDrawbar,
    setDrawbarMode: setDrawbarMode,
    applyQuickSet: applyQuickSet,

    // Settings management
    getSettings: getSettings,
    setSettings: setSettings,
    getDefaultSettings: getDefaultSettings,

    // Quick-set helper
    getQuickSetPartials: getQuickSetPartials,

    // Drawbar helpers
    drawbarsToPartials: drawbarsToPartials,

    // Connection & filter
    connectToOutput: connectToOutput,
    updateFilter: updateFilter,

    // Constants
    DEFAULT_ADDITIVE_SETTINGS: DEFAULT_ADDITIVE_SETTINGS,
    MAX_VOICES_PER_INSTRUMENT: MAX_VOICES_PER_INSTRUMENT,
    NUM_PARTIALS: NUM_PARTIALS,
    NUM_DRAWBARS: NUM_DRAWBARS,
    DRAWBAR_RATIOS: DRAWBAR_RATIOS
  };

})();
