// SSLI Controller: Breath Pad Ensemble (multi-pad expressive chord surface)
// ES5 compatible (var, no arrow functions, no template literals)
//
// Behavior:
//   - User picks Octave / Root / Mode / Chord-quality / Inversion / Note count.
//   - The chord notes are computed and rendered as N side-by-side mini breath pads.
//   - Each mini pad plays exactly one MIDI note of the chord.
//   - Pointer down -> note-on. Pointer move -> X/Y expression. Pointer up -> note-off.
//   - Sustain is forced to 100 while ANY pad is held; restored when ALL released.
//
// Interpretation choice:
//   The Root dropdown selects the chord's root pitch class directly.
//   Mode is INFORMATIONAL ONLY in this controller (displayed for reference;
//   does NOT alter chord intervals). The chord-quality table determines the
//   semitone intervals used. This avoids ambiguity around scale-degree mapping
//   when an arbitrary chord quality is overlaid on a mode.
//
// v1 known limit:
//   SL.audio.setExpression(cutoffHz, gain) is per-instrument, not per-voice,
//   so X/Y expression and pitch-bend vibrato are SHARED across the chord
//   (last-write-wins). The chord still sounds polyphonic because each mini-pad
//   triggers an independent voice. Per-voice expression requires a VoiceMod
//   bus that has not been built yet.

