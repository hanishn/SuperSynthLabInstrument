// Synth Lab - Effect Chain Manager
// Handles arbitrary ordering and routing of effects

(function() {
  var SL = window.SynthLab = window.SynthLab || {};

  var NOT_FOUND = -1;

  /**
   * Base Effect class - all effects must extend this interface
   * Each effect manages its own Web Audio nodes and provides:
   * - input/output GainNodes for routing
   * - enable/disable functionality
   * - parameter getters/setters
   * - wet/dry mix control
   */
  class BaseEffect {
    constructor(ctx, name) {
      this.ctx = ctx;
      this.name = name;
      this.enabled = false;

      // All effects have input, output, and wet/dry mix
      this.input = ctx.createGain();
      this.output = ctx.createGain();
      this.dryGain = ctx.createGain();
      this.wetGain = ctx.createGain();

      // Start in bypass mode: full dry, no wet (since enabled = false)
      this.dryGain.gain.value = 1.0;
      this.wetGain.gain.value = 0.0;

      // Dry path: input -> dryGain -> output
      this.input.connect(this.dryGain);
      this.dryGain.connect(this.output);

      // Wet path will be: input -> [effect nodes] -> wetGain -> output
      this.wetGain.connect(this.output);

      // Parameters object - subclasses populate this
      // Default mix is 50% (used when effect is enabled)
      this.params = { mix: 50 };
    }

    /**
     * Set wet/dry mix (0 = fully dry, 100 = fully wet)
     * Note: Only applies the mix if effect is enabled; otherwise just stores the value
     */
    setMix(mix) {
      this.params.mix = mix;
      // Only apply mix gains if enabled; if disabled, keep bypass gains
      if (this.enabled) {
        var wet = mix / 100;
        var dry = 1 - wet;
        this.dryGain.gain.setTargetAtTime(dry, this.ctx.currentTime, 0.01);
        this.wetGain.gain.setTargetAtTime(wet, this.ctx.currentTime, 0.01);
      }
    }

    /**
     * Enable/disable the effect
     * When disabled, signal passes through dry only
     */
    setEnabled(enabled) {
      this.enabled = enabled;
      if (enabled) {
        this.dryGain.gain.setTargetAtTime(1 - (this.params.mix || 50) / 100, this.ctx.currentTime, 0.01);
        this.wetGain.gain.setTargetAtTime((this.params.mix || 50) / 100, this.ctx.currentTime, 0.01);
      } else {
        // Bypass: full dry, no wet
        this.dryGain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.01);
        this.wetGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.01);
      }
    }

    /**
     * Get all parameters as an object
     */
    getParams() {
      return Object.assign({}, this.params, { enabled: this.enabled });
    }

    /**
     * Set a parameter by name
     */
    setParam(name, value) {
      if (name === 'enabled') {
        this.setEnabled(value);
      } else if (name === 'mix') {
        this.setMix(value);
      } else {
        /* Let updateParam handle storing the value so subclasses can compare
           old vs new before deciding whether to rebuild expensive resources. */
        this.updateParam(name, value);
        /* Ensure the value is stored even if updateParam doesn't store it */
        this.params[name] = value;
      }
    }

    /**
     * Subclasses override this to handle parameter changes
     */
    updateParam(name, value) {
      // Override in subclass
    }

    /**
     * Clean up audio nodes
     */
    dispose() {
      this.input.disconnect();
      this.output.disconnect();
      this.dryGain.disconnect();
      this.wetGain.disconnect();
    }
  }

  /**
   * EffectChain - manages a chain of effects with arbitrary ordering
   */
  class EffectChain {
    constructor(ctx) {
      this.ctx = ctx;
      this.effects = new Map(); // name -> effect instance (lazy — created on first enable)
      this.factories = new Map(); // name -> EffectClass (for lazy instantiation)
      this.order = []; // array of effect names in chain order

      // Master input/output with dry/wet mix
      this.input = ctx.createGain();
      this.output = ctx.createGain();

      // Master dry/wet routing
      this.dryGain = ctx.createGain();
      this.wetGain = ctx.createGain();
      this.effectsOutput = ctx.createGain(); // Output of the effects chain

      // Default master mix is 100% wet (effects fully engaged)
      this.masterMix = 100;
      this.dryGain.gain.value = 0;
      this.wetGain.gain.value = 1;

      // Dry path: input -> dryGain -> output
      this.input.connect(this.dryGain);
      this.dryGain.connect(this.output);

      // Wet path: effectsOutput -> wetGain -> output
      this.effectsOutput.connect(this.wetGain);
      this.wetGain.connect(this.output);

      // Initially, input connects to effectsOutput (no effects in chain)
      this.input.connect(this.effectsOutput);
    }

    /**
     * Set master dry/wet mix (0 = fully dry/bypass, 100 = fully wet/effects)
     */
    setMasterMix(mix) {
      this.masterMix = mix;
      var wet = mix / 100;
      var dry = 1 - wet;
      this.dryGain.gain.setTargetAtTime(dry, this.ctx.currentTime, 0.01);
      this.wetGain.gain.setTargetAtTime(wet, this.ctx.currentTime, 0.01);
    }

    /**
     * Get master mix value
     */
    getMasterMix() {
      return this.masterMix;
    }

    /**
     * Register an effect factory for lazy instantiation
     * The effect will only be created when first enabled via _ensureEffect()
     */
    registerFactory(name, EffectClass) {
      this.factories.set(name, EffectClass);
    }

    /**
     * Register an effect instance directly (legacy — for pre-created effects)
     */
    registerEffect(name, effectInstance) {
      this.effects.set(name, effectInstance);
    }

    /**
     * Ensure an effect instance exists (creates from factory if needed)
     * @returns {BaseEffect|null} The effect instance
     */
    _ensureEffect(name) {
      if (this.effects.has(name)) {
        return this.effects.get(name);
      }
      var EffectClass = this.factories.get(name);
      if (EffectClass) {
        try {
          var effect = new EffectClass(this.ctx);
          this.effects.set(name, effect);
          return effect;
        } catch (e) {
          console.error('Failed to create effect:', name, e);
          return null;
        }
      }
      return null;
    }

    /**
     * Get all available effect names (both instantiated and factory-registered)
     */
    getAvailableEffects() {
      var names = new Set(Array.from(this.effects.keys()).concat(Array.from(this.factories.keys())));
      return Array.from(names);
    }

    /**
     * Set the chain order and rebuild connections
     * @param {string[]} order - Array of effect names in desired order
     */
    setOrder(order) {
      var self = this;
      this.order = order.filter(function(name) { return self.effects.has(name) || self.factories.has(name); });
      this.rebuildChain();
    }

    /**
     * Add an effect to the end of the chain (lazy — creates instance if needed)
     */
    addToChain(name) {
      if (!this.order.includes(name)) {
        var effect = this._ensureEffect(name);
        if (effect) {
          this.order.push(name);
          this.rebuildChain();
        }
      }
    }

    /**
     * Remove an effect from the chain (keeps it registered)
     */
    removeFromChain(name) {
      var idx = this.order.indexOf(name);
      if (idx !== NOT_FOUND) {
        this.order.splice(idx, 1);
        this.rebuildChain();
      }
    }

    /**
     * Move an effect to a new position in the chain
     */
    moveEffect(name, newIndex) {
      var idx = this.order.indexOf(name);
      if (idx !== NOT_FOUND) {
        this.order.splice(idx, 1);
        this.order.splice(newIndex, 0, name);
        this.rebuildChain();
      }
    }

    /**
     * Rebuild the audio node connections based on current order
     */
    rebuildChain() {
      // Disconnect input from effects chain (but keep dry path connected)
      this.input.disconnect();
      this.effects.forEach(function(effect) {
        effect.output.disconnect();
      });

      // Re-establish dry path
      this.input.connect(this.dryGain);

      // Get effects in order (all effects are in chain, enabled/disabled is per-effect)
      var self2 = this;
      var activeEffects = this.order
        .map(function(name) { return self2.effects.get(name); })
        .filter(function(effect) { return effect; });

      if (activeEffects.length === 0) {
        // No effects: input connects directly to effectsOutput
        this.input.connect(this.effectsOutput);
      } else {
        // Connect in series: input -> effect1 -> effect2 -> ... -> effectsOutput
        var currentNode = this.input;
        activeEffects.forEach(function(effect) {
          currentNode.connect(effect.input);
          currentNode = effect.output;
        });
        currentNode.connect(this.effectsOutput);
      }

    }

    /**
     * Get effect by name (creates from factory if needed)
     */
    getEffect(name) {
      return this._ensureEffect(name);
    }

    /**
     * Get current chain order
     */
    getOrder() {
      return this.order.slice();
    }

    /**
     * Get all registered effect names (includes factory-registered)
     */
    getRegisteredEffects() {
      var names = new Set(Array.from(this.effects.keys()).concat(Array.from(this.factories.keys())));
      return Array.from(names);
    }

    /**
     * Dispose all effects and clean up
     */
    dispose() {
      this.input.disconnect();
      this.output.disconnect();
      this.dryGain.disconnect();
      this.wetGain.disconnect();
      this.effectsOutput.disconnect();
      this.effects.forEach(function(effect) { effect.dispose(); });
      this.effects.clear();
      this.factories.clear();
      this.order = [];
    }
  }

  // Export to SynthLab namespace
  SL.effects = SL.effects || {};
  SL.effects.BaseEffect = BaseEffect;
  SL.effects.EffectChain = EffectChain;

})();
