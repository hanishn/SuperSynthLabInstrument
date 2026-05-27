// SSLI Controller: Accordion (3-panel: Stradella bass + bellows + B-system melody)
// ES5 compatible (var, no arrow functions, no template literals)
//
// ---- What is an accordion? ----
// A free-reed aerophone: air forced through bellows flows past tuned metal
// reeds, causing them to vibrate and produce sound. Unlike organ pipes
// (which use airflow to create standing waves), accordion reeds are fixed
// at one end and oscillate at their natural frequency when air passes over
// them -- similar to a harmonica but with keyboard/button control.
//
// Two manuals: the right hand plays melody on a treble keyboard (here a
// B-system chromatic button layout), while the left hand plays bass notes
// and chords on a Stradella bass system. The bellows sit between the two
// halves; pushing and pulling controls airflow, which governs volume and
// tonal brightness -- the primary means of expression.
//
// Register switches on a real accordion select different reed ranks (sets
// of reeds tuned at 8', 16', or 4' pitch). This surface does not model
// registers but does map touch/pointer pressure to bellows dynamics and
// wires bellows position to the reed engine's breath-pressure parameter.
//
// Ref: Benetoux, "The Ins and Outs of the Accordion" (2001)
// Ref: Hermosa, "The Accordion in the Americas" (Univ. of Illinois, 2012)

