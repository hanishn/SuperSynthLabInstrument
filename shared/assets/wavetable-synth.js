// Super Synth Lab - Wavetable Scanning Synthesis Engine Module
// Multi-frame wavetable with morphing, built-in banks, and LFO auto-scan
// v1.0.0 - ScriptProcessor fallback, 16-voice, ADSR, scan modulation
//
// -----------------------------------------------------------------------
// WAVETABLE SYNTHESIS ENGINE [ENG-013]
// -----------------------------------------------------------------------
// Wavetable synthesis stores pre-computed single-cycle waveforms in a
// "table" (bank) and plays them back at the desired pitch. By
// interpolating between adjacent frames in the bank, the timbre morphs
// smoothly in real time -- this is called "scanning".
//   -- Roads, C. (1996) The Computer Music Tutorial, MIT Press, ch. 4
//   -- Bristow-Johnson, R. (1996) "Wavetable Synthesis 101"
//
// Wolfgang Palm's PPG Wave (1981) was the first commercial wavetable
// synthesizer. The PPG Wave 2.2 (1982) and later Waldorf Microwave
// (1989) popularized the technique in electronic music production.
//
// Each frame is a single cycle of a waveform stored as Fourier
// coefficients (harmonic amplitudes). A bank contains 32 frames with
// 64 harmonics each. Scanning from frame 0 to frame 31 morphs
// through the timbral evolution defined by that bank.
//
// Banks in this engine:
//   basic   -- sine -> saw -> square -> triangle -> pulse
//   vocal   -- vowel-like formant morphs (A, E, I, O, U)
//   digital -- PWM sweep and oscillator-sync effects
//   metallic -- inharmonic partials (bell/gong timbres)
//
// An LFO can automate the scan position, creating evolving pad
// textures without manual control. Morph smoothing applies a one-pole
// lowpass to the scan position to prevent zipper noise during fast
// parameter changes.
// -----------------------------------------------------------------------
(function() {
  'use strict';

  var SL = window.SynthLab;

  // ============================================================
  // Constants
  // ============================================================

  var MAX_VOICES_PER_INSTRUMENT = 16;
  var TWO_PI = 2 * Math.PI;
  // 32 frames per bank, 64 harmonics per frame. These dimensions
  // balance timbral variety (32 distinct snapshots to scan through)
  // with CPU cost (64 partials summed via additive synthesis per sample).
  var FRAMES_PER_TABLE = 32;
  var HARMONICS_PER_FRAME = 64;

  // ============================================================
  // Default Settings
  // ============================================================

  var DEFAULT_WAVETABLE_SYNTH_SETTINGS = {
    bank: 'basic',
    scanPosition: 0,
    scanLfoSpeed: 0,
    scanLfoDepth: 50,
    detune: 0,
    morphSmoothing: 50
  };

  // ============================================================
  // Wavetable Banks
  // Each bank has FRAMES_PER_TABLE frames, each frame is an array
  // of harmonic amplitudes (partials 1..HARMONICS_PER_FRAME)
  // ============================================================
  // Unlike the PPG Wave which stored raw PCM samples, this engine
  // stores each frame as Fourier coefficients (harmonic amplitudes).
  // This approach is automatically bandlimited -- we simply skip
  // harmonics above Nyquist during rendering, eliminating aliasing
  // without needing oversampling or BLIT techniques.
  // The Web Audio API's PeriodicWave uses the same representation
  // (real + imaginary Fourier coefficients).

  var wavetableBanks = {};

  function buildBanks() {
    wavetableBanks.basic = buildBasicShapesBank();
    wavetableBanks.vocal = buildVocalBank();
    wavetableBanks.digital = buildDigitalBank();
    wavetableBanks.metallic = buildMetallicBank();
  }

  // Basic bank: morphs through the four canonical analog waveforms.
  // Each transition manipulates the harmonic series:
  //   Sine: only fundamental (h=1). Saw: all harmonics at 1/n.
  //   Square: odd harmonics at 1/n. Triangle: odd harmonics at 1/n^2.
  //   Pulse: all harmonics (narrow duty cycle = bright, nasal).
  // This bank is ideal for understanding Fourier synthesis -- each
  // waveform is defined entirely by its harmonic content.
  /**
   * Basic Shapes: sine -> saw -> square -> triangle -> pulse
   * Smooth morph through fundamental waveshapes
   */
  function buildBasicShapesBank() {
    var frames = [];
    for (var f = 0; f < FRAMES_PER_TABLE; f++) {
      var harmonics = new Float64Array(HARMONICS_PER_FRAME);
      var t = f / (FRAMES_PER_TABLE - 1); // 0..1

      if (t < 0.25) {
        // Sine -> Saw: gradually add harmonics with 1/n amplitude
        var sawMix = t / 0.25;
        harmonics[0] = 1.0;
        for (var h = 1; h < HARMONICS_PER_FRAME; h++) {
          harmonics[h] = sawMix * (1.0 / (h + 1));
        }
      } else if (t < 0.5) {
        // Saw -> Square: fade out even harmonics
        var sqMix = (t - 0.25) / 0.25;
        for (var h2 = 0; h2 < HARMONICS_PER_FRAME; h2++) {
          var n = h2 + 1;
          var safeN = n || 1;
          var sawAmp = 1.0 / safeN;
          if (n % 2 === 0) {
            harmonics[h2] = sawAmp * (1.0 - sqMix);
          } else {
            harmonics[h2] = sawAmp;
          }
        }
      } else if (t < 0.75) {
        // Square -> Triangle: change amplitude falloff from 1/n to 1/n^2, odd only
        var triMix = (t - 0.5) / 0.25;
        for (var h3 = 0; h3 < HARMONICS_PER_FRAME; h3++) {
          var n3 = h3 + 1;
          var safeN3 = n3 || 1;
          if (n3 % 2 === 1) {
            var sqAmp = 1.0 / safeN3;
            var triAmp = 1.0 / (safeN3 * safeN3);
            harmonics[h3] = sqAmp + (triAmp - sqAmp) * triMix;
          } else {
            harmonics[h3] = 0;
          }
        }
      } else {
        // Triangle -> Narrow pulse: add even harmonics back, boost higher partials
        var pulseMix = (t - 0.75) / 0.25;
        for (var h4 = 0; h4 < HARMONICS_PER_FRAME; h4++) {
          var n4 = h4 + 1;
          var safeN4 = n4 || 1;
          var triAmp2 = (n4 % 2 === 1) ? (1.0 / (safeN4 * safeN4)) : 0;
          var pulseAmp = 1.0 / safeN4; // all harmonics present for narrow pulse
          harmonics[h4] = triAmp2 + (pulseAmp - triAmp2) * pulseMix;
        }
      }
      frames.push(harmonics);
    }
    return frames;
  }

  // Vocal bank: approximates vowel formant structures by boosting
  // harmonics near formant-like frequency regions. Scanning through
  // cycles A -> E -> I -> O -> U -> A, creating a "talking" timbre.
  // Unlike the vocoder engine (which uses real bandpass filters), this
  // bank bakes the spectral shape directly into the harmonic amplitudes.
  /**
   * Vocal: vowel-like formant morphs via harmonic emphasis patterns
   */
  function buildVocalBank() {
    var frames = [];
    // 5 vowel targets spread across 32 frames (A, E, I, O, U, back to A)
    var vowelFormants = [
      [3, 5, 10, 14],  // A-like: boost h3,h5,h10,h14
      [2, 8, 11, 15],  // E-like
      [1, 9, 12, 16],  // I-like
      [2, 4, 10, 14],  // O-like
      [1, 4, 9, 13],   // U-like
      [3, 5, 10, 14]   // back to A
    ];
    for (var f = 0; f < FRAMES_PER_TABLE; f++) {
      var harmonics = new Float64Array(HARMONICS_PER_FRAME);
      var pos = f / (FRAMES_PER_TABLE - 1) * (vowelFormants.length - 1);
      var idx = Math.floor(pos);
      var frac = pos - idx;
      if (idx >= vowelFormants.length - 1) {
        idx = vowelFormants.length - 2;
        frac = 1.0;
      }
      var formA = vowelFormants[idx];
      var formB = vowelFormants[idx + 1];

      // Base spectrum: gentle 1/n rolloff
      for (var h = 0; h < HARMONICS_PER_FRAME; h++) {
        harmonics[h] = 0.3 / (h + 1);
      }
      // Boost formant regions (interpolated)
      for (var fi = 0; fi < formA.length; fi++) {
        var targetH = Math.round(formA[fi] + (formB[fi] - formA[fi]) * frac);
        var boostAmp = 0.8 - fi * 0.15;
        for (var bh = -1; bh <= 1; bh++) {
          var bIdx = targetH + bh - 1;
          if (bIdx >= 0 && bIdx < HARMONICS_PER_FRAME) {
            var dist = Math.abs(bh);
            harmonics[bIdx] += boostAmp * (1.0 - dist * 0.4);
          }
        }
      }
      frames.push(harmonics);
    }
    return frames;
  }

  // Digital bank: emulates two classic analog synth effects via
  // harmonic manipulation. First half: pulse-width modulation (PWM),
  // sweeping duty cycle from 50% to 5%. PWM spectrum follows
  // sin(n*pi*pw)/n -- as pw narrows, higher harmonics dominate.
  // Second half: oscillator hard-sync effect, where harmonic peaks
  // shift upward simulating a slave oscillator synced to a master.
  /**
   * Digital: PWM sweep and sync-like effects via harmonic manipulation
   */
  function buildDigitalBank() {
    var frames = [];
    for (var f = 0; f < FRAMES_PER_TABLE; f++) {
      var harmonics = new Float64Array(HARMONICS_PER_FRAME);
      var t = f / (FRAMES_PER_TABLE - 1);

      if (t < 0.5) {
        // PWM sweep: pulse width from 50% to 5%
        var pw = 0.5 - t * 0.9; // 0.5 -> 0.05
        for (var h = 0; h < HARMONICS_PER_FRAME; h++) {
          var n = h + 1;
          var safeN = n || 1;
          // Pulse wave spectrum: sin(n*pi*pw) / n
          harmonics[h] = Math.abs(Math.sin(n * Math.PI * pw)) / safeN;
        }
      } else {
        // Sync sweep: shift harmonic peaks upward
        var syncRatio = 1.0 + (t - 0.5) * 2.0 * 7.0; // 1.0 -> 8.0
        var safeSyncRatio = syncRatio || 1;
        for (var h2 = 0; h2 < HARMONICS_PER_FRAME; h2++) {
          var n2 = h2 + 1;
          var safeN2 = n2 || 1;
          // Sinc-like envelope centered on syncRatio multiples
          var dist2 = (n2 / safeSyncRatio) - Math.round(n2 / safeSyncRatio);
          harmonics[h2] = Math.exp(-dist2 * dist2 * 8) / safeN2;
        }
      }
      frames.push(harmonics);
    }
    return frames;
  }

  // Metallic bank: evolves from harmonic to inharmonic spectra using
  // the stretched-string partial model: f_n = n * sqrt(1 + B*n^2).
  // As inharmonicity (B) increases, partials drift from integer
  // ratios, producing bell-like and gong-like timbres. Spectral tilt
  // also evolves from bright to dark across the scan range. Pairs of
  // close partials create audible beating effects.
  /**
   * Metallic: inharmonic partials evolving - bell/gong-like timbres
   */
  function buildMetallicBank() {
    var frames = [];
    for (var f = 0; f < FRAMES_PER_TABLE; f++) {
      var harmonics = new Float64Array(HARMONICS_PER_FRAME);
      var t = f / (FRAMES_PER_TABLE - 1);

      // Shift from harmonic to increasingly inharmonic spectrum
      var inharmonicity = t * 0.15; // inharmonicity coefficient
      for (var h = 0; h < HARMONICS_PER_FRAME; h++) {
        var n = h + 1;
        // Stretched partial: f_n = n * sqrt(1 + B * n^2) (piano-string model)
        var stretchedN = n * Math.sqrt(1.0 + inharmonicity * n * n);
        var safeStretchedN = stretchedN || 1;
        // Amplitude with spectral tilt evolving from bright to dark
        var tilt = 1.0 + t * 2.0;
        var amp = Math.pow(1.0 / safeStretchedN, tilt);
        // Add beating: pairs of close partials
        if (h > 0 && h % 3 === 0) {
          amp *= 1.0 + 0.5 * Math.sin(t * TWO_PI * 2);
        }
        harmonics[h] = amp;
      }
      frames.push(harmonics);
    }
    return frames;
  }

  // ============================================================
  // State
  // ============================================================

  var audioContext = null;
  var isEngineReady = false;

  var scriptNodes = [null, null, null, null];
  var fallbackVoicesByInst = [[], [], [], []];
  var instrumentSettings = {};
  var wtFilterNodes = {};
  var connectedInsts = [false, false, false, false];

  // ============================================================
  // MIDI / Frequency Helpers
  // ============================================================

  function midiToFreq(midi) {
    var a4 = 440;
    var refEl = typeof document !== 'undefined' && document.getElementById('refHz');
    if (refEl) {
      a4 = parseFloat(refEl.value) || 440;
    }
    if (SL.tuning && SL.tuning.noteToFreq) {
      return SL.tuning.noteToFreq(midi, a4);
    }
    return a4 * Math.pow(2, (midi - 69) / 12);
  }

  // ============================================================
  // Wavetable Frame Rendering
  // ============================================================
  // Rendering uses additive synthesis: each frame's harmonic amplitudes
  // are summed as sine partials at runtime. This is more CPU-intensive
  // than playing back pre-rendered PCM, but allows automatic bandlimiting
  // (we simply cap the partial count at Nyquist/fundamental) and enables
  // smooth interpolation between adjacent frames without crossfade
  // artifacts. The interpolated sample blends two frames linearly based
  // on the fractional scan position -- this is the "morph" effect.

  /**
   * Render a single sample from a wavetable frame using additive synthesis.
   * @param {Float64Array} harmonics - harmonic amplitudes for this frame
   * @param {number} phase - 0..1 oscillator phase
   * @param {number} maxHarmonic - band-limit based on frequency
   * @returns {number} sample value
   */
  function renderFrameSample(harmonics, phase, maxHarmonic) {
    var sample = 0;
    var limit = Math.min(maxHarmonic, harmonics.length);
    var theta = TWO_PI * phase;
    for (var h = 0; h < limit; h++) {
      if (harmonics[h] !== 0) {
        sample += harmonics[h] * Math.sin((h + 1) * theta);
      }
    }
    return sample;
  }

  /**
   * Get an interpolated sample between two adjacent frames.
   * @param {Array} frames - array of Float64Array harmonic frames
   * @param {number} scanPos - 0..1 scan position
   * @param {number} phase - 0..1 oscillator phase
   * @param {number} maxHarmonic - band-limit
   * @returns {number} interpolated sample
   */
  function getInterpolatedSample(frames, scanPos, phase, maxHarmonic) {
    var frameCount = frames.length;
    var posScaled = scanPos * (frameCount - 1);
    var frameIdx = Math.floor(posScaled);
    var frac = posScaled - frameIdx;

    if (frameIdx >= frameCount - 1) {
      frameIdx = frameCount - 2;
      frac = 1.0;
    }
    if (frameIdx < 0) {
      frameIdx = 0;
      frac = 0;
    }

    var sampleA = renderFrameSample(frames[frameIdx], phase, maxHarmonic);
    var sampleB = renderFrameSample(frames[frameIdx + 1], phase, maxHarmonic);

    return sampleA + (sampleB - sampleA) * frac;
  }

  // ============================================================
  // Wavetable Voice
  // ============================================================
  // Each voice tracks: oscillator phase, current scan position
  // (with LFO modulation and smoothing), the active bank's frames,
  // and a standard ADSR envelope. The scan LFO is a simple sine
  // oscillator that modulates the scan position around the user's
  // base setting -- this creates the slowly-evolving pad textures
  // that wavetable synths are famous for.

  function WavetableVoice(sr) {
    this.sampleRate = sr;
    this.active = false;
    this.midiNote = -1;
    this.instId = 0;
    this.baseFreq = 440;
    this.velocity = 1.0;

    // Oscillator state
    this.phase = 0;
    this.phaseInc = 0;
    this.detuneRatio = 1.0;
    this.maxHarmonic = HARMONICS_PER_FRAME;

    // Wavetable scan
    this.scanPosition = 0;         // 0..1 base scan position
    this.currentScanPos = 0;       // 0..1 effective (with LFO)
    this.scanLfoPhase = 0;
    this.scanLfoSpeed = 0;         // Hz
    this.scanLfoDepth = 0.5;       // 0..1
    this.morphSmoothing = 0.5;     // 0..1
    this.smoothedScanPos = 0;

    // Bank reference
    this.frames = null;

    // ADSR envelope state
    this.envStage = 0;
    this.envLevel = 0;
    this.envReleased = false;
    this.envFinished = false;
    this.attackRate = 0;
    this.decayRate = 0;
    this.sustainLevel = 0.7;
    this.releaseRate = 0;

    // Fade-in ramp
    this.fadeInSamples = 0;
    this.fadeInCounter = 0;

    // Humanization
    this.startDelaySamples = 0;
  }

  WavetableVoice.prototype.noteOn = function(midi, vel, freq, settings) {
    this.active = true;
    this.midiNote = midi;
    this.baseFreq = freq;
    this.instId = settings.instId || 0;
    this.envStage = 0;
    this.envLevel = 0;
    this.envReleased = false;
    this.envFinished = false;
    this.phase = 0;
    this.scanLfoPhase = 0;

    // Detune
    var detuneCents = settings.detune || 0;
    this.detuneRatio = Math.pow(2, detuneCents / 1200);
    this.phaseInc = (freq * this.detuneRatio) / this.sampleRate;

    // Band-limit: cap the harmonic count so no partial exceeds Nyquist.
    // This is the key advantage of storing frames as Fourier coefficients
    // rather than raw PCM -- aliasing is prevented by simply not rendering
    // partials above sr/2, with zero additional cost.
    var nyquist = this.sampleRate * 0.5;
    this.maxHarmonic = Math.floor(nyquist / (freq * this.detuneRatio));
    if (this.maxHarmonic > HARMONICS_PER_FRAME) {
      this.maxHarmonic = HARMONICS_PER_FRAME;
    }
    if (this.maxHarmonic < 1) {
      this.maxHarmonic = 1;
    }

    // Scan parameters
    this.scanPosition = Math.max(0, Math.min(1, (settings.scanPosition || 0) / 100));
    this.currentScanPos = this.scanPosition;
    this.smoothedScanPos = this.scanPosition;
    this.scanLfoSpeed = settings.scanLfoSpeed || 0;
    this.scanLfoDepth = Math.max(0, Math.min(1, (settings.scanLfoDepth || 50) / 100));
    this.morphSmoothing = Math.max(0, Math.min(1, (settings.morphSmoothing || 50) / 100));

    // Bank
    var bankName = settings.bank || 'basic';
    this.frames = wavetableBanks[bankName] || wavetableBanks.basic;

    // Velocity with humanization
    var humVelocity = settings.humVelocity || 0;
    var velRange = Math.round(humVelocity * 1.2);
    var randomizedVel = vel;
    if (velRange > 0) {
      randomizedVel = vel + Math.round((Math.random() * 2 - 1) * velRange);
      if (randomizedVel < 1) { randomizedVel = 1; }
      if (randomizedVel > 127) { randomizedVel = 127; }
    }
    this.velocity = randomizedVel / 127;

    // Fade-in
    this.fadeInSamples = Math.ceil(this.sampleRate * 0.008);
    this.fadeInCounter = 0;

    // Timing stagger
    var humTiming = settings.humTiming || 0;
    if (humTiming > 0) {
      var maxDelay = Math.round(humTiming * 0.15 * this.sampleRate / 1000);
      this.startDelaySamples = Math.round(Math.random() * maxDelay);
    } else {
      this.startDelaySamples = 0;
    }

    // ADSR
    var adsr = settings.adsr || { a: 0.01, d: 0.1, s: 0.7, r: 0.2 };
    var humAdsr = settings.humAdsr || 0;
    var aTime = adsr.a;
    var dTime = adsr.d;
    var sLevel = adsr.s;
    var rTime = adsr.r;

    if (humAdsr > 0) {
      var jA = 1 + (Math.random() * 2 - 1) * humAdsr * 0.015;
      var jD = 1 + (Math.random() * 2 - 1) * humAdsr * 0.015;
      var jR = 1 + (Math.random() * 2 - 1) * humAdsr * 0.015;
      aTime = Math.max(0.001, aTime * jA);
      dTime = Math.max(0.001, dTime * jD);
      rTime = Math.max(0.001, rTime * jR);
    }

    this.attackRate = 1.0 / (aTime * this.sampleRate);
    this.decayRate = 1.0 / (dTime * this.sampleRate);
    this.sustainLevel = sLevel;
    this.releaseRate = 1.0 / (rTime * this.sampleRate);
  };

  WavetableVoice.prototype.noteOff = function() {
    if (!this.envFinished) {
      this.envReleased = true;
      this.envStage = 3;
    }
  };

  WavetableVoice.prototype.processEnvelope = function() {
    if (this.envFinished) {
      return 0;
    }

    if (this.envStage === 0) {
      this.envLevel += this.attackRate;
      if (this.envLevel >= 1.0) {
        this.envLevel = 1.0;
        this.envStage = 1;
      }
    } else if (this.envStage === 1) {
      this.envLevel -= this.decayRate * (1.0 - this.sustainLevel);
      if (this.envLevel <= this.sustainLevel) {
        this.envLevel = this.sustainLevel;
        this.envStage = 2;
      }
    } else if (this.envStage === 2) {
      // Sustain
    } else if (this.envStage === 3) {
      this.envLevel -= this.releaseRate * this.envLevel;
      if (this.envLevel <= 0.0001) {
        this.envLevel = 0;
        this.envFinished = true;
      }
    }

    return this.envLevel;
  };

  WavetableVoice.prototype.process = function() {
    if (!this.active) {
      return 0;
    }

    if (this.startDelaySamples > 0) {
      this.startDelaySamples--;
      return 0;
    }

    var env = this.processEnvelope();
    if (this.envFinished) {
      this.active = false;
      return 0;
    }

    // Update scan position with LFO modulation.
    // The LFO sweeps the scan position around the base value, creating
    // the characteristic evolving pad sound of wavetable synthesis.
    if (this.scanLfoSpeed > 0) {
      this.scanLfoPhase += this.scanLfoSpeed / this.sampleRate;
      if (this.scanLfoPhase >= 1.0) {
        this.scanLfoPhase -= Math.floor(this.scanLfoPhase);
      }
      var lfoVal = Math.sin(TWO_PI * this.scanLfoPhase);
      this.currentScanPos = this.scanPosition + lfoVal * this.scanLfoDepth * 0.5;
      if (this.currentScanPos < 0) { this.currentScanPos = 0; }
      if (this.currentScanPos > 1) { this.currentScanPos = 1; }
    } else {
      this.currentScanPos = this.scanPosition;
    }

    // Smooth the scan position via one-pole lowpass to prevent zipper
    // noise (audible staircase artifacts from abrupt position jumps).
    var smoothCoeff = 1.0 - this.morphSmoothing * 0.999;
    this.smoothedScanPos += (this.currentScanPos - this.smoothedScanPos) * smoothCoeff;

    // Render interpolated wavetable sample: blend between two adjacent
    // frames based on fractional scan position (linear crossfade).
    var sample = getInterpolatedSample(this.frames, this.smoothedScanPos, this.phase, this.maxHarmonic);

    // Advance oscillator phase
    this.phase += this.phaseInc;
    if (this.phase >= 1.0) {
      this.phase -= Math.floor(this.phase);
    }

    sample *= env * this.velocity;

    // Fade-in ramp
    if (this.fadeInCounter < this.fadeInSamples) {
      sample *= this.fadeInCounter / this.fadeInSamples;
      this.fadeInCounter++;
    }

    return sample;
  };

  WavetableVoice.prototype.isFinished = function() {
    return this.envFinished;
  };

  // ============================================================
  // Engine Initialization
  // ============================================================

  function init(ctx) {
    audioContext = ctx || (SL.audio && SL.audio.getCtx ? SL.audio.getCtx() : null);
    if (!audioContext) {
      console.error('[WAVETABLE-SYNTH] No AudioContext available');
      return Promise.reject(new Error('No AudioContext'));
    }

    // Build wavetable banks
    buildBanks();

    return initFallback();
  }

  function initFallback() {
    var sr = audioContext.sampleRate;
    var bufSize = (SL.audio && SL.audio.getScriptProcessorBufferSize) ? SL.audio.getScriptProcessorBufferSize() : 1024;

    for (var i = 0; i < 4; i++) {
      fallbackVoicesByInst[i].length = 0;
      for (var v = 0; v < MAX_VOICES_PER_INSTRUMENT; v++) {
        fallbackVoicesByInst[i].push(new WavetableVoice(sr));
      }
    }

    for (var idx = 0; idx < 4; idx++) {
      (function(instIdx) {
        var node = audioContext.createScriptProcessor(bufSize, 0, 1);
        var voices = fallbackVoicesByInst[instIdx];
        node.onaudioprocess = function(event) {
          var output = event.outputBuffer.getChannelData(0);

          // Update scan position from settings for active voices
          var settings = getOrCreateSettings(instIdx);
          var scanPos = Math.max(0, Math.min(1, (settings.scanPosition || 0) / 100));
          var scanLfoSpeed = settings.scanLfoSpeed || 0;
          var scanLfoDepth = Math.max(0, Math.min(1, (settings.scanLfoDepth || 50) / 100));
          var bankFrames = wavetableBanks[settings.bank] || wavetableBanks.basic;

          for (var vi = 0; vi < voices.length; vi++) {
            if (voices[vi].active) {
              voices[vi].scanPosition = scanPos;
              voices[vi].scanLfoSpeed = scanLfoSpeed;
              voices[vi].scanLfoDepth = scanLfoDepth;
              voices[vi].frames = bankFrames;
            }
          }

          for (var s = 0; s < output.length; s++) {
            var sample = 0;
            for (var vi2 = 0; vi2 < voices.length; vi2++) {
              if (voices[vi2].active) {
                sample += voices[vi2].process() * 0.12;
              }
            }
            // Smooth Pade approximant of tanh soft clip
            var ss = sample * sample;
            output[s] = sample * (27 + ss) / (27 + 9 * ss);
          }
        };
        scriptNodes[instIdx] = node;
      })(idx);
    }

    isEngineReady = true;
    return Promise.resolve(true);
  }

  // ============================================================
  // Connection Management
  // ============================================================

  function getOrCreateFilterNode(instId) {
    if (!audioContext) {
      return null;
    }
    if (!wtFilterNodes[instId]) {
      var node = audioContext.createBiquadFilter();
      node.type = 'lowpass';
      node.frequency.value = 20000;
      node.Q.value = 0.707;
      wtFilterNodes[instId] = node;
    }
    return wtFilterNodes[instId];
  }

  function updateFilter(instId) {
    if (instId === undefined) {
      instId = 0;
    }
    var filterNode = wtFilterNodes[instId];
    if (filterNode) {
      var filterSettings = SL.audio && SL.audio.getFilterSettings ? SL.audio.getFilterSettings() : null;
      if (!filterSettings || !filterSettings.enabled) {
        filterNode.type = 'lowpass';
        filterNode.frequency.value = 20000;
        filterNode.Q.value = 0.707;
      } else {
        filterNode.type = filterSettings.type || 'lowpass';
        filterNode.frequency.value = Math.max(20, Math.min(20000, filterSettings.frequency || 20000));
        filterNode.Q.value = Math.max(0.1, Math.min(30, filterSettings.resonance || 1));
      }
    }
  }

  function connectToOutput(instId) {
    if (scriptNodes[instId]) {
      if (connectedInsts[instId]) {
        updateFilter(instId);
      } else {
        var instruments = SL.audio && SL.audio.getInstruments ? SL.audio.getInstruments() : null;
        var inst = instruments ? instruments[instId] : null;
        var destination;

        if (inst && inst.masterOutput) {
          destination = inst.masterOutput;
        } else if (audioContext) {
          destination = audioContext.destination;
        }

        if (destination) {
          var filterNode = getOrCreateFilterNode(instId);
          updateFilter(instId);

          if (filterNode) {
            scriptNodes[instId].connect(filterNode);
            filterNode.connect(destination);
          } else {
            scriptNodes[instId].connect(destination);
          }

          connectedInsts[instId] = true;
        }
      }
    }
  }

  // ============================================================
  // Settings Management
  // ============================================================

  function getOrCreateSettings(instId) {
    if (!instrumentSettings[instId]) {
      instrumentSettings[instId] = JSON.parse(JSON.stringify(DEFAULT_WAVETABLE_SYNTH_SETTINGS));
    }
    return instrumentSettings[instId];
  }

  function getSettings(instId) {
    return JSON.parse(JSON.stringify(getOrCreateSettings(instId)));
  }

  function setSettings(instId, settings) {
    instrumentSettings[instId] = JSON.parse(JSON.stringify(settings));
  }

  function getDefaultSettings() {
    return JSON.parse(JSON.stringify(DEFAULT_WAVETABLE_SYNTH_SETTINGS));
  }

  // ============================================================
  // Note On / Off
  // ============================================================

  function noteOn(midi, velocity, instId) {
    if (instId === undefined) {
      instId = 0;
    }
    velocity = velocity || 100;

    var settings = getOrCreateSettings(instId);
    var noteFreq = midiToFreq(midi);

    connectToOutput(instId);

    // Read humanization
    var instruments = SL.audio.getInstruments();
    var rawHum = (instruments && instruments[instId]) ? (instruments[instId].settings.humanization || {}) : {};
    var humVelocity = (typeof rawHum === 'number') ? rawHum : (rawHum.velocity || 0);
    var humAdsr = (typeof rawHum === 'number') ? rawHum : (rawHum.adsr || 0);
    var humTiming = (typeof rawHum === 'number') ? 0 : (rawHum.timing || 0);

    // Get ADSR from instrument settings
    var instSettings = instruments[instId].settings;
    var adsrRaw = instSettings.adsr || { a: 10, d: 100, s: 70, r: 200 };
    var sliderToTime = SL.audio.sliderToTime;
    var adsr = {
      a: sliderToTime(adsrRaw.a, 500, 500) / 1000,
      d: sliderToTime(adsrRaw.d, 500, 500) / 1000,
      s: adsrRaw.s / 100,
      r: sliderToTime(adsrRaw.r, 1000, 1000) / 1000
    };

    var voiceSettings = {
      instId: instId,
      bank: settings.bank,
      scanPosition: settings.scanPosition,
      scanLfoSpeed: settings.scanLfoSpeed,
      scanLfoDepth: settings.scanLfoDepth,
      detune: settings.detune,
      morphSmoothing: settings.morphSmoothing,
      adsr: adsr,
      humVelocity: humVelocity,
      humAdsr: humAdsr,
      humTiming: humTiming
    };

    // Find free voice or steal oldest
    var voices = fallbackVoicesByInst[instId];
    var voice = null;
    for (var i = 0; i < voices.length; i++) {
      if (!voices[i].active) {
        voice = voices[i];
        break;
      }
    }
    if (!voice) {
      voice = voices[0];
    }
    voice.noteOn(midi, velocity, noteFreq, voiceSettings);
  }

  function noteOff(midi, instId) {
    if (instId === undefined) {
      instId = 0;
    }

    var voices = fallbackVoicesByInst[instId];
    for (var i = 0; i < voices.length; i++) {
      var v = voices[i];
      if (v.active && v.midiNote === midi) {
        v.noteOff();
      }
    }
  }

  // ============================================================
  // Parameter Control
  // ============================================================

  function setBank(instId, bank) {
    var settings = getOrCreateSettings(instId);
    if (wavetableBanks[bank]) {
      settings.bank = bank;
    }
  }

  function setScanPosition(instId, position) {
    var settings = getOrCreateSettings(instId);
    settings.scanPosition = Math.max(0, Math.min(100, position));
  }

  function setScanLfoSpeed(instId, speed) {
    var settings = getOrCreateSettings(instId);
    settings.scanLfoSpeed = Math.max(0, Math.min(20, speed));
  }

  function setScanLfoDepth(instId, depth) {
    var settings = getOrCreateSettings(instId);
    settings.scanLfoDepth = Math.max(0, Math.min(100, depth));
  }

  function setDetune(instId, cents) {
    var settings = getOrCreateSettings(instId);
    settings.detune = Math.max(-100, Math.min(100, cents));
  }

  function setMorphSmoothing(instId, value) {
    var settings = getOrCreateSettings(instId);
    settings.morphSmoothing = Math.max(0, Math.min(100, value));
  }

  // ============================================================
  // Utility
  // ============================================================

  function allNotesOff(instId) {
    if (instId !== undefined) {
      var voices = fallbackVoicesByInst[instId];
      for (var i = 0; i < voices.length; i++) {
        if (voices[i].active) {
          voices[i].noteOff();
        }
      }
    } else {
      for (var idx = 0; idx < 4; idx++) {
        var pool = fallbackVoicesByInst[idx];
        for (var j = 0; j < pool.length; j++) {
          if (pool[j].active) {
            pool[j].noteOff();
          }
        }
      }
    }
  }

  function isReady() {
    return isEngineReady;
  }

  function getBankNames() {
    var names = [];
    for (var key in wavetableBanks) {
      if (wavetableBanks.hasOwnProperty(key)) {
        names.push(key);
      }
    }
    return names;
  }

  // ============================================================
  // Export to SynthLab Namespace
  // ============================================================

  SL.wavetableSynth = {
    // Initialization
    init: init,
    isReady: isReady,

    // Note control
    noteOn: noteOn,
    noteOff: noteOff,
    allNotesOff: allNotesOff,

    // Parameter control
    setBank: setBank,
    setScanPosition: setScanPosition,
    setScanLfoSpeed: setScanLfoSpeed,
    setScanLfoDepth: setScanLfoDepth,
    setDetune: setDetune,
    setMorphSmoothing: setMorphSmoothing,

    // Settings management
    getSettings: getSettings,
    setSettings: setSettings,
    getDefaultSettings: getDefaultSettings,

    // Connection & filter
    connectToOutput: connectToOutput,
    updateFilter: updateFilter,

    // Utility
    getBankNames: getBankNames,

    // Constants
    DEFAULT_WAVETABLE_SYNTH_SETTINGS: DEFAULT_WAVETABLE_SYNTH_SETTINGS,
    MAX_VOICES_PER_INSTRUMENT: MAX_VOICES_PER_INSTRUMENT,
    FRAMES_PER_TABLE: FRAMES_PER_TABLE,
    HARMONICS_PER_FRAME: HARMONICS_PER_FRAME
  };

})();
