// Super Synth Lab - FM Synthesis AudioWorklet Processor
// 6-operator DX7-style FM synthesis on the audio thread
// v1.2.2 — perf: SINE_TABLE double-read fix, ALGORITHMS cache at noteOn
//
// ================================================================
// EDUCATIONAL CONTEXT: FM Synthesis — Audio Thread Implementation
// ================================================================
//
// See fm-engine.js for full FM synthesis theory, history, and
// references (Chowning 1973, Roads 1996, Puckette 2007).
//
// This file runs on the AudioWorklet thread — a dedicated real-time
// thread separate from the main UI thread. It performs the actual
// sample-by-sample FM computation: sine table lookup, operator
// chaining, envelope generation, and voice mixing. Every function
// here runs inside the 128-sample render quantum (~2.9ms at 44.1kHz)
// and must avoid allocations, garbage collection triggers, and any
// blocking operations.
//
// Key DSP techniques in this file:
//   - Wavetable sine lookup with linear interpolation (vs. Math.sin)
//   - Phase accumulator with bitwise floor for zero-allocation wrap
//   - Pre-compiled modulation routing (avoids per-sample branching)
//   - DX7-style 4-rate/4-level envelope with cached increments
//   - One-sample feedback delay for operator self-modulation
//   - Pade-approximant soft clipper for output limiting
//
// References:
//   - Chowning, J.M. (1973) JAES 21(7) — FM synthesis foundation
//   - Puckette, M. (2007) Ch. 5 — PM vs FM equivalence
//   - W3C AudioWorklet Spec — render quantum constraints
// ================================================================

var TWO_PI = 2 * Math.PI;

// ============================================================
// Wavetable Sine (4096 entries, linear interpolation)
// ============================================================
//
// ---------------------------------------------------------------
// Sine Lookup Table
// Math.sin() is expensive to call per-sample per-operator. With 6
// operators, 16 voices, and 44100 samples/sec, that would be
// ~4.2 million sin() calls per second. A pre-computed lookup table
// with linear interpolation is 5-10x faster and introduces
// negligible error (~-96 dB SNR with 4096 entries + lerp).
//
// Table size is a power of 2 (4096 = 2^12) so we can use bitwise
// AND masking (idx & 0xFFF) instead of modulo for index wrapping.
// Float64Array provides double-precision to minimize phase drift
// on sustained notes.
//
// Linear interpolation between adjacent table entries:
//   out = table[i] + frac * (table[i+1] - table[i])
// This smooths the staircase error of nearest-neighbor lookup.
//
// See: Roads (1996) The Computer Music Tutorial, Section 4.3
// ---------------------------------------------------------------

var SINE_TABLE_SIZE = 4096;
var SINE_TABLE = new Float64Array(SINE_TABLE_SIZE);
for (var i = 0; i < SINE_TABLE_SIZE; i++) {
  SINE_TABLE[i] = Math.sin(TWO_PI * i / SINE_TABLE_SIZE);
}
// Power-of-2 mask for fast modular indexing: idx & 0xFFF
var SINE_TABLE_MASK = SINE_TABLE_SIZE - 1;

// Per-voice output scaling; keeps multi-voice sum below clipping
var VOICE_OUTPUT_GAIN = 0.18;

