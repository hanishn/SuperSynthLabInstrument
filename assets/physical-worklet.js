// Super Synth Lab - Physical Modelling AudioWorklet Processor
// Karplus-Strong, Bowed String, Blown Pipe, Modal Synthesis
// v1.1.3 — fix: per-voice gain scaling + smooth soft clipper for chord headroom

var PHYS_VOICE_OUTPUT_GAIN = 0.22;
var PLUCK_OUTPUT_SCALE = 3.0;
var PHYS_SINE_SIZE = 4096;
var PHYS_SINE_TABLE = new Float64Array(PHYS_SINE_SIZE);
var PHYS_SINE_MASK = PHYS_SINE_SIZE - 1;
(function() {
    for (var _i = 0; _i < PHYS_SINE_SIZE; _i++) {
        PHYS_SINE_TABLE[_i] = Math.sin(2 * Math.PI * _i / PHYS_SINE_SIZE);
    }
})();

// ============================================================
// Utility: Circular Buffer (Delay Line)
// ============================================================

class CircularBuffer {
  constructor(maxLength) {
    this.buffer = new Float64Array(maxLength);
    this.length = maxLength;
    this.writeIndex = 0;
  }

  write(value) {
    this.buffer[this.writeIndex] = value;
    this.writeIndex = (this.writeIndex + 1) % this.length;
  }

  read(delay) {
    // delay in samples (fractional allowed)
    var intDelay = delay | 0;
    var frac = delay - intDelay;
    var idx0 = (this.writeIndex - intDelay - 1 + this.length * 2) % this.length;
    var idx1 = (idx0 - 1 + this.length) % this.length;
    // Linear interpolation for fractional delays
    return this.buffer[idx0] * (1 - frac) + this.buffer[idx1] * frac;
  }

  readNearest(delay) {
    var intDelay = Math.round(delay);
    var idx = (this.writeIndex - intDelay - 1 + this.length * 2) % this.length;
    return this.buffer[idx];
  }

  clear() {
    this.buffer.fill(0);
    this.writeIndex = 0;
  }

  setLength(len) {
    if (len > this.buffer.length) {
      var newBuf = new Float64Array(len);
      newBuf.set(this.buffer);
      this.buffer = newBuf;
    }
    this.length = len;
    if (this.writeIndex >= len) this.writeIndex = 0;
  }
}

// ============================================================
// Simple one-pole lowpass filter
// ============================================================

class OnePole {
  constructor() {
    this.a = 0.5;
    this.prev = 0;
  }

  setCoeff(a) {
    this.a = Math.max(0, Math.min(1, a));
  }

  process(input) {
    this.prev = this.a * input + (1 - this.a) * this.prev;
    return this.prev;
  }

  clear() {
    this.prev = 0;
  }
}

// ============================================================
// Two-pole resonant filter (for body resonance simulation)
// ============================================================

class TwoPole {
  constructor() {
    this.y1 = 0;
    this.y2 = 0;
    this.b0 = 1;
    this.a1 = 0;
    this.a2 = 0;
  }

  setResonance(freq, radius, sr) {
    var w = 2 * Math.PI * freq / sr;
    this.a1 = -2 * radius * Math.cos(w);
    this.a2 = radius * radius;
    this.b0 = (1 - radius * radius) * 0.5;
  }

  process(input) {
    var y = this.b0 * input - this.a1 * this.y1 - this.a2 * this.y2;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }

  clear() {
    this.y1 = 0;
    this.y2 = 0;
  }
}

// ============================================================
// Simple DC blocker
// ============================================================

class DCBlocker {
  constructor() {
    this.x1 = 0;
    this.y1 = 0;
    this.R = 0.995;
  }

  process(input) {
    var y = input - this.x1 + this.R * this.y1;
    this.x1 = input;
    this.y1 = y;
    return y;
  }

  clear() {
    this.x1 = 0;
    this.y1 = 0;
  }
}

// ============================================================
// Model 1: Plucked String (Karplus-Strong)
// ============================================================

class PluckModel {
  constructor(sr) {
    this.sampleRate = sr;
    this.delayLine = new CircularBuffer(Math.ceil(sr / 20)); // Down to ~20 Hz
    this.loopFilter = new OnePole();
    this.dcBlocker = new DCBlocker();
    this.active = false;
    this.decayCounter = 0;
    this.maxDecay = 0;
    this.prevSample = 0; // For two-point averaging
    // Parameters
    this.damping = 50;
    this.brightness = 60;
    this.excitation = 'noise'; // 'noise', 'impulse', 'pick'
    this.bodySize = 50;
    this.decayTime = 70;
    this.delayLength = 100;
    this.exciteRemaining = 0;
    this.pickPosition = 0.5;
    this.pickDelay = 0; // Pick position comb filter delay in samples
    this.baseFilterCoeff = 0.5;
  }

