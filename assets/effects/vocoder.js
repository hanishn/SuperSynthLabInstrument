// Synth Lab - Vocoder Effect
// Classic synthwave vocal processing using analysis/synthesis filter banks

(function() {
  var SL = window.SynthLab;
  var BaseEffect = SL.effects.BaseEffect;

  /**
   * VocoderEffect - Classic vocoder with configurable filter banks
   *
   * Uses a bank of bandpass filters to analyze the input (modulator),
   * then applies the envelope of each band to shape an internal carrier
   * (sawtooth or noise oscillator).
   *
   * Parameters:
   * - bands: 8-32 (number of frequency bands)
   * - carrierFreq: 50-500 Hz (base frequency for carrier oscillator)
   * - resonance: 0-100 (filter Q/resonance amount)
   * - shift: -12 to +12 (transpose analysis bands in semitones)
   * - attack: 1-100 ms (envelope follower attack time)
   * - release: 10-500 ms (envelope follower release time)
   * - mix: 0-100 (wet/dry mix, inherited)
   */
  class VocoderEffect extends BaseEffect {
    constructor(ctx) {
      super(ctx, 'vocoder');

      // Default parameter values
      this.params = {
        bands: 16,
        carrierFreq: 100,
        resonance: 50,
        shift: 0,
        attack: 10,
        release: 50,
        mix: 50
      };

      // Frequency range for vocoder bands (covering vocal range)
      this.minFreq = 80;    // Hz - low end
      this.maxFreq = 8000;  // Hz - high end

      // Analysis filter bank (bandpass filters for input/modulator)
      this.analysisFilters = [];

      // Synthesis filter bank (bandpass filters for carrier)
      this.synthesisFilters = [];

      // Envelope followers (gain nodes driven by rectified analysis signal)
      this.envelopeFollowers = [];

      // Carrier signal sources
      this.carrierOscillator = null;
      this.noiseSource = null;
      this.carrierGain = null;

      // Mixer for combining all synthesis bands
      this.bandMixer = ctx.createGain();
      this.bandMixer.gain.value = 1.0;
      this.bandMixer.connect(this.wetGain);

      // Build the vocoder filter banks
      this._buildCarrier();
      this._buildFilterBanks(this.params.bands);
    }

    /**
     * Build the carrier signal (sawtooth oscillator + noise)
     */
    _buildCarrier() {
      var ctx = this.ctx;

      // Create sawtooth oscillator as primary carrier
      this.carrierOscillator = ctx.createOscillator();
      this.carrierOscillator.type = 'sawtooth';
      this.carrierOscillator.frequency.value = this.params.carrierFreq;

      // Create noise source for unvoiced sounds (sibilants)
      // Using a script processor to generate white noise
      this.noiseBuffer = this._createNoiseBuffer();
      this.noiseSource = ctx.createBufferSource();
      this.noiseSource.buffer = this.noiseBuffer;
      this.noiseSource.loop = true;

      // Carrier mixer - blend oscillator and noise
      this.carrierGain = ctx.createGain();
      this.carrierGain.gain.value = 1.0;

      // Mix carriers: 70% sawtooth, 30% noise for natural vocal sound
      this.oscGain = ctx.createGain();
      this.oscGain.gain.value = 0.7;

      this.noiseGain = ctx.createGain();
      this.noiseGain.gain.value = 0.3;

      // Connect carrier signal chain
      this.carrierOscillator.connect(this.oscGain);
      this.noiseSource.connect(this.noiseGain);
      this.oscGain.connect(this.carrierGain);
      this.noiseGain.connect(this.carrierGain);

      // Start the carriers
      this.carrierOscillator.start();
      this.noiseSource.start();
    }

    /**
     * Create a buffer of white noise
     */
    _createNoiseBuffer() {
      var ctx = this.ctx;
      var bufferSize = ctx.sampleRate * 2; // 2 seconds of noise
      var buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      var data = buffer.getChannelData(0);

      for (var i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      return buffer;
    }

    /**
     * Calculate center frequencies for filter bands using logarithmic spacing
     */
    _calculateBandFrequencies(numBands) {
      var frequencies = [];
      var logMin = Math.log(this.minFreq);
      var logMax = Math.log(this.maxFreq);
      var logStep = (logMax - logMin) / numBands;

      for (var i = 0; i < numBands; i++) {
        // Center frequency for each band
        var logFreq = logMin + (i + 0.5) * logStep;
        frequencies.push(Math.exp(logFreq));
      }

      return frequencies;
    }

    /**
     * Apply shift (transposition) to a frequency
     */
    _shiftFrequency(freq, semitones) {
      return freq * Math.pow(2, semitones / 12);
    }

    /**
     * Build the analysis and synthesis filter banks
     */
    _buildFilterBanks(numBands) {
      // Clean up existing filters
      this._disposeFilterBanks();

      var ctx = this.ctx;
      var frequencies = this._calculateBandFrequencies(numBands);

      // Calculate Q based on band spacing for proper overlap
      // Q = centerFreq / bandwidth, we want slight overlap
      var logMin = Math.log(this.minFreq);
      var logMax = Math.log(this.maxFreq);
      var bandwidth = (logMax - logMin) / numBands;
      var baseQ = 1 / (Math.exp(bandwidth) - Math.exp(-bandwidth)) * 2;

      // Apply resonance parameter to Q
      var resonanceMultiplier = 1 + (this.params.resonance / 100) * 4;
      var filterQ = baseQ * resonanceMultiplier;

      // Attack and release time constants for envelope follower
      var attackTime = this.params.attack / 1000;
      var releaseTime = this.params.release / 1000;

      for (var i = 0; i < numBands; i++) {
        var centerFreq = frequencies[i];
        var shiftedFreq = this._shiftFrequency(centerFreq, this.params.shift);

        // === Analysis path (modulator/input signal) ===
        // Bandpass filter for analysis
        var analysisFilter = ctx.createBiquadFilter();
        analysisFilter.type = 'bandpass';
        analysisFilter.frequency.value = centerFreq;
        analysisFilter.Q.value = filterQ;
        this.analysisFilters.push(analysisFilter);

        // Connect input to analysis filter
        this.input.connect(analysisFilter);

        // === Envelope follower ===
        // Rectifier (using waveshaper for full-wave rectification)
        var rectifier = ctx.createWaveShaper();
        rectifier.curve = this._createRectifierCurve();

        // Lowpass filter to smooth the rectified signal (envelope extraction)
        var envelopeLowpass = ctx.createBiquadFilter();
        envelopeLowpass.type = 'lowpass';
        envelopeLowpass.frequency.value = 1 / (2 * Math.PI * Math.max(attackTime, releaseTime));
        envelopeLowpass.Q.value = 0.5;

        // Envelope gain (will modulate the synthesis band)
        var envelopeGain = ctx.createGain();
        envelopeGain.gain.value = 0;

        // Connect envelope follower chain
        analysisFilter.connect(rectifier);
        rectifier.connect(envelopeLowpass);

        // Store envelope follower components
        this.envelopeFollowers.push({
          rectifier,
          lowpass: envelopeLowpass,
          gain: envelopeGain,
          centerFreq,
          shiftedFreq
        });

        // === Synthesis path (carrier signal) ===
        // Bandpass filter for synthesis (at shifted frequency)
        var synthesisFilter = ctx.createBiquadFilter();
        synthesisFilter.type = 'bandpass';
        synthesisFilter.frequency.value = shiftedFreq;
        synthesisFilter.Q.value = filterQ;
        this.synthesisFilters.push(synthesisFilter);

        // Connect carrier to synthesis filter, then through envelope gain to output
        this.carrierGain.connect(synthesisFilter);
        synthesisFilter.connect(envelopeGain);
        envelopeGain.connect(this.bandMixer);

        // === Connect envelope follower to modulate synthesis ===
        // We use an AnalyserNode to read the envelope and apply it via script
        // For Web Audio, we'll use a gain node modulated by the envelope signal
        // The envelope lowpass output connects to a gain that controls the synthesis
        this._connectEnvelopeModulation(envelopeLowpass, envelopeGain, i);
      }
    }

    /**
     * Create a full-wave rectifier curve for envelope detection
     */
    _createRectifierCurve() {
      var samples = 256;
      var curve = new Float32Array(samples);
      for (var i = 0; i < samples; i++) {
        var x = (i / samples) * 2 - 1;
        curve[i] = Math.abs(x);
      }
      return curve;
    }

    /**
     * Connect envelope follower to modulate synthesis band gain
     * Uses AudioWorklet-free approach with gain node modulation
     */
    _connectEnvelopeModulation(envelopeLowpass, envelopeGain, bandIndex) {
      var ctx = this.ctx;

      // Create a gain node that will scale the envelope signal
      var envelopeScaler = ctx.createGain();
      envelopeScaler.gain.value = 4.0; // Amplify envelope signal

      // Connect envelope to the gain parameter of the synthesis output
      envelopeLowpass.connect(envelopeScaler);
      envelopeScaler.connect(envelopeGain.gain);

      // Store reference for cleanup
      this.envelopeFollowers[bandIndex].scaler = envelopeScaler;
    }

    /**
     * Clean up filter banks
     */
    _disposeFilterBanks() {
      // Disconnect analysis filters
      this.analysisFilters.forEach(function(filter) {
        filter.disconnect();
      });
      this.analysisFilters = [];

      // Disconnect synthesis filters
      this.synthesisFilters.forEach(function(filter) {
        filter.disconnect();
      });
      this.synthesisFilters = [];

      // Disconnect envelope followers
      this.envelopeFollowers.forEach(function(env) {
        env.rectifier.disconnect();
        env.lowpass.disconnect();
        env.gain.disconnect();
        if (env.scaler) {
          env.scaler.disconnect();
        }
      });
      this.envelopeFollowers = [];
    }

    /**
     * Update all filter Q values based on resonance
     */
    _updateResonance() {
      var numBands = this.analysisFilters.length;
      if (numBands === 0) return;

      var logMin = Math.log(this.minFreq);
      var logMax = Math.log(this.maxFreq);
      var bandwidth = (logMax - logMin) / numBands;
      var baseQ = 1 / (Math.exp(bandwidth) - Math.exp(-bandwidth)) * 2;
      var resonanceMultiplier = 1 + (this.params.resonance / 100) * 4;
      var filterQ = baseQ * resonanceMultiplier;

      var currentTime = this.ctx.currentTime;

      this.analysisFilters.forEach(function(filter) {
        filter.Q.setTargetAtTime(filterQ, currentTime, 0.01);
      });

      this.synthesisFilters.forEach(function(filter) {
        filter.Q.setTargetAtTime(filterQ, currentTime, 0.01);
      });
    }

    /**
     * Update synthesis filter frequencies based on shift parameter
     */
    _updateShift() {
      var currentTime = this.ctx.currentTime;
      var self = this;

      this.envelopeFollowers.forEach(function(env, i) {
        var shiftedFreq = self._shiftFrequency(env.centerFreq, self.params.shift);
        env.shiftedFreq = shiftedFreq;
        self.synthesisFilters[i].frequency.setTargetAtTime(shiftedFreq, currentTime, 0.01);
      });
    }

    /**
     * Update envelope follower timing
     */
    _updateEnvelopeTiming() {
      var attackTime = this.params.attack / 1000;
      var releaseTime = this.params.release / 1000;
      var cutoff = 1 / (2 * Math.PI * Math.max(attackTime, releaseTime));
      var currentTime = this.ctx.currentTime;

      this.envelopeFollowers.forEach(function(env) {
        env.lowpass.frequency.setTargetAtTime(cutoff, currentTime, 0.01);
      });
    }

    /**
     * Handle parameter updates
     */
    updateParam(name, value) {
      var currentTime = this.ctx.currentTime;

      switch (name) {
        case 'bands':
          // Number of frequency bands (8-32)
          var newBands = Math.max(8, Math.min(32, Math.round(value)));
          if (newBands !== this.params.bands) {
            this.params.bands = newBands;
            this._buildFilterBanks(newBands);
          }
          break;

        case 'carrierFreq':
          // Carrier oscillator base frequency (50-500 Hz)
          this.params.carrierFreq = Math.max(50, Math.min(500, value));
          this.carrierOscillator.frequency.setTargetAtTime(
            this.params.carrierFreq,
            currentTime,
            0.01
          );
          break;

        case 'resonance':
          // Filter resonance/Q (0-100%)
          this.params.resonance = Math.max(0, Math.min(100, value));
          this._updateResonance();
          break;

        case 'shift':
          // Band transposition (-12 to +12 semitones)
          this.params.shift = Math.max(-12, Math.min(12, value));
          this._updateShift();
          break;

        case 'attack':
          // Envelope attack time (1-100 ms)
          this.params.attack = Math.max(1, Math.min(100, value));
          this._updateEnvelopeTiming();
          break;

        case 'release':
          // Envelope release time (10-500 ms)
          this.params.release = Math.max(10, Math.min(500, value));
          this._updateEnvelopeTiming();
          break;
      }
    }

    /**
     * Clean up all audio nodes
     */
    dispose() {
      // Stop and disconnect carrier sources
      try {
        this.carrierOscillator.stop();
      } catch (e) { /* oscillator may not have started yet */ }
      this.carrierOscillator.disconnect();

      try {
        this.noiseSource.stop();
      } catch (e) { /* noise source may not have started yet */ }
      this.noiseSource.disconnect();

      this.oscGain.disconnect();
      this.noiseGain.disconnect();
      this.carrierGain.disconnect();
      this.bandMixer.disconnect();

      // Dispose filter banks
      this._disposeFilterBanks();

      // Call parent dispose
      super.dispose();
    }
  }

  // Export to SynthLab namespace as VocoderEffect (as requested)
  SL.effects.VocoderEffect = VocoderEffect;

})();
