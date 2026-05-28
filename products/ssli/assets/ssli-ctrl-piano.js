// SSLI Controller: Piano Keyboard
// ES5 compatible (var, no arrow functions, no template literals)

(function() {
  'use strict';

  var SL = window.SynthLab;

  // ============================================================
  // Constants
  // ============================================================

  var NOTES = SL.NOTES;
  var BLACK_KEYS = [1, 3, 6, 8, 10];

  var NO_NODE = null;
  var WHITE_KEY_BASE_WIDTH = 62;
  var WHITES_PER_OCTAVE = 7;
  var DEFAULT_VELOCITY = 100;
  var VELOCITY_MIN = 40;
  var VELOCITY_MAX = 127;
  var VELOCITY_RANGE_FROM_POSITION = VELOCITY_MAX - VELOCITY_MIN;
  var VELOCITY_BASE = 64;
  var VELOCITY_RANGE = 63;
  var MIN_OCTAVES = 2;
  var DEFAULT_CONTAINER_WIDTH = 800;

  // Computer keyboard mapping
  var KEY_TO_SEMITONE = {
    'KeyA': 0,   'KeyW': 1,   'KeyS': 2,   'KeyE': 3,
    'KeyD': 4,   'KeyF': 5,   'KeyT': 6,   'KeyG': 7,
    'KeyY': 8,   'KeyH': 9,   'KeyU': 10,  'KeyJ': 11,
    'KeyK': 12,  'KeyO': 13,  'KeyL': 14
  };

  // ============================================================
  // Helpers
  // ============================================================

  function _isBlackKey(pc) {
    for (var i = 0; i < BLACK_KEYS.length; i++) {
      if (BLACK_KEYS[i] === pc) {
        return true;
      }
    }
    return false;
  }

  function _midiToName(midi) {
    var pc = midi % 12;
    var oct = Math.floor(midi / 12) - 1;
    return NOTES[pc] + oct;
  }

  // Module-level reference to noteOff for PanicRegistry
  var _noteOffFn = null;

  // ============================================================
  // Build
  // ============================================================

  function _buildPianoKeyboard(container, opts) {
    var baseOctave = opts.baseOctave;
    var numOctaves = opts.numOctaves;
    var noteOn = opts.noteOn;
    var noteOff = opts.noteOff;

    _noteOffFn = noteOff;

    var startMidi = (baseOctave + 1) * 12;
    var endMidi = (baseOctave + numOctaves + 1) * 12;

    // Determine how many octaves fit
    var containerWidth = container.parentElement ? container.parentElement.clientWidth : DEFAULT_CONTAINER_WIDTH;
    var maxOctaves = Math.floor(containerWidth / (WHITE_KEY_BASE_WIDTH * WHITES_PER_OCTAVE));
    if (maxOctaves < MIN_OCTAVES) {
      maxOctaves = MIN_OCTAVES;
    }
    if (numOctaves > maxOctaves) {
      numOctaves = maxOctaves;
      endMidi = (baseOctave + numOctaves + 1) * 12;
      // Report adjusted octaves back
      if (opts.onOctaveAdjust) {
        opts.onOctaveAdjust(numOctaves);
      }
    }

    // Computer key binding map
    var bindingMap = {};
    var baseComputerMidi = (baseOctave + 1) * 12;
    var keys = Object.keys(KEY_TO_SEMITONE);
    for (var k = 0; k < keys.length; k++) {
      var code = keys[k];
      var semitone = KEY_TO_SEMITONE[code];
      var boundMidi = baseComputerMidi + semitone;
      bindingMap[boundMidi] = code.replace('Key', '');
    }

    for (var midi = startMidi; midi <= endMidi; midi++) {
      var pc = midi % 12;
      var black = _isBlackKey(pc);

      var keyEl = document.createElement('div');
      keyEl.className = 'perf-key ' + (black ? 'perf-black' : 'perf-white') + ' pc-' + pc;
      keyEl.setAttribute('data-midi', midi);
      keyEl.setAttribute('role', 'button');
      keyEl.setAttribute('aria-label', _midiToName(midi));

      var lbl = document.createElement('span');
      lbl.className = 'perf-key-label';
      lbl.textContent = _midiToName(midi);
      keyEl.appendChild(lbl);

      if (bindingMap[midi]) {
        var bindLbl = document.createElement('span');
        bindLbl.className = 'perf-key-binding';
        bindLbl.textContent = bindingMap[midi];
        keyEl.appendChild(bindLbl);
      }

      container.appendChild(keyEl);
    }

    // ---- Pointer-event drag layer (works for mouse + touch) ----
    container.style.touchAction = 'none';

    var _activePointers = {};

    function _keyFromPoint(x, y) {
      var hit = document.elementFromPoint(x, y);
      if (hit) {
        // Walk up in case we hit a label span inside the key
        var el = hit;
        var found = false;
        while (el && el !== container) {
          if (el.hasAttribute && el.hasAttribute('data-midi')) {
            found = true;
            break;
          }
          el = el.parentElement;
        }
        if (found) {
          return el;
        }
      }
      return null;
    }

    function _velocityFromPosition(keyEl, clientY) {
      var keyRect = keyEl.getBoundingClientRect();
      var yRatio = (clientY - keyRect.top) / (keyRect.height || 1);
      yRatio = Math.max(0, Math.min(1, yRatio));
      var velocity = Math.round(VELOCITY_MIN + (yRatio * VELOCITY_RANGE_FROM_POSITION));
      return velocity;
    }

    container.addEventListener('pointerdown', function(e) {
      e.preventDefault();

      var keyEl = _keyFromPoint(e.clientX, e.clientY);
      var hasKey = (keyEl !== NO_NODE);

      if (hasKey) {
        var m = parseInt(keyEl.getAttribute('data-midi'), 10);
        var posVel = _velocityFromPosition(keyEl, e.clientY);
        var vel = SL.velocityFromPressure(e, posVel);

        keyEl.classList.add('perf-active');
        noteOn(m, vel);
        _activePointers[e.pointerId] = { el: keyEl, midi: m };
      } else {
        _activePointers[e.pointerId] = { el: null, midi: -1 };
      }
    });

    container.addEventListener('pointermove', function(e) {
      var ptr = _activePointers[e.pointerId];
      if (ptr) {

      var keyEl = _keyFromPoint(e.clientX, e.clientY);
      var isSameKey = (keyEl === ptr.el);

      if (!isSameKey) {
        // Release the old key if one was active
        if (ptr.el) {
          ptr.el.classList.remove('perf-active');
          noteOff(ptr.midi);
        }

        // Press the new key (if pointer is over one)
        if (keyEl) {
          var m = parseInt(keyEl.getAttribute('data-midi'), 10);
          var posVel = _velocityFromPosition(keyEl, e.clientY);
          var vel = SL.velocityFromPressure(e, posVel);
          keyEl.classList.add('perf-active');
          noteOn(m, vel);
          ptr.el = keyEl;
          ptr.midi = m;
        } else {
          ptr.el = null;
          ptr.midi = -1;
        }
      }
      } // end if (ptr)
    });

    function _pointerEnd(e) {
      var ptr = _activePointers[e.pointerId];
      if (ptr) {
        if (ptr.el) {
          ptr.el.classList.remove('perf-active');
          noteOff(ptr.midi);
        }
        delete _activePointers[e.pointerId];
      }
    }

    container.addEventListener('pointerup', function(e) {
      _pointerEnd(e);
    });

    container.addEventListener('pointercancel', function(e) {
      _pointerEnd(e);
    });

    container.addEventListener('pointerleave', function(e) {
      _pointerEnd(e);
    });
  }

  // ============================================================
  // Register
  // ============================================================

  if (!SL.controllers) { SL.controllers = {}; }
  SL.controllers.piano = {
    build: _buildPianoKeyboard,
    release: function(noteOff) {
      var activeKeys = document.querySelectorAll('.perf-key.perf-active');
      var i;
      for (i = 0; i < activeKeys.length; i++) {
        var midi = parseInt(activeKeys[i].getAttribute('data-midi'), 10);
        activeKeys[i].classList.remove('perf-active');
        if (noteOff) {
          noteOff(midi);
        }
      }
    }
  };

  // ============================================================
  // Panic hook
  // ============================================================

  if (SL.PanicRegistry && SL.PanicRegistry.register) {
    SL.PanicRegistry.register(
      'voices',
      'piano.notes',
      function() {
        var activeKeys = document.querySelectorAll('.perf-key.perf-active');
        var i;
        for (i = 0; i < activeKeys.length; i++) {
          var midi = parseInt(activeKeys[i].getAttribute('data-midi'), 10);
          activeKeys[i].classList.remove('perf-active');
          if (_noteOffFn) {
            _noteOffFn(midi);
          }
        }
      },
      function() {
        var activeKeys = document.querySelectorAll('.perf-key.perf-active');
        var count = activeKeys.length;
        if (count > 0) {
          return count + ' piano keys held';
        }
        return '';
      }
    );
  }

})();
