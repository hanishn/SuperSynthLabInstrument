// SSLI Controller: Organ Drawbars (9 Hammond-style drawbars + 2-octave keyboard)
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
  var DEFAULT_VELOCITY = 100;
  var VELOCITY_BASE = 64;
  var VELOCITY_RANGE = 63;
  var NUM_DRAWBARS = 9;
  var DRAWBAR_STEPS = 9;
  var DRAWBAR_MAX = 8;
  var DRAWBAR_MIN = 0;
  var DRAWBAR_AMPLITUDE_DIVISOR = 8.0;
  var NUM_ORGAN_OCTAVES = 2;

  var BLACK_KEYS = [1, 3, 6, 8, 10];

  // Drawbar footage labels
  var DRAWBAR_LABELS = ["16'", "5-1/3'", "8'", "4'", "2-2/3'", "2'", "1-3/5'", "1-1/3'", "1'"];

  // Drawbar frequency ratios relative to fundamental
  var DRAWBAR_FREQ_RATIOS = [0.5, 1.5, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 8.0];

  // Drawbar thumb colors (Hammond convention)
  var DRAWBAR_THUMB_COLORS = [
    '#8B4513', // 16'    brown
    '#8B4513', // 5-1/3' brown
    '#f0f0f0', // 8'     white
    '#f0f0f0', // 4'     white
    '#333333', // 2-2/3' black
    '#f0f0f0', // 2'     white
    '#333333', // 1-3/5' black
    '#333333', // 1-1/3' black
    '#f0f0f0'  // 1'     white
  ];

  // Dark drawbar thumbs need light text, light ones need dark text
  var DRAWBAR_TEXT_DARK_THRESHOLD_R = 128;

  // Registration presets: [16', 5-1/3', 8', 4', 2-2/3', 2', 1-3/5', 1-1/3', 1']
  var PRESETS = [
    { name: 'Full Organ',  bars: [8,8,8,8,8,8,8,8,8] },
    { name: 'Gospel',      bars: [8,8,8,0,0,0,0,0,8] },
    { name: 'Jazz',        bars: [8,3,8,0,0,0,0,0,0] },
    { name: 'Rock',        bars: [8,8,8,8,0,0,0,0,0] },
    { name: 'Blues',        bars: [8,0,8,8,0,8,0,0,8] },
    { name: 'Theatre',     bars: [6,8,8,5,0,0,0,0,4] },
    { name: 'Reggae',      bars: [8,0,8,0,0,0,0,0,8] },
    { name: 'Ballad',      bars: [8,4,8,0,0,0,0,0,0] },
    { name: 'Booker T',    bars: [8,8,8,6,3,0,0,0,0] },
    { name: 'Jimmy Smith', bars: [8,8,8,0,0,0,0,0,0] }
  ];

  var PERCUSSION_MODES = ['Off', '2nd', '3rd'];
  var PERCUSSION_OFF = 0;
  var PERCUSSION_2ND = 1;
  var PERCUSSION_3RD = 2;

  // Timing for double-tap detection (ms)
  var DOUBLE_TAP_THRESHOLD_MS = 350;

  // Preset bar height
  var PRESET_BAR_HEIGHT_PX = 28;
  var PRESET_BAR_HEIGHT_PHONE_PX = 24;

  // ============================================================
  // State
  // ============================================================

  var _cachedNoteOn = null;
  var _cachedNoteOff = null;
  var _cachedBaseOctave = 3;
  var _drawbarValues = [8, 8, 8, 8, 8, 8, 8, 8, 8];
  var _percussionMode = PERCUSSION_OFF;

  // DOM references
  var _drawbarThumbEls = [];
  var _drawbarReadoutEls = [];
  var _keyboardKeyEls = {};
  var _presetSelectEl = null;
  var _percBtnEl = null;
  var _wrapperEl = null;

  // Pointer tracking per drawbar
  var _drawbarPointerMap = {};

  // Double-tap tracking per drawbar
  var _drawbarLastTapTime = [];
  var _labelLastTapTime = [];
  var i;
  for (i = 0; i < NUM_DRAWBARS; i++) {
    _drawbarLastTapTime.push(0);
    _labelLastTapTime.push(0);
  }

  // Active keyboard notes
  var _activeNotes = {};

  // ============================================================
  // Helpers
  // ============================================================

  function _isBlackKey(pc) {
    var j;
    for (j = 0; j < BLACK_KEYS.length; j++) {
      if (BLACK_KEYS[j] === pc) {
        return true;
      }
    }
    return false;
  }

  function _midiToName(midi) {
    var pc = midi % SEMITONES_PER_OCTAVE;
    var oct = Math.floor(midi / SEMITONES_PER_OCTAVE) - OCTAVE_BASE_OFFSET;
    return NOTES[pc] + oct;
  }

  function _clampDrawbar(val) {
    if (val < DRAWBAR_MIN) {
      return DRAWBAR_MIN;
    }
    if (val > DRAWBAR_MAX) {
      return DRAWBAR_MAX;
    }
    return val;
  }

  function _isThumbDark(colorHex) {
    var r = parseInt(colorHex.substring(1, 3), 16);
    var isDark = (r < DRAWBAR_TEXT_DARK_THRESHOLD_R);
    return isDark;
  }

  // ============================================================
  // Drawbar UI update
  // ============================================================

  function _updateDrawbarVisual(idx) {
    var thumb = _drawbarThumbEls[idx];
    var readout = _drawbarReadoutEls[idx];
    if (thumb) {
      var pct = (_drawbarValues[idx] / DRAWBAR_MAX) * 100;
      thumb.style.bottom = pct + '%';
    }
    if (readout) {
      readout.textContent = String(_drawbarValues[idx]);
    }
  }

  function _updateAllDrawbarVisuals() {
    var k;
    for (k = 0; k < NUM_DRAWBARS; k++) {
      _updateDrawbarVisual(k);
    }
  }

  function _applyPreset(presetIdx) {
    var preset = PRESETS[presetIdx];
    if (!preset) {
      return;
    }
    var m;
    for (m = 0; m < NUM_DRAWBARS; m++) {
      _drawbarValues[m] = preset.bars[m];
    }
    _updateAllDrawbarVisuals();
    _publishDrawbarState();
  }

  function _publishDrawbarState() {
    if (SL.controllers && SL.controllers.organ) {
      SL.controllers.organ.drawbars = _drawbarValues.slice();
    }
    // Drive the additive engine with drawbar values
    if (SL.additive) {
      var instId = (SL.audio && SL.audio.getCurrentInstrument) ? SL.audio.getCurrentInstrument() : 0;
      // Ensure drawbar mode is enabled
      if (SL.additive.setDrawbarMode) {
        SL.additive.setDrawbarMode(instId, true);
      }
      // Push each drawbar value to the additive engine
      if (SL.additive.setDrawbar) {
        var di;
        for (di = 0; di < NUM_DRAWBARS; di++) {
          SL.additive.setDrawbar(instId, di, _drawbarValues[di]);
        }
      }
    }
  }

  // ============================================================
  // Drawbar pointer handling
  // ============================================================

  function _drawbarPointerDown(idx, e) {
    e.preventDefault();
    var pointerId = (e.pointerId !== undefined) ? e.pointerId : 'mouse';
    _drawbarPointerMap[pointerId] = idx;

    var track = e.currentTarget;
    if (track && track.setPointerCapture && (e.pointerId !== undefined)) {
      track.setPointerCapture(e.pointerId);
    }

    _drawbarPointerMove(idx, e);
  }

  function _drawbarPointerMove(idx, e) {
    var track = e.currentTarget;
    if (!track) {
      return;
    }
    var rect = track.getBoundingClientRect();
    var trackHeight = rect.height;
    if (trackHeight <= 0) {
      return;
    }
    var yFromBottom = rect.bottom - e.clientY;
    var ratio = yFromBottom / trackHeight;
    ratio = Math.max(0, Math.min(1, ratio));
    var rawStep = ratio * DRAWBAR_MAX;
    var snapped = Math.round(rawStep);
    snapped = _clampDrawbar(snapped);

    var changed = (_drawbarValues[idx] !== snapped);
    if (changed) {
      _drawbarValues[idx] = snapped;
      _updateDrawbarVisual(idx);
      _publishDrawbarState();
    }
    if (SL.sliderOverlay) { SL.sliderOverlay.show(DRAWBAR_LABELS[idx] + ' = ' + snapped); }
  }

  function _drawbarPointerUp(idx, e) {
    var pointerId = (e.pointerId !== undefined) ? e.pointerId : 'mouse';
    delete _drawbarPointerMap[pointerId];

    var track = e.currentTarget;
    if (track && track.releasePointerCapture && (e.pointerId !== undefined)) {
      track.releasePointerCapture(e.pointerId);
    }
    if (SL.sliderOverlay) { SL.sliderOverlay.hide(); }
  }

  function _handleDrawbarDoubleTap(idx) {
    var now = Date.now();
    var elapsed = now - _drawbarLastTapTime[idx];
    var isDoubleTap = (elapsed < DOUBLE_TAP_THRESHOLD_MS);
    _drawbarLastTapTime[idx] = now;
    if (isDoubleTap) {
      _drawbarValues[idx] = DRAWBAR_MIN;
      _updateDrawbarVisual(idx);
      _publishDrawbarState();
    }
  }

  function _handleLabelDoubleTap(idx) {
    var now = Date.now();
    var elapsed = now - _labelLastTapTime[idx];
    var isDoubleTap = (elapsed < DOUBLE_TAP_THRESHOLD_MS);
    _labelLastTapTime[idx] = now;
    if (isDoubleTap) {
      _drawbarValues[idx] = DRAWBAR_MAX;
      _updateDrawbarVisual(idx);
      _publishDrawbarState();
    }
  }

  // ============================================================
  // Percussion toggle
  // ============================================================

  function _cyclePercussion() {
    _percussionMode = (_percussionMode + 1) % PERCUSSION_MODES.length;
    if (_percBtnEl) {
      _percBtnEl.textContent = SL.t('organ.perc_prefix') + PERCUSSION_MODES[_percussionMode];
      var isActive = (_percussionMode !== PERCUSSION_OFF);
      if (isActive) {
        _percBtnEl.classList.add('active');
      } else {
        _percBtnEl.classList.remove('active');
      }
    }
    if (SL.controllers && SL.controllers.organ) {
      SL.controllers.organ.percussion = _percussionMode;
    }
  }

  // ============================================================
  // Keyboard note handling
  // ============================================================

  function _keyNoteOn(midi, vel) {
    if (_cachedNoteOn) {
      var velocity = (vel !== undefined) ? vel : DEFAULT_VELOCITY;
      _cachedNoteOn(midi, velocity);
      _activeNotes[midi] = true;
      var keyEl = _keyboardKeyEls[midi];
      if (keyEl) {
        keyEl.classList.add('active');
      }
    }
  }

  function _keyNoteOff(midi) {
    if (_cachedNoteOff) {
      _cachedNoteOff(midi);
      delete _activeNotes[midi];
      var keyEl = _keyboardKeyEls[midi];
      if (keyEl) {
        keyEl.classList.remove('active');
      }
    }
  }

  // ============================================================
  // Build: Preset bar
  // ============================================================

  function _buildPresetBar(container) {
    var bar = document.createElement('div');
    bar.className = 'ssli-organ-preset-bar';

    // Preset dropdown
    var sel = document.createElement('select');
    sel.className = 'ssli-organ-preset-select';
    sel.setAttribute('aria-label', 'Registration Preset');
    var pi;
    for (pi = 0; pi < PRESETS.length; pi++) {
      var opt = document.createElement('option');
      opt.value = String(pi);
      opt.textContent = PRESETS[pi].name;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', function() {
      _applyPreset(parseInt(sel.value, 10));
    });
    _presetSelectEl = sel;
    bar.appendChild(sel);

    // Percussion toggle button
    var percBtn = document.createElement('button');
    percBtn.className = 'ssli-organ-perc-btn';
    percBtn.textContent = SL.t('organ.perc_prefix') + PERCUSSION_MODES[_percussionMode];
    percBtn.setAttribute('aria-label', 'Percussion Toggle');
    percBtn.addEventListener('click', function(e) {
      e.preventDefault();
      _cyclePercussion();
    });
    _percBtnEl = percBtn;
    bar.appendChild(percBtn);

    container.appendChild(bar);
  }

  // ============================================================
  // Build: Drawbar panel
  // ============================================================

  function _buildDrawbarPanel(container) {
    var panel = document.createElement('div');
    panel.className = 'ssli-organ-drawbar-panel';

    _drawbarThumbEls = [];
    _drawbarReadoutEls = [];

    var di;
    for (di = 0; di < NUM_DRAWBARS; di++) {
      var col = document.createElement('div');
      col.className = 'ssli-organ-drawbar-col';

      // Footage label (top)
      var lbl = document.createElement('div');
      lbl.className = 'ssli-organ-drawbar-label';
      lbl.textContent = DRAWBAR_LABELS[di];
      lbl.setAttribute('data-drawbar-idx', String(di));
      (function(labelIdx) {
        lbl.addEventListener('pointerdown', function(e) {
          e.preventDefault();
          _handleLabelDoubleTap(labelIdx);
        });
      })(di);
      col.appendChild(lbl);

      // Track (vertical slider area)
      var track = document.createElement('div');
      track.className = 'ssli-organ-drawbar-track';
      track.setAttribute('data-drawbar-idx', String(di));
      track.style.touchAction = 'none';

      // Thumb
      var thumb = document.createElement('div');
      thumb.className = 'ssli-organ-drawbar-thumb';
      thumb.style.backgroundColor = DRAWBAR_THUMB_COLORS[di];
      var thumbIsDark = _isThumbDark(DRAWBAR_THUMB_COLORS[di]);
      if (thumbIsDark) {
        thumb.classList.add('dark-thumb');
      }
      track.appendChild(thumb);
      _drawbarThumbEls.push(thumb);

      // Wire pointer events per-drawbar
      (function(drawbarIdx) {
        track.addEventListener('pointerdown', function(e) {
          _handleDrawbarDoubleTap(drawbarIdx);
          _drawbarPointerDown(drawbarIdx, e);
        });
        track.addEventListener('pointermove', function(e) {
          var pointerId = (e.pointerId !== undefined) ? e.pointerId : 'mouse';
          var isTracking = (_drawbarPointerMap[pointerId] === drawbarIdx);
          if (isTracking) {
            _drawbarPointerMove(drawbarIdx, e);
          }
        });
        track.addEventListener('pointerup', function(e) {
          _drawbarPointerUp(drawbarIdx, e);
        });
        track.addEventListener('pointercancel', function(e) {
          _drawbarPointerUp(drawbarIdx, e);
        });
      })(di);

      col.appendChild(track);

      // Readout (bottom)
      var readout = document.createElement('div');
      readout.className = 'ssli-organ-drawbar-readout';
      readout.textContent = String(_drawbarValues[di]);
      _drawbarReadoutEls.push(readout);
      col.appendChild(readout);

      panel.appendChild(col);
    }

    _updateAllDrawbarVisuals();
    container.appendChild(panel);
  }

  // ============================================================
  // Build: Keyboard zone
  // ============================================================

  function _buildKeyboardZone(container, opts) {
    var zone = document.createElement('div');
    zone.className = 'ssli-organ-keyboard-zone';

    var baseOctave = opts.baseOctave;
    var startMidi = (baseOctave + OCTAVE_BASE_OFFSET) * SEMITONES_PER_OCTAVE;
    var endMidi = (baseOctave + NUM_ORGAN_OCTAVES + OCTAVE_BASE_OFFSET) * SEMITONES_PER_OCTAVE;

    var midi;
    for (midi = startMidi; midi <= endMidi; midi++) {
      var pc = midi % SEMITONES_PER_OCTAVE;
      var isBlack = _isBlackKey(pc);

      var keyEl = document.createElement('div');
      var keyClass = 'ssli-organ-key ' + (isBlack ? 'ssli-organ-black' : 'ssli-organ-white') + ' pc-' + pc;
      keyEl.className = keyClass;
      keyEl.setAttribute('data-midi', String(midi));
      keyEl.setAttribute('role', 'button');
      keyEl.setAttribute('aria-label', _midiToName(midi));

      var keyLbl = document.createElement('span');
      keyLbl.className = 'ssli-organ-key-label';
      keyLbl.textContent = _midiToName(midi);
      keyEl.appendChild(keyLbl);

      _keyboardKeyEls[midi] = keyEl;

      // Wire mouse/touch events
      (function(m, el) {
        el.addEventListener('mousedown', function(e) {
          e.preventDefault();
          _keyNoteOn(m);
        });
        el.addEventListener('mouseup', function() {
          _keyNoteOff(m);
        });
        el.addEventListener('mouseleave', function() {
          _keyNoteOff(m);
        });
        el.addEventListener('mouseenter', function(e) {
          if (e.buttons > 0) {
            _keyNoteOn(m);
          }
        });
        el.addEventListener('touchstart', function(e) {
          e.preventDefault();
          var touch = e.touches[0];
          var vel = DEFAULT_VELOCITY;
          if (touch && el.getBoundingClientRect) {
            var rect = el.getBoundingClientRect();
            var yRatio = (touch.clientY - rect.top) / (rect.height || 1);
            yRatio = Math.max(0, Math.min(1, yRatio));
            vel = Math.round(VELOCITY_BASE + (yRatio * VELOCITY_RANGE));
          }
          _keyNoteOn(m, vel);
        });
        el.addEventListener('touchend', function(e) {
          e.preventDefault();
          _keyNoteOff(m);
        });
      })(midi, keyEl);

      zone.appendChild(keyEl);
    }

    container.appendChild(zone);
  }

  // ============================================================
  // Build (entry point)
  // ============================================================

  function _buildOrgan(container, opts) {
    _cachedNoteOn = opts.noteOn;
    _cachedNoteOff = opts.noteOff;
    _cachedBaseOctave = opts.baseOctave;
    _keyboardKeyEls = {};
    _drawbarPointerMap = {};

    var wrapper = document.createElement('div');
    wrapper.className = 'ssli-organ-wrapper';
    _wrapperEl = wrapper;

    _buildPresetBar(wrapper);
    _buildDrawbarPanel(wrapper);
    _buildKeyboardZone(wrapper, opts);

    container.appendChild(wrapper);

    _publishDrawbarState();
  }

  // ============================================================
  // Cleanup
  // ============================================================

  function _stopAll() {
    var midiKey;
    for (midiKey in _activeNotes) {
      if (_activeNotes.hasOwnProperty(midiKey)) {
        if (_cachedNoteOff) {
          _cachedNoteOff(parseInt(midiKey, 10));
        }
      }
    }
    _activeNotes = {};

    var kk;
    for (kk in _keyboardKeyEls) {
      if (_keyboardKeyEls.hasOwnProperty(kk)) {
        _keyboardKeyEls[kk].classList.remove('active');
      }
    }
  }

  function _releaseAll() {
    _stopAll();
    _keyboardKeyEls = {};
    _drawbarThumbEls = [];
    _drawbarReadoutEls = [];
    _presetSelectEl = null;
    _percBtnEl = null;
    _wrapperEl = null;
    _drawbarPointerMap = {};
  }

  // ============================================================
  // Register
  // ============================================================

  if (!SL.controllers) { SL.controllers = {}; }
  SL.controllers.organ = {
    build: function(container, opts) {
      _buildOrgan(container, opts);
    },
    release: _releaseAll,
    drawbars: _drawbarValues.slice(),
    percussion: _percussionMode
  };

  // ============================================================
  // Panic hook
  // ============================================================

  if (SL.PanicRegistry && SL.PanicRegistry.register) {
    SL.PanicRegistry.register(
      'voices',
      'organ.notes',
      function() { _stopAll(); },
      function() {
        var count = Object.keys(_activeNotes).length;
        return count > 0 ? count + ' organ notes held' : '';
      }
    );
  }

})();
