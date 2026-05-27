// Synth Lab - Bitcrush Effect [FX-033]
// Reduces bit depth and sample rate for lo-fi digital distortion
//
// --- What is bitcrushing? ---
// Bitcrushing degrades audio in two independent ways:
//   1. Bit depth reduction: quantizes amplitude to fewer discrete levels.
//      Formula: quantized = round(x * levels) / levels, where levels = 2^bits.
//      Fewer bits = larger quantization steps = more quantization noise.
//      At 1 bit the signal collapses to a pure square wave (+1 or -1).
//   2. Sample rate reduction (downsampling / "zero-order hold"): holds each
//      sample for N consecutive output samples instead of reading a new one.
//      This removes high-frequency content and introduces aliasing artifacts
//      that give the sound its characteristic digital grit.
//
// --- Why does it sound musical? ---
// Early digital samplers had limited bit depth and sample rate by necessity.
// The Fairlight CMI (8-bit, 1979) and E-mu SP-1200 (12-bit, 1987) became
// iconic because their quantization artifacts added texture and "crunch"
// that producers grew to love. Bitcrushing recreates those artifacts
// intentionally as a creative effect.
//
// --- Implementation note ---
// This effect uses an AudioWorklet processor for sample-accurate control.
// Both parameters (bits, downsample) support a-rate automation so they can
// be modulated smoothly per-sample from the main thread.
//
// Reference: Roads, C. (1996) The Computer Music Tutorial, MIT Press, Ch. 5
//
// Spec: AudioWorklet-based. Bits 1-16 (default 8, step 1),
//        Downsample 1-50x (default 1, step 1), Mix 0-100% (default 50%).