(function() {
  'use strict';

  var SL = window.SynthLab;
  var NOTES = (SL && SL.NOTES) ? SL.NOTES : ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

  // ============================================================
  // Constants
  // ============================================================

  var NO_ACTIVE_KEY  = null;  /* sentinel: no active key/note in touch map */
  var NO_ATTR        = null;  /* sentinel: getAttribute returned no value */

  var SEMITONES_PER_OCTAVE = 12;
  var OCTAVE_BASE_OFFSET = 1;
  var DEFAULT_VELOCITY = 100;

  // Bass Stradella grid: 8 core columns (circle-of-fifths most-used keys)
  // The Stradella system arranges bass buttons in circle-of-fifths order
  // so that related keys (I-IV-V) are always adjacent. Each column has
  // four rows: a single bass note, then major, minor, and dominant-7th
  // chords built on that root. A full-size accordion has 120 bass buttons;
  // we use the 8 most-used columns (Eb through E) for a 32-button grid.
  var BASS_COLS = 8;
  var BASS_ROWS = 4;
  var BASS_ROW_BASS = 0;
  var BASS_ROW_MAJOR = 1;
  var BASS_ROW_MINOR = 2;
  var BASS_ROW_DOM7 = 3;

  // Circle-of-fifths core pitch classes: Eb Bb F C G D A E
  // Each value is a MIDI pitch class (0=C, 7=G, etc.). Adjacent columns
  // are a perfect fifth apart, matching the physical layout of a real
  // Stradella board where the player's hand moves in fifths naturally.
  var BASS_COL_PITCH_CLASSES = [3, 10, 5, 0, 7, 2, 9, 4];
  var BASS_COL_LABELS = ['Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E'];
  var BASS_ROW_CSS = ['row-bass', 'row-major', 'row-minor', 'row-dom7'];

  // Chord intervals per row
  var CHORD_INTERVALS_BASS = [0];
  var CHORD_INTERVALS_MAJOR = [0, 4, 7];
  var CHORD_INTERVALS_MINOR = [0, 3, 7];
  var CHORD_INTERVALS_DOM7 = [0, 4, 7, 10];
  var ROW_INTERVALS = [CHORD_INTERVALS_BASS, CHORD_INTERVALS_MAJOR, CHORD_INTERVALS_MINOR, CHORD_INTERVALS_DOM7];

  // Bass voicing: root row sounds one octave below chords
  var BASS_OCTAVE_OFFSET = -1;
  var CHORD_OCTAVE_OFFSET = 0;

  // Melody B-system chromatic buttons
  // The B-system (used in Russia, France, and most of Europe) arranges
  // chromatic notes in three staggered rows. Each row steps by whole
  // tones (2 semitones), and adjacent rows are offset by one semitone,
  // giving full chromatic coverage. This is more compact than a piano
  // keyboard and allows wider intervals with smaller hand movements.
  var MELODY_ROWS = 3;
  var MELODY_STEP_SEMITONES = 2;
  var MELODY_NOTES_PER_ROW = 12;
  var MELODY_ROW_OFFSETS = [0, 1, 2];

  // Layout sizing
  var BASS_WIDTH_PERCENT_DESKTOP = 35;
  var BASS_WIDTH_PERCENT_PHONE = 35;
  var BELLOWS_WIDTH_PERCENT = 8;
  var BASS_BUTTON_MIN_SIZE_DESKTOP = 36;
  var BASS_BUTTON_MIN_SIZE_PHONE = 30;
  var MELODY_BUTTON_GAP_PX = 2;
  var TOP_BAR_HEIGHT_PX = 22;

  // Bellows expression
  // On a real accordion, bellows pressure is the primary expressive
  // control -- analogous to bow pressure on a violin. More pressure
  // means louder volume and brighter tone. We map the vertical drag
  // position to both gain (volume) and filter cutoff (brightness),
  // plus wire it to the reed engine's embouchure/breath parameter.
  var BELLOWS_GAIN_MIN = 0.05;
  var BELLOWS_GAIN_MAX = 1.0;
  var BELLOWS_GAIN_DEFAULT = 0.4;
  var BELLOWS_RAMP_DURATION_MS = 200;
  var BELLOWS_RAMP_STEP_MS = 16;

  // Accordion reed settings applied on build
  // Clarinet-type reed model is the closest physical match: both use a
  // single beating reed excited by air pressure. Real accordion reeds
  // are free reeds (vibrating both ways through a slot), but the
  // clarinet model captures the essential single-reed timbral character.
  var ACCORDION_REED_TYPE = 'clarinet';
  var ACCORDION_REED_STIFFNESS = 55;
  var ACCORDION_VIBRATO_RATE = 4.5;
  var ACCORDION_VIBRATO_DEPTH = 18;
  var ACCORDION_BREATH_NOISE = 12;
  var ACCORDION_EMBOUCHURE_PRESSURE = 60;

  // Body resonance settings for accordion box
  // The wooden enclosure of an accordion acts as a resonating chamber,
  // coloring the tone much like a guitar body shapes string sound.
  var ACCORDION_BODY_TYPE = 'wood';
  var ACCORDION_BODY_RESONANCE_AMOUNT = 60;
  var ACCORDION_BODY_BRIGHTNESS = 55;
  var ACCORDION_BODY_SIZE = 45;

  // Bellows-to-filter brightness mapping
  var BELLOWS_FILTER_CUTOFF_MIN_HZ = 600;
  var BELLOWS_FILTER_CUTOFF_MAX_HZ = 6000;

  // Root note selector options
  var ROOT_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  // Mode selector
  var ACCORDION_MODE_BASS = 'bass';
  var ACCORDION_MODE_MELODY = 'melody';
  var ACCORDION_MODE_BOTH = 'both';
  var ACCORDION_MODE_DEFAULT = ACCORDION_MODE_BOTH;

  // Legacy side toggle (phone only)
  var ACCORDION_VIEW_BASS = 'bass';
  var ACCORDION_VIEW_MELODY = 'melody';
  var ACCORDION_VIEW_DEFAULT = ACCORDION_VIEW_MELODY;

  // ============================================================
  // State
  // ============================================================

  var _cachedNoteOn = null;
  var _cachedNoteOff = null;
  var _cachedBaseOctave = 3;

  // Bass active notes: keyed by "col-row" -> [midi, midi, ...]
  var _bassActiveNotes = {};
  var _bassButtonEls = {};
  // Touch tracking for bass: pointerId -> "col-row" key
  var _bassTouchMap = {};

  // Melody active notes: keyed by button index -> midi
  var _melodyActiveNotes = {};
  var _melodyButtonEls = {};
  // Touch tracking for melody glissando: touchId -> last btnIndex
  var _melodyTouchMap = {};

  // Document-level pointerup safety handler for stuck bass notes
  var _docBassPointerUpHandler = null;

  // Bellows state
  var _isBellowsDragging = false;
  var _bellowsGain = BELLOWS_GAIN_DEFAULT;
  var _bellowsIndicatorEl = null;
  var _bellowsBarEl = null;
  var _bellowsZoneEl = null;
  var _bellowsRampTimer = null;

  // Mode selector state
  var _currentAccordionMode = ACCORDION_MODE_DEFAULT;
  var _modeBtnBassEl = null;
  var _modeBtnMelodyEl = null;
  var _modeBtnBothEl = null;

  // Side toggle state (phone only)
  var _currentAccordionView = ACCORDION_VIEW_DEFAULT;
  var _toggleBassBtnEl = null;
  var _toggleMelodyBtnEl = null;
  var _wrapperEl = null;

  // ============================================================
  // Helpers
  // ============================================================

  function _midiToNoteName(midi) {
    var pc = ((midi % SEMITONES_PER_OCTAVE) + SEMITONES_PER_OCTAVE) % SEMITONES_PER_OCTAVE;
    var oct = Math.floor(midi / SEMITONES_PER_OCTAVE) - 1;
    return NOTES[pc] + oct;
  }

  function _isPhone() {
    var layout = document.documentElement.getAttribute('data-layout');
    var isPhoneLand = (layout === 'phone-land');
    var isPhonePort = (layout === 'phone');
    return (isPhoneLand || isPhonePort);
  }

  // Bellows breath pressure range (0-100 scale for reed engine)
  // Maps the bellows drag fraction to the reed engine's breath pressure.
  // Min 20 keeps the reed just barely vibrating; max 90 avoids the
  // overblown/squealing range that real accordionists avoid.
  var BELLOWS_BREATH_PRESSURE_MIN = 20;
  var BELLOWS_BREATH_PRESSURE_MAX = 90;

  // Translate bellows position into audio engine parameters.
  // Two simultaneous mappings: (1) gain + filter cutoff for tonal
  // brightness, (2) reed engine breath pressure for physical response.
  function _applyBellowsExpression(gain) {
    var bellowsFrac = (gain - BELLOWS_GAIN_MIN) / (BELLOWS_GAIN_MAX - BELLOWS_GAIN_MIN);
    if (bellowsFrac < 0) { bellowsFrac = 0; }
    if (bellowsFrac > 1) { bellowsFrac = 1; }

    // Primary mapping: bellows controls volume (most important for accordion feel)
    if (SL.audio && SL.audio.setExpression) {
      var filterCutoff = BELLOWS_FILTER_CUTOFF_MIN_HZ + (bellowsFrac * (BELLOWS_FILTER_CUTOFF_MAX_HZ - BELLOWS_FILTER_CUTOFF_MIN_HZ));
      SL.audio.setExpression(filterCutoff, gain);
    }

    // Wire bellows position to reed engine breath pressure
    if (SL.audio && SL.audio.setReedSettings) {
      var breathPressure = BELLOWS_BREATH_PRESSURE_MIN + (bellowsFrac * (BELLOWS_BREATH_PRESSURE_MAX - BELLOWS_BREATH_PRESSURE_MIN));
      var currentInstId = SL.audio.getCurrentInstrument();
      SL.audio.setReedSettings(currentInstId, { embouchurePressure: Math.round(breathPressure) });
    }
  }

  function _clearExpression() {
    if (SL.audio && SL.audio.clearExpression) {
      SL.audio.clearExpression();
    }
  }

  function _updateBellowsVisual(frac) {
    if (_bellowsIndicatorEl) {
      var topPercent = (1 - frac) * 100;
      _bellowsIndicatorEl.style.top = topPercent + '%';
    }
    if (_bellowsBarEl) {
      _bellowsBarEl.style.height = (frac * 100) + '%';
    }
  }

  function _gainToFrac(gain) {
    return (gain - BELLOWS_GAIN_MIN) / (BELLOWS_GAIN_MAX - BELLOWS_GAIN_MIN);
  }

  // ============================================================
  // Bellows rAF ramp back to default
  // ============================================================

  // When the player releases the bellows drag, smoothly ramp back to
  // a neutral pressure (like a real bellows settling to rest position).
  function _bellowsStartReturnRamp() {
    if (_bellowsRampTimer) {
      clearInterval(_bellowsRampTimer);
      _bellowsRampTimer = null;
    }

    var startGain = _bellowsGain;
    var targetGain = BELLOWS_GAIN_DEFAULT;
    var totalSteps = Math.max(1, Math.round(BELLOWS_RAMP_DURATION_MS / BELLOWS_RAMP_STEP_MS));
    var stepCount = 0;
    var safeTotalSteps = totalSteps || 1;
    var gainDelta = (targetGain - startGain) / safeTotalSteps;

    _bellowsRampTimer = setInterval(function() {
      stepCount++;
      var rampDone = (stepCount >= totalSteps);
      if (rampDone) {
        _bellowsGain = targetGain;
        clearInterval(_bellowsRampTimer);
        _bellowsRampTimer = null;
      } else {
        _bellowsGain = startGain + (gainDelta * stepCount);
      }
      _applyBellowsExpression(_bellowsGain);
      _updateBellowsVisual(_gainToFrac(_bellowsGain));
    }, BELLOWS_RAMP_STEP_MS);
  }

  // ============================================================
  // Mode selector (Bass / Melody / Both)
  // ============================================================

  function _setAccordionMode(mode) {
    _currentAccordionMode = mode;
    if (_wrapperEl) {
      _wrapperEl.setAttribute('data-accordion-mode', mode);
    }
    if (_modeBtnBassEl) {
      if (mode === ACCORDION_MODE_BASS) {
        _modeBtnBassEl.classList.add('active');
      } else {
        _modeBtnBassEl.classList.remove('active');
      }
    }
    if (_modeBtnMelodyEl) {
      if (mode === ACCORDION_MODE_MELODY) {
        _modeBtnMelodyEl.classList.add('active');
      } else {
        _modeBtnMelodyEl.classList.remove('active');
      }
    }
    if (_modeBtnBothEl) {
      if (mode === ACCORDION_MODE_BOTH) {
        _modeBtnBothEl.classList.add('active');
      } else {
        _modeBtnBothEl.classList.remove('active');
      }
    }
  }

  function _buildModeSelector(topBar) {
    var modeWrap = document.createElement('div');
    modeWrap.className = 'ssli-accordion-mode-selector';

    var bassBtn = document.createElement('button');
    bassBtn.type = 'button';
    bassBtn.className = 'ssli-accordion-mode-btn';
    bassBtn.textContent = SL.t('accordion.mode_bass');
    bassBtn.addEventListener('pointerdown', function(ev) {
      ev.preventDefault();
      _setAccordionMode(ACCORDION_MODE_BASS);
    });
    _modeBtnBassEl = bassBtn;
    modeWrap.appendChild(bassBtn);

    var melodyBtn = document.createElement('button');
    melodyBtn.type = 'button';
    melodyBtn.className = 'ssli-accordion-mode-btn';
    melodyBtn.textContent = SL.t('accordion.mode_melody');
    melodyBtn.addEventListener('pointerdown', function(ev) {
      ev.preventDefault();
      _setAccordionMode(ACCORDION_MODE_MELODY);
    });
    _modeBtnMelodyEl = melodyBtn;
    modeWrap.appendChild(melodyBtn);

    var bothBtn = document.createElement('button');
    bothBtn.type = 'button';
    bothBtn.className = 'ssli-accordion-mode-btn';
    bothBtn.textContent = SL.t('accordion.mode_both');
    bothBtn.addEventListener('pointerdown', function(ev) {
      ev.preventDefault();
      _setAccordionMode(ACCORDION_MODE_BOTH);
    });
    _modeBtnBothEl = bothBtn;
    modeWrap.appendChild(bothBtn);

    topBar.appendChild(modeWrap);
  }

  // ============================================================
  // Side toggle (phone only)
  // ============================================================

  function _setAccordionView(view) {
    _currentAccordionView = view;
    if (_wrapperEl) {
      _wrapperEl.setAttribute('data-accordion-view', view);
    }
    if (_toggleBassBtnEl) {
      var bassActive = (view === ACCORDION_VIEW_BASS);
      if (bassActive) {
        _toggleBassBtnEl.classList.add('active');
      } else {
        _toggleBassBtnEl.classList.remove('active');
      }
    }
    if (_toggleMelodyBtnEl) {
      var melodyActive = (view === ACCORDION_VIEW_MELODY);
      if (melodyActive) {
        _toggleMelodyBtnEl.classList.add('active');
      } else {
        _toggleMelodyBtnEl.classList.remove('active');
      }
    }
  }

  function _buildViewToggle(topBar) {
    var toggleWrap = document.createElement('div');
    toggleWrap.className = 'ssli-accordion-view-toggle';

    var bassBtn = document.createElement('button');
    bassBtn.type = 'button';
    bassBtn.className = 'ssli-accordion-view-toggle-btn';
    bassBtn.textContent = SL.t('accordion.mode_bass');
    bassBtn.addEventListener('pointerdown', function(ev) {
      ev.preventDefault();
      _setAccordionView(ACCORDION_VIEW_BASS);
    });
    _toggleBassBtnEl = bassBtn;
    toggleWrap.appendChild(bassBtn);

    var melodyBtn = document.createElement('button');
    melodyBtn.type = 'button';
    melodyBtn.className = 'ssli-accordion-view-toggle-btn';
    melodyBtn.textContent = SL.t('accordion.mode_melody');
    melodyBtn.addEventListener('pointerdown', function(ev) {
      ev.preventDefault();
      _setAccordionView(ACCORDION_VIEW_MELODY);
    });
    _toggleMelodyBtnEl = melodyBtn;
    toggleWrap.appendChild(melodyBtn);

    topBar.appendChild(toggleWrap);
  }

  // ============================================================
  // Bass: note on/off for Stradella buttons
  // ============================================================

  // Bass note-on computes the chord for a given column (root pitch class)
  // and row (chord type). Row 0 plays a single bass note one octave below;
  // rows 1-3 play major, minor, or dominant-7th chords at the base octave.
  // This mirrors the left-hand technique where the bassist alternates
  // between root notes and chord stabs for oom-pah accompaniment patterns.
  function _bassNoteOn(colIdx, rowIdx, pointerEvent) {
    var key = colIdx + '-' + rowIdx;
    var rootPc = BASS_COL_PITCH_CLASSES[colIdx];
    var intervals = ROW_INTERVALS[rowIdx];
    var isBassRow = (rowIdx === BASS_ROW_BASS);
    var octaveOffset = isBassRow ? BASS_OCTAVE_OFFSET : CHORD_OCTAVE_OFFSET;
    var baseMidi = ((_cachedBaseOctave + OCTAVE_BASE_OFFSET + octaveOffset) * SEMITONES_PER_OCTAVE) + rootPc;

    var velocity = pointerEvent ? SL.velocityFromPressure(pointerEvent, DEFAULT_VELOCITY) : DEFAULT_VELOCITY;
    var midis = [];
    var i;
    for (i = 0; i < intervals.length; i++) {
      var midi = baseMidi + intervals[i];
      midis.push(midi);
      if (_cachedNoteOn) {
        _cachedNoteOn(midi, velocity);
      }
    }
    _bassActiveNotes[key] = midis;

    var btnEl = _bassButtonEls[key];
    if (btnEl) {
      btnEl.classList.add('active');
    }
  }

  function _bassNoteOff(colIdx, rowIdx) {
    var key = colIdx + '-' + rowIdx;
    var midis = _bassActiveNotes[key];
    if (midis) {
      var i;
      for (i = 0; i < midis.length; i++) {
        if (_cachedNoteOff) {
          _cachedNoteOff(midis[i]);
        }
      }
      delete _bassActiveNotes[key];
    }

    var btnEl = _bassButtonEls[key];
    if (btnEl) {
      btnEl.classList.remove('active');
    }
  }

  // ============================================================
  // Bass: document-level pointerup safety net for stuck notes
  // ============================================================
  // Touch interactions can lose their target element (finger slides off,
  // browser captures the event, etc.). A document-level listener ensures
  // any bass notes are released even if the pointerup misses the button.

  function _bassReleasePointer(pointerId) {
    var touchId = (pointerId !== undefined) ? pointerId : 'mouse';
    var activeKey = _bassTouchMap[touchId];
    var hasActive = ((activeKey !== undefined) && (activeKey !== NO_ACTIVE_KEY));
    if (hasActive) {
      var parts = activeKey.split('-');
      var colIdx = parseInt(parts[0], 10);
      var rowIdx = parseInt(parts[1], 10);
      _bassNoteOff(colIdx, rowIdx);
    }
    _bassTouchMap[touchId] = null;
  }

  function _bassPointerUpSafety() {
    var stuckKeys = Object.keys(_bassActiveNotes);
    var k;
    for (k = 0; k < stuckKeys.length; k++) {
      var parts = stuckKeys[k].split('-');
      var colIdx = parseInt(parts[0], 10);
      var rowIdx = parseInt(parts[1], 10);
      _bassNoteOff(colIdx, rowIdx);
    }
    _bassTouchMap = {};
  }

  function _installBassPointerUpSafety() {
    if (!_docBassPointerUpHandler) {
      _docBassPointerUpHandler = function(ev) {
        _bassReleasePointer(ev.pointerId);
      };
      document.addEventListener('pointerup', _docBassPointerUpHandler);
    }
  }

  function _removeBassPointerUpSafety() {
    if (_docBassPointerUpHandler) {
      document.removeEventListener('pointerup', _docBassPointerUpHandler);
      _docBassPointerUpHandler = null;
    }
  }

  // ============================================================
  // Melody: note on/off with glissando support
  // ============================================================
  // Glissando (sliding a finger across multiple buttons) is a common
  // technique on B-system accordions. We track each pointer's last
  // button and seamlessly transition notes as the finger crosses
  // button boundaries -- note-on for the new pitch, note-off for the
  // old, with no gap.

  function _melodyNoteOn(btnIdx, midi, pointerEvent) {
    _melodyActiveNotes[btnIdx] = midi;
    if (_cachedNoteOn) {
      var velocity = pointerEvent ? SL.velocityFromPressure(pointerEvent, DEFAULT_VELOCITY) : DEFAULT_VELOCITY;
      _cachedNoteOn(midi, velocity);
    }

    var btnEl = _melodyButtonEls[btnIdx];
    if (btnEl) {
      btnEl.classList.add('active');
    }
  }

  function _melodyNoteOff(btnIdx) {
    var midi = _melodyActiveNotes[btnIdx];
    var hasNote = ((midi !== undefined) && (midi !== NO_ACTIVE_KEY));
    if (hasNote) {
      if (_cachedNoteOff) {
        _cachedNoteOff(midi);
      }
      delete _melodyActiveNotes[btnIdx];
    }

    var btnEl = _melodyButtonEls[btnIdx];
    if (btnEl) {
      btnEl.classList.remove('active');
    }
  }

  function _melodyHandleGlissando(touchId, newBtnIdx, newMidi, pointerEvent) {
    var prevIdx = _melodyTouchMap[touchId];
    var isSameButton = (prevIdx === newBtnIdx);
    if (!isSameButton) {
      var hasPrev = ((prevIdx !== undefined) && (prevIdx !== NO_ACTIVE_KEY));
      if (hasPrev) {
        _melodyNoteOff(prevIdx);
      }
      _melodyNoteOn(newBtnIdx, newMidi, pointerEvent);
      _melodyTouchMap[touchId] = newBtnIdx;
    }
  }

  // ============================================================
  // Cleanup
  // ============================================================

  function _stopAll() {
    var key;
    for (key in _bassActiveNotes) {
      if (_bassActiveNotes[key]) {
        var midis = _bassActiveNotes[key];
        var i;
        for (i = 0; i < midis.length; i++) {
          if (_cachedNoteOff) {
            _cachedNoteOff(midis[i]);
          }
        }
      }
    }
    _bassActiveNotes = {};

    var btnIdx;
    for (btnIdx in _melodyActiveNotes) {
      var midiVal = _melodyActiveNotes[btnIdx];
      var hasActiveNote = ((midiVal !== NO_ACTIVE_KEY) && (midiVal !== undefined));
      if (hasActiveNote) {
        if (_cachedNoteOff) {
          _cachedNoteOff(midiVal);
        }
      }
    }
    _melodyActiveNotes = {};
    _melodyTouchMap = {};

    _isBellowsDragging = false;
    if (_bellowsRampTimer) {
      clearInterval(_bellowsRampTimer);
      _bellowsRampTimer = null;
    }
    _clearExpression();

    var allBassKeys = Object.keys(_bassButtonEls);
    var bi;
    for (bi = 0; bi < allBassKeys.length; bi++) {
      _bassButtonEls[allBassKeys[bi]].classList.remove('active');
    }
    var allMelodyKeys = Object.keys(_melodyButtonEls);
    var mi;
    for (mi = 0; mi < allMelodyKeys.length; mi++) {
      _melodyButtonEls[allMelodyKeys[mi]].classList.remove('active');
    }
  }

  function _releaseAll() {
    _stopAll();
    _removeBassPointerUpSafety();
    _bassButtonEls = {};
    _melodyButtonEls = {};
    _bellowsIndicatorEl = null;
    _bellowsBarEl = null;
    _bellowsZoneEl = null;
    _toggleBassBtnEl = null;
    _toggleMelodyBtnEl = null;
    _modeBtnBassEl = null;
    _modeBtnMelodyEl = null;
    _modeBtnBothEl = null;
    _wrapperEl = null;
    _currentAccordionView = ACCORDION_VIEW_DEFAULT;
    _currentAccordionMode = ACCORDION_MODE_DEFAULT;
  }

  // ============================================================
  // Build
  // ============================================================

  function _buildAccordion(container, opts) {
    var baseOctave = opts.baseOctave;
    var noteOn = opts.noteOn;
    var noteOff = opts.noteOff;

    _stopAll();

    _cachedNoteOn = noteOn;
    _cachedNoteOff = noteOff;
    _cachedBaseOctave = baseOctave;
    _bassActiveNotes = {};
    _bassButtonEls = {};
    _melodyActiveNotes = {};
    _melodyButtonEls = {};
    _melodyTouchMap = {};
    _isBellowsDragging = false;
    _bellowsGain = BELLOWS_GAIN_DEFAULT;

    var onPhone = _isPhone();
    var bassWidthPct = onPhone ? BASS_WIDTH_PERCENT_PHONE : BASS_WIDTH_PERCENT_DESKTOP;

    var wrapper = document.createElement('div');
    wrapper.className = 'ssli-accordion-wrapper';
    _wrapperEl = wrapper;

    // ---------- Top bar ----------
    var topBar = document.createElement('div');
    topBar.className = 'ssli-accordion-top-bar';

    // Root is now controlled by the global topbar (no local duplicate).

    var titleSpacer = document.createElement('div');
    titleSpacer.className = 'ssli-accordion-top-bar-spacer';
    topBar.appendChild(titleSpacer);

    var titleSpan = document.createElement('span');
    titleSpan.className = 'ssli-accordion-top-bar-title';
    titleSpan.textContent = SL.t('accordion.title');
    topBar.appendChild(titleSpan);

    // Mode selector (Bass / Melody / Both)
    _buildModeSelector(topBar);

    // Side toggle (visible on phone only via CSS)
    _buildViewToggle(topBar);

    wrapper.appendChild(topBar);

    // Set initial mode
    _setAccordionMode(ACCORDION_MODE_DEFAULT);

    // Set initial view for phone layouts
    if (onPhone) {
      _setAccordionView(ACCORDION_VIEW_DEFAULT);
    }

    // ---------- Body ----------
    var body = document.createElement('div');
    body.className = 'ssli-accordion-body';

    // ---- Bass panel ----
    var bassPanel = document.createElement('div');
    bassPanel.className = 'ssli-accordion-bass-panel';
    bassPanel.style.width = bassWidthPct + '%';
    bassPanel.style.flex = '0 0 ' + bassWidthPct + '%';

    var bassHeader = document.createElement('div');
    bassHeader.className = 'ssli-accordion-bass-header';
    bassHeader.textContent = SL.t('accordion.bass_header');
    bassPanel.appendChild(bassHeader);

    var bassGrid = document.createElement('div');
    bassGrid.className = 'ssli-accordion-bass-grid';
    var bassMinBtnSize = onPhone ? BASS_BUTTON_MIN_SIZE_PHONE : BASS_BUTTON_MIN_SIZE_DESKTOP;
    bassGrid.style.gridTemplateColumns = 'repeat(' + BASS_COLS + ', 1fr)';
    bassGrid.style.gridTemplateRows = 'repeat(' + BASS_ROWS + ', 1fr)';

    var row, col;
    for (row = 0; row < BASS_ROWS; row++) {
      for (col = 0; col < BASS_COLS; col++) {
        var bassBtn = document.createElement('button');
        bassBtn.type = 'button';
        bassBtn.className = 'ssli-accordion-bass-btn ' + BASS_ROW_CSS[row];
        var bKey = col + '-' + row;
        bassBtn.setAttribute('data-col', String(col));
        bassBtn.setAttribute('data-row', String(row));

        var bLabel;
        if (row === BASS_ROW_BASS) {
          bLabel = BASS_COL_LABELS[col];
        } else if (row === BASS_ROW_MAJOR) {
          bLabel = BASS_COL_LABELS[col];
        } else if (row === BASS_ROW_MINOR) {
          bLabel = BASS_COL_LABELS[col] + 'm';
        } else {
          bLabel = BASS_COL_LABELS[col] + '7';
        }
        bassBtn.textContent = bLabel;

        _bassButtonEls[bKey] = bassBtn;

        (function(capturedCol, capturedRow) {
          var capturedKey = capturedCol + '-' + capturedRow;
          bassBtn.addEventListener('pointerdown', function(ev) {
            ev.preventDefault();
            var touchId = (ev.pointerId !== undefined) ? ev.pointerId : 'mouse';
            _bassTouchMap[touchId] = capturedKey;
            _bassNoteOn(capturedCol, capturedRow, ev);
            if (bassBtn.setPointerCapture && (typeof ev.pointerId !== 'undefined')) {
              try { bassBtn.setPointerCapture(ev.pointerId); } catch (err) { /* pointer capture is best-effort */ }
            }
          });
          bassBtn.addEventListener('pointerup', function(ev) {
            ev.preventDefault();
            _bassReleasePointer(ev.pointerId);
          });
          bassBtn.addEventListener('pointercancel', function(ev) {
            _bassReleasePointer(ev.pointerId);
          });
        })(col, row);

        bassGrid.appendChild(bassBtn);
      }
    }

    bassPanel.appendChild(bassGrid);
    body.appendChild(bassPanel);

    // ---- Bellows panel ----
    var bellows = document.createElement('div');
    bellows.className = 'ssli-accordion-bellows';
    bellows.style.width = BELLOWS_WIDTH_PERCENT + '%';
    bellows.style.flex = '0 0 ' + BELLOWS_WIDTH_PERCENT + '%';

    var bellowsHeader = document.createElement('div');
    bellowsHeader.className = 'ssli-accordion-bellows-header';
    bellowsHeader.textContent = SL.t('accordion.bellows_header');
    bellows.appendChild(bellowsHeader);

    var defaultFrac = _gainToFrac(BELLOWS_GAIN_DEFAULT);

    var bellowsBar = document.createElement('div');
    bellowsBar.className = 'ssli-accordion-bellows-bar';
    bellowsBar.style.height = (defaultFrac * 100) + '%';
    bellows.appendChild(bellowsBar);
    _bellowsBarEl = bellowsBar;

    var bellowsDragAffordance = document.createElement('div');
    bellowsDragAffordance.className = 'ssli-accordion-bellows-drag-affordance';
    bellows.appendChild(bellowsDragAffordance);

    var bellowsIndicator = document.createElement('div');
    bellowsIndicator.className = 'ssli-accordion-bellows-indicator';
    bellowsIndicator.style.top = ((1 - defaultFrac) * 100) + '%';
    bellows.appendChild(bellowsIndicator);
    _bellowsIndicatorEl = bellowsIndicator;
    _bellowsZoneEl = bellows;

    function _bellowsUpdateFromPointer(e) {
      var rect = bellows.getBoundingClientRect();
      var relY = e.clientY - rect.top;
      var frac = 1 - (relY / rect.height);
      if (frac < 0) { frac = 0; }
      if (frac > 1) { frac = 1; }
      _bellowsGain = BELLOWS_GAIN_MIN + (frac * (BELLOWS_GAIN_MAX - BELLOWS_GAIN_MIN));
      _applyBellowsExpression(_bellowsGain);
      _updateBellowsVisual(frac);
    }

    bellows.addEventListener('pointerdown', function(e) {
      e.preventDefault();
      var hasCapture = (bellows.setPointerCapture && (typeof e.pointerId !== 'undefined'));
      if (hasCapture) {
        try { bellows.setPointerCapture(e.pointerId); } catch (err) { /* pointer capture is best-effort */ }
      }
      _isBellowsDragging = true;
      if (_bellowsRampTimer) {
        clearInterval(_bellowsRampTimer);
        _bellowsRampTimer = null;
      }
      _bellowsUpdateFromPointer(e);
    });

    bellows.addEventListener('pointermove', function(e) {
      if (_isBellowsDragging) {
        _bellowsUpdateFromPointer(e);
      }
    });

    bellows.addEventListener('pointerup', function() {
      _isBellowsDragging = false;
      _bellowsStartReturnRamp();
    });

    bellows.addEventListener('pointercancel', function() {
      _isBellowsDragging = false;
      _bellowsStartReturnRamp();
    });

    body.appendChild(bellows);

    // ---- Melody panel ----
    var melodyPanel = document.createElement('div');
    melodyPanel.className = 'ssli-accordion-melody-panel';

    var melodyHeader = document.createElement('div');
    melodyHeader.className = 'ssli-accordion-melody-header';
    melodyHeader.textContent = SL.t('accordion.melody_header');
    melodyPanel.appendChild(melodyHeader);

    var melodyRowsContainer = document.createElement('div');
    melodyRowsContainer.className = 'ssli-accordion-melody-rows';

    var melodyBaseMidi = ((_cachedBaseOctave + OCTAVE_BASE_OFFSET) * SEMITONES_PER_OCTAVE);
    var btnIndex = 0;
    var melodyRowIdx;

    for (melodyRowIdx = 0; melodyRowIdx < MELODY_ROWS; melodyRowIdx++) {
      var melodyRow = document.createElement('div');
      var rowOffsetClass = 'offset-' + melodyRowIdx;
      melodyRow.className = 'ssli-accordion-melody-row ' + rowOffsetClass;
      melodyRow.style.display = 'grid';
      melodyRow.style.gridTemplateColumns = 'repeat(' + MELODY_NOTES_PER_ROW + ', 1fr)';
      melodyRow.style.gap = MELODY_BUTTON_GAP_PX + 'px';

      var rowStartSemitone = MELODY_ROW_OFFSETS[melodyRowIdx];
      var noteIdx;

      for (noteIdx = 0; noteIdx < MELODY_NOTES_PER_ROW; noteIdx++) {
        var semitone = rowStartSemitone + (noteIdx * MELODY_STEP_SEMITONES);
        var midi = melodyBaseMidi + semitone;
        var melodyBtn = document.createElement('button');
        melodyBtn.type = 'button';
        melodyBtn.className = 'ssli-accordion-melody-btn';
        melodyBtn.textContent = _midiToNoteName(midi);
        melodyBtn.setAttribute('data-midi', String(midi));
        melodyBtn.setAttribute('data-btn-index', String(btnIndex));

        _melodyButtonEls[btnIndex] = melodyBtn;

        (function(capturedIdx, capturedMidi) {
          melodyBtn.addEventListener('pointerdown', function(ev) {
            ev.preventDefault();
            var touchId = (ev.pointerId !== undefined) ? ev.pointerId : 'mouse';
            _melodyTouchMap[touchId] = capturedIdx;
            _melodyNoteOn(capturedIdx, capturedMidi, ev);
            if (melodyBtn.setPointerCapture && (typeof ev.pointerId !== 'undefined')) {
              try { melodyBtn.setPointerCapture(ev.pointerId); } catch (err) { /* pointer capture is best-effort */ }
            }
          });
          melodyBtn.addEventListener('pointermove', function(ev) {
            var touchId = (ev.pointerId !== undefined) ? ev.pointerId : 'mouse';
            var elemUnder = document.elementFromPoint(ev.clientX, ev.clientY);
            if (elemUnder) {
              var newIdx = elemUnder.getAttribute('data-btn-index');
              var newMidi = elemUnder.getAttribute('data-midi');
              var isValidTarget = ((newIdx !== NO_ATTR) && (newMidi !== NO_ATTR));
              if (isValidTarget) {
                _melodyHandleGlissando(touchId, parseInt(newIdx, 10), parseInt(newMidi, 10), ev);
              }
            }
          });
          melodyBtn.addEventListener('pointerup', function(ev) {
            ev.preventDefault();
            var touchId = (ev.pointerId !== undefined) ? ev.pointerId : 'mouse';
            var activeIdx = _melodyTouchMap[touchId];
            var hasActive = ((activeIdx !== undefined) && (activeIdx !== NO_ACTIVE_KEY));
            if (hasActive) {
              _melodyNoteOff(activeIdx);
            }
            _melodyTouchMap[touchId] = null;
          });
          melodyBtn.addEventListener('pointercancel', function(ev) {
            var touchId = (ev.pointerId !== undefined) ? ev.pointerId : 'mouse';
            var activeIdx = _melodyTouchMap[touchId];
            var hasActive = ((activeIdx !== undefined) && (activeIdx !== NO_ACTIVE_KEY));
            if (hasActive) {
              _melodyNoteOff(activeIdx);
            }
            _melodyTouchMap[touchId] = null;
          });
        })(btnIndex, midi);

        melodyRow.appendChild(melodyBtn);
        btnIndex++;
      }

      melodyRowsContainer.appendChild(melodyRow);
    }

    melodyPanel.appendChild(melodyRowsContainer);
    body.appendChild(melodyPanel);

    wrapper.appendChild(body);
    container.appendChild(wrapper);

    // Apply accordion-specific reed and body resonance settings
    if (SL.audio && SL.audio.setReedSettings) {
      var currentInstId = (SL.audio.getCurrentInstrument) ? SL.audio.getCurrentInstrument() : 0;
      SL.audio.setReedSettings(currentInstId, {
        reedType: ACCORDION_REED_TYPE,
        reedStiffness: ACCORDION_REED_STIFFNESS,
        vibratoRate: ACCORDION_VIBRATO_RATE,
        vibratoDepth: ACCORDION_VIBRATO_DEPTH,
        breathNoise: ACCORDION_BREATH_NOISE,
        embouchurePressure: ACCORDION_EMBOUCHURE_PRESSURE
      });
    }
    if (SL.audio && SL.audio.setBodyResonanceSettings) {
      var bodyInstId = (SL.audio.getCurrentInstrument) ? SL.audio.getCurrentInstrument() : 0;
      SL.audio.setBodyResonanceSettings(bodyInstId, {
        bodyType: ACCORDION_BODY_TYPE,
        resonanceAmount: ACCORDION_BODY_RESONANCE_AMOUNT,
        brightness: ACCORDION_BODY_BRIGHTNESS,
        bodySize: ACCORDION_BODY_SIZE
      });
    }

    _applyBellowsExpression(BELLOWS_GAIN_DEFAULT);

    // Install document-level safety handler for stuck bass notes
    _installBassPointerUpSafety();
  }

  // ============================================================
  // Register
  // ============================================================

  if (!SL.controllers) { SL.controllers = {}; }
  SL.controllers.accordion = {
    build: function(container, opts) {
      _buildAccordion(container, opts);
    },
    release: _releaseAll
  };

  // ============================================================
  // Panic hook
  // ============================================================

  if (SL.PanicRegistry && SL.PanicRegistry.register) {
    SL.PanicRegistry.register(
      'voices',
      'accordion.notes',
      function() { _stopAll(); },
      function() {
        var bassKeys = Object.keys(_bassActiveNotes);
        var hasBassNotes = false;
        var bk;
        for (bk = 0; bk < bassKeys.length; bk++) {
          if (_bassActiveNotes[bassKeys[bk]]) {
            hasBassNotes = true;
          }
        }
        var melodyKeys = Object.keys(_melodyActiveNotes);
        var hasMelodyNotes = false;
        var mk;
        for (mk = 0; mk < melodyKeys.length; mk++) {
          var mVal = _melodyActiveNotes[melodyKeys[mk]];
          var noteActive = ((mVal !== NO_ACTIVE_KEY) && (mVal !== undefined));
          if (noteActive) {
            hasMelodyNotes = true;
          }
        }
        var hasActivity = (hasBassNotes || hasMelodyNotes || _isBellowsDragging);
        var statusMsg = null;
        if (hasActivity) {
          statusMsg = 'accordion active';
        }
        return statusMsg;
      }
    );
  }

})();
