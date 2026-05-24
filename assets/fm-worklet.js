// Super Synth Lab - FM Synthesis AudioWorklet Processor
// 6-operator DX7-style FM synthesis on the audio thread
// v1.2.2 — perf: SINE_TABLE double-read fix, ALGORITHMS cache at noteOn

var TWO_PI = 2 * Math.PI;

// ============================================================
// Wavetable Sine (4096 entries, linear interpolation)
// ============================================================

var SINE_TABLE_SIZE = 4096;
var SINE_TABLE = new Float64Array(SINE_TABLE_SIZE);
for (var i = 0; i < SINE_TABLE_SIZE; i++) {
  SINE_TABLE[i] = Math.sin(TWO_PI * i / SINE_TABLE_SIZE);
}
var SINE_TABLE_MASK = SINE_TABLE_SIZE - 1;

var VOICE_OUTPUT_GAIN = 0.18;

// ============================================================
// DX7 Envelope Generator
// ============================================================

class DX7Envelope {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.stage = 0;       // 0=R1->L1, 1=R2->L2, 2=R3->L3 (sustain), 3=R4->L4 (release)
    this.level = 0;       // Current linear level 0..1
    this.released = false;
    this.finished = false;
    this.rates = [95, 50, 50, 50];   // R1-R4 (0-99)
    this.levels = [99, 99, 99, 0];   // L1-L4 (0-99)
    this.cachedTarget = 0;     // Cached target level (linear)
    this.cachedIncrement = 0;  // Cached rate increment per sample
  }

  setParams(r1, r2, r3, r4, l1, l2, l3, l4) {
    this.rates[0] = r1; this.rates[1] = r2;
    this.rates[2] = r3; this.rates[3] = r4;
    this.levels[0] = l1; this.levels[1] = l2;
    this.levels[2] = l3; this.levels[3] = l4;
  }

  keyOn() {
    this.stage = 0;
    this.released = false;
    this.finished = false;
    // Start from L4 (or current level for legato)
    this.cachedTarget = this.dx7LevelToLinear(this.levels[0]);
    this.cachedIncrement = this.dx7RateToIncrement(this.rates[0]);
  }

  keyOff() {
    if (this.finished) return;
    this.released = true;
    this.stage = 3;
    this.cachedTarget = this.dx7LevelToLinear(this.levels[3]);
    this.cachedIncrement = this.dx7RateToIncrement(this.rates[3]);
  }

  // Convert DX7 level (0-99) to linear amplitude
  dx7LevelToLinear(level) {
    if (level === 0) return 0;
    return Math.pow(level / 99, 2.5);
  }

  // Convert DX7 rate (0-99) to increment per sample
  dx7RateToIncrement(rate) {
    // rate in dB/s ~ 0.2819 * 2^(rate * 0.16)
    var dbPerSec = 0.2819 * Math.pow(2, rate * 0.16);
    var dbPerSample = dbPerSec / this.sampleRate;
    return dbPerSample / 96; // Normalize to 0..1 range (96 dB dynamic range)
  }

  process() {
    if (this.finished) return 0;

    var targetLevel = this.cachedTarget;
    var increment = this.cachedIncrement;

    // Move toward target
    if (this.level < targetLevel) {
      this.level += increment;
      if (this.level >= targetLevel) {
        this.level = targetLevel;
        this.advanceStage();
      }
    } else if (this.level > targetLevel) {
      this.level -= increment;
      if (this.level <= targetLevel) {
        this.level = targetLevel;
        this.advanceStage();
      }
    } else {
      this.advanceStage();
    }

    return this.level;
  }

  advanceStage() {
    if (this.released) {
      // In release stage, check if done
      if (this.stage === 3 && this.level <= 0.0001) {
        this.finished = true;
        this.level = 0;
      }
      return;
    }
    // Advance through attack/decay stages, hold at sustain (stage 2)
    if (this.stage < 2) {
      this.stage++;
      this.cachedTarget = this.dx7LevelToLinear(this.levels[this.stage]);
      this.cachedIncrement = this.dx7RateToIncrement(this.rates[this.stage]);
    }
    // Stage 2 = sustain, hold here until keyOff
  }

  isFinished() {
    return this.finished;
  }
}

