// SSLI Controller: Multistring (fingerboard pitch strips + bow/pluck zones)
// Left 60%: pitch fingerboard (continuous pitch via pitch bend)
// Right 40%: bow/pluck zone (hold = bow, tap = pluck, vertical = dynamics)
// ES5 compatible (var, no arrow functions, no template literals)

(function() {
  'use strict';

  var SL = window.SynthLab;
  var NOTES = (SL && SL.NOTES) ? SL.NOTES : ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

  // ============================================================
  // Constants
  // ============================================================

  var SEMITONES_PER_OCTAVE = 12;
  var DEFAULT_BASE_OCTAVE = 3;
  var MIN_OCTAVE = 1;
  var MAX_OCTAVE = 6;

  // Layout proportions
  var PITCH_ZONE_FRACTION = 0.60;
  var BOW_ZONE_FRACTION = 0.40;

  // Pitch range per string (semitones spanned by the fingerboard strip)
  var FINGERBOARD_SEMITONE_RANGE = 12;

  // Velocity / dynamics
  var VELOCITY_MIN = 20;
  var VELOCITY_MAX = 127;
  var VELOCITY_DEFAULT = 80;

  // Pluck detection: if touch in bow zone < this ms, it's a pluck not a bow
  var PLUCK_THRESHOLD_MS = 200;
  var PLUCK_DURATION_MS = 400;

  // Bow pressure mapping from vertical drag in bow zone
  var BOW_PRESSURE_MIN = 0.2;
  var BOW_PRESSURE_MAX = 1.0;

  // Pitch bend: cents per semitone
  var CENTS_PER_SEMITONE = 100;

  // Note marker display
  var NOTE_MARKER_COUNT = 13; // 0..12 semitones inclusive (octave + 1 for the end marker)

  // Wire color classes per string index (cycles for >6 strings)
  var WIRE_COLOR_CLASSES = ['bowed-wire-gold', 'bowed-wire-copper', 'bowed-wire-silver', 'bowed-wire-bronze', 'bowed-wire-brass', 'bowed-wire-steel'];

  // Pluck ADSR envelope (percussive character)
  var PLUCK_ATTACK_MS = 5;
  var PLUCK_DECAY_MS = 200;
  var PLUCK_SUSTAIN_LEVEL = 0;
  var PLUCK_RELEASE_MS = 100;

  // Stuck-note safety: max bow duration before auto-release (ms)
  var STALE_BOW_TIMEOUT_MS = 30000;
  var STALE_BOW_CHECK_INTERVAL_MS = 5000;

  // Liveness check: verify touch pointers still exist (ms)
  var LIVENESS_CHECK_INTERVAL_MS = 500;

  // Note label minimum font size (px)
  var NOTE_LABEL_MIN_FONT_PX = 12;
  var NOTE_LABEL_MIN_OPACITY = 0.85;

  // Visual
  var VIBRATE_ANIMATION_DURATION_MS = 150;

  // Cutoff mapping from bow pressure (Y-axis timbre)
  var CUTOFF_MIN_HZ = 300;
  var CUTOFF_MAX_HZ = 6000;

  // Bow speed expression (horizontal movement)
  var BOW_SPEED_GAIN_MIN = 0.1;
  var BOW_SPEED_GAIN_MAX = 1.0;
  var BOW_SPEED_PIXELS_FOR_MAX = 80;   // horizontal px/frame for max expression
  var BOW_SPEED_SMOOTHING = 0.3;       // EMA smoothing factor (0=sluggish, 1=instant)
  var BOW_SPEED_CURVE_EXPONENT = 0.6;  // <1 = concave curve (responsive at low speed)

  // Bow position expression (X within bow zone = sul tasto to sul ponticello)
  var BOW_POSITION_TASTO_CUTOFF_HZ = 200;    // near fingerboard = mellow
  var BOW_POSITION_PONTICELLO_CUTOFF_HZ = 8000; // near bridge = bright
  var BOW_POSITION_CURVE_EXPONENT = 1.4;      // >1 = convex (more mellow in middle)

  // Bow pressure Y-axis curve
  var BOW_PRESSURE_CURVE_EXPONENT = 0.7;      // <1 = responsive at light touch

  // Tuning presets (absolute MIDI note numbers, lowest to highest)
  var MULTISTRING_TUNING_PRESETS = [
    { midi: [55, 62, 69, 76], label: 'Violin',              strings: 4 },
    { midi: [48, 55, 62, 69], label: 'Viola',               strings: 4 },
    { midi: [36, 43, 50, 57], label: 'Cello',               strings: 4 },
    { midi: [28, 33, 38, 43], label: 'Double Bass',         strings: 4 },
    { midi: [23, 28, 33, 38, 43], label: 'Double Bass 5-String', strings: 5 },
    { midi: [57, 64, 69, 76], label: 'Fiddle Cross (AEAE)', strings: 4 },
    { midi: [37, 44, 51, 58], label: 'Cello Solo Tuning',   strings: 4 },
    { midi: [38, 43, 48, 52, 57, 62], label: 'Viola da Gamba', strings: 6 },
    { midi: [62, 69],         label: 'Erhu',                 strings: 2 },
    { midi: [57, 62, 69, 76], label: 'Hardanger Fiddle',    strings: 4 }
  ];
  var MULTISTRING_TUNING_NAMES_COUNT = MULTISTRING_TUNING_PRESETS.length;

  var NOTE_NAME_COUNT = 12;

  // ============================================================
  // State
  // ============================================================

  var _currentTuningIdx = 0;
  var _baseOctave = DEFAULT_BASE_OCTAVE;
  var _autoExciteMode = false; // When true, touching pitch zone auto-triggers note
  var _pluckMode = false;      // When true, bow zone fires instant plucks instead of sustained bow
  var _stringMidis = [];       // base MIDI note per string (open string)
  var _stringEls = [];         // DOM lane elements per string
  var _wrapperEl = null;
  var _container = null;
  var _noteOnFn = null;
  var _noteOffFn = null;
  var _applyPitchBendFn = null;
  var _resetPitchBendFn = null;

  // Per-string active state
  // Each string can have at most one pitch touch and one bow touch
  // _stringState[stringIdx] = { pitchTouchId, bowTouchId, currentMidi, currentBendCents, bowing, bowStartTime, bowStartY, lastBowY, lastBowX, smoothedSpeed, velocity }
  var _stringState = [];

  // Map touchId -> { zone: 'pitch'|'bow', stringIdx: number }
  var _touchMap = {};
  var _mouseZone = null; // { zone, stringIdx } or null

  // Pluck ADSR save/restore state
  var _savedPluckAdsr = null;        // { a, d, s, r } or null
  var _savedPluckAdsrInst = -1;      // instrument index that was modified

  // Document-level safety handlers (stored for cleanup)
  var _docPointerUpHandler = null;
  var _docPointerCancelHandler = null;
  var _docTouchEndHandler = null;
  var _docTouchCancelHandler = null;

  // Stale bow cleanup timer
  var _staleBowTimerId = null;

  // Liveness check timer
  var _livenessTimerId = null;

  // ============================================================
  // Helpers
  // ============================================================

  function _midiToName(midi) {
    var pc = midi % NOTE_NAME_COUNT;
    var oct = Math.floor(midi / NOTE_NAME_COUNT) - 1;
    return NOTES[pc] + oct;
  }

  function _clamp(val, lo, hi) {
    if (val < lo) { return lo; }
    if (val > hi) { return hi; }
    return val;
  }

  function _computeStringMidis() {
    var preset = MULTISTRING_TUNING_PRESETS[_currentTuningIdx];
    var octaveOffset = (_baseOctave - DEFAULT_BASE_OCTAVE) * SEMITONES_PER_OCTAVE;
    var midis = [];
    var si;
    for (si = 0; si < preset.strings; si++) {
      midis.push(preset.midi[si] + octaveOffset);
    }
    _stringMidis = midis;
    return midis;
  }

  function _initStringState() {
    _stringState = [];
    var si;
    for (si = 0; si < _stringMidis.length; si++) {
      _stringState.push({
        pitchTouchId: null,
        bowTouchId: null,
        currentMidi: _stringMidis[si],
        currentBendCents: 0,
        bowing: false,
        bowStartTime: 0,
        bowStartY: 0,
        lastBowY: 0,
        lastBowX: 0,
        smoothedSpeed: 0,
        velocity: VELOCITY_DEFAULT
      });
    }
  }

  // Given an X position in the pitch zone, compute the fractional semitone offset
  function _pitchFracFromX(x, pitchZoneEl) {
    var rect = pitchZoneEl.getBoundingClientRect();
    var relX = x - rect.left;
    var frac = _clamp(relX / rect.width, 0, 1);
    return frac * FINGERBOARD_SEMITONE_RANGE;
  }

  // Given a Y position in the bow zone, compute bow pressure (0..1)
  function _bowPressureFromY(y, bowZoneEl) {
    var rect = bowZoneEl.getBoundingClientRect();
    var relY = y - rect.top;
    var frac = _clamp(relY / rect.height, 0, 1);
    // Top = light pressure, bottom = heavy pressure
    return BOW_PRESSURE_MIN + frac * (BOW_PRESSURE_MAX - BOW_PRESSURE_MIN);
  }

  // ============================================================
  // Visual feedback
  // ============================================================

  function _setStringVisual(stringIdx, active, velocity) {
    var el = _stringEls[stringIdx];
    if (!el) { return; }
    var wire = el.querySelector('.bowed-string-wire');
    var glow = el.querySelector('.bowed-string-glow');
    var label = el.querySelector('.bowed-string-label');

    if (active) {
      el.classList.add('bowing');
      if (wire) {
        var intensity = _clamp(velocity / VELOCITY_MAX, 0.3, 1);
        wire.style.animationDuration = Math.round(VIBRATE_ANIMATION_DURATION_MS / intensity) + 'ms';
      }
      if (glow) {
        glow.style.opacity = String(_clamp(velocity / VELOCITY_MAX, 0.4, 1));
      }
      if (label) {
        label.classList.add('active');
      }
    } else {
      el.classList.remove('bowing');
      if (wire) {
        wire.style.animationDuration = '';
      }
      if (glow) {
        glow.style.opacity = '0';
      }
      if (label) {
        label.classList.remove('active');
      }
    }
  }

  function _updatePitchIndicator(stringIdx, semitoneFrac) {
    var el = _stringEls[stringIdx];
    if (!el) { return; }
    var indicator = el.querySelector('.bowed-pitch-indicator');
    if (!indicator) { return; }
    var pitchZone = el.querySelector('.bowed-pitch-zone');
    if (!pitchZone) { return; }
    var frac = _clamp(semitoneFrac / FINGERBOARD_SEMITONE_RANGE, 0, 1);
    indicator.style.left = (frac * 100) + '%';
    indicator.style.display = 'block';
  }

  function _hidePitchIndicator(stringIdx) {
    var el = _stringEls[stringIdx];
    if (!el) { return; }
    var indicator = el.querySelector('.bowed-pitch-indicator');
    if (indicator) {
      indicator.style.display = 'none';
    }
  }

  function _updateFingerLabel(stringIdx, midi, bendCents) {
    var el = _stringEls[stringIdx];
    if (!el) { return; }
    var fingerLabel = el.querySelector('.bowed-finger-note');
    if (!fingerLabel) { return; }
    var totalCents = (midi * CENTS_PER_SEMITONE) + bendCents;
    var nearestMidi = Math.round(totalCents / CENTS_PER_SEMITONE);
    var centsOff = totalCents - (nearestMidi * CENTS_PER_SEMITONE);
    var name = _midiToName(nearestMidi);
    var centsStr = '';
    if (Math.abs(centsOff) >= 5) {
      centsStr = (centsOff > 0) ? ' +' + Math.round(centsOff) : ' ' + Math.round(centsOff);
    }
    fingerLabel.textContent = name + centsStr;
    fingerLabel.style.display = 'block';
    fingerLabel.style.opacity = '1';
  }

  function _hideFingerLabel(stringIdx) {
    var el = _stringEls[stringIdx];
    if (!el) { return; }
    var fingerLabel = el.querySelector('.bowed-finger-note');
    if (fingerLabel) {
      fingerLabel.style.display = 'none';
    }
  }

  // Strum flash duration (ms)
  var STRUM_FLASH_DURATION_MS = 200;

  function _flashStrumVisual(stringIdx) {
    var el = _stringEls[stringIdx];
    if (!el) { return; }
    el.classList.add('bowed-strum-flash');
    setTimeout(function() {
      if (el) {
        el.classList.remove('bowed-strum-flash');
      }
    }, STRUM_FLASH_DURATION_MS);
  }

  function _updateBowPressureVisual(stringIdx, pressure) {
    var el = _stringEls[stringIdx];
    if (!el) { return; }
    var bowZone = el.querySelector('.bowed-bow-zone');
    if (!bowZone) { return; }
    var normalizedPressure = _clamp((pressure - BOW_PRESSURE_MIN) / (BOW_PRESSURE_MAX - BOW_PRESSURE_MIN), 0, 1);
    bowZone.style.backgroundColor = 'rgba(255, 200, 100, ' + (0.05 + normalizedPressure * 0.2) + ')';
  }

  function _resetBowZoneVisual(stringIdx) {
    var el = _stringEls[stringIdx];
    if (!el) { return; }
    var bowZone = el.querySelector('.bowed-bow-zone');
    if (bowZone) {
      bowZone.style.backgroundColor = '';
    }
  }

  // ============================================================
  // Audio: pitch + excitation
  // ============================================================

  function _setPitch(stringIdx, semitoneFrac) {
    var state = _stringState[stringIdx];
    if (!state) { return; }
    var baseMidi = _stringMidis[stringIdx];
    var wholeSemitones = Math.floor(semitoneFrac);
    var fractionalCents = (semitoneFrac - wholeSemitones) * CENTS_PER_SEMITONE;
    var newMidi = baseMidi + wholeSemitones;
    var oldMidi = state.currentMidi;
    var midiChanged = (newMidi !== oldMidi);

    state.currentMidi = newMidi;
    state.currentBendCents = fractionalCents;

    // If bowing, update the sounding note
    if (state.bowing) {
      if (midiChanged) {
        // Stop old, start new at same velocity
        if (_noteOffFn) { _noteOffFn(oldMidi); }
        if (_noteOnFn) { _noteOnFn(newMidi, state.velocity); }
      }
      // Apply pitch bend for the fractional part
      if (_applyPitchBendFn) {
        _applyPitchBendFn(fractionalCents);
      }
    }

    _updatePitchIndicator(stringIdx, semitoneFrac);
    _updateFingerLabel(stringIdx, newMidi, fractionalCents);
  }

  function _startBow(stringIdx, velocity) {
    var state = _stringState[stringIdx];
    if (!state) { return; }

    // Guard: if any OTHER string already claims this touch id, force-release it.
    // This prevents orphaned bowing state when strum remapping races with startBow.
    var guardIdx;
    var incomingId = state.bowTouchId;
    if (incomingId !== null) {
      for (guardIdx = 0; guardIdx < _stringState.length; guardIdx++) {
        if ((guardIdx !== stringIdx) && (_stringState[guardIdx].bowTouchId === incomingId)) {
          _stopBow(guardIdx);
          _stringState[guardIdx].bowTouchId = null;
        }
      }
    }

    state.bowing = true;
    state.velocity = velocity;

    if (_noteOnFn) {
      _noteOnFn(state.currentMidi, velocity);
    }
    // Apply any existing pitch bend from fingerboard position
    if (_applyPitchBendFn && (state.currentBendCents !== 0)) {
      _applyPitchBendFn(state.currentBendCents);
    }
    _setStringVisual(stringIdx, true, velocity);
  }

  function _updateBowDynamics(stringIdx, pressure, x, bowZoneEl) {
    var state = _stringState[stringIdx];
    if (!state) { return; }

    // --- Bow speed from horizontal movement (deltaX) ---
    var deltaX = 0;
    if (state.lastBowX !== 0) {
      deltaX = Math.abs(x - state.lastBowX);
    }
    state.lastBowX = x;

    // Normalize speed: 0..1 range based on pixels moved per frame
    var rawSpeedNorm = _clamp(deltaX / BOW_SPEED_PIXELS_FOR_MAX, 0, 1);
    // Apply concave curve for organic feel (responsive at low speed)
    var curvedSpeed = Math.pow(rawSpeedNorm, BOW_SPEED_CURVE_EXPONENT);
    // Smooth with EMA to avoid jitter
    state.smoothedSpeed = state.smoothedSpeed + BOW_SPEED_SMOOTHING * (curvedSpeed - state.smoothedSpeed);

    // Map smoothed speed to expression gain
    var expressionGain = BOW_SPEED_GAIN_MIN + state.smoothedSpeed * (BOW_SPEED_GAIN_MAX - BOW_SPEED_GAIN_MIN);
    if (SL.audio && SL.audio.setExpressionGain) {
      SL.audio.setExpressionGain(expressionGain);
    }

    // --- Bow pressure from Y-axis (timbre / filter cutoff) ---
    // Apply organic curve to pressure
    var curvedPressure = Math.pow(pressure, BOW_PRESSURE_CURVE_EXPONENT);
    var pressureCutoff = CUTOFF_MIN_HZ + curvedPressure * (CUTOFF_MAX_HZ - CUTOFF_MIN_HZ);

    // --- Bow position from X within bow zone (sul tasto vs sul ponticello) ---
    var positionCutoff = 0;
    if (bowZoneEl) {
      var bowRect = bowZoneEl.getBoundingClientRect();
      var relBowX = _clamp((x - bowRect.left) / bowRect.width, 0, 1);
      // Left of bow zone = near fingerboard (tasto), right = near bridge (ponticello)
      var curvedPosition = Math.pow(relBowX, BOW_POSITION_CURVE_EXPONENT);
      positionCutoff = BOW_POSITION_TASTO_CUTOFF_HZ + curvedPosition * (BOW_POSITION_PONTICELLO_CUTOFF_HZ - BOW_POSITION_TASTO_CUTOFF_HZ);
    }

    // Combine pressure cutoff and position cutoff (blend: position dominates, pressure modulates)
    var combinedCutoff = (positionCutoff > 0) ? (positionCutoff * 0.6 + pressureCutoff * 0.4) : pressureCutoff;
    if (SL.audio && SL.audio.setExpressiveCutoff) {
      SL.audio.setExpressiveCutoff(combinedCutoff);
    }

    // Velocity from speed (faster bow = louder) blended with pressure
    var speedVelocity = VELOCITY_MIN + state.smoothedSpeed * (VELOCITY_MAX - VELOCITY_MIN);
    var pressureVelocity = VELOCITY_MIN + curvedPressure * (VELOCITY_MAX - VELOCITY_MIN);
    var blendedVelocity = Math.round(speedVelocity * 0.7 + pressureVelocity * 0.3);
    state.velocity = _clamp(blendedVelocity, VELOCITY_MIN, VELOCITY_MAX);

    _setStringVisual(stringIdx, true, state.velocity);
    _updateBowPressureVisual(stringIdx, pressure);
  }

  function _stopBow(stringIdx) {
    var state = _stringState[stringIdx];
    if (!state) { return; }
    state.bowing = false;

    if (_noteOffFn) {
      _noteOffFn(state.currentMidi);
    }
    if (_resetPitchBendFn) {
      _resetPitchBendFn();
    }
    _setStringVisual(stringIdx, false, 0);
    _resetBowZoneVisual(stringIdx);

    // Clear cutoff if no strings active
    var anyActive = false;
    var si;
    for (si = 0; si < _stringState.length; si++) {
      if (_stringState[si].bowing) {
        anyActive = true;
        break;
      }
    }
    if (!anyActive) {
      if (SL.audio && SL.audio.clearExpressiveCutoff) {
        SL.audio.clearExpressiveCutoff();
      }
      if (SL.audio && SL.audio.setExpressionGain) {
        SL.audio.setExpressionGain(1.0);
      }
    }
  }

  // ---- Pluck ADSR save/restore ----

  function _setPluckEnvelope() {
    if (SL.audio && SL.audio.getInstruments && SL.audio.getCurrentInstrument) {
      var instId = SL.audio.getCurrentInstrument();
      var insts = SL.audio.getInstruments();
      var inst = insts ? insts[instId] : null;
      if (inst && inst.settings && inst.settings.adsr) {
        var adsr = inst.settings.adsr;
        _savedPluckAdsrInst = instId;
        _savedPluckAdsr = { a: adsr.a, d: adsr.d, s: adsr.s, r: adsr.r };
        adsr.a = PLUCK_ATTACK_MS;
        adsr.d = PLUCK_DECAY_MS;
        adsr.s = PLUCK_SUSTAIN_LEVEL;
        adsr.r = PLUCK_RELEASE_MS;
      }
    }
  }

  function _restorePluckEnvelope() {
    if ((_savedPluckAdsr !== null) && (_savedPluckAdsrInst >= 0)
        && SL.audio && SL.audio.getInstruments) {
      var insts = SL.audio.getInstruments();
      var inst = insts ? insts[_savedPluckAdsrInst] : null;
      if (inst && inst.settings && inst.settings.adsr) {
        var adsr = inst.settings.adsr;
        adsr.a = _savedPluckAdsr.a;
        adsr.d = _savedPluckAdsr.d;
        adsr.s = _savedPluckAdsr.s;
        adsr.r = _savedPluckAdsr.r;
      }
      _savedPluckAdsr = null;
      _savedPluckAdsrInst = -1;
    }
  }

  // ---- Stale bow cleanup ----

  function _checkStaleBows() {
    var now = Date.now();
    var si;
    for (si = 0; si < _stringState.length; si++) {
      var state = _stringState[si];
      if (state.bowing && (state.bowStartTime > 0)) {
        var elapsed = now - state.bowStartTime;
        if (elapsed > STALE_BOW_TIMEOUT_MS) {
          _stopBow(si);
          state.bowTouchId = null;
        }
      }
    }
  }

  function _startStaleBowTimer() {
    if (!_staleBowTimerId) {
      _staleBowTimerId = setInterval(_checkStaleBows, STALE_BOW_CHECK_INTERVAL_MS);
    }
  }

  function _stopStaleBowTimer() {
    if (_staleBowTimerId) {
      clearInterval(_staleBowTimerId);
      _staleBowTimerId = null;
    }
  }

  // ---- Same-string collision prevention ----

  // Find which string index already has the given zone occupied by an active touch.
  // Returns the existing touch/mouse id if the string+zone is taken, or null if free.
  function _findExistingTouchOnStringZone(stringIdx, zone) {
    var state = _stringState[stringIdx];
    if (!state) { return null; }
    var existingId = null;
    if (zone === 'pitch') {
      existingId = state.pitchTouchId;
    } else {
      existingId = state.bowTouchId;
    }
    return existingId;
  }

  // Force-release an existing touch by id (cleans up _touchMap/_mouseZone and string state)
  function _forceReleaseTouch(existingId) {
    _onPointerEnd(existingId);
  }

  // ---- Liveness check: detect orphaned touches ----

  function _getActiveTouchIds() {
    // Collect all touch IDs that the browser reports as still active
    // We cannot query this directly, but we can check on touchstart/touchmove
    // events. Instead, we use a snapshot approach: if a pointer in _touchMap
    // is not 'mouse' and exceeds navigator.maxTouchPoints, it's suspicious.
    // More reliably: we look at the _touchMap entries and verify each string
    // state is consistent.
    var orphanedIds = [];
    var key;
    for (key in _touchMap) {
      if (_touchMap.hasOwnProperty(key)) {
        var info = _touchMap[key];
        var stringIdx = info.stringIdx;
        var zone = info.zone;
        var state = _stringState[stringIdx];
        var isOrphaned = false;

        // If the string state no longer references this touch, it's orphaned
        if (!state) {
          isOrphaned = true;
        } else {
          if (zone === 'pitch') {
            var pitchIdMatches = (state.pitchTouchId === key) || (state.pitchTouchId === parseInt(key, 10));
            if (!pitchIdMatches) {
              isOrphaned = true;
            }
          } else {
            var bowIdMatches = (state.bowTouchId === key) || (state.bowTouchId === parseInt(key, 10));
            if (!bowIdMatches && !state.bowing) {
              // Touch in map but string not bowing and not referencing this touch
              isOrphaned = true;
            }
          }
        }

        if (isOrphaned) {
          orphanedIds.push(key);
        }
      }
    }
    return orphanedIds;
  }

  function _checkLiveness() {
    // Check for orphaned touches in _touchMap
    var orphaned = _getActiveTouchIds();
    var oi;
    for (oi = 0; oi < orphaned.length; oi++) {
      _onPointerEnd(orphaned[oi]);
    }

    // Check for strings that claim to be bowing but have no associated touch
    var si;
    for (si = 0; si < _stringState.length; si++) {
      var state = _stringState[si];
      var isBowing = state.bowing;
      var hasBowTouch = (state.bowTouchId !== null);
      var hasPitchAutoExcite = (_autoExciteMode && (state.pitchTouchId !== null));
      var hasAnyActivatingTouch = hasBowTouch || hasPitchAutoExcite;

      if (isBowing && !hasAnyActivatingTouch) {
        // String is bowing but no touch is driving it -- stuck note
        _stopBow(si);
        state.bowTouchId = null;
        state.pitchTouchId = null;
      }
    }
  }

  function _startLivenessTimer() {
    if (!_livenessTimerId) {
      _livenessTimerId = setInterval(_checkLiveness, LIVENESS_CHECK_INTERVAL_MS);
    }
  }

  function _stopLivenessTimer() {
    if (_livenessTimerId) {
      clearInterval(_livenessTimerId);
      _livenessTimerId = null;
    }
  }

  function _pluckString(stringIdx, velocity) {
    var state = _stringState[stringIdx];
    if (!state) { return; }

    // Set percussive ADSR before triggering note
    _setPluckEnvelope();

    if (_noteOnFn) {
      _noteOnFn(state.currentMidi, velocity);
    }
    // Apply pitch bend for fractional position
    if (_applyPitchBendFn && (state.currentBendCents !== 0)) {
      _applyPitchBendFn(state.currentBendCents);
    }
    _setStringVisual(stringIdx, true, velocity);

    // Auto-release after pluck duration, then restore original ADSR
    setTimeout(function() {
      if (_noteOffFn) {
        _noteOffFn(state.currentMidi);
      }
      if (_resetPitchBendFn) {
        _resetPitchBendFn();
      }
      _setStringVisual(stringIdx, false, 0);
      _restorePluckEnvelope();
    }, PLUCK_DURATION_MS);
  }

  // ============================================================
  // Zone detection
  // ============================================================

  function _findStringIdx(y) {
    var si;
    for (si = 0; si < _stringEls.length; si++) {
      var rect = _stringEls[si].getBoundingClientRect();
      if ((y >= rect.top) && (y <= rect.bottom)) {
        return si;
      }
    }
    return -1;
  }

  function _findZone(x, stringIdx) {
    var el = _stringEls[stringIdx];
    if (!el) { return null; }
    var rect = el.getBoundingClientRect();
    var relX = x - rect.left;
    var splitX = rect.width * PITCH_ZONE_FRACTION;
    var isPitchZone = (relX < splitX);
    if (isPitchZone) {
      return 'pitch';
    }
    return 'bow';
  }

  // ============================================================
  // Pointer handling
  // ============================================================

  function _onPointerStart(x, y, id, pointerEvent) {
    var stringIdx = _findStringIdx(y);
    if (stringIdx < 0) { return; }
    var zone = _findZone(x, stringIdx);
    if (!zone) { return; }

    // -- Same-string collision prevention --
    // If another touch already occupies this string+zone, release it first
    var existingId = _findExistingTouchOnStringZone(stringIdx, zone);
    var collisionDetected = (existingId !== null) && (existingId !== id);
    if (collisionDetected) {
      _forceReleaseTouch(existingId);
    }

    var touchInfo = { zone: zone, stringIdx: stringIdx };

    if (id === 'mouse') {
      _mouseZone = touchInfo;
    } else {
      _touchMap[id] = touchInfo;
    }

    var state = _stringState[stringIdx];
    if (!state) { return; }

    if (zone === 'pitch') {
      state.pitchTouchId = id;
      var pitchZone = _stringEls[stringIdx].querySelector('.bowed-pitch-zone');
      if (pitchZone) {
        var semiFrac = _pitchFracFromX(x, pitchZone);
        _setPitch(stringIdx, semiFrac);
      }
      // Auto-excite: trigger note on pitch touch if not already bowing
      if (_autoExciteMode && !state.bowing) {
        var autoExciteVel = pointerEvent ? SL.velocityFromPressure(pointerEvent, VELOCITY_DEFAULT) : VELOCITY_DEFAULT;
        _startBow(stringIdx, autoExciteVel);
      }
    } else {
      // Bow zone
      state.bowTouchId = id;
      state.bowStartTime = Date.now();
      state.bowStartY = y;
      state.lastBowY = y;
      state.lastBowX = x;
      state.smoothedSpeed = 0;

      if (_pluckMode) {
        // Pluck mode: instant pluck on pointerdown, no sustained bow
        var pluckVel = pointerEvent ? SL.velocityFromPressure(pointerEvent, VELOCITY_MAX) : VELOCITY_MAX;
        _pluckString(stringIdx, pluckVel);
        _flashStrumVisual(stringIdx);
      } else {
        // Normal bow mode
        var bowZone = _stringEls[stringIdx].querySelector('.bowed-bow-zone');
        var pressure = bowZone ? _bowPressureFromY(y, bowZone) : 0.5;
        var bowVelocity = Math.round(VELOCITY_MIN + pressure * (VELOCITY_MAX - VELOCITY_MIN));
        var velocity = pointerEvent ? SL.velocityFromPressure(pointerEvent, bowVelocity) : bowVelocity;
        _startBow(stringIdx, velocity);
        _updateBowPressureVisual(stringIdx, pressure);
      }
    }
  }

  function _onPointerMove(x, y, id, pointerEvent) {
    var touchInfo = (id === 'mouse') ? _mouseZone : _touchMap[id];
    if (!touchInfo) { return; }

    var stringIdx = touchInfo.stringIdx;
    var zone = touchInfo.zone;
    var state = _stringState[stringIdx];
    if (!state) { return; }

    // Detect strum: pointer moved to a different string
    var newStringIdx = _findStringIdx(y);
    var movedToNewString = (newStringIdx >= 0) && (newStringIdx !== stringIdx);
    if (movedToNewString) {
      // Stop the old string
      if (state.bowing) {
        _stopBow(stringIdx);
      }
      _hidePitchIndicator(stringIdx);
      _hideFingerLabel(stringIdx);

      // Clear old string's touch ownership BEFORE remapping to prevent orphaned state.
      // Without this, the old string retains bowTouchId/pitchTouchId pointing to this
      // touch id, so on release only the NEW string gets cleaned up and the old one
      // is left stuck with bowing=true.
      var oldState = _stringState[stringIdx];
      if (oldState) {
        if (oldState.bowTouchId === id) {
          oldState.bowTouchId = null;
        }
        if (oldState.pitchTouchId === id) {
          oldState.pitchTouchId = null;
        }
      }

      // Update touch mapping to new string
      touchInfo.stringIdx = newStringIdx;
      var newZone = _findZone(x, newStringIdx);
      if (newZone) {
        touchInfo.zone = newZone;
      }

      // Trigger the new string (strum gesture)
      var newState = _stringState[newStringIdx];
      if (newState) {
        if (touchInfo.zone === 'pitch') {
          newState.pitchTouchId = id;
          var pz = _stringEls[newStringIdx].querySelector('.bowed-pitch-zone');
          if (pz) {
            var sf = _pitchFracFromX(x, pz);
            _setPitch(newStringIdx, sf);
          }
          if (_autoExciteMode && !newState.bowing) {
            var moveExciteVel = pointerEvent ? SL.velocityFromPressure(pointerEvent, VELOCITY_DEFAULT) : VELOCITY_DEFAULT;
            _startBow(newStringIdx, moveExciteVel);
          }
        } else {
          newState.bowTouchId = id;
          newState.bowStartTime = Date.now();
          newState.bowStartY = y;
          newState.lastBowY = y;
          newState.lastBowX = x;
          newState.smoothedSpeed = 0;

          if (_pluckMode) {
            // Strum in pluck mode = pluck each string as finger crosses
            _pluckString(newStringIdx, VELOCITY_MAX);
          } else {
            var bz = _stringEls[newStringIdx].querySelector('.bowed-bow-zone');
            var pr = bz ? _bowPressureFromY(y, bz) : 0.5;
            var vel = Math.round(VELOCITY_MIN + pr * (VELOCITY_MAX - VELOCITY_MIN));
            _startBow(newStringIdx, vel);
            _updateBowPressureVisual(newStringIdx, pr);
          }
        }
        _flashStrumVisual(newStringIdx);
      }
      return;
    }

    if (zone === 'pitch') {
      var pitchZone = _stringEls[stringIdx].querySelector('.bowed-pitch-zone');
      if (pitchZone) {
        var semiFrac = _pitchFracFromX(x, pitchZone);
        _setPitch(stringIdx, semiFrac);
      }
    } else {
      // Bow zone: only update dynamics if in sustained bow mode (not pluck)
      if (!_pluckMode && state.bowing) {
        var bowZone = _stringEls[stringIdx].querySelector('.bowed-bow-zone');
        if (bowZone) {
          var pressure = _bowPressureFromY(y, bowZone);
          _updateBowDynamics(stringIdx, pressure, x, bowZone);
        }
      }
      state.lastBowY = y;
    }
  }

  function _onPointerEnd(id) {
    var touchInfo = (id === 'mouse') ? _mouseZone : _touchMap[id];
    if (!touchInfo) { return; }

    var stringIdx = touchInfo.stringIdx;
    var zone = touchInfo.zone;
    var state = _stringState[stringIdx];

    if (zone === 'pitch') {
      if (state) {
        state.pitchTouchId = null;

        // If bowing is active, we must transition the sounding note from the
        // fretted pitch back to the open-string pitch. Without this, the fretted
        // note remains sounding but state.currentMidi changes to the open string,
        // so a later _stopBow sends noteOff for the wrong MIDI number (stuck note).
        var wasFrettedWhileBowing = (state.bowing && (state.currentMidi !== _stringMidis[stringIdx]));
        var oldFrettedMidi = state.currentMidi;

        // Reset pitch to open string
        state.currentBendCents = 0;
        state.currentMidi = _stringMidis[stringIdx];

        if (state.bowing) {
          if (_applyPitchBendFn) {
            _applyPitchBendFn(0);
          }
          // Transition from fretted note to open-string note so the voice pool
          // correctly tracks which MIDI note is active.
          if (wasFrettedWhileBowing) {
            if (_noteOffFn) { _noteOffFn(oldFrettedMidi); }
            if (_noteOnFn) { _noteOnFn(state.currentMidi, state.velocity); }
          }
        }

        // Auto-excite: stop note when pitch zone released (if no bow touch active)
        if (_autoExciteMode && state.bowing && !state.bowTouchId) {
          _stopBow(stringIdx);
        }
      }
      _hidePitchIndicator(stringIdx);
      _hideFingerLabel(stringIdx);
    } else {
      // Bow zone release
      if (state) {
        state.bowTouchId = null;

        if (_pluckMode) {
          // In pluck mode, pointerup does nothing -- pluck is already decaying on its own
          // Just clear the touch ownership
        } else {
          var elapsed = Date.now() - state.bowStartTime;
          var wasQuickTap = (elapsed < PLUCK_THRESHOLD_MS);

          if (wasQuickTap) {
            // It was a pluck - the bow already started, so stop it and do a pluck instead
            _stopBow(stringIdx);
            _pluckString(stringIdx, state.velocity);
          } else {
            // Normal bow release
            _stopBow(stringIdx);
          }
        }
      }
    }

    if (id === 'mouse') {
      _mouseZone = null;
    } else {
      delete _touchMap[id];
    }
  }

  // ============================================================
  // Stop all (panic)
  // ============================================================

  function _stopAll() {
    var si;
    for (si = 0; si < _stringState.length; si++) {
      var state = _stringState[si];
      if (state.bowing) {
        _stopBow(si);
      }
      state.pitchTouchId = null;
      state.bowTouchId = null;
    }
    _touchMap = {};
    _mouseZone = null;

    if (SL.audio && SL.audio.clearExpressiveCutoff) {
      SL.audio.clearExpressiveCutoff();
    }
    if (SL.audio && SL.audio.setExpressionGain) {
      SL.audio.setExpressionGain(1.0);
    }
    if (_resetPitchBendFn) {
      _resetPitchBendFn();
    }
  }

  // ============================================================
  // Build DOM
  // ============================================================

  function _buildBowedController(container, opts) {
    _container = container;
    _noteOnFn = opts.noteOn;
    _noteOffFn = opts.noteOff;
    _applyPitchBendFn = opts.applyPitchBend;
    _resetPitchBendFn = opts.resetPitchBendFn;
    _baseOctave = (typeof opts.baseOctave === 'number') ? opts.baseOctave : DEFAULT_BASE_OCTAVE;

    _computeStringMidis();
    _initStringState();

    var wrapper = document.createElement('div');
    wrapper.className = 'bowed-wrapper';
    _wrapperEl = wrapper;

    // Top bar with octave controls
    var topbar = document.createElement('div');
    topbar.className = 'bowed-topbar';

    var titleSpan = document.createElement('span');
    titleSpan.className = 'bowed-title';
    titleSpan.textContent = SL.t('bowed.title');
    topbar.appendChild(titleSpan);

    var octDownBtn = document.createElement('button');
    octDownBtn.className = 'bowed-oct-btn';
    octDownBtn.textContent = '◄';
    octDownBtn.title = SL.t('bowed.octave_down');
    octDownBtn.addEventListener('click', function() {
      if (_baseOctave > MIN_OCTAVE) {
        _baseOctave--;
        _rebuildStrings();
      }
    });
    topbar.appendChild(octDownBtn);

    var octLabel = document.createElement('span');
    octLabel.className = 'bowed-oct-label';
    octLabel.id = 'bowedOctLabel';
    octLabel.textContent = SL.t('bowed.oct_prefix') + _baseOctave;
    topbar.appendChild(octLabel);

    var octUpBtn = document.createElement('button');
    octUpBtn.className = 'bowed-oct-btn';
    octUpBtn.textContent = '►';
    octUpBtn.title = SL.t('bowed.octave_up');
    octUpBtn.addEventListener('click', function() {
      if (_baseOctave < MAX_OCTAVE) {
        _baseOctave++;
        _rebuildStrings();
      }
    });
    topbar.appendChild(octUpBtn);

    var tuningSep = document.createElement('span');
    tuningSep.className = 'bowed-tuning-sep';
    tuningSep.textContent = '|';
    topbar.appendChild(tuningSep);

    var tuningSelect = document.createElement('select');
    tuningSelect.className = 'bowed-tuning-select';
    tuningSelect.id = 'bowedTuningSelect';
    var ti;
    for (ti = 0; ti < MULTISTRING_TUNING_NAMES_COUNT; ti++) {
      var opt = document.createElement('option');
      opt.value = String(ti);
      opt.textContent = MULTISTRING_TUNING_PRESETS[ti].label;
      tuningSelect.appendChild(opt);
    }
    tuningSelect.value = String(_currentTuningIdx);

    function _onTuningChange() {
      _currentTuningIdx = parseInt(tuningSelect.value, 10);
      _rebuildStrings();
    }

    tuningSelect.addEventListener('change', _onTuningChange);
    tuningSelect.addEventListener('touchstart', function(e) { e.stopPropagation(); });
    topbar.appendChild(tuningSelect);

    // Mode toggle: Auto-Excite vs Manual Bow
    var modeBtn = document.createElement('button');
    modeBtn.className = 'bowed-oct-btn bowed-mode-btn';
    modeBtn.textContent = _autoExciteMode ? SL.t('bowed.mode_touch') : SL.t('bowed.mode_bow');
    modeBtn.title = SL.t('bowed.mode_toggle_title');
    modeBtn.addEventListener('click', function() {
      _autoExciteMode = !_autoExciteMode;
      modeBtn.textContent = _autoExciteMode ? SL.t('bowed.mode_touch') : SL.t('bowed.mode_bow');
    });
    topbar.appendChild(modeBtn);

    // Pluck mode toggle: Bow vs Pluck in the bow zone
    var pluckBtn = document.createElement('button');
    pluckBtn.className = 'bowed-oct-btn bowed-pluck-btn';
    pluckBtn.textContent = _pluckMode ? SL.t('bowed.mode_pluck') : SL.t('bowed.mode_sustain');
    pluckBtn.title = SL.t('bowed.pluck_toggle_title');
    pluckBtn.addEventListener('click', function() {
      _pluckMode = !_pluckMode;
      pluckBtn.textContent = _pluckMode ? SL.t('bowed.mode_pluck') : SL.t('bowed.mode_sustain');
      if (_pluckMode) {
        pluckBtn.classList.add('bowed-pluck-active');
      } else {
        pluckBtn.classList.remove('bowed-pluck-active');
      }
    });
    if (_pluckMode) {
      pluckBtn.classList.add('bowed-pluck-active');
    }
    topbar.appendChild(pluckBtn);

    // Zone legend
    var legend = document.createElement('span');
    legend.className = 'bowed-legend';
    legend.textContent = SL.t('bowed.legend');
    topbar.appendChild(legend);

    wrapper.appendChild(topbar);

    // String area
    var stringArea = document.createElement('div');
    stringArea.className = 'bowed-string-area';
    stringArea.id = 'bowedStringArea';
    wrapper.appendChild(stringArea);

    container.appendChild(wrapper);

    _buildStringElements(stringArea);
    _attachEvents(stringArea);
  }

  function _buildStringElements(area) {
    area.innerHTML = '';
    _stringEls = [];

    var si;
    for (si = 0; si < _stringMidis.length; si++) {
      var midi = _stringMidis[si];
      var pc = midi % SEMITONES_PER_OCTAVE;
      var dotClass = (SL.DOT_CLASS && SL.DOT_CLASS[pc]) ? SL.DOT_CLASS[pc] : '';
      var bgClass = (SL.BG_CLASS && SL.BG_CLASS[pc]) ? SL.BG_CLASS[pc] : '';

      var lane = document.createElement('div');
      lane.className = 'bowed-string-lane';
      lane.setAttribute('data-string', String(si));

      // Color indicator strip on the left
      var colorStrip = document.createElement('div');
      colorStrip.className = 'bowed-color-strip ' + bgClass;
      lane.appendChild(colorStrip);

      // Open-string note label
      var label = document.createElement('div');
      label.className = 'bowed-string-label ' + dotClass;
      label.textContent = _midiToName(midi);
      lane.appendChild(label);

      // ---- LEFT: Pitch zone (60%) ----
      var pitchZone = document.createElement('div');
      pitchZone.className = 'bowed-pitch-zone';

      // Note markers along the pitch strip
      var mi;
      for (mi = 0; mi < NOTE_MARKER_COUNT; mi++) {
        var markerMidi = midi + mi;
        var markerPc = markerMidi % SEMITONES_PER_OCTAVE;
        var isBlackKey = (markerPc === 1 || markerPc === 3 || markerPc === 6 || markerPc === 8 || markerPc === 10);
        var marker = document.createElement('div');
        marker.className = 'bowed-fret-marker';
        if (isBlackKey) {
          marker.classList.add('bowed-fret-minor');
        }
        if (mi === 0 || mi === FINGERBOARD_SEMITONE_RANGE) {
          marker.classList.add('bowed-fret-octave');
        }
        marker.style.left = ((mi / FINGERBOARD_SEMITONE_RANGE) * 100) + '%';

        // Note name label at every fret position (skip last marker at 100% to avoid overflow)
        if (mi < FINGERBOARD_SEMITONE_RANGE) {
          var fretLabel = document.createElement('span');
          fretLabel.className = 'bowed-fret-label';
          fretLabel.textContent = NOTES[markerPc];
          fretLabel.style.fontSize = NOTE_LABEL_MIN_FONT_PX + 'px';
          fretLabel.style.opacity = String(NOTE_LABEL_MIN_OPACITY);
          marker.appendChild(fretLabel);
        }

        pitchZone.appendChild(marker);
      }

      // Pitch indicator (shows where finger is)
      var pitchIndicator = document.createElement('div');
      pitchIndicator.className = 'bowed-pitch-indicator';
      pitchIndicator.style.display = 'none';
      pitchZone.appendChild(pitchIndicator);

      // Current fingered note label
      var fingerNote = document.createElement('div');
      fingerNote.className = 'bowed-finger-note';
      fingerNote.style.display = 'none';
      fingerNote.style.fontSize = NOTE_LABEL_MIN_FONT_PX + 'px';
      fingerNote.style.opacity = String(NOTE_LABEL_MIN_OPACITY);
      pitchZone.appendChild(fingerNote);

      // String wire in pitch zone (with per-string color)
      var wire = document.createElement('div');
      var wireColorIdx = si % WIRE_COLOR_CLASSES.length;
      wire.className = 'bowed-string-wire ' + WIRE_COLOR_CLASSES[wireColorIdx];
      pitchZone.appendChild(wire);

      lane.appendChild(pitchZone);

      // ---- Divider ----
      var divider = document.createElement('div');
      divider.className = 'bowed-zone-divider';
      lane.appendChild(divider);

      // ---- RIGHT: Bow/pluck zone (40%) ----
      var bowZone = document.createElement('div');
      bowZone.className = 'bowed-bow-zone';

      var bowLabel = document.createElement('div');
      bowLabel.className = 'bowed-bow-label';
      bowLabel.textContent = '∿'; // sine wave symbol for bowing
      bowZone.appendChild(bowLabel);

      // Glow overlay (activates when bowed)
      var glow = document.createElement('div');
      glow.className = 'bowed-string-glow ' + bgClass;
      bowZone.appendChild(glow);

      lane.appendChild(bowZone);

      // String number indicator (far right)
      var numIndicator = document.createElement('div');
      numIndicator.className = 'bowed-string-num';
      numIndicator.textContent = String(_stringMidis.length - si);
      lane.appendChild(numIndicator);

      area.appendChild(lane);
      _stringEls.push(lane);
    }
  }

  function _rebuildStrings() {
    _stopAll();
    _computeStringMidis();
    _initStringState();

    var area = document.getElementById('bowedStringArea');
    if (area) {
      _buildStringElements(area);
    }

    var octLabel = document.getElementById('bowedOctLabel');
    if (octLabel) {
      octLabel.textContent = SL.t('bowed.oct_prefix') + _baseOctave;
    }
  }

  function _attachEvents(area) {
    // Mouse events
    area.addEventListener('mousedown', function(e) {
      e.preventDefault();
      _onPointerStart(e.clientX, e.clientY, 'mouse', e);
    });

    area.addEventListener('mousemove', function(e) {
      _onPointerMove(e.clientX, e.clientY, 'mouse', e);
    });

    area.addEventListener('mouseup', function() {
      _onPointerEnd('mouse');
    });

    area.addEventListener('mouseleave', function() {
      _onPointerEnd('mouse');
    });

    // Touch events (multi-touch)
    area.addEventListener('touchstart', function(e) {
      e.preventDefault();
      var ci;
      for (ci = 0; ci < e.changedTouches.length; ci++) {
        var t = e.changedTouches[ci];
        var touchEvent = { pointerType: 'touch', pressure: t.force };
        _onPointerStart(t.clientX, t.clientY, t.identifier, touchEvent);
      }
    }, { passive: false });

    area.addEventListener('touchmove', function(e) {
      e.preventDefault();
      var ci;
      for (ci = 0; ci < e.changedTouches.length; ci++) {
        var t = e.changedTouches[ci];
        var touchMoveEvent = { pointerType: 'touch', pressure: t.force };
        _onPointerMove(t.clientX, t.clientY, t.identifier, touchMoveEvent);
      }
    }, { passive: false });

    area.addEventListener('touchend', function(e) {
      e.preventDefault();
      var ci;
      for (ci = 0; ci < e.changedTouches.length; ci++) {
        _onPointerEnd(e.changedTouches[ci].identifier);
      }
    }, { passive: false });

    area.addEventListener('touchcancel', function(e) {
      var ci;
      for (ci = 0; ci < e.changedTouches.length; ci++) {
        _onPointerEnd(e.changedTouches[ci].identifier);
      }
    });

    // Document-level safety nets for stuck notes:
    // If pointerup/pointercancel fires outside the string area, we still
    // need to release any active bows to prevent notes from sticking.
    _docPointerUpHandler = function(e) {
      // Release only the specific pointer that was lifted
      var pid = (e && (typeof e.pointerId !== 'undefined')) ? e.pointerId : 'mouse';
      var isMousePointer = (pid === 'mouse') || (pid === 1);
      var hasTouchEntry = _touchMap.hasOwnProperty(pid);

      if (hasTouchEntry) {
        _onPointerEnd(pid);
      } else if (isMousePointer && _mouseZone) {
        _onPointerEnd('mouse');
      }
    };

    _docPointerCancelHandler = function(e) {
      _docPointerUpHandler(e);
    };

    document.addEventListener('pointerup', _docPointerUpHandler);
    document.addEventListener('pointercancel', _docPointerCancelHandler);

    // Document-level touch safety nets: touch.identifier and pointerId are
    // DIFFERENT values for the same finger, so pointerup alone cannot clean
    // up _touchMap entries keyed by touch.identifier. Listen for touchend/
    // touchcancel at the document level (capture phase) to catch releases
    // that escape the element's own touchend handler.
    _docTouchEndHandler = function(e) {
      var ti;
      for (ti = 0; ti < e.changedTouches.length; ti++) {
        var id = e.changedTouches[ti].identifier;
        if (_touchMap.hasOwnProperty(id)) {
          _onPointerEnd(id);
        }
      }
    };

    _docTouchCancelHandler = function(e) {
      var ti;
      for (ti = 0; ti < e.changedTouches.length; ti++) {
        var id = e.changedTouches[ti].identifier;
        if (_touchMap.hasOwnProperty(id)) {
          _onPointerEnd(id);
        }
      }
    };

    document.addEventListener('touchend', _docTouchEndHandler, true);
    document.addEventListener('touchcancel', _docTouchCancelHandler, true);

    // Start periodic stale-bow cleanup
    _startStaleBowTimer();

    // Start periodic liveness check for orphaned touches
    _startLivenessTimer();
  }

  // ============================================================
  // Release
  // ============================================================

  function _release() {
    _stopAll();
    _stopStaleBowTimer();
    _stopLivenessTimer();

    // Remove document-level safety handlers
    if (_docPointerUpHandler) {
      document.removeEventListener('pointerup', _docPointerUpHandler);
      _docPointerUpHandler = null;
    }
    if (_docPointerCancelHandler) {
      document.removeEventListener('pointercancel', _docPointerCancelHandler);
      _docPointerCancelHandler = null;
    }
    if (_docTouchEndHandler) {
      document.removeEventListener('touchend', _docTouchEndHandler, true);
      _docTouchEndHandler = null;
    }
    if (_docTouchCancelHandler) {
      document.removeEventListener('touchcancel', _docTouchCancelHandler, true);
      _docTouchCancelHandler = null;
    }

    // Restore pluck ADSR if mid-pluck
    _restorePluckEnvelope();

    _stringEls = [];
    _stringState = [];
    _touchMap = {};
    _mouseZone = null;
    _wrapperEl = null;
    _container = null;
    _noteOnFn = null;
    _noteOffFn = null;
    _applyPitchBendFn = null;
    _resetPitchBendFn = null;
  }

  // ============================================================
  // Register
  // ============================================================

  if (!SL.controllers) { SL.controllers = {}; }
  SL.controllers.bowed = {
    build: function(container, opts) {
      _buildBowedController(container, opts);
    },
    release: _release
  };

  // ============================================================
  // Panic hook
  // ============================================================

  if (SL.PanicRegistry && SL.PanicRegistry.register) {
    SL.PanicRegistry.register(
      'voices',
      'bowed.notes',
      function() { _stopAll(); },
      function() {
        var count = 0;
        var si;
        for (si = 0; si < _stringState.length; si++) {
          if (_stringState[si].bowing) { count++; }
        }
        return count > 0 ? 'bowing ' + count + ' strings' : '';
      }
    );
  }

})();
