// SSLI Controller: Shruti Box (chromatic reed toggles + bellows)
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
  var DEFAULT_REED_COUNT = 13;

  var BELLOWS_HEIGHT_PX = 90;
  var REEDS_PER_TOP_ROW = 7;
  var REEDS_PER_BOTTOM_ROW = 6;

  var BELLOWS_CUTOFF_MIN_HZ = 400;
  var BELLOWS_CUTOFF_MAX_HZ = 10000;
  var LN_BELLOWS_CUTOFF_MIN = Math.log(BELLOWS_CUTOFF_MIN_HZ);
  var LN_BELLOWS_CUTOFF_MAX = Math.log(BELLOWS_CUTOFF_MAX_HZ);

  var BELLOWS_GAIN_MIN = 0.30;
  var BELLOWS_GAIN_MAX = 0.85;

  var DEFAULT_AIR_LEVEL = 0.40;
  var REED_HELD_SUSTAIN = 100;

  var SARGAM_NAMES = ['Sa', 'Re♭', 'Re', 'Ga♭', 'Ga', 'Ma', 'Ma♯', 'Pa', 'Dha♭', 'Dha', 'Ni♭', 'Ni'];

  var REED_COLORS = [
    '#3080c0', '#606080', '#d08030', '#505070', '#c0a020',
    '#d08030', '#505070', '#3080c0', '#505070', '#8040c0',
    '#505070', '#6060a0'
  ];

  // ============================================================
  // State
  // ============================================================

  var _reedStates = [];
  var _reedMidis = [];
  var _reedElements = [];
  var _airLevel = 0.0;
  var _bellowsActive = false;
  var _bellowsStartX = 0;
  var _bellowsStartAir = 0;
  var _bellowsFillEl = null;
  var _sargamRoot = 0;
  var _cachedNoteOn = null;
  var _cachedNoteOff = null;
  var _savedSustain = null;
  var _savedSustainInst = -1;

  // ============================================================
  // Helpers
  // ============================================================

  function _clamp01(v) {
    if (v < 0) { return 0; }
    if (v > 1) { return 1; }
    return v;
  }

  function _midiToNoteName(midi) {
    var pc = midi % SEMITONES_PER_OCTAVE;
    var oct = Math.floor(midi / SEMITONES_PER_OCTAVE) - 1;
    return NOTES[pc] + oct;
  }

  function _getSargamName(pitchClass, root) {
    var interval = ((pitchClass - root) + SEMITONES_PER_OCTAVE) % SEMITONES_PER_OCTAVE;
    return SARGAM_NAMES[interval];
  }

  function _updateExpression() {
    var lnCutoff = LN_BELLOWS_CUTOFF_MIN + _airLevel * (LN_BELLOWS_CUTOFF_MAX - LN_BELLOWS_CUTOFF_MIN);
    var cutoffHz = Math.exp(lnCutoff);
    var gain = BELLOWS_GAIN_MIN + _airLevel * (BELLOWS_GAIN_MAX - BELLOWS_GAIN_MIN);
    if (SL.audio && SL.audio.setExpression) {
      SL.audio.setExpression(cutoffHz, gain);
    }
  }

  function _countActiveReeds() {
    var count = 0;
    var i;
    for (i = 0; i < _reedStates.length; i++) {
      if (_reedStates[i]) { count++; }
    }
    return count;
  }

  function _forceSustain() {
    if (SL.audio && SL.audio.getInstruments && SL.audio.getCurrentInstrument) {
      var instId = SL.audio.getCurrentInstrument();
      var insts = SL.audio.getInstruments();
      var inst = insts ? insts[instId] : null;
      if (inst && inst.settings && inst.settings.adsr) {
        _savedSustainInst = instId;
        _savedSustain = inst.settings.adsr.s;
        inst.settings.adsr.s = REED_HELD_SUSTAIN;
      }
    }
  }

  function _restoreSustain() {
    if ((_savedSustain !== null) && (_savedSustainInst >= 0)
        && SL.audio && SL.audio.getInstruments) {
      var insts = SL.audio.getInstruments();
      var inst = insts ? insts[_savedSustainInst] : null;
      if (inst && inst.settings && inst.settings.adsr) {
        inst.settings.adsr.s = _savedSustain;
      }
      _savedSustain = null;
      _savedSustainInst = -1;
    }
  }

  function _renderAirLevel() {
    if (_bellowsFillEl) {
      _bellowsFillEl.style.width = Math.floor(_airLevel * 100) + '%';
    }
  }

  var REED_ACTIVE_GLOW_SPREAD = 8;
  var REED_ACTIVE_GLOW_ALPHA = '66';
  var REED_ACTIVE_INNER_GLOW_ALPHA = '33';

  function _updateReedVisual(idx) {
    var el = _reedElements[idx];
    if (!el) { return; }
    var midi = _reedMidis[idx];
    var pc = midi % SEMITONES_PER_OCTAVE;
    var color = REED_COLORS[pc];
    if (_reedStates[idx]) {
      el.style.background = color;
      el.style.borderColor = color;
      el.style.boxShadow = '0 0 ' + REED_ACTIVE_GLOW_SPREAD + 'px ' + color + REED_ACTIVE_GLOW_ALPHA + ', inset 0 0 12px ' + color + REED_ACTIVE_INNER_GLOW_ALPHA;
      el.classList.add('active');
    } else {
      el.style.background = '';
      el.style.borderColor = '';
      el.style.boxShadow = '';
      el.classList.remove('active');
    }
  }

  function _toggleReed(idx) {
    _reedStates[idx] = !_reedStates[idx];
    var midi = _reedMidis[idx];
    if (_reedStates[idx]) {
      var activeBeforeThis = _countActiveReeds() - 1;
      var isFirstReed = (activeBeforeThis === 0);
      if (isFirstReed) { _forceSustain(); }
      if (_cachedNoteOn) { _cachedNoteOn(midi); }
    } else {
      if (_cachedNoteOff) { _cachedNoteOff(midi); }
      var activeAfterThis = _countActiveReeds();
      var isLastReed = (activeAfterThis === 0);
      if (isLastReed) { _restoreSustain(); }
    }
    _updateReedVisual(idx);
  }

  // ============================================================
  // Cleanup
  // ============================================================

  function _releaseAllReeds() {
    var i;
    for (i = 0; i < _reedStates.length; i++) {
      if (_reedStates[i]) {
        _reedStates[i] = false;
        if (_cachedNoteOff && _reedMidis[i] >= 0) {
          _cachedNoteOff(_reedMidis[i]);
        }
        _updateReedVisual(i);
      }
    }
    _airLevel = 0;
    _renderAirLevel();
    _restoreSustain();
    if (SL.audio && SL.audio.clearExpression) {
      SL.audio.clearExpression();
    }
  }

  // ============================================================
  // Build
  // ============================================================

  function _buildShrutiBoxController(container, opts) {
    var baseOctave = opts.baseOctave;
    var noteOn = opts.noteOn;
    var noteOff = opts.noteOff;

    _cachedNoteOn = noteOn;
    _cachedNoteOff = noteOff;
    _reedStates = [];
    _reedMidis = [];
    _reedElements = [];
    _airLevel = DEFAULT_AIR_LEVEL;
    _sargamRoot = 0;
    _savedSustain = null;
    _savedSustainInst = -1;

    var baseMidi = (baseOctave + OCTAVE_BASE_OFFSET) * SEMITONES_PER_OCTAVE;

    var wrapper = document.createElement('div');
    wrapper.className = 'ssli-shrutibox-wrapper';

    // ---------- Bellows strip ----------
    var bellows = document.createElement('div');
    bellows.className = 'ssli-shrutibox-bellows';

    var bellowsTexture = document.createElement('div');
    bellowsTexture.className = 'ssli-shrutibox-bellows-texture';
    bellows.appendChild(bellowsTexture);

    var bellowsFill = document.createElement('div');
    bellowsFill.className = 'ssli-shrutibox-bellows-fill';
    bellows.appendChild(bellowsFill);
    _bellowsFillEl = bellowsFill;

    var airLabel = document.createElement('div');
    airLabel.className = 'ssli-shrutibox-air-label';
    airLabel.textContent = SL.t('shrutibox.air_label');
    bellows.appendChild(airLabel);

    var dragInstruction = document.createElement('div');
    dragInstruction.className = 'ssli-shrutibox-drag-instruction';
    dragInstruction.textContent = SL.t('shrutibox.drag_bellows');
    bellows.appendChild(dragInstruction);

    wrapper.appendChild(bellows);

    // Bellows pointer events (horizontal drag)
    var _bellowsPointerId = -1;

    function _onBellowsDown(e) {
      e.preventDefault();
      e.stopPropagation();
      var alreadyTracking = _bellowsActive;
      if (!alreadyTracking) {
        _bellowsActive = true;
        _bellowsPointerId = (typeof e.pointerId !== 'undefined') ? e.pointerId : -1;
        _bellowsStartX = e.clientX;
        _bellowsStartAir = _airLevel;
        if (bellows.setPointerCapture && _bellowsPointerId >= 0) {
          try { bellows.setPointerCapture(_bellowsPointerId); } catch (err) { /* best effort */ }
        }
      }
    }

    function _onBellowsMove(e) {
      if (!_bellowsActive) { return; }
      var isCorrectPointer = (typeof e.pointerId === 'undefined') || (e.pointerId === _bellowsPointerId);
      if (isCorrectPointer) {
        var rect = bellows.getBoundingClientRect();
        var deltaX = e.clientX - _bellowsStartX;
        var deltaFrac = deltaX / rect.width;
        _airLevel = _clamp01(_bellowsStartAir + deltaFrac);
        _renderAirLevel();
        _updateExpression();
      }
    }

    function _onBellowsUp(e) {
      var isCorrectPointer = (typeof e.pointerId === 'undefined') || (e.pointerId === _bellowsPointerId);
      if (isCorrectPointer) {
        _bellowsActive = false;
        if (bellows.releasePointerCapture && _bellowsPointerId >= 0) {
          try { bellows.releasePointerCapture(_bellowsPointerId); } catch (err) { /* best effort */ }
        }
        _bellowsPointerId = -1;
      }
    }

    bellows.addEventListener('contextmenu', function(ev) { ev.preventDefault(); });
    bellows.addEventListener('pointerdown', _onBellowsDown);
    bellows.addEventListener('pointermove', _onBellowsMove);
    bellows.addEventListener('pointerup', _onBellowsUp);
    bellows.addEventListener('pointercancel', _onBellowsUp);
    bellows.addEventListener('lostpointercapture', function() {
      _bellowsActive = false;
      _bellowsPointerId = -1;
    });

    // ---------- Release All button — full width, adjacent to bellows ----------
    var releaseAllBtn = document.createElement('button');
    releaseAllBtn.type = 'button';
    releaseAllBtn.className = 'ssli-shrutibox-release-all-btn ssli-shrutibox-release-all-fullwidth';
    releaseAllBtn.textContent = SL.t('shrutibox.release_all');
    releaseAllBtn.addEventListener('pointerdown', function(ev) {
      ev.preventDefault();
      ev.stopPropagation();
    });
    releaseAllBtn.addEventListener('click', function(ev) {
      ev.preventDefault();
      _releaseAllReeds();
    });
    wrapper.appendChild(releaseAllBtn);

    // ---------- Reed grid area (two rows) ----------
    var reedArea = document.createElement('div');
    reedArea.className = 'ssli-shrutibox-reed-area';

    var topRow = document.createElement('div');
    topRow.className = 'ssli-shrutibox-reed-row';

    var bottomRow = document.createElement('div');
    bottomRow.className = 'ssli-shrutibox-reed-row';

    var reedIdx;
    for (reedIdx = 0; reedIdx < DEFAULT_REED_COUNT; reedIdx++) {
      var midi = baseMidi + reedIdx;
      _reedMidis.push(midi);
      _reedStates.push(false);

      var reedBtn = document.createElement('div');
      reedBtn.className = 'ssli-shrutibox-reed';
      reedBtn.setAttribute('data-reed-index', String(reedIdx));

      var pc = midi % SEMITONES_PER_OCTAVE;

      var sargamLabel = document.createElement('div');
      sargamLabel.className = 'ssli-shrutibox-sargam-label';
      sargamLabel.textContent = _getSargamName(pc, _sargamRoot);
      reedBtn.appendChild(sargamLabel);

      var noteLabel = document.createElement('div');
      noteLabel.className = 'ssli-shrutibox-reed-label';
      noteLabel.textContent = _midiToNoteName(midi);
      reedBtn.appendChild(noteLabel);

      // ON indicator (visible only when active)
      var onDot = document.createElement('div');
      onDot.className = 'ssli-shrutibox-reed-on-dot';
      onDot.textContent = SL.t('shrutibox.on_indicator');
      reedBtn.appendChild(onDot);

      reedBtn.style.touchAction = 'manipulation';
      reedBtn.style.webkitTouchCallout = 'none';
      reedBtn.style.webkitUserSelect = 'none';
      reedBtn.style.userSelect = 'none';

      (function(capturedIdx, capturedBtn) {
        var _reedPointerId = -1;
        // Prevent context menu and long-press behaviors
        capturedBtn.addEventListener('contextmenu', function(ev) {
          ev.preventDefault();
        });
        capturedBtn.addEventListener('touchstart', function(ev) {
          ev.preventDefault();
        }, { passive: false });
        capturedBtn.addEventListener('touchend', function(ev) {
          ev.preventDefault();
        }, { passive: false });
        capturedBtn.addEventListener('pointerdown', function(ev) {
          ev.preventDefault();
          ev.stopPropagation();
          var isFirstTouch = (_reedPointerId < 0);
          if (isFirstTouch) {
            _reedPointerId = (typeof ev.pointerId !== 'undefined') ? ev.pointerId : 0;
            capturedBtn.classList.add('pressing');
            _toggleReed(capturedIdx);
          }
        });
        capturedBtn.addEventListener('pointerup', function(ev) {
          var isMatch = (typeof ev.pointerId === 'undefined') || (ev.pointerId === _reedPointerId);
          if (isMatch) {
            _reedPointerId = -1;
            capturedBtn.classList.remove('pressing');
          }
        });
        capturedBtn.addEventListener('pointercancel', function() {
          _reedPointerId = -1;
          capturedBtn.classList.remove('pressing');
        });
      })(reedIdx, reedBtn);

      var isTopRow = reedIdx < REEDS_PER_TOP_ROW;
      if (isTopRow) {
        topRow.appendChild(reedBtn);
      } else {
        bottomRow.appendChild(reedBtn);
      }
      _reedElements.push(reedBtn);
    }

    reedArea.appendChild(topRow);

    // Octave separator between rows
    var octaveSep = document.createElement('div');
    octaveSep.className = 'ssli-shrutibox-octave-sep';
    reedArea.appendChild(octaveSep);

    reedArea.appendChild(bottomRow);
    wrapper.appendChild(reedArea);

    // Quick Start button (toggles Sa + Pa = root + fifth)
    var SA_PA_INTERVAL = 7; // perfect fifth = 7 semitones
    var quickStartRow = document.createElement('div');
    quickStartRow.className = 'ssli-shrutibox-quickstart-row';

    var quickStartBtn = document.createElement('button');
    quickStartBtn.type = 'button';
    quickStartBtn.className = 'ssli-shrutibox-quickstart-btn';
    quickStartBtn.textContent = SL.t('shrutibox.quick_start');
    quickStartBtn.addEventListener('pointerdown', function(ev) {
      ev.preventDefault();
      ev.stopPropagation();
    });
    quickStartBtn.addEventListener('click', function(ev) {
      ev.preventDefault();
      // Toggle Sa (index 0) and Pa (index 7 = perfect fifth)
      var saIdx = 0;
      var paIdx = SA_PA_INTERVAL;
      var saIsOn = _reedStates[saIdx];
      var paIsOn = (paIdx < _reedStates.length) ? _reedStates[paIdx] : false;
      var bothOn = saIsOn && paIsOn;
      if (bothOn) {
        // Turn both off
        _toggleReed(saIdx);
        if (paIdx < _reedStates.length) {
          _toggleReed(paIdx);
        }
      } else {
        // Turn both on
        if (!saIsOn) {
          _toggleReed(saIdx);
        }
        if ((paIdx < _reedStates.length) && !paIsOn) {
          _toggleReed(paIdx);
        }
      }
    });
    quickStartRow.appendChild(quickStartBtn);

    // Release All button is placed adjacent to bellows (see below)

    wrapper.appendChild(quickStartRow);

    // Legend / instructions label
    var legend = document.createElement('div');
    legend.className = 'ssli-shrutibox-legend';
    legend.textContent = SL.t('shrutibox.legend');
    wrapper.appendChild(legend);

    container.appendChild(wrapper);

    // Set initial expression and render air level
    _renderAirLevel();
    _updateExpression();
  }

  // ============================================================
  // Register
  // ============================================================

  if (!SL.controllers) { SL.controllers = {}; }
  SL.controllers.shrutibox = {
    build: function(container, opts) {
      _buildShrutiBoxController(container, opts);
    },
    release: _releaseAllReeds
  };

  // ============================================================
  // Panic hook
  // ============================================================

  if (SL.PanicRegistry && SL.PanicRegistry.register) {
    SL.PanicRegistry.register(
      'voices',
      'shrutibox.reeds',
      function() { _releaseAllReeds(); },
      function() {
        var count = 0;
        var i;
        for (i = 0; i < _reedStates.length; i++) {
          if (_reedStates[i]) { count++; }
        }
        if (count > 0) {
          return count + ' reeds active';
        }
        return null;
      }
    );
  }

})();