  noteOn(freq, velocity) {
    this.active = true;
    var period = this.sampleRate / freq;
    this.delayLength = period - 0.5; // compensate for averaging filter group delay

    // Brightness -> loop filter coefficient (higher = brighter)
    var bright = this.brightness / 100;
    this.baseFilterCoeff = 0.5 + bright * 0.45;
    this.loopFilter.setCoeff(this.baseFilterCoeff);

    // Decay time controls maximum samples before voice reclaim
    this.maxDecay = Math.floor(this.sampleRate * (1 + (this.decayTime / 100) * 9));
    this.decayCounter = 0;

    // Body size affects a secondary lowpass (pre-output)
    this.bodyCoeff = 0.5 + (this.bodySize / 100) * 0.45;

    // Pick position for comb filtering (suppress harmonics at multiples of 1/pickPos)
    this.pickPosition = 0.13 + (this.bodySize / 100) * 0.35;
    this.pickDelay = Math.max(1, Math.floor(this.delayLength * this.pickPosition));

    // Clear state
    this.delayLine.clear();
    this.dcBlocker.clear();
    this.loopFilter.clear();
    this.prevSample = 0;

    // Excitation: fill delay line with shaped excitation
    var vel = (velocity || 100) / 127;
    var intPeriod = Math.ceil(period);
    var excLen = intPeriod;

    if (this.excitation === 'impulse') {
      // Short windowed impulse burst (half-Hann window, ~8% of period)
      var burstLen = Math.max(3, Math.floor(intPeriod * 0.08));
      for (var i = 0; i < burstLen; i++) {
        var w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (burstLen - 1)));
        this.delayLine.write(w * vel * 0.9);
      }
      for (var i = burstLen; i < intPeriod; i++) this.delayLine.write(0);
    } else if (this.excitation === 'pick') {
      // Triangle-ish pick excitation with half-Hann window
      var half = Math.floor(excLen / 2);
      for (var i = 0; i < excLen; i++) {
        var env = i < half ? i / half : (excLen - i) / (excLen - half);
        // Half-Hann window for smoother onset
        var hann = 0.5 * (1 - Math.cos(Math.PI * i / excLen));
        var noise = (Math.random() * 2 - 1) * 0.15;
        this.delayLine.write((env + noise) * hann * vel * 0.5);
      }
    } else {
      // Shaped noise burst: mix of filtered noise + short sine burst at fundamental
      // Apply a half-Hann window for smoother onset
      var sineLen = Math.min(intPeriod, Math.floor(period * 0.5));
      var prevNoise = 0;
      for (var i = 0; i < excLen; i++) {
        // Half-Hann window
        var hann = 0.5 * (1 - Math.cos(Math.PI * i / excLen));
        // Noise component (simple one-pole lowpass for shaping)
        var rawNoise = (Math.random() * 2 - 1);
        var filteredNoise = 0.6 * rawNoise + 0.4 * prevNoise;
        prevNoise = filteredNoise;
        // Sine burst at fundamental (fades out after half the period)
        var sineBurst = 0;
        if (i < sineLen) {
          var sineEnv = 1 - (i / sineLen);
          sineBurst = Math.sin(2 * Math.PI * freq * i / this.sampleRate) * sineEnv * 0.4;
        }
        var sample = (filteredNoise * 0.6 + sineBurst) * hann * vel * 0.5;
        this.delayLine.write(sample);
      }
    }
  }

  noteOff() {
    // Plucked strings just decay naturally — accelerate the damping
    var currentCoeff = this.loopFilter.a;
    this.loopFilter.setCoeff(currentCoeff * 0.7);
  }

  process() {
    if (!this.active) return 0;

    this.decayCounter++;
    if (this.decayCounter > this.maxDecay) {
      this.active = false;
      return 0;
    }

    // Read from delay line
    var delayed = this.delayLine.read(this.delayLength - 1);

    // Pick position comb filter: suppress harmonics at multiples of 1/pickPosition
    var pickSample = this.delayLine.read(this.pickDelay);
    delayed = delayed - pickSample * 0.5;

    // Two-point averaging (original KS algorithm) before loop filter
    var averaged = (delayed + this.prevSample) * 0.5;
    this.prevSample = delayed;

    // One-pole loop filter for brightness/damping
    var filtered = this.loopFilter.process(averaged);

    // Frequency-dependent damping: slightly reduce filter coeff over time
    // Higher harmonics naturally damp faster due to the averaging + filter combo
    var dampLoss = 1 - (this.damping / 100) * 0.003;
    filtered *= dampLoss;

    // Write back into delay line
    this.delayLine.write(filtered);

    // DC block
    var out = this.dcBlocker.process(filtered);

    // Check if effectively silent
    if (this.decayCounter > this.sampleRate * 0.5 && Math.abs(out) < 0.00001) {
      this.active = false;
      return 0;
    }

    return out;
  }

  isFinished() {
    return !this.active;
  }
}

// ============================================================
// Model 2: Bowed String (Digital Waveguide)
// ============================================================

class BowModel {
  constructor(sr) {
    this.sampleRate = sr;
    var maxDelay = Math.ceil(sr / 20);
    this.neckDelay = new CircularBuffer(maxDelay);
    this.bridgeDelay = new CircularBuffer(maxDelay);
    this.stringFilter = new OnePole();
    this.bodyFilter = new TwoPole();
    this.dcBlocker = new DCBlocker();
    this.active = false;
    this.bowing = false;
    this.decayCounter = 0;
    this.maxDecay = 0;
    // STK bowTable parameters
    this.bowTableOffset = 0;
    this.bowTableSlope = 3.0;
    // Bow state
    this.maxVelocity = 0.3;
    this.baseNeckLength = 50;
    this.baseBridgeLength = 50;
    this.neckLength = 50;
    this.bridgeLength = 50;
    // Vibrato
    this.vibratoPhase = 0;
    this.vibratoFreq = 5.5;
    this.vibratoDepth = 0;
    // Silence tracking
    this.silentSamples = 0;
    // Humanization drift LFOs (slow random wander)
    this.humanization = 0;
    this.driftPhase1 = 0;
    this.driftPhase2 = 0;
    this.driftRate1 = 0.15; // Hz, vibrato rate + bow pressure drift
    this.driftRate2 = 0.22; // Hz, vibrato depth drift
    this.baseMaxVelocity = 0.3;
    // Parameters (set by PhysicalVoice)
    this.bowPressure = 50;
    this.bowPosition = 50;
    this.brightness = 60;
  }