(function() {
  'use strict';

  var SL = window.SynthLab;
  var CHROMATIC_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var NOTES = (SL && SL.NOTES) ? SL.NOTES : CHROMATIC_NOTE_NAMES;

  // ============================================================
  // Constants
  // ============================================================

  var DEFAULT_CONTAINER_WIDTH = 900;
  var DEFAULT_CONTAINER_HEIGHT = 320;

  var PAD_PADDING_PX = 6;
  var SEMITONES_PER_OCTAVE = 12;
  var OCTAVE_BASE_OFFSET = 1; // baseOctave 3 -> MIDI octave 4 (C4 = 60)
  var CONTROL_ROW_HEIGHT_PX = 40;
  var CONTROL_GAP_PX = 6;
  var MINI_PAD_GAP_PX = 6;

  var OCTAVE_MIN = 1;
  var OCTAVE_MAX = 6;
  var DEFAULT_OCTAVE = 3;

  // Note count selector range
  var NOTE_COUNT_MIN = 1;
  var NOTE_COUNT_MAX = 5;
  var DEFAULT_NOTE_COUNT = 3;

  // Maximum simultaneous ensemble voices to avoid CPU overload.
  // The synth worklet runs 3 oscillators x 7 supersaw sub-voices per note;
  // 4 simultaneous voices = 84 oscillators which is the practical ceiling
  // on mobile and low-end hardware. Oldest voice is stolen when exceeded.
  var MAX_ENSEMBLE_VOICES = 4;

  // Inversion selector range (clamped at runtime to chord_size - 1)
  var INVERSION_MIN = 0;
  var INVERSION_MAX = 3;
  var DEFAULT_INVERSION = 0;

  var DEFAULT_ROOT_PC = 0;
  var DEFAULT_CHORD_KEY = 'M';

  // Chromatic note grid layout: 2 columns x 6 rows
  var NOTE_GRID_COLS = 2;
  var NOTE_GRID_ROWS = 6;
  var NOTE_GRID_GAP_PX = 4;
  var NOTE_GRID_WIDTH_PX = 110;

  // Chord-quality interval tables (semitones from root).
  // Order in CHORD_KEYS controls the dropdown order.
  var CHORD_KEYS = ['M', 'm', 'dim', 'aug', 'sus2', 'sus4', '7', 'M7', 'm7', 'dim7', 'm7b5', 'add9', '9', 'M9', 'm9', '6', 'm6'];
  var CHORD_DEFS = {
    'M':     { lbl: 'Maj',     intervals: [0, 4, 7] },
    'm':     { lbl: 'min',     intervals: [0, 3, 7] },
    'dim':   { lbl: 'dim',     intervals: [0, 3, 6] },
    'aug':   { lbl: 'aug',     intervals: [0, 4, 8] },
    'sus2':  { lbl: 'sus2',    intervals: [0, 2, 7] },
    'sus4':  { lbl: 'sus4',    intervals: [0, 5, 7] },
    '7':     { lbl: '7',       intervals: [0, 4, 7, 10] },
    'M7':    { lbl: 'maj7',    intervals: [0, 4, 7, 11] },
    'm7':    { lbl: 'min7',    intervals: [0, 3, 7, 10] },
    'dim7':  { lbl: 'dim7',    intervals: [0, 3, 6, 9] },
    'm7b5':  { lbl: 'm7b5',    intervals: [0, 3, 6, 10] },
    'add9':  { lbl: 'add9',    intervals: [0, 4, 7, 14] },
    '9':     { lbl: '9',       intervals: [0, 4, 7, 10, 14] },
    'M9':    { lbl: 'maj9',    intervals: [0, 4, 7, 11, 14] },
    'm9':    { lbl: 'min9',    intervals: [0, 3, 7, 10, 14] },
    '6':     { lbl: '6',       intervals: [0, 4, 7, 9] },
    'm6':    { lbl: 'min6',    intervals: [0, 3, 7, 9] }
  };

  // CC74 cutoff mapping (matches single breath pad)
  var CUTOFF_MIN_HZ = 1000;
  var CUTOFF_MAX_HZ = 12000;
  var LN_CUTOFF_MIN = Math.log(CUTOFF_MIN_HZ);
  var LN_CUTOFF_MAX = Math.log(CUTOFF_MAX_HZ);
  var BREATH_GAIN_MIN = 0.55;
  var BREATH_GAIN_MAX = 1.0;

  var CC_MAX = 127;

  // Vibrato (CC1 -> pitch-bend sine)
  var VIBRATO_RATE_HZ = 5.5;
  var VIBRATO_MAX_CENTS = 35;
  var PRESSURE_NEUTRAL = 0.5;
  var PRESSURE_EPSILON = 0.001;
  var DELTAY_FULL_TRAVEL_PX = 180;

  // Visual feedback
  var DOT_MIN_RADIUS_PX = 10;
  var DOT_MAX_RADIUS_PX = 32;
  var GRID_MAJOR_FRAC = 0.5;
  var GRID_QUARTER_FRAC = 0.25;

  // Animation
  var FRAME_MS = 16;

  // Polyphony-aware gain attenuation
  // Polyphony headroom is handled by formant-engine voiceScale (1/sqrt(N))
  // Do NOT scale gain here — that causes double-attenuation.

  // Sustain override
  var BREATH_HELD_SUSTAIN = 100;

  // ============================================================
  // Module-level shared state
  // ============================================================

  // Active pad bookkeeping. Map pointerId -> { pad, midi, strikeY, lastY, lastPressure, animId, animStartMs, dot, xBar, yBar, readout, padEl }
  var _activePointers = {};
  var _activeCount = 0;

  // Frame-throttled expression: instead of calling setExpression on every
  // pointermove for every finger, we mark pads dirty and apply once per rAF.
  // _expressionPending[padIdx] = { xFrac, yFrac } or null
  var _expressionPending = {};
  var _expressionDirty = false;

  // Sustain save/restore (shared because sustain override is global)
  var _savedSustain = null;
  var _savedSustainInst = -1;

  // Cached refs (populated at build time so panic teardown can access)
  var _currentNoteOff = null;
  var _currentApplyPitchBend = null;
  var _currentResetPitchBend = null;

  // Selection state (preserved across rebuilds within the controller instance)
  var _baseOctave = DEFAULT_OCTAVE;
  var _rootPc = DEFAULT_ROOT_PC;
  var _chordKey = DEFAULT_CHORD_KEY;
  var _inversion = DEFAULT_INVERSION;
  var _noteCount = DEFAULT_NOTE_COUNT;

  // When the user picks a chord from the left-side diatonic chord panel
  // (or a variant of it), these override the CHORD_DEFS[_chordKey]
  // lookup so the pads reflect the exact chord type chosen. Changing
  // the Chord dropdown manually clears them.
  var _activeIntervals = null;
  var _activeDegree = -1;

  // ============================================================
  // Helpers
  // ============================================================

  function _clamp01(v) {
    var result;
    if (v < 0) {
      result = 0;
    } else if (v > 1) {
      result = 1;
    } else {
      result = v;
    }
    return result;
  }

  function _clampInt(v, lo, hi) {
    var result;
    if (v < lo) {
      result = lo;
    } else if (v > hi) {
      result = hi;
    } else {
      result = v;
    }
    return result;
  }

  function _midiToName(midi) {
    var pc = ((midi % SEMITONES_PER_OCTAVE) + SEMITONES_PER_OCTAVE) % SEMITONES_PER_OCTAVE;
    var oct = Math.floor(midi / SEMITONES_PER_OCTAVE) - 1;
    return NOTES[pc] + oct;
  }

  // Build chord notes from Root + Chord-quality + Inversion + Count.
  // (Mode is informational and intentionally not used here.)
  // Algorithm: take chord intervals, rotate by inversion (each rotated tone +12),
  // then extend by octave-up repeats if count > chord size.
  function _buildChordMidis(baseOctave, rootPc, chordKey, inversion, count, overrideIntervals) {
    var intervals;
    if (overrideIntervals && overrideIntervals.length > 0) {
      intervals = overrideIntervals;
    } else {
      var def = CHORD_DEFS[chordKey] || CHORD_DEFS[DEFAULT_CHORD_KEY];
      intervals = def.intervals;
    }
    var chordSize = intervals.length;
    var safeInv = _clampInt(inversion, 0, chordSize - 1);

    var rootMidi = ((baseOctave + OCTAVE_BASE_OFFSET) * SEMITONES_PER_OCTAVE) + rootPc;

    // Apply inversion: first `safeInv` tones get bumped +12.
    var inverted = [];
    var ii;
    for (ii = 0; ii < chordSize; ii++) {
      var semis = intervals[ii];
      if (ii < safeInv) {
        semis = semis + SEMITONES_PER_OCTAVE;
      }
      inverted.push(semis);
    }
    // Sort ascending so the visual order matches pitch order.
    inverted.sort(function(a, b) { return a - b; });

    // Extend by octave-up repeats if requested count exceeds chord size.
    var notes = [];
    var ni;
    for (ni = 0; ni < count; ni++) {
      var srcIdx = ni % chordSize;
      var octBumps = Math.floor(ni / chordSize);
      var midi = rootMidi + inverted[srcIdx] + (octBumps * SEMITONES_PER_OCTAVE);
      notes.push(midi);
    }
    return notes;
  }

  function _effectivePressure(rawPressure, deltaYPx) {
    var hasRealPressure = (rawPressure > PRESSURE_EPSILON) && (Math.abs(rawPressure - PRESSURE_NEUTRAL) > PRESSURE_EPSILON);
    var result;
    if (hasRealPressure) {
      result = _clamp01(rawPressure);
    } else {
      result = _clamp01(Math.abs(deltaYPx) / DELTAY_FULL_TRAVEL_PX);
    }
    return result;
  }

  // Mark expression dirty for a given pointer. The actual setExpression call
  // happens once per rAF frame in _sharedVibratoTick, combining all active
  // pads' values (averaged) to avoid per-finger-per-move contention.
  function _markExpressionDirty(pointerId, xFrac, yFrac) {
    _expressionPending[pointerId] = { xFrac: xFrac, yFrac: yFrac };
    _expressionDirty = true;
  }

  // Compute combined expression from all dirty+active pads and call
  // setExpression ONCE. Called from the shared rAF loop.
  function _flushExpression() {
    if (!_expressionDirty) { return; }
    _expressionDirty = false;

    var totalXFrac = 0;
    var totalYFrac = 0;
    var count = 0;
    var pid;
    for (pid in _expressionPending) {
      if (_expressionPending.hasOwnProperty(pid)) {
        var entry = _expressionPending[pid];
        totalXFrac = totalXFrac + entry.xFrac;
        totalYFrac = totalYFrac + entry.yFrac;
        count = count + 1;
      }
    }

    var avgXFrac = (count > 0) ? (totalXFrac / count) : 0;
    var avgYFrac = (count > 0) ? (totalYFrac / count) : 0;

    var cutoffHz = Math.exp(LN_CUTOFF_MIN + avgXFrac * (LN_CUTOFF_MAX - LN_CUTOFF_MIN));
    var gain = BREATH_GAIN_MIN + avgYFrac * (BREATH_GAIN_MAX - BREATH_GAIN_MIN);


    if (SL.audio && SL.audio.setExpression) {
      SL.audio.setExpression(cutoffHz, gain);
    }
  }

  function _clearTimbre() {
    if (SL.audio && SL.audio.clearExpression) {
      SL.audio.clearExpression();
    }
  }

  function _saveAndForceSustain() {
    if (_savedSustain !== null) { return; } // already saved
    if (!(SL.audio && SL.audio.getInstruments && SL.audio.getCurrentInstrument)) { return; }
    var instId = SL.audio.getCurrentInstrument();
    var insts = SL.audio.getInstruments();
    var inst = insts ? insts[instId] : null;
    if (inst && inst.settings && inst.settings.adsr) {
      _savedSustainInst = instId;
      _savedSustain = inst.settings.adsr.s;
      inst.settings.adsr.s = BREATH_HELD_SUSTAIN;
    }
  }

  function _restoreSustain() {
    if (_savedSustain === null || _savedSustainInst < 0) { return; }
    if (!(SL.audio && SL.audio.getInstruments)) {
      _savedSustain = null;
      _savedSustainInst = -1;
      return;
    }
    var insts = SL.audio.getInstruments();
    var inst = insts ? insts[_savedSustainInst] : null;
    if (inst && inst.settings && inst.settings.adsr) {
      inst.settings.adsr.s = _savedSustain;
    }
    _savedSustain = null;
    _savedSustainInst = -1;
  }

  function _updateMiniVisual(state, relX, relY, pressure, xCC, yCC) {
    if (state.dot) {
      var radius = DOT_MIN_RADIUS_PX + pressure * (DOT_MAX_RADIUS_PX - DOT_MIN_RADIUS_PX);
      state.dot.style.left = relX + 'px';
      state.dot.style.top = relY + 'px';
      state.dot.style.width = (radius * 2) + 'px';
      state.dot.style.height = (radius * 2) + 'px';
      state.dot.style.marginLeft = (-radius) + 'px';
      state.dot.style.marginTop = (-radius) + 'px';
      state.dot.style.display = 'block';
    }
    if (state.xBar) {
      state.xBar.style.width = Math.floor((xCC / CC_MAX) * 100) + '%';
    }
    if (state.yBar) {
      state.yBar.style.height = Math.floor((yCC / CC_MAX) * 100) + '%';
    }
    if (state.readout) {
      state.readout.textContent = _midiToName(state.midi) + '  CC74:' + xCC + '  CC2:' + yCC;
    }
  }

  function _hideMiniVisual(state) {
    if (state.dot) { state.dot.style.display = 'none'; }
    if (state.xBar) { state.xBar.style.width = '0%'; }
    if (state.yBar) { state.yBar.style.height = '0%'; }
    if (state.readout) { state.readout.textContent = _midiToName(state.midi); }
  }

  // Shared rAF vibrato loop — processes ALL active pads in one frame
  // instead of per-pad setTimeout loops. Throttles setExpression to 1x/frame.
  var _sharedVibratoRafId = 0;
  var _lastExpressionFrameTs = 0;

  function _sharedVibratoTick() {
    var nowMs = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    var hasActive = false;
    var maxCents = 0;
    var k;
    for (k in _activePointers) {
      var state = _activePointers[k];
      if (!state) { continue; }
      hasActive = true;
      var deltaYPx = state.lastY - state.strikeY;
      var depth = _effectivePressure(state.lastPressure, deltaYPx);
      var phase = ((nowMs - state.animStartMs) / 1000) * VIBRATO_RATE_HZ * 2 * Math.PI;
      var cents = Math.sin(phase) * depth * VIBRATO_MAX_CENTS;
      var absCents = Math.abs(cents);
      if (absCents > Math.abs(maxCents)) {
        maxCents = cents;
      }
    }
    if (hasActive) {
      // Throttle: one pitchBend + expression call per rAF frame
      var frameDelta = nowMs - _lastExpressionFrameTs;
      var shouldApply = (frameDelta >= FRAME_MS);
      if (shouldApply) {
        if (_currentApplyPitchBend) {
          _currentApplyPitchBend(maxCents);
        }
        // Flush combined expression from all active pads (once per frame)
        _flushExpression();
        _lastExpressionFrameTs = nowMs;
      }
      _sharedVibratoRafId = requestAnimationFrame(_sharedVibratoTick);
    } else {
      _sharedVibratoRafId = 0;
    }
  }

  function _startVibratoLoop(state) {
    state.animStartMs = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    // Start the shared rAF loop if not already running
    var loopAlreadyRunning = (_sharedVibratoRafId !== 0);
    if (!loopAlreadyRunning) {
      _sharedVibratoRafId = requestAnimationFrame(_sharedVibratoTick);
    }
  }

  function _stopVibratoLoop(state) {
    // Individual state cleanup only; shared loop self-terminates when no active pointers remain
    if (state) {
      state.animId = 0;
    }
  }

  function _releasePointer(pointerId) {
    var state = _activePointers[pointerId];
    if (!state) { return; }
    delete _activePointers[pointerId];
    delete _expressionPending[pointerId];
    _activeCount--;
    if (_activeCount < 0) { _activeCount = 0; }

    _stopVibratoLoop(state);
    if (_currentNoteOff && state.midi >= 0) {
      _currentNoteOff(state.midi);
    }
    _hideMiniVisual(state);

    if (_activeCount === 0) {
      // Last pointer released: reset shared expression / pitchbend / sustain.
      if (_currentResetPitchBend) { _currentResetPitchBend(); }
      _clearTimbre();
      _restoreSustain();
    }
  }

  function _releaseAllPointers() {
    var ids = [];
    var k;
    for (k in _activePointers) {
      if (_activePointers.hasOwnProperty(k)) {
        ids.push(k);
      }
    }
    var i;
    for (i = 0; i < ids.length; i++) {
      _releasePointer(ids[i]);
    }
  }

  // Document-level safety: release all pointers if any escape the pads.
  function _documentPointerUp(e) {
    if (typeof e.pointerId !== 'undefined' && _activePointers[e.pointerId]) {
      _releasePointer(e.pointerId);
    }
  }
  document.addEventListener('pointerup', _documentPointerUp);
  document.addEventListener('pointercancel', _documentPointerUp);

  // ============================================================
  // Build
  // ============================================================

  function _buildBreathPadEnsembleController(container, opts) {
    var noteOn = opts.noteOn;
    var noteOff = opts.noteOff;
    var applyPitchBend = opts.applyPitchBend;
    var resetPitchBendFn = opts.resetPitchBendFn;

    if (typeof opts.baseOctave === 'number') {
      _baseOctave = _clampInt(opts.baseOctave, OCTAVE_MIN, OCTAVE_MAX);
    }

    _currentNoteOff = noteOff;
    _currentApplyPitchBend = applyPitchBend;
    _currentResetPitchBend = resetPitchBendFn;

    var containerW = container.clientWidth || DEFAULT_CONTAINER_WIDTH;
    var containerH = container.clientHeight || DEFAULT_CONTAINER_HEIGHT;

    var wrapper = document.createElement('div');
    wrapper.className = 'ctrl-breathpadens-wrapper ssli-breathpadens-wrapper';
    wrapper.style.width = containerW + 'px';
    wrapper.style.height = containerH + 'px';
    wrapper.style.position = 'relative';
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.boxSizing = 'border-box';

    // ---------- Control row (Oct, Chord, Inv, Notes — root/mode removed) ----------
    var controlRow = document.createElement('div');
    controlRow.className = 'ssli-breathpadens-controls';
    controlRow.style.display = 'flex';
    controlRow.style.alignItems = 'center';
    controlRow.style.gap = CONTROL_GAP_PX + 'px';
    controlRow.style.padding = '4px ' + PAD_PADDING_PX + 'px';
    controlRow.style.height = CONTROL_ROW_HEIGHT_PX + 'px';
    controlRow.style.boxSizing = 'border-box';
    controlRow.style.flex = '0 0 auto';

    // Helper: create a labeled dropdown group (label + select in a wrapper div)
    function _makeLabeledSelect(labelText, selectEl) {
      var group = document.createElement('div');
      group.style.display = 'flex';
      group.style.flexDirection = 'column';
      group.style.alignItems = 'flex-start';
      group.style.gap = '1px';

      var lbl = document.createElement('span');
      lbl.className = 'ssli-breathpadens-dropdown-label';
      lbl.textContent = labelText;
      lbl.style.fontSize = '9px';
      lbl.style.fontFamily = 'monospace';
      lbl.style.color = 'rgba(200, 220, 240, 0.75)';
      lbl.style.letterSpacing = '0.5px';
      lbl.style.pointerEvents = 'none';
      group.appendChild(lbl);
      group.appendChild(selectEl);
      return group;
    }

    // Octave dropdown
    var octSelect = document.createElement('select');
    octSelect.className = 'ssli-breathpadens-oct-select';
    octSelect.title = SL.t('breathpadens.octave_title');
    var oi;
    for (oi = OCTAVE_MIN; oi <= OCTAVE_MAX; oi++) {
      var oOpt = document.createElement('option');
      oOpt.value = String(oi);
      oOpt.textContent = String(oi);
      if (oi === _baseOctave) { oOpt.selected = true; }
      octSelect.appendChild(oOpt);
    }
    controlRow.appendChild(_makeLabeledSelect('Octave', octSelect));

    // Chord-quality dropdown
    var chordSelect = document.createElement('select');
    chordSelect.className = 'ssli-breathpadens-chord-select';
    chordSelect.title = SL.t('breathpadens.chord_title');
    var ci;
    for (ci = 0; ci < CHORD_KEYS.length; ci++) {
      var cKey = CHORD_KEYS[ci];
      var cOpt = document.createElement('option');
      cOpt.value = cKey;
      cOpt.textContent = CHORD_DEFS[cKey].lbl;
      if (cKey === _chordKey) { cOpt.selected = true; }
      chordSelect.appendChild(cOpt);
    }
    controlRow.appendChild(_makeLabeledSelect('Chord', chordSelect));

    // Inversion dropdown
    var invSelect = document.createElement('select');
    invSelect.className = 'ssli-breathpadens-inv-select';
    invSelect.title = SL.t('breathpadens.inversion_title');
    var ii2;
    for (ii2 = INVERSION_MIN; ii2 <= INVERSION_MAX; ii2++) {
      var iOpt = document.createElement('option');
      iOpt.value = String(ii2);
      iOpt.textContent = String(ii2);
      if (ii2 === _inversion) { iOpt.selected = true; }
      invSelect.appendChild(iOpt);
    }
    controlRow.appendChild(_makeLabeledSelect('Inversion', invSelect));

    // Note count dropdown
    var countSelect = document.createElement('select');
    countSelect.className = 'ssli-breathpadens-count-select';
    countSelect.title = SL.t('breathpadens.notecount_title');
    var nci;
    for (nci = NOTE_COUNT_MIN; nci <= NOTE_COUNT_MAX; nci++) {
      var nOpt = document.createElement('option');
      nOpt.value = String(nci);
      nOpt.textContent = String(nci);
      if (nci === _noteCount) { nOpt.selected = true; }
      countSelect.appendChild(nOpt);
    }
    controlRow.appendChild(_makeLabeledSelect('Notes', countSelect));

    wrapper.appendChild(controlRow);

    // ---------- Main row: chromatic note grid (left) + N mini pads ----------
    var mainRow = document.createElement('div');
    mainRow.className = 'ssli-breathpadens-main-row';
    mainRow.style.display = 'flex';
    mainRow.style.flexDirection = 'row';
    mainRow.style.flex = '1 1 auto';
    mainRow.style.minHeight = '0';
    mainRow.style.gap = MINI_PAD_GAP_PX + 'px';
    mainRow.style.padding = PAD_PADDING_PX + 'px';
    mainRow.style.boxSizing = 'border-box';
    wrapper.appendChild(mainRow);

    // ---------- Chromatic note grid (replaces old chord panel) ----------
    var noteGrid = document.createElement('div');
    noteGrid.className = 'ssli-breathpadens-note-grid';
    noteGrid.style.display = 'grid';
    noteGrid.style.gridTemplateColumns = 'repeat(' + NOTE_GRID_COLS + ', 1fr)';
    noteGrid.style.gridTemplateRows = 'repeat(' + NOTE_GRID_ROWS + ', 1fr)';
    noteGrid.style.gap = NOTE_GRID_GAP_PX + 'px';
    noteGrid.style.padding = NOTE_GRID_GAP_PX + 'px';
    noteGrid.style.width = NOTE_GRID_WIDTH_PX + 'px';
    noteGrid.style.boxSizing = 'border-box';
    noteGrid.style.flex = '0 0 auto';
    mainRow.appendChild(noteGrid);

    var _ensNoteButtons = null;

    function _buildEnsNoteGrid() {
      while (noteGrid.firstChild) {
        noteGrid.removeChild(noteGrid.firstChild);
      }
      var buttons = [];
      var ni;
      for (ni = 0; ni < SEMITONES_PER_OCTAVE; ni++) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ssli-fret-chord-btn ssli-breathpad-note-btn';
        btn.textContent = CHROMATIC_NOTE_NAMES[ni];
        btn.setAttribute('data-pc', String(ni));
        btn.style.width = '100%';
        btn.style.padding = '2px 2px';
        btn.style.fontSize = '12px';
        btn.style.textAlign = 'center';
        btn.style.minHeight = '42px';
        btn.style.minWidth = '42px';
        if (ni === _rootPc) {
          btn.className += ' ssli-fret-chord-active';
        }
        (function(capturedPc) {
          btn.addEventListener('click', function(ev) {
            ev.preventDefault();
            _rootPc = capturedPc;
            _activeDegree = -1;
            _activeIntervals = null;
            _refreshEnsNoteActiveStyles();
            _rebuildMiniPads();
          });
        })(ni);
        noteGrid.appendChild(btn);
        buttons.push(btn);
      }
      _ensNoteButtons = buttons;
    }

    function _refreshEnsNoteActiveStyles() {
      if (!_ensNoteButtons) { return; }
      var bi;
      for (bi = 0; bi < _ensNoteButtons.length; bi++) {
        var b = _ensNoteButtons[bi];
        var base = 'ssli-fret-chord-btn ssli-breathpad-note-btn';
        if (bi === _rootPc) {
          b.className = base + ' ssli-fret-chord-active';
        } else {
          b.className = base;
        }
      }
    }

    // Pads-area container so mini pads lay out separately from the
    // chord panel (mainRow is row-flex; padsArea is another row-flex).
    var padsArea = document.createElement('div');
    padsArea.style.display = 'flex';
    padsArea.style.flexDirection = 'row';
    padsArea.style.flex = '1 1 auto';
    padsArea.style.minWidth = '0';
    padsArea.style.minHeight = '0';
    padsArea.style.gap = MINI_PAD_GAP_PX + 'px';
    mainRow.appendChild(padsArea);

    // Build a single mini-pad column. Returns the column element.
    function _buildMiniPad(midi) {
      var col = document.createElement('div');
      col.className = 'ssli-breathpadens-mini';
      col.style.display = 'flex';
      col.style.flexDirection = 'column';
      col.style.flex = '1 1 0';
      col.style.minWidth = '0';
      col.style.minHeight = '0';
      col.style.boxSizing = 'border-box';

      // Note label on top
      var noteLabel = document.createElement('div');
      noteLabel.className = 'ssli-breathpadens-mini-label';
      noteLabel.textContent = _midiToName(midi);
      noteLabel.style.flex = '0 0 auto';
      noteLabel.style.textAlign = 'center';
      noteLabel.style.fontSize = '12px';
      noteLabel.style.fontFamily = 'monospace';
      noteLabel.style.color = 'rgba(220, 235, 245, 0.95)';
      noteLabel.style.padding = '2px 0';
      col.appendChild(noteLabel);

      // Pad container fills the rest
      var padContainer = document.createElement('div');
      padContainer.style.position = 'relative';
      padContainer.style.flex = '1 1 auto';
      padContainer.style.minHeight = '0';
      col.appendChild(padContainer);

      var pad = document.createElement('div');
      pad.className = 'ssli-breathpadens-pad ctrl-breathpad-pad';
      pad.style.position = 'absolute';
      pad.style.left = '0';
      pad.style.top = '0';
      pad.style.right = '0';
      pad.style.bottom = '0';
      pad.style.background = 'radial-gradient(ellipse at center, rgba(76, 201, 240, 0.08) 0%, rgba(10, 10, 20, 0.85) 100%)';
      pad.style.border = '1px solid rgba(76, 201, 240, 0.25)';
      pad.style.borderRadius = '6px';
      pad.style.touchAction = 'none';
      pad.style.cursor = 'crosshair';
      pad.style.overflow = 'hidden';

      function _addGridLine(isVertical, frac, strong) {
        var line = document.createElement('div');
        line.style.position = 'absolute';
        line.style.background = strong ? 'rgba(76, 201, 240, 0.18)' : 'rgba(76, 201, 240, 0.08)';
        line.style.pointerEvents = 'none';
        if (isVertical) {
          line.style.left = Math.floor(frac * 100) + '%';
          line.style.top = '0';
          line.style.width = '1px';
          line.style.height = '100%';
        } else {
          line.style.top = Math.floor(frac * 100) + '%';
          line.style.left = '0';
          line.style.height = '1px';
          line.style.width = '100%';
        }
        pad.appendChild(line);
      }
      _addGridLine(true, GRID_QUARTER_FRAC, false);
      _addGridLine(true, GRID_MAJOR_FRAC, true);
      _addGridLine(true, 1 - GRID_QUARTER_FRAC, false);
      _addGridLine(false, GRID_QUARTER_FRAC, false);
      _addGridLine(false, GRID_MAJOR_FRAC, true);
      _addGridLine(false, 1 - GRID_QUARTER_FRAC, false);

      // Axis labels (smaller font than single breath pad)
      var xLabel = document.createElement('div');
      xLabel.textContent = SL.t('breathpadens.axis_x');
      xLabel.style.position = 'absolute';
      xLabel.style.left = '4px';
      xLabel.style.bottom = '2px';
      xLabel.style.fontSize = '9px';
      xLabel.style.color = 'rgba(200, 220, 240, 0.6)';
      xLabel.style.pointerEvents = 'none';
      pad.appendChild(xLabel);

      var yLabel = document.createElement('div');
      yLabel.textContent = SL.t('breathpadens.axis_y');
      yLabel.style.position = 'absolute';
      yLabel.style.right = '4px';
      yLabel.style.top = '2px';
      yLabel.style.fontSize = '9px';
      yLabel.style.color = 'rgba(200, 220, 240, 0.6)';
      yLabel.style.pointerEvents = 'none';
      pad.appendChild(yLabel);

      var xBar = document.createElement('div');
      xBar.style.position = 'absolute';
      xBar.style.left = '0';
      xBar.style.top = '0';
      xBar.style.height = '2px';
      xBar.style.width = '0%';
      xBar.style.background = 'var(--ssli-accent, #4cc9f0)';
      xBar.style.opacity = '0.8';
      xBar.style.pointerEvents = 'none';
      pad.appendChild(xBar);

      var yBar = document.createElement('div');
      yBar.style.position = 'absolute';
      yBar.style.right = '0';
      yBar.style.bottom = '0';
      yBar.style.width = '2px';
      yBar.style.height = '0%';
      yBar.style.background = 'var(--ssli-accent, #4cc9f0)';
      yBar.style.opacity = '0.8';
      yBar.style.pointerEvents = 'none';
      pad.appendChild(yBar);

      var dot = document.createElement('div');
      dot.style.position = 'absolute';
      dot.style.display = 'none';
      dot.style.borderRadius = '50%';
      dot.style.background = 'radial-gradient(circle, var(--ssli-accent, #4cc9f0) 0%, rgba(76, 201, 240, 0.0) 70%)';
      dot.style.boxShadow = '0 0 18px var(--ssli-accent, #4cc9f0)';
      dot.style.pointerEvents = 'none';
      pad.appendChild(dot);

      var readout = document.createElement('div');
      readout.textContent = _midiToName(midi);
      readout.style.position = 'absolute';
      readout.style.left = '50%';
      readout.style.top = '4px';
      readout.style.transform = 'translateX(-50%)';
      readout.style.fontSize = '10px';
      readout.style.color = 'rgba(220, 235, 245, 0.85)';
      readout.style.fontFamily = 'monospace';
      readout.style.pointerEvents = 'none';
      pad.appendChild(readout);

      padContainer.appendChild(pad);

      function _localCoords(e) {
        var rect = pad.getBoundingClientRect();
        var relX = e.clientX - rect.left;
        var relY = e.clientY - rect.top;
        relX = Math.max(0, Math.min(rect.width, relX));
        relY = Math.max(0, Math.min(rect.height, relY));
        return { x: relX, y: relY, w: rect.width, h: rect.height };
      }

      function _applyAtPointer(state, e, isStart) {
        var c = _localCoords(e);
        var xFrac = (c.w > 0) ? (c.x / c.w) : 0;
        var yFrac = (c.h > 0) ? (1 - (c.y / c.h)) : 0;
        var xCC = Math.round(xFrac * CC_MAX);
        var yCC = Math.round(yFrac * CC_MAX);

        state.lastX = c.x;
        state.lastY = c.y;
        state.lastPressure = (typeof e.pressure === 'number') ? e.pressure : 0;
        if (isStart) {
          state.strikeY = c.y;
        }

        var deltaYPx = c.y - state.strikeY;
        var pressure = _effectivePressure(state.lastPressure, deltaYPx);

        // Mark expression dirty; combined value flushed once per rAF frame
        // in the shared vibrato loop (avoids per-finger-per-move contention).
        _markExpressionDirty(state.pointerId, xFrac, yFrac);
        _updateMiniVisual(state, c.x, c.y, pressure, xCC, yCC);
      }

      function _onPointerDown(e) {
        // Don't allow re-trigger if this pad already has an active pointer.
        var existingId;
        for (existingId in _activePointers) {
          if (_activePointers.hasOwnProperty(existingId)
              && _activePointers[existingId].padEl === pad) {
            return;
          }
        }
        e.preventDefault();
        if (pad.setPointerCapture && typeof e.pointerId !== 'undefined') {
          var captureOk = true;
          try { pad.setPointerCapture(e.pointerId); } catch (err) { captureOk = false; }
          // captureOk consumed for clarity; not otherwise used.
          if (!captureOk) { /* best-effort */ }
        }

        // First active pointer: force sustain to 100.
        if (_activeCount === 0) {
          _saveAndForceSustain();
        }

        // Voice stealing: if at the limit, release the oldest active pointer
        // to keep CPU usage bounded. Oldest = smallest animStartMs.
        if (_activeCount >= MAX_ENSEMBLE_VOICES) {
          var oldestId = null;
          var oldestMs = Infinity;
          var stealKey;
          for (stealKey in _activePointers) {
            if (_activePointers.hasOwnProperty(stealKey)) {
              var candidate = _activePointers[stealKey];
              if (candidate.animStartMs < oldestMs) {
                oldestMs = candidate.animStartMs;
                oldestId = stealKey;
              }
            }
          }
          if (oldestId !== null) {
            _releasePointer(oldestId);
          }
        }

        var state = {
          pointerId: e.pointerId,
          midi: midi,
          padEl: pad,
          dot: dot,
          xBar: xBar,
          yBar: yBar,
          readout: readout,
          strikeY: 0,
          lastX: 0,
          lastY: 0,
          lastPressure: 0,
          animId: 0,
          animStartMs: 0
        };
        _activePointers[e.pointerId] = state;
        _activeCount++;

        noteOn(midi);
        _applyAtPointer(state, e, true);
        _startVibratoLoop(state);
      }

      function _onPointerMove(e) {
        var state = _activePointers[e.pointerId];
        if (!state || state.padEl !== pad) { return; }
        _applyAtPointer(state, e, false);
      }

      function _onPointerUp(e) {
        var state = _activePointers[e.pointerId];
        if (!state || state.padEl !== pad) { return; }
        _releasePointer(e.pointerId);
      }

      pad.addEventListener('pointerdown', _onPointerDown);
      pad.addEventListener('pointermove', _onPointerMove);
      pad.addEventListener('pointerup', _onPointerUp);
      pad.addEventListener('pointercancel', _onPointerUp);
      pad.addEventListener('pointerleave', function(e) {
        // Don't auto-release on leave alone; document handler covers drag-off.
      });

      return col;
    }

    function _rebuildMiniPads() {
      // Release any active pointers before nuking pad DOM.
      _releaseAllPointers();
      while (padsArea.firstChild) {
        padsArea.removeChild(padsArea.firstChild);
      }
      var midis = _buildChordMidis(_baseOctave, _rootPc, _chordKey, _inversion, _noteCount, _activeIntervals);
      var pi;
      for (pi = 0; pi < midis.length; pi++) {
        padsArea.appendChild(_buildMiniPad(midis[pi]));
      }
    }

    octSelect.addEventListener('change', function() {
      _baseOctave = _clampInt(parseInt(octSelect.value, 10) || DEFAULT_OCTAVE, OCTAVE_MIN, OCTAVE_MAX);
      _rebuildMiniPads();
    });
    chordSelect.addEventListener('change', function() {
      _chordKey = chordSelect.value;
      _activeIntervals = null;
      _activeDegree = -1;
      _rebuildMiniPads();
    });
    invSelect.addEventListener('change', function() {
      _inversion = _clampInt(parseInt(invSelect.value, 10) || 0, INVERSION_MIN, INVERSION_MAX);
      _rebuildMiniPads();
    });
    countSelect.addEventListener('change', function() {
      _noteCount = _clampInt(parseInt(countSelect.value, 10) || DEFAULT_NOTE_COUNT, NOTE_COUNT_MIN, NOTE_COUNT_MAX);
      _rebuildMiniPads();
    });

    container.appendChild(wrapper);
    _buildEnsNoteGrid();
    _rebuildMiniPads();
  }

  // ============================================================
  // Register
  // ============================================================

  if (!SL.controllers) { SL.controllers = {}; }
  SL.controllers.breathpadens = {
    build: _buildBreathPadEnsembleController,
    release: _releaseAllPointers
  };

  // ============================================================
  // Panic hook
  // ============================================================

  if (SL.PanicRegistry && SL.PanicRegistry.register) {
    SL.PanicRegistry.register(
      'voices',
      'breathpadens.pointers',
      function() { _releaseAllPointers(); },
      function() { return (_activeCount > 0) ? 'pointers active' : null; }
    );
  }

})();
