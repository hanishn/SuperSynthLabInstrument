// Synth Lab - Soft Clipper Effect
// Warm analog-style limiting/saturation for transparent dynamics control

(function() {
  var SL = window.SynthLab;
  var BaseEffect = SL.effects.BaseEffect;

  // Number of samples for waveshaper curves
  var CURVE_SAMPLES = 44100;

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
        // Below threshold: linear pass-through
        y = absX;
      } else if (absX <= thresholdLinear + kneeWidth && kneeWidth > 0) {
        // Knee region: smooth transition using quadratic interpolation
        var kneeStart = thresholdLinear - kneeWidth;
        var t = (absX - kneeStart) / (2 * kneeWidth);

        // Quadratic blend from linear to compressed
        var linearPart = absX;
        var compressedPart = thresholdLinear + (absX - thresholdLinear) * 0.5;
        y = linearPart + (compressedPart - linearPart) * t * t;
      } else {
        // Above threshold: soft saturation using tanh
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

      // Input gain for threshold adjustment
      this.inputGain = ctx.createGain();

      // Waveshaper for soft clipping
      this.waveshaper = ctx.createWaveShaper();
      this.waveshaper.oversample = '4x'; // Reduce aliasing artifacts

      // Output gain for makeup gain and level matching
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
