// Synth Lab - Gated Reverb Effect
// The iconic 80s drum sound - reverb with abrupt gate cutoff (Phil Collins, Peter Gabriel style)

(function() {
  var SL = window.SynthLab = window.SynthLab || {};
  SL.effects = SL.effects || {};
  var BaseEffect = SL.effects.BaseEffect;

  /**
   * GatedReverbEffect - Convolution reverb with noise gate
   * Creates the classic 80s gated drum sound by applying a noise gate
   * to the reverb tail, creating an abrupt cutoff instead of natural decay.
   *
   * Parameters:
   * - size: 0-100 (room size, affects IR duration from 0.3s to 2s)
   * - decay: 0-100 (reverb decay rate within the IR)
   * - threshold: -60 to 0 dB (gate threshold)
   * - release: 10-500 ms (gate release time)
   * - mix: 0-100 (wet/dry mix, inherited from BaseEffect)
   */
  class GatedReverbEffect extends BaseEffect {
    constructor(ctx) {
      super(ctx, 'gated-reverb');

      // Initialize parameters with defaults - DO NOT call setMix or setEnabled
      this.params.size = 60;         // Room size (affects IR duration)
      this.params.decay = 40;        // Decay rate within IR
      this.params.threshold = -30;   // Gate threshold in dB
      this.params.release = 100;     // Gate release in ms
      this.params.mix = 50;          // Default mix for gated reverb

      // Create convolver for reverb
      this.convolver = ctx.createConvolver();

      // Create analyzer for envelope following (gate detection)
      this.analyzer = ctx.createAnalyser();
      this.analyzer.fftSize = 256;
      this.analyzer.smoothingTimeConstant = 0.5;
      this._analyzerData = new Float32Array(this.analyzer.fftSize);

      // Create gate gain node - this is what opens/closes the gate
      this.gateGain = ctx.createGain();
      this.gateGain.gain.value = 1;

      // Output gain for level compensation
      this.outputGain = ctx.createGain();
      this.outputGain.gain.value = 1.2; // Slight boost to compensate for gating

      // Signal flow for wet path:
      // input -> convolver -> gateGain -> outputGain -> wetGain
      // input -> analyzer (for envelope detection, doesn't pass audio)
      this.input.connect(this.convolver);
      this.input.connect(this.analyzer);
      this.convolver.connect(this.gateGain);
      this.gateGain.connect(this.outputGain);
      this.outputGain.connect(this.wetGain);

      // Debounce timer for IR regeneration
      this._irDebounceTimer = null;
      this._irDebounceDelay = 100;

      // Gate processing state
      this._gateOpen = false;
      this._lastGateTime = 0;
      this._animationFrameId = null;

      // Generate initial impulse response
      this._generateAndSetIR();

      // rAF loop only runs when enabled — started in setEnabled(true)
    }

    /**
     * Override setEnabled to start/stop gate processing loop
     */
    setEnabled(on) {
      super.setEnabled(on);
      if (on) {
        this._startGateProcessing();
      } else {
        this._stopGateProcessing();
        // Reset gate to open when disabled so audio passes through
        this.gateGain.gain.cancelScheduledValues(this.ctx.currentTime);
        this.gateGain.gain.setValueAtTime(1, this.ctx.currentTime);
        this._gateOpen = false;
      }
    }

    /**
     * Calculate IR duration from size parameter
     * For gated reverb, we use shorter durations than normal reverb
     * size 0 = 0.3s, size 100 = 2s
     */
    _getDuration() {
      return 0.3 + (this.params.size / 100) * 1.7;
    }

    /**
     * Calculate decay rate from decay parameter
     * Maps 0-100 to decay multipliers
     */
    _getDecayRate() {
      // Map 0-100 to 1-6 (faster decay for gated sound)
      return 1 + ((100 - this.params.decay) / 100) * 5;
    }

    /**
     * Generate stereo impulse response buffer for gated reverb
     * Uses a denser early reflection pattern for that classic 80s sound
     */
    _generateIR() {
      var sampleRate = this.ctx.sampleRate;
      var duration = this._getDuration();
      var decayRate = this._getDecayRate();

      var length = Math.floor(sampleRate * duration);
      var buffer = this.ctx.createBuffer(2, length, sampleRate);

      for (var channel = 0; channel < 2; channel++) {
        var data = buffer.getChannelData(channel);

        // Channel var iation for stereo width
        var channelDecayOffset = channel === 0 ? 0.97 : 1.03;
        var effectiveDecay = decayRate * channelDecayOffset;

        for (var i = 0; i < length; i++) {
          var t = i / sampleRate;

          // Create a more aggressive initial burst followed by decay
          // This is characteristic of gated reverb - strong attack, then gate cuts it
          var envelope;

          // Initial attack burst (first 30ms)
          var attackTime = 0.03;
          if (t < attackTime) {
            // Fast rise to peak
            envelope = Math.pow(t / attackTime, 0.5);
          } else {
            // Exponential decay after attack
            envelope = Math.exp(-effectiveDecay * (t - attackTime));
          }

          // Random noise with envelope
          var sample = (Math.random() * 2 - 1) * envelope;

          // Add some early reflections character
          // Simulate discrete reflections in the first 50ms
          if (t < 0.05) {
            var reflectionIntervals = [0.007, 0.013, 0.019, 0.027, 0.037, 0.043];
            for (var interval of reflectionIntervals) {
              if (Math.abs(t - interval) < 0.002) {
                // Add discrete reflection spikes
                sample += (Math.random() * 0.5 - 0.25) * (1 - t / 0.05);
              }
            }
          }

          data[i] = sample;
        }

        // Normalize the channel
        var maxVal = 0;
        for (var i = 0; i < length; i++) {
          maxVal = Math.max(maxVal, Math.abs(data[i]));
        }
        if (maxVal > 0) {
          var normFactor = 0.9 / maxVal;
          for (var i = 0; i < length; i++) {
            data[i] *= normFactor;
          }
        }
      }

      return buffer;
    }

    /**
     * Generate IR and set it on the convolver (debounced)
     */
    _generateAndSetIR() {
      if (this._irDebounceTimer) {
        clearTimeout(this._irDebounceTimer);
      }

      var self = this;
      this._irDebounceTimer = setTimeout(function() {
        try {
          var ir = self._generateIR();
          self.convolver.buffer = ir;
        } catch (e) {
          console.error('GatedReverb: Error generating impulse response:', e);
        }
        self._irDebounceTimer = null;
      }, this._irDebounceDelay);
    }

    /**
     * Convert linear amplitude to dB
     */
    _linearToDb(linear) {
      return 20 * Math.log10(Math.max(linear, 0.000001));
    }

    /**
     * Start the gate processing loop
     * Uses requestAnimationFrame to continuously monitor input level
     * and control the gate gain accordingly
     */
    _startGateProcessing() {
      var self = this;
      var processGate = function() {
        self._animationFrameId = requestAnimationFrame(processGate);

        if (!SL._tabVisible) return;

        // Get current input level from analyzer
        self.analyzer.getFloatTimeDomainData(self._analyzerData);

        // Calculate RMS level
        var sumSquares = 0;
        for (var i = 0; i < self._analyzerData.length; i++) {
          sumSquares += self._analyzerData[i] * self._analyzerData[i];
        }
        var rms = Math.sqrt(sumSquares / self._analyzerData.length);
        var levelDb = self._linearToDb(rms);

        var currentTime = self.ctx.currentTime;
        var releaseTime = self.params.release / 1000; // Convert ms to seconds

        // Gate logic
        if (levelDb > self.params.threshold) {
          // Input above threshold - open gate
          if (!self._gateOpen) {
            // Gate opening - fast attack
            self.gateGain.gain.cancelScheduledValues(currentTime);
            self.gateGain.gain.setTargetAtTime(1, currentTime, 0.005);
            self._gateOpen = true;
          }
          self._lastGateTime = currentTime;
        } else {
          // Input below threshold
          if (self._gateOpen && ((currentTime - self._lastGateTime) > 0.01)) {
            // Gate closing - use release time
            self.gateGain.gain.cancelScheduledValues(currentTime);
            self.gateGain.gain.setTargetAtTime(0, currentTime, releaseTime / 5);
            self._gateOpen = false;
          }
        }
      };

      this._animationFrameId = requestAnimationFrame(processGate);
    }

    /**
     * Stop the gate processing loop
     */
    _stopGateProcessing() {
      if (this._animationFrameId) {
        cancelAnimationFrame(this._animationFrameId);
        this._animationFrameId = null;
      }
    }

    /**
     * Handle parameter updates
     */
    updateParam(name, value) {
      switch (name) {
        case 'size':
          this.params.size = Math.max(0, Math.min(100, value));
          this._generateAndSetIR();
          break;

        case 'decay':
          this.params.decay = Math.max(0, Math.min(100, value));
          this._generateAndSetIR();
          break;

        case 'threshold':
          // Clamp threshold to -60 to 0 dB
          this.params.threshold = Math.max(-60, Math.min(0, value));
          break;

        case 'release':
          // Clamp release to 10-500ms
          this.params.release = Math.max(10, Math.min(500, value));
          break;
      }
    }

    /**
     * Clean up resources
     */
    dispose() {
      // Stop gate processing
      this._stopGateProcessing();

      // Clear debounce timer
      if (this._irDebounceTimer) {
        clearTimeout(this._irDebounceTimer);
        this._irDebounceTimer = null;
      }

      // Disconnect effect-specific nodes
      this.convolver.disconnect();
      this.analyzer.disconnect();
      this.gateGain.disconnect();
      this.outputGain.disconnect();

      // Call parent dispose
      super.dispose();
    }
  }

  // Export to SynthLab effects namespace
  SL.effects.GatedReverbEffect = GatedReverbEffect;

})();
