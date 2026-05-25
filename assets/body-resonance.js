// Super Synth Lab - Body Resonance Module
// Post-processing effect: runs any audio signal through a body resonance model
// using a bank of tuned bandpass filters (modal resonator approach)
// v1.0.0 - 8 body models, 6 parallel biquad bandpass filters
(function() {
  'use strict';

  var SL = window.SynthLab;

  // ============================================================
  // Constants
  // ============================================================

  var MAX_RESONATORS = 6;

  var NO_BODY_TYPE = 'none';

  // Body model resonance frequency tables (Hz)
  // Each body has characteristic formant peaks
  var BODY_MODELS = {
    violin:   { name: 'Violin Body',      freqs: [280, 460, 850, 1050, 0, 0],       gains: [1.0, 0.8, 0.6, 0.5, 0, 0],     qs: [12, 10, 8, 8, 0, 0] },
    cello:    { name: 'Cello Body',        freqs: [180, 300, 580, 850, 0, 0],        gains: [1.0, 0.85, 0.65, 0.45, 0, 0],   qs: [10, 9, 7, 7, 0, 0] },
    guitar:   { name: 'Guitar Body',       freqs: [100, 200, 400, 800, 1200, 0],     gains: [1.0, 0.9, 0.7, 0.5, 0.35, 0],   qs: [8, 9, 10, 8, 7, 0] },
    piano:    { name: 'Piano Soundboard',  freqs: [120, 260, 440, 880, 1760, 0],     gains: [1.0, 0.85, 0.7, 0.5, 0.3, 0],   qs: [6, 7, 8, 9, 10, 0] },
    marimba:  { name: 'Marimba Bar',       freqs: [300, 900, 1500, 0, 0, 0],         gains: [1.0, 0.6, 0.35, 0, 0, 0],       qs: [15, 12, 10, 0, 0, 0] },
    kalimba:  { name: 'Kalimba Tine',      freqs: [700, 2100, 3500, 0, 0, 0],        gains: [1.0, 0.55, 0.3, 0, 0, 0],       qs: [20, 16, 14, 0, 0, 0] },
    djembe:   { name: 'Djembe Shell',      freqs: [200, 450, 700, 0, 0, 0],          gains: [1.0, 0.7, 0.4, 0, 0, 0],        qs: [6, 5, 5, 0, 0, 0] },
    none:     { name: 'None (Bypass)',      freqs: [0, 0, 0, 0, 0, 0],               gains: [0, 0, 0, 0, 0, 0],              qs: [0, 0, 0, 0, 0, 0] }
  };

  var BODY_TYPE_LIST = ['none', 'violin', 'cello', 'guitar', 'piano', 'marimba', 'kalimba', 'djembe'];

  /** Default body resonance settings for a new instrument */
  var DEFAULT_BODY_SETTINGS = {
    bodyType: 'none',
    resonanceAmount: 50,
    brightness: 50,
    bodySize: 50
  };

  // ============================================================
  // State
  // ============================================================

  var audioContext = null;
  var isEngineReady = false;

  // Per-instrument state: instId -> { filters: [], dryGain, wetGain, mergeNode, inputNode, outputNode, settings }
  var instancesByInst = {};

  // ============================================================
  // Biquad Bandpass Coefficient Computation
  // ============================================================

  /**
   * Compute biquad bandpass filter coefficients (peaking EQ style).
   * @param {number} freq - Center frequency in Hz
   * @param {number} q    - Q factor (bandwidth = freq/q)
   * @param {number} sr   - Sample rate
   * @returns {object} { b0, b1, b2, a1, a2 } (a0 normalized to 1)
   */
  function computeBandpassCoeffs(freq, q, sr) {
    var w0 = 2 * Math.PI * freq / sr;
    var sinW0 = Math.sin(w0);
    var cosW0 = Math.cos(w0);
    var alpha = sinW0 / (2 * q);
    var a0 = 1 + alpha;
    return {
      b0: (sinW0 / 2) / a0,
      b1: 0,
      b2: -(sinW0 / 2) / a0,
      a1: (-2 * cosW0) / a0,
      a2: (1 - alpha) / a0
    };
  }

  // ============================================================
  // Body Resonance Instance (Web Audio graph per instrument)
  // ============================================================

  /**
   * Creates or reconfigures the filter bank for a given instrument.
   * Uses Web Audio BiquadFilterNodes in parallel, summed via a GainNode,
   * then mixed with the dry signal.
   */
  function createInstance(instId) {
    if (!audioContext) {
      return null;
    }

    var instance = instancesByInst[instId];
    if (instance) {
      // Already created — just reconfigure
      return instance;
    }

    // Input node: receives audio from engine output
    var inputNode = audioContext.createGain();
    inputNode.gain.value = 1.0;

    // Dry path
    var dryGain = audioContext.createGain();
    dryGain.gain.value = 1.0;

    // Wet path: parallel bandpass filters summed into a merge node
    var wetGain = audioContext.createGain();
    wetGain.gain.value = 0.0;

    var mergeNode = audioContext.createGain();
    mergeNode.gain.value = 1.0;

    // Output node: dry + wet combined
    var outputNode = audioContext.createGain();
    outputNode.gain.value = 1.0;

    // Create 6 bandpass filter nodes
    var filters = [];
    for (var i = 0; i < MAX_RESONATORS; i++) {
      var bpf = audioContext.createBiquadFilter();
      bpf.type = 'bandpass';
      bpf.frequency.value = 1000;
      bpf.Q.value = 10;
      bpf.gain.value = 0;
      filters.push(bpf);
    }

    // Wire: input -> dryGain -> outputNode
    inputNode.connect(dryGain);
    dryGain.connect(outputNode);

    // Wire: input -> each filter -> mergeNode -> wetGain -> outputNode
    for (var j = 0; j < MAX_RESONATORS; j++) {
      inputNode.connect(filters[j]);
      filters[j].connect(mergeNode);
    }
    mergeNode.connect(wetGain);
    wetGain.connect(outputNode);

    instance = {
      filters: filters,
      dryGain: dryGain,
      wetGain: wetGain,
      mergeNode: mergeNode,
      inputNode: inputNode,
      outputNode: outputNode,
      settings: JSON.parse(JSON.stringify(DEFAULT_BODY_SETTINGS))
    };

    instancesByInst[instId] = instance;
    return instance;
  }

  // ============================================================
  // Filter Configuration
  // ============================================================

  /**
   * Reconfigure the filter bank for the current body type and parameters.
   */
  function configureFilters(instId) {
    var instance = instancesByInst[instId];
    if (instance) {
      var settings = instance.settings;
      var bodyType = settings.bodyType || 'none';
      var model = BODY_MODELS[bodyType];

      if (!model || bodyType === NO_BODY_TYPE) {
        // Bypass: full dry, no wet
        instance.dryGain.gain.value = 1.0;
        instance.wetGain.gain.value = 0.0;
      } else {
        var resonanceAmount = Math.max(0, Math.min(100, settings.resonanceAmount)) / 100;
        var brightness = Math.max(0, Math.min(100, settings.brightness)) / 100;
        var bodySize = Math.max(0, Math.min(100, settings.bodySize)) / 100;

        // Body size scales all frequencies: 0% = 2x freq (tiny), 50% = 1x, 100% = 0.5x (large)
        var sizeScale = 1.0 / (0.5 + bodySize * 1.5);

        // Mix: resonanceAmount controls dry/wet balance
        instance.dryGain.gain.value = 1.0 - resonanceAmount * 0.5;
        instance.wetGain.gain.value = resonanceAmount * 0.8;

        var sr = audioContext.sampleRate;
        var nyquist = sr / 2 - 100;

        for (var i = 0; i < MAX_RESONATORS; i++) {
          var baseFreq = model.freqs[i];
          var gain = model.gains[i];
          var q = model.qs[i];

          if (baseFreq <= 0 || gain <= 0) {
            // Inactive resonator: set very low gain and move freq out of the way
            instance.filters[i].frequency.value = 20;
            instance.filters[i].Q.value = 0.5;
            instance.filters[i].gain.value = 0;
          } else {
            var scaledFreq = baseFreq * sizeScale;

            // Clamp to nyquist
            if (scaledFreq > nyquist) {
              scaledFreq = nyquist;
            }
            if (scaledFreq < 20) {
              scaledFreq = 20;
            }

            // Brightness affects Q and high-frequency gain rolloff
            // High brightness = sharper resonances, less rolloff
            // Low brightness = wider, duller resonances
            var qScale = 0.5 + brightness * 1.0;
            var gainScale = gain * (0.4 + brightness * 0.6);

            // Higher partials roll off more with low brightness
            var partialRolloff = Math.pow(0.3 + brightness * 0.7, i * 0.3);
            gainScale = gainScale * partialRolloff;

            instance.filters[i].frequency.value = scaledFreq;
            instance.filters[i].Q.value = Math.max(0.5, q * qScale);
            // BiquadFilter bandpass doesn't use gain param, but we scale via
            // a per-filter approach. Since all filters go to mergeNode,
            // we rely on Q and frequency to shape the response.
            // The overall amplitude is controlled by wetGain.
          }
        }
      }
    }
  }

  // ============================================================
  // Public API
  // ============================================================

  function init(ctx) {
    audioContext = ctx || (SL.audio && SL.audio.getCtx ? SL.audio.getCtx() : null);
    if (!audioContext) {
      console.error('[BODY-RESONANCE] No AudioContext available');
    } else {
      isEngineReady = true;
    }
  }

  function isReady() {
    return isEngineReady;
  }

  /**
   * Get or create the input node for an instrument.
   * The caller should connect their engine output to this node.
   * Returns the input GainNode.
   */
  function getInputNode(instId) {
    if (instId === undefined) {
      instId = 0;
    }
    var instance = createInstance(instId);
    if (instance) {
      return instance.inputNode;
    }
    return null;
  }

  /**
   * Get the output node for an instrument.
   * The caller should connect this to the instrument's masterOutput.
   * Returns the output GainNode.
   */
  function getOutputNode(instId) {
    if (instId === undefined) {
      instId = 0;
    }
    var instance = createInstance(instId);
    if (instance) {
      return instance.outputNode;
    }
    return null;
  }

  /**
   * Set the body type for an instrument.
   * @param {number} instId - Instrument index (0-3)
   * @param {string} type   - Body type key (e.g. 'violin', 'cello', 'none')
   */
  function setBody(instId, type) {
    if (instId === undefined) {
      instId = 0;
    }
    var instance = createInstance(instId);
    if (instance) {
      if (BODY_MODELS[type]) {
        instance.settings.bodyType = type;
      } else {
        instance.settings.bodyType = 'none';
      }
      configureFilters(instId);
    }
  }

  /**
   * Set the resonance amount (0-100%).
   */
  function setResonanceAmount(instId, value) {
    if (instId === undefined) {
      instId = 0;
    }
    var instance = createInstance(instId);
    if (instance) {
      instance.settings.resonanceAmount = Math.max(0, Math.min(100, value));
      configureFilters(instId);
    }
  }

  /**
   * Set the brightness (0-100%).
   */
  function setBrightness(instId, value) {
    if (instId === undefined) {
      instId = 0;
    }
    var instance = createInstance(instId);
    if (instance) {
      instance.settings.brightness = Math.max(0, Math.min(100, value));
      configureFilters(instId);
    }
  }

  /**
   * Set the body size (0-100%). Scales all resonance frequencies.
   */
  function setBodySize(instId, value) {
    if (instId === undefined) {
      instId = 0;
    }
    var instance = createInstance(instId);
    if (instance) {
      instance.settings.bodySize = Math.max(0, Math.min(100, value));
      configureFilters(instId);
    }
  }

  /**
   * Get current settings for an instrument.
   */
  function getSettings(instId) {
    if (instId === undefined) {
      instId = 0;
    }
    var instance = instancesByInst[instId];
    if (instance) {
      return JSON.parse(JSON.stringify(instance.settings));
    }
    return JSON.parse(JSON.stringify(DEFAULT_BODY_SETTINGS));
  }

  /**
   * Set all settings at once for an instrument.
   */
  function setSettings(instId, settings) {
    if (instId === undefined) {
      instId = 0;
    }
    var instance = createInstance(instId);
    if (instance) {
      instance.settings = JSON.parse(JSON.stringify(settings));
      configureFilters(instId);
    }
  }

  function getDefaultSettings() {
    return JSON.parse(JSON.stringify(DEFAULT_BODY_SETTINGS));
  }

  // ============================================================
  // Export to SynthLab Namespace
  // ============================================================

  SL.bodyResonance = {
    init: init,
    isReady: isReady,

    getInputNode: getInputNode,
    getOutputNode: getOutputNode,

    setBody: setBody,
    setResonanceAmount: setResonanceAmount,
    setBrightness: setBrightness,
    setBodySize: setBodySize,

    getSettings: getSettings,
    setSettings: setSettings,
    getDefaultSettings: getDefaultSettings,

    BODY_MODELS: BODY_MODELS,
    BODY_TYPE_LIST: BODY_TYPE_LIST,
    DEFAULT_BODY_SETTINGS: DEFAULT_BODY_SETTINGS,
    MAX_RESONATORS: MAX_RESONATORS
  };

})();