// ============================================================
// FM Operator
// ============================================================

class FMOperator {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.phase = 0;        // 0..1 phase accumulator
    this.envelope = new DX7Envelope(sampleRate);
    this.frequency = 440;
    this.phaseInc = 440 / sampleRate; // Pre-computed phase increment
    this.outputLevel = 0;  // 0-99
    this.amplitude = 0;    // Computed from outputLevel
    this.ratioCoarse = 1;
    this.ratioFine = 0;
    this.detune = 7;       // 7 = center
    this.velocitySens = 0;
    this.rateScaling = 0;
    this.velocityScale = 1;
  }

  setParams(params) {
    if (params.ratioCoarse !== undefined) this.ratioCoarse = params.ratioCoarse;
    if (params.ratioFine !== undefined) this.ratioFine = params.ratioFine;
    if (params.level !== undefined) {
      this.outputLevel = params.level;
      this.amplitude = this.levelToAmplitude(params.level);
    }
    if (params.detune !== undefined) this.detune = params.detune;
    if (params.velocitySens !== undefined) this.velocitySens = params.velocitySens;
    if (params.rateScaling !== undefined) this.rateScaling = params.rateScaling;
    if (params.envelope) {
      var e = params.envelope;
      this.envelope.setParams(e.R1, e.R2, e.R3, e.R4, e.L1, e.L2, e.L3, e.L4);
    }
  }

  levelToAmplitude(level) {
    if (level === 0) return 0;
    return Math.pow(2, (level - 99) / 8);
  }

  // Compute the operator's base frequency from a note frequency
  computeFrequency(noteFreq) {
    var ratio;
    if (this.ratioCoarse === 0) {
      ratio = 0.5;
    } else {
      ratio = this.ratioCoarse;
    }
    ratio *= (1 + this.ratioFine * 0.01);

    // Detune: +-7 cents, value 7 = center
    var detuneCents = (this.detune - 7);
    var detuneMultiplier = Math.pow(2, detuneCents / 1200);

    this.frequency = noteFreq * ratio * detuneMultiplier;
    this.phaseInc = this.frequency / this.sampleRate;
  }

  keyOn(noteFreq, velocity) {
    this.computeFrequency(noteFreq);
    this.phase = Math.random();

    // Apply velocity sensitivity
    var velNorm = velocity / 127;
    var sens = this.velocitySens / 7;
    this.velocityScale = 1 - sens + sens * velNorm;

    this.envelope.keyOn();
  }

  keyOff() {
    this.envelope.keyOff();
  }

  // Render one sample. modInput = phase modulation in radians.
  process(modInput) {
    // Advance phase using pre-computed increment
    this.phase += this.phaseInc;
    this.phase -= (this.phase | 0);

    // FM: wavetable lookup with linear interpolation
    var tablePhase = this.phase + modInput / TWO_PI;
    tablePhase -= (tablePhase | 0);
    if (tablePhase < 0) tablePhase += 1;
    var idx = tablePhase * SINE_TABLE_SIZE;
    var i0 = idx | 0;
    var frac = idx - i0;
    var s0 = SINE_TABLE[i0 & SINE_TABLE_MASK];
    var out = s0 + frac * (SINE_TABLE[(i0 + 1) & SINE_TABLE_MASK] - s0);

    // Apply envelope and level
    var envLevel = this.envelope.process();
    return out * envLevel * this.amplitude * this.velocityScale;
  }

  isFinished() {
    return this.envelope.isFinished();
  }
}

// ============================================================
// 32 DX7 Algorithms (0-indexed operator numbers: Op1=0 .. Op6=5)
// ============================================================

