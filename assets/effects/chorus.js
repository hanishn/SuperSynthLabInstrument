// Synth Lab - Juno-60 Style Chorus Effect
// BBD (Bucket-Brigade Delay) emulation with Mode I, Mode II, and Mode I+II

(function() {
  const SL = window.SynthLab;
  const BaseEffect = SL.effects.BaseEffect;

  // Juno-60 chorus mode constants
  const JUNO_MODE_I = 'I';
  const JUNO_MODE_II = 'II';
  const JUNO_MODE_I_II = 'I+II';

  // Valid mode values for clamping
  const VALID_MODES = [JUNO_MODE_I, JUNO_MODE_II, JUNO_MODE_I_II];

  // LFO rates (Hz) - triangle wave
  const LFO_RATE_I = 0.513;   // Mode I: slow, subtle
  const LFO_RATE_II = 0.863;  // Mode II: faster, deeper

  // Base delay times (seconds) - center of BBD sweep
  const BASE_DELAY_I = 0.005;  // 5ms for Mode I
  const BASE_DELAY_II = 0.007; // 7ms for Mode II

  // Modulation depth (seconds) - how far the delay sweeps from center
  const MOD_DEPTH_I = 0.0008;  // +/- 0.8ms subtle
  const MOD_DEPTH_II = 0.0015; // +/- 1.5ms deeper

  // BBD low-pass filter cutoff - simulates analog bucket-brigade rolloff
  const BBD_FILTER_CUTOFF = 8000; // Hz
  const BBD_FILTER_Q = 0.707;     // Butterworth

  /**
   * ChorusEffect - Roland Juno-60 style BBD chorus
   *
   * Modes:
   * - Mode I:   Single LFO (~0.5 Hz), subtle chorus, short delay, low depth
   * - Mode II:  Single LFO (~0.8 Hz), deeper chorus, longer delay, more depth
   * - Mode I+II: Two LFOs at both rates, rich ensemble effect
   *
   * Stereo: Left and right channels receive opposite LFO phases.
   * BBD character: Low-pass filter on delayed signal simulates analog warmth.
   *
   * Parameters:
   * - mode: 'I', 'II', or 'I+II'
   * - rate: LFO rate multiplier (0.5-2.0, scales the mode's base rate)
   * - depth: modulation depth multiplier 0-100
   * - mix: wet/dry 0-100
   */
  class ChorusEffect extends BaseEffect {
    constructor(ctx) {
      super(ctx, 'chorus');

      // Default parameters
      this.params.mode = 'I';
      this.params.rate = 1.0;    // multiplier on the mode's base LFO rate
      this.params.depth = 50;    // 0-100
      this.params.mix = 50;      // 0-100

      // Internal nodes storage
      this.nodes = {};

      // Build initial mode
      this.buildChorus();
    }

    /**
     * Build the stereo BBD chorus audio graph for the current mode.
     *
     * Signal flow:
     *   input -> splitter -> delayL -> bbdFilterL -> mergerL(0) -> outputGain -> wetGain
     *                     -> delayR -> bbdFilterR -> mergerR(1) ->
     *
     * LFO modulation:
     *   lfo1 -> lfoGain1L -> delayL.delayTime  (positive phase)
     *   lfo1 -> invertGain1 -> lfoGain1R -> delayR.delayTime  (inverted = opposite phase)
     *   (Mode I+II adds lfo2 with same pattern)
     */
    buildChorus() {
      // Clean up any existing nodes
      this.disposeNodes();

      const ctx = this.ctx;
      const mode = this.params.mode;
      const depthScale = this.params.depth / 100;
      const rateScale = this.params.rate;

      // --- Stereo splitter/merger ---
      const splitter = ctx.createChannelSplitter(2);
      const merger = ctx.createChannelMerger(2);

      // Input mono-to-stereo: connect input to both channels of splitter
      this.input.connect(splitter);

      // --- Left and right delay lines ---
      const delayL = ctx.createDelay(0.05);
      const delayR = ctx.createDelay(0.05);

      // --- BBD low-pass filters (analog warmth) ---
      const bbdFilterL = ctx.createBiquadFilter();
      bbdFilterL.type = 'lowpass';
      bbdFilterL.frequency.value = BBD_FILTER_CUTOFF;
      bbdFilterL.Q.value = BBD_FILTER_Q;

      const bbdFilterR = ctx.createBiquadFilter();
      bbdFilterR.type = 'lowpass';
      bbdFilterR.frequency.value = BBD_FILTER_CUTOFF;
      bbdFilterR.Q.value = BBD_FILTER_Q;

      // --- Output gain ---
      const outputGain = ctx.createGain();
      outputGain.gain.value = 1.0;

      // --- Wire the signal path ---
      splitter.connect(delayL, 0);
      splitter.connect(delayR, 1);
      delayL.connect(bbdFilterL);
      delayR.connect(bbdFilterR);
      bbdFilterL.connect(merger, 0, 0);
      bbdFilterR.connect(merger, 0, 1);
      merger.connect(outputGain);
      outputGain.connect(this.wetGain);

      // --- LFO setup based on mode ---
      const lfoNodes = [];

      // Determine which LFO configs to use
      const lfoConfigs = [];
      if (mode === JUNO_MODE_I || mode === JUNO_MODE_I_II) {
        lfoConfigs.push({ baseRate: LFO_RATE_I, baseDelay: BASE_DELAY_I, modDepth: MOD_DEPTH_I });
      }
      if (mode === JUNO_MODE_II || mode === JUNO_MODE_I_II) {
        lfoConfigs.push({ baseRate: LFO_RATE_II, baseDelay: BASE_DELAY_II, modDepth: MOD_DEPTH_II });
      }

      // Set base delay times: for I+II mode, use average of both base delays
      let combinedBaseDelay = 0;
      if (mode === JUNO_MODE_I_II) {
        combinedBaseDelay = (BASE_DELAY_I + BASE_DELAY_II) / 2;
      } else if (mode === JUNO_MODE_I) {
        combinedBaseDelay = BASE_DELAY_I;
      } else {
        combinedBaseDelay = BASE_DELAY_II;
      }
      delayL.delayTime.value = combinedBaseDelay;
      delayR.delayTime.value = combinedBaseDelay;

      // Create LFO(s) and connect to delay times with stereo phase inversion
      for (let i = 0; i < lfoConfigs.length; i++) {
        const config = lfoConfigs[i];
        const actualRate = config.baseRate * rateScale;
        const actualDepth = config.modDepth * depthScale;

        // Triangle LFO
        const lfo = ctx.createOscillator();
        lfo.type = 'triangle';
        lfo.frequency.value = actualRate;

        // Left channel: positive LFO phase
        const lfoGainL = ctx.createGain();
        lfoGainL.gain.value = actualDepth;

        // Right channel: inverted LFO phase (opposite modulation for stereo)
        const invertGain = ctx.createGain();
        invertGain.gain.value = -1;

        const lfoGainR = ctx.createGain();
        lfoGainR.gain.value = actualDepth;

        // Wire: lfo -> lfoGainL -> delayL.delayTime
        lfo.connect(lfoGainL);
        lfoGainL.connect(delayL.delayTime);

        // Wire: lfo -> invertGain -> lfoGainR -> delayR.delayTime
        lfo.connect(invertGain);
        invertGain.connect(lfoGainR);
        lfoGainR.connect(delayR.delayTime);

        lfo.start();

        lfoNodes.push({
          lfo: lfo,
          lfoGainL: lfoGainL,
          lfoGainR: lfoGainR,
          invertGain: invertGain,
          baseRate: config.baseRate,
          modDepth: config.modDepth
        });
      }

      // Store all nodes for parameter updates and cleanup
      this.nodes = {
        splitter: splitter,
        merger: merger,
        delayL: delayL,
        delayR: delayR,
        bbdFilterL: bbdFilterL,
        bbdFilterR: bbdFilterR,
        outputGain: outputGain,
        lfoNodes: lfoNodes,
        combinedBaseDelay: combinedBaseDelay
      };
    }

    /**
     * Clean up all audio nodes
     */
    disposeNodes() {
      if (!this.nodes || !this.nodes.splitter) {
        return;
      }

      // Stop and disconnect all LFOs
      if (this.nodes.lfoNodes) {
        this.nodes.lfoNodes.forEach(function(ln) {
          try { ln.lfo.stop(); } catch (e) { /* already stopped */ }
          ln.lfo.disconnect();
          ln.lfoGainL.disconnect();
          ln.lfoGainR.disconnect();
          ln.invertGain.disconnect();
        });
      }

      // Disconnect signal path nodes
      if (this.nodes.splitter) { this.nodes.splitter.disconnect(); }
      if (this.nodes.merger) { this.nodes.merger.disconnect(); }
      if (this.nodes.delayL) { this.nodes.delayL.disconnect(); }
      if (this.nodes.delayR) { this.nodes.delayR.disconnect(); }
      if (this.nodes.bbdFilterL) { this.nodes.bbdFilterL.disconnect(); }
      if (this.nodes.bbdFilterR) { this.nodes.bbdFilterR.disconnect(); }
      if (this.nodes.outputGain) { this.nodes.outputGain.disconnect(); }

      this.nodes = {};
    }

    /**
     * Handle parameter updates - applies changes IMMEDIATELY to audio nodes
     */
    updateParam(name, value) {
      const currentTime = this.ctx.currentTime;

      if (name === 'mode') {
        // Mode change requires full rebuild
        const newMode = (VALID_MODES.indexOf(value) !== -1) ? value : JUNO_MODE_I;
        if (newMode !== this.params.mode) {
          this.params.mode = newMode;
          this.buildChorus();
        }
      } else if (name === 'rate') {
        // Rate is a multiplier on the mode's base LFO rate
        const newRate = Math.max(0.5, Math.min(2.0, value));
        this.params.rate = newRate;
        if (this.nodes.lfoNodes) {
          this.nodes.lfoNodes.forEach(function(ln) {
            const actualRate = ln.baseRate * newRate;
            ln.lfo.frequency.setTargetAtTime(actualRate, currentTime, 0.005);
          });
        }
      } else if (name === 'depth') {
        // Depth 0-100 scales the mode's base modulation depth
        const newDepth = Math.max(0, Math.min(100, value));
        this.params.depth = newDepth;
        const depthScale = newDepth / 100;
        if (this.nodes.lfoNodes) {
          this.nodes.lfoNodes.forEach(function(ln) {
            const actualDepth = ln.modDepth * depthScale;
            ln.lfoGainL.gain.setTargetAtTime(actualDepth, currentTime, 0.005);
            ln.lfoGainR.gain.setTargetAtTime(actualDepth, currentTime, 0.005);
          });
        }
      }
      // 'mix' is handled by BaseEffect.setMix() via setParam()
    }

    /**
     * Clean up all audio nodes
     */
    dispose() {
      this.disposeNodes();
      super.dispose();
    }
  }

  // Export to SynthLab namespace
  SL.effects.Chorus = ChorusEffect;

})();
