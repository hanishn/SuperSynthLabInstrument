// Synth Lab - Filter Effect (Auto-Wah Style)
// Creates a resonant filter with LFO modulation for sweeping wah effects

(function() {
  var SL = window.SynthLab = window.SynthLab || {};
  SL.effects = SL.effects || {};
  var BaseEffect = SL.effects.BaseEffect;

  /**
   * FilterEffect - Auto-wah style filter with LFO modulation
   *
   * Parameters:
   * - frequency: 200-8000 Hz (center/base frequency)
   * - resonance: 0-100 (Q factor, mapped to 0.5-15)
   * - lfoRate: 0-10 Hz (LFO speed, 0 = no modulation)
   * - lfoDepth: 0-100 (how much LFO affects frequency)
   * - type: 'lowpass', 'highpass', 'bandpass' (filter type)
   * - mix: 0-100 (wet/dry mix, inherited)
   */
  class FilterEffect extends BaseEffect {
    constructor(ctx) {
      super(ctx, 'filter');

      // Default parameter values
      this.params = {
        frequency: 1000,
        resonance: 30,
        lfoRate: 0.5,
        lfoDepth: 50,
        type: 'lowpass',
        mix: 50,
        keyTrack: 1.0
      };

      // Current note frequency for key tracking (set via setNoteFreq)
      this._noteFreq = 0;

      // Create the BiquadFilterNode
      this.filter = ctx.createBiquadFilter();
      this.filter.type = this.params.type;
      this.filter.frequency.value = this.params.frequency;
      this.filter.Q.value = this._mapResonanceToQ(this.params.resonance);

      // Create LFO oscillator for auto-wah modulation
      this.lfo = ctx.createOscillator();
      this.lfo.type = 'sine';
      this.lfo.frequency.value = this.params.lfoRate;

      // Create gain node to scale LFO depth
      // The LFO output is -1 to 1, we scale it to control frequency sweep range
      this.lfoGain = ctx.createGain();
      this.lfoGain.gain.value = this._calculateLfoDepth();

      // Connect LFO -> lfoGain -> filter.frequency
      this.lfo.connect(this.lfoGain);
      this.lfoGain.connect(this.filter.frequency);

      // Connect signal path: input -> filter -> wetGain
      this.input.connect(this.filter);
      this.filter.connect(this.wetGain);

      // Start the LFO
      this.lfo.start();

      // Set initial mix
      this.setMix(this.params.mix);

      // Start in bypass mode
      this.enabled = false;
      this.setEnabled(false);
    }

    /**
     * Map resonance (0-100) to Q factor (0.5-15)
     * @param {number} resonance - Resonance value 0-100
     * @returns {number} Q factor 0.5-15
     */
    _mapResonanceToQ(resonance) {
      // Linear mapping: 0 -> 0.5, 100 -> 15
      return 0.5 + (resonance / 100) * 14.5;
    }

    /**
     * Calculate LFO depth in Hz based on depth parameter and base frequency
     * The LFO will sweep the filter frequency around the center frequency
     * @returns {number} LFO depth in Hz
     */
    _calculateLfoDepth() {
      // At depth 100, sweep up to 2 octaves above base frequency
      // At depth 0, no sweep
      var baseFreq = this._getEffectiveFreq();
      var maxSweep = baseFreq * 2; // 2x frequency = 1 octave up
      return (this.params.lfoDepth / 100) * maxSweep;
    }

    /**
     * Get effective filter frequency after key tracking is applied
     * Uses calcKeyTrackedFreq from filters.js if available
     * @returns {number} Effective frequency in Hz
     */
    _getEffectiveFreq() {
      var baseFreq = this.params.frequency;
      if (this.params.keyTrack > 0 && this._noteFreq > 0) {
        if (SL.audio && SL.audio.calcKeyTrackedFreq) {
          return SL.audio.calcKeyTrackedFreq(baseFreq, this._noteFreq, this.params.keyTrack);
        }
        // Inline fallback: reference C4 = 261.63
        var refFreq = 261.63;
        var octaveDiff = Math.log2(this._noteFreq / refFreq);
        var multiplier = Math.pow(2, octaveDiff * this.params.keyTrack);
        return Math.max(200, Math.min(8000, baseFreq * multiplier));
      }
      return baseFreq;
    }

    /**
     * Set the current note frequency for key tracking
     * Call this on note-on to update the filter cutoff based on pitch
     * @param {number} freq - Note frequency in Hz
     */
    setNoteFreq(freq) {
      this._noteFreq = freq;
      this._applyFrequency();
    }

    /**
     * Apply the current effective frequency to the filter node
     */
    _applyFrequency() {
      var effectiveFreq = this._getEffectiveFreq();
      this.filter.frequency.setTargetAtTime(
        effectiveFreq,
        this.ctx.currentTime,
        0.01
      );
      // Update LFO depth since it's relative to frequency
      this.lfoGain.gain.setTargetAtTime(
        this._calculateLfoDepth(),
        this.ctx.currentTime,
        0.01
      );
    }

    /**
     * Handle parameter updates
     */
    updateParam(name, value) {
      switch (name) {
        case 'frequency':
          // Center/base frequency 200-8000 Hz
          this.params.frequency = Math.max(200, Math.min(8000, value));
          this._applyFrequency();
          break;

        case 'keyTrack':
          // Key tracking amount 0-2 (0% to 200%)
          this.params.keyTrack = Math.max(0, Math.min(2, value));
          this._applyFrequency();
          break;

        case 'resonance':
          // Resonance 0-100, mapped to Q 0.5-15
          this.params.resonance = Math.max(0, Math.min(100, value));
          this.filter.Q.setTargetAtTime(
            this._mapResonanceToQ(this.params.resonance),
            this.ctx.currentTime,
            0.01
          );
          break;

        case 'lfoRate':
          // LFO speed 0-10 Hz
          this.params.lfoRate = Math.max(0, Math.min(10, value));
          this.lfo.frequency.setTargetAtTime(
            this.params.lfoRate,
            this.ctx.currentTime,
            0.01
          );
          break;

        case 'lfoDepth':
          // LFO depth 0-100
          this.params.lfoDepth = Math.max(0, Math.min(100, value));
          this.lfoGain.gain.setTargetAtTime(
            this._calculateLfoDepth(),
            this.ctx.currentTime,
            0.01
          );
          break;

        case 'type':
          // Filter type: lowpass, highpass, or bandpass
          var validTypes = ['lowpass', 'highpass', 'bandpass'];
          if (validTypes.includes(value)) {
            this.params.type = value;
            this.filter.type = value;
          }
          break;
      }
    }

    /**
     * Clean up all audio nodes
     */
    dispose() {
      // Stop and disconnect the LFO
      this.lfo.stop();
      this.lfo.disconnect();

      // Disconnect LFO gain
      this.lfoGain.disconnect();

      // Disconnect filter
      this.filter.disconnect();

      // Call parent dispose
      super.dispose();
    }
  }

  // Register the effect in SynthLab namespace
  SL.effects.FilterEffect = FilterEffect;

})();
