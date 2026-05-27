// Synth Lab - Pitch Shift Effect
// Creates octave effects and detuning using granular pitch shifting
//
// -----------------------------------------------------------------------
// PITCH SHIFT EFFECT — Educational Reference [FX-046]
// -----------------------------------------------------------------------
// Pitch shifting changes the perceived pitch of audio WITHOUT changing
// its duration (unlike speeding up a tape, which shifts both). This is
// achieved via granular time-stretching:
//
//   1. The input is written into a circular buffer continuously.
//   2. Two read heads scan the buffer at a speed different from the
//      write head. Faster reading = higher pitch, slower = lower.
//   3. Each read head outputs a "grain" — a short windowed segment.
//      Grains are crossfaded using a Hann window to avoid clicks at
//      boundaries (Overlap-Add / OLA reconstruction).
//   4. Periodically, each read head resyncs to the write position
//      to prevent it from drifting too far behind or ahead.
//
// Pitch ratio formula:
//   ratio = 2^(semitones / 12 + cents / 1200)
//   e.g. +12 semitones = 2.0 (one octave up), -12 = 0.5 (octave down)
//
// Window size tradeoff: larger windows (200 ms) produce smoother output
// with fewer artifacts but add latency; smaller windows (50 ms) respond
// faster but may introduce a "phasey" or "flanging" quality.
//
// References:
//   Dolson, M. (1986) "The Phase Vocoder: A Tutorial", CMJ 10(4)
//   Roads, C. (1996) The Computer Music Tutorial, MIT Press, Ch. 9
//   Puckette, M. (2007) Theory and Technique of Electronic Music
// -----------------------------------------------------------------------

