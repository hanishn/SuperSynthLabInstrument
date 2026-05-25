// SSLI Screen: Acid Line — a 303-style step sequencer screen.
// Borrows clock-tick model from SSLU sequencer.js (setInterval(tick, 60000/(bpm*4)))
// and the Root/Mode selector pattern from SSLU screen-sequence.js,
// but reshapes the UI from a piano-roll into a compact step grid with per-step
// compound widgets (pitch / octave / gate / slide / accent).
//
// ES5 only (var, no arrow functions, no template literals, no const/let).
(function() {
  'use strict';

  var SL = window.SynthLab;
  var NOTES = SL.NOTES;

  // Sentinel constants
  var NO_TIMER = null;
  var OCT_DOWN = -1;

  // ============================================================
  // Constants
  // ============================================================

  var SCREEN_CONTAINER_ID = 'ssli-screen-acid';
  var PANIC_CATEGORY_INTERVALS = 'intervals';
  var PANIC_CATEGORY_VOICES = 'voices';
  var PANIC_KEY_CLOCK = 'ssli-acid-clock';
  var PANIC_KEY_VOICES = 'ssli-acid-voices';

  // Input element tags that should suppress keyboard shortcuts
  var KEYBOARD_PASSTHROUGH_TAGS = { 'INPUT': 1, 'SELECT': 1, 'TEXTAREA': 1 };

  var STEPS_8 = 8;
  var STEPS_16 = 16;
  var DEFAULT_STEP_COUNT = 16;
  var DEFAULT_BPM = 128;
  var MIN_BPM = 60;
  var MAX_BPM = 240;
  var DEFAULT_SWING_PCT = 0;
  var MIN_SWING_PCT = 0;
  var MAX_SWING_PCT = 50;

  var DEFAULT_GLIDE_PCT = 100;
  var MIN_GLIDE_PCT = 0;
  var MAX_GLIDE_PCT = 200;

  var DEFAULT_ROOT_PC = 0;          // C
  var DEFAULT_MODE = 'aeolian';     // minor — the 303 vibe
  var DEFAULT_BASE_OCTAVE = 3;      // bass register
  var MIN_OCTAVE_OFFSET = -1;
  var MAX_OCTAVE_OFFSET = 1;

  var VELOCITY_NORMAL = 90;
  var VELOCITY_ACCENT = 120;
  var SLIDE_BEND_CENTS_PER_SEMI = 100;
  var SLIDE_STEP_MS = 12;             // pitch-bend animation tick during slide
  var BASE_GATE_MS_RATIO = 0.9;       // normal step keeps 90% of interval as note-on length
  var SLIDE_GATE_MS_RATIO = 1.05;     // slide step overlaps slightly so gate never drops

  var DEFAULT_PHRASE_KEY = 'classicAcid';

  // UI constants (no magic numbers)
  var PITCH_BAR_MIN_FILL_PCT = 5;    // even lowest scale degree shows a sliver
  var PITCH_BAR_MAX_FILL_PCT = 100;
  var SILHOUETTE_OFF_CLASS = 'off';
  var SILHOUETTE_ACCENT_CLASS = 'accent';
  var SLIDE_ARC_CURVE_RATIO = 0.55;  // control-point height offset for bezier
  var SLIDE_ARC_STROKE_WIDTH = 2;
  var KEY_SPACE = ' ';
  var KEY_ARROW_LEFT = 'ArrowLeft';
  var KEY_ARROW_RIGHT = 'ArrowRight';
  var KEY_ARROW_UP = 'ArrowUp';
  var KEY_ARROW_DOWN = 'ArrowDown';
  var KEY_S_LOWER = 's';
  var KEY_A_LOWER = 'a';
  var SVG_NS = 'http://www.w3.org/2000/svg';

  // Category sentinel used by the category picker for "show every phrase".
  var CATEGORY_ALL = 'All';

  // Category name constants (single source of truth for category strings).
  var CAT_CLASSIC_303 = 'Classic 303';
  var CAT_ACID_HOUSE = 'Acid House';
  var CAT_TECHNO_BASS = 'Techno Bass';
  var CAT_ELECTRO = 'Electro';
  var CAT_NEUROFUNK = 'Neurofunk';
  var CAT_PSYTRANCE = 'Psytrance';
  var CAT_BERLIN_SCHOOL = 'Berlin-School';
  var CAT_MINIMAL_DUB = 'Minimal/Dub';
  var CAT_GOA = 'Goa';
  var CAT_BIG_BEAT = 'Big Beat';
  var CAT_FUNK_DISCO = 'Funk/Disco';
  var CAT_TRANCE = 'Trance';
  var CAT_INDUSTRIAL_EBM = 'Industrial/EBM';
  var CAT_TUTORIAL = 'Tutorial';

  // Modes referenced by phrase hints. The design doc uses `minorPent`; in
  // SL.MODES (scales-modes.json) the equivalent key is `penta_min`, so we
  // map to that so the modeHint actually resolves.
  var MODE_AEOLIAN = 'aeolian';
  var MODE_PHRYGIAN = 'phrygian';
  var MODE_DORIAN = 'dorian';
  var MODE_PENTA_MIN = 'penta_min';

  // Phrase presets: each entry is an array of per-step objects.
  // Fields: pc (scale-degree index), oct (octave offset -1..+1),
  // gate (bool), slide (bool), accent (bool).
  // Optional hint fields: category, desc, modeHint, bpmHint, swingHint.
  var PHRASE_PRESETS = {
    classicAcid: {
      label: 'Classic Acid',
      category: CAT_CLASSIC_303,
      desc: 'Original acid line kept from v1.4.802.',
      modeHint: MODE_AEOLIAN, bpmHint: 128, swingHint: 0,
      steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 1, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 7, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: -1, gate: true, slide: false, accent: false }
      ]
    },
    bouncyBass: {
      label: 'Bouncy Bass',
      category: CAT_CLASSIC_303,
      modeHint: MODE_AEOLIAN, bpmHint: 128, swingHint: 0,
      steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 3, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 4, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false }
      ]
    },
    hooverRiff: {
      label: 'Hoover Riff',
      category: CAT_CLASSIC_303,
      modeHint: MODE_AEOLIAN, bpmHint: 135, swingHint: 0,
      steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: true  },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 5, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: true  },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 7, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: true  },
        { pc: 5, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 7, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 5, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: false }
      ]
    },
    funkLine: {
      label: 'Funk Line',
      category: CAT_FUNK_DISCO,
      modeHint: MODE_DORIAN, bpmHint: 115, swingHint: 12,
      steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 3, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 5, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 7, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 5, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 7, oct: -1, gate: true, slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 3, oct: 0, gate: true,  slide: true,  accent: true  },
        { pc: 5, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 7, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: false }
      ]
    },
    rolling16ths: {
      label: 'Rolling 16ths',
      category: CAT_CLASSIC_303,
      modeHint: MODE_AEOLIAN, bpmHint: 130, swingHint: 0,
      steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 3, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 5, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 7, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 5, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 3, oct: 0, gate: true,  slide: true,  accent: false }
      ]
    },
    simpleEight: {
      label: 'Simple Eight',
      category: CAT_TUTORIAL,
      desc: 'Compact 8-step starter.',
      modeHint: MODE_AEOLIAN, bpmHint: 120, swingHint: 0,
      steps: 8,
      pattern: [
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 3, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 5, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 7, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: false }
      ]
    },

    // ==================== 3.1 Classic 303 Acid (6) ====================
    acidTracks: {
      label: 'Acid Tracks', category: CAT_CLASSIC_303,
      desc: 'Phuture-style tonic lock with octave jump and slide tail.',
      modeHint: MODE_AEOLIAN, bpmHint: 122, swingHint: 0, steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: -1, gate: true, slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false }
      ]
    },
    hardfloorSlider: {
      label: 'Hardfloor Slider', category: CAT_CLASSIC_303,
      desc: 'Dense slide pairs with hammering accents on 1 and 9.',
      modeHint: MODE_AEOLIAN, bpmHint: 135, swingHint: 0, steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: true  },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 1, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 2, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: -1, gate: true, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: true  },
        { pc: 5, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 1, gate: true,  slide: true,  accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 2, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 1, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false }
      ]
    },
    higherState: {
      label: 'Higher State', category: CAT_CLASSIC_303,
      desc: 'Sparse root alternation with one climbing slide.',
      modeHint: MODE_AEOLIAN, bpmHint: 128, swingHint: 0, steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 2, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false }
      ]
    },
    squelchWalk: {
      label: 'Squelch Walk', category: CAT_CLASSIC_303,
      desc: 'Descending slide walk from fifth to root.',
      modeHint: MODE_PHRYGIAN, bpmHint: 130, swingHint: 0, steps: 16,
      pattern: [
        { pc: 4, oct: 0, gate: true,  slide: true,  accent: true  },
        { pc: 3, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 2, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 1, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 1, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: true,  accent: true  },
        { pc: 3, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 2, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: -1, gate: true, slide: true,  accent: true  },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 1, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false }
      ]
    },
    tonicHammer: {
      label: 'Tonic Hammer', category: CAT_CLASSIC_303,
      desc: 'Every step on tonic, accents on 1/5/9/13.',
      modeHint: MODE_AEOLIAN, bpmHint: 132, swingHint: 0, steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: true, slide: false, accent: true  },
        { pc: 0, oct: 0, gate: true, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true, slide: false, accent: true  },
        { pc: 0, oct: 0, gate: true, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true, slide: false, accent: false },
        { pc: 0, oct: 1, gate: true, slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true, slide: false, accent: true  },
        { pc: 0, oct: 0, gate: true, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true, slide: false, accent: true  },
        { pc: 0, oct: 0, gate: true, slide: false, accent: false },
        { pc: 0, oct: -1, gate: true, slide: true, accent: false },
        { pc: 0, oct: 0, gate: true, slide: false, accent: false }
      ]
    },
    threePoleShuffle: {
      label: 'Three-Pole Shuffle', category: CAT_CLASSIC_303,
      desc: 'Half-time feel with a syncopated rest at step 7 and octave tail.',
      modeHint: MODE_AEOLIAN, bpmHint: 126, swingHint: 12, steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 1, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 2, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: -1, gate: true, slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 1, gate: true,  slide: true,  accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 2, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 5, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: false }
      ]
    },

    // ==================== 3.2 Acid House (3) ====================
    chicago707: {
      label: 'Chicago 707', category: CAT_ACID_HOUSE,
      desc: 'Sparse Chicago-style bass leaving space for the 707 clap.',
      modeHint: MODE_AEOLIAN, bpmHint: 122, swingHint: 8, steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 2, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false }
      ]
    },
    wildPitch: {
      label: 'Wild Pitch', category: CAT_ACID_HOUSE,
      desc: 'DJ Pierre-style long sustained tonic — built for filter sweeps.',
      modeHint: MODE_AEOLIAN, bpmHint: 124, swingHint: 0, steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: true  },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: true  },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: -1, gate: true, slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false }
      ]
    },
    rhythmMystery: {
      label: 'Rhythm Mystery', category: CAT_ACID_HOUSE,
      desc: 'Garage-tinged Chicago feel, syncopated octave ghost notes.',
      modeHint: MODE_AEOLIAN, bpmHint: 126, swingHint: 18, steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 2, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 1, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 2, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: -1, gate: true, slide: false, accent: false }
      ]
    },

    // ==================== 3.3 Techno Bass (4) ====================
    detroitStab: {
      label: 'Detroit Stab', category: CAT_TECHNO_BASS,
      desc: 'Offbeat bass punches, Model 500-style.',
      modeHint: MODE_AEOLIAN, bpmHint: 128, swingHint: 0, steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 5, oct: 0, gate: true,  slide: false, accent: false }
      ]
    },
    berghainPulse: {
      label: 'Berghain Pulse', category: CAT_TECHNO_BASS,
      desc: 'Driving 8th-note off-kick pulse, Berlin warehouse.',
      modeHint: MODE_AEOLIAN, bpmHint: 132, swingHint: 0, steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false }
      ]
    },
    model500Glide: {
      label: 'Model 500 Glide', category: CAT_TECHNO_BASS,
      desc: 'Juan Atkins-style melodic bass with glides on every "and".',
      modeHint: MODE_AEOLIAN, bpmHint: 128, swingHint: 0, steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 1, gate: true,  slide: true,  accent: false },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 3, oct: 1, gate: true,  slide: true,  accent: false },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 5, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 2, oct: 1, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false }
      ]
    },
    warehouseGroove: {
      label: 'Warehouse Groove', category: CAT_TECHNO_BASS,
      desc: 'Two-note tonic-fifth call and response.',
      modeHint: MODE_AEOLIAN, bpmHint: 130, swingHint: 0, steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 1, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 4, oct: -1, gate: true, slide: false, accent: false }
      ]
    },

    // ==================== 3.4 Electro (3) ====================
    clearElectro: {
      label: 'Clear Electro', category: CAT_ELECTRO,
      desc: 'Syncopated 16th electro bass, "Clear"-style.',
      modeHint: MODE_AEOLIAN, bpmHint: 128, swingHint: 0, steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false }
      ]
    },
    miamiBassDrop: {
      label: 'Miami Bass Drop', category: CAT_ELECTRO,
      desc: '808 sub-bass with heavy octave drops.',
      modeHint: MODE_AEOLIAN, bpmHint: 108, swingHint: 0, steps: 16,
      pattern: [
        { pc: 0, oct: -1, gate: true, slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: -1, gate: true, slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 3, oct: -1, gate: true, slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 3, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 4, oct: -1, gate: true, slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false }
      ]
    },
    electroFunk: {
      label: 'Electro Funk', category: CAT_ELECTRO,
      desc: 'Planet Rock cousin — syncopated funky 16ths with glide.',
      modeHint: MODE_DORIAN, bpmHint: 120, swingHint: 0, steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 4, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 5, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: true  },
        { pc: 5, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: -1, gate: true, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false }
      ]
    },

    // ==================== 3.5 Neurofunk (3) ====================
    reeseRumble: {
      label: 'Reese Rumble', category: CAT_NEUROFUNK,
      desc: 'Rolling 16th reese. Use with detuned saw patch for classic DnB.',
      modeHint: MODE_AEOLIAN, bpmHint: 174, swingHint: 0, steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: true  },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 2, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 3, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: true  },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 4, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 5, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 2, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false }
      ]
    },
    amenSlam: {
      label: 'Amen Slam', category: CAT_NEUROFUNK,
      desc: 'Aggressive chopped neuro bass with strategic rests.',
      modeHint: MODE_AEOLIAN, bpmHint: 174, swingHint: 0, steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 3, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: -1, gate: true, slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 5, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 2, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false }
      ]
    },
    liquidRoll: {
      label: 'Liquid Roll', category: CAT_NEUROFUNK,
      desc: 'Smooth liquid-dnb melodic bass.',
      modeHint: MODE_DORIAN, bpmHint: 172, swingHint: 0, steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 2, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 3, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 5, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: true  },
        { pc: 5, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 2, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: -1, gate: true, slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false }
      ]
    },

    // ==================== 3.6 Psytrance (3) ====================
    goaRoller: {
      label: 'Goa Roller', category: CAT_PSYTRANCE,
      desc: 'Rolling offbeat bass on 2/4/6/... — the psy staple.',
      modeHint: MODE_PHRYGIAN, bpmHint: 145, swingHint: 0, steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false }
      ]
    },
    fullOnDriver: {
      label: 'Full-On Driver', category: CAT_PSYTRANCE,
      desc: 'Full-on bass with melodic interjections every 4 steps.',
      modeHint: MODE_PHRYGIAN, bpmHint: 142, swingHint: 0, steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 1, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 2, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 3, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false }
      ]
    },
    forestStomp: {
      label: 'Forest Stomp', category: CAT_PSYTRANCE,
      desc: 'Dark forest bass with aggressive octave jumps.',
      modeHint: MODE_PHRYGIAN, bpmHint: 148, swingHint: 0, steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 1, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: -1, gate: true, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 2, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: -1, gate: true, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false }
      ]
    },

    // ==================== 3.7 Berlin-School (3) ====================
    tangerineArp: {
      label: 'Tangerine Arp', category: CAT_BERLIN_SCHOOL,
      desc: 'Tangerine Dream ascending-descending triad arp.',
      modeHint: MODE_AEOLIAN, bpmHint: 120, swingHint: 0, steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 4, oct: -1, gate: true, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 6, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false }
      ]
    },
    schulzePulse: {
      label: 'Schulze Pulse', category: CAT_BERLIN_SCHOOL,
      desc: 'Klaus Schulze pulsing tonic-fifth foundation.',
      modeHint: MODE_DORIAN, bpmHint: 110, swingHint: 0, steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: true  },
        { pc: 6, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 5, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false }
      ]
    },
    ratchetedMoog: {
      label: 'Ratcheted Moog', category: CAT_BERLIN_SCHOOL,
      desc: 'Hypnotic Moog-style sequence with octave punches.',
      modeHint: MODE_AEOLIAN, bpmHint: 125, swingHint: 0, steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 6, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 6, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: -1, gate: true, slide: false, accent: false }
      ]
    },

    // ==================== 3.8 Minimal/Dub (2) ====================
    basicChannel: {
      label: 'Basic Channel', category: CAT_MINIMAL_DUB,
      desc: 'Sparse tonic-only dub pulse — made for chord-stab counterpoint.',
      modeHint: MODE_AEOLIAN, bpmHint: 124, swingHint: 0, steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false }
      ]
    },
    minimalShuffle: {
      label: 'Minimal Shuffle', category: CAT_MINIMAL_DUB,
      desc: 'Villalobos micro-rhythm with swung ghost notes.',
      modeHint: MODE_AEOLIAN, bpmHint: 126, swingHint: 20, steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 2, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 3, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false }
      ]
    },

    // ==================== 3.9 Goa (2) ====================
    hallucinogen303: {
      label: 'Hallucinogen 303', category: CAT_GOA,
      desc: 'Hallucinogen-style Phrygian acid line.',
      modeHint: MODE_PHRYGIAN, bpmHint: 148, swingHint: 0, steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 1, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 1, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 2, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 1, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 3, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 1, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 1, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: -1, gate: true, slide: false, accent: false }
      ]
    },
    goaClimber: {
      label: 'Goa Climber', category: CAT_GOA,
      desc: 'Ascending ladder across the octave, slide every other step.',
      modeHint: MODE_PHRYGIAN, bpmHint: 146, swingHint: 0, steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: true  },
        { pc: 1, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 2, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: true,  accent: true  },
        { pc: 5, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 6, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 6, oct: 0, gate: true,  slide: true,  accent: true  },
        { pc: 5, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 2, oct: 0, gate: true,  slide: true,  accent: true  },
        { pc: 1, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: -1, gate: true, slide: false, accent: false }
      ]
    },

    // ==================== 3.10 Big Beat (3) ====================
    blockRockin: {
      label: 'Block Rockin', category: CAT_BIG_BEAT,
      desc: 'Chemical Brothers stomping filtered bass.',
      modeHint: MODE_AEOLIAN, bpmHint: 128, swingHint: 0, steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: -1, gate: true, slide: false, accent: false }
      ]
    },
    prodigyFire: {
      label: 'Prodigy Fire', category: CAT_BIG_BEAT,
      desc: 'Aggressive syncopated octave-jumping bass.',
      modeHint: MODE_PENTA_MIN, bpmHint: 140, swingHint: 0, steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 2, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 3, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: -1, gate: true, slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false }
      ]
    },
    bigBeatStomp: {
      label: 'Big Beat Stomp', category: CAT_BIG_BEAT,
      desc: 'Swung four-to-the-floor with call/response.',
      modeHint: MODE_AEOLIAN, bpmHint: 115, swingHint: 14, steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 3, oct: 0, gate: false, slide: false, accent: false },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 4, oct: 0, gate: false, slide: false, accent: false },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: -1, gate: true, slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false }
      ]
    },

    // ==================== 3.11 Funk/Disco (2 new) ====================
    discoOctave: {
      label: 'Disco Octave', category: CAT_FUNK_DISCO,
      desc: 'Bernard Edwards octave pump — the Chic formula.',
      modeHint: MODE_DORIAN, bpmHint: 118, swingHint: 8, steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 3, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 4, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: -1, gate: true, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false }
      ]
    },
    clavFunk: {
      label: 'Clav Funk', category: CAT_FUNK_DISCO,
      desc: 'Minor pentatonic clav-funk slap.',
      modeHint: MODE_PENTA_MIN, bpmHint: 112, swingHint: 16, steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 1, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 1, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false }
      ]
    },

    // ==================== 3.12 Trance (2) ====================
    upliftingArp: {
      label: 'Uplifting Arp', category: CAT_TRANCE,
      desc: 'Classic uplifting-trance rising triad arpeggio.',
      modeHint: MODE_AEOLIAN, bpmHint: 138, swingHint: 0, steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 2, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 5, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 2, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 5, oct: 1, gate: true,  slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 4, oct: -1, gate: true, slide: false, accent: false }
      ]
    },
    psyTranceGate: {
      label: 'PsyTrance Gate', category: CAT_TRANCE,
      desc: 'Phrygian gated arp with every-fourth rest.',
      modeHint: MODE_PHRYGIAN, bpmHint: 140, swingHint: 0, steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 1, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 5, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: true  },
        { pc: 5, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 1, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false }
      ]
    },

    // ==================== 3.13 Industrial/EBM (2) ====================
    ebmPulse: {
      label: 'EBM Pulse', category: CAT_INDUSTRIAL_EBM,
      desc: 'Front 242 straight-8ths industrial pulse.',
      modeHint: MODE_PHRYGIAN, bpmHint: 130, swingHint: 0, steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 1, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 1, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: true  },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 0, oct: -1, gate: true, slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false }
      ]
    },
    doomDescent: {
      label: 'Doom Descent', category: CAT_INDUSTRIAL_EBM,
      desc: 'Descending dread — Skinny Puppy atmosphere.',
      modeHint: MODE_PHRYGIAN, bpmHint: 118, swingHint: 0, steps: 16,
      pattern: [
        { pc: 5, oct: 0, gate: true,  slide: true,  accent: true  },
        { pc: 4, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 3, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: true,  accent: true  },
        { pc: 3, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 2, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 3, oct: 0, gate: true,  slide: true,  accent: true  },
        { pc: 2, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 1, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: false, slide: false, accent: false },
        { pc: 1, oct: 0, gate: true,  slide: true,  accent: true  },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: -1, gate: true, slide: true,  accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false }
      ]
    },

    // ==================== 3.14 Tutorial (2 new) ====================
    slideLesson: {
      label: 'Slide Lesson', category: CAT_TUTORIAL,
      desc: 'Alternating slide/no-slide pairs — teaches what the S flag does.',
      modeHint: MODE_AEOLIAN, bpmHint: 110, swingHint: 0, steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: true,  accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 0, oct: 0, gate: true,  slide: false, accent: false },
        { pc: 4, oct: 0, gate: true,  slide: false, accent: false }
      ]
    },
    accentLesson: {
      label: 'Accent Lesson', category: CAT_TUTORIAL,
      desc: 'Identical tonic notes; only the A flag changes each beat.',
      modeHint: MODE_AEOLIAN, bpmHint: 120, swingHint: 0, steps: 16,
      pattern: [
        { pc: 0, oct: 0, gate: true, slide: false, accent: true  },
        { pc: 0, oct: 0, gate: true, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true, slide: false, accent: true  },
        { pc: 0, oct: 0, gate: true, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true, slide: false, accent: true  },
        { pc: 0, oct: 0, gate: true, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true, slide: false, accent: true  },
        { pc: 0, oct: 0, gate: true, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true, slide: false, accent: false },
        { pc: 0, oct: 0, gate: true, slide: false, accent: false }
      ]
    }
  };

  // Ordered category list for UI (CATEGORY_ALL always first).
  var CATEGORY_ORDER = [
    CATEGORY_ALL,
    CAT_CLASSIC_303,
    CAT_ACID_HOUSE,
    CAT_TECHNO_BASS,
    CAT_ELECTRO,
    CAT_NEUROFUNK,
    CAT_PSYTRANCE,
    CAT_BERLIN_SCHOOL,
    CAT_MINIMAL_DUB,
    CAT_GOA,
    CAT_BIG_BEAT,
    CAT_FUNK_DISCO,
    CAT_TRANCE,
    CAT_INDUSTRIAL_EBM,
    CAT_TUTORIAL
  ];

  // i18n key mapping for category display names.
  var CATEGORY_I18N = {};
  CATEGORY_I18N[CATEGORY_ALL] = 'acid_category.all';
  CATEGORY_I18N[CAT_CLASSIC_303] = 'acid_category.classic_303';
  CATEGORY_I18N[CAT_ACID_HOUSE] = 'acid_category.acid_house';
  CATEGORY_I18N[CAT_TECHNO_BASS] = 'acid_category.techno_bass';
  CATEGORY_I18N[CAT_ELECTRO] = 'acid_category.electro';
  CATEGORY_I18N[CAT_NEUROFUNK] = 'acid_category.neurofunk';
  CATEGORY_I18N[CAT_PSYTRANCE] = 'acid_category.psytrance';
  CATEGORY_I18N[CAT_BERLIN_SCHOOL] = 'acid_category.berlin_school';
  CATEGORY_I18N[CAT_MINIMAL_DUB] = 'acid_category.minimal_dub';
  CATEGORY_I18N[CAT_GOA] = 'acid_category.goa';
  CATEGORY_I18N[CAT_BIG_BEAT] = 'acid_category.big_beat';
  CATEGORY_I18N[CAT_FUNK_DISCO] = 'acid_category.funk_disco';
  CATEGORY_I18N[CAT_TRANCE] = 'acid_category.trance';
  CATEGORY_I18N[CAT_INDUSTRIAL_EBM] = 'acid_category.industrial_ebm';
  CATEGORY_I18N[CAT_TUTORIAL] = 'acid_category.tutorial';

  // ============================================================
  // State
  // ============================================================

  var isScreenInitialized = false;
  var isScreenActive = false;

  var _rootPc = DEFAULT_ROOT_PC;
  var _modeKey = DEFAULT_MODE;
  var _baseOctave = DEFAULT_BASE_OCTAVE;
  var _bpm = DEFAULT_BPM;
  var _swingPct = DEFAULT_SWING_PCT;
  var _glidePct = DEFAULT_GLIDE_PCT;
  var _stepCount = DEFAULT_STEP_COUNT;
  var _phraseKey = DEFAULT_PHRASE_KEY;
  var _categoryKey = CATEGORY_ALL;

  var isPlaying = false;
  var _currentStep = 0;
  var _clockTimerId = null;
  var _slideTimerId = null;
  var _activeSustainedMidi = -1;   // which MIDI note is currently sustained

  // Steps array — always length 16, first _stepCount are active.
  var _steps = [];

  // DOM refs
  var _screenEl = null;
  var _rootSelect = null;
  var _modeSelect = null;
  var _categorySelect = null;
  var _phraseSelect = null;
  var _randomBtn = null;
  var _stepCountBtns = null;
  var _bpmInput = null;
  var _swingInput = null;
  var _swingLabel = null;
  var _glideInput = null;
  var _glideLabel = null;
  var _playBtn = null;
  var _stopBtn = null;
  var _clearBtn = null;
  var _gridEl = null;
  var _gridWrapEl = null;
  var _slideSvgEl = null;
  var _silhouetteEl = null;
  var _silhouettePlayheadEl = null;
  var _emptyHintEl = null;
  var _selectedStepIdx = 0;
  var isKeyHandlerBound = false;

  // ============================================================
  // Helpers
  // ============================================================

  function _makeEmptyStep() {
    return { pc: 0, oct: 0, gate: false, slide: false, accent: false };
  }

  function _cloneStep(s) {
    return { pc: s.pc, oct: s.oct, gate: Boolean(s.gate), slide: Boolean(s.slide), accent: Boolean(s.accent) };
  }

  function _getPhraseKeysForCategory(categoryKey) {
    var keys = [];
    var k;
    for (k in PHRASE_PRESETS) {
      if (PHRASE_PRESETS.hasOwnProperty(k)) {
        var phrase = PHRASE_PRESETS[k];
        var matches = (categoryKey === CATEGORY_ALL) || (phrase.category === categoryKey);
        if (matches) {
          keys.push(k);
        }
      }
    }
    return keys;
  }

  // Apply optional hints (modeHint/bpmHint/swingHint) to transport state
  // and propagate to the corresponding UI controls. Does NOT touch rootPc.
  function _applyPhraseHints(phraseKey) {
    var phrase = PHRASE_PRESETS[phraseKey];
    if (phrase) {
      var hasModeHint = phrase.modeHint && SL.MODES;
      var isKnownModeHint = hasModeHint && SL.MODES[phrase.modeHint];
      if (isKnownModeHint) {
        _modeKey = phrase.modeHint;
        if (_modeSelect) {
          _modeSelect.value = _modeKey;
        }
      }
      if (typeof phrase.bpmHint === 'number') {
        var bpmVal = phrase.bpmHint;
        if (bpmVal < MIN_BPM) { bpmVal = MIN_BPM; }
        if (bpmVal > MAX_BPM) { bpmVal = MAX_BPM; }
        _bpm = bpmVal;
        if (_bpmInput) {
          _bpmInput.value = String(bpmVal);
        }
      }
      if (typeof phrase.swingHint === 'number') {
        var swingVal = phrase.swingHint;
        if (swingVal < MIN_SWING_PCT) { swingVal = MIN_SWING_PCT; }
        if (swingVal > MAX_SWING_PCT) { swingVal = MAX_SWING_PCT; }
        _swingPct = swingVal;
        if (_swingInput) {
          _swingInput.value = String(swingVal);
        }
        if (_swingLabel) {
          _swingLabel.textContent = swingVal + '%';
        }
      }
    }
  }

  // Single entry-point for loading a phrase. Called from the phrase select,
  // the random button, and init. Applies hints + resets steps.
  function _loadPhraseByKey(phraseKey) {
    if (PHRASE_PRESETS[phraseKey]) {
      _phraseKey = phraseKey;
      _applyPhraseHints(phraseKey);
      _resetStepsFromPhrase(phraseKey);
      _clampAllStepsToScale();
      _syncStepCountButtons();
      _rebuildGrid();
      if (_phraseSelect && _phraseSelect.value !== phraseKey) {
        _phraseSelect.value = phraseKey;
      }
    }
  }

  function _onRandomInCategory() {
    var keys = _getPhraseKeysForCategory(_categoryKey);
    if (keys.length) {
      var pickKey = keys[Math.floor(Math.random() * keys.length)];
      if (keys.length > 1 && pickKey === _phraseKey) {
        pickKey = keys[Math.floor(Math.random() * keys.length)];
      }
      _loadPhraseByKey(pickKey);
    }
  }

  function _resetStepsFromPhrase(phraseKey) {
    var phrase = PHRASE_PRESETS[phraseKey];
    var newSteps = [];
    var i;
    if (!phrase) {
      for (i = 0; i < STEPS_16; i++) {
        newSteps.push(_makeEmptyStep());
      }
      _steps = newSteps;
    } else {
      // Copy phrase pattern (exactly phrase.steps entries); pad to 16 if smaller.
      for (i = 0; i < STEPS_16; i++) {
        if (i < phrase.pattern.length) {
          newSteps.push(_cloneStep(phrase.pattern[i]));
        } else {
          newSteps.push(_makeEmptyStep());
        }
      }
      _steps = newSteps;
      _stepCount = phrase.steps;
    }
  }

  function _getScalePitchClasses() {
    var mode = SL.MODES[_modeKey];
    var result = [];
    var i;
    if (!mode || !mode.scale) {
      // chromatic fallback
      for (i = 0; i < 12; i++) {
        result.push(i);
      }
      return result;
    }
    for (i = 0; i < mode.scale.length; i++) {
      result.push(mode.scale[i]);
    }
    return result;
  }

  function _pcNameForDegree(degreeIdx) {
    // degreeIdx is into the scale pitch-class array.
    var scalePcs = _getScalePitchClasses();
    var effectiveIdx = degreeIdx;
    if (effectiveIdx < 0) {
      effectiveIdx = 0;
    }
    if (effectiveIdx >= scalePcs.length) {
      effectiveIdx = scalePcs.length - 1;
    }
    var pc = (scalePcs[effectiveIdx] + _rootPc) % 12;
    return NOTES[pc];
  }

  function _computeMidiForStep(step) {
    // step.pc as stored is a scale-degree index (0..scale.length-1).
    // We chose to represent user selections as scale indices so "mode" change remaps.
    var scalePcs = _getScalePitchClasses();
    var degreeIdx = step.pc;
    if (degreeIdx < 0) { degreeIdx = 0; }
    if (degreeIdx >= scalePcs.length) { degreeIdx = scalePcs.length - 1; }
    var relPc = scalePcs[degreeIdx];
    var octOffset = step.oct;
    // MIDI = (octave+1)*12 + rootPc + relPc + octOffset*12
    var midi = ((_baseOctave + 1) * 12) + _rootPc + relPc + (octOffset * 12);
    if (midi < 0) { midi = 0; }
    if (midi > 127) { midi = 127; }
    return midi;
  }

  // ============================================================
  // Transport
  // ============================================================

  function _computeStepIntervalMs(isOddStep) {
    // 16th notes at BPM: 60000 / (bpm * 4)
    var baseInterval = 60000 / (_bpm * 4);
    if (_swingPct <= 0) {
      return baseInterval;
    }
    // Swing delays the odd (off-beat) 16th by up to +swingPct% of base interval,
    // and shortens the preceding even step symmetrically.
    var swingFrac = _swingPct / 100;
    if (isOddStep) {
      return baseInterval * (1 + swingFrac);
    }
    return baseInterval * (1 - swingFrac);
  }

  function _onPlay() {
    if (isPlaying) {
      _stopTransport();
    } else {
      _startTransport();
    }
  }

  function _startTransport() {
    if (!isPlaying) {
      // Resume AudioContext if suspended
      if (SL.audio && SL.audio.getCtx) {
        var ctx = SL.audio.getCtx();
        if (ctx && ctx.state === 'suspended') {
          ctx.resume();
        }
      }
      isPlaying = true;
      _currentStep = 0;
      _updateTransportUI();
      _scheduleNextStep(0);
    }
  }

  function _stopTransport() {
    isPlaying = false;
    if (_clockTimerId !== NO_TIMER) {
      clearTimeout(_clockTimerId);
      _clockTimerId = null;
    }
    if (_slideTimerId !== NO_TIMER) {
      clearInterval(_slideTimerId);
      _slideTimerId = null;
    }
    _silenceActiveVoice();
    if (SL.audio && SL.audio.stopAllSustained) {
      SL.audio.stopAllSustained();
    }
    _currentStep = 0;
    _updateTransportUI();
    _refreshPlayheadHighlight();
  }

  function _silenceActiveVoice() {
    if (_activeSustainedMidi >= 0) {
      if (SL.audio && SL.audio.stopSustainedNote) {
        SL.audio.stopSustainedNote(_activeSustainedMidi);
      }
      _activeSustainedMidi = -1;
    }
    // Also cancel any residual pitch bend by restoring 0 cents.
    _applyCentsToActiveVoices(0);
  }

  function _scheduleNextStep(delayMs) {
    if (isPlaying) {
      _clockTimerId = setTimeout(_tick, delayMs);
    }
  }

  function _tick() {
    if (isPlaying) {
      _clockTimerId = null;
      var stepIdx = _currentStep;
      var step = _steps[stepIdx];
      var intervalMs = _computeStepIntervalMs((stepIdx % 2) === 1);

      _fireStep(step, intervalMs);
      _refreshPlayheadHighlight();

      // Advance
      _currentStep = (_currentStep + 1) % _stepCount;
      _scheduleNextStep(intervalMs);
    }
  }

  function _fireStep(step, intervalMs) {
    if (!step || !step.gate) {
      // Gate-off: cut any currently-sustained voice (unless the PREVIOUS
      // step was a slide that expected its tail; we still cut here because
      // the next step has no gate).
      _silenceActiveVoice();
    } else {
    var targetMidi = _computeMidiForStep(step);
    var velocity = step.accent ? VELOCITY_ACCENT : VELOCITY_NORMAL;

    if (step.slide && _activeSustainedMidi >= 0) {
      // Slide: keep the existing voice, animate pitch bend from current
      // to new target, then retarget _activeSustainedMidi conceptually.
      _startPitchSlideTo(targetMidi, intervalMs);
    } else {
      // Non-slide: cut prior voice, start fresh.
      _silenceActiveVoice();
      if (SL.audio && SL.audio.startSustainedNote) {
        SL.audio.startSustainedNote(targetMidi, velocity);
        _activeSustainedMidi = targetMidi;
      }
      // Schedule note-off at BASE_GATE_MS_RATIO of the interval — but
      // only if the NEXT step is gate-off or non-slide. If next is slide,
      // we must hold. We defer the decision: schedule a gate-off timer
      // that checks the next step when it fires.
      var gateMs = intervalMs * BASE_GATE_MS_RATIO;
      var thisStepIdx = _currentStep;
      setTimeout(function() {
        _maybeReleaseGate(thisStepIdx);
      }, gateMs);
    }
    }
  }

  function _maybeReleaseGate(firedAtStepIdx) {
    if (isPlaying) {
      // If the sequencer has already advanced past this step, and the next
      // step was a slide, don't cut.
      var nextIdx = (firedAtStepIdx + 1) % _stepCount;
      var nextStep = _steps[nextIdx];
      var isNextSlide = (nextStep && nextStep.gate && nextStep.slide);
      if (!isNextSlide) {
        _silenceActiveVoice();
      }
    }
  }

  function _startPitchSlideTo(targetMidi, intervalMs) {
    // Cancel any in-flight slide animation.
    if (_slideTimerId !== NO_TIMER) {
      clearInterval(_slideTimerId);
      _slideTimerId = null;
    }
    var fromMidi = _activeSustainedMidi;
    var semitoneDelta = targetMidi - fromMidi;
    if (semitoneDelta !== 0) {
      var glideScale = _glidePct / DEFAULT_GLIDE_PCT;
      var slideDurMs = intervalMs * SLIDE_GATE_MS_RATIO * glideScale;
      var steps = Math.max(4, Math.floor(slideDurMs / SLIDE_STEP_MS));
      var stepIdx = 0;
      _slideTimerId = setInterval(function() {
        stepIdx++;
        var progress = stepIdx / steps;
        if (progress >= 1) {
          progress = 1;
        }
        var cents = semitoneDelta * SLIDE_BEND_CENTS_PER_SEMI * progress;
        _applyCentsToActiveVoices(cents);
        if (progress >= 1) {
          clearInterval(_slideTimerId);
          _slideTimerId = null;
          // The slide has completed. We keep the voice alive until the
          // next non-slide step cuts it. Logical MIDI "target" is now
          // targetMidi but the actual oscillators are still the old voice
          // with bend applied. That's the 303 behavior — no retrigger.
          _activeSustainedMidi = targetMidi;
          // Reset stored detune base so subsequent bends compose relative
          // to the new target (not cumulative bend on next slide).
          _resetDetuneOrigin();
        }
      }, SLIDE_STEP_MS);
    }
  }

  function _applyCentsToActiveVoices(cents) {
    if (SL.audio && SL.audio.getActiveOscillators) {
      var activeOscs = SL.audio.getActiveOscillators();
      if (activeOscs && activeOscs.forEach) {
        activeOscs.forEach(function(voiceData) {
          if (voiceData) {
            if (voiceData.oscillators) {
              for (var i = 0; i < voiceData.oscillators.length; i++) {
                var entry = voiceData.oscillators[i];
                var hasAcidDetune = entry && entry.osc && entry.osc.detune;
                if (hasAcidDetune) {
                  if (entry._acidOrigDetune === undefined) {
                    entry._acidOrigDetune = entry.osc.detune.value;
                  }
                  entry.osc.detune.value = entry._acidOrigDetune + cents;
                }
              }
            }
            var canSetFmBend = voiceData.fm && SL.fm && SL.fm.setBend;
            if (canSetFmBend) {
              SL.fm.setBend(cents);
            }
            var canSetPhysicalBend = voiceData.physical && SL.physical && SL.physical.setBend;
            if (canSetPhysicalBend) {
              SL.physical.setBend(cents);
            }
          }
        });
      }
    }
  }

  function _resetDetuneOrigin() {
    if (SL.audio && SL.audio.getActiveOscillators) {
      var activeOscs = SL.audio.getActiveOscillators();
      if (activeOscs && activeOscs.forEach) {
        activeOscs.forEach(function(voiceData) {
          if (voiceData && voiceData.oscillators) {
            for (var i = 0; i < voiceData.oscillators.length; i++) {
              var entry = voiceData.oscillators[i];
              var hasCapturableDetune = entry && entry.osc && entry.osc.detune;
              if (hasCapturableDetune) {
                entry._acidOrigDetune = entry.osc.detune.value;
              }
            }
          }
        });
      }
    }
  }

  // ============================================================
  // UI Building
  // ============================================================

  function _buildScreen() {
    _screenEl = document.getElementById(SCREEN_CONTAINER_ID);
    if (_screenEl) {
      _screenEl.innerHTML = '';

      var root = document.createElement('div');
      root.className = 'ssli-acid-root';

      root.appendChild(_buildHeaderBar());
      root.appendChild(_buildControlsBar());
      root.appendChild(_buildGridArea());
      root.appendChild(_buildFooterHint());

      _screenEl.appendChild(root);
      _rebuildGrid();
    }
  }

  function _buildHeaderBar() {
    var bar = document.createElement('div');
    bar.className = 'ssli-acid-header';

    var title = document.createElement('div');
    title.className = 'ssli-acid-title';
    title.textContent = SL.t('acid.title');
    bar.appendChild(title);

    var sub = document.createElement('div');
    sub.className = 'ssli-acid-subtitle';
    sub.textContent = SL.t('acid.subtitle');
    bar.appendChild(sub);

    // Transport cluster
    var transport = document.createElement('div');
    transport.className = 'ssli-acid-transport';

    _playBtn = document.createElement('button');
    _playBtn.type = 'button';
    _playBtn.className = 'ssli-acid-btn ssli-acid-play';
    _playBtn.textContent = SL.t('acid.play');
    _playBtn.setAttribute('aria-label', SL.t('acid.play'));
    _playBtn.addEventListener('click', _onPlay);
    transport.appendChild(_playBtn);

    _stopBtn = document.createElement('button');
    _stopBtn.type = 'button';
    _stopBtn.className = 'ssli-acid-btn';
    _stopBtn.textContent = SL.t('acid.stop');
    _stopBtn.setAttribute('aria-label', SL.t('acid.stop'));
    _stopBtn.addEventListener('click', _stopTransport);
    transport.appendChild(_stopBtn);

    _clearBtn = document.createElement('button');
    _clearBtn.type = 'button';
    _clearBtn.className = 'ssli-acid-btn';
    _clearBtn.textContent = SL.t('acid.clear');
    _clearBtn.setAttribute('aria-label', SL.t('acid.clear'));
    _clearBtn.addEventListener('click', _onClear);
    transport.appendChild(_clearBtn);

    bar.appendChild(transport);
    return bar;
  }

  function _buildControlsBar() {
    var wrap = document.createElement('div');
    wrap.className = 'ssli-acid-controls';

    // TEMPO group — BPM + Swing + Glide
    var tempoGroup = _buildGroup(SL.t('acid.group_tempo'));
    tempoGroup.body.appendChild(_buildBpmControl());
    tempoGroup.body.appendChild(_buildSwingControl());
    tempoGroup.body.appendChild(_buildGlideControl());
    wrap.appendChild(tempoGroup.root);

    // SCALE group — Root + Mode
    var scaleGroup = _buildGroup(SL.t('acid.group_scale'));
    scaleGroup.body.appendChild(_buildLabeledSelect(SL.t('ui.label.root'), _buildRootSelect()));
    scaleGroup.body.appendChild(_buildLabeledSelect(SL.t('ui.label.mode'), _buildModeSelect()));
    wrap.appendChild(scaleGroup.root);

    // SHAPE group — Steps 8/16
    var shapeGroup = _buildGroup(SL.t('acid.group_shape'));
    shapeGroup.body.appendChild(_buildStepCountToggle());
    wrap.appendChild(shapeGroup.root);

    // PHRASE group — category chooser + phrase select + random-in-category button
    // Category and Preset always on the same row for compact layout.
    var phraseGroup = _buildGroup(SL.t('acid.group_phrase'));
    phraseGroup.body.appendChild(_buildLabeledSelect(SL.t('ui.label.category'), _buildCategorySelect()));
    phraseGroup.body.appendChild(_buildPhraseField());
    wrap.appendChild(phraseGroup.root);

    return wrap;
  }

  // Phone-land dedicated row beneath the grid holding the phrase select + random button.
  // Reuses the same _phraseSelect + _randomBtn construction as _buildPhraseField so the
  // existing load/change logic keeps working unchanged.
  function _buildPhraseBelowRow() {
    var row = document.createElement('div');
    row.className = 'ssli-acid-phrase-below';
    var lbl = document.createElement('span');
    lbl.className = 'ssli-acid-field-label';
    lbl.textContent = SL.t('acid.phrase');
    row.appendChild(lbl);
    // _buildPhraseField creates and wires _phraseSelect + _randomBtn, and wraps them
    // inside an ssli-acid-phrase-row. We pull the inner row out for the below strip.
    var field = _buildPhraseField();
    // Extract the inner phrase-row (last child) — the field also has a decorative label
    // which we skip because we already added our own.
    var inner = field.querySelector('.ssli-acid-phrase-row');
    if (inner) {
      row.appendChild(inner);
    } else {
      row.appendChild(field);
    }
    return row;
  }

  function _buildGroup(labelText) {
    var groupRoot = document.createElement('div');
    groupRoot.className = 'ssli-acid-group';
    var label = document.createElement('div');
    label.className = 'ssli-acid-group-label';
    label.textContent = labelText;
    groupRoot.appendChild(label);
    var body = document.createElement('div');
    body.className = 'ssli-acid-group-body';
    groupRoot.appendChild(body);
    return { root: groupRoot, body: body };
  }

  function _buildLabeledSelect(labelText, selectEl) {
    var field = document.createElement('label');
    field.className = 'ssli-acid-field';
    var span = document.createElement('span');
    span.className = 'ssli-acid-field-label';
    span.textContent = labelText;
    field.appendChild(span);
    field.appendChild(selectEl);
    return field;
  }

  function _buildRootSelect() {
    _rootSelect = document.createElement('select');
    _rootSelect.className = 'ssli-acid-select';
    var i;
    for (i = 0; i < 12; i++) {
      var opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = NOTES[i];
      if (i === _rootPc) {
        opt.selected = true;
      }
      _rootSelect.appendChild(opt);
    }
    _rootSelect.addEventListener('change', function() {
      _rootPc = parseInt(_rootSelect.value, 10);
      _rebuildGrid();
    });
    return _rootSelect;
  }

  function _buildModeSelect() {
    _modeSelect = document.createElement('select');
    _modeSelect.className = 'ssli-acid-select';
    var modeKeys = [];
    var k;
    for (k in SL.MODES) {
      if (SL.MODES.hasOwnProperty(k)) {
        modeKeys.push(k);
      }
    }
    var i;
    for (i = 0; i < modeKeys.length; i++) {
      var opt = document.createElement('option');
      opt.value = modeKeys[i];
      var m = SL.MODES[modeKeys[i]];
      var acidFallback = (m && m.name) ? m.name : modeKeys[i];
      opt.textContent = SL.t('scale.' + modeKeys[i], acidFallback);
      if (modeKeys[i] === _modeKey) {
        opt.selected = true;
      }
      _modeSelect.appendChild(opt);
    }
    _modeSelect.addEventListener('change', function() {
      _modeKey = _modeSelect.value;
      _clampAllStepsToScale();
      _rebuildGrid();
    });
    return _modeSelect;
  }

  function _buildCategorySelect() {
    _categorySelect = document.createElement('select');
    _categorySelect.className = 'ssli-acid-select ssli-acid-category-select';
    var i;
    for (i = 0; i < CATEGORY_ORDER.length; i++) {
      var opt = document.createElement('option');
      opt.value = CATEGORY_ORDER[i];
      opt.setAttribute('data-category', CATEGORY_ORDER[i]);
      var catI18nKey = CATEGORY_I18N[CATEGORY_ORDER[i]] || '';
      opt.textContent = SL.t(catI18nKey, CATEGORY_ORDER[i]);
      if (CATEGORY_ORDER[i] === _categoryKey) {
        opt.selected = true;
      }
      _categorySelect.appendChild(opt);
    }
    _categorySelect.addEventListener('change', function() {
      _categoryKey = _categorySelect.value;
      _populatePhraseSelect();
    });
    return _categorySelect;
  }

  // The phrase picker field contains a labelled select + small die button.
  function _buildPhraseField() {
    var field = document.createElement('label');
    field.className = 'ssli-acid-field';

    var span = document.createElement('span');
    span.className = 'ssli-acid-field-label';
    span.textContent = SL.t('acid.preset');
    field.appendChild(span);

    var row = document.createElement('div');
    row.className = 'ssli-acid-phrase-row';

    _phraseSelect = document.createElement('select');
    _phraseSelect.className = 'ssli-acid-select ssli-acid-phrase-select';
    _populatePhraseSelect();
    _phraseSelect.addEventListener('change', function() {
      _loadPhraseByKey(_phraseSelect.value);
    });
    row.appendChild(_phraseSelect);

    _randomBtn = document.createElement('button');
    _randomBtn.type = 'button';
    _randomBtn.className = 'ssli-acid-btn ssli-acid-random-btn';
    // Die face glyph via surrogate-pair escape (ES5 safe).
    _randomBtn.textContent = SL.t('btn.randomDice');
    _randomBtn.setAttribute('aria-label', SL.t('aria.randomPhraseInCategory'));
    _randomBtn.title = SL.t('tooltip.randomPhraseInCategory');
    _randomBtn.addEventListener('click', _onRandomInCategory);
    row.appendChild(_randomBtn);

    field.appendChild(row);
    return field;
  }

  function _populatePhraseSelect() {
    if (_phraseSelect) {
      _phraseSelect.innerHTML = '';
    var keys = _getPhraseKeysForCategory(_categoryKey);
    var i;
    var RE_PHRASE_NONALNUM = /[^a-z0-9]+/g;
    var RE_PHRASE_TRAIL_UNDERSCORE = /_+$/;
    var isFoundCurrent = false;
    for (i = 0; i < keys.length; i++) {
      if (keys[i] === _phraseKey) {
        isFoundCurrent = true;
        break;
      }
    }
    for (i = 0; i < keys.length; i++) {
      var opt = document.createElement('option');
      opt.value = keys[i];
      var phraseName = PHRASE_PRESETS[keys[i]].label;
      var phraseI18nKey = 'acid_phrase.' + phraseName.toLowerCase().replace(RE_PHRASE_NONALNUM, '_').replace(RE_PHRASE_TRAIL_UNDERSCORE, '');
      opt.textContent = SL.t(phraseI18nKey, phraseName);
      if (isFoundCurrent && keys[i] === _phraseKey) {
        opt.selected = true;
      } else if (!isFoundCurrent && i === 0) {
        opt.selected = true;
      }
      _phraseSelect.appendChild(opt);
    }
    }
  }

  function _buildStepCountToggle() {
    var field = document.createElement('div');
    field.className = 'ssli-acid-field';
    var span = document.createElement('span');
    span.className = 'ssli-acid-field-label';
    span.textContent = SL.t('acid.steps');
    field.appendChild(span);

    var group = document.createElement('div');
    group.className = 'ssli-acid-seg';
    _stepCountBtns = { eight: null, sixteen: null };

    var btn8 = document.createElement('button');
    btn8.type = 'button';
    btn8.className = 'ssli-acid-seg-btn';
    btn8.textContent = '8';
    btn8.addEventListener('click', function() { _setStepCount(STEPS_8); });
    _stepCountBtns.eight = btn8;
    group.appendChild(btn8);

    var btn16 = document.createElement('button');
    btn16.type = 'button';
    btn16.className = 'ssli-acid-seg-btn';
    btn16.textContent = '16';
    btn16.addEventListener('click', function() { _setStepCount(STEPS_16); });
    _stepCountBtns.sixteen = btn16;
    group.appendChild(btn16);

    _syncStepCountButtons();
    field.appendChild(group);
    return field;
  }

  function _syncStepCountButtons() {
    if (_stepCountBtns) {
      if (_stepCount === STEPS_8) {
        _stepCountBtns.eight.classList.add('active');
        _stepCountBtns.sixteen.classList.remove('active');
      } else {
        _stepCountBtns.sixteen.classList.add('active');
        _stepCountBtns.eight.classList.remove('active');
      }
    }
  }

  function _setStepCount(n) {
    if (n === STEPS_8 || n === STEPS_16) {
      _stepCount = n;
      _syncStepCountButtons();
      _rebuildGrid();
    }
  }

  function _buildBpmControl() {
    var field = document.createElement('div');
    field.className = 'ssli-acid-field ssli-acid-bpm-field';
    var span = document.createElement('span');
    span.className = 'ssli-acid-field-label';
    span.textContent = SL.t('acid.bpm');
    field.appendChild(span);

    _bpmInput = document.createElement('input');
    _bpmInput.type = 'range';
    _bpmInput.className = 'ssli-acid-slider';
    _bpmInput.min = String(MIN_BPM);
    _bpmInput.max = String(MAX_BPM);
    _bpmInput.step = '1';
    _bpmInput.value = String(_bpm);

    var valSpan = document.createElement('span');
    valSpan.className = 'ssli-acid-field-value';
    valSpan.textContent = String(_bpm);

    _bpmInput.addEventListener('input', function() {
      var v = parseInt(_bpmInput.value, 10);
      if (isNaN(v)) { v = DEFAULT_BPM; }
      _bpm = v;
      valSpan.textContent = String(v);
    });
    field.appendChild(_bpmInput);
    field.appendChild(valSpan);
    return field;
  }

  function _buildSwingControl() {
    var field = document.createElement('label');
    field.className = 'ssli-acid-field';
    var span = document.createElement('span');
    span.className = 'ssli-acid-field-label';
    span.textContent = SL.t('acid.swing');
    field.appendChild(span);

    _swingInput = document.createElement('input');
    _swingInput.type = 'range';
    _swingInput.className = 'ssli-acid-range';
    _swingInput.min = String(MIN_SWING_PCT);
    _swingInput.max = String(MAX_SWING_PCT);
    _swingInput.step = '1';
    _swingInput.value = String(_swingPct);
    _swingInput.addEventListener('input', function() {
      var v = parseInt(_swingInput.value, 10);
      if (isNaN(v)) { v = 0; }
      _swingPct = v;
      if (_swingLabel) {
        _swingLabel.textContent = v + '%';
      }
    });
    field.appendChild(_swingInput);

    _swingLabel = document.createElement('span');
    _swingLabel.className = 'ssli-acid-range-label';
    _swingLabel.textContent = _swingPct + '%';
    field.appendChild(_swingLabel);
    return field;
  }

  function _buildGlideControl() {
    var field = document.createElement('label');
    field.className = 'ssli-acid-field';
    var span = document.createElement('span');
    span.className = 'ssli-acid-field-label';
    span.textContent = SL.t('acid.glide');
    field.appendChild(span);

    _glideInput = document.createElement('input');
    _glideInput.type = 'range';
    _glideInput.className = 'ssli-acid-range';
    _glideInput.min = String(MIN_GLIDE_PCT);
    _glideInput.max = String(MAX_GLIDE_PCT);
    _glideInput.step = '5';
    _glideInput.value = String(_glidePct);
    _glideInput.addEventListener('input', function() {
      var v = parseInt(_glideInput.value, 10);
      if (isNaN(v)) { v = DEFAULT_GLIDE_PCT; }
      _glidePct = v;
      if (_glideLabel) {
        _glideLabel.textContent = v + '%';
      }
    });
    field.appendChild(_glideInput);

    _glideLabel = document.createElement('span');
    _glideLabel.className = 'ssli-acid-range-label';
    _glideLabel.textContent = _glidePct + '%';
    field.appendChild(_glideLabel);
    return field;
  }

  function _buildGridArea() {
    var area = document.createElement('div');
    area.className = 'ssli-acid-grid-area';

    // Pattern silhouette strip (above grid)
    _silhouetteEl = document.createElement('div');
    _silhouetteEl.className = 'ssli-acid-silhouette';
    _silhouettePlayheadEl = document.createElement('div');
    _silhouettePlayheadEl.className = 'ssli-acid-silhouette-playhead';
    _silhouetteEl.appendChild(_silhouettePlayheadEl);
    area.appendChild(_silhouetteEl);

    // Grid + overlays
    _gridWrapEl = document.createElement('div');
    _gridWrapEl.className = 'ssli-acid-grid-wrap';

    _gridEl = document.createElement('div');
    _gridEl.className = 'ssli-acid-grid';
    _gridWrapEl.appendChild(_gridEl);

    _slideSvgEl = document.createElementNS(SVG_NS, 'svg');
    _slideSvgEl.setAttribute('class', 'ssli-acid-slide-svg');
    _slideSvgEl.setAttribute('aria-hidden', 'true');
    _gridWrapEl.appendChild(_slideSvgEl);

    _emptyHintEl = document.createElement('div');
    _emptyHintEl.className = 'ssli-acid-empty-hint';
    _emptyHintEl.textContent = SL.t('acid.empty_hint');
    _gridWrapEl.appendChild(_emptyHintEl);

    area.appendChild(_gridWrapEl);

    return area;
  }

  function _buildFooterHint() {
    var foot = document.createElement('div');
    foot.className = 'ssli-acid-footer';
    foot.textContent = SL.t('acid.footer');
    return foot;
  }

  function _clampAllStepsToScale() {
    var scalePcs = _getScalePitchClasses();
    var maxIdx = scalePcs.length - 1;
    var i;
    for (i = 0; i < _steps.length; i++) {
      if (_steps[i].pc > maxIdx) {
        _steps[i].pc = maxIdx;
      }
      if (_steps[i].pc < 0) {
        _steps[i].pc = 0;
      }
    }
  }

  function _isPhoneLand() {
    var layoutAttr = document.documentElement.getAttribute('data-layout');
    var isPhone = (layoutAttr === 'phone-land');
    return isPhone;
  }

  function _rebuildGrid() {
    if (_gridEl) {
      _gridEl.innerHTML = '';
      _gridEl.setAttribute('data-stepcount', String(_stepCount));

      var useDrumGrid = _isPhoneLand();
      if (useDrumGrid) {
        _rebuildDrumGrid();
      } else {
        _rebuildColumnGrid();
      }

      _refreshPlayheadHighlight();
      _rebuildSilhouette();
      _updateSlideArcs();
      _updateEmptyHint();
      // Re-run after layout settles so SVG arc geometry picks up final cell rects.
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(function() { _updateSlideArcs(); });
      }
    }
  }

  function _rebuildColumnGrid() {
    _gridEl.classList.remove('ssli-acid-drum-grid');
    _gridEl.removeAttribute('data-drum-rows');
    var scalePcs = _getScalePitchClasses();
    var scaleLen = scalePcs.length;
    var i;
    if (_selectedStepIdx >= _stepCount) {
      _selectedStepIdx = 0;
    }
    for (i = 0; i < _stepCount; i++) {
      _gridEl.appendChild(_buildStepCell(i, scaleLen));
    }
  }

  // Drum-machine style grid: rows = scale degrees (high to low), columns = steps.
  // Each cell is a toggle: tap to enable that note at that step (sets gate + pc).
  // Tapping a lit cell in the same row clears the gate.
  // Tapping a lit cell in a different row moves the note.
  function _rebuildDrumGrid() {
    var scalePcs = _getScalePitchClasses();
    var scaleLen = scalePcs.length;
    var stepIdx;
    var noteRow;

    _gridEl.classList.add('ssli-acid-drum-grid');
    _gridEl.setAttribute('data-drum-rows', String(scaleLen));

    // Build header row (step numbers)
    var headerCorner = document.createElement('div');
    headerCorner.className = 'ssli-acid-drum-corner';
    _gridEl.appendChild(headerCorner);
    for (stepIdx = 0; stepIdx < _stepCount; stepIdx++) {
      var stepHeader = document.createElement('div');
      stepHeader.className = 'ssli-acid-drum-step-hdr';
      stepHeader.textContent = String(stepIdx + 1);
      _gridEl.appendChild(stepHeader);
    }

    // Build note rows from highest pitch to lowest
    for (noteRow = scaleLen - 1; noteRow >= 0; noteRow--) {
      // Row label (note name)
      var rowLabel = document.createElement('div');
      rowLabel.className = 'ssli-acid-drum-label';
      rowLabel.textContent = _pcNameForDegree(noteRow);
      _gridEl.appendChild(rowLabel);

      // Step cells for this row
      for (stepIdx = 0; stepIdx < _stepCount; stepIdx++) {
        var cell = _buildDrumCell(stepIdx, noteRow, scaleLen);
        _gridEl.appendChild(cell);
      }
    }

    // Control row at bottom: slide + accent toggles per step
    var ctrlCornerLabel = document.createElement('div');
    ctrlCornerLabel.className = 'ssli-acid-drum-corner ssli-acid-drum-ctrl-label';
    ctrlCornerLabel.textContent = SL.t('acid.ctrl_label');
    _gridEl.appendChild(ctrlCornerLabel);
    for (stepIdx = 0; stepIdx < _stepCount; stepIdx++) {
      var ctrlCell = _buildDrumCtrlCell(stepIdx);
      _gridEl.appendChild(ctrlCell);
    }
  }

  function _buildDrumCell(stepIdx, noteRowPc, scaleLen) {
    var step = _steps[stepIdx];
    var cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'ssli-acid-drum-cell';
    cell.setAttribute('data-step', String(stepIdx));
    cell.setAttribute('data-pc', String(noteRowPc));

    var isActive = (step.gate && (step.pc === noteRowPc));
    if (isActive) {
      cell.classList.add('lit');
      if (step.accent) {
        cell.classList.add('accent');
      }
      if (step.slide) {
        cell.classList.add('slide');
      }
    }

    // Also mark the step column class for playhead highlighting
    cell.setAttribute('data-step-col', String(stepIdx));

    cell.setAttribute('aria-label', _pcNameForDegree(noteRowPc) + ' step ' + (stepIdx + 1) + (isActive ? ' on' : ' off'));

    (function(sIdx, pcIdx) {
      cell.addEventListener('click', function() {
        var s = _steps[sIdx];
        var wasActive = (s.gate && (s.pc === pcIdx));
        if (wasActive) {
          // Toggle off: clear the gate
          s.gate = false;
        } else {
          // Activate: set gate on and pitch to this row
          s.gate = true;
          s.pc = pcIdx;
        }
        _selectedStepIdx = sIdx;
        _rebuildGrid();
      });
    })(stepIdx, noteRowPc);

    return cell;
  }

  function _buildDrumCtrlCell(stepIdx) {
    var step = _steps[stepIdx];
    var cell = document.createElement('div');
    cell.className = 'ssli-acid-drum-ctrl';
    cell.setAttribute('data-step-col', String(stepIdx));

    var slideBtn = document.createElement('button');
    slideBtn.type = 'button';
    slideBtn.className = 'ssli-acid-drum-ctrl-btn';
    if (step.slide) {
      slideBtn.classList.add('slide-on');
    }
    slideBtn.textContent = 'S';
    slideBtn.setAttribute('aria-label', SL.t('aria.slideStep') + ' ' + (stepIdx + 1));
    (function(sIdx) {
      slideBtn.addEventListener('click', function() {
        _steps[sIdx].slide = !_steps[sIdx].slide;
        _rebuildGrid();
      });
    })(stepIdx);
    cell.appendChild(slideBtn);

    var accentBtn = document.createElement('button');
    accentBtn.type = 'button';
    accentBtn.className = 'ssli-acid-drum-ctrl-btn';
    if (step.accent) {
      accentBtn.classList.add('accent-on');
    }
    accentBtn.textContent = 'A';
    accentBtn.setAttribute('aria-label', SL.t('aria.accentStep') + ' ' + (stepIdx + 1));
    (function(sIdx) {
      accentBtn.addEventListener('click', function() {
        _steps[sIdx].accent = !_steps[sIdx].accent;
        _rebuildGrid();
      });
    })(stepIdx);
    cell.appendChild(accentBtn);

    return cell;
  }

  function _rebuildSilhouette() {
    if (_silhouetteEl) {
      // Remove all ticks (preserve the playhead element)
      var children = _silhouetteEl.querySelectorAll('.ssli-acid-silhouette-tick');
    var c;
    for (c = 0; c < children.length; c++) {
      _silhouetteEl.removeChild(children[c]);
    }
    var scalePcs = _getScalePitchClasses();
    var scaleLen = scalePcs.length;
    var i;
    for (i = 0; i < _stepCount; i++) {
      var step = _steps[i];
      var tick = document.createElement('div');
      tick.className = 'ssli-acid-silhouette-tick';
      if (!step.gate) {
        tick.classList.add(SILHOUETTE_OFF_CLASS);
      } else if (step.accent) {
        tick.classList.add(SILHOUETTE_ACCENT_CLASS);
      }
      var heightPct = _pitchFillPct(step.pc, scaleLen);
      tick.style.height = heightPct + '%';
      // Insert before the playhead element so playhead stays on top
      _silhouetteEl.insertBefore(tick, _silhouettePlayheadEl);
    }
    _refreshSilhouettePlayhead();
    }
  }

  function _pitchFillPct(pcIdx, scaleLen) {
    var safeIdx = pcIdx;
    if (safeIdx < 0) { safeIdx = 0; }
    if (safeIdx > (scaleLen - 1)) { safeIdx = scaleLen - 1; }
    var normRange = scaleLen - 1;
    var heightPct;
    if (normRange <= 0) {
      heightPct = PITCH_BAR_MAX_FILL_PCT;
    } else {
      var normalized = safeIdx / normRange;
      heightPct = PITCH_BAR_MIN_FILL_PCT + (normalized * (PITCH_BAR_MAX_FILL_PCT - PITCH_BAR_MIN_FILL_PCT));
    }
    return heightPct;
  }

  function _refreshSilhouettePlayhead() {
    if (_silhouettePlayheadEl) {
      var isVisible = isPlaying;
      if (isVisible) {
        _silhouettePlayheadEl.classList.add('visible');
        var pct = (_currentStep + 0.5) / _stepCount * 100;
        _silhouettePlayheadEl.style.left = pct + '%';
      } else {
        _silhouettePlayheadEl.classList.remove('visible');
      }
    }
  }

  function _updateSlideArcs() {
    if (_slideSvgEl && _gridEl) {
      // Clear existing paths
      while (_slideSvgEl.firstChild) {
        _slideSvgEl.removeChild(_slideSvgEl.firstChild);
      }
      var cells = _gridEl.querySelectorAll('.ssli-acid-step');
      if (cells && cells.length >= 2) {
        var gridRect = _gridEl.getBoundingClientRect();
        if (gridRect.width > 0 && gridRect.height > 0) {
          _slideSvgEl.setAttribute('viewBox', '0 0 ' + gridRect.width + ' ' + gridRect.height);
          _slideSvgEl.setAttribute('width', String(gridRect.width));
          _slideSvgEl.setAttribute('height', String(gridRect.height));
          var i;
          var pathCount = 0;
          for (i = 0; i < _stepCount - 1; i++) {
            var stepA = _steps[i];
            var stepB = _steps[i + 1];
            var hasSlide = stepA && stepA.gate && stepA.slide && stepB && stepB.gate;
            if (!hasSlide) {
              continue;
            }
            var rectA = cells[i].getBoundingClientRect();
            var rectB = cells[i + 1].getBoundingClientRect();
            var ax = (rectA.left + rectA.width - gridRect.left);
            var ay = (rectA.top - gridRect.top) + 6;
            var bx = (rectB.left - gridRect.left);
            var by = (rectB.top - gridRect.top) + 6;
            var midY = Math.min(ay, by) - ((rectA.height + rectB.height) * 0.5 * SLIDE_ARC_CURVE_RATIO);
            if (midY < 2) { midY = 2; }
            var cx = (ax + bx) / 2;
            var d = 'M ' + ax + ' ' + ay
                  + ' Q ' + cx + ' ' + midY
                  + ' ' + bx + ' ' + by;
            var pathEl = document.createElementNS(SVG_NS, 'path');
            pathEl.setAttribute('class', 'ssli-acid-slide-path');
            pathEl.setAttribute('d', d);
            pathEl.setAttribute('data-slide-from', String(i));
            pathEl.setAttribute('data-slide-to', String(i + 1));
            _slideSvgEl.appendChild(pathEl);
            pathCount++;
          }
          _slideSvgEl.setAttribute('data-slide-count', String(pathCount));
        }
      }
    }
  }

  function _updateEmptyHint() {
    if (_emptyHintEl) {
      var isAnyGate = false;
      var i;
      for (i = 0; i < _stepCount; i++) {
        if (_steps[i] && _steps[i].gate) {
          isAnyGate = true;
          break;
        }
      }
      if (isAnyGate) {
        _emptyHintEl.classList.remove('visible');
      } else {
        _emptyHintEl.classList.add('visible');
      }
    }
  }

  function _buildStepCell(stepIdx, scaleLen) {
    var step = _steps[stepIdx];
    var cell = document.createElement('div');
    cell.className = 'ssli-acid-step';
    cell.setAttribute('data-step', String(stepIdx));
    if (step.gate) {
      cell.classList.add('gate-on');
    }
    if (step.accent) {
      cell.classList.add('accent');
    }
    if (step.slide) {
      cell.classList.add('slide');
    }
    if (stepIdx === _selectedStepIdx) {
      cell.classList.add('focused');
    }

    // Pitch UP button (above the pitch bar)
    var pitchUp = document.createElement('button');
    pitchUp.type = 'button';
    pitchUp.className = 'ssli-acid-step-pitch-btn ssli-acid-step-pitch-up';
    pitchUp.textContent = '▲';
    pitchUp.setAttribute('aria-label', SL.t('aria.pitchUp'));
    pitchUp.addEventListener('click', function() {
      step.pc = step.pc + 1;
      if (step.pc >= scaleLen) { step.pc = scaleLen - 1; }
      _selectedStepIdx = stepIdx;
      _rebuildGrid();
    });
    cell.appendChild(pitchUp);

    // Tri-dot LED indicator row (Octave / Slide / Accent)
    cell.appendChild(_buildTriDotRow(step, stepIdx));

    // Pitch bar (vertical fill representing pitch within scale)
    cell.appendChild(_buildPitchBar(step, scaleLen));

    // Note name label
    var noteLabel = document.createElement('span');
    noteLabel.className = 'ssli-acid-step-note';
    noteLabel.textContent = _pcNameForDegree(step.pc);
    cell.appendChild(noteLabel);

    // Step number badge (tap to toggle gate)
    var header = document.createElement('button');
    header.type = 'button';
    header.className = 'ssli-acid-step-header';
    header.setAttribute('aria-label', SL.t('aria.toggleGateForStep') + ' ' + (stepIdx + 1));
    header.textContent = String(stepIdx + 1);
    header.addEventListener('click', function() {
      step.gate = !step.gate;
      _selectedStepIdx = stepIdx;
      _rebuildGrid();
    });
    cell.appendChild(header);

    // Pitch DOWN button (below the gate badge)
    var pitchDown = document.createElement('button');
    pitchDown.type = 'button';
    pitchDown.className = 'ssli-acid-step-pitch-btn ssli-acid-step-pitch-down';
    pitchDown.textContent = SL.t('btn.arrowDown');
    pitchDown.setAttribute('aria-label', SL.t('aria.pitchDown'));
    pitchDown.addEventListener('click', function() {
      step.pc = step.pc - 1;
      if (step.pc < 0) { step.pc = 0; }
      _selectedStepIdx = stepIdx;
      _rebuildGrid();
    });
    cell.appendChild(pitchDown);

    return cell;
  }

  function _buildPitchBar(step, scaleLen) {
    var bar = document.createElement('div');
    bar.className = 'ssli-acid-pitchbar';
    var fill = document.createElement('div');
    fill.className = 'ssli-acid-pitchbar-fill';
    var heightPct = _pitchFillPct(step.pc, scaleLen);
    fill.style.height = heightPct + '%';
    bar.appendChild(fill);
    return bar;
  }

  function _buildPitchRow(step, scaleLen, stepIdx) {
    var pitchRow = document.createElement('div');
    pitchRow.className = 'ssli-acid-step-pitch';

    var pitchDown = document.createElement('button');
    pitchDown.type = 'button';
    pitchDown.className = 'ssli-acid-step-mini';
    pitchDown.textContent = SL.t('btn.arrowDown');
    pitchDown.setAttribute('aria-label', SL.t('aria.pitchDown'));
    pitchDown.addEventListener('click', function() {
      step.pc = step.pc - 1;
      if (step.pc < 0) { step.pc = 0; }
      _selectedStepIdx = stepIdx;
      _rebuildGrid();
    });
    pitchRow.appendChild(pitchDown);

    var pitchName = document.createElement('span');
    pitchName.className = 'ssli-acid-step-note';
    pitchName.textContent = _pcNameForDegree(step.pc);
    pitchRow.appendChild(pitchName);

    var pitchUp = document.createElement('button');
    pitchUp.type = 'button';
    pitchUp.className = 'ssli-acid-step-mini';
    pitchUp.textContent = SL.t('btn.arrowUp');
    pitchUp.setAttribute('aria-label', SL.t('aria.pitchUp'));
    pitchUp.addEventListener('click', function() {
      step.pc = step.pc + 1;
      if (step.pc >= scaleLen) { step.pc = scaleLen - 1; }
      _selectedStepIdx = stepIdx;
      _rebuildGrid();
    });
    pitchRow.appendChild(pitchUp);

    return pitchRow;
  }

  function _buildTriDotRow(step, stepIdx) {
    var row = document.createElement('div');
    row.className = 'ssli-acid-dots';

    // Octave dot: cycles -1 -> 0 -> +1 -> -1
    var octDot = document.createElement('button');
    octDot.type = 'button';
    octDot.className = 'ssli-acid-dot dot-octave';
    if (step.oct === 1) {
      octDot.classList.add('on', 'dot-octave-up');
    } else if (step.oct === OCT_DOWN) {
      octDot.classList.add('on', 'dot-octave-down');
    }
    var octAriaLabel = 'Octave ';
    if (step.oct === 1) { octAriaLabel += 'plus one'; }
    else if (step.oct === OCT_DOWN) { octAriaLabel += 'minus one'; }
    else { octAriaLabel += 'zero'; }
    octDot.setAttribute('aria-label', octAriaLabel);
    octDot.title = SL.t('tooltip.octaveTapCycle');
    octDot.addEventListener('click', function() {
      var nextOct;
      if (step.oct === 0) {
        nextOct = 1;
      } else if (step.oct === 1) {
        nextOct = -1;
      } else {
        nextOct = 0;
      }
      step.oct = nextOct;
      _selectedStepIdx = stepIdx;
      _rebuildGrid();
    });
    row.appendChild(octDot);

    // Slide dot
    var slideDot = document.createElement('button');
    slideDot.type = 'button';
    slideDot.className = 'ssli-acid-dot dot-slide';
    if (step.slide) {
      slideDot.classList.add('on');
    }
    slideDot.setAttribute('aria-label', step.slide ? 'Slide on' : 'Slide off');
    slideDot.title = SL.t('tooltip.slideGlide');
    slideDot.addEventListener('click', function() {
      step.slide = !step.slide;
      _selectedStepIdx = stepIdx;
      _rebuildGrid();
    });
    row.appendChild(slideDot);

    // Accent dot
    var accentDot = document.createElement('button');
    accentDot.type = 'button';
    accentDot.className = 'ssli-acid-dot dot-accent';
    if (step.accent) {
      accentDot.classList.add('on');
    }
    accentDot.setAttribute('aria-label', step.accent ? 'Accent on' : 'Accent off');
    accentDot.title = SL.t('tooltip.accentLouder');
    accentDot.addEventListener('click', function() {
      step.accent = !step.accent;
      _selectedStepIdx = stepIdx;
      _rebuildGrid();
    });
    row.appendChild(accentDot);

    // Mark the "priority" dot (shown on phone-land): accent > slide > octave
    var priorityDot = octDot;
    if (step.accent) {
      priorityDot = accentDot;
    } else if (step.slide) {
      priorityDot = slideDot;
    } else if (step.oct !== 0) {
      priorityDot = octDot;
    }
    priorityDot.classList.add('priority');

    return row;
  }

  function _refreshPlayheadHighlight() {
    if (_gridEl) {
      // Original column-based grid
      var cells = _gridEl.querySelectorAll('.ssli-acid-step');
    var i;
    for (i = 0; i < cells.length; i++) {
      if (isPlaying && i === _currentStep) {
        cells[i].classList.add('playing');
      } else {
        cells[i].classList.remove('playing');
      }
    }
    // Drum grid: highlight all cells in the current step column
    var drumCells = _gridEl.querySelectorAll('[data-step-col]');
    for (i = 0; i < drumCells.length; i++) {
      var colIdx = parseInt(drumCells[i].getAttribute('data-step-col'), 10);
      if (isPlaying && (colIdx === _currentStep)) {
        drumCells[i].classList.add('playing-col');
      } else {
        drumCells[i].classList.remove('playing-col');
      }
    }
    _refreshSilhouettePlayhead();
    }
  }

  // ============================================================
  // Keyboard shortcuts (active only while Step screen is active)
  // ============================================================

  function _onKeyDown(e) {
    if (isScreenActive) {
      // Ignore when user is typing in an input/select
      var tgt = e.target;
      var isPassthrough = (tgt && KEYBOARD_PASSTHROUGH_TAGS[tgt.tagName]);
      if (!isPassthrough) {
        var scalePcs = _getScalePitchClasses();
        var scaleLen = scalePcs.length;
        var isHandled = false;

        if (e.key === KEY_SPACE) {
          _onPlay();
          isHandled = true;
        } else if (e.key === KEY_ARROW_LEFT) {
          _selectedStepIdx = (_selectedStepIdx - 1 + _stepCount) % _stepCount;
          _rebuildGrid();
          isHandled = true;
        } else if (e.key === KEY_ARROW_RIGHT) {
          _selectedStepIdx = (_selectedStepIdx + 1) % _stepCount;
          _rebuildGrid();
          isHandled = true;
        } else if (e.key === KEY_ARROW_UP) {
          var sUp = _steps[_selectedStepIdx];
          if (sUp) {
            sUp.pc = sUp.pc + 1;
            if (sUp.pc >= scaleLen) { sUp.pc = scaleLen - 1; }
            _rebuildGrid();
          }
          isHandled = true;
        } else if (e.key === KEY_ARROW_DOWN) {
          var sDown = _steps[_selectedStepIdx];
          if (sDown) {
            sDown.pc = sDown.pc - 1;
            if (sDown.pc < 0) { sDown.pc = 0; }
            _rebuildGrid();
          }
          isHandled = true;
        } else if (e.key === KEY_S_LOWER || e.key === 'S') {
          var sSlide = _steps[_selectedStepIdx];
          if (sSlide) {
            sSlide.slide = !sSlide.slide;
            _rebuildGrid();
          }
          isHandled = true;
        } else if (e.key === KEY_A_LOWER || e.key === 'A') {
          var sAcc = _steps[_selectedStepIdx];
          if (sAcc) {
            sAcc.accent = !sAcc.accent;
            _rebuildGrid();
          }
          isHandled = true;
        }
        if (isHandled) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    }
  }

  function _bindKeyboard() {
    if (!isKeyHandlerBound) {
      document.addEventListener('keydown', _onKeyDown, true);
      isKeyHandlerBound = true;
    }
  }

  function _updateTransportUI() {
    if (_playBtn) {
      if (isPlaying) {
        _playBtn.textContent = SL.t('acid.pause');
        _playBtn.classList.add('playing');
      } else {
        _playBtn.textContent = SL.t('acid.play');
        _playBtn.classList.remove('playing');
      }
    }
  }

  function _onClear() {
    var i;
    for (i = 0; i < _steps.length; i++) {
      _steps[i] = _makeEmptyStep();
    }
    _rebuildGrid();
  }

  // ============================================================
  // Panic registration
  // ============================================================

  function _registerPanic() {
    if (SL.PanicRegistry) {
      SL.PanicRegistry.register(
      PANIC_CATEGORY_INTERVALS,
      PANIC_KEY_CLOCK,
      function() {
        // Teardown: stop the clock + slide interval.
        isPlaying = false;
        if (_clockTimerId !== NO_TIMER) {
          clearTimeout(_clockTimerId);
          _clockTimerId = null;
        }
        if (_slideTimerId !== NO_TIMER) {
          clearInterval(_slideTimerId);
          _slideTimerId = null;
        }
        _updateTransportUI();
        _refreshPlayheadHighlight();
      },
      function() {
        if (_clockTimerId !== NO_TIMER) {
          return 'acid clock timer still scheduled';
        }
        if (_slideTimerId !== NO_TIMER) {
          return 'acid slide timer still scheduled';
        }
        return null;
      }
    );
    SL.PanicRegistry.register(
      PANIC_CATEGORY_VOICES,
      PANIC_KEY_VOICES,
      function() {
        _silenceActiveVoice();
      },
      function() {
        if (_activeSustainedMidi >= 0) {
          return 'acid voice still active: ' + _activeSustainedMidi;
        }
        return null;
      }
    );
    }
  }

  // ============================================================
  // Init / Activate / Deactivate
  // ============================================================

  function _init() {
    if (!isScreenInitialized) {
    _resetStepsFromPhrase(_phraseKey);
    _clampAllStepsToScale();
    _buildScreen();
    _registerPanic();
    _bindKeyboard();
    isScreenInitialized = true;

    // Refresh translatable text in category and phrase dropdowns when the
    // active language changes after the screen has already been built.
    if (SL.localization && SL.localization.onLanguageChange) {
      SL.localization.onLanguageChange(function() {
        // --- Category select options ---
        var catSelect = document.querySelector('.ssli-acid-category-select');
        if (catSelect) {
          var catOpts = catSelect.querySelectorAll('option');
          var ci = 0;
          while (ci < catOpts.length) {
            var catName = catOpts[ci].getAttribute('data-category');
            var catI18nKey = CATEGORY_I18N[catName] || '';
            if (catI18nKey) {
              catOpts[ci].textContent = SL.t(catI18nKey, catName);
            }
            ci = ci + 1;
          }
        }
        // --- Phrase select options ---
        if (_phraseSelect) {
          var phraseOpts = _phraseSelect.querySelectorAll('option');
          var RE_OPT_NONALNUM = /[^a-z0-9]+/g;
          var RE_OPT_TRAIL_UNDERSCORE = /_+$/;
          var pi = 0;
          while (pi < phraseOpts.length) {
            var pKey = phraseOpts[pi].value;
            var preset = PHRASE_PRESETS[pKey];
            if (preset) {
              var phraseName = preset.label;
              var phraseI18nKey = 'acid_phrase.' + phraseName.toLowerCase().replace(RE_OPT_NONALNUM, '_').replace(RE_OPT_TRAIL_UNDERSCORE, '');
              phraseOpts[pi].textContent = SL.t(phraseI18nKey, phraseName);
            }
            pi = pi + 1;
          }
        }
      });
    }
    }
  }

  function activate() {
    _init();
    isScreenActive = true;
    // Rebuild in case DOM was lost
    if (!_gridEl || !_screenEl) {
      _buildScreen();
    } else {
      _rebuildGrid();
    }
    // Sync root/mode from global Play screen
    if (SL.screenPlay && SL.screenPlay.getRootPc) {
      var globalRoot = SL.screenPlay.getRootPc();
      _rootPc = globalRoot;
      if (_rootSelect) {
        _rootSelect.value = String(globalRoot);
      }
    }
    if (SL.screenPlay && SL.screenPlay.getModeKey) {
      var globalMode = SL.screenPlay.getModeKey();
      _modeKey = globalMode;
      if (_modeSelect) {
        _modeSelect.value = globalMode;
      }
    }
    // If the sequencer is still running from a prior activation, re-sync the
    // Play button's visual state so it reflects reality.
    if (_playBtn) {
      if (isPlaying) {
        _playBtn.classList.add('playing');
      } else {
        _playBtn.classList.remove('playing');
      }
    }
  }

  function deactivate() {
    isScreenActive = false;
    // Stop the transport when leaving the Acid screen so the clock interval
    // does not keep sending noteOn/noteOff to the audio engine indefinitely.
    if (isPlaying) {
      _stopTransport();
    }
  }

  // ============================================================
  // Export
  // ============================================================

  SL.screenAcid = {
    activate: activate,
    deactivate: deactivate,
    // Test helpers
    isPlaying: function() { return isPlaying; },
    _getCurrentStep: function() { return _currentStep; },
    _getActiveMidi: function() { return _activeSustainedMidi; },
    _getSteps: function() { return _steps; },
    _setBpm: function(b) { _bpm = b; if (_bpmInput) { _bpmInput.value = String(b); } },
    _getSelectedStep: function() { return _selectedStepIdx; },
    _rebuildGrid: function() { _rebuildGrid(); },
    _setStepFlag: function(idx, key, val) {
      if (_steps[idx]) {
        _steps[idx][key] = val;
        _rebuildGrid();
      }
    },
    // Phrase library introspection — used by tests
    _getPhrasePresets: function() { return PHRASE_PRESETS; },
    _getCategoryOrder: function() { return CATEGORY_ORDER; },
    _getCategoryAll: function() { return CATEGORY_ALL; },
    _getPhraseKey: function() { return _phraseKey; },
    _getCategoryKey: function() { return _categoryKey; },
    _getBpm: function() { return _bpm; },
    _getSwing: function() { return _swingPct; },
    _getMode: function() { return _modeKey; },
    _loadPhraseByKey: function(k) { _loadPhraseByKey(k); },
    _setCategoryKey: function(c) {
      _categoryKey = c;
      if (_categorySelect) { _categorySelect.value = c; }
      _populatePhraseSelect();
    },
    _randomInCategory: function() { _onRandomInCategory(); }
  };

})();
