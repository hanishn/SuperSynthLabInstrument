// Synth Lab - Soft Clipper Effect [FX-031]
// Warm analog-style limiting/saturation for transparent dynamics control
//
// --- What is soft clipping? ---
// Soft clipping is a form of dynamic range compression where signal peaks
// are gradually rounded off rather than abruptly cut (hard clipping).
// The transfer function has three regions:
//   1. Linear region (below threshold): signal passes through unchanged.
//   2. Knee region: a smooth polynomial curve transitions from linear to
//      compressed. A wider knee = gentler, more transparent compression.
//   3. Saturation region (above threshold): output approaches a ceiling
//      asymptotically via tanh, never exceeding it.
//
// --- Why soft clip instead of hard clip? ---
// Hard clipping at a threshold creates a sharp corner in the waveform,
// which generates dense odd harmonics (3rd, 5th, 7th...) that sound harsh.
// Soft clipping rounds the corner with a quadratic/polynomial knee, producing
// fewer and lower-amplitude harmonics — a warmer, more "analog" character.
// This is closer to how vacuum tubes and analog circuits naturally saturate.
//
// --- 4x oversampling ---
// Any nonlinear waveshaping creates harmonics that can exceed the Nyquist
// frequency, folding back as inharmonic aliasing artifacts. 4x oversampling
// processes the signal at 4x the sample rate, pushes aliasing products well
// above the audible range, then filters them out on downsample.
//
// Reference: Zolzer, U. (2011) DAFX: Digital Audio Effects, Wiley, Ch. 5
//
// Spec: Threshold -12 to 0 dB (default -6), Knee 0-100% (default 50),
//        Ceiling -6 to 0 dB (default -0.5, step 0.1), Mix 0-100% (default 100).

