// SSLI Controller: Ribbon (Ondes Martenot style)
// ES5 compatible (var, no arrow functions, no template literals)

(function() {
  'use strict';

  var SL = window.SynthLab;
  var NOTES = SL.NOTES;

  // ============================================================
  // Constants
  // ============================================================

  var DEFAULT_CONTAINER_WIDTH = 800;
  var DEFAULT_CONTAINER_HEIGHT = 300;
  var DEFAULT_VELOCITY = 100;
  var RIBBON_STRIP_HEIGHT_RATIO = 0.5;
  var RIBBON_STRIP_TOP_RATIO = 0.2;
  var RIBBON_PADDING = 10;
  var SEMI_TICK_TOP_RATIO = 0.7;
  var SEMI_TICK_HEIGHT_RATIO = 0.3;
  var BEND_DISPLAY_THRESHOLD = 5;
  var RIBBON_Y_CUTOFF_MIN_HZ = 800;
  var RIBBON_Y_CUTOFF_MAX_HZ = 8000;
  var RIBBON_Y_CUTOFF_RANGE_HZ = RIBBON_Y_CUTOFF_MAX_HZ - RIBBON_Y_CUTOFF_MIN_HZ;

  // ============================================================
  // State
  // ============================================================

  var _isRibbonActive = false;
  var _ribbonCurrentMidi = -1;
  var _isRibbonFreeMode = false;
  var _ribbonTouches = {};

  // ============================================================
  // Helpers
  // ============================================================

  function _midiToName(midi) {
    var pc = midi % 12;
    var oct = Math.floor(midi / 12) - 1;
    return NOTES[pc] + oct;
  }

  // ============================================================
  // Build
  // ============================================================

  function _buildRibbonController(container, opts) {
    var baseOctave = opts.baseOctave;
    var numOctaves = opts.numOctaves;
    var noteOn = opts.noteOn;
    var noteOff = opts.noteOff;
    var applyPitchBend = opts.applyPitchBend;
    var resetPitchBendFn = opts.resetPitchBendFn;

    var containerW = container.clientWidth || DEFAULT_CONTAINER_WIDTH;
    var containerH = container.clientHeight || DEFAULT_CONTAINER_HEIGHT;

    var wrapper = document.createElement('div');
    wrapper.className = 'ctrl-ribbon-wrapper ssli-ribbon-wrapper';
    wrapper.style.width = containerW + 'px';
    wrapper.style.height = containerH + 'px';

    var noteDisplay = document.createElement('div');
    noteDisplay.className = 'ctrl-ribbon-note-display';
    noteDisplay.id = 'ribbonNoteDisplay';
    noteDisplay.textContent = '--';
    wrapper.appendChild(noteDisplay);

    var stripH = Math.floor(containerH * RIBBON_STRIP_HEIGHT_RATIO);
    var stripY = Math.floor(containerH * RIBBON_STRIP_TOP_RATIO);
    var strip = document.createElement('div');
    strip.className = 'ctrl-ribbon-strip ssli-ribbon-strip';
    strip.style.left = RIBBON_PADDING + 'px';
    strip.style.top = stripY + 'px';
    strip.style.width = (containerW - RIBBON_PADDING * 2) + 'px';
    strip.style.height = stripH + 'px';
    strip.style.touchAction = 'none';

    var brightnessOverlay = document.createElement('div');
    brightnessOverlay.className = 'ctrl-ribbon-brightness-overlay';
    brightnessOverlay.style.width = '100%';
    brightnessOverlay.style.height = '100%';
    brightnessOverlay.style.position = 'absolute';
    brightnessOverlay.style.top = '0';
    brightnessOverlay.style.left = '0';
    brightnessOverlay.style.pointerEvents = 'none';
    brightnessOverlay.style.background = 'linear-gradient(to top, rgba(0,0,0,0.4) 0%, rgba(255,255,255,0.15) 100%)';
    brightnessOverlay.style.borderRadius = '4px';
    strip.appendChild(brightnessOverlay);

    var brightnessLabel = document.createElement('div');
    brightnessLabel.className = 'ctrl-ribbon-brightness-label';
    brightnessLabel.textContent = SL.t('ribbon.brightness_label');
    strip.appendChild(brightnessLabel);

    var brightnessIndicator = document.createElement('div');
    brightnessIndicator.className = 'ctrl-ribbon-brightness-indicator';
    brightnessIndicator.id = 'ribbonBrightnessIndicator';
    strip.appendChild(brightnessIndicator);

    var cursor = document.createElement('div');
    cursor.className = 'ctrl-ribbon-cursor ssli-ribbon-cursor';
    cursor.id = 'ribbonCursor';
    cursor.style.height = stripH + 'px';
    strip.appendChild(cursor);
    wrapper.appendChild(strip);

    var freeToggle = document.createElement('button');
    freeToggle.className = 'rhy-scr-btn';
    freeToggle.textContent = _isRibbonFreeMode ? SL.t('ribbon.mode_free') : SL.t('ribbon.mode_chromatic');
    freeToggle.title = SL.t('ribbon.free_toggle_title');
    freeToggle.classList.add('ssli-ribbon-free-toggle');
    if (_isRibbonFreeMode) { freeToggle.classList.add('active'); }
    freeToggle.addEventListener('click', function() {
      _isRibbonFreeMode = !_isRibbonFreeMode;
      freeToggle.textContent = _isRibbonFreeMode ? SL.t('ribbon.mode_free') : SL.t('ribbon.mode_chromatic');
      if (_isRibbonFreeMode) { freeToggle.classList.add('active'); }
      else { freeToggle.classList.remove('active'); }
    });
    wrapper.appendChild(freeToggle);

    var startMidi = (baseOctave + 1) * 12;
    var endMidi = (baseOctave + numOctaves + 1) * 12;
    var totalNotes = endMidi - startMidi;
    var stripWidth = containerW - RIBBON_PADDING * 2;

    for (var oct = baseOctave + 1; oct <= baseOctave + numOctaves + 1; oct++) {
      var octMidi = oct * 12;
      var frac = (octMidi - startMidi) / totalNotes;
      var xPos = Math.floor(frac * stripWidth);
      var marker = document.createElement('div');
      marker.className = 'ctrl-ribbon-oct-marker ssli-ribbon-oct-marker';
      marker.style.left = (RIBBON_PADDING + xPos) + 'px';
      marker.style.top = (stripY + stripH + 4) + 'px';
      marker.textContent = 'C' + (oct - 1);
      wrapper.appendChild(marker);

      var tick = document.createElement('div');
      tick.className = 'ctrl-ribbon-tick ssli-ribbon-tick';
      tick.style.left = xPos + 'px';
      tick.style.height = stripH + 'px';
      strip.appendChild(tick);
    }

    for (var n = startMidi; n <= endMidi; n++) {
      var pc = n % 12;
      if (pc === 0) { continue; }
      var nFrac = (n - startMidi) / totalNotes;
      var nX = Math.floor(nFrac * stripWidth);
      var semiTick = document.createElement('div');
      semiTick.className = 'ctrl-ribbon-semi-tick ssli-ribbon-semi-tick';
      semiTick.style.left = nX + 'px';
      semiTick.style.top = Math.floor(stripH * SEMI_TICK_TOP_RATIO) + 'px';
      semiTick.style.height = Math.floor(stripH * SEMI_TICK_HEIGHT_RATIO) + 'px';
      strip.appendChild(semiTick);
    }

    (function(stripEl, startM, totalN) {
      function posToMidiFloat(x) {
        var rect = stripEl.getBoundingClientRect();
        var relX = x - rect.left;
        var fracV = Math.max(0, Math.min(1, relX / rect.width));
        return startM + fracV * totalN;
      }

      function updateCursor(x) {
        var rect = stripEl.getBoundingClientRect();
        var relX = Math.max(0, Math.min(rect.width, x - rect.left));
        var cur = document.getElementById('ribbonCursor');
        if (cur) { cur.style.left = relX + 'px'; cur.style.display = 'block'; }
      }

      function calcYFrac(y) {
        var rect = stripEl.getBoundingClientRect();
        var yFrac = 1 - ((y - rect.top) / rect.height);
        return Math.max(0, Math.min(1, yFrac));
      }

      function applyBrightness(yFrac) {
        var cutoff = RIBBON_Y_CUTOFF_MIN_HZ + yFrac * RIBBON_Y_CUTOFF_RANGE_HZ;
        if (SL.audio && SL.audio.setExpressiveCutoff) {
          SL.audio.setExpressiveCutoff(cutoff);
        }
        var indicator = document.getElementById('ribbonBrightnessIndicator');
        if (indicator) {
          indicator.style.bottom = '0';
          indicator.style.height = Math.floor(yFrac * 100) + '%';
          indicator.style.opacity = '1';
        }
      }

      function clearBrightness() {
        if (SL.audio && SL.audio.clearExpressiveCutoff) {
          SL.audio.clearExpressiveCutoff();
        }
        var indicator = document.getElementById('ribbonBrightnessIndicator');
        if (indicator) {
          indicator.style.opacity = '0';
        }
      }

      function onStart(x, y, pointerEvent) {
        _isRibbonActive = true;
        // Resume AudioContext on user gesture before triggering noteOn
        if (SL.audio && SL.audio.getCtx) {
          var ctx = SL.audio.getCtx();
          if (ctx && ctx.state === 'suspended') { ctx.resume(); }
        }
        var mFloat = posToMidiFloat(x);
        var m = Math.round(mFloat);
        var bendCents = (mFloat - m) * 100;
        _ribbonCurrentMidi = m;
        var vel = pointerEvent ? SL.velocityFromPressure(pointerEvent, DEFAULT_VELOCITY) : DEFAULT_VELOCITY;
        noteOn(m, vel);
        applyPitchBend(bendCents);
        applyBrightness(calcYFrac(y));
        updateCursor(x);
        var disp = document.getElementById('ribbonNoteDisplay');
        if (disp) {
          if (_isRibbonFreeMode) { disp.textContent = mFloat.toFixed(1); }
          else {
            var bendSuffix0;
            if (bendCents > BEND_DISPLAY_THRESHOLD) {
              bendSuffix0 = '+';
            } else if (bendCents < -BEND_DISPLAY_THRESHOLD) {
              bendSuffix0 = '-';
            } else {
              bendSuffix0 = '';
            }
            disp.textContent = _midiToName(m) + bendSuffix0;
          }
        }
      }

      function onMove(x, y, pointerEvent) {
        if (!_isRibbonActive) { return; }
        var mFloat = posToMidiFloat(x);
        var m = Math.round(mFloat);
        var disp = document.getElementById('ribbonNoteDisplay');

        if (_isRibbonFreeMode) {
          /* Issue 15: In Free/continuous mode, do NOT retrigger at semitone
             boundaries. Keep the original note and just bend continuously. */
          var totalBendCents = (mFloat - _ribbonCurrentMidi) * 100;
          applyPitchBend(totalBendCents);
          if (disp) { disp.textContent = mFloat.toFixed(1); }
        } else {
          /* Chromatic mode: retrigger at semitone boundaries */
          var bendCents = (mFloat - m) * 100;
          if (m !== _ribbonCurrentMidi) {
            noteOff(_ribbonCurrentMidi);
            _ribbonCurrentMidi = m;
            var moveVel = pointerEvent ? SL.velocityFromPressure(pointerEvent, DEFAULT_VELOCITY) : DEFAULT_VELOCITY;
            noteOn(m, moveVel);
          }
          applyPitchBend(bendCents);
          if (disp) {
            var bendSuffix1;
            if (bendCents > BEND_DISPLAY_THRESHOLD) {
              bendSuffix1 = '+';
            } else if (bendCents < -BEND_DISPLAY_THRESHOLD) {
              bendSuffix1 = '-';
            } else {
              bendSuffix1 = '';
            }
            disp.textContent = _midiToName(m) + bendSuffix1;
          }
        }
        applyBrightness(calcYFrac(y));
        updateCursor(x);
      }

      function onEnd() {
        if (_isRibbonActive) {
          resetPitchBendFn();
          noteOff(_ribbonCurrentMidi);
          clearBrightness();
          _isRibbonActive = false;
          _ribbonCurrentMidi = -1;
          var cur = document.getElementById('ribbonCursor');
          if (cur) { cur.style.display = 'none'; }
          var disp = document.getElementById('ribbonNoteDisplay');
          if (disp) { disp.textContent = '--'; }
        }
      }

      stripEl.addEventListener('pointerdown', function(e) {
        if (e.pointerType === 'touch') { return; }
        e.preventDefault();
        if (stripEl.setPointerCapture) {
          try { stripEl.setPointerCapture(e.pointerId); } catch (err) { /* pointer capture is best-effort */ }
        }
        onStart(e.clientX, e.clientY, e);
      });
      stripEl.addEventListener('pointermove', function(e) {
        if (e.pointerType === 'touch') { return; }
        onMove(e.clientX, e.clientY, e);
      });
      stripEl.addEventListener('pointerup', function(e) {
        if (e.pointerType === 'touch') { return; }
        onEnd();
      });
      stripEl.addEventListener('pointercancel', function(e) {
        if (e.pointerType === 'touch') { return; }
        onEnd();
      });
      function touchStart(x, y, touchId, touchObj) {
        // Resume AudioContext on user gesture before triggering noteOn
        if (SL.audio && SL.audio.getCtx) {
          var touchCtx = SL.audio.getCtx();
          if (touchCtx && touchCtx.state === 'suspended') { touchCtx.resume(); }
        }
        var mFloat = posToMidiFloat(x);
        var m = Math.round(mFloat);
        var bendCents = (mFloat - m) * 100;
        var touchEvent = touchObj ? { pointerType: 'touch', pressure: touchObj.force } : null;
        var startVel = touchEvent ? SL.velocityFromPressure(touchEvent, DEFAULT_VELOCITY) : DEFAULT_VELOCITY;
        noteOn(m, startVel);
        applyPitchBend(bendCents);
        applyBrightness(calcYFrac(y));
        updateCursor(x);
        _ribbonTouches[touchId] = { midi: m };
        var disp = document.getElementById('ribbonNoteDisplay');
        if (disp) {
          if (_isRibbonFreeMode) { disp.textContent = mFloat.toFixed(1); }
          else {
            var bendSuffix2;
            if (bendCents > BEND_DISPLAY_THRESHOLD) {
              bendSuffix2 = '+';
            } else if (bendCents < -BEND_DISPLAY_THRESHOLD) {
              bendSuffix2 = '-';
            } else {
              bendSuffix2 = '';
            }
            disp.textContent = _midiToName(m) + bendSuffix2;
          }
        }
      }
      function touchMove(x, y, touchId, touchObj) {
        var info = _ribbonTouches[touchId];
        if (!info) { return; }
        var mFloat = posToMidiFloat(x);
        var m = Math.round(mFloat);
        var disp = document.getElementById('ribbonNoteDisplay');
        if (_isRibbonFreeMode) {
          var totalBendCents = (mFloat - info.midi) * 100;
          applyPitchBend(totalBendCents);
          if (disp) { disp.textContent = mFloat.toFixed(1); }
        } else {
          var bendCents = (mFloat - m) * 100;
          if (m !== info.midi) {
            noteOff(info.midi);
            info.midi = m;
            var touchMoveEvent = touchObj ? { pointerType: 'touch', pressure: touchObj.force } : null;
            var touchMoveVel = touchMoveEvent ? SL.velocityFromPressure(touchMoveEvent, DEFAULT_VELOCITY) : DEFAULT_VELOCITY;
            noteOn(m, touchMoveVel);
          }
          applyPitchBend(bendCents);
          if (disp) {
            var bendSuffix3;
            if (bendCents > BEND_DISPLAY_THRESHOLD) {
              bendSuffix3 = '+';
            } else if (bendCents < -BEND_DISPLAY_THRESHOLD) {
              bendSuffix3 = '-';
            } else {
              bendSuffix3 = '';
            }
            disp.textContent = _midiToName(m) + bendSuffix3;
          }
        }
        applyBrightness(calcYFrac(y));
        updateCursor(x);
      }
      function touchEnd(touchId) {
        var info = _ribbonTouches[touchId];
        if (!info) { return; }
        resetPitchBendFn();
        noteOff(info.midi);
        clearBrightness();
        delete _ribbonTouches[touchId];
        var remainingKeys = Object.keys(_ribbonTouches);
        if (remainingKeys.length === 0) {
          var cur = document.getElementById('ribbonCursor');
          if (cur) { cur.style.display = 'none'; }
          var disp = document.getElementById('ribbonNoteDisplay');
          if (disp) { disp.textContent = '--'; }
        }
      }
      stripEl.addEventListener('touchstart', function(e) {
        e.preventDefault();
        var ci;
        for (ci = 0; ci < e.changedTouches.length; ci++) {
          var t = e.changedTouches[ci];
          touchStart(t.clientX, t.clientY, t.identifier, t);
        }
        if (e.changedTouches.length > 0 && !_isRibbonActive) {
          _isRibbonActive = true;
        }
      }, { passive: false });
      stripEl.addEventListener('touchmove', function(e) {
        e.preventDefault();
        var ci;
        for (ci = 0; ci < e.changedTouches.length; ci++) {
          var t = e.changedTouches[ci];
          touchMove(t.clientX, t.clientY, t.identifier, t);
        }
      }, { passive: false });
      stripEl.addEventListener('touchend', function(e) {
        e.preventDefault();
        var ci;
        for (ci = 0; ci < e.changedTouches.length; ci++) {
          touchEnd(e.changedTouches[ci].identifier);
        }
        var remainingKeys = Object.keys(_ribbonTouches);
        if (remainingKeys.length === 0) {
          _isRibbonActive = false;
        }
      }, { passive: false });
      stripEl.addEventListener('touchcancel', function(e) {
        var ci;
        for (ci = 0; ci < e.changedTouches.length; ci++) {
          touchEnd(e.changedTouches[ci].identifier);
        }
        var remainingKeys = Object.keys(_ribbonTouches);
        if (remainingKeys.length === 0) {
          _isRibbonActive = false;
        }
      });
    })(strip, startMidi, totalNotes);

    container.appendChild(wrapper);
  }

  // ============================================================
  // Register
  // ============================================================

  function _releaseRibbon() {
    if (_isRibbonActive) {
      _isRibbonActive = false;
      // Release any held mouse note
      var hasHeldMouseNote = _ribbonCurrentMidi >= 0 && SL.screenPlay;
      var canReleaseMouseNote = hasHeldMouseNote && SL.screenPlay.noteOff;
      if (canReleaseMouseNote) {
        SL.screenPlay.noteOff(_ribbonCurrentMidi);
      }
      // Release any held touch notes
      var touchIds = Object.keys(_ribbonTouches);
      var ti;
      for (ti = 0; ti < touchIds.length; ti++) {
        var info = _ribbonTouches[touchIds[ti]];
        var hasHeldTouchNote = info && info.midi >= 0;
        var canReleaseTouchNote = hasHeldTouchNote && SL.screenPlay && SL.screenPlay.noteOff;
        if (canReleaseTouchNote) {
          SL.screenPlay.noteOff(info.midi);
        }
      }
      _ribbonCurrentMidi = -1;
      _ribbonTouches = {};
      var cur = document.getElementById('ribbonCursor');
      if (cur) { cur.style.display = 'none'; }
      var disp = document.getElementById('ribbonNoteDisplay');
      if (disp) { disp.textContent = '--'; }
    }
  }

  if (!SL.controllers) { SL.controllers = {}; }
  SL.controllers.ribbon = {
    build: _buildRibbonController,
    release: _releaseRibbon
  };

  if (SL.PanicRegistry && SL.PanicRegistry.register) {
    SL.PanicRegistry.register(
      'controllers',
      'ribbon.pointer',
      function() { _releaseRibbon(); },
      function() { return _isRibbonActive ? 'ribbon active' : null; }
    );
  }

})();
