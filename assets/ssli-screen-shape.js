// SSLI Screen: Shape — ADSR & Filter controls
// ES5 compatible (var, no arrow functions, no template literals)

(function() {
  'use strict';

  var SL = window.SynthLab;

  // ============================================================
  // Constants
  // ============================================================

  var ADSR_MIN_MS = 0;
  // Max 1 s on Attack/Decay/Release. Prior 10 s range made dialling in the
  // musically useful 5-300 ms band practically impossible — most of the
  // slider travel sat in "pad swell" territory nobody uses.
  var ADSR_MAX_MS = 1000;
  var SUSTAIN_MIN = 0;
  var SUSTAIN_MAX = 100;
  var FILTER_CUTOFF_MIN = SL.FILTER_CUTOFF_MIN;
  var FILTER_CUTOFF_MAX = SL.FILTER_CUTOFF_MAX;
  var FILTER_RESO_MIN = SL.FILTER_RESO_MIN;
  var FILTER_RESO_MAX = SL.FILTER_RESO_MAX;
  var KEY_TRACK_MIN = 0;
  var KEY_TRACK_MAX = 100;
  var FILTER_ENV_AMOUNT_MIN = -100;
  var FILTER_ENV_AMOUNT_MAX = 100;
  var MS_TO_S_THRESHOLD = SL.HZ_TO_KHZ_THRESHOLD;
  var GLIDE_MIN_MS = 0;
  var GLIDE_MAX_MS = 2000;

  var ADSR_MODE_SINGLE = 'single';
  var ADSR_MODE_DUAL = 'dual';

  var ADSR_CANVAS_HEIGHT = 28;
  var ADSR_CURVE_PADDING = 4;
  var ADSR_SUSTAIN_WIDTH_RATIO = 0.2;  // fraction of width for sustain hold
  var ADSR_LINE_WIDTH = 2;
  var ADSR_FILL_ALPHA = 0.15;
  var ADSR_STROKE_COLOR = '#4cc9f0';
  var ADSR_FILL_COLOR = 'rgba(76, 201, 240, 0.15)';
  var ADSR_BG_COLOR = '#0a0a18';
  var ADSR_GRID_COLOR = 'rgba(255,255,255,0.06)';

  var FILTER_TYPES = [
    { val: 'lowpass',   label: 'LP12',  slope: 12 },
    { val: 'lowpass',   label: 'LP24',  slope: 24 },
    { val: 'highpass',  label: 'HP12',  slope: 12 },
    { val: 'highpass',  label: 'HP24',  slope: 24 },
    { val: 'bandpass',  label: 'BP12',  slope: 12 },
    { val: 'notch',     label: 'Notch', slope: 12 }
  ];

  var FILTER_MODELS = [
    { val: 'butterworth', label: 'Butterworth' },
    { val: 'moog',        label: 'Ladder 4-Pole' },
    { val: 'svf',         label: 'SVF' },
    { val: 'ms20',        label: 'Sallen-Key' },
    { val: 'oberheim',    label: 'SEM 2-Pole' },
    { val: 'tb303',       label: 'Acid' },
    { val: 'prophet',     label: 'Poly-5' },
    { val: 'korg35',      label: 'Diode Ladder' },
    { val: 'arp2600',     label: 'Multi-Mode' },
    { val: 'steiner',     label: 'Steiner-Parker' }
  ];

  var DEFAULT_FILTER_MODEL = 'butterworth';

  var _FM_KEY = {
    'butterworth': 'butterworth', 'moog': 'ladder_4_pole', 'svf': 'svf',
    'ms20': 'sallen_key', 'oberheim': 'sem_2_pole', 'tb303': 'acid',
    'prophet': 'poly_5', 'korg35': 'diode_ladder', 'arp2600': 'multi_mode',
    'steiner': 'steiner_parker'
  };

  // Plain-English tooltips for every interactive control. One hand, one voice.
  var TIP_ATTACK_AMP = 'How fast the note fades in. Short = punchy, long = swelling.';
  var TIP_DECAY_AMP = 'How fast it settles to the hold level after the initial peak.';
  var TIP_SUSTAIN_AMP = 'How loud the note holds while the key is down.';
  var TIP_RELEASE_AMP = 'How long the note fades after key-off. Long = trailing tails.';
  var TIP_ATTACK_FILT = 'How fast the filter opens when a note starts.';
  var TIP_DECAY_FILT = 'How fast the filter settles after its initial sweep.';
  var TIP_SUSTAIN_FILT = 'How far the filter holds open while the key is down.';
  var TIP_RELEASE_FILT = 'How long the filter takes to close after key-off.';
  var TIP_CUTOFF = 'Filter brightness. Low = dark/muffled, high = bright/open.';
  var TIP_RESONANCE = 'Emphasis at the cutoff frequency. Too much whistles.';
  var TIP_KEY_TRACK = 'How much higher notes open the filter. Keeps tone even across keys.';
  var TIP_FILTER_TYPE = 'Filter shape: low-pass tames highs, high-pass thins lows, etc.';
  var TIP_FILTER_MODEL = 'Filter flavour. Models colour resonance and saturation differently.';
  var TIP_FILTER_ENABLE = 'Turn the filter on or off entirely.';
  var TIP_ENV_AMOUNT = 'How far the filter envelope sweeps the cutoff, up or down.';
  var TIP_PORTAMENTO = 'Glide time between notes. Zero = instant, long = slurred pitch.';
  var TIP_ADSR_MODE = 'Single: one envelope shapes both volume and filter together.';
  var TIP_ADSR_SINGLE = 'One shared envelope for loudness and filter — simpler, punchier.';
  var TIP_ADSR_DUAL = 'Separate envelopes for loudness vs filter — classic synth sweep.';
  var TIP_TAB_AMP = 'Edit the amplitude (loudness) envelope.';
  var TIP_TAB_FILT = 'Edit the filter envelope that sweeps brightness over time.';

  // ============================================================
  // State
  // ============================================================

  var _initialized = false;
  var _active = false;
  var _selfNotifying = false;  // guard: prevent rebuild loop when our own sliders fire state.notify
  var _screenEl = null;
  var _adsrMode = ADSR_MODE_SINGLE;

  // DOM caches
  var _ampAdsrSection = null;
  var _filterAdsrSection = null;
  var _filterEnvAmountRow = null;
  var _adsrModeToggle = null;
  var _dualAdsrTab = 'amp';  // 'amp' or 'filter' — which tab is active in dual mode
  var _dualTabAmpBtn = null;
  var _dualTabFilterBtn = null;

  // ADSR curve canvas elements
  var _ampAdsrCanvas = null;
  var _filterAdsrCanvas = null;

  // ============================================================
  // Helpers
  // ============================================================

  function _formatMs(ms) {
    if (ms >= MS_TO_S_THRESHOLD) {
      return (ms / MS_TO_S_THRESHOLD).toFixed(1) + 's';
    }
    return Math.round(ms) + 'ms';
  }

  // Logarithmic slider conversion for filter cutoff
  var LOG_CUTOFF_MIN = Math.log10(FILTER_CUTOFF_MIN);  // log10(20) ≈ 1.301
  var LOG_CUTOFF_MAX = Math.log10(FILTER_CUTOFF_MAX);  // log10(20000) ≈ 4.301
  var LOG_CUTOFF_RANGE = LOG_CUTOFF_MAX - LOG_CUTOFF_MIN;
  var CUTOFF_SLIDER_MAX = 1000;

  function _sliderToFreq(sliderVal) {
    var logFreq = LOG_CUTOFF_MIN + (sliderVal / CUTOFF_SLIDER_MAX) * LOG_CUTOFF_RANGE;
    return Math.pow(10, logFreq);
  }

  function _freqToSlider(freq) {
    var clamped = Math.max(FILTER_CUTOFF_MIN, Math.min(FILTER_CUTOFF_MAX, freq));
    var logFreq = Math.log10(clamped);
    return Math.round(((logFreq - LOG_CUTOFF_MIN) / LOG_CUTOFF_RANGE) * CUTOFF_SLIDER_MAX);
  }

  // Convert frequency to nearest note name
  var A4_FREQ = 440;
  var A4_MIDI = 69;
  var SEMITONES_PER_OCTAVE = 12;
  var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  function _freqToNote(freq) {
    if (freq <= 0) { return ''; }
    var midi = Math.round(A4_MIDI + SEMITONES_PER_OCTAVE * Math.log2(freq / A4_FREQ));
    if (midi < 0 || midi > 127) { return ''; }
    var pc = midi % SEMITONES_PER_OCTAVE;
    var oct = Math.floor(midi / SEMITONES_PER_OCTAVE) - 1;
    return NOTE_NAMES[pc] + oct;
  }

  function _formatHz(hz) {
    var note = _freqToNote(hz);
    var freqStr;
    if (hz >= MS_TO_S_THRESHOLD) {
      freqStr = (hz / MS_TO_S_THRESHOLD).toFixed(1) + 'kHz';
    } else {
      freqStr = Math.round(hz) + 'Hz';
    }
    if (note) {
      return freqStr + ' (' + note + ')';
    }
    return freqStr;
  }

  function _getSettings() {
    if (SL.audio && SL.audio.getInstruments) {
      var insts = SL.audio.getInstruments();
      var idx = SL.audio.getCurrentInstrument();
      if (insts && insts[idx]) {
        return insts[idx].settings;
      }
    }
    return null;
  }

  function _notifyChange() {
    _selfNotifying = true;
    if (SL.state && SL.state.notify) {
      SL.state.notify('shape');
    }
    _selfNotifying = false;
    _refreshAdsrCurves();
  }

  // ============================================================
  // ADSR Curve Visualization (A-03)
  // ============================================================

  /**
   * Draw an ADSR envelope curve on a canvas.
   * @param {HTMLCanvasElement} canvas - Target canvas
   * @param {Object} adsr - { a, d, s, r } in ms (s is 0-100 %)
   * @param {string} strokeColor - Line color
   */
  function _drawAdsrCurve(canvas, adsr, strokeColor) {
    if (!canvas) {
      return;
    }
    var ctx = canvas.getContext('2d');
    var w = canvas.width;
    var h = canvas.height;
    var pad = ADSR_CURVE_PADDING;
    var drawW = w - (pad * 2);
    var drawH = h - (pad * 2);

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = ADSR_BG_COLOR;
    ctx.fillRect(0, 0, w, h);

    // Grid lines (horizontal)
    ctx.strokeStyle = ADSR_GRID_COLOR;
    ctx.lineWidth = 1;
    var gridSteps = 4;
    for (var gi = 1; gi < gridSteps; gi++) {
      var gy = pad + (drawH * gi / gridSteps);
      ctx.beginPath();
      ctx.moveTo(pad, gy);
      ctx.lineTo(w - pad, gy);
      ctx.stroke();
    }

    // Compute segment widths proportional to time
    var totalTime = adsr.a + adsr.d + adsr.r;
    var sustainW = drawW * ADSR_SUSTAIN_WIDTH_RATIO;
    var envelopeW = drawW - sustainW;
    var attackW, decayW, releaseW;
    if (totalTime > 0) {
      attackW = (adsr.a / totalTime) * envelopeW;
      decayW = (adsr.d / totalTime) * envelopeW;
      releaseW = (adsr.r / totalTime) * envelopeW;
    } else {
      attackW = envelopeW / 3;
      decayW = envelopeW / 3;
      releaseW = envelopeW / 3;
    }

    var sustainLevel = 1.0 - (adsr.s / 100);  // invert for canvas Y

    // Build path points
    var x0 = pad;
    var yBottom = pad + drawH;
    var yTop = pad;
    var x1 = x0 + attackW;               // end of attack (peak)
    var x2 = x1 + decayW;               // end of decay (sustain level)
    var x3 = x2 + sustainW;             // end of sustain hold
    var x4 = x3 + releaseW;             // end of release (zero)

    var ySustain = yTop + (drawH * sustainLevel);

    // Draw filled area
    ctx.beginPath();
    ctx.moveTo(x0, yBottom);
    ctx.lineTo(x1, yTop);          // Attack: rise to peak
    ctx.lineTo(x2, ySustain);      // Decay: fall to sustain
    ctx.lineTo(x3, ySustain);      // Sustain: hold
    ctx.lineTo(x4, yBottom);       // Release: fall to zero
    ctx.closePath();
    ctx.fillStyle = ADSR_FILL_COLOR;
    ctx.fill();

    // Draw stroke
    ctx.beginPath();
    ctx.moveTo(x0, yBottom);
    ctx.lineTo(x1, yTop);
    ctx.lineTo(x2, ySustain);
    ctx.lineTo(x3, ySustain);
    ctx.lineTo(x4, yBottom);
    ctx.strokeStyle = strokeColor || ADSR_STROKE_COLOR;
    ctx.lineWidth = ADSR_LINE_WIDTH;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  /**
   * Redraw all visible ADSR canvases with current settings.
   */
  function _refreshAdsrCurves() {
    var settings = _getSettings();
    if (!settings) {
      return;
    }
    if (_ampAdsrCanvas) {
      _syncCanvasWidth(_ampAdsrCanvas);
      _drawAdsrCurve(_ampAdsrCanvas, settings.adsr, ADSR_STROKE_COLOR);
    }
    if (_filterAdsrCanvas && _adsrMode === ADSR_MODE_DUAL) {
      _syncCanvasWidth(_filterAdsrCanvas);
      _drawAdsrCurve(_filterAdsrCanvas, settings.filterEnv, '#f77f00');
    }
  }

  /**
   * Create a canvas element for ADSR visualization.
   * @returns {HTMLCanvasElement}
   */
  function _createAdsrCanvas() {
    var canvas = document.createElement('canvas');
    canvas.height = ADSR_CANVAS_HEIGHT;
    canvas.className = 'ssli-adsr-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.width = '100%';
    return canvas;
  }

  function _syncCanvasWidth(canvas) {
    if (!canvas) {
      return;
    }
    var displayWidth = canvas.clientWidth;
    if (displayWidth > 0 && canvas.width !== displayWidth) {
      canvas.width = displayWidth;
    }
  }

  // ============================================================
  // Slider Builder
  // ============================================================

  function _createSliderRow(label, min, max, value, step, formatter, onChange, tooltip) {
    var row = document.createElement('div');
    row.className = 'ssli-shape-row';

    var lbl = document.createElement('span');
    lbl.className = 'ssli-shape-label';
    lbl.textContent = label;

    var slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'ssli-shape-slider';
    slider.min = String(min);
    slider.max = String(max);
    slider.value = String(value);
    /* U-01: ARIA label for screen readers */
    slider.setAttribute('aria-label', label);
    /* Plain-English tooltip explaining audible effect. Falls back to label. */
    var tipText = tooltip ? tooltip : label;
    slider.title = tipText;
    lbl.title = tipText;
    row.title = tipText;
    if (step) {
      slider.step = String(step);
    }

    var valSpan = document.createElement('span');
    valSpan.className = 'ssli-shape-val';
    valSpan.textContent = formatter(value);

    slider.addEventListener('input', function() {
      var v = parseFloat(slider.value);
      valSpan.textContent = formatter(v);
      onChange(v);
    });

    row.appendChild(lbl);
    row.appendChild(slider);
    row.appendChild(valSpan);

    return { row: row, slider: slider, valSpan: valSpan };
  }

  // ============================================================
  // Build ADSR Section
  // ============================================================

  function _buildAdsrSection(titleText, settingsKey, isFilterEnv) {
    var section = document.createElement('div');
    section.className = 'ssli-shape-section';

    var title = document.createElement('div');
    title.className = 'ssli-shape-section-title';
    title.textContent = titleText;
    section.appendChild(title);

    var settings = _getSettings();
    var adsr;
    if (isFilterEnv) {
      adsr = settings ? settings.filterEnv : { a: 200, d: 600, s: 0, r: 775 };
    } else {
      adsr = settings ? settings.adsr : { a: 10, d: 100, s: 70, r: 200 };
    }

    // 2x2 grid container for compact layout
    var grid = document.createElement('div');
    grid.className = 'ssli-shape-adsr-grid';

    var attackRow = _createSliderRow(SL.t('shape_screen.attack'), ADSR_MIN_MS, ADSR_MAX_MS, adsr.a, 1, _formatMs, function(v) {
      var s = _getSettings();
      if (s) {
        if (isFilterEnv) {
          s.filterEnv.a = v;
        } else {
          s.adsr.a = v;
          if (_adsrMode === ADSR_MODE_SINGLE && s.filterEnv && s.filterEnv.link) {
            s.filterEnv.a = v;
          }
        }
        _notifyChange();
      }
    }, isFilterEnv ? TIP_ATTACK_FILT : TIP_ATTACK_AMP);
    grid.appendChild(attackRow.row);

    var decayRow = _createSliderRow(SL.t('shape_screen.decay'), ADSR_MIN_MS, ADSR_MAX_MS, adsr.d, 1, _formatMs, function(v) {
      var s = _getSettings();
      if (s) {
        if (isFilterEnv) {
          s.filterEnv.d = v;
        } else {
          s.adsr.d = v;
          if (_adsrMode === ADSR_MODE_SINGLE && s.filterEnv && s.filterEnv.link) {
            s.filterEnv.d = v;
          }
        }
        _notifyChange();
      }
    }, isFilterEnv ? TIP_DECAY_FILT : TIP_DECAY_AMP);
    grid.appendChild(decayRow.row);

    var sustainRow = _createSliderRow(SL.t('shape_screen.sustain'), SUSTAIN_MIN, SUSTAIN_MAX, adsr.s, 1, function(v) {
      return Math.round(v) + '%';
    }, function(v) {
      var s = _getSettings();
      if (s) {
        if (isFilterEnv) {
          s.filterEnv.s = v;
        } else {
          s.adsr.s = v;
          if (_adsrMode === ADSR_MODE_SINGLE && s.filterEnv && s.filterEnv.link) {
            s.filterEnv.s = v;
          }
        }
        _notifyChange();
      }
    }, isFilterEnv ? TIP_SUSTAIN_FILT : TIP_SUSTAIN_AMP);
    grid.appendChild(sustainRow.row);

    var releaseRow = _createSliderRow(SL.t('shape_screen.release'), ADSR_MIN_MS, ADSR_MAX_MS, adsr.r, 1, _formatMs, function(v) {
      var s = _getSettings();
      if (s) {
        if (isFilterEnv) {
          s.filterEnv.r = v;
        } else {
          s.adsr.r = v;
          if (_adsrMode === ADSR_MODE_SINGLE && s.filterEnv && s.filterEnv.link) {
            s.filterEnv.r = v;
          }
        }
        _notifyChange();
      }
    }, isFilterEnv ? TIP_RELEASE_FILT : TIP_RELEASE_AMP);
    grid.appendChild(releaseRow.row);

    section.appendChild(grid);

    // ADSR curve visualization canvas
    var canvas = _createAdsrCanvas();
    if (isFilterEnv) {
      _filterAdsrCanvas = canvas;
    } else {
      _ampAdsrCanvas = canvas;
    }
    section.appendChild(canvas);

    return section;
  }

  // ============================================================
  // Build Filter Section
  // ============================================================

  function _buildFilterSection() {
    var section = document.createElement('div');
    section.className = 'ssli-shape-section';

    var title = document.createElement('div');
    title.className = 'ssli-shape-section-title';
    title.textContent = SL.t('ui.label.filter');
    section.appendChild(title);

    var settings = _getSettings();
    var filter = settings ? settings.filter : { enabled: true, type: 'lowpass', freq: 850, q: 10, keyTrack: 0, slope: 24, model: DEFAULT_FILTER_MODEL };

    // Top row: Enable checkbox + Type dropdown inline
    var topRow = document.createElement('div');
    topRow.className = 'ssli-shape-filter-top-row';

    var enableCb = document.createElement('input');
    enableCb.type = 'checkbox';
    enableCb.className = 'ssli-shape-checkbox';
    enableCb.checked = filter.enabled;
    enableCb.setAttribute('aria-label', 'Enable Filter');
    enableCb.title = TIP_FILTER_ENABLE;
    enableCb.addEventListener('change', function() {
      var s = _getSettings();
      if (s) {
        s.filter.enabled = enableCb.checked;
        _notifyChange();
      }
    });
    topRow.appendChild(enableCb);

    var typeSelect = document.createElement('select');
    typeSelect.className = 'ssli-sound-select ssli-shape-filter-type-select';
    typeSelect.setAttribute('aria-label', 'Filter Type');
    typeSelect.title = TIP_FILTER_TYPE;
    for (var i = 0; i < FILTER_TYPES.length; i++) {
      var opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = SL.t('filter_type.' + FILTER_TYPES[i].label.toLowerCase(), FILTER_TYPES[i].label);
      typeSelect.appendChild(opt);
    }
    var currentTypeIdx = 0;
    for (var t = 0; t < FILTER_TYPES.length; t++) {
      if (FILTER_TYPES[t].val === filter.type && FILTER_TYPES[t].slope === (filter.slope || 24)) {
        currentTypeIdx = t;
        break;
      }
    }
    typeSelect.value = String(currentTypeIdx);
    typeSelect.addEventListener('change', function() {
      var s = _getSettings();
      if (s) {
        var idx = parseInt(typeSelect.value, 10);
        s.filter.type = FILTER_TYPES[idx].val;
        s.filter.slope = FILTER_TYPES[idx].slope;
        _notifyChange();
      }
    });
    topRow.appendChild(typeSelect);

    // Model dropdown
    var modelSelect = document.createElement('select');
    modelSelect.className = 'ssli-sound-select ssli-shape-filter-model-select';
    modelSelect.title = TIP_FILTER_MODEL;
    modelSelect.setAttribute('aria-label', 'Filter Model');
    for (var m = 0; m < FILTER_MODELS.length; m++) {
      var mOpt = document.createElement('option');
      mOpt.value = FILTER_MODELS[m].val;
      mOpt.textContent = SL.t('filter_model.' + (_FM_KEY[FILTER_MODELS[m].val] || FILTER_MODELS[m].val), FILTER_MODELS[m].label);
      modelSelect.appendChild(mOpt);
    }
    var currentModel = filter.model || DEFAULT_FILTER_MODEL;
    modelSelect.value = currentModel;
    modelSelect.addEventListener('change', function() {
      var s = _getSettings();
      if (s) {
        s.filter.model = modelSelect.value;
        _notifyChange();
      }
    });
    topRow.appendChild(modelSelect);
    section.appendChild(topRow);

    // 2x2 grid for Cutoff, Resonance, Key Track
    var grid = document.createElement('div');
    grid.className = 'ssli-shape-filter-grid';

    var cutoffRow = _createSliderRow(SL.t('shape_screen.cutoff'), 0, CUTOFF_SLIDER_MAX, _freqToSlider(filter.freq), 1, function(sliderVal) {
      return _formatHz(_sliderToFreq(sliderVal));
    }, function(sliderVal) {
      var s = _getSettings();
      if (s) {
        s.filter.freq = Math.round(_sliderToFreq(sliderVal));
        _notifyChange();
      }
    }, TIP_CUTOFF);
    grid.appendChild(cutoffRow.row);

    var resoRow = _createSliderRow(SL.t('shape_screen.resonance'), FILTER_RESO_MIN, FILTER_RESO_MAX, filter.q, 0.1, function(v) {
      return 'Q ' + v.toFixed(1);
    }, function(v) {
      var s = _getSettings();
      if (s) {
        s.filter.q = v;
        _notifyChange();
      }
    }, TIP_RESONANCE);
    grid.appendChild(resoRow.row);

    var keyTrack = filter.keyTrack || 0;
    var keyTrackRow = _createSliderRow(SL.t('shape_screen.key_track'), KEY_TRACK_MIN, KEY_TRACK_MAX, keyTrack, 1, function(v) {
      return Math.round(v) + '%';
    }, function(v) {
      var s = _getSettings();
      if (s) {
        s.filter.keyTrack = v;
        _notifyChange();
      }
    }, TIP_KEY_TRACK);
    grid.appendChild(keyTrackRow.row);

    section.appendChild(grid);

    return section;
  }

  // ============================================================
  // Build Filter Envelope Amount Row (Dual mode only)
  // ============================================================

  function _buildFilterEnvAmountRow() {
    var settings = _getSettings();
    var amount = (settings && settings.filterEnv) ? settings.filterEnv.amount : 24;

    var row = _createSliderRow('Envelope Amount', FILTER_ENV_AMOUNT_MIN, FILTER_ENV_AMOUNT_MAX, amount, 1, function(v) {
      var sign = v > 0 ? '+' : '';
      return sign + Math.round(v) + ' st';
    }, function(v) {
      var s = _getSettings();
      if (s && s.filterEnv) {
        s.filterEnv.amount = v;
        _notifyChange();
      }
    }, TIP_ENV_AMOUNT);

    return row.row;
  }

  // ============================================================
  // ADSR Mode Toggle
  // ============================================================

  function _buildAdsrModeToggle() {
    var row = document.createElement('div');
    row.className = 'ssli-shape-mode-toggle';

    var label = document.createElement('span');
    label.className = 'ssli-shape-label';
    label.textContent = SL.t('shape.adsr_mode');
    label.title = TIP_ADSR_MODE;
    row.title = TIP_ADSR_MODE;

    var singleBtn = document.createElement('button');
    singleBtn.type = 'button';
    singleBtn.className = 'ssli-shape-mode-btn' + (_adsrMode === ADSR_MODE_SINGLE ? ' active' : '');
    singleBtn.textContent = SL.t('shape.single');
    singleBtn.setAttribute('data-mode', ADSR_MODE_SINGLE);
    singleBtn.title = TIP_ADSR_SINGLE;

    var dualBtn = document.createElement('button');
    dualBtn.type = 'button';
    dualBtn.className = 'ssli-shape-mode-btn' + (_adsrMode === ADSR_MODE_DUAL ? ' active' : '');
    dualBtn.textContent = SL.t('shape.dual');
    dualBtn.setAttribute('data-mode', ADSR_MODE_DUAL);
    dualBtn.title = TIP_ADSR_DUAL;

    function setMode(mode) {
      _adsrMode = mode;
      if (mode === ADSR_MODE_SINGLE) {
        singleBtn.classList.add('active');
        dualBtn.classList.remove('active');
      } else {
        singleBtn.classList.remove('active');
        dualBtn.classList.add('active');
      }
      // Update filter env link setting
      var s = _getSettings();
      if (s && s.filterEnv) {
        s.filterEnv.link = (mode === ADSR_MODE_SINGLE);
        s.filterEnv.enabled = (mode === ADSR_MODE_DUAL);
      }
      _updateAdsrVisibility();
      _notifyChange();
    }

    singleBtn.addEventListener('click', function() { setMode(ADSR_MODE_SINGLE); });
    dualBtn.addEventListener('click', function() { setMode(ADSR_MODE_DUAL); });

    row.appendChild(label);
    row.appendChild(singleBtn);
    row.appendChild(dualBtn);

    return row;
  }

  function _updateDualTabs() {
    if (_dualTabAmpBtn) {
      if (_dualAdsrTab === 'amp') {
        _dualTabAmpBtn.classList.add('active');
      } else {
        _dualTabAmpBtn.classList.remove('active');
      }
    }
    if (_dualTabFilterBtn) {
      if (_dualAdsrTab === 'filter') {
        _dualTabFilterBtn.classList.add('active');
      } else {
        _dualTabFilterBtn.classList.remove('active');
      }
    }
  }

  function _updateAdsrVisibility() {
    var dualTabRow = _screenEl ? _screenEl.querySelector('.ssli-shape-dual-tabs') : null;

    if (_adsrMode === ADSR_MODE_SINGLE) {
      if (_ampAdsrSection) {
        _ampAdsrSection.style.display = '';
        var titleEl = _ampAdsrSection.querySelector('.ssli-shape-section-title');
        if (titleEl) {
          titleEl.textContent = SL.t('shape.amp_filter_adsr');
        }
      }
      if (_filterAdsrSection) {
        _filterAdsrSection.style.display = 'none';
      }
      if (_filterEnvAmountRow) {
        _filterEnvAmountRow.style.display = 'none';
      }
      if (dualTabRow) {
        dualTabRow.style.display = 'none';
      }
    } else {
      // Dual mode: show tabs, show only the selected ADSR section
      if (dualTabRow) {
        dualTabRow.style.display = '';
      }
      if (_dualAdsrTab === 'amp') {
        if (_ampAdsrSection) {
          _ampAdsrSection.style.display = '';
          var ampTitle = _ampAdsrSection.querySelector('.ssli-shape-section-title');
          if (ampTitle) {
            ampTitle.textContent = SL.t('shape.amp_adsr');
          }
        }
        if (_filterAdsrSection) {
          _filterAdsrSection.style.display = 'none';
        }
        if (_filterEnvAmountRow) {
          _filterEnvAmountRow.style.display = 'none';
        }
      } else {
        if (_ampAdsrSection) {
          _ampAdsrSection.style.display = 'none';
        }
        if (_filterAdsrSection) {
          _filterAdsrSection.style.display = '';
        }
        if (_filterEnvAmountRow) {
          _filterEnvAmountRow.style.display = '';
        }
      }
      _updateDualTabs();
    }
  }

  // ============================================================
  // Build Screen
  // ============================================================

  function _buildScreen() {
    _screenEl = document.getElementById('ssli-screen-shape');
    if (!_screenEl) {
      return;
    }
    _screenEl.innerHTML = '';

    var container = document.createElement('div');
    container.className = 'ssli-shape-container';

    // ADSR Mode toggle
    _adsrModeToggle = _buildAdsrModeToggle();
    container.appendChild(_adsrModeToggle);

    // Determine initial mode from settings
    var settings = _getSettings();
    if (settings && settings.filterEnv && settings.filterEnv.enabled && !settings.filterEnv.link) {
      _adsrMode = ADSR_MODE_DUAL;
    } else {
      _adsrMode = ADSR_MODE_SINGLE;
    }

    // Dual-mode tab row (Amp ADSR | Filter ADSR) — hidden in single mode
    var dualTabRow = document.createElement('div');
    dualTabRow.className = 'ssli-shape-dual-tabs';
    _dualTabAmpBtn = document.createElement('button');
    _dualTabAmpBtn.type = 'button';
    _dualTabAmpBtn.className = 'ssli-shape-mode-btn active';
    _dualTabAmpBtn.textContent = SL.t('shape.amp_adsr');
    _dualTabAmpBtn.title = TIP_TAB_AMP;
    _dualTabAmpBtn.addEventListener('click', function() {
      _dualAdsrTab = 'amp';
      _updateAdsrVisibility();
      _refreshAdsrCurves();
    });
    _dualTabFilterBtn = document.createElement('button');
    _dualTabFilterBtn.type = 'button';
    _dualTabFilterBtn.className = 'ssli-shape-mode-btn';
    _dualTabFilterBtn.textContent = SL.t('shape.filter_adsr');
    _dualTabFilterBtn.title = TIP_TAB_FILT;
    _dualTabFilterBtn.addEventListener('click', function() {
      _dualAdsrTab = 'filter';
      _updateAdsrVisibility();
      _refreshAdsrCurves();
    });
    dualTabRow.appendChild(_dualTabAmpBtn);
    dualTabRow.appendChild(_dualTabFilterBtn);
    container.appendChild(dualTabRow);

    // Amp ADSR section
    _ampAdsrSection = _buildAdsrSection(SL.t('shape.amp_filter_adsr'), 'adsr', false);
    container.appendChild(_ampAdsrSection);

    // Filter ADSR section (for dual mode)
    _filterAdsrSection = _buildAdsrSection(SL.t('shape.filter_adsr'), 'filterEnv', true);
    container.appendChild(_filterAdsrSection);

    // Filter envelope amount (dual mode only)
    _filterEnvAmountRow = _buildFilterEnvAmountRow();
    container.appendChild(_filterEnvAmountRow);

    // Filter section
    container.appendChild(_buildFilterSection());

    // A-20: Glide/Portamento — inline row (no section wrapper to save space)
    var glideVal = (settings && settings.glide !== undefined) ? settings.glide : 0;
    var glideRow = _createSliderRow(SL.t('shape_screen.portamento'), GLIDE_MIN_MS, GLIDE_MAX_MS, glideVal, 1, _formatMs, function(v) {
      var s = _getSettings();
      if (s) {
        s.glide = v;
        _notifyChange();
      }
    }, TIP_PORTAMENTO);
    glideRow.row.style.padding = '1px 8px';
    glideRow.row.style.background = 'var(--ssli-bg-nav)';
    glideRow.row.style.border = '1px solid var(--ssli-border-panel)';
    glideRow.row.style.borderRadius = '4px';
    container.appendChild(glideRow.row);

    _screenEl.appendChild(container);

    // Set initial visibility
    _updateAdsrVisibility();
  }

  // ============================================================
  // Activate / Deactivate
  // ============================================================

  function _onStateChange(what) {
    if (!_active) {
      return;
    }
    var isSelfTriggeredShape = (what === 'shape' && _selfNotifying);
    if (!isSelfTriggeredShape && (what === 'preset' || what === 'instrument' || what === 'shape')) {
      _rebuildControls();
    }
  }

  function _rebuildControls() {
    if (!_initialized) {
      return;
    }
    _buildScreen();
    _refreshAdsrCurves();
  }

  function activate() {
    _active = true;
    if (!_initialized) {
      _buildScreen();
      _initialized = true;

      // Re-translate all visible text when the UI language changes
      if (SL.localization && SL.localization.onLanguageChange) {
        SL.localization.onLanguageChange(function() {
          if (_active) {
            _buildScreen();
            _refreshAdsrCurves();
          }
        });
      }
    } else {
      _rebuildControls();
    }
    _refreshAdsrCurves();
    SL.state.onChange(_onStateChange);
  }

  function deactivate() {
    _active = false;
    SL.state.removeListener(_onStateChange);
  }

  // ============================================================
  // Register
  // ============================================================

  SL.screenShape = {
    activate: activate,
    deactivate: deactivate
  };

})();
