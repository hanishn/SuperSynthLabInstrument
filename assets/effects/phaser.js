// Synth Lab - Phaser Effect
// Creates sweeping notch filters using allpass filter stages modulated by an LFO

(function() {
  var SL = window.SynthLab;
  var BaseEffect = SL.effects.BaseEffect;

  /**
   * PhaserEffect - Multi-stage allpass filter phaser
   *
   * Parameters:
   * - rate: 0.1-10 Hz (LFO speed)
   * - depth: 0-100 (LFO sweep amount)
   * - stages: 2-12 (number of allpass filters, even numbers)
   * - feedback: 0-95% (feedback amount)
   * - baseFreq: 200-2000 Hz (center frequency)
   * - mix: 0-100 (wet/dry mix, inherited)
   */
  class PhaserEffect extends BaseEffect {
    constructor(ctx) {
      super(ctx, 'phaser');

      // Default parameter values
      this.params = {
        rate: 0.5,
        depth: 50,
        stages: 4,
        feedback: 30,
        baseFreq: 800,
        mix: 50
      };

      // Allpass filter stages
      this.allpassFilters = [];

      // LFO for modulation
      this.lfo = ctx.createOscillator();
      this.lfo.type = 'sine';
      this.lfo.frequency.value = this.params.rate;

      // Gain nodes for LFO depth control per stage
      this.lfoGains = [];

      // Feedback path
      this.feedbackGain = ctx.createGain();
      this.feedbackGain.gain.value = this.params.feedback / 100;

      // Input gain for the wet path (receives both input and feedback)
      this.inputMixer = ctx.createGain();
      this.inputMixer.gain.value = 1;

      // Build the initial filter chain
      this._buildFilterChain(this.params.stages);

      // Start the LFO
      this.lfo.start();

      // Set initial mix
      this.setMix(this.params.mix);
    }

    /**
     * Build or rebuild the allpass filter chain
     * @param {number} numStages - Number of allpass stages (will be forced to even)
     */
    _buildFilterChain(numStages) {
      // Ensure even number of stages
      numStages = Math.max(2, Math.min(12, Math.floor(numStages / 2) * 2));

      // Disconnect existing filters if any
      this._disconnectFilters();

      // Clear arrays
      this.allpassFilters = [];
      this.lfoGains = [];

      // Create new allpass filters
      for (var i = 0; i < numStages; i++) {
        var filter = this.ctx.createBiquadFilter();
        filter.type = 'allpass';
        filter.frequency.value = this.params.baseFreq;
        filter.Q.value = 0.5; // Low Q for allpass
        this.allpassFilters.push(filter);

        // Create LFO gain for this stage with slight variation for richer sound
        var lfoGain = this.ctx.createGain();
        // Each stage gets slightly different modulation depth for complexity
        var stageDepthFactor = 1 + (i * 0.1);
        lfoGain.gain.value = this._calculateLfoDepth() * stageDepthFactor;
        this.lfoGains.push(lfoGain);

        // Connect LFO to this filter's frequency through the gain
        this.lfo.connect(lfoGain);
        lfoGain.connect(filter.frequency);
      }

      // Connect the signal path
      this._connectFilters();
    }

    /**
     * Calculate LFO depth in Hz based on depth parameter and base frequency
     */
    _calculateLfoDepth() {
      // Depth controls how many Hz the LFO sweeps
      // At depth 100, sweep from baseFreq/4 to baseFreq*4 (2 octaves each direction)
      var maxSweep = this.params.baseFreq * 0.8;
      return (this.params.depth / 100) * maxSweep;
    }

    /**
     * Disconnect all filter nodes
     */
    _disconnectFilters() {
      // Disconnect input mixer
      this.inputMixer.disconnect();

      // Disconnect feedback
      this.feedbackGain.disconnect();

      // Disconnect all filters
      this.allpassFilters.forEach(function(filter) {
        filter.disconnect();
      });

      // Disconnect LFO from gains
      this.lfo.disconnect();
      this.lfoGains.forEach(function(gain) {
        gain.disconnect();
      });
    }

    /**
     * Connect the filter chain
     * Signal flow: input -> inputMixer -> allpass1 -> ... -> allpassN -> wetGain
     *                            ^                              |
     *                            +---- feedbackGain <-----------+
     */
    _connectFilters() {
      if (this.allpassFilters.length === 0) return;

      // Connect input to the mixer
      this.input.connect(this.inputMixer);

      // Chain the allpass filters
      var currentNode = this.inputMixer;
      var self = this;
      this.allpassFilters.forEach(function(filter) {
        currentNode.connect(filter);
        currentNode = filter;
      });

      // Connect last filter to wet output
      currentNode.connect(this.wetGain);

      // Connect feedback path: last filter -> feedbackGain -> inputMixer
      currentNode.connect(this.feedbackGain);
      this.feedbackGain.connect(this.inputMixer);

      // Reconnect LFO to all gain nodes
      this.lfoGains.forEach(function(gain, i) {
        self.lfo.connect(gain);
        gain.connect(self.allpassFilters[i].frequency);
      });
    }

    /**
     * Update all filter frequencies to the base frequency
     */
    _updateFilterFrequencies() {
      var self = this;
      var baseFreq = this.params.baseFreq;
      this.allpassFilters.forEach(function(filter) {
        filter.frequency.setTargetAtTime(baseFreq, self.ctx.currentTime, 0.01);
      });
    }

    /**
     * Update all LFO gain values based on current depth
     */
    _updateLfoDepths() {
      var self = this;
      var baseDepth = this._calculateLfoDepth();
      this.lfoGains.forEach(function(gain, i) {
        var stageDepthFactor = 1 + (i * 0.1);
        gain.gain.setTargetAtTime(baseDepth * stageDepthFactor, self.ctx.currentTime, 0.01);
      });
    }

    /**
     * Handle parameter updates
     */
    updateParam(name, value) {
      switch (name) {
        case 'rate':
          // LFO frequency in Hz
          this.params.rate = Math.max(0.1, Math.min(10, value));
          this.lfo.frequency.setTargetAtTime(this.params.rate, this.ctx.currentTime, 0.01);
          break;

        case 'depth':
          // Modulation depth 0-100
          this.params.depth = Math.max(0, Math.min(100, value));
          this._updateLfoDepths();
          break;

        case 'stages':
          // Number of allpass stages (even numbers 2-12)
          var newStages = Math.max(2, Math.min(12, Math.floor(value / 2) * 2));
          if (newStages !== this.params.stages) {
            this.params.stages = newStages;
            this._buildFilterChain(newStages);
          }
          break;

        case 'feedback':
          // Feedback amount 0-95%
          this.params.feedback = Math.max(0, Math.min(95, value));
          this.feedbackGain.gain.setTargetAtTime(
            this.params.feedback / 100,
            this.ctx.currentTime,
            0.01
          );
          break;

        case 'baseFreq':
          // Center frequency 200-2000 Hz
          this.params.baseFreq = Math.max(200, Math.min(2000, value));
          this._updateFilterFrequencies();
          this._updateLfoDepths(); // Depth is relative to base freq
          break;
      }
    }

    /**
     * Clean up all audio nodes
     */
    dispose() {
      // Stop the LFO
      this.lfo.stop();
      this.lfo.disconnect();

      // Disconnect all filters
      this._disconnectFilters();

      // Disconnect input mixer and feedback
      this.inputMixer.disconnect();
      this.feedbackGain.disconnect();

      // Call parent dispose
      super.dispose();
    }
  }

  // Register the effect in SynthLab namespace
  SL.effects.Phaser = PhaserEffect;

})();
