(function() {
  'use strict';

  var SL = window.SynthLab || window.SL;

  // --- Constants ---
  var MAX_MIDI_FILE_BYTES = 5 * 1024 * 1024; // 5 MB max file size

  // --- SMF (Standard MIDI File) Parser ---

  function _makeTrackEventList() {
    return [];
  }

  var readVLQ = function(data, offset) {
    var value = 0;
    var bytesRead = 0;
    var b;
    do {
      b = data[offset + bytesRead];
      value = (value << 7) | (b & 0x7F);
      bytesRead++;
    } while (b & 0x80);
    return { value: value, bytesRead: bytesRead };
  };

  var readUint16 = function(data, offset) { return (data[offset] << 8) | data[offset + 1]; };

  var readUint32 = function(data, offset) {
    return (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
  };

  var parseMidiFile = function(arrayBuffer) {
    var data = new Uint8Array(arrayBuffer);
    var pos = 0;

    // Read header chunk
    var headerTag = String.fromCharCode(data[0], data[1], data[2], data[3]);
    if (headerTag !== 'MThd') {
      console.error('Not a MIDI file');
      return null;
    }
    pos = 4;
    var headerLen = readUint32(data, pos); pos += 4;
    var format = readUint16(data, pos); pos += 2;
    var numTracks = readUint16(data, pos); pos += 2;
    var ppqn = readUint16(data, pos); pos += 2;
    pos = 8 + headerLen; // skip any extra header bytes

    var tracks = [];

    // Parse each track
    for (var t = 0; t < numTracks && pos < data.length; t++) {
      var trackTag = String.fromCharCode(data[pos], data[pos + 1], data[pos + 2], data[pos + 3]);
      pos += 4;
      var trackLen = readUint32(data, pos);
      pos += 4;

      if (trackTag !== 'MTrk') {
        console.warn('Skipping non-MTrk chunk: ' + trackTag);
        pos += trackLen;
        continue;
      }

      var trackEnd = pos + trackLen;
      var events = _makeTrackEventList();
      var absoluteTick = 0;
      var runningStatus = 0;

      while (pos < trackEnd) {
        // Read delta time
        var vlq = readVLQ(data, pos);
        pos += vlq.bytesRead;
        absoluteTick += vlq.value;

        // Read event
        var statusByte = data[pos];

        if (statusByte === 0xFF) {
          // Meta event
          pos++;
          var metaType = data[pos]; pos++;
          var metaVlq = readVLQ(data, pos);
          pos += metaVlq.bytesRead;
          var metaLen = metaVlq.value;

          if (metaType === 0x51) {
            // Tempo change
            var usPerQuarter = (data[pos] << 16) | (data[pos + 1] << 8) | data[pos + 2];
            var safeUsPerQuarter = usPerQuarter || 1;
            var bpm = Math.round(60000000 / safeUsPerQuarter);
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
          var sysVlq = readVLQ(data, pos);
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

          var eventType = statusByte & 0xF0;
          var channel = statusByte & 0x0F;

          var isTwoByteChannelEvent = (eventType === 0xA0) || (eventType === 0xB0) || (eventType === 0xE0);
          if (eventType === 0x90) {
            // Note on
            var note = data[pos]; pos++;
            var velocity = data[pos]; pos++;
            if (velocity > 0) {
              events.push({ tick: absoluteTick, type: 'noteOn', channel, note, velocity });
            } else {
              // velocity 0 = note off
              events.push({ tick: absoluteTick, type: 'noteOff', channel, note });
            }
          } else if (eventType === 0x80) {
            // Note off
            var note = data[pos]; pos++;
            pos++; // skip velocity
            events.push({ tick: absoluteTick, type: 'noteOff', channel, note });
          } else if (isTwoByteChannelEvent) {
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

  var convertMidiToSeqNotes = function(parsed) {
    var ppqn = parsed.ppqn;
    var ticksPerStep = ppqn / 4; // 16th note = quarter / 4
    var baseMidi = SL.SEQ_BASE_MIDI || 24;
    var maxMidi = baseMidi + (SL.SEQ_ROWS || 84);

    // Find first tempo event across all tracks (default 120 BPM)
    var bpm = 120;
    for (var t = 0; t < parsed.tracks.length; t++) {
      for (var e = 0; e < parsed.tracks[t].length; e++) {
        if (parsed.tracks[t][e].type === 'tempo') {
          bpm = parsed.tracks[t][e].bpm;
          break;
        }
      }
      if (bpm !== 120) break;
    }

    // Set BPM in UI
    var bpmEl = document.getElementById('seqBpm');
    if (bpmEl) {
      bpmEl.value = bpm;
      bpmEl.dispatchEvent(new Event('input'));
    }

    // Collect note events across all tracks
    // Map MIDI channel to instrument: ch0->inst0, ch1->inst1, ch2->inst2, ch3->inst3, ch4+->inst0
    var allNoteOns = [];
    var allNoteOffs = [];

    for (var t = 0; t < parsed.tracks.length; t++) {
      var events = parsed.tracks[t];
      for (var e = 0; e < events.length; e++) {
        var ev = events[e];
        if (ev.type === 'noteOn') {
          var inst = Math.min(ev.channel, 3);
          allNoteOns.push({ tick: ev.tick, note: ev.note, velocity: ev.velocity, instrument: inst });
        } else if (ev.type === 'noteOff') {
          var inst = Math.min(ev.channel, 3);
          allNoteOffs.push({ tick: ev.tick, note: ev.note, instrument: inst });
        }
      }
    }

    // Match note-ons with note-offs
    var notes = [];
    var pendingOffs = allNoteOffs.slice();

    for (var i = 0; i < allNoteOns.length; i++) {
      var on = allNoteOns[i];

      // Find closest matching note-off (same note, same instrument, tick >= note-on tick)
      var bestOff = null;
      var bestIdx = -1;
      for (var j = 0; j < pendingOffs.length; j++) {
        var off = pendingOffs[j];
        var isSameNoteInstrument = off.note === on.note && off.instrument === on.instrument;
        var isValidNoteOff = isSameNoteInstrument && off.tick >= on.tick;
        if (isValidNoteOff) {
          if (!bestOff || off.tick < bestOff.tick) {
            bestOff = off;
            bestIdx = j;
          }
        }
      }

      var safeTicksPerStep = ticksPerStep || 1;
      var startStep = Math.round(on.tick / safeTicksPerStep);
      var durSteps;
      if (bestOff) {
        durSteps = Math.max(1, Math.round((bestOff.tick - on.tick) / safeTicksPerStep));
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
    } else {
      // Determine how many pages are needed
      var maxStep = 0;
      for (var i = 0; i < notes.length; i++) {
        var endStep = notes[i].start + notes[i].dur;
        if (endStep > maxStep) maxStep = endStep;
      }

      var stepsPerPage = SL.SEQ_STEPS || 64;
      var safeStepsPerPage = stepsPerPage || 1;
      var pagesNeeded = Math.ceil(maxStep / safeStepsPerPage);

      // Expand sequencer pages if needed
      if (SL.sequencer && SL.sequencer.addPage) {
        var indicator = document.getElementById('seqPageIndicator');
        var currentPages = 1;
        if (indicator) {
          var match = indicator.textContent.match(/\/(\d+)/);
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
      var seqNotes = SL.sequencer.seqNotes;
      seqNotes.length = 0;

      for (var i = 0; i < notes.length; i++) {
        seqNotes.push(notes[i]);
      }

      // Refresh display
      if (SL.sequencer.renderSeqNotes) SL.sequencer.renderSeqNotes();
      if (SL.sequencer.renderPageGrid) SL.sequencer.renderPageGrid();
    }

  };

  // --- Import entry point: open file picker ---

  var importMidi = function() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mid,.midi,audio/midi';

    input.addEventListener('change', function(e) {
      var file = e.target.files[0];
      if (file) {
        if (file.size > MAX_MIDI_FILE_BYTES) {
          console.error('MIDI file too large: ' + file.size + ' bytes (max ' + MAX_MIDI_FILE_BYTES + ')');
          if (SL && SL.feedback) {
            SL.feedback.show('File too large (max 5 MB)', 'warning');
          }
        } else {
          var reader = new FileReader();
          reader.onload = function(ev) {
            var parsed = parseMidiFile(ev.target.result);
            if (parsed) {
              convertMidiToSeqNotes(parsed);
            } else {
              console.error('Failed to parse MIDI file');
            }
          };
          reader.readAsArrayBuffer(file);
        }
      }
    });

    input.click();
  };

  // --- Expose on SL.midiFile namespace ---

  if (!window.SL) window.SL = {};
  if (!SL.midiFile) SL.midiFile = {};
  SL.midiFile.importMidi = importMidi;

})();
