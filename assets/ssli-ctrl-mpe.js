// ======================================================================
// SSLI Controller: MPE Pitch Ribbon
// ======================================================================
//
// MIDI Polyphonic Expression (MPE) — per-note expressive control
//
// Standard MIDI applies pitch bend, aftertouch, and CC messages to
// every note on a channel simultaneously. MPE solves this by giving
// each note its own MIDI channel (member channels 2-15), so pitch
// bend, pressure, and slide can vary independently per finger.
//
// MPE defines three per-note dimensions:
//   X-axis (horizontal) -> Pitch Bend: continuous pitch between keys
//   Y-axis (vertical)   -> Slide (CC74): typically mapped to timbre
//   Z-axis (pressure)   -> Aftertouch/Velocity: touch force = dynamics
//
// This control surface implements these dimensions on a continuous
// pitch ribbon. Touching anywhere produces a note with micro-pitch
// (X = pitch bend in cents), timbral slide (Y = filter cutoff), and
// pressure-sensitive velocity (Z = touch force -> MIDI velocity).
//
// References:
//   MIDI Manufacturers Association (2017) "MIDI Polyphonic Expression
//     (MPE)", Recommended Practice RP-053
//   Linn, R. (2011) — LinnStrument, pioneering MPE controller
//   Roli (2013) — Seaboard, continuous touch surface
//
// ES5 compatible (var, no arrow functions, no template literals)
// ======================================================================

