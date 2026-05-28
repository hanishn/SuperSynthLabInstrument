// Super Synth Lab - Chip Synth Engine Module
// Emulates 4 classic sound chips: C64 SID, NES 2A03, Game Boy, Sega Genesis YM2612
// v1.0.0 - ScriptProcessor, 16-voice, ADSR, bit depth reduction
//
// -- Educational Notes: Chip Sound Synthesis --
//
// This engine recreates the sound generation techniques of four iconic sound
// chips from the 8-bit and 16-bit eras. Each chip imposed severe hardware
// constraints (limited voices, low bit depth, fixed waveforms) that became
// defining aesthetic signatures rather than mere limitations.
//
// The four chips emulated here span 1982-1988 and represent fundamentally
// different synthesis approaches:
//   SID  (MOS 6581, 1982) - Subtractive: oscillators + multimode filter
//   2A03 (Ricoh, 1983)    - Fixed waveforms with quantized output
//   DMG  (Sharp, 1989)    - Programmable 4-bit wavetable channel
//   YM2612 (Yamaha, 1988) - 4-operator FM synthesis (DX-family technology)
//
// References:
//   Yannes, R. (1982). MOS Technology 6581 SID chip design.
//   Roads, C. (1996). The Computer Music Tutorial. MIT Press. Ch. 5-6.
//   Collins, K. (2008). Game Sound. MIT Press. Ch. 2-4.
//
// All waveform generation uses phase-accumulator synthesis:
//   phase(n) = phase(n-1) + freq / sampleRate
// The phase wraps at 1.0 and maps into each chip's native waveform shape.
// Bit-depth reduction quantizes the output to simulate D/A converter resolution.
//
(function() {
  'use strict';

  var SL = window.SynthLab;

  // ============================================================
  // Constants
  // ============================================================

  var MAX_VOICES_PER_INSTRUMENT = 16;
  var TWO_PI = 2 * Math.PI;

  var CHIP_MODES = {
    SID: 'sid',
    NES: 'nes',
    GAMEBOY: 'gameboy',
    GENESIS: 'genesis'
  };

  // NES/GB duty cycle options: 12.5%, 25%, 50%, 75%
  // The 2A03 and Game Boy pulse channels support exactly these four duty ratios.
  // Duty cycle controls harmonic content: 50% yields only odd harmonics (square wave),
  // while narrower pulses (12.5%, 25%) introduce even harmonics, producing a thinner,
  // more nasal timbre. See Roads (1996), pp. 110-113 on pulse wave spectra.
  var DUTY_PRESETS = [0.125, 0.25, 0.5, 0.75];

  // Pulse waveform types (all variants that use duty-cycle based generation)
  var PULSE_WAVEFORMS = { 'pulse1': 1, 'pulse2': 1, 'pulse': 1 };

  // Valid chip mode identifiers
  var VALID_CHIP_MODES = { 'sid': 1, 'nes': 1, 'gameboy': 1, 'genesis': 1 };

  // YM2612 FM algorithms (which ops are carriers vs modulators)
  // Each algorithm: array of 4 entries, one per operator
  // true = carrier (output), false = modulator
  //
  // The YM2612 (Yamaha OPN2, used in the Sega Genesis/Mega Drive, 1988)
  // implements 4-operator FM synthesis derived from Yamaha's DX technology.
  // The DX7 had 6 operators and 32 algorithms; the YM2612 reduces this to
  // 4 operators and 8 algorithms. Each algorithm defines a unique topology
  // of carrier/modulator connections. Carriers produce audible output;
  // modulators shape the timbre by frequency-modulating other operators.
  // Algorithm 0 (full serial chain) produces the most complex spectra;
  // Algorithm 7 (all carriers) produces pure additive synthesis.
  // See Roads (1996), Ch. 6 on FM synthesis and Chowning's (1973) original work.
  var YM2612_ALGORITHMS = [
    // Algo 0: serial chain  op1->op2->op3->op4(out)
    [false, false, false, true],
    // Algo 1: (op1+op2)->op3->op4(out)
    [false, false, false, true],
    // Algo 2: (op1+op2*op3)->op4(out)
    [false, false, false, true],
    // Algo 3: (op1*op2+op3)->op4(out)
    [false, false, false, true],
    // Algo 4: op1->op2(out), op3->op4(out)
    [false, true, false, true],
    // Algo 5: op1->(op2+op3+op4)(out)
    [false, true, true, true],
    // Algo 6: op1->op2(out), op3(out), op4(out)
    [false, true, true, true],
    // Algo 7: all carriers
    [true, true, true, true]
  ];

  // 9-bit sine table for YM2612 (quantized)
  // The real YM2612 stores a quarter-sine in ROM and reconstructs the full
  // cycle via symmetry. The internal representation uses a 10-bit log-sine
  // table and a 12-bit exponential table. Here we simplify to a 512-entry
  // linear sine table quantized to 9-bit resolution, which captures the
  // characteristic stepped quality of the hardware's D/A conversion.
  var YM2612_SINE_TABLE = [];
  (function() {
    for (var i = 0; i < 512; i++) {
      var raw = Math.sin(TWO_PI * i / 512);
      // Quantize to 9-bit range (-256..255 mapped to -1..1)
      var quantized = Math.round(raw * 255) / 255;
      YM2612_SINE_TABLE.push(quantized);
    }
  })();

  // Game Boy default wavetable (32 samples, 4-bit)
  // The Game Boy's wave channel (channel 3) reads from a 32-sample RAM buffer
  // where each sample is 4 bits (0-15, giving only 16 amplitude levels).
  // This default pattern is a triangle wave. Game composers could load
  // arbitrary 32-sample waveforms, enabling crude wavetable synthesis
  // years before it became a mainstream technique. See Collins (2008), Ch. 3.
  var GB_DEFAULT_WAVE = [
    15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0,
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15
  ];

  // ============================================================
  // Default Settings
  // ============================================================

  var DEFAULT_CHIP_SETTINGS = {
    chip: 'sid',
    waveform: 'pulse',
    dutyCycle: 50,
    bitDepth: 12,
    filterType: 'lowpass',
    filterFreq: 2000,
    filterRes: 1.0,
    noiseMode: 'long',
    fmAlgorithm: 0,
    fmFeedback: 0,
    opRatios: [1.0, 2.0, 3.0, 4.0],
    opLevels: [100, 80, 60, 40],
    gbWavetable: GB_DEFAULT_WAVE.slice()
  };

  // ============================================================
  // State
  // ============================================================

  var audioContext = null;
  var isEngineReady = false;

  var scriptNodes = [null, null, null, null];
  var fallbackVoicesByInst = [[], [], [], []];
  var instrumentSettings = {};
  var chipFilterNodes = {};
  var connectedInsts = [false, false, false, false];

  // ============================================================
  // MIDI / Frequency Helpers
  // ============================================================

  function midiToFreq(midi) {
    var a4 = 440;
    var refEl = typeof document !== 'undefined' && document.getElementById('refHz');
    if (refEl) {
      a4 = parseFloat(refEl.value) || 440;
    }
    if (SL.tuning && SL.tuning.noteToFreq) {
      return SL.tuning.noteToFreq(midi, a4);
    }
    return a4 * Math.pow(2, (midi - 69) / 12);
  }

  // ============================================================
  // Bit Depth Reduction
  // ============================================================
  // Bit-depth reduction (also called bit-crushing) quantizes a continuous
  // amplitude value to a fixed number of discrete levels: levels = 2^bits.
  // Formula: output = round(sample * 2^(bits-1)) / 2^(bits-1)
  // At 8 bits: 256 levels. At 4 bits: only 16 levels (Game Boy wave channel).
  // At 1 bit: binary output (square wave regardless of input shape).
  // The quantization introduces harmonic distortion proportional to the
  // step size; fewer bits = more distortion = more "lo-fi" character.

  function reduceBitDepth(sample, bits) {
    if (bits >= 16) {
      return sample;
    }
    var levels = Math.pow(2, bits);
    var half = levels / 2;
    var safeHalf = half || 1;
    return Math.round(sample * safeHalf) / safeHalf;
  }

  // ============================================================
  // LFSR Noise Generator
  // ============================================================
  // Linear Feedback Shift Register (LFSR) noise is how the NES, Game Boy,
  // and SID generate pseudo-random noise. A shift register is clocked at
  // the oscillator frequency; at each step, two bit positions are XORed
  // and fed back into the highest bit.
  //
  // Long mode (15-bit LFSR, taps at bits 0 and 1): period = 32767 samples.
  //   Produces white-noise-like output with a very long repeat cycle.
  // Short mode (15-bit LFSR, taps at bits 0 and 6): period = 93 samples.
  //   Produces a metallic, pitched tone — used for snare drums and hi-hats
  //   on the NES. The Game Boy's noise channel uses 7-bit vs 15-bit LFSR.
  //
  // See Collins (2008), Ch. 2 on NES audio architecture.

  function LFSRNoise(shortMode) {
    this.register = 0x7FFF;
    this.shortMode = shortMode || false;
  }

  LFSRNoise.prototype.clock = function() {
    var bit0 = this.register & 1;
    var bit1;
    if (this.shortMode) {
      bit1 = (this.register >> 6) & 1;
    } else {
      bit1 = (this.register >> 1) & 1;
    }
    var feedback = bit0 ^ bit1;
    this.register = (this.register >> 1) | (feedback << 14);
    return (bit0 * 2) - 1;
  };

  // ============================================================
  // SID Waveform Generators
  // ============================================================
  // The MOS Technology 6581 SID (Sound Interface Device), designed by
  // Bob Yannes in 1982 for the Commodore 64, was revolutionary: 3 voices,
  // each with pulse/sawtooth/triangle/noise waveforms, ring modulation,
  // oscillator hard sync, and a programmable multimode resonant filter
  // (low-pass, high-pass, band-pass, notch). Yannes later founded Ensoniq.
  //
  // The SID's analog filter had notoriously inconsistent behavior across
  // chip revisions (6581 vs 8580) due to manufacturing process variations,
  // making each C64 sound slightly different. See Yannes (1982).
  //
  // Pulse wave with variable duty cycle:
  //   f(t) = sgn(sin(2*pi*f*t) - (2*duty - 1))
  //   At duty=0.5: square wave (odd harmonics only, 1/n rolloff).
  //   At duty<0.5 or >0.5: even harmonics appear, timbre thins.

  function sidPulse(phase, duty) {
    if (phase < duty) {
      return 1.0;
    }
    return -1.0;
  }

  // Sawtooth: all harmonics present at amplitudes 1/n. Bright, buzzy timbre.
  // Formula: f(phase) = 2*phase - 1, where phase in [0, 1)
  function sidSawtooth(phase) {
    return 2.0 * phase - 1.0;
  }

  // Triangle: odd harmonics only at amplitudes 1/n^2. Mellow, flute-like.
  // Softer than square because harmonics fall off as the square of n.
  function sidTriangle(phase) {
    if (phase < 0.5) {
      return 4.0 * phase - 1.0;
    }
    return 3.0 - 4.0 * phase;
  }

  // ============================================================
  // NES Waveform Generators
  // ============================================================
  // The Ricoh 2A03 (1983, Nintendo Entertainment System) integrates audio
  // into the CPU die: 2 pulse channels with variable duty (12.5%, 25%,
  // 50%, 75%), 1 triangle channel (fixed waveform), 1 noise channel
  // (LFSR-based), and 1 DPCM sample playback channel.
  //
  // The CPU master clock (1.789773 MHz NTSC) is divided down to produce
  // pitch. Each channel has an 11-bit period timer, giving a frequency
  // range of roughly 54 Hz to 12.4 kHz. See Collins (2008), Ch. 2.

  function nesPulse(phase, dutyIndex) {
    var duty = DUTY_PRESETS[dutyIndex] || 0.5;
    if (phase < duty) {
      return 1.0;
    }
    return -1.0;
  }

  // NES triangle: 4-bit resolution (16 discrete amplitude steps).
  // Unlike the pulse channels, the triangle has no volume control --
  // it is either on or off. The 4-bit quantization creates the
  // characteristic "buzzy" NES bass sound, especially at low frequencies
  // where the steps become audible as additional harmonics.
  function nesTriangle(phase) {
    // 4-bit quantized triangle (16 steps)
    var raw;
    if (phase < 0.5) {
      raw = 4.0 * phase - 1.0;
    } else {
      raw = 3.0 - 4.0 * phase;
    }
    return Math.round(raw * 7.5) / 7.5;
  }

  // ============================================================
  // Game Boy Waveform Generators
  // ============================================================
  // The Game Boy (Sharp LR35902 / DMG-CPU, 1989) has 4 sound channels:
  //   Ch 1-2: Pulse with variable duty (12.5%, 25%, 50%, 75%)
  //   Ch 3:   Programmable 4-bit wavetable (32 samples per cycle)
  //   Ch 4:   Noise (7-bit or 15-bit LFSR, selectable)
  //
  // The wavetable channel is the Game Boy's unique feature: 32 samples
  // at 4-bit depth (16 amplitude levels) stored in I/O registers at
  // FF30-FF3F. This enabled timbres impossible on NES hardware.
  // See Collins (2008), Ch. 3.

  function gbPulse(phase, dutyIndex) {
    var duty = DUTY_PRESETS[dutyIndex] || 0.5;
    if (phase < duty) {
      return 1.0;
    }
    return -1.0;
  }

  // Game Boy wave channel: 32-sample, 4-bit wavetable lookup.
  // Phase maps linearly into the 32-entry table; output is 0-15 scaled to -1..+1.
  function gbWavetable(phase, wavetable) {
    var idx = Math.floor(phase * 32) % 32;
    var sample = wavetable[idx] || 0;
    // 4-bit: 0..15 mapped to -1..1
    return (sample / 7.5) - 1.0;
  }

  // ============================================================
  // YM2612 FM Synthesis
  // ============================================================
  // The Yamaha YM2612 (OPN2) powered the Sega Genesis/Mega Drive (1988).
  // It implements 4-operator FM synthesis per channel with 8 algorithms,
  // derived from Yamaha's DX technology (Chowning, 1973). The DX7 used
  // 6 operators; the YM2612 uses 4, trading some timbral complexity for
  // lower cost. FM synthesis formula for a single modulator-carrier pair:
  //   output(t) = A * sin(2*pi*fc*t + I * sin(2*pi*fm*t))
  // where fc = carrier freq, fm = modulator freq, I = modulation index.
  // The ratio fm/fc determines which harmonics appear; I controls their
  // amplitude. See Roads (1996), Ch. 6 on FM synthesis theory.

  function ym2612Sine(phase) {
    var idx = Math.floor(phase * 512) % 512;
    if (idx < 0) {
      idx += 512;
    }
    return YM2612_SINE_TABLE[idx];
  }

  // The YM2612's 9-bit internal DAC has a known hardware defect: its
  // resistor ladder produces non-linear voltage steps, especially near
  // zero-crossing, creating a characteristic "gritty" distortion that
  // became the signature Genesis sound. This is the "ladder effect."
  function ym2612DacLadder(sample) {
    // DAC ladder effect: intentional distortion from imperfect D/A conversion
    // Simulates the non-linear steps of the YM2612's internal DAC
    var sign = (sample >= 0) ? 1.0 : -1.0;
    var abs = Math.abs(sample);
    // Non-linear quantization with slight compression in upper range
    var quantized = Math.floor(abs * 255) / 255;
    // Add slight asymmetric distortion
    var ladderEffect = quantized + 0.008 * quantized * quantized;
    if (ladderEffect > 1.0) {
      ladderEffect = 1.0;
    }
    return sign * ladderEffect;
  }

  // ============================================================
  // Chip Voice
  // ============================================================

  function ChipVoice(sr) {
    this.sampleRate = sr;
    this.active = false;
    this.midiNote = -1;
    this.instId = 0;
    this.baseFreq = 440;
    this.velocity = 1.0;

    // Oscillator phases (4 ops for FM, 1 main + noise)
    this.phase = 0;
    this.phaseInc = 0;
    this.opPhases = [0, 0, 0, 0];
    this.opPhaseIncs = [0, 0, 0, 0];

    // Chip parameters
    this.chip = 'sid';
    this.waveform = 'pulse';
    this.dutyCycle = 0.5;
    this.bitDepth = 12;
    this.noiseMode = 'long';
    this.fmAlgorithm = 0;
    this.fmFeedback = 0;
    this.opRatios = [1.0, 2.0, 3.0, 4.0];
    this.opLevels = [1.0, 0.8, 0.6, 0.4];
    this.gbWavetable = GB_DEFAULT_WAVE.slice();

    // Noise generator
    this.lfsr = new LFSRNoise(false);
    this.noisePhase = 0;
    this.noisePhaseInc = 0;
    this.lastNoiseSample = 0;

    // FM feedback state
    this.fbPrev1 = 0;
    this.fbPrev2 = 0;

    // Amplitude ADSR
    this.envStage = 0;
    this.envLevel = 0;
    this.envReleased = false;
    this.envFinished = false;
    this.attackRate = 0;
    this.decayRate = 0;
    this.sustainLevel = 0.7;
    this.releaseRate = 0;

    // Fade-in
    this.fadeInSamples = 0;
    this.fadeInCounter = 0;

    // Humanization
    this.startDelaySamples = 0;
  }

  ChipVoice.prototype.noteOn = function(midi, vel, freq, settings) {
    this.active = true;
    this.midiNote = midi;
    this.baseFreq = freq;
    this.instId = settings.instId || 0;
    this.envStage = 0;
    this.envLevel = 0;
    this.envReleased = false;
    this.envFinished = false;
    this.phase = 0;

    // Chip parameters
    this.chip = settings.chip || 'sid';
    this.waveform = settings.waveform || 'pulse';
    this.dutyCycle = Math.max(0, Math.min(1, (settings.dutyCycle || 50) / 100));
    this.bitDepth = settings.bitDepth || 12;
    this.noiseMode = settings.noiseMode || 'long';
    this.fmAlgorithm = settings.fmAlgorithm || 0;
    this.fmFeedback = (settings.fmFeedback || 0) / 100;
    this.opRatios = settings.opRatios ? settings.opRatios.slice() : [1.0, 2.0, 3.0, 4.0];
    this.opLevels = [];
    var rawLevels = settings.opLevels || [100, 80, 60, 40];
    for (var ol = 0; ol < 4; ol++) {
      this.opLevels[ol] = (rawLevels[ol] || 0) / 100;
    }
    this.gbWavetable = settings.gbWavetable ? settings.gbWavetable.slice() : GB_DEFAULT_WAVE.slice();

    this.phaseInc = freq / this.sampleRate;

    // Set up operator phase increments for FM
    for (var op = 0; op < 4; op++) {
      this.opPhases[op] = 0;
      this.opPhaseIncs[op] = (freq * this.opRatios[op]) / this.sampleRate;
    }

    // Noise setup
    this.lfsr = new LFSRNoise(this.noiseMode === 'short');
    this.noisePhase = 0;
    this.lastNoiseSample = 0;

    // Determine noise rate based on chip
    if (this.chip === 'nes') {
      this.noisePhaseInc = freq / this.sampleRate;
    } else if (this.chip === 'gameboy') {
      this.noisePhaseInc = freq / this.sampleRate;
    } else if (this.chip === 'sid') {
      this.noisePhaseInc = freq / this.sampleRate;
    } else {
      this.noisePhaseInc = freq / this.sampleRate;
    }

    // Reset FM feedback
    this.fbPrev1 = 0;
    this.fbPrev2 = 0;

    // Velocity with humanization
    var humVelocity = settings.humVelocity || 0;
    var velRange = Math.round(humVelocity * 1.2);
    var randomizedVel = vel;
    if (velRange > 0) {
      randomizedVel = vel + Math.round((Math.random() * 2 - 1) * velRange);
      if (randomizedVel < 1) { randomizedVel = 1; }
      if (randomizedVel > 127) { randomizedVel = 127; }
    }
    this.velocity = randomizedVel / 127;

    // Fade-in
    this.fadeInSamples = Math.ceil(this.sampleRate * 0.005);
    this.fadeInCounter = 0;

    // Timing stagger
    var humTiming = settings.humTiming || 0;
    if (humTiming > 0) {
      var maxDelay = Math.round(humTiming * 0.15 * this.sampleRate / 1000);
      this.startDelaySamples = Math.round(Math.random() * maxDelay);
    } else {
      this.startDelaySamples = 0;
    }

    // Amplitude ADSR from instrument settings
    var adsr = settings.adsr || { a: 0.01, d: 0.1, s: 0.7, r: 0.2 };
    var humAdsr = settings.humAdsr || 0;
    var aTime = adsr.a;
    var dTime = adsr.d;
    var sLevel = adsr.s;
    var rTime = adsr.r;

    if (humAdsr > 0) {
      var jA = 1 + (Math.random() * 2 - 1) * humAdsr * 0.015;
      var jD = 1 + (Math.random() * 2 - 1) * humAdsr * 0.015;
      var jR = 1 + (Math.random() * 2 - 1) * humAdsr * 0.015;
      aTime = Math.max(0.001, aTime * jA);
      dTime = Math.max(0.001, dTime * jD);
      rTime = Math.max(0.001, rTime * jR);
    }

    var safeAttack = Math.max(0.001, aTime);
    var safeDecay = Math.max(0.001, dTime);
    var safeRelease = Math.max(0.001, rTime);
    this.attackRate = 1.0 / (safeAttack * this.sampleRate);
    this.decayRate = 1.0 / (safeDecay * this.sampleRate);
    this.sustainLevel = sLevel;
    this.releaseRate = 1.0 / (safeRelease * this.sampleRate);
  };

  ChipVoice.prototype.noteOff = function() {
    if (!this.envFinished) {
      this.envReleased = true;
      this.envStage = 3;
    }
  };

  ChipVoice.prototype.processEnvelope = function() {
    if (this.envFinished) {
      return 0;
    }

    if (this.envStage === 0) {
      this.envLevel += this.attackRate;
      if (this.envLevel >= 1.0) {
        this.envLevel = 1.0;
        this.envStage = 1;
      }
    } else if (this.envStage === 1) {
      this.envLevel -= this.decayRate * (1.0 - this.sustainLevel);
      if (this.envLevel <= this.sustainLevel) {
        this.envLevel = this.sustainLevel;
        this.envStage = 2;
      }
    } else if (this.envStage === 2) {
      // Sustain - hold level
    } else if (this.envStage === 3) {
      this.envLevel -= this.releaseRate * this.envLevel;
      if (this.envLevel <= 0.0001) {
        this.envLevel = 0;
        this.envFinished = true;
      }
    }

    return this.envLevel;
  };

  // ============================================================
  // Per-chip Sample Generation
  // ============================================================
  // Each chip model has a dedicated generator that faithfully recreates
  // the hardware's waveform generation, bit depth, and quantization
  // characteristics. The phase accumulator pattern is shared across all
  // models but the output processing differs per chip.

  ChipVoice.prototype.generateSID = function() {
    var sample = 0;
    if (this.waveform === 'pulse') {
      sample = sidPulse(this.phase, this.dutyCycle);
    } else if (this.waveform === 'sawtooth') {
      sample = sidSawtooth(this.phase);
    } else if (this.waveform === 'triangle') {
      sample = sidTriangle(this.phase);
    } else if (this.waveform === 'noise') {
      // LFSR noise clocked at oscillator frequency
      this.noisePhase += this.noisePhaseInc;
      if (this.noisePhase >= 1.0) {
        this.noisePhase -= Math.floor(this.noisePhase);
        this.lastNoiseSample = this.lfsr.clock();
      }
      sample = this.lastNoiseSample;
    } else {
      // Default to pulse
      sample = sidPulse(this.phase, this.dutyCycle);
    }

    // SID bit depth: 12-bit (the 6581 uses 12-bit internal D/A conversion)
    sample = reduceBitDepth(sample, this.bitDepth);

    this.phase += this.phaseInc;
    if (this.phase >= 1.0) {
      this.phase -= Math.floor(this.phase);
    }

    return sample;
  };

  ChipVoice.prototype.generateNES = function() {
    var sample = 0;
    if (PULSE_WAVEFORMS[this.waveform]) {
      var dutyIdx = 2; // default 50%
      if (this.dutyCycle <= 0.15) {
        dutyIdx = 0; // 12.5%
      } else if (this.dutyCycle <= 0.35) {
        dutyIdx = 1; // 25%
      } else if (this.dutyCycle <= 0.6) {
        dutyIdx = 2; // 50%
      } else {
        dutyIdx = 3; // 75%
      }
      sample = nesPulse(this.phase, dutyIdx);
    } else if (this.waveform === 'triangle') {
      sample = nesTriangle(this.phase);
    } else if (this.waveform === 'noise') {
      this.noisePhase += this.noisePhaseInc;
      if (this.noisePhase >= 1.0) {
        this.noisePhase -= Math.floor(this.noisePhase);
        this.lastNoiseSample = this.lfsr.clock();
      }
      sample = this.lastNoiseSample;
    } else {
      sample = nesPulse(this.phase, 2);
    }

    // NES bit depth: 8-bit
    sample = reduceBitDepth(sample, this.bitDepth);

    this.phase += this.phaseInc;
    if (this.phase >= 1.0) {
      this.phase -= Math.floor(this.phase);
    }

    return sample;
  };

  ChipVoice.prototype.generateGameBoy = function() {
    var sample = 0;
    if (PULSE_WAVEFORMS[this.waveform]) {
      var dutyIdx = 2; // default 50%
      if (this.dutyCycle <= 0.15) {
        dutyIdx = 0;
      } else if (this.dutyCycle <= 0.35) {
        dutyIdx = 1;
      } else if (this.dutyCycle <= 0.6) {
        dutyIdx = 2;
      } else {
        dutyIdx = 3;
      }
      sample = gbPulse(this.phase, dutyIdx);
    } else if (this.waveform === 'wave') {
      sample = gbWavetable(this.phase, this.gbWavetable);
    } else if (this.waveform === 'noise') {
      this.noisePhase += this.noisePhaseInc;
      if (this.noisePhase >= 1.0) {
        this.noisePhase -= Math.floor(this.noisePhase);
        this.lastNoiseSample = this.lfsr.clock();
      }
      sample = this.lastNoiseSample;
    } else {
      sample = gbPulse(this.phase, 2);
    }

    // GB bit depth: 8-bit (4-bit for wave channel)
    sample = reduceBitDepth(sample, this.bitDepth);

    this.phase += this.phaseInc;
    if (this.phase >= 1.0) {
      this.phase -= Math.floor(this.phase);
    }

    return sample;
  };

  ChipVoice.prototype.generateGenesis = function() {
    var sample = 0;
    var algo = YM2612_ALGORITHMS[this.fmAlgorithm] || YM2612_ALGORITHMS[0];

    // 4-operator FM synthesis with YM2612 quirks
    var opOutputs = [0, 0, 0, 0];

    // Operator 1 (with optional feedback)
    // Self-feedback on op1: the operator modulates itself using the average
    // of its two previous output samples. This creates a sawtooth-like
    // waveform from a pure sine, controllable via the feedback parameter.
    // The YM2612 hardware implements this as a 2-sample delay line.
    var fbMod = 0;
    if (this.fmFeedback > 0) {
      fbMod = (this.fbPrev1 + this.fbPrev2) * 0.5 * this.fmFeedback;
    }
    var op1Phase = this.opPhases[0] + fbMod;
    opOutputs[0] = ym2612Sine(op1Phase) * this.opLevels[0];

    // Algorithm-dependent routing
    if (this.fmAlgorithm === 0) {
      // Serial: op1->op2->op3->op4
      opOutputs[1] = ym2612Sine(this.opPhases[1] + opOutputs[0]) * this.opLevels[1];
      opOutputs[2] = ym2612Sine(this.opPhases[2] + opOutputs[1]) * this.opLevels[2];
      opOutputs[3] = ym2612Sine(this.opPhases[3] + opOutputs[2]) * this.opLevels[3];
      sample = opOutputs[3];
    } else if (this.fmAlgorithm === 1) {
      // (op1+op2)->op3->op4
      opOutputs[1] = ym2612Sine(this.opPhases[1]) * this.opLevels[1];
      opOutputs[2] = ym2612Sine(this.opPhases[2] + opOutputs[0] + opOutputs[1]) * this.opLevels[2];
      opOutputs[3] = ym2612Sine(this.opPhases[3] + opOutputs[2]) * this.opLevels[3];
      sample = opOutputs[3];
    } else if (this.fmAlgorithm === 2) {
      // op2->op3, (op1+op3)->op4
      opOutputs[1] = ym2612Sine(this.opPhases[1]) * this.opLevels[1];
      opOutputs[2] = ym2612Sine(this.opPhases[2] + opOutputs[1]) * this.opLevels[2];
      opOutputs[3] = ym2612Sine(this.opPhases[3] + opOutputs[0] + opOutputs[2]) * this.opLevels[3];
      sample = opOutputs[3];
    } else if (this.fmAlgorithm === 3) {
      // op1->op2, (op2+op3)->op4
      opOutputs[1] = ym2612Sine(this.opPhases[1] + opOutputs[0]) * this.opLevels[1];
      opOutputs[2] = ym2612Sine(this.opPhases[2]) * this.opLevels[2];
      opOutputs[3] = ym2612Sine(this.opPhases[3] + opOutputs[1] + opOutputs[2]) * this.opLevels[3];
      sample = opOutputs[3];
    } else if (this.fmAlgorithm === 4) {
      // op1->op2, op3->op4, both carriers
      opOutputs[1] = ym2612Sine(this.opPhases[1] + opOutputs[0]) * this.opLevels[1];
      opOutputs[2] = ym2612Sine(this.opPhases[2]) * this.opLevels[2];
      opOutputs[3] = ym2612Sine(this.opPhases[3] + opOutputs[2]) * this.opLevels[3];
      sample = (opOutputs[1] + opOutputs[3]) * 0.5;
    } else if (this.fmAlgorithm === 5) {
      // op1 modulates all, op2+op3+op4 carriers
      opOutputs[1] = ym2612Sine(this.opPhases[1] + opOutputs[0]) * this.opLevels[1];
      opOutputs[2] = ym2612Sine(this.opPhases[2] + opOutputs[0]) * this.opLevels[2];
      opOutputs[3] = ym2612Sine(this.opPhases[3] + opOutputs[0]) * this.opLevels[3];
      sample = (opOutputs[1] + opOutputs[2] + opOutputs[3]) * 0.333;
    } else if (this.fmAlgorithm === 6) {
      // op1->op2, op3, op4 all carriers
      opOutputs[1] = ym2612Sine(this.opPhases[1] + opOutputs[0]) * this.opLevels[1];
      opOutputs[2] = ym2612Sine(this.opPhases[2]) * this.opLevels[2];
      opOutputs[3] = ym2612Sine(this.opPhases[3]) * this.opLevels[3];
      sample = (opOutputs[1] + opOutputs[2] + opOutputs[3]) * 0.333;
    } else if (this.fmAlgorithm === 7) {
      // All 4 operators as carriers
      opOutputs[1] = ym2612Sine(this.opPhases[1]) * this.opLevels[1];
      opOutputs[2] = ym2612Sine(this.opPhases[2]) * this.opLevels[2];
      opOutputs[3] = ym2612Sine(this.opPhases[3]) * this.opLevels[3];
      sample = (opOutputs[0] + opOutputs[1] + opOutputs[2] + opOutputs[3]) * 0.25;
    }

    // Update feedback history
    this.fbPrev2 = this.fbPrev1;
    this.fbPrev1 = opOutputs[0];

    // Advance operator phases
    for (var op = 0; op < 4; op++) {
      this.opPhases[op] += this.opPhaseIncs[op];
      if (this.opPhases[op] >= 1.0) {
        this.opPhases[op] -= Math.floor(this.opPhases[op]);
      }
    }

    // DAC ladder effect
    sample = ym2612DacLadder(sample);

    // Genesis bit depth: 9-bit (the YM2612's internal DAC resolution)
    sample = reduceBitDepth(sample, this.bitDepth);

    return sample;
  };

  ChipVoice.prototype.process = function() {
    if (!this.active) {
      return 0;
    }

    if (this.startDelaySamples > 0) {
      this.startDelaySamples--;
      return 0;
    }

    var env = this.processEnvelope();
    if (this.envFinished) {
      this.active = false;
      return 0;
    }

    var sample = 0;
    if (this.chip === 'sid') {
      sample = this.generateSID();
    } else if (this.chip === 'nes') {
      sample = this.generateNES();
    } else if (this.chip === 'gameboy') {
      sample = this.generateGameBoy();
    } else if (this.chip === 'genesis') {
      sample = this.generateGenesis();
    } else {
      sample = this.generateSID();
    }

    sample *= env * this.velocity;

    // Fade-in ramp
    if (this.fadeInCounter < this.fadeInSamples) {
      sample *= this.fadeInCounter / this.fadeInSamples;
      this.fadeInCounter++;
    }

    return sample;
  };

  ChipVoice.prototype.isFinished = function() {
    return this.envFinished;
  };

  // ============================================================
  // Engine Initialization
  // ============================================================

  function init(ctx) {
    audioContext = ctx || (SL.audio && SL.audio.getCtx ? SL.audio.getCtx() : null);
    if (!audioContext) {
      console.error('[CHIP] No AudioContext available');
      return Promise.reject(new Error('No AudioContext'));
    }

    return initFallback();
  }

  function initFallback() {
    var sr = audioContext.sampleRate;
    var bufSize = (SL.audio && SL.audio.getScriptProcessorBufferSize) ? SL.audio.getScriptProcessorBufferSize() : 1024;

    for (var i = 0; i < 4; i++) {
      fallbackVoicesByInst[i].length = 0;
      for (var v = 0; v < MAX_VOICES_PER_INSTRUMENT; v++) {
        fallbackVoicesByInst[i].push(new ChipVoice(sr));
      }
    }

    for (var idx = 0; idx < 4; idx++) {
      (function(instIdx) {
        var node = audioContext.createScriptProcessor(bufSize, 0, 1);
        var voices = fallbackVoicesByInst[instIdx];
        node.onaudioprocess = function(event) {
          var output = event.outputBuffer.getChannelData(0);

          // Update chip parameters from settings for active voices
          var settings = getOrCreateSettings(instIdx);
          for (var vi = 0; vi < voices.length; vi++) {
            if (voices[vi].active) {
              voices[vi].chip = settings.chip || 'sid';
              voices[vi].waveform = settings.waveform || 'pulse';
              voices[vi].dutyCycle = Math.max(0, Math.min(1, (settings.dutyCycle || 50) / 100));
              voices[vi].bitDepth = settings.bitDepth || 12;
            }
          }

          for (var s = 0; s < output.length; s++) {
            var sample = 0;
            for (var vi2 = 0; vi2 < voices.length; vi2++) {
              if (voices[vi2].active) {
                sample += voices[vi2].process() * 0.15;
              }
            }
            // Soft clip using a rational sigmoid: f(x) = x*(27+x^2)/(27+9*x^2)
            // This approximates tanh(x) cheaply, preventing harsh digital clipping
            // when multiple voices sum beyond [-1, 1].
            var ss = sample * sample;
            output[s] = sample * (27 + ss) / (27 + 9 * ss);
          }
        };
        scriptNodes[instIdx] = node;
      })(idx);
    }

    isEngineReady = true;
    return Promise.resolve(true);
  }

  // ============================================================
  // Connection Management
  // ============================================================

  function getOrCreateFilterNode(instId) {
    if (!audioContext) {
      return null;
    }
    if (!chipFilterNodes[instId]) {
      var node = audioContext.createBiquadFilter();
      node.type = 'lowpass';
      node.frequency.value = 20000;
      node.Q.value = 0.707;
      chipFilterNodes[instId] = node;
    }
    return chipFilterNodes[instId];
  }

  function updateFilter(instId) {
    if (instId === undefined) {
      instId = 0;
    }
    var filterNode = chipFilterNodes[instId];
    if (filterNode) {
      var filterSettings = SL.audio && SL.audio.getFilterSettings ? SL.audio.getFilterSettings() : null;
      if (!filterSettings || !filterSettings.enabled) {
        filterNode.type = 'lowpass';
        filterNode.frequency.value = 20000;
        filterNode.Q.value = 0.707;
      } else {
        filterNode.type = filterSettings.type || 'lowpass';
        filterNode.frequency.value = Math.max(20, Math.min(20000, filterSettings.frequency || 20000));
        filterNode.Q.value = Math.max(0.1, Math.min(30, filterSettings.resonance || 1));
      }
    }
  }

  function connectToOutput(instId) {
    if (scriptNodes[instId]) {
      if (connectedInsts[instId]) {
        updateFilter(instId);
      } else {
        var instruments = SL.audio && SL.audio.getInstruments ? SL.audio.getInstruments() : null;
        var inst = instruments ? instruments[instId] : null;
        var destination;

        if (inst && inst.masterOutput) {
          destination = inst.masterOutput;
        } else if (audioContext) {
          destination = audioContext.destination;
        }

        if (destination) {
          var filterNode = getOrCreateFilterNode(instId);
          updateFilter(instId);

          if (filterNode) {
            scriptNodes[instId].connect(filterNode);
            filterNode.connect(destination);
          } else {
            scriptNodes[instId].connect(destination);
          }

          connectedInsts[instId] = true;
        }
      }
    }
  }

  // ============================================================
  // Settings Management
  // ============================================================

  function getOrCreateSettings(instId) {
    if (!instrumentSettings[instId]) {
      instrumentSettings[instId] = JSON.parse(JSON.stringify(DEFAULT_CHIP_SETTINGS));
    }
    return instrumentSettings[instId];
  }

  function getSettings(instId) {
    return JSON.parse(JSON.stringify(getOrCreateSettings(instId)));
  }

  function setSettings(instId, settings) {
    instrumentSettings[instId] = JSON.parse(JSON.stringify(settings));
  }

  function getDefaultSettings() {
    return JSON.parse(JSON.stringify(DEFAULT_CHIP_SETTINGS));
  }

  // ============================================================
  // Note On / Off
  // ============================================================

  function noteOn(midi, velocity, instId) {
    if (instId === undefined) {
      instId = 0;
    }
    velocity = velocity || 100;

    var settings = getOrCreateSettings(instId);
    var noteFreq = midiToFreq(midi);

    connectToOutput(instId);

    // Read humanization
    var instruments = SL.audio.getInstruments();
    var rawHum = (instruments && instruments[instId]) ? (instruments[instId].settings.humanization || {}) : {};
    var humVelocity = (typeof rawHum === 'number') ? rawHum : (rawHum.velocity || 0);
    var humAdsr = (typeof rawHum === 'number') ? rawHum : (rawHum.adsr || 0);
    var humTiming = (typeof rawHum === 'number') ? 0 : (rawHum.timing || 0);

    // Get amplitude ADSR from instrument settings
    var instSettings = instruments[instId].settings;
    var adsrRaw = instSettings.adsr || { a: 10, d: 100, s: 70, r: 200 };
    var sliderToTime = SL.audio.sliderToTime;
    var adsr = {
      a: sliderToTime(adsrRaw.a, 500, 500) / 1000,
      d: sliderToTime(adsrRaw.d, 500, 500) / 1000,
      s: adsrRaw.s / 100,
      r: sliderToTime(adsrRaw.r, 1000, 1000) / 1000
    };

    var voiceSettings = {
      instId: instId,
      chip: settings.chip,
      waveform: settings.waveform,
      dutyCycle: settings.dutyCycle,
      bitDepth: settings.bitDepth,
      noiseMode: settings.noiseMode,
      fmAlgorithm: settings.fmAlgorithm,
      fmFeedback: settings.fmFeedback,
      opRatios: settings.opRatios,
      opLevels: settings.opLevels,
      gbWavetable: settings.gbWavetable,
      adsr: adsr,
      humVelocity: humVelocity,
      humAdsr: humAdsr,
      humTiming: humTiming
    };

    // Find free voice or steal oldest
    var voices = fallbackVoicesByInst[instId];
    var voice = null;
    for (var i = 0; i < voices.length; i++) {
      if (!voices[i].active) {
        voice = voices[i];
        break;
      }
    }
    if (!voice) {
      voice = voices[0];
    }
    voice.noteOn(midi, velocity, noteFreq, voiceSettings);
  }

  function noteOff(midi, instId) {
    if (instId === undefined) {
      instId = 0;
    }

    var voices = fallbackVoicesByInst[instId];
    for (var i = 0; i < voices.length; i++) {
      var v = voices[i];
      if (v.active && v.midiNote === midi) {
        v.noteOff();
      }
    }
  }

  // ============================================================
  // Parameter Control
  // ============================================================

  function setChipMode(instId, chip) {
    var settings = getOrCreateSettings(instId);
    if (VALID_CHIP_MODES[chip]) {
      settings.chip = chip;
      // Set default bit depths per chip
      if (chip === 'sid') {
        settings.bitDepth = 12;
      } else if (chip === 'nes') {
        settings.bitDepth = 8;
      } else if (chip === 'gameboy') {
        settings.bitDepth = 8;
      } else if (chip === 'genesis') {
        settings.bitDepth = 9;
      }
    }
  }

  function setWaveform(instId, waveform) {
    var settings = getOrCreateSettings(instId);
    settings.waveform = waveform;
  }

  function setDutyCycle(instId, duty) {
    var settings = getOrCreateSettings(instId);
    settings.dutyCycle = Math.max(0, Math.min(100, duty));
  }

  function setBitDepth(instId, bits) {
    var settings = getOrCreateSettings(instId);
    settings.bitDepth = Math.max(1, Math.min(16, bits));
  }

  function setNoiseMode(instId, mode) {
    var settings = getOrCreateSettings(instId);
    settings.noiseMode = mode;
  }

  function setFmAlgorithm(instId, algo) {
    var settings = getOrCreateSettings(instId);
    settings.fmAlgorithm = Math.max(0, Math.min(7, algo));
  }

  function setFmFeedback(instId, fb) {
    var settings = getOrCreateSettings(instId);
    settings.fmFeedback = Math.max(0, Math.min(100, fb));
  }

  // ============================================================
  // Utility
  // ============================================================

  function allNotesOff(instId) {
    if (instId !== undefined) {
      var voices = fallbackVoicesByInst[instId];
      for (var i = 0; i < voices.length; i++) {
        if (voices[i].active) {
          voices[i].noteOff();
        }
      }
    } else {
      for (var idx = 0; idx < 4; idx++) {
        var pool = fallbackVoicesByInst[idx];
        for (var j = 0; j < pool.length; j++) {
          if (pool[j].active) {
            pool[j].noteOff();
          }
        }
      }
    }
  }

  function isReady() {
    return isEngineReady;
  }

  // ============================================================
  // Export to SynthLab Namespace
  // ============================================================

  SL.chip = {
    // Initialization
    init: init,
    isReady: isReady,

    // Note control
    noteOn: noteOn,
    noteOff: noteOff,
    allNotesOff: allNotesOff,

    // Parameter control
    setChipMode: setChipMode,
    setWaveform: setWaveform,
    setDutyCycle: setDutyCycle,
    setBitDepth: setBitDepth,
    setNoiseMode: setNoiseMode,
    setFmAlgorithm: setFmAlgorithm,
    setFmFeedback: setFmFeedback,

    // Settings management
    getSettings: getSettings,
    setSettings: setSettings,
    getDefaultSettings: getDefaultSettings,

    // Connection & filter
    connectToOutput: connectToOutput,
    updateFilter: updateFilter,

    // Constants
    DEFAULT_CHIP_SETTINGS: DEFAULT_CHIP_SETTINGS,
    MAX_VOICES_PER_INSTRUMENT: MAX_VOICES_PER_INSTRUMENT,
    CHIP_MODES: CHIP_MODES,
    YM2612_ALGORITHMS: YM2612_ALGORITHMS
  };

})();
