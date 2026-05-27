// Synth Lab - Pump/Sidechain Effect
// Creates rhythmic ducking effect simulating sidechain compression
// Classic EDM/synthwave pumping effect using tempo-synced LFO
//
// -----------------------------------------------------------------------
// SIDECHAIN COMPRESSION SIMULATION - Background
//
// In a real sidechain compressor, one signal (the "sidechain," typically
// a kick drum) triggers gain reduction on another signal (pads, bass).
// Each kick hit ducks the pad, creating the rhythmic "breathing" or
// "pumping" effect ubiquitous in EDM, French house (Daft Punk), and
// modern pop production.
//
// Pump simulates this WITHOUT a real sidechain signal. Instead, it
// generates an internal envelope on a tempo-synced schedule: at each
// beat division, the gain ducks down (release phase) then recovers
// (attack phase). The musical result is identical to sidechain
// compression but requires no external trigger.
//
// Envelope shapes affect the character:
//   - Linear:      mechanical, even ducking -- good for trance gates
//   - Exponential: classic sidechain feel -- fast duck, smooth recovery
//   - Logarithmic: aggressive initial duck with long, slow tail
//
// The lookahead scheduler (25ms polling, 100ms lookahead) pre-schedules
// gain automation events on the Web Audio timeline for sample-accurate
// timing, avoiding the jitter of setTimeout-only approaches.
// -----------------------------------------------------------------------

