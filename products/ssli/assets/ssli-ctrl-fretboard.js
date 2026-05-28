// SSLI Controller: Unified Stringed Fretboard (Guitar + Bass)
// ES5 compatible (var, no arrow functions, no template literals)
// Real guitar behavior: fret area sets pitch silently, strum zone triggers sound
// Key-based chord selection, configurable strings 1-8, courses 1x/2x/3x, tuning presets
//
// EDUCATIONAL NOTES — Fretboard Control Surface
//
// This module implements a virtual fretboard for guitar, bass, and extended-range
// stringed instruments. It faithfully models the two-hand interaction of real
// fretted instruments: the fretting hand selects pitch (silently), the picking
// hand triggers sound. This separation is the defining UX characteristic —
// unlike a piano keyboard where pressing a key both selects pitch and triggers
// sound, a fretboard decouples pitch selection from sound production.
//
// The fretboard is a 2D grid: strings run horizontally (one per row), frets run
// vertically (each fret = one semitone higher). MIDI note = openStringNote + fret.
// Standard guitar tuning (E2-A2-D3-G3-B3-E4) uses intervals of 5-5-5-4-5
// semitones between adjacent strings — the B string breaks the otherwise uniform
// pattern of perfect fourths, a historical convention dating to lute tuning.
//
// Chord voicing on a fretboard is a constraint-satisfaction problem: given a set
// of pitch classes, find fret positions across all strings that are physically
// playable (limited fret span, root note on bass string) and musically complete.
// This differs fundamentally from keyboard chord voicing where any note
// combination is equally accessible.
//
// Ref: Helmholtz, H. (1863) On the Sensations of Tone
// Ref: Roads, C. (1996) The Computer Music Tutorial, MIT Press