  // STK BowTable: friction curve
  // Returns reflection coefficient: 1.0 when stuck, ~0 when slipping
  bowTable(input) {
    var sample = (input + this.bowTableOffset) * this.bowTableSlope;
    sample = Math.abs(sample) + 0.75;
    var s2 = sample * sample;
    sample = 1.0 / (s2 * s2);
    if (sample > 1.0) sample = 1.0;
    return sample;
  }

  noteOn(freq, velocity) {
    this.active = true;
    this.bowing = true;
    var period = this.sampleRate / freq;

    // Bow position: split string at 12-42% from bridge
    var bowPos = 0.12 + (this.bowPosition / 100) * 0.3;
    this.baseBridgeLength = Math.max(2, Math.floor(period * bowPos));
    this.baseNeckLength = Math.max(2, Math.floor(period * (1 - bowPos)));
    this.bridgeLength = this.baseBridgeLength;
    this.neckLength = this.baseNeckLength;

    // Bow pressure -> table slope (STK range ~2-8)
    this.bowTableSlope = 5.0 - (this.bowPressure / 100) * 3.0;

    // Bow velocity from MIDI velocity (squared curve for audible range)
    var velNormBow = velocity / 127;
    var velCurvedBow = velNormBow * velNormBow;
    this.baseMaxVelocity = 0.1 + velCurvedBow * 0.4;
    this.maxVelocity = this.baseMaxVelocity;

    // String filter: brightness controls bridge reflection damping
    var bright = 0.3 + (this.brightness / 100) * 0.65;
    this.stringFilter.setCoeff(bright);

    // Body resonance (output path only, not in feedback loop)
    var bodyFreq = 220 + freq * 0.25;
    this.bodyFilter.setResonance(bodyFreq, 0.85, this.sampleRate);

    this.maxDecay = Math.floor(this.sampleRate * 10);
    this.decayCounter = 0;
    this.vibratoPhase = 0;
    this.vibratoDepth = 0;
    this.silentSamples = 0;

    // Drift LFO: randomize rates per note for organic variation
    this.driftPhase1 = Math.random();
    this.driftPhase2 = Math.random();
    this.driftRate1 = 0.1 + Math.random() * 0.2;  // 0.1-0.3 Hz
    this.driftRate2 = 0.1 + Math.random() * 0.2;  // 0.1-0.3 Hz

    // Clear all state
    this.neckDelay.clear();
    this.bridgeDelay.clear();
    this.stringFilter.clear();
    this.bodyFilter.clear();
    this.dcBlocker.clear();
  }

  noteOff() {
    this.bowing = false;
  }

  process() {
    if (!this.active) return 0;

    this.decayCounter++;
    if (this.decayCounter > this.maxDecay) {
      this.active = false;
      return 0;
    }

    // Humanization drift: slow LFO wander on vibrato and bow pressure
    var drift1 = 0;
    var drift2 = 0;
    if (this.humanization > 0) {
      this.driftPhase1 += this.driftRate1 / this.sampleRate;
      if (this.driftPhase1 > 1) this.driftPhase1 -= 1;
      this.driftPhase2 += this.driftRate2 / this.sampleRate;
      if (this.driftPhase2 > 1) this.driftPhase2 -= 1;
      drift1 = PHYS_SINE_TABLE[(this.driftPhase1 * PHYS_SINE_SIZE | 0) & PHYS_SINE_MASK];
      drift2 = PHYS_SINE_TABLE[(this.driftPhase2 * PHYS_SINE_SIZE | 0) & PHYS_SINE_MASK];
      // Bow pressure drift: maxVelocity wanders +/- 20%
      this.maxVelocity = this.baseMaxVelocity * (1 + drift1 * 0.40 * this.humanization);
    }

    // Vibrato: ramps in after ~300ms
    if (this.bowing) {
      var vibratoFreqNow = this.vibratoFreq * (1 + drift1 * 0.60 * this.humanization);
      this.vibratoPhase += vibratoFreqNow / this.sampleRate;
      if (this.vibratoPhase > 1) this.vibratoPhase -= 1;
      var rampSamples = this.sampleRate * 0.3;
      var vibratoTarget = 0.3;
      // Vibrato depth drift: wander +/- 40%
      vibratoTarget = vibratoTarget * (1 + drift2 * 0.80 * this.humanization);
      if (this.decayCounter < rampSamples) {
        this.vibratoDepth = vibratoTarget * (this.decayCounter / rampSamples);
      } else {
        this.vibratoDepth = vibratoTarget;
      }
      var vtIdx = (this.vibratoPhase * PHYS_SINE_SIZE) | 0;
      var vibMod = PHYS_SINE_TABLE[vtIdx & PHYS_SINE_MASK] * this.vibratoDepth;
      this.neckLength = Math.max(2, this.baseNeckLength + vibMod);
      this.bridgeLength = Math.max(2, this.baseBridgeLength + vibMod);
    }

    // === STK Bowed algorithm ===

    // 1. Read waves arriving at bow point
    var bridgeOut = this.bridgeDelay.read(this.bridgeLength - 1);
    var neckOut = this.neckDelay.read(this.neckLength - 1);

    // 2. Bridge reflection: negate + lowpass (partial reflection at bridge)
    var bridgeReflection = -this.stringFilter.process(bridgeOut);

    // 3. Nut reflection: negate only (fixed end = perfect inversion)
    var nutReflection = -neckOut;

    // 4. String velocity at bow point
    var stringVelocity = bridgeReflection + nutReflection;

    // 5. Bow interaction (STK friction model)
    var bowVelocity = this.bowing ? this.maxVelocity : 0;
    var deltaV = bowVelocity - stringVelocity;
    var newVelocity = deltaV * this.bowTable(deltaV);

    // 6. Outgoing waves: opposite reflection + bow contribution
    this.neckDelay.write(bridgeReflection + newVelocity);
    this.bridgeDelay.write(nutReflection + newVelocity);

    // 7. Output: bridge signal through body resonance + DC blocking
    var out = this.bodyFilter.process(bridgeOut);
    out = this.dcBlocker.process(out);

    // Silence detection after bow release
    if (!this.bowing) {
      if (Math.abs(out) < 0.00005) {
        this.silentSamples++;
        if (this.silentSamples > this.sampleRate * 0.3) {
          this.active = false;
        }
      } else {
        this.silentSamples = 0;
      }
    }

    return out;
  }

