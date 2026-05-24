// Synth Lab - Delay Effect
// Multiple delay algorithms: Digital, Tape, Analog BBD, Ping-Pong, Multi-Tap, Ducking

(function() {
  const SL = window.SynthLab;
  const BaseEffect = SL.effects.BaseEffect;

  /**
   * DelayEffect - Multi-algorithm delay processor
   *
   * Algorithms:
   * - digital: Clean, precise repeats with damping
   * - tape: Roland Space Echo style with wow/flutter and saturation
   * - analog: Memory Man style BBD with lo-fi character
   * - pingpong: Stereo bouncing delays
   * - multitap: 4 delay taps with rhythmic patterns
   * - ducking: Mix-responsive delay that ducks when input is loud
   */
  class DelayEffect extends BaseEffect {
    constructor(ctx) {
      super(ctx, 'delay');

      // Current algorithm
      this.algorithm = 'digital';

      // Initialize all parameters with defaults
      this.params = {
        algorithm: 'digital',
        time: 300,
        feedback: 40,
        // Digital
        damping: 20,
        // Tape
        wow: 20,
        flutter: 30,
        flutterRate: 1.5,
        saturation: 30,
        tapeTone: 5000,
        // Analog BBD
        bbdTone: 3500,
        noise: 10,
        // Ping-Pong
        width: 100,
        offset: 50,
        // Multi-Tap
        pattern: 'rhythmic',
        tap1Time: 150,
        tap2Time: 300,
        tap3Time: 450,
        tap4Time: 600,
        tap1Level: 100,
        tap2Level: 80,
        tap3Level: 60,
        tap4Level: 40,
        // Ducking
        duckThreshold: -24,
        duckAmount: 80,
        duckAttack: 10,
        duckRelease: 300,
        // Common
        mix: 25
      };

      // Node storage for each algorithm
      this.nodes = {};

      // Build initial algorithm
      this.buildAlgorithm(this.algorithm);
    }

    /**
     * Build the audio graph for the specified algorithm
     */
    buildAlgorithm(algorithm) {
      // Disconnect and clean up existing nodes
      this.cleanupNodes();

      switch (algorithm) {
        case 'digital':
          this.buildDigital();
          break;
        case 'tape':
          this.buildTape();
          break;
        case 'analog':
          this.buildAnalog();
          break;
        case 'pingpong':
          this.buildPingPong();
          break;
        case 'multitap':
          this.buildMultiTap();
          break;
        case 'ducking':
          this.buildDucking();
          break;
        default:
          this.buildDigital();
      }

      this.algorithm = algorithm;
    }

    /**
     * Clean up all audio nodes
     */
    cleanupNodes() {
      // Disconnect input from everything except dry path
      try {
        this.input.disconnect();
        this.input.connect(this.dryGain);
      } catch (e) {}

      // Stop and disconnect any oscillators/LFOs
      if (this.nodes.wowLFO) {
        try { this.nodes.wowLFO.stop(); } catch (e) {}
      }
      if (this.nodes.flutterLFO) {
        try { this.nodes.flutterLFO.stop(); } catch (e) {}
      }
      if (this.nodes.noiseSource) {
        try { this.nodes.noiseSource.stop(); } catch (e) {}
      }

      // Disconnect all stored nodes
      Object.values(this.nodes).forEach(node => {
        if (node && node.disconnect) {
          try { node.disconnect(); } catch (e) {}
        }
      });

      // Clear node storage
      this.nodes = {};
    }

    /**
     * Digital Delay - Clean, precise repeats
     * Signal flow:
     * input -> delayNode -> dampingFilter -> wetGain
     *             ^              |
     *             +-- feedback <-+
     */
    buildDigital() {
      const n = this.nodes;

      // Create nodes
      n.delay = this.ctx.createDelay(2.0);
      n.delay.delayTime.value = this.params.time / 1000;

      n.feedback = this.ctx.createGain();
      n.feedback.gain.value = this.params.feedback / 100;

      n.damping = this.ctx.createBiquadFilter();
      n.damping.type = 'lowpass';
      n.damping.Q.value = 0.707;
      this.updateDampingFreq();

      // Connect signal flow
      this.input.connect(n.delay);
      n.delay.connect(n.damping);
      n.damping.connect(this.wetGain);

      // Feedback loop
      n.damping.connect(n.feedback);
      n.feedback.connect(n.delay);
    }

    /**
     * Update damping filter frequency from damping param
     */
    updateDampingFreq() {
      if (!this.nodes.damping) return;
      const dampingNormalized = Math.max(0, Math.min(100, this.params.damping)) / 100;
      const cutoffFreq = 20000 * Math.pow(0.05, dampingNormalized);
      this.nodes.damping.frequency.setTargetAtTime(cutoffFreq, this.ctx.currentTime, 0.01);
    }

    /**
     * Tape Delay - Roland Space Echo style
     * Features: Wow/flutter, lowpass for tape roll-off, saturation
     */
    buildTape() {
      const n = this.nodes;

      // Main delay
      n.delay = this.ctx.createDelay(2.0);
      n.delay.delayTime.value = this.params.time / 1000;

      // Feedback gain
      n.feedback = this.ctx.createGain();
      n.feedback.gain.value = this.params.feedback / 100;

      // Tape tone filter (lowpass for roll-off)
      n.toneFilter = this.ctx.createBiquadFilter();
      n.toneFilter.type = 'lowpass';
      n.toneFilter.frequency.value = this.params.tapeTone;
      n.toneFilter.Q.value = 0.5;

      // Saturation using waveshaper
      n.saturation = this.ctx.createWaveShaper();
      this.updateTapeSaturation();

      // Wow LFO (slow pitch modulation, 0.5-1Hz)
      n.wowLFO = this.ctx.createOscillator();
      n.wowLFO.type = 'sine';
      n.wowLFO.frequency.value = 0.5 + (this.params.wow / 100) * 0.5;

      n.wowGain = this.ctx.createGain();
      // Wow affects delay time by small amount (0-5ms)
      n.wowGain.gain.value = (this.params.wow / 100) * 0.005;

      // Flutter LFO (faster wobble)
      n.flutterLFO = this.ctx.createOscillator();
      n.flutterLFO.type = 'sine';
      n.flutterLFO.frequency.value = this.params.flutterRate;

      n.flutterGain = this.ctx.createGain();
      // Flutter affects delay time by smaller amount (0-2ms)
      n.flutterGain.gain.value = (this.params.flutter / 100) * 0.002;

      // Connect LFOs to delay time
      n.wowLFO.connect(n.wowGain);
      n.wowGain.connect(n.delay.delayTime);

      n.flutterLFO.connect(n.flutterGain);
      n.flutterGain.connect(n.delay.delayTime);

      // Start LFOs
      n.wowLFO.start();
      n.flutterLFO.start();

      // Signal flow: input -> delay -> saturation -> toneFilter -> wetGain
      this.input.connect(n.delay);
      n.delay.connect(n.saturation);
      n.saturation.connect(n.toneFilter);
      n.toneFilter.connect(this.wetGain);

      // Feedback: toneFilter -> feedback -> delay
      n.toneFilter.connect(n.feedback);
      n.feedback.connect(n.delay);
    }

    /**
     * Update tape saturation curve
     */
    updateTapeSaturation() {
      if (!this.nodes.saturation) return;
      const amount = this.params.saturation / 100;
      const samples = 256;
      const curve = new Float32Array(samples);

      for (let i = 0; i < samples; i++) {
        const x = (i * 2) / samples - 1;
        // Soft clipping curve with adjustable saturation
        if (amount < 0.01) {
          curve[i] = x;
        } else {
          const k = amount * 10;
          curve[i] = Math.tanh(k * x) / Math.tanh(k);
        }
      }

      this.nodes.saturation.curve = curve;
      this.nodes.saturation.oversample = '2x';
    }

    /**
     * Analog BBD Delay - Memory Man style
     * Features: Lowpass (2-5kHz), highpass (60-100Hz), subtle noise
     */
    buildAnalog() {
      const n = this.nodes;

      // Main delay
      n.delay = this.ctx.createDelay(2.0);
      n.delay.delayTime.value = this.params.time / 1000;

      // Feedback gain
      n.feedback = this.ctx.createGain();
      n.feedback.gain.value = this.params.feedback / 100;

      // BBD bandwidth lowpass (2-5kHz)
      n.lowpass = this.ctx.createBiquadFilter();
      n.lowpass.type = 'lowpass';
      n.lowpass.frequency.value = this.params.bbdTone;
      n.lowpass.Q.value = 0.5;

      // Highpass to remove rumble (80Hz)
      n.highpass = this.ctx.createBiquadFilter();
      n.highpass.type = 'highpass';
      n.highpass.frequency.value = 80;
      n.highpass.Q.value = 0.707;

      // Noise injection in feedback
      n.noiseGain = this.ctx.createGain();
      n.noiseGain.gain.value = (this.params.noise / 100) * 0.02;

      // Create noise buffer
      const noiseBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
      const noiseData = noiseBuffer.getChannelData(0);
      for (let i = 0; i < noiseData.length; i++) {
        noiseData[i] = Math.random() * 2 - 1;
      }

      n.noiseSource = this.ctx.createBufferSource();
      n.noiseSource.buffer = noiseBuffer;
      n.noiseSource.loop = true;

      // Filter noise to make it more tape-like (band-limited)
      n.noiseFilter = this.ctx.createBiquadFilter();
      n.noiseFilter.type = 'bandpass';
      n.noiseFilter.frequency.value = 1000;
      n.noiseFilter.Q.value = 0.5;

      n.noiseSource.connect(n.noiseFilter);
      n.noiseFilter.connect(n.noiseGain);
      n.noiseSource.start();

      // Signal flow: input -> delay -> lowpass -> highpass -> wetGain
      this.input.connect(n.delay);
      n.delay.connect(n.lowpass);
      n.lowpass.connect(n.highpass);
      n.highpass.connect(this.wetGain);

      // Feedback with noise: highpass + noise -> feedback -> delay
      n.highpass.connect(n.feedback);
      n.noiseGain.connect(n.feedback);
      n.feedback.connect(n.delay);
    }

    /**
     * Ping-Pong Delay - Stereo bouncing
     * Uses ChannelSplitter/Merger for L/R processing
     */
    buildPingPong() {
      const n = this.nodes;

      const baseTime = this.params.time / 1000;
      const offsetRatio = this.params.offset / 100;

      // Create stereo splitter and merger
      n.splitter = this.ctx.createChannelSplitter(2);
      n.merger = this.ctx.createChannelMerger(2);

      // Left and right delays
      n.delayL = this.ctx.createDelay(2.0);
      n.delayL.delayTime.value = baseTime;

      n.delayR = this.ctx.createDelay(2.0);
      n.delayR.delayTime.value = baseTime * (1 + offsetRatio);

      // Feedback gains
      n.feedbackL = this.ctx.createGain();
      n.feedbackL.gain.value = this.params.feedback / 100;

      n.feedbackR = this.ctx.createGain();
      n.feedbackR.gain.value = this.params.feedback / 100;

      // Panners for width control
      const width = this.params.width / 100;
      n.panL = this.ctx.createStereoPanner();
      n.panL.pan.value = -width;

      n.panR = this.ctx.createStereoPanner();
      n.panR.pan.value = width;

      // Mix gain for each side
      n.gainL = this.ctx.createGain();
      n.gainL.gain.value = 0.5;

      n.gainR = this.ctx.createGain();
      n.gainR.gain.value = 0.5;

      // Damping filters for each channel
      n.dampL = this.ctx.createBiquadFilter();
      n.dampL.type = 'lowpass';
      n.dampL.frequency.value = 8000;
      n.dampL.Q.value = 0.707;

      n.dampR = this.ctx.createBiquadFilter();
      n.dampR.type = 'lowpass';
      n.dampR.frequency.value = 8000;
      n.dampR.Q.value = 0.707;

      // Input to both delays (mono input to stereo ping-pong)
      this.input.connect(n.delayL);

      // Left path: delayL -> dampL -> panL -> merger(0) and cross-feed to delayR
      n.delayL.connect(n.dampL);
      n.dampL.connect(n.gainL);
      n.gainL.connect(n.panL);
      n.panL.connect(this.wetGain);

      // Cross-feedback: L -> R
      n.dampL.connect(n.feedbackL);
      n.feedbackL.connect(n.delayR);

      // Right path: delayR -> dampR -> panR -> merger(1) and cross-feed to delayL
      n.delayR.connect(n.dampR);
      n.dampR.connect(n.gainR);
      n.gainR.connect(n.panR);
      n.panR.connect(this.wetGain);

      // Cross-feedback: R -> L
      n.dampR.connect(n.feedbackR);
      n.feedbackR.connect(n.delayL);
    }

    /**
     * Multi-Tap Delay - Rhythmic patterns
     * 4 delay taps with independent times and levels
     */
    buildMultiTap() {
      const n = this.nodes;

      // Apply pattern presets if not custom
      this.applyMultiTapPattern();

      // Create 4 delay taps
      n.taps = [];
      n.tapGains = [];

      const tapParams = [
        { time: this.params.tap1Time, level: this.params.tap1Level },
        { time: this.params.tap2Time, level: this.params.tap2Level },
        { time: this.params.tap3Time, level: this.params.tap3Level },
        { time: this.params.tap4Time, level: this.params.tap4Level }
      ];

      // Create a summing node for all taps
      n.tapSum = this.ctx.createGain();
      n.tapSum.gain.value = 1;

      // Feedback from sum back to input
      n.feedback = this.ctx.createGain();
      n.feedback.gain.value = this.params.feedback / 100 * 0.5; // Reduced feedback for multi-tap

      // Damping filter in feedback
      n.damping = this.ctx.createBiquadFilter();
      n.damping.type = 'lowpass';
      n.damping.frequency.value = 6000;
      n.damping.Q.value = 0.707;

      for (let i = 0; i < 4; i++) {
        const delay = this.ctx.createDelay(2.0);
        delay.delayTime.value = tapParams[i].time / 1000;

        const gain = this.ctx.createGain();
        gain.gain.value = tapParams[i].level / 100;

        // Connect: input -> delay -> gain -> tapSum
        this.input.connect(delay);
        delay.connect(gain);
        gain.connect(n.tapSum);

        n.taps.push(delay);
        n.tapGains.push(gain);
      }

      // Connect tap sum to wet output
      n.tapSum.connect(this.wetGain);

      // Feedback: tapSum -> damping -> feedback -> first tap
      n.tapSum.connect(n.damping);
      n.damping.connect(n.feedback);
      n.feedback.connect(n.taps[0]);
    }

    /**
     * Apply multi-tap pattern presets
     */
    applyMultiTapPattern() {
      const baseTime = this.params.time;

      switch (this.params.pattern) {
        case 'rhythmic':
          // Quarter notes
          this.params.tap1Time = baseTime * 0.25;
          this.params.tap2Time = baseTime * 0.5;
          this.params.tap3Time = baseTime * 0.75;
          this.params.tap4Time = baseTime;
          break;

        case 'golden':
          // Golden ratio (1.618)
          this.params.tap1Time = baseTime * 0.382;
          this.params.tap2Time = baseTime * 0.618;
          this.params.tap3Time = baseTime * 0.854;
          this.params.tap4Time = baseTime;
          break;

        case 'fibonacci':
          // Fibonacci sequence: 1, 2, 3, 5 normalized
          const fibSum = 1 + 2 + 3 + 5;
          this.params.tap1Time = baseTime * (1 / fibSum);
          this.params.tap2Time = baseTime * (3 / fibSum);
          this.params.tap3Time = baseTime * (6 / fibSum);
          this.params.tap4Time = baseTime;
          break;

        case 'custom':
          // Keep current tap times
          break;
      }

      // Clamp values
      this.params.tap1Time = Math.max(10, Math.min(2000, this.params.tap1Time));
      this.params.tap2Time = Math.max(10, Math.min(2000, this.params.tap2Time));
      this.params.tap3Time = Math.max(10, Math.min(2000, this.params.tap3Time));
      this.params.tap4Time = Math.max(10, Math.min(2000, this.params.tap4Time));
    }

    /**
     * Ducking Delay - Mix-responsive
     * Delay output attenuates when input is loud, swells during pauses
     */
    buildDucking() {
      const n = this.nodes;

      // Main delay (same as digital base)
      n.delay = this.ctx.createDelay(2.0);
      n.delay.delayTime.value = this.params.time / 1000;

      n.feedback = this.ctx.createGain();
      n.feedback.gain.value = this.params.feedback / 100;

      n.damping = this.ctx.createBiquadFilter();
      n.damping.type = 'lowpass';
      n.damping.frequency.value = 8000;
      n.damping.Q.value = 0.707;

      // Ducker gain node
      n.ducker = this.ctx.createGain();
      n.ducker.gain.value = 1;

      // Envelope follower using AnalyserNode
      n.analyser = this.ctx.createAnalyser();
      n.analyser.fftSize = 256;
      n.analyser.smoothingTimeConstant = 0.5;

      // Connect input to analyser for envelope detection
      this.input.connect(n.analyser);

      // Signal flow: input -> delay -> damping -> ducker -> wetGain
      this.input.connect(n.delay);
      n.delay.connect(n.damping);
      n.damping.connect(n.ducker);
      n.ducker.connect(this.wetGain);

      // Feedback: damping -> feedback -> delay
      n.damping.connect(n.feedback);
      n.feedback.connect(n.delay);

      // Start envelope follower
      this.startEnvelopeFollower();
    }

    /**
     * Start the envelope follower for ducking
     */
    startEnvelopeFollower() {
      if (this._duckingInterval) {
        clearInterval(this._duckingInterval);
      }

      const analyser = this.nodes.analyser;
      const ducker = this.nodes.ducker;
      if (!analyser || !ducker) return;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      // Store current gain for smooth transitions
      let currentGain = 1;

      this._duckingInterval = setInterval(() => {
        if (!this.enabled || this.algorithm !== 'ducking') {
          clearInterval(this._duckingInterval);
          this._duckingInterval = null;
          return;
        }

        // Get time domain data
        analyser.getByteTimeDomainData(dataArray);

        // Calculate RMS level
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const normalized = (dataArray[i] - 128) / 128;
          sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / dataArray.length);

        // Convert to dB
        const db = 20 * Math.log10(rms + 0.0001);

        // Calculate target gain based on threshold and duck amount
        const threshold = this.params.duckThreshold;
        const duckAmount = this.params.duckAmount / 100;

        let targetGain;
        if (db > threshold) {
          // Above threshold - duck
          const excess = db - threshold;
          const reduction = Math.min(1, excess / 20) * duckAmount;
          targetGain = 1 - reduction;
        } else {
          // Below threshold - full volume
          targetGain = 1;
        }

        // Apply attack/release smoothing
        const attackTime = this.params.duckAttack / 1000;
        const releaseTime = this.params.duckRelease / 1000;

        if (targetGain < currentGain) {
          // Attacking (ducking)
          currentGain = currentGain + (targetGain - currentGain) * Math.min(1, 0.016 / attackTime);
        } else {
          // Releasing (un-ducking)
          currentGain = currentGain + (targetGain - currentGain) * Math.min(1, 0.016 / releaseTime);
        }

        // Apply gain
        ducker.gain.setTargetAtTime(currentGain, this.ctx.currentTime, 0.01);
      }, 16); // ~60fps
    }

    /**
     * Handle parameter updates
     */
    updateParam(name, value) {
      const now = this.ctx.currentTime;

      // Handle algorithm change
      if (name === 'algorithm') {
        if (value !== this.algorithm) {
          this.buildAlgorithm(value);
        }
        return;
      }

      switch (name) {
        case 'time':
          this.updateDelayTime(value);
          break;

        case 'feedback':
          this.updateFeedback(value);
          break;

        case 'damping':
          this.updateDampingFreq();
          break;

        // Tape params
        case 'wow':
          if (this.nodes.wowGain) {
            this.nodes.wowGain.gain.setTargetAtTime((value / 100) * 0.005, now, 0.01);
          }
          if (this.nodes.wowLFO) {
            this.nodes.wowLFO.frequency.setTargetAtTime(0.5 + (value / 100) * 0.5, now, 0.01);
          }
          break;

        case 'flutter':
          if (this.nodes.flutterGain) {
            this.nodes.flutterGain.gain.setTargetAtTime((value / 100) * 0.002, now, 0.01);
          }
          break;

        case 'flutterRate':
          if (this.nodes.flutterLFO) {
            this.nodes.flutterLFO.frequency.setTargetAtTime(value, now, 0.01);
          }
          break;

        case 'saturation':
          this.updateTapeSaturation();
          break;

        case 'tapeTone':
          if (this.nodes.toneFilter) {
            this.nodes.toneFilter.frequency.setTargetAtTime(value, now, 0.01);
          }
          break;

        // Analog params
        case 'bbdTone':
          if (this.nodes.lowpass) {
            this.nodes.lowpass.frequency.setTargetAtTime(value, now, 0.01);
          }
          break;

        case 'noise':
          if (this.nodes.noiseGain) {
            this.nodes.noiseGain.gain.setTargetAtTime((value / 100) * 0.02, now, 0.01);
          }
          break;

        // Ping-Pong params
        case 'width':
          if (this.nodes.panL && this.nodes.panR) {
            const w = value / 100;
            this.nodes.panL.pan.setTargetAtTime(-w, now, 0.01);
            this.nodes.panR.pan.setTargetAtTime(w, now, 0.01);
          }
          break;

        case 'offset':
          if (this.nodes.delayR) {
            const baseTime = this.params.time / 1000;
            const offsetRatio = value / 100;
            this.nodes.delayR.delayTime.setTargetAtTime(baseTime * (1 + offsetRatio), now, 0.01);
          }
          break;

        // Multi-Tap params
        case 'pattern':
          if (this.algorithm === 'multitap') {
            this.applyMultiTapPattern();
            this.updateMultiTapDelays();
          }
          break;

        case 'tap1Time':
        case 'tap2Time':
        case 'tap3Time':
        case 'tap4Time':
          this.updateMultiTapDelays();
          break;

        case 'tap1Level':
        case 'tap2Level':
        case 'tap3Level':
        case 'tap4Level':
          this.updateMultiTapLevels();
          break;

        // Ducking params - stored in params, used by envelope follower
        case 'duckThreshold':
        case 'duckAmount':
        case 'duckAttack':
        case 'duckRelease':
          // These are read directly by the envelope follower
          break;
      }
    }

    /**
     * Update delay time across all algorithms
     */
    updateDelayTime(value) {
      const now = this.ctx.currentTime;
      const timeInSeconds = Math.max(0.01, Math.min(2.0, value / 1000));

      switch (this.algorithm) {
        case 'digital':
        case 'tape':
        case 'analog':
        case 'ducking':
          if (this.nodes.delay) {
            this.nodes.delay.delayTime.setTargetAtTime(timeInSeconds, now, 0.01);
          }
          break;

        case 'pingpong':
          if (this.nodes.delayL) {
            this.nodes.delayL.delayTime.setTargetAtTime(timeInSeconds, now, 0.01);
          }
          if (this.nodes.delayR) {
            const offsetRatio = this.params.offset / 100;
            this.nodes.delayR.delayTime.setTargetAtTime(timeInSeconds * (1 + offsetRatio), now, 0.01);
          }
          break;

        case 'multitap':
          this.applyMultiTapPattern();
          this.updateMultiTapDelays();
          break;
      }
    }

    /**
     * Update feedback across all algorithms
     */
    updateFeedback(value) {
      const now = this.ctx.currentTime;
      var DELAY_FEEDBACK_MAX = 0.88;
      const feedbackValue = Math.max(0, Math.min(DELAY_FEEDBACK_MAX, value / 100));

      if (this.nodes.feedback) {
        if (this.algorithm === 'multitap') {
          this.nodes.feedback.gain.setTargetAtTime(feedbackValue * 0.5, now, 0.01);
        } else {
          this.nodes.feedback.gain.setTargetAtTime(feedbackValue, now, 0.01);
        }
      }

      // Ping-pong has two feedback gains
      if (this.nodes.feedbackL) {
        this.nodes.feedbackL.gain.setTargetAtTime(feedbackValue, now, 0.01);
      }
      if (this.nodes.feedbackR) {
        this.nodes.feedbackR.gain.setTargetAtTime(feedbackValue, now, 0.01);
      }
    }

    /**
     * Update multi-tap delay times
     */
    updateMultiTapDelays() {
      if (!this.nodes.taps) return;
      const now = this.ctx.currentTime;

      const times = [
        this.params.tap1Time,
        this.params.tap2Time,
        this.params.tap3Time,
        this.params.tap4Time
      ];

      for (let i = 0; i < this.nodes.taps.length; i++) {
        const timeInSeconds = Math.max(0.01, Math.min(2.0, times[i] / 1000));
        this.nodes.taps[i].delayTime.setTargetAtTime(timeInSeconds, now, 0.01);
      }
    }

    /**
     * Update multi-tap levels
     */
    updateMultiTapLevels() {
      if (!this.nodes.tapGains) return;
      const now = this.ctx.currentTime;

      const levels = [
        this.params.tap1Level,
        this.params.tap2Level,
        this.params.tap3Level,
        this.params.tap4Level
      ];

      for (let i = 0; i < this.nodes.tapGains.length; i++) {
        this.nodes.tapGains[i].gain.setTargetAtTime(levels[i] / 100, now, 0.01);
      }
    }

    /**
     * Clean up audio nodes
     */
    dispose() {
      // Stop envelope follower
      if (this._duckingInterval) {
        clearInterval(this._duckingInterval);
        this._duckingInterval = null;
      }

      this.cleanupNodes();
      super.dispose();
    }
  }

  // Export to SynthLab namespace
  SL.effects.Delay = DelayEffect;

})();
