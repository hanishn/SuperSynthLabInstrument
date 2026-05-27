// SuperSynthLab - Tuning System Module
// Provides alternate tuning systems beyond standard 12-TET
// v12.1.150 - Added Adaptive (Hermode-style) tuning
//
// ── Educational Background ──────────────────────────────────────
// The question "how should we tune musical intervals?" has occupied
// musicians and mathematicians for over 2,500 years. There is no
// perfect answer — only trade-offs.
//
// 12-TET (12-Tone Equal Temperament) divides the octave into 12
// equal semitones, each with frequency ratio 2^(1/12) ~ 1.05946.
// No interval is perfectly pure, but every key sounds equally
// in-tune (or equally out-of-tune). Formula: f = f_ref * 2^(n/12).
//
// Just Intonation uses simple integer ratios (3:2 for a perfect
// fifth, 5:4 for a major third). These intervals are beatless and
// pure, but only in one key — modulate and the wolves howl.
//
// Pythagorean tuning stacks pure 3:2 fifths. The fifths are
// perfect, but the major third (81:64) is painfully wide.
//
// Cents: 1200 cents = 1 octave. cents = 1200 * log2(f2/f1).
// A useful unit for expressing small pitch differences that are
// independent of absolute frequency.
//
// A4 = 440 Hz is the modern standard (ISO 16, 1975). Historically:
// Baroque A ~ 415 Hz, Classical-era A ~ 430 Hz.
//
// References:
//   Barbour, J.M. (1951) Tuning and Temperament, Michigan State
//     College Press — definitive historical survey.
//   Helmholtz, H. (1863) On the Sensations of Tone — foundational
//     psychoacoustics of consonance and beating.
//   Partch, H. (1949) Genesis of a Music, U. of Wisconsin Press
//     — explores 43-tone just intonation and beyond.
// ─────────────────────────────────────────────────────────────────
(function() {
  var SL = window.SynthLab;

  // ============================================================
  // Tuning System Definitions
  // Each system stores cent offsets from 12-TET for all 12 pitch classes.
  // Index 0 = C, 1 = C#/Db, 2 = D, ... 11 = B
  // Values are in cents; 0 = identical to 12-TET.
  //
  // Why cent offsets rather than frequency ratios? Because the
  // offset approach lets us start from the standard 12-TET
  // frequency (which the rest of the engine already computes)
  // and apply a small correction: f_tuned = f_12tet * 2^(cents/1200).
  // This is numerically stable and trivially composable.
  // ============================================================

  var SYSTEMS = {
    // 12-TET: the modern default. Every semitone is exactly 100
    // cents. All keys are equally usable — the "compromise of
    // compromises" that enabled Romantic-era modulation.
    'equal': {
      name: '12-TET',
      offsets: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    },
    'pythagorean': {
      name: 'Pythagorean',
      // Pythagorean tuning: every fifth is a pure 3:2 (701.96
      // cents vs 12-TET's 700). Stack twelve such fifths and you
      // overshoot the octave by ~23.46 cents (the "Pythagorean
      // comma"). That error lands on one interval — the "wolf
      // fifth" — making some keys unusable.
      // Pythagorean tuning built from pure 3:2 fifths
      // C=0, C#=-10.06, D=+3.91, Eb=-5.87, E=+7.82, F=-1.96,
      // F#=+11.73, G=+1.96, Ab=-7.82, A=+5.87, Bb=-3.91, B=+9.78
      offsets: [0, -10.06, 3.91, -5.87, 7.82, -1.96, 11.73, 1.96, -7.82, 5.87, -3.91, 9.78]
    },
    'just': {
      name: 'Just Intonation',
      // 5-limit just intonation: intervals use ratios whose prime
      // factors are only 2, 3, and 5. The major third (5:4) is
      // 386.31 cents — 13.69 cents flatter than 12-TET's 400.
      // Beautiful in C major; increasingly sour as you modulate.
      // 5-limit just intonation relative to C
      // C=1/1, C#=16/15, D=9/8, Eb=6/5, E=5/4, F=4/3,
      // F#=45/32, G=3/2, Ab=8/5, A=5/3, Bb=9/5, B=15/8
      offsets: [0, 11.73, 3.91, 15.64, -13.69, -1.96, -9.78, 1.96, 13.69, -15.64, 17.60, -11.73]
    },
    'meantone': {
      name: 'Meantone',
      // Quarter-comma meantone: a Renaissance-era compromise that
      // narrows each fifth by 1/4 of the syntonic comma (5.38 cents)
      // so that major thirds come out pure (5:4). The trade-off is
      // that remote keys (like F# major) sound terrible. This was
      // THE keyboard tuning from roughly 1500 to 1750.
      // Quarter-comma meantone
      // Fifths narrowed by 1/4 syntonic comma (5.38 cents)
      offsets: [0, -24.04, -6.84, 10.26, -6.84, 3.42, -20.52, -3.42, -27.37, -10.26, 6.84, -10.26]
    },
    // Adaptive tuning shifts pitches in real time based on which
    // notes are currently sounding, aiming for just-intonation
    // purity without being locked to a single key. Inspired by
    // Hermode Tuning (developed by Werner Mohrlok, 1990s).
    'adaptive': {
      name: 'Adaptive',
      // Dynamic — offsets computed at runtime based on sounding notes
      offsets: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    },
    // Custom tuning: the user sets cent offsets per pitch class
    // via sliders. This enables exploration of microtonal scales
    // like 19-EDO or 31-EDO (Equal Divisions of the Octave),
    // or any arbitrary temperament.
    'custom': {
      name: 'Custom',
      // User-editable cent offsets per pitch class
      offsets: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    }
  };

  var _currentSystem = 'equal';

  // ============================================================
  // Adaptive Tuning Engine (Hermode-style)
  // Tracks currently sounding notes and calculates optimal cent
  // offsets to minimize beating for common just intervals.
  //
  // How it works: when two notes sound simultaneously, their
  // frequency ratio determines consonance. A 12-TET major third
  // (400 cents) beats audibly against a pure 5:4 (386 cents).
  // The adaptive engine nudges each sounding note toward the
  // nearest just ratio with its neighbors, using a weighted
  // average when a note participates in multiple intervals.
  // The result: chords ring pure without locking to a single key.
  // ============================================================

  // Ideal cent offsets from 12-TET for just intervals, keyed by semitone distance.
  // These corrections represent the difference between 12-TET and
  // just intonation for each interval class.
  // Positive = sharpen the upper note; negative = flatten the upper note.
  var INTERVAL_CORRECTIONS = {
    // Each value is how many cents the upper note must shift from
    // 12-TET to achieve the pure just ratio for that interval.
    3:  16,    // minor third: 6:5 ratio — 12-TET is 16 cents flat
    4:  -14,   // major third: 5:4 ratio — 12-TET is 14 cents sharp
    7:  2,     // perfect fifth: 3:2 ratio — 12-TET is 2 cents flat
    8:  -14,   // minor sixth (inversion of maj 3rd) — same 14-cent error
    9:  16,    // major sixth (inversion of min 3rd) — same 16-cent error
    5:  -2     // perfect fourth (inversion of fifth) — same 2-cent error
  };

  // Active MIDI notes currently sounding, stored as { midiNote: refCount }
  // refCount handles overlapping noteOn from different instruments
  var _activeNotes = {};

  // Cached adaptive cent offsets per MIDI note (recomputed when notes change)
  var _adaptiveOffsets = {};

  /**
   * Add a currently sounding note to the adaptive tracker.
   * Triggers recalculation of all adaptive offsets.
   * @param {number} midi - MIDI note number
   */
  function addActiveNote(midi) {
    if (_activeNotes[midi]) {
      _activeNotes[midi] = _activeNotes[midi] + 1;
    } else {
      _activeNotes[midi] = 1;
    }
    _recalcAdaptiveOffsets();
  }

  /**
   * Remove a sounding note from the adaptive tracker.
   * Triggers recalculation of all adaptive offsets.
   * @param {number} midi - MIDI note number
   */
  function removeActiveNote(midi) {
    if (_activeNotes[midi]) {
      _activeNotes[midi] = _activeNotes[midi] - 1;
      if (_activeNotes[midi] <= 0) {
        delete _activeNotes[midi];
      }
    }
    _recalcAdaptiveOffsets();
  }

  /**
   * Get the adaptive cent offset for a specific MIDI note.
   * Returns 0 if no context notes are sounding or if adaptive is not active.
   * @param {number} midi - MIDI note number
   * @returns {number} Cent offset from 12-TET
   */
  function getAdaptiveCentOffset(midi) {
    if (_adaptiveOffsets[midi] !== undefined) {
      return _adaptiveOffsets[midi];
    }
    return 0;
  }

  /**
   * Recalculate adaptive offsets for all currently active notes.
   * For each active note, examines intervals formed with every other
   * active note and computes a weighted average correction.
   */
  function _recalcAdaptiveOffsets() {
    var notes = Object.keys(_activeNotes);
    var newOffsets = {};

    // With 0 or 1 notes, no intervals exist — all offsets are 0
    if (notes.length <= 1) {
      _adaptiveOffsets = newOffsets;
    } else {

    // Convert keys to numbers
    var midiNotes = [];
    for (var i = 0; i < notes.length; i++) {
      midiNotes.push(parseInt(notes[i], 10));
    }

    // For each note, accumulate corrections from intervals with all other notes
    for (var n = 0; n < midiNotes.length; n++) {
      var note = midiNotes[n];
      var totalCorrection = 0;
      var totalWeight = 0;

      for (var m = 0; m < midiNotes.length; m++) {
        if (m === n) {
          continue;
        }
        var other = midiNotes[m];
        // Interval in semitones (always positive, mod 12)
        var rawInterval = ((note - other) % 12 + 12) % 12;

        if (INTERVAL_CORRECTIONS[rawInterval] !== undefined) {
          // The correction value assumes the UPPER note gets the offset.
          // If this note is above the other, apply correction directly.
          // If this note is below, apply the inverse correction.
          var correction = INTERVAL_CORRECTIONS[rawInterval];
          var isAbove = (note > other) || (note === other);
          var weight = _activeNotes[other] || 1;

          if (isAbove) {
            totalCorrection = totalCorrection + (correction * weight);
          } else {
            // This note is the lower note in the pair; the correction
            // for the interval is defined for the upper note, so the
            // lower note gets the negation to maintain the pure ratio.
            totalCorrection = totalCorrection + (-correction * weight);
          }
          totalWeight = totalWeight + weight;
        }
      }

      if (totalWeight > 0) {
        // Weighted average produces the compromise offset
        newOffsets[note] = totalCorrection / totalWeight;
      } else {
        newOffsets[note] = 0;
      }
    }

    _adaptiveOffsets = newOffsets;
    } // end else (notes.length > 1)
  }

  // ============================================================
  // Core API
  // ============================================================
  // The central function is noteToFreq: given a MIDI note number,
  // compute the sounding frequency under the current tuning system.
  // The math: start with 12-TET (f = A4 * 2^((n-69)/12)), then
  // apply the system's cent offset: f_final = f_12tet * 2^(c/1200).
  // This two-step approach means switching tuning systems is just
  // a table lookup — no need to rebuild oscillator state.
  // ============================================================

  /**
   * Convert MIDI note number to frequency using the current tuning system.
   * Replaces the standard 440 * 2^((n-69)/12) calculation.
   * @param {number} midiNote - MIDI note number (0-127)
   * @param {number} [refHz] - Reference frequency for A4 (default 440)
   * @returns {number} Frequency in Hz
   */
  function noteToFreq(midiNote, refHz) {
    // Default reference: A4 = 440 Hz (ISO 16). Users can override
    // for historical pitch (e.g., 415 for Baroque, 430 for Classical).
    var a4 = refHz || 440;
    var centOffset = 0;
    if (_currentSystem === 'adaptive') {
      centOffset = getAdaptiveCentOffset(midiNote);
    } else {
      var system = SYSTEMS[_currentSystem];
      var pitchClass = ((midiNote % 12) + 12) % 12;
      centOffset = system.offsets[pitchClass];
    }
    // Step 1: standard 12-TET frequency. MIDI note 69 = A4.
    // Step 2: apply tuning offset. 2^(cents/1200) converts cents
    // to a frequency multiplier (e.g., +14 cents ~ 1.0081x).
    var baseFreq = a4 * Math.pow(2, (midiNote - 69) / 12);
    if (centOffset === 0) {
      return baseFreq;
    }
    return baseFreq * Math.pow(2, centOffset / 1200);
  }

  /**
   * Get the cent offset for a given MIDI note in the current tuning system.
   * Useful for passing to worklets that do their own frequency calculation.
   * @param {number} midiNote - MIDI note number
   * @returns {number} Cent offset from 12-TET
   */
  function getCentOffset(midiNote) {
    if (_currentSystem === 'adaptive') {
      return getAdaptiveCentOffset(midiNote);
    }
    var system = SYSTEMS[_currentSystem];
    var pitchClass = ((midiNote % 12) + 12) % 12;
    return system.offsets[pitchClass];
  }

  /**
   * Get the full table of 12 cent offsets for the current tuning system.
   * @returns {number[]} Array of 12 cent offsets
   */
  function getOffsets() {
    return SYSTEMS[_currentSystem].offsets;
  }

  /**
   * Switch to a different tuning system.
   * @param {string} id - System ID: 'equal', 'pythagorean', 'just', 'meantone', 'adaptive'
   */
  function setSystem(id) {
    if (SYSTEMS[id]) {
      _currentSystem = id;
      // Persist to localStorage
      try { localStorage.setItem('ssl_tuningSystem', id); } catch(e) { /* localStorage may be unavailable */ }
    }
  }

  /**
   * Get the current tuning system ID.
   * @returns {string}
   */
  function getSystem() {
    return _currentSystem;
  }

  /**
   * Get a list of available tuning systems.
   * @returns {Array<{id: string, name: string}>}
   */
  function getSystems() {
    var result = [];
    var keys = Object.keys(SYSTEMS);
    for (var i = 0; i < keys.length; i++) {
      var tKey = 'tuning.' + keys[i];
      var displayName = SL.t(tKey);
      result.push({ id: keys[i], name: displayName });
    }
    return result;
  }

  // ============================================================
  // Initialization — restore saved tuning
  // ============================================================

  /**
   * Set a single custom tuning offset for a pitch class.
   * @param {number} pitchClass - 0-11
   * @param {number} cents - Cent offset from 12-TET
   */
  function setCustomOffset(pitchClass, cents) {
    if (pitchClass >= 0 && pitchClass < 12) {
      SYSTEMS['custom'].offsets[pitchClass] = cents;
      try { localStorage.setItem('ssl_customTuning', JSON.stringify(SYSTEMS['custom'].offsets)); } catch(e) { /* localStorage may be unavailable */ }
    }
  }

  /**
   * Get the custom tuning offsets array.
   * @returns {number[]} 12-element array
   */
  function getCustomOffsets() {
    return SYSTEMS['custom'].offsets.slice();
  }

  function init() {
    try {
      var saved = localStorage.getItem('ssl_tuningSystem');
      if (saved && SYSTEMS[saved]) {
        _currentSystem = saved;
      }
      // Restore custom tuning offsets
      var customSaved = localStorage.getItem('ssl_customTuning');
      if (customSaved) {
        var parsed = JSON.parse(customSaved);
        if (parsed && parsed.length === 12) {
          SYSTEMS['custom'].offsets = parsed;
        }
      }
    } catch(e) { /* localStorage may be unavailable or JSON parse failed */ }

    // Build UI dropdown if container exists
    _buildUI();
  }

  // ============================================================
  // UI — Tuning dropdown next to refHz
  // ============================================================

  function _buildUI() {
    var refHzEl = document.getElementById('refHz');
    if (refHzEl) {
      // Find the parent label of refHz to insert after it
      var refHzLabel = refHzEl.parentNode;
      if (refHzLabel) {

    // Create tuning label+select
    var label = document.createElement('label');
    label.textContent = SL.t('tuning.label');

    var sel = document.createElement('select');
    sel.id = 'tuningSystem';
    var systems = getSystems();
    for (var i = 0; i < systems.length; i++) {
      var opt = document.createElement('option');
      opt.value = systems[i].id;
      opt.textContent = systems[i].name;
      if (systems[i].id === _currentSystem) {
        opt.selected = true;
      }
      sel.appendChild(opt);
    }

    // Custom tuning editor panel
    var customPanel = document.createElement('div');
    customPanel.id = 'customTuningPanel';
    customPanel.style.cssText = 'display:' + (_currentSystem === 'custom' ? 'flex' : 'none') + ';flex-wrap:wrap;gap:4px;margin-top:4px;padding:4px;background:#1a1a2e;border-radius:4px;';
    var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    var frag = document.createDocumentFragment();
    for (var ci = 0; ci < 12; ci++) {
      (function(pc) {
        var field = document.createElement('label');
        field.style.cssText = 'display:flex;flex-direction:column;align-items:center;font-size:9px;color:#8888bb;width:calc(25% - 4px);';
        var nameSpan = document.createElement('span');
        nameSpan.textContent = NOTE_NAMES[pc];
        field.appendChild(nameSpan);
        var slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '-100';
        slider.max = '100';
        slider.step = '1';
        slider.value = SYSTEMS['custom'].offsets[pc];
        slider.style.cssText = 'width:100%;height:14px;margin:1px 0;cursor:pointer;';
        slider.title = NOTE_NAMES[pc] + ' cent offset';
        var valDisplay = document.createElement('span');
        valDisplay.style.cssText = 'font-size:9px;color:#aaaadd;min-width:28px;text-align:center;';
        valDisplay.textContent = String(SYSTEMS['custom'].offsets[pc]);
        slider.addEventListener('input', function() {
          var centVal = parseFloat(slider.value) || 0;
          valDisplay.textContent = String(centVal);
          setCustomOffset(pc, centVal);
        });
        field.appendChild(slider);
        field.appendChild(valDisplay);
        frag.appendChild(field);
      })(ci);
    }
    customPanel.appendChild(frag);

    sel.addEventListener('change', function() {
      setSystem(sel.value);
      customPanel.style.display = (sel.value === 'custom') ? 'flex' : 'none';
    });

    label.appendChild(sel);

    // Insert after the refHz label
    var parent = refHzLabel.parentNode;
    if (parent) {
      if (refHzLabel.nextSibling) {
        parent.insertBefore(label, refHzLabel.nextSibling);
        parent.insertBefore(customPanel, label.nextSibling);
      } else {
        parent.appendChild(label);
        parent.appendChild(customPanel);
      }
    }
      } // end if (refHzLabel)
    } // end if (refHzEl)
  }

  // ============================================================
  // Register on SL namespace
  // ============================================================

  SL.tuning = {
    init: init,
    noteToFreq: noteToFreq,
    getCentOffset: getCentOffset,
    getOffsets: getOffsets,
    setSystem: setSystem,
    getSystem: getSystem,
    getSystems: getSystems,
    addActiveNote: addActiveNote,
    removeActiveNote: removeActiveNote,
    getAdaptiveCentOffset: getAdaptiveCentOffset,
    setCustomOffset: setCustomOffset,
    getCustomOffsets: getCustomOffsets
  };

})();
