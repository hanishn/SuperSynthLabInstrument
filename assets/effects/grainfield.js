// Synth Lab - Grainfield Effect (granular cloud delay / freeze)
//
// Continuous ring-buffer granular effect implemented in an AudioWorklet.
// The factory (main thread) follows the `lofi.js` pattern: BaseEffect
// subclass via `Reflect.construct` + `setPrototypeOf`.
//
// Worklet module (`grainfield-worklet.js`) is loaded lazily on first
// instantiation. A per-context promise is cached so repeated instantiations
// share one `addModule` call. Before the worklet is ready, the effect acts
// as a passthrough (its wet path is silent but the dry path still passes
// audio — so nothing is lost during the async bring-up).
//
// ES5 only: no arrows, const, template literals. Named constants only.

(function() {
  var SL = window.SynthLab = window.SynthLab || {};
  SL.effects = SL.effects || {};
  var BaseEffect = SL.effects.BaseEffect;

  // ============ Named constants ============
  var WORKLET_FILE = 'grainfield-worklet.js';
  var WORKLET_PATH_PRIMARY = 'assets/effects/' + WORKLET_FILE;
  var WORKLET_PATH_FALLBACK = 'assets/' + WORKLET_FILE;
  var WORKLET_PROCESSOR_NAME = 'grainfield-processor';
  var NUM_OUTPUT_CHANNELS = 2;

  // Default parameter values (normalized 0..1 unless noted)
  var DEFAULT_MIX = 50;
  var DEFAULT_DENSITY = 0.5;
  var DEFAULT_GRAIN_SIZE = 0.3;
  var DEFAULT_DELAY = 0.2;
  var DEFAULT_SPREAD = 0.7;
  var DEFAULT_FEEDBACK = 0.0;
  var DEFAULT_FREEZE = 0;   // boolean-ish: 0 or 1

  var PARAM_MIN_NORM = 0.0;
  var PARAM_MAX_NORM = 1.0;
  var PARAM_MIN_PCT = 0;
  var PARAM_MAX_PCT = 100;

  var SMOOTH_TC = 0.01;

  // ============ Worklet loader (cached per AudioContext) ============

  // Map keyed by AudioContext instance → Promise<void>
  var _workletReadyByCtx = new WeakMap();

  function _loadWorklet(ctx) {
    var cached = _workletReadyByCtx.get(ctx);
    if (cached) { return cached; }

    if (!ctx.audioWorklet || typeof ctx.audioWorklet.addModule !== 'function') {
      var failed = Promise.reject(new Error('AudioWorklet unsupported on this context'));
      _workletReadyByCtx.set(ctx, failed);
      return failed;
    }

    // Prefer prefetched blob URL (audio-engine exposes _workletBlobUrls indirectly
    // via SL.audio.getWorkletBlobUrl). Otherwise, fetch + blob-URL ourselves.
    var getBlob = null;
    if (SL.audio && typeof SL.audio.getWorkletBlobUrl === 'function') {
      var prefetched = SL.audio.getWorkletBlobUrl(WORKLET_FILE);
      if (prefetched) {
        getBlob = Promise.resolve(prefetched);
      }
    }

    if (!getBlob) {
      getBlob = fetch(WORKLET_PATH_PRIMARY)
        .then(function(r) {
          var ok = r && r.ok;
          if (ok) { return r.text(); }
          return fetch(WORKLET_PATH_FALLBACK).then(function(r2) { return r2.text(); });
        })
        .then(function(code) {
          var blob = new Blob([code], { type: 'application/javascript' });
          return URL.createObjectURL(blob);
        });
    }

    var ready = getBlob.then(function(url) {
      return ctx.audioWorklet.addModule(url);
    });

    _workletReadyByCtx.set(ctx, ready);
    return ready;
  }

  // ============ Factory ============

  function GrainfieldEffect(ctx) {
    var self = Reflect.construct(BaseEffect, [ctx, 'grainfield'], GrainfieldEffect);

    self.params.mix = DEFAULT_MIX;
    self.params.density = DEFAULT_DENSITY;
    self.params.grainSize = DEFAULT_GRAIN_SIZE;
    self.params.delay = DEFAULT_DELAY;
    self.params.spread = DEFAULT_SPREAD;
    self.params.feedback = DEFAULT_FEEDBACK;
    self.params.freeze = DEFAULT_FREEZE;

    // Until the worklet module resolves, we expose `ready` so callers
    // (e.g. probes, tests) can await proper wiring.
    self.workletNode = null;
    self.ready = _loadWorklet(ctx).then(function() {
      self._buildWorkletNode();
    }).catch(function(err) {
      console.error('Grainfield: worklet load failed', err);
    });

    return self;
  }

  Object.setPrototypeOf(GrainfieldEffect.prototype, BaseEffect.prototype);
  Object.setPrototypeOf(GrainfieldEffect, BaseEffect);

  GrainfieldEffect.prototype._buildWorkletNode = function() {
    var ctx = this.ctx;
    var node = new AudioWorkletNode(ctx, WORKLET_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [NUM_OUTPUT_CHANNELS]
    });

    // Seed parameter values from current `params` state (in case they were
    // set before the module was ready).
    this._applyAllParams(node);

    this.input.connect(node);
    node.connect(this.wetGain);
    this.workletNode = node;
  };

  GrainfieldEffect.prototype._applyAllParams = function(node) {
    var t = this.ctx.currentTime;
    var p = this.params;
    _setAudioParam(node, 'density',   _clamp01(p.density),   t);
    _setAudioParam(node, 'grainSize', _clamp01(p.grainSize), t);
    _setAudioParam(node, 'delay',     _clamp01(p.delay),     t);
    _setAudioParam(node, 'spread',    _clamp01(p.spread),    t);
    _setAudioParam(node, 'feedback',  _clamp01(p.feedback),  t);
    _setAudioParam(node, 'freeze',    p.freeze > 0 ? PARAM_MAX_NORM : PARAM_MIN_NORM, t);
  };

  function _clamp01(v) {
    if (v < PARAM_MIN_NORM) { return PARAM_MIN_NORM; }
    if (v > PARAM_MAX_NORM) { return PARAM_MAX_NORM; }
    return v;
  }

  function _setAudioParam(node, paramName, value, t) {
    var p = node.parameters.get(paramName);
    if (p) {
      p.setTargetAtTime(value, t, SMOOTH_TC);
    }
  }

  // ============ updateParam ============
  GrainfieldEffect.prototype.updateParam = function(name, value) {
    var numeric = value;
    var stored = numeric;

    // Store normalized 0..1 for continuous params; 0/1 for freeze.
    switch (name) {
      case 'density':
      case 'grainSize':
      case 'delay':
      case 'spread':
      case 'feedback':
        stored = _clamp01(numeric);
        this.params[name] = stored;
        break;
      case 'freeze':
        stored = numeric > 0 ? PARAM_MAX_NORM : PARAM_MIN_NORM;
        this.params.freeze = stored;
        break;
      default:
        return;
    }

    if (this.workletNode) {
      _setAudioParam(this.workletNode, name, stored, this.ctx.currentTime);
    }
    // Otherwise: queued — _applyAllParams seeds everything once the node exists.
  };

  GrainfieldEffect.prototype.dispose = function() {
    if (this.workletNode) {
      try { this.workletNode.disconnect(); } catch (e) { /* already disconnected */ }
      this.workletNode = null;
    }
    BaseEffect.prototype.dispose.call(this);
  };

  // Expose under both names (mirrors lofi.js pattern)
  SL.effects.Grainfield = GrainfieldEffect;
  SL.effects.GrainfieldEffect = GrainfieldEffect;

})();