var ALGORITHMS = {
  // Algorithm 1: [FB]6->5->4->3; 2->1  carriers: 1,3
  1:  { carriers: [0, 2], modulations: [[5,4],[4,3],[3,2],[1,0]], feedbackOp: 5 },
  // Algorithm 2: 6->5->4->3; [FB]2->1  carriers: 1,3
  2:  { carriers: [0, 2], modulations: [[5,4],[4,3],[3,2],[1,0]], feedbackOp: 1 },
  // Algorithm 3: [FB]6->5->4; 3->2->1  carriers: 1,4
  3:  { carriers: [0, 3], modulations: [[5,4],[4,3],[2,1],[1,0]], feedbackOp: 5 },
  // Algorithm 4: 6->5->[FB]4->3; 2->1  carriers: 1,3 (feedback on op4=index3)
  4:  { carriers: [0, 2], modulations: [[5,4],[4,3],[3,2],[1,0]], feedbackOp: 3 },
  // Algorithm 5: [FB]6->5; 4->3; 2->1  carriers: 1,3,5
  5:  { carriers: [0, 2, 4], modulations: [[5,4],[3,2],[1,0]], feedbackOp: 5 },
  // Algorithm 6: 6->[FB]5->4; 3->2; 1  carriers: 1,2,4
  6:  { carriers: [0, 1, 3], modulations: [[5,4],[4,3],[2,1]], feedbackOp: 4 },
  // Algorithm 7: [FB]6->5->(4+3)->2->1  carriers: 1
  7:  { carriers: [0], modulations: [[5,4],[4,3],[4,2],[3,1],[2,1],[1,0]], feedbackOp: 5 },
  // Algorithm 8: [FB]4->3; 6->5; (3+5)->2->1  carriers: 1
  8:  { carriers: [0], modulations: [[3,2],[5,4],[2,1],[4,1],[1,0]], feedbackOp: 3 },
  // Algorithm 9: 4->3; 6->5; (3+5)->[FB]2->1  carriers: 1
  9:  { carriers: [0], modulations: [[3,2],[5,4],[2,1],[4,1],[1,0]], feedbackOp: 1 },
  // Algorithm 10: [FB]3->2->1; 6->5->4  carriers: 1,4
  10: { carriers: [0, 3], modulations: [[2,1],[1,0],[5,4],[4,3]], feedbackOp: 2 },
  // Algorithm 11: [FB]6->5->4; 3->2->1  carriers: 1,4 (same as 3 but different FB)
  11: { carriers: [0, 3], modulations: [[5,4],[4,3],[2,1],[1,0]], feedbackOp: 5 },
  // Algorithm 12: [FB]2->1; 6->5->4->3  carriers: 1,3
  12: { carriers: [0, 2], modulations: [[1,0],[5,4],[4,3],[3,2]], feedbackOp: 1 },
  // Algorithm 13: [FB]6->5->4->3; 2->1  carriers: 1,3
  13: { carriers: [0, 2], modulations: [[5,4],[4,3],[3,2],[1,0]], feedbackOp: 5 },
  // Algorithm 14: [FB]6->5->4->3; 2->1  carriers: 1,3 (same routing as 13)
  14: { carriers: [0, 2], modulations: [[5,4],[4,3],[3,2],[1,0]], feedbackOp: 5 },
  // Algorithm 15: [FB]2->1; 6->5->3  carriers: 1,3
  15: { carriers: [0, 2], modulations: [[1,0],[5,4],[4,2]], feedbackOp: 1 },
  // Algorithm 16: [FB]6->5; (5+3+2)->1; 4->3  carriers: 1
  16: { carriers: [0], modulations: [[5,4],[4,0],[3,2],[2,0],[1,0]], feedbackOp: 5 },
  // Algorithm 17: [FB]2; 6->5; 3->2; (5+4+2)->1  carriers: 1
  17: { carriers: [0], modulations: [[2,1],[5,4],[1,0],[4,0],[3,0]], feedbackOp: 1 },
  // Algorithm 18: [FB]3->2; 6->5->4; (2+4)->1  carriers: 1
  18: { carriers: [0], modulations: [[2,1],[5,4],[4,3],[1,0],[3,0]], feedbackOp: 2 },
  // Algorithm 19: [FB]6->5->(4+3+2); 1  carriers: 1,2,3,4
  19: { carriers: [0, 1, 2, 3], modulations: [[5,4],[4,3],[4,2],[4,1]], feedbackOp: 5 },
  // Algorithm 20: [FB]3->2->1; 6->(5+4)  carriers: 1,4,5
  20: { carriers: [0, 3, 4], modulations: [[2,1],[1,0],[5,4],[5,3]], feedbackOp: 2 },
  // Algorithm 21: [FB]6->(5+4+3); 2->1  carriers: 1,3,4,5
  21: { carriers: [0, 2, 3, 4], modulations: [[5,4],[5,3],[5,2],[1,0]], feedbackOp: 5 },
  // Algorithm 22: [FB]6->(5+4+3+2+1)  carriers: 1,2,3,4,5
  22: { carriers: [0, 1, 2, 3, 4], modulations: [[5,4],[5,3],[5,2],[5,1],[5,0]], feedbackOp: 5 },
  // Algorithm 23: [FB]6->5->4; 3; 2->1  carriers: 1,3,4
  23: { carriers: [0, 2, 3], modulations: [[5,4],[4,3],[1,0]], feedbackOp: 5 },
  // Algorithm 24: [FB]6->5->(4+3); 2; 1  carriers: 1,2,3,4
  24: { carriers: [0, 1, 2, 3], modulations: [[5,4],[4,3],[4,2]], feedbackOp: 5 },
  // Algorithm 25: [FB]6->5->4; 3; 2; 1  carriers: 1,2,3,4
  25: { carriers: [0, 1, 2, 3], modulations: [[5,4],[4,3]], feedbackOp: 5 },
  // Algorithm 26: [FB]6->5->4; 6->3; 2->1  carriers: 1,3,4
  26: { carriers: [0, 2, 3], modulations: [[5,4],[4,3],[5,2],[1,0]], feedbackOp: 5 },
  // Algorithm 27: [FB]6->5; 3->2->1; 4  carriers: 1,4,5
  27: { carriers: [0, 3, 4], modulations: [[5,4],[2,1],[1,0]], feedbackOp: 5 },
  // Algorithm 28: [FB]5->4->3; 2->1; 6  carriers: 1,3,6
  28: { carriers: [0, 2, 5], modulations: [[4,3],[3,2],[1,0]], feedbackOp: 4 },
  // Algorithm 29: [FB]6->5; 4->3; 2; 1  carriers: 1,2,3,5
  29: { carriers: [0, 1, 2, 4], modulations: [[5,4],[3,2]], feedbackOp: 5 },
  // Algorithm 30: [FB]5->4->3; 6; 2; 1  carriers: 1,2,3,6
  30: { carriers: [0, 1, 2, 5], modulations: [[4,3],[3,2]], feedbackOp: 4 },
  // Algorithm 31: [FB]6->5; 4; 3; 2; 1  carriers: 1,2,3,4,5
  31: { carriers: [0, 1, 2, 3, 4], modulations: [[5,4]], feedbackOp: 5 },
  // Algorithm 32: [FB]6; 5; 4; 3; 2; 1  (all carriers, pure additive)
  32: { carriers: [0, 1, 2, 3, 4, 5], modulations: [], feedbackOp: 5 }
};

