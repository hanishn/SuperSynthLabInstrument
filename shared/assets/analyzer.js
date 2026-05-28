// Super Synth Lab - Analyzer Module
// Oscilloscope and Spectrum Analyzer visualization
// v12.1.150 - Added Adaptive (Hermode-style) tuning system
// v12.1.149 - Added windowing functions (Hann, Hamming, Blackman, Blackman-Harris)
//             with manual FFT for windowed spectrum display and peak detection
(function() {
  'use strict';

  var SL = window.SynthLab;

  // Canvas references
  var scopeCanvas, scopeCtx;
  var spectrumCanvas, spectrumCtx;

  // Animation
  var animationId = null;
  var isVisible = false;

  // Analyser settings
  var FFT_SIZE = 2048;
  var SMOOTHING = 0.8;

  // Buffers (pre-allocated)
  var timeDomainData;
  var frequencyData;
  var floatTimeDomainData;

  // Windowing state
  var currentWindowFunction = 'rectangular';
  var spectrumMode = 'standard'; // 'standard' or 'windowed'

  // Pre-computed window coefficients (computed once when window changes)
  var windowCoefficients = null;

  // Pre-allocated scratch buffers for windowed FFT (avoid per-frame allocation)
  var _scratchReal = null;
  var _scratchImag = null;
  var _scratchMagnitudes = null;

  // Pre-computed spectrum bar colors (avoid string allocation in hot loop)
  var SPECTRUM_BAR_COUNT = 64;
  var spectrumColors = new Array(SPECTRUM_BAR_COUNT);
  for (var i = 0; i < SPECTRUM_BAR_COUNT; i++) {
    var hue = (i / SPECTRUM_BAR_COUNT) * 60 + 280;
    spectrumColors[i] = 'hsl(' + hue + ', 80%, 60%)';
  }

  // Peak detection colors
  // V-07: Changed from red to warm orange for colorblind safety
  var PEAK_COLOR = '#ff9f43';
  var PEAK_LABEL_COLOR = '#ffcc00';

  // ===== Window Functions =====

  function computeWindowCoefficients(name, N) {
    var coeffs = new Float32Array(N);
    if (name === 'rectangular') {
      for (var n = 0; n < N; n++) {
        coeffs[n] = 1.0;
      }
    } else if (name === 'hann') {
      for (var n = 0; n < N; n++) {
        coeffs[n] = 0.5 * (1.0 - Math.cos(2.0 * Math.PI * n / (N - 1)));
      }
    } else if (name === 'hamming') {
      for (var n = 0; n < N; n++) {
        coeffs[n] = 0.54 - 0.46 * Math.cos(2.0 * Math.PI * n / (N - 1));
      }
    } else if (name === 'blackman') {
      for (var n = 0; n < N; n++) {
        var bk1 = 0.5 * Math.cos(2.0 * Math.PI * n / (N - 1));
        var bk2 = 0.08 * Math.cos(4.0 * Math.PI * n / (N - 1));
        coeffs[n] = 0.42 - bk1 + bk2;
      }
    } else if (name === 'blackman-harris') {
      for (var n = 0; n < N; n++) {
        var bh1 = 0.48829 * Math.cos(2.0 * Math.PI * n / (N - 1));
        var bh2 = 0.14128 * Math.cos(4.0 * Math.PI * n / (N - 1));
        var bh3 = 0.01168 * Math.cos(6.0 * Math.PI * n / (N - 1));
        coeffs[n] = 0.35875 - bh1 + bh2 - bh3;
      }
    } else {
      // Default to rectangular
      for (var n = 0; n < N; n++) {
        coeffs[n] = 1.0;
      }
    }
    return coeffs;
  }

  // ===== Cooley-Tukey FFT (radix-2, in-place) =====

  function fft(realIn, imagIn) {
    var N = realIn.length;
    var real = new Float32Array(realIn);
    var imag = new Float32Array(imagIn);

    // Bit-reversal permutation
    var j = 0;
    for (var i = 0; i < N - 1; i++) {
      if (i < j) {
        var tmpR = real[i];
        var tmpI = imag[i];
        real[i] = real[j];
        imag[i] = imag[j];
        real[j] = tmpR;
        imag[j] = tmpI;
      }
      var m = N >> 1;
      while (m >= 1 && j >= m) {
        j -= m;
        m >>= 1;
      }
      j += m;
    }

    // Cooley-Tukey butterfly
    for (var size = 2; size <= N; size *= 2) {
      var halfSize = size >> 1;
      var angleStep = -2.0 * Math.PI / size;
      for (var i = 0; i < N; i += size) {
        for (var k = 0; k < halfSize; k++) {
          var angle = angleStep * k;
          var wr = Math.cos(angle);
          var wi = Math.sin(angle);
          var idx1 = i + k;
          var idx2 = i + k + halfSize;
          var tR = wr * real[idx2] - wi * imag[idx2];
          var tI = wr * imag[idx2] + wi * real[idx2];
          real[idx2] = real[idx1] - tR;
          imag[idx2] = imag[idx1] - tI;
          real[idx1] = real[idx1] + tR;
          imag[idx1] = imag[idx1] + tI;
        }
      }
    }

    return { real: real, imag: imag };
  }

  // Compute magnitude spectrum in dB from windowed time-domain data
  // Uses pre-allocated scratch buffers to avoid per-frame allocation
  function computeWindowedSpectrum(samples, windowCoeffs) {
    var N = samples.length;

    // Reuse pre-allocated buffers (fall back to new allocation if not ready)
    var realIn = (_scratchReal && _scratchReal.length === N) ? _scratchReal : new Float32Array(N);
    var imagIn = (_scratchImag && _scratchImag.length === N) ? _scratchImag : new Float32Array(N);

    // Apply window and zero imaginary part
    for (var i = 0; i < N; i++) {
      realIn[i] = samples[i] * windowCoeffs[i];
      imagIn[i] = 0;
    }

    // FFT
    var result = fft(realIn, imagIn);

    // Compute magnitude in dB (only first half — positive frequencies)
    var halfN = N >> 1;
    var magnitudes = (_scratchMagnitudes && _scratchMagnitudes.length === halfN) ? _scratchMagnitudes : new Float32Array(halfN);
    for (var i = 0; i < halfN; i++) {
      var mag = Math.sqrt(result.real[i] * result.real[i] + result.imag[i] * result.imag[i]) / N;
      // Convert to dB, floor at -100 dB
      if (mag > 0) {
        magnitudes[i] = 20.0 * Math.log10(mag);
      } else {
        magnitudes[i] = -100.0;
      }
    }
    return magnitudes;
  }

  // ===== Peak Detection =====

  function detectPeaks(magnitudes, sampleRate) {
    var peaks = [];
    var halfN = magnitudes.length;
    var binWidth = sampleRate / (halfN * 2);
    var threshold = -60; // dB threshold for peak detection

    // Find local maxima above threshold
    for (var i = 2; i < halfN - 2; i++) {
      var val = magnitudes[i];
      if (val > threshold
          && val > magnitudes[i - 1]
          && val > magnitudes[i - 2]
          && val > magnitudes[i + 1]
          && val > magnitudes[i + 2]) {
        peaks.push({
          bin: i,
          frequency: i * binWidth,
          magnitude: val
        });
      }
    }

    // Sort by magnitude descending, keep top 8
    peaks.sort(function(a, b) { return b.magnitude - a.magnitude; });
    return peaks.slice(0, 8);
  }

  function formatFrequency(freq) {
    if (freq >= 1000) {
      return (freq / 1000).toFixed(1) + 'k';
    }
    return Math.round(freq) + '';
  }

  // ===== Init =====

  function init() {
    // Get canvas elements
    scopeCanvas = document.getElementById('scopeCanvas');
    spectrumCanvas = document.getElementById('spectrumCanvas');

    if (scopeCanvas) {
      if (spectrumCanvas) {

    scopeCtx = scopeCanvas.getContext('2d');
    spectrumCtx = spectrumCanvas.getContext('2d');

    // Set canvas resolution
    resizeCanvases();

    // Allocate buffers
    timeDomainData = new Uint8Array(FFT_SIZE);
    frequencyData = new Uint8Array(FFT_SIZE / 2);
    floatTimeDomainData = new Float32Array(FFT_SIZE);

    // Pre-compute default window coefficients
    windowCoefficients = computeWindowCoefficients('rectangular', FFT_SIZE);

    // Pre-allocate scratch buffers for windowed FFT
    _scratchReal = new Float32Array(FFT_SIZE);
    _scratchImag = new Float32Array(FFT_SIZE);
    _scratchMagnitudes = new Float32Array(FFT_SIZE >> 1);

    // Setup toggle button
    var toggleBtn = document.getElementById('analyzerToggle');
    var panel = document.getElementById('analyzerPanel');
    var closeBtn = document.getElementById('analyzerClose');

    toggleBtn?.addEventListener('click', function() { toggle(); });
    closeBtn?.addEventListener('click', function() { hide(); });

    // Window function selector
    var windowSelect = document.getElementById('analyzerWindowSelect');
    if (windowSelect) {
      windowSelect.addEventListener('change', function() {
        setWindowFunction(windowSelect.value);
      });
    }

    // Spectrum mode toggle
    var modeToggle = document.getElementById('analyzerModeToggle');
    if (modeToggle) {
      modeToggle.addEventListener('click', function() {
        if (spectrumMode === 'standard') {
          spectrumMode = 'windowed';
          modeToggle.textContent = SL.t('analyzer.mode_windowed');
          modeToggle.classList.add('active');
        } else {
          spectrumMode = 'standard';
          modeToggle.textContent = SL.t('analyzer.mode_standard');
          modeToggle.classList.remove('active');
        }
      });
    }

    // Click outside to close (optional)
    panel?.addEventListener('click', function(e) {
      if (e.target === panel) { hide(); }
    });

    window.addEventListener('resize', resizeCanvases);

      } // end if (spectrumCanvas)
    } // end if (scopeCanvas)
  }

  function resizeCanvases() {
    if (!scopeCanvas || !spectrumCanvas) return;

    // Match display size to CSS size
    var scopeRect = scopeCanvas.getBoundingClientRect();
    var spectrumRect = spectrumCanvas.getBoundingClientRect();

    // Reset transforms before resizing
    scopeCtx?.resetTransform?.();
    spectrumCtx?.resetTransform?.();

    scopeCanvas.width = scopeRect.width * window.devicePixelRatio;
    scopeCanvas.height = scopeRect.height * window.devicePixelRatio;
    spectrumCanvas.width = spectrumRect.width * window.devicePixelRatio;
    spectrumCanvas.height = spectrumRect.height * window.devicePixelRatio;

    // Scale context for retina
    scopeCtx?.scale(window.devicePixelRatio, window.devicePixelRatio);
    spectrumCtx?.scale(window.devicePixelRatio, window.devicePixelRatio);
  }

  function show() {
    var panel = document.getElementById('analyzerPanel');
    panel?.classList.remove('hidden');
    isVisible = true;
    resizeCanvases(); // Resize after showing since dimensions may have changed
    startAnimation();
  }

  function hide() {
    var panel = document.getElementById('analyzerPanel');
    panel?.classList.add('hidden');
    isVisible = false;
    stopAnimation();
  }

  function toggle() {
    isVisible ? hide() : show();
  }

  function startAnimation() {
    if (animationId) return;
    render();
  }

  function stopAnimation() {
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  }

  function render() {
    if (!isVisible) return;

    animationId = requestAnimationFrame(render);

    if (!SL._tabVisible) return;

    var analyser = SL.audio?.getAnalyser?.();
    if (analyser) {
      drawOscilloscope(analyser);
      if (spectrumMode === 'windowed') {
        drawWindowedSpectrum(analyser);
      } else {
        drawSpectrum(analyser);
      }
    }
  }

  function drawOscilloscope(analyser) {
    if (!timeDomainData) { return; }
    analyser.getByteTimeDomainData(timeDomainData);

    var canvas = scopeCanvas;
    var ctx = scopeCtx;
    var width = canvas.width / (window.devicePixelRatio || 1);
    var height = canvas.height / (window.devicePixelRatio || 1);

    // Clear
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);

    // Grid lines
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    // Waveform
    ctx.strokeStyle = '#4cc9f0';
    ctx.lineWidth = 2;
    ctx.beginPath();

    var sliceWidth = width / timeDomainData.length;
    var x = 0;

    for (var i = 0; i < timeDomainData.length; i++) {
      var v = timeDomainData[i] / 128.0;
      var y = (v * height) / 2;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
      x += sliceWidth;
    }

    ctx.stroke();
  }

  function drawSpectrum(analyser) {
    if (!frequencyData) { return; }
    analyser.getByteFrequencyData(frequencyData);

    var canvas = spectrumCanvas;
    var ctx = spectrumCtx;
    var width = canvas.width / (window.devicePixelRatio || 1);
    var height = canvas.height / (window.devicePixelRatio || 1);

    // Clear
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);

    // Frequency bars
    var barCount = SPECTRUM_BAR_COUNT;
    var safeBarCount = barCount || 1;
    var barWidth = width / safeBarCount - 1;
    var step = Math.floor(frequencyData.length / safeBarCount);

    for (var i = 0; i < barCount; i++) {
      // Average multiple bins for each bar
      var sum = 0;
      for (var j = 0; j < step; j++) {
        sum += frequencyData[i * step + j];
      }
      var safeStep = step || 1;
      var value = sum / safeStep;

      var barHeight = (value / 255) * height;
      var x = i * (barWidth + 1);
      var y = height - barHeight;

      // Gradient color based on frequency (pre-computed)
      ctx.fillStyle = spectrumColors[i];
      ctx.fillRect(x, y, barWidth, barHeight);
    }

    // Frequency labels
    ctx.fillStyle = '#666';
    ctx.font = '10px monospace';
    ctx.fillText('20Hz', 2, height - 2);
    ctx.fillText('20kHz', width - 35, height - 2);
  }

  function drawWindowedSpectrum(analyser) {
    if (!floatTimeDomainData || !timeDomainData) { return; }
    // Get float time-domain data for windowed FFT
    if (analyser.getFloatTimeDomainData) {
      analyser.getFloatTimeDomainData(floatTimeDomainData);
    } else {
      // Fallback: convert byte data to float
      analyser.getByteTimeDomainData(timeDomainData);
      for (var i = 0; i < FFT_SIZE; i++) {
        floatTimeDomainData[i] = (timeDomainData[i] - 128) / 128.0;
      }
    }

    var canvas = spectrumCanvas;
    var ctx = spectrumCtx;
    var width = canvas.width / (window.devicePixelRatio || 1);
    var height = canvas.height / (window.devicePixelRatio || 1);

    // Clear
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);

    // Compute windowed FFT magnitude spectrum (dB)
    var magnitudes = computeWindowedSpectrum(floatTimeDomainData, windowCoefficients);
    var halfN = magnitudes.length;
    var safeHalfN = halfN || 1;

    // dB range for display
    var dbMin = -100;
    var dbMax = 0;
    var dbRange = dbMax - dbMin;
    var safeDbRange = dbRange || 1;

    // Draw spectrum as filled line graph
    ctx.beginPath();
    ctx.moveTo(0, height);

    for (var i = 0; i < halfN; i++) {
      var xPos = (i / safeHalfN) * width;
      var dbVal = Math.max(dbMin, Math.min(dbMax, magnitudes[i]));
      var yNorm = (dbVal - dbMin) / safeDbRange; // 0..1
      var yPos = height - yNorm * height;
      ctx.lineTo(xPos, yPos);
    }

    ctx.lineTo(width, height);
    ctx.closePath();

    // Gradient fill
    var gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, 'rgba(114, 9, 183, 0.4)');
    gradient.addColorStop(0.5, 'rgba(76, 201, 240, 0.4)');
    gradient.addColorStop(1, 'rgba(247, 37, 133, 0.4)');
    ctx.fillStyle = gradient;
    ctx.fill();

    // Stroke the line on top
    ctx.beginPath();
    for (var i = 0; i < halfN; i++) {
      var xPos = (i / safeHalfN) * width;
      var dbVal = Math.max(dbMin, Math.min(dbMax, magnitudes[i]));
      var yNorm = (dbVal - dbMin) / safeDbRange;
      var yPos = height - yNorm * height;
      if (i === 0) {
        ctx.moveTo(xPos, yPos);
      } else {
        ctx.lineTo(xPos, yPos);
      }
    }
    ctx.strokeStyle = '#4cc9f0';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Peak detection
    var sampleRate = SL.audio?.getContext?.()?.sampleRate || 44100;
    var peaks = detectPeaks(magnitudes, sampleRate);

    // Draw peak markers
    ctx.font = '9px monospace';
    for (var p = 0; p < peaks.length; p++) {
      var peak = peaks[p];
      var xPos = (peak.bin / safeHalfN) * width;
      var dbVal = Math.max(dbMin, Math.min(dbMax, peak.magnitude));
      var yNorm = (dbVal - dbMin) / safeDbRange;
      var yPos = height - yNorm * height;

      // Peak dot
      ctx.beginPath();
      ctx.arc(xPos, yPos, 3, 0, 2 * Math.PI);
      ctx.fillStyle = PEAK_COLOR;
      ctx.fill();

      // Frequency label (only for top 4 peaks)
      if (p < 4) {
        var label = formatFrequency(peak.frequency) + 'Hz';
        ctx.fillStyle = PEAK_LABEL_COLOR;
        // Offset label to avoid overlap
        var labelX = Math.min(xPos + 4, width - 40);
        var labelY = Math.max(yPos - 6, 12);
        ctx.fillText(label, labelX, labelY);
      }
    }

    // dB scale labels
    ctx.fillStyle = '#555';
    ctx.font = '9px monospace';
    ctx.fillText('0dB', 2, 10);
    ctx.fillText('-50dB', 2, height / 2);
    ctx.fillText('-100dB', 2, height - 2);

    // Frequency labels
    ctx.fillStyle = '#666';
    ctx.font = '10px monospace';
    ctx.fillText('20Hz', 40, height - 2);
    ctx.fillText('20kHz', width - 35, height - 2);

    // Window function label
    ctx.fillStyle = '#4cc9f0';
    ctx.font = '9px monospace';
    var windowLabel = currentWindowFunction.charAt(0).toUpperCase() + currentWindowFunction.slice(1);
    ctx.fillText(windowLabel, width - ctx.measureText(windowLabel).width - 4, 10);
  }

  // ===== Public API =====

  function setWindowFunction(name) {
    var valid = ['rectangular', 'hann', 'hamming', 'blackman', 'blackman-harris'];
    if (valid.indexOf(name) === -1) {
      console.warn('Unknown window function: ' + name + '. Valid: ' + valid.join(', '));
    } else {
      currentWindowFunction = name;
      windowCoefficients = computeWindowCoefficients(name, FFT_SIZE);

      // If not already in windowed mode, switch to it (except rectangular)
      if (name !== 'rectangular' && spectrumMode === 'standard') {
        spectrumMode = 'windowed';
        var modeToggle = document.getElementById('analyzerModeToggle');
        if (modeToggle) {
          modeToggle.textContent = SL.t('analyzer.mode_windowed');
          modeToggle.classList.add('active');
        }
      }
    }
  }

  function getWindowFunction() {
    return currentWindowFunction;
  }

  // Auto-show scope on first note played (Fix 24)
  // DISABLED on phone layouts — the analyzer <select> elements trigger
  // iOS full-screen picker wheels that cover the keyboard and block play.
  var _hasAutoShowDone = false;
  function autoShowOnFirstNote() {
    if (!_hasAutoShowDone && !isVisible) {
      var layout = document.documentElement.getAttribute('data-layout');
      var isPhone = (layout === 'phone' || layout === 'phone-land');
      if (isPhone) {
        _hasAutoShowDone = true;
      } else {
        _hasAutoShowDone = true;
        show();
      }
    }
  }

  // Export
  SL.analyzer = {
    init: init,
    show: show,
    hide: hide,
    toggle: toggle,
    isVisible: function() { return isVisible; },
    setWindowFunction: setWindowFunction,
    getWindowFunction: getWindowFunction,
    autoShowOnFirstNote: autoShowOnFirstNote
  };

  // ============================================================
  // Background Breathing Pulse (delight)
  // Samples master output RMS and sets --sslu-pulse CSS property
  // on body for a very subtle ambient glow. Max value 0.05.
  // ============================================================

  var _pulseAnalyser = null;
  var _pulseData = null;
  var _isPulseRunning = false;

  function _startBackgroundPulse() {
    if (_isPulseRunning) { return; }
    _isPulseRunning = true;

    function _pulseLoop() {
      if (!_isPulseRunning) { return; }
      requestAnimationFrame(_pulseLoop);

      var canGetAnalyser = SL.audio && SL.audio.getAnalyser;
      var shouldInitAnalyser = !_pulseAnalyser && canGetAnalyser;
      if (shouldInitAnalyser) {
        _pulseAnalyser = SL.audio.getAnalyser();
        if (_pulseAnalyser) {
          _pulseData = new Uint8Array(_pulseAnalyser.frequencyBinCount);
        }
      }
      if (!_pulseAnalyser || !_pulseData) { return; }

      _pulseAnalyser.getByteTimeDomainData(_pulseData);
      var sumSq = 0;
      for (var pi = 0; pi < _pulseData.length; pi++) {
        var sample = (_pulseData[pi] - 128) / 128;
        sumSq += sample * sample;
      }
      var rms = Math.sqrt(sumSq / _pulseData.length);
      var pulse = Math.min(0.05, rms * 0.15);
      document.body.style.setProperty('--sslu-pulse', pulse.toFixed(4));
    }
    _pulseLoop();
  }

  // Auto-start on first user interaction (audio context needs gesture)
  document.addEventListener('click', function _startPulseOnce() {
    _startBackgroundPulse();
    document.removeEventListener('click', _startPulseOnce);
  });

  SL.bgPulse = { start: _startBackgroundPulse };

  // ============================================================
  // Idle power management (Fix R11)
  // Pause scope render + background pulse when page hidden.
  // AudioContext suspend is managed solely by audio-engine.js
  // (IDLE_SUSPEND_TIMEOUT_MS). Duplicate removed here.
  // ============================================================

  document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
      // Pause background pulse to save CPU
      _isPulseRunning = false;
      // Scope already skips via SL._tabVisible check
    } else {
      // Resume background pulse
      _startBackgroundPulse();
    }
  });

  // Delegate idle timer to audio-engine.js
  SL._resetIdleTimer = function() {
    if (SL.audio && SL.audio.resetIdleSuspendTimer) {
      SL.audio.resetIdleSuspendTimer();
    }
  };

})();
