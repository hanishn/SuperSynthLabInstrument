// SSLI Controller: Special controllers
// Loom, Chord Pads, XY Pad, Marimba, Harp, Theremin, Chromatic Grid
// ES5 compatible (var, no arrow functions, no template literals)

(function() {
  'use strict';

  var SL = window.SynthLab;
  var NOTES = SL.NOTES;

  // ============================================================
  // Shared Constants
  // ============================================================

  var NO_TIMER      = null;  /* sentinel: no active interval/animframe handle */
  var NO_ATTR       = null;  /* sentinel: getAttribute returned no value */
  var NO_HIT        = null;  /* sentinel: hit-test returned no result */
  var NO_SELECTION  = null;  /* sentinel: no saved/selected value */
  var NO_SENSOR_VAL = null;  /* sentinel: device-orientation sensor value absent */

  var DEFAULT_CONTAINER_WIDTH = 800;
  var DEFAULT_CONTAINER_HEIGHT = 300;
  var MAJOR_SCALE_INTERVALS = [0, 2, 4, 5, 7, 9, 11];
  var SCALE_MODES = {
    'Major':        { intervals: [0, 2, 4, 5, 7, 9, 11], qualities: ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim'] },
    'Minor':        { intervals: [0, 2, 3, 5, 7, 8, 10], qualities: ['min', 'dim', 'maj', 'min', 'min', 'maj', 'maj'] },
    'Dorian':       { intervals: [0, 2, 3, 5, 7, 9, 10], qualities: ['min', 'min', 'maj', 'maj', 'min', 'dim', 'maj'] },
    'Mixolydian':   { intervals: [0, 2, 4, 5, 7, 9, 10], qualities: ['maj', 'min', 'dim', 'maj', 'min', 'min', 'maj'] },
    'Harmonic Min':  { intervals: [0, 2, 3, 5, 7, 8, 11], qualities: ['min', 'dim', 'maj', 'min', 'maj', 'maj', 'dim'] },
    'Melodic Min':   { intervals: [0, 2, 3, 5, 7, 9, 11], qualities: ['min', 'min', 'maj', 'maj', 'maj', 'dim', 'dim'] }
  };
  var SCALE_MODE_NAMES = Object.keys(SCALE_MODES);
  var LOOM_SCALE_TYPES = {
    'Pentatonic Major': [0, 2, 4, 7, 9],
    'Pentatonic Minor': [0, 3, 5, 7, 10],
    'Chromatic':        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
  };
  var LOOM_SCALE_TYPE_NAMES = ['Major', 'Minor', 'Dorian', 'Mixolydian', 'Harmonic Min', 'Melodic Min', 'Pentatonic Major', 'Pentatonic Minor', 'Chromatic'];
  var CHORD_PLAY_MODES = [
    'Block', 'Strum Up', 'Strum Down', 'Strum Up/Down',
    'Arpeggio Up', 'Arpeggio Down', 'Arpeggio Up/Down',
    'Arpeggio Random', 'Arpeggio Converge', 'Arpeggio Diverge',
    'Rasgueado', 'Tremolo', 'Fingerpick'
  ];
  var CHORD_PLAY_MODE_COUNT = CHORD_PLAY_MODES.length;
  var _chordPlayModeIdx = 0;
  var _chordStrumDirection = 1;

  /* Rhythm patterns: each is an array of relative beat multipliers.
     1 = normal spacing, 0.5 = half spacing (faster), 2 = double (slower), 0 = rest (skip) */
  var RHYTHM_PATTERNS = {
    'Even':        { label: 'Even',          pattern: [1, 1, 1, 1, 1, 1, 1, 1] },
    'Swing':       { label: 'Swing',         pattern: [1.5, 0.5, 1.5, 0.5, 1.5, 0.5, 1.5, 0.5] },
    'Dotted':      { label: 'Dotted',        pattern: [1.5, 0.75, 1.5, 0.75, 1.5, 0.75, 1.5, 0.75] },
    'Gallop':      { label: 'Gallop',        pattern: [0.5, 0.5, 1, 0.5, 0.5, 1, 0.5, 0.5] },
    'Syncopated':  { label: 'Syncopated',    pattern: [0.75, 1.25, 0.75, 1.25, 0.75, 1.25, 0.75, 1.25] },
    'Waltz':       { label: 'Waltz',         pattern: [1.5, 0.75, 0.75, 1.5, 0.75, 0.75, 1.5, 0.75] },
    'Rumba':       { label: 'Rumba',         pattern: [1.5, 1.5, 1, 1.5, 1.5, 1, 1.5, 1.5] },
    'Shuffle':     { label: 'Shuffle',       pattern: [1.67, 0.33, 1.67, 0.33, 1.67, 0.33, 1.67, 0.33] },
    'Bossa Nova':  { label: 'Bossa Nova',    pattern: [1.5, 0.5, 1, 1.5, 0.5, 1, 1.5, 0.5] },
    'Reggae':      { label: 'Reggae',        pattern: [0, 1, 0, 1, 0, 1, 0, 1] }
  };
  var RHYTHM_PATTERN_NAMES = Object.keys(RHYTHM_PATTERNS);
  var _currentRhythmName = 'Even';

  var _loomRoot = 0;
  var _loomScaleType = 'Major';
  var _loomContainer = null;
  var _loomOpts = null;

  var SEMITONES_PER_OCTAVE = 12;
  var MAX_BEND_CENTS = 200;
  var MIDI_MAX = 127;

  // Chord constants
  var CHORD_QUALITIES = ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim'];
  var CHORD_ROMAN = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii'];
  var CHORD_INTERVALS = {
    'maj':   [0, 4, 7],
    'min':   [0, 3, 7],
    'dim':   [0, 3, 6],
    'aug':   [0, 4, 8],
    'sus2':  [0, 2, 7],
    'sus4':  [0, 5, 7],
    'dom7':  [0, 4, 7, 10],
    'maj7':  [0, 4, 7, 11],
    'min7':  [0, 3, 7, 10],
    'dim7':  [0, 3, 6, 9],
    'aug7':  [0, 4, 8, 10],
    '5':     [0, 7]
  };
  var QUALITY_CYCLE = ['maj', 'min', 'dim', 'aug', 'sus2', 'sus4', 'dom7', 'maj7', 'min7', 'dim7', 'aug7', '5'];
  var QUALITY_LABELS = {
    'maj': 'major', 'min': 'minor', 'dim': 'diminished', 'aug': 'augmented',
    'sus2': 'sus2', 'sus4': 'sus4',
    'dom7': 'dominant 7', 'maj7': 'major 7', 'min7': 'minor 7',
    'dim7': 'diminished 7', 'aug7': 'augmented 7', '5': 'power'
  };
  /* Short labels for chord pad name display (e.g. "Cm", "Gdim") */
  var QUALITY_SHORT = {
    'maj': '', 'min': 'm', 'dim': 'dim', 'aug': 'aug', 'sus2': 'sus2', 'sus4': 'sus4',
    'dom7': '7', 'maj7': 'M7', 'min7': 'm7', 'dim7': 'dim7', 'aug7': 'aug7', '5': '5'
  };
  var CHORD_NOTE_COUNTS = [2, 3, 4, 5, 6];
  var DEFAULT_CHORD_NOTE_COUNT = 3;
  var CHORD_DEFAULT_VELOCITY = 100;
  /* U-06: Desaturated chord pad colors matching dark-neon aesthetic */
  var CHORD_COLORS = {
    0: '#2a4a6a',
    1: '#2a5a4a',
    2: '#2a5a4a',
    3: '#3a5a3a',
    4: '#5a3a3a',
    5: '#2a4a6a',
    6: '#4a3a5a'
  };
  var INVERSION_LABELS = ['R', '1', '2', '3'];
  var STRUM_DELAY_MIN_MS = 20;
  var STRUM_DELAY_MAX_MS = 150;
  var STRUM_DELAY_DEFAULT_MS = 60;
  var _strumDelayMs = STRUM_DELAY_DEFAULT_MS;
  var RESTRUM_MIN_MS = 100;
  var RESTRUM_MAX_MS = 2000;
  var RESTRUM_DEFAULT_MS = 500;
  var _restrumMs = RESTRUM_DEFAULT_MS;
  var _isRestrumEnabled = false;
  var _restrumIntervalId = null;

  // Chromatic Grid constants
  var CHROMATIC_GRID_COLS = 12;
  var CHROMGRID_DEFAULT_VELOCITY = 100;
  var CHROMATIC_GRID_ROW_INTERVAL = 12;
  // V-06: Colorblind-safe pitch class colors
  var CHROMATIC_GRID_NOTE_COLORS = [
    '#3080c0', '#606080', '#d08030', '#505070', '#c0a020',
    '#d08030', '#505070', '#3080c0', '#505070', '#8040c0',
    '#505070', '#6060a0'
  ];

  // Glow Keys (formerly "Loom") colors
  var LOOM_DEGREE_COLORS = ['#2a4aaa', '#3a5abb', '#4a6acc', '#557add', '#4a6acc', '#3a5abb', '#2a4aaa'];
  // Fixed note-on velocity for Glow Keys — Y axis drives filter cutoff, not velocity.
  var GLOWKEYS_NOTEON_VELOCITY = 100;
  // Y axis → filter cutoff (via SL.audio.setExpression). Log-spaced.
  var GLOWKEYS_CUTOFF_MIN_HZ = 400;
  var GLOWKEYS_CUTOFF_MAX_HZ = 12000;
  var GLOWKEYS_LN_CUTOFF_MIN = Math.log(GLOWKEYS_CUTOFF_MIN_HZ);
  var GLOWKEYS_LN_CUTOFF_MAX = Math.log(GLOWKEYS_CUTOFF_MAX_HZ);

  // Marimba colors
  var WOOD_DARK = ['#5a3a20', '#4e3520', '#543828', '#4a3018', '#503222'];
  var WOOD_LIGHT = ['#a06830', '#946028', '#8a5a28', '#9c6630', '#8e5c26', '#a06e38', '#946430'];
  var MARIMBA_OCTAVES = 2;
  var MARIMBA_TOP_ROW_RATIO = 0.38;
  var NATURALS = [0, 2, 4, 5, 7, 9, 11];
  var ACCIDENTALS = [1, 3, 6, 8, 10];

  // Harp colors — pedal harp convention: C=red/gold, F=blue/violet
  var HARP_C_COLOR = '#d4a017';
  var HARP_F_COLOR = '#6a5acd';
  // Graduated warm tones for other diatonic notes (D, E, G, A, B)
  var HARP_DIATONIC_COLORS = {
    2:  '#ede0c0',
    4:  '#e0cb96',
    7:  '#d4b870',
    9:  '#c8a74e',
    11: '#bfa044'
  };
  var DEFAULT_STRING_COLOR = '#d4c8a0';
  var HARP_ACCIDENTAL_COLOR = '#444455';
  var HARP_LABEL_FONT_SIZE = 11;
  var HARP_LABEL_TOP_OFFSET = 4;
  var HARP_VELOCITY_BOOST = 127;

  // XY Pad / Theremin continuous mode state
  var _isXypadContinuousMode = false;
  var _isThereminContinuousMode = true; // Theremin defaults to continuous (natural mode)

  // ============================================================
  // Helpers
  // ============================================================

  function _midiToName(midi) {
    var pc = midi % 12;
    var oct = Math.floor(midi / 12) - 1;
    return NOTES[pc] + oct;
  }

  function _makeTouchPressureEvent(touchEv) {
    var firstTouch = (touchEv.changedTouches && touchEv.changedTouches.length > 0) ? touchEv.changedTouches[0] : null;
    var force = firstTouch ? firstTouch.force : 0;
    return { pointerType: 'touch', pressure: force };
  }

  function _wireSimpleEvents(midi, el, noteOn, noteOff, activeClass) {
    (function(m, e) {
      e.addEventListener('mousedown', function(ev) { ev.preventDefault(); noteOn(m, ev); e.classList.add(activeClass); });
      e.addEventListener('mouseup', function() { noteOff(m); e.classList.remove(activeClass); });
      e.addEventListener('mouseleave', function(ev) { if (ev.buttons === 0) { noteOff(m); e.classList.remove(activeClass); } });
      e.addEventListener('mouseenter', function(ev) { if (ev.buttons > 0) { noteOn(m, ev); e.classList.add(activeClass); } });
      e.addEventListener('touchstart', function(ev) { ev.preventDefault(); var pe = _makeTouchPressureEvent(ev); noteOn(m, pe); e.classList.add(activeClass); });
      e.addEventListener('touchend', function(ev) { ev.preventDefault(); noteOff(m); e.classList.remove(activeClass); });
    })(midi, el);
  }

  // ============================================================
  // Loom Controller (Aodyo-style MPE strips)
  // ============================================================

  function _buildLoomController(container, opts) {
    var baseOctave = opts.baseOctave;
    var noteOn = opts.noteOn;
    var noteOff = opts.noteOff;

    var containerW = container.clientWidth || DEFAULT_CONTAINER_WIDTH;
    var containerH = container.clientHeight || DEFAULT_CONTAINER_HEIGHT;
    _loomContainer = container;
    _loomOpts = opts;

    // Sync root and scale from global topbar state
    if (SL.screenPlay && SL.screenPlay.getRootPc) {
      _loomRoot = SL.screenPlay.getRootPc();
    }
    var globalModeKey = (SL.screenPlay && SL.screenPlay.getModeKey) ? SL.screenPlay.getModeKey() : 'ionian';
    var globalModeData = (SL.MODES && SL.MODES[globalModeKey]) ? SL.MODES[globalModeKey] : null;

    var wrapper = document.createElement('div');
    wrapper.className = 'ctrl-loom-wrapper ssli-loom-wrapper';
    wrapper.style.width = containerW + 'px';
    wrapper.style.height = containerH + 'px';

    // Top bar \u2014 root/scale now controlled by global topbar; only show filter hint
    var LOOM_TOPBAR_HEIGHT = 26;
    var topBar = document.createElement('div');
    topBar.className = 'ssli-loom-topbar';
    topBar.style.height = LOOM_TOPBAR_HEIGHT + 'px';

    var velocityLabel = document.createElement('div');
    velocityLabel.className = 'ctrl-loom-velocity-label';
    velocityLabel.textContent = SL.t('loom.filter_hint');
    topBar.appendChild(velocityLabel);

    wrapper.appendChild(topBar);

    // Build note array from global scale
    var scaleIntervals;
    if (globalModeData && globalModeData.scale) {
      scaleIntervals = globalModeData.scale;
    } else {
      scaleIntervals = MAJOR_SCALE_INTERVALS;
    }

    var baseMidi = (baseOctave + 1) * 12 + _loomRoot;
    var loomNotes = [];
    var maxOctaves = (scaleIntervals.length >= 12) ? 1 : 2;
    for (var oct = 0; oct < maxOctaves; oct++) {
      for (var sii = 0; sii < scaleIntervals.length; sii++) {
        var m = baseMidi + oct * 12 + scaleIntervals[sii];
        if (m <= MIDI_MAX) { loomNotes.push(m); }
      }
    }

    var stripCount = loomNotes.length;
    var stripW = Math.floor(containerW / stripCount);
    var stripAreaH = containerH - LOOM_TOPBAR_HEIGHT;

    var stripContainer = document.createElement('div');
    stripContainer.style.display = 'flex';
    stripContainer.style.flex = '1';

    for (var li = 0; li < stripCount; li++) {
      var midi = loomNotes[li];
      var pc = midi % 12;
      var degreeIdx = li % scaleIntervals.length;
      var stripEl = document.createElement('div');
      stripEl.className = 'ctrl-loom-strip';
      stripEl.setAttribute('data-midi', midi);
      stripEl.style.width = stripW + 'px';
      stripEl.style.height = stripAreaH + 'px';
      stripEl.style.background = LOOM_DEGREE_COLORS[degreeIdx % 7];

      if (pc === _loomRoot) { stripEl.classList.add('ctrl-loom-root'); }

      var glowOverlay = document.createElement('div');
      glowOverlay.className = 'ctrl-loom-glow-overlay';
      stripEl.appendChild(glowOverlay);

      var lbl = document.createElement('div');
      lbl.className = 'ctrl-loom-label';
      lbl.textContent = NOTES[pc] + (Math.floor(midi / 12) - 1);
      stripEl.appendChild(lbl);

      stripContainer.appendChild(stripEl);
    }
    _wireGlowkeysPointerEvents(stripContainer, noteOn, noteOff);
    wrapper.appendChild(stripContainer);

    container.appendChild(wrapper);
  }

  function _rebuildLoom() {
    if (!_loomContainer || !_loomOpts) { return; }
    _loomContainer.innerHTML = '';
    _buildLoomController(_loomContainer, _loomOpts);
  }

  // Glow Keys (Loom) event wiring — multitouch via Pointer Events.
  //   - Y axis drives filter cutoff via SL.audio.setExpression (continuously,
  //     not just at note-on).
  //   - Drag across strips releases the leaving strip's note BEFORE starting
  //     the entered strip's note, per-pointer (glissando).
  //   - Multiple fingers can hold different notes simultaneously.
  //   - Document-level pointerup safety clears any stuck pointer.
  var _glowkeysActivePointers = {};  // pointerId -> { midi: number, el: element }
  var _glowkeysNoteOff = null;
  var _glowkeysNoteOn = null;

  function _glowkeysYFrac(clientY, el) {
    var rect = el.getBoundingClientRect();
    var yFrac = 1 - ((clientY - rect.top) / rect.height);
    if (yFrac < 0) { yFrac = 0; }
    if (yFrac > 1) { yFrac = 1; }
    return yFrac;
  }

  function _glowkeysApplyFilter(yFrac) {
    if (SL.audio && SL.audio.setExpression) {
      var cutoffHz = Math.exp(GLOWKEYS_LN_CUTOFF_MIN + yFrac * (GLOWKEYS_LN_CUTOFF_MAX - GLOWKEYS_LN_CUTOFF_MIN));
      SL.audio.setExpression(cutoffHz, null);
    }
  }

  function _glowkeysClearFilter() {
    if (SL.audio && SL.audio.clearExpression) {
      SL.audio.clearExpression();
    }
  }

  function _glowkeysShowGlow(el, yFrac) {
    var overlay = el.querySelector('.ctrl-loom-glow-overlay');
    if (overlay) {
      var brightness = 0.15 + yFrac * 0.45;
      var touchPct = Math.floor((1 - yFrac) * 100);
      overlay.style.background = 'radial-gradient(ellipse at 50% ' + touchPct + '%, rgba(255,255,255,' + brightness.toFixed(2) + ') 0%, transparent 70%)';
      overlay.style.opacity = '1';
    }
  }

  function _glowkeysHideGlow(el) {
    var overlay = el.querySelector('.ctrl-loom-glow-overlay');
    if (overlay) { overlay.style.opacity = '0'; }
  }

  function _glowkeysReleaseAll() {
    var pids = Object.keys(_glowkeysActivePointers);
    var i;
    for (i = 0; i < pids.length; i++) {
      var entry = _glowkeysActivePointers[pids[i]];
      if (entry.midi >= 0 && _glowkeysNoteOff) {
        try { _glowkeysNoteOff(entry.midi); } catch (e) { /* note may already be off */ }
      }
      if (entry.el) {
        entry.el.classList.remove('ctrl-loom-active');
        _glowkeysHideGlow(entry.el);
      }
    }
    _glowkeysActivePointers = {};
    _glowkeysClearFilter();
  }

  function _glowkeysReleasePointer(pointerId) {
    var entry = _glowkeysActivePointers[pointerId];
    if (entry) {
      if (entry.midi >= 0 && _glowkeysNoteOff) {
        try { _glowkeysNoteOff(entry.midi); } catch (e) { /* note may already be off */ }
      }
      if (entry.el) {
        // Only remove visual if no OTHER pointer is on this same note
        var isOtherOnSame = false;
        var pids = Object.keys(_glowkeysActivePointers);
        var i;
        for (i = 0; i < pids.length; i++) {
          var isSamePointer = (pids[i] === String(pointerId));
          var isSameMidi = (_glowkeysActivePointers[pids[i]].midi === entry.midi);
          if (!isSamePointer && isSameMidi) {
            isOtherOnSame = true;
          }
        }
        if (!isOtherOnSame) {
          entry.el.classList.remove('ctrl-loom-active');
          _glowkeysHideGlow(entry.el);
        }
      }
      delete _glowkeysActivePointers[pointerId];
    }
    // Clear filter only when no pointers remain
    var remainingCount = Object.keys(_glowkeysActivePointers).length;
    if (remainingCount === 0) {
      _glowkeysClearFilter();
    }
  }

  // Install document-level safety handler exactly once.
  var _isGlowkeysSafetyInstalled = false;
  function _installGlowkeysSafety() {
    if (_isGlowkeysSafetyInstalled) { return; }
    _isGlowkeysSafetyInstalled = true;
    document.addEventListener('pointerup', function(ev) { _glowkeysReleasePointer(ev.pointerId); });
    document.addEventListener('pointercancel', function(ev) { _glowkeysReleasePointer(ev.pointerId); });
  }

  // Engage a note for a given pointer on a strip element.
  function _glowkeysEngagePointer(pointerId, stripEl, clientY, pointerEvent) {
    var midi = parseInt(stripEl.getAttribute('data-midi'), 10);
    if (isNaN(midi)) { return; }
    var entry = _glowkeysActivePointers[pointerId];
    var currentMidi = entry ? entry.midi : -1;
    // Already on this same strip — just update Y
    if (currentMidi === midi) {
      var yFrac = _glowkeysYFrac(clientY, stripEl);
      _glowkeysShowGlow(stripEl, yFrac);
      _glowkeysApplyFilter(yFrac);
    } else {
      // Different strip (or first touch) — release old note for THIS pointer, start new
      if (entry) {
        _glowkeysReleasePointer(pointerId);
      }
      var yFracNew = _glowkeysYFrac(clientY, stripEl);
      if (_glowkeysNoteOn) {
        var glowVel = pointerEvent ? SL.velocityFromPressure(pointerEvent, GLOWKEYS_NOTEON_VELOCITY) : GLOWKEYS_NOTEON_VELOCITY;
        _glowkeysNoteOn(midi, glowVel);
      }
      _glowkeysActivePointers[pointerId] = { midi: midi, el: stripEl };
      stripEl.classList.add('ctrl-loom-active');
      _glowkeysShowGlow(stripEl, yFracNew);
      _glowkeysApplyFilter(yFracNew);
    }
  }

  // Find the strip element under the given screen coordinates.
  function _glowkeysFindStrip(clientX, clientY) {
    var hitEl = document.elementFromPoint(clientX, clientY);
    var result = null;
    if (hitEl) {
      result = hitEl.closest('.ctrl-loom-strip');
    }
    return result;
  }

  // Wire pointer events on the strip container for multitouch support.
  // All pointers are tracked independently — each finger gets its own note.
  // Glissando (sliding between strips) works per-pointer via elementFromPoint.
  function _wireGlowkeysPointerEvents(stripContainer, noteOn, noteOff) {
    _glowkeysNoteOn = noteOn;
    _glowkeysNoteOff = noteOff;
    _installGlowkeysSafety();

    stripContainer.style.touchAction = 'none';

    stripContainer.addEventListener('pointerdown', function(ev) {
      ev.preventDefault();
      var stripEl = _glowkeysFindStrip(ev.clientX, ev.clientY);
      if (stripEl) {
        _glowkeysEngagePointer(ev.pointerId, stripEl, ev.clientY, ev);
      }
    });

    stripContainer.addEventListener('pointermove', function(ev) {
      var entry = _glowkeysActivePointers[ev.pointerId];
      if (entry) {
        var stripEl = _glowkeysFindStrip(ev.clientX, ev.clientY);
        if (stripEl) {
          _glowkeysEngagePointer(ev.pointerId, stripEl, ev.clientY, ev);
        }
      }
    });

    stripContainer.addEventListener('pointerup', function(ev) {
      _glowkeysReleasePointer(ev.pointerId);
    });

    stripContainer.addEventListener('pointercancel', function(ev) {
      _glowkeysReleasePointer(ev.pointerId);
    });
  }

  // ============================================================
  // Chord Pad Controller
  // ============================================================

  // Chord pad state (persists across rebuilds within session)
  var _chordPadKey = 0;
  var _chordPadModeName = 'Major';
  var _isChordPadStrumMode = false;
  var _chordPadInversions = [0, 0, 0, 0, 0, 0, 0, 0];
  var _chordPadQualityOverrides = [null, null, null, null, null, null, null, null];
  var _chordPadNoteCount = DEFAULT_CHORD_NOTE_COUNT;
  var _chordPadNotes = [];
  var _padActiveNotes = {};  // padIdx -> array of MIDI notes currently sounding for that pad
  var _strumTimeouts = [];

  // Stored opts for rebuilds
  var _chordOpts = null;
  var _chordContainer = null;

  function _applyInversion(midis, inversionLevel) {
    if (inversionLevel === 0 || midis.length < 2) { return midis.slice(); }
    var result = midis.slice();
    var shifts = Math.min(inversionLevel, result.length - 1);
    for (var s = 0; s < shifts; s++) { result.push(result.shift() + 12); }
    return result;
  }

  function _buildChordMidis(rootMidi, quality, noteCount) {
    var intervals = CHORD_INTERVALS[quality] || CHORD_INTERVALS['maj'];
    var midis = [];
    var ni;
    /* Build base chord notes */
    for (ni = 0; ni < intervals.length; ni++) { midis.push(rootMidi + intervals[ni]); }
    /* If noteCount > intervals available, add octave doublings */
    var octaveShift = 12;
    while (midis.length < noteCount) {
      var addIdx = midis.length % intervals.length;
      midis.push(rootMidi + intervals[addIdx] + octaveShift);
      if (addIdx === intervals.length - 1) { octaveShift = octaveShift + 12; }
    }
    /* If noteCount < intervals available, trim from the top */
    if (midis.length > noteCount) { midis.length = noteCount; }
    return midis;
  }

  function _getChordPadData(baseOctave) {
    var baseMidi = (baseOctave + 1) * 12 + _chordPadKey;
    var modeData = SCALE_MODES[_chordPadModeName] || SCALE_MODES['Major'];
    var scaleSteps = modeData.intervals;
    var modeQualities = modeData.qualities;
    var pads = [];
    var noteNames = [];

    for (var ci = 0; ci < 7; ci++) {
      var rootNote = baseMidi + scaleSteps[ci];
      var quality = _chordPadQualityOverrides[ci] || modeQualities[ci];
      var rawMidis = _buildChordMidis(rootNote, quality, _chordPadNoteCount);
      var chordMidis = _applyInversion(rawMidis, _chordPadInversions[ci]);
      var chordName = NOTES[rootNote % 12];
      var qualityLabel = QUALITY_SHORT[quality] || '';
      noteNames.length = 0;
      for (var nn = 0; nn < chordMidis.length; nn++) { noteNames.push(NOTES[chordMidis[nn] % 12]); }
      pads.push({ midis: chordMidis, name: chordName + qualityLabel, roman: CHORD_ROMAN[ci], quality: quality, colorIdx: ci, noteNames: noteNames.join(' '), padIdx: ci });
    }

    var v7Root = baseMidi + scaleSteps[4];
    var v7Quality = _chordPadQualityOverrides[7] || 'dom7';
    var v7RawMidis = _buildChordMidis(v7Root, v7Quality, _chordPadNoteCount);
    var v7Midis = _applyInversion(v7RawMidis, _chordPadInversions[7]);
    var v7QualityLabel = QUALITY_SHORT[v7Quality] || '7';
    var v7NoteNames = [];
    for (var vn = 0; vn < v7Midis.length; vn++) { v7NoteNames.push(NOTES[v7Midis[vn] % 12]); }
    pads.push({ midis: v7Midis, name: NOTES[v7Root % 12] + v7QualityLabel, roman: 'V7', quality: v7Quality, colorIdx: 4, noteNames: v7NoteNames.join(' '), padIdx: 7 });

    return pads;
  }

  function _fireStrumOnce(midis, noteOn, noteOff, velocity) {
    var st;
    for (st = 0; st < _strumTimeouts.length; st++) { clearTimeout(_strumTimeouts[st]); }
    _strumTimeouts = [];
    var mode = CHORD_PLAY_MODES[_chordPlayModeIdx];

    if (mode === 'Block') {
      for (var i = 0; i < midis.length; i++) { noteOn(midis[i], velocity); }
    } else {
      /* For restrum, release previous notes before retriggering */
      for (var r = 0; r < _chordPadNotes.length; r++) { noteOff(_chordPadNotes[r]); }
      _chordPadNotes = midis.slice();
      var ordered = midis.slice();
      if (mode === 'Strum Down' || mode === 'Arpeggio Down') {
        ordered.reverse();
      } else if (mode === 'Strum Up/Down' || mode === 'Arpeggio Up/Down') {
        if (_chordStrumDirection < 0) { ordered.reverse(); }
        _chordStrumDirection = _chordStrumDirection * -1;
      } else if (mode === 'Arpeggio Random') {
        /* Fisher-Yates shuffle */
        for (var sh = ordered.length - 1; sh > 0; sh--) {
          var swapIdx = Math.floor(Math.random() * (sh + 1));
          var tmp = ordered[sh];
          ordered[sh] = ordered[swapIdx];
          ordered[swapIdx] = tmp;
        }
      } else if (mode === 'Arpeggio Converge') {
        /* Outside-in: lowest, highest, 2nd lowest, 2nd highest, ... */
        var sorted = midis.slice().sort(function(a, b) { return a - b; });
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
        /* Inside-out: middle notes first, then outward */
        var sorted2 = midis.slice().sort(function(a, b) { return a - b; });
        ordered = [];
        var center = Math.floor(sorted2.length / 2);
        ordered.push(sorted2[center]);
        for (var spread = 1; spread <= center; spread++) {
          if (center - spread >= 0) { ordered.push(sorted2[center - spread]); }
          if (center + spread < sorted2.length) { ordered.push(sorted2[center + spread]); }
        }
      } else if (mode === 'Rasgueado') {
        ordered.reverse();
      } else if (mode === 'Fingerpick') {
        var midPt = Math.floor(midis.length / 2);
        var bassNotes = midis.slice(0, midPt);
        var trebleNotes = midis.slice(midPt).reverse();
        ordered = bassNotes.concat(trebleNotes);
      }

      /* Apply rhythm pattern to timing */
      var rhythm = RHYTHM_PATTERNS[_currentRhythmName] || RHYTHM_PATTERNS['Even'];
      var rhythmPat = rhythm.pattern;
      var isArpeggio = (mode.indexOf('Arpeggio') >= 0);
      var isRasgueado = (mode === 'Rasgueado');
      var isTremolo = (mode === 'Tremolo');
      var baseDelay = _strumDelayMs;
      if (isArpeggio) { baseDelay = _strumDelayMs * 2; }
      if (isRasgueado) { baseDelay = Math.max(_strumDelayMs / 3, 10); }
      if (isTremolo) { baseDelay = Math.max(_strumDelayMs / 2, 10); }

      var cumulativeTime = 0;
      for (var si = 0; si < ordered.length; si++) {
        var rhythmMult = rhythmPat[si % rhythmPat.length];
        if (rhythmMult === 0) {
          /* Rest: skip this note but advance time */
          cumulativeTime = cumulativeTime + baseDelay;
        } else {
          (function(note, time, vel) {
            if (time === 0) {
              noteOn(note, vel);
            } else {
              var tid = setTimeout(function() { noteOn(note, vel); }, Math.round(time));
              _strumTimeouts.push(tid);
            }
          })(ordered[si], cumulativeTime, velocity);
          cumulativeTime = cumulativeTime + (baseDelay * rhythmMult);
        }
      }
    }
  }

  function _wireChordPadEvents(midiArray, el, noteOn, noteOff, padIdx) {
    (function(midis, e, capturedPadIdx) {
      var _lastChordVelocity = CHORD_DEFAULT_VELOCITY;
      function chordOn(domEvent) {
        /* Store which notes THIS pad triggers for per-pad release */
        _padActiveNotes[capturedPadIdx] = midis.slice();

        /* Compute velocity from pressure */
        _lastChordVelocity = domEvent ? SL.velocityFromPressure(domEvent, CHORD_DEFAULT_VELOCITY) : CHORD_DEFAULT_VELOCITY;

        /* Also maintain legacy _chordPadNotes for _fireStrumOnce/restrum compat */
        _chordPadNotes = midis.slice();
        _fireStrumOnce(midis, noteOn, noteOff, _lastChordVelocity);

        /* Restrum: if enabled and not Block mode, repeat at interval */
        if (_restrumIntervalId !== NO_TIMER) { clearInterval(_restrumIntervalId); _restrumIntervalId = null; }
        var mode = CHORD_PLAY_MODES[_chordPlayModeIdx];
        if (_isRestrumEnabled && mode !== 'Block') {
          _restrumIntervalId = setInterval(function() {
            _fireStrumOnce(midis, noteOn, noteOff, _lastChordVelocity);
          }, _restrumMs);
        }
        e.classList.add('ctrl-chord-active');
      }
      function chordOff() {
        var i;
        if (_restrumIntervalId !== NO_TIMER) { clearInterval(_restrumIntervalId); _restrumIntervalId = null; }
        var padNotes = _padActiveNotes[capturedPadIdx] || [];
        var mode = CHORD_PLAY_MODES[_chordPlayModeIdx];
        if (mode === 'Block') {
          /* Block mode: release only THIS pad's notes immediately */
          for (i = 0; i < padNotes.length; i++) { noteOff(padNotes[i]); }
        } else {
          /* Strum/arpeggio modes: let scheduled notes complete, then auto-release */
          var STRUM_RELEASE_PAD_MS = 200;
          var releaseDelay = _strumDelayMs * padNotes.length + STRUM_RELEASE_PAD_MS;
          var capturedNotes = padNotes.slice();
          setTimeout(function() {
            for (var ri = 0; ri < capturedNotes.length; ri++) { noteOff(capturedNotes[ri]); }
          }, releaseDelay);
        }
        delete _padActiveNotes[capturedPadIdx];
        /* Rebuild _chordPadNotes from remaining active pads */
        var allActive = [];
        var key;
        for (key in _padActiveNotes) {
          if (_padActiveNotes.hasOwnProperty(key)) {
            var remaining = _padActiveNotes[key];
            for (i = 0; i < remaining.length; i++) { allActive.push(remaining[i]); }
          }
        }
        _chordPadNotes = allActive;
        e.classList.remove('ctrl-chord-active');
      }
      e.addEventListener('mousedown', function(ev) { ev.preventDefault(); chordOn(ev); });
      e.addEventListener('mouseup', function() { chordOff(); });
      e.addEventListener('mouseleave', function() { chordOff(); });
      e.addEventListener('touchstart', function(ev) { ev.preventDefault(); ev.stopPropagation(); var pe = _makeTouchPressureEvent(ev); chordOn(pe); });
      e.addEventListener('touchend', function(ev) { ev.preventDefault(); ev.stopPropagation(); chordOff(); });
      e.addEventListener('touchcancel', function(ev) { ev.stopPropagation(); chordOff(); });
    })(midiArray, el, padIdx);
  }

  function _buildChordPadPadGrid(containerW, containerH, noteOn, noteOff, baseOctave) {
    var grid = document.getElementById('chordPadGrid');
    if (!grid) { return; }
    grid.innerHTML = '';
    var pads = _getChordPadData(baseOctave);

    var frag = document.createDocumentFragment();
    for (var ci = 0; ci < pads.length; ci++) {
      (function(pad) {
        var padEl = document.createElement('div');
        padEl.className = 'ctrl-chord-pad ssli-chord-pad';
        padEl.style.background = CHORD_COLORS[pad.colorIdx];

        var nameLbl = document.createElement('div');
        nameLbl.className = 'ctrl-chord-name';
        nameLbl.textContent = pad.name;
        padEl.appendChild(nameLbl);

        var romanLbl = document.createElement('div');
        romanLbl.className = 'ctrl-chord-roman';
        romanLbl.textContent = pad.roman;
        padEl.appendChild(romanLbl);

        var notesLbl = document.createElement('div');
        notesLbl.className = 'ctrl-chord-notes';
        notesLbl.textContent = pad.noteNames;
        padEl.appendChild(notesLbl);

        /* Quality cycle button (top-left) */
        var qualBtn = document.createElement('div');
        qualBtn.className = 'ctrl-chord-qual-btn';
        var currentQualIdx = QUALITY_CYCLE.indexOf(pad.quality);
        qualBtn.textContent = QUALITY_LABELS[pad.quality] || pad.quality;
        qualBtn.title = SL.t('chordpads.cycle_quality_title');
        (function(capturedPad) {
          var cycleQuality = function(ev) {
            ev.stopPropagation(); ev.preventDefault();
            var curQ = _chordPadQualityOverrides[capturedPad.padIdx] || capturedPad.quality;
            var curIdx = QUALITY_CYCLE.indexOf(curQ);
            var nextIdx = (curIdx + 1) % QUALITY_CYCLE.length;
            _chordPadQualityOverrides[capturedPad.padIdx] = QUALITY_CYCLE[nextIdx];
            _chordPadInversions[capturedPad.padIdx] = 0;
            _rebuildChordPads();
          };
          qualBtn.addEventListener('click', cycleQuality);
          qualBtn.addEventListener('touchstart', cycleQuality);
        })(pad);
        padEl.appendChild(qualBtn);

        /* Inversion button (top-right) */
        var invBtn = document.createElement('div');
        invBtn.className = 'ctrl-chord-inv-btn';
        invBtn.textContent = INVERSION_LABELS[_chordPadInversions[pad.padIdx]];
        invBtn.title = SL.t('chordpads.cycle_inversion_title');
        invBtn.addEventListener('click', function(ev) {
          ev.stopPropagation(); ev.preventDefault();
          var maxInv = (pad.midis.length > 3) ? 3 : 2;
          _chordPadInversions[pad.padIdx] = (_chordPadInversions[pad.padIdx] + 1) % (maxInv + 1);
          _rebuildChordPads();
        });
        invBtn.addEventListener('touchstart', function(ev) {
          ev.stopPropagation(); ev.preventDefault();
          var maxInv = (pad.midis.length > 3) ? 3 : 2;
          _chordPadInversions[pad.padIdx] = (_chordPadInversions[pad.padIdx] + 1) % (maxInv + 1);
          _rebuildChordPads();
        });
        padEl.appendChild(invBtn);

        _wireChordPadEvents(pad.midis, padEl, noteOn, noteOff, pad.padIdx);
        frag.appendChild(padEl);
      })(pads[ci]);
    }
    grid.appendChild(frag);
  }

  function _rebuildChordPads() {
    if (!_chordOpts || !_chordContainer) { return; }
    // Re-sync from global topbar state
    if (SL.screenPlay && SL.screenPlay.getRootPc) {
      _chordPadKey = SL.screenPlay.getRootPc();
    }
    if (SL.screenPlay && SL.screenPlay.getModeKey) {
      var gModeKey = SL.screenPlay.getModeKey();
      var gModeData = (SL.MODES && SL.MODES[gModeKey]) ? SL.MODES[gModeKey] : null;
      if (gModeData && gModeData.name) {
        _chordPadModeName = gModeData.name;
      }
    }
    var keyLabel = document.getElementById('chordPadKeyLabel');
    if (keyLabel) { keyLabel.textContent = NOTES[_chordPadKey] + ' ' + _chordPadModeName; }
    var containerW = _chordContainer.clientWidth || DEFAULT_CONTAINER_WIDTH;
    var containerH = _chordContainer.clientHeight || DEFAULT_CONTAINER_HEIGHT;
    _buildChordPadPadGrid(containerW, containerH, _chordOpts.noteOn, _chordOpts.noteOff, _chordOpts.baseOctave);
  }

  function _buildChordPadController(container, opts) {
    _chordOpts = opts;
    _chordContainer = container;

    var baseOctave = opts.baseOctave;
    var noteOn = opts.noteOn;
    var noteOff = opts.noteOff;

    // Sync root and mode from global topbar state
    if (SL.screenPlay && SL.screenPlay.getRootPc) {
      _chordPadKey = SL.screenPlay.getRootPc();
    }
    if (SL.screenPlay && SL.screenPlay.getModeKey) {
      var gModeKey = SL.screenPlay.getModeKey();
      var gModeData = (SL.MODES && SL.MODES[gModeKey]) ? SL.MODES[gModeKey] : null;
      if (gModeData && gModeData.name) {
        _chordPadModeName = gModeData.name;
      }
    }

    var containerW = container.clientWidth || DEFAULT_CONTAINER_WIDTH;
    var containerH = container.clientHeight || DEFAULT_CONTAINER_HEIGHT;

    var wrapper = document.createElement('div');
    wrapper.className = 'ctrl-chordpad-wrapper ssli-chordpad-wrapper';
    wrapper.style.width = '100%';
    wrapper.style.height = '100%';

    var CHORDPAD_TOPBAR_HEIGHT = 20;
    var topBar = document.createElement('div');
    topBar.className = 'ctrl-chordpad-topbar ssli-chordpad-topbar';
    topBar.style.height = CHORDPAD_TOPBAR_HEIGHT + 'px';

    var keyGroup = document.createElement('div');
    keyGroup.className = 'ssli-chordpad-key-group';

    /* Note count dropdown */
    var noteCountSelect = document.createElement('select');
    noteCountSelect.className = 'ssli-chordpad-select';
    noteCountSelect.setAttribute('aria-label', SL.t('ctrl.notesPerChord'));
    noteCountSelect.title = SL.t('chordpads.notes_per_chord_title');
    for (var nci = 0; nci < CHORD_NOTE_COUNTS.length; nci++) {
      var ncOpt = document.createElement('option');
      ncOpt.value = String(CHORD_NOTE_COUNTS[nci]);
      ncOpt.textContent = CHORD_NOTE_COUNTS[nci] + SL.t('chordpads.notes_suffix');
      if (CHORD_NOTE_COUNTS[nci] === _chordPadNoteCount) { ncOpt.selected = true; }
      noteCountSelect.appendChild(ncOpt);
    }
    noteCountSelect.addEventListener('change', function() {
      _chordPadNoteCount = parseInt(noteCountSelect.value, 10);
      _rebuildChordPads();
    });
    keyGroup.appendChild(noteCountSelect);

    var keyLabel = document.createElement('span');
    keyLabel.className = 'ssli-chordpad-key-label';
    keyLabel.id = 'chordPadKeyLabel';
    keyLabel.textContent = NOTES[_chordPadKey] + ' ' + _chordPadModeName;
    keyLabel.style.display = 'none';
    keyGroup.appendChild(keyLabel);

    topBar.appendChild(keyGroup);

    var strumSelect = document.createElement('select');
    strumSelect.className = 'ssli-chordpad-select';
    strumSelect.id = 'chordPadStrumToggle';
    strumSelect.setAttribute('aria-label', SL.t('ctrl.strumPattern'));
    for (var smi = 0; smi < CHORD_PLAY_MODE_COUNT; smi++) {
      var smOpt = document.createElement('option');
      smOpt.value = String(smi);
      smOpt.textContent = CHORD_PLAY_MODES[smi];
      if (smi === _chordPlayModeIdx) { smOpt.selected = true; }
      strumSelect.appendChild(smOpt);
    }
    strumSelect.addEventListener('change', function() {
      _chordPlayModeIdx = parseInt(strumSelect.value, 10);
    });
    topBar.appendChild(strumSelect);

    /* Rhythm pattern dropdown */
    var rhythmSelect = document.createElement('select');
    rhythmSelect.className = 'ssli-chordpad-select';
    rhythmSelect.setAttribute('aria-label', SL.t('ctrl.rhythmPattern'));
    rhythmSelect.title = SL.t('chordpads.rhythm_pattern_title');
    for (var rhi = 0; rhi < RHYTHM_PATTERN_NAMES.length; rhi++) {
      var rhOpt = document.createElement('option');
      rhOpt.value = RHYTHM_PATTERN_NAMES[rhi];
      rhOpt.textContent = RHYTHM_PATTERNS[RHYTHM_PATTERN_NAMES[rhi]].label;
      if (RHYTHM_PATTERN_NAMES[rhi] === _currentRhythmName) { rhOpt.selected = true; }
      rhythmSelect.appendChild(rhOpt);
    }
    rhythmSelect.addEventListener('change', function() {
      _currentRhythmName = rhythmSelect.value;
    });
    topBar.appendChild(rhythmSelect);

    var strumSpeedLabel = document.createElement('span');
    strumSpeedLabel.className = 'ssli-chordpad-speed-label';
    strumSpeedLabel.textContent = _strumDelayMs + 'ms';
    var strumSpeedSlider = document.createElement('input');
    strumSpeedSlider.type = 'range';
    strumSpeedSlider.className = 'ssli-chordpad-speed-slider';
    strumSpeedSlider.min = String(STRUM_DELAY_MIN_MS);
    strumSpeedSlider.max = String(STRUM_DELAY_MAX_MS);
    strumSpeedSlider.value = String(_strumDelayMs);
    strumSpeedSlider.setAttribute('aria-label', SL.t('ctrl.strumSpeed'));
    strumSpeedSlider.addEventListener('input', function() {
      _strumDelayMs = parseInt(strumSpeedSlider.value, 10);
      strumSpeedLabel.textContent = _strumDelayMs + 'ms';
      if (SL.sliderOverlay) { SL.sliderOverlay.show(_strumDelayMs + 'ms'); }
    });
    strumSpeedSlider.addEventListener('pointerup', function() {
      if (SL.sliderOverlay) { SL.sliderOverlay.hide(); }
    });
    strumSpeedSlider.addEventListener('touchend', function() {
      if (SL.sliderOverlay) { SL.sliderOverlay.hide(); }
    });
    topBar.appendChild(strumSpeedSlider);
    topBar.appendChild(strumSpeedLabel);

    var restrumToggle = document.createElement('button');
    restrumToggle.className = 'ssli-chordpad-strum-toggle';
    restrumToggle.textContent = _isRestrumEnabled ? SL.t('chordpads.repeat') : SL.t('chordpads.once');
    restrumToggle.style.borderColor = _isRestrumEnabled ? 'var(--ssli-text-chord-key)' : 'var(--ssli-border-light)';
    restrumToggle.addEventListener('click', function() {
      _isRestrumEnabled = !_isRestrumEnabled;
      restrumToggle.textContent = _isRestrumEnabled ? SL.t('chordpads.repeat') : SL.t('chordpads.once');
      restrumToggle.style.borderColor = _isRestrumEnabled ? 'var(--ssli-text-chord-key)' : 'var(--ssli-border-light)';
    });
    topBar.appendChild(restrumToggle);

    var restrumLabel = document.createElement('span');
    restrumLabel.className = 'ssli-chordpad-speed-label';
    restrumLabel.textContent = _restrumMs + 'ms';
    var restrumSlider = document.createElement('input');
    restrumSlider.type = 'range';
    restrumSlider.className = 'ssli-chordpad-speed-slider';
    restrumSlider.min = String(RESTRUM_MIN_MS);
    restrumSlider.max = String(RESTRUM_MAX_MS);
    restrumSlider.value = String(_restrumMs);
    restrumSlider.setAttribute('aria-label', SL.t('ctrl.restrumInterval'));
    restrumSlider.addEventListener('input', function() {
      _restrumMs = parseInt(restrumSlider.value, 10);
      restrumLabel.textContent = _restrumMs + 'ms';
      if (SL.sliderOverlay) { SL.sliderOverlay.show(_restrumMs + 'ms'); }
    });
    restrumSlider.addEventListener('pointerup', function() {
      if (SL.sliderOverlay) { SL.sliderOverlay.hide(); }
    });
    restrumSlider.addEventListener('touchend', function() {
      if (SL.sliderOverlay) { SL.sliderOverlay.hide(); }
    });
    topBar.appendChild(restrumSlider);
    topBar.appendChild(restrumLabel);
    wrapper.appendChild(topBar);

    var padGrid = document.createElement('div');
    padGrid.className = 'ctrl-chordpad-grid ssli-chordpad-grid';
    padGrid.id = 'chordPadGrid';
    wrapper.appendChild(padGrid);
    container.appendChild(wrapper);

    _buildChordPadPadGrid(containerW, containerH, noteOn, noteOff, baseOctave);
  }

  // ============================================================
  // XY Pad Controller (Kaoss style)
  // ============================================================

  function _buildXYPadController(container, opts) {
    var baseOctave = opts.baseOctave;
    var numOctaves = opts.numOctaves;
    var noteOn = opts.noteOn;
    var noteOff = opts.noteOff;
    var applyPitchBend = opts.applyPitchBend;
    var resetPitchBendFn = opts.resetPitchBendFn;

    var containerW = container.clientWidth || DEFAULT_CONTAINER_WIDTH;
    var containerH = container.clientHeight || DEFAULT_CONTAINER_HEIGHT;
    var _isXyActive = false;
    var _xyCurrentMidi = -1;

    var wrapper = document.createElement('div');
    wrapper.className = 'ctrl-xypad-wrapper ssli-xypad-wrapper';
    wrapper.style.width = containerW + 'px';
    wrapper.style.height = containerH + 'px';

    var baseMidi = (baseOctave + 1) * 12;
    var xyNotes = [];
    for (var oct = 0; oct < numOctaves; oct++) {
      for (var si = 0; si < MAJOR_SCALE_INTERVALS.length; si++) {
        var m = baseMidi + oct * 12 + MAJOR_SCALE_INTERVALS[si];
        if (m <= MIDI_MAX) { xyNotes.push(m); }
      }
    }

    var noteCount = xyNotes.length;
    for (var gi = 0; gi < noteCount; gi++) {
      var xFrac = gi / noteCount;
      var gridLine = document.createElement('div');
      gridLine.className = 'ctrl-xy-gridline-v ssli-xypad-gridline-v';
      gridLine.style.left = Math.floor(xFrac * containerW) + 'px';
      gridLine.style.height = containerH + 'px';
      wrapper.appendChild(gridLine);
    }

    for (var yi = 0; yi <= 4; yi++) {
      var yFrac = yi / 4;
      var hLine = document.createElement('div');
      hLine.className = 'ctrl-xy-gridline-h ssli-xypad-gridline-h';
      hLine.style.top = Math.floor(yFrac * containerH) + 'px';
      hLine.style.width = containerW + 'px';
      wrapper.appendChild(hLine);
    }

    var crossV = document.createElement('div');
    crossV.className = 'ctrl-xy-cross-v ssli-xypad-cross-v';
    crossV.id = 'xyCrossV';
    crossV.style.height = containerH + 'px';
    wrapper.appendChild(crossV);

    var crossH = document.createElement('div');
    crossH.className = 'ctrl-xy-cross-h ssli-xypad-cross-h';
    crossH.id = 'xyCrossH';
    crossH.style.width = containerW + 'px';
    wrapper.appendChild(crossH);

    var readout = document.createElement('div');
    readout.className = 'ctrl-xy-readout';
    readout.id = 'xyReadout';
    readout.textContent = SL.t('ctrl.xyReadoutEmpty');
    wrapper.appendChild(readout);

    /* U-03: XY Pad idle state hint, center dot, and axis labels */
    var xyIdleHint = document.createElement('div');
    xyIdleHint.className = 'ctrl-xypad-idle-hint';
    xyIdleHint.id = 'xyIdleHint';
    xyIdleHint.textContent = SL.t('xypad.idle_hint');
    wrapper.appendChild(xyIdleHint);

    var xyCenterDot = document.createElement('div');
    xyCenterDot.className = 'ctrl-xypad-center-dot';
    xyCenterDot.id = 'xyCenterDot';
    wrapper.appendChild(xyCenterDot);

    var xyAxisX = document.createElement('div');
    xyAxisX.className = 'ctrl-xypad-axis-label ctrl-xypad-axis-label-x';
    xyAxisX.textContent = SL.t('xypad.axis_x');
    wrapper.appendChild(xyAxisX);

    var xyAxisY = document.createElement('div');
    xyAxisY.className = 'ctrl-xypad-axis-label ctrl-xypad-axis-label-y';
    xyAxisY.textContent = SL.t('xypad.axis_y');
    wrapper.appendChild(xyAxisY);

    /* Issue 15: Snap (discrete) vs Continuous toggle */
    var xySnapToggle = document.createElement('button');
    xySnapToggle.className = 'rhy-scr-btn ssli-ctrl-snap-toggle';
    xySnapToggle.textContent = _isXypadContinuousMode ? SL.t('vowelpad.smooth') : SL.t('vowelpad.snap');
    xySnapToggle.title = SL.t('chordpads.snap_toggle_title');
    if (_isXypadContinuousMode) { xySnapToggle.classList.add('active'); }
    function _toggleSnap() {
      _isXypadContinuousMode = !_isXypadContinuousMode;
      xySnapToggle.textContent = _isXypadContinuousMode ? SL.t('vowelpad.smooth') : SL.t('vowelpad.snap');
      if (_isXypadContinuousMode) { xySnapToggle.classList.add('active'); }
      else { xySnapToggle.classList.remove('active'); }
    }
    xySnapToggle.addEventListener('click', _toggleSnap);
    xySnapToggle.addEventListener('touchstart', function(e) {
      e.stopPropagation();
    });
    xySnapToggle.addEventListener('touchend', function(e) {
      e.stopPropagation();
      e.preventDefault();
      _toggleSnap();
    });
    wrapper.appendChild(xySnapToggle);

    (function(wrapEl, notes, cW, cH) {
      /* Multitouch state: map of touch identifier -> { midi, startMidi } */
      var _xyTouches = {};
      var _xyTouchCount = 0;

      /* Mouse-only state (single pointer fallback for desktop) */
      var _xyMouseStartMidi = -1;

      function xyToNote(x, y, startMidi) {
        var rect = wrapEl.getBoundingClientRect();
        var relX = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
        var relY = Math.max(0, Math.min(1, (y - rect.top) / rect.height));
        var modVal = Math.round((1 - relY) * MIDI_MAX);

        if (_isXypadContinuousMode) {
          var midiFloat = notes[0] + relX * (notes[notes.length - 1] - notes[0]);
          var baseMidiC = ((startMidi >= 0) ? startMidi : Math.round(midiFloat));
          if (baseMidiC > MIDI_MAX) { baseMidiC = MIDI_MAX; }
          var bendCentsC = (midiFloat - baseMidiC) * 100;
          return { midi: baseMidiC, mod: modVal, relX: relX, relY: relY, bendCents: bendCentsC, continuous: true };
        }

        /* Snap mode -- quantize to nearest scale note, no pitch bend */
        var floatIdx = relX * notes.length;
        var noteIdx = Math.round(floatIdx);
        if (noteIdx >= notes.length) { noteIdx = notes.length - 1; }
        if (noteIdx < 0) { noteIdx = 0; }
        return { midi: notes[noteIdx], mod: modVal, relX: relX, relY: relY, bendCents: 0 };
      }

      function updateCrosshair(relX, relY) {
        var cv = document.getElementById('xyCrossV');
        var ch = document.getElementById('xyCrossH');
        if (cv) { cv.style.left = Math.floor(relX * cW) + 'px'; cv.style.display = 'block'; }
        if (ch) { ch.style.top = Math.floor(relY * cH) + 'px'; ch.style.display = 'block'; }
      }

      function hideCrosshair() {
        var cv = document.getElementById('xyCrossV');
        var ch = document.getElementById('xyCrossH');
        if (cv) { cv.style.display = 'none'; }
        if (ch) { ch.style.display = 'none'; }
      }

      function hideIdleHint() {
        var hint = document.getElementById('xyIdleHint');
        if (hint) { hint.style.display = 'none'; }
        var dot = document.getElementById('xyCenterDot');
        if (dot) { dot.style.display = 'none'; }
      }

      function showIdleHint() {
        var hint = document.getElementById('xyIdleHint');
        if (hint) { hint.style.display = ''; }
        var dot = document.getElementById('xyCenterDot');
        if (dot) { dot.style.display = ''; }
      }

      function updateReadout(info) {
        var rd = document.getElementById('xyReadout');
        if (rd) { rd.textContent = _midiToName(info.midi) + ' / Mod:' + info.mod; }
      }

      function clearReadout() {
        var rd = document.getElementById('xyReadout');
        if (rd) { rd.textContent = SL.t('ctrl.xyReadoutEmpty'); }
      }

      /* ---- Mouse fallback (single pointer for desktop) ---- */

      function onMouseStart(x, y) {
        _isXyActive = true;
        _xyMouseStartMidi = -1;
        hideIdleHint();
        var info = xyToNote(x, y, -1);
        _xyCurrentMidi = info.midi;
        _xyMouseStartMidi = info.midi;
        noteOn(info.midi);
        applyPitchBend(info.bendCents);
        updateCrosshair(info.relX, info.relY);
        updateReadout(info);
      }

      function onMouseMove(x, y) {
        if (!_isXyActive) { return; }
        var info = xyToNote(x, y, _xyMouseStartMidi);
        if (info.continuous) {
          applyPitchBend(info.bendCents);
        } else {
          if (info.midi !== _xyCurrentMidi) {
            noteOff(_xyCurrentMidi);
            _xyCurrentMidi = info.midi;
            noteOn(info.midi);
          }
          applyPitchBend(info.bendCents);
        }
        updateCrosshair(info.relX, info.relY);
        updateReadout(info);
      }

      function onMouseEnd() {
        if (_isXyActive) {
          resetPitchBendFn();
          noteOff(_xyCurrentMidi);
          _isXyActive = false;
          _xyCurrentMidi = -1;
          _xyMouseStartMidi = -1;
          hideCrosshair();
          clearReadout();
          showIdleHint();
        }
      }

      /* ---- Multitouch (Touch API) ---- */

      function onTouchStart(e) {
        e.preventDefault();
        var changedTouches = e.changedTouches;
        var ti;
        for (ti = 0; ti < changedTouches.length; ti++) {
          var touch = changedTouches[ti];
          var touchId = touch.identifier;
          var info = xyToNote(touch.clientX, touch.clientY, -1);
          _xyTouches[touchId] = { midi: info.midi, startMidi: info.midi };
          _xyTouchCount = _xyTouchCount + 1;
          noteOn(info.midi);
          /* Update crosshair to most recent touch */
          updateCrosshair(info.relX, info.relY);
          updateReadout(info);
        }
        hideIdleHint();
      }

      function onTouchMove(e) {
        e.preventDefault();
        var changedTouches = e.changedTouches;
        var ti;
        for (ti = 0; ti < changedTouches.length; ti++) {
          var touch = changedTouches[ti];
          var touchId = touch.identifier;
          var touchState = _xyTouches[touchId];
          if (!touchState) { continue; }
          var info = xyToNote(touch.clientX, touch.clientY, touchState.startMidi);
          if (info.continuous) {
            /* In continuous mode, pitch bend affects all voices globally -- last touch wins */
            applyPitchBend(info.bendCents);
          } else {
            if (info.midi !== touchState.midi) {
              noteOff(touchState.midi);
              touchState.midi = info.midi;
              noteOn(info.midi);
            }
          }
          updateCrosshair(info.relX, info.relY);
          updateReadout(info);
        }
      }

      function onTouchEnd(e) {
        e.preventDefault();
        var changedTouches = e.changedTouches;
        var ti;
        for (ti = 0; ti < changedTouches.length; ti++) {
          var touch = changedTouches[ti];
          var touchId = touch.identifier;
          var touchState = _xyTouches[touchId];
          if (touchState) {
            noteOff(touchState.midi);
            delete _xyTouches[touchId];
            _xyTouchCount = Math.max(0, _xyTouchCount - 1);
          }
        }
        if (_xyTouchCount === 0) {
          resetPitchBendFn();
          hideCrosshair();
          clearReadout();
          showIdleHint();
        }
      }

      wrapEl.addEventListener('mousedown', function(e) { e.preventDefault(); onMouseStart(e.clientX, e.clientY); });
      wrapEl.addEventListener('mousemove', function(e) { onMouseMove(e.clientX, e.clientY); });
      wrapEl.addEventListener('mouseup', function() { onMouseEnd(); });
      wrapEl.addEventListener('mouseleave', function() { onMouseEnd(); });
      wrapEl.addEventListener('touchstart', onTouchStart);
      wrapEl.addEventListener('touchmove', onTouchMove);
      wrapEl.addEventListener('touchend', onTouchEnd);
      wrapEl.addEventListener('touchcancel', onTouchEnd);

      // Store release handler for external teardown
      SL.controllers.xypad._releaseState = {
        releaseAll: function() {
          onMouseEnd();
          // Release all multitouch notes
          var tIds = Object.keys(_xyTouches);
          var ti;
          for (ti = 0; ti < tIds.length; ti++) {
            var touchState = _xyTouches[tIds[ti]];
            if (touchState) {
              noteOff(touchState.midi);
            }
          }
          _xyTouches = {};
          _xyTouchCount = 0;
          resetPitchBendFn();
          hideCrosshair();
          clearReadout();
          showIdleHint();
        }
      };
    })(wrapper, xyNotes, containerW, containerH);

    container.appendChild(wrapper);
  }

  // ============================================================
  // Marimba Controller
  // ============================================================

  function _buildMarimbaController(container, opts) {
    var baseOctave = opts.baseOctave;
    var noteOn = opts.noteOn;
    var noteOff = opts.noteOff;

    var containerW = container.clientWidth || DEFAULT_CONTAINER_WIDTH;
    var containerH = container.clientHeight || DEFAULT_CONTAINER_HEIGHT;

    var wrapper = document.createElement('div');
    wrapper.className = 'ctrl-marimba-wrapper ssli-marimba-wrapper';
    wrapper.style.width = containerW + 'px';
    wrapper.style.height = containerH + 'px';

    var baseMidi = (baseOctave + 1) * 12;
    var naturalNotes = [];
    var accidentalNotes = [];

    for (var oct = 0; oct < MARIMBA_OCTAVES; oct++) {
      for (var ni = 0; ni < NATURALS.length; ni++) {
        var m = baseMidi + oct * 12 + NATURALS[ni];
        if (m <= MIDI_MAX) { naturalNotes.push(m); }
      }
      for (var ai = 0; ai < ACCIDENTALS.length; ai++) {
        var am = baseMidi + oct * 12 + ACCIDENTALS[ai];
        if (am <= MIDI_MAX) { accidentalNotes.push(am); }
      }
    }

    var topRowH = Math.floor(containerH * MARIMBA_TOP_ROW_RATIO);
    var botRowH = containerH - topRowH - 4;

    var topRow = document.createElement('div');
    topRow.className = 'ctrl-marimba-row ctrl-marimba-row-top ssli-marimba-row';
    topRow.style.height = topRowH + 'px';

    var accBarW = Math.floor((containerW - 16) / Math.max(accidentalNotes.length, 1)) - 3;

    for (var aci = 0; aci < accidentalNotes.length; aci++) {
      var acMidi = accidentalNotes[aci];
      var acBar = document.createElement('div');
      acBar.className = 'ctrl-marimba-bar ctrl-marimba-accidental ssli-marimba-acc-bar';
      acBar.setAttribute('data-midi', acMidi);
      acBar.style.width = accBarW + 'px';
      acBar.style.background = WOOD_DARK[aci % WOOD_DARK.length];
      var acLbl = document.createElement('span');
      acLbl.className = 'ctrl-marimba-label';
      acLbl.textContent = NOTES[acMidi % 12];
      acBar.appendChild(acLbl);
      topRow.appendChild(acBar);
    }

    var botRow = document.createElement('div');
    botRow.className = 'ctrl-marimba-row ctrl-marimba-row-bottom ssli-marimba-row';
    botRow.style.height = botRowH + 'px';

    var natBarW = Math.floor((containerW - 16) / Math.max(naturalNotes.length, 1)) - 3;

    for (var nti = 0; nti < naturalNotes.length; nti++) {
      var ntMidi = naturalNotes[nti];
      var ntBar = document.createElement('div');
      ntBar.className = 'ctrl-marimba-bar ctrl-marimba-natural ssli-marimba-nat-bar';
      ntBar.setAttribute('data-midi', ntMidi);
      ntBar.style.width = natBarW + 'px';
      ntBar.style.background = WOOD_LIGHT[nti % WOOD_LIGHT.length];
      var ntLbl = document.createElement('span');
      ntLbl.className = 'ctrl-marimba-label';
      ntLbl.textContent = NOTES[ntMidi % 12] + (Math.floor(ntMidi / 12) - 1);
      ntBar.appendChild(ntLbl);
      botRow.appendChild(ntBar);
    }

    wrapper.appendChild(topRow);
    wrapper.appendChild(botRow);

    // Pointer-drag support: follow finger across bars for continuous play
    var _isMarimbaDragActive = false;
    var _marimbaDragLastMidi = -1;
    var _marimbaDragLastEl = null;
    var MARIMBA_ACTIVE_CLASS = 'ctrl-marimba-active';
    var MARIMBA_DEFAULT_VELOCITY = 100;

    function _marimbaBarAtPoint(clientX, clientY) {
      var el = document.elementFromPoint(clientX, clientY);
      var result = null;
      if (el) {
        var barEl = el.closest('.ctrl-marimba-bar');
        if (barEl) {
          var midiAttr = barEl.getAttribute('data-midi');
          var hasMidi = (midiAttr !== NO_ATTR);
          if (hasMidi) {
            result = { el: barEl, midi: parseInt(midiAttr, 10) };
          }
        }
      }
      return result;
    }

    wrapper.addEventListener('pointerdown', function(ev) {
      ev.preventDefault();
      _isMarimbaDragActive = true;
      var hit = _marimbaBarAtPoint(ev.clientX, ev.clientY);
      var hasHit = (hit !== NO_HIT);
      if (hasHit) {
        _marimbaDragLastMidi = hit.midi;
        _marimbaDragLastEl = hit.el;
        var downVel = SL.velocityFromPressure(ev, MARIMBA_DEFAULT_VELOCITY);
        noteOn(hit.midi, downVel);
        hit.el.classList.add(MARIMBA_ACTIVE_CLASS);
      }
    });

    wrapper.addEventListener('pointermove', function(ev) {
      if (!_isMarimbaDragActive) { return; }
      var hit = _marimbaBarAtPoint(ev.clientX, ev.clientY);
      var hasHit = (hit !== NO_HIT);
      if (hasHit) {
        var isDifferent = (hit.midi !== _marimbaDragLastMidi);
        if (isDifferent) {
          // Release previous
          if (_marimbaDragLastMidi >= 0 && _marimbaDragLastEl) {
            noteOff(_marimbaDragLastMidi);
            _marimbaDragLastEl.classList.remove(MARIMBA_ACTIVE_CLASS);
          }
          // Play new
          _marimbaDragLastMidi = hit.midi;
          _marimbaDragLastEl = hit.el;
          var moveVel = SL.velocityFromPressure(ev, MARIMBA_DEFAULT_VELOCITY);
          noteOn(hit.midi, moveVel);
          hit.el.classList.add(MARIMBA_ACTIVE_CLASS);
        }
      }
    });

    function _marimbaPointerUp() {
      if (_isMarimbaDragActive) {
        _isMarimbaDragActive = false;
        if (_marimbaDragLastMidi >= 0 && _marimbaDragLastEl) {
          noteOff(_marimbaDragLastMidi);
          _marimbaDragLastEl.classList.remove(MARIMBA_ACTIVE_CLASS);
        }
        _marimbaDragLastMidi = -1;
        _marimbaDragLastEl = null;
      }
    }

    wrapper.addEventListener('pointerup', _marimbaPointerUp);
    wrapper.addEventListener('pointercancel', _marimbaPointerUp);
    document.addEventListener('pointerup', _marimbaPointerUp);

    // Store release handler for external teardown
    SL.controllers.marimba._releaseState = {
      releaseAll: function() {
        _marimbaPointerUp();
      }
    };

    container.appendChild(wrapper);
  }

  // ============================================================
  // Harp Controller
  // ============================================================

  function _buildHarpController(container, opts) {
    var baseOctave = opts.baseOctave;
    var rawNoteOn = opts.noteOn;
    var noteOn = function(midi, domEvent) {
      var vel = domEvent ? SL.velocityFromPressure(domEvent, HARP_VELOCITY_BOOST) : HARP_VELOCITY_BOOST;
      rawNoteOn(midi, vel);
    };
    var noteOff = opts.noteOff;

    var containerW = container.clientWidth || DEFAULT_CONTAINER_WIDTH;
    var containerH = container.clientHeight || DEFAULT_CONTAINER_HEIGHT;

    /* Preset bar at top */
    var HARP_PRESET_BAR_HEIGHT = 22;
    var presetBar = document.createElement('div');
    presetBar.className = 'ssli-harp-preset-bar';
    presetBar.style.width = containerW + 'px';
    presetBar.style.height = HARP_PRESET_BAR_HEIGHT + 'px';
    presetBar.style.display = 'flex';
    presetBar.style.alignItems = 'center';
    presetBar.style.gap = '4px';
    presetBar.style.padding = '0 4px';
    presetBar.style.background = 'rgba(0,0,0,0.4)';
    presetBar.style.borderBottom = '1px solid rgba(255,255,255,0.1)';
    presetBar.style.boxSizing = 'border-box';

    var presetLabel = document.createElement('span');
    presetLabel.style.fontSize = '0.55rem';
    presetLabel.style.color = 'rgba(200,200,220,0.6)';
    presetLabel.textContent = SL.t('chordpads.preset_label');
    presetBar.appendChild(presetLabel);

    var harpPresetSelect = document.createElement('select');
    harpPresetSelect.className = 'ssli-chordpad-select';
    harpPresetSelect.title = SL.t('fretboard.preset_title');
    var harpPluckedPresets = [];
    if (SL.presets && SL.presets.getPresetsForEngineCategory) {
      harpPluckedPresets = SL.presets.getPresetsForEngineCategory('Physical', 'Plucked');
    }
    var hpi;
    for (hpi = 0; hpi < harpPluckedPresets.length; hpi++) {
      var hpOpt = document.createElement('option');
      hpOpt.value = harpPluckedPresets[hpi].name;
      hpOpt.textContent = harpPluckedPresets[hpi].name;
      if (harpPluckedPresets[hpi].name === 'Concert Harp') { hpOpt.selected = true; }
      harpPresetSelect.appendChild(hpOpt);
    }
    harpPresetSelect.addEventListener('change', function() {
      if (SL.presets && SL.presets.apply) {
        var selName = harpPresetSelect.value;
        for (var hpsi = 0; hpsi < harpPluckedPresets.length; hpsi++) {
          if (harpPluckedPresets[hpsi].name === selName) {
            harpPluckedPresets[hpsi].engine = 'physical';
            SL.presets.apply(harpPluckedPresets[hpsi]);
            if (SL.state && SL.state.notify) { SL.state.notify('preset'); }
            break;
          }
        }
      }
    });
    presetBar.appendChild(harpPresetSelect);
    container.appendChild(presetBar);

    var harpAreaH = containerH - HARP_PRESET_BAR_HEIGHT;

    var wrapper = document.createElement('div');
    wrapper.className = 'ctrl-harp-wrapper ssli-harp-wrapper';
    wrapper.style.width = containerW + 'px';
    wrapper.style.height = harpAreaH + 'px';

    var baseMidi = (baseOctave + 1) * 12;
    var harpNotes = [];
    for (var oct = 0; oct < 2; oct++) {
      for (var si = 0; si < MAJOR_SCALE_INTERVALS.length; si++) {
        var m = baseMidi + oct * 12 + MAJOR_SCALE_INTERVALS[si];
        if (m <= MIDI_MAX) { harpNotes.push(m); }
      }
    }

    var stringCount = harpNotes.length;
    var stringGap = containerW / (stringCount + 1);
    var HARP_COLORS = { 0: HARP_C_COLOR, 5: HARP_F_COLOR };
    var HARP_PC_COLORS = {};
    HARP_PC_COLORS[0] = HARP_C_COLOR;
    HARP_PC_COLORS[5] = HARP_F_COLOR;
    var diatonicKeys = Object.keys(HARP_DIATONIC_COLORS);
    var dki;
    for (dki = 0; dki < diatonicKeys.length; dki++) {
      HARP_PC_COLORS[diatonicKeys[dki]] = HARP_DIATONIC_COLORS[diatonicKeys[dki]];
    }

    var frameSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    frameSvg.setAttribute('class', 'ctrl-harp-frame');
    frameSvg.setAttribute('width', containerW);
    frameSvg.setAttribute('height', harpAreaH);
    frameSvg.setAttribute('class', frameSvg.getAttribute('class') + ' ssli-harp-frame-svg');
    var curvePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    var curveD = 'M' + (stringGap * 0.5) + ',10 Q' + (containerW * 0.5) + ',' + (harpAreaH * -0.15) + ' ' + (containerW - stringGap * 0.5) + ',10';
    curvePath.setAttribute('d', curveD);
    curvePath.setAttribute('fill', 'none');
    curvePath.setAttribute('stroke', '#8a7a5a');
    curvePath.setAttribute('stroke-width', '3');
    curvePath.setAttribute('opacity', '0.4');
    frameSvg.appendChild(curvePath);

    /* Horizontal fret guide lines — dim, dashed, clearly decorative.
       These provide visual depth reference without competing with the
       bright interactive strings. */
    var HARP_FRET_COUNT = 5;
    var HARP_FRET_INSET = 0.12;
    var HARP_FRET_OPACITY = 0.18;
    var HARP_FRET_COLOR = '#8a7a5a';
    var HARP_FRET_DASH = '6,8';
    var HARP_FRET_STROKE_WIDTH = 1;
    for (var fi = 0; fi < HARP_FRET_COUNT; fi++) {
      var fretFrac = HARP_FRET_INSET + (fi / (HARP_FRET_COUNT - 1)) * (1.0 - 2 * HARP_FRET_INSET);
      var fretY = Math.floor(harpAreaH * fretFrac);
      var fretLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      fretLine.setAttribute('x1', '0');
      fretLine.setAttribute('y1', fretY);
      fretLine.setAttribute('x2', containerW);
      fretLine.setAttribute('y2', fretY);
      fretLine.setAttribute('stroke', HARP_FRET_COLOR);
      fretLine.setAttribute('stroke-width', HARP_FRET_STROKE_WIDTH);
      fretLine.setAttribute('stroke-dasharray', HARP_FRET_DASH);
      fretLine.setAttribute('opacity', HARP_FRET_OPACITY);
      frameSvg.appendChild(fretLine);
    }

    wrapper.appendChild(frameSvg);

    /* Issue 13+14: Each string gets a full-width zone so the entire area is playable.
       Zone width = stringGap (no gaps). Labels at top with note name + octave for C. */
    var _harpStringEls = [];
    for (var hi = 0; hi < stringCount; hi++) {
      var hMidi = harpNotes[hi];
      var pc = hMidi % 12;
      var xPos = stringGap * (hi + 1);
      var isAccidental = (pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10);
      var stringColor;
      if (isAccidental) {
        stringColor = HARP_ACCIDENTAL_COLOR;
      } else if (HARP_PC_COLORS[pc]) {
        stringColor = HARP_PC_COLORS[pc];
      } else {
        stringColor = DEFAULT_STRING_COLOR;
      }
      var isRoot = (pc === 0);

      var heightFrac = 1.0 - (hi / stringCount) * 0.35;
      var stringH = Math.floor(harpAreaH * heightFrac) - 20;
      var stringTop = harpAreaH - stringH - 10;

      /* Zone covers from midpoint before this string to midpoint after */
      var zoneLeft = Math.floor(stringGap * hi + stringGap * 0.5);
      var zoneRight = Math.floor(stringGap * (hi + 1) + stringGap * 0.5);
      if (hi === 0) { zoneLeft = 0; }
      if (hi === stringCount - 1) { zoneRight = containerW; }
      var zoneWidth = zoneRight - zoneLeft;

      var stringEl = document.createElement('div');
      stringEl.className = 'ctrl-harp-string ssli-harp-string-el';
      stringEl.setAttribute('data-midi', hMidi);
      stringEl.style.left = zoneLeft + 'px';
      stringEl.style.top = '0';
      stringEl.style.width = zoneWidth + 'px';
      stringEl.style.height = harpAreaH + 'px';

      var stringLine = document.createElement('div');
      stringLine.className = 'ctrl-harp-string-line ssli-harp-string-line-inner';
      stringLine.style.background = stringColor;
      stringLine.style.left = Math.floor(xPos - zoneLeft - 1) + 'px';
      stringLine.style.top = stringTop + 'px';
      stringLine.style.height = stringH + 'px';
      /* All strings get a soft glow to clearly mark them as interactive.
         Root strings get a wider line + stronger glow. */
      if (isRoot) {
        stringLine.style.width = '3px';
        stringLine.style.boxShadow = '0 0 6px ' + stringColor + ', 0 0 2px ' + stringColor;
      } else {
        stringLine.style.boxShadow = '0 0 3px ' + stringColor;
      }
      stringEl.appendChild(stringLine);

      /* Issue 14: Note name label at top of each string */
      var sLbl = document.createElement('div');
      sLbl.className = 'ctrl-harp-label ssli-harp-string-label ssli-harp-top-label';
      var labelText = NOTES[pc];
      if (pc === 0) { labelText = labelText + (Math.floor(hMidi / 12) - 1); }
      sLbl.textContent = labelText;
      if (pc === 0) { sLbl.classList.add('ssli-harp-label-c'); }
      if (pc === 5) { sLbl.classList.add('ssli-harp-label-f'); }
      stringEl.appendChild(sLbl);

      _wireSimpleEvents(hMidi, stringEl, noteOn, noteOff, 'ctrl-harp-active');
      _harpStringEls.push(stringEl);
      wrapper.appendChild(stringEl);
    }

    // Store release handler for external teardown
    SL.controllers.harp._releaseState = {
      releaseAll: function() {
        var hi;
        for (hi = 0; hi < harpNotes.length; hi++) {
          try { noteOff(harpNotes[hi]); } catch (e) { /* note may already be off */ }
        }
        // Remove active classes
        for (hi = 0; hi < _harpStringEls.length; hi++) {
          _harpStringEls[hi].classList.remove('ctrl-harp-active');
        }
      }
    };

    container.appendChild(wrapper);
  }

  // ============================================================
  // Air Synth Controller (Tilt/Gyroscope)
  // On mobile: DeviceOrientation API — tilt phone to control pitch + expression
  // On desktop: touch/mouse fallback with gyroscope-ring visual
  // ============================================================

  var AIRSYNTH_VOL_MIN = 0.0;
  var AIRSYNTH_VOL_MAX = 1.0;
  var AIRSYNTH_CUTOFF_OPEN_HZ = 20000;
  var AIRSYNTH_HELD_SUSTAIN = 100;
  // Tilt range: beta (left/right) maps pitch, gamma (forward/back) maps volume
  var TILT_BETA_MIN_DEG = -45;
  var TILT_BETA_MAX_DEG = 45;
  var TILT_GAMMA_MIN_DEG = -30;
  var TILT_GAMMA_MAX_DEG = 60;
  // Smoothing factor for tilt values (0 = no smoothing, 1 = infinite smoothing)
  var TILT_SMOOTHING = 0.3;
  // Gyroscope ring visual constants
  var GYRO_RING_COUNT = 3;
  var GYRO_RING_COLORS = ['rgba(76, 201, 240, 0.5)', 'rgba(232, 160, 64, 0.4)', 'rgba(200, 216, 48, 0.3)'];

  function _buildThereminController(container, opts) {
    var baseOctave = opts.baseOctave;
    var numOctaves = opts.numOctaves;
    var noteOn = opts.noteOn;
    var noteOff = opts.noteOff;
    var applyPitchBend = opts.applyPitchBend;
    var resetPitchBendFn = opts.resetPitchBendFn;

    var containerW = container.clientWidth || DEFAULT_CONTAINER_WIDTH;
    var containerH = container.clientHeight || DEFAULT_CONTAINER_HEIGHT;
    var _isAirActive = false;
    var _airCurrentMidi = -1;
    var _airSavedSustain = null;
    var _airSavedSustainInst = -1;
    var _isTiltAvailable = false;
    var _isTiltListenerBound = false;
    var _animFrameId = null;
    var _smoothBeta = 0;
    var _smoothGamma = 30;
    var _rawBeta = 0;
    var _rawGamma = 30;

    var startMidi = (baseOctave + 1) * SEMITONES_PER_OCTAVE;
    var endMidi = (baseOctave + numOctaves + 1) * SEMITONES_PER_OCTAVE;
    var totalSemitones = endMidi - startMidi;

    var wrapper = document.createElement('div');
    wrapper.className = 'ctrl-theremin-wrapper ssli-theremin-wrapper ssli-airsynth-wrapper';
    wrapper.style.width = containerW + 'px';
    wrapper.style.height = containerH + 'px';

    // Gyroscope rings (visual feedback for tilt)
    var ringsContainer = document.createElement('div');
    ringsContainer.className = 'ssli-airsynth-rings';
    ringsContainer.id = 'airSynthRings';
    var ringEls = [];
    var ri;
    for (ri = 0; ri < GYRO_RING_COUNT; ri++) {
      var ring = document.createElement('div');
      ring.className = 'ssli-airsynth-ring';
      var ringSize = 60 + (ri * 40);
      ring.style.width = ringSize + 'px';
      ring.style.height = ringSize + 'px';
      ring.style.borderColor = GYRO_RING_COLORS[ri];
      ringsContainer.appendChild(ring);
      ringEls.push(ring);
    }
    wrapper.appendChild(ringsContainer);

    // Center orb
    var orb = document.createElement('div');
    orb.className = 'ctrl-theremin-orb ssli-theremin-orb-el ssli-airsynth-orb';
    orb.id = 'thereminOrb';
    wrapper.appendChild(orb);

    // Readout
    var readout = document.createElement('div');
    readout.className = 'ctrl-theremin-readout ssli-airsynth-readout';
    readout.id = 'thereminReadout';
    readout.textContent = '--';
    wrapper.appendChild(readout);

    // Mode label
    var modeLabel = document.createElement('div');
    modeLabel.className = 'ssli-airsynth-mode-label';
    modeLabel.id = 'airSynthModeLabel';
    modeLabel.textContent = SL.t('theremin.detecting_sensors');
    wrapper.appendChild(modeLabel);

    // Idle hint
    var airHint = document.createElement('div');
    airHint.className = 'ctrl-theremin-idle-hint ssli-airsynth-hint';
    airHint.id = 'thereminIdleHint';
    airHint.textContent = SL.t('theremin.tap_to_play');
    wrapper.appendChild(airHint);

    // Axis labels
    var axisXLabel = document.createElement('div');
    axisXLabel.className = 'ctrl-theremin-axis-label ctrl-theremin-axis-label-x';
    axisXLabel.textContent = SL.t('theremin.tilt_lr_pitch');
    wrapper.appendChild(axisXLabel);

    var axisYLabel = document.createElement('div');
    axisYLabel.className = 'ctrl-theremin-axis-label ctrl-theremin-axis-label-y';
    axisYLabel.textContent = SL.t('theremin.tilt_fb_volume');
    wrapper.appendChild(axisYLabel);

    // ---- Pitch ruler (note labels along bottom) ----
    var PITCH_RULER_HEIGHT = 40;
    var PITCH_RULER_LABEL_FONT = 12;
    var PITCH_RULER_OCTAVE_FONT = 9;
    var PITCH_RULER_OPACITY = 0.55;
    var PITCH_RULER_HIGHLIGHT_OPACITY = 0.95;
    var PITCH_RULER_BG = 'rgba(10, 10, 24, 0.7)';
    var PITCH_RULER_OCTAVE_LINE_COLOR = 'rgba(76, 201, 240, 0.7)';
    var PITCH_RULER_NOTE_COLOR = 'rgba(200, 220, 240, 0.65)';
    var PITCH_RULER_C_COLOR = '#e8c87a';
    var PITCH_RULER_HIGHLIGHT_BG = 'rgba(76, 201, 240, 0.25)';
    var PITCH_RULER_OCTAVE_LINE_WIDTH = 4;
    var PITCH_RULER_TALL_LINE_OPACITY = 0.8;
    var OCTAVE_STRIPE_EVEN_BG = 'rgba(76, 201, 240, 0.06)';
    var OCTAVE_STRIPE_ODD_BG = 'rgba(76, 201, 240, 0.12)';

    var pitchRuler = document.createElement('div');
    pitchRuler.className = 'ssli-airsynth-pitch-ruler';
    pitchRuler.style.position = 'absolute';
    pitchRuler.style.bottom = '0';
    pitchRuler.style.left = '0';
    pitchRuler.style.right = '0';
    pitchRuler.style.height = PITCH_RULER_HEIGHT + 'px';
    pitchRuler.style.background = PITCH_RULER_BG;
    pitchRuler.style.pointerEvents = 'none';
    pitchRuler.style.zIndex = '4';
    pitchRuler.style.overflow = 'hidden';
    pitchRuler.style.borderTop = '2px solid ' + PITCH_RULER_OCTAVE_LINE_COLOR;

    var _pitchRulerLabels = [];
    var _pitchRulerHighlight = document.createElement('div');
    _pitchRulerHighlight.style.position = 'absolute';
    _pitchRulerHighlight.style.top = '0';
    _pitchRulerHighlight.style.bottom = '0';
    _pitchRulerHighlight.style.width = '0';
    _pitchRulerHighlight.style.background = PITCH_RULER_HIGHLIGHT_BG;
    _pitchRulerHighlight.style.display = 'none';
    _pitchRulerHighlight.style.pointerEvents = 'none';
    _pitchRulerHighlight.style.transition = 'left 0.04s linear, width 0.04s linear';
    pitchRuler.appendChild(_pitchRulerHighlight);

    // Semitone vertical lines (fret-style) extending full height of play area
    var SEMITONE_LINE_OPACITY = 1.0;
    var SEMITONE_LINE_COLOR = 'rgba(200, 210, 230, 0.35)';
    var SEMITONE_LINE_WIDTH_PX = 1;
    var semiMidi;
    for (semiMidi = startMidi; semiMidi <= endMidi; semiMidi++) {
      var semiPc = semiMidi % SEMITONES_PER_OCTAVE;
      var semiIsC = (semiPc === 0);
      // Skip C notes — they get the thick octave line instead
      if (!semiIsC) {
        var semiFrac = (semiMidi - startMidi) / totalSemitones;
        var semiLeftPx = Math.floor(semiFrac * containerW);
        var semiLine = document.createElement('div');
        semiLine.style.position = 'absolute';
        semiLine.style.left = semiLeftPx + 'px';
        semiLine.style.top = '0';
        semiLine.style.height = containerH + 'px';
        semiLine.style.width = SEMITONE_LINE_WIDTH_PX + 'px';
        semiLine.style.background = SEMITONE_LINE_COLOR;
        semiLine.style.opacity = String(SEMITONE_LINE_OPACITY);
        semiLine.style.pointerEvents = 'none';
        semiLine.style.zIndex = '1';
        wrapper.appendChild(semiLine);
      }
    }

    var rulerFrag = document.createDocumentFragment();
    var wrapperFrag = document.createDocumentFragment();
    var rulerMidi;
    for (rulerMidi = startMidi; rulerMidi <= endMidi; rulerMidi++) {
      var rulerPc = rulerMidi % SEMITONES_PER_OCTAVE;
      var rulerIsC = (rulerPc === 0);
      var rulerFrac = (rulerMidi - startMidi) / totalSemitones;
      var rulerLeftPx = Math.floor(rulerFrac * containerW);
      var rulerNextFrac = (rulerMidi + 1 - startMidi) / totalSemitones;
      var rulerWidthPx = Math.floor(rulerNextFrac * containerW) - rulerLeftPx;

      // Octave boundary vertical line extending into play area
      if (rulerIsC) {
        var octLine = document.createElement('div');
        octLine.style.position = 'absolute';
        octLine.style.left = rulerLeftPx + 'px';
        octLine.style.top = '0';
        octLine.style.bottom = '0';
        octLine.style.width = PITCH_RULER_OCTAVE_LINE_WIDTH + 'px';
        octLine.style.background = PITCH_RULER_OCTAVE_LINE_COLOR;
        octLine.style.pointerEvents = 'none';
        rulerFrag.appendChild(octLine);

        // Solid vertical line extending full height into the play area
        var playAreaH = containerH - PITCH_RULER_HEIGHT;
        var tallLine = document.createElement('div');
        tallLine.style.position = 'absolute';
        tallLine.style.left = rulerLeftPx + 'px';
        tallLine.style.top = '0';
        tallLine.style.height = playAreaH + 'px';
        tallLine.style.width = PITCH_RULER_OCTAVE_LINE_WIDTH + 'px';
        tallLine.style.background = PITCH_RULER_OCTAVE_LINE_COLOR;
        tallLine.style.opacity = String(PITCH_RULER_TALL_LINE_OPACITY);
        tallLine.style.pointerEvents = 'none';
        wrapperFrag.appendChild(tallLine);

        // Alternating octave background stripe for visual tracking
        var octaveIdx = Math.floor(rulerMidi / SEMITONES_PER_OCTAVE);
        var isOddOctave = ((octaveIdx % 2) === 1);
        var stripeBg = isOddOctave ? OCTAVE_STRIPE_ODD_BG : OCTAVE_STRIPE_EVEN_BG;
        var nextCMidi = rulerMidi + SEMITONES_PER_OCTAVE;
        var cappedNextC = (nextCMidi > endMidi) ? endMidi : nextCMidi;
        var stripeFracEnd = (cappedNextC - startMidi) / totalSemitones;
        var stripeLeftPx = rulerLeftPx;
        var stripeWidthPx = Math.min(Math.floor(stripeFracEnd * containerW) - stripeLeftPx, containerW - stripeLeftPx);
        var octStripe = document.createElement('div');
        octStripe.style.position = 'absolute';
        octStripe.style.left = stripeLeftPx + 'px';
        octStripe.style.top = '0';
        octStripe.style.height = playAreaH + 'px';
        octStripe.style.width = stripeWidthPx + 'px';
        octStripe.style.background = stripeBg;
        octStripe.style.pointerEvents = 'none';
        octStripe.style.zIndex = '0';
        wrapperFrag.appendChild(octStripe);
      }

      // Note label — clamp width so it doesn't exceed container bounds
      var clampedWidth = Math.min(rulerWidthPx, containerW - rulerLeftPx);
      if (clampedWidth < 1) { continue; }
      var rulerLabel = document.createElement('div');
      rulerLabel.style.position = 'absolute';
      rulerLabel.style.left = rulerLeftPx + 'px';
      rulerLabel.style.width = clampedWidth + 'px';
      rulerLabel.style.top = '0';
      rulerLabel.style.bottom = '0';
      rulerLabel.style.display = 'flex';
      rulerLabel.style.alignItems = 'center';
      rulerLabel.style.justifyContent = 'center';
      rulerLabel.style.flexDirection = 'column';
      rulerLabel.style.pointerEvents = 'none';
      rulerLabel.style.overflow = 'hidden';
      rulerLabel.style.opacity = String(PITCH_RULER_OPACITY);
      rulerLabel.setAttribute('data-ruler-midi', String(rulerMidi));

      var rulerNoteName = document.createElement('span');
      rulerNoteName.style.fontSize = PITCH_RULER_LABEL_FONT + 'px';
      rulerNoteName.style.fontWeight = rulerIsC ? 'bold' : 'normal';
      rulerNoteName.style.color = rulerIsC ? PITCH_RULER_C_COLOR : PITCH_RULER_NOTE_COLOR;
      rulerNoteName.style.lineHeight = '1.1';
      rulerNoteName.textContent = NOTES[rulerPc];
      rulerLabel.appendChild(rulerNoteName);

      // Add octave number for C notes
      if (rulerIsC) {
        var rulerOctNum = document.createElement('span');
        rulerOctNum.style.fontSize = PITCH_RULER_OCTAVE_FONT + 'px';
        rulerOctNum.style.color = PITCH_RULER_C_COLOR;
        rulerOctNum.style.opacity = '0.7';
        rulerOctNum.style.lineHeight = '1';
        rulerOctNum.textContent = String(Math.floor(rulerMidi / SEMITONES_PER_OCTAVE) - 1);
        rulerLabel.appendChild(rulerOctNum);
      }

      rulerFrag.appendChild(rulerLabel);
      _pitchRulerLabels.push({ el: rulerLabel, midi: rulerMidi });
    }
    wrapper.appendChild(wrapperFrag);
    pitchRuler.appendChild(rulerFrag);
    wrapper.appendChild(pitchRuler);

    // Helper to highlight the current note on the pitch ruler
    function _highlightRulerNote(midi) {
      var idx = midi - startMidi;
      var isInRange = (idx >= 0) && (idx < totalSemitones);
      if (isInRange) {
        var frac = idx / totalSemitones;
        var nextFrac = (idx + 1) / totalSemitones;
        var leftPx = Math.floor(frac * containerW);
        var widthPx = Math.floor(nextFrac * containerW) - leftPx;
        _pitchRulerHighlight.style.left = leftPx + 'px';
        _pitchRulerHighlight.style.width = widthPx + 'px';
        _pitchRulerHighlight.style.display = 'block';
      } else {
        _pitchRulerHighlight.style.display = 'none';
      }
      // Brighten the active label
      var li;
      for (li = 0; li < _pitchRulerLabels.length; li++) {
        var entry = _pitchRulerLabels[li];
        var isActive = (entry.midi === midi);
        if (isActive) {
          entry.el.style.opacity = String(PITCH_RULER_HIGHLIGHT_OPACITY);
        } else {
          entry.el.style.opacity = String(PITCH_RULER_OPACITY);
        }
      }
    }

    function _clearRulerHighlight() {
      _pitchRulerHighlight.style.display = 'none';
      var li;
      for (li = 0; li < _pitchRulerLabels.length; li++) {
        _pitchRulerLabels[li].el.style.opacity = String(PITCH_RULER_OPACITY);
      }
    }

    // Snap toggle
    var snapToggle = document.createElement('button');
    snapToggle.className = 'rhy-scr-btn ssli-ctrl-snap-toggle ssli-theremin-snap-toggle';
    snapToggle.textContent = _isThereminContinuousMode ? SL.t('vowelpad.smooth') : SL.t('vowelpad.snap');
    snapToggle.title = SL.t('chordpads.snap_toggle_title');
    if (_isThereminContinuousMode) { snapToggle.classList.add('active'); }
    function _toggleSnap() {
      _isThereminContinuousMode = !_isThereminContinuousMode;
      snapToggle.textContent = _isThereminContinuousMode ? SL.t('vowelpad.smooth') : SL.t('vowelpad.snap');
      if (_isThereminContinuousMode) { snapToggle.classList.add('active'); }
      else { snapToggle.classList.remove('active'); }
    }
    snapToggle.addEventListener('click', _toggleSnap);
    snapToggle.addEventListener('touchstart', function(e) { e.stopPropagation(); });
    snapToggle.addEventListener('touchend', function(e) {
      e.stopPropagation();
      e.preventDefault();
      _toggleSnap();
    });
    wrapper.appendChild(snapToggle);

    // ---- Tilt-to-data conversion ----
    function tiltToData(beta, gamma) {
      var betaClamped = Math.max(TILT_BETA_MIN_DEG, Math.min(TILT_BETA_MAX_DEG, beta));
      var relX = (betaClamped - TILT_BETA_MIN_DEG) / (TILT_BETA_MAX_DEG - TILT_BETA_MIN_DEG);
      var gammaClamped = Math.max(TILT_GAMMA_MIN_DEG, Math.min(TILT_GAMMA_MAX_DEG, gamma));
      var relY = 1.0 - ((gammaClamped - TILT_GAMMA_MIN_DEG) / (TILT_GAMMA_MAX_DEG - TILT_GAMMA_MIN_DEG));
      var midiFloat = startMidi + (relX * totalSemitones);
      var volume = 1.0 - relY;

      var midi, bendCents;
      if (_isThereminContinuousMode) {
        midi = Math.round(midiFloat);
        if (midi > MIDI_MAX) { midi = MIDI_MAX; }
        bendCents = (midiFloat - midi) * 100;
      } else {
        midi = Math.round(midiFloat);
        if (midi > MIDI_MAX) { midi = MIDI_MAX; }
        bendCents = 0;
      }
      return { midi: midi, bendCents: bendCents, volume: volume, relX: relX, relY: relY };
    }

    // ---- Mouse/touch fallback (same as old theremin, for desktop) ----
    function posToData(x, y) {
      var rect = wrapper.getBoundingClientRect();
      var relX = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
      var relY = Math.max(0, Math.min(1, (y - rect.top) / rect.height));
      var midiFloat = startMidi + (relX * totalSemitones);
      var volume = 1.0 - relY;

      var midi, bendCents;
      if (_isThereminContinuousMode) {
        midi = Math.round(midiFloat);
        if (midi > MIDI_MAX) { midi = MIDI_MAX; }
        bendCents = (midiFloat - midi) * 100;
      } else {
        midi = Math.round(midiFloat);
        if (midi > MIDI_MAX) { midi = MIDI_MAX; }
        bendCents = 0;
      }
      return { midi: midi, bendCents: bendCents, volume: volume, relX: relX, relY: relY };
    }

    // ---- Visual update ----
    function updateVisual(relX, relY, volume) {
      var orbEl = document.getElementById('thereminOrb');
      if (orbEl) {
        orbEl.style.left = (relX * containerW) + 'px';
        orbEl.style.top = (relY * containerH) + 'px';
        orbEl.style.display = 'block';
        var glow = Math.floor(volume * 30) + 10;
        orbEl.style.boxShadow = '0 0 ' + glow + 'px ' + Math.floor(glow * 0.6) + 'px rgba(76, 201, 240, ' + (volume * 0.8 + 0.1) + ')';
      }
      // Rotate gyro rings based on tilt
      var betaDeg = (relX - 0.5) * 90;
      var gammaDeg = (relY - 0.5) * 60;
      var rri;
      for (rri = 0; rri < ringEls.length; rri++) {
        var rotScale = (rri + 1) * 0.4;
        var rotX = gammaDeg * rotScale;
        var rotY = betaDeg * rotScale;
        var rotZ = (betaDeg + gammaDeg) * 0.3 * rotScale;
        ringEls[rri].style.transform = 'translate(-50%, -50%) rotateX(' + rotX + 'deg) rotateY(' + rotY + 'deg) rotateZ(' + rotZ + 'deg)';
        var ringOpacity = 0.3 + (volume * 0.7);
        ringEls[rri].style.opacity = String(ringOpacity);
      }
    }

    function hideVisual() {
      var orbEl = document.getElementById('thereminOrb');
      if (orbEl) { orbEl.style.display = 'none'; }
      var rri;
      for (rri = 0; rri < ringEls.length; rri++) {
        ringEls[rri].style.transform = 'translate(-50%, -50%)';
        ringEls[rri].style.opacity = '0.3';
      }
    }

    function applyVolume(volume) {
      if (SL.audio && SL.audio.setExpression) {
        var clamped = volume;
        if (clamped < AIRSYNTH_VOL_MIN) { clamped = AIRSYNTH_VOL_MIN; }
        if (clamped > AIRSYNTH_VOL_MAX) { clamped = AIRSYNTH_VOL_MAX; }
        SL.audio.setExpression(AIRSYNTH_CUTOFF_OPEN_HZ, clamped);
      }
    }

    // ---- Play state management ----
    function airStart(relX, relY) {
      _isAirActive = true;
      var hint = document.getElementById('thereminIdleHint');
      if (hint) { hint.style.display = 'none'; }
      // Save and override sustain
      var canQueryAirInstrument = SL.audio && SL.audio.getInstruments;
      var hasAirInstrumentQuery = canQueryAirInstrument && SL.audio.getCurrentInstrument;
      if (hasAirInstrumentQuery) {
        var instId = SL.audio.getCurrentInstrument();
        var insts = SL.audio.getInstruments();
        var inst = insts ? insts[instId] : null;
        var hasAdsrForAirSustain = inst && inst.settings && inst.settings.adsr;
        if (hasAdsrForAirSustain) {
          _airSavedSustainInst = instId;
          _airSavedSustain = inst.settings.adsr.s;
          inst.settings.adsr.s = AIRSYNTH_HELD_SUSTAIN;
        }
      }
      var midiFloat = startMidi + (relX * totalSemitones);
      _airCurrentMidi = Math.round(midiFloat);
      if (_airCurrentMidi > MIDI_MAX) { _airCurrentMidi = MIDI_MAX; }
      noteOn(_airCurrentMidi);
      var volume = 1.0 - relY;
      applyPitchBend((midiFloat - _airCurrentMidi) * 100);
      applyVolume(volume);
      updateVisual(relX, relY, volume);
      var rd = document.getElementById('thereminReadout');
      if (rd) { rd.textContent = _midiToName(_airCurrentMidi); }
      _highlightRulerNote(_airCurrentMidi);
    }

    function airUpdate(relX, relY) {
      if (!_isAirActive) { return; }
      var midiFloat = startMidi + (relX * totalSemitones);
      var newMidi = Math.round(midiFloat);
      if (newMidi > MIDI_MAX) { newMidi = MIDI_MAX; }
      var volume = 1.0 - relY;

      if (_isThereminContinuousMode) {
        applyPitchBend((midiFloat - _airCurrentMidi) * 100);
      } else {
        if (newMidi !== _airCurrentMidi) {
          noteOff(_airCurrentMidi);
          _airCurrentMidi = newMidi;
          noteOn(newMidi);
        }
        applyPitchBend(0);
      }
      applyVolume(volume);
      updateVisual(relX, relY, volume);
      var rd = document.getElementById('thereminReadout');
      if (rd) { rd.textContent = _midiToName(_airCurrentMidi); }
      _highlightRulerNote(_airCurrentMidi);
    }

    function airEnd() {
      if (_isAirActive) {
        resetPitchBendFn();
        noteOff(_airCurrentMidi);
        _isAirActive = false;
        _airCurrentMidi = -1;
        hideVisual();
        _clearRulerHighlight();
        var rd = document.getElementById('thereminReadout');
        if (rd) { rd.textContent = '--'; }
        var hint = document.getElementById('thereminIdleHint');
        if (hint) { hint.style.display = ''; }
        if (SL.audio && SL.audio.clearExpression) { SL.audio.clearExpression(); }
        // Restore sustain
        if ((_airSavedSustain !== NO_SELECTION) && (_airSavedSustainInst >= 0)
            && SL.audio && SL.audio.getInstruments) {
          var restInsts = SL.audio.getInstruments();
          var restInst = restInsts ? restInsts[_airSavedSustainInst] : null;
          var hasAdsrForAirRestore = restInst && restInst.settings && restInst.settings.adsr;
          if (hasAdsrForAirRestore) {
            restInst.settings.adsr.s = _airSavedSustain;
          }
          _airSavedSustain = null;
          _airSavedSustainInst = -1;
        }
      }
    }

    // ---- DeviceOrientation handler ----
    function onDeviceOrientation(e) {
      if (!_isAirActive) { return; }
      var betaVal = (e.gamma !== NO_SENSOR_VAL) ? e.gamma : 0;
      var gammaVal = (e.beta !== NO_SENSOR_VAL) ? e.beta : 30;
      _rawBeta = betaVal;
      _rawGamma = gammaVal;
    }

    // Tilt animation loop (applies smoothing)
    function tiltLoop() {
      if (!_isAirActive) {
        _animFrameId = null;
      } else {
        _smoothBeta = _smoothBeta + (1.0 - TILT_SMOOTHING) * (_rawBeta - _smoothBeta);
        _smoothGamma = _smoothGamma + (1.0 - TILT_SMOOTHING) * (_rawGamma - _smoothGamma);
        var info = tiltToData(_smoothBeta, _smoothGamma);
        airUpdate(info.relX, info.relY);
        _animFrameId = requestAnimationFrame(tiltLoop);
      }
    }

    // ---- Attempt to enable tilt ----
    function enableTilt() {
      if (_isTiltListenerBound) { return; }
      _isTiltListenerBound = true;
      window.addEventListener('deviceorientation', onDeviceOrientation);
      _isTiltAvailable = true;
      var label = document.getElementById('airSynthModeLabel');
      if (label) { label.textContent = SL.t('theremin.tilt_mode'); }
    }

    // Show touch-mode fallback UI with optional retry button
    function _showTouchModeFallback(reason) {
      var label = document.getElementById('airSynthModeLabel');
      if (label) { label.textContent = SL.t('theremin.touch_mode'); }
      var canRetry = (reason === 'denied' || reason === 'error');
      var existingBtn = wrapper.querySelector('.ssli-airsynth-retry-btn');
      if (canRetry && !existingBtn) {
        var retryBtn = document.createElement('button');
        retryBtn.className = 'rhy-scr-btn ssli-airsynth-retry-btn';
        retryBtn.textContent = SL.t('theremin.retry_permission');
        retryBtn.title = SL.t('theremin.retry_permission');
        retryBtn.style.position = 'absolute';
        retryBtn.style.top = '6px';
        retryBtn.style.right = '6px';
        retryBtn.style.zIndex = '10';
        retryBtn.addEventListener('click', function(ev) {
          ev.stopPropagation();
          ev.preventDefault();
          requestTiltAccess();
        });
        retryBtn.addEventListener('touchstart', function(ev) { ev.stopPropagation(); });
        retryBtn.addEventListener('touchend', function(ev) {
          ev.stopPropagation();
          ev.preventDefault();
          requestTiltAccess();
        });
        wrapper.appendChild(retryBtn);
      }
      // Update hint to indicate touch usage
      var hint = document.getElementById('thereminIdleHint');
      if (hint) { hint.textContent = SL.t('theremin.touch_hint'); }
    }

    // Try to detect and request tilt permission (iOS 13+ requires explicit permission)
    function requestTiltAccess() {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission().then(function(state) {
          if (state === 'granted') {
            enableTilt();
            // Remove retry button on success
            var retryBtn = wrapper.querySelector('.ssli-airsynth-retry-btn');
            if (retryBtn) { retryBtn.parentNode.removeChild(retryBtn); }
            var label = document.getElementById('airSynthModeLabel');
            if (label) { label.textContent = SL.t('theremin.tilt_mode'); }
            var hint = document.getElementById('thereminIdleHint');
            if (hint) { hint.textContent = SL.t('theremin.tap_to_play'); }
          } else {
            _showTouchModeFallback('denied');
          }
        }).catch(function() {
          _showTouchModeFallback('error');
        });
      } else if (typeof DeviceOrientationEvent !== 'undefined') {
        // Android / non-iOS: just listen
        enableTilt();
      } else {
        _showTouchModeFallback('no-sensors');
      }
    }

    // ---- Touch/mouse events (work in both modes) ----
    wrapper.addEventListener('mousedown', function(e) {
      e.preventDefault();
      var info = posToData(e.clientX, e.clientY);
      airStart(info.relX, info.relY);
      if (_isTiltAvailable) {
        _smoothBeta = 0;
        _smoothGamma = 30;
        _animFrameId = requestAnimationFrame(tiltLoop);
      }
    });
    wrapper.addEventListener('mousemove', function(e) {
      var previewInfo = posToData(e.clientX, e.clientY);
      var previewMidi = previewInfo.midi;
      var previewRd = document.getElementById('thereminReadout');
      if (!_isAirActive) {
        if (previewRd) { previewRd.textContent = _midiToName(previewMidi); }
        _highlightRulerNote(previewMidi);
      } else {
        if (!_isTiltAvailable) {
          airUpdate(previewInfo.relX, previewInfo.relY);
        }
      }
    });
    wrapper.addEventListener('mouseup', function() { airEnd(); });
    wrapper.addEventListener('mouseleave', function() {
      if (!_isAirActive) {
        var leaveRd = document.getElementById('thereminReadout');
        if (leaveRd) { leaveRd.textContent = '--'; }
        _clearRulerHighlight();
      }
      airEnd();
    });
    wrapper.addEventListener('touchstart', function(e) {
      e.preventDefault();
      requestTiltAccess();
      var info = posToData(e.touches[0].clientX, e.touches[0].clientY);
      airStart(info.relX, info.relY);
      if (_isTiltAvailable) {
        _smoothBeta = 0;
        _smoothGamma = 30;
        _animFrameId = requestAnimationFrame(tiltLoop);
      }
    });
    wrapper.addEventListener('touchmove', function(e) {
      e.preventDefault();
      if (!_isAirActive) { return; }
      if (!_isTiltAvailable) {
        var info = posToData(e.touches[0].clientX, e.touches[0].clientY);
        airUpdate(info.relX, info.relY);
      }
    });
    wrapper.addEventListener('touchend', function(e) { e.preventDefault(); airEnd(); });
    wrapper.addEventListener('touchcancel', function() { airEnd(); });

    // Store release state on the controller for external teardown
    SL.controllers.theremin._releaseState = {
      airEnd: airEnd,
      getAnimFrameId: function() { return _animFrameId; },
      cancelAnimFrame: function() {
        if (_animFrameId !== NO_TIMER) {
          cancelAnimationFrame(_animFrameId);
          _animFrameId = null;
        }
      },
      removeTiltListener: function() {
        if (_isTiltListenerBound) {
          window.removeEventListener('deviceorientation', onDeviceOrientation);
          _isTiltListenerBound = false;
          _isTiltAvailable = false;
        }
      }
    };

    container.appendChild(wrapper);
  }

  // ============================================================
  // Chromatic Grid Controller
  // ============================================================

  function _buildChromaticGridController(container, opts) {
    var baseOctave = opts.baseOctave;
    var noteOn = opts.noteOn;
    var noteOff = opts.noteOff;
    var applyPitchBend = opts.applyPitchBend;
    var resetPitchBendFn = opts.resetPitchBendFn;

    var containerW = container.clientWidth || DEFAULT_CONTAINER_WIDTH;
    var containerH = container.clientHeight || DEFAULT_CONTAINER_HEIGHT;

    var wrapper = document.createElement('div');
    wrapper.className = 'ctrl-linn-wrapper ssli-chromgrid-wrapper';
    wrapper.style.width = containerW + 'px';
    wrapper.style.height = containerH + 'px';

    var cols = CHROMATIC_GRID_COLS;
    var cellW = Math.floor(containerW / cols);
    var rows = Math.max(2, Math.floor(containerH / cellW));
    var cellH = Math.floor(containerH / rows);
    var baseNote = (baseOctave + 1) * SEMITONES_PER_OCTAVE;
    var labelFontSize = Math.max(12, Math.floor(Math.min(cellW, cellH) / 3));
    var octFontSize = Math.max(10, Math.floor(labelFontSize * 0.85));

    for (var row = 0; row < rows; row++) {
      var visualRow = rows - 1 - row;
      var rowStartMidi = baseNote + (row * CHROMATIC_GRID_ROW_INTERVAL);

      for (var col = 0; col < cols; col++) {
        var midi = rowStartMidi + col;
        if (midi > MIDI_MAX) { continue; }
        var pc = midi % SEMITONES_PER_OCTAVE;
        var oct = Math.floor(midi / SEMITONES_PER_OCTAVE) - 1;
        var isC = (pc === 0);

        var cell = document.createElement('div');
        cell.className = 'ctrl-linn-cell ssli-chromgrid-cell' + (isC ? ' ctrl-linn-c' : '');
        cell.setAttribute('data-midi', midi);
        cell.style.left = (col * cellW) + 'px';
        cell.style.top = (visualRow * cellH) + 'px';
        cell.style.width = cellW + 'px';
        cell.style.height = cellH + 'px';
        cell.style.background = CHROMATIC_GRID_NOTE_COLORS[pc];

        var noteLabel = document.createElement('span');
        noteLabel.className = 'ctrl-linn-label';
        noteLabel.style.fontSize = labelFontSize + 'px';
        noteLabel.textContent = NOTES[pc];
        cell.appendChild(noteLabel);

        var octLabel = document.createElement('span');
        octLabel.className = 'ctrl-linn-oct-label';
        octLabel.style.fontSize = octFontSize + 'px';
        octLabel.textContent = String(oct);
        cell.appendChild(octLabel);

        wrapper.appendChild(cell);
      }
    }

    // Touch handling
    var _linnTouches = {};
    wrapper.addEventListener('touchstart', function(e) {
      e.preventDefault();
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        var el = document.elementFromPoint(t.clientX, t.clientY);
        if (el) {
          var target = el;
          while (target && target !== wrapper) {
            var attr = target.getAttribute('data-midi');
            if (attr !== NO_ATTR) {
              var m = parseInt(attr, 10);
              var touchPressureEvent = { pointerType: 'touch', pressure: t.force };
              var touchVel = SL.velocityFromPressure(touchPressureEvent, CHROMGRID_DEFAULT_VELOCITY);
              noteOn(m, touchVel);
              target.classList.add('ctrl-linn-active');
              _linnTouches[t.identifier] = { midi: m, el: target, startX: t.clientX };
              break;
            }
            target = target.parentNode;
          }
        }
      }
    }, { passive: false });

    wrapper.addEventListener('touchmove', function(e) {
      e.preventDefault();
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        var info = _linnTouches[t.identifier];
        if (info) {
          var dx = t.clientX - info.startX;
          var bendCents = (dx / cellW) * 100;
          bendCents = Math.max(-MAX_BEND_CENTS, Math.min(MAX_BEND_CENTS, bendCents));
          applyPitchBend(bendCents);

          var newEl = document.elementFromPoint(t.clientX, t.clientY);
          if (newEl) {
            var target = newEl;
            while (target && target !== wrapper) {
              var attr = target.getAttribute('data-midi');
              if (attr !== NO_ATTR) {
                var newMidi = parseInt(attr, 10);
                if (newMidi !== info.midi) {
                  noteOff(info.midi);
                  if (info.el) { info.el.classList.remove('ctrl-linn-active'); }
                  var movePressureEvent = { pointerType: 'touch', pressure: t.force };
                  var moveVel = SL.velocityFromPressure(movePressureEvent, CHROMGRID_DEFAULT_VELOCITY);
                  noteOn(newMidi, moveVel);
                  target.classList.add('ctrl-linn-active');
                  info.midi = newMidi;
                  info.el = target;
                  info.startX = t.clientX;
                  resetPitchBendFn();
                }
                break;
              }
              target = target.parentNode;
            }
          }
        }
      }
    }, { passive: false });

    wrapper.addEventListener('touchend', function(e) {
      e.preventDefault();
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        var info = _linnTouches[t.identifier];
        if (info) {
          noteOff(info.midi);
          resetPitchBendFn();
          if (info.el) { info.el.classList.remove('ctrl-linn-active'); }
          delete _linnTouches[t.identifier];
        }
      }
    }, { passive: false });

    wrapper.addEventListener('touchcancel', function(e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        var info = _linnTouches[t.identifier];
        if (info) {
          noteOff(info.midi);
          resetPitchBendFn();
          if (info.el) { info.el.classList.remove('ctrl-linn-active'); }
          delete _linnTouches[t.identifier];
        }
      }
    });

    // Mouse support
    var _isLinnMouseDown = false;
    var _linnMouseMidi = -1;
    var _linnMouseStartX = 0;
    var _linnMouseEl = null;

    wrapper.addEventListener('mousedown', function(e) {
      e.preventDefault();
      _isLinnMouseDown = true;
      var el = document.elementFromPoint(e.clientX, e.clientY);
      if (el) {
        var target = el;
        while (target && target !== wrapper) {
          var attr = target.getAttribute('data-midi');
          if (attr !== NO_ATTR) {
            _linnMouseMidi = parseInt(attr, 10);
            _linnMouseStartX = e.clientX;
            _linnMouseEl = target;
            var mouseVel = SL.velocityFromPressure(e, CHROMGRID_DEFAULT_VELOCITY);
            noteOn(_linnMouseMidi, mouseVel);
            target.classList.add('ctrl-linn-active');
            break;
          }
          target = target.parentNode;
        }
      }
    });

    wrapper.addEventListener('mousemove', function(e) {
      if (!_isLinnMouseDown || _linnMouseMidi < 0) { return; }
      var dx = e.clientX - _linnMouseStartX;
      var bendCents = (dx / cellW) * 100;
      bendCents = Math.max(-MAX_BEND_CENTS, Math.min(MAX_BEND_CENTS, bendCents));
      applyPitchBend(bendCents);
    });

    wrapper.addEventListener('mouseup', function() {
      if (_linnMouseMidi >= 0) {
        noteOff(_linnMouseMidi);
        resetPitchBendFn();
        if (_linnMouseEl) { _linnMouseEl.classList.remove('ctrl-linn-active'); }
      }
      _isLinnMouseDown = false;
      _linnMouseMidi = -1;
      _linnMouseEl = null;
    });

    wrapper.addEventListener('mouseleave', function() {
      if (_linnMouseMidi >= 0) {
        noteOff(_linnMouseMidi);
        resetPitchBendFn();
        if (_linnMouseEl) { _linnMouseEl.classList.remove('ctrl-linn-active'); }
      }
      _isLinnMouseDown = false;
      _linnMouseMidi = -1;
      _linnMouseEl = null;
    });

    container.appendChild(wrapper);
  }

  // ============================================================
  // Expose strum timeouts for cleanup
  // ============================================================

  function _getStrumTimeouts() {
    return _strumTimeouts;
  }

  function _clearStrumTimeouts() {
    for (var st = 0; st < _strumTimeouts.length; st++) {
      clearTimeout(_strumTimeouts[st]);
    }
    _strumTimeouts = [];
    if (_restrumIntervalId !== NO_TIMER) { clearInterval(_restrumIntervalId); _restrumIntervalId = null; }
  }

  // ============================================================
  // Register
  // ============================================================

  if (!SL.controllers) { SL.controllers = {}; }
  SL.controllers.loom = {
    build: _buildLoomController,
    _releaseState: null,
    release: function() {
      _glowkeysReleaseAll();
    }
  };
  SL.controllers.chordpads = {
    build: _buildChordPadController,
    getStrumTimeouts: _getStrumTimeouts,
    clearStrumTimeouts: _clearStrumTimeouts,
    release: function() {
      _clearStrumTimeouts();
      _releaseAllChordPads();
    }
  };
  SL.controllers.xypad = {
    build: _buildXYPadController,
    _releaseState: null,
    release: function() {
      if (SL.controllers.xypad._releaseState) {
        SL.controllers.xypad._releaseState.releaseAll();
      }
    }
  };
  SL.controllers.marimba = {
    build: _buildMarimbaController,
    _releaseState: null,
    release: function() {
      if (SL.controllers.marimba._releaseState) {
        SL.controllers.marimba._releaseState.releaseAll();
      }
    }
  };
  SL.controllers.harp = {
    build: _buildHarpController,
    _releaseState: null,
    release: function() {
      if (SL.controllers.harp._releaseState) {
        SL.controllers.harp._releaseState.releaseAll();
      }
    }
  };
  SL.controllers.theremin = {
    build: _buildThereminController,
    _releaseState: null,
    release: function() {
      if (SL.controllers.theremin._releaseState) {
        SL.controllers.theremin._releaseState.airEnd();
        SL.controllers.theremin._releaseState.cancelAnimFrame();
        SL.controllers.theremin._releaseState.removeTiltListener();
      }
    }
  };
  // chromaticgrid is now an alias to the unified grid controller (isogrid.js)
  // which includes "Chromatic (12-col)" as a layout preset.
  SL.controllers.chromaticgrid = SL.controllers.grid;

  // ============================================================
  // PanicRegistry registrations
  // NOTE: xypad/theremin/linnstrument/marimba/harp/chromaticgrid store
  // their active-MIDI state in LOCAL variables scoped to their build closures
  // and rely on caller-supplied noteOn/noteOff callbacks. They are not
  // reachable from module scope, so there is no centralized teardown for
  // those sub-controllers here. Their DOM active classes are still cleared
  // by the legacy _performPanic path (class-scrub), and audio-side panic
  // (stopAllSustained + MIDI All Notes Off) terminates any voices they
  // started through SL.audio. Chordpads and Glow Keys (loom) module-level
  // state IS reachable and is registered below.
  // ============================================================

  function _releaseAllChordPads() {
    // Clear module-level active-chord list. We cannot call the per-build
    // noteOff here because the callback is stored in the closure; we rely
    // on audio-engine stopAllSustained + MIDI panic to silence voices.
    _chordPadNotes = [];
    _padActiveNotes = {};
  }

  if (SL.PanicRegistry) {
    SL.PanicRegistry.register(
      'timers',
      'special.chordpads.strumTimeouts',
      function teardownChordPadTimers() {
        _clearStrumTimeouts();
      },
      function assertChordPadTimers() {
        if (_strumTimeouts && _strumTimeouts.length > 0) {
          return _strumTimeouts.length + ' chordpad strum timeouts remain';
        }
        if (_restrumIntervalId !== NO_TIMER) {
          return 'chordpad restrum interval still running';
        }
        return null;
      }
    );

    SL.PanicRegistry.register(
      'voices',
      'special.chordpads.notes',
      function teardownChordPadVoices() {
        _releaseAllChordPads();
      },
      function assertChordPadVoices() {
        if (_chordPadNotes && _chordPadNotes.length > 0) {
          return _chordPadNotes.length + ' chordpad notes still tracked';
        }
        return null;
      }
    );

    SL.PanicRegistry.register(
      'voices',
      'special.glowkeys.pointers',
      function teardownGlowkeysVoices() {
        _glowkeysReleaseAll();
      },
      function assertGlowkeysVoices() {
        var activeCount = Object.keys(_glowkeysActivePointers).length;
        if (activeCount > 0) {
          return activeCount + ' glowkeys pointer(s) still tracked';
        }
        return null;
      }
    );
  }

})();
