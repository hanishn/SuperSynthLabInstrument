// Super Synth Lab - Instrument Settings Module
// Extracted from audio-engine.js for modularity
// Loads AFTER audio-engine.js and note-playback.js, extends SL.audio
(function() {
  'use strict';

  var SL = window.SynthLab;
  var _cachedMethodEl = null;
  var _cachedRefHzEl = null;
  var MAX_SUPERSAW_HARMONICS_IS = 48;

  function _supersawFallbackVoiceIS(detuneCents, spreadFactor, oscFreq, t, TWO_PI, detuneCount) {
    var actualDetune = detuneCents * spreadFactor;
    var voiceFreq = oscFreq * Math.pow(2, actualDetune / 1200);
    var voicePh = TWO_PI * voiceFreq * t;
    var voiceMH = Math.min(SL.audio.maxH(voiceFreq), MAX_SUPERSAW_HARMONICS_IS);
    var voiceSample = 0;
    for (var h = 1; h <= voiceMH; h++) {
      var safeH = h || 1;
      voiceSample += SL.audio.fastSin(voicePh * h) / safeH;
    }
    voiceSample *= 2 / Math.PI;
    var safeDetuneCount = detuneCount || 1;
    return voiceSample / safeDetuneCount;
  }

  // Track active non-workvar notes so they can be killed on noteOff.
  // Key: "instId:midi", Value: array of { gain, sources }
  var _activeBufferNotes = {};

  if (!SL || !SL.audio) {
    console.error('[instrument-settings] SynthLab.audio not available');
  } else {

  // ============================================================
  // Multi-Instrument Management
  // ============================================================

  /**
   * Get the current instrument's settings
   * @returns {Object} Current instrument's settings object
   */
  function getInstrumentSettings() {
    var instruments = SL.audio.getInstruments();
    return instruments[SL.audio.getCurrentInstrument()].settings;
  }

  /**
   * Get settings for a specific instrument by ID
   * @param {number} instId - Instrument index (0-4)
   * @returns {Object} Instrument's settings object
   */
  function getSettingsForInstrument(instId) {
    var instruments = SL.audio.getInstruments();
    var NUM_INSTRUMENTS = SL.audio.getNumInstruments();
    if (instId < 0 || instId >= NUM_INSTRUMENTS) {
      return instruments[SL.audio.getCurrentInstrument()].settings;
    }
    // Only save UI state when NOT in sequencer playback — saveInstrumentSettings
    // does 30+ DOM queries (querySelectorAll, getElementById) which causes massive
    // stalls when called per-note at bar boundaries with many simultaneous notes.
    if (instId === SL.audio.getCurrentInstrument()) {
      var seqPlaying = SL.sequencer && SL.sequencer.isPlaying && SL.sequencer.isPlaying();
      var chordSeqPlaying = SL.chordSeq && SL.chordSeq.isPlaying && SL.chordSeq.isPlaying();
      if (!seqPlaying && !chordSeqPlaying) {
        saveInstrumentSettings(instId);
      }
    }
    return instruments[instId].settings;
  }

  /**
   * Stop a non-workvar note by fading its gain node and stopping sources.
   */
  function _stopBufferNote(instId, midi) {
    var key = instId + ':' + midi;
    var entries = _activeBufferNotes[key];
    if (!entries || entries.length === 0) { return; }
    var c = SL.audio.getCtx();
    var now = c ? c.currentTime : 0;
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      if (entry.gain) {
        try {
          entry.gain.gain.cancelScheduledValues(now);
          entry.gain.gain.setValueAtTime(entry.gain.gain.value, now);
          entry.gain.gain.linearRampToValueAtTime(0.0001, now + 0.05);
        } catch (e) { /* node may already be disconnected */ }
      }
      if (entry.sources) {
        for (var s = 0; s < entry.sources.length; s++) {
          try { entry.sources[s].stop(now + 0.06); } catch (e) { /* source may already be stopped */ }
        }
      }
    }
    delete _activeBufferNotes[key];
  }

  /**
   * Play a note using a specific instrument's settings
   * Used by sequencer to play notes on their assigned instruments
   * @param {number} midi - MIDI note number
   * @param {number} dur - Duration in seconds
   * @param {number} instId - Instrument index (0-4)
   */
  function playNoteOnInstrument(midi, dur, instId, noteVel) {
    dur = dur || SL.DURATION || 0.4;

    var settings = getSettingsForInstrument(instId);
    var instruments = SL.audio.getInstruments();
    var inst = instruments[instId];

    // Raw velocity — per-voice randomization happens in worklets
    var vel = (typeof noteVel === 'number') ? noteVel : 100;

    // Detect if any sequencer (drum or chord) is playing — used to skip
    // expensive visual feedback and force workvar synthesis mode
    var anySeqPlaying = (SL.sequencer && SL.sequencer.isPlaying && SL.sequencer.isPlaying())
      || (SL.chordSeq && SL.chordSeq.isPlaying && SL.chordSeq.isPlaying());

    // Pre-computed engine availability booleans for dispatch
    var isFmReady = SL.fm && SL.fm.noteOn;
    var isPhysicalReady = SL.physical && SL.physical.noteOn;
    var isAdditiveReady = SL.additive && SL.additive.noteOn;
    var isGranularReady = SL.granular && SL.granular.noteOn;
    var isVocoderSynthReady = SL.vocoderSynth && SL.vocoderSynth.noteOn;
    var isWavefolderReady = SL.wavefolder && SL.wavefolder.noteOn;
    var isFormantReady = SL.formant && SL.formant.noteOn;
    var isModalReady = SL.modal && SL.modal.noteOn;
    var isRingmodReady = SL.ringmod && SL.ringmod.noteOn;
    var isChordReady = SL.chord && SL.chord.noteOn;
    var isSuperwaveReady = SL.superwave && SL.superwave.noteOn;
    var isWavetableReady = SL.wavetableSynth && SL.wavetableSynth.noteOn;
    var isPhasedistReady = SL.phasedist && SL.phasedist.noteOn;
    var isChipReady = SL.chip && SL.chip.noteOn;
    var isBytebeatReady = SL.bytebeat && SL.bytebeat.start;
    var isVectorReady = SL.vector && SL.vector.noteOn;
    var isDrumsynReady = SL.drumsyn && SL.drumsyn.noteOn;
    var isPulsarReady = SL.pulsar && SL.pulsar.noteOn;
    var isReedReady = SL.reed && SL.reed.noteOn;
    var isSamplerReady = SL.sampler && SL.sampler.playPad;

    // LOOP type — no-op for individual note playback (loops are always-on/off)
    if (inst.type === 'loop') {
      // no-op
    } else if (inst.type === 'midiout' && SL.midi) {
      // MIDIOUT type — send MIDI out, no local audio
      if (!anySeqPlaying) {
        SL.audio.highlightNote(midi, true);
        setTimeout(function() { SL.audio.highlightNote(midi, false); }, dur * 1000);
      }
      var moSettings = SL.midi.getMidioutSettings()[instId];
      SL.midi.sendNoteOn(midi, 100, moSettings.channel);
      setTimeout(function() {
        SL.midi.sendNoteOff(midi, moSettings.channel);
      }, dur * 1000);
    } else if (inst.type === 'fm' && isFmReady) {
      // FM synthesis dispatch
      if (!anySeqPlaying) {
        SL.audio.highlightNote(midi, true);
        setTimeout(function() { SL.audio.highlightNote(midi, false); }, dur * 1000);
      }
      SL.fm.noteOn(midi, vel, instId);
      setTimeout(function() {
        if (SL.fm && SL.fm.noteOff) SL.fm.noteOff(midi, instId);
      }, dur * 1000);
    } else if (inst.type === 'physical' && isPhysicalReady) {
      // Physical modelling synthesis dispatch
      if (!anySeqPlaying) {
        SL.audio.highlightNote(midi, true);
        setTimeout(function() { SL.audio.highlightNote(midi, false); }, dur * 1000);
      }
      SL.physical.noteOn(midi, vel, instId);
      setTimeout(function() {
        if (SL.physical && SL.physical.noteOff) SL.physical.noteOff(midi, instId);
      }, dur * 1000);
    } else if (inst.type === 'additive' && isAdditiveReady) {
      // Additive synthesis dispatch
      if (!anySeqPlaying) {
        SL.audio.highlightNote(midi, true);
        setTimeout(function() { SL.audio.highlightNote(midi, false); }, dur * 1000);
      }
      SL.additive.noteOn(midi, vel, instId);
      setTimeout(function() {
        if (SL.additive && SL.additive.noteOff) SL.additive.noteOff(midi, instId);
      }, dur * 1000);
    } else if (inst.type === 'granular' && isGranularReady) {
      // Granular synthesis dispatch
      if (!anySeqPlaying) {
        SL.audio.highlightNote(midi, true);
        setTimeout(function() { SL.audio.highlightNote(midi, false); }, dur * 1000);
      }
      SL.granular.noteOn(midi, vel, instId);
      setTimeout(function() {
        if (SL.granular && SL.granular.noteOff) SL.granular.noteOff(midi, instId);
      }, dur * 1000);
    } else if (inst.type === 'vocoderSynth' && isVocoderSynthReady) {
      // Vocoder synthesis dispatch
      if (!anySeqPlaying) {
        SL.audio.highlightNote(midi, true);
        setTimeout(function() { SL.audio.highlightNote(midi, false); }, dur * 1000);
      }
      SL.vocoderSynth.noteOn(midi, vel, instId);
      setTimeout(function() {
        if (SL.vocoderSynth && SL.vocoderSynth.noteOff) SL.vocoderSynth.noteOff(midi, instId);
      }, dur * 1000);
    } else if (inst.type === 'wavefolder' && isWavefolderReady) {
      // Wavefolder synthesis dispatch
      if (!anySeqPlaying) {
        SL.audio.highlightNote(midi, true);
        setTimeout(function() { SL.audio.highlightNote(midi, false); }, dur * 1000);
      }
      SL.wavefolder.noteOn(midi, vel, instId);
      setTimeout(function() {
        if (SL.wavefolder && SL.wavefolder.noteOff) SL.wavefolder.noteOff(midi, instId);
      }, dur * 1000);
    } else if (inst.type === 'formant' && isFormantReady) {
      // Formant synthesis dispatch
      if (!anySeqPlaying) {
        SL.audio.highlightNote(midi, true);
        setTimeout(function() { SL.audio.highlightNote(midi, false); }, dur * 1000);
      }
      SL.formant.noteOn(midi, vel, instId);
      setTimeout(function() {
        if (SL.formant && SL.formant.noteOff) SL.formant.noteOff(midi, instId);
      }, dur * 1000);
    } else if (inst.type === 'modal' && isModalReady) {
      // Modal synthesis dispatch
      if (!anySeqPlaying) {
        SL.audio.highlightNote(midi, true);
        setTimeout(function() { SL.audio.highlightNote(midi, false); }, dur * 1000);
      }
      SL.modal.noteOn(midi, vel, instId);
      setTimeout(function() {
        if (SL.modal && SL.modal.noteOff) SL.modal.noteOff(midi, instId);
      }, dur * 1000);
    } else if (inst.type === 'ringmod' && isRingmodReady) {
      // Ring modulation synthesis dispatch
      if (!anySeqPlaying) {
        SL.audio.highlightNote(midi, true);
        setTimeout(function() { SL.audio.highlightNote(midi, false); }, dur * 1000);
      }
      SL.ringmod.noteOn(midi, vel, instId);
      setTimeout(function() {
        if (SL.ringmod && SL.ringmod.noteOff) SL.ringmod.noteOff(midi, instId);
      }, dur * 1000);
    } else if (inst.type === 'chord' && isChordReady) {
      // Chord synthesis dispatch
      if (!anySeqPlaying) {
        SL.audio.highlightNote(midi, true);
        setTimeout(function() { SL.audio.highlightNote(midi, false); }, dur * 1000);
      }
      SL.chord.noteOn(midi, vel, instId);
      setTimeout(function() {
        if (SL.chord && SL.chord.noteOff) SL.chord.noteOff(midi, instId);
      }, dur * 1000);
    } else if (inst.type === 'superwave' && isSuperwaveReady) {
      // SuperWave synthesis dispatch
      if (!anySeqPlaying) {
        SL.audio.highlightNote(midi, true);
        setTimeout(function() { SL.audio.highlightNote(midi, false); }, dur * 1000);
      }
      SL.superwave.noteOn(midi, vel, instId);
      setTimeout(function() {
        if (SL.superwave && SL.superwave.noteOff) SL.superwave.noteOff(midi, instId);
      }, dur * 1000);
    } else if (inst.type === 'wavetable' && isWavetableReady) {
      // Wavetable scanning synthesis dispatch
      if (!anySeqPlaying) {
        SL.audio.highlightNote(midi, true);
        setTimeout(function() { SL.audio.highlightNote(midi, false); }, dur * 1000);
      }
      SL.wavetableSynth.noteOn(midi, vel, instId);
      setTimeout(function() {
        if (SL.wavetableSynth && SL.wavetableSynth.noteOff) SL.wavetableSynth.noteOff(midi, instId);
      }, dur * 1000);
    } else if (inst.type === 'phasedist' && isPhasedistReady) {
      // Phase distortion synthesis dispatch
      if (!anySeqPlaying) {
        SL.audio.highlightNote(midi, true);
        setTimeout(function() { SL.audio.highlightNote(midi, false); }, dur * 1000);
      }
      SL.phasedist.noteOn(midi, vel, instId);
      setTimeout(function() {
        if (SL.phasedist && SL.phasedist.noteOff) SL.phasedist.noteOff(midi, instId);
      }, dur * 1000);
    } else if (inst.type === 'chip' && isChipReady) {
      // Chip synth dispatch
      if (!anySeqPlaying) {
        SL.audio.highlightNote(midi, true);
        setTimeout(function() { SL.audio.highlightNote(midi, false); }, dur * 1000);
      }
      SL.chip.noteOn(midi, vel, instId);
      setTimeout(function() {
        if (SL.chip && SL.chip.noteOff) SL.chip.noteOff(midi, instId);
      }, dur * 1000);
    } else if (inst.type === 'bytebeat' && isBytebeatReady) {
      // Bytebeat dispatch (monophonic - start/stop)
      if (!anySeqPlaying) {
        SL.audio.highlightNote(midi, true);
        setTimeout(function() { SL.audio.highlightNote(midi, false); }, dur * 1000);
      }
      SL.bytebeat.start();
      setTimeout(function() {
        if (SL.bytebeat && SL.bytebeat.stop) SL.bytebeat.stop();
      }, dur * 1000);
    } else if (inst.type === 'vector' && isVectorReady) {
      // Vector synthesis dispatch
      if (!anySeqPlaying) {
        SL.audio.highlightNote(midi, true);
        setTimeout(function() { SL.audio.highlightNote(midi, false); }, dur * 1000);
      }
      SL.vector.noteOn(midi, vel, instId);
      setTimeout(function() {
        if (SL.vector && SL.vector.noteOff) SL.vector.noteOff(midi, instId);
      }, dur * 1000);
    } else if (inst.type === 'drumsyn' && isDrumsynReady) {
      // Drum synth dispatch
      if (!anySeqPlaying) {
        SL.audio.highlightNote(midi, true);
        setTimeout(function() { SL.audio.highlightNote(midi, false); }, dur * 1000);
      }
      SL.drumsyn.noteOn(midi, vel, instId);
      setTimeout(function() {
        if (SL.drumsyn && SL.drumsyn.noteOff) SL.drumsyn.noteOff(midi, instId);
      }, dur * 1000);
    } else if (inst.type === 'pulsar' && isPulsarReady) {
      // Pulsar synthesis dispatch
      if (!anySeqPlaying) {
        SL.audio.highlightNote(midi, true);
        setTimeout(function() { SL.audio.highlightNote(midi, false); }, dur * 1000);
      }
      SL.pulsar.noteOn(midi, vel, instId);
      setTimeout(function() {
        if (SL.pulsar && SL.pulsar.noteOff) SL.pulsar.noteOff(midi, instId);
      }, dur * 1000);
    } else if (inst.type === 'reed' && isReedReady) {
      // Reed synthesis dispatch
      if (!anySeqPlaying) {
        SL.audio.highlightNote(midi, true);
        setTimeout(function() { SL.audio.highlightNote(midi, false); }, dur * 1000);
      }
      SL.reed.noteOn(midi, vel, instId);
      setTimeout(function() {
        if (SL.reed && SL.reed.noteOff) SL.reed.noteOff(midi, instId);
      }, dur * 1000);
    } else if (inst.type === 'sampler' && isSamplerReady) {
      // Sampler dispatch — map MIDI note to pad index
      var baseMidi = SL.SEQ_BASE_MIDI || 24;
      var padId = midi - baseMidi;
      var isValidPadIndex = (padId >= 0) && (padId < (SL.sampler.NUM_PADS || 16));
      if (isValidPadIndex) {
        if (!anySeqPlaying) {
          SL.audio.highlightNote(midi, true);
          setTimeout(function() { SL.audio.highlightNote(midi, false); }, dur * 1000);
        }
        SL.sampler.playPad(instId, padId, vel, dur);
      }
    } else {

    var f = SL.audio.m2f(midi);
    if (!_cachedMethodEl) _cachedMethodEl = document.getElementById('method');
    // During any sequencer playback (drum OR chord sequencer), force workvar mode
    // to avoid main-thread synthesis. bandlimited computes waveforms sample-by-sample
    // (e.g. 1.3M samples × 48 harmonics per note), blocking the event loop for seconds.
    var m;
    if (_cachedMethodEl) {
      if (anySeqPlaying && _cachedMethodEl.value === 'bandlimited') {
        if (SL.audio.isWorkletAvailable()) {
          m = 'worklet';
        } else {
          m = 'oscillator';
        }
      } else {
        m = _cachedMethodEl.value;
      }
    }
    var sr = SL.SR || 44100;
    var TWO_PI = SL.TWO_PI || (2 * Math.PI);

    // Convert cached ADSR values (slider values) to seconds
    var adsr = {
      a: SL.audio.sliderToTime(settings.adsr.a, 500, 500) / 1000,
      d: SL.audio.sliderToTime(settings.adsr.d, 500, 500) / 1000,
      s: settings.adsr.s / 100,
      r: SL.audio.sliderToTime(settings.adsr.r, 1000, 1000) / 1000
    };

    // ADSR jitter is now applied per-voice in the worklets

    // Convert cached oscillator settings
    var oscSet = settings.osc.map(function(os) {
      return {
        wave: os.wave,
        oct: os.oct,
        detune: os.detune,
        level: os.level / 100,
        pulseWidth: os.pulseWidth,
        superSawSpread: os.superSawSpread
      };
    });

    // Convert cached filter settings
    var filterSettings = {
      enabled: settings.filter.enabled,
      type: settings.filter.type,
      frequency: SL.audio.sliderToFreq(settings.filter.freq),
      resonance: SL.audio.sliderToQ(settings.filter.q),
      keyTrack: settings.filter.keyTrack / 100,
      model: settings.filter.model,
      slope: settings.filter.slope
    };

    // Convert cached filter envelope settings
    var filterEnvSettings = {
      enabled: settings.filterEnv.enabled,
      amount: settings.filterEnv.amount,
      attack: SL.audio.sliderToTime(settings.filterEnv.a, 2000, 2000) / 1000,
      decay: SL.audio.sliderToTime(settings.filterEnv.d, 2000, 2000) / 1000,
      sustain: settings.filterEnv.s / 100,
      release: SL.audio.sliderToTime(settings.filterEnv.r, 3000, 3000) / 1000,
      link: settings.filterEnv.link
    };

    // Visual feedback — skip during any sequencer playback to avoid DOM thrashing
    if (!anySeqPlaying) {
      SL.audio.highlightNote(midi, true);
      setTimeout(function() { SL.audio.highlightNote(midi, false); }, dur * 1000);
    }

    var c = SL.audio.getCtx();
    var destination = inst.masterOutput || SL.audio.getFinalDestination();

    // AudioWorkvar synthesis
    if (m === 'worklet') {
      if (SL.audio.isWorkletAvailable()) {
        if (!_cachedRefHzEl) _cachedRefHzEl = document.getElementById('refHz');
        var refHz = (_cachedRefHzEl ? parseFloat(_cachedRefHzEl.value) : 440) || 440;

        // Build extra params for worklet
        var extraParams = {};

        // Glide: only for Bass (0) and Lead (1) instruments
        if (instId === 0 || instId === 1) {
          var glideVal = settings.glide || 0;
          if (glideVal > 0) {
            extraParams.glideTime = (glideVal / 100) * 0.5; // 0-100 maps to 0-500ms
          }
        }

        // Pad aftertouch: only for Pad instrument (2)
        if (instId === 2) {
          var pat = settings.padAftertouch;
          if (!pat) {
            pat = SL.audio._DEFAULT_INSTRUMENT_SETTINGS.padAftertouch;
          }
          extraParams.padAftertouch = {
            filterMod: pat.filterMod || 0,
            volumeMod: pat.volumeMod || 0,
            vibrato: pat.vibrato || 0,
            rate: pat.rate || 0.4
          };
        }

        SL.audio.workletNoteOn({ midi: midi, dur: dur, oscSettings: oscSet, adsr: adsr, refHz: refHz, instId: instId, extraParams: extraParams });
      } else {
        console.warn('Workvar not available, falling back to band-limited synthesis');
        var fallbackOpts = {
          midi: midi, dur: dur, adsr: adsr, oscSet: oscSet,
          filterSettings: filterSettings, filterEnvSettings: filterEnvSettings,
          sr: sr, TWO_PI: TWO_PI, c: c, destination: destination
        };
        SL.audio._playNoteFallbackWithDestination(fallbackOpts);
      }
    } else if (m === 'oscillator') {
      var oscDur = Math.min(dur, 30);
      var now = c.currentTime;
      var peak = 0.12;
      var a = adsr.a, d = adsr.d, s = adsr.s, r = adsr.r;
      var sustainEnd = Math.max(a + d, oscDur - r);

      var master = c.createGain();
      master.gain.setValueAtTime(0, now);
      master.gain.linearRampToValueAtTime(peak, now + a);
      master.gain.linearRampToValueAtTime(peak * s, now + a + d);
      master.gain.setValueAtTime(peak * s, now + sustainEnd);
      master.gain.linearRampToValueAtTime(0.001, now + oscDur);

      var keyTrackedFreq = SL.audio.calcKeyTrackedFreq(filterSettings.frequency, f, filterSettings.keyTrack);
      var adjustedFilterSettings = Object.assign({}, filterSettings, { frequency: keyTrackedFreq });

      var filterChain = SL.audio.createFilterChain(c, adjustedFilterSettings);
      if (filterChain) {
        master.connect(filterChain.input);
        filterChain.output.connect(destination);
      } else {
        master.connect(destination);
      }

      var oscSources = [];
      oscSet.forEach(function(os) {
        if (os.level <= 0) return;
        var oscFreq = f * Math.pow(2, os.oct) * Math.pow(2, os.detune / 1200);

        if (os.wave === 'supersaw') {
          var superSawOscs = SL.audio.createSuperSawOscillators(c, oscFreq, os.superSawSpread, master, os.level);
          superSawOscs.forEach(function(osc) {
            osc.start();
            osc.stop(now + oscDur + 0.01);
            oscSources.push(osc);
          });
        } else if (os.wave === 'pulse') {
          var o = c.createOscillator();
          var g = c.createGain();
          var pulseWave = SL.audio.createPulseWave(c, os.pulseWidth);
          o.setPeriodicWave(pulseWave);
          o.frequency.value = oscFreq;
          g.gain.value = os.level;
          o.connect(g);
          g.connect(master);
          o.start();
          o.stop(now + oscDur + 0.01);
          oscSources.push(o);
        } else {
          var o = c.createOscillator();
          o.type = os.wave;
          o.frequency.value = oscFreq;
          var g = c.createGain();
          g.gain.value = os.level;
          o.connect(g);
          g.connect(master);
          o.start();
          o.stop(now + oscDur + 0.01);
          oscSources.push(o);
        }
      });
      // Track for noteOff cleanup
      var oscKey = instId + ':' + midi;
      if (!_activeBufferNotes[oscKey]) { _activeBufferNotes[oscKey] = []; }
      _activeBufferNotes[oscKey].push({ gain: master, sources: oscSources });
    } else if (m === 'bandlimited') {
      // Cap duration to 30s max to prevent enormous buffer allocations
      // (chord sequencer pads/drones pass dur=9999 for sustained notes)
      var blDur = Math.min(dur, 30);
      var n = Math.floor(sr * blDur);
      var b = SL.audio.acquireBuffer(n);
      var envCurve = SL.audio.getEnvelopeCurve(blDur, adsr, sr);
      var WAVETABLE_WAVES = SL.audio._WAVETABLE_WAVES;
      var SUPERSAW_DETUNES = SL.audio._SUPERSAW_DETUNES;

      oscSet.forEach(function(os) {
        if (os.level <= 0) return;
        var oscFreq = f * Math.pow(2, os.oct) * Math.pow(2, os.detune / 1200);

        var hasUsedWavetable = false;
        if (WAVETABLE_WAVES.includes(os.wave) && SL.audio.areWavetablesReady()) {
          var table = SL.audio.getWavetableForFreq(os.wave, oscFreq);
          if (table) {
            var phaseInc = oscFreq / sr;
            var phase = 0;
            for (var i = 0; i < n; i++) {
              var env = envCurve[i];
              var sample = SL.audio.sampleWavetable(table, phase);
              b[i] += sample * env * os.level;
              phase += phaseInc;
              if (phase >= 1) phase -= 1;
            }
            hasUsedWavetable = true;
          }
        }

        if (!hasUsedWavetable) {
        var mH = Math.min(SL.audio.maxH(oscFreq), 48);

        for (var i = 0; i < n; i++) {
          var t = i / sr;
          var ph = TWO_PI * oscFreq * t;
          var env = envCurve[i];
          var sample = 0;

          if (os.wave === 'pulse') {
            var pw = os.pulseWidth / 100;
            for (var h = 1; h <= mH; h++) {
              var harmAmp = (2 / (h * Math.PI)) * SL.audio.fastSin(h * Math.PI * pw);
              sample += harmAmp * SL.audio.fastSin(ph * h);
            }
          } else if (os.wave === 'supersaw') {
            var spreadFactor = os.superSawSpread / 50;
            var sawTable = SL.audio.getWavetableForFreq('sawtooth', oscFreq);

            if (sawTable && SL.audio.areWavetablesReady()) {
              SUPERSAW_DETUNES.forEach(function(detuneCents) {
                var actualDetune = detuneCents * spreadFactor;
                var voiceFreq = oscFreq * Math.pow(2, actualDetune / 1200);
                var voicePhase = ((voiceFreq * t) % 1 + 1) % 1;
                sample += SL.audio.sampleWavetable(sawTable, voicePhase) / SUPERSAW_DETUNES.length;
              });
            } else {
              SUPERSAW_DETUNES.forEach(function(detuneCents) {
                sample += _supersawFallbackVoiceIS(detuneCents, spreadFactor, oscFreq, t, TWO_PI, SUPERSAW_DETUNES.length);
              });
            }
          } else {
            var sg = 1;
            for (var h = 1; h <= mH; h += 2) {
              sample += sg * Math.cos(ph * h) / (h * h);
              sg = -sg;
            }
            sample *= 8 / (Math.PI * Math.PI);
          }

          b[i] += sample * env * os.level;
        }
        } // end if (!hasUsedWavetable)
      });

      var ab = c.createBuffer(1, n, sr);
      ab.copyToChannel(b, 0);
      SL.audio.releaseBuffer(b);
      var src = c.createBufferSource();
      var g = c.createGain();
      g.gain.value = 0.12;
      src.buffer = ab;
      src.connect(g);

      var keyTrackedFreq = SL.audio.calcKeyTrackedFreq(filterSettings.frequency, f, filterSettings.keyTrack);
      var adjustedFilterSettings = Object.assign({}, filterSettings, { frequency: keyTrackedFreq });

      var filterChain = SL.audio.createFilterChain(c, adjustedFilterSettings);
      if (filterChain) {
        g.connect(filterChain.input);
        filterChain.output.connect(destination);
        SL.audio.applyFilterEnvelope(filterChain, f, adjustedFilterSettings, filterEnvSettings, c);
      } else {
        g.connect(destination);
      }

      src.start();
      // Track for noteOff cleanup
      var blKey = instId + ':' + midi;
      if (!_activeBufferNotes[blKey]) { _activeBufferNotes[blKey] = []; }
      _activeBufferNotes[blKey].push({ gain: g, sources: [src] });

    } else {
      // PolyBLEP synthesis
      var pbDur = Math.min(dur, 30);
      var n = Math.floor(sr * pbDur);
      var b = SL.audio.acquireBuffer(n);
      var envCurve = SL.audio.getEnvelopeCurve(pbDur, adsr, sr);
      var SUPERSAW_DETUNES = SL.audio._SUPERSAW_DETUNES;

      oscSet.forEach(function(os) {
        if (os.level <= 0) return;
        var oscFreq = f * Math.pow(2, os.oct) * Math.pow(2, os.detune / 1200);
        var dt = oscFreq / sr;

        for (var i = 0; i < n; i++) {
          var t = i / sr;
          var ph = TWO_PI * oscFreq * t;
          var phase = (t * oscFreq) % 1;
          var env = envCurve[i];
          var sample = 0;

          if (os.wave === 'sine') {
            sample = SL.audio.fastSin(ph);
          } else if (os.wave === 'square') {
            sample = SL.audio.polyBlepSquare(phase, dt);
          } else if (os.wave === 'sawtooth') {
            sample = SL.audio.polyBlepSaw(phase, dt);
          } else if (os.wave === 'triangle') {
            sample = SL.audio.polyBlepTriangle(phase, dt);
          } else if (os.wave === 'pulse') {
            var pw = os.pulseWidth / 100;
            sample = SL.audio.polyBlepPulse(phase, dt, pw);
          } else if (os.wave === 'supersaw') {
            var spreadFactor = os.superSawSpread / 50;
            SUPERSAW_DETUNES.forEach(function(detuneCents) {
              var actualDetune = detuneCents * spreadFactor;
              var voiceFreq = oscFreq * Math.pow(2, actualDetune / 1200);
              var voiceDt = voiceFreq / sr;
              var voicePhase = (t * voiceFreq) % 1;
              var voiceSample = SL.audio.polyBlepSaw(voicePhase, voiceDt);
              sample += voiceSample / SUPERSAW_DETUNES.length;
            });
          } else {
            sample = SL.audio.polyBlepTriangle(phase, dt);
          }

          b[i] += sample * env * os.level;
        }
      });

      var ab = c.createBuffer(1, n, sr);
      ab.copyToChannel(b, 0);
      SL.audio.releaseBuffer(b);
      var src = c.createBufferSource();
      var g = c.createGain();
      g.gain.value = 0.12;
      src.buffer = ab;
      src.connect(g);

      var keyTrackedFreq = SL.audio.calcKeyTrackedFreq(filterSettings.frequency, f, filterSettings.keyTrack);
      var adjustedFilterSettings = Object.assign({}, filterSettings, { frequency: keyTrackedFreq });

      var filterChain = SL.audio.createFilterChain(c, adjustedFilterSettings);
      if (filterChain) {
        g.connect(filterChain.input);
        filterChain.output.connect(destination);
        SL.audio.applyFilterEnvelope(filterChain, f, adjustedFilterSettings, filterEnvSettings, c);
      } else {
        g.connect(destination);
      }

      src.start();
      // Track for noteOff cleanup
      var pbKey = instId + ':' + midi;
      if (!_activeBufferNotes[pbKey]) { _activeBufferNotes[pbKey] = []; }
      _activeBufferNotes[pbKey].push({ gain: g, sources: [src] });
    }
    } // end else (default synthesis path)
  }

  /**
   * Save current UI control values to the specified instrument's settings cache
   * @param {number} instId - Instrument index (0-4)
   */
  function saveInstrumentSettings(instId) {
    var instruments = SL.audio.getInstruments();
    var NUM_INSTRUMENTS = SL.audio.getNumInstruments();
    if (instId < 0 || instId >= NUM_INSTRUMENTS) return;

    var inst = instruments[instId];
    var settings = inst.settings;

    // Save oscillator settings from UI — only if DOM elements are present.
    // When the Tweak/Shape screen is not active (e.g. user is on Play screen),
    // these DOM elements do not exist. Writing defaults would clobber the
    // in-memory settings that the user set on the Shape screen.
    for (var n = 1; n <= 3; n++) {
      var inlineWave = document.querySelector('.osc-wave[data-osc="' + n + '"]');
      var inlineOct = document.querySelector('.osc-oct[data-osc="' + n + '"]');
      var inlineDetune = document.querySelector('.osc-detune[data-osc="' + n + '"]');
      var inlineLevel = document.querySelector('.osc-level[data-osc="' + n + '"]');
      var modalPw = document.querySelector('.osc-pw-lg[data-osc="' + n + '"]');
      var modalSpread = document.querySelector('.osc-spread-lg[data-osc="' + n + '"]');
      var inlineFine = document.querySelector('.osc-fine[data-osc="' + n + '"]');

      var oscDomPresent = inlineWave || inlineOct || inlineDetune || inlineLevel;
      if (oscDomPresent) {
        settings.osc[n - 1] = {
          wave: inlineWave ? inlineWave.value : 'sine',
          oct: inlineOct ? parseInt(inlineOct.value) || 0 : 0,
          detune: inlineDetune ? parseFloat(inlineDetune.value) || 0 : 0,
          fine: inlineFine ? parseFloat(inlineFine.value) || 0 : 0,
          level: inlineLevel ? parseFloat(inlineLevel.value) : 80,
          pulseWidth: modalPw ? parseFloat(modalPw.value) : 50,
          superSawSpread: modalSpread ? parseFloat(modalSpread.value) : 50
        };
      }
    }

    // Save ADSR — only if DOM elements are present.
    // In SSLI the Shape screen writes directly to inst.settings.adsr;
    // these legacy DOM IDs only exist when the SSLU Tweak panel is rendered.
    var adsrAEl = document.getElementById('adsrA');
    var adsrDEl = document.getElementById('adsrD');
    var adsrSEl = document.getElementById('adsrS');
    var adsrREl = document.getElementById('adsrR');
    var adsrDomPresent = adsrAEl || adsrDEl || adsrSEl || adsrREl;
    if (adsrDomPresent) {
      var adsrA;
      if (adsrAEl) {
        adsrA = parseFloat(adsrAEl.value) || 10;
      } else if (settings.adsr) {
        adsrA = settings.adsr.a;
      } else {
        adsrA = 10;
      }
      var adsrD;
      if (adsrDEl) {
        adsrD = parseFloat(adsrDEl.value) || 100;
      } else if (settings.adsr) {
        adsrD = settings.adsr.d;
      } else {
        adsrD = 100;
      }
      var adsrS;
      if (adsrSEl) {
        adsrS = parseFloat(adsrSEl.value) || 70;
      } else if (settings.adsr) {
        adsrS = settings.adsr.s;
      } else {
        adsrS = 70;
      }
      var adsrR;
      if (adsrREl) {
        adsrR = parseFloat(adsrREl.value) || 200;
      } else if (settings.adsr) {
        adsrR = settings.adsr.r;
      } else {
        adsrR = 200;
      }
      settings.adsr = {
        a: adsrA,
        d: adsrD,
        s: adsrS,
        r: adsrR
      };
    }

    // Save filter settings — only if DOM elements are present.
    // In SSLI the Shape screen writes directly to inst.settings.filter;
    // these legacy DOM IDs only exist when the SSLU panel is rendered.
    var filterEnabled = document.getElementById('filterEnabled');
    var filterType = document.getElementById('filterType');
    var filterFreq = document.getElementById('filterFreq');
    var filterQ = document.getElementById('filterQ');
    var filterKeyTrack = document.getElementById('filterKeyTrack');
    var filterModel = document.getElementById('filterModel');
    var filterSlopeRadio = document.querySelector('input[name="filterSlope"]:checked');

    var filterDomPresent = filterType || filterFreq || filterQ || filterEnabled;
    if (filterDomPresent) {
      settings.filter = {
        enabled: filterEnabled ? filterEnabled.checked : true,
        type: filterType ? filterType.value : 'lowpass',
        freq: filterFreq ? parseFloat(filterFreq.value) : 850,
        q: filterQ ? parseFloat(filterQ.value) : 10,
        keyTrack: filterKeyTrack ? parseFloat(filterKeyTrack.value) : 0,
        model: filterModel ? filterModel.value : 'butterworth',
        slope: filterSlopeRadio ? parseInt(filterSlopeRadio.value) : 24
      };
    }

    // Save noise settings — only if DOM elements are present.
    var noiseType = document.getElementById('noiseType');
    var noiseLevel = document.getElementById('noiseLevel');

    var noiseDomPresent = noiseType || noiseLevel;
    if (noiseDomPresent) {
      settings.noise = {
        type: noiseType ? noiseType.value : 'white',
        level: noiseLevel ? parseFloat(noiseLevel.value) : 0
      };
    }

    // Save filter envelope settings — only if DOM elements are present.
    var filterEnvEnabled = document.getElementById('filterEnvEnabled');
    var filterEnvAmount = document.getElementById('filterEnvAmount');
    var filterEnvA = document.getElementById('filterEnvA');
    var filterEnvD = document.getElementById('filterEnvD');
    var filterEnvS = document.getElementById('filterEnvS');
    var filterEnvR = document.getElementById('filterEnvR');
    var filterEnvLink = document.getElementById('filterEnvLinkToAmp');

    var filterEnvDomPresent = filterEnvEnabled || filterEnvAmount || filterEnvA || filterEnvD;
    if (filterEnvDomPresent) {
      settings.filterEnv = {
        enabled: filterEnvEnabled ? filterEnvEnabled.checked : false,
        amount: filterEnvAmount ? parseFloat(filterEnvAmount.value) : 24,
        a: filterEnvA ? parseFloat(filterEnvA.value) : 200,
        d: filterEnvD ? parseFloat(filterEnvD.value) : 600,
        s: filterEnvS ? parseFloat(filterEnvS.value) : 0,
        r: filterEnvR ? parseFloat(filterEnvR.value) : 775,
        link: filterEnvLink ? filterEnvLink.checked : false
      };
    }

    // Save LFO settings
    var lfoSettings = settings.lfo;
    if (!lfoSettings) {
      lfoSettings = JSON.parse(JSON.stringify(SL.audio._DEFAULT_INSTRUMENT_SETTINGS.lfo));
      settings.lfo = lfoSettings;
    }
    [1, 2].forEach(function(n) {
      var key = 'lfo' + n;
      var enabledEl = document.getElementById('lfo' + n + 'Enabled');
      var rateEl = document.getElementById('lfo' + n + 'Rate');
      var depthEl = document.getElementById('lfo' + n + 'Depth');
      var waveformEl = document.getElementById('lfo' + n + 'Waveform');
      var targetEl = document.getElementById('lfo' + n + 'Target');
      if (enabledEl) lfoSettings[key].enabled = enabledEl.checked;
      if (rateEl) lfoSettings[key].rate = parseFloat(rateEl.value) || 2.0;
      if (depthEl) lfoSettings[key].depth = parseFloat(depthEl.value) || 50;
      if (waveformEl) lfoSettings[key].waveform = waveformEl.value || 'sine';
      if (targetEl) lfoSettings[key].target = targetEl.value || 'none';
    });

    // Save Mod Matrix settings
    if (SL.audio.modMatrix) {
      var mmSlots = SL.audio.modMatrix.getSettings(instId);
      var mmNumSlots = SL.audio.modMatrix.NUM_SLOTS || 8;
      if (!settings.modMatrix) {
        settings.modMatrix = [];
      }
      for (var mmIdx = 0; mmIdx < mmNumSlots; mmIdx++) {
        var mmEnableEl = document.getElementById('modMatrixEnable' + mmIdx);
        var mmSourceEl = document.getElementById('modMatrixSource' + mmIdx);
        var mmDestEl = document.getElementById('modMatrixDest' + mmIdx);
        var mmAmountEl = document.getElementById('modMatrixAmount' + mmIdx);
        if (!settings.modMatrix[mmIdx]) {
          settings.modMatrix[mmIdx] = { enabled: false, source: 'none', destination: 'none', amount: 0 };
        }
        if (mmEnableEl) settings.modMatrix[mmIdx].enabled = mmEnableEl.checked;
        if (mmSourceEl) settings.modMatrix[mmIdx].source = mmSourceEl.value || 'none';
        if (mmDestEl) settings.modMatrix[mmIdx].destination = mmDestEl.value || 'none';
        if (mmAmountEl) settings.modMatrix[mmIdx].amount = parseInt(mmAmountEl.value) || 0;
      }
    }

    // Save FM settings
    var fmAlgoEl = document.getElementById('fmAlgorithm');
    var fmFeedbackEl = document.getElementById('fmFeedback');
    if (fmAlgoEl || fmFeedbackEl) {
      if (!settings.fmSettings) {
        settings.fmSettings = JSON.parse(JSON.stringify(SL.audio._DEFAULT_INSTRUMENT_SETTINGS.fmSettings));
      }
      if (fmAlgoEl) settings.fmSettings.algorithm = parseInt(fmAlgoEl.value) || 1;
      if (fmFeedbackEl) settings.fmSettings.feedback = parseInt(fmFeedbackEl.value) || 0;
    }

    // Save physical modelling settings
    var physModelEl = document.getElementById('physicalModel');
    if (physModelEl) {
      if (!settings.physicalSettings) {
        settings.physicalSettings = JSON.parse(JSON.stringify(SL.audio._DEFAULT_INSTRUMENT_SETTINGS.physicalSettings));
      }
      settings.physicalSettings.model = physModelEl.value || 'pluck';
      var physParamNames = ['damping', 'brightness', 'bodySize', 'decayTime', 'bowPressure', 'bowPosition', 'breathPressure', 'embouchure', 'strikePosition', 'hardness'];
      physParamNames.forEach(function(name) {
        var el = document.getElementById('physical_' + name);
        if (el) settings.physicalSettings[name] = parseFloat(el.value) || 50;
      });
      var excitationEl = document.getElementById('physical_excitation');
      if (excitationEl) settings.physicalSettings.excitation = excitationEl.value || 'noise';
      var materialEl = document.getElementById('physical_material');
      if (materialEl) settings.physicalSettings.material = materialEl.value || 'metal';
    }

    // Save additive synthesis settings
    if (SL.additive) {
      var addSettings = SL.additive.getSettings(instId);
      if (addSettings) {
        settings.additiveSettings = addSettings;
      }
      // Also save drawbar mode toggle and drawbar values from UI
      var drawbarModeEl = document.getElementById('additiveDrawbarMode');
      if (drawbarModeEl) {
        if (!settings.additiveSettings) {
          settings.additiveSettings = JSON.parse(JSON.stringify(SL.audio._DEFAULT_INSTRUMENT_SETTINGS.additiveSettings));
        }
        settings.additiveSettings.drawbarMode = drawbarModeEl.checked;
      }
      // Save partial amplitudes from UI sliders
      for (var pi = 0; pi < 16; pi++) {
        var partialEl = document.getElementById('additivePartial' + pi);
        var hasAdditivePartials = (settings.additiveSettings && settings.additiveSettings.partials && settings.additiveSettings.partials[pi]);
        var canSavePartial = (partialEl && hasAdditivePartials);
        if (canSavePartial) {
          settings.additiveSettings.partials[pi].amplitude = parseFloat(partialEl.value) / 100;
        }
      }
      // Save drawbar values from UI sliders
      for (var di = 0; di < 9; di++) {
        var drawbarEl = document.getElementById('additiveDrawbar' + di);
        var hasAdditiveDrawbars = (settings.additiveSettings && settings.additiveSettings.drawbars);
        var canSaveDrawbar = (drawbarEl && hasAdditiveDrawbars);
        if (canSaveDrawbar) {
          settings.additiveSettings.drawbars[di] = parseInt(drawbarEl.value) || 0;
        }
      }
    }

    // Save granular synthesis settings
    if (SL.granular) {
      var granSettings = SL.granular.getSettings(instId);
      if (granSettings) {
        settings.granularSettings = granSettings;
      }
      // Also save UI slider values
      var granSourceEl = document.getElementById('granularSource');
      if (granSourceEl) {
        if (!settings.granularSettings) {
          settings.granularSettings = JSON.parse(JSON.stringify(SL.audio._DEFAULT_INSTRUMENT_SETTINGS.granularSettings));
        }
        settings.granularSettings.sourceWaveform = granSourceEl.value;
      }
      var granSizeEl = document.getElementById('granularGrainSize');
      if (granSizeEl && settings.granularSettings) {
        settings.granularSettings.grainSize = parseInt(granSizeEl.value) || 50;
      }
      var granDensityEl = document.getElementById('granularDensity');
      if (granDensityEl && settings.granularSettings) {
        settings.granularSettings.density = parseInt(granDensityEl.value) || 10;
      }
      var granPitchEl = document.getElementById('granularPitchScatter');
      if (granPitchEl && settings.granularSettings) {
        settings.granularSettings.pitchScatter = parseInt(granPitchEl.value) || 0;
      }
      var granPosScatEl = document.getElementById('granularPosScatter');
      if (granPosScatEl && settings.granularSettings) {
        settings.granularSettings.positionScatter = parseInt(granPosScatEl.value) || 0;
      }
      var granWindowEl = document.getElementById('granularWindow');
      if (granWindowEl && settings.granularSettings) {
        settings.granularSettings.windowShape = granWindowEl.value;
      }
      var granPosEl = document.getElementById('granularPosition');
      if (granPosEl && settings.granularSettings) {
        settings.granularSettings.position = parseInt(granPosEl.value) || 50;
      }
      // Save freeze state from engine
      if (SL.granular.isFreeze) {
        if (!settings.granularSettings) {
          settings.granularSettings = JSON.parse(JSON.stringify(SL.audio._DEFAULT_INSTRUMENT_SETTINGS.granularSettings));
        }
        settings.granularSettings.freeze = SL.granular.isFreeze(instId);
      }
    }

    // Save vocoder synth settings
    if (SL.vocoderSynth) {
      var vocSettings = SL.vocoderSynth.getSettings(instId);
      if (vocSettings) {
        settings.vocoderSynthSettings = vocSettings;
      }
      var vocCarrierEl = document.getElementById('vocoderSynthCarrier');
      if (vocCarrierEl) {
        if (!settings.vocoderSynthSettings) {
          settings.vocoderSynthSettings = JSON.parse(JSON.stringify(SL.audio._DEFAULT_INSTRUMENT_SETTINGS.vocoderSynthSettings));
        }
        settings.vocoderSynthSettings.carrierWaveform = vocCarrierEl.value;
      }
      var vocMorphEl = document.getElementById('vocoderSynthMorph');
      if (vocMorphEl && settings.vocoderSynthSettings) {
        settings.vocoderSynthSettings.morphPosition = parseInt(vocMorphEl.value) || 0;
      }
      var vocFormantShiftEl = document.getElementById('vocoderSynthFormantShift');
      if (vocFormantShiftEl && settings.vocoderSynthSettings) {
        settings.vocoderSynthSettings.formantShift = parseInt(vocFormantShiftEl.value) || 0;
      }
      var vocFilterQEl = document.getElementById('vocoderSynthFilterQ');
      if (vocFilterQEl && settings.vocoderSynthSettings) {
        settings.vocoderSynthSettings.filterQ = parseInt(vocFilterQEl.value) || 8;
      }
    }

    // Save wavefolder settings
    if (SL.wavefolder) {
      var wfSettings = SL.wavefolder.getSettings(instId);
      if (wfSettings) {
        settings.wavefoldSettings = wfSettings;
      }
      var wfSourceEl = document.getElementById('wavefoldSource');
      if (wfSourceEl) {
        if (!settings.wavefoldSettings) {
          settings.wavefoldSettings = JSON.parse(JSON.stringify(SL.audio._DEFAULT_INSTRUMENT_SETTINGS.wavefoldSettings));
        }
        settings.wavefoldSettings.source = wfSourceEl.value;
      }
      var wfFoldEl = document.getElementById('wavefoldAmount');
      if (wfFoldEl && settings.wavefoldSettings) {
        settings.wavefoldSettings.foldAmount = parseFloat(wfFoldEl.value) || 4;
      }
      var wfSymEl = document.getElementById('wavefoldSymmetry');
      if (wfSymEl && settings.wavefoldSettings) {
        settings.wavefoldSettings.symmetry = parseInt(wfSymEl.value) || 50;
      }
      var wfBiasEl = document.getElementById('wavefoldBias');
      if (wfBiasEl && settings.wavefoldSettings) {
        settings.wavefoldSettings.bias = parseInt(wfBiasEl.value) || 0;
      }
      var wfGainEl = document.getElementById('wavefoldPreGain');
      if (wfGainEl && settings.wavefoldSettings) {
        settings.wavefoldSettings.preGain = parseFloat(wfGainEl.value) || 1.0;
      }
    }

    // Save formant settings
    if (SL.formant) {
      var fmtSettings = SL.formant.getSettings(instId);
      if (fmtSettings) {
        settings.formantSettings = fmtSettings;
      }
      var fmtMorphEl = document.getElementById('formantMorph');
      if (fmtMorphEl) {
        if (!settings.formantSettings) {
          settings.formantSettings = JSON.parse(JSON.stringify(SL.audio._DEFAULT_INSTRUMENT_SETTINGS.formantSettings));
        }
        settings.formantSettings.morphX = parseInt(fmtMorphEl.value) || 0;
      }
      var fmtShiftEl = document.getElementById('formantShift');
      if (fmtShiftEl && settings.formantSettings) {
        settings.formantSettings.formantShift = parseInt(fmtShiftEl.value) || 0;
      }
      var fmtBreathEl = document.getElementById('formantBreathiness');
      if (fmtBreathEl && settings.formantSettings) {
        settings.formantSettings.breathiness = parseInt(fmtBreathEl.value) || 15;
      }
      var fmtGlottalEl = document.getElementById('formantGlottalPW');
      if (fmtGlottalEl && settings.formantSettings) {
        settings.formantSettings.glottalPulseWidth = parseInt(fmtGlottalEl.value) || 50;
      }
      // Save active vowel from buttons
      var fmtVowelBtns = document.querySelectorAll('.formant-vowel-btn.active');
      if (fmtVowelBtns.length > 0 && settings.formantSettings) {
        settings.formantSettings.vowel = fmtVowelBtns[0].dataset.vowel || 'A';
      }
    }

    // Save modal settings
    if (SL.modal) {
      var mdlSettings = SL.modal.getSettings(instId);
      if (mdlSettings) {
        settings.modalSettings = mdlSettings;
      }
      var mdlMaterialEl = document.getElementById('modalMaterial');
      if (mdlMaterialEl) {
        if (!settings.modalSettings) {
          settings.modalSettings = JSON.parse(JSON.stringify(SL.audio._DEFAULT_INSTRUMENT_SETTINGS.modalSettings));
        }
        settings.modalSettings.material = mdlMaterialEl.value || 'bell';
      }
      var mdlExcitationEl = document.getElementById('modalExcitation');
      if (mdlExcitationEl && settings.modalSettings) {
        settings.modalSettings.excitation = mdlExcitationEl.value || 'mallet';
      }
      var mdlHardnessEl = document.getElementById('modalMalletHardness');
      if (mdlHardnessEl && settings.modalSettings) {
        settings.modalSettings.malletHardness = parseInt(mdlHardnessEl.value) || 60;
      }
      var mdlDampingEl = document.getElementById('modalDamping');
      if (mdlDampingEl && settings.modalSettings) {
        settings.modalSettings.damping = parseInt(mdlDampingEl.value) || 30;
      }
      var mdlBrightnessEl = document.getElementById('modalBrightness');
      if (mdlBrightnessEl && settings.modalSettings) {
        settings.modalSettings.brightness = parseInt(mdlBrightnessEl.value) || 65;
      }
      var mdlBodySizeEl = document.getElementById('modalBodySize');
      if (mdlBodySizeEl && settings.modalSettings) {
        settings.modalSettings.bodySize = parseInt(mdlBodySizeEl.value) || 50;
      }
      var mdlInharmEl = document.getElementById('modalInharmonicity');
      if (mdlInharmEl && settings.modalSettings) {
        settings.modalSettings.inharmonicity = parseInt(mdlInharmEl.value) || 50;
      }
    }

    // Save ringmod settings
    if (SL.ringmod) {
      var rmSettings = SL.ringmod.getSettings(instId);
      if (rmSettings) {
        settings.ringmodSettings = rmSettings;
      }
    }

    // Save chord settings
    if (SL.chord) {
      var chSettings = SL.chord.getSettings(instId);
      if (chSettings) {
        settings.chordSettings = chSettings;
      }
    }

    // Save superwave settings
    if (SL.superwave) {
      var swSettings = SL.superwave.getSettings(instId);
      if (swSettings) {
        settings.superwaveSettings = swSettings;
      }
    }

    // Save wavetable settings
    if (SL.wavetableSynth) {
      var wtSettings = SL.wavetableSynth.getSettings(instId);
      if (wtSettings) {
        settings.wavetableSettings = wtSettings;
      }
    }

    // Save phasedist settings
    if (SL.phasedist) {
      var pdSettings = SL.phasedist.getSettings(instId);
      if (pdSettings) {
        settings.phasedistSettings = pdSettings;
      }
    }

    // Save chip settings
    if (SL.chip) {
      var chipSettings = SL.chip.getSettings(instId);
      if (chipSettings) {
        settings.chipSettings = chipSettings;
      }
    }

    // Save bytebeat settings
    if (SL.bytebeat) {
      var bbSettings = SL.bytebeat.getSettings();
      if (bbSettings) {
        settings.bytebeatSettings = bbSettings;
      }
    }

    // Save vector settings
    if (SL.vector) {
      var vecSettings = SL.vector.getSettings(instId);
      if (vecSettings) {
        settings.vectorSettings = vecSettings;
      }
    }

    // Save drum synth settings
    if (SL.drumsyn) {
      var dsSettings = SL.drumsyn.getSettings(instId);
      if (dsSettings) {
        settings.drumsynSettings = dsSettings;
      }
    }

    // Save pulsar settings
    if (SL.pulsar) {
      var plsSettings = SL.pulsar.getSettings(instId);
      if (plsSettings) {
        settings.pulsarSettings = plsSettings;
      }
    }


    // Save reed settings
    if (SL.reed) {
      var reedSettings = SL.reed.getSettings(instId);
      if (reedSettings) {
        settings.reedSettings = reedSettings;
      }
    }

    // Save body resonance settings
    if (SL.bodyResonance) {
      var brSettings = SL.bodyResonance.getSettings(instId);
      if (brSettings) {
        settings.bodyResonanceSettings = brSettings;
      }
    }

    // Save volume
    var volSlider = document.getElementById('instrumentVolume');
    if (volSlider) {
      settings.volume = parseFloat(volSlider.value);
    }

    // Humanization (4 sliders)
    var humVel = document.getElementById('humVelocity');
    var humTime = document.getElementById('humTiming');
    var humAdsr = document.getElementById('humAdsr');
    var humDrift = document.getElementById('humDrift');
    settings.humanization = {
      velocity: humVel ? parseInt(humVel.value) : 0,
      timing: humTime ? parseInt(humTime.value) : 0,
      adsr: humAdsr ? parseInt(humAdsr.value) : 0,
      drift: humDrift ? parseInt(humDrift.value) : 0
    };

    var humStrum = document.getElementById('humStrum');
    settings.strum = humStrum ? parseInt(humStrum.value) : 0;

    var strumDirEl = document.getElementById('strumDir');
    settings.strumDir = strumDirEl ? strumDirEl.value : 'up';
    var strumRepeatEl = document.getElementById('strumRepeat');
    settings.strumRepeat = strumRepeatEl ? parseInt(strumRepeatEl.value) : 0;

    // Save glide setting
    var glideEl = document.getElementById('glideAmount');
    if (glideEl) {
      settings.glide = parseInt(glideEl.value) || 0;
    }

    // Save pad aftertouch settings from UI
    var pfmEl = document.getElementById('padFilterMod');
    var pvmEl = document.getElementById('padVolumeMod');
    var pvibEl = document.getElementById('padVibrato');
    var prateEl = document.getElementById('padLfoRate');
    var hasAnyPadAftertouchEl = pfmEl || pvmEl || pvibEl || prateEl;
    if (hasAnyPadAftertouchEl) {
      settings.padAftertouch = {
        filterMod: pfmEl ? parseInt(pfmEl.value) : 20,
        volumeMod: pvmEl ? parseInt(pvmEl.value) : 10,
        vibrato: pvibEl ? parseInt(pvibEl.value) : 5,
        rate: prateEl ? parseInt(prateEl.value) / 100 : 0.4
      };
    } else if (settings.padAftertouch === undefined) {
      settings.padAftertouch = JSON.parse(JSON.stringify(SL.audio._DEFAULT_INSTRUMENT_SETTINGS.padAftertouch));
    }

    // Save loop settings (instrument 4 is the dedicated loop instrument)
    if (instId === 4 && SL.loop) {
      var lfoSt = SL.loop.getLfoState();
      var filterSt = SL.loop.getFilterState();
      var lfo2St = SL.loop.getLfo2State();
      var fadeSt = SL.loop.getFadeState();
      settings.loopSettings = {
        textureName: SL.loop.getTextureName(),
        volume: SL.loop.getVolume ? SL.loop.getVolume() : 0.3,
        playing: SL.loop.isPlaying(),
        lfoRate: lfoSt.rate,
        lfoDepth: lfoSt.depth,
        lfoShape: lfoSt.shape,
        filterType: filterSt.type,
        filterFreq: filterSt.freq,
        filterQ: filterSt.q,
        lfo2Rate: lfo2St.rate,
        lfo2Depth: lfo2St.depth,
        lfo2Shape: lfo2St.shape,
        fadeIn: fadeSt.fadeIn,
        fadeOut: fadeSt.fadeOut
      };
    }

    // Save arpeggiator settings
    if (SL.arp) {
      settings.arpSettings = SL.arp.getSettings();
    }

    // Save polyrhythm settings
    if (SL.sequencer && SL.sequencer.isPolyrhythmEnabled) {
      settings.polyrhythm = {
        enabled: SL.sequencer.isPolyrhythmEnabled(),
        stepCount: SL.sequencer.getInstStepCounts ? SL.sequencer.getInstStepCounts()[instId] : 16
      };
    }

    // Save MIDIOUT settings
    if (SL.midi && SL.midi.getMidioutSettings) {
      var moSettings = SL.midi.getMidioutSettings()[instId];
      if (moSettings) {
        settings.midioutSettings = {
          channel: moSettings.channel,
          velCurve: moSettings.velCurve,
          program: moSettings.program
        };
      }
    }

    // Save effect chain state
    if (inst.effectChain) {
      settings.effects = {
        chainOrder: inst.effectChain.getOrder(),
        masterMix: inst.effectChain.getMasterMix(),
        enabled: {},
        params: {}
      };
      inst.effectChain.getRegisteredEffects().forEach(function(name) {
        var effect = inst.effectChain.effects.get(name);
        if (effect) {
          settings.effects.enabled[name] = effect.enabled;
          settings.effects.params[name] = Object.assign({}, effect.params, { enabled: undefined });
        }
      });
    }

  }

  /**
   * Load the specified instrument's settings into the UI controls
   * @param {number} instId - Instrument index (0-4)
   */
  function loadInstrumentSettings(instId) {
    var instruments = SL.audio.getInstruments();
    var NUM_INSTRUMENTS = SL.audio.getNumInstruments();
    if (instId < 0 || instId >= NUM_INSTRUMENTS) return;

    var inst = instruments[instId];
    var settings = inst.settings;

    // Load oscillator settings to UI
    for (var n = 1; n <= 3; n++) {
      var osc = settings.osc[n - 1];

      var inlineWave = document.querySelector('.osc-wave[data-osc="' + n + '"]');
      var inlineOct = document.querySelector('.osc-oct[data-osc="' + n + '"]');
      var inlineDetune = document.querySelector('.osc-detune[data-osc="' + n + '"]');
      var inlineDetuneVal = document.querySelector('.osc-detune-val[data-osc="' + n + '"]');
      var inlineLevel = document.querySelector('.osc-level[data-osc="' + n + '"]');
      var inlineLevelVal = document.querySelector('.osc-level-val[data-osc="' + n + '"]');

      if (inlineWave) inlineWave.value = osc.wave;
      if (inlineOct) inlineOct.value = osc.oct;
      if (inlineDetune) inlineDetune.value = osc.detune;
      if (inlineDetuneVal) inlineDetuneVal.textContent = osc.detune + ' ct';
      if (inlineLevel) inlineLevel.value = osc.level;
      if (inlineLevelVal) inlineLevelVal.textContent = osc.level + '%';

      var inlineFine = document.querySelector('.osc-fine[data-osc="' + n + '"]');
      var fineValue = (osc.fine !== undefined) ? osc.fine : 0;
      if (inlineFine) inlineFine.value = fineValue;

      var modalPw = document.querySelector('.osc-pw-lg[data-osc="' + n + '"]');
      var modalPwVal = document.querySelector('.osc-pw-val-lg[data-osc="' + n + '"]');
      var modalSpread = document.querySelector('.osc-spread-lg[data-osc="' + n + '"]');
      var modalSpreadVal = document.querySelector('.osc-spread-val-lg[data-osc="' + n + '"]');

      if (modalPw) modalPw.value = osc.pulseWidth;
      if (modalPwVal) modalPwVal.textContent = osc.pulseWidth + '%';
      if (modalSpread) modalSpread.value = osc.superSawSpread;
      if (modalSpreadVal) modalSpreadVal.textContent = osc.superSawSpread + '%';
    }

    // Load ADSR
    var adsrA = document.getElementById('adsrA');
    var adsrD = document.getElementById('adsrD');
    var adsrS = document.getElementById('adsrS');
    var adsrR = document.getElementById('adsrR');
    var valA = document.getElementById('valA');
    var valD = document.getElementById('valD');
    var valS = document.getElementById('valS');
    var valR = document.getElementById('valR');

    if (adsrA) adsrA.value = settings.adsr.a;
    if (adsrD) adsrD.value = settings.adsr.d;
    if (adsrS) adsrS.value = settings.adsr.s;
    if (adsrR) adsrR.value = settings.adsr.r;
    if (valA) valA.textContent = SL.audio.sliderToTime(settings.adsr.a, 500, 500) + 'ms';
    if (valD) valD.textContent = SL.audio.sliderToTime(settings.adsr.d, 500, 500) + 'ms';
    if (valS) valS.textContent = settings.adsr.s + '%';
    if (valR) valR.textContent = SL.audio.sliderToTime(settings.adsr.r, 1000, 1000) + 'ms';

    // Load filter settings
    var filterEnabled = document.getElementById('filterEnabled');
    var filterType = document.getElementById('filterType');
    var filterFreq = document.getElementById('filterFreq');
    var filterQ = document.getElementById('filterQ');
    var filterKeyTrack = document.getElementById('filterKeyTrack');
    var filterModel = document.getElementById('filterModel');
    var filterSlopeRadios = document.querySelectorAll('input[name="filterSlope"]');

    if (filterEnabled) filterEnabled.checked = settings.filter.enabled;
    if (filterType) filterType.value = settings.filter.type;
    if (filterFreq) filterFreq.value = settings.filter.freq;
    if (filterQ) filterQ.value = settings.filter.q;
    if (filterKeyTrack) filterKeyTrack.value = settings.filter.keyTrack;
    if (filterModel) filterModel.value = settings.filter.model;
    filterSlopeRadios.forEach(function(r) { r.checked = (parseInt(r.value) === settings.filter.slope); });

    // Load noise settings
    var noiseType = document.getElementById('noiseType');
    var noiseLevel = document.getElementById('noiseLevel');

    if (noiseType) noiseType.value = settings.noise.type;
    if (noiseLevel) noiseLevel.value = settings.noise.level;

    // Load filter envelope settings
    var filterEnvEnabled = document.getElementById('filterEnvEnabled');
    var filterEnvAmount = document.getElementById('filterEnvAmount');
    var filterEnvA = document.getElementById('filterEnvA');
    var filterEnvD = document.getElementById('filterEnvD');
    var filterEnvS = document.getElementById('filterEnvS');
    var filterEnvR = document.getElementById('filterEnvR');
    var filterEnvLink = document.getElementById('filterEnvLinkToAmp');

    if (filterEnvEnabled) filterEnvEnabled.checked = settings.filterEnv.enabled;
    if (filterEnvAmount) filterEnvAmount.value = settings.filterEnv.amount;
    if (filterEnvA) filterEnvA.value = settings.filterEnv.a;
    if (filterEnvD) filterEnvD.value = settings.filterEnv.d;
    if (filterEnvS) filterEnvS.value = settings.filterEnv.s;
    if (filterEnvR) filterEnvR.value = settings.filterEnv.r;
    if (filterEnvLink) filterEnvLink.checked = settings.filterEnv.link;

    // Load LFO settings
    var lfoSettings = settings.lfo || SL.audio._DEFAULT_INSTRUMENT_SETTINGS.lfo;
    [1, 2].forEach(function(n) {
      var key = 'lfo' + n;
      var lfo = lfoSettings[key] || SL.audio._DEFAULT_INSTRUMENT_SETTINGS.lfo[key];
      var enabledEl = document.getElementById('lfo' + n + 'Enabled');
      var rateEl = document.getElementById('lfo' + n + 'Rate');
      var rateValEl = document.getElementById('lfo' + n + 'RateVal');
      var depthEl = document.getElementById('lfo' + n + 'Depth');
      var depthValEl = document.getElementById('lfo' + n + 'DepthVal');
      var waveformEl = document.getElementById('lfo' + n + 'Waveform');
      var targetEl = document.getElementById('lfo' + n + 'Target');
      if (enabledEl) enabledEl.checked = lfo.enabled;
      if (rateEl) rateEl.value = lfo.rate;
      if (rateValEl) rateValEl.textContent = lfo.rate.toFixed(1) + ' Hz';
      if (depthEl) depthEl.value = lfo.depth;
      if (depthValEl) depthValEl.textContent = lfo.depth + '%';
      if (waveformEl) waveformEl.value = lfo.waveform;
      if (targetEl) targetEl.value = lfo.target;
      // Update audio engine LFO nodes
      if (SL.audio.initLFO) SL.audio.initLFO(instId);
    });

    // Load Mod Matrix settings
    if (SL.audio.modMatrix) {
      var mmSlots = settings.modMatrix || SL.audio._DEFAULT_INSTRUMENT_SETTINGS.modMatrix;
      var mmNumSlots = SL.audio.modMatrix.NUM_SLOTS || 8;
      for (var mmIdx = 0; mmIdx < mmNumSlots; mmIdx++) {
        var mmSlot = (mmSlots && mmSlots[mmIdx]) ? mmSlots[mmIdx] : SL.audio.modMatrix.DEFAULT_SLOT;
        var mmEnableEl = document.getElementById('modMatrixEnable' + mmIdx);
        var mmSourceEl = document.getElementById('modMatrixSource' + mmIdx);
        var mmDestEl = document.getElementById('modMatrixDest' + mmIdx);
        var mmAmountEl = document.getElementById('modMatrixAmount' + mmIdx);
        var mmAmountValEl = document.getElementById('modMatrixAmountVal' + mmIdx);
        if (mmEnableEl) mmEnableEl.checked = mmSlot.enabled;
        if (mmSourceEl) mmSourceEl.value = mmSlot.source;
        if (mmDestEl) mmDestEl.value = mmSlot.destination;
        if (mmAmountEl) mmAmountEl.value = mmSlot.amount;
        if (mmAmountValEl) mmAmountValEl.textContent = mmSlot.amount;
      }
      // Rebuild mod matrix sources for new instrument
      if (SL.audio.initModMatrix) SL.audio.initModMatrix(instId);
    }

    // Load FM settings
    if (settings.fmSettings) {
      var fmAlgoEl = document.getElementById('fmAlgorithm');
      var fmFeedbackEl = document.getElementById('fmFeedback');
      var fmFeedbackValEl = document.getElementById('fmFeedbackVal');
      if (fmAlgoEl) fmAlgoEl.value = settings.fmSettings.algorithm;
      if (fmFeedbackEl) fmFeedbackEl.value = settings.fmSettings.feedback;
      if (fmFeedbackValEl) fmFeedbackValEl.textContent = settings.fmSettings.feedback;
    }


    // Load reed settings
    if (settings.reedSettings && SL.reed) {
      SL.reed.setSettings(instId, settings.reedSettings);
      var reedTypeEl = document.getElementById('reedType');
      if (reedTypeEl) reedTypeEl.value = settings.reedSettings.reedType || 'clarinet';
      var reedStiffEl = document.getElementById('reedStiffness');
      if (reedStiffEl) reedStiffEl.value = settings.reedSettings.reedStiffness || 50;
      var reedStiffValEl = document.getElementById('reedStiffnessVal');
      if (reedStiffValEl) reedStiffValEl.textContent = settings.reedSettings.reedStiffness || 50;
      var reedEmbEl = document.getElementById('reedEmbouchure');
      if (reedEmbEl) reedEmbEl.value = settings.reedSettings.embouchurePressure || 50;
      var reedEmbValEl = document.getElementById('reedEmbouchureVal');
      if (reedEmbValEl) reedEmbValEl.textContent = settings.reedSettings.embouchurePressure || 50;
      var reedRegEl = document.getElementById('reedRegister');
      if (reedRegEl) reedRegEl.value = settings.reedSettings.register || 'normal';
      var reedVibRateEl = document.getElementById('reedVibratoRate');
      if (reedVibRateEl) reedVibRateEl.value = Math.round((settings.reedSettings.vibratoRate || 5.0) * 10);
      var reedVibRateValEl = document.getElementById('reedVibratoRateVal');
      if (reedVibRateValEl) reedVibRateValEl.textContent = (settings.reedSettings.vibratoRate || 5.0).toFixed(1) + ' Hz';
      var reedVibDepthEl = document.getElementById('reedVibratoDepth');
      if (reedVibDepthEl) reedVibDepthEl.value = settings.reedSettings.vibratoDepth || 20;
      var reedVibDepthValEl = document.getElementById('reedVibratoDepthVal');
      if (reedVibDepthValEl) reedVibDepthValEl.textContent = settings.reedSettings.vibratoDepth || 20;
      var reedNoiseEl = document.getElementById('reedBreathNoise');
      if (reedNoiseEl) reedNoiseEl.value = settings.reedSettings.breathNoise || 25;
      var reedNoiseValEl = document.getElementById('reedBreathNoiseVal');
      if (reedNoiseValEl) reedNoiseValEl.textContent = settings.reedSettings.breathNoise || 25;
    }

    // Load body resonance settings
    if (settings.bodyResonanceSettings && SL.bodyResonance) {
      SL.bodyResonance.setSettings(instId, settings.bodyResonanceSettings);
    }

    // Load physical modelling settings
    if (settings.physicalSettings) {
      var physModelEl = document.getElementById('physicalModel');
      if (physModelEl) physModelEl.value = settings.physicalSettings.model || 'pluck';
      var physParamNames = ['damping', 'brightness', 'bodySize', 'decayTime', 'bowPressure', 'bowPosition', 'breathPressure', 'embouchure', 'strikePosition', 'hardness'];
      physParamNames.forEach(function(name) {
        var el = document.getElementById('physical_' + name);
        var valEl = document.getElementById('physical_' + name + 'Val');
        if (el && settings.physicalSettings[name] != null) {
          el.value = settings.physicalSettings[name];
          if (valEl) valEl.textContent = settings.physicalSettings[name];
        }
      });
      var excitationEl = document.getElementById('physical_excitation');
      if (excitationEl) excitationEl.value = settings.physicalSettings.excitation || 'noise';
      var materialEl = document.getElementById('physical_material');
      if (materialEl) materialEl.value = settings.physicalSettings.material || 'metal';
      // Update visibility of model-specific params
      if (SL.mixerModal && SL.mixerModal.updatePhysicalParamVisibility) {
        SL.mixerModal.updatePhysicalParamVisibility(settings.physicalSettings.model);
      }
    }

    // Load additive synthesis settings
    var addSettings = settings.additiveSettings || SL.audio._DEFAULT_INSTRUMENT_SETTINGS.additiveSettings;
    if (addSettings) {
      // Push settings to engine
      if (SL.additive && SL.additive.setSettings) {
        SL.additive.setSettings(instId, addSettings);
      }
      // Update partial sliders
      for (var pi = 0; pi < 16; pi++) {
        var partialEl = document.getElementById('additivePartial' + pi);
        var hasPartialData = (addSettings.partials && addSettings.partials[pi]);
        var canUpdatePartialSlider = (partialEl && hasPartialData);
        if (canUpdatePartialSlider) {
          partialEl.value = Math.round(addSettings.partials[pi].amplitude * 100);
        }
      }
      // Update drawbar mode toggle
      var drawbarModeEl = document.getElementById('additiveDrawbarMode');
      if (drawbarModeEl) {
        drawbarModeEl.checked = addSettings.drawbarMode || false;
      }
      // Update drawbar sliders
      for (var di = 0; di < 9; di++) {
        var drawbarEl = document.getElementById('additiveDrawbar' + di);
        var drawbarValEl = document.getElementById('additiveDrawbarVal' + di);
        if (drawbarEl && addSettings.drawbars) {
          drawbarEl.value = addSettings.drawbars[di] || 0;
          if (drawbarValEl) drawbarValEl.textContent = addSettings.drawbars[di] || 0;
        }
      }
      // Update additive UI visibility
      if (SL.mixerModal && SL.mixerModal.updateAdditiveVisibility) {
        SL.mixerModal.updateAdditiveVisibility(addSettings.drawbarMode);
      }
    }

    // Load granular synthesis settings
    var granSettings = settings.granularSettings || SL.audio._DEFAULT_INSTRUMENT_SETTINGS.granularSettings;
    if (granSettings) {
      // Push settings to engine
      if (SL.granular && SL.granular.setSettings) {
        SL.granular.setSettings(instId, granSettings);
      }
      // Update UI controls
      var granSourceEl = document.getElementById('granularSource');
      if (granSourceEl) granSourceEl.value = granSettings.sourceWaveform || 'sine';
      var granSizeEl = document.getElementById('granularGrainSize');
      var granSizeVal = document.getElementById('granularGrainSizeVal');
      if (granSizeEl) {
        granSizeEl.value = granSettings.grainSize || 50;
        if (granSizeVal) granSizeVal.textContent = (granSettings.grainSize || 50) + ' ms';
      }
      var granDensityEl = document.getElementById('granularDensity');
      var granDensityVal = document.getElementById('granularDensityVal');
      if (granDensityEl) {
        granDensityEl.value = granSettings.density || 10;
        if (granDensityVal) granDensityVal.textContent = (granSettings.density || 10) + '/s';
      }
      var granPitchEl = document.getElementById('granularPitchScatter');
      var granPitchVal = document.getElementById('granularPitchScatterVal');
      if (granPitchEl) {
        granPitchEl.value = granSettings.pitchScatter || 0;
        if (granPitchVal) granPitchVal.textContent = (granSettings.pitchScatter || 0) + ' st';
      }
      var granPosScatEl = document.getElementById('granularPosScatter');
      var granPosScatVal = document.getElementById('granularPosScatterVal');
      if (granPosScatEl) {
        granPosScatEl.value = granSettings.positionScatter || 0;
        if (granPosScatVal) granPosScatVal.textContent = (granSettings.positionScatter || 0) + '%';
      }
      var granWindowEl = document.getElementById('granularWindow');
      if (granWindowEl) granWindowEl.value = granSettings.windowShape || 'hann';
      var granPosEl = document.getElementById('granularPosition');
      var granPosValEl = document.getElementById('granularPositionVal');
      if (granPosEl) {
        granPosEl.value = granSettings.position || 50;
        if (granPosValEl) granPosValEl.textContent = (granSettings.position || 50) + '%';
      }
      // Restore freeze state
      if (SL.granular && SL.granular.setFreeze) {
        SL.granular.setFreeze(instId, Boolean(granSettings.freeze));
      }
      // Update freeze button UI (both modal and top bar)
      var granFreezeBtn = document.getElementById('granularFreezeBtn');
      if (granFreezeBtn) {
        if (granSettings.freeze) {
          granFreezeBtn.classList.add('active');
        } else {
          granFreezeBtn.classList.remove('active');
        }
      }
      var topFreezeBtn = document.getElementById('topFreezeBtn');
      if (topFreezeBtn) {
        if (granSettings.freeze) {
          topFreezeBtn.classList.add('active');
        } else {
          topFreezeBtn.classList.remove('active');
        }
      }
    }

    // Load vocoder synth settings
    var vocSettings = settings.vocoderSynthSettings || SL.audio._DEFAULT_INSTRUMENT_SETTINGS.vocoderSynthSettings;
    if (vocSettings) {
      if (SL.vocoderSynth && SL.vocoderSynth.setSettings) {
        SL.vocoderSynth.setSettings(instId, vocSettings);
      }
      var vocCarrierEl = document.getElementById('vocoderSynthCarrier');
      if (vocCarrierEl) vocCarrierEl.value = vocSettings.carrierWaveform || 'saw';
      var vocMorphEl = document.getElementById('vocoderSynthMorph');
      var vocMorphVal = document.getElementById('vocoderSynthMorphVal');
      if (vocMorphEl) {
        vocMorphEl.value = vocSettings.morphPosition || 0;
        if (vocMorphVal) vocMorphVal.textContent = (vocSettings.morphPosition || 0) + '%';
      }
      var vocFormantEl = document.getElementById('vocoderSynthFormantShift');
      var vocFormantVal = document.getElementById('vocoderSynthFormantShiftVal');
      if (vocFormantEl) {
        vocFormantEl.value = vocSettings.formantShift || 0;
        if (vocFormantVal) vocFormantVal.textContent = (vocSettings.formantShift || 0) + ' st';
      }
      var vocFilterQEl = document.getElementById('vocoderSynthFilterQ');
      var vocFilterQVal = document.getElementById('vocoderSynthFilterQVal');
      if (vocFilterQEl) {
        vocFilterQEl.value = vocSettings.filterQ || 8;
        if (vocFilterQVal) vocFilterQVal.textContent = vocSettings.filterQ || 8;
      }
      // Update vowel buttons
      var vowelBtns = document.querySelectorAll('.vocoder-synth-vowel-btn');
      if (vowelBtns.length > 0) {
        for (var vbi = 0; vbi < vowelBtns.length; vbi++) {
          if (vowelBtns[vbi].dataset.vowel === (vocSettings.vowel || 'A')) {
            vowelBtns[vbi].classList.add('active');
          } else {
            vowelBtns[vbi].classList.remove('active');
          }
        }
      }
      // Update band count buttons
      var bandBtns = document.querySelectorAll('.vocoder-synth-band-btn');
      if (bandBtns.length > 0) {
        for (var bbi = 0; bbi < bandBtns.length; bbi++) {
          if (parseInt(bandBtns[bbi].dataset.bands) === (vocSettings.bandCount || 16)) {
            bandBtns[bbi].classList.add('active');
          } else {
            bandBtns[bbi].classList.remove('active');
          }
        }
      }
    }

    // Load wavefolder settings
    var wfSettings = settings.wavefoldSettings || SL.audio._DEFAULT_INSTRUMENT_SETTINGS.wavefoldSettings;
    if (wfSettings) {
      if (SL.wavefolder && SL.wavefolder.setSettings) {
        SL.wavefolder.setSettings(instId, wfSettings);
      }
      var wfSourceEl = document.getElementById('wavefoldSource');
      if (wfSourceEl) wfSourceEl.value = wfSettings.source || 'sine';
      var wfFoldEl = document.getElementById('wavefoldAmount');
      var wfFoldVal = document.getElementById('wavefoldAmountVal');
      if (wfFoldEl) {
        wfFoldEl.value = wfSettings.foldAmount || 4;
        if (wfFoldVal) wfFoldVal.textContent = (wfSettings.foldAmount || 4) + 'x';
      }
      var wfSymEl = document.getElementById('wavefoldSymmetry');
      var wfSymVal = document.getElementById('wavefoldSymmetryVal');
      if (wfSymEl) {
        wfSymEl.value = wfSettings.symmetry || 50;
        if (wfSymVal) wfSymVal.textContent = (wfSettings.symmetry || 50) + '%';
      }
      var wfBiasEl = document.getElementById('wavefoldBias');
      var wfBiasVal = document.getElementById('wavefoldBiasVal');
      if (wfBiasEl) {
        wfBiasEl.value = wfSettings.bias || 0;
        if (wfBiasVal) wfBiasVal.textContent = wfSettings.bias || 0;
      }
      var wfGainEl = document.getElementById('wavefoldPreGain');
      var wfGainVal = document.getElementById('wavefoldPreGainVal');
      if (wfGainEl) {
        wfGainEl.value = (wfSettings.preGain || 1.0) * 10;
        if (wfGainVal) wfGainVal.textContent = (wfSettings.preGain || 1.0).toFixed(1);
      }
    }

    // Load formant settings
    var fmtSettings = settings.formantSettings || SL.audio._DEFAULT_INSTRUMENT_SETTINGS.formantSettings;
    if (fmtSettings) {
      if (SL.formant && SL.formant.setSettings) {
        SL.formant.setSettings(instId, fmtSettings);
      }
      var fmtMorphEl = document.getElementById('formantMorph');
      var fmtMorphVal = document.getElementById('formantMorphVal');
      if (fmtMorphEl) {
        fmtMorphEl.value = fmtSettings.morphX || 0;
        if (fmtMorphVal) fmtMorphVal.textContent = (fmtSettings.morphX || 0) + '%';
      }
      var fmtShiftEl = document.getElementById('formantShift');
      var fmtShiftVal = document.getElementById('formantShiftVal');
      if (fmtShiftEl) {
        fmtShiftEl.value = fmtSettings.formantShift || 0;
        if (fmtShiftVal) fmtShiftVal.textContent = (fmtSettings.formantShift || 0) + ' st';
      }
      var fmtBreathEl = document.getElementById('formantBreathiness');
      var fmtBreathVal = document.getElementById('formantBreathinessVal');
      if (fmtBreathEl) {
        fmtBreathEl.value = fmtSettings.breathiness || 15;
        if (fmtBreathVal) fmtBreathVal.textContent = (fmtSettings.breathiness || 15) + '%';
      }
      var fmtGlottalEl = document.getElementById('formantGlottalPW');
      var fmtGlottalVal = document.getElementById('formantGlottalPWVal');
      if (fmtGlottalEl) {
        fmtGlottalEl.value = fmtSettings.glottalPulseWidth || 50;
        if (fmtGlottalVal) fmtGlottalVal.textContent = (fmtSettings.glottalPulseWidth || 50) + '%';
      }
      // Update vowel buttons
      var fmtVowelBtns = document.querySelectorAll('.formant-vowel-btn');
      if (fmtVowelBtns.length > 0) {
        for (var fvi = 0; fvi < fmtVowelBtns.length; fvi++) {
          if (fmtVowelBtns[fvi].dataset.vowel === (fmtSettings.vowel || 'A')) {
            fmtVowelBtns[fvi].classList.add('active');
          } else {
            fmtVowelBtns[fvi].classList.remove('active');
          }
        }
      }
    }

    // Load modal settings
    var mdlSettings = settings.modalSettings || SL.audio._DEFAULT_INSTRUMENT_SETTINGS.modalSettings;
    if (mdlSettings) {
      if (SL.modal && SL.modal.setSettings) {
        SL.modal.setSettings(instId, mdlSettings);
      }
      var mdlMaterialEl = document.getElementById('modalMaterial');
      if (mdlMaterialEl) mdlMaterialEl.value = mdlSettings.material || 'bell';
      var mdlExcitationEl = document.getElementById('modalExcitation');
      if (mdlExcitationEl) mdlExcitationEl.value = mdlSettings.excitation || 'mallet';
      var mdlHardnessEl = document.getElementById('modalMalletHardness');
      var mdlHardnessVal = document.getElementById('modalMalletHardnessVal');
      if (mdlHardnessEl) {
        mdlHardnessEl.value = mdlSettings.malletHardness || 60;
        if (mdlHardnessVal) mdlHardnessVal.textContent = mdlSettings.malletHardness || 60;
      }
      var mdlDampingEl = document.getElementById('modalDamping');
      var mdlDampingVal = document.getElementById('modalDampingVal');
      if (mdlDampingEl) {
        mdlDampingEl.value = mdlSettings.damping || 30;
        if (mdlDampingVal) mdlDampingVal.textContent = mdlSettings.damping || 30;
      }
      var mdlBrightnessEl = document.getElementById('modalBrightness');
      var mdlBrightnessVal = document.getElementById('modalBrightnessVal');
      if (mdlBrightnessEl) {
        mdlBrightnessEl.value = mdlSettings.brightness || 65;
        if (mdlBrightnessVal) mdlBrightnessVal.textContent = mdlSettings.brightness || 65;
      }
      var mdlBodySizeEl = document.getElementById('modalBodySize');
      var mdlBodySizeVal = document.getElementById('modalBodySizeVal');
      if (mdlBodySizeEl) {
        mdlBodySizeEl.value = mdlSettings.bodySize || 50;
        if (mdlBodySizeVal) mdlBodySizeVal.textContent = mdlSettings.bodySize || 50;
      }
      var mdlInharmEl = document.getElementById('modalInharmonicity');
      var mdlInharmVal = document.getElementById('modalInharmonicityVal');
      if (mdlInharmEl) {
        mdlInharmEl.value = mdlSettings.inharmonicity || 50;
        if (mdlInharmVal) mdlInharmVal.textContent = mdlSettings.inharmonicity || 50;
      }
    }

    // Load ringmod settings
    var rmSettings = settings.ringmodSettings || SL.audio._DEFAULT_INSTRUMENT_SETTINGS.ringmodSettings;
    if (rmSettings) {
      if (SL.ringmod && SL.ringmod.setSettings) {
        SL.ringmod.setSettings(instId, rmSettings);
      }
    }

    // Load chord settings
    var chSettings = settings.chordSettings || SL.audio._DEFAULT_INSTRUMENT_SETTINGS.chordSettings;
    if (chSettings) {
      if (SL.chord && SL.chord.setSettings) {
        SL.chord.setSettings(instId, chSettings);
      }
    }

    // Load superwave settings
    var swSettings = settings.superwaveSettings || SL.audio._DEFAULT_INSTRUMENT_SETTINGS.superwaveSettings;
    if (swSettings) {
      if (SL.superwave && SL.superwave.setSettings) {
        SL.superwave.setSettings(instId, swSettings);
      }
    }

    // Load wavetable settings
    var wtSettings = settings.wavetableSettings || SL.audio._DEFAULT_INSTRUMENT_SETTINGS.wavetableSettings;
    if (wtSettings) {
      if (SL.wavetableSynth && SL.wavetableSynth.setSettings) {
        SL.wavetableSynth.setSettings(instId, wtSettings);
      }
    }

    // Load phasedist settings
    var pdSettings = settings.phasedistSettings || SL.audio._DEFAULT_INSTRUMENT_SETTINGS.phasedistSettings;
    if (pdSettings) {
      if (SL.phasedist && SL.phasedist.setSettings) {
        SL.phasedist.setSettings(instId, pdSettings);
      }
    }

    // Load chip settings
    var chipSettings = settings.chipSettings || SL.audio._DEFAULT_INSTRUMENT_SETTINGS.chipSettings;
    if (chipSettings) {
      if (SL.chip && SL.chip.setSettings) {
        SL.chip.setSettings(instId, chipSettings);
      }
    }

    // Load bytebeat settings
    var bbSettings = settings.bytebeatSettings || SL.audio._DEFAULT_INSTRUMENT_SETTINGS.bytebeatSettings;
    if (bbSettings) {
      if (SL.bytebeat && SL.bytebeat.setSettings) {
        SL.bytebeat.setSettings(bbSettings);
      }
    }

    // Load vector settings
    var vecSettings = settings.vectorSettings || SL.audio._DEFAULT_INSTRUMENT_SETTINGS.vectorSettings;
    if (vecSettings) {
      if (SL.vector && SL.vector.setSettings) {
        SL.vector.setSettings(instId, vecSettings);
      }
    }

    // Load drum synth settings
    var dsSettings = settings.drumsynSettings || SL.audio._DEFAULT_INSTRUMENT_SETTINGS.drumsynSettings;
    if (dsSettings) {
      if (SL.drumsyn && SL.drumsyn.setSettings) {
        SL.drumsyn.setSettings(instId, dsSettings);
      }
    }

    // Load pulsar settings
    var plsSettings = settings.pulsarSettings || SL.audio._DEFAULT_INSTRUMENT_SETTINGS.pulsarSettings;
    if (plsSettings) {
      if (SL.pulsar && SL.pulsar.setSettings) {
        SL.pulsar.setSettings(instId, plsSettings);
      }
    }

    // Load volume
    var volSlider = document.getElementById('instrumentVolume');
    var volVal = document.getElementById('instrumentVolumeVal');
    if (volSlider) {
      var vol = (settings.volume !== undefined) ? settings.volume : 80;
      volSlider.value = vol;
      if (volVal) volVal.textContent = vol;
    }

    // Humanization (4 sliders, backward compatible)
    var hum = settings.humanization || {};
    var isOldFormat = (typeof hum === 'number');
    var humVel = document.getElementById('humVelocity');
    var humTime = document.getElementById('humTiming');
    var humAdsrEl = document.getElementById('humAdsr');
    var humDrift = document.getElementById('humDrift');
    if (humVel) { humVel.value = isOldFormat ? hum : (hum.velocity || 0); }
    if (humTime) { humTime.value = isOldFormat ? hum : (hum.timing || 0); }
    if (humAdsrEl) { humAdsrEl.value = isOldFormat ? hum : (hum.adsr || 0); }
    if (humDrift) { humDrift.value = isOldFormat ? hum : (hum.drift || 0); }
    var humVelVal = document.getElementById('humVelocityVal');
    var humTimeVal = document.getElementById('humTimingVal');
    var humAdsrVal = document.getElementById('humAdsrVal');
    var humDriftVal = document.getElementById('humDriftVal');
    if (humVelVal) humVelVal.textContent = humVel ? humVel.value : 0;
    if (humTimeVal) humTimeVal.textContent = humTime ? humTime.value : 0;
    if (humAdsrVal) humAdsrVal.textContent = humAdsrEl ? humAdsrEl.value : 0;
    if (humDriftVal) humDriftVal.textContent = humDrift ? humDrift.value : 0;

    var humStrum = document.getElementById('humStrum');
    var humStrumVal = document.getElementById('humStrumVal');
    if (humStrum) { humStrum.value = settings.strum || 0; }
    if (humStrumVal) humStrumVal.textContent = humStrum ? humStrum.value : 0;

    var strumDirEl = document.getElementById('strumDir');
    if (strumDirEl) strumDirEl.value = settings.strumDir || 'up';
    var strumRepeatEl = document.getElementById('strumRepeat');
    var strumRepeatValEl = document.getElementById('strumRepeatVal');
    if (strumRepeatEl) { strumRepeatEl.value = settings.strumRepeat || 0; }
    if (strumRepeatValEl) strumRepeatValEl.textContent = strumRepeatEl ? strumRepeatEl.value : 0;

    // Load glide setting
    var glideEl = document.getElementById('glideAmount');
    var glideValEl = document.getElementById('glideAmountVal');
    if (glideEl) { glideEl.value = settings.glide || 0; }
    if (glideValEl) glideValEl.textContent = glideEl ? glideEl.value : 0;

    // Load pad aftertouch settings
    var pat = settings.padAftertouch || SL.audio._DEFAULT_INSTRUMENT_SETTINGS.padAftertouch;
    var pfmEl = document.getElementById('padFilterMod');
    var pfmValEl = document.getElementById('padFilterModVal');
    var pvmEl = document.getElementById('padVolumeMod');
    var pvmValEl = document.getElementById('padVolumeModVal');
    var pvibEl = document.getElementById('padVibrato');
    var pvibValEl = document.getElementById('padVibratoVal');
    var prateEl = document.getElementById('padLfoRate');
    var prateValEl = document.getElementById('padLfoRateVal');
    if (pfmEl) { pfmEl.value = pat.filterMod; }
    if (pfmValEl) pfmValEl.textContent = pat.filterMod;
    if (pvmEl) { pvmEl.value = pat.volumeMod; }
    if (pvmValEl) pvmValEl.textContent = pat.volumeMod;
    if (pvibEl) { pvibEl.value = pat.vibrato; }
    if (pvibValEl) pvibValEl.textContent = pat.vibrato;
    if (prateEl) { prateEl.value = Math.round(pat.rate * 100); }
    if (prateValEl) prateValEl.textContent = pat.rate;

    // Load loop settings (instrument 4 is the dedicated loop instrument)
    if (instId === 4 && SL.loop) {
      var ls = settings.loopSettings || SL.audio._DEFAULT_INSTRUMENT_SETTINGS.loopSettings;
      // Apply loop engine parameters from saved state
      if (SL.loop.isPlaying()) {
        SL.loop.setVolume(ls.volume !== undefined ? ls.volume : 0.3);
        SL.loop.setLfoRate(ls.lfoRate !== undefined ? ls.lfoRate : 0.2);
        SL.loop.setLfoDepth(ls.lfoDepth !== undefined ? ls.lfoDepth : 30);
        SL.loop.setLfoShape(ls.lfoShape || 'sine');
        SL.loop.setFilterType(ls.filterType || 'lowpass');
        SL.loop.setFilterFreq(ls.filterFreq !== undefined ? ls.filterFreq : 20000);
        SL.loop.setFilterQ(ls.filterQ !== undefined ? ls.filterQ : 1);
        SL.loop.setLfo2Rate(ls.lfo2Rate !== undefined ? ls.lfo2Rate : 0.1);
        SL.loop.setLfo2Depth(ls.lfo2Depth !== undefined ? ls.lfo2Depth : 0);
        SL.loop.setLfo2Shape(ls.lfo2Shape || 'sine');
        SL.loop.setFadeIn(ls.fadeIn !== undefined ? ls.fadeIn : 2);
        SL.loop.setFadeOut(ls.fadeOut !== undefined ? ls.fadeOut : 2);
      }
      // Update loop texture selector if visible
      var loopTextureSelect = document.getElementById('loopTextureSelect');
      if (loopTextureSelect) {
        loopTextureSelect.value = ls.textureName || 'White Noise';
      }
      // Update loop toggle button state
      var loopToggleBtn = document.getElementById('loopToggleBtn');
      if (loopToggleBtn) {
        var playing = SL.loop.isPlaying();
        loopToggleBtn.textContent = playing ? 'ON' : 'OFF';
        loopToggleBtn.classList.toggle('active', playing);
      }
    }

    // Load polyrhythm settings
    if (SL.sequencer && settings.polyrhythm) {
      if (SL.sequencer.setInstrumentStepCount) {
        SL.sequencer.setInstrumentStepCount(instId, settings.polyrhythm.stepCount || 16);
      }
      // Only set the global enabled state when loading the current instrument
      if (instId === SL.audio.getCurrentInstrument() && SL.sequencer.setPolyrhythmEnabled) {
        SL.sequencer.setPolyrhythmEnabled(settings.polyrhythm.enabled || false);
      }
      if (SL.sequencer.updatePolyStepCountUI) {
        SL.sequencer.updatePolyStepCountUI();
      }
    }

    // Load arpeggiator settings
    if (SL.arp && settings.arpSettings) {
      SL.arp.loadSettings(settings.arpSettings);
      // Update arp panel UI controls
      var arpPatternEl = document.getElementById('arpPattern');
      if (arpPatternEl) arpPatternEl.value = settings.arpSettings.pattern || 'up';
      var arpRateEl = document.getElementById('arpRate');
      if (arpRateEl) arpRateEl.value = settings.arpSettings.rate || '1/8';
      var arpOctEl = document.getElementById('arpOctaves');
      var arpOctValEl = document.getElementById('arpOctavesVal');
      if (arpOctEl) {
        arpOctEl.value = settings.arpSettings.octaves || 1;
        if (arpOctValEl) arpOctValEl.textContent = settings.arpSettings.octaves || 1;
      }
      var arpGateEl = document.getElementById('arpGate');
      var arpGateValEl = document.getElementById('arpGateVal');
      if (arpGateEl) {
        arpGateEl.value = settings.arpSettings.gate || 80;
        if (arpGateValEl) arpGateValEl.textContent = (settings.arpSettings.gate || 80) + '%';
      }
      var arpSwingEl = document.getElementById('arpSwing');
      var arpSwingValEl = document.getElementById('arpSwingVal');
      if (arpSwingEl) {
        arpSwingEl.value = settings.arpSettings.swing || 0;
        if (arpSwingValEl) arpSwingValEl.textContent = (settings.arpSettings.swing || 0) + '%';
      }
      var arpVelEl = document.getElementById('arpVelocity');
      if (arpVelEl) arpVelEl.value = settings.arpSettings.velocityMode || 'original';
      var arpHoldBtn = document.getElementById('arpHold');
      if (arpHoldBtn) {
        arpHoldBtn.classList.toggle('active', settings.arpSettings.hold || false);
        arpHoldBtn.textContent = (settings.arpSettings.hold) ? 'HOLD ON' : 'HOLD';
      }
    }

    // Load MIDIOUT settings
    var canSetMidioutSettings = settings.midioutSettings && SL.midi && SL.midi.setMidioutSettings;
    if (canSetMidioutSettings) {
      SL.midi.setMidioutSettings(instId, settings.midioutSettings);
      if (instId === SL.audio.getCurrentInstrument() && SL.midi.loadMidioutUI) {
        SL.midi.loadMidioutUI(instId);
      }
    }

    // Load effect chain state (master mix, chain order, enabled flags, params)
    if (settings.effects && inst.effectChain) {
      if (settings.effects.masterMix !== undefined) {
        inst.effectChain.setMasterMix(settings.effects.masterMix);
      }

      // Restore chain order
      if (settings.effects.chainOrder && settings.effects.chainOrder.length > 0) {
        for (var ci = 0; ci < settings.effects.chainOrder.length; ci++) {
          var chainName = settings.effects.chainOrder[ci];
          inst.effectChain.addToChain(chainName);
        }
        inst.effectChain.setOrder(settings.effects.chainOrder);
      }

      // Restore enabled states and parameter values
      if (settings.effects.enabled) {
        var enabledKeys = Object.keys(settings.effects.enabled);
        for (var ei = 0; ei < enabledKeys.length; ei++) {
          var effName = enabledKeys[ei];
          var effInst = inst.effectChain.getEffect(effName);
          if (effInst) {
            effInst.setEnabled(settings.effects.enabled[effName]);
          }
        }
      }

      if (settings.effects.params) {
        var paramKeys = Object.keys(settings.effects.params);
        for (var pi = 0; pi < paramKeys.length; pi++) {
          var pEffName = paramKeys[pi];
          var pEffInst = inst.effectChain.getEffect(pEffName);
          if (pEffInst) {
            var savedParams = settings.effects.params[pEffName];
            var savedParamNames = Object.keys(savedParams);
            for (var si = 0; si < savedParamNames.length; si++) {
              var spName = savedParamNames[si];
              if (savedParams[spName] !== undefined) {
                pEffInst.setParam(spName, savedParams[spName]);
              }
            }
          }
        }
      }

      // Refresh the effects screen UI if it is currently active
      var isEffectsScreenActive = SL.screenEffects && SL.screenEffects.activate && SL.screens && SL.screens.getCurrentScreen && (SL.screens.getCurrentScreen() === 'effects');
      if (isEffectsScreenActive) {
        SL.screenEffects.activate();
      }
    }

    // Update mixer modal type buttons and section visibility to match loaded instrument
    if (SL.mixerModal && SL.mixerModal.updateTypeToggleState) {
      SL.mixerModal.updateTypeToggleState();
    }

  }

  // ============================================================
  // Clear Instrument
  // ============================================================

  /**
   * Reset a single instrument to default settings
   * @param {number} instId - Instrument index (0-4)
   */
  function clearInstrument(instId) {
    var instruments = SL.audio.getInstruments();
    var NUM_INSTRUMENTS = SL.audio.getNumInstruments();
    if (instId < 0 || instId >= NUM_INSTRUMENTS) return;

    var inst = instruments[instId];
    var defaults = JSON.parse(JSON.stringify(SL.audio._DEFAULT_INSTRUMENT_SETTINGS));

    // Reset settings to defaults
    inst.settings.osc = defaults.osc;
    // Per the spec: osc1 = sine at level 80, osc2/3 = sine at level 0
    inst.settings.osc[0] = { wave: 'sine', oct: 0, detune: 0, level: 80, pulseWidth: 50, superSawSpread: 50 };
    inst.settings.osc[1] = { wave: 'sine', oct: 0, detune: 0, level: 0, pulseWidth: 50, superSawSpread: 50 };
    inst.settings.osc[2] = { wave: 'sine', oct: 0, detune: 0, level: 0, pulseWidth: 50, superSawSpread: 50 };

    // Reset ADSR to defaults (a=10, d=200, s=70, r=200)
    inst.settings.adsr = { a: 10, d: 200, s: 70, r: 200 };

    // Reset filter to defaults (enabled, lowpass, freq=1000, q=1)
    inst.settings.filter = { enabled: true, type: 'lowpass', freq: 1000, q: 1, keyTrack: 0, model: 'butterworth', slope: 24 };

    // Reset noise to off
    inst.settings.noise = { type: 'white', level: 0 };

    // Reset filter envelope to off
    inst.settings.filterEnv = { enabled: false, amount: 24, a: 200, d: 600, s: 0, r: 775, link: false };

    // Reset FM settings to defaults
    inst.settings.fmSettings = defaults.fmSettings;

    // Reset additive settings to defaults
    inst.settings.additiveSettings = defaults.additiveSettings;
    if (SL.additive && SL.additive.setSettings) {
      SL.additive.setSettings(instId, defaults.additiveSettings);
    }

    // Reset granular settings to defaults
    inst.settings.granularSettings = defaults.granularSettings;
    if (SL.granular && SL.granular.setSettings) {
      SL.granular.setSettings(instId, defaults.granularSettings);
    }

    // Reset vocoder synth settings to defaults
    inst.settings.vocoderSynthSettings = defaults.vocoderSynthSettings;
    if (SL.vocoderSynth && SL.vocoderSynth.setSettings) {
      SL.vocoderSynth.setSettings(instId, defaults.vocoderSynthSettings);
    }

    // Disable all effects on this instrument's chain
    if (inst.effectChain) {
      inst.effectChain.effects.forEach(function(effect) {
        if (effect && effect.setEnabled) effect.setEnabled(false);
      });
    }
    inst.settings.effects = { chainOrder: [], masterMix: 100, enabled: {}, params: {} };

    // Clear sequencer notes for this instrument
    if (SL.sequencer && SL.sequencer.clearInstrument) {
      SL.sequencer.clearInstrument(instId);
    }

    // If this is the currently active instrument, update UI
    if (instId === SL.audio.getCurrentInstrument()) {
      loadInstrumentSettings(instId);
      if (SL.ui && SL.ui.updateUIFromInstrument) {
        SL.ui.updateUIFromInstrument();
      }
      // Sync effects UI
      if (SL.effectsUI && SL.effectsUI.setSelectedTarget) {
        SL.effectsUI.setSelectedTarget(instId);
      }
    }

    // Stop continuous noise if running
    if (SL.audio.restartContinuousNoise) {
      SL.audio.restartContinuousNoise();
    }

  }

  /**
   * Reset ALL instruments to default settings
   */
  function clearAllInstruments() {
    var NUM_INSTRUMENTS = SL.audio.getNumInstruments();
    for (var i = 0; i < NUM_INSTRUMENTS; i++) {
      clearInstrument(i);
    }
  }

  // ============================================================
  // Register on SL.audio
  // ============================================================

  SL.audio.getInstrumentSettings = getInstrumentSettings;
  SL.audio.getSettingsForInstrument = getSettingsForInstrument;
  SL.audio.playNoteOnInstrument = playNoteOnInstrument;
  SL.audio.saveInstrumentSettings = saveInstrumentSettings;
  SL.audio.loadInstrumentSettings = loadInstrumentSettings;
  SL.audio.clearInstrument = clearInstrument;
  SL.audio.clearAllInstruments = clearAllInstruments;
  SL.audio.stopBufferNote = _stopBufferNote;

  // Patch workletNoteOff to also kill non-workvar (buffer/oscillator) notes
  var _origWorkletNoteOff = SL.audio.workletNoteOff;
  SL.audio.workletNoteOff = function(midi, instId) {
    if (_origWorkletNoteOff) { _origWorkletNoteOff(midi, instId); }
    _stopBufferNote(instId !== undefined ? instId : SL.audio.getCurrentInstrument(), midi);
  };

  } // end if (SL && SL.audio)

})();
