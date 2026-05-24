// Synth Lab - Dimension Effect
// Roland Dimension D style chorus/ensemble - classic 80s sound
// Uses multiple delay lines with subtle LFO modulation for a lush, wide stereo chorus

(function() {
  const SL = window.SynthLab;
  const BaseEffect = SL.effects.BaseEffect;

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
      this.modePresets = {
        1: { depth: 0.0015, rates: [0.5, 0.63], delays: [0.005, 0.007] },
        2: { depth: 0.0025, rates: [0.45, 0.57, 0.71], delays: [0.006, 0.008, 0.010] },
        3: { depth: 0.0035, rates: [0.4, 0.53, 0.67, 0.83], delays: [0.007, 0.009, 0.011, 0.013] },
        4: { depth: 0.0045, rates: [0.35, 0.47, 0.61, 0.79], delays: [0.008, 0.010, 0.012, 0.015] }
      };

      // Stereo processing nodes
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

      const preset = this.modePresets[this.params.mode] || this.modePresets[2];
      const spreadValue = this.params.spread / 100;
      const rateMultiplier = this.params.rate;

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
      const numDelays = preset.delays.length;
      this.outputMixer.gain.value = 0.6 / Math.sqrt(numDelays);
    }

    /**
     * Create a bank of delay lines with LFO modulation
     */
    createDelayBank(preset, rateMultiplier, channel, spreadValue, invertPhase) {
      const ctx = this.ctx;
      const delays = [];
      const numDelays = preset.delays.length;

      for (let i = 0; i < numDelays; i++) {
        // Base delay time with slight offset per channel for stereo effect
        const baseDelay = preset.delays[i] + (channel * 0.001 * spreadValue);

        // Create delay node
        const delay = ctx.createDelay(0.1);
        delay.delayTime.value = baseDelay;

        // Create LFO with rate from preset, multiplied by master rate
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';

        // Slightly detune LFO rates between channels for width
        const channelRateOffset = channel === 0 ? 0.97 : 1.03;
        lfo.frequency.value = preset.rates[i] * rateMultiplier * channelRateOffset;

        // LFO gain controls modulation depth
        const lfoGain = ctx.createGain();
        // Invert modulation for one channel to create the "dimension" stereo effect
        const phaseMultiplier = invertPhase && (i % 2 === 0) ? -1 : 1;
        lfoGain.gain.value = preset.depth * phaseMultiplier;

        // Connect LFO to delay time
        lfo.connect(lfoGain);
        lfoGain.connect(delay.delayTime);

        // Input gain for this delay tap
        const inputGain = ctx.createGain();
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
      delays.forEach(d => {
        d.delay.connect(this.merger, 0, mergerChannel);
      });
    }

    /**
     * Clean up delay nodes
     */
    disposeDelays() {
      const cleanupBank = (bank) => {
        if (bank && bank.delays) {
          bank.delays.forEach(d => {
            try {
              d.lfo.stop();
            } catch (e) {
              // LFO might not have started
            }
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
      } catch (e) {
        // Might not be connected
      }
    }

    /**
     * Handle parameter updates
     */
    updateParam(name, value) {
      const currentTime = this.ctx.currentTime;

      switch (name) {
        case 'mode':
          // Clamp mode to 1-4
          const mode = Math.max(1, Math.min(4, Math.round(value)));
          if (mode !== this.params.mode) {
            this.params.mode = mode;
            this.initializeDelayNetwork();
          }
          break;

        case 'spread':
          // Update spread requires reinitializing for stereo offsets
          const spread = Math.max(0, Math.min(100, value));
          if (spread !== this.params.spread) {
            this.params.spread = spread;
            this.initializeDelayNetwork();
          }
          break;

        case 'rate':
          // Update LFO rates for all delay lines
          const rate = Math.max(0.1, Math.min(2, value));
          this.params.rate = rate;
          const preset = this.modePresets[this.params.mode];

          // Update left channel LFOs
          this.leftChannel.delays.forEach((d, i) => {
            const newRate = preset.rates[i] * rate * 0.97;
            d.lfo.frequency.setTargetAtTime(newRate, currentTime, 0.02);
          });

          // Update right channel LFOs
          this.rightChannel.delays.forEach((d, i) => {
            const newRate = preset.rates[i] * rate * 1.03;
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
