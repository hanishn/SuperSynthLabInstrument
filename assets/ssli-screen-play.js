// SSLI Screen: Play — Orchestrator for all controller surfaces
// Dispatches to SL.controllers[mode].build() for each surface type
// ES5 compatible (var, no arrow functions, no template literals)

(function() {
  'use strict';

  var SL = window.SynthLab;
  var NOTES = SL.NOTES;
  var NUM_OCTAVES_DEFAULT = 3;
  var MIN_TRANSPOSE = -12;
  var MAX_TRANSPOSE = 12;
  var DEFAULT_BASE_OCTAVE = 3;
  var MIDI_MIN = 0;
  var MIDI_MAX = 127;
  var DEFAULT_VELOCITY = 100;
  var A4_FREQ = 440;
  var A4_MIDI = 69;
  var SEMITONES_PER_OCTAVE = 12;
  var HZ_TO_KHZ_THRESHOLD = SL.HZ_TO_KHZ_THRESHOLD;
  var MODE_PIANO = 'piano';
  var KEY_TO_SEMITONE = { 'KeyA': 0, 'KeyW': 1, 'KeyS': 2, 'KeyE': 3, 'KeyD': 4, 'KeyF': 5, 'KeyT': 6, 'KeyG': 7, 'KeyY': 8, 'KeyH': 9, 'KeyU': 10, 'KeyJ': 11, 'KeyK': 12, 'KeyO': 13, 'KeyL': 14 };
  var INPUT_ELEMENT_TAGS = /^(INPUT|SELECT|TEXTAREA)$/;
  var SURFACE_DEFS = SL.SURFACE_DEFS;
  var SURFACE_CATEGORIES = SL.SURFACE_CATEGORIES;
  var STORAGE_KEY_SURFACE = 'ssli-surface';
  var STORAGE_KEY_CATEGORY = 'ssli-surface-cat';
  var STORAGE_KEY_VOICING = 'ssli-voicing';
  var VOICING_MODES = SL.VOICING_MODES;
  var NO_VOICING_SURFACES = SL.NO_VOICING_SURFACES;
  // Surfaces that have their own chromatic note grid; hide the global Root/Mode dropdowns.
  var NO_ROOT_MODE_SURFACES = ['breathpad', 'breathpadens'];
  var LEVEL_METER_SEGMENT_COUNT = 8;
  var SEGMENT_THRESHOLD_GREEN_MAX = 4;
  var SEGMENT_THRESHOLD_AMBER_MAX = 6;
  var COLOR_GREEN = '#2ecc71';
  var COLOR_AMBER = '#f0a030';
  var COLOR_WARM_ORANGE = '#e85d04';
  var COLOR_OFF = '#1a1a2e';
  var SCOPE_BG_COLOR = '#0a0a14';
  var SCOPE_WAVE_COLOR = '#4cc9f0';
  var SCOPE_CENTER_COLOR = 'rgba(76, 201, 240, 0.15)';
  var STORAGE_KEY_SURFACE_HINT_SHOWN = 'ssli-surface-hint-shown';
  var HINT_DISMISS_DELAY_MS = 5000;
  var DEFAULT_ROOT_PC = 0;
  var DEFAULT_MODE_KEY = 'ionian';
  var STORAGE_KEY_ROOT = 'ssli-play-root';
  var STORAGE_KEY_MODE = 'ssli-play-mode';

  var _currentCat = 'all';
  var _voicingMode = 'single';
  var _voicingExpansion = {};
  var _initialized = false, _active = false, _baseOctave = DEFAULT_BASE_OCTAVE, _numOctaves = NUM_OCTAVES_DEFAULT;
  var _activeNotes = {}, _keyboardNotes = {}, _sustainOn = false, _sustainedNotes = {}, _transpose = 0;
  var _keyMode = MODE_PIANO, _prevKeyMode = MODE_PIANO, _defaultPresetApplied = false;
  var _rootPc = DEFAULT_ROOT_PC, _modeKey = DEFAULT_MODE_KEY;
  var _screenEl = null, _keyboardEl = null, _noteReadoutEl = null, _presetNameEl = null, _surfaceBarEl = null;
  var _glideTouches = {}, _levelMeterAnimId = null, _currentBendCents = 0;
  var _meterSegments = null, _meterWrapEl = null, _meterSegCount = 0, _meterScopeCanvas = null;

  function midiToName(midi, useFlats) { var pc = midi % SEMITONES_PER_OCTAVE; var oct = Math.floor(midi / SEMITONES_PER_OCTAVE) - 1; return (useFlats ? SL.NOTES_FLAT : NOTES)[pc] + oct; }
  function midiToFreq(midi) { return A4_FREQ * Math.pow(2, (midi - A4_MIDI) / SEMITONES_PER_OCTAVE); }

  function _scaleInterval(scale, fromDeg, degreesUp) {
    var toDeg = (fromDeg + degreesUp) % scale.length;
    var interval = scale[toDeg] - scale[fromDeg];
    if (interval <= 0) { interval += 12; }
    return interval;
  }

  function _expandVoicing(midi) {
    var isNoVoicingSurface = false;
    for (var nv = 0; nv < NO_VOICING_SURFACES.length; nv++) {
      if (NO_VOICING_SURFACES[nv] === _keyMode) { isNoVoicingSurface = true; break; }
    }
    if ((_voicingMode === 'single') || isNoVoicingSurface) { return [midi]; }
    if (_voicingMode === 'octave') { return [midi, midi + 12]; }
    var modeData = SL.MODES[_modeKey];
    var scale = modeData ? modeData.scale : null;
    if (!scale) { return [midi]; }
    var pc = midi % SEMITONES_PER_OCTAVE;
    var relSemi = (pc - _rootPc + SEMITONES_PER_OCTAVE) % SEMITONES_PER_OCTAVE;
    var degree = -1;
    for (var si = 0; si < scale.length; si++) {
      if (scale[si] === relSemi) { degree = si; break; }
    }
    if (degree < 0) { return [midi]; }
    var notes = [midi];
    if (_voicingMode === 'power') {
      notes.push(midi + _scaleInterval(scale, degree, 4));
    } else if (_voicingMode === 'triad') {
      notes.push(midi + _scaleInterval(scale, degree, 2));
      notes.push(midi + _scaleInterval(scale, degree, 4));
    } else if (_voicingMode === 'seventh') {
      notes.push(midi + _scaleInterval(scale, degree, 2));
      notes.push(midi + _scaleInterval(scale, degree, 4));
      notes.push(midi + _scaleInterval(scale, degree, 6));
    }
    return notes;
  }

  function _noteOnRaw(midi, velocity) {
    var transposedMidi = midi + _transpose;
    if ((transposedMidi < MIDI_MIN) || (transposedMidi > MIDI_MAX)) { return; }
    if (midi in _activeNotes) { return; }
    if (SL.audio && SL.audio.getCtx) { var ctx = SL.audio.getCtx(); if (ctx && ctx.state === 'suspended') { ctx.resume(); } }
    var vel = (typeof velocity === 'number') ? velocity : DEFAULT_VELOCITY;
    _activeNotes[midi] = transposedMidi;
    SL.audio.startSustainedNote(transposedMidi, vel);
    requestAnimationFrame(function() { _highlightKey(midi, true); _updateNoteReadout(transposedMidi); });
  }

  function _noteOffRaw(midi) {
    if (!(midi in _activeNotes)) { return; }
    var transposedMidi = _activeNotes[midi]; delete _activeNotes[midi];
    if (_sustainOn) { _sustainedNotes[midi] = transposedMidi; }
    else { SL.audio.stopSustainedNote(transposedMidi); _highlightKey(midi, false); }
  }

  function _noteOn(midi, velocity) {
    var expanded = _expandVoicing(midi);
    if (expanded.length > 1) { _voicingExpansion[midi] = expanded; }
    for (var i = 0; i < expanded.length; i++) { _noteOnRaw(expanded[i], velocity); }
  }

  function _noteOff(midi) {
    var expanded = _voicingExpansion[midi];
    if (expanded) {
      delete _voicingExpansion[midi];
      for (var i = 0; i < expanded.length; i++) { _noteOffRaw(expanded[i]); }
    } else {
      _noteOffRaw(midi);
    }
  }

  function _setSustain(on) {
    _sustainOn = on;
    var susBtn = document.getElementById('ssliSustainBtn');
    if (susBtn) {
      if (on) { susBtn.classList.add('active'); }
      else {
        susBtn.classList.remove('active');
        var keys = Object.keys(_sustainedNotes);
        for (var i = 0; i < keys.length; i++) { var midi = parseInt(keys[i], 10); SL.audio.stopSustainedNote(_sustainedNotes[midi]); _highlightKey(midi, false); }
        _sustainedNotes = {};
      }
    }
  }

  function _stopAllNotes() {
    var midiKeys = Object.keys(_activeNotes);
    for (var i = 0; i < midiKeys.length; i++) { var midi = parseInt(midiKeys[i], 10); SL.audio.stopSustainedNote(_activeNotes[midi]); _highlightKey(midi, false); }
    var susKeys = Object.keys(_sustainedNotes);
    for (var j = 0; j < susKeys.length; j++) { var smidi = parseInt(susKeys[j], 10); SL.audio.stopSustainedNote(_sustainedNotes[smidi]); _highlightKey(smidi, false); }
    _activeNotes = {}; _keyboardNotes = {}; _sustainedNotes = {};
  }

  function _highlightKey(midi, on) { if (!_keyboardEl) { return; } var els = _keyboardEl.querySelectorAll('[data-midi="' + midi + '"]'); for (var i = 0; i < els.length; i++) { if (on) { els[i].classList.add('active'); } else { els[i].classList.remove('active'); } } }
  function _updateNoteReadout(midi) { if (!_noteReadoutEl) { return; } var name = midiToName(midi); var freqVal = midiToFreq(midi); var freqStr = freqVal >= HZ_TO_KHZ_THRESHOLD ? (freqVal / HZ_TO_KHZ_THRESHOLD).toFixed(2) + ' kHz' : freqVal.toFixed(1) + ' Hz'; _noteReadoutEl.textContent = name + ' | ' + freqStr; }

  function _applyPitchBend(cents) { _currentBendCents = cents; if (!SL.audio || !SL.audio.getActiveOscillators) { return; } var activeOscs = SL.audio.getActiveOscillators(); if (!activeOscs || !activeOscs.forEach) { return; } activeOscs.forEach(function(voiceData) { if (!voiceData) { return; } if (voiceData.oscillators) { for (var i = 0; i < voiceData.oscillators.length; i++) { var entry = voiceData.oscillators[i]; if (entry && entry.osc && entry.osc.detune) { if (entry._origDetune === undefined) { entry._origDetune = entry.osc.detune.value; } entry.osc.detune.value = entry._origDetune + cents; } } } if (voiceData.fm && SL.fm && SL.fm.setBend) { SL.fm.setBend(cents); } if (voiceData.physical && SL.physical && SL.physical.setBend) { SL.physical.setBend(cents); } }); }

  function _resetPitchBend() { if (!SL.audio || !SL.audio.getActiveOscillators) { return; } var activeOscs = SL.audio.getActiveOscillators(); if (!activeOscs || !activeOscs.forEach) { return; } activeOscs.forEach(function(voiceData) { if (!voiceData) { return; } if (voiceData.oscillators) { for (var i = 0; i < voiceData.oscillators.length; i++) { var entry = voiceData.oscillators[i]; if (entry && entry.osc && entry.osc.detune && entry._origDetune !== undefined) { entry.osc.detune.value = entry._origDetune; delete entry._origDetune; } } } }); _currentBendCents = 0; }

  function _documentMouseUp() { var keys = Object.keys(_activeNotes); for (var i = 0; i < keys.length; i++) { _noteOff(parseInt(keys[i], 10)); } }
  function _handleKeyDown(e) { if (!_active) { return; } if (e.target && INPUT_ELEMENT_TAGS.test(e.target.tagName)) { return; } var semitone = KEY_TO_SEMITONE[e.code]; if (typeof semitone === 'number') { var midi = (_baseOctave + 1) * SEMITONES_PER_OCTAVE + semitone; if (!_keyboardNotes[e.code]) { _keyboardNotes[e.code] = midi; _noteOn(midi); } e.preventDefault(); } }
  function _handleKeyUp(e) { if (!_active) { return; } if (_keyboardNotes[e.code]) { _noteOff(_keyboardNotes[e.code]); delete _keyboardNotes[e.code]; } }

  function _midiFromPoint(x, y) { var el = document.elementFromPoint(x, y); if (!el) { return -1; } var target = el; while (target && target !== _keyboardEl) { var attr = target.getAttribute('data-midi'); if (attr !== null) { return parseInt(attr, 10); } target = target.parentNode; } return -1; }

  function _glideRelease(e) { for (var i = 0; i < e.changedTouches.length; i++) { var id = e.changedTouches[i].identifier; if (_glideTouches.hasOwnProperty(id)) { if (_glideTouches[id].midi >= 0) { _noteOff(_glideTouches[id].midi); } delete _glideTouches[id]; } } }
  function _attachGlideHandler() { if (!_keyboardEl) { return; } _keyboardEl.addEventListener('touchmove', function(e) { for (var i = 0; i < e.changedTouches.length; i++) { var touch = e.changedTouches[i], id = touch.identifier; if (_glideTouches.hasOwnProperty(id)) { var midi = _midiFromPoint(touch.clientX, touch.clientY), prev = _glideTouches[id].midi; if (midi !== prev) { if (prev >= 0) { _noteOff(prev); } if (midi >= 0) { _noteOn(midi); } _glideTouches[id].midi = midi; } } } }, { passive: true }); _keyboardEl.addEventListener('touchstart', function(e) { for (var i = 0; i < e.changedTouches.length; i++) { var touch = e.changedTouches[i]; _glideTouches[touch.identifier] = { midi: _midiFromPoint(touch.clientX, touch.clientY) }; } }, { passive: true }); _keyboardEl.addEventListener('touchend', function(e) { _glideRelease(e); }, { passive: true }); _keyboardEl.addEventListener('touchcancel', function(e) { _glideRelease(e); }, { passive: true }); document.addEventListener('touchend', function(e) { _glideRelease(e); }, { passive: true }); document.addEventListener('touchcancel', function(e) { _glideRelease(e); }, { passive: true }); }

  function _octaveDown() { if (_baseOctave > 0) { _baseOctave--; _buildKeyboard(); } }
  function _octaveUp() { if (_baseOctave < 7 - _numOctaves) { _baseOctave++; _buildKeyboard(); } }
  function _updateTransposeLabel() {
    var el = document.getElementById('ssliTransposeLabel');
    if (el) {
      var sign = _transpose > 0 ? '+' : '';
      var layout = document.documentElement.getAttribute('data-layout');
      var isPhoneLand = (layout === 'phone-land' || layout === 'phone');
      var text;
      if (isPhoneLand) {
        text = SL.t('ui.label.transpose_short') + ' ' + sign + _transpose;
      } else {
        text = SL.t('ui.label.transpose') + ' ' + sign + _transpose + ' st';
      }
      el.textContent = text;
    }
  }

  function _loadRootAndMode() {
    try {
      var savedRoot = localStorage.getItem(STORAGE_KEY_ROOT);
      if (savedRoot !== null) { _rootPc = parseInt(savedRoot, 10); }
      var savedMode = localStorage.getItem(STORAGE_KEY_MODE);
      if (savedMode && SL.MODES && SL.MODES[savedMode]) { _modeKey = savedMode; }
    } catch (e) { /* unavailable */ }
  }

  function _applyMatchedPreset() {
    var mapping = SL.SURFACE_DEFAULT_PRESETS;
    if (!mapping) { return; }
    var entry = mapping[_keyMode];
    if (!entry) { return; }
    var engineName = entry.engine;
    var presetName = entry.preset;
    var presets = SL.presets.getPresetsForEngineCategory(engineName, 'All');
    var matched = null;
    for (var i = 0; i < presets.length; i++) {
      if (presets[i].name === presetName) {
        matched = presets[i];
        break;
      }
    }
    if (!matched) { return; }
    if (SL.audio && SL.audio.stopAllSustained) {
      SL.audio.stopAllSustained();
    }
    if (SL.audio && SL.audio.getCtx) {
      var ctx = SL.audio.getCtx();
      var isSuspended = (ctx && (ctx.state === 'suspended'));
      if (isSuspended) { ctx.resume(); }
    }
    var engineType = SL.presets.engineNameToType(engineName);
    matched.engine = engineType;
    SL.presets.apply(matched);
    SL.state.notify('preset');
    var engineSel = document.getElementById('ssliEngine');
    if (engineSel) { engineSel.value = engineName; }
    var catSel = document.getElementById('ssliCategory');
    if (catSel) {
      catSel.value = matched.category || 'All';
      var catEv = document.createEvent('HTMLEvents');
      catEv.initEvent('change', true, false);
      catSel.dispatchEvent(catEv);
    }
    var engEv = document.createEvent('HTMLEvents');
    if (engineSel) {
      engEv.initEvent('change', true, false);
      engineSel.dispatchEvent(engEv);
    }
    // Apply FX preset if specified
    var fxPresetId = entry.fx;
    if (fxPresetId && SL.screenEffects && SL.screenEffects.applyPreset) {
      SL.screenEffects.applyPreset(fxPresetId);
    }
    // Also update the Sound screen's FX preset dropdown if visible
    var soundFxSel = document.getElementById('ssliFxPreset');
    if (soundFxSel && fxPresetId) {
      soundFxSel.value = fxPresetId;
    }

    // Apply octave if specified
    var targetOctave = entry.octave;
    var octaveChanged = false;
    if (typeof targetOctave === 'number' && targetOctave !== _baseOctave) {
      _baseOctave = targetOctave;
      octaveChanged = true;
    }

    // Rebuild keyboard if octave changed (updates range label too)
    if (octaveChanged) {
      _buildKeyboard();
    }

    var matchBtnEl = document.querySelector('.ssli-match-btn');
    if (matchBtnEl) {
      matchBtnEl.classList.add('ssli-match-flash');
      setTimeout(function() { matchBtnEl.classList.remove('ssli-match-flash'); }, 400);
    }
  }

  function _updateVoicingVisibility(sel) { if (!sel) { sel = document.getElementById('ssliPlayVoicingSelect'); } if (!sel) { return; } var hide = false; for (var nv = 0; nv < NO_VOICING_SURFACES.length; nv++) { if (NO_VOICING_SURFACES[nv] === _keyMode) { hide = true; break; } } sel.style.display = hide ? 'none' : ''; }
  function _updateRootModeVisibility() { var rootEl = document.getElementById('ssliPlayRootSelect'); var modeEl = document.getElementById('ssliPlayModeSelect'); var hide = false; for (var si = 0; si < NO_ROOT_MODE_SURFACES.length; si++) { if (NO_ROOT_MODE_SURFACES[si] === _keyMode) { hide = true; break; } } if (rootEl) { rootEl.style.display = hide ? 'none' : ''; } if (modeEl) { modeEl.style.display = hide ? 'none' : ''; } }
  function _loadVoicingPreference() { try { var saved = localStorage.getItem(STORAGE_KEY_VOICING); if (saved) { for (var vi = 0; vi < VOICING_MODES.length; vi++) { if (VOICING_MODES[vi].val === saved) { _voicingMode = saved; return; } } } } catch (e) {} }

  function _surfacesForCat(cat) { if (cat === 'all') { var order = SL.ALL_SURFACE_ORDER; var defMap = {}; var di; for (di = 0; di < SURFACE_DEFS.length; di++) { defMap[SURFACE_DEFS[di].val] = SURFACE_DEFS[di]; } var ordered = []; var oi; for (oi = 0; oi < order.length; oi++) { if (defMap[order[oi]]) { ordered.push(defMap[order[oi]]); delete defMap[order[oi]]; } } var remaining = Object.keys(defMap); var ri; for (ri = 0; ri < remaining.length; ri++) { ordered.push(defMap[remaining[ri]]); } return ordered; } var result = []; for (var i = 0; i < SURFACE_DEFS.length; i++) { if (SURFACE_DEFS[i].cat === cat) { result.push(SURFACE_DEFS[i]); } } return result; }
  function _populateSurfaceSelect(sel, cat, selectedVal) { sel.innerHTML = ''; var defs = _surfacesForCat(cat); var foundSelected = false; for (var i = 0; i < defs.length; i++) { var opt = document.createElement('option'); opt.value = defs[i].val; opt.textContent = defs[i].i18n ? SL.t(defs[i].i18n, defs[i].lbl) : defs[i].lbl; if (defs[i].val === selectedVal) { opt.selected = true; foundSelected = true; } sel.appendChild(opt); } if (!foundSelected && sel.options.length > 0) { sel.selectedIndex = 0; } sel.scrollTop = 0; }
  function _catForSurface(val) { for (var i = 0; i < SURFACE_DEFS.length; i++) { if (SURFACE_DEFS[i].val === val) { return SURFACE_DEFS[i].cat; } } return 'keys'; }
  function _buildCategoryOptions(catSel) { var allOpt = document.createElement('option'); allOpt.value = 'all'; allOpt.textContent = SL.t('category.all', 'All'); if (_currentCat === 'all') { allOpt.selected = true; } catSel.appendChild(allOpt); for (var ci = 0; ci < SURFACE_CATEGORIES.length; ci++) { var copt = document.createElement('option'); copt.value = SURFACE_CATEGORIES[ci].val; copt.textContent = SURFACE_CATEGORIES[ci].i18n ? SL.t(SURFACE_CATEGORIES[ci].i18n, SURFACE_CATEGORIES[ci].lbl) : SURFACE_CATEGORIES[ci].lbl; if (SURFACE_CATEGORIES[ci].val === _currentCat) { copt.selected = true; } catSel.appendChild(copt); } }
  function _onCategoryChange(catSel, surfSel) { _currentCat = catSel.value; try { localStorage.setItem(STORAGE_KEY_CATEGORY, _currentCat); } catch (e) {} _populateSurfaceSelect(surfSel, _currentCat, _keyMode); var defs = _surfacesForCat(_currentCat); var found = false; for (var i = 0; i < defs.length; i++) { if (defs[i].val === _keyMode) { found = true; break; } } if (!found && defs.length > 0) { _switchSurface(defs[0].val); } }

  function _addInlineOctaveControls() { if (!_keyboardEl) { return; } var prev = _keyboardEl.querySelector('.perform-inline-oct'); if (prev) { prev.parentNode.removeChild(prev); } var wrap = document.createElement('div'); wrap.className = 'perform-inline-oct'; var catSelect = document.createElement('select'); catSelect.className = 'ssli-surface-select ssli-inline-category-select'; catSelect.id = 'ssliPlayCategorySelect'; catSelect.setAttribute('aria-label', 'Surface Category'); _buildCategoryOptions(catSelect); var surfaceSelect = document.createElement('select'); surfaceSelect.className = 'ssli-surface-select ssli-inline-surface-select'; surfaceSelect.id = 'ssliPlaySurfaceSelect'; surfaceSelect.setAttribute('aria-label', 'Control Surface'); _populateSurfaceSelect(surfaceSelect, _currentCat, _keyMode); catSelect.addEventListener('change', function() { _onCategoryChange(catSelect, surfaceSelect); }); surfaceSelect.addEventListener('change', function() { _switchSurface(surfaceSelect.value); }); wrap.appendChild(catSelect); wrap.appendChild(surfaceSelect); var voicingSelect = document.createElement('select'); voicingSelect.className = 'ssli-surface-select ssli-inline-voicing-select'; voicingSelect.id = 'ssliPlayVoicingSelect'; voicingSelect.setAttribute('aria-label', 'Voicing Mode'); for (var vi = 0; vi < VOICING_MODES.length; vi++) { var vopt = document.createElement('option'); vopt.value = VOICING_MODES[vi].val; vopt.textContent = VOICING_MODES[vi].i18n ? SL.t(VOICING_MODES[vi].i18n, VOICING_MODES[vi].lbl) : VOICING_MODES[vi].lbl; if (VOICING_MODES[vi].val === _voicingMode) { vopt.selected = true; } voicingSelect.appendChild(vopt); } voicingSelect.addEventListener('change', function() { _voicingMode = voicingSelect.value; try { localStorage.setItem(STORAGE_KEY_VOICING, _voicingMode); } catch (e) {} }); _updateVoicingVisibility(voicingSelect); wrap.appendChild(voicingSelect); var matchBtn = document.createElement('button'); matchBtn.className = 'perform-inline-oct-btn ssli-match-btn'; matchBtn.textContent = SL.t('ui.button.best_fit'); matchBtn.title = SL.t('ui.tooltip.best_fit'); matchBtn.setAttribute('aria-label', 'Auto-select best fit preset'); matchBtn.addEventListener('click', function(e) { e.stopPropagation(); _applyMatchedPreset(); }); matchBtn.addEventListener('touchstart', function(e) { e.stopPropagation(); }, { passive: true }); wrap.appendChild(matchBtn); var rootSelect = document.createElement('select'); rootSelect.className = 'ssli-surface-select ssli-inline-root-select'; rootSelect.id = 'ssliPlayRootSelect'; rootSelect.setAttribute('aria-label', 'Root Note'); for (var ri = 0; ri < SEMITONES_PER_OCTAVE; ri++) { var ropt = document.createElement('option'); ropt.value = String(ri); ropt.textContent = NOTES[ri]; if (ri === _rootPc) { ropt.selected = true; } rootSelect.appendChild(ropt); } rootSelect.addEventListener('change', function() { _rootPc = parseInt(rootSelect.value, 10); try { localStorage.setItem(STORAGE_KEY_ROOT, String(_rootPc)); } catch (e) {} SL.state.notify('surface'); _buildKeyboard(); }); wrap.appendChild(rootSelect); var modeSelect = document.createElement('select'); modeSelect.className = 'ssli-surface-select ssli-inline-mode-select'; modeSelect.id = 'ssliPlayModeSelect'; modeSelect.setAttribute('aria-label', 'Scale / Mode'); if (SL.MODES) { var modeKeys = Object.keys(SL.MODES); for (var mi = 0; mi < modeKeys.length; mi++) { var mopt = document.createElement('option'); mopt.value = modeKeys[mi]; var mData = SL.MODES[modeKeys[mi]]; var mFallback = (mData && mData.name) ? mData.name : modeKeys[mi]; mopt.textContent = SL.t('scale.' + modeKeys[mi], mFallback); if (modeKeys[mi] === _modeKey) { mopt.selected = true; } modeSelect.appendChild(mopt); } } modeSelect.addEventListener('change', function() { _modeKey = modeSelect.value; try { localStorage.setItem(STORAGE_KEY_MODE, _modeKey); } catch (e) {} SL.state.notify('surface'); _buildKeyboard(); }); wrap.appendChild(modeSelect); var downBtn = document.createElement('button'); downBtn.className = 'perform-inline-oct-btn'; downBtn.textContent = '\u25C0'; downBtn.title = SL.t('ui.button.octave_down'); downBtn.setAttribute('aria-label', SL.t('ui.button.octave_down')); downBtn.addEventListener('click', function(e) { e.stopPropagation(); _octaveDown(); }); downBtn.addEventListener('touchstart', function(e) { e.stopPropagation(); }, { passive: true }); var label = document.createElement('span'); label.className = 'perform-inline-oct-label'; label.id = 'ssliOctRange'; label.textContent = 'C' + _baseOctave + '-C' + (_baseOctave + _numOctaves); var upBtn = document.createElement('button'); upBtn.className = 'perform-inline-oct-btn'; upBtn.textContent = '\u25B6'; upBtn.title = SL.t('ui.button.octave_up'); upBtn.setAttribute('aria-label', SL.t('ui.button.octave_up')); upBtn.addEventListener('click', function(e) { e.stopPropagation(); _octaveUp(); }); upBtn.addEventListener('touchstart', function(e) { e.stopPropagation(); }, { passive: true }); var susBtn = document.createElement('button'); susBtn.id = 'ssliSustainBtn'; susBtn.className = 'perform-inline-oct-btn perform-sustain-btn'; susBtn.textContent = SL.t('ui.button.sustain'); susBtn.title = SL.t('ui.tooltip.sustain'); susBtn.setAttribute('aria-label', SL.t('ui.tooltip.sustain')); susBtn.addEventListener('click', function(e) { e.stopPropagation(); _setSustain(!_sustainOn); }); susBtn.addEventListener('touchstart', function(e) { e.stopPropagation(); }, { passive: true }); var trDownBtn = document.createElement('button'); trDownBtn.className = 'perform-inline-oct-btn'; trDownBtn.textContent = '\u2212'; trDownBtn.title = SL.t('ui.button.transpose_down'); trDownBtn.setAttribute('aria-label', SL.t('ui.button.transpose_down')); trDownBtn.classList.add('ssli-transpose-down'); trDownBtn.addEventListener('click', function(e) { e.stopPropagation(); if (_transpose > MIN_TRANSPOSE) { _transpose--; _updateTransposeLabel(); } }); trDownBtn.addEventListener('touchstart', function(e) { e.stopPropagation(); }, { passive: true }); var trLabel = document.createElement('span'); trLabel.className = 'perform-inline-oct-label'; trLabel.id = 'ssliTransposeLabel'; trLabel.classList.add('ssli-transpose-label'); var _trInitLayout = document.documentElement.getAttribute('data-layout'); trLabel.textContent = (_trInitLayout === 'phone-land' || _trInitLayout === 'phone') ? SL.t('ui.label.transpose_short') + ' 0' : SL.t('ui.label.transpose') + ' 0'; var trUpBtn = document.createElement('button'); trUpBtn.className = 'perform-inline-oct-btn'; trUpBtn.textContent = '+'; trUpBtn.title = SL.t('ui.button.transpose_up'); trUpBtn.setAttribute('aria-label', SL.t('ui.button.transpose_up')); trUpBtn.classList.add('ssli-transpose-up'); trUpBtn.addEventListener('click', function(e) { e.stopPropagation(); if (_transpose < MAX_TRANSPOSE) { _transpose++; _updateTransposeLabel(); } }); trUpBtn.addEventListener('touchstart', function(e) { e.stopPropagation(); }, { passive: true }); wrap.appendChild(downBtn); wrap.appendChild(label); wrap.appendChild(upBtn); wrap.appendChild(susBtn); wrap.appendChild(trDownBtn); wrap.appendChild(trLabel); wrap.appendChild(trUpBtn); if (_keyboardEl.firstChild) { _keyboardEl.insertBefore(wrap, _keyboardEl.firstChild); } else { _keyboardEl.appendChild(wrap); } _updateRootModeVisibility(); }

  function _buildKeyboard() { if (!_keyboardEl) { return; } _stopAllNotes(); var oldController = SL.controllers ? SL.controllers[_prevKeyMode] : null; if (oldController && oldController.release) { oldController.release(); } if (SL.audio && SL.audio.clearExpression) { SL.audio.clearExpression(); } _prevKeyMode = _keyMode; _keyboardEl.innerHTML = ''; _addInlineOctaveControls(); var ctrlWrapper = document.createElement('div'); ctrlWrapper.className = 'perform-ctrl-wrapper'; _keyboardEl.appendChild(ctrlWrapper); void ctrlWrapper.offsetHeight; var origKbEl = _keyboardEl; _keyboardEl = ctrlWrapper; var opts = { baseOctave: _baseOctave, numOctaves: _numOctaves, noteOn: _noteOn, noteOff: _noteOff, applyPitchBend: _applyPitchBend, resetPitchBendFn: _resetPitchBend, onOctaveAdjust: function(adjusted) { _numOctaves = adjusted; } }; var controller = SL.controllers[_keyMode]; if (controller && controller.build) { controller.build(_keyboardEl, opts); } else { SL.controllers.piano.build(_keyboardEl, opts); } _keyboardEl = origKbEl; _attachGlideHandler(); _applyPitchClassColors(); _updateSurfaceBar(); }

  function _applyPitchClassColors() { var els = _keyboardEl.querySelectorAll('[data-midi]'); for (var i = 0; i < els.length; i++) { var midi = parseInt(els[i].getAttribute('data-midi'), 10); var pc = midi % SEMITONES_PER_OCTAVE; for (var c = 0; c < SEMITONES_PER_OCTAVE; c++) { els[i].classList.remove('pc-' + c); } els[i].classList.add('pc-' + pc); } }

  function _buildSurfaceBar() { _surfaceBarEl = document.createElement('div'); _surfaceBarEl.className = 'ssli-surface-bar'; var catEl = document.createElement('select'); catEl.className = 'ssli-surface-select ssli-bar-category-select'; catEl.id = 'ssliBarCategorySelect'; catEl.setAttribute('aria-label', 'Surface Category'); _buildCategoryOptions(catEl); var selectEl = document.createElement('select'); selectEl.className = 'ssli-surface-select'; selectEl.id = 'ssliBarSurfaceSelect'; selectEl.setAttribute('aria-label', 'Control Surface'); _populateSurfaceSelect(selectEl, _currentCat, _keyMode); catEl.addEventListener('change', function() { _onCategoryChange(catEl, selectEl); }); selectEl.addEventListener('change', function() { _switchSurface(selectEl.value); }); _surfaceBarEl.appendChild(catEl); _surfaceBarEl.appendChild(selectEl); return _surfaceBarEl; }
  function _updateSurfaceBar() { var allCatSels = document.querySelectorAll('.ssli-inline-category-select, .ssli-bar-category-select'); for (var c = 0; c < allCatSels.length; c++) { if (allCatSels[c].value !== _currentCat) { allCatSels[c].value = _currentCat; } } var allSurfSels = document.querySelectorAll('.ssli-inline-surface-select, #ssliBarSurfaceSelect'); for (var i = 0; i < allSurfSels.length; i++) { _populateSurfaceSelect(allSurfSels[i], _currentCat, _keyMode); } }
  function _switchSurface(mode) { if (mode === _keyMode) { return; } _keyMode = mode; try { localStorage.setItem(STORAGE_KEY_SURFACE, mode); } catch (e) { /* unavailable */ } _buildKeyboard(); _syncSoundScreenSurface(); _updateVoicingVisibility(null); _updateRootModeVisibility(); _applyMatchedPreset(); SL.state.notify('surface'); }
  function _syncSoundScreenSurface() { var sel = document.getElementById('ssliSurface'); if (sel && sel.value !== _keyMode) { sel.value = _keyMode; } }
  function _loadSurfacePreference() { _loadVoicingPreference(); try { var savedCat = localStorage.getItem(STORAGE_KEY_CATEGORY); if (savedCat) { var validCat = (savedCat === 'all'); if (!validCat) { for (var ci = 0; ci < SURFACE_CATEGORIES.length; ci++) { if (SURFACE_CATEGORIES[ci].val === savedCat) { validCat = true; break; } } } if (validCat) { _currentCat = savedCat; } } } catch (e) {} try { var saved = localStorage.getItem(STORAGE_KEY_SURFACE); if (saved) { for (var i = 0; i < SURFACE_DEFS.length; i++) { if (SURFACE_DEFS[i].val === saved) { _keyMode = saved; return; } } } } catch (e) {} }

  function _restartLevelMeter() { if (_meterSegments && _meterWrapEl) { _startLevelMeterAndScope(_meterSegments, _meterWrapEl, _meterSegCount, _meterScopeCanvas); } }
  function _startLevelMeterAndScope(segments, wrapEl, segCount, scopeCanvas) { _meterSegments = segments; _meterWrapEl = wrapEl; _meterSegCount = segCount; _meterScopeCanvas = scopeCanvas; var analyser = (SL.audio && SL.audio.getAnalyser) ? SL.audio.getAnalyser() : null; var timeDomainBuf = null; var scopeCtx = scopeCanvas ? scopeCanvas.getContext('2d') : null; function animate() { _levelMeterAnimId = requestAnimationFrame(animate); if (!analyser) { analyser = (SL.audio && SL.audio.getAnalyser) ? SL.audio.getAnalyser() : null; if (!analyser) { return; } } if (!timeDomainBuf) { timeDomainBuf = new Uint8Array(analyser.fftSize); } analyser.getByteTimeDomainData(timeDomainBuf); var peak = 0; for (var i = 0; i < timeDomainBuf.length; i++) { var sample = Math.abs(timeDomainBuf[i] - 128) / 128; if (sample > peak) { peak = sample; } } var litCount = Math.round(peak * segCount); for (var s = 0; s < segCount; s++) { var isLit = (s < litCount); var segColor = COLOR_OFF; if (isLit) { if (s <= SEGMENT_THRESHOLD_GREEN_MAX) { segColor = COLOR_GREEN; } else if (s <= SEGMENT_THRESHOLD_AMBER_MAX) { segColor = COLOR_AMBER; } else { segColor = COLOR_WARM_ORANGE; } } segments[s].style.background = segColor; } wrapEl.setAttribute('aria-valuenow', String(Math.round(peak * 100))); if (scopeCtx && scopeCanvas) { var cw = scopeCanvas.width, ch = scopeCanvas.height; scopeCtx.fillStyle = SCOPE_BG_COLOR; scopeCtx.fillRect(0, 0, cw, ch); scopeCtx.strokeStyle = SCOPE_CENTER_COLOR; scopeCtx.lineWidth = 1; scopeCtx.beginPath(); scopeCtx.moveTo(0, ch / 2); scopeCtx.lineTo(cw, ch / 2); scopeCtx.stroke(); scopeCtx.strokeStyle = SCOPE_WAVE_COLOR; scopeCtx.lineWidth = 1.5; scopeCtx.beginPath(); var sliceWidth = cw / timeDomainBuf.length, x = 0; for (var wi = 0; wi < timeDomainBuf.length; wi++) { var v = timeDomainBuf[wi] / 128.0, y = (v * ch) / 2; if (wi === 0) { scopeCtx.moveTo(x, y); } else { scopeCtx.lineTo(x, y); } x += sliceWidth; } scopeCtx.stroke(); } } if (_levelMeterAnimId) { cancelAnimationFrame(_levelMeterAnimId); } animate(); }

  function _showSurfaceDiscoveryHint(surfaceBarEl) { if (!surfaceBarEl) { return; } var alreadyShown = false; try { alreadyShown = (localStorage.getItem(STORAGE_KEY_SURFACE_HINT_SHOWN) === '1'); } catch (e) { /* unavailable */ } if (alreadyShown) { return; } var hint = document.createElement('div'); hint.className = 'ssli-surface-hint'; hint.textContent = SL.t('ui.hint.surface_discovery'); surfaceBarEl.style.position = 'relative'; surfaceBarEl.appendChild(hint); var dismissed = false; function dismiss() { if (dismissed) { return; } dismissed = true; hint.style.opacity = '0'; setTimeout(function() { if (hint.parentNode) { hint.parentNode.removeChild(hint); } }, 300); try { localStorage.setItem(STORAGE_KEY_SURFACE_HINT_SHOWN, '1'); } catch (e) { /* unavailable */ } } hint.addEventListener('click', dismiss); setTimeout(dismiss, HINT_DISMISS_DELAY_MS); }

  function _onLimiterEngage(isEngaged) { var limitBadgeEl = document.getElementById('ssliLimitBadge'); if (limitBadgeEl) { if (isEngaged) { limitBadgeEl.classList.add('active'); } else { limitBadgeEl.classList.remove('active'); } } }

  function _currentEngineName() {
    var engineName = 'Subtractive';
    var engineSel = document.getElementById('ssliEngine');
    if (engineSel && engineSel.value) {
      engineName = engineSel.value;
    } else if (SL.audio && SL.audio.getInstrumentType && SL.audio.getCurrentInstrument) {
      var t = SL.audio.getInstrumentType(SL.audio.getCurrentInstrument());
      if (SL.presets && SL.presets.getEngines) {
        var engs = SL.presets.getEngines();
        for (var i = 0; i < engs.length; i++) {
          if (SL.presets.engineNameToType(engs[i]) === t) { engineName = engs[i]; break; }
        }
      }
    }
    return engineName;
  }

  var BAD_NAME_TOKENS = ['silence', 'broken', 'test'];
  function _presetIsAudible(p) {
    var nm = (p && p.name ? p.name : '').toLowerCase();
    for (var i = 0; i < BAD_NAME_TOKENS.length; i++) {
      if (nm.indexOf(BAD_NAME_TOKENS[i]) >= 0) { return false; }
    }
    var s = (p && p.settings) ? p.settings : null;
    if (s) {
      if (s.noise && typeof s.noise.level === 'number' && s.noise.level > 50) { return false; }
      if (s.filter && typeof s.filter.freq === 'number' && s.filter.freq < 50) { return false; }
    }
    return true;
  }

  function _collectAllEnginePresets() {
    var all = [];
    if (!SL.presets || !SL.presets.getEngines) { return all; }
    var engs = SL.presets.getEngines();
    for (var i = 0; i < engs.length; i++) {
      var list = SL.presets.listForEngine ? SL.presets.listForEngine(engs[i]) : [];
      var engType = SL.presets.engineNameToType(engs[i]);
      for (var j = 0; j < list.length; j++) {
        var tagged = list[j];
        tagged.engine = engType;
        all.push(tagged);
      }
    }
    return all;
  }

  function _pulseEl(el) {
    if (!el) { return; }
    el.classList.add('ssli-surprise-pulse');
    setTimeout(function() { el.classList.remove('ssli-surprise-pulse'); }, 200);
  }

  function _onSurpriseMe(e) {
    var useAllEngines = !!(e && e.shiftKey);
    var pool = [];
    if (useAllEngines) {
      pool = _collectAllEnginePresets();
    } else {
      var engineName = _currentEngineName();
      var list = SL.presets.listForEngine ? SL.presets.listForEngine(engineName) : [];
      var engType = SL.presets.engineNameToType(engineName);
      for (var k = 0; k < list.length; k++) { list[k].engine = engType; pool.push(list[k]); }
    }
    var audible = [];
    for (var i = 0; i < pool.length; i++) { if (_presetIsAudible(pool[i])) { audible.push(pool[i]); } }
    if (audible.length === 0) { return; }
    var chosen = audible[Math.floor(Math.random() * audible.length)];
    if (SL.presets && SL.presets.apply) {
      if (SL.audio && SL.audio.stopAllSustained) { SL.audio.stopAllSustained(); }
      if (SL.audio && SL.audio.getCtx) { var ctx = SL.audio.getCtx(); if (ctx && ctx.state === 'suspended') { ctx.resume(); } }
      SL.presets.apply(chosen);
      SL.state.notify('preset');
    }
    var btn = document.getElementById('ssliSurpriseBtn');
    _pulseEl(btn);
    var presetSel = document.getElementById('ssliPreset');
    _pulseEl(presetSel);
  }

  function _buildScreen() { _screenEl = document.getElementById('ssli-screen-play'); if (!_screenEl) { return; } _screenEl.innerHTML = ''; _loadSurfacePreference(); _loadRootAndMode(); var infoRow = document.createElement('div'); infoRow.className = 'ssli-play-info-row'; var levelMeterWrap = document.createElement('div'); levelMeterWrap.className = 'ssli-level-meter-wrap'; levelMeterWrap.setAttribute('aria-label', 'Audio level meter'); levelMeterWrap.setAttribute('role', 'meter'); levelMeterWrap.setAttribute('aria-valuemin', '0'); levelMeterWrap.setAttribute('aria-valuemax', '100'); levelMeterWrap.setAttribute('aria-valuenow', '0'); var levelSegments = []; for (var segIdx = 0; segIdx < LEVEL_METER_SEGMENT_COUNT; segIdx++) { var seg = document.createElement('div'); seg.className = 'ssli-level-seg'; levelMeterWrap.appendChild(seg); levelSegments.push(seg); } infoRow.appendChild(levelMeterWrap); var scopeWrap = document.createElement('div'); scopeWrap.className = 'ssli-scope-wrap'; var scopeCanvas = document.createElement('canvas'); scopeCanvas.className = 'ssli-oscilloscope'; scopeCanvas.width = 300; scopeCanvas.height = 36; scopeCanvas.setAttribute('aria-label', 'Audio waveform oscilloscope'); scopeWrap.appendChild(scopeCanvas); var limitBadge = document.createElement('span'); limitBadge.className = 'ssli-limit-badge'; limitBadge.id = 'ssliLimitBadge'; limitBadge.textContent = SL.t('ui.button.limit'); limitBadge.title = 'Output limiter -- lights up when gain reduction is active'; limitBadge.setAttribute('aria-label', 'Output limiter indicator'); scopeWrap.appendChild(limitBadge); infoRow.appendChild(scopeWrap); _noteReadoutEl = document.createElement('div'); _noteReadoutEl.className = 'ssli-play-note-readout'; _noteReadoutEl.id = 'ssliNoteReadout'; _noteReadoutEl.textContent = '--'; _noteReadoutEl.setAttribute('aria-live', 'polite'); _noteReadoutEl.setAttribute('aria-label', 'Note readout'); infoRow.appendChild(_noteReadoutEl); _screenEl.appendChild(infoRow); _startLevelMeterAndScope(levelSegments, levelMeterWrap, LEVEL_METER_SEGMENT_COUNT, scopeCanvas); var kbWrap = document.createElement('div'); kbWrap.className = 'ssli-play-keyboard-wrap'; _keyboardEl = document.createElement('div'); _keyboardEl.className = 'keyboard performKeyboard'; _keyboardEl.id = 'ssliKeyboard'; _keyboardEl.setAttribute('role', 'application'); _keyboardEl.setAttribute('aria-label', 'Piano keyboard'); kbWrap.appendChild(_keyboardEl); _screenEl.appendChild(kbWrap); _buildKeyboard(); }

  function _updatePresetName() { /* Preset display removed from Play screen — shown on Sound screen only */ }

  function _onStateChange(what) { if (!_active) { return; } if (what === 'preset' || what === 'instrument') { _updatePresetName(); } if (what === 'surface') { var sel = document.getElementById('ssliSurface'); if (sel && sel.value !== _keyMode) { _keyMode = sel.value; try { localStorage.setItem(STORAGE_KEY_SURFACE, _keyMode); } catch (e) { /* unavailable */ } _buildKeyboard(); } } }

  function activate() {
    _active = true;
    if (!_initialized) {
      _buildScreen();
      _initialized = true;
      if (!_defaultPresetApplied && SL.presets && SL.presets.applyDefault) { SL.presets.applyDefault(); _defaultPresetApplied = true; }
      document.addEventListener('mouseup', _documentMouseUp);
      document.addEventListener('keydown', _handleKeyDown);
      document.addEventListener('keyup', _handleKeyUp);

      // Re-translate all visible text when the UI language changes
      if (SL.localization && SL.localization.onLanguageChange) {
        SL.localization.onLanguageChange(function() {
          if (_active) {
            _buildScreen();
          }
        });
      }
    } else {
      _restartLevelMeter();
    }
    _updatePresetName();
    SL.state.onChange(_onStateChange);
    if (SL.audio) { SL.audio.onLimiterEngage = _onLimiterEngage; }
    if (_keyboardEl) { _buildKeyboard(); }
  }
  function deactivate() { _active = false; _stopAllNotes(); if (_levelMeterAnimId) { cancelAnimationFrame(_levelMeterAnimId); _levelMeterAnimId = null; } if (SL.controllers && SL.controllers.chordpads && SL.controllers.chordpads.clearStrumTimeouts) { SL.controllers.chordpads.clearStrumTimeouts(); } SL.state.removeListener(_onStateChange); }

  SL.screenPlay = { activate: activate, deactivate: deactivate, noteOn: _noteOn, noteOff: _noteOff, stopAllNotes: _stopAllNotes, getRootPc: function() { return _rootPc; }, getModeKey: function() { return _modeKey; }, getSurface: function() { return _keyMode; } };
})();
