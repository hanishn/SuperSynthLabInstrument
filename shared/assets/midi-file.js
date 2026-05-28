(function() {
    'use strict';

    var PPQN = 96;
    var TICKS_PER_STEP = 24; // 16th notes: 96/4

    // Write variable-length quantity (VLQ)
    var writeVLQ = function(value) {
        var bytes = [];
        bytes.push(value & 0x7F);
        value >>= 7;
        while (value > 0) {
            bytes.push((value & 0x7F) | 0x80);
            value >>= 7;
        }
        bytes.reverse();
        return bytes;
    };

    // Write 16-bit big-endian
    var writeUint16 = function(value) { return [(value >> 8) & 0xFF, value & 0xFF]; };

    // Write 32-bit big-endian
    var writeUint32 = function(value) { return [(value >> 24) & 0xFF, (value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF]; };

    // Convert string to byte array
    var strToBytes = function(str) { return Array.from(str).map(function(c) { return c.charCodeAt(0); }); };

    // Build the bytes array for a track-name meta event (avoids .concat() in loop)
    var _makeTrackNameBytes = function(nameBytes) {
        return [0xFF, 0x03, nameBytes.length].concat(nameBytes);
    };

    // Build MTrk chunk from event array
    var buildTrack = function(events) {
        var trackData = [];
        for (var i = 0; i < events.length; i++) {
            Array.prototype.push.apply(trackData, writeVLQ(events[i].deltaTicks));
            Array.prototype.push.apply(trackData, events[i].bytes);
        }
        // End of track
        Array.prototype.push.apply(trackData, writeVLQ(0));
        trackData.push(0xFF, 0x2F, 0x00);

        var chunk = [];
        Array.prototype.push.apply(chunk, strToBytes('MTrk'));
        Array.prototype.push.apply(chunk, writeUint32(trackData.length));
        Array.prototype.push.apply(chunk, trackData);
        return chunk;
    };

    var DEFAULT_VEL = 100;
    var NOTE_ON_STATUS = 0x90;
    var NOTE_OFF_STATUS = 0x80;
    var NOTE_OFF_VEL = 0x00;

    function _addNoteEvents(rawEvents, n, channel, baseMidi) {
        var isChord = n.isChord && n.notes;
        if (isChord) {
            for (var ci = 0; ci < n.notes.length; ci++) {
                var midi = n.notes[ci];
                var vel = n.vel || DEFAULT_VEL;
                var startTick = n.start * TICKS_PER_STEP;
                var endTick = startTick + n.dur * TICKS_PER_STEP;
                rawEvents.push({ tick: startTick, type: 'on', midi: midi, vel: vel, channel: channel });
                rawEvents.push({ tick: endTick, type: 'off', midi: midi, channel: channel });
            }
        } else {
            var midi = n.midi || (baseMidi + (n.row || 0));
            var vel = n.vel || DEFAULT_VEL;
            var startTick = n.start * TICKS_PER_STEP;
            var endTick = startTick + n.dur * TICKS_PER_STEP;
            rawEvents.push({ tick: startTick, type: 'on', midi: midi, vel: vel, channel: channel });
            rawEvents.push({ tick: endTick, type: 'off', midi: midi, channel: channel });
        }
    }

    function _convertRawEventsToTrackEvents(rawEvents, trackEvents, lastTick) {
        for (var ei = 0; ei < rawEvents.length; ei++) {
            var ev = rawEvents[ei];
            var delta = ev.tick - lastTick;
            lastTick = ev.tick;
            var isNoteOn = (ev.type === 'on');
            if (isNoteOn) {
                trackEvents.push({ deltaTicks: delta, bytes: [NOTE_ON_STATUS | ev.channel, ev.midi, ev.vel] });
            } else {
                trackEvents.push({ deltaTicks: delta, bytes: [NOTE_OFF_STATUS | ev.channel, ev.midi, NOTE_OFF_VEL] });
            }
        }
        return lastTick;
    }

    // Main export function
    var exportMidi = function() {
        var seqNotes = SL.sequencer.seqNotes;
        var seqBpmEl = document.getElementById('seqBpm');
        var bpmStr = '120';
        if (seqBpmEl) {
            bpmStr = seqBpmEl.value;
        }
        var bpm = parseInt(bpmStr) || 120;
        var baseMidi = SL.SEQ_BASE_MIDI || 24;

        // Separate notes by instrument (0-4, including Loop)
        var instNotes = [[], [], [], [], []];
        for (var i = 0; i < seqNotes.length; i++) {
            var n = seqNotes[i];
            var inst = n.instrument || 0;
            if (inst >= 0 && inst < 5) {
                instNotes[inst].push(n);
            }
        }

        // Build header: SMF Type 1
        var numTracks = 1; // tempo track
        for (var i = 0; i < 5; i++) {
            if (instNotes[i].length > 0) numTracks++;
        }

        var header = [];
        Array.prototype.push.apply(header, strToBytes('MThd'));
        Array.prototype.push.apply(header, writeUint32(6));
        Array.prototype.push.apply(header, writeUint16(1)); // format type 1
        Array.prototype.push.apply(header, writeUint16(numTracks));
        Array.prototype.push.apply(header, writeUint16(PPQN));

        // Tempo track (track 0)
        var tempoTrack = [];
        var safeBpm = bpm || 1;
        var usPerQuarter = Math.round(60000000 / safeBpm);
        tempoTrack.push({
            deltaTicks: 0,
            bytes: [0xFF, 0x51, 0x03, (usPerQuarter >> 16) & 0xFF, (usPerQuarter >> 8) & 0xFF, usPerQuarter & 0xFF]
        });
        // Time signature: 4/4
        tempoTrack.push({
            deltaTicks: 0,
            bytes: [0xFF, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08]
        });
        // Track name
        var nameBytes = strToBytes('SuperSynthLab Export');
        tempoTrack.push({
            deltaTicks: 0,
            bytes: [0xFF, 0x03, nameBytes.length].concat(nameBytes)
        });

        var fileBytes = header.concat(buildTrack(tempoTrack));

        // Instrument track names matching SuperSynthLab slot order (hoisted outside loop)
        var instTrackNames = ['Bass', 'Lead', 'Pad', 'Sampler', 'Loop'];

        // Hoisted loop accumulator arrays (reset each iteration)
        var rawEvents = [];
        var trackEvents = [];

        // Instrument tracks
        for (var inst = 0; inst < 5; inst++) {
            if (instNotes[inst].length === 0) continue;

            var notes = instNotes[inst];
            var channel = inst;

            // Build note-on/note-off event list
            rawEvents.length = 0;

            for (var ni = 0; ni < notes.length; ni++) {
                _addNoteEvents(rawEvents, notes[ni], channel, baseMidi);
            }

            // Sort by tick, then note-off before note-on at same tick
            // Type order: 'off' = 0 (first), 'on' = 1 (second)
            var EVENT_TYPE_ORDER = { 'off': 0, 'on': 1 };
            rawEvents.sort(function(a, b) {
                if (a.tick !== b.tick) { return a.tick - b.tick; }
                var orderA = EVENT_TYPE_ORDER[a.type] || 0;
                var orderB = EVENT_TYPE_ORDER[b.type] || 0;
                return orderA - orderB;
            });

            // Convert to delta-time events
            trackEvents.length = 0;
            var trkName = strToBytes(instTrackNames[inst] || ('Instrument ' + (inst + 1)));
            trackEvents.push({ deltaTicks: 0, bytes: _makeTrackNameBytes(trkName) });

            var lastTick = 0;
            lastTick = _convertRawEventsToTrackEvents(rawEvents, trackEvents, lastTick);

            Array.prototype.push.apply(fileBytes, buildTrack(trackEvents));
        }

        // Encode as base64
        var uint8 = new Uint8Array(fileBytes);
        var binary = '';
        for (var bi = 0; bi < uint8.length; bi++) {
            binary += String.fromCharCode(uint8[bi]);
        }
        var b64 = btoa(binary);

        // Use host postMessage clipboard API (sandbox blocks downloads)
        var reqId = 'midi-export-' + Date.now();
        var isClipboardDone = false;

        var onResponse = function(ev) {
            var d = ev.data;
            var isInvalidClipboardResponse = !d || d.type !== 'exhibit:clipboardResponse' || d.requestId !== reqId;
            if (isInvalidClipboardResponse) { return; }
            window.removeEventListener('message', onResponse);
            isClipboardDone = true;
            if (d.success) {
                showExportToast('MIDI copied to clipboard (' + seqNotes.length + ' notes, ' + bpm + ' BPM). Run save_midi.py to save.');
            } else {
                showExportToast('Clipboard write failed: ' + (d.error || 'unknown'));
            }
        };
        window.addEventListener('message', onResponse);

        window.parent.postMessage({
            type: 'exhibit:clipboardRequest',
            requestId: reqId,
            action: 'writeText',
            payload: { text: b64 }
        }, '*');

        // Fallback timeout — if no response in 500ms, clipboard API not available
        setTimeout(function() {
            if (isClipboardDone) return;
            window.removeEventListener('message', onResponse);
            // Fallback: try direct download (works in standalone HTML mode)
            var dataUri = 'data:audio/midi;base64,' + b64;
            var a = document.createElement('a');
            a.href = dataUri;
            a.download = 'supersynthlab-export.mid';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }, 500);
    };

    // Toast notification for export feedback
    var showExportToast = function(msg) {
        var existing = document.getElementById('midiExportToast');
        if (existing) existing.remove();
        var toast = document.createElement('div');
        toast.id = 'midiExportToast';
        toast.textContent = msg;
        toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);' +
            'background:#1a1a2e;color:#0f0;border:1px solid #0f0;padding:10px 20px;' +
            'border-radius:6px;font-size:13px;z-index:99999;pointer-events:none;' +
            'font-family:monospace;opacity:0;transition:opacity 0.3s;';
        document.body.appendChild(toast);
        requestAnimationFrame(function() { toast.style.opacity = '1'; });
        setTimeout(function() {
            toast.style.opacity = '0';
            setTimeout(function() { toast.remove(); }, 400);
        }, 4000);
    };

    // Expose on SL namespace
    if (!window.SL) window.SL = {};
    if (!SL.midiFile) SL.midiFile = {};
    SL.midiFile.exportMidi = exportMidi;
})();
