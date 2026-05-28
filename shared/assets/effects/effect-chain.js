// Synth Lab - Effect Chain Manager
// Handles arbitrary ordering and routing of effects
//
// ---------------------------------------------------------------------------
// ARCHITECTURE: Effect Routing Infrastructure
// ---------------------------------------------------------------------------
// This file provides the two core classes for all audio effects in SSLI:
//
//   BaseEffect  -- Abstract base class. Every effect (reverb, chorus, etc.)
//                  extends this. Provides a standardized I/O interface with
//                  parallel dry/wet routing and click-free enable/disable.
//
//   EffectChain -- Series routing container. Holds N effects connected in
//                  sequence, with its own master dry/wet mix. Effects are
//                  lazy-instantiated via a factory registry so unused effects
//                  consume zero Web Audio resources.
//
// Signal flow through an individual effect (BaseEffect):
//
//   input ----+---> dryGain --------+--> output
//             |                     |
//             +---> [effect nodes] -+
//                   --> wetGain -----+
//
// The dry path always exists. The wet path passes through the subclass's
// DSP nodes. Crossfading dryGain/wetGain implements the mix control.
//
// Signal flow through the chain (EffectChain):
//
//   chain.input --+--> dryGain -------------------------+--> chain.output
//                 |                                     |
//                 +--> fx1 --> fx2 --> ... --> fxN       |
//                      --> effectsOutput --> wetGain ----+
//
// The chain's master mix crossfades between the unprocessed input and the
// fully-processed effects output, independent of each effect's own mix.
// ---------------------------------------------------------------------------

(function() {
  var SL = window.SynthLab = window.SynthLab || {};

  var NOT_FOUND = -1;

  // -------------------------------------------------------------------------
  // BaseEffect -- abstract base class for all effects
  // -------------------------------------------------------------------------
  // Every effect inherits: input, output, dryGain, wetGain GainNodes.
  // Subclasses wire their DSP nodes between input and wetGain.
  // Enable/disable is achieved by crossfading gain values, not by
  // disconnecting nodes -- this avoids Web Audio graph rebuild costs and
  // eliminates audible clicks.
  // -------------------------------------------------------------------------

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
      // Bypass = dry at unity, wet at zero. The DSP nodes still exist but
      // their output is silenced, so they cost minimal CPU.
      this.dryGain.gain.value = 1.0;
      this.wetGain.gain.value = 0.0;

      // Dry path: input -> dryGain -> output
      // This path carries the unprocessed signal at all times.
      this.input.connect(this.dryGain);
      this.dryGain.connect(this.output);

      // Wet path will be: input -> [effect nodes] -> wetGain -> output
      // Subclasses complete this by connecting input -> their nodes -> wetGain.
      this.wetGain.connect(this.output);

      // Parameters object - subclasses populate this
      // Default mix is 50% (used when effect is enabled)
      this.params = { mix: 50 };
    }

    /**
     * Set wet/dry mix (0 = fully dry, 100 = fully wet)
     * Note: Only applies the mix if effect is enabled; otherwise just stores the value
     */
    // Wet/dry uses a linear crossfade: dry = 1 - mix, wet = mix.
    // setTargetAtTime with tau=0.01 gives ~30ms smooth transition (3 time
    // constants), preventing clicks when the user drags the mix slider.
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
    // Enable/disable is a gain crossfade, NOT a graph disconnect. This is
    // intentional: disconnecting and reconnecting Web Audio nodes mid-stream
    // causes glitches in most browsers. Crossfading to zero is inaudible and
    // the browser can internally optimize silent branches.
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
    // Two-phase parameter dispatch: updateParam() lets the subclass react
    // (e.g. rebuild a convolution buffer), then we store the value. This
    // ordering lets subclasses compare old vs new before committing.
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

  // -------------------------------------------------------------------------
  // EffectChain -- series routing container with lazy instantiation
  // -------------------------------------------------------------------------
  // The chain holds up to 28 effects in user-defined order. Effects are
  // registered as factory classes, not instances -- the actual Web Audio
  // nodes are only created the first time the user enables an effect.
  // This keeps the initial audio graph lightweight.
  //
  // Reordering requires a full disconnect-reconnect cycle (rebuildChain)
  // because Web Audio's AudioNode.connect() API has no "insert before"
  // operation. The rebuild is fast because it only touches GainNode
  // connections, not the internal DSP nodes of each effect.
  // -------------------------------------------------------------------------

  /**
   * EffectChain - manages a chain of effects with arbitrary ordering
   */
  class EffectChain {
    constructor(ctx) {
      this.ctx = ctx;
      this.effects = new Map(); // name -> effect instance (lazy -- created on first enable)
      this.factories = new Map(); // name -> EffectClass (for lazy instantiation)
      this.order = []; // array of effect names in chain order

      // Master input/output with dry/wet mix
      this.input = ctx.createGain();
      this.output = ctx.createGain();

      // Master dry/wet routing
      // The chain has its own parallel dry/wet structure, independent of
      // each individual effect's mix. This lets the user blend the entire
      // processed chain against the original signal.
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
      // This passthrough is replaced by rebuildChain once effects are added.
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
    // Lazy factory pattern: store the class, not an instance. The effect's
    // constructor (which allocates oscillators, delay lines, etc.) only runs
    // when the user first toggles the effect on. With 28 effect types, this
    // avoids creating ~100+ Web Audio nodes at startup.
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
    // DISCONNECT-RECONNECT PATTERN: Web Audio has no way to reorder
    // connections in place. To change the chain order we must:
    //   1. Disconnect everything (input and all effect outputs)
    //   2. Re-establish the dry bypass path
    //   3. Walk the ordered effect list, wiring output -> next input
    //   4. Connect the last effect's output to effectsOutput
    // This is the standard approach in Web Audio applications.
    // Individual effects remain internally wired -- only the inter-effect
    // connections are torn down and rebuilt.
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
        // Each effect's internal dry/wet routing handles its own bypass state,
        // so disabled effects still pass signal through their dry path.
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
