// SSLI Screen: Sound — Engine, category, preset selection + effects presets
// ES5 compatible (var, no arrow functions, no template literals)

(function() {
  'use strict';

  var SL = window.SynthLab;

  // ============================================================
  // Constants
  // ============================================================

  var TEST_TONE_MIDI = 60;  // Middle C
  var TEST_TONE_VELOCITY = 80;
  var TEST_TONE_DURATION_MS = 1000;
  var DEFAULT_VOLUME = 80;
  var VOLUME_MIN = 0;
  var VOLUME_MAX = 100;

  // FX preset state — library lives in ssli-screen-effects.js (SL.fxPresetLib)
  var _FX_CAT_KEY = {
    'Clean / Natural': 'clean_natural',
    'Ambient / Atmospheric': 'ambient_atmospheric',
    'Vintage / Warm': 'vintage_warm',
    'Aggressive / Distorted': 'aggressive_distorted',
    'Rhythmic / Movement': 'rhythmic_movement',
    'Creative / Experimental': 'creative_experimental',
    'Performance / Live': 'performance_live'
  };
  var _PRESET_CAT_KEY = {
    'Bass': 'bass', 'Brass': 'brass', 'Drums': 'drums', 'FX': 'fx',
    'Keys': 'keys', 'Leads': 'leads', 'Misc': 'misc', 'Organ': 'organ',
    'Pads': 'pads', 'Plucks': 'plucks', 'Strings': 'strings',
    'Woodwinds': 'woodwinds', 'Cinematic': 'cinematic', 'Lofi': 'lofi',
    'EDM': 'edm', 'World': 'world', 'Chip/Retro': 'chip_retro',
    'Ambient': 'ambient', 'Analog Classics': 'analog_classics',
    'Sci-Fi': 'sci_fi', 'Noise/Industrial': 'noise_industrial',
    'Textural': 'textural', 'All': 'all'
  };
  var _FX_PRESET_KEY = {
    'Dry': 'dry', 'Gentle Warmth': 'gentle_warmth', 'Studio Polish': 'studio_polish',
    'Clean Shimmer': 'clean_shimmer', 'Deep Space': 'deep_space', 'Cathedral': 'cathedral',
    'Ethereal Pad': 'ethereal_pad', 'Frozen': 'frozen', 'Underwater': 'underwater',
    'Misty': 'misty', 'Warm Tape': 'warm_tape', 'Vinyl': 'vinyl',
    '70s Electric Piano': '70s_electric_piano', 'Cassette Deck': 'cassette_deck',
    'Retro Synth': 'retro_synth', 'Crunch': 'crunch', 'Fuzz Box': 'fuzz_box',
    'Bitcrushed': 'bitcrushed', 'Industrial': 'industrial', 'Acid Squelch': 'acid_squelch',
    'Tremolo Pulse': 'tremolo_pulse', 'Auto-Pan': 'auto_pan',
    'Sidechain Pump': 'sidechain_pump', 'Gated Verb': 'gated_verb',
    'Choppy Delay': 'choppy_delay', 'Ring Modulated': 'ring_modulated',
    'Pitch Shift Up': 'pitch_shift_up', 'Detuned': 'detuned', 'Vocoded': 'vocoded',
    'Glitch': 'glitch', 'Stage Keys': 'stage_keys', 'Lead Solo': 'lead_solo',
    'Big Pad': 'big_pad', 'Thick Bass': 'thick_bass', 'Pluck': 'pluck'
  };

  var _fxCategorySelect = null;
  var _fxPresetSelect = null;
  var _activeFxCategory = null;
  var _activeFxPresetId = null;

  // ============================================================
  // State
  // ============================================================

  var _initialized = false;
  var _active = false;
  var _screenEl = null;
  var _engineSelect = null;
  var _categorySelect = null;
  var _presetSelect = null;
  var _cachedPresets = [];    // full preset list for current engine/category
  var _volumeSlider = null;
  var _volumeVal = null;
  var _testToneTimer = null;
  var _filterCutoffSlider = null;
  var _filterCutoffVal = null;
  var _filterResoSlider = null;
  var _filterResoVal = null;

  // DOM refs for language-change rebuilds
  var _presetSectionTitle = null;
  var _engineLabel = null;
  var _catLabel = null;
  var _presetLabel = null;
  var _surpriseBtn = null;
  var _filterSectionTitle = null;
  var _cutoffLabel = null;
  var _resoLabel = null;
  var _presetsSectionTitle = null;
  var _fxCatLabel = null;
  var _outSectionTitle = null;
  var _volLabel = null;
  var _velLabel = null;
  var _velSelect = null;
  var _touchVelCb = null;
  var _touchVelLabel = null;
  var _touchSensSlider = null;
  var _touchSensVal = null;
  var _touchSensLabel = null;
  var _touchVelMinSlider = null;
  var _touchVelMinVal = null;
  var _touchVelMinLabel = null;
  var _touchVelMaxSlider = null;
  var _touchVelMaxVal = null;
  var _touchVelMaxLabel = null;

  // ============================================================
  // Engine / Category / Preset Lists
  // ============================================================

  function _getEngineList() {
    // Build list from SL.presets if available
    if (SL.presets && SL.presets.getEngines) {
      return SL.presets.getEngines();
    }
    // Fallback list
    return [
      'Subtractive', 'FM', 'Physical', 'Additive', 'Granular',
      'Vocoder', 'Wavefolder', 'Formant', 'Modal', 'RingMod',
      'Chord', 'SuperWave', 'Wavetable', 'PhaseDist', 'Chip',
      'Bytebeat', 'Vector', 'DrumSyn', 'Pulsar', 'Reed'
    ];
  }

  function _getCategoriesForEngine(engine) {
    if (SL.presets && SL.presets.getCategoriesForEngine) {
      return SL.presets.getCategoriesForEngine(engine);
    }
    return ['All'];
  }

  function _getPresetsForEngineCategory(engine, category) {
    if (SL.presets && SL.presets.getPresetsForEngineCategory) {
      return SL.presets.getPresetsForEngineCategory(engine, category);
    }
    return [];
  }

  // Map engine type keys to their SL module names for re-initialization
  var ENGINE_TYPE_TO_MODULE = {
    'fm': 'fm', 'physical': 'physical', 'additive': 'additive',
    'granular': 'granular', 'vocoderSynth': 'vocoderSynth',
    'wavefolder': 'wavefolder', 'formant': 'formant', 'modal': 'modal',
    'ringmod': 'ringmod', 'chord': 'chord', 'superwave': 'superwave',
    'wavetable': 'wavetableSynth', 'phasedist': 'phasedist',
    'chip': 'chip', 'bytebeat': 'bytebeat', 'vector': 'vector',
    'drumsyn': 'drumsyn', 'pulsar': 'pulsar', 'reed': 'reed'
  };

  function _ensureEngineReady(engineType) {
    // Subtractive uses the built-in oscillator path, no module to init
    if (engineType === 'subtractive') {
      return;
    }
    var moduleName = ENGINE_TYPE_TO_MODULE[engineType];
    if (!moduleName) {
      return;
    }
    var engine = SL[moduleName];
    if (!engine) {
      return;
    }
    // If the engine has an isReady() check and it's not ready, re-init
    if (engine.isReady && !engine.isReady()) {
      if (engine.init) {
        engine.init();
      }
    }
    // If no isReady check, try init if it hasn't been called
    // (some engines set internal flags on init)
    if (!engine.isReady && engine.init && !engine._initialized) {
      engine.init();
    }
  }

  function _applyPreset(presetObj) {
    if (SL.presets && SL.presets.apply) {
      // Stop any currently playing notes before switching engine/preset.
      if (SL.audio && SL.audio.stopAllSustained) {
        SL.audio.stopAllSustained();
      }
      // Ensure AudioContext is running before applying preset
      if (SL.audio && SL.audio.getCtx) {
        var ctx = SL.audio.getCtx();
        if (ctx && ctx.state === 'suspended') {
          ctx.resume();
        }
      }
      // Tag preset with engine type from dropdown so apply() routes correctly
      var engineName = _engineSelect ? _engineSelect.value : 'Subtractive';
      var engineType = SL.presets.engineNameToType ? SL.presets.engineNameToType(engineName) : 'subtractive';
      presetObj.engine = engineType;
      SL.presets.apply(presetObj);
      SL.state.notify('preset');
    }
  }

  // V-10: Engine icon map — now in constants.js as SL.ENGINE_ICONS
  var ENGINE_ICONS = SL.ENGINE_ICONS;

  // ============================================================
  // Populate Dropdowns
  // ============================================================

  function _populateEngines() {
    if (!_engineSelect) {
      return;
    }
    _engineSelect.innerHTML = '';
    var engines = _getEngineList();
    for (var i = 0; i < engines.length; i++) {
      var opt = document.createElement('option');
      opt.value = engines[i];
      var icon = ENGINE_ICONS[engines[i]] || '';
      var engineLabel = SL.t('engine.' + engines[i].toLowerCase(), engines[i]);
      var displayName = icon ? (icon + ' ' + engineLabel) : engineLabel;
      opt.textContent = displayName;
      _engineSelect.appendChild(opt);
    }
  }

  var PREFERRED_DEFAULT_CATEGORY = 'Keys';

  function _populateCategories() {
    if (!_categorySelect || !_engineSelect) {
      return;
    }
    _categorySelect.innerHTML = '';
    var engine = _engineSelect.value;
    var cats = _getCategoriesForEngine(engine);
    var preferredIdx = 0;
    for (var i = 0; i < cats.length; i++) {
      var opt = document.createElement('option');
      opt.value = cats[i];
      var catKey = _PRESET_CAT_KEY[cats[i]] || '';
      opt.textContent = catKey ? SL.t('preset_category.' + catKey, cats[i]) : cats[i];
      _categorySelect.appendChild(opt);
      if (cats[i] === PREFERRED_DEFAULT_CATEGORY) {
        preferredIdx = i;
      }
    }
    if (preferredIdx > 0) {
      _categorySelect.selectedIndex = preferredIdx;
    }
  }

  function _populatePresets() {
    if (!_presetSelect || !_engineSelect || !_categorySelect) {
      return;
    }
    var engine = _engineSelect.value;
    var category = _categorySelect.value;
    _cachedPresets = _getPresetsForEngineCategory(engine, category);

    _filterAndDisplayPresets('');

    // Auto-apply first preset
    if (_cachedPresets.length > 0) {
      _applyPreset(_cachedPresets[0]);
    }
  }

  /**
   * Filter the cached presets by a search query and rebuild the dropdown.
   * @param {string} query - Search text (case-insensitive substring match)
   */
  function _filterAndDisplayPresets(query) {
    if (!_presetSelect) {
      return;
    }
    _presetSelect.innerHTML = '';
    var lowerQuery = (query || '').toLowerCase();

    for (var i = 0; i < _cachedPresets.length; i++) {
      var name = _cachedPresets[i].name || ('Preset ' + (i + 1));
      if (lowerQuery.length === 0 || name.toLowerCase().indexOf(lowerQuery) >= 0) {
        var opt = document.createElement('option');
        opt.value = i;
        opt.textContent = name;
        _presetSelect.appendChild(opt);
      }
    }
  }

  function _onEngineChange() {
    _populateCategories();
    _populatePresets();
  }

  function _onCategoryChange() {
    _populatePresets();
  }

  function _onPresetChange() {
    if (!_presetSelect) {
      return;
    }
    var idx = parseInt(_presetSelect.value, 10);
    if (_cachedPresets[idx]) {
      _applyPreset(_cachedPresets[idx]);
    }
  }

  /**
   * F3-07: Pick a random engine, random category, random preset and apply it.
   * Updates the dropdowns so the user can see what was picked.
   */
  function _onSurpriseMe() {
    var engines = _getEngineList();
    if (engines.length === 0) {
      return;
    }
    var randomEngineIdx = Math.floor(Math.random() * engines.length);
    var randomEngine = engines[randomEngineIdx];

    // Set engine dropdown
    if (_engineSelect) {
      _engineSelect.value = randomEngine;
    }

    // Get categories for this engine and pick one
    var categories = _getCategoriesForEngine(randomEngine);
    var randomCatIdx = Math.floor(Math.random() * categories.length);
    var randomCategory = categories[randomCatIdx];

    // Set category dropdown
    if (_categorySelect) {
      _populateCategories();
      _categorySelect.value = randomCategory;
    }

    // Get presets for this engine+category and pick one
    var presets = _getPresetsForEngineCategory(randomEngine, randomCategory);
    if (presets.length === 0) {
      return;
    }
    var randomPresetIdx = Math.floor(Math.random() * presets.length);
    var randomPreset = presets[randomPresetIdx];

    // Update cached presets and preset dropdown
    _cachedPresets = presets;
    _filterAndDisplayPresets('');
    if (_presetSelect) {
      _presetSelect.value = String(randomPresetIdx);
    }

    // Tag with the randomly-selected engine type before applying
    var randomEngineType = SL.presets.engineNameToType ? SL.presets.engineNameToType(randomEngine) : 'subtractive';
    randomPreset.engine = randomEngineType;

    // Apply the preset
    _applyPreset(randomPreset);
  }

  // ============================================================
  // Volume
  // ============================================================

  function _onVolumeChange() {
    if (!_volumeSlider || !_volumeVal) {
      return;
    }
    var val = parseInt(_volumeSlider.value, 10);
    _volumeVal.textContent = val + '%';
    if (SL.audio && SL.audio.setMasterVolume) {
      SL.audio.setMasterVolume(val / VOLUME_MAX);
    }
  }

  // ============================================================
  // Effects Presets
  // ============================================================

  function _getFxLib() {
    return SL.fxPresetLib || { categories: [], library: {} };
  }

  function _initFxState() {
    var lib = _getFxLib();
    if (!_activeFxCategory && lib.categories.length > 0) {
      _activeFxCategory = lib.categories[0];
    }
    if (!_activeFxPresetId) {
      var presets = lib.library[_activeFxCategory] || [];
      if (presets.length > 0) {
        _activeFxPresetId = presets[0].id;
      }
    }
  }

  function _populateFxPresetDropdown() {
    if (!_fxPresetSelect) {
      return;
    }
    _fxPresetSelect.innerHTML = '';
    var lib = _getFxLib();
    var presets = lib.library[_activeFxCategory] || [];
    for (var i = 0; i < presets.length; i++) {
      var opt = document.createElement('option');
      opt.value = presets[i].id;
      opt.textContent = SL.t('fx_preset_label.' + (_FX_PRESET_KEY[presets[i].label] || ''), presets[i].label);
      _fxPresetSelect.appendChild(opt);
    }
  }

  function _syncFxDropdowns() {
    // Read shared state from effects screen module
    if (SL.screenEffects && SL.screenEffects.getFxState) {
      var state = SL.screenEffects.getFxState();
      _activeFxCategory = state.category;
      _activeFxPresetId = state.presetId;
    }
    if (_fxCategorySelect) {
      _fxCategorySelect.value = _activeFxCategory;
    }
    _populateFxPresetDropdown();
    if (_fxPresetSelect) {
      _fxPresetSelect.value = _activeFxPresetId;
    }
  }

  function _onSoundFxCategoryChange() {
    if (!_fxCategorySelect) {
      return;
    }
    _activeFxCategory = _fxCategorySelect.value;
    _populateFxPresetDropdown();
    var lib = _getFxLib();
    var presets = lib.library[_activeFxCategory] || [];
    if (presets.length > 0) {
      _onSoundFxPresetApply(presets[0].id);
    }
  }

  function _onSoundFxPresetChange() {
    if (!_fxPresetSelect) {
      return;
    }
    _onSoundFxPresetApply(_fxPresetSelect.value);
  }

  function _onSoundFxPresetApply(presetId) {
    _activeFxPresetId = presetId;
    // Delegate to the effects screen's apply logic
    if (SL.screenEffects && SL.screenEffects.applyPreset) {
      SL.screenEffects.applyPreset(presetId);
    }
  }

  // ============================================================
  // Test Tone
  // ============================================================

  var _testToneBtn = null;
  // Resolved at runtime via SL.t() — see _playTestTone and _buildScreen
  function _getTestToneLabelDefault() { return SL.t('ui.label.test'); }
  function _getTestToneLabelPlaying() { return SL.t('ui.status.playing') + '...'; }

  function _playTestTone() {
    // Ignore clicks while already playing — no stacking
    if (_testToneTimer) {
      return;
    }
    // Ensure AudioContext is created and resumed before playing
    if (SL.audio && SL.audio.getCtx) {
      var ctx = SL.audio.getCtx();
      if (ctx && ctx.state === 'suspended') {
        ctx.resume();
      }
    }
    if (SL.audio && SL.audio.startSustainedNote) {
      // Update button text to show playing state
      if (_testToneBtn) {
        _testToneBtn.textContent = _getTestToneLabelPlaying();
      }
      SL.audio.startSustainedNote(TEST_TONE_MIDI, TEST_TONE_VELOCITY);
      _testToneTimer = setTimeout(function() {
        if (SL.audio && SL.audio.stopSustainedNote) {
          SL.audio.stopSustainedNote(TEST_TONE_MIDI);
        }
        // Restore button text
        if (_testToneBtn) {
          _testToneBtn.textContent = _getTestToneLabelDefault();
        }
        _testToneTimer = null;
      }, TEST_TONE_DURATION_MS);
    }
  }

  // ============================================================
  // E-05: Filter quick-access helpers
  // ============================================================

  var FILTER_HZ_THRESHOLD = SL.HZ_TO_KHZ_THRESHOLD;

  function _getFilterSettings() {
    if (SL.audio && SL.audio.getInstruments) {
      var insts = SL.audio.getInstruments();
      var idx = SL.audio.getCurrentInstrument();
      if (insts && insts[idx] && insts[idx].settings && insts[idx].settings.filter) {
        return insts[idx].settings.filter;
      }
    }
    return null;
  }

  function _setFilterParam(param, value) {
    var filter = _getFilterSettings();
    if (filter) {
      filter[param] = value;
      if (SL.state && SL.state.notify) {
        SL.state.notify('shape');
      }
    }
  }

  // Logarithmic cutoff slider conversion
  var LOG_CUT_MIN = Math.log10(SL.FILTER_CUTOFF_MIN);
  var LOG_CUT_MAX = Math.log10(SL.FILTER_CUTOFF_MAX);
  var LOG_CUT_RANGE = LOG_CUT_MAX - LOG_CUT_MIN;
  var CUT_SLIDER_MAX = 1000;
  var NOTE_NAMES_SND = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  function _sliderToFreqSnd(sliderVal) {
    return Math.pow(10, LOG_CUT_MIN + (sliderVal / CUT_SLIDER_MAX) * LOG_CUT_RANGE);
  }

  function _freqToSliderSnd(freq) {
    var clamped = Math.max(SL.FILTER_CUTOFF_MIN, Math.min(SL.FILTER_CUTOFF_MAX, freq));
    return Math.round(((Math.log10(clamped) - LOG_CUT_MIN) / LOG_CUT_RANGE) * CUT_SLIDER_MAX);
  }

  function _freqToNoteSnd(freq) {
    if (freq <= 0) { return ''; }
    var midi = Math.round(69 + 12 * Math.log2(freq / 440));
    if (midi < 0 || midi > 127) { return ''; }
    return NOTE_NAMES_SND[midi % 12] + (Math.floor(midi / 12) - 1);
  }

  function _formatFilterHz(hz) {
    var note = _freqToNoteSnd(hz);
    var freqStr;
    if (hz >= FILTER_HZ_THRESHOLD) {
      freqStr = (hz / FILTER_HZ_THRESHOLD).toFixed(1) + 'kHz';
    } else {
      freqStr = Math.round(hz) + 'Hz';
    }
    if (note) {
      return freqStr + ' (' + note + ')';
    }
    return freqStr;
  }

  // ============================================================
  // E-13: Velocity curve
  // ============================================================

  var VELOCITY_CURVES = [
    { val: 'linear',      lbl: 'Linear' },
    { val: 'soft',        lbl: 'Soft' },
    { val: 'hard',        lbl: 'Hard' },
    { val: 'fixed',       lbl: 'Fixed' }
  ];

  function _setVelocityCurve(curve) {
    if (SL.audio && SL.audio.getInstruments) {
      var insts = SL.audio.getInstruments();
      var idx = SL.audio.getCurrentInstrument();
      if (insts && insts[idx] && insts[idx].settings) {
        insts[idx].settings.velCurve = curve;
      }
    }
    try {
      localStorage.setItem('ssli-vel-curve', curve);
    } catch (e) {
      // localStorage may be unavailable
    }
  }

  function _getVelocityCurve() {
    if (SL.audio && SL.audio.getInstruments) {
      var insts = SL.audio.getInstruments();
      var idx = SL.audio.getCurrentInstrument();
      if (insts && insts[idx] && insts[idx].settings && insts[idx].settings.velCurve) {
        return insts[idx].settings.velCurve;
      }
    }
    try {
      var saved = localStorage.getItem('ssli-vel-curve');
      if (saved) {
        return saved;
      }
    } catch (e) {
      // localStorage may be unavailable
    }
    return 'linear';
  }

  // ============================================================
  // Build Screen DOM
  // ============================================================

  function _buildScreen() {
    _screenEl = document.getElementById('ssli-screen-sound');
    if (!_screenEl) {
      return;
    }
    _screenEl.innerHTML = '';

    var container = document.createElement('div');
    container.className = 'ssli-sound-container';

    // --- Engine / Category / Preset section ---
    var presetSection = document.createElement('div');
    presetSection.className = 'ssli-sound-section';

    _presetSectionTitle = document.createElement('div');
    _presetSectionTitle.className = 'ssli-sound-section-title';
    _presetSectionTitle.textContent = SL.t('ui.label.instrument');
    presetSection.appendChild(_presetSectionTitle);

    // Phone-land: pack Engine/Category/Preset/Surprise into a single horizontal
    // row so the 3-per-row dropdowns eat 176px of dead phone-land space.
    // Desktop: keep the stacked per-row labels for readability.
    var isPhoneLand = (document.documentElement.getAttribute('data-layout') === 'phone-land');

    // Engine row
    var engineRow = document.createElement('div');
    engineRow.className = 'ssli-sound-row';
    _engineLabel = document.createElement('span');
    _engineLabel.className = 'ssli-sound-label';
    _engineLabel.textContent = isPhoneLand ? 'Eng' : SL.t('ui.label.engine');
    var engineLabel = _engineLabel;
    _engineSelect = document.createElement('select');
    _engineSelect.className = 'ssli-sound-select';
    _engineSelect.id = 'ssliEngine';
    _engineSelect.setAttribute('aria-label', 'Synth Engine');
    _engineSelect.addEventListener('change', _onEngineChange);
    engineRow.appendChild(engineLabel);
    engineRow.appendChild(_engineSelect);

    // Category row
    var catRow = document.createElement('div');
    catRow.className = 'ssli-sound-row';
    _catLabel = document.createElement('span');
    _catLabel.className = 'ssli-sound-label';
    _catLabel.textContent = isPhoneLand ? 'Cat' : SL.t('ui.label.category');
    var catLabel = _catLabel;
    _categorySelect = document.createElement('select');
    _categorySelect.className = 'ssli-sound-select';
    _categorySelect.id = 'ssliCategory';
    _categorySelect.setAttribute('aria-label', 'Preset Category');
    _categorySelect.addEventListener('change', _onCategoryChange);
    catRow.appendChild(catLabel);
    catRow.appendChild(_categorySelect);

    // Preset row
    var presetRow = document.createElement('div');
    presetRow.className = 'ssli-sound-row';
    _presetLabel = document.createElement('span');
    _presetLabel.className = 'ssli-sound-label';
    _presetLabel.textContent = isPhoneLand ? 'Pre' : SL.t('ui.label.preset');
    var presetLabel = _presetLabel;
    _presetSelect = document.createElement('select');
    _presetSelect.className = 'ssli-sound-select';
    _presetSelect.id = 'ssliPreset';
    _presetSelect.setAttribute('aria-label', 'Preset');
    _presetSelect.addEventListener('change', _onPresetChange);
    presetRow.appendChild(presetLabel);
    presetRow.appendChild(_presetSelect);

    // F3-07: Random Preset / Surprise Me button
    _surpriseBtn = document.createElement('button');
    _surpriseBtn.type = 'button';
    _surpriseBtn.className = 'ssli-surprise-btn';
    _surpriseBtn.textContent = '\uD83C\uDFB2 ' + SL.t('ui.label.surprise_me');
    _surpriseBtn.setAttribute('aria-label', 'Pick a random preset from any engine');
    _surpriseBtn.addEventListener('click', _onSurpriseMe);
    var surpriseBtn = _surpriseBtn;

    if (isPhoneLand) {
      // Combined single row
      var epcRow = document.createElement('div');
      epcRow.className = 'ssli-sound-row-epc';
      epcRow.appendChild(engineLabel);
      epcRow.appendChild(_engineSelect);
      epcRow.appendChild(catLabel);
      epcRow.appendChild(_categorySelect);
      epcRow.appendChild(presetLabel);
      epcRow.appendChild(_presetSelect);
      epcRow.appendChild(surpriseBtn);
      presetSection.appendChild(epcRow);
    } else {
      presetSection.appendChild(engineRow);
      presetSection.appendChild(catRow);
      presetSection.appendChild(presetRow);
      presetSection.appendChild(surpriseBtn);
    }

    container.appendChild(presetSection);

    // --- E-05: Filter Quick-Access (compact inline row) ---
    var filterSection = document.createElement('div');
    filterSection.className = 'ssli-sound-section';

    _filterSectionTitle = document.createElement('div');
    _filterSectionTitle.className = 'ssli-sound-section-title';
    _filterSectionTitle.textContent = SL.t('ui.label.filter');
    filterSection.appendChild(_filterSectionTitle);

    // Single row with both Cutoff and Resonance inline
    var filterInlineRow = document.createElement('div');
    filterInlineRow.className = 'ssli-sound-filter-inline';

    var initSettings = _getFilterSettings();

    // Cutoff
    _cutoffLabel = document.createElement('span');
    _cutoffLabel.className = 'ssli-sound-filter-inline-label';
    _cutoffLabel.textContent = SL.t('ui.label.cutoff');
    var cutoffLabel = _cutoffLabel;
    var cutoffSlider = document.createElement('input');
    cutoffSlider.type = 'range';
    cutoffSlider.className = 'ssli-shape-slider';
    cutoffSlider.min = '0';
    cutoffSlider.max = String(CUT_SLIDER_MAX);
    cutoffSlider.value = String(CUT_SLIDER_MAX);
    cutoffSlider.setAttribute('aria-label', 'Filter Cutoff');
    var cutoffVal = document.createElement('span');
    cutoffVal.className = 'ssli-sound-filter-inline-val';
    cutoffVal.textContent = _formatFilterHz(SL.FILTER_CUTOFF_MAX);
    if (initSettings) {
      cutoffSlider.value = String(_freqToSliderSnd(initSettings.freq));
      cutoffVal.textContent = _formatFilterHz(initSettings.freq);
    }
    cutoffSlider.addEventListener('input', function() {
      var freq = _sliderToFreqSnd(parseFloat(cutoffSlider.value));
      cutoffVal.textContent = _formatFilterHz(freq);
      _setFilterParam('freq', Math.round(freq));
    });
    _filterCutoffSlider = cutoffSlider;
    _filterCutoffVal = cutoffVal;
    filterInlineRow.appendChild(cutoffLabel);
    filterInlineRow.appendChild(cutoffSlider);
    filterInlineRow.appendChild(cutoffVal);

    // Resonance
    _resoLabel = document.createElement('span');
    _resoLabel.className = 'ssli-sound-filter-inline-label';
    _resoLabel.textContent = SL.t('ui.label.resonance');
    var resoLabel = _resoLabel;
    var resoSlider = document.createElement('input');
    resoSlider.type = 'range';
    resoSlider.className = 'ssli-shape-slider';
    resoSlider.min = String(SL.FILTER_RESO_MIN);
    resoSlider.max = String(SL.FILTER_RESO_MAX);
    resoSlider.step = '0.1';
    resoSlider.value = '10';
    resoSlider.setAttribute('aria-label', 'Filter Resonance');
    var resoVal = document.createElement('span');
    resoVal.className = 'ssli-sound-filter-inline-val';
    resoVal.textContent = 'Q10';
    if (initSettings) {
      resoSlider.value = String(initSettings.q);
      resoVal.textContent = 'Q' + initSettings.q.toFixed(1);
    }
    resoSlider.addEventListener('input', function() {
      var v = parseFloat(resoSlider.value);
      resoVal.textContent = 'Q' + v.toFixed(1);
      _setFilterParam('q', v);
    });
    _filterResoSlider = resoSlider;
    _filterResoVal = resoVal;
    filterInlineRow.appendChild(resoLabel);
    filterInlineRow.appendChild(resoSlider);
    filterInlineRow.appendChild(resoVal);

    filterSection.appendChild(filterInlineRow);
    container.appendChild(filterSection);

    // --- Presets section: FX Presets + My Presets merged ---
    _initFxState();

    var presetsSection = document.createElement('div');
    presetsSection.className = 'ssli-sound-section';

    _presetsSectionTitle = document.createElement('div');
    _presetsSectionTitle.className = 'ssli-sound-section-title';
    _presetsSectionTitle.textContent = SL.t('ui.label.presets');
    presetsSection.appendChild(_presetsSectionTitle);

    // FX preset dropdowns inline row
    var fxInlineRow = document.createElement('div');
    fxInlineRow.className = 'ssli-sound-fx-inline';

    _fxCatLabel = document.createElement('span');
    _fxCatLabel.className = 'ssli-sound-filter-inline-label';
    _fxCatLabel.textContent = SL.t('ui.label.fx');
    fxInlineRow.appendChild(_fxCatLabel);

    var lib = _getFxLib();
    _fxCategorySelect = document.createElement('select');
    _fxCategorySelect.className = 'ssli-sound-select ssli-fx-cat-select';
    _fxCategorySelect.setAttribute('aria-label', 'FX Preset Category');
    for (var fci = 0; fci < lib.categories.length; fci++) {
      var fcOpt = document.createElement('option');
      fcOpt.value = lib.categories[fci];
      fcOpt.textContent = SL.t('fx_category.' + (_FX_CAT_KEY[lib.categories[fci]] || ''), lib.categories[fci]);
      _fxCategorySelect.appendChild(fcOpt);
    }
    _fxCategorySelect.value = _activeFxCategory;
    _fxCategorySelect.addEventListener('change', _onSoundFxCategoryChange);
    fxInlineRow.appendChild(_fxCategorySelect);

    _fxPresetSelect = document.createElement('select');
    _fxPresetSelect.className = 'ssli-sound-select ssli-fx-pre-select';
    _fxPresetSelect.setAttribute('aria-label', 'FX Preset');
    _fxPresetSelect.addEventListener('change', _onSoundFxPresetChange);
    fxInlineRow.appendChild(_fxPresetSelect);

    _populateFxPresetDropdown();
    _fxPresetSelect.value = _activeFxPresetId;

    presetsSection.appendChild(fxInlineRow);
    container.appendChild(presetsSection);

    // --- Output & Controls section (compact) ---
    var outSection = document.createElement('div');
    outSection.className = 'ssli-sound-section';

    _outSectionTitle = document.createElement('div');
    _outSectionTitle.className = 'ssli-sound-section-title';
    _outSectionTitle.textContent = SL.t('ui.label.output_controls');
    outSection.appendChild(_outSectionTitle);

    // Volume + Velocity on same row
    var volVelRow = document.createElement('div');
    volVelRow.className = 'ssli-sound-row';
    _volLabel = document.createElement('span');
    _volLabel.className = 'ssli-sound-label';
    _volLabel.textContent = SL.t('ui.label.volume');
    var volLabel = _volLabel;
    _volumeSlider = document.createElement('input');
    _volumeSlider.type = 'range';
    _volumeSlider.className = 'ssli-volume-slider';
    _volumeSlider.min = String(VOLUME_MIN);
    _volumeSlider.max = String(VOLUME_MAX);
    _volumeSlider.value = String(DEFAULT_VOLUME);
    _volumeSlider.setAttribute('aria-label', 'Master Volume');
    _volumeSlider.addEventListener('input', _onVolumeChange);
    _volumeVal = document.createElement('span');
    _volumeVal.className = 'ssli-volume-val';
    _volumeVal.textContent = DEFAULT_VOLUME + '%';

    // E-13: Velocity curve selector (inline with volume)
    _velLabel = document.createElement('span');
    _velLabel.className = 'ssli-sound-filter-inline-label';
    _velLabel.textContent = SL.t('ui.label.velocity');
    var velLabel = _velLabel;
    _velSelect = document.createElement('select');
    var velSelect = _velSelect;
    velSelect.className = 'ssli-vel-select';
    velSelect.setAttribute('aria-label', 'Velocity Response Curve');
    var currentVelCurve = _getVelocityCurve();
    for (var vc = 0; vc < VELOCITY_CURVES.length; vc++) {
      var vcOpt = document.createElement('option');
      vcOpt.value = VELOCITY_CURVES[vc].val;
      vcOpt.textContent = SL.t('velocity_curve.' + VELOCITY_CURVES[vc].val, VELOCITY_CURVES[vc].lbl);
      velSelect.appendChild(vcOpt);
    }
    velSelect.value = currentVelCurve;
    velSelect.addEventListener('change', function() {
      _setVelocityCurve(velSelect.value);
      if (SL.state && SL.state.notify) {
        SL.state.notify('shape');
      }
    });

    _testToneBtn = document.createElement('button');
    _testToneBtn.className = 'ssli-test-tone-btn';
    _testToneBtn.type = 'button';
    _testToneBtn.textContent = _getTestToneLabelDefault();
    _testToneBtn.title = 'Play a 1-second test note to verify audio';
    _testToneBtn.setAttribute('aria-label', 'Play test tone');
    _testToneBtn.addEventListener('click', _playTestTone);

    volVelRow.appendChild(volLabel);
    volVelRow.appendChild(_volumeSlider);
    volVelRow.appendChild(_volumeVal);
    volVelRow.appendChild(_testToneBtn);
    volVelRow.appendChild(velLabel);
    volVelRow.appendChild(velSelect);
    outSection.appendChild(volVelRow);

    // Touch Velocity toggle + Touch Sensitivity slider row
    var TOUCH_SENS_MIN = 0;
    var TOUCH_SENS_MAX = 100;
    var TOUCH_SENS_DEFAULT = 25;
    var TIP_TOUCH_VELOCITY = 'When ON, touch pressure/radius affects note velocity. When OFF, all notes use a fixed fallback velocity.';
    var TIP_TOUCH_SENSITIVITY = 'Controls how much finger pressure affects velocity. Light = small taps register loud, Heavy = need hard presses for loud notes.';

    var touchVelRow = document.createElement('div');
    touchVelRow.className = 'ssli-sound-row';

    _touchVelLabel = document.createElement('span');
    _touchVelLabel.className = 'ssli-sound-label';
    _touchVelLabel.textContent = SL.t('ui.label.touch_velocity', 'Touch Velocity');
    _touchVelLabel.title = TIP_TOUCH_VELOCITY;

    _touchVelCb = document.createElement('input');
    _touchVelCb.type = 'checkbox';
    _touchVelCb.className = 'ssli-shape-checkbox';
    _touchVelCb.setAttribute('aria-label', 'Touch Velocity');
    _touchVelCb.title = TIP_TOUCH_VELOCITY;

    var touchVelSaved = SL._touchSettings.enabled;
    _touchVelCb.checked = touchVelSaved;

    // Sensitivity slider label
    _touchSensLabel = document.createElement('span');
    _touchSensLabel.className = 'ssli-sound-filter-inline-label';
    _touchSensLabel.textContent = SL.t('ui.label.touch_sensitivity', 'Touch Sensitivity');
    _touchSensLabel.title = TIP_TOUCH_SENSITIVITY;

    // Sensitivity slider
    _touchSensSlider = document.createElement('input');
    _touchSensSlider.type = 'range';
    _touchSensSlider.className = 'ssli-shape-slider';
    _touchSensSlider.min = String(TOUCH_SENS_MIN);
    _touchSensSlider.max = String(TOUCH_SENS_MAX);
    _touchSensSlider.setAttribute('aria-label', 'Touch Sensitivity');
    _touchSensSlider.title = TIP_TOUCH_SENSITIVITY;

    var savedSensitivity = SL._touchSettings.sensitivity;
    _touchSensSlider.value = String(savedSensitivity);

    // Value display: "Light" / "Heavy" labels at extremes, numeric in between
    _touchSensVal = document.createElement('span');
    _touchSensVal.className = 'ssli-sound-filter-inline-val';

    function formatSensitivity(val) {
      var numVal = parseInt(val, 10);
      var isLight = (numVal <= 10);
      var isHeavy = (numVal >= 90);
      if (isLight) {
        return 'Light';
      }
      if (isHeavy) {
        return 'Heavy';
      }
      return String(numVal);
    }
    _touchSensVal.textContent = formatSensitivity(savedSensitivity);

    // Enable/disable sensitivity slider based on touch velocity state
    var sensIsEnabled = touchVelSaved;
    _touchSensSlider.disabled = !sensIsEnabled;
    _touchSensLabel.style.opacity = sensIsEnabled ? '1' : '0.4';
    _touchSensVal.style.opacity = sensIsEnabled ? '1' : '0.4';

    _touchVelCb.addEventListener('change', function() {
      var isOn = _touchVelCb.checked;
      SL._touchSettings.enabled = isOn;
      try {
        localStorage.setItem('ssli-touch-velocity', isOn ? 'on' : 'off');
      } catch (lsErr) {
        // localStorage may be unavailable
      }
      _touchSensSlider.disabled = !isOn;
      _touchSensLabel.style.opacity = isOn ? '1' : '0.4';
      _touchSensVal.style.opacity = isOn ? '1' : '0.4';
      // Also toggle min/max velocity sliders
      if (_touchVelMinSlider) {
        _touchVelMinSlider.disabled = !isOn;
        _touchVelMinLabel.style.opacity = isOn ? '1' : '0.4';
        _touchVelMinVal.style.opacity = isOn ? '1' : '0.4';
      }
      if (_touchVelMaxSlider) {
        _touchVelMaxSlider.disabled = !isOn;
        _touchVelMaxLabel.style.opacity = isOn ? '1' : '0.4';
        _touchVelMaxVal.style.opacity = isOn ? '1' : '0.4';
      }
    });

    _touchSensSlider.addEventListener('input', function() {
      var sensVal = parseInt(_touchSensSlider.value, 10);
      _touchSensVal.textContent = formatSensitivity(sensVal);
      SL._touchSettings.sensitivity = sensVal;
      try {
        localStorage.setItem('ssli-touch-sensitivity', String(sensVal));
      } catch (lsErr) {
        // localStorage may be unavailable
      }
    });

    touchVelRow.appendChild(_touchVelLabel);
    touchVelRow.appendChild(_touchVelCb);
    touchVelRow.appendChild(_touchSensLabel);
    touchVelRow.appendChild(_touchSensSlider);
    touchVelRow.appendChild(_touchSensVal);
    outSection.appendChild(touchVelRow);

    // Min / Max Velocity sliders row
    var TOUCH_VEL_MIN_FLOOR = 1;
    var TOUCH_VEL_MIN_CEIL = 100;
    var TOUCH_VEL_MIN_DEFAULT = 20;
    var TOUCH_VEL_MAX_FLOOR = 80;
    var TOUCH_VEL_MAX_CEIL = 127;
    var TOUCH_VEL_MAX_DEFAULT = 127;

    var velRangeRow = document.createElement('div');
    velRangeRow.className = 'ssli-sound-row';

    // --- Min Velocity ---
    _touchVelMinLabel = document.createElement('span');
    _touchVelMinLabel.className = 'ssli-sound-filter-inline-label';
    _touchVelMinLabel.textContent = SL.t('ui.label.touch_vel_min', 'Min Velocity');

    _touchVelMinSlider = document.createElement('input');
    _touchVelMinSlider.type = 'range';
    _touchVelMinSlider.className = 'ssli-shape-slider';
    _touchVelMinSlider.min = String(TOUCH_VEL_MIN_FLOOR);
    _touchVelMinSlider.max = String(TOUCH_VEL_MIN_CEIL);
    _touchVelMinSlider.setAttribute('aria-label', 'Min Velocity');

    var savedVelMin = SL._touchSettings.velMin;
    _touchVelMinSlider.value = String(savedVelMin);

    _touchVelMinVal = document.createElement('span');
    _touchVelMinVal.className = 'ssli-sound-filter-inline-val';
    _touchVelMinVal.textContent = String(savedVelMin);

    _touchVelMinSlider.addEventListener('input', function() {
      var minVal = parseInt(_touchVelMinSlider.value, 10);
      _touchVelMinVal.textContent = String(minVal);
      SL._touchSettings.velMin = minVal;
      try {
        localStorage.setItem('ssli-touch-vel-min', String(minVal));
      } catch (lsErr) {
        // localStorage may be unavailable
      }
    });

    // --- Max Velocity ---
    _touchVelMaxLabel = document.createElement('span');
    _touchVelMaxLabel.className = 'ssli-sound-filter-inline-label';
    _touchVelMaxLabel.textContent = SL.t('ui.label.touch_vel_max', 'Max Velocity');

    _touchVelMaxSlider = document.createElement('input');
    _touchVelMaxSlider.type = 'range';
    _touchVelMaxSlider.className = 'ssli-shape-slider';
    _touchVelMaxSlider.min = String(TOUCH_VEL_MAX_FLOOR);
    _touchVelMaxSlider.max = String(TOUCH_VEL_MAX_CEIL);
    _touchVelMaxSlider.setAttribute('aria-label', 'Max Velocity');

    var savedVelMax = SL._touchSettings.velMax;
    _touchVelMaxSlider.value = String(savedVelMax);

    _touchVelMaxVal = document.createElement('span');
    _touchVelMaxVal.className = 'ssli-sound-filter-inline-val';
    _touchVelMaxVal.textContent = String(savedVelMax);

    _touchVelMaxSlider.addEventListener('input', function() {
      var maxVal = parseInt(_touchVelMaxSlider.value, 10);
      _touchVelMaxVal.textContent = String(maxVal);
      SL._touchSettings.velMax = maxVal;
      try {
        localStorage.setItem('ssli-touch-vel-max', String(maxVal));
      } catch (lsErr) {
        // localStorage may be unavailable
      }
    });

    // Enable/disable min/max sliders based on touch velocity state
    _touchVelMinSlider.disabled = !sensIsEnabled;
    _touchVelMinLabel.style.opacity = sensIsEnabled ? '1' : '0.4';
    _touchVelMinVal.style.opacity = sensIsEnabled ? '1' : '0.4';
    _touchVelMaxSlider.disabled = !sensIsEnabled;
    _touchVelMaxLabel.style.opacity = sensIsEnabled ? '1' : '0.4';
    _touchVelMaxVal.style.opacity = sensIsEnabled ? '1' : '0.4';

    velRangeRow.appendChild(_touchVelMinLabel);
    velRangeRow.appendChild(_touchVelMinSlider);
    velRangeRow.appendChild(_touchVelMinVal);
    velRangeRow.appendChild(_touchVelMaxLabel);
    velRangeRow.appendChild(_touchVelMaxSlider);
    velRangeRow.appendChild(_touchVelMaxVal);
    outSection.appendChild(velRangeRow);

    container.appendChild(outSection);

    _screenEl.appendChild(container);
  }

  // ============================================================
  // Activate / Deactivate
  // ============================================================

  function _refreshFilterSliders() {
    var settings = _getFilterSettings();
    if (settings && _filterCutoffSlider) {
      _filterCutoffSlider.value = String(_freqToSliderSnd(settings.freq));
      if (_filterCutoffVal) {
        _filterCutoffVal.textContent = _formatFilterHz(settings.freq);
      }
    }
    if (settings && _filterResoSlider) {
      _filterResoSlider.value = String(settings.q);
      if (_filterResoVal) {
        _filterResoVal.textContent = 'Q' + settings.q.toFixed(1);
      }
    }
  }

  function _onStateChange(what) {
    if (!_active) {
      return;
    }
    if (what === 'fxpreset') {
      _syncFxDropdowns();
    }
    if (what === 'preset' || what === 'instrument') {
      _refreshFilterSliders();
    }
  }

  // ============================================================
  // Language-change rebuild helpers
  // ============================================================

  function _populateFxCategories() {
    if (!_fxCategorySelect) {
      return;
    }
    var savedVal = _fxCategorySelect.value;
    _fxCategorySelect.innerHTML = '';
    var lib = _getFxLib();
    for (var fci = 0; fci < lib.categories.length; fci++) {
      var fcOpt = document.createElement('option');
      fcOpt.value = lib.categories[fci];
      fcOpt.textContent = SL.t('fx_category.' + (_FX_CAT_KEY[lib.categories[fci]] || ''), lib.categories[fci]);
      _fxCategorySelect.appendChild(fcOpt);
    }
    _fxCategorySelect.value = savedVal;
  }

  function _populateVelocityCurves() {
    if (!_velSelect) {
      return;
    }
    var savedVal = _velSelect.value;
    _velSelect.innerHTML = '';
    for (var vc = 0; vc < VELOCITY_CURVES.length; vc++) {
      var vcOpt = document.createElement('option');
      vcOpt.value = VELOCITY_CURVES[vc].val;
      vcOpt.textContent = SL.t('velocity_curve.' + VELOCITY_CURVES[vc].val, VELOCITY_CURVES[vc].lbl);
      _velSelect.appendChild(vcOpt);
    }
    _velSelect.value = savedVal;
  }

  function _rebuildAllForLanguage() {
    var isPhoneLand = (document.documentElement.getAttribute('data-layout') === 'phone-land');

    // Save current selections
    var savedEngine = _engineSelect ? _engineSelect.value : null;
    var savedCategory = _categorySelect ? _categorySelect.value : null;
    var savedPreset = _presetSelect ? _presetSelect.value : null;

    // Section titles
    if (_presetSectionTitle) { _presetSectionTitle.textContent = SL.t('ui.label.instrument'); }
    if (_filterSectionTitle) { _filterSectionTitle.textContent = SL.t('ui.label.filter'); }
    if (_presetsSectionTitle) { _presetsSectionTitle.textContent = SL.t('ui.label.presets'); }
    if (_outSectionTitle) { _outSectionTitle.textContent = SL.t('ui.label.output_controls'); }

    // Row labels
    if (_engineLabel) { _engineLabel.textContent = isPhoneLand ? 'Eng' : SL.t('ui.label.engine'); }
    if (_catLabel) { _catLabel.textContent = isPhoneLand ? 'Cat' : SL.t('ui.label.category'); }
    if (_presetLabel) { _presetLabel.textContent = isPhoneLand ? 'Pre' : SL.t('ui.label.preset'); }
    if (_cutoffLabel) { _cutoffLabel.textContent = SL.t('ui.label.cutoff'); }
    if (_resoLabel) { _resoLabel.textContent = SL.t('ui.label.resonance'); }
    if (_fxCatLabel) { _fxCatLabel.textContent = SL.t('ui.label.fx'); }
    if (_volLabel) { _volLabel.textContent = SL.t('ui.label.volume'); }
    if (_velLabel) { _velLabel.textContent = SL.t('ui.label.velocity'); }
    if (_touchVelLabel) { _touchVelLabel.textContent = SL.t('ui.label.touch_velocity', 'Touch Velocity'); }
    if (_touchSensLabel) { _touchSensLabel.textContent = SL.t('ui.label.touch_sensitivity', 'Touch Sensitivity'); }
    if (_touchVelMinLabel) { _touchVelMinLabel.textContent = SL.t('ui.label.touch_vel_min', 'Min Velocity'); }
    if (_touchVelMaxLabel) { _touchVelMaxLabel.textContent = SL.t('ui.label.touch_vel_max', 'Max Velocity'); }

    // Button text
    if (_surpriseBtn) { _surpriseBtn.textContent = '🎲 ' + SL.t('ui.label.surprise_me'); }
    if (_testToneBtn && !_testToneTimer) { _testToneBtn.textContent = _getTestToneLabelDefault(); }

    // Rebuild engine dropdown (preserving selection)
    _populateEngines();
    if (savedEngine && _engineSelect) { _engineSelect.value = savedEngine; }

    // Rebuild category dropdown (preserving selection)
    _populateCategories();
    if (savedCategory && _categorySelect) { _categorySelect.value = savedCategory; }

    // Preset names are not translated so no rebuild needed, but selection is preserved

    // FX category dropdown
    _populateFxCategories();

    // FX preset dropdown
    _populateFxPresetDropdown();
    if (_fxPresetSelect && _activeFxPresetId) { _fxPresetSelect.value = _activeFxPresetId; }

    // Velocity curve dropdown
    _populateVelocityCurves();
  }

  var DEFAULT_PRESET_NAME = 'Electric Piano (Rhodes)';

  function activate() {
    _active = true;
    if (!_initialized) {
      _buildScreen();
      _populateEngines();
      _populateCategories();
      _populatePresets();
      // Select the default preset by name instead of first alphabetically
      if (_presetSelect && _cachedPresets) {
        for (var di = 0; di < _cachedPresets.length; di++) {
          if (_cachedPresets[di].name === DEFAULT_PRESET_NAME) {
            _presetSelect.selectedIndex = di;
            _applyPreset(_cachedPresets[di]);
            break;
          }
        }
      }
      _initialized = true;

      // Register language-change callback (once, after first init)
      if (SL.localization && SL.localization.onLanguageChange) {
        SL.localization.onLanguageChange(_rebuildAllForLanguage);
      }
    } else {
      _syncFxDropdowns();
      _refreshFilterSliders();
    }
    if (SL.state && SL.state.onChange) {
      SL.state.onChange(_onStateChange);
    }
  }

  function deactivate() {
    _active = false;
    // E-01: Stop test tone if playing
    if (_testToneTimer) {
      clearTimeout(_testToneTimer);
      if (SL.audio && SL.audio.stopSustainedNote) {
        SL.audio.stopSustainedNote(TEST_TONE_MIDI);
      }
      if (_testToneBtn) {
        _testToneBtn.textContent = _getTestToneLabelDefault();
      }
      _testToneTimer = null;
    }
    if (SL.state && SL.state.removeListener) {
      SL.state.removeListener(_onStateChange);
    }
  }

  // ============================================================
  // Register
  // ============================================================

  SL.screenSound = {
    activate: activate,
    deactivate: deactivate
  };

})();
