// Synth Lab - Compressor Effect
// Dynamic range compressor with parallel compression support
//
// -----------------------------------------------------------------------
// EDUCATIONAL OVERVIEW: Dynamic Range Compression
// -----------------------------------------------------------------------
// A compressor reduces the volume difference between the loudest and
// quietest parts of an audio signal. When the input level exceeds a
// threshold, the compressor attenuates the signal by a ratio. This makes
// the overall dynamic range smaller, which is useful for evening out
// performances, taming transients, and adding sustain.
//
// The core formula for gain reduction (in dB) is:
//   gain_reduction = (input_dB - threshold) * (1 - 1/ratio)
// For example, at 4:1 ratio with threshold -24 dB and input at -20 dB:
//   reduction = (-20 - (-24)) * (1 - 1/4) = 4 * 0.75 = 3 dB of reduction
//
// The Web Audio DynamicsCompressorNode implements a standard feed-forward
// compressor design with automatic makeup gain.
//
// Parallel compression (a.k.a. "New York compression") blends the
// compressed (wet) signal with the uncompressed (dry) signal, preserving
// transient detail while raising quieter elements. The mix parameter
// controls this blend via BaseEffect's wet/dry routing.
//
// References:
//   Giannoulis, D. et al. (2012) "Digital Dynamic Range Compressor
//     Design -- A Tutorial", JAES 60(6)
//   Zolzer, U. (2011) DAFX: Digital Audio Effects, Wiley, Ch. 7
//
// Feature spec: [FX-060] Compressor
// -----------------------------------------------------------------------

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
      // The browser's built-in compressor implements a feed-forward design:
      // it measures input level, computes gain reduction, then applies it.
      this.compressor = ctx.createDynamicsCompressor();

      // Set default values
      // These defaults produce a moderate "glue" compression suitable for
      // general-purpose use: enough ratio to tame peaks without squashing.
      this.compressor.threshold.value = -24;  // dB
      this.compressor.ratio.value = 4;        // ratio
      this.compressor.attack.value = 0.01;    // 10ms in seconds
      this.compressor.release.value = 0.25;   // 250ms in seconds
      this.compressor.knee.value = 10;        // dB — soft knee for gradual onset

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
     *
     * All parameters use setTargetAtTime for zipper-free automation.
     * The time constant 0.01 gives ~30ms to reach 95% of target,
     * fast enough for responsive control but smooth enough to avoid clicks.
     */
    updateParam(name, value) {
      var now = this.ctx.currentTime;

      switch (name) {
        case 'threshold':
          // Clamp to -60 to 0 dB
          // Threshold sets the level above which compression begins.
          // Lower values compress more of the signal's dynamic range.
          var thresholdValue = Math.max(-60, Math.min(0, value));
          this.compressor.threshold.setTargetAtTime(thresholdValue, now, 0.01);
          break;

        case 'ratio':
          // Clamp to 1-20
          // Ratio determines how much the signal is reduced above threshold.
          // 4:1 means 4 dB of input above threshold yields 1 dB of output.
          // 1:1 = no compression; 20:1 approaches limiting behavior.
          var ratioValue = Math.max(1, Math.min(20, value));
          this.compressor.ratio.setTargetAtTime(ratioValue, now, 0.01);
          break;

        case 'attack':
          // Convert ms (0-100) to seconds (0-1)
          // Attack controls how quickly the compressor responds to transients.
          // Shorter attack = catches peaks faster but can dull transient snap.
          // Longer attack = lets transients through, compresses sustained body.
          var attackMs = Math.max(0, Math.min(100, value));
          var attackSeconds = attackMs / 1000;
          this.compressor.attack.setTargetAtTime(attackSeconds, now, 0.01);
          break;

        case 'release':
          // Convert ms (10-1000) to seconds (0.01-1)
          // Release controls how fast the compressor returns to unity gain
          // after the input drops below threshold. Too fast = "pumping" artifact.
          // Too slow = compression lingers and dulls the next transient.
          var releaseMs = Math.max(10, Math.min(1000, value));
          var releaseSeconds = releaseMs / 1000;
          this.compressor.release.setTargetAtTime(releaseSeconds, now, 0.01);
          break;

        case 'knee':
          // Clamp to 0-40 dB
          // Knee controls how gradually compression engages around threshold.
          // 0 dB = hard knee (abrupt, aggressive, good for limiting).
          // Higher values = soft knee (gradual onset, more musical/transparent).
          var kneeValue = Math.max(0, Math.min(40, value));
          this.compressor.knee.setTargetAtTime(kneeValue, now, 0.01);
          break;
      }
    }

    /**
     * Get current gain reduction in dB (useful for metering)
     * Returns a negative value representing how many dB the compressor
     * is currently attenuating. Zero means no compression is active.
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
