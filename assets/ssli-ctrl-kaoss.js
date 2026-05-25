// SSLI Controller: Kaoss / Gesture Trail
// ES5 compatible (var, no arrow functions, no template literals)
//
// Behavior:
//   - 2D gesture surface with trail recording and playback.
//   - pointerdown: record XY trail at 60fps. pointerup: loop trail.
//   - PLAY animates playback head through trail. X = filter cutoff, Y = gain.
//   - Up to 4 independent layers with overdub support.
//   - Transport: REC, PLAY, CLEAR, OVERDUB + layer cycling.
//   - Footer: speed slider (0.25x-4.0x) + sync beat buttons.

(function() {
  'use strict';

  var SL = window.SynthLab;

  // ============================================================
  // Constants
  // ============================================================

  // Transport states
  var STATE_IDLE = 0;
  var STATE_RECORDING = 1;
  var STATE_PLAYING = 2;
  var STATE_OVERDUB = 3;

  // Layout dimensions
  var TRANSPORT_BAR_HEIGHT_PX = 32;
  var FOOTER_BAR_HEIGHT_PX = 28;
  var TRANSPORT_GAP_PX = 4;
  var FOOTER_GAP_PX = 4;

  // Transport button sizing
  var TRANSPORT_BTN_WIDTH_PX = 56;
  var TRANSPORT_BTN_HEIGHT_PX = 26;

  // Layer constants
  var MAX_LAYERS = 4;
  var LAYER_COLORS = ['#4cc9f0', '#f72585', '#7209b7', '#ffd60a'];
  var LAYER_LABELS = ['L1', 'L2', 'L3', 'L4'];

  // Trail recording
  var SAMPLE_INTERVAL_MS = 16; // ~60fps
  var TRAIL_MAX_POINTS = 600;  // cap trail length to prevent unbounded growth
  var TRAIL_DECAY_MS = 10000;  // prune points older than 10s during live recording
  var TRAIL_OPACITY_HEAD = 1.0;
  var TRAIL_OPACITY_TAIL = 0.3;
  var TRAIL_LINE_WIDTH_PX = 3;

  // Playback head
  var PLAYBACK_HEAD_RADIUS_PX = 10;
  var PLAYBACK_HEAD_COLOR = '#ffffff';
  var PLAYBACK_GLOW_COLOR = '#4cc9f0';
  var PLAYBACK_GLOW_BLUR_PX = 12;

  // Audio mapping (X = cutoff, Y = gain)
  var CUTOFF_MIN_HZ = 200;
  var CUTOFF_MAX_HZ = 12000;
  var LN_CUTOFF_MIN = Math.log(CUTOFF_MIN_HZ);
  var LN_CUTOFF_MAX = Math.log(CUTOFF_MAX_HZ);
  var GAIN_MIN = 0.08;
  var GAIN_MAX = 1.0;

  // Speed slider
  var SPEED_MIN = 0.25;
  var SPEED_MAX = 4.0;
  var SPEED_DEFAULT = 1.0;
  var SPEED_STEP = 0.25;

  // Sync beat options
  var SYNC_OPTIONS = ['Free', '1/4', '1/2', '1', '2', '4'];
  var SYNC_BTN_WIDTH_PX = 32;
  var SYNC_BTN_HEIGHT_PX = 22;

  // Phone transport sizing
  var PHONE_TRANSPORT_BTN_SIZE_PX = 32;
  var PHONE_SYNC_BTN_WIDTH_PX = 28;
  var PHONE_SYNC_BTN_HEIGHT_PX = 24;
  var PHONE_SPEED_SLIDER_WIDTH_PX = 80;

  // Canvas DPR
  var MIN_DPR = 1;

  // ============================================================
  // State
  // ============================================================

  var _state = STATE_IDLE;
  var _activeLayer = 0;
  var _layers = [];
  var _speed = SPEED_DEFAULT;
  var _syncMode = 0; // index into SYNC_OPTIONS (0 = Free)
  var _playbackHead = 0; // normalized position 0..1 through trail
  var _playbackAnimId = 0;
  var _recordAnimId = 0;
  var _recordStartMs = 0;
  var isPointerDown = false;

  // Cached DOM/canvas refs
  var _canvas = null;
  var _ctx = null;
  var _surfaceDiv = null;
  var _transportBtns = {};
  var _layerBtn = null;
  var _speedSlider = null;
  var _speedLabel = null;
  var _syncBtns = [];

  // Cached opts
  var _noteOn = null;
  var _noteOff = null;
  var _currentMidi = -1;
  var _baseOctave = 3;

  // ============================================================
  // Layer initialization
  // ============================================================

  function _makeLayer() {
    return { trail: [], hasData: false };
  }

  function _initLayers() {
    _layers = [];
    var i;
    for (i = 0; i < MAX_LAYERS; i++) {
      _layers.push(_makeLayer());
    }
  }

  _initLayers();

  // ============================================================
  // Helpers
  // ============================================================

  function _clamp(val, lo, hi) {
    if (val < lo) { return lo; }
    if (val > hi) { return hi; }
    return val;
  }

  function _getDpr() {
    var dpr = window.devicePixelRatio || MIN_DPR;
    if (dpr < MIN_DPR) { dpr = MIN_DPR; }
    return dpr;
  }

  function _resizeCanvas() {
    if (!_canvas || !_surfaceDiv) { return; }
    var rect = _surfaceDiv.getBoundingClientRect();
    var dpr = _getDpr();
    var w = Math.floor(rect.width);
    var h = Math.floor(rect.height);
    _canvas.width = w * dpr;
    _canvas.height = h * dpr;
    _canvas.style.width = w + 'px';
    _canvas.style.height = h + 'px';
    if (_ctx) {
      _ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  function _applyExpression(normX, normY) {
    var cutoffHz = Math.exp(LN_CUTOFF_MIN + normX * (LN_CUTOFF_MAX - LN_CUTOFF_MIN));
    var gain = GAIN_MIN + normY * (GAIN_MAX - GAIN_MIN);
    if (SL.audio && SL.audio.setExpression) {
      SL.audio.setExpression(cutoffHz, gain);
    }
  }

  function _clearExpression() {
    if (SL.audio && SL.audio.clearExpression) {
      SL.audio.clearExpression();
    }
  }

  function _getNormalizedCoords(e) {
    if (!_surfaceDiv) { return { x: 0, y: 0 }; }
    var rect = _surfaceDiv.getBoundingClientRect();
    var rawX = e.clientX - rect.left;
    var rawY = e.clientY - rect.top;
    var normX = _clamp(rawX / rect.width, 0, 1);
    var normY = _clamp(1 - (rawY / rect.height), 0, 1);
    return { x: normX, y: normY };
  }

  function _nowMs() {
    if (typeof performance !== 'undefined' && performance.now) {
      return performance.now();
    }
    return Date.now();
  }

  // ============================================================
  // Canvas rendering
  // ============================================================

  function _renderCanvas() {
    if (!_ctx || !_canvas) { return; }
    var dpr = _getDpr();
    var w = _canvas.width / dpr;
    var h = _canvas.height / dpr;

    // Clear entire canvas each frame to prevent ghost accumulation
    _ctx.clearRect(0, 0, w, h);

    // During live recording, prune trail points older than TRAIL_DECAY_MS
    var isRecording = (_state === STATE_RECORDING) || (_state === STATE_OVERDUB);
    if (isRecording) {
      var activeTrail = _layers[_activeLayer].trail;
      var nowElapsed = _nowMs() - _recordStartMs;
      while (activeTrail.length > 0 && (nowElapsed - activeTrail[0].t) > TRAIL_DECAY_MS) {
        activeTrail.shift();
      }
      if (activeTrail.length === 0) {
        _layers[_activeLayer].hasData = false;
      }
    }

    var li;
    for (li = 0; li < MAX_LAYERS; li++) {
      var layer = _layers[li];
      if (!layer.hasData) { continue; }
      var trail = layer.trail;
      var trailLen = trail.length;
      if (trailLen < 2) { continue; }

      var color = LAYER_COLORS[li];
      _ctx.lineWidth = TRAIL_LINE_WIDTH_PX;
      _ctx.lineCap = 'round';
      _ctx.lineJoin = 'round';

      var ti;
      for (ti = 1; ti < trailLen; ti++) {
        var prevPt = trail[ti - 1];
        var currPt = trail[ti];
        var progressFrac = ti / (trailLen - 1);
        var opacity = TRAIL_OPACITY_TAIL + progressFrac * (TRAIL_OPACITY_HEAD - TRAIL_OPACITY_TAIL);
        _ctx.strokeStyle = color;
        _ctx.globalAlpha = opacity;
        _ctx.beginPath();
        _ctx.moveTo(prevPt.x * w, (1 - prevPt.y) * h);
        _ctx.lineTo(currPt.x * w, (1 - currPt.y) * h);
        _ctx.stroke();
      }
    }

    _ctx.globalAlpha = 1.0;

    // Draw playback head if playing
    var isPlaying = (_state === STATE_PLAYING) || (_state === STATE_OVERDUB);
    if (isPlaying) {
      var playLayer = _layers[_activeLayer];
      var hasPlayTrail = playLayer.hasData && (playLayer.trail.length > 1);
      if (hasPlayTrail) {
        var playTrail = playLayer.trail;
        var idx = Math.floor(_playbackHead * (playTrail.length - 1));
        idx = _clamp(idx, 0, playTrail.length - 1);
        var pt = playTrail[idx];
        var px = pt.x * w;
        var py = (1 - pt.y) * h;

        _ctx.save();
        _ctx.shadowColor = PLAYBACK_GLOW_COLOR;
        _ctx.shadowBlur = PLAYBACK_GLOW_BLUR_PX;
        _ctx.fillStyle = PLAYBACK_HEAD_COLOR;
        _ctx.beginPath();
        _ctx.arc(px, py, PLAYBACK_HEAD_RADIUS_PX, 0, 2 * Math.PI);
        _ctx.fill();
        _ctx.restore();
      }
    }
  }

  // ============================================================
  // Recording
  // ============================================================

  function _startRecording() {
    var layer = _layers[_activeLayer];
    layer.trail = [];
    layer.hasData = false;
    _recordStartMs = _nowMs();
    isPointerDown = true;

    function sampleLoop() {
      if (!isPointerDown) { return; }
      _recordAnimId = requestAnimationFrame(sampleLoop);
    }
    _recordAnimId = requestAnimationFrame(sampleLoop);
  }

  function _addSample(normX, normY) {
    var layer = _layers[_activeLayer];
    var elapsed = _nowMs() - _recordStartMs;
    layer.trail.push({ x: normX, y: normY, t: elapsed });
    // Prune oldest points if trail exceeds max length
    if (layer.trail.length > TRAIL_MAX_POINTS) {
      layer.trail.shift();
    }
    layer.hasData = true;
    _applyExpression(normX, normY);
    _renderCanvas();
  }

  function _stopRecording() {
    isPointerDown = false;
    if (_recordAnimId) {
      cancelAnimationFrame(_recordAnimId);
      _recordAnimId = 0;
    }
    var layer = _layers[_activeLayer];
    var hasValidTrail = layer.hasData && (layer.trail.length >= 2);
    if (hasValidTrail) {
      _setState(STATE_PLAYING);
      _startPlayback();
    } else {
      _setState(STATE_IDLE);
    }
  }

  // ============================================================
  // Playback
  // ============================================================

  function _startPlayback() {
    var layer = _layers[_activeLayer];
    var hasTrail = layer.hasData && (layer.trail.length >= 2);
    if (!hasTrail) { return; }

    // Ensure a sustained note is playing during trail playback
    var needsNoteOn = (_currentMidi < 0);
    if (needsNoteOn && _noteOn) {
      var semitones = 12;
      _currentMidi = ((_baseOctave + 1) * semitones);
      _noteOn(_currentMidi);
    }

    _playbackHead = 0;
    var trail = layer.trail;
    var totalDuration = trail[trail.length - 1].t;
    if (totalDuration <= 0) { totalDuration = 1; }
    var startTime = _nowMs();

    function playLoop() {
      var isActive = (_state === STATE_PLAYING) || (_state === STATE_OVERDUB);
      if (!isActive) { return; }

      var elapsed = (_nowMs() - startTime) * _speed;
      var normalizedTime = (elapsed % totalDuration) / totalDuration;
      _playbackHead = normalizedTime;

      var idx = Math.floor(normalizedTime * (trail.length - 1));
      idx = _clamp(idx, 0, trail.length - 1);
      var pt = trail[idx];

      _applyExpression(pt.x, pt.y);
      _renderCanvas();

      _playbackAnimId = requestAnimationFrame(playLoop);
    }
    _playbackAnimId = requestAnimationFrame(playLoop);
  }

  function _stopPlayback() {
    if (_playbackAnimId) {
      cancelAnimationFrame(_playbackAnimId);
      _playbackAnimId = 0;
    }
    // Stop the sustained playback note
    if (_noteOff && _currentMidi >= 0) {
      _noteOff(_currentMidi);
      _currentMidi = -1;
    }
    _clearExpression();
    _playbackHead = 0;
    _renderCanvas();
  }

  // ============================================================
  // State machine
  // ============================================================

  function _setState(newState) {
    _state = newState;
    _updateTransportUI();
  }

  function _updateTransportUI() {
    if (_transportBtns.rec) {
      var recActive = (_state === STATE_RECORDING);
      _transportBtns.rec.className = 'kaoss-transport-btn' + (recActive ? ' kaoss-btn-active kaoss-btn-rec-active' : '');
    }
    if (_transportBtns.play) {
      var playActive = (_state === STATE_PLAYING);
      _transportBtns.play.className = 'kaoss-transport-btn' + (playActive ? ' kaoss-btn-active' : '');
    }
    if (_transportBtns.overdub) {
      var odActive = (_state === STATE_OVERDUB);
      _transportBtns.overdub.className = 'kaoss-transport-btn' + (odActive ? ' kaoss-btn-active kaoss-btn-od-active' : '');
    }
    if (_layerBtn) {
      _layerBtn.textContent = LAYER_LABELS[_activeLayer];
      _layerBtn.style.borderColor = LAYER_COLORS[_activeLayer];
      _layerBtn.style.color = LAYER_COLORS[_activeLayer];
    }
  }

  // ============================================================
  // Transport actions
  // ============================================================

  function _onRec() {
    if (_state === STATE_RECORDING) {
      _setState(STATE_IDLE);
    } else {
      _stopPlayback();
      _setState(STATE_RECORDING);
    }
  }

  function _onPlay() {
    if (_state === STATE_PLAYING) {
      _stopPlayback();
      _setState(STATE_IDLE);
    } else {
      _stopPlayback();
      var layer = _layers[_activeLayer];
      var hasTrail = layer.hasData && (layer.trail.length >= 2);
      if (hasTrail) {
        _setState(STATE_PLAYING);
        _startPlayback();
      }
    }
  }

  function _onClear() {
    _stopPlayback();
    _layers[_activeLayer].trail = [];
    _layers[_activeLayer].hasData = false;
    _setState(STATE_IDLE);
    _clearExpression();
    _renderCanvas();
  }

  function _onOverdub() {
    if (_state === STATE_OVERDUB) {
      _setState(STATE_PLAYING);
    } else {
      var nextLayer = -1;
      var li;
      for (li = 0; li < MAX_LAYERS; li++) {
        var candidateIdx = (_activeLayer + 1 + li) % MAX_LAYERS;
        if (!_layers[candidateIdx].hasData) {
          nextLayer = candidateIdx;
          break;
        }
      }
      if (nextLayer >= 0) {
        _activeLayer = nextLayer;
        _setState(STATE_OVERDUB);
        _updateTransportUI();
      }
    }
  }

  function _onLayerCycle() {
    _stopPlayback();
    _activeLayer = (_activeLayer + 1) % MAX_LAYERS;
    _setState(STATE_IDLE);
    _renderCanvas();
  }

  // ============================================================
  // Pointer handlers on surface
  // ============================================================

  function _onSurfacePointerDown(e) {
    e.preventDefault();
    var hasSurface = _surfaceDiv && _surfaceDiv.setPointerCapture;
    var canCapturePointer = hasSurface && typeof e.pointerId !== 'undefined';
    if (canCapturePointer) {
      try { _surfaceDiv.setPointerCapture(e.pointerId); } catch (err) { /* pointer capture is best-effort */ }
    }

    var isIdleState = (_state === STATE_IDLE);
    if (isIdleState) {
      _setState(STATE_RECORDING);
    }

    var isRecordState = (_state === STATE_RECORDING) || (_state === STATE_OVERDUB);
    if (isRecordState) {
      _startRecording();
      var coords = _getNormalizedCoords(e);
      _addSample(coords.x, coords.y);

      // Trigger note on
      if (_noteOn) {
        var semitones = 12;
        _currentMidi = ((_baseOctave + 1) * semitones);
        _noteOn(_currentMidi);
      }
    }
  }

  function _onSurfacePointerMove(e) {
    if (!isPointerDown) { return; }
    var coords = _getNormalizedCoords(e);
    _addSample(coords.x, coords.y);
  }

  function _onSurfacePointerUp() {
    if (!isPointerDown) { return; }
    _stopRecording();
    // Only kill the note if we did NOT transition to playback.
    // _startPlayback (called from _stopRecording) now owns the note
    // lifecycle during playback and will noteOff when playback stops.
    var isNowPlaying = (_state === STATE_PLAYING) || (_state === STATE_OVERDUB);
    var hasActiveKaossNote = _noteOff && _currentMidi >= 0;
    var shouldReleaseKaossNote = !isNowPlaying && hasActiveKaossNote;
    if (shouldReleaseKaossNote) {
      _noteOff(_currentMidi);
      _currentMidi = -1;
    }
  }

  // Document-level safety net
  function _documentPointerUp() {
    if (isPointerDown) {
      _onSurfacePointerUp();
    }
  }
  document.addEventListener('pointerup', _documentPointerUp);
  document.addEventListener('pointercancel', _documentPointerUp);

  // ============================================================
  // Build
  // ============================================================

  function _buildKaossController(container, opts) {
    _baseOctave = opts.baseOctave;
    _noteOn = opts.noteOn;
    _noteOff = opts.noteOff;

    _initLayers();
    _state = STATE_IDLE;
    _speed = SPEED_DEFAULT;
    _activeLayer = 0;
    _syncMode = 0;
    _playbackHead = 0;
    isPointerDown = false;

    var wrapper = document.createElement('div');
    wrapper.className = 'kaoss-wrapper';

    // ---------- Transport bar ----------
    var transportBar = document.createElement('div');
    transportBar.className = 'kaoss-transport-bar';

    var btnRec = document.createElement('button');
    btnRec.type = 'button';
    btnRec.className = 'kaoss-transport-btn';
    btnRec.textContent = SL.t('kaoss.btn_rec');
    btnRec.addEventListener('click', function(ev) { ev.preventDefault(); _onRec(); });
    _transportBtns.rec = btnRec;
    transportBar.appendChild(btnRec);

    var btnPlay = document.createElement('button');
    btnPlay.type = 'button';
    btnPlay.className = 'kaoss-transport-btn';
    btnPlay.textContent = SL.t('kaoss.btn_play');
    btnPlay.addEventListener('click', function(ev) { ev.preventDefault(); _onPlay(); });
    _transportBtns.play = btnPlay;
    transportBar.appendChild(btnPlay);

    var btnClear = document.createElement('button');
    btnClear.type = 'button';
    btnClear.className = 'kaoss-transport-btn';
    btnClear.textContent = SL.t('kaoss.btn_clear');
    btnClear.addEventListener('click', function(ev) { ev.preventDefault(); _onClear(); });
    _transportBtns.clear = btnClear;
    transportBar.appendChild(btnClear);

    var btnOverdub = document.createElement('button');
    btnOverdub.type = 'button';
    btnOverdub.className = 'kaoss-transport-btn';
    btnOverdub.textContent = SL.t('kaoss.btn_overdub');
    btnOverdub.addEventListener('click', function(ev) { ev.preventDefault(); _onOverdub(); });
    _transportBtns.overdub = btnOverdub;
    transportBar.appendChild(btnOverdub);

    var layerSpacer = document.createElement('div');
    layerSpacer.className = 'kaoss-transport-spacer';
    transportBar.appendChild(layerSpacer);

    var layerButton = document.createElement('button');
    layerButton.type = 'button';
    layerButton.className = 'kaoss-layer-btn';
    layerButton.textContent = LAYER_LABELS[_activeLayer];
    layerButton.style.borderColor = LAYER_COLORS[_activeLayer];
    layerButton.style.color = LAYER_COLORS[_activeLayer];
    layerButton.addEventListener('click', function(ev) { ev.preventDefault(); _onLayerCycle(); });
    _layerBtn = layerButton;
    transportBar.appendChild(layerButton);

    wrapper.appendChild(transportBar);

    // ---------- Gesture surface ----------
    var surfaceContainer = document.createElement('div');
    surfaceContainer.className = 'kaoss-surface-container';

    var surface = document.createElement('div');
    surface.className = 'kaoss-surface';
    surface.style.touchAction = 'none';

    var canvas = document.createElement('canvas');
    canvas.className = 'kaoss-canvas';
    surface.appendChild(canvas);

    _canvas = canvas;
    _ctx = canvas.getContext('2d');
    _surfaceDiv = surface;

    surface.addEventListener('pointerdown', _onSurfacePointerDown);
    surface.addEventListener('pointermove', _onSurfacePointerMove);
    surface.addEventListener('pointerup', _onSurfacePointerUp);
    surface.addEventListener('pointercancel', function() {
      if (isPointerDown) { _onSurfacePointerUp(); }
    });

    // ---------- Axis labels ----------
    var labelX = document.createElement('span');
    labelX.className = 'kaoss-axis-label kaoss-axis-label-x';
    labelX.textContent = SL.t('kaoss.label_filter_arrow');
    labelX.style.position = 'absolute';
    labelX.style.bottom = '4px';
    labelX.style.left = '50%';
    labelX.style.transform = 'translateX(-50%)';
    labelX.style.opacity = '0.4';
    labelX.style.fontSize = '10px';
    labelX.style.pointerEvents = 'none';
    labelX.style.color = '#ccc';
    surface.appendChild(labelX);

    var labelY = document.createElement('span');
    labelY.className = 'kaoss-axis-label kaoss-axis-label-y';
    labelY.textContent = SL.t('kaoss.label_gain_arrow');
    labelY.style.position = 'absolute';
    labelY.style.top = '50%';
    labelY.style.left = '4px';
    labelY.style.transform = 'translateY(-50%) rotate(-90deg)';
    labelY.style.transformOrigin = 'center center';
    labelY.style.opacity = '0.4';
    labelY.style.fontSize = '10px';
    labelY.style.pointerEvents = 'none';
    labelY.style.color = '#ccc';
    surface.appendChild(labelY);

    surfaceContainer.appendChild(surface);
    wrapper.appendChild(surfaceContainer);

    // ---------- Footer bar ----------
    var footerBar = document.createElement('div');
    footerBar.className = 'kaoss-footer-bar';

    var speedGroup = document.createElement('div');
    speedGroup.className = 'kaoss-speed-group';

    var speedLbl = document.createElement('span');
    speedLbl.className = 'kaoss-speed-label';
    speedLbl.textContent = SPEED_DEFAULT.toFixed(2) + 'x';
    _speedLabel = speedLbl;

    var speedInput = document.createElement('input');
    speedInput.type = 'range';
    speedInput.className = 'kaoss-speed-slider';
    speedInput.min = String(SPEED_MIN);
    speedInput.max = String(SPEED_MAX);
    speedInput.step = String(SPEED_STEP);
    speedInput.value = String(SPEED_DEFAULT);
    _speedSlider = speedInput;

    speedInput.addEventListener('input', function() {
      _speed = parseFloat(speedInput.value) || SPEED_DEFAULT;
      speedLbl.textContent = _speed.toFixed(2) + 'x';
      if (SL.sliderOverlay) { SL.sliderOverlay.show(_speed.toFixed(2) + 'x'); }
    });
    speedInput.addEventListener('pointerup', function() {
      if (SL.sliderOverlay) { SL.sliderOverlay.hide(); }
    });
    speedInput.addEventListener('touchend', function() {
      if (SL.sliderOverlay) { SL.sliderOverlay.hide(); }
    });

    speedGroup.appendChild(speedLbl);
    speedGroup.appendChild(speedInput);
    footerBar.appendChild(speedGroup);

    var syncGroup = document.createElement('div');
    syncGroup.className = 'kaoss-sync-group';

    var si;
    for (si = 0; si < SYNC_OPTIONS.length; si++) {
      var syncBtn = document.createElement('button');
      syncBtn.type = 'button';
      syncBtn.className = 'kaoss-sync-btn' + (si === _syncMode ? ' kaoss-sync-active' : '');
      syncBtn.textContent = (si === 0) ? SL.t('kaoss.sync_free') : SYNC_OPTIONS[si];
      syncBtn.setAttribute('data-sync-idx', String(si));
      (function(capturedIdx) {
        syncBtn.addEventListener('click', function(ev) {
          ev.preventDefault();
          _syncMode = capturedIdx;
          _updateSyncUI();
        });
      })(si);
      syncGroup.appendChild(syncBtn);
      _syncBtns.push(syncBtn);
    }

    footerBar.appendChild(syncGroup);
    wrapper.appendChild(footerBar);

    container.appendChild(wrapper);

    // Initial canvas sizing
    requestAnimationFrame(function() {
      _resizeCanvas();
      _renderCanvas();
    });

    // Resize observer for canvas
    if (typeof ResizeObserver !== 'undefined') {
      var ro = new ResizeObserver(function() {
        _resizeCanvas();
        _renderCanvas();
      });
      ro.observe(surface);
    }

    _updateTransportUI();
  }

  function _updateSyncUI() {
    var bi;
    for (bi = 0; bi < _syncBtns.length; bi++) {
      var isActive = (bi === _syncMode);
      _syncBtns[bi].className = 'kaoss-sync-btn' + (isActive ? ' kaoss-sync-active' : '');
    }
  }

  // ============================================================
  // Release / cleanup
  // ============================================================

  function _releaseKaoss() {
    _stopPlayback();
    if (isPointerDown) {
      isPointerDown = false;
      if (_recordAnimId) {
        cancelAnimationFrame(_recordAnimId);
        _recordAnimId = 0;
      }
    }
    if (_noteOff && _currentMidi >= 0) {
      _noteOff(_currentMidi);
      _currentMidi = -1;
    }
    _clearExpression();
    _setState(STATE_IDLE);
    _initLayers();
    _canvas = null;
    _ctx = null;
    _surfaceDiv = null;
    _transportBtns = {};
    _layerBtn = null;
    _speedSlider = null;
    _speedLabel = null;
    _syncBtns = [];
  }

  // ============================================================
  // Register
  // ============================================================

  if (!SL.controllers) { SL.controllers = {}; }
  SL.controllers.kaoss = {
    build: _buildKaossController,
    release: _releaseKaoss
  };

  // ============================================================
  // Panic hook
  // ============================================================

  if (SL.PanicRegistry && SL.PanicRegistry.register) {
    SL.PanicRegistry.register(
      'voices',
      'kaoss.trail',
      function() { _releaseKaoss(); },
      function() {
        var hasActivity = (_state !== STATE_IDLE) || isPointerDown;
        return hasActivity ? 'gesture active' : null;
      }
    );
  }

})();
