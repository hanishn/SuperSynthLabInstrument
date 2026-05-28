// Synth Lab - Stereo Widener Effect [FX-054]
// Creates a wider stereo image using mid-side processing and Haas effect
//
// --- What is stereo widening? ---
// Stereo widening makes a mix sound "bigger" and more spacious by increasing
// the perceived separation between left and right. This effect combines two
// complementary techniques:
//
// 1. Mid/Side (M/S) processing:
//    Mid  = (L + R) / 2  — the mono-compatible center content
//    Side = (L - R) / 2  — the stereo difference (ambience, panning)
//    Amplifying the Side signal relative to Mid increases perceived width.
//    Width > 100% = side gain > 1.0 (hyper-stereo).
//    Width = 0% = side gain = 0 (pure mono collapse).
//    To reconstruct: L' = Mid + Side, R' = Mid - Side.
//
// 2. Haas effect (precedence effect):
//    Delaying one channel by 1-30 ms exploits the brain's localization
//    mechanism. The ear perceives the sound source at the earlier (un-delayed)
//    side, while the delayed copy adds a sense of spaciousness without being
//    heard as a distinct echo (below ~40 ms). Discovered by Helmut Haas in
//    his 1951 PhD thesis on speech intelligibility.
//
// --- Bass mono ---
// Low frequencies have long wavelengths and are poorly localized by human
// hearing. Keeping bass in the center (mono) prevents destructive phase
// cancellation between L and R speakers — critical for club sound systems
// and vinyl cutting, where out-of-phase bass can cause the stylus to jump.
// A crossover filter splits the spectrum: bass is summed to mono, while
// mid/high frequencies retain full stereo width.
//
// References:
//   Haas, H. (1951) "The Influence of a Single Echo on the Audibility
//     of Speech", PhD thesis, University of Goettingen
//   Zolzer, U. (2011) DAFX: Digital Audio Effects, Wiley, Ch. 8
//
// Spec: Width 0-200% (default 100), Haas Delay 0-30 ms (default 10),
//        Bass Mono 0-100% (default 50), Mix 0-100% (default 100).

