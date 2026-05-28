// SSLI Screen: Tweak v2 — scaffolding + Subtractive panel
// ES5 compatible (var, no arrow functions, no template literals).
//
// This is a scaffold: shared helpers + adapter registry + full Subtractive.
// All other engines render a stub; later recruits replace those stubs.

(function() {
  'use strict';

  var SL = window.SynthLab;

  // ============================================================
  // Constants
  // ============================================================

  var SCREEN_ID = 'ssli-screen-tweak';
  var SCREEN_NAME_SHAPE = 'shape';

  var TEST_TONE_MIDI = 60;   // C4
  var TEST_TONE_VELOCITY = 90;

  var DEFAULT_ENGINE = 'subtractive';

  // Osc/Noise ranges (subtractive)
  var OSC_COUNT = 3;
  var OSC_OCT_MIN = -3;
  var OSC_OCT_MAX = 3;
  var OSC_OCT_STEP = 1;
  var OSC_DETUNE_MIN = -100;
  var OSC_DETUNE_MAX = 100;
  var OSC_DETUNE_STEP = 1;
  var OSC_LEVEL_MIN = 0;
  var OSC_LEVEL_MAX = 100;
  var OSC_LEVEL_STEP = 1;

  var NOISE_LEVEL_MIN = 0;
  var NOISE_LEVEL_MAX = 100;
  var NOISE_LEVEL_STEP = 1;

  var OSC_WAVES = ['sine', 'triangle', 'sawtooth', 'square', 'pulse', 'noise', 'supersaw'];
  var NOISE_TYPES = ['white', 'pink', 'brown'];

  // ---- FM constants ----
  var FM_ALGORITHM_MIN = 1;
  var FM_ALGORITHM_MAX = 32;
  var FM_OPERATOR_COUNT = 6;
  var FM_WAVES = ['sine', 'triangle', 'sawtooth', 'square'];
  var FM_RATIO_COARSE_MIN = 0;
  var FM_RATIO_COARSE_MAX = 31;
  var FM_RATIO_COARSE_STEP = 1;
  var FM_RATIO_FINE_MIN = 0;
  var FM_RATIO_FINE_MAX = 99;
  var FM_RATIO_FINE_STEP = 1;
  var FM_LEVEL_MIN = 0;
  var FM_LEVEL_MAX = 99;
  var FM_LEVEL_STEP = 1;
  var FM_DETUNE_MIN = 0;
  var FM_DETUNE_MAX = 14;
  var FM_DETUNE_STEP = 1;
  var FM_FEEDBACK_MIN = 0;
  var FM_FEEDBACK_MAX = 7;
  var FM_FEEDBACK_STEP = 1;

  var TIP_FM_ALGORITHM = 'DX7-style algorithm (1..32). Selects the operator routing topology.';
  var TIP_FM_FEEDBACK = 'Global feedback amount for the feedback operator of the algorithm (0..7).';
  var TIP_FM_OP_WAVE = 'Operator waveform. Sine is the classic FM flavour; others add harmonic bite.';
  var TIP_FM_OP_RATIO_COARSE = 'Coarse frequency ratio relative to the note pitch.';
  var TIP_FM_OP_RATIO_FINE = 'Fine frequency ratio fractional part (0..99).';
  var TIP_FM_OP_LEVEL = 'Operator output level. Carriers = voice volume, modulators = timbre intensity.';
  var TIP_FM_OP_DETUNE = 'Per-operator detune (0..14). 7 is centred.';

  // ---- Physical constants ----
  var PHYS_MODELS = [
    { val: 'pluck',  label: 'Pluck (Karplus-Strong)' },
    { val: 'bow',    label: 'Multistring' },
    { val: 'blow',   label: 'Blown Pipe / Flute' },
    { val: 'strike', label: 'Struck / Modal' }
  ];
  var PHYS_EXCITATION_TYPES = ['noise', 'pulse', 'dc'];
  var PHYS_MATERIALS = ['metal', 'wood', 'glass'];

  var PHYS_KNOB_MIN = 0;
  var PHYS_KNOB_MAX = 100;
  var PHYS_KNOB_STEP = 1;
  var PHYS_HUMAN_MIN = 0;
  var PHYS_HUMAN_MAX = 100;
  var PHYS_HUMAN_STEP = 1;

  var TIP_PHYS_MODEL = 'Physical model family. Each uses a different resonator/exciter structure.';
  var TIP_PHYS_DAMPING = 'How quickly energy is lost per cycle. Higher = shorter, duller tone.';
  var TIP_PHYS_BRIGHTNESS = 'Tone brightness of the resonator output.';
  var TIP_PHYS_EXCITATION = 'Type of energy injected at note-on.';
  var TIP_PHYS_BODY = 'Body / resonator size. Bigger = lower, woodier body.';
  var TIP_PHYS_DECAY = 'How long the note sustains before silence.';
  var TIP_PHYS_BOW_PRESSURE = 'Bow pressure on the string. Too much = scratchy.';
  var TIP_PHYS_BOW_POSITION = 'Bow position along the string (sul ponticello to sul tasto).';
  var TIP_PHYS_BREATH = 'Breath pressure into the pipe.';
  var TIP_PHYS_EMBOUCHURE = 'Embouchure / jet shape for pipe models.';
  var TIP_PHYS_STRIKE_POS = 'Strike position on the resonator.';
  var TIP_PHYS_HARDNESS = 'Mallet hardness. Harder = brighter strike.';
  var TIP_PHYS_MATERIAL = 'Resonator material flavour.';
  var TIP_PHYS_HUMAN = 'Random humanisation per note for natural variation.';

  // ---- Wavefolder constants ----
  var WF_SOURCES = ['sine', 'triangle', 'saw', 'square'];
  var WF_FOLD_MIN = 1;
  var WF_FOLD_MAX = 16;
  var WF_FOLD_STEP = 0.5;
  var WF_SYMMETRY_MIN = 0;
  var WF_SYMMETRY_MAX = 100;
  var WF_SYMMETRY_STEP = 1;
  var WF_BIAS_MIN = -100;
  var WF_BIAS_MAX = 100;
  var WF_BIAS_STEP = 1;
  var WF_PREGAIN_MIN = 0.1;
  var WF_PREGAIN_MAX = 10.0;
  var WF_PREGAIN_STEP = 0.1;

  var TIP_WF_SOURCE = 'Source waveform fed into the wavefolder.';
  var TIP_WF_FOLD = 'How many times the wave is folded back on itself. More folds = more harmonics.';
  var TIP_WF_SYMMETRY = 'Balance of positive vs negative folds. 50% is symmetrical.';
  var TIP_WF_BIAS = 'DC offset applied before folding. Shifts the fold points.';
  var TIP_WF_PREGAIN = 'Drive / output trim into the folder.';

  // ---- Formant constants ----
  var FMT_VOWELS = ['A', 'E', 'I', 'O', 'U', 'AE', 'UH', 'OO'];
  var FMT_MORPH_MIN = 0;
  var FMT_MORPH_MAX = 100;
  var FMT_MORPH_STEP = 1;
  var FMT_SHIFT_MIN = -12;
  var FMT_SHIFT_MAX = 12;
  var FMT_SHIFT_STEP = 1;
  var FMT_BREATH_MIN = 0;
  var FMT_BREATH_MAX = 100;
  var FMT_BREATH_STEP = 1;
  var FMT_GLOTTAL_MIN = 10;
  var FMT_GLOTTAL_MAX = 90;
  var FMT_GLOTTAL_STEP = 1;
  var FMT_SEQ_RATE_MIN = 0.1;
  var FMT_SEQ_RATE_MAX = 10.0;
  var FMT_SEQ_RATE_STEP = 0.1;

  var TIP_FMT_VOWEL = 'Primary vowel shape of the voice.';
  var TIP_FMT_TARGET = 'Second vowel to morph toward using Morph X.';
  var TIP_FMT_MORPH = 'Blend between the two vowels. 0 = primary, 100 = target.';
  var TIP_FMT_SHIFT = 'Shift all formants up/down in semitones (tongue / throat / nasal timbre).';
  var TIP_FMT_BREATH = 'Breath noise mixed into the voice.';
  var TIP_FMT_GLOTTAL = 'Glottal pulse width \u2014 brightness of the voicing source.';
  var TIP_FMT_SEQ_ON = 'Cycle through vowels automatically.';
  var TIP_FMT_SEQ_RATE = 'Automatic vowel sequencing rate (Hz).';

  // ---- Modal constants ----
  var MD_MATERIALS = ['bell', 'bar', 'plate', 'membrane', 'tube', 'glass'];
  var MD_EXCITATIONS = ['mallet', 'impulse', 'noise'];
  var MD_PCT_MIN = 0;
  var MD_PCT_MAX = 100;
  var MD_PCT_STEP = 1;

  var TIP_MD_MATERIAL = 'Material of the resonator. Sets the inharmonic mode ratios.';
  var TIP_MD_EXCITATION = 'Strike type: soft mallet, sharp impulse, or noise burst.';
  var TIP_MD_MALLET = 'Mallet hardness. Soft = dark hit, hard = bright hit.';
  var TIP_MD_DAMPING = 'How quickly modes decay. Higher = shorter sound.';
  var TIP_MD_BRIGHTNESS = 'Mix of high modes vs low modes.';
  var TIP_MD_BODY = 'Body size. Larger bodies ring lower and longer.';
  var TIP_MD_INHARMONICITY = 'Blend harmonic (0) to fully inharmonic (100) mode ratios.';

  // ---- Wavetable constants ----
  var WT_BANKS = ['basic', 'vocal', 'digital', 'metallic'];
  var WT_SCAN_MIN = 0;
  var WT_SCAN_MAX = 100;
  var WT_SCAN_STEP = 1;
  var WT_LFO_SPEED_MIN = 0.0;
  var WT_LFO_SPEED_MAX = 10.0;
  var WT_LFO_SPEED_STEP = 0.1;
  var WT_LFO_DEPTH_MIN = 0;
  var WT_LFO_DEPTH_MAX = 100;
  var WT_LFO_DEPTH_STEP = 1;
  var WT_DETUNE_MIN = -50;
  var WT_DETUNE_MAX = 50;
  var WT_DETUNE_STEP = 1;

  var TIP_WT_BANK = 'Wavetable bank \u2014 collection of waveforms to scan through.';
  var TIP_WT_SCAN = 'Position within the wavetable. Scan between frames to morph.';
  var TIP_WT_LFO_SPEED = 'LFO rate that automatically sweeps the scan position (Hz).';
  var TIP_WT_LFO_DEPTH = 'How much the LFO moves the scan position.';
  var TIP_WT_DETUNE = 'Fine pitch offset in cents.';

  // ---- Additive constants ----
  var ADDITIVE_PARTIAL_COUNT = 16;
  var ADDITIVE_BAR_MIN = 0;
  var ADDITIVE_BAR_MAX = 100;
  var ADDITIVE_BAR_STEP = 1;
  var ADDITIVE_AMP_FULL = 1.0;
  var ADDITIVE_AMP_ZERO = 0.0;
  var ADDITIVE_PERCENT_SCALE = 100;
  var ADDITIVE_RANDOM_DECAY = 0.85;
  var ADDITIVE_SPREAD_MIN = 0;
  var ADDITIVE_SPREAD_MAX = 100;
  var ADDITIVE_SPREAD_STEP = 1;
  var ADDITIVE_SPREAD_DEFAULT = 0;
  var ADDITIVE_DECAY_MIN = 0;
  var ADDITIVE_DECAY_MAX = 100;
  var ADDITIVE_DECAY_STEP = 1;
  var ADDITIVE_DECAY_DEFAULT = 0;
  var ADDITIVE_PRESETS = ['Saw', 'Square', 'Triangle', 'Sine', 'Odd', 'Even', 'Random'];

  var TIP_ADDITIVE_BAR = 'Amplitude of this harmonic partial (percent).';
  var TIP_ADDITIVE_PRESET = 'Apply a preset partial distribution.';
  var TIP_ADDITIVE_SPREAD = 'Stereo spread across partials.';
  var TIP_ADDITIVE_DECAY = 'Extra high-partial rolloff applied to the distribution.';

  // ---- Granular constants ----
  var GRAN_SIZE_MIN = 1;
  var GRAN_SIZE_MAX = 100;
  var GRAN_SIZE_STEP = 1;
  var GRAN_SIZE_DEFAULT = 50;
  var GRAN_DENSITY_MIN = 1;
  var GRAN_DENSITY_MAX = 50;
  var GRAN_DENSITY_STEP = 1;
  var GRAN_DENSITY_DEFAULT = 20;
  var GRAN_POSITION_MIN = 0;
  var GRAN_POSITION_MAX = 100;
  var GRAN_POSITION_STEP = 1;
  var GRAN_POSITION_DEFAULT = 50;
  var GRAN_PITCH_MIN = 0;
  var GRAN_PITCH_MAX = 12;
  var GRAN_PITCH_STEP = 1;
  var GRAN_PITCH_DEFAULT = 0;
  var GRAN_SPREAD_MIN = 0;
  var GRAN_SPREAD_MAX = 100;
  var GRAN_SPREAD_STEP = 1;
  var GRAN_SPREAD_DEFAULT = 0;
  var GRAN_WINDOW_SHAPES = [
    { val: 'hann',      label: 'Hann' },
    { val: 'triangle',  label: 'Triangle' },
    { val: 'rectangle', label: 'Box' }
  ];
  var GRAN_SOURCES = [
    { val: 'sine',     label: 'Sine' },
    { val: 'saw',      label: 'Saw' },
    { val: 'square',   label: 'Square' },
    { val: 'triangle', label: 'Triangle' },
    { val: 'noise',    label: 'Noise' }
  ];

  var TIP_GRAN_SOURCE = 'Source waveform the grains are cut from.';
  var TIP_GRAN_SIZE = 'Length of each grain, in milliseconds.';
  var TIP_GRAN_DENSITY = 'How many grains fire per second.';
  var TIP_GRAN_POSITION = 'Playhead position inside the source.';
  var TIP_GRAN_PITCH = 'Random pitch scatter, in semitones.';
  var TIP_GRAN_SPREAD = 'Random position scatter, in percent.';
  var TIP_GRAN_WINDOW = 'Amplitude window applied to each grain.';
  var TIP_GRAN_FREEZE = 'Freeze the playhead at the current position. Panel-local; does not touch the top bar.';

  // ---- Vocoder-Synth ----
  var VOC_CARRIER_WAVES = ['saw', 'square', 'noise', 'pulse'];
  var VOC_VOWELS = ['A', 'E', 'I', 'O', 'U'];
  var VOC_BAND_COUNTS = [8, 16, 32];
  var VOC_MORPH_MIN = 0;
  var VOC_MORPH_MAX = 100;
  var VOC_MORPH_STEP = 1;
  var VOC_FORMANT_MIN = -12;
  var VOC_FORMANT_MAX = 12;
  var VOC_FORMANT_STEP = 1;
  var VOC_FILTERQ_MIN = 1;
  var VOC_FILTERQ_MAX = 30;
  var VOC_FILTERQ_STEP = 1;
  var VOC_DEFAULT_CARRIER = 'saw';
  var VOC_DEFAULT_VOWEL = 'A';
  var VOC_DEFAULT_BANDS = 16;
  var VOC_DEFAULT_MORPH = 0;
  var VOC_DEFAULT_FORMANT = 0;
  var VOC_DEFAULT_FILTERQ = 8;

  var TIP_VOC_CARRIER = 'Oscillator shape sent through the vocoder bank.';
  var TIP_VOC_VOWEL = 'Vowel formant pattern shaping the carrier.';
  var TIP_VOC_BANDS = 'Number of analysis/synthesis bands. More bands = clearer formants.';
  var TIP_VOC_MORPH = 'Morph position between vowel states.';
  var TIP_VOC_FORMANT = 'Formant shift in semitones.';
  var TIP_VOC_FILTERQ = 'Resonance of each band filter.';

  // ---- Ring-Mod ----
  var RM_WAVES = ['sine', 'saw', 'square', 'triangle'];
  var RM_RATIO_MODES = [
    { val: 'ratio', label: 'Ratio (tracks pitch)' },
    { val: 'fixed', label: 'Fixed (Hz)' }
  ];
  var RM_RATIO_MIN = 0.5;
  var RM_RATIO_MAX = 16.0;
  var RM_RATIO_STEP = 0.1;
  var RM_FIXED_MIN = 20;
  var RM_FIXED_MAX = 8000;
  var RM_FIXED_STEP = 1;
  var RM_DEPTH_MIN = 0;
  var RM_DEPTH_MAX = 100;
  var RM_DEPTH_STEP = 1;
  var RM_DEFAULT_CARRIER = 'sine';
  var RM_DEFAULT_MODWAVE = 'sine';
  var RM_DEFAULT_MODE = 'ratio';
  var RM_DEFAULT_RATIO = 2.0;
  var RM_DEFAULT_FIXED = 440;
  var RM_DEFAULT_DEPTH = 80;

  var TIP_RM_CARRIER = 'Carrier waveform.';
  var TIP_RM_MODWAVE = 'Modulator waveform.';
  var TIP_RM_MODE = 'Ratio tracks note pitch; fixed is a constant Hz.';
  var TIP_RM_RATIO = 'Modulator frequency as a multiple of the note.';
  var TIP_RM_FIXED = 'Modulator frequency in Hz (fixed mode).';
  var TIP_RM_DEPTH = 'Dry/wet mix amount.';

  // ---- Chord ----
  var CHORD_TYPES = [
    'major', 'minor', 'dim', 'aug', 'sus2', 'sus4',
    'dom7', 'maj7', 'min7', '9th', 'add9', 'power'
  ];
  var CHORD_VOICINGS = ['close', 'open', 'drop2', 'spread'];
  var CHORD_WAVES = ['sine', 'saw', 'square', 'triangle'];
  var CHORD_STRUM_MIN = 0;
  var CHORD_STRUM_MAX = 100;
  var CHORD_STRUM_STEP = 1;
  var CHORD_DEFAULT_TYPE = 'major';
  var CHORD_DEFAULT_VOICING = 'close';
  var CHORD_DEFAULT_WAVE = 'saw';
  var CHORD_DEFAULT_STRUM = 0;

  var TIP_CHORD_TYPE = 'Chord quality (major, minor, 7ths, etc.).';
  var TIP_CHORD_VOICING = 'How notes are spread across octaves.';
  var TIP_CHORD_WAVE = 'Oscillator waveform for each chord tone.';
  var TIP_CHORD_STRUM = 'Delay between notes in ms. 0 = block chord.';

  // ---- Superwave ----
  var SW_WAVES = ['saw', 'square', 'triangle', 'pulse'];
  var SW_VOICE_COUNTS = [2, 4, 7, 8, 12, 16];
  var SW_MIX_MODES = ['equal', 'center-heavy', 'edge-heavy'];
  var SW_DETUNE_MIN = 0;
  var SW_DETUNE_MAX = 100;
  var SW_DETUNE_STEP = 1;
  var SW_STEREO_MIN = 0;
  var SW_STEREO_MAX = 100;
  var SW_STEREO_STEP = 1;
  var SW_DEFAULT_WAVE = 'saw';
  var SW_DEFAULT_VOICES = 7;
  var SW_DEFAULT_DETUNE = 30;
  var SW_DEFAULT_STEREO = 50;
  var SW_DEFAULT_MIX = 'equal';

  var TIP_SW_WAVE = 'Source waveform for each voice.';
  var TIP_SW_VOICES = 'Number of stacked detuned voices.';
  var TIP_SW_DETUNE = 'Spread in cents between voices.';
  var TIP_SW_STEREO = 'Stereo field width.';
  var TIP_SW_MIX = 'Level balance: equal, center-heavy, or edge-heavy.';

  // ---- Phase-Distortion ----
  var PD_TYPES = ['saw', 'square', 'pulse', 'resonant', 'doublesine'];
  var PD_WINDOWS = ['cosine', 'hann', 'triangle', 'rectangular'];
  var PD_AMOUNT_MIN = 0;
  var PD_AMOUNT_MAX = 100;
  var PD_AMOUNT_STEP = 1;
  var PD_RES_MIN = 1.0;
  var PD_RES_MAX = 16.0;
  var PD_RES_STEP = 0.1;
  var PD_DEFAULT_TYPE = 'saw';
  var PD_DEFAULT_AMOUNT = 50;
  var PD_DEFAULT_WINDOW = 'cosine';
  var PD_DEFAULT_RES = 1.0;

  var TIP_PD_TYPE = 'Phase-distortion curve selection.';
  var TIP_PD_AMOUNT = 'Depth of phase warping.';
  var TIP_PD_WINDOW = 'Window shape used for the phase sweep.';
  var TIP_PD_RES = 'Resonant frequency as a ratio of the note.';

  // ---- Chip ----
  var CHIP_MODES = [
    { val: 'sid',     label: 'C64 SID' },
    { val: 'nes',     label: 'NES 2A03' },
    { val: 'gameboy', label: 'Game Boy' },
    { val: 'genesis', label: 'Genesis YM2612' }
  ];
  var CHIP_WAVEFORMS = [
    { val: 'pulse',    label: 'Pulse' },
    { val: 'sawtooth', label: 'Sawtooth' },
    { val: 'triangle', label: 'Triangle' },
    { val: 'noise',    label: 'Noise' },
    { val: 'wave',     label: 'Wave (GB)' },
    { val: 'fm',       label: 'FM (Genesis)' }
  ];
  var CHIP_NOISE_MODES = [
    { val: 'long',  label: 'Long' },
    { val: 'short', label: 'Short' }
  ];
  var CHIP_DUTY_MIN = 0;
  var CHIP_DUTY_MAX = 100;
  var CHIP_DUTY_STEP = 1;
  var CHIP_BITDEPTH_MIN = 1;
  var CHIP_BITDEPTH_MAX = 16;
  var CHIP_BITDEPTH_STEP = 1;
  var CHIP_FMALGO_MIN = 0;
  var CHIP_FMALGO_MAX = 7;
  var CHIP_FMALGO_STEP = 1;
  var CHIP_FMFB_MIN = 0;
  var CHIP_FMFB_MAX = 100;
  var CHIP_FMFB_STEP = 1;
  var CHIP_DEFAULT_MODE = 'sid';
  var CHIP_DEFAULT_WAVE = 'pulse';
  var CHIP_DEFAULT_DUTY = 50;
  var CHIP_DEFAULT_BITDEPTH = 12;
  var CHIP_DEFAULT_NOISE = 'long';
  var CHIP_DEFAULT_FMALGO = 0;
  var CHIP_DEFAULT_FMFB = 0;

  var TIP_CHIP_MODE = 'Target chip emulation.';
  var TIP_CHIP_WAVE = 'Waveform (chip-dependent availability).';
  var TIP_CHIP_DUTY = 'Pulse-width / duty cycle.';
  var TIP_CHIP_BITDEPTH = 'Sample quantisation bit depth.';
  var TIP_CHIP_NOISE = 'Noise feedback tap: long or short period.';
  var TIP_CHIP_FMALGO = 'FM operator algorithm (Genesis).';
  var TIP_CHIP_FMFB = 'FM feedback amount (Genesis).';

  var USER_PRESETS_STORAGE_KEY = 'ssli-user-presets';
  var PANIC_REGISTRY_CATEGORY = 'voices';
  var PANIC_REGISTRY_NAME = 'tweak2-test-tone';

  // CSS classnames (prefix ssli-tweak2-*)
  var CLS_CONTAINER = 'ssli-tweak2-container';
  var CLS_HEADER = 'ssli-tweak2-header';
  var CLS_HEADER_INFO = 'ssli-tweak2-header-info';
  var CLS_HEADER_ACTIONS = 'ssli-tweak2-header-actions';
  var CLS_STATUS = 'ssli-tweak2-status';
  var CLS_BTN = 'ssli-tweak2-btn';
  var CLS_BTN_ACTIVE = 'active';
  var CLS_GRID = 'ssli-tweak2-grid';
  var CLS_SECTION = 'ssli-tweak2-section';
  var CLS_SECTION_HEADER = 'ssli-tweak2-section-header';
  var CLS_SECTION_TITLE = 'ssli-tweak2-section-title';
  var CLS_SECTION_BODY = 'ssli-tweak2-section-body';
  var CLS_ROW = 'ssli-tweak2-row';
  var CLS_LABEL = 'ssli-tweak2-label';
  var CLS_VAL = 'ssli-tweak2-val';
  var CLS_SLIDER = 'ssli-tweak2-slider';
  var CLS_SELECT = 'ssli-tweak2-select';
  var CLS_OSC_ROW = 'ssli-tweak2-osc-row';
  var CLS_OSC_CELL = 'ssli-tweak2-osc-cell';
  var CLS_STUB = 'ssli-tweak2-stub';
  var CLS_LINK = 'ssli-tweak2-link';
  var CLS_ADDITIVE_BARS = 'ssli-tweak2-additive-bars';
  var CLS_ADDITIVE_BAR_STRIP = 'ssli-tweak2-additive-bar-strip';
  var CLS_ADDITIVE_BAR = 'ssli-tweak2-additive-bar';
  var CLS_ADDITIVE_BAR_NUM = 'ssli-tweak2-additive-bar-num';
  var CLS_ADDITIVE_PRESET_ROW = 'ssli-tweak2-additive-preset-row';
  var CLS_ADDITIVE_PRESET_BTN = 'ssli-tweak2-additive-preset-btn';

  // Tooltips
  var TIP_WAVE = 'The basic tone shape of this oscillator. Bright to mellow.';
  var TIP_OCTAVE = 'Transpose this oscillator up/down by whole octaves.';
  var TIP_DETUNE = 'Pitch offset in cents. Small amounts thicken the sound.';
  var TIP_OSC_LEVEL = 'How loud this oscillator is in the mix.';
  var TIP_NOISE_TYPE = 'Noise colour: white is bright hiss, brown is deep rumble.';
  var TIP_NOISE_LEVEL = 'How much noise gets mixed in with the oscillators.';

  // ============================================================
  // Inline SVG icons (ported style; simple 16x16 viewbox)
  // ============================================================

  var SVG_OPEN = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">';
  var SVG_CLOSE = '</svg>';

  var PARAM_SVGS = {
    Oscillators: SVG_OPEN + '<path d="M1 8 Q4 2 8 8 T15 8"/>' + SVG_CLOSE,
    Noise:       SVG_OPEN + '<path d="M1 10 L2 6 L3 11 L4 5 L5 10 L6 6 L7 11 L8 5 L9 10 L10 6 L11 11 L12 5 L13 10 L14 6 L15 11"/>' + SVG_CLOSE,
    Filter:      SVG_OPEN + '<path d="M1 4 H10 L15 12"/>' + SVG_CLOSE,
    Envelope:    SVG_OPEN + '<path d="M1 14 L4 3 L6 7 L12 7 L15 14"/>' + SVG_CLOSE,
    FM:          SVG_OPEN + '<circle cx="5" cy="8" r="3"/><circle cx="11" cy="8" r="3"/>' + SVG_CLOSE,
    Physical:    SVG_OPEN + '<path d="M2 2 L14 14 M2 14 L14 2"/>' + SVG_CLOSE,
    Grain:       SVG_OPEN + '<circle cx="4" cy="4" r="1"/><circle cx="9" cy="6" r="1"/><circle cx="13" cy="4" r="1"/><circle cx="5" cy="11" r="1"/><circle cx="11" cy="12" r="1"/>' + SVG_CLOSE,
    Generic:     SVG_OPEN + '<rect x="3" y="3" width="10" height="10"/>' + SVG_CLOSE
  };

  // ============================================================
  // State
  // ============================================================

  var _isInitialized = false;
  var _active = false;
  var _screenEl = null;
  var _isTestToneActive = false;
  var _testToneBtn = null;
  var _statusEl = null;

  // ============================================================
  // Small utilities
  // ============================================================

  function _getInstruments() {
    var result = null;
    if (SL.audio && SL.audio.getInstruments) {
      result = SL.audio.getInstruments();
    }
    return result;
  }

  function _getCurrentInstId() {
    var id = 0;
    if (SL.audio && SL.audio.getCurrentInstrument) {
      id = SL.audio.getCurrentInstrument();
    }
    return id;
  }

  function _getCurrentInstrument() {
    var insts = _getInstruments();
    var id = _getCurrentInstId();
    var inst = null;
    if (insts && insts[id]) {
      inst = insts[id];
    }
    return inst;
  }

  function _getEngineType() {
    var type = DEFAULT_ENGINE;
    if (SL.audio && SL.audio.getInstrumentType) {
      var raw = SL.audio.getInstrumentType(_getCurrentInstId());
      if (raw) {
        type = raw;
      }
    }
    return type;
  }

  function _getPresetName() {
    var inst = _getCurrentInstrument();
    var name = 'Preset';
    if (inst) {
      if (inst.settings && inst.settings.presetName) {
        name = inst.settings.presetName;
      } else if (inst.name) {
        name = inst.name;
      }
    }
    return name;
  }

  function _getCategory() {
    var inst = _getCurrentInstrument();
    var cat = '';
    if (inst) {
      if (inst.settings && inst.settings.category) {
        cat = inst.settings.category;
      } else if (inst.category) {
        cat = inst.category;
      }
    }
    return cat;
  }

  function _setStatus(msg) {
    if (_statusEl) {
      _statusEl.textContent = msg || '';
    }
  }

  function _notifyChange() {
    if (SL.state && SL.state.notify) {
      SL.state.notify('tweak');
    }
  }

  function _makeEmptySettingsObj() {
    return {};
  }
  function _makeEmptySourcesArray() {
    return [];
  }
  function _makeDefaultSourceEntry() {
    return { waveform: 'sine', detune: 0 };
  }

  function _cloneSettings(s) {
    var result = null;
    if (s) {
      result = JSON.parse(JSON.stringify(s));
    }
    return result;
  }

  // ============================================================
  // Shared helpers — exposed on SL.tweak2
  // ============================================================

  function createSliderRow(label, min, max, step, value, suffix, tooltip, onInput, i18nKey) {
    var row = document.createElement('div');
    row.className = CLS_ROW;

    var lbl = document.createElement('span');
    lbl.className = CLS_LABEL;
    lbl.textContent = i18nKey ? SL.t(i18nKey, label) : label;

    var slider = document.createElement('input');
    slider.type = 'range';
    slider.className = CLS_SLIDER;
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(value);
    slider.setAttribute('aria-label', label);

    var tip = tooltip ? tooltip : label;
    slider.title = tip;
    lbl.title = tip;
    row.title = tip;

    var valSpan = document.createElement('span');
    valSpan.className = CLS_VAL;
    var sfx = suffix ? suffix : '';
    valSpan.textContent = String(value) + sfx;

    slider.addEventListener('input', function() {
      var v = parseFloat(slider.value);
      valSpan.textContent = String(v) + sfx;
      if (onInput) {
        onInput(v);
      }
    });

    row.appendChild(lbl);
    row.appendChild(slider);
    row.appendChild(valSpan);
    return row;
  }

  function createSelectRow(label, options, selected, tooltip, onChange, translationPrefix) {
    var row = document.createElement('div');
    row.className = CLS_ROW;

    var lbl = document.createElement('span');
    lbl.className = CLS_LABEL;
    lbl.textContent = label;

    var sel = document.createElement('select');
    sel.className = CLS_SELECT;
    sel.setAttribute('aria-label', label);

    var tip = tooltip ? tooltip : label;
    sel.title = tip;
    lbl.title = tip;
    row.title = tip;

    for (var i = 0; i < options.length; i++) {
      var opt = document.createElement('option');
      var optVal;
      var optLabel;
      if (typeof options[i] === 'string') {
        optVal = options[i];
        optLabel = translationPrefix ? SL.t(translationPrefix + optVal, optVal) : optVal;
      } else {
        optVal = options[i].val;
        optLabel = translationPrefix ? SL.t(translationPrefix + optVal, options[i].label) : options[i].label;
      }
      opt.value = optVal;
      opt.textContent = optLabel;
      if (optVal === selected) {
        opt.selected = true;
      }
      sel.appendChild(opt);
    }

    sel.addEventListener('change', function() {
      if (onChange) {
        onChange(sel.value);
      }
    });

    row.appendChild(lbl);
    row.appendChild(sel);
    return row;
  }

  function createSection(icon, title) {
    var section = document.createElement('div');
    section.className = CLS_SECTION;

    var header = document.createElement('div');
    header.className = CLS_SECTION_HEADER;

    if (icon) {
      var iconSpan = document.createElement('span');
      iconSpan.className = 'ssli-tweak2-section-icon';
      iconSpan.innerHTML = icon; /* trusted: internal SVG constant from PARAM_SVGS */
      header.appendChild(iconSpan);
    }

    var titleSpan = document.createElement('span');
    titleSpan.className = CLS_SECTION_TITLE;
    titleSpan.textContent = title;
    header.appendChild(titleSpan);

    var body = document.createElement('div');
    body.className = CLS_SECTION_BODY;

    section.appendChild(header);
    section.appendChild(body);

    return { section: section, header: header, body: body };
  }

  // ============================================================
  // Accordion helper - only ONE section expanded at a time.
  // Applies uniformly at every viewport size.
  // ============================================================

  var ACCORDION_CARET_COLLAPSED = '\u25B8';
  var ACCORDION_CARET_EXPANDED  = '\u25BE';
  var CLS_ACCORDION            = 'ssli-tweak2-accordion';
  var CLS_ACCORDION_SECTION    = 'ssli-tweak2-accordion-section';
  var CLS_ACCORDION_HEADER     = 'ssli-tweak2-accordion-header';
  var CLS_ACCORDION_CARET      = 'ssli-tweak2-accordion-caret';
  var CLS_ACCORDION_BODY       = 'ssli-tweak2-accordion-body';
  var CLS_ACCORDION_EXPANDED   = 'expanded';

  function createAccordion(container) {
    var wrap = document.createElement('div');
    wrap.className = CLS_ACCORDION;
    container.appendChild(wrap);

    var entries = [];

    function _collapse(entry) {
      entry.body.classList.remove(CLS_ACCORDION_EXPANDED);
      entry.header.setAttribute('aria-expanded', 'false');
      entry.caret.textContent = ACCORDION_CARET_COLLAPSED;
    }
    function _expand(entry) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i] !== entry) {
          _collapse(entries[i]);
        }
      }
      entry.body.classList.add(CLS_ACCORDION_EXPANDED);
      entry.header.setAttribute('aria-expanded', 'true');
      entry.caret.textContent = ACCORDION_CARET_EXPANDED;
    }

    function _findByTitle(title) {
      var found = null;
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].title === title) {
          found = entries[i];
          break;
        }
      }
      return found;
    }

    function addSection(icon, title, opts) {
      var base = createSection(icon, title);

      base.header.classList.add(CLS_ACCORDION_HEADER);
      base.header.setAttribute('role', 'button');
      base.header.setAttribute('tabindex', '0');
      base.header.setAttribute('aria-expanded', 'false');

      var bodyId = 'ssli-tweak2-acc-body-' + Math.floor(Math.random() * 1e9).toString(36);
      base.body.id = bodyId;
      base.header.setAttribute('aria-controls', bodyId);

      base.section.classList.add(CLS_ACCORDION_SECTION);
      base.body.classList.add(CLS_ACCORDION_BODY);

      var caret = document.createElement('span');
      caret.className = CLS_ACCORDION_CARET;
      caret.textContent = ACCORDION_CARET_COLLAPSED;
      base.header.appendChild(caret);

      var entry = {
        title: title,
        section: base.section,
        header: base.header,
        body: base.body,
        caret: caret
      };
      entries.push(entry);

      base.header.addEventListener('click', function() {
        var isExpanded = base.body.classList.contains(CLS_ACCORDION_EXPANDED);
        if (isExpanded) {
          _collapse(entry);
        } else {
          _expand(entry);
        }
      });
      base.header.addEventListener('keydown', function(ev) {
        var key = ev.key;
        var isActivate = (key === 'Enter' || key === ' ');
        if (isActivate) {
          ev.preventDefault();
          var isOpen = base.body.classList.contains(CLS_ACCORDION_EXPANDED);
          if (isOpen) {
            _collapse(entry);
          } else {
            _expand(entry);
          }
        }
      });

      wrap.appendChild(base.section);

      var isFirst = (entries.length === 1);
      var wantExpand = isFirst;
      if (opts && opts.expanded === true) {
        wantExpand = true;
      }
      if (opts && opts.expanded === false) {
        wantExpand = false;
      }
      if (wantExpand) {
        _expand(entry);
      } else {
        _collapse(entry);
      }

      return { section: base.section, header: base.header, body: base.body };
    }

    function expand(title) {
      var e = _findByTitle(title);
      if (e) { _expand(e); }
    }
    function collapse(title) {
      var e = _findByTitle(title);
      if (e) { _collapse(e); }
    }
    function setDefault(title) {
      var e = _findByTitle(title);
      if (e) { _expand(e); }
    }

    return {
      addSection: addSection,
      expand: expand,
      collapse: collapse,
      setDefault: setDefault
    };
  }

  function createOscRow(idx, oscSettings, onChange) {
    var row = document.createElement('div');
    row.className = CLS_OSC_ROW;

    var idxCell = document.createElement('span');
    idxCell.className = CLS_OSC_CELL + ' ssli-tweak2-osc-idx';
    idxCell.textContent = SL.t('tweak.osc_prefix') + (idx + 1);
    row.appendChild(idxCell);

    // Wave select
    var waveCell = document.createElement('span');
    waveCell.className = CLS_OSC_CELL;
    var waveSel = document.createElement('select');
    waveSel.className = CLS_SELECT;
    waveSel.title = TIP_WAVE;
    for (var wi = 0; wi < OSC_WAVES.length; wi++) {
      var wopt = document.createElement('option');
      wopt.value = OSC_WAVES[wi];
      wopt.textContent = SL.t('waveform.' + OSC_WAVES[wi], OSC_WAVES[wi]);
      if (OSC_WAVES[wi] === oscSettings.wave) {
        wopt.selected = true;
      }
      waveSel.appendChild(wopt);
    }
    waveSel.addEventListener('change', function() {
      if (onChange) {
        onChange('wave', waveSel.value);
      }
    });
    waveCell.appendChild(waveSel);
    row.appendChild(waveCell);

    // Octave slider
    var octCell = document.createElement('span');
    octCell.className = CLS_OSC_CELL;
    octCell.appendChild(createSliderRow('Oct', OSC_OCT_MIN, OSC_OCT_MAX, OSC_OCT_STEP, oscSettings.oct, '', TIP_OCTAVE, function(v) {
      if (onChange) { onChange('oct', v); }
    }, 'tweak.oct'));
    row.appendChild(octCell);

    // Detune slider
    var detCell = document.createElement('span');
    detCell.className = CLS_OSC_CELL;
    detCell.appendChild(createSliderRow('Det', OSC_DETUNE_MIN, OSC_DETUNE_MAX, OSC_DETUNE_STEP, oscSettings.detune, ' ct', TIP_DETUNE, function(v) {
      if (onChange) { onChange('detune', v); }
    }, 'tweak.det'));
    row.appendChild(detCell);

    // Level slider
    var lvlCell = document.createElement('span');
    lvlCell.className = CLS_OSC_CELL;
    lvlCell.appendChild(createSliderRow('Lvl', OSC_LEVEL_MIN, OSC_LEVEL_MAX, OSC_LEVEL_STEP, oscSettings.level, '%', TIP_OSC_LEVEL, function(v) {
      if (onChange) { onChange('level', v); }
    }, 'tweak.lvl'));
    row.appendChild(lvlCell);

    return row;
  }

  // ============================================================
  // Safe settings-bag read fallback
  // ============================================================

  function _safeSettingsGet(key) {
    var inst = _getCurrentInstrument();
    var bag = null;
    var hasSettingsBag = inst && inst.settings && inst.settings[key];
    if (hasSettingsBag) {
      bag = inst.settings[key];
    }
    return bag;
  }

  function _safeSettingsSet(key, obj) {
    var inst = _getCurrentInstrument();
    if (inst && inst.settings) {
      inst.settings[key] = obj;
    }
  }

  // ============================================================
  // Stub builder (all non-subtractive engines for v2)
  // ============================================================

  function _buildStubPanel(container, ctx) {
    var acc = createAccordion(container);
    var info = acc.addSection(PARAM_SVGS.Generic, ctx.label + ' Engine');
    var stub = document.createElement('div');
    stub.className = CLS_STUB;
    stub.textContent = SL.t('screen.tweak.panelFor') + ' ' + ctx.engineType + ' — ' + SL.t('screen.tweak.notYetImplemented');
    info.body.appendChild(stub);
  }

  // ============================================================
  // Subtractive panel — full implementation
  // ============================================================

  function _buildSubtractivePanel(container, ctx) {
    var inst = _getCurrentInstrument();
    var hasSubtractive = Boolean(inst && inst.settings);

    if (!hasSubtractive) {
      var warn = document.createElement('div');
      warn.className = CLS_STUB;
      warn.textContent = SL.t('tweak.no_subtractive');
      container.appendChild(warn);
    } else {
      var settings = inst.settings;

      // Oscillators section
      var acc = createAccordion(container);
      var oscSec = acc.addSection(PARAM_SVGS.Oscillators, SL.t('tweak.oscillators', 'Oscillators'));
      var hasOscArr = Boolean(settings.osc && settings.osc.length);
      if (!hasOscArr) {
        var oscNote = document.createElement('div');
        oscNote.className = CLS_STUB;
        oscNote.textContent = SL.t('tweak.no_oscillators');
        oscSec.body.appendChild(oscNote);
      } else {
        for (var oi = 0; oi < settings.osc.length; oi++) {
          (function(idx) {
            var osc = settings.osc[idx];
            var row = createOscRow(idx, osc, function(field, value) {
              var cur = _getCurrentInstrument();
              var hasOscForIdx = cur && cur.settings && cur.settings.osc;
              var canWriteOscField = hasOscForIdx && cur.settings.osc[idx];
              if (canWriteOscField) {
                cur.settings.osc[idx][field] = value;
                _notifyChange();
              }
            });
            oscSec.body.appendChild(row);
          })(oi);
        }
      }

      // Noise section
      var noiseSec = acc.addSection(PARAM_SVGS.Noise, SL.t('tweak.noise', 'Noise'));
      var hasNoise = Boolean(settings.noise);
      if (!hasNoise) {
        var noiseNote = document.createElement('div');
        noiseNote.className = CLS_STUB;
        noiseNote.textContent = SL.t('tweak.no_noise');
        noiseSec.body.appendChild(noiseNote);
      } else {
        noiseSec.body.appendChild(createSelectRow('Type', NOISE_TYPES, settings.noise.type, TIP_NOISE_TYPE, function(v) {
          var cur = _getCurrentInstrument();
          var hasNoiseForType = cur && cur.settings && cur.settings.noise;
          if (hasNoiseForType) {
            cur.settings.noise.type = v;
            _notifyChange();
          }
        }));
        noiseSec.body.appendChild(createSliderRow('Level', NOISE_LEVEL_MIN, NOISE_LEVEL_MAX, NOISE_LEVEL_STEP, settings.noise.level, '%', TIP_NOISE_LEVEL, function(v) {
          var cur = _getCurrentInstrument();
          var hasNoiseForLevel = cur && cur.settings && cur.settings.noise;
          if (hasNoiseForLevel) {
            cur.settings.noise.level = v;
            _notifyChange();
          }
        }, 'tweak.lvl'));
      }

      // Shape link stays OUTSIDE the accordion (compact, at bottom)
      _appendShapeLink(container);
    }
  }

  // ============================================================
  // Shape-link helper (used by FM + Physical panels)
  // ============================================================

  function _appendShapeLink(container) {
    var row = document.createElement('div');
    row.className = 'ssli-tweak2-shape-link-row';
    var shapeBtn = document.createElement('button');
    shapeBtn.type = 'button';
    shapeBtn.className = CLS_BTN + ' ' + CLS_LINK;
    shapeBtn.textContent = SL.t('tweak.shape_link');
    shapeBtn.title = SL.t('screen.tweak.jumpToShapeTitle');
    shapeBtn.addEventListener('click', function() {
      if (SL.screens && SL.screens.switchTo) {
        SL.screens.switchTo(SCREEN_NAME_SHAPE);
      }
    });
    row.appendChild(shapeBtn);
    container.appendChild(row);
  }

  // ============================================================
  // FM panel — full implementation
  // ============================================================

  function _ensureFMSettings(instId) {
    var settings = null;
    if (SL.audio && SL.audio.getFMSettings) {
      settings = SL.audio.getFMSettings(instId);
    }
    // If settings bag is missing (fresh fm instrument), seed defaults via setter
    var needsSeed = !settings || !settings.operators || settings.operators.length < FM_OPERATOR_COUNT;
    var canSeedFm = SL.audio && SL.audio.setFMSettings;
    var shouldSeedFm = needsSeed && canSeedFm;
    if (shouldSeedFm) {
      var seeded = {
        algorithm: (settings && settings.algorithm) ? settings.algorithm : 1,
        feedback: (settings && settings.feedback != null) ? settings.feedback : 0,
        operators: []
      };
      var hadOps = Boolean(settings && settings.operators);
      for (var oi = 0; oi < FM_OPERATOR_COUNT; oi++) {
        var existingOp = hadOps ? settings.operators[oi] : null;
        if (existingOp) {
          seeded.operators.push(existingOp);
        } else {
          seeded.operators.push({
            wave: 'sine',
            ratioCoarse: 1,
            ratioFine: 0,
            level: (oi === 0) ? 99 : 0,
            detune: 7,
            velocitySens: 0,
            rateScaling: 0,
            envelope: { R1: 95, R2: 50, R3: 50, R4: 50, L1: 99, L2: 99, L3: 99, L4: 0 }
          });
        }
      }
      SL.audio.setFMSettings(instId, seeded);
      settings = SL.audio.getFMSettings(instId);
    }
    return settings;
  }

  function _writeFMOperator(instId, opIdx, field, value) {
    var current = SL.audio.getFMSettings(instId);
    var hasFmOperator = current && current.operators && current.operators[opIdx];
    if (hasFmOperator) {
      var ops = current.operators.slice();
      var opCopy = {};
      for (var k in ops[opIdx]) {
        if (ops[opIdx].hasOwnProperty(k)) {
          opCopy[k] = ops[opIdx][k];
        }
      }
      opCopy[field] = value;
      ops[opIdx] = opCopy;
      SL.audio.setFMSettings(instId, { operators: ops });
    }
  }

  function _makeEmptyOpData() {
    return {};
  }

  function _buildFMOperatorStrip(instId, opIdx, opSettings) {
    var strip = document.createElement('div');
    strip.className = 'fm-op-strip';
    strip.setAttribute('data-op', String(opIdx + 1));

    var header = document.createElement('div');
    header.className = 'fm-op-header';
    header.textContent = SL.t('tweak.op_prefix') + (opIdx + 1);
    strip.appendChild(header);

    // Wave select row
    var waveValue = opSettings.wave ? opSettings.wave : 'sine';
    strip.appendChild(createSelectRow('Wave', FM_WAVES, waveValue, TIP_FM_OP_WAVE, function(v) {
      _writeFMOperator(instId, opIdx, 'wave', v);
    }, 'waveform.'));

    // Ratio (coarse) slider
    var ratioCoarse = (opSettings.ratioCoarse != null) ? opSettings.ratioCoarse : 1;
    strip.appendChild(createSliderRow('Ratio', FM_RATIO_COARSE_MIN, FM_RATIO_COARSE_MAX, FM_RATIO_COARSE_STEP, ratioCoarse, '', TIP_FM_OP_RATIO_COARSE, function(v) {
      _writeFMOperator(instId, opIdx, 'ratioCoarse', v);
    }));

    // Ratio (fine) slider
    var ratioFine = (opSettings.ratioFine != null) ? opSettings.ratioFine : 0;
    strip.appendChild(createSliderRow('Fine', FM_RATIO_FINE_MIN, FM_RATIO_FINE_MAX, FM_RATIO_FINE_STEP, ratioFine, '', TIP_FM_OP_RATIO_FINE, function(v) {
      _writeFMOperator(instId, opIdx, 'ratioFine', v);
    }));

    // Level slider
    var levelValue = (opSettings.level != null) ? opSettings.level : 0;
    strip.appendChild(createSliderRow('Level', FM_LEVEL_MIN, FM_LEVEL_MAX, FM_LEVEL_STEP, levelValue, '', TIP_FM_OP_LEVEL, function(v) {
      _writeFMOperator(instId, opIdx, 'level', v);
    }));

    // Detune slider
    var detuneValue = (opSettings.detune != null) ? opSettings.detune : 7;
    strip.appendChild(createSliderRow('Detune', FM_DETUNE_MIN, FM_DETUNE_MAX, FM_DETUNE_STEP, detuneValue, '', TIP_FM_OP_DETUNE, function(v) {
      _writeFMOperator(instId, opIdx, 'detune', v);
    }));

    return strip;
  }

  function _buildFMPanel(container, ctx) {
    var instId = ctx.instId;
    var settings = _ensureFMSettings(instId);
    if (!settings) {
      var warn = document.createElement('div');
      warn.className = CLS_STUB;
      warn.textContent = SL.t('tweak.no_fm');
      container.appendChild(warn);
    } else {
    // Algorithm + feedback section
    var acc = createAccordion(container);
    var algoSec = acc.addSection(PARAM_SVGS.FM, 'FM Algorithm');

    // Algorithm dropdown
    var algoOptions = [];
    for (var a = FM_ALGORITHM_MIN; a <= FM_ALGORITHM_MAX; a++) {
      algoOptions.push({ val: String(a), label: String(a) });
    }
    var algoInitial = String(settings.algorithm || 1);
    algoSec.body.appendChild(createSelectRow('Algorithm', algoOptions, algoInitial, TIP_FM_ALGORITHM, function(v) {
      var parsed = parseInt(v, 10);
      if (!isNaN(parsed)) {
        SL.audio.setFMSettings(instId, { algorithm: parsed });
      }
    }));

    // Global feedback slider
    var fbInitial = (settings.feedback != null) ? settings.feedback : 0;
    algoSec.body.appendChild(createSliderRow('Feedback', FM_FEEDBACK_MIN, FM_FEEDBACK_MAX, FM_FEEDBACK_STEP, fbInitial, '', TIP_FM_FEEDBACK, function(v) {
      SL.audio.setFMSettings(instId, { feedback: v });
    }));


    // Operator grid section
    var opSec = acc.addSection(PARAM_SVGS.FM, 'Operators (1..6)');
    var opGrid = document.createElement('div');
    opGrid.className = 'fm-operators';
    for (var i = 0; i < FM_OPERATOR_COUNT; i++) {
      var opData = settings.operators[i] ? settings.operators[i] : _makeEmptyOpData();
      opGrid.appendChild(_buildFMOperatorStrip(instId, i, opData));
    }
    opSec.body.appendChild(opGrid);

    // Shape link
    _appendShapeLink(container);
    }
  }

  // ============================================================
  // Physical panel — full implementation
  // ============================================================

  function _ensurePhysicalSettings(instId) {
    var settings = null;
    if (SL.audio && SL.audio.getPhysicalSettings) {
      settings = SL.audio.getPhysicalSettings(instId);
    }
    return settings;
  }

  function _writePhysical(instId, field, value) {
    var patch = {};
    patch[field] = value;
    if (SL.audio && SL.audio.setPhysicalSettings) {
      SL.audio.setPhysicalSettings(instId, patch);
    }
  }

  function _physSlider(container, label, value, tooltip, instId, field) {
    var row = createSliderRow(label, PHYS_KNOB_MIN, PHYS_KNOB_MAX, PHYS_KNOB_STEP, value, '%', tooltip, function(v) {
      _writePhysical(instId, field, v);
    });
    container.appendChild(row);
  }

  function _buildPhysicalCommon(body, instId, settings) {
    var damping = (settings.damping != null) ? settings.damping : 50;
    var brightness = (settings.brightness != null) ? settings.brightness : 60;
    var human = (settings.humanization != null) ? settings.humanization : 0;

    _physSlider(body, 'Damping', damping, TIP_PHYS_DAMPING, instId, 'damping');
    _physSlider(body, 'Brightness', brightness, TIP_PHYS_BRIGHTNESS, instId, 'brightness');

    var humanRow = createSliderRow('Humanise', PHYS_HUMAN_MIN, PHYS_HUMAN_MAX, PHYS_HUMAN_STEP, human, '%', TIP_PHYS_HUMAN, function(v) {
      _writePhysical(instId, 'humanization', v);
    });
    body.appendChild(humanRow);
  }

  function _buildPhysicalPluck(body, instId, settings) {
    var excitation = settings.excitation ? settings.excitation : 'noise';
    body.appendChild(createSelectRow('Excitation', PHYS_EXCITATION_TYPES, excitation, TIP_PHYS_EXCITATION, function(v) {
      _writePhysical(instId, 'excitation', v);
    }));
    var bodySize = (settings.bodySize != null) ? settings.bodySize : 50;
    var decayTime = (settings.decayTime != null) ? settings.decayTime : 70;
    _physSlider(body, 'Body Size', bodySize, TIP_PHYS_BODY, instId, 'bodySize');
    _physSlider(body, 'Decay', decayTime, TIP_PHYS_DECAY, instId, 'decayTime');
  }

  function _buildPhysicalBow(body, instId, settings) {
    var bowPressure = (settings.bowPressure != null) ? settings.bowPressure : 50;
    var bowPosition = (settings.bowPosition != null) ? settings.bowPosition : 50;
    _physSlider(body, 'Bow Pressure', bowPressure, TIP_PHYS_BOW_PRESSURE, instId, 'bowPressure');
    _physSlider(body, 'Bow Position', bowPosition, TIP_PHYS_BOW_POSITION, instId, 'bowPosition');
  }

  function _buildPhysicalBlow(body, instId, settings) {
    var breath = (settings.breathPressure != null) ? settings.breathPressure : 50;
    var embouchure = (settings.embouchure != null) ? settings.embouchure : 50;
    _physSlider(body, 'Breath', breath, TIP_PHYS_BREATH, instId, 'breathPressure');
    _physSlider(body, 'Embouchure', embouchure, TIP_PHYS_EMBOUCHURE, instId, 'embouchure');
  }

  function _buildPhysicalStrike(body, instId, settings) {
    var strikePos = (settings.strikePosition != null) ? settings.strikePosition : 50;
    var hardness = (settings.hardness != null) ? settings.hardness : 50;
    var decayTime = (settings.decayTime != null) ? settings.decayTime : 70;
    _physSlider(body, 'Strike Pos', strikePos, TIP_PHYS_STRIKE_POS, instId, 'strikePosition');
    _physSlider(body, 'Hardness', hardness, TIP_PHYS_HARDNESS, instId, 'hardness');
    _physSlider(body, 'Decay', decayTime, TIP_PHYS_DECAY, instId, 'decayTime');
    var material = settings.material ? settings.material : 'metal';
    body.appendChild(createSelectRow('Material', PHYS_MATERIALS, material, TIP_PHYS_MATERIAL, function(v) {
      _writePhysical(instId, 'material', v);
    }));
  }

  function _buildPhysicalPanel(container, ctx) {
    var instId = ctx.instId;
    var settings = _ensurePhysicalSettings(instId);
    if (!settings) {
      var warn = document.createElement('div');
      warn.className = CLS_STUB;
      warn.textContent = SL.t('tweak.no_physical');
      container.appendChild(warn);
    } else {
    // Model selector
    var acc = createAccordion(container);
    var modelSec = acc.addSection(PARAM_SVGS.Physical, 'Physical Model');
    var currentModel = settings.model ? settings.model : 'pluck';
    modelSec.body.appendChild(createSelectRow('Model', PHYS_MODELS, currentModel, TIP_PHYS_MODEL, function(v) {
      _writePhysical(instId, 'model', v);
      _rebuild();
    }));

    // Common knobs section
    var commonSec = acc.addSection(PARAM_SVGS.Physical, 'Resonator');
    _buildPhysicalCommon(commonSec.body, instId, settings);

    // Per-model knobs
    var modelSpecificSec = acc.addSection(PARAM_SVGS.Physical, 'Model Parameters');
    if (currentModel === 'pluck') {
      _buildPhysicalPluck(modelSpecificSec.body, instId, settings);
    } else if (currentModel === 'bow') {
      _buildPhysicalBow(modelSpecificSec.body, instId, settings);
    } else if (currentModel === 'blow') {
      _buildPhysicalBlow(modelSpecificSec.body, instId, settings);
    } else if (currentModel === 'strike') {
      _buildPhysicalStrike(modelSpecificSec.body, instId, settings);
    } else {
      var note = document.createElement('div');
      note.className = CLS_STUB;
      note.textContent = SL.t('screen.tweak.unknownModel') + ' ' + currentModel;
      modelSpecificSec.body.appendChild(note);
    }

    // Shape link
    _appendShapeLink(container);
    }
  }

  // ============================================================
  // Additive panel — full implementation
  // ============================================================

  function _ensureAdditiveSettings(instId) {
    var settings = null;
    if (SL.audio && SL.audio.getAdditiveSettings) {
      settings = SL.audio.getAdditiveSettings(instId);
    }
    var needsSeed = !settings || !settings.partials || settings.partials.length < ADDITIVE_PARTIAL_COUNT;
    var canSeedAdditive = SL.audio && SL.audio.setAdditiveSettings;
    var shouldSeedAdditive = needsSeed && canSeedAdditive;
    if (shouldSeedAdditive) {
      var seeded = {
        partials: [],
        spread: (settings && settings.spread != null) ? settings.spread : ADDITIVE_SPREAD_DEFAULT,
        decay: (settings && settings.decay != null) ? settings.decay : ADDITIVE_DECAY_DEFAULT
      };
      var hadPartials = Boolean(settings && settings.partials);
      for (var pi = 0; pi < ADDITIVE_PARTIAL_COUNT; pi++) {
        var existing = hadPartials ? settings.partials[pi] : null;
        if (existing) {
          seeded.partials.push(existing);
        } else {
          seeded.partials.push({
            amplitude: (pi === 0) ? ADDITIVE_AMP_FULL : ADDITIVE_AMP_ZERO,
            ratio: pi + 1,
            phase: 0
          });
        }
      }
      SL.audio.setAdditiveSettings(instId, seeded);
      settings = SL.audio.getAdditiveSettings(instId);
    }
    return settings;
  }

  function _emptyPartialsList() {
    return [];
  }
  function _makeEmptyPartialsCopy() {
    return [];
  }

  function _computePresetPartials(presetName) {
    var out = [];
    var idx;
    var harmonic;
    var amp;
    for (idx = 0; idx < ADDITIVE_PARTIAL_COUNT; idx++) {
      harmonic = idx + 1;
      var safeHarmonic = harmonic || 1;
      amp = ADDITIVE_AMP_ZERO;
      if (presetName === 'Saw') {
        amp = ADDITIVE_AMP_FULL / safeHarmonic;
      } else if (presetName === 'Square') {
        var isOddSq = ((harmonic % 2) === 1);
        if (isOddSq) {
          amp = ADDITIVE_AMP_FULL / safeHarmonic;
        } else {
          amp = ADDITIVE_AMP_ZERO;
        }
      } else if (presetName === 'Triangle') {
        var isOddTri = ((harmonic % 2) === 1);
        if (isOddTri) {
          amp = ADDITIVE_AMP_FULL / (safeHarmonic * safeHarmonic);
        } else {
          amp = ADDITIVE_AMP_ZERO;
        }
      } else if (presetName === 'Sine') {
        if (idx === 0) {
          amp = ADDITIVE_AMP_FULL;
        } else {
          amp = ADDITIVE_AMP_ZERO;
        }
      } else if (presetName === 'Odd') {
        var isOddOnly = ((harmonic % 2) === 1);
        if (isOddOnly) {
          amp = ADDITIVE_AMP_FULL / safeHarmonic;
        } else {
          amp = ADDITIVE_AMP_ZERO;
        }
      } else if (presetName === 'Even') {
        var isEvenOnly = ((harmonic % 2) === 0);
        if (isEvenOnly) {
          amp = ADDITIVE_AMP_FULL / safeHarmonic;
        } else if (idx === 0) {
          amp = ADDITIVE_AMP_FULL;
        } else {
          amp = ADDITIVE_AMP_ZERO;
        }
      } else if (presetName === 'Random') {
        amp = Math.random() * Math.pow(ADDITIVE_RANDOM_DECAY, idx);
      }
      out.push(amp);
    }
    return out;
  }

  function _applyAdditivePartialAmp(instId, partials, idx, ampNorm) {
    var newPartials = partials.slice();
    newPartials[idx] = {
      amplitude: ampNorm,
      ratio: partials[idx].ratio,
      phase: partials[idx].phase
    };
    SL.audio.setAdditiveSettings(instId, { partials: newPartials });
  }

  function _buildAdditivePanel(container, ctx) {
    var instId = ctx.instId;
    var settings = _ensureAdditiveSettings(instId);
    var hasSettings = Boolean(settings && settings.partials);

    if (!hasSettings) {
      var warn = document.createElement('div');
      warn.className = CLS_STUB;
      warn.textContent = SL.t('tweak.no_additive');
      container.appendChild(warn);
    } else {
      // Preset-shape buttons
      var acc = createAccordion(container);
      var presetSec = acc.addSection(PARAM_SVGS.Oscillators, 'Preset Shapes');
      var presetRow = document.createElement('div');
      presetRow.className = CLS_ADDITIVE_PRESET_ROW;
      presetSec.body.appendChild(presetRow);

      // Partial bars section
      var barsSec = acc.addSection(PARAM_SVGS.Oscillators, 'Partials (' + ADDITIVE_PARTIAL_COUNT + ')');
      var barsWrap = document.createElement('div');
      barsWrap.className = CLS_ADDITIVE_BARS;
      barsSec.body.appendChild(barsWrap);

      // Track bar DOM refs for preset refresh
      var barEls = [];

      for (var bi = 0; bi < ADDITIVE_PARTIAL_COUNT; bi++) {
        (function(idx) {
          var strip = document.createElement('div');
          strip.className = CLS_ADDITIVE_BAR_STRIP;

          var partial = settings.partials[idx];
          var initAmp = ADDITIVE_AMP_ZERO;
          if (partial && partial.amplitude != null) {
            initAmp = partial.amplitude;
          }
          var initBarVal = Math.round(initAmp * ADDITIVE_PERCENT_SCALE);

          var bar = document.createElement('input');
          bar.type = 'range';
          bar.className = CLS_ADDITIVE_BAR;
          bar.min = String(ADDITIVE_BAR_MIN);
          bar.max = String(ADDITIVE_BAR_MAX);
          bar.step = String(ADDITIVE_BAR_STEP);
          bar.value = String(initBarVal);
          bar.setAttribute('orient', 'vertical');
          bar.setAttribute('aria-label', SL.t('screen.tweak.partial') + ' ' + (idx + 1));
          bar.title = TIP_ADDITIVE_BAR + ' (partial ' + (idx + 1) + ')';
          bar.setAttribute('data-partial', String(idx));

          bar.addEventListener('input', function() {
            var pct = parseFloat(bar.value);
            var ampNorm = pct / ADDITIVE_PERCENT_SCALE;
            var cur = SL.audio.getAdditiveSettings(instId);
            var hasPartialForIdx = cur && cur.partials && cur.partials[idx];
            if (hasPartialForIdx) {
              _applyAdditivePartialAmp(instId, cur.partials, idx, ampNorm);
              _notifyChange();
            }
          });

          var numLabel = document.createElement('span');
          numLabel.className = CLS_ADDITIVE_BAR_NUM;
          numLabel.textContent = String(idx + 1);

          strip.appendChild(bar);
          strip.appendChild(numLabel);
          barsWrap.appendChild(strip);
          barEls.push(bar);
        })(bi);
      }

      // Populate preset buttons (after barEls exist)
      for (var prI = 0; prI < ADDITIVE_PRESETS.length; prI++) {
        (function(presetName) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = CLS_BTN + ' ' + CLS_ADDITIVE_PRESET_BTN;
          btn.textContent = presetName;
          btn.title = TIP_ADDITIVE_PRESET + ' (' + presetName + ')';
          btn.addEventListener('click', function() {
            var newAmps = _computePresetPartials(presetName);
            var cur = SL.audio.getAdditiveSettings(instId);
            var existingPartials = (cur && cur.partials) ? cur.partials : _emptyPartialsList();
            var newPartials = _makeEmptyPartialsCopy();
            for (var k = 0; k < ADDITIVE_PARTIAL_COUNT; k++) {
              var oldRatio = (existingPartials[k] && existingPartials[k].ratio != null) ? existingPartials[k].ratio : (k + 1);
              var oldPhase = (existingPartials[k] && existingPartials[k].phase != null) ? existingPartials[k].phase : 0;
              newPartials.push({
                amplitude: newAmps[k],
                ratio: oldRatio,
                phase: oldPhase
              });
            }
            SL.audio.setAdditiveSettings(instId, { partials: newPartials });
            // Refresh bar DOM values
            for (var m = 0; m < barEls.length; m++) {
              barEls[m].value = String(Math.round(newAmps[m] * ADDITIVE_PERCENT_SCALE));
            }
            _notifyChange();
          });
          presetRow.appendChild(btn);
        })(ADDITIVE_PRESETS[prI]);
      }

      // Global per-partial-group params (spread / decay)
      var globalSec = acc.addSection(PARAM_SVGS.Generic, 'Partial Group');
      var initSpread = (settings.spread != null) ? settings.spread : ADDITIVE_SPREAD_DEFAULT;
      var initDecay = (settings.decay != null) ? settings.decay : ADDITIVE_DECAY_DEFAULT;

      globalSec.body.appendChild(createSliderRow('Spread', ADDITIVE_SPREAD_MIN, ADDITIVE_SPREAD_MAX, ADDITIVE_SPREAD_STEP, initSpread, '%', TIP_ADDITIVE_SPREAD, function(v) {
        SL.audio.setAdditiveSettings(instId, { spread: v });
        _notifyChange();
      }));
      globalSec.body.appendChild(createSliderRow('Decay', ADDITIVE_DECAY_MIN, ADDITIVE_DECAY_MAX, ADDITIVE_DECAY_STEP, initDecay, '%', TIP_ADDITIVE_DECAY, function(v) {
        SL.audio.setAdditiveSettings(instId, { decay: v });
        _notifyChange();
      }));
    }

    // Shape link (ADSR / filter / noise live on Shape)
    _appendShapeLink(container);
  }

  // ============================================================
  // Granular panel — full implementation
  // ============================================================

  function _ensureGranularSettings(instId) {
    var settings = null;
    if (SL.audio && SL.audio.getGranularSettings) {
      settings = SL.audio.getGranularSettings(instId);
    }
    var needsSeed = !settings;
    var canSeedGranular = SL.audio && SL.audio.setGranularSettings;
    var shouldSeedGranular = needsSeed && canSeedGranular;
    if (shouldSeedGranular) {
      var seeded = {
        sourceWaveform: 'sine',
        grainSize: GRAN_SIZE_DEFAULT,
        density: GRAN_DENSITY_DEFAULT,
        position: GRAN_POSITION_DEFAULT,
        pitchScatter: GRAN_PITCH_DEFAULT,
        positionScatter: GRAN_SPREAD_DEFAULT,
        windowShape: 'hann',
        freeze: false
      };
      SL.audio.setGranularSettings(instId, seeded);
      settings = SL.audio.getGranularSettings(instId);
    }
    return settings;
  }

  function _buildGranularPanel(container, ctx) {
    var instId = ctx.instId;
    var settings = _ensureGranularSettings(instId);
    var hasSettings = Boolean(settings);

    if (!hasSettings) {
      var warn = document.createElement('div');
      warn.className = CLS_STUB;
      warn.textContent = SL.t('tweak.no_granular');
      container.appendChild(warn);
    } else {
      // Source / slot selector
      var acc = createAccordion(container);
      var srcSec = acc.addSection(PARAM_SVGS.Oscillators, 'Source');
      var curSource = settings.sourceWaveform ? settings.sourceWaveform : 'sine';
      srcSec.body.appendChild(createSelectRow('Source', GRAN_SOURCES, curSource, TIP_GRAN_SOURCE, function(v) {
        SL.audio.setGranularSettings(instId, { sourceWaveform: v });
        _notifyChange();
      }));

      // Grain params
      var grainSec = acc.addSection(PARAM_SVGS.Grain, 'Grain Params');

      var initSize = (settings.grainSize != null) ? settings.grainSize : GRAN_SIZE_DEFAULT;
      grainSec.body.appendChild(createSliderRow('Size', GRAN_SIZE_MIN, GRAN_SIZE_MAX, GRAN_SIZE_STEP, initSize, ' ms', TIP_GRAN_SIZE, function(v) {
        SL.audio.setGranularSettings(instId, { grainSize: v });
        _notifyChange();
      }));

      var initDensity = (settings.density != null) ? settings.density : GRAN_DENSITY_DEFAULT;
      grainSec.body.appendChild(createSliderRow('Density', GRAN_DENSITY_MIN, GRAN_DENSITY_MAX, GRAN_DENSITY_STEP, initDensity, '/s', TIP_GRAN_DENSITY, function(v) {
        SL.audio.setGranularSettings(instId, { density: v });
        _notifyChange();
      }));

      var initPos = (settings.position != null) ? settings.position : GRAN_POSITION_DEFAULT;
      grainSec.body.appendChild(createSliderRow('Position', GRAN_POSITION_MIN, GRAN_POSITION_MAX, GRAN_POSITION_STEP, initPos, '%', TIP_GRAN_POSITION, function(v) {
        SL.audio.setGranularSettings(instId, { position: v });
        _notifyChange();
      }));

      var initPitch = (settings.pitchScatter != null) ? settings.pitchScatter : GRAN_PITCH_DEFAULT;
      grainSec.body.appendChild(createSliderRow('Pitch', GRAN_PITCH_MIN, GRAN_PITCH_MAX, GRAN_PITCH_STEP, initPitch, ' st', TIP_GRAN_PITCH, function(v) {
        SL.audio.setGranularSettings(instId, { pitchScatter: v });
        _notifyChange();
      }));

      var initSpread = (settings.positionScatter != null) ? settings.positionScatter : GRAN_SPREAD_DEFAULT;
      grainSec.body.appendChild(createSliderRow('Spread', GRAN_SPREAD_MIN, GRAN_SPREAD_MAX, GRAN_SPREAD_STEP, initSpread, '%', TIP_GRAN_SPREAD, function(v) {
        SL.audio.setGranularSettings(instId, { positionScatter: v });
        _notifyChange();
      }));

      var curWindow = settings.windowShape ? settings.windowShape : 'hann';
      grainSec.body.appendChild(createSelectRow('Window', GRAN_WINDOW_SHAPES, curWindow, TIP_GRAN_WINDOW, function(v) {
        SL.audio.setGranularSettings(instId, { windowShape: v });
        _notifyChange();
      }));

      // Panel-local Freeze button (does NOT touch topFreezeBtn)
      var freezeRow = document.createElement('div');
      freezeRow.className = CLS_ROW;
      var freezeLbl = document.createElement('span');
      freezeLbl.className = CLS_LABEL;
      freezeLbl.textContent = SL.t('tweak.freeze');
      freezeLbl.title = TIP_GRAN_FREEZE;

      var freezeBtn = document.createElement('button');
      freezeBtn.type = 'button';
      freezeBtn.className = CLS_BTN;
      freezeBtn.title = TIP_GRAN_FREEZE;
      var initFrozen = Boolean(settings.freeze);
      if (initFrozen) {
        freezeBtn.classList.add(CLS_BTN_ACTIVE);
        freezeBtn.textContent = SL.t('tweak.frozen');
      } else {
        freezeBtn.textContent = SL.t('tweak.free');
      }
      freezeBtn.addEventListener('click', function() {
        var cur = SL.audio.getGranularSettings(instId);
        var wasFrozen = Boolean(cur && cur.freeze);
        var nowFrozen = !wasFrozen;
        SL.audio.setGranularSettings(instId, { freeze: nowFrozen });
        if (nowFrozen) {
          freezeBtn.classList.add(CLS_BTN_ACTIVE);
          freezeBtn.textContent = SL.t('tweak.frozen');
        } else {
          freezeBtn.classList.remove(CLS_BTN_ACTIVE);
          freezeBtn.textContent = SL.t('tweak.free');
        }
        _notifyChange();
      });

      freezeRow.appendChild(freezeLbl);
      freezeRow.appendChild(freezeBtn);
      grainSec.body.appendChild(freezeRow);

    }

    // Shape link
    _appendShapeLink(container);
  }

  // ============================================================
  // Wavefolder panel
  // ============================================================

  function _writeWavefold(instId, field, value) {
    var patch = {};
    patch[field] = value;
    if (SL.audio && SL.audio.setWavefoldSettings) {
      SL.audio.setWavefoldSettings(instId, patch);
    }
  }

  function _buildWavefolderPanel(container, ctx) {
    var instId = ctx.instId;
    var settings = null;
    if (SL.audio && SL.audio.getWavefoldSettings) {
      settings = SL.audio.getWavefoldSettings(instId);
    }
    if (!settings) {
      var warn = document.createElement('div');
      warn.className = CLS_STUB;
      warn.textContent = SL.t('tweak.no_wavefolder');
      container.appendChild(warn);
    } else {
      var acc = createAccordion(container);
      var sec = acc.addSection(PARAM_SVGS.Generic, 'Wavefolder');

      var srcValue = settings.source ? settings.source : 'sine';
      sec.body.appendChild(createSelectRow('Source', WF_SOURCES, srcValue, TIP_WF_SOURCE, function(v) {
        _writeWavefold(instId, 'source', v);
      }));

      var foldValue = (settings.foldAmount != null) ? settings.foldAmount : 4;
      sec.body.appendChild(createSliderRow('Fold Amount', WF_FOLD_MIN, WF_FOLD_MAX, WF_FOLD_STEP, foldValue, 'x', TIP_WF_FOLD, function(v) {
        _writeWavefold(instId, 'foldAmount', v);
      }));

      var symValue = (settings.symmetry != null) ? settings.symmetry : 50;
      sec.body.appendChild(createSliderRow('Symmetry', WF_SYMMETRY_MIN, WF_SYMMETRY_MAX, WF_SYMMETRY_STEP, symValue, '%', TIP_WF_SYMMETRY, function(v) {
        _writeWavefold(instId, 'symmetry', v);
      }));

      var biasValue = (settings.bias != null) ? settings.bias : 0;
      sec.body.appendChild(createSliderRow('Bias', WF_BIAS_MIN, WF_BIAS_MAX, WF_BIAS_STEP, biasValue, '', TIP_WF_BIAS, function(v) {
        _writeWavefold(instId, 'bias', v);
      }));

      // Pre-Gain also serves as the drive / output-level trim for this engine.
      var gainValue = (settings.preGain != null) ? settings.preGain : 1.0;
      sec.body.appendChild(createSliderRow('Drive / Output', WF_PREGAIN_MIN, WF_PREGAIN_MAX, WF_PREGAIN_STEP, gainValue, 'x', TIP_WF_PREGAIN, function(v) {
        _writeWavefold(instId, 'preGain', v);
      }));

      _appendShapeLink(container);
    }
  }

  // ============================================================
  // Formant panel
  // ============================================================

  function _writeFormant(instId, field, value) {
    var patch = {};
    patch[field] = value;
    if (SL.audio && SL.audio.setFormantSettings) {
      SL.audio.setFormantSettings(instId, patch);
    }
  }

  function _buildFormantVowelRow(label, currentValue, tooltip, onPick) {
    var row = document.createElement('div');
    row.className = CLS_ROW + ' ssli-tweak2-vowel-row';

    var lbl = document.createElement('span');
    lbl.className = CLS_LABEL;
    lbl.textContent = label;
    lbl.title = tooltip;
    row.appendChild(lbl);

    var group = document.createElement('span');
    group.className = 'ssli-tweak2-vowel-group';

    var buttons = [];
    for (var i = 0; i < FMT_VOWELS.length; i++) {
      (function(vowelName) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = CLS_BTN + ' ssli-tweak2-vowel-btn';
        btn.textContent = vowelName;
        btn.title = tooltip + ' (' + vowelName + ')';
        if (vowelName === currentValue) {
          btn.classList.add(CLS_BTN_ACTIVE);
        }
        btn.addEventListener('click', function() {
          for (var j = 0; j < buttons.length; j++) {
            buttons[j].classList.remove(CLS_BTN_ACTIVE);
          }
          btn.classList.add(CLS_BTN_ACTIVE);
          onPick(vowelName);
        });
        buttons.push(btn);
        group.appendChild(btn);
      })(FMT_VOWELS[i]);
    }

    row.appendChild(group);
    return row;
  }

  function _buildFormantPanel(container, ctx) {
    var instId = ctx.instId;
    var settings = null;
    if (SL.audio && SL.audio.getFormantSettings) {
      settings = SL.audio.getFormantSettings(instId);
    }
    if (!settings) {
      var warn = document.createElement('div');
      warn.className = CLS_STUB;
      warn.textContent = SL.t('tweak.no_formant');
      container.appendChild(warn);
    } else {
      // Vowel preset buttons (primary)
      var acc = createAccordion(container);
      var vowelSec = acc.addSection(PARAM_SVGS.Generic, 'Vowel');
      var currentVowel = settings.vowel ? settings.vowel : 'A';
      vowelSec.body.appendChild(_buildFormantVowelRow('Primary', currentVowel, TIP_FMT_VOWEL, function(v) {
        _writeFormant(instId, 'vowel', v);
      }));

      var currentTarget = settings.vowelTarget ? settings.vowelTarget : 'E';
      vowelSec.body.appendChild(_buildFormantVowelRow('Target', currentTarget, TIP_FMT_TARGET, function(v) {
        _writeFormant(instId, 'vowelTarget', v);
      }));

      var morphValue = (settings.morphX != null) ? settings.morphX : 0;
      vowelSec.body.appendChild(createSliderRow('Morph X', FMT_MORPH_MIN, FMT_MORPH_MAX, FMT_MORPH_STEP, morphValue, '%', TIP_FMT_MORPH, function(v) {
        _writeFormant(instId, 'morphX', v);
      }));

      // Articulation section (tongue/throat/nasal all governed by formant shift,
      // breath, and glottal pulse width in this engine).
      var artSec = acc.addSection(PARAM_SVGS.Generic, 'Articulation');

      var shiftValue = (settings.formantShift != null) ? settings.formantShift : 0;
      artSec.body.appendChild(createSliderRow('Tongue / Throat / Nasal (shift)', FMT_SHIFT_MIN, FMT_SHIFT_MAX, FMT_SHIFT_STEP, shiftValue, ' st', TIP_FMT_SHIFT, function(v) {
        _writeFormant(instId, 'formantShift', v);
      }));

      var breathValue = (settings.breathiness != null) ? settings.breathiness : 15;
      artSec.body.appendChild(createSliderRow('Breath', FMT_BREATH_MIN, FMT_BREATH_MAX, FMT_BREATH_STEP, breathValue, '%', TIP_FMT_BREATH, function(v) {
        _writeFormant(instId, 'breathiness', v);
      }));

      var glottalValue = (settings.glottalPulseWidth != null) ? settings.glottalPulseWidth : 50;
      artSec.body.appendChild(createSliderRow('Brightness (glottal PW)', FMT_GLOTTAL_MIN, FMT_GLOTTAL_MAX, FMT_GLOTTAL_STEP, glottalValue, '%', TIP_FMT_GLOTTAL, function(v) {
        _writeFormant(instId, 'glottalPulseWidth', v);
      }));

      // Sequence section
      var seqSec = acc.addSection(PARAM_SVGS.Generic, 'Vowel Sequence');
      var seqOn = Boolean(settings.vowelSequenceEnabled);
      var seqRow = document.createElement('div');
      seqRow.className = CLS_ROW;
      var seqLbl = document.createElement('span');
      seqLbl.className = CLS_LABEL;
      seqLbl.textContent = SL.t('tweak.enabled');
      seqLbl.title = TIP_FMT_SEQ_ON;
      var seqCb = document.createElement('input');
      seqCb.type = 'checkbox';
      seqCb.checked = seqOn;
      seqCb.title = TIP_FMT_SEQ_ON;
      seqCb.addEventListener('change', function() {
        _writeFormant(instId, 'vowelSequenceEnabled', seqCb.checked);
      });
      seqRow.appendChild(seqLbl);
      seqRow.appendChild(seqCb);
      seqSec.body.appendChild(seqRow);

      var seqRate = (settings.vowelSequenceRate != null) ? settings.vowelSequenceRate : 2.0;
      seqSec.body.appendChild(createSliderRow('Rate', FMT_SEQ_RATE_MIN, FMT_SEQ_RATE_MAX, FMT_SEQ_RATE_STEP, seqRate, ' Hz', TIP_FMT_SEQ_RATE, function(v) {
        _writeFormant(instId, 'vowelSequenceRate', v);
      }));

      _appendShapeLink(container);
    }
  }

  // ============================================================
  // Modal panel
  // ============================================================

  function _writeModal(instId, field, value) {
    var patch = {};
    patch[field] = value;
    if (SL.audio && SL.audio.setModalSettings) {
      SL.audio.setModalSettings(instId, patch);
    }
  }

  function _buildModalPanel(container, ctx) {
    var instId = ctx.instId;
    var settings = null;
    if (SL.audio && SL.audio.getModalSettings) {
      settings = SL.audio.getModalSettings(instId);
    }
    if (!settings) {
      var warn = document.createElement('div');
      warn.className = CLS_STUB;
      warn.textContent = SL.t('tweak.no_modal');
      container.appendChild(warn);
    } else {
      // Body / material section
      var acc = createAccordion(container);
      var bodySec = acc.addSection(PARAM_SVGS.Generic, 'Resonator');

      var materialValue = settings.material ? settings.material : 'bell';
      bodySec.body.appendChild(createSelectRow('Material', MD_MATERIALS, materialValue, TIP_MD_MATERIAL, function(v) {
        _writeModal(instId, 'material', v);
      }));

      var bodyValue = (settings.bodySize != null) ? settings.bodySize : 50;
      bodySec.body.appendChild(createSliderRow('Body Size', MD_PCT_MIN, MD_PCT_MAX, MD_PCT_STEP, bodyValue, '%', TIP_MD_BODY, function(v) {
        _writeModal(instId, 'bodySize', v);
      }));

      var dampingValue = (settings.damping != null) ? settings.damping : 30;
      bodySec.body.appendChild(createSliderRow('Damping', MD_PCT_MIN, MD_PCT_MAX, MD_PCT_STEP, dampingValue, '%', TIP_MD_DAMPING, function(v) {
        _writeModal(instId, 'damping', v);
      }));

      var brightValue = (settings.brightness != null) ? settings.brightness : 60;
      bodySec.body.appendChild(createSliderRow('Brightness', MD_PCT_MIN, MD_PCT_MAX, MD_PCT_STEP, brightValue, '%', TIP_MD_BRIGHTNESS, function(v) {
        _writeModal(instId, 'brightness', v);
      }));

      // Stiffness maps to inharmonicity for this engine.
      var inharmValue = (settings.inharmonicity != null) ? settings.inharmonicity : 80;
      bodySec.body.appendChild(createSliderRow('Stiffness (inharmonicity)', MD_PCT_MIN, MD_PCT_MAX, MD_PCT_STEP, inharmValue, '%', TIP_MD_INHARMONICITY, function(v) {
        _writeModal(instId, 'inharmonicity', v);
      }));

      // Excitation section
      var excSec = acc.addSection(PARAM_SVGS.Generic, 'Excitation');
      var excValue = settings.excitation ? settings.excitation : 'mallet';
      excSec.body.appendChild(createSelectRow('Type', MD_EXCITATIONS, excValue, TIP_MD_EXCITATION, function(v) {
        _writeModal(instId, 'excitation', v);
      }));

      var malletValue = (settings.malletHardness != null) ? settings.malletHardness : 50;
      excSec.body.appendChild(createSliderRow('Mallet Hardness', MD_PCT_MIN, MD_PCT_MAX, MD_PCT_STEP, malletValue, '%', TIP_MD_MALLET, function(v) {
        _writeModal(instId, 'malletHardness', v);
      }));

      // Note: N-modes count is fixed at 16 in this engine (MATERIAL_RATIOS tables),
      // not exposed as a user-editable setting. Decay is governed by damping above.
      _appendShapeLink(container);
    }
  }

  // ============================================================
  // Wavetable panel
  // ============================================================

  function _writeWavetable(instId, field, value) {
    var patch = {};
    patch[field] = value;
    if (SL.audio && SL.audio.setWavetableSettings) {
      SL.audio.setWavetableSettings(instId, patch);
    }
  }

  function _buildWavetablePanel(container, ctx) {
    var instId = ctx.instId;
    var settings = null;
    if (SL.audio && SL.audio.getWavetableSettings) {
      settings = SL.audio.getWavetableSettings(instId);
    }
    if (!settings) {
      var warn = document.createElement('div');
      warn.className = CLS_STUB;
      warn.textContent = SL.t('tweak.no_wavetable');
      container.appendChild(warn);
    } else {
      var acc = createAccordion(container);
      var sec = acc.addSection(PARAM_SVGS.Generic, 'Wavetable');

      var bankValue = settings.bank ? settings.bank : 'basic';
      sec.body.appendChild(createSelectRow('Bank', WT_BANKS, bankValue, TIP_WT_BANK, function(v) {
        _writeWavetable(instId, 'bank', v);
      }));

      // Position = scan position.
      var scanValue = (settings.scanPosition != null) ? settings.scanPosition : 0;
      sec.body.appendChild(createSliderRow('Position', WT_SCAN_MIN, WT_SCAN_MAX, WT_SCAN_STEP, scanValue, '%', TIP_WT_SCAN, function(v) {
        _writeWavetable(instId, 'scanPosition', v);
      }));

      // Morph = LFO depth (how much the LFO sweeps the scan position).
      var lfoDepthValue = (settings.lfoDepth != null) ? settings.lfoDepth : 0;
      sec.body.appendChild(createSliderRow('Morph (LFO Depth)', WT_LFO_DEPTH_MIN, WT_LFO_DEPTH_MAX, WT_LFO_DEPTH_STEP, lfoDepthValue, '%', TIP_WT_LFO_DEPTH, function(v) {
        _writeWavetable(instId, 'lfoDepth', v);
      }));

      // Unison voices and per-voice detune are not exposed as separate settings
      // by this engine; detune is the master pitch offset, and the LFO controls
      // the polyphonic motion. We surface detune as the user-facing Detune control.
      var lfoSpeedValue = (settings.lfoSpeed != null) ? settings.lfoSpeed : 0.5;
      sec.body.appendChild(createSliderRow('LFO Speed', WT_LFO_SPEED_MIN, WT_LFO_SPEED_MAX, WT_LFO_SPEED_STEP, lfoSpeedValue, ' Hz', TIP_WT_LFO_SPEED, function(v) {
        _writeWavetable(instId, 'lfoSpeed', v);
      }));

      var detuneValue = (settings.detune != null) ? settings.detune : 0;
      sec.body.appendChild(createSliderRow('Detune', WT_DETUNE_MIN, WT_DETUNE_MAX, WT_DETUNE_STEP, detuneValue, ' ct', TIP_WT_DETUNE, function(v) {
        _writeWavetable(instId, 'detune', v);
      }));

      _appendShapeLink(container);
    }
  }

  // ============================================================
  // Adapter helper factories
  // ============================================================

  function _makeAudioGetSet(getterName, setterName) {
    return {
      get: function(instId) {
        var result = null;
        if (SL.audio && SL.audio[getterName]) {
          result = SL.audio[getterName](instId);
        }
        return result;
      },
      set: function(instId, obj) {
        if (SL.audio && SL.audio[setterName]) {
          SL.audio[setterName](instId, obj);
        }
      }
    };
  }

  function _makeFallbackGetSet(settingsKey) {
    return {
      get: function(instId) {
        var insts = _getInstruments();
        var bag = null;
        var hasInstSettingsSet = insts && insts[instId] && insts[instId].settings;
        if (hasInstSettingsSet) {
          bag = insts[instId].settings[settingsKey];
        }
        return bag;
      },
      set: function(instId, obj) {
        var insts = _getInstruments();
        var hasInstForFallbackSet = insts && insts[instId] && insts[instId].settings;
        if (hasInstForFallbackSet) {
          insts[instId].settings[settingsKey] = obj;
        }
      }
    };
  }

  // ============================================================
  // Vocoder-Synth panel
  // ============================================================

  function _writeVocoder(instId, field, value) {
    var patch = {};
    patch[field] = value;
    if (SL.audio && SL.audio.setVocoderSynthSettings) {
      SL.audio.setVocoderSynthSettings(instId, patch);
    }
  }

  function _buildVocoderPanel(container, ctx) {
    var instId = ctx.instId;
    var settings = null;
    if (SL.audio && SL.audio.getVocoderSynthSettings) {
      settings = SL.audio.getVocoderSynthSettings(instId);
    }
    if (!settings) {
      var warn = document.createElement('div');
      warn.className = CLS_STUB;
      warn.textContent = SL.t('tweak.no_vocoder');
      container.appendChild(warn);
    } else {
      var acc = createAccordion(container);
      var sec = acc.addSection(PARAM_SVGS.Generic, 'Vocoder Synth');

      var carrierValue = settings.carrierWaveform ? settings.carrierWaveform : VOC_DEFAULT_CARRIER;
      sec.body.appendChild(createSelectRow('Carrier', VOC_CARRIER_WAVES, carrierValue, TIP_VOC_CARRIER, function(v) {
        _writeVocoder(instId, 'carrierWaveform', v);
      }, 'waveform.'));

      var vowelValue = settings.vowel ? settings.vowel : VOC_DEFAULT_VOWEL;
      sec.body.appendChild(createSelectRow('Vowel', VOC_VOWELS, vowelValue, TIP_VOC_VOWEL, function(v) {
        _writeVocoder(instId, 'vowel', v);
      }));

      var bandsValue = (settings.bandCount != null) ? settings.bandCount : VOC_DEFAULT_BANDS;
      var bandOpts = [];
      for (var bi = 0; bi < VOC_BAND_COUNTS.length; bi++) {
        bandOpts.push({ val: String(VOC_BAND_COUNTS[bi]), label: String(VOC_BAND_COUNTS[bi]) });
      }
      sec.body.appendChild(createSelectRow('Bands', bandOpts, String(bandsValue), TIP_VOC_BANDS, function(v) {
        _writeVocoder(instId, 'bandCount', parseInt(v, 10));
      }));

      var morphValue = (settings.morphPosition != null) ? settings.morphPosition : VOC_DEFAULT_MORPH;
      sec.body.appendChild(createSliderRow('Morph', VOC_MORPH_MIN, VOC_MORPH_MAX, VOC_MORPH_STEP, morphValue, '%', TIP_VOC_MORPH, function(v) {
        _writeVocoder(instId, 'morphPosition', v);
      }));

      var formantValue = (settings.formantShift != null) ? settings.formantShift : VOC_DEFAULT_FORMANT;
      sec.body.appendChild(createSliderRow('Formant Shift', VOC_FORMANT_MIN, VOC_FORMANT_MAX, VOC_FORMANT_STEP, formantValue, ' st', TIP_VOC_FORMANT, function(v) {
        _writeVocoder(instId, 'formantShift', v);
      }));

      var filterQValue = (settings.filterQ != null) ? settings.filterQ : VOC_DEFAULT_FILTERQ;
      sec.body.appendChild(createSliderRow('Filter Q', VOC_FILTERQ_MIN, VOC_FILTERQ_MAX, VOC_FILTERQ_STEP, filterQValue, '', TIP_VOC_FILTERQ, function(v) {
        _writeVocoder(instId, 'filterQ', v);
      }));

      _appendShapeLink(container);
    }
  }

  // ============================================================
  // Ring-Mod panel
  // ============================================================

  function _writeRingmod(instId, field, value) {
    var patch = {};
    patch[field] = value;
    if (SL.audio && SL.audio.setRingmodSettings) {
      SL.audio.setRingmodSettings(instId, patch);
    }
  }

  function _buildRingmodPanel(container, ctx) {
    var instId = ctx.instId;
    var settings = null;
    if (SL.audio && SL.audio.getRingmodSettings) {
      settings = SL.audio.getRingmodSettings(instId);
    }
    if (!settings) {
      var warn = document.createElement('div');
      warn.className = CLS_STUB;
      warn.textContent = SL.t('tweak.no_ringmod');
      container.appendChild(warn);
    } else {
      var acc = createAccordion(container);
      var sec = acc.addSection(PARAM_SVGS.Generic, 'Ring Modulator');

      var carrierValue = settings.carrierWave ? settings.carrierWave : RM_DEFAULT_CARRIER;
      sec.body.appendChild(createSelectRow('Carrier Wave', RM_WAVES, carrierValue, TIP_RM_CARRIER, function(v) {
        _writeRingmod(instId, 'carrierWave', v);
      }, 'waveform.'));

      var modWaveValue = settings.modWave ? settings.modWave : RM_DEFAULT_MODWAVE;
      sec.body.appendChild(createSelectRow('Mod Wave', RM_WAVES, modWaveValue, TIP_RM_MODWAVE, function(v) {
        _writeRingmod(instId, 'modWave', v);
      }, 'waveform.'));

      var modeValue = settings.modRatioMode ? settings.modRatioMode : RM_DEFAULT_MODE;
      sec.body.appendChild(createSelectRow('Mode', RM_RATIO_MODES, modeValue, TIP_RM_MODE, function(v) {
        _writeRingmod(instId, 'modRatioMode', v);
      }));

      var ratioValue = (settings.modRatio != null) ? settings.modRatio : RM_DEFAULT_RATIO;
      sec.body.appendChild(createSliderRow('Mod Ratio', RM_RATIO_MIN, RM_RATIO_MAX, RM_RATIO_STEP, ratioValue, 'x', TIP_RM_RATIO, function(v) {
        _writeRingmod(instId, 'modRatio', v);
      }));

      var fixedValue = (settings.modFixedHz != null) ? settings.modFixedHz : RM_DEFAULT_FIXED;
      sec.body.appendChild(createSliderRow('Fixed Hz', RM_FIXED_MIN, RM_FIXED_MAX, RM_FIXED_STEP, fixedValue, ' Hz', TIP_RM_FIXED, function(v) {
        _writeRingmod(instId, 'modFixedHz', v);
      }));

      var depthValue = (settings.modDepth != null) ? settings.modDepth : RM_DEFAULT_DEPTH;
      sec.body.appendChild(createSliderRow('Depth / Mix', RM_DEPTH_MIN, RM_DEPTH_MAX, RM_DEPTH_STEP, depthValue, '%', TIP_RM_DEPTH, function(v) {
        _writeRingmod(instId, 'modDepth', v);
      }));

      _appendShapeLink(container);
    }
  }

  // ============================================================
  // Chord panel
  // ============================================================

  function _writeChord(instId, field, value) {
    var patch = {};
    patch[field] = value;
    if (SL.audio && SL.audio.setChordEngineSettings) {
      SL.audio.setChordEngineSettings(instId, patch);
    }
  }

  function _buildChordPanel(container, ctx) {
    var instId = ctx.instId;
    var settings = null;
    if (SL.audio && SL.audio.getChordEngineSettings) {
      settings = SL.audio.getChordEngineSettings(instId);
    }
    if (!settings) {
      var warn = document.createElement('div');
      warn.className = CLS_STUB;
      warn.textContent = SL.t('tweak.no_chord');
      container.appendChild(warn);
    } else {
      var acc = createAccordion(container);
      var sec = acc.addSection(PARAM_SVGS.Generic, 'Chord');

      var typeValue = settings.chordType ? settings.chordType : CHORD_DEFAULT_TYPE;
      sec.body.appendChild(createSelectRow('Chord Type', CHORD_TYPES, typeValue, TIP_CHORD_TYPE, function(v) {
        _writeChord(instId, 'chordType', v);
      }));

      var voicingValue = settings.voicing ? settings.voicing : CHORD_DEFAULT_VOICING;
      sec.body.appendChild(createSelectRow('Voicing', CHORD_VOICINGS, voicingValue, TIP_CHORD_VOICING, function(v) {
        _writeChord(instId, 'voicing', v);
      }));

      var waveValue = settings.sourceWave ? settings.sourceWave : CHORD_DEFAULT_WAVE;
      sec.body.appendChild(createSelectRow('Source Wave', CHORD_WAVES, waveValue, TIP_CHORD_WAVE, function(v) {
        _writeChord(instId, 'sourceWave', v);
      }, 'waveform.'));

      var strumValue = (settings.strum != null) ? settings.strum : CHORD_DEFAULT_STRUM;
      sec.body.appendChild(createSliderRow('Strum / Density', CHORD_STRUM_MIN, CHORD_STRUM_MAX, CHORD_STRUM_STEP, strumValue, ' ms', TIP_CHORD_STRUM, function(v) {
        _writeChord(instId, 'strum', v);
      }));

      _appendShapeLink(container);
    }
  }

  // ============================================================
  // Superwave panel
  // ============================================================

  function _writeSuperwave(instId, field, value) {
    var patch = {};
    patch[field] = value;
    if (SL.audio && SL.audio.setSuperwaveSettings) {
      SL.audio.setSuperwaveSettings(instId, patch);
    }
  }

  function _buildSuperwavePanel(container, ctx) {
    var instId = ctx.instId;
    var settings = null;
    if (SL.audio && SL.audio.getSuperwaveSettings) {
      settings = SL.audio.getSuperwaveSettings(instId);
    }
    if (!settings) {
      var warn = document.createElement('div');
      warn.className = CLS_STUB;
      warn.textContent = SL.t('tweak.no_superwave');
      container.appendChild(warn);
    } else {
      var acc = createAccordion(container);
      var sec = acc.addSection(PARAM_SVGS.Oscillators, 'Superwave');

      var waveValue = settings.sourceWave ? settings.sourceWave : SW_DEFAULT_WAVE;
      sec.body.appendChild(createSelectRow('Source Wave', SW_WAVES, waveValue, TIP_SW_WAVE, function(v) {
        _writeSuperwave(instId, 'sourceWave', v);
      }));

      var voicesValue = (settings.voiceCount != null) ? settings.voiceCount : SW_DEFAULT_VOICES;
      var voiceOpts = [];
      for (var vi = 0; vi < SW_VOICE_COUNTS.length; vi++) {
        voiceOpts.push({ val: String(SW_VOICE_COUNTS[vi]), label: String(SW_VOICE_COUNTS[vi]) });
      }
      sec.body.appendChild(createSelectRow('Voice Count', voiceOpts, String(voicesValue), TIP_SW_VOICES, function(v) {
        _writeSuperwave(instId, 'voiceCount', parseInt(v, 10));
      }));

      var detuneValue = (settings.detuneSpread != null) ? settings.detuneSpread : SW_DEFAULT_DETUNE;
      sec.body.appendChild(createSliderRow('Detune', SW_DETUNE_MIN, SW_DETUNE_MAX, SW_DETUNE_STEP, detuneValue, ' ct', TIP_SW_DETUNE, function(v) {
        _writeSuperwave(instId, 'detuneSpread', v);
      }));

      var stereoValue = (settings.stereoSpread != null) ? settings.stereoSpread : SW_DEFAULT_STEREO;
      sec.body.appendChild(createSliderRow('Stereo Spread', SW_STEREO_MIN, SW_STEREO_MAX, SW_STEREO_STEP, stereoValue, '%', TIP_SW_STEREO, function(v) {
        _writeSuperwave(instId, 'stereoSpread', v);
      }));

      var mixValue = settings.mixMode ? settings.mixMode : SW_DEFAULT_MIX;
      sec.body.appendChild(createSelectRow('Blend / Mix Mode', SW_MIX_MODES, mixValue, TIP_SW_MIX, function(v) {
        _writeSuperwave(instId, 'mixMode', v);
      }));

      _appendShapeLink(container);
    }
  }

  // ============================================================
  // Phase-Distortion panel
  // ============================================================

  function _writePhasedist(instId, field, value) {
    var patch = {};
    patch[field] = value;
    if (SL.audio && SL.audio.setPhasedistSettings) {
      SL.audio.setPhasedistSettings(instId, patch);
    }
  }

  function _buildPhasedistPanel(container, ctx) {
    var instId = ctx.instId;
    var settings = null;
    if (SL.audio && SL.audio.getPhasedistSettings) {
      settings = SL.audio.getPhasedistSettings(instId);
    }
    if (!settings) {
      var warn = document.createElement('div');
      warn.className = CLS_STUB;
      warn.textContent = SL.t('tweak.no_phasedist');
      container.appendChild(warn);
    } else {
      var acc = createAccordion(container);
      var sec = acc.addSection(PARAM_SVGS.Generic, 'Phase Distortion');

      var typeValue = settings.pdType ? settings.pdType : PD_DEFAULT_TYPE;
      sec.body.appendChild(createSelectRow('Mode / Waveform', PD_TYPES, typeValue, TIP_PD_TYPE, function(v) {
        _writePhasedist(instId, 'pdType', v);
      }));

      var amountValue = (settings.pdAmount != null) ? settings.pdAmount : PD_DEFAULT_AMOUNT;
      sec.body.appendChild(createSliderRow('Warp / Mix', PD_AMOUNT_MIN, PD_AMOUNT_MAX, PD_AMOUNT_STEP, amountValue, '%', TIP_PD_AMOUNT, function(v) {
        _writePhasedist(instId, 'pdAmount', v);
      }));

      var windowValue = settings.windowShape ? settings.windowShape : PD_DEFAULT_WINDOW;
      sec.body.appendChild(createSelectRow('Window Shape', PD_WINDOWS, windowValue, TIP_PD_WINDOW, function(v) {
        _writePhasedist(instId, 'windowShape', v);
      }));

      var resValue = (settings.resonantFreqRatio != null) ? settings.resonantFreqRatio : PD_DEFAULT_RES;
      sec.body.appendChild(createSliderRow('Resonance', PD_RES_MIN, PD_RES_MAX, PD_RES_STEP, resValue, 'x', TIP_PD_RES, function(v) {
        _writePhasedist(instId, 'resonantFreqRatio', v);
      }));

      _appendShapeLink(container);
    }
  }

  // ============================================================
  // Chip panel
  // ============================================================

  function _writeChip(instId, field, value) {
    var patch = {};
    patch[field] = value;
    if (SL.audio && SL.audio.setChipSettings) {
      SL.audio.setChipSettings(instId, patch);
    }
  }

  function _buildChipPanel(container, ctx) {
    var instId = ctx.instId;
    var settings = null;
    if (SL.audio && SL.audio.getChipSettings) {
      settings = SL.audio.getChipSettings(instId);
    }
    if (!settings) {
      var warn = document.createElement('div');
      warn.className = CLS_STUB;
      warn.textContent = SL.t('tweak.no_chip');
      container.appendChild(warn);
    } else {
      var acc = createAccordion(container);
      var sec = acc.addSection(PARAM_SVGS.Generic, 'Chip Synth');

      var modeValue = settings.chip ? settings.chip : CHIP_DEFAULT_MODE;
      sec.body.appendChild(createSelectRow('Chip', CHIP_MODES, modeValue, TIP_CHIP_MODE, function(v) {
        _writeChip(instId, 'chip', v);
      }));

      var waveValue = settings.waveform ? settings.waveform : CHIP_DEFAULT_WAVE;
      sec.body.appendChild(createSelectRow('Waveform', CHIP_WAVEFORMS, waveValue, TIP_CHIP_WAVE, function(v) {
        _writeChip(instId, 'waveform', v);
      }));

      var dutyValue = (settings.dutyCycle != null) ? settings.dutyCycle : CHIP_DEFAULT_DUTY;
      sec.body.appendChild(createSliderRow('Duty / Pulse Width', CHIP_DUTY_MIN, CHIP_DUTY_MAX, CHIP_DUTY_STEP, dutyValue, '%', TIP_CHIP_DUTY, function(v) {
        _writeChip(instId, 'dutyCycle', v);
      }));

      var bitValue = (settings.bitDepth != null) ? settings.bitDepth : CHIP_DEFAULT_BITDEPTH;
      sec.body.appendChild(createSliderRow('Bit Depth', CHIP_BITDEPTH_MIN, CHIP_BITDEPTH_MAX, CHIP_BITDEPTH_STEP, bitValue, '-bit', TIP_CHIP_BITDEPTH, function(v) {
        _writeChip(instId, 'bitDepth', v);
      }));

      var noiseValue = settings.noiseMode ? settings.noiseMode : CHIP_DEFAULT_NOISE;
      sec.body.appendChild(createSelectRow('Noise Type', CHIP_NOISE_MODES, noiseValue, TIP_CHIP_NOISE, function(v) {
        _writeChip(instId, 'noiseMode', v);
      }));

      var algoValue = (settings.fmAlgorithm != null) ? settings.fmAlgorithm : CHIP_DEFAULT_FMALGO;
      sec.body.appendChild(createSliderRow('FM Algorithm', CHIP_FMALGO_MIN, CHIP_FMALGO_MAX, CHIP_FMALGO_STEP, algoValue, '', TIP_CHIP_FMALGO, function(v) {
        _writeChip(instId, 'fmAlgorithm', v);
      }));

      var fbValue = (settings.fmFeedback != null) ? settings.fmFeedback : CHIP_DEFAULT_FMFB;
      sec.body.appendChild(createSliderRow('FM Feedback', CHIP_FMFB_MIN, CHIP_FMFB_MAX, CHIP_FMFB_STEP, fbValue, '', TIP_CHIP_FMFB, function(v) {
        _writeChip(instId, 'fmFeedback', v);
      }));

      _appendShapeLink(container);
    }
  }

  // ============================================================
  // Adapter registry — 20 engines
  // ============================================================

  function _entry(engineType, label, getSet, build) {
    return {
      engineType: engineType,
      label: label,
      get: getSet.get,
      set: getSet.set,
      build: build
    };
  }

  function _stubBuild(container, ctx) {
    _buildStubPanel(container, ctx);
  }

  // ============================================================
  // Tail-6 panel builders: Bytebeat, Vector, Drumsyn, Pulsar, Reed, Body-Resonance
  // All use ctx.adapter.get / ctx.adapter.set for full round-trip (no state-merge).
  // ============================================================

  var BYTEBEAT_SR_MIN = 4000;
  var BYTEBEAT_SR_MAX = 48000;
  var BYTEBEAT_SR_STEP = 1000;
  var BYTEBEAT_TRATE_MIN = 1;
  var BYTEBEAT_TRATE_MAX = 16;
  var BYTEBEAT_TRATE_STEP = 1;
  var BYTEBEAT_BITDEPTH_OPTIONS = [
    { val: '8', label: '8-bit' },
    { val: '16', label: '16-bit' }
  ];
  var BYTEBEAT_VOL_MIN = 0;
  var BYTEBEAT_VOL_MAX = 100;
  var BYTEBEAT_VOL_STEP = 1;

  var VECTOR_WAVES = ['sine', 'saw', 'square', 'triangle', 'pulse', 'noise'];
  var VECTOR_XY_MIN = 0;
  var VECTOR_XY_MAX = 100;
  var VECTOR_XY_STEP = 1;
  var VECTOR_DETUNE_MIN = -50;
  var VECTOR_DETUNE_MAX = 50;
  var VECTOR_DETUNE_STEP = 1;
  var VECTOR_SOURCE_COUNT = 4;

  var DRUMSYN_TYPES = ['kick', 'snare', 'hihat', 'clap', 'tom', 'rim', 'cowbell', 'cymbal'];
  var DRUMSYN_PARAM_MIN = 0;
  var DRUMSYN_PARAM_MAX = 100;
  var DRUMSYN_PARAM_STEP = 1;

  var PULSAR_WAVES = ['sine', 'saw', 'square', 'triangle'];
  var PULSAR_ENVS = ['gaussian', 'hann', 'triangle', 'rectangle'];
  var PULSAR_RATE_MIN = 1;
  var PULSAR_RATE_MAX = 500;
  var PULSAR_RATE_STEP = 1;
  var PULSAR_DUTY_MIN = 1;
  var PULSAR_DUTY_MAX = 100;
  var PULSAR_DUTY_STEP = 1;
  var PULSAR_FORMANT_MIN = 50;
  var PULSAR_FORMANT_MAX = 5000;
  var PULSAR_FORMANT_STEP = 10;
  var PULSAR_MASK_MIN = 0;
  var PULSAR_MASK_MAX = 100;
  var PULSAR_MASK_STEP = 1;

  var REED_TYPES_LIST = ['clarinet', 'oboe', 'saxophone', 'harmonica'];
  var REED_REGISTERS = ['normal', 'overblown'];
  var REED_STIFFNESS_MIN = 0;
  var REED_STIFFNESS_MAX = 100;
  var REED_STIFFNESS_STEP = 1;
  var REED_EMBOUCHURE_MIN = 0;
  var REED_EMBOUCHURE_MAX = 100;
  var REED_EMBOUCHURE_STEP = 1;
  var REED_VIB_RATE_MIN = 0;
  var REED_VIB_RATE_MAX = 20;
  var REED_VIB_RATE_STEP = 0.1;
  var REED_VIB_DEPTH_MIN = 0;
  var REED_VIB_DEPTH_MAX = 100;
  var REED_VIB_DEPTH_STEP = 1;
  var REED_BREATH_MIN = 0;
  var REED_BREATH_MAX = 100;
  var REED_BREATH_STEP = 1;

  var BODY_TYPES_LIST = ['none', 'violin', 'cello', 'guitar', 'piano', 'marimba', 'kalimba', 'djembe'];
  var BODY_PARAM_MIN = 0;
  var BODY_PARAM_MAX = 100;
  var BODY_PARAM_STEP = 1;

  function _appendUnavailable(container, msg) {
    var warn = document.createElement('div');
    warn.className = CLS_STUB;
    warn.textContent = msg;
    container.appendChild(warn);
  }

  function _updateField(ctx, field, value) {
    var cur = ctx.adapter.get(ctx.instId);
    var next = cur ? _cloneSettings(cur) : {};
    next[field] = value;
    ctx.adapter.set(ctx.instId, next);
    _notifyChange();
  }

  function _buildBytebeatPanel(container, ctx) {
    var s = ctx.adapter.get(ctx.instId);
    if (!s) {
      _appendUnavailable(container, 'No Bytebeat settings available.');
    } else {
      var acc = createAccordion(container);
      var sec = acc.addSection(PARAM_SVGS.Generic, 'Bytebeat');
      var formulaList = [];
      if (SL.bytebeat && SL.bytebeat.getFormulas) {
        var raw = SL.bytebeat.getFormulas();
        for (var fi = 0; fi < raw.length; fi++) {
          formulaList.push({ val: String(fi), label: raw[fi].name });
        }
      }
      var hasFormulas = formulaList.length > 0;
      if (hasFormulas) {
        var currentIdx = (typeof s.formulaIndex === 'number') ? String(s.formulaIndex) : '0';
        sec.body.appendChild(createSelectRow('Formula', formulaList, currentIdx,
          'Pick a built-in bytebeat formula. Each creates a distinct texture.',
          function(v) {
            var idx = parseInt(v, 10);
            var cur = ctx.adapter.get(ctx.instId);
            var next = cur ? _cloneSettings(cur) : {};
            next.formulaIndex = idx;
            if (SL.bytebeat && SL.bytebeat.getFormulas) {
              var list = SL.bytebeat.getFormulas();
              if (list[idx] && list[idx].expr) {
                next.formula = list[idx].expr;
              }
            }
            ctx.adapter.set(ctx.instId, next);
            _notifyChange();
          }));
      } else {
        var noF = document.createElement('div');
        noF.className = CLS_STUB;
        noF.textContent = SL.t('screen.tweak.noFormulaList');
        sec.body.appendChild(noF);
      }
      sec.body.appendChild(createSliderRow('Sample Rate', BYTEBEAT_SR_MIN, BYTEBEAT_SR_MAX, BYTEBEAT_SR_STEP,
        s.sampleRate, ' Hz', 'Internal sample rate. Lower is crunchier, higher is cleaner.',
        function(v) { _updateField(ctx, 'sampleRate', v); }));
      sec.body.appendChild(createSliderRow('T Rate', BYTEBEAT_TRATE_MIN, BYTEBEAT_TRATE_MAX, BYTEBEAT_TRATE_STEP,
        s.tIncrement, 'x', 'How fast the time counter advances. Multiplies the formula output rate.',
        function(v) { _updateField(ctx, 'tIncrement', v); }));
      sec.body.appendChild(createSelectRow('Bit Depth', BYTEBEAT_BITDEPTH_OPTIONS, String(s.bitDepth),
        '8-bit is classic lo-fi; 16-bit is smoother.',
        function(v) { _updateField(ctx, 'bitDepth', parseInt(v, 10)); }));
      sec.body.appendChild(createSliderRow('Volume', BYTEBEAT_VOL_MIN, BYTEBEAT_VOL_MAX, BYTEBEAT_VOL_STEP,
        s.volume, '%', 'Engine output volume.',
        function(v) { _updateField(ctx, 'volume', v); }));
    }
    _appendShapeLink(container);
  }

  function _setVectorSourceWaveform(ctx, idx, v) {
    var cur = ctx.adapter.get(ctx.instId);
    var next = cur ? _cloneSettings(cur) : _makeEmptySettingsObj();
    if (!next.sources) { next.sources = _makeEmptySourcesArray(); }
    if (!next.sources[idx]) { next.sources[idx] = _makeDefaultSourceEntry(); }
    next.sources[idx].waveform = v;
    ctx.adapter.set(ctx.instId, next);
    _notifyChange();
  }

  function _setVectorSourceDetune(ctx, idx, v) {
    var cur = ctx.adapter.get(ctx.instId);
    var next = cur ? _cloneSettings(cur) : _makeEmptySettingsObj();
    if (!next.sources) { next.sources = _makeEmptySourcesArray(); }
    if (!next.sources[idx]) { next.sources[idx] = _makeDefaultSourceEntry(); }
    next.sources[idx].detune = v;
    ctx.adapter.set(ctx.instId, next);
    _notifyChange();
  }

  function _buildVectorPanel(container, ctx) {
    var s = ctx.adapter.get(ctx.instId);
    if (!s) {
      _appendUnavailable(container, 'No Vector settings available.');
    } else {
      var acc = createAccordion(container);
      var xySec = acc.addSection(PARAM_SVGS.Generic, 'Vector XY');
      xySec.body.appendChild(createSliderRow('X', VECTOR_XY_MIN, VECTOR_XY_MAX, VECTOR_XY_STEP, s.vectorX, '%',
        'Left/right blend between corner sources A/B.',
        function(v) { _updateField(ctx, 'vectorX', v); }));
      xySec.body.appendChild(createSliderRow('Y', VECTOR_XY_MIN, VECTOR_XY_MAX, VECTOR_XY_STEP, s.vectorY, '%',
        'Top/bottom blend between corner sources C/D.',
        function(v) { _updateField(ctx, 'vectorY', v); }));

      var srcSec = acc.addSection(PARAM_SVGS.Oscillators, 'Corner Sources');
      var sources = s.sources ? s.sources : _makeEmptySourcesArray();
      for (var i = 0; i < VECTOR_SOURCE_COUNT; i++) {
        (function(idx) {
          var src = sources[idx] ? sources[idx] : _makeDefaultSourceEntry();
          srcSec.body.appendChild(createSelectRow('Src ' + (idx + 1) + ' Wave', VECTOR_WAVES, src.waveform,
            'Waveform for corner source ' + (idx + 1) + '.',
            function(v) { _setVectorSourceWaveform(ctx, idx, v); }));
          srcSec.body.appendChild(createSliderRow('Src ' + (idx + 1) + ' Detune', VECTOR_DETUNE_MIN, VECTOR_DETUNE_MAX, VECTOR_DETUNE_STEP,
            src.detune, ' ct', 'Detune in cents for corner source ' + (idx + 1) + '.',
            function(v) { _setVectorSourceDetune(ctx, idx, v); }));
        })(i);
      }
    }
    _appendShapeLink(container);
  }

  // Drumsyn: Grade-B. Round-trip get -> mutate -> set (no state-merge).
  function _buildDrumsynPanel(container, ctx) {
    var s = ctx.adapter.get(ctx.instId);
    if (!s) {
      _appendUnavailable(container, 'No Drum Synth settings available.');
    } else {
      var acc = createAccordion(container);
      var sec = acc.addSection(PARAM_SVGS.Generic, 'Drum Synth');
      sec.body.appendChild(createSelectRow('Drum Type', DRUMSYN_TYPES, s.drumType,
        'Which percussion voice is modeled.',
        function(v) { _updateField(ctx, 'drumType', v); }));
      sec.body.appendChild(createSliderRow('Pitch', DRUMSYN_PARAM_MIN, DRUMSYN_PARAM_MAX, DRUMSYN_PARAM_STEP, s.pitch, '%',
        'Base pitch of the body.', function(v) { _updateField(ctx, 'pitch', v); }));
      sec.body.appendChild(createSliderRow('Decay', DRUMSYN_PARAM_MIN, DRUMSYN_PARAM_MAX, DRUMSYN_PARAM_STEP, s.decay, '%',
        'How long the hit rings out.', function(v) { _updateField(ctx, 'decay', v); }));
      sec.body.appendChild(createSliderRow('Tone', DRUMSYN_PARAM_MIN, DRUMSYN_PARAM_MAX, DRUMSYN_PARAM_STEP, s.tone, '%',
        'Body timbre / pitch bend amount.', function(v) { _updateField(ctx, 'tone', v); }));
      sec.body.appendChild(createSliderRow('Body/Noise Mix', DRUMSYN_PARAM_MIN, DRUMSYN_PARAM_MAX, DRUMSYN_PARAM_STEP, s.bodyNoiseMix, '%',
        'Balance between tonal body and noise transient.', function(v) { _updateField(ctx, 'bodyNoiseMix', v); }));
      sec.body.appendChild(createSliderRow('Drive', DRUMSYN_PARAM_MIN, DRUMSYN_PARAM_MAX, DRUMSYN_PARAM_STEP, s.drive, '%',
        'Saturation / punch.', function(v) { _updateField(ctx, 'drive', v); }));
    }
    _appendShapeLink(container);
  }

  // Pulsar: Grade-B. Round-trip, not state-merge.
  function _buildPulsarPanel(container, ctx) {
    var s = ctx.adapter.get(ctx.instId);
    if (!s) {
      _appendUnavailable(container, 'No Pulsar settings available.');
    } else {
      var acc = createAccordion(container);
      var sec = acc.addSection(PARAM_SVGS.Generic, 'Pulsar');
      sec.body.appendChild(createSelectRow('Pulsaret Wave', PULSAR_WAVES, s.pulsaretWaveform,
        'Waveform used inside each grain (pulsaret).',
        function(v) { _updateField(ctx, 'pulsaretWaveform', v); }));
      sec.body.appendChild(createSelectRow('Envelope', PULSAR_ENVS, s.pulsaretEnvelope,
        'Window shape applied to each grain.',
        function(v) { _updateField(ctx, 'pulsaretEnvelope', v); }));
      sec.body.appendChild(createSliderRow('Rate', PULSAR_RATE_MIN, PULSAR_RATE_MAX, PULSAR_RATE_STEP, s.pulseRate, ' Hz',
        'Grain density \u2014 how many pulsarets per second.',
        function(v) { _updateField(ctx, 'pulseRate', v); }));
      sec.body.appendChild(createSliderRow('Duty', PULSAR_DUTY_MIN, PULSAR_DUTY_MAX, PULSAR_DUTY_STEP, s.dutyCycle, '%',
        'Width of each pulsaret within its period.',
        function(v) { _updateField(ctx, 'dutyCycle', v); }));
      sec.body.appendChild(createSliderRow('Formant', PULSAR_FORMANT_MIN, PULSAR_FORMANT_MAX, PULSAR_FORMANT_STEP, s.formantFreq, ' Hz',
        'Pulsaret internal frequency \u2014 shifts formant independently of pitch.',
        function(v) { _updateField(ctx, 'formantFreq', v); }));
      sec.body.appendChild(createSliderRow('Masking', PULSAR_MASK_MIN, PULSAR_MASK_MAX, PULSAR_MASK_STEP, s.masking, '%',
        'Random grain dropouts \u2014 adds stochastic texture.',
        function(v) { _updateField(ctx, 'masking', v); }));
    }
    _appendShapeLink(container);
  }

  // Reed: Grade-C hand-written.
  function _buildReedPanel(container, ctx) {
    var s = ctx.adapter.get(ctx.instId);
    if (!s) {
      _appendUnavailable(container, 'No Reed settings available.');
    } else {
      var acc = createAccordion(container);
      var modelSec = acc.addSection(PARAM_SVGS.Physical, 'Reed Model');
      modelSec.body.appendChild(createSelectRow('Type', REED_TYPES_LIST, s.reedType,
        'Which reed instrument is modeled (bore + overblow differ).',
        function(v) { _updateField(ctx, 'reedType', v); }));
      modelSec.body.appendChild(createSelectRow('Register', REED_REGISTERS, s.register,
        'Normal first-mode or overblown higher register.',
        function(v) { _updateField(ctx, 'register', v); }));

      var voiceSec = acc.addSection(PARAM_SVGS.Generic, 'Voicing');
      voiceSec.body.appendChild(createSliderRow('Reed Stiffness', REED_STIFFNESS_MIN, REED_STIFFNESS_MAX, REED_STIFFNESS_STEP,
        s.reedStiffness, '%', 'Reed stiffness \u2014 softer is warmer, stiffer is brighter.',
        function(v) { _updateField(ctx, 'reedStiffness', v); }));
      voiceSec.body.appendChild(createSliderRow('Embouchure', REED_EMBOUCHURE_MIN, REED_EMBOUCHURE_MAX, REED_EMBOUCHURE_STEP,
        s.embouchurePressure, '%', 'Lip pressure on the reed \u2014 affects attack and timbre.',
        function(v) { _updateField(ctx, 'embouchurePressure', v); }));
      voiceSec.body.appendChild(createSliderRow('Breath Noise', REED_BREATH_MIN, REED_BREATH_MAX, REED_BREATH_STEP,
        s.breathNoise, '%', 'Amount of air/breath noise mixed into excitation.',
        function(v) { _updateField(ctx, 'breathNoise', v); }));

      var vibSec = acc.addSection(PARAM_SVGS.Generic, 'Vibrato');
      vibSec.body.appendChild(createSliderRow('Rate', REED_VIB_RATE_MIN, REED_VIB_RATE_MAX, REED_VIB_RATE_STEP,
        s.vibratoRate, ' Hz', 'Vibrato speed in Hz.',
        function(v) { _updateField(ctx, 'vibratoRate', v); }));
      vibSec.body.appendChild(createSliderRow('Depth', REED_VIB_DEPTH_MIN, REED_VIB_DEPTH_MAX, REED_VIB_DEPTH_STEP,
        s.vibratoDepth, '%', 'Vibrato depth (pitch-modulation amount).',
        function(v) { _updateField(ctx, 'vibratoDepth', v); }));
    }
    _appendShapeLink(container);
  }

  // Body Resonance: Grade-C hand-written.
  function _buildBodyResonancePanel(container, ctx) {
    var s = ctx.adapter.get(ctx.instId);
    if (!s) {
      _appendUnavailable(container, 'No Body Resonance settings available.');
    } else {
      var acc = createAccordion(container);
      var sec = acc.addSection(PARAM_SVGS.Physical, 'Body Resonance');
      sec.body.appendChild(createSelectRow('Body Type', BODY_TYPES_LIST, s.bodyType,
        'Which instrument body colors the output (none = bypass).',
        function(v) { _updateField(ctx, 'bodyType', v); }));
      sec.body.appendChild(createSliderRow('Resonance', BODY_PARAM_MIN, BODY_PARAM_MAX, BODY_PARAM_STEP,
        s.resonanceAmount, '%', 'Dry/wet mix \u2014 how strongly the body colors the signal.',
        function(v) { _updateField(ctx, 'resonanceAmount', v); }));
      sec.body.appendChild(createSliderRow('Brightness', BODY_PARAM_MIN, BODY_PARAM_MAX, BODY_PARAM_STEP,
        s.brightness, '%', 'Sharpens upper resonances. Low = duller, high = sharper.',
        function(v) { _updateField(ctx, 'brightness', v); }));
      sec.body.appendChild(createSliderRow('Body Size', BODY_PARAM_MIN, BODY_PARAM_MAX, BODY_PARAM_STEP,
        s.bodySize, '%', 'Scales resonant frequencies \u2014 larger body = lower tones.',
        function(v) { _updateField(ctx, 'bodySize', v); }));
    }
    _appendShapeLink(container);
  }

  var ENGINE_ADAPTERS = {
    subtractive:    _entry('subtractive',    'Subtractive',    _makeFallbackGetSet('osc'),            _buildSubtractivePanel),
    fm:             _entry('fm',             'FM',             _makeAudioGetSet('getFMSettings',             'setFMSettings'),            _buildFMPanel),
    physical:       _entry('physical',       'Physical',       _makeAudioGetSet('getPhysicalSettings',       'setPhysicalSettings'),      _buildPhysicalPanel),
    additive:       _entry('additive',       'Additive',       _makeAudioGetSet('getAdditiveSettings',       'setAdditiveSettings'),      _buildAdditivePanel),
    granular:       _entry('granular',       'Granular',       _makeAudioGetSet('getGranularSettings',       'setGranularSettings'),      _buildGranularPanel),
    vocoder:        _entry('vocoder',        'Vocoder',        _makeAudioGetSet('getVocoderSynthSettings',   'setVocoderSynthSettings'),  _buildVocoderPanel),
    wavefolder:     _entry('wavefolder',     'Wavefolder',     _makeAudioGetSet('getWavefoldSettings',       'setWavefoldSettings'),      _buildWavefolderPanel),
    formant:        _entry('formant',        'Formant',        _makeAudioGetSet('getFormantSettings',        'setFormantSettings'),       _buildFormantPanel),
    modal:          _entry('modal',          'Modal',          _makeAudioGetSet('getModalSettings',          'setModalSettings'),         _buildModalPanel),
    ringmod:        _entry('ringmod',        'Ring Mod',       _makeAudioGetSet('getRingmodSettings',        'setRingmodSettings'),       _buildRingmodPanel),
    chord:          _entry('chord',          'Chord',          _makeAudioGetSet('getChordEngineSettings',    'setChordEngineSettings'),   _buildChordPanel),
    superwave:      _entry('superwave',      'Superwave',      _makeAudioGetSet('getSuperwaveSettings',      'setSuperwaveSettings'),     _buildSuperwavePanel),
    wavetable:      _entry('wavetable',      'Wavetable',      _makeAudioGetSet('getWavetableSettings',      'setWavetableSettings'),     _buildWavetablePanel),
    phasedist:      _entry('phasedist',      'Phase Distortion', _makeAudioGetSet('getPhasedistSettings',    'setPhasedistSettings'),     _buildPhasedistPanel),
    chip:           _entry('chip',           'Chip',           _makeAudioGetSet('getChipSettings',           'setChipSettings'),          _buildChipPanel),
    bytebeat:       _entry('bytebeat',       'Bytebeat',       _makeAudioGetSet('getBytebeatSettings',       'setBytebeatSettings'),      _buildBytebeatPanel),
    vector:         _entry('vector',         'Vector',         _makeAudioGetSet('getVectorSettings',         'setVectorSettings'),        _buildVectorPanel),
    drumsyn:        _entry('drumsyn',        'Drum Synth',     _makeAudioGetSet('getDrumsynSettings',        'setDrumsynSettings'),       _buildDrumsynPanel),
    pulsar:         _entry('pulsar',         'Pulsar',         _makeAudioGetSet('getPulsarSettings',         'setPulsarSettings'),        _buildPulsarPanel),
    reed:           _entry('reed',           'Reed',           _makeAudioGetSet('getReedSettings',           'setReedSettings'),          _buildReedPanel),
    'body-resonance': _entry('body-resonance', 'Body Resonance', _makeAudioGetSet('getBodyResonanceSettings', 'setBodyResonanceSettings'), _buildBodyResonancePanel)
  };

  // Also alias 'vocoder-synth' to 'vocoder' in case a different type key is used.
  ENGINE_ADAPTERS['vocoder-synth'] = ENGINE_ADAPTERS.vocoder;

  function _getAdapter(engineType) {
    var adapter = ENGINE_ADAPTERS[engineType];
    if (!adapter) {
      adapter = ENGINE_ADAPTERS[DEFAULT_ENGINE];
    }
    return adapter;
  }

  // ============================================================
  // Test Tone (sustained) — parity with v1
  // ============================================================

  function _startTestTone() {
    var canStart = !_isTestToneActive && SL.audio && SL.audio.startSustainedNote;
    if (canStart) {
      if (SL.audio.getCtx) {
        var ctx = SL.audio.getCtx();
        if (ctx && ctx.state === 'suspended') {
          ctx.resume();
        }
      }
      SL.audio.startSustainedNote(TEST_TONE_MIDI, TEST_TONE_VELOCITY);
      _isTestToneActive = true;
      if (_testToneBtn) {
        _testToneBtn.classList.add(CLS_BTN_ACTIVE);
        _testToneBtn.textContent = SL.t('tweak.stop_test_tone');
      }
      _setStatus('Test tone playing (MIDI ' + TEST_TONE_MIDI + ')');
    }
  }

  function _stopTestTone() {
    var canStopTestTone = SL.audio && SL.audio.stopSustainedNote;
    var shouldStopTestTone = _isTestToneActive && canStopTestTone;
    if (shouldStopTestTone) {
      try {
        SL.audio.stopSustainedNote(TEST_TONE_MIDI);
      } catch (e) { /* best-effort teardown; note may already be stopped */ }
    }
    _isTestToneActive = false;
    if (_testToneBtn) {
      _testToneBtn.classList.remove(CLS_BTN_ACTIVE);
      _testToneBtn.textContent = SL.t('tweak.test_tone');
    }
    _setStatus('');
  }

  function _toggleTestTone() {
    if (_isTestToneActive) {
      _stopTestTone();
    } else {
      _startTestTone();
    }
  }

  function _registerPanicTeardown() {
    if (SL.PanicRegistry && SL.PanicRegistry.register) {
      SL.PanicRegistry.register(PANIC_REGISTRY_CATEGORY, PANIC_REGISTRY_NAME, function() {
        _stopTestTone();
      });
    }
  }

  // ============================================================
  // Duplicate / Save actions
  // ============================================================

  function _duplicatePreset() {
    var inst = _getCurrentInstrument();
    if (!inst || !inst.settings) {
      _setStatus('No preset to duplicate');
    } else {
      var baseName = _getPresetName();
      var tweakName = baseName + ' (Tweak)';
      inst.settings.presetName = tweakName;
      inst.name = tweakName;
      _setStatus('Duplicated as "' + tweakName + '"');
      _notifyChange();
    }
  }

  function _loadUserPresets() {
    var stored = [];
    try {
      var raw = localStorage.getItem(USER_PRESETS_STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.length) {
          stored = parsed;
        }
      }
    } catch (e) {
      stored = [];
    }
    return stored;
  }

  function _saveAsNewPreset() {
    var inst = _getCurrentInstrument();
    if (!inst || !inst.settings) {
      _setStatus('No preset to save');
    } else {
      var engineType = _getEngineType();
      var baseName = _getPresetName();
      var entered = null;
      if (window.prompt) {
        entered = window.prompt('Save preset as:', baseName);
      }
      var finalName = entered;
      if (!finalName) {
        finalName = baseName + ' ' + Date.now();
      }
      if (SL.safe && SL.safe.escapeName) {
        finalName = SL.safe.escapeName(finalName);
      }
      var userPresets = _loadUserPresets();
      userPresets.push({
        name: finalName,
        engine: engineType,
        settings: _cloneSettings(inst.settings),
        savedAt: Date.now()
      });
      var isWriteOk = false;
      try {
        localStorage.setItem(USER_PRESETS_STORAGE_KEY, JSON.stringify(userPresets));
        isWriteOk = true;
      } catch (e) {
        isWriteOk = false;
      }
      if (isWriteOk) {
        _setStatus('Saved "' + finalName + '" (' + userPresets.length + ' user presets)');
      } else {
        _setStatus('Saved in-memory only (localStorage unavailable)');
      }
    }
  }

  // ============================================================
  // Header (preset info + action row)
  // ============================================================

  function _buildHeader() {
    var header = document.createElement('div');
    header.className = CLS_HEADER;

    // Top action row
    var actions = document.createElement('div');
    actions.className = CLS_HEADER_ACTIONS;

    var dupBtn = document.createElement('button');
    dupBtn.type = 'button';
    dupBtn.className = CLS_BTN;
    dupBtn.textContent = SL.t('tweak.duplicate_preset');
    dupBtn.addEventListener('click', function() {
      _duplicatePreset();
      _rebuild();
    });
    actions.appendChild(dupBtn);

    _testToneBtn = document.createElement('button');
    _testToneBtn.type = 'button';
    _testToneBtn.className = CLS_BTN;
    _testToneBtn.textContent = _isTestToneActive ? SL.t('tweak.stop_test_tone') : SL.t('tweak.test_tone');
    if (_isTestToneActive) {
      _testToneBtn.classList.add(CLS_BTN_ACTIVE);
    }
    _testToneBtn.addEventListener('click', function() {
      _toggleTestTone();
    });
    actions.appendChild(_testToneBtn);

    var saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = CLS_BTN;
    saveBtn.textContent = SL.t('tweak.save_as_new');
    saveBtn.addEventListener('click', function() {
      _saveAsNewPreset();
    });
    actions.appendChild(saveBtn);

    header.appendChild(actions);

    // Preset info line (engine + preset name + category)
    var infoLine = document.createElement('div');
    infoLine.className = CLS_HEADER_INFO;
    var engineType = _getEngineType();
    var presetName = _getPresetName();
    var category = _getCategory();
    var parts = [];
    parts.push(engineType);
    parts.push(presetName);
    if (category) {
      parts.push(category);
    }
    infoLine.textContent = parts.join(' · ');
    header.appendChild(infoLine);

    // Status line
    _statusEl = document.createElement('div');
    _statusEl.className = CLS_STATUS;
    header.appendChild(_statusEl);

    return header;
  }

  // ============================================================
  // Build / Rebuild
  // ============================================================

  function _build() {
    _screenEl = document.getElementById(SCREEN_ID);
    if (_screenEl) {
      _screenEl.textContent = '';

      var container = document.createElement('div');
      container.className = CLS_CONTAINER;

      container.appendChild(_buildHeader());

      var grid = document.createElement('div');
      grid.className = CLS_GRID;

      // Dispatch to the current engine's panel builder
      var engineType = _getEngineType();
      var adapter = _getAdapter(engineType);
      var ctx = {
        engineType: engineType,
        label: adapter.label,
        instId: _getCurrentInstId(),
        adapter: adapter
      };
      adapter.build(grid, ctx);

      container.appendChild(grid);
      _screenEl.appendChild(container);
    }
  }

  function _rebuild() {
    _build();
  }

  function _onStateChange(what) {
    if (_active) {
      if (what === 'preset' || what === 'instrument') {
        _rebuild();
      }
    }
  }

  // ============================================================
  // Activate / Deactivate
  // ============================================================

  function activate() {
    _active = true;
    if (!_isInitialized) {
      _registerPanicTeardown();
      _isInitialized = true;
    }
    _build();
    if (SL.state && SL.state.onChange) {
      SL.state.onChange(_onStateChange);
    }
  }

  function deactivate() {
    _active = false;
    _stopTestTone();
    if (SL.state && SL.state.removeListener) {
      SL.state.removeListener(_onStateChange);
    }
  }

  // ============================================================
  // Register screen + expose shared helpers
  // ============================================================

  SL.screenTweak = {
    activate: activate,
    deactivate: deactivate
  };

  SL.tweak2 = {
    createSliderRow: createSliderRow,
    createSelectRow: createSelectRow,
    createSection: createSection,
    createAccordion: createAccordion,
    createOscRow: createOscRow,
    PARAM_SVGS: PARAM_SVGS,
    ENGINE_ADAPTERS: ENGINE_ADAPTERS
  };

  // Also surface the registry directly for convenience
  window.ENGINE_ADAPTERS = ENGINE_ADAPTERS;

})();
