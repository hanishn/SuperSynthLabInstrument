// SSLI Controller: Vowel Pad (2D formant space with brightness axis)
// ES5 compatible (var, no arrow functions, no template literals)

(function() {
  'use strict';

  var SL = window.SynthLab;
  var NOTES = (SL && SL.NOTES) ? SL.NOTES : ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

  // ============================================================
  // Constants
  // ============================================================

  var SEMITONES_PER_OCTAVE = 12;
  var OCTAVE_BASE_OFFSET = 1;

  var CONTROL_BAR_HEIGHT_PX = 28;

  var CUTOFF_MIN_HZ = 2000;
  var CUTOFF_MAX_HZ = 18000;
  var LN_CUTOFF_MIN = Math.log(CUTOFF_MIN_HZ);
  var LN_CUTOFF_MAX = Math.log(CUTOFF_MAX_HZ);
  var GAIN_MIN = 0.7;
  var GAIN_MAX = 2.0;

  var CURSOR_SIZE_PX = 24;
  var ANCHOR_DOT_SIZE_PX = 20;
  var GRID_V_COUNT = 4;
  var GRID_H_COUNT = 3;

  var ANCHOR_BORDER_OPACITY = 0.5;
  var ANCHOR_FILL_OPACITY = 0.25;

  // Number of formants in the engine (5 formants: F1-F5)
  var NUM_ENGINE_FORMANTS = 5;

  // Vowel anchors: canonical male voice formant values (Peterson & Barney 1952)
  // freqs/amps/bws arrays match the 5-formant engine model exactly
  var VOWEL_ANCHORS = [
    { name: 'OO', xFrac: 0.03, yFrac: 0.70, color: '124, 111, 255',
      freqs: [300, 870, 2240, 3400, 4500], amps: [1.0, 0.50, 0.35, 0.15, 0.08], bws: [70, 100, 150, 250, 300] },
    { name: 'OH', xFrac: 0.25, yFrac: 0.45, color: '208, 96, 128',
      freqs: [570, 840, 2410, 3400, 4500], amps: [1.0, 0.65, 0.45, 0.18, 0.10], bws: [80, 100, 160, 250, 300] },
    { name: 'AH', xFrac: 0.50, yFrac: 0.25, color: '232, 160, 64',
      freqs: [730, 1090, 2440, 3400, 4500], amps: [1.0, 0.75, 0.50, 0.18, 0.10], bws: [90, 110, 170, 250, 300] },
    { name: 'EH', xFrac: 0.75, yFrac: 0.55, color: '200, 216, 48',
      freqs: [530, 1840, 2480, 3400, 4500], amps: [1.0, 0.65, 0.50, 0.20, 0.10], bws: [70, 100, 160, 250, 300] },
    { name: 'EE', xFrac: 0.97, yFrac: 0.75, color: '76, 201, 240',
      freqs: [270, 2290, 3010, 3400, 4500], amps: [1.0, 0.50, 0.35, 0.18, 0.08], bws: [60, 90, 150, 250, 300] }
  ];

  var VOWEL_NAMES = ['OO', 'OH', 'AH', 'EH', 'EE'];

  // ============================================================
  // State
  // ============================================================

  var _isActive = false;
  var _currentMidi = -1;
  var _isSnapMode = false;
  var _currentNoteOff = null;
  var _padEl = null;
  var _cursorEl = null;
  var _readoutEl = null;
  var _idleHintEl = null;
  var _centerDotEl = null;
  var _anchorDots = [];
  var _lastNearestIdx = -1;

  // ============================================================
  // Helpers
  // ============================================================

  function _clamp01(v) {
    if (v < 0) { return 0; }
    if (v > 1) { return 1; }
    return v;
  }

  function _midiToName(midi) {
    var pc = midi % SEMITONES_PER_OCTAVE;
    var oct = Math.floor(midi / SEMITONES_PER_OCTAVE) - 1;
    return NOTES[pc] + oct;
  }

  function _lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function _interpolateFormants(xNorm) {
    var x = _clamp01(xNorm);
    var segCount = VOWEL_ANCHORS.length - 1;
    var segFloat = x * segCount;
    var segIdx = Math.floor(segFloat);
    if (segIdx >= segCount) { segIdx = segCount - 1; }
    var t = segFloat - segIdx;
    var a = VOWEL_ANCHORS[segIdx];
    var b = VOWEL_ANCHORS[segIdx + 1];
    var freqs = [];
    var amps = [];
    var bws = [];
    var fi;
    for (fi = 0; fi < NUM_ENGINE_FORMANTS; fi++) {
      freqs.push(_lerp(a.freqs[fi], b.freqs[fi], t));
      amps.push(_lerp(a.amps[fi], b.amps[fi], t));
      bws.push(_lerp(a.bws[fi], b.bws[fi], t));
    }
    return { freqs: freqs, amps: amps, bws: bws };
  }

  function _findNearestAnchor(xNorm) {
    var x = _clamp01(xNorm);
    var bestIdx = 0;
    var bestDist = Math.abs(x - VOWEL_ANCHORS[0].xFrac);
    var i;
    for (i = 1; i < VOWEL_ANCHORS.length; i++) {
      var dist = Math.abs(x - VOWEL_ANCHORS[i].xFrac);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  function _snapToNearest(xNorm) {
    var idx = _findNearestAnchor(xNorm);
    return VOWEL_ANCHORS[idx].xFrac;
  }

  function _brightnessToExpression(yNorm) {
    var y = _clamp01(yNorm);
    var invY = 1.0 - y;
    var cutoffHz = Math.exp(LN_CUTOFF_MIN + invY * (LN_CUTOFF_MAX - LN_CUTOFF_MIN));
    var gain = GAIN_MIN + invY * (GAIN_MAX - GAIN_MIN);
    return { cutoff: cutoffHz, gain: gain };
  }

  function _setFormants(formantData) {
    // Inject custom vowel data into the formant engine and activate it
    if (SL.formant && SL.formant.setCustomVowelData) {
      SL.formant.setCustomVowelData(formantData);
      // Set all instrument slots to use the custom vowel
      var instId = (SL.audio && SL.audio.getCurrentInstrument) ? SL.audio.getCurrentInstrument() : 0;
      if (SL.formant.setVowel) {
        SL.formant.setVowel(instId, '_CUSTOM');
      }
      // Also set morphX to 0 so the engine uses the custom vowel directly
      if (SL.formant.setMorphPosition) {
        SL.formant.setMorphPosition(instId, 0);
      }
    }
  }

  function _setExpression(cutoffHz, gain) {
    if (SL.audio && SL.audio.setExpression) {
      SL.audio.setExpression(cutoffHz, gain);
    }
  }

  function _clearExpression() {
    if (SL.audio && SL.audio.clearExpression) {
      SL.audio.clearExpression();
    }
  }

  function _updateAnchorHighlight(nearestIdx) {
    if (nearestIdx === _lastNearestIdx) { return; }
    var i;
    for (i = 0; i < _anchorDots.length; i++) {
      if (i === nearestIdx) {
        _anchorDots[i].classList.add('nearest');
      } else {
        _anchorDots[i].classList.remove('nearest');
      }
    }
    _lastNearestIdx = nearestIdx;
  }

  function _clearAnchorHighlight() {
    var i;
    for (i = 0; i < _anchorDots.length; i++) {
      _anchorDots[i].classList.remove('nearest');
    }
    _lastNearestIdx = -1;
  }

  // ============================================================
  // Release
  // ============================================================

  function _releaseActivePointer() {
    if (!_isActive) { return; }
    _isActive = false;
    if (_currentNoteOff && _currentMidi >= 0) {
      _currentNoteOff(_currentMidi);
    }
    _clearExpression();
    _currentMidi = -1;
    if (_cursorEl) { _cursorEl.style.display = 'none'; }
    if (_readoutEl) { _readoutEl.textContent = '--'; }
    if (_idleHintEl) { _idleHintEl.style.display = ''; }
    if (_centerDotEl) { _centerDotEl.style.display = ''; }
    _clearAnchorHighlight();
  }

  function _documentPointerUp() {
    if (_isActive) {
      _releaseActivePointer();
    }
  }
  document.addEventListener('mouseup', _documentPointerUp);
  document.addEventListener('touchend', _documentPointerUp);
  document.addEventListener('touchcancel', _documentPointerUp);

  // ============================================================
  // Build
  // ============================================================

  function _buildVowelPadController(container, opts) {
    var baseOctave = opts.baseOctave;
    var noteOn = opts.noteOn;
    var noteOff = opts.noteOff;

    _currentNoteOff = noteOff;
    _anchorDots = [];
    _lastNearestIdx = -1;

    var wrapper = document.createElement('div');
    wrapper.className = 'ssli-vowelpad-wrapper';

    // ---------- Control bar ----------
    var controlBar = document.createElement('div');
    controlBar.className = 'ssli-vowelpad-control-bar';

    var snapBtn = document.createElement('button');
    snapBtn.className = 'rhy-scr-btn ssli-ctrl-snap-toggle ssli-vowelpad-snap-btn';
    snapBtn.textContent = _isSnapMode ? SL.t('vowelpad.snap') : SL.t('vowelpad.smooth');
    snapBtn.title = SL.t('vowelpad.snap_toggle_title');
    if (!_isSnapMode) { snapBtn.classList.add('active'); }
    snapBtn.addEventListener('click', function() {
      _isSnapMode = !_isSnapMode;
      snapBtn.textContent = _isSnapMode ? SL.t('vowelpad.snap') : SL.t('vowelpad.smooth');
      if (_isSnapMode) {
        snapBtn.classList.remove('active');
      } else {
        snapBtn.classList.add('active');
      }
    });
    controlBar.appendChild(snapBtn);

    var readout = document.createElement('div');
    readout.className = 'ssli-vowelpad-readout';
    readout.textContent = '--';
    controlBar.appendChild(readout);
    _readoutEl = readout;

    wrapper.appendChild(controlBar);

    // ---------- Pad area ----------
    var padArea = document.createElement('div');
    padArea.className = 'ssli-vowelpad-pad-area';
    padArea.style.touchAction = 'none';
    _padEl = padArea;

    // Grid lines
    var gi;
    for (gi = 1; gi <= GRID_V_COUNT; gi++) {
      var vLine = document.createElement('div');
      vLine.className = 'ssli-vowelpad-grid-line ssli-vowelpad-grid-line-v';
      vLine.style.left = Math.floor((gi / (GRID_V_COUNT + 1)) * 100) + '%';
      padArea.appendChild(vLine);
    }
    for (gi = 1; gi <= GRID_H_COUNT; gi++) {
      var hLine = document.createElement('div');
      hLine.className = 'ssli-vowelpad-grid-line ssli-vowelpad-grid-line-h';
      hLine.style.top = Math.floor((gi / (GRID_H_COUNT + 1)) * 100) + '%';
      padArea.appendChild(hLine);
    }

    // Vowel anchor dots
    var ai;
    for (ai = 0; ai < VOWEL_ANCHORS.length; ai++) {
      var anchor = VOWEL_ANCHORS[ai];
      var dot = document.createElement('div');
      dot.className = 'ssli-vowelpad-anchor-dot';
      dot.style.left = (anchor.xFrac * 100) + '%';
      dot.style.top = (anchor.yFrac * 100) + '%';
      dot.style.background = 'rgba(' + anchor.color + ', ' + ANCHOR_FILL_OPACITY + ')';
      dot.style.border = '1px solid rgba(' + anchor.color + ', ' + ANCHOR_BORDER_OPACITY + ')';

      var label = document.createElement('span');
      label.className = 'ssli-vowelpad-anchor-label';
      label.textContent = anchor.name;
      dot.appendChild(label);

      padArea.appendChild(dot);
      _anchorDots.push(dot);
    }

    // Axis labels
    var axisX = document.createElement('div');
    axisX.className = 'ssli-vowelpad-axis-label ssli-vowelpad-axis-label-x';
    axisX.textContent = SL.t('vowelpad.axis_x');
    padArea.appendChild(axisX);

    var axisYTop = document.createElement('div');
    axisYTop.className = 'ssli-vowelpad-axis-label ssli-vowelpad-axis-label-y-top';
    axisYTop.textContent = SL.t('vowelpad.axis_y_top');
    padArea.appendChild(axisYTop);

    var axisYBottom = document.createElement('div');
    axisYBottom.className = 'ssli-vowelpad-axis-label ssli-vowelpad-axis-label-y-bottom';
    axisYBottom.textContent = SL.t('vowelpad.axis_y_bottom');
    padArea.appendChild(axisYBottom);

    // Idle hint + center dot
    var idleHint = document.createElement('div');
    idleHint.className = 'ssli-vowelpad-idle-hint';
    idleHint.textContent = SL.t('vowelpad.idle_hint');
    padArea.appendChild(idleHint);
    _idleHintEl = idleHint;

    var centerDot = document.createElement('div');
    centerDot.className = 'ssli-vowelpad-center-dot';
    padArea.appendChild(centerDot);
    _centerDotEl = centerDot;

    // Touch cursor
    var cursor = document.createElement('div');
    cursor.className = 'ssli-vowelpad-cursor';
    padArea.appendChild(cursor);
    _cursorEl = cursor;

    wrapper.appendChild(padArea);
    container.appendChild(wrapper);

    // ---------- Event handling ----------

    function _beginTouch(clientX, clientY) {
      if (_isActive) { return; }
      _isActive = true;

      // Resume AudioContext on user gesture before triggering noteOn
      if (SL.audio && SL.audio.getCtx) {
        var ctx = SL.audio.getCtx();
        if (ctx && ctx.state === 'suspended') { ctx.resume(); }
      }

      _currentMidi = (baseOctave + OCTAVE_BASE_OFFSET) * SEMITONES_PER_OCTAVE;
      noteOn(_currentMidi, 127);

      if (idleHint) { idleHint.style.display = 'none'; }
      if (centerDot) { centerDot.style.display = 'none'; }

      _applyAtCoords(clientX, clientY);
    }

    function _moveTouch(clientX, clientY) {
      if (!_isActive) { return; }
      _applyAtCoords(clientX, clientY);
    }

    function _applyAtCoords(clientX, clientY) {
      var rect = padArea.getBoundingClientRect();
      var relX = clientX - rect.left;
      var relY = clientY - rect.top;
      relX = Math.max(0, Math.min(rect.width, relX));
      relY = Math.max(0, Math.min(rect.height, relY));
      var xNorm = (rect.width > 0) ? (relX / rect.width) : 0.5;
      var yNorm = (rect.height > 0) ? (relY / rect.height) : 0.5;

      var effectiveX = xNorm;
      if (_isSnapMode) {
        effectiveX = _snapToNearest(xNorm);
      }

      var formants = _interpolateFormants(effectiveX);
      var expr = _brightnessToExpression(yNorm);

      _setFormants(formants);
      _setExpression(expr.cutoff, expr.gain);

      // Update cursor position
      cursor.style.left = relX + 'px';
      cursor.style.top = relY + 'px';
      cursor.style.display = 'block';

      // Highlight nearest anchor
      var nearestIdx = _findNearestAnchor(effectiveX);
      _updateAnchorHighlight(nearestIdx);

      // Update readout
      var vowelName = VOWEL_NAMES[nearestIdx];
      var brightnessVal = (1.0 - yNorm).toFixed(2);
      readout.textContent = vowelName + ' / ' + brightnessVal;
    }

    // ---------- Mouse handlers ----------
    padArea.addEventListener('mousedown', function(e) {
      e.preventDefault();
      e.stopPropagation();
      _beginTouch(e.clientX, e.clientY);
    });

    padArea.addEventListener('mousemove', function(e) {
      if (!_isActive) { return; }
      _moveTouch(e.clientX, e.clientY);
    });

    padArea.addEventListener('mouseup', function() {
      _releaseActivePointer();
    });

    padArea.addEventListener('mouseleave', function() {
      _releaseActivePointer();
    });

    // ---------- Touch handlers ----------
    padArea.addEventListener('touchstart', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.changedTouches.length > 0) {
        var t = e.changedTouches[0];
        _beginTouch(t.clientX, t.clientY);
      }
    }, { passive: false });

    padArea.addEventListener('touchmove', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (!_isActive) { return; }
      if (e.changedTouches.length > 0) {
        var t = e.changedTouches[0];
        _moveTouch(t.clientX, t.clientY);
      }
    }, { passive: false });

    padArea.addEventListener('touchend', function(e) {
      e.preventDefault();
      e.stopPropagation();
      _releaseActivePointer();
    }, { passive: false });

    padArea.addEventListener('touchcancel', function(e) {
      e.stopPropagation();
      _releaseActivePointer();
    });
  }

  // ============================================================
  // Register
  // ============================================================

  if (!SL.controllers) { SL.controllers = {}; }
  SL.controllers.vowelpad = {
    build: function(container, opts) {
      _buildVowelPadController(container, opts);
    },
    release: _releaseActivePointer
  };

  // ============================================================
  // Panic hook
  // ============================================================

  if (SL.PanicRegistry && SL.PanicRegistry.register) {
    SL.PanicRegistry.register(
      'voices',
      'vowelpad.pointer',
      function() { _releaseActivePointer(); },
      function() { return _isActive ? 'pointer active' : null; }
    );
  }

})();