(function() {
  var SL = window.SynthLab;
  var BaseEffect = SL.effects.BaseEffect;

  // AudioWorkvar processor code as a string for inline registration
  // The worklet runs on the audio rendering thread for glitch-free processing.
  var workletCode =
    'class BitcrushProcessor extends AudioWorkletProcessor {\n' +
    '  static get parameterDescriptors() {\n' +
    '    return [\n' +
    '      { name: \'bits\', defaultValue: 8, minValue: 1, maxValue: 16 },\n' +
    '      { name: \'downsample\', defaultValue: 1, minValue: 1, maxValue: 50 }\n' +
    '    ];\n' +
    '  }\n' +
    '\n' +
    '  constructor() {\n' +
    '    super();\n' +
    '    this.lastSampleL = 0;\n' +
    '    this.lastSampleR = 0;\n' +
    '    this.sampleCounter = 0;\n' +
    '  }\n' +
    '\n' +
    '  process(inputs, outputs, parameters) {\n' +
    '    var input = inputs[0];\n' +
    '    var output = outputs[0];\n' +
    '\n' +
    '    if (!input || !input.length) {\n' +
    '      return true;\n' +
    '    }\n' +
    '\n' +
    '    // Get parameter values (may be arrays for a-rate or single values for k-rate)\n' +
    '    var bitsParam = parameters.bits;\n' +
    '    var downsampleParam = parameters.downsample;\n' +
    '\n' +
    '    var bits = bitsParam.length > 1 ? bitsParam : bitsParam[0];\n' +
    '    var downsample = downsampleParam.length > 1 ? downsampleParam : Math.floor(downsampleParam[0]);\n' +
    '\n' +
    '    // Process each channel\n' +
    '    for (var channel = 0; channel < output.length; channel++) {\n' +
    '      var inputChannel = input[channel] || input[0]; // Fallback to first channel if mono\n' +
    '      var outputChannel = output[channel];\n' +
    '\n' +
    '      if (!inputChannel || !outputChannel) continue;\n' +
    '\n' +
    '      for (var i = 0; i < outputChannel.length; i++) {\n' +
    '        // Get current parameter values (handle both a-rate and k-rate)\n' +
    '        var currentBits = Array.isArray(bits) ? bits[i] : bits;\n' +
    '        var currentDownsample = Array.isArray(downsample) ? Math.floor(downsample[i]) : downsample;\n' +
    '\n' +
    '        // Calculate step size for bit reduction\n' +
    '        // step = 0.5^bits = 1/(2^bits). This is the smallest amplitude\n' +
    '        // increment at the given bit depth. E.g. 8 bits -> 256 levels.\n' +
    '        var step = Math.pow(0.5, currentBits);\n' +
    '\n' +
    '        // Zero-order hold: only sample a new value every N frames.\n' +
    '        // Between samples, the last captured value is repeated ("held"),\n' +
    '        // creating a staircase waveform that aliases richly.\n' +
    '        this.sampleCounter++;\n' +
    '        if (this.sampleCounter >= currentDownsample) {\n' +
    '          this.sampleCounter = 0;\n' +
    '          // Bit reduction: quantize to step size\n' +
    '          // round(x / step) * step snaps x to the nearest quantization level\n' +
    '          var quantized = step * Math.floor(inputChannel[i] / step + 0.5);\n' +
    '\n' +
    '          if (channel === 0) {\n' +
    '            this.lastSampleL = quantized;\n' +
    '          } else {\n' +
    '            this.lastSampleR = quantized;\n' +
    '          }\n' +
    '        }\n' +
    '\n' +
    '        outputChannel[i] = channel === 0 ? this.lastSampleL : this.lastSampleR;\n' +
    '      }\n' +
    '    }\n' +
    '    return true;\n' +
    '  }\n' +
    '}\n' +
    'registerProcessor(\'bitcrush-processor\', BitcrushProcessor);\n';

  // ---------------------------------------------------------------------------
  // BitcrushEffect class
  // ---------------------------------------------------------------------------
  // Main-thread wrapper that manages an AudioWorklet for real-time bitcrushing.
  // Falls back to a silent pass-through if the worklet cannot be loaded (e.g.
  // insecure contexts that block AudioWorklet). The ScriptProcessor fallback
  // is retained in code but disabled at runtime because it can destabilize
  // the AudioContext at high sample rates (192 kHz).
  // ---------------------------------------------------------------------------

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
      this.useWorkvar= false;

      // Initialize the effect
      this._init();
    }

    /**
     * Initialize audio processing - tries AudioWorkvar first, falls back to ScriptProcessor
     */
    async _init() {
      var hasInitSucceeded = false;
      // Try to use AudioWorkvar(modern approach)
      if (this.ctx.audioWorklet) {
        try {
          await this._initWorklet();
          this.useWorkvar= true;
          hasInitSucceeded = true;
        } catch (err) {
          console.warn('Bitcrush: AudioWorkvar not available, effect disabled', err);
        }
      }

      if (!hasInitSucceeded) {
        // Skip ScriptProcessor fallback - at high sample rates (192kHz) it kills
        // the AudioContext. Effect will pass through dry signal when disabled.
        console.warn('Bitcrush: No processing backend available (effect pass-through only)');
      }
    }

    /**
     * Initialize using AudioWorklet
     */
    // The worklet processor string is compiled into a Blob URL at runtime.
    // This avoids needing a separate .js file for the processor, keeping
    // the effect self-contained in a single module.
    async _initWorklet() {
      // Create a Blob from the workvar code and get a URL
      var blob = new Blob([workletCode], { type: 'application/javascript' });
      var workletUrl = URL.createObjectURL(blob);

      try {
        // Register the workvar module
        await this.ctx.audioWorklet.addModule(workletUrl);

        // Create the workvar node
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
    // ScriptProcessorNode is deprecated (W3C Web Audio API spec) but kept as
    // a reference implementation. It runs on the main thread, so large buffer
    // sizes are needed to avoid dropouts — adding latency.
    _initScriptProcessor() {
      // Buffer size of 4096 is a good balance between latency and performance
      var bufferSize = 4096;
      this.scriptNode = this.ctx.createScriptProcessor(bufferSize, 2, 2);

      // State for sample-and-hold
      var lastSampleL = 0;
      var lastSampleR = 0;
      var sampleCounter = 0;

      // Reference to params for closure
      var params = this.params;

      this.scriptNode.onaudioprocess = function(event) {
        var inputL = event.inputBuffer.getChannelData(0);
        var inputR = event.inputBuffer.numberOfChannels > 1
          ? event.inputBuffer.getChannelData(1)
          : inputL;
        var outputL = event.outputBuffer.getChannelData(0);
        var outputR = event.outputBuffer.getChannelData(1);

        var bits = params.bits;
        var downsample = Math.floor(params.downsample);
        var step = Math.pow(0.5, bits);

        for (var i = 0; i < inputL.length; i++) {
          sampleCounter++;

          if (sampleCounter >= downsample) {
            sampleCounter = 0;
            // Bit reduction: quantize to step size
            var safeStep = step || 0.001;
            lastSampleL = safeStep * Math.floor(inputL[i] / safeStep + 0.5);
            lastSampleR = safeStep * Math.floor(inputR[i] / safeStep + 0.5);
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
     * Update AudioWorkvar parameters
     */
    // setTargetAtTime with a small time constant (0.01s) smooths parameter
    // changes to avoid audible zipper noise when automating bits or downsample.
    _updateWorkletParams() {
      if (!this.workletNode) return;

      var bitsParam = this.workletNode.parameters.get('bits');
      var downsampleParam = this.workletNode.parameters.get('downsample');

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
