// Super Synth Lab - Granular Synthesis Engine Module
// Generates a source buffer from oscillator waveforms, then schedules short grains
// with envelope windowing, pitch scatter, position scatter, and freeze mode.
// v1.0.0 - ScriptProcessor fallback, filter integration, per-instrument settings
(function() {
  'use strict';

  var SL = window.SynthLab;

  // ============================================================
  // Constants
  // ============================================================

  var MAX_VOICES_PER_INSTRUMENT = 16;
  var SOURCE_BUFFER_DURATION = 1.0; // seconds of source material
  var MAX_GRAINS_PER_VOICE = 16;   // max simultaneous grains per voice

  /** Default granular settings for a new instrument */
  var DEFAULT_GRANULAR_SETTINGS = {
    sourceWaveform: 'sine',
    grainSize: 50,         // ms (1-200)
    density: 20,           // grains per second (1-100)
    pitchScatter: 0,       // semitones (+/-12)
    positionScatter: 0,    // 0-100 (percentage of buffer)
    windowShape: 'hann',   // 'hann', 'triangle', 'rectangle'
    freeze: false,
    position: 50           // manual position (0-100)
  };

  // ============================================================
  // State
  // ============================================================

  var audioContext = null;
  var engineReady = false;

  // Per-instrument settings cache (instId -> settings object)
  var instrumentSettings = {};

  // Per-instrument source buffers (instId -> AudioBuffer)
  var sourceBuffers = {};

  // Per-instrument frozen buffer snapshots (instId -> { buffer: AudioBuffer, position: number })
  var frozenSnapshots = {};

  // Per-instrument voice state (instId -> array of voice objects)
  var voicesByInst = [[], [], [], []];

  // Per-instrument filter nodes (instId -> BiquadFilterNode)
  var granularFilterNodes = {};

  // Per-instrument output gain nodes (instId -> GainNode)
  var granularOutputNodes = {};

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
  // Source Buffer Generation
  // ============================================================

  /**
   * Generate a source buffer from an oscillator waveform
   * @param {string} waveform - 'sine', 'saw', 'square', 'triangle', 'noise'
   * @returns {AudioBuffer}
   */
  function generateSourceBuffer(waveform) {
    if (!audioContext) {
      return null;
    }
    var sr = audioContext.sampleRate;
    var length = Math.ceil(sr * SOURCE_BUFFER_DURATION);
    var buffer = audioContext.createBuffer(1, length, sr);
    var data = buffer.getChannelData(0);
    var TWO_PI = 2 * Math.PI;

    // Base frequency for source material (A3 = 220Hz gives a rich timbre)
    var baseFreq = 220;
    var phaseInc = baseFreq / sr;

    if (waveform === 'noise') {
      for (var i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
    } else if (waveform === 'sine') {
      for (var si = 0; si < length; si++) {
        data[si] = Math.sin(TWO_PI * phaseInc * si);
      }
    } else if (waveform === 'saw') {
      for (var sawi = 0; sawi < length; sawi++) {
        var sawPhase = (phaseInc * sawi) % 1.0;
        data[sawi] = 2.0 * sawPhase - 1.0;
      }
    } else if (waveform === 'square') {
      for (var sqi = 0; sqi < length; sqi++) {
        var sqPhase = (phaseInc * sqi) % 1.0;
        if (sqPhase < 0.5) {
          data[sqi] = 1.0;
        } else {
          data[sqi] = -1.0;
        }
      }
    } else if (waveform === 'triangle') {
      for (var tri = 0; tri < length; tri++) {
        var triPhase = (phaseInc * tri) % 1.0;
        if (triPhase < 0.5) {
          data[tri] = 4.0 * triPhase - 1.0;
        } else {
          data[tri] = 3.0 - 4.0 * triPhase;
        }
      }
    } else {
      // Default to sine
      for (var di = 0; di < length; di++) {
        data[di] = Math.sin(TWO_PI * phaseInc * di);
      }
    }

    return buffer;
  }

  /**
   * Get or create source buffer for an instrument
   */
  function getSourceBuffer(instId) {
    var settings = getOrCreateSettings(instId);
    var key = instId + '_' + settings.sourceWaveform;
    if (!sourceBuffers[key]) {
      sourceBuffers[key] = generateSourceBuffer(settings.sourceWaveform);
    }
    return sourceBuffers[key];
  }

  /**
   * Invalidate source buffer cache when waveform changes
   */
  function invalidateSourceBuffer(instId) {
    var keysToDelete = [];
    var prefix = instId + '_';
    for (var k in sourceBuffers) {
      if (sourceBuffers.hasOwnProperty(k) && k.indexOf(prefix) === 0) {
        keysToDelete.push(k);
      }
    }
    for (var d = 0; d < keysToDelete.length; d++) {
      delete sourceBuffers[keysToDelete[d]];
    }
  }

  // ============================================================
  // Window Functions
  // ============================================================

  /**
   * Create a window envelope buffer for grain windowing
   * @param {number} lengthSamples - grain length in samples
   * @param {string} shape - 'hann', 'triangle', 'rectangle'
   * @returns {Float32Array}
   */
  function createWindowEnvelope(lengthSamples, shape) {
    var env = new Float32Array(lengthSamples);
    var i;

    if (shape === 'rectangle') {
      for (i = 0; i < lengthSamples; i++) {
        env[i] = 1.0;
      }
    } else if (shape === 'triangle') {
      var half = lengthSamples / 2;
      for (i = 0; i < lengthSamples; i++) {
        if (i < half) {
          env[i] = i / half;
        } else {
          env[i] = 2.0 - (i / half);
        }
      }
    } else {
      // Hann window (default)
      var PI = Math.PI;
      for (i = 0; i < lengthSamples; i++) {
        env[i] = 0.5 * (1.0 - Math.cos(2 * PI * i / (lengthSamples - 1)));
      }
    }

    return env;
  }

  // ============================================================
  // Granular Voice
  // ============================================================

  function GranularVoice(sr) {
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

    // Grain scheduling state
    this.grainTimer = 0;          // samples until next grain
    this.grainIntervalSamples = 0; // samples between grains
    this.grainSizeSamples = 0;
    this.sourceBuffer = null;
    this.sourceData = null;
    this.sourceLength = 0;

    // Granular parameters (cached from settings)
    this.pitchScatter = 0;
    this.positionScatter = 0;
    this.position = 0.5;
    this.freeze = false;
    this.windowShape = 'hann';

    // Active grains pool
    this.grains = [];
    for (var g = 0; g < MAX_GRAINS_PER_VOICE; g++) {
      this.grains.push({
        active: false,
        readPos: 0,
        readInc: 1.0,
        samplesRemaining: 0,
        windowEnv: null,
        windowIdx: 0
      });
    }

    // Cached window envelope (reused across grains of same size/shape)
    this._cachedWindowEnv = null;
    this._cachedWindowSize = 0;
    this._cachedWindowShape = '';

    // Fade-in ramp
    this.fadeInSamples = 0;
    this.fadeInCounter = 0;

    // Per-voice timing stagger (humanization)
    this.startDelaySamples = 0;
  }

  GranularVoice.prototype.noteOn = function(midi, vel, freq, settings) {
    this.active = true;
    this.midiNote = midi;
    this.baseFreq = freq;
    this.instId = settings.instId || 0;
    this.envStage = 0;
    this.envLevel = 0;
    this.envReleased = false;
    this.envFinished = false;

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

    // Granular parameters
    var granSettings = settings.granularSettings || DEFAULT_GRANULAR_SETTINGS;
    var grainSizeMs = granSettings.grainSize || 50;
    var density = granSettings.density || 10;

    this.grainSizeSamples = Math.max(1, Math.ceil(grainSizeMs * this.sampleRate / 1000));
    this.grainIntervalSamples = Math.max(1, Math.ceil(this.sampleRate / density));
    this.grainTimer = 0; // Fire first grain immediately

    this.pitchScatter = granSettings.pitchScatter || 0;
    this.positionScatter = (granSettings.positionScatter || 0) / 100;
    this.position = (granSettings.position || 50) / 100;
    this.freeze = granSettings.freeze || false;
    this.windowShape = granSettings.windowShape || 'hann';

    // Source buffer
    this.sourceBuffer = settings.sourceBuffer;
    if (this.sourceBuffer) {
      this.sourceData = this.sourceBuffer.getChannelData(0);
      this.sourceLength = this.sourceData.length;
    } else {
      this.sourceData = null;
      this.sourceLength = 0;
    }

    // Pitch ratio: how much to shift based on MIDI note vs base (A3=220Hz)
    // The source buffer was generated at 220Hz, so we need to adjust playback rate
    this.basePitchRatio = freq / 220.0;

    // Reset all grains
    for (var g = 0; g < MAX_GRAINS_PER_VOICE; g++) {
      this.grains[g].active = false;
    }
  };

  GranularVoice.prototype.noteOff = function() {
    if (!this.envFinished) {
      this.envReleased = true;
      this.envStage = 3;
    }
  };

  GranularVoice.prototype.processEnvelope = function() {
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

  GranularVoice.prototype.spawnGrain = function() {
    // Find a free grain slot
    var grain = null;
    for (var g = 0; g < MAX_GRAINS_PER_VOICE; g++) {
      if (!this.grains[g].active) {
        grain = this.grains[g];
        break;
      }
    }
    if (!grain) {
      // No free grain slots; steal the oldest (first active)
      for (var gs = 0; gs < MAX_GRAINS_PER_VOICE; gs++) {
        if (this.grains[gs].active) {
          grain = this.grains[gs];
          break;
        }
      }
    }
    if (!grain || !this.sourceData) {
      return;
    }

    // Calculate start position in buffer
    var basePos = this.position;
    if (!this.freeze) {
      // Non-freeze: use position with scatter
      basePos = this.position;
    }
    var scatter = 0;
    if (this.positionScatter > 0) {
      scatter = (Math.random() * 2 - 1) * this.positionScatter;
    }
    var startFraction = basePos + scatter;
    if (startFraction < 0) { startFraction = 0; }
    if (startFraction > 1) { startFraction = 1; }
    var startSample = Math.floor(startFraction * (this.sourceLength - this.grainSizeSamples));
    if (startSample < 0) { startSample = 0; }

    // Pitch scatter
    var pitchRatio = this.basePitchRatio;
    if (this.pitchScatter > 0) {
      var semitoneOffset = (Math.random() * 2 - 1) * this.pitchScatter;
      pitchRatio *= Math.pow(2, semitoneOffset / 12);
    }

    grain.active = true;
    grain.readPos = startSample;
    grain.readInc = pitchRatio;
    grain.samplesRemaining = this.grainSizeSamples;
    // Reuse cached window envelope when grain size and shape match
    if (this._cachedWindowSize !== this.grainSizeSamples || this._cachedWindowShape !== this.windowShape) {
      this._cachedWindowEnv = createWindowEnvelope(this.grainSizeSamples, this.windowShape);
      this._cachedWindowSize = this.grainSizeSamples;
      this._cachedWindowShape = this.windowShape;
    }
    grain.windowEnv = this._cachedWindowEnv;
    grain.windowIdx = 0;
  };

  GranularVoice.prototype.process = function() {
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

    // Schedule new grains
    if (this.grainTimer <= 0) {
      this.spawnGrain();
      this.grainTimer = this.grainIntervalSamples;
    }
    this.grainTimer--;

    // Mix all active grains
    var sample = 0;
    for (var g = 0; g < MAX_GRAINS_PER_VOICE; g++) {
      var grain = this.grains[g];
      if (grain.active) {
        // Read from source buffer with linear interpolation
        var readInt = Math.floor(grain.readPos);
        var readFrac = grain.readPos - readInt;
        var s0 = 0;
        var s1 = 0;
        if (readInt >= 0 && readInt < this.sourceLength) {
          s0 = this.sourceData[readInt];
        }
        if (readInt + 1 >= 0 && readInt + 1 < this.sourceLength) {
          s1 = this.sourceData[readInt + 1];
        }
        var interpolated = s0 + (s1 - s0) * readFrac;

        // Apply window envelope
        var windowGain = 1.0;
        if (grain.windowEnv && grain.windowIdx < grain.windowEnv.length) {
          windowGain = grain.windowEnv[grain.windowIdx];
        }

        sample += interpolated * windowGain;

        // Advance read position
        grain.readPos += grain.readInc;
        grain.windowIdx++;
        grain.samplesRemaining--;

        if (grain.samplesRemaining <= 0) {
          grain.active = false;
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

  GranularVoice.prototype.isFinished = function() {
    return this.envFinished;
  };

  // ============================================================
  // Engine Initialization
  // ============================================================

  function init(ctx) {
    audioContext = ctx || (SL.audio && SL.audio.getCtx ? SL.audio.getCtx() : null);
    if (!audioContext) {
      console.error('[GRANULAR] No AudioContext available');
      return Promise.reject(new Error('No AudioContext'));
    }

    return initFallback();
  }

  function initFallback() {
    var sr = audioContext.sampleRate;
    var bufSize = (SL.audio && SL.audio.getScriptProcessorBufferSize) ? SL.audio.getScriptProcessorBufferSize() : 1024;

    // Pre-allocate per-instrument voice pools
    for (var i = 0; i < 4; i++) {
      voicesByInst[i] = [];
      for (var v = 0; v < MAX_VOICES_PER_INSTRUMENT; v++) {
        voicesByInst[i].push(new GranularVoice(sr));
      }

      // Create output gain node per instrument
      granularOutputNodes[i] = audioContext.createGain();
      granularOutputNodes[i].gain.value = 1.5; // Boosted from 0.8 for louder presets
    }

    // Create 4 per-instrument ScriptProcessor nodes
    for (var idx = 0; idx < 4; idx++) {
      (function(instIdx) {
        var node = audioContext.createScriptProcessor(bufSize, 0, 1);
        var voices = voicesByInst[instIdx];
        node.onaudioprocess = function(event) {
          var output = event.outputBuffer.getChannelData(0);
          for (var s = 0; s < output.length; s++) {
            var sampleOut = 0;
            var activeCount = 0;
            for (var vi = 0; vi < voices.length; vi++) {
              if (voices[vi].active) {
                sampleOut += voices[vi].process();
                activeCount++;
              }
            }
            // Normalize by active voice count to prevent clipping with polyphony
            if (activeCount > 0) {
              sampleOut *= 0.35 / Math.sqrt(activeCount);
            }
            // Soft clip (Pade approximant of tanh)
            var ss = sampleOut * sampleOut;
            output[s] = sampleOut * (27 + ss) / (27 + 9 * ss);
          }
        };

        // Connect ScriptProcessor -> output gain
        node.connect(granularOutputNodes[instIdx]);
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
    if (!granularFilterNodes[instId]) {
      var node = audioContext.createBiquadFilter();
      node.type = 'lowpass';
      node.frequency.value = 20000;
      node.Q.value = 0.707;
      granularFilterNodes[instId] = node;
    }
    return granularFilterNodes[instId];
  }

  function updateFilter(instId) {
    if (instId === undefined) {
      instId = 0;
    }
    var filterNode = granularFilterNodes[instId];
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
    // If output node not created yet (engine not initialized), skip
    if (!granularOutputNodes[instId]) {
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
        granularOutputNodes[instId].connect(filterNode);
        filterNode.connect(destination);
      } else {
        granularOutputNodes[instId].connect(destination);
      }

      connectedInsts[instId] = true;
    }
  }

  // ============================================================
  // Settings Management
  // ============================================================

  function getOrCreateSettings(instId) {
    if (!instrumentSettings[instId]) {
      instrumentSettings[instId] = JSON.parse(JSON.stringify(DEFAULT_GRANULAR_SETTINGS));
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

    // Get source buffer (use frozen snapshot if freeze is active)
    var srcBuffer;
    if (settings.freeze && frozenSnapshots[instId]) {
      srcBuffer = frozenSnapshots[instId].buffer;
    } else {
      srcBuffer = getSourceBuffer(instId);
    }

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
      granularSettings: settings,
      sourceBuffer: srcBuffer
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
      // Prefer stealing a voice in release state over one still sustaining
      var stealIdx = 0;
      var foundReleasing = false;
      for (var si = 0; si < voices.length; si++) {
        if (voices[si].releasing) {
          stealIdx = si;
          foundReleasing = true;
          break;
        }
      }
      if (!foundReleasing) {
        // Steal the voice with the lowest envelope level (quietest)
        var lowestLevel = 2.0;
        for (var qi = 0; qi < voices.length; qi++) {
          var envLevel = voices[qi].envLevel || 1.0;
          if (envLevel < lowestLevel) {
            lowestLevel = envLevel;
            stealIdx = qi;
          }
        }
      }
      voice = voices[stealIdx];
      voice.active = false; // force-stop before reuse
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

  function setGrainSize(instId, sizeMs) {
    var settings = getOrCreateSettings(instId);
    settings.grainSize = Math.max(1, Math.min(200, sizeMs));
  }

  function setDensity(instId, density) {
    var settings = getOrCreateSettings(instId);
    settings.density = Math.max(1, Math.min(100, density));
  }

  function setPitchScatter(instId, semitones) {
    var settings = getOrCreateSettings(instId);
    settings.pitchScatter = Math.max(0, Math.min(12, semitones));
  }

  function setPositionScatter(instId, scatter) {
    var settings = getOrCreateSettings(instId);
    settings.positionScatter = Math.max(0, Math.min(100, scatter));
  }

  function setWindowShape(instId, shape) {
    var settings = getOrCreateSettings(instId);
    if (shape === 'hann' || shape === 'triangle' || shape === 'rectangle') {
      settings.windowShape = shape;
    }
  }

  function setFreeze(instId, frozen) {
    var settings = getOrCreateSettings(instId);
    var wasFrozen = settings.freeze;
    settings.freeze = !!frozen;

    if (settings.freeze && !wasFrozen) {
      // Capture the current buffer state as a frozen snapshot
      captureFreeze(instId);
    } else if (!settings.freeze && wasFrozen) {
      // Release the frozen snapshot
      delete frozenSnapshots[instId];
    }
  }

  function isFreeze(instId) {
    var settings = getOrCreateSettings(instId);
    return !!settings.freeze;
  }

  /**
   * Capture a snapshot of the current source buffer for freeze mode.
   * Copies the audio data so the frozen texture is independent of
   * any subsequent waveform changes.
   */
  function captureFreeze(instId) {
    if (!audioContext) {
      return;
    }
    var srcBuffer = getSourceBuffer(instId);
    if (!srcBuffer) {
      return;
    }
    var settings = getOrCreateSettings(instId);
    var sr = audioContext.sampleRate;
    var srcData = srcBuffer.getChannelData(0);
    var length = srcData.length;

    // Create a copy of the source buffer
    var frozenBuffer = audioContext.createBuffer(1, length, sr);
    var frozenData = frozenBuffer.getChannelData(0);
    for (var i = 0; i < length; i++) {
      frozenData[i] = srcData[i];
    }

    frozenSnapshots[instId] = {
      buffer: frozenBuffer,
      position: settings.position
    };

    // Update all active voices for this instrument to use the frozen buffer
    var voices = voicesByInst[instId];
    if (voices) {
      for (var v = 0; v < voices.length; v++) {
        if (voices[v].active && voices[v].instId === instId) {
          voices[v].sourceBuffer = frozenBuffer;
          voices[v].sourceData = frozenData;
          voices[v].sourceLength = length;
          voices[v].freeze = true;
          voices[v].position = settings.position / 100;
        }
      }
    }
  }

  function setPosition(instId, position) {
    var settings = getOrCreateSettings(instId);
    settings.position = Math.max(0, Math.min(100, position));

    // When frozen, update active voices' position in real-time for scrubbing
    if (settings.freeze) {
      var voices = voicesByInst[instId];
      if (voices) {
        for (var v = 0; v < voices.length; v++) {
          if (voices[v].active && voices[v].instId === instId) {
            voices[v].position = settings.position / 100;
          }
        }
      }
    }
  }

  function setSourceWaveform(instId, waveform) {
    var settings = getOrCreateSettings(instId);
    if (waveform === 'sine' || waveform === 'saw' || waveform === 'square' || waveform === 'triangle' || waveform === 'noise') {
      settings.sourceWaveform = waveform;
      invalidateSourceBuffer(instId);
    }
  }

  function getSettings(instId) {
    return JSON.parse(JSON.stringify(getOrCreateSettings(instId)));
  }

  function setSettings(instId, settings) {
    instrumentSettings[instId] = JSON.parse(JSON.stringify(settings));
    invalidateSourceBuffer(instId);
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
      for (var idx = 0; idx < 4; idx++) {
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
    return engineReady;
  }

  function getDefaultSettings() {
    return JSON.parse(JSON.stringify(DEFAULT_GRANULAR_SETTINGS));
  }

  // ============================================================
  // Export to SynthLab Namespace
  // ============================================================

  SL.granular = {
    // Initialization
    init: init,
    isReady: isReady,

    // Note control
    noteOn: noteOn,
    noteOff: noteOff,
    allNotesOff: allNotesOff,

    // Parameter control
    setGrainSize: setGrainSize,
    setDensity: setDensity,
    setPitchScatter: setPitchScatter,
    setPositionScatter: setPositionScatter,
    setWindowShape: setWindowShape,
    setFreeze: setFreeze,
    isFreeze: isFreeze,
    captureFreeze: captureFreeze,
    setPosition: setPosition,
    setSourceWaveform: setSourceWaveform,

    // Settings management
    getSettings: getSettings,
    setSettings: setSettings,
    getDefaultSettings: getDefaultSettings,

    // Connection & filter
    connectToOutput: connectToOutput,
    updateFilter: updateFilter,

    // Constants
    DEFAULT_GRANULAR_SETTINGS: DEFAULT_GRANULAR_SETTINGS,
    MAX_VOICES_PER_INSTRUMENT: MAX_VOICES_PER_INSTRUMENT
  };

})();
