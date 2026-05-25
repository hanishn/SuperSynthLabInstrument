// Super Synth Lab - Modulation Matrix Engine
// Flexible routing of modulation sources to destinations
// Loads AFTER audio-engine.js and lfo-engine.js, extends SL.audio
(function() {
  'use strict';

  var SL = window.SynthLab;

  if (SL && SL.audio) {

  // ============================================================
  // Constants
  // ============================================================

  var NUM_INSTRUMENTS = 5;
  var NUM_SLOTS = 8;

  var NO_SELECTION = 'none';

  /** Available modulation sources */
  var MOD_SOURCES = [
    { id: 'none', label: 'None', i18n: 'mod_source.none' },
    { id: 'lfo1', label: 'LFO 1', i18n: 'mod_source.lfo1' },
    { id: 'lfo2', label: 'LFO 2', i18n: 'mod_source.lfo2' },
    { id: 'envelope', label: 'Envelope', i18n: 'mod_source.envelope' },
    { id: 'velocity', label: 'Velocity', i18n: 'mod_source.velocity' },
    { id: 'modwheel', label: 'Mod Wheel', i18n: 'mod_source.mod_wheel' },
    { id: 'aftertouch', label: 'Aftertouch', i18n: 'mod_source.aftertouch' }
  ];

  /** Available modulation destinations */
  var MOD_DESTINATIONS = [
    { id: 'none', label: 'None', i18n: 'mod_dest.none' },
    { id: 'pitch', label: 'Pitch', i18n: 'mod_dest.pitch' },
    { id: 'filterCutoff', label: 'Filter Cutoff', i18n: 'mod_dest.filter_cutoff' },
    { id: 'filterResonance', label: 'Filter Resonance', i18n: 'mod_dest.filter_resonance' },
    { id: 'amplitude', label: 'Amplitude', i18n: 'mod_dest.amplitude' },
    { id: 'pan', label: 'Pan', i18n: 'mod_dest.pan' },
    { id: 'fmDepth', label: 'FM Depth', i18n: 'mod_dest.fm_depth' },
    { id: 'lfo1Rate', label: 'LFO1 Rate', i18n: 'mod_dest.lfo1_rate' },
    { id: 'lfo2Rate', label: 'LFO2 Rate', i18n: 'mod_dest.lfo2_rate' }
  ];

  /** Default routing slot */
  var DEFAULT_SLOT = {
    enabled: false,
    source: 'none',
    destination: 'none',
    amount: 0
  };

  // ============================================================
  // Per-Instrument Mod Matrix State
  // ============================================================

  /**
   * Per-instrument mod matrix audio state.
   * Each entry holds active modulation node connections.
   */
  var matrixNodes = [null, null, null, null, null];

  /**
   * Per-instrument MIDI controller state.
   * Stores modWheel (CC1), aftertouch, and velocity values.
   */
  var controllerState = [];
  for (var ci = 0; ci < NUM_INSTRUMENTS; ci++) {
    controllerState.push({
      modWheel: 0,
      aftertouch: 0,
      velocity: 127
    });
  }

  // ============================================================
  // Settings Helpers
  // ============================================================

  /**
   * Clone a single routing slot
   * @param {Object} slot
   * @returns {Object}
   */
  function cloneSlot(slot) {
    return {
      enabled: slot.enabled,
      source: slot.source,
      destination: slot.destination,
      amount: slot.amount
    };
  }

  /**
   * Create default mod matrix settings (8 empty slots)
   * @returns {Array}
   */
  function createDefaultSlots() {
    var slots = [];
    for (var i = 0; i < NUM_SLOTS; i++) {
      slots.push(cloneSlot(DEFAULT_SLOT));
    }
    return slots;
  }

  /**
   * Ensure instrument has mod matrix settings initialized
   * @param {number} instId
   */
  function ensureModMatrixSettings(instId) {
    var instruments = SL.audio.getInstruments();
    if (instruments && instruments[instId]) {
    var settings = instruments[instId].settings;
    if (!settings.modMatrix) {
      settings.modMatrix = createDefaultSlots();
    } else {
      // Ensure we have exactly NUM_SLOTS slots
      while (settings.modMatrix.length < NUM_SLOTS) {
        settings.modMatrix.push(cloneSlot(DEFAULT_SLOT));
      }
    }
    } // end if (instruments && instruments[instId])
  }

  /**
   * Get mod matrix settings for an instrument
   * @param {number} instId
   * @returns {Array}
   */
  function getModMatrixSettings(instId) {
    ensureModMatrixSettings(instId);
    var instruments = SL.audio.getInstruments();
    if (!instruments || !instruments[instId]) {
      return createDefaultSlots();
    }
    return instruments[instId].settings.modMatrix;
  }

  // ============================================================
  // Modulation Signal Computation
  // ============================================================

  /**
   * Get the current modulation value for a source.
   * LFO sources return values via their audio nodes (handled in per-voice apply).
   * Non-audio sources (velocity, modwheel, aftertouch) return scalar values.
   *
   * @param {string} sourceId - Source identifier
   * @param {number} instId - Instrument index
   * @returns {number} Modulation value in -1..1 range (or 0..1 for some)
   */
  function getSourceValue(sourceId, instId) {
    var ctrl = controllerState[instId];
    if (sourceId === 'velocity') {
      // Velocity: 0..127 mapped to 0..1
      return ctrl.velocity / 127;
    } else if (sourceId === 'modwheel') {
      // Mod wheel CC1: 0..127 mapped to 0..1
      return ctrl.modWheel / 127;
    } else if (sourceId === 'aftertouch') {
      // Aftertouch: 0..127 mapped to 0..1
      return ctrl.aftertouch / 127;
    }
    // LFO and envelope sources are connected via audio nodes, not scalar values
    return 0;
  }

  /**
   * Check whether a source requires audio-rate routing (LFO, envelope)
   * or is a scalar control value (velocity, modwheel, aftertouch).
   * @param {string} sourceId
   * @returns {boolean}
   */
  function isAudioRateSource(sourceId) {
    return sourceId === 'lfo1' || sourceId === 'lfo2' || sourceId === 'envelope';
  }

  // ============================================================
  // Destination Parameter Scaling
  // ============================================================

  /**
   * Get the modulation depth range for a destination.
   * The amount slider (-100..+100) maps to this range.
   * @param {string} destId
   * @returns {{ min: number, max: number, unit: string }}
   */
  function getDestinationRange(destId) {
    if (destId === 'pitch') {
      return { min: -1200, max: 1200, unit: 'cents' };
    } else if (destId === 'filterCutoff') {
      return { min: -4000, max: 4000, unit: 'Hz' };
    } else if (destId === 'filterResonance') {
      return { min: -20, max: 20, unit: 'Q' };
    } else if (destId === 'amplitude') {
      return { min: -1, max: 1, unit: 'gain' };
    } else if (destId === 'pan') {
      return { min: -1, max: 1, unit: 'pan' };
    } else if (destId === 'fmDepth') {
      return { min: -100, max: 100, unit: '%' };
    } else if (destId === 'lfo1Rate') {
      return { min: -10, max: 10, unit: 'Hz' };
    } else if (destId === 'lfo2Rate') {
      return { min: -10, max: 10, unit: 'Hz' };
    }
    return { min: -1, max: 1, unit: '' };
  }

  /**
   * Convert amount (-100..+100) to actual modulation depth for a destination.
   * @param {number} amount - Slider value -100..+100
   * @param {string} destId - Destination identifier
   * @returns {number} Scaled depth value
   */
  function amountToDepth(amount, destId) {
    var range = getDestinationRange(destId);
    // amount is -100..100, map to min..max proportionally
    if (amount >= 0) {
      return (amount / 100) * range.max;
    }
    return (Math.abs(amount) / 100) * range.min;
  }

  // ============================================================
  // Per-Voice Modulation Application
  // ============================================================

  /**
   * Apply mod matrix routings to a voice.
   * Audio-rate sources (LFO1, LFO2) connect their depth gain to voice params.
   * Scalar sources (velocity, modwheel, aftertouch) apply immediate param offsets.
   *
   * @param {number} instId - Instrument index
   * @param {Object} voice - Voice object from the voice pool
   */
  function applyModMatrixToVoice(instId, voice) {
    if (voice) {

    var slots = getModMatrixSettings(instId);
    var ctx = SL.audio.getCtx();
    if (ctx) {

    if (!voice._modMatrixConnections) {
      voice._modMatrixConnections = [];
    }

    for (var i = 0; i < slots.length; i++) {
      var slot = slots[i];
      var isSlotDisabled = !slot.enabled || slot.source === NO_SELECTION;
      var shouldSkipSlot = isSlotDisabled || slot.destination === NO_SELECTION || slot.amount === 0;
      if (shouldSkipSlot) {
        continue;
      }

      var depth = amountToDepth(slot.amount, slot.destination);

      if (isAudioRateSource(slot.source)) {
        // Audio-rate: connect LFO or envelope node to destination AudioParam
        applyAudioRateRoute(instId, voice, slot, depth, ctx, i);
      } else {
        // Scalar: apply immediate offset to destination
        applyScalarRoute(instId, voice, slot, depth);
      }
    }
    } // end if (ctx)
    } // end if (voice)
  }

  /**
   * Apply an audio-rate modulation route (LFO or envelope to AudioParam).
   * Creates a gain node to scale the source signal by the route's depth.
   *
   * @param {number} instId
   * @param {Object} voice
   * @param {Object} slot
   * @param {number} depth
   * @param {AudioContext} ctx
   * @param {number} slotIndex
   */
  function applyAudioRateRoute(instId, voice, slot, depth, ctx, slotIndex) {
    var sourceNode = getAudioSourceNode(instId, slot.source);
    if (sourceNode) {

    // Create a per-route depth gain node
    var routeGain = ctx.createGain();
    routeGain.gain.value = depth;

    // Connect source -> routeGain
    sourceNode.connect(routeGain);

    // Connect routeGain to the destination AudioParam
    var destParam = getDestinationParam(voice, slot.destination, instId);
    if (destParam) {
      routeGain.connect(destParam);
      voice._modMatrixConnections.push({
        sourceNode: sourceNode,
        routeGain: routeGain,
        destParam: destParam,
        slotIndex: slotIndex
      });
    } else {
      // Clean up if no valid destination
      try { routeGain.disconnect(); } catch (e) { /* node already disconnected */ }
    }
    } // end if (sourceNode)
  }

  /**
   * Apply a scalar modulation route (velocity, modwheel, aftertouch).
   * Applies an immediate offset to the destination parameter.
   *
   * @param {number} instId
   * @param {Object} voice
   * @param {Object} slot
   * @param {number} depth
   */
  function applyScalarRoute(instId, voice, slot, depth) {
    var sourceVal = getSourceValue(slot.source, instId);
    var offset = sourceVal * depth;

    applyScalarOffset(voice, slot.destination, offset, instId);
  }

  /**
   * Get the audio source node for an audio-rate mod source.
   * @param {number} instId
   * @param {string} sourceId
   * @returns {AudioNode|null}
   */
  function getAudioSourceNode(instId, sourceId) {
    if (sourceId === 'lfo1' || sourceId === 'lfo2') {
      // Access the LFO engine's internal nodes
      var lfoSettings = SL.audio.getLFOSettings ? SL.audio.getLFOSettings(instId) : null;
      if (!lfoSettings) {
        return null;
      }

      // We need the LFO's source node. The LFO engine stores nodes internally.
      // We can access them through the mod matrix node state or create a new
      // oscillator that mirrors the LFO settings.
      var state = matrixNodes[instId];
      if (!state) {
        return null;
      }

      var key = sourceId; // 'lfo1' or 'lfo2'
      if (state.lfoSources && state.lfoSources[key]) {
        return state.lfoSources[key].depthGain || state.lfoSources[key].source;
      }

      // Create a mirrored LFO source for mod matrix routing
      var lfoKey = sourceId === 'lfo1' ? 'lfo1' : 'lfo2';
      var lfoNum = sourceId === 'lfo1' ? 1 : 2;
      var lfo = lfoSettings[lfoKey];
      if (!lfo || !lfo.enabled) {
        return null;
      }

      var ctx = SL.audio.getCtx();
      if (!ctx) {
        return null;
      }

      // Create a shared oscillator source for this LFO in the mod matrix
      var osc = ctx.createOscillator();
      if (lfo.waveform === 'saw') {
        osc.type = 'sawtooth';
      } else if (lfo.waveform === 'sh') {
        // For S&H, use a sine as approximation in mod matrix
        osc.type = 'sine';
      } else {
        osc.type = lfo.waveform;
      }
      osc.frequency.value = lfo.rate;
      osc.start();

      var depthGain = ctx.createGain();
      depthGain.gain.value = 1.0; // Unit-amplitude; per-route gain handles scaling
      osc.connect(depthGain);

      if (!state.lfoSources) {
        state.lfoSources = {};
      }
      state.lfoSources[key] = { source: osc, depthGain: depthGain };

      return depthGain;
    } else if (sourceId === 'envelope') {
      // Envelope source: create a ConstantSourceNode that tracks the ADSR
      // output. For simplicity, we use a constant source set to 1.0 and let
      // the per-route gain handle scaling. The actual envelope modulation
      // is applied as a scalar offset at note-on time based on ADSR phase.
      var state2 = matrixNodes[instId];
      if (!state2) {
        return null;
      }
      if (state2.envSource) {
        return state2.envSource;
      }

      var ctx2 = SL.audio.getCtx();
      if (!ctx2) {
        return null;
      }

      // Use ConstantSourceNode if available, otherwise GainNode pattern
      if (ctx2.createConstantSource) {
        var cs = ctx2.createConstantSource();
        cs.offset.value = 1.0;
        cs.start();
        state2.envSource = cs;
        return cs;
      }
      return null;
    }

    return null;
  }

  /**
   * Get the AudioParam for a destination on a voice.
   * @param {Object} voice
   * @param {string} destId
   * @param {number} instId
   * @returns {AudioParam|null}
   */
  function getDestinationParam(voice, destId, instId) {
    if (destId === 'pitch') {
      // Connect to first oscillator's detune
      if (voice.oscillators && voice.oscillators.length > 0) {
        var oscEntry = voice.oscillators[0];
        var hasOscDetuneParam = oscEntry && oscEntry.osc && oscEntry.osc.detune;
        if (hasOscDetuneParam) {
          return oscEntry.osc.detune;
        }
      }
    } else if (destId === 'filterCutoff') {
      var hasFilterChainForCutoff = voice.filterChain && voice.filterChain.filters && voice.filterChain.filters.length > 0;
      if (hasFilterChainForCutoff) {
        var filter = voice.filterChain.filters[0];
        if (filter && filter.frequency) {
          return filter.frequency;
        }
      }
    } else if (destId === 'filterResonance') {
      var hasFilterChainForRes = voice.filterChain && voice.filterChain.filters && voice.filterChain.filters.length > 0;
      if (hasFilterChainForRes) {
        var filter2 = voice.filterChain.filters[0];
        if (filter2 && filter2.Q) {
          return filter2.Q;
        }
      }
    } else if (destId === 'amplitude') {
      if (voice.masterGain && voice.masterGain.gain) {
        return voice.masterGain.gain;
      }
    } else if (destId === 'pan') {
      // Pan requires the LFO chain's pan node
      // Access via instrument state
      var instruments = SL.audio.getInstruments();
      if (instruments && instruments[instId]) {
        var inst = instruments[instId];
        // Check for the pan node created by mod matrix or LFO engine
        if (inst._modMatrixPanNode) {
          return inst._modMatrixPanNode.pan;
        }
      }
    } else if (destId === 'lfo1Rate' || destId === 'lfo2Rate') {
      // Connect to the mod matrix's mirrored LFO oscillator frequency
      var state = matrixNodes[instId];
      if (state && state.lfoSources) {
        var lfoKey = destId === 'lfo1Rate' ? 'lfo1' : 'lfo2';
        if (state.lfoSources[lfoKey] && state.lfoSources[lfoKey].source) {
          var src = state.lfoSources[lfoKey].source;
          if (src.frequency) {
            return src.frequency;
          }
        }
      }
    }

    return null;
  }

  /**
   * Apply a scalar offset to a voice destination parameter.
   * @param {Object} voice
   * @param {string} destId
   * @param {number} offset
   * @param {number} instId
   */
  function applyScalarOffset(voice, destId, offset, instId) {
    var ctx = SL.audio.getCtx();
    if (ctx) {
    var now = ctx.currentTime;

    if (destId === 'pitch') {
      // Apply cents offset to all oscillators
      if (voice.oscillators) {
        for (var i = 0; i < voice.oscillators.length; i++) {
          var oscEntry = voice.oscillators[i];
          var hasDetuneForOffset = oscEntry && oscEntry.osc && oscEntry.osc.detune;
          if (hasDetuneForOffset) {
            var currentDetune = oscEntry.osc.detune.value;
            oscEntry.osc.detune.setValueAtTime(currentDetune + offset, now);
          }
        }
      }
    } else if (destId === 'filterCutoff') {
      if (voice.filterChain && voice.filterChain.filters) {
        for (var fi = 0; fi < voice.filterChain.filters.length; fi++) {
          var f = voice.filterChain.filters[fi];
          if (f && f.frequency) {
            var currentFreq = f.frequency.value;
            f.frequency.setValueAtTime(Math.max(20, currentFreq + offset), now);
          }
        }
      }
    } else if (destId === 'filterResonance') {
      if (voice.filterChain && voice.filterChain.filters) {
        for (var qi = 0; qi < voice.filterChain.filters.length; qi++) {
          var q = voice.filterChain.filters[qi];
          if (q && q.Q) {
            var currentQ = q.Q.value;
            q.Q.setValueAtTime(Math.max(0.1, currentQ + offset), now);
          }
        }
      }
    } else if (destId === 'amplitude') {
      if (voice.masterGain && voice.masterGain.gain) {
        var currentGain = voice.masterGain.gain.value;
        voice.masterGain.gain.setValueAtTime(Math.max(0, currentGain + offset), now);
      }
    }
    // pan, fmDepth, lfo rates: scalar offsets are less common, skip for now
    } // end if (ctx)
  }

  /**
   * Remove mod matrix connections from a voice.
   * @param {number} instId
   * @param {Object} voice
   */
  function removeModMatrixFromVoice(instId, voice) {
    if (voice && voice._modMatrixConnections) {

    for (var i = 0; i < voice._modMatrixConnections.length; i++) {
      var conn = voice._modMatrixConnections[i];
      try {
        if (conn.routeGain) {
          conn.routeGain.disconnect();
        }
      } catch (e) { /* node already disconnected */ }
      try {
        if (conn.sourceNode && conn.routeGain) {
          conn.sourceNode.disconnect(conn.routeGain);
        }
      } catch (e) { /* node already disconnected */ }
    }

    voice._modMatrixConnections = [];
    } // end if (voice && voice._modMatrixConnections)
  }

  // ============================================================
  // Init / Destroy
  // ============================================================

  /**
   * Initialize mod matrix for an instrument.
   * Creates the node state container.
   * @param {number} instId
   */
  function initModMatrix(instId) {
    if (instId >= 0 && instId < NUM_INSTRUMENTS) {

    ensureModMatrixSettings(instId);

    // Clean up existing
    if (matrixNodes[instId]) {
      destroyModMatrix(instId);
    }

    matrixNodes[instId] = {
      lfoSources: {},
      envSource: null
    };
    } // end if (instId >= 0 && instId < NUM_INSTRUMENTS)
  }

  /**
   * Destroy mod matrix nodes for an instrument.
   * @param {number} instId
   */
  function destroyModMatrix(instId) {
    if (instId >= 0 && instId < NUM_INSTRUMENTS) {

    var state = matrixNodes[instId];
    if (state) {

    // Tear down LFO sources
    if (state.lfoSources) {
      var keys = Object.keys(state.lfoSources);
      for (var k = 0; k < keys.length; k++) {
        var entry = state.lfoSources[keys[k]];
        if (entry) {
          try {
            if (entry.depthGain) { entry.depthGain.disconnect(); }
          } catch (e) { /* node already disconnected */ }
          try {
            if (entry.source) {
              entry.source.disconnect();
              if (entry.source.stop) { entry.source.stop(); }
            }
          } catch (e) { /* node already disconnected or stopped */ }
        }
      }
    }

    // Tear down envelope source
    if (state.envSource) {
      try {
        state.envSource.disconnect();
        if (state.envSource.stop) { state.envSource.stop(); }
      } catch (e) { /* node already disconnected or stopped */ }
    }

    matrixNodes[instId] = null;
    } // end if (state)
    } // end if (instId >= 0 && instId < NUM_INSTRUMENTS)
  }

  /**
   * Rebuild mod matrix LFO sources after LFO settings change.
   * @param {number} instId
   */
  function rebuildModMatrixSources(instId) {
    var state = matrixNodes[instId];
    if (state) {

    // Tear down existing LFO sources and let them be lazily recreated
    if (state.lfoSources) {
      var keys = Object.keys(state.lfoSources);
      for (var k = 0; k < keys.length; k++) {
        var entry = state.lfoSources[keys[k]];
        if (entry) {
          try {
            if (entry.depthGain) { entry.depthGain.disconnect(); }
          } catch (e) { /* node already disconnected */ }
          try {
            if (entry.source) {
              entry.source.disconnect();
              if (entry.source.stop) { entry.source.stop(); }
            }
          } catch (e) { /* node already disconnected or stopped */ }
        }
      }
      state.lfoSources = {};
    }
    } // end if (state)
  }

  // ============================================================
  // Controller Input
  // ============================================================

  /**
   * Update a MIDI controller value for mod matrix routing.
   * @param {number} instId
   * @param {string} controller - 'modWheel', 'aftertouch', or 'velocity'
   * @param {number} value - 0..127
   */
  function setControllerValue(instId, controller, value) {
    if (instId >= 0 && instId < NUM_INSTRUMENTS) {
      if (controllerState[instId]) {
        controllerState[instId][controller] = value;
      }
    }
  }

  /**
   * Update a single mod matrix slot.
   * @param {number} instId
   * @param {number} slotIndex - 0..7
   * @param {string} param - 'enabled', 'source', 'destination', 'amount'
   * @param {*} value
   */
  function updateModMatrixSlot(instId, slotIndex, param, value) {
    var isValidModInstId = instId >= 0 && instId < NUM_INSTRUMENTS;
    var isValidSlotIndex = slotIndex >= 0 && slotIndex < NUM_SLOTS;
    if (isValidModInstId && isValidSlotIndex) {

    ensureModMatrixSettings(instId);
    var instruments = SL.audio.getInstruments();
    if (instruments && instruments[instId]) {

    var slots = instruments[instId].settings.modMatrix;
    slots[slotIndex][param] = value;

    // If source changed, rebuild the LFO sources
    if (param === 'source') {
      rebuildModMatrixSources(instId);
    }
    } // end if (instruments && instruments[instId])
    } // end if (instId && slotIndex range check)
  }

  // ============================================================
  // Public API
  // ============================================================

  SL.audio.modMatrix = {
    getSources: function() { return MOD_SOURCES; },
    getDestinations: function() { return MOD_DESTINATIONS; },
    getSettings: getModMatrixSettings,
    updateSlot: updateModMatrixSlot,
    setControllerValue: setControllerValue,
    applyToVoice: applyModMatrixToVoice,
    removeFromVoice: removeModMatrixFromVoice,
    init: initModMatrix,
    destroy: destroyModMatrix,
    rebuild: rebuildModMatrixSources,
    NUM_SLOTS: NUM_SLOTS,
    DEFAULT_SLOT: DEFAULT_SLOT
  };

  // Also register top-level convenience accessors on SL.audio
  SL.audio.initModMatrix = initModMatrix;
  SL.audio.destroyModMatrix = destroyModMatrix;
  SL.audio.applyModMatrixToVoice = applyModMatrixToVoice;
  SL.audio.removeModMatrixFromVoice = removeModMatrixFromVoice;

  } // end if (SL && SL.audio)

})();
