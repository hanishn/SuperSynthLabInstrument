// Synth Lab - Halo Effect
// Lush FDN (Feedback Delay Network) reverb with 8 delay lines,
// 8x8 Hadamard mixing matrix, per-line one-pole LPF damping (IIRFilterNode),
// and per-line delay-time modulation (0.3 Hz sines, irregular phase offsets)
// to decorrelate the modes and avoid metallic ringing. Non-trademarked.
//
// Signal chain (wet path):
//   input -> preDelay -> [8 parallel delay lines with 8x8 Hadamard feedback
//                         + per-line one-pole LPF damping + per-line LFO mod]
//         -> sum -> tone-tilt (lowshelf + highshelf) -> wetGain
//
// RT60 NOTE: the decay parameter maps to an RT60 target of 0.5s..60s, but the
// per-line feedback scalar is empirically capped at FEEDBACK_MAX (see below)
// because Web Audio's DelayNode + IIR feedback loop accumulates tiny numerical
// gain above that ceiling and diverges. Effective achievable RT60 with default
// delay times is ~3-7s (see _probe_halo.js measurements). Longer RT60 requires
// longer avg delay (crank `size`). See FEEDBACK_MAX comment.
//
// ES5 only. All numeric literals named constants. Factory shape follows lofi.js
// (Reflect.construct + setPrototypeOf) so BaseEffect ES6-class can be extended.