(function() {
  'use strict';

  var SL = window.SynthLab;
  var NOTES = SL.NOTES;
  var NOTES_FLAT = SL.NOTES_FLAT;
  var MODES = SL.MODES;
  var CHORD_INT = SL.CHORD_INT;
  var CHORD_NAME = SL.CHORD_NAME;
  var NUMS = SL.NUMS;

  // Sentinel constants
  var NOT_FOUND = -1;
  var NO_TIMER = null;
  var FRET_MUTED = -1;
  var NO_CHORD_DEGREE = -1;

  // ============================================================
  // Constants
  // ============================================================

  // Fret markers: the traditional inlay dots found on guitar necks at specific
  // fret positions. These positions are not arbitrary — they mark musically
  // significant intervals from the open string: minor 3rd (3), perfect 4th (5),
  // perfect 5th (7), major 6th (9), octave (12), then the pattern repeats.
  // The 12th fret (octave) traditionally receives a double dot to mark the
  // point where the string's vibrating length is exactly halved.
  var FRET_MARKERS = [3, 5, 7, 9, 12, 15, 17];
  var FRET_COUNT = 12;
  var FRET_COUNT_NARROW = 7;
  // The strum zone occupies the rightmost 22% of the board, modeling the area
  // near the bridge/soundhole where a guitarist's picking hand operates.
  var STRUM_ZONE_FRACTION = 0.22;
  var FRET_HEADER_HEIGHT = 22;
  var FRET_OPEN_LABEL_WIDTH = 40;
  var FRET_OPEN_LABEL_WIDTH_NARROW = 34;
  // Viewport width threshold below which the fretboard switches to compact
  // (mobile-friendly) geometry — narrower chord panel, fewer frets, smaller
  // strum button, wrapping topbar so inline bass chord buttons don't overflow.
  var NARROW_VIEWPORT_THRESHOLD_PX = 900;
  var STRUM_TIME_THRESHOLD_MS = 250;
  var STRUM_STRING_THRESHOLD = 2;
  var MAX_FRET_DEFLECT_PX = 6;
  // String bending: 200 cents = 2 semitones, matching the typical physical
  // limit of a guitar string bend before it slips off the fretboard edge.
  // Blues and rock players routinely bend 1-2 semitones for expressive vibrato.
  var MAX_BEND_CENTS = 200;
  var BEND_SENSITIVITY = 3;
  var FRET_DOT_RADIUS = 4;
  var FRET_DOUBLE_DOT_OFFSET = 12;
  var MIDDLE_C_MIDI = 60;
  var DEFAULT_CONTAINER_WIDTH = 800;
  var DEFAULT_CONTAINER_HEIGHT = 300;
  // Strum stagger: a real guitar strum is NOT simultaneous — the pick travels
  // across strings over ~10-50ms depending on speed, creating the characteristic
  // cascading onset that distinguishes a strum from a keyboard chord.
  var STRUM_STAGGER_MS = 12;
  var VIBRATION_DURATION_MS = 800;
  var NOTE_SUSTAIN_MS = 2000;
  var TOP_BAR_HEIGHT = 30;
  // Chord voicing constraints: MAX_FRET_SEARCH limits how far up the neck
  // to look for chord tones, MAX_FRET_SPAN limits the stretch between the
  // lowest and highest fretted positions. A 4-fret span is the typical
  // comfortable reach for an average human hand in first position.
  var MAX_FRET_SEARCH = 5;
  var MAX_FRET_SPAN = 4;
  var MIN_STRING_COUNT = 1;
  var MAX_STRING_COUNT = 8;
  var DEFAULT_GUITAR_STRING_COUNT = 6;
  var DEFAULT_BASS_STRING_COUNT = 4;
  var STRUM_BUTTON_WIDTH = 48;
  var STRUM_BUTTON_WIDTH_NARROW = 32;
  var CHORD_PANEL_WIDTH = 210;
  var CHORD_PANEL_WIDTH_NARROW = 140;
  var CHORD_PANEL_ROWS = 4;
  var CHORD_PANEL_COLS = 2;
  var CHORD_PANEL_CELLS = CHORD_PANEL_ROWS * CHORD_PANEL_COLS;
  var CHORD_LONG_PRESS_MS = 500;
  var SEMITONES_PER_OCTAVE = 12;
  var DEFAULT_VELOCITY = 100;
  var STRUM_DELAY_MIN_MS = 10;
  var STRUM_DELAY_MAX_MS = 200;
  var STRUM_DELAY_DEFAULT_MS = 40;
  var RESTRUM_MIN_MS = 100;
  var RESTRUM_MAX_MS = 2000;
  var RESTRUM_DEFAULT_MS = 500;
  // 12 strum/arpeggio modes modeling distinct real-world guitar techniques:
  // - Strum: all strings sound in rapid succession (pick sweeps across strings)
  // - Arpeggio: strings played sequentially at a slower rate (broken chord)
  // - Rasgueado: flamenco technique — fingers fan out rapidly across strings
  // - Tremolo Pick: rapid alternating pick strokes on individual strings
  // - Fingerpick: classical/folk pattern — thumb plays bass, fingers play treble
  var FRET_STRUM_MODES = [
    'Strum Down', 'Strum Up', 'Strum Up/Down',
    'Arpeggio Down', 'Arpeggio Up', 'Arpeggio Up/Down',
    'Arpeggio Random', 'Arpeggio Converge', 'Arpeggio Diverge',
    'Rasgueado', 'Tremolo Pick', 'Fingerpick'
  ];
  var FRET_STRUM_MODE_COUNT = FRET_STRUM_MODES.length;
  var _fretStrumModeIdx = 0;
  var _fretStrumDirection = 1;
  var _fretStrumDelayMs = STRUM_DELAY_DEFAULT_MS;
  var _isFretRestrumEnabled = false;
  var _fretRestrumMs = RESTRUM_DEFAULT_MS;
  var _fretRestrumIntervalId = null;
  var _fretStrumTimeouts = [];
  // Rhythm patterns: arrays of timing multipliers applied to each successive
  // string in a strum. A multiplier of 1.0 = even spacing, >1.0 = longer gap
  // before the next string, <1.0 = shorter gap, 0 = skip (rest).
  // These model real rhythmic feels:
  // - Swing/Shuffle: long-short pairs (triplet feel), the backbone of jazz/blues
  // - Gallop: short-short-long, common in metal and Irish folk music
  // - Bossa Nova: the characteristic 3-3-2 syncopation of Brazilian music
  // - Reggae: offbeat emphasis (0 = skip downbeats, 1 = play upbeats)
  // Ref: Roads, C. (1996) The Computer Music Tutorial, ch. 23 on rhythm
  var FRET_RHYTHM_PATTERNS = {
    'Even':        [1, 1, 1, 1, 1, 1, 1, 1],
    'Swing':       [1.5, 0.5, 1.5, 0.5, 1.5, 0.5, 1.5, 0.5],
    'Dotted':      [1.5, 0.75, 1.5, 0.75, 1.5, 0.75, 1.5, 0.75],
    'Gallop':      [0.5, 0.5, 1, 0.5, 0.5, 1, 0.5, 0.5],
    'Syncopated':  [0.75, 1.25, 0.75, 1.25, 0.75, 1.25, 0.75, 1.25],
    'Waltz':       [1.5, 0.75, 0.75, 1.5, 0.75, 0.75, 1.5, 0.75],
    'Shuffle':     [1.67, 0.33, 1.67, 0.33, 1.67, 0.33, 1.67, 0.33],
    'Bossa Nova':  [1.5, 0.5, 1, 1.5, 0.5, 1, 1.5, 0.5],
    'Reggae':      [0, 1, 0, 1, 0, 1, 0, 1]
  };
  var FRET_RHYTHM_NAMES = Object.keys(FRET_RHYTHM_PATTERNS);
  var _fretCurrentRhythm = 'Even';

  var MODE_GUITAR = 'guitar';
  var MODE_BASS = 'bass';

  // Pitch class indices for Root dropdown
  var ROOT_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  // Mode keys and display names for the Mode dropdown.
  // These six modes cover the most common harmonic vocabularies in Western music:
  // - Ionian (Major) and Aeolian (Minor): the two fundamental diatonic modes
  // - Dorian: minor with a raised 6th, common in jazz and folk
  // - Mixolydian: major with a flatted 7th, essential for blues and rock
  // - Harmonic/Melodic Minor: classical alterations that create the leading tone
  // Each mode determines the chord qualities (major/minor/diminished) at each
  // scale degree, which populates the 8-cell chord panel.
  var MODE_OPTIONS = [
    { key: 'ionian',       label: 'Major' },
    { key: 'aeolian',      label: 'Minor' },
    { key: 'dorian',       label: 'Dorian' },
    { key: 'mixolydian',   label: 'Mixolydian' },
    { key: 'harmonic_min', label: 'Harmonic Minor' },
    { key: 'melodic_min',  label: 'Melodic Minor' }
  ];

  // Additional chord intervals not in CHORD_INT from the JSON.
  // minMaj7: minor triad + major 7th — the dark, dissonant jazz voicing
  // add9: major triad + 9th (compound 2nd) — bright open voicing
  // Power chord (5): root + 5th only — no 3rd, so neither major nor minor.
  // Power chords are the foundation of rock/metal guitar because the
  // missing 3rd avoids beating artifacts under heavy distortion.
  var LOCAL_CHORD_INT = {
    'minMaj7': [0, 3, 7, 11],
    'add9':    [0, 4, 7, 14],
    '5':       [0, 7]
  };
  var LOCAL_CHORD_NAME = {
    'minMaj7': 'mM7',
    'add9':    'add9',
    '5':       '5'
  };

  // Chord variation types for long-press popup.
  // These represent the most common chord modifications guitarists use:
  // sus2/sus4 replace the 3rd with 2nd/4th (suspended, unresolved sound),
  // 7/maj7 add the 7th (jazz/blues color), power chord (5) omits the 3rd.
  var VARIATION_TYPES = ['root', 'sus2', 'sus4', '7', 'maj7', 'add9', '5'];
  var VARIATION_LABELS = {
    'root': 'Root',
    'sus2': 'sus2',
    'sus4': 'sus4',
    '7':    '7th',
    'maj7': 'maj7',
    'add9': 'add9',
    '5':    'Power'
  };

  // ============================================================
  // Tuning Presets
  // ============================================================

  // Guitar tuning presets as MIDI note numbers (low string to high string).
  // Standard tuning E2-A2-D3-G3-B3-E4 uses intervals 5-5-5-4-5 semitones.
  // The non-uniform interval (B3 is a major 3rd above G3, not a 4th) is
  // inherited from Renaissance lute tuning and makes chord fingerings more
  // ergonomic at the cost of breaking transposition symmetry across strings.
  //
  // Drop D: lowest string down 2 semitones, enabling power chords with one
  // finger across the bottom 3 strings. Ubiquitous in rock/metal.
  // Open G/D: strumming all open strings produces a major chord — used
  // extensively in slide guitar (Robert Johnson, Keith Richards).
  // DADGAD: a suspended tuning favored in Celtic and Moroccan music.
  // All Fourths: uniform 5-semitone intervals, preferred by jazz players
  // for consistent fingering patterns across all strings.
  var GUITAR_TUNING_PRESETS = {
    'Standard':    { midi: [40, 45, 50, 55, 59, 64], label: 'Standard' },
    'Drop D':      { midi: [38, 45, 50, 55, 59, 64], label: 'Drop D' },
    'Open G':      { midi: [38, 43, 50, 55, 59, 62], label: 'Open G' },
    'Open D':      { midi: [38, 45, 50, 54, 57, 62], label: 'Open D' },
    'DADGAD':      { midi: [38, 45, 50, 55, 57, 62], label: 'DADGAD' },
    'All Fourths': { midi: [40, 45, 50, 55, 60, 65], label: 'All Fourths' }
  };
  var GUITAR_TUNING_NAMES = Object.keys(GUITAR_TUNING_PRESETS);

  // Bass tunings: one octave below guitar. Standard 4-string bass uses the
  // same pitch classes as the guitar's lowest 4 strings (E-A-D-G) but an
  // octave lower. The 5th string (B0, MIDI 23) extends to sub-bass range.
  var BASS_TUNING_PRESETS = {
    'Standard':    { midi: [23, 28, 33, 38, 43], label: 'Standard' },
    'Drop D':      { midi: [23, 26, 33, 38, 43], label: 'Drop D' },
    'All Fourths': { midi: [23, 28, 33, 38, 43], label: 'All Fourths' }
  };
  var BASS_TUNING_NAMES = Object.keys(BASS_TUNING_PRESETS);

  // Extension notes for strings beyond the preset range.
  // When the user selects 7 or 8 strings (extended-range instruments like
  // 7-string guitars or 8-string djent instruments), extra strings are added
  // by continuing the pattern of perfect fourths (5 semitones) in each direction.
  // Guitar: below E2=40, go down in fourths; above E4=64, go up in fourths
  var GUITAR_EXTEND_BELOW = [35, 30]; // B1, F#1
  var GUITAR_EXTEND_ABOVE = [69, 74]; // A4, D5

  // Bass: below B0=23, go down in fourths; above G2=43, go up in fourths
  var BASS_EXTEND_BELOW = [18, 13]; // F#0, C#0
  var BASS_EXTEND_ABOVE = [48, 53]; // C3, F3

  // ============================================================
  // State (per-build, reset on each build)
  // ============================================================

  var _stringStates = {};
  var _fretGeo = null;
  var _frettedPositions = {};
  var _mutedStrings = {};
  var _hasSafetyHandlersInstalled = false;
  var _currentBendCents = 0;

  // Touch tracking for fret-zone slur/slide gestures.
  // Maps touch identifier -> { row, startFret, startX, currentFret, active }
  var _fretZoneTouches = {};
  // Cents per fret for continuous pitch sliding between fret positions.
  // In 12-tone equal temperament, each semitone = 100 cents (by definition).
  // Sliding between frets produces continuous pitch change measured in cents,
  // applied as pitch bend to the active note — modeling guitar slide/slur.
  var CENTS_PER_SEMITONE = 100;

  // Mouse state for strum zone
  var _isMouseDownInStrumZone = false;
  var _mouseStrumStartY = 0;
  var _mouseStrumStartTime = 0;
  var _mouseStrumStringsCrossed = [];
  var _mouseStrumStartRow = -1;

  // Mouse state for fret zone
  var _isMouseDownInFretZone = false;
  var _mouseFretRow = -1;
  var _mouseFretStartFret = -1;
  var _isMouseFretSliding = false;

  // Touch tracking for strum zone
  var _strumZoneTouches = {};

  // Last pointer event for pressure velocity (cleared after use)
  var _lastPointerEvent = null;

  // Callbacks set per build
  var _noteOn = null;
  var _noteOff = null;
  var _applyPitchBend = null;
  var _resetPitchBend = null;

  // Configuration state (persists across rebuilds within mode)
  var _guitarConfig = {
    rootPc: 0,
    modeKey: 'ionian',
    stringCount: DEFAULT_GUITAR_STRING_COUNT,
    courses: 1,
    tuningName: 'Standard',
    activeChordDegree: -1,
    activeVariation: 'root'
  };
  var _bassConfig = {
    rootPc: 0,
    modeKey: 'ionian',
    stringCount: DEFAULT_BASS_STRING_COUNT,
    courses: 1,
    tuningName: 'Standard',
    activeChordDegree: -1,
    activeVariation: 'root'
  };
  var _currentConfig = null;
  var _currentMode = MODE_GUITAR;

  // Popup state
  var _variationPopup = null;
  var _fretPopupDismissTimerId = null;
  var FRET_POPUP_AUTO_DISMISS_MS = 2000;

  // ============================================================
  // Utility: get chord intervals (check both global and local)
  // ============================================================

  function _getChordIntervals(chordType) {
    var result = null;
    if (CHORD_INT && CHORD_INT[chordType]) {
      result = CHORD_INT[chordType];
    } else if (LOCAL_CHORD_INT[chordType]) {
      result = LOCAL_CHORD_INT[chordType];
    }
    return result;
  }

  function _getChordSuffix(chordType) {
    var result = chordType;
    if (CHORD_NAME && (CHORD_NAME[chordType] !== undefined)) {
      result = CHORD_NAME[chordType];
    } else if (LOCAL_CHORD_NAME[chordType] !== undefined) {
      result = LOCAL_CHORD_NAME[chordType];
    }
    return result;
  }

  // ============================================================
  // Pitch Bend
  // ============================================================

  function _doApplyPitchBend(cents) {
    _currentBendCents = cents;
    if (_applyPitchBend) {
      _applyPitchBend(cents);
    }
  }

  function _doResetPitchBend() {
    if (_resetPitchBend) {
      _resetPitchBend();
    }
    _currentBendCents = 0;
  }

  // ============================================================
  // Fretboard geometry helpers
  // ============================================================
  // The fretboard uses a coordinate system where row 0 = top of screen =
  // highest-pitched string (treble E on guitar). This is the standard visual
  // orientation: looking down at a guitar in playing position, the thinnest
  // string is closest to the floor. The tuning array is indexed lowest-to-
  // highest, so converting between visual row and tuning index requires
  // flipping: tuningIndex = numStrings - 1 - row.

  function _resetAllState() {
    _stringStates = {};
    _isMouseDownInStrumZone = false;
    _isMouseDownInFretZone = false;
    _mouseStrumStringsCrossed = [];
    _strumZoneTouches = {};
    _fretZoneTouches = {};
  }

  function _fretStringAtY(clientY) {
    var result = -1;
    if (_fretGeo) {
      var relativeY = clientY - _fretGeo.boardTop - _fretGeo.headerHeight;
      var safeStringSpacing = _fretGeo.stringSpacing || 1;
      var row = Math.floor(relativeY / safeStringSpacing);
      if (row < 0) { row = 0; }
      if (row >= _fretGeo.numStrings) { row = _fretGeo.numStrings - 1; }
      result = row;
    }
    return result;
  }

  function _fretAtX(clientX) {
    var result = 0;
    if (_fretGeo) {
      var relativeX = clientX - _fretGeo.boardLeft - _fretGeo.openLabelWidth;
      var safeFretWidth = _fretGeo.fretWidth || 1;
      var fret = Math.floor(relativeX / safeFretWidth);
      if (fret < 0) { fret = 0; }
      if (fret > _fretGeo.fretCount) { fret = _fretGeo.fretCount; }
      result = fret;
    }
    return result;
  }

  // Returns a fractional fret value for continuous pitch sliding.
  // e.g. 3.5 means halfway between fret 3 and fret 4.
  function _fractionalFretAtX(clientX) {
    var result = 0;
    if (_fretGeo) {
      var relativeX = clientX - _fretGeo.boardLeft - _fretGeo.openLabelWidth;
      var safeFretWidth = _fretGeo.fretWidth || 1;
      var fretExact = relativeX / safeFretWidth;
      if (fretExact < 0) { fretExact = 0; }
      if (fretExact > _fretGeo.fretCount) { fretExact = _fretGeo.fretCount; }
      result = fretExact;
    }
    return result;
  }

  // Core pitch calculation: MIDI note = open string tuning + fret number.
  // Each fret raises pitch by exactly one semitone (equal temperament).
  // The row-to-tuning index flip accounts for visual vs. pitch ordering.
  function _fretMidiForRowFret(row, fret) {
    var result = MIDDLE_C_MIDI;
    if (_fretGeo) {
      var stringIndex = _fretGeo.numStrings - 1 - row;
      result = _fretGeo.tuning[stringIndex] + fret;
    }
    return result;
  }

  function _isInStrumZone(clientX) {
    var isResult = false;
    if (_fretGeo) {
      var relativeX = clientX - _fretGeo.boardLeft;
      // Use the precomputed strum-zone X from build (accounts for chord-panel
      // width and FRET_OPEN_LABEL_WIDTH offset). Previously this used
      // `boardWidth * (1 - fraction)` where boardWidth was set to
      // containerWidth, which was 140 px wider than the real board when the
      // chord panel is present — shifting detection past the rightmost fret
      // column so touches on fret 15 never reached the strum handler.
      isResult = (relativeX >= _fretGeo.strumZoneStartX);
    }
    return isResult;
  }

  // ============================================================
  // String vibration visual
  // ============================================================
  // Vibration animation provides tactile visual feedback that a string is
  // sounding. The CSS animation simulates the transverse wave motion of a
  // plucked string. The void offsetWidth trick forces a DOM reflow to
  // restart the CSS animation even if the class was already present.

  function _triggerStringVibration(row) {
    var hasStringRow = _fretGeo && _fretGeo.stringLines && _fretGeo.stringLines[row];
    if (hasStringRow) {
      var lines = _fretGeo.stringLines[row];
      var lineIndex;
      for (lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        var line = lines[lineIndex];
        line.classList.remove('ctrl-string-vibrating');
        void line.offsetWidth;
        line.classList.add('ctrl-string-vibrating');
        (function(capturedLine) {
          setTimeout(function() {
            capturedLine.classList.remove('ctrl-string-vibrating');
          }, VIBRATION_DURATION_MS);
        })(line);
      }
    }
  }

  function _stopStringVibration(row) {
    var hasStringRow = _fretGeo && _fretGeo.stringLines && _fretGeo.stringLines[row];
    if (hasStringRow) {
      var lines = _fretGeo.stringLines[row];
      var lineIndex;
      for (lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        lines[lineIndex].classList.remove('ctrl-string-vibrating');
      }
    }
  }

  // Visual string deflection during bend: maps bend amount (in cents) to
  // a vertical pixel offset, simulating the physical displacement of a
  // string being pushed sideways across the fretboard. Opacity increases
  // with tension to convey the sense of increased string stress.
  function _fretDeflectString(row, bendCents) {
    var hasStringRow = _fretGeo && _fretGeo.stringLines && _fretGeo.stringLines[row];
    if (hasStringRow) {
      var lines = _fretGeo.stringLines[row];
      var deflect = (bendCents / MAX_BEND_CENTS) * MAX_FRET_DEFLECT_PX;
      var tension = Math.abs(bendCents) / MAX_BEND_CENTS;
      var lineIndex;
      for (lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        lines[lineIndex].style.transform = 'translateY(' + (-deflect) + 'px)';
        lines[lineIndex].style.opacity = String(0.6 + tension * 0.4);
      }
    }
  }

  function _fretResetStringDeflection(row) {
    var hasStringRow = _fretGeo && _fretGeo.stringLines && _fretGeo.stringLines[row];
    if (hasStringRow) {
      var lines = _fretGeo.stringLines[row];
      var lineIndex;
      for (lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        lines[lineIndex].style.transform = '';
        lines[lineIndex].style.opacity = '';
      }
    }
  }

  // ============================================================
  // Fretted position management
  // ============================================================

  function _getFrettedFretForRow(row) {
    var entry = _frettedPositions[row];
    var result = 0;
    if (entry) {
      result = entry.fret;
    }
    return result;
  }

  function _getMidiForCurrentFret(row) {
    var fret = _getFrettedFretForRow(row);
    return _fretMidiForRowFret(row, fret);
  }

  function _isStringMuted(row) {
    return Boolean(_mutedStrings[row]);
  }

  function _setFrettedPosition(row, fret) {
    var midi = _fretMidiForRowFret(row, fret);
    _frettedPositions[row] = { fret: fret, midi: midi };
    delete _mutedStrings[row];
    _updateFrettedVisuals();
  }

  function _clearFrettedPosition(row) {
    delete _frettedPositions[row];
    delete _mutedStrings[row];
    _updateFrettedVisuals();
  }

  function _clearAllFrettedPositions() {
    _frettedPositions = {};
    _mutedStrings = {};
    _updateFrettedVisuals();
  }

  function _updateFrettedVisuals() {
    if (_fretGeo && _fretGeo.boardElement) {
      var allCells = _fretGeo.boardElement.querySelectorAll('.ctrl-fret-pos');
      var cellIndex;
      for (cellIndex = 0; cellIndex < allCells.length; cellIndex++) {
        allCells[cellIndex].classList.remove('ctrl-fret-fretted');
      }
      var keys = Object.keys(_frettedPositions);
      var keyIndex;
      for (keyIndex = 0; keyIndex < keys.length; keyIndex++) {
        var row = parseInt(keys[keyIndex], 10);
        var fret = _frettedPositions[row].fret;
        var selector = '.ctrl-fret-pos[data-string="' + row + '"][data-fret="' + fret + '"]';
        var cell = _fretGeo.boardElement.querySelector(selector);
        if (cell) {
          cell.classList.add('ctrl-fret-fretted');
        }
      }
      var openLabels = _fretGeo.boardElement.querySelectorAll('.ssli-fret-open-label');
      var labelIndex;
      for (labelIndex = 0; labelIndex < openLabels.length; labelIndex++) {
        var labelRow = parseInt(openLabels[labelIndex].getAttribute('data-string'), 10);
        var hasFret = Boolean(_frettedPositions[labelRow]);
        var isMuted = Boolean(_mutedStrings[labelRow]);
        openLabels[labelIndex].classList.toggle('ctrl-fret-open-active', !hasFret && !isMuted);
        openLabels[labelIndex].classList.toggle('ctrl-fret-muted', isMuted);
      }
    }
  }

  // ============================================================
  // Sound triggering
  // ============================================================
  // Sound production follows real guitar physics: each string is an
  // independent monophonic voice. Playing a new note on an already-sounding
  // string immediately stops the previous note (noteOff) before starting
  // the new one (noteOn). This models physical reality — a string can only
  // vibrate at one pitch at a time.

  function _playStringAtCurrentFret(row) {
    if (!_isStringMuted(row)) {
      var midi = _getMidiForCurrentFret(row);
      var state = _stringStates[row];
      var courses = (_currentConfig) ? _currentConfig.courses : 1;

      if (state && state.active) {
        _noteOff(state.midi);
        if (state.courseMidis) {
          var offIdx;
          for (offIdx = 0; offIdx < state.courseMidis.length; offIdx++) {
            _noteOff(state.courseMidis[offIdx]);
          }
        }
        _doResetPitchBend();
        _fretResetStringDeflection(row);
      }

      var velocity = _lastPointerEvent ? SL.velocityFromPressure(_lastPointerEvent, DEFAULT_VELOCITY) : DEFAULT_VELOCITY;
      _noteOn(midi, velocity);
      _triggerStringVibration(row);

      // Course notes: models doubled/tripled string instruments.
      // Courses are groups of strings tuned to the same pitch or an octave apart.
      // On a 12-string guitar, the lower 4 courses have an octave-up partner
      // (adding brightness and shimmer) while the upper 2 courses are unison
      // (adding body/chorus). Mandolins use unison pairs on all courses.
      // This lower-half/upper-half split approximates real 12-string stringing.
      var courseMidis = [];
      if (courses >= 2) {
        var isLowerHalf = (row >= Math.floor(_fretGeo.numStrings / 2));
        var courseMidi = isLowerHalf ? (midi + SEMITONES_PER_OCTAVE) : midi;
        _noteOn(courseMidi, velocity);
        courseMidis.push(courseMidi);
      }
      if (courses >= 3) {
        var isLowerHalf3 = (row >= Math.floor(_fretGeo.numStrings / 2));
        var courseMidi3 = isLowerHalf3 ? (midi + SEMITONES_PER_OCTAVE) : midi;
        _noteOn(courseMidi3, velocity);
        courseMidis.push(courseMidi3);
      }

      var fret = _getFrettedFretForRow(row);
      var playingSelector = '.ctrl-fret-pos[data-string="' + row + '"][data-fret="' + fret + '"]';
      if (_fretGeo && _fretGeo.boardElement) {
        var playingCell = _fretGeo.boardElement.querySelector(playingSelector);
        if (playingCell) {
          playingCell.classList.add('playing');
        }
      }

      _stringStates[row] = {
        active: true,
        midi: midi,
        courseMidis: courseMidis,
        fret: fret,
        touchId: -1
      };

      (function(capturedRow, capturedMidi) {
        setTimeout(function() {
          var currentState = _stringStates[capturedRow];
          var isStringStillActive = currentState && currentState.active;
          var isMatchingMidi = isStringStillActive && (currentState.midi === capturedMidi);
          if (isMatchingMidi) {
            _releaseString(capturedRow);
          }
        }, NOTE_SUSTAIN_MS);
      })(row, midi);
    }
  }

  function _releaseString(row) {
    var state = _stringStates[row];
    if (state && state.active) {
      _noteOff(state.midi);
      if (state.courseMidis) {
        var offIdx;
        for (offIdx = 0; offIdx < state.courseMidis.length; offIdx++) {
          _noteOff(state.courseMidis[offIdx]);
        }
      }
      _doResetPitchBend();
      _fretResetStringDeflection(row);
      _stopStringVibration(row);
      state.active = false;

      if (_fretGeo && _fretGeo.boardElement) {
        var playingCells = _fretGeo.boardElement.querySelectorAll('.ctrl-fret-pos[data-string="' + row + '"].playing');
        var playIndex;
        for (playIndex = 0; playIndex < playingCells.length; playIndex++) {
          playingCells[playIndex].classList.remove('playing');
        }
      }
    }
  }

  function _releaseAllStrings() {
    if (_fretGeo) {
      var row;
      for (row = 0; row < _fretGeo.numStrings; row++) {
        _releaseString(row);
      }
    }
  }

  function _clearFretStrumTimeouts() {
    var st;
    for (st = 0; st < _fretStrumTimeouts.length; st++) { clearTimeout(_fretStrumTimeouts[st]); }
    _fretStrumTimeouts = [];
    if (_fretRestrumIntervalId !== NO_TIMER) { clearInterval(_fretRestrumIntervalId); _fretRestrumIntervalId = null; }
  }

  // Strum pattern engine: the core algorithm that turns a strum gesture into
  // a timed sequence of individual string attacks. Each strum mode reorders
  // the string array differently, then applies rhythm-pattern timing multipliers
  // to stagger the noteOn calls. The combination of mode (spatial order) and
  // rhythm (temporal spacing) produces the full range of guitar articulations.
  function _fireStrumPattern(minRow, maxRow) {
    var st;
    for (st = 0; st < _fretStrumTimeouts.length; st++) { clearTimeout(_fretStrumTimeouts[st]); }
    _fretStrumTimeouts = [];
    var mode = FRET_STRUM_MODES[_fretStrumModeIdx];
    var rows = [];
    var ri;
    for (ri = minRow; ri <= maxRow; ri++) { rows.push(ri); }
    var numStrings = rows.length;
    var delay = _fretStrumDelayMs;
    var ordered = rows.slice();

    if (mode === 'Strum Up' || mode === 'Arpeggio Up') {
      ordered.reverse();
    } else if (mode === 'Strum Up/Down' || mode === 'Arpeggio Up/Down') {
      if (_fretStrumDirection < 0) { ordered.reverse(); }
      _fretStrumDirection = _fretStrumDirection * -1;
    } else if (mode === 'Arpeggio Random') {
      // Fisher-Yates shuffle: unbiased random permutation of string order
      for (var sh = ordered.length - 1; sh > 0; sh--) {
        var swapIdx = Math.floor(Math.random() * (sh + 1));
        var tmp = ordered[sh];
        ordered[sh] = ordered[swapIdx];
        ordered[swapIdx] = tmp;
      }
    } else if (mode === 'Arpeggio Converge') {
      // Converge: interleave from both ends toward center (low-high-low-high...)
      // Creates a "closing in" effect — bass and treble alternate, meeting in the middle
      var sorted = rows.slice();
      ordered = [];
      var lo = 0;
      var hi = sorted.length - 1;
      while (lo <= hi) {
        ordered.push(sorted[lo]);
        if (lo !== hi) { ordered.push(sorted[hi]); }
        lo = lo + 1;
        hi = hi - 1;
      }
    } else if (mode === 'Arpeggio Diverge') {
      // Diverge: start from center string, expand outward (middle-low-high...)
      // Creates a "spreading out" effect — the inverse of converge
      var sorted2 = rows.slice();
      ordered = [];
      var center = Math.floor(sorted2.length / 2);
      ordered.push(sorted2[center]);
      for (var spread = 1; spread <= center; spread++) {
        if (center - spread >= 0) { ordered.push(sorted2[center - spread]); }
        if (center + spread < sorted2.length) { ordered.push(sorted2[center + spread]); }
      }
    } else if (mode === 'Rasgueado') {
      // Rasgueado: flamenco rapid-fire strum using successive fingers (a-m-i-p)
      // fanning outward. Delay is 1/3 of normal strum — extremely fast onset.
      delay = Math.max(delay / 3, STRUM_DELAY_MIN_MS);
    } else if (mode === 'Tremolo Pick') {
      // Tremolo: rapid alternating pick strokes, half the normal delay
      delay = Math.max(delay / 2, STRUM_DELAY_MIN_MS);
    } else if (mode === 'Fingerpick') {
      // Classical fingerpicking: thumb (p) plays bass strings first, then
      // fingers (i-m-a) play treble strings in reverse order. The 1.5x delay
      // gives each note more space, creating the unhurried fingerstyle feel.
      var mid = Math.floor(numStrings / 2);
      var bassStrings = rows.slice(mid);
      var trebleStrings = rows.slice(0, mid).reverse();
      ordered = bassStrings.concat(trebleStrings);
      delay = delay * 1.5;
    }

    // Arpeggios use 2x the base delay — slower cascade so each note is heard
    // distinctly. Strums use 1x for the rapid sweep effect.
    var isArpeggio = (mode.indexOf('Arpeggio') >= 0);
    var baseDelay = isArpeggio ? (delay * 2) : delay;
    // Rhythm multipliers scale the inter-note gap. Cumulative timing ensures
    // each note fires at the correct absolute time from strum start.
    var rhythmPat = FRET_RHYTHM_PATTERNS[_fretCurrentRhythm] || FRET_RHYTHM_PATTERNS['Even'];
    var cumulativeTime = 0;

    var si;
    for (si = 0; si < ordered.length; si++) {
      var safeRhythmLen = rhythmPat.length || 1;
      var rhythmMult = rhythmPat[si % safeRhythmLen];
      if (rhythmMult === 0) {
        cumulativeTime = cumulativeTime + baseDelay;
      } else {
        (function(capturedRow, capturedTime) {
          if (capturedTime === 0) {
            _playStringAtCurrentFret(capturedRow);
          } else {
            var tid = setTimeout(function() { _playStringAtCurrentFret(capturedRow); }, Math.round(capturedTime));
            _fretStrumTimeouts.push(tid);
          }
        })(ordered[si], cumulativeTime);
        cumulativeTime = cumulativeTime + (baseDelay * rhythmMult);
      }
    }
  }

  function _strumStrings(startRow, endRow) {
    var minRow = Math.min(startRow, endRow);
    var maxRow = Math.max(startRow, endRow);

    _fireStrumPattern(minRow, maxRow);

    /* Restrum: repeat at interval while holding */
    if (_fretRestrumIntervalId !== NO_TIMER) { clearInterval(_fretRestrumIntervalId); _fretRestrumIntervalId = null; }
    if (_isFretRestrumEnabled) {
      _fretRestrumIntervalId = setInterval(function() {
        _fireStrumPattern(minRow, maxRow);
      }, _fretRestrumMs);
    }
  }

  // ============================================================
  // Bend in strum zone
  // ============================================================
  // String bending: vertical drag in the strum zone bends the pitch of the
  // sounding note, modeling the real technique of pushing a string sideways
  // across the fretboard. The bend amount is proportional to drag distance,
  // clamped to +/- 200 cents (2 semitones). This is a key expressive technique
  // in blues, rock, and Indian classical music (gamakas).

  function _bendString(row, deltaY) {
    var state = _stringStates[row];
    if (state && state.active) {
      var bendCents = Math.max(-MAX_BEND_CENTS, Math.min(MAX_BEND_CENTS, deltaY * BEND_SENSITIVITY));
      _doApplyPitchBend(bendCents);
      _fretDeflectString(row, bendCents);
    }
  }

  // Slide/slur: apply continuous pitch bend based on fractional fret offset
  // from the note's sounding fret. Each fret = 1 semitone = 100 cents.
  function _slideToFractionalFret(row, fractionalFret) {
    var state = _stringStates[row];
    if (state && state.active) {
      var originalFret = state.fret;
      var fretDelta = fractionalFret - originalFret;
      var slideCents = fretDelta * CENTS_PER_SEMITONE;
      _doApplyPitchBend(slideCents);
      _fretDeflectString(row, slideCents);
    }
  }

  // ============================================================
  // Safety handlers
  // ============================================================
  // Document-level event listeners that prevent stuck notes when the pointer
  // leaves the fretboard element. Without these, a mousedown inside the
  // fretboard followed by a mouseup outside would leave strings ringing
  // indefinitely — the musical equivalent of a stuck sustain pedal.

  function _installSafetyHandlers() {
    if (!_hasSafetyHandlersInstalled) {
      _hasSafetyHandlersInstalled = true;

      document.addEventListener('mouseup', function() {
        if (_isMouseFretSliding) {
          _doResetPitchBend();
          _fretResetStringDeflection(_mouseFretRow);
        }
        _isMouseDownInStrumZone = false;
        _isMouseDownInFretZone = false;
        _isMouseFretSliding = false;
        _clearFretStrumTimeouts();
        _releaseAllStrings();
      });

      document.addEventListener('touchend', function(ev) {
        if (_fretGeo) {
          var touchIndex;
          for (touchIndex = 0; touchIndex < ev.changedTouches.length; touchIndex++) {
            var touchId = ev.changedTouches[touchIndex].identifier;
            var fretTracker = _fretZoneTouches[touchId];
            if (fretTracker && fretTracker.active) {
              _doResetPitchBend();
              _fretResetStringDeflection(fretTracker.row);
            }
            delete _strumZoneTouches[touchId];
            delete _fretZoneTouches[touchId];
          }
          if (ev.touches.length === 0) {
            _clearFretStrumTimeouts();
            _releaseAllStrings();
          }
        }
      });

      document.addEventListener('touchcancel', function(ev) {
        if (_fretGeo) {
          var touchIndex;
          for (touchIndex = 0; touchIndex < ev.changedTouches.length; touchIndex++) {
            var touchId = ev.changedTouches[touchIndex].identifier;
            var fretTracker = _fretZoneTouches[touchId];
            if (fretTracker && fretTracker.active) {
              _doResetPitchBend();
              _fretResetStringDeflection(fretTracker.row);
            }
            delete _strumZoneTouches[touchId];
            delete _fretZoneTouches[touchId];
          }
          if (ev.touches.length === 0) {
            _clearFretStrumTimeouts();
            _releaseAllStrings();
          }
        }
      });

      // Close variation popup on click outside
      document.addEventListener('mousedown', function(ev) {
        if (_variationPopup && !_variationPopup.contains(ev.target)) {
          _closeVariationPopup();
        }
      });
    }
  }

  // ============================================================
  // Wire fretboard events
  // ============================================================
  // Input handling implements the two-zone model:
  // - Fret zone (left 78%): mousedown/touchstart sets fretted position
  //   silently. If the string is already sounding, mousemove/touchmove
  //   applies continuous pitch slide (legato slur technique).
  // - Strum zone (right 22%): mousedown/touchstart plays the string
  //   immediately. Dragging across multiple strings within the time
  //   threshold triggers a full strum pattern.
  // Both mouse and touch paths are separate to support desktop and mobile.

  function _wireFretboardEvents(board) {
    _installSafetyHandlers();

    board.addEventListener('mousedown', function(ev) {
      ev.preventDefault();
      _lastPointerEvent = ev;
      var boardRect = board.getBoundingClientRect();
      _fretGeo.boardLeft = boardRect.left;
      _fretGeo.boardTop = boardRect.top;

      var row = _fretStringAtY(ev.clientY);
      var inStrumZone = _isInStrumZone(ev.clientX);

      if (inStrumZone) {
        _isMouseDownInStrumZone = true;
        _isMouseDownInFretZone = false;
        _mouseStrumStartY = ev.clientY;
        _mouseStrumStartTime = Date.now();
        _mouseStrumStartRow = row;
        _mouseStrumStringsCrossed = [row];
        _playStringAtCurrentFret(row);
      } else {
        _isMouseDownInFretZone = true;
        _isMouseDownInStrumZone = false;
        var fret = _fretAtX(ev.clientX);
        var existing = _frettedPositions[row];

        if (existing && (existing.fret === fret)) {
          _clearFrettedPosition(row);
        } else {
          _setFrettedPosition(row, fret);
        }

        // Track mouse fret position for slur/slide on mousemove
        _mouseFretRow = row;
        _mouseFretStartFret = fret;
        var mouseStringState = _stringStates[row];
        _isMouseFretSliding = (mouseStringState && mouseStringState.active);
      }
    });

    board.addEventListener('mousemove', function(ev) {
      // Slur/slide: when mouse is down in fret zone on a sounding string,
      // apply continuous pitch bend based on fractional fret position.
      if (_isMouseDownInFretZone && _isMouseFretSliding) {
        var slideFrac = _fractionalFretAtX(ev.clientX);
        _slideToFractionalFret(_mouseFretRow, slideFrac);

        var slideIntFret = Math.round(slideFrac);
        if (slideIntFret !== _mouseFretStartFret) {
          _mouseFretStartFret = slideIntFret;
          _setFrettedPosition(_mouseFretRow, slideIntFret);
        }
      }

      if (_isMouseDownInStrumZone) {
        var row = _fretStringAtY(ev.clientY);
        var elapsed = Date.now() - _mouseStrumStartTime;

        if ((row !== _mouseStrumStartRow) && (elapsed < STRUM_TIME_THRESHOLD_MS)) {
          if (_mouseStrumStringsCrossed.indexOf(row) === -1) {
            _mouseStrumStringsCrossed.push(row);
          }
          if (_mouseStrumStringsCrossed.length >= STRUM_STRING_THRESHOLD) {
            var minRow = _mouseStrumStringsCrossed[0];
            var maxRow = _mouseStrumStringsCrossed[0];
            var crossedIndex;
            for (crossedIndex = 1; crossedIndex < _mouseStrumStringsCrossed.length; crossedIndex++) {
              if (_mouseStrumStringsCrossed[crossedIndex] < minRow) { minRow = _mouseStrumStringsCrossed[crossedIndex]; }
              if (_mouseStrumStringsCrossed[crossedIndex] > maxRow) { maxRow = _mouseStrumStringsCrossed[crossedIndex]; }
            }
            _strumStrings(minRow, maxRow);
            _mouseStrumStringsCrossed = [row];
            _mouseStrumStartRow = row;
            _mouseStrumStartTime = Date.now();
          } else {
            _mouseStrumStartRow = row;
          }
        }
      }
    });

    board.addEventListener('mouseup', function() {
      if (_isMouseFretSliding) {
        _doResetPitchBend();
        _fretResetStringDeflection(_mouseFretRow);
      }
      _isMouseDownInStrumZone = false;
      _isMouseDownInFretZone = false;
      _isMouseFretSliding = false;
    });

    board.addEventListener('mouseleave', function() {
      if (_isMouseFretSliding) {
        _doResetPitchBend();
        _fretResetStringDeflection(_mouseFretRow);
      }
      _isMouseDownInStrumZone = false;
      _isMouseDownInFretZone = false;
      _isMouseFretSliding = false;
    });

    // --- TOUCH EVENTS ---

    board.addEventListener('touchstart', function(ev) {
      ev.preventDefault();
      var boardRect = board.getBoundingClientRect();
      _fretGeo.boardLeft = boardRect.left;
      _fretGeo.boardTop = boardRect.top;

      var touchIndex;
      for (touchIndex = 0; touchIndex < ev.changedTouches.length; touchIndex++) {
        var touch = ev.changedTouches[touchIndex];
        _lastPointerEvent = { pointerType: 'touch', pressure: touch.force };
        var row = _fretStringAtY(touch.clientY);
        var inStrumZone = _isInStrumZone(touch.clientX);

        if (inStrumZone) {
          _strumZoneTouches[touch.identifier] = {
            startTime: Date.now(),
            startY: touch.clientY,
            startRow: row,
            stringsCrossed: [row],
            lastRow: row
          };
          _playStringAtCurrentFret(row);
        } else {
          var fret = _fretAtX(touch.clientX);
          var existing = _frettedPositions[row];

          if (existing && (existing.fret === fret)) {
            _clearFrettedPosition(row);
          } else {
            _setFrettedPosition(row, fret);
          }

          // Track fret-zone touch for slur/slide gestures.
          // If the string is currently sounding, dragging will slide pitch.
          var stringState = _stringStates[row];
          var isStringSounding = (stringState && stringState.active);
          _fretZoneTouches[touch.identifier] = {
            row: row,
            startFret: fret,
            startX: touch.clientX,
            currentFret: fret,
            active: isStringSounding
          };
        }
      }
    });

    board.addEventListener('touchmove', function(ev) {
      ev.preventDefault();
      var touchIndex;
      for (touchIndex = 0; touchIndex < ev.changedTouches.length; touchIndex++) {
        var touch = ev.changedTouches[touchIndex];
        var touchId = touch.identifier;
        var strumTracker = _strumZoneTouches[touchId];
        var fretTracker = _fretZoneTouches[touchId];

        if (strumTracker) {
          var row = _fretStringAtY(touch.clientY);
          var elapsed = Date.now() - strumTracker.startTime;

          if ((row !== strumTracker.lastRow) && (elapsed < STRUM_TIME_THRESHOLD_MS)) {
            if (strumTracker.stringsCrossed.indexOf(row) === -1) {
              strumTracker.stringsCrossed.push(row);
            }
            if (strumTracker.stringsCrossed.length >= STRUM_STRING_THRESHOLD) {
              var minRow = strumTracker.stringsCrossed[0];
              var maxRow = strumTracker.stringsCrossed[0];
              var crossedIndex;
              for (crossedIndex = 1; crossedIndex < strumTracker.stringsCrossed.length; crossedIndex++) {
                if (strumTracker.stringsCrossed[crossedIndex] < minRow) { minRow = strumTracker.stringsCrossed[crossedIndex]; }
                if (strumTracker.stringsCrossed[crossedIndex] > maxRow) { maxRow = strumTracker.stringsCrossed[crossedIndex]; }
              }
              _strumStrings(minRow, maxRow);
              strumTracker.stringsCrossed = [row];
              strumTracker.lastRow = row;
              strumTracker.startTime = Date.now();
            } else {
              strumTracker.lastRow = row;
            }
          }
        } else if (fretTracker && fretTracker.active) {
          // Slur/slide: continuously bend pitch based on fractional fret position
          var fractionalFret = _fractionalFretAtX(touch.clientX);
          var slideRow = fretTracker.row;
          _slideToFractionalFret(slideRow, fractionalFret);

          // Update the fretted position visual when crossing a full fret boundary
          var intFret = Math.round(fractionalFret);
          if (intFret !== fretTracker.currentFret) {
            fretTracker.currentFret = intFret;
            _setFrettedPosition(slideRow, intFret);
          }
        }
      }
    });

    board.addEventListener('touchend', function(ev) {
      ev.preventDefault();
      var touchIndex;
      for (touchIndex = 0; touchIndex < ev.changedTouches.length; touchIndex++) {
        var touchId = ev.changedTouches[touchIndex].identifier;
        var fretTracker = _fretZoneTouches[touchId];
        if (fretTracker && fretTracker.active) {
          _doResetPitchBend();
          _fretResetStringDeflection(fretTracker.row);
        }
        delete _strumZoneTouches[touchId];
        delete _fretZoneTouches[touchId];
      }
    });

    board.addEventListener('touchcancel', function(ev) {
      ev.preventDefault();
      var touchIndex;
      for (touchIndex = 0; touchIndex < ev.changedTouches.length; touchIndex++) {
        var touchId = ev.changedTouches[touchIndex].identifier;
        var fretTracker = _fretZoneTouches[touchId];
        if (fretTracker && fretTracker.active) {
          _doResetPitchBend();
          _fretResetStringDeflection(fretTracker.row);
        }
        delete _strumZoneTouches[touchId];
        delete _fretZoneTouches[touchId];
      }
    });
  }

  // ============================================================
  // Tuning computation
  // ============================================================
  // Builds a MIDI tuning array for any string count by combining preset
  // tuning notes with extension notes. The algorithm constructs a "pool"
  // of available pitches (extensions below + preset + extensions above),
  // then selects the top N notes for the requested string count. This
  // means adding strings extends the range downward (like a 7-string guitar
  // adding a low B), while removing strings trims from the bass end
  // (like going from 6-string to 4-string keeps the treble strings).
  // If more strings are requested than the pool can provide, additional
  // strings are generated by continuing downward in perfect fourths.

  function _computeTuning(mode, tuningName, stringCount, baseOctave) {
    var presets = (mode === MODE_BASS) ? BASS_TUNING_PRESETS : GUITAR_TUNING_PRESETS;
    var preset = presets[tuningName];
    if (!preset) {
      preset = presets['Standard'];
    }
    var baseMidi = preset.midi.slice();
    var extBelow = (mode === MODE_BASS) ? BASS_EXTEND_BELOW : GUITAR_EXTEND_BELOW;
    var extAbove = (mode === MODE_BASS) ? BASS_EXTEND_ABOVE : GUITAR_EXTEND_ABOVE;

    var defaultBaseOctave = (mode === MODE_BASS) ? 2 : 3;
    var octaveShift = (baseOctave - defaultBaseOctave) * SEMITONES_PER_OCTAVE;

    // Build a pool of MIDI notes: extensions below + base + extensions above
    var pool = [];
    var extIdx;
    for (extIdx = extBelow.length - 1; extIdx >= 0; extIdx--) {
      pool.push(extBelow[extIdx]);
    }
    var baseIdx;
    for (baseIdx = 0; baseIdx < baseMidi.length; baseIdx++) {
      pool.push(baseMidi[baseIdx]);
    }
    for (extIdx = 0; extIdx < extAbove.length; extIdx++) {
      pool.push(extAbove[extIdx]);
    }

    // From the pool, take the top `stringCount` notes
    // The pool is ordered low to high. We want the highest `stringCount` notes
    // that fit: when fewer strings, use the top N; when more, use extended range
    var totalAvailable = pool.length;
    var startIndex = totalAvailable - stringCount;
    if (startIndex < 0) {
      startIndex = 0;
    }
    var tuning = [];
    var pickIdx;
    for (pickIdx = startIndex; pickIdx < totalAvailable && (tuning.length < stringCount); pickIdx++) {
      tuning.push(pool[pickIdx] + octaveShift);
    }
    // If we still need more strings (stringCount > pool), extend further down by fourths
    while (tuning.length < stringCount) {
      var lowestSoFar = tuning[0];
      tuning.unshift(lowestSoFar - 5);
    }

    return tuning;
  }

  // ============================================================
  // Chord shape generation
  // ============================================================
  // This is the chord voicing algorithm — the most musically complex part
  // of the fretboard. Given a set of pitch classes (e.g., C-E-G for C major)
  // and a tuning, it finds fret positions on each string that produce those
  // pitches. The algorithm is a greedy search per string with heuristics:
  //
  // 1. For each string, search frets 0..MAX_FRET_SEARCH for a chord tone
  // 2. Score candidates: lower frets preferred, root note on lowest string
  // 3. After all strings are assigned, check playability (fret span)
  // 4. If the span exceeds MAX_FRET_SPAN (4 frets), mute offending strings
  //
  // This models how guitarists actually find chord shapes — preferring open
  // strings and first-position fingerings, with the constraint that the human
  // hand can only span about 4 frets comfortably. Strings that cannot fit
  // within the span are muted (marked -1), just as a real guitarist would
  // mute unplayable strings with a spare finger.

  function _generateChordShape(tuning, chordPitchClasses, rootPc) {
    var numStrings = tuning.length;
    var frets = [];
    var stringIdx;

    for (stringIdx = 0; stringIdx < numStrings; stringIdx++) {
      var openNote = tuning[stringIdx];
      var bestFret = -1;
      var bestScore = 999;
      var fretSearch;

      for (fretSearch = 0; fretSearch <= MAX_FRET_SEARCH; fretSearch++) {
        var notePc = (openNote + fretSearch) % SEMITONES_PER_OCTAVE;
        if (notePc < 0) { notePc += SEMITONES_PER_OCTAVE; }
        if (chordPitchClasses.indexOf(notePc) !== NOT_FOUND) {
          // Scoring heuristic: fret number = base cost (lower = better).
          // Penalty of 10 for non-root on the lowest string, ensuring the
          // bass note is the chord root when possible (root-position voicing).
          var score = fretSearch;
          if ((stringIdx === 0) && (notePc !== rootPc)) {
            score += 10; // penalty for non-root on lowest string
          }
          if (score < bestScore) {
            bestScore = score;
            bestFret = fretSearch;
          }
        }
      }

      frets.push(bestFret);
    }

    // Playability check: the fret span is the distance between the lowest
    // and highest fretted positions (excluding open strings at fret 0).
    // If the span exceeds MAX_FRET_SPAN, the chord is physically unplayable
    // and we must mute one or more strings to bring it within reach.
    var minFret = 999;
    var maxFret = 0;
    var fretCheckIdx;
    for (fretCheckIdx = 0; fretCheckIdx < frets.length; fretCheckIdx++) {
      if (frets[fretCheckIdx] > 0) {
        if (frets[fretCheckIdx] < minFret) { minFret = frets[fretCheckIdx]; }
        if (frets[fretCheckIdx] > maxFret) { maxFret = frets[fretCheckIdx]; }
      }
    }

    if ((maxFret - minFret) > MAX_FRET_SPAN) {
      // Try to mute the strings causing the span issue (from lowest)
      var adjustIdx;
      for (adjustIdx = 0; adjustIdx < frets.length; adjustIdx++) {
        var isFretted = frets[adjustIdx] > 0;
        var isSpanFret = isFretted && ((frets[adjustIdx] === minFret) || (frets[adjustIdx] === maxFret));
        if (isSpanFret) {
          var wouldBeMin = 999;
          var wouldBeMax = 0;
          var checkIdx;
          for (checkIdx = 0; checkIdx < frets.length; checkIdx++) {
            if ((checkIdx !== adjustIdx) && (frets[checkIdx] > 0)) {
              if (frets[checkIdx] < wouldBeMin) { wouldBeMin = frets[checkIdx]; }
              if (frets[checkIdx] > wouldBeMax) { wouldBeMax = frets[checkIdx]; }
            }
          }
          if ((wouldBeMax - wouldBeMin) <= MAX_FRET_SPAN) {
            frets[adjustIdx] = -1;
            break;
          }
        }
      }
    }

    return frets;
  }

  // Converts a chord type (e.g., 'min', 'maj7') into a set of pitch classes
  // by adding each interval to the root and wrapping mod 12. The result is
  // an unordered set of pitch classes (0-11) that define the chord's identity
  // regardless of octave or voicing.
  function _chordPitchClassesFromType(rootPc, chordType) {
    var intervals = _getChordIntervals(chordType);
    var pitchClasses = [];
    if (intervals) {
      var intIdx;
      for (intIdx = 0; intIdx < intervals.length; intIdx++) {
        pitchClasses.push((rootPc + intervals[intIdx]) % SEMITONES_PER_OCTAVE);
      }
    }
    return pitchClasses;
  }

  // ============================================================
  // Diatonic chord computation
  // ============================================================
  // Builds the 7 diatonic triads for a given root and mode, plus the V7
  // (dominant 7th). In any diatonic mode, stacking 3rds on each scale degree
  // yields a predictable pattern of major, minor, and diminished triads.
  // For example, in C major: C(I), Dm(ii), Em(iii), F(IV), G(V), Am(vi), Bdim(vii).
  // The V7 (dominant 7th of the 5th degree) is added as the 8th button
  // because it is the most important non-diatonic chord in tonal harmony —
  // the V7-I cadence is the strongest resolution in Western music.
  // Ref: Helmholtz, H. (1863) On the Sensations of Tone, ch. XIV

  function _getDiatonicChords(rootPc, modeKey) {
    var modeData = MODES[modeKey];
    var chords = [];
    if (modeData) {
      var scale = modeData.scale;
      var triads = modeData.triads;
      var degIdx;
      for (degIdx = 0; degIdx < triads.length; degIdx++) {
        var chordRootPc = (rootPc + scale[degIdx]) % SEMITONES_PER_OCTAVE;
        var chordType = triads[degIdx];
        var noteNames = SL.useFlatNaming(rootPc) ? NOTES_FLAT : NOTES;
        var chordName = noteNames[chordRootPc] + _getChordSuffix(chordType);
        chords.push({
          rootPc: chordRootPc,
          type: chordType,
          name: chordName,
          degree: degIdx
        });
      }
      // Add V7 (dominant 7th of the 5th scale degree)
      var fifthDegreeIdx = 4;
      if (scale.length > fifthDegreeIdx) {
        var v7RootPc = (rootPc + scale[fifthDegreeIdx]) % SEMITONES_PER_OCTAVE;
        var v7NoteNames = SL.useFlatNaming(rootPc) ? NOTES_FLAT : NOTES;
        var v7Name = v7NoteNames[v7RootPc] + '7';
        chords.push({
          rootPc: v7RootPc,
          type: '7',
          name: v7Name,
          degree: fifthDegreeIdx,
          isV7: true
        });
      }
    }
    return chords;
  }

  // ============================================================
  // Apply a chord to the fretboard
  // ============================================================
  // Translates abstract chord pitch classes into concrete fret positions
  // on the current tuning, then updates the visual fretboard. Strings that
  // the voicing algorithm cannot assign within the playability constraints
  // are marked as muted. Open strings (fret 0) need no explicit entry —
  // they sound their natural tuning pitch when strummed.

  function _applyChordToFretboard(chordRootPc, chordType) {
    if (_fretGeo) {
      var pitchClasses = _chordPitchClassesFromType(chordRootPc, chordType);
      var frets = _generateChordShape(_fretGeo.tuning, pitchClasses, chordRootPc);

      _frettedPositions = {};
      _mutedStrings = {};

      var stringIndex;
      for (stringIndex = 0; stringIndex < frets.length; stringIndex++) {
        var fret = frets[stringIndex];
        var visualRow = _fretGeo.numStrings - 1 - stringIndex;
        if (fret === FRET_MUTED) {
          _mutedStrings[visualRow] = true;
        } else if (fret > 0) {
          _frettedPositions[visualRow] = { fret: fret, midi: _fretMidiForRowFret(visualRow, fret) };
        }
        // fret === 0: open string, no entry needed
      }

      _updateFrettedVisuals();
    }
  }

  // ============================================================
  // Variation popup
  // ============================================================

  function _clearFretPopupDismissTimer() {
    if (_fretPopupDismissTimerId !== NO_TIMER) {
      clearTimeout(_fretPopupDismissTimerId);
      _fretPopupDismissTimerId = null;
    }
  }

  function _closeVariationPopup() {
    _clearFretPopupDismissTimer();
    if (_variationPopup && _variationPopup.parentNode) {
      _variationPopup.parentNode.removeChild(_variationPopup);
    }
    _variationPopup = null;
  }

  function _showVariationPopup(anchorEl, chord, chordBtnCallback) {
    _closeVariationPopup();

    var popup = document.createElement('div');
    popup.className = 'ssli-fret-variation-popup';

    var rect = anchorEl.getBoundingClientRect();
    popup.style.position = 'fixed';
    popup.style.left = rect.left + 'px';
    popup.style.top = (rect.bottom + 2) + 'px';
    popup.style.zIndex = '9999';

    if (!chord._baseType) {
      chord._baseType = chord.type;
      chord._baseName = chord.name;
    }

    var varIdx;
    for (varIdx = 0; varIdx < VARIATION_TYPES.length; varIdx++) {
      var varType = VARIATION_TYPES[varIdx];
      var varBtn = document.createElement('button');
      varBtn.className = 'ssli-fret-var-btn';

      // Determine the actual chord type for this variation
      var actualType = chord.type;
      if (varType === 'root') {
        actualType = chord._baseType;
      } else if (varType === '5') {
        actualType = '5';
      } else if (varType === 'add9') {
        actualType = 'add9';
      } else {
        actualType = varType;
      }

      var noteNames = SL.useFlatNaming(chord.rootPc) ? NOTES_FLAT : NOTES;
      var varLabel = noteNames[chord.rootPc] + _getChordSuffix(actualType);
      if (varType === 'root') {
        varLabel = chord._baseName;
      }
      varBtn.textContent = varLabel;
      varBtn.title = VARIATION_LABELS[varType];

      (function(capturedRootPc, capturedType, capturedDegree, capturedLabel) {
        varBtn.addEventListener('click', function(clickEv) {
          clickEv.stopPropagation();
          _applyChordToFretboard(capturedRootPc, capturedType);
          if (_currentConfig) {
            _currentConfig.activeChordDegree = capturedDegree;
            _currentConfig.activeVariation = capturedType;
          }
          // Replace the anchor chord button with the chosen variant so
          // subsequent short-presses play this variant.
          chord.type = capturedType;
          chord.name = capturedLabel;
          chord.isV7 = false;
          if (anchorEl) {
            anchorEl.textContent = capturedLabel;
          }
          _closeVariationPopup();
          if (chordBtnCallback) {
            chordBtnCallback();
          }
        });
      })(chord.rootPc, actualType, chord.degree, varLabel);

      popup.appendChild(varBtn);
    }

    document.body.appendChild(popup);
    _variationPopup = popup;
  }

  // ============================================================
  // Build a single chord button (shared by top-bar and guitar chord panel)
  // highlightScope is the element whose descendant chord buttons should have
  // their active class toggled when this chord is selected.
  // ============================================================

  function _buildChordButton(chord, highlightScope, config) {
    // Delegate to the shared SL.chordPanel helper for consistent
    // short-press / long-press-for-variant behavior across surfaces.
    // The onSelect callback applies the chord to the fretboard and
    // mirrors the active variant back into config.
    var activeState = { activeDegree: config.activeChordDegree };
    var onSelect = function(selectedChord) {
      _applyChordToFretboard(selectedChord.rootPc, selectedChord.type);
      config.activeChordDegree = selectedChord.degree;
      config.activeVariation = selectedChord.type;
      activeState.activeDegree = selectedChord.degree;
    };
    var chordBtn;
    if (SL.chordPanel && SL.chordPanel.buildChordButton) {
      chordBtn = SL.chordPanel.buildChordButton(chord, highlightScope, activeState, onSelect);
    } else {
      // Defensive fallback: plain button that applies chord on click.
      chordBtn = document.createElement('button');
      chordBtn.className = 'ssli-fret-chord-btn';
      chordBtn.textContent = chord.isV7 ? (chord.name + '7') : chord.name;
      chordBtn.setAttribute('data-degree', chord.degree);
      chordBtn.addEventListener('click', function() { onSelect(chord); });
    }
    return chordBtn;
  }

  // ============================================================
  // Build top bar (two rows: row1 = dropdowns/controls, row2 = chord buttons)
  // ============================================================

  function _buildTopBar(container, containerWidth, mode, rebuildCallback, isNarrowViewport) {
    var config = _currentConfig;
    var topBar = document.createElement('div');
    topBar.className = 'ssli-fret-topbar';
    if (isNarrowViewport) {
      topBar.classList.add('ssli-fret-topbar-narrow');
    }
    topBar.style.width = containerWidth + 'px';
    // Height controlled by CSS: .ssli-fret-topbar (30px default),
    // narrow class (auto), phone-land overrides (auto with max-height).

    // === Row 1: Preset, Root, Mode, StringCount, Course, Tuning, Chords, Strum ===
    var row1 = document.createElement('div');
    row1.className = 'ssli-fret-topbar-row';

    // Physical Plucked Preset dropdown
    var presetSelect = document.createElement('select');
    presetSelect.className = 'ssli-fret-select';
    presetSelect.title = SL.t('fretboard.preset_title');
    var defaultPresetLabel = (mode === MODE_BASS) ? 'Bass Guitar' : 'Nylon Guitar';
    var pluckedPresets = [];
    if (SL.presets && SL.presets.getPresetsForEngineCategory) {
      pluckedPresets = SL.presets.getPresetsForEngineCategory('Physical', 'Plucked');
    }
    var presetIdx;
    for (presetIdx = 0; presetIdx < pluckedPresets.length; presetIdx++) {
      var pOpt = document.createElement('option');
      pOpt.value = pluckedPresets[presetIdx].name;
      pOpt.textContent = pluckedPresets[presetIdx].name;
      if (pluckedPresets[presetIdx].name === defaultPresetLabel) {
        pOpt.selected = true;
      }
      presetSelect.appendChild(pOpt);
    }
    presetSelect.addEventListener('change', function() {
      if (SL.presets && SL.presets.apply) {
        var selectedName = presetSelect.value;
        for (var pi = 0; pi < pluckedPresets.length; pi++) {
          if (pluckedPresets[pi].name === selectedName) {
            pluckedPresets[pi].engine = 'physical';
            SL.presets.apply(pluckedPresets[pi]);
            if (SL.state && SL.state.notify) { SL.state.notify('preset'); }
            break;
          }
        }
      }
    });
    row1.appendChild(presetSelect);

    // Root and mode are now controlled by the global topbar (no local duplicates).

    // String count dropdown
    var stringSelect = document.createElement('select');
    stringSelect.className = 'ssli-fret-select';
    stringSelect.title = SL.t('fretboard.strings_title');
    var strIdx;
    for (strIdx = MIN_STRING_COUNT; strIdx <= MAX_STRING_COUNT; strIdx++) {
      var strOpt = document.createElement('option');
      strOpt.value = String(strIdx);
      strOpt.textContent = strIdx + 'S';
      if (strIdx === config.stringCount) {
        strOpt.selected = true;
      }
      stringSelect.appendChild(strOpt);
    }
    stringSelect.addEventListener('change', function() {
      config.stringCount = parseInt(stringSelect.value, 10);
      config.activeChordDegree = -1;
      rebuildCallback();
    });
    row1.appendChild(stringSelect);

    // Course selector dropdown (1x / 2x / 3x)
    var courseSelect = document.createElement('select');
    courseSelect.className = 'ssli-fret-select';
    courseSelect.title = SL.t('fretboard.courses_title');
    var courseValues = [1, 2, 3];
    var courseLabels = ['1x', '2x', '3x'];
    var courseIdx;
    for (courseIdx = 0; courseIdx < courseValues.length; courseIdx++) {
      var courseOpt = document.createElement('option');
      courseOpt.value = String(courseValues[courseIdx]);
      courseOpt.textContent = courseLabels[courseIdx];
      if (courseValues[courseIdx] === config.courses) {
        courseOpt.selected = true;
      }
      courseSelect.appendChild(courseOpt);
    }
    courseSelect.addEventListener('change', function() {
      config.courses = parseInt(courseSelect.value, 10);
      rebuildCallback();
    });
    row1.appendChild(courseSelect);

    // Tuning dropdown
    var tuningNames = (mode === MODE_BASS) ? BASS_TUNING_NAMES : GUITAR_TUNING_NAMES;
    var tuningSelect = document.createElement('select');
    tuningSelect.className = 'ssli-fret-select';
    tuningSelect.title = SL.t('fretboard.tuning_title');
    var tuneIdx;
    for (tuneIdx = 0; tuneIdx < tuningNames.length; tuneIdx++) {
      var tuneOpt = document.createElement('option');
      tuneOpt.value = tuningNames[tuneIdx];
      tuneOpt.textContent = tuningNames[tuneIdx];
      if (tuningNames[tuneIdx] === config.tuningName) {
        tuneOpt.selected = true;
      }
      tuningSelect.appendChild(tuneOpt);
    }
    tuningSelect.addEventListener('change', function() {
      config.tuningName = tuningSelect.value;
      config.activeChordDegree = -1;
      rebuildCallback();
    });
    row1.appendChild(tuningSelect);

    // Chord buttons live in a dedicated panel left of the fretboard for
    // both guitar and bass (built in _buildFretboard). The "Open" (no-chord)
    // button sits in the topbar grouped with the tuning controls.
    var openCluster = document.createElement('div');
    openCluster.style.display = 'inline-flex';
    openCluster.style.alignItems = 'center';
    openCluster.style.gap = '4px';
    openCluster.style.flexShrink = '0';
    openCluster.appendChild(_buildOpenChordButton(container, config));
    row1.appendChild(openCluster);

    // Separator before strum controls
    var strumSep = document.createElement('div');
    strumSep.style.width = '1px';
    strumSep.style.height = '14px';
    strumSep.style.background = 'rgba(255,255,255,0.15)';
    strumSep.style.flexShrink = '0';
    row1.appendChild(strumSep);

    // Strum mode dropdown
    var strumModeSelect = document.createElement('select');
    strumModeSelect.className = 'ssli-fret-select';
    strumModeSelect.title = SL.t('fretboard.strum_pattern_title');
    var fretStrumIdx;
    for (fretStrumIdx = 0; fretStrumIdx < FRET_STRUM_MODE_COUNT; fretStrumIdx++) {
      var fretStrumOpt = document.createElement('option');
      fretStrumOpt.value = String(fretStrumIdx);
      fretStrumOpt.textContent = FRET_STRUM_MODES[fretStrumIdx];
      if (fretStrumIdx === _fretStrumModeIdx) { fretStrumOpt.selected = true; }
      strumModeSelect.appendChild(fretStrumOpt);
    }
    strumModeSelect.addEventListener('change', function() {
      _fretStrumModeIdx = parseInt(strumModeSelect.value, 10);
    });
    row1.appendChild(strumModeSelect);

    // Rhythm pattern dropdown
    var rhythmSelect = document.createElement('select');
    rhythmSelect.className = 'ssli-fret-select';
    rhythmSelect.title = SL.t('fretboard.rhythm_pattern_title');
    var fretRhythmIdx;
    for (fretRhythmIdx = 0; fretRhythmIdx < FRET_RHYTHM_NAMES.length; fretRhythmIdx++) {
      var fretRhythmOpt = document.createElement('option');
      fretRhythmOpt.value = FRET_RHYTHM_NAMES[fretRhythmIdx];
      fretRhythmOpt.textContent = FRET_RHYTHM_NAMES[fretRhythmIdx];
      if (FRET_RHYTHM_NAMES[fretRhythmIdx] === _fretCurrentRhythm) { fretRhythmOpt.selected = true; }
      rhythmSelect.appendChild(fretRhythmOpt);
    }
    rhythmSelect.addEventListener('change', function() {
      _fretCurrentRhythm = rhythmSelect.value;
    });
    row1.appendChild(rhythmSelect);

    // Strum speed slider
    var strumSpeedSlider = document.createElement('input');
    strumSpeedSlider.type = 'range';
    strumSpeedSlider.className = 'ssli-fret-speed-slider';
    strumSpeedSlider.min = String(STRUM_DELAY_MIN_MS);
    strumSpeedSlider.max = String(STRUM_DELAY_MAX_MS);
    strumSpeedSlider.value = String(_fretStrumDelayMs);
    var strumSpeedLabel = document.createElement('span');
    strumSpeedLabel.className = 'ssli-fret-speed-label';
    strumSpeedLabel.textContent = _fretStrumDelayMs + 'ms';
    strumSpeedSlider.addEventListener('input', function() {
      _fretStrumDelayMs = parseInt(strumSpeedSlider.value, 10);
      strumSpeedLabel.textContent = _fretStrumDelayMs + 'ms';
      SL.sliderOverlay.show(_fretStrumDelayMs + 'ms');
    });
    strumSpeedSlider.addEventListener('change', function() {
      SL.sliderOverlay.hide();
    });
    strumSpeedSlider.addEventListener('pointerup', function() {
      SL.sliderOverlay.hide();
    });
    strumSpeedSlider.addEventListener('touchend', function() {
      SL.sliderOverlay.hide();
    });
    row1.appendChild(strumSpeedSlider);
    row1.appendChild(strumSpeedLabel);

    // Restrum toggle
    var restrumBtn = document.createElement('button');
    restrumBtn.className = 'ssli-fret-chord-btn';
    restrumBtn.textContent = _isFretRestrumEnabled ? 'Repeat' : 'Once';
    restrumBtn.style.borderColor = _isFretRestrumEnabled ? 'var(--ssli-accent)' : '';
    restrumBtn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      _isFretRestrumEnabled = !_isFretRestrumEnabled;
      restrumBtn.textContent = _isFretRestrumEnabled ? 'Repeat' : 'Once';
      restrumBtn.style.borderColor = _isFretRestrumEnabled ? 'var(--ssli-accent)' : '';
    });
    row1.appendChild(restrumBtn);

    // Restrum speed slider
    var restrumSlider = document.createElement('input');
    restrumSlider.type = 'range';
    restrumSlider.className = 'ssli-fret-speed-slider';
    restrumSlider.min = String(RESTRUM_MIN_MS);
    restrumSlider.max = String(RESTRUM_MAX_MS);
    restrumSlider.value = String(_fretRestrumMs);
    var restrumLabel = document.createElement('span');
    restrumLabel.className = 'ssli-fret-speed-label';
    restrumLabel.textContent = _fretRestrumMs + 'ms';
    restrumSlider.addEventListener('input', function() {
      _fretRestrumMs = parseInt(restrumSlider.value, 10);
      restrumLabel.textContent = _fretRestrumMs + 'ms';
      SL.sliderOverlay.show(_fretRestrumMs + 'ms');
    });
    restrumSlider.addEventListener('change', function() {
      SL.sliderOverlay.hide();
    });
    restrumSlider.addEventListener('pointerup', function() {
      SL.sliderOverlay.hide();
    });
    restrumSlider.addEventListener('touchend', function() {
      SL.sliderOverlay.hide();
    });
    row1.appendChild(restrumSlider);
    row1.appendChild(restrumLabel);

    // NOTE: "Open" button used to live here at the end of row1, where it
    // flex-wrapped onto its own line and wasted a full row of vertical
    // space. It now sits with the diatonic chord buttons (inline on bass,
    // inside the chord panel grid on guitar — see _buildOpenChordButton
    // and _buildFretboard).

    topBar.appendChild(row1);
    container.appendChild(topBar);

    return topBar;
  }

  // Build the "Open" (no-chord) button. Clears all fretted positions and
  // marks itself active. Kept visually consistent with chord buttons.
  function _buildOpenChordButton(container, config) {
    var openBtn = document.createElement('button');
    openBtn.className = 'ssli-fret-chord-btn ssli-fret-chord-open';
    if (config.activeChordDegree === NO_CHORD_DEGREE) {
      openBtn.classList.add('ssli-fret-chord-active');
    }
    openBtn.textContent = SL.t('fretboard.open_btn');
    openBtn.title = SL.t('fretboard.open_btn_title');
    openBtn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      _clearAllFrettedPositions();
      config.activeChordDegree = -1;
      var allBtns = container.querySelectorAll('.ssli-fret-chord-btn[data-degree]');
      var btnIdx;
      for (btnIdx = 0; btnIdx < allBtns.length; btnIdx++) {
        allBtns[btnIdx].classList.remove('ssli-fret-chord-active');
      }
      openBtn.classList.add('ssli-fret-chord-active');
    });
    return openBtn;
  }

  function _makeCourseLineList() {
    return [];
  }

  // ============================================================
  // Compute string thickness
  // ============================================================
  // Visual string gauge: real guitar strings vary from ~0.25mm (high E) to
  // ~1.14mm (low E). Bass strings are thicker still (~1.07mm to ~1.30mm).
  // Row 0 = top of screen = highest-pitched = thinnest string. Higher row
  // indices = lower pitch = thicker visual representation.

  function _computeStringThickness(rowIndex, numStrings, mode) {
    // Thickest at bottom (row 0 = highest visual = thinnest), thickest at top (highest row)
    var result;
    if (mode === MODE_BASS) {
      result = Math.max(2, Math.min(6, rowIndex + 2));
    } else {
      result = Math.max(1, Math.min(4, rowIndex + 1));
    }
    return result;
  }

  // ============================================================
  // Build Fretboard
  // ============================================================
  // Master build function: constructs the complete fretboard UI from scratch.
  // Called on initial load and on every configuration change (string count,
  // tuning, courses). The layout has three horizontal zones:
  //   [Chord Panel] [Fret Grid + Strum Zone] [Strum Button]
  // The fret grid itself is divided: 78% fret area (pitch selection, silent)
  // and 22% strum zone (sound triggering). This two-zone architecture is the
  // key UX innovation — it decouples pitch and sound just like a real guitar.

  function _buildFretboard(container, opts) {
    var mode = opts.mode || MODE_GUITAR;
    _currentMode = mode;
    _currentConfig = (mode === MODE_BASS) ? _bassConfig : _guitarConfig;

    // Sync root and mode from global topbar state
    if (SL.screenPlay && SL.screenPlay.getRootPc) {
      _currentConfig.rootPc = SL.screenPlay.getRootPc();
    }
    if (SL.screenPlay && SL.screenPlay.getModeKey) {
      _currentConfig.modeKey = SL.screenPlay.getModeKey();
    }

    var defaultBaseOctave = (mode === MODE_BASS) ? 2 : 3;
    var baseOctave = (typeof opts.baseOctave === 'number') ? opts.baseOctave : defaultBaseOctave;

    _noteOn = opts.noteOn;
    _noteOff = opts.noteOff;
    _applyPitchBend = opts.applyPitchBend;
    _resetPitchBend = opts.resetPitchBendFn;

    // Clamp container width to viewport so nothing renders beyond the visible
    // area on narrow devices (iPhone landscape 844px etc.). `container.clientWidth`
    // can be stale (zero pre-layout → falls back to DEFAULT, often 800) which
    // pushes content past the actual viewport. Always cap by window.innerWidth
    // minus a small safety margin for scrollbars/banner chrome.
    var rawContainerWidth = container.clientWidth || DEFAULT_CONTAINER_WIDTH;
    var viewportWidth = (window.innerWidth || rawContainerWidth);
    var CONTAINER_SAFETY_MARGIN_PX = 4;
    var viewportCap = viewportWidth - CONTAINER_SAFETY_MARGIN_PX;
    var containerWidth;
    if (rawContainerWidth > viewportCap) {
      containerWidth = viewportCap;
    } else {
      containerWidth = rawContainerWidth;
    }
    var containerHeight = container.clientHeight || DEFAULT_CONTAINER_HEIGHT;

    var isNarrowViewport = (viewportWidth < NARROW_VIEWPORT_THRESHOLD_PX);
    var chordPanelWidthPx;
    var strumButtonWidthPx;
    var fretCountValue;
    var openLabelWidthPx;
    if (isNarrowViewport) {
      chordPanelWidthPx = CHORD_PANEL_WIDTH_NARROW;
      strumButtonWidthPx = STRUM_BUTTON_WIDTH_NARROW;
      fretCountValue = FRET_COUNT_NARROW;
      openLabelWidthPx = FRET_OPEN_LABEL_WIDTH_NARROW;
    } else {
      chordPanelWidthPx = CHORD_PANEL_WIDTH;
      strumButtonWidthPx = STRUM_BUTTON_WIDTH;
      fretCountValue = FRET_COUNT;
      openLabelWidthPx = FRET_OPEN_LABEL_WIDTH;
    }

    _resetAllState();

    // Rebuild function (called when config changes)
    var rebuildCallback = function() {
      // Clear container and rebuild
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
      _closeVariationPopup();
      _buildFretboard(container, opts);
    };

    var config = _currentConfig;
    var numStrings = config.stringCount;
    var courses = config.courses;
    var fretCount = fretCountValue;
    var tuning = _computeTuning(mode, config.tuningName, numStrings, baseOctave);

    // Build top bar
    var topBar = _buildTopBar(container, containerWidth, mode, rebuildCallback, isNarrowViewport);
    topBar.style.flexShrink = '0';

    var hasChordPanel = true;
    var chordPanelWidth = hasChordPanel ? chordPanelWidthPx : 0;
    var boardWidth = containerWidth - strumButtonWidthPx - chordPanelWidth;

    // Board row takes remaining space via flex — no dependency on topbar
    // height measurement. Append immediately so flex layout resolves.
    var boardRow = document.createElement('div');
    boardRow.className = 'ssli-fret-board-row';
    boardRow.style.display = 'flex';
    boardRow.style.flexDirection = 'row';
    boardRow.style.width = containerWidth + 'px';
    boardRow.style.flex = '1';
    boardRow.style.minHeight = '0';
    container.appendChild(boardRow);

    var boardHeight = boardRow.getBoundingClientRect().height;
    if (boardHeight < 80) { boardHeight = containerHeight - TOP_BAR_HEIGHT; }

    if (hasChordPanel) {
      var chordPanel = document.createElement('div');
      chordPanel.className = 'ssli-fret-chord-panel';
      if (isNarrowViewport) {
        chordPanel.classList.add('ssli-fret-chord-panel-narrow');
      }
      chordPanel.style.width = chordPanelWidthPx + 'px';
      chordPanel.style.height = boardHeight + 'px';
      chordPanel.style.flexShrink = '0';
      chordPanel.style.display = 'grid';
      chordPanel.style.gridTemplateColumns = 'repeat(' + CHORD_PANEL_COLS + ', 1fr)';
      chordPanel.style.gridTemplateRows = 'repeat(' + CHORD_PANEL_ROWS + ', 1fr)';

      var panelChords = _getDiatonicChords(config.rootPc, config.modeKey);
      var panelIdx;
      for (panelIdx = 0; panelIdx < panelChords.length && panelIdx < CHORD_PANEL_CELLS; panelIdx++) {
        chordPanel.appendChild(_buildChordButton(panelChords[panelIdx], chordPanel, config));
      }
      boardRow.appendChild(chordPanel);
    }

    var board = document.createElement('div');
    board.className = 'ctrl-fretboard ctrl-fretboard-' + mode + ' ssli-fretboard';
    board.style.width = boardWidth + 'px';
    board.style.height = boardHeight + 'px';
    board.style.flexShrink = '0';

    var headerHeight = FRET_HEADER_HEIGHT;
    var stringAreaHeight = boardHeight - headerHeight;
    var safeNumStrings = numStrings || 1;
    var stringSpacing = Math.floor(stringAreaHeight / safeNumStrings);
    var fretAreaWidth = boardWidth - openLabelWidthPx;
    var strumZoneWidth = Math.floor(fretAreaWidth * STRUM_ZONE_FRACTION);
    var fretableWidth = fretAreaWidth - strumZoneWidth;
    var fretWidth = Math.floor(fretableWidth / (fretCount + 1));

    var stringLines = {};
    var stringYPositions = [];
    var stringIndex;
    for (stringIndex = 0; stringIndex < numStrings; stringIndex++) {
      stringYPositions.push(headerHeight + stringIndex * stringSpacing + Math.floor(stringSpacing / 2));
    }

    // Fret numbers along top
    var fretNumberIndex;
    for (fretNumberIndex = 0; fretNumberIndex <= fretCount; fretNumberIndex++) {
      var fretNumberElement = document.createElement('div');
      fretNumberElement.className = 'ctrl-fret-number ssli-fret-number';
      fretNumberElement.style.left = (openLabelWidthPx + fretNumberIndex * fretWidth) + 'px';
      fretNumberElement.style.width = fretWidth + 'px';
      fretNumberElement.style.height = headerHeight + 'px';
      fretNumberElement.textContent = (fretNumberIndex === 0) ? 'O' : fretNumberIndex;
      board.appendChild(fretNumberElement);
    }

    // Fret marker dots
    var markerIndex;
    for (markerIndex = 0; markerIndex < FRET_MARKERS.length; markerIndex++) {
      var markerFret = FRET_MARKERS[markerIndex];
      if (markerFret > fretCount) {
        break;
      }
      var dotX = openLabelWidthPx + markerFret * fretWidth + Math.floor(fretWidth / 2);
      var dotY = headerHeight + Math.floor(stringAreaHeight / 2);
      var isDoubleDot = (markerFret === 12);
      var dot = document.createElement('div');
      dot.className = 'ctrl-fret-marker ssli-fret-marker-pos' + (isDoubleDot ? ' ctrl-fret-marker-double' : '');
      dot.style.left = (dotX - FRET_DOT_RADIUS) + 'px';
      dot.style.top = (dotY - (isDoubleDot ? FRET_DOUBLE_DOT_OFFSET : FRET_DOT_RADIUS)) + 'px';
      board.appendChild(dot);
      if (isDoubleDot) {
        var secondDot = document.createElement('div');
        secondDot.className = 'ctrl-fret-marker ssli-fret-marker-pos';
        secondDot.style.left = (dotX - FRET_DOT_RADIUS) + 'px';
        secondDot.style.top = (dotY + FRET_DOT_RADIUS) + 'px';
        board.appendChild(secondDot);
      }
    }

    // Strings and fret positions: each string gets its horizontal line elements
    // (1 per course) and a grid of fret-position cells. Each cell stores its
    // MIDI note, string row, and fret number as data attributes for event handling.
    var noteNames = SL.useFlatNaming(config.rootPc) ? NOTES_FLAT : NOTES;
    var boardFrag = document.createDocumentFragment();
    var rowIndex;
    for (rowIndex = 0; rowIndex < numStrings; rowIndex++) {
      var currentStringIndex = numStrings - 1 - rowIndex;
      var openMidi = tuning[currentStringIndex];
      var stringY = stringYPositions[rowIndex];

      // Course lines: renders 1, 2, or 3 parallel lines per string position.
      // Multi-course instruments (mandolin, 12-string, oud) have groups of
      // strings tuned in unison or octaves — visually represented as closely
      // spaced parallel lines with slightly reduced thickness.
      var courseLines = _makeCourseLineList();
      var courseOffset;
      var courseSpread = 3; // pixels between course lines
      var courseStart = -(courses - 1) * courseSpread / 2;
      var courseLineIdx;
      for (courseLineIdx = 0; courseLineIdx < courses; courseLineIdx++) {
        courseOffset = courseStart + courseLineIdx * courseSpread;
        var stringLine = document.createElement('div');
        stringLine.className = 'ctrl-string-line ssli-fret-string-line';
        stringLine.setAttribute('data-string', rowIndex);
        var thickness = _computeStringThickness(rowIndex, numStrings, mode);
        // For courses > 1, make each individual line slightly thinner
        if (courses > 1) {
          thickness = Math.max(1, thickness - 1);
        }
        stringLine.style.left = openLabelWidthPx + 'px';
        stringLine.style.top = (stringY - Math.floor(thickness / 2) + courseOffset) + 'px';
        // String line must stay inside the board element (boardWidth), not
        // extend across chord panel + strum button (containerWidth). The old
        // code used containerWidth which drew the line past the right edge on
        // narrow viewports.
        stringLine.style.width = (boardWidth - openLabelWidthPx) + 'px';
        stringLine.style.height = thickness + 'px';
        boardFrag.appendChild(stringLine);
        courseLines.push(stringLine);
      }
      stringLines[rowIndex] = courseLines;

      // Open string label
      var openLabel = document.createElement('div');
      openLabel.className = 'ctrl-open-label ssli-fret-open-label';
      openLabel.setAttribute('data-string', rowIndex);
      openLabel.style.top = (stringY - 14) + 'px';
      openLabel.textContent = noteNames[openMidi % SEMITONES_PER_OCTAVE] + (Math.floor(openMidi / SEMITONES_PER_OCTAVE) - 1);
      boardFrag.appendChild(openLabel);

      // Fret positions
      var fretIndex;
      for (fretIndex = 0; fretIndex <= fretCount; fretIndex++) {
        var midi = openMidi + fretIndex;
        var pitchClass = midi % SEMITONES_PER_OCTAVE;

        var fretElement = document.createElement('div');
        fretElement.className = 'ctrl-fret-pos ssli-fret-cell pc-' + pitchClass;
        fretElement.setAttribute('data-midi', midi);
        fretElement.setAttribute('data-string', rowIndex);
        fretElement.setAttribute('data-fret', fretIndex);
        fretElement.style.left = (openLabelWidthPx + fretIndex * fretWidth) + 'px';
        fretElement.style.top = (stringY - Math.floor(stringSpacing / 2)) + 'px';
        fretElement.style.width = fretWidth + 'px';
        fretElement.style.height = stringSpacing + 'px';

        var noteLabel = document.createElement('span');
        noteLabel.className = 'ctrl-fret-note';
        noteLabel.textContent = noteNames[pitchClass];
        fretElement.appendChild(noteLabel);

        boardFrag.appendChild(fretElement);
      }
    }
    board.appendChild(boardFrag);

    // Fret lines (vertical)
    var fretLineFrag = document.createDocumentFragment();
    var fretLineIndex;
    for (fretLineIndex = 1; fretLineIndex <= fretCount; fretLineIndex++) {
      var fretLine = document.createElement('div');
      fretLine.className = 'ctrl-fret-line ssli-fret-line';
      fretLine.style.left = (openLabelWidthPx + fretLineIndex * fretWidth - 1) + 'px';
      fretLine.style.top = headerHeight + 'px';
      fretLine.style.height = stringAreaHeight + 'px';
      fretLineFrag.appendChild(fretLine);
    }
    board.appendChild(fretLineFrag);

    // Strum zone overlay — starts immediately after the rightmost fret cell,
    // using the actual fretable width rather than containerWidth (which was
    // too far right on guitar mode where the chord panel + strum button
    // reduce the board's actual width by ~188 px).
    var strumZoneX = openLabelWidthPx + fretableWidth;
    var strumZone = document.createElement('div');
    strumZone.className = 'ctrl-strum-zone ssli-fret-strum-zone';
    strumZone.style.left = strumZoneX + 'px';
    strumZone.style.top = headerHeight + 'px';
    strumZone.style.width = strumZoneWidth + 'px';
    strumZone.style.height = stringAreaHeight + 'px';

    /* Strum zone label removed — big strum button replaces it */

    var strumFrag = document.createDocumentFragment();
    var strumIndicatorIndex;
    for (strumIndicatorIndex = 0; strumIndicatorIndex < numStrings; strumIndicatorIndex++) {
      var indicatorY = stringYPositions[strumIndicatorIndex] - headerHeight;
      var indicator = document.createElement('div');
      indicator.className = 'ctrl-strum-zone-string-indicator';
      indicator.style.top = (indicatorY - 3) + 'px';
      strumFrag.appendChild(indicator);
    }
    strumZone.appendChild(strumFrag);

    board.appendChild(strumZone);
    boardRow.appendChild(board);

    // Big strum button — full height, right edge
    var bigStrumBtn = document.createElement('button');
    bigStrumBtn.className = 'ssli-fret-big-strum';
    bigStrumBtn.style.width = strumButtonWidthPx + 'px';
    bigStrumBtn.style.height = boardHeight + 'px';
    bigStrumBtn.style.flexShrink = '0';
    bigStrumBtn.innerHTML = SL.t('fretboard.strum_label');
    bigStrumBtn.setAttribute('aria-label', SL.t('fretboard.strum_all'));
    bigStrumBtn.addEventListener('mousedown', function(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (_fretGeo) { _strumStrings(0, _fretGeo.numStrings - 1); }
      bigStrumBtn.classList.add('ssli-fret-big-strum-active');
    });
    bigStrumBtn.addEventListener('mouseup', function() {
      _clearFretStrumTimeouts();
      _releaseAllStrings();
      bigStrumBtn.classList.remove('ssli-fret-big-strum-active');
    });
    bigStrumBtn.addEventListener('mouseleave', function() {
      _clearFretStrumTimeouts();
      _releaseAllStrings();
      bigStrumBtn.classList.remove('ssli-fret-big-strum-active');
    });
    bigStrumBtn.addEventListener('touchstart', function(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (_fretGeo) { _strumStrings(0, _fretGeo.numStrings - 1); }
      bigStrumBtn.classList.add('ssli-fret-big-strum-active');
    });
    bigStrumBtn.addEventListener('touchend', function(ev) {
      ev.preventDefault();
      _clearFretStrumTimeouts();
      _releaseAllStrings();
      bigStrumBtn.classList.remove('ssli-fret-big-strum-active');
    });
    bigStrumBtn.addEventListener('touchcancel', function() {
      _clearFretStrumTimeouts();
      _releaseAllStrings();
      bigStrumBtn.classList.remove('ssli-fret-big-strum-active');
    });
    boardRow.appendChild(bigStrumBtn);

    // Store geometry after append
    var boardRect = board.getBoundingClientRect();
    _fretGeo = {
      numStrings: numStrings,
      tuning: tuning,
      fretCount: fretCount,
      fretWidth: fretWidth,
      headerHeight: headerHeight,
      stringSpacing: stringSpacing,
      stringYPositions: stringYPositions,
      boardLeft: boardRect.left,
      boardTop: boardRect.top,
      boardWidth: containerWidth,
      openLabelWidth: openLabelWidthPx,
      // Strum zone starts immediately after the last fret cell. Built from
      // the same values used to place the visual zone so touch detection
      // matches what the user sees.
      strumZoneStartX: openLabelWidthPx + fretableWidth,
      stringLines: stringLines,
      boardElement: board
    };

    _wireFretboardEvents(board);

    // Re-apply chord if one was active
    if (config.activeChordDegree >= 0) {
      var chords = _getDiatonicChords(config.rootPc, config.modeKey);
      var matchIdx;
      for (matchIdx = 0; matchIdx < chords.length; matchIdx++) {
        if (chords[matchIdx].degree === config.activeChordDegree) {
          var chordType = config.activeVariation || chords[matchIdx].type;
          _applyChordToFretboard(chords[matchIdx].rootPc, chordType);
          break;
        }
      }
    }
  }

  // ============================================================
  // Register controllers
  // ============================================================
  // Guitar and bass share the same fretboard implementation with different
  // defaults: guitar = 6 strings, octave 3, nylon preset; bass = 4 strings,
  // octave 2 (one octave lower), bass preset. Both register as separate
  // controller entries so the surface selector can offer them independently.

  if (!SL.controllers) { SL.controllers = {}; }

  SL.controllers.guitar = {
    build: function(container, opts) {
      opts.mode = MODE_GUITAR;
      _buildFretboard(container, opts);
    },
    clearChord: function() {
      _clearAllFrettedPositions();
    },
    releaseAll: function() { _releaseAllStrings(); },
    release: function() { _releaseAllStrings(); },
    clearStrumTimeouts: function() { _clearFretStrumTimeouts(); }
  };

  SL.controllers.bass = {
    build: function(container, opts) {
      opts.mode = MODE_BASS;
      _buildFretboard(container, opts);
    },
    clearChord: function() {
      _clearAllFrettedPositions();
    },
    releaseAll: function() { _releaseAllStrings(); },
    release: function() { _releaseAllStrings(); },
    clearStrumTimeouts: function() { _clearFretStrumTimeouts(); }
  };

  // ============================================================
  // PanicRegistry registrations (fretboard: guitar + bass share state)
  // ============================================================
  // Three panic categories ensure complete cleanup on MIDI panic:
  // - timers: cancel all pending strum/restrum setTimeout/setInterval IDs
  // - voices: release all sounding strings (noteOff for each active MIDI)
  // - controllers: clear fretted positions and muted-string markers

  if (SL.PanicRegistry) {
    SL.PanicRegistry.register(
      'timers',
      'fretboard.strumTimeouts',
      function teardownFretTimers() {
        _clearFretStrumTimeouts();
      },
      null
    );

    SL.PanicRegistry.register(
      'voices',
      'fretboard.strings',
      function teardownFretVoices() {
        _releaseAllStrings();
      },
      function assertFretVoices() {
        var row;
        var activeCount = 0;
        for (row in _stringStates) {
          var isOwnedActiveRow = _stringStates.hasOwnProperty(row) && _stringStates[row];
          var isActiveString = isOwnedActiveRow && _stringStates[row].active;
          if (isActiveString) {
            activeCount++;
          }
        }
        if (activeCount > 0) {
          return activeCount + ' fretboard string(s) still active';
        }
        return null;
      }
    );

    SL.PanicRegistry.register(
      'controllers',
      'fretboard.frettedPositions',
      function teardownFretControllers() {
        _clearAllFrettedPositions();
        _updateFrettedVisuals();
      },
      null
    );
  }

})();
