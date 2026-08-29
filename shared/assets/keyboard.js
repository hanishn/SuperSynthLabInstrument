// Synth Lab - Keyboard Module
(function() {
  var SL = window.SynthLab;

  // Local references to constants
  var NOTES = SL.NOTES;
  var DOT_CLASS = SL.DOT_CLASS;
  var OCT_CLASS = SL.OCT_CLASS;

  /**
   * Get the current scale notes based on root and mode selection
   * @returns {number[]} Array of pitch classes (0-11) in the current scale
   */
  function getScaleNotes() {
    var rootEl = document.getElementById('rootNote');
    var modeEl = document.getElementById('mode');
    if (rootEl) {
      if (modeEl) {
        var root = parseInt(rootEl.value);
        var m = SL.MODES[modeEl.value];
        return m.scale.map(function(s) { return (root + s) % 12; });
      }
    }
    return [];
  }

  /**
   * Update the octave range display
   */
  function updateOctRange() {
    var octRange = document.getElementById('octRange');
    var baseOct = SL.ui ? SL.ui.getBaseOctave() : 4;
    if (octRange) { octRange.textContent = 'C' + baseOct + '-C' + (baseOct + 3); }
  }

  /**
   * Convert MIDI note number to note name (e.g., 60 -> "C4")
   * @param {number} midi - MIDI note number
   * @returns {string} Note name with octave
   */
  function midiToName(midi, useFlats) {
    var pc = midi % 12;
    var oct = Math.floor(midi / 12) - 1;
    var noteArr = useFlats ? SL.NOTES_FLAT : NOTES;
    return noteArr[pc] + oct;
  }

  /**
   * Update the note readout display with the current note info
   * @param {number} midi - MIDI note number
   */
  function updateNoteReadout(midi) {
    var noteReadout = document.getElementById('noteReadout');
    if (noteReadout) {
      var name = midiToName(midi);
      var freq = SL.audio.m2f(midi).toFixed(1);
      var centStr = '';
      var hasTuningOffset = SL.tuning && SL.tuning.getCentOffset;
      var isNonEqualTuning = hasTuningOffset && SL.tuning.getCurrentSystem && SL.tuning.getCurrentSystem() !== 'equal';
      if (isNonEqualTuning) {
        var cents = SL.tuning.getCentOffset(midi);
        if (cents !== 0) {
          var sign = cents > 0 ? '+' : '';
          centStr = ' ' + sign + cents.toFixed(1) + '\u00A2';
        }
      }
      noteReadout.textContent = name + centStr + ' (' + freq + ' Hz)';
    }
    // else: SSLI uses ssliNoteReadout instead - skip gracefully
  }

  /**
   * Build the piano keyboard UI
   * Skips if current instrument is a sampler (drum pad mode)
   */
  function buildKeyboard() {
    var kbEl = document.getElementById('keyboard');
    if (!kbEl) { return; }

    var currentInst = SL.audio && SL.audio.getCurrentInstrument ? SL.audio.getCurrentInstrument() : 0;
    var instType = SL.audio && SL.audio.getInstrumentType ? SL.audio.getInstrumentType(currentInst) : 'subtractive';
    // If current instrument is sampler/percussion, show drum pads instead
    if (SL.drumPads && SL.drumPads.isDrumPadMode()) {
      // drum pad mode - no keyboard to build
    } else if (instType === 'sampler' && SL.drumPads) {
      SL.drumPads.buildDrumPads();
    } else {
    kbEl.textContent = '';

    var scaleNotes = getScaleNotes();
    var baseOct = SL.ui ? SL.ui.getBaseOctave() : 4;
    var startMidi = (baseOct + 1) * 12;
    var endMidi = (baseOct + 4) * 12;

    var frag = document.createDocumentFragment();
    for (var i = startMidi; i <= endMidi; i++) {
      var pc = i % 12;
      var oct = Math.floor(i / 12) - 1;
      var isBlack = [1, 3, 6, 8, 10].includes(pc);
      var inKey = scaleNotes.includes(pc);

      var keyColorClass = isBlack ? 'black' : 'white';
      var keyInKeyClass = inKey ? '' : ' out-key';
      var key = document.createElement('div');
      key.className = 'key ' + keyColorClass + keyInKeyClass;
      key.dataset.note = i;
      key.setAttribute('role', 'button');
      key.setAttribute('tabindex', '0');
      var ariaNoteName = NOTES[pc].replace('#', ' sharp ') + oct;
      key.setAttribute('aria-label', ariaNoteName);
      key.setAttribute('aria-pressed', 'false');

      // Create color dot for pitch class with note letter (colorblind accessibility)
      var dot = document.createElement('div');
      dot.className = 'note-dot ' + DOT_CLASS[pc];
      dot.textContent = NOTES[pc].charAt(0);
      key.appendChild(dot);

      // Create octave stripe
      var stripe = document.createElement('div');
      stripe.className = 'oct-stripe ' + (OCT_CLASS[oct] || '');
      key.appendChild(stripe);

      // Create label
      var lbl = document.createElement('span');
      lbl.textContent = NOTES[pc] + oct;
      key.appendChild(lbl);

      // Event listeners for playing notes
      key.addEventListener('mousedown', function(e) {
        e.preventDefault();
        key.setAttribute('aria-pressed', 'true');
        SL.audio.startSustainedNote(i);
      });
      key.addEventListener('mouseup', function() {
        key.setAttribute('aria-pressed', 'false');
        SL.audio.stopSustainedNote(i);
      });
      // Only stop on mouseleave if mouse button is NOT held down
      // This allows dragging to mixer modal while holding a note
      key.addEventListener('mouseleave', function(e) {
        if (e.buttons === 0) {
          key.setAttribute('aria-pressed', 'false');
          SL.audio.stopSustainedNote(i);
        }
      });

      // Touch support for mobile
      key.addEventListener('touchstart', function(e) {
        e.preventDefault();
        key.setAttribute('aria-pressed', 'true');
        SL.audio.startSustainedNote(i);
      });
      key.addEventListener('touchend', function(e) {
        e.preventDefault();
        key.setAttribute('aria-pressed', 'false');
        SL.audio.stopSustainedNote(i);
      });
      key.addEventListener('touchcancel', function() {
        key.setAttribute('aria-pressed', 'false');
        SL.audio.stopSustainedNote(i);
      });

      // Drag support for sequencer
      key.draggable = true;
      key.addEventListener('dragstart', function(e) {
        var dragData = { midi: i, name: midiToName(i) };
        e.dataTransfer.setData('text/plain', JSON.stringify(dragData));
        SL.currentDragData = dragData;  // Store globally for dragover access
      });
      key.addEventListener('dragend', function() {
        SL.currentDragData = null;  // Clear global drag data
      });

      frag.appendChild(key);
    }
    kbEl.appendChild(frag);

    updateOctRange();

    // Invalidate the MIDI-to-DOM-element cache since we just rebuilt all keys
    if (SL.audio && SL.audio.invalidateKeyCache) {
      SL.audio.invalidateKeyCache();
    }
    } // end else (build keyboard)
  }

  // Export to SynthLab namespace
  SL.keyboard = {
    buildKeyboard,
    updateOctRange,
    getScaleNotes,
    midiToName,
    updateNoteReadout
  };
})();
