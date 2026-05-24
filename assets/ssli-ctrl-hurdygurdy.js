// SSLI Controller: Hurdy-Gurdy (crank wheel + melody keys + drone toggles)
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

  // Crank wheel
  var CRANK_DIAMETER_PX = 280;
  var CRANK_DIAMETER_PHONE_PX = 200;
  var CRANK_HANDLE_SIZE_PX = 12;
  var CRANK_HANDLE_COLOR = '#e8c87a';

  // Speed mapping
  var CRANK_SPEED_EMA_ALPHA = 0.15;
  var CRANK_SPEED_EMA_RETAIN = 0.85;
  var CRANK_DECAY_FACTOR = 0.92;
  var CRANK_MIN_SPEED = 0.01;
  var CRANK_SPEED_GAIN_DIVISOR = 6.0;
  var CRANK_SPEED_CUTOFF_DIVISOR = 6.0;
  var CRANK_CUTOFF_BASE_HZ = 800;
  var CRANK_VELOCITY_BASE = 40;
  var CRANK_VELOCITY_SCALE = 14.5;
  var CRANK_VELOCITY_MAX_ADD = 87;

  // Buzz
  var BUZZ_ACCEL_THRESHOLD = 5.0;

  // Melody keys
  var MELODY_KEY_COUNT = 7;
  var MELODY_KEY_WIDTH_PX = 240;
  var MELODY_KEY_WIDTH_PHONE_PX = 160;
  var MELODY_KEY_HEIGHT_PX = 0;  // computed dynamically to fill available space
  var MELODY_KEY_HEIGHT_PHONE_PX = 0;  // computed dynamically
  var MELODY_KEY_MIN_HEIGHT_PX = 20;
  var MELODY_KEY_MAX_HEIGHT_PX = 64;
  var MELODY_KEY_BORDER_PX = 4;

  // Degree labels for diatonic scale (1-indexed roman numeral style)
  var DEGREE_LABELS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

  // Drone pills
  var DRONE_PILL_W_PX = 100;
  var DRONE_PILL_H_PX = 32;
  var DRONE_PILL_W_PHONE_PX = 64;
  var DRONE_PILL_H_PHONE_PX = 28;

  // Buzz button
  var BUZZ_BTN_W_PX = 80;
  var BUZZ_BTN_H_PX = 36;
  var BUZZ_BTN_W_PHONE_PX = 64;
  var BUZZ_BTN_H_PHONE_PX = 28;
  var BUZZ_ACTIVE_COLOR = '#805020';

  // Diatonic scale (major by default)
  var DIATONIC_INTERVALS = [0, 2, 4, 5, 7, 9, 11];

  // Root names for key selector
  var ROOT_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

  // Scale modes with interval patterns
  var SCALE_MODES = {
    'Major':      [0, 2, 4, 5, 7, 9, 11],
    'Minor':      [0, 2, 3, 5, 7, 8, 10],
    'Dorian':     [0, 2, 3, 5, 7, 9, 10],
    'Mixolydian': [0, 2, 4, 5, 7, 9, 10],
    'Phrygian':   [0, 1, 3, 5, 7, 8, 10],
    'Pentatonic': [0, 2, 4, 7, 9],
    'Blues':       [0, 3, 5, 6, 7, 10]
  };
  var SCALE_MODE_NAMES = ['Major', 'Minor', 'Dorian', 'Mixolydian', 'Phrygian', 'Pentatonic', 'Blues'];

  // Drone intervals relative to root: tonic (0), fifth (+7), octave (+12)
  var DRONE_TONIC_INTERVAL = 0;
  var DRONE_FIFTH_INTERVAL = 7;
  var DRONE_OCTAVE_INTERVAL = 12;
  var DRONE_OCTAVE_OFFSET = -1;

  // Buzz tremolo
  var BUZZ_TREMOLO_RATE = 30.0;
  var BUZZ_TREMOLO_DEPTH_MIN = 0.5;
  var BUZZ_TREMOLO_DEPTH_RANGE = 0.5;

  // Buzz percussive hit
  var BUZZ_HIT_DURATION_SEC = 0.12;
  var BUZZ_HIT_FREQ_HZ = 180;
  var BUZZ_HIT_HARMONICS = 4;
  var BUZZ_HIT_GAIN = 0.35;
  var BUZZ_HIT_COOLDOWN_MS = 100;

  // Key/mode selector button sizes
  var KEY_SELECTOR_BTN_SIZE_PX = 28;
  var MODE_SELECTOR_BTN_HEIGHT_PX = 28;

  // Scriabin-ish pitch class colors for key borders
  var PITCH_CLASS_COLORS = [
    '#ff0000', '#ff7700', '#ffff00', '#8eff00', '#00ff00', '#00ccff',
    '#0044ff', '#0000ff', '#7700ff', '#cc00ff', '#ff00cc', '#ff0066'
  ];

  // Animation frame timing
  var FRAME_MS = 16;

  // Decay fadeout for drones (ms)
  var DRONE_FADE_MS = 800;

  // ============================================================
  // State
  // ============================================================

  var _crankActive = false;
  var _crankAngle = 0;
  var _crankSpeed = 0;
  var _crankSpeedSmoothed = 0;
  var _crankPrevSpeed = 0;
  var _crankAccel = 0;
  var _crankLastTime = 0;
  var _crankDecayId = 0;

  var _melodyMidi = -1;
  var _melodyKeyEls = [];
  var _activeMelodyIdx = -1;

  var _drone1Active = false;
  var _drone2Active = false;
  var _drone3Active = false;
  var _drone1Midi = -1;
  var _drone2Midi = -1;
  var _drone3Midi = -1;
  var _drone1SoundingId = null;
  var _drone2SoundingId = null;
  var _drone3SoundingId = null;

  var _buzzActive = false;
  var _buzzPhase = 0;
  var _buzzAnimId = 0;
  var _buzzLastHitTime = 0;

  var _selectedRoot = 0;
  var _selectedModeName = 'Major';
  var _activeIntervals = [0, 2, 4, 5, 7, 9, 11];

  var _cachedNoteOn = null;
  var _cachedNoteOff = null;
  var _cachedBaseOctave = 3;
  var _cachedRootPc = 0;

  var _crankHandleEl = null;
  var _crankWheelEl = null;
  var _drone1El = null;
  var _drone2El = null;
  var _drone3El = null;
  var _buzzBtnEl = null;
  var _rootSelectorEls = [];
  var _modeSelectorEls = [];
  var _speedFillEl = null;
  var _droneIndicatorEl = null;

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

  function _computeMelodyMidi(baseOctave, rootPc, degreeIdx) {
    var interval = _activeIntervals[degreeIdx];
    var midi = ((baseOctave + OCTAVE_BASE_OFFSET) * SEMITONES_PER_OCTAVE) + rootPc + interval;
    return midi;
  }

  function _computeDroneMidi(baseOctave, rootPc, interval) {
    var midi = ((baseOctave + OCTAVE_BASE_OFFSET + DRONE_OCTAVE_OFFSET) * SEMITONES_PER_OCTAVE) + rootPc + interval;
    return midi;
  }

  function _pitchClassColor(midi) {
    var pc = ((midi % SEMITONES_PER_OCTAVE) + SEMITONES_PER_OCTAVE) % SEMITONES_PER_OCTAVE;
    return PITCH_CLASS_COLORS[pc];
  }

  // ============================================================
  // Expression
  // ============================================================

  function _applyExpression(speed) {
    var gain = Math.min(1.0, speed / CRANK_SPEED_GAIN_DIVISOR);
    var cutoff = CRANK_CUTOFF_BASE_HZ * Math.pow(10, speed / CRANK_SPEED_CUTOFF_DIVISOR);
    if (SL.audio && SL.audio.setExpression) {
      SL.audio.setExpression(cutoff, gain);
    }
  }

  function _clearExpression() {
    if (SL.audio && SL.audio.clearExpression) {
      SL.audio.clearExpression();
    }
  }

  // ============================================================
  // Buzz tremolo
  // ============================================================

  function _buzzTremoloTick() {
    var crankSounding = (_crankSpeedSmoothed >= CRANK_MIN_SPEED);
    var shouldContinue = (_buzzActive && crankSounding);
    if (shouldContinue) {
      _buzzPhase = _buzzPhase + (BUZZ_TREMOLO_RATE * (FRAME_MS / 1000) * Math.PI * 2);
      var tremoloGain = BUZZ_TREMOLO_DEPTH_MIN + (BUZZ_TREMOLO_DEPTH_RANGE * Math.sin(_buzzPhase));
      if (SL.audio && SL.audio.setBuzzTremolo) {
        SL.audio.setBuzzTremolo(tremoloGain);
      }
      _buzzAnimId = setTimeout(_buzzTremoloTick, FRAME_MS);
    } else {
      _buzzPhase = 0;
      if (SL.audio && SL.audio.setBuzzTremolo) {
        SL.audio.setBuzzTremolo(1.0);
      }
      _buzzAnimId = 0;
    }
  }

  function _startBuzzTremolo() {
    if (_buzzAnimId === 0) {
      _buzzPhase = 0;
      _buzzAnimId = setTimeout(_buzzTremoloTick, FRAME_MS);
    }
  }

  function _stopBuzzTremolo() {
    if (_buzzAnimId) {
      clearTimeout(_buzzAnimId);
      _buzzAnimId = 0;
    }
    _buzzPhase = 0;
    if (SL.audio && SL.audio.setBuzzTremolo) {
      SL.audio.setBuzzTremolo(1.0);
    }
  }

  // ============================================================
  // Buzz percussive hit (trompette "brr" on crank jerk)
  // ============================================================

  function _triggerBuzzHit(accelIntensity) {
    var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    var elapsed = now - _buzzLastHitTime;
    var cooledDown = (elapsed >= BUZZ_HIT_COOLDOWN_MS);
    if (cooledDown) {
      _buzzLastHitTime = now;
      var audioCtx = (SL.audio && SL.audio.getCtx) ? SL.audio.getCtx() : null;
      if (audioCtx) {
        var destination = (SL.audio && SL.audio.getFinalDestination) ? SL.audio.getFinalDestination() : audioCtx.destination;
        var hitGain = audioCtx.createGain();
        var intensityScale = Math.min(1.0, accelIntensity / (BUZZ_ACCEL_THRESHOLD * 3));
        var gainValue = BUZZ_HIT_GAIN * (0.5 + (0.5 * intensityScale));
        hitGain.gain.setValueAtTime(gainValue, audioCtx.currentTime);
        hitGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + BUZZ_HIT_DURATION_SEC);
        hitGain.connect(destination);

        // Create multiple detuned oscillators for "brr" texture
        var hi;
        for (hi = 0; hi < BUZZ_HIT_HARMONICS; hi++) {
          var osc = audioCtx.createOscillator();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(BUZZ_HIT_FREQ_HZ * (hi + 1), audioCtx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(BUZZ_HIT_FREQ_HZ * 0.5, audioCtx.currentTime + BUZZ_HIT_DURATION_SEC);
          var harmonicGain = audioCtx.createGain();
          var harmonicAttenuation = 1.0 / (hi + 1);
          harmonicGain.gain.setValueAtTime(harmonicAttenuation, audioCtx.currentTime);
          osc.connect(harmonicGain);
          harmonicGain.connect(hitGain);
          osc.start(audioCtx.currentTime);
          osc.stop(audioCtx.currentTime + BUZZ_HIT_DURATION_SEC);
        }
      }
    }
  }

  // ============================================================
  // Scale recomputation
  // ============================================================

  function _recomputeScale() {
    _activeIntervals = SCALE_MODES[_selectedModeName];
    _cachedRootPc = _selectedRoot;
    _drone1Midi = _computeDroneMidi(_cachedBaseOctave, _cachedRootPc, DRONE_TONIC_INTERVAL);
    _drone2Midi = _computeDroneMidi(_cachedBaseOctave, _cachedRootPc, DRONE_FIFTH_INTERVAL);
    _drone3Midi = _computeDroneMidi(_cachedBaseOctave, _cachedRootPc, DRONE_OCTAVE_INTERVAL);
    _refreshMelodyKeyLabels();
    _refreshDroneLabels();
  }

  function _refreshMelodyKeyLabels() {
    var noteCount = _activeIntervals.length;
    var i;
    for (i = 0; i < _melodyKeyEls.length; i++) {
      var keyEl = _melodyKeyEls[i];
      var isAvailable = (i < noteCount);
      if (isAvailable) {
        keyEl.style.display = '';
        keyEl.disabled = false;
        var keyMidi = _computeMelodyMidi(_cachedBaseOctave, _cachedRootPc, i);
        var degreeSpan = keyEl.querySelector('.ssli-hurdygurdy-key-degree');
        var noteSpan = keyEl.querySelector('.ssli-hurdygurdy-key-note');
        if (degreeSpan) {
          degreeSpan.textContent = (i < DEGREE_LABELS.length) ? DEGREE_LABELS[i] : (i + 1);
        }
        if (noteSpan) {
          noteSpan.textContent = _midiToName(keyMidi);
        }
        keyEl.style.borderLeftColor = _pitchClassColor(keyMidi);
      } else {
        keyEl.style.display = 'none';
        keyEl.disabled = true;
      }
    }
  }

  function _refreshDroneLabels() {
    var rootName = ROOT_NAMES[_selectedRoot];
    if (_drone1El) {
      _drone1El.textContent = SL.t('hurdygurdy.tonic') + ' (' + rootName + ')';
    }
    if (_drone2El) {
      var fifthPc = (_selectedRoot + DRONE_FIFTH_INTERVAL) % SEMITONES_PER_OCTAVE;
      _drone2El.textContent = SL.t('hurdygurdy.fifth') + ' (' + ROOT_NAMES[fifthPc] + ')';
    }
    if (_drone3El) {
      _drone3El.textContent = SL.t('hurdygurdy.octave') + ' (' + rootName + ')';
    }
  }

  function _refreshRootSelectorStyles() {
    var i;
    for (i = 0; i < _rootSelectorEls.length; i++) {
      if (i === _selectedRoot) {
        _rootSelectorEls[i].classList.add('active');
      } else {
        _rootSelectorEls[i].classList.remove('active');
      }
    }
  }

  function _refreshModeSelectorStyles() {
    var i;
    for (i = 0; i < _modeSelectorEls.length; i++) {
      if (SCALE_MODE_NAMES[i] === _selectedModeName) {
        _modeSelectorEls[i].classList.add('active');
      } else {
        _modeSelectorEls[i].classList.remove('active');
      }
    }
  }

  // ============================================================
  // Crank visual
  // ============================================================

  function _updateCrankVisual() {
    if (_crankHandleEl) {
      var radius = (CRANK_DIAMETER_PX / 2) - (CRANK_HANDLE_SIZE_PX / 2) - 4;
      var hx = Math.cos(_crankAngle) * radius;
      var hy = Math.sin(_crankAngle) * radius;
      _crankHandleEl.style.left = 'calc(50% + ' + Math.round(hx) + 'px)';
      _crankHandleEl.style.top = 'calc(50% + ' + Math.round(hy) + 'px)';
    }
    if (_crankWheelEl) {
      var glowIntensity = _clamp01(_crankSpeedSmoothed / CRANK_SPEED_GAIN_DIVISOR);
      var glowAlpha = (glowIntensity * 0.5).toFixed(2);
      _crankWheelEl.style.boxShadow = 'inset 0 0 ' + Math.round(40 * glowIntensity) + 'px rgba(76, 201, 240, ' + glowAlpha + ')';
    }
  }

  function _updateSpeedMeter() {
    if (_speedFillEl) {
      var speedFrac = Math.min(1.0, _crankSpeedSmoothed / CRANK_SPEED_GAIN_DIVISOR);
      _speedFillEl.style.width = Math.round(speedFrac * 100) + '%';
    }
    if (_droneIndicatorEl) {
      var activeDrones = [];
      if (_drone1Active) { activeDrones.push('Tonic'); }
      if (_drone2Active) { activeDrones.push('Fifth'); }
      if (_drone3Active) { activeDrones.push('Octave'); }
      var indicatorText = (activeDrones.length > 0) ? activeDrones.join(' + ') : 'No drones active';
      _droneIndicatorEl.textContent = indicatorText;
    }
  }

  // ============================================================
  // Drone management
  // ============================================================

  function _startDrone(droneIdx) {
    var midi = -1;
    var isActive = (_crankSpeedSmoothed >= CRANK_MIN_SPEED);
    if (droneIdx === 0) {
      midi = _drone1Midi;
    } else if (droneIdx === 1) {
      midi = _drone2Midi;
    } else if (droneIdx === 2) {
      midi = _drone3Midi;
    }
    if (isActive && _cachedNoteOn && midi >= 0) {
      _cachedNoteOn(midi);
    }
    if (droneIdx === 0) {
      _drone1SoundingId = isActive ? midi : null;
    } else if (droneIdx === 1) {
      _drone2SoundingId = isActive ? midi : null;
    } else if (droneIdx === 2) {
      _drone3SoundingId = isActive ? midi : null;
    }
  }

  function _stopDrone(droneIdx) {
    if (droneIdx === 0) {
      if (_drone1SoundingId !== null && _cachedNoteOff) {
        _cachedNoteOff(_drone1SoundingId);
        _drone1SoundingId = null;
      }
    } else if (droneIdx === 1) {
      if (_drone2SoundingId !== null && _cachedNoteOff) {
        _cachedNoteOff(_drone2SoundingId);
        _drone2SoundingId = null;
      }
    } else if (droneIdx === 2) {
      if (_drone3SoundingId !== null && _cachedNoteOff) {
        _cachedNoteOff(_drone3SoundingId);
        _drone3SoundingId = null;
      }
    }
  }

  function _updateDroneSounding() {
    var crankSounding = (_crankSpeedSmoothed >= CRANK_MIN_SPEED);
    if (_drone1Active && crankSounding && _drone1SoundingId === null) {
      _startDrone(0);
    } else if ((!_drone1Active || !crankSounding) && _drone1SoundingId !== null) {
      _stopDrone(0);
    }
    if (_drone2Active && crankSounding && _drone2SoundingId === null) {
      _startDrone(1);
    } else if ((!_drone2Active || !crankSounding) && _drone2SoundingId !== null) {
      _stopDrone(1);
    }
    if (_drone3Active && crankSounding && _drone3SoundingId === null) {
      _startDrone(2);
    } else if ((!_drone3Active || !crankSounding) && _drone3SoundingId !== null) {
      _stopDrone(2);
    }
    // Buzz tremolo management
    if (_buzzActive && crankSounding) {
      _startBuzzTremolo();
    } else {
      _stopBuzzTremolo();
    }
  }

  // ============================================================
  // Crank decay loop
  // ============================================================

  function _crankDecayTick() {
    if (_crankActive) { return; }
    _crankSpeedSmoothed = _crankSpeedSmoothed * CRANK_DECAY_FACTOR;
    var stillSpinning = (_crankSpeedSmoothed >= CRANK_MIN_SPEED);
    if (stillSpinning) {
      _applyExpression(_crankSpeedSmoothed);
      _crankAngle = _crankAngle + (_crankSpeedSmoothed * (FRAME_MS / 1000));
      _updateCrankVisual();
      _updateSpeedMeter();
      _updateDroneSounding();
      _crankDecayId = setTimeout(_crankDecayTick, FRAME_MS);
    } else {
      _crankSpeedSmoothed = 0;
      _stopMelody();
      _stopDrone(0);
      _stopDrone(1);
      _stopDrone(2);
      _stopBuzzTremolo();
      _clearExpression();
      _updateCrankVisual();
      _updateSpeedMeter();
    }
  }

  // ============================================================
  // Melody keys
  // ============================================================

  function _playMelodyKey(keyIdx) {
    var crankSounding = (_crankSpeedSmoothed >= CRANK_MIN_SPEED);
    var keyInRange = (keyIdx < _activeIntervals.length);
    if (crankSounding && keyInRange) {
      var midi = _computeMelodyMidi(_cachedBaseOctave, _cachedRootPc, keyIdx);
      var velocity = CRANK_VELOCITY_BASE + Math.min(CRANK_VELOCITY_MAX_ADD, Math.floor(_crankSpeedSmoothed * CRANK_VELOCITY_SCALE));
      var oldMelodyMidi = _melodyMidi;

      // Legato: start new note FIRST, then stop old note
      // This ensures no gap — the wheel never stops exciting the string
      _melodyMidi = midi;
      _activeMelodyIdx = keyIdx;

      if (_cachedNoteOn) {
        _cachedNoteOn(midi, velocity);
      }

      if (oldMelodyMidi >= 0 && oldMelodyMidi !== midi && _cachedNoteOff) {
        _cachedNoteOff(oldMelodyMidi);
      }

      _refreshMelodyKeyStyles();
    }
  }

  function _stopMelody() {
    if (_melodyMidi >= 0 && _cachedNoteOff) {
      _cachedNoteOff(_melodyMidi);
    }
    _melodyMidi = -1;
    _activeMelodyIdx = -1;
    _refreshMelodyKeyStyles();
  }

  function _refreshMelodyKeyStyles() {
    var i;
    for (i = 0; i < _melodyKeyEls.length; i++) {
      var isActive = (i === _activeMelodyIdx);
      if (isActive) {
        _melodyKeyEls[i].classList.add('active');
      } else {
        _melodyKeyEls[i].classList.remove('active');
      }
    }
  }

  // ============================================================
  // Stop all
  // ============================================================

  function _stopAll() {
    _crankActive = false;
    _crankPointerId = -1;
    if (_crankDecayId) {
      clearTimeout(_crankDecayId);
      _crankDecayId = 0;
    }
    _crankSpeed = 0;
    _crankSpeedSmoothed = 0;
    _crankPrevSpeed = 0;
    _crankAccel = 0;
    _stopMelody();
    _stopDrone(0);
    _stopDrone(1);
    _stopDrone(2);
    _stopBuzzTremolo();
    _clearExpression();
    _updateCrankVisual();
    _updateSpeedMeter();
  }

  // ============================================================
  // Document-level safety
  // ============================================================

  // Track which pointer ID is actively cranking, so melody key lifts don't stall the crank
  var _crankPointerId = -1;

  var _docPointerUpBound = null;

  function _documentPointerUp(ev) {
    var isCrankPointer = (_crankPointerId >= 0 && ev.pointerId === _crankPointerId);
    if (_crankActive && isCrankPointer) {
      _crankActive = false;
      _crankPointerId = -1;
      _crankLastTime = 0;
      _crankDecayId = setTimeout(_crankDecayTick, FRAME_MS);
    }
  }

  function _addDocumentListeners() {
    if (_docPointerUpBound) {
      document.removeEventListener('pointerup', _docPointerUpBound);
      document.removeEventListener('pointercancel', _docPointerUpBound);
    }
    _docPointerUpBound = _documentPointerUp;
    document.addEventListener('pointerup', _docPointerUpBound);
    document.addEventListener('pointercancel', _docPointerUpBound);
  }

  function _removeDocumentListeners() {
    if (_docPointerUpBound) {
      document.removeEventListener('pointerup', _docPointerUpBound);
      document.removeEventListener('pointercancel', _docPointerUpBound);
      _docPointerUpBound = null;
    }
  }

  _addDocumentListeners();

  // ============================================================
  // Build
  // ============================================================

  function _buildHurdyGurdyController(container, opts) {
    var baseOctave = opts.baseOctave;
    var noteOn = opts.noteOn;
    var noteOff = opts.noteOff;

    _stopAll();
    _addDocumentListeners();

    _cachedNoteOn = noteOn;
    _cachedNoteOff = noteOff;
    _cachedBaseOctave = baseOctave;
    _selectedRoot = 0;
    _selectedModeName = 'Major';
    _activeIntervals = SCALE_MODES['Major'];
    _cachedRootPc = 0;
    _melodyKeyEls = [];
    _rootSelectorEls = [];
    _modeSelectorEls = [];
    _activeMelodyIdx = -1;
    _melodyMidi = -1;
    _drone1Active = false;
    _drone2Active = false;
    _drone3Active = false;
    _buzzActive = false;
    _buzzPhase = 0;
    _drone1Midi = _computeDroneMidi(baseOctave, _cachedRootPc, DRONE_TONIC_INTERVAL);
    _drone2Midi = _computeDroneMidi(baseOctave, _cachedRootPc, DRONE_FIFTH_INTERVAL);
    _drone3Midi = _computeDroneMidi(baseOctave, _cachedRootPc, DRONE_OCTAVE_INTERVAL);

    var wrapper = document.createElement('div');
    wrapper.className = 'ssli-hurdygurdy-wrapper';

    // ---------- Top bar: drones (left) + buzz (right) ----------
    var topBar = document.createElement('div');
    topBar.className = 'ssli-hurdygurdy-top-bar';

    var droneGroup = document.createElement('div');
    droneGroup.className = 'ssli-hurdygurdy-drone-group';

    // Drone 1 (tonic)
    var drone1 = document.createElement('button');
    drone1.className = 'ssli-hurdygurdy-drone-pill';
    drone1.textContent = SL.t('hurdygurdy.tonic') + ' (' + ROOT_NAMES[_selectedRoot] + ')';
    drone1.title = SL.t('hurdygurdy.toggle_tonic_drone');
    drone1.addEventListener('click', function(ev) {
      ev.preventDefault();
      _drone1Active = !_drone1Active;
      if (_drone1Active) {
        drone1.classList.add('active');
        _updateDroneSounding();
      } else {
        drone1.classList.remove('active');
        _stopDrone(0);
      }
    });
    droneGroup.appendChild(drone1);
    _drone1El = drone1;

    // Drone 2 (fifth)
    var drone2 = document.createElement('button');
    drone2.className = 'ssli-hurdygurdy-drone-pill';
    var fifthPc = (_selectedRoot + DRONE_FIFTH_INTERVAL) % SEMITONES_PER_OCTAVE;
    drone2.textContent = SL.t('hurdygurdy.fifth') + ' (' + ROOT_NAMES[fifthPc] + ')';
    drone2.title = SL.t('hurdygurdy.toggle_fifth_drone');
    drone2.addEventListener('click', function(ev) {
      ev.preventDefault();
      _drone2Active = !_drone2Active;
      if (_drone2Active) {
        drone2.classList.add('active');
        _updateDroneSounding();
      } else {
        drone2.classList.remove('active');
        _stopDrone(1);
      }
    });
    droneGroup.appendChild(drone2);
    _drone2El = drone2;

    // Drone 3 (octave)
    var drone3 = document.createElement('button');
    drone3.className = 'ssli-hurdygurdy-drone-pill';
    drone3.textContent = SL.t('hurdygurdy.octave') + ' (' + ROOT_NAMES[_selectedRoot] + ')';
    drone3.title = SL.t('hurdygurdy.toggle_octave_drone');
    drone3.addEventListener('click', function(ev) {
      ev.preventDefault();
      _drone3Active = !_drone3Active;
      if (_drone3Active) {
        drone3.classList.add('active');
        _updateDroneSounding();
      } else {
        drone3.classList.remove('active');
        _stopDrone(2);
      }
    });
    droneGroup.appendChild(drone3);
    _drone3El = drone3;

    topBar.appendChild(droneGroup);

    // Buzz button
    var buzzBtn = document.createElement('button');
    buzzBtn.className = 'ssli-hurdygurdy-buzz-btn';
    buzzBtn.textContent = SL.t('hurdygurdy.buzz');
    buzzBtn.title = SL.t('hurdygurdy.buzz_toggle_title');
    buzzBtn.addEventListener('click', function(ev) {
      ev.preventDefault();
      _buzzActive = !_buzzActive;
      if (_buzzActive) {
        buzzBtn.classList.add('active');
        _updateDroneSounding();
      } else {
        buzzBtn.classList.remove('active');
        _stopBuzzTremolo();
      }
    });
    topBar.appendChild(buzzBtn);
    _buzzBtnEl = buzzBtn;

    wrapper.appendChild(topBar);

    // ---------- Crank speed indicator + drone volume row ----------
    var statusRow = document.createElement('div');
    statusRow.className = 'ssli-hurdygurdy-status-row';

    // Crank speed meter
    var speedGroup = document.createElement('div');
    speedGroup.className = 'ssli-hurdygurdy-speed-group';

    var speedLabel = document.createElement('span');
    speedLabel.className = 'ssli-hurdygurdy-selector-label';
    speedLabel.textContent = SL.t('hurdygurdy.speed_label');
    speedGroup.appendChild(speedLabel);

    var speedMeterOuter = document.createElement('div');
    speedMeterOuter.className = 'ssli-hurdygurdy-speed-meter';
    var speedMeterFill = document.createElement('div');
    speedMeterFill.className = 'ssli-hurdygurdy-speed-fill';
    speedMeterOuter.appendChild(speedMeterFill);
    speedGroup.appendChild(speedMeterOuter);
    statusRow.appendChild(speedGroup);

    // Drone volume slider
    var volGroup = document.createElement('div');
    volGroup.className = 'ssli-hurdygurdy-vol-group';

    var volLabel = document.createElement('span');
    volLabel.className = 'ssli-hurdygurdy-selector-label';
    volLabel.textContent = SL.t('hurdygurdy.drone_vol_label');
    volGroup.appendChild(volLabel);

    var DRONE_VOL_DEFAULT = 0.7;
    var _droneVolume = DRONE_VOL_DEFAULT;
    var volSlider = document.createElement('input');
    volSlider.type = 'range';
    volSlider.min = '0';
    volSlider.max = '100';
    volSlider.value = String(Math.round(DRONE_VOL_DEFAULT * 100));
    volSlider.className = 'ssli-hurdygurdy-vol-slider';
    volSlider.addEventListener('input', function() {
      _droneVolume = parseInt(volSlider.value, 10) / 100;
      if (SL.audio && SL.audio.setDroneVolume) {
        SL.audio.setDroneVolume(_droneVolume);
      }
    });
    volGroup.appendChild(volSlider);
    statusRow.appendChild(volGroup);

    // Active drones indicator
    var droneIndicator = document.createElement('div');
    droneIndicator.className = 'ssli-hurdygurdy-drone-indicator';
    droneIndicator.id = 'hurdygurdyDroneIndicator';
    droneIndicator.textContent = SL.t('hurdygurdy.no_drones_active');
    statusRow.appendChild(droneIndicator);

    wrapper.appendChild(statusRow);

    // Store references for _updateSpeedMeter (module-level function, no closure chaining)
    _speedFillEl = speedMeterFill;
    _droneIndicatorEl = droneIndicator;

    // ---------- Main body: keys (left) + crank (right) ----------
    var body = document.createElement('div');
    body.className = 'ssli-hurdygurdy-body';

    // Melody keys column -- larger keys with degree + note labels
    var keysCol = document.createElement('div');
    keysCol.className = 'ssli-hurdygurdy-keys-col';

    // Header label
    var keysHeader = document.createElement('div');
    keysHeader.className = 'ssli-hurdygurdy-keys-header';
    keysHeader.textContent = SL.t('hurdygurdy.melody_keys');
    keysCol.appendChild(keysHeader);

    var ki;
    for (ki = 0; ki < MELODY_KEY_COUNT; ki++) {
      var keyBtn = document.createElement('button');
      keyBtn.className = 'ssli-hurdygurdy-key';
      var keyVisible = (ki < _activeIntervals.length);
      var keyMidi = keyVisible ? _computeMelodyMidi(baseOctave, _cachedRootPc, ki) : 0;

      // Two-part label: degree numeral + note name
      var degreeSpan = document.createElement('span');
      degreeSpan.className = 'ssli-hurdygurdy-key-degree';
      degreeSpan.textContent = keyVisible ? DEGREE_LABELS[ki] : '';
      keyBtn.appendChild(degreeSpan);

      var noteSpan = document.createElement('span');
      noteSpan.className = 'ssli-hurdygurdy-key-note';
      noteSpan.textContent = keyVisible ? _midiToName(keyMidi) : '';
      keyBtn.appendChild(noteSpan);

      if (keyVisible) {
        keyBtn.style.borderLeftColor = _pitchClassColor(keyMidi);
      } else {
        keyBtn.style.display = 'none';
        keyBtn.disabled = true;
      }

      (function(capturedIdx) {
        keyBtn.addEventListener('pointerdown', function(ev) {
          ev.preventDefault();
          _playMelodyKey(capturedIdx);
        });
        keyBtn.addEventListener('pointerup', function(ev) {
          ev.preventDefault();
          if (_activeMelodyIdx === capturedIdx) {
            _stopMelody();
          }
        });
        keyBtn.addEventListener('pointercancel', function(ev) {
          ev.preventDefault();
          if (_activeMelodyIdx === capturedIdx) {
            _stopMelody();
          }
        });
      })(ki);

      keysCol.appendChild(keyBtn);
      _melodyKeyEls.push(keyBtn);
    }

    body.appendChild(keysCol);

    // Crank wheel area
    var crankArea = document.createElement('div');
    crankArea.className = 'ssli-hurdygurdy-crank-area';

    var wheel = document.createElement('div');
    wheel.className = 'ssli-hurdygurdy-wheel';
    _crankWheelEl = wheel;

    // Handle dot
    var handle = document.createElement('div');
    handle.className = 'ssli-hurdygurdy-handle';
    _crankHandleEl = handle;
    wheel.appendChild(handle);

    // Center label
    var centerLabel = document.createElement('div');
    centerLabel.className = 'ssli-hurdygurdy-wheel-label';
    centerLabel.textContent = SL.t('hurdygurdy.crank');
    wheel.appendChild(centerLabel);

    crankArea.appendChild(wheel);
    body.appendChild(crankArea);

    wrapper.appendChild(body);
    container.appendChild(wrapper);

    // ---------- Crank pointer handling ----------

    function _crankLocalAngle(e) {
      var rect = wheel.getBoundingClientRect();
      var cx = rect.left + (rect.width / 2);
      var cy = rect.top + (rect.height / 2);
      var dx = e.clientX - cx;
      var dy = e.clientY - cy;
      return Math.atan2(dy, dx);
    }

    function _onCrankDown(e) {
      if (_crankActive) { return; }
      e.preventDefault();
      if (wheel.setPointerCapture && typeof e.pointerId !== 'undefined') {
        try { wheel.setPointerCapture(e.pointerId); } catch (err) { /* best effort */ }
      }
      _crankActive = true;
      _crankPointerId = (typeof e.pointerId !== 'undefined') ? e.pointerId : -1;
      if (_crankDecayId) {
        clearTimeout(_crankDecayId);
        _crankDecayId = 0;
      }
      _crankAngle = _crankLocalAngle(e);
      _crankLastTime = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      _crankPrevSpeed = _crankSpeedSmoothed;
    }

    function _onCrankMove(e) {
      if (!_crankActive) { return; }
      var newAngle = _crankLocalAngle(e);
      var delta = newAngle - _crankAngle;

      // Normalize delta to [-PI, PI]
      if (delta > Math.PI) { delta = delta - (2 * Math.PI); }
      if (delta < -Math.PI) { delta = delta + (2 * Math.PI); }

      _crankAngle = newAngle;

      var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      var timeDelta = (now - _crankLastTime) / 1000;
      if (timeDelta < 0.001) { timeDelta = 0.001; }
      _crankLastTime = now;

      var instantSpeed = Math.abs(delta) / timeDelta;
      _crankSpeedSmoothed = (CRANK_SPEED_EMA_RETAIN * _crankSpeedSmoothed) + (CRANK_SPEED_EMA_ALPHA * instantSpeed);

      // Acceleration for buzz
      _crankAccel = Math.abs(_crankSpeedSmoothed - _crankPrevSpeed) / timeDelta;
      _crankPrevSpeed = _crankSpeedSmoothed;

      // Trigger percussive buzz hit when acceleration exceeds threshold
      var buzzShouldFire = (_buzzActive && _crankAccel >= BUZZ_ACCEL_THRESHOLD);
      if (buzzShouldFire) {
        _triggerBuzzHit(_crankAccel);
      }

      _applyExpression(_crankSpeedSmoothed);
      _updateCrankVisual();
      _updateSpeedMeter();
      _updateDroneSounding();
    }

    function _onCrankUp(e) {
      if (!_crankActive) { return; }
      _crankActive = false;
      _crankPointerId = -1;
      _crankLastTime = 0;
      _crankDecayId = setTimeout(_crankDecayTick, FRAME_MS);
    }

    wheel.addEventListener('pointerdown', _onCrankDown);
    wheel.addEventListener('pointermove', _onCrankMove);
    wheel.addEventListener('pointerup', _onCrankUp);
    wheel.addEventListener('pointercancel', function(e) {
      if (wheel.setPointerCapture && typeof e.pointerId !== 'undefined') {
        try { wheel.setPointerCapture(e.pointerId); return; } catch (err) { /* fall through */ }
      }
      _onCrankUp(e);
    });

    // Initial visual state
    _updateCrankVisual();
    _updateSpeedMeter();
  }

  // ============================================================
  // Register
  // ============================================================

  function _release() {
    _stopAll();
    _removeDocumentListeners();
  }

  if (!SL.controllers) { SL.controllers = {}; }
  SL.controllers.hurdygurdy = {
    build: function(container, opts) {
      _buildHurdyGurdyController(container, opts);
    },
    release: _release
  };

  // ============================================================
  // Panic hook
  // ============================================================

  if (SL.PanicRegistry && SL.PanicRegistry.register) {
    SL.PanicRegistry.register(
      'voices',
      'hurdygurdy.crank',
      function() { _stopAll(); },
      function() {
        var status = null;
        if (_crankActive || _crankSpeedSmoothed >= CRANK_MIN_SPEED) {
          status = 'crank active';
        }
        return status;
      }
    );
  }

})();
