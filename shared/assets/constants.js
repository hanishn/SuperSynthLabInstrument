// Synth Lab - Constants Module
// Extracted from Music Tool exhibit for modular architecture

var SynthLab = window.SynthLab || {};
var SL = SynthLab;

// Sentinel constants
var NOT_FOUND = -1;
var NO_STORED_VALUE = null;

// =============================================================================
// Global Drag Data Store (browsers restrict reading dataTransfer in dragover)
// =============================================================================

/** Stores drag data during drag operations for access in dragover/dragleave */
SynthLab.currentDragData = null;

/** Pressure diagnostic state for debug panel (populated by velocityFromPressure) */
SynthLab._pressureDiag = {
  lastPath: 'none',
  lastPressure: -1,
  lastPointerType: 'N/A',
  lastTouchForce: -1,
  lastTouchForceRaw: -1,
  lastPointerPressure: -1,
  lastGlobalForce: -1,
  lastGlobalForceAge: -1,
  lastRadiusX: -1,
  lastRadiusY: -1,
  lastPointerWidth: -1,
  lastPointerHeight: -1,
  lastGlobalRadiusX: -1,
  forceAppearsConstant: false,
  touchSensitivity: 25,
  radiusMin: 8,
  radiusMax: 22
};

/** Global touch force capture for iOS fallback (pointerdown has pressure=0) */
SynthLab._lastTouchForce = { force: 0, radiusX: 0, radiusY: 0, timestamp: 0 };
/** Tracks recent force values to detect constant (fake) force sensors */
SynthLab._recentForceValues = [];
SynthLab._touchForceListenerAdded = false;

// =============================================================================
// Audio Constants
// =============================================================================

/** Duration for note playback in seconds */
SynthLab.DURATION = 0.4;

/** Sample rate for audio generation */
SynthLab.SR = 44100;

/** Two times PI - used for waveform calculations */
SynthLab.TWO_PI = 2 * Math.PI;

// =============================================================================
// Sequencer Constants
// =============================================================================

/** Number of steps in the sequencer (64 = 4 bars at 16 steps per bar) */
SynthLab.SEQ_STEPS = 64;

/** Number of rows in the sequencer grid (84 = 7 octaves x 12 notes) */
SynthLab.SEQ_ROWS = 84;

/** Base MIDI note for the sequencer grid (24 = C1) */
SynthLab.SEQ_BASE_MIDI = 24;

/** Sequencer cell height in pixels */
SynthLab.SEQ_CELL_H = 8;

/** Sequencer cell width in pixels */
SynthLab.SEQ_CELL_W = 13;

// =============================================================================
// Note Names
// =============================================================================

/** Array of note names in chromatic order (sharps) */
SynthLab.NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Array of note names using flats */
SynthLab.NOTES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Flat key roots (pitch classes): F, Bb, Eb, Ab, Db, Gb and relative minors Dm, Gm, Cm, Fm, Bbm, Ebm */
SynthLab.FLAT_KEY_ROOTS = [5, 10, 3, 8, 1, 6];

/** Check if a root pitch class should use flat naming */
SynthLab.useFlatNaming = function(rootPc) {
  return SynthLab.FLAT_KEY_ROOTS.indexOf(rootPc) !== NOT_FOUND;
};

/** Get note name array for a given root pitch class */
SynthLab.notesForKey = function(rootPc) {
  return SynthLab.useFlatNaming(rootPc) ? SynthLab.NOTES_FLAT : SynthLab.NOTES;
};

// =============================================================================
// CSS Class Arrays for Note Coloring
// =============================================================================

/** CSS classes for note dot colors (12 chromatic notes) */
SynthLab.DOT_CLASS = [
    'dot-C', 'dot-Cs', 'dot-D', 'dot-Ds', 'dot-E', 'dot-F',
    'dot-Fs', 'dot-G', 'dot-Gs', 'dot-A', 'dot-As', 'dot-B'
];