// ============================================================
// DX7 Envelope Generator
// ============================================================
//
// ---------------------------------------------------------------
// DX7 4-Rate / 4-Level Envelope
//
// Unlike a standard ADSR envelope (which has 4 fixed stages:
// attack, decay, sustain, release), the DX7 envelope has 4
// independently configurable rate/level pairs that form an
// arbitrary 4-segment contour:
//
//   Key On:  start -> R1 -> L1 -> R2 -> L2 -> R3 -> L3 (hold)
//   Key Off: current -> R4 -> L4 (done)
//
// Each rate specifies a SPEED in dB/sec (not a time), so the
// same rate value produces different durations depending on
// the distance between current level and target level.
//
// Level mapping uses a power curve (x^2.5) to approximate the
// DX7's perceptually logarithmic amplitude scaling.
//
// Why this matters musically: on a carrier, the envelope shapes
// volume over time (like a VCA). On a modulator, the envelope
// shapes BRIGHTNESS over time (like a filter), because modulator
// amplitude controls the modulation index and thus sideband
// strength. This is the key to expressive FM sounds -- e.g.,
// an E.Piano's bright attack that mellows into a warm sustain
// is achieved entirely by modulator envelope shaping.
//
// See: Chowning (1973); Roads (1996) Ch. 5, Section 5.4
// ---------------------------------------------------------------

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

  // Convert DX7 level (0-99) to linear amplitude.
  // Power curve (x^2.5) approximates the DX7's perceptual scaling:
  // level 99 -> 1.0, level 70 -> ~0.36, level 50 -> ~0.11
  dx7LevelToLinear(level) {
    if (level === 0) return 0;
    return Math.pow(level / 99, 2.5);
  }

  // Convert DX7 rate (0-99) to linear increment per sample.
  // The DX7 envelope rate is exponential: each ~6 rate units doubles the speed.
  // Formula: rate_dB_per_sec = 0.2819 * 2^(rate * 0.16)
  // Normalized to 96 dB dynamic range (16-bit audio floor).
  // Rate 99 ~ 2ms full traverse; Rate 50 ~ 3 seconds; Rate 0 ~ minutes.
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

  // Stage transitions: after reaching a target level, advance to the next
  // stage. Stages 0->1->2 proceed automatically (attack -> decay1 -> sustain).
  // Stage 2 holds indefinitely until keyOff, then jumps to stage 3 (release).
  // The 0.0001 threshold (~-80 dB) prevents infinite tails.
  advanceStage() {
    if (this.released) {
      // In release stage, check if done
      if (this.stage === 3 && this.level <= 0.0001) {
        this.finished = true;
        this.level = 0;
      }
    } else {
      // Advance through attack/decay stages, hold at sustain (stage 2)
      if (this.stage < 2) {
        this.stage++;
        // Cache target and increment to avoid recomputing every sample
        this.cachedTarget = this.dx7LevelToLinear(this.levels[this.stage]);
        this.cachedIncrement = this.dx7RateToIncrement(this.rates[this.stage]);
      }
      // Stage 2 = sustain, hold here until keyOff
    }
  }

  isFinished() {
    return this.finished;
  }
}