(function() {
  var SL = window.SynthLab = window.SynthLab || {};
  SL.effects = SL.effects || {};
  var BaseEffect = SL.effects.BaseEffect;

  // ============ Named constants ============

  // --- FDN topology ---
  var N_LINES = 8;

  // Mutually-prime-ish base delay times (ms). Longer spread = lusher tail.
  // Using primes keeps the effective echo density high and avoids coincident
  // periodicities that would cause audible metallic ringing. Spread spans
  // ~1 order of magnitude so modal density is high across the spectrum.
  var BASE_DELAY_TIMES_MS = [23, 31, 43, 59, 71, 89, 113, 149];

  // Per-line stereo offset (ms) applied to odd-index lines to decorrelate
  // periodicities. Kept small (a prime, not related to base times) so it
  // doesn't phase-align with any base time.
  var STEREO_OFFSET_MS = 7;

  // Hadamard 8x8 normalization factor: elements become +/- (1/sqrt(8))
  // so the matrix is orthogonal (unity gain) and feedback scaling is
  // controlled solely by the feedback scalar.
  var HADAMARD_NORM = 1.0 / Math.sqrt(N_LINES);

  // --- Delay-node capacity ---
  // Must accommodate longest delay at maximum size multiplier (2x)
  // plus headroom for modulation (a few ms). Longest = 149ms * 2 = 298ms.
  var DELAY_NODE_MAX_S = 0.5;
  var PREDELAY_NODE_MAX_S = 0.25;  // max preDelay param is 200 ms

  // --- Size ---
  // size in [0..1] maps delay times from 0.5x to 2.0x.
  // Average delay at size=1 with base primes is ~0.21s (max buffer 0.298s
  // for longest line). Size affects modal density AND available RT60 headroom
  // (since stable feedback is bounded, longer avg delay = longer reachable RT60).
  var SIZE_MIN_MULT = 0.5;
  var SIZE_MAX_MULT = 2.0;

  // --- Decay -> feedback mapping ---
  // decay in [0..1] maps to target RT60 seconds in [DECAY_MIN_S..DECAY_MAX_S].
  // Feedback per delay line is then computed from:
  //   fb = 10^( -3 * avg_delay_s / RT60 )
  // which yields -60 dB after RT60 seconds of recirculation.
  // NOTE: feedback is clamped to FEEDBACK_MAX (< 1) for stability.
  var DECAY_MIN_S = 0.5;
  var DECAY_MAX_S = 60.0;
  // Empirical stability ceiling: Web Audio's DelayNode + IIRFilter feedback
  // loop remains stable up to ~fb=0.85 in Chromium. Above that tiny numerical
  // gain in the cycle compounds and the tail diverges. 0.82 gives robust
  // headroom even with parameter smoothing transients. See _probe_halo.js
  // "FORCE FB TEST" for the empirical sweep that picks this value.
  var FEEDBACK_MAX = 0.82;
  var FEEDBACK_MIN = 0.10;        // corresponds to ~DECAY_MIN_S
  var RT60_TARGET_DB = 60.0;      // -60 dB reference

  // --- Damping (per-line one-pole LPF via BiquadFilterNode lowpass) ---
  // damping in [0..1] maps LPF cutoff from DAMP_HZ_OPEN (no damping,
  // highs preserved) down to DAMP_HZ_DARK (heavily damped).
  var DAMP_HZ_OPEN = 20000;
  var DAMP_HZ_DARK = 2000;

  // --- Mod depth (per-line delay-time modulation) ---
  // modDepth in [0..1] scales peak delay-time swing from 0 to MOD_MAX_S.
  // Each line gets its own LFO at MOD_RATE_HZ with a unique phase offset
  // so the lines decorrelate (kills metallic beating).
  var MOD_RATE_HZ = 0.3;
  var MOD_MAX_S = 0.001;          // +/- 1 ms max swing
  // Phase offsets per line (fractions of 2*pi). Deliberately irregular.
  var MOD_PHASE_OFFSETS = [0.0, 0.13, 0.27, 0.41, 0.58, 0.71, 0.83, 0.95];

  // --- preDelay ---
  var PREDELAY_MIN_MS = 0;
  var PREDELAY_MAX_MS = 200;
  var MS_PER_S = 1000;

  // --- Tone tilt (post FDN) ---
  // Gentle shelving to keep the tail lush but not boomy.
  var TILT_LOW_HZ = 200;
  var TILT_LOW_GAIN_DB = 1.5;
  var TILT_HIGH_HZ = 6000;
  var TILT_HIGH_GAIN_DB = -1.0;

  // --- Smoothing ---
  var SMOOTH_TC = 0.02;

  // --- Param default values ---
  var DEFAULT_MIX = 0.35;
  var DEFAULT_SIZE = 0.6;
  var DEFAULT_DECAY = 0.7;
  var DEFAULT_DAMPING = 0.4;
  var DEFAULT_MOD_DEPTH = 0.3;
  var DEFAULT_PREDELAY_MS = 10;

  // --- Param clamp ranges ---
  var UNIT_MIN = 0.0;
  var UNIT_MAX = 1.0;
  var MIX_PCT_SCALE = 100;        // accept 0-100 percent or 0-1 unit for mix

  // ============ Hadamard 8x8 (unnormalized +/-1) ============
  // H_2 = [[1,1],[1,-1]]; H_{2n} = [[H_n, H_n],[H_n, -H_n]]
  function _makeHadamardRow(size) {
    return new Array(size);
  }
  function _makeHadamardMatrix(sz) {
    var mat = [];
    for (var r = 0; r < sz; r++) {
      mat.push(_makeHadamardRow(sz));
    }
    return mat;
  }
  function buildHadamard8() {
    var H1 = [[1]];
    var size = 1;
    var H = H1;
    while (size < N_LINES) {
      var newSize = size * 2;
      var newH = _makeHadamardMatrix(newSize);
      for (var i = 0; i < size; i++) {
        for (var j = 0; j < size; j++) {
          var v = H[i][j];
          newH[i][j] = v;
          newH[i][j + size] = v;
          newH[i + size][j] = v;
          newH[i + size][j + size] = -v;
        }
      }
      H = newH;
      size = newSize;
    }
    return H;
  }
  var HADAMARD_8 = buildHadamard8();

  /**
   * HaloEffect - 8-line FDN reverb with Hadamard mixing.
   *
   * Parameters (all 0..1 unless noted):
   *  - mix         wet/dry (accepted as 0-1 unit or 0-100 percent)
   *  - size        scales delay times 0.5x..2.0x
   *  - decay       RT60 target 0.5s..60s (via feedback scalar)
   *  - damping     per-line LPF cutoff 20kHz..2kHz
   *  - modDepth    per-line delay-time mod +/- 0..1ms at 0.3 Hz
   *  - preDelay    ms (0..200)
   */
  function HaloEffect(ctx) {
    // BaseEffect is an ES6 class; construct via Reflect.construct so `this`
    // carries BaseEffect's own instance state (input, output, wetGain, etc).
    var self = Reflect.construct(BaseEffect, [ctx, 'halo'], HaloEffect);

    self.params.mix = DEFAULT_MIX;
    self.params.size = DEFAULT_SIZE;
    self.params.decay = DEFAULT_DECAY;
    self.params.damping = DEFAULT_DAMPING;
    self.params.modDepth = DEFAULT_MOD_DEPTH;
    self.params.preDelay = DEFAULT_PREDELAY_MS;

    // ---------- Pre-delay ----------
    self.preDelayNode = ctx.createDelay(PREDELAY_NODE_MAX_S);
    self.preDelayNode.delayTime.value = DEFAULT_PREDELAY_MS / MS_PER_S;

    // ---------- FDN core ----------
    // Per-line nodes
    self.delays = new Array(N_LINES);
    self.damps = new Array(N_LINES);       // one-pole LPFs (IIRFilterNode)
    self.dampInputs = new Array(N_LINES);  // stable anchor before damp[i]
    self.dampOutputs = new Array(N_LINES); // stable anchor after damp[i]
    self.inputGains = new Array(N_LINES);  // input distribution (1/sqrt(N))
    self.lfos = new Array(N_LINES);        // mod LFOs
    self.lfoGains = new Array(N_LINES);    // mod depth scalars
    self.matrixGains = new Array(N_LINES); // matrixGains[j][i] = H[j][i]*norm*fb
    self.tapGains = new Array(N_LINES);    // per-line output tap

    // Build per-line nodes
    var i, j;
    for (i = 0; i < N_LINES; i++) {
      // Delay line
      var d = ctx.createDelay(DELAY_NODE_MAX_S);
      d.delayTime.value = self._baseDelaySeconds(i);
      self.delays[i] = d;

      // Damping: one-pole LPF implemented as IIRFilterNode.
      // Cookbook one-pole: y[n] = (1-a)*x[n] + a*y[n-1]
      //   a = exp(-2*pi*fc/sr)
      // This is unconditionally stable (|a|<1), has DC gain exactly 1,
      // and peak magnitude exactly 1 at all frequencies. Crucially, it
      // avoids the transient overshoot of a 2-pole BiquadFilter LPF,
      // which (empirically) destabilized the FDN loop above fb~0.85.
      //
      // IIRFilterNode coefficients cannot be changed after construction,
      // so we wrap it between two stable GainNode anchors (dampInputs,
      // dampOutputs). When damping changes, we rebuild and re-wire the
      // IIRFilter between these anchors.
      var dIn = ctx.createGain();
      var dOut = ctx.createGain();
      self.dampInputs[i] = dIn;
      self.dampOutputs[i] = dOut;
      var aCoeff = self._onePoleA();
      var lpf = ctx.createIIRFilter([1 - aCoeff, 0], [1, -aCoeff]);
      dIn.connect(lpf);
      lpf.connect(dOut);
      self.damps[i] = lpf;

      // Input distribution gain (even distribution = 1/sqrt(N))
      var ig = ctx.createGain();
      ig.gain.value = HADAMARD_NORM;
      self.inputGains[i] = ig;

      // Mod LFO (sine with unique phase offset). Use ConstantSource + offset
      // pattern is wasteful; a simple OscillatorNode is fine here.
      var lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = MOD_RATE_HZ;
      // Apply phase offset by starting with a tiny time-shift.
      // WebAudio OscillatorNode has no phase param, but we can approximate
      // by starting at ctx.currentTime + (phase/2pi)/rate. Since all start
      // simultaneously from HaloEffect constructor, use start() offset.
      self.lfos[i] = lfo;

      var lfoGain = ctx.createGain();
      lfoGain.gain.value = self._modPeakSeconds();
      self.lfoGains[i] = lfoGain;

      // Per-line output tap gain (unity)
      var tap = ctx.createGain();
      tap.gain.value = 1.0;
      self.tapGains[i] = tap;
    }

    // Build matrix gain nodes: matrixGains[j][i] = gain from line i's output
    // into line j's input. Value = H[j][i] * HADAMARD_NORM * feedback_scalar.
    var fb = self._feedbackScalar();
    for (j = 0; j < N_LINES; j++) {
      var row = _makeHadamardRow(N_LINES);
      for (i = 0; i < N_LINES; i++) {
        var mg = ctx.createGain();
        mg.gain.value = HADAMARD_8[j][i] * HADAMARD_NORM * fb;
        row[i] = mg;
      }
      self.matrixGains[j] = row;
    }

    // ---------- Output summer + tone tilt ----------
    self.sumGain = ctx.createGain();
    // Sum of N taps of unit-amplitude noise would blow up; scale by 1/sqrt(N).
    self.sumGain.gain.value = HADAMARD_NORM;

    self.tiltLow = ctx.createBiquadFilter();
    self.tiltLow.type = 'lowshelf';
    self.tiltLow.frequency.value = TILT_LOW_HZ;
    self.tiltLow.gain.value = TILT_LOW_GAIN_DB;

    self.tiltHigh = ctx.createBiquadFilter();
    self.tiltHigh.type = 'highshelf';
    self.tiltHigh.frequency.value = TILT_HIGH_HZ;
    self.tiltHigh.gain.value = TILT_HIGH_GAIN_DB;

    // ---------- Wire ----------
    // input -> preDelay -> (fan out to N inputGains) -> each delay[i]
    self.input.connect(self.preDelayNode);
    for (i = 0; i < N_LINES; i++) {
      self.preDelayNode.connect(self.inputGains[i]);
      self.inputGains[i].connect(self.delays[i]);
    }

    // Each delay[i] -> dampInputs[i] -> damps[i](IIR) -> dampOutputs[i]
    //                                                  -> tapGains[i] -> sumGain
    //                                                  -> matrixGains[j][i] -> delays[j]  (all j)
    // LFO[i] * lfoGains[i] -> delays[i].delayTime (param mod)
    for (i = 0; i < N_LINES; i++) {
      self.delays[i].connect(self.dampInputs[i]);
      // dampInputs[i] -> lpf -> dampOutputs[i] already wired above
      self.dampOutputs[i].connect(self.tapGains[i]);
      self.tapGains[i].connect(self.sumGain);

      for (j = 0; j < N_LINES; j++) {
        self.dampOutputs[i].connect(self.matrixGains[j][i]);
        self.matrixGains[j][i].connect(self.delays[j]);
      }

      // Mod wiring
      self.lfos[i].connect(self.lfoGains[i]);
      self.lfoGains[i].connect(self.delays[i].delayTime);
    }

    // Tone tilt: sumGain -> tiltLow -> tiltHigh -> wetGain
    self.sumGain.connect(self.tiltLow);
    self.tiltLow.connect(self.tiltHigh);
    self.tiltHigh.connect(self.wetGain);

    // Start LFOs with per-line phase offsets (approximated via start-time offset).
    // WebAudio OscillatorNode cannot be retroactively phase-shifted after start,
    // so we offset the start time by (phase / 2pi) / rate seconds.
    var now = ctx.currentTime;
    for (i = 0; i < N_LINES; i++) {
      var phaseSecs = (MOD_PHASE_OFFSETS[i] / (2 * Math.PI)) / MOD_RATE_HZ;
      try {
        self.lfos[i].start(now + phaseSecs);
      } catch (e) { /* LFO start() may already have been called */ }
    }

    // Apply initial mix via BaseEffect (which accepts 0-100)
    if (typeof self.setMix === 'function') {
      self.setMix(DEFAULT_MIX * MIX_PCT_SCALE);
    }

    return self;
  }

  // Inherit from BaseEffect (ES6 class) via Reflect-compatible prototype chain
  Object.setPrototypeOf(HaloEffect.prototype, BaseEffect.prototype);
  Object.setPrototypeOf(HaloEffect, BaseEffect);

  // ============ Helpers ============

  HaloEffect.prototype._sizeMultiplier = function() {
    var s = this.params.size;
    if (s < UNIT_MIN) { s = UNIT_MIN; }
    if (s > UNIT_MAX) { s = UNIT_MAX; }
    return SIZE_MIN_MULT + (SIZE_MAX_MULT - SIZE_MIN_MULT) * s;
  };

  HaloEffect.prototype._baseDelaySeconds = function(lineIdx) {
    var ms = BASE_DELAY_TIMES_MS[lineIdx];
    // Left/right offset built into odd lines for a touch of stereo width.
    // Since the FDN here is summed to mono in sumGain, this offset primarily
    // decorrelates delay periods rather than building an L/R image. Kept
    // because even-length primes become non-coincident, improving density.
    if ((lineIdx % 2) === 1) {
      ms = ms + STEREO_OFFSET_MS;
    }
    return (ms / MS_PER_S) * this._sizeMultiplier();
  };

  HaloEffect.prototype._averageDelaySeconds = function() {
    var total = 0;
    for (var i = 0; i < N_LINES; i++) {
      total = total + this._baseDelaySeconds(i);
    }
    return total / N_LINES;
  };

  HaloEffect.prototype._rt60Seconds = function() {
    var d = this.params.decay;
    if (d < UNIT_MIN) { d = UNIT_MIN; }
    if (d > UNIT_MAX) { d = UNIT_MAX; }
    // Log-ish curve would be nicer; linear is fine and predictable.
    return DECAY_MIN_S + (DECAY_MAX_S - DECAY_MIN_S) * d;
  };

  HaloEffect.prototype._feedbackScalar = function() {
    // fb = 10^(-3 * avg_delay / RT60)   => -60 dB after RT60
    var avg = this._averageDelaySeconds();
    var rt60 = this._rt60Seconds();
    var exponent = -(RT60_TARGET_DB / 20.0) * (avg / rt60);
    var fb = Math.pow(10, exponent);
    if (fb < FEEDBACK_MIN) { fb = FEEDBACK_MIN; }
    if (fb > FEEDBACK_MAX) { fb = FEEDBACK_MAX; }
    return fb;
  };

  HaloEffect.prototype._dampingHz = function() {
    var d = this.params.damping;
    if (d < UNIT_MIN) { d = UNIT_MIN; }
    if (d > UNIT_MAX) { d = UNIT_MAX; }
    return DAMP_HZ_OPEN - (DAMP_HZ_OPEN - DAMP_HZ_DARK) * d;
  };

  // One-pole LPF coefficient:  a = exp(-2*pi*fc / sr)
  // y[n] = (1-a)*x[n] + a*y[n-1]  =>  b=[1-a, 0], a_coeffs=[1, -a]
  HaloEffect.prototype._onePoleA = function() {
    var fc = this._dampingHz();
    var sr = this.ctx.sampleRate;
    var a = Math.exp(-2 * Math.PI * fc / sr);
    return a;
  };

  HaloEffect.prototype._modPeakSeconds = function() {
    var m = this.params.modDepth;
    if (m < UNIT_MIN) { m = UNIT_MIN; }
    if (m > UNIT_MAX) { m = UNIT_MAX; }
    return MOD_MAX_S * m;
  };

  HaloEffect.prototype._preDelaySeconds = function() {
    var p = this.params.preDelay;
    if (p < PREDELAY_MIN_MS) { p = PREDELAY_MIN_MS; }
    if (p > PREDELAY_MAX_MS) { p = PREDELAY_MAX_MS; }
    return p / MS_PER_S;
  };

  // ============ Param updates ============

  HaloEffect.prototype._refreshMatrix = function(t) {
    var fb = this._feedbackScalar();
    for (var j = 0; j < N_LINES; j++) {
      for (var i = 0; i < N_LINES; i++) {
        var target = HADAMARD_8[j][i] * HADAMARD_NORM * fb;
        this.matrixGains[j][i].gain.setTargetAtTime(target, t, SMOOTH_TC);
      }
    }
  };

  HaloEffect.prototype._refreshDelayTimes = function(t) {
    for (var i = 0; i < N_LINES; i++) {
      this.delays[i].delayTime.setTargetAtTime(this._baseDelaySeconds(i), t, SMOOTH_TC);
    }
  };

  HaloEffect.prototype._refreshDamping = function(/*t*/) {
    // IIRFilterNode coefficients are immutable — rebuild each filter and
    // rewire between its stable dampInputs/dampOutputs anchor gains.
    var a = this._onePoleA();
    for (var i = 0; i < N_LINES; i++) {
      try { this.damps[i].disconnect(); } catch (e) { /* node already disconnected */ }
      try { this.dampInputs[i].disconnect(this.damps[i]); } catch (e) { /* node already disconnected */ }
      var lpf = this.ctx.createIIRFilter([1 - a, 0], [1, -a]);
      this.dampInputs[i].connect(lpf);
      lpf.connect(this.dampOutputs[i]);
      this.damps[i] = lpf;
    }
  };

  HaloEffect.prototype._refreshModDepth = function(t) {
    var depth = this._modPeakSeconds();
    for (var i = 0; i < N_LINES; i++) {
      this.lfoGains[i].gain.setTargetAtTime(depth, t, SMOOTH_TC);
    }
  };

  HaloEffect.prototype.updateParam = function(name, value) {
    var t = this.ctx.currentTime;

    switch (name) {
      case 'mix':
        // Accept 0-1 or 0-100
        var mv = value;
        if (mv <= UNIT_MAX) {
          mv = mv * MIX_PCT_SCALE;
        }
        this.params.mix = value;
        if (typeof this.setMix === 'function') {
          this.setMix(mv);
        }
        break;

      case 'size':
        this.params.size = value;
        // Size changes avg delay -> must update both delay times and feedback
        this._refreshDelayTimes(t);
        this._refreshMatrix(t);
        break;

      case 'decay':
        this.params.decay = value;
        this._refreshMatrix(t);
        break;

      case 'damping':
        this.params.damping = value;
        this._refreshDamping(t);
        break;

      case 'modDepth':
        this.params.modDepth = value;
        this._refreshModDepth(t);
        break;

      case 'preDelay':
        this.params.preDelay = value;
        this.preDelayNode.delayTime.setTargetAtTime(this._preDelaySeconds(), t, SMOOTH_TC);
        break;

      default:
        break;
    }
  };

  // ============ Dispose ============

  HaloEffect.prototype.dispose = function() {
    var i, j;
    for (i = 0; i < N_LINES; i++) {
      try { this.lfos[i].stop(); } catch (e) { /* LFO may not have started yet */ }
      try { this.lfos[i].disconnect(); } catch (e) { /* node already disconnected */ }
      try { this.lfoGains[i].disconnect(); } catch (e) { /* node already disconnected */ }
      try { this.inputGains[i].disconnect(); } catch (e) { /* node already disconnected */ }
      try { this.delays[i].disconnect(); } catch (e) { /* node already disconnected */ }
      try { this.damps[i].disconnect(); } catch (e) { /* node already disconnected */ }
      try { this.dampInputs[i].disconnect(); } catch (e) { /* node already disconnected */ }
      try { this.dampOutputs[i].disconnect(); } catch (e) { /* node already disconnected */ }
      try { this.tapGains[i].disconnect(); } catch (e) { /* node already disconnected */ }
      for (j = 0; j < N_LINES; j++) {
        try { this.matrixGains[j][i].disconnect(); } catch (e) { /* node already disconnected */ }
      }
    }
    try { this.preDelayNode.disconnect(); } catch (e) { /* node already disconnected */ }
    try { this.sumGain.disconnect(); } catch (e) { /* node already disconnected */ }
    try { this.tiltLow.disconnect(); } catch (e) { /* node already disconnected */ }
    try { this.tiltHigh.disconnect(); } catch (e) { /* node already disconnected */ }

    BaseEffect.prototype.dispose.call(this);
  };

  // ============ Register ============
  // The exhibit uses both a factory-style register pattern (SL.effects.register)
  // when available AND direct namespace assignment. We support both so the
  // effect is discoverable regardless of which loader runs first.
  if (SL.effects && typeof SL.effects.register === 'function') {
    SL.effects.register('halo', HaloEffect);
  }
  SL.effects.Halo = HaloEffect;
  SL.effects.HaloEffect = HaloEffect;

})();