/** CSS classes for note background colors (12 chromatic notes) */
SynthLab.BG_CLASS = [
    'bg-C', 'bg-Cs', 'bg-D', 'bg-Ds', 'bg-E', 'bg-F',
    'bg-Fs', 'bg-G', 'bg-Gs', 'bg-A', 'bg-As', 'bg-B'
];

/** CSS classes for octave indicators */
SynthLab.OCT_CLASS = ['', '', 'oct-2', 'oct-3', 'oct-4', 'oct-5', 'oct-6', 'oct-7'];

// =============================================================================
// Data from JSON (loaded by build script via SynthLab._data)
// =============================================================================

/** Roman numerals for scale degrees */
SynthLab.NUMS = SynthLab._data.chordsProgressions.NUMS;

/** Musical modes with scales, triads, and seventh chords */
SynthLab.MODES = SynthLab._data.scalesModes;

/** Chord intervals (semitones from root) for each chord type */
SynthLab.CHORD_INT = SynthLab._data.chordsProgressions.CHORD_INT;

/** Chord name suffixes for display */
SynthLab.CHORD_NAME = SynthLab._data.chordsProgressions.CHORD_NAME;

/** CSS classes for chord button styling */
SynthLab.CHORD_CLS = SynthLab._data.chordsProgressions.CHORD_CLS;

/** Common chord progressions defined by scale degree indices (legacy flat list) */
SynthLab.PROGS = SynthLab._data.chordsProgressions.PROGS;

/** Chord progressions organized by genre - 8 progressions per genre */
SynthLab.PROG_GROUPS = SynthLab._data.chordsProgressions.PROG_GROUPS;

// =============================================================================
// Surface Definitions (shared by Play and Sound screens)
// =============================================================================

SynthLab.SURFACE_CATEGORIES = [
  { val: 'pads',       lbl: 'Pads',       i18n: 'category.pads' },
  { val: 'keys',       lbl: 'Keys',       i18n: 'category.keys' },
  { val: 'wind',       lbl: 'Wind',       i18n: 'category.wind' },
  { val: 'strings',    lbl: 'Strings',    i18n: 'category.strings' },
  { val: 'continuous', lbl: 'Continuous', i18n: 'category.continuous' },
  { val: 'grids',      lbl: 'Grids',      i18n: 'category.grids' }
];

