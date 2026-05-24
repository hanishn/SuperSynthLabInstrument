// Super Synth Lab - Formant AudioWorklet Processor
// Vowel/vocal synthesis running on dedicated audio thread
// Ported from ScriptProcessor formant-engine.js for iOS Safari compatibility
// v1.0 - 5-formant model, vowel morphing, sequence, breathiness, glottal pulse

var NUM_FORMANTS = 5;
var TWO_PI = 2 * Math.PI;
var MAX_VOICES_PER_INSTRUMENT = 16;
var FORMANT_OUTPUT_BOOST = 3.0;

// ============================================================
// Vowel Formant Data (research-accurate)
// Based on Peterson & Barney (1952) and Hillenbrand et al. (1995)
// ============================================================

var VOWEL_DATA = {
  A:  { freqs: [730, 1090, 2440, 3400, 4500], amps: [1.0, 0.50, 0.30, 0.10, 0.05], bws: [90, 110, 170, 250, 300] },
  E:  { freqs: [530, 1840, 2480, 3400, 4500], amps: [1.0, 0.40, 0.30, 0.12, 0.05], bws: [70, 100, 160, 250, 300] },
  I:  { freqs: [270, 2290, 3010, 3400, 4500], amps: [1.0, 0.30, 0.20, 0.10, 0.04], bws: [60, 90, 150, 250, 300] },
  O:  { freqs: [570, 840, 2410, 3400, 4500], amps: [1.0, 0.40, 0.25, 0.10, 0.05], bws: [80, 100, 160, 250, 300] },
  U:  { freqs: [300, 870, 2240, 3400, 4500], amps: [1.0, 0.30, 0.20, 0.08, 0.04], bws: [70, 100, 150, 250, 300] },
  AE: { freqs: [660, 1720, 2410, 3400, 4500], amps: [1.0, 0.45, 0.28, 0.11, 0.05], bws: [80, 105, 165, 250, 300] },
  UH: { freqs: [640, 1190, 2390, 3400, 4500], amps: [1.0, 0.45, 0.25, 0.10, 0.05], bws: [80, 105, 160, 250, 300] },
  OO: { freqs: [440, 1020, 2240, 3400, 4500], amps: [1.0, 0.35, 0.22, 0.09, 0.04], bws: [75, 100, 155, 250, 300] }
};

// ============================================================
// Formant Interpolation
// ============================================================

function interpolateFormants(vowelA, vowelB, morphX, formantShift) {
  var dataA = VOWEL_DATA[vowelA] || VOWEL_DATA.A;
  var dataB = VOWEL_DATA[vowelB] || VOWEL_DATA.E;
  var t = Math.max(0, Math.min(1, morphX / 100));
  var shiftRatio = Math.pow(2, formantShift / 12);

  var freqs = new Array(NUM_FORMANTS);
  var amps = new Array(NUM_FORMANTS);
  var bws = new Array(NUM_FORMANTS);
  for (var i = 0; i < NUM_FORMANTS; i++) {
    var logA = Math.log(dataA.freqs[i]);
    var logB = Math.log(dataB.freqs[i]);
    freqs[i] = Math.exp(logA + (logB - logA) * t) * shiftRatio;
    amps[i] = dataA.amps[i] + (dataB.amps[i] - dataA.amps[i]) * t;
    bws[i] = dataA.bws[i] + (dataB.bws[i] - dataA.bws[i]) * t;
  }

  return { freqs: freqs, amps: amps, bws: bws };
}

// ============================================================
// Resonant Bandpass Filter (2nd-order biquad, direct form II)
// ============================================================

function BiquadBPF() {
  this.b0 = 0; this.b1 = 0; this.b2 = 0;
  this.a1 = 0; this.a2 = 0;
  this.z1 = 0; this.z2 = 0;
}

