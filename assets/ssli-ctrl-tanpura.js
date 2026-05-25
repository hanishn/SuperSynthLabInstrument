// SSLI Controller: Tanpura (auto-cycling drone strings with controls)
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
  var STRING_COUNT = 4;

  var CONTROL_BAR_HEIGHT_PX = 28;
  var CONTROLS_PANEL_WIDTH_PX = 260;

  var TEMPO_MIN_BPM = 40;
  var TEMPO_MAX_BPM = 200;
  var TEMPO_DEFAULT_BPM = 80;

  var JAWARI_MIN = 0.0;
  var JAWARI_MAX = 1.0;
  var JAWARI_DEFAULT = 0.3;

  var DAMPING_MIN = 0.0;
  var DAMPING_MAX = 1.0;
  var DAMPING_DEFAULT = 0.5;

  var NOTE_DURATION_MIN_S = 0.2;
  var NOTE_DURATION_MAX_S = 4.0;

  var JAWARI_CUTOFF_MIN_HZ = 2000;
  var JAWARI_CUTOFF_MAX_HZ = 16000;
  var LN_JAWARI_CUTOFF_MIN = Math.log(JAWARI_CUTOFF_MIN_HZ);
  var LN_JAWARI_CUTOFF_MAX = Math.log(JAWARI_CUTOFF_MAX_HZ);

  var SARGAM_NAMES = ['Sa', 'Re♭', 'Re', 'Ga♭', 'Ga', 'Ma', 'Ma♯', 'Pa', 'Dha♭', 'Dha', 'Ni♭', 'Ni'];

  // Tuning patterns: intervals relative to Sa
  var TUNING_PATTERNS = {
    'Pa-Sa-Sa-Sa':       { label: 'Pa-Sa-Sa-Sa',       intervals: [7, 0, 0, 0], octaveOffsets: [-1, -1, 0, 0] },
    'Ma-Sa-Sa-Sa':       { label: 'Ma-Sa-Sa-Sa',       intervals: [5, 0, 0, 0], octaveOffsets: [-1, -1, 0, 0] },
    'Ni-Sa-Sa-Sa':       { label: 'Ni-Sa-Sa-Sa',       intervals: [11, 0, 0, 0], octaveOffsets: [-2, -1, 0, 0] }
  };
  var TUNING_PATTERN_KEYS = ['Pa-Sa-Sa-Sa', 'Ma-Sa-Sa-Sa', 'Ni-Sa-Sa-Sa'];

  // ============================================================
  // State
  // ============================================================

  var _cycleTimer = null;
  var _currentStringIdx = 0;
  var _tempo = TEMPO_DEFAULT_BPM;
  var _jawari = JAWARI_DEFAULT;
  var _damping = DAMPING_DEFAULT;
  var _rootPc = 0;
  var _tuningKey = 'Pa-Sa-Sa-Sa';
  var _stringMidis = [];
  var _stringActive = [true, true, true, true];
  var _activeNoteTimers = {};
  var _stringLineEls = [];
  var _stringColEls = [];
  var _seqDotEls = [];
  var _stringLabelEls = [];
  var _stringSublabelEls = [];
  var _cachedNoteOn = null;
  var _cachedNoteOff = null;
  var _cachedBaseOctave = 3;
  var _tempoValueEl = null;
  var _jawariValueEl = null;
  var _dampingValueEl = null;
  var _mixBtnEls = [];

  // ============================================================
  // Helpers
  // ============================================================

  function _midiToNoteName(midi) {
    var pc = midi % SEMITONES_PER_OCTAVE;
    var oct = Math.floor(midi / SEMITONES_PER_OCTAVE) - 1;
    return NOTES[pc] + oct;
  }

  function _computeStringMidis(rootPc, baseOctave, tuningKey) {
    var pattern = TUNING_PATTERNS[tuningKey];
    if (!pattern) { pattern = TUNING_PATTERNS['Pa-Sa-Sa-Sa']; }
    var midis = [];
    var i;
    for (i = 0; i < STRING_COUNT; i++) {
      var octave = baseOctave + OCTAVE_BASE_OFFSET + pattern.octaveOffsets[i];
      var midi = (octave * SEMITONES_PER_OCTAVE) + rootPc + pattern.intervals[i];
      midis.push(midi);
    }
    return midis;
  }

  function _getSargamForInterval(interval) {
    var idx = ((interval % SEMITONES_PER_OCTAVE) + SEMITONES_PER_OCTAVE) % SEMITONES_PER_OCTAVE;
    return SARGAM_NAMES[idx];
  }

  function _noteDurationSeconds() {
    return NOTE_DURATION_MIN_S + _damping * (NOTE_DURATION_MAX_S - NOTE_DURATION_MIN_S);
  }

  function _applyJawari() {
    var lnCutoff = LN_JAWARI_CUTOFF_MIN + _jawari * (LN_JAWARI_CUTOFF_MAX - LN_JAWARI_CUTOFF_MIN);
    var cutoffHz = Math.exp(lnCutoff);
    if (SL.audio && SL.audio.setExpression) {
      SL.audio.setExpression(cutoffHz, 1.0);
    }
  }

  // ============================================================
  // Pluck and cycle
  // ============================================================

  function _pluckString(idx) {
    var midi = _stringMidis[idx];
    if (_cachedNoteOn) { _cachedNoteOn(midi); }

    // Visual: plucking state
    if (_stringLineEls[idx]) {
      _stringLineEls[idx].classList.remove('plucking');
      void _stringLineEls[idx].offsetWidth;
      _stringLineEls[idx].classList.add('plucking');
    }
    if (_stringColEls[idx]) {
      _stringColEls[idx].classList.add('pluck-bg');
    }

    // Schedule noteOff based on damping
    var durationMs = Math.floor(_noteDurationSeconds() * 1000);
    if (_activeNoteTimers[idx]) { clearTimeout(_activeNoteTimers[idx]); }
    _activeNoteTimers[idx] = setTimeout(function() {
      if (_cachedNoteOff) { _cachedNoteOff(midi); }
      if (_stringLineEls[idx]) { _stringLineEls[idx].classList.remove('plucking'); }
      if (_stringColEls[idx]) { _stringColEls[idx].classList.remove('pluck-bg'); }
      _activeNoteTimers[idx] = null;
    }, durationMs);
  }

  function _updateSequenceIndicator(nextIdx) {
    var i;
    for (i = 0; i < _seqDotEls.length; i++) {
      if (i === nextIdx) {
        _seqDotEls[i].classList.add('next');
      } else {
        _seqDotEls[i].classList.remove('next');
      }
    }
  }

  function _startCycle() {
    _stopCycle();
    var intervalMs = Math.floor((60 / _tempo) * 1000);
    _applyJawari();
    _cycleTimer = setInterval(function() {
      if (_stringActive[_currentStringIdx]) {
        _pluckString(_currentStringIdx);
      }
      _currentStringIdx = (_currentStringIdx + 1) % STRING_COUNT;
      _updateSequenceIndicator(_currentStringIdx);
    }, intervalMs);
  }

  function _stopCycle() {
    if (_cycleTimer) {
      clearInterval(_cycleTimer);
      _cycleTimer = null;
    }
  }

  function _stopAll() {
    _stopCycle();
    var i;
    for (i = 0; i < STRING_COUNT; i++) {
      if (_activeNoteTimers[i]) {
        clearTimeout(_activeNoteTimers[i]);
        _activeNoteTimers[i] = null;
      }
      if (_cachedNoteOff && _stringMidis[i] >= 0) {
        _cachedNoteOff(_stringMidis[i]);
      }
      if (_stringLineEls[i]) { _stringLineEls[i].classList.remove('plucking'); }
      if (_stringColEls[i]) { _stringColEls[i].classList.remove('pluck-bg'); }
    }
    _currentStringIdx = 0;
    _updateSequenceIndicator(0);
    if (SL.audio && SL.audio.clearExpression) {
      SL.audio.clearExpression();
    }
  }

  function _updateStringLabels() {
    var pattern = TUNING_PATTERNS[_tuningKey];
    if (!pattern) { pattern = TUNING_PATTERNS['Pa-Sa-Sa-Sa']; }
    var i;
    for (i = 0; i < STRING_COUNT; i++) {
      if (_stringLabelEls[i]) {
        _stringLabelEls[i].textContent = _midiToNoteName(_stringMidis[i]);
      }
      if (_stringSublabelEls[i]) {
        _stringSublabelEls[i].textContent = _getSargamForInterval(pattern.intervals[i]);
      }
    }
  }

  // ============================================================
  // Slider builder
  // ============================================================

  function _buildSlider(parent, labelText, min, max, initial, formatFn, onChange) {
    var sliderDiv = document.createElement('div');
    sliderDiv.className = 'ssli-tanpura-slider';

    var labelRow = document.createElement('div');
    labelRow.className = 'ssli-tanpura-slider-label';

    var labelSpan = document.createElement('span');
    labelSpan.textContent = labelText;
    labelRow.appendChild(labelSpan);

    var valueSpan = document.createElement('span');
    valueSpan.textContent = formatFn(initial);
    labelRow.appendChild(valueSpan);

    sliderDiv.appendChild(labelRow);

    var trackWrapper = document.createElement('div');
    trackWrapper.className = 'ssli-tanpura-slider-track-wrapper';

    var track = document.createElement('div');
    track.className = 'ssli-tanpura-slider-track';

    var fill = document.createElement('div');
    fill.className = 'ssli-tanpura-slider-fill';
    var initFrac = (initial - min) / (max - min);
    fill.style.width = Math.floor(initFrac * 100) + '%';
    track.appendChild(fill);
    trackWrapper.appendChild(track);

    var thumb = document.createElement('div');
    thumb.className = 'ssli-tanpura-slider-thumb';
    thumb.style.left = Math.floor(initFrac * 100) + '%';
    trackWrapper.appendChild(thumb);

    sliderDiv.appendChild(trackWrapper);
    parent.appendChild(sliderDiv);

    var _isDragging = false;

    function _updateFromPointer(e) {
      var rect = trackWrapper.getBoundingClientRect();
      var relX = e.clientX - rect.left;
      var frac = relX / rect.width;
      if (frac < 0) { frac = 0; }
      if (frac > 1) { frac = 1; }
      var val = min + frac * (max - min);
      fill.style.width = Math.floor(frac * 100) + '%';
      thumb.style.left = Math.floor(frac * 100) + '%';
      var displayText = formatFn(val);
      valueSpan.textContent = displayText;
      onChange(val);
      if (SL.sliderOverlay) { SL.sliderOverlay.show(displayText); }
    }

    trackWrapper.addEventListener('pointerdown', function(e) {
      e.preventDefault();
      if (trackWrapper.setPointerCapture && typeof e.pointerId !== 'undefined') {
        try { trackWrapper.setPointerCapture(e.pointerId); } catch (err) { /* pointer capture is best-effort */ }
      }
      _isDragging = true;
      _updateFromPointer(e);
    });
    trackWrapper.addEventListener('pointermove', function(e) {
      if (!_isDragging) { return; }
      _updateFromPointer(e);
    });
    trackWrapper.addEventListener('pointerup', function() {
      _isDragging = false;
      if (SL.sliderOverlay) { SL.sliderOverlay.hide(); }
    });
    trackWrapper.addEventListener('pointercancel', function() {
      _isDragging = false;
      if (SL.sliderOverlay) { SL.sliderOverlay.hide(); }
    });

    return valueSpan;
  }

  // ============================================================
  // Build
  // ============================================================

  function _buildTanpuraController(container, opts) {
    var baseOctave = opts.baseOctave;
    var noteOn = opts.noteOn;
    var noteOff = opts.noteOff;

    // Stop any previous cycle
    _stopAll();

    _cachedNoteOn = noteOn;
    _cachedNoteOff = noteOff;
    _cachedBaseOctave = baseOctave;
    _stringLineEls = [];
    _stringColEls = [];
    _seqDotEls = [];
    _stringLabelEls = [];
    _stringSublabelEls = [];
    _mixBtnEls = [];
    _activeNoteTimers = {};
    _currentStringIdx = 0;
    _stringActive = [true, true, true, true];

    // Sync root from global topbar state
    if (SL.screenPlay && SL.screenPlay.getRootPc) {
      _rootPc = SL.screenPlay.getRootPc();
    }
    _stringMidis = _computeStringMidis(_rootPc, baseOctave, _tuningKey);

    var wrapper = document.createElement('div');
    wrapper.className = 'ssli-tanpura-wrapper';

    // ---------- Control bar ----------
    var controlBar = document.createElement('div');
    controlBar.className = 'ssli-tanpura-control-bar';

    // Root is now controlled by the global topbar (no local duplicate).

    var tuningLabel = document.createElement('span');
    tuningLabel.textContent = SL.t('tanpura.tuning_label');
    controlBar.appendChild(tuningLabel);

    var tuningSelect = document.createElement('select');
    var ti;
    for (ti = 0; ti < TUNING_PATTERN_KEYS.length; ti++) {
      var tOpt = document.createElement('option');
      tOpt.value = TUNING_PATTERN_KEYS[ti];
      tOpt.textContent = TUNING_PATTERNS[TUNING_PATTERN_KEYS[ti]].label;
      if (TUNING_PATTERN_KEYS[ti] === _tuningKey) { tOpt.selected = true; }
      tuningSelect.appendChild(tOpt);
    }
    tuningSelect.addEventListener('change', function() {
      _tuningKey = tuningSelect.value;
      _stringMidis = _computeStringMidis(_rootPc, _cachedBaseOctave, _tuningKey);
      _updateStringLabels();
      _stopAll();
      _startCycle();
    });
    controlBar.appendChild(tuningSelect);

    var spacer = document.createElement('div');
    spacer.className = 'ssli-tanpura-control-bar-spacer';
    controlBar.appendChild(spacer);

    var title = document.createElement('span');
    title.className = 'ssli-tanpura-control-bar-title';
    title.textContent = SL.t('tanpura.title');
    controlBar.appendChild(title);

    wrapper.appendChild(controlBar);

    // ---------- Body: strings + controls ----------
    var body = document.createElement('div');
    body.className = 'ssli-tanpura-body';

    // String area
    var stringArea = document.createElement('div');
    stringArea.className = 'ssli-tanpura-string-area';

    var frag = document.createDocumentFragment();
    var si;
    for (si = 0; si < STRING_COUNT; si++) {
      var col = document.createElement('div');
      col.className = 'ssli-tanpura-string-col';
      col.setAttribute('data-string-index', String(si));

      var pattern = TUNING_PATTERNS[_tuningKey];
      if (!pattern) { pattern = TUNING_PATTERNS['Pa-Sa-Sa-Sa']; }

      var sLabel = document.createElement('div');
      sLabel.className = 'ssli-tanpura-string-label';
      sLabel.textContent = _midiToNoteName(_stringMidis[si]);
      col.appendChild(sLabel);
      _stringLabelEls.push(sLabel);

      var sSublabel = document.createElement('div');
      sSublabel.className = 'ssli-tanpura-string-sublabel';
      sSublabel.textContent = _getSargamForInterval(pattern.intervals[si]);
      col.appendChild(sSublabel);
      _stringSublabelEls.push(sSublabel);

      var stringLine = document.createElement('div');
      stringLine.className = 'ssli-tanpura-string-line';
      col.appendChild(stringLine);
      _stringLineEls.push(stringLine);

      var seqDot = document.createElement('div');
      seqDot.className = 'ssli-tanpura-sequence-dot';
      if (si === 0) { seqDot.classList.add('next'); }
      col.appendChild(seqDot);
      _seqDotEls.push(seqDot);

      // Manual pluck on tap
      (function(capturedIdx) {
        col.addEventListener('click', function(ev) {
          ev.preventDefault();
          _pluckString(capturedIdx);
        });
      })(si);

      frag.appendChild(col);
      _stringColEls.push(col);
    }
    stringArea.appendChild(frag);

    body.appendChild(stringArea);

    // Controls panel
    var controls = document.createElement('div');
    controls.className = 'ssli-tanpura-controls';

    _tempoValueEl = _buildSlider(controls, 'Tempo', TEMPO_MIN_BPM, TEMPO_MAX_BPM, _tempo,
      function(v) { return Math.round(v) + ' BPM'; },
      function(v) {
        _tempo = Math.round(v);
        _stopCycle();
        _startCycle();
      }
    );

    _jawariValueEl = _buildSlider(controls, 'Jawari', JAWARI_MIN, JAWARI_MAX, _jawari,
      function(v) { return v.toFixed(2); },
      function(v) {
        _jawari = v;
        _applyJawari();
      }
    );

    _dampingValueEl = _buildSlider(controls, 'Damping', DAMPING_MIN, DAMPING_MAX, _damping,
      function(v) { return v.toFixed(2); },
      function(v) {
        _damping = v;
      }
    );

    // String mix toggles
    var mixDiv = document.createElement('div');
    mixDiv.className = 'ssli-tanpura-string-mix';

    var mixLabel = document.createElement('div');
    mixLabel.className = 'ssli-tanpura-string-mix-label';
    mixLabel.textContent = SL.t('tanpura.string_mix');
    mixDiv.appendChild(mixLabel);

    var mixRow = document.createElement('div');
    mixRow.className = 'ssli-tanpura-string-mix-row';

    var mi;
    for (mi = 0; mi < STRING_COUNT; mi++) {
      var mixBtn = document.createElement('button');
      mixBtn.className = 'ssli-tanpura-string-mix-btn active';
      mixBtn.textContent = String(mi + 1);
      mixBtn.setAttribute('data-mix-index', String(mi));

      (function(capturedIdx) {
        mixBtn.addEventListener('click', function(ev) {
          ev.preventDefault();
          _stringActive[capturedIdx] = !_stringActive[capturedIdx];
          if (_stringActive[capturedIdx]) {
            _mixBtnEls[capturedIdx].classList.add('active');
          } else {
            _mixBtnEls[capturedIdx].classList.remove('active');
          }
        });
      })(mi);

      mixRow.appendChild(mixBtn);
      _mixBtnEls.push(mixBtn);
    }

    mixDiv.appendChild(mixRow);
    controls.appendChild(mixDiv);

    body.appendChild(controls);
    wrapper.appendChild(body);
    container.appendChild(wrapper);

    // Start auto-cycle
    _startCycle();
  }

  // ============================================================
  // Register
  // ============================================================

  if (!SL.controllers) { SL.controllers = {}; }
  SL.controllers.tanpura = {
    build: function(container, opts) {
      _buildTanpuraController(container, opts);
    },
    release: _stopAll
  };

  // ============================================================
  // Panic hook
  // ============================================================

  if (SL.PanicRegistry && SL.PanicRegistry.register) {
    SL.PanicRegistry.register(
      'voices',
      'tanpura.cycle',
      function() { _stopAll(); },
      function() { return _cycleTimer ? 'cycle running' : null; }
    );
  }

})();
