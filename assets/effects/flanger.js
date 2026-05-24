// Synth Lab - Flanger Effect
// Classic flanger with LFO-modulated delay and feedback

(function() {
  const SL = window.SynthLab;
  const BaseEffect = SL.effects.BaseEffect;

  /**
   * FlangerEffect - LFO-modulated delay with feedback
   *
   * A flanger creates a "jet sweep" sound by mixing the original signal
   * with a delayed copy where the delay time is modulated by an LFO.
   * Feedback creates resonant comb filtering.
   *
   * Signal flow:
   * input --+---> delayNode ----+---> wetGain
   *         |        ^          |
   *         |        |          v
   *         |   delayTime <-- LFO (via depthGain)
   *         |        |          |
   *         |        +-- feedbackGain <-+
   *         |
   *         +---> (dry path handled by BaseEffect)
   *
   * Parameters:
   * - rate: 0.05-5 Hz (LFO speed)
   * - depth: 0-100 (modulation depth, maps to ~0-5ms delay sweep)
   * - feedback: -95 to +95% (negative for hollow, positive for resonant)
   * - delay: 1-20 ms (base delay time)
   * - mix: 0-100 (inherited from BaseEffect)
   */
  class FlangerEffect extends BaseEffect {
    constructor(ctx) {
      super(ctx, 'flanger');

      // Create delay node - short max delay for flanger (50ms is plenty)
      this.delayNode = ctx.createDelay(0.05);
      this.delayNode.delayTime.value = 0.005; // Default 5ms base delay

      // Create feedback gain (supports both positive and negative values)
      this.feedbackGain = ctx.createGain();
      this.feedbackGain.gain.value = 0.5; // Default 50%

      // Create LFO (oscillator for modulation)
      this.lfo = ctx.createOscillator();
      this.lfo.type = 'sine';
      this.lfo.frequency.value = 0.5; // Default 0.5 Hz

      // Create depth gain to control LFO intensity
      // LFO output is -1 to +1, depth gain scales this to the delay sweep amount
      this.depthGain = ctx.createGain();
      this.depthGain.gain.value = 0.002; // Default ~2ms sweep (depth 40%)

      // Connect the delay signal flow:
      // input -> delayNode -> wetGain
      this.input.connect(this.delayNode);
      this.delayNode.connect(this.wetGain);

      // Feedback loop: delayNode output -> feedbackGain -> delayNode input
      this.delayNode.connect(this.feedbackGain);
      this.feedbackGain.connect(this.delayNode);

      // LFO modulation: lfo -> depthGain -> delayTime
      this.lfo.connect(this.depthGain);
      this.depthGain.connect(this.delayNode.delayTime);

      // Start the LFO
      this.lfo.start();

      // Initialize parameters
      this.params = {
        rate: 0.5,      // 0.5 Hz LFO speed
        depth: 40,      // 40% modulation depth (~2ms sweep)
        feedback: 50,   // 50% feedback
        delay: 5,       // 5ms base delay
        mix: 50         // 50% wet/dry mix
      };
    }

    /**
     * Handle parameter updates
     */
    updateParam(name, value) {
      const now = this.ctx.currentTime;

      switch (name) {
        case 'rate':
          // LFO frequency: 0.05-5 Hz
          const rateHz = Math.max(0.05, Math.min(5, value));
          this.lfo.frequency.setTargetAtTime(rateHz, now, 0.01);
          break;

        case 'depth':
          // Depth 0-100 maps to 0-5ms of delay sweep
          // The LFO outputs -1 to +1, so depthGain determines the sweep range
          const depthNormalized = Math.max(0, Math.min(100, value)) / 100;
          const sweepAmount = depthNormalized * 0.005; // Max 5ms sweep
          this.depthGain.gain.setTargetAtTime(sweepAmount, now, 0.01);
          break;

        case 'feedback':
          // Feedback -95 to +95% (allow negative for different tonal character)
          // Negative feedback creates a hollow, nasal sound
          // Positive feedback creates a resonant, jet-like sound
          const feedbackValue = Math.max(-0.95, Math.min(0.95, value / 100));
          this.feedbackGain.gain.setTargetAtTime(feedbackValue, now, 0.01);
          break;

        case 'delay':
          // Base delay time: 1-20 ms
          // This sets the center point around which the LFO modulates
          const delayMs = Math.max(1, Math.min(20, value));
          const delaySeconds = delayMs / 1000;
          this.delayNode.delayTime.setTargetAtTime(delaySeconds, now, 0.01);
          break;
      }
    }

    /**
     * Clean up audio nodes
     */
    dispose() {
      this.lfo.stop();
      this.lfo.disconnect();
      this.depthGain.disconnect();
      this.delayNode.disconnect();
      this.feedbackGain.disconnect();
      super.dispose();
    }
  }

  // Export to SynthLab namespace
  SL.effects.Flanger = FlangerEffect;

})();
