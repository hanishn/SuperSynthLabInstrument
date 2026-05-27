// Synth Lab - Noise Gate Effect
// Cleans up signals by attenuating audio below a threshold
//
// -----------------------------------------------------------------------
// EDUCATIONAL OVERVIEW: Noise Gate
// -----------------------------------------------------------------------
// A noise gate is the inverse of a compressor: instead of reducing loud
// signals, it attenuates signals that fall BELOW a threshold. This is
// useful for removing background noise, hum, or bleed during silent
// passages without affecting the wanted signal when it is playing.
//
// Gate states and transitions:
//   CLOSED --[signal >= threshold]--> OPENING (attack phase)
//   OPEN   --[signal < threshold] --> HOLD (wait holdTime)
//   HOLD   --[hold elapsed]--------> CLOSING (release phase)
//   CLOSING --------------------------> CLOSED (gain = range)
//
// Key parameters:
//   Threshold: level below which the gate closes.
//   Attack:    how fast the gate opens (short = snappy, long = fade-in).
//   Hold:      minimum time the gate stays open after signal drops.
//              Prevents chattering on signals with brief pauses.
//   Release:   how fast the gate closes (fade-out speed).
//   Range:     attenuation depth when closed. -80 dB = near-silence.
//              -20 dB = partial attenuation (lets some bleed through).
//
// This implementation uses an AnalyserNode for RMS level detection and
// a GainNode for the actual attenuation, driven by a requestAnimationFrame
// loop. A safety timeout prevents the gate from locking closed permanently
// (important in browser contexts where timing can be unreliable).
//
// The gate starts in the OPEN state so initial audio is never blocked
// before the first detection cycle has a chance to measure input level.
//
// References:
//   Zolzer, U. (2011) DAFX: Digital Audio Effects, Wiley, Ch. 7
//
// Feature spec: [FX-061] Gate
// -----------------------------------------------------------------------

