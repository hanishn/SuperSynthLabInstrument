// Super Synth Lab - Reed Instrument Synthesis Engine Module
// Digital waveguide reed models: single reed (clarinet), double reed (oboe),
// saxophone (single reed + conical bore), harmonica (free reed)
// v1.0.0 - ScriptProcessor, 16-voice polyphony, 4 reed types, cubic nonlinearity
(function() {
  'use strict';

  var SL = window.SynthLab;

  // ============================================================
  // Constants
  // ============================================================

  var MAX_VOICES_PER_INSTRUMENT = 16;

  var REED_TYPES = {
    clarinet:  { name: 'Single Reed (Clarinet)',  bore: 'cylindrical', overblow: 3 },
    oboe:      { name: 'Double Reed (Oboe)',       bore: 'conical',     overblow: 2 },
    saxophone: { name: 'Saxophone',                bore: 'conical',     overblow: 2 },
    harmonica: { name: 'Harmonica (Free Reed)',    bore: 'none',        overblow: 1 }
  };

  var REED_TYPE_LIST = ['clarinet', 'oboe', 'saxophone', 'harmonica'];

  /** Default reed settings for a new instrument */
  var DEFAULT_REED_SETTINGS = {
    reedType: 'clarinet',
    reedStiffness: 50,
    embouchurePressure: 50,
    register: 'normal',
    vibratoRate: 5.0,
    vibratoDepth: 20,
    breathNoise: 25,
    adsr: { a: 5, d: 80, s: 80, r: 150 }
  };

  // ============================================================
  // State
  // ============================================================

  var audioContext = null;
  var scriptNodes = [null, null, null, null];
  var fallbackVoicesByInst = [[], [], [], []];
  var engineReady = false;

  // Per-instrument settings cache (instId -> settings object)
  var instrumentSettings = {};

  // Per-instrument filter nodes (instId -> BiquadFilterNode)
  var reedFilterNodes = {};

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
  // DSP Primitives
  // ============================================================

  function CircularBuffer(maxLen) {
    this.buffer = new Float64Array(maxLen);
    this.length = maxLen;
    this.writeIndex = 0;
  }
  CircularBuffer.prototype.write = function(v) {
    this.buffer[this.writeIndex] = v;
    this.writeIndex = (this.writeIndex + 1) % this.length;
  };
  CircularBuffer.prototype.read = function(delay) {
    var intDelay = Math.floor(delay);
    var frac = delay - intDelay;
    var idx0 = (this.writeIndex - intDelay - 1 + this.length * 2) % this.length;
    var idx1 = (idx0 - 1 + this.length) % this.length;
    return this.buffer[idx0] * (1 - frac) + this.buffer[idx1] * frac;
  };
  CircularBuffer.prototype.clear = function() {
    this.buffer.fill(0);
    this.writeIndex = 0;
  };

  function OnePole() { this.a = 0.5; this.prev = 0; }
  OnePole.prototype.setCoeff = function(a) { this.a = Math.max(0, Math.min(1, a)); };
  OnePole.prototype.process = function(x) { this.prev = this.a * x + (1 - this.a) * this.prev; return this.prev; };
  OnePole.prototype.clear = function() { this.prev = 0; };

  function DCBlocker() { this.x1 = 0; this.y1 = 0; this.R = 0.995; }
  DCBlocker.prototype.process = function(x) { var y = x - this.x1 + this.R * this.y1; this.x1 = x; this.y1 = y; return y; };
  DCBlocker.prototype.clear = function() { this.x1 = 0; this.y1 = 0; };

  // ============================================================
  // Reed Reflection Function
  // ============================================================

  /**
   * Cubic nonlinearity modeling reed reflection.
   * At low amplitudes: nearly linear (reed open).
   * At high amplitudes: saturates (reed closes against mouthpiece).
   * Stiffness controls the slope and saturation point.
   */
  function reedReflection(pressure, stiffness) {
    // stiffness 0-1: low = soft/responsive, high = stiff/bright
    var slope = 0.7 + stiffness * 1.3;   // 0.7 to 2.0
    var x = pressure * slope;
    // Cubic nonlinearity: x - x^3 (soft clip)
    var out = x - x * x * x * 0.33;
    if (out > 1.0) {
      out = 1.0;
    } else if (out < -1.0) {
      out = -1.0;
    }
    return out;
  }

  // ============================================================
  // Reed Voice
  // ============================================================

  function ReedVoice(sr) {
    this.sampleRate = sr;
    this.active = false;
    this.midiNote = -1;
    this.instId = 0;

    // Waveguide delay lines
    var maxDelay = Math.ceil(sr / 20);
    this.boreDelay = new CircularBuffer(maxDelay);
    this.boreDelay2 = new CircularBuffer(maxDelay);  // For conical bore second reflection

    // Filters
    this.loopFilter = new OnePole();
    this.toneFilter = new OnePole();
    this.noiseFilter = new OnePole();
    this.dcBlocker = new DCBlocker();

    // State
    this.blowing = false;
    this.decayCounter = 0;
    this.maxDecay = 0;
    this.silenceCounter = 0;
    this.lastOutput = 0;

    // Derived parameters (set per note)
    this.boreLength = 100;
    this.boreLength2 = 50;
    this.reedStiffness = 0.5;
    this.embouchurePressure = 0.5;
    this.breathTarget = 0.5;
    this.breathEnvelope = 0;
    this.breathAttackRate = 0;
    this.noiseGain = 0.1;
    this.feedback = 0.995;
    this.reedType = 'clarinet';
    this.boreType = 'cylindrical';
    this.overblowRatio = 3;
    this.isOverblown = false;
    this.outputGain = 1.0;
    this.releaseGain = 1.0;

    // Vibrato
    this.vibratoPhase = 0;
    this.vibratoFreq = 5.0;
    this.vibratoDepth = 0;
    this.maxVibratoDepth = 0.3;

    // ADSR envelope
    this.envStage = 0;
    this.envLevel = 0;
    this.envReleased = false;
    this.envFinished = false;
    this.attackRate = 0;
    this.decayRate = 0;
    this.sustainLevel = 0.8;
    this.releaseRate = 0;

    // Conical bore parameters
    this.conicalReflection = 0.0;
    this.conicalMix = 0.0;
  }

  ReedVoice.prototype.noteOn = function(midi, vel, freq, settings) {
    this.active = true;
    this.blowing = true;
    this.midiNote = midi;
    this.instId = settings.instId || 0;

    this.reedType = settings.reedType || 'clarinet';
    var typeInfo = REED_TYPES[this.reedType] || REED_TYPES.clarinet;
    this.boreType = typeInfo.bore;
    this.overblowRatio = typeInfo.overblow;

    this.isOverblown = (settings.register === 'overblown');

    var velocity = (vel || 100) / 127;
    var stiffness = (settings.reedStiffness || 50) / 100;
    var embPressure = (settings.embouchurePressure || 50) / 100;
    var vibratoRate = settings.vibratoRate || 5.0;
    var vibratoDepthPct = (settings.vibratoDepth || 20) / 100;
    var breathNoise = (settings.breathNoise || 25) / 100;

    this.reedStiffness = stiffness;
    this.embouchurePressure = embPressure;

    // Compute bore length from frequency.
    // Digital waveguide with reed (pressure-reflecting) end and open bell:
    // the feedback loop contains ONE sign inversion (reed subtraction),
    // so a single delay line of length = period/2 resonates at the
    // fundamental. Using the full period detunes the tube an octave low
    // and lets odd overtones (e.g. 7th partial = 3.5x target) dominate.
    // Reference: STK Clarinet uses delay = sampleRate/freq * 0.5 - 1.5.
    var HALF_PERIOD = 0.5;
    var LOOP_FILTER_DELAY_SAMPLES = 1.5;
    var MIN_BORE_LENGTH = 3.0;
    var CONICAL_BORE2_RATIO = 0.72;
    var effectiveFreq = freq;
    if (this.isOverblown) {
      effectiveFreq = freq / this.overblowRatio;
    }
    var period = this.sampleRate / effectiveFreq;
    // Bore length: with one round-trip inversion in the reed waveguide loop
    // (the subtraction in pressureDiff = excitation - filteredBore), a delay
    // of N samples resonates at sampleRate/(2N). So N = period/2 places the
    // fundamental at the played frequency for both cylindrical and conical.
    var rawBoreLength = (period * HALF_PERIOD) - LOOP_FILTER_DELAY_SAMPLES;
    this.boreLength = Math.max(MIN_BORE_LENGTH, rawBoreLength);

    // Conical bore: small impedance-mismatch coloration via short auxiliary
    // delay. Mix kept small (0.10) and length close to the primary bore so
    // the conical contribution adds harmonic richness without pulling the
    // primary oscillator off the fundamental. Higher mix values caused the
    // secondary loop to lock instruments to the second bore's resonance
    // (~900 Hz for oboe/sax at C3) instead of the played pitch.
    if (this.boreType === 'conical') {
      var CONICAL_BORE2_OFFSET_SAMPLES = 3.0;
      this.boreLength2 = Math.max(MIN_BORE_LENGTH, this.boreLength - CONICAL_BORE2_OFFSET_SAMPLES);
      this.conicalReflection = 0.10 + embPressure * 0.05;
      this.conicalMix = 0.10;
    } else {
      this.boreLength2 = this.boreLength;
      this.conicalReflection = 0.0;
      this.conicalMix = 0.0;
    }

    // Breath parameters
    this.breathTarget = 0.55 + velocity * 0.30 + embPressure * 0.10;
    this.breathEnvelope = 0;
    // Per-voice level scaled to match subtractive engine headroom (~0.12 peak).
    // Previous value (velocity + 0.001 ~ 0.79) caused 3-voice sum to exceed
    // the master bus WaveShaper input range, triggering hard clipping.
    var REED_VOICE_LEVEL = 0.15;
    this.outputGain = (velocity + 0.001) * REED_VOICE_LEVEL;
    this.releaseGain = 1.0;

    // Reed type-specific tuning
    if (this.reedType === 'clarinet') {
      // Cylindrical bore: strong odd harmonics, warm fundamental
      this.feedback = 0.993 + stiffness * 0.005;
      var loopCoeff = 0.35 + stiffness * 0.30;
      this.loopFilter.setCoeff(Math.min(0.95, loopCoeff));
      this.noiseGain = 0.05 + breathNoise * 0.10;
      this.breathAttackRate = this.breathTarget / (this.sampleRate * 0.015);
    } else if (this.reedType === 'oboe') {
      // Conical bore: all harmonics present, nasal/reedy character
      this.feedback = 0.994 + stiffness * 0.004;
      var loopCoeff2 = 0.45 + stiffness * 0.35;
      this.loopFilter.setCoeff(Math.min(0.95, loopCoeff2));
      this.noiseGain = 0.03 + breathNoise * 0.08;
      this.breathAttackRate = this.breathTarget / (this.sampleRate * 0.008);
    } else if (this.reedType === 'saxophone') {
      // Single reed + conical bore: bright, full harmonic spectrum
      this.feedback = 0.993 + stiffness * 0.005;
      var loopCoeff3 = 0.50 + stiffness * 0.30;
      this.loopFilter.setCoeff(Math.min(0.95, loopCoeff3));
      this.noiseGain = 0.06 + breathNoise * 0.12;
      this.breathAttackRate = this.breathTarget / (this.sampleRate * 0.010);
    } else if (this.reedType === 'harmonica') {
      // Free reed: no bore resonance, direct reed vibration
      this.feedback = 0.990 + stiffness * 0.006;
      var loopCoeff4 = 0.60 + stiffness * 0.25;
      this.loopFilter.setCoeff(Math.min(0.95, loopCoeff4));
      this.noiseGain = 0.08 + breathNoise * 0.15;
      this.breathAttackRate = this.breathTarget / (this.sampleRate * 0.005);
    }

    // Tone filter (output brightness)
    var brightCoeff = 0.30 + stiffness * 0.50;
    this.toneFilter.setCoeff(Math.min(0.95, brightCoeff));

    // Noise filter: colored breath noise
    this.noiseFilter.setCoeff(0.3 + stiffness * 0.4);

    // Vibrato
    this.vibratoFreq = vibratoRate;
    var VIBRATO_BORE_SCALE = 0.03;
    this.maxVibratoDepth = vibratoDepthPct * this.boreLength * VIBRATO_BORE_SCALE;
    this.vibratoPhase = 0;
    this.vibratoDepth = 0;

    // ADSR
    var adsr = settings.adsr || { a: 5, d: 80, s: 80, r: 150 };
    var sliderToTime = (SL.audio && SL.audio.sliderToTime) ? SL.audio.sliderToTime : null;
    var aTime, dTime, rTime;
    if (sliderToTime) {
      aTime = sliderToTime(adsr.a, 500, 500) / 1000;
      dTime = sliderToTime(adsr.d, 500, 500) / 1000;
      rTime = sliderToTime(adsr.r, 1000, 1000) / 1000;
    } else {
      aTime = Math.max(0.001, adsr.a / 1000);
      dTime = Math.max(0.001, adsr.d / 1000);
      rTime = Math.max(0.001, adsr.r / 1000);
    }
    this.sustainLevel = (adsr.s !== undefined) ? adsr.s / 100 : 0.8;
    this.attackRate = 1.0 / (Math.max(0.001, aTime) * this.sampleRate);
    this.decayRate = 1.0 / (Math.max(0.001, dTime) * this.sampleRate);
    this.releaseRate = 1.0 / (Math.max(0.001, rTime) * this.sampleRate);
    this.envStage = 0;
    this.envLevel = 0;
    this.envReleased = false;
    this.envFinished = false;

    // Counters
    this.maxDecay = Math.floor(this.sampleRate * 10);
    this.decayCounter = 0;
    this.silenceCounter = 0;
    this.lastOutput = 0;

    // Clear delay lines and filters
    this.boreDelay.clear();
    this.boreDelay2.clear();
    this.loopFilter.clear();
    this.toneFilter.clear();
    this.noiseFilter.clear();
    this.dcBlocker.clear();

    // Seed bore delay with noise burst for initial excitation
    var intPeriod = Math.ceil(this.boreLength);
    for (var i = 0; i < intPeriod; i++) {
      this.boreDelay.write((Math.random() * 2 - 1) * velocity * 0.25);
    }
    if (this.boreType === 'conical') {
      var intPeriod2 = Math.ceil(this.boreLength2);
      for (var j = 0; j < intPeriod2; j++) {
        this.boreDelay2.write((Math.random() * 2 - 1) * velocity * 0.15);
      }
    }
  };

  ReedVoice.prototype.noteOff = function() {
    this.blowing = false;
    if (!this.envFinished) {
      this.envReleased = true;
      this.envStage = 3;
    }
  };

  ReedVoice.prototype.processEnvelope = function() {
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
      // Sustain
    } else if (this.envStage === 3) {
      // Release
      this.envLevel -= this.releaseRate;
      if (this.envLevel <= 0.0001) {
        this.envLevel = 0;
        this.envFinished = true;
      }
    }

    return this.envLevel;
  };

  ReedVoice.prototype.process = function() {
    if (!this.active) {
      return 0;
    }

    this.decayCounter++;
    if (this.decayCounter > this.maxDecay) {
      this.active = false;
      return 0;
    }

    // Envelope
    var env = this.processEnvelope();
    if (this.envFinished) {
      this.active = false;
      return 0;
    }

    // Breath envelope ramp-up
    if (this.blowing) {
      if (this.breathEnvelope < this.breathTarget) {
        this.breathEnvelope += this.breathAttackRate;
        if (this.breathEnvelope > this.breathTarget) {
          this.breathEnvelope = this.breathTarget;
        }
      }
    } else {
      // Release: breath decays
      this.breathEnvelope *= 0.9995;
      this.releaseGain *= 0.9998;
    }

    // Vibrato (ramps in over 0.3 seconds)
    var vibMod = 0;
    if (this.vibratoFreq > 0 && this.maxVibratoDepth > 0) {
      this.vibratoPhase += this.vibratoFreq / this.sampleRate;
      if (this.vibratoPhase > 1.0) {
        this.vibratoPhase -= 1.0;
      }
      var rampSamples = this.sampleRate * 0.3;
      if (this.decayCounter < rampSamples) {
        this.vibratoDepth = this.maxVibratoDepth * (this.decayCounter / rampSamples);
      } else {
        this.vibratoDepth = this.maxVibratoDepth;
      }
      vibMod = Math.sin(2 * Math.PI * this.vibratoPhase) * this.vibratoDepth;
    }

    var effectiveBoreLen = Math.max(2, this.boreLength + vibMod);

    // Read from bore delay line
    var boreOut = this.boreDelay.read(effectiveBoreLen - 1);

    // Conical bore: mix in second delay line for impedance mismatch effect
    var conicalOut = 0;
    if (this.boreType === 'conical' && this.conicalMix > 0) {
      var effectiveBoreLen2 = Math.max(2, this.boreLength2 + vibMod * 0.7);
      conicalOut = this.boreDelay2.read(effectiveBoreLen2 - 1);
      boreOut = boreOut * (1.0 - this.conicalMix) + conicalOut * this.conicalMix;
    }

    // Loop filter inside bore
    var filteredBore = this.loopFilter.process(boreOut);

    // Reed reflection: cubic nonlinearity
    var breathNoise = this.noiseFilter.process(Math.random() * 2 - 1) * this.noiseGain;
    var excitation = this.breathEnvelope + breathNoise;
    // Reed sees raw bore return (feedback loss applied at delay write, not here)
    var pressureDiff = excitation - filteredBore;
    var reedOut = reedReflection(pressureDiff, this.reedStiffness);

    // Harmonica: free reed has different excitation (no bore feedback)
    var newSample;
    if (this.reedType === 'harmonica') {
      // Free reed: direct vibration, less bore coupling
      newSample = reedOut * 0.7 + filteredBore * this.feedback * 0.3;
    } else {
      // Standard reed+bore waveguide: additive coupling of reed nonlinearity
      // and breath excitation preserves sustain at moderate dynamics
      var REED_EXCITATION_MIX = 0.5;
      newSample = reedOut + excitation * REED_EXCITATION_MIX;
    }

    // Write back to bore delay
    this.boreDelay.write(newSample);

    // Conical bore: feed second delay line with impedance mismatch reflection
    if (this.boreType === 'conical') {
      var reflected = -filteredBore * this.conicalReflection + newSample * (1.0 - this.conicalReflection);
      this.boreDelay2.write(reflected * this.feedback);
    }

    // Output processing
    var out = this.toneFilter.process(newSample);
    out = this.dcBlocker.process(out);
    out = out * env * this.outputGain * this.releaseGain;

    // Silence detection
    if (!this.blowing) {
      if (Math.abs(out) < 0.00005) {
        this.silenceCounter++;
        if (this.silenceCounter > this.sampleRate * 0.3) {
          this.active = false;
        }
      } else {
        this.silenceCounter = 0;
      }
    }

    this.lastOutput = out;
    return out;
  };

  ReedVoice.prototype.isFinished = function() {
    return !this.active;
  };

  // ============================================================
  // ScriptProcessor Initialization
  // ============================================================

  function init(ctx) {
    audioContext = ctx || (SL.audio && SL.audio.getCtx ? SL.audio.getCtx() : null);
    if (!audioContext) {
      console.error('[REED] No AudioContext available');
      return Promise.reject(new Error('No AudioContext'));
    }

    return initFallback();
  }

  function initFallback() {
    var sr = audioContext.sampleRate;

    for (var i = 0; i < 4; i++) {
      fallbackVoicesByInst[i] = [];
      for (var v = 0; v < MAX_VOICES_PER_INSTRUMENT; v++) {
        fallbackVoicesByInst[i].push(new ReedVoice(sr));
      }

      (function(idx) {
        var bufferSize = 512;
        var node = audioContext.createScriptProcessor(bufferSize, 0, 1);
        node.onaudioprocess = function(e) {
          var output = e.outputBuffer.getChannelData(0);
          var voices = fallbackVoicesByInst[idx];
          var len = output.length;
          for (var s = 0; s < len; s++) {
            var sum = 0;
            for (var vi = 0; vi < voices.length; vi++) {
              if (voices[vi].active) {
                sum += voices[vi].process();
              }
            }
            // No per-voice soft clip here; the effects chain soft-clip
            // handles final limiting. Inline clipping was double-attenuating
            // polyphonic signals that the engine should pass through cleanly.
            output[s] = sum;
          }
        };
        scriptNodes[idx] = node;
      })(i);
    }

    engineReady = true;
    return Promise.resolve(true);
  }

  // ============================================================
  // Filter Management
  // ============================================================

  function getOrCreateFilterNode(instId) {
    if (reedFilterNodes[instId]) {
      return reedFilterNodes[instId];
    }
    if (!audioContext) {
      return null;
    }
    var node = audioContext.createBiquadFilter();
    node.type = 'lowpass';
    node.frequency.value = 20000;
    node.Q.value = 1;
    reedFilterNodes[instId] = node;
    return node;
  }

  function updateFilter(instId) {
    var instruments = SL.audio && SL.audio.getInstruments ? SL.audio.getInstruments() : null;
    var inst = instruments ? instruments[instId] : null;
    if (!inst) {
      return;
    }

    var filterSettings = inst.filter || {};
    var filterNode = getOrCreateFilterNode(instId);
    if (!filterNode) {
      return;
    }

    filterNode.type = filterSettings.type || 'lowpass';
    filterNode.frequency.value = Math.max(20, Math.min(20000, filterSettings.frequency || 20000));
    filterNode.Q.value = Math.max(0.1, Math.min(30, filterSettings.resonance || 1));
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
      instrumentSettings[instId] = JSON.parse(JSON.stringify(DEFAULT_REED_SETTINGS));
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

    var voiceSettings = {
      instId: instId,
      reedType: settings.reedType,
      reedStiffness: settings.reedStiffness,
      embouchurePressure: settings.embouchurePressure,
      register: settings.register,
      vibratoRate: settings.vibratoRate,
      vibratoDepth: settings.vibratoDepth,
      breathNoise: settings.breathNoise,
      adsr: settings.adsr
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

  function setReedType(instId, type) {
    var settings = getOrCreateSettings(instId);
    if (REED_TYPES[type]) {
      settings.reedType = type;
    }
  }

  function setParam(instId, paramName, value) {
    var settings = getOrCreateSettings(instId);
    settings[paramName] = value;
  }

  function setReedStiffness(instId, value) {
    var settings = getOrCreateSettings(instId);
    settings.reedStiffness = Math.max(0, Math.min(100, value));
  }

  function setEmbouchurePressure(instId, value) {
    var settings = getOrCreateSettings(instId);
    settings.embouchurePressure = Math.max(0, Math.min(100, value));
  }

  function setRegister(instId, register) {
    var settings = getOrCreateSettings(instId);
    if (register === 'normal' || register === 'overblown') {
      settings.register = register;
    }
  }

  function setVibratoRate(instId, value) {
    var settings = getOrCreateSettings(instId);
    settings.vibratoRate = Math.max(0, Math.min(20, value));
  }

  function setVibratoDepth(instId, value) {
    var settings = getOrCreateSettings(instId);
    settings.vibratoDepth = Math.max(0, Math.min(100, value));
  }

  function setBreathNoise(instId, value) {
    var settings = getOrCreateSettings(instId);
    settings.breathNoise = Math.max(0, Math.min(100, value));
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
    return JSON.parse(JSON.stringify(DEFAULT_REED_SETTINGS));
  }

  // ============================================================
  // Export to SynthLab Namespace
  // ============================================================

  SL.reed = {
    // Initialization
    init: init,
    isReady: isReady,

    // Note control
    noteOn: noteOn,
    noteOff: noteOff,
    allNotesOff: allNotesOff,

    // Parameter control
    setReedType: setReedType,
    setParam: setParam,
    setReedStiffness: setReedStiffness,
    setEmbouchurePressure: setEmbouchurePressure,
    setRegister: setRegister,
    setVibratoRate: setVibratoRate,
    setVibratoDepth: setVibratoDepth,
    setBreathNoise: setBreathNoise,

    // Settings management
    getSettings: getSettings,
    setSettings: setSettings,
    getDefaultSettings: getDefaultSettings,

    // Connection & filter
    connectToOutput: connectToOutput,
    updateFilter: updateFilter,

    // Constants
    DEFAULT_REED_SETTINGS: DEFAULT_REED_SETTINGS,
    MAX_VOICES_PER_INSTRUMENT: MAX_VOICES_PER_INSTRUMENT,
    REED_TYPES: REED_TYPES,
    REED_TYPE_LIST: REED_TYPE_LIST
  };

})();
