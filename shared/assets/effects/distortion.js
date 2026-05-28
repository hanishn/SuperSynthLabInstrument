// Synth Lab - Distortion Effect
// Provides various distortion types: soft clip, hard clip, fuzz, tube, wavefold, bitcrush, and tape
//
// -----------------------------------------------------------------------
// EDUCATIONAL NOTES: Digital Waveshaping Distortion [FX-030]
// -----------------------------------------------------------------------
// Waveshaping synthesis maps an input signal through a nonlinear transfer
// function (a "curve"). The shape of the curve determines which harmonics
// are added to the signal.
//
// Reference:
//   Le Brun, M. (1979) "Digital Waveshaping Synthesis", JAES 27(4)
//   Roads, C. (1996) The Computer Music Tutorial, MIT Press, Ch. 6
//
// This effect implements 7 waveshaping curves, each with distinct harmonic
// character. The curves are stored as Float32Array lookup tables and applied
// by the Web Audio WaveShaperNode.
//
// Aliasing problem: Nonlinear waveshaping generates new harmonics that may
// exceed the Nyquist frequency and fold back as inharmonic artifacts.
// Solution: 4x oversampling — the WaveShaperNode upsamples before shaping,
// then lowpass-filters and downsamples, keeping aliased harmonics inaudible.
//
// Post-distortion tone filter: Distortion adds energy across the spectrum,
// especially at high frequencies. A post-distortion lowpass (the "tone"
// knob) tames harsh upper harmonics while preserving warmth below.
// -----------------------------------------------------------------------