BiquadBPF.prototype.set = function(freq, bw, sr) {
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
// Formant Voice
// ============================================================

function FormantVoice(sr) {
  this.sampleRate = sr;
  this.active = false;
  this.midiNote = -1;
  this.instId = 0;
  this.baseFreq = 440;
  this.velocity = 1.0;

  this.glottalPhase = 0;
  this.glottalPulseWidth = 0.5;
  this.breathiness = 0.2;

  this.filters = [];
  this.formantAmps = new Float64Array(NUM_FORMANTS);
  for (var i = 0; i < NUM_FORMANTS; i++) {
    this.filters.push(new BiquadBPF());
    this.formantAmps[i] = 0;
  }

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

FormantVoice.prototype.setFormants = function(formants) {
  for (var i = 0; i < NUM_FORMANTS; i++) {
    this.filters[i].set(formants.freqs[i], formants.bws[i], this.sampleRate);
    this.formantAmps[i] = formants.amps[i];
  }
};

FormantVoice.prototype.noteOn = function(midi, vel, freq, settings) {
  this.active = true;
  this.midiNote = midi;
  this.baseFreq = freq;
  this.instId = settings.instId || 0;
  this.envStage = 0;
  this.envLevel = 0;
  this.envReleased = false;
  this.envFinished = false;
  this.glottalPhase = 0;

  this.breathiness = Math.max(0, Math.min(1, (settings.breathiness || 0) / 100));
  this.glottalPulseWidth = Math.max(0.1, Math.min(0.9, (settings.glottalPulseWidth || 50) / 100));

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

  this.attackRate = 1.0 / (aTime * this.sampleRate);
  this.decayRate = 1.0 / (dTime * this.sampleRate);
  this.sustainLevel = sLevel;
  this.releaseRate = 1.0 / (rTime * this.sampleRate);

  var formants = interpolateFormants(
    settings.vowel || 'A',
    settings.vowelTarget || 'E',
    settings.morphX || 0,
    settings.formantShift || 0
  );
  this.setFormants(formants);

  for (var i = 0; i < NUM_FORMANTS; i++) {
    this.filters[i].reset();
  }
};

FormantVoice.prototype.noteOff = function() {
  if (!this.envFinished) {
    this.envReleased = true;
    this.envStage = 3;
  }
};

FormantVoice.prototype.processEnvelope = function() {
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
    // Sustain
  } else if (this.envStage === 3) {
    this.envLevel -= this.releaseRate * this.envLevel;
    if (this.envLevel <= 0.0001) {
      this.envLevel = 0;
      this.envFinished = true;
    }
  }

  return this.envLevel;
};

FormantVoice.prototype.processSample = function() {
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

  // Glottal pulse excitation (Rosenberg model)
  var phaseInc = this.baseFreq / this.sampleRate;
  this.glottalPhase += phaseInc;
  if (this.glottalPhase >= 1.0) {
    this.glottalPhase -= Math.floor(this.glottalPhase);
  }

  var glottalSample = 0;
  var pw = this.glottalPulseWidth;
  if (this.glottalPhase < pw) {
    var openPhase = this.glottalPhase / pw;
    glottalSample = Math.sin(Math.PI * openPhase);
  }

  var noiseSample = (Math.random() * 2 - 1) * 0.5;

  var excitation = glottalSample * (1 - this.breathiness) + noiseSample * this.breathiness;

  var sample = 0;
  for (var i = 0; i < NUM_FORMANTS; i++) {
    sample += this.filters[i].process(excitation) * this.formantAmps[i];
  }

  sample *= 0.85;
  sample *= env * this.velocity;

  if (this.fadeInCounter < this.fadeInSamples) {
    sample *= this.fadeInCounter / this.fadeInSamples;
    this.fadeInCounter++;
  }

  return sample;
};

// ============================================================
// FormantWorkletProcessor
// ============================================================

class FormantWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.sr = sampleRate;

    // 16 voices for this instrument instance
    this.voices = [];
    for (var i = 0; i < MAX_VOICES_PER_INSTRUMENT; i++) {
      this.voices.push(new FormantVoice(this.sr));
    }

    // Current formant settings (updated from main thread)
    this.vowel = 'A';
    this.vowelTarget = 'E';
    this.morphX = 0;
    this.formantShift = 0;
    this.breathiness = 20;
    this.glottalPulseWidth = 50;

    // Vowel sequence state
    this.vowelSequenceEnabled = false;
    this.vowelSequence = ['A', 'E', 'I', 'O', 'U'];
    this.vowelSequenceRate = 2.0;
    this._seqCounter = 0;
    this._seqIndex = 0;

    // Custom vowel support
    this.customVowelData = null;

    this.port.onmessage = this.handleMessage.bind(this);
    this.port.postMessage({ type: 'ready' });
  }

  handleMessage(event) {
    var data = event.data;

    switch (data.type) {
      case 'noteOn':
        this.onNoteOn(data);
        break;

      case 'noteOff':
        this.onNoteOff(data.midiNote);
        break;

      case 'allNotesOff':
        this.onAllNotesOff();
        break;

      case 'updateSettings':
        this.onUpdateSettings(data);
        break;

      case 'setCustomVowelData':
        if (data.vowelData) {
          VOWEL_DATA['_CUSTOM'] = {
            freqs: data.vowelData.freqs.slice(),
            amps: data.vowelData.amps.slice(),
            bws: data.vowelData.bws.slice()
          };
          this.customVowelData = VOWEL_DATA['_CUSTOM'];
        }
        break;
    }
  }

  onNoteOn(data) {
    var voice = null;
    for (var i = 0; i < this.voices.length; i++) {
      if (!this.voices[i].active) {
        voice = this.voices[i];
        break;
      }
    }
    if (!voice) {
      voice = this.voices[0]; // steal oldest
    }
    voice.noteOn(data.midiNote, data.velocity, data.noteFreq, data.settings);
  }

  onNoteOff(midi) {
    for (var i = 0; i < this.voices.length; i++) {
      var v = this.voices[i];
      if (v.active && v.midiNote === midi) {
        v.noteOff();
      }
    }
  }

  onAllNotesOff() {
    for (var i = 0; i < this.voices.length; i++) {
      if (this.voices[i].active) {
        this.voices[i].noteOff();
      }
    }
  }

  onUpdateSettings(data) {
    if (data.vowel !== undefined) { this.vowel = data.vowel; }
    if (data.vowelTarget !== undefined) { this.vowelTarget = data.vowelTarget; }
    if (data.morphX !== undefined) { this.morphX = data.morphX; }
    if (data.formantShift !== undefined) { this.formantShift = data.formantShift; }
    if (data.breathiness !== undefined) { this.breathiness = data.breathiness; }
    if (data.glottalPulseWidth !== undefined) { this.glottalPulseWidth = data.glottalPulseWidth; }
    if (data.vowelSequenceEnabled !== undefined) { this.vowelSequenceEnabled = data.vowelSequenceEnabled; }
    if (data.vowelSequence !== undefined) { this.vowelSequence = data.vowelSequence; }
    if (data.vowelSequenceRate !== undefined) { this.vowelSequenceRate = data.vowelSequenceRate; }
  }

  process(inputs, outputs, parameters) {
    var output = outputs[0];
    var channel = output[0];

    if (!channel) {
      return true;
    }

    var blockSize = channel.length;

    // Compute current formants
    var formants = interpolateFormants(
      this.vowel,
      this.vowelTarget,
      this.morphX,
      this.formantShift
    );

    // Handle vowel sequence auto-cycling
    if (this.vowelSequenceEnabled && this.vowelSequence && this.vowelSequence.length > 1) {
      var seqLen = this.vowelSequence.length;
      var samplesPerVowel = Math.max(1, Math.round(this.sr / this.vowelSequenceRate));
      this._seqCounter += blockSize;
      if (this._seqCounter >= samplesPerVowel) {
        this._seqCounter -= samplesPerVowel;
        this._seqIndex = (this._seqIndex + 1) % seqLen;
        this.vowel = this.vowelSequence[this._seqIndex];
        this.vowelTarget = this.vowelSequence[(this._seqIndex + 1) % seqLen];
        formants = interpolateFormants(
          this.vowel,
          this.vowelTarget,
          this.morphX,
          this.formantShift
        );
      }
    }

    // Update active voices with current formant parameters
    var breathNorm = Math.max(0, Math.min(1, (this.breathiness || 0) / 100));
    var pulseNorm = Math.max(0.1, Math.min(0.9, (this.glottalPulseWidth || 50) / 100));
    for (var vi = 0; vi < this.voices.length; vi++) {
      if (this.voices[vi].active) {
        this.voices[vi].setFormants(formants);
        this.voices[vi].breathiness = breathNorm;
        this.voices[vi].glottalPulseWidth = pulseNorm;
      }
    }

    // Generate audio
    // Count active voices for per-voice gain scaling to prevent clipping
    var activeVoiceCount = 0;
    for (var vc = 0; vc < this.voices.length; vc++) {
      if (this.voices[vc].active) {
        activeVoiceCount++;
      }
    }
    var perVoiceGain = (activeVoiceCount > 1) ? (1.0 / Math.sqrt(activeVoiceCount)) : 1.0;
    var PER_VOICE_BASE_GAIN = 0.75;

    for (var s = 0; s < blockSize; s++) {
      var sample = 0;
      for (var vi2 = 0; vi2 < this.voices.length; vi2++) {
        if (this.voices[vi2].active) {
          sample += this.voices[vi2].processSample() * PER_VOICE_BASE_GAIN * perVoiceGain;
        }
      }
      // Soft clip (normalizes to ~1.0 range without harsh distortion)
      var ss = sample * sample;
      var clipped = sample * (27 + ss) / (27 + 9 * ss);
      // Apply output boost
      channel[s] = clipped * FORMANT_OUTPUT_BOOST;
    }

    return true;
  }
}

registerProcessor('formant-processor', FormantWorkletProcessor);
