// SSLI Controller: Handpan (circular instrument with central ding + 8 tone fields)
// ES5 compatible (var, no arrow functions, no template literals)

(function() {
  'use strict';

  var SL = window.SynthLab;

  // ============================================================
  // Constants
  // ============================================================

  // Geometry ratios (fraction of pan diameter) — packed tighter to reduce wasted space
  var DING_DIAMETER_RATIO = 0.30;
  var FIELD_CENTER_RADIUS_RATIO = 0.44;
  var FIELD_DIAMETER_RATIO = 0.28;
  var PAN_FILL_RATIO = 0.90;

  // Layout
  var TOPBAR_HEIGHT_PX = 22;
  var PADDING_PX = 2;
  var TONE_FIELD_COUNT = 8;
  var MAX_SIMULTANEOUS_TOUCHES = 5;

  // Phone layout
  var PHONE_FIELD_MIN_SIZE_PX = 48;
  var PHONE_DING_MIN_SIZE_PX = 55;
  var PHONE_TOPBAR_HEIGHT_PX = 18;

  // Ring durations (ms)
  var FIELD_RING_DURATION_MS = 1500;
  var DING_RING_DURATION_MS = 2000;

  // Visual feedback
  var HIT_FLASH_DURATION_MS = 120;
  var RIPPLE_DURATION_MS = 300;

  // Velocity
  var VELOCITY_PRESSURE_BASE = 40;
  var VELOCITY_PRESSURE_RANGE = 87;
  var VELOCITY_FALLBACK_BASE = 80;
  var VELOCITY_FALLBACK_RANGE = 30;
  var VELOCITY_MIN = 40;
  var VELOCITY_MAX = 127;
  var DEFAULT_TAP_VELOCITY = 100;

  // MIDI
  var SEMITONES_PER_OCTAVE = 12;
  var DEFAULT_ROOT_PC = 2;
  var DEFAULT_BASE_OCTAVE = 3;
  var MIN_OCTAVE = 1;
  var MAX_OCTAVE = 6;
  var TOTAL_SCALE_NOTES = 9;

  // Zig-zag field angles (degrees from 12-o-clock, clockwise)
  var FIELD_ANGLES_DEG = [180, 225, 135, 270, 90, 315, 45, 0];
  var DEG_TO_RAD = Math.PI / 180;
  var FULL_CIRCLE_DEG = 360;

  // Note names
  var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var NOTE_NAME_COUNT = 12;

  // Scale definitions (9 intervals: ding + 8 fields)
  var SCALE_KURD =         [0, 7, 8, 10, 12, 14, 15, 17, 19];
  var SCALE_INTEGRAL =     [0, 7, 10, 12, 14, 15, 19, 20, 22];
  var SCALE_CELTIC_MINOR = [0, 7, 8, 10, 12, 14, 15, 17, 19];
  var SCALE_HIJAZ =        [0, 7, 8, 11, 12, 14, 15, 17, 19];
  var SCALE_PYGMY =        [0, 1, 7, 8, 10, 12, 13, 19, 20];
  var SCALE_AKEBONO =      [0, 2, 3, 7, 8, 12, 14, 15, 19];

  var SCALE_DEFS = [
    { name: 'Kurd',         intervals: SCALE_KURD },
    { name: 'Integral',     intervals: SCALE_INTEGRAL },
    { name: 'Celtic Minor', intervals: SCALE_CELTIC_MINOR },
    { name: 'Hijaz',        intervals: SCALE_HIJAZ },
    { name: 'Pygmy',        intervals: SCALE_PYGMY },
    { name: 'Akebono',      intervals: SCALE_AKEBONO }
  ];
  var SCALE_COUNT = SCALE_DEFS.length;
  var DEFAULT_SCALE_INDEX = 1;

  // Colors
  var PAN_BODY_COLOR = '#1a1d22';
  var PAN_RIM_COLOR = '#334455';
  var DING_COLOR = '#554422';
  var DING_ACTIVE_COLOR = '#d4a017';
  var FIELD_COLOR_BASE = '#1e2830';
  var FIELD_COLOR_ALT = '#242e38';
  var FIELD_ACTIVE_COLOR = '#cc8800';
  var LABEL_COLOR = '#bbb8a8';
  var BACKGROUND_COLOR = '#0e0e14';
  var TOPBAR_BG_COLOR = '#111118';
  var SELECT_BG_COLOR = '#1a1a24';
  var SELECT_BORDER_COLOR = '#333344';
  var SELECT_TEXT_COLOR = '#c0c0cc';
  var TOPBAR_LABEL_COLOR = 'rgba(187, 184, 168, 0.6)';
  var SIDE_PANEL_COLOR = 'rgba(187, 184, 168, 0.5)';
  var NOTE_READOUT_COLOR = '#d4a017';

  // ============================================================
  // State
  // ============================================================

  var _activePointers = {};
  var _ringTimeouts = {};
  var _currentNoteOn = null;
  var _currentNoteOff = null;
  var _panEl = null;
  var _dingEl = null;
  var _fieldEls = [];
  var _fieldCenters = [];
  var _wrapperEl = null;
  var _scaleIndex = DEFAULT_SCALE_INDEX;
  var _rootPc = DEFAULT_ROOT_PC;
  var _baseOctave = DEFAULT_BASE_OCTAVE;
  var _octaveDisplayEl = null;
  var _scaleInfoEl = null;
  var _noteReadoutEl = null;
  var _dingRadius = 0;
  var _fieldRadius = 0;
  var _panRadius = 0;

  // ============================================================
  // Helpers
  // ============================================================

  function _isPhoneLayout() {
    var layoutAttr = document.documentElement.getAttribute('data-layout') || '';
    var isPhone = (layoutAttr === 'phone') || (layoutAttr === 'phone-land');
    return isPhone;
  }

  function _clampVelocity(v) {
    var result = v;
    if (result < VELOCITY_MIN) {
      result = VELOCITY_MIN;
    }
    if (result > VELOCITY_MAX) {
      result = VELOCITY_MAX;
    }
    return result;
  }

  function _computeVelocity(pressure) {
    var hasPressure = (typeof pressure === 'number') && (pressure > 0) && (pressure < 1);
    var velocity;
    if (hasPressure) {
      velocity = VELOCITY_PRESSURE_BASE + Math.floor(pressure * VELOCITY_PRESSURE_RANGE);
    } else {
      velocity = VELOCITY_FALLBACK_BASE + Math.floor(Math.random() * VELOCITY_FALLBACK_RANGE);
    }
    return _clampVelocity(velocity);
  }

  function _computeBaseMidi() {
    var baseMidi = ((_baseOctave - 1) * SEMITONES_PER_OCTAVE) + _rootPc;
    return baseMidi;
  }

  function _computeMidi(scaleIdx) {
    var intervals = SCALE_DEFS[_scaleIndex].intervals;
    var interval = intervals[scaleIdx];
    var midi = _computeBaseMidi() + interval;
    return midi;
  }

  function _midiToName(midi) {
    var pc = midi % SEMITONES_PER_OCTAVE;
    var oct = Math.floor(midi / SEMITONES_PER_OCTAVE) - 1;
    return NOTE_NAMES[pc] + oct;
  }

  function _activePointerCount() {
    var count = 0;
    var ids = Object.keys(_activePointers);
    for (var i = 0; i < ids.length; i++) {
      count = count + 1;
    }
    return count;
  }

  // ============================================================
  // Ring Timeout (auto noteOff)
  // ============================================================

  function _clearRingTimeout(zoneKey) {
    if (_ringTimeouts[zoneKey]) {
      clearTimeout(_ringTimeouts[zoneKey]);
      delete _ringTimeouts[zoneKey];
    }
  }

  function _scheduleRingTimeout(zoneKey, midi, durationMs) {
    _clearRingTimeout(zoneKey);
    _ringTimeouts[zoneKey] = setTimeout(function() {
      if (_currentNoteOff) {
        _currentNoteOff(midi);
      }
      delete _ringTimeouts[zoneKey];
    }, durationMs);
  }

  // ============================================================
  // Hit Detection (distance from button centers)
  // ============================================================

  function _hitTest(clientX, clientY) {
    if (!_panEl) {
      return { zoneType: null, zoneIdx: -1 };
    }
    var rect = _panEl.getBoundingClientRect();
    var cx = rect.left + (rect.width / 2);
    var cy = rect.top + (rect.height / 2);
    var dx = clientX - cx;
    var dy = clientY - cy;
    var distFromCenter = Math.sqrt((dx * dx) + (dy * dy));

    var result = { zoneType: null, zoneIdx: -1 };

    if (distFromCenter > _panRadius) {
      return result;
    }

    // Check ding first
    if (distFromCenter <= _dingRadius) {
      result.zoneType = 'ding';
      result.zoneIdx = 0;
      return result;
    }

    // Check tone fields: find closest within radius
    var closestIdx = -1;
    var closestDist = Infinity;
    for (var fi = 0; fi < TONE_FIELD_COUNT; fi++) {
      var fc = _fieldCenters[fi];
      var fdx = clientX - fc.x;
      var fdy = clientY - fc.y;
      var fdist = Math.sqrt((fdx * fdx) + (fdy * fdy));
      var isWithinField = (fdist <= _fieldRadius);
      var isCloser = (fdist < closestDist);
      if (isWithinField && isCloser) {
        closestIdx = fi;
        closestDist = fdist;
      }
    }

    if (closestIdx >= 0) {
      result.zoneType = 'field';
      result.zoneIdx = closestIdx;
    }

    return result;
  }

  // ============================================================
  // Visual Feedback
  // ============================================================

  function _flashZone(zoneType, zoneIdx) {
    var el;
    if (zoneType === 'ding') {
      el = _dingEl;
    } else {
      el = _fieldEls[zoneIdx];
    }
    if (el) {
      el.classList.add('handpan-zone-hit');
      setTimeout(function() {
        el.classList.remove('handpan-zone-hit');
      }, HIT_FLASH_DURATION_MS);
    }
  }

  function _spawnRipple(clientX, clientY) {
    if (_panEl) {
      var rect = _panEl.getBoundingClientRect();
      var localX = clientX - rect.left;
      var localY = clientY - rect.top;
      var ripple = document.createElement('div');
      ripple.className = 'handpan-ripple';
      ripple.style.left = localX + 'px';
      ripple.style.top = localY + 'px';
      _panEl.appendChild(ripple);
      setTimeout(function() {
        if (ripple.parentNode) {
          ripple.parentNode.removeChild(ripple);
        }
      }, RIPPLE_DURATION_MS + 50);
    }
  }

  function _updateNoteReadout(noteName) {
    if (_noteReadoutEl) {
      _noteReadoutEl.textContent = noteName;
    }
  }

  // ============================================================
  // Pointer Handling
  // ============================================================

  function _makeZoneKey(zoneType, zoneIdx) {
    return zoneType + '_' + zoneIdx;
  }

  function _releasePointer(pointerId) {
    var entry = _activePointers[pointerId];
    if (entry) {
      var zoneKey = _makeZoneKey(entry.zoneType, entry.zoneIdx);
      _clearRingTimeout(zoneKey);
      if (_currentNoteOff) {
        _currentNoteOff(entry.midi);
      }
    }
    delete _activePointers[pointerId];
  }

  function _releaseAll() {
    var ids = Object.keys(_activePointers);
    for (var i = 0; i < ids.length; i++) {
      _releasePointer(ids[i]);
    }
    var timeoutKeys = Object.keys(_ringTimeouts);
    for (var ti = 0; ti < timeoutKeys.length; ti++) {
      clearTimeout(_ringTimeouts[timeoutKeys[ti]]);
    }
    _ringTimeouts = {};
  }

  function _onPointerDown(e) {
    e.preventDefault();

    var tooManyTouches = (_activePointerCount() >= MAX_SIMULTANEOUS_TOUCHES);
    if (!tooManyTouches) {
      var hit = _hitTest(e.clientX, e.clientY);
      if (hit.zoneType) {

    var scaleIdx;
    if (hit.zoneType === 'ding') {
      scaleIdx = 0;
    } else {
      scaleIdx = hit.zoneIdx + 1;
    }
    var midi = _computeMidi(scaleIdx);
    var fallbackVel = _computeVelocity(e.pressure);
    var velocity = SL.velocityFromPressure(e, fallbackVel);
    var zoneKey = _makeZoneKey(hit.zoneType, hit.zoneIdx);

    // Re-tap same zone: cancel old ring, restart
    _clearRingTimeout(zoneKey);

    // Release previous pointer on this pointerId if any
    if (_activePointers[e.pointerId]) {
      var prevEntry = _activePointers[e.pointerId];
      if (_currentNoteOff) {
        _currentNoteOff(prevEntry.midi);
      }
    }

    _activePointers[e.pointerId] = {
      zoneType: hit.zoneType,
      zoneIdx: hit.zoneIdx,
      midi: midi
    };

    if (_currentNoteOn) {
      _currentNoteOn(midi, velocity);
    }

    // Schedule ring timeout
    var ringDuration = (hit.zoneType === 'ding') ? DING_RING_DURATION_MS : FIELD_RING_DURATION_MS;
    _scheduleRingTimeout(zoneKey, midi, ringDuration);

    _flashZone(hit.zoneType, hit.zoneIdx);
    _spawnRipple(e.clientX, e.clientY);
    _updateNoteReadout(_midiToName(midi));
      } // end if (hit.zoneType)
    } // end if (!tooManyTouches)
  }

  function _onPointerUp(e) {
    if (_activePointers[e.pointerId]) {
      delete _activePointers[e.pointerId];
    }
  }

  function _documentPointerUp(e) {
    if (_activePointers[e.pointerId]) {
      delete _activePointers[e.pointerId];
    }
  }
  document.addEventListener('pointerup', _documentPointerUp);
  document.addEventListener('pointercancel', _documentPointerUp);

  // ============================================================
  // Label Update
  // ============================================================

  function _updateLabels() {
    if (_dingEl) {
      var dingLabel = _dingEl.querySelector('.handpan-label');
      if (dingLabel) {
        dingLabel.textContent = _midiToName(_computeMidi(0));
      }
    }
    for (var fi = 0; fi < _fieldEls.length; fi++) {
      var fieldLabel = _fieldEls[fi].querySelector('.handpan-label');
      if (fieldLabel) {
        fieldLabel.textContent = _midiToName(_computeMidi(fi + 1));
      }
    }
    _updateSidePanel();
  }

  function _updateSidePanel() {
    if (_scaleInfoEl) {
      var scaleName = SCALE_DEFS[_scaleIndex].name;
      var rootName = NOTE_NAMES[_rootPc];
      _scaleInfoEl.textContent = rootName + ' ' + scaleName;
    }
    if (_octaveDisplayEl) {
      _octaveDisplayEl.textContent = String(_baseOctave);
    }
  }

  // ============================================================
  // Build
  // ============================================================

  function _buildHandpanController(container, opts) {
    _currentNoteOn = opts.noteOn;
    _currentNoteOff = opts.noteOff;
    _baseOctave = opts.baseOctave || DEFAULT_BASE_OCTAVE;

    var isPhone = _isPhoneLayout();
    var topBarH = isPhone ? PHONE_TOPBAR_HEIGHT_PX : TOPBAR_HEIGHT_PX;

    // Wrapper
    var wrapper = document.createElement('div');
    wrapper.className = 'handpan-wrapper';
    _wrapperEl = wrapper;

    // Top bar
    var topBar = document.createElement('div');
    topBar.className = 'handpan-topbar';
    topBar.style.height = topBarH + 'px';

    // Root is now controlled by the global topbar (no local duplicate)
    if (SL.screenPlay && SL.screenPlay.getRootPc) {
      _rootPc = SL.screenPlay.getRootPc();
    }

    // Scale selector
    var scaleLabel = document.createElement('span');
    scaleLabel.className = 'handpan-topbar-label';
    scaleLabel.textContent = SL.t('handpan.scale_label');
    topBar.appendChild(scaleLabel);

    var scaleSelect = document.createElement('select');
    scaleSelect.className = 'handpan-select';
    scaleSelect.setAttribute('aria-label', SL.t('handpan.scale_select'));
    for (var si = 0; si < SCALE_COUNT; si++) {
      var sopt = document.createElement('option');
      sopt.value = String(si);
      sopt.textContent = SCALE_DEFS[si].name;
      if (si === _scaleIndex) {
        sopt.selected = true;
      }
      scaleSelect.appendChild(sopt);
    }
    scaleSelect.addEventListener('change', function() {
      _scaleIndex = parseInt(scaleSelect.value, 10);
      _updateLabels();
    });
    topBar.appendChild(scaleSelect);

    // Scale info (collapsed from side panel)
    var scaleInfo = document.createElement('span');
    scaleInfo.className = 'handpan-scale-info';
    scaleInfo.textContent = NOTE_NAMES[_rootPc] + ' ' + SCALE_DEFS[_scaleIndex].name;
    _scaleInfoEl = scaleInfo;
    topBar.appendChild(scaleInfo);

    // Title
    var title = document.createElement('span');
    title.className = 'handpan-title';
    title.textContent = SL.t('handpan.title');
    topBar.appendChild(title);

    // Note readout (collapsed from side panel)
    var noteReadout = document.createElement('span');
    noteReadout.className = 'handpan-note-readout';
    noteReadout.textContent = '--';
    _noteReadoutEl = noteReadout;
    topBar.appendChild(noteReadout);

    // Octave controls
    var octDown = document.createElement('button');
    octDown.className = 'handpan-oct-btn';
    octDown.textContent = SL.t('handpan.oct_down');
    octDown.setAttribute('aria-label', SL.t('handpan.oct_down_aria'));
    octDown.addEventListener('pointerdown', function(e) {
      e.stopPropagation();
    });
    octDown.addEventListener('click', function() {
      if (_baseOctave > MIN_OCTAVE) {
        _baseOctave = _baseOctave - 1;
        _updateLabels();
      }
    });
    topBar.appendChild(octDown);

    var octDisplay = document.createElement('span');
    octDisplay.className = 'handpan-oct-display';
    octDisplay.textContent = String(_baseOctave);
    _octaveDisplayEl = octDisplay;
    topBar.appendChild(octDisplay);

    var octUp = document.createElement('button');
    octUp.className = 'handpan-oct-btn';
    octUp.textContent = SL.t('handpan.oct_up');
    octUp.setAttribute('aria-label', SL.t('handpan.oct_up_aria'));
    octUp.addEventListener('pointerdown', function(e) {
      e.stopPropagation();
    });
    octUp.addEventListener('click', function() {
      if (_baseOctave < MAX_OCTAVE) {
        _baseOctave = _baseOctave + 1;
        _updateLabels();
      }
    });
    topBar.appendChild(octUp);

    wrapper.appendChild(topBar);

    // Playfield (no side panels — info collapsed into top bar)
    var playfield = document.createElement('div');
    playfield.className = 'handpan-playfield';
    playfield.style.background = BACKGROUND_COLOR;

    // Compute pan diameter based on available space (deferred to after DOM attach)
    var pan = document.createElement('div');
    pan.className = 'handpan-pan';
    _panEl = pan;

    // Ding
    var ding = document.createElement('div');
    ding.className = 'handpan-ding';
    var dingLabelEl = document.createElement('span');
    dingLabelEl.className = 'handpan-label';
    dingLabelEl.textContent = _midiToName(_computeMidi(0));
    ding.appendChild(dingLabelEl);
    _dingEl = ding;
    pan.appendChild(ding);

    // Tone fields
    _fieldEls = [];
    _fieldCenters = [];
    for (var fi = 0; fi < TONE_FIELD_COUNT; fi++) {
      var field = document.createElement('div');
      field.className = 'handpan-field';
      var useAltColor = (fi % 2 === 1);
      if (useAltColor) {
        field.classList.add('handpan-field-alt');
      }

      var fLabelEl = document.createElement('span');
      fLabelEl.className = 'handpan-label';
      fLabelEl.textContent = _midiToName(_computeMidi(fi + 1));
      field.appendChild(fLabelEl);

      _fieldEls.push(field);
      _fieldCenters.push({ x: 0, y: 0 });
      pan.appendChild(field);
    }

    // Pointer events on pan
    pan.addEventListener('pointerdown', function(e) {
      _onPointerDown(e);
    });
    pan.addEventListener('pointerup', function(e) {
      _onPointerUp(e);
    });
    pan.addEventListener('pointercancel', function(e) {
      _onPointerUp(e);
    });

    playfield.appendChild(pan);
    wrapper.appendChild(playfield);
    container.appendChild(wrapper);

    // Layout after DOM attachment — defer until container has valid dimensions
    var capturedIsPhone = isPhone;
    var capturedTopBarH = topBarH;
    requestAnimationFrame(function() {
      _layoutPan(capturedIsPhone, capturedTopBarH);
      // Re-layout again after a short delay in case first frame had zero dimensions
      setTimeout(function() {
        _updateFieldCentersFromDOM();
      }, 50);
    });
  }

  // ============================================================
  // Layout (size and position pan + fields)
  // ============================================================

  function _layoutPan(isPhone, topBarH) {
    if (_panEl && _panEl.parentNode) {
      var playfield = _panEl.parentNode;
      var containerW = playfield.clientWidth;
      var containerH = playfield.clientHeight;

      var hasZeroDimensions = ((containerW === 0) || (containerH === 0));
      if (hasZeroDimensions) {
        // Container not yet laid out — retry after next frame
        var retryIsPhone = isPhone;
        var retryTopBarH = topBarH;
        requestAnimationFrame(function() {
          _layoutPan(retryIsPhone, retryTopBarH);
        });
      } else {

    var maxByWidth = containerW - (PADDING_PX * 2);
    var maxByHeight = containerH - (PADDING_PX * 2);
    var smallerDim = Math.min(maxByWidth, maxByHeight);
    var panDiam = Math.floor(smallerDim * PAN_FILL_RATIO);
    var panR = panDiam / 2;

    _panEl.style.width = panDiam + 'px';
    _panEl.style.height = panDiam + 'px';

    // Ding
    var dingDiam = panDiam * DING_DIAMETER_RATIO;
    if (isPhone && (dingDiam < PHONE_DING_MIN_SIZE_PX)) {
      dingDiam = PHONE_DING_MIN_SIZE_PX;
    }
    _dingRadius = dingDiam / 2;
    _dingEl.style.width = dingDiam + 'px';
    _dingEl.style.height = dingDiam + 'px';
    _dingEl.style.left = ((panDiam - dingDiam) / 2) + 'px';
    _dingEl.style.top = ((panDiam - dingDiam) / 2) + 'px';

    // Tone fields
    var fieldDiam = panDiam * FIELD_DIAMETER_RATIO;
    if (isPhone && (fieldDiam < PHONE_FIELD_MIN_SIZE_PX)) {
      fieldDiam = PHONE_FIELD_MIN_SIZE_PX;
    }
    _fieldRadius = fieldDiam / 2;
    var fieldCenterR = panDiam * FIELD_CENTER_RADIUS_RATIO;
    _panRadius = panR;

    var panRect = _panEl.getBoundingClientRect();
    var panCx = panRect.left + panR;
    var panCy = panRect.top + panR;

    var fieldTopMax = panDiam - fieldDiam;

    for (var fi = 0; fi < TONE_FIELD_COUNT; fi++) {
      var angleDeg = FIELD_ANGLES_DEG[fi];
      var angleRad = angleDeg * DEG_TO_RAD;
      var fx = panR + (fieldCenterR * Math.sin(angleRad)) - _fieldRadius;
      var fy = panR - (fieldCenterR * Math.cos(angleRad)) - _fieldRadius;

      // Clamp so field does not extend past container bounds
      var clampedFy = Math.min(fy, fieldTopMax);

      _fieldEls[fi].style.width = fieldDiam + 'px';
      _fieldEls[fi].style.height = fieldDiam + 'px';
      _fieldEls[fi].style.left = Math.round(fx) + 'px';
      _fieldEls[fi].style.top = Math.round(clampedFy) + 'px';

      _fieldCenters[fi] = {
        x: panCx + (fieldCenterR * Math.sin(angleRad)),
        y: panCy - (fieldCenterR * Math.cos(angleRad))
      };
    }

    // Recalculate field centers on scroll/resize
    _updateFieldCentersFromDOM();
      } // end else (!hasZeroDimensions)
    } // end if (_panEl && _panEl.parentNode)
  }

  function _updateFieldCentersFromDOM() {
    if (_panEl) {
      var panRect = _panEl.getBoundingClientRect();
      var panR = panRect.width / 2;
      var panCx = panRect.left + panR;
      var panCy = panRect.top + panR;
      var fieldCenterR = panRect.width * FIELD_CENTER_RADIUS_RATIO;

      for (var fi = 0; fi < TONE_FIELD_COUNT; fi++) {
        var angleDeg = FIELD_ANGLES_DEG[fi];
        var angleRad = angleDeg * DEG_TO_RAD;
        _fieldCenters[fi] = {
          x: panCx + (fieldCenterR * Math.sin(angleRad)),
          y: panCy - (fieldCenterR * Math.cos(angleRad))
        };
      }
      _panRadius = panR;
      _dingRadius = _dingEl ? (_dingEl.offsetWidth / 2) : 0;
      _fieldRadius = (_fieldEls.length > 0) ? (_fieldEls[0].offsetWidth / 2) : 0;
    }
  }

  // ============================================================
  // Register
  // ============================================================

  if (!SL.controllers) { SL.controllers = {}; }
  SL.controllers.handpan = {
    build: _buildHandpanController,
    release: _releaseAll
  };

  // ============================================================
  // Panic hook
  // ============================================================

  if (SL.PanicRegistry && SL.PanicRegistry.register) {
    SL.PanicRegistry.register(
      'voices',
      'handpan.notes',
      function() { _releaseAll(); },
      function() {
        var ids = Object.keys(_activePointers);
        var timeoutKeys = Object.keys(_ringTimeouts);
        var activeCount = ids.length;
        var ringingCount = timeoutKeys.length;
        var status = null;
        var hasActivity = (activeCount > 0) || (ringingCount > 0);
        if (hasActivity) {
          status = activeCount + ' touch, ' + ringingCount + ' ring';
        }
        return status;
      }
    );
  }

})();
