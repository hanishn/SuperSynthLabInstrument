// Synth Lab - Keyboard Module
(function() {
  const SL = window.SynthLab;

  // Local references to constants
  const NOTES = SL.NOTES;
  const DOT_CLASS = SL.DOT_CLASS;
  const OCT_CLASS = SL.OCT_CLASS;

  /**
   * Get the current scale notes based on root and mode selection
   * @returns {number[]} Array of pitch classes (0-11) in the current scale
   */
  function getScaleNotes() {
    const rootEl = document.getElementById('rootNote');
    const modeEl = document.getElementById('mode');
    const root = parseInt(rootEl.value);
    const m = SL.MODES[modeEl.value];
    return m.scale.map(s => (root + s) % 12);
  }

  /**
   * Update the octave range display
   */
  function updateOctRange() {
    const octRange = document.getElementById('octRange');
    const baseOct = SL.ui ? SL.ui.getBaseOctave() : 4;
    octRange.textContent = 'C' + baseOct + '-C' + (baseOct + 3);
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
    if (!noteReadout) {
      // SSLI uses 'ssliNoteReadout' instead — skip gracefully
      return;
    }
    var name = midiToName(midi);
    var freq = SL.audio.m2f(midi).toFixed(1);
    var centStr = '';
    if (SL.tuning && SL.tuning.getCentOffset && SL.tuning.getCurrentSystem && SL.tuning.getCurrentSystem() !== 'equal') {
      var cents = SL.tuning.getCentOffset(midi);
      if (cents !== 0) {
        var sign = cents > 0 ? '+' : '';
        centStr = ' ' + sign + cents.toFixed(1) + '\u00A2';
      }
    }
    noteReadout.textContent = name + centStr + ' (' + freq + ' Hz)';
  }

  /**
   * Build the piano keyboard UI
   * Skips if current instrument is a sampler (drum pad mode)
   */
  function buildKeyboard() {
    // If current instrument is sampler/percussion, show drum pads instead
    if (SL.drumPads && SL.drumPads.isDrumPadMode()) {
      return;
    }
    var currentInst = SL.audio && SL.audio.getCurrentInstrument ? SL.audio.getCurrentInstrument() : 0;
    var instType = SL.audio && SL.audio.getInstrumentType ? SL.audio.getInstrumentType(currentInst) : 'subtractive';
    if (instType === 'sampler' && SL.drumPads) {
      SL.drumPads.buildDrumPads();
      return;
    }

    const kbEl = document.getElementById('keyboard');
    kbEl.innerHTML = '';

    const scaleNotes = getScaleNotes();
    const baseOct = SL.ui ? SL.ui.getBaseOctave() : 4;
    const startMidi = (baseOct + 1) * 12;
    const endMidi = (baseOct + 4) * 12;

    for (let i = startMidi; i <= endMidi; i++) {
      const pc = i % 12;
      const oct = Math.floor(i / 12) - 1;
      const isBlack = [1, 3, 6, 8, 10].includes(pc);
      const inKey = scaleNotes.includes(pc);

      const key = document.createElement('div');
      key.className = 'key ' + (isBlack ? 'black' : 'white') + (inKey ? '' : ' out-key');
      key.dataset.note = i;
      key.setAttribute('role', 'button');
      key.setAttribute('tabindex', '0');
      var ariaNoteName = NOTES[pc].replace('#', ' sharp ') + oct;
      key.setAttribute('aria-label', ariaNoteName);
      key.setAttribute('aria-pressed', 'false');

      // Create color dot for pitch class with note letter (colorblind accessibility)
      const dot = document.createElement('div');
      dot.className = 'note-dot ' + DOT_CLASS[pc];
      dot.textContent = NOTES[pc].charAt(0);
      key.appendChild(dot);

      // Create octave stripe
      const stripe = document.createElement('div');
      stripe.className = 'oct-stripe ' + (OCT_CLASS[oct] || '');
      key.appendChild(stripe);

      // Create label
      const lbl = document.createElement('span');
      lbl.textContent = NOTES[pc] + oct;
      key.appendChild(lbl);

      // Event listeners for playing notes
      key.addEventListener('mousedown', e => {
        e.preventDefault();
        key.setAttribute('aria-pressed', 'true');
        SL.audio.startSustainedNote(i);
      });
      key.addEventListener('mouseup', () => {
        key.setAttribute('aria-pressed', 'false');
        SL.audio.stopSustainedNote(i);
      });
      // Only stop on mouseleave if mouse button is NOT held down
      // This allows dragging to mixer modal while holding a note
      key.addEventListener('mouseleave', (e) => {
        if (e.buttons === 0) {
          key.setAttribute('aria-pressed', 'false');
          SL.audio.stopSustainedNote(i);
        }
      });

      // Touch support for mobile
      key.addEventListener('touchstart', (e) => {
        e.preventDefault();
        key.setAttribute('aria-pressed', 'true');
        SL.audio.startSustainedNote(i);
      });
      key.addEventListener('touchend', (e) => {
        e.preventDefault();
        key.setAttribute('aria-pressed', 'false');
        SL.audio.stopSustainedNote(i);
      });
      key.addEventListener('touchcancel', () => {
        key.setAttribute('aria-pressed', 'false');
        SL.audio.stopSustainedNote(i);
      });

      // Drag support for sequencer
      key.draggable = true;
      key.addEventListener('dragstart', e => {
        const dragData = { midi: i, name: midiToName(i) };
        e.dataTransfer.setData('text/plain', JSON.stringify(dragData));
        SL.currentDragData = dragData;  // Store globally for dragover access
      });
      key.addEventListener('dragend', () => {
        SL.currentDragData = null;  // Clear global drag data
      });

      kbEl.appendChild(key);
    }

    updateOctRange();

    // Invalidate the MIDI-to-DOM-element cache since we just rebuilt all keys
    if (SL.audio && SL.audio.invalidateKeyCache) {
      SL.audio.invalidateKeyCache();
    }
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