SynthLab.SURFACE_DEFS = [
  // Ranked best-to-worst per user review. Score = rank (28 = best, 1 = worst).
  // tonnetz merged into hex; iso5+chromaticgrid merged into grid.
  // i18n keys are resolved at render time via SL.t(); lbl is the English fallback.
  { val: 'piano',         lbl: 'Piano',               i18n: 'surface.piano',         cat: 'keys',       score: 28 },
  { val: 'chordpads',     lbl: 'Chord Pads',           i18n: 'surface.chordpads',     cat: 'pads',       score: 27 },
  { val: 'guitar',        lbl: 'Guitar',               i18n: 'surface.guitar',        cat: 'strings',    score: 26 },
  { val: 'bass',          lbl: 'Bass',                 i18n: 'surface.bass',          cat: 'strings',    score: 25 },
  { val: 'hurdygurdy',    lbl: 'Hurdy-Gurdy',          i18n: 'surface.hurdygurdy',    cat: 'strings',    score: 24 },
  { val: 'harp',          lbl: 'Harp',                 i18n: 'surface.harp',          cat: 'strings',    score: 23 },
  { val: 'loom',          lbl: 'Glow Keys',            i18n: 'surface.loom',          cat: 'keys',       score: 22 },
  { val: 'hex',           lbl: 'Hex Grid',             i18n: 'surface.hex',           cat: 'grids',      score: 21 },
  { val: 'grid',          lbl: 'Isomorphic',           i18n: 'surface.grid',          cat: 'grids',      score: 20 },
  { val: 'marimba',       lbl: 'Marimba',              i18n: 'surface.marimba',       cat: 'keys',       score: 19 },
  { val: 'bowed',         lbl: 'Multistring',          i18n: 'surface.bowed',         cat: 'strings',    score: 18 },
  { val: 'mpe',           lbl: 'Pitch Ribbon',         i18n: 'surface.mpe',           cat: 'continuous', score: 17 },
  { val: 'pads',          lbl: 'Drum Pads',            i18n: 'surface.pads',          cat: 'pads',       score: 16 },
  { val: 'didgeridoo',    lbl: 'Didgeridoo',           i18n: 'surface.didgeridoo',    cat: 'wind',       score: 15 },
  { val: 'vowelpad',      lbl: 'Vowel Pad',            i18n: 'surface.vowelpad',      cat: 'continuous', score: 14 },
  { val: 'breathpadens',  lbl: 'Breath Pad Ensemble',  i18n: 'surface.breathpadens',  cat: 'continuous', score: 13 },
  { val: 'tabla',         lbl: 'Tabla',                i18n: 'surface.tabla',         cat: 'pads',       score: 12 },
  { val: 'breathpad',     lbl: 'Breath Pad',           i18n: 'surface.breathpad',     cat: 'continuous', score: 11 },
  { val: 'xypad',         lbl: 'XY Pad',               i18n: 'surface.xypad',         cat: 'continuous', score: 10 },
  { val: 'ribbon',        lbl: 'Ribbon',               i18n: 'surface.ribbon',        cat: 'continuous', score: 9 },
  { val: 'steelpan',      lbl: 'Steel Pan',            i18n: 'surface.steelpan',      cat: 'pads',       score: 8 },
  { val: 'handpan',       lbl: 'Handpan',              i18n: 'surface.handpan',       cat: 'pads',       score: 7 },
  { val: 'tanpura',       lbl: 'Tanpura',              i18n: 'surface.tanpura',       cat: 'strings',    score: 6 },
  { val: 'accordion',     lbl: 'Accordion',            i18n: 'surface.accordion',     cat: 'wind',       score: 5 },
  { val: 'kaoss',         lbl: 'Gesture Trail',        i18n: 'surface.kaoss',         cat: 'continuous', score: 4 },
  { val: 'breathfinger',  lbl: 'Wind',                 i18n: 'surface.breathfinger',  cat: 'wind',       score: 3 },
  { val: 'theremin',      lbl: 'Air Synth',            i18n: 'surface.theremin',      cat: 'continuous', score: 2 },
  { val: 'shrutibox',     lbl: 'Shruti Box',           i18n: 'surface.shrutibox',     cat: 'wind',       score: 1 }
];

/**
 * Canonical surface order for 'All' category — grouped by musical family.
 * Each val must match a SURFACE_DEFS entry.
 */
SynthLab.ALL_SURFACE_ORDER = [
  'piano', 'chordpads', 'guitar', 'bass', 'hurdygurdy', 'harp',
  'loom', 'hex', 'grid', 'marimba', 'bowed', 'mpe',
  'pads', 'didgeridoo', 'vowelpad', 'breathpadens', 'tabla',
  'breathpad', 'xypad', 'ribbon', 'steelpan', 'handpan',
  'tanpura', 'accordion', 'kaoss', 'breathfinger', 'theremin',
  'shrutibox'
];

/**
 * Default engine + preset for each control surface.
 * Used by the "Best Fit" button to load the ideal sound for the current surface.
 * Key = surface val, value = { engine: 'EngineName', preset: 'Preset Name' }
 */
