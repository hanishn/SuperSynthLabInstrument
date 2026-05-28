// Super Synth Lab - Formant AudioWorklet Processor
// Vowel/vocal synthesis running on dedicated audio thread
// Ported from ScriptProcessor formant-engine.js for iOS Safari compatibility
// v1.0 - 5-formant model, vowel morphing, sequence, breathiness, glottal pulse
//
// ================================================================
// EDUCATIONAL CONTEXT: Formant Synthesis — Audio Thread
// ================================================================
//
// This file runs on the AudioWorklet thread, isolated from the main
// thread to guarantee glitch-free real-time audio. It duplicates the
// formant voice DSP from formant-engine.js (which hosts the fallback
// ScriptProcessor path and parameter management).
//
// The synthesis implements Fant's source-filter model:
//   1. Glottal pulse (Rosenberg half-sine) = vocal cord vibration
//   2. Five parallel biquad bandpass filters = vocal tract formants
//   3. Noise mixing = aspiration/breathiness
//
// Each AudioWorklet process() call renders 128 samples (~2.9ms at
// 44.1kHz). All voice state must persist between calls since the
// worklet has no control over when process() is invoked.
//
// For full theory, vowel data sources, and signal flow diagrams,
// see the header comments in formant-engine.js.
//
// References:
//   - Fant, G. (1960) Acoustic Theory of Speech Production, Mouton
//   - Klatt, D.H. (1980) "Software for a cascade/parallel formant
//     synthesizer", JASA 67(3)
//   - Peterson, G.E. & Barney, H.L. (1952) JASA 24(2)
// ================================================================

var NUM_FORMANTS = 5;
var TWO_PI = 2 * Math.PI;
var MAX_VOICES_PER_INSTRUMENT = 16;
var FORMANT_OUTPUT_BOOST = 3.0;

// ============================================================
// Vowel Formant Data (research-accurate)
// Based on Peterson & Barney (1952) and Hillenbrand et al. (1995)
// ============================================================
//
// ---------------------------------------------------------------
// Duplicated vowel data for the worklet thread (AudioWorklet
// scope cannot access main-thread globals). See formant-engine.js
// for detailed documentation of each vowel's formant values and
// their acoustic/articulatory significance.
// ---------------------------------------------------------------

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
//
// ---------------------------------------------------------------
// Log-Frequency Vowel Morphing
// Interpolates formant frequencies in log space for perceptually
// uniform transitions between vowels. The formant shift parameter
// transposes the entire vocal tract model by semitones, equivalent
// to scaling the physical tube length (shorter = higher pitch =
// child/female voice characteristics).
// Formula: F = exp(ln(Fa) + (ln(Fb) - ln(Fa)) * t) * 2^(shift/12)
// See: Roads (1996), Ch. 4; Klatt (1980), Section IV
// ---------------------------------------------------------------

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
//
// ---------------------------------------------------------------
// Biquad Bandpass — Real-Time Formant Resonator
// Each of the 5 formants is a 2nd-order IIR bandpass filter.
// Direct Form II Transposed uses only 2 delay elements (z1, z2)
// and is numerically stable for the narrow bandwidths (~60-300 Hz)
// used in formant synthesis. The alpha coefficient sets resonance
// width: alpha = sin(w0) * sinh(ln(2)/2 * BW/f0 * w0/sin(w0)).
// See: Bristow-Johnson, "Audio EQ Cookbook" (2005)
// ---------------------------------------------------------------

function BiquadBPF() {
  this.b0 = 0; this.b1 = 0; this.b2 = 0;
  this.a1 = 0; this.a2 = 0;
  this.z1 = 0; this.z2 = 0;
}

BiquadBPF.prototype.set = function(freq, bw, sr) {
  // Clamp to safe range: below Nyquist and above audible minimum
  var nyq = sr * 0.499;
  if (freq > nyq) { freq = nyq; }
  if (freq < 20) { freq = 20; }
  if (bw < 10) { bw = 10; }

  // w0 = angular frequency in radians per sample
  var w0 = TWO_PI * freq / sr;
  var cosW0 = Math.cos(w0);
  var sinW0 = Math.sin(w0);
  // Bandwidth-based alpha using the constant-skirt-gain BPF formula
  var alpha = sinW0 * Math.sinh(Math.log(2) / 2 * (bw / freq) * (w0 / sinW0));

  // Normalize by a0 so feedback denominator leading coefficient = 1
  var a0 = 1 + alpha;
  this.b0 = alpha / a0;
  this.b1 = 0;
  this.b2 = -alpha / a0;
  this.a1 = -2 * cosW0 / a0;
  this.a2 = (1 - alpha) / a0;
};

