// Synth Lab - 3-Band Parametric EQ Effect
// Low shelf, mid peaking, high shelf filters in series
//
// -----------------------------------------------------------------------
// EDUCATIONAL OVERVIEW: Parametric Equalization
// -----------------------------------------------------------------------
// A parametric EQ allows precise tonal shaping by boosting or cutting
// specific frequency regions. Each band has three controls:
//   Frequency: the center (or corner) frequency of the filter.
//   Gain:      how much to boost (+) or cut (-) at that frequency, in dB.
//   Q:         bandwidth control (mid band only). Higher Q = narrower band.
//              Q of 1 is moderately wide; Q of 10 is a tight surgical notch.
//
// This implementation uses three Web Audio BiquadFilterNodes in series:
//   1. Low shelf  -- boosts/cuts everything below its corner frequency.
//   2. Peaking    -- boosts/cuts a bell-shaped region around center freq.
//   3. High shelf -- boosts/cuts everything above its corner frequency.
//
// The BiquadFilterNode computes biquad IIR coefficients internally using
// the formulas from the Audio EQ Cookbook by Robert Bristow-Johnson, which
// derives exact coefficient values for all standard filter types (lowpass,
// highpass, peaking, shelving, etc.) from analog prototypes via the
// bilinear transform.
//
// Series connection means the output of one filter feeds the input of the
// next: input -> low -> mid -> high -> output. Each filter's effect
// accumulates, so boosting low +6 dB and cutting mid -3 dB both apply.
//
// References:
//   Bristow-Johnson, R. "Audio EQ Cookbook"
//     (https://www.w3.org/2011/audio/audio-eq-cookbook.html)
//   Zolzer, U. (2011) DAFX: Digital Audio Effects, Wiley, Ch. 2
//
// Feature spec: [FX-063] EQ
// -----------------------------------------------------------------------

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
      // Lowshelf: boosts/cuts all frequencies below the corner frequency.
      // Peaking:  bell-shaped boost/cut centered on frequency, width set by Q.
      // Highshelf: boosts/cuts all frequencies above the corner frequency.
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
     * Update a parameter on the filter nodes.
     *
     * setTargetAtTime with time constant 0.01 smoothly ramps the parameter
     * to avoid discontinuities (clicks/pops) when adjusting EQ in real time.
     * Gain values are in dB; frequency in Hz; Q is dimensionless.
     */
    updateParam(name, value) {
      var now = this.ctx.currentTime;

      switch (name) {
        case 'lowGain':
          // Low shelf gain in dB (-12 to +12)
          this.lowFilter.gain.setTargetAtTime(value, now, 0.01);
          break;
        case 'lowFreq':
          // Low shelf corner frequency (60-500 Hz)
          this.lowFilter.frequency.setTargetAtTime(value, now, 0.01);
          break;
        case 'midGain':
          // Mid peaking gain in dB (-12 to +12)
          this.midFilter.gain.setTargetAtTime(value, now, 0.01);
          break;
        case 'midFreq':
          // Mid peaking center frequency (200-5000 Hz)
          this.midFilter.frequency.setTargetAtTime(value, now, 0.01);
          break;
        case 'midQ':
          // Q factor: higher = narrower bandwidth (0.5 = wide, 10 = surgical)
          this.midFilter.Q.setTargetAtTime(value, now, 0.01);
          break;
        case 'highGain':
          // High shelf gain in dB (-12 to +12)
          this.highFilter.gain.setTargetAtTime(value, now, 0.01);
          break;
        case 'highFreq':
          // High shelf corner frequency (2000-12000 Hz)
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
