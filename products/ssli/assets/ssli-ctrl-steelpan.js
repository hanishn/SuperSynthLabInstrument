// SSLI Controller: Steel Pan (concentric ring tuned percussion surface)
// ES5 compatible (var, no arrow functions, no template literals)

(function() {
  'use strict';

  var SL = window.SynthLab;

  // Sentinel constants
  var NO_SELECTION = null;
  var NO_NODE = null;
  var NO_TYPE = 'none';

  // ============================================================
  // Constants
  // ============================================================

  // Layout
  var TOP_BAR_HEIGHT_PX = 22;
  var PAN_PADDING_PX = 0;
  var PAN_MIN_DIAM_PX = 100;
  var PAN_FILL_RATIO = 0.95;

  // Ring radius fractions (of pan radius) — packed tighter to reduce wasted space
  var INNER_RING_FRAC = 0.18;
  var MIDDLE_RING_FRAC = 0.55;
  var OUTER_RING_FRAC = 0.80;

  // Desktop zone button diameters (px) — larger for easier tapping (~20% increase)
  var INNER_BTN_DIAM_PX = 102;
  var MIDDLE_BTN_DIAM_PX = 88;
  var OUTER_BTN_DIAM_PX = 76;

  // Phone zone button diameters (px) — proportionally larger (~20% increase)
  var INNER_BTN_DIAM_PHONE_PX = 60;
  var MIDDLE_BTN_DIAM_PHONE_PX = 50;
  var OUTER_BTN_DIAM_PHONE_PX = 44;

  // Timing (ms)
  var RING_DELAY_MS = 1000;
  var FLASH_DURATION_MS = 200;

  // Touch limits
  var MAX_SIMULTANEOUS_TOUCHES = 5;
  var TAP_VELOCITY = 100;
  var DRAG_VELOCITY_SCALE = 0.7;
  var DRAG_VELOCITY = Math.round(TAP_VELOCITY * DRAG_VELOCITY_SCALE);

  // Angles
  var ANGLE_START_DEG = -90;
  var DEG_TO_RAD = Math.PI / 180;
  var FULL_CIRCLE_DEG = 360;

  // Zone counts
  var INNER_ZONE_COUNT = 3;
  var MAX_RING_ZONES = 7;
  var PENTATONIC_ZONE_COUNT = 5;

  // Triad scale-degree indices (1st, 3rd, 5th)
  var TRIAD_IDX_ROOT = 0;
  var TRIAD_IDX_THIRD = 2;
  var TRIAD_IDX_FIFTH = 4;
  var TRIAD_INDICES = [TRIAD_IDX_ROOT, TRIAD_IDX_THIRD, TRIAD_IDX_FIFTH];

  // Colors
  var PAN_BODY_CENTER = '#2a2d32';
  var PAN_BODY_EDGE = '#1c1f24';
  var PAN_BODY_DEEP = '#13151a';
  var PAN_RIM_COLOR = '#445566';
  var PAN_RIM_WIDTH_PX = 3;
  var BACKGROUND_COLOR = '#12141a';

  // Music
  var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var SEMITONES_PER_OCTAVE = 12;
  var MIN_OCTAVE = 1;
  var MAX_OCTAVE = 8;
  var DEFAULT_OCTAVE = 4;

  // Scale definitions (intervals from root)
  var SCALES = [
    { name: 'Major',       intervals: [0, 2, 4, 5, 7, 9, 11] },
    { name: 'Minor',       intervals: [0, 2, 3, 5, 7, 8, 10] },
    { name: 'Dorian',      intervals: [0, 2, 3, 5, 7, 9, 10] },
    { name: 'Mixolydian',  intervals: [0, 2, 4, 5, 7, 9, 10] },
    { name: 'Pent Maj',    intervals: [0, 2, 4, 7, 9] },
    { name: 'Pent Min',    intervals: [0, 3, 5, 7, 10] }
  ];

  // ============================================================
  // State
  // ============================================================

  var _rootNote = 0;
  var _scaleIdx = 0;
  var _baseOctave = DEFAULT_OCTAVE;

  var _currentNoteOn = null;
  var _currentNoteOff = null;
  var _wrapperEl = null;

  // Zone arrays: each entry is { el, midi, key }
  var _innerZones = [];
  var _middleZones = [];
  var _outerZones = [];

  // Ringing notes: zoneKey -> { midi, timeoutId }
  var _ringingNotes = {};

  // Active pointers: pointerId -> { currentZoneKey }
  var _activePointers = {};
  var _activePointerCount = 0;

  // Top bar DOM refs
  var _rootButtons = [];
  var _scaleSelect = null;
  var _octaveLabel = null;

  // Layout cache (for scale-change repositioning)
  var _cachedPanDiam = 0;
  var _isCachedPhone = false;

  // ============================================================
  // Helpers
  // ============================================================

  function _isPhoneLayout() {
    var attr = document.documentElement.getAttribute('data-layout') || '';
    var isPhone = (attr === 'phone') || (attr === 'phone-land');
    return isPhone;
  }

  function _isPentatonic() {
    var len = SCALES[_scaleIdx].intervals.length;
    var isPent = (len === PENTATONIC_ZONE_COUNT);
    return isPent;
  }

  function _activeRingCount() {
    var count = _isPentatonic() ? PENTATONIC_ZONE_COUNT : MAX_RING_ZONES;
    return count;
  }

  function _midiForScaleDegree(degreeIdx, octaveOffset) {
    var intervals = SCALES[_scaleIdx].intervals;
    var len = intervals.length;
    var safeLen = len || 1;
    var wrappedIdx = degreeIdx % safeLen;
    var extraOctaves = Math.floor(degreeIdx / safeLen);
    var midi = ((_baseOctave + octaveOffset + extraOctaves) * SEMITONES_PER_OCTAVE) + _rootNote + intervals[wrappedIdx];
    return midi;
  }

  function _noteNameFromMidi(midi) {
    var idx = ((midi % SEMITONES_PER_OCTAVE) + SEMITONES_PER_OCTAVE) % SEMITONES_PER_OCTAVE;
    return NOTE_NAMES[idx];
  }

  function _zoneKey(ring, idx) {
    return ring + '-' + idx;
  }

  // ============================================================
  // Note Triggering
  // ============================================================

  function _triggerZone(key, midi, velocity, pointerEvent) {
    var existing = _ringingNotes[key];
    var hadExisting = (existing !== undefined) && (existing !== NO_NODE);
    if (hadExisting) {
      clearTimeout(existing.timeoutId);
      if (_currentNoteOff) {
        _currentNoteOff(existing.midi);
      }
    }

    if (_currentNoteOn) {
      var pressureVel = pointerEvent ? SL.velocityFromPressure(pointerEvent, velocity) : velocity;
      _currentNoteOn(midi, pressureVel);
    }

    var timeoutId = setTimeout(function() {
      if (_currentNoteOff) {
        _currentNoteOff(midi);
      }
      delete _ringingNotes[key];
    }, RING_DELAY_MS);

    _ringingNotes[key] = { midi: midi, timeoutId: timeoutId };
  }

  function _releaseAll() {
    var key;
    for (key in _ringingNotes) {
      if (_ringingNotes.hasOwnProperty(key)) {
        clearTimeout(_ringingNotes[key].timeoutId);
        if (_currentNoteOff) {
          _currentNoteOff(_ringingNotes[key].midi);
        }
      }
    }
    _ringingNotes = {};
    _activePointers = {};
    _activePointerCount = 0;
  }

  // ============================================================
  // Zone Hit Detection
  // ============================================================

  function _hitTestRing(zones, clientX, clientY) {
    var foundZone = null;
    var zi, zone, rect, cx, cy, dx, dy, dist, radius, isHidden, isHit;
    for (zi = 0; zi < zones.length; zi++) {
      if (foundZone === NO_SELECTION) {
        zone = zones[zi];
        isHidden = (zone.el.style.display === NO_TYPE);
        if (!isHidden) {
          rect = zone.el.getBoundingClientRect();
          cx = rect.left + (rect.width / 2);
          cy = rect.top + (rect.height / 2);
          dx = clientX - cx;
          dy = clientY - cy;
          dist = Math.sqrt((dx * dx) + (dy * dy));
          radius = rect.width / 2;
          isHit = (dist <= radius);
          if (isHit) {
            foundZone = zone;
          }
        }
      }
    }
    return foundZone;
  }

  function _findZoneAtPoint(clientX, clientY) {
    var result = _hitTestRing(_innerZones, clientX, clientY);
    if (result === NO_SELECTION) {
      result = _hitTestRing(_middleZones, clientX, clientY);
    }
    if (result === NO_SELECTION) {
      result = _hitTestRing(_outerZones, clientX, clientY);
    }
    return result;
  }

  // ============================================================
  // Visual Feedback
  // ============================================================

  function _flashZone(el) {
    var hasEl = (el !== NO_SELECTION) && (el !== undefined);
    if (hasEl) {
      el.classList.add('steelpan-zone-active');
      setTimeout(function() {
        el.classList.remove('steelpan-zone-active');
      }, FLASH_DURATION_MS);
    }
  }

  // ============================================================
  // Pointer Handling
  // ============================================================

  function _onPointerDown(e) {
    e.preventDefault();
    var isNotFull = (_activePointerCount < MAX_SIMULTANEOUS_TOUCHES);
    if (isNotFull) {
      var zone = _findZoneAtPoint(e.clientX, e.clientY);
      var hasZone = (zone !== NO_SELECTION);
      if (hasZone) {
        _activePointers[e.pointerId] = { currentZoneKey: zone.key };
        _activePointerCount++;
        _triggerZone(zone.key, zone.midi, TAP_VELOCITY, e);
        _flashZone(zone.el);
      }
    }
  }

  function _onPointerMove(e) {
    var ptr = _activePointers[e.pointerId];
    var hasPtr = (ptr !== undefined) && (ptr !== NO_NODE);
    if (hasPtr) {
      var zone = _findZoneAtPoint(e.clientX, e.clientY);
      var hasZone = (zone !== NO_SELECTION);
      if (hasZone) {
        var isDifferent = (zone.key !== ptr.currentZoneKey);
        if (isDifferent) {
          ptr.currentZoneKey = zone.key;
          _triggerZone(zone.key, zone.midi, DRAG_VELOCITY, e);
          _flashZone(zone.el);
        }
      }
    }
  }

  function _onPointerUp(e) {
    var hasPtr = (_activePointers[e.pointerId] !== undefined);
    if (hasPtr) {
      delete _activePointers[e.pointerId];
      _activePointerCount--;
    }
  }

  function _documentPointerUp(e) {
    _onPointerUp(e);
  }
  document.addEventListener('pointerup', _documentPointerUp);
  document.addEventListener('pointercancel', _documentPointerUp);

  // ============================================================
  // Zone Note Recalculation
  // ============================================================

  function _updateRootHighlight(zone) {
    var isRoot = ((zone.midi % SEMITONES_PER_OCTAVE) === _rootNote);
    if (isRoot) {
      zone.el.classList.add('steelpan-zone-root');
    } else {
      zone.el.classList.remove('steelpan-zone-root');
    }
  }

  function _recalcNotes() {
    var activeCount = _activeRingCount();
    var i, midi, name, labelEl;

    // Inner ring: triad (1st, 3rd, 5th scale degrees)
    for (i = 0; i < _innerZones.length; i++) {
      midi = _midiForScaleDegree(TRIAD_INDICES[i], 0);
      name = _noteNameFromMidi(midi);
      _innerZones[i].midi = midi;
      labelEl = _innerZones[i].el.querySelector('.steelpan-zone-label');
      if (labelEl) { labelEl.textContent = name; }
      _innerZones[i].el.setAttribute('data-pc', String(((midi % SEMITONES_PER_OCTAVE) + SEMITONES_PER_OCTAVE) % SEMITONES_PER_OCTAVE));
      _innerZones[i].el.setAttribute('data-octave-pos', 'low');
      _updateRootHighlight(_innerZones[i]);
    }

    // Middle ring: full scale at base octave
    for (i = 0; i < _middleZones.length; i++) {
      var midVisible = (i < activeCount);
      if (midVisible) {
        midi = _midiForScaleDegree(i, 0);
        name = _noteNameFromMidi(midi);
        _middleZones[i].midi = midi;
        labelEl = _middleZones[i].el.querySelector('.steelpan-zone-label');
        if (labelEl) { labelEl.textContent = name; }
        _middleZones[i].el.setAttribute('data-pc', String(((midi % SEMITONES_PER_OCTAVE) + SEMITONES_PER_OCTAVE) % SEMITONES_PER_OCTAVE));
        _middleZones[i].el.setAttribute('data-octave-pos', 'low');
        _middleZones[i].el.style.display = '';
        _updateRootHighlight(_middleZones[i]);
      } else {
        _middleZones[i].el.style.display = 'none';
      }
    }

    // Outer ring: full scale one octave up
    for (i = 0; i < _outerZones.length; i++) {
      var outVisible = (i < activeCount);
      if (outVisible) {
        midi = _midiForScaleDegree(i, 1);
        name = _noteNameFromMidi(midi);
        _outerZones[i].midi = midi;
        labelEl = _outerZones[i].el.querySelector('.steelpan-zone-label');
        if (labelEl) { labelEl.textContent = name; }
        _outerZones[i].el.setAttribute('data-pc', String(((midi % SEMITONES_PER_OCTAVE) + SEMITONES_PER_OCTAVE) % SEMITONES_PER_OCTAVE));
        _outerZones[i].el.setAttribute('data-octave-pos', 'high');
        _outerZones[i].el.style.display = '';
        _updateRootHighlight(_outerZones[i]);
      } else {
        _outerZones[i].el.style.display = 'none';
      }
    }
  }

  // ============================================================
  // Zone Polar Positioning
  // ============================================================

  function _positionZoneEl(el, panCenter, ringRadius, angleIdx, totalInRing, btnDiam) {
    var safeTotalInRing = totalInRing || 1;
    var angleStep = FULL_CIRCLE_DEG / safeTotalInRing;
    var angleDeg = ANGLE_START_DEG + (angleIdx * angleStep);
    var angleRad = angleDeg * DEG_TO_RAD;
    var x = panCenter + (ringRadius * Math.cos(angleRad)) - (btnDiam / 2);
    var y = panCenter + (ringRadius * Math.sin(angleRad)) - (btnDiam / 2);
    el.style.left = Math.round(x) + 'px';
    el.style.top = Math.round(y) + 'px';
  }

  function _repositionForScale() {
    var panDiam = _cachedPanDiam;
    var isPhone = _isCachedPhone;
    var panCenter = panDiam / 2;
    var panRadius = panDiam / 2;
    var activeCount = _activeRingCount();

    var middleDiam = isPhone ? MIDDLE_BTN_DIAM_PHONE_PX : MIDDLE_BTN_DIAM_PX;
    var outerDiam = isPhone ? OUTER_BTN_DIAM_PHONE_PX : OUTER_BTN_DIAM_PX;
    var middleRingR = panRadius * MIDDLE_RING_FRAC;
    var outerRingR = panRadius * OUTER_RING_FRAC;

    var i;
    for (i = 0; i < _middleZones.length; i++) {
      var midActive = (i < activeCount);
      if (midActive) {
        _positionZoneEl(_middleZones[i].el, panCenter, middleRingR, i, activeCount, middleDiam);
      }
    }
    for (i = 0; i < _outerZones.length; i++) {
      var outActive = (i < activeCount);
      if (outActive) {
        _positionZoneEl(_outerZones[i].el, panCenter, outerRingR, i, activeCount, outerDiam);
      }
    }
  }

  // ============================================================
  // Top Bar Handlers
  // ============================================================

  function _onRootChange(newRoot) {
    _rootNote = newRoot;
    var i;
    for (i = 0; i < _rootButtons.length; i++) {
      if (i === newRoot) {
        _rootButtons[i].classList.add('steelpan-root-active');
      } else {
        _rootButtons[i].classList.remove('steelpan-root-active');
      }
    }
    _releaseAll();
    _recalcNotes();
  }

  function _onScaleChange(newIdx) {
    _scaleIdx = newIdx;
    _releaseAll();
    _repositionForScale();
    _recalcNotes();
  }

  function _onOctaveChange(delta) {
    var newOctave = _baseOctave + delta;
    var isValid = (newOctave >= MIN_OCTAVE) && (newOctave <= MAX_OCTAVE);
    if (isValid) {
      _baseOctave = newOctave;
      if (_octaveLabel) {
        _octaveLabel.textContent = _baseOctave;
      }
      _releaseAll();
      _recalcNotes();
    }
  }

  // ============================================================
  // DOM Building: Top Bar
  // ============================================================

  // Left side panel width (wide enough for 2-column root button grid)
  var LEFT_PANEL_WIDTH_PX = 140;
  var LEFT_PANEL_WIDTH_PHONE_PX = 100;
  var ROOT_GRID_COLUMNS_DESKTOP = 2;
  var ROOT_GRID_COLUMNS_PHONE = 2;
  var ROOT_GRID_ROWS_DESKTOP = 6;
  var ROOT_BTN_MIN_SIZE_PX = 36;

  function _buildTopBar() {
    var bar = document.createElement('div');
    bar.className = 'steelpan-topbar';

    // Scale selector
    var sel = document.createElement('select');
    sel.className = 'steelpan-scale-select';
    var si;
    for (si = 0; si < SCALES.length; si++) {
      var opt = document.createElement('option');
      opt.value = si;
      opt.textContent = SCALES[si].name;
      sel.appendChild(opt);
    }
    sel.value = _scaleIdx;
    sel.addEventListener('change', function() {
      _onScaleChange(parseInt(sel.value, 10));
    });
    _scaleSelect = sel;
    bar.appendChild(sel);

    // Title
    var title = document.createElement('span');
    title.className = 'steelpan-title';
    title.textContent = SL.t('steelpan.title');
    bar.appendChild(title);

    // Octave controls
    var octGroup = document.createElement('div');
    octGroup.className = 'steelpan-oct-group';

    var octDown = document.createElement('button');
    octDown.className = 'steelpan-oct-btn';
    octDown.textContent = '−';
    octDown.addEventListener('pointerdown', function(e) {
      e.preventDefault();
      e.stopPropagation();
      _onOctaveChange(-1);
    });
    octGroup.appendChild(octDown);

    var octLbl = document.createElement('span');
    octLbl.className = 'steelpan-oct-label';
    octLbl.textContent = _baseOctave;
    _octaveLabel = octLbl;
    octGroup.appendChild(octLbl);

    var octUp = document.createElement('button');
    octUp.className = 'steelpan-oct-btn';
    octUp.textContent = '+';
    octUp.addEventListener('pointerdown', function(e) {
      e.preventDefault();
      e.stopPropagation();
      _onOctaveChange(1);
    });
    octGroup.appendChild(octUp);

    bar.appendChild(octGroup);
    return bar;
  }

  function _buildLeftPanel(isPhone) {
    var panel = document.createElement('div');
    panel.className = 'steelpan-left-panel';
    var panelWidth = isPhone ? LEFT_PANEL_WIDTH_PHONE_PX : LEFT_PANEL_WIDTH_PX;
    panel.style.width = panelWidth + 'px';
    panel.style.flex = '0 0 ' + panelWidth + 'px';

    // Root note header
    var header = document.createElement('div');
    header.className = 'steelpan-left-panel-header';
    header.textContent = SL.t('steelpan.root_header');
    panel.appendChild(header);

    // Root note selector (12 buttons in a vertical column)
    var rootGroup = document.createElement('div');
    rootGroup.className = 'steelpan-root-group';
    _rootButtons = [];
    var ri;
    for (ri = 0; ri < SEMITONES_PER_OCTAVE; ri++) {
      var rbtn = document.createElement('button');
      rbtn.className = 'steelpan-root-btn';
      rbtn.textContent = NOTE_NAMES[ri];
      rbtn.setAttribute('data-note', ri);
      if (ri === _rootNote) {
        rbtn.classList.add('steelpan-root-active');
      }
      rbtn.addEventListener('pointerdown', (function(noteIdx) {
        return function(e) {
          e.preventDefault();
          e.stopPropagation();
          _onRootChange(noteIdx);
        };
      })(ri));
      _rootButtons.push(rbtn);
      rootGroup.appendChild(rbtn);
    }
    panel.appendChild(rootGroup);

    return panel;
  }

  // ============================================================
  // DOM Building: Zone Buttons
  // ============================================================

  function _buildZoneButton(btnDiam, ringClass) {
    var el = document.createElement('div');
    el.className = 'steelpan-zone ' + ringClass;
    el.style.width = btnDiam + 'px';
    el.style.height = btnDiam + 'px';

    var label = document.createElement('span');
    label.className = 'steelpan-zone-label';
    el.appendChild(label);

    return el;
  }

  // ============================================================
  // Build
  // ============================================================

  function _buildSteelPanController(container, opts) {
    _currentNoteOn = opts.noteOn;
    _currentNoteOff = opts.noteOff;
    _baseOctave = (typeof opts.baseOctave === 'number') ? opts.baseOctave : DEFAULT_OCTAVE;

    var isPhone = _isPhoneLayout();
    _isCachedPhone = isPhone;

    var containerW = container.clientWidth;
    var containerH = container.clientHeight;
    var availH = containerH - TOP_BAR_HEIGHT_PX;
    var panelWidth = isPhone ? LEFT_PANEL_WIDTH_PHONE_PX : LEFT_PANEL_WIDTH_PX;
    var rightAreaWidth = containerW - panelWidth;
    var smallerDim = Math.min(rightAreaWidth, availH);
    var panDiam = Math.max(Math.floor(smallerDim * PAN_FILL_RATIO), PAN_MIN_DIAM_PX);
    _cachedPanDiam = panDiam;

    var panRadius = panDiam / 2;
    var panCenter = panDiam / 2;

    // Button diameters
    var innerDiam = isPhone ? INNER_BTN_DIAM_PHONE_PX : INNER_BTN_DIAM_PX;
    var middleDiam = isPhone ? MIDDLE_BTN_DIAM_PHONE_PX : MIDDLE_BTN_DIAM_PX;
    var outerDiam = isPhone ? OUTER_BTN_DIAM_PHONE_PX : OUTER_BTN_DIAM_PX;

    // Ring radii
    var innerRingR = panRadius * INNER_RING_FRAC;
    var middleRingR = panRadius * MIDDLE_RING_FRAC;
    var outerRingR = panRadius * OUTER_RING_FRAC;

    var activeCount = _activeRingCount();

    // Wrapper
    var wrapper = document.createElement('div');
    wrapper.className = 'steelpan-wrapper';
    _wrapperEl = wrapper;

    // Top bar
    var topBar = _buildTopBar();
    wrapper.appendChild(topBar);

    // Body row: left panel + pan area
    var bodyRow = document.createElement('div');
    bodyRow.className = 'steelpan-body-row';

    // Left panel with root buttons
    var leftPanel = _buildLeftPanel(isPhone);
    bodyRow.appendChild(leftPanel);

    // Pan area (centers the pan circle)
    var panArea = document.createElement('div');
    panArea.className = 'steelpan-pan-area';
    panArea.style.touchAction = 'none';

    // Pan circle
    var panEl = document.createElement('div');
    panEl.className = 'steelpan-pan';
    panEl.style.width = panDiam + 'px';
    panEl.style.height = panDiam + 'px';

    // Build inner ring (3 triad zones)
    _innerZones = [];
    var ii;
    for (ii = 0; ii < INNER_ZONE_COUNT; ii++) {
      var iEl = _buildZoneButton(innerDiam, 'steelpan-zone-inner');
      _positionZoneEl(iEl, panCenter, innerRingR, ii, INNER_ZONE_COUNT, innerDiam);
      panEl.appendChild(iEl);
      _innerZones.push({ el: iEl, midi: 0, key: _zoneKey('inner', ii) });
    }

    // Build middle ring (up to 7 scale zones)
    _middleZones = [];
    var mi;
    for (mi = 0; mi < MAX_RING_ZONES; mi++) {
      var mEl = _buildZoneButton(middleDiam, 'steelpan-zone-middle');
      _positionZoneEl(mEl, panCenter, middleRingR, mi, activeCount, middleDiam);
      if (mi >= activeCount) {
        mEl.style.display = 'none';
      }
      panEl.appendChild(mEl);
      _middleZones.push({ el: mEl, midi: 0, key: _zoneKey('middle', mi) });
    }

    // Build outer ring (up to 7 zones, one octave up)
    _outerZones = [];
    var oi;
    for (oi = 0; oi < MAX_RING_ZONES; oi++) {
      var oEl = _buildZoneButton(outerDiam, 'steelpan-zone-outer');
      _positionZoneEl(oEl, panCenter, outerRingR, oi, activeCount, outerDiam);
      if (oi >= activeCount) {
        oEl.style.display = 'none';
      }
      panEl.appendChild(oEl);
      _outerZones.push({ el: oEl, midi: 0, key: _zoneKey('outer', oi) });
    }

    panArea.appendChild(panEl);

    // Calculate initial note assignments
    _recalcNotes();

    // Pointer events on pan area
    panArea.addEventListener('pointerdown', _onPointerDown);
    panArea.addEventListener('pointermove', _onPointerMove);
    panArea.addEventListener('pointerup', _onPointerUp);
    panArea.addEventListener('pointercancel', _onPointerUp);

    bodyRow.appendChild(panArea);
    wrapper.appendChild(bodyRow);
    container.appendChild(wrapper);
  }

  // ============================================================
  // Registration
  // ============================================================

  if (!SL.controllers) { SL.controllers = {}; }
  SL.controllers.steelpan = {
    build: _buildSteelPanController,
    release: _releaseAll
  };

  // ============================================================
  // Panic Hook
  // ============================================================

  if (SL.PanicRegistry && SL.PanicRegistry.register) {
    SL.PanicRegistry.register(
      'voices',
      'steelpan.notes',
      function() { _releaseAll(); },
      function() {
        var count = 0;
        var key;
        for (key in _ringingNotes) {
          if (_ringingNotes.hasOwnProperty(key)) {
            count++;
          }
        }
        var status = null;
        if (count > 0) {
          status = count + ' ringing';
        }
        return status;
      }
    );
  }

})();
