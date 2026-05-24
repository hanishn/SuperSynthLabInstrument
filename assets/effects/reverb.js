// Synth Lab - Reverb Effect
// Multiple reverb algorithms: convolution, room (Freeverb), plate (Dattorro), hall (FDN), spring, shimmer

(function() {
  const SL = window.SynthLab;
  const BaseEffect = SL.effects.BaseEffect;

  // Comb filter delay times for Freeverb (in samples at 44100Hz)
  // Slightly different for L/R channels for stereo width
  const COMB_TUNINGS_L = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const COMB_TUNINGS_R = [1116 + 23, 1188 + 23, 1277 + 23, 1356 + 23, 1422 + 23, 1491 + 23, 1557 + 23, 1617 + 23];

  // Allpass filter delay times for Freeverb
  const ALLPASS_TUNINGS = [556, 441, 341, 225];

  // Prime number delay times for FDN Hall (in ms)
  const FDN_DELAY_TIMES = [29, 37, 43, 53, 67, 79, 89, 97];

  // Spring reverb chirp frequencies
  const SPRING_CHIRP_FREQS = [180, 220, 280, 340];

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

      // Create predelay node
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
      this._algorithmNodes.forEach(node => {
        try {
          node.disconnect();
        } catch (e) {
          // Node may already be disconnected
        }
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

    _generateIR() {
      const sampleRate = this.ctx.sampleRate;
      const duration = this._getDuration();
      const decayRate = this._getDecayRate();
      const dampingCoeff = this._getDampingCoeff();

      const length = Math.floor(sampleRate * duration);
      const buffer = this.ctx.createBuffer(2, length, sampleRate);

      for (let channel = 0; channel < 2; channel++) {
        const data = buffer.getChannelData(channel);
        const channelDecayOffset = channel === 0 ? 0.95 : 1.05;
        const effectiveDecay = decayRate * channelDecayOffset;
        let lpState = 0;

        for (let i = 0; i < length; i++) {
          const t = i / sampleRate;
          const envelope = Math.exp(-effectiveDecay * t);
          let sample = (Math.random() * 2 - 1) * envelope;

          if (dampingCoeff > 0) {
            sample = (1 - dampingCoeff) * sample + dampingCoeff * lpState;
            lpState = sample;
          }

          data[i] = sample;
        }

        const earlyReflectionSamples = Math.floor(sampleRate * 0.05);
        for (let i = 0; i < earlyReflectionSamples && i < length; i++) {
          const boost = 1 + (1 - i / earlyReflectionSamples) * 0.3;
          data[i] *= boost;
        }
      }

      return buffer;
    }

    _generateAndSetIR() {
      if (this._irDebounceTimer) {
        clearTimeout(this._irDebounceTimer);
      }

      this._irDebounceTimer = setTimeout(() => {
        try {
          if (this.convolver) {
            const ir = this._generateIR();
            this.convolver.buffer = ir;
          }
        } catch (e) {
          console.error('Reverb: Error generating impulse response:', e);
        }
        this._irDebounceTimer = null;
      }, this._irDebounceDelay);
    }

    //==========================================================================
    // ROOM REVERB (Freeverb / Jezar's algorithm)
    //==========================================================================

    _buildRoomReverb() {
      const ctx = this.ctx;
      const sampleRate = ctx.sampleRate;
      const scaleFactor = sampleRate / 44100;

      // Create stereo splitter and merger
      this.splitter = ctx.createChannelSplitter(2);
      this.merger = ctx.createChannelMerger(2);
      this._algorithmNodes.push(this.splitter, this.merger);

      // Mono input sum for reverb processing
      this.monoSum = ctx.createGain();
      this.monoSum.gain.value = 0.5;
      this._algorithmNodes.push(this.monoSum);

      // Comb filter banks (8 parallel comb filters per channel)
      this.combFiltersL = [];
      this.combFiltersR = [];
      this.combGainsL = [];
      this.combGainsR = [];
      this.combDampingL = [];
      this.combDampingR = [];

      var REVERB_FEEDBACK_BASE = 0.75;
      var REVERB_FEEDBACK_RANGE = 0.10;
      const feedback = REVERB_FEEDBACK_BASE + (this.params.size / 100) * REVERB_FEEDBACK_RANGE;
      const dampingValue = this.params.damping / 100;

      for (let i = 0; i < 8; i++) {
        // Left channel comb
        const delayL = ctx.createDelay(1);
        delayL.delayTime.value = (COMB_TUNINGS_L[i] * scaleFactor) / sampleRate;
        const gainL = ctx.createGain();
        gainL.gain.value = feedback;
        const dampL = ctx.createBiquadFilter();
        dampL.type = 'lowpass';
        dampL.frequency.value = 20000 * (1 - dampingValue * 0.8);

        this.combFiltersL.push(delayL);
        this.combGainsL.push(gainL);
        this.combDampingL.push(dampL);
        this._algorithmNodes.push(delayL, gainL, dampL);

        // Right channel comb
        const delayR = ctx.createDelay(1);
        delayR.delayTime.value = (COMB_TUNINGS_R[i] * scaleFactor) / sampleRate;
        const gainR = ctx.createGain();
        gainR.gain.value = feedback;
        const dampR = ctx.createBiquadFilter();
        dampR.type = 'lowpass';
        dampR.frequency.value = 20000 * (1 - dampingValue * 0.8);

        this.combFiltersR.push(delayR);
        this.combGainsR.push(gainR);
        this.combDampingR.push(dampR);
        this._algorithmNodes.push(delayR, gainR, dampR);
      }

      // Allpass filters for diffusion (4 in series per channel)
      this.allpassFiltersL = [];
      this.allpassFiltersR = [];

      for (let i = 0; i < 4; i++) {
        const apDelayL = ctx.createDelay(0.1);
        apDelayL.delayTime.value = (ALLPASS_TUNINGS[i] * scaleFactor) / sampleRate;
        const apGainL = ctx.createGain();
        apGainL.gain.value = 0.5;

        const apDelayR = ctx.createDelay(0.1);
        apDelayR.delayTime.value = (ALLPASS_TUNINGS[i] * scaleFactor) / sampleRate;
        const apGainR = ctx.createGain();
        apGainR.gain.value = 0.5;

        this.allpassFiltersL.push({ delay: apDelayL, gain: apGainL });
        this.allpassFiltersR.push({ delay: apDelayR, gain: apGainR });
        this._algorithmNodes.push(apDelayL, apGainL, apDelayR, apGainR);
      }

      // Sum gains for comb outputs
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
      for (let i = 0; i < 8; i++) {
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
      let prevL = this.combSumL;
      let prevR = this.combSumR;
      for (let i = 0; i < 4; i++) {
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
      const width = this.params.width / 100;
      this.widthGainL.gain.value = 0.5 + width * 0.5;
      this.widthGainR.gain.value = 0.5 + width * 0.5;
    }

    _updateRoomParams() {
      if (!this.combGainsL) return;

      var REVERB_FEEDBACK_BASE = 0.75;
      var REVERB_FEEDBACK_RANGE = 0.10;
      const feedback = REVERB_FEEDBACK_BASE + (this.params.size / 100) * REVERB_FEEDBACK_RANGE;
      const dampingValue = this.params.damping / 100;
      const dampFreq = 20000 * (1 - dampingValue * 0.8);

      for (let i = 0; i < 8; i++) {
        this.combGainsL[i].gain.setTargetAtTime(feedback, this.ctx.currentTime, 0.01);
        this.combGainsR[i].gain.setTargetAtTime(feedback, this.ctx.currentTime, 0.01);
        this.combDampingL[i].frequency.setTargetAtTime(dampFreq, this.ctx.currentTime, 0.01);
        this.combDampingR[i].frequency.setTargetAtTime(dampFreq, this.ctx.currentTime, 0.01);
      }
    }

    //==========================================================================
    // PLATE REVERB (Dattorro-style)
    //==========================================================================

    _buildPlateReverb() {
      const ctx = this.ctx;
      const sampleRate = ctx.sampleRate;

      // Input diffusers (4 allpass filters in series)
      this.inputDiffusers = [];
      const diffuserTimes = [142, 107, 379, 277];
      const diffuserGain = 0.5 + (this.params.diffusion / 100) * 0.25;

      for (let i = 0; i < 4; i++) {
        const delay = ctx.createDelay(0.1);
        delay.delayTime.value = diffuserTimes[i] / sampleRate;
        const gain = ctx.createGain();
        gain.gain.value = diffuserGain;
        this.inputDiffusers.push({ delay, gain });
        this._algorithmNodes.push(delay, gain);
      }

      // Tank delays with modulation
      this.tankDelaysL = [];
      this.tankDelaysR = [];
      this.tankGainsL = [];
      this.tankGainsR = [];
      const tankTimes = [672, 1800, 908, 2656];

      for (let i = 0; i < 2; i++) {
        const delayL = ctx.createDelay(0.5);
        delayL.delayTime.value = (tankTimes[i] * (0.8 + this.params.size / 500)) / sampleRate;
        const gainL = ctx.createGain();
        gainL.gain.value = 0.55 + (this.params.decay / 100) * 0.30;

        const delayR = ctx.createDelay(0.5);
        delayR.delayTime.value = (tankTimes[i + 2] * (0.8 + this.params.size / 500)) / sampleRate;
        const gainR = ctx.createGain();
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

      // Modulation LFOs
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
      let prev = this.predelayNode;
      for (let i = 0; i < 4; i++) {
        prev.connect(this.inputDiffusers[i].delay);
        prev = this.inputDiffusers[i].delay;
      }

      // Connect to tank (cross-coupled feedback)
      const diffuserOut = this.inputDiffusers[3].delay;

      // Left tank path
      diffuserOut.connect(this.tankDelaysL[0]);
      this.tankDelaysL[0].connect(this.tankDampL);
      this.tankDampL.connect(this.tankGainsL[0]);
      this.tankGainsL[0].connect(this.tankDelaysL[1]);
      this.tankDelaysL[1].connect(this.tankGainsL[1]);
      this.tankGainsL[1].connect(this.tankDelaysR[0]); // Cross-couple to right

      // Right tank path
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

      const decay = 0.55 + (this.params.decay / 100) * 0.30;
      const dampFreq = 20000 * (1 - this.params.damping / 100 * 0.7);

      for (let i = 0; i < 2; i++) {
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

    _buildHallReverb() {
      const ctx = this.ctx;
      const sampleRate = ctx.sampleRate;

      // Use 4 delay lines for efficiency
      const numDelays = 4;
      this.fdnDelays = [];
      this.fdnGains = [];
      this.fdnLowFilters = [];
      this.fdnHighFilters = [];
      this.fdnInputGains = [];

      // Hadamard-like mixing matrix for 4x4
      const mixMatrix = [
        [1, 1, 1, 1],
        [1, -1, 1, -1],
        [1, 1, -1, -1],
        [1, -1, -1, 1]
      ];
      const matrixScale = 0.5;

      for (let i = 0; i < numDelays; i++) {
        const delay = ctx.createDelay(0.5);
        const baseTime = FDN_DELAY_TIMES[i] / 1000;
        delay.delayTime.value = baseTime * (0.5 + this.params.size / 100);

        const gain = ctx.createGain();
        gain.gain.value = 0.65 + (this.params.decay / 100) * 0.20;

        // Per-band decay control
        const lowFilter = ctx.createBiquadFilter();
        lowFilter.type = 'lowshelf';
        lowFilter.frequency.value = 500;
        lowFilter.gain.value = (this.params.lowDecay - 50) / 5;

        const highFilter = ctx.createBiquadFilter();
        highFilter.type = 'highshelf';
        highFilter.frequency.value = 4000;
        highFilter.gain.value = (this.params.highDecay - 50) / 5;

        const inputGain = ctx.createGain();
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
      for (let i = 0; i < numDelays; i++) {
        const rowGains = [];
        for (let j = 0; j < numDelays; j++) {
          const mixGain = ctx.createGain();
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
      for (let i = 0; i < numDelays; i++) {
        this.predelayNode.connect(this.fdnInputGains[i]);
        this.fdnInputGains[i].connect(this.fdnDelays[i]);
      }

      // Connect each delay through its processing and back via mixing matrix
      for (let i = 0; i < numDelays; i++) {
        this.fdnDelays[i].connect(this.fdnLowFilters[i]);
        this.fdnLowFilters[i].connect(this.fdnHighFilters[i]);
        this.fdnHighFilters[i].connect(this.fdnGains[i]);

        // Connect to mix matrix (feedback to all other delays)
        for (let j = 0; j < numDelays; j++) {
          this.fdnGains[i].connect(this.fdnMixGains[j][i]);
          this.fdnMixGains[j][i].connect(this.fdnDelays[j]);
        }

        // Tap outputs (alternate L/R for stereo)
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

      const decayGain = 0.65 + (this.params.decay / 100) * 0.20;

      for (let i = 0; i < this.fdnGains.length; i++) {
        this.fdnGains[i].gain.setTargetAtTime(decayGain, this.ctx.currentTime, 0.01);

        const baseTime = FDN_DELAY_TIMES[i] / 1000;
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

    _buildSpringReverb() {
      const ctx = this.ctx;
      const sampleRate = ctx.sampleRate;

      // Spring reverb characteristics:
      // - Chirped allpass chains for dispersion
      // - Characteristic metallic "drip" sound

      this.springAllpasses = [];
      this.springDelays = [];
      this.springGains = [];

      // Create multiple allpass chains for the "sproingy" character
      const numChains = 4;
      const tensionFactor = 0.5 + (this.params.tension / 100) * 0.5;

      for (let i = 0; i < numChains; i++) {
        const chain = [];
        // Each chain has 6-8 allpasses with chirped delay times
        const baseDelay = (SPRING_CHIRP_FREQS[i] / 1000) * tensionFactor;

        for (let j = 0; j < 6; j++) {
          const delay = ctx.createDelay(0.1);
          // Chirped: delay times increase through the chain
          delay.delayTime.value = baseDelay * (1 + j * 0.15 * (1 + this.params.diffusion / 100));

          const gain = ctx.createGain();
          gain.gain.value = 0.5;

          chain.push({ delay, gain });
          this._algorithmNodes.push(delay, gain);
        }
        this.springAllpasses.push(chain);

        // Add a delay line for overall reverb time
        const reverbDelay = ctx.createDelay(0.5);
        reverbDelay.delayTime.value = 0.02 + (this.params.size / 100) * 0.08;
        this.springDelays.push(reverbDelay);
        this._algorithmNodes.push(reverbDelay);

        const feedbackGain = ctx.createGain();
        feedbackGain.gain.value = 0.5 + (this.params.decay / 100) * 0.35;
        this.springGains.push(feedbackGain);
        this._algorithmNodes.push(feedbackGain);
      }

      // Lo-fi character filters
      this.springLopass = ctx.createBiquadFilter();
      this.springLopass.type = 'lowpass';
      this.springLopass.frequency.value = 4000;
      this.springLopass.Q.value = 1;
      this._algorithmNodes.push(this.springLopass);

      this.springHipass = ctx.createBiquadFilter();
      this.springHipass.type = 'highpass';
      this.springHipass.frequency.value = 150;
      this._algorithmNodes.push(this.springHipass);

      // Add some resonance for the characteristic "boing"
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
      for (let i = 0; i < numChains; i++) {
        let prev = this.predelayNode;

        // Connect allpass chain
        for (let j = 0; j < this.springAllpasses[i].length; j++) {
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

      const tensionFactor = 0.5 + (this.params.tension / 100) * 0.5;

      for (let i = 0; i < this.springGains.length; i++) {
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
        const baseDelay = (SPRING_CHIRP_FREQS[i] / 1000) * tensionFactor;
        for (let j = 0; j < this.springAllpasses[i].length; j++) {
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

    _buildShimmerReverb() {
      const ctx = this.ctx;

      // Build a basic reverb base (using FDN approach)
      this._buildShimmerBase();

      // Add pitch-shifted feedback path
      this._buildShimmerPitchPath();
    }

    _buildShimmerBase() {
      const ctx = this.ctx;

      // Simple reverb core using delays
      this.shimmerDelays = [];
      this.shimmerGains = [];
      const delayTimes = [0.037, 0.053, 0.071, 0.089];

      for (let i = 0; i < 4; i++) {
        const delay = ctx.createDelay(0.5);
        delay.delayTime.value = delayTimes[i] * (0.5 + this.params.size / 200);

        const gain = ctx.createGain();
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
      for (let i = 0; i < 4; i++) {
        this.predelayNode.connect(this.shimmerDelays[i]);
        this.shimmerDelays[i].connect(this.shimmerDamp);
        this.shimmerDamp.connect(this.shimmerGains[i]);
        // Cross-feedback
        this.shimmerGains[i].connect(this.shimmerDelays[(i + 1) % 4]);
        this.shimmerDelays[i].connect(this.shimmerSum);
      }
    }

    _buildShimmerPitchPath() {
      const ctx = this.ctx;

      // Granular pitch shift for shimmer effect
      // Use two grains with different offsets for smooth shifting
      this.shimmerGrains = [];
      const pitchRatio = Math.pow(2, this.params.shimmerPitch / 12);
      const grainSize = 0.1; // 100ms grains

      for (let i = 0; i < 2; i++) {
        const delay = ctx.createDelay(0.5);
        delay.delayTime.value = grainSize * i / 2;

        const gain = ctx.createGain();
        gain.gain.value = 0.5;

        this.shimmerGrains.push({ delay, gain });
        this._algorithmNodes.push(delay, gain);
      }

      // Shimmer amount control
      this.shimmerAmountGain = ctx.createGain();
      this.shimmerAmountGain.gain.value = this.params.shimmerAmount / 100;
      this._algorithmNodes.push(this.shimmerAmountGain);

      // Playback rate modulation for pitch shift (simplified approach)
      // Create LFO to modulate delay time for pitch effect
      this.shimmerLFO = ctx.createOscillator();
      this.shimmerLFO.type = 'sawtooth';
      this.shimmerLFO.frequency.value = 1 / grainSize * (1 - 1/pitchRatio);

      this.shimmerLFOGain = ctx.createGain();
      this.shimmerLFOGain.gain.value = grainSize * 0.5;

      this.shimmerLFO.connect(this.shimmerLFOGain);
      this.shimmerLFO.start();
      this._algorithmNodes.push(this.shimmerLFO, this.shimmerLFOGain);

      // Connect pitch-shifted path from reverb output back to input
      for (let i = 0; i < 2; i++) {
        this.shimmerSum.connect(this.shimmerGrains[i].delay);
        this.shimmerLFOGain.connect(this.shimmerGrains[i].delay.delayTime);
        this.shimmerGrains[i].delay.connect(this.shimmerGrains[i].gain);
        this.shimmerGrains[i].gain.connect(this.shimmerAmountGain);
      }

      // Feedback shimmer back into reverb
      this.shimmerAmountGain.connect(this.shimmerDelays[0]);

      // Connect reverb sum to output
      this.shimmerSum.connect(this.wetGain);
    }

    _updateShimmerParams() {
      if (!this.shimmerGains) return;

      const decay = 0.55 + (this.params.decay / 100) * 0.30;
      const dampFreq = 20000 * (1 - this.params.damping / 100 * 0.7);
      const delayTimes = [0.037, 0.053, 0.071, 0.089];

      for (let i = 0; i < 4; i++) {
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
        const pitchRatio = Math.pow(2, this.params.shimmerPitch / 12);
        const grainSize = 0.1;
        this.shimmerLFO.frequency.setTargetAtTime(
          1 / grainSize * Math.abs(1 - 1/pitchRatio),
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

      this._rebuildDebounceTimer = setTimeout(() => {
        this._buildAlgorithm();
        this._rebuildDebounceTimer = null;
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
          const delaySeconds = Math.max(0, Math.min(200, value)) / 1000;
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
        try { this.modLFO1.stop(); } catch (e) {}
      }
      if (this.modLFO2) {
        try { this.modLFO2.stop(); } catch (e) {}
      }
      if (this.shimmerLFO) {
        try { this.shimmerLFO.stop(); } catch (e) {}
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
