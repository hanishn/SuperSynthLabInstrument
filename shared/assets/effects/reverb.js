// Synth Lab - Reverb Effect
// Multiple reverb algorithms: convolution, room (Freeverb), plate (Dattorro), hall (FDN), spring, shimmer
//
// SSLI [FX-050] Reverb: six algorithms spanning 60 years of artificial
// reverberation research. Reverb simulates sound reflecting off surfaces
// in an enclosed space. The key perceptual metric is RT60 -- the time for
// the reverb tail to decay by 60 dB. The Sabine equation relates this to
// room geometry: RT60 = 0.161 * V / A, where V is volume in cubic meters
// and A is total absorption area. Two perceptual phases matter: early
// reflections (discrete echoes off nearby walls, encoding room size and
// shape) and late reverberation (a dense, diffuse tail where individual
// echoes are no longer distinguishable).
//
// Algorithms implemented here:
//   convolution -- convolve input with an impulse response (exact, CPU-heavy)
//   room        -- Schroeder/Moorer comb+allpass topology (Freeverb variant)
//   plate       -- Dattorro (1997) lattice with modulated allpass diffusers
//   hall        -- Feedback Delay Network with Hadamard mixing matrix
//   spring      -- dispersive allpass chains modeling coiled-wire mechanics
//   shimmer     -- pitch-shifted feedback producing ethereal octave layers
//
// References:
//   Schroeder, M.R. (1962) "Natural Sounding Artificial Reverberation", JAES
//   Moorer, J.A. (1979) "About This Reverberation Business", CMJ 3(2)
//   Dattorro, J. (1997) "Effect Design Part 1", JAES 45(9)
//   Jezar (2000) Freeverb, public domain
//   Stautner & Puckette (1982) "Designing Multi-Channel Reverberators", CMJ
//   Valimaki et al. (2012) "Fifty Years of Artificial Reverberation", IEEE

