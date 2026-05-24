// Super Synth Lab - Analyzer Module
// Oscilloscope and Spectrum Analyzer visualization
// v12.1.150 - Added Adaptive (Hermode-style) tuning system
// v12.1.149 - Added windowing functions (Hann, Hamming, Blackman, Blackman-Harris)
//             with manual FFT for windowed spectrum display and peak detection
(function() {
  'use strict';

  const SL = window.SynthLab;

  // Canvas references
  let scopeCanvas, scopeCtx;
  let spectrumCanvas, spectrumCtx;

  // Animation
  let animationId = null;
  let isVisible = false;

  // Analyser settings
  const FFT_SIZE = 2048;
  const SMOOTHING = 0.8;

  // Buffers (pre-allocated)
  let timeDomainData;
  let frequencyData;
  let floatTimeDomainData;

  // Windowing state
  let currentWindowFunction = 'rectangular';
  let spectrumMode = 'standard'; // 'standard' or 'windowed'

  // Pre-computed window coefficients (computed once when window changes)
  let windowCoefficients = null;

  // Pre-allocated scratch buffers for windowed FFT (avoid per-frame allocation)
  let _scratchReal = null;
  let _scratchImag = null;
  let _scratchMagnitudes = null;

  // Pre-computed spectrum bar colors (avoid string allocation in hot loop)
  const SPECTRUM_BAR_COUNT = 64;
  const spectrumColors = new Array(SPECTRUM_BAR_COUNT);
  for (let i = 0; i < SPECTRUM_BAR_COUNT; i++) {
    const hue = (i / SPECTRUM_BAR_COUNT) * 60 + 280;
    spectrumColors[i] = 'hsl(' + hue + ', 80%, 60%)';
  }

  // Peak detection colors
  // V-07: Changed from red to warm orange for colorblind safety
  const PEAK_COLOR = '#ff9f43';
  const PEAK_LABEL_COLOR = '#ffcc00';

  // ===== Window Functions =====

  function computeWindowCoefficients(name, N) {
    const coeffs = new Float32Array(N);
    if (name === 'rectangular') {
      for (let n = 0; n < N; n++) {
        coeffs[n] = 1.0;
      }
    } else if (name === 'hann') {
      for (let n = 0; n < N; n++) {
        coeffs[n] = 0.5 * (1.0 - Math.cos(2.0 * Math.PI * n / (N - 1)));
      }
    } else if (name === 'hamming') {
      for (let n = 0; n < N; n++) {
        coeffs[n] = 0.54 - 0.46 * Math.cos(2.0 * Math.PI * n / (N - 1));
      }
    } else if (name === 'blackman') {
      for (let n = 0; n < N; n++) {
        coeffs[n] = 0.42 - 0.5 * Math.cos(2.0 * Math.PI * n / (N - 1))
                   + 0.08 * Math.cos(4.0 * Math.PI * n / (N - 1));
      }
    } else if (name === 'blackman-harris') {
      for (let n = 0; n < N; n++) {
        coeffs[n] = 0.35875
                   - 0.48829 * Math.cos(2.0 * Math.PI * n / (N - 1))
                   + 0.14128 * Math.cos(4.0 * Math.PI * n / (N - 1))
                   - 0.01168 * Math.cos(6.0 * Math.PI * n / (N - 1));
      }
    } else {
      // Default to rectangular
      for (let n = 0; n < N; n++) {
        coeffs[n] = 1.0;
      }
    }
    return coeffs;
  }

  // ===== Cooley-Tukey FFT (radix-2, in-place) =====

  function fft(realIn, imagIn) {
    const N = realIn.length;
    const real = new Float32Array(realIn);
    const imag = new Float32Array(imagIn);

    // Bit-reversal permutation
    let j = 0;
    for (let i = 0; i < N - 1; i++) {
      if (i < j) {
        let tmpR = real[i];
        let tmpI = imag[i];
        real[i] = real[j];
        imag[i] = imag[j];
        real[j] = tmpR;
        imag[j] = tmpI;
      }
      let m = N >> 1;
      while (m >= 1 && j >= m) {
        j -= m;
        m >>= 1;
      }
      j += m;
    }

    // Cooley-Tukey butterfly
    for (let size = 2; size <= N; size *= 2) {
      const halfSize = size >> 1;
      const angleStep = -2.0 * Math.PI / size;
      for (let i = 0; i < N; i += size) {
        for (let k = 0; k < halfSize; k++) {
          const angle = angleStep * k;
          const wr = Math.cos(angle);
          const wi = Math.sin(angle);
          const idx1 = i + k;
          const idx2 = i + k + halfSize;
          const tR = wr * real[idx2] - wi * imag[idx2];
          const tI = wr * imag[idx2] + wi * real[idx2];
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
    const N = samples.length;

    // Reuse pre-allocated buffers (fall back to new allocation if not ready)
    const realIn = (_scratchReal && _scratchReal.length === N) ? _scratchReal : new Float32Array(N);
    const imagIn = (_scratchImag && _scratchImag.length === N) ? _scratchImag : new Float32Array(N);

    // Apply window and zero imaginary part
    for (let i = 0; i < N; i++) {
      realIn[i] = samples[i] * windowCoeffs[i];
      imagIn[i] = 0;
    }

    // FFT
    const result = fft(realIn, imagIn);

    // Compute magnitude in dB (only first half — positive frequencies)
    const halfN = N >> 1;
    const magnitudes = (_scratchMagnitudes && _scratchMagnitudes.length === halfN) ? _scratchMagnitudes : new Float32Array(halfN);
    for (let i = 0; i < halfN; i++) {
      const mag = Math.sqrt(result.real[i] * result.real[i] + result.imag[i] * result.imag[i]) / N;
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
    const peaks = [];
    const halfN = magnitudes.length;
    const binWidth = sampleRate / (halfN * 2);
    const threshold = -60; // dB threshold for peak detection

    // Find local maxima above threshold
    for (let i = 2; i < halfN - 2; i++) {
      const val = magnitudes[i];
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

    if (!scopeCanvas || !spectrumCanvas) return;

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
    const toggleBtn = document.getElementById('analyzerToggle');
    const panel = document.getElementById('analyzerPanel');
    const closeBtn = document.getElementById('analyzerClose');

    toggleBtn?.addEventListener('click', () => toggle());
    closeBtn?.addEventListener('click', () => hide());

    // Window function selector
    const windowSelect = document.getElementById('analyzerWindowSelect');
    if (windowSelect) {
      windowSelect.addEventListener('change', function() {
        setWindowFunction(windowSelect.value);
      });
    }

    // Spectrum mode toggle
    const modeToggle = document.getElementById('analyzerModeToggle');
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
    panel?.addEventListener('click', (e) => {
      if (e.target === panel) hide();
    });

    window.addEventListener('resize', resizeCanvases);

  }

  function resizeCanvases() {
    if (!scopeCanvas || !spectrumCanvas) return;

    // Match display size to CSS size
    const scopeRect = scopeCanvas.getBoundingClientRect();
    const spectrumRect = spectrumCanvas.getBoundingClientRect();

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
    const panel = document.getElementById('analyzerPanel');
    panel?.classList.remove('hidden');
    isVisible = true;
    resizeCanvases(); // Resize after showing since dimensions may have changed
    startAnimation();
  }

  function hide() {
    const panel = document.getElementById('analyzerPanel');
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

    const analyser = SL.audio?.getAnalyser?.();
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

    const canvas = scopeCanvas;
    const ctx = scopeCtx;
    const width = canvas.width / window.devicePixelRatio;
    const height = canvas.height / window.devicePixelRatio;

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

    const sliceWidth = width / timeDomainData.length;
    let x = 0;

    for (let i = 0; i < timeDomainData.length; i++) {
      const v = timeDomainData[i] / 128.0;
      const y = (v * height) / 2;

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

    const canvas = spectrumCanvas;
    const ctx = spectrumCtx;
    const width = canvas.width / window.devicePixelRatio;
    const height = canvas.height / window.devicePixelRatio;

    // Clear
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);

    // Frequency bars
    const barCount = SPECTRUM_BAR_COUNT;
    const barWidth = width / barCount - 1;
    const step = Math.floor(frequencyData.length / barCount);

    for (let i = 0; i < barCount; i++) {
      // Average multiple bins for each bar
      let sum = 0;
      for (let j = 0; j < step; j++) {
        sum += frequencyData[i * step + j];
      }
      const value = sum / step;

      const barHeight = (value / 255) * height;
      const x = i * (barWidth + 1);
      const y = height - barHeight;

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
      for (let i = 0; i < FFT_SIZE; i++) {
        floatTimeDomainData[i] = (timeDomainData[i] - 128) / 128.0;
      }
    }

    const canvas = spectrumCanvas;
    const ctx = spectrumCtx;
    const width = canvas.width / window.devicePixelRatio;
    const height = canvas.height / window.devicePixelRatio;

    // Clear
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);

    // Compute windowed FFT magnitude spectrum (dB)
    const magnitudes = computeWindowedSpectrum(floatTimeDomainData, windowCoefficients);
    const halfN = magnitudes.length;

    // dB range for display
    const dbMin = -100;
    const dbMax = 0;
    const dbRange = dbMax - dbMin;

    // Draw spectrum as filled line graph
    ctx.beginPath();
    ctx.moveTo(0, height);

    for (let i = 0; i < halfN; i++) {
      const xPos = (i / halfN) * width;
      const dbVal = Math.max(dbMin, Math.min(dbMax, magnitudes[i]));
      const yNorm = (dbVal - dbMin) / dbRange; // 0..1
      const yPos = height - yNorm * height;
      ctx.lineTo(xPos, yPos);
    }

    ctx.lineTo(width, height);
    ctx.closePath();

    // Gradient fill
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, 'rgba(114, 9, 183, 0.4)');
    gradient.addColorStop(0.5, 'rgba(76, 201, 240, 0.4)');
    gradient.addColorStop(1, 'rgba(247, 37, 133, 0.4)');
    ctx.fillStyle = gradient;
    ctx.fill();

    // Stroke the line on top
    ctx.beginPath();
    for (let i = 0; i < halfN; i++) {
      const xPos = (i / halfN) * width;
      const dbVal = Math.max(dbMin, Math.min(dbMax, magnitudes[i]));
      const yNorm = (dbVal - dbMin) / dbRange;
      const yPos = height - yNorm * height;
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
    const sampleRate = SL.audio?.getContext?.()?.sampleRate || 44100;
    const peaks = detectPeaks(magnitudes, sampleRate);

    // Draw peak markers
    ctx.font = '9px monospace';
    for (let p = 0; p < peaks.length; p++) {
      const peak = peaks[p];
      const xPos = (peak.bin / halfN) * width;
      const dbVal = Math.max(dbMin, Math.min(dbMax, peak.magnitude));
      const yNorm = (dbVal - dbMin) / dbRange;
      const yPos = height - yNorm * height;

      // Peak dot
      ctx.beginPath();
      ctx.arc(xPos, yPos, 3, 0, 2 * Math.PI);
      ctx.fillStyle = PEAK_COLOR;
      ctx.fill();

      // Frequency label (only for top 4 peaks)
      if (p < 4) {
        const label = formatFrequency(peak.frequency) + 'Hz';
        ctx.fillStyle = PEAK_LABEL_COLOR;
        // Offset label to avoid overlap
        const labelX = Math.min(xPos + 4, width - 40);
        const labelY = Math.max(yPos - 6, 12);
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
    const windowLabel = currentWindowFunction.charAt(0).toUpperCase() + currentWindowFunction.slice(1);
    ctx.fillText(windowLabel, width - ctx.measureText(windowLabel).width - 4, 10);
  }

  // ===== Public API =====

  function setWindowFunction(name) {
    const valid = ['rectangular', 'hann', 'hamming', 'blackman', 'blackman-harris'];
    if (valid.indexOf(name) === -1) {
      console.warn('Unknown window function: ' + name + '. Valid: ' + valid.join(', '));
      return;
    }
    currentWindowFunction = name;
    windowCoefficients = computeWindowCoefficients(name, FFT_SIZE);

    // If not already in windowed mode, switch to it (except rectangular)
    if (name !== 'rectangular' && spectrumMode === 'standard') {
      spectrumMode = 'windowed';
      const modeToggle = document.getElementById('analyzerModeToggle');
      if (modeToggle) {
        modeToggle.textContent = SL.t('analyzer.mode_windowed');
        modeToggle.classList.add('active');
      }
    }
  }

  function getWindowFunction() {
    return currentWindowFunction;
  }

  // Auto-show scope on first note played (Fix 24)
  // DISABLED on phone layouts — the analyzer <select> elements trigger
  // iOS full-screen picker wheels that cover the keyboard and block play.
  var _autoShowDone = false;
  function autoShowOnFirstNote() {
    if (_autoShowDone || isVisible) {
      return;
    }
    var layout = document.documentElement.getAttribute('data-layout');
    var isPhone = (layout === 'phone' || layout === 'phone-land');
    if (isPhone) {
      _autoShowDone = true;
      return;
    }
    _autoShowDone = true;
    show();
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
  var _pulseRunning = false;

  function _startBackgroundPulse() {
    if (_pulseRunning) { return; }
    _pulseRunning = true;

    function _pulseLoop() {
      if (!_pulseRunning) { return; }
      requestAnimationFrame(_pulseLoop);

      if (!_pulseAnalyser && SL.audio && SL.audio.getAnalyser) {
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
      _pulseRunning = false;
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
