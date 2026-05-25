// SSLI Controller: Tabla (dual hand-drum surface with concentric strike zones)
// ES5 compatible (var, no arrow functions, no template literals)

(function() {
  'use strict';

  var SL = window.SynthLab;

  // Sentinel constants
  var NO_POINTER = null;
  var NO_ZONE = null;

  // ============================================================
  // Constants
  // ============================================================

  // Desktop drum dimensions (px)
  var DAYAN_DIAMETER_PX = 380;
  var BAYAN_DIAMETER_PX = 400;
  var DAYAN_CENTER_X_FRAC = 0.62;
  var BAYAN_CENTER_X_FRAC = 0.30;
  var DRUM_CENTER_Y_FRAC = 0.50;

  // Phone drum dimensions (px)
  var PHONE_DAYAN_DIAMETER_PX = 280;
  var PHONE_BAYAN_DIAMETER_PX = 290;
  var PHONE_DAYAN_CENTER_X_FRAC = 0.65;
  var PHONE_BAYAN_CENTER_X_FRAC = 0.25;

  // Dayan zone radii (px from center) — each ring >= 40px wide
  var DAYAN_ZONE_1_MAX = 54;
  var DAYAN_ZONE_2_MAX = 106;
  var DAYAN_ZONE_3_MAX = 146;
  var DAYAN_ZONE_4_MAX = 190;

  // Bayan zone radii (px from center) — each ring >= 40px wide
  var BAYAN_ZONE_1_MAX = 72;
  var BAYAN_ZONE_2_MAX = 124;
  var BAYAN_ZONE_3_MAX = 200;

  // MIDI notes for each zone
  var DAYAN_MIDI_ZONE_1 = 60;
  var DAYAN_MIDI_ZONE_2 = 62;
  var DAYAN_MIDI_ZONE_3 = 64;
  var DAYAN_MIDI_ZONE_4 = 65;

  var BAYAN_MIDI_ZONE_1 = 48;
  var BAYAN_MIDI_ZONE_2 = 50;
  var BAYAN_MIDI_ZONE_3 = 52;

  // Velocity constants
  var VELOCITY_PRESSURE_BASE = 40;
  var VELOCITY_PRESSURE_RANGE = 87;
  var VELOCITY_FALLBACK_BASE = 80;
  var VELOCITY_FALLBACK_RANGE = 30;
  var VELOCITY_MIN = 40;
  var VELOCITY_MAX = 127;

  // Bayan pitch bend
  var BEND_MAX_CENTS = 200;
  var BEND_CENTS_PER_PX = 2;

  // Combined stroke detection window (ms)
  var COMBINED_STROKE_WINDOW_MS = 50;

  // Visual feedback
  var HIT_FLASH_DURATION_MS = 100;
  var RIPPLE_DURATION_MS = 200;
  var STROKE_LABEL_FADE_MS = 1500;
  var STROKE_LABEL_FONT_SIZE_PX = 24;
  var PHONE_STROKE_LABEL_FONT_SIZE_PX = 16;

  // Colors
  var DAYAN_BODY_GRADIENT_INNER = '#2a1a0e';
  var DAYAN_BODY_GRADIENT_OUTER = '#1a1208';
  var DAYAN_SYAHI_COLOR = '#0a0808';
  var BAYAN_BODY_GRADIENT_INNER = '#1a1a28';
  var BAYAN_BODY_GRADIENT_OUTER = '#0a0a12';
  var BAYAN_SYAHI_COLOR = '#080810';
  var ZONE_BORDER_COLOR = 'rgba(76, 201, 240, 0.15)';
  var HIT_FLASH_COLOR = 'rgba(76, 201, 240, 0.4)';
  var STROKE_LABEL_COLOR = '#e8c87a';
  var BACKGROUND_COLOR = '#0e0e1a';

  // Phone scale factor (applied to zone radii)
  var PHONE_DAYAN_SCALE = PHONE_DAYAN_DIAMETER_PX / DAYAN_DIAMETER_PX;
  var PHONE_BAYAN_SCALE = PHONE_BAYAN_DIAMETER_PX / BAYAN_DIAMETER_PX;

  // Stroke names by drum and zone index
  var DAYAN_STROKE_NAMES = ['Ge', 'Tu', 'Na', 'Te'];
  var BAYAN_STROKE_NAMES = ['Gha', 'ModGe', 'Ka'];
  var COMBINED_STROKE_NAMES = {
    'Ge+Gha': 'Dha',
    'Ge+ModGe': 'Dhin',
    'Tu+Gha': 'Dhin',
    'Tu+ModGe': 'Dhin',
    'Na+Gha': 'Dha',
    'Na+ModGe': 'Dha',
    'Na+Ka': 'TiRaKiTa',
    'Te+Ka': 'Tit'
  };

  // Bayan bendable zones (indices 0 and 1: Gha and ModGe)
  var BAYAN_BENDABLE_ZONE_MAX = 1;

  // ============================================================
  // Drum Zone Definitions
  // ============================================================

  function _makeDayanZones(scale) {
    var s = (typeof scale === 'number') ? scale : 1;
    return [
      { rMin: 0, rMax: Math.round(DAYAN_ZONE_1_MAX * s), midi: DAYAN_MIDI_ZONE_1, name: DAYAN_STROKE_NAMES[0], isSyahi: true },
      { rMin: Math.round(DAYAN_ZONE_1_MAX * s), rMax: Math.round(DAYAN_ZONE_2_MAX * s), midi: DAYAN_MIDI_ZONE_2, name: DAYAN_STROKE_NAMES[1], isSyahi: false },
      { rMin: Math.round(DAYAN_ZONE_2_MAX * s), rMax: Math.round(DAYAN_ZONE_3_MAX * s), midi: DAYAN_MIDI_ZONE_3, name: DAYAN_STROKE_NAMES[2], isSyahi: false },
      { rMin: Math.round(DAYAN_ZONE_3_MAX * s), rMax: Math.round(DAYAN_ZONE_4_MAX * s), midi: DAYAN_MIDI_ZONE_4, name: DAYAN_STROKE_NAMES[3], isSyahi: false }
    ];
  }

  function _makeBayanZones(scale) {
    var s = (typeof scale === 'number') ? scale : 1;
    return [
      { rMin: 0, rMax: Math.round(BAYAN_ZONE_1_MAX * s), midi: BAYAN_MIDI_ZONE_1, name: BAYAN_STROKE_NAMES[0], isSyahi: true, bendable: true },
      { rMin: Math.round(BAYAN_ZONE_1_MAX * s), rMax: Math.round(BAYAN_ZONE_2_MAX * s), midi: BAYAN_MIDI_ZONE_2, name: BAYAN_STROKE_NAMES[1], isSyahi: false, bendable: true },
      { rMin: Math.round(BAYAN_ZONE_2_MAX * s), rMax: Math.round(BAYAN_ZONE_3_MAX * s), midi: BAYAN_MIDI_ZONE_3, name: BAYAN_STROKE_NAMES[2], isSyahi: false, bendable: false }
    ];
  }

  // ============================================================
  // State
  // ============================================================

  var _activePointers = { dayan: null, bayan: null };
  var _activeZones = { dayan: null, bayan: null };
  var _activeMidi = { dayan: -1, bayan: -1 };
  var _hitTimestamps = { dayan: 0, bayan: 0 };
  var _bayanPointerStartY = 0;
  var _strokeLabelTimer = null;
  var _strokeLabelEl = null;
  var _ripplePool = [];
  var _currentNoteOn = null;
  var _currentNoteOff = null;
  var _currentApplyPitchBend = null;
  var _currentResetPitchBend = null;
  var _dayanContainer = null;
  var _bayanContainer = null;
  var _dayanZoneEls = [];
  var _bayanZoneEls = [];
  var _wrapperEl = null;

  // ============================================================
  // Helpers
  // ============================================================

  function _clampVelocity(v) {
    if (v < VELOCITY_MIN) { return VELOCITY_MIN; }
    if (v > VELOCITY_MAX) { return VELOCITY_MAX; }
    return v;
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

  function _distance(x1, y1, x2, y2) {
    var dx = x1 - x2;
    var dy = y1 - y2;
    return Math.sqrt((dx * dx) + (dy * dy));
  }

  function _hitTestZones(dist, zones) {
    var zoneIdx = -1;
    var zi;
    for (zi = 0; zi < zones.length; zi++) {
      var isInRange = (dist >= zones[zi].rMin) && (dist < zones[zi].rMax);
      if (isInRange) {
        zoneIdx = zi;
        break;
      }
    }
    return zoneIdx;
  }

  function _isPhoneLayout() {
    var layoutAttr = document.documentElement.getAttribute('data-layout') || '';
    var isPhone = (layoutAttr === 'phone') || (layoutAttr === 'phone-land');
    return isPhone;
  }

  // ============================================================
  // Visual Feedback
  // ============================================================

  function _flashZone(zoneEl) {
    if (!zoneEl) { return; }
    zoneEl.classList.add('tabla-zone-hit');
    setTimeout(function() {
      zoneEl.classList.remove('tabla-zone-hit');
    }, HIT_FLASH_DURATION_MS);
  }

  function _spawnRipple(drumContainer, localX, localY) {
    if (!drumContainer) { return; }
    var ripple = document.createElement('div');
    ripple.className = 'tabla-ripple';
    ripple.style.left = localX + 'px';
    ripple.style.top = localY + 'px';
    drumContainer.appendChild(ripple);
    setTimeout(function() {
      if (ripple.parentNode) {
        ripple.parentNode.removeChild(ripple);
      }
    }, RIPPLE_DURATION_MS + 50);
  }

  function _showStrokeLabel(text) {
    if (!_strokeLabelEl) { return; }
    if (_strokeLabelTimer) {
      clearTimeout(_strokeLabelTimer);
      _strokeLabelTimer = null;
    }
    _strokeLabelEl.textContent = text;
    _strokeLabelEl.style.opacity = '1';
    _strokeLabelTimer = setTimeout(function() {
      _strokeLabelEl.style.opacity = '0';
      _strokeLabelTimer = null;
    }, STROKE_LABEL_FADE_MS);
  }

  function _getCombinedStrokeName(dayanName, bayanName) {
    var key = dayanName + '+' + bayanName;
    var combined = COMBINED_STROKE_NAMES[key];
    var result;
    if (combined) {
      result = combined;
    } else {
      result = dayanName + '+' + bayanName;
    }
    return result;
  }

  function _checkCombinedStroke(currentDrum) {
    var now = Date.now();
    var otherDrum = (currentDrum === 'dayan') ? 'bayan' : 'dayan';
    var timeDiff = Math.abs(_hitTimestamps[currentDrum] - _hitTimestamps[otherDrum]);
    var otherActive = (_activeZones[otherDrum] !== NO_ZONE);
    var withinWindow = (timeDiff < COMBINED_STROKE_WINDOW_MS);
    if (otherActive && withinWindow) {
      var dayanName = _activeZones.dayan ? _activeZones.dayan.name : '';
      var bayanName = _activeZones.bayan ? _activeZones.bayan.name : '';
      if (dayanName && bayanName) {
        _showStrokeLabel(_getCombinedStrokeName(dayanName, bayanName));
      }
    } else {
      var zone = _activeZones[currentDrum];
      if (zone) {
        _showStrokeLabel(zone.name);
      }
    }
  }

  // ============================================================
  // Pointer Handling
  // ============================================================

  function _getDrumInfo(e, dayanEl, bayanEl, dayanZones, bayanZones) {
    var dayanRect = dayanEl.getBoundingClientRect();
    var bayanRect = bayanEl.getBoundingClientRect();
    var dayanCx = dayanRect.left + (dayanRect.width / 2);
    var dayanCy = dayanRect.top + (dayanRect.height / 2);
    var bayanCx = bayanRect.left + (bayanRect.width / 2);
    var bayanCy = bayanRect.top + (bayanRect.height / 2);

    var dayanDist = _distance(e.clientX, e.clientY, dayanCx, dayanCy);
    var bayanDist = _distance(e.clientX, e.clientY, bayanCx, bayanCy);

    var dayanOuterR = dayanZones[dayanZones.length - 1].rMax;
    var bayanOuterR = bayanZones[bayanZones.length - 1].rMax;

    var dayanHit = (dayanDist < dayanOuterR);
    var bayanHit = (bayanDist < bayanOuterR);

    var result = { drum: null, dist: 0, localX: 0, localY: 0, zones: null };

    if (dayanHit && bayanHit) {
      if (dayanDist <= bayanDist) {
        result.drum = 'dayan';
        result.dist = dayanDist;
        result.localX = e.clientX - dayanRect.left;
        result.localY = e.clientY - dayanRect.top;
        result.zones = dayanZones;
      } else {
        result.drum = 'bayan';
        result.dist = bayanDist;
        result.localX = e.clientX - bayanRect.left;
        result.localY = e.clientY - bayanRect.top;
        result.zones = bayanZones;
      }
    } else if (dayanHit) {
      result.drum = 'dayan';
      result.dist = dayanDist;
      result.localX = e.clientX - dayanRect.left;
      result.localY = e.clientY - dayanRect.top;
      result.zones = dayanZones;
    } else if (bayanHit) {
      result.drum = 'bayan';
      result.dist = bayanDist;
      result.localX = e.clientX - bayanRect.left;
      result.localY = e.clientY - bayanRect.top;
      result.zones = bayanZones;
    }

    return result;
  }

  function _releasePointerForDrum(drumName) {
    var midi = _activeMidi[drumName];
    if ((midi >= 0) && _currentNoteOff) {
      _currentNoteOff(midi);
    }
    if ((drumName === 'bayan') && _currentResetPitchBend) {
      _currentResetPitchBend();
    }
    _activePointers[drumName] = null;
    _activeZones[drumName] = null;
    _activeMidi[drumName] = -1;
  }

  function _releaseAll() {
    _releasePointerForDrum('dayan');
    _releasePointerForDrum('bayan');
  }

  function _onPointerDown(e, dayanEl, bayanEl, dayanZones, bayanZones) {
    e.preventDefault();
    var info = _getDrumInfo(e, dayanEl, bayanEl, dayanZones, bayanZones);
    if (!info.drum) { return; }

    var zoneIdx = _hitTestZones(info.dist, info.zones);
    if (zoneIdx < 0) { return; }

    var zone = info.zones[zoneIdx];
    var velocity = _computeVelocity(e.pressure);

    var prevPointer = _activePointers[info.drum];
    if (prevPointer !== NO_POINTER) {
      _releasePointerForDrum(info.drum);
    }

    _activePointers[info.drum] = e.pointerId;
    _activeZones[info.drum] = zone;
    _activeMidi[info.drum] = zone.midi;
    _hitTimestamps[info.drum] = Date.now();

    if (_currentNoteOn) {
      _currentNoteOn(zone.midi, velocity);
    }

    var zoneEls = (info.drum === 'dayan') ? _dayanZoneEls : _bayanZoneEls;
    _flashZone(zoneEls[zoneIdx]);
    _spawnRipple(
      (info.drum === 'dayan') ? dayanEl : bayanEl,
      info.localX,
      info.localY
    );

    if ((info.drum === 'bayan') && zone.bendable) {
      _bayanPointerStartY = e.clientY;
    }

    _checkCombinedStroke(info.drum);
  }

  function _onPointerMove(e) {
    var isBayanActive = (_activePointers.bayan !== NO_POINTER) && (_activePointers.bayan === e.pointerId);
    if (!isBayanActive) { return; }

    var zone = _activeZones.bayan;
    var isBendable = (zone && zone.bendable);
    if (!isBendable) { return; }

    var dragDistY = e.clientY - _bayanPointerStartY;
    var bendCents = -1 * Math.min(BEND_MAX_CENTS, Math.abs(dragDistY) * BEND_CENTS_PER_PX);
    if (dragDistY < 0) {
      bendCents = Math.abs(bendCents);
    }

    if (_currentApplyPitchBend) {
      _currentApplyPitchBend(bendCents);
    }
  }

  function _onPointerUp(e) {
    if (_activePointers.dayan === e.pointerId) {
      _releasePointerForDrum('dayan');
    }
    if (_activePointers.bayan === e.pointerId) {
      _releasePointerForDrum('bayan');
    }
  }

  function _onPointerCancel(e) {
    _onPointerUp(e);
  }

  // Document-level safety for release outside surface
  function _documentPointerUp(e) {
    if (_activePointers.dayan === e.pointerId) {
      _releasePointerForDrum('dayan');
    }
    if (_activePointers.bayan === e.pointerId) {
      _releasePointerForDrum('bayan');
    }
  }
  document.addEventListener('pointerup', _documentPointerUp);
  document.addEventListener('pointercancel', _documentPointerUp);

  // ============================================================
  // Zone DOM Builders
  // ============================================================

  function _buildZoneRing(zone, drumDiameter, isDayan) {
    var el = document.createElement('div');
    el.className = 'tabla-zone';
    var diameter = zone.rMax * 2;
    var offset = (drumDiameter / 2) - zone.rMax;
    el.style.width = diameter + 'px';
    el.style.height = diameter + 'px';
    el.style.left = offset + 'px';
    el.style.top = offset + 'px';
    el.style.borderRadius = '50%';
    el.style.position = 'absolute';
    el.style.boxSizing = 'border-box';
    el.style.pointerEvents = 'none';

    if (zone.isSyahi) {
      var syahiColor = isDayan ? DAYAN_SYAHI_COLOR : BAYAN_SYAHI_COLOR;
      el.style.background = syahiColor;
    }
    // Non-syahi zones get their background from CSS (bayan=gold, dayan=teal)
    // Border also set via CSS for color-matched zones
    return el;
  }

  function _buildDrumContainer(zones, drumDiameter, isDayan) {
    var container = document.createElement('div');
    container.className = isDayan ? 'tabla-drum tabla-dayan' : 'tabla-drum tabla-bayan';
    container.style.width = drumDiameter + 'px';
    container.style.height = drumDiameter + 'px';
    container.style.borderRadius = '50%';
    container.style.position = 'absolute';
    container.style.overflow = 'hidden';
    container.style.touchAction = 'none';

    var gradInner = isDayan ? DAYAN_BODY_GRADIENT_INNER : BAYAN_BODY_GRADIENT_INNER;
    var gradOuter = isDayan ? DAYAN_BODY_GRADIENT_OUTER : BAYAN_BODY_GRADIENT_OUTER;
    container.style.background = 'radial-gradient(circle at center, ' + gradInner + ' 0%, ' + gradOuter + ' 100%)';
    container.style.boxShadow = '0 0 30px rgba(0, 0, 0, 0.6), inset 0 0 20px rgba(0, 0, 0, 0.3)';

    var zoneEls = [];
    var zi;
    for (zi = zones.length - 1; zi >= 0; zi--) {
      var zoneEl = _buildZoneRing(zones[zi], drumDiameter, isDayan);
      container.appendChild(zoneEl);
      zoneEls.unshift(zoneEl);
    }

    return { el: container, zoneEls: zoneEls };
  }

  // ============================================================
  // Build
  // ============================================================

  function _buildTablaController(container, opts) {
    var noteOn = opts.noteOn;
    var noteOff = opts.noteOff;
    var applyPitchBend = opts.applyPitchBend;
    var resetPitchBendFn = opts.resetPitchBendFn;

    _currentNoteOn = noteOn;
    _currentNoteOff = noteOff;
    _currentApplyPitchBend = applyPitchBend;
    _currentResetPitchBend = resetPitchBendFn;

    var isPhone = _isPhoneLayout();
    var dayanDiam = isPhone ? PHONE_DAYAN_DIAMETER_PX : DAYAN_DIAMETER_PX;
    var bayanDiam = isPhone ? PHONE_BAYAN_DIAMETER_PX : BAYAN_DIAMETER_PX;
    var dayanXFrac = isPhone ? PHONE_DAYAN_CENTER_X_FRAC : DAYAN_CENTER_X_FRAC;
    var bayanXFrac = isPhone ? PHONE_BAYAN_CENTER_X_FRAC : BAYAN_CENTER_X_FRAC;
    var dayanScale = isPhone ? PHONE_DAYAN_SCALE : 1;
    var bayanScale = isPhone ? PHONE_BAYAN_SCALE : 1;
    var labelFontSize = isPhone ? PHONE_STROKE_LABEL_FONT_SIZE_PX : STROKE_LABEL_FONT_SIZE_PX;

    var dayanZones = _makeDayanZones(dayanScale);
    var bayanZones = _makeBayanZones(bayanScale);

    var wrapper = document.createElement('div');
    wrapper.className = 'tabla-wrapper';
    _wrapperEl = wrapper;

    var playfield = document.createElement('div');
    playfield.className = 'tabla-playfield';
    playfield.style.position = 'relative';
    playfield.style.width = '100%';
    playfield.style.height = '100%';
    playfield.style.overflow = 'hidden';
    playfield.style.background = BACKGROUND_COLOR;

    // Build drums
    var bayanResult = _buildDrumContainer(bayanZones, bayanDiam, false);
    var bayanEl = bayanResult.el;
    _bayanZoneEls = bayanResult.zoneEls;
    _bayanContainer = bayanEl;
    playfield.appendChild(bayanEl);

    var dayanResult = _buildDrumContainer(dayanZones, dayanDiam, true);
    var dayanEl = dayanResult.el;
    _dayanZoneEls = dayanResult.zoneEls;
    _dayanContainer = dayanEl;
    playfield.appendChild(dayanEl);

    // Position drums using percentage-based centering
    bayanEl.style.left = 'calc(' + (bayanXFrac * 100) + '% - ' + (bayanDiam / 2) + 'px)';
    bayanEl.style.top = 'calc(' + (DRUM_CENTER_Y_FRAC * 100) + '% - ' + (bayanDiam / 2) + 'px)';
    dayanEl.style.left = 'calc(' + (dayanXFrac * 100) + '% - ' + (dayanDiam / 2) + 'px)';
    dayanEl.style.top = 'calc(' + (DRUM_CENTER_Y_FRAC * 100) + '% - ' + (dayanDiam / 2) + 'px)';

    // Drum labels
    var bayanLabel = document.createElement('div');
    bayanLabel.className = 'tabla-drum-label';
    bayanLabel.textContent = SL.t('tabla.bayan');
    bayanLabel.style.position = 'absolute';
    bayanLabel.style.left = 'calc(' + (bayanXFrac * 100) + '%)';
    bayanLabel.style.bottom = '20px';
    bayanLabel.style.transform = 'translateX(-50%)';
    playfield.appendChild(bayanLabel);

    var dayanLabel = document.createElement('div');
    dayanLabel.className = 'tabla-drum-label';
    dayanLabel.textContent = SL.t('tabla.dayan');
    dayanLabel.style.position = 'absolute';
    dayanLabel.style.left = 'calc(' + (dayanXFrac * 100) + '%)';
    dayanLabel.style.bottom = '20px';
    dayanLabel.style.transform = 'translateX(-50%)';
    playfield.appendChild(dayanLabel);

    // Stroke label bar
    var strokeLabel = document.createElement('div');
    strokeLabel.className = 'tabla-stroke-label';
    strokeLabel.style.fontSize = labelFontSize + 'px';
    _strokeLabelEl = strokeLabel;
    playfield.appendChild(strokeLabel);

    // Pointer events on playfield
    playfield.addEventListener('pointerdown', function(e) {
      _onPointerDown(e, dayanEl, bayanEl, dayanZones, bayanZones);
    });
    playfield.addEventListener('pointermove', function(e) {
      _onPointerMove(e);
    });
    playfield.addEventListener('pointerup', function(e) {
      _onPointerUp(e);
    });
    playfield.addEventListener('pointercancel', function(e) {
      _onPointerCancel(e);
    });

    wrapper.appendChild(playfield);
    container.appendChild(wrapper);

    // ResizeObserver: recompute zone radii when container resizes
    if (typeof ResizeObserver !== 'undefined') {
      var resizeObserver = new ResizeObserver(function() {
        var pfW = playfield.clientWidth;
        var pfH = playfield.clientHeight;
        var hasSize = (pfW > 0) && (pfH > 0);
        if (!hasSize) { return; }

        // Recompute scale based on available space vs reference diameters
        var refDayanDiam = isPhone ? PHONE_DAYAN_DIAMETER_PX : DAYAN_DIAMETER_PX;
        var refBayanDiam = isPhone ? PHONE_BAYAN_DIAMETER_PX : BAYAN_DIAMETER_PX;
        var totalRefW = refDayanDiam + refBayanDiam + 40;
        var scaleByW = pfW / totalRefW;
        var scaleByH = pfH / Math.max(refDayanDiam, refBayanDiam);
        var fitScale = Math.min(scaleByW, scaleByH, 1.3);
        if (fitScale < 0.5) { fitScale = 0.5; }

        var newDayanDiam = Math.round(refDayanDiam * fitScale);
        var newBayanDiam = Math.round(refBayanDiam * fitScale);
        var newDayanScale = newDayanDiam / DAYAN_DIAMETER_PX;
        var newBayanScale = newBayanDiam / BAYAN_DIAMETER_PX;

        var newDayanZones = _makeDayanZones(newDayanScale);
        var newBayanZones = _makeBayanZones(newBayanScale);

        // Update dayan container and zone elements
        dayanEl.style.width = newDayanDiam + 'px';
        dayanEl.style.height = newDayanDiam + 'px';
        dayanEl.style.left = 'calc(' + (dayanXFrac * 100) + '% - ' + (newDayanDiam / 2) + 'px)';
        dayanEl.style.top = 'calc(' + (DRUM_CENTER_Y_FRAC * 100) + '% - ' + (newDayanDiam / 2) + 'px)';
        for (var di = 0; di < newDayanZones.length; di++) {
          var dz = newDayanZones[di];
          var dDiam = dz.rMax * 2;
          var dOff = (newDayanDiam / 2) - dz.rMax;
          _dayanZoneEls[di].style.width = dDiam + 'px';
          _dayanZoneEls[di].style.height = dDiam + 'px';
          _dayanZoneEls[di].style.left = dOff + 'px';
          _dayanZoneEls[di].style.top = dOff + 'px';
        }

        // Update bayan container and zone elements
        bayanEl.style.width = newBayanDiam + 'px';
        bayanEl.style.height = newBayanDiam + 'px';
        bayanEl.style.left = 'calc(' + (bayanXFrac * 100) + '% - ' + (newBayanDiam / 2) + 'px)';
        bayanEl.style.top = 'calc(' + (DRUM_CENTER_Y_FRAC * 100) + '% - ' + (newBayanDiam / 2) + 'px)';
        for (var bi = 0; bi < newBayanZones.length; bi++) {
          var bz = newBayanZones[bi];
          var bDiam = bz.rMax * 2;
          var bOff = (newBayanDiam / 2) - bz.rMax;
          _bayanZoneEls[bi].style.width = bDiam + 'px';
          _bayanZoneEls[bi].style.height = bDiam + 'px';
          _bayanZoneEls[bi].style.left = bOff + 'px';
          _bayanZoneEls[bi].style.top = bOff + 'px';
        }

        // Update the zone arrays used by hit detection (closure captures)
        dayanZones.length = 0;
        for (var dzi = 0; dzi < newDayanZones.length; dzi++) {
          dayanZones.push(newDayanZones[dzi]);
        }
        bayanZones.length = 0;
        for (var bzi = 0; bzi < newBayanZones.length; bzi++) {
          bayanZones.push(newBayanZones[bzi]);
        }
      });
      resizeObserver.observe(playfield);
    }
  }

  // ============================================================
  // Register
  // ============================================================

  if (!SL.controllers) { SL.controllers = {}; }
  SL.controllers.tabla = {
    build: _buildTablaController,
    release: _releaseAll
  };

  // ============================================================
  // Panic hook
  // ============================================================

  if (SL.PanicRegistry && SL.PanicRegistry.register) {
    SL.PanicRegistry.register(
      'voices',
      'tabla.zones',
      function() { _releaseAll(); },
      function() {
        var dayanActive = (_activePointers.dayan !== NO_POINTER);
        var bayanActive = (_activePointers.bayan !== NO_POINTER);
        var status = null;
        if (dayanActive || bayanActive) {
          var dayanPart = dayanActive ? 'dayan' : '';
          var separatorPart = (dayanActive && bayanActive) ? '+' : '';
          var bayanPart = bayanActive ? 'bayan' : '';
          status = dayanPart + separatorPart + bayanPart;
        }
        return status;
      }
    );
  }

})();
