// Super Synth Lab - Drum Synthesis Engine
// Real-time analog drum circuit models (NOT samples)
// ScriptProcessor-based, 16-voice polyphony
// 8 drum types: kick, snare, hihat, clap, tom, rim, cowbell, cymbal
(function() {
  'use strict';

  var SL = window.SynthLab;

  // ============================================================
  // Constants
  // ============================================================

  var MAX_VOICES_PER_INSTRUMENT = 16;
  var TWO_PI = 2 * Math.PI;
  var NUM_DRUM_TYPES = 8;
  var DRUM_TYPES = ['kick', 'snare', 'hihat', 'clap', 'tom', 'rim', 'cowbell', 'cymbal'];

  // Voice envelope constants
  var VOICE_LIFETIME_MULTIPLIER = 3;
  var VOICE_LIFETIME_PAD_SEC = 0.1;
  var FADEOUT_DURATION_SEC = 0.005;
  var AMP_SILENCE_THRESHOLD = 0.0001;
  var AMP_DECAY_FACTOR = 0.35;

  // Kick transient constants
  var KICK_CLICK_MIX = 0.25;
  var KICK_BODY_MIX = 0.8;
  var KICK_PITCH_ENV_MIN = 0.04;
  var KICK_PITCH_ENV_MAX = 0.12;

  // Metallic ratios for hihat/cymbal partials
  var METALLIC_RATIOS = [1.0, 1.34, 1.61, 1.78, 2.14, 2.45];
  var NUM_METALLIC_PARTIALS = METALLIC_RATIOS.length;

  // Clap burst count and spacing
  var CLAP_BURST_COUNT = 4;
  var CLAP_BURST_SPACING_SAMPLES = 0; // computed per sampleRate in voice init
  var CLAP_BURST_LENGTH_SAMPLES = 0;

  // Mute groups: MIDI notes sharing a group cut each other off
  var MUTE_GROUPS = {
    42: 1,  // HiHat closed - group 1
    46: 1,  // HiHat open - group 1
    44: 1   // HiHat pedal - group 1
  };

  // Per-MIDI-note pitch multipliers for tom-family instruments
  // Allows each pad to sound distinctly different despite sharing drum type
  var TOM_PITCH_BY_MIDI = {
    41: 0.70,   // Low Floor Tom
    43: 0.80,   // Hi Floor Tom
    45: 0.90,   // Low Tom
    47: 1.00,   // Low-Mid Tom
    48: 1.10,   // Hi-Mid Tom
    50: 1.30,   // Hi Tom
    60: 1.40,   // Hi Bongo
    61: 1.10,   // Lo Bongo
    62: 1.20,   // Hi Conga Mute
    63: 1.25,   // Hi Conga Open
    64: 0.85,   // Lo Conga
    65: 1.35,   // Hi Timbale
    66: 1.00    // Lo Timbale
  };
  var TOM_PITCH_DEFAULT_MULTIPLIER = 1.0;

  // Per-MIDI-note pitch multipliers for cowbell-family instruments (agogos)
  var COWBELL_PITCH_BY_MIDI = {
    56: 1.00,   // Cowbell
    67: 1.25,   // Hi Agogo
    68: 0.80    // Lo Agogo
  };
  var COWBELL_PITCH_DEFAULT_MULTIPLIER = 1.0;

  // Per-MIDI-note pitch multipliers for rim-family instruments (claves, woodblocks)
  var RIM_PITCH_BY_MIDI = {
    37: 1.00,   // Sidestick
    75: 1.30,   // Claves
    76: 1.20,   // Hi Woodblock
    77: 0.85    // Lo Woodblock
  };
  var RIM_PITCH_DEFAULT_MULTIPLIER = 1.0;

  // Per-MIDI-note pitch multipliers for cymbal-family instruments
  // Each cymbal pad gets a distinct pitch/character
  var CYMBAL_PITCH_BY_MIDI = {
    49: 1.00,   // Crash 1 - standard
    51: 0.85,   // Ride - lower pitch, more spread
    52: 1.15,   // Chinese Cymbal
    53: 1.30,   // Ride Bell - higher pitch, more metallic/bell
    55: 0.90,   // Splash
    57: 1.10,   // Crash 2
    59: 1.20    // Ride Cymbal 2
  };
  var CYMBAL_PITCH_DEFAULT_MULTIPLIER = 1.0;

  // Per-MIDI-note decay multipliers for cymbal-family instruments
  // Ride: longer sustain; Ride Bell: shorter/brighter
  var CYMBAL_DECAY_BY_MIDI = {
    49: 1.00,   // Crash 1 - standard
    51: 1.40,   // Ride - longer decay, more spread
    52: 0.80,   // Chinese Cymbal - shorter
    53: 0.60,   // Ride Bell - short, bell-like
    55: 0.50,   // Splash - very short
    57: 1.10,   // Crash 2
    59: 1.30    // Ride Cymbal 2 - longer
  };
  var CYMBAL_DECAY_DEFAULT_MULTIPLIER = 1.0;

  // Per-MIDI-note decay multipliers for hi-hat family
  // Closed hi-hat: very short/tight, Open hi-hat: long/ringy
  var HIHAT_DECAY_BY_MIDI = {
    42: 0.15,   // Hi-Hat Closed - very tight (~50ms effective)
    44: 0.10,   // Hi-Hat Pedal - tightest
    46: 1.80,   // Hi-Hat Open - long ring (~300-500ms effective)
    54: 0.25,   // Tambourine
    58: 0.10,   // Vibraslap (short)
    69: 0.30,   // Cabasa
    70: 0.25,   // Maracas
    73: 0.20,   // Short Guiro
    74: 0.50    // Long Guiro
  };
  var HIHAT_DECAY_DEFAULT_MULTIPLIER = 0.5;

  // Per-MIDI-note pitch multipliers for hi-hat family
  var HIHAT_PITCH_BY_MIDI = {
    42: 1.00,   // Hi-Hat Closed - standard
    44: 0.90,   // Hi-Hat Pedal - slightly lower
    46: 0.80,   // Hi-Hat Open - lower fundamental, broader spectrum
    54: 1.20,   // Tambourine - higher jingle
    58: 0.60,   // Vibraslap
    69: 1.10,   // Cabasa
    70: 1.15,   // Maracas
    73: 0.70,   // Short Guiro
    74: 0.70    // Long Guiro
  };
  var HIHAT_PITCH_DEFAULT_MULTIPLIER = 1.0;

  // Hi-hat tone: closed is brighter (more highpass), open is wider spectrum
  var HIHAT_TONE_BY_MIDI = {
    42: 1.0,    // Closed - bright, crispy
    44: 1.0,    // Pedal - bright
    46: 0.6     // Open - wider spectrum, less highpass
  };
  var HIHAT_TONE_DEFAULT_MULTIPLIER = 0.8;

  // Cowbell frequencies
  var COWBELL_FREQ_A = 587;
  var COWBELL_FREQ_B = 845;

  /** Default drum synth settings */
  // 808-style defaults: punchy, long decay, driven
  var DEFAULT_DRUMSYN_SETTINGS = {
    drumType: 'kick',
    pitch: 45,
    decay: 75,
    tone: 60,
    bodyNoiseMix: 50,
    drive: 50
  };

  // ============================================================
  // State
  // ============================================================

  var audioContext = null;
  var scriptNodes = [null, null, null, null];
  var fallbackVoicesByInst = [[], [], [], []];
  var isEngineReady = false;
  var instrumentSettings = {};
  var drumFilterNodes = {};
  var connectedInsts = [false, false, false, false];

  // ============================================================
  // LFSR Noise Generator
  // ============================================================

  function LFSRNoise() {
    this.state = 1;
  }

  LFSRNoise.prototype.next = function() {
    this.state ^= this.state << 13;
    this.state ^= this.state >> 17;
    this.state ^= this.state << 5;
    return this.state / 2147483647;
  };

  // ============================================================
  // Helpers
  // ============================================================

  function clamp(val, lo, hi) {
    if (val < lo) {
      return lo;
    } else if (val > hi) {
      return hi;
    }
    return val;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  // Reverse lookup: MIDI note to drum type name
  var MIDI_TO_DRUM_TYPE = {
    35: 'kick', 36: 'kick',
    38: 'snare', 40: 'snare',
    42: 'hihat', 44: 'hihat', 46: 'hihat',
    39: 'clap',
    37: 'rim', 75: 'rim', 76: 'rim', 77: 'rim',
    41: 'tom', 43: 'tom', 45: 'tom', 47: 'tom', 48: 'tom', 50: 'tom',
    60: 'tom', 61: 'tom', 62: 'tom', 63: 'tom', 64: 'tom',
    65: 'tom', 66: 'tom',
    56: 'cowbell', 67: 'cowbell', 68: 'cowbell',
    49: 'cymbal', 51: 'cymbal', 52: 'cymbal', 53: 'cymbal',
    55: 'cymbal', 57: 'cymbal', 59: 'cymbal',
    54: 'hihat', 58: 'hihat', 69: 'hihat', 70: 'hihat',
    73: 'hihat', 74: 'hihat'
  };

  function drumTypeFromMidi(midi) {
    if (MIDI_TO_DRUM_TYPE[midi]) {
      return MIDI_TO_DRUM_TYPE[midi];
    }
    return DRUM_TYPES[midi % NUM_DRUM_TYPES];
  }

  // Reverse lookup: drum type name to a representative MIDI note
  var DRUM_TYPE_TO_MIDI = {
    'kick': 36, 'snare': 38, 'hihat': 42, 'clap': 39,
    'tom': 45, 'rim': 37, 'cowbell': 56, 'cymbal': 49
  };

  function _drumTypeToMidi(drumType) {
    return DRUM_TYPE_TO_MIDI[drumType];
  }

  function softClipTanh(x) {
    // Fast tanh approximation
    if (x > 3) {
      return 1;
    } else if (x < -3) {
      return -1;
    }
    var x2 = x * x;
    return x * (27 + x2) / (27 + 9 * x2);
  }

  // ============================================================
  // Voice
  // ============================================================

  function DrumVoice(sr) {
    this.sampleRate = sr;
    this.active = false;
    this.drumType = 'kick';
    this.midiNote = 0;
    this.phase = 0;
    this.time = 0;
    this.velocity = 1.0;
    this.pitchHz = 100;
    this.decayTime = 0.3;
    this.noiseGen = new LFSRNoise();
    this.samplesSinceStart = 0;

    // Drum-specific state
    this.pitchStart = 400;
    this.pitchEnd = 50;
    this.pitchEnvTime = 0.05;
    this.toneParam = 0.5;
    this.bodyNoiseMix = 0.7;
    this.driveAmount = 0;

    // Hihat/cymbal partial phases
    this.partialPhases = [0, 0, 0, 0, 0, 0];

    // Clap state
    this.clapBurstSpacing = 0;
    this.clapBurstLength = 0;

    // Cowbell phases and pitch multiplier
    this.cowbellPhaseA = 0;
    this.cowbellPhaseB = 0;
    this.cowbellPitchMult = 1.0;

    // One-pole filter state for tone shaping
    this.filterState = 0;

    // Decay norm for pitch envelope scaling
    this.decayNorm = 0;

    // Samples per ms
    this.samplesPerMs = sr / 1000;
  }

  DrumVoice.prototype.noteOn = function(midi, vel, settings) {
    this.active = true;
    this.midiNote = midi;
    this.velocity = vel / 127;
    this.phase = 0;
    this.time = 0;
    this.samplesSinceStart = 0;
    this.filterState = 0;
    this.noiseGen.state = 1;

    var pitchNorm = (settings.pitch !== undefined ? settings.pitch : 50) / 100;
    var decayNorm = (settings.decay !== undefined ? settings.decay : 50) / 100;
    this.decayNorm = decayNorm;
    this.toneParam = (settings.tone !== undefined ? settings.tone : 50) / 100;
    this.bodyNoiseMix = (settings.bodyNoiseMix !== undefined ? settings.bodyNoiseMix : 70) / 100;
    this.driveAmount = (settings.drive !== undefined ? settings.drive : 20) / 100;

    var drumType = settings.drumType || drumTypeFromMidi(midi);
    this.drumType = drumType;

    // Reset partial phases
    for (var p = 0; p < NUM_METALLIC_PARTIALS; p++) {
      this.partialPhases[p] = 0;
    }
    this.cowbellPhaseA = 0;
    this.cowbellPhaseB = 0;

    if (drumType === 'kick') {
      // 808-style kick: deep pitch sweep, long decay
      this.pitchStart = lerp(200, 500, pitchNorm);
      this.pitchEnd = lerp(30, 60, pitchNorm);
      this.pitchEnvTime = lerp(KICK_PITCH_ENV_MIN, KICK_PITCH_ENV_MAX, decayNorm);
      this.decayTime = lerp(0.2, 1.5, decayNorm);
    } else if (drumType === 'snare') {
      this.pitchHz = lerp(180, 280, pitchNorm);
      this.decayTime = lerp(0.1, 0.6, decayNorm);
    } else if (drumType === 'hihat') {
      var hihatPitchMult = (HIHAT_PITCH_BY_MIDI[midi] !== undefined) ? HIHAT_PITCH_BY_MIDI[midi] : HIHAT_PITCH_DEFAULT_MULTIPLIER;
      var hihatDecayMult = (HIHAT_DECAY_BY_MIDI[midi] !== undefined) ? HIHAT_DECAY_BY_MIDI[midi] : HIHAT_DECAY_DEFAULT_MULTIPLIER;
      var hihatToneMult = (HIHAT_TONE_BY_MIDI[midi] !== undefined) ? HIHAT_TONE_BY_MIDI[midi] : HIHAT_TONE_DEFAULT_MULTIPLIER;
      this.pitchHz = lerp(7000, 12000, pitchNorm) * hihatPitchMult;
      this.decayTime = lerp(0.02, 0.5, decayNorm) * hihatDecayMult;
      this.toneParam = this.toneParam * hihatToneMult;
    } else if (drumType === 'clap') {
      this.decayTime = lerp(0.1, 0.5, decayNorm);
      this.clapBurstSpacing = Math.round(0.005 * this.sampleRate);
      this.clapBurstLength = Math.round(0.002 * this.sampleRate);
    } else if (drumType === 'tom') {
      var tomPitchMult = TOM_PITCH_BY_MIDI[midi] !== undefined ? TOM_PITCH_BY_MIDI[midi] : TOM_PITCH_DEFAULT_MULTIPLIER;
      this.pitchStart = lerp(400, 600, pitchNorm) * tomPitchMult;
      this.pitchEnd = lerp(80, 200, pitchNorm) * tomPitchMult;
      this.pitchEnvTime = 0.06;
      this.decayTime = lerp(0.15, 1.0, decayNorm);
    } else if (drumType === 'rim') {
      var rimPitchMult = RIM_PITCH_BY_MIDI[midi] !== undefined ? RIM_PITCH_BY_MIDI[midi] : RIM_PITCH_DEFAULT_MULTIPLIER;
      this.pitchHz = lerp(800, 1500, pitchNorm) * rimPitchMult;
      this.decayTime = lerp(0.005, 0.03, decayNorm);
    } else if (drumType === 'cowbell') {
      this.cowbellPitchMult = COWBELL_PITCH_BY_MIDI[midi] !== undefined ? COWBELL_PITCH_BY_MIDI[midi] : COWBELL_PITCH_DEFAULT_MULTIPLIER;
      this.decayTime = lerp(0.1, 0.4, decayNorm);
    } else if (drumType === 'cymbal') {
      var cymbalPitchMult = CYMBAL_PITCH_BY_MIDI[midi] !== undefined ? CYMBAL_PITCH_BY_MIDI[midi] : CYMBAL_PITCH_DEFAULT_MULTIPLIER;
      var cymbalDecayMult = CYMBAL_DECAY_BY_MIDI[midi] !== undefined ? CYMBAL_DECAY_BY_MIDI[midi] : CYMBAL_DECAY_DEFAULT_MULTIPLIER;
      this.pitchHz = lerp(5000, 10000, pitchNorm) * cymbalPitchMult;
      this.decayTime = lerp(0.3, 2.0, decayNorm) * cymbalDecayMult;
    }
  };

  DrumVoice.prototype.noteOff = function() {
    // Drums are one-shot; noteOff is a no-op
  };

  DrumVoice.prototype.process = function() {
    if (!this.active) {
      return 0;
    }

    var sr = this.sampleRate;
    var t = this.samplesSinceStart / sr;
    var sample = 0;

    // Check if voice has decayed past its extended lifetime
    var voiceLifetime = this.decayTime * VOICE_LIFETIME_MULTIPLIER + VOICE_LIFETIME_PAD_SEC;
    if (t > voiceLifetime) {
      this.active = false;
      return 0;
    }

    // Amplitude envelope: exponential decay (808-style)
    var ampEnv = Math.exp(-t / (this.decayTime * AMP_DECAY_FACTOR));
    if (ampEnv < AMP_SILENCE_THRESHOLD) {
      this.active = false;
      return 0;
    }

    // Fadeout ramp in the last few ms before cutoff to prevent clicks
    var remaining = voiceLifetime - t;
    if (remaining < FADEOUT_DURATION_SEC) {
      ampEnv = ampEnv * (remaining / FADEOUT_DURATION_SEC);
    }

    if (this.drumType === 'kick') {
      sample = this._processKick(t, sr);
    } else if (this.drumType === 'snare') {
      sample = this._processSnare(t, sr);
    } else if (this.drumType === 'hihat') {
      sample = this._processHihat(t, sr);
    } else if (this.drumType === 'clap') {
      sample = this._processClap(t, sr);
    } else if (this.drumType === 'tom') {
      sample = this._processTom(t, sr);
    } else if (this.drumType === 'rim') {
      sample = this._processRim(t, sr);
    } else if (this.drumType === 'cowbell') {
      sample = this._processCowbell(t, sr);
    } else if (this.drumType === 'cymbal') {
      sample = this._processCymbal(t, sr);
    }

    // 808-style output: boost signal level for punch
    var OUTPUT_BOOST = 2.5;
    sample = sample * ampEnv * this.velocity * OUTPUT_BOOST;

    // Apply drive (tanh soft clipping)
    if (this.driveAmount > 0.01) {
      var driveGain = 1.0 + this.driveAmount * 8.0;
      sample = softClipTanh(sample * driveGain) / driveGain * (1.0 + this.driveAmount * 2.0);
    }

    this.samplesSinceStart++;
    return sample;
  };

  // --- Kick: sine sweep + click transient ---
  DrumVoice.prototype._processKick = function(t, sr) {
    // Pitch envelope: exponential sweep from pitchStart to pitchEnd
    var pitchEnvProgress = clamp(t / this.pitchEnvTime, 0, 1);
    var currentFreq = this.pitchStart * Math.pow(this.pitchEnd / this.pitchStart, pitchEnvProgress);

    // Phase accumulator for sine
    this.phase += currentFreq / sr;
    if (this.phase >= 1.0) {
      this.phase -= Math.floor(this.phase);
    }
    var body = Math.sin(TWO_PI * this.phase);

    // Click transient: short noise burst, first 2ms
    var click = 0;
    var clickDuration = 0.002;
    if (t < clickDuration) {
      click = this.noiseGen.next() * (1.0 - t / clickDuration);
    }

    return body * KICK_BODY_MIX + click * KICK_CLICK_MIX;
  };

  // --- Snare: pitched body + noise through bandpass ---
  DrumVoice.prototype._processSnare = function(t, sr) {
    // Sine body
    this.phase += this.pitchHz / sr;
    if (this.phase >= 1.0) {
      this.phase -= Math.floor(this.phase);
    }
    var body = Math.sin(TWO_PI * this.phase);

    // White noise through simple one-pole filter (tone-dependent)
    var noise = this.noiseGen.next();
    var filterFreq = lerp(1000, 5000, this.toneParam);
    var filterCoeff = 1.0 - Math.exp(-TWO_PI * filterFreq / sr);
    this.filterState += filterCoeff * (noise - this.filterState);
    var filteredNoise = this.filterState;

    // Mix body and noise using bodyNoiseMix
    var bodyAmt = this.bodyNoiseMix;
    var noiseAmt = 1.0 - this.bodyNoiseMix;

    return body * bodyAmt + filteredNoise * noiseAmt * 2.0;
  };

  // --- Hihat: 6 detuned square waves through highpass ---
  DrumVoice.prototype._processHihat = function(t, sr) {
    var baseFreq = this.pitchHz;
    var sum = 0;

    for (var i = 0; i < NUM_METALLIC_PARTIALS; i++) {
      var freq = baseFreq * METALLIC_RATIOS[i] / 10.0;
      this.partialPhases[i] += freq / sr;
      if (this.partialPhases[i] >= 1.0) {
        this.partialPhases[i] -= Math.floor(this.partialPhases[i]);
      }
      // Square wave
      if (this.partialPhases[i] < 0.5) {
        sum += 1.0;
      } else {
        sum += -1.0;
      }
    }
    sum = sum / NUM_METALLIC_PARTIALS;

    // Highpass filter: subtract lowpass
    var hpCoeff = Math.exp(-TWO_PI * lerp(7000, 12000, this.toneParam) / sr);
    this.filterState = hpCoeff * (this.filterState + sum - (this._prevInput || 0));
    this._prevInput = sum;

    return this.filterState;
  };

  // --- Clap: 4 short noise bursts with slight delays ---
  DrumVoice.prototype._processClap = function(t, sr) {
    var sample = 0;
    var spacing = this.clapBurstSpacing;
    var burstLen = this.clapBurstLength;
    var s = this.samplesSinceStart;

    for (var b = 0; b < CLAP_BURST_COUNT; b++) {
      var burstStart = b * spacing;
      var burstEnd = burstStart + burstLen;
      if (s >= burstStart && s < burstEnd) {
        var burstProgress = (s - burstStart) / burstLen;
        var burstEnv = 1.0 - burstProgress;
        sample += this.noiseGen.next() * burstEnv;
      }
    }

    // Bandpass via one-pole: center around tone-dependent frequency
    var bpFreq = lerp(800, 3000, this.toneParam);
    var bpCoeff = 1.0 - Math.exp(-TWO_PI * bpFreq / sr);
    this.filterState += bpCoeff * (sample - this.filterState);

    // Exponential tail after all bursts
    var tailStart = CLAP_BURST_COUNT * spacing + burstLen;
    if (s >= tailStart) {
      var tailNoise = this.noiseGen.next();
      var tailEnv = Math.exp(-(s - tailStart) / (this.decayTime * sr * 0.3));
      this.filterState += bpCoeff * (tailNoise * tailEnv - this.filterState);
    }

    return this.filterState * 1.5;
  };

  // --- Tom: like kick but higher pitch, more sustain ---
  DrumVoice.prototype._processTom = function(t, sr) {
    var pitchEnvProgress = clamp(t / this.pitchEnvTime, 0, 1);
    var currentFreq = this.pitchStart * Math.pow(this.pitchEnd / this.pitchStart, pitchEnvProgress);

    this.phase += currentFreq / sr;
    if (this.phase >= 1.0) {
      this.phase -= Math.floor(this.phase);
    }
    var body = Math.sin(TWO_PI * this.phase);

    // Slight noise component for attack
    var noise = 0;
    if (t < 0.01) {
      noise = this.noiseGen.next() * (1.0 - t / 0.01) * 0.3;
    }

    return body * 0.9 + noise;
  };

  // --- Rim: short high-frequency click with resonant filter ---
  DrumVoice.prototype._processRim = function(t, sr) {
    // Very short noise burst (1ms)
    var sample = 0;
    if (t < 0.001) {
      sample = this.noiseGen.next();
    }

    // Narrow bandpass with high Q at pitchHz
    var bpFreq = this.pitchHz;
    var bpCoeff = 1.0 - Math.exp(-TWO_PI * bpFreq / sr);
    // High-Q resonance: feed back filtered signal
    var resonance = 0.95;
    this.filterState = this.filterState * resonance + bpCoeff * (sample - this.filterState);

    return this.filterState * 3.0;
  };

  // --- Cowbell: two detuned square waves through bandpass ---
  DrumVoice.prototype._processCowbell = function(t, sr) {
    var freqA = COWBELL_FREQ_A * this.cowbellPitchMult;
    var freqB = COWBELL_FREQ_B * this.cowbellPitchMult;

    // Square wave A
    this.cowbellPhaseA += freqA / sr;
    if (this.cowbellPhaseA >= 1.0) {
      this.cowbellPhaseA -= Math.floor(this.cowbellPhaseA);
    }
    var sqA;
    if (this.cowbellPhaseA < 0.5) {
      sqA = 1.0;
    } else {
      sqA = -1.0;
    }

    // Square wave B
    this.cowbellPhaseB += freqB / sr;
    if (this.cowbellPhaseB >= 1.0) {
      this.cowbellPhaseB -= Math.floor(this.cowbellPhaseB);
    }
    var sqB;
    if (this.cowbellPhaseB < 0.5) {
      sqB = 1.0;
    } else {
      sqB = -1.0;
    }

    var mix = (sqA + sqB) * 0.5;

    // Bandpass at ~700Hz scaled by pitch multiplier
    var bpFreq = 700 * this.cowbellPitchMult;
    var bpCoeff = 1.0 - Math.exp(-TWO_PI * bpFreq / sr);
    this.filterState += bpCoeff * (mix - this.filterState);

    return this.filterState;
  };

  // --- Cymbal: dense metallic noise, wider bandwidth, longer decay ---
  DrumVoice.prototype._processCymbal = function(t, sr) {
    var baseFreq = this.pitchHz;
    var sum = 0;

    // More metallic partials than hihat — use all 6 plus additional harmonics
    for (var i = 0; i < NUM_METALLIC_PARTIALS; i++) {
      var freq = baseFreq * METALLIC_RATIOS[i] / 8.0;
      this.partialPhases[i] += freq / sr;
      if (this.partialPhases[i] >= 1.0) {
        this.partialPhases[i] -= Math.floor(this.partialPhases[i]);
      }
      // Mix of square and noise-modulated sine for richer texture
      var sq;
      if (this.partialPhases[i] < 0.5) {
        sq = 1.0;
      } else {
        sq = -1.0;
      }
      var sine = Math.sin(TWO_PI * this.partialPhases[i]);
      sum += sq * 0.5 + sine * 0.5;
    }
    sum = sum / NUM_METALLIC_PARTIALS;

    // Add noise for shimmer
    var noise = this.noiseGen.next() * 0.3;
    sum += noise;

    // Highpass filter
    var hpFreq = lerp(5000, 10000, this.toneParam);
    var hpCoeff = Math.exp(-TWO_PI * hpFreq / sr);
    this.filterState = hpCoeff * (this.filterState + sum - (this._prevInput || 0));
    this._prevInput = sum;

    return this.filterState;
  };

  DrumVoice.prototype.isFinished = function() {
    return !this.active;
  };

  // ============================================================
  // Engine Init
  // ============================================================

  function init(ctx) {
    audioContext = ctx || (SL.audio && SL.audio.getCtx ? SL.audio.getCtx() : null);
    if (!audioContext) {
      console.error('[DRUMSYN] No AudioContext available');
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
        fallbackVoicesByInst[i].push(new DrumVoice(sr));
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
                sample += voices[vi].process() * 0.7;
              }
            }
            // Soft clip output
            output[s] = softClipTanh(sample);
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
    if (!drumFilterNodes[instId]) {
      var node = audioContext.createBiquadFilter();
      node.type = 'lowpass';
      node.frequency.value = 20000;
      node.Q.value = 0.707;
      drumFilterNodes[instId] = node;
    }
    return drumFilterNodes[instId];
  }

  function updateFilter(instId) {
    if (instId === undefined) {
      instId = 0;
    }
    var filterNode = drumFilterNodes[instId];
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
      instrumentSettings[instId] = JSON.parse(JSON.stringify(DEFAULT_DRUMSYN_SETTINGS));
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

    // Always determine drum type from MIDI note for multi-voice drum playback
    var voiceSettings = {
      drumType: drumTypeFromMidi(midi),
      pitch: settings.pitch,
      decay: settings.decay,
      tone: settings.tone,
      bodyNoiseMix: settings.bodyNoiseMix,
      drive: settings.drive
    };

    var voices = fallbackVoicesByInst[instId];

    // Kill existing voices of same drum type (prevents overlap/clipping)
    var drumType = voiceSettings.drumType;
    for (var ki = 0; ki < voices.length; ki++) {
      if (voices[ki].active && voices[ki].drumType === drumType) {
        voices[ki].active = false;
      }
    }

    // Also kill voices in the same mute group (e.g., open/closed hihat)
    var muteGroup = MUTE_GROUPS[midi];
    if (muteGroup !== undefined) {
      for (var mi = 0; mi < voices.length; mi++) {
        if (voices[mi].active) {
          // Check all MIDI notes that share this mute group
          var voiceMidi = _drumTypeToMidi(voices[mi].drumType);
          if (voiceMidi !== undefined && MUTE_GROUPS[voiceMidi] === muteGroup) {
            voices[mi].active = false;
          }
        }
      }
    }

    var voice = null;
    for (var i = 0; i < voices.length; i++) {
      if (!voices[i].active) {
        voice = voices[i];
        break;
      }
    }
    if (!voice) {
      // Steal oldest voice
      voice = voices[0];
    }
    voice.noteOn(midi, velocity, voiceSettings);
  }

  function noteOff(midi, instId) {
    // Drums are one-shot; noteOff is effectively a no-op
    // but we must match the engine API
    if (instId === undefined) {
      instId = 0;
    }
  }

  function allNotesOff(instId) {
    if (instId !== undefined) {
      var voices = fallbackVoicesByInst[instId];
      for (var i = 0; i < voices.length; i++) {
        voices[i].active = false;
      }
    } else {
      for (var idx = 0; idx < 4; idx++) {
        var pool = fallbackVoicesByInst[idx];
        for (var j = 0; j < pool.length; j++) {
          pool[j].active = false;
        }
      }
    }
  }

  // ============================================================
  // Settings API
  // ============================================================

  function getSettings(instId) {
    return JSON.parse(JSON.stringify(getOrCreateSettings(instId)));
  }

  function setSettings(instId, newSettings) {
    instrumentSettings[instId] = JSON.parse(JSON.stringify(newSettings));
  }

  function getDefaultSettings() {
    return JSON.parse(JSON.stringify(DEFAULT_DRUMSYN_SETTINGS));
  }

  function isReady() {
    return isEngineReady;
  }

  // ============================================================
  // Export
  // ============================================================

  SL.drumsyn = {
    init: init,
    isReady: isReady,
    noteOn: noteOn,
    noteOff: noteOff,
    allNotesOff: allNotesOff,
    getSettings: getSettings,
    setSettings: setSettings,
    getDefaultSettings: getDefaultSettings,
    connectToOutput: connectToOutput,
    updateFilter: updateFilter,
    DEFAULT_DRUMSYN_SETTINGS: DEFAULT_DRUMSYN_SETTINGS,
    MAX_VOICES_PER_INSTRUMENT: MAX_VOICES_PER_INSTRUMENT,
    DRUM_TYPES: DRUM_TYPES
  };

})();
