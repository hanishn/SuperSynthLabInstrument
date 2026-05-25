// Synth Lab - 3-Band Parametric EQ Effect
// Low shelf, mid peaking, high shelf filters in series

(function() {
  var SL = window.SynthLab = window.SynthLab || {};
  SL.effects = SL.effects || {};

  /**
   * EQEffect - 3-band parametric equalizer
   * Uses 3 BiquadFilterNodes in series: lowshelf, peaking (mid), highshelf
   */
  class EQEffect extends SL.effects.BaseEffect {
    constructor(ctx) {
      super(ctx, 'eq');

      // Create 3 BiquadFilterNodes
      this.lowFilter = ctx.createBiquadFilter();
      this.midFilter = ctx.createBiquadFilter();
      this.highFilter = ctx.createBiquadFilter();

      // Configure filter types
      this.lowFilter.type = 'lowshelf';
      this.midFilter.type = 'peaking';
      this.highFilter.type = 'highshelf';

      // Set default parameter values
      this.params = {
        lowGain: 0,      // -12 to +12 dB
        lowFreq: 200,    // 60-500 Hz
        midGain: 0,      // -12 to +12 dB
        midFreq: 1000,   // 200-5000 Hz
        midQ: 1,         // 0.5-10
        highGain: 0,     // -12 to +12 dB
        highFreq: 5000,  // 2000-12000 Hz
        mix: 100         // 0-100%
      };

      // Apply default values to filter nodes
      this.lowFilter.frequency.value = this.params.lowFreq;
      this.lowFilter.gain.value = this.params.lowGain;

      this.midFilter.frequency.value = this.params.midFreq;
      this.midFilter.gain.value = this.params.midGain;
      this.midFilter.Q.value = this.params.midQ;

      this.highFilter.frequency.value = this.params.highFreq;
      this.highFilter.gain.value = this.params.highGain;

      // Connect wet path: input -> low -> mid -> high -> wetGain
      this.input.connect(this.lowFilter);
      this.lowFilter.connect(this.midFilter);
      this.midFilter.connect(this.highFilter);
      this.highFilter.connect(this.wetGain);

      // Set initial mix (100% wet)
      this.setMix(this.params.mix);

      // Start in bypass mode (disabled)
      this.enabled = false;
      this.dryGain.gain.value = 1;
      this.wetGain.gain.value = 0;
    }

    /**
     * Update a parameter on the filter nodes
     */
    updateParam(name, value) {
      var now = this.ctx.currentTime;

      switch (name) {
        case 'lowGain':
          this.lowFilter.gain.setTargetAtTime(value, now, 0.01);
          break;
        case 'lowFreq':
          this.lowFilter.frequency.setTargetAtTime(value, now, 0.01);
          break;
        case 'midGain':
          this.midFilter.gain.setTargetAtTime(value, now, 0.01);
          break;
        case 'midFreq':
          this.midFilter.frequency.setTargetAtTime(value, now, 0.01);
          break;
        case 'midQ':
          this.midFilter.Q.setTargetAtTime(value, now, 0.01);
          break;
        case 'highGain':
          this.highFilter.gain.setTargetAtTime(value, now, 0.01);
          break;
        case 'highFreq':
          this.highFilter.frequency.setTargetAtTime(value, now, 0.01);
          break;
      }
    }

    /**
     * Clean up audio nodes
     */
    dispose() {
      super.dispose();
      this.lowFilter.disconnect();
      this.midFilter.disconnect();
      this.highFilter.disconnect();
    }
  }

  // Export to SynthLab namespace
  SL.effects.EQEffect = EQEffect;

})();
