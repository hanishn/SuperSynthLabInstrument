// Synth Lab - Lo-Fi Effect (proper multi-stage lofi chain)
//
// Signal chain (wet path):
//   input -> wow/flutter delay line (modulated) -> tape soft-clip waveshaper
//         -> band-limit HP(200) -> band-limit LP(warmth-variable, 2.5k-6k)
//         -> bit-crush waveshaper (quantize N-bit step function)
//         -> M/S width collapse -> wetGain
//   Parallel noise:
//     pink-ish noise buffer -> HP(500) -> BP(1.2k Q=0.7) -> LP(4k)
//         -> noiseGain -> wetGain
//
// Back-compat: legacy params filterFreq, filterWidth, amount accepted as aliases.
// ES5: no arrows, const, template literals. Named constants only.

(function() {
  var SL = window.SynthLab = window.SynthLab || {};
  SL.effects = SL.effects || {};
  var BaseEffect = SL.effects.BaseEffect;

  // ============ Named constants ============

  // Wow / flutter (THE feel — short modulated delay 5-30 ms)
  var WOW_BASE_DELAY_S = 0.012;          // 12 ms base — subtle pitch wobble
  var WOW_RATE_HZ_DEFAULT = 0.45;        // slower, more natural wow
  var WOW_MAX_DEPTH_S = 0.006;           // ~6 ms swing at 100% (more character)
  var FLUTTER_RATE_HZ = 6.1;             // overlaid faster flutter (spec 5-9 Hz)
  var FLUTTER_DEPTH_RATIO = 0.30;        // flutter is 30% of wow depth (more movement)
  var WOW_RATE_MIN_HZ = 0.1;
  var WOW_RATE_MAX_HZ = 5.0;
  var DELAY_LINE_MAX_S = 0.1;
  var FLUTTER_PCT_MIN = 0;
  var FLUTTER_PCT_MAX = 100;

  // Noise floor (spec: bandpass 500 Hz - 4 kHz)
  var NOISE_BUFFER_SECS = 3;
  var NOISE_BP_CENTER_HZ = 1200;
  var NOISE_BP_Q = 0.7;
  var NOISE_HP_HZ = 500;
  var NOISE_LP_HZ = 4000;
  var NOISE_MAX_GAIN = 0.04;             // ~ -28 dB FS at 100% (subtler noise floor)
  var NOISE_PCT_MIN = 0;
  var NOISE_PCT_MAX = 100;

  // Tape saturation curve (gentle soft-clip + a little HF rolloff character)
  var SAT_CURVE_SAMPLES = 2048;
  var SAT_DRIVE_POS = 1.6;               // softer pos-side knee (warmer, less harsh)
  var SAT_DRIVE_NEG = 1.3;               // gentler asymmetric: subtle even harmonics
  var SAT_OUTPUT_TRIM = 0.85;            // compensate for reduced drive

  // Band-limit (spec: raised cutoffs to preserve more high end)
  var BANDLIMIT_LOW_HZ = 200;            // fixed HP
  var BANDLIMIT_HIGH_HZ_MIN = 4000;      // 100% warmth -> warm but not muffled
  var BANDLIMIT_HIGH_HZ_MAX = 8000;      // 0% warmth  -> nearly full bandwidth
  var BANDLIMIT_Q = 0.7;
  var WARMTH_PCT_MIN = 0;
  var WARMTH_PCT_MAX = 100;

  // Bit reduction (spec item 5: 10-14 bit feel via WaveShaper quantization curve)
  var CRUSH_PCT_MIN = 0;
  var CRUSH_PCT_MAX = 100;
  var CRUSH_BITS_AT_0 = 16;              // 0% crush = ~transparent (16-bit)
  var CRUSH_BITS_AT_100 = 12;            // 100% crush = subtle grit (12-bit, analog not digital)
  var CRUSH_CURVE_SAMPLES = 4096;        // must cover [-1, 1] finely

  // Width collapse (stereo to mono, optional)
  var WIDTH_PCT_MIN = 0;
  var WIDTH_PCT_MAX = 100;

  // Mix
  var MIX_PCT_MIN = 0;
  var MIX_PCT_MAX = 100;

  // Smoothing time constant
  var SMOOTH_TC = 0.01;

  // ============ Defaults ============
  var DEFAULT_FLUTTER = 45;
  var DEFAULT_FLUTTER_RATE = WOW_RATE_HZ_DEFAULT;
  var DEFAULT_NOISE = 15;
  var DEFAULT_WARMTH = 40;
  var DEFAULT_CRUSH = 20;
  var DEFAULT_WIDTH = 25;                // 0 = full stereo, 100 = mono
  var DEFAULT_MIX = 50;

  /**
   * LofiEffect - proper multi-stage lofi chain.
   *
   * Parameters (0-100 unless noted):
   *  - flutter:     wow + flutter depth (the feel)
   *  - flutterRate: wow LFO rate in Hz (0.1 - 5)
   *  - noise:       bandpassed noise floor amount
   *  - warmth:      band-limit high cutoff (more warmth = darker / lower)
   *  - crush:       bit-depth reduction via WaveShaper quantization (16 -> 8 bits)
   *  - width:       stereo collapse toward mono (0 = stereo, 100 = mono)
   *  - mix:         wet/dry
   *
   * Legacy aliases:
   *   amount -> mix
   *   filterFreq -> warmth (inverted: higher Hz = less warmth)
   *   filterWidth -> stored, no audible effect (avoid mis-mapping stereo width)
   */
  function LofiEffect(ctx) {
    // BaseEffect is an ES6 class; must invoke via Reflect.construct so the `this`
    // returned carries BaseEffect's own instance state (input, output, wetGain, etc).
    var self = Reflect.construct(BaseEffect, [ctx, 'lofi'], LofiEffect);

    self.params.flutter = DEFAULT_FLUTTER;
    self.params.flutterRate = DEFAULT_FLUTTER_RATE;
    self.params.noise = DEFAULT_NOISE;
    self.params.warmth = DEFAULT_WARMTH;
    self.params.crush = DEFAULT_CRUSH;
    self.params.width = DEFAULT_WIDTH;
    self.params.mix = DEFAULT_MIX;

    // ---------- Wow & flutter ----------
    self.flutterDelay = ctx.createDelay(DELAY_LINE_MAX_S);
    self.flutterDelay.delayTime.value = WOW_BASE_DELAY_S;

    // Slow wow LFO
    self.wowLfo = ctx.createOscillator();
    self.wowLfo.type = 'sine';
    self.wowLfo.frequency.value = self.params.flutterRate;
    self.wowGain = ctx.createGain();
    self.wowGain.gain.value = self._calcWowDepth();
    self.wowLfo.connect(self.wowGain);
    self.wowGain.connect(self.flutterDelay.delayTime);
    self.wowLfo.start();

    // Fast flutter LFO (overlay)
    self.flutterLfo = ctx.createOscillator();
    self.flutterLfo.type = 'sine';
    self.flutterLfo.frequency.value = FLUTTER_RATE_HZ;
    self.flutterGain = ctx.createGain();
    self.flutterGain.gain.value = self._calcFlutterDepth();
    self.flutterLfo.connect(self.flutterGain);
    self.flutterGain.connect(self.flutterDelay.delayTime);
    self.flutterLfo.start();

    // ---------- Tape saturation (waveshaper) ----------
    self.saturation = ctx.createWaveShaper();
    self.saturation.oversample = '2x';
    self.saturation.curve = self._buildSatCurve();

    self.satTrim = ctx.createGain();
    self.satTrim.gain.value = SAT_OUTPUT_TRIM;

    // ---------- Band-limit (HP 200 + LP warmth-variable, radio/AM feel) ----------
    self.bandHP = ctx.createBiquadFilter();
    self.bandHP.type = 'highpass';
    self.bandHP.frequency.value = BANDLIMIT_LOW_HZ;
    self.bandHP.Q.value = BANDLIMIT_Q;

    self.bandLP = ctx.createBiquadFilter();
    self.bandLP.type = 'lowpass';
    self.bandLP.frequency.value = self._calcBandLimitHigh();
    self.bandLP.Q.value = BANDLIMIT_Q;

    // ---------- Bit reduction via WaveShaper ----------
    self.crushShaper = ctx.createWaveShaper();
    self.crushShaper.oversample = '2x';
    self.crushShaper.curve = self._buildCrushCurve();

    // ---------- Width collapse via splitter/merger ----------
    // out_L = direct*L + cross*R, out_R = direct*R + cross*L
    self.splitter = ctx.createChannelSplitter(2);
    self.merger = ctx.createChannelMerger(2);

    var crossInit = self._calcCrossGain();
    var directInit = self._calcDirectGain();
    self.gainLL = ctx.createGain(); self.gainLL.gain.value = directInit;
    self.gainRR = ctx.createGain(); self.gainRR.gain.value = directInit;
    self.gainLR = ctx.createGain(); self.gainLR.gain.value = crossInit;
    self.gainRL = ctx.createGain(); self.gainRL.gain.value = crossInit;

    // ---------- Noise floor (spec: 500 Hz - 4 kHz band) ----------
    self.noiseBuffer = self._createNoiseBuffer();
    self.noiseSource = null;

    self.noiseHP = ctx.createBiquadFilter();
    self.noiseHP.type = 'highpass';
    self.noiseHP.frequency.value = NOISE_HP_HZ;

    self.noiseBP = ctx.createBiquadFilter();
    self.noiseBP.type = 'bandpass';
    self.noiseBP.frequency.value = NOISE_BP_CENTER_HZ;
    self.noiseBP.Q.value = NOISE_BP_Q;

    self.noiseLP = ctx.createBiquadFilter();
    self.noiseLP.type = 'lowpass';
    self.noiseLP.frequency.value = NOISE_LP_HZ;

    self.noiseGain = ctx.createGain();
    self.noiseGain.gain.value = self._calcNoiseLevel();

    self._startNoiseSource();

    // ---------- Wire main signal path ----------
    // input -> flutterDelay -> saturation -> satTrim -> bandHP -> bandLP
    //       -> crushShaper -> splitter -> M/S mix -> merger -> wetGain
    self.input.connect(self.flutterDelay);
    self.flutterDelay.connect(self.saturation);
    self.saturation.connect(self.satTrim);
    self.satTrim.connect(self.bandHP);
    self.bandHP.connect(self.bandLP);
    self.bandLP.connect(self.crushShaper);
    self.crushShaper.connect(self.splitter);

    self.splitter.connect(self.gainLL, 0);
    self.splitter.connect(self.gainLR, 0);
    self.splitter.connect(self.gainRR, 1);
    self.splitter.connect(self.gainRL, 1);
    self.gainLL.connect(self.merger, 0, 0);
    self.gainRL.connect(self.merger, 0, 0);
    self.gainRR.connect(self.merger, 0, 1);
    self.gainLR.connect(self.merger, 0, 1);

    self.merger.connect(self.wetGain);

    // Noise sums into wetGain in parallel
    self.noiseHP.connect(self.noiseBP);
    self.noiseBP.connect(self.noiseLP);
    self.noiseLP.connect(self.noiseGain);
    self.noiseGain.connect(self.wetGain);

    return self;
  }

  // Inherit from BaseEffect (ES6 class) via Reflect-compatible prototype chain
  Object.setPrototypeOf(LofiEffect.prototype, BaseEffect.prototype);
  Object.setPrototypeOf(LofiEffect, BaseEffect);

  // ========== Helpers ==========

  LofiEffect.prototype._calcWowDepth = function() {
    var pct = this.params.flutter / FLUTTER_PCT_MAX;
    return WOW_MAX_DEPTH_S * pct;
  };

  LofiEffect.prototype._calcFlutterDepth = function() {
    var pct = this.params.flutter / FLUTTER_PCT_MAX;
    return WOW_MAX_DEPTH_S * FLUTTER_DEPTH_RATIO * pct;
  };

  LofiEffect.prototype._calcNoiseLevel = function() {
    var pct = this.params.noise / NOISE_PCT_MAX;
    return NOISE_MAX_GAIN * pct;
  };

  LofiEffect.prototype._calcBandLimitHigh = function() {
    // warmth 0 -> max (6k), warmth 100 -> min (2.5k)
    var pct = this.params.warmth / WARMTH_PCT_MAX;
    var range = BANDLIMIT_HIGH_HZ_MAX - BANDLIMIT_HIGH_HZ_MIN;
    var hz = BANDLIMIT_HIGH_HZ_MAX - range * pct;
    return hz;
  };

  LofiEffect.prototype._calcBits = function() {
    // crush 0 -> 16 bits, crush 100 -> 8 bits
    var pct = this.params.crush / CRUSH_PCT_MAX;
    var range = CRUSH_BITS_AT_0 - CRUSH_BITS_AT_100;
    var bits = CRUSH_BITS_AT_0 - range * pct;
    return bits;
  };

  LofiEffect.prototype._calcCrossGain = function() {
    // width 0 -> 0 cross, width 100 -> 0.5 cross (full mono)
    var pct = this.params.width / WIDTH_PCT_MAX;
    return 0.5 * pct;
  };

  LofiEffect.prototype._calcDirectGain = function() {
    var pct = this.params.width / WIDTH_PCT_MAX;
    return 1.0 - 0.5 * pct;
  };

  LofiEffect.prototype._buildSatCurve = function() {
    var n = SAT_CURVE_SAMPLES;
    var curve = new Float32Array(n);
    var kPos = SAT_DRIVE_POS;
    var kNeg = SAT_DRIVE_NEG;
    var normPos = Math.tanh(kPos);
    var normNeg = Math.tanh(kNeg);
    for (var i = 0; i < n; i++) {
      var x = (i * 2 / (n - 1)) - 1;
      var y;
      if (x >= 0) {
        y = Math.tanh(x * kPos) / normPos;
      } else {
        y = Math.tanh(x * kNeg) / normNeg;
      }
      curve[i] = y;
    }
    return curve;
  };

  LofiEffect.prototype._buildCrushCurve = function() {
    // Quantization step function:  y = round(x * steps) / steps
    // Where steps = 2^(bits-1). Produces the classic "bit-reduction" look.
    var bits = this._calcBits();
    var steps = Math.pow(2, bits - 1);
    var n = CRUSH_CURVE_SAMPLES;
    var curve = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var x = (i * 2 / (n - 1)) - 1;
      var q = Math.round(x * steps) / steps;
      if (q > 1) { q = 1; }
      if (q < -1) { q = -1; }
      curve[i] = q;
    }
    return curve;
  };

  LofiEffect.prototype._createNoiseBuffer = function() {
    var sr = this.ctx.sampleRate;
    var len = sr * NOISE_BUFFER_SECS;
    var buf = this.ctx.createBuffer(1, len, sr);
    var data = buf.getChannelData(0);
    // Pink-ish noise via Paul Kellett's economy filter
    var b0 = 0, b1 = 0, b2 = 0;
    for (var i = 0; i < len; i++) {
      var white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.0990460;
      b1 = 0.96300 * b1 + white * 0.2965164;
      b2 = 0.57000 * b2 + white * 1.0526913;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.15;
    }
    return buf;
  };

  LofiEffect.prototype._startNoiseSource = function() {
    if (this.noiseSource) {
      try { this.noiseSource.stop(); } catch (e) { /* may be stopped */ }
      this.noiseSource.disconnect();
    }
    this.noiseSource = this.ctx.createBufferSource();
    this.noiseSource.buffer = this.noiseBuffer;
    this.noiseSource.loop = true;
    this.noiseSource.connect(this.noiseHP);
    this.noiseSource.start();
  };

  // ========== updateParam ==========
  LofiEffect.prototype.updateParam = function(name, value) {
    var t = this.ctx.currentTime;

    // Legacy alias mapping
    var paramName = name;
    var paramValue = value;
    var wasEarlyHandled = false;
    if (name === 'amount') {
      paramName = 'mix';
    } else if (name === 'filterFreq') {
      paramName = 'warmth';
      var clampedHz = Math.max(200, Math.min(8000, value));
      paramValue = (1 - (clampedHz - 200) / (8000 - 200)) * WARMTH_PCT_MAX;
    } else if (name === 'filterWidth') {
      // Not remapped to stereo width (would surprise users);
      // store for roundtripping but no audible action.
      this.params.filterWidth = value;
      wasEarlyHandled = true;
    }

    if (!wasEarlyHandled) {
    var clamped = Math.max(0, Math.min(100, paramValue));

    switch (paramName) {
      case 'flutter':
        this.params.flutter = clamped;
        this.wowGain.gain.setTargetAtTime(this._calcWowDepth(), t, SMOOTH_TC);
        this.flutterGain.gain.setTargetAtTime(this._calcFlutterDepth(), t, SMOOTH_TC);
        break;
      case 'flutterRate':
        var rate = Math.max(WOW_RATE_MIN_HZ, Math.min(WOW_RATE_MAX_HZ, paramValue));
        this.params.flutterRate = rate;
        this.wowLfo.frequency.setTargetAtTime(rate, t, SMOOTH_TC);
        break;
      case 'noise':
        this.params.noise = clamped;
        this.noiseGain.gain.setTargetAtTime(this._calcNoiseLevel(), t, SMOOTH_TC);
        break;
      case 'warmth':
        this.params.warmth = clamped;
        this.bandLP.frequency.setTargetAtTime(this._calcBandLimitHigh(), t, SMOOTH_TC);
        break;
      case 'crush':
        this.params.crush = clamped;
        // Rebuild quantization curve (lightweight, 4k samples)
        this.crushShaper.curve = this._buildCrushCurve();
        break;
      case 'width':
        this.params.width = clamped;
        var cross = this._calcCrossGain();
        var direct = this._calcDirectGain();
        this.gainLL.gain.setTargetAtTime(direct, t, SMOOTH_TC);
        this.gainRR.gain.setTargetAtTime(direct, t, SMOOTH_TC);
        this.gainLR.gain.setTargetAtTime(cross, t, SMOOTH_TC);
        this.gainRL.gain.setTargetAtTime(cross, t, SMOOTH_TC);
        break;
      default:
        break;
    }
    }
  };

  LofiEffect.prototype.dispose = function() {
    try { this.wowLfo.stop(); } catch (e) { /* not started */ }
    try { this.flutterLfo.stop(); } catch (e) { /* not started */ }
    this.wowLfo.disconnect();
    this.flutterLfo.disconnect();
    this.wowGain.disconnect();
    this.flutterGain.disconnect();
    this.flutterDelay.disconnect();
    this.saturation.disconnect();
    this.satTrim.disconnect();
    this.bandHP.disconnect();
    this.bandLP.disconnect();
    this.crushShaper.disconnect();
    this.splitter.disconnect();
    this.merger.disconnect();
    this.gainLL.disconnect();
    this.gainRR.disconnect();
    this.gainLR.disconnect();
    this.gainRL.disconnect();

    if (this.noiseSource) {
      try { this.noiseSource.stop(); } catch (e) { /* may be stopped */ }
      this.noiseSource.disconnect();
    }
    this.noiseHP.disconnect();
    this.noiseBP.disconnect();
    this.noiseLP.disconnect();
    this.noiseGain.disconnect();

    BaseEffect.prototype.dispose.call(this);
  };

  // Alias so factory registration matches whatever name effects-ui expects
  SL.effects.Lofi = LofiEffect;

  SL.effects.LofiEffect = LofiEffect;

})();
