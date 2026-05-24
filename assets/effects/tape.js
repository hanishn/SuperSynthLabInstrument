// Synth Lab - Tape Saturation Effect
// Emulates analog tape characteristics: soft saturation, head bump, and high-frequency rolloff

(function() {
  const SL = window.SynthLab = window.SynthLab || {};
  SL.effects = SL.effects || {};

  // Number of samples for waveshaper curve
  const CURVE_SAMPLES = 44100;

  /**
   * Generate an asymmetric tape-style saturation curve
   * Tape saturation is characteristically warm and adds even harmonics
   * through subtle asymmetry
   * @param {number} drive - Drive amount 0-100
   * @returns {Float32Array} Waveshaper curve
   */
  function generateTapeCurve(drive) {
    const curve = new Float32Array(CURVE_SAMPLES);
    // Map drive (0-100) to saturation intensity (1-8)
    const amount = 1 + (drive / 100) * 7;

    for (let i = 0; i < CURVE_SAMPLES; i++) {
      const x = (i * 2 / CURVE_SAMPLES) - 1;

      // Tape-style asymmetric soft saturation
      // Uses a combination of tanh for soft clipping with slight asymmetry
      // Positive half saturates slightly differently than negative (even harmonics)
      let y;
      if (x >= 0) {
        // Positive side: slightly more compression, warmer
        y = Math.tanh(x * amount * 1.1) / Math.tanh(amount * 1.1);
        // Add subtle second harmonic character
        y = y * 0.97 + y * y * 0.03;
      } else {
        // Negative side: slightly less compression
        y = Math.tanh(x * amount * 0.95) / Math.tanh(amount * 0.95);
      }

      // Apply subtle soft knee compression feel
      // This reduces the dynamic range slightly, mimicking tape compression
      const knee = 0.7;
      if (Math.abs(y) > knee) {
        const sign = y >= 0 ? 1 : -1;
        const excess = Math.abs(y) - knee;
        const compressed = knee + excess * 0.5;
        y = sign * Math.min(1, compressed);
      }

      curve[i] = y;
    }
    return curve;
  }

  /**
   * TapeEffect - Analog tape saturation emulation
   *
   * Parameters:
   * - drive: 0-100 (amount of saturation/warmth, default 30)
   * - warmth: 0-100 (high frequency rolloff amount, default 50)
   * - bump: 0-100 (low frequency boost amount, default 30)
   * - mix: 0-100 (wet/dry mix, inherited from BaseEffect, default 100)
   */
  class TapeEffect extends SL.effects.BaseEffect {
    constructor(ctx) {
      super(ctx, 'tape');

      // Set default parameters without calling setMix or setEnabled
      this.params.drive = 30;
      this.params.warmth = 50;
      this.params.bump = 30;
      this.params.mix = 100;

      // Low shelf filter for tape head bump (low frequency boost around 100Hz)
      this.bumpFilter = ctx.createBiquadFilter();
      this.bumpFilter.type = 'lowshelf';
      this.bumpFilter.frequency.value = 100;
      this.bumpFilter.gain.value = this.calculateBumpGain(this.params.bump);

      // Waveshaper for tape saturation
      this.waveshaper = ctx.createWaveShaper();
      this.waveshaper.oversample = '4x'; // Reduce aliasing artifacts
      this.waveshaper.curve = generateTapeCurve(this.params.drive);

      // Lowpass filter for high-frequency rolloff (tape head losses)
      this.warmthFilter = ctx.createBiquadFilter();
      this.warmthFilter.type = 'lowpass';
      this.warmthFilter.frequency.value = this.calculateWarmthFrequency(this.params.warmth);
      this.warmthFilter.Q.value = 0.5; // Gentle slope

      // Output gain for level compensation
      this.outputGain = ctx.createGain();
      this.outputGain.gain.value = 0.9; // Slight reduction to prevent clipping

      // Tape wow/flutter: modulated delay line
      // Base delay of 5ms, modulated by two LFOs
      this.wowFlutterDelay = ctx.createDelay(0.05);
      this.wowFlutterDelay.delayTime.value = 0.005; // 5ms base delay

      // Wow LFO: slow 0.5Hz modulation, ±0.3% of playback speed (±0.015ms delay swing)
      this.wowLfo = ctx.createOscillator();
      this.wowLfo.type = 'sine';
      this.wowLfo.frequency.value = 0.5;
      this.wowGain = ctx.createGain();
      this.wowGain.gain.value = 0.000015; // ±0.3% at 5ms base = ~0.015ms

      // Flutter LFO: faster 6Hz modulation, ±0.05% (±0.0025ms delay swing)
      this.flutterLfo = ctx.createOscillator();
      this.flutterLfo.type = 'sine';
      this.flutterLfo.frequency.value = 6;
      this.flutterGain = ctx.createGain();
      this.flutterGain.gain.value = 0.0000025; // ±0.05% at 5ms base

      // Connect LFOs to delay time
      this.wowLfo.connect(this.wowGain);
      this.wowGain.connect(this.wowFlutterDelay.delayTime);
      this.flutterLfo.connect(this.flutterGain);
      this.flutterGain.connect(this.wowFlutterDelay.delayTime);

      // Start LFOs
      this.wowLfo.start();
      this.flutterLfo.start();

      // Signal chain: input -> bumpFilter -> waveshaper -> warmthFilter -> wowFlutterDelay -> outputGain -> wetGain
      this.input.connect(this.bumpFilter);
      this.bumpFilter.connect(this.waveshaper);
      this.waveshaper.connect(this.warmthFilter);
      this.warmthFilter.connect(this.wowFlutterDelay);
      this.wowFlutterDelay.connect(this.outputGain);
      this.outputGain.connect(this.wetGain);
    }

    /**
     * Calculate low shelf gain from bump parameter
     * @param {number} bump - Bump amount 0-100
     * @returns {number} Gain in dB (0-6)
     */
    calculateBumpGain(bump) {
      // Map 0-100 to 0-6 dB boost
      return (bump / 100) * 6;
    }

    /**
     * Calculate lowpass frequency from warmth parameter
     * @param {number} warmth - Warmth amount 0-100
     * @returns {number} Frequency in Hz (20000 down to 4000)
     */
    calculateWarmthFrequency(warmth) {
      // Map 0-100 to 20kHz down to 4kHz
      // At 0% warmth: 20kHz (no rolloff)
      // At 100% warmth: 4kHz (significant rolloff)
      return 20000 - (warmth / 100) * 16000;
    }

    /**
     * Handle parameter updates
     */
    updateParam(name, value) {
      const currentTime = this.ctx.currentTime;

      switch (name) {
        case 'drive':
          this.params.drive = Math.max(0, Math.min(100, value));
          // Regenerate the saturation curve
          this.waveshaper.curve = generateTapeCurve(this.params.drive);
          break;

        case 'warmth':
          this.params.warmth = Math.max(0, Math.min(100, value));
          const warmthFreq = this.calculateWarmthFrequency(this.params.warmth);
          this.warmthFilter.frequency.setTargetAtTime(warmthFreq, currentTime, 0.01);
          break;

        case 'bump':
          this.params.bump = Math.max(0, Math.min(100, value));
          const bumpGain = this.calculateBumpGain(this.params.bump);
          this.bumpFilter.gain.setTargetAtTime(bumpGain, currentTime, 0.01);
          break;
      }
    }

    /**
     * Clean up audio nodes
     */
    dispose() {
      this.wowLfo.stop();
      this.flutterLfo.stop();
      this.wowLfo.disconnect();
      this.flutterLfo.disconnect();
      this.wowGain.disconnect();
      this.flutterGain.disconnect();
      this.wowFlutterDelay.disconnect();
      this.bumpFilter.disconnect();
      this.waveshaper.disconnect();
      this.warmthFilter.disconnect();
      this.outputGain.disconnect();
      super.dispose();
    }
  }

  // Export to SynthLab namespace
  SL.effects.TapeEffect = TapeEffect;

})();
