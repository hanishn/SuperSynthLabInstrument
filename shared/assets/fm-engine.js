// Super Synth Lab - FM Synthesis Engine Module
// 6-operator DX7-style FM synthesis integration
// v1.0.0 - Full 32-algorithm FM engine with AudioWorklet processing
//
// ================================================================
// EDUCATIONAL CONTEXT: Frequency Modulation (FM) Synthesis
// ================================================================
//
// FM synthesis was invented by John Chowning at Stanford University
// in 1967-1971, and published in his landmark 1973 paper. Stanford
// licensed the patent to Yamaha, who released the DX7 in 1983 --
// the best-selling synthesizer of all time (~200,000 units).
//
// How it works:
//   A "carrier" oscillator produces the audible tone. A "modulator"
//   oscillator varies the carrier's instantaneous frequency (really
//   phase) at audio rates. This generates sidebands -- new frequency
//   components that did not exist in either oscillator alone. By
//   stacking modulators in chains or trees, a handful of sine waves
//   can produce timbres rivaling a full orchestra.
//
// Key formula:
//   y(t) = A * sin(2*pi*fc*t + I * sin(2*pi*fm*t))
//   where fc = carrier frequency, fm = modulator frequency,
//   I = modulation index (controls brightness / sideband count).
//   Sidebands appear at fc +/- n*fm for integer n; their amplitudes
//   follow Bessel functions of the first kind, Jn(I).
//
// Signal flow (DX7 6-operator example, Algorithm 1):
//   [FB]Op6 -> Op5 -> Op4 -> Op3 (carrier) --+
//                              Op2 -> Op1 (carrier) --+--> Audio Out
//
// The DX7's 32 algorithms define fixed topologies of 6 operators.
// More carriers = more independent tones (organ-like).
// More modulator stacking = more complex harmonic spectra.
//
// Hardware lineage:
//   Yamaha DX7 (1983), DX7II (1987), DX7s, TX816 rack, SY77/99,
//   FS1R (formant FM), Korg Volca FM, Yamaha Reface DX (2015),
//   Elektron Digitone (2018). Also: Sega Genesis YM2612 sound chip.
//
// This file is the HOST code: parameter management, preset loading,
// voice allocation, and communication with the AudioWorklet thread.
// The actual sample-by-sample FM math runs in fm-worklet.js.
//
// References:
//   - Chowning, J.M. (1973) "The Synthesis of Complex Audio Spectra
//     by Means of Frequency Modulation", JAES 21(7), pp. 526-534
//   - Roads, C. (1996) The Computer Music Tutorial, MIT Press, Ch. 5
//   - Puckette, M. (2007) Theory and Technique of Electronic Music,
//     World Scientific, Ch. 5
//   - Bristow-Johnson, R. (1996) "Wavetable Synthesis 101"
//   - Tomisawa, N. (1981) US Patent 4,249,447 — Yamaha FM chip
// ================================================================
(function() {
  'use strict';

  var SL = window.SynthLab;

  // ============================================================
  // Constants
  // ============================================================

  var MAX_VOICES_PER_INSTRUMENT = 16;

  // ---------------------------------------------------------------
  // Default FM Patch
  // A new FM instrument initializes with Algorithm 1 and only Op1
  // active (level 99). This produces a single pure sine carrier --
  // the simplest possible FM sound. Users build complexity upward
  // by raising modulator levels and choosing richer algorithms.
  // The envelope defaults (R1=95, L1-L3=99, L4=0) give a fast
  // attack, full sustain, and moderate release -- a basic organ tone.
  // ---------------------------------------------------------------

  /** Default FM settings for a new instrument */
  var DEFAULT_FM_SETTINGS = {
    algorithm: 1,
    feedback: 0,
    operators: Array.from({length: 6}, function(_, i) {
      return {
        ratioCoarse: 1,
        ratioFine: 0,
        level: i === 0 ? 99 : 0,  // Only op1 active by default
        detune: 7,
        // Velocity sensitivity 0 = organ-like (no dynamics).
        // DX7 range is 0-7; higher values make velocity affect output more.
        velocitySens: 0,
        rateScaling: 0,
        // 4-rate/4-level envelope (NOT standard ADSR -- see DX7Envelope in fm-worklet.js)
        envelope: { R1: 95, R2: 50, R3: 50, R4: 50, L1: 99, L2: 99, L3: 99, L4: 0 }
      };
    })
  };

  // ============================================================
  // 32 DX7 Algorithms (data definitions)
  // Operator indices are 0-based: Op1=0, Op2=1, ..., Op6=5
  // modulations: array of [from, to] pairs
  // ============================================================
  //
  // ---------------------------------------------------------------
  // DX7 Algorithm Topology
  //
  // The DX7's 32 algorithms are fixed routing graphs that determine
  // which operators modulate which, which are carriers (audible
  // output), and which single operator receives feedback. Yamaha
  // chose these 32 topologies to cover a wide range of timbral
  // possibilities with 6 operators:
  //
  //   - Algorithms 1-4, 7-9: Heavy stacking (serial chains).
  //     Few carriers, deep modulation -> metallic, bell-like, complex.
  //   - Algorithms 5-6, 10-15: Paired modulator/carrier stacks.
  //     2-3 carriers -> electric piano, clav, plucked strings.
  //   - Algorithms 16-18: Branched topologies.
  //     One modulator feeds multiple carriers -> rich single voice.
  //   - Algorithms 19-25: Wide (many carriers).
  //     3-4 carriers -> brass, organ, layered tones.
  //   - Algorithms 26-31: Additive-leaning.
  //     4-5 carriers with light modulation -> pads, organs.
  //   - Algorithm 32: Pure additive (all 6 are carriers).
  //     No FM at all -- Hammond-style drawbar organ.
  //
  // The feedbackOp field identifies which operator feeds its own
  // output back into its phase input. Feedback turns a pure sine
  // into progressively richer waveforms: at level 0 = sine,
  // level 3-4 = near-sawtooth, level 7 = near-noise.
  //
  // See: Chowning (1973); Yamaha DX7 Owner's Manual, pp. 44-47
  // ---------------------------------------------------------------

  var ALGORITHMS = {
    1:  { carriers: [0, 2], modulations: [[5,4],[4,3],[3,2],[1,0]], feedbackOp: 5,
          description: '[FB]6->5->4->3; 2->1' },
    2:  { carriers: [0, 2], modulations: [[5,4],[4,3],[3,2],[1,0]], feedbackOp: 1,
          description: '6->5->4->3; [FB]2->1' },
    3:  { carriers: [0, 3], modulations: [[5,4],[4,3],[2,1],[1,0]], feedbackOp: 5,
          description: '[FB]6->5->4; 3->2->1' },
    4:  { carriers: [0, 2], modulations: [[5,4],[4,3],[3,2],[1,0]], feedbackOp: 3,
          description: '6->5->[FB]4->3; 2->1' },
    5:  { carriers: [0, 2, 4], modulations: [[5,4],[3,2],[1,0]], feedbackOp: 5,
          description: '[FB]6->5; 4->3; 2->1' },
    6:  { carriers: [0, 1, 3], modulations: [[5,4],[4,3],[2,1]], feedbackOp: 4,
          description: '6->[FB]5->4; 3->2; 1' },
    7:  { carriers: [0], modulations: [[5,4],[4,3],[4,2],[3,1],[2,1],[1,0]], feedbackOp: 5,
          description: '[FB]6->5->(4+3)->2->1' },
    8:  { carriers: [0], modulations: [[3,2],[5,4],[2,1],[4,1],[1,0]], feedbackOp: 3,
          description: '[FB]4->3; 6->5; (3+5)->2->1' },
    9:  { carriers: [0], modulations: [[3,2],[5,4],[2,1],[4,1],[1,0]], feedbackOp: 1,
          description: '4->3; 6->5; (3+5)->[FB]2->1' },
    10: { carriers: [0, 3], modulations: [[2,1],[1,0],[5,4],[4,3]], feedbackOp: 2,
          description: '[FB]3->2->1; 6->5->4' },
    11: { carriers: [0, 3], modulations: [[5,4],[4,3],[2,1],[1,0]], feedbackOp: 5,
          description: '[FB]6->5->4; 3->2->1' },
    12: { carriers: [0, 2], modulations: [[1,0],[5,4],[4,3],[3,2]], feedbackOp: 1,
          description: '[FB]2->1; 6->5->4->3' },
    13: { carriers: [0, 2], modulations: [[5,4],[4,3],[3,2],[1,0]], feedbackOp: 5,
          description: '[FB]6->5->4->3; 2->1' },
    14: { carriers: [0, 2], modulations: [[5,4],[4,3],[3,2],[1,0]], feedbackOp: 5,
          description: '[FB]6->5->4->3; 2->1' },
    15: { carriers: [0, 2], modulations: [[1,0],[5,4],[4,2]], feedbackOp: 1,
          description: '[FB]2->1; 6->5->3' },
    16: { carriers: [0], modulations: [[5,4],[4,0],[3,2],[2,0],[1,0]], feedbackOp: 5,
          description: '[FB]6->5; (5+3+2)->1; 4->3' },
    17: { carriers: [0], modulations: [[2,1],[5,4],[1,0],[4,0],[3,0]], feedbackOp: 1,
          description: '[FB]2; 6->5; 3->2; (5+4+2)->1' },
    18: { carriers: [0], modulations: [[2,1],[5,4],[4,3],[1,0],[3,0]], feedbackOp: 2,
          description: '[FB]3->2; 6->5->4; (2+4)->1' },
    19: { carriers: [0, 1, 2, 3], modulations: [[5,4],[4,3],[4,2],[4,1]], feedbackOp: 5,
          description: '[FB]6->5->(4+3+2); 1' },
    20: { carriers: [0, 3, 4], modulations: [[2,1],[1,0],[5,4],[5,3]], feedbackOp: 2,
          description: '[FB]3->2->1; 6->(5+4)' },
    21: { carriers: [0, 2, 3, 4], modulations: [[5,4],[5,3],[5,2],[1,0]], feedbackOp: 5,
          description: '[FB]6->(5+4+3); 2->1' },
    22: { carriers: [0, 1, 2, 3, 4], modulations: [[5,4],[5,3],[5,2],[5,1],[5,0]], feedbackOp: 5,
          description: '[FB]6->(5+4+3+2+1)' },
    23: { carriers: [0, 2, 3], modulations: [[5,4],[4,3],[1,0]], feedbackOp: 5,
          description: '[FB]6->5->4; 3; 2->1' },
    24: { carriers: [0, 1, 2, 3], modulations: [[5,4],[4,3],[4,2]], feedbackOp: 5,
          description: '[FB]6->5->(4+3); 2; 1' },
    25: { carriers: [0, 1, 2, 3], modulations: [[5,4],[4,3]], feedbackOp: 5,
          description: '[FB]6->5->4; 3; 2; 1' },
    26: { carriers: [0, 2, 3], modulations: [[5,4],[4,3],[5,2],[1,0]], feedbackOp: 5,
          description: '[FB]6->5->4; 6->3; 2->1' },
    27: { carriers: [0, 3, 4], modulations: [[5,4],[2,1],[1,0]], feedbackOp: 5,
          description: '[FB]6->5; 3->2->1; 4' },
    28: { carriers: [0, 2, 5], modulations: [[4,3],[3,2],[1,0]], feedbackOp: 4,
          description: '[FB]5->4->3; 2->1; 6' },
    29: { carriers: [0, 1, 2, 4], modulations: [[5,4],[3,2]], feedbackOp: 5,
          description: '[FB]6->5; 4->3; 2; 1' },
    30: { carriers: [0, 1, 2, 5], modulations: [[4,3],[3,2]], feedbackOp: 4,
          description: '[FB]5->4->3; 6; 2; 1' },
    31: { carriers: [0, 1, 2, 3, 4], modulations: [[5,4]], feedbackOp: 5,
          description: '[FB]6->5; 4; 3; 2; 1' },
    32: { carriers: [0, 1, 2, 3, 4, 5], modulations: [], feedbackOp: 5,
          description: '[FB]6; 5; 4; 3; 2; 1 (pure additive)' }
  };

  // ============================================================
  // State
  // ============================================================

  var audioContext = null;
  var fmWorkletNodes = [null, null, null, null];
  var isWorkletReady = false;
  var isWorkletInitializing = false;
  var isWorkletReadyPromise = null;

  // ScriptProcessor fallback state
  var scriptNodes = [null, null, null, null];
  var fallbackVoicesByInst = [[], [], [], []];
  var shouldUseFallback = false;

  // Per-instrument FM settings cache (instId -> settings object)
  var instrumentSettings = {};

  // Per-instrument filter nodes (instId -> BiquadFilterNode)
  var fmFilterNodes = {};

  // Track which instruments have been permanently connected
  var connectedInsts = [false, false, false, false];

  // ============================================================
  // MIDI / Frequency Helpers
  // ============================================================

  // ---------------------------------------------------------------
  // Equal Temperament Pitch Conversion
  // Standard 12-tone equal temperament: each semitone is a factor
  // of 2^(1/12) apart. MIDI note 69 = A4 = 440 Hz by convention.
  // Formula: f = refHz * 2^((midiNote - 69) / 12)
  // The SL.tuning path supports alternative tunings (just intonation,
  // Pythagorean, etc.) via the tuning module.
  // See: MIDI Tuning Standard (MMA, 1992)
  // ---------------------------------------------------------------

  function midiToFreq(midi) {
    var a4 = 440;
    // Try to read from UI if available
    var refEl = typeof document !== 'undefined' && document.getElementById('refHz');
    if (refEl) {
      a4 = parseFloat(refEl.value) || 440;
    }
    if (SL.tuning && SL.tuning.noteToFreq) {
      return SL.tuning.noteToFreq(midi, a4);
    }
    // 12-TET: f = 440 * 2^((n - 69) / 12)
    return a4 * Math.pow(2, (midi - 69) / 12);
  }

  // ============================================================
  // Worklet Initialization
  // ============================================================

  function init(ctx) {
    audioContext = ctx || (SL.audio && SL.audio.getCtx ? SL.audio.getCtx() : null);
    if (!audioContext) {
      console.error('[FM] No AudioContext available');
      return Promise.reject(new Error('No AudioContext'));
    }

    // Always use ScriptProcessor — synchronous, immediate, reliable.
    // AudioWorklet async loading causes notes to be silently dropped.

    // Fallback to ScriptProcessorNode
    console.warn('[FM] AudioWorklet not supported, using ScriptProcessor fallback');
    return initFallback();
  }

  var FM_WORKLET_COUNT = 4;

  function _makeFmWorkletReadyHandler(readyState, resolve) {
    return function(event) {
      var isReady = (event.data.type === 'ready');
      if (isReady) {
        readyState.count++;
        if (readyState.count === FM_WORKLET_COUNT) {
          isWorkletReady = true;
          isWorkletInitializing = false;
          resolve(true);
        }
      }
    };
  }

  function _makeFmWorkletErrorHandler(idx, hasHadError, resolve, reject) {
    return function(event) {
      if (!hasHadError.value) {
        hasHadError.value = true;
        console.error('[FM] AudioWorklet processor error (inst ' + idx + '):', event);
        isWorkletReady = false;
        isWorkletInitializing = false;
        console.warn('[FM] Falling back to ScriptProcessor');
        initFallback().then(resolve).catch(reject);
      }
    };
  }

  function initWorklet() {
    if (isWorkletReady) return Promise.resolve(true);
    if (isWorkletInitializing) return isWorkletReadyPromise;

    isWorkletInitializing = true;

    isWorkletReadyPromise = new Promise(function(resolve, reject) {
      var fmWorkletUrl = (SL.audio.getWorkletBlobUrl && SL.audio.getWorkletBlobUrl('fm-worklet.js')) || 'assets/fm-worklet.js';
      audioContext.audioWorklet.addModule(fmWorkletUrl).then(function() {
        var readyState = { count: 0 };
        var hasHadError = { value: false };

        for (var i = 0; i < FM_WORKLET_COUNT; i++) {
          (function(idx) {
            var node = new AudioWorkletNode(audioContext, 'fm-worklet', {
              numberOfInputs: 0,
              numberOfOutputs: 1,
              outputChannelCount: [1]
            });
            fmWorkletNodes[idx] = node;

            node.port.onmessage = _makeFmWorkletReadyHandler(readyState, resolve);
            node.onprocessorerror = _makeFmWorkletErrorHandler(idx, hasHadError, resolve, reject);
          })(i);
        }

      }).catch(function(error) {
        console.error('[FM] Failed to load FM worklet:', error);
        isWorkletInitializing = false;
        console.warn('[FM] Falling back to ScriptProcessor');
        initFallback().then(resolve).catch(reject);
      });
    });

    return isWorkletReadyPromise;
  }

  // ============================================================
  // ScriptProcessorNode Fallback
  // ============================================================
  //
  // ---------------------------------------------------------------
  // Main-Thread FM Fallback
  // AudioWorklet runs on a dedicated real-time audio thread, which
  // is ideal for DSP. However, some browsers or contexts lack
  // AudioWorklet support. This fallback implements the same 6-op
  // FM algorithm on the main thread via ScriptProcessorNode
  // (deprecated but universally supported). The trade-off: main-
  // thread audio competes with UI rendering, risking dropouts.
  // The FM math is identical to fm-worklet.js -- see that file
  // for detailed DSP commentary.
  // ---------------------------------------------------------------

  // Minimal voice for fallback (runs on main thread)
  function FallbackOperator(sr) {
    this.phase = 0;
    this.sampleRate = sr;
    this.frequency = 440;
    this.amplitude = 0;
    this.outputLevel = 0;
    this.ratioCoarse = 1;
    this.ratioFine = 0;
    this.detune = 7;
    this.velocitySens = 0;
    this.velocityScale = 1;
    // Envelope state
    this.envStage = 0;
    this.envLevel = 0;
    this.envReleased = false;
    this.envFinished = false;
    this.envRates = [95,50,50,50];
    this.envLevels = [99,99,99,0];
  }

  FallbackOperator.prototype.setParams = function(p) {
    if (p.ratioCoarse !== undefined) this.ratioCoarse = p.ratioCoarse;
    if (p.ratioFine !== undefined) this.ratioFine = p.ratioFine;
    if (p.level !== undefined) {
      this.outputLevel = p.level;
      // DX7 level-to-amplitude: approximately logarithmic.
      // Level 99 = 0 dB (full), each step down ~0.75 dB.
      // Formula: amplitude = 2^((level - 99) / 8)
      this.amplitude = p.level === 0 ? 0 : Math.pow(2, (p.level - 99) / 8);
    }
    if (p.detune !== undefined) this.detune = p.detune;
    if (p.velocitySens !== undefined) this.velocitySens = p.velocitySens;
    if (p.envelope) {
      var e = p.envelope;
      this.envRates = [e.R1, e.R2, e.R3, e.R4];
      this.envLevels = [e.L1, e.L2, e.L3, e.L4];
    }
  };

  FallbackOperator.prototype.keyOn = function(noteFreq, velocity) {
    // Operator frequency = noteFreq * ratio * detuneMultiplier.
    // Coarse=0 is special: ratio becomes 0.5 (sub-octave).
    // Fine adds 0-99% on top of coarse (100 subdivisions between ratios).
    var ratio = this.ratioCoarse === 0 ? 0.5 : this.ratioCoarse;
    ratio *= (1 + this.ratioFine * 0.01);
    // Detune: value 7 = center (0 cents), range 0-14 = -7 to +7 cents
    var detuneCents = this.detune - 7;
    this.frequency = noteFreq * ratio * Math.pow(2, detuneCents / 1200);
    // Random initial phase prevents phase-locked constructive interference
    // between simultaneous voices (reduces harsh transients on chords)
    this.phase = Math.random();
    // Velocity sensitivity: sens=0 -> organ-like, sens=7 -> full dynamic range.
    // Linear crossfade between fixed amplitude (1.0) and velocity-scaled amplitude.
    var velNorm = velocity / 127;
    var sens = this.velocitySens / 7;
    this.velocityScale = 1 - sens + sens * velNorm;
    this.envStage = 0;
    this.envReleased = false;
    this.envFinished = false;
  };

  FallbackOperator.prototype.keyOff = function() {
    if (!this.envFinished) {
      this.envReleased = true;
      this.envStage = 3;
    }
  };

  // ---------------------------------------------------------------
  // DX7 Envelope Processing (Fallback)
  // The DX7 envelope is NOT a standard ADSR. It has 4 rates (R1-R4)
  // and 4 target levels (L1-L4). On key-on, the envelope traverses
  // R1->L1, R2->L2, R3->L3 (sustain hold). On key-off, R4->L4.
  // Rates specify speed in dB/sec, not absolute time, so the same
  // rate value produces different durations depending on the level
  // distance traveled.
  // Formula: rate (dB/s) = 0.2819 * 2^(rate_value * 0.16)
  // See: FM-Engine-Architecture.md Section 4
  // ---------------------------------------------------------------
  FallbackOperator.prototype.processEnv = function() {
    if (this.envFinished) return 0;
    var tgtRaw = this.envLevels[this.envStage];
    // Level mapping: power curve (x^2.5) approximates the DX7's
    // roughly logarithmic level perception
    var target = tgtRaw === 0 ? 0 : Math.pow(tgtRaw / 99, 2.5);
    var rate = this.envRates[this.envStage];
    // Convert rate to per-sample increment over 96 dB dynamic range
    var dbPerSec = 0.2819 * Math.pow(2, rate * 0.16);
    var inc = dbPerSec / (this.sampleRate * 96);
    if (this.envLevel < target) {
      this.envLevel += inc;
      if (this.envLevel >= target) { this.envLevel = target; this.advanceEnv(); }
    } else if (this.envLevel > target) {
      this.envLevel -= inc;
      if (this.envLevel <= target) { this.envLevel = target; this.advanceEnv(); }
    } else {
      this.advanceEnv();
    }
    return this.envLevel;
  };

  FallbackOperator.prototype.advanceEnv = function() {
    if (this.envReleased) {
      if (this.envStage === 3 && this.envLevel <= 0.0001) {
        this.envFinished = true;
        this.envLevel = 0;
      }
    } else {
      if (this.envStage < 2) this.envStage++;
    }
  };

  FallbackOperator.prototype.process = function(modInput) {
    // Phase accumulator: increment by freq/sampleRate each sample, wrap to [0,1)
    this.phase += this.frequency / this.sampleRate;
    this.phase -= Math.floor(this.phase);
    // Core FM equation: sin(2*pi*fc*t + modInput)
    // modInput is the sum of all modulator outputs routed to this operator (in radians).
    // This is technically "phase modulation" (PM), not frequency modulation --
    // mathematically equivalent for sine waves but PM is easier to implement
    // because it does not require integrating the modulator signal.
    // See: Chowning (1973), Section II; Puckette (2007), Section 5.3
    var out = Math.sin(2 * Math.PI * this.phase + modInput);
    var env = this.processEnv();
    return out * env * this.amplitude * this.velocityScale;
  };

  FallbackOperator.prototype.isFinished = function() {
    return this.envFinished;
  };

  function FallbackVoice(sr) {
    this.sampleRate = sr;
    this.active = false;
    this.midiNote = -1;
    this.algorithm = 1;
    this.feedbackLevel = 0;
    this.feedbackValue = 0;
    this.instId = 0;
    this.operators = [];
    for (var i = 0; i < 6; i++) {
      this.operators.push(new FallbackOperator(sr));
    }
    this.opOutputs = new Float64Array(6);
    // Fade-in ramp to prevent click/pop at note onset
    this.fadeInSamples = 0;
    this.fadeInCounter = 0;
    // Per-voice timing stagger (humanization)
    this.startDelaySamples = 0;
  }

  // Convert DX7 feedback level (0-7) to a modulation scaling factor.
  // Feedback 0 = no self-modulation (pure sine).
  // Feedback 7 = maximum: pi * 2^0 = pi radians of self-modulation,
  // which produces near-noise. Each step halves/doubles the scale.
  // At feedback ~4, the operator approximates a sawtooth wave.
  FallbackVoice.prototype.feedbackToScale = function(fb) {
    if (fb === 0) return 0;
    return Math.PI * Math.pow(2, (fb - 7) / 2);
  };

  FallbackVoice.prototype.noteOn = function(midi, vel, freq, settings) {
    this.active = true;
    this.midiNote = midi;
    this.algorithm = settings.algorithm || 1;
    this.feedbackLevel = this.feedbackToScale(settings.feedback || 0);
    this.feedbackValue = 0;
    this.instId = settings.instId || 0;
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

    // Per-voice velocity randomization
    var humVelocity = settings.humVelocity || 0;
    var velRange = Math.round(humVelocity * 1.2);
    var randomizedVel = vel;
    if (velRange > 0) {
      randomizedVel = vel + Math.round((Math.random() * 2 - 1) * velRange);
      if (randomizedVel < 1) randomizedVel = 1;
      if (randomizedVel > 127) randomizedVel = 127;
    }

    var humAdsr = settings.humAdsr || 0;

    for (var i = 0; i < 6; i++) {
      var opSettings = settings.operators[i];
      if (humAdsr > 0 && opSettings.envelope) {
        var origEnv = opSettings.envelope;
        var jR1 = 1 + (Math.random() * 2 - 1) * humAdsr * 0.015;
        var jR2 = 1 + (Math.random() * 2 - 1) * humAdsr * 0.015;
        var jR4 = 1 + (Math.random() * 2 - 1) * humAdsr * 0.015;
        this.operators[i].setParams({
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
        });
      } else {
        this.operators[i].setParams(opSettings);
      }
      this.operators[i].keyOn(freq, randomizedVel);
    }
  };

  FallbackVoice.prototype.noteOff = function() {
    for (var i = 0; i < 6; i++) this.operators[i].keyOff();
  };

  // ---------------------------------------------------------------
  // Voice Processing: The FM Algorithm Loop
  // Operators are processed top-down (Op6 -> Op1) so that modulator
  // outputs are computed before the carriers that depend on them.
  // For each operator: sum modulation inputs from all connected
  // modulators, add feedback if applicable, then compute the sine
  // output. Carrier outputs are summed and normalized by carrier
  // count to prevent clipping in algorithms with many carriers.
  // ---------------------------------------------------------------
  FallbackVoice.prototype.process = function() {
    if (!this.active) return 0;
    // Per-voice timing stagger: output silence during delay period
    if (this.startDelaySamples > 0) {
      this.startDelaySamples--;
      return 0;
    }
    var algo = ALGORITHMS[this.algorithm];
    if (!algo) return 0;
    var out = this.opOutputs;
    // Top-down traversal: Op6(index 5) first, Op1(index 0) last
    for (var i = 5; i >= 0; i--) {
      var modInput = 0;
      // Gather modulation from all operators routed to this one
      var mods = algo.modulations;
      for (var m = 0; m < mods.length; m++) {
        if (mods[m][1] === i) modInput += out[mods[m][0]];
      }
      // Feedback: one-sample delay of this operator's own output
      if (i === algo.feedbackOp) modInput += this.feedbackValue * this.feedbackLevel;
      out[i] = this.operators[i].process(modInput);
      if (i === algo.feedbackOp) this.feedbackValue = out[i];
    }
    var sample = 0;
    var carriers = algo.carriers;
    for (var c = 0; c < carriers.length; c++) sample += out[carriers[c]];
    // Normalize: divide by carrier count so loudness stays consistent
    // across algorithms regardless of how many carriers are active
    sample /= carriers.length;

    // Apply fade-in ramp
    if (this.fadeInCounter < this.fadeInSamples) {
      sample *= this.fadeInCounter / this.fadeInSamples;
      this.fadeInCounter++;
    }

    var isAllDone = true;
    for (var j = 0; j < 6; j++) {
      if (!this.operators[j].isFinished()) { isAllDone = false; break; }
    }
    if (isAllDone) this.active = false;
    return sample;
  };

  function initFallback() {
    shouldUseFallback = true;
    var sr = audioContext.sampleRate;
    var bufSize = (SL.audio && SL.audio.getScriptProcessorBufferSize) ? SL.audio.getScriptProcessorBufferSize() : 1024;

    // Pre-allocate per-instrument voice pools (16 voices each)
    for (var i = 0; i < 4; i++) {
      fallbackVoicesByInst[i].length = 0;
      for (var v = 0; v < 16; v++) {
        fallbackVoicesByInst[i].push(new FallbackVoice(sr));
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
                // 0.18 scaling factor keeps multi-voice sum below clipping
                sample += voices[vi].process() * 0.18;
              }
            }
            // Soft clipping via Pade approximant of tanh:
            //   tanh(x) ~ x * (27 + x^2) / (27 + 9*x^2)
            // This is always-on (no hard knee). FM synthesis can produce
            // extreme amplitudes when feedback is high or many voices stack,
            // so soft clipping prevents digital distortion gracefully.
            var ss = sample * sample;
            output[s] = sample * (27 + ss) / (27 + 9 * ss);
          }
        };
        scriptNodes[instIdx] = node;
      })(idx);
    }

    return Promise.resolve(true);
  }

  // ============================================================
  // Connection Management
  // ============================================================
  //
  // ---------------------------------------------------------------
  // Audio Graph Wiring
  // Web Audio uses a node graph: source -> processing -> destination.
  // Each FM instrument gets its own processing node (either an
  // AudioWorkletNode or ScriptProcessorNode) connected through an
  // optional BiquadFilter to the instrument's master output gain.
  // Connections are permanent once established -- no per-note
  // connect/disconnect, which would cause clicks and race conditions.
  // ---------------------------------------------------------------

  /**
   * Get or create a BiquadFilterNode for FM output on this instrument.
   * Reads the instrument's filter settings from the UI/audio engine.
   */
  function getOrCreateFilterNode(instId) {
    if (!audioContext) return null;
    if (!fmFilterNodes[instId]) {
      var node = audioContext.createBiquadFilter();
      node.type = 'lowpass';
      node.frequency.value = 20000;
      node.Q.value = 0.707;
      fmFilterNodes[instId] = node;
    }
    return fmFilterNodes[instId];
  }

  /**
   * Update the FM filter node for an instrument from current filter settings.
   * Call this when filter UI changes or on noteOn.
   */
  function updateFilter(instId) {
    if (instId === undefined) instId = 0;
    var filterNode = fmFilterNodes[instId];
    if (filterNode) {
      var filterSettings = SL.audio && SL.audio.getFilterSettings ? SL.audio.getFilterSettings() : null;
      if (!filterSettings || !filterSettings.enabled) {
        // Filter disabled: set to wide open
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
    // If nodes not created yet (engine not initialized), skip
    var nodeExists = (shouldUseFallback && scriptNodes[instId]) || (!shouldUseFallback && fmWorkletNodes[instId]);
    if (nodeExists) {
      // Each instrument's node is permanently connected once; no disconnect/reconnect needed
      if (connectedInsts[instId]) {
        updateFilter(instId);
      } else {
        var instruments = SL.audio && SL.audio.getInstruments ? SL.audio.getInstruments() : null;
        var inst = instruments ? instruments[instId] : null;
        var destination;
        var isDestinationResolved = false;

        if (inst && inst.masterOutput) {
          destination = inst.masterOutput;
          isDestinationResolved = true;
        } else if (audioContext) {
          destination = audioContext.destination;
          isDestinationResolved = true;
        }

        if (isDestinationResolved) {
          var filterNode = getOrCreateFilterNode(instId);
          updateFilter(instId);

          if (shouldUseFallback && scriptNodes[instId]) {
            if (filterNode) {
              scriptNodes[instId].connect(filterNode);
              filterNode.connect(destination);
            } else {
              scriptNodes[instId].connect(destination);
            }
          } else if (fmWorkletNodes[instId]) {
            if (filterNode) {
              fmWorkletNodes[instId].connect(filterNode);
              filterNode.connect(destination);
            } else {
              fmWorkletNodes[instId].connect(destination);
            }
          }

          connectedInsts[instId] = true;
        }
      }
    }
  }

  // ============================================================
  // Settings Management
  // ============================================================

  function getOrCreateSettings(instId) {
    if (!instrumentSettings[instId]) {
      instrumentSettings[instId] = JSON.parse(JSON.stringify(DEFAULT_FM_SETTINGS));
    }
    return instrumentSettings[instId];
  }

  // ============================================================
  // Note On / Off
  // ============================================================

  function noteOn(midi, velocity, instId) {
    if (instId === undefined) instId = 0;
    velocity = velocity || 100;

    var settings = getOrCreateSettings(instId);
    var noteFreq = midiToFreq(midi);

    // Ensure connected to correct instrument output
    connectToOutput(instId);

    // Read humanization amounts for per-voice randomization
    var instruments = SL.audio.getInstruments();
    var rawHum = (instruments && instruments[instId]) ? (instruments[instId].settings.humanization || {}) : {};
    var humVelocity = (typeof rawHum === 'number') ? rawHum : (rawHum.velocity || 0);
    var humAdsr = (typeof rawHum === 'number') ? rawHum : (rawHum.adsr || 0);
    var humTiming = (typeof rawHum === 'number') ? 0 : (rawHum.timing || 0);

    // Build the message/settings for the voice
    var voiceSettings = {
      algorithm: settings.algorithm,
      feedback: settings.feedback,
      instId: instId,
      operators: settings.operators,
      humVelocity: humVelocity,
      humAdsr: humAdsr,
      humTiming: humTiming
    };

    if (shouldUseFallback) {
      // Find free voice or steal from this instrument's pool
      var voices = fallbackVoicesByInst[instId];
      var voice = null;
      for (var i = 0; i < voices.length; i++) {
        if (!voices[i].active) {
          voice = voices[i];
          break;
        }
      }
      if (!voice) voice = voices[0]; // steal oldest
      voice.noteOn(midi, velocity, noteFreq, voiceSettings);
    } else if (fmWorkletNodes[instId] && isWorkletReady) {
      fmWorkletNodes[instId].port.postMessage({
        type: 'noteOn',
        midiNote: midi,
        velocity: velocity,
        noteFreq: noteFreq,
        settings: voiceSettings
      });
    }
  }

  function noteOff(midi, instId) {
    if (instId === undefined) instId = 0;

    if (shouldUseFallback) {
      var voices = fallbackVoicesByInst[instId];
      for (var i = 0; i < voices.length; i++) {
        var v = voices[i];
        if (v.active && v.midiNote === midi) {
          v.noteOff();
        }
      }
    } else if (fmWorkletNodes[instId] && isWorkletReady) {
      fmWorkletNodes[instId].port.postMessage({
        type: 'noteOff',
        midiNote: midi,
        instId: instId
      });
    }
  }

  // ============================================================
  // Parameter Control
  // ============================================================
  //
  // ---------------------------------------------------------------
  // Real-Time Parameter Updates
  // Parameters are stored on the main thread (instrumentSettings)
  // and mirrored to the audio thread via MessagePort postMessage().
  // This dual-state design is necessary because AudioWorklet runs
  // in a separate scope. Parameters are sent immediately on change
  // so the audio thread can apply them to active voices mid-note.
  // ---------------------------------------------------------------

  function setAlgorithm(instId, algo) {
    var settings = getOrCreateSettings(instId);
    algo = Math.max(1, Math.min(32, algo));
    settings.algorithm = algo;

    if (fmWorkletNodes[instId] && isWorkletReady) {
      fmWorkletNodes[instId].port.postMessage({
        type: 'updateAlgorithm',
        instId: instId,
        algorithm: algo
      });
    }
  }

  function setFeedback(instId, level) {
    var settings = getOrCreateSettings(instId);
    level = Math.max(0, Math.min(7, level));
    settings.feedback = level;

    if (fmWorkletNodes[instId] && isWorkletReady) {
      fmWorkletNodes[instId].port.postMessage({
        type: 'updateFeedback',
        instId: instId,
        feedback: level
      });
    }
  }

  function setOperator(instId, opIndex, params) {
    if (opIndex < 0 || opIndex > 5) return;
    var settings = getOrCreateSettings(instId);
    var op = settings.operators[opIndex];

    // Merge params into stored settings
    if (params.ratioCoarse !== undefined) op.ratioCoarse = params.ratioCoarse;
    if (params.ratioFine !== undefined) op.ratioFine = params.ratioFine;
    if (params.level !== undefined) op.level = params.level;
    if (params.detune !== undefined) op.detune = params.detune;
    if (params.velocitySens !== undefined) op.velocitySens = params.velocitySens;
    if (params.rateScaling !== undefined) op.rateScaling = params.rateScaling;
    if (params.envelope) {
      var e = params.envelope;
      if (e.R1 !== undefined) op.envelope.R1 = e.R1;
      if (e.R2 !== undefined) op.envelope.R2 = e.R2;
      if (e.R3 !== undefined) op.envelope.R3 = e.R3;
      if (e.R4 !== undefined) op.envelope.R4 = e.R4;
      if (e.L1 !== undefined) op.envelope.L1 = e.L1;
      if (e.L2 !== undefined) op.envelope.L2 = e.L2;
      if (e.L3 !== undefined) op.envelope.L3 = e.L3;
      if (e.L4 !== undefined) op.envelope.L4 = e.L4;
    }

    // Update active voices via worklet
    if (fmWorkletNodes[instId] && isWorkletReady) {
      fmWorkletNodes[instId].port.postMessage({
        type: 'updateOperator',
        instId: instId,
        opIndex: opIndex,
        params: params
      });
    }
  }

  function getSettings(instId) {
    return JSON.parse(JSON.stringify(getOrCreateSettings(instId)));
  }

  function setSettings(instId, settings) {
    instrumentSettings[instId] = JSON.parse(JSON.stringify(settings));
  }

  function getAlgorithmInfo(algo) {
    var alg = ALGORITHMS[algo];
    if (!alg) return null;
    return {
      carriers: alg.carriers.map(function(c) { return c + 1; }), // Convert to 1-based for display
      carrierCount: alg.carriers.length,
      modulationRoutes: alg.modulations.map(function(m) {
        return { from: m[0] + 1, to: m[1] + 1 };
      }),
      feedbackOp: alg.feedbackOp + 1,
      description: alg.description
    };
  }

  // ============================================================
  // Utility
  // ============================================================

  function allNotesOff(instId) {
    if (shouldUseFallback) {
      if (instId !== undefined) {
        var voices = fallbackVoicesByInst[instId];
        for (var i = 0; i < voices.length; i++) {
          if (voices[i].active) voices[i].noteOff();
        }
      } else {
        for (var idx = 0; idx < 4; idx++) {
          var pool = fallbackVoicesByInst[idx];
          for (var j = 0; j < pool.length; j++) {
            if (pool[j].active) pool[j].noteOff();
          }
        }
      }
    } else if (isWorkletReady) {
      if (instId !== undefined) {
        if (fmWorkletNodes[instId]) {
          fmWorkletNodes[instId].port.postMessage({
            type: 'allNotesOff',
            instId: instId
          });
        }
      } else {
        for (var n = 0; n < 4; n++) {
          if (fmWorkletNodes[n]) {
            fmWorkletNodes[n].port.postMessage({
              type: 'allNotesOff',
              instId: n
            });
          }
        }
      }
    }
  }

  function isReady() {
    return isWorkletReady || shouldUseFallback;
  }

  function getDefaultSettings() {
    return JSON.parse(JSON.stringify(DEFAULT_FM_SETTINGS));
  }

  // ============================================================
  // Export to SynthLab Namespace
  // ============================================================

  SL.fm = {
    // Initialization
    init: init,
    isReady: isReady,

    // Note control
    noteOn: noteOn,
    noteOff: noteOff,
    allNotesOff: allNotesOff,

    // Parameter control
    setAlgorithm: setAlgorithm,
    setFeedback: setFeedback,
    setOperator: setOperator,

    // Settings management
    getSettings: getSettings,
    setSettings: setSettings,
    getDefaultSettings: getDefaultSettings,

    // Algorithm info
    getAlgorithmInfo: getAlgorithmInfo,
    ALGORITHMS: ALGORITHMS,

    // Connection & filter
    connectToOutput: connectToOutput,
    updateFilter: updateFilter,

    // Constants
    DEFAULT_FM_SETTINGS: DEFAULT_FM_SETTINGS,
    MAX_VOICES_PER_INSTRUMENT: MAX_VOICES_PER_INSTRUMENT
  };

})();
