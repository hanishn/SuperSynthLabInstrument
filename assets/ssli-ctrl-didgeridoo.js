// SSLI Controller: Didgeridoo (continuous drone with articulation buttons)
// ES5 compatible (var, no arrow functions, no template literals)

(function() {
  'use strict';

  var SL = window.SynthLab;

  // ============================================================
  // Constants
  // ============================================================

  var SEMITONES_PER_OCTAVE = 12;
  var OCTAVE_BASE_OFFSET = 1;

  // Layout ratios
  var LEFT_STRIP_WIDTH_RATIO = 0.15;
  var DRONE_ZONE_WIDTH_RATIO = 0.70;
  var RIGHT_STRIP_WIDTH_RATIO = 0.15;

  // Drone zone expression mapping
  var FORMANT_MIN_HZ = 200;
  var FORMANT_MAX_HZ = 3000;
  var LN_FORMANT_MIN = Math.log(FORMANT_MIN_HZ);
  var LN_FORMANT_MAX = Math.log(FORMANT_MAX_HZ);
  var GAIN_MIN = 0.2;
  var GAIN_MAX = 1.0;

  // Crosshair / cursor
  var CROSSHAIR_OPACITY = 0.5;
  var CROSSHAIR_COLOR_R = 232;
  var CROSSHAIR_COLOR_G = 160;
  var CROSSHAIR_COLOR_B = 64;

  // Glow intensity range (maps to gain 0..1)
  var GLOW_OPACITY_MIN = 0.0;
  var GLOW_OPACITY_MAX = 0.15;

  // Articulation timing
  var ARTIC_PITCH_SPIKE_TA_CENTS = 200;
  var ARTIC_PITCH_SPIKE_TA_DECAY_MS = 50;
  var ARTIC_CUTOFF_DROP_KA_HZ = 200;
  var ARTIC_CUTOFF_DROP_KA_MS = 80;
  var ARTIC_PITCH_SPIKE_DA_CENTS = 100;
  var ARTIC_PITCH_SPIKE_DA_DECAY_MS = 60;
  var ARTIC_GAIN_SPIKE_HU = 1.0;
  var ARTIC_GAIN_SPIKE_HU_MS = 100;
  var ARTIC_FORMANT_JUMP_YO_HZ = 2500;
  var ARTIC_FORMANT_JUMP_YO_MS = 100;
  var ARTIC_PF_OSCILLATION_CENTS = 50;
  var ARTIC_PF_RATE_HZ = 15;
  var ARTIC_PF_DURATION_MS = 150;
  var ARTIC_PF_FRAME_MS = 16;

  // Overtone intervals (semitones above base)
  var OVERTONE_X2_SEMITONES = 12;
  var OVERTONE_X3_SEMITONES = 19;
  var OVERTONE_X4_SEMITONES = 24;

  // Desktop button sizes
  var ARTIC_BTN_WIDTH_PX = 60;
  var ARTIC_BTN_HEIGHT_PX = 48;

  // Phone button sizes
  var ARTIC_BTN_PHONE_WIDTH_PX = 44;
  var ARTIC_BTN_PHONE_HEIGHT_PX = 36;
  var ARTIC_PHONE_FONT_SIZE_PX = 10;
  var ARTIC_DESKTOP_FONT_SIZE_PX = 13;

  // Articulation definitions
  var ARTICULATIONS = [
    { id: 'ta', label: 'ta' },
    { id: 'ka', label: 'ka' },
    { id: 'da', label: 'da' },
    { id: 'hu', label: 'hu' },
    { id: 'yo', label: 'yo' },
    { id: 'pf', label: 'pf' }
  ];
  var ARTIC_COUNT = ARTICULATIONS.length;

  // Overtone definitions
  var OVERTONES = [
    { id: 'x2', label: 'x2', semitones: OVERTONE_X2_SEMITONES },
    { id: 'x3', label: 'x3', semitones: OVERTONE_X3_SEMITONES },
    { id: 'x4', label: 'x4', semitones: OVERTONE_X4_SEMITONES }
  ];
  var OVERTONE_COUNT = OVERTONES.length;

  // Overtone toggle state: tracks which overtone is latched (by semitones), -1 = none
  var _latchedOvertone = -1;
  // DOM refs for overtone buttons (keyed by overtone id)
  var _overtoneButtonEls = {};

  // ============================================================
  // State
  // ============================================================

  var _droneActive = false;
  var _baseMidi = -1;
  var _currentMidi = -1;
  var _lastXFrac = 0.5;
  var _lastYFrac = 0.5;
  var _lastGain = GAIN_MIN;
  var _activeOvertone = -1;

  // Cached DOM refs
  var _droneZoneEl = null;
  var _crosshairH = null;
  var _crosshairV = null;
  var _cursorDot = null;
  var _glowOverlay = null;
  var _readoutEl = null;

  // Cached callbacks
  var _noteOnFn = null;
  var _noteOffFn = null;
  var _applyPitchBendFn = null;
  var _resetPitchBendFn = null;

  // Articulation animation state
  var _articTimerId = 0;
  var _pfAnimId = 0;
  var _pfAnimStart = 0;

  // ============================================================
  // Helpers
  // ============================================================

  function _clamp01(v) {
    if (v < 0) { return 0; }
    if (v > 1) { return 1; }
    return v;
  }

  function _applyDroneExpression(xFrac, yFrac) {
    var cutoffHz = Math.exp(LN_FORMANT_MIN + xFrac * (LN_FORMANT_MAX - LN_FORMANT_MIN));
    var gain = GAIN_MIN + yFrac * (GAIN_MAX - GAIN_MIN);
    _lastGain = gain;
    if (SL.audio && SL.audio.setExpression) {
      SL.audio.setExpression(cutoffHz, gain);
    }
  }

  function _clearDroneExpression() {
    if (SL.audio && SL.audio.clearExpression) {
      SL.audio.clearExpression();
    }
  }

  function _updateCrosshair(relX, relY, padW, padH) {
    var crossColor = 'rgba(' + CROSSHAIR_COLOR_R + ',' + CROSSHAIR_COLOR_G + ',' + CROSSHAIR_COLOR_B + ',' + CROSSHAIR_OPACITY + ')';
    if (_crosshairH) {
      _crosshairH.style.top = relY + 'px';
      _crosshairH.style.display = 'block';
      _crosshairH.style.background = crossColor;
    }
    if (_crosshairV) {
      _crosshairV.style.left = relX + 'px';
      _crosshairV.style.display = 'block';
      _crosshairV.style.background = crossColor;
    }
    if (_cursorDot) {
      _cursorDot.style.left = relX + 'px';
      _cursorDot.style.top = relY + 'px';
      _cursorDot.style.display = 'block';
    }
    if (_glowOverlay) {
      var gainNorm = _clamp01((_lastGain - GAIN_MIN) / (GAIN_MAX - GAIN_MIN));
      var glowAlpha = GLOW_OPACITY_MIN + gainNorm * (GLOW_OPACITY_MAX - GLOW_OPACITY_MIN);
      _glowOverlay.style.background = 'radial-gradient(ellipse at ' + relX + 'px ' + relY + 'px, rgba(' + CROSSHAIR_COLOR_R + ',' + CROSSHAIR_COLOR_G + ',' + CROSSHAIR_COLOR_B + ',' + glowAlpha + ') 0%, transparent 70%)';
      _glowOverlay.style.display = 'block';
    }
  }

  function _hideCrosshair() {
    if (_crosshairH) { _crosshairH.style.display = 'none'; }
    if (_crosshairV) { _crosshairV.style.display = 'none'; }
    if (_cursorDot) { _cursorDot.style.display = 'none'; }
    if (_glowOverlay) { _glowOverlay.style.display = 'none'; }
    if (_readoutEl) { _readoutEl.textContent = '--'; }
  }

  function _updateReadout(xFrac, yFrac) {
    if (_readoutEl) {
      var cutoffHz = Math.exp(LN_FORMANT_MIN + xFrac * (LN_FORMANT_MAX - LN_FORMANT_MIN));
      var gain = GAIN_MIN + yFrac * (GAIN_MAX - GAIN_MIN);
      var cutoffDisplay = Math.round(cutoffHz);
      var gainDisplay = (gain * 100).toFixed(0);
      _readoutEl.textContent = cutoffDisplay + 'Hz  ' + gainDisplay + '%';
    }
  }

  // ============================================================
  // Drone control
  // ============================================================

  function _startDrone(midi) {
    if (_noteOnFn) {
      _noteOnFn(midi);
    }
    _currentMidi = midi;
    _droneActive = true;
  }

  function _stopDrone() {
    if (_droneActive && _noteOffFn && _currentMidi >= 0) {
      _noteOffFn(_currentMidi);
    }
    _droneActive = false;
    _currentMidi = -1;
    _activeOvertone = -1;
    _latchedOvertone = -1;
    // Clear all overtone button active states
    var btnId;
    for (btnId in _overtoneButtonEls) {
      if (_overtoneButtonEls.hasOwnProperty(btnId)) {
        _overtoneButtonEls[btnId].classList.remove('active');
      }
    }
    _clearDroneExpression();
    _hideCrosshair();
    _cancelArticulations();
  }

  function _cancelArticulations() {
    if (_articTimerId) {
      clearTimeout(_articTimerId);
      _articTimerId = 0;
    }
    if (_pfAnimId) {
      clearTimeout(_pfAnimId);
      _pfAnimId = 0;
    }
    if (_resetPitchBendFn) {
      _resetPitchBendFn();
    }
  }

  // ============================================================
  // Articulation handlers
  // ============================================================

  function _doArticulation(articId) {
    if (!_droneActive) { return; }

    _cancelArticulations();

    if (articId === 'ta') {
      if (_applyPitchBendFn) {
        _applyPitchBendFn(ARTIC_PITCH_SPIKE_TA_CENTS);
        _articTimerId = setTimeout(function() {
          if (_resetPitchBendFn) { _resetPitchBendFn(); }
          _articTimerId = 0;
        }, ARTIC_PITCH_SPIKE_TA_DECAY_MS);
      }
    } else if (articId === 'ka') {
      if (SL.audio && SL.audio.setExpression) {
        SL.audio.setExpression(ARTIC_CUTOFF_DROP_KA_HZ, _lastGain);
        _articTimerId = setTimeout(function() {
          _applyDroneExpression(_lastXFrac, _lastYFrac);
          _articTimerId = 0;
        }, ARTIC_CUTOFF_DROP_KA_MS);
      }
    } else if (articId === 'da') {
      if (_applyPitchBendFn) {
        _applyPitchBendFn(ARTIC_PITCH_SPIKE_DA_CENTS);
        _articTimerId = setTimeout(function() {
          if (_resetPitchBendFn) { _resetPitchBendFn(); }
          _articTimerId = 0;
        }, ARTIC_PITCH_SPIKE_DA_DECAY_MS);
      }
    } else if (articId === 'hu') {
      if (SL.audio && SL.audio.setExpression) {
        var currentCutoff = Math.exp(LN_FORMANT_MIN + _lastXFrac * (LN_FORMANT_MAX - LN_FORMANT_MIN));
        SL.audio.setExpression(currentCutoff, ARTIC_GAIN_SPIKE_HU);
        _articTimerId = setTimeout(function() {
          _applyDroneExpression(_lastXFrac, _lastYFrac);
          _articTimerId = 0;
        }, ARTIC_GAIN_SPIKE_HU_MS);
      }
    } else if (articId === 'yo') {
      if (SL.audio && SL.audio.setExpression) {
        SL.audio.setExpression(ARTIC_FORMANT_JUMP_YO_HZ, _lastGain);
        _articTimerId = setTimeout(function() {
          _applyDroneExpression(_lastXFrac, _lastYFrac);
          _articTimerId = 0;
        }, ARTIC_FORMANT_JUMP_YO_MS);
      }
    } else if (articId === 'pf') {
      _doPfArticulation();
    }
  }

  function _doPfArticulation() {
    if (!_applyPitchBendFn) { return; }
    _pfAnimStart = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    var endTime = _pfAnimStart + ARTIC_PF_DURATION_MS;

    function pfTick() {
      var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      var elapsed = now - _pfAnimStart;
      var isExpired = (elapsed >= ARTIC_PF_DURATION_MS);
      if (isExpired || !_droneActive) {
        if (_resetPitchBendFn) { _resetPitchBendFn(); }
        _pfAnimId = 0;
      } else {
        var phase = (elapsed / 1000) * ARTIC_PF_RATE_HZ * 2 * Math.PI;
        var cents = Math.sin(phase) * ARTIC_PF_OSCILLATION_CENTS;
        _applyPitchBendFn(cents);
        _pfAnimId = setTimeout(pfTick, ARTIC_PF_FRAME_MS);
      }
    }
    pfTick();
  }

  // ============================================================
  // Overtone handlers
  // ============================================================

  function _startOvertone(semitones) {
    if (!_droneActive) { return; }
    if (_activeOvertone === semitones) { return; }

    if (_noteOffFn && _currentMidi >= 0) {
      _noteOffFn(_currentMidi);
    }
    var newMidi = _baseMidi + semitones;
    _currentMidi = newMidi;
    _activeOvertone = semitones;
    if (_noteOnFn) {
      _noteOnFn(newMidi);
    }
    _applyDroneExpression(_lastXFrac, _lastYFrac);
  }

  function _releaseOvertone() {
    if (!_droneActive) { return; }
    var isOvertoneActive = (_activeOvertone >= 0);
    if (isOvertoneActive) {
      if (_noteOffFn && _currentMidi >= 0) {
        _noteOffFn(_currentMidi);
      }
      _currentMidi = _baseMidi;
      _activeOvertone = -1;
      if (_noteOnFn) {
        _noteOnFn(_baseMidi);
      }
      _applyDroneExpression(_lastXFrac, _lastYFrac);
    }
  }

  // ============================================================
  // Release (panic / cleanup)
  // ============================================================

  function _releaseAll() {
    _stopDrone();
  }

  function _documentPointerUp() {
    if (_droneActive) {
      _stopDrone();
    }
  }
  document.addEventListener('pointerup', _documentPointerUp);
  document.addEventListener('pointercancel', _documentPointerUp);

  // ============================================================
  // Build
  // ============================================================

  function _buildDidgeridoo(container, opts) {
    var baseOctave = opts.baseOctave;
    var noteOn = opts.noteOn;
    var noteOff = opts.noteOff;
    var applyPitchBend = opts.applyPitchBend;
    var resetPitchBendFn = opts.resetPitchBendFn;

    _noteOnFn = noteOn;
    _noteOffFn = noteOff;
    _applyPitchBendFn = applyPitchBend;
    _resetPitchBendFn = resetPitchBendFn;
    _baseMidi = (baseOctave + OCTAVE_BASE_OFFSET) * SEMITONES_PER_OCTAVE;

    // Wrapper
    var wrapper = document.createElement('div');
    wrapper.className = 'ssli-didgeridoo-wrapper';

    // ---------- Main row: left strip + drone zone + right strip ----------
    var mainRow = document.createElement('div');
    mainRow.className = 'ssli-didgeridoo-main-row';

    // ---------- Left articulation strip ----------
    var leftStrip = document.createElement('div');
    leftStrip.className = 'ssli-didgeridoo-artic-strip ssli-didgeridoo-artic-left';

    var articHeader = document.createElement('div');
    articHeader.className = 'ssli-didgeridoo-strip-header';
    articHeader.textContent = SL.t('didgeridoo.artic_header');
    leftStrip.appendChild(articHeader);

    var ai;
    for (ai = 0; ai < ARTIC_COUNT; ai++) {
      (function(artic) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ssli-didgeridoo-artic-btn';
        btn.textContent = artic.label;
        btn.setAttribute('data-artic', artic.id);

        btn.addEventListener('pointerdown', function(e) {
          e.preventDefault();
          e.stopPropagation();
          btn.classList.add('active');
          _doArticulation(artic.id);
        });
        btn.addEventListener('pointerup', function(e) {
          e.preventDefault();
          btn.classList.remove('active');
        });
        btn.addEventListener('pointerleave', function() {
          btn.classList.remove('active');
        });
        btn.addEventListener('pointercancel', function() {
          btn.classList.remove('active');
        });

        leftStrip.appendChild(btn);
      })(ARTICULATIONS[ai]);
    }

    mainRow.appendChild(leftStrip);

    // ---------- Drone zone ----------
    var droneZone = document.createElement('div');
    droneZone.className = 'ssli-didgeridoo-drone-zone';
    _droneZoneEl = droneZone;

    // Glow overlay
    var glowOverlay = document.createElement('div');
    glowOverlay.className = 'ssli-didgeridoo-glow-overlay';
    droneZone.appendChild(glowOverlay);
    _glowOverlay = glowOverlay;

    // Crosshair horizontal
    var crossH = document.createElement('div');
    crossH.className = 'ssli-didgeridoo-crosshair-h';
    droneZone.appendChild(crossH);
    _crosshairH = crossH;

    // Crosshair vertical
    var crossV = document.createElement('div');
    crossV.className = 'ssli-didgeridoo-crosshair-v';
    droneZone.appendChild(crossV);
    _crosshairV = crossV;

    // Cursor dot
    var cursorDot = document.createElement('div');
    cursorDot.className = 'ssli-didgeridoo-cursor-dot';
    droneZone.appendChild(cursorDot);
    _cursorDot = cursorDot;

    // Axis labels
    var xAxisLabel = document.createElement('div');
    xAxisLabel.className = 'ssli-didgeridoo-axis-label ssli-didgeridoo-axis-x';
    xAxisLabel.textContent = SL.t('didgeridoo.axis_x');
    droneZone.appendChild(xAxisLabel);

    var yAxisLabel = document.createElement('div');
    yAxisLabel.className = 'ssli-didgeridoo-axis-label ssli-didgeridoo-axis-y';
    yAxisLabel.textContent = SL.t('didgeridoo.axis_y');
    droneZone.appendChild(yAxisLabel);

    // Idle hint
    var idleHint = document.createElement('div');
    idleHint.className = 'ssli-didgeridoo-idle-hint';
    idleHint.textContent = SL.t('didgeridoo.idle_hint');
    droneZone.appendChild(idleHint);

    // Readout
    var readout = document.createElement('div');
    readout.className = 'ssli-didgeridoo-readout';
    readout.textContent = '--';
    droneZone.appendChild(readout);
    _readoutEl = readout;

    mainRow.appendChild(droneZone);

    // ---------- Right overtone strip ----------
    var rightStrip = document.createElement('div');
    rightStrip.className = 'ssli-didgeridoo-artic-strip ssli-didgeridoo-overtone-right';

    var overtoneHeader = document.createElement('div');
    overtoneHeader.className = 'ssli-didgeridoo-strip-header';
    overtoneHeader.textContent = SL.t('didgeridoo.overtone_header');
    rightStrip.appendChild(overtoneHeader);

    _overtoneButtonEls = {};
    var oi;
    for (oi = 0; oi < OVERTONE_COUNT; oi++) {
      (function(overtone) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ssli-didgeridoo-overtone-btn';
        btn.textContent = overtone.label;
        btn.setAttribute('data-overtone', overtone.id);
        _overtoneButtonEls[overtone.id] = btn;

        btn.addEventListener('pointerdown', function(e) {
          e.preventDefault();
          e.stopPropagation();
          var isCurrentlyLatched = (_latchedOvertone === overtone.semitones);
          if (isCurrentlyLatched) {
            // Toggle OFF: release overtone and clear latch
            _latchedOvertone = -1;
            btn.classList.remove('active');
            _releaseOvertone();
          } else {
            // Toggle ON: unlatch any previous overtone button
            var prevId;
            for (prevId in _overtoneButtonEls) {
              if (_overtoneButtonEls.hasOwnProperty(prevId)) {
                _overtoneButtonEls[prevId].classList.remove('active');
              }
            }
            _latchedOvertone = overtone.semitones;
            btn.classList.add('active');
            _startOvertone(overtone.semitones);
          }
        });

        rightStrip.appendChild(btn);
      })(OVERTONES[oi]);
    }

    mainRow.appendChild(rightStrip);

    wrapper.appendChild(mainRow);
    container.appendChild(wrapper);

    // ---------- Drone zone pointer handling ----------

    function _localCoords(e) {
      var rect = droneZone.getBoundingClientRect();
      var relX = e.clientX - rect.left;
      var relY = e.clientY - rect.top;
      relX = Math.max(0, Math.min(rect.width, relX));
      relY = Math.max(0, Math.min(rect.height, relY));
      return { x: relX, y: relY, w: rect.width, h: rect.height };
    }

    function _applyAtPointer(e) {
      var c = _localCoords(e);
      var xFrac = (c.w > 0) ? (c.x / c.w) : 0.5;
      var yFrac = (c.h > 0) ? (1 - (c.y / c.h)) : 0.5;
      _lastXFrac = xFrac;
      _lastYFrac = yFrac;

      _applyDroneExpression(xFrac, yFrac);
      _updateCrosshair(c.x, c.y, c.w, c.h);
      _updateReadout(xFrac, yFrac);
    }

    function _onPointerDown(e) {
      if (_droneActive) { return; }
      e.preventDefault();
      if (droneZone.setPointerCapture && typeof e.pointerId !== 'undefined') {
        try { droneZone.setPointerCapture(e.pointerId); } catch (err) { /* best effort */ }
      }

      _baseMidi = (baseOctave + OCTAVE_BASE_OFFSET) * SEMITONES_PER_OCTAVE;
      _startDrone(_baseMidi);

      if (idleHint) { idleHint.style.display = 'none'; }
      droneZone.classList.add('active');

      _applyAtPointer(e);
    }

    function _onPointerMove(e) {
      if (!_droneActive) { return; }
      _applyAtPointer(e);
    }

    function _onPointerUp(e) {
      if (!_droneActive) { return; }
      droneZone.classList.remove('active');
      if (idleHint) { idleHint.style.display = ''; }
      _stopDrone();
    }

    droneZone.addEventListener('pointerdown', _onPointerDown);
    droneZone.addEventListener('pointermove', _onPointerMove);
    droneZone.addEventListener('pointerup', _onPointerUp);
    droneZone.addEventListener('pointercancel', function(e) {
      if (droneZone.setPointerCapture && typeof e.pointerId !== 'undefined') {
        try { droneZone.setPointerCapture(e.pointerId); return; } catch (err) { /* fall through */ }
      }
      droneZone.classList.remove('active');
      if (idleHint) { idleHint.style.display = ''; }
      _stopDrone();
    });
  }

  // ============================================================
  // Register
  // ============================================================

  if (!SL.controllers) { SL.controllers = {}; }
  SL.controllers.didgeridoo = {
    build: function(container, opts) {
      _buildDidgeridoo(container, opts);
    },
    release: _releaseAll
  };

  // ============================================================
  // Panic hook
  // ============================================================

  if (SL.PanicRegistry && SL.PanicRegistry.register) {
    SL.PanicRegistry.register(
      'voices',
      'didgeridoo.drone',
      function() { _releaseAll(); },
      function() { return _droneActive ? 'drone active' : null; }
    );
  }

})();
