// Super Synth Lab - LFO Engine Module
// Adds 2 LFOs per instrument (LFO1 and LFO2)
// Loads AFTER audio-engine.js and extends SL.audio
// Targets: pitch (vibrato), filter (wah), amplitude (tremolo), pan
(function() {
  'use strict';

  var SL = window.SynthLab;

  if (!SL || !SL.audio) {
    console.error('[lfo-engine] SynthLab.audio not available');
    return;
  }

  // ============================================================
  // Constants
  // ============================================================

  var NUM_INSTRUMENTS = 5;
  var NUM_LFOS = 2;

  /** Default LFO settings */
  var DEFAULT_LFO = {
    enabled: false,
    rate: 2.0,
    depth: 50,
    waveform: 'sine',
    target: 'none'
  };

  // ============================================================
  // Per-Instrument LFO State
  // ============================================================

  /**
   * Per-instrument LFO audio node state.
   * Each entry (when initialized) has:
   * {
   *   lfo1: { osc, gain, shProcessor, tremoloGain, panNode, ... },
   *   lfo2: { osc, gain, shProcessor, tremoloGain, panNode, ... },
   *   chainInserted: false  // whether tremolo/pan nodes are in signal chain
   * }
   */
  var lfoNodes = [null, null, null, null, null];

  // ============================================================
  // Settings Helpers
  // ============================================================

  /**
   * Ensure instrument has LFO settings initialized
   * @param {number} instId - Instrument index
   */
  function ensureLFOSettings(instId) {
    var instruments = SL.audio.getInstruments();
    if (!instruments || !instruments[instId]) {
      return;
    }
    var settings = instruments[instId].settings;
    if (!settings.lfo) {
      settings.lfo = {
        lfo1: cloneLFO(DEFAULT_LFO),
        lfo2: cloneLFO(DEFAULT_LFO)
      };
    } else {
      if (!settings.lfo.lfo1) {
        settings.lfo.lfo1 = cloneLFO(DEFAULT_LFO);
      }
      if (!settings.lfo.lfo2) {
        settings.lfo.lfo2 = cloneLFO(DEFAULT_LFO);
      }
    }
  }

  /**
   * Clone an LFO settings object
   * @param {Object} lfo - LFO settings
   * @returns {Object}
   */
  function cloneLFO(lfo) {
    return {
      enabled: lfo.enabled,
      rate: lfo.rate,
      depth: lfo.depth,
      waveform: lfo.waveform,
      target: lfo.target
    };
  }

  /**
   * Get the settings for a specific LFO
   * @param {number} instId - Instrument index
   * @param {number} lfoNum - 1 or 2
   * @returns {Object}
   */
  function getLFOSettingsForNum(instId, lfoNum) {
    ensureLFOSettings(instId);
    var instruments = SL.audio.getInstruments();
    if (!instruments || !instruments[instId]) {
      return cloneLFO(DEFAULT_LFO);
    }
    var key = 'lfo' + lfoNum;
    return instruments[instId].settings.lfo[key];
  }

  // ============================================================
  // LFO Oscillator / S&H Node Creation
  // ============================================================

  /**
   * Create an LFO source node (OscillatorNode or ScriptProcessor for S&H)
   * @param {AudioContext} ctx - Audio context
   * @param {string} waveform - 'sine', 'triangle', 'square', 'saw', or 'sh'
   * @param {number} rate - LFO rate in Hz
   * @returns {{ node: AudioNode, isSH: boolean, shInterval: number|null }}
   */
  function createLFOSource(ctx, waveform, rate) {
    if (waveform === 'sh') {
      // Sample & Hold: ScriptProcessorNode that outputs random values
      var bufSize = (SL.audio && SL.audio.getScriptProcessorBufferSize)
        ? SL.audio.getScriptProcessorBufferSize()
        : 1024;
      var shProcessor = ctx.createScriptProcessor(bufSize, 0, 1);
      var shHoldValue = 0;
      var shSamplesPerHold = Math.max(1, Math.floor(ctx.sampleRate / Math.max(0.1, rate)));
      var shSampleCount = 0;

      shProcessor.onaudioprocess = function(e) {
        var output = e.outputBuffer.getChannelData(0);
        for (var i = 0; i < output.length; i++) {
          if (shSampleCount >= shSamplesPerHold) {
            shHoldValue = Math.random() * 2 - 1;
            shSampleCount = 0;
          }
          output[i] = shHoldValue;
          shSampleCount++;
        }
      };

      // Store rate info for updates
      shProcessor._shRate = rate;
      shProcessor._shSamplesPerHold = shSamplesPerHold;
      shProcessor._shSampleCount = 0;

      return { node: shProcessor, isSH: true };
    }

    // Standard oscillator waveforms
    var osc = ctx.createOscillator();
    if (waveform === 'saw') {
      osc.type = 'sawtooth';
    } else {
      osc.type = waveform; // sine, triangle, square
    }
    osc.frequency.value = rate;
    osc.start();

    return { node: osc, isSH: false };
  }

  // ============================================================
  // Signal Chain Insertion (Amplitude & Pan)
  // ============================================================

  /**
   * Insert tremolo and pan nodes into the instrument signal chain.
   * Chain becomes: volumeNode -> tremoloGain -> panNode -> effectChain.input
   *
   * Both LFOs share the same tremolo and pan nodes per instrument.
   *
   * @param {number} instId - Instrument index
   */
  function insertChainNodes(instId) {
    var instruments = SL.audio.getInstruments();
    if (!instruments || !instruments[instId]) {
      return;
    }
    var inst = instruments[instId];
    var state = lfoNodes[instId];
    if (!state || state.chainInserted) {
      return;
    }
    if (!inst.volumeNode || !inst.effectChain) {
      return;
    }

    var ctx = SL.audio.getCtx();
    if (!ctx) {
      return;
    }

    // Create shared tremolo gain (pass-through by default: gain = 1)
    state.tremoloGain = ctx.createGain();
    state.tremoloGain.gain.value = 1.0;

    // Create shared pan node (pass-through by default: pan = 0)
    state.panNode = ctx.createStereoPanner();
    state.panNode.pan.value = 0;

    // Disconnect volumeNode from effectChain and re-route
    try {
      inst.volumeNode.disconnect(inst.effectChain.input);
    } catch (e) {
      // May not be connected yet, that's ok
    }

    inst.volumeNode.connect(state.tremoloGain);
    state.tremoloGain.connect(state.panNode);
    state.panNode.connect(inst.effectChain.input);

    state.chainInserted = true;
  }

  /**
   * Remove tremolo and pan nodes from the signal chain, restoring direct routing.
   * @param {number} instId - Instrument index
   */
  function removeChainNodes(instId) {
    var instruments = SL.audio.getInstruments();
    if (!instruments || !instruments[instId]) {
      return;
    }
    var inst = instruments[instId];
    var state = lfoNodes[instId];
    if (!state || !state.chainInserted) {
      return;
    }

    try {
      inst.volumeNode.disconnect(state.tremoloGain);
      state.tremoloGain.disconnect(state.panNode);
      state.panNode.disconnect(inst.effectChain.input);
    } catch (e) {
      // Ignore disconnection errors
    }

    // Restore direct connection
    if (inst.volumeNode && inst.effectChain) {
      inst.volumeNode.connect(inst.effectChain.input);
    }

    state.tremoloGain = null;
    state.panNode = null;
    state.chainInserted = false;
  }

  // ============================================================
  // Single LFO Setup / Teardown
  // ============================================================

  /**
   * Build the audio nodes for one LFO on one instrument.
   * @param {number} instId - Instrument index
   * @param {number} lfoNum - 1 or 2
   */
  function buildLFONodes(instId, lfoNum) {
    var ctx = SL.audio.getCtx();
    if (!ctx) {
      return;
    }

    var settings = getLFOSettingsForNum(instId, lfoNum);
    var state = lfoNodes[instId];
    var key = 'lfo' + lfoNum;

    // Tear down existing nodes for this LFO
    teardownLFONodes(instId, lfoNum);

    // If not enabled or target is none, nothing to build
    if (!settings.enabled || settings.target === 'none') {
      return;
    }

    var lfo = {};
    lfo.target = settings.target;
    lfo.depth = settings.depth;
    lfo.rate = settings.rate;
    lfo.waveform = settings.waveform;

    // Create the LFO source (oscillator or S&H)
    var source = createLFOSource(ctx, settings.waveform, settings.rate);
    lfo.source = source.node;
    lfo.isSH = source.isSH;

    // Create depth gain node
    lfo.depthGain = ctx.createGain();

    // Connect source -> depthGain
    lfo.source.connect(lfo.depthGain);

    // Configure depth based on target
    if (settings.target === 'pitch') {
      // Vibrato: depth in cents. Max 100 cents at 100% depth.
      lfo.depthGain.gain.value = settings.depth * 1.0;
    } else if (settings.target === 'filter') {
      // Filter modulation: depth in Hz. Max 2000 Hz at 100% depth.
      lfo.depthGain.gain.value = (settings.depth / 100) * 2000;
    } else if (settings.target === 'amplitude') {
      // Tremolo: depth 0-1. depth/100.
      lfo.depthGain.gain.value = settings.depth / 100;

      // Ensure chain nodes are inserted
      insertChainNodes(instId);

      // Connect LFO to tremolo gain's gain param
      if (state.tremoloGain) {
        lfo.depthGain.connect(state.tremoloGain.gain);
      }
    } else if (settings.target === 'pan') {
      // Pan: depth -1 to 1. Map depth% to range.
      lfo.depthGain.gain.value = settings.depth / 100;

      // Ensure chain nodes are inserted
      insertChainNodes(instId);

      // Connect LFO to pan node's pan param
      if (state.panNode) {
        lfo.depthGain.connect(state.panNode.pan);
      }
    }

    // For S&H, connect to a silent destination so ScriptProcessor stays alive
    if (lfo.isSH) {
      var silentGain = ctx.createGain();
      silentGain.gain.value = 0;
      silentGain.connect(ctx.destination);
      lfo.source.connect(silentGain);
      lfo.silentGain = silentGain;
    }

    state[key] = lfo;
  }

  /**
   * Tear down audio nodes for one LFO
   * @param {number} instId - Instrument index
   * @param {number} lfoNum - 1 or 2
   */
  function teardownLFONodes(instId, lfoNum) {
    var state = lfoNodes[instId];
    if (!state) {
      return;
    }
    var key = 'lfo' + lfoNum;
    var lfo = state[key];
    if (!lfo) {
      return;
    }

    // Disconnect everything
    try {
      if (lfo.depthGain) {
        lfo.depthGain.disconnect();
      }
    } catch (e) { /* ignore */ }

    try {
      if (lfo.source) {
        lfo.source.disconnect();
        // Stop oscillator if it's an OscillatorNode
        if (!lfo.isSH && lfo.source.stop) {
          lfo.source.stop();
        }
      }
    } catch (e) { /* ignore */ }

    try {
      if (lfo.silentGain) {
        lfo.silentGain.disconnect();
      }
    } catch (e) { /* ignore */ }

    state[key] = null;

    // If neither LFO targets amplitude or pan, remove chain nodes
    checkAndRemoveChainNodes(instId);
  }

  /**
   * Check if any LFO still needs the chain nodes; if not, remove them.
   * @param {number} instId - Instrument index
   */
  function checkAndRemoveChainNodes(instId) {
    var state = lfoNodes[instId];
    if (!state || !state.chainInserted) {
      return;
    }

    var needsChain = false;
    var lfo1 = state.lfo1;
    var lfo2 = state.lfo2;

    if (lfo1 && (lfo1.target === 'amplitude' || lfo1.target === 'pan')) {
      needsChain = true;
    }
    if (lfo2 && (lfo2.target === 'amplitude' || lfo2.target === 'pan')) {
      needsChain = true;
    }

    if (!needsChain) {
      removeChainNodes(instId);
    }
  }

  // ============================================================
  // Per-Voice LFO Application (Pitch & Filter)
  // ============================================================

  /**
   * Connect LFO modulation to a voice's oscillators (pitch) or filter (filter).
   * Called when a sustained note starts.
   * @param {number} instId - Instrument index
   * @param {Object} voice - Voice object from the voice pool
   */
  function applyLFOToVoice(instId, voice) {
    if (!voice) {
      return;
    }
    var state = lfoNodes[instId];
    if (!state) {
      return;
    }

    // Track connections on the voice for later removal
    if (!voice._lfoConnections) {
      voice._lfoConnections = [];
    }

    for (var n = 1; n <= NUM_LFOS; n++) {
      var key = 'lfo' + n;
      var lfo = state[key];
      if (!lfo) {
        continue;
      }

      if (lfo.target === 'pitch' && voice.oscillators) {
        // Connect LFO depth gain to each oscillator's detune param
        for (var i = 0; i < voice.oscillators.length; i++) {
          var oscEntry = voice.oscillators[i];
          if (oscEntry && oscEntry.osc && oscEntry.osc.detune) {
            try {
              lfo.depthGain.connect(oscEntry.osc.detune);
              voice._lfoConnections.push({
                source: lfo.depthGain,
                dest: oscEntry.osc.detune,
                lfoKey: key
              });
            } catch (e) {
              // Oscillator may have been stopped/disposed
            }
          }
        }
      } else if (lfo.target === 'filter' && voice.filterChain) {
        // Connect LFO depth gain to the first filter's frequency param
        if (voice.filterChain.filters && voice.filterChain.filters.length > 0) {
          var filter = voice.filterChain.filters[0];
          if (filter && filter.frequency) {
            try {
              lfo.depthGain.connect(filter.frequency);
              voice._lfoConnections.push({
                source: lfo.depthGain,
                dest: filter.frequency,
                lfoKey: key
              });
            } catch (e) {
              // Filter may have been disposed
            }
          }
        }
      }
      // amplitude and pan targets are handled via chain nodes, not per-voice
    }
  }

  /**
   * Disconnect LFO modulation from a voice.
   * Called when a sustained note stops.
   * @param {number} instId - Instrument index
   * @param {Object} voice - Voice object from the voice pool
   */
  function removeLFOFromVoice(instId, voice) {
    if (!voice || !voice._lfoConnections) {
      return;
    }

    for (var i = 0; i < voice._lfoConnections.length; i++) {
      var conn = voice._lfoConnections[i];
      try {
        conn.source.disconnect(conn.dest);
      } catch (e) {
        // Already disconnected or node disposed
      }
    }

    voice._lfoConnections = [];
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Initialize LFO system for an instrument.
   * Creates LFO audio nodes based on current settings.
   * @param {number} instId - Instrument index (0-4)
   */
  function initLFOForInstrument(instId) {
    if (instId < 0 || instId >= NUM_INSTRUMENTS) {
      return;
    }

    ensureLFOSettings(instId);

    // Clean up any existing state
    if (lfoNodes[instId]) {
      destroyLFO(instId);
    }

    lfoNodes[instId] = {
      lfo1: null,
      lfo2: null,
      tremoloGain: null,
      panNode: null,
      chainInserted: false
    };

    // Build nodes for each LFO that is enabled
    buildLFONodes(instId, 1);
    buildLFONodes(instId, 2);
  }

  /**
   * Update a single parameter of an LFO.
   * @param {number} instId - Instrument index
   * @param {number} lfoNum - 1 or 2
   * @param {string} param - 'rate', 'depth', 'waveform', 'target', or 'enabled'
   * @param {*} value - New value
   */
  function updateLFO(instId, lfoNum, param, value) {
    if (instId < 0 || instId >= NUM_INSTRUMENTS) {
      return;
    }
    if (lfoNum !== 1 && lfoNum !== 2) {
      return;
    }

    ensureLFOSettings(instId);
    var settings = getLFOSettingsForNum(instId, lfoNum);
    settings[param] = value;

    // If LFO nodes haven't been initialized yet, init them
    if (!lfoNodes[instId]) {
      initLFOForInstrument(instId);
      return;
    }

    var state = lfoNodes[instId];
    var key = 'lfo' + lfoNum;
    var lfo = state[key];

    // For target, enabled, or waveform changes, rebuild the LFO nodes entirely
    if (param === 'target' || param === 'enabled' || param === 'waveform') {
      buildLFONodes(instId, lfoNum);
      // Re-apply to any currently active voices
      reapplyLFOToActiveVoices(instId);
      return;
    }

    // Live parameter updates (rate, depth) without rebuilding
    if (lfo) {
      if (param === 'rate') {
        if (lfo.isSH) {
          // For S&H, update the samples-per-hold calculation
          // Need to rebuild since ScriptProcessor doesn't support live rate changes easily
          buildLFONodes(instId, lfoNum);
          reapplyLFOToActiveVoices(instId);
        } else {
          // Standard oscillator: just update frequency
          if (lfo.source && lfo.source.frequency) {
            lfo.source.frequency.value = value;
          }
        }
        lfo.rate = value;
      } else if (param === 'depth') {
        lfo.depth = value;
        if (lfo.depthGain) {
          if (lfo.target === 'pitch') {
            lfo.depthGain.gain.value = value * 1.0;
          } else if (lfo.target === 'filter') {
            lfo.depthGain.gain.value = (value / 100) * 2000;
          } else if (lfo.target === 'amplitude') {
            lfo.depthGain.gain.value = value / 100;
          } else if (lfo.target === 'pan') {
            lfo.depthGain.gain.value = value / 100;
          }
        }
      }
    }
  }

  /**
   * Re-apply LFO connections to all currently active voices for an instrument.
   * Called after LFO target or waveform changes.
   * @param {number} instId - Instrument index
   */
  function reapplyLFOToActiveVoices(instId) {
    var instruments = SL.audio.getInstruments();
    if (!instruments || !instruments[instId]) {
      return;
    }

    var activeOscs = instruments[instId].activeOscillators;
    if (!activeOscs || activeOscs.size === 0) {
      return;
    }

    activeOscs.forEach(function(node) {
      if (node && node.voice) {
        // Remove old connections first
        removeLFOFromVoice(instId, node.voice);
        // Re-apply
        applyLFOToVoice(instId, node.voice);
      }
    });
  }

  /**
   * Get LFO settings for an instrument.
   * @param {number} instId - Instrument index
   * @returns {{ lfo1: Object, lfo2: Object }}
   */
  function getLFOSettings(instId) {
    ensureLFOSettings(instId);
    var instruments = SL.audio.getInstruments();
    if (!instruments || !instruments[instId]) {
      return {
        lfo1: cloneLFO(DEFAULT_LFO),
        lfo2: cloneLFO(DEFAULT_LFO)
      };
    }
    return instruments[instId].settings.lfo;
  }

  /**
   * Set LFO settings for an instrument (bulk update).
   * @param {number} instId - Instrument index
   * @param {number} lfoNum - 1 or 2
   * @param {Object} settings - Partial or full LFO settings
   */
  function setLFOSettings(instId, lfoNum, settings) {
    if (instId < 0 || instId >= NUM_INSTRUMENTS) {
      return;
    }
    if (lfoNum !== 1 && lfoNum !== 2) {
      return;
    }

    ensureLFOSettings(instId);
    var instruments = SL.audio.getInstruments();
    var key = 'lfo' + lfoNum;
    var current = instruments[instId].settings.lfo[key];

    // Merge settings
    if (settings.hasOwnProperty('enabled')) { current.enabled = settings.enabled; }
    if (settings.hasOwnProperty('rate')) { current.rate = settings.rate; }
    if (settings.hasOwnProperty('depth')) { current.depth = settings.depth; }
    if (settings.hasOwnProperty('waveform')) { current.waveform = settings.waveform; }
    if (settings.hasOwnProperty('target')) { current.target = settings.target; }

    // Rebuild the LFO nodes if initialized
    if (lfoNodes[instId]) {
      buildLFONodes(instId, lfoNum);
      reapplyLFOToActiveVoices(instId);
    }
  }

  /**
   * Destroy all LFO nodes for an instrument (cleanup).
   * @param {number} instId - Instrument index
   */
  function destroyLFO(instId) {
    if (instId < 0 || instId >= NUM_INSTRUMENTS) {
      return;
    }

    var state = lfoNodes[instId];
    if (!state) {
      return;
    }

    // Tear down both LFOs
    teardownLFONodes(instId, 1);
    teardownLFONodes(instId, 2);

    // Remove chain nodes if still inserted
    if (state.chainInserted) {
      removeChainNodes(instId);
    }

    lfoNodes[instId] = null;
  }

  // ============================================================
  // Active-Voice Gate: disconnect LFO oscillators when idle
  // ============================================================

  /** Per-instrument count of active voices connected to LFO */
  var activeVoiceCounts = [0, 0, 0, 0, 0];

  /**
   * Disconnect LFO source from its depthGain so the oscillator
   * runs but produces no audible modulation. Cheaper than stop/start.
   */
  function suspendLFONodes(instId) {
    var state = lfoNodes[instId];
    if (!state) {
      return;
    }
    for (var n = 1; n <= NUM_LFOS; n++) {
      var lfo = state['lfo' + n];
      if (lfo && lfo.source && lfo.depthGain && !lfo._suspended) {
        try { lfo.source.disconnect(lfo.depthGain); } catch (e) { /* ignore */ }
        lfo._suspended = true;
      }
    }
  }

  /**
   * Reconnect LFO source to depthGain after suspension.
   */
  function resumeLFONodes(instId) {
    var state = lfoNodes[instId];
    if (!state) {
      return;
    }
    for (var n = 1; n <= NUM_LFOS; n++) {
      var lfo = state['lfo' + n];
      if (lfo && lfo.source && lfo.depthGain && lfo._suspended) {
        try { lfo.source.connect(lfo.depthGain); } catch (e) { /* ignore */ }
        lfo._suspended = false;
      }
    }
  }

  /**
   * Called on noteOn — track active voice and resume LFOs if needed.
   */
  function onVoiceStart(instId) {
    if (instId < 0 || instId >= NUM_INSTRUMENTS) {
      return;
    }
    var wasZero = (activeVoiceCounts[instId] === 0);
    activeVoiceCounts[instId]++;
    if (wasZero) {
      resumeLFONodes(instId);
    }
  }

  /**
   * Called on noteOff — track active voice and suspend LFOs when idle.
   */
  function onVoiceEnd(instId) {
    if (instId < 0 || instId >= NUM_INSTRUMENTS) {
      return;
    }
    activeVoiceCounts[instId] = Math.max(0, activeVoiceCounts[instId] - 1);
    if (activeVoiceCounts[instId] === 0) {
      suspendLFONodes(instId);
    }
  }

  // ============================================================
  // Register on SL.audio
  // ============================================================

  SL.audio.initLFO = initLFOForInstrument;
  SL.audio.updateLFO = updateLFO;
  SL.audio.applyLFOToVoice = applyLFOToVoice;
  SL.audio.removeLFOFromVoice = removeLFOFromVoice;
  SL.audio.getLFOSettings = getLFOSettings;
  SL.audio.setLFOSettings = setLFOSettings;
  SL.audio.destroyLFO = destroyLFO;
  SL.audio.onLFOVoiceStart = onVoiceStart;
  SL.audio.onLFOVoiceEnd = onVoiceEnd;

  // Also expose the default settings for preset/save/load systems
  SL.audio._DEFAULT_LFO = DEFAULT_LFO;

})();
