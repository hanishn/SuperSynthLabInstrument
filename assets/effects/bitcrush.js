// Synth Lab - Bitcrush Effect
// Reduces bit depth and sample rate for lo-fi digital distortion

(function() {
  const SL = window.SynthLab;
  const BaseEffect = SL.effects.BaseEffect;

  // AudioWorklet processor code as a string for inline registration
  const workletCode = `
class BitcrushProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'bits', defaultValue: 8, minValue: 1, maxValue: 16 },
      { name: 'downsample', defaultValue: 1, minValue: 1, maxValue: 50 }
    ];
  }

  constructor() {
    super();
    this.lastSampleL = 0;
    this.lastSampleR = 0;
    this.sampleCounter = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !input.length) {
      return true;
    }

    // Get parameter values (may be arrays for a-rate or single values for k-rate)
    const bitsParam = parameters.bits;
    const downsampleParam = parameters.downsample;

    const bits = bitsParam.length > 1 ? bitsParam : bitsParam[0];
    const downsample = downsampleParam.length > 1 ? downsampleParam : Math.floor(downsampleParam[0]);

    // Process each channel
    for (let channel = 0; channel < output.length; channel++) {
      const inputChannel = input[channel] || input[0]; // Fallback to first channel if mono
      const outputChannel = output[channel];

      if (!inputChannel || !outputChannel) continue;

      for (let i = 0; i < outputChannel.length; i++) {
        // Get current parameter values (handle both a-rate and k-rate)
        const currentBits = Array.isArray(bits) ? bits[i] : bits;
        const currentDownsample = Array.isArray(downsample) ? Math.floor(downsample[i]) : downsample;

        // Calculate step size for bit reduction
        const step = Math.pow(0.5, currentBits);

        this.sampleCounter++;
        if (this.sampleCounter >= currentDownsample) {
          this.sampleCounter = 0;
          // Bit reduction: quantize to step size
          const quantized = step * Math.floor(inputChannel[i] / step + 0.5);

          if (channel === 0) {
            this.lastSampleL = quantized;
          } else {
            this.lastSampleR = quantized;
          }
        }

        outputChannel[i] = channel === 0 ? this.lastSampleL : this.lastSampleR;
      }
    }
    return true;
  }
}
registerProcessor('bitcrush-processor', BitcrushProcessor);
`;

  /**
   * BitcrushEffect - Lo-fi bit depth and sample rate reduction
   * Creates that classic retro digital sound
   */
  class BitcrushEffect extends BaseEffect {
    constructor(ctx) {
      super(ctx, 'bitcrush');

      // Default parameters
      this.params.bits = 8;        // 1-16 bit depth
      this.params.downsample = 1;  // 1-50 sample rate reduction
      this.params.mix = 50;        // 0-100 wet/dry mix

      // Track initialization state
      this.workletReady = false;
      this.workletNode = null;
      this.scriptNode = null;
      this.useWorklet = false;

      // Initialize the effect
      this._init();
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
          console.warn('Bitcrush: AudioWorklet not available, effect disabled', err);
        }
      }

      // Skip ScriptProcessor fallback - at high sample rates (192kHz) it kills
      // the AudioContext. Effect will pass through dry signal when disabled.
      console.warn('Bitcrush: No processing backend available (effect pass-through only)');
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
        this.workletNode = new AudioWorkletNode(this.ctx, 'bitcrush-processor');

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

      // State for sample-and-hold
      let lastSampleL = 0;
      let lastSampleR = 0;
      let sampleCounter = 0;

      // Reference to params for closure
      const params = this.params;

      this.scriptNode.onaudioprocess = (event) => {
        const inputL = event.inputBuffer.getChannelData(0);
        const inputR = event.inputBuffer.numberOfChannels > 1
          ? event.inputBuffer.getChannelData(1)
          : inputL;
        const outputL = event.outputBuffer.getChannelData(0);
        const outputR = event.outputBuffer.getChannelData(1);

        const bits = params.bits;
        const downsample = Math.floor(params.downsample);
        const step = Math.pow(0.5, bits);

        for (let i = 0; i < inputL.length; i++) {
          sampleCounter++;

          if (sampleCounter >= downsample) {
            sampleCounter = 0;
            // Bit reduction: quantize to step size
            lastSampleL = step * Math.floor(inputL[i] / step + 0.5);
            lastSampleR = step * Math.floor(inputR[i] / step + 0.5);
          }

          outputL[i] = lastSampleL;
          outputR[i] = lastSampleR;
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

      const bitsParam = this.workletNode.parameters.get('bits');
      const downsampleParam = this.workletNode.parameters.get('downsample');

      if (bitsParam) {
        bitsParam.setTargetAtTime(this.params.bits, this.ctx.currentTime, 0.01);
      }
      if (downsampleParam) {
        downsampleParam.setTargetAtTime(this.params.downsample, this.ctx.currentTime, 0.01);
      }
    }

    /**
     * Handle parameter updates
     */
    updateParam(name, value) {
      switch (name) {
        case 'bits':
          // Clamp to valid range
          this.params.bits = Math.max(1, Math.min(16, value));
          if (this.useWorklet) {
            this._updateWorkletParams();
          }
          break;

        case 'downsample':
          // Clamp to valid range
          this.params.downsample = Math.max(1, Math.min(50, value));
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
  SL.effects.Bitcrush = BitcrushEffect;

})();
