// Synth Lab - Flanger Effect
// Classic flanger with LFO-modulated delay and feedback
//
// -----------------------------------------------------------------------
// EDUCATIONAL NOTES: Flanger — Comb Filter with Swept Delay [FX-042]
// -----------------------------------------------------------------------
// A flanger is a very short modulated delay (1-20ms) WITH feedback.
// The feedback creates a comb filter: the frequency response has peaks
// and notches at harmonics of 1/delay_time. The LFO sweeps the delay,
// moving the comb teeth up and down the spectrum — producing the
// characteristic "jet engine" swoosh.
//
// Transfer function: H(z) = 1 + g * z^(-M)
//   where M is the (modulated) delay in samples, g is feedback gain.
//   Peaks occur at frequencies f_n = n * (sampleRate / M).
//
// Reference:
//   Roads, C. (1996) The Computer Music Tutorial, MIT Press
//   Dattorro, J. (1997) "Effect Design Part 2", JAES 45(10)
//
// History: The effect was discovered by John Lennon and engineer Ken
// Townsend at Abbey Road Studios (1966). They pressed a finger against
// a tape reel flange to slow it, creating a sweeping phase cancellation
// with the other deck's playback. The name "flanging" stuck.
//
// Positive vs negative feedback: Positive feedback reinforces the comb
// peaks (resonant, metallic). Negative feedback inverts the comb pattern,
// turning peaks into notches — a hollow, nasal sound. This is why the
// feedback parameter allows both positive and negative values (-95..+95%).
// -----------------------------------------------------------------------

(function() {
  var SL = window.SynthLab;
  var BaseEffect = SL.effects.BaseEffect;

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
      // Flanger delays are much shorter than chorus (1-20ms vs 5-30ms).
      // At these short delays, the comb filter's first null falls within
      // the audible range (e.g., 5ms delay -> first null at 200Hz).
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
      // This recirculating path is what distinguishes flanging from chorus.
      // Each pass through the delay reinforces the comb filter peaks,
      // making them taller and narrower (more resonant). Higher feedback
      // produces a more metallic, ringing character.
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
      var now = this.ctx.currentTime;

      switch (name) {
        case 'rate':
          // LFO frequency: 0.05-5 Hz
          var rateHz = Math.max(0.05, Math.min(5, value));
          this.lfo.frequency.setTargetAtTime(rateHz, now, 0.01);
          break;

        case 'depth':
          // Depth 0-100 maps to 0-5ms of delay sweep
          // The LFO outputs -1 to +1, so depthGain determines the sweep range
          var depthNormalized = Math.max(0, Math.min(100, value)) / 100;
          var sweepAmount = depthNormalized * 0.005; // Max 5ms sweep
          this.depthGain.gain.setTargetAtTime(sweepAmount, now, 0.01);
          break;

        case 'feedback':
          // Feedback -95 to +95% (allow negative for different tonal character)
          // Negative feedback creates a hollow, nasal sound
          // Positive feedback creates a resonant, jet-like sound
          var feedbackValue = Math.max(-0.95, Math.min(0.95, value / 100));
          this.feedbackGain.gain.setTargetAtTime(feedbackValue, now, 0.01);
          break;

        case 'delay':
          // Base delay time: 1-20 ms
          // This sets the center point around which the LFO modulates
          var delayMs = Math.max(1, Math.min(20, value));
          var delaySeconds = delayMs / 1000;
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