// ============================================================
// FM Voice
// ============================================================

class FMVoice {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.active = false;
    this.midiNote = -1;
    this.noteFreq = 0;
    this.algorithm = 1;
    this.feedbackLevel = 0;
    this.feedbackValue = 0;  // one-sample delay buffer
    this.instId = 0;
    this.operators = [];
    for (var i = 0; i < 6; i++) {
      this.operators.push(new FMOperator(sampleRate));
    }
    this.opOutputs = new Float64Array(6);
    this.cachedAlgo = null;
    // Pre-compiled modulation routes: opModSources[i] = array of operator indices that modulate operator i
    this.opModSources = [[], [], [], [], [], []];
    // Fade-in ramp to prevent click/pop at note onset
    this.fadeInSamples = 0;
    this.fadeInCounter = 0;
    // Per-voice timing stagger (humanization)
    this.startDelaySamples = 0;
  }

  noteOn(midiNote, velocity, noteFreq, settings) {
    this.active = true;
    this.midiNote = midiNote;
    this.noteFreq = noteFreq;
    this.algorithm = settings.algorithm || 1;
    this.feedbackLevel = this.feedbackToScale(settings.feedback || 0);
    this.feedbackValue = 0;
    this.instId = settings.instId || 0;

    // Per-voice velocity randomization
    var humVelocity = settings.humVelocity || 0;
    var velRange = Math.round(humVelocity * 1.2);
    var vel = velocity;
    if (velRange > 0) {
      vel = velocity + Math.round((Math.random() * 2 - 1) * velRange);
      if (vel < 1) vel = 1;
      if (vel > 127) vel = 127;
    }

    // Per-voice ADSR jitter for FM operator envelopes
    var humAdsr = settings.humAdsr || 0;

    // Short amplitude fade-in (~8ms) to prevent click/pop at onset
    this.fadeInSamples = Math.ceil(this.sampleRate * 0.008);
    this.fadeInCounter = 0;

    // Per-voice timing stagger: random delay up to ~4ms at humTiming=100
    var humTiming = settings.humTiming || 0;
    if (humTiming > 0) {
      var maxDelay = Math.round(humTiming * 0.15 * this.sampleRate / 1000);
      this.startDelaySamples = Math.round(Math.random() * maxDelay);
    } else {
      this.startDelaySamples = 0;
    }

    this.cachedAlgo = ALGORITHMS[this.algorithm] || ALGORITHMS[1];

    // Configure each operator with per-voice jittered rates
    for (var i = 0; i < 6; i++) {
      var opSettings = settings.operators[i];
      if (humAdsr > 0) {
        // Deep copy envelope and jitter rates independently per operator per voice
        var origEnv = opSettings.envelope;
        if (origEnv) {
          var jR1 = 1 + (Math.random() * 2 - 1) * humAdsr * 0.015;
          var jR2 = 1 + (Math.random() * 2 - 1) * humAdsr * 0.015;
          var jR4 = 1 + (Math.random() * 2 - 1) * humAdsr * 0.015;
          var jitteredOp = {
            ratioCoarse: opSettings.ratioCoarse,
            ratioFine: opSettings.ratioFine,
            level: opSettings.level,
            detune: opSettings.detune,
            velocitySens: opSettings.velocitySens,
            rateScaling: opSettings.rateScaling,
            envelope: {
              R1: Math.max(0, Math.min(99, Math.round(origEnv.R1 * jR1))),
              R2: Math.max(0, Math.min(99, Math.round(origEnv.R2 * jR2))),
              R3: origEnv.R3,
              R4: Math.max(0, Math.min(99, Math.round(origEnv.R4 * jR4))),
              L1: origEnv.L1, L2: origEnv.L2, L3: origEnv.L3, L4: origEnv.L4
            }
          };
          this.operators[i].setParams(jitteredOp);
        } else {
          this.operators[i].setParams(opSettings);
        }
      } else {
        this.operators[i].setParams(opSettings);
      }
      this.operators[i].keyOn(noteFreq, vel);
    }

    // Pre-compile modulation routes for this algorithm
    this.compileModRoutes();
  }

  compileModRoutes() {
    var algo = this.cachedAlgo;
    if (!algo) return;
    for (var i = 0; i < 6; i++) this.opModSources[i] = [];
    var mods = algo.modulations;
    for (var m = 0; m < mods.length; m++) {
      this.opModSources[mods[m][1]].push(mods[m][0]);
    }
  }

  noteOff() {
    for (var i = 0; i < 6; i++) {
      this.operators[i].keyOff();
    }
  }

  feedbackToScale(fb) {
    // DX7 feedback 0-7 mapped to modulation scale
    // 0 = no feedback, 7 = maximum
    if (fb === 0) return 0;
    return Math.PI * Math.pow(2, (fb - 7) / 2);
  }

  // Process one sample, returns audio output
  process() {
    if (!this.active) return 0;

    // Per-voice timing stagger: output silence during delay period
    if (this.startDelaySamples > 0) {
      this.startDelaySamples--;
      return 0;
    }

    var algo = this.cachedAlgo;
    if (!algo) return 0;

    var ops = this.operators;
    var out = this.opOutputs;
    var opMod = this.opModSources;
    var fbOp = algo.feedbackOp;
    var fbLevel = this.feedbackLevel;
    var fbValue = this.feedbackValue;

    // Process operators top-down (6->1) so modulators compute before carriers
    for (var i = 5; i >= 0; i--) {
      var modInput = 0;

      // Sum modulation inputs from pre-compiled sources
      var sources = opMod[i];
      for (var m = 0; m < sources.length; m++) {
        modInput += out[sources[m]];
      }

      // Add feedback if this is the feedback operator
      if (i === fbOp) {
        modInput += fbValue * fbLevel;
      }

      // Process operator
      out[i] = ops[i].process(modInput);

      // Store feedback (one-sample delay)
      if (i === fbOp) {
        fbValue = out[i];
      }
    }

    this.feedbackValue = fbValue;

    // Sum carrier outputs
    var sample = 0;
    var carriers = algo.carriers;
    for (var c = 0; c < carriers.length; c++) {
      sample += out[carriers[c]];
    }

    // Normalize by number of carriers to prevent clipping
    sample /= carriers.length;

    // Apply fade-in ramp
    if (this.fadeInCounter < this.fadeInSamples) {
      sample *= this.fadeInCounter / this.fadeInSamples;
      this.fadeInCounter++;
    }

    // Soft clipper for high feedback: prevents runaway oscillation
    // feedbackLevel > 2.0 roughly corresponds to DX7 feedback >= 6
    var FB_SOFT_CLIP_THRESHOLD = 2.0;
    var TANH_SCALE = 0.8;
    var INV_TANH_SCALE = 1.0 / Math.tanh(TANH_SCALE);
    if (fbLevel > FB_SOFT_CLIP_THRESHOLD) {
      sample = Math.tanh(sample * TANH_SCALE) * INV_TANH_SCALE;
    }

    return sample;
  }
}