(function() {
  var SL = window.SynthLab = window.SynthLab || {};
  SL.effects = SL.effects || {};
  var BaseEffect = SL.effects.BaseEffect;

  /**
   * PumpEffect - Simulated sidechain compression via LFO-controlled gain
   *
   * Parameters:
   * - rate: 1-8 (musical division: 1=1/1, 2=1/2, 4=1/4, 8=1/8 notes at current tempo)
   * - depth: 0-100 (how much the signal ducks, percentage)
   * - attack: 1-100 (attack time in ms, how fast the signal recovers)
   * - release: 50-500 (release time in ms, how fast the signal ducks down)
   * - shape: 'linear', 'exponential', 'logarithmic' (envelope curve shape)
   * - mix: 0-100 (inherited wet/dry mix)
   */
  class PumpEffect extends BaseEffect {
    constructor(ctx) {
      super(ctx, 'pump');

      // Default parameters
      this.params.rate = 4;              // 1/4 notes (typical EDM pump)
      this.params.depth = 80;            // 80% ducking
      this.params.attack = 20;           // 20ms attack (recovery)
      this.params.release = 150;         // 150ms release (duck down)
      this.params.shape = 'exponential'; // Curve shape
      this.params.mix = 100;             // Full wet by default

      // Tempo in BPM (can be synced externally)
      this.tempo = 120;

      // Create the pump gain node
      this.pumpGain = ctx.createGain();
      this.pumpGain.gain.value = 1;

      // Connect wet path: input -> pumpGain -> wetGain
      this.input.connect(this.pumpGain);
      this.pumpGain.connect(this.wetGain);

      // LFO-based pumping
      this.isRunning = false;
      this.schedulerInterval = null;
      this.nextPumpTime = 0;

      // Scheduler starts when enabled via setEnabled(true)
    }

    // ---- Tempo-Sync Timing ----
    // Converts musical rate divisions to real-time intervals.
    // Rate 4 at 120 BPM = quarter note = 0.5s per pump cycle.

    /**
     * Calculate pump interval based on tempo and rate
     * Rate 1 = whole note, 2 = half note, 4 = quarter note, 8 = eighth note
     */
    getPumpInterval() {
      // Beats per second
      var bps = this.tempo / 60;
      var safeBps = bps || 1;
      // Seconds per beat (quarter note)
      var spb = 1 / safeBps;
      // Interval based on rate division
      // rate=1 -> 4 beats, rate=2 -> 2 beats, rate=4 -> 1 beat, rate=8 -> 0.5 beats
      return (4 / this.params.rate) * spb;
    }

    // ---- Envelope Generation ----
    // Each pump cycle: duck down (release) then recover (attack).
    // setTargetAtTime with time constant = duration/3 gives ~95% of target
    // in the specified time (exponential asymptotic approach). Smaller
    // divisors (e.g. /6 for logarithmic) give faster initial movement.

    /**
     * Apply the pump envelope based on shape
     */
    applyPumpEnvelope(startTime) {
      var gain = this.pumpGain.gain;
      var depth = this.params.depth / 100;
      var minGain = 1 - depth;
      var attackTime = this.params.attack / 1000; // Convert to seconds
      var releaseTime = this.params.release / 1000;

      // Cancel any scheduled changes
      gain.cancelScheduledValues(startTime);

      // Set current value
      gain.setValueAtTime(gain.value, startTime);

      // Apply envelope based on shape
      switch (this.params.shape) {
        case 'linear':
          // Linear duck down
          gain.linearRampToValueAtTime(minGain, startTime + releaseTime);
          // Linear recovery
          gain.linearRampToValueAtTime(1, startTime + releaseTime + attackTime);
          break;

        case 'exponential':
          // Exponential duck (classic sidechain feel)
          // Use setTargetAtTime for smooth exponential curve
          // Time constant is roughly 1/3 of the desired time for ~95% completion
          gain.setTargetAtTime(minGain, startTime, releaseTime / 3);
          // Recovery starts after release
          gain.setTargetAtTime(1, startTime + releaseTime, attackTime / 3);
          break;

        case 'logarithmic':
          // Logarithmic - fast initial duck, slow tail
          // Achieved with very short time constant for duck, longer for recovery
          gain.setTargetAtTime(minGain, startTime, releaseTime / 6);
          gain.setTargetAtTime(1, startTime + releaseTime, attackTime / 2);
          break;

        default:
          // Default to exponential
          gain.setTargetAtTime(minGain, startTime, releaseTime / 3);
          gain.setTargetAtTime(1, startTime + releaseTime, attackTime / 3);
      }
    }

    /**
     * Start the pump scheduler
     */
    startScheduler() {
      if (this.isRunning) return;
      this.isRunning = true;

      // Initialize next pump time
      this.nextPumpTime = this.ctx.currentTime;

      // Schedule pumps ahead of time using a lookahead scheduler
      var lookahead = 0.1; // 100ms lookahead
      var scheduleInterval = 25; // Check every 25ms

      var self = this;
      this.schedulerInterval = setInterval(function() {
        var currentTime = self.ctx.currentTime;
        var pumpInterval = self.getPumpInterval();

        // Schedule all pumps that fall within the lookahead window
        while (self.nextPumpTime < currentTime + lookahead) {
          // Only apply pump if effect is enabled
          if (self.enabled) {
            self.applyPumpEnvelope(self.nextPumpTime);
          }
          self.nextPumpTime += pumpInterval;
        }
      }, scheduleInterval);
    }

    /**
     * Stop the pump scheduler
     */
    stopScheduler() {
      if (!this.isRunning) return;
      this.isRunning = false;

      if (this.schedulerInterval) {
        clearInterval(this.schedulerInterval);
        this.schedulerInterval = null;
      }

      // Reset gain to 1
      this.pumpGain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.pumpGain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.01);
    }

    /**
     * Sync to external tempo
     */
    setTempo(bpm) {
      this.tempo = Math.max(20, Math.min(300, bpm));
    }

    /**
     * Reset pump phase (for syncing to playback)
     */
    resetPhase() {
      this.nextPumpTime = this.ctx.currentTime;
    }

    /**
     * Override setEnabled to control scheduler
     */
    setEnabled(enabled) {
      super.setEnabled(enabled);

      if (enabled) {
        this.startScheduler();
      } else {
        this.stopScheduler();
      }
    }

    /**
     * Handle parameter updates
     */
    updateParam(name, value) {
      switch (name) {
        case 'rate':
          // Clamp rate to valid range (1-8)
          this.params.rate = Math.max(1, Math.min(8, Math.round(value)));
          // Reset phase to resync
          this.resetPhase();
          break;

        case 'depth':
          // Clamp depth to valid range (0-100)
          this.params.depth = Math.max(0, Math.min(100, value));
          break;

        case 'attack':
          // Clamp attack to valid range (1-100ms)
          this.params.attack = Math.max(1, Math.min(100, value));
          break;

        case 'release':
          // Clamp release to valid range (50-500ms)
          this.params.release = Math.max(50, Math.min(500, value));
          break;

        case 'shape':
          // Validate shape
          var validShapes = ['linear', 'exponential', 'logarithmic'];
          if (validShapes.includes(value)) {
            this.params.shape = value;
          }
          break;

        case 'tempo':
          // Allow tempo to be set via params
          this.setTempo(value);
          break;
      }
    }

    /**
     * Get params including tempo
     */
    getParams() {
      return Object.assign({}, this.params, {
        tempo: this.tempo,
        enabled: this.enabled
      });
    }

    /**
     * Clean up all audio nodes and scheduler
     */
    dispose() {
      this.stopScheduler();
      this.pumpGain.disconnect();
      super.dispose();
    }
  }

  // Export to SynthLab namespace
  SL.effects.PumpEffect = PumpEffect;

})();