(function() {
  var SL = window.SynthLab = window.SynthLab || {};
  SL.effects = SL.effects || {};
  var BaseEffect = SL.effects.BaseEffect;

  // Surfaces where the gate effect MUST be forcibly bypassed.
  // The gate's hold/release cycle chops legato pitch transitions on ribbon surfaces.
  var GATE_BLACKLISTED_SURFACES = { mpe: true, ribbon: true };

  /**
   * GateEffect - Noise Gate for cleaning up signals
   *
   * Signal flow:
   * input ---> AnalyserNode (for level detection)
   *    |
   *    +---> GainNode (gate control) ---> wetGain
   *
   * Parameters:
   * - threshold: -60 to 0 dB (level below which gate closes)
   * - attack: 0.1-50 ms (how fast gate opens)
   * - hold: 0-500 ms (how long gate stays open after signal drops)
   * - release: 10-1000 ms (how fast gate closes)
   * - range: -80 to 0 dB (how much to attenuate when closed)
   * - mix: 0-100% (wet/dry mix, inherited from BaseEffect)
   */
  class GateEffect extends BaseEffect {
    constructor(ctx) {
      super(ctx, 'gate');

      // Create AnalyserNode for level detection
      // fftSize 256 gives us 256 time-domain samples per measurement.
      // RMS of these samples approximates perceived loudness for gating.
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyserBuffer = new Float32Array(this.analyser.fftSize);

      // Create GainNode for gate control
      this.gateGain = ctx.createGain();
      this.gateGain.gain.value = 1.0;

      // Connect signal flow: input -> analyser -> gateGain -> wetGain
      this.input.connect(this.analyser);
      this.analyser.connect(this.gateGain);
      this.gateGain.connect(this.wetGain);

      // Initialize parameters
      this.params = {
        threshold: -50,   // dB — permissive default to allow quieter signals
        attack: 1,        // ms
        hold: 100,        // ms — generous hold to avoid premature close on transients
        release: 100,     // ms
        range: -80,       // dB (full attenuation by default)
        mix: 100          // 100% wet (fully gated signal)
      };

      // Gate state tracking — start open so audio passes until first detection proves otherwise
      this.isOpen = true;
      this.holdStartTime = 0;  // AudioContext.currentTime when hold period began
      this.holdActive = false; // Whether hold period is in progress
      this.lastUpdateTime = 0;
      this.currentGain = 1.0;
      this.targetGain = 1.0;
      this.enabledAtTime = 0;

      // rAF loop only runs when enabled — started in setEnabled(true)
      this.isRunning = false;

      // Start in bypass mode
      this.enabled = false;
      this.dryGain.gain.value = 1;
      this.wetGain.gain.value = 0;
    }

    /**
     * Override setEnabled to start/stop level detection loop.
     * On blacklisted surfaces (ribbon/mpe) the detection loop still runs
     * but processGate() forces the gate open, so audio is never chopped.
     */
    setEnabled(on) {
      super.setEnabled(on);
      if (on) {
        this.isRunning = true;
        this.isOpen = true;
        this.gateGain.gain.value = 1.0;
        this.enabledAtTime = this.ctx.currentTime;
        this.startLevelDetection();
      } else {
        this.stopLevelDetection();
        // Ensure gate is fully open when disabled so no audio is blocked
        this.isOpen = true;
        this.gateGain.gain.cancelScheduledValues(this.ctx.currentTime);
        this.gateGain.gain.value = 1.0;
      }
    }

    /**
     * Stop the level detection loop
     */
    stopLevelDetection() {
      this.isRunning = false;
      if (this.animationFrame) {
        cancelAnimationFrame(this.animationFrame);
        this.animationFrame = null;
      }
    }

    /**
     * Start the level detection loop using requestAnimationFrame.
     *
     * The loop measures RMS level, converts to dB, and calls processGate()
     * to decide whether the gate should open or close. A safety timeout
     * forces the gate open if it has been closed too long after enable,
     * preventing permanent audio blockage from startup race conditions.
     */
    startLevelDetection() {
      var SAFETY_TIMEOUT_SEC = 0.5; // Force gate open if stuck closed this long after enable

      var self = this;
      var detect = function() {
        if (!self.isRunning) return;

        self.animationFrame = requestAnimationFrame(detect);

        // NOTE: tab visibility check intentionally removed — gate must function
        // regardless of tab visibility to prevent permanent audio blockage.

        // Get current audio level
        self.analyser.getFloatTimeDomainData(self.analyserBuffer);

        // Calculate RMS level
        // RMS (root mean square) gives a better approximation of perceived
        // loudness than peak detection, because it averages over the buffer.
        var sum = 0;
        for (var i = 0; i < self.analyserBuffer.length; i++) {
          sum += self.analyserBuffer[i] * self.analyserBuffer[i];
        }
        var rms = Math.sqrt(sum / self.analyserBuffer.length);

        // Convert to dB using the standard formula: dB = 20 * log10(amplitude)
        var hasSignal = (rms > 0);
        var levelDb = hasSignal ? (20 * Math.log10(rms)) : -Infinity;

        // Safety mechanism: if gate has been enabled for longer than SAFETY_TIMEOUT_SEC
        // and gain is still at minimum, force it open to prevent permanent lock.
        var rangeDb = self.params.range;
        var minGain = Math.pow(10, rangeDb / 20);
        var timeSinceEnable = self.ctx.currentTime - self.enabledAtTime;
        var gainIsAtMin = (self.gateGain.gain.value <= (minGain + 0.001));
        var pastSafetyTimeout = (timeSinceEnable > SAFETY_TIMEOUT_SEC);

        var shouldForceOpen = (pastSafetyTimeout && gainIsAtMin) && (!self.isOpen);
        if (shouldForceOpen) {
          self.isOpen = true;
          self.targetGain = 1.0;
          self.gateGain.gain.cancelScheduledValues(self.ctx.currentTime);
          self.gateGain.gain.setTargetAtTime(1.0, self.ctx.currentTime, 0.005);
        } else {
          // Normal gate logic
          self.processGate(levelDb);
        }
      };

      detect();
    }

    /**
     * Check if the current surface is blacklisted for gate processing.
     * Ribbon/MPE surfaces produce brief silence during pitch transitions
     * that the gate misinterprets as signal dropout.
     */
    _isSurfaceBlacklisted() {
      var surface = (SL.screenPlay && SL.screenPlay.getSurface) ? SL.screenPlay.getSurface() : '';
      return Boolean(GATE_BLACKLISTED_SURFACES[surface]);
    }

    /**
     * Process gate logic based on input level.
     * Uses AudioContext.currentTime for hold timing instead of setTimeout,
     * which does not fire reliably when the tab is backgrounded.
     */
    processGate(levelDb) {
      // PERMANENT FIX: On ribbon/mpe surfaces, force gate open unconditionally.
      // The gate's hold/release cycle chops audio during legato pitch slides.
      if (this._isSurfaceBlacklisted()) {
        if (!this.isOpen) {
          this.isOpen = true;
          this.targetGain = 1.0;
          this.gateGain.gain.cancelScheduledValues(this.ctx.currentTime);
          this.gateGain.gain.setTargetAtTime(1.0, this.ctx.currentTime, 0.005);
        }
        this.holdActive = false;
      } else {
        var now = this.ctx.currentTime;
        var threshold = this.params.threshold;
        var attackTime = this.params.attack / 1000;  // Convert ms to seconds
        var HOLD_TIME_SEC = this.params.hold / 1000; // Convert ms to seconds
        var releaseTime = this.params.release / 1000; // Convert ms to seconds
        var rangeDb = this.params.range;

        // Calculate the minimum gain from range (in linear scale)
        // Converts dB to linear: gain = 10^(dB/20)
        // e.g. -80 dB -> 0.0001 (near silence), -20 dB -> 0.1 (partial)
        var minGain = Math.pow(10, rangeDb / 20);

        if (levelDb >= threshold) {
          // Signal above threshold - open the gate
          this.holdActive = false;

          if (!this.isOpen) {
            // Gate is opening
            this.isOpen = true;
            this.targetGain = 1.0;
            this.gateGain.gain.cancelScheduledValues(now);
            this.gateGain.gain.setTargetAtTime(1.0, now, attackTime / 3);
          }
        } else {
          // Signal below threshold
          if (this.isOpen && !this.holdActive) {
            // Begin hold period using AudioContext.currentTime
            this.holdActive = true;
            this.holdStartTime = now;
          }

          // Check if hold period has elapsed
          if (this.holdActive) {
            var holdElapsed = now - this.holdStartTime;
            if (holdElapsed >= HOLD_TIME_SEC) {
              // Hold period complete — close the gate
              this.holdActive = false;
              this.isOpen = false;
              this.targetGain = minGain;
              this.gateGain.gain.cancelScheduledValues(now);
              this.gateGain.gain.setTargetAtTime(minGain, now, releaseTime / 3);
            }
          }
        }
      }
    }

    /**
     * Handle parameter updates.
     * Gate parameters are stored as instance state (not AudioParam) because
     * the gate logic runs in JS (processGate), not in the audio thread.
     * Only the gateGain node uses AudioParam scheduling for smooth transitions.
     */
    updateParam(name, value) {
      switch (name) {
        case 'threshold':
          // Clamp to -60 to 0 dB
          this.params.threshold = Math.max(-60, Math.min(0, value));
          break;

        case 'attack':
          // Clamp to 0.1-50 ms
          this.params.attack = Math.max(0.1, Math.min(50, value));
          break;

        case 'hold':
          // Clamp to 0-500 ms
          this.params.hold = Math.max(0, Math.min(500, value));
          break;

        case 'release':
          // Clamp to 10-1000 ms
          this.params.release = Math.max(10, Math.min(1000, value));
          break;

        case 'range':
          // Clamp to -80 to 0 dB
          this.params.range = Math.max(-80, Math.min(0, value));
          // Update current gate position if closed
          if (!this.isOpen) {
            var minGain = Math.pow(10, this.params.range / 20);
            this.gateGain.gain.setTargetAtTime(minGain, this.ctx.currentTime, 0.01);
          }
          break;
      }
    }

    /**
     * Get current gate state (useful for metering)
     */
    getGateState() {
      return {
        isOpen: this.isOpen,
        currentGain: this.gateGain.gain.value
      };
    }

    /**
     * Clean up audio nodes and stop detection loop
     */
    dispose() {
      this.isRunning = false;
      if (this.animationFrame) {
        cancelAnimationFrame(this.animationFrame);
      }
      this.holdActive = false;
      this.analyser.disconnect();
      this.gateGain.disconnect();
      super.dispose();
    }
  }

  // Export to SynthLab namespace
  SL.effects.GateEffect = GateEffect;

})();