// ============================================================
// FM Worklet Processor
// ============================================================

class FMWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.maxVoices = 64; // 16 voices x 4 instruments
    this.activeCount = 0;
    this.voices = [];
    for (var i = 0; i < this.maxVoices; i++) {
      this.voices.push(new FMVoice(sampleRate));
    }
    // Compact active voice tracking: indices into this.voices[]
    this.activeVoiceIndices = [];

    this.port.onmessage = this.handleMessage.bind(this);
    this.port.postMessage({ type: 'ready' });
  }

  handleMessage(event) {
    var data = event.data;

    switch (data.type) {
      case 'noteOn':
        this.startNote(data.midiNote, data.velocity, data.noteFreq, data.settings);
        break;

      case 'noteOff':
        this.stopNote(data.midiNote, data.instId);
        break;

      case 'allNotesOff':
        this.stopAllNotes(data.instId);
        break;

      case 'updateOperator':
        this.updateOperator(data.midiNote, data.instId, data.opIndex, data.params);
        break;

      case 'updateAlgorithm':
        this.updateAlgorithm(data.instId, data.algorithm);
        break;

      case 'updateFeedback':
        this.updateFeedback(data.instId, data.feedback);
        break;
    }
  }

  startNote(midiNote, velocity, noteFreq, settings) {
    // Find a free voice, or steal the oldest
    var voice = null;
    var voiceIdx = -1;
    var instId = settings.instId || 0;

    // Count active voices for this instrument
    var instVoiceCount = 0;

    for (var i = 0; i < this.maxVoices; i++) {
      if (!this.voices[i].active) {
        voice = this.voices[i];
        voiceIdx = i;
        break;
      }
      if (this.voices[i].instId === instId) {
        instVoiceCount++;
      }
    }

    // Voice stealing: if no free voice, steal oldest for same instrument
    if (!voice) {
      for (var j = 0; j < this.maxVoices; j++) {
        if (this.voices[j].instId === instId) {
          voice = this.voices[j];
          voiceIdx = j;
          break;
        }
      }
      // Last resort: steal first voice
      if (!voice) {
        voice = this.voices[0];
        voiceIdx = 0;
      }
    }

    if (!voice.active) {
      this.activeCount++;
      this.activeVoiceIndices.push(voiceIdx);
    }
    voice.noteOn(midiNote, velocity, noteFreq, settings);
  }

  stopNote(midiNote, instId) {
    for (var i = 0; i < this.maxVoices; i++) {
      var v = this.voices[i];
      if (v.active && v.midiNote === midiNote && v.instId === instId) {
        v.noteOff();
      }
    }
  }

  stopAllNotes(instId) {
    for (var i = 0; i < this.maxVoices; i++) {
      if (instId === undefined || this.voices[i].instId === instId) {
        if (this.voices[i].active) {
          this.voices[i].noteOff();
        }
      }
    }
  }

  updateOperator(midiNote, instId, opIndex, params) {
    for (var i = 0; i < this.maxVoices; i++) {
      var v = this.voices[i];
      if (v.active && v.instId === instId) {
        if (midiNote === undefined || v.midiNote === midiNote) {
          v.operators[opIndex].setParams(params);
          if (params.level !== undefined) {
            v.operators[opIndex].amplitude = v.operators[opIndex].levelToAmplitude(params.level);
          }
        }
      }
    }
  }

  updateAlgorithm(instId, algorithm) {
    for (var i = 0; i < this.maxVoices; i++) {
      if (this.voices[i].active && this.voices[i].instId === instId) {
        this.voices[i].algorithm = algorithm;
        this.voices[i].cachedAlgo = ALGORITHMS[algorithm] || ALGORITHMS[1];
        this.voices[i].compileModRoutes();
      }
    }
  }

  updateFeedback(instId, feedback) {
    for (var i = 0; i < this.maxVoices; i++) {
      if (this.voices[i].active && this.voices[i].instId === instId) {
        this.voices[i].feedbackLevel = this.voices[i].feedbackToScale(feedback);
      }
    }
  }

  process(inputs, outputs, parameters) {
    var output = outputs[0];
    var channel = output[0];
    if (!channel) return true;

    var avi = this.activeVoiceIndices;
    var aviLen = avi.length;

    // Skip entire buffer if no active voices
    if (aviLen === 0) {
      for (var z = 0; z < channel.length; z++) {
        channel[z] = 0;
      }
      return true;
    }

    var voices = this.voices;
    var bufLen = channel.length;

    for (var s = 0; s < bufLen; s++) {
      var sample = 0;
      for (var v = 0; v < aviLen; v++) {
        sample += voices[avi[v]].process() * VOICE_OUTPUT_GAIN;
      }
      // Smooth soft clip using Pade approximant of tanh (always-on, no hard knee)
      var ss = sample * sample;
      channel[s] = sample * (27 + ss) / (27 + 9 * ss);
    }

    // After buffer: check for finished voices and compact activeVoiceIndices in-place
    var writeIdx = 0;
    for (var vi = 0; vi < aviLen; vi++) {
      var voice = voices[avi[vi]];
      if (voice.active) {
        var allDone = true;
        var ops = voice.operators;
        for (var j = 0; j < 6; j++) {
          if (!ops[j].isFinished()) { allDone = false; break; }
        }
        if (allDone) {
          voice.active = false;
          this.activeCount--;
        } else {
          avi[writeIdx++] = avi[vi];
        }
      }
    }
    avi.length = writeIdx;

    return true;
  }
}

registerProcessor('fm-worklet', FMWorkletProcessor);
