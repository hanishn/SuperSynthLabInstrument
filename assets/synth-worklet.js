// Super Synth Lab - AudioWorklet Processor
// High-performance synthesis running on dedicated audio thread
// v1.6 - Optimized: pre-computed freq multipliers, integer wave codes, module-level sine table, active voice compaction

// === Module-level constants (Change 3: Integer wave codes) ===
var WAVE_SINE = 0, WAVE_SAW = 1, WAVE_SQUARE = 2, WAVE_TRI = 3, WAVE_PULSE = 4, WAVE_SUPERSAW = 5;

// === Module-level sine table (Change 4) ===
var SINE_TABLE_SIZE = 4096;
var SINE_TABLE = new Float64Array(SINE_TABLE_SIZE);
var TWO_PI = 2 * Math.PI;
var SINE_TABLE_MASK = SINE_TABLE_SIZE - 1;
(function() {
    for (var i = 0; i < SINE_TABLE_SIZE; i++) {
        SINE_TABLE[i] = Math.sin(TWO_PI * i / SINE_TABLE_SIZE);
    }
})();

/**
 * SynthWorkletProcessor - Runs on the audio rendering thread
 * Handles all synthesis computations off the main thread
 */
class SynthWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // Voice management
    this.maxVoices = 64;
    this.voices = [];
    this.voiceIdCounter = 0;

    // Glide: track last played frequency per instrument (for legato glide)
    this.lastFrequency = [0, 0, 0, 0];
    // Track whether there's an active (non-released) voice per instrument
    this.hasActiveVoice = [false, false, false, false];

    // Initialize voice pool
    for (var i = 0; i < this.maxVoices; i++) {
      this.voices.push(this.createVoice());
    }

    // Global settings
    this.sampleRate = sampleRate; // Global variable in AudioWorklet scope

    // Active voice index compaction (Change 5)
    this.activeVoiceIndices = [];

    // Message handling from main thread
    this.port.onmessage = this.handleMessage.bind(this);

    // Report ready status
    this.port.postMessage({ type: 'ready' });
  }

  /**
   * Fast sine approximation using lookup table with linear interpolation
   * Uses module-level SINE_TABLE (Change 4)
   */
  fastSin(phase) {
    // Wrap phase to [0, 2*PI)
    phase = phase % TWO_PI;
    if (phase < 0) phase += TWO_PI;

    // Convert radians to table index
    var indexFloat = (phase / TWO_PI) * SINE_TABLE_SIZE;
    var i0 = indexFloat | 0;
    var index0 = i0 & SINE_TABLE_MASK;
    var index1 = (i0 + 1) & SINE_TABLE_MASK;
    var frac = indexFloat - i0;

    // Linear interpolation
    return SINE_TABLE[index0] + (SINE_TABLE[index1] - SINE_TABLE[index0]) * frac;
  }

  // ============================================================
  // PolyBLEP Anti-Aliasing Functions
  // ============================================================

  /**
   * PolyBLEP correction for anti-aliasing at discontinuities
   */
  polyBlep(t, dt) {
    if (t < dt) {
      t /= dt;
      return t + t - t * t - 1;
    } else if (t > 1 - dt) {
      t = (t - 1) / dt;
      return t * t + t + t + 1;
    }
    return 0;
  }

  /**
   * PolyBLEP-corrected sawtooth
   */
  polyBlepSaw(phase, dt) {
    var sample = 2 * phase - 1;
    sample -= this.polyBlep(phase, dt);
    return sample;
  }

  /**
   * PolyBLEP-corrected square wave
   */
  polyBlepSquare(phase, dt) {
    var sample = phase < 0.5 ? 1 : -1;
    sample += this.polyBlep(phase, dt);
    sample -= this.polyBlep((phase + 0.5) % 1, dt);
    return sample;
  }

  /**
   * PolyBLEP-corrected pulse wave
   */
  polyBlepPulse(phase, dt, pw) {
    var sample = phase < pw ? 1 : -1;
    sample += this.polyBlep(phase, dt);
    sample -= this.polyBlep((phase + (1 - pw)) % 1, dt);
    return sample;
  }

  /**
   * PolyBLEP-corrected triangle wave
   */
  polyBlepTriangle(phase, dt) {
    return phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase;
  }

  // ============================================================
  // Voice Management
  // ============================================================

  /**
   * Create a new voice structure
   */
  createVoice() {
    return {
      id: -1,
      active: false,
      midi: -1,
      frequency: 440,
      startTime: 0,
      noteOffTime: -1,
      released: false,

      // Oscillator state (up to 3 oscillators per voice)
      oscillators: [
        { phase: 0, wave: WAVE_SINE, oct: 0, detune: 0, level: 0.8, pulseWidth: 0.5, superSawSpread: 0.5, oscFreqMult: 1, superSawMults: [1,1,1,1,1,1,1] },
        { phase: 0, wave: WAVE_SINE, oct: 0, detune: 0, level: 0.6, pulseWidth: 0.5, superSawSpread: 0.5, oscFreqMult: 1, superSawMults: [1,1,1,1,1,1,1] },
        { phase: 0, wave: WAVE_SINE, oct: 0, detune: 0, level: 0.4, pulseWidth: 0.5, superSawSpread: 0.5, oscFreqMult: 1, superSawMults: [1,1,1,1,1,1,1] }
      ],

      // Super saw phases (7 voices per oscillator)
      superSawPhases: [
        [0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0]
      ],

      // Velocity
      velocityGain: 1,

      // ADSR envelope
      adsr: { a: 0.01, d: 0.1, s: 0.7, r: 0.2 },
      envelopePhase: 'attack', // 'attack', 'decay', 'sustain', 'release'
      envelopeValue: 0,
      envelopeTime: 0,

      // Per-voice timing stagger (humanization)
      startDelaySamples: 0,

      // Glide (portamento)
      glideTime: 0,
      glideFromFreq: 0,
      glideToFreq: 0,
      glideSamplesTotal: 0,
      glideSamplesRemaining: 0,
      instId: -1,

      // Pad aftertouch LFO modulation
      padAftertouch: null,
      padLfoPhase: 0,
      padLfoPhase2: 0,
      padLfoPhase3: 0,
      padElapsed: 0,

      // Analog oscillator drift (VCO instability simulation)
      driftPhase: Math.random() * TWO_PI,

      // SuperSaw per-voice drift offsets (cents, one per detuned voice per oscillator)
      superSawDrift: [
        [0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0]
      ]
    };
  }

  /**
   * Handle messages from main thread
   */
  handleMessage(event) {
    var data = event.data;

    switch (data.type) {
      case 'noteOn':
        this.noteOn(data);
        break;

      case 'noteOff':
        this.noteOff(data.midi);
        break;

      case 'allNotesOff':
        this.allNotesOff();
        break;

      case 'setParameter':
        // Future: handle global parameter changes
        break;
    }
  }

  /**
   * Start a new note
   */
  noteOn(data) {
    var midi = data.midi;
    var baseVelocity = data.velocity;
    var oscillators = data.oscillators;
    var adsr = data.adsr;
    var humVelocity = data.humVelocity || 0;
    var humAdsr = data.humAdsr || 0;
    var humTiming = data.humTiming || 0;

    // Calculate frequency from MIDI note, applying tuning cent offset if provided
    var a4 = data.refHz || 440;
    var frequency = a4 * Math.pow(2, (midi - 69) / 12);
    var tuningCents = data.tuningCents || 0;
    if (tuningCents !== 0) {
      frequency = frequency * Math.pow(2, tuningCents / 1200);
    }

    // Glide and pad aftertouch from message
    var glideTime = data.glideTime || 0;
    var padAftertouch = data.padAftertouch || null;
    var instId = data.instId !== undefined ? data.instId : -1;

    // Per-voice velocity randomization
    var vel = baseVelocity;
    var velRange = Math.round(humVelocity * 1.2);
    if (velRange > 0) {
      vel = baseVelocity + Math.round((Math.random() * 2 - 1) * velRange);
      if (vel < 1) vel = 1;
      if (vel > 127) vel = 127;
    }

    // Per-voice ADSR jitter
    var jitteredAdsr = adsr;
    if (humAdsr > 0) {
      var adsrJitterA = 1 + (Math.random() * 2 - 1) * humAdsr * 0.015;
      var adsrJitterD = 1 + (Math.random() * 2 - 1) * humAdsr * 0.015;
      var adsrJitterR = 1 + (Math.random() * 2 - 1) * humAdsr * 0.015;
      jitteredAdsr = {
        a: adsr.a * adsrJitterA,
        d: adsr.d * adsrJitterD,
        s: adsr.s,
        r: adsr.r * adsrJitterR
      };
    }

    // Find or steal a voice (Change 5: track index)
    var voiceIndex = -1;
    var voice = null;
    for (var vi = 0; vi < this.voices.length; vi++) {
      if (!this.voices[vi].active) {
        voiceIndex = vi;
        voice = this.voices[vi];
        break;
      }
    }

    if (!voice) {
      // Steal oldest voice
      var oldestIdx = 0;
      for (var vi = 1; vi < this.voices.length; vi++) {
        if (this.voices[vi].startTime < this.voices[oldestIdx].startTime) {
          oldestIdx = vi;
        }
      }
      voiceIndex = oldestIdx;
      voice = this.voices[oldestIdx];
    }

    // Reset the voice
    voice.id = this.voiceIdCounter++;
    voice.active = true;
    voice.midi = midi;
    voice.frequency = frequency;
    voice.startTime = currentTime;
    voice.noteOffTime = -1;
    voice.released = false;
    voice.velocityGain = vel / 127;

    // Wave string to integer map (Change 3)
    var waveMap = { sine: 0, sawtooth: 1, square: 2, triangle: 3, pulse: 4, supersaw: 5 };

    // Supersaw detune values
    var detunes = SynthWorkletProcessor.SUPERSAW_DETUNES;

    // Set oscillator settings
    if (oscillators && oscillators.length >= 3) {
      for (var i = 0; i < 3; i++) {
        var osc = oscillators[i];
        var waveStr = osc.wave || 'sine';
        voice.oscillators[i].wave = waveMap[waveStr] !== undefined ? waveMap[waveStr] : 0;
        voice.oscillators[i].oct = osc.oct || 0;
        voice.oscillators[i].detune = osc.detune || 0;
        voice.oscillators[i].level = osc.level || 0;
        voice.oscillators[i].pulseWidth = (osc.pulseWidth || 50) / 100;
        voice.oscillators[i].superSawSpread = (osc.superSawSpread || 50) / 50;
        voice.oscillators[i].phase = Math.random();

        // Pre-compute freq multiplier (Change 1)
        voice.oscillators[i].oscFreqMult = Math.pow(2, voice.oscillators[i].oct) * Math.pow(2, voice.oscillators[i].detune / 1200);

        // Pre-compute supersaw detuned freq multipliers (Change 2)
        var spread = voice.oscillators[i].superSawSpread;
        var mults = voice.oscillators[i].superSawMults;
        for (var j = 0; j < 7; j++) {
          var actualDetune = detunes[j] * spread;
          mults[j] = Math.pow(2, actualDetune / 1200);
        }

        // Randomize super saw phases
        for (var j = 0; j < 7; j++) {
          voice.superSawPhases[i][j] = Math.random();
        }
      }
    }

    // Set ADSR (using per-voice jittered values)
    var MIN_RELEASE = 0.003;
    if (jitteredAdsr) {
      voice.adsr.a = jitteredAdsr.a || 0.01;
      voice.adsr.d = jitteredAdsr.d || 0.1;
      voice.adsr.s = jitteredAdsr.s || 0.7;
      voice.adsr.r = Math.max(MIN_RELEASE, jitteredAdsr.r || 0.2);
    }

    // Start envelope
    voice.envelopePhase = 'attack';
    voice.envelopeValue = 0;
    voice.envelopeTime = 0;

    // Store instrument ID for per-instrument tracking
    voice.instId = instId;

    // Glide setup: ramp from previous frequency if legato
    voice.glideTime = 0;
    voice.glideFromFreq = 0;
    voice.glideToFreq = frequency;
    voice.glideSamplesTotal = 0;
    voice.glideSamplesRemaining = 0;

    var isGlideInstId = instId >= 0 && instId <= 1;
    var shouldApplyGlide = glideTime > 0 && isGlideInstId;
    if (shouldApplyGlide) {
      var prevFreq = this.lastFrequency[instId];
      if (prevFreq > 0 && this.hasActiveVoice[instId]) {
        voice.glideTime = glideTime;
        voice.glideFromFreq = prevFreq;
        voice.glideSamplesTotal = Math.round(glideTime * this.sampleRate);
        voice.glideSamplesRemaining = voice.glideSamplesTotal;
        voice.frequency = prevFreq; // Start from previous frequency
      }
    }

    if (instId >= 0 && instId < 4) {
      this.lastFrequency[instId] = frequency;
      this.hasActiveVoice[instId] = true;
    }

    // Pad aftertouch LFO setup
    voice.padAftertouch = padAftertouch;
    voice.padLfoPhase = 0;
    voice.padLfoPhase2 = 0;
    voice.padLfoPhase3 = 0;
    voice.padElapsed = 0;

    // Per-voice timing stagger: random delay up to ~4ms at humTiming=100
    if (humTiming > 0) {
      var maxDelay = Math.round(humTiming * 0.15 * this.sampleRate / 1000);
      voice.startDelaySamples = Math.round(Math.random() * maxDelay);
    } else {
      voice.startDelaySamples = 0;
    }

    // Add to active voice indices (Change 5)
    this.activeVoiceIndices.push(voiceIndex);

    // Notify main thread
    this.port.postMessage({
      type: 'noteStarted',
      midi: midi,
      voiceId: voice.id
    });
  }

  /**
   * Release a note
   */
  noteOff(midi) {
    for (var i = 0; i < this.voices.length; i++) {
      var voice = this.voices[i];
      var isActiveUnreleasedVoice = voice.active && voice.midi === midi;
      var canReleaseVoice = isActiveUnreleasedVoice && !voice.released;
      if (canReleaseVoice) {
        voice.released = true;
        voice.noteOffTime = currentTime;
        voice.envelopePhase = 'release';
        voice.envelopeTime = 0;

        // Check if this instrument still has any non-released voices
        var instId = voice.instId;
        if (instId >= 0 && instId < 4) {
          var isStillActive = false;
          for (var j = 0; j < this.voices.length; j++) {
            var isOtherVoice = j !== i && this.voices[j].active;
            var isOtherActiveInst = isOtherVoice && !this.voices[j].released && this.voices[j].instId === instId;
            if (isOtherActiveInst) {
              isStillActive = true;
              break;
            }
          }
          this.hasActiveVoice[instId] = isStillActive;
        }

        break; // Only release one voice per noteOff
      }
    }
  }

  /**
   * Stop all notes immediately
   */
  allNotesOff() {
    for (var i = 0; i < this.voices.length; i++) {
      this.voices[i].active = false;
      this.voices[i].envelopeValue = 0;
    }
    this.activeVoiceIndices.length = 0;
    this.hasActiveVoice = [false, false, false, false];
  }

  // ============================================================
  // Audio Generation
  // ============================================================

  /**
   * Super saw detune offsets in cents
   */
  static SUPERSAW_DETUNES = [-40, -25, -10, 0, 10, 25, 40];

  /**
   * Generate a sample for a single oscillator
   * Uses pre-computed freq multipliers and integer wave dispatch
   */
  generateOscillatorSample(voice, oscIndex) {
    var osc = voice.oscillators[oscIndex];

    if (osc.level <= 0) {
      return 0;
    }

    // Use pre-computed frequency multiplier (Change 1)
    var oscFreq = voice.frequency * osc.oscFreqMult;

    // Analog oscillator drift: slow sine LFO modulates pitch by ±0.5 cents (VCO instability)
    var DRIFT_RATE = 0.1; // Hz
    voice.driftPhase += (TWO_PI * DRIFT_RATE) / this.sampleRate;
    if (voice.driftPhase >= TWO_PI) { voice.driftPhase -= TWO_PI; }
    var driftCents = this.fastSin(voice.driftPhase) * 0.5;
    oscFreq = oscFreq * Math.pow(2, driftCents / 1200);

    var dt = oscFreq / this.sampleRate; // Phase increment

    var sample = 0;
    var w = osc.wave;

    // Integer wave dispatch (Change 3)
    if (w === WAVE_SINE) {
      sample = this.fastSin(osc.phase * TWO_PI);
    } else if (w === WAVE_SAW) {
      sample = this.polyBlepSaw(osc.phase, dt);
    } else if (w === WAVE_SQUARE) {
      sample = this.polyBlepSquare(osc.phase, dt);
    } else if (w === WAVE_TRI) {
      sample = this.polyBlepTriangle(osc.phase, dt);
    } else if (w === WAVE_PULSE) {
      sample = this.polyBlepPulse(osc.phase, dt, osc.pulseWidth);
    } else if (w === WAVE_SUPERSAW) {
      // 7 detuned sawtooth voices using pre-computed multipliers (Change 2)
      var mults = osc.superSawMults;
      var phases = voice.superSawPhases[oscIndex];
      var drifts = voice.superSawDrift[oscIndex];

      for (var i = 0; i < 7; i++) {
        // SuperSaw drift: slow random walk per detuned voice (±2 cents from base)
        drifts[i] += (Math.random() - 0.5) * 0.01;
        var baseDet = SynthWorkletProcessor.SUPERSAW_DETUNES[i] * osc.superSawSpread;
        var minDrift = baseDet - 2;
        var maxDrift = baseDet + 2;
        if (drifts[i] < minDrift) { drifts[i] = minDrift; }
        if (drifts[i] > maxDrift) { drifts[i] = maxDrift; }

        var voiceFreq = oscFreq * mults[i] * Math.pow(2, drifts[i] / 1200);
        var voiceDt = voiceFreq / this.sampleRate;

        sample += this.polyBlepSaw(phases[i], voiceDt) / 7;

        // Advance super saw phase
        phases[i] += voiceFreq / this.sampleRate;
        if (phases[i] >= 1) {
          phases[i] -= 1;
        }
      }
    } else {
      // default to sine
      sample = this.fastSin(osc.phase * TWO_PI);
    }

    // Advance phase
    osc.phase += oscFreq / this.sampleRate;
    if (osc.phase >= 1) osc.phase -= 1;

    return sample * osc.level;
  }

  /**
   * Calculate ADSR envelope value and advance envelope state
   */
  processEnvelope(voice, sampleDuration) {
    var a = voice.adsr.a, d = voice.adsr.d, s = voice.adsr.s, r = voice.adsr.r;

    switch (voice.envelopePhase) {
      case 'attack':
        if (a > 0) {
          voice.envelopeValue += sampleDuration / a;
          if (voice.envelopeValue >= 1) {
            voice.envelopeValue = 1;
            voice.envelopePhase = 'decay';
            voice.envelopeTime = 0;
          }
        } else {
          voice.envelopeValue = 1;
          voice.envelopePhase = 'decay';
          voice.envelopeTime = 0;
        }
        break;

      case 'decay':
        if (d > 0) {
          var decayT = voice.envelopeTime;
          if (decayT < d) {
            // Exponential decay: peak -> sustain with natural curve
            voice.envelopeValue = s + (1 - s) * Math.exp(-decayT * 5 / d);
            voice.envelopeTime += sampleDuration;
          } else {
            voice.envelopeValue = s;
            voice.envelopePhase = 'sustain';
          }
        } else {
          voice.envelopeValue = s;
          voice.envelopePhase = 'sustain';
        }
        break;

      case 'sustain':
        voice.envelopeValue = s;
        break;

      case 'release':
        if (r > 0) {
          var releaseT = voice.envelopeTime;
          if (releaseT < r) {
            // Exponential release: sustain -> 0 with natural decay curve
            voice.envelopeValue = s * Math.exp(-releaseT * 5 / r);
            voice.envelopeTime += sampleDuration;
          } else {
            voice.envelopeValue = 0;
            voice.active = false;
          }
        } else {
          voice.envelopeValue = 0;
          voice.active = false;
        }
        break;
    }

    return voice.envelopeValue;
  }

  /**
   * Generate a sample for an entire voice (all oscillators mixed)
   */
  generateVoiceSample(voice, sampleDuration) {
    // Glide: smoothly interpolate frequency from previous to target
    if (voice.glideSamplesRemaining > 0) {
      var t = 1 - (voice.glideSamplesRemaining / voice.glideSamplesTotal);
      // Exponential interpolation for musical pitch glide
      var logFrom = Math.log(voice.glideFromFreq);
      var logTo = Math.log(voice.glideToFreq);
      voice.frequency = Math.exp(logFrom + (logTo - logFrom) * t);
      voice.glideSamplesRemaining--;
    } else if (voice.glideTime > 0) {
      // Glide finished, lock to target
      voice.frequency = voice.glideToFreq;
    }

    // Pad aftertouch: calculate LFO modulation depths
    var padPitchMod = 0;
    var padVolMod = 1;
    var pat = voice.padAftertouch;

    if (pat) {
      voice.padElapsed += sampleDuration;

      // Fade-in ramp: 0 to 1 over the first 0.75 seconds
      var fadeIn = voice.padElapsed / 0.75;
      if (fadeIn > 1) { fadeIn = 1; }

      var rate = pat.rate || 0.4;

      // Vibrato (pitch wobble) — slightly slower rate
      if (pat.vibrato > 0) {
        var vibratoRate = rate * 0.9;
        voice.padLfoPhase += vibratoRate * sampleDuration;
        if (voice.padLfoPhase > 1) { voice.padLfoPhase -= 1; }
        // Vibrato depth: up to ~25 cents at vibrato=100
        padPitchMod = this.fastSin(voice.padLfoPhase * TWO_PI) * (pat.vibrato / 100) * 0.25 * fadeIn;
      }

      // Volume swell (breathing) — base rate
      if (pat.volumeMod > 0) {
        voice.padLfoPhase2 += rate * sampleDuration;
        if (voice.padLfoPhase2 > 1) { voice.padLfoPhase2 -= 1; }
        // Volume mod: subtle swell, range [1 - depth, 1 + depth*0.5]
        var volLfo = this.fastSin(voice.padLfoPhase2 * TWO_PI);
        var volDepth = (pat.volumeMod / 100) * 0.15;
        padVolMod = 1 + volLfo * volDepth * fadeIn;
      }

      // Filter mod phase advances (used externally if filter is in worklet, but we apply pitch/vol here)
      if (pat.filterMod > 0) {
        voice.padLfoPhase3 += rate * 1.1 * sampleDuration;
        if (voice.padLfoPhase3 > 1) { voice.padLfoPhase3 -= 1; }
      }
    }

    // Apply pitch modulation from pad aftertouch vibrato
    var savedFreq = voice.frequency;
    if (padPitchMod !== 0) {
      voice.frequency = voice.frequency * Math.pow(2, padPitchMod / 12);
    }

    var sample = 0;

    // Mix all 3 oscillators
    for (var i = 0; i < 3; i++) {
      sample += this.generateOscillatorSample(voice, i);
    }

    // Restore frequency after oscillator generation
    voice.frequency = savedFreq;

    // Apply envelope
    var envelope = this.processEnvelope(voice, sampleDuration);

    return sample * envelope * padVolMod;
  }

  /**
   * Main audio processing method - called by the audio system
   * Uses active voice index compaction (Change 5)
   */
  process(inputs, outputs, parameters) {
    var output = outputs[0];
    var channel = output[0];

    if (!channel) {
      return true;
    }

    var blockSize = channel.length;
    var sampleDuration = 1 / this.sampleRate;

    // Active voice compaction (Change 5)
    var avi = this.activeVoiceIndices;
    var aviLen = avi.length;

    if (aviLen === 0) {
      for (var z = 0; z < blockSize; z++) {
        channel[z] = 0;
      }
      return true;
    }

    // Clear the output buffer
    for (var i = 0; i < blockSize; i++) {
      channel[i] = 0;
    }

    // Generate audio for each active voice only
    for (var v = 0; v < aviLen; v++) {
      var voice = this.voices[avi[v]];
      if (voice.active) {
        for (var i = 0; i < blockSize; i++) {
          if (voice.startDelaySamples > 0) {
            voice.startDelaySamples--;
          } else {
            var sample = this.generateVoiceSample(voice, sampleDuration);
            channel[i] += sample * 0.12 * voice.velocityGain; // Master gain * velocity
          }
        }
      }
    }

    // Soft clip the summed output
    var tanhNorm = 1 / Math.tanh(1.5);
    for (var sc = 0; sc < blockSize; sc++) {
      channel[sc] = Math.tanh(channel[sc] * 1.5) * tanhNorm;
    }

    // In-place compaction: remove voices that became inactive (Change 5)
    var writeIdx = 0;
    for (var ci = 0; ci < avi.length; ci++) {
      if (this.voices[avi[ci]].active) {
        avi[writeIdx] = avi[ci];
        writeIdx++;
      }
    }
    avi.length = writeIdx;

    // Return true to keep processor alive
    return true;
  }
}

// Register the processor
registerProcessor('synth-worklet', SynthWorkletProcessor);
