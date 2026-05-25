// Synth Lab - Compressor Effect
// Dynamic range compressor with parallel compression support

(function() {
  var SL = window.SynthLab = window.SynthLab || {};
  SL.effects = SL.effects || {};
  var BaseEffect = SL.effects.BaseEffect;

  /**
   * CompressorEffect - Dynamic range compressor
   *
   * Signal flow:
   * input ---> DynamicsCompressorNode ---> wetGain
   *    |
   *    +---> (dry path handled by BaseEffect for parallel compression)
   *
   * Parameters:
   * - threshold: -60 to 0 dB (level above which compression starts)
   * - ratio: 1-20 (compression ratio)
   * - attack: 0-100 ms (attack time, mapped to 0-1 seconds)
   * - release: 10-1000 ms (release time, mapped to 0.01-1 seconds)
   * - knee: 0-40 dB (soft knee width)
   * - mix: 0-100% (parallel compression mix, inherited from BaseEffect)
   */
  class CompressorEffect extends BaseEffect {
    constructor(ctx) {
      super(ctx, 'compressor');

      // Create DynamicsCompressorNode
      this.compressor = ctx.createDynamicsCompressor();

      // Set default values
      this.compressor.threshold.value = -24;  // dB
      this.compressor.ratio.value = 4;        // ratio
      this.compressor.attack.value = 0.01;    // 10ms in seconds
      this.compressor.release.value = 0.25;   // 250ms in seconds
      this.compressor.knee.value = 10;        // dB

      // Connect signal flow: input -> compressor -> wetGain
      this.input.connect(this.compressor);
      this.compressor.connect(this.wetGain);

      // Initialize parameters
      this.params = {
        threshold: -24,   // dB
        ratio: 4,         // compression ratio
        attack: 10,       // ms
        release: 250,     // ms
        knee: 10,         // dB
        mix: 100          // 100% wet (full compression by default)
      };

      // Start in bypass mode
      this.enabled = false;
      this.dryGain.gain.value = 1;
      this.wetGain.gain.value = 0;
    }

    /**
     * Handle parameter updates
     */
    updateParam(name, value) {
      var now = this.ctx.currentTime;

      switch (name) {
        case 'threshold':
          // Clamp to -60 to 0 dB
          var thresholdValue = Math.max(-60, Math.min(0, value));
          this.compressor.threshold.setTargetAtTime(thresholdValue, now, 0.01);
          break;

        case 'ratio':
          // Clamp to 1-20
          var ratioValue = Math.max(1, Math.min(20, value));
          this.compressor.ratio.setTargetAtTime(ratioValue, now, 0.01);
          break;

        case 'attack':
          // Convert ms (0-100) to seconds (0-1)
          var attackMs = Math.max(0, Math.min(100, value));
          var attackSeconds = attackMs / 1000;
          this.compressor.attack.setTargetAtTime(attackSeconds, now, 0.01);
          break;

        case 'release':
          // Convert ms (10-1000) to seconds (0.01-1)
          var releaseMs = Math.max(10, Math.min(1000, value));
          var releaseSeconds = releaseMs / 1000;
          this.compressor.release.setTargetAtTime(releaseSeconds, now, 0.01);
          break;

        case 'knee':
          // Clamp to 0-40 dB
          var kneeValue = Math.max(0, Math.min(40, value));
          this.compressor.knee.setTargetAtTime(kneeValue, now, 0.01);
          break;
      }
    }

    /**
     * Get current gain reduction in dB (useful for metering)
     */
    getReduction() {
      return this.compressor.reduction;
    }

    /**
     * Clean up audio nodes
     */
    dispose() {
      this.compressor.disconnect();
      super.dispose();
    }
  }

  // Export to SynthLab namespace
  SL.effects.CompressorEffect = CompressorEffect;

})();