(function() {
  var SL = window.SynthLab;
  var BaseEffect = SL.effects.BaseEffect;

  // Number of samples for waveshaper curves
  // 44100 samples gives ~23-bit precision for the lookup table
  var CURVE_SAMPLES = 44100;

  // -------------------------------------------------------------------
  // Curve generators: each returns a Float32Array mapping input [-1,+1]
  // to output [-1,+1]. The WaveShaperNode interpolates between samples.
  // -------------------------------------------------------------------

  // Soft clip: f(x) = tanh(x * k) / tanh(k)
  // tanh provides smooth, monotonic saturation — the signal asymptotically
  // approaches +/-1 without ever hard-clipping. This produces primarily
  // odd harmonics with a warm, musical character. The division by tanh(k)
  // normalizes the output so the curve always reaches +/-1 at full input.

  /**
   * Generate a soft clipping curve using tanh
   * Creates smooth, warm distortion
   */
  function generateSoftCurve(drive) {
    var curve = new Float32Array(CURVE_SAMPLES);
    var amount = Math.max(1, drive * 10);

    for (var i = 0; i < CURVE_SAMPLES; i++) {
      var x = (i * 2 / CURVE_SAMPLES) - 1;
      curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
    }
    return curve;
  }

  // Hard clip: clamp signal at +/-threshold, then normalize.
  // This creates sharp corners in the waveform — a perfect square wave at
  // maximum drive. The abrupt transition generates strong odd harmonics
  // with a harsh, aggressive, distinctly digital character.

  /**
   * Generate a hard clipping curve
   * Creates aggressive, digital-style distortion
   */
  function generateHardCurve(drive) {
    var curve = new Float32Array(CURVE_SAMPLES);
    var threshold = Math.max(0.01, 1 - (drive / 100) * 0.99);

    for (var i = 0; i < CURVE_SAMPLES; i++) {
      var x = (i * 2 / CURVE_SAMPLES) - 1;
      var safeThreshold = threshold || 0.001;
      curve[i] = Math.max(-threshold, Math.min(threshold, x)) / safeThreshold;
    }
    return curve;
  }

  // Fuzz: asymmetric clipping — positive side clips harder than negative.
  // Asymmetry in the transfer function generates EVEN harmonics (2nd, 4th, ...),
  // which symmetric curves (soft/hard clip) do not produce. This models the
  // behavior of germanium transistor fuzz circuits (e.g., Fuzz Face, 1966),
  // where PNP transistor bias drift creates inherently asymmetric clipping.
  // The 0.9 scaling on the negative side plus the 1.5x vs 0.8x drive ratio
  // creates the characteristic lopsided waveform.

  /**
   * Generate asymmetric fuzz curve
   * Simulates transistor-based fuzz pedals with even harmonics
   */
  function generateFuzzCurve(drive) {
    var curve = new Float32Array(CURVE_SAMPLES);
    var amount = Math.max(1, drive / 10);

    for (var i = 0; i < CURVE_SAMPLES; i++) {
      var x = (i * 2 / CURVE_SAMPLES) - 1;
      // Asymmetric clipping - positive side clips harder
      if (x >= 0) {
        curve[i] = Math.tanh(x * amount * 1.5);
      } else {
        // Negative side has softer clipping with slight bias
        curve[i] = Math.tanh(x * amount * 0.8) * 0.9;
      }
    }
    return curve;
  }

  // Tube: polynomial approximation of vacuum tube (valve) saturation.
  // Real tubes have a "soft knee" — a gradual transition from linear to
  // saturated regions. Below the knee (absX < 0.5), the signal passes
  // with gentle compression. Above it, exponential saturation limits gain.
  // The slight asymmetry (0.95 positive vs 1.0 negative) adds even-order
  // harmonics — the 2nd harmonic "warmth" prized in tube amplifiers.
  // This two-region polynomial approach approximates the plate characteristic
  // curves of a 12AX7 triode without the computational cost of full
  // circuit simulation.

  /**
   * Generate tube amp simulation curve
   * Creates warm saturation with even harmonics characteristic of tube amps
   */
  function generateTubeCurve(drive) {
    var curve = new Float32Array(CURVE_SAMPLES);
    var amount = Math.max(1, drive / 5);

    for (var i = 0; i < CURVE_SAMPLES; i++) {
      var x = (i * 2 / CURVE_SAMPLES) - 1;
      // Tube-style saturation with smooth knee
      var sign = x >= 0 ? 1 : -1;
      var absX = Math.abs(x);

      // Soft saturation with polynomial approximation of tube behavior
      // Adds even harmonics through asymmetric response
      var y;
      if (absX < 0.5) {
        // Linear region with slight compression
        y = absX * (1 + absX * amount * 0.2);
      } else {
        // Saturation region
        var excess = absX - 0.5;
        var base = 0.5 * (1 + 0.5 * amount * 0.2);
        y = base + (1 - Math.exp(-excess * amount)) * (1 - base);
      }

      // Add slight asymmetry for even harmonics (tube characteristic)
      if (x >= 0) {
        curve[i] = y * 0.95;
      } else {
        curve[i] = -y;
      }
    }
    return curve;
  }

  // Wavefold: f(x) = sin(x * N * pi * intensity)
  // Serge-style wavefolding — when the signal exceeds a threshold, it
  // "folds" back rather than clipping. Each fold adds harmonic content,
  // producing the metallic, bell-like timbres characteristic of West Coast
  // synthesis (Serge Modular, Buchla). The sine function naturally creates
  // smooth folds. More folds = more harmonics = brighter, more complex sound.
  // See wavefolder-engine.js for deeper theory on wavefolding synthesis.

  /**
   * Generate wavefolder curve (West Coast synthesis style)
   * Waveform folds back on itself at threshold, creating complex, evolving harmonics
   * Metallic, bell-like character at extreme settings
   */
  function generateWavefoldCurve(drive, folds) {
    var curve = new Float32Array(CURVE_SAMPLES);
    // folds parameter determines how many times the wave folds (1-8)
    var numFolds = Math.max(1, Math.min(8, folds || 4));
    // drive affects the intensity of the folding
    var intensity = 1 + (drive / 100) * 2;

    for (var i = 0; i < CURVE_SAMPLES; i++) {
      var x = (i * 2 / CURVE_SAMPLES) - 1;
      // Serge-style wavefolder using sine function
      curve[i] = Math.sin(x * numFolds * Math.PI * intensity);
    }
    return curve;
  }

  // Bitcrush: quantize signal amplitude to N discrete levels (2^bits).
  // This models the effect of reducing bit depth — a 16-bit signal has
  // 65536 levels, but at 4 bits only 16 levels remain, creating audible
  // staircase steps (quantization noise). The noise floor rises as bits
  // decrease: SNR ~ 6.02 * bits dB. At 1 bit, the signal becomes a
  // square wave. This is the sound of early samplers (Fairlight, Emulator).

  /**
   * Generate bitcrusher curve (digital degradation)
   * Reduces bit depth creating quantization distortion
   */
  function generateBitcrushCurve(drive, bits) {
    var curve = new Float32Array(CURVE_SAMPLES);
    // bits parameter determines quantization levels (1-16)
    var numBits = Math.max(1, Math.min(16, bits || 8));
    var levels = Math.pow(2, numBits);
    // drive adds additional distortion/noise character
    var driveAmount = 1 + (drive / 100) * 0.5;

    for (var i = 0; i < CURVE_SAMPLES; i++) {
      var x = (i * 2 / CURVE_SAMPLES) - 1;
      // Quantize the signal to discrete levels
      var safeLevels = levels || 1;
      var quantized = Math.round(x * driveAmount * safeLevels) / safeLevels;
      // Clamp to valid range
      curve[i] = Math.max(-1, Math.min(1, quantized));
    }
    return curve;
  }

  // Tape: hysteresis-inspired saturation model.
  // Magnetic tape saturates asymmetrically — the magnetization curve (B-H)
  // is not symmetric, which produces even-order harmonics (especially 2nd).
  // The main curve uses f(x) = (1+k)*x / (1+k*|x|), a computationally
  // cheap rational function that approximates magnetic hysteresis. The
  // explicit 2nd-harmonic term (x^2 * sign(x)) models tape's characteristic
  // warmth. The final tanh soft-limits the output, mimicking the natural
  // compression ("glue") that tape machines add to peaks.

  /**
   * Generate tape saturation curve
   * Soft, asymmetric saturation with natural compression and "glue" character
   */
  function generateTapeCurve(drive) {
    var curve = new Float32Array(CURVE_SAMPLES);
    // Map drive to saturation amount (0-100 -> 0.1-0.9)
    var saturation = 0.1 + (drive / 100) * 0.8;
    var k = 2 * saturation / (1 - saturation);

    for (var i = 0; i < CURVE_SAMPLES; i++) {
      var x = (i * 2 / CURVE_SAMPLES) - 1;
      // Main saturation curve
      var output = (1 + k) * x / (1 + k * Math.abs(x));
      // Add 2nd harmonic for even-order distortion (tape characteristic)
      output += saturation * 0.1 * x * x * Math.sign(x);
      // Final soft limiting with tanh
      curve[i] = Math.tanh(output * 1.1);
    }
    return curve;
  }

  /**
   * Distortion Effect
   *
   * Parameters:
   * - drive: 0-100 (amount of distortion/gain into waveshaper)
   * - tone: 200-8000 Hz (post-distortion lowpass filter cutoff)
   * - type: 'soft', 'hard', 'fuzz', 'tube', 'wavefold', 'bitcrush', 'tape' (distortion curve type)
   * - folds: 1-8 (wavefolder only - number of waveform folds)
   * - bits: 1-16 (bitcrusher only - bit depth)
   * - mix: 0-100 (wet/dry mix, inherited from BaseEffect)
   */
  class DistortionEffect extends BaseEffect {
    constructor(ctx) {
      super(ctx, 'distortion');

      // Pre-gain for driving the distortion
      this.preGain = ctx.createGain();

      // Waveshaper for the actual distortion
      this.waveshaper = ctx.createWaveShaper();
      // 4x oversampling: upsample to 4x sample rate before waveshaping, then
      // lowpass filter and downsample. This prevents aliased harmonics from
      // folding back into the audible range (Nyquist theorem).
      this.waveshaper.oversample = '4x'; // Reduce aliasing

      // Post-distortion tone control (lowpass filter)
      this.toneFilter = ctx.createBiquadFilter();
      this.toneFilter.type = 'lowpass';
      this.toneFilter.Q.value = 0.7; // Slight resonance for warmth

      // Post-gain to compensate for level changes
      this.postGain = ctx.createGain();
      this.postGain.gain.value = 0.7; // Reduce output to prevent clipping

      // Signal chain: input -> preGain -> waveshaper -> toneFilter -> postGain -> wetGain
      this.input.connect(this.preGain);
      this.preGain.connect(this.waveshaper);
      this.waveshaper.connect(this.toneFilter);
      this.toneFilter.connect(this.postGain);
      this.postGain.connect(this.wetGain);

      // Set default parameters
      this.params = {
        drive: 50,
        tone: 4000,
        type: 'soft',
        folds: 4,    // For wavefolder (1-8)
        bits: 8,     // For bitcrusher (1-16)
        mix: 50
      };

      // Apply defaults
      this.updateDrive();
      this.updateTone();
      this.updateType();
    }

    /**
     * Update the pre-gain based on drive amount
     */
    updateDrive() {
      // Map drive (0-100) to gain multiplier
      // At 0: gain = 1, at 100: gain = 10
      var gain = 1 + (this.params.drive / 100) * 9;
      this.preGain.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.01);

      // Also regenerate the curve since some curves depend on drive
      this.updateType();
    }

    /**
     * Update the tone filter cutoff
     */
    updateTone() {
      this.toneFilter.frequency.setTargetAtTime(
        this.params.tone,
        this.ctx.currentTime,
        0.01
      );
    }

    /**
     * Update the distortion curve based on type
     */
    updateType() {
      var drive = this.params.drive;
      var curve;

      switch (this.params.type) {
        case 'hard':
          curve = generateHardCurve(drive);
          break;
        case 'fuzz':
          curve = generateFuzzCurve(drive);
          break;
        case 'tube':
          curve = generateTubeCurve(drive);
          break;
        case 'wavefold':
          curve = generateWavefoldCurve(drive, this.params.folds);
          break;
        case 'bitcrush':
          curve = generateBitcrushCurve(drive, this.params.bits);
          break;
        case 'tape':
          curve = generateTapeCurve(drive);
          break;
        case 'soft':
        default:
          curve = generateSoftCurve(drive);
          break;
      }

      this.waveshaper.curve = curve;
    }

    /**
     * Handle parameter updates
     */
    updateParam(name, value) {
      switch (name) {
        case 'drive':
          this.params.drive = Math.max(0, Math.min(100, value));
          this.updateDrive();
          break;
        case 'tone':
          this.params.tone = Math.max(200, Math.min(8000, value));
          this.updateTone();
          break;
        case 'type':
          if (['soft', 'hard', 'fuzz', 'tube', 'wavefold', 'bitcrush', 'tape'].includes(value)) {
            this.params.type = value;
            this.updateType();
          }
          break;
        case 'folds':
          // Wavefolder parameter: number of folds (1-8)
          this.params.folds = Math.max(1, Math.min(8, Math.round(value)));
          if (this.params.type === 'wavefold') {
            this.updateType();
          }
          break;
        case 'bits':
          // Bitcrusher parameter: bit depth (1-16)
          this.params.bits = Math.max(1, Math.min(16, Math.round(value)));
          if (this.params.type === 'bitcrush') {
            this.updateType();
          }
          break;
      }
    }

    /**
     * Clean up audio nodes
     */
    dispose() {
      super.dispose();
      this.preGain.disconnect();
      this.waveshaper.disconnect();
      this.toneFilter.disconnect();
      this.postGain.disconnect();
    }
  }

  // Register the effect in the SynthLab namespace
  SL.effects.Distortion = DistortionEffect;

})();
