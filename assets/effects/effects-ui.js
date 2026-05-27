// Synth Lab - Effects UI Module
// Handles effects tab UI, parameter controls, and chain reordering

(function() {
  var SL = window.SynthLab = window.SynthLab || {};

  // Sentinel constants
  var NOT_FOUND = -1;
  var MASTER_TARGET = -1;

  // Effect metadata for UI generation
  var EFFECT_META = {
    distortion: {
      name: 'Distortion',
      i18n: 'effect.distortion',
      icon: '🔥',
      params: [
        { name: 'drive', label: 'Drive', min: 0, max: 100, default: 50, unit: '%' },
        { name: 'tone', label: 'Tone', min: 200, max: 8000, default: 4000, unit: 'Hz', log: true },
        { name: 'type', label: 'Type', type: 'select', options: ['soft', 'hard', 'fuzz', 'tube', 'wavefold', 'bitcrush', 'tape'], default: 'soft' },
        { name: 'folds', label: 'Folds', min: 1, max: 8, default: 4, unit: '', step: 1, showWhen: { type: 'wavefold' } },
        { name: 'bits', label: 'Bits', min: 1, max: 16, default: 8, unit: '', step: 1, showWhen: { type: 'bitcrush' } },
        { name: 'mix', label: 'Mix', min: 0, max: 100, default: 50, unit: '%' }
      ]
    },
    chorus: {
      name: 'Chorus',
      i18n: 'effect.chorus',
      icon: '🌊',
      params: [
        { name: 'mode', label: 'Mode', type: 'select', options: ['I', 'II', 'I+II'], default: 'I' },
        { name: 'rate', label: 'Rate', min: 0.5, max: 2.0, default: 1.0, unit: 'x', step: 0.05 },
        { name: 'depth', label: 'Depth', min: 0, max: 100, default: 50, unit: '%' },
        { name: 'mix', label: 'Mix', min: 0, max: 100, default: 50, unit: '%' }
      ]
    },
    delay: {
      name: 'Delay',
      i18n: 'effect.delay',
      icon: '📢',
      params: [
        { name: 'algorithm', label: 'Type', type: 'select', options: ['digital', 'tape', 'analog', 'pingpong', 'multitap', 'ducking'], default: 'digital' },
        { name: 'time', label: 'Time', min: 10, max: 2000, default: 300, unit: 'ms' },
        { name: 'feedback', label: 'Feedback', min: 0, max: 95, default: 40, unit: '%' },
        // Tape algorithm params
        { name: 'wow', label: 'Wow', min: 0, max: 100, default: 20, unit: '%', showWhen: { algorithm: 'tape' } },
        { name: 'flutter', label: 'Flutter', min: 0, max: 100, default: 30, unit: '%', showWhen: { algorithm: 'tape' } },
        { name: 'flutterRate', label: 'Flut Rate', min: 0.5, max: 3, default: 1.5, unit: 'Hz', step: 0.1, showWhen: { algorithm: 'tape' } },
        { name: 'saturation', label: 'Saturation', min: 0, max: 100, default: 30, unit: '%', showWhen: { algorithm: 'tape' } },
        { name: 'tapeTone', label: 'Tone', min: 3000, max: 8000, default: 5000, unit: 'Hz', showWhen: { algorithm: 'tape' } },
        // Analog BBD algorithm params
        { name: 'bbdTone', label: 'Tone', min: 2000, max: 5000, default: 3500, unit: 'Hz', showWhen: { algorithm: 'analog' } },
        { name: 'noise', label: 'Noise', min: 0, max: 100, default: 10, unit: '%', showWhen: { algorithm: 'analog' } },
        // Ping-Pong algorithm params
        { name: 'width', label: 'Width', min: 0, max: 100, default: 100, unit: '%', showWhen: { algorithm: 'pingpong' } },
        { name: 'offset', label: 'Offset', min: 0, max: 100, default: 50, unit: '%', showWhen: { algorithm: 'pingpong' } },
        // Multi-Tap algorithm params
        { name: 'pattern', label: 'Pattern', type: 'select', options: ['rhythmic', 'golden', 'fibonacci', 'custom'], default: 'rhythmic', showWhen: { algorithm: 'multitap' } },
        { name: 'tap1Time', label: 'Tap 1', min: 10, max: 2000, default: 150, unit: 'ms', showWhen: { algorithm: 'multitap' } },
        { name: 'tap2Time', label: 'Tap 2', min: 10, max: 2000, default: 300, unit: 'ms', showWhen: { algorithm: 'multitap' } },
        { name: 'tap3Time', label: 'Tap 3', min: 10, max: 2000, default: 450, unit: 'ms', showWhen: { algorithm: 'multitap' } },
        { name: 'tap4Time', label: 'Tap 4', min: 10, max: 2000, default: 600, unit: 'ms', showWhen: { algorithm: 'multitap' } },
        { name: 'tap1Level', label: 'Lvl 1', min: 0, max: 100, default: 100, unit: '%', showWhen: { algorithm: 'multitap' } },
        { name: 'tap2Level', label: 'Lvl 2', min: 0, max: 100, default: 80, unit: '%', showWhen: { algorithm: 'multitap' } },
        { name: 'tap3Level', label: 'Lvl 3', min: 0, max: 100, default: 60, unit: '%', showWhen: { algorithm: 'multitap' } },
        { name: 'tap4Level', label: 'Lvl 4', min: 0, max: 100, default: 40, unit: '%', showWhen: { algorithm: 'multitap' } },
        // Ducking algorithm params
        { name: 'duckThreshold', label: 'Thresh', min: -60, max: 0, default: -24, unit: 'dB', showWhen: { algorithm: 'ducking' } },
        { name: 'duckAmount', label: 'Duck Amt', min: 0, max: 100, default: 80, unit: '%', showWhen: { algorithm: 'ducking' } },
        { name: 'duckAttack', label: 'Attack', min: 1, max: 100, default: 10, unit: 'ms', showWhen: { algorithm: 'ducking' } },
        { name: 'duckRelease', label: 'Release', min: 50, max: 1000, default: 300, unit: 'ms', showWhen: { algorithm: 'ducking' } },
        // Common damping (for digital)
        { name: 'damping', label: 'Damping', min: 0, max: 100, default: 20, unit: '%', showWhen: { algorithm: 'digital' } },
        { name: 'mix', label: 'Mix', min: 0, max: 100, default: 25, unit: '%' }
      ]
    },
    reverb: {
      name: 'Reverb',
      i18n: 'effect.reverb',
      icon: '🏛️',
      params: [
        { name: 'algorithm', label: 'Type', type: 'select',
          options: ['convolution', 'room', 'plate', 'hall', 'spring', 'shimmer'],
          default: 'convolution' },
        { name: 'size', label: 'Size', min: 0, max: 100, default: 50, unit: '%' },
        { name: 'decay', label: 'Decay', min: 0, max: 100, default: 50, unit: '%' },
        { name: 'damping', label: 'Damping', min: 0, max: 100, default: 30, unit: '%' },
        { name: 'predelay', label: 'Pre-Dly', min: 0, max: 200, default: 10, unit: 'ms' },
        // Room-specific params
        { name: 'width', label: 'Width', min: 0, max: 100, default: 100, unit: '%',
          showWhen: { algorithm: 'room' } },
        // Plate-specific params
        { name: 'diffusion', label: 'Diffuse', min: 0, max: 100, default: 50, unit: '%',
          showWhen: { algorithm: 'plate' } },
        { name: 'modulation', label: 'Mod', min: 0, max: 100, default: 30, unit: '%',
          showWhen: { algorithm: 'plate' } },
        // Hall-specific params
        { name: 'lowDecay', label: 'Low Dcy', min: 0, max: 100, default: 50, unit: '%',
          showWhen: { algorithm: 'hall' } },
        { name: 'highDecay', label: 'Hi Dcy', min: 0, max: 100, default: 50, unit: '%',
          showWhen: { algorithm: 'hall' } },
        // Spring-specific params
        { name: 'tension', label: 'Tension', min: 0, max: 100, default: 50, unit: '%',
          showWhen: { algorithm: 'spring' } },
        { name: 'springDiffusion', label: 'Diffuse', min: 0, max: 100, default: 50, unit: '%',
          showWhen: { algorithm: 'spring' } },
        // Shimmer-specific params
        { name: 'shimmerPitch', label: 'Pitch', min: 0, max: 24, default: 12, unit: 'st', step: 1,
          showWhen: { algorithm: 'shimmer' } },
        { name: 'shimmerAmount', label: 'Shimmer', min: 0, max: 100, default: 50, unit: '%',
          showWhen: { algorithm: 'shimmer' } },
        { name: 'mix', label: 'Mix', min: 0, max: 100, default: 30, unit: '%' }
      ]
    },
    bitcrush: {
      name: 'Bitcrush',
      i18n: 'effect.bitcrush',
      icon: '👾',
      params: [
        { name: 'bits', label: 'Bits', min: 1, max: 16, default: 8, unit: '', step: 1 },
        { name: 'downsample', label: 'Downsample', min: 1, max: 50, default: 1, unit: 'x', step: 1 },
        { name: 'mix', label: 'Mix', min: 0, max: 100, default: 50, unit: '%' }
      ]
    },
    phaser: {
      name: 'Phaser',
      i18n: 'effect.phaser',
      icon: '🌀',
      params: [
        { name: 'rate', label: 'Rate', min: 0.1, max: 10, default: 0.5, unit: 'Hz', step: 0.1 },
        { name: 'depth', label: 'Depth', min: 0, max: 100, default: 50, unit: '%' },
        { name: 'stages', label: 'Stages', min: 2, max: 12, default: 4, unit: '', step: 2 },
        { name: 'feedback', label: 'Feedback', min: 0, max: 95, default: 30, unit: '%' },
        { name: 'mix', label: 'Mix', min: 0, max: 100, default: 50, unit: '%' }
      ]
    },
    flanger: {
      name: 'Flanger',
      i18n: 'effect.flanger',
      icon: '✈️',
      params: [
        { name: 'rate', label: 'Rate', min: 0.05, max: 5, default: 0.5, unit: 'Hz', step: 0.05 },
        { name: 'depth', label: 'Depth', min: 0, max: 100, default: 40, unit: '%' },
        { name: 'feedback', label: 'Feedback', min: -95, max: 95, default: 50, unit: '%' },
        { name: 'delay', label: 'Delay', min: 1, max: 20, default: 5, unit: 'ms' },
        { name: 'mix', label: 'Mix', min: 0, max: 100, default: 50, unit: '%' }
      ]
    },
    tremolo: {
      name: 'Tremolo',
      i18n: 'effect.tremolo',
      icon: '〰️',
      params: [
        { name: 'rate', label: 'Rate', min: 0.5, max: 20, default: 5, unit: 'Hz', step: 0.5 },
        { name: 'depth', label: 'Depth', min: 0, max: 100, default: 50, unit: '%' },
        { name: 'shape', label: 'Shape', type: 'select', options: ['sine', 'square', 'triangle'], default: 'sine' },
        { name: 'mix', label: 'Mix', min: 0, max: 100, default: 100, unit: '%' }
      ]
    },
    filter: {
      name: 'Auto Wah',
      i18n: 'effect.autowah',
      icon: '🎸',
      params: [
        { name: 'frequency', label: 'Freq', min: 200, max: 8000, default: 1000, unit: 'Hz', log: true },
        { name: 'resonance', label: 'Reso', min: 0, max: 100, default: 30, unit: '%' },
        { name: 'lfoRate', label: 'LFO Rate', min: 0, max: 10, default: 0.5, unit: 'Hz', step: 0.1 },
        { name: 'lfoDepth', label: 'LFO Dpt', min: 0, max: 100, default: 50, unit: '%' },
        { name: 'type', label: 'Type', type: 'select', options: ['lowpass', 'highpass', 'bandpass'], default: 'lowpass' },
        { name: 'mix', label: 'Mix', min: 0, max: 100, default: 100, unit: '%' }
      ]
    },
    compressor: {
      name: 'Compressor',
      i18n: 'effect.compressor',
      icon: '📊',
      params: [
        { name: 'threshold', label: 'Thresh', min: -60, max: 0, default: -24, unit: 'dB' },
        { name: 'ratio', label: 'Ratio', min: 1, max: 20, default: 4, unit: ':1', step: 0.5 },
        { name: 'attack', label: 'Attack', min: 0, max: 100, default: 10, unit: 'ms' },
        { name: 'release', label: 'Release', min: 10, max: 1000, default: 250, unit: 'ms' },
        { name: 'knee', label: 'Knee', min: 0, max: 40, default: 10, unit: 'dB' },
        { name: 'mix', label: 'Mix', min: 0, max: 100, default: 100, unit: '%' }
      ]
    },
    eq: {
      name: 'EQ',
      i18n: 'effect.eq',
      icon: '📈',
      params: [
        { name: 'lowGain', label: 'Low', min: -12, max: 12, default: 0, unit: 'dB' },
        { name: 'lowFreq', label: 'Low Hz', min: 60, max: 500, default: 200, unit: 'Hz' },
        { name: 'midGain', label: 'Mid', min: -12, max: 12, default: 0, unit: 'dB' },
        { name: 'midFreq', label: 'Mid Hz', min: 200, max: 5000, default: 1000, unit: 'Hz', log: true },
        { name: 'highGain', label: 'High', min: -12, max: 12, default: 0, unit: 'dB' },
        { name: 'highFreq', label: 'Hi Hz', min: 2000, max: 12000, default: 5000, unit: 'Hz', log: true },
        { name: 'mix', label: 'Mix', min: 0, max: 100, default: 100, unit: '%' }
      ]
    },
    tape: {
      name: 'Tape Saturation',
      i18n: 'effect.tape',
      icon: '📼',
      params: [
        { name: 'drive', label: 'Drive', min: 0, max: 100, default: 30, unit: '%' },
        { name: 'warmth', label: 'Warmth', min: 0, max: 100, default: 50, unit: '%' },
        { name: 'bump', label: 'Bump', min: 0, max: 100, default: 30, unit: '%' },
        { name: 'mix', label: 'Mix', min: 0, max: 100, default: 50, unit: '%' }
      ]
    },
    widener: {
      name: 'Widener',
      i18n: 'effect.widener',
      icon: '↔️',
      params: [
        { name: 'width', label: 'Width', min: 0, max: 200, default: 100, unit: '%' },
        { name: 'delay', label: 'Delay', min: 0, max: 30, default: 10, unit: 'ms' },
        { name: 'bassMono', label: 'Bass Mono', min: 0, max: 100, default: 50, unit: '%' },
        { name: 'mix', label: 'Mix', min: 0, max: 100, default: 100, unit: '%' }
      ]
    },
    lofi: {
      name: 'Lo-Fi',
      i18n: 'effect.lofi',
      icon: '📻',
      params: [
        { name: 'flutter', label: 'Flutter', min: 0, max: 100, default: 35, unit: '%' },
        { name: 'flutterRate', label: 'Wow Rate', min: 0.1, max: 5, default: 0.6, unit: 'Hz', step: 0.1 },
        { name: 'noise', label: 'Noise', min: 0, max: 100, default: 25, unit: '%' },
        { name: 'warmth', label: 'Warmth', min: 0, max: 100, default: 55, unit: '%' },
        { name: 'crush', label: 'Crush', min: 0, max: 100, default: 30, unit: '%' },
        { name: 'width', label: 'Mono', min: 0, max: 100, default: 35, unit: '%' },
        { name: 'mix', label: 'Mix', min: 0, max: 100, default: 65, unit: '%' }
      ]
    },
    hueShifter: {
      name: 'Hue Shifter',
      i18n: 'effect.hueshifter',
      icon: '🎨',
      params: [
        { name: 'character', label: 'Character', min: 0, max: 4, default: 0, unit: '', step: 1 },
        { name: 'drive', label: 'Drive', min: 0, max: 100, default: 35, unit: '%' },
        { name: 'tone', label: 'Tone', min: 0, max: 100, default: 50, unit: '%' },
        { name: 'rate', label: 'Rate', min: 0, max: 100, default: 40, unit: '%' },
        { name: 'depth', label: 'Depth', min: 0, max: 100, default: 50, unit: '%' },
        { name: 'mix', label: 'Mix', min: 0, max: 100, default: 50, unit: '%' }
      ]
    },
    driftscape: {
      name: 'Driftscape',
      i18n: 'effect.driftscape',
      icon: '🎞️',
      params: [
        { name: 'wowDepth', label: 'Wow Dpt', min: 0, max: 1, default: 0.5, unit: '', step: 0.01 },
        { name: 'wowRate', label: 'Wow Rate', min: 0, max: 1, default: 0.3, unit: '', step: 0.01 },
        { name: 'flutterDepth', label: 'Flut Dpt', min: 0, max: 1, default: 0.5, unit: '', step: 0.01 },
        { name: 'flutterRate', label: 'Flut Rate', min: 0, max: 1, default: 0.6, unit: '', step: 0.01 },
        { name: 'dropoutDensity', label: 'Dropout', min: 0, max: 1, default: 0.2, unit: '', step: 0.01 },
        { name: 'saturation', label: 'Sat', min: 0, max: 1, default: 0.4, unit: '', step: 0.01 },
        { name: 'warmth', label: 'Warmth', min: 0, max: 1, default: 0.4, unit: '', step: 0.01 },
        { name: 'mix', label: 'Mix', min: 0, max: 100, default: 50, unit: '%' }
      ]
    },
    halo: {
      name: 'Halo',
      i18n: 'effect.halo',
      icon: '😇',
      params: [
        { name: 'size', label: 'Size', min: 0, max: 1, default: 0.5, unit: '', step: 0.01 },
        { name: 'decay', label: 'Decay', min: 0, max: 1, default: 0.6, unit: '', step: 0.01 },
        { name: 'damping', label: 'Damp', min: 0, max: 1, default: 0.5, unit: '', step: 0.01 },
        { name: 'modDepth', label: 'Mod', min: 0, max: 1, default: 0.3, unit: '', step: 0.01 },
        { name: 'preDelay', label: 'PreDly', min: 0, max: 200, default: 10, unit: 'ms' },
        { name: 'mix', label: 'Mix', min: 0, max: 100, default: 35, unit: '%' }
      ]
    },
    grainfield: {
      name: 'Grainfield',
      i18n: 'effect.grainfield',
      icon: '🌫️',
      params: [
        { name: 'density', label: 'Density', min: 0, max: 1, default: 0.5, unit: '', step: 0.01 },
        { name: 'grainSize', label: 'Grain', min: 0, max: 1, default: 0.3, unit: '', step: 0.01 },
        { name: 'delay', label: 'Delay', min: 0, max: 1, default: 0.2, unit: '', step: 0.01 },
        { name: 'spread', label: 'Spread', min: 0, max: 1, default: 0.7, unit: '', step: 0.01 },
        { name: 'feedback', label: 'Fback', min: 0, max: 1, default: 0, unit: '', step: 0.01 },
        { name: 'freeze', label: 'Freeze', min: 0, max: 1, default: 0, unit: '', step: 1 },
        { name: 'mix', label: 'Mix', min: 0, max: 100, default: 50, unit: '%' }
      ]
    },
    stutterstep: {
      name: 'Stutterstep',
      i18n: 'effect.stutterstep',
      icon: '⚡',
      params: [
        { name: 'sliceLen', label: 'Slice', min: 16, max: 1000, default: 60, unit: 'ms' },
        { name: 'repeatCount', label: 'Repeat', min: 1, max: 16, default: 4, unit: '', step: 1 },
        { name: 'rateDivision', label: 'Div', min: 0, max: 5, default: 2, unit: '', step: 1 },
        { name: 'tempoBpm', label: 'BPM', min: 60, max: 240, default: 120, unit: 'bpm' },
        { name: 'gateDuty', label: 'Gate', min: 0, max: 1, default: 0.6, unit: '', step: 0.01 },
        { name: 'pitchPerRepeat', label: 'Pitch', min: -12, max: 12, default: 0, unit: 'st', step: 1 },
        { name: 'chaos', label: 'Chaos', min: 0, max: 1, default: 0, unit: '', step: 0.01 },
        { name: 'mix', label: 'Mix', min: 0, max: 100, default: 50, unit: '%' }
      ]
    },
    spectralHold: {
      name: 'Spectral Hold',
      i18n: 'effect.spectralhold',
      icon: '❄️',
      params: [
        { name: 'freeze', label: 'Freeze', min: 0, max: 1, default: 0, unit: '', step: 1 },
        { name: 'smear', label: 'Smear', min: 0, max: 1, default: 0.2, unit: '', step: 0.01 },
        { name: 'decay', label: 'Decay', min: 0, max: 1, default: 0, unit: '', step: 0.01 },
        { name: 'bright', label: 'Bright', min: 0, max: 1, default: 0.3, unit: '', step: 0.01 },
        { name: 'pitchOffset', label: 'Pitch', min: -12, max: 12, default: 0, unit: 'st', step: 1 },
        { name: 'mix', label: 'Mix', min: 0, max: 100, default: 50, unit: '%' }
      ]
    },
    gatedReverb: {
      name: 'Gated Reverb',
      i18n: 'effect.gatedreverb',
      icon: '🚪',
      params: [
        { name: 'size', label: 'Size', min: 0, max: 100, default: 50, unit: '%' },
        { name: 'decay', label: 'Decay', min: 0, max: 100, default: 50, unit: '%' },
        { name: 'threshold', label: 'Thresh', min: -60, max: 0, default: -30, unit: 'dB' },
        { name: 'release', label: 'Release', min: 10, max: 500, default: 100, unit: 'ms' },
        { name: 'mix', label: 'Mix', min: 0, max: 100, default: 50, unit: '%' }
      ]
    },
    dimension: {
      name: 'Dimension',
      i18n: 'effect.dimension',
      icon: '🌌',
      params: [
        { name: 'mode', label: 'Mode', min: 1, max: 4, default: 2, unit: '', step: 1 },
        { name: 'spread', label: 'Spread', min: 0, max: 100, default: 50, unit: '%' },
        { name: 'rate', label: 'Rate', min: 0.1, max: 2, default: 0.5, unit: 'Hz', step: 0.1 },
        { name: 'mix', label: 'Mix', min: 0, max: 100, default: 50, unit: '%' }
      ]
    },
    ringMod: {
      name: 'Ring Mod',
      i18n: 'effect.ringmod',
      icon: '🔔',
      params: [
        { name: 'frequency', label: 'Freq', min: 20, max: 2000, default: 440, unit: 'Hz', log: true },
        { name: 'shape', label: 'Shape', type: 'select', options: ['sine', 'square', 'triangle'], default: 'sine' },
        { name: 'lfoRate', label: 'LFO Rate', min: 0, max: 10, default: 0, unit: 'Hz', step: 0.1 },
        { name: 'lfoDepth', label: 'LFO Dpt', min: 0, max: 100, default: 0, unit: '%' },
        { name: 'mix', label: 'Mix', min: 0, max: 100, default: 50, unit: '%' }
      ]
    },
    pump: {
      name: 'Pump',
      i18n: 'effect.pump',
      icon: '💓',
      params: [
        { name: 'rate', label: 'Rate', min: 1, max: 8, default: 4, unit: '', step: 1 },
        { name: 'depth', label: 'Depth', min: 0, max: 100, default: 80, unit: '%' },
        { name: 'attack', label: 'Attack', min: 1, max: 100, default: 20, unit: 'ms' },
        { name: 'release', label: 'Release', min: 50, max: 500, default: 150, unit: 'ms' },
        { name: 'shape', label: 'Shape', type: 'select', options: ['linear', 'exponential', 'logarithmic'], default: 'exponential' },
        { name: 'mix', label: 'Mix', min: 0, max: 100, default: 50, unit: '%' }
      ]
    },
    softClip: {
      name: 'Soft Clip',
      i18n: 'effect.softclip',
      icon: '📎',
      params: [
        { name: 'threshold', label: 'Thresh', min: -12, max: 0, default: -6, unit: 'dB' },
        { name: 'knee', label: 'Knee', min: 0, max: 100, default: 50, unit: '%' },
        { name: 'ceiling', label: 'Ceiling', min: -6, max: 0, default: -0.5, unit: 'dB', step: 0.1 },
        { name: 'mix', label: 'Mix', min: 0, max: 100, default: 100, unit: '%' }
      ]
    },
    pitchShift: {
      name: 'Pitch Shift',
      icon: '🎵',
      params: [
        { name: 'semitones', label: 'Semi', min: -12, max: 12, default: 0, unit: 'st', step: 1 },
        { name: 'cents', label: 'Cents', min: -100, max: 100, default: 0, unit: 'c', step: 1 },
        { name: 'window', label: 'Window', min: 50, max: 200, default: 100, unit: 'ms' },
        { name: 'mix', label: 'Mix', min: 0, max: 100, default: 50, unit: '%' }
      ]
    },
    gate: {
      name: 'Gate',
      icon: '🚧',
      params: [
        { name: 'threshold', label: 'Thresh', min: -60, max: 0, default: -40, unit: 'dB' },
        { name: 'attack', label: 'Attack', min: 0.1, max: 50, default: 1, unit: 'ms', step: 0.1 },
        { name: 'hold', label: 'Hold', min: 0, max: 500, default: 50, unit: 'ms' },
        { name: 'release', label: 'Release', min: 10, max: 1000, default: 100, unit: 'ms' },
        { name: 'range', label: 'Range', min: -80, max: 0, default: -80, unit: 'dB' },
        { name: 'mix', label: 'Mix', min: 0, max: 100, default: 100, unit: '%' }
      ]
    },
    vocoder: {
      name: 'Vocoder',
      i18n: 'effect.vocoder_fx',
      icon: '🤖',
      params: [
        { name: 'bands', label: 'Bands', min: 8, max: 32, default: 16, unit: '', step: 1 },
        { name: 'carrierFreq', label: 'Carrier', min: 50, max: 500, default: 110, unit: 'Hz' },
        { name: 'resonance', label: 'Reso', min: 0, max: 100, default: 50, unit: '%' },
        { name: 'shift', label: 'Shift', min: -12, max: 12, default: 0, unit: 'st', step: 1 },
        { name: 'attack', label: 'Attack', min: 1, max: 100, default: 10, unit: 'ms' },
        { name: 'release', label: 'Release', min: 10, max: 500, default: 100, unit: 'ms' },
        { name: 'mix', label: 'Mix', min: 0, max: 100, default: 50, unit: '%' }
      ]
    }
  };

  // Default chain order
  var DEFAULT_CHAIN_ORDER = [
    'tape', 'softClip', 'distortion', 'bitcrush', 'lofi', 'hueShifter', 'driftscape', 'stutterstep',
    'grainfield', 'spectralHold', 'halo', 'gate', 'pump', 'dimension', 'chorus', 'delay',
    'flanger', 'phaser', 'ringMod', 'pitchShift', 'widener', 'gatedReverb', 'reverb',
    'tremolo', 'filter', 'vocoder', 'compressor', 'eq'
  ];

  // Map internal effectId to the en.json key under "effect.*"
  var EFFECT_I18N_KEY = {
    distortion: 'distortion', chorus: 'chorus', delay: 'delay', reverb: 'reverb',
    bitcrush: 'bitcrush', phaser: 'phaser', flanger: 'flanger', tremolo: 'tremolo',
    filter: 'autowah', compressor: 'compressor', eq: 'eq', tape: 'tape',
    widener: 'widener', lofi: 'lofi', hueShifter: 'hueshifter', driftscape: 'driftscape',
    halo: 'halo', grainfield: 'grainfield', stutterstep: 'stutterstep',
    spectralHold: 'spectralhold', gatedReverb: 'gatedreverb', dimension: 'dimension',
    ringMod: 'ringmod', pump: 'pump', softClip: 'softclip', pitchShift: 'pitchshift',
    gate: 'gate', vocoder: 'vocoder_fx'
  };

  // Map param select option values to i18n key prefix for display labels.
  var SELECT_OPTION_I18N = {
    // distortion type options
    soft: 'distortion_type.soft', hard: 'distortion_type.hard', fuzz: 'distortion_type.fuzz',
    tube: 'distortion_type.tube', wavefold: 'distortion_type.wavefold',
    bitcrush: 'distortion_type.bitcrush', tape: 'distortion_type.tape',
    // delay algorithm options
    digital: 'delay_type.digital', analog: 'delay_type.analog',
    pingpong: 'delay_type.pingpong', multitap: 'delay_type.multitap',
    ducking: 'delay_type.ducking',
    // reverb algorithm options
    convolution: 'reverb_type.convolution', room: 'reverb_type.room',
    plate: 'reverb_type.plate', hall: 'reverb_type.hall',
    spring: 'reverb_type.spring', shimmer: 'reverb_type.shimmer',
    // filter type options
    lowpass: 'filter_type.lowpass', highpass: 'filter_type.highpass',
    bandpass: 'filter_type.bandpass',
    // delay pattern options
    rhythmic: 'delay_pattern.rhythmic', golden: 'delay_pattern.golden',
    fibonacci: 'delay_pattern.fibonacci', custom: 'delay_pattern.custom'
  };

  /**
   * Resolve an effect's display name via SL.t(), falling back to EFFECT_META.name.
   */
  function _effectDisplayName(effectId) {
    var key = EFFECT_I18N_KEY[effectId];
    if (key && SL.t) {
      var translated = SL.t('effect.' + key);
      if (translated) { return translated; }
    }
    var meta = EFFECT_META[effectId];
    return meta ? meta.name : effectId;
  }

  /**
   * Resolve a select-option display label via SL.t(), falling back to raw value.
   */
  function _optionDisplayLabel(optValue) {
    var key = SELECT_OPTION_I18N[optValue];
    if (key && SL.t) {
      var translated = SL.t(key);
      if (translated) { return translated; }
    }
    return optValue;
  }

  // State
  var draggedEffect = null;
  var selectedTarget = 0;  // 0-3 = instrument, -1 = master

  /**
   * Get the chain order for the currently selected target
   * @returns {string[]} The effect chain order
   */
  function getChainOrder() {
    if (SL.audio && SL.audio.getInstruments) {
      if (selectedTarget === MASTER_TARGET) {
        // Master chain order — use its own order or default
        var chain = getCurrentEffectChain();
        if (chain) {
          var order = chain.getOrder();
          if (order.length > 0) return order;
        }
        return DEFAULT_CHAIN_ORDER.slice();
      }
      var insts = SL.audio.getInstruments();
      var targetInstGet = insts[selectedTarget];
      var hasGetEffectsSettings = targetInstGet && targetInstGet.settings && targetInstGet.settings.effects;
      if (hasGetEffectsSettings) {
        var stored = insts[selectedTarget].settings.effects.chainOrder;
        if (stored && stored.length > 0) return stored.slice();
      }
    }
    return DEFAULT_CHAIN_ORDER.slice();
  }

  /**
   * Set the chain order for the currently selected target
   * @param {string[]} order - The new chain order
   */
  function setChainOrder(order) {
    var hasInstrumentAccess = SL.audio && SL.audio.getInstruments;
    var isTargetSelected = hasInstrumentAccess && selectedTarget >= 0;
    if (isTargetSelected) {
      var insts = SL.audio.getInstruments();
      var targetInstSet = insts[selectedTarget];
      var hasSetEffectsSettings = targetInstSet && targetInstSet.settings && targetInstSet.settings.effects;
      if (hasSetEffectsSettings) {
        insts[selectedTarget].settings.effects.chainOrder = order.slice();
      }
    }
    var chain = getCurrentEffectChain();
    if (chain) {
      chain.setOrder(order);
    }
  }

  /**
   * Get the currently selected effect chain (based on selectedTarget)
   * @returns {EffectChain|null} The effect chain for the selected target
   */
  function getCurrentEffectChain() {
    if (SL.audio && SL.audio.getEffectChainForTarget) {
      return SL.audio.getEffectChainForTarget(selectedTarget);
    }
    return null;
  }

  /**
   * Initialize the effects UI
   */
  function init() {
    var container = document.getElementById('effectsTabContent');
    if (!container) {
      console.warn('Effects tab content container not found');
    } else {
      // Build the UI
      container.innerHTML = buildEffectsUI(); /* trusted: computed from internal state */

      // Set up event listeners
      setupEventListeners();

      // Set initial panel order
      reorderPanels();

      // Initialize chain from audio engine if available
      if (getCurrentEffectChain()) {
        syncUIFromChain();
      }
    }
  }

  /**
   * Build instrument tabs HTML
   */
  function buildInstrumentTabs() {
    var instKeys = ['inst_1', 'inst_2', 'inst_3', 'inst_4'];
    var tabsHtml = '<div class="effects-inst-tabs">';
    instKeys.forEach(function(key, i) {
      var activeClass = (i === selectedTarget) ? 'active' : '';
      var label = SL.t('instrument.' + key);
      tabsHtml += '<button class="effects-inst-tab ' + activeClass +
        '" data-target="' + i + '">' + label + '</button>';
    });
    var masterActiveClass = (selectedTarget === MASTER_TARGET) ? 'active' : '';
    tabsHtml += '<button class="effects-inst-tab effects-master-tab ' + masterActiveClass + '" data-target="-1">' +
                SL.t('instrument.master') +
                '</button>';
    tabsHtml += '</div>';
    return tabsHtml;
  }

  /**
   * Build the complete effects UI HTML
   */
  function buildEffectsUI() {
    var chainOrder = getChainOrder();
    var html = buildInstrumentTabs() +
      '<div class="effects-master-section">' +
        '<span class="effects-master-label">' + SL.t('ui.label.master_mix') + '</span>' +
        '<input type="range" aria-label="Effects Master Mix" role="slider"' +
               ' aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"' +
               ' class="effects-master-slider" id="effectsMasterMix"' +
               ' min="0" max="100" value="100" step="1">' +
        '<span class="effects-master-value" id="effectsMasterMixValue">100%</span>' +
      '</div>' +
      '<div class="effects-section-modal">' +
        '<div class="effects-chain-header">' +
          '<span class="effects-chain-title">' + SL.t('ui.label.effect_chain') + '</span>' +
          '<span class="effects-chain-hint">' + SL.t('ui.hint.reorder_effects') + '</span>' +
        '</div>' +
        '<div class="effects-chain-container" id="effectsChainContainer">';

    // Build chain items
    chainOrder.forEach(function(effectId, index) {
      var meta = EFFECT_META[effectId];
      if (meta) {
        html += buildChainItem(effectId, meta, index);
      }
    });

    html +=
      '</div>' +
      '</div>' +
      '<div class="effects-params-section">' +
        '<div class="effects-params-grid">';

    // Build parameter panels in chain order
    chainOrder.forEach(function(effectId) {
      var meta = EFFECT_META[effectId];
      if (meta) {
        html += buildEffectPanel(effectId, meta);
      }
    });

    html +=
      '</div>' +
      '</div>';

    return html;
  }

  /**
   * Build a single chain item
   */
  function buildChainItem(effectId, meta, index) {
    var dn = _effectDisplayName(effectId);
    return '<div class="effect-chain-item" data-effect="' + effectId + '">' +
        '<button class="effect-chain-btn effect-move-left" data-effect="' + effectId + '" data-dir="left" aria-label="' + SL.t('ui.button.move_left') + ' ' + dn + '">◄</button>' +
        '<span class="effect-chain-icon">' + meta.icon + '</span>' +
        '<span class="effect-chain-name">' + dn + '</span>' +
        '<label class="effect-chain-enable">' +
          '<input type="checkbox" class="effect-enable-cb" data-effect="' + effectId + '" aria-label="Enable ' + dn + '">' +
        '</label>' +
        '<button class="effect-chain-btn effect-move-right" data-effect="' + effectId + '" data-dir="right" aria-label="' + SL.t('ui.button.move_right') + ' ' + dn + '">►</button>' +
      '</div>';
  }

  /**
   * Build parameter panel for an effect
   */
  function buildEffectPanel(effectId, meta) {
    var dn = _effectDisplayName(effectId);
    // Panels start hidden since effects start in bypass mode
    var html =
      '<div class="effect-panel hidden" data-effect="' + effectId + '">' +
        '<div class="effect-panel-header">' +
          '<span class="effect-panel-icon">' + meta.icon + '</span>' +
          '<span class="effect-panel-title">' + dn + '</span>' +
        '</div>' +
        '<div class="effect-panel-params">';

    meta.params.forEach(function(param) {
      if (param.type === 'select') {
        html += buildSelectParam(effectId, param);
      } else {
        html += buildSliderParam(effectId, param);
      }
    });

    html +=
      '</div>' +
      '</div>';

    return html;
  }

  /**
   * Build a slider parameter control
   */
  function buildSliderParam(effectId, param) {
    var step = param.step || 1;
    var displayValue = formatParamValue(param.default, param);

    // Build showWhen data attribute if present
    var showWhenAttr = '';
    var hiddenClass = '';
    if (param.showWhen) {
      var showWhenJson = JSON.stringify(param.showWhen).replace(/"/g, '&quot;');
      showWhenAttr = ' data-show-when="' + showWhenJson + '"';
      // Start hidden unless default matches
      var conditionKey = Object.keys(param.showWhen)[0];
      var conditionValue = param.showWhen[conditionKey];
      var meta = EFFECT_META[effectId];
      var conditionParam = meta.params.find(function(p) { return p.name === conditionKey; });
      if (conditionParam && conditionParam.default !== conditionValue) {
        hiddenClass = ' hidden';
      }
    }

    return '<div class="effect-param-row' + hiddenClass + '"' + showWhenAttr + '>' +
        '<span class="effect-param-label">' + param.label + '</span>' +
        '<input type="range" aria-label="' + param.label + '"' +
               ' role="slider"' +
               ' aria-valuemin="' + param.min + '"' +
               ' aria-valuemax="' + param.max + '"' +
               ' aria-valuenow="' + param.default + '"' +
               ' class="effect-param-slider"' +
               ' data-effect="' + effectId + '"' +
               ' data-param="' + param.name + '"' +
               ' min="' + param.min + '"' +
               ' max="' + param.max + '"' +
               ' value="' + param.default + '"' +
               ' step="' + step + '">' +
        '<span class="effect-param-value" data-effect="' + effectId + '" data-param="' + param.name + '">' + displayValue + '</span>' +
      '</div>';
  }

  /**
   * Build a select parameter control
   */
  // Display labels for select options (avoids trademark names in UI)
  var OPTION_DISPLAY_LABELS = {
  };

  function buildSelectParam(effectId, param) {
    var optionsHtml = param.options.map(function(opt) {
      var displayLabel = _optionDisplayLabel(opt);
      return '<option value="' + opt + '" ' + (opt === param.default ? 'selected' : '') + '>' + displayLabel + '</option>';
    }).join('');

    // Build showWhen data attribute if present
    var showWhenAttr = '';
    var hiddenClass = '';
    if (param.showWhen) {
      var showWhenJson = JSON.stringify(param.showWhen).replace(/"/g, '&quot;');
      showWhenAttr = ' data-show-when="' + showWhenJson + '"';
      // Start hidden unless default matches
      var conditionKey = Object.keys(param.showWhen)[0];
      var conditionValue = param.showWhen[conditionKey];
      var meta = EFFECT_META[effectId];
      var conditionParam = meta.params.find(function(p) { return p.name === conditionKey; });
      if (conditionParam && conditionParam.default !== conditionValue) {
        hiddenClass = ' hidden';
      }
    }

    return '<div class="effect-param-row' + hiddenClass + '"' + showWhenAttr + '>' +
        '<span class="effect-param-label">' + param.label + '</span>' +
        '<select class="effect-param-select" data-effect="' + effectId + '" data-param="' + param.name + '">' +
          optionsHtml +
        '</select>' +
      '</div>';
  }

  /**
   * Update conditional parameter visibility based on current values
   */
  function updateConditionalParams(effectId, changedParam, newValue) {
    var panel = document.querySelector('.effect-panel[data-effect="' + effectId + '"]');
    if (!panel) return;

    // Find all param rows with showWhen conditions
    var conditionalRows = panel.querySelectorAll('[data-show-when]');
    conditionalRows.forEach(function(row) {
      try {
        var showWhen = JSON.parse(row.dataset.showWhen);
        // Check if this condition involves the changed param
        if (showWhen[changedParam] !== undefined) {
          var shouldShow = showWhen[changedParam] === newValue;
          row.classList.toggle('hidden', !shouldShow);
        }
      } catch (e) {
        console.warn('Error parsing showWhen condition:', e);
      }
    });
  }

  /**
   * Format parameter value for display
   */
  function formatParamValue(value, param) {
    if (param.log) {
      // For logarithmic params like frequency
      if (value >= 1000) {
        return (value / 1000).toFixed(1) + 'k' + param.unit;
      }
    }
    if (param.step && param.step < 1) {
      return value.toFixed(1) + param.unit;
    }
    return Math.round(value) + param.unit;
  }

  /**
   * Handle instrument tab click
   */
  function handleInstTabClick(e) {
    var target = parseInt(e.target.dataset.target);
    if (isNaN(target)) return;

    selectedTarget = target;

    // Rebuild UI for the new target
    var container = document.getElementById('effectsTabContent');
    if (container) {
      container.innerHTML = buildEffectsUI(); /* trusted: computed from internal state */
      setupEventListeners();
      reorderPanels();
      syncUIFromChain();
    }

  }

  /**
   * Set up all event listeners
   */
  function setupEventListeners() {
    var container = document.getElementById('effectsChainContainer');
    if (!container) return;

    // Instrument tab clicks
    document.querySelectorAll('.effects-inst-tab').forEach(function(tab) {
      tab.addEventListener('click', handleInstTabClick);
    });

    // Master mix slider
    var masterMixSlider = document.getElementById('effectsMasterMix');
    var masterMixValue = document.getElementById('effectsMasterMixValue');
    if (masterMixSlider) {
      masterMixSlider.addEventListener('input', function() {
        var value = parseInt(masterMixSlider.value);
        if (masterMixValue) masterMixValue.textContent = value + '%';
        var chain = getCurrentEffectChain();
        if (chain) {
          chain.setMasterMix(value);
        }
      });
    }

    // Left/right move buttons
    document.querySelectorAll('.effect-chain-btn').forEach(function(btn) {
      btn.addEventListener('click', handleMoveClick);
    });

    // Enable/disable checkboxes
    document.querySelectorAll('.effect-enable-cb').forEach(function(cb) {
      cb.addEventListener('change', handleEnableChange);
    });

    // Parameter sliders
    document.querySelectorAll('.effect-param-slider').forEach(function(slider) {
      slider.addEventListener('input', handleSliderChange);
    });

    // Parameter selects
    document.querySelectorAll('.effect-param-select').forEach(function(select) {
      select.addEventListener('change', handleSelectChange);
    });
  }

  /**
   * Handle move left/right btn click
   */
  function handleMoveClick(e) {
    var effectId = e.target.dataset.effect;
    var direction = e.target.dataset.dir;

    var order = getChainOrder();
    var currentIndex = order.indexOf(effectId);
    if (currentIndex === NOT_FOUND) return;

    var newIndex;
    if (direction === 'left') {
      newIndex = Math.max(0, currentIndex - 1);
    } else {
      newIndex = Math.min(order.length - 1, currentIndex + 1);
    }

    if (newIndex !== currentIndex) {
      order.splice(currentIndex, 1);
      order.splice(newIndex, 0, effectId);
      setChainOrder(order);
      rebuildChainUI();
      reorderPanels();
    }
  }

  /**
   * Reorder effect panels to match chain order using CSS order
   */
  function reorderPanels() {
    var chainOrder = getChainOrder();
    chainOrder.forEach(function(effectId, index) {
      var panel = document.querySelector('.effect-panel[data-effect="' + effectId + '"]');
      if (panel) {
        panel.style.order = index;
      }
    });
  }

  /**
   * Rebuild just the chain container UI
   */
  function rebuildChainUI() {
    var container = document.getElementById('effectsChainContainer');
    if (!container) return;

    var chainOrder = getChainOrder();
    var html = '';
    chainOrder.forEach(function(effectId, index) {
      var meta = EFFECT_META[effectId];
      if (meta) {
        html += buildChainItem(effectId, meta, index);
      }
    });
    container.innerHTML = html; /* trusted: computed from internal state */

    // Re-attach button listeners
    document.querySelectorAll('.effect-chain-btn').forEach(function(btn) {
      btn.addEventListener('click', handleMoveClick);
    });

    // Re-attach checkbox listeners and restore states
    var chain = getCurrentEffectChain();
    document.querySelectorAll('.effect-enable-cb').forEach(function(cb) {
      cb.addEventListener('change', handleEnableChange);
      // Restore enabled state from effect
      var effectId = cb.dataset.effect;
      if (chain) {
        var effect = chain.getEffect(effectId);
        if (effect) {
          cb.checked = effect.enabled;
          var item = cb.closest('.effect-chain-item');
          if (item) {
            item.classList.toggle('enabled', effect.enabled);
          }
        }
      }
    });
  }

  /**
   * Update chain order from current DOM arrangement (kept for compatibility)
   */
  function updateChainOrderFromDOM() {
    var container = document.getElementById('effectsChainContainer');
    if (container) {
      var items = container.querySelectorAll('.effect-chain-item');

      var order = Array.from(items).map(function(item) { return item.dataset.effect; });
      setChainOrder(order);
    }
  }

  /**
   * Handle enable/disable checkbox change
   */
  function handleEnableChange(e) {
    var effectId = e.target.dataset.effect;
    var enabled = e.target.checked;

    // Update audio engine - add/remove from chain order AND set wet/dry
    var chain = getCurrentEffectChain();
    if (chain) {
      var effect = chain.getEffect(effectId);
      if (effect) {
        if (enabled) {
          chain.addToChain(effectId);
          effect.setEnabled(true);
        } else {
          effect.setEnabled(false);
          chain.removeFromChain(effectId);
        }
      }
    }

    // Update visual state
    var chainItem = document.querySelector('.effect-chain-item[data-effect="' + effectId + '"]');
    var panel = document.querySelector('.effect-panel[data-effect="' + effectId + '"]');

    if (chainItem) {
      chainItem.classList.toggle('enabled', enabled);
    }
    if (panel) {
      panel.classList.toggle('enabled', enabled);
      // Show panel only when effect is enabled
      panel.classList.toggle('hidden', !enabled);
    }

  }

  /**
   * Handle slider parameter change
   */
  function handleSliderChange(e) {
    var effectId = e.target.dataset.effect;
    var paramName = e.target.dataset.param;
    var value = parseFloat(e.target.value);

    // Update display value
    var meta = EFFECT_META[effectId];
    var paramMeta = meta.params.find(function(p) { return p.name === paramName; });
    var valueDisplay = document.querySelector('.effect-param-value[data-effect="' + effectId + '"][data-param="' + paramName + '"]');

    if (valueDisplay && paramMeta) {
      valueDisplay.textContent = formatParamValue(value, paramMeta);
    }

    // Update ARIA value
    e.target.setAttribute('aria-valuenow', value);

    // Update audio engine
    var chain = getCurrentEffectChain();
    if (chain) {
      var effect = chain.getEffect(effectId);
      if (effect) {
        effect.setParam(paramName, value);
      }
    }
  }

  /**
   * Handle select parameter change
   */
  function handleSelectChange(e) {
    var effectId = e.target.dataset.effect;
    var paramName = e.target.dataset.param;
    var value = e.target.value;

    // Update conditional parameter visibility
    updateConditionalParams(effectId, paramName, value);

    // Update audio engine
    var chain = getCurrentEffectChain();
    if (chain) {
      var effect = chain.getEffect(effectId);
      if (effect) {
        effect.setParam(paramName, value);
      }
    }
  }

  /**
   * Sync UI state from audio engine chain
   */
  function syncUIFromChain() {
    var chain = getCurrentEffectChain();
    if (!chain) return;

    // Sync enable states and parameters
    chain.getRegisteredEffects().forEach(function(effectId) {
      var effect = chain.getEffect(effectId);
      if (!effect) return;

      var params = effect.getParams();
      var isEnabled = params.enabled;

      // Update enable checkbox
      var enableCb = document.querySelector('.effect-enable-cb[data-effect="' + effectId + '"]');
      if (enableCb) {
        enableCb.checked = isEnabled;
      }

      // Update chain item visual state
      var chainItem = document.querySelector('.effect-chain-item[data-effect="' + effectId + '"]');
      if (chainItem) {
        chainItem.classList.toggle('enabled', isEnabled);
      }

      // Update panel visual state and visibility
      var panel = document.querySelector('.effect-panel[data-effect="' + effectId + '"]');
      if (panel) {
        panel.classList.toggle('enabled', isEnabled);
        panel.classList.toggle('hidden', !isEnabled);
      }

      // Update parameter controls
      Object.keys(params).forEach(function(paramName) {
        if (paramName === 'enabled') return;

        var slider = document.querySelector('.effect-param-slider[data-effect="' + effectId + '"][data-param="' + paramName + '"]');
        var select = document.querySelector('.effect-param-select[data-effect="' + effectId + '"][data-param="' + paramName + '"]');

        if (slider) {
          slider.value = params[paramName];
          // Trigger display update
          var event = new Event('input', { bubbles: true });
          slider.dispatchEvent(event);
        }
        if (select) {
          select.value = params[paramName];
        }
      });
    });
  }

  /**
   * Set the selected target programmatically
   * @param {number} target - Target index (0-3 for instruments, -1 for master)
   */
  function setSelectedTarget(target) {
    if (target < -1 || target > 3) return;
    selectedTarget = target;

    var container = document.getElementById('effectsTabContent');
    if (container) {
      container.innerHTML = buildEffectsUI(); /* trusted: computed from internal state */
      setupEventListeners();
      reorderPanels();
      syncUIFromChain();
    }
  }

  /**
   * Get the currently selected target
   * @returns {number} Target index (0-3 for instruments, -1 for master)
   */
  function getSelectedTarget() {
    return selectedTarget;
  }

  // Export
  SL.effectsUI = {
    init,
    syncUIFromChain,
    getCurrentEffectChain,
    getSelectedTarget,
    setSelectedTarget,
    EFFECT_META,
    DEFAULT_CHAIN_ORDER
  };

})();