SynthLab.SURFACE_DEFAULT_PRESETS = {
  'piano':         { engine: 'Subtractive', preset: 'Electric Piano (Rhodes)', fx: 'stage-keys',      octave: 3 },
  'chordpads':     { engine: 'Chord',       preset: 'Pop Major',              fx: 'big-pad',          octave: 3 },
  'guitar':        { engine: 'Physical',    preset: 'Nylon Guitar',           fx: 'gentle-warmth',    octave: 3 },
  'bass':          { engine: 'Physical',    preset: 'Bass Guitar',            fx: 'thick-bass',       octave: 1 },
  'pads':          { engine: 'DrumSyn',     preset: '808 Kick',               fx: 'dry',              octave: 3 },
  'loom':          { engine: 'Subtractive', preset: 'Saw Lead',               fx: 'lead-solo',        octave: 3 },
  'harp':          { engine: 'Physical',    preset: 'Concert Harp',           fx: 'cathedral',        octave: 3 },
  'marimba':       { engine: 'Modal',       preset: 'Marimba',                fx: 'gentle-warmth',    octave: 3 },
  'grid':          { engine: 'FM',          preset: 'DX Rhodes',              fx: '70s-epiano',       octave: 3 },
  'hex':           { engine: 'Subtractive', preset: 'Warm Pad',               fx: 'cathedral',        octave: 3 },
  'ribbon':        { engine: 'Subtractive', preset: 'Saw Lead',               fx: 'gentle-warmth',    octave: 3 },
  'xypad':         { engine: 'Granular',    preset: 'Frozen Pad',             fx: 'ethereal-pad',     octave: 3 },
  'breathpad':     { engine: 'Reed',        preset: 'Alto Saxophone',         fx: 'studio-polish',    octave: 3 },
  'breathpadens':  { engine: 'Reed',        preset: 'Soprano Saxophone',      fx: '70s-epiano',       octave: 3 },
  'theremin':      { engine: 'Subtractive', preset: 'Portamento Lead',        fx: 'underwater',       octave: 3 },
  'vowelpad':      { engine: 'Formant',     preset: 'Vowel Pad',             fx: 'ethereal-pad',     octave: 3 },
  'shrutibox':     { engine: 'Additive',    preset: 'Full Organ',             fx: 'warm-tape',        octave: 3 },
  'tanpura':       { engine: 'Physical',    preset: 'Sitar',                  fx: 'misty',            octave: 2 },
  'tabla':         { engine: 'Modal',       preset: 'Tabla',                  fx: 'dry',              octave: 3 },
  'breathfinger':  { engine: 'Reed',        preset: 'Bb Clarinet',            fx: 'vinyl',            octave: 3 },
  'hurdygurdy':    { engine: 'Physical',    preset: 'Hurdy Gurdy',            fx: 'cassette-deck',    octave: 3 },
  'didgeridoo':    { engine: 'Physical',    preset: 'Didgeridoo',             fx: 'warm-tape',        octave: 1 },
  'steelpan':      { engine: 'Physical',    preset: 'Steel Drum',             fx: 'retro-synth',      octave: 3 },
  'accordion':     { engine: 'Reed',        preset: 'Bb Clarinet',            fx: '70s-epiano',       octave: 3 },
  'handpan':       { engine: 'Physical',    preset: 'Hang Drum',              fx: 'tremolo-pulse',    octave: 3 },
  'kaoss':         { engine: 'Granular',    preset: 'Cloud Drift',            fx: 'gentle-warmth',    octave: 3 },
  'bowed':         { engine: 'Physical',    preset: 'Cello',                  fx: 'choppy-delay',     octave: 3 },
  'mpe':           { engine: 'Subtractive', preset: 'Portamento Lead',        fx: 'glitch',           octave: 3 }
};

/** Voicing modes for chord expansion on play screen */
SynthLab.VOICING_MODES = [
  { val: 'single',  lbl: 'Single',  i18n: 'voicing.single' },
  { val: 'power',   lbl: 'Power',   i18n: 'voicing.power' },
  { val: 'triad',   lbl: 'Triad',   i18n: 'voicing.triad' },
  { val: 'seventh', lbl: '7th',     i18n: 'voicing.seventh' },
  { val: 'octave',  lbl: 'Octave',  i18n: 'voicing.octave' }
];

/** Surfaces that should NOT show the voicing dropdown (own chord system, percussion, drones) */
SynthLab.NO_VOICING_SURFACES = [
  'chordpads', 'breathpadens', 'pads', 'tabla', 'didgeridoo', 'tanpura', 'breathfinger'
];

/** Controller modules registered by ssli-ctrl-*.js files */
SynthLab.controllers = {};

// =============================================================================
// Filter Defaults
// =============================================================================

/** Default filter settings */
SynthLab.FILTER_DEFAULTS = {
    enabled: true,
    type: 'lowpass',    // lowpass | highpass | bandpass
    slope: 24,          // 12 | 24 (dB/octave)
    frequency: 10000,   // Hz (20 - 20000)
    resonance: 1,       // Q factor (0.1 - 25)
    model: 'butterworth'
};