  isFinished() {
    return !this.active;
  }
}

// ============================================================
// Model 3: Blown Pipe (STK Flute — Waveguide)
// ============================================================

class BlowModel {
  constructor(sr) {
    this.sampleRate = sr;
    var maxDelay = Math.ceil(sr / 20);
    this.boreDelay = new CircularBuffer(maxDelay);
    this.jetDelay = new CircularBuffer(Math.ceil(maxDelay / 2));
    this.dcBlocker = new DCBlocker();
    // STK jet filter: OnePole(pole=0.7) with gain=-1 (inverts + lowpass)
    // CRITICAL: Without this, jet path gain is -0.5 which CANCELS endReflection +0.5 = zero loop gain = no oscillation
    // With filter negation: jet path becomes +0.5, total loop gain = +1.0 → self-oscillation
    this.jetFilter = new OnePole();
    this.jetFilter.setCoeff(0.3); // pole at 0.7: y = 0.3*x + 0.7*y_prev
    this.active = false;
    this.blowing = false;
    this.decayCounter = 0;
    this.maxDecay = 0;
    this.silenceCounter = 0;
    // STK canonical reflection coefficients — hardcoded, not mapped
    this.jetReflection = 0.5;
    this.endReflection = 0.5;
    this.lastOutput = 0;
    this.outputGain = 1.0;
    // Breath envelope
    this.breathEnvelope = 0;
    this.breathAttackRate = 0;
    this.breathTarget = 0;
    this.noiseGain = 0.15;
    // Parameters (set by PhysicalVoice)
    this.breathPressure = 50;
    this.embouchure = 50;
    this.brightness = 60;
    // Waveguide state
    this.boreLength = 100;
    this.jetLength = 20;
    // Vibrato (STK default: off)
    this.vibratoFreq = 5.2;
    this.vibratoGain = 0.0;
    this.vibratoPhase = 0;
    // Humanization drift LFOs
    this.humanization = 0;
    this.driftPhase1 = 0;
    this.driftPhase2 = 0;
    this.driftRate1 = 0.18;
    this.driftRate2 = 0.25;
    this.baseBreathTarget = 0;
  }

  // STK JetTable: cubic nonlinearity x³ - x, clamped to ±1
  jetTable(input) {
    var out = input * (input * input - 1.0);
    if (out > 1.0) out = 1.0;
    if (out < -1.0) out = -1.0;
    return out;
  }

