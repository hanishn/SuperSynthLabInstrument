// Super Synth Lab - Formant Oscillator Synthesis Engine Module
// Generates vowel/vocal sounds directly from parameters using parallel bandpass
// filters tuned to vocal tract resonances. Fully generative (no external audio input).
// v1.0.0 - ScriptProcessor, 5-formant model, vowel morphing, sequence, breathiness
(function() {
  'use strict';

  var SL = window.SynthLab;

  // ============================================================
  // Constants
  // ============================================================

  var MAX_VOICES_PER_INSTRUMENT = 16;
  var NUM_FORMANTS = 5;
  var TWO_PI = 2 * Math.PI;

  // ============================================================
  // Vowel Formant Data (research-accurate)
  // Frequencies (Hz), amplitudes (linear), bandwidths (Hz)
  // Based on Peterson & Barney (1952) and Hillenbrand et al. (1995)
  // F1-F5 for male vocal tract model
  // ============================================================

  var VOWEL_DATA = {
    A: {
      freqs: [730, 1090, 2440, 3400, 4500],
      amps:  [1.0, 0.50, 0.30, 0.10, 0.05],
      bws:   [90, 110, 170, 250, 300]
    },
    E: {
      freqs: [530, 1840, 2480, 3400, 4500],
      amps:  [1.0, 0.40, 0.30, 0.12, 0.05],
      bws:   [70, 100, 160, 250, 300]
    },
    I: {
      freqs: [270, 2290, 3010, 3400, 4500],
      amps:  [1.0, 0.30, 0.20, 0.10, 0.04],
      bws:   [60, 90, 150, 250, 300]
    },
    O: {
      freqs: [570, 840, 2410, 3400, 4500],
      amps:  [1.0, 0.40, 0.25, 0.10, 0.05],
      bws:   [80, 100, 160, 250, 300]
    },
    U: {
      freqs: [300, 870, 2240, 3400, 4500],
      amps:  [1.0, 0.30, 0.20, 0.08, 0.04],
      bws:   [70, 100, 150, 250, 300]
    },
    AE: {
      freqs: [660, 1720, 2410, 3400, 4500],
      amps:  [1.0, 0.45, 0.28, 0.11, 0.05],
      bws:   [80, 105, 165, 250, 300]
    },
    UH: {
      freqs: [640, 1190, 2390, 3400, 4500],
      amps:  [1.0, 0.45, 0.25, 0.10, 0.05],
      bws:   [80, 105, 160, 250, 300]
    },
    OO: {
      freqs: [440, 1020, 2240, 3400, 4500],
      amps:  [1.0, 0.35, 0.22, 0.09, 0.04],
      bws:   [75, 100, 155, 250, 300]
    }
  };

  var VOWEL_ORDER = ['A', 'E', 'I', 'O', 'U', 'AE', 'UH', 'OO'];

  // ============================================================
  // Default Settings
  // ============================================================

  var DEFAULT_FORMANT_SETTINGS = {
    vowel: 'A',
    vowelTarget: 'E',
    morphX: 0,
    formantShift: 0,
    breathiness: 20,
    glottalPulseWidth: 50,
    vowelSequence: ['A', 'E', 'I', 'O', 'U'],
    vowelSequenceEnabled: false,
    vowelSequenceRate: 2.0
  };

  // ============================================================
  // State
  // ============================================================

  var audioContext = null;
  var isEngineReady = false;

  // AudioWorklet state
  var isWorkletReady = false;
  var isWorkletInitializing = false;
  var isWorkletReadyPromise = null;
  var formantWorkletNodes = [null, null, null, null];
  var shouldUseFallback = false;

  // ScriptProcessor fallback state
  var scriptNodes = [null, null, null, null];
  var fallbackVoicesByInst = [[], [], [], []];
  var instrumentSettings = {};
  var formantFilterNodes = {};
  var connectedInsts = [false, false, false, false];

  // Per-instrument smoothed voice scale (persistent across blocks)
  var VOICE_SCALE_SMOOTHING = 0.05; // exponential smoothing coefficient (~20ms convergence at 44100/128)
  var smoothedVoiceScale = [1.0, 1.0, 1.0, 1.0];

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
  // Formant Interpolation
  // ============================================================

  /**
   * Interpolate between two vowels and apply formant shift.
   * @param {string} vowelA - source vowel key
   * @param {string} vowelB - target vowel key
   * @param {number} morphX - 0..100 interpolation amount
   * @param {number} formantShift - semitone shift (-12..+12)
   * @returns {Object} { freqs:[], amps:[], bws:[] } arrays of length NUM_FORMANTS
   */
  function interpolateFormants(vowelA, vowelB, morphX, formantShift) {
    var dataA = VOWEL_DATA[vowelA] || VOWEL_DATA.A;
    var dataB = VOWEL_DATA[vowelB] || VOWEL_DATA.E;
    var t = Math.max(0, Math.min(1, morphX / 100));
    var shiftRatio = Math.pow(2, formantShift / 12);

    var freqs = [];
    var amps = [];
    var bws = [];
    for (var i = 0; i < NUM_FORMANTS; i++) {
      // Log-space interpolation for frequencies (perceptually linear)
      var logA = Math.log(dataA.freqs[i]);
      var logB = Math.log(dataB.freqs[i]);
      freqs.push(Math.exp(logA + (logB - logA) * t) * shiftRatio);
      amps.push(dataA.amps[i] + (dataB.amps[i] - dataA.amps[i]) * t);
      bws.push(dataA.bws[i] + (dataB.bws[i] - dataA.bws[i]) * t);
    }

    return { freqs: freqs, amps: amps, bws: bws };
  }

  // ============================================================
  // Resonant Bandpass Filter (2nd-order biquad, direct form II)
  // ============================================================

  function BiquadBPF() {
    this.b0 = 0; this.b1 = 0; this.b2 = 0;
    this.a1 = 0; this.a2 = 0;
    this.z1 = 0; this.z2 = 0;
  }

  /**
   * Set bandpass filter coefficients.
   * @param {number} freq - center frequency (Hz)
   * @param {number} bw - bandwidth (Hz)
   * @param {number} sr - sample rate
   */
  BiquadBPF.prototype.set = function(freq, bw, sr) {
    // Clamp frequency to Nyquist - margin
    var nyq = sr * 0.499;
    if (freq > nyq) { freq = nyq; }
    if (freq < 20) { freq = 20; }
    if (bw < 10) { bw = 10; }

    var w0 = TWO_PI * freq / sr;
    var cosW0 = Math.cos(w0);
    var sinW0 = Math.sin(w0);
    var alpha = sinW0 * Math.sinh(Math.log(2) / 2 * (bw / freq) * (w0 / sinW0));

    var a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.b1 = 0;
    this.b2 = -alpha / a0;
    this.a1 = -2 * cosW0 / a0;
    this.a2 = (1 - alpha) / a0;
  };

  BiquadBPF.prototype.process = function(input) {
    var out = this.b0 * input + this.z1;
    this.z1 = this.b1 * input - this.a1 * out + this.z2;
    this.z2 = this.b2 * input - this.a2 * out;
    return out;
  };

  BiquadBPF.prototype.reset = function() {
    this.z1 = 0;
    this.z2 = 0;
  };

  // ============================================================
  // Formant Voice
  // ============================================================

  function FormantVoice(sr) {
    this.sampleRate = sr;
    this.active = false;
    this.midiNote = -1;
    this.instId = 0;
    this.baseFreq = 440;
    this.velocity = 1.0;

    // Glottal pulse excitation
    this.glottalPhase = 0;
    this.glottalPulseWidth = 0.5; // 0..1 (duty cycle)

    // Noise excitation (breathiness)
    this.breathiness = 0.2; // 0..1

    // 5 bandpass filters (formants F1-F5)
    this.filters = [];
    this.formantAmps = new Float64Array(NUM_FORMANTS);
    for (var i = 0; i < NUM_FORMANTS; i++) {
      this.filters.push(new BiquadBPF());
      this.formantAmps[i] = 0;
    }

    // ADSR envelope state
    this.envStage = 0;
    this.envLevel = 0;
    this.envReleased = false;
    this.envFinished = false;
    this.attackRate = 0;
    this.decayRate = 0;
    this.sustainLevel = 0.7;
    this.releaseRate = 0;

    // Fade-in ramp to prevent click at note onset
    this.fadeInSamples = 0;
    this.fadeInCounter = 0;

    // Per-voice timing stagger (humanization)
    this.startDelaySamples = 0;
  }

  /**
   * Configure the formant filters for the current vowel parameters.
   * @param {Object} formants - { freqs:[], amps:[], bws:[] }
   */
  FormantVoice.prototype.setFormants = function(formants) {
    for (var i = 0; i < NUM_FORMANTS; i++) {
      this.filters[i].set(formants.freqs[i], formants.bws[i], this.sampleRate);
      this.formantAmps[i] = formants.amps[i];
    }
  };

  FormantVoice.prototype.noteOn = function(midi, vel, freq, settings) {
    this.active = true;
    this.midiNote = midi;
    this.baseFreq = freq;
    this.instId = settings.instId || 0;
    this.envStage = 0;
    this.envLevel = 0;
    this.envReleased = false;
    this.envFinished = false;
    this.glottalPhase = 0;

    // Breathiness and pulse width
    this.breathiness = Math.max(0, Math.min(1, (settings.breathiness || 0) / 100));
    this.glottalPulseWidth = Math.max(0.1, Math.min(0.9, (settings.glottalPulseWidth || 50) / 100));

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

    // Short amplitude fade-in (~8ms)
    this.fadeInSamples = Math.ceil(this.sampleRate * 0.008);
    this.fadeInCounter = 0;

    // Per-voice timing stagger
    var humTiming = settings.humTiming || 0;
    if (humTiming > 0) {
      var maxDelay = Math.round(humTiming * 0.15 * this.sampleRate / 1000);
      this.startDelaySamples = Math.round(Math.random() * maxDelay);
    } else {
      this.startDelaySamples = 0;
    }

    // ADSR from settings
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

    var safeAttack = Math.max(0.001, aTime);
    var safeDecay = Math.max(0.001, dTime);
    var safeRelease = Math.max(0.001, rTime);
    this.attackRate = 1.0 / (safeAttack * this.sampleRate);
    this.decayRate = 1.0 / (safeDecay * this.sampleRate);
    this.sustainLevel = sLevel;
    this.releaseRate = 1.0 / (safeRelease * this.sampleRate);

    // Set formant filters from interpolated vowel data
    var formants = interpolateFormants(
      settings.vowel || 'A',
      settings.vowelTarget || 'E',
      settings.morphX || 0,
      settings.formantShift || 0
    );
    this.setFormants(formants);

    // Reset filter state to prevent clicks from previous note residue
    for (var i = 0; i < NUM_FORMANTS; i++) {
      this.filters[i].reset();
    }
  };

  FormantVoice.prototype.noteOff = function() {
    if (!this.envFinished) {
      this.envReleased = true;
      this.envStage = 3;
    }
  };

  FormantVoice.prototype.processEnvelope = function() {
    if (this.envFinished) {
      return 0;
    }

    if (this.envStage === 0) {
      // Attack
      this.envLevel += this.attackRate;
      if (this.envLevel >= 1.0) {
        this.envLevel = 1.0;
        this.envStage = 1;
      }
    } else if (this.envStage === 1) {
      // Decay
      this.envLevel -= this.decayRate * (1.0 - this.sustainLevel);
      if (this.envLevel <= this.sustainLevel) {
        this.envLevel = this.sustainLevel;
        this.envStage = 2;
      }
    } else if (this.envStage === 2) {
      // Sustain (hold level)
    } else if (this.envStage === 3) {
      // Release
      this.envLevel -= this.releaseRate * this.envLevel;
      if (this.envLevel <= 0.0001) {
        this.envLevel = 0;
        this.envFinished = true;
      }
    }

    return this.envLevel;
  };

  FormantVoice.prototype.process = function() {
    if (!this.active) {
      return 0;
    }

    // Per-voice timing stagger: output silence during delay period
    if (this.startDelaySamples > 0) {
      this.startDelaySamples--;
      return 0;
    }

    var env = this.processEnvelope();
    if (this.envFinished) {
      this.active = false;
      return 0;
    }

    // --- Generate glottal pulse excitation ---
    // Rosenberg model approximation: a pulse train with variable duty cycle
    var phaseInc = this.baseFreq / this.sampleRate;
    this.glottalPhase += phaseInc;
    if (this.glottalPhase >= 1.0) {
      this.glottalPhase -= Math.floor(this.glottalPhase);
    }

    var glottalSample = 0;
    var pw = this.glottalPulseWidth;
    if (this.glottalPhase < pw) {
      // Open phase: half-sine pulse
      var openPhase = this.glottalPhase / pw;
      glottalSample = Math.sin(Math.PI * openPhase);
    }
    // Closed phase: output = 0 (already initialized)

    // --- Generate noise excitation ---
    var noiseSample = (Math.random() * 2 - 1) * 0.5;

    // --- Mix glottal pulse and noise based on breathiness ---
    var excitation = glottalSample * (1 - this.breathiness) + noiseSample * this.breathiness;

    // --- Pass excitation through parallel formant filters ---
    var sample = 0;
    for (var i = 0; i < NUM_FORMANTS; i++) {
      sample += this.filters[i].process(excitation) * this.formantAmps[i];
    }

    // Normalize: 5 parallel filters can sum high
    // Raised to 1.0 — narrow bandpass filters lose significant energy,
    // previous value of 0.85 contributed to ~17dB volume deficit vs other surfaces
    sample *= 1.0;

    sample *= env * this.velocity;

    // Apply fade-in ramp
    if (this.fadeInCounter < this.fadeInSamples) {
      sample *= this.fadeInCounter / this.fadeInSamples;
      this.fadeInCounter++;
    }

    return sample;
  };

  FormantVoice.prototype.isFinished = function() {
    return this.envFinished;
  };

  // ============================================================
  // Engine Initialization
  // ============================================================

  function init(ctx) {
    audioContext = ctx || (SL.audio && SL.audio.getCtx ? SL.audio.getCtx() : null);
    if (!audioContext) {
      console.error('[FORMANT] No AudioContext available');
      return Promise.reject(new Error('No AudioContext'));
    }

    // Always use ScriptProcessor — synchronous, immediate, reliable.
    // AudioWorklet async loading causes notes to be silently dropped.

    // Fallback to ScriptProcessorNode
    console.warn('[FORMANT] AudioWorklet not supported, using ScriptProcessor fallback');
    return initFallback();
  }

  function initWorklet() {
    if (isWorkletReady) { return Promise.resolve(true); }
    if (isWorkletInitializing) { return isWorkletReadyPromise; }

    isWorkletInitializing = true;

    isWorkletReadyPromise = new Promise(function(resolve, reject) {
      var formantWorkletUrl = (SL.audio.getWorkletBlobUrl && SL.audio.getWorkletBlobUrl('formant-worklet.js')) || 'assets/formant-worklet.js';
      audioContext.audioWorklet.addModule(formantWorkletUrl).then(function() {
        var readyCount = 0;
        var hasHadError = false;

        for (var i = 0; i < 4; i++) {
          (function(idx) {
            var node = new AudioWorkletNode(audioContext, 'formant-processor', {
              numberOfInputs: 0,
              numberOfOutputs: 1,
              outputChannelCount: [1]
            });
            formantWorkletNodes[idx] = node;

            node.port.onmessage = function(event) {
              if (event.data.type === 'ready') {
                readyCount++;
                if (readyCount === 4) {
                  isWorkletReady = true;
                  isWorkletInitializing = false;
                  isEngineReady = true;
                  resolve(true);
                }
              }
            };

            node.onprocessorerror = function(event) {
              if (!hasHadError) {
                hasHadError = true;
                console.error('[FORMANT] AudioWorklet processor error (inst ' + idx + '):', event);
                isWorkletReady = false;
                isWorkletInitializing = false;
                console.warn('[FORMANT] Falling back to ScriptProcessor');
                initFallback().then(resolve).catch(reject);
              }
            };
          })(i);
        }

      }).catch(function(error) {
        console.error('[FORMANT] Failed to load formant worklet:', error);
        isWorkletInitializing = false;
        console.warn('[FORMANT] Falling back to ScriptProcessor');
        initFallback().then(resolve).catch(reject);
      });
    });

    return isWorkletReadyPromise;
  }

  function initFallback() {
    shouldUseFallback = true;
    var sr = audioContext.sampleRate;
    var bufSize = (SL.audio && SL.audio.getScriptProcessorBufferSize) ? SL.audio.getScriptProcessorBufferSize() : 1024;

    // Pre-allocate per-instrument voice pools (16 voices each)
    for (var i = 0; i < 4; i++) {
      fallbackVoicesByInst[i].length = 0;
      for (var v = 0; v < MAX_VOICES_PER_INSTRUMENT; v++) {
        fallbackVoicesByInst[i].push(new FormantVoice(sr));
      }
    }

    // Create 4 per-instrument ScriptProcessor nodes
    for (var idx = 0; idx < 4; idx++) {
      (function(instIdx) {
        var node = audioContext.createScriptProcessor(bufSize, 0, 1);
        var voices = fallbackVoicesByInst[instIdx];
        node.onaudioprocess = function(event) {
          var output = event.outputBuffer.getChannelData(0);

          // Update formants for active voices if settings changed
          var settings = getOrCreateSettings(instIdx);
          var formants = interpolateFormants(
            settings.vowel,
            settings.vowelTarget,
            settings.morphX,
            settings.formantShift
          );

          // Handle vowel sequence auto-cycling
          var hasVowelSequence = settings.vowelSequence && settings.vowelSequence.length > 1;
          var shouldCycleVowels = settings.vowelSequenceEnabled && hasVowelSequence;
          if (shouldCycleVowels) {
            var seqLen = settings.vowelSequence.length;
            var samplesPerVowel = Math.max(1, Math.round(audioContext.sampleRate / settings.vowelSequenceRate));
            if (!settings._seqCounter) { settings._seqCounter = 0; }
            if (!settings._seqIndex) { settings._seqIndex = 0; }
            settings._seqCounter += output.length;
            if (settings._seqCounter >= samplesPerVowel) {
              settings._seqCounter -= samplesPerVowel;
              settings._seqIndex = (settings._seqIndex + 1) % seqLen;
              settings.vowel = settings.vowelSequence[settings._seqIndex];
              settings.vowelTarget = settings.vowelSequence[(settings._seqIndex + 1) % seqLen];
              // Recalculate formants with updated vowels
              formants = interpolateFormants(
                settings.vowel,
                settings.vowelTarget,
                settings.morphX,
                settings.formantShift
              );
            }
          }

          // Update formant filters on active voices
          for (var vi = 0; vi < voices.length; vi++) {
            if (voices[vi].active) {
              voices[vi].setFormants(formants);
              voices[vi].breathiness = Math.max(0, Math.min(1, (settings.breathiness || 0) / 100));
              voices[vi].glottalPulseWidth = Math.max(0.1, Math.min(0.9, (settings.glottalPulseWidth || 50) / 100));
            }
          }

          // Count active voices for scaling
          var activeVoiceCount = 0;
          for (var vi2 = 0; vi2 < voices.length; vi2++) {
            if (voices[vi2].active) {
              activeVoiceCount++;
            }
          }
          // Per-voice scaling: smoothed to prevent audible volume dips when
          // voices are added/removed. Exponential smoothing converges in ~20ms
          // at 44100/128 block size.
          var targetScale = 1.0 / Math.sqrt(Math.max(1, activeVoiceCount));
          smoothedVoiceScale[instIdx] += (targetScale - smoothedVoiceScale[instIdx]) * VOICE_SCALE_SMOOTHING;
          var voiceScale = smoothedVoiceScale[instIdx];

          // Post-clipper makeup gain to bring formant output to parity with
          // other surfaces (~-37 to -42 dB). This gain is applied INSIDE the
          // ScriptProcessor so it bypasses the audio engine's 2.0 gain clamp.
          var FORMANT_MAKEUP_GAIN = 3.5;

          for (var s = 0; s < output.length; s++) {
            var sample = 0;
            for (var vi3 = 0; vi3 < voices.length; vi3++) {
              if (voices[vi3].active) {
                sample += voices[vi3].process() * voiceScale;
              }
            }
            // Soft clip only when signal is hot enough to need it (> 0.8).
            // Below that threshold, pass through unmodified to preserve dynamics.
            // This prevents the Pade tanh from compressing quiet single-voice output.
            var absSample = (sample < 0) ? -sample : sample;
            if (absSample > 0.8) {
              // Pade approximant of tanh for smooth limiting
              var ss = sample * sample;
              sample = sample * (27 + ss) / (27 + 9 * ss);
            }
            output[s] = sample * FORMANT_MAKEUP_GAIN;
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
    if (!formantFilterNodes[instId]) {
      var node = audioContext.createBiquadFilter();
      node.type = 'lowpass';
      node.frequency.value = 20000;
      node.Q.value = 0.707;
      formantFilterNodes[instId] = node;
    }
    return formantFilterNodes[instId];
  }

  function updateFilter(instId) {
    if (instId === undefined) {
      instId = 0;
    }
    var filterNode = formantFilterNodes[instId];
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
    // Check if we have a node to connect
    var nodeExists = (shouldUseFallback && scriptNodes[instId]) || (!shouldUseFallback && formantWorkletNodes[instId]);
    if (nodeExists) {
      if (connectedInsts[instId]) {
        updateFilter(instId);
      } else {
        var instruments = SL.audio && SL.audio.getInstruments ? SL.audio.getInstruments() : null;
        var inst = instruments ? instruments[instId] : null;
        var destination;
        var isDestinationResolved = false;

        if (inst && inst.masterOutput) {
          destination = inst.masterOutput;
          isDestinationResolved = true;
        } else if (audioContext) {
          destination = audioContext.destination;
          isDestinationResolved = true;
        }

        if (isDestinationResolved) {
          var filterNode = getOrCreateFilterNode(instId);
          updateFilter(instId);

          if (shouldUseFallback && scriptNodes[instId]) {
            if (filterNode) {
              scriptNodes[instId].connect(filterNode);
              filterNode.connect(destination);
            } else {
              scriptNodes[instId].connect(destination);
            }
          } else if (formantWorkletNodes[instId]) {
            if (filterNode) {
              formantWorkletNodes[instId].connect(filterNode);
              filterNode.connect(destination);
            } else {
              formantWorkletNodes[instId].connect(destination);
            }
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
      instrumentSettings[instId] = JSON.parse(JSON.stringify(DEFAULT_FORMANT_SETTINGS));
    }
    return instrumentSettings[instId];
  }

  function getSettings(instId) {
    return JSON.parse(JSON.stringify(getOrCreateSettings(instId)));
  }

  function setSettings(instId, settings) {
    instrumentSettings[instId] = JSON.parse(JSON.stringify(settings));
    sendSettingsToWorklet(instId);
  }

  // ============================================================
  // Note On / Off
  // ============================================================

  function noteOn(midi, velocity, instId) {
    if (instId === undefined) {
      instId = 0;
    }
    velocity = velocity || 100;

    // Lazy init: if engine was never initialized, do it now
    var isEngineUnstarted2 = !isEngineReady && !isWorkletReady;
    var canLazyInit2 = isEngineUnstarted2 && !isWorkletInitializing && !shouldUseFallback;
    if (canLazyInit2) {
      init();
    }

    var settings = getOrCreateSettings(instId);

    var noteFreq = midiToFreq(midi);

    // Ensure connected to correct instrument output
    connectToOutput(instId);

    // Read humanization amounts
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
      vowel: settings.vowel,
      vowelTarget: settings.vowelTarget,
      morphX: settings.morphX,
      formantShift: settings.formantShift,
      breathiness: settings.breathiness,
      glottalPulseWidth: settings.glottalPulseWidth,
      adsr: adsr,
      humVelocity: humVelocity,
      humAdsr: humAdsr,
      humTiming: humTiming
    };

    if (shouldUseFallback) {
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
        voice = voices[0]; // steal oldest
      }
      voice.noteOn(midi, velocity, noteFreq, voiceSettings);
    } else if (formantWorkletNodes[instId] && isWorkletReady) {
      formantWorkletNodes[instId].port.postMessage({
        type: 'noteOn',
        midiNote: midi,
        velocity: velocity,
        noteFreq: noteFreq,
        settings: voiceSettings
      });
    }
  }

  function noteOff(midi, instId) {
    if (instId === undefined) {
      instId = 0;
    }

    if (shouldUseFallback) {
      var voices = fallbackVoicesByInst[instId];
      for (var i = 0; i < voices.length; i++) {
        var v = voices[i];
        if (v.active && v.midiNote === midi) {
          v.noteOff();
        }
      }
    } else if (formantWorkletNodes[instId] && isWorkletReady) {
      formantWorkletNodes[instId].port.postMessage({
        type: 'noteOff',
        midiNote: midi
      });
    }
  }

  // ============================================================
  // Parameter Control
  // ============================================================

  function sendSettingsToWorklet(instId) {
    if (formantWorkletNodes[instId] && isWorkletReady) {
      var settings = getOrCreateSettings(instId);
      formantWorkletNodes[instId].port.postMessage({
        type: 'updateSettings',
        vowel: settings.vowel,
        vowelTarget: settings.vowelTarget,
        morphX: settings.morphX,
        formantShift: settings.formantShift,
        breathiness: settings.breathiness,
        glottalPulseWidth: settings.glottalPulseWidth,
        vowelSequenceEnabled: settings.vowelSequenceEnabled,
        vowelSequence: settings.vowelSequence,
        vowelSequenceRate: settings.vowelSequenceRate
      });
    }
  }

  function setVowel(instId, vowel) {
    var settings = getOrCreateSettings(instId);
    if (VOWEL_DATA[vowel]) {
      settings.vowel = vowel;
    }
    sendSettingsToWorklet(instId);
  }

  function setMorphPosition(instId, morphX) {
    var settings = getOrCreateSettings(instId);
    settings.morphX = Math.max(0, Math.min(100, morphX));
    sendSettingsToWorklet(instId);
  }

  function setFormantShift(instId, semitones) {
    var settings = getOrCreateSettings(instId);
    settings.formantShift = Math.max(-12, Math.min(12, semitones));
    sendSettingsToWorklet(instId);
  }

  function setBreathiness(instId, value) {
    var settings = getOrCreateSettings(instId);
    settings.breathiness = Math.max(0, Math.min(100, value));
    sendSettingsToWorklet(instId);
  }

  function setGlottalPulseWidth(instId, value) {
    var settings = getOrCreateSettings(instId);
    settings.glottalPulseWidth = Math.max(10, Math.min(90, value));
    sendSettingsToWorklet(instId);
  }

  /**
   * Inject a custom vowel entry into VOWEL_DATA so that setVowel('_CUSTOM')
   * can reference arbitrary formant frequencies computed by the voice screen.
   * @param {Object} data - { freqs:[], amps:[], bws:[] } arrays of length NUM_FORMANTS
   */
  function _makeVowelDataMsg(data) {
    return { freqs: data.freqs.slice(), amps: data.amps.slice(), bws: data.bws.slice() };
  }

  function setCustomVowelData(data) {
    var hasFreqs = data && data.freqs;
    var hasCompleteVowelData = hasFreqs && data.amps && data.bws;
    if (hasCompleteVowelData) {
      VOWEL_DATA['_CUSTOM'] = {
        freqs: data.freqs.slice(),
        amps: data.amps.slice(),
        bws: data.bws.slice()
      };
      // Forward to all worklet instances
      if (!shouldUseFallback && isWorkletReady) {
        var vowelMsg = { type: 'setCustomVowelData', vowelData: _makeVowelDataMsg(data) };
        for (var i = 0; i < 4; i++) {
          if (formantWorkletNodes[i]) {
            formantWorkletNodes[i].port.postMessage(vowelMsg);
          }
        }
      }
    }
  }

  // ============================================================
  // Utility
  // ============================================================

  function allNotesOff(instId) {
    if (shouldUseFallback) {
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
    } else if (isWorkletReady) {
      if (instId !== undefined) {
        if (formantWorkletNodes[instId]) {
          formantWorkletNodes[instId].port.postMessage({ type: 'allNotesOff' });
        }
      } else {
        for (var n = 0; n < 4; n++) {
          if (formantWorkletNodes[n]) {
            formantWorkletNodes[n].port.postMessage({ type: 'allNotesOff' });
          }
        }
      }
    }
  }

  function isReady() {
    return isWorkletReady || isEngineReady;
  }

  function getDefaultSettings() {
    return JSON.parse(JSON.stringify(DEFAULT_FORMANT_SETTINGS));
  }

  // ============================================================
  // Export to SynthLab Namespace
  // ============================================================

  SL.formant = {
    // Initialization
    init: init,
    isReady: isReady,

    // Note control
    noteOn: noteOn,
    noteOff: noteOff,
    allNotesOff: allNotesOff,

    // Parameter control
    setVowel: setVowel,
    setMorphPosition: setMorphPosition,
    setFormantShift: setFormantShift,
    setBreathiness: setBreathiness,
    setGlottalPulseWidth: setGlottalPulseWidth,
    setCustomVowelData: setCustomVowelData,

    // Settings management
    getSettings: getSettings,
    setSettings: setSettings,
    getDefaultSettings: getDefaultSettings,

    // Connection & filter
    connectToOutput: connectToOutput,
    updateFilter: updateFilter,

    // Constants
    DEFAULT_FORMANT_SETTINGS: DEFAULT_FORMANT_SETTINGS,
    MAX_VOICES_PER_INSTRUMENT: MAX_VOICES_PER_INSTRUMENT,
    NUM_FORMANTS: NUM_FORMANTS,
    VOWEL_DATA: VOWEL_DATA,
    VOWEL_ORDER: VOWEL_ORDER
  };

})();
