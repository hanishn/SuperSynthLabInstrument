// Super Synth Lab - Audio Engine Module (Orchestrator)
// High-performance browser synthesizer
// v6.1.0 - Modular architecture: core state + split modules
// v6.0.0 - Subtractive/FM/Sampler instrument types, 6-op FM synthesis, preset system
// v5.0.0 - Per-instrument effect chains (replace abstract bus system), lazy factory pattern
// v4.2.1 - Effects added to chain on-demand when enabled, removed when disabled
// v4.2.0 - Forced 44.1kHz internal processing, empty effect chain (pass-through routing)
// v3.1 - High sample rate compatibility (192kHz+), deferred AudioContext creation
// v3.0 - Sampler instrument type with sample playback
// v2.1 - Oscilloscope/spectrum analyzer, click-free note attacks (3ms minimum)
// v2.0 - Multiple effect algorithm choices per effect type
// v1.5 - AudioWorklet support for glitch-free synthesis
// v1.4 - Performance optimizations (voice pool, wavetable, polyBLEP, buffer pool, envelope cache)
//
// Split modules (loaded after this file, extend SL.audio):
//   voice-pool.js    - Voice pool + buffer pool systems
//   wavetable.js     - Wavetable synthesis + sine lookup table
//   envelope.js      - Envelope cache + ADSR calculation + filter envelope
//   filters.js       - Filter creation, models, PolyBLEP, pulse wave
//   note-playback.js - Note playback, sustained notes, visual feedback, continuous noise
//   instrument-settings.js - Save/load instrument settings, playNoteOnInstrument

