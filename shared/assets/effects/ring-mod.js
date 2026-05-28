// Synth Lab - Ring Modulator Effect
// Creates metallic, robotic synthwave sounds by multiplying input signal with a carrier oscillator
//
// ---------------------------------------------------------------------------
// DSP THEORY: Ring Modulation
// ---------------------------------------------------------------------------
// Ring modulation multiplies two signals together. For sine waves:
//
//   cos(a) * cos(b) = 0.5 * [cos(a+b) + cos(a-b)]
//
// The output contains ONLY the sum and difference frequencies -- the original
// frequencies disappear entirely. This is what gives ring mod its distinctive
// inharmonic, metallic character: the output partials have no simple integer
// relationship to the input pitch.
//
// Example: A 440 Hz input ring-modulated by a 300 Hz carrier produces
// 740 Hz (sum) and 140 Hz (difference). Neither is harmonically related
// to the original 440 Hz.
//
// With complex (non-sine) input, every partial in the input generates its
// own sum/difference pair against the carrier, creating dense sidebands.
// Square or triangle carrier waveforms add further harmonics to the carrier
// itself, producing even more sideband pairs.
//
// The LFO slowly modulates the carrier frequency, sweeping the sideband
// frequencies over time for evolving, animated metallic textures.
//
// Reference: Roads, C. (1996) The Computer Music Tutorial, Ch. 6
// ---------------------------------------------------------------------------

(function() {
  var SL = window.SynthLab = window.SynthLab || {};
  SL.effects = SL.effects || {};
  var BaseEffect = SL.effects.BaseEffect;

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

      // Web Audio implementation of ring modulation:
      // We use a GainNode whose gain parameter is modulated by the carrier
      // oscillator. When the input signal passes through a GainNode whose
      // gain oscillates between -1 and +1, the mathematical result is
      // multiplication -- exactly the ring mod equation above.
      this.ringGain = ctx.createGain();
      this.ringGain.gain.value = 0; // Will be modulated by carrier

      // Create carrier oscillator (the modulator)
      // The carrier frequency determines WHERE the sidebands appear.
      // Low carrier (20-100 Hz) = tremolo-like amplitude modulation.
      // Mid carrier (100-500 Hz) = classic ring mod bell/metallic tones.
      // High carrier (500-2000 Hz) = harsh, dissonant sidebands.
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

      // LFO for carrier frequency modulation
      // This slowly sweeps the carrier frequency, which sweeps ALL the
      // sideband frequencies together, creating evolving metallic textures.
      // At rate=0 the carrier is static; at higher rates the sidebands
      // wobble, producing vibrato-like animation of the ring mod timbre.
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
    // The modulation range is proportional to carrier frequency so the
    // perceived depth stays consistent across the frequency range. A fixed
    // Hz range would sound huge at low frequencies and invisible at high ones.
    updateLfoDepth(depth) {
      var depthNormalized = depth / 100;
      // LFO modulates carrier frequency by up to 50% of the base frequency
      var modulationRange = this.params.frequency * 0.5 * depthNormalized;
      this.lfoGain.gain.setTargetAtTime(modulationRange, this.ctx.currentTime, 0.01);
    }

    /**
     * Handle parameter updates
     */
    updateParam(name, value) {
      var currentTime = this.ctx.currentTime;

      switch (name) {
        case 'frequency':
          // Clamp frequency to valid range
          var freq = Math.max(20, Math.min(2000, value));
          this.params.frequency = freq;
          this.carrier.frequency.setTargetAtTime(freq, currentTime, 0.01);
          // LFO depth is recalculated because it is defined as a proportion
          // of carrier frequency -- changing the carrier shifts the range.
          this.updateLfoDepth(this.params.lfoDepth);
          break;

        case 'shape':
          // Validate shape
          var validShapes = ['sine', 'square', 'triangle'];
          if (validShapes.includes(value)) {
            this.params.shape = value;
            this.carrier.type = value;
          }
          break;

        case 'lfoRate':
          // Clamp LFO rate to valid range
          var rate = Math.max(0, Math.min(10, value));
          this.params.lfoRate = rate;
          this.lfo.frequency.setTargetAtTime(rate, currentTime, 0.01);
          break;

        case 'lfoDepth':
          // Clamp LFO depth to valid range
          var depth = Math.max(0, Math.min(100, value));
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
      } catch (e) { /* oscillators may not have started yet */ }
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