  noteOn(freq, velocity) {
    this.active = true;
    this.blowing = true;

    var period = this.sampleRate / freq;

    // STK Flute::setFrequency: bore delay = full period minus filter compensation
    // The bore delay determines the PITCH (direct endReflection feedback path).
    // The jet delay is ADDITIONAL — it controls excitation, not pitch.
    // Subtract 2.0 for implicit DC blocker + jet table filter delays (STK convention).
    var delay = Math.max(3.0, period - 2.0);

    // Jet ratio: fraction of bore delay (STK default jetRatio_ = 0.32)
    // We map from embouchure param: 10-45%
    var jetRatio = 0.1 + (this.embouchure / 100) * 0.35;

    // FRACTIONAL delays — do NOT floor! Linear interpolation in CircularBuffer
    // provides implicit HF damping each round trip (critical for waveguide stability).
    this.boreLength = delay;
    this.jetLength = delay * jetRatio;

    // STK canonical: fixed reflection coefficients
    this.jetReflection = 0.5;
    this.endReflection = 0.5;
    this.lastOutput = 0;

    // STK breath pressure: squared curve for audible velocity range
    var amplitudeLinear = velocity / 127;
    var amplitude = amplitudeLinear * amplitudeLinear;
    this.baseBreathTarget = 0.60 + amplitude * 0.25;
    this.breathTarget = this.baseBreathTarget;
    this.breathEnvelope = 0;
    this.breathAttackRate = this.breathTarget / (this.sampleRate * 0.06);

    // STK noise gain: 0.15 (significant — jet turbulence excites the waveguide)
    this.noiseGain = 0.15;

    // STK output gain: amplitude + 0.001
    this.outputGain = amplitude + 0.001;

    this.maxDecay = Math.floor(this.sampleRate * 8);
    this.decayCounter = 0;
    this.silenceCounter = 0;
    this.vibratoPhase = 0;

    // Drift LFO: randomize rates per note for organic variation
    this.driftPhase1 = Math.random();
    this.driftPhase2 = Math.random();
    this.driftRate1 = 0.1 + Math.random() * 0.2;  // 0.1-0.3 Hz
    this.driftRate2 = 0.1 + Math.random() * 0.2;  // 0.1-0.3 Hz

    // Clear delay lines and filters
    this.boreDelay.clear();
    this.jetDelay.clear();
    this.dcBlocker.clear();
    this.jetFilter.clear();

    // Compute embouchure-dependent parameters for process loop
    var emb = this.embouchure / 100;
    this._emb = emb;
    this._exciteScale = 0.15 + emb * 0.45; // 0.15 (flute) to 0.60 (reed)
    this._feedback = 0.992 + emb * 0.006;   // 0.992 (flute) to 0.998 (reed)
    this._filterCoeff = 0.25 + emb * 0.65;  // 0.25 (flute, aggressive LP) to 0.90 (reed, open)
    if (this._filterCoeff > 0.95) this._filterCoeff = 0.95;
    this._prevFiltered = 0;

    // Seed bore delay with noise burst — boost for low embouchure (flute family)
    var vel = velocity / 127;
    var seedBoost = emb < 0.35 ? 2.0 : 1.0;
    var intPeriod = Math.ceil(this.boreLength);
    for (var i = 0; i < intPeriod; i++) {
      this.boreDelay.write((Math.random() * 2 - 1) * vel * 0.4 * seedBoost);
    }
  }

  noteOff() {
    this.blowing = false;
  }

  process() {
    if (!this.active) return 0;

    this.decayCounter++;
    if (this.decayCounter > this.maxDecay) {
      this.active = false;
      return 0;
    }

    // Humanization drift: slow LFO wander on breath pressure
    if (this.humanization > 0) {
      this.driftPhase1 += this.driftRate1 / this.sampleRate;
      if (this.driftPhase1 > 1) this.driftPhase1 -= 1;
      this.driftPhase2 += this.driftRate2 / this.sampleRate;
      if (this.driftPhase2 > 1) this.driftPhase2 -= 1;
      var blowDrift1 = PHYS_SINE_TABLE[(this.driftPhase1 * PHYS_SINE_SIZE | 0) & PHYS_SINE_MASK];
      // Breath pressure drift: breathTarget wanders +/- 20%
      this.breathTarget = this.baseBreathTarget * (1 + blowDrift1 * 0.40 * this.humanization);
    }

    // Breath envelope ramp
    if (this.blowing) {
      if (this.breathEnvelope < this.breathTarget) {
        this.breathEnvelope += this.breathAttackRate;
        if (this.breathEnvelope > this.breathTarget) {
          this.breathEnvelope = this.breathTarget;
        }
      } else if (this.breathEnvelope > this.breathTarget) {
        // Allow envelope to drift down when target decreases
        this.breathEnvelope += (this.breathTarget - this.breathEnvelope) * 0.001;
      }
    } else {
      this.breathEnvelope *= 0.985;
    }

    // STK-style flute waveguide: bore delay + jet delay interaction
    // Read bore end reflection (sound returning from the open end)
    var boreOut = this.boreDelay.read(this.boreLength - 1);

    // One-pole lowpass loop filter (embouchure-dependent, controls harmonic content)
    var filtered = this._filterCoeff * boreOut + (1 - this._filterCoeff) * this._prevFiltered;
    this._prevFiltered = filtered;

    // End reflection: open end reflects with inversion, scaled by endReflection
    var endRefl = filtered * this.endReflection;

    // Read jet delay output (delayed excitation arriving at the bore entrance)
    var jetOut = this.jetDelay.read(this.jetLength - 1);

    // Jet filter: lowpass + inversion (STK pole=0.7, gain=-1)
    // The negation is critical: without it, jet and end reflection cancel
    var jetFiltered = -this.jetFilter.process(jetOut);

    // Combine jet output with bore end reflection at the labium
    var pressureDiff = jetFiltered + endRefl;

    // Jet table nonlinearity: models turbulent jet deflection at the labium
    var jetSample = this.jetTable(pressureDiff);

    // Breath noise: turbulence in the air jet
    var noise = Math.random() * 2 - 1;
    var breathNoise = this.breathEnvelope * this.noiseGain * noise;

    // Excitation: breath pressure drives the jet, shaped by embouchure
    var excitation = this.breathEnvelope * this._exciteScale + breathNoise;

    // Write excitation into jet delay (travels from mouth to labium)
    this.jetDelay.write(excitation * this.jetReflection);

    // Write into bore delay: jet output + reflected bore signal
    var boreInput = jetSample * this._feedback + endRefl;
    // Soft limiter for stability
    if (boreInput > 1.0 || boreInput < -1.0) {
      boreInput = boreInput / (1.0 + Math.abs(boreInput));
    }
    this.boreDelay.write(boreInput);

    // Output is the pressure at the open end (DC-blocked bore output)
    var sample = this.dcBlocker.process(boreOut) * this.outputGain;

    // Silence detection
    var isWorkletBreathStopped = !this.blowing && this.breathEnvelope < 0.001;
    var isWorkletSilentAfterBlow = isWorkletBreathStopped && Math.abs(sample) < 0.00005;
    if (isWorkletSilentAfterBlow) {
      this.silenceCounter++;
      if (this.silenceCounter > this.sampleRate * 0.2) {
        this.active = false;
        return 0;
      }
    } else {
      this.silenceCounter = 0;
    }

    return sample * 0.8;
  }

