// Synth Lab - Dimension Effect
// Roland Dimension D style chorus/ensemble - classic 80s sound
// Uses multiple delay lines with subtle LFO modulation for a lush, wide stereo chorus
//
// ---------------------------------------------------------------------------
// DSP THEORY: Roland Dimension D (SDD-320) Emulation
// ---------------------------------------------------------------------------
// The Roland SDD-320 Dimension D (1979) is a studio chorus unit prized for
// its ability to add width and depth without the obvious pitch warble of
// conventional chorus effects. Its design philosophy:
//
//   1. Multiple BBD (Bucket Brigade Delay) delay lines per channel, each
//      with its own LFO rate and depth -- NOT a single modulated delay.
//   2. Very slow modulation rates (0.3-0.8 Hz) with small depth (1-5 ms).
//   3. Phase inversion between left and right channels on alternating taps,
//      creating stereo width from decorrelation rather than pitch shift.
//   4. Four preset modes selected by front-panel buttons (no knobs):
//        Mode 1 (I)    -- Subtle, tight. 2 delay taps, minimal depth.
//        Mode 2 (II)   -- Moderate. 3 taps, balanced depth and rate.
//        Mode 3 (III)  -- Rich. 4 taps, increased modulation depth.
//        Mode 4 (I+II) -- Full ensemble. Both chorus circuits combined.
//                         Maximum width and density.
//
// The key insight is that multiple decorrelated delay lines at slightly
// different rates produce a dense, smooth chorus that avoids the periodic
// "swoosh" of single-delay chorus effects. The slow rates keep pitch
// deviation imperceptible -- the ear hears spatial enhancement, not
// detuning.
//
// Reference: Dattorro, J. (1997) "Effect Design Part 2: Delay-Line
//   Modulation and Chorus", Journal of the Audio Engineering Society,
//   Vol. 45, No. 10, pp. 764-788
// ---------------------------------------------------------------------------

