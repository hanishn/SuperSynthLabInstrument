// SSLI Controller: Breath Pad (single-note expressive 2D surface)
// ES5 compatible (var, no arrow functions, no template literals)
//
// Behavior:
//   - Single pad. Pointer down: note-on at (root + octave base).
//   - X axis -> CC74 timbre (filter cutoff via SL.audio.setExpressiveCutoff).
//   - Y axis -> "breath" brightness boost (additive cutoff lift) and
//     displayed CC2 value (no dedicated engine gain hook available).
//   - pointerEvent.pressure (when nontrivial) OR |deltaY from strike| ->
//     CC1 vibrato depth, emitted via applyPitchBend(sin(t) * depthCents).
//   - Pointer up / cancel / leave / document-level up: note-off + reset.

(function() {
  'use strict';

  var SL = window.SynthLab;
  var CHROMATIC_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var NOTES = (SL && SL.NOTES) ? SL.NOTES : CHROMATIC_NOTE_NAMES;

  // ============================================================
  // Constants
  // ============================================================

  var DEFAULT_CONTAINER_WIDTH = 800;
  var DEFAULT_CONTAINER_HEIGHT = 300;

  var PAD_PADDING_PX = 10;
  var SEMITONES_PER_OCTAVE = 12;
  var OCTAVE_BASE_OFFSET = 1; // baseOctave 3 -> MIDI octave 4 (C4 = 60)
  var CONTROL_GAP_PX = 6;

  var DEFAULT_ROOT_PC = 0;
  // Chromatic note grid layout: 2 columns x 6 rows
  var NOTE_GRID_COLS = 2;
  var NOTE_GRID_ROWS = 6;
  var NOTE_GRID_GAP_PX = 4;
  var NOTE_GRID_WIDTH_PX = 100;

  // CC74 cutoff mapping — log spaced. Floor raised so weak-output engines
  // (blown PM presets) aren't muted when the pointer sits in the left half
  // of the pad — 120 Hz cut off fundamental of every note above A2, which
  // drowned already-thin flute harmonics. 1000 Hz leaves all fundamentals
  // and at least the 2nd harmonic of every note audible even at X=0.
  var CUTOFF_MIN_HZ = 1000;
  var CUTOFF_MAX_HZ = 12000;
  var LN_CUTOFF_MIN = Math.log(CUTOFF_MIN_HZ);
  var LN_CUTOFF_MAX = Math.log(CUTOFF_MAX_HZ);
  // CC2 "breath" gain. Prior floor 0.15 (-16 dB) pushed low-output engines
  // below audibility when the pointer sat at the bottom of the pad; 0.55
  // (-5 dB) stays audibly quiet without muting.
  var BREATH_GAIN_MIN = 0.55;
  var BREATH_GAIN_MAX = 1.0;

  // MIDI CC value scaling
  var CC_MAX = 127;

  // Vibrato (CC1 -> pitch-bend sine)
  var VIBRATO_RATE_HZ = 5.5;
  var VIBRATO_MAX_CENTS = 35;
  // Pressure values from unsupported devices tend to be exactly 0 or 0.5.
  // Treat 0.5 as "no real pressure" and fall back to deltaY.
  var PRESSURE_NEUTRAL = 0.5;
  var PRESSURE_EPSILON = 0.001;
  // deltaY fallback: full-pad travel yields full depth
  var DELTAY_FULL_TRAVEL_PX = 180;

  // Visual feedback
  var DOT_MIN_RADIUS_PX = 14;
  var DOT_MAX_RADIUS_PX = 44;
  var GRID_MAJOR_FRAC = 0.5;   // crosshair at center
  var GRID_QUARTER_FRAC = 0.25;

  // Animation
  var FRAME_MS = 16;

  // ============================================================
  // State
  // ============================================================

  var _active = false;
  var _activePointerId = -1;
  var _currentMidi = -1;
  var _rootPc = DEFAULT_ROOT_PC;
  var _currentNoteButtons = null;
  var _strikeY = 0;
  var _lastX = 0;
  var _lastY = 0;
  var _lastPressure = 0;
  var _animId = 0;
  var _animStartMs = 0;

  // Breath-pad sustain override. The pad is a continuously-excited surface
  // (finger down = note sounding), which conflicts with presets that have
  // sustain=0 — the envelope decays to silence before the user lifts. We
  // temporarily force sustain to 100% while the pad is active and restore
  // the preset's value on release.
  var BREATH_HELD_SUSTAIN = 100;

  // Cached references for release-from-anywhere
  var _currentNoteOff = null;
  var _currentApplyPitchBend = null;
  var _currentResetPitchBend = null;
  var _savedSustain = null;
  var _savedSustainInst = -1;
  var _currentDot = null;
  var _currentXBar = null;
  var _currentYBar = null;
  var _currentReadout = null;
  var _currentPad = null;

  // ============================================================
  // Helpers
  // ============================================================

  function _pcToName(pc) {
    var idx = ((pc % SEMITONES_PER_OCTAVE) + SEMITONES_PER_OCTAVE) % SEMITONES_PER_OCTAVE;
    return NOTES[idx];
  }

  function _computeMidi(baseOctave, rootPc) {
    var midi = ((baseOctave + OCTAVE_BASE_OFFSET) * SEMITONES_PER_OCTAVE) + rootPc;
    return midi;
  }

  function _midiToName(midi) {
    var pc = midi % SEMITONES_PER_OCTAVE;
    var oct = Math.floor(midi / SEMITONES_PER_OCTAVE) - 1;
    return NOTES[pc] + oct;
  }

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

  function _applyTimbre(xFrac, yFrac) {
    // X -> log cutoff (CC74). Y -> breath gain (CC2).
    var cutoffHz = Math.exp(LN_CUTOFF_MIN + xFrac * (LN_CUTOFF_MAX - LN_CUTOFF_MIN));
    var gain = BREATH_GAIN_MIN + yFrac * (BREATH_GAIN_MAX - BREATH_GAIN_MIN);
    if (SL.audio && SL.audio.setExpression) {
      SL.audio.setExpression(cutoffHz, gain);
    }
  }

  function _clearTimbre() {
    if (SL.audio && SL.audio.clearExpression) {
      SL.audio.clearExpression();
    }
  }

  function _updateVisual(relX, relY, pressure, xCC, yCC, midi) {
    if (_currentDot) {
      var radius = DOT_MIN_RADIUS_PX + pressure * (DOT_MAX_RADIUS_PX - DOT_MIN_RADIUS_PX);
      _currentDot.style.left = relX + 'px';
      _currentDot.style.top = relY + 'px';
      _currentDot.style.width = (radius * 2) + 'px';
      _currentDot.style.height = (radius * 2) + 'px';
      _currentDot.style.marginLeft = (-radius) + 'px';
      _currentDot.style.marginTop = (-radius) + 'px';
      _currentDot.style.display = 'block';
    }
    if (_currentXBar) {
      _currentXBar.style.width = Math.floor((xCC / CC_MAX) * 100) + '%';
    }
    if (_currentYBar) {
      _currentYBar.style.height = Math.floor((yCC / CC_MAX) * 100) + '%';
    }
    if (_currentReadout) {
      var name = (midi >= 0) ? _midiToName(midi) : '--';
      _currentReadout.textContent = name + '  CC74:' + xCC + '  CC2:' + yCC;
    }
  }

  function _hideVisual() {
    if (_currentDot) { _currentDot.style.display = 'none'; }
    if (_currentXBar) { _currentXBar.style.width = '0%'; }
    if (_currentYBar) { _currentYBar.style.height = '0%'; }
    if (_currentReadout) { _currentReadout.textContent = '--'; }
  }

  function _startVibratoLoop() {
    _animStartMs = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    function tick() {
      if (!_active) { return; }
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

  // Document-level safety: release note even if pointer goes up outside pad.
  function _releaseActivePointer() {
    if (!_active) { return; }
    _active = false;
    _activePointerId = -1;
    _stopVibratoLoop();
    if (_currentResetPitchBend) { _currentResetPitchBend(); }
    if (_currentNoteOff && _currentMidi >= 0) { _currentNoteOff(_currentMidi); }
    _clearTimbre();
    _hideVisual();
    _currentMidi = -1;
    // Restore the preset's original sustain value we overrode on pointerdown.
    if (_savedSustain !== null && _savedSustainInst >= 0
        && SL.audio && SL.audio.getInstruments) {
      var insts = SL.audio.getInstruments();
      var inst = insts ? insts[_savedSustainInst] : null;
      if (inst && inst.settings && inst.settings.adsr) {
        inst.settings.adsr.s = _savedSustain;
      }
      _savedSustain = null;
      _savedSustainInst = -1;
    }
  }

  function _documentPointerUp(e) {
    // Only release if this is the pad's own pointer, not a second finger
    // lifting off a note button while the pad drag is still active.
    var isOurPointer = (typeof e.pointerId !== 'undefined') && (e.pointerId === _activePointerId);
    if (_active && isOurPointer) {
      _releaseActivePointer();
    }
  }
  document.addEventListener('pointerup', _documentPointerUp);
  document.addEventListener('pointercancel', _documentPointerUp);

  // ============================================================
  // Build
  // ============================================================

  function _buildBreathPadController(container, opts) {
    var baseOctave = opts.baseOctave;
    var noteOn = opts.noteOn;
    var noteOff = opts.noteOff;
    var applyPitchBend = opts.applyPitchBend;
    var resetPitchBendFn = opts.resetPitchBendFn;

    var containerW = container.clientWidth || DEFAULT_CONTAINER_WIDTH;
    var containerH = container.clientHeight || DEFAULT_CONTAINER_HEIGHT;

    var wrapper = document.createElement('div');
    wrapper.className = 'ctrl-breathpad-wrapper ssli-breathpad-wrapper';
    wrapper.style.width = containerW + 'px';
    wrapper.style.height = containerH + 'px';
    wrapper.style.position = 'relative';
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.boxSizing = 'border-box';

    // ---------- Main row: chromatic note grid (left) + pad (fills right) ----------
    var mainRow = document.createElement('div');
    mainRow.className = 'ssli-breathpad-main-row';
    mainRow.style.display = 'flex';
    mainRow.style.flexDirection = 'row';
    mainRow.style.flex = '1 1 auto';
    mainRow.style.minHeight = '0';
    wrapper.appendChild(mainRow);

    // ---------- Chromatic note grid (2 columns x 6 rows, left of pad) ----------
    var noteGrid = document.createElement('div');
    noteGrid.className = 'ssli-breathpad-note-grid';
    noteGrid.style.display = 'grid';
    noteGrid.style.gridTemplateColumns = 'repeat(' + NOTE_GRID_COLS + ', 1fr)';
    noteGrid.style.gridTemplateRows = 'repeat(' + NOTE_GRID_ROWS + ', 1fr)';
    noteGrid.style.gap = NOTE_GRID_GAP_PX + 'px';
    noteGrid.style.padding = PAD_PADDING_PX + 'px';
    noteGrid.style.width = NOTE_GRID_WIDTH_PX + 'px';
    noteGrid.style.boxSizing = 'border-box';
    noteGrid.style.flex = '0 0 auto';
    mainRow.appendChild(noteGrid);

    function _buildNoteGrid() {
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
        btn.style.height = '100%';
        btn.style.padding = '2px 2px';
        btn.style.fontSize = '12px';
        btn.style.textAlign = 'center';
        btn.style.minHeight = '0';
        btn.style.minWidth = '0';
        if (ni === _rootPc) {
          btn.className += ' ssli-fret-chord-active';
        }
        (function(capturedPc) {
          // Use pointerdown instead of click so the note change fires
          // immediately when a second finger taps a note button while the
          // first finger is still holding the pad. Click fires AFTER
          // pointerup, at which point _active is already false because
          // pointer capture release kills the pad's active state first.
          btn.addEventListener('pointerdown', function(ev) {
            ev.preventDefault();
            // Stop the button's pointer from bubbling into the pad's
            // pointer capture and stealing focus.
            ev.stopPropagation();
            var oldRootPc = _rootPc;
            _rootPc = capturedPc;
            _refreshNoteActiveStyles();
            // If the pad is active (another finger is on it), retrigger
            // the note at the new pitch class.
            var padIsActive = _active;
            var rootChanged = (capturedPc !== oldRootPc);
            if (padIsActive && rootChanged) {
              var oldMidi = _currentMidi;
              var newMidi = _computeMidi(baseOctave, _rootPc);
              if (_currentNoteOff && (oldMidi >= 0)) {
                _currentNoteOff(oldMidi);
              }
              _currentMidi = newMidi;
              if (noteOn) {
                noteOn(_currentMidi);
              }
              // Update the readout immediately so the user sees the new note
              // name without waiting for the next pointermove on the pad.
              if (_currentReadout) {
                _currentReadout.textContent = _midiToName(_currentMidi);
              }
            }
          });
        })(ni);
        noteGrid.appendChild(btn);
        buttons.push(btn);
      }
      _currentNoteButtons = buttons;
    }

    function _refreshNoteActiveStyles() {
      if (!_currentNoteButtons) { return; }
      var bi;
      for (bi = 0; bi < _currentNoteButtons.length; bi++) {
        var b = _currentNoteButtons[bi];
        var base = 'ssli-fret-chord-btn ssli-breathpad-note-btn';
        if (bi === _rootPc) {
          b.className = base + ' ssli-fret-chord-active';
        } else {
          b.className = base;
        }
      }
    }

    _buildNoteGrid();

    // ---------- Pad (fills remaining space to the right of degree column) ----------
    var padContainer = document.createElement('div');
    padContainer.style.position = 'relative';
    padContainer.style.flex = '1 1 auto';
    padContainer.style.minHeight = '0';
    mainRow.appendChild(padContainer);

    var pad = document.createElement('div');
    pad.className = 'ctrl-breathpad-pad ssli-breathpad-pad';
    pad.style.position = 'absolute';
    pad.style.left = PAD_PADDING_PX + 'px';
    pad.style.top = PAD_PADDING_PX + 'px';
    pad.style.right = PAD_PADDING_PX + 'px';
    pad.style.bottom = PAD_PADDING_PX + 'px';
    pad.style.background = 'radial-gradient(ellipse at center, rgba(76, 201, 240, 0.08) 0%, rgba(10, 10, 20, 0.85) 100%)';
    pad.style.border = '1px solid rgba(76, 201, 240, 0.25)';
    pad.style.borderRadius = '6px';
    pad.style.touchAction = 'none';
    pad.style.cursor = 'crosshair';
    pad.style.overflow = 'hidden';

    // Crosshair grid (purely visual hint at 2D expression)
    function _addGridLine(isVertical, frac, strong) {
      var line = document.createElement('div');
      line.className = 'ctrl-breathpad-grid ssli-breathpad-grid';
      line.style.position = 'absolute';
      line.style.background = strong ? 'rgba(76, 201, 240, 0.22)' : 'rgba(76, 201, 240, 0.10)';
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

    // Axis labels — overlaid on padContainer (not pad child) so the audit
    // doesn't count them as a sparse row inside the pad. pointer-events:none
    // keeps them inert.
    var AXIS_LABEL_OFFSET_PX = PAD_PADDING_PX + 4;
    var xLabel = document.createElement('div');
    xLabel.className = 'ctrl-breathpad-axis-label';
    xLabel.textContent = SL.t('breathpad.axis_x');
    xLabel.style.position = 'absolute';
    xLabel.style.left = AXIS_LABEL_OFFSET_PX + 'px';
    xLabel.style.bottom = AXIS_LABEL_OFFSET_PX + 'px';
    xLabel.style.fontSize = '10px';
    xLabel.style.color = 'rgba(200, 220, 240, 0.55)';
    xLabel.style.pointerEvents = 'none';
    xLabel.style.zIndex = '3';
    padContainer.appendChild(xLabel);

    var yLabel = document.createElement('div');
    yLabel.className = 'ctrl-breathpad-axis-label';
    yLabel.textContent = SL.t('breathpad.axis_y');
    yLabel.style.position = 'absolute';
    yLabel.style.right = AXIS_LABEL_OFFSET_PX + 'px';
    yLabel.style.top = AXIS_LABEL_OFFSET_PX + 'px';
    yLabel.style.fontSize = '10px';
    yLabel.style.color = 'rgba(200, 220, 240, 0.55)';
    yLabel.style.pointerEvents = 'none';
    yLabel.style.zIndex = '3';
    padContainer.appendChild(yLabel);

    // CC74 bar along top
    var xBar = document.createElement('div');
    xBar.className = 'ctrl-breathpad-xbar';
    xBar.style.position = 'absolute';
    xBar.style.left = '0';
    xBar.style.top = '0';
    xBar.style.height = '3px';
    xBar.style.width = '0%';
    xBar.style.background = 'var(--ssli-accent, #4cc9f0)';
    xBar.style.opacity = '0.8';
    xBar.style.pointerEvents = 'none';
    pad.appendChild(xBar);

    // CC2 bar along right
    var yBar = document.createElement('div');
    yBar.className = 'ctrl-breathpad-ybar';
    yBar.style.position = 'absolute';
    yBar.style.right = '0';
    yBar.style.bottom = '0';
    yBar.style.width = '3px';
    yBar.style.height = '0%';
    yBar.style.background = 'var(--ssli-accent, #4cc9f0)';
    yBar.style.opacity = '0.8';
    yBar.style.pointerEvents = 'none';
    pad.appendChild(yBar);

    // Glowing dot
    var dot = document.createElement('div');
    dot.className = 'ctrl-breathpad-dot';
    dot.style.position = 'absolute';
    dot.style.display = 'none';
    dot.style.borderRadius = '50%';
    dot.style.background = 'radial-gradient(circle, var(--ssli-accent, #4cc9f0) 0%, rgba(76, 201, 240, 0.0) 70%)';
    dot.style.boxShadow = '0 0 24px var(--ssli-accent, #4cc9f0)';
    dot.style.pointerEvents = 'none';
    pad.appendChild(dot);

    // Readout
    var readout = document.createElement('div');
    readout.className = 'ctrl-breathpad-readout';
    readout.textContent = '--';
    readout.style.position = 'absolute';
    readout.style.left = '50%';
    readout.style.top = '6px';
    readout.style.transform = 'translateX(-50%)';
    readout.style.fontSize = '12px';
    readout.style.color = 'rgba(220, 235, 245, 0.9)';
    readout.style.fontFamily = 'monospace';
    readout.style.pointerEvents = 'none';
    pad.appendChild(readout);

    padContainer.appendChild(pad);
    container.appendChild(wrapper);

    _currentPad = pad;
    _currentDot = dot;
    _currentXBar = xBar;
    _currentYBar = yBar;
    _currentReadout = readout;
    _currentNoteOff = noteOff;
    _currentApplyPitchBend = applyPitchBend;
    _currentResetPitchBend = resetPitchBendFn;

    function _localCoords(e) {
      var rect = pad.getBoundingClientRect();
      var relX = e.clientX - rect.left;
      var relY = e.clientY - rect.top;
      relX = Math.max(0, Math.min(rect.width, relX));
      relY = Math.max(0, Math.min(rect.height, relY));
      return { x: relX, y: relY, w: rect.width, h: rect.height };
    }

    function _applyAtPointer(e, isStart) {
      var c = _localCoords(e);
      var xFrac = (c.w > 0) ? (c.x / c.w) : 0;
      var yFrac = (c.h > 0) ? (1 - (c.y / c.h)) : 0;
      var xCC = Math.round(xFrac * CC_MAX);
      var yCC = Math.round(yFrac * CC_MAX);

      _lastX = c.x;
      _lastY = c.y;
      _lastPressure = (typeof e.pressure === 'number') ? e.pressure : 0;

      if (isStart) {
        _strikeY = c.y;
      }

      var deltaYPx = c.y - _strikeY;
      var pressure = _effectivePressure(_lastPressure, deltaYPx);

      _applyTimbre(xFrac, yFrac);
      _updateVisual(c.x, c.y, pressure, xCC, yCC, _currentMidi);
    }

    function _onPointerDown(e) {
      if (_active) { return; }
      e.preventDefault();
      if (pad.setPointerCapture && typeof e.pointerId !== 'undefined') {
        try { pad.setPointerCapture(e.pointerId); } catch (err) { /* capture best-effort */ }
      }
      _active = true;
      _activePointerId = (typeof e.pointerId !== 'undefined') ? e.pointerId : -1;
      // Force sustain to 100% on the current instrument before note-on so the
      // envelope holds at full amplitude while the pad is held. Restore on
      // pointer-up in _releaseActivePointer. Guarded by getInstruments/
      // getCurrentInstrument existence so tests without full SL.audio still
      // work.
      if (SL.audio && SL.audio.getInstruments && SL.audio.getCurrentInstrument) {
        var instId = SL.audio.getCurrentInstrument();
        var insts = SL.audio.getInstruments();
        var inst = insts ? insts[instId] : null;
        if (inst && inst.settings && inst.settings.adsr) {
          _savedSustainInst = instId;
          _savedSustain = inst.settings.adsr.s;
          inst.settings.adsr.s = BREATH_HELD_SUSTAIN;
        }
      }
      // Compute pitch from current root pitch class + base octave.
      _currentMidi = _computeMidi(baseOctave, _rootPc);
      noteOn(_currentMidi);
      _applyAtPointer(e, true);
      _startVibratoLoop();
    }

    function _onPointerMove(e) {
      if (!_active) { return; }
      _applyAtPointer(e, false);
    }

    function _onPointerUp(e) {
      if (!_active) { return; }
      _releaseActivePointer();
    }

    pad.addEventListener('pointerdown', _onPointerDown);
    pad.addEventListener('pointermove', _onPointerMove);
    pad.addEventListener('pointerup', _onPointerUp);
    pad.addEventListener('pointercancel', function(e) {
      // Mobile browsers fire pointercancel for scroll/zoom gestures. When we
      // have pointer capture, re-capture instead of releasing the note. If
      // capture fails, the document-level pointerup safety net will clean up.
      if (pad.setPointerCapture && typeof e.pointerId !== 'undefined') {
        try { pad.setPointerCapture(e.pointerId); return; } catch (err) { /* fall through to release */ }
      }
      _releaseActivePointer();
    });
    pad.addEventListener('pointerleave', function(e) {
      // If the pointer leaves while still pressed, rely on document-level
      // pointerup for final release. Here we don't auto-release on leave
      // alone -- the user may drag back in. Document handler covers drag-off.
    });
  }

  // ============================================================
  // Register
  // ============================================================

  if (!SL.controllers) { SL.controllers = {}; }
  SL.controllers.breathpad = {
    build: _buildBreathPadController,
    release: _releaseActivePointer
  };

  // ============================================================
  // Panic hook (defensive: PanicRegistry may not yet be loaded)
  // ============================================================

  if (SL.PanicRegistry && SL.PanicRegistry.register) {
    SL.PanicRegistry.register(
      'voices',
      'breathpad.pointer',
      function() { _releaseActivePointer(); },
      function() { return _active ? 'pointer active' : null; }
    );
  }

})();
