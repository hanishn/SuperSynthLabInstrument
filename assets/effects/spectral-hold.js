// Synth Lab - Spectral Hold Effect (FFT freeze + smear + diffusion)
// ES5 factory that wraps an AudioWorkletNode. Worklet is loaded via a Blob URL
// (matching fm-worklet / physical-worklet pattern in audio-engine.js).
//
// While the worklet is loading, a pass-through gain keeps audio flowing so the
// effect never silences the chain. Parameter sets are queued and replayed
// onto the AudioWorkletNode's AudioParams once ready.
//
// ES5 only: var, no arrow functions, no template literals.

(function() {
  var SL = window.SynthLab = window.SynthLab || {};
  SL.effects = SL.effects || {};
  var BaseEffect = SL.effects.BaseEffect;

  // ========= Named constants =========

  var WORKLET_NAME = 'spectral-hold-worklet';
  var WORKLET_FILE = 'spectral-hold-worklet.js';

  // Defaults (UI-scaled 0..100 where applicable, but internal ranges match worklet)
  var DEFAULT_MIX = 100;             // 0..100 %
  var DEFAULT_FREEZE = 0;            // 0 or 1
  var DEFAULT_SMEAR = 0;             // 0..100 %
  var DEFAULT_DECAY = 0;             // 0..100 %  (0 = no decay, 100 = maximum per-frame decay)
  var DEFAULT_BRIGHT = 0;            // 0..100 %
  var DEFAULT_PITCH_SEMITONES = 0;   // -12..12

  var PCT_MIN = 0;
  var PCT_MAX = 100;

  var PITCH_SEMITONES_MIN = -12;
  var PITCH_SEMITONES_MAX = 12;

  var SMOOTH_TC = 0.01;

  // ========= Worklet loader (per-context cache) =========

  // Map of AudioContext -> Promise<void> resolved when the module is registered.
  var _moduleLoaded = new WeakMap();

  function _ensureModuleLoaded(ctx) {
    if (_moduleLoaded.has(ctx)) {
      return _moduleLoaded.get(ctx);
    }
    // Prefer a pre-fetched blob URL from audio-engine's cache if available
    var p;
    var preUrl = (SL.audio && SL.audio.getWorkletBlobUrl) ? SL.audio.getWorkletBlobUrl(WORKLET_FILE) : null;
    if (preUrl) {
      p = ctx.audioWorklet.addModule(preUrl);
    } else {
      p = fetch('assets/effects/' + WORKLET_FILE)
        .then(function(r) { return r.text(); })
        .then(function(code) {
          var blob = new Blob([code], { type: 'application/javascript' });
          var blobUrl = URL.createObjectURL(blob);
          return ctx.audioWorklet.addModule(blobUrl);
        });
    }
    _moduleLoaded.set(ctx, p);
    return p;
  }

  // ========= Effect =========

  function SpectralHoldEffect(ctx) {
    var self = Reflect.construct(BaseEffect, [ctx, 'spectralHold'], SpectralHoldEffect);

    self.params.mix = DEFAULT_MIX;
    self.params.freeze = DEFAULT_FREEZE;
    self.params.smear = DEFAULT_SMEAR;
    self.params.decay = DEFAULT_DECAY;
    self.params.bright = DEFAULT_BRIGHT;
    self.params.pitchOffset = DEFAULT_PITCH_SEMITONES;

    // Pass-through bridge (keeps audio flowing while worklet loads)
    self.bridge = ctx.createGain();
    self.bridge.gain.value = 1.0;
    self.input.connect(self.bridge);
    self.bridge.connect(self.wetGain);

    self.worklet = null;
    self.workletReady = false;
    self._pendingUpdates = [];

    _ensureModuleLoaded(ctx).then(function() {
      self._onModuleReady();
    }).catch(function(err) {
      // Leave bridge in place — effect becomes a unity pass-through.
      if (typeof console !== 'undefined') {
        console.error('[SpectralHold] worklet module load failed:', err);
      }
    });

    return self;
  }

  Object.setPrototypeOf(SpectralHoldEffect.prototype, BaseEffect.prototype);
  Object.setPrototypeOf(SpectralHoldEffect, BaseEffect);

  SpectralHoldEffect.prototype._onModuleReady = function() {
    var ctx = this.ctx;
    var isNodeOk = false;
    try {
      this.worklet = new AudioWorkletNode(ctx, WORKLET_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2]
      });
      isNodeOk = true;
    } catch (e) {
      if (typeof console !== 'undefined') {
        console.error('[SpectralHold] node construct failed:', e);
      }
    }

    if (isNodeOk) {
      // Swap: input -> worklet -> wetGain (replace bridge pass-through)
      try { this.input.disconnect(this.bridge); } catch (e) { /* node may not be connected */ }
      try { this.bridge.disconnect(this.wetGain); } catch (e) { /* node may not be connected */ }
      this.input.connect(this.worklet);
      this.worklet.connect(this.wetGain);

      this.workletReady = true;

      // Apply initial params
      this._applyParam('mix', this.params.mix);
      this._applyParam('freeze', this.params.freeze);
      this._applyParam('smear', this.params.smear);
      this._applyParam('decay', this.params.decay);
      this._applyParam('bright', this.params.bright);
      this._applyParam('pitchOffset', this.params.pitchOffset);

      // Flush any deferred updates
      var pending = this._pendingUpdates;
      this._pendingUpdates = [];
      for (var i = 0; i < pending.length; i++) {
        this._applyParam(pending[i].name, pending[i].value);
      }
    }
  };

  // ========= Param mapping =========
  // Worklet ranges:
  //   mix: 0..1           (UI 0..100 / 100)
  //   freeze: 0 or 1      (UI 0 or 1)
  //   smear: 0..1         (UI 0..100 / 100)
  //   decay: 0..1         (UI 0..100 / 100)
  //   bright: 0..1        (UI 0..100 / 100)
  //   pitchOffset: -12..12 semitones (UI identical)

  SpectralHoldEffect.prototype._toWorkletValue = function(name, value) {
    var v;
    switch (name) {
      case 'mix':
      case 'smear':
      case 'decay':
      case 'bright':
        v = Math.max(PCT_MIN, Math.min(PCT_MAX, value)) / PCT_MAX;
        return v;
      case 'freeze':
        return (value >= 0.5) ? 1.0 : 0.0;
      case 'pitchOffset':
        v = Math.max(PITCH_SEMITONES_MIN, Math.min(PITCH_SEMITONES_MAX, value));
        return v;
      default:
        return value;
    }
  };

  SpectralHoldEffect.prototype._applyParam = function(name, value) {
    if (!this.worklet) { return; }
    var wv = this._toWorkletValue(name, value);
    var p = this.worklet.parameters.get(name);
    if (!p) { return; }
    var t = this.ctx.currentTime;
    // Hard-set for boolean-ish freeze, smoothed for continuous params.
    if (name === 'freeze') {
      p.setValueAtTime(wv, t);
    } else {
      p.setTargetAtTime(wv, t, SMOOTH_TC);
    }
  };

  SpectralHoldEffect.prototype.updateParam = function(name, value) {
    this.params[name] = value;
    if (this.workletReady) {
      this._applyParam(name, value);
    } else {
      this._pendingUpdates.push({ name: name, value: value });
    }
  };

  SpectralHoldEffect.prototype.dispose = function() {
    if (this.worklet) {
      try { this.worklet.disconnect(); } catch (e) { /* node already disconnected */ }
      this.worklet = null;
    }
    if (this.bridge) {
      try { this.bridge.disconnect(); } catch (e) { /* node already disconnected */ }
    }
    BaseEffect.prototype.dispose.call(this);
  };

  // ========= Self-registration =========

  // Primary export (matches existing convention: SL.effects.<Name>Effect)
  SL.effects.SpectralHoldEffect = SpectralHoldEffect;
  SL.effects.SpectralHold = SpectralHoldEffect;

  // If a future shared registry exposes a `register` fn, use it. Harmless otherwise.
  if (typeof SL.effects.register === 'function') {
    SL.effects.register('spectralHold', SpectralHoldEffect);
  }

})();