(function() {
  'use strict';

  var SL = window.SynthLab;
  var NOTES = SL.NOTES;
  var DOT_CLASS = SL.DOT_CLASS;
  var BG_CLASS = SL.BG_CLASS;

  // ============================================================
  // Constants
  // ============================================================

  // MPE Zone layout: the surface spans multiple octaves as a
  // continuous strip. Unlike a piano keyboard, there are no discrete
  // key boundaries — the player slides between pitches freely, and
  // the fractional position within each semitone becomes pitch bend.
  var NUM_VISIBLE_OCTAVES = 3;
  var KEYWAVE_BORDER_RADIUS = 6;

  var NOT_FOUND = -1;
  var RIPPLE_DURATION_MS = 600;
  var RIPPLE_MAX_RADIUS = 40;
  var SCROLL_OCTAVE_STEP = 1;
  var MIN_MIDI = 21;   // A0
  var MAX_MIDI = 108;  // C8
  var SEMITONES_PER_OCTAVE = 12;
  var OCTAVE_BASE_OFFSET = 1;
  // Y-axis slide dimension: maps vertical finger position to filter
  // cutoff, implementing MPE's CC74 "Slide" parameter. Moving the
  // finger toward the top of the surface brightens the timbre (higher
  // cutoff), while the bottom yields a darker, more muted tone.
  var Y_CUTOFF_MIN_HZ = 200;
  var Y_CUTOFF_MAX_HZ = 8000;
  var Y_CUTOFF_RANGE_HZ = Y_CUTOFF_MAX_HZ - Y_CUTOFF_MIN_HZ;
  var BEND_DISPLAY_THRESHOLD = 5;
  var TRAIL_MAX_POINTS = 120;
  var TRAIL_FADE_MS = 800;
  var TRAIL_LINE_WIDTH = 3;
  var TRAIL_GLOW_WIDTH = 8;
  var BEND_ARC_HEIGHT = 24;
  var BEND_ARC_COLOR = 'rgba(76, 201, 240, 0.7)';
  var BEND_ARC_GLOW = 'rgba(76, 201, 240, 0.25)';
  // Z-axis pressure dimension: touch force maps to MIDI velocity.
  // Heavier initial touch = louder note (higher velocity value).
  // On devices that report Touch.force (e.g. iOS), this enables
  // true pressure-sensitive dynamics. Fallback to DEFAULT_VELOCITY
  // on devices without force sensing (most desktop browsers).
  var PRESSURE_MIN_VEL = 40;
  var PRESSURE_MAX_VEL = 127;
  var DEFAULT_VELOCITY = 100;

  // ============================================================
  // Module State
  // ============================================================

  // MPE channel allocation pool: each active touch gets its own
  // entry, analogous to how hardware MPE assigns each new note
  // to the next available member channel (ch2-15). When a touch
  // ends, its "channel" is freed for reuse by the next note.
  var _activeTouches = {};   // touchId -> { midi, element, rippleEl, startX, pressure }
  var _isMouseDown = false;
  var _mouseInfo = null;     // { midi, element, rippleEl }
  var _scrollOffset = 0;     // octave offset from base
  var _surfaceEl = null;
  var _keywaveEls = [];
  var _noteDisplayEl = null;
  var _bendIndicatorEl = null;
  var _trailCanvas = null;
  var _trailCtx = null;
  var _trailPoints = [];     // { x, y, time, hue }
  var _trailAnimId = null;
  var _noteOn = null;
  var _noteOff = null;
  var _applyPitchBend = null;
  var _resetPitchBend = null;
  var _baseOctave = 3;
  var _numOctaves = NUM_VISIBLE_OCTAVES;

  // ============================================================
  // Helpers
  // ============================================================

  function _midiToName(midi) {
    var pc = midi % 12;
    var oct = Math.floor(midi / 12) - 1;
    return NOTES[pc] + oct;
  }

  function _getScaleNotes() {
    var rootEl = document.getElementById('rootNote');
    var modeEl = document.getElementById('mode');
    var root = 0;
    var scaleIntervals = [0, 2, 4, 5, 7, 9, 11];
    var result = [];
    var i;

    if (rootEl) {
      root = parseInt(rootEl.value, 10) || 0;
    }
    if (modeEl && SL.MODES) {
      var modeVal = modeEl.value;
      if (SL.MODES[modeVal]) {
        scaleIntervals = SL.MODES[modeVal].scale;
      }
    }

    for (i = 0; i < scaleIntervals.length; i++) {
      result.push((root + scaleIntervals[i]) % 12);
    }
    return result;
  }

  function _getRootPc() {
    var rootEl = document.getElementById('rootNote');
    if (rootEl) {
      return parseInt(rootEl.value, 10) || 0;
    }
    return 0;
  }

  function _getStartMidi() {
    return ((_baseOctave + OCTAVE_BASE_OFFSET) + _scrollOffset) * SEMITONES_PER_OCTAVE;
  }

  function _getEndMidi() {
    return _getStartMidi() + (_numOctaves * SEMITONES_PER_OCTAVE);
  }

  // ============================================================
  // Pressure -> Velocity (MPE Z-axis)
  // ============================================================
  //
  // Maps the Z-axis (touch force) to MIDI velocity. In MPE, initial
  // strike force sets velocity (note-on loudness), while sustained
  // pressure becomes channel aftertouch for ongoing expression.
  // Here we use force for initial velocity only; aftertouch is
  // handled separately through the slide (Y-axis) dimension.

  function _pressureToVelocity(force) {
    // force is 0..1 from Touch.force (or undefined on non-supporting devices)
    var hasForce = (typeof force === 'number' && force > 0);
    if (hasForce) {
      var clamped = Math.max(0, Math.min(1, force));
      return Math.round(PRESSURE_MIN_VEL + clamped * (PRESSURE_MAX_VEL - PRESSURE_MIN_VEL));
    }
    return DEFAULT_VELOCITY;
  }

  // ============================================================
  // Ripple Animation
  // ============================================================

  function _createRipple(parentEl, localX, localY) {
    var ripple = document.createElement('div');
    ripple.className = 'mpe-ripple';
    ripple.style.left = localX + 'px';
    ripple.style.top = localY + 'px';
    ripple.style.width = '0px';
    ripple.style.height = '0px';
    parentEl.appendChild(ripple);

    // Force reflow then start animation
    ripple.offsetWidth; // jshint ignore:line
    ripple.style.width = (RIPPLE_MAX_RADIUS * 2) + 'px';
    ripple.style.height = (RIPPLE_MAX_RADIUS * 2) + 'px';
    ripple.style.marginLeft = -RIPPLE_MAX_RADIUS + 'px';
    ripple.style.marginTop = -RIPPLE_MAX_RADIUS + 'px';
    ripple.style.opacity = '0';

    return ripple;
  }

  function _removeRipple(rippleEl) {
    if (rippleEl && rippleEl.parentNode) {
      rippleEl.parentNode.removeChild(rippleEl);
    }
  }

  // ============================================================
  // Brightness / Slide (Y-axis — MPE CC74)
  // ============================================================
  //
  // MPE's Y-axis dimension maps to MIDI CC74 ("Slide"). On physical
  // MPE controllers like the Roli Seaboard or LinnStrument, sliding
  // a finger forward/backward on a note surface controls timbre —
  // typically routed to a low-pass filter cutoff. This gives each
  // finger independent timbral control, unlike standard MIDI where
  // CC74 would affect all notes on the channel simultaneously.

  function _applySlide(yFrac) {
    var cutoff = Y_CUTOFF_MIN_HZ + yFrac * Y_CUTOFF_RANGE_HZ;
    if (SL.audio && SL.audio.setExpressiveCutoff) {
      SL.audio.setExpressiveCutoff(cutoff);
    }
  }

  function _clearSlide() {
    if (SL.audio && SL.audio.clearExpressiveCutoff) {
      SL.audio.clearExpressiveCutoff();
    }
  }

  // ============================================================
  // Surface position -> MIDI mapping (MPE X-axis)
  // ============================================================
  //
  // The X-axis is MPE's pitch dimension. On this continuous ribbon,
  // horizontal position maps linearly to a floating-point MIDI note
  // number. The integer part selects the note; the fractional part
  // becomes pitch bend in cents (-50 to +50 around each semitone).
  // This mirrors how MPE controllers send per-note pitch bend on
  // each member channel, enabling smooth glissando and vibrato
  // with per-finger independence.

  function _posToMidiFloat(clientX) {
    var rect = _surfaceEl.getBoundingClientRect();
    var relX = clientX - rect.left;
    var frac = Math.max(0, Math.min(1, relX / rect.width));
    var startMidi = _getStartMidi();
    var range = _numOctaves * SEMITONES_PER_OCTAVE;
    return startMidi + frac * range;
  }

  function _calcYFrac(clientY) {
    var rect = _surfaceEl.getBoundingClientRect();
    var yFrac = 1 - ((clientY - rect.top) / rect.height);
    return Math.max(0, Math.min(1, yFrac));
  }

  function _localPos(clientX, clientY, element) {
    var rect = element.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  function _clientToSurfaceLocal(clientX, clientY) {
    var rect = _surfaceEl.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  // ============================================================
  // Find keywave element at position
  // ============================================================

  function _findKeywaveAt(clientX) {
    var mFloat = _posToMidiFloat(clientX);
    var midi = Math.round(mFloat);
    var startMidi = _getStartMidi();
    var idx = midi - startMidi;
    if (idx >= 0 && idx < _keywaveEls.length) {
      return { element: _keywaveEls[idx], midi: midi };
    }
    return null;
  }

  // ============================================================
  // Bend Indicator
  // ============================================================

  function _updateBendIndicator(bendCents) {
    if (!_bendIndicatorEl) { return; }
    var absBend = Math.abs(bendCents);
    if (absBend > BEND_DISPLAY_THRESHOLD) {
      var frac = Math.min(1, absBend / 50);
      var direction = (bendCents > 0) ? 1 : -1;
      var offsetPx = direction * frac * BEND_ARC_HEIGHT;
      _bendIndicatorEl.style.transform = 'translateX(' + offsetPx + 'px)';
      _bendIndicatorEl.style.opacity = String(0.4 + frac * 0.6);
      _bendIndicatorEl.style.width = (4 + frac * 8) + 'px';
    }
    else {
      _bendIndicatorEl.style.opacity = '0';
    }
  }

  function _hideBendIndicator() {
    if (_bendIndicatorEl) {
      _bendIndicatorEl.style.opacity = '0';
    }
  }

  // ============================================================
  // Glide Trail
  // ============================================================
  //
  // Visual feedback for the continuous pitch glide. As the finger
  // moves across the ribbon, a color-coded trail renders on the
  // canvas overlay. Each trail point's hue is derived from its
  // pitch class (30 degrees per semitone across the color wheel),
  // making pitch motion visible — useful for learning intervals
  // and for visual confirmation of vibrato/glissando gestures.

  function _addTrailPoint(clientX, clientY) {
    if (!_trailCanvas) { return; }
    var local = _clientToSurfaceLocal(clientX, clientY);
    var mFloat = _posToMidiFloat(clientX);
    var pc = Math.round(mFloat) % 12;
    // Hue based on pitch class: spread 0..360 across 12 semitones
    var hue = (pc * 30) % 360;
    _trailPoints.push({
      x: local.x,
      y: local.y,
      time: Date.now(),
      hue: hue
    });
    if (_trailPoints.length > TRAIL_MAX_POINTS) {
      _trailPoints.shift();
    }
  }

  function _renderTrail() {
    if (!_trailCtx || !_trailCanvas) { return; }
    var now = Date.now();
    var cw = _trailCanvas.width;
    var ch = _trailCanvas.height;
    _trailCtx.clearRect(0, 0, cw, ch);

    // Remove expired points
    while (_trailPoints.length > 0 && (now - _trailPoints[0].time) > TRAIL_FADE_MS) {
      _trailPoints.shift();
    }

    if (_trailPoints.length < 2) {
      _trailAnimId = requestAnimationFrame(_renderTrail);
    } else {
      var i;
      for (i = 1; i < _trailPoints.length; i++) {
        var p0 = _trailPoints[i - 1];
        var p1 = _trailPoints[i];
        var age = now - p1.time;
        var alpha = Math.max(0, 1 - (age / TRAIL_FADE_MS));
        var safeTrailLen = _trailPoints.length || 1;
        var progressFrac = i / safeTrailLen;

        // Glow layer
        _trailCtx.beginPath();
        _trailCtx.moveTo(p0.x, p0.y);
        _trailCtx.lineTo(p1.x, p1.y);
        _trailCtx.strokeStyle = 'hsla(' + p1.hue + ', 80%, 65%, ' + (alpha * 0.25) + ')';
        _trailCtx.lineWidth = TRAIL_GLOW_WIDTH * progressFrac;
        _trailCtx.lineCap = 'round';
        _trailCtx.stroke();

        // Core line
        _trailCtx.beginPath();
        _trailCtx.moveTo(p0.x, p0.y);
        _trailCtx.lineTo(p1.x, p1.y);
        _trailCtx.strokeStyle = 'hsla(' + p1.hue + ', 85%, 70%, ' + alpha + ')';
        _trailCtx.lineWidth = TRAIL_LINE_WIDTH * progressFrac;
        _trailCtx.lineCap = 'round';
        _trailCtx.stroke();
      }

      _trailAnimId = requestAnimationFrame(_renderTrail);
    }
  }

  function _startTrailAnim() {
    if (!_trailAnimId) {
      _trailAnimId = requestAnimationFrame(_renderTrail);
    }
  }

  function _stopTrailAnim() {
    if (_trailAnimId) {
      cancelAnimationFrame(_trailAnimId);
      _trailAnimId = null;
    }
    _trailPoints = [];
    if (_trailCtx && _trailCanvas) {
      _trailCtx.clearRect(0, 0, _trailCanvas.width, _trailCanvas.height);
    }
  }

  function _resizeTrailCanvas() {
    if (!_trailCanvas || !_surfaceEl) { return; }
    var rect = _surfaceEl.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    _trailCanvas.width = Math.round(rect.width * dpr);
    _trailCanvas.height = Math.round(rect.height * dpr);
    _trailCanvas.style.width = rect.width + 'px';
    _trailCanvas.style.height = rect.height + 'px';
    if (_trailCtx) {
      _trailCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  // ============================================================
  // Note display update
  // ============================================================

  function _updateNoteDisplay(mFloat, midi, bendCents) {
    if (!_noteDisplayEl) { return; }
    var absBend = Math.abs(bendCents);
    var suffix = '';
    if (absBend > BEND_DISPLAY_THRESHOLD) {
      suffix = (bendCents > 0) ? '+' : '-';
    }
    _noteDisplayEl.textContent = _midiToName(midi) + suffix;
  }

  function _clearNoteDisplay() {
    if (_noteDisplayEl) {
      _noteDisplayEl.textContent = '--';
    }
  }

  // ============================================================
  // Keywave lateral shift for bend feedback
  // ============================================================

  function _shiftKeywave(element, bendCents) {
    if (!element) { return; }
    var absBend = Math.abs(bendCents);
    if (absBend > BEND_DISPLAY_THRESHOLD) {
      var frac = Math.min(1, absBend / 50);
      var direction = (bendCents > 0) ? 1 : -1;
      var shiftPx = direction * frac * 6;
      element.style.transform = 'translateX(' + shiftPx + 'px) scaleY(1.03)';
    }
    else {
      element.style.transform = '';
    }
  }

  function _resetKeywaveShift(element) {
    if (element) {
      element.style.transform = '';
    }
  }

  // ============================================================
  // Touch handlers (MPE note lifecycle)
  // ============================================================
  //
  // Each touch maps to an independent MPE "voice". On touch start,
  // a member channel is implicitly allocated (via _activeTouches),
  // a note-on fires with pressure-derived velocity, pitch bend is
  // set from fractional position, and slide is set from Y position.
  // On move, all three dimensions update continuously per-finger.
  // On end, the channel is released (note-off + bend/slide reset).
  //
  // When a finger glides across a semitone boundary, the old note
  // is released and a new one triggered — simulating how an MPE
  // synth would re-trigger on a new key while maintaining the
  // continuous pitch bend envelope.

  function _onTouchStart(clientX, clientY, touchId, force, touchObj) {
    // Resume AudioContext on user gesture
    if (SL.audio && SL.audio.getCtx) {
      var ctx = SL.audio.getCtx();
      if (ctx && ctx.state === 'suspended') { ctx.resume(); }
    }

    var mFloat = _posToMidiFloat(clientX);
    var midi = Math.round(mFloat);
    var bendCents = (mFloat - midi) * 100;
    var kw = _findKeywaveAt(clientX);
    var rippleEl = null;
    var fallbackVel = _pressureToVelocity(force);
    var touchEvent = touchObj ? { pointerType: 'touch', pressure: touchObj.force } : null;
    var velocity = touchEvent ? SL.velocityFromPressure(touchEvent, fallbackVel) : fallbackVel;

    if (midi < MIN_MIDI || midi > MAX_MIDI) { return; }

    if (kw && kw.element) {
      kw.element.classList.add('mpe-keywave-active');
      var lp = _localPos(clientX, clientY, kw.element);
      rippleEl = _createRipple(kw.element, lp.x, lp.y);
      _shiftKeywave(kw.element, bendCents);
    }

    _noteOn(midi, velocity);
    _applyPitchBend(bendCents);
    _applySlide(_calcYFrac(clientY));

    _activeTouches[touchId] = {
      midi: midi,
      element: (kw && kw.element) ? kw.element : null,
      rippleEl: rippleEl,
      startX: clientX,
      pressure: force
    };

    _addTrailPoint(clientX, clientY);
    _startTrailAnim();
    _updateBendIndicator(bendCents);
    _updateNoteDisplay(mFloat, midi, bendCents);
  }

  function _onTouchMove(clientX, clientY, touchId, force, touchObj) {
    var info = _activeTouches[touchId];
    if (!info) { return; }

    var mFloat = _posToMidiFloat(clientX);
    var midi = Math.round(mFloat);
    var bendCents = (mFloat - midi) * 100;

    if (midi < MIN_MIDI) { midi = MIN_MIDI; }
    if (midi > MAX_MIDI) { midi = MAX_MIDI; }

    if (midi !== info.midi) {
      // Transition to new note: crossed a semitone boundary while sliding.
      // Release old note, trigger new one — legato re-articulation.
      _noteOff(info.midi);
      if (info.element) {
        info.element.classList.remove('mpe-keywave-active');
        _resetKeywaveShift(info.element);
      }
      _removeRipple(info.rippleEl);

      var fallbackVel = _pressureToVelocity(force);
      var touchEvent = touchObj ? { pointerType: 'touch', pressure: touchObj.force } : null;
      var velocity = touchEvent ? SL.velocityFromPressure(touchEvent, fallbackVel) : fallbackVel;
      var kw = _findKeywaveAt(clientX);
      var rippleEl = null;
      if (kw && kw.element) {
        kw.element.classList.add('mpe-keywave-active');
        var lp = _localPos(clientX, clientY, kw.element);
        rippleEl = _createRipple(kw.element, lp.x, lp.y);
        _shiftKeywave(kw.element, bendCents);
      }

      info.midi = midi;
      info.element = (kw && kw.element) ? kw.element : null;
      info.rippleEl = rippleEl;
      _noteOn(midi, velocity);
    }
    else {
      // Same note, just update bend visual
      _shiftKeywave(info.element, bendCents);
    }

    _applyPitchBend(bendCents);
    _applySlide(_calcYFrac(clientY));
    _addTrailPoint(clientX, clientY);
    _updateBendIndicator(bendCents);
    _updateNoteDisplay(mFloat, midi, bendCents);
  }

  function _onTouchEnd(touchId) {
    var info = _activeTouches[touchId];
    if (!info) { return; }

    _noteOff(info.midi);
    _resetPitchBend();
    _clearSlide();

    if (info.element) {
      info.element.classList.remove('mpe-keywave-active');
      _resetKeywaveShift(info.element);
    }
    _removeRipple(info.rippleEl);
    delete _activeTouches[touchId];

    var remainingKeys = Object.keys(_activeTouches);
    if (remainingKeys.length === 0) {
      _clearNoteDisplay();
      _hideBendIndicator();
      // Let trail fade naturally
    }
  }

  // ============================================================
  // Release all voices
  // ============================================================

  function _releaseAll() {
    var keys = Object.keys(_activeTouches);
    var i;
    for (i = 0; i < keys.length; i++) {
      var info = _activeTouches[keys[i]];
      if (_noteOff) { _noteOff(info.midi); }
      if (info.element) {
        info.element.classList.remove('mpe-keywave-active');
        _resetKeywaveShift(info.element);
      }
      _removeRipple(info.rippleEl);
    }
    _activeTouches = {};

    if (_mouseInfo) {
      if (_noteOff) { _noteOff(_mouseInfo.midi); }
      if (_mouseInfo.element) {
        _mouseInfo.element.classList.remove('mpe-keywave-active');
        _resetKeywaveShift(_mouseInfo.element);
      }
      _removeRipple(_mouseInfo.rippleEl);
      _mouseInfo = null;
    }
    _isMouseDown = false;

    if (_resetPitchBend) { _resetPitchBend(); }
    _clearSlide();
    _clearNoteDisplay();
    _hideBendIndicator();
    _stopTrailAnim();
  }

  // ============================================================
  // Build keywaves
  // ============================================================
  //
  // "Keywaves" are the visual note strips that tile the ribbon
  // surface. Unlike piano keys, they are all the same width — MPE
  // treats the pitch axis as a linear continuum rather than the
  // uneven black/white layout of a traditional keyboard. In-scale
  // notes are highlighted to guide the player; root notes get
  // additional emphasis. Color classes come from the chromatic
  // palette shared across all SSLI controllers.

  function _buildKeywaves(surfaceEl) {
    var startMidi = _getStartMidi();
    var endMidi = _getEndMidi();
    var totalNotes = endMidi - startMidi;
    var scaleNotes = _getScaleNotes();
    var rootPc = _getRootPc();

    _keywaveEls = [];

    // Remove existing keywaves (preserve canvas and other overlay elements)
    var existingWaves = surfaceEl.querySelectorAll('.mpe-keywave');
    var wi;
    for (wi = 0; wi < existingWaves.length; wi++) {
      surfaceEl.removeChild(existingWaves[wi]);
    }
    // Also remove old slide labels
    var oldLabels = surfaceEl.querySelectorAll('.mpe-slide-label');
    for (wi = 0; wi < oldLabels.length; wi++) {
      surfaceEl.removeChild(oldLabels[wi]);
    }

    var midi;
    for (midi = startMidi; midi < endMidi; midi++) {
      var pc = midi % 12;
      var isInScale = (scaleNotes.indexOf(pc) !== NOT_FOUND);
      var isRoot = (pc === rootPc);
      var safeTotalNotes = totalNotes || 1;
      var widthPercent = 100 / safeTotalNotes;
      var leftPercent = ((midi - startMidi) / safeTotalNotes) * 100;

      var wave = document.createElement('div');
      wave.className = 'mpe-keywave';
      wave.setAttribute('data-midi', midi);
      wave.style.left = leftPercent + '%';
      wave.style.width = widthPercent + '%';

      // Add color class
      wave.classList.add(BG_CLASS[pc]);

      if (isInScale) {
        wave.classList.add('mpe-keywave-inscale');
      }
      if (isRoot) {
        wave.classList.add('mpe-keywave-root');
      }

      // Note label
      var label = document.createElement('div');
      label.className = 'mpe-keywave-label';
      if (isInScale) {
        label.textContent = NOTES[pc];
        label.classList.add(DOT_CLASS[pc]);
      }
      wave.appendChild(label);

      // Octave marker at C
      if (pc === 0) {
        var octMarker = document.createElement('div');
        octMarker.className = 'mpe-oct-marker';
        octMarker.textContent = 'C' + (Math.floor(midi / 12) - 1);
        wave.appendChild(octMarker);
      }

      surfaceEl.appendChild(wave);
      _keywaveEls.push(wave);
    }
  }

  // ============================================================
  // Build
  // ============================================================

  function _buildMpeController(container, opts) {
    _baseOctave = opts.baseOctave;
    // Always use our own octave count -- MPE keywaves are narrow and 3 octaves
    // fits easily even on phone, unlike piano keys which reduce octave count.
    _numOctaves = NUM_VISIBLE_OCTAVES;
    _noteOn = opts.noteOn;
    _noteOff = opts.noteOff;
    _applyPitchBend = opts.applyPitchBend;
    _resetPitchBend = opts.resetPitchBendFn;
    _scrollOffset = 0;

    var wrapper = document.createElement('div');
    wrapper.className = 'mpe-wrapper';

    // -- Header bar --
    var header = document.createElement('div');
    header.className = 'mpe-header';

    var scrollLeftBtn = document.createElement('button');
    scrollLeftBtn.className = 'mpe-scroll-btn rhy-scr-btn';
    scrollLeftBtn.textContent = '◀';
    scrollLeftBtn.title = SL.t('mpe.scroll_left_title');

    var scrollRightBtn = document.createElement('button');
    scrollRightBtn.className = 'mpe-scroll-btn rhy-scr-btn';
    scrollRightBtn.textContent = '▶';
    scrollRightBtn.title = SL.t('mpe.scroll_right_title');

    _noteDisplayEl = document.createElement('div');
    _noteDisplayEl.className = 'mpe-note-display';
    _noteDisplayEl.textContent = '--';

    // Bend indicator (vertical bar that shifts laterally with pitch bend)
    _bendIndicatorEl = document.createElement('div');
    _bendIndicatorEl.className = 'mpe-bend-indicator';

    var rangeLabel = document.createElement('div');
    rangeLabel.className = 'mpe-range-label';

    function updateRangeLabel() {
      var sM = _getStartMidi();
      var eM = _getEndMidi() - 1;
      rangeLabel.textContent = _midiToName(sM) + ' - ' + _midiToName(eM);
    }

    header.appendChild(scrollLeftBtn);
    header.appendChild(_noteDisplayEl);
    header.appendChild(_bendIndicatorEl);
    header.appendChild(rangeLabel);
    header.appendChild(scrollRightBtn);
    wrapper.appendChild(header);

    // -- Surface --
    var surface = document.createElement('div');
    surface.className = 'mpe-surface';
    surface.style.touchAction = 'none';
    _surfaceEl = surface;

    // -- Trail canvas (overlay for glide trails) --
    _trailCanvas = document.createElement('canvas');
    _trailCanvas.className = 'mpe-trail-canvas';
    surface.appendChild(_trailCanvas);
    _trailCtx = _trailCanvas.getContext('2d');

    _buildKeywaves(surface);
    updateRangeLabel();
    wrapper.appendChild(surface);

    // Resize trail canvas after layout
    requestAnimationFrame(function() {
      _resizeTrailCanvas();
    });

    // -- Slide label --
    var slideLabel = document.createElement('div');
    slideLabel.className = 'mpe-slide-label';
    slideLabel.textContent = SL.t('mpe.slide_label');
    surface.appendChild(slideLabel);

    // -- Scroll handlers --
    function _rebuildAfterScroll() {
      _releaseAll();
      _buildKeywaves(surface);
      updateRangeLabel();
      var sl = document.createElement('div');
      sl.className = 'mpe-slide-label';
      sl.textContent = SL.t('mpe.slide_label');
      surface.appendChild(sl);
      requestAnimationFrame(function() { _resizeTrailCanvas(); });
    }

    scrollLeftBtn.addEventListener('click', function() {
      var minOffset = Math.floor((MIN_MIDI / SEMITONES_PER_OCTAVE) - (_baseOctave + OCTAVE_BASE_OFFSET));
      if (_scrollOffset - SCROLL_OCTAVE_STEP >= minOffset) {
        _scrollOffset -= SCROLL_OCTAVE_STEP;
        _rebuildAfterScroll();
      }
    });

    scrollRightBtn.addEventListener('click', function() {
      var maxOffset = Math.floor((MAX_MIDI / SEMITONES_PER_OCTAVE) - (_baseOctave + OCTAVE_BASE_OFFSET) - _numOctaves);
      if (_scrollOffset + SCROLL_OCTAVE_STEP <= maxOffset) {
        _scrollOffset += SCROLL_OCTAVE_STEP;
        _rebuildAfterScroll();
      }
    });

    // -- Mouse handlers --
    surface.addEventListener('mousedown', function(e) {
      e.preventDefault();
      e.stopPropagation();

      // Resume AudioContext on user gesture
      if (SL.audio && SL.audio.getCtx) {
        var ctx = SL.audio.getCtx();
        if (ctx && ctx.state === 'suspended') { ctx.resume(); }
      }

      _isMouseDown = true;
      var mFloat = _posToMidiFloat(e.clientX);
      var midi = Math.round(mFloat);
      var bendCents = (mFloat - midi) * 100;

      if (midi < MIN_MIDI || midi > MAX_MIDI) { return; }

      var kw = _findKeywaveAt(e.clientX);
      var rippleEl = null;
      if (kw && kw.element) {
        kw.element.classList.add('mpe-keywave-active');
        var lp = _localPos(e.clientX, e.clientY, kw.element);
        rippleEl = _createRipple(kw.element, lp.x, lp.y);
        _shiftKeywave(kw.element, bendCents);
      }

      var mouseVelocity = SL.velocityFromPressure(e, DEFAULT_VELOCITY);
      _noteOn(midi, mouseVelocity);
      _applyPitchBend(bendCents);
      _applySlide(_calcYFrac(e.clientY));

      _mouseInfo = {
        midi: midi,
        element: (kw && kw.element) ? kw.element : null,
        rippleEl: rippleEl
      };
      _addTrailPoint(e.clientX, e.clientY);
      _startTrailAnim();
      _updateBendIndicator(bendCents);
      _updateNoteDisplay(mFloat, midi, bendCents);
    });

    surface.addEventListener('mousemove', function(e) {
      if (!_isMouseDown || !_mouseInfo) { return; }

      var mFloat = _posToMidiFloat(e.clientX);
      var midi = Math.round(mFloat);
      var bendCents = (mFloat - midi) * 100;

      if (midi < MIN_MIDI) { midi = MIN_MIDI; }
      if (midi > MAX_MIDI) { midi = MAX_MIDI; }

      if (midi !== _mouseInfo.midi) {
        _noteOff(_mouseInfo.midi);
        if (_mouseInfo.element) {
          _mouseInfo.element.classList.remove('mpe-keywave-active');
          _resetKeywaveShift(_mouseInfo.element);
        }
        _removeRipple(_mouseInfo.rippleEl);

        var kw = _findKeywaveAt(e.clientX);
        var rippleEl = null;
        if (kw && kw.element) {
          kw.element.classList.add('mpe-keywave-active');
          var lp = _localPos(e.clientX, e.clientY, kw.element);
          rippleEl = _createRipple(kw.element, lp.x, lp.y);
          _shiftKeywave(kw.element, bendCents);
        }

        _mouseInfo.midi = midi;
        _mouseInfo.element = (kw && kw.element) ? kw.element : null;
        _mouseInfo.rippleEl = rippleEl;
        var mouseMoveVelocity = SL.velocityFromPressure(e, DEFAULT_VELOCITY);
        _noteOn(midi, mouseMoveVelocity);
      }
      else {
        _shiftKeywave(_mouseInfo.element, bendCents);
      }

      _applyPitchBend(bendCents);
      _applySlide(_calcYFrac(e.clientY));
      _addTrailPoint(e.clientX, e.clientY);
      _updateBendIndicator(bendCents);
      _updateNoteDisplay(mFloat, midi, bendCents);
    });

    surface.addEventListener('mouseup', function() {
      if (_isMouseDown && _mouseInfo) {
        _noteOff(_mouseInfo.midi);
        _resetPitchBend();
        _clearSlide();
        if (_mouseInfo.element) {
          _mouseInfo.element.classList.remove('mpe-keywave-active');
          _resetKeywaveShift(_mouseInfo.element);
        }
        _removeRipple(_mouseInfo.rippleEl);
        _mouseInfo = null;
        _isMouseDown = false;
        _clearNoteDisplay();
        _hideBendIndicator();
      }
    });

    surface.addEventListener('mouseleave', function() {
      if (_isMouseDown && _mouseInfo) {
        _noteOff(_mouseInfo.midi);
        _resetPitchBend();
        _clearSlide();
        if (_mouseInfo.element) {
          _mouseInfo.element.classList.remove('mpe-keywave-active');
          _resetKeywaveShift(_mouseInfo.element);
        }
        _removeRipple(_mouseInfo.rippleEl);
        _mouseInfo = null;
        _isMouseDown = false;
        _clearNoteDisplay();
        _hideBendIndicator();
      }
    });

    // -- Touch handlers (multi-touch) --
    // Multi-touch is essential for MPE: each finger is an independent
    // voice with its own pitch/slide/pressure. Touch events use
    // changedTouches to process only the fingers that moved this frame.
    // stopPropagation prevents the keyboard-level glide handler from double-firing
    surface.addEventListener('touchstart', function(e) {
      e.preventDefault();
      e.stopPropagation();
      var ci;
      for (ci = 0; ci < e.changedTouches.length; ci++) {
        var t = e.changedTouches[ci];
        _onTouchStart(t.clientX, t.clientY, t.identifier, t.force, t);
      }
    }, { passive: false });

    surface.addEventListener('touchmove', function(e) {
      e.preventDefault();
      e.stopPropagation();
      var ci;
      for (ci = 0; ci < e.changedTouches.length; ci++) {
        var t = e.changedTouches[ci];
        _onTouchMove(t.clientX, t.clientY, t.identifier, t.force, t);
      }
    }, { passive: false });

    surface.addEventListener('touchend', function(e) {
      e.preventDefault();
      e.stopPropagation();
      var ci;
      for (ci = 0; ci < e.changedTouches.length; ci++) {
        _onTouchEnd(e.changedTouches[ci].identifier);
      }
    }, { passive: false });

    surface.addEventListener('touchcancel', function(e) {
      e.stopPropagation();
      var ci;
      for (ci = 0; ci < e.changedTouches.length; ci++) {
        _onTouchEnd(e.changedTouches[ci].identifier);
      }
    });

    // Handle window resize for trail canvas
    window.addEventListener('resize', function() {
      _resizeTrailCanvas();
    });

    container.appendChild(wrapper);
  }

  // ============================================================
  // Register
  // ============================================================

  if (!SL.controllers) { SL.controllers = {}; }
  SL.controllers.mpe = {
    build: _buildMpeController,
    release: _releaseAll
  };

  // ============================================================
  // Panic hook
  // ============================================================

  if (SL.PanicRegistry && SL.PanicRegistry.register) {
    SL.PanicRegistry.register(
      'voices',
      'mpe',
      function() { _releaseAll(); },
      function() {
        var touchCount = Object.keys(_activeTouches).length;
        var mouseActive = _isMouseDown ? 1 : 0;
        var totalActive = touchCount + mouseActive;
        var status = null;
        if (totalActive > 0) {
          status = totalActive + ' active';
        }
        return status;
      }
    );
  }

})();
