// Super Synth Lab - MIDI Module
// Web MIDI API input/output with per-channel instrument routing
// Channel 1 -> Instrument 1, Channel 2 -> Instrument 2, etc.
//
// MIDI (Musical Instrument Digital Interface) is a 1983 protocol for
// communication between electronic instruments and computers. Despite
// its age, it remains the universal standard for music control.
//
// MIDI message format (MIDI 1.0 Spec, MMA 1983):
//   Status byte (0x80-0xFF): message type + channel (lower 4 bits)
//   Data bytes (0x00-0x7F): parameter values (high bit always 0)
//
// Key message types used here:
//   0x90 + ch = Note On  (data1=note 0-127, data2=velocity 0-127)
//   0x80 + ch = Note Off (data1=note, data2=release velocity)
//   0xB0 + ch = Control Change (data1=CC#, data2=value 0-127)
//   0xE0 + ch = Pitch Bend (14-bit: data1=LSB, data2=MSB, center=8192)
//   0xA0 + ch = Polyphonic Aftertouch (data1=note, data2=pressure)
//   0xD0 + ch = Channel Aftertouch (data1=pressure)
//   0xC0 + ch = Program Change (data1=program 0-127)
//
// The Web MIDI API (navigator.requestMIDIAccess) bridges browser JS to
// hardware MIDI devices via the operating system's MIDI subsystem.
//
// References:
//   MIDI Manufacturers Association (1983) MIDI 1.0 Detailed Specification
//   Roads, C. (1996) The Computer Music Tutorial, MIT Press, Ch. 14
//
(function() {
  'use strict';

  var SL = window.SynthLab;
  if (!SL || !SL.audio) {
    console.error('[midi] SynthLab.audio not available');
  } else {

  // ============================================================
  // Helpers
  // ============================================================

  function _makeSustainMap() {
    return {};
  }

  // ============================================================
  // State
  // ============================================================
  // The Web MIDI API gives us a MIDIAccess object that enumerates
  // input/output ports. We track the selected devices and maintain
  // per-channel state for active notes, sustain pedal, and expression.

  var midiAccess = null;
  var selectedInputId = null;
  var selectedOutputId = null;
  var currentInput = null;
  var currentOutput = null;
  var isMidiEnabled = false;

  // Active MIDI notes per instrument channel (0-4, 5 instruments)
  // Each is a Map: midi -> { type, oscillators, master, filterChain, releaseTime }
  var midiActiveNotes = [new Map(), new Map(), new Map(), new Map(), new Map()];

  // Sustain pedal (CC64) state per channel.
  // Traditional sustain is binary (on/off), but high-end controllers send
  // continuous values 0-127 enabling half-pedaling -- a piano technique where
  // partial pedal pressure partially damps the strings. We store the full
  // 0.0-1.0 range and scale release times proportionally.
  var _sustainPedalAmount = [0, 0, 0, 0, 0];
  // Notes held by sustain pedal per channel: Map of midi -> true
  var _sustainedNotes = [{}, {}, {}, {}, {}];
  // Base release time per channel (captured at note-on for half-pedal scaling)
  var _baseReleaseTimes = [{}, {}, {}, {}, {}];

  // Expression level per channel (0-1, default 1)
  var _expressionLevel = [1, 1, 1, 1, 1];

  // Per-instrument MIDI configuration (5 instruments)
  var midiConfig = [
    { midiIn: true, midiOut: false, channel: 0 },
    { midiIn: true, midiOut: false, channel: 1 },
    { midiIn: true, midiOut: false, channel: 2 },
    { midiIn: true, midiOut: false, channel: 3 },
    { midiIn: true, midiOut: false, channel: 4 }
  ];

  // Transpose offset (semitones, -24 to +24)
  var midiTranspose = 0;

  // Configurable pitch bend range (semitones, 1-24, default 2)
  var _pitchBendRange = 2;

  // MIDIOUT instrument settings (for instruments set to midiout type)
  var midioutSettings = [
    { channel: 0, velCurve: 'linear', program: 0 },
    { channel: 1, velCurve: 'linear', program: 0 },
    { channel: 2, velCurve: 'linear', program: 0 },
    { channel: 3, velCurve: 'linear', program: 0 },
    { channel: 4, velCurve: 'linear', program: 0 }
  ];

  var NO_STORED_VALUE = null;

  // ============================================================
  // Web MIDI Access
  // ============================================================
  // navigator.requestMIDIAccess() returns a Promise that resolves to a
  // MIDIAccess object. We request without sysex (system exclusive) to
  // avoid the more restrictive permission prompt -- sysex allows device-
  // specific bulk data transfer but is not needed for standard note/CC use.

  function init() {
    if (!navigator.requestMIDIAccess) {
      console.warn('[MIDI] Web MIDI API not available in this browser');
    } else {
      navigator.requestMIDIAccess({ sysex: false }).then(
        function(access) {
          midiAccess = access;
          isMidiEnabled = true;
          access.onstatechange = onStateChange;
          updateDeviceSelectors();
          autoSelectDevices();
        },
        function(err) {
          console.error('[MIDI] Access denied:', err);
        }
      );
    }
  }

  function onStateChange() {
    updateDeviceSelectors();
  }

  // ============================================================
  // Device Management
  // ============================================================

  function getInputDevices() {
    if (!midiAccess) return [];
    var devices = [];
    midiAccess.inputs.forEach(function(input) {
      devices.push({ id: input.id, name: input.name, manufacturer: input.manufacturer });
    });
    return devices;
  }

  function getOutputDevices() {
    if (!midiAccess) return [];
    var devices = [];
    midiAccess.outputs.forEach(function(output) {
      devices.push({ id: output.id, name: output.name, manufacturer: output.manufacturer });
    });
    return devices;
  }

  function selectInput(deviceId) {
    // Disconnect old input
    if (currentInput) {
      currentInput.onmidimessage = null;
      currentInput = null;
    }
    selectedInputId = deviceId;

    if (!deviceId || !midiAccess) return;

    var input = midiAccess.inputs.get(deviceId);
    if (input) {
      input.onmidimessage = onMIDIMessage;
      currentInput = input;
    }
  }

  function selectOutput(deviceId) {
    selectedOutputId = deviceId;
    currentOutput = null;

    if (!deviceId || !midiAccess) return;

    var output = midiAccess.outputs.get(deviceId);
    if (output) {
      currentOutput = output;
    }
  }

  function autoSelectDevices() {
    // Auto-select first available input/output
    var inputs = getInputDevices();
    var outputs = getOutputDevices();
    if (inputs.length > 0 && !selectedInputId) {
      selectInput(inputs[0].id);
    }
    if (outputs.length > 0 && !selectedOutputId) {
      selectOutput(outputs[0].id);
    }
  }

  // ============================================================
  // MIDI Message Handler
  // ============================================================
  // Every MIDI message arrives as a Uint8Array via the onmidimessage
  // callback. The status byte's upper nibble identifies the message type,
  // the lower nibble identifies the channel (0-15). A Note On with
  // velocity 0 is treated as Note Off per the MIDI spec -- many
  // controllers use this "running status" optimization.

  function onMIDIMessage(event) {
    var data = event.data;
    if (!data || data.length < 2) return;

    // Extract message type (upper nibble) and channel (lower nibble)
    var status = data[0] & 0xF0;
    var channel = data[0] & 0x0F; // 0-15
    var byte1 = data[1];
    var byte2 = data.length > 2 ? data[2] : 0;

    // Apply transpose to note messages
    var transposedByte1 = byte1;
    var isNoteMessage = status === 0x90 || status === 0x80;
    var shouldTransposeNote = isNoteMessage && midiTranspose !== 0;
    if (shouldTransposeNote) {
      transposedByte1 = Math.max(0, Math.min(127, byte1 + midiTranspose));
    }

    // Route to instruments based on their configured channel (5 instruments)
    for (var instId = 0; instId < 5; instId++) {
      var isChannelMatch = midiConfig[instId].channel === channel;
      var isInboundMidi = isChannelMatch && midiConfig[instId].midiIn;
      if (isInboundMidi) {
        var isNoteOffMessage = (status === 0x80) || ((status === 0x90) && (byte2 === 0));
        if (status === 0x90 && byte2 > 0) {
          midiNoteOn(transposedByte1, byte2, instId);
        } else if (isNoteOffMessage) {
          midiNoteOff(transposedByte1, instId);
        } else if (status === 0xB0) {
          handleCC(byte1, byte2, instId);
        } else if (status === 0xE0) {
          handlePitchBend(byte1, byte2, instId);
        } else if (status === 0xA0) {
          // Polyphonic aftertouch: map pressure to filter cutoff for that note's voice
          handlePolyAftertouch(byte1, byte2, instId);
        } else if (status === 0xD0) {
          // Channel aftertouch: map to global filter cutoff modulation
          handleChannelAftertouch(byte1, instId);
        } else if (status === 0xC0) {
          // Program change: load preset for this instrument
          handleProgramChange(byte1, instId);
        }
      }
    }
  }

  // ============================================================
  // CC Handling
  // ============================================================
  // Control Change (CC) messages carry 7-bit values (0-127) for various
  // continuous controllers. CC numbers are standardized by the MIDI spec:
  //   CC1  = Mod Wheel          CC7  = Channel Volume
  //   CC10 = Pan                CC11 = Expression
  //   CC64 = Sustain Pedal      CC71 = Filter Resonance (Sound Controller 2)
  //   CC72 = Release Time       CC73 = Attack Time
  //   CC74 = Filter Cutoff (Brightness / MPE Slide)
  //   CC75 = Decay Time
  //   CC120 = All Sound Off     CC123 = All Notes Off

  function handleCC(cc, value, channel) {
    if (cc === 123 || cc === 120) {
      // All Notes Off / All Sound Off
      panicChannel(channel);
    } else if (cc === 1) {
      // Mod wheel — map to vibrato depth via LFO modulation on active oscillators
      var vibratoDepth = (value / 127) * 50; // 0-50 cents max vibrato
      var activeNotes = midiActiveNotes[channel];
      activeNotes.forEach(function(noteData) {
        if (noteData.type === 'subtractive' && noteData.oscillators) {
          for (var i = 0; i < noteData.oscillators.length; i++) {
            var osc = noteData.oscillators[i].osc;
            if (osc && osc.detune) {
              // Store vibrato depth for ongoing LFO modulation
              noteData._vibratoDepth = vibratoDepth;
            }
          }
        }
      });
    } else if (cc === 7) {
      // Volume — scale instrument volume
      if (SL.audio && SL.audio.setInstrumentVolume) {
        var vol = Math.round((value / 127) * 100);
        SL.audio.setInstrumentVolume(channel, vol);
      }
    } else if (cc === 10) {
      // Pan — map 0-127 to -1.0 to +1.0
      if (SL.audio && SL.audio.setInstrumentPan) {
        var pan = ((value / 127) * 2) - 1;
        SL.audio.setInstrumentPan(channel, pan);
      }
    } else if (cc === 11) {
      // Expression — scale volume multiplicatively
      _expressionLevel[channel] = value / 127;
      if (SL.audio && SL.audio.setInstrumentVolume) {
        var instruments = SL.audio.getInstruments();
        if (instruments[channel]) {
          var baseVol = instruments[channel].settings.volume;
          SL.audio.setInstrumentVolume(channel, Math.round(baseVol * _expressionLevel[channel]));
        }
      }
    } else if (cc === 64) {
      // Sustain pedal — continuous half-pedaling
      var pedalAmount = value / 127;
      _sustainPedalAmount[channel] = pedalAmount;
      if (pedalAmount < 0.1) {
        // Pedal fully up — release all sustained notes
        var held = _sustainedNotes[channel];
        var keys = Object.keys(held);
        for (var i = 0; i < keys.length; i++) {
          midiNoteOff(parseInt(keys[i], 10), channel);
        }
        _sustainedNotes[channel] = {};
      } else {
        // Pedal partially or fully down — scale release times of active notes
        var activeNotes = midiActiveNotes[channel];
        activeNotes.forEach(function(noteData, midi) {
          if (noteData.type === 'subtractive' && noteData.master) {
            var baseRel = _baseReleaseTimes[channel][midi] || noteData.releaseTime || 0.2;
            var effectiveRelease = baseRel * (1 + (1 - pedalAmount) * 5);
            noteData.releaseTime = effectiveRelease;
          }
        });
      }
    } else if (cc === 71) {
      // Filter resonance — map 0-127 to resonance range
      if (SL.audio && SL.audio.getInstruments) {
        var instruments = SL.audio.getInstruments();
        var inst = instruments[channel];
        var hasFilterQ = inst && inst.settings && inst.settings.filter;
        if (hasFilterQ) {
          inst.settings.filter.q = Math.round((value / 127) * 100);
          if (SL.audio.loadInstrumentSettings) {
            SL.audio.loadInstrumentSettings(channel);
          }
        }
      }
    } else if (cc === 72) {
      // ADSR release time — map 0-127 to release range (0-100)
      if (SL.audio && SL.audio.getInstruments) {
        var instruments = SL.audio.getInstruments();
        var inst = instruments[channel];
        var hasAdsrRelease = inst && inst.settings && inst.settings.adsr;
        if (hasAdsrRelease) {
          inst.settings.adsr.r = Math.round((value / 127) * 100);
          if (SL.audio.loadInstrumentSettings) {
            SL.audio.loadInstrumentSettings(channel);
          }
        }
      }
    } else if (cc === 73) {
      // ADSR attack time — map 0-127 to attack range (0-100)
      if (SL.audio && SL.audio.getInstruments) {
        var instruments = SL.audio.getInstruments();
        var inst = instruments[channel];
        var hasAdsrAttack = inst && inst.settings && inst.settings.adsr;
        if (hasAdsrAttack) {
          inst.settings.adsr.a = Math.round((value / 127) * 100);
          if (SL.audio.loadInstrumentSettings) {
            SL.audio.loadInstrumentSettings(channel);
          }
        }
      }
    } else if (cc === 74) {
      // Filter cutoff — map 0-127 to frequency range
      if (SL.audio && SL.audio.getInstruments) {
        var instruments = SL.audio.getInstruments();
        var inst = instruments[channel];
        var hasFilterCutoff = inst && inst.settings && inst.settings.filter;
        if (hasFilterCutoff) {
          // Map 0-127 to 20-20000 Hz logarithmically
          var normalized = value / 127;
          var freq = 20 * Math.pow(1000, normalized);
          inst.settings.filter.freq = Math.round(freq);
          if (SL.audio.loadInstrumentSettings) {
            SL.audio.loadInstrumentSettings(channel);
          }
        }
      }
    } else if (cc === 75) {
      // ADSR decay time — map 0-127 to decay range (0-100)
      if (SL.audio && SL.audio.getInstruments) {
        var instruments = SL.audio.getInstruments();
        var inst = instruments[channel];
        var hasAdsrDecay = inst && inst.settings && inst.settings.adsr;
        if (hasAdsrDecay) {
          inst.settings.adsr.d = Math.round((value / 127) * 100);
          if (SL.audio.loadInstrumentSettings) {
            SL.audio.loadInstrumentSettings(channel);
          }
        }
      }
    }
  }

  // ============================================================
  // Pitch Bend
  // ============================================================
  // Pitch bend is the only standard MIDI message with 14-bit resolution
  // (most CCs are 7-bit). The two data bytes combine: MSB provides coarse
  // resolution, LSB provides fine resolution. This gives 16384 steps
  // across the bend range, enough for smooth pitch sweeps without audible
  // stepping. The center value 8192 means "no bend."

  function handlePitchBend(lsb, msb, channel) {
    // Combine LSB and MSB into 14-bit value: 0-16383, center at 8192
    var bendValue = (msb << 7) | lsb;
    // Normalize to -1.0..+1.0, then scale by bend range (semitones * 100 = cents)
    var bendNormalized = (bendValue - 8192) / 8192; // -1.0 to +1.0
    var detuneCents = bendNormalized * _pitchBendRange * 100;

    // Apply detune to all active notes on this channel
    var activeNotes = midiActiveNotes[channel];
    activeNotes.forEach(function(noteData) {
      if (noteData.type === 'subtractive' && noteData.oscillators) {
        for (var i = 0; i < noteData.oscillators.length; i++) {
          var osc = noteData.oscillators[i].osc;
          if (osc && osc.detune) {
            osc.detune.value = detuneCents;
          }
        }
      }
    });
  }

  // ============================================================
  // Aftertouch Handling
  // ============================================================
  // Aftertouch (key pressure) is a continuous controller generated by
  // pressing harder on a key after the initial strike. Two forms exist:
  //   Polyphonic aftertouch (0xA0): per-note pressure (rare, expensive)
  //   Channel aftertouch (0xD0): single pressure value for the channel
  // Here, both map to filter cutoff modulation -- a common expressive
  // mapping that lets the performer "open up" the filter by pressing harder.

  function handlePolyAftertouch(note, pressure, channel) {
    // Map pressure to filter cutoff for the specific note's voice
    var noteData = midiActiveNotes[channel].get(note);
    if (!noteData || !noteData.filterChain) return;
    var normalized = pressure / 127;
    var freq = 20 * Math.pow(1000, normalized);
    if (noteData.filterChain.input && noteData.filterChain.input.frequency) {
      noteData.filterChain.input.frequency.value = freq;
    }
  }

  function handleChannelAftertouch(pressure, channel) {
    // Map channel pressure to global filter cutoff for all active notes on this channel
    var normalized = pressure / 127;
    var freq = 20 * Math.pow(1000, normalized);
    var activeNotes = midiActiveNotes[channel];
    activeNotes.forEach(function(noteData) {
      var hasFilterFrequency = noteData.filterChain && noteData.filterChain.input && noteData.filterChain.input.frequency;
      if (hasFilterFrequency) {
        noteData.filterChain.input.frequency.value = freq;
      }
    });
  }

  // ============================================================
  // Program Change Handling
  // ============================================================

  function handleProgramChange(program, instId) {
    // A-09: Map MIDI program 0-127 to preset index for current engine/category.
    // Uses the presets system to find and apply the preset at the given index.
    var hasPresetsSystem = SL.presets && SL.presets.getPresetsForEngineCategory;
    var canApplyPreset = hasPresetsSystem && SL.presets.apply;
    if (canApplyPreset) {
    var engineType = 'Subtractive';
    if (SL.audio && SL.audio.getInstrumentType) {
      var rawType = SL.audio.getInstrumentType(instId);
      // Capitalize first letter for engine lookup
      if (rawType && rawType.length > 0) {
        engineType = rawType.charAt(0).toUpperCase() + rawType.slice(1);
      }
    }
    var allPresets = SL.presets.getPresetsForEngineCategory(engineType, 'All');
    var presetIndex = Math.min(program, allPresets.length - 1);
    if (presetIndex >= 0 && allPresets[presetIndex]) {
      SL.presets.apply(allPresets[presetIndex]);
      if (SL.state && SL.state.notify) {
        SL.state.notify('preset');
      }
    }
    } // end if (SL.presets)
  }

  // ============================================================
  // Note On/Off with Per-Instrument Routing
  // ============================================================

  function midiNoteOn(midi, velocity, instId) {
    // Don't double-trigger
    if (midiActiveNotes[instId].has(midi)) {
      midiNoteOff(midi, instId);
    }

    var type = SL.audio.getInstrumentType(instId);

    // MIDIOUT type — send MIDI out, no local audio
    var hasFmEngine = SL.fm && SL.fm.noteOn;
    var isFmNoteOnReady = type === 'fm' && hasFmEngine;
    var hasPhysicalEngine = SL.physical && SL.physical.noteOn;
    var isPhysicalNoteOnReady = type === 'physical' && hasPhysicalEngine;
    var hasSamplerEngine = SL.sampler && SL.sampler.noteOn;
    var isSamplerNoteOnReady = type === 'sampler' && hasSamplerEngine;
    if (type === 'midiout') {
      var moSettings = midioutSettings[instId];
      var adjVel = applyVelocityCurve(velocity, moSettings.velCurve);
      sendNoteOn(midi, adjVel, moSettings.channel);
      midiActiveNotes[instId].set(midi, { type: 'midiout' });
      SL.audio.highlightNote(midi, true);
    } else if (isFmNoteOnReady) {
      // FM synthesis
      SL.fm.noteOn(midi, velocity, instId);
      midiActiveNotes[instId].set(midi, { type: 'fm' });
      SL.audio.highlightNote(midi, true);
    } else if (isPhysicalNoteOnReady) {
      // Physical modelling
      SL.physical.noteOn(midi, velocity, instId);
      midiActiveNotes[instId].set(midi, { type: 'physical' });
      SL.audio.highlightNote(midi, true);
    } else if (isSamplerNoteOnReady) {
      // Sampler
      SL.sampler.noteOn(midi, velocity, instId);
      midiActiveNotes[instId].set(midi, { type: 'sampler' });
      SL.audio.highlightNote(midi, true);
    } else {
    // Subtractive synthesis — create oscillators routed to this instrument's masterOutput
    var instruments = SL.audio.getInstruments();
    var inst = instruments[instId];
    if (inst) {

    // Read saved settings for this instrument
    var settings = inst.settings;
    var c = SL.audio.getCtx();
    var f = SL.audio.m2f(midi);

    // ADSR from saved settings
    var attackTime = Math.max(0.003, SL.audio.sliderToTime(settings.adsr.a, 500, 500) / 1000);
    var decayTime = SL.audio.sliderToTime(settings.adsr.d, 500, 500) / 1000;
    var sustainLevel = settings.adsr.s / 100;
    var releaseTime = SL.audio.sliderToTime(settings.adsr.r, 1000, 1000) / 1000;

    var velNorm = velocity / 127;
    var velCurved = velNorm * velNorm;
    var peak = velCurved * 0.12;
    var now = c.currentTime;

    // Master gain with ADSR attack + decay
    var master = c.createGain();
    master.gain.setValueAtTime(0, now);
    master.gain.linearRampToValueAtTime(peak, now + attackTime);
    master.gain.linearRampToValueAtTime(Math.max(0.001, sustainLevel * peak), now + attackTime + decayTime);

    var destination = inst.masterOutput || SL.audio.getFinalDestination();

    // Filter from saved settings
    var filterChain = null;
    if (settings.filter.enabled) {
      var filterFreq = SL.audio.sliderToFreq(settings.filter.freq);
      var filterQ = SL.audio.sliderToQ(settings.filter.q);
      var keyTrackedFreq = SL.audio.calcKeyTrackedFreq(filterFreq, f, settings.filter.keyTrack);

      var filterSettings = {
        enabled: true,
        type: settings.filter.type,
        frequency: keyTrackedFreq,
        resonance: filterQ,
        keyTrack: settings.filter.keyTrack,
        model: settings.filter.model,
        slope: settings.filter.slope
      };

      filterChain = SL.audio.createFilterChain(c, filterSettings);
    }

    if (filterChain) {
      master.connect(filterChain.input);
      filterChain.output.connect(destination);
    } else {
      master.connect(destination);
    }

    // Create oscillators from saved settings
    var oscillators = [];
    settings.osc.forEach(function(os) {
      var level = (os.level || 0) / 100;
      if (level <= 0) return;

      var oscFreq = f * Math.pow(2, os.oct || 0) * Math.pow(2, (os.detune || 0) / 1200);

      if (os.wave === 'supersaw' && SL.audio.createSuperSawOscillators) {
        var ssOscs = SL.audio.createSuperSawOscillators(c, oscFreq, os.superSawSpread || 50, master, level);
        ssOscs.forEach(function(osc) {
          osc.start();
          oscillators.push({ osc: osc, gain: null });
        });
      } else if (os.wave === 'pulse' && SL.audio.createPulseWave) {
        var o = c.createOscillator();
        var g = c.createGain();
        var pw = SL.audio.createPulseWave(c, os.pulseWidth || 50);
        o.setPeriodicWave(pw);
        o.frequency.value = oscFreq;
        g.gain.value = level;
        o.connect(g);
        g.connect(master);
        o.start();
        oscillators.push({ osc: o, gain: g });
      } else {
        var o = c.createOscillator();
        o.type = os.wave || 'sine';
        o.frequency.value = oscFreq;
        var g = c.createGain();
        g.gain.value = level;
        o.connect(g);
        g.connect(master);
        o.start();
        oscillators.push({ osc: o, gain: g });
      }
    });

    // Capture base release time for half-pedaling
    _baseReleaseTimes[instId][midi] = releaseTime;
    // If pedal is partially down, scale release immediately
    var effectiveRelease = releaseTime;
    if (_sustainPedalAmount[instId] >= 0.1) {
      effectiveRelease = releaseTime * (1 + (1 - _sustainPedalAmount[instId]) * 5);
    }

    midiActiveNotes[instId].set(midi, {
      type: 'subtractive',
      oscillators: oscillators,
      master: master,
      filterChain: filterChain,
      releaseTime: effectiveRelease
    });
    SL.audio.highlightNote(midi, true);
    }
    } // end else (subtractive path)
  }

  function midiNoteOff(midi, instId) {
    // If sustain pedal is down (>10% threshold), hold the note instead of releasing
    if (_sustainPedalAmount[instId] >= 0.1 && !_sustainedNotes[instId][midi]) {
      _sustainedNotes[instId][midi] = true;
    } else {
    // Clear sustained flag and base release tracking
    delete _sustainedNotes[instId][midi];
    delete _baseReleaseTimes[instId][midi];

    var noteData = midiActiveNotes[instId].get(midi);
    if (noteData) {

    if (noteData.type === 'midiout') {
      var moSettings = midioutSettings[instId];
      sendNoteOff(midi, moSettings.channel);
    } else if (noteData.type === 'fm') {
      if (SL.fm && SL.fm.noteOff) SL.fm.noteOff(midi, instId);
    } else if (noteData.type === 'physical') {
      if (SL.physical && SL.physical.noteOff) SL.physical.noteOff(midi, instId);
    } else if (noteData.type === 'sampler') {
      if (SL.sampler && SL.sampler.noteOff) SL.sampler.noteOff(midi, instId);
    } else if (noteData.type === 'subtractive') {
      var c = SL.audio.getCtx();
      var releaseTime = noteData.releaseTime || 0.2;
      var now = c.currentTime;

      // Cancel any scheduled values and do release envelope
      noteData.master.gain.cancelScheduledValues(now);
      noteData.master.gain.setValueAtTime(noteData.master.gain.value, now);
      noteData.master.gain.exponentialRampToValueAtTime(0.001, now + releaseTime);

      // Schedule oscillator stop after release
      var stopTime = now + releaseTime + 0.02;
      noteData.oscillators.forEach(function(o) {
        try { o.osc.stop(stopTime); } catch (e) { /* oscillator may already be stopped */ }
      });

      // Disconnect filter chain after release
      if (noteData.filterChain) {
        setTimeout(function() {
          try {
            noteData.master.disconnect();
            if (noteData.filterChain.output) noteData.filterChain.output.disconnect();
          } catch (e) { /* node may already be disconnected */ }
        }, (releaseTime + 0.05) * 1000);
      }
    }

    midiActiveNotes[instId].delete(midi);
    SL.audio.highlightNote(midi, false);
    } // end if (noteData)
    } // end else (not sustained)
  }

  // ============================================================
  // Velocity Curve
  // ============================================================
  // Velocity curves reshape the linear MIDI velocity (0-127) to match
  // different playing styles. "Soft" (square root) makes quiet playing
  // louder; "hard" (squared) requires forceful playing for full volume;
  // "fixed" ignores velocity entirely (useful for organs and pads).

  function applyVelocityCurve(velocity, curve) {
    var v = velocity / 127;
    if (curve === 'fixed') {
      return 100;
    } else if (curve === 'soft') {
      v = Math.sqrt(v);
    } else if (curve === 'hard') {
      v = v * v;
    }
    // 'linear' — no change
    return Math.max(0, Math.min(127, Math.round(v * 127)));
  }

  // ============================================================
  // Pressure-to-Velocity (shared utility for touch/pen input)
  // ============================================================
  // Touch screens and pen tablets report contact pressure/area, which
  // we map to MIDI velocity for expressive touch-screen playing.
  // Multiple fallback sources are tried in priority order:
  //   1. PointerEvent.pressure (pen tablets, some Android)
  //   2. TouchEvent.force (iOS with 3D Touch, if not constant)
  //   3. Contact radius (finger flattening = harder press)
  //   4. Global touchstart capture (for pointer-only surfaces)
  //   5. Untyped pointer pressure (edge cases)
  // iOS quirk: devices without pressure sensors report a constant
  // force value -- we detect and skip these via history tracking.

  /**
   * Detects whether Touch.force reports a constant (fake) value.
   * iOS devices without pressure sensors return the same value every time
   * (e.g. 24.17 or 12.09). We track recent values and if we see the same
   * value twice, we flag force as unreliable.
   */
  function _isForceConstant(forceValue) {
    var RECENT_FORCE_HISTORY_SIZE = 5;
    var hasValidForce = (typeof forceValue === 'number' && forceValue > 0);
    if (!hasValidForce) {
      return false;
    }
    var recentValues = SL._recentForceValues || [];
    // Round to 2 decimal places to avoid floating point noise
    var rounded = Math.round(forceValue * 100) / 100;
    var isDuplicate = false;
    var i = 0;
    while (i < recentValues.length) {
      var match = (recentValues[i] === rounded);
      if (match) {
        isDuplicate = true;
      }
      i = i + 1;
    }
    recentValues.push(rounded);
    // Keep history bounded
    var isTooLong = (recentValues.length > RECENT_FORCE_HISTORY_SIZE);
    if (isTooLong) {
      recentValues.shift();
    }
    SL._recentForceValues = recentValues;
    return isDuplicate;
  }

  function velocityFromPressure(e, fallback) {
    var PRESSURE_VEL_MIN = SL._touchSettings.velMin;
    var PRESSURE_VEL_MAX = SL._touchSettings.velMax;
    var DEFAULT_FALLBACK = 100;
    var GLOBAL_FORCE_MAX_AGE_MS = 100;
    var INPUT_FLOOR = 0.15;

    // Dynamic radius range based on touch sensitivity setting
    var LIGHT_RADIUS_MIN = 5;
    var LIGHT_RADIUS_MAX = 15;
    var HEAVY_RADIUS_MIN = 15;
    var HEAVY_RADIUS_MAX = 45;
    var SENSITIVITY_DEFAULT = 25;
    var SENSITIVITY_MAX = 100;

    var sensitivity = SL._touchSettings.sensitivity;

    var sensFraction = sensitivity / SENSITIVITY_MAX;
    var RADIUS_MIN = Math.round(LIGHT_RADIUS_MIN + (sensFraction * (HEAVY_RADIUS_MIN - LIGHT_RADIUS_MIN)));
    var RADIUS_MAX = Math.round(LIGHT_RADIUS_MAX + (sensFraction * (HEAVY_RADIUS_MAX - LIGHT_RADIUS_MAX)));

    var fb = (typeof fallback === 'number') ? fallback : DEFAULT_FALLBACK;
    var result = fb;
    var normalizedInput = -1;
    var diagSource = 'fallback';

    // Check if touch velocity is enabled (defaults to OFF)
    var touchVelEnabled = SL._touchSettings.enabled;

    if (touchVelEnabled) {
    // Install global touchstart listener once to capture Touch.force and radiusX
    // for iOS fallback. On iOS, pointerdown fires with pointerType='touch' but
    // pressure=0, and PointerEvents lack changedTouches. This global listener
    // captures raw touch data so pointer-only surfaces (piano) can still read it.
    if (!SL._touchForceListenerAdded) {
      SL._touchForceListenerAdded = true;
      document.addEventListener('touchstart', function(ev) {
        var t = (ev.changedTouches && ev.changedTouches.length > 0) ? ev.changedTouches[0] : null;
        if (t) {
          var capturedForce = (typeof t.force === 'number') ? t.force : 0;
          var capturedRadiusX = (typeof t.radiusX === 'number') ? t.radiusX : 0;
          var capturedRadiusY = (typeof t.radiusY === 'number') ? t.radiusY : 0;
          SL._lastTouchForce = {
            force: capturedForce,
            radiusX: capturedRadiusX,
            radiusY: capturedRadiusY,
            timestamp: Date.now()
          };
        }
      }, { capture: true, passive: true });
    }

    // Source 1: PointerEvent.pressure (pen tablets, some Android with real sensors)
    var isTouchOrPen = (e && (e.pointerType === 'touch' || e.pointerType === 'pen'));
    var pointerPressure = (isTouchOrPen && typeof e.pressure === 'number') ? e.pressure : 0;
    var pointerHasPressure = (pointerPressure > 0);
    if (pointerHasPressure) {
      normalizedInput = pointerPressure;
      diagSource = 'pointer-pressure';
    }

    // Source 2: TouchEvent.force — but ONLY if it actually varies.
    // iOS devices without pressure sensors report a constant value (e.g. 24.17).
    // If _isForceConstant detects repetition, skip this source entirely.
    var needSource2 = (normalizedInput <= 0);
    var isRawTouchEvent = (e && e.changedTouches && e.changedTouches.length > 0);
    if (needSource2 && isRawTouchEvent) {
      var firstTouch = e.changedTouches[0];
      var rawForce = (typeof firstTouch.force === 'number') ? firstTouch.force : 0;
      var forceIsConstant = _isForceConstant(rawForce);
      var forceIsUsable = (rawForce > 0 && !forceIsConstant);
      if (forceIsUsable) {
        // Normalize: force can be 0-1 (spec) or raw values like 24.17 (iOS quirk)
        var FORCE_RAW_THRESHOLD = 6.0;
        var FORCE_RAW_DIVISOR = 40.0;
        var normalizedForce = (rawForce > FORCE_RAW_THRESHOLD) ? (rawForce / FORCE_RAW_DIVISOR) : rawForce;
        var clampedForce = Math.max(0, Math.min(1, normalizedForce));
        var forceIsPositive = (clampedForce > 0);
        if (forceIsPositive) {
          normalizedInput = clampedForce;
          diagSource = 'touch-force';
        }
      }
    }

    // Source 3: Touch contact radius (radiusX/radiusY from TouchEvent, or
    // width/height from PointerEvent). THIS IS THE PRIMARY iOS PATH.
    // When you press harder on a touchscreen, your finger flattens and the
    // contact area grows. Map radius to velocity.

    // 3a: PointerEvent.width/height (iOS pointer events carry contact size)
    var needSource3 = (normalizedInput <= 0);
    if (needSource3 && isTouchOrPen) {
      var ptrWidth = (typeof e.width === 'number') ? e.width : 0;
      var ptrHeight = (typeof e.height === 'number') ? e.height : 0;
      var ptrRadius = Math.max(ptrWidth, ptrHeight) / 2;
      var ptrRadiusUsable = (ptrRadius > 0);
      if (ptrRadiusUsable) {
        var ptrClamped = Math.max(RADIUS_MIN, Math.min(RADIUS_MAX, ptrRadius));
        normalizedInput = (ptrClamped - RADIUS_MIN) / (RADIUS_MAX - RADIUS_MIN);
        diagSource = 'pointer-radius';
      }
    }

    // 3b: TouchEvent radiusX/radiusY
    var needSource3b = (normalizedInput <= 0);
    if (needSource3b && isRawTouchEvent) {
      var touchObj = e.changedTouches[0];
      var touchRadX = (typeof touchObj.radiusX === 'number') ? touchObj.radiusX : 0;
      var touchRadY = (typeof touchObj.radiusY === 'number') ? touchObj.radiusY : 0;
      var touchRad = Math.max(touchRadX, touchRadY);
      var touchRadUsable = (touchRad > 0);
      if (touchRadUsable) {
        var tClamped = Math.max(RADIUS_MIN, Math.min(RADIUS_MAX, touchRad));
        normalizedInput = (tClamped - RADIUS_MIN) / (RADIUS_MAX - RADIUS_MIN);
        diagSource = 'touch-radius';
      }
    }

    // Source 4: Global capture fallback (for pointer-only surfaces like piano).
    // Check radius first, then force (only if force is not constant).
    var needSource4 = (normalizedInput <= 0);
    var globalData = SL._lastTouchForce || { force: 0, radiusX: 0, radiusY: 0, timestamp: 0 };
    var globalAge = Date.now() - globalData.timestamp;
    var isRecentGlobal = (globalAge < GLOBAL_FORCE_MAX_AGE_MS);
    if (needSource4 && isRecentGlobal) {
      // 4a: Global radius
      var gRadiusX = (typeof globalData.radiusX === 'number') ? globalData.radiusX : 0;
      var gRadiusY = (typeof globalData.radiusY === 'number') ? globalData.radiusY : 0;
      var gRadius = Math.max(gRadiusX, gRadiusY);
      var gRadiusUsable = (gRadius > 0);
      if (gRadiusUsable) {
        var gClamped = Math.max(RADIUS_MIN, Math.min(RADIUS_MAX, gRadius));
        normalizedInput = (gClamped - RADIUS_MIN) / (RADIUS_MAX - RADIUS_MIN);
        diagSource = 'global-radius';
      } else {
        // 4b: Global force (only if not constant)
        var gForce = globalData.force;
        var gForceConstant = _isForceConstant(gForce);
        var gForceUsable = (gForce > 0 && !gForceConstant);
        if (gForceUsable) {
          var GFORCE_RAW_THRESHOLD = 6.0;
          var GFORCE_RAW_DIVISOR = 40.0;
          var gNormForce = (gForce > GFORCE_RAW_THRESHOLD) ? (gForce / GFORCE_RAW_DIVISOR) : gForce;
          normalizedInput = Math.max(0, Math.min(1, gNormForce));
          diagSource = 'global-touch-force';
        }
      }
    }

    // Source 5: PointerEvent without pointerType but with nonzero pressure
    var needSource5 = (normalizedInput <= 0);
    var isPointerWithoutType = (e && typeof e.pressure === 'number' && e.pressure > 0 && !e.pointerType);
    if (needSource5 && isPointerWithoutType) {
      normalizedInput = e.pressure;
      diagSource = 'pointer-untyped';
    }

    } // end if (touchVelEnabled) — when disabled, normalizedInput stays -1, result stays fb

    // Update diagnostic state for debug panel
    if (SL._pressureDiag) {
      SL._pressureDiag.touchVelEnabled = touchVelEnabled;
      SL._pressureDiag.lastPath = diagSource;
      SL._pressureDiag.lastPressure = normalizedInput;
      SL._pressureDiag.lastPointerType = (e && e.pointerType) ? e.pointerType : 'N/A';
      SL._pressureDiag.lastPointerPressure = (e && typeof e.pressure === 'number') ? e.pressure : -1;
      var diagTouchForce = -1;
      var diagTouchForceRaw = -1;
      var diagRadiusX = -1;
      var diagRadiusY = -1;
      var hasDiagTouch = (e && e.changedTouches && e.changedTouches.length > 0);
      if (hasDiagTouch) {
        var diagTouch = e.changedTouches[0];
        diagTouchForceRaw = (typeof diagTouch.force === 'number') ? diagTouch.force : -1;
        var DIAG_FORCE_RAW_THRESHOLD = 6.0;
        var DIAG_FORCE_RAW_DIVISOR = 40.0;
        var diagNormalized = (diagTouchForceRaw > DIAG_FORCE_RAW_THRESHOLD) ? (diagTouchForceRaw / DIAG_FORCE_RAW_DIVISOR) : diagTouchForceRaw;
        diagTouchForce = (diagTouchForceRaw >= 0) ? Math.max(0, Math.min(1, diagNormalized)) : -1;
        diagRadiusX = (typeof diagTouch.radiusX === 'number') ? diagTouch.radiusX : -1;
        diagRadiusY = (typeof diagTouch.radiusY === 'number') ? diagTouch.radiusY : -1;
      }
      SL._pressureDiag.lastTouchForce = diagTouchForce;
      SL._pressureDiag.lastTouchForceRaw = diagTouchForceRaw;
      SL._pressureDiag.lastRadiusX = diagRadiusX;
      SL._pressureDiag.lastRadiusY = diagRadiusY;
      SL._pressureDiag.lastPointerWidth = (e && typeof e.width === 'number') ? e.width : -1;
      SL._pressureDiag.lastPointerHeight = (e && typeof e.height === 'number') ? e.height : -1;
      var safeGlobalData = SL._lastTouchForce || { force: 0, radiusX: 0, radiusY: 0, timestamp: 0 };
      var safeGlobalAge = Date.now() - safeGlobalData.timestamp;
      SL._pressureDiag.lastGlobalForce = safeGlobalData.force;
      SL._pressureDiag.lastGlobalForceAge = safeGlobalAge;
      SL._pressureDiag.lastGlobalRadiusX = (typeof safeGlobalData.radiusX === 'number') ? safeGlobalData.radiusX : -1;
      SL._pressureDiag.touchSensitivity = sensitivity;
      SL._pressureDiag.radiusMin = RADIUS_MIN;
      SL._pressureDiag.radiusMax = RADIUS_MAX;
      // Check if force appears constant by examining recent history
      var forceConstantCheck = (SL._recentForceValues && SL._recentForceValues.length >= 2);
      if (forceConstantCheck) {
        var lastTwo = SL._recentForceValues.slice(-2);
        SL._pressureDiag.forceAppearsConstant = (lastTwo[0] === lastTwo[1]);
      } else {
        SL._pressureDiag.forceAppearsConstant = false;
      }
    }

    // Convert normalizedInput (0.0-1.0) to velocity
    var hasInput = (normalizedInput > 0);
    if (hasInput) {
      // Apply input floor so even the lightest detectable touch produces audible velocity
      var flooredInput = Math.max(INPUT_FLOOR, normalizedInput);
      var rawVelocity = Math.round(PRESSURE_VEL_MIN + (flooredInput * (PRESSURE_VEL_MAX - PRESSURE_VEL_MIN)));
      var curve = 'linear';
      if (SL.audio && SL.audio.getInstruments) {
        var insts = SL.audio.getInstruments();
        var instIdx = SL.audio.getCurrentInstrument();
        var hasInstCurve = (insts && insts[instIdx] && insts[instIdx].settings && insts[instIdx].settings.velCurve);
        if (hasInstCurve) {
          curve = insts[instIdx].settings.velCurve;
        }
      }
      var isStillLinear = (curve === 'linear');
      if (isStillLinear) {
        try {
          var savedCurve = localStorage.getItem('ssli-vel-curve');
          var hasSavedCurve = (savedCurve !== NO_STORED_VALUE);
          if (hasSavedCurve) { curve = savedCurve; }
        } catch (lsErr) { /* localStorage may be unavailable */ }
      }
      result = applyVelocityCurve(rawVelocity, curve);
    }

    return result;
  }

  // ============================================================
  // MIDI Output (echo keyboard to external devices)
  // ============================================================
  // MIDI output sends raw byte arrays to external hardware synths.
  // The message format mirrors input: status byte with channel in the
  // lower nibble, followed by 7-bit data bytes. The & 0x0F and & 0x7F
  // masks ensure values stay within the MIDI spec's valid ranges.

  function sendNoteOn(midi, velocity, channel) {
    if (!currentOutput) return;
    // Construct Note On: 0x90 | channel, note number, velocity
    var ch = (channel != null) ? channel : SL.audio.getCurrentInstrument();
    currentOutput.send([0x90 | (ch & 0x0F), midi & 0x7F, (velocity || 100) & 0x7F]);
  }

  function sendNoteOff(midi, channel) {
    if (!currentOutput) return;
    var ch = (channel != null) ? channel : SL.audio.getCurrentInstrument();
    currentOutput.send([0x80 | (ch & 0x0F), midi & 0x7F, 0]);
  }

  // CC123 = All Notes Off. Standard MIDI panic message that tells the
  // receiving device to release all sounding notes on the given channel.
  function sendAllNotesOff(channel) {
    if (!currentOutput) return;
    if (channel != null) {
      currentOutput.send([0xB0 | (channel & 0x0F), 123, 0]);
    } else {
      for (var ch = 0; ch < 16; ch++) {
        currentOutput.send([0xB0 | ch, 123, 0]);
      }
    }
  }

  // ============================================================
  // Panic
  // ============================================================

  function panicChannel(channel) {
    midiActiveNotes[channel].forEach(function(data, midi) {
      midiNoteOff(midi, channel);
    });
  }

  function panic() {
    // Stop all MIDI-triggered notes (5 instruments)
    for (var ch = 0; ch < 5; ch++) {
      panicChannel(ch);
    }
    // Stop all keyboard-sustained notes
    if (SL.audio.stopAllSustained) {
      SL.audio.stopAllSustained();
    }
    // Send All Notes Off on MIDI output
    sendAllNotesOff();
  }

  // ============================================================
  // UI
  // ============================================================

  function updateDeviceSelectors() {
    var inputSelect = document.getElementById('midiInput');
    var outputSelect = document.getElementById('midiOutput');
    if (inputSelect) {
      if (outputSelect) {
        var inputs = getInputDevices();
        var outputs = getOutputDevices();

        // Device discovery complete -- no console logging in production

        // Update input selector
        inputSelect.textContent = '';
        var inputNoneOpt = document.createElement('option');
        inputNoneOpt.value = '';
        inputNoneOpt.textContent = SL.t('midi.none_option');
        inputSelect.appendChild(inputNoneOpt);
        inputs.forEach(function(dev) {
          var opt = document.createElement('option');
          opt.value = dev.id;
          opt.textContent = dev.name;
          if (dev.id === selectedInputId) opt.selected = true;
          inputSelect.appendChild(opt);
        });

        // Update output selector
        outputSelect.textContent = '';
        var outputNoneOpt = document.createElement('option');
        outputNoneOpt.value = '';
        outputNoneOpt.textContent = SL.t('midi.none_option');
        outputSelect.appendChild(outputNoneOpt);
        outputs.forEach(function(dev) {
          var opt = document.createElement('option');
          opt.value = dev.id;
          opt.textContent = dev.name;
          if (dev.id === selectedOutputId) opt.selected = true;
          outputSelect.appendChild(opt);
        });

        updateStatusIndicator();
      }
    }
  }

  // Full rescan: re-request MIDI access to pick up newly connected USB devices
  function rescanDevices() {
    // Rescan requested
    if (!navigator.requestMIDIAccess) {
      console.warn('[MIDI] Web MIDI API not available');
    } else {
      navigator.requestMIDIAccess({ sysex: false }).then(
        function(access) {
          midiAccess = access;
          isMidiEnabled = true;
          access.onstatechange = onStateChange;
          updateDeviceSelectors();
          autoSelectDevices();
          // Rescan complete
        },
        function(err) {
        console.error('[MIDI] Rescan failed:', err);
      }
    );
  }
  }

  function updateStatusIndicator() {
    var indicator = document.getElementById('midiStatus');
    if (!indicator) return;

    if (!isMidiEnabled) {
      indicator.className = 'midi-status midi-unavailable';
      indicator.title = SL.t('midi.not_available');
    } else if (currentInput) {
      indicator.className = 'midi-status midi-connected';
      indicator.title = SL.t('midi.connected_prefix') + currentInput.name;
    } else {
      indicator.className = 'midi-status midi-disconnected';
      indicator.title = SL.t('midi.no_device_connected');
    }
  }

  function setupUI() {
    // Wire up device selectors
    var inputSelect = document.getElementById('midiInput');
    var outputSelect = document.getElementById('midiOutput');

    if (inputSelect) {
      inputSelect.addEventListener('change', function() {
        selectInput(this.value || null);
        updateStatusIndicator();
      });
    }
    if (outputSelect) {
      outputSelect.addEventListener('change', function() {
        selectOutput(this.value || null);
        updateStatusIndicator();
      });
    }

    // Panic button
    var panicBtn = document.getElementById('midiPanicBtn');
    if (panicBtn) {
      panicBtn.addEventListener('click', function() {
        panic();
        panicBtn.classList.add('panic-flash');
        setTimeout(function() { panicBtn.classList.remove('panic-flash'); }, 300);
      });
    }

    // Rescan button — dynamically created next to Panic button
    if (panicBtn && panicBtn.parentNode) {
      var rescanBtn = document.createElement('button');
      rescanBtn.id = 'midiRescanBtn';
      rescanBtn.innerHTML = SL.icon('refresh', 14); /* trusted: internal SVG icon */
      rescanBtn.title = SL.t('midi.rescan');
      rescanBtn.setAttribute('aria-label', SL.t('midi.rescan'));
      rescanBtn.style.cssText = panicBtn.style.cssText || '';
      rescanBtn.className = panicBtn.className.replace('panic-flash', '').trim();
      rescanBtn.addEventListener('click', function() {
        rescanBtn.innerHTML = SL.icon('refresh', 14); /* trusted: internal SVG icon */
        rescanBtn.disabled = true;
        rescanDevices();
        setTimeout(function() {
          rescanBtn.innerHTML = SL.icon('refresh', 14); /* trusted: internal SVG icon */
          rescanBtn.disabled = false;
        }, 1000);
      });
      panicBtn.parentNode.insertBefore(rescanBtn, panicBtn.nextSibling);
    }

    // MIDI toggle button (show/hide panel)
    var midiToggle = document.getElementById('midiToggle');
    var midiPanel = document.getElementById('midiPanel');
    if (midiToggle && midiPanel) {
      midiToggle.addEventListener('click', function() {
        if (midiPanel) { midiPanel.classList.toggle('hidden'); }
      });
    }

    // Per-instrument MIDI config UI (5 instruments)
    for (var i = 0; i < 5; i++) {
      (function(instId) {
        var inToggle = document.querySelector('.midi-in-toggle[data-inst="' + instId + '"]');
        var outToggle = document.querySelector('.midi-out-toggle[data-inst="' + instId + '"]');
        var chSelect = document.querySelector('.midi-ch-select[data-inst="' + instId + '"]');

        if (inToggle) {
          inToggle.addEventListener('change', function() {
            midiConfig[instId].midiIn = this.checked;
          });
        }
        if (outToggle) {
          outToggle.addEventListener('change', function() {
            midiConfig[instId].midiOut = this.checked;
          });
        }
        if (chSelect) {
          chSelect.addEventListener('change', function() {
            midiConfig[instId].channel = parseInt(this.value);
          });
        }
      })(i);
    }

    // Pitch bend range selector
    var pbRangeEl = document.getElementById('midiBendRange');
    if (pbRangeEl) {
      pbRangeEl.value = _pitchBendRange;
      pbRangeEl.addEventListener('change', function() {
        var val = parseInt(this.value) || 2;
        _pitchBendRange = Math.max(1, Math.min(24, val));
        this.value = _pitchBendRange;
        // Update display label if present
        var label = document.getElementById('midiBendRangeVal');
        if (label) {
          label.textContent = _pitchBendRange;
        }
      });
    }

    // MIDIOUT panel controls
    var midioutChEl = document.getElementById('midioutChannel');
    var midioutVelEl = document.getElementById('midioutVelCurve');
    var midioutProgEl = document.getElementById('midioutProgram');

    if (midioutChEl) {
      midioutChEl.addEventListener('change', function() {
        var instId = SL.audio.getCurrentInstrument();
        midioutSettings[instId].channel = parseInt(this.value);
      });
    }
    if (midioutVelEl) {
      midioutVelEl.addEventListener('change', function() {
        var instId = SL.audio.getCurrentInstrument();
        midioutSettings[instId].velCurve = this.value;
      });
    }
    if (midioutProgEl) {
      midioutProgEl.addEventListener('change', function() {
        var instId = SL.audio.getCurrentInstrument();
        midioutSettings[instId].program = parseInt(this.value) || 0;
        // Send program change if output is connected
        if (currentOutput) {
          var ch = midioutSettings[instId].channel;
          currentOutput.send([0xC0 | (ch & 0x0F), midioutSettings[instId].program & 0x7F]);
        }
      });
    }
  }

  // ============================================================
  // Hook into keyboard for MIDI output
  // ============================================================
  // Wraps the audio engine's note functions to intercept note events
  // and forward them to MIDI output when configured. For "midiout" type
  // instruments, no local audio is produced -- notes go exclusively to
  // the external MIDI device. For other types, notes play locally AND
  // are optionally echoed to MIDI out (useful for recording into a DAW).

  function hookKeyboardOutput() {
    // Wrap startSustainedNote to also send MIDI out when configured
    var origStart = SL.audio.startSustainedNote;
    var origStop = SL.audio.stopSustainedNote;

    if (origStart) {
      SL.audio.startSustainedNote = function(midi, velocity) {
        var vel = (typeof velocity === 'number') ? velocity : 100;
        var instId = SL.audio.getCurrentInstrument();
        var type = SL.audio.getInstrumentType(instId);
        // For midiout type, don't play locally — just send MIDI
        if (type === 'midiout') {
          var moSettings = midioutSettings[instId];
          var adjVel = applyVelocityCurve(vel, moSettings.velCurve);
          sendNoteOn(midi, adjVel, moSettings.channel);
          SL.audio.highlightNote(midi, true);
        } else {
          origStart(midi, vel);
          // Also send MIDI out if midiOut is enabled for this instrument
          if (midiConfig[instId].midiOut) {
            sendNoteOn(midi, vel, midiConfig[instId].channel);
          }
        }
      };
    }
    if (origStop) {
      SL.audio.stopSustainedNote = function(midi) {
        var instId = SL.audio.getCurrentInstrument();
        var type = SL.audio.getInstrumentType(instId);
        if (type === 'midiout') {
          var moSettings = midioutSettings[instId];
          sendNoteOff(midi, moSettings.channel);
          SL.audio.highlightNote(midi, false);
        } else {
          origStop(midi);
          if (midiConfig[instId].midiOut) {
            sendNoteOff(midi, midiConfig[instId].channel);
          }
        }
      };
    }
  }

  // ============================================================
  // Init on SynthLab ready
  // ============================================================

  function setup() {
    init();
    setupUI();
    hookKeyboardOutput();
  }

  // ============================================================
  // Export
  // ============================================================

  SL.midi = {
    setup: setup,
    init: init,
    panic: panic,
    sendNoteOn: sendNoteOn,
    sendNoteOff: sendNoteOff,
    sendAllNotesOff: sendAllNotesOff,
    getInputDevices: getInputDevices,
    getOutputDevices: getOutputDevices,
    selectInput: selectInput,
    selectOutput: selectOutput,
    rescan: rescanDevices,
    isEnabled: function() { return isMidiEnabled; },
    setTranspose: function(val) { midiTranspose = Math.max(-24, Math.min(24, parseInt(val) || 0)); },
    getTranspose: function() { return midiTranspose; },
    setPitchBendRange: function(val) { _pitchBendRange = Math.max(1, Math.min(24, parseInt(val) || 2)); },
    getPitchBendRange: function() { return _pitchBendRange; },
    getActiveNoteCount: function() {
      var total = 0;
      for (var i = 0; i < 5; i++) total += midiActiveNotes[i].size;
      return total;
    },
    getMidiConfig: function() { return midiConfig; },
    setMidiConfig: function(instId, cfg) {
      var isValidSetConfigId = instId >= 0 && instId < 5;
      var hasValidSetConfig = isValidSetConfigId && cfg;
      if (hasValidSetConfig) {
        if (cfg.midiIn !== undefined) midiConfig[instId].midiIn = cfg.midiIn;
        if (cfg.midiOut !== undefined) midiConfig[instId].midiOut = cfg.midiOut;
        if (cfg.channel !== undefined) midiConfig[instId].channel = cfg.channel;
      }
    },
    getMidioutSettings: function() { return midioutSettings; },
    setMidioutSettings: function(instId, cfg) {
      var isValidSetMidioutId = instId >= 0 && instId < 5;
      var hasValidSetMidiout = isValidSetMidioutId && cfg;
      if (hasValidSetMidiout) {
        if (cfg.channel !== undefined) midioutSettings[instId].channel = cfg.channel;
        if (cfg.velCurve !== undefined) midioutSettings[instId].velCurve = cfg.velCurve;
        if (cfg.program !== undefined) midioutSettings[instId].program = cfg.program;
      }
    },
    loadMidioutUI: function(instId) {
      var chEl = document.getElementById('midioutChannel');
      var velEl = document.getElementById('midioutVelCurve');
      var progEl = document.getElementById('midioutProgram');
      var s = midioutSettings[instId];
      if (chEl) chEl.value = s.channel;
      if (velEl) velEl.value = s.velCurve;
      if (progEl) progEl.value = s.program;
    }
  };

  // Expose shared utility on SL namespace
  SL.velocityFromPressure = velocityFromPressure;

  // Auto-initialize MIDI on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      if (SL.midi && SL.midi.setup) SL.midi.setup();
    });
  } else {
    // DOM already loaded
    if (SL.midi && SL.midi.setup) SL.midi.setup();
  }

  // ============================================================
  // PanicRegistry registrations
  // ============================================================

  if (SL.PanicRegistry) {
    var MIDI_CHANNEL_COUNT = midiActiveNotes.length;

    SL.PanicRegistry.register(
      'sustained',
      'midi.sustained',
      function teardownSustained() {
        var ch;
        for (ch = 0; ch < MIDI_CHANNEL_COUNT; ch++) {
          _sustainedNotes[ch] = _makeSustainMap();
          _sustainPedalAmount[ch] = 0;
        }
      },
      function assertSustained() {
        var ch;
        for (ch = 0; ch < MIDI_CHANNEL_COUNT; ch++) {
          if (_sustainedNotes[ch] && Object.keys(_sustainedNotes[ch]).length > 0) {
            return 'sustained notes remain on ch' + ch;
          }
        }
        return null;
      }
    );

    SL.PanicRegistry.register(
      'midiActive',
      'midi.activeNotes',
      function teardownMidiActive() {
        var ch;
        for (ch = 0; ch < MIDI_CHANNEL_COUNT; ch++) {
          if (midiActiveNotes[ch] && midiActiveNotes[ch].clear) {
            midiActiveNotes[ch].clear();
          }
        }
      },
      function assertMidiActive() {
        var ch;
        for (ch = 0; ch < MIDI_CHANNEL_COUNT; ch++) {
          if (midiActiveNotes[ch] && midiActiveNotes[ch].size > 0) {
            return 'active MIDI notes remain on ch' + ch;
          }
        }
        return null;
      }
    );
  }

  } // end if (SL && SL.audio)

})();