BiquadBPF.prototype.process = function(input) {
  // Direct Form II Transposed: output computed first, then state updated.
  // This ordering minimizes quantization noise for narrow resonances.
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
//
// ---------------------------------------------------------------
// FormantVoice — Worklet-Thread Voice Instance
// Implements the same Fant source-filter model as the main-thread
// fallback: Rosenberg glottal pulse -> 5 parallel BPF formants.
// This version uses processSample() (called per-sample from the
// worklet's process() method) rather than the block-oriented
// onaudioprocess callback used by the ScriptProcessor fallback.
// See: formant-engine.js FormantVoice for detailed annotations.
// ---------------------------------------------------------------

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

  // Glottal pulse excitation (Rosenberg model).
  // Phase accumulator increments by f0/sr each sample, producing a
  // sawtooth ramp from 0 to 1 at the fundamental frequency.
  // The open phase (0 to pw) outputs sin(pi * phase/pw); the closed
  // phase (pw to 1) outputs silence — modeling vocal cord vibration.
  var phaseInc = this.baseFreq / this.sampleRate;
  this.glottalPhase += phaseInc;
  if (this.glottalPhase >= 1.0) {
    this.glottalPhase -= Math.floor(this.glottalPhase);
  }

  var glottalSample = 0;
  var pw = this.glottalPulseWidth;
  var safePw = pw || 0.001;
  if (this.glottalPhase < pw) {
    var openPhase = this.glottalPhase / safePw;
    glottalSample = Math.sin(Math.PI * openPhase);
  }

  // White noise for aspiration/breathiness (Klatt's AH parameter)
  var noiseSample = (Math.random() * 2 - 1) * 0.5;

  // Source mix: pulse*(1-breath) + noise*breath models the continuum
  // from fully voiced (breath=0) to fully whispered (breath=1)
  var excitation = glottalSample * (1 - this.breathiness) + noiseSample * this.breathiness;

  // Parallel formant filter bank: excitation passes through all 5 BPFs
  // simultaneously and results are amplitude-weighted and summed.
  // This is Klatt's parallel configuration (vs. cascade/series).
  var sample = 0;
  for (var i = 0; i < NUM_FORMANTS; i++) {
    sample += this.filters[i].process(excitation) * this.formantAmps[i];
  }

  // Normalization scalar for 5 summed bandpass outputs
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
//
// ---------------------------------------------------------------
// AudioWorklet Processor — Real-Time Audio Rendering
// This class runs on the browser's audio rendering thread, which
// has stricter timing requirements than the main thread. The
// process() method is called every 128 samples (~2.9ms at 44.1kHz)
// and must complete within that window to avoid audio glitches.
// All communication with the main thread goes through MessagePort
// (postMessage/onmessage) — no shared memory or direct calls.
// ---------------------------------------------------------------

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
    var hasVowelSeq = this.vowelSequence && this.vowelSequence.length > 1;
    var shouldCycleVowelSeq = this.vowelSequenceEnabled && hasVowelSeq;
    if (shouldCycleVowelSeq) {
      var seqLen = this.vowelSequence.length;
      var safeSeqLen = seqLen || 1;
      var samplesPerVowel = Math.max(1, Math.round(this.sr / this.vowelSequenceRate));
      this._seqCounter += blockSize;
      if (this._seqCounter >= samplesPerVowel) {
        this._seqCounter -= samplesPerVowel;
        this._seqIndex = (this._seqIndex + 1) % safeSeqLen;
        this.vowel = this.vowelSequence[this._seqIndex];
        this.vowelTarget = this.vowelSequence[(this._seqIndex + 1) % safeSeqLen];
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

    // Generate audio sample-by-sample
    // Count active voices for 1/sqrt(N) gain scaling (constant-power law
    // for uncorrelated signals — same principle as equal-power panning)
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
      // Soft clip via Pade [3,2] approximant of tanh:
      // tanh(x) ~ x*(27+x^2)/(27+9*x^2). Provides smooth saturation
      // without the hard knee of clamp-based clipping, preserving
      // harmonic overtones that are critical to vowel timbre.
      var ss = sample * sample;
      var clipped = sample * (27 + ss) / (27 + 9 * ss);
      // Apply output boost
      channel[s] = clipped * FORMANT_OUTPUT_BOOST;
    }

    return true;
  }
}

registerProcessor('formant-processor', FormantWorkletProcessor);
