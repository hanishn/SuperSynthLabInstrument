// Synth Lab - Driftscape Effect
//
// Tape-motion engine: wow + flutter + dropouts + tape saturation + HF rolloff.
// Non-trademarked "driftscape" name. Follows lofi.js ES5 construction pattern
// (Reflect.construct + setPrototypeOf for BaseEffect ES6 class).
//
// Signal chain (wet):
//   input -> tape-saturation (tanh WaveShaper) -> modulated-delay (wow+flutter)
//         -> dropout-gate (scheduled gain dips) -> HF-rolloff (1-pole LP)
//         -> wetGain -> output
//
// Parameters (all 0..1 except mix which is 0..100 for UI compat):
//   mix              0..100  wet/dry
//   wowDepth         0..1    +/- 3 ms to +/- 15 ms
//   wowRate          0..1    0.5 Hz to 2 Hz
//   flutterDepth     0..1    +/- 0.2 ms to +/- 2 ms
//   flutterRate      0..1    5 Hz to 9 Hz
//   dropoutDensity   0..1    0 events/s to ~2 events/s
//   saturation       0..1    tanh drive
//   warmth           0..1    inverse HF cutoff 12 kHz -> 2 kHz
//
// ES5: no arrows / const / template literals. Named constants only.

(function() {
  var SL = window.SynthLab = window.SynthLab || {};
  SL.effects = SL.effects || {};
  var BaseEffect = SL.effects.BaseEffect;

  // ============ Named constants ============

  // Wow (slow pitch wobble)
  var WOW_RATE_MIN_HZ = 0.5;
  var WOW_RATE_MAX_HZ = 2.0;
  var WOW_DEPTH_MIN_S = 0.003;   // 3 ms
  var WOW_DEPTH_MAX_S = 0.015;   // 15 ms

  // Flutter (fast pitch jitter)
  var FLUTTER_RATE_MIN_HZ = 5.0;
  var FLUTTER_RATE_MAX_HZ = 9.0;
  var FLUTTER_DEPTH_MIN_S = 0.0002; // 0.2 ms
  var FLUTTER_DEPTH_MAX_S = 0.002;  // 2 ms

  // Delay-line base (must be > max wow+flutter depth for safe modulation)
  var DELAY_BASE_S = 0.020;       // 20 ms base
  var DELAY_LINE_MAX_S = 0.080;   // 80 ms headroom

  // Dropouts (amplitude dips)
  var DROPOUT_DENSITY_MIN_HZ = 0.0;
  var DROPOUT_DENSITY_MAX_HZ = 2.0;
  var DROPOUT_DURATION_MIN_S = 0.050; // 50 ms
  var DROPOUT_DURATION_MAX_S = 0.200; // 200 ms
  var DROPOUT_MIN_GAIN = 0.2;         // dip floor (spec: 0.2x)
  var DROPOUT_NOMINAL_GAIN = 1.0;
  var DROPOUT_EDGE_FRACTION = 0.25;   // ramp in/out is 25% of duration each
  var DROPOUT_SCHEDULE_HORIZON_S = 2.0; // schedule 2 s ahead
  var DROPOUT_RESCHEDULE_INTERVAL_S = 1.0; // top up every 1 s
  var DROPOUT_RESCHEDULE_INTERVAL_MS = 1000;

  // Saturation (tanh WaveShaper)
  var SAT_CURVE_SAMPLES = 2048;
  var SAT_DRIVE_MIN = 1.0;   // transparent
  var SAT_DRIVE_MAX = 6.0;   // heavy

  // Warmth (HF rolloff one-pole LP via biquad lowpass Q~0.5)
  var WARMTH_CUTOFF_MIN_HZ = 2000;   // warmth=1 -> 2 kHz
  var WARMTH_CUTOFF_MAX_HZ = 12000;  // warmth=0 -> 12 kHz
  var WARMTH_Q = 0.5;

  // Mix
  var MIX_PCT_MIN = 0;
  var MIX_PCT_MAX = 100;

  // Smoothing
  var SMOOTH_TC = 0.01;

  // Unit range clamp
  var UNIT_MIN = 0.0;
  var UNIT_MAX = 1.0;

  // ============ Defaults (all unit 0..1, mix 0..100) ============
  var DEFAULT_WOW_DEPTH = 0.5;
  var DEFAULT_WOW_RATE = 0.3;
  var DEFAULT_FLUTTER_DEPTH = 0.5;
  var DEFAULT_FLUTTER_RATE = 0.6;
  var DEFAULT_DROPOUT_DENSITY = 0.2;
  var DEFAULT_SATURATION = 0.4;
  var DEFAULT_WARMTH = 0.4;
  var DEFAULT_MIX = 50;

  /**
   * DriftscapeEffect - tape-motion engine.
   */
  function DriftscapeEffect(ctx) {
    var self = Reflect.construct(BaseEffect, [ctx, 'driftscape'], DriftscapeEffect);

    self.params.wowDepth = DEFAULT_WOW_DEPTH;
    self.params.wowRate = DEFAULT_WOW_RATE;
    self.params.flutterDepth = DEFAULT_FLUTTER_DEPTH;
    self.params.flutterRate = DEFAULT_FLUTTER_RATE;
    self.params.dropoutDensity = DEFAULT_DROPOUT_DENSITY;
    self.params.saturation = DEFAULT_SATURATION;
    self.params.warmth = DEFAULT_WARMTH;
    self.params.mix = DEFAULT_MIX;

    // ---------- Tape saturation (tanh WaveShaper) ----------
    self.satShaper = ctx.createWaveShaper();
    self.satShaper.oversample = '2x';
    self.satShaper.curve = self._buildSatCurve();

    // ---------- Modulated delay (wow + flutter) ----------
    self.delayLine = ctx.createDelay(DELAY_LINE_MAX_S);
    self.delayLine.delayTime.value = DELAY_BASE_S;

    self.wowLfo = ctx.createOscillator();
    self.wowLfo.type = 'sine';
    self.wowLfo.frequency.value = self._calcWowRateHz();
    self.wowGain = ctx.createGain();
    self.wowGain.gain.value = self._calcWowDepthS();
    self.wowLfo.connect(self.wowGain);
    self.wowGain.connect(self.delayLine.delayTime);
    self.wowLfo.start();

    self.flutterLfo = ctx.createOscillator();
    self.flutterLfo.type = 'sine';
    self.flutterLfo.frequency.value = self._calcFlutterRateHz();
    self.flutterGain = ctx.createGain();
    self.flutterGain.gain.value = self._calcFlutterDepthS();
    self.flutterLfo.connect(self.flutterGain);
    self.flutterGain.connect(self.delayLine.delayTime);
    self.flutterLfo.start();

    // ---------- Dropout gate ----------
    // Single multiplier GainNode. gain is scheduled directly with
    // setValueAtTime / linearRampToValueAtTime from audioContext.currentTime.
    self.dropoutGain = ctx.createGain();
    self.dropoutGain.gain.value = DROPOUT_NOMINAL_GAIN;
    self._dropoutScheduledUntil = ctx.currentTime;
    self._dropoutTimer = null;

    // ---------- HF rolloff ----------
    self.warmthLP = ctx.createBiquadFilter();
    self.warmthLP.type = 'lowpass';
    self.warmthLP.frequency.value = self._calcWarmthCutoffHz();
    self.warmthLP.Q.value = WARMTH_Q;

    // ---------- Wire ----------
    self.input.connect(self.satShaper);
    self.satShaper.connect(self.delayLine);
    self.delayLine.connect(self.dropoutGain);
    self.dropoutGain.connect(self.warmthLP);
    self.warmthLP.connect(self.wetGain);

    // Dropout scheduler starts when enabled via setEnabled(true)

    return self;
  }

  Object.setPrototypeOf(DriftscapeEffect.prototype, BaseEffect.prototype);
  Object.setPrototypeOf(DriftscapeEffect, BaseEffect);

  // ============ Helpers ============

  function clampUnit(v) {
    var x = v;
    if (x < UNIT_MIN) { x = UNIT_MIN; }
    if (x > UNIT_MAX) { x = UNIT_MAX; }
    return x;
  }

  function lerp(lo, hi, t) {
    return lo + (hi - lo) * t;
  }

  DriftscapeEffect.prototype._calcWowRateHz = function() {
    return lerp(WOW_RATE_MIN_HZ, WOW_RATE_MAX_HZ, clampUnit(this.params.wowRate));
  };

  DriftscapeEffect.prototype._calcWowDepthS = function() {
    return lerp(WOW_DEPTH_MIN_S, WOW_DEPTH_MAX_S, clampUnit(this.params.wowDepth));
  };

  DriftscapeEffect.prototype._calcFlutterRateHz = function() {
    return lerp(FLUTTER_RATE_MIN_HZ, FLUTTER_RATE_MAX_HZ, clampUnit(this.params.flutterRate));
  };

  DriftscapeEffect.prototype._calcFlutterDepthS = function() {
    return lerp(FLUTTER_DEPTH_MIN_S, FLUTTER_DEPTH_MAX_S, clampUnit(this.params.flutterDepth));
  };

  DriftscapeEffect.prototype._calcDropoutDensityHz = function() {
    return lerp(DROPOUT_DENSITY_MIN_HZ, DROPOUT_DENSITY_MAX_HZ, clampUnit(this.params.dropoutDensity));
  };

  DriftscapeEffect.prototype._calcSatDrive = function() {
    return lerp(SAT_DRIVE_MIN, SAT_DRIVE_MAX, clampUnit(this.params.saturation));
  };

  DriftscapeEffect.prototype._calcWarmthCutoffHz = function() {
    // warmth=0 -> 12 kHz (bright), warmth=1 -> 2 kHz (dark)
    var w = clampUnit(this.params.warmth);
    return lerp(WARMTH_CUTOFF_MAX_HZ, WARMTH_CUTOFF_MIN_HZ, w);
  };

  DriftscapeEffect.prototype._buildSatCurve = function() {
    var n = SAT_CURVE_SAMPLES;
    var curve = new Float32Array(n);
    var k = this._calcSatDrive();
    var norm = Math.tanh(k);
    var denom = norm;
    if (denom < 1e-6) { denom = 1e-6; }
    var i;
    for (i = 0; i < n; i++) {
      var x = (i * 2 / (n - 1)) - 1;
      curve[i] = Math.tanh(x * k) / denom;
    }
    return curve;
  };

  // Schedule dropouts out to DROPOUT_SCHEDULE_HORIZON_S ahead.
  // Uses a Poisson-ish process: inter-arrival = exponential(rate).
  DriftscapeEffect.prototype._scheduleDropouts = function() {
    var ctx = this.ctx;
    if (!ctx) { return; }
    var nowT = ctx.currentTime;
    var rate = this._calcDropoutDensityHz();
    var horizon = nowT + DROPOUT_SCHEDULE_HORIZON_S;

    var startT = this._dropoutScheduledUntil;
    if (startT < nowT) { startT = nowT; }

    if (rate <= 0) {
      // Hold nominal. Re-anchor schedule clock to now so we don't pile events later.
      try {
        this.dropoutGain.gain.setValueAtTime(DROPOUT_NOMINAL_GAIN, nowT);
      } catch (e) { /* ignore */ }
      this._dropoutScheduledUntil = horizon;
      return;
    }

    var t = startT;
    var safetyMax = 128;
    var iter = 0;
    while (t < horizon && iter < safetyMax) {
      // exponential inter-arrival
      var u = Math.random();
      if (u < 1e-6) { u = 1e-6; }
      var dt = -Math.log(u) / rate;
      t = t + dt;
      if (t >= horizon) { break; }

      var duration = DROPOUT_DURATION_MIN_S +
        Math.random() * (DROPOUT_DURATION_MAX_S - DROPOUT_DURATION_MIN_S);
      var edge = duration * DROPOUT_EDGE_FRACTION;
      var tStart = t;
      var tDown = tStart + edge;
      var tUpStart = tStart + duration - edge;
      var tUpEnd = tStart + duration;

      try {
        this.dropoutGain.gain.setValueAtTime(DROPOUT_NOMINAL_GAIN, tStart);
        this.dropoutGain.gain.linearRampToValueAtTime(DROPOUT_MIN_GAIN, tDown);
        this.dropoutGain.gain.setValueAtTime(DROPOUT_MIN_GAIN, tUpStart);
        this.dropoutGain.gain.linearRampToValueAtTime(DROPOUT_NOMINAL_GAIN, tUpEnd);
      } catch (e) { /* ignore scheduling errors on disposed contexts */ }

      t = tUpEnd;
      iter++;
    }

    this._dropoutScheduledUntil = horizon;
  };

  DriftscapeEffect.prototype._startDropoutTimer = function() {
    var self = this;
    if (self._dropoutTimer !== null) { return; }
    // setInterval is only meaningful in a realtime context; OfflineAudioContext
    // probes should call _scheduleDropouts() explicitly before rendering.
    if (typeof setInterval === 'function') {
      self._dropoutTimer = setInterval(function() {
        self._scheduleDropouts();
      }, DROPOUT_RESCHEDULE_INTERVAL_MS);
    }
  };

  DriftscapeEffect.prototype._stopDropoutTimer = function() {
    if (this._dropoutTimer !== null && typeof clearInterval === 'function') {
      clearInterval(this._dropoutTimer);
      this._dropoutTimer = null;
    }
  };

  // Pre-schedule for a finite render (used by offline probes).
  DriftscapeEffect.prototype.primeForOfflineRender = function(totalSeconds) {
    var ctx = this.ctx;
    if (!ctx) { return; }
    var rate = this._calcDropoutDensityHz();
    if (rate <= 0) { return; }
    var t = ctx.currentTime;
    var safetyMax = 4096;
    var iter = 0;
    while (t < totalSeconds && iter < safetyMax) {
      var u = Math.random();
      if (u < 1e-6) { u = 1e-6; }
      var dt = -Math.log(u) / rate;
      t = t + dt;
      if (t >= totalSeconds) { break; }
      var duration = DROPOUT_DURATION_MIN_S +
        Math.random() * (DROPOUT_DURATION_MAX_S - DROPOUT_DURATION_MIN_S);
      var edge = duration * DROPOUT_EDGE_FRACTION;
      var tStart = t;
      var tDown = tStart + edge;
      var tUpStart = tStart + duration - edge;
      var tUpEnd = tStart + duration;
      try {
        this.dropoutGain.gain.setValueAtTime(DROPOUT_NOMINAL_GAIN, tStart);
        this.dropoutGain.gain.linearRampToValueAtTime(DROPOUT_MIN_GAIN, tDown);
        this.dropoutGain.gain.setValueAtTime(DROPOUT_MIN_GAIN, tUpStart);
        this.dropoutGain.gain.linearRampToValueAtTime(DROPOUT_NOMINAL_GAIN, tUpEnd);
      } catch (e) { /* ignore */ }
      t = tUpEnd;
      iter++;
    }
  };

  DriftscapeEffect.prototype.setEnabled = function(on) {
    BaseEffect.prototype.setEnabled.call(this, on);
    if (on) {
      this._scheduleDropouts();
      this._startDropoutTimer();
    } else {
      this._stopDropoutTimer();
    }
  };

  // ============ updateParam ============
  DriftscapeEffect.prototype.updateParam = function(name, value) {
    var t = this.ctx.currentTime;

    if (name === 'mix') {
      // Let BaseEffect.setMix handle via default path
      var clampedMix = value;
      if (clampedMix < MIX_PCT_MIN) { clampedMix = MIX_PCT_MIN; }
      if (clampedMix > MIX_PCT_MAX) { clampedMix = MIX_PCT_MAX; }
      this.params.mix = clampedMix;
      if (typeof this.setMix === 'function') {
        this.setMix(clampedMix);
      }
      return;
    }

    var unit = clampUnit(value);

    switch (name) {
      case 'wowDepth':
        this.params.wowDepth = unit;
        this.wowGain.gain.setTargetAtTime(this._calcWowDepthS(), t, SMOOTH_TC);
        break;
      case 'wowRate':
        this.params.wowRate = unit;
        this.wowLfo.frequency.setTargetAtTime(this._calcWowRateHz(), t, SMOOTH_TC);
        break;
      case 'flutterDepth':
        this.params.flutterDepth = unit;
        this.flutterGain.gain.setTargetAtTime(this._calcFlutterDepthS(), t, SMOOTH_TC);
        break;
      case 'flutterRate':
        this.params.flutterRate = unit;
        this.flutterLfo.frequency.setTargetAtTime(this._calcFlutterRateHz(), t, SMOOTH_TC);
        break;
      case 'dropoutDensity':
        this.params.dropoutDensity = unit;
        // Let the next scheduler tick pick up new density naturally.
        break;
      case 'saturation':
        this.params.saturation = unit;
        this.satShaper.curve = this._buildSatCurve();
        break;
      case 'warmth':
        this.params.warmth = unit;
        this.warmthLP.frequency.setTargetAtTime(this._calcWarmthCutoffHz(), t, SMOOTH_TC);
        break;
      default:
        break;
    }
  };

  DriftscapeEffect.prototype.dispose = function() {
    this._stopDropoutTimer();
    try { this.wowLfo.stop(); } catch (e) { /* not started */ }
    try { this.flutterLfo.stop(); } catch (e) { /* not started */ }
    this.wowLfo.disconnect();
    this.flutterLfo.disconnect();
    this.wowGain.disconnect();
    this.flutterGain.disconnect();
    this.satShaper.disconnect();
    this.delayLine.disconnect();
    this.dropoutGain.disconnect();
    this.warmthLP.disconnect();
    BaseEffect.prototype.dispose.call(this);
  };

  SL.effects.Driftscape = DriftscapeEffect;
  SL.effects.DriftscapeEffect = DriftscapeEffect;

})();
