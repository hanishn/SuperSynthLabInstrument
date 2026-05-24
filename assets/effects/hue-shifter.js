// Synth Lab - Hue Shifter (generic multi-character coloration effect)
//
// A multi-mode "character" pedal: each mode is a distinct flavor of lo-fi / pitch
// coloration. Five characters supported:
//
//   0 Tape        - short modulated delay + tanh drive + HF rolloff + pitch drift
//   1 Fluctuator  - random-LFO modulated longer delay (drunk wow)
//   2 Octaver     - parallel octave-up + octave-down via dual delay-line pitch shift
//   3 Drum        - rhythmic amplitude gate (stuttered slice)
//   4 Reverse     - short reverse-chunk delay-line playback (best-effort w/o worklet)
//
// Shared chain (applied in all characters):
//   input -> driveShaper -> [character block] -> toneLow(lowshelf) -> toneHigh(highshelf)
//         -> wetGain -> (mixer via BaseEffect)
//   Parallel dry: BaseEffect's input -> dryGain -> output
//
// BaseEffect is an ES6 class; we construct via Reflect.construct (same pattern lofi.js uses).
// ES5 in function bodies. Named constants only — no magic numbers.

(function() {
  var SL = window.SynthLab = window.SynthLab || {};
  SL.effects = SL.effects || {};
  var BaseEffect = SL.effects.BaseEffect;

  // ============ Character IDs ============
  var CHAR_TAPE = 0;
  var CHAR_FLUCTUATOR = 1;
  var CHAR_OCTAVER = 2;
  var CHAR_DRUM = 3;
  var CHAR_REVERSE = 4;
  var CHAR_COUNT = 5;
  var CHAR_DEFAULT = CHAR_TAPE;

  // ============ Param ranges ============
  var PCT_MIN = 0;
  var PCT_MAX = 100;
  var UNIT_MIN = 0;
  var UNIT_MAX = 1;

  // Defaults (0..100 scale — matches other effects' param space)
  var DEFAULT_MIX = 50;
  var DEFAULT_DRIVE = 35;
  var DEFAULT_TONE = 50;       // 50 = flat, <50 dark, >50 bright
  var DEFAULT_RATE = 40;
  var DEFAULT_DEPTH = 50;

  // ============ Shared: drive (tanh soft-clip) ============
  var DRIVE_CURVE_SAMPLES = 2048;
  var DRIVE_MIN_K = 1.0;       // drive=0 -> nearly linear
  var DRIVE_MAX_K = 6.0;       // drive=100 -> hard tanh
  var DRIVE_OUT_TRIM = 0.85;

  // ============ Shared: tone (low/high shelves) ============
  var TONE_LOW_HZ = 250;
  var TONE_HIGH_HZ = 3500;
  var TONE_SHELF_MAX_DB = 9;   // +/- at extremes
  var SMOOTH_TC = 0.01;

  // ============ Tape character ============
  var TAPE_BASE_DELAY_S = 0.018;       // 18 ms
  var TAPE_MAX_DELAY_S = 0.05;
  var TAPE_RATE_MIN_HZ = 0.3;
  var TAPE_RATE_MAX_HZ = 6.0;
  var TAPE_MAX_MOD_DEPTH_S = 0.004;    // ~4 ms at depth=100
  var TAPE_LP_MIN_HZ = 2500;           // bright tone override still applies post
  var TAPE_LP_MAX_HZ = 8000;
  var TAPE_LP_Q = 0.7;

  // ============ Fluctuator character ============
  var FLUX_BASE_DELAY_S = 0.040;       // 40 ms base
  var FLUX_MAX_DELAY_S = 0.12;
  var FLUX_MAX_MOD_DEPTH_S = 0.035;    // very drunk at depth=100
  var FLUX_NOISE_BUF_SECS = 4;
  var FLUX_NOISE_LP_MIN_HZ = 0.5;      // filter noise into slow wander; filter cutoff = rate
  var FLUX_NOISE_LP_MAX_HZ = 20;
  var FLUX_NOISE_BUF_SAMPLES_PER_SEC_TARGET = 48000;

  // ============ Octaver character ============
  // Dual delay-line pitch shifter: two overlapping read heads, each ramped by a
  // sawtooth LFO on delayTime. Triangle amplitude envelopes crossfade the heads.
  var OCT_DELAY_LINE_MAX_S = 0.2;
  var OCT_WINDOW_S = 0.08;             // 80 ms grain
  var OCT_UP_RATIO = 2.0;              // octave up
  var OCT_DOWN_RATIO = 0.5;            // octave down
  var OCT_UP_GAIN = 0.55;
  var OCT_DOWN_GAIN = 0.45;
  var OCT_DRY_BASE = 0.6;
  // For pitchRatio R with window W seconds, the saw LFO frequency is
  //    f = |R - 1| / W
  // and the saw peak-to-peak is W, so using a positive-ramp saw of amplitude W/2
  // through a DelayNode delayTime yields an (R=1+slope)-shifted output.
  // Slope of saw is freq * peakToPeak = |R-1|.

  // ============ Drum character ============
  var DRUM_RATE_MIN_HZ = 0.5;
  var DRUM_RATE_MAX_HZ = 12.0;
  var DRUM_GATE_MIN_DUTY = 0.15;       // depth=100: short gate (stuttery)
  var DRUM_GATE_MAX_DUTY = 0.85;       // depth=0:   barely-gated
  var DRUM_ATTACK_TC = 0.003;
  var DRUM_RELEASE_TC = 0.02;
  var DRUM_LFO_AMPLITUDE = 0.5;        // +/- 0.5 around offset so threshold trick works
  var DRUM_CURVE_SAMPLES = 1024;

  // ============ Reverse character ============
  // Approximation without worklet: a comb of 4 fixed taps with inverted (*-1) gain
  // and a short LFO'd delay → produces backwards-ish smear. Documented as limited.
  var REV_TAP_COUNT = 4;
  var REV_TAP_BASE_S = 0.12;           // 120 ms base chunk
  var REV_TAP_SPREAD_S = 0.18;         // spread up to ~300 ms
  var REV_LFO_RATE_MIN_HZ = 0.2;
  var REV_LFO_RATE_MAX_HZ = 3.0;
  var REV_LFO_DEPTH_S = 0.02;
  var REV_MAX_DELAY_S = 0.5;
  var REV_LP_HZ = 5000;

  /**
   * HueShifterEffect
   *
   * params (0..100 unless noted):
   *   character (0..CHAR_COUNT-1)
   *   mix (0..100)
   *   drive (0..100)
   *   tone (0..100, 50 = flat)
   *   rate (0..100 -> char-specific)
   *   depth (0..100 -> char-specific)
   */
  function HueShifterEffect(ctx) {
    var self = Reflect.construct(BaseEffect, [ctx, 'hueShifter'], HueShifterEffect);

    self.params.character = CHAR_DEFAULT;
    self.params.mix = DEFAULT_MIX;
    self.params.drive = DEFAULT_DRIVE;
    self.params.tone = DEFAULT_TONE;
    self.params.rate = DEFAULT_RATE;
    self.params.depth = DEFAULT_DEPTH;

    // Shared pre-chain: drive waveshaper
    self.driveShaper = ctx.createWaveShaper();
    self.driveShaper.oversample = '2x';
    self.driveShaper.curve = self._buildDriveCurve();

    self.driveTrim = ctx.createGain();
    self.driveTrim.gain.value = DRIVE_OUT_TRIM;

    // Shared post-chain: tone (low + high shelves) + wet gain (wetGain is on BaseEffect)
    self.toneLow = ctx.createBiquadFilter();
    self.toneLow.type = 'lowshelf';
    self.toneLow.frequency.value = TONE_LOW_HZ;
    self.toneLow.gain.value = self._calcToneLowGainDb();

    self.toneHigh = ctx.createBiquadFilter();
    self.toneHigh.type = 'highshelf';
    self.toneHigh.frequency.value = TONE_HIGH_HZ;
    self.toneHigh.gain.value = self._calcToneHighGainDb();

    // Character-block container: per-build node bag
    self.charNodes = {};

    // Wire fixed pre-chain
    self.input.connect(self.driveShaper);
    self.driveShaper.connect(self.driveTrim);
    // driveTrim -> (character block input) set up in _buildCharacter

    // Build initial character
    self._buildCharacter();

    return self;
  }

  // Inherit from BaseEffect (ES6 class) via prototype chain
  Object.setPrototypeOf(HueShifterEffect.prototype, BaseEffect.prototype);
  Object.setPrototypeOf(HueShifterEffect, BaseEffect);

  // ============ Shared curve / tone helpers ============

  HueShifterEffect.prototype._buildDriveCurve = function() {
    var drivePct = this.params.drive / PCT_MAX;
    var range = DRIVE_MAX_K - DRIVE_MIN_K;
    var k = DRIVE_MIN_K + range * drivePct;
    var norm = Math.tanh(k);
    var n = DRIVE_CURVE_SAMPLES;
    var curve = new Float32Array(n);
    var i = 0;
    for (i = 0; i < n; i++) {
      var x = ((i * 2) / (n - 1)) - 1;
      curve[i] = Math.tanh(x * k) / norm;
    }
    return curve;
  };

  HueShifterEffect.prototype._calcToneLowGainDb = function() {
    // tone 50 = flat; below 50 boost low shelf (dark), above 50 cut low shelf (bright)
    var t = this.params.tone;
    var offset = (t - 50) / 50; // -1 .. +1
    var gainDb = -offset * TONE_SHELF_MAX_DB;
    return gainDb;
  };

  HueShifterEffect.prototype._calcToneHighGainDb = function() {
    // tone 50 = flat; above 50 boost high shelf (bright), below 50 cut high shelf (dark)
    var t = this.params.tone;
    var offset = (t - 50) / 50;
    var gainDb = offset * TONE_SHELF_MAX_DB;
    return gainDb;
  };

  // ============ Character build/dispose ============

  HueShifterEffect.prototype._disposeCharacter = function() {
    var n = this.charNodes;
    if (!n) { return; }
    // Stop LFOs / sources
    if (n.lfos) {
      var i = 0;
      for (i = 0; i < n.lfos.length; i++) {
        try { n.lfos[i].stop(); } catch (e) { /* not started */ }
        n.lfos[i].disconnect();
      }
    }
    if (n.noiseSource) {
      try { n.noiseSource.stop(); } catch (e) { /* not started */ }
      n.noiseSource.disconnect();
    }
    // Disconnect any node bag fields that have disconnect()
    var keys = Object.keys(n);
    var k = 0;
    for (k = 0; k < keys.length; k++) {
      var v = n[keys[k]];
      if (v && typeof v.disconnect === 'function') {
        try { v.disconnect(); } catch (e) { /* ignore */ }
      }
    }
    // Make sure tone nodes get disconnected too (they're not in charNodes but
    // they feed from the character block's output — we re-wire on build)
    try { this.toneLow.disconnect(); } catch (e) { /* ignore */ }
    try { this.toneHigh.disconnect(); } catch (e) { /* ignore */ }
    try { this.driveTrim.disconnect(); } catch (e) { /* ignore */ }

    this.charNodes = {};
  };

  HueShifterEffect.prototype._buildCharacter = function() {
    this._disposeCharacter();
    var ch = this.params.character;
    if (ch === CHAR_TAPE) {
      this._buildTape();
    } else if (ch === CHAR_FLUCTUATOR) {
      this._buildFluctuator();
    } else if (ch === CHAR_OCTAVER) {
      this._buildOctaver();
    } else if (ch === CHAR_DRUM) {
      this._buildDrum();
    } else if (ch === CHAR_REVERSE) {
      this._buildReverse();
    } else {
      this._buildTape();
    }
    // Re-wire drive -> character-in already done in builders.
    // Every builder terminates in charNodes.output, which we now wire to tone -> wetGain.
    var out = this.charNodes.output;
    out.connect(this.toneLow);
    this.toneLow.connect(this.toneHigh);
    this.toneHigh.connect(this.wetGain);

    // Re-establish driveTrim -> character input (builder sets charNodes.input)
    this.driveTrim.connect(this.charNodes.input);
  };

  // ============ Tape character ============

  HueShifterEffect.prototype._buildTape = function() {
    var ctx = this.ctx;

    var inG = ctx.createGain();
    var outG = ctx.createGain();

    var delay = ctx.createDelay(TAPE_MAX_DELAY_S);
    delay.delayTime.value = TAPE_BASE_DELAY_S;

    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = this._tapeLpHz();
    lp.Q.value = TAPE_LP_Q;

    // Modulation: sine LFO
    var lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = this._tapeRateHz();
    var lfoGain = ctx.createGain();
    lfoGain.gain.value = this._tapeDepthS();
    lfo.connect(lfoGain);
    lfoGain.connect(delay.delayTime);
    lfo.start();

    // Wire: input -> delay -> lp -> output (parallel to an internal dry passthrough
    // inside the character block so the user always hears SOMETHING of the signal
    // even at depth=0; the BaseEffect dry path is a separate concern).
    inG.connect(delay);
    delay.connect(lp);
    lp.connect(outG);
    // small blend of pre-delay input directly so low depth still passes signal
    inG.connect(outG);

    this.charNodes = {
      input: inG,
      output: outG,
      delay: delay,
      lp: lp,
      lfos: [lfo],
      lfoGain: lfoGain
    };
  };

  HueShifterEffect.prototype._tapeRateHz = function() {
    var pct = this.params.rate / PCT_MAX;
    var range = TAPE_RATE_MAX_HZ - TAPE_RATE_MIN_HZ;
    return TAPE_RATE_MIN_HZ + range * pct;
  };

  HueShifterEffect.prototype._tapeDepthS = function() {
    var pct = this.params.depth / PCT_MAX;
    return TAPE_MAX_MOD_DEPTH_S * pct;
  };

  HueShifterEffect.prototype._tapeLpHz = function() {
    // depth also darkens tape (more flutter = more rolled-off tape)
    var pct = this.params.depth / PCT_MAX;
    var range = TAPE_LP_MAX_HZ - TAPE_LP_MIN_HZ;
    return TAPE_LP_MAX_HZ - range * pct;
  };

  // ============ Fluctuator character ============

  HueShifterEffect.prototype._buildFluctuator = function() {
    var ctx = this.ctx;

    var inG = ctx.createGain();
    var outG = ctx.createGain();

    var delay = ctx.createDelay(FLUX_MAX_DELAY_S);
    delay.delayTime.value = FLUX_BASE_DELAY_S;

    // Noise-driven random modulator: a low-passed white noise buffer source
    // connected to the delay's delayTime. Cutoff is set by `rate`.
    var noiseBuf = this._createFluxNoiseBuffer();
    var noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuf;
    noiseSrc.loop = true;

    var noiseLp = ctx.createBiquadFilter();
    noiseLp.type = 'lowpass';
    noiseLp.frequency.value = this._fluxNoiseLpHz();
    noiseLp.Q.value = 0.707;

    var modGain = ctx.createGain();
    modGain.gain.value = this._fluxDepthS();

    noiseSrc.connect(noiseLp);
    noiseLp.connect(modGain);
    modGain.connect(delay.delayTime);
    noiseSrc.start();

    inG.connect(delay);
    delay.connect(outG);
    inG.connect(outG);

    this.charNodes = {
      input: inG,
      output: outG,
      delay: delay,
      noiseSource: noiseSrc,
      noiseLp: noiseLp,
      modGain: modGain
    };
  };

  HueShifterEffect.prototype._createFluxNoiseBuffer = function() {
    var sr = this.ctx.sampleRate;
    var len = sr * FLUX_NOISE_BUF_SECS;
    var buf = this.ctx.createBuffer(1, len, sr);
    var data = buf.getChannelData(0);
    var i = 0;
    for (i = 0; i < len; i++) {
      data[i] = (Math.random() * 2) - 1;
    }
    return buf;
  };

  HueShifterEffect.prototype._fluxNoiseLpHz = function() {
    var pct = this.params.rate / PCT_MAX;
    var range = FLUX_NOISE_LP_MAX_HZ - FLUX_NOISE_LP_MIN_HZ;
    return FLUX_NOISE_LP_MIN_HZ + range * pct;
  };

  HueShifterEffect.prototype._fluxDepthS = function() {
    var pct = this.params.depth / PCT_MAX;
    return FLUX_MAX_MOD_DEPTH_S * pct;
  };

  // ============ Octaver character ============
  //
  // Dual-delay-line granular pitch shifter. For pitch ratio R we drive delayTime
  // with a ramp (sawtooth) of slope (1 - R): that is, if we read a delay line
  // whose delay is decreasing at rate (R-1), then "effective read speed" = R*
  // source. To keep continuity, run two grains with triangular amplitude envelopes
  // that crossfade every OCT_WINDOW_S seconds, phased 180° apart.
  //
  // Implementation detail: a sawtooth LFO (createOscillator type='sawtooth') has
  // peak-to-peak of 2.0 and freq f. Scaled to amplitude A, slope is (2A)*f. For
  // OCT_WINDOW_S window and ratio R: desired slope magnitude = |R-1|, freq =
  // 1/OCT_WINDOW_S, so A = |R-1| * OCT_WINDOW_S / 2.
  //
  // We create one pitch-shifter sub-chain for UP and one for DOWN, then mix with
  // the dry (bypassing the per-character inner passthrough).

  HueShifterEffect.prototype._buildOctaver = function() {
    var ctx = this.ctx;
    var inG = ctx.createGain();
    var outG = ctx.createGain();

    // dry blend
    var dryG = ctx.createGain();
    dryG.gain.value = this._octDryGain();
    inG.connect(dryG);
    dryG.connect(outG);

    // Build two shifter sub-chains
    var upChain = this._buildOctShifter(OCT_UP_RATIO);
    var downChain = this._buildOctShifter(OCT_DOWN_RATIO);

    var upG = ctx.createGain();
    upG.gain.value = OCT_UP_GAIN * (this.params.depth / PCT_MAX);
    var downG = ctx.createGain();
    downG.gain.value = OCT_DOWN_GAIN * (this.params.depth / PCT_MAX);

    inG.connect(upChain.input);
    inG.connect(downChain.input);
    upChain.output.connect(upG);
    downChain.output.connect(downG);
    upG.connect(outG);
    downG.connect(outG);

    this.charNodes = {
      input: inG,
      output: outG,
      dryG: dryG,
      upG: upG,
      downG: downG,
      // gather LFOs/nodes from sub-chains for dispose
      lfos: upChain.lfos.concat(downChain.lfos),
      subNodes: upChain.nodes.concat(downChain.nodes)
    };
  };

  HueShifterEffect.prototype._buildOctShifter = function(ratio) {
    var ctx = this.ctx;

    var inG = ctx.createGain();
    var outG = ctx.createGain();

    var slopeMag = Math.abs(ratio - 1);
    var lfoFreq = slopeMag / OCT_WINDOW_S;
    var lfoAmp = slopeMag * OCT_WINDOW_S / 2;

    // For ratio > 1 (octave up) we want delay to *decrease* over time -> read speed > 1.
    // A positive-ramp sawtooth (Web Audio default) produces increasing signal -> we
    // need to INVERT it to make delay decrease. For ratio < 1 (octave down), the
    // delay should INCREASE, so we keep it positive.
    var invert = (ratio > 1);

    var lfo1 = ctx.createOscillator();
    lfo1.type = 'sawtooth';
    lfo1.frequency.value = lfoFreq;
    var lfo2 = ctx.createOscillator();
    lfo2.type = 'sawtooth';
    lfo2.frequency.value = lfoFreq;

    var scale1 = ctx.createGain();
    var scale2 = ctx.createGain();
    var s = invert ? -lfoAmp : lfoAmp;
    scale1.gain.value = s;
    scale2.gain.value = s;

    // Center-offset so delay is positive and within [0, OCT_WINDOW_S]
    var offset1 = ctx.createConstantSource();
    offset1.offset.value = OCT_WINDOW_S / 2;
    var offset2 = ctx.createConstantSource();
    offset2.offset.value = OCT_WINDOW_S / 2;
    offset1.start();
    offset2.start();

    var delay1 = ctx.createDelay(OCT_DELAY_LINE_MAX_S);
    delay1.delayTime.value = OCT_WINDOW_S / 2;
    var delay2 = ctx.createDelay(OCT_DELAY_LINE_MAX_S);
    delay2.delayTime.value = OCT_WINDOW_S / 2;

    lfo1.connect(scale1);
    scale1.connect(delay1.delayTime);
    offset1.connect(delay1.delayTime);

    lfo2.connect(scale2);
    scale2.connect(delay2.delayTime);
    offset2.connect(delay2.delayTime);

    // Start lfo2 half-window later so its phase is 180° offset (two grains crossfade)
    var now = ctx.currentTime;
    lfo1.start(now);
    lfo2.start(now + (1 / (2 * lfoFreq)));

    // Amplitude envelopes: cosine-window via gain modulated by sine LFOs at lfoFreq,
    // offset-shifted to [0,1]. env1 = 0.5 + 0.5*cos(2*pi*f*t), env2 phase-shifted.
    var envLfo1 = ctx.createOscillator();
    envLfo1.type = 'sine';
    envLfo1.frequency.value = lfoFreq;
    var envLfo2 = ctx.createOscillator();
    envLfo2.type = 'sine';
    envLfo2.frequency.value = lfoFreq;

    var envScale1 = ctx.createGain();
    envScale1.gain.value = 0.5;
    var envScale2 = ctx.createGain();
    envScale2.gain.value = 0.5;

    var envOffset1 = ctx.createConstantSource();
    envOffset1.offset.value = 0.5;
    envOffset1.start();
    var envOffset2 = ctx.createConstantSource();
    envOffset2.offset.value = 0.5;
    envOffset2.start();

    var env1 = ctx.createGain();
    env1.gain.value = 0.5;
    var env2 = ctx.createGain();
    env2.gain.value = 0.5;

    envLfo1.connect(envScale1);
    envScale1.connect(env1.gain);
    envOffset1.connect(env1.gain);

    envLfo2.connect(envScale2);
    envScale2.connect(env2.gain);
    envOffset2.connect(env2.gain);

    envLfo1.start(now);
    envLfo2.start(now + (1 / (2 * lfoFreq)));

    inG.connect(delay1);
    inG.connect(delay2);
    delay1.connect(env1);
    delay2.connect(env2);
    env1.connect(outG);
    env2.connect(outG);

    return {
      input: inG,
      output: outG,
      lfos: [lfo1, lfo2, envLfo1, envLfo2, offset1, offset2, envOffset1, envOffset2],
      nodes: [scale1, scale2, delay1, delay2, env1, env2, envScale1, envScale2]
    };
  };

  HueShifterEffect.prototype._octDryGain = function() {
    // Higher depth pushes toward octaves (less dry); lower depth preserves dry.
    var pct = this.params.depth / PCT_MAX;
    return OCT_DRY_BASE * (1 - (pct * 0.6));
  };

  // ============ Drum character ============

  HueShifterEffect.prototype._buildDrum = function() {
    var ctx = this.ctx;

    var inG = ctx.createGain();
    var outG = ctx.createGain();

    // Gate via a Gain whose .gain is modulated by a sawtooth-driven waveshaper
    // that produces a threshold step (rectangular duty gate).
    var gate = ctx.createGain();
    gate.gain.value = 0; // driven entirely by LFO chain, so start at 0

    // LFO: sine -> waveshaper (squares it with adjustable duty) -> smoothing -> gate.gain
    var lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = this._drumRateHz();

    var amp = ctx.createGain();
    amp.gain.value = DRUM_LFO_AMPLITUDE;

    var shaper = ctx.createWaveShaper();
    shaper.curve = this._buildDrumCurve();

    // Bring gate signal to [0,1] range via offset
    var offset = ctx.createConstantSource();
    offset.offset.value = 0;  // the shaper already outputs [0,1]
    offset.start();

    lfo.connect(amp);
    amp.connect(shaper);
    shaper.connect(gate.gain);
    offset.connect(gate.gain);
    lfo.start();

    inG.connect(gate);
    gate.connect(outG);

    this.charNodes = {
      input: inG,
      output: outG,
      gate: gate,
      shaper: shaper,
      amp: amp,
      lfos: [lfo, offset]
    };
  };

  HueShifterEffect.prototype._drumRateHz = function() {
    var pct = this.params.rate / PCT_MAX;
    var range = DRUM_RATE_MAX_HZ - DRUM_RATE_MIN_HZ;
    return DRUM_RATE_MIN_HZ + range * pct;
  };

  HueShifterEffect.prototype._drumDuty = function() {
    // depth=0 -> longest duty (barely gated), depth=100 -> shortest duty
    var pct = this.params.depth / PCT_MAX;
    var range = DRUM_GATE_MAX_DUTY - DRUM_GATE_MIN_DUTY;
    return DRUM_GATE_MAX_DUTY - range * pct;
  };

  HueShifterEffect.prototype._buildDrumCurve = function() {
    // Threshold curve: input x in [-0.5, +0.5] maps to 0 or 1 based on duty.
    // The LFO amp ramps sine between [-0.5, +0.5]; we set a threshold T such
    // that fraction of cycle where sin > T equals duty.
    //   duty = acos(2T) / pi   (using sin(2*pi*f*t) > T)
    // Solving: T = cos(pi * duty) / 2
    // Instead of math, we just use y = (x > T ? 1 : 0) over the curve domain.
    var duty = this._drumDuty();
    var T = Math.cos(Math.PI * duty) / 2;
    var n = DRUM_CURVE_SAMPLES;
    var curve = new Float32Array(n);
    var i = 0;
    for (i = 0; i < n; i++) {
      var x = ((i * 2) / (n - 1)) - 1;  // WaveShaper maps -1..1
      var v = (x > T) ? 1 : 0;
      curve[i] = v;
    }
    return curve;
  };

  // ============ Reverse character (no-worklet approximation) ============

  HueShifterEffect.prototype._buildReverse = function() {
    // Best-effort without a worklet: sum several inverted, LFO-modulated delay
    // taps to produce a pre-echo / swelled smear. This is NOT a true reverse but
    // has a distinct character (inverted-sum comb) clearly different from others.
    // TODO: a proper reverse mode requires an AudioWorklet that records then
    // plays back chunks backwards.
    var ctx = this.ctx;
    var inG = ctx.createGain();
    var outG = ctx.createGain();

    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = REV_LP_HZ;
    lp.Q.value = 0.707;

    var allLfos = [];
    var allNodes = [lp];
    var depthPct = this.params.depth / PCT_MAX;
    var rateHz = REV_LFO_RATE_MIN_HZ + (REV_LFO_RATE_MAX_HZ - REV_LFO_RATE_MIN_HZ) * (this.params.rate / PCT_MAX);

    var i = 0;
    for (i = 0; i < REV_TAP_COUNT; i++) {
      var t0 = REV_TAP_BASE_S + (i * (REV_TAP_SPREAD_S / REV_TAP_COUNT));
      var delay = ctx.createDelay(REV_MAX_DELAY_S);
      delay.delayTime.value = t0;

      var lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = rateHz * (1 + (i * 0.17));
      var lfoGain = ctx.createGain();
      lfoGain.gain.value = REV_LFO_DEPTH_S * depthPct;
      lfo.connect(lfoGain);
      lfoGain.connect(delay.delayTime);
      lfo.start();

      // Inverted tap
      var tapG = ctx.createGain();
      tapG.gain.value = (i % 2 === 0) ? -0.5 : 0.5;

      inG.connect(delay);
      delay.connect(tapG);
      tapG.connect(lp);

      allLfos.push(lfo);
      allNodes.push(delay);
      allNodes.push(lfoGain);
      allNodes.push(tapG);
    }

    lp.connect(outG);
    // Also pass a bit of input so effect isn't completely inaudible at depth 0
    var passG = ctx.createGain();
    passG.gain.value = 0.3;
    inG.connect(passG);
    passG.connect(outG);
    allNodes.push(passG);

    this.charNodes = {
      input: inG,
      output: outG,
      lp: lp,
      lfos: allLfos,
      revNodes: allNodes
    };
  };

  // ============ updateParam ============

  HueShifterEffect.prototype.updateParam = function(name, value) {
    var t = this.ctx.currentTime;

    if (name === 'character') {
      var ch = Math.max(0, Math.min(CHAR_COUNT - 1, Math.round(value)));
      if (ch !== this.params.character) {
        this.params.character = ch;
        this._buildCharacter();
      }
      return;
    }

    var clamped = Math.max(PCT_MIN, Math.min(PCT_MAX, value));

    if (name === 'drive') {
      this.params.drive = clamped;
      this.driveShaper.curve = this._buildDriveCurve();
      return;
    }
    if (name === 'tone') {
      this.params.tone = clamped;
      this.toneLow.gain.setTargetAtTime(this._calcToneLowGainDb(), t, SMOOTH_TC);
      this.toneHigh.gain.setTargetAtTime(this._calcToneHighGainDb(), t, SMOOTH_TC);
      return;
    }
    if (name === 'rate' || name === 'depth') {
      this.params[name] = clamped;
      this._applyRateDepthToCharacter(t);
      return;
    }
  };

  HueShifterEffect.prototype._applyRateDepthToCharacter = function(t) {
    var ch = this.params.character;
    var n = this.charNodes;
    if (!n) { return; }

    if (ch === CHAR_TAPE) {
      if (n.lfos && n.lfos[0]) {
        n.lfos[0].frequency.setTargetAtTime(this._tapeRateHz(), t, SMOOTH_TC);
      }
      if (n.lfoGain) {
        n.lfoGain.gain.setTargetAtTime(this._tapeDepthS(), t, SMOOTH_TC);
      }
      if (n.lp) {
        n.lp.frequency.setTargetAtTime(this._tapeLpHz(), t, SMOOTH_TC);
      }
    } else if (ch === CHAR_FLUCTUATOR) {
      if (n.noiseLp) {
        n.noiseLp.frequency.setTargetAtTime(this._fluxNoiseLpHz(), t, SMOOTH_TC);
      }
      if (n.modGain) {
        n.modGain.gain.setTargetAtTime(this._fluxDepthS(), t, SMOOTH_TC);
      }
    } else if (ch === CHAR_OCTAVER) {
      // Octaver needs new depth applied to upG/downG; rate doesn't apply here.
      if (n.upG) {
        n.upG.gain.setTargetAtTime(OCT_UP_GAIN * (this.params.depth / PCT_MAX), t, SMOOTH_TC);
      }
      if (n.downG) {
        n.downG.gain.setTargetAtTime(OCT_DOWN_GAIN * (this.params.depth / PCT_MAX), t, SMOOTH_TC);
      }
      if (n.dryG) {
        n.dryG.gain.setTargetAtTime(this._octDryGain(), t, SMOOTH_TC);
      }
    } else if (ch === CHAR_DRUM) {
      if (n.lfos && n.lfos[0]) {
        n.lfos[0].frequency.setTargetAtTime(this._drumRateHz(), t, SMOOTH_TC);
      }
      if (n.shaper) {
        n.shaper.curve = this._buildDrumCurve();
      }
    } else if (ch === CHAR_REVERSE) {
      // Reverse mode rebuilds on rate/depth — taps are per-construction
      this._buildCharacter();
    }
  };

  HueShifterEffect.prototype.dispose = function() {
    this._disposeCharacter();
    try { this.driveShaper.disconnect(); } catch (e) { /* ignore */ }
    try { this.driveTrim.disconnect(); } catch (e) { /* ignore */ }
    try { this.toneLow.disconnect(); } catch (e) { /* ignore */ }
    try { this.toneHigh.disconnect(); } catch (e) { /* ignore */ }
    BaseEffect.prototype.dispose.call(this);
  };

  // Export constants for UI usage
  HueShifterEffect.CHAR_TAPE = CHAR_TAPE;
  HueShifterEffect.CHAR_FLUCTUATOR = CHAR_FLUCTUATOR;
  HueShifterEffect.CHAR_OCTAVER = CHAR_OCTAVER;
  HueShifterEffect.CHAR_DRUM = CHAR_DRUM;
  HueShifterEffect.CHAR_REVERSE = CHAR_REVERSE;
  HueShifterEffect.CHAR_COUNT = CHAR_COUNT;

  // Registration — matches pattern used by other effects (audio-engine.js maps by key)
  SL.effects.HueShifter = HueShifterEffect;
  SL.effects.HueShifterEffect = HueShifterEffect;

})();
