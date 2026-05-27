// Super Synth Lab - Physical Modelling Synthesis Engine Module
// Karplus-Strong, Bowed String, Blown Pipe, Modal Synthesis
// v1.0.2 — fix: silence at C3-C6 across pluck/blow/strike families
//   pluck: per-round-trip damping (was per-sample, killing high notes)
//   blow:  reduced cascaded loop filter attenuation + jet length floor + noise-seed boost
//   strike: widened mode bandwidths + pluck-like excitation pulse at high notes
//
// ================================================================
// EDUCATIONAL CONTEXT: Physical Modelling Synthesis
// ================================================================
//
// Physical modelling synthesis generates sound by simulating the
// physics of acoustic instruments rather than playing back samples
// or shaping oscillators. The field was pioneered by Kevin Karplus
// and Alex Strong (1983) with their plucked-string algorithm, then
// formalized into digital waveguide theory by Julius O. Smith III
// at Stanford's CCRMA in the late 1980s and 1990s.
//
// How it works:
//   Instead of storing waveforms, we solve simplified versions of
//   the wave equation in real time. A vibrating string becomes a
//   delay line with feedback; a pipe becomes a delay line with
//   reflection. The key insight is that traveling-wave solutions
//   to the 1D wave equation can be computed with just delay lines,
//   filters, and nonlinear junctions — no differential equations
//   at audio rate.
//
// Four models are implemented here:
//   1. Pluck (Karplus-Strong): delay line + averaging filter
//   2. Bow (waveguide + friction): two delay lines + bow table
//   3. Blow (waveguide + jet): bore delay + jet delay + cubic
//   4. Strike (modal): bank of resonant bandpass filters
//
// Signal flow (Karplus-Strong, simplest case):
//   noise burst --> [delay line, N samples] --+--> output
//                        ^                    |
//                        |   lowpass filter    |
//                        +----<----<----<-----+
//
// Key formula (Karplus-Strong):
//   y(n) = alpha * (y(n - N) + y(n - N - 1)) / 2
//   where N = round(sampleRate / frequency), alpha = damping
//   The two-point average is a simple FIR lowpass that removes
//   high-frequency energy each round trip, modeling string damping.
//
// Hardware lineage:
//   Yamaha VL1 (1994, first commercial PM synth),
//   Korg OASYS (2005), Applied Acoustics Systems Tassman/Chromaphone
//
// Architecture note:
//   This file is the HOST-SIDE engine (runs on main thread). It
//   manages parameters, model selection, voice allocation, and
//   audio routing. The real-time DSP runs in physical-worklet.js
//   (AudioWorklet thread) or in the ScriptProcessor fallback
//   classes defined below (FBPluckModel, FBBowModel, etc.).
//
// References:
//   - Karplus, K. & Strong, A. (1983) "Digital Synthesis of
//     Plucked-String and Drum Timbres", CMJ 7(2), pp. 43-55
//   - Smith, J.O. (2010) Physical Audio Signal Processing, CCRMA
//     (https://ccrma.stanford.edu/~jos/pasp/)
//   - Valimaki, V. et al. (2010) "Digital Audio Effects", Wiley
//   - Roads, C. (1996) The Computer Music Tutorial, MIT Press, Ch. 7
//   - Jaffe, D. & Smith, J.O. (1983) "Extensions of the Karplus-
//     Strong Plucked-String Algorithm", CMJ 7(2), pp. 56-69
// ================================================================
(function() {
  'use strict';

  var SL = window.SynthLab;

  // ============================================================
  // Constants
  // ============================================================

  var MAX_VOICES_PER_INSTRUMENT = 16;

  // Per-model voice level scaling — keeps 4 simultaneous voices below
  // the Pade tanh soft-clipper knee (~0.9) so dynamics are preserved.
  // Bow model is self-limiting via bow table (~0.15-0.4 peak).
  var BLOW_VOICE_LEVEL   = 0.22;  // 4 voices: 0.22 * 4 * 1.0 = 0.88
  var PLUCK_VOICE_LEVEL  = 0.25;  // transient, slightly hotter OK
  var STRIKE_VOICE_LEVEL = 0.25;  // modal, self-normalizes but still hot

  /** Default physical modelling settings for a new instrument */
  var DEFAULT_PHYSICAL_SETTINGS = {
    model: 'pluck',
    damping: 50,
    brightness: 60,
    excitation: 'noise',
    bodySize: 50,
    decayTime: 70,
    bowPressure: 50,
    bowPosition: 50,
    breathPressure: 50,
    embouchure: 50,
    strikePosition: 50,
    hardness: 50,
    material: 'metal',
    humanization: 0
  };

  // ============================================================
  // State
  // ============================================================

  var audioContext = null;
  var physicalWorkletNodes = [null, null, null, null];
  var isWorkletReady = false;
  var isWorkletInitializing = false;
  var isWorkletReadyPromise = null;

  // ScriptProcessor fallback state
  var scriptNodes = [null, null, null, null];
  var shouldUseFallback = false;

  // Per-instrument settings cache (instId -> settings object)
  var instrumentSettings = {};

  // Per-instrument filter nodes (instId -> BiquadFilterNode)
  var physFilterNodes = {};

  // Track which instruments have been permanently connected
  var connectedInsts = [false, false, false, false];

  // ============================================================
  // Fallback Voice Classes (for ScriptProcessor)
  // ============================================================

  // ---------------------------------------------------------------
  // Circular Buffer (Delay Line Implementation)
  // A circular (ring) buffer is the standard way to implement a
  // delay line in DSP. Instead of shifting all samples forward each
  // tick (O(N) per sample), we advance a write pointer modulo the
  // buffer length (O(1) per sample). Reading at offset D gives the
  // sample written D steps ago. Fractional delays use linear
  // interpolation between adjacent samples — this also provides
  // implicit lowpass filtering that aids waveguide stability.
  // See: Smith, J.O. (2010) Physical Audio Signal Processing, Ch. 4
  // ---------------------------------------------------------------

  // Circular buffer for fallback
  function FBCircularBuffer(maxLen) {
    this.buffer = new Float64Array(maxLen);
    this.length = maxLen;
    this.writeIndex = 0;
  }
  FBCircularBuffer.prototype.write = function(v) {
    this.buffer[this.writeIndex] = v;
    this.writeIndex = (this.writeIndex + 1) % this.length;
  };
  FBCircularBuffer.prototype.read = function(delay) {
    var intDelay = Math.floor(delay);
    var frac = delay - intDelay;
    var idx0 = (this.writeIndex - intDelay - 1 + this.length * 2) % this.length;
    var idx1 = (idx0 - 1 + this.length) % this.length;
    return this.buffer[idx0] * (1 - frac) + this.buffer[idx1] * frac;
  };
  FBCircularBuffer.prototype.clear = function() {
    this.buffer.fill(0);
    this.writeIndex = 0;
  };

  // ---------------------------------------------------------------
  // One-Pole Lowpass Filter
  // The simplest IIR filter: y(n) = a * x(n) + (1 - a) * y(n-1).
  // Coefficient 'a' near 0 = heavy smoothing (dark tone), near 1 =
  // pass-through (bright). In physical models, this sits inside the
  // feedback loop to simulate frequency-dependent energy loss: real
  // strings lose high-frequency energy faster than low-frequency
  // energy on each reflection, which is why a plucked string's
  // timbre mellows over time.
  // See: Smith, J.O. (2010) PASP, Section 1.1.3 (one-pole filters)
  // ---------------------------------------------------------------

  // One-pole lowpass
  function FBOnePole() { this.a = 0.5; this.prev = 0; }
  FBOnePole.prototype.setCoeff = function(a) { this.a = Math.max(0, Math.min(1, a)); };
  FBOnePole.prototype.process = function(x) { this.prev = this.a * x + (1 - this.a) * this.prev; return this.prev; };
  FBOnePole.prototype.clear = function() { this.prev = 0; };

  // ---------------------------------------------------------------
  // DC Blocker
  // A first-order highpass that removes any DC offset that
  // accumulates in the feedback loop. Transfer function:
  //   H(z) = (1 - z^-1) / (1 - R * z^-1)
  // R = 0.995 places the pole very close to z = 1, giving a -3 dB
  // point around 4 Hz at 44.1 kHz — inaudible, but prevents the
  // output from drifting away from zero over time.
  // See: Smith, J.O. (2010) PASP, Appendix B (DC Blocker)
  // ---------------------------------------------------------------

  // DC blocker
  function FBDCBlocker() { this.x1 = 0; this.y1 = 0; this.R = 0.995; }
  FBDCBlocker.prototype.process = function(x) { var y = x - this.x1 + this.R * this.y1; this.x1 = x; this.y1 = y; return y; };
  FBDCBlocker.prototype.clear = function() { this.x1 = 0; this.y1 = 0; };

  // ============================================================
  // Fallback: Pluck Model (Karplus-Strong Algorithm)
  // ============================================================
  //
  // ---------------------------------------------------------------
  // The Karplus-Strong algorithm (1983) is elegantly simple: fill a
  // delay line of length N = sampleRate/freq with noise, then on
  // each sample, read the oldest value, lowpass filter it, and write
  // it back. The noise gradually converges to a periodic waveform
  // whose pitch is determined by the delay length. The averaging
  // filter (y = 0.5 * (y[n-N] + y[n-N-1])) removes high harmonics
  // first, mimicking how a real plucked string's overtones die away
  // faster than its fundamental — a phenomenon Helmholtz described
  // in 1863 as frequency-dependent damping.
  //
  // The excitation type shapes the initial spectrum:
  //   - noise: white noise burst (classic KS, rich harmonics)
  //   - impulse: Hann-windowed pulse (fewer harmonics, harp-like)
  //   - pick: triangular with noise (guitar pick scrape character)
  //
  // Body resonance filters model the acoustic body of the
  // instrument. A guitar body has 5-10 prominent resonance modes
  // (Helmholtz air mode ~100 Hz, top plate ~250 Hz, etc.) that
  // color the string's output. We simulate these with parallel
  // bandpass (two-pole) filters tuned to measured guitar body modes.
  //
  // See: Karplus & Strong (1983), CMJ 7(2); Jaffe & Smith (1983)
  // ---------------------------------------------------------------

  // Guitar body resonance frequencies (Hz), Q values, and mix level
  var BODY_RES_FREQS = [100, 250, 450, 800, 2500];
  var BODY_RES_Q     = [5,   8,   6,   4,   3];
  var BODY_RES_MIX   = 0.3;

  function FBPluckModel(sr) {
    this.sampleRate = sr;
    this.delayLine = new FBCircularBuffer(Math.ceil(sr / 20));
    this.loopFilter = new FBOnePole();
    this.dcBlocker = new FBDCBlocker();
    this.active = false;
    this.decayCounter = 0;
    this.maxDecay = 0;
    this.damping = 50; this.brightness = 60; this.excitation = 'noise';
    this.bodySize = 50; this.decayTime = 70; this.delayLength = 100;
    this._perSampleDecay = 1.0;
    // Body resonance filters (bandpass, tuned to guitar body modes)
    this.bodyFilters = [];
    for (var bf = 0; bf < BODY_RES_FREQS.length; bf++) {
      var res = new FBTwoPole();
      var radius = 1 - (Math.PI * BODY_RES_FREQS[bf] / BODY_RES_Q[bf]) / sr;
      if (radius < 0.8) { radius = 0.8; }
      if (radius > 0.9999) { radius = 0.9999; }
      res.setResonance(BODY_RES_FREQS[bf], radius, sr);
      this.bodyFilters.push(res);
    }
  }
  FBPluckModel.prototype.noteOn = function(freq, velocity) {
    this.active = true;
    var safeFreq = freq || 0.001;
    var period = this.sampleRate / safeFreq;
    this.delayLength = period - 0.5; // compensate for averaging filter group delay
    this.loopFilter.setCoeff(0.5 + (this.brightness / 100) * 0.45);
    this.maxDecay = Math.floor(this.sampleRate * (1 + (this.decayTime / 100) * 9));
    // Per-round-trip damping: the previous implementation used a per-sample
    // multiplier `1 - damping*0.003` which at high frequencies (short period)
    // compounds to complete silence in a few ms. We instead pick a per-round-trip
    // loss fraction and spread it across `period` samples so decay is
    // frequency-independent.
    var DAMPING_PER_RT_MAX_LOSS = 0.015;        // damping=100 -> 1.5%/round trip
    var dampingNorm = this.damping / 100;
    var lossPerRoundTrip = dampingNorm * DAMPING_PER_RT_MAX_LOSS;
    var minPeriodForDecay = 2.0;
    var safePeriod = period < minPeriodForDecay ? minPeriodForDecay : period;
    var guardedPeriod = safePeriod || 1;
    this._perSampleDecay = Math.pow(1.0 - lossPerRoundTrip, 1.0 / guardedPeriod);
    this.decayCounter = 0;
    this.delayLine.clear(); this.dcBlocker.clear(); this.loopFilter.clear();
    for (var bfc = 0; bfc < this.bodyFilters.length; bfc++) { this.bodyFilters[bfc].clear(); }
    var vel = (velocity || 100) / 127;
    var intPeriod = Math.ceil(period);
    if (this.excitation === 'impulse') {
      // Short windowed impulse burst (half-Hann window, ~8% of period)
      var burstLen = Math.max(3, Math.floor(intPeriod * 0.08));
      for (var i = 0; i < burstLen; i++) {
        var w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (burstLen - 1)));
        this.delayLine.write(w * vel * 0.9);
      }
      for (var i = burstLen; i < intPeriod; i++) this.delayLine.write(0);
    } else if (this.excitation === 'pick') {
      var half = Math.floor(intPeriod / 2);
      var safeHalf = half || 1;
      for (var i = 0; i < intPeriod; i++) {
        var env = i < half ? i / safeHalf : (intPeriod - i) / ((intPeriod - half) || 1);
        this.delayLine.write((env + (Math.random() * 2 - 1) * 0.15) * vel * 0.5);
      }
    } else {
      for (var i = 0; i < intPeriod; i++) {
        this.delayLine.write((Math.random() * 2 - 1) * vel * 0.85);
      }
    }
  };
  FBPluckModel.prototype.noteOff = function() {
    this.loopFilter.setCoeff(this.loopFilter.a * 0.7);
  };
  FBPluckModel.prototype.process = function() {
    if (!this.active) return 0;
    this.decayCounter++;
    if (this.decayCounter > this.maxDecay) { this.active = false; return 0; }
    var delayed = this.delayLine.read(this.delayLength - 1);
    var filtered = this.loopFilter.process(delayed);
    filtered *= this._perSampleDecay;
    this.delayLine.write(filtered);
    var dry = this.dcBlocker.process(filtered);
    // Body resonance: sum bandpass-filtered versions mixed with dry signal
    var bodySum = 0;
    for (var bf = 0; bf < this.bodyFilters.length; bf++) {
      bodySum += this.bodyFilters[bf].process(dry);
    }
    var out = dry + bodySum * BODY_RES_MIX;
    if (this.decayCounter > this.sampleRate * 0.5 && Math.abs(out) < 0.00001) { this.active = false; return 0; }
    return out * PLUCK_VOICE_LEVEL;
  };
  FBPluckModel.prototype.isFinished = function() { return !this.active; };

  // ============================================================
  // Two-Pole Resonant Filter (Body Resonance Simulation)
  // ============================================================
  //
  // ---------------------------------------------------------------
  // A two-pole filter creates a resonance peak at a specific
  // frequency. The transfer function is:
  //   H(z) = b0 / (1 + a1*z^-1 + a2*z^-2)
  // The pole radius controls Q (bandwidth): closer to 1.0 = narrower
  // peak = longer ring. We set coefficients from (frequency, radius):
  //   a1 = -2 * radius * cos(2*pi*freq/sr)
  //   a2 = radius^2
  //   b0 = (1 - radius^2) / 2    (normalize DC gain)
  // This is equivalent to a second-order IIR bandpass and is used
  // here to model individual resonant modes of an instrument body.
  // See: Smith, J.O. (2010) PASP, Section 9.2 (Biquad Filters)
  // ---------------------------------------------------------------

  function FBTwoPole() {
    this.y1 = 0; this.y2 = 0;
    this.b0 = 1; this.a1 = 0; this.a2 = 0;
  }
  FBTwoPole.prototype.setResonance = function(freq, radius, sr) {
    var w = 2 * Math.PI * freq / sr;
    this.a1 = -2 * radius * Math.cos(w);
    this.a2 = radius * radius;
    this.b0 = (1 - radius * radius) * 0.5;
  };
  FBTwoPole.prototype.process = function(input) {
    var y = this.b0 * input - this.a1 * this.y1 - this.a2 * this.y2;
    this.y2 = this.y1; this.y1 = y;
    return y;
  };
  FBTwoPole.prototype.clear = function() { this.y1 = 0; this.y2 = 0; };

  // ============================================================
  // Fallback: Bow Model (Digital Waveguide Bowed String)
  // ============================================================
  //
  // ---------------------------------------------------------------
  // Bowed string synthesis uses Smith's digital waveguide approach
  // with a nonlinear bow-string interaction. A real bowed string
  // exhibits Helmholtz motion (discovered by Hermann von Helmholtz,
  // 1863): the bow alternately sticks to and slips against the
  // string, creating a sawtooth-like displacement wave that travels
  // in both directions from the bow point.
  //
  // The model splits the string at the bow contact point into two
  // delay lines: neck (nut to bow) and bridge (bow to bridge). At
  // each sample, we compute the velocity difference between bow and
  // string, look it up in a friction table (the "bow table"), and
  // inject the resulting force into both delay lines.
  //
  // Signal flow:
  //   [neck delay] ---> nut (invert) -------+
  //                                          |---> bow table --+
  //   [bridge delay] --> bridge (LP+invert) -+                 |
  //        ^                                                   |
  //        +---<--- newVelocity = deltaV * bowTable(deltaV) <--+
  //
  // The bow table maps velocity difference to reflection
  // coefficient: when stuck (small deltaV), coefficient ~1.0
  // (string follows bow); when slipping (large deltaV), coefficient
  // drops toward 0 (string vibrates freely). This stick-slip
  // transition is what produces the characteristic sustained tone.
  //
  // Bow position splits the delay line asymmetrically, suppressing
  // harmonics whose nodes fall at the bow point (e.g., bowing at
  // 1/7 of string length suppresses the 7th harmonic).
  //
  // See: Smith, J.O. (2010) PASP, Ch. 9.3 (Bowed String)
  //      McIntyre, M. et al. (1983) "On the Oscillations of
  //        Musical Instruments", JASA 74(5), pp. 1325-1345
  // ---------------------------------------------------------------

  function FBBowModel(sr) {
    this.sampleRate = sr;
    var maxDelay = Math.ceil(sr / 20);
    this.neckDelay = new FBCircularBuffer(maxDelay);
    this.bridgeDelay = new FBCircularBuffer(maxDelay);
    this.stringFilter = new FBOnePole();
    this.stringFilter2 = new FBOnePole();  // Second string filter for near-bridge harmonics
    this.toneFilter1 = new FBOnePole();
    this.toneFilter2 = new FBOnePole();
    this.dcBlocker = new FBDCBlocker();
    this.active = false; this.bowing = false;
    this.decayCounter = 0; this.maxDecay = 0;
    this.bowTableOffset = 0; this.bowTableSlope = 3.0;
    this.maxVelocity = 0.3;
    this.baseNeckLength = 50; this.baseBridgeLength = 50;
    this.neckLength = 50; this.bridgeLength = 50;
    this.vibratoPhase = 0; this.vibratoFreq = 5.5; this.vibratoDepth = 0;
    this.maxVibratoDepth = 0.3;
    this.silentSamples = 0;
    this.bowPressure = 50; this.bowPosition = 50; this.brightness = 60;
    this.bowNoiseGain = 0.0;
    this.bowNoiseFilter = new FBOnePole();
    this.useStringFilter2 = false;  // Active for near-bridge positions
    // Humanization drift LFOs
    this.humanization = 0;
    this.driftPhase1 = 0;
    this.driftPhase2 = 0;
    this.driftRate1 = 0.15;
    this.driftRate2 = 0.22;
    this.baseMaxVelocity = 0.3;
  }
  // Bow friction table: models the stick-slip behavior of rosin on a string.
  // Returns a reflection coefficient (0 to 1): 1.0 = stuck (bow drags
  // string), ~0 = slipping (string vibrates freely). The function
  //   f(x) = (|x * slope + offset| + 0.75)^(-4)
  // creates a bell-shaped friction curve peaked near zero velocity
  // difference — this is the empirical friction model from the STK
  // (Synthesis ToolKit) by Perry Cook and Gary Scavone.
  FBBowModel.prototype.bowTable = function(input) {
    var sample = (input + this.bowTableOffset) * this.bowTableSlope;
    sample = Math.abs(sample) + 0.75;
    sample = Math.pow(sample, -4.0);
    if (sample > 1.0) sample = 1.0;
    return sample;
  };
  FBBowModel.prototype.noteOn = function(freq, velocity) {
    this.active = true; this.bowing = true;
    var safeFreq = freq || 0.001;
    var period = this.sampleRate / safeFreq;
    var bowPos = 0.12 + (this.bowPosition / 100) * 0.3;
    this.baseBridgeLength = Math.max(2, Math.floor(period * bowPos));
    this.baseNeckLength = Math.max(2, Math.floor(period * (1 - bowPos)));
    this.bridgeLength = this.baseBridgeLength;
    this.neckLength = this.baseNeckLength;

    var pos = this.bowPosition / 100;  // 0-1
    var press = this.bowPressure / 100; // 0-1
    var br = this.brightness / 100;     // 0-1

    // Bow table slope: low pressure = stiff (more overtones), high = soft (smoother)
    this.bowTableSlope = 5.0 - press * 3.0;
    var velNormBow = velocity / 127;
    var velCurvedBow = velNormBow * velNormBow;
    this.baseMaxVelocity = 0.1 + velCurvedBow * 0.4;
    this.maxVelocity = this.baseMaxVelocity;

    // String filter in loop: controls harmonic decay per round-trip
    // Near bridge (low pos) + bright = lots of harmonics survive
    // Over fingerboard (high pos) + dark = fundamental dominates
    var stringCoeff = 0.15 + br * 0.50 + (1.0 - pos) * 0.30;
    if (stringCoeff > 0.95) stringCoeff = 0.95;
    this.stringFilter.setCoeff(stringCoeff);

    // Second string filter for near-bridge bowing (pos < 35)
    // Near-bridge = more odd harmonics (edgy, nasal), needs extra high-pass behavior
    // Implemented as aggressive LP that emphasizes the harmonic structure difference
    if (pos < 0.35) {
      this.useStringFilter2 = true;
      // Near bridge: high coeff = lets harmonics through, creates edgy character
      var sf2Coeff = 0.70 + br * 0.25;
      if (sf2Coeff > 0.95) sf2Coeff = 0.95;
      this.stringFilter2.setCoeff(sf2Coeff);
    } else {
      this.useStringFilter2 = false;
      // Over fingerboard: very aggressive LP = warm, fundamental-heavy
      this.stringFilter2.setCoeff(0.20 + br * 0.30);
    }

    // Tone filters (cascaded = 2-pole rolloff for dramatic shaping)
    // Low brightness = heavy filtering (dark cello); high = open (bright erhu)
    var toneCoeff = 0.20 + br * 0.60 + (1.0 - pos) * 0.15;
    if (toneCoeff > 0.95) toneCoeff = 0.95;
    this.toneFilter1.setCoeff(toneCoeff);
    this.toneFilter2.setCoeff(toneCoeff);

    // Bow noise: rosin texture. High pressure = gritty, scratchy
    this.bowNoiseGain = press * press * 0.12;
    this.bowNoiseFilter.setCoeff(0.2 + br * 0.5);

    // Bow table offset: pressure shifts operating point
    this.bowTableOffset = press * 0.03 - pos * 0.015;

    // Vibrato frequency: varies with instrument character via bowPressure
    // Low pressure (glass, ethereal): slow ~3.5 Hz
    // Mid pressure (violin family): moderate ~5.5 Hz
    // High pressure (erhu, sarangi): faster ~6.5 Hz
    this.vibratoFreq = 3.5 + press * 3.0;

    // Vibrato depth: much wider range for more differentiation
    // Low pressure (glass, barely any): 0.05
    // High pressure (erhu, expressive): 0.60
    this.maxVibratoDepth = 0.05 + press * 0.55;

    this.maxDecay = Math.floor(this.sampleRate * 10);
    this.decayCounter = 0;
    this.vibratoPhase = 0; this.vibratoDepth = 0;
    this.silentSamples = 0;
    // Drift LFO: randomize rates per note
    this.driftPhase1 = Math.random();
    this.driftPhase2 = Math.random();
    this.driftRate1 = 0.1 + Math.random() * 0.2;
    this.driftRate2 = 0.1 + Math.random() * 0.2;
    this.neckDelay.clear(); this.bridgeDelay.clear();
    this.stringFilter.clear(); this.stringFilter2.clear();
    this.bowNoiseFilter.clear();
    this.toneFilter1.clear(); this.toneFilter2.clear();
    this.dcBlocker.clear();
  };
  FBBowModel.prototype.noteOff = function() { this.bowing = false; };
  FBBowModel.prototype.process = function() {
    if (!this.active) return 0;
    this.decayCounter++;
    if (this.decayCounter > this.maxDecay) { this.active = false; return 0; }
    // Humanization drift
    var fbDrift1 = 0;
    var fbDrift2 = 0;
    if (this.humanization > 0) {
      this.driftPhase1 += this.driftRate1 / this.sampleRate;
      if (this.driftPhase1 > 1) this.driftPhase1 -= 1;
      this.driftPhase2 += this.driftRate2 / this.sampleRate;
      if (this.driftPhase2 > 1) this.driftPhase2 -= 1;
      fbDrift1 = Math.sin(2 * Math.PI * this.driftPhase1);
      fbDrift2 = Math.sin(2 * Math.PI * this.driftPhase2);
      // Bow pressure drift: maxVelocity wanders +/- 20%
      this.maxVelocity = this.baseMaxVelocity * (1 + fbDrift1 * 0.40 * this.humanization);
    }
    if (this.bowing) {
      var vibratoFreqNow = this.vibratoFreq * (1 + fbDrift1 * 0.60 * this.humanization);
      this.vibratoPhase += vibratoFreqNow / this.sampleRate;
      if (this.vibratoPhase > 1) this.vibratoPhase -= 1;
      var rampSamples = this.sampleRate * 0.3;
      var safeRampSamples = rampSamples || 1;
      var vibTarget = this.maxVibratoDepth * (1 + fbDrift2 * 0.80 * this.humanization);
      if (this.decayCounter < rampSamples) {
        this.vibratoDepth = vibTarget * (this.decayCounter / safeRampSamples);
      } else {
        this.vibratoDepth = vibTarget;
      }
      var vibMod = Math.sin(2 * Math.PI * this.vibratoPhase) * this.vibratoDepth;
      this.neckLength = Math.max(2, this.baseNeckLength + vibMod);
      this.bridgeLength = Math.max(2, this.baseBridgeLength + vibMod);
    }
    var bridgeOut = this.bridgeDelay.read(this.bridgeLength - 1);
    var neckOut = this.neckDelay.read(this.neckLength - 1);
    var bridgeFiltered = this.stringFilter.process(bridgeOut);
    // Second string filter: near-bridge adds extra harmonic shaping
    if (this.useStringFilter2) {
      bridgeFiltered = this.stringFilter2.process(bridgeFiltered);
    }
    var bridgeReflection = -bridgeFiltered;
    var nutReflection = -neckOut;
    var stringVelocity = bridgeReflection + nutReflection;
    var bowVelocity = this.bowing ? this.maxVelocity : 0;
    // Add rosin noise to bow velocity for texture
    if (this.bowing && this.bowNoiseGain > 0) {
      var rawNoise = Math.random() * 2 - 1;
      bowVelocity += this.bowNoiseFilter.process(rawNoise) * this.bowNoiseGain;
    }
    var deltaV = bowVelocity - stringVelocity;
    var newVelocity = deltaV * this.bowTable(deltaV);
    this.neckDelay.write(bridgeReflection + newVelocity);
    this.bridgeDelay.write(nutReflection + newVelocity);
    // Output: cascaded tone filters for dramatic spectral shaping
    var out = this.toneFilter1.process(bridgeOut);
    out = this.toneFilter2.process(out);
    out = this.dcBlocker.process(out);
    if (!this.bowing) {
      if (Math.abs(out) < 0.00005) {
        this.silentSamples++;
        if (this.silentSamples > this.sampleRate * 0.3) { this.active = false; }
      } else {
        this.silentSamples = 0;
      }
    }
    return out;
  };
  FBBowModel.prototype.isFinished = function() { return !this.active; };

  // ============================================================
  // Fallback: Blow Model (Digital Waveguide Wind Instrument)
  // ============================================================
  //
  // ---------------------------------------------------------------
  // The blown pipe model simulates flutes, clarinets, and reed
  // instruments using Smith's digital waveguide framework. The core
  // is a bore delay line (modeling the air column inside the pipe)
  // with a jet delay line (modeling the air jet from mouth to
  // labium in flutes, or the reed-to-mouthpiece path in reeds).
  //
  // The bore resonates at f = sampleRate / (2 * boreLength) because
  // an open pipe inverts the pressure wave at the bell (negative
  // reflection), so the wave must travel TWO bore lengths for one
  // complete cycle. This half-wavelength resonance is why a flute
  // overblows at the octave (2x frequency) rather than the twelfth.
  //
  // The jet table (cubic nonlinearity: x*(x^2 - 1)) models the
  // turbulent interaction between the air jet and the returning
  // pressure wave at the embouchure hole. This nonlinearity is what
  // injects energy into the bore to sustain oscillation — it acts
  // as the "engine" that converts steady breath into periodic
  // vibration.
  //
  // Embouchure controls instrument character:
  //   Low (0-35%): flute family — cascaded lowpass, sinusoidal tone
  //   Mid (35-55%): pan flute / shakuhachi — moderate harmonics
  //   High (55-100%): reed family — rich harmonics, self-oscillation
  //
  // See: Smith, J.O. (2010) PASP, Ch. 9.8 (Single-Reed Instruments)
  //      Cook, P. (1992) "A Meta-Wind-Instrument Physical Model
  //        Controller", CCRMA Technical Report STAN-M-73
  //      Fletcher, N. & Rossing, T. (1998) The Physics of Musical
  //        Instruments, 2nd ed., Springer, Ch. 16 (Flutes)
  // ---------------------------------------------------------------

  function FBBlowModel(sr) {
    this.sampleRate = sr;
    var maxDelay = Math.ceil(sr / 20);
    this.boreDelay = new FBCircularBuffer(maxDelay);
    this.jetDelay = new FBCircularBuffer(Math.ceil(maxDelay / 2));
    this.dcBlocker = new FBDCBlocker();
    this.loopFilter = new FBOnePole();
    this.loopFilter2 = new FBOnePole();  // Cascaded loop filter for flutes
    this.toneFilter = new FBOnePole();
    this.active = false; this.blowing = false;
    this.decayCounter = 0; this.maxDecay = 0;
    this.silenceCounter = 0;
    this.lastOutput = 0; this.outputGain = 1.0;
    this.breathEnvelope = 0; this.breathAttackRate = 0; this.breathTarget = 0;
    this.noiseGain = 0.15;
    this.breathPressure = 50; this.embouchure = 50; this.brightness = 60;
    this.boreLength = 100; this.jetLength = 20;
    this.vibratoPhase = 0; this.vibratoFreq = 5.2; this.vibratoGain = 0.0;
    // Per-note derived params (set in noteOn)
    this.feedback = 0.995;
    this.exciteScale = 0.25;
    this.drive = 2.0;
    this.reedFeedbackGain = 0.0;  // Self-oscillating reed excitation
    this.harmonicRichness = 0.0;  // Feedback into loop for harmonic density
    this.useLoopFilter2 = false;  // Whether cascaded filter is active
    this.releaseGain = 1.0;       // Release envelope after noteOff
    // Humanization drift LFOs
    this.humanization = 0;
    this.driftPhase1 = 0;
    this.driftPhase2 = 0;
    this.driftRate1 = 0.18;
    this.driftRate2 = 0.25;
    this.baseBreathTarget = 0;
  }
  // Jet table: cubic nonlinearity f(x) = x * (x^2 - 1), clamped to [-1, 1].
  // This approximates the Bernoulli-driven jet deflection at the labium
  // (lip edge) of a flute. The cubic has three zero crossings (-1, 0, +1),
  // creating a natural saturation that bounds the oscillation amplitude.
  // At small amplitudes the cubic is nearly linear (startup regime); at
  // large amplitudes it folds back, limiting energy injection and producing
  // the characteristic warm saturation of overblown wind instruments.
  // See: Cook, P. (1992), CCRMA STAN-M-73; STK Flute implementation
  FBBlowModel.prototype.jetTable = function(input) {
    var out = input * (input * input - 1.0);
    if (out > 1.0) out = 1.0;
    if (out < -1.0) out = -1.0;
    return out;
  };
  FBBlowModel.prototype.noteOn = function(freq, velocity) {
    this.active = true; this.blowing = true;
    var safeFreq = freq || 0.001;
    var period = this.sampleRate / safeFreq;
    // Half-period bore length: with negative bell reflection (one round-trip
    // inversion) a delay of N samples resonates at sampleRate/(2*N). For the
    // fundamental to fall at the played frequency we need N = period/2.
    // (Previously bore = period - 2 placed resonance an octave low.)
    var MIN_BORE_DELAY = 4.0;                // high-note floor for bore delay line
    var MIN_JET_DELAY = 3.0;                 // required for fractional interpolation
    var BORE_HALF_PERIOD = 0.5;
    var BORE_FILTER_DELAY_COMP = 1.5;        // accounts for one-pole loop filter group delay
    var rawDelay = (period * BORE_HALF_PERIOD) - BORE_FILTER_DELAY_COMP;
    var delay = rawDelay < MIN_BORE_DELAY ? MIN_BORE_DELAY : rawDelay;
    var jetRatio = 0.1 + (this.embouchure / 100) * 0.35;
    this.boreLength = delay;
    var rawJetLength = delay * jetRatio;
    this.jetLength = rawJetLength < MIN_JET_DELAY ? MIN_JET_DELAY : rawJetLength;
    this.lastOutput = 0;
    var amplitudeLinear = velocity / 127;
    var amplitude = amplitudeLinear * amplitudeLinear;
    this.baseBreathTarget = 0.60 + amplitude * 0.25;
    this.breathTarget = this.baseBreathTarget;
    this.breathEnvelope = 0;
    this.outputGain = (amplitude + 0.001) * BLOW_VOICE_LEVEL;
    this.maxDecay = Math.floor(this.sampleRate * 8);
    this.decayCounter = 0; this.silenceCounter = 0; this.vibratoPhase = 0;
    this.releaseGain = 1.0;
    // Drift LFO: randomize rates per note
    this.driftPhase1 = Math.random();
    this.driftPhase2 = Math.random();
    this.driftRate1 = 0.1 + Math.random() * 0.2;
    this.driftRate2 = 0.1 + Math.random() * 0.2;
    this.boreDelay.clear(); this.jetDelay.clear();
    this.dcBlocker.clear();

    var emb = this.embouchure / 100;  // 0-1
    var bright = this.brightness / 100; // 0-1
    var bp = this.breathPressure / 100; // 0-1

    // === CORE LOOP PARAMETERS ===
    // Embouchure = PRIMARY differentiator (flute vs reed character)
    // Brightness = tonal color only (dark vs bright version of that character)
    // Breath pressure = energy (soft vs loud)

    // Feedback: combined with BORE_END_REFLECTION=0.995, a 0.998 floor puts
    // round-trip loop gain very close to unity so the bore can self-sustain
    // on breath excitation. Below 0.995 total loop gain (seen at the previous
    // 0.992 floor) the resonator damps within ~150 ms at C3 and the output
    // degenerates to breath-noise shaped by the tone filter.
    this.feedback = 0.998 + emb * 0.001; // 0.998 (whistle) to 0.999 (drone)

    // Loop filter INSIDE bore: #1 differentiator
    // Low emb = LP filters for near-sinusoidal (flute)
    // High emb = gentle LP = rich harmonics (reed)
    var loopCoeff = 0.25 + emb * 0.65;
    if (loopCoeff > 0.95) loopCoeff = 0.95;
    this.loopFilter.setCoeff(loopCoeff);
    this.loopFilter.clear();

    // Cascaded second loop filter: active for flute-family (emb < 40)
    // Uses a HIGH coefficient (closer to 1.0 = pass-through) to avoid killing
    // loop gain. Previous floor of 0.80 caused enough per-round-trip attenuation
    // that high-frequency notes (C3+) would fall below the oscillation threshold
    // when combined with the primary loop filter and reflection factor of 0.5.
    // With NEGATIVE bell reflection (proper waveguide topology), the per-round
    // loop gain is roughly feedback * lf1Gain * lf2Gain * reflection ~ 0.99 *
    // 1.0 * 1.0 * 0.95 = 0.94 at DC. Loop-filter coefficients above ~0.5 leave
    // the LP DC-gain at 1.0 (one-pole y = a*x + (1-a)*y has DC gain 1 always),
    // but provide rolloff at higher frequencies which damps high modes — that
    // shapes harmonic content without killing oscillation. Restored sane
    // coefficients now that the reflection sign is correct.
    if (emb < 0.40) {
      this.useLoopFilter2 = true;
      // Pushed toward pass-through (close to 1.0) so harmonics above the
      // fundamental aren't killed per-round-trip — flutes need that upper
      // content to register as a pitched tone rather than a fundamental
      // buried in broadband breath noise.
      var FLUTE_LOOP_FILTER2_FLOOR = 0.90;
      var FLUTE_LOOP_FILTER2_RANGE = 0.08;
      var lf2Coeff = FLUTE_LOOP_FILTER2_FLOOR + emb * FLUTE_LOOP_FILTER2_RANGE;
      this.loopFilter2.setCoeff(lf2Coeff);
    } else {
      this.useLoopFilter2 = false;
      this.loopFilter2.setCoeff(0.99);
    }
    this.loopFilter2.clear();

    // Tone filter on OUTPUT: brightness controls this independently
    var toneCoeff = 0.15 + bright * 0.80;
    if (toneCoeff > 0.95) toneCoeff = 0.95;
    this.toneFilter.setCoeff(toneCoeff);
    this.toneFilter.clear();

    // Coherent jet excitation (flow term). Raised the flute floor so the
    // coherent pressure term dominates the breath-noise term — previously
    // exciteScale=0.08 vs noiseGain=0.30 meant the loop was pumped mostly
    // by random noise, which is what the HNR diagnostic saw as "tuned
    // noise" (a weak tonal peak on a broadband floor).
    this.exciteScale = 0.25 + emb * 0.35; // 0.25 (flute) to 0.60 (reed)

    // Drive into the cubic jet-table x*(x*x-1). STK-typical flute drive is
    // ~2.0 — at that level the cubic has enough nonlinearity to pump real
    // harmonic content into the bore. Below ~1.5 the cubic degenerates to
    // near-linear feedback and the loop can't bootstrap resonance at low
    // frequencies (long periods have few round-trips per unit time).
    this.drive = 2.0 + emb * 6.0; // 2.0 (flute) to 8.0 (reed)

    // Breath turbulence. A small amount is needed to keep the cubic from
    // settling on a DC operating point at long periods (C3 and below).
    // Scaled so coherent jet (exciteScale) still dominates ~3:1 for flutes.
    this.noiseGain = 0.05 + bp * 0.06 + (1.0 - emb) * 0.08;

    // Reed self-oscillation feedback: reeds (emb > 55) get bore output
    // modulating excitation more aggressively for self-reinforcing oscillation
    if (emb > 0.55) {
      this.reedFeedbackGain = (emb - 0.55) * 0.8; // 0 to ~0.36 for max reed
    } else {
      this.reedFeedbackGain = 0.0;
    }

    // Harmonic richness: feeds bore output back into loop for density
    // Subtle for flutes, stronger for reeds
    this.harmonicRichness = emb * emb * 0.06; // 0 to 0.06

    // Attack: reeds speak instantly, flutes build slowly
    this.breathAttackRate = this.breathTarget / (this.sampleRate * (0.005 + (1 - emb) * 0.10));

    // Seed bore delay with noise burst. A larger seed amplitude bootstraps the
    // loop oscillator so short-period (high-frequency) notes have enough energy
    // to be picked up by the jet-table nonlinearity before decay takes over.
    var vel = velocity / 127;
    var intPeriod = Math.ceil(this.boreLength);
    var SEED_BASE_AMPLITUDE = 0.6;                   // was 0.3 — doubled
    var SEED_FLUTE_BOOST = 1.5;                      // extra boost for flute family
    var SEED_REED_BOOST = 1.3;                       // extra boost for reeds (emb > 0.55)
    for (var i = 0; i < intPeriod; i++) {
      var seedBoost = 1.0;
      if (emb < 0.35) {
        seedBoost = SEED_FLUTE_BOOST;
      } else if (emb > 0.55) {
        seedBoost = SEED_REED_BOOST;
      }
      this.boreDelay.write((Math.random() * 2 - 1) * vel * SEED_BASE_AMPLITUDE * seedBoost);
    }
  };
  FBBlowModel.prototype.noteOff = function() { this.blowing = false; };
  FBBlowModel.prototype.process = function() {
    if (!this.active) return 0;
    this.decayCounter++;
    if (this.decayCounter > this.maxDecay) { this.active = false; return 0; }

    // Humanization drift: slow LFO wander on breath pressure and vibrato
    if (this.humanization > 0) {
      this.driftPhase1 += this.driftRate1 / this.sampleRate;
      if (this.driftPhase1 > 1) this.driftPhase1 -= 1;
      this.driftPhase2 += this.driftRate2 / this.sampleRate;
      if (this.driftPhase2 > 1) this.driftPhase2 -= 1;
      var blowDrift1 = Math.sin(2 * Math.PI * this.driftPhase1);
      // Breath pressure drift: breathTarget wanders +/- 20%
      this.breathTarget = this.baseBreathTarget * (1 + blowDrift1 * 0.40 * this.humanization);
      // Vibrato rate drift: +/- 30%
      var blowDrift2 = Math.sin(2 * Math.PI * this.driftPhase2);
      this.vibratoFreq = 5.2 * (1 + blowDrift1 * 0.60 * this.humanization);
      this.vibratoGain = this.vibratoGain * (1 + blowDrift2 * 0.80 * this.humanization);
    }

    this.vibratoPhase += this.vibratoFreq / this.sampleRate;
    if (this.vibratoPhase > 1) this.vibratoPhase -= 1;
    var vibrato = Math.sin(2 * Math.PI * this.vibratoPhase) * this.vibratoGain;
    var breathPressure = 0;
    if (this.blowing) {
      if (this.breathEnvelope < this.breathTarget) {
        this.breathEnvelope += this.breathAttackRate;
        if (this.breathEnvelope > this.breathTarget) this.breathEnvelope = this.breathTarget;
      } else if (this.breathEnvelope > this.breathTarget) {
        // Allow envelope to drift down when target decreases
        this.breathEnvelope += (this.breathTarget - this.breathEnvelope) * 0.001;
      }
      breathPressure = this.breathEnvelope;
      breathPressure += breathPressure * this.noiseGain * (Math.random() * 2 - 1);
      breathPressure += vibrato;
    } else {
      this.breathEnvelope *= 0.975;
      this.releaseGain *= 0.9995;
      if (this.breathEnvelope > 0.001) breathPressure = this.breathEnvelope;
    }

    // ===== STK-style waveguide topology =====
    // Read bore delay (pressure wave returning from bell to mouth) and apply
    // loop filter (per-round-trip damping, controls harmonic content).
    var boreOut = this.boreDelay.read(this.boreLength - 1);
    var loopFiltered = this.loopFilter.process(boreOut);
    if (this.useLoopFilter2) {
      loopFiltered = this.loopFilter2.process(loopFiltered);
    }

    // Open-end reflection at the bell INVERTS the pressure wave. The prior
    // value of 0.95 produced per-round-trip loop gain of only ~0.942, which is
    // too damped for a waveguide to self-sustain — the seed burst decayed
    // within ~150ms at C3 and the audible output was breath noise weakly
    // shaped by a low-Q resonance (i.e. "filtered noise"). STK-family flute
    // models use reflections in the 0.99-0.995 range; the jet-table nonlinearity
    // keeps amplitude bounded so the resonator can stand this close to 1.
    var BORE_END_REFLECTION = 0.995;
    var endRefl = -loopFiltered * BORE_END_REFLECTION;

    // Read jet delay output (delayed breath excitation arriving at labium)
    var jetOut = this.jetDelay.read(this.jetLength - 1);

    // Jet excitation written into jet delay: breath pressure + breath noise
    var rawNoise = Math.random() * 2 - 1;
    var breathNoiseSig = breathPressure * this.noiseGain * rawNoise;
    var jetInput = breathPressure * this.exciteScale + breathNoiseSig;
    this.jetDelay.write(jetInput);

    // Jet table: nonlinear interaction between delayed jet and bore reflection
    // at the embouchure hole. The cubic produces the energy injection that
    // sustains oscillation against loop losses.
    var pressureDiff = jetOut + endRefl;
    var shaped = this.jetTable(pressureDiff * this.drive);

    // Reed self-oscillation: bore output couples into reed excitation
    if (this.reedFeedbackGain > 0) {
      shaped += boreOut * this.reedFeedbackGain * breathPressure * 0.5;
    }

    // Wave that travels back into the bore: reflected wave (endRefl, already
    // negated) sums with newly-injected jet excitation. The traveling-wave
    // sum at the mouth IS what propagates down the pipe.
    var boreInput = endRefl * this.feedback + shaped;
    boreInput += boreOut * this.harmonicRichness * this.releaseGain;

    // Soft limiter (cubic-clipper-like) to tame transients and reed runaway
    if (boreInput > 1.0 || boreInput < -1.0) {
      boreInput = boreInput / (1.0 + Math.abs(boreInput));
    }
    this.boreDelay.write(boreInput);

    // Output: tone filter shapes the radiated bore signal (not the input)
    var sample = this.toneFilter.process(boreOut);
    sample = this.dcBlocker.process(sample);
    sample = sample * this.outputGain * this.releaseGain;

    var isBreathStopped = !this.blowing && this.breathEnvelope < 0.001;
    var isSilentAfterBlow = isBreathStopped && Math.abs(sample) < 0.00005;
    if (isSilentAfterBlow) {
      this.silenceCounter++;
      if (this.silenceCounter > this.sampleRate * 0.2) { this.active = false; return 0; }
    } else {
      this.silenceCounter = 0;
    }
    return sample;
  };
  FBBlowModel.prototype.isFinished = function() { return !this.active; };

  // ============================================================
  // Fallback: Strike Model (Modal Synthesis)
  // ============================================================
  //
  // ---------------------------------------------------------------
  // Modal synthesis models struck/percussion instruments as a bank
  // of resonant filters, each tuned to one vibrational mode of the
  // object. Unlike waveguide models (which simulate wave propagation),
  // modal models directly implement the frequency-domain solution:
  // each mode is an exponentially decaying sinusoid at a specific
  // frequency, amplitude, and decay rate.
  //
  // A short excitation burst (the "strike") drives all filters
  // simultaneously. Each filter rings at its natural frequency,
  // and the sum produces the characteristic timbre of the material.
  //
  // Partial ratios define the material character:
  //   - Metal: nearly harmonic (1, 2, 3.01, 4.03...) — bell-like
  //   - Wood: quadratic spacing (1, 2.76, 5.40...) — marimba-like
  //     (bar modes go as n^2 per Euler-Bernoulli beam theory)
  //   - Glass: strongly inharmonic — shimmering, crystalline
  //   - Membrane: Bessel function zeros (1, 1.59, 2.14, 2.30...)
  //     from the 2D wave equation in polar coordinates (drumheads)
  //
  // Strike position modulates mode amplitudes via:
  //   gain_i = |sin(pi * (i+1) * strikePos)|
  // Striking at a node of mode i (where sin = 0) silences that
  // mode — this is why hitting a drum at the center emphasizes the
  // fundamental while hitting near the edge brings out overtones.
  //
  // See: Roads, C. (1996) Computer Music Tutorial, Ch. 7
  //      Adrien, J.-M. (1991) "The Missing Link: Modal Synthesis",
  //        in Representations of Musical Signals, MIT Press
  //      Fletcher, N. & Rossing, T. (1998) Physics of Musical
  //        Instruments, Ch. 3 (Bars and Plates)
  // ---------------------------------------------------------------

  function FBStrikeModel(sr) {
    this.sampleRate = sr;
    this.active = false; this.decayCounter = 0; this.maxDecay = 0;
    this.dcBlocker = new FBDCBlocker();
    this.numModes = 16;
    this.modes = [];
    for (var i = 0; i < this.numModes; i++) {
      this.modes.push({ freq: 440, gain: 0, y1: 0, y2: 0, b0: 0, a1: 0, a2: 0 });
    }
    this.strikePosition = 50; this.hardness = 50;
    this.material = 'metal'; this.decayTime = 70;
    this.outputScale = 1.0;
    this.exciteRemaining = 0; this.exciteSamples = 1; this.exciteLevel = 0.5;
  }
  FBStrikeModel.prototype.getPartialRatios = function(material) {
    var ratios = {
      wood: [1, 2.76, 5.40, 8.93, 13.34, 18.64, 24.82, 31.87, 39.81, 48.62, 58.31, 68.88, 80.33, 92.66, 105.86, 119.94],
      metal: [1, 2.0, 3.01, 4.03, 5.06, 6.12, 7.21, 8.34, 9.52, 10.75, 12.04, 13.40, 14.83, 16.34, 17.94, 19.63],
      glass: [1, 2.32, 4.15, 6.48, 9.31, 12.64, 16.47, 20.80, 25.63, 30.96, 36.79, 43.12, 49.95, 57.28, 65.11, 73.44],
      membrane: [1, 1.59, 2.14, 2.30, 2.65, 2.92, 3.16, 3.50, 3.60, 3.65, 4.06, 4.15, 4.35, 4.61, 4.84, 5.13]
    };
    return ratios[material] || ratios.metal;
  };
  // Configure a modal resonator as a bandpass biquad filter.
  // Each mode is a second-order IIR (biquad) tuned to one resonance:
  //   H(z) = b0 / (1 + a1*z^-1 + a2*z^-2)
  // Bandwidth controls the decay rate of that mode — narrow bandwidth
  // means high Q, which means the mode rings longer. This directly
  // maps to the physical reality: a thick metal bar has narrow
  // resonances (long sustain), while a wooden block has wide ones
  // (quick decay). The freq/bandwidth ratio is Q.
  FBStrikeModel.prototype.configureMode = function(mode, freq, bw) {
    var sr = this.sampleRate;
    if (freq >= sr / 2 - 100) freq = sr / 2 - 100;
    if (freq < 20) freq = 20;
    var w0 = 2 * Math.PI * freq / sr;
    var safeBw = bw || 0.001;
    var alpha = Math.sin(w0) / (2 * (freq / safeBw));
    var a0 = 1 + alpha;
    mode.b0 = (Math.sin(w0) / 2) / a0;
    mode.a1 = (-2 * Math.cos(w0)) / a0;
    mode.a2 = (1 - alpha) / a0;
    mode.freq = freq;
  };
  FBStrikeModel.prototype.noteOn = function(freq, velocity) {
    this.active = true; this.decayCounter = 0;
    var vel = (velocity || 100) / 127;
    var ratios = this.getPartialRatios(this.material);
    var nyquist = this.sampleRate / 2 - 100;
    var hardnessFactor = 0.3 + (this.hardness / 100) * 0.7;
    var strikePos = 0.05 + (this.strikePosition / 100) * 0.45;
    this.maxDecay = Math.floor(this.sampleRate * (0.5 + (this.decayTime / 100) * 9.5));
    for (var i = 0; i < this.numModes; i++) {
      var mf = freq * ratios[i];
      if (mf >= nyquist) { this.modes[i].gain = 0; continue; }
      // Bandwidth controls decay rate: narrower = longer sustain
      // Lower modes get narrower bandwidth for longer fundamental sustain.
      // The previous formula went as low as 0.05% * freq for long-decay presets,
      // producing bandpasses so narrow that a short excitation burst never
      // rang up the resonator within the test window (~1s). We raise the floor
      // and minimum absolute bandwidth so high-frequency notes still produce
      // audible energy quickly.
      var decayFactor = 1 - (this.decayTime / 100);
      var BW_FUND_FLOOR = 0.002;                 // was 0.0005 — 4× ring-up speed
      var BW_DECAY_RANGE = 0.014;
      var BW_MODE_SPREAD = 0.1;
      var MIN_MODE_BW_HZ = 1.5;                  // absolute floor, was 0.3
      var bwRaw = mf * (BW_FUND_FLOOR + decayFactor * BW_DECAY_RANGE) * (1 + i * BW_MODE_SPREAD);
      var bw = bwRaw < MIN_MODE_BW_HZ ? MIN_MODE_BW_HZ : bwRaw;
      this.configureMode(this.modes[i], mf, bw);
      this.modes[i].gain = vel * Math.abs(Math.sin(Math.PI * (i + 1) * strikePos)) * Math.pow(hardnessFactor, i * 0.15) / (1 + i * 0.25);
      this.modes[i].y1 = 0; this.modes[i].y2 = 0;
    }
    var totalGain = 0;
    for (var i = 0; i < this.numModes; i++) {
      totalGain += Math.abs(this.modes[i].gain);
    }
    this.outputScale = totalGain > 0 ? (0.8 / totalGain) : 1.0;
    this.exciteSamples = Math.max(4, Math.floor(this.sampleRate * 0.002 * (1 + (1 - hardnessFactor) * 4)));
    this.exciteRemaining = this.exciteSamples;
    this.exciteLevel = vel * 1.2;
  };
  FBStrikeModel.prototype.noteOff = function() {
    this.maxDecay = Math.min(this.maxDecay, this.decayCounter + Math.floor(this.sampleRate * 0.5));
  };
  FBStrikeModel.prototype.process = function() {
    if (!this.active) return 0;
    this.decayCounter++;
    if (this.decayCounter > this.maxDecay) { this.active = false; return 0; }
    var excitation = 0;
    if (this.exciteRemaining > 0) {
      var t = 1 - (this.exciteRemaining / this.exciteSamples);
      // Sharp leading impulse (cosine window) + smoother hann tail + noise.
      // Short initial spike couples energy into high-Q modes efficiently; the
      // tail feeds wider modes. Previous pure-sine window peaked at t=0.5 which
      // delayed energy injection and under-excited narrow bandpasses.
      var STRIKE_IMPULSE_WEIGHT = 0.7;
      var STRIKE_SUSTAIN_WEIGHT = 0.4;
      var STRIKE_NOISE_WEIGHT = 0.3;
      var impulseEnv = Math.cos(Math.PI * 0.5 * t);       // 1 at t=0, 0 at t=1
      var sustainEnv = Math.sin(Math.PI * t);
      var noiseEnv = (1 - t);
      excitation = impulseEnv * this.exciteLevel * STRIKE_IMPULSE_WEIGHT
                 + sustainEnv * this.exciteLevel * STRIKE_SUSTAIN_WEIGHT
                 + (Math.random() * 2 - 1) * this.exciteLevel * STRIKE_NOISE_WEIGHT * noiseEnv;
      this.exciteRemaining--;
    }
    var output = 0;
    for (var i = 0; i < this.numModes; i++) {
      var m = this.modes[i];
      if (m.gain === 0) continue;
      var y = m.b0 * excitation - m.a1 * m.y1 - m.a2 * m.y2;
      m.y2 = m.y1; m.y1 = y;
      output += y * m.gain;
    }
    output = this.dcBlocker.process(output) * this.outputScale * STRIKE_VOICE_LEVEL;
    // Soft limiter (tanh approximation) to tame transient peaks
    if (output > 0.9 || output < -0.9) {
      output = output / (1.0 + Math.abs(output));
    }
    var isStrikeFinished = this.exciteRemaining <= 0 && this.decayCounter > this.sampleRate * 0.5;
    var isStrikeSilent = isStrikeFinished && Math.abs(output) < 0.00001;
    if (isStrikeSilent) { this.active = false; return 0; }
    return output;
  };
  FBStrikeModel.prototype.isFinished = function() { return !this.active; };

  // ============================================================
  // Fallback Voice
  // ============================================================

  function FallbackVoice(sr) {
    this.sampleRate = sr;
    this.active = false;
    this.midiNote = -1;
    this.instId = 0;
    this.modelType = 'pluck';
    this.pluck = new FBPluckModel(sr);
    this.bow = new FBBowModel(sr);
    this.blow = new FBBlowModel(sr);
    this.strike = new FBStrikeModel(sr);
    this.currentModel = this.pluck;
  }

  FallbackVoice.prototype.noteOn = function(midi, vel, freq, settings) {
    this.active = true;
    this.midiNote = midi;
    this.instId = settings.instId || 0;
    this.modelType = settings.model || 'pluck';
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
    this.currentModel.noteOn(freq, vel);
  };
  FallbackVoice.prototype.noteOff = function() { if (this.currentModel) this.currentModel.noteOff(); };
  FallbackVoice.prototype.process = function() {
    if (!this.active) return 0;
    var s = this.currentModel.process();
    if (this.currentModel.isFinished()) this.active = false;
    return s;
  };

  // ============================================================
  // MIDI / Frequency Helpers
  // ============================================================

  // Standard MIDI-to-frequency conversion: f = 440 * 2^((n-69)/12)
  // where n is the MIDI note number (69 = A4 = 440 Hz). This is
  // 12-tone equal temperament (12-TET). The SynthLab tuning system
  // can override this with alternate temperaments.
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
  // Worklet Initialization
  // ============================================================

  function init(ctx) {
    audioContext = ctx || (SL.audio && SL.audio.getCtx ? SL.audio.getCtx() : null);
    if (!audioContext) {
      console.error('[PHYSICAL] No AudioContext available');
      return Promise.reject(new Error('No AudioContext'));
    }

    // Always use ScriptProcessor — synchronous, immediate, reliable.
    // AudioWorklet async loading causes race conditions where notes
    // are silently dropped during the worklet init window.
    return initFallback();
  }

  var PHYSICAL_WORKLET_COUNT = 4;

  function _makePhysicalWorkletReadyHandler(readyState, resolve) {
    return function(event) {
      var isReady = (event.data.type === 'ready');
      if (isReady) {
        readyState.count++;
        if (readyState.count === PHYSICAL_WORKLET_COUNT) {
          isWorkletReady = true;
          isWorkletInitializing = false;
          resolve(true);
        }
      }
    };
  }

  function _makePhysicalWorkletErrorHandler(idx, hasHadError, resolve, reject) {
    return function(event) {
      if (!hasHadError.value) {
        hasHadError.value = true;
        console.error('[PHYSICAL] AudioWorklet processor error (inst ' + idx + '):', event);
        isWorkletReady = false;
        isWorkletInitializing = false;
        console.warn('[PHYSICAL] Falling back to ScriptProcessor');
        initFallback().then(resolve).catch(reject);
      }
    };
  }

  function initWorklet() {
    if (isWorkletReady) return Promise.resolve(true);
    if (isWorkletInitializing) return isWorkletReadyPromise;

    isWorkletInitializing = true;

    isWorkletReadyPromise = new Promise(function(resolve, reject) {
      var physWorkletUrl = (SL.audio.getWorkletBlobUrl && SL.audio.getWorkletBlobUrl('physical-worklet.js')) || 'assets/physical-worklet.js';
      audioContext.audioWorklet.addModule(physWorkletUrl).then(function() {
        var readyState = { count: 0 };
        var hasHadError = { value: false };

        for (var i = 0; i < PHYSICAL_WORKLET_COUNT; i++) {
          (function(idx) {
            var node = new AudioWorkletNode(audioContext, 'physical-model', {
              numberOfInputs: 0,
              numberOfOutputs: 1,
              outputChannelCount: [1]
            });
            physicalWorkletNodes[idx] = node;

            node.port.onmessage = _makePhysicalWorkletReadyHandler(readyState, resolve);
            node.onprocessorerror = _makePhysicalWorkletErrorHandler(idx, hasHadError, resolve, reject);
          })(i);
        }

      }).catch(function(error) {
        console.error('[PHYSICAL] Failed to load physical worklet:', error);
        isWorkletInitializing = false;
        console.warn('[PHYSICAL] Falling back to ScriptProcessor');
        initFallback().then(resolve).catch(reject);
      });
    });

    return isWorkletReadyPromise;
  }

  // ============================================================
  // ScriptProcessor Fallback
  // ============================================================

  var fallbackVoicesByInst = [[], [], [], []];

  // ScriptProcessor fallback: for browsers without AudioWorklet support,
  // or when worklet loading races against noteOn messages. The
  // ScriptProcessor API (deprecated but universally supported) runs DSP
  // on the main thread in a callback. The trade-off is higher latency
  // and potential UI jank, but it guarantees no dropped notes.
  function initFallback() {
    shouldUseFallback = true;
    var sr = audioContext.sampleRate;
    var bufSize = (SL.audio && SL.audio.getScriptProcessorBufferSize) ? SL.audio.getScriptProcessorBufferSize() : 1024;

    // Pre-allocate per-instrument voice pools (16 voices each)
    for (var i = 0; i < 4; i++) {
      fallbackVoicesByInst[i].length = 0;
      for (var v = 0; v < 16; v++) {
        fallbackVoicesByInst[i].push(new FallbackVoice(sr));
      }
    }

    // Create 4 per-instrument ScriptProcessor nodes
    for (var idx = 0; idx < 4; idx++) {
      (function(instIdx) {
        var node = audioContext.createScriptProcessor(bufSize, 0, 1);
        var voices = fallbackVoicesByInst[instIdx];
        var VOICE_MIX_GAIN = 0.44;
        node.onaudioprocess = function(event) {
          var output = event.outputBuffer.getChannelData(0);
          for (var s = 0; s < output.length; s++) {
            var sample = 0;
            for (var vi = 0; vi < voices.length; vi++) {
              if (voices[vi].active) {
                sample += voices[vi].process() * VOICE_MIX_GAIN;
              }
            }
            // Pade [3/3] approximant of tanh for soft clipping:
            //   tanh(x) ~ x * (27 + x^2) / (27 + 9*x^2)
            // Keeps signal in roughly [-1, +1] with smooth saturation
            // rather than hard clipping. Cheaper than Math.tanh() and
            // avoids the harsh aliasing artifacts of hard clipping.
            var ss = sample * sample;
            output[s] = sample * (27 + ss) / (27 + 9 * ss);
          }
        };
        scriptNodes[instIdx] = node;
      })(idx);
    }

    return Promise.resolve(true);
  }

  // ============================================================
  // Connection Management
  // ============================================================

  /**
   * Get or create a BiquadFilterNode for physical output on this instrument.
   */
  function getOrCreateFilterNode(instId) {
    if (!audioContext) return null;
    if (!physFilterNodes[instId]) {
      var node = audioContext.createBiquadFilter();
      node.type = 'lowpass';
      node.frequency.value = 20000;
      node.Q.value = 0.707;
      physFilterNodes[instId] = node;
    }
    return physFilterNodes[instId];
  }

  /**
   * Update the physical filter node for an instrument from current filter settings.
   */
  function updateFilter(instId) {
    if (instId === undefined) instId = 0;
    var filterNode = physFilterNodes[instId];
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
    } // end if (filterNode)
  }

  function connectToOutput(instId) {
    // If nodes not created yet (engine not initialized), skip
    var nodeExists = (shouldUseFallback && scriptNodes[instId]) || (!shouldUseFallback && physicalWorkletNodes[instId]);
    if (nodeExists) {

    // Each instrument's node is permanently connected once; no disconnect/reconnect needed
    if (connectedInsts[instId]) {
      updateFilter(instId);
    } else {
      var instruments = SL.audio && SL.audio.getInstruments ? SL.audio.getInstruments() : null;
      var inst = instruments ? instruments[instId] : null;
      var isDestinationResolved = false;
      var destination;

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
      } else if (physicalWorkletNodes[instId]) {
        if (filterNode) {
          physicalWorkletNodes[instId].connect(filterNode);
          filterNode.connect(destination);
        } else {
          physicalWorkletNodes[instId].connect(destination);
        }
      }

      connectedInsts[instId] = true;
      } // end if (isDestinationResolved)
    }
    } // end if (nodeExists)
  }

  // ============================================================
  // Settings Management
  // ============================================================

  function getOrCreateSettings(instId) {
    if (!instrumentSettings[instId]) {
      instrumentSettings[instId] = JSON.parse(JSON.stringify(DEFAULT_PHYSICAL_SETTINGS));
    }
    return instrumentSettings[instId];
  }

  // ============================================================
  // Note On / Off
  // ============================================================

  function noteOn(midi, velocity, instId) {
    if (instId === undefined) instId = 0;
    velocity = velocity || 100;

    // Ensure AudioContext is running (iframe policies can suspend it)
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume();
    }

    var settings = getOrCreateSettings(instId);
    var noteFreq = midiToFreq(midi);

    connectToOutput(instId);

    var rawHum = settings.humanization || {};
    var driftHum = (typeof rawHum === 'number') ? rawHum : (rawHum.drift || 0);
    var hum = driftHum / 100;  // normalize 0-100 to 0-1
    var voiceSettings = {
      instId: instId,
      model: settings.model,
      damping: settings.damping,
      brightness: settings.brightness,
      excitation: settings.excitation,
      bodySize: settings.bodySize,
      decayTime: settings.decayTime,
      bowPressure: settings.bowPressure,
      bowPosition: settings.bowPosition,
      breathPressure: settings.breathPressure,
      embouchure: settings.embouchure,
      strikePosition: settings.strikePosition,
      hardness: settings.hardness,
      material: settings.material,
      humanization: hum
    };

    if (shouldUseFallback) {
      var voices = fallbackVoicesByInst[instId];
      var voice = null;
      for (var i = 0; i < voices.length; i++) {
        if (!voices[i].active) { voice = voices[i]; break; }
      }
      if (!voice) {
        // Voice stealing: find the quietest (smallest lastOutput magnitude)
        // or oldest (highest decayCounter) voice to minimize audible artifacts
        var bestStealIdx = 0;
        var bestStealScore = -Infinity;
        for (var si = 0; si < voices.length; si++) {
          var candidate = voices[si];
          var candidateModel = candidate.currentModel;
          var decayScore = candidateModel.decayCounter || 0;
          var outputMagnitude = Math.abs(candidateModel.lastOutput || 0);
          // Prefer voices that are oldest (high decay) and quietest (low output)
          // Normalize output to 0-1 range and invert so quieter = higher score
          var score = decayScore - (outputMagnitude * 10000);
          if (score > bestStealScore) {
            bestStealScore = score;
            bestStealIdx = si;
          }
        }
        voice = voices[bestStealIdx];
      }
      voice.noteOn(midi, velocity, noteFreq, voiceSettings);
    } else if (physicalWorkletNodes[instId] && isWorkletReady) {
      physicalWorkletNodes[instId].port.postMessage({
        type: 'noteOn',
        midiNote: midi,
        velocity: velocity,
        noteFreq: noteFreq,
        settings: voiceSettings
      });
    }
  }

  function noteOff(midi, instId) {
    if (instId === undefined) instId = 0;

    if (shouldUseFallback) {
      var voices = fallbackVoicesByInst[instId];
      for (var i = 0; i < voices.length; i++) {
        var v = voices[i];
        if (v.active && v.midiNote === midi) {
          v.noteOff();
        }
      }
    } else if (physicalWorkletNodes[instId] && isWorkletReady) {
      physicalWorkletNodes[instId].port.postMessage({
        type: 'noteOff',
        midiNote: midi,
        instId: instId
      });
    }
  }

  // ============================================================
  // Parameter Control
  // ============================================================

  function setModel(instId, model) {
    var settings = getOrCreateSettings(instId);
    settings.model = model;
  }

  function setParam(instId, paramName, value) {
    var settings = getOrCreateSettings(instId);
    settings[paramName] = value;

    // Update active voices
    if (physicalWorkletNodes[instId] && isWorkletReady) {
      var params = {};
      params[paramName] = value;
      physicalWorkletNodes[instId].port.postMessage({
        type: 'updateParams',
        instId: instId,
        params: params
      });
    }
  }

  function getSettings(instId) {
    return JSON.parse(JSON.stringify(getOrCreateSettings(instId)));
  }

  function setSettings(instId, settings) {
    instrumentSettings[instId] = JSON.parse(JSON.stringify(settings));
  }

  // ============================================================
  // Utility
  // ============================================================

  function allNotesOff(instId) {
    if (shouldUseFallback) {
      if (instId !== undefined) {
        var voices = fallbackVoicesByInst[instId];
        for (var i = 0; i < voices.length; i++) {
          if (voices[i].active) voices[i].noteOff();
        }
      } else {
        for (var idx = 0; idx < 4; idx++) {
          var pool = fallbackVoicesByInst[idx];
          for (var j = 0; j < pool.length; j++) {
            if (pool[j].active) pool[j].noteOff();
          }
        }
      }
    } else if (isWorkletReady) {
      if (instId !== undefined) {
        if (physicalWorkletNodes[instId]) {
          physicalWorkletNodes[instId].port.postMessage({
            type: 'allNotesOff',
            instId: instId
          });
        }
      } else {
        for (var n = 0; n < 4; n++) {
          if (physicalWorkletNodes[n]) {
            physicalWorkletNodes[n].port.postMessage({
              type: 'allNotesOff',
              instId: n
            });
          }
        }
      }
    }
  }

  function isReady() {
    return isWorkletReady || shouldUseFallback;
  }

  function getDefaultSettings() {
    return JSON.parse(JSON.stringify(DEFAULT_PHYSICAL_SETTINGS));
  }

  // ============================================================
  // Export to SynthLab Namespace
  // ============================================================

  SL.physical = {
    init: init,
    isReady: isReady,

    noteOn: noteOn,
    noteOff: noteOff,
    allNotesOff: allNotesOff,

    setModel: setModel,
    setParam: setParam,

    getSettings: getSettings,
    setSettings: setSettings,
    getDefaultSettings: getDefaultSettings,

    connectToOutput: connectToOutput,
    updateFilter: updateFilter,

    DEFAULT_PHYSICAL_SETTINGS: DEFAULT_PHYSICAL_SETTINGS,
    MAX_VOICES_PER_INSTRUMENT: MAX_VOICES_PER_INSTRUMENT
  };

})();
