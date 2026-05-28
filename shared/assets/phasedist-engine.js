// Super Synth Lab - Phase Distortion Synthesis Engine Module
// Casio CZ-style synthesis: distort the phase of a sine wave to create timbres
// v1.0.0 - ScriptProcessor fallback, 16-voice, ADSR on amplitude + PD amount
//
// -----------------------------------------------------------------------
// PHASE DISTORTION SYNTHESIS — Educational Reference
// -----------------------------------------------------------------------
// Phase Distortion (PD) was developed by Masahiko Ishibashi at Casio in
// 1984 as a patent-free alternative to Yamaha's FM synthesis (which Yamaha
// had licensed exclusively from John Chowning / Stanford). Instead of
// modulating one oscillator's frequency with another, PD warps the *phase*
// of a cosine oscillator through a nonlinear transfer function:
//
//   y(t) = cos( d( phase(t) ) )
//
// where d() is the distortion function that reshapes how the cosine is
// "read." A linear d() produces a pure cosine; nonlinear d() functions
// create complex spectra from this single oscillator.
//
// Different d() shapes produce different timbres:
//   Saw:      accelerating phase (fast-then-slow cosine readout)
//   Pulse:    phase holds at pi, creating a flat region
//   Square:   two half-cycles per period with phase jumps
//   Resonant: multiple phase cycles per period (simulates resonant filter)
//
// The Casio CZ-101 (1984) was the first commercial PD synthesizer. Its
// 8-stage envelope (vs the DX7's 4-rate/4-level) gave precise control
// over the timbral evolution. PD amount modulated by an envelope creates
// filter-sweep-like effects without any actual filter.
//
// References:
//   Ishibashi, M. (Casio) (1984) — Phase Distortion synthesis patent
//   Casio CZ-101/CZ-1000/CZ-5000 (1984-1985) — commercial PD synths
//   Horner, A. (1995) "Wavetable Matching of Phase Distortion Sounds",
//       Computer Music Journal 19(1), MIT Press
//   Roads, C. (1996) The Computer Music Tutorial, MIT Press, Ch. 6
// -----------------------------------------------------------------------
(function() {
  'use strict';

  var SL = window.SynthLab;

  // ============================================================
  // Constants
  // ============================================================

  var MAX_VOICES_PER_INSTRUMENT = 16;
  var TWO_PI = 2 * Math.PI;

  // Phase distortion function types
  // Each type defines a different phase transfer function d(), producing
  // a distinct spectral character from the same underlying cosine oscillator.
  // The CZ-series offered similar waveform categories, though their internal
  // implementation used piecewise-linear phase functions stored in ROM.
  var PD_TYPES = {
    SAW: 'saw',
    SQUARE: 'square',
    PULSE: 'pulse',
    RESONANT: 'resonant',
    DOUBLESINE: 'doublesine'
  };

  // Window shape types (affect the phase transfer function)
  // The window shapes the distortion curve's amplitude envelope within each
  // cycle. This is analogous to how the CZ-series used different "line
  // segments" to construct their phase transfer functions. A cosine window
  // gives the smoothest spectral rolloff; exponential gives sharper transients.
  var WINDOW_TYPES = {
    COSINE: 'cosine',
    TRIANGLE: 'triangle',
    EXPONENTIAL: 'exponential'
  };

  // Lookup tables for validation
  var VALID_PD_TYPES = { 'saw': 1, 'square': 1, 'pulse': 1, 'resonant': 1, 'doublesine': 1 };
  var VALID_WINDOW_SHAPES = { 'cosine': 1, 'triangle': 1, 'exponential': 1 };

  // ============================================================
  // Default Settings
  // ============================================================

  var DEFAULT_PHASEDIST_SETTINGS = {
    pdType: 'saw',
    pdAmount: 50,
    windowShape: 'cosine',
    resonantFreqRatio: 4.0,
    pdEnvAmount: 80,
    pdEnvAttack: 10,
    pdEnvDecay: 200,
    pdEnvSustain: 30,
    pdEnvRelease: 150
  };

  // ============================================================
  // State
  // ============================================================

  var audioContext = null;
  var isEngineReady = false;

  var scriptNodes = [null, null, null, null];
  var fallbackVoicesByInst = [[], [], [], []];
  var instrumentSettings = {};
  var pdFilterNodes = {};
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
  // Phase Distortion Functions
  // ============================================================
  // These functions implement the core of PD synthesis: nonlinear phase
  // transfer functions d(phase). The input phase advances linearly from
  // 0 to 1 over one period. The output (distorted phase) is fed to
  // sin(2*pi*distortedPhase) to produce the final waveform.
  //
  // The "amount" parameter (0..1) controls distortion intensity:
  //   0 = linear phase = pure sine output
  //   1 = maximum distortion = most harmonically complex output
  // Sweeping amount with an envelope recreates the CZ-series' signature
  // "filter sweep" effect — achieved without any actual filter.

  /**
   * Apply window shaping to the PD amount based on phase position.
   * This creates the phase transfer function shape.
   * @param {number} phase - 0..1 input phase
   * @param {string} windowType - 'cosine', 'triangle', 'exponential'
   * @returns {number} shaped window value 0..1
   */
  function applyWindow(phase, windowType) {
    if (windowType === 'triangle') {
      if (phase < 0.5) {
        return phase * 2.0;
      } else {
        return 2.0 - phase * 2.0;
      }
    } else if (windowType === 'exponential') {
      // Exponential rise and fall
      if (phase < 0.5) {
        return 1.0 - Math.exp(-phase * 8);
      } else {
        return 1.0 - Math.exp(-(1.0 - phase) * 8);
      }
    } else {
      // Cosine (default) - smooth bell shape
      // Hann window: 0.5*(1 - cos(2*pi*t)). Produces the smoothest
      // spectral envelope for the resonant PD type, minimizing sidelobes.
      return 0.5 * (1.0 - Math.cos(TWO_PI * phase));
    }
  }

  /**
   * Sawtooth PD: accelerate phase in first half, decelerate in second.
   * At full distortion, the sine wave traverses its cycle asymmetrically
   * producing a saw-like spectrum.
   * @param {number} phase - 0..1 input phase
   * @param {number} amount - 0..1 distortion amount
   * @param {string} windowType - window shape
   * @returns {number} distorted phase 0..1
   */
  function pdSaw(phase, amount, windowType) {
    var window = applyWindow(phase, windowType);
    // Saw PD: the cosine is read faster in the first half-period and slower
    // in the second. This asymmetric readout produces a spectrum dominated by
    // all harmonics (both even and odd), approaching a sawtooth wave at
    // maximum distortion. The CZ-101 manual calls this waveform "sawtooth."
    if (phase < 0.5) {
      var speedup = 1.0 + amount * 3.0;
      var distPhase = phase * speedup;
      if (distPhase > 0.5) {
        distPhase = 0.5;
      }
      return distPhase;
    } else {
      // Decelerate second half
      var remaining = 1.0 - phase;
      var slowdown = 1.0 + amount * 3.0;
      var compressedRemaining = remaining * slowdown;
      if (compressedRemaining > 0.5) {
        compressedRemaining = 0.5;
      }
      return 1.0 - compressedRemaining;
    }
  }

  /**
   * Square PD: jump phase to pi at midpoint.
   * Creates a square-like waveform with odd harmonics.
   * @param {number} phase - 0..1 input phase
   * @param {number} amount - 0..1 distortion amount
   * @param {string} windowType - window shape
   * @returns {number} distorted phase 0..1
   */
  function pdSquare(phase, amount, windowType) {
    // Square PD: each half-period traverses multiple half-cycles of the cosine.
    // This creates a waveform with a strong odd-harmonic series (like a square
    // wave). The phase jumps at the midpoint create the flat tops and bottoms
    // characteristic of a square wave. (Horner, 1995)
    var halfCycles = 1.0 + amount; // 1..2 half cycles in each half period
    if (phase < 0.5) {
      return (phase * 2.0 * halfCycles) % 1.0;
    } else {
      return ((phase - 0.5) * 2.0 * halfCycles + 0.5) % 1.0;
    }
  }

  /**
   * Pulse PD: narrow the active phase window for pulse-like waveforms.
   * @param {number} phase - 0..1 input phase
   * @param {number} amount - 0..1 distortion amount
   * @param {string} windowType - window shape
   * @returns {number} distorted phase 0..1
   */
  function pdPulse(phase, amount, windowType) {
    // Pulse PD: the entire cosine cycle is compressed into a narrow window
    // of the period; the rest of the period outputs zero. Higher amount =
    // narrower pulse = more harmonics (approaching an impulse train).
    // This is analogous to pulse-width modulation but achieved through
    // phase manipulation rather than amplitude switching.
    var pulseWidth = 1.0 - amount * 0.9; // 1.0 -> 0.1
    var safePulseWidth = pulseWidth || 0.001;
    if (phase < pulseWidth) {
      return phase / safePulseWidth;
    } else {
      return 0; // flat zero outside pulse window
    }
  }

  /**
   * Resonant PD: add resonant peak by phase modulation near a target frequency.
   * This is the CZ resonance effect - a formant-like resonant peak.
   * @param {number} phase - 0..1 input phase
   * @param {number} amount - 0..1 distortion amount
   * @param {string} windowType - window shape
   * @param {number} freqRatio - resonant frequency ratio (2..16)
   * @returns {number} distorted phase 0..1
   */
  function pdResonant(phase, amount, windowType, freqRatio) {
    // Resonant PD: the most distinctive CZ waveform. Multiple cosine cycles
    // are packed into each fundamental period, windowed by the applyWindow
    // function. This creates a formant-like spectral peak at freqRatio times
    // the fundamental — simulating a resonant bandpass filter sweep without
    // any actual filter. Sweeping the PD amount via envelope gives the CZ's
    // signature "resonant filter" sound. (Roads, 1996, Ch. 6)
    // Window shapes the resonant partial's amplitude
    var window = applyWindow(phase, windowType);
    var resonantPhase = (phase * freqRatio) % 1.0;
    // Mix between fundamental phase and resonant phase based on amount and window
    var mix = amount * window;
    return phase * (1.0 - mix) + resonantPhase * mix;
  }

  /**
   * Double Sine PD: two sine cycles within one period.
   * Creates an octave-rich sound.
   * @param {number} phase - 0..1 input phase
   * @param {number} amount - 0..1 distortion amount
   * @param {string} windowType - window shape
   * @returns {number} distorted phase 0..1
   */
  function pdDoubleSine(phase, amount, windowType) {
    // Double sine: interpolates between 1 and 2 cosine cycles per period.
    // At full amount, this produces a strong octave (2nd harmonic) component.
    // This is the simplest PD waveform — essentially phase-based octave mixing.
    var cycles = 1.0 + amount; // 1..2
    return (phase * cycles) % 1.0;
  }

  /**
   * Apply phase distortion based on type.
   * @param {number} phase - 0..1 input phase
   * @param {string} pdType - distortion type
   * @param {number} amount - 0..1
   * @param {string} windowType - window shape
   * @param {number} freqRatio - for resonant type
   * @returns {number} output sample
   */
  function applyPhaseDistortion(phase, pdType, amount, windowType, freqRatio) {
    var distortedPhase;

    if (pdType === 'saw') {
      distortedPhase = pdSaw(phase, amount, windowType);
    } else if (pdType === 'square') {
      distortedPhase = pdSquare(phase, amount, windowType);
    } else if (pdType === 'pulse') {
      distortedPhase = pdPulse(phase, amount, windowType);
    } else if (pdType === 'resonant') {
      distortedPhase = pdResonant(phase, amount, windowType, freqRatio);
    } else if (pdType === 'doublesine') {
      distortedPhase = pdDoubleSine(phase, amount, windowType);
    } else {
      distortedPhase = phase;
    }

    // Output is always sin(2*pi*distortedPhase)
    // This is the fundamental PD equation: y(t) = sin(2*pi*d(phase)).
    // The cosine/sine oscillator itself never changes — only the phase
    // trajectory through it is distorted. This is why PD synthesis needs
    // only one oscillator per voice (vs FM's multiple operators).
    return Math.sin(TWO_PI * distortedPhase);
  }

  // ============================================================
  // Phase Distortion Voice
  // ============================================================
  // Each voice has two independent ADSR envelopes: one for amplitude
  // and one for PD amount (timbre). This dual-envelope architecture is
  // faithful to the CZ-series, which had separate 8-stage envelopes
  // for amplitude (DCA) and timbre (DCW — "Digitally Controlled Wave").
  // The DCW envelope is the key to PD's expressiveness: sweeping PD
  // amount over time creates the filter-like timbral evolution that made
  // the CZ-101 a viable alternative to the DX7 at 1/3 the price.

  function PhasedistVoice(sr) {
    this.sampleRate = sr;
    this.active = false;
    this.midiNote = -1;
    this.instId = 0;
    this.baseFreq = 440;
    this.velocity = 1.0;

    // Oscillator phase
    this.phase = 0;
    this.phaseInc = 0;

    // PD parameters
    this.pdType = 'saw';
    this.pdAmount = 0.5;
    this.windowShape = 'cosine';
    this.resonantFreqRatio = 4.0;

    // Amplitude ADSR
    this.envStage = 0;
    this.envLevel = 0;
    this.envReleased = false;
    this.envFinished = false;
    this.attackRate = 0;
    this.decayRate = 0;
    this.sustainLevel = 0.7;
    this.releaseRate = 0;

    // PD amount ADSR (timbre envelope - the CZ trademark)
    // In the CZ-series this was called the DCW (Digitally Controlled Wave)
    // envelope. It directly modulates the intensity of phase distortion,
    // controlling how harmonically rich the sound is at each moment.
    // High pdEnvAmount + fast decay = bright attack that mellows quickly,
    // mimicking a plucked string or struck bell without any filter.
    this.pdEnvStage = 0;
    this.pdEnvLevel = 0;
    this.pdEnvReleased = false;
    this.pdEnvAmount = 0.8;
    this.pdAttackRate = 0;
    this.pdDecayRate = 0;
    this.pdSustainLevel = 0.3;
    this.pdReleaseRate = 0;

    // Fade-in
    this.fadeInSamples = 0;
    this.fadeInCounter = 0;

    // Humanization
    this.startDelaySamples = 0;
  }

  PhasedistVoice.prototype.noteOn = function(midi, vel, freq, settings) {
    this.active = true;
    this.midiNote = midi;
    this.baseFreq = freq;
    this.instId = settings.instId || 0;
    this.envStage = 0;
    this.envLevel = 0;
    this.envReleased = false;
    this.envFinished = false;
    this.phase = 0;

    // PD parameters
    this.pdType = settings.pdType || 'saw';
    this.pdAmount = Math.max(0, Math.min(1, (settings.pdAmount || 50) / 100));
    this.windowShape = settings.windowShape || 'cosine';
    this.resonantFreqRatio = settings.resonantFreqRatio || 4.0;

    this.phaseInc = freq / this.sampleRate;

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

    // Timing stagger
    var humTiming = settings.humTiming || 0;
    if (humTiming > 0) {
      var maxDelay = Math.round(humTiming * 0.15 * this.sampleRate / 1000);
      this.startDelaySamples = Math.round(Math.random() * maxDelay);
    } else {
      this.startDelaySamples = 0;
    }

    // Amplitude ADSR from instrument settings
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

    // PD amount ADSR (timbre envelope)
    this.pdEnvStage = 0;
    this.pdEnvLevel = 0;
    this.pdEnvReleased = false;
    this.pdEnvAmount = Math.max(0, Math.min(1, (settings.pdEnvAmount || 80) / 100));

    var pdATime = SL.audio && SL.audio.sliderToTime
      ? SL.audio.sliderToTime(settings.pdEnvAttack || 10, 500, 500) / 1000
      : Math.max(0.001, (settings.pdEnvAttack || 10) / 1000);
    var pdDTime = SL.audio && SL.audio.sliderToTime
      ? SL.audio.sliderToTime(settings.pdEnvDecay || 200, 500, 500) / 1000
      : Math.max(0.001, (settings.pdEnvDecay || 200) / 1000);
    var pdSLevel = Math.max(0, Math.min(1, (settings.pdEnvSustain || 30) / 100));
    var pdRTime = SL.audio && SL.audio.sliderToTime
      ? SL.audio.sliderToTime(settings.pdEnvRelease || 150, 1000, 1000) / 1000
      : Math.max(0.001, (settings.pdEnvRelease || 150) / 1000);

    this.pdAttackRate = 1.0 / (pdATime * this.sampleRate);
    this.pdDecayRate = 1.0 / (pdDTime * this.sampleRate);
    this.pdSustainLevel = pdSLevel;
    this.pdReleaseRate = 1.0 / (pdRTime * this.sampleRate);
  };

  PhasedistVoice.prototype.noteOff = function() {
    if (!this.envFinished) {
      this.envReleased = true;
      this.envStage = 3;
      this.pdEnvReleased = true;
      this.pdEnvStage = 3;
    }
  };

  PhasedistVoice.prototype.processEnvelope = function() {
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

  PhasedistVoice.prototype.processPdEnvelope = function() {
    if (this.pdEnvStage === 0) {
      this.pdEnvLevel += this.pdAttackRate;
      if (this.pdEnvLevel >= 1.0) {
        this.pdEnvLevel = 1.0;
        this.pdEnvStage = 1;
      }
    } else if (this.pdEnvStage === 1) {
      this.pdEnvLevel -= this.pdDecayRate * (1.0 - this.pdSustainLevel);
      if (this.pdEnvLevel <= this.pdSustainLevel) {
        this.pdEnvLevel = this.pdSustainLevel;
        this.pdEnvStage = 2;
      }
    } else if (this.pdEnvStage === 2) {
      // Sustain
    } else if (this.pdEnvStage === 3) {
      this.pdEnvLevel -= this.pdReleaseRate * this.pdEnvLevel;
      if (this.pdEnvLevel <= 0.0001) {
        this.pdEnvLevel = 0;
      }
    }

    return this.pdEnvLevel;
  };

  PhasedistVoice.prototype.process = function() {
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

    // PD envelope modulates the distortion amount
    // effectivePdAmount blends between the static pdAmount and the envelope-
    // modulated amount. When pdEnvAmount=1, the envelope fully controls
    // distortion intensity (0 at envelope minimum, pdAmount at envelope peak).
    // This is the CZ's DCW envelope in action: time-varying timbre.
    var pdEnv = this.processPdEnvelope();
    var effectivePdAmount = this.pdAmount * (1.0 - this.pdEnvAmount + this.pdEnvAmount * pdEnv);

    // Generate phase-distorted sample
    var sample = applyPhaseDistortion(
      this.phase,
      this.pdType,
      effectivePdAmount,
      this.windowShape,
      this.resonantFreqRatio
    );

    // Advance phase
    this.phase += this.phaseInc;
    if (this.phase >= 1.0) {
      this.phase -= Math.floor(this.phase);
    }

    sample *= env * this.velocity;

    // Fade-in ramp
    if (this.fadeInCounter < this.fadeInSamples) {
      sample *= this.fadeInCounter / this.fadeInSamples;
      this.fadeInCounter++;
    }

    return sample;
  };

  PhasedistVoice.prototype.isFinished = function() {
    return this.envFinished;
  };

  // ============================================================
  // Engine Initialization
  // ============================================================

  function init(ctx) {
    audioContext = ctx || (SL.audio && SL.audio.getCtx ? SL.audio.getCtx() : null);
    if (!audioContext) {
      console.error('[PHASEDIST] No AudioContext available');
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
        fallbackVoicesByInst[i].push(new PhasedistVoice(sr));
      }
    }

    for (var idx = 0; idx < 4; idx++) {
      (function(instIdx) {
        var node = audioContext.createScriptProcessor(bufSize, 0, 1);
        var voices = fallbackVoicesByInst[instIdx];
        node.onaudioprocess = function(event) {
          var output = event.outputBuffer.getChannelData(0);

          // Update PD parameters from settings for active voices
          var settings = getOrCreateSettings(instIdx);
          for (var vi = 0; vi < voices.length; vi++) {
            if (voices[vi].active) {
              voices[vi].pdType = settings.pdType || 'saw';
              voices[vi].pdAmount = Math.max(0, Math.min(1, (settings.pdAmount || 50) / 100));
              voices[vi].windowShape = settings.windowShape || 'cosine';
              voices[vi].resonantFreqRatio = settings.resonantFreqRatio || 4.0;
            }
          }

          for (var s = 0; s < output.length; s++) {
            var sample = 0;
            for (var vi2 = 0; vi2 < voices.length; vi2++) {
              if (voices[vi2].active) {
                sample += voices[vi2].process() * 0.15;
              }
            }
            // Smooth Pade approximant of tanh soft clip
            // [3/2] rational approximation of tanh: musical-sounding
            // saturation that prevents harsh digital clipping when
            // multiple voices sum beyond unity.
            var ss = sample * sample;
            output[s] = sample * (27 + ss) / (27 + 9 * ss);
          }
        };
        scriptNodes[instIdx] = node;
      })(idx);
    }

    isEngineReady = true;
    return Promise.resolve(true);
  }

  // ============================================================
  // Connection Management
  // ============================================================

  function getOrCreateFilterNode(instId) {
    if (!audioContext) {
      return null;
    }
    if (!pdFilterNodes[instId]) {
      var node = audioContext.createBiquadFilter();
      node.type = 'lowpass';
      node.frequency.value = 20000;
      node.Q.value = 0.707;
      pdFilterNodes[instId] = node;
    }
    return pdFilterNodes[instId];
  }

  function updateFilter(instId) {
    if (instId === undefined) {
      instId = 0;
    }
    var filterNode = pdFilterNodes[instId];
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
    } // end if (filterNode)
  }

  function connectToOutput(instId) {
    if (scriptNodes[instId]) {

    if (connectedInsts[instId]) {
      updateFilter(instId);
    } else {
      var instruments = SL.audio && SL.audio.getInstruments ? SL.audio.getInstruments() : null;
      var inst = instruments ? instruments[instId] : null;
      var isDestinationResolved = false;
      var destination;

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

      if (filterNode) {
        scriptNodes[instId].connect(filterNode);
        filterNode.connect(destination);
      } else {
        scriptNodes[instId].connect(destination);
      }

      connectedInsts[instId] = true;
      } // end if (isDestinationResolved)
    }
    } // end if (scriptNodes[instId])
  }

  // ============================================================
  // Settings Management
  // ============================================================

  function getOrCreateSettings(instId) {
    if (!instrumentSettings[instId]) {
      instrumentSettings[instId] = JSON.parse(JSON.stringify(DEFAULT_PHASEDIST_SETTINGS));
    }
    return instrumentSettings[instId];
  }

  function getSettings(instId) {
    return JSON.parse(JSON.stringify(getOrCreateSettings(instId)));
  }

  function setSettings(instId, settings) {
    instrumentSettings[instId] = JSON.parse(JSON.stringify(settings));
  }

  function getDefaultSettings() {
    return JSON.parse(JSON.stringify(DEFAULT_PHASEDIST_SETTINGS));
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

    // Read humanization
    var instruments = SL.audio.getInstruments();
    var rawHum = (instruments && instruments[instId]) ? (instruments[instId].settings.humanization || {}) : {};
    var humVelocity = (typeof rawHum === 'number') ? rawHum : (rawHum.velocity || 0);
    var humAdsr = (typeof rawHum === 'number') ? rawHum : (rawHum.adsr || 0);
    var humTiming = (typeof rawHum === 'number') ? 0 : (rawHum.timing || 0);

    // Get amplitude ADSR from instrument settings
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
      pdType: settings.pdType,
      pdAmount: settings.pdAmount,
      windowShape: settings.windowShape,
      resonantFreqRatio: settings.resonantFreqRatio,
      pdEnvAmount: settings.pdEnvAmount,
      pdEnvAttack: settings.pdEnvAttack,
      pdEnvDecay: settings.pdEnvDecay,
      pdEnvSustain: settings.pdEnvSustain,
      pdEnvRelease: settings.pdEnvRelease,
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
  // These parameters correspond to CZ-series front-panel controls:
  // - pdType: waveform selection (CZ had 8 basic + 8 resonant waveforms)
  // - pdAmount: DCW depth (0 = pure cosine, 100 = maximum distortion)
  // - windowShape: modifies the distortion curve character
  // - resonantFreqRatio: resonant partial position (CZ "resonance" knob)
  // - pdEnv*: DCW envelope parameters (the CZ's 8-stage envelope)

  function setPdType(instId, pdType) {
    var settings = getOrCreateSettings(instId);
    if (VALID_PD_TYPES[pdType]) {
      settings.pdType = pdType;
    }
  }

  function setPdAmount(instId, amount) {
    var settings = getOrCreateSettings(instId);
    settings.pdAmount = Math.max(0, Math.min(100, amount));
  }

  function setWindowShape(instId, shape) {
    var settings = getOrCreateSettings(instId);
    if (VALID_WINDOW_SHAPES[shape]) {
      settings.windowShape = shape;
    }
  }

  function setResonantFreqRatio(instId, ratio) {
    var settings = getOrCreateSettings(instId);
    settings.resonantFreqRatio = Math.max(2, Math.min(16, ratio));
  }

  function setPdEnvAmount(instId, amount) {
    var settings = getOrCreateSettings(instId);
    settings.pdEnvAmount = Math.max(0, Math.min(100, amount));
  }

  function setPdEnvAttack(instId, value) {
    var settings = getOrCreateSettings(instId);
    settings.pdEnvAttack = Math.max(0, Math.min(500, value));
  }

  function setPdEnvDecay(instId, value) {
    var settings = getOrCreateSettings(instId);
    settings.pdEnvDecay = Math.max(0, Math.min(500, value));
  }

  function setPdEnvSustain(instId, value) {
    var settings = getOrCreateSettings(instId);
    settings.pdEnvSustain = Math.max(0, Math.min(100, value));
  }

  function setPdEnvRelease(instId, value) {
    var settings = getOrCreateSettings(instId);
    settings.pdEnvRelease = Math.max(0, Math.min(1000, value));
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
    return isEngineReady;
  }

  // ============================================================
  // Export to SynthLab Namespace
  // ============================================================

  SL.phasedist = {
    // Initialization
    init: init,
    isReady: isReady,

    // Note control
    noteOn: noteOn,
    noteOff: noteOff,
    allNotesOff: allNotesOff,

    // Parameter control
    setPdType: setPdType,
    setPdAmount: setPdAmount,
    setWindowShape: setWindowShape,
    setResonantFreqRatio: setResonantFreqRatio,
    setPdEnvAmount: setPdEnvAmount,
    setPdEnvAttack: setPdEnvAttack,
    setPdEnvDecay: setPdEnvDecay,
    setPdEnvSustain: setPdEnvSustain,
    setPdEnvRelease: setPdEnvRelease,

    // Settings management
    getSettings: getSettings,
    setSettings: setSettings,
    getDefaultSettings: getDefaultSettings,

    // Connection & filter
    connectToOutput: connectToOutput,
    updateFilter: updateFilter,

    // Constants
    DEFAULT_PHASEDIST_SETTINGS: DEFAULT_PHASEDIST_SETTINGS,
    MAX_VOICES_PER_INSTRUMENT: MAX_VOICES_PER_INSTRUMENT,
    PD_TYPES: PD_TYPES,
    WINDOW_TYPES: WINDOW_TYPES
  };

})();