/** Note names for frequency display (same as NOTES, aliased for clarity) */
SynthLab.NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// =============================================================================
// Filter Envelope Defaults
// =============================================================================

/** Default filter envelope settings */
SynthLab.FILTER_ENV_DEFAULTS = {
    enabled: false,       // Filter envelope off by default
    amount: 24,           // Semitones (-48 to +48, ±4 octaves) - positive = sweep up
    attack: 10,           // ms (0-2000)
    decay: 150,           // ms (0-2000)
    sustain: 0,           // percent (0-100) - 0 = full decay to base
    release: 200,         // ms (0-3000)
    linkToAmp: false      // Use amplitude ADSR values instead
};

// =============================================================================
// Shared Filter / ADSR Constants
// =============================================================================

/** Minimum filter cutoff frequency in Hz */
SynthLab.FILTER_CUTOFF_MIN = 20;

/** Maximum filter cutoff frequency in Hz */
SynthLab.FILTER_CUTOFF_MAX = 20000;

/** Minimum filter resonance (Q) */
SynthLab.FILTER_RESO_MIN = 0;

/** Maximum filter resonance (Q) */
SynthLab.FILTER_RESO_MAX = 30;

/** Threshold in Hz above which to display as kHz */
SynthLab.HZ_TO_KHZ_THRESHOLD = 1000;

/** Default amplitude ADSR values (ms, except sustain is 0-100 percent) */
SynthLab.DEFAULT_ADSR = { a: 10, d: 200, s: 70, r: 200 };

// =============================================================================
// Engine Icons (V-10: visual identification aids for non-English users)
// =============================================================================

SynthLab.ENGINE_ICONS = {
  'Subtractive': '\uD83C\uDFB9',
  'FM': '\uD83D\uDCFB',
  'Physical': '\uD83C\uDFB8',
  'Additive': '\uD83C\uDF1F',
  'Granular': '\u2728',
  'Vocoder': '\uD83C\uDFA4',
  'Wavefolder': '\u3030',
  'Formant': '\uD83D\uDDE3',
  'Modal': '\uD83D\uDD14',
  'RingMod': '\u2B55',
  'Chord': '\uD83C\uDFB6',
  'SuperWave': '\uD83C\uDF0A',
  'Wavetable': '\uD83D\uDCC8',
  'PhaseDist': '\uD83D\uDD25',
  'Chip': '\uD83D\uDC7E',
  'Bytebeat': '\uD83E\uDD16',
  'Vector': '\u25C6',
  'DrumSyn': '\uD83E\uDD41',
  'Pulsar': '\u2604',
  'Reed': '\uD83C\uDF43',
  'BodyResonance': '\uD83C\uDFBB'
};

// =============================================================================
// Touch Velocity Settings (in-memory primary, localStorage best-effort backup)
// =============================================================================

SynthLab._touchSettings = {
    enabled: false,
    sensitivity: 25,
    velMin: 20,
    velMax: 127
};

try {
    var stored = localStorage.getItem('ssli-touch-velocity');
    if (stored === 'on') { SynthLab._touchSettings.enabled = true; }
    var storedSens = localStorage.getItem('ssli-touch-sensitivity');
    if (storedSens !== NO_STORED_VALUE) { SynthLab._touchSettings.sensitivity = parseInt(storedSens, 10) || 25; }
    var storedMin = localStorage.getItem('ssli-touch-vel-min');
    if (storedMin !== NO_STORED_VALUE) { SynthLab._touchSettings.velMin = parseInt(storedMin, 10) || 20; }
    var storedMax = localStorage.getItem('ssli-touch-vel-max');
    if (storedMax !== NO_STORED_VALUE) { SynthLab._touchSettings.velMax = parseInt(storedMax, 10) || 127; }
} catch (e) { /* localStorage may be unavailable in restricted contexts */ }

// =============================================================================
// Export to global namespace
// =============================================================================

window.SynthLab = SynthLab;