(function() {
  var SL = window.SynthLab;
  var BaseEffect = SL.effects.BaseEffect;

  /**
   * DimensionEffect - Roland Dimension D style chorus/ensemble
   *
   * The original Dimension D used BBD (Bucket Brigade Delay) chips with
   * multiple modulated delay lines at different rates and depths to create
   * its signature lush, wide chorus without obvious pitch wobble.
   *
   * Parameters:
   * - mode: 1-4 (emulates the D buttons on the original unit)
   *   Mode 1: Subtle, tight chorus - minimal modulation
   *   Mode 2: Moderate chorus - balanced depth and rate
   *   Mode 3: Richer chorus - increased depth
   *   Mode 4: Full ensemble - maximum width and depth
   * - spread: 0-100 (stereo width)
   * - rate: 0.1-2 Hz (master LFO rate multiplier)
   * - mix: 0-100 (inherited wet/dry mix)
   */
  class DimensionEffect extends BaseEffect {
    constructor(ctx) {
      super(ctx, 'dimension');

      // Default parameters
      this.params.mode = 2;       // 1-4
      this.params.spread = 70;    // 0-100
      this.params.rate = 0.5;     // Hz (base rate)
      this.params.mix = 50;       // 0-100

      // Mode presets - based on original Dimension D characteristics
      // Each mode defines different delay times and modulation depths
      // Depth is in seconds (modulation excursion around the base delay).
      // Rates are in Hz (LFO frequencies for each tap). Note that rates are
      // all different and irrational relative to each other -- this prevents
      // the LFOs from aligning and creating periodic "swoosh" artifacts.
      // Delays are base delay times in seconds (5-15 ms range, typical of
      // BBD chorus circuits). More taps = denser, smoother chorus.
      this.modePresets = {
        1: { depth: 0.0015, rates: [0.5, 0.63], delays: [0.005, 0.007] },
        2: { depth: 0.0025, rates: [0.45, 0.57, 0.71], delays: [0.006, 0.008, 0.010] },
        3: { depth: 0.0035, rates: [0.4, 0.53, 0.67, 0.83], delays: [0.007, 0.009, 0.011, 0.013] },
        4: { depth: 0.0045, rates: [0.35, 0.47, 0.61, 0.79], delays: [0.008, 0.010, 0.012, 0.015] }
      };

      // Stereo processing: split to L/R, process independently, merge back.
      // Each channel gets its own delay bank with slightly offset parameters,
      // creating the stereo decorrelation that defines the Dimension D sound.
      this.splitter = ctx.createChannelSplitter(2);
      this.merger = ctx.createChannelMerger(2);

      // Create left and right channel processors
      this.leftChannel = {
        gain: ctx.createGain(),
        delays: []
      };
      this.rightChannel = {
        gain: ctx.createGain(),
        delays: []
      };

      // Output mixer
      this.outputMixer = ctx.createGain();
      this.outputMixer.gain.value = 0.7; // Slight reduction to prevent clipping

      // Connect stereo output path
      this.merger.connect(this.outputMixer);
      this.outputMixer.connect(this.wetGain);

      // Initialize the delay network for current mode
      this.initializeDelayNetwork();
    }

    /**
     * Initialize the multi-tap delay network based on current mode
     */
    initializeDelayNetwork() {
      // Clean up existing delays
      this.disposeDelays();

      var preset = this.modePresets[this.params.mode] || this.modePresets[2];
      var spreadValue = this.params.spread / 100;
      var rateMultiplier = this.params.rate;

      // Split input to stereo
      this.input.connect(this.splitter);

      // Create delay lines for left channel
      this.leftChannel.delays = this.createDelayBank(
        preset,
        rateMultiplier,
        0, // Left channel
        spreadValue,
        true // Invert some phases for left
      );

      // Create delay lines for right channel
      this.rightChannel.delays = this.createDelayBank(
        preset,
        rateMultiplier,
        1, // Right channel
        spreadValue,
        false // Normal phases for right
      );

      // Connect delay banks to merger
      this.connectDelayBank(this.leftChannel.delays, 0);
      this.connectDelayBank(this.rightChannel.delays, 1);

      // Set output gain based on number of delay lines
      // Scale by 1/sqrt(N) to maintain constant perceived loudness as modes
      // add more delay taps. This is the standard equal-power scaling rule
      // for summing uncorrelated signals.
      var numDelays = preset.delays.length;
      this.outputMixer.gain.value = 0.6 / Math.sqrt(numDelays);
    }

    /**
     * Create a bank of delay lines with LFO modulation
     */
    // Each delay tap is: splitter -> inputGain -> delay -> merger.
    // An LFO modulates the delay time, creating the chorus pitch variation.
    // Left and right channels get slightly different LFO rates (0.97x vs
    // 1.03x) so the modulation is decorrelated between ears, widening the
    // stereo image without hard panning.
    createDelayBank(preset, rateMultiplier, channel, spreadValue, invertPhase) {
      var ctx = this.ctx;
      var delays = [];
      var numDelays = preset.delays.length;

      for (var i = 0; i < numDelays; i++) {
        // Base delay time with slight offset per channel for stereo effect
        var baseDelay = preset.delays[i] + (channel * 0.001 * spreadValue);

        // Create delay node
        var delay = ctx.createDelay(0.1);
        delay.delayTime.value = baseDelay;

        // Create LFO with rate from preset, multiplied by master rate
        var lfo = ctx.createOscillator();
        lfo.type = 'sine';

        // Slightly detune LFO rates between channels for width
        var channelRateOffset = channel === 0 ? 0.97 : 1.03;
        lfo.frequency.value = preset.rates[i] * rateMultiplier * channelRateOffset;

        // LFO gain controls modulation depth
        var lfoGain = ctx.createGain();
        // Phase inversion on alternating left-channel taps is the core of the
        // Dimension D stereo trick: when one delay shortens, its counterpart
        // lengthens, pushing energy to opposite sides of the stereo field.
        // This creates width from decorrelation rather than panning.
        var phaseMultiplier = invertPhase && (i % 2 === 0) ? -1 : 1;
        lfoGain.gain.value = preset.depth * phaseMultiplier;

        // Connect LFO to delay time
        lfo.connect(lfoGain);
        lfoGain.connect(delay.delayTime);

        // Input gain for this delay tap
        var inputGain = ctx.createGain();
        inputGain.gain.value = 1;

        // Connect splitter channel to delay
        this.splitter.connect(inputGain, channel);
        inputGain.connect(delay);

        // Start LFO
        lfo.start();

        delays.push({
          delay,
          lfo,
          lfoGain,
          inputGain,
          baseDelay
        });
      }

      return delays;
    }

    /**
     * Connect a delay bank to the stereo merger
     */
    connectDelayBank(delays, mergerChannel) {
      delays.forEach(function(d) {
        d.delay.connect(this.merger, 0, mergerChannel);
      }, this);
    }

    /**
     * Clean up delay nodes
     */
    disposeDelays() {
      var cleanupBank = function(bank) {
        if (bank && bank.delays) {
          bank.delays.forEach(function(d) {
            try {
              d.lfo.stop();
            } catch (e) { /* LFO may not have started yet */ }
            d.lfo.disconnect();
            d.lfoGain.disconnect();
            d.delay.disconnect();
            d.inputGain.disconnect();
          });
          bank.delays = [];
        }
      };

      cleanupBank(this.leftChannel);
      cleanupBank(this.rightChannel);

      // Disconnect splitter from everything
      try {
        this.splitter.disconnect();
      } catch (e) { /* splitter may not be connected */ }
    }

    /**
     * Handle parameter updates
     */
    updateParam(name, value) {
      var currentTime = this.ctx.currentTime;

      switch (name) {
        case 'mode':
          // Clamp mode to 1-4
          // Mode changes require a full delay network rebuild because each
          // mode has a different number of taps with different parameters.
          var mode = Math.max(1, Math.min(4, Math.round(value)));
          if (mode !== this.params.mode) {
            this.params.mode = mode;
            this.initializeDelayNetwork();
          }
          break;

        case 'spread':
          // Update spread requires reinitializing for stereo offsets
          var spread = Math.max(0, Math.min(100, value));
          if (spread !== this.params.spread) {
            this.params.spread = spread;
            this.initializeDelayNetwork();
          }
          break;

        case 'rate':
          // Update LFO rates for all delay lines
          var rate = Math.max(0.1, Math.min(2, value));
          this.params.rate = rate;
          var preset = this.modePresets[this.params.mode];

          // Update left channel LFOs
          this.leftChannel.delays.forEach(function(d, i) {
            var newRate = preset.rates[i] * rate * 0.97;
            d.lfo.frequency.setTargetAtTime(newRate, currentTime, 0.02);
          });

          // Update right channel LFOs
          this.rightChannel.delays.forEach(function(d, i) {
            var newRate = preset.rates[i] * rate * 1.03;
            d.lfo.frequency.setTargetAtTime(newRate, currentTime, 0.02);
          });
          break;
      }
    }

    /**
     * Clean up all audio nodes
     */
    dispose() {
      this.disposeDelays();
      this.splitter.disconnect();
      this.merger.disconnect();
      this.outputMixer.disconnect();
      super.dispose();
    }
  }

  // Export to SynthLab namespace
  SL.effects.DimensionEffect = DimensionEffect;

})();
