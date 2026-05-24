// Synth Lab - Tremolo Effect
// Creates amplitude modulation using an LFO connected to a GainNode

(function() {
  const SL = window.SynthLab = window.SynthLab || {};
  SL.effects = SL.effects || {};
  const BaseEffect = SL.effects.BaseEffect;

  /**
   * TremoloEffect - Amplitude modulation via LFO
   *
   * Parameters:
   * - rate: 0.5-20 Hz (LFO speed, default 5)
   * - depth: 0-100 (modulation depth percentage, default 50)
   * - shape: 'sine', 'square', 'triangle' (LFO waveform, default 'sine')
   * - mix: 0-100 (inherited wet/dry mix, default 100)
   */
  class TremoloEffect extends BaseEffect {
    constructor(ctx) {
      super(ctx, 'tremolo');

      // Default parameters
      this.params.rate = 5;          // Hz
      this.params.depth = 50;        // 0-100
      this.params.shape = 'sine';    // sine, square, triangle
      this.params.mix = 100;         // 0-100

      // Create the tremolo gain node (amplitude modulator)
      // This is what the LFO modulates to create the tremolo effect
      this.tremoloGain = ctx.createGain();
      this.tremoloGain.gain.value = 1;

      // Create LFO oscillator
      this.lfo = ctx.createOscillator();
      this.lfo.type = this.params.shape;
      this.lfo.frequency.value = this.params.rate;

      // Create LFO depth gain
      // The LFO outputs -1 to 1, we need to scale and offset it
      // For tremolo: gain should oscillate between (1 - depth) and 1
      // We use a gain node to scale the LFO output
      this.lfoGain = ctx.createGain();
      this.updateDepth(this.params.depth);

      // Connect LFO -> lfoGain -> tremoloGain.gain
      // This modulates the gain of tremoloGain
      this.lfo.connect(this.lfoGain);
      this.lfoGain.connect(this.tremoloGain.gain);

      // Connect wet path: input -> tremoloGain -> wetGain
      this.input.connect(this.tremoloGain);
      this.tremoloGain.connect(this.wetGain);

      // Start the LFO
      this.lfo.start();
      // Effect starts in bypass mode (enabled=false, wetGain=0) via BaseEffect
    }

    /**
     * Update the depth parameter
     * Depth controls how much the amplitude varies
     * At depth=0: no modulation (gain stays at 1)
     * At depth=100: gain oscillates between 0 and 1
     * At depth=50: gain oscillates between 0.5 and 1
     *
     * LFO output is -1 to 1
     * We want gain to be: 1 - (depth/100) * (1 - lfoOutput) / 2
     * Which simplifies to: 1 - depth/200 + (depth/200) * lfoOutput
     *
     * Base gain = 1 - depth/200
     * LFO scale = depth/200
     */
    updateDepth(depth) {
      const depthNormalized = depth / 100;
      // LFO gain scales the oscillator output
      // Oscillator goes -1 to +1, we want the gain to vary by depthNormalized/2 around center
      this.lfoGain.gain.setTargetAtTime(depthNormalized / 2, this.ctx.currentTime, 0.01);
      // Base gain is 1 - depthNormalized/2, so at LFO=-1, total gain = 1 - depthNormalized
      // and at LFO=+1, total gain = 1
      this.tremoloGain.gain.setTargetAtTime(1 - depthNormalized / 2, this.ctx.currentTime, 0.01);
    }

    /**
     * Handle parameter updates
     */
    updateParam(name, value) {
      const currentTime = this.ctx.currentTime;

      switch (name) {
        case 'rate':
          // Clamp rate to valid range
          const rate = Math.max(0.5, Math.min(20, value));
          this.params.rate = rate;
          this.lfo.frequency.setTargetAtTime(rate, currentTime, 0.01);
          break;

        case 'depth':
          // Clamp depth to valid range
          const depth = Math.max(0, Math.min(100, value));
          this.params.depth = depth;
          this.updateDepth(depth);
          break;

        case 'shape':
          // Validate shape
          const validShapes = ['sine', 'square', 'triangle'];
          if (validShapes.includes(value)) {
            this.params.shape = value;
            this.lfo.type = value;
          }
          break;
      }
    }

    /**
     * Clean up all audio nodes
     */
    dispose() {
      try {
        this.lfo.stop();
      } catch (e) {
        // LFO might not have started
      }
      this.lfo.disconnect();
      this.lfoGain.disconnect();
      this.tremoloGain.disconnect();
      super.dispose();
    }
  }

  // Export to SynthLab namespace
  SL.effects.TremoloEffect = TremoloEffect;

})();
