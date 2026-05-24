(function() {
    'use strict';

    const PPQN = 96;
    const TICKS_PER_STEP = 24; // 16th notes: 96/4

    // Write variable-length quantity (VLQ)
    const writeVLQ = (value) => {
        const bytes = [];
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
    const writeUint16 = (value) => [(value >> 8) & 0xFF, value & 0xFF];

    // Write 32-bit big-endian
    const writeUint32 = (value) => [(value >> 24) & 0xFF, (value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF];

    // Convert string to byte array
    const strToBytes = (str) => Array.from(str).map(c => c.charCodeAt(0));

    // Build MTrk chunk from event array
    const buildTrack = (events) => {
        const trackData = [];
        for (let i = 0; i < events.length; i++) {
            trackData.push(...writeVLQ(events[i].deltaTicks));
            trackData.push(...events[i].bytes);
        }
        // End of track
        trackData.push(...writeVLQ(0));
        trackData.push(0xFF, 0x2F, 0x00);

        const chunk = [];
        chunk.push(...strToBytes('MTrk'));
        chunk.push(...writeUint32(trackData.length));
        chunk.push(...trackData);
        return chunk;
    };

    // Main export function
    const exportMidi = () => {
        const seqNotes = SL.sequencer.seqNotes;
        const bpm = parseInt(document.getElementById('seqBpm') ? document.getElementById('seqBpm').value : '120') || 120;
        const baseMidi = SL.SEQ_BASE_MIDI || 24;

        // Separate notes by instrument (0-4, including Loop)
        const instNotes = [[], [], [], [], []];
        for (let i = 0; i < seqNotes.length; i++) {
            const n = seqNotes[i];
            const inst = n.instrument || 0;
            if (inst >= 0 && inst < 5) {
                instNotes[inst].push(n);
            }
        }

        // Build header: SMF Type 1
        let numTracks = 1; // tempo track
        for (let i = 0; i < 5; i++) {
            if (instNotes[i].length > 0) numTracks++;
        }

        const header = [];
        header.push(...strToBytes('MThd'));
        header.push(...writeUint32(6));
        header.push(...writeUint16(1)); // format type 1
        header.push(...writeUint16(numTracks));
        header.push(...writeUint16(PPQN));

        // Tempo track (track 0)
        const tempoTrack = [];
        const usPerQuarter = Math.round(60000000 / bpm);
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
        const nameBytes = strToBytes('SuperSynthLab Export');
        tempoTrack.push({
            deltaTicks: 0,
            bytes: [0xFF, 0x03, nameBytes.length, ...nameBytes]
        });

        const fileBytes = [...header, ...buildTrack(tempoTrack)];

        // Instrument tracks
        for (let inst = 0; inst < 5; inst++) {
            if (instNotes[inst].length === 0) continue;

            const notes = instNotes[inst];
            const channel = inst;

            // Instrument track names matching SuperSynthLab slot order
            const instTrackNames = ['Bass', 'Lead', 'Pad', 'Sampler', 'Loop'];

            // Build note-on/note-off event list
            const rawEvents = [];

            for (let ni = 0; ni < notes.length; ni++) {
                const n = notes[ni];

                if (n.isChord && n.notes) {
                    // Chord: multiple note-ons at same time, multiple note-offs
                    for (let ci = 0; ci < n.notes.length; ci++) {
                        const midi = n.notes[ci];
                        const vel = n.vel || 100;
                        const startTick = n.start * TICKS_PER_STEP;
                        const endTick = startTick + n.dur * TICKS_PER_STEP;
                        rawEvents.push({ tick: startTick, type: 'on', midi: midi, vel: vel, channel: channel });
                        rawEvents.push({ tick: endTick, type: 'off', midi: midi, channel: channel });
                    }
                } else {
                    // Single note
                    const midi = n.midi || (baseMidi + (n.row || 0));
                    const vel = n.vel || 100;
                    const startTick = n.start * TICKS_PER_STEP;
                    const endTick = startTick + n.dur * TICKS_PER_STEP;
                    rawEvents.push({ tick: startTick, type: 'on', midi: midi, vel: vel, channel: channel });
                    rawEvents.push({ tick: endTick, type: 'off', midi: midi, channel: channel });
                }
            }

            // Sort by tick, then note-off before note-on at same tick
            rawEvents.sort((a, b) => {
                if (a.tick !== b.tick) return a.tick - b.tick;
                if (a.type === 'off' && b.type === 'on') return -1;
                if (a.type === 'on' && b.type === 'off') return 1;
                return 0;
            });

            // Convert to delta-time events
            const trackEvents = [];
            const trkName = strToBytes(instTrackNames[inst] || ('Instrument ' + (inst + 1)));
            trackEvents.push({ deltaTicks: 0, bytes: [0xFF, 0x03, trkName.length, ...trkName] });

            let lastTick = 0;
            for (let ei = 0; ei < rawEvents.length; ei++) {
                const ev = rawEvents[ei];
                const delta = ev.tick - lastTick;
                lastTick = ev.tick;

                if (ev.type === 'on') {
                    trackEvents.push({ deltaTicks: delta, bytes: [0x90 | ev.channel, ev.midi, ev.vel] });
                } else {
                    trackEvents.push({ deltaTicks: delta, bytes: [0x80 | ev.channel, ev.midi, 0x00] });
                }
            }

            fileBytes.push(...buildTrack(trackEvents));
        }

        // Encode as base64
        const uint8 = new Uint8Array(fileBytes);
        var binary = '';
        for (var bi = 0; bi < uint8.length; bi++) {
            binary += String.fromCharCode(uint8[bi]);
        }
        const b64 = btoa(binary);

        // Use host postMessage clipboard API (sandbox blocks downloads)
        var reqId = 'midi-export-' + Date.now();
        var clipboardDone = false;

        var onResponse = function(ev) {
            var d = ev.data;
            if (!d || d.type !== 'exhibit:clipboardResponse' || d.requestId !== reqId) return;
            window.removeEventListener('message', onResponse);
            clipboardDone = true;
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
            if (clipboardDone) return;
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
    const showExportToast = (msg) => {
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
