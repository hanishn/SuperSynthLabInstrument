// SSLI Controller: Breath + Note Buttons (wind instrument surface)
// ES5 compatible (var, no arrow functions, no template literals)
//
// Behavior:
//   - Left 30%: Breath strip. Y = air pressure/gain, X = lip tension/cutoff.
//     DeltaY = vibrato (5.5 Hz sine). One finger sustains "air supply".
//   - Right 70%: Note buttons - 2 rows of 7 (top=high octave, bottom=low octave).
//     Each button = one scale degree. Press = note on, release = note off.
//     Legato: slide from one button to another while breath active.
//   - Breath + note = full expression. Note without breath = moderate default volume.
//   - Multitouch: breath on left hand + note buttons on right hand.

(function() {
  'use strict';

  var SL = window.SynthLab;
  var CHROMATIC_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var CHROMATIC_NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  var NOTES = (SL && SL.NOTES) ? SL.NOTES : CHROMATIC_NOTE_NAMES;

  // ============================================================
  // Constants
  // ============================================================

  var SEMITONES_PER_OCTAVE = 12;
  var OCTAVE_BASE_OFFSET = 1;

  var NO_SAVED_SUSTAIN = null;
  var SCALE_DEGREES_PER_OCTAVE = 7;
  var DISPLAYED_OCTAVES = 2;
  var TOTAL_NOTE_BUTTONS = SCALE_DEGREES_PER_OCTAVE * DISPLAYED_OCTAVES;

  // Breath strip width fraction
  var BREATH_ZONE_WIDTH_PERCENT = 30;

  // CC74 cutoff mapping - log spaced
  var CUTOFF_MIN_HZ = 1000;
  var CUTOFF_MAX_HZ = 12000;
  var LN_CUTOFF_MIN = Math.log(CUTOFF_MIN_HZ);
  var LN_CUTOFF_MAX = Math.log(CUTOFF_MAX_HZ);

  // Breath gain
  var BREATH_GAIN_MIN = 0.55;
  var BREATH_GAIN_MAX = 1.0;
  var DEFAULT_GAIN_NO_BREATH = 0.72;

  // Vibrato
  var VIBRATO_RATE_HZ = 5.5;
  var VIBRATO_MAX_CENTS = 35;
  var PRESSURE_NEUTRAL = 0.5;
  var PRESSURE_EPSILON = 0.001;
  var DELTAY_FULL_TRAVEL_PX = 180;

  // Animation
  var FRAME_MS = 16;

  // Sustain override
  var BREATH_HELD_SUSTAIN = 100;

  // Octave range
  var MIN_OCTAVE = 1;
  var MAX_OCTAVE = 6;
  var DEFAULT_OCTAVE = 3;

  // Default scale (ionian / major) as fallback
  var DEFAULT_SCALE_INTERVALS = [0, 2, 4, 5, 7, 9, 11];

  // ============================================================
  // State
  // ============================================================

  var _isBreathActive = false;
  var _breathPointerId = -1;
  var _currentMidi = -1;
  var _activeNoteButtonIdx = -1;
  var _notePointerMap = {}; // pointerId -> button index
  var _displayOctave = DEFAULT_OCTAVE;
  var _baseOctave = DEFAULT_OCTAVE;
  var _strikeY = 0;
  var _lastY = 0;
  var _lastPressure = 0;
  var _animId = 0;
  var _animStartMs = 0;

  // Scale data
  var _scaleIntervals = DEFAULT_SCALE_INTERVALS;
  var _rootPc = 0;

  // Cached references
  var _currentNoteOn = null;
  var _currentNoteOff = null;
  var _currentApplyPitchBend = null;
  var _currentResetPitchBend = null;
  var _savedSustain = null;
  var _savedSustainInst = -1;
  var _noteButtonElements = [];
  var _noteDisplayEl = null;
  var _octaveLabel = null;
  var _breathZoneEl = null;
  var _breathIndicatorEl = null;

  // Document-level safety handlers (stored for cleanup)
  var _docPointerUpHandler = null;
  var _docPointerCancelHandler = null;

  // ============================================================
  // Helpers
  // ============================================================

  function _clamp01(v) {
    if (v < 0) { return 0; }
    if (v > 1) { return 1; }
    return v;
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

  function _midiToName(midi) {
    var pc = midi % SEMITONES_PER_OCTAVE;
    var oct = Math.floor(midi / SEMITONES_PER_OCTAVE) - 1;
    var noteNames = (_rootPc > 0 && SL.useFlatNaming && SL.useFlatNaming(_rootPc)) ? CHROMATIC_NOTE_NAMES_FLAT : NOTES;
    return noteNames[pc] + oct;
  }

  function _pcToName(pc) {
    var noteNames = (_rootPc > 0 && SL.useFlatNaming && SL.useFlatNaming(_rootPc)) ? CHROMATIC_NOTE_NAMES_FLAT : NOTES;
    return noteNames[pc % SEMITONES_PER_OCTAVE];
  }

  function _getScaleIntervals() {
    var intervals = DEFAULT_SCALE_INTERVALS;
    var hasScreenPlayMode = SL.screenPlay && SL.screenPlay.getModeKey;
    var canGetScaleIntervals = hasScreenPlayMode && SL.MODES;
    if (canGetScaleIntervals) {
      var modeKey = SL.screenPlay.getModeKey();
      var modeData = SL.MODES[modeKey];
      if (modeData && modeData.scale) {
        intervals = modeData.scale;
      }
    }
    return intervals;
  }

  function _getRootPc() {
    var root = 0;
    if (SL.screenPlay && SL.screenPlay.getRootPc) {
      root = SL.screenPlay.getRootPc();
    }
    return root;
  }

  function _buttonIndexToMidi(btnIdx) {
    // btnIdx 0..13: low octave is 0..6, high octave is 7..13
    var octaveOffset = Math.floor(btnIdx / SCALE_DEGREES_PER_OCTAVE);
    var degreeIdx = btnIdx % SCALE_DEGREES_PER_OCTAVE;
    var semitoneInScale = _scaleIntervals[degreeIdx];
    var baseMidi = ((_displayOctave + octaveOffset + OCTAVE_BASE_OFFSET) * SEMITONES_PER_OCTAVE) + _rootPc;
    var midi = baseMidi + semitoneInScale;
    return midi;
  }

  function _isPhoneLayout() {
    var layout = document.documentElement.getAttribute('data-layout') || '';
    var isPhone = (layout === 'phone-land') || (layout === 'phone');
    return isPhone;
  }

  // ============================================================
  // Audio Integration
  // ============================================================

  function _applyTimbre(xFrac, yFrac) {
    var cutoffHz = Math.exp(LN_CUTOFF_MIN + xFrac * (LN_CUTOFF_MAX - LN_CUTOFF_MIN));
    var gain = BREATH_GAIN_MIN + yFrac * (BREATH_GAIN_MAX - BREATH_GAIN_MIN);
    if (SL.audio && SL.audio.setExpression) {
      SL.audio.setExpression(cutoffHz, gain);
    }
  }

  function _applyDefaultTimbre() {
    // When playing without breath, use a moderate default
    var defaultCutoff = Math.exp(LN_CUTOFF_MIN + 0.5 * (LN_CUTOFF_MAX - LN_CUTOFF_MIN));
    if (SL.audio && SL.audio.setExpression) {
      SL.audio.setExpression(defaultCutoff, DEFAULT_GAIN_NO_BREATH);
    }
  }

  function _clearTimbre() {
    if (SL.audio && SL.audio.clearExpression) {
      SL.audio.clearExpression();
    }
  }

  // ============================================================
  // Note Management
  // ============================================================

  function _playNote(midi) {
    var hasCurrentNote = _currentMidi >= 0 && _currentMidi !== midi;
    var shouldStopCurrentNote = hasCurrentNote && _currentNoteOff;
    if (shouldStopCurrentNote) {
      _currentNoteOff(_currentMidi);
    }
    if (midi !== _currentMidi) {
      _currentMidi = midi;
      if (_currentNoteOn) {
        _currentNoteOn(_currentMidi);
      }
    }
    _updateNoteDisplay();
  }

  function _releaseCurrentNote() {
    if (_currentMidi >= 0 && _currentNoteOff) {
      _currentNoteOff(_currentMidi);
    }
    _currentMidi = -1;
    _updateNoteDisplay();
  }

  function _updateNoteDisplay() {
    if (!_noteDisplayEl) { return; }
    if (_currentMidi >= 0) {
      _noteDisplayEl.textContent = _midiToName(_currentMidi);
      _noteDisplayEl.style.opacity = '1';
    } else {
      _noteDisplayEl.textContent = '--';
      _noteDisplayEl.style.opacity = '0.5';
    }
  }

  function _updateOctaveLabel() {
    if (_octaveLabel) {
      _octaveLabel.textContent = SL.t('breathfinger.oct_prefix') + _displayOctave;
    }
  }

  // ============================================================
  // Note Button Visuals
  // ============================================================

  function _updateButtonLabels() {
    var i;
    for (i = 0; i < _noteButtonElements.length; i++) {
      var degreeIdx = i % SCALE_DEGREES_PER_OCTAVE;
      var semitone = _scaleIntervals[degreeIdx];
      var pc = (_rootPc + semitone) % SEMITONES_PER_OCTAVE;
      var label = _noteButtonElements[i].querySelector('.bf-note-btn-label');
      if (label) {
        label.textContent = _pcToName(pc);
      }
    }
  }

  function _highlightButton(btnIdx) {
    var i;
    for (i = 0; i < _noteButtonElements.length; i++) {
      if (i === btnIdx) {
        _noteButtonElements[i].classList.add('bf-note-btn-active');
      } else {
        _noteButtonElements[i].classList.remove('bf-note-btn-active');
      }
    }
  }

  // ============================================================
  // Vibrato Loop
  // ============================================================

  function _startVibratoLoop() {
    _animStartMs = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    function tick() {
      if (!_isBreathActive) { return; }
      var nowMs = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      var deltaYPx = _lastY - _strikeY;
      var depth = _effectivePressure(_lastPressure, deltaYPx);
      var phase = ((nowMs - _animStartMs) / 1000) * VIBRATO_RATE_HZ * 2 * Math.PI;
      var cents = Math.sin(phase) * depth * VIBRATO_MAX_CENTS;
      if (_currentApplyPitchBend) {
        _currentApplyPitchBend(cents);
      }
      _animId = setTimeout(tick, FRAME_MS);
    }
    tick();
  }

  function _stopVibratoLoop() {
    if (_animId) {
      clearTimeout(_animId);
      _animId = 0;
    }
  }

  // ============================================================
  // Sustain Override
  // ============================================================

  function _forceSustain() {
    var canQueryBreathInstrument = SL.audio && SL.audio.getInstruments;
    var hasBreathInstrumentQuery = canQueryBreathInstrument && SL.audio.getCurrentInstrument;
    if (hasBreathInstrumentQuery) {
      var instId = SL.audio.getCurrentInstrument();
      var insts = SL.audio.getInstruments();
      var inst = insts ? insts[instId] : null;
      var hasAdsrBreathfingerSustain = inst && inst.settings && inst.settings.adsr;
      if (hasAdsrBreathfingerSustain) {
        _savedSustainInst = instId;
        _savedSustain = inst.settings.adsr.s;
        inst.settings.adsr.s = BREATH_HELD_SUSTAIN;
      }
    }
  }

  function _restoreSustain() {
    if (_savedSustain !== NO_SAVED_SUSTAIN && _savedSustainInst >= 0
        && SL.audio && SL.audio.getInstruments) {
      var insts = SL.audio.getInstruments();
      var inst = insts ? insts[_savedSustainInst] : null;
      var hasAdsrBreathfingerRestore = inst && inst.settings && inst.settings.adsr;
      if (hasAdsrBreathfingerRestore) {
        inst.settings.adsr.s = _savedSustain;
      }
      _savedSustain = null;
      _savedSustainInst = -1;
    }
  }

  // ============================================================
  // Breath Zone
  // ============================================================

  function _updateBreathIndicator(yFrac) {
    if (_breathIndicatorEl) {
      var pct = Math.round(yFrac * 100);
      _breathIndicatorEl.style.height = pct + '%';
    }
  }

  // ============================================================
  // Release
  // ============================================================

  function _releaseBreath() {
    if (!_isBreathActive) { return; }
    _isBreathActive = false;
    _breathPointerId = -1;
    _stopVibratoLoop();
    if (_currentResetPitchBend) { _currentResetPitchBend(); }
    // If a note button is still held, keep the note alive at default volume
    if (_activeNoteButtonIdx >= 0) {
      _applyDefaultTimbre();
    } else {
      _releaseCurrentNote();
      _clearTimbre();
    }
    _restoreSustain();
    _updateBreathIndicator(0);
    if (_breathZoneEl) {
      _breathZoneEl.classList.remove('bf-breath-active');
    }
  }

  function _releaseAll() {
    _isBreathActive = false;
    _breathPointerId = -1;
    _activeNoteButtonIdx = -1;
    _notePointerMap = {};
    _stopVibratoLoop();
    if (_currentResetPitchBend) { _currentResetPitchBend(); }
    _releaseCurrentNote();
    _clearTimbre();
    _restoreSustain();
    _updateBreathIndicator(0);
    _highlightButton(-1);
    if (_breathZoneEl) {
      _breathZoneEl.classList.remove('bf-breath-active');
    }

    // Remove document-level safety handlers
    if (_docPointerUpHandler) {
      document.removeEventListener('pointerup', _docPointerUpHandler);
      _docPointerUpHandler = null;
    }
    if (_docPointerCancelHandler) {
      document.removeEventListener('pointercancel', _docPointerCancelHandler);
      _docPointerCancelHandler = null;
    }
  }

  // Document-level safety
  function _documentPointerUp(e) {
    var pid = e.pointerId;
    if (pid === _breathPointerId) {
      _releaseBreath();
    }
    if (_notePointerMap[pid] !== undefined) {
      var btnIdx = _notePointerMap[pid];
      delete _notePointerMap[pid];
      if (btnIdx === _activeNoteButtonIdx) {
        _activeNoteButtonIdx = -1;
        _highlightButton(-1);
        _releaseCurrentNote();
        if (!_isBreathActive) {
          _clearTimbre();
        }
      }
    }
  }
  // ============================================================
  // Build
  // ============================================================

  function _buildBreathFingerController(container, opts) {
    var baseOctave = opts.baseOctave;
    var noteOn = opts.noteOn;
    var noteOff = opts.noteOff;
    var applyPitchBend = opts.applyPitchBend;
    var resetPitchBendFn = opts.resetPitchBendFn;

    _currentNoteOn = noteOn;
    _currentNoteOff = noteOff;
    _currentApplyPitchBend = applyPitchBend;
    _currentResetPitchBend = resetPitchBendFn;
    _displayOctave = baseOctave || DEFAULT_OCTAVE;
    _baseOctave = _displayOctave;

    // Reset state
    _isBreathActive = false;
    _currentMidi = -1;
    _breathPointerId = -1;
    _activeNoteButtonIdx = -1;
    _notePointerMap = {};

    // Get scale info from global topbar
    _rootPc = _getRootPc();
    _scaleIntervals = _getScaleIntervals();

    var wrapper = document.createElement('div');
    wrapper.className = 'ssli-breathfinger-wrapper';

    // ---------- Main layout: breath zone (left) + note zone (right) ----------
    var mainRow = document.createElement('div');
    mainRow.className = 'bf-main-row';
    wrapper.appendChild(mainRow);

    // ---------- Breath Zone (left 30%) ----------
    var breathZone = document.createElement('div');
    breathZone.className = 'bf-breath-zone';
    breathZone.style.touchAction = 'none';
    breathZone.style.webkitTouchCallout = 'none';
    breathZone.style.webkitUserSelect = 'none';
    breathZone.style.userSelect = 'none';
    breathZone.addEventListener('contextmenu', function(e) { e.preventDefault(); });
    _breathZoneEl = breathZone;

    // Breath level indicator bar (fills from bottom)
    var breathIndicator = document.createElement('div');
    breathIndicator.className = 'bf-breath-indicator';
    breathZone.appendChild(breathIndicator);
    _breathIndicatorEl = breathIndicator;

    // Centered "BREATH" label (rotated vertically)
    var breathMainLabel = document.createElement('div');
    breathMainLabel.className = 'bf-breath-zone-label';
    breathMainLabel.textContent = SL.t('breathfinger.breath_label');
    breathZone.appendChild(breathMainLabel);

    // Breath zone axis labels
    var breathLabelTop = document.createElement('div');
    breathLabelTop.className = 'bf-breath-label bf-breath-label-top';
    breathLabelTop.textContent = SL.t('breathfinger.loud');
    breathZone.appendChild(breathLabelTop);

    var breathLabelBot = document.createElement('div');
    breathLabelBot.className = 'bf-breath-label bf-breath-label-bottom';
    breathLabelBot.textContent = SL.t('breathfinger.soft');
    breathZone.appendChild(breathLabelBot);

    var breathLabelLeft = document.createElement('div');
    breathLabelLeft.className = 'bf-breath-label bf-breath-label-left';
    breathLabelLeft.textContent = SL.t('breathfinger.dark');
    breathZone.appendChild(breathLabelLeft);

    var breathLabelRight = document.createElement('div');
    breathLabelRight.className = 'bf-breath-label bf-breath-label-right';
    breathLabelRight.textContent = SL.t('breathfinger.bright');
    breathZone.appendChild(breathLabelRight);

    mainRow.appendChild(breathZone);

    // ---------- Note Zone (right 70%) ----------
    var noteZone = document.createElement('div');
    noteZone.className = 'bf-note-zone';

    // Topbar: octave controls + note display
    var topbar = document.createElement('div');
    topbar.className = 'bf-topbar';

    var octDown = document.createElement('button');
    octDown.type = 'button';
    octDown.className = 'bf-octave-btn';
    octDown.textContent = '-';
    octDown.addEventListener('click', function(ev) {
      ev.preventDefault();
      if (_displayOctave > MIN_OCTAVE) {
        _displayOctave = _displayOctave - 1;
        _updateOctaveLabel();
        _updateButtonLabels();
        // If a note is active, retrigger at new octave
        if (_activeNoteButtonIdx >= 0) {
          var newMidi = _buttonIndexToMidi(_activeNoteButtonIdx);
          _playNote(newMidi);
        }
      }
    });
    topbar.appendChild(octDown);

    var octLabel = document.createElement('span');
    octLabel.className = 'bf-octave-label';
    octLabel.textContent = SL.t('breathfinger.oct_prefix') + _displayOctave;
    _octaveLabel = octLabel;
    topbar.appendChild(octLabel);

    var octUp = document.createElement('button');
    octUp.type = 'button';
    octUp.className = 'bf-octave-btn';
    octUp.textContent = '+';
    octUp.addEventListener('click', function(ev) {
      ev.preventDefault();
      if (_displayOctave < MAX_OCTAVE) {
        _displayOctave = _displayOctave + 1;
        _updateOctaveLabel();
        _updateButtonLabels();
        if (_activeNoteButtonIdx >= 0) {
          var newMidi = _buttonIndexToMidi(_activeNoteButtonIdx);
          _playNote(newMidi);
        }
      }
    });
    topbar.appendChild(octUp);

    // Note display
    var noteDisplay = document.createElement('div');
    noteDisplay.className = 'bf-note-display';
    noteDisplay.textContent = '--';
    _noteDisplayEl = noteDisplay;
    topbar.appendChild(noteDisplay);

    noteZone.appendChild(topbar);

    // ---------- Note Buttons Grid: 2 rows of 7 ----------
    // Top row = high octave, bottom row = low octave
    var noteGrid = document.createElement('div');
    noteGrid.className = 'bf-note-grid';

    _noteButtonElements = [];
    var row;
    var col;
    // Build top row (high octave = indices 7..13) then bottom row (low octave = indices 0..6)
    var rowOrder = [1, 0]; // row 0 in DOM = high octave (idx offset 7), row 1 = low octave (idx offset 0)
    var rowIdx;
    for (rowIdx = 0; rowIdx < DISPLAYED_OCTAVES; rowIdx++) {
      var octaveOffset = rowOrder[rowIdx]; // 1 = high, 0 = low
      for (col = 0; col < SCALE_DEGREES_PER_OCTAVE; col++) {
        var btnIdx = (octaveOffset * SCALE_DEGREES_PER_OCTAVE) + col;
        var btn = document.createElement('div');
        btn.className = 'bf-note-btn';
        btn.setAttribute('data-btn-index', String(btnIdx));
        btn.style.touchAction = 'none';
        btn.style.webkitTouchCallout = 'none';
        btn.style.webkitUserSelect = 'none';
        btn.style.userSelect = 'none';

        var btnLabel = document.createElement('span');
        btnLabel.className = 'bf-note-btn-label';
        var degreeIdx = col;
        var semitone = _scaleIntervals[degreeIdx];
        var pc = (_rootPc + semitone) % SEMITONES_PER_OCTAVE;
        btnLabel.textContent = _pcToName(pc);
        btn.appendChild(btnLabel);

        // Octave indicator (small)
        var octIndicator = document.createElement('span');
        octIndicator.className = 'bf-note-btn-oct';
        octIndicator.textContent = (octaveOffset === 1) ? '+1' : '';
        btn.appendChild(octIndicator);

        noteGrid.appendChild(btn);
        _noteButtonElements[btnIdx] = btn;

        // Pointer events for note buttons
        (function(capturedIdx, capturedBtn) {
          capturedBtn.addEventListener('contextmenu', function(e) { e.preventDefault(); });
          capturedBtn.addEventListener('touchstart', function(e) { e.preventDefault(); }, { passive: false });
          capturedBtn.addEventListener('touchend', function(e) { e.preventDefault(); }, { passive: false });

          capturedBtn.addEventListener('pointerdown', function(e) {
            e.preventDefault();
            e.stopPropagation();
            if (capturedBtn.setPointerCapture && typeof e.pointerId !== 'undefined') {
              try { capturedBtn.setPointerCapture(e.pointerId); } catch (err) { /* pointer capture is best-effort */ }
            }
            _notePointerMap[e.pointerId] = capturedIdx;
            _activeNoteButtonIdx = capturedIdx;
            _highlightButton(capturedIdx);

            var midi = _buttonIndexToMidi(capturedIdx);
            // If breath is not active, use default timbre
            if (!_isBreathActive) {
              _applyDefaultTimbre();
            }
            _playNote(midi);
          });

          capturedBtn.addEventListener('pointerup', function(e) {
            e.preventDefault();
            e.stopPropagation();
            if (_notePointerMap[e.pointerId] === capturedIdx) {
              delete _notePointerMap[e.pointerId];
            }
            if (capturedIdx === _activeNoteButtonIdx) {
              _activeNoteButtonIdx = -1;
              _highlightButton(-1);
              _releaseCurrentNote();
              if (!_isBreathActive) {
                _clearTimbre();
              }
            }
          });

          capturedBtn.addEventListener('pointercancel', function(e) {
            if (_notePointerMap[e.pointerId] === capturedIdx) {
              delete _notePointerMap[e.pointerId];
            }
            if (capturedIdx === _activeNoteButtonIdx) {
              _activeNoteButtonIdx = -1;
              _highlightButton(-1);
              _releaseCurrentNote();
              if (!_isBreathActive) {
                _clearTimbre();
              }
            }
          });
        })(btnIdx, btn);
      }
    }

    noteZone.appendChild(noteGrid);
    mainRow.appendChild(noteZone);
    container.appendChild(wrapper);

    // ---------- Breath Zone Pointer Events ----------

    function _breathLocalCoords(e) {
      var rect = breathZone.getBoundingClientRect();
      var relX = e.clientX - rect.left;
      var relY = e.clientY - rect.top;
      relX = Math.max(0, Math.min(rect.width, relX));
      relY = Math.max(0, Math.min(rect.height, relY));
      return { x: relX, y: relY, w: rect.width, h: rect.height };
    }

    function _applyBreathAtPointer(e, isStart) {
      var c = _breathLocalCoords(e);
      var xFrac = (c.w > 0) ? (c.x / c.w) : 0;
      var yFrac = (c.h > 0) ? (1 - (c.y / c.h)) : 0;

      _lastY = c.y;
      _lastPressure = (typeof e.pressure === 'number') ? e.pressure : 0;

      if (isStart) {
        _strikeY = c.y;
      }

      _applyTimbre(xFrac, yFrac);
      _updateBreathIndicator(yFrac);
    }

    breathZone.addEventListener('pointerdown', function(e) {
      if (_isBreathActive) { return; }
      e.preventDefault();
      if (breathZone.setPointerCapture && typeof e.pointerId !== 'undefined') {
        try { breathZone.setPointerCapture(e.pointerId); } catch (err) { /* pointer capture is best-effort */ }
      }
      _isBreathActive = true;
      _breathPointerId = e.pointerId;
      breathZone.classList.add('bf-breath-active');

      _forceSustain();
      _applyBreathAtPointer(e, true);
      _startVibratoLoop();

      // If a note button is already held, the note is already playing - just apply breath expression
      // If no note button held, breath alone doesn't trigger a note
    });

    breathZone.addEventListener('pointermove', function(e) {
      if (!_isBreathActive) { return; }
      if (e.pointerId !== _breathPointerId) { return; }
      _applyBreathAtPointer(e, false);
    });

    breathZone.addEventListener('pointerup', function(e) {
      if (!_isBreathActive) { return; }
      if (e.pointerId !== _breathPointerId) { return; }
      _releaseBreath();
    });

    breathZone.addEventListener('pointercancel', function(e) {
      if (!_isBreathActive) { return; }
      if (e.pointerId !== _breathPointerId) { return; }
      _releaseBreath();
    });

    // Document-level safety nets for stuck notes:
    // If pointerup/pointercancel fires outside the controller area, we still
    // need to release any active notes/breath to prevent stuck state.
    // Remove existing handlers first (idempotent - safe if build is called again)
    if (_docPointerUpHandler) {
      document.removeEventListener('pointerup', _docPointerUpHandler);
    }
    if (_docPointerCancelHandler) {
      document.removeEventListener('pointercancel', _docPointerCancelHandler);
    }

    _docPointerUpHandler = _documentPointerUp;
    _docPointerCancelHandler = _documentPointerUp;

    document.addEventListener('pointerup', _docPointerUpHandler);
    document.addEventListener('pointercancel', _docPointerCancelHandler);

    // Initial display
    _updateNoteDisplay();
  }

  // ============================================================
  // Register
  // ============================================================

  if (!SL.controllers) { SL.controllers = {}; }
  SL.controllers.breathfinger = {
    build: _buildBreathFingerController,
    release: _releaseAll
  };

  // ============================================================
  // Panic hook
  // ============================================================

  if (SL.PanicRegistry && SL.PanicRegistry.register) {
    SL.PanicRegistry.register(
      'voices',
      'breathfinger.breath',
      function() { _releaseAll(); },
      function() { return _isBreathActive ? 'breath active' : null; }
    );
  }

})();