  isFinished() {
    return !this.active;
  }
}

// ============================================================
// Model 4: Struck Object (Modal Synthesis)
// ============================================================

class StrikeModel {
  constructor(sr) {
    this.sampleRate = sr;
    this.active = false;
    this.decayCounter = 0;
    this.maxDecay = 0;
    this.dcBlocker = new DCBlocker();

    // Modal resonators (bandpass filters via biquad)
    this.numModes = 16;
    this.modes = [];
    for (var i = 0; i < this.numModes; i++) {
      this.modes.push({
        freq: 440,
        gain: 0,
        decay: 0.999,
        y1: 0, y2: 0,
        b0: 0, a1: 0, a2: 0
      });
    }

    // Parameters
    this.strikePosition = 50;
    this.hardness = 50;
    this.material = 'metal'; // 'wood', 'metal', 'glass', 'membrane'
    this.decayTime = 70;
    this.outputScale = 1.0;
  }

  // Material-specific partial ratios
  getPartialRatios(material) {
    switch (material) {
      case 'wood':
        // Bar modes (roughly f * n^2)
        return [1, 2.76, 5.40, 8.93, 13.34, 18.64, 24.82, 31.87,
                39.81, 48.62, 58.31, 68.88, 80.33, 92.66, 105.86, 119.94];
      case 'metal':
        // Metallic: slightly inharmonic
        return [1, 2.0, 3.01, 4.03, 5.06, 6.12, 7.21, 8.34,
                9.52, 10.75, 12.04, 13.40, 14.83, 16.34, 17.94, 19.63];
      case 'glass':
        // Glass: strongly inharmonic
        return [1, 2.32, 4.15, 6.48, 9.31, 12.64, 16.47, 20.80,
                25.63, 30.96, 36.79, 43.12, 49.95, 57.28, 65.11, 73.44];
      case 'membrane':
        // Drum membrane (circular): accurate Bessel function zeros
        return [1.000, 1.594, 2.136, 2.296, 2.653, 2.918, 3.156, 3.501,
                3.600, 3.652, 4.060, 4.154, 4.347, 4.610, 4.832, 5.132];
      default:
        return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    }
  }

  // Configure a modal resonator as a bandpass biquad
  configureMode(mode, freq, bandwidth) {
    var sr = this.sampleRate;
    if (freq >= sr / 2 - 100) freq = sr / 2 - 100; // Nyquist safety
    if (freq < 20) freq = 20;

    var w0 = 2 * Math.PI * freq / sr;
    var cosw0 = Math.cos(w0);
    var sinw0 = Math.sin(w0);
    var alpha = sinw0 / (2 * (freq / bandwidth));

    var a0 = 1 + alpha;
    mode.b0 = (sinw0 / 2) / a0;
    mode.a1 = (-2 * cosw0) / a0;
    mode.a2 = (1 - alpha) / a0;
    mode.freq = freq;
  }

  noteOn(freq, velocity) {
    this.active = true;
    this.decayCounter = 0;

    var vel = (velocity || 100) / 127;
    var ratios = this.getPartialRatios(this.material);
    var nyquist = this.sampleRate / 2 - 100;

    // Hardness affects the spectrum of the excitation and contact time
    var hardnessFactor = 0.3 + (this.hardness / 100) * 0.7;

    // Strike position: suppress modes where position is a node
    var strikePos = 0.05 + (this.strikePosition / 100) * 0.45;

    // Decay time
    var baseDecay = 0.5 + (this.decayTime / 100) * 9.5;
    this.maxDecay = Math.floor(this.sampleRate * baseDecay);

    // Set up modal resonators with frequency-dependent decay
    for (var i = 0; i < this.numModes; i++) {
      // Mode coupling: slight detuning based on mode number (nonlinear coupling sim)
      var detune = 1.0 + (Math.random() * 2 - 1) * 0.001 * (i + 1) * vel;
      var modeFreq = freq * ratios[i] * detune;
      if (modeFreq >= nyquist) {
        this.modes[i].gain = 0;
        continue;
      }

      // Frequency-dependent decay: higher modes decay faster (Q inversely proportional to mode number)
      var baseQ = 0.002 + (1 - this.decayTime / 100) * 0.02;
      var modeQ = baseQ * (1 + i * 0.15); // Higher modes get wider bandwidth = faster decay
      var bw = modeFreq * modeQ;
      this.configureMode(this.modes[i], modeFreq, Math.max(0.5, bw));

      // Gain: decreases for higher partials, modulated by hardness and strike position
      var positionGain = Math.abs(Math.sin(Math.PI * (i + 1) * strikePos));
      var spectralGain = Math.pow(hardnessFactor, i * 0.15);
      var distanceDecay = 1 / (1 + i * 0.3);

      this.modes[i].gain = vel * positionGain * spectralGain * distanceDecay;
      this.modes[i].y1 = 0;
      this.modes[i].y2 = 0;
    }

    var totalGain = 0;
    for (var i = 0; i < this.numModes; i++) {
      totalGain += Math.abs(this.modes[i].gain);
    }
    this.outputScale = totalGain > 0 ? (0.8 / totalGain) : 1.0;

    // Contact time derived from hardness (harder = shorter contact)
    var contactMs = 0.5 + (1 - hardnessFactor) * 4.0; // 0.5ms to 4.5ms
    this.exciteSamples = Math.max(1, Math.floor(this.sampleRate * contactMs * 0.001));
    this.exciteRemaining = this.exciteSamples;
    this.exciteLevel = vel * 0.8;
  }