(function() {
  'use strict';

  var SL = window.SynthLab;

  // Sentinel constants
  var NO_NODE = null;
  var NOT_FOUND = -1;
  var MASTER_TARGET = -1;

  // ============================================================
  // Multi-Instrument Constants
  // ============================================================

  /** Number of independent instruments (0-3 = synth, 4 = loop) */
  var NUM_INSTRUMENTS = 5;

  /** Currently active instrument index (0-4) */
  var currentInstrument = 0;

  /** Default settings for a new instrument */
  var DEFAULT_INSTRUMENT_SETTINGS = {
    osc: [
      { wave: 'sine', oct: 0, detune: 0, level: 80, pulseWidth: 50, superSawSpread: 50 },
      { wave: 'sine', oct: 0, detune: 7, level: 60, pulseWidth: 50, superSawSpread: 50 },
      { wave: 'sine', oct: -1, detune: -5, level: 40, pulseWidth: 50, superSawSpread: 50 }
    ],
    adsr: { a: 10, d: 200, s: 70, r: 200 },
    filter: { enabled: false, type: 'lowpass', freq: 4000, q: 1, keyTrack: 0, model: 'butterworth', slope: 24 },
    noise: { type: 'white', level: 0 },
    filterEnv: { enabled: false, amount: 24, a: 200, d: 600, s: 0, r: 775, link: false },
    lfo: {
      lfo1: { enabled: false, rate: 2.0, depth: 50, waveform: 'sine', target: 'none' },
      lfo2: { enabled: false, rate: 0.5, depth: 30, waveform: 'triangle', target: 'none' }
    },
    modMatrix: [
      { enabled: false, source: 'none', destination: 'none', amount: 0 },
      { enabled: false, source: 'none', destination: 'none', amount: 0 },
      { enabled: false, source: 'none', destination: 'none', amount: 0 },
      { enabled: false, source: 'none', destination: 'none', amount: 0 },
      { enabled: false, source: 'none', destination: 'none', amount: 0 },
      { enabled: false, source: 'none', destination: 'none', amount: 0 },
      { enabled: false, source: 'none', destination: 'none', amount: 0 },
      { enabled: false, source: 'none', destination: 'none', amount: 0 }
    ],
    effects: {
      chainOrder: [],
      masterMix: 100,
      enabled: {},
      params: {}
    },
    fmSettings: {
      algorithm: 1,
      feedback: 0,
      operators: Array.from({length: 6}, function(_, i) {
        return {
          ratioCoarse: 1, ratioFine: 0,
          level: i === 0 ? 99 : 0,
          detune: 7, velocitySens: 0, rateScaling: 0,
          envelope: { R1: 95, R2: 50, R3: 50, R4: 50, L1: 99, L2: 99, L3: 99, L4: 0 }
        };
      })
    },
    physicalSettings: {
      model: 'pluck',
      damping: 50,
      brightness: 60,
      excitation: 'noise',
      bodySize: 50,
      decayTime: 70,
      bowPressure: 50,
      bowPosition: 50,
      breathPressure: 50,
      embouchure: 50,
      strikePosition: 50,
      hardness: 50,
      material: 'metal'
    },
    granularSettings: {
      sourceWaveform: 'sine',
      grainSize: 50,
      density: 20,
      pitchScatter: 0,
      positionScatter: 0,
      windowShape: 'hann',
      freeze: false,
      position: 50
    },
    vocoderSynthSettings: {
      carrierWaveform: 'saw',
      vowel: 'A',
      morphPosition: 0,
      bandCount: 16,
      formantShift: 0,
      filterQ: 8
    },
    wavefoldSettings: {
      source: 'sine',
      foldAmount: 4,
      symmetry: 50,
      bias: 0,
      preGain: 1.0
    },
    formantSettings: {
      vowel: 'A',
      vowelTarget: 'E',
      morphX: 0,
      formantShift: 0,
      breathiness: 15,
      glottalPulseWidth: 50,
      vowelSequenceEnabled: false,
      vowelSequenceRate: 2.0
    },
    modalSettings: {
      material: 'bell',
      excitation: 'mallet',
      malletHardness: 60,
      damping: 30,
      brightness: 65,
      bodySize: 50,
      inharmonicity: 50
    },
    ringmodSettings: {
      carrierWave: 'sine',
      modWave: 'sine',
      modRatioMode: 'ratio',
      modRatio: 2.0,
      modFixedHz: 440,
      modDepth: 80
    },
    chordSettings: {
      chordType: 'major',
      voicing: 'close',
      strum: 0,
      sourceWave: 'saw'
    },
    superwaveSettings: {
      sourceWave: 'saw',
      voiceCount: 7,
      detuneSpread: 30,
      stereoSpread: 50,
      mixMode: 'equal'
    },
    wavetableSettings: {
      bank: 'basic',
      scanPosition: 0,
      lfoSpeed: 0.5,
      lfoDepth: 0,
      detune: 0
    },
    phasedistSettings: {
      pdType: 'saw',
      pdAmount: 50,
      windowShape: 'cosine',
      resonantFreqRatio: 1.0,
      envAttack: 10,
      envDecay: 200,
      envSustain: 70,
      envRelease: 300
    },
    chipSettings: {
      chip: 'sid',
      waveform: 'pulse',
      dutyCycle: 50,
      bitDepth: 12,
      filterType: 'lowpass',
      filterFreq: 2000,
      filterRes: 1.0,
      noiseMode: 'long',
      fmAlgorithm: 0,
      fmFeedback: 0,
      opRatios: [1.0, 2.0, 3.0, 4.0],
      opLevels: [100, 80, 60, 40]
    },
    bytebeatSettings: {
      formula: 't*(t>>5|t>>8)',
      formulaIndex: 0,
      sampleRate: 8000,
      tIncrement: 1,
      bitDepth: 8,
      volume: 80
    },
    vectorSettings: {
      sources: [
        { waveform: 'saw', detune: 0 },
        { waveform: 'square', detune: 0 },
        { waveform: 'triangle', detune: 0 },
        { waveform: 'sine', detune: 0 }
      ],
      vectorX: 50,
      vectorY: 50,
      vectorEnvelope: {
        enabled: false,
        loop: false,
        points: [
          { x: 0, y: 0, time: 0 },
          { x: 100, y: 0, time: 500 },
          { x: 100, y: 100, time: 1000 },
          { x: 0, y: 100, time: 1500 },
          { x: 0, y: 0, time: 2000 }
        ]
      }
    },
    drumsynSettings: {
      drumType: 'kick',
      pitch: 50,
      decay: 50,
      tone: 50,
      bodyNoiseMix: 70,
      drive: 20
    },
    pulsarSettings: {
      pulsaretWaveform: 'sine',
      pulseRate: 100,
      dutyCycle: 50,
      pulsaretEnvelope: 'gaussian',
      formantFreq: 1000,
      masking: 0
    },
    reedSettings: {
      reedType: 'clarinet',
      reedStiffness: 50,
      embouchurePressure: 50,
      register: 'normal',
      vibratoRate: 5.0,
      vibratoDepth: 20,
      breathNoise: 25,
      adsr: { a: 5, d: 80, s: 80, r: 150 }
    },
    bodyResonanceSettings: {
      bodyType: 'none',
      resonanceAmount: 50,
      brightness: 50,
      bodySize: 50
    },
    additiveSettings: {
      partials: (function() {
        var arr = [];
        for (var i = 0; i < 16; i++) {
          arr.push({
            amplitude: (i === 0) ? 1.0 : 0.0,
            ratio: i + 1,
            phase: 0
          });
        }
        return arr;
      })(),
      drawbarMode: false,
      drawbars: [8, 0, 8, 0, 0, 0, 0, 0, 0]
    },
    volume: 80,
    humanization: {
      velocity: 0,
      timing: 0,
      adsr: 0,
      drift: 0
    },
    strum: 0,
    strumDir: 'up',
    strumRepeat: 0,
    glide: 0,
    padAftertouch: { filterMod: 20, volumeMod: 10, vibrato: 5, rate: 0.4 },
    loopSettings: {
      textureName: 'White Noise', volume: 30,
      lfoRate: 0.2, lfoDepth: 30, lfoShape: 'sine',
      filterType: 'lowpass', filterFreq: 20000, filterQ: 1,
      lfo2Rate: 0.1, lfo2Depth: 0, lfo2Shape: 'sine',
      fadeIn: 2, fadeOut: 2
    }
  };

  /** Deep clone helper for settings — manual clone avoids JSON.parse/stringify overhead */
  function cloneSettings(settings) {
    var result = {};
    var keys = Object.keys(settings);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var val = settings[key];
      if (val === NO_NODE || val === undefined) {
        result[key] = val;
      } else if (Array.isArray(val)) {
        result[key] = _cloneArray(val);
      } else if (typeof val === 'object') {
        result[key] = cloneSettings(val);
      } else {
        result[key] = val;
      }
    }
    return result;
  }

  /** Clone an array, recursively cloning objects/arrays within */
  function _cloneArray(arr) {
    var out = new Array(arr.length);
    for (var i = 0; i < arr.length; i++) {
      var item = arr[i];
      if (item === NO_NODE || item === undefined) {
        out[i] = item;
      } else if (Array.isArray(item)) {
        out[i] = _cloneArray(item);
      } else if (typeof item === 'object') {
        out[i] = cloneSettings(item);
      } else {
        out[i] = item;
      }
    }
    return out;
  }

  /** Array of 5 instruments with independent settings (index 3 = sampler, index 4 = loop) */
  var instruments = Array.from({ length: NUM_INSTRUMENTS }, function(_, i) {
    var instName;
    if (i === 3) {
      instName = 'Sampler';
    } else if (i === 4) {
      instName = 'Loop';
    } else {
      instName = 'Instrument ' + (i + 1);
    }
    var instType;
    if (i === 3) {
      instType = 'sampler';
    } else if (i === 4) {
      instType = 'loop';
    } else {
      instType = 'subtractive';
    }
    return {
      id: i,
      name: instName,
      type: instType,
      settings: cloneSettings(DEFAULT_INSTRUMENT_SETTINGS),
      activeOscillators: new Map(),
      playingNotes: new Set(),
      masterOutput: null,
      effectChain: null,
      noiseSource: null,
      noiseGain: null,
      noiseFilter: null,
      volumeNode: null
    };
  });

  /**
   * Get instrument type
   * @param {number} instId - Instrument idx (defaults to current)
   * @returns {string} 'subtractive', 'fm', 'sampler', 'physical', 'midiout', or 'loop'
   */
  function getInstrumentType(instId) {
    if (instId === undefined) instId = currentInstrument;
    return instruments[instId]?.type || 'subtractive';
  }

  // Valid instrument type identifiers (all supported engine types)
  var VALID_INSTRUMENT_TYPES = {
    'subtractive': 1, 'fm': 1, 'sampler': 1, 'physical': 1, 'additive': 1,
    'granular': 1, 'vocoderSynth': 1, 'wavefolder': 1, 'formant': 1, 'modal': 1,
    'wavetable': 1, 'phasedist': 1, 'chip': 1, 'superwave': 1, 'chord': 1,
    'ringmod': 1, 'bytebeat': 1, 'vector': 1, 'drumsyn': 1, 'pulsar': 1,
    'reed': 1, 'midiout': 1, 'loop': 1
  };

  /**
   * Set instrument type
   * @param {number} instId - Instrument idx
   * @param {string} type - 'subtractive', 'fm', 'sampler', 'physical', 'midiout', or 'loop'
   */
  function setInstrumentType(instId, type) {
    if (instruments[instId] && VALID_INSTRUMENT_TYPES[type]) {
      instruments[instId].type = type;
    }
  }

  /**
   * Get FM settings for an instrument
   */
  function getFMSettings(instId) {
    if (instId === undefined) instId = currentInstrument;
    var inst = instruments[instId];
    if (!inst) return null;
    return inst.settings.fmSettings || DEFAULT_INSTRUMENT_SETTINGS.fmSettings;
  }

  /**
   * Set FM settings for an instrument
   */
  function setFMSettings(instId, settings) {
    var inst = instruments[instId];
    if (!inst) return;
    inst.settings.fmSettings = Object.assign({}, inst.settings.fmSettings || {}, settings);
    if (SL.fm && SL.fm.setSettings) {
      SL.fm.setSettings(instId, inst.settings.fmSettings);
    }
  }

  /**
   * Get physical modelling settings for an instrument
   */
  function getPhysicalSettings(instId) {
    if (instId === undefined) instId = currentInstrument;
    var inst = instruments[instId];
    if (!inst) return null;
    return inst.settings.physicalSettings || DEFAULT_INSTRUMENT_SETTINGS.physicalSettings;
  }

  /**
   * Set physical modelling settings for an instrument
   */
  function setPhysicalSettings(instId, settings) {
    var inst = instruments[instId];
    if (!inst) return;
    inst.settings.physicalSettings = Object.assign({}, inst.settings.physicalSettings || {}, settings);
    if (SL.physical && SL.physical.setSettings) {
      SL.physical.setSettings(instId, inst.settings.physicalSettings);
    }
  }

  /**
   * Get granular synthesis settings for an instrument
   */
  function getGranularSettings(instId) {
    if (instId === undefined) instId = currentInstrument;
    var inst = instruments[instId];
    if (!inst) return null;
    return inst.settings.granularSettings || DEFAULT_INSTRUMENT_SETTINGS.granularSettings;
  }

  /**
   * Set granular synthesis settings for an instrument
   */
  function setGranularSettings(instId, settings) {
    var inst = instruments[instId];
    if (!inst) return;
    inst.settings.granularSettings = Object.assign({}, inst.settings.granularSettings || {}, settings);
    if (SL.granular && SL.granular.setSettings) {
      SL.granular.setSettings(instId, inst.settings.granularSettings);
    }
  }

  /**
   * Get vocoder synth settings for an instrument
   */
  function getVocoderSynthSettings(instId) {
    if (instId === undefined) instId = currentInstrument;
    var inst = instruments[instId];
    if (!inst) return null;
    return inst.settings.vocoderSynthSettings || DEFAULT_INSTRUMENT_SETTINGS.vocoderSynthSettings;
  }

  /**
   * Set vocoder synth settings for an instrument
   */
  function setVocoderSynthSettings(instId, settings) {
    var inst = instruments[instId];
    if (!inst) return;
    inst.settings.vocoderSynthSettings = Object.assign({}, inst.settings.vocoderSynthSettings || {}, settings);
    if (SL.vocoderSynth && SL.vocoderSynth.setSettings) {
      SL.vocoderSynth.setSettings(instId, inst.settings.vocoderSynthSettings);
    }
  }

  /**
   * Get wavefolder settings for an instrument
   */
  function getWavefoldSettings(instId) {
    if (instId === undefined) instId = currentInstrument;
    var inst = instruments[instId];
    if (!inst) return null;
    return inst.settings.wavefoldSettings || DEFAULT_INSTRUMENT_SETTINGS.wavefoldSettings;
  }

  /**
   * Set wavefolder settings for an instrument
   */
  function setWavefoldSettings(instId, settings) {
    var inst = instruments[instId];
    if (!inst) return;
    inst.settings.wavefoldSettings = Object.assign({}, inst.settings.wavefoldSettings || {}, settings);
    if (SL.wavefolder && SL.wavefolder.setSettings) {
      SL.wavefolder.setSettings(instId, inst.settings.wavefoldSettings);
    }
  }

  /**
   * Get formant settings for an instrument
   */
  function getFormantSettings(instId) {
    if (instId === undefined) instId = currentInstrument;
    var inst = instruments[instId];
    if (!inst) return null;
    return inst.settings.formantSettings || DEFAULT_INSTRUMENT_SETTINGS.formantSettings;
  }

  /**
   * Set formant settings for an instrument
   */
  function setFormantSettings(instId, settings) {
    var inst = instruments[instId];
    if (!inst) return;
    inst.settings.formantSettings = Object.assign({}, inst.settings.formantSettings || {}, settings);
    if (SL.formant && SL.formant.setSettings) {
      SL.formant.setSettings(instId, inst.settings.formantSettings);
    }
  }

  /**
   * Get modal settings for an instrument
   */
  function getModalSettings(instId) {
    if (instId === undefined) instId = currentInstrument;
    var inst = instruments[instId];
    if (!inst) return null;
    return inst.settings.modalSettings || DEFAULT_INSTRUMENT_SETTINGS.modalSettings;
  }

  /**
   * Set modal settings for an instrument
   */
  function setModalSettings(instId, settings) {
    var inst = instruments[instId];
    if (!inst) return;
    inst.settings.modalSettings = Object.assign({}, inst.settings.modalSettings || {}, settings);
    if (SL.modal && SL.modal.setSettings) {
      SL.modal.setSettings(instId, inst.settings.modalSettings);
    }
  }

  /**
   * Get additive synthesis settings for an instrument
   */
  function getAdditiveSettings(instId) {
    if (instId === undefined) instId = currentInstrument;
    var inst = instruments[instId];
    if (!inst) return null;
    return inst.settings.additiveSettings || DEFAULT_INSTRUMENT_SETTINGS.additiveSettings;
  }

  /**
   * Set additive synthesis settings for an instrument
   */
  function setAdditiveSettings(instId, settings) {
    var inst = instruments[instId];
    if (!inst) return;
    inst.settings.additiveSettings = Object.assign({}, inst.settings.additiveSettings || {}, settings);
    if (SL.additive && SL.additive.setSettings) {
      SL.additive.setSettings(instId, inst.settings.additiveSettings);
    }
  }

  /**
   * Get ring modulation settings for an instrument
   */
  function getRingmodSettings(instId) {
    if (instId === undefined) instId = currentInstrument;
    var inst = instruments[instId];
    if (!inst) return null;
    return inst.settings.ringmodSettings || DEFAULT_INSTRUMENT_SETTINGS.ringmodSettings;
  }

  /**
   * Set ring modulation settings for an instrument
   */
  function setRingmodSettings(instId, settings) {
    var inst = instruments[instId];
    if (!inst) return;
    inst.settings.ringmodSettings = Object.assign({}, inst.settings.ringmodSettings || {}, settings);
    if (SL.ringmod && SL.ringmod.setSettings) {
      SL.ringmod.setSettings(instId, inst.settings.ringmodSettings);
    }
  }

  /**
   * Get chord engine settings for an instrument
   */
  function getChordEngineSettings(instId) {
    if (instId === undefined) instId = currentInstrument;
    var inst = instruments[instId];
    if (!inst) return null;
    return inst.settings.chordSettings || DEFAULT_INSTRUMENT_SETTINGS.chordSettings;
  }

  /**
   * Set chord engine settings for an instrument
   */
  function setChordEngineSettings(instId, settings) {
    var inst = instruments[instId];
    if (!inst) return;
    inst.settings.chordSettings = Object.assign({}, inst.settings.chordSettings || {}, settings);
    if (SL.chord && SL.chord.setSettings) {
      SL.chord.setSettings(instId, inst.settings.chordSettings);
    }
  }

  /**
   * Get superwave settings for an instrument
   */
  function getSuperwaveSettings(instId) {
    if (instId === undefined) instId = currentInstrument;
    var inst = instruments[instId];
    if (!inst) return null;
    return inst.settings.superwaveSettings || DEFAULT_INSTRUMENT_SETTINGS.superwaveSettings;
  }

  /**
   * Set superwave settings for an instrument
   */
  function setSuperwaveSettings(instId, settings) {
    var inst = instruments[instId];
    if (!inst) return;
    inst.settings.superwaveSettings = Object.assign({}, inst.settings.superwaveSettings || {}, settings);
    if (SL.superwave && SL.superwave.setSettings) {
      SL.superwave.setSettings(instId, inst.settings.superwaveSettings);
    }
  }

  /**
   * Get wavetable synth settings for an instrument
   */
  function getWavetableSettings(instId) {
    if (instId === undefined) instId = currentInstrument;
    var inst = instruments[instId];
    if (!inst) return null;
    return inst.settings.wavetableSettings || DEFAULT_INSTRUMENT_SETTINGS.wavetableSettings;
  }

  /**
   * Set wavetable synth settings for an instrument
   */
  function setWavetableSettings(instId, settings) {
    var inst = instruments[instId];
    if (!inst) return;
    inst.settings.wavetableSettings = Object.assign({}, inst.settings.wavetableSettings || {}, settings);
    if (SL.wavetableSynth && SL.wavetableSynth.setSettings) {
      SL.wavetableSynth.setSettings(instId, inst.settings.wavetableSettings);
    }
  }

  /**
   * Get phase distortion settings for an instrument
   */
  function getPhasedistSettings(instId) {
    if (instId === undefined) instId = currentInstrument;
    var inst = instruments[instId];
    if (!inst) return null;
    return inst.settings.phasedistSettings || DEFAULT_INSTRUMENT_SETTINGS.phasedistSettings;
  }

  /**
   * Set phase distortion settings for an instrument
   */
  function setPhasedistSettings(instId, settings) {
    var inst = instruments[instId];
    if (!inst) return;
    inst.settings.phasedistSettings = Object.assign({}, inst.settings.phasedistSettings || {}, settings);
    if (SL.phasedist && SL.phasedist.setSettings) {
      SL.phasedist.setSettings(instId, inst.settings.phasedistSettings);
    }
  }

  /**
   * Get chip synth settings for an instrument
   */
  function getChipSettings(instId) {
    if (instId === undefined) instId = currentInstrument;
    var inst = instruments[instId];
    if (!inst) return null;
    return inst.settings.chipSettings || DEFAULT_INSTRUMENT_SETTINGS.chipSettings;
  }

  /**
   * Set chip synth settings for an instrument
   */
  function setChipSettings(instId, settings) {
    var inst = instruments[instId];
    if (!inst) return;
    inst.settings.chipSettings = Object.assign({}, inst.settings.chipSettings || {}, settings);
    if (SL.chip && SL.chip.setSettings) {
      SL.chip.setSettings(instId, inst.settings.chipSettings);
    }
  }


  /**
   * Get bytebeat settings for an instrument
   */
  function getBytebeatSettings(instId) {
    if (instId === undefined) instId = currentInstrument;
    var inst = instruments[instId];
    if (!inst) return null;
    return inst.settings.bytebeatSettings || DEFAULT_INSTRUMENT_SETTINGS.bytebeatSettings;
  }

  /**
   * Set bytebeat settings for an instrument
   */
  function setBytebeatSettings(instId, settings) {
    var inst = instruments[instId];
    if (!inst) return;
    inst.settings.bytebeatSettings = Object.assign({}, inst.settings.bytebeatSettings || {}, settings);
    if (SL.bytebeat && SL.bytebeat.setSettings) {
      SL.bytebeat.setSettings(inst.settings.bytebeatSettings);
    }
  }

  /**
   * Get vector settings for an instrument
   */
  function getVectorSettings(instId) {
    if (instId === undefined) instId = currentInstrument;
    var inst = instruments[instId];
    if (!inst) return null;
    return inst.settings.vectorSettings || DEFAULT_INSTRUMENT_SETTINGS.vectorSettings;
  }

  /**
   * Set vector settings for an instrument
   */
  function setVectorSettings(instId, settings) {
    var inst = instruments[instId];
    if (!inst) return;
    inst.settings.vectorSettings = Object.assign({}, inst.settings.vectorSettings || {}, settings);
    if (SL.vector && SL.vector.setSettings) {
      SL.vector.setSettings(instId, inst.settings.vectorSettings);
    }
  }

  /**
   * Get drum synth settings for an instrument
   */
  function getDrumsynSettings(instId) {
    if (instId === undefined) instId = currentInstrument;
    var inst = instruments[instId];
    if (!inst) return null;
    return inst.settings.drumsynSettings || DEFAULT_INSTRUMENT_SETTINGS.drumsynSettings;
  }

  /**
   * Set drum synth settings for an instrument
   */
  function setDrumsynSettings(instId, settings) {
    var inst = instruments[instId];
    if (!inst) return;
    inst.settings.drumsynSettings = Object.assign({}, inst.settings.drumsynSettings || {}, settings);
    if (SL.drumsyn && SL.drumsyn.setSettings) {
      SL.drumsyn.setSettings(instId, inst.settings.drumsynSettings);
    }
  }

  /**
   * Get pulsar settings for an instrument
   */
  function getPulsarSettings(instId) {
    if (instId === undefined) instId = currentInstrument;
    var inst = instruments[instId];
    if (!inst) return null;
    return inst.settings.pulsarSettings || DEFAULT_INSTRUMENT_SETTINGS.pulsarSettings;
  }

  /**
   * Set pulsar settings for an instrument
   */
  function setPulsarSettings(instId, settings) {
    var inst = instruments[instId];
    if (!inst) return;
    inst.settings.pulsarSettings = Object.assign({}, inst.settings.pulsarSettings || {}, settings);
    if (SL.pulsar && SL.pulsar.setSettings) {
      SL.pulsar.setSettings(instId, inst.settings.pulsarSettings);
    }
  }



  /**
   * Get reed settings for an instrument
   */
  function getReedSettings(instId) {
    if (instId === undefined) instId = currentInstrument;
    var inst = instruments[instId];
    if (!inst) return null;
    return inst.settings.reedSettings || DEFAULT_INSTRUMENT_SETTINGS.reedSettings;
  }

  /**
   * Set reed settings for an instrument
   */
  function setReedSettings(instId, settings) {
    var inst = instruments[instId];
    if (!inst) return;
    inst.settings.reedSettings = Object.assign({}, inst.settings.reedSettings || {}, settings);
    if (SL.reed && SL.reed.setSettings) {
      SL.reed.setSettings(instId, inst.settings.reedSettings);
    }
  }

  /**
   * Get body resonance settings for an instrument
   */
  function getBodyResonanceSettings(instId) {
    if (instId === undefined) instId = currentInstrument;
    var inst = instruments[instId];
    if (!inst) return null;
    return inst.settings.bodyResonanceSettings || DEFAULT_INSTRUMENT_SETTINGS.bodyResonanceSettings;
  }

  /**
   * Set body resonance settings for an instrument
   */
  function setBodyResonanceSettings(instId, settings) {
    var inst = instruments[instId];
    if (!inst) return;
    inst.settings.bodyResonanceSettings = Object.assign({}, inst.settings.bodyResonanceSettings || {}, settings);
    if (SL.bodyResonance && SL.bodyResonance.setSettings) {
      SL.bodyResonance.setSettings(instId, inst.settings.bodyResonanceSettings);
    }
  }
  // ============================================================
  // State Variables
  // ============================================================

  /** Web Audio context - lazily initialized */
  var audioContext = null;

  /** Effect chain instance (shared by all instruments) - kept for backwards compat */
  var effectChain = null;

  /** Master effect chain */
  var masterChain = null;

  /** Master merge node */
  var masterMerge = null;

  /** Analyser node for visualization */
  var analyserNode = null;

  // ============================================================
  // DOM Element Cache (hot-path optimization)
  // ============================================================

  var domCache = {};

  function initDomCache() {
    domCache.refHz = document.getElementById('refHz');
    domCache.adsrA = document.getElementById('adsrA');
    domCache.adsrD = document.getElementById('adsrD');
    domCache.adsrS = document.getElementById('adsrS');
    domCache.adsrR = document.getElementById('adsrR');
    domCache.filterEnabled = document.getElementById('filterEnabled');
    domCache.filterFreq = document.getElementById('filterFreq');
    domCache.filterQ = document.getElementById('filterQ');
    domCache.filterKeyTrack = document.getElementById('filterKeyTrack');
    domCache.filterModel = document.getElementById('filterModel');
    domCache.noiseEnabled = document.getElementById('noiseEnabled');
    domCache.noiseType = document.getElementById('noiseType');
    domCache.noiseLevel = document.getElementById('noiseLevel');
    domCache.filterEnvEnabled = document.getElementById('filterEnvEnabled');
    domCache.filterEnvAmount = document.getElementById('filterEnvAmount');
    domCache.filterEnvA = document.getElementById('filterEnvA');
    domCache.filterEnvD = document.getElementById('filterEnvD');
    domCache.filterEnvS = document.getElementById('filterEnvS');
    domCache.filterEnvR = document.getElementById('filterEnvR');
    domCache.filterEnvLinkToAmp = document.getElementById('filterEnvLinkToAmp');
    domCache.filterType = document.getElementById('filterType');
    domCache.oscWave = [];
    domCache.oscOct = [];
    domCache.oscDetune = [];
    domCache.oscLevel = [];
    domCache.oscPw = [];
    domCache.oscSpread = [];
    domCache.oscFine = [];
    for (var n = 1; n <= 3; n++) {
      domCache.oscWave[n] = document.querySelector('.osc-wave[data-osc="' + n + '"]');
      domCache.oscOct[n] = document.querySelector('.osc-oct[data-osc="' + n + '"]');
      domCache.oscDetune[n] = document.querySelector('.osc-detune[data-osc="' + n + '"]');
      domCache.oscLevel[n] = document.querySelector('.osc-level[data-osc="' + n + '"]');
      domCache.oscPw[n] = document.querySelector('.osc-pw-lg[data-osc="' + n + '"]');
      domCache.oscSpread[n] = document.querySelector('.osc-spread-lg[data-osc="' + n + '"]');
      domCache.oscFine[n] = document.querySelector('.osc-fine[data-osc="' + n + '"]');
    }
  }

  // ============================================================
  // AudioWorklet Support
  // ============================================================

  var isWorkletSupported = false;
  var isWorkletInitializing = false;
  var synthWorkletNodes = [null, null, null, null, null];
  var workletFilterNodes = [null, null, null, null, null];
  var workletReadyPromise = null;

  // Pre-fetched worklet Blob URLs — created at module load, ready before first gesture
  var _workletBlobUrls = {};

  /**
   * Pre-fetch worklet source files as Blob URLs at module init time.
   * This avoids network latency on first user gesture.
   */
  function _prefetchWorkletBlobs() {
    var workletFiles = ['synth-worklet.js', 'fm-worklet.js', 'formant-worklet.js', 'physical-worklet.js'];
    workletFiles.forEach(function(file) {
      fetch('assets/' + file).then(function(r) { return r.text(); }).then(function(code) {
        var blob = new Blob([code], { type: 'application/javascript' });
        _workletBlobUrls[file] = URL.createObjectURL(blob);
      }).catch(function() { /* non-critical: will fall back to direct path */ });
    });
  }

  // Kick off pre-fetch immediately at module load
  _prefetchWorkletBlobs();

  /** Legacy: kept for backwards compatibility */
  var masterOutput = null;

  // ============================================================
  // Multi-Instrument Access Helpers
  // ============================================================

  function getCurrentInst() {
    return instruments[currentInstrument];
  }

  function getActiveOscillators() {
    return getCurrentInst().activeOscillators;
  }

  function getPlayingNotes() {
    return getCurrentInst().playingNotes;
  }

  // ============================================================
  // Latency Mode
  // ============================================================

  var LATENCY_MODE_INTERACTIVE = 'interactive';
  var LATENCY_MODE_BALANCED = 'balanced';
  var LATENCY_MODE_PLAYBACK = 'playback';
  var LATENCY_MODE_MAX = 'max';

  var _latencyMode = LATENCY_MODE_INTERACTIVE;

  /**
   * Get the stored latency mode
   * @returns {string} 'interactive', 'balanced', or 'playback'
   */
  function getLatencyMode() {
    return _latencyMode;
  }

  /**
   * Set the latency mode (in-memory; takes effect on next audio init)
   * @param {string} mode - 'interactive', 'balanced', or 'playback'
   */
  function setLatencyMode(mode) {
    var isKnownLatencyMode = (mode === LATENCY_MODE_INTERACTIVE || mode === LATENCY_MODE_BALANCED || mode === LATENCY_MODE_PLAYBACK || mode === LATENCY_MODE_MAX);
    if (isKnownLatencyMode) {
      _latencyMode = mode;
    }
  }

  /**
   * Hot-switch latency mode without page reload.
   * Stops all audio, closes the old AudioContext, creates a new one
   * with the updated latencyHint, and reinitializes the effect chain.
   * Brief audio gap (~50-100ms) is expected.
   * @param {string} newMode - 'interactive', 'balanced', 'playback', or 'max'
   */
  function switchLatencyMode(newMode) {
    var isValidMode = (newMode === LATENCY_MODE_INTERACTIVE || newMode === LATENCY_MODE_BALANCED || newMode === LATENCY_MODE_PLAYBACK || newMode === LATENCY_MODE_MAX);
    if (isValidMode) {
      if (!(newMode === _latencyMode && audioContext)) {

        // 1. Stop all active notes
        if (SL.audio && SL.audio.stopAllSustained) {
          SL.audio.stopAllSustained();
        }
        workletAllNotesOff();

        // 2. Disconnect and close old context
        if (audioContext) {
          // Disconnect worklet nodes
          for (var wi = 0; wi < synthWorkletNodes.length; wi++) {
            if (synthWorkletNodes[wi]) {
              try { synthWorkletNodes[wi].disconnect(); } catch (e) { /* node already disconnected */ }
              synthWorkletNodes[wi] = null;
            }
            if (workletFilterNodes[wi]) {
              try { workletFilterNodes[wi].disconnect(); } catch (e) { /* node already disconnected */ }
              workletFilterNodes[wi] = null;
            }
          }

          // Disconnect instrument chains
          for (var ii = 0; ii < instruments.length; ii++) {
            var inst = instruments[ii];
            if (inst.effectChain) {
              try { inst.effectChain.output.disconnect(); } catch (e) { /* node already disconnected */ }
            }
            if (inst.masterOutput) {
              try { inst.masterOutput.disconnect(); } catch (e) { /* node already disconnected */ }
            }
            if (inst.dcBlockerNode) {
              try { inst.dcBlockerNode.disconnect(); } catch (e) { /* node already disconnected */ }
            }
            if (inst.expressionFilterNode) {
              try { inst.expressionFilterNode.disconnect(); } catch (e) { /* node already disconnected */ }
              inst.expressionFilterNode = null;
            }
            if (inst.expressionGainNode) {
              try { inst.expressionGainNode.disconnect(); } catch (e) { /* node already disconnected */ }
              inst.expressionGainNode = null;
            }
            if (inst.volumeNode) {
              try { inst.volumeNode.disconnect(); } catch (e) { /* node already disconnected */ }
            }
            if (inst.panNode) {
              try { inst.panNode.disconnect(); } catch (e) { /* node already disconnected */ }
            }
            // Clear per-instrument analyser
            inst._analyserNode = null;
          }

          // Close old context
          try { audioContext.close(); } catch (e) { /* audio context may already be closed */ }
          audioContext = null;
          analyserNode = null;
          masterMerge = null;
          masterChain = null;
          masterOutput = null;
          effectChain = null;
          isWorkletSupported = false;
          isWorkletInitializing = false;
          workletReadyPromise = null;
        }

        // 3. Set new mode
        _latencyMode = newMode;

        // 4. Reinitialize: getCtx() will create a new AudioContext with the new latencyHint
        initEffectChain();
      }
    }
  }

  /**
   * Get the ScriptProcessor buffer size based on current latency mode
   * Low (interactive) = 512, Medium (balanced) = 1024, High (playback) = 2048
   * @returns {number} Buffer size
   */
  var BUFFER_SIZE_INTERACTIVE = 512;
  var BUFFER_SIZE_BALANCED = 1024;
  var BUFFER_SIZE_PLAYBACK = 2048;
  var BUFFER_SIZE_MAX = 4096;

  function getScriptProcessorBufferSize() {
    var mode = getLatencyMode();
    if (mode === LATENCY_MODE_INTERACTIVE) {
      return BUFFER_SIZE_INTERACTIVE;
    } else if (mode === LATENCY_MODE_MAX) {
      return BUFFER_SIZE_MAX;
    } else if (mode === LATENCY_MODE_PLAYBACK) {
      return BUFFER_SIZE_PLAYBACK;
    } else {
      return BUFFER_SIZE_BALANCED;
    }
  }

  // ============================================================
  // Audio Context Management
  // ============================================================

  /**
   * Get or create the Web Audio context
   */
  function getCtx() {
    if (!audioContext) {
      var CtxClass = window.AudioContext || window.webkitAudioContext;
      var latencyMode = getLatencyMode();
      var latencyHint = (latencyMode === LATENCY_MODE_MAX) ? 0.1 : latencyMode;
      audioContext = new CtxClass({ latencyHint: latencyHint });
      SL.SR = audioContext.sampleRate;
      // Wavetable init is handled by initEffectChain -> split module
    }
    if (audioContext.state === 'suspended') {
      audioContext.resume().then(function() {
      }).catch(function(e) {
        console.error('[AUDIO] AudioContext resume failed:', e);
      });
    }
    return audioContext;
  }

  /**
   * Get the final output destination
   */
  function getFinalDestination() {
    var inst = instruments[currentInstrument];
    if (inst && inst.masterOutput) {
      return inst.masterOutput;
    }
    if (effectChain) {
      return effectChain.input;
    }
    var ctx = getCtx();
    return ctx.destination;
  }

  // ============================================================
  // Page Visibility — suspend/resume AudioContext (A-02)
  // Prevents iOS Safari from killing the context after ~30s
  // in background, which causes the "no sound" bug on resume.
  // ============================================================

  /** Whether the AudioContext was suspended by the visibility handler */
  var _isSuspendedByVisibility = false;

  function _onVisibilityChange() {
    if (audioContext) {
      if (document.hidden) {
        // Page going to background — suspend to save resources
        if (audioContext.state === 'running') {
          _isSuspendedByVisibility = true;
          audioContext.suspend().catch(function(e) {
            console.warn('[AUDIO] Visibility suspend failed:', e);
          });
        }
      } else {
        // Page returning to foreground — resume if we suspended it
        if (_isSuspendedByVisibility && audioContext.state === 'suspended') {
          _isSuspendedByVisibility = false;
          audioContext.resume().catch(function(e) {
            console.error('[AUDIO] Visibility resume failed:', e);
          });
        }
      }
    }
  }

  document.addEventListener('visibilitychange', _onVisibilityChange);

  // ============================================================
  // Idle Auto-Suspend (A-06)
  // Suspends AudioContext after IDLE_SUSPEND_TIMEOUT_MS of no
  // note activity, saving 15-25% battery per hour.
  // ============================================================

  var IDLE_SUSPEND_TIMEOUT_MS = 120000;
  var _idleSuspendTimer = null;
  var _isSuspendedByIdle = false;

  /**
   * Reset the idle suspend timer. Call on every note-on event.
   */
  function _resetIdleSuspendTimer() {
    if (_idleSuspendTimer) {
      clearTimeout(_idleSuspendTimer);
      _idleSuspendTimer = null;
    }
    // Resume if we had auto-suspended
    var canResumeIdle = audioContext && audioContext.state === 'suspended';
    var shouldResumeAfterIdle = _isSuspendedByIdle && canResumeIdle;
    if (shouldResumeAfterIdle) {
      _isSuspendedByIdle = false;
      audioContext.resume().catch(function(e) {
        console.warn('[AUDIO] Idle resume failed:', e);
      });
    }
    // Start a new timer
    _idleSuspendTimer = setTimeout(function() {
      if (audioContext && audioContext.state === 'running') {
        // Check no notes are currently active
        var isAnyActive = false;
        for (var ci = 0; ci < instruments.length; ci++) {
          if (instruments[ci].playingNotes && instruments[ci].playingNotes.size > 0) {
            isAnyActive = true;
            break;
          }
        }
        var sequencerPlaying = (SL.screenAcid && SL.screenAcid._isPlaying && SL.screenAcid._isPlaying());
        if (!isAnyActive && !sequencerPlaying) {
          _isSuspendedByIdle = true;
          audioContext.suspend().catch(function(e) {
            console.warn('[AUDIO] Idle auto-suspend failed:', e);
          });
        }
      }
    }, IDLE_SUSPEND_TIMEOUT_MS);
  }

  // Reset idle timer on pointer/touch activity (not just note-on)
  document.addEventListener('pointerdown', _resetIdleSuspendTimer);
  document.addEventListener('pointermove', _resetIdleSuspendTimer);
  document.addEventListener('touchstart', _resetIdleSuspendTimer);

  // ============================================================
  // Effect Chain System
  // ============================================================

  function getEffectClasses() {
    return {
      distortion: SL.effects.Distortion,
      chorus: SL.effects.Chorus,
      delay: SL.effects.Delay,
      reverb: SL.effects.Reverb,
      bitcrush: SL.effects.Bitcrush,
      phaser: SL.effects.Phaser,
      flanger: SL.effects.Flanger,
      tremolo: SL.effects.TremoloEffect,
      filter: SL.effects.FilterEffect,
      compressor: SL.effects.CompressorEffect,
      eq: SL.effects.EQEffect,
      tape: SL.effects.TapeEffect,
      widener: SL.effects.WidenerEffect,
      lofi: SL.effects.LofiEffect,
      hueShifter: SL.effects.HueShifterEffect,
      driftscape: SL.effects.DriftscapeEffect,
      halo: SL.effects.HaloEffect,
      grainfield: SL.effects.GrainfieldEffect,
      stutterstep: SL.effects.StutterstepEffect,
      spectralHold: SL.effects.SpectralHoldEffect,
      gatedReverb: SL.effects.GatedReverbEffect,
      dimension: SL.effects.DimensionEffect,
      ringMod: SL.effects.RingModEffect,
      pump: SL.effects.PumpEffect,
      softClip: SL.effects.SoftClipEffect,
      pitchShift: SL.effects.PitchShiftEffect,
      gate: SL.effects.GateEffect,
      vocoder: SL.effects.VocoderEffect
    };
  }

  function registerFactoriesForChain(chain) {
    var effectClasses = getEffectClasses();
    Object.keys(effectClasses).forEach(function(name) {
      var EffectClass = effectClasses[name];
      if (EffectClass) {
        chain.registerFactory(name, EffectClass);
      }
    });
  }

  /**
   * Initialize the per-instrument effect chain system
   */
  function initEffectChain() {
    var ctx = getCtx();

    initDomCache();

    masterMerge = ctx.createGain();
    masterMerge.gain.value = 1.0;

    instruments.forEach(function(inst, i) {
      inst.effectChain = new SL.effects.EffectChain(ctx);
      registerFactoriesForChain(inst.effectChain);

      inst.masterOutput = ctx.createGain();
      inst.masterOutput.gain.value = 1.0;

      // DC blocking filter — subtractive voices can produce asymmetric
      // waveforms (offset > 0.05 observed on 20+ presets). Highpass at 10 Hz
      // removes DC without affecting audible content.
      var DC_BLOCK_FREQ_HZ = 10;
      var DC_BLOCK_Q = 0.707;
      inst.dcBlockerNode = ctx.createBiquadFilter();
      inst.dcBlockerNode.type = 'highpass';
      inst.dcBlockerNode.frequency.value = DC_BLOCK_FREQ_HZ;
      inst.dcBlockerNode.Q.value = DC_BLOCK_Q;

      // Expression filter + gain — engine-agnostic per-voice expression hooks
      // applied to ALL engines (not just subtractive worklet). Sits between the
      // DC blocker and the instrument volume. Defaults are transparent so no
      // audible change when no expressive surface is driving them.
      var EXPR_CUTOFF_DEFAULT_HZ = 20000;
      var EXPR_FILTER_Q_DEFAULT = 0.707;
      var EXPR_GAIN_DEFAULT = 1.0;
      inst.expressionFilterNode = ctx.createBiquadFilter();
      inst.expressionFilterNode.type = 'lowpass';
      inst.expressionFilterNode.frequency.value = EXPR_CUTOFF_DEFAULT_HZ;
      inst.expressionFilterNode.Q.value = EXPR_FILTER_Q_DEFAULT;
      inst.expressionGainNode = ctx.createGain();
      inst.expressionGainNode.gain.value = EXPR_GAIN_DEFAULT;

      inst.volumeNode = ctx.createGain();
      inst.volumeNode.gain.value = Math.pow(inst.settings.volume / 100, 2);

      // StereoPannerNode for per-instrument panning
      if (typeof StereoPannerNode !== 'undefined') {
        inst.panNode = ctx.createStereoPanner();
        inst.panNode.pan.value = 0;
        inst.masterOutput.connect(inst.dcBlockerNode);
        inst.dcBlockerNode.connect(inst.expressionFilterNode);
        inst.expressionFilterNode.connect(inst.expressionGainNode);
        inst.expressionGainNode.connect(inst.volumeNode);
        inst.volumeNode.connect(inst.panNode);
        inst.panNode.connect(inst.effectChain.input);
      } else {
        inst.masterOutput.connect(inst.dcBlockerNode);
        inst.dcBlockerNode.connect(inst.expressionFilterNode);
        inst.expressionFilterNode.connect(inst.expressionGainNode);
        inst.expressionGainNode.connect(inst.volumeNode);
        inst.volumeNode.connect(inst.effectChain.input);
      }

      inst.effectChain.output.connect(masterMerge);

    });

    masterChain = new SL.effects.EffectChain(ctx);
    registerFactoriesForChain(masterChain);

    masterMerge.connect(masterChain.input);

    analyserNode = ctx.createAnalyser();
    analyserNode.fftSize = 2048;
    analyserNode.smoothingTimeConstant = 0.8;

    // Master bus limiter (tanh soft clipper — first stage)
    var limiterShaper = ctx.createWaveShaper();
    var LIMITER_CURVE_SIZE = 8192;
    var LIMITER_CURVE_HALF = 4096;
    var LIMITER_DRIVE = 1.5;
    var limiterCurve = new Float32Array(LIMITER_CURVE_SIZE);
    for (var li = 0; li < LIMITER_CURVE_SIZE; li++) {
      var lx = (li / LIMITER_CURVE_HALF) - 1;
      limiterCurve[li] = Math.tanh(lx * LIMITER_DRIVE);
    }
    limiterShaper.curve = limiterCurve;
    limiterShaper.oversample = '2x';

    // Brickwall limiter (DynamicsCompressorNode — final safety, NON-DISABLEABLE)
    var BRICKWALL_THRESHOLD_DB = -1;
    var BRICKWALL_KNEE_DB = 0;
    var BRICKWALL_RATIO = 20;
    var BRICKWALL_ATTACK_SEC = 0.001;
    var BRICKWALL_RELEASE_SEC = 0.01;
    var CLIP_DETECTION_THRESHOLD_DB = 0.5;

    var brickwallLimiter = ctx.createDynamicsCompressor();
    brickwallLimiter.threshold.value = BRICKWALL_THRESHOLD_DB;
    brickwallLimiter.knee.value = BRICKWALL_KNEE_DB;
    brickwallLimiter.ratio.value = BRICKWALL_RATIO;
    brickwallLimiter.attack.value = BRICKWALL_ATTACK_SEC;
    brickwallLimiter.release.value = BRICKWALL_RELEASE_SEC;

    // Clip indicator state — UI can read SL.audio.isClipping
    var _isClipActive = false;
    var _clipTimerId = null;
    var CLIP_INDICATOR_HOLD_MS = 300;

    var _clipPollAnimId = null;
    function _pollClipIndicator() {
      _clipPollAnimId = requestAnimationFrame(_pollClipIndicator);
      if (brickwallLimiter) {
        var isSuspended = (ctx && ctx.state === 'suspended');
        if (SL._tabVisible && !isSuspended) {
          var reduction = brickwallLimiter.reduction; // negative dB value
          var wasClipping = _isClipActive;
          if (reduction < -CLIP_DETECTION_THRESHOLD_DB) {
            _isClipActive = true;
            if (_clipTimerId) {
              clearTimeout(_clipTimerId);
            }
            _clipTimerId = setTimeout(function() {
              _isClipActive = false;
              _clipTimerId = null;
              var clipEl = document.getElementById('sslClipIndicator');
              if (clipEl) {
                clipEl.style.display = 'none';
              }
              // Notify via callback instead of direct DOM manipulation
              if (SL.audio && SL.audio.onLimiterEngage) {
                SL.audio.onLimiterEngage(false);
              }
            }, CLIP_INDICATOR_HOLD_MS);
          }
          // Show clip indicator when newly clipping
          if (_isClipActive && !wasClipping) {
            var clipEl = document.getElementById('sslClipIndicator');
            if (clipEl) {
              clipEl.style.display = 'inline-block';
            }
            // Notify via callback instead of direct DOM manipulation
            if (SL.audio && SL.audio.onLimiterEngage) {
              SL.audio.onLimiterEngage(true);
            }
          }
        }
      }
    }
    _clipPollAnimId = requestAnimationFrame(_pollClipIndicator);

    // Safe-volume gain node for Kids/Calm screens
    var SAFE_VOLUME_DB = -12;
    var SAFE_VOLUME_GAIN = Math.pow(10, SAFE_VOLUME_DB / 20); // ~0.25
    var NORMAL_VOLUME_GAIN = 1.0;
    var safeVolumeNode = ctx.createGain();
    safeVolumeNode.gain.value = NORMAL_VOLUME_GAIN;
    var _isSafeVolumeActive = false;

    // Hard clip safety net — absolute last resort, clamps to [-1, 1]
    var hardClipShaper = ctx.createWaveShaper();
    var HARD_CLIP_CURVE_SIZE = 8192;
    var HARD_CLIP_CURVE_HALF = 4096;
    var hardClipCurve = new Float32Array(HARD_CLIP_CURVE_SIZE);
    for (var hci = 0; hci < HARD_CLIP_CURVE_SIZE; hci++) {
      var hcx = (hci / HARD_CLIP_CURVE_HALF) - 1;
      hardClipCurve[hci] = Math.max(-1, Math.min(1, hcx));
    }
    hardClipShaper.curve = hardClipCurve;
    hardClipShaper.oversample = 'none';

    // Routing: masterChain -> softClipper -> brickwall -> hardClip -> safeVolume -> analyser -> destination
    masterChain.output.connect(limiterShaper);
    limiterShaper.connect(brickwallLimiter);
    brickwallLimiter.connect(hardClipShaper);
    hardClipShaper.connect(safeVolumeNode);
    safeVolumeNode.connect(analyserNode);
    analyserNode.connect(ctx.destination);

    masterOutput = instruments[currentInstrument].masterOutput;
    effectChain = instruments[0].effectChain;

    // Initialize subsystems from split modules
    if (SL.audio.initVoicePool) SL.audio.initVoicePool();
    if (SL.audio.initBufferPool) SL.audio.initBufferPool();
    if (SL.audio.initWavetables) SL.audio.initWavetables();

    // Initialize LFOs for all instruments
    if (SL.audio.initLFO) {
      for (var li = 0; li < NUM_INSTRUMENTS; li++) {
        SL.audio.initLFO(li);
      }
    }

    // Initialize mod matrix for all instruments
    if (SL.audio.initModMatrix) {
      for (var mi = 0; mi < NUM_INSTRUMENTS; mi++) {
        SL.audio.initModMatrix(mi);
      }
    }

    // Export effect chain for UI access
    SL.audio.effectChain = effectChain;

    // Initialize AudioWorklet (async, non-blocking)
    initSynthWorklet().catch(function(e) {
      var msg = e['message'] || e;
      console.warn('[AUDIO] AudioWorklet init failed (fallback to band-limited):', msg);
    });
  }

  // ============================================================
  // AudioWorklet
  // ============================================================

  async function initSynthWorklet() {
    if (!audioContext || !audioContext.audioWorklet) {
      console.warn('AudioWorklet not supported in this browser');
      isWorkletSupported = false;
    } else {
      if (!(isWorkletInitializing || synthWorkletNodes[0])) {
        isWorkletInitializing = true;
        workletReadyPromise = new Promise(async function(resolve, reject) {
          try {
            var synthWorkletUrl = _workletBlobUrls['synth-worklet.js'] || 'assets/synth-worklet.js';
            await audioContext.audioWorklet.addModule(synthWorkletUrl);

            var readyCount = 0;
            for (var i = 0; i < 4; i++) {
              synthWorkletNodes[i] = new AudioWorkletNode(audioContext, 'synth-worklet', {
                numberOfInputs: 0,
                numberOfOutputs: 1,
                outputChannelCount: [1]
              });
              if (instruments[i] && instruments[i].masterOutput) {
                // Insert a persistent filter between the worklet and masterOutput
                // so subtractive filter controls affect worklet synthesis
                workletFilterNodes[i] = audioContext.createBiquadFilter();
                workletFilterNodes[i].type = 'lowpass';
                workletFilterNodes[i].frequency.value = 20000;
                workletFilterNodes[i].Q.value = 0.707;
                synthWorkletNodes[i].connect(workletFilterNodes[i]);
                workletFilterNodes[i].connect(instruments[i].masterOutput);
              }

              synthWorkletNodes[i].port.onmessage = (function(idx) {
                return function(event) {
                  var data = event.data;
                  if (data.type === 'ready') {
                    readyCount++;
                    if (readyCount >= 4) {
                      isWorkletSupported = true;
                      isWorkletInitializing = false;
                      resolve(true);
                    }
                  }
                };
              })(i);

              synthWorkletNodes[i].onprocessorerror = (function(idx) {
                return function(event) {
                  console.error('AudioWorklet processor error (instrument ' + (idx + 1) + '):', event);
                  isWorkletSupported = false;
                  isWorkletInitializing = false;
                  reject(event);
                };
              })(i);
            }

          } catch (error) {
            console.error('Failed to initialize AudioWorklet:', error);
            isWorkletSupported = false;
            isWorkletInitializing = false;
            reject(error);
          }
        });
      }

      return workletReadyPromise;
    }
  }

  function isWorkletAvailable() {
    return isWorkletSupported && synthWorkletNodes[0] !== NO_NODE;
  }

  function workletNoteOn(midi, dur, oscSettings, adsr, refHz, instId, extraParams) {
    var id = (instId !== undefined) ? instId : currentInstrument;
    var node = synthWorkletNodes[id];
    if (!node) { return; }

    var rawHum = instruments[id].settings.humanization || {};
    var velHum = (typeof rawHum === 'number') ? rawHum : (rawHum.velocity || 0);
    var adsrHum = (typeof rawHum === 'number') ? rawHum : (rawHum.adsr || 0);
    var timingHum = (typeof rawHum === 'number') ? 0 : (rawHum.timing || 0);

    var tuningCents = (SL.tuning && SL.tuning.getCentOffset) ? SL.tuning.getCentOffset(midi) : 0;

    var msg = {
      type: 'noteOn',
      midi: midi,
      velocity: 127,
      duration: dur,
      oscillators: oscSettings,
      adsr: adsr,
      refHz: refHz || 440,
      tuningCents: tuningCents,
      humVelocity: velHum,
      humAdsr: adsrHum,
      humTiming: timingHum,
      instId: id
    };

    if (extraParams) {
      if (extraParams.glideTime !== undefined) {
        msg.glideTime = extraParams.glideTime;
      }
      if (extraParams.padAftertouch !== undefined) {
        msg.padAftertouch = extraParams.padAftertouch;
      }
    }

    node.port.postMessage(msg);

    setTimeout(function() {
      workletNoteOff(midi, id);
    }, dur * 1000);
  }

  function workletNoteOff(midi, instId) {
    var id = (instId !== undefined) ? instId : currentInstrument;
    var node = synthWorkletNodes[id];
    if (node) {
      node.port.postMessage({ type: 'noteOff', midi: midi });
    }
  }

  function workletAllNotesOff() {
    for (var i = 0; i < 4; i++) {
      if (synthWorkletNodes[i]) {
        synthWorkletNodes[i].port.postMessage({ type: 'allNotesOff' });
      }
    }
  }

  // ============================================================
  // Frequency & Harmonics Calculations
  // ============================================================

  function m2f(n) {
    var el = domCache.refHz;
    var a4 = (el ? parseFloat(el.value) : 0) || 440;
    if (SL.tuning && SL.tuning.noteToFreq) {
      return SL.tuning.noteToFreq(n, a4);
    }
    return a4 * Math.pow(2, (n - 69) / 12);
  }

  function maxH(f) {
    var sr = SL.SR || 44100;
    return Math.floor((sr / 2) / f);
  }

  function freqToNote(freq) {
    var A4 = 440;
    var semitones = 12 * Math.log2(freq / A4);
    var midiNote = Math.round(69 + semitones);
    var octave = Math.floor(midiNote / 12) - 1;
    var noteIndex = ((midiNote % 12) + 12) % 12;
    return SL.NOTE_NAMES[noteIndex] + octave;
  }

  function noteToFreq(noteName) {
    var match = noteName.match(/^([A-G]#?)(\d+)$/);
    if (!match) {
      return 440;
    }
    var note = match[1];
    var octave = parseInt(match[2]);
    var noteIndex = SL.NOTE_NAMES.indexOf(note);
    if (noteIndex === NOT_FOUND) {
      return 440;
    }
    var midiNote = (octave + 1) * 12 + noteIndex;
    if (SL.tuning && SL.tuning.noteToFreq) {
      return SL.tuning.noteToFreq(midiNote, 440);
    }
    return 440 * Math.pow(2, (midiNote - 69) / 12);
  }

  // ============================================================
  // Parameter Getters (read from UI)
  // ============================================================

  function sliderToTime(sliderValue, sliderMax, timeMax) {
    var normalized = sliderValue / sliderMax;
    return timeMax * Math.pow(normalized, 2);
  }

  function timeToSlider(timeMs, sliderMax, timeMax) {
    var normalized = Math.sqrt(timeMs / timeMax);
    return normalized * sliderMax;
  }

  function getADSR() {
    var hasDom = domCache.adsrA || domCache.adsrD || domCache.adsrS || domCache.adsrR;

    // Fall back to instrument settings when DOM elements are absent (e.g. SSLI mode)
    var inst = instruments[currentInstrument];
    var savedAdsr = (!hasDom && inst && inst.settings) ? inst.settings.adsr : null;

    var aSlider, dSlider, sSlider, rSlider;
    if (savedAdsr && !hasDom) {
      aSlider = (typeof savedAdsr.a === 'number') ? savedAdsr.a : 10;
      dSlider = (typeof savedAdsr.d === 'number') ? savedAdsr.d : 100;
      sSlider = (typeof savedAdsr.s === 'number') ? savedAdsr.s : 70;
      rSlider = (typeof savedAdsr.r === 'number') ? savedAdsr.r : 200;
    } else {
      aSlider = (domCache.adsrA ? parseFloat(domCache.adsrA.value) : 0) || 10;
      dSlider = (domCache.adsrD ? parseFloat(domCache.adsrD.value) : 0) || 100;
      sSlider = (domCache.adsrS ? parseFloat(domCache.adsrS.value) : 0) || 70;
      rSlider = (domCache.adsrR ? parseFloat(domCache.adsrR.value) : 0) || 200;
    }

    return {
      a: sliderToTime(aSlider, 500, 500) / 1000,
      d: sliderToTime(dSlider, 500, 500) / 1000,
      s: sSlider / 100,
      r: sliderToTime(rSlider, 1000, 1000) / 1000
    };
  }

  function getOscSettings() {
    var results = [];

    // Fall back to instrument settings when DOM elements are absent (e.g. SSLI mode)
    var instId = currentInstrument;
    var inst = instruments[instId];
    var savedOsc = (inst && inst.settings) ? inst.settings.osc : null;

    for (var n = 1; n <= 3; n++) {
      var inlineWave = domCache.oscWave[n];
      var inlineOct = domCache.oscOct[n];
      var inlineDetune = domCache.oscDetune[n];
      var inlineLevel = domCache.oscLevel[n];
      var modalPw = domCache.oscPw[n];
      var modalSpread = domCache.oscSpread[n];
      var inlineFine = domCache.oscFine[n];

      var hasDom = inlineWave || inlineOct || inlineDetune || inlineLevel;
      var saved = (savedOsc && savedOsc[n - 1]) ? savedOsc[n - 1] : null;

      var wave, oct, detune, fine, level, pulseWidth, superSawSpread;
      if (hasDom) {
        wave = inlineWave ? inlineWave.value : 'sawtooth';
        oct = inlineOct ? parseInt(inlineOct.value) || 0 : 0;
        detune = inlineDetune ? parseFloat(inlineDetune.value) || 0 : 0;
        fine = inlineFine ? parseFloat(inlineFine.value) || 0 : 0;
        level = inlineLevel ? parseFloat(inlineLevel.value) / 100 : 0.5;
        pulseWidth = modalPw ? parseFloat(modalPw.value) : 50;
        superSawSpread = modalSpread ? parseFloat(modalSpread.value) : 50;
      } else if (saved) {
        wave = saved.wave || 'sawtooth';
        oct = saved.oct || 0;
        detune = saved.detune || 0;
        fine = saved.fine || 0;
        level = (typeof saved.level === 'number') ? saved.level / 100 : 0.5;
        pulseWidth = (typeof saved.pulseWidth === 'number') ? saved.pulseWidth : 50;
        superSawSpread = (typeof saved.superSawSpread === 'number') ? saved.superSawSpread : 50;
      } else {
        wave = 'sawtooth';
        oct = 0;
        detune = 0;
        fine = 0;
        level = 0.5;
        pulseWidth = 50;
        superSawSpread = 50;
      }

      var totalDetune = detune + fine;
      results.push({ wave: wave, oct: oct, detune: totalDetune, fine: fine, level: level, pulseWidth: pulseWidth, superSawSpread: superSawSpread });
    }

    return results;
  }

  function getFilterSettings() {
    var enabled = domCache.filterEnabled;
    var typeSelect = domCache.filterType || document.getElementById('filterType');
    var slopeRadio = document.querySelector('input[name="filterSlope"]:checked');
    var freqSlider = domCache.filterFreq;
    var qSlider = domCache.filterQ;
    var keyTrackSlider = domCache.filterKeyTrack;
    var model = domCache.filterModel;

    // Fall back to instrument settings when DOM elements are absent (e.g. SSLI mode)
    var hasDom = typeSelect || freqSlider || qSlider;
    var inst = instruments[currentInstrument];
    var savedFilter = (!hasDom && inst && inst.settings) ? inst.settings.filter : null;

    var freqSliderValue, qSliderValue, keyTrackValue;
    var enabledValue, typeValue, slopeValue, modelValue;

    if (savedFilter && !hasDom) {
      enabledValue = (typeof savedFilter.enabled === 'boolean') ? savedFilter.enabled : true;
      typeValue = savedFilter.type || 'lowpass';
      slopeValue = savedFilter.slope || 24;
      freqSliderValue = (typeof savedFilter.freq === 'number') ? savedFilter.freq : 850;
      qSliderValue = (typeof savedFilter.q === 'number') ? savedFilter.q : 10;
      keyTrackValue = (typeof savedFilter.keyTrack === 'number') ? savedFilter.keyTrack / 100 : 0;
      modelValue = savedFilter.model || 'butterworth';
    } else {
      enabledValue = enabled ? enabled.checked : true;
      typeValue = typeSelect ? typeSelect.value : 'lowpass';
      slopeValue = slopeRadio ? parseInt(slopeRadio.value) : 24;
      freqSliderValue = freqSlider ? parseFloat(freqSlider.value) : 850;
      qSliderValue = qSlider ? parseFloat(qSlider.value) : 10;
      keyTrackValue = keyTrackSlider ? parseFloat(keyTrackSlider.value) / 100 : 0;
      modelValue = model ? model.value : 'butterworth';
    }

    // Use split module's conversion functions if available, otherwise inline
    var sliderToFreqFn = SL.audio.sliderToFreq || function(v) {
      var minLog = Math.log10(20);
      var maxLog = Math.log10(20000);
      return Math.pow(10, minLog + (v / 1000) * (maxLog - minLog));
    };
    var sliderToQFn = SL.audio.sliderToQ || function(v) {
      return 0.5 + Math.pow(v / 100, 1.5) * 19.5;
    };

    return {
      enabled: enabledValue,
      type: typeValue,
      slope: slopeValue,
      frequency: sliderToFreqFn(freqSliderValue),
      resonance: sliderToQFn(qSliderValue),
      keyTrack: keyTrackValue,
      model: modelValue
    };
  }

  /**
   * Update the persistent worklet filter node for the given instrument.
   * Called whenever filter UI changes so that worklet-synthesized audio
   * is affected by the subtractive filter controls.
   */
  // F3-06: Parameter smoothing time constants (seconds)
  var FILTER_CUTOFF_SMOOTHING = 0.015;
  var FILTER_Q_SMOOTHING = 0.02;

  function updateWorkletFilter(instId) {
    if (instId === undefined) {
      instId = currentInstrument;
    }
    var filterNode = workletFilterNodes[instId];
    if (filterNode) {
      var fs = getFilterSettings();
      var now = audioContext ? audioContext.currentTime : 0;
      if (!fs.enabled) {
        filterNode.type = 'lowpass';
        filterNode.frequency.setTargetAtTime(20000, now, FILTER_CUTOFF_SMOOTHING);
        filterNode.Q.setTargetAtTime(0.707, now, FILTER_Q_SMOOTHING);
      } else {
        filterNode.type = fs.type || 'lowpass';
        var clampedFreq = Math.max(20, Math.min(20000, fs.frequency || 20000));
        var clampedQ = Math.max(0.1, Math.min(30, fs.resonance || 1));
        filterNode.frequency.setTargetAtTime(clampedFreq, now, FILTER_CUTOFF_SMOOTHING);
        filterNode.Q.setTargetAtTime(clampedQ, now, FILTER_Q_SMOOTHING);
      }
    }
  }

  // ============================================================
  // Expressive Filter Cutoff (for controller Y-axis)
  // ============================================================

  var EXPRESSIVE_CUTOFF_SMOOTHING = 0.02;
  var _isExpressiveCutoffActive = false;

  function setExpressiveCutoff(freqHz) {
    _isExpressiveCutoffActive = true;
    var clampedFreq = Math.max(20, Math.min(20000, freqHz));
    var now = audioContext ? audioContext.currentTime : 0;
    var instId = currentInstrument;
    var filterNode = workletFilterNodes[instId];
    if (filterNode) {
      filterNode.type = 'lowpass';
      filterNode.frequency.setTargetAtTime(clampedFreq, now, EXPRESSIVE_CUTOFF_SMOOTHING);
    }
  }

  function clearExpressiveCutoff() {
    if (_isExpressiveCutoffActive) {
      _isExpressiveCutoffActive = false;
      updateWorkletFilter(currentInstrument);
    }
  }

  // Engine-agnostic per-instrument expression: lowpass cutoff + gain applied
  // to ALL engines (subtractive, FM, physical, modal, reed, etc.) by virtue
  // of sitting between the DC blocker and the instrument volume.
  var EXPRESSION_SMOOTHING_S = 0.02;
  var EXPRESSION_CUTOFF_IDLE_HZ = 20000;
  var EXPRESSION_GAIN_IDLE = 1.0;

  function setExpression(cutoffHz, gainLinear) {
    var instId = currentInstrument;
    var inst = instruments[instId];
    if (!inst || !audioContext) { return; }
    var now = audioContext.currentTime;
    if (inst.expressionFilterNode && typeof cutoffHz === 'number') {
      var clampedCutoff = Math.max(20, Math.min(20000, cutoffHz));
      inst.expressionFilterNode.frequency.setTargetAtTime(clampedCutoff, now, EXPRESSION_SMOOTHING_S);
    }
    if (inst.expressionGainNode && typeof gainLinear === 'number') {
      var clampedGain = Math.max(0, Math.min(2, gainLinear));
      inst.expressionGainNode.gain.setTargetAtTime(clampedGain, now, EXPRESSION_SMOOTHING_S);
    }
  }

  function clearExpression() {
    var instId = currentInstrument;
    var inst = instruments[instId];
    if (!inst || !audioContext) { return; }
    var now = audioContext.currentTime;
    if (inst.expressionFilterNode) {
      inst.expressionFilterNode.frequency.setTargetAtTime(EXPRESSION_CUTOFF_IDLE_HZ, now, EXPRESSION_SMOOTHING_S);
    }
    if (inst.expressionGainNode) {
      inst.expressionGainNode.gain.setTargetAtTime(EXPRESSION_GAIN_IDLE, now, EXPRESSION_SMOOTHING_S);
    }
  }

  function getNoiseSettings() {
    var typeSelect = domCache.noiseType;
    var levelSlider = domCache.noiseLevel;
    var hasDom = typeSelect || levelSlider;

    // Fall back to instrument settings when DOM elements are absent (e.g. SSLI mode)
    var inst = instruments[currentInstrument];
    var savedNoise = (!hasDom && inst && inst.settings) ? inst.settings.noise : null;

    var level, noiseType;
    if (savedNoise && !hasDom) {
      level = (typeof savedNoise.level === 'number') ? savedNoise.level / 100 : 0;
      noiseType = savedNoise.type || 'white';
    } else {
      level = levelSlider ? parseFloat(levelSlider.value) / 100 : 0;
      noiseType = typeSelect ? typeSelect.value : 'white';
    }

    return {
      enabled: level > 0,
      type: noiseType,
      level: level
    };
  }

  function getFilterEnvSettings() {
    var enabled = domCache.filterEnvEnabled;
    var amount = domCache.filterEnvAmount;
    var attack = domCache.filterEnvA;
    var decay = domCache.filterEnvD;
    var sustain = domCache.filterEnvS;
    var release = domCache.filterEnvR;
    var linkToAmp = domCache.filterEnvLinkToAmp;
    var hasDom = enabled || amount || attack || decay || sustain || release;

    // Fall back to instrument settings when DOM elements are absent (e.g. SSLI mode)
    var inst = instruments[currentInstrument];
    var savedFiltEnv = (!hasDom && inst && inst.settings) ? inst.settings.filterEnv : null;

    if (savedFiltEnv && !hasDom) {
      var filtEnvLink = savedFiltEnv.link || false;
      if (filtEnvLink) {
        var ampAdsr = getADSR();
        return {
          enabled: (typeof savedFiltEnv.enabled === 'boolean') ? savedFiltEnv.enabled : false,
          amount: (typeof savedFiltEnv.amount === 'number') ? savedFiltEnv.amount : 24,
          attack: ampAdsr.a * 1000,
          decay: ampAdsr.d * 1000,
          sustain: ampAdsr.s * 100,
          release: ampAdsr.r * 1000,
          linkToAmp: true
        };
      }
      var feA = (typeof savedFiltEnv.a === 'number') ? savedFiltEnv.a : 200;
      var feD = (typeof savedFiltEnv.d === 'number') ? savedFiltEnv.d : 600;
      var feS = (typeof savedFiltEnv.s === 'number') ? savedFiltEnv.s : 0;
      var feR = (typeof savedFiltEnv.r === 'number') ? savedFiltEnv.r : 775;
      return {
        enabled: (typeof savedFiltEnv.enabled === 'boolean') ? savedFiltEnv.enabled : false,
        amount: (typeof savedFiltEnv.amount === 'number') ? savedFiltEnv.amount : 24,
        attack: sliderToTime(feA, 2000, 2000),
        decay: sliderToTime(feD, 2000, 2000),
        sustain: feS,
        release: sliderToTime(feR, 3000, 3000),
        linkToAmp: false
      };
    }

    if (linkToAmp && linkToAmp.checked) {
      var ampAdsrLinked = getADSR();
      return {
        enabled: enabled ? enabled.checked : false,
        amount: amount ? parseFloat(amount.value) : 24,
        attack: ampAdsrLinked.a * 1000,
        decay: ampAdsrLinked.d * 1000,
        sustain: ampAdsrLinked.s * 100,
        release: ampAdsrLinked.r * 1000,
        linkToAmp: true
      };
    }

    var aSlider = attack ? parseFloat(attack.value) : 10;
    var dSlider = decay ? parseFloat(decay.value) : 150;
    var sSlider = sustain ? parseFloat(sustain.value) : 0;
    var rSlider = release ? parseFloat(release.value) : 200;

    return {
      enabled: enabled ? enabled.checked : false,
      amount: amount ? parseFloat(amount.value) : 24,
      attack: sliderToTime(aSlider, 2000, 2000),
      decay: sliderToTime(dSlider, 2000, 2000),
      sustain: sSlider,
      release: sliderToTime(rSlider, 3000, 3000),
      linkToAmp: false
    };
  }

  // ============================================================
  // Instrument Switching (core, uses split module functions)
  // ============================================================

  function setCurrentInstrument(newInstId) {
    if (newInstId < 0 || newInstId >= NUM_INSTRUMENTS) return;
    if (newInstId === currentInstrument) return;

    // Save current instrument's settings from UI
    if (SL.audio.saveInstrumentSettings) {
      SL.audio.saveInstrumentSettings(currentInstrument);
    }

    var oldInstId = currentInstrument;
    currentInstrument = newInstId;

    masterOutput = instruments[currentInstrument].masterOutput;

    // Per-instrument worklet nodes are permanently connected — no reconnect needed

    // Load new instrument's settings to UI
    if (SL.audio.loadInstrumentSettings) {
      SL.audio.loadInstrumentSettings(currentInstrument);
    }

    // Update volume slider UI
    var volSlider = document.getElementById('instrumentVolume');
    var volVal = document.getElementById('instrumentVolumeVal');
    if (volSlider) {
      var vol = instruments[currentInstrument].settings.volume;
      if (vol === undefined) vol = 80;
      volSlider.value = vol;
      if (volVal) volVal.textContent = vol;
    }

    // Humanization sliders are synced via loadInstrumentSettings()

    // Restart continuous noise with new instrument's settings
    // Skip for the loop instrument (index 4) — loop engine manages its own audio nodes
    if (SL.audio.restartContinuousNoise && instruments[newInstId].type !== 'loop') {
      SL.audio.restartContinuousNoise();
    } else if (instruments[newInstId].type === 'loop') {
      // Stop any lingering continuous noise when switching to loop instrument
      if (SL.audio.stopContinuousNoise) {
        SL.audio.stopContinuousNoise();
      }
    }

  }

  function getCurrentInstrument() {
    return currentInstrument;
  }

  function getNumInstruments() {
    return NUM_INSTRUMENTS;
  }

  function getInstruments() {
    return instruments;
  }

  // ============================================================
  // Per-Instrument Effect Chain API
  // ============================================================

  function getInstrumentChain(instIndex) {
    if (instIndex < 0 || instIndex >= NUM_INSTRUMENTS) return null;
    return instruments[instIndex].effectChain;
  }

  function getMasterChain() {
    return masterChain;
  }

  function getEffectChainForTarget(target) {
    if (target === MASTER_TARGET) return masterChain;
    return getInstrumentChain(target);
  }

  function getAllInstrumentChains() {
    return instruments.map(function(inst) { return inst.effectChain; });
  }

  // ============================================================
  // Per-Instrument Volume Control
  // ============================================================

  function setInstrumentVolume(instId, value) {
    if (instId < 0 || instId >= NUM_INSTRUMENTS) {
      // out of range, do nothing
    } else {
      var inst = instruments[instId];
      inst.settings.volume = value;
      if (inst.volumeNode) {
        inst.volumeNode.gain.value = Math.pow(value / 100, 2);
      }
    }
  }

  function setInstrumentPan(instId, value) {
    // value: -1.0 (full left) to +1.0 (full right)
    if (instId < 0 || instId >= NUM_INSTRUMENTS) {
      // out of range
    } else {
      var inst = instruments[instId];
      if (inst.panNode) {
        inst.panNode.pan.value = Math.max(-1, Math.min(1, value));
      }
    }
  }

  function getInstrumentAnalyser(instId) {
    if (instId < 0 || instId >= NUM_INSTRUMENTS) {
      return null;
    }
    var inst = instruments[instId];
    // Lazy-create per-instrument analyser
    if (!inst._analyserNode) {
      var ctx = getCtx();
      if (ctx) {
        inst._analyserNode = ctx.createAnalyser();
        inst._analyserNode.fftSize = 256;
        inst._analyserNode.smoothingTimeConstant = 0.8;
        // Tap from the effect chain output (before master merge)
        if (inst.effectChain && inst.effectChain.output) {
          inst.effectChain.output.connect(inst._analyserNode);
        }
      }
    }
    return inst._analyserNode || null;
  }

  // ============================================================
  // Export to SynthLab Namespace
  // ============================================================
  // All functions are registered here. Split modules will OVERWRITE
  // the placeholder entries with their implementations when they load.

  SL.audio = {
    // Limiter engagement callback (set by play screen)
    onLimiterEngage: null,

    // Active AudioNode counter for diagnostics and automated testing
    _activeNodeCount: 0,

    // Context
    getCtx: getCtx,
    getFinalDestination: getFinalDestination,

    // Latency mode
    getLatencyMode: getLatencyMode,
    setLatencyMode: setLatencyMode,
    switchLatencyMode: switchLatencyMode,
    getScriptProcessorBufferSize: getScriptProcessorBufferSize,

    // Idle auto-suspend (A-06) — call on note-on to keep context alive
    resetIdleSuspendTimer: _resetIdleSuspendTimer,

    // Conversion utilities
    m2f: m2f,
    maxH: maxH,
    freqToNote: freqToNote,
    noteToFreq: noteToFreq,
    sliderToTime: sliderToTime,
    timeToSlider: timeToSlider,

    // Parameter getters
    getADSR: getADSR,
    getOscSettings: getOscSettings,
    getFilterSettings: getFilterSettings,
    getNoiseSettings: getNoiseSettings,
    getFilterEnvSettings: getFilterEnvSettings,

    // Multi-instrument management
    getCurrentInstrument: getCurrentInstrument,
    setCurrentInstrument: setCurrentInstrument,
    getNumInstruments: getNumInstruments,
    getInstruments: getInstruments,
    getInstrumentType: getInstrumentType,
    setInstrumentType: setInstrumentType,
    getFMSettings: getFMSettings,
    setFMSettings: setFMSettings,
    getPhysicalSettings: getPhysicalSettings,
    setPhysicalSettings: setPhysicalSettings,
    getGranularSettings: getGranularSettings,
    setGranularSettings: setGranularSettings,
    getVocoderSynthSettings: getVocoderSynthSettings,
    setVocoderSynthSettings: setVocoderSynthSettings,
    getWavefoldSettings: getWavefoldSettings,
    setWavefoldSettings: setWavefoldSettings,
    getFormantSettings: getFormantSettings,
    setFormantSettings: setFormantSettings,
    getModalSettings: getModalSettings,
    setModalSettings: setModalSettings,
    getAdditiveSettings: getAdditiveSettings,
    setAdditiveSettings: setAdditiveSettings,
    getRingmodSettings: getRingmodSettings,
    setRingmodSettings: setRingmodSettings,
    getChordEngineSettings: getChordEngineSettings,
    setChordEngineSettings: setChordEngineSettings,
    getSuperwaveSettings: getSuperwaveSettings,
    setSuperwaveSettings: setSuperwaveSettings,
    getWavetableSettings: getWavetableSettings,
    setWavetableSettings: setWavetableSettings,
    getPhasedistSettings: getPhasedistSettings,
    setPhasedistSettings: setPhasedistSettings,
    getChipSettings: getChipSettings,
    setChipSettings: setChipSettings,
    getBytebeatSettings: getBytebeatSettings,
    setBytebeatSettings: setBytebeatSettings,
    getVectorSettings: getVectorSettings,
    setVectorSettings: setVectorSettings,
    getDrumsynSettings: getDrumsynSettings,
    setDrumsynSettings: setDrumsynSettings,
    getPulsarSettings: getPulsarSettings,
    setPulsarSettings: setPulsarSettings,
    getReedSettings: getReedSettings,
    setReedSettings: setReedSettings,
    getBodyResonanceSettings: getBodyResonanceSettings,
    setBodyResonanceSettings: setBodyResonanceSettings,
    setInstrumentVolume: setInstrumentVolume,
    setInstrumentPan: setInstrumentPan,
    getInstrumentAnalyser: getInstrumentAnalyser,

    // State accessors (for split modules)
    getActiveOscillators: getActiveOscillators,
    getPlayingNotes: getPlayingNotes,

    // Effect chain
    initEffectChain: initEffectChain,
    effectChain: null,  // Set by initEffectChain

    // Per-instrument effect chain system
    getInstrumentChain: getInstrumentChain,
    getMasterChain: getMasterChain,
    getEffectChainForTarget: getEffectChainForTarget,
    getAllInstrumentChains: getAllInstrumentChains,

    // DOM cache reference frequency helper
    getRefHz: function() {
      var el = domCache.refHz;
      if (el) {
        return parseFloat(el.value) || 440;
      }
      return 440;
    },

    // Analyser for visualization
    getAnalyser: function() { return analyserNode; },

    // Brickwall limiter clip indicator (read-only)
    get isClipping() { return _isClipActive; },

    // Safe-volume mode for Kids/Calm screens
    setSafeVolume: function(enabled) {
      _isSafeVolumeActive = Boolean(enabled);
      if (safeVolumeNode) {
        safeVolumeNode.gain.setTargetAtTime(
          enabled ? SAFE_VOLUME_GAIN : NORMAL_VOLUME_GAIN,
          audioContext ? audioContext.currentTime : 0,
          0.05
        );
      }
    },
    get isSafeVolumeActive() { return _isSafeVolumeActive; },

    // AudioWorklet synthesis
    initSynthWorklet: initSynthWorklet,
    isWorkletAvailable: isWorkletAvailable,
    getWorkletBlobUrl: function(file) { return _workletBlobUrls[file] || null; },
    workletNoteOn: workletNoteOn,
    workletNoteOff: workletNoteOff,
    workletAllNotesOff: workletAllNotesOff,
    updateWorkletFilter: updateWorkletFilter,
    setExpressiveCutoff: setExpressiveCutoff,
    clearExpressiveCutoff: clearExpressiveCutoff,
    setExpression: setExpression,
    clearExpression: clearExpression,

    // Expose default settings for split modules
    _DEFAULT_INSTRUMENT_SETTINGS: DEFAULT_INSTRUMENT_SETTINGS,

    // === The following are populated by split modules ===
    // They are listed here as null stubs so that code referencing
    // SL.audio.* before split modules load won't crash.

    // From filters.js
    sliderToFreq: null,
    freqToSlider: null,
    sliderToQ: null,
    qToSlider: null,
    calcKeyTrackedFreq: null,
    createFilterChain: null,
    createPulseWave: null,
    createSuperSawOscillators: null,
    polyBlep: null,
    polyBlepSaw: null,
    polyBlepSquare: null,
    polyBlepPulse: null,
    polyBlepTriangle: null,

    // From envelope.js
    calcADSR: null,
    getEnvelopeCurve: null,
    clearEnvelopeCache: null,
    getEnvelopeCacheStats: null,
    applyFilterEnvelope: null,
    applyFilterEnvelopeRelease: null,

    // From voice-pool.js
    initVoicePool: null,
    acquireVoice: null,
    releaseVoice: null,
    getVoicePoolStats: null,
    initBufferPool: null,
    acquireBuffer: null,
    releaseBuffer: null,
    getBufferPoolStats: null,

    // From wavetable.js
    initWavetables: null,
    areWavetablesReady: null,
    getWavetableForFreq: null,
    sampleWavetable: null,
    renderWavetable: null,
    fastSin: null,

    // From note-playback.js
    playNote: null,
    createNoiseSource: null,
    startContinuousNoise: null,
    stopContinuousNoise: null,
    updateContinuousNoise: null,
    restartContinuousNoise: null,
    updateContinuousNoiseFilter: null,
    startSustainedNote: null,
    stopSustainedNote: null,
    startSustainedChord: null,
    stopSustainedChord: null,
    stopAllSustained: null,
    refreshActiveOscillators: null,
    refreshFilter: null,
    highlightNote: null,

    // From lfo-engine.js
    initLFO: null,
    updateLFO: null,
    applyLFOToVoice: null,
    removeLFOFromVoice: null,
    getLFOSettings: null,
    setLFOSettings: null,
    destroyLFO: null,

    // From mod-matrix.js
    modMatrix: null,
    initModMatrix: null,
    destroyModMatrix: null,
    applyModMatrixToVoice: null,
    removeModMatrixFromVoice: null,

    // From instrument-settings.js
    playNoteOnInstrument: null,
    getSettingsForInstrument: null,
    getInstrumentSettings: null,
    saveInstrumentSettings: null,
    loadInstrumentSettings: null
  };

})();