// ============================================================
// FM Operator
// ============================================================
//
// ---------------------------------------------------------------
// FM Operator: The Atomic Unit of FM Synthesis
//
// Each operator is a complete signal generator consisting of:
//   1. A sine-wave oscillator (phase accumulator + table lookup)
//   2. A DX7 4R/4L envelope generator
//   3. An amplitude scaler (output level + velocity)
//
// An operator can serve as a CARRIER (output goes to audio bus)
// or a MODULATOR (output feeds into another operator's phase
// input). The algorithm determines each operator's role.
//
// The operator frequency is derived from the note frequency:
//   opFreq = noteFreq * ratio * detuneMultiplier
// Integer ratios (1:1, 2:1, 3:1) produce harmonic spectra.
// Non-integer ratios (1.41:1, 2.76:1) produce inharmonic /
// metallic / bell-like timbres -- this is how the DX7 creates
// its famous bell and electric piano sounds.
//
// See: Chowning (1973), Section III — ratio relationships
// ---------------------------------------------------------------

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
    this.detune = 7;       // 7 = center (0 cents offset)
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

  // DX7 output level to linear amplitude.
  // Approximately logarithmic: level 99 = 0 dB, each unit ~0.75 dB down.
  // Formula: amplitude = 2^((level - 99) / 8)
  // For a modulator, this amplitude IS the modulation index -- higher
  // modulator level = more sidebands = brighter timbre.
  levelToAmplitude(level) {
    if (level === 0) return 0;
    return Math.pow(2, (level - 99) / 8);
  }

  // Compute the operator's base frequency from a note frequency.
  // The frequency ratio determines the harmonic relationship:
  //   ratio=1 -> fundamental (unison with note)
  //   ratio=2 -> octave above (2nd harmonic)
  //   ratio=3 -> octave + fifth (3rd harmonic)
  //   ratio=0.5 -> sub-octave (special DX7 convention: coarse=0)
  // Fine ratio adds 0-99% on top (100 subdivisions between integers).
  // Non-integer ratios like 1.41 or 3.14 create inharmonic spectra
  // characteristic of bells, gongs, and metallic percussion.
  computeFrequency(noteFreq) {
    var ratio;
    if (this.ratioCoarse === 0) {
      ratio = 0.5;  // DX7 convention: coarse=0 means half-frequency
    } else {
      ratio = this.ratioCoarse;
    }
    ratio *= (1 + this.ratioFine * 0.01);

    // Detune: +-7 cents, value 7 = center (one cent = 1/1200 of an octave)
    var detuneCents = (this.detune - 7);
    var detuneMultiplier = Math.pow(2, detuneCents / 1200);

    this.frequency = noteFreq * ratio * detuneMultiplier;
    // Pre-compute phase increment to avoid division in the hot loop
    this.phaseInc = this.frequency / this.sampleRate;
  }

  keyOn(noteFreq, velocity) {
    this.computeFrequency(noteFreq);
    // Randomize initial phase to decorrelate simultaneous voices.
    // Without this, playing a chord would sum phase-locked sines,
    // producing unnaturally sharp transients.
    this.phase = Math.random();

    // Velocity sensitivity: linear crossfade between full (1.0) and
    // velocity-proportional amplitude. sens=0 = organ (no dynamics),
    // sens=7 = full piano-like dynamics.
    // On a MODULATOR, velocity sensitivity controls brightness dynamics:
    // harder strikes = brighter tone (more modulation index).
    // This is critical for realistic electric piano patches.
    var velNorm = velocity / 127;
    var sens = this.velocitySens / 7;
    this.velocityScale = 1 - sens + sens * velNorm;

    this.envelope.keyOn();
  }

  keyOff() {
    this.envelope.keyOff();
  }

  // ---------------------------------------------------------------
  // Core FM Sample Generation
  // This is the innermost hot loop of the entire FM engine.
  // Called once per sample per active operator (up to 6 ops *
  // 16 voices * 44100 Hz = ~4.2M calls/sec at full polyphony).
  //
  // The math implements phase modulation (PM), which is
  // mathematically equivalent to FM for sinusoidal modulators:
  //   output = sin(2*pi*fc*t + modInput)
  //
  // modInput arrives in radians — it is the sum of all modulator
  // operator outputs routed to this operator by the algorithm,
  // plus any feedback. This directly offsets the phase lookup,
  // generating sidebands at fc +/- n*fm whose amplitudes follow
  // Bessel functions Jn(I), where I = modulation index.
  //
  // See: Chowning (1973), Eq. 1; Puckette (2007), Section 5.3
  // ---------------------------------------------------------------

  // Render one sample. modInput = phase modulation in radians.
  process(modInput) {
    // Phase accumulator: add pre-computed increment, wrap to [0,1).
    // Bitwise OR with 0 is a fast floor() for positive values.
    this.phase += this.phaseInc;
    this.phase -= (this.phase | 0);

    // Convert phase + modulation to table index.
    // modInput (radians) is divided by 2*pi to convert to [0,1) phase units.
    var tablePhase = this.phase + modInput / TWO_PI;
    tablePhase -= (tablePhase | 0);       // Fast floor wrap
    if (tablePhase < 0) tablePhase += 1;  // Handle negative modulation
    // Linear interpolation between adjacent table entries
    var idx = tablePhase * SINE_TABLE_SIZE;
    var i0 = idx | 0;                     // Integer index (fast floor)
    var frac = idx - i0;                  // Fractional part for lerp
    var s0 = SINE_TABLE[i0 & SINE_TABLE_MASK];
    var out = s0 + frac * (SINE_TABLE[(i0 + 1) & SINE_TABLE_MASK] - s0);

    // Final output = sine * envelope * level * velocity
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
//
// ---------------------------------------------------------------
// Algorithm data is duplicated here from fm-engine.js because the
// AudioWorklet runs in a separate global scope with no access to
// main-thread variables. Each algorithm defines:
//   carriers: operators whose output goes to the audio bus
//   modulations: [from, to] pairs defining the modulation graph
//   feedbackOp: which operator receives its own delayed output
//
// See fm-engine.js for the full educational commentary on the 32
// DX7 algorithm topologies and their musical characteristics.
// ---------------------------------------------------------------

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
//
// ---------------------------------------------------------------
// FM Voice: A Complete 6-Operator Instrument Instance
//
// Each voice contains 6 operators, a cached algorithm topology,
// and a feedback delay buffer. The process() method is the core
// FM rendering loop: it traverses operators top-down (Op6 -> Op1),
// accumulates modulation, and sums carrier outputs.
//
// The opModSources array is a pre-compiled lookup table built at
// noteOn time: opModSources[i] lists all operator indices whose
// output modulates operator i. This avoids scanning the full
// modulations array on every sample -- a critical optimization
// since this code runs ~44100 times per second per active voice.
//
// feedbackValue implements a one-sample delay: the feedback
// operator's output from sample N is added to its modulation
// input at sample N+1. This z^-1 delay is essential -- without
// it, the feedback would be an infinite instantaneous loop.
// The DX7 hardware used the same one-sample delay approach.
// ---------------------------------------------------------------

class FMVoice {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.active = false;
    this.midiNote = -1;
    this.noteFreq = 0;
    this.algorithm = 1;
    this.feedbackLevel = 0;
    this.feedbackValue = 0;  // one-sample delay buffer (z^-1)
    this.instId = 0;
    this.operators = [];
    for (var i = 0; i < 6; i++) {
      this.operators.push(new FMOperator(sampleRate));
    }
    // Float64Array for operator outputs: double precision prevents
    // accumulation errors in deep modulation chains (e.g., 4 ops deep)
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

  // Pre-compile modulation routing into per-operator source lists.
  // Converts the algorithm's [from, to] pairs into a reverse lookup:
  // opModSources[target] = [source1, source2, ...]. This avoids
  // scanning the full modulations array on every sample of every
  // operator -- a significant optimization at 6 ops * 44100 Hz.
  compileModRoutes() {
    var algo = this.cachedAlgo;
    if (!algo) return;
    for (var i = 0; i < 6; i++) this.opModSources[i].length = 0;
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

  // Convert DX7 feedback level (0-7, 3 bits) to radians of self-modulation.
  // Feedback 0 = pure sine. Each step roughly doubles the modulation depth.
  // At feedback 3-4, the waveform approximates a sawtooth.
  // At feedback 7, the operator output approaches white noise.
  // The DX7 hardware used exactly this 3-bit exponential mapping.
  // Formula: scale = pi * 2^((fb - 7) / 2)
  feedbackToScale(fb) {
    // DX7 feedback 0-7 mapped to modulation scale
    // 0 = no feedback, 7 = maximum
    if (fb === 0) return 0;
    return Math.PI * Math.pow(2, (fb - 7) / 2);
  }

  // ---------------------------------------------------------------
  // Voice Process: The Heart of FM Rendering
  //
  // This method implements the complete FM algorithm for one sample:
  //   1. Process operators top-down (Op6 -> Op1) so modulators
  //      are computed before the carriers they feed into.
  //   2. For each operator, sum its modulation inputs (from the
  //      pre-compiled opModSources table) plus any feedback.
  //   3. Feed the summed modulation into the operator's process()
  //      method, which performs the phase-modulated sine lookup.
  //   4. Sum all carrier outputs and normalize by carrier count.
  //
  // The top-down traversal order is critical: in Algorithm 1,
  // Op6 modulates Op5 which modulates Op4 which modulates Op3
  // (a carrier). If we processed Op3 first, its modulation inputs
  // would be stale (zero). Processing 6->5->4->3 ensures each
  // modulator's output is fresh when its downstream target reads it.
  //
  // Feedback uses a one-sample delay (z^-1 in DSP notation):
  // the feedback operator's output from the PREVIOUS sample is
  // added to its modulation input for the CURRENT sample. This
  // is both physically motivated (sound propagation delay) and
  // mathematically necessary to avoid an algebraic loop.
  // ---------------------------------------------------------------

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

    // Local variable aliases avoid repeated property lookups in the hot loop
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

      // Process operator: sin(2*pi*f*t + modInput) * envelope * amplitude
      out[i] = ops[i].process(modInput);

      // Store for one-sample feedback delay
      if (i === fbOp) {
        fbValue = out[i];
      }
    }

    this.feedbackValue = fbValue;

    // Sum carrier outputs -- these are the operators that produce audible sound
    var sample = 0;
    var carriers = algo.carriers;
    for (var c = 0; c < carriers.length; c++) {
      sample += out[carriers[c]];
    }

    // Normalize by carrier count: Algorithm 32 (6 carriers) would be
    // 6x louder than Algorithm 7 (1 carrier) without this
    sample /= carriers.length;

    // ~8ms fade-in ramp eliminates click/pop from abrupt onset
    if (this.fadeInCounter < this.fadeInSamples) {
      sample *= this.fadeInCounter / this.fadeInSamples;
      this.fadeInCounter++;
    }

    // Per-voice soft clipper for high feedback values.
    // At feedback >= 6, the operator can self-oscillate into extreme
    // amplitudes. tanh() provides smooth saturation that preserves
    // the fundamental while taming the peaks.
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
//
// ---------------------------------------------------------------
// AudioWorklet Processor: Real-Time Audio Thread
//
// This class extends AudioWorkletProcessor, which runs on the
// browser's dedicated audio rendering thread. The process() method
// is called by the audio subsystem every 128 samples (~2.9ms at
// 44.1kHz). All voice management, note triggering, and parameter
// updates arrive via MessagePort from the main thread (fm-engine.js).
//
// Critical audio-thread constraints:
//   - No DOM access (separate global scope)
//   - No allocations in process() (triggers GC pauses -> glitches)
//   - No blocking operations (fetch, locks, long loops)
//   - Must return true to stay alive (false = processor death)
//
// Voice allocation: 64 pre-allocated voices (16 per instrument x 4
// instruments). Voice stealing prioritizes same-instrument voices
// to prevent one instrument from starving another.
//
// See: W3C AudioWorklet Specification, Section 4.2
// ---------------------------------------------------------------

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

  // ---------------------------------------------------------------
  // Voice Allocation and Stealing
  // When a new note arrives: first try to find an inactive voice.
  // If all 64 are busy, steal the oldest voice belonging to the
  // SAME instrument (so one instrument cannot silence another).
  // Last resort: steal voice 0. The DX7 hardware used a similar
  // oldest-note-priority stealing strategy with its 16-voice limit.
  // ---------------------------------------------------------------
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
      var isMatchingActiveVoice = v.active && v.midiNote === midiNote && v.instId === instId;
      if (isMatchingActiveVoice) {
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

  // ---------------------------------------------------------------
  // process(): Called by the audio subsystem every render quantum
  // (128 samples). This is the most performance-critical method in
  // the entire FM engine. The inner loop processes all active voices
  // per sample, then applies a global soft clipper.
  //
  // The Pade approximant tanh(x) ~ x*(27+x^2)/(27+9*x^2) is used
  // instead of Math.tanh() because it is ~3x faster and provides
  // smooth saturation without a hard knee. This prevents digital
  // clipping when many voices or high-feedback patches stack up.
  //
  // After the buffer is filled, finished voices (all 6 envelopes
  // done) are deactivated and the activeVoiceIndices array is
  // compacted in-place to avoid scanning inactive voices next quantum.
  // ---------------------------------------------------------------

  process(inputs, outputs, parameters) {
    var output = outputs[0];
    var channel = output[0];
    if (!channel) return true;

    var avi = this.activeVoiceIndices;
    var aviLen = avi.length;

    // Early-out: zero-fill and skip if no voices are sounding
    if (aviLen === 0) {
      for (var z = 0; z < channel.length; z++) {
        channel[z] = 0;
      }
      return true;
    }

    var voices = this.voices;
    var bufLen = channel.length;

    // Per-sample loop: sum all active voices, then soft-clip
    for (var s = 0; s < bufLen; s++) {
      var sample = 0;
      for (var v = 0; v < aviLen; v++) {
        sample += voices[avi[v]].process() * VOICE_OUTPUT_GAIN;
      }
      // Global soft clipper: Pade approximant of tanh
      // Keeps output in [-1, +1] with smooth saturation curve
      var ss = sample * sample;
      channel[s] = sample * (27 + ss) / (27 + 9 * ss);
    }

    // Post-buffer cleanup: deactivate finished voices and compact
    // the active index list. This runs once per 128-sample quantum,
    // not per sample, so the cost is negligible.
    var writeIdx = 0;
    for (var vi = 0; vi < aviLen; vi++) {
      var voice = voices[avi[vi]];
      if (voice.active) {
        // A voice is finished when ALL 6 operator envelopes have completed
        var isAllDone = true;
        var ops = voice.operators;
        for (var j = 0; j < 6; j++) {
          if (!ops[j].isFinished()) { isAllDone = false; break; }
        }
        if (isAllDone) {
          voice.active = false;
          this.activeCount--;
        } else {
          avi[writeIdx++] = avi[vi];
        }
      }
    }
    avi.length = writeIdx;

    // Must return true to keep the processor alive
    return true;
  }
}

registerProcessor('fm-worklet', FMWorkletProcessor);
