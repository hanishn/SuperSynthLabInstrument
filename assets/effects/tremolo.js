// Synth Lab - Tremolo Effect [FX-043]
// Creates amplitude modulation using an LFO connected to a GainNode
//
// --- What is tremolo? ---
// Tremolo is periodic variation of a signal's amplitude (volume) at a
// sub-audio rate, typically 1-10 Hz. The mathematical model is:
//   output(t) = input(t) * (1 - depth + depth * lfo(t))
// where lfo(t) oscillates between 0 and 1. At depth=100% the signal
// swings from silence to full volume; at depth=0% there is no effect.
//
// --- LFO shapes and their character ---
//   Sine:     smooth, organic pulsing (classic amp tremolo)
//   Triangle: linear ramps up/down, slightly more "mechanical" than sine
//   Square:   abrupt on/off gating — choppy, rhythmic, used in trance gates
//
// --- Tremolo vs. vibrato vs. ring modulation ---
// Tremolo modulates amplitude; vibrato modulates pitch (frequency).
// When the modulation rate exceeds ~20 Hz, amplitude modulation produces
// audible sidebands and is called ring modulation — a distinctly
// different, metallic effect.
//
// --- Classic hardware ---
// The Fender Twin Reverb's "vibrato" channel is actually tremolo (amplitude
// modulation via a photocell/LDR optocoupler). The Wurlitzer electric piano
// has built-in tremolo that defines its signature sound.
//
// Reference: Roads, C. (1996) The Computer Music Tutorial, MIT Press, Ch. 6
//
// Spec: Rate 0.5-20 Hz (default 5), Depth 0-100% (default 50),
//        Shape sine/square/triangle (default sine), Mix 0-100% (default 100).

(function() {
  var SL = window.SynthLab = window.SynthLab || {};
  SL.effects = SL.effects || {};
  var BaseEffect = SL.effects.BaseEffect;

  // ---------------------------------------------------------------------------
  // Signal flow
  // ---------------------------------------------------------------------------
  // The Web Audio API lets us modulate a GainNode's gain parameter directly
  // with an OscillatorNode (LFO). The LFO output (-1 to +1) is scaled by
  // lfoGain and added to tremoloGain's base value, producing the amplitude
  // envelope. No sample-level scripting is needed — the browser's native
  // audio graph handles it at full sample rate with zero main-thread cost.
  // ---------------------------------------------------------------------------

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
      // This is what the LFO modulates to create the tremolo effect.
      // Its .gain AudioParam receives the summed LFO signal, so the
      // effective gain at any moment is: baseGain + lfoGain * lfo(t).
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
      var depthNormalized = depth / 100;
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
      var currentTime = this.ctx.currentTime;

      switch (name) {
        case 'rate':
          // Clamp rate to valid range
          var rate = Math.max(0.5, Math.min(20, value));
          this.params.rate = rate;
          this.lfo.frequency.setTargetAtTime(rate, currentTime, 0.01);
          break;

        case 'depth':
          // Clamp depth to valid range
          var depth = Math.max(0, Math.min(100, value));
          this.params.depth = depth;
          this.updateDepth(depth);
          break;

        case 'shape':
          // Validate shape — only native OscillatorNode types that map to
          // musically useful tremolo characters. 'sawtooth' is omitted
          // because asymmetric AM produces a less natural tremolo feel.
          var validShapes = ['sine', 'square', 'triangle'];
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
      } catch (e) { /* LFO may not have started yet */ }
      this.lfo.disconnect();
      this.lfoGain.disconnect();
      this.tremoloGain.disconnect();
      super.dispose();
    }
  }

  // Export to SynthLab namespace
  SL.effects.TremoloEffect = TremoloEffect;

})();
