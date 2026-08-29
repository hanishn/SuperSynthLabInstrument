// Synth Lab - UI State Module
(function() {
  var SL = window.SynthLab;

  var NO_NOTE_FREQ = null;

  // State variables
  var baseOctave = 4;
  var currentNoteDisplay = '';

  // DOM references (populated in init)
  var rootEl, modeEl, waveEl, methodEl, refHzEl, isoLayoutEl, instrumentSelectEl;
  var kbEl, isoEl, seqKeysEl, seqEl, noteReadout, octRange;
  var durPicker, noteMenu, chordMenu;
  var orgFunc, orgDeg, orgProg, orgPal;

  /**
   * Cache all DOM el references
   */
  function cacheElements() {
    rootEl = document.getElementById('rootNote');
    modeEl = document.getElementById('mode');
    waveEl = document.getElementById('waveType');
    methodEl = document.getElementById('method');
    refHzEl = document.getElementById('refHz');
    isoLayoutEl = document.getElementById('isoLayout');
    instrumentSelectEl = document.getElementById('instrumentSelect');
    kbEl = document.getElementById('keyboard');
    isoEl = document.getElementById('isoGrid');
    seqKeysEl = document.getElementById('seqKeys');
    seqEl = document.getElementById('seqGrid');
    noteReadout = document.getElementById('noteReadout');
    octRange = document.getElementById('octRange');
    durPicker = document.getElementById('durationPicker');
    noteMenu = document.getElementById('noteMenu');
    chordMenu = document.getElementById('chordMenu');
    orgFunc = document.getElementById('orgFunction');
    orgDeg = document.getElementById('orgDegree');
    orgProg = document.getElementById('orgProg');
    orgPal = document.getElementById('orgPalette');
  }

  /**
   * Set up octave control buttons
   */
  function setupOctaveControls() {
    // V-03: Guard against missing DOM elements. SSLI does not include
    // #octDown / #octUp (those are SSLU-only controls). Without this
    // guard, a TypeError fires on startup and can break initialization.
    var octDownEl = document.getElementById('octDown');
    var octUpEl = document.getElementById('octUp');

    if (octDownEl) {
      octDownEl.addEventListener('click', function() {
        if (baseOctave > 0) {
          baseOctave--;
          rebuildAll();
        }
      });
    }

    if (octUpEl) {
      octUpEl.addEventListener('click', function() {
        if (baseOctave < 5) {
          baseOctave++;
          rebuildAll();
        }
      });
    }
  }

  /**
   * Rebuild all UI components after octave change
   */
  function rebuildAll() {
    var canBuildKeyboard = kbEl && SL.keyboard && SL.keyboard.buildKeyboard;
    var canBuildIso = isoEl && SL.isomorphic && SL.isomorphic.buildIso;
    var canBuildSeqKeys = seqKeysEl && SL.sequencer && SL.sequencer.buildSeqKeys;
    var canRenderSeqGrid = seqEl && SL.sequencer && SL.sequencer.renderSeqGrid;
    var canBuildChords = chordMenu && SL.chords && SL.chords.buildChords;

    if (canBuildKeyboard) { SL.keyboard.buildKeyboard(); }
    if (canBuildIso) { SL.isomorphic.buildIso(); }
    if (canBuildSeqKeys) { SL.sequencer.buildSeqKeys(); }
    if (canRenderSeqGrid) { SL.sequencer.renderSeqGrid(); }
    if (canBuildChords) { SL.chords.buildChords(); }
  }

  /**
   * Set up scale/mode change listeners
   */
  function setupScaleListeners() {
    if (rootEl) {
      rootEl.addEventListener('change', function() {
        SL.keyboard.buildKeyboard();
        SL.isomorphic.buildIso();
        SL.chords.buildChords();
        if (SL.sequencer && SL.sequencer.refreshSeqScaleIndicators) {
          SL.sequencer.refreshSeqScaleIndicators();
        }
      });
    }

    if (modeEl) {
      modeEl.addEventListener('change', function() {
        SL.keyboard.buildKeyboard();
        SL.isomorphic.buildIso();
        SL.chords.buildChords();
        if (SL.sequencer && SL.sequencer.refreshSeqScaleIndicators) {
          SL.sequencer.refreshSeqScaleIndicators();
        }
      });
    }

    if (isoLayoutEl) {
      isoLayoutEl.addEventListener('change', function() {
        SL.isomorphic.buildIso();
      });
    }
  }

  /**
   * Set up instrument selector change listener
   * Handles switching between 5 independent instruments (4 synth + 1 loop)
   */
  function setupInstrumentSelector() {
    if (instrumentSelectEl) {
    instrumentSelectEl.addEventListener('change', function() {
      var newInst = parseInt(instrumentSelectEl.value);
      var oldInst = SL.audio.getCurrentInstrument();

      if (newInst === oldInst) return;

      // setCurrentInstrument handles save/load internally via loadInstrumentSettings
      // which updates the inline hidden controls. We need to also update visible UI.
      SL.audio.setCurrentInstrument(newInst);

      // Update visible UI controls to reflect new instrument's settings
      updateUIFromInstrument();

      // Update instrument type toggle
      if (mixerModalState && mixerModalState.updateTypeToggleState) {
        mixerModalState.updateTypeToggleState();
      }

      // Load Euclidean settings for new instrument
      if (SL.sequencer && SL.sequencer.loadEucSettingsForInstrument) {
        SL.sequencer.loadEucSettingsForInstrument(newInst);
      }

      // Refresh sequencer for sampler/synth key labels
      if (SL.sequencer && SL.sequencer.refreshSeqScaleIndicators) {
        SL.sequencer.refreshSeqScaleIndicators();
      }

      // Switch keyboard/drum pads based on instrument type
      var newInstType = SL.audio.getInstrumentType ? SL.audio.getInstrumentType(newInst) : 'subtractive';
      if (newInstType === 'sampler' && SL.drumPads) {
        SL.drumPads.buildDrumPads();
      } else if (newInstType === 'loop') {
        // Loop instrument doesn't use keyboard or drum pads
        if (SL.drumPads) SL.drumPads.clearDrumPadMode();
      } else {
        if (SL.drumPads) SL.drumPads.clearDrumPadMode();
        SL.keyboard.buildKeyboard();
      }

      // Refresh chord/drum patterns section based on instrument type
      if (SL.chords && SL.chords.buildChords) {
        SL.chords.buildChords();
      }

      // Sync effects UI to show the new instrument's effects
      if (SL.effectsUI && SL.effectsUI.setSelectedTarget) {
        SL.effectsUI.setSelectedTarget(newInst);
      }

      // Notify other screens of instrument change
      if (SL.state) { SL.state.notify('instrument'); }
    });
    } else {
      // No instrument selector exists on the current shell.
    }
  }

  /**
   * Update all UI controls from current instrument's settings
   * Called when switching instruments to reflect the new instrument's state
   */
  function updateUIFromInstrument() {
    var settings = SL.audio.getInstrumentSettings();
    if (!settings) return;

    // Update oscillator controls (inline)
    [1, 2, 3].forEach(function(n, i) {
      var os = settings.osc[i];
      var wave = document.querySelector('.osc-wave[data-osc="' + n + '"]');
      var oct = document.querySelector('.osc-oct[data-osc="' + n + '"]');
      var det = document.querySelector('.osc-detune[data-osc="' + n + '"]');
      var detVal = document.querySelector('.osc-detune-val[data-osc="' + n + '"]');
      var lvl = document.querySelector('.osc-level[data-osc="' + n + '"]');
      var lvlVal = document.querySelector('.osc-level-val[data-osc="' + n + '"]');

      if (wave) wave.value = os.wave;
      if (oct) oct.value = os.oct.toString();
      if (det) det.value = os.detune;
      if (detVal) detVal.textContent = os.detune;
      if (lvl) lvl.value = os.level;
      if (lvlVal) lvlVal.textContent = os.level;
    });

    // Update ADSR controls (inline)
    var adsrA = document.getElementById('adsrA');
    var adsrD = document.getElementById('adsrD');
    var adsrS = document.getElementById('adsrS');
    var adsrR = document.getElementById('adsrR');
    var valA = document.getElementById('valA');
    var valD = document.getElementById('valD');
    var valS = document.getElementById('valS');
    var valR = document.getElementById('valR');

    if (adsrA) { adsrA.value = settings.adsr.a; if (valA) valA.textContent = formatADSRTime('A', settings.adsr.a) + 'ms'; }
    if (adsrD) { adsrD.value = settings.adsr.d; if (valD) valD.textContent = formatADSRTime('D', settings.adsr.d) + 'ms'; }
    if (adsrS) { adsrS.value = settings.adsr.s; if (valS) valS.textContent = settings.adsr.s + '%'; }
    if (adsrR) { adsrR.value = settings.adsr.r; if (valR) valR.textContent = formatADSRTime('R', settings.adsr.r) + 'ms'; }

    // Update filter controls (inline hidden controls)
    // Note: settings store slider values directly (0-1000 for freq, 0-100 for Q)
    var filterEnabled = document.getElementById('filterEnabled');
    var filterType = document.getElementById('filterType');
    var filterFreq = document.getElementById('filterFreq');
    var filterQ = document.getElementById('filterQ');
    var filterKeyTrack = document.getElementById('filterKeyTrack');
    var filterModel = document.getElementById('filterModel');

    if (filterEnabled) filterEnabled.checked = settings.filter.enabled;
    if (filterType) filterType.value = settings.filter.type;
    if (filterFreq) filterFreq.value = settings.filter.freq;
    if (filterQ) filterQ.value = settings.filter.q;
    if (filterKeyTrack) filterKeyTrack.value = settings.filter.keyTrack;
    if (filterModel) filterModel.value = settings.filter.model;

    // Update filter slope radio
    var slopeRadio = document.querySelector('input[name="filterSlope"][value="' + settings.filter.slope + '"]');
    if (slopeRadio) slopeRadio.checked = true;

    // Update noise controls (inline hidden)
    var noiseType = document.getElementById('noiseType');
    var noiseLevel = document.getElementById('noiseLevel');

    if (noiseType) noiseType.value = settings.noise.type;
    if (noiseLevel) noiseLevel.value = settings.noise.level;

    // Update filter envelope controls (inline hidden)
    var filterEnvEnabled = document.getElementById('filterEnvEnabled');
    var filterEnvAmount = document.getElementById('filterEnvAmount');
    var filterEnvA = document.getElementById('filterEnvA');
    var filterEnvD = document.getElementById('filterEnvD');
    var filterEnvS = document.getElementById('filterEnvS');
    var filterEnvR = document.getElementById('filterEnvR');
    var filterEnvLinkToAmp = document.getElementById('filterEnvLinkToAmp');

    if (filterEnvEnabled) filterEnvEnabled.checked = settings.filterEnv.enabled;
    if (filterEnvAmount) filterEnvAmount.value = settings.filterEnv.amount;
    if (filterEnvA) filterEnvA.value = settings.filterEnv.a;
    if (filterEnvD) filterEnvD.value = settings.filterEnv.d;
    if (filterEnvS) filterEnvS.value = settings.filterEnv.s;
    if (filterEnvR) filterEnvR.value = settings.filterEnv.r;
    if (filterEnvLinkToAmp) filterEnvLinkToAmp.checked = settings.filterEnv.link;

    // Refresh audio engine with new settings
    if (SL.audio && SL.audio.refreshActiveOscillators) {
      SL.audio.refreshActiveOscillators();
    }

  }

  /**
   * Format ADSR time value for display (with logarithmic conversion)
   * @param {string} param - 'A', 'D', or 'R'
   * @param {number} sliderValue - Raw slider value
   * @returns {string} Formatted time value
   */
  function formatADSRTime(param, sliderValue) {
    if (!SL.audio || !SL.audio.sliderToTime) {
      return Math.round(sliderValue);  // Fallback to raw value
    }

    var timeMs;
    if (param === 'A' || param === 'D') {
      timeMs = SL.audio.sliderToTime(sliderValue, 500, 500);
    } else if (param === 'R') {
      timeMs = SL.audio.sliderToTime(sliderValue, 1000, 1000);
    } else {
      return Math.round(sliderValue);  // Sustain stays as-is
    }

    return Math.round(timeMs);
  }

  /**
   * Format filter envelope ADSR time value for display (with logarithmic conversion)
   * Filter envelope has larger ranges: A/D=0-2000ms, R=0-3000ms
   * @param {string} param - 'A', 'D', or 'R'
   * @param {number} sliderValue - Raw slider value
   * @returns {string} Formatted time value
   */
  function formatFilterEnvTime(param, sliderValue) {
    if (!SL.audio || !SL.audio.sliderToTime) {
      return Math.round(sliderValue);  // Fallback to raw value
    }

    var timeMs;
    if (param === 'A' || param === 'D') {
      timeMs = SL.audio.sliderToTime(sliderValue, 2000, 2000);
    } else if (param === 'R') {
      timeMs = SL.audio.sliderToTime(sliderValue, 3000, 3000);
    } else {
      return Math.round(sliderValue);  // Sustain stays as-is
    }

    return Math.round(timeMs);
  }

  /**
   * Set up ADSR envelope slider listeners
   */
  function setupADSRListeners() {
    ['A', 'D', 'S', 'R'].forEach(function(p) {
      var sl = document.getElementById('adsr' + p);
      var val = document.getElementById('val' + p);
      if (sl && val) {
        sl.addEventListener('input', function() {
          if (val) {
            if (p === 'S') {
              val.textContent = sl.value + '%';  // Sustain is percentage
            } else {
              val.textContent = formatADSRTime(p, parseFloat(sl.value)) + 'ms';
            }
          }
        });
      }
    });
  }

  /**
   * Set up oscillator mixer slider listeners
   * Also triggers audio refresh when controls change
   */
  function setupOscMixerListeners() {
    [1, 2, 3].forEach(function(n) {
      var wave = document.querySelector('.osc-wave[data-osc="' + n + '"]');
      var oct = document.querySelector('.osc-oct[data-osc="' + n + '"]');
      var det = document.querySelector('.osc-detune[data-osc="' + n + '"]');
      var detVal = document.querySelector('.osc-detune-val[data-osc="' + n + '"]');
      var lvl = document.querySelector('.osc-level[data-osc="' + n + '"]');
      var lvlVal = document.querySelector('.osc-level-val[data-osc="' + n + '"]');

      // Wave and octave changes trigger audio refresh
      if (wave) wave.addEventListener('change', function() {
        if (SL.audio && SL.audio.refreshActiveOscillators) SL.audio.refreshActiveOscillators();
      });
      if (oct) oct.addEventListener('change', function() {
        if (SL.audio && SL.audio.refreshActiveOscillators) SL.audio.refreshActiveOscillators();
      });

      // Detune and level update display and trigger audio refresh
      if (det) {
        det.addEventListener('input', function() {
          if (detVal) { detVal.textContent = det.value; }
          if (SL.audio && SL.audio.refreshActiveOscillators) SL.audio.refreshActiveOscillators();
        });
      }
      if (lvl) {
        lvl.addEventListener('input', function() {
          if (lvlVal) { lvlVal.textContent = lvl.value; }
          if (SL.audio && SL.audio.refreshActiveOscillators) SL.audio.refreshActiveOscillators();
        });
      }
    });
  }

  /**
   * Set up sequencer transport controls
   * Note: These are also set up in sequencer.js setupEventListeners()
   * This is a fallback if sequencer doesn't set them up
   */
  function setupSequencerControls() {
    // Transport controls are handled by sequencer.setupEventListeners()
    // This function is kept for potential future use
  }

  /**
   * Set up global document event listeners
   */
  function setupGlobalListeners() {
    // Menu dismissal is handled by sequencer.setupEventListeners()

    // Stop all sustained notes on mouseup, BUT NOT when clicking in the mixer modal
    document.addEventListener('mouseup', function(e) {
      // Don't stop notes if clicking inside the mixer modal
      var mixerModal = document.getElementById('mixerModal');
      var isInsideMixer = (mixerModal && mixerModal.contains(e.target));
      if (!isInsideMixer) {
        if (SL.audio && SL.audio.stopAllSustained) {
          SL.audio.stopAllSustained();
        }
      }
    });
  }

  /**
   * Set up sequencer grid scroll and drag/drop
   * Note: These are also set up in sequencer.js setupEventListeners()
   */
  function setupSeqGridListeners() {
    // Scroll and drag/drop are handled by sequencer.setupEventListeners()
    // This function is kept for potential future use
  }

  // State returned by mixer modal setup (for updateTypeToggleState access)
  var mixerModalState = null;

  /**
   * Set up Clear Instrument / Clear All buttons
   */
  function setupClearButtons() {
    var clearBtn = document.getElementById('clearInstBtn');
    var clearAllBtn = document.getElementById('clearAllInstBtn');

    if (clearBtn) {
      clearBtn.addEventListener('click', function() {
        var instId = SL.audio.getCurrentInstrument();
        if (SL.audio.clearInstrument) {
          SL.audio.clearInstrument(instId);
        }
      });
    }

    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', function() {
        if (SL.audio.clearAllInstruments) {
          SL.audio.clearAllInstruments();
        }
      });
    }
  }

  /**
   * Set up humanization controls (4 sliders: velocity, timing, adsr, drift)
   */
  function setupHumanizationControls() {
    var sliders = [
      { id: 'humVelocity', key: 'velocity', valId: 'humVelocityVal' },
      { id: 'humTiming', key: 'timing', valId: 'humTimingVal' },
      { id: 'humAdsr', key: 'adsr', valId: 'humAdsrVal' },
      { id: 'humDrift', key: 'drift', valId: 'humDriftVal' }
    ];
    sliders.forEach(function(s) {
      var el = document.getElementById(s.id);
      var valEl = document.getElementById(s.valId);
      if (el) {
        el.addEventListener('input', function() {
          var val = parseInt(this.value);
          if (valEl) valEl.textContent = val;
          var instruments = SL.audio.getInstruments();
          var currentInst = SL.audio.getCurrentInstrument();
          if (instruments && instruments[currentInst]) {
            if (typeof instruments[currentInst].settings.humanization !== 'object') {
              instruments[currentInst].settings.humanization = { velocity: 0, timing: 0, adsr: 0, drift: 0 };
            }
            instruments[currentInst].settings.humanization[s.key] = val;
          }
        });
      }
    });

    var strumEl = document.getElementById('humStrum');
    var strumValEl = document.getElementById('humStrumVal');
    if (strumEl) {
      strumEl.addEventListener('input', function() {
        var val = parseInt(this.value);
        if (strumValEl) strumValEl.textContent = val;
        var instruments = SL.audio.getInstruments();
        var currentInst = SL.audio.getCurrentInstrument();
        if (instruments && instruments[currentInst]) {
          instruments[currentInst].settings.strum = val;
        }
      });
    }

    var strumDirEl = document.getElementById('strumDir');
    if (strumDirEl) {
      strumDirEl.addEventListener('change', function() {
        var instruments = SL.audio.getInstruments();
        var currentInst = SL.audio.getCurrentInstrument();
        if (instruments && instruments[currentInst]) {
          instruments[currentInst].settings.strumDir = this.value;
        }
      });
    }

    var strumRepeatEl = document.getElementById('strumRepeat');
    var strumRepeatValEl = document.getElementById('strumRepeatVal');
    if (strumRepeatEl) {
      strumRepeatEl.addEventListener('input', function() {
        var val = parseInt(this.value);
        if (strumRepeatValEl) strumRepeatValEl.textContent = val;
        var instruments = SL.audio.getInstruments();
        var currentInst = SL.audio.getCurrentInstrument();
        if (instruments && instruments[currentInst]) {
          instruments[currentInst].settings.strumRepeat = val;
        }
      });
    }
  }

  /**
   * Set up latency mode dropdown
   * Reads saved value from localStorage on load, saves on change.
   * Hot-switches the AudioContext without page reload.
   */
  function setupLatencyControl() {
    var select = document.getElementById('latencyMode');
    if (select) {
      // Sync dropdown with current in-memory mode
      if (SL.audio && SL.audio.getLatencyMode) {
        select.value = SL.audio.getLatencyMode();
      }

      select.addEventListener('change', function() {
        if (SL.audio && SL.audio.switchLatencyMode) {
          SL.audio.switchLatencyMode(this.value);
        } else if (SL.audio && SL.audio.setLatencyMode) {
          SL.audio.setLatencyMode(this.value);
        }
      });
    }
  }

  /**
   * Set up per-instrument volume slider
   */
  function setupVolumeSlider() {
    var volSlider = document.getElementById('instrumentVolume');
    if (volSlider) {
      volSlider.addEventListener('input', function() {
        var val = parseFloat(this.value);
        var valSpan = document.getElementById('instrumentVolumeVal');
        if (valSpan) valSpan.textContent = val;
        var instId = SL.audio.getCurrentInstrument();
        if (SL.audio.setInstrumentVolume) SL.audio.setInstrumentVolume(instId, val);
        if (SL.state) { SL.state.notify('volume'); }
      });
    }
  }

  /**
   * Main initialization function
   * Called when DOM is ready
   */
  function init() {
    // Cache all DOM element references
    cacheElements();

    // Set up all event listeners
    setupOctaveControls();
    setupScaleListeners();
    setupInstrumentSelector();
    setupADSRListeners();
    setupOscMixerListeners();
    mixerModalState = SL.mixerModal && SL.mixerModal.setup ? SL.mixerModal.setup() : null;
    if (SL.presetUI && SL.presetUI.setup) { SL.presetUI.setup(); }
    setupSequencerControls();
    setupGlobalListeners();
    setupSeqGridListeners();
    setupClearButtons();
    setupVolumeSlider();
    setupHumanizationControls();
    setupLatencyControl();

    // Build all UI components
    var canBuildKeyboard = kbEl && SL.keyboard && SL.keyboard.buildKeyboard;
    var canBuildIso = isoEl && SL.isomorphic && SL.isomorphic.buildIso;
    var canBuildSeqKeys = seqKeysEl && SL.sequencer && SL.sequencer.buildSeqKeys;
    var canRenderSeqGrid = seqEl && SL.sequencer && SL.sequencer.renderSeqGrid;
    var canSetupSeqEvents = seqEl && SL.sequencer && SL.sequencer.setupEventListeners;
    var canBuildChords = chordMenu && SL.chords && SL.chords.buildChords;

    if (canBuildKeyboard) { SL.keyboard.buildKeyboard(); }
    if (canBuildIso) { SL.isomorphic.buildIso(); }
    if (canBuildSeqKeys) { SL.sequencer.buildSeqKeys(); }
    if (canRenderSeqGrid) { SL.sequencer.renderSeqGrid(); }
    if (canSetupSeqEvents) { SL.sequencer.setupEventListeners(); }
    if (canBuildChords) { SL.chords.buildChords(); }

    // Initialize effect chain (requires audio context to be ready)
    // This will be called on first user interaction when audio context is created
    if (SL.audio && SL.audio.initEffectChain) {
      // Defer until audio context exists
      var originalGetCtx = SL.audio.getCtx;
      if (originalGetCtx) {
        var doInitEffects = function() {
          if (!SL.audio.effectChain) {
            SL.audio.initEffectChain();
            if (SL.effectsUI && SL.effectsUI.init) {
              SL.effectsUI.init();
            }
          }
        };
        var checkAndInitEffects = function() {
          var ctx = originalGetCtx();
          if (ctx && !SL.audio.effectChain) {
            if (ctx.state === 'running') {
              doInitEffects();
            } else {
              ctx.resume().then(function() {
                doInitEffects();
              });
            }
          }
        };
        // Do NOT create AudioContext eagerly - wait for user gesture
        // At high sample rates (192kHz), contexts created without user gesture
        // may not properly connect to audio output even after resume()
        document.addEventListener('mousedown', checkAndInitEffects, { once: true });
        document.addEventListener('keydown', checkAndInitEffects, { once: true });
      }
    }

    // Set initial scroll position for sequencer
    var seqWrapper = document.querySelector('.seq-wrapper');
    if (seqWrapper) { seqWrapper.scrollTop = 216; }

    // Initial note readout
    if (noteReadout) { noteReadout.textContent = SL.t('ui.em_dash'); }

    // Wrap classic screen DOM into quad layout
    _wrapClassicInQuads();
  }

  /**
   * Wrap the classic screen's existing DOM structure into quad containers.
   * Called once after init to restructure layout without breaking event wiring.
   */
  function _wrapClassicInQuads() {
    var classicEl = document.getElementById('screen-classic');
    if (classicEl && SL.quad) {
      var containerEl = classicEl.querySelector('.container');
      if (containerEl) {

    // Collect existing sections before moving them
    var headerEl = containerEl.querySelector('.header');
    var controlsEl = containerEl.querySelector('.controls');
    var kbIsoRow = containerEl.querySelector('.kb-iso-row');
    var adsrPanel = containerEl.querySelector('.adsr-panel');
    var oscMixer = containerEl.querySelector('.osc-mixer');
    var filterInline = containerEl.querySelector('.filter-inline');
    var noiseInline = containerEl.querySelector('.noise-inline');
    var filterEnvInline = containerEl.querySelector('.filter-env-inline');
    var stretchPanel = document.getElementById('stretchPanel');

    // Sequencer <details> is a sibling of .container inside #screen-classic
    var seqDetails = classicEl.querySelectorAll('details.classic-collapse');
    var seqCollapse = null;
    for (var di = 0; di < seqDetails.length; di++) {
      var summary = seqDetails[di].querySelector('summary');
      if (summary && summary.textContent.indexOf('Sequencer') >= 0) {
        seqCollapse = seqDetails[di];
        break;
      }
    }

    // Create quad wrapper
    var wrapper = SL.quad.createWrapper('classic');

    // Q1: Keyboard + main interaction
    var q1 = SL.quad.createQuad('classic', 0);
    if (kbIsoRow) { q1.appendChild(kbIsoRow); }

    // Q2: Controls (root, scale, instrument, ADSR, osc mixer, header)
    var q2 = SL.quad.createQuad('classic', 1);
    if (headerEl) { q2.appendChild(headerEl); }
    if (controlsEl) { q2.appendChild(controlsEl); }
    if (stretchPanel) { q2.appendChild(stretchPanel); }
    if (adsrPanel) { q2.appendChild(adsrPanel); }
    if (oscMixer) { q2.appendChild(oscMixer); }
    // Hidden inline controls must stay accessible
    if (filterInline) { q2.appendChild(filterInline); }
    if (noiseInline) { q2.appendChild(noiseInline); }
    if (filterEnvInline) { q2.appendChild(filterEnvInline); }

    // Q3: Sequencer
    var q3 = SL.quad.createQuad('classic', 2);
    if (seqCollapse) {
      q3.appendChild(seqCollapse);
    }

    // Assemble
    wrapper.appendChild(q1);
    wrapper.appendChild(q2);
    wrapper.appendChild(q3);
    containerEl.appendChild(wrapper);

    // Register and activate (classic is always the default screen)
    SL.quad.register('classic', { quads: [q1, q2, q3], labels: ['Keyboard', 'Controls', 'Sequencer'] });
    SL.quad.activate('classic');
      } // end if (containerEl)
    } // end if (classicEl && SL.quad)
  }

  /**
   * Update the key-tracked cutoff frequency display
   * Called when a note starts playing to show the actual filter cutoff being used
   * @param {number|null} noteFreq - Frequency of the note being played, or null to clear
   */
  function updateKeyTrackedFreqDisplay(noteFreq) {
    var display = document.getElementById('filterKeyTrackedFreq-val-modal');
    if (display) {
      if (noteFreq === NO_NOTE_FREQ) {
        // Don't clear immediately - leave last value or show base cutoff
        var filterSettingsNull = SL.audio && SL.audio.getFilterSettings ? SL.audio.getFilterSettings() : null;
        if (filterSettingsNull && filterSettingsNull.keyTrack > 0) {
          // Show that it's waiting for a note
          display.textContent = SL.t('ui.label.play_a_note');
        } else {
          // No key tracking, show same as cutoff
          if (filterSettingsNull) {
            if (filterSettingsNull.frequency >= 1000) {
              display.textContent = (filterSettingsNull.frequency / 1000).toFixed(2) + ' kHz';
            } else {
              display.textContent = Math.round(filterSettingsNull.frequency) + ' Hz';
            }
          } else {
            display.textContent = '--';
          }
        }
      } else {
        // Get current filter settings
        var filterSettings = SL.audio && SL.audio.getFilterSettings ? SL.audio.getFilterSettings() : null;
        if (!filterSettings) {
          display.textContent = '--';
        } else {
          // Calculate the key-tracked cutoff frequency
          var keyTrackedFreq = SL.audio && SL.audio.calcKeyTrackedFreq
            ? SL.audio.calcKeyTrackedFreq(filterSettings.frequency, noteFreq, filterSettings.keyTrack)
            : filterSettings.frequency;

          // Format the display
          if (keyTrackedFreq >= 1000) {
            display.textContent = (keyTrackedFreq / 1000).toFixed(2) + ' kHz';
          } else {
            display.textContent = Math.round(keyTrackedFreq) + ' Hz';
          }
        }
      }
    }
  }

  // ============================================================
  // Undo System (Fix 25)
  // ============================================================

  var UNDO_MAX = 20;
  var _undoStack = [];
  var _undoBtn = null;

  function _createUndoBtn() {
    if (!_undoBtn) {
    _undoBtn = document.createElement('button');
    _undoBtn.className = 'ssl-undo-btn';
    _undoBtn.title = SL.t('ui.undo_title');
    _undoBtn.setAttribute('aria-label', 'Undo');
    _undoBtn.innerHTML = '&#x21A9;';
    _undoBtn.disabled = true;
    _undoBtn.addEventListener('click', undoAction);
    document.body.appendChild(_undoBtn);

    document.addEventListener('keydown', function(e) {
      var isUndoKey = (e.ctrlKey || e.metaKey) && e.key === 'z';
      var isUndoShortcut = isUndoKey && !e.shiftKey;
      if (isUndoShortcut) {
        e.preventDefault();
        undoAction();
      }
    });
    } // end if (!_undoBtn)
  }

  function pushUndo(entry) {
    // entry = { type: 'preset'|'seqNote', data: {...} }
    _undoStack.push(entry);
    if (_undoStack.length > UNDO_MAX) {
      _undoStack.shift();
    }
    if (_undoBtn) {
      _undoBtn.disabled = false;
    }
  }

  function undoAction() {
    if (_undoStack.length > 0) {
    var entry = _undoStack.pop();

    if (entry.type === 'preset' && entry.data) {
      // Restore previous instrument settings
      if (SL.audio && SL.audio.getInstruments) {
        var insts = SL.audio.getInstruments();
        var instIdx = entry.data.instrumentIndex || 0;
        if (insts[instIdx] && entry.data.settings) {
          insts[instIdx].settings = entry.data.settings;
        }
      }
      if (SL.state) {
        SL.state.notify('instrument');
      }
    } else if (entry.type === 'seqNote' && entry.data) {
      // Restore sequencer note state
      if (SL.sequencer && SL.sequencer.setGrid) {
        SL.sequencer.setGrid(entry.data.grid);
      }
      if (SL.state) {
        SL.state.notify('sequencer');
      }
    }

    if (_undoBtn) {
      _undoBtn.disabled = (_undoStack.length === 0);
    }
    } // end if (_undoStack.length > 0)
  }

  // ============================================================
  // Reference Tone (Play A4) Toggle
  // ============================================================
  var _refToneOsc = null;
  var _refToneGain = null;
  var _refToneBtn = null;

  function _createRefToneBtn() {
    if (refHzEl && refHzEl.parentNode) {
      _refToneBtn = document.createElement('button');
      _refToneBtn.className = 'rhy-scr-btn';
      _refToneBtn.textContent = SL.t('sound_screen.play_ref_tone');
      _refToneBtn.title = SL.t('ui.ref_tone_title');
      _refToneBtn.style.cssText = 'margin-left:6px;padding:2px 8px;font-size:11px;';
      _refToneBtn.addEventListener('click', function() {
        _toggleRefTone();
      });
      refHzEl.parentNode.insertBefore(_refToneBtn, refHzEl.nextSibling);
    }
  }

  function _toggleRefTone() {
    if (_refToneOsc) {
      _stopRefTone();
    } else {
      var ctx = SL.audio && SL.audio.getCtx ? SL.audio.getCtx() : null;
      if (ctx) {
        var freq = parseFloat(refHzEl.value) || 440;
        _refToneGain = ctx.createGain();
        _refToneGain.gain.value = 0.15;
        _refToneGain.connect(ctx.destination);
        _refToneOsc = ctx.createOscillator();
        _refToneOsc.type = 'sine';
        _refToneOsc.frequency.value = freq;
        _refToneOsc.connect(_refToneGain);
        _refToneOsc.start();
        if (_refToneBtn) {
          _refToneBtn.classList.add('active');
          _refToneBtn.textContent = SL.t('sound_screen.stop_ref_tone');
        }
      }
    }
  }

  function _stopRefTone() {
    if (_refToneOsc) {
      _refToneOsc.stop();
      _refToneOsc.disconnect();
      _refToneOsc = null;
    }
    if (_refToneGain) {
      _refToneGain.disconnect();
      _refToneGain = null;
    }
    if (_refToneBtn) {
      _refToneBtn.classList.remove('active');
      _refToneBtn.textContent = SL.t('sound_screen.play_ref_tone');
    }
  }

  // Create undo button on init
  var _origInit = init;
  init = function() {
    _origInit();
    _createUndoBtn();
    _createRefToneBtn();
  };

  // Export to SynthLab namespace
  SL.ui = {
    init: init,
    getBaseOctave: function() { return baseOctave; },
    setBaseOctave: function(v) { baseOctave = v; },
    getCurrentNoteDisplay: function() { return currentNoteDisplay; },
    setCurrentNoteDisplay: function(v) { currentNoteDisplay = v; },
    // DOM element getters for other modules
    getElements: function() {
      return {
        rootEl: rootEl, modeEl: modeEl, waveEl: waveEl, methodEl: methodEl, refHzEl: refHzEl, isoLayoutEl: isoLayoutEl,
        kbEl: kbEl, isoEl: isoEl, seqKeysEl: seqKeysEl, seqEl: seqEl, noteReadout: noteReadout, octRange: octRange,
        durPicker: durPicker, noteMenu: noteMenu, chordMenu: chordMenu,
        orgFunc: orgFunc, orgDeg: orgDeg, orgProg: orgProg, orgPal: orgPal
      };
    },
    rebuildAll: rebuildAll,
    updateKeyTrackedFreqDisplay: updateKeyTrackedFreqDisplay,
    updateUIFromInstrument: updateUIFromInstrument,
    formatADSRTime: formatADSRTime,
    formatFilterEnvTime: formatFilterEnvTime,
    pushUndo: pushUndo,
    undoAction: undoAction
  };

  // Main entry point
  SL.init = init;
})();