(function() {
  var SL = window.SynthLab;
  var BaseEffect = SL.effects.BaseEffect;

  // Comb filter delay times for Freeverb (in samples at 44100Hz).
  // These are Jezar's original tunings. Each comb filter produces echoes
  // at its delay length; mutually incommensurate lengths avoid periodicity.
  // Slightly different for L/R channels for stereo width
  // The +23 sample offset on the right channel decorrelates L/R, widening
  // the stereo image without doubling the computation.
  var COMB_TUNINGS_L = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  var COMB_TUNINGS_R = [1116 + 23, 1188 + 23, 1277 + 23, 1356 + 23, 1422 + 23, 1491 + 23, 1557 + 23, 1617 + 23];

  // Allpass filter delay times for Freeverb.
  // Allpass filters add echo density without coloring the frequency spectrum.
  // Transfer function: y(n) = -g*x(n) + x(n-M) + g*y(n-M).
  // Four in series thicken the tail after the comb bank.
  var ALLPASS_TUNINGS = [556, 441, 341, 225];

  // Prime number delay times for FDN Hall (in ms).
  // Primes ensure maximum echo density -- no two delay lines share a
  // common period, so reflections never align into audible repetition.
  // Ref: Stautner & Puckette (1982) on multi-channel reverberator design.
  var FDN_DELAY_TIMES = [29, 37, 43, 53, 67, 79, 89, 97];

  // Spring reverb chirp frequencies.
  // Physical springs exhibit frequency-dependent wave velocity (dispersion),
  // causing higher frequencies to arrive before lower ones -- the classic
  // "drip" or "boing". These base frequencies seed the chirped allpass chains.
  var SPRING_CHIRP_FREQS = [180, 220, 280, 340];

  function _makeMixGainRow() {
    return [];
  }
  function _makeSpringChain() {
    return [];
  }

  /**
   * ReverbEffect - Multiple reverb algorithms
   *
   * Parameters:
   * - algorithm: 'convolution', 'room', 'plate', 'hall', 'spring', 'shimmer'
   * - size: 0-100 (room size / reverb time)
   * - decay: 0-100 (decay time / feedback)
   * - damping: 0-100 (high frequency absorption)
   * - predelay: 0-100 (delay in ms before reverb onset)
   * - diffusion: 0-100 (for plate/spring)
   * - modulation: 0-100 (for plate)
   * - lowDecay: 0-100 (low frequency decay for hall)
   * - highDecay: 0-100 (high frequency decay for hall)
   * - tension: 0-100 (spring tension)
   * - shimmerPitch: 0-24 (pitch shift in semitones for shimmer)
   * - shimmerAmount: 0-100 (amount of shimmer)
   * - width: 0-100 (stereo width)
   * - mix: 0-100 (wet/dry mix, inherited from BaseEffect)
   */
  class ReverbEffect extends BaseEffect {
    constructor(ctx) {
      super(ctx, 'reverb');

      // Initialize parameters with defaults
      this.params.algorithm = 'convolution';
      this.params.size = 50;
      this.params.decay = 50;
      this.params.damping = 30;
      this.params.predelay = 10;
      this.params.diffusion = 50;
      this.params.modulation = 30;
      this.params.lowDecay = 50;
      this.params.highDecay = 50;
      this.params.tension = 50;
      this.params.shimmerPitch = 12;
      this.params.shimmerAmount = 50;
      this.params.width = 100;
      this.params.mix = 30;

      // Pre-delay: a simple delay before the reverb onset, modeling the
      // time gap between direct sound and first reflections. In real rooms
      // this encodes distance to the nearest wall (speed of sound ~343 m/s,
      // so 10ms pre-delay ~ 1.7m to nearest surface).
      this.predelayNode = ctx.createDelay(0.2); // Max 200ms predelay
      this.predelayNode.delayTime.value = this.params.predelay / 1000;

      // Connect input to predelay
      this.input.connect(this.predelayNode);

      // Algorithm-specific nodes stored here
      this._algorithmNodes = [];

      // Debounce timer for expensive operations
      this._rebuildDebounceTimer = null;
      this._rebuildDebounceDelay = 200;

      // IR debounce for convolution
      this._irDebounceTimer = null;
      this._irDebounceDelay = 100;

      // Build initial algorithm
      this._buildAlgorithm();

      // Apply initial mix
      this.setMix(this.params.mix);
    }

    /**
     * Clean up algorithm-specific nodes
     */
    _cleanupAlgorithmNodes() {
      // Disconnect and release all algorithm-specific nodes
      this._algorithmNodes.forEach(function(node) {
        try {
          node.disconnect();
        } catch (e) { /* node may already be disconnected */ }
      });
      this._algorithmNodes = [];

      // Clear any algorithm-specific references
      this.convolver = null;
      this.combFiltersL = null;
      this.combFiltersR = null;
      this.allpassFilters = null;
      this.fdnDelays = null;
      this.inputDiffusers = null;
      this.tankDelays = null;
      this.springAllpasses = null;
      this.shimmerPitchNode = null;
      this.shimmerGrains = null;
    }

    /**
     * Build the audio graph for the current algorithm
     */
    _buildAlgorithm() {
      // Clean up existing nodes
      this._cleanupAlgorithmNodes();

      // Disconnect predelay from anything
      this.predelayNode.disconnect();

      switch (this.params.algorithm) {
        case 'room':
          this._buildRoomReverb();
          break;
        case 'plate':
          this._buildPlateReverb();
          break;
        case 'hall':
          this._buildHallReverb();
          break;
        case 'spring':
          this._buildSpringReverb();
          break;
        case 'shimmer':
          this._buildShimmerReverb();
          break;
        case 'convolution':
        default:
          this._buildConvolutionReverb();
          break;
      }
    }

    //==========================================================================
    // CONVOLUTION REVERB
    //==========================================================================
    //
    // Convolution reverb: the mathematically exact approach. An impulse
    // response (IR) captures every reflection in a real space. Output is
    // computed as y(n) = sum( h(k) * x(n-k) ) for k = 0..N-1, where h is
    // the IR. CPU cost is O(N) per sample (or O(N log N) via partitioned FFT).
    // Here we synthesize a stochastic IR rather than loading a recorded one,
    // giving parametric control over size and decay without storing WAV files.

    _buildConvolutionReverb() {
      this.convolver = this.ctx.createConvolver();
      this._algorithmNodes.push(this.convolver);

      this.predelayNode.connect(this.convolver);
      this.convolver.connect(this.wetGain);

      this._generateAndSetIR();
    }

    _getDuration() {
      return 0.5 + (this.params.size / 100) * 5.5;
    }

    _getDecayRate() {
      return 0.5 + ((100 - this.params.decay) / 100) * 7.5;
    }

    _getDampingCoeff() {
      return (this.params.damping / 100) * 0.95;
    }

    // Synthesize an impulse response: exponentially decaying white noise,
    // shaped by a one-pole lowpass (damping) to simulate HF air absorption.
    // L/R channels get slightly different decay rates for stereo decorrelation.
    _generateIR() {
      var sampleRate = this.ctx.sampleRate;
      var duration = this._getDuration();
      var decayRate = this._getDecayRate();
      var dampingCoeff = this._getDampingCoeff();

      var length = Math.floor(sampleRate * duration);
      var buffer = this.ctx.createBuffer(2, length, sampleRate);

      for (var channel = 0; channel < 2; channel++) {
        var data = buffer.getChannelData(channel);
        // Offset decay between L/R so the stereo field evolves over time
        var channelDecayOffset = channel === 0 ? 0.95 : 1.05;
        var effectiveDecay = decayRate * channelDecayOffset;
        // One-pole lowpass state for HF damping in the IR
        var lpState = 0;

        for (var i = 0; i < length; i++) {
          var t = i / sampleRate;
          // Exponential decay envelope models energy loss per reflection
          var envelope = Math.exp(-effectiveDecay * t);
          var sample = (Math.random() * 2 - 1) * envelope;

          // One-pole lowpass: simulates high-frequency absorption by air and
          // surfaces. Real rooms absorb HF faster than LF (Moorer 1979).
          if (dampingCoeff > 0) {
            sample = (1 - dampingCoeff) * sample + dampingCoeff * lpState;
            lpState = sample;
          }

          data[i] = sample;
        }

        // Boost the first 50ms to simulate early reflections -- the discrete
        // echoes that arrive before the diffuse tail and convey room geometry.
        var earlyReflectionSamples = Math.floor(sampleRate * 0.05);
        var safeEarlyReflSamples = earlyReflectionSamples || 1;
        for (var i = 0; i < earlyReflectionSamples && i < length; i++) {
          var boost = 1 + (1 - i / safeEarlyReflSamples) * 0.3;
          data[i] *= boost;
        }
      }

      return buffer;
    }

    _generateAndSetIR() {
      if (this._irDebounceTimer) {
        clearTimeout(this._irDebounceTimer);
      }

      var self = this;
      this._irDebounceTimer = setTimeout(function() {
        try {
          if (self.convolver) {
            var ir = self._generateIR();
            self.convolver.buffer = ir;
          }
        } catch (e) {
          console.error('Reverb: Error generating impulse response:', e);
        }
        self._irDebounceTimer = null;
      }, this._irDebounceDelay);
    }

    //==========================================================================
    // ROOM REVERB (Freeverb / Jezar's algorithm)
    //==========================================================================
    //
    // Classic Schroeder reverberator topology, refined by Moorer (1979) and
    // popularized by Jezar's Freeverb (2000, public domain). Architecture:
    // 8 parallel comb filters feed into 4 series allpass filters per channel.
    //
    // Comb filter: y(n) = x(n-M) + g * y(n-M). Each comb creates a train
    // of echoes spaced M samples apart, with amplitude decaying by g per
    // round-trip. Multiple parallel combs at incommensurate delay lengths
    // fill in gaps, approximating a dense reflection pattern.
    //
    // Allpass filter: y(n) = -g*x(n) + x(n-M) + g*y(n-M). Adds temporal
    // density (smearing echoes) while preserving flat magnitude response --
    // it colors the phase but not the spectrum.
    //
    // Damping: a lowpass filter in each comb's feedback loop models the
    // frequency-dependent absorption of walls, carpet, and air. Higher
    // damping = faster HF decay, simulating soft/absorbent surfaces.

    _buildRoomReverb() {
      var ctx = this.ctx;
      var sampleRate = ctx.sampleRate;
      var scaleFactor = sampleRate / 44100;

      // Create stereo splitter and merger
      this.splitter = ctx.createChannelSplitter(2);
      this.merger = ctx.createChannelMerger(2);
      this._algorithmNodes.push(this.splitter, this.merger);

      // Mono input sum for reverb processing
      this.monoSum = ctx.createGain();
      this.monoSum.gain.value = 0.5;
      this._algorithmNodes.push(this.monoSum);

      // Comb filter banks (8 parallel comb filters per channel).
      // Parallel combs are the core of Schroeder reverb -- each produces
      // echoes at a different spacing, and their sum approximates the
      // dense, irregular reflection pattern of a real room.
      this.combFiltersL = [];
      this.combFiltersR = [];
      this.combGainsL = [];
      this.combGainsR = [];
      this.combDampingL = [];
      this.combDampingR = [];

      // Feedback gain controls RT60. Higher feedback = longer tail.
      // Capped below 0.85 per [FX-050] spec to prevent runaway buildup.
      var REVERB_FEEDBACK_BASE = 0.75;
      var REVERB_FEEDBACK_RANGE = 0.10;
      var feedback = REVERB_FEEDBACK_BASE + (this.params.size / 100) * REVERB_FEEDBACK_RANGE;
      var dampingValue = this.params.damping / 100;

      for (var i = 0; i < 8; i++) {
        // Left channel comb
        var delayL = ctx.createDelay(1);
        delayL.delayTime.value = (COMB_TUNINGS_L[i] * scaleFactor) / sampleRate;
        var gainL = ctx.createGain();
        gainL.gain.value = feedback;
        var dampL = ctx.createBiquadFilter();
        dampL.type = 'lowpass';
        dampL.frequency.value = 20000 * (1 - dampingValue * 0.8);

        this.combFiltersL.push(delayL);
        this.combGainsL.push(gainL);
        this.combDampingL.push(dampL);
        this._algorithmNodes.push(delayL, gainL, dampL);

        // Right channel comb
        var delayR = ctx.createDelay(1);
        delayR.delayTime.value = (COMB_TUNINGS_R[i] * scaleFactor) / sampleRate;
        var gainR = ctx.createGain();
        gainR.gain.value = feedback;
        var dampR = ctx.createBiquadFilter();
        dampR.type = 'lowpass';
        dampR.frequency.value = 20000 * (1 - dampingValue * 0.8);

        this.combFiltersR.push(delayR);
        this.combGainsR.push(gainR);
        this.combDampingR.push(dampR);
        this._algorithmNodes.push(delayR, gainR, dampR);
      }

      // Allpass filters for diffusion (4 in series per channel).
      // These thicken the comb output into a denser, more natural tail.
      // Gain of 0.5 is the Freeverb default, balancing density vs stability.
      this.allpassFiltersL = [];
      this.allpassFiltersR = [];

      for (var i = 0; i < 4; i++) {
        var apDelayL = ctx.createDelay(0.1);
        apDelayL.delayTime.value = (ALLPASS_TUNINGS[i] * scaleFactor) / sampleRate;
        var apGainL = ctx.createGain();
        apGainL.gain.value = 0.5;

        var apDelayR = ctx.createDelay(0.1);
        apDelayR.delayTime.value = (ALLPASS_TUNINGS[i] * scaleFactor) / sampleRate;
        var apGainR = ctx.createGain();
        apGainR.gain.value = 0.5;

        this.allpassFiltersL.push({ delay: apDelayL, gain: apGainL });
        this.allpassFiltersR.push({ delay: apDelayR, gain: apGainR });
        this._algorithmNodes.push(apDelayL, apGainL, apDelayR, apGainR);
      }

      // Sum gains for comb outputs. 0.125 = 1/8, normalizing the sum
      // of 8 parallel combs to unity gain.
      this.combSumL = ctx.createGain();
      this.combSumL.gain.value = 0.125;
      this.combSumR = ctx.createGain();
      this.combSumR.gain.value = 0.125;
      this._algorithmNodes.push(this.combSumL, this.combSumR);

      // Width control
      this.widthGainL = ctx.createGain();
      this.widthGainR = ctx.createGain();
      this._updateRoomWidth();
      this._algorithmNodes.push(this.widthGainL, this.widthGainR);

      // Connect the graph
      this.predelayNode.connect(this.monoSum);

      // Connect comb filters in parallel with feedback loops
      for (var i = 0; i < 8; i++) {
        // Left channel
        this.monoSum.connect(this.combFiltersL[i]);
        this.combFiltersL[i].connect(this.combDampingL[i]);
        this.combDampingL[i].connect(this.combGainsL[i]);
        this.combGainsL[i].connect(this.combFiltersL[i]); // Feedback
        this.combDampingL[i].connect(this.combSumL);

        // Right channel
        this.monoSum.connect(this.combFiltersR[i]);
        this.combFiltersR[i].connect(this.combDampingR[i]);
        this.combDampingR[i].connect(this.combGainsR[i]);
        this.combGainsR[i].connect(this.combFiltersR[i]); // Feedback
        this.combDampingR[i].connect(this.combSumR);
      }

      // Connect allpass filters in series for each channel
      var prevL = this.combSumL;
      var prevR = this.combSumR;
      for (var i = 0; i < 4; i++) {
        // Simplified allpass: just delay with feedback
        prevL.connect(this.allpassFiltersL[i].delay);
        this.allpassFiltersL[i].delay.connect(this.widthGainL);
        prevL = this.allpassFiltersL[i].delay;

        prevR.connect(this.allpassFiltersR[i].delay);
        this.allpassFiltersR[i].delay.connect(this.widthGainR);
        prevR = this.allpassFiltersR[i].delay;
      }

      // Connect to output merger
      this.widthGainL.connect(this.merger, 0, 0);
      this.widthGainR.connect(this.merger, 0, 1);
      this.merger.connect(this.wetGain);
    }

    _updateRoomWidth() {
      if (!this.widthGainL || !this.widthGainR) return;
      var width = this.params.width / 100;
      this.widthGainL.gain.value = 0.5 + width * 0.5;
      this.widthGainR.gain.value = 0.5 + width * 0.5;
    }

    _updateRoomParams() {
      if (!this.combGainsL) return;

      var REVERB_FEEDBACK_BASE = 0.75;
      var REVERB_FEEDBACK_RANGE = 0.10;
      var feedback = REVERB_FEEDBACK_BASE + (this.params.size / 100) * REVERB_FEEDBACK_RANGE;
      var dampingValue = this.params.damping / 100;
      var dampFreq = 20000 * (1 - dampingValue * 0.8);

      for (var i = 0; i < 8; i++) {
        this.combGainsL[i].gain.setTargetAtTime(feedback, this.ctx.currentTime, 0.01);
        this.combGainsR[i].gain.setTargetAtTime(feedback, this.ctx.currentTime, 0.01);
        this.combDampingL[i].frequency.setTargetAtTime(dampFreq, this.ctx.currentTime, 0.01);
        this.combDampingR[i].frequency.setTargetAtTime(dampFreq, this.ctx.currentTime, 0.01);
      }
    }

    //==========================================================================
    // PLATE REVERB (Dattorro-style)
    //==========================================================================
    //
    // Models a plate reverberator: physically, a large suspended metal sheet
    // with a driving transducer and pickup contacts. Sound energy propagates
    // as 2D bending waves, producing a dense, bright reverb favored on vocals.
    //
    // Dattorro (1997) "Effect Design Part 1" formalized the digital plate as
    // a two-stage lattice: input diffusers (4 series allpass filters that
    // smear the input into a dense cloud) feeding a cross-coupled "tank"
    // (two parallel delay chains with feedback between them). Modulated
    // delay lines create time-varying density that avoids metallic coloring.
    // Prime-number delay lengths prevent the tank from locking into periodic
    // modes, which would sound like distinct pitch rather than smooth reverb.

    _buildPlateReverb() {
      var ctx = this.ctx;
      var sampleRate = ctx.sampleRate;

      // Input diffusers (4 allpass filters in series).
      // These smear a transient input into a temporally dense cloud before
      // it enters the tank, emulating the rapid scattering on a metal plate.
      this.inputDiffusers = [];
      var diffuserTimes = [142, 107, 379, 277];
      var diffuserGain = 0.5 + (this.params.diffusion / 100) * 0.25;

      for (var i = 0; i < 4; i++) {
        var delay = ctx.createDelay(0.1);
        delay.delayTime.value = diffuserTimes[i] / sampleRate;
        var gain = ctx.createGain();
        gain.gain.value = diffuserGain;
        this.inputDiffusers.push({ delay, gain });
        this._algorithmNodes.push(delay, gain);
      }

      // Tank delays with modulation.
      // The tank is the heart of the Dattorro plate -- two cross-coupled
      // delay chains where energy circulates, decaying over time. Tank delay
      // lengths are scaled by room size to control reverb duration.
      this.tankDelaysL = [];
      this.tankDelaysR = [];
      this.tankGainsL = [];
      this.tankGainsR = [];
      var tankTimes = [672, 1800, 908, 2656];

      for (var i = 0; i < 2; i++) {
        var delayL = ctx.createDelay(0.5);
        delayL.delayTime.value = (tankTimes[i] * (0.8 + this.params.size / 500)) / sampleRate;
        var gainL = ctx.createGain();
        gainL.gain.value = 0.55 + (this.params.decay / 100) * 0.30;

        var delayR = ctx.createDelay(0.5);
        delayR.delayTime.value = (tankTimes[i + 2] * (0.8 + this.params.size / 500)) / sampleRate;
        var gainR = ctx.createGain();
        gainR.gain.value = 0.55 + (this.params.decay / 100) * 0.30;

        this.tankDelaysL.push(delayL);
        this.tankGainsL.push(gainL);
        this.tankDelaysR.push(delayR);
        this.tankGainsR.push(gainR);
        this._algorithmNodes.push(delayL, gainL, delayR, gainR);
      }

      // Tank damping filters
      this.tankDampL = ctx.createBiquadFilter();
      this.tankDampL.type = 'lowpass';
      this.tankDampL.frequency.value = 20000 * (1 - this.params.damping / 100 * 0.7);

      this.tankDampR = ctx.createBiquadFilter();
      this.tankDampR.type = 'lowpass';
      this.tankDampR.frequency.value = 20000 * (1 - this.params.damping / 100 * 0.7);
      this._algorithmNodes.push(this.tankDampL, this.tankDampR);

      // Modulation LFOs. Slowly varying the tank delay times breaks up
      // periodic patterns and prevents metallic ringing. This is a key
      // Dattorro innovation -- real plates have slight non-linearities that
      // create a naturally time-varying response.
      if (this.params.modulation > 0) {
        this.modLFO1 = ctx.createOscillator();
        this.modLFO1.type = 'sine';
        this.modLFO1.frequency.value = 0.5;
        this.modGain1 = ctx.createGain();
        this.modGain1.gain.value = (this.params.modulation / 100) * 0.002;
        this.modLFO1.connect(this.modGain1);
        this.modGain1.connect(this.tankDelaysL[0].delayTime);
        this.modLFO1.start();
        this._algorithmNodes.push(this.modLFO1, this.modGain1);

        this.modLFO2 = ctx.createOscillator();
        this.modLFO2.type = 'sine';
        this.modLFO2.frequency.value = 0.7;
        this.modGain2 = ctx.createGain();
        this.modGain2.gain.value = (this.params.modulation / 100) * 0.002;
        this.modLFO2.connect(this.modGain2);
        this.modGain2.connect(this.tankDelaysR[0].delayTime);
        this.modLFO2.start();
        this._algorithmNodes.push(this.modLFO2, this.modGain2);
      }

      // Stereo merger
      this.plateMerger = ctx.createChannelMerger(2);
      this._algorithmNodes.push(this.plateMerger);

      // Connect input diffusers in series
      var prev = this.predelayNode;
      for (var i = 0; i < 4; i++) {
        prev.connect(this.inputDiffusers[i].delay);
        prev = this.inputDiffusers[i].delay;
      }

      // Connect to tank (cross-coupled feedback).
      // Cross-coupling is the Dattorro signature: the left tank's output
      // feeds the right tank's input and vice versa, creating the dense,
      // enveloping stereo field characteristic of plate reverbs.
      var diffuserOut = this.inputDiffusers[3].delay;

      // Left tank path: delay -> damping -> gain -> delay -> gain -> RIGHT tank
      diffuserOut.connect(this.tankDelaysL[0]);
      this.tankDelaysL[0].connect(this.tankDampL);
      this.tankDampL.connect(this.tankGainsL[0]);
      this.tankGainsL[0].connect(this.tankDelaysL[1]);
      this.tankDelaysL[1].connect(this.tankGainsL[1]);
      this.tankGainsL[1].connect(this.tankDelaysR[0]); // Cross-couple to right

      // Right tank path: mirror of left, cross-couples back to left
      diffuserOut.connect(this.tankDelaysR[0]);
      this.tankDelaysR[0].connect(this.tankDampR);
      this.tankDampR.connect(this.tankGainsR[0]);
      this.tankGainsR[0].connect(this.tankDelaysR[1]);
      this.tankDelaysR[1].connect(this.tankGainsR[1]);
      this.tankGainsR[1].connect(this.tankDelaysL[0]); // Cross-couple to left

      // Tap outputs from tank
      this.tankDelaysL[1].connect(this.plateMerger, 0, 0);
      this.tankDelaysR[1].connect(this.plateMerger, 0, 1);
      this.plateMerger.connect(this.wetGain);
    }

    _updatePlateParams() {
      if (!this.tankGainsL) return;

      var decay = 0.55 + (this.params.decay / 100) * 0.30;
      var dampFreq = 20000 * (1 - this.params.damping / 100 * 0.7);

      for (var i = 0; i < 2; i++) {
        this.tankGainsL[i].gain.setTargetAtTime(decay, this.ctx.currentTime, 0.01);
        this.tankGainsR[i].gain.setTargetAtTime(decay, this.ctx.currentTime, 0.01);
      }

      this.tankDampL.frequency.setTargetAtTime(dampFreq, this.ctx.currentTime, 0.01);
      this.tankDampR.frequency.setTargetAtTime(dampFreq, this.ctx.currentTime, 0.01);

      if (this.modGain1) {
        this.modGain1.gain.setTargetAtTime((this.params.modulation / 100) * 0.002, this.ctx.currentTime, 0.01);
        this.modGain2.gain.setTargetAtTime((this.params.modulation / 100) * 0.002, this.ctx.currentTime, 0.01);
      }
    }

    //==========================================================================
    // HALL REVERB (Feedback Delay Network)
    //==========================================================================
    //
    // Feedback Delay Network (FDN): multiple delay lines whose outputs are
    // mixed through an orthogonal matrix and fed back to all inputs. This
    // produces extremely dense, diffuse late reflections -- ideal for large
    // concert halls where individual echoes are imperceptible.
    //
    // The mixing matrix must be unitary (energy-preserving) to ensure stable
    // decay. A Hadamard matrix satisfies this: each row is orthogonal to
    // every other, so energy redistributes evenly across all delay lines
    // without accumulation or cancellation. Ref: Stautner & Puckette (1982).
    //
    // Per-band decay (low shelf + high shelf filters in each feedback path)
    // allows independent RT60 for bass vs treble, modeling how real halls
    // absorb high frequencies faster (air absorption, seat cushions) while
    // bass reverberates longer (concrete, stone walls).

    _buildHallReverb() {
      var ctx = this.ctx;
      var sampleRate = ctx.sampleRate;

      // Use 4 delay lines for efficiency
      var numDelays = 4;
      this.fdnDelays = [];
      this.fdnGains = [];
      this.fdnLowFilters = [];
      this.fdnHighFilters = [];
      this.fdnInputGains = [];

      // Hadamard mixing matrix for 4x4. This is a normalized orthogonal
      // matrix: H * H^T = 4*I. The 0.5 scale factor ensures unit energy
      // (sqrt(1/4) = 0.5). Each delay line's output is distributed equally
      // to all inputs with alternating signs, maximizing echo density.
      var mixMatrix = [
        [1, 1, 1, 1],
        [1, -1, 1, -1],
        [1, 1, -1, -1],
        [1, -1, -1, 1]
      ];
      var matrixScale = 0.5;

      for (var i = 0; i < numDelays; i++) {
        var delay = ctx.createDelay(0.5);
        var baseTime = FDN_DELAY_TIMES[i] / 1000;
        delay.delayTime.value = baseTime * (0.5 + this.params.size / 100);

        var gain = ctx.createGain();
        gain.gain.value = 0.65 + (this.params.decay / 100) * 0.20;

        // Per-band decay control: independent RT60 for low and high frequencies.
        // Low shelf at 500Hz, high shelf at 4kHz. Gain centered at 0 dB when
        // param=50; positive boosts extend decay, negative cuts shorten it.
        var lowFilter = ctx.createBiquadFilter();
        lowFilter.type = 'lowshelf';
        lowFilter.frequency.value = 500;
        lowFilter.gain.value = (this.params.lowDecay - 50) / 5;

        var highFilter = ctx.createBiquadFilter();
        highFilter.type = 'highshelf';
        highFilter.frequency.value = 4000;
        highFilter.gain.value = (this.params.highDecay - 50) / 5;

        var inputGain = ctx.createGain();
        inputGain.gain.value = 0.25;

        this.fdnDelays.push(delay);
        this.fdnGains.push(gain);
        this.fdnLowFilters.push(lowFilter);
        this.fdnHighFilters.push(highFilter);
        this.fdnInputGains.push(inputGain);
        this._algorithmNodes.push(delay, gain, lowFilter, highFilter, inputGain);
      }

      // Create mixing gains for the matrix
      this.fdnMixGains = [];
      for (var i = 0; i < numDelays; i++) {
        var rowGains = _makeMixGainRow();
        for (var j = 0; j < numDelays; j++) {
          var mixGain = ctx.createGain();
          mixGain.gain.value = mixMatrix[i][j] * matrixScale;
          rowGains.push(mixGain);
          this._algorithmNodes.push(mixGain);
        }
        this.fdnMixGains.push(rowGains);
      }

      // Output summer
      this.fdnSumL = ctx.createGain();
      this.fdnSumL.gain.value = 0.5;
      this.fdnSumR = ctx.createGain();
      this.fdnSumR.gain.value = 0.5;
      this.fdnMerger = ctx.createChannelMerger(2);
      this._algorithmNodes.push(this.fdnSumL, this.fdnSumR, this.fdnMerger);

      // Connect input to all delay lines
      for (var i = 0; i < numDelays; i++) {
        this.predelayNode.connect(this.fdnInputGains[i]);
        this.fdnInputGains[i].connect(this.fdnDelays[i]);
      }

      // Connect each delay through its processing and back via mixing matrix.
      // Signal flow per line: delay -> lowShelf -> highShelf -> gain -> matrix -> all delays.
      // The matrix multiplication happens via gain nodes: fdnMixGains[j][i]
      // scales line i's output by matrix[j][i] before summing into line j.
      for (var i = 0; i < numDelays; i++) {
        this.fdnDelays[i].connect(this.fdnLowFilters[i]);
        this.fdnLowFilters[i].connect(this.fdnHighFilters[i]);
        this.fdnHighFilters[i].connect(this.fdnGains[i]);

        // Connect to mix matrix (feedback to all other delays)
        for (var j = 0; j < numDelays; j++) {
          this.fdnGains[i].connect(this.fdnMixGains[j][i]);
          this.fdnMixGains[j][i].connect(this.fdnDelays[j]);
        }

        // Tap outputs: even-indexed lines to left, odd to right for stereo
        if (i % 2 === 0) {
          this.fdnDelays[i].connect(this.fdnSumL);
        } else {
          this.fdnDelays[i].connect(this.fdnSumR);
        }
      }

      this.fdnSumL.connect(this.fdnMerger, 0, 0);
      this.fdnSumR.connect(this.fdnMerger, 0, 1);
      this.fdnMerger.connect(this.wetGain);
    }

    _updateHallParams() {
      if (!this.fdnGains) return;

      var decayGain = 0.65 + (this.params.decay / 100) * 0.20;

      for (var i = 0; i < this.fdnGains.length; i++) {
        this.fdnGains[i].gain.setTargetAtTime(decayGain, this.ctx.currentTime, 0.01);

        var baseTime = FDN_DELAY_TIMES[i] / 1000;
        this.fdnDelays[i].delayTime.setTargetAtTime(
          baseTime * (0.5 + this.params.size / 100),
          this.ctx.currentTime,
          0.01
        );

        this.fdnLowFilters[i].gain.setTargetAtTime((this.params.lowDecay - 50) / 5, this.ctx.currentTime, 0.01);
        this.fdnHighFilters[i].gain.setTargetAtTime((this.params.highDecay - 50) / 5, this.ctx.currentTime, 0.01);
      }
    }

    //==========================================================================
    // SPRING REVERB
    //==========================================================================
    //
    // Models the mechanical spring reverb found in Fender guitar amplifiers
    // and Hammond organs since the 1960s. A physical spring reverb consists
    // of one or more coiled metal springs with input/output transducers.
    //
    // Key acoustic property: dispersive wave propagation. In a coiled wire,
    // wave velocity depends on frequency -- high frequencies travel faster
    // than low frequencies. This causes a characteristic "chirp" or "drip"
    // on transients: the high-frequency content arrives first, followed by
    // progressively lower frequencies. The classic "boing" on a hard attack
    // is the signature artifact of this dispersion.
    //
    // Modeled here with chirped allpass chains (delay times increase through
    // each chain, mimicking frequency-dependent propagation speed) and
    // bandpass filtering to capture the limited bandwidth of real springs.

    _buildSpringReverb() {
      var ctx = this.ctx;
      var sampleRate = ctx.sampleRate;

      // Spring reverb characteristics:
      // - Chirped allpass chains for dispersion
      // - Characteristic metallic "drip" sound

      this.springAllpasses = [];
      this.springDelays = [];
      this.springGains = [];

      // 4 parallel allpass chains, each with different chirp frequencies,
      // model multiple vibrational modes in the coiled spring. Tension
      // scales the delay times -- tighter spring = higher propagation speed.
      var numChains = 4;
      var tensionFactor = 0.5 + (this.params.tension / 100) * 0.5;

      for (var i = 0; i < numChains; i++) {
        var chain = _makeSpringChain();
        // Each chain has 6-8 allpasses with chirped delay times
        var baseDelay = (SPRING_CHIRP_FREQS[i] / 1000) * tensionFactor;

        for (var j = 0; j < 6; j++) {
          var delay = ctx.createDelay(0.1);
          // Chirped: delay times increase through the chain, modeling
          // dispersion where low frequencies propagate more slowly
          delay.delayTime.value = baseDelay * (1 + j * 0.15 * (1 + this.params.diffusion / 100));

          var gain = ctx.createGain();
          gain.gain.value = 0.5;

          chain.push({ delay, gain });
          this._algorithmNodes.push(delay, gain);
        }
        this.springAllpasses.push(chain);

        // Add a delay line for overall reverb time
        var reverbDelay = ctx.createDelay(0.5);
        reverbDelay.delayTime.value = 0.02 + (this.params.size / 100) * 0.08;
        this.springDelays.push(reverbDelay);
        this._algorithmNodes.push(reverbDelay);

        var feedbackGain = ctx.createGain();
        feedbackGain.gain.value = 0.5 + (this.params.decay / 100) * 0.35;
        this.springGains.push(feedbackGain);
        this._algorithmNodes.push(feedbackGain);
      }

      // Lo-fi character filters: real springs have limited bandwidth
      // (~150 Hz to ~4 kHz). The bandpass shapes the output to match
      // the constrained frequency range of a physical spring tank.
      this.springLopass = ctx.createBiquadFilter();
      this.springLopass.type = 'lowpass';
      this.springLopass.frequency.value = 4000;
      this.springLopass.Q.value = 1;
      this._algorithmNodes.push(this.springLopass);

      this.springHipass = ctx.createBiquadFilter();
      this.springHipass.type = 'highpass';
      this.springHipass.frequency.value = 150;
      this._algorithmNodes.push(this.springHipass);

      // Resonant peak for the characteristic "boing" -- the mid-range
      // emphasis that makes spring reverb instantly recognizable.
      // Tension shifts this peak: tighter spring = higher resonance.
      this.springResonance = ctx.createBiquadFilter();
      this.springResonance.type = 'peaking';
      this.springResonance.frequency.value = 2000 + (this.params.tension / 100) * 2000;
      this.springResonance.Q.value = 3;
      this.springResonance.gain.value = 6;
      this._algorithmNodes.push(this.springResonance);

      // Output summer
      this.springSummer = ctx.createGain();
      this.springSummer.gain.value = 0.4;
      this._algorithmNodes.push(this.springSummer);

      // Connect chains in parallel
      for (var i = 0; i < numChains; i++) {
        var prev = this.predelayNode;

        // Connect allpass chain
        for (var j = 0; j < this.springAllpasses[i].length; j++) {
          prev.connect(this.springAllpasses[i][j].delay);
          prev = this.springAllpasses[i][j].delay;
        }

        // Connect delay line with feedback
        prev.connect(this.springDelays[i]);
        this.springDelays[i].connect(this.springGains[i]);
        this.springGains[i].connect(this.springAllpasses[i][0].delay); // Feedback

        // Tap output
        this.springDelays[i].connect(this.springSummer);
      }

      // Apply character filters
      this.springSummer.connect(this.springHipass);
      this.springHipass.connect(this.springLopass);
      this.springLopass.connect(this.springResonance);
      this.springResonance.connect(this.wetGain);
    }

    _updateSpringParams() {
      if (!this.springGains) return;

      var tensionFactor = 0.5 + (this.params.tension / 100) * 0.5;

      for (var i = 0; i < this.springGains.length; i++) {
        this.springGains[i].gain.setTargetAtTime(
          0.5 + (this.params.decay / 100) * 0.35,
          this.ctx.currentTime,
          0.01
        );

        this.springDelays[i].delayTime.setTargetAtTime(
          0.02 + (this.params.size / 100) * 0.08,
          this.ctx.currentTime,
          0.01
        );

        // Update chirped delays in allpass chains
        var baseDelay = (SPRING_CHIRP_FREQS[i] / 1000) * tensionFactor;
        for (var j = 0; j < this.springAllpasses[i].length; j++) {
          this.springAllpasses[i][j].delay.delayTime.setTargetAtTime(
            baseDelay * (1 + j * 0.15 * (1 + this.params.diffusion / 100)),
            this.ctx.currentTime,
            0.01
          );
        }
      }

      if (this.springResonance) {
        this.springResonance.frequency.setTargetAtTime(
          2000 + (this.params.tension / 100) * 2000,
          this.ctx.currentTime,
          0.01
        );
      }
    }

    //==========================================================================
    // SHIMMER REVERB
    //==========================================================================
    //
    // Shimmer reverb: a reverb tail where late reflections are pitch-shifted
    // (typically +12 semitones / one octave) and fed back into the reverb
    // input. Each recirculation adds another octave layer, creating an
    // ethereal, ever-ascending texture. Popularized by Brian Eno and Daniel
    // Lanois (U2's "The Unforgettable Fire", 1984) using Lexicon 224 and
    // Eventide H3000 hardware.
    //
    // Implementation: a simple delay-based reverb core provides the tail,
    // and a granular pitch shifter in the feedback path transposes the
    // recirculating signal. The shimmerAmount parameter controls how much
    // pitch-shifted signal re-enters the reverb, balancing natural decay
    // against the accumulating octave wash.

    _buildShimmerReverb() {
      var ctx = this.ctx;

      // Build a basic reverb base (using FDN approach)
      this._buildShimmerBase();

      // Add pitch-shifted feedback path
      this._buildShimmerPitchPath();
    }

    _buildShimmerBase() {
      var ctx = this.ctx;

      // Simple reverb core using delays. These prime-ish delay lengths
      // (37/53/71/89 ms) create the diffuse base reverb that the pitch
      // shifter will process. Cross-feedback between lines adds density.
      this.shimmerDelays = [];
      this.shimmerGains = [];
      var delayTimes = [0.037, 0.053, 0.071, 0.089];

      for (var i = 0; i < 4; i++) {
        var delay = ctx.createDelay(0.5);
        delay.delayTime.value = delayTimes[i] * (0.5 + this.params.size / 200);

        var gain = ctx.createGain();
        gain.gain.value = 0.55 + (this.params.decay / 100) * 0.30;

        this.shimmerDelays.push(delay);
        this.shimmerGains.push(gain);
        this._algorithmNodes.push(delay, gain);
      }

      // Damping filter
      this.shimmerDamp = ctx.createBiquadFilter();
      this.shimmerDamp.type = 'lowpass';
      this.shimmerDamp.frequency.value = 20000 * (1 - this.params.damping / 100 * 0.7);
      this._algorithmNodes.push(this.shimmerDamp);

      // Summer for reverb output
      this.shimmerSum = ctx.createGain();
      this.shimmerSum.gain.value = 0.4;
      this._algorithmNodes.push(this.shimmerSum);

      // Connect delays in parallel with cross-feedback
      for (var i = 0; i < 4; i++) {
        this.predelayNode.connect(this.shimmerDelays[i]);
        this.shimmerDelays[i].connect(this.shimmerDamp);
        this.shimmerDamp.connect(this.shimmerGains[i]);
        // Cross-feedback
        this.shimmerGains[i].connect(this.shimmerDelays[(i + 1) % 4]);
        this.shimmerDelays[i].connect(this.shimmerSum);
      }
    }

    // Granular pitch shifting for the shimmer feedback path.
    // Two overlapping grains (100ms windows, staggered by half a grain)
    // create a continuous pitch-shifted stream. A sawtooth LFO modulates
    // the delay time, effectively "scanning" through the buffer at a rate
    // determined by the pitch ratio: ratio = 2^(semitones/12).
    // At +12 semitones (one octave), each recirculation doubles frequency.
    _buildShimmerPitchPath() {
      var ctx = this.ctx;

      // Granular pitch shift for shimmer effect
      // Use two grains with different offsets for smooth shifting
      this.shimmerGrains = [];
      var pitchRatio = Math.pow(2, this.params.shimmerPitch / 12);
      var grainSize = 0.1; // 100ms grains

      for (var i = 0; i < 2; i++) {
        var delay = ctx.createDelay(0.5);
        delay.delayTime.value = grainSize * i / 2;

        var gain = ctx.createGain();
        gain.gain.value = 0.5;

        this.shimmerGrains.push({ delay, gain });
        this._algorithmNodes.push(delay, gain);
      }

      // Shimmer amount control
      this.shimmerAmountGain = ctx.createGain();
      this.shimmerAmountGain.gain.value = this.params.shimmerAmount / 100;
      this._algorithmNodes.push(this.shimmerAmountGain);

      // Sawtooth LFO modulates delay time to achieve pitch shift.
      // A linearly ramping delay reads through the buffer faster or slower
      // than real time, transposing pitch. LFO rate = (1/grainSize) * (1 - 1/ratio)
      // ensures the delay ramp completes exactly once per grain window.
      this.shimmerLFO = ctx.createOscillator();
      this.shimmerLFO.type = 'sawtooth';
      var safePitchRatio = pitchRatio || 1;
      this.shimmerLFO.frequency.value = 1 / grainSize * (1 - 1/safePitchRatio);

      this.shimmerLFOGain = ctx.createGain();
      this.shimmerLFOGain.gain.value = grainSize * 0.5;

      this.shimmerLFO.connect(this.shimmerLFOGain);
      this.shimmerLFO.start();
      this._algorithmNodes.push(this.shimmerLFO, this.shimmerLFOGain);

      // Connect pitch-shifted path from reverb output back to input
      for (var i = 0; i < 2; i++) {
        this.shimmerSum.connect(this.shimmerGrains[i].delay);
        this.shimmerLFOGain.connect(this.shimmerGrains[i].delay.delayTime);
        this.shimmerGrains[i].delay.connect(this.shimmerGrains[i].gain);
        this.shimmerGrains[i].gain.connect(this.shimmerAmountGain);
      }

      // Feedback shimmer back into reverb -- this is the key connection that
      // creates the accumulating octave layers with each recirculation
      this.shimmerAmountGain.connect(this.shimmerDelays[0]);

      // Connect reverb sum to output
      this.shimmerSum.connect(this.wetGain);
    }

    _updateShimmerParams() {
      if (!this.shimmerGains) return;

      var decay = 0.55 + (this.params.decay / 100) * 0.30;
      var dampFreq = 20000 * (1 - this.params.damping / 100 * 0.7);
      var delayTimes = [0.037, 0.053, 0.071, 0.089];

      for (var i = 0; i < 4; i++) {
        this.shimmerGains[i].gain.setTargetAtTime(decay, this.ctx.currentTime, 0.01);
        this.shimmerDelays[i].delayTime.setTargetAtTime(
          delayTimes[i] * (0.5 + this.params.size / 200),
          this.ctx.currentTime,
          0.01
        );
      }

      if (this.shimmerDamp) {
        this.shimmerDamp.frequency.setTargetAtTime(dampFreq, this.ctx.currentTime, 0.01);
      }

      if (this.shimmerAmountGain) {
        this.shimmerAmountGain.gain.setTargetAtTime(
          this.params.shimmerAmount / 100,
          this.ctx.currentTime,
          0.01
        );
      }

      if (this.shimmerLFO) {
        var pitchRatio = Math.pow(2, this.params.shimmerPitch / 12);
        var safePitchRatio = pitchRatio || 1;
        var grainSize = 0.1;
        this.shimmerLFO.frequency.setTargetAtTime(
          1 / grainSize * Math.abs(1 - 1/safePitchRatio),
          this.ctx.currentTime,
          0.01
        );
      }
    }

    //==========================================================================
    // PARAMETER HANDLING
    //==========================================================================

    /**
     * Rebuild algorithm with debouncing
     */
    _rebuildAlgorithm() {
      if (this._rebuildDebounceTimer) {
        clearTimeout(this._rebuildDebounceTimer);
      }

      var self = this;
      this._rebuildDebounceTimer = setTimeout(function() {
        self._buildAlgorithm();
        self._rebuildDebounceTimer = null;
      }, this._rebuildDebounceDelay);
    }

    /**
     * Handle parameter changes
     */
    updateParam(name, value) {
      switch (name) {
        case 'algorithm':
          if (this.params.algorithm !== value) {
            this.params.algorithm = value;
            this._rebuildAlgorithm();
          }
          break;

        case 'size':
        case 'decay':
        case 'damping':
          this.params[name] = value;
          this._updateAlgorithmParams();
          break;

        case 'predelay':
          this.params.predelay = value;
          var delaySeconds = Math.max(0, Math.min(200, value)) / 1000;
          this.predelayNode.delayTime.setTargetAtTime(
            delaySeconds,
            this.ctx.currentTime,
            0.01
          );
          break;

        case 'diffusion':
          this.params.diffusion = value;
          if (this.params.algorithm === 'plate' || this.params.algorithm === 'spring') {
            this._rebuildAlgorithm();
          }
          break;

        case 'modulation':
          this.params.modulation = value;
          if (this.params.algorithm === 'plate') {
            this._updateAlgorithmParams();
          }
          break;

        case 'lowDecay':
        case 'highDecay':
          this.params[name] = value;
          if (this.params.algorithm === 'hall') {
            this._updateAlgorithmParams();
          }
          break;

        case 'tension':
          this.params.tension = value;
          if (this.params.algorithm === 'spring') {
            this._updateAlgorithmParams();
          }
          break;

        case 'springDiffusion':
          // Map springDiffusion UI param to internal diffusion for spring algorithm
          this.params.diffusion = value;
          if (this.params.algorithm === 'spring') {
            this._rebuildAlgorithm();
          }
          break;

        case 'shimmerPitch':
        case 'shimmerAmount':
          this.params[name] = value;
          if (this.params.algorithm === 'shimmer') {
            this._updateAlgorithmParams();
          }
          break;

        case 'width':
          this.params.width = value;
          if (this.params.algorithm === 'room') {
            this._updateRoomWidth();
          }
          break;
      }
    }

    /**
     * Update parameters for the current algorithm
     */
    _updateAlgorithmParams() {
      switch (this.params.algorithm) {
        case 'convolution':
          this._generateAndSetIR();
          break;
        case 'room':
          this._updateRoomParams();
          break;
        case 'plate':
          this._updatePlateParams();
          break;
        case 'hall':
          this._updateHallParams();
          break;
        case 'spring':
          this._updateSpringParams();
          break;
        case 'shimmer':
          this._updateShimmerParams();
          break;
      }
    }

    /**
     * Clean up resources
     */
    dispose() {
      // Clear debounce timers
      if (this._irDebounceTimer) {
        clearTimeout(this._irDebounceTimer);
        this._irDebounceTimer = null;
      }
      if (this._rebuildDebounceTimer) {
        clearTimeout(this._rebuildDebounceTimer);
        this._rebuildDebounceTimer = null;
      }

      // Stop any oscillators
      if (this.modLFO1) {
        try { this.modLFO1.stop(); } catch (e) { /* LFO may not have started */ }
      }
      if (this.modLFO2) {
        try { this.modLFO2.stop(); } catch (e) { /* LFO may not have started */ }
      }
      if (this.shimmerLFO) {
        try { this.shimmerLFO.stop(); } catch (e) { /* LFO may not have started */ }
      }

      // Disconnect predelay
      this.predelayNode.disconnect();

      // Clean up algorithm nodes
      this._cleanupAlgorithmNodes();

      // Call parent dispose
      super.dispose();
    }
  }

  // Export to SynthLab effects namespace
  SL.effects.Reverb = ReverbEffect;

})();