  noteOff() {
    // Struck objects decay naturally — just shorten the max decay
    this.maxDecay = Math.min(this.maxDecay, this.decayCounter + Math.floor(this.sampleRate * 0.5));
  }

  process() {
    if (!this.active) return 0;

    this.decayCounter++;
    if (this.decayCounter > this.maxDecay) {
      this.active = false;
      return 0;
    }

    // Excitation: raised cosine impulse (smoother than half-sine)
    var excitation = 0;
    if (this.exciteRemaining > 0) {
      var t = 1 - (this.exciteRemaining / this.exciteSamples);
      // Raised cosine: 0.5 * (1 - cos(2*pi*t)) — smoother onset and release
      excitation = 0.5 * (1 - Math.cos(2 * Math.PI * t)) * this.exciteLevel;
      // Add noise component that fades with excitation
      excitation += (Math.random() * 2 - 1) * this.exciteLevel * 0.2 * (1 - t);
      this.exciteRemaining--;
    }

    // Sum modal resonators
    var output = 0;
    for (var i = 0; i < this.numModes; i++) {
      var m = this.modes[i];
      if (m.gain === 0) continue;

      // Biquad bandpass: y[n] = b0*x[n] - a1*y[n-1] - a2*y[n-2]
      var y = m.b0 * excitation - m.a1 * m.y1 - m.a2 * m.y2;
      m.y2 = m.y1;
      m.y1 = y;

      output += y * m.gain;
    }

    output = this.dcBlocker.process(output) * this.outputScale;
    // Soft limiter (tanh approximation) to tame transient peaks
    if (output > 0.9 || output < -0.9) {
      output = output / (1.0 + Math.abs(output));
    }

    // Silence detection
    var isWorkletStrikeFinished = this.exciteRemaining <= 0 && this.decayCounter > this.sampleRate * 0.5;
    var isWorkletStrikeSilent = isWorkletStrikeFinished && Math.abs(output) < 0.00001;
    if (isWorkletStrikeSilent) {
      this.active = false;
      return 0;
    }

    return output;
  }

  isFinished() {
    return !this.active;
  }
}

// ============================================================
// Physical Model Voice
// ============================================================

class PhysicalVoice {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.active = false;
    this.midiNote = -1;
    this.instId = 0;
    this.modelType = 'pluck';

    // One of each model type (reused per voice)
    this.pluck = new PluckModel(sampleRate);
    this.bow = new BowModel(sampleRate);
    this.blow = new BlowModel(sampleRate);
    this.strike = new StrikeModel(sampleRate);
    this.currentModel = this.pluck;
  }

  noteOn(midiNote, velocity, noteFreq, settings) {
    this.active = true;
    this.midiNote = midiNote;
    this.instId = settings.instId || 0;
    this.modelType = settings.model || 'pluck';

    // Select model and apply parameters
    switch (this.modelType) {
      case 'pluck':
        this.currentModel = this.pluck;
        this.pluck.damping = settings.damping != null ? settings.damping : 50;
        this.pluck.brightness = settings.brightness != null ? settings.brightness : 60;
        this.pluck.excitation = settings.excitation || 'noise';
        this.pluck.bodySize = settings.bodySize != null ? settings.bodySize : 50;
        this.pluck.decayTime = settings.decayTime != null ? settings.decayTime : 70;
        break;

      case 'bow':
        this.currentModel = this.bow;
        this.bow.bowPressure = settings.bowPressure != null ? settings.bowPressure : 50;
        this.bow.bowPosition = settings.bowPosition != null ? settings.bowPosition : 50;
        this.bow.brightness = settings.brightness != null ? settings.brightness : 60;
        this.bow.humanization = settings.humanization || 0;
        break;

      case 'blow':
        this.currentModel = this.blow;
        this.blow.breathPressure = settings.breathPressure != null ? settings.breathPressure : 50;
        this.blow.embouchure = settings.embouchure != null ? settings.embouchure : 50;
        this.blow.brightness = settings.brightness != null ? settings.brightness : 60;
        this.blow.humanization = settings.humanization || 0;
        break;

      case 'strike':
        this.currentModel = this.strike;
        this.strike.strikePosition = settings.strikePosition != null ? settings.strikePosition : 50;
        this.strike.hardness = settings.hardness != null ? settings.hardness : 50;
        this.strike.material = settings.material || 'metal';
        this.strike.decayTime = settings.decayTime != null ? settings.decayTime : 70;
        break;

      default:
        this.currentModel = this.pluck;
    }

    this.currentModel.noteOn(noteFreq, velocity);
  }

  noteOff() {
    if (this.currentModel) {
      this.currentModel.noteOff();
    }
  }

  process() {
    if (!this.active) return 0;
    var sample = this.currentModel.process();
    var isPluck = (this.modelType === 'pluck');
    if (isPluck) {
      sample = sample * PLUCK_OUTPUT_SCALE;
    }
    if (this.currentModel.isFinished()) {
      this.active = false;
    }
    return sample;
  }
}

