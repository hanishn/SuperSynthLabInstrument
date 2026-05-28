// Super Synth Lab - Modal Resonator Synthesis Engine Module
// Banks of tuned bandpass filters modeling 2D/3D rigid body vibrations
// (bells, plates, bars, metallophones) with inharmonic frequency ratios
// v1.0.2 - fix: mallet excitation frequency now scales with note fundamental
//          to prevent single-note resonance artifacts (squeaky A3 on marimba)
//
// -----------------------------------------------------------------------
// EDUCATIONAL OVERVIEW: Modal Synthesis
// -----------------------------------------------------------------------
// Modal synthesis models the sound of physical objects (bells, bars, plates,
// drums) by decomposing their vibration into a sum of independent resonant
// modes. Each mode vibrates at a characteristic frequency, amplitude, and
// decay rate determined by the object's geometry and material.
//
// The technique was formalized by Adrien (1991) as "the missing link"
// between physical modeling and signal processing. Rather than simulating
// wave propagation on a mesh (finite-element style), modal synthesis
// replaces the object with a bank of second-order resonant filters — one
// per mode — driven by a short excitation signal (impulse, noise burst,
// or mallet strike). This is computationally cheap and musically intuitive.
//
// Key equation: each mode is a damped sinusoid
//   x_n(t) = A_n * exp(-d_n * t) * sin(2*pi*f_n*t + phi_n)
// where f_n = mode frequency, d_n = damping, A_n = amplitude.
//
// References:
//   Adrien, J.M. (1991) "The Missing Link: Modal Synthesis", in
//       Representations of Musical Signals, MIT Press
//   Cook, P. (1997) "Physically Informed Sonic Modeling (PhISM)",
//       Proc. ICMC — established the excitation + resonator paradigm
//   Fletcher, N.H. & Rossing, T.D. (1998) The Physics of Musical
//       Instruments, Springer — definitive reference on mode frequencies
//   Roads, C. (1996) The Computer Music Tutorial, MIT Press, Ch. 7
// -----------------------------------------------------------------------
(function() {
  'use strict';

  var SL = window.SynthLab;

  // ============================================================
  // Constants
  // ============================================================

  var MAX_VOICES_PER_INSTRUMENT = 16;
  var NUM_MODES = 16;

  // Valid excitation types
  var VALID_EXCITATION_TYPES = { 'impulse': 1, 'noise': 1, 'mallet': 1 };

  // -----------------------------------------------------------------------
  // Material partial ratio tables — characteristic inharmonic spectra
  // -----------------------------------------------------------------------
  // Every rigid body has natural vibration modes whose frequencies are NOT
  // simple integer multiples of a fundamental (unlike a vibrating string).
  // The ratios below come from analytical solutions to vibration equations:
  //
  //   Bar (marimba/xylophone): Euler-Bernoulli beam equation gives
  //     f_n = f_1 * (n + 0.5)^2 * (pi / 2L^2) * sqrt(EI / rhoA)
  //     In practice: f_n ~ f_1 * n^2 for free-free bars.
  //     (Fletcher & Rossing, 1998, Ch. 19)
  //
  //   Plate: 2D analog of a bar — stiffness dominates, yielding
  //     f_n ~ f_1 * (n + 0.5)^2 for circular plates (Chladni patterns).
  //
  //   Membrane (drum): solutions to the 2D wave equation on a circular
  //     membrane are zeros of Bessel functions J_m(x):
  //     j_01=1.0, j_11=1.594, j_21=2.136, j_02=2.296, j_31=2.653...
  //     (Fletcher & Rossing, 1998, Ch. 18)
  //
  //   Bell: highly inharmonic; ratios are unique per bell shape/profile.
  //
  //   Tube: open-open tube produces a full harmonic series (1,2,3,4...).
  //
  //   Glass: behaves like a curved plate — very high inharmonicity.
  // -----------------------------------------------------------------------
  var MATERIAL_RATIOS = {
    bar:      [1, 2.76, 5.40, 8.93, 13.34, 18.64, 24.82, 31.87, 39.81, 48.62, 58.31, 68.88, 80.33, 92.66, 105.86, 119.94],
    plate:    [1, 1.59, 2.14, 2.30, 2.65, 2.92, 3.16, 3.50, 3.60, 3.65, 4.06, 4.15, 4.35, 4.61, 4.84, 5.13],
    bell:     [1, 1.18, 1.56, 2.00, 2.47, 2.79, 3.14, 3.54, 3.98, 4.47, 5.02, 5.63, 6.32, 7.10, 7.97, 8.95],
    membrane: [1, 1.59, 2.14, 2.30, 2.65, 2.92, 3.16, 3.50, 3.60, 3.65, 4.06, 4.15, 4.35, 4.61, 4.84, 5.13],
    tube:     [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
    glass:    [1, 2.32, 4.14, 6.43, 9.20, 12.44, 16.16, 20.36, 25.04, 30.20, 35.84, 41.96, 48.56, 55.64, 63.20, 71.24]
  };

  // Harmonic ratios for inharmonicity morphing
  // Pure harmonic series (ideal string): f_n = n * f_1.
  // The inharmonicity knob interpolates between these and MATERIAL_RATIOS,
  // letting the user smoothly morph from "string-like" to "bell-like".
  var HARMONIC_RATIOS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

  // -----------------------------------------------------------------------
  // Mallet excitation model
  // -----------------------------------------------------------------------
  // In physical acoustics, mallet hardness controls the spectral content
  // of the excitation impulse: a soft mallet (yarn-wrapped) produces a
  // low-pass excitation that preferentially excites low modes, while a
  // hard mallet (brass/acetal) delivers a broadband impulse that excites
  // many higher modes. (Cook, 1997; Fletcher & Rossing, 1998, Ch. 19)
  //
  // Implementation: a windowed sine burst whose frequency is a ratio of
  // the note fundamental. Soft = low ratio (mellow), hard = high ratio.
  // -----------------------------------------------------------------------
  // Scaling with the note avoids fixed-frequency coincidences where
  // the mallet sine burst lands on top of a modal resonator, causing
  // that mode to ring excessively (e.g. A3 on marimba with a fixed
  // 2648 Hz mallet hit mode 4 at 2660 Hz — "squeaky" artifact).
  // Values chosen to sit between material partial ratios across all
  // material types and inharmonicity settings.
  var MALLET_RATIO_SOFT = 2.15;
  var MALLET_RATIO_HARD = 10.8;

  /** Default modal settings for a new instrument */
  var DEFAULT_MODAL_SETTINGS = {
    material: 'bell',
    damping: 30,
    brightness: 60,
    bodySize: 50,
    inharmonicity: 80,
    excitation: 'mallet',
    malletHardness: 50,
    adsr: { a: 1, d: 100, s: 0, r: 200 }
  };

  // ============================================================
  // State
  // ============================================================

  var audioContext = null;
  var scriptNodes = [null, null, null, null];
  var fallbackVoicesByInst = [[], [], [], []];
  var isEngineReady = false;

  // Per-instrument settings cache (instId -> settings object)
  var instrumentSettings = {};

  // Per-instrument filter nodes (instId -> BiquadFilterNode)
  var modalFilterNodes = {};

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
  // Modal Resonator Voice
  // ============================================================
  // Each voice contains a bank of NUM_MODES biquad bandpass filters.
  // The excitation signal (impulse, noise, or mallet sine burst) is
  // fed into all filters simultaneously; each filter "rings" at its
  // mode frequency, and the outputs are summed. This is the classic
  // source-filter decomposition from Adrien (1991):
  //   output(t) = SUM_n [ excitation(t) * h_n(t) ]
  // where h_n is the impulse response of the n-th resonant filter.
  // ============================================================

  function ModalVoice(sr) {
    this.sampleRate = sr;
    this.active = false;
    this.midiNote = -1;
    this.instId = 0;

    // Mode filter bank state (biquad bandpass coefficients)
    // Each mode is a 2nd-order IIR bandpass (biquad) with Direct Form I:
    //   y[n] = b0*x[n] - a1*y[n-1] - a2*y[n-2]
    // y1, y2 are the two delay taps. b0, a1, a2 are the filter coefficients
    // computed from the mode's center frequency and bandwidth (Q).
    this.numModes = NUM_MODES;
    this.modes = [];
    for (var i = 0; i < this.numModes; i++) {
      this.modes.push({
        freq: 440,
        gain: 0,
        y1: 0,
        y2: 0,
        b0: 0,
        a1: 0,
        a2: 0
      });
    }

    // Excitation state
    this.exciteRemaining = 0;
    this.exciteSamples = 1;
    this.exciteLevel = 0.5;
    this.excitationType = 'mallet';
    this.malletFreq = 0;
    this.malletPhase = 0;
    this.noiseFilterState = 0;

    // ADSR envelope
    this.envStage = 0;  // 0=attack, 1=decay, 2=sustain, 3=release
    this.envLevel = 0;
    this.envReleased = false;
    this.envFinished = false;
    this.attackRate = 0;
    this.decayRate = 0;
    this.sustainLevel = 0;
    this.releaseRate = 0;

    // Output scaling and DC blocking
    this.outputScale = 1.0;
    this.dcX1 = 0;
    this.dcY1 = 0;
    this.dcR = 0.995;

    // Decay tracking
    this.decayCounter = 0;
    this.maxDecay = 0;

    // Fade-in ramp to prevent click
    this.fadeInSamples = 0;
    this.fadeInCounter = 0;
  }

  // -----------------------------------------------------------------------
  // Biquad bandpass coefficient computation
  // -----------------------------------------------------------------------
  // Derived from the Audio EQ Cookbook (Robert Bristow-Johnson, 2005).
  // The bandpass filter acts as a damped harmonic oscillator:
  //   H(z) = (sin(w0)/2) / (1 + alpha - 2*cos(w0)*z^-1 + (1-alpha)*z^-2)
  // where w0 = 2*pi*f/fs and alpha = sin(w0)/(2*Q).
  // Bandwidth (bw) in Hz maps to Q: Q = freq / bw.
  // Narrower bandwidth = higher Q = longer ring time = less damping.
  // -----------------------------------------------------------------------
  /**
   * Configure a single biquad bandpass mode filter
   */
  ModalVoice.prototype.configureMode = function(mode, freq, bw) {
    var sr = this.sampleRate;
    if (freq >= sr / 2 - 100) {
      freq = sr / 2 - 100;
    }
    if (freq < 20) {
      freq = 20;
    }
    var w0 = 2 * Math.PI * freq / sr;
    var sinW0 = Math.sin(w0);
    var cosW0 = Math.cos(w0);
    var safeBw = bw || 0.001;
    var alpha = sinW0 / (2 * (freq / safeBw));
    var a0 = 1 + alpha;
    mode.b0 = (sinW0 / 2) / a0;
    mode.a1 = (-2 * cosW0) / a0;
    mode.a2 = (1 - alpha) / a0;
    mode.freq = freq;
  };

  // Inharmonicity morphing: linearly interpolates between the ideal harmonic
  // series (string-like) and the material-specific partial ratios.
  // At inharmonicity=0 you get a pure harmonic timbre; at 100 you get the
  // full physical-model ratios for that material type.
  /**
   * Get interpolated ratios between harmonic and material-specific inharmonic ratios
   */
  ModalVoice.prototype.getInterpolatedRatios = function(material, inharmonicity) {
    var materialRatios = MATERIAL_RATIOS[material] || MATERIAL_RATIOS.bell;
    var inharm = inharmonicity / 100;  // 0-1
    var ratios = [];
    for (var i = 0; i < NUM_MODES; i++) {
      var harmonic = HARMONIC_RATIOS[i];
      var inharmonic = materialRatios[i];
      ratios.push(harmonic + (inharmonic - harmonic) * inharm);
    }
    return ratios;
  };

  ModalVoice.prototype.noteOn = function(midi, vel, freq, settings) {
    this.active = true;
    this.midiNote = midi;
    this.instId = settings.instId || 0;
    this.envStage = 0;
    this.envLevel = 0;
    this.envReleased = false;
    this.envFinished = false;
    this.decayCounter = 0;

    var velocity = (vel || 100) / 127;

    // Body size: affects resonator decay/bandwidth, NOT fundamental pitch.
    // A "larger body" rings longer (narrower bandwidth); a smaller body decays
    // faster (wider bandwidth). Fundamental pitch is determined solely by the
    // requested MIDI note so that pitched presets (Marimba, Vibraphone, etc.)
    // play the correct note regardless of body size. bodySize 0 = tiny/fast
    // decay (bwMul ~2.0), 50 = neutral (1.0), 100 = huge/long decay (~0.5).
    var bodySizeBwMul = 2.0 / (0.5 + (settings.bodySize / 100) * 1.5) * 0.5;
    var baseFreq = freq;

    // Get interpolated ratios
    var ratios = this.getInterpolatedRatios(settings.material, settings.inharmonicity);

    var nyquist = this.sampleRate / 2 - 100;
    var dampingFactor = settings.damping / 100;  // 0-1
    var brightnessFactor = settings.brightness / 100;  // 0-1
    var hardnessFactor = 0.3 + (settings.malletHardness / 100) * 0.7;

    // Maximum decay time based on damping AND body size. Larger bodies ring longer.
    var bodySizeDecayMul = 0.5 + (settings.bodySize / 100) * 1.5;  // 0.5x..2.0x
    this.maxDecay = Math.floor(this.sampleRate * (0.3 + (1 - dampingFactor) * 14.7) * bodySizeDecayMul);

    // Configure each mode
    for (var i = 0; i < this.numModes; i++) {
      var modeFreq = baseFreq * ratios[i];
      if (modeFreq >= nyquist) {
        this.modes[i].gain = 0;
      } else {
        // Bandwidth controls decay: narrower = longer ring
        // Lower modes get narrower bandwidth (longer sustain)
        // Damping widens bandwidth (faster decay)
        var bw = modeFreq * (0.0003 + dampingFactor * 0.02) * (1 + i * 0.12) * bodySizeBwMul;
        this.configureMode(this.modes[i], modeFreq, Math.max(0.2, bw));

        // Amplitude: higher modes attenuated by brightness
        // brightnessFactor controls how much higher partials are present
        var ampRolloff = Math.pow(1 - (1 - brightnessFactor) * 0.85, i * 0.2);
        // Mallet hardness: hard mallet excites more high modes
        var hardnessBoost = Math.pow(hardnessFactor, i * 0.12);
        this.modes[i].gain = velocity * ampRolloff * hardnessBoost / (1 + i * 0.2);
      }
      this.modes[i].y1 = 0;
      this.modes[i].y2 = 0;
    }

    // Normalize output
    var totalGain = 0;
    for (var i = 0; i < this.numModes; i++) {
      totalGain += Math.abs(this.modes[i].gain);
    }
    var MODAL_OUTPUT_TARGET = 1.3;
    this.outputScale = totalGain > 0 ? (MODAL_OUTPUT_TARGET / totalGain) : 1.0;

    // Configure excitation
    this.excitationType = settings.excitation || 'mallet';
    if (this.excitationType === 'impulse') {
      // Very short impulse (1-3 ms)
      this.exciteSamples = Math.max(4, Math.floor(this.sampleRate * 0.002));
      this.exciteRemaining = this.exciteSamples;
      this.exciteLevel = velocity * 1.5;
    } else if (this.excitationType === 'noise') {
      // Noise burst (5-20 ms depending on hardness)
      var noiseDuration = 0.005 + (1 - hardnessFactor) * 0.015;
      this.exciteSamples = Math.max(8, Math.floor(this.sampleRate * noiseDuration));
      this.exciteRemaining = this.exciteSamples;
      this.exciteLevel = velocity * 1.0;
      this.noiseFilterState = 0;
    } else {
      // Mallet: sine burst — frequency scales with the note fundamental.
      // Using a ratio of the fundamental ensures every note has the same
      // spectral relationship to its modes, preventing single-note
      // resonance artifacts (squeaky A3, etc.).
      var malletRatio = MALLET_RATIO_SOFT + hardnessFactor * (MALLET_RATIO_HARD - MALLET_RATIO_SOFT);
      this.malletFreq = baseFreq * malletRatio;
      this.malletPhase = 0;
      var malletDuration = 0.002 + (1 - hardnessFactor) * 0.018;
      this.exciteSamples = Math.max(8, Math.floor(this.sampleRate * malletDuration));
      this.exciteRemaining = this.exciteSamples;
      this.exciteLevel = velocity * 1.2;
    }

    // ADSR configuration
    var adsr = settings.adsr || { a: 1, d: 100, s: 0, r: 200 };
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
    this.sustainLevel = (adsr.s !== undefined) ? adsr.s / 100 : 0;
    this.attackRate = 1.0 / (Math.max(0.001, aTime) * this.sampleRate);
    this.decayRate = 1.0 / (Math.max(0.001, dTime) * this.sampleRate);
    this.releaseRate = 1.0 / (Math.max(0.001, rTime) * this.sampleRate);

    // Short fade-in to prevent click
    this.fadeInSamples = Math.ceil(this.sampleRate * 0.004);
    this.fadeInCounter = 0;

    // DC blocker reset
    this.dcX1 = 0;
    this.dcY1 = 0;
  };

  ModalVoice.prototype.noteOff = function() {
    if (!this.envFinished) {
      this.envReleased = true;
      this.envStage = 3;
    }
  };

  ModalVoice.prototype.processEnvelope = function() {
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

  ModalVoice.prototype.process = function() {
    if (!this.active) {
      return 0;
    }

    this.decayCounter++;
    if (this.decayCounter > this.maxDecay) {
      this.active = false;
      return 0;
    }

    // Process ADSR envelope
    var env = this.processEnvelope();
    if (this.envFinished) {
      this.active = false;
      return 0;
    }

    // -----------------------------------------------------------------------
    // Excitation signal generation
    // -----------------------------------------------------------------------
    // The excitation is the "energy input" — analogous to striking, bowing,
    // or plucking the object. In Cook's PhISM framework (1997), the exciter
    // and resonator are independent: any excitation can drive any resonator.
    // All excitation types are windowed with a half-sine envelope to prevent
    // spectral splatter from abrupt onset/offset.
    // -----------------------------------------------------------------------
    var excitation = 0;
    if (this.exciteRemaining > 0) {
      var t = 1 - (this.exciteRemaining / this.exciteSamples);
      var window = Math.sin(Math.PI * t);  // Half-sine window

      if (this.excitationType === 'impulse') {
        excitation = window * this.exciteLevel;
      } else if (this.excitationType === 'noise') {
        // Filtered noise burst: hardness controls filter cutoff
        var rawNoise = Math.random() * 2 - 1;
        // Simple one-pole LP on noise
        var filterCoeff = 0.3 + (1 - t) * 0.5;
        this.noiseFilterState = filterCoeff * rawNoise + (1 - filterCoeff) * this.noiseFilterState;
        excitation = window * this.noiseFilterState * this.exciteLevel;
      } else {
        // Mallet: windowed sine burst
        var sineSample = Math.sin(2 * Math.PI * this.malletPhase);
        this.malletPhase += this.malletFreq / this.sampleRate;
        excitation = window * sineSample * this.exciteLevel;
        // Add small noise component for realism
        excitation += window * (Math.random() * 2 - 1) * this.exciteLevel * 0.15 * (1 - t);
      }
      this.exciteRemaining--;
    }

    // Sum all mode filter outputs — this is the core of modal synthesis.
    // Each biquad bandpass resonates at its mode frequency when excited,
    // producing a decaying sinusoid. The sum of all modes reconstructs
    // the object's full vibration spectrum. (Adrien, 1991)
    var output = 0;
    for (var i = 0; i < this.numModes; i++) {
      var m = this.modes[i];
      if (m.gain === 0) {
        continue;
      }
      // Biquad bandpass: y[n] = b0*x[n] - a1*y[n-1] - a2*y[n-2]
      var y = m.b0 * excitation - m.a1 * m.y1 - m.a2 * m.y2;
      m.y2 = m.y1;
      m.y1 = y;
      output += y * m.gain;
    }

    // Apply output scaling
    output *= this.outputScale;

    // DC blocker: first-order high-pass filter y[n] = x[n] - x[n-1] + R*y[n-1]
    // Removes any DC offset accumulated from summing many resonator outputs.
    // R=0.995 gives a -3dB point around 16 Hz at 44.1 kHz sample rate.
    var dcOut = output - this.dcX1 + this.dcR * this.dcY1;
    this.dcX1 = output;
    this.dcY1 = dcOut;
    output = dcOut;

    // Apply ADSR envelope
    output *= env;

    // Fade-in ramp
    if (this.fadeInCounter < this.fadeInSamples) {
      output *= this.fadeInCounter / this.fadeInSamples;
      this.fadeInCounter++;
    }

    // Soft limiter: f(x) = x / (1 + |x|) for transient peaks.
    // This is a simple sigmoid that smoothly approaches +/-1 without
    // hard clipping, preserving transient character of struck objects.
    if (output > 0.9 || output < -0.9) {
      output = output / (1.0 + Math.abs(output));
    }

    // Check for silence after excitation ends
    var isExciteFinished = this.exciteRemaining <= 0 && this.decayCounter > this.sampleRate * 0.3;
    var isSilentAfterDecay = isExciteFinished && Math.abs(output) < 0.00001;
    if (isSilentAfterDecay) {
      this.active = false;
      return 0;
    }

    return output;
  };

  ModalVoice.prototype.isFinished = function() {
    return !this.active || this.envFinished;
  };

  // ============================================================
  // Engine Initialization
  // ============================================================

  function init(ctx) {
    audioContext = ctx || (SL.audio && SL.audio.getCtx ? SL.audio.getCtx() : null);
    if (!audioContext) {
      console.error('[MODAL] No AudioContext available');
      return Promise.reject(new Error('No AudioContext'));
    }

    return initFallback();
  }

  function initFallback() {
    var sr = audioContext.sampleRate;
    var bufSize = (SL.audio && SL.audio.getScriptProcessorBufferSize) ? SL.audio.getScriptProcessorBufferSize() : 1024;

    // Pre-allocate per-instrument voice pools (16 voices each)
    for (var i = 0; i < 4; i++) {
      fallbackVoicesByInst[i].length = 0;
      for (var v = 0; v < MAX_VOICES_PER_INSTRUMENT; v++) {
        fallbackVoicesByInst[i].push(new ModalVoice(sr));
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
                sample += voices[vi].process() * 0.90;
              }
            }
            // Pade [3/3] approximant of tanh(x) for soft clipping:
            //   tanh(x) ~ x*(27 + x^2) / (27 + 9*x^2)
            // Much cheaper than Math.tanh() and accurate to <0.1% for |x|<3.
            // Prevents digital clipping when many modes sum to large amplitude.
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
    if (!modalFilterNodes[instId]) {
      var node = audioContext.createBiquadFilter();
      node.type = 'lowpass';
      node.frequency.value = 20000;
      node.Q.value = 0.707;
      modalFilterNodes[instId] = node;
    }
    return modalFilterNodes[instId];
  }

  function updateFilter(instId) {
    if (instId === undefined) {
      instId = 0;
    }
    var filterNode = modalFilterNodes[instId];
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
    // Null-guard: if script node not created yet, skip silently
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
      }
    }
    } // end if (scriptNodes[instId])
  }

  // ============================================================
  // Settings Management
  // ============================================================

  function getOrCreateSettings(instId) {
    if (!instrumentSettings[instId]) {
      instrumentSettings[instId] = JSON.parse(JSON.stringify(DEFAULT_MODAL_SETTINGS));
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

    // Read humanization amounts
    var instruments = SL.audio && SL.audio.getInstruments ? SL.audio.getInstruments() : null;
    var rawHum = (instruments && instruments[instId]) ? (instruments[instId].settings.humanization || {}) : {};
    var humVelocity = (typeof rawHum === 'number') ? rawHum : (rawHum.velocity || 0);

    // Randomize velocity
    var finalVel = velocity;
    if (humVelocity > 0) {
      var velRange = Math.round(humVelocity * 1.2);
      finalVel = velocity + Math.round((Math.random() * 2 - 1) * velRange);
      if (finalVel < 1) {
        finalVel = 1;
      }
      if (finalVel > 127) {
        finalVel = 127;
      }
    }

    // Get ADSR from instrument settings
    var instSettings = (instruments && instruments[instId]) ? instruments[instId].settings : null;
    var adsrRaw = (instSettings && instSettings.adsr) ? instSettings.adsr : { a: 1, d: 100, s: 0, r: 200 };

    var voiceSettings = {
      instId: instId,
      material: settings.material,
      damping: settings.damping,
      brightness: settings.brightness,
      bodySize: settings.bodySize,
      inharmonicity: settings.inharmonicity,
      excitation: settings.excitation,
      malletHardness: settings.malletHardness,
      adsr: adsrRaw
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
      voice = voices[0];  // steal oldest
    }
    voice.noteOn(midi, finalVel, noteFreq, voiceSettings);
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

  function setMaterial(instId, material) {
    var settings = getOrCreateSettings(instId);
    if (MATERIAL_RATIOS[material]) {
      settings.material = material;
    }
  }

  function setDamping(instId, value) {
    var settings = getOrCreateSettings(instId);
    settings.damping = Math.max(0, Math.min(100, value));
  }

  function setBrightness(instId, value) {
    var settings = getOrCreateSettings(instId);
    settings.brightness = Math.max(0, Math.min(100, value));
  }

  function setBodySize(instId, value) {
    var settings = getOrCreateSettings(instId);
    settings.bodySize = Math.max(0, Math.min(100, value));
  }

  function setInharmonicity(instId, value) {
    var settings = getOrCreateSettings(instId);
    settings.inharmonicity = Math.max(0, Math.min(100, value));
  }

  function setExcitation(instId, excitation) {
    var settings = getOrCreateSettings(instId);
    if (VALID_EXCITATION_TYPES[excitation]) {
      settings.excitation = excitation;
    }
  }

  function setMalletHardness(instId, value) {
    var settings = getOrCreateSettings(instId);
    settings.malletHardness = Math.max(0, Math.min(100, value));
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
    return isEngineReady;
  }

  function getDefaultSettings() {
    return JSON.parse(JSON.stringify(DEFAULT_MODAL_SETTINGS));
  }

  // ============================================================
  // Export to SynthLab Namespace
  // ============================================================

  SL.modal = {
    // Initialization
    init: init,
    isReady: isReady,

    // Note control
    noteOn: noteOn,
    noteOff: noteOff,
    allNotesOff: allNotesOff,

    // Parameter control
    setMaterial: setMaterial,
    setDamping: setDamping,
    setBrightness: setBrightness,
    setBodySize: setBodySize,
    setInharmonicity: setInharmonicity,
    setExcitation: setExcitation,
    setMalletHardness: setMalletHardness,

    // Settings management
    getSettings: getSettings,
    setSettings: setSettings,
    getDefaultSettings: getDefaultSettings,

    // Connection & filter
    connectToOutput: connectToOutput,
    updateFilter: updateFilter,

    // Constants
    DEFAULT_MODAL_SETTINGS: DEFAULT_MODAL_SETTINGS,
    MAX_VOICES_PER_INSTRUMENT: MAX_VOICES_PER_INSTRUMENT,
    NUM_MODES: NUM_MODES,
    MATERIAL_RATIOS: MATERIAL_RATIOS
  };

})();
