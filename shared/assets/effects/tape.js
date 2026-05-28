// Synth Lab - Tape Saturation Effect [FX-032]
// Emulates analog tape characteristics: soft saturation, head bump, and high-frequency rolloff
//
// --- What is tape saturation? ---
// Analog tape records audio by magnetizing ferric oxide particles on a
// moving ribbon. The relationship between input signal level and resulting
// magnetization follows a sigmoid (S-shaped) curve — called the magnetic
// hysteresis loop. Below a threshold the response is roughly linear, but
// as the signal approaches tape's maximum flux capacity the peaks are
// gently compressed ("saturated"). This is fundamentally different from
// digital clipping, which is an abrupt hard wall.
//
// --- Why does tape sound "warm"? ---
// Three interacting phenomena:
//   1. Asymmetric saturation: positive and negative signal peaks magnetize
//      tape slightly differently, producing even-order harmonics (2nd, 4th).
//      Even harmonics sound consonant and "musical" to human ears.
//   2. High-frequency rolloff: the playback head's finite gap width causes
//      progressive HF loss. Aged or worn tape loses even more treble.
//      This gentle HF shelving removes digital harshness.
//   3. Head bump: a resonance in the playback head at ~80-120 Hz boosts
//      low frequencies by several dB, adding bass "weight" and fullness.
//
// --- Wow and flutter ---
// Mechanical imperfections in the tape transport cause slow speed variation
// (wow, <6 Hz) and faster speed jitter (flutter, 6-20 Hz). These translate
// to subtle pitch and timing modulation that adds organic movement.
//
// Reference: Valimaki, V. et al. (2010) "Digital Audio Effects", Wiley
//
// Spec: Drive 0-100% (default 30), Warmth LP 0-100% (default 50),
//        Low Shelf Bump 0-100% (default 30), Mix 0-100% (default 50).

(function() {
  var SL = window.SynthLab = window.SynthLab || {};
  SL.effects = SL.effects || {};

  // Number of samples for waveshaper curve
  var CURVE_SAMPLES = 44100;

  // ---------------------------------------------------------------------------
  // Waveshaper curve generation
  // ---------------------------------------------------------------------------
  // The WaveShaperNode applies a static transfer function: for each input
  // sample x in [-1, +1], the output is curve[x]. By making the curve
  // follow a tanh-like sigmoid we get soft saturation. The asymmetry
  // (positive side driven harder than negative) is what generates even
  // harmonics — the hallmark of tape character.
  // ---------------------------------------------------------------------------

  /**
   * Generate an asymmetric tape-style saturation curve
   * Tape saturation is characteristically warm and adds even harmonics
   * through subtle asymmetry
   * @param {number} drive - Drive amount 0-100
   * @returns {Float32Array} Waveshaper curve
   */
  function generateTapeCurve(drive) {
    var curve = new Float32Array(CURVE_SAMPLES);
    // Map drive (0-100) to saturation intensity (1-8)
    // Higher "amount" pushes more of the signal into tanh's saturating region
    var amount = 1 + (drive / 100) * 7;

    for (var i = 0; i < CURVE_SAMPLES; i++) {
      var x = (i * 2 / CURVE_SAMPLES) - 1;

      // Tape-style asymmetric soft saturation
      // Uses a combination of tanh for soft clipping with slight asymmetry
      // Positive half saturates slightly differently than negative (even harmonics).
      // The division by tanh(amount*k) normalizes the curve so the output
      // still reaches +/-1 at full scale — preventing unintended gain changes.
      var y;
      if (x >= 0) {
        // Positive side: 1.1x overdrive adds earlier compression (warmer)
        y = Math.tanh(x * amount * 1.1) / Math.tanh(amount * 1.1);
        // Blend in y^2 term for subtle second-harmonic content (even harmonic)
        y = y * 0.97 + y * y * 0.03;
      } else {
        // Negative side: slightly less compression
        y = Math.tanh(x * amount * 0.95) / Math.tanh(amount * 0.95);
      }

      // Apply subtle soft knee compression feel
      // This reduces the dynamic range slightly, mimicking tape compression
      var knee = 0.7;
      if (Math.abs(y) > knee) {
        var sign = y >= 0 ? 1 : -1;
        var excess = Math.abs(y) - knee;
        var compressed = knee + excess * 0.5;
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

      // Low shelf filter for tape head bump (low frequency boost around 100Hz).
      // Real tape playback heads exhibit a resonance peak ("head bump") in the
      // 80-120 Hz range due to the physical geometry of the head gap. This adds
      // a pleasant bass fullness that is a signature of tape recordings.
      this.bumpFilter = ctx.createBiquadFilter();
      this.bumpFilter.type = 'lowshelf';
      this.bumpFilter.frequency.value = 100;
      this.bumpFilter.gain.value = this.calculateBumpGain(this.params.bump);

      // Waveshaper for tape saturation.
      // 4x oversampling upsamples the signal before applying the nonlinear
      // transfer function, then downsamples. This prevents aliasing harmonics
      // that would fold back into the audible range as inharmonic distortion.
      this.waveshaper = ctx.createWaveShaper();
      this.waveshaper.oversample = '4x'; // Reduce aliasing artifacts
      this.waveshaper.curve = generateTapeCurve(this.params.drive);

      // Lowpass filter for high-frequency rolloff (tape head losses).
      // Real tape progressively loses treble due to the finite width of the
      // playback head gap and magnetic particle alignment. Older or worn tape
      // exhibits more HF loss. This gentle rolloff removes digital harshness.
      this.warmthFilter = ctx.createBiquadFilter();
      this.warmthFilter.type = 'lowpass';
      this.warmthFilter.frequency.value = this.calculateWarmthFrequency(this.params.warmth);
      this.warmthFilter.Q.value = 0.5; // Gentle slope

      // Output gain for level compensation
      this.outputGain = ctx.createGain();
      this.outputGain.gain.value = 0.9; // Slight reduction to prevent clipping

      // --- Wow and flutter simulation ---
      // Tape transport speed is never perfectly constant. A modulated delay
      // line simulates this: varying the delay time is equivalent to varying
      // the playback speed, which causes pitch/timing wobble.
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
      var currentTime = this.ctx.currentTime;

      switch (name) {
        case 'drive':
          this.params.drive = Math.max(0, Math.min(100, value));
          // Regenerate the saturation curve
          this.waveshaper.curve = generateTapeCurve(this.params.drive);
          break;

        case 'warmth':
          this.params.warmth = Math.max(0, Math.min(100, value));
          var warmthFreq = this.calculateWarmthFrequency(this.params.warmth);
          this.warmthFilter.frequency.setTargetAtTime(warmthFreq, currentTime, 0.01);
          break;

        case 'bump':
          this.params.bump = Math.max(0, Math.min(100, value));
          var bumpGain = this.calculateBumpGain(this.params.bump);
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