(function() {
  var SL = window.SynthLab;
  var BaseEffect = SL.effects.BaseEffect;

  // ---------------------------------------------------------------
  // AudioWorklet Processor — runs on the audio rendering thread
  // ---------------------------------------------------------------
  // This string is compiled into a Blob and loaded as a module.
  // The worklet approach avoids main-thread jank that would occur
  // with ScriptProcessorNode, and processes at the native block
  // size (128 samples) rather than large 4096-sample buffers.
  // Two read heads with Hann-window crossfading implement the
  // overlap-add (OLA) granular pitch shift algorithm.
  // ---------------------------------------------------------------
  var workletCode =
    'class PitchShiftProcessor extends AudioWorkletProcessor {\n' +
    '  static get parameterDescriptors() {\n' +
    '    return [\n' +
    '      { name: \'pitchRatio\', defaultValue: 1.0, minValue: 0.5, maxValue: 2.0 },\n' +
    '      { name: \'windowSize\', defaultValue: 0.1, minValue: 0.05, maxValue: 0.2 }\n' +
    '    ];\n' +
    '  }\n' +
    '\n' +
    '  constructor() {\n' +
    '    super();\n' +
    '    // Maximum buffer size for 200ms at up to 192kHz\n' +
    '    this.maxBufferSize = 192000 * 0.2;\n' +
    '    this.bufferL = new Float32Array(this.maxBufferSize);\n' +
    '    this.bufferR = new Float32Array(this.maxBufferSize);\n' +
    '    this.writePos = 0;\n' +
    '\n' +
    '    // Two read heads for crossfading\n' +
    '    this.readPos1 = 0;\n' +
    '    this.readPos2 = 0;\n' +
    '    this.crossfadePos = 0;\n' +
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
    '    var pitchRatio = parameters.pitchRatio[0];\n' +
    '    var windowSize = parameters.windowSize[0];\n' +
    '    var windowSamples = Math.floor(sampleRate * windowSize);\n' +
    '\n' +
    '    // Read speed relative to write speed determines pitch\n' +
    '    // pitchRatio > 1 = higher pitch (read faster)\n' +
    '    // pitchRatio < 1 = lower pitch (read slower)\n' +
    '    var readSpeed = pitchRatio;\n' +
    '\n' +
    '    for (var channel = 0; channel < output.length; channel++) {\n' +
    '      var inputChannel = input[channel] || input[0];\n' +
    '      var outputChannel = output[channel];\n' +
    '      var buffer = channel === 0 ? this.bufferL : this.bufferR;\n' +
    '\n' +
    '      if (!inputChannel || !outputChannel) continue;\n' +
    '\n' +
    '      for (var i = 0; i < outputChannel.length; i++) {\n' +
    '        // Write input to circular buffer\n' +
    '        buffer[this.writePos] = inputChannel[i];\n' +
    '\n' +
    '        // Calculate read positions with wrapping\n' +
    '        var pos1 = this.readPos1 % this.maxBufferSize;\n' +
    '        var pos2 = this.readPos2 % this.maxBufferSize;\n' +
    '\n' +
    '        // Linear interpolation for fractional positions\n' +
    '        var pos1Floor = Math.floor(pos1);\n' +
    '        var pos1Frac = pos1 - pos1Floor;\n' +
    '        var pos1Next = (pos1Floor + 1) % this.maxBufferSize;\n' +
    '\n' +
    '        var pos2Floor = Math.floor(pos2);\n' +
    '        var pos2Frac = pos2 - pos2Floor;\n' +
    '        var pos2Next = (pos2Floor + 1) % this.maxBufferSize;\n' +
    '\n' +
    '        var sample1 = buffer[pos1Floor] * (1 - pos1Frac) + buffer[pos1Next] * pos1Frac;\n' +
    '        var sample2 = buffer[pos2Floor] * (1 - pos2Frac) + buffer[pos2Next] * pos2Frac;\n' +
    '\n' +
    '        // Hann window crossfade\n' +
    '        var crossfadePhase = this.crossfadePos / windowSamples;\n' +
    '        var window1 = 0.5 * (1 - Math.cos(Math.PI * crossfadePhase));\n' +
    '        var window2 = 0.5 * (1 - Math.cos(Math.PI * (crossfadePhase + 1)));\n' +
    '\n' +
    '        outputChannel[i] = sample1 * window1 + sample2 * window2;\n' +
    '\n' +
    '        // Update write position\n' +
    '        if (channel === 0) {\n' +
    '          this.writePos = (this.writePos + 1) % this.maxBufferSize;\n' +
    '\n' +
    '          // Update read positions\n' +
    '          this.readPos1 = (this.readPos1 + readSpeed) % this.maxBufferSize;\n' +
    '          this.readPos2 = (this.readPos2 + readSpeed) % this.maxBufferSize;\n' +
    '\n' +
    '          // Update crossfade position\n' +
    '          this.crossfadePos++;\n' +
    '\n' +
    '          // Reset crossfade and resync read head when window completes\n' +
    '          if (this.crossfadePos >= windowSamples) {\n' +
    '            this.crossfadePos = 0;\n' +
    '            // Swap and resync: move read head 2 to current write position\n' +
    '            this.readPos2 = this.writePos - windowSamples * 0.5;\n' +
    '            if (this.readPos2 < 0) this.readPos2 += this.maxBufferSize;\n' +
    '          }\n' +
    '\n' +
    '          // At half window, resync read head 1\n' +
    '          if (this.crossfadePos === Math.floor(windowSamples / 2)) {\n' +
    '            this.readPos1 = this.writePos - windowSamples * 0.5;\n' +
    '            if (this.readPos1 < 0) this.readPos1 += this.maxBufferSize;\n' +
    '          }\n' +
    '        }\n' +
    '      }\n' +
    '    }\n' +
    '    return true;\n' +
    '  }\n' +
    '}\n' +
    'registerProcessor(\'pitch-shift-processor\', PitchShiftProcessor);\n';

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

    // Equal temperament: each semitone is a factor of 2^(1/12) = 1.05946...
    // Cents subdivide a semitone into 100 parts: 2^(1/1200) per cent.
    // Combined: ratio = 2^(semi/12 + cents/1200).
    /**
     * Calculate pitch ratio from semitones and cents
     * pitch = 2^(semitones/12 + cents/1200)
     */
    _calculatePitchRatio() {
      var semitones = this.params.semitones;
      var cents = this.params.cents;
      return Math.pow(2, semitones / 12 + cents / 1200);
    }

    // Initialization strategy: prefer AudioWorklet (off-main-thread DSP)
    // and fall back gracefully. ScriptProcessorNode fallback is disabled
    // because at high sample rates (192 kHz) it overwhelms the main thread
    // and kills the AudioContext entirely.
    /**
     * Initialize audio processing - tries AudioWorklet first, falls back to ScriptProcessor
     */
    async _init() {
      var hasInitSucceeded = false;
      // Try to use AudioWorklet (modern approach)
      if (this.ctx.audioWorklet) {
        try {
          await this._initWorklet();
          this.useWorklet = true;
          hasInitSucceeded = true;
        } catch (err) {
          console.warn('PitchShift: AudioWorklet not available, effect disabled', err);
        }
      }

      if (!hasInitSucceeded) {
        // Skip ScriptProcessor fallback - at high sample rates (192kHz) it kills
        // the AudioContext. Effect will pass through dry signal when disabled.
        console.warn('PitchShift: No processing backend available (effect pass-through only)');
      }
    }

    // Worklet registration uses a Blob URL so the processor code can live
    // inline in this file rather than requiring a separate .js asset.
    // The URL is revoked immediately after addModule() resolves.
    /**
     * Initialize using AudioWorklet
     */
    async _initWorklet() {
      // Create a Blob from the worklet code and get a URL
      var blob = new Blob([workletCode], { type: 'application/javascript' });
      var workletUrl = URL.createObjectURL(blob);

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

    // ---------------------------------------------------------------
    // ScriptProcessorNode fallback (deprecated Web Audio API)
    // ---------------------------------------------------------------
    // Same OLA algorithm as the worklet but runs on the main thread.
    // The 4096-sample buffer adds ~85 ms latency at 48 kHz. This path
    // is currently unreachable (see _init) but kept for reference.
    // The circular buffer, dual read heads, and Hann crossfade logic
    // mirror the worklet implementation above.
    // ---------------------------------------------------------------
    /**
     * Initialize using ScriptProcessorNode (fallback)
     */
    _initScriptProcessor() {
      // Buffer size of 4096 is a good balance between latency and performance
      var bufferSize = 4096;
      this.scriptNode = this.ctx.createScriptProcessor(bufferSize, 2, 2);

      // Maximum buffer size for 200ms at up to 192kHz
      var maxBufferSize = 192000 * 0.2;
      var safeMaxBufferSize = maxBufferSize || 1;
      var bufferL = new Float32Array(maxBufferSize);
      var bufferR = new Float32Array(maxBufferSize);
      var writePos = 0;
      var readPos1 = 0;
      var readPos2 = safeMaxBufferSize / 2; // Start half a window offset
      var crossfadePos = 0;

      // Reference to this for closure
      var self = this;

      this.scriptNode.onaudioprocess = function(event) {
        var inputL = event.inputBuffer.getChannelData(0);
        var inputR = event.inputBuffer.numberOfChannels > 1
          ? event.inputBuffer.getChannelData(1)
          : inputL;
        var outputL = event.outputBuffer.getChannelData(0);
        var outputR = event.outputBuffer.getChannelData(1);

        var localBufSize = safeMaxBufferSize || 1;
        var pitchRatio = self._calculatePitchRatio();
        var windowMs = self.params.window;
        var windowSamples = Math.floor(self.ctx.sampleRate * windowMs / 1000);
        var safeWindowSamples = windowSamples || 1;
        var readSpeed = pitchRatio;

        for (var i = 0; i < inputL.length; i++) {
          // Write input to circular buffers
          bufferL[writePos] = inputL[i];
          bufferR[writePos] = inputR[i];

          // Calculate read positions with wrapping
          var pos1 = ((readPos1 % localBufSize) + maxBufferSize) % localBufSize;
          var pos2 = ((readPos2 % localBufSize) + maxBufferSize) % localBufSize;

          // Linear interpolation for fractional positions
          var pos1Floor = Math.floor(pos1);
          var pos1Frac = pos1 - pos1Floor;
          var pos1Next = (pos1Floor + 1) % localBufSize;

          var pos2Floor = Math.floor(pos2);
          var pos2Frac = pos2 - pos2Floor;
          var pos2Next = (pos2Floor + 1) % localBufSize;

          // Interpolated samples for left channel
          var sampleL1 = bufferL[pos1Floor] * (1 - pos1Frac) + bufferL[pos1Next] * pos1Frac;
          var sampleL2 = bufferL[pos2Floor] * (1 - pos2Frac) + bufferL[pos2Next] * pos2Frac;

          // Interpolated samples for right channel
          var sampleR1 = bufferR[pos1Floor] * (1 - pos1Frac) + bufferR[pos1Next] * pos1Frac;
          var sampleR2 = bufferR[pos2Floor] * (1 - pos2Frac) + bufferR[pos2Next] * pos2Frac;

          // Hann window crossfade: w(n) = 0.5 * (1 - cos(2*pi*n/N))
          // The two windows are offset by half a period so they sum to ~1.0,
          // achieving constant-power crossfade between grains.
          var crossfadePhase = crossfadePos / safeWindowSamples;
          var window1 = 0.5 * (1 - Math.cos(2 * Math.PI * crossfadePhase));
          var window2 = 0.5 * (1 - Math.cos(2 * Math.PI * (crossfadePhase + 0.5)));

          outputL[i] = sampleL1 * window1 + sampleL2 * window2;
          outputR[i] = sampleR1 * window1 + sampleR2 * window2;

          // Update write position
          writePos = (writePos + 1) % localBufSize;

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

    // AudioParam.setTargetAtTime provides smooth parameter transitions
    // to avoid zipper noise when the user adjusts semitones/cents/window.
    /**
     * Update AudioWorklet parameters
     */
    _updateWorkletParams() {
      if (!this.workletNode) return;

      var pitchRatioParam = this.workletNode.parameters.get('pitchRatio');
      var windowSizeParam = this.workletNode.parameters.get('windowSize');

      if (pitchRatioParam) {
        var pitchRatio = this._calculatePitchRatio();
        pitchRatioParam.setTargetAtTime(pitchRatio, this.ctx.currentTime, 0.01);
      }
      if (windowSizeParam) {
        // Convert ms to seconds
        var windowSec = this.params.window / 1000;
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