(function() {
  var SL = window.SynthLab;
  var BaseEffect = SL.effects.BaseEffect;

  /**
   * WidenerEffect - Stereo width enhancement using mid-side processing
   *
   * Stereo widening technique:
   * 1. Split stereo input into Left and Right channels
   * 2. Create Mid (L+R)/2 and Side (L-R)/2 signals
   * 3. Adjust the balance between Mid and Side to control width
   * 4. Apply Haas effect (short delay on one channel) for additional widening
   * 5. Optional bass mono: collapse low frequencies to center for tightness
   * 6. Recombine: L = Mid + Side, R = Mid - Side
   *
   * Signal flow:
   * input -> splitter -> [L channel] -> midSideMatrix -> [processing] -> merger -> wetGain
   *                   -> [R channel] ->
   *
   * Parameters:
   * - width: 0-200% (100 = normal, 200 = maximum widening, 0 = mono)
   * - delay: 0-30ms (Haas effect delay for additional widening)
   * - bassMono: 0-100% (amount of low frequency mono collapse)
   * - mix: 0-100 (inherited wet/dry mix)
   */
  class WidenerEffect extends BaseEffect {
    constructor(ctx) {
      super(ctx, 'widener');

      // Default parameters
      this.params.width = 100;     // 100% = normal stereo
      this.params.delay = 10;      // 10ms Haas delay
      this.params.bassMono = 50;   // 50% bass mono
      this.params.mix = 100;       // 100% wet

      // Bass mono crossover frequency in Hz
      this.crossoverFreq = 200;

      // === Create stereo processing chain ===
      // The Web Audio API processes audio in interleaved stereo by default.
      // ChannelSplitter/Merger nodes let us work with individual L/R channels.

      // Split incoming stereo signal into L and R
      this.splitter = ctx.createChannelSplitter(2);

      // Merge back to stereo
      this.merger = ctx.createChannelMerger(2);

      // === Mid-Side Processing ===
      // Mid = (L + R) / 2  (center/mono content)
      // Side = (L - R) / 2 (stereo difference)
      //
      // This is implemented as a matrix multiply using four GainNodes:
      //   Mid  = L * 0.5 + R * 0.5
      //   Side = L * 0.5 + R * (-0.5)
      // The Web Audio graph sums all connections into a node automatically,
      // so connecting both leftToMid and rightToMid into midGain yields the sum.

      // Left channel gain nodes for mid-side matrix
      this.leftToMid = ctx.createGain();
      this.leftToMid.gain.value = 0.5;

      this.leftToSide = ctx.createGain();
      this.leftToSide.gain.value = 0.5;

      // Right channel gain nodes for mid-side matrix
      this.rightToMid = ctx.createGain();
      this.rightToMid.gain.value = 0.5;

      this.rightToSide = ctx.createGain();
      this.rightToSide.gain.value = -0.5; // Negative for L-R subtraction

      // Mid and Side summing nodes
      this.midGain = ctx.createGain();
      this.midGain.gain.value = 1.0;

      this.sideGain = ctx.createGain();
      this.sideGain.gain.value = 1.0; // Will be adjusted by width parameter

      // === Haas Effect Delay ===
      // Apply short delay to right channel for additional widening.
      // The brain uses inter-aural time difference (ITD) to localize sound.
      // A 1-30 ms delay on one channel creates a phantom shift toward the
      // un-delayed side without sounding like a distinct echo.
      this.haasDelay = ctx.createDelay(0.05); // Max 50ms
      this.haasDelay.delayTime.value = 0.010; // Default 10ms

      // === Bass Mono Processing ===
      // A Linkwitz-Riley style crossover splits the signal into bass and
      // non-bass bands. Bass is summed to mono (L+R)/2 to prevent phase
      // cancellation on mono playback systems and subwoofers. The crossover
      // uses matched lowpass/highpass pairs at Q=0.707 (Butterworth) for a
      // flat magnitude response at the crossover frequency.
      // Lowpass filter to extract bass frequencies
      this.bassFilterL = ctx.createBiquadFilter();
      this.bassFilterL.type = 'lowpass';
      this.bassFilterL.frequency.value = this.crossoverFreq;
      this.bassFilterL.Q.value = 0.707;

      this.bassFilterR = ctx.createBiquadFilter();
      this.bassFilterR.type = 'lowpass';
      this.bassFilterR.frequency.value = this.crossoverFreq;
      this.bassFilterR.Q.value = 0.707;

      // Highpass filters for non-bass content
      this.highpassL = ctx.createBiquadFilter();
      this.highpassL.type = 'highpass';
      this.highpassL.frequency.value = this.crossoverFreq;
      this.highpassL.Q.value = 0.707;

      this.highpassR = ctx.createBiquadFilter();
      this.highpassR.type = 'highpass';
      this.highpassR.frequency.value = this.crossoverFreq;
      this.highpassR.Q.value = 0.707;

      // Bass summing gains (for mono collapse)
      this.bassToMonoL = ctx.createGain();
      this.bassToMonoL.gain.value = 0.5;

      this.bassToMonoR = ctx.createGain();
      this.bassToMonoR.gain.value = 0.5;

      // Bass mono mix control
      this.bassMonoMixL = ctx.createGain();
      this.bassMonoMixL.gain.value = 0.5; // 50% bass mono by default

      this.bassMonoMixR = ctx.createGain();
      this.bassMonoMixR.gain.value = 0.5;

      // Original bass (non-mono'd) pass through
      this.bassOriginalL = ctx.createGain();
      this.bassOriginalL.gain.value = 0.5;

      this.bassOriginalR = ctx.createGain();
      this.bassOriginalR.gain.value = 0.5;

      // Output channel gains
      this.outputL = ctx.createGain();
      this.outputL.gain.value = 1.0;

      this.outputR = ctx.createGain();
      this.outputR.gain.value = 1.0;

      // === Build the signal flow ===

      // Connect input to splitter
      this.input.connect(this.splitter);

      // Split to mid-side matrix
      // Left channel (splitter output 0)
      this.splitter.connect(this.leftToMid, 0);
      this.splitter.connect(this.leftToSide, 0);

      // Right channel (splitter output 1)
      this.splitter.connect(this.rightToMid, 1);
      this.splitter.connect(this.rightToSide, 1);

      // Sum to create Mid signal: (L + R) / 2
      this.leftToMid.connect(this.midGain);
      this.rightToMid.connect(this.midGain);

      // Sum to create Side signal: (L - R) / 2
      this.leftToSide.connect(this.sideGain);
      this.rightToSide.connect(this.sideGain);

      // === Reconstruct stereo from Mid-Side ===
      // We need: L' = Mid + Side, R' = Mid - Side
      // But we also need bass mono processing

      // For simplicity, we'll use a parallel approach:
      // 1. Process the widened signal through bass filters
      // 2. Sum bass to mono, keep high frequencies widened

      // Create reconstruction gains
      this.midToL = ctx.createGain();
      this.midToL.gain.value = 1.0;

      this.midToR = ctx.createGain();
      this.midToR.gain.value = 1.0;

      this.sideToL = ctx.createGain();
      this.sideToL.gain.value = 1.0;

      this.sideToR = ctx.createGain();
      this.sideToR.gain.value = -1.0; // Negative for R = Mid - Side

      // Mid to both channels
      this.midGain.connect(this.midToL);
      this.midGain.connect(this.midToR);

      // Side to both channels (with opposite polarity)
      this.sideGain.connect(this.sideToL);
      this.sideGain.connect(this.sideToR);

      // Sum for left channel reconstruction
      this.reconstructL = ctx.createGain();
      this.reconstructL.gain.value = 1.0;
      this.midToL.connect(this.reconstructL);
      this.sideToL.connect(this.reconstructL);

      // Sum for right channel reconstruction
      this.reconstructR = ctx.createGain();
      this.reconstructR.gain.value = 1.0;
      this.midToR.connect(this.reconstructR);
      this.sideToR.connect(this.reconstructR);

      // === Bass Mono Processing ===
      // Split reconstructed signal into bass and high
      this.reconstructL.connect(this.bassFilterL);
      this.reconstructL.connect(this.highpassL);

      this.reconstructR.connect(this.bassFilterR);
      this.reconstructR.connect(this.highpassR);

      // Create mono bass (average of L and R bass)
      this.bassFilterL.connect(this.bassToMonoL);
      this.bassFilterR.connect(this.bassToMonoL);
      this.bassFilterL.connect(this.bassToMonoR);
      this.bassFilterR.connect(this.bassToMonoR);

      // Bass mono mix nodes (weighted sum of mono and original bass)
      this.bassToMonoL.connect(this.bassMonoMixL);
      this.bassToMonoR.connect(this.bassMonoMixR);

      this.bassFilterL.connect(this.bassOriginalL);
      this.bassFilterR.connect(this.bassOriginalR);

      // === Final output summing ===
      // Highpass (widened high frequencies) + bass (mono'd)
      this.highpassL.connect(this.outputL);
      this.bassMonoMixL.connect(this.outputL);
      this.bassOriginalL.connect(this.outputL);

      this.highpassR.connect(this.outputR);
      this.bassMonoMixR.connect(this.outputR);
      this.bassOriginalR.connect(this.outputR);

      // Apply Haas delay to right channel
      this.outputR.connect(this.haasDelay);

      // Connect to merger (L on channel 0, R on channel 1 via delay)
      this.outputL.connect(this.merger, 0, 0);
      this.haasDelay.connect(this.merger, 0, 1);

      // Connect merger to wetGain (from BaseEffect)
      this.merger.connect(this.wetGain);

      // Initialize parameters
      this.updateWidth(this.params.width);
      this.updateBassMono(this.params.bassMono);
    }

    /**
     * Update the stereo width
     * @param {number} width - 0-200% (0=mono, 100=normal, 200=max wide)
     */
    // The width parameter directly scales the Side signal gain. Because
    // Side carries all the stereo difference information, amplifying it
    // makes hard-panned and ambient content louder relative to center-panned
    // content. Values above 100% can cause mono-compatibility issues —
    // when summed to mono, the amplified side content cancels, potentially
    // making the mix sound thinner on mono systems.
    updateWidth(width) {
      var widthValue = Math.max(0, Math.min(200, width));
      this.params.width = widthValue;

      // Width controls the ratio of Side to Mid
      // At 100%, side gain = 1.0 (normal stereo)
      // At 200%, side gain = 2.0 (emphasized sides)
      // At 0%, side gain = 0 (mono)
      var sideMultiplier = widthValue / 100;

      this.sideGain.gain.setTargetAtTime(sideMultiplier, this.ctx.currentTime, 0.01);
    }

    /**
     * Update the Haas effect delay
     * @param {number} delayMs - 0-30ms
     */
    updateDelay(delayMs) {
      var delayValue = Math.max(0, Math.min(30, delayMs));
      this.params.delay = delayValue;

      var delaySeconds = delayValue / 1000;
      this.haasDelay.delayTime.setTargetAtTime(delaySeconds, this.ctx.currentTime, 0.01);
    }

    /**
     * Update the bass mono amount
     * @param {number} bassMono - 0-100%
     */
    updateBassMono(bassMono) {
      var bassMonoValue = Math.max(0, Math.min(100, bassMono));
      this.params.bassMono = bassMonoValue;

      // bassMono controls how much the bass is collapsed to mono
      // At 0%, keep original stereo bass
      // At 100%, fully mono bass
      var monoAmount = bassMonoValue / 100;
      var originalAmount = 1 - monoAmount;

      this.bassMonoMixL.gain.setTargetAtTime(monoAmount * 0.5, this.ctx.currentTime, 0.01);
      this.bassMonoMixR.gain.setTargetAtTime(monoAmount * 0.5, this.ctx.currentTime, 0.01);
      this.bassOriginalL.gain.setTargetAtTime(originalAmount, this.ctx.currentTime, 0.01);
      this.bassOriginalR.gain.setTargetAtTime(originalAmount, this.ctx.currentTime, 0.01);
    }

    /**
     * Handle parameter updates
     */
    updateParam(name, value) {
      switch (name) {
        case 'width':
          this.updateWidth(value);
          break;

        case 'delay':
          this.updateDelay(value);
          break;

        case 'bassMono':
          this.updateBassMono(value);
          break;
      }
    }

    /**
     * Clean up all audio nodes
     */
    dispose() {
      // Disconnect all nodes
      this.splitter.disconnect();
      this.merger.disconnect();
      this.leftToMid.disconnect();
      this.leftToSide.disconnect();
      this.rightToMid.disconnect();
      this.rightToSide.disconnect();
      this.midGain.disconnect();
      this.sideGain.disconnect();
      this.midToL.disconnect();
      this.midToR.disconnect();
      this.sideToL.disconnect();
      this.sideToR.disconnect();
      this.reconstructL.disconnect();
      this.reconstructR.disconnect();
      this.haasDelay.disconnect();
      this.bassFilterL.disconnect();
      this.bassFilterR.disconnect();
      this.highpassL.disconnect();
      this.highpassR.disconnect();
      this.bassToMonoL.disconnect();
      this.bassToMonoR.disconnect();
      this.bassMonoMixL.disconnect();
      this.bassMonoMixR.disconnect();
      this.bassOriginalL.disconnect();
      this.bassOriginalR.disconnect();
      this.outputL.disconnect();
      this.outputR.disconnect();

      super.dispose();
    }
  }

  // Export to SynthLab namespace
  SL.effects.WidenerEffect = WidenerEffect;

})();