// ============================================================
// Physical Model Worklet Processor
// ============================================================

class PhysicalModelProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.maxVoices = 64; // 16 voices x 4 instruments
    this.voices = [];
    for (var i = 0; i < this.maxVoices; i++) {
      this.voices.push(new PhysicalVoice(sampleRate));
    }
    this.activeVoiceIndices = [];

    this.port.onmessage = this.handleMessage.bind(this);
    this.port.postMessage({ type: 'ready' });
  }

  handleMessage(event) {
    var data = event.data;

    switch (data.type) {
      case 'noteOn':
        this.startNote(data.midiNote, data.velocity, data.noteFreq, data.settings);
        break;

      case 'noteOff':
        this.stopNote(data.midiNote, data.instId);
        break;

      case 'allNotesOff':
        this.stopAllNotes(data.instId);
        break;

      case 'updateParams':
        this.updateParams(data.instId, data.params);
        break;
    }
  }

  startNote(midiNote, velocity, noteFreq, settings) {
    var voice = null;
    var instId = settings.instId || 0;

    // Find a free voice
    for (var i = 0; i < this.maxVoices; i++) {
      if (!this.voices[i].active) {
        voice = this.voices[i];
        break;
      }
    }

    // Voice stealing: steal oldest for same instrument
    if (!voice) {
      for (var j = 0; j < this.maxVoices; j++) {
        if (this.voices[j].instId === instId) {
          voice = this.voices[j];
          break;
        }
      }
      if (!voice) voice = this.voices[0];
    }

    voice.noteOn(midiNote, velocity, noteFreq, settings);

    // Track active voice index (find index of this voice)
    var voiceIdx = this.voices.indexOf(voice);
    if (this.activeVoiceIndices.indexOf(voiceIdx) === -1) {
      this.activeVoiceIndices.push(voiceIdx);
    }
  }

  stopNote(midiNote, instId) {
    for (var i = 0; i < this.maxVoices; i++) {
      var v = this.voices[i];
      var isWorkletMatchingVoice = v.active && v.midiNote === midiNote && v.instId === instId;
      if (isWorkletMatchingVoice) {
        v.noteOff();
      }
    }
  }

  stopAllNotes(instId) {
    for (var i = 0; i < this.maxVoices; i++) {
      if (instId === undefined || this.voices[i].instId === instId) {
        if (this.voices[i].active) {
          this.voices[i].noteOff();
        }
      }
    }
  }

  updateParams(instId, params) {
    // Update parameters on active voices for live tweaking
    for (var i = 0; i < this.maxVoices; i++) {
      var v = this.voices[i];
      if (v.active && v.instId === instId) {
        var model = v.currentModel;
        if (!model) continue;

        // Apply parameter updates based on model type
        if (v.modelType === 'pluck') {
          if (params.damping != null) model.damping = params.damping;
          if (params.brightness != null) {
            model.brightness = params.brightness;
            model.loopFilter.setCoeff(0.5 + (params.brightness / 100) * 0.45);
          }
          if (params.bodySize != null) model.bodySize = params.bodySize;
        } else if (v.modelType === 'bow') {
          if (params.bowPressure != null) model.bowPressure = params.bowPressure;
          if (params.bowPosition != null) model.bowPosition = params.bowPosition;
          if (params.brightness != null) model.brightness = params.brightness;
        } else if (v.modelType === 'blow') {
          if (params.breathPressure != null) model.breathPressure = params.breathPressure;
          if (params.embouchure != null) model.embouchure = params.embouchure;
          if (params.brightness != null) model.brightness = params.brightness;
        } else if (v.modelType === 'strike') {
          if (params.strikePosition != null) model.strikePosition = params.strikePosition;
          if (params.hardness != null) model.hardness = params.hardness;
          if (params.material != null) model.material = params.material;
        }
      }
    }
  }

  process(inputs, outputs, parameters) {
    var output = outputs[0];
    var channel = output[0];
    if (!channel) return true;

    var active = this.activeVoiceIndices;
    var voices = this.voices;
    var numActive = active.length;

    if (numActive === 0) {
      for (var z = 0; z < channel.length; z++) { channel[z] = 0; }
      return true;
    }

    for (var s = 0; s < channel.length; s++) {
      var sample = 0;
      for (var a = 0; a < numActive; a++) {
        sample += voices[active[a]].process() * PHYS_VOICE_OUTPUT_GAIN;
      }
      // Smooth Pade approximant of tanh soft clip (always-on, no hard knee)
      var ss = sample * sample;
      channel[s] = sample * (27 + ss) / (27 + 9 * ss);
    }

    // Post-buffer compaction: remove finished voices in-place
    var writePtr = 0;
    for (var i = 0; i < numActive; i++) {
      if (voices[active[i]].active) {
        active[writePtr] = active[i];
        writePtr++;
      }
    }
    active.length = writePtr;

    return true;
  }
}

registerProcessor('physical-model', PhysicalModelProcessor);
