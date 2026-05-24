(function() {
  'use strict';

  const SL = window.SynthLab || window.SL;

  // --- Constants ---
  const MAX_MIDI_FILE_BYTES = 5 * 1024 * 1024; // 5 MB max file size

  // --- SMF (Standard MIDI File) Parser ---

  const readVLQ = (data, offset) => {
    let value = 0;
    let bytesRead = 0;
    let b;
    do {
      b = data[offset + bytesRead];
      value = (value << 7) | (b & 0x7F);
      bytesRead++;
    } while (b & 0x80);
    return { value, bytesRead };
  };

  const readUint16 = (data, offset) => (data[offset] << 8) | data[offset + 1];

  const readUint32 = (data, offset) =>
    (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];

  const parseMidiFile = (arrayBuffer) => {
    const data = new Uint8Array(arrayBuffer);
    let pos = 0;

    // Read header chunk
    const headerTag = String.fromCharCode(data[0], data[1], data[2], data[3]);
    if (headerTag !== 'MThd') {
      console.error('Not a MIDI file');
      return null;
    }
    pos = 4;
    const headerLen = readUint32(data, pos); pos += 4;
    const format = readUint16(data, pos); pos += 2;
    const numTracks = readUint16(data, pos); pos += 2;
    const ppqn = readUint16(data, pos); pos += 2;
    pos = 8 + headerLen; // skip any extra header bytes

    const tracks = [];

    // Parse each track
    for (let t = 0; t < numTracks && pos < data.length; t++) {
      const trackTag = String.fromCharCode(data[pos], data[pos + 1], data[pos + 2], data[pos + 3]);
      pos += 4;
      const trackLen = readUint32(data, pos);
      pos += 4;

      if (trackTag !== 'MTrk') {
        console.warn('Skipping non-MTrk chunk: ' + trackTag);
        pos += trackLen;
        continue;
      }

      const trackEnd = pos + trackLen;
      const events = [];
      let absoluteTick = 0;
      let runningStatus = 0;

      while (pos < trackEnd) {
        // Read delta time
        const vlq = readVLQ(data, pos);
        pos += vlq.bytesRead;
        absoluteTick += vlq.value;

        // Read event
        let statusByte = data[pos];

        if (statusByte === 0xFF) {
          // Meta event
          pos++;
          const metaType = data[pos]; pos++;
          const metaVlq = readVLQ(data, pos);
          pos += metaVlq.bytesRead;
          const metaLen = metaVlq.value;

          if (metaType === 0x51) {
            // Tempo change
            const usPerQuarter = (data[pos] << 16) | (data[pos + 1] << 8) | data[pos + 2];
            const bpm = Math.round(60000000 / usPerQuarter);
            events.push({ tick: absoluteTick, type: 'tempo', bpm });
          } else if (metaType === 0x2F) {
            // End of track
            pos += metaLen;
            break;
          }
          pos += metaLen;
        } else if (statusByte === 0xF0 || statusByte === 0xF7) {
          // SysEx — skip
          pos++;
          const sysVlq = readVLQ(data, pos);
          pos += sysVlq.bytesRead;
          pos += sysVlq.value;
        } else {
          // Channel event
          if (statusByte & 0x80) {
            runningStatus = statusByte;
            pos++;
          } else {
            statusByte = runningStatus;
          }

          const eventType = statusByte & 0xF0;
          const channel = statusByte & 0x0F;

          if (eventType === 0x90) {
            // Note on
            const note = data[pos]; pos++;
            const velocity = data[pos]; pos++;
            if (velocity > 0) {
              events.push({ tick: absoluteTick, type: 'noteOn', channel, note, velocity });
            } else {
              // velocity 0 = note off
              events.push({ tick: absoluteTick, type: 'noteOff', channel, note });
            }
          } else if (eventType === 0x80) {
            // Note off
            const note = data[pos]; pos++;
            pos++; // skip velocity
            events.push({ tick: absoluteTick, type: 'noteOff', channel, note });
          } else if (eventType === 0xA0 || eventType === 0xB0 || eventType === 0xE0) {
            // Aftertouch, CC, Pitch bend — 2 data bytes
            pos += 2;
          } else if (eventType === 0xC0 || eventType === 0xD0) {
            // Program change, Channel pressure — 1 data byte
            pos++;
          }
        }
      }

      pos = trackEnd; // ensure correct position for next chunk
      tracks.push(events);
    }

    return { format, numTracks, ppqn, tracks };
  };

  // --- Convert parsed MIDI into sequencer notes ---

  const convertMidiToSeqNotes = (parsed) => {
    const ppqn = parsed.ppqn;
    const ticksPerStep = ppqn / 4; // 16th note = quarter / 4
    const baseMidi = SL.SEQ_BASE_MIDI || 24;
    const maxMidi = baseMidi + (SL.SEQ_ROWS || 84);

    // Find first tempo event across all tracks (default 120 BPM)
    let bpm = 120;
    for (let t = 0; t < parsed.tracks.length; t++) {
      for (let e = 0; e < parsed.tracks[t].length; e++) {
        if (parsed.tracks[t][e].type === 'tempo') {
          bpm = parsed.tracks[t][e].bpm;
          break;
        }
      }
      if (bpm !== 120) break;
    }

    // Set BPM in UI
    const bpmEl = document.getElementById('seqBpm');
    if (bpmEl) {
      bpmEl.value = bpm;
      bpmEl.dispatchEvent(new Event('input'));
    }

    // Collect note events across all tracks
    // Map MIDI channel to instrument: ch0->inst0, ch1->inst1, ch2->inst2, ch3->inst3, ch4+->inst0
    const allNoteOns = [];
    const allNoteOffs = [];

    for (let t = 0; t < parsed.tracks.length; t++) {
      const events = parsed.tracks[t];
      for (let e = 0; e < events.length; e++) {
        const ev = events[e];
        if (ev.type === 'noteOn') {
          const inst = Math.min(ev.channel, 3);
          allNoteOns.push({ tick: ev.tick, note: ev.note, velocity: ev.velocity, instrument: inst });
        } else if (ev.type === 'noteOff') {
          const inst = Math.min(ev.channel, 3);
          allNoteOffs.push({ tick: ev.tick, note: ev.note, instrument: inst });
        }
      }
    }

    // Match note-ons with note-offs
    const notes = [];
    const pendingOffs = allNoteOffs.slice();

    for (let i = 0; i < allNoteOns.length; i++) {
      const on = allNoteOns[i];

      // Find closest matching note-off (same note, same instrument, tick >= note-on tick)
      let bestOff = null;
      let bestIdx = -1;
      for (let j = 0; j < pendingOffs.length; j++) {
        const off = pendingOffs[j];
        if (off.note === on.note && off.instrument === on.instrument && off.tick >= on.tick) {
          if (!bestOff || off.tick < bestOff.tick) {
            bestOff = off;
            bestIdx = j;
          }
        }
      }

      const startStep = Math.round(on.tick / ticksPerStep);
      let durSteps;
      if (bestOff) {
        durSteps = Math.max(1, Math.round((bestOff.tick - on.tick) / ticksPerStep));
        pendingOffs.splice(bestIdx, 1);
      } else {
        durSteps = 1; // default if no note-off found
      }

      // Clamp to sequencer MIDI range
      if (on.note >= baseMidi && on.note < maxMidi) {
        notes.push({
          row: on.note - baseMidi,
          start: startStep,
          dur: durSteps,
          midi: on.note,
          vel: on.velocity,
          instrument: on.instrument
        });
      }
    }

    if (notes.length === 0) {
      console.warn('No notes found in MIDI file within sequencer range (MIDI ' + baseMidi + '-' + maxMidi + ')');
      return;
    }

    // Determine how many pages are needed
    let maxStep = 0;
    for (let i = 0; i < notes.length; i++) {
      const endStep = notes[i].start + notes[i].dur;
      if (endStep > maxStep) maxStep = endStep;
    }

    const stepsPerPage = SL.SEQ_STEPS || 64;
    const pagesNeeded = Math.ceil(maxStep / stepsPerPage);

    // Expand sequencer pages if needed
    if (SL.sequencer && SL.sequencer.addPage) {
      const indicator = document.getElementById('seqPageIndicator');
      let currentPages = 1;
      if (indicator) {
        const match = indicator.textContent.match(/\/(\d+)/);
        if (match) {
          currentPages = parseInt(match[1]);
        }
      }
      while (currentPages < pagesNeeded) {
        SL.sequencer.addPage();
        currentPages++;
      }
    }

    // Clear existing notes and load imported ones
    const seqNotes = SL.sequencer.seqNotes;
    seqNotes.length = 0;

    for (let i = 0; i < notes.length; i++) {
      seqNotes.push(notes[i]);
    }

    // Refresh display
    if (SL.sequencer.renderSeqNotes) SL.sequencer.renderSeqNotes();
    if (SL.sequencer.renderPageGrid) SL.sequencer.renderPageGrid();

  };

  // --- Import entry point: open file picker ---

  const importMidi = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mid,.midi,audio/midi';

    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) {
        return;
      }

      if (file.size > MAX_MIDI_FILE_BYTES) {
        console.error('MIDI file too large: ' + file.size + ' bytes (max ' + MAX_MIDI_FILE_BYTES + ')');
        if (SL && SL.feedback) {
          SL.feedback.show('File too large (max 5 MB)', 'warning');
        }
        return;
      }

      const reader = new FileReader();
      reader.onload = (ev) => {
        const parsed = parseMidiFile(ev.target.result);
        if (!parsed) {
          console.error('Failed to parse MIDI file');
          return;
        }
        convertMidiToSeqNotes(parsed);
      };
      reader.readAsArrayBuffer(file);
    });

    input.click();
  };

  // --- Expose on SL.midiFile namespace ---

  if (!window.SL) window.SL = {};
  if (!SL.midiFile) SL.midiFile = {};
  SL.midiFile.importMidi = importMidi;

})();
