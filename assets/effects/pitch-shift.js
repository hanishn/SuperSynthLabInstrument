// Synth Lab - Pitch Shift Effect
// Creates octave effects and detuning using granular pitch shifting

(function() {
  const SL = window.SynthLab;
  const BaseEffect = SL.effects.BaseEffect;

  // AudioWorklet processor code for granular pitch shifting
  const workletCode = `
class PitchShiftProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'pitchRatio', defaultValue: 1.0, minValue: 0.5, maxValue: 2.0 },
      { name: 'windowSize', defaultValue: 0.1, minValue: 0.05, maxValue: 0.2 }
    ];
  }

  constructor() {
    super();
    // Maximum buffer size for 200ms at up to 192kHz
    this.maxBufferSize = 192000 * 0.2;
    this.bufferL = new Float32Array(this.maxBufferSize);
    this.bufferR = new Float32Array(this.maxBufferSize);
    this.writePos = 0;

    // Two read heads for crossfading
    this.readPos1 = 0;
    this.readPos2 = 0;
    this.crossfadePos = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !input.length) {
      return true;
    }

    const pitchRatio = parameters.pitchRatio[0];
    const windowSize = parameters.windowSize[0];
    const windowSamples = Math.floor(sampleRate * windowSize);

    // Read speed relative to write speed determines pitch
    // pitchRatio > 1 = higher pitch (read faster)
    // pitchRatio < 1 = lower pitch (read slower)
    const readSpeed = pitchRatio;

    for (let channel = 0; channel < output.length; channel++) {
      const inputChannel = input[channel] || input[0];
      const outputChannel = output[channel];
      const buffer = channel === 0 ? this.bufferL : this.bufferR;

      if (!inputChannel || !outputChannel) continue;

      for (let i = 0; i < outputChannel.length; i++) {
        // Write input to circular buffer
        buffer[this.writePos] = inputChannel[i];

        // Calculate read positions with wrapping
        const pos1 = this.readPos1 % this.maxBufferSize;
        const pos2 = this.readPos2 % this.maxBufferSize;

        // Linear interpolation for fractional positions
        const pos1Floor = Math.floor(pos1);
        const pos1Frac = pos1 - pos1Floor;
        const pos1Next = (pos1Floor + 1) % this.maxBufferSize;

        const pos2Floor = Math.floor(pos2);
        const pos2Frac = pos2 - pos2Floor;
        const pos2Next = (pos2Floor + 1) % this.maxBufferSize;

        const sample1 = buffer[pos1Floor] * (1 - pos1Frac) + buffer[pos1Next] * pos1Frac;
        const sample2 = buffer[pos2Floor] * (1 - pos2Frac) + buffer[pos2Next] * pos2Frac;

        // Hann window crossfade
        const crossfadePhase = this.crossfadePos / windowSamples;
        const window1 = 0.5 * (1 - Math.cos(Math.PI * crossfadePhase));
        const window2 = 0.5 * (1 - Math.cos(Math.PI * (crossfadePhase + 1)));

        outputChannel[i] = sample1 * window1 + sample2 * window2;

        // Update write position
        if (channel === 0) {
          this.writePos = (this.writePos + 1) % this.maxBufferSize;

          // Update read positions
          this.readPos1 = (this.readPos1 + readSpeed) % this.maxBufferSize;
          this.readPos2 = (this.readPos2 + readSpeed) % this.maxBufferSize;

          // Update crossfade position
          this.crossfadePos++;

          // Reset crossfade and resync read head when window completes
          if (this.crossfadePos >= windowSamples) {
            this.crossfadePos = 0;
            // Swap and resync: move read head 2 to current write position
            this.readPos2 = this.writePos - windowSamples * 0.5;
            if (this.readPos2 < 0) this.readPos2 += this.maxBufferSize;
          }

          // At half window, resync read head 1
          if (this.crossfadePos === Math.floor(windowSamples / 2)) {
            this.readPos1 = this.writePos - windowSamples * 0.5;
            if (this.readPos1 < 0) this.readPos1 += this.maxBufferSize;
          }
        }
      }
    }
    return true;
  }
}
registerProcessor('pitch-shift-processor', PitchShiftProcessor);
`;

  /**
   * PitchShiftEffect - Granular pitch shifting for octave effects and detuning
   *
   * Parameters:
   * - semitones: -12 to +12 (pitch shift in semitones)
   * - cents: -100 to +100 (fine pitch adjustment in cents)
   * - window: 50-200 (grain window size in milliseconds)
   * - mix: 0-100 (inherited wet/dry mix)
   */
  class PitchShiftEffect extends BaseEffect {
    constructor(ctx) {
      super(ctx, 'pitchshift');

      // Default parameters
      this.params.semitones = 0;    // -12 to +12
      this.params.cents = 0;        // -100 to +100
      this.params.window = 100;     // 50-200 ms
      this.params.mix = 50;         // 0-100

      // Track initialization state
      this.workletReady = false;
      this.workletNode = null;
      this.scriptNode = null;
      this.useWorklet = false;

      // Initialize the effect
      this._init();
    }

    /**
     * Calculate pitch ratio from semitones and cents
     * pitch = 2^(semitones/12 + cents/1200)
     */
    _calculatePitchRatio() {
      const semitones = this.params.semitones;
      const cents = this.params.cents;
      return Math.pow(2, semitones / 12 + cents / 1200);
    }

    /**
     * Initialize audio processing - tries AudioWorklet first, falls back to ScriptProcessor
     */
    async _init() {
      // Try to use AudioWorklet (modern approach)
      if (this.ctx.audioWorklet) {
        try {
          await this._initWorklet();
          this.useWorklet = true;
          return;
        } catch (err) {
          console.warn('PitchShift: AudioWorklet not available, effect disabled', err);
        }
      }

      // Skip ScriptProcessor fallback - at high sample rates (192kHz) it kills
      // the AudioContext. Effect will pass through dry signal when disabled.
      console.warn('PitchShift: No processing backend available (effect pass-through only)');
    }

    /**
     * Initialize using AudioWorklet
     */
    async _initWorklet() {
      // Create a Blob from the worklet code and get a URL
      const blob = new Blob([workletCode], { type: 'application/javascript' });
      const workletUrl = URL.createObjectURL(blob);

      try {
        // Register the worklet module
        await this.ctx.audioWorklet.addModule(workletUrl);

        // Create the worklet node
        this.workletNode = new AudioWorkletNode(this.ctx, 'pitch-shift-processor');

        // Connect: input -> workletNode -> wetGain
        this.input.connect(this.workletNode);
        this.workletNode.connect(this.wetGain);

        // Set initial parameter values
        this._updateWorkletParams();

        this.workletReady = true;
      } finally {
        // Clean up the blob URL
        URL.revokeObjectURL(workletUrl);
      }
    }

    /**
     * Initialize using ScriptProcessorNode (fallback)
     */
    _initScriptProcessor() {
      // Buffer size of 4096 is a good balance between latency and performance
      const bufferSize = 4096;
      this.scriptNode = this.ctx.createScriptProcessor(bufferSize, 2, 2);

      // Maximum buffer size for 200ms at up to 192kHz
      const maxBufferSize = 192000 * 0.2;
      const bufferL = new Float32Array(maxBufferSize);
      const bufferR = new Float32Array(maxBufferSize);
      let writePos = 0;
      let readPos1 = 0;
      let readPos2 = maxBufferSize / 2; // Start half a window offset
      let crossfadePos = 0;

      // Reference to this for closure
      const self = this;

      this.scriptNode.onaudioprocess = (event) => {
        const inputL = event.inputBuffer.getChannelData(0);
        const inputR = event.inputBuffer.numberOfChannels > 1
          ? event.inputBuffer.getChannelData(1)
          : inputL;
        const outputL = event.outputBuffer.getChannelData(0);
        const outputR = event.outputBuffer.getChannelData(1);

        const pitchRatio = self._calculatePitchRatio();
        const windowMs = self.params.window;
        const windowSamples = Math.floor(self.ctx.sampleRate * windowMs / 1000);
        const readSpeed = pitchRatio;

        for (let i = 0; i < inputL.length; i++) {
          // Write input to circular buffers
          bufferL[writePos] = inputL[i];
          bufferR[writePos] = inputR[i];

          // Calculate read positions with wrapping
          const pos1 = ((readPos1 % maxBufferSize) + maxBufferSize) % maxBufferSize;
          const pos2 = ((readPos2 % maxBufferSize) + maxBufferSize) % maxBufferSize;

          // Linear interpolation for fractional positions
          const pos1Floor = Math.floor(pos1);
          const pos1Frac = pos1 - pos1Floor;
          const pos1Next = (pos1Floor + 1) % maxBufferSize;

          const pos2Floor = Math.floor(pos2);
          const pos2Frac = pos2 - pos2Floor;
          const pos2Next = (pos2Floor + 1) % maxBufferSize;

          // Interpolated samples for left channel
          const sampleL1 = bufferL[pos1Floor] * (1 - pos1Frac) + bufferL[pos1Next] * pos1Frac;
          const sampleL2 = bufferL[pos2Floor] * (1 - pos2Frac) + bufferL[pos2Next] * pos2Frac;

          // Interpolated samples for right channel
          const sampleR1 = bufferR[pos1Floor] * (1 - pos1Frac) + bufferR[pos1Next] * pos1Frac;
          const sampleR2 = bufferR[pos2Floor] * (1 - pos2Frac) + bufferR[pos2Next] * pos2Frac;

          // Hann window crossfade
          const crossfadePhase = crossfadePos / windowSamples;
          const window1 = 0.5 * (1 - Math.cos(2 * Math.PI * crossfadePhase));
          const window2 = 0.5 * (1 - Math.cos(2 * Math.PI * (crossfadePhase + 0.5)));

          outputL[i] = sampleL1 * window1 + sampleL2 * window2;
          outputR[i] = sampleR1 * window1 + sampleR2 * window2;

          // Update write position
          writePos = (writePos + 1) % maxBufferSize;

          // Update read positions
          readPos1 = (readPos1 + readSpeed);
          readPos2 = (readPos2 + readSpeed);

          // Keep read positions in valid range
          if (readPos1 >= maxBufferSize) readPos1 -= maxBufferSize;
          if (readPos2 >= maxBufferSize) readPos2 -= maxBufferSize;

          // Update crossfade position
          crossfadePos++;

          // Reset crossfade and resync read head when window completes
          if (crossfadePos >= windowSamples) {
            crossfadePos = 0;
            // Resync read head 2 to current write position minus half window
            readPos2 = writePos - windowSamples * 0.5;
            if (readPos2 < 0) readPos2 += maxBufferSize;
          }

          // At half window, resync read head 1
          if (crossfadePos === Math.floor(windowSamples / 2)) {
            readPos1 = writePos - windowSamples * 0.5;
            if (readPos1 < 0) readPos1 += maxBufferSize;
          }
        }
      };

      // Connect: input -> scriptNode -> wetGain
      this.input.connect(this.scriptNode);
      this.scriptNode.connect(this.wetGain);
    }

    /**
     * Update AudioWorklet parameters
     */
    _updateWorkletParams() {
      if (!this.workletNode) return;

      const pitchRatioParam = this.workletNode.parameters.get('pitchRatio');
      const windowSizeParam = this.workletNode.parameters.get('windowSize');

      if (pitchRatioParam) {
        const pitchRatio = this._calculatePitchRatio();
        pitchRatioParam.setTargetAtTime(pitchRatio, this.ctx.currentTime, 0.01);
      }
      if (windowSizeParam) {
        // Convert ms to seconds
        const windowSec = this.params.window / 1000;
        windowSizeParam.setTargetAtTime(windowSec, this.ctx.currentTime, 0.01);
      }
    }

    /**
     * Handle parameter updates
     */
    updateParam(name, value) {
      switch (name) {
        case 'semitones':
          // Clamp to valid range
          this.params.semitones = Math.max(-12, Math.min(12, Math.round(value)));
          if (this.useWorklet) {
            this._updateWorkletParams();
          }
          break;

        case 'cents':
          // Clamp to valid range
          this.params.cents = Math.max(-100, Math.min(100, Math.round(value)));
          if (this.useWorklet) {
            this._updateWorkletParams();
          }
          break;

        case 'window':
          // Clamp to valid range (50-200 ms)
          this.params.window = Math.max(50, Math.min(200, value));
          if (this.useWorklet) {
            this._updateWorkletParams();
          }
          break;
      }
    }

    /**
     * Clean up audio nodes
     */
    dispose() {
      if (this.workletNode) {
        this.workletNode.disconnect();
        this.workletNode = null;
      }
      if (this.scriptNode) {
        this.scriptNode.disconnect();
        this.scriptNode.onaudioprocess = null;
        this.scriptNode = null;
      }
      super.dispose();
    }
  }

  // Export to SynthLab namespace
  SL.effects.PitchShiftEffect = PitchShiftEffect;

})();