(function() {
  var SL = window.SynthLab;
  var BaseEffect = SL.effects.BaseEffect;

  // Number of samples for waveshaper curves
  var CURVE_SAMPLES = 44100;

  // ---------------------------------------------------------------------------
  // Waveshaper curve generation
  // ---------------------------------------------------------------------------
  // The curve maps every possible input amplitude to an output amplitude.
  // It is computed once whenever parameters change and stored in the
  // WaveShaperNode, which applies it per-sample at audio rate with zero
  // main-thread cost.
  // ---------------------------------------------------------------------------

  /**
   * Generate a soft clipping curve with adjustable knee
   * Uses tanh-based saturation for warm, analog-like limiting
   *
   * @param {number} threshold - Threshold in dB (-12 to 0)
   * @param {number} knee - Knee softness percentage (0-100)
   * @param {number} ceiling - Output ceiling in dB (-6 to 0)
   */
  function generateSoftClipCurve(threshold, knee, ceiling) {
    var curve = new Float32Array(CURVE_SAMPLES);

    // Convert dB values to linear
    var thresholdLinear = Math.pow(10, threshold / 20);
    var ceilingLinear = Math.pow(10, ceiling / 20);

    // Knee width in linear scale (0 = hard knee, higher = softer)
    var kneeWidth = (knee / 100) * thresholdLinear * 0.5;

    for (var i = 0; i < CURVE_SAMPLES; i++) {
      // Input value from -1 to 1
      var x = (i * 2 / CURVE_SAMPLES) - 1;
      var absX = Math.abs(x);
      var sign = x >= 0 ? 1 : -1;

      var y;

      if (absX <= thresholdLinear - kneeWidth) {
        // Region 1 — below threshold: unity gain pass-through.
        // Signal is untouched, preserving full dynamics.
        y = absX;
      } else if (absX <= thresholdLinear + kneeWidth && kneeWidth > 0) {
        // Region 2 — knee: quadratic interpolation smoothly blends
        // from linear (slope=1) to compressed (slope<1). The parameter
        // t goes from 0 at knee start to 1 at knee end; t^2 weighting
        // ensures the first derivative is continuous (no audible click).
        var kneeStart = thresholdLinear - kneeWidth;
        var t = (absX - kneeStart) / (2 * kneeWidth);

        // Quadratic blend from linear to compressed
        var linearPart = absX;
        var compressedPart = thresholdLinear + (absX - thresholdLinear) * 0.5;
        y = linearPart + (compressedPart - linearPart) * t * t;
      } else {
        // Region 3 — above threshold: tanh soft saturation.
        // Scale input to drive the tanh harder for more compression
        var excess = absX - thresholdLinear;
        var driveAmount = 2 + (1 - thresholdLinear) * 3; // More drive for lower thresholds

        // Tanh-based soft saturation
        var saturated = Math.tanh(excess * driveAmount);
        var headroom = ceilingLinear - thresholdLinear;

        // Map the saturated signal to the available headroom
        y = thresholdLinear + saturated * headroom;
      }

      // Apply ceiling and preserve sign
      y = Math.min(y, ceilingLinear);
      curve[i] = sign * y;
    }

    return curve;
  }

  /**
   * Soft Clipper Effect
   * Provides warm, analog-style limiting and saturation
   * Gentler than distortion - meant for transparent limiting
   *
   * Parameters:
   * - threshold: -12 to 0 dB (level at which soft clipping begins)
   * - knee: 0-100% (softness of the transition into limiting)
   * - ceiling: -6 to 0 dB (maximum output level)
   * - mix: 0-100 (wet/dry mix, inherited from BaseEffect)
   */
  class SoftClipEffect extends BaseEffect {
    constructor(ctx) {
      super(ctx, 'softclip');

      // Input gain for threshold adjustment.
      // Boosting the input drives more of the signal into the waveshaper's
      // nonlinear region, controlling how aggressively clipping engages.
      this.inputGain = ctx.createGain();

      // Waveshaper for soft clipping.
      // The curve encodes the entire clipping behavior — threshold, knee,
      // and ceiling are all "baked in" to the lookup table.
      this.waveshaper = ctx.createWaveShaper();
      this.waveshaper.oversample = '4x'; // Reduce aliasing artifacts

      // Output gain for makeup gain and level matching.
      // Limiting reduces peak levels, so makeup gain restores perceived loudness.
      this.outputGain = ctx.createGain();

      // Signal chain: input -> inputGain -> waveshaper -> outputGain -> wetGain
      this.input.connect(this.inputGain);
      this.inputGain.connect(this.waveshaper);
      this.waveshaper.connect(this.outputGain);
      this.outputGain.connect(this.wetGain);

      // Set default parameters
      this.params = {
        threshold: -6,    // dB, moderate threshold
        knee: 50,         // 50% knee softness
        ceiling: -0.5,    // dB, slight headroom
        mix: 50
      };

      // Apply defaults
      this.updateCurve();
      this.updateGains();
    }

    /**
     * Update the waveshaper curve based on current parameters
     */
    updateCurve() {
      var curve = generateSoftClipCurve(
        this.params.threshold,
        this.params.knee,
        this.params.ceiling
      );
      this.waveshaper.curve = curve;
    }

    /**
     * Update input/output gains for level matching
     */
    updateGains() {
      // Input gain: boost signal to hit the threshold appropriately
      // Lower thresholds need more input gain to maintain perceived loudness
      var thresholdBoost = Math.pow(10, -this.params.threshold / 40);
      this.inputGain.gain.setTargetAtTime(thresholdBoost, this.ctx.currentTime, 0.01);

      // Output gain: compensate for limiting and apply makeup gain
      // This helps maintain consistent output level
      var makeupGain = Math.pow(10, -this.params.ceiling / 20) * 0.9;
      this.outputGain.gain.setTargetAtTime(makeupGain, this.ctx.currentTime, 0.01);
    }

    /**
     * Handle parameter updates
     */
    updateParam(name, value) {
      switch (name) {
        case 'threshold':
          this.params.threshold = Math.max(-12, Math.min(0, value));
          this.updateCurve();
          this.updateGains();
          break;
        case 'knee':
          this.params.knee = Math.max(0, Math.min(100, value));
          this.updateCurve();
          break;
        case 'ceiling':
          this.params.ceiling = Math.max(-6, Math.min(0, value));
          this.updateCurve();
          this.updateGains();
          break;
      }
    }

    /**
     * Clean up audio nodes
     */
    dispose() {
      super.dispose();
      this.inputGain.disconnect();
      this.waveshaper.disconnect();
      this.outputGain.disconnect();
    }
  }

  // Register the effect in the SynthLab namespace
  SL.effects.SoftClipEffect = SoftClipEffect;

})();
