// Super Synth Lab - LFO Engine Module
// Adds 2 LFOs per instrument (LFO1 and LFO2)
// Loads AFTER audio-engine.js and extends SL.audio
// Targets: pitch (vibrato), filter (wah), amplitude (tremolo), pan
//
// --- How It Works ---
// An LFO (Low Frequency Oscillator) produces a sub-audio oscillation,
// typically 0.01-20 Hz, used to cyclically modulate another parameter.
// The concept originates from analog voltage-controlled synthesizers where
// a dedicated slow oscillator would output a control voltage routed to
// pitch (vibrato), amplitude (tremolo), or filter cutoff (auto-wah).
//
// This module provides 2 independent LFOs per instrument, each with:
//   - Rate: oscillation speed in Hz (how fast the modulation cycles)
//   - Depth: modulation intensity (how far the target parameter moves)
//   - Waveform: shape of the modulation curve (sine, triangle, square,
//     sawtooth, or sample-and-hold for random stepped modulation)
//   - Target: which parameter to modulate (pitch, filter, amplitude, pan)
//
// Modulation routing:
//   Pitch target   -> connected to each voice oscillator's detune AudioParam
//   Filter target  -> connected to each voice filter's frequency AudioParam
//   Amplitude      -> routed through a shared tremolo GainNode in the signal chain
//   Pan            -> routed through a shared StereoPanner in the signal chain
//
// Pitch and filter are per-voice (polyphonic modulation -- each note gets
// its own LFO connection). Amplitude and pan are per-instrument (monophonic
// -- all notes share the same tremolo/pan node, which is more musically
// natural for these targets).
//
// An active-voice gate suspends LFO oscillators when no notes are sounding,
// avoiding unnecessary CPU usage from idle modulation.
//
// References:
//   Moog, R.A. (1965) "Voltage-Controlled Electronic Music Modules", JAES 13(3)
//   Roads, C. (1996) The Computer Music Tutorial, MIT Press
//   Puckette, M. (2007) Theory and Technique of Electronic Music
//   SSLI Feature List [ENG-011]
//
(function() {
  'use strict';

  var SL = window.SynthLab;

  if (!SL || !SL.audio) {
    console.error('[lfo-engine] SynthLab.audio not available');
  } else {

  // ============================================================
  // Constants
  // ============================================================

  var NUM_INSTRUMENTS = 5;
  var NUM_LFOS = 2;

  var NO_TARGET = 'none';

  // LFO parameters that require a full node rebuild when changed.
  // Rate and depth can be updated live on existing Web Audio nodes, but
  // changing target/waveform/enabled requires tearing down and reconnecting
  // the entire LFO signal graph because different targets route to different
  // AudioParam destinations.
  var LFO_REBUILD_PARAMS = { 'target': 1, 'enabled': 1, 'waveform': 1 };

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
    if (instruments && instruments[instId]) {
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

  // Standard waveforms (sine, triangle, square, saw) use the Web Audio
  // OscillatorNode, which is the same phase-accumulator mechanism used for
  // audio-rate oscillators but running at sub-audio frequencies.
  //
  // Sample-and-Hold (S&H) is different: it latches a new random value at
  // each LFO cycle, holding it constant until the next trigger. This
  // produces the classic "stepping" modulation heard in sci-fi sound
  // effects and early Moog patches. S&H requires a ScriptProcessor because
  // OscillatorNode has no random/stepped waveform type.

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
      // Hold duration in samples = sampleRate / rate. At 2 Hz and 44100 SR,
      // each random value is held for 22050 samples (~0.5 seconds).
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

  // Amplitude (tremolo) and pan modulation are fundamentally different from
  // pitch/filter modulation. Pitch and filter connect the LFO to per-voice
  // AudioParams (each note gets its own connection). But tremolo and pan
  // affect the combined signal of all voices, so they require inserting
  // shared GainNode (tremolo) and StereoPanner (pan) into the instrument's
  // signal chain between the volume node and the effect chain input.
  //
  // Tremolo: the LFO modulates the gain param of a GainNode (default 1.0).
  //   A sine LFO at 5 Hz with depth 0.5 makes gain oscillate 0.5-1.5,
  //   producing the characteristic amplitude wobble.
  // Pan: the LFO modulates the pan param of a StereoPanner (-1 to +1),
  //   sweeping the signal left and right in the stereo field.

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
    if (instruments && instruments[instId]) {
      var inst = instruments[instId];
      var state = lfoNodes[instId];
      if (state && !state.chainInserted) {
        if (inst.volumeNode && inst.effectChain) {
          var ctx = SL.audio.getCtx();
          if (ctx) {
            // Create shared tremolo gain (pass-through by default: gain = 1)
            state.tremoloGain = ctx.createGain();
            state.tremoloGain.gain.value = 1.0;

            // Create shared pan node (pass-through by default: pan = 0)
            state.panNode = ctx.createStereoPanner();
            state.panNode.pan.value = 0;

            // Disconnect volumeNode from effectChain and re-route
            try {
              inst.volumeNode.disconnect(inst.effectChain.input);
            } catch (e) { /* node may not be connected yet */ }

            inst.volumeNode.connect(state.tremoloGain);
            state.tremoloGain.connect(state.panNode);
            state.panNode.connect(inst.effectChain.input);

            state.chainInserted = true;
          }
        }
      }
    }
  }

  /**
   * Remove tremolo and pan nodes from the signal chain, restoring direct routing.
   * @param {number} instId - Instrument index
   */
  function removeChainNodes(instId) {
    var instruments = SL.audio.getInstruments();
    if (instruments && instruments[instId]) {
      var inst = instruments[instId];
      var state = lfoNodes[instId];
      if (state && state.chainInserted) {
        try {
          inst.volumeNode.disconnect(state.tremoloGain);
          state.tremoloGain.disconnect(state.panNode);
          state.panNode.disconnect(inst.effectChain.input);
        } catch (e) { /* nodes may already be disconnected */ }

        // Restore direct connection
        if (inst.volumeNode && inst.effectChain) {
          inst.volumeNode.connect(inst.effectChain.input);
        }

        state.tremoloGain = null;
        state.panNode = null;
        state.chainInserted = false;
      }
    }
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
    if (ctx) {
      var settings = getLFOSettingsForNum(instId, lfoNum);
      var state = lfoNodes[instId];
      var key = 'lfo' + lfoNum;

      // Tear down existing nodes for this LFO
      teardownLFONodes(instId, lfoNum);

      // If enabled and target is not none, build nodes
      if (settings.enabled && settings.target !== NO_TARGET) {
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
          // Vibrato: depth in cents (100 cents = 1 semitone).
          // Typical vibrato is 5-7 Hz rate with 10-50 cents depth.
          // Classical vibrato is narrower (~10-20 cents); rock/pop wider.
          lfo.depthGain.gain.value = settings.depth * 1.0;
        } else if (settings.target === 'filter') {
          // Filter sweep (auto-wah): LFO modulates filter cutoff frequency.
          // Depth scaled to max 2000 Hz swing. A slow triangle LFO here
          // produces the classic filter sweep heard in disco and funk.
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

        // ScriptProcessor nodes are garbage-collected if they have no output
        // connection. Connect to a zero-gain node routed to destination to keep
        // the S&H processor alive without producing audible output.
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
    }
  }

  /**
   * Tear down audio nodes for one LFO
   * @param {number} instId - Instrument index
   * @param {number} lfoNum - 1 or 2
   */
  function teardownLFONodes(instId, lfoNum) {
    var state = lfoNodes[instId];
    if (state) {
      var key = 'lfo' + lfoNum;
      var lfo = state[key];
      if (lfo) {
        // Disconnect everything
        try {
          if (lfo.depthGain) {
            lfo.depthGain.disconnect();
          }
        } catch (e) { /* node already disconnected or stopped */ }

        try {
          if (lfo.source) {
            lfo.source.disconnect();
            // Stop oscillator if it's an OscillatorNode
            if (!lfo.isSH && lfo.source.stop) {
              lfo.source.stop();
            }
          }
        } catch (e) { /* node already disconnected or stopped */ }

        try {
          if (lfo.silentGain) {
            lfo.silentGain.disconnect();
          }
        } catch (e) { /* node already disconnected or stopped */ }

        state[key] = null;

        // If neither LFO targets amplitude or pan, remove chain nodes
        checkAndRemoveChainNodes(instId);
      }
    }
  }

  /**
   * Check if any LFO still needs the chain nodes; if not, remove them.
   * @param {number} instId - Instrument index
   */
  function checkAndRemoveChainNodes(instId) {
    var state = lfoNodes[instId];
    if (state && state.chainInserted) {
      var isChainNeeded = false;
      var lfo1 = state.lfo1;
      var lfo2 = state.lfo2;

      var isLfo1AmpOrPan = lfo1 && (lfo1.target === 'amplitude' || lfo1.target === 'pan');
      if (isLfo1AmpOrPan) {
        isChainNeeded = true;
      }
      var isLfo2AmpOrPan = lfo2 && (lfo2.target === 'amplitude' || lfo2.target === 'pan');
      if (isLfo2AmpOrPan) {
        isChainNeeded = true;
      }

      if (!isChainNeeded) {
        removeChainNodes(instId);
      }
    }
  }

  // ============================================================
  // Per-Voice LFO Application (Pitch & Filter)
  // ============================================================

  // Pitch and filter modulation are per-voice: the LFO's depth gain node is
  // connected to each individual voice's oscillator detune or filter frequency
  // AudioParam. This means the LFO phase is shared (monophonic modulation --
  // all voices move together), but the connection is per-voice so notes that
  // start/stop independently get properly connected/disconnected.
  //
  // Web Audio's AudioParam fan-in allows multiple sources to connect to the
  // same param -- their values are summed. So both LFO1 and LFO2 can target
  // pitch simultaneously, and their modulations will add together.

  /**
   * Connect LFO modulation to a voice's oscillators (pitch) or filter (filter).
   * Called when a sustained note starts.
   * @param {number} instId - Instrument index
   * @param {Object} voice - Voice object from the voice pool
   */
  function _connectLFOToPitch(lfo, voice, key) {
      for (var i = 0; i < voice.oscillators.length; i++) {
        var oscEntry = voice.oscillators[i];
        var hasOscDetune = oscEntry && oscEntry.osc && oscEntry.osc.detune;
        if (hasOscDetune) {
          try {
            lfo.depthGain.connect(oscEntry.osc.detune);
            voice._lfoConnections.push({
              source: lfo.depthGain,
              dest: oscEntry.osc.detune,
              lfoKey: key
            });
          } catch (e) { /* oscillator may have been stopped or disposed */ }
        }
      }
  }

  function _connectLFOToFilter(lfo, voice, key) {
      var hasFilters = voice.filterChain && voice.filterChain.filters && (voice.filterChain.filters.length > 0);
      if (hasFilters) {
        var filter = voice.filterChain.filters[0];
        if (filter && filter.frequency) {
          try {
            lfo.depthGain.connect(filter.frequency);
            voice._lfoConnections.push({
              source: lfo.depthGain,
              dest: filter.frequency,
              lfoKey: key
            });
          } catch (e) { /* filter node may have been disposed */ }
        }
      }
  }

  function applyLFOToVoice(instId, voice) {
    if (voice) {
      var state = lfoNodes[instId];
      if (state) {
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

          var isPitchTarget = (lfo.target === 'pitch') && voice.oscillators;
          var isFilterTarget = (lfo.target === 'filter') && voice.filterChain;
          if (isPitchTarget) {
            _connectLFOToPitch(lfo, voice, key);
          } else if (isFilterTarget) {
            _connectLFOToFilter(lfo, voice, key);
          }
          // amplitude and pan targets are handled via chain nodes, not per-voice
        }
      }
    }
  }

  /**
   * Disconnect LFO modulation from a voice.
   * Called when a sustained note stops.
   * @param {number} instId - Instrument index
   * @param {Object} voice - Voice object from the voice pool
   */
  function removeLFOFromVoice(instId, voice) {
    if (voice && voice._lfoConnections) {
      for (var i = 0; i < voice._lfoConnections.length; i++) {
        var conn = voice._lfoConnections[i];
        try {
          conn.source.disconnect(conn.dest);
        } catch (e) { /* node already disconnected or disposed */ }
      }

      voice._lfoConnections = [];
    }
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
    if (instId >= 0 && instId < NUM_INSTRUMENTS) {
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
  }

  /**
   * Update a single parameter of an LFO.
   * @param {number} instId - Instrument index
   * @param {number} lfoNum - 1 or 2
   * @param {string} param - 'rate', 'depth', 'waveform', 'target', or 'enabled'
   * @param {*} value - New value
   */
  // Depth scaling constants: filter modulation swings up to 2000 Hz,
  // amplitude and pan are normalized 0-1 from percentage input.
  var FILTER_DEPTH_SCALE = 2000;
  var PERCENT_SCALE = 100;

  function _updateLFORate(lfo, instId, lfoNum, value) {
    if (lfo.isSH) {
      // For S&H, rebuild since ScriptProcessor doesn't support live rate changes easily
      buildLFONodes(instId, lfoNum);
      reapplyLFOToActiveVoices(instId);
    } else {
      // Standard oscillator: just update frequency
      var hasFreq = lfo.source && lfo.source.frequency;
      if (hasFreq) {
        lfo.source.frequency.value = value;
      }
    }
    lfo.rate = value;
  }

  function _updateLFODepth(lfo, value) {
    lfo.depth = value;
    if (lfo.depthGain) {
      var isPitch = (lfo.target === 'pitch');
      var isFilter = (lfo.target === 'filter');
      var isAmplitude = (lfo.target === 'amplitude');
      var isPan = (lfo.target === 'pan');
      if (isPitch) {
        lfo.depthGain.gain.value = value * 1.0;
      } else if (isFilter) {
        lfo.depthGain.gain.value = (value / PERCENT_SCALE) * FILTER_DEPTH_SCALE;
      } else if (isAmplitude) {
        lfo.depthGain.gain.value = value / PERCENT_SCALE;
      } else if (isPan) {
        lfo.depthGain.gain.value = value / PERCENT_SCALE;
      }
    }
  }

  function _updateLFOLiveParam(lfo, instId, lfoNum, param, value) {
    if (lfo) {
      var isRate = (param === 'rate');
      var isDepth = (param === 'depth');
      if (isRate) {
        _updateLFORate(lfo, instId, lfoNum, value);
      } else if (isDepth) {
        _updateLFODepth(lfo, value);
      }
    }
  }

  function updateLFO(instId, lfoNum, param, value) {
    var isValidInst = (instId >= 0) && (instId < NUM_INSTRUMENTS);
    var isValidLfo = (lfoNum === 1) || (lfoNum === 2);
    if (isValidInst && isValidLfo) {
      ensureLFOSettings(instId);
      var settings = getLFOSettingsForNum(instId, lfoNum);
      settings[param] = value;

      // If LFO nodes haven't been initialized yet, init them
      if (!lfoNodes[instId]) {
        initLFOForInstrument(instId);
      } else {
        var state = lfoNodes[instId];
        var key = 'lfo' + lfoNum;
        var lfo = state[key];

        // For target, enabled, or waveform changes, rebuild the LFO nodes entirely
        if (LFO_REBUILD_PARAMS[param]) {
          buildLFONodes(instId, lfoNum);
          reapplyLFOToActiveVoices(instId);
        } else {
          _updateLFOLiveParam(lfo, instId, lfoNum, param, value);
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
    if (instruments && instruments[instId]) {
      var activeOscs = instruments[instId].activeOscillators;
      if (activeOscs && activeOscs.size > 0) {
        activeOscs.forEach(function(node) {
          if (node && node.voice) {
            // Remove old connections first
            removeLFOFromVoice(instId, node.voice);
            // Re-apply
            applyLFOToVoice(instId, node.voice);
          }
        });
      }
    }
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
    if (instId >= 0 && instId < NUM_INSTRUMENTS) {
      if (lfoNum === 1 || lfoNum === 2) {
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
    }
  }

  /**
   * Destroy all LFO nodes for an instrument (cleanup).
   * @param {number} instId - Instrument index
   */
  function destroyLFO(instId) {
    if (instId >= 0 && instId < NUM_INSTRUMENTS) {
      var state = lfoNodes[instId];
      if (state) {
        // Tear down both LFOs
        teardownLFONodes(instId, 1);
        teardownLFONodes(instId, 2);

        // Remove chain nodes if still inserted
        if (state.chainInserted) {
          removeChainNodes(instId);
        }

        lfoNodes[instId] = null;
      }
    }
  }

  // ============================================================
  // Active-Voice Gate: disconnect LFO oscillators when idle
  // ============================================================

  // Optimization: LFO oscillators consume CPU even when no notes are playing.
  // The active-voice gate tracks the number of sounding voices per instrument.
  // When the count drops to zero, the LFO source is disconnected from its
  // depth gain (suspended) -- the oscillator keeps running to maintain phase
  // continuity, but produces no audible modulation. When a new note starts,
  // the connection is restored (resumed). This is cheaper than stop/start
  // because OscillatorNode.start() can only be called once per node.

  /** Per-instrument count of active voices connected to LFO */
  var activeVoiceCounts = [0, 0, 0, 0, 0];

  /**
   * Disconnect LFO source from its depthGain so the oscillator
   * runs but produces no audible modulation. Cheaper than stop/start.
   */
  function suspendLFONodes(instId) {
    var state = lfoNodes[instId];
    if (state) {
      for (var n = 1; n <= NUM_LFOS; n++) {
        var lfo = state['lfo' + n];
        var isActiveLfo = lfo && lfo.source && lfo.depthGain;
        var canSuspendLfo = isActiveLfo && !lfo._suspended;
        if (canSuspendLfo) {
          try { lfo.source.disconnect(lfo.depthGain); } catch (e) { /* node already disconnected or stopped */ }
          lfo._suspended = true;
        }
      }
    }
  }

  /**
   * Reconnect LFO source to depthGain after suspension.
   */
  function resumeLFONodes(instId) {
    var state = lfoNodes[instId];
    if (state) {
      for (var n = 1; n <= NUM_LFOS; n++) {
        var lfo = state['lfo' + n];
        var isSuspendedLfo = lfo && lfo.source && lfo.depthGain && lfo._suspended;
        if (isSuspendedLfo) {
          try { lfo.source.connect(lfo.depthGain); } catch (e) { /* node already disconnected or stopped */ }
          lfo._suspended = false;
        }
      }
    }
  }

  /**
   * Called on noteOn — track active voice and resume LFOs if needed.
   */
  function onVoiceStart(instId) {
    if (instId >= 0 && instId < NUM_INSTRUMENTS) {
      var wasZero = (activeVoiceCounts[instId] === 0);
      activeVoiceCounts[instId]++;
      if (wasZero) {
        resumeLFONodes(instId);
      }
    }
  }

  /**
   * Called on noteOff — track active voice and suspend LFOs when idle.
   */
  function onVoiceEnd(instId) {
    if (instId >= 0 && instId < NUM_INSTRUMENTS) {
      activeVoiceCounts[instId] = Math.max(0, activeVoiceCounts[instId] - 1);
      if (activeVoiceCounts[instId] === 0) {
        suspendLFONodes(instId);
      }
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

  } // end if (SL && SL.audio)

})();
