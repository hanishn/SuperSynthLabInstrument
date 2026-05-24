// Synth Lab - Ring Modulator Effect
// Creates metallic, robotic synthwave sounds by multiplying input signal with a carrier oscillator

(function() {
  const SL = window.SynthLab = window.SynthLab || {};
  SL.effects = SL.effects || {};
  const BaseEffect = SL.effects.BaseEffect;

  /**
   * RingModEffect - Ring modulation via carrier oscillator multiplication
   *
   * Ring modulation multiplies the input signal by a carrier oscillator,
   * creating sum and difference frequencies that produce metallic, robotic tones.
   *
   * Parameters:
   * - frequency: 20-2000 Hz (carrier oscillator frequency, default 440)
   * - shape: 'sine', 'square', 'triangle' (carrier waveform, default 'sine')
   * - lfoRate: 0-10 Hz (frequency modulation rate, default 0)
   * - lfoDepth: 0-100 (frequency modulation depth percentage, default 0)
   * - mix: 0-100 (inherited wet/dry mix, default 50)
   */
  class RingModEffect extends BaseEffect {
    constructor(ctx) {
      super(ctx, 'ringmod');

      // Default parameters
      this.params.frequency = 440;     // Hz (carrier frequency)
      this.params.shape = 'sine';      // sine, square, triangle
      this.params.lfoRate = 0;         // Hz (frequency modulation rate)
      this.params.lfoDepth = 0;        // 0-100 (frequency modulation depth)
      this.params.mix = 50;            // 0-100

      // Create the ring modulation gain node
      // This is what the carrier oscillator modulates to multiply the signal
      // The carrier oscillates the gain between -1 and 1, creating ring modulation
      this.ringGain = ctx.createGain();
      this.ringGain.gain.value = 0; // Will be modulated by carrier

      // Create carrier oscillator (the modulator)
      this.carrier = ctx.createOscillator();
      this.carrier.type = this.params.shape;
      this.carrier.frequency.value = this.params.frequency;

      // Create carrier gain to scale oscillator output
      // Oscillator outputs -1 to 1, which is perfect for ring modulation
      this.carrierGain = ctx.createGain();
      this.carrierGain.gain.value = 1; // Full modulation depth

      // Connect carrier -> carrierGain -> ringGain.gain
      // This modulates the gain of ringGain, effectively multiplying the input
      this.carrier.connect(this.carrierGain);
      this.carrierGain.connect(this.ringGain.gain);

      // Create LFO for frequency modulation of the carrier
      this.lfo = ctx.createOscillator();
      this.lfo.type = 'sine';
      this.lfo.frequency.value = this.params.lfoRate;

      // LFO depth gain - scales LFO output to modulate carrier frequency
      // Maps lfoDepth percentage to Hz variation
      this.lfoGain = ctx.createGain();
      this.updateLfoDepth(this.params.lfoDepth);

      // Connect LFO -> lfoGain -> carrier.frequency
      this.lfo.connect(this.lfoGain);
      this.lfoGain.connect(this.carrier.frequency);

      // Connect wet path: input -> ringGain -> wetGain
      this.input.connect(this.ringGain);
      this.ringGain.connect(this.wetGain);

      // Start oscillators
      this.carrier.start();
      this.lfo.start();
      // Effect starts in bypass mode (enabled=false, wetGain=0) via BaseEffect
    }

    /**
     * Update the LFO depth for frequency modulation
     * Maps 0-100 depth to a percentage of the carrier frequency
     * At depth=100, the carrier frequency varies by +/- 50% of its base value
     */
    updateLfoDepth(depth) {
      const depthNormalized = depth / 100;
      // LFO modulates carrier frequency by up to 50% of the base frequency
      const modulationRange = this.params.frequency * 0.5 * depthNormalized;
      this.lfoGain.gain.setTargetAtTime(modulationRange, this.ctx.currentTime, 0.01);
    }

    /**
     * Handle parameter updates
     */
    updateParam(name, value) {
      const currentTime = this.ctx.currentTime;

      switch (name) {
        case 'frequency':
          // Clamp frequency to valid range
          const freq = Math.max(20, Math.min(2000, value));
          this.params.frequency = freq;
          this.carrier.frequency.setTargetAtTime(freq, currentTime, 0.01);
          // Update LFO depth since it's relative to carrier frequency
          this.updateLfoDepth(this.params.lfoDepth);
          break;

        case 'shape':
          // Validate shape
          const validShapes = ['sine', 'square', 'triangle'];
          if (validShapes.includes(value)) {
            this.params.shape = value;
            this.carrier.type = value;
          }
          break;

        case 'lfoRate':
          // Clamp LFO rate to valid range
          const rate = Math.max(0, Math.min(10, value));
          this.params.lfoRate = rate;
          this.lfo.frequency.setTargetAtTime(rate, currentTime, 0.01);
          break;

        case 'lfoDepth':
          // Clamp LFO depth to valid range
          const depth = Math.max(0, Math.min(100, value));
          this.params.lfoDepth = depth;
          this.updateLfoDepth(depth);
          break;
      }
    }

    /**
     * Clean up all audio nodes
     */
    dispose() {
      try {
        this.carrier.stop();
        this.lfo.stop();
      } catch (e) {
        // Oscillators might not have started
      }
      this.carrier.disconnect();
      this.carrierGain.disconnect();
      this.lfo.disconnect();
      this.lfoGain.disconnect();
      this.ringGain.disconnect();
      super.dispose();
    }
  }

  // Export to SynthLab namespace
  SL.effects.RingModEffect = RingModEffect;

})();
