// Super Synth Lab - Note Playback Module
// Extracted from audio-engine.js for modularity
// Loads AFTER audio-engine.js, voice-pool.js, wavetable.js, envelope.js, filters.js
(function() {
  'use strict';

  const SL = window.SynthLab;

  if (!SL || !SL.audio) {
    console.error('[note-playback] SynthLab.audio not available');
    return;
  }

  // ============================================================
  // Key Element Cache (avoid querySelectorAll on every note)
  // ============================================================

  var _allKeys = null;
  var _allIsoKeys = null;
  var _methodEl = null;
  // Map from MIDI note number to array of DOM elements for O(1) highlight lookup
  var _keysByMidi = null;
  var _isoKeysByMidi = null;

  // ============================================================
  // Continuous Noise Generator State
  // ============================================================

  /** Continuous noise source (independent of note playback) */
  let continuousNoiseSource = null;
  let continuousNoiseGain = null;
  let continuousNoiseFilter = null;

  // Noise buffer cache (reused for performance)
  let whiteNoiseBuffer = null;
  let pinkNoiseBuffer = null;
  let brownNoiseBuffer = null;

  // ============================================================
  // Noise Buffer Functions
  // ============================================================

  /**
   * Create a noise buffer of the specified type
   * @param {AudioContext} ctx - Web Audio context
   * @param {string} type - 'white', 'pink', or 'brown'
   * @returns {AudioBuffer}
   */
  function createNoiseBuffer(ctx, type) {
    const bufferSize = ctx.sampleRate * 2; // 2 seconds of noise
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    if (type === 'white') {
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
    } else if (type === 'pink') {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      }
    } else if (type === 'brown') {
      let lastOut = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        lastOut = (lastOut + (0.02 * white)) / 1.02;
        data[i] = lastOut * 3.5;
      }
    }

    return buffer;
  }

  /**
   * Get or create a noise buffer of the specified type (cached)
   * @param {AudioContext} ctx - Web Audio context
   * @param {string} type - 'white', 'pink', or 'brown'
   * @returns {AudioBuffer}
   */
  function getNoiseBuffer(ctx, type) {
    if (type === 'white') {
      if (!whiteNoiseBuffer) whiteNoiseBuffer = createNoiseBuffer(ctx, 'white');
      return whiteNoiseBuffer;
    } else if (type === 'pink') {
      if (!pinkNoiseBuffer) pinkNoiseBuffer = createNoiseBuffer(ctx, 'pink');
      return pinkNoiseBuffer;
    } else {
      if (!brownNoiseBuffer) brownNoiseBuffer = createNoiseBuffer(ctx, 'brown');
      return brownNoiseBuffer;
    }
  }

  /**
   * Create a noise source node
   * @param {AudioContext} ctx - Web Audio context
   * @param {Object} settings - Noise settings from getNoiseSettings()
   * @returns {{source: AudioBufferSourceNode, gain: GainNode}|null}
   */
  function createNoiseSource(ctx, settings) {
    if (!settings.enabled) return null;

    const buffer = getNoiseBuffer(ctx, settings.type);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const gain = ctx.createGain();
    gain.gain.value = settings.level * 0.5;

    source.connect(gain);

    return { source, gain };
  }

  // ============================================================
  // Visual Feedback
  // ============================================================

  /**
   * Highlight a note on keyboard/grid visuals
   * @param {number} midi - MIDI note number
   * @param {boolean} on - true to highlight, false to unhighlight
   */
  function highlightNote(midi, on) {
    var playing = SL.audio.getPlayingNotes();
    if (on) {
      playing.add(midi);
    } else {
      playing.delete(midi);
    }

    // Build MIDI-to-element maps on first call for O(1) lookup
    if (!_keysByMidi) {
      _keysByMidi = {};
      if (!_allKeys) { _allKeys = document.querySelectorAll('.key'); }
      for (var ki = 0; ki < _allKeys.length; ki++) {
        var kn = parseInt(_allKeys[ki].dataset.note);
        if (!_keysByMidi[kn]) { _keysByMidi[kn] = []; }
        _keysByMidi[kn].push(_allKeys[ki]);
      }
    }
    if (!_isoKeysByMidi) {
      _isoKeysByMidi = {};
      if (!_allIsoKeys) { _allIsoKeys = document.querySelectorAll('.iso-key'); }
      for (var iki = 0; iki < _allIsoKeys.length; iki++) {
        var ikn = parseInt(_allIsoKeys[iki].dataset.midi);
        if (!_isoKeysByMidi[ikn]) { _isoKeysByMidi[ikn] = []; }
        _isoKeysByMidi[ikn].push(_allIsoKeys[iki]);
      }
    }

    var keyEls = _keysByMidi[midi];
    if (keyEls) {
      for (var k = 0; k < keyEls.length; k++) {
        if (on) {
          keyEls[k].classList.add('playing');
        } else {
          keyEls[k].classList.remove('playing');
        }
      }
    }
    var isoEls = _isoKeysByMidi[midi];
    if (isoEls) {
      for (var ik = 0; ik < isoEls.length; ik++) {
        if (on) {
          isoEls[ik].classList.add('playing');
        } else {
          isoEls[ik].classList.remove('playing');
        }
      }
    }
  }

  // ============================================================
  // Note Playback
  // ============================================================

  /**
   * Play a note with full synthesis
   * @param {number} midi - MIDI note number
   * @param {number} [dur] - Duration in seconds
   */
  function playNote(midi, dur) {
    dur = dur || SL.DURATION || 0.4;

    // Reset idle suspend timer on note activity
    if (SL._resetIdleTimer) { SL._resetIdleTimer(); }

    // Raw velocity — per-voice randomization happens in worklets/engines
    var currentInstId = SL.audio.getCurrentInstrument();
    var instruments = SL.audio.getInstruments();
    var rawHum = (instruments && instruments[currentInstId]) ? (instruments[currentInstId].settings.humanization || {}) : {};
    var vel = 100;

    // Loop type: no-op for individual note playback (loops are always-on/off)
    const currentType = SL.audio.getInstrumentType(currentInstId);
    if (currentType === 'loop') {
      return;
    }

    // FM synthesis dispatch
    if (currentType === 'fm' && SL.fm && SL.fm.noteOn) {
      const fmInstId = currentInstId;
      highlightNote(midi, true);
      setTimeout(() => highlightNote(midi, false), dur * 1000);
      SL.fm.noteOn(midi, vel, fmInstId);
      setTimeout(() => {
        if (SL.fm && SL.fm.noteOff) SL.fm.noteOff(midi, fmInstId);
      }, dur * 1000);
      return;
    }

    // Physical modelling synthesis dispatch
    if (currentType === 'physical' && SL.physical && SL.physical.noteOn) {
      const physInstId = currentInstId;
      highlightNote(midi, true);
      setTimeout(() => highlightNote(midi, false), dur * 1000);
      SL.physical.noteOn(midi, vel, physInstId);
      setTimeout(() => {
        if (SL.physical && SL.physical.noteOff) SL.physical.noteOff(midi, physInstId);
      }, dur * 1000);
      return;
    }

    // Additive synthesis dispatch
    if (currentType === 'additive' && SL.additive && SL.additive.noteOn) {
      const addInstId = currentInstId;
      highlightNote(midi, true);
      setTimeout(() => highlightNote(midi, false), dur * 1000);
      SL.additive.noteOn(midi, vel, addInstId);
      setTimeout(() => {
        if (SL.additive && SL.additive.noteOff) SL.additive.noteOff(midi, addInstId);
      }, dur * 1000);
      return;
    }

    // Granular synthesis dispatch
    if (currentType === 'granular' && SL.granular && SL.granular.noteOn) {
      var granInstId = currentInstId;
      highlightNote(midi, true);
      setTimeout(function() { highlightNote(midi, false); }, dur * 1000);
      SL.granular.noteOn(midi, vel, granInstId);
      setTimeout(function() {
        if (SL.granular && SL.granular.noteOff) SL.granular.noteOff(midi, granInstId);
      }, dur * 1000);
      return;
    }

    // Vocoder synthesis dispatch
    if (currentType === 'vocoderSynth' && SL.vocoderSynth && SL.vocoderSynth.noteOn) {
      var vocInstId = currentInstId;
      highlightNote(midi, true);
      setTimeout(function() { highlightNote(midi, false); }, dur * 1000);
      SL.vocoderSynth.noteOn(midi, vel, vocInstId);
      setTimeout(function() {
        if (SL.vocoderSynth && SL.vocoderSynth.noteOff) SL.vocoderSynth.noteOff(midi, vocInstId);
      }, dur * 1000);
      return;
    }

    // Wavefolder synthesis dispatch
    if (currentType === 'wavefolder' && SL.wavefolder && SL.wavefolder.noteOn) {
      var wfInstId = currentInstId;
      highlightNote(midi, true);
      setTimeout(function() { highlightNote(midi, false); }, dur * 1000);
      SL.wavefolder.noteOn(midi, vel, wfInstId);
      setTimeout(function() {
        if (SL.wavefolder && SL.wavefolder.noteOff) SL.wavefolder.noteOff(midi, wfInstId);
      }, dur * 1000);
      return;
    }

    // Formant synthesis dispatch
    if (currentType === 'formant' && SL.formant && SL.formant.noteOn) {
      var fmtInstId = currentInstId;
      highlightNote(midi, true);
      setTimeout(function() { highlightNote(midi, false); }, dur * 1000);
      SL.formant.noteOn(midi, vel, fmtInstId);
      setTimeout(function() {
        if (SL.formant && SL.formant.noteOff) SL.formant.noteOff(midi, fmtInstId);
      }, dur * 1000);
      return;
    }

    // Modal synthesis dispatch
    if (currentType === 'modal' && SL.modal && SL.modal.noteOn) {
      var mdlInstId = currentInstId;
      highlightNote(midi, true);
      setTimeout(function() { highlightNote(midi, false); }, dur * 1000);
      SL.modal.noteOn(midi, vel, mdlInstId);
      setTimeout(function() {
        if (SL.modal && SL.modal.noteOff) SL.modal.noteOff(midi, mdlInstId);
      }, dur * 1000);
      return;
    }

    // Ring modulation synthesis dispatch
    if (currentType === 'ringmod' && SL.ringmod && SL.ringmod.noteOn) {
      var rmInstId = currentInstId;
      highlightNote(midi, true);
      setTimeout(function() { highlightNote(midi, false); }, dur * 1000);
      SL.ringmod.noteOn(midi, vel, rmInstId);
      setTimeout(function() {
        if (SL.ringmod && SL.ringmod.noteOff) SL.ringmod.noteOff(midi, rmInstId);
      }, dur * 1000);
      return;
    }

    // Chord synthesis dispatch
    if (currentType === 'chord' && SL.chord && SL.chord.noteOn) {
      var chInstId = currentInstId;
      highlightNote(midi, true);
      setTimeout(function() { highlightNote(midi, false); }, dur * 1000);
      SL.chord.noteOn(midi, vel, chInstId);
      setTimeout(function() {
        if (SL.chord && SL.chord.noteOff) SL.chord.noteOff(midi, chInstId);
      }, dur * 1000);
      return;
    }

    // SuperWave synthesis dispatch
    if (currentType === 'superwave' && SL.superwave && SL.superwave.noteOn) {
      var swInstId = currentInstId;
      highlightNote(midi, true);
      setTimeout(function() { highlightNote(midi, false); }, dur * 1000);
      SL.superwave.noteOn(midi, vel, swInstId);
      setTimeout(function() {
        if (SL.superwave && SL.superwave.noteOff) SL.superwave.noteOff(midi, swInstId);
      }, dur * 1000);
      return;
    }

    // Wavetable scanning synthesis dispatch
    if (currentType === 'wavetable' && SL.wavetableSynth && SL.wavetableSynth.noteOn) {
      var wtInstId = currentInstId;
      highlightNote(midi, true);
      setTimeout(function() { highlightNote(midi, false); }, dur * 1000);
      SL.wavetableSynth.noteOn(midi, vel, wtInstId);
      setTimeout(function() {
        if (SL.wavetableSynth && SL.wavetableSynth.noteOff) SL.wavetableSynth.noteOff(midi, wtInstId);
      }, dur * 1000);
      return;
    }

    // Phase distortion synthesis dispatch
    if (currentType === 'phasedist' && SL.phasedist && SL.phasedist.noteOn) {
      var pdInstId = currentInstId;
      highlightNote(midi, true);
      setTimeout(function() { highlightNote(midi, false); }, dur * 1000);
      SL.phasedist.noteOn(midi, vel, pdInstId);
      setTimeout(function() {
        if (SL.phasedist && SL.phasedist.noteOff) SL.phasedist.noteOff(midi, pdInstId);
      }, dur * 1000);
      return;
    }

    // Chip synth dispatch
    if (currentType === 'chip' && SL.chip && SL.chip.noteOn) {
      var chipInstId = currentInstId;
      highlightNote(midi, true);
      setTimeout(function() { highlightNote(midi, false); }, dur * 1000);
      SL.chip.noteOn(midi, vel, chipInstId);
      setTimeout(function() {
        if (SL.chip && SL.chip.noteOff) SL.chip.noteOff(midi, chipInstId);
      }, dur * 1000);
      return;
    }

    // Bytebeat dispatch (monophonic - start/stop instead of noteOn/noteOff)
    if (currentType === 'bytebeat' && SL.bytebeat && SL.bytebeat.start) {
      highlightNote(midi, true);
      setTimeout(function() { highlightNote(midi, false); }, dur * 1000);
      SL.bytebeat.start();
      setTimeout(function() {
        if (SL.bytebeat && SL.bytebeat.stop) SL.bytebeat.stop();
      }, dur * 1000);
      return;
    }

    // Vector synthesis dispatch
    if (currentType === 'vector' && SL.vector && SL.vector.noteOn) {
      var vecInstId = currentInstId;
      highlightNote(midi, true);
      setTimeout(function() { highlightNote(midi, false); }, dur * 1000);
      SL.vector.noteOn(midi, vel, vecInstId);
      setTimeout(function() {
        if (SL.vector && SL.vector.noteOff) SL.vector.noteOff(midi, vecInstId);
      }, dur * 1000);
      return;
    }

    // Drum synth dispatch
    if (currentType === 'drumsyn' && SL.drumsyn && SL.drumsyn.noteOn) {
      var dsInstId = currentInstId;
      highlightNote(midi, true);
      setTimeout(function() { highlightNote(midi, false); }, dur * 1000);
      SL.drumsyn.noteOn(midi, vel, dsInstId);
      setTimeout(function() {
        if (SL.drumsyn && SL.drumsyn.noteOff) SL.drumsyn.noteOff(midi, dsInstId);
      }, dur * 1000);
      return;
    }

    // Pulsar synthesis dispatch
    if (currentType === 'pulsar' && SL.pulsar && SL.pulsar.noteOn) {
      var plsInstId = currentInstId;
      highlightNote(midi, true);
      setTimeout(function() { highlightNote(midi, false); }, dur * 1000);
      SL.pulsar.noteOn(midi, vel, plsInstId);
      setTimeout(function() {
        if (SL.pulsar && SL.pulsar.noteOff) SL.pulsar.noteOff(midi, plsInstId);
      }, dur * 1000);
      return;
    }


    // Reed synthesis dispatch
    if (currentType === 'reed' && SL.reed && SL.reed.noteOn) {
      var reedInstId = currentInstId;
      highlightNote(midi, true);
      setTimeout(function() { highlightNote(midi, false); }, dur * 1000);
      SL.reed.noteOn(midi, vel, reedInstId);
      setTimeout(function() {
        if (SL.reed && SL.reed.noteOff) SL.reed.noteOff(midi, reedInstId);
      }, dur * 1000);
      return;
    }

    const f = SL.audio.m2f(midi);
    if (!_methodEl) { _methodEl = document.getElementById('method'); }
    const m = _methodEl.value;
    const adsr = SL.audio.getADSR();
    const oscSet = SL.audio.getOscSettings();
    const filterSettings = SL.audio.getFilterSettings();
    const sr = SL.SR || 44100;
    const TWO_PI = SL.TWO_PI || (2 * Math.PI);

    // Visual feedback
    highlightNote(midi, true);
    setTimeout(() => highlightNote(midi, false), dur * 1000);

    // Update key-tracked frequency display
    if (SL.ui && SL.ui.updateKeyTrackedFreqDisplay) {
      SL.ui.updateKeyTrackedFreqDisplay(f);
    }

    const c = SL.audio.getCtx();

    // AudioWorklet synthesis — worklet does per-voice humanization itself
    if (m === 'worklet') {
      if (SL.audio.isWorkletAvailable()) {
        var refHz = SL.audio.getRefHz();
        const workletOscSet = oscSet.map(os => ({
          wave: os.wave,
          oct: os.oct,
          detune: os.detune,
          level: os.level,
          pulseWidth: os.pulseWidth,
          superSawSpread: os.superSawSpread
        }));
        SL.audio.workletNoteOn(midi, dur, workletOscSet, adsr, refHz);
      } else {
        console.warn('Worklet not available, falling back to band-limited synthesis');
        playNoteFallback(midi, dur, adsr, oscSet, filterSettings, sr, TWO_PI, c);
      }
      return;
    }

    // ADSR micro-variation for non-worklet paths (per-call = per-voice for live play)
    var adsrHum = (typeof rawHum === 'number') ? rawHum : (rawHum.adsr || 0);
    if (adsrHum > 0) {
      const adsrJitterA = 1 + (Math.random() * 2 - 1) * adsrHum * 0.005;
      const adsrJitterD = 1 + (Math.random() * 2 - 1) * adsrHum * 0.005;
      const adsrJitterR = 1 + (Math.random() * 2 - 1) * adsrHum * 0.005;
      adsr.a *= adsrJitterA;
      adsr.d *= adsrJitterD;
      adsr.r *= adsrJitterR;
    }

    if (m === 'oscillator') {
      // Real-time oscillator synthesis with ADSR automation
      const now = c.currentTime;
      const peak = 0.12;
      const { a, d, s, r } = adsr;
      const attackTime = Math.max(0.003, a);
      const sustainEnd = Math.max(attackTime + d, dur - r);
      const filterEnvSettings = SL.audio.getFilterEnvSettings();

      const master = c.createGain();
      master.gain.setValueAtTime(0, now);
      master.gain.linearRampToValueAtTime(peak, now + attackTime);
      master.gain.linearRampToValueAtTime(peak * s, now + attackTime + d);
      master.gain.setValueAtTime(peak * s, now + sustainEnd);
      master.gain.linearRampToValueAtTime(0.001, now + dur);

      const keyTrackedFreq = SL.audio.calcKeyTrackedFreq(filterSettings.frequency, f, filterSettings.keyTrack);
      const adjustedFilterSettings = { ...filterSettings, frequency: keyTrackedFreq };

      const filterChain = SL.audio.createFilterChain(c, adjustedFilterSettings);
      if (filterChain) {
        master.connect(filterChain.input);
        filterChain.output.connect(SL.audio.getFinalDestination());
        SL.audio.applyFilterEnvelope(filterChain, f, adjustedFilterSettings, filterEnvSettings, c);
      } else {
        master.connect(SL.audio.getFinalDestination());
      }

      // Apply filter envelope to continuous noise filter too
      if (continuousNoiseFilter && filterEnvSettings.enabled) {
        updateContinuousNoiseFilterFreq(keyTrackedFreq);
        SL.audio.applyFilterEnvelope(continuousNoiseFilter, f, adjustedFilterSettings, filterEnvSettings, c);
        setTimeout(() => {
          SL.audio.applyFilterEnvelopeRelease(continuousNoiseFilter, adjustedFilterSettings, filterEnvSettings, c);
        }, Math.max(0, (dur - filterEnvSettings.release / 1000)) * 1000);
      }

      // Create oscillators from mixer settings
      oscSet.forEach(os => {
        if (os.level <= 0) return;

        const oscFreq = f * Math.pow(2, os.oct) * Math.pow(2, os.detune / 1200);

        if (os.wave === 'supersaw') {
          const superSawOscs = SL.audio.createSuperSawOscillators(c, oscFreq, os.superSawSpread, master, os.level);
          superSawOscs.forEach(osc => {
            osc.start();
            osc.stop(now + dur + 0.01);
          });
        } else if (os.wave === 'pulse') {
          const o = c.createOscillator();
          const g = c.createGain();
          const pulseWave = SL.audio.createPulseWave(c, os.pulseWidth);
          o.setPeriodicWave(pulseWave);
          o.frequency.value = oscFreq;
          g.gain.value = os.level;
          o.connect(g);
          g.connect(master);
          o.start();
          o.stop(now + dur + 0.01);
        } else if (os.wave === 'noise-white' || os.wave === 'noise-pink' || os.wave === 'noise-brown') {
          const noiseType = os.wave.replace('noise-', '');
          const noiseBuf = getNoiseBuffer(c, noiseType);
          const src = c.createBufferSource();
          src.buffer = noiseBuf;
          src.loop = true;
          const g = c.createGain();
          g.gain.value = os.level * 0.01;
          src.connect(g);
          g.connect(master);
          src.start();
          src.stop(now + dur + 0.01);
        } else {
          const o = c.createOscillator();
          const g = c.createGain();
          o.type = os.wave;
          o.frequency.value = oscFreq;
          g.gain.value = os.level;
          o.connect(g);
          g.connect(master);
          o.start();
          o.stop(now + dur + 0.01);
        }
      });

    } else if (m === 'bandlimited') {
      // Band-limited synthesis using WAVETABLE LOOKUP
      const n = Math.floor(sr * dur);
      const b = SL.audio.acquireBuffer(n);
      const filterEnvSettings = SL.audio.getFilterEnvSettings();
      const envCurve = SL.audio.getEnvelopeCurve(dur, adsr, sr);
      const WAVETABLE_WAVES = SL.audio._WAVETABLE_WAVES;

      oscSet.forEach(os => {
        if (os.level <= 0) return;
        const oscFreq = f * Math.pow(2, os.oct) * Math.pow(2, os.detune / 1200);

        // Noise oscillator: fill buffer with random samples
        if (os.wave === 'noise-white' || os.wave === 'noise-pink' || os.wave === 'noise-brown') {
          for (let i = 0; i < n; i++) {
            const env = envCurve[i];
            let sample = 0;
            if (os.wave === 'noise-white') {
              sample = Math.random() * 2 - 1;
            } else if (os.wave === 'noise-pink') {
              sample = (Math.random() * 2 - 1) * 0.5;
            } else {
              sample = (Math.random() * 2 - 1) * 0.3;
            }
            b[i] += sample * env * os.level * 0.01;
          }
          return;
        }

        if (WAVETABLE_WAVES.includes(os.wave) && SL.audio.areWavetablesReady()) {
          const table = SL.audio.getWavetableForFreq(os.wave, oscFreq);
          if (table) {
            const phaseInc = oscFreq / sr;
            let phase = 0;
            for (let i = 0; i < n; i++) {
              const env = envCurve[i];
              const sample = SL.audio.sampleWavetable(table, phase);
              b[i] += sample * env * os.level;
              phase += phaseInc;
              if (phase >= 1) phase -= 1;
            }
            return;
          }
        }

        // Fallback for pulse, supersaw, or if wavetables not ready
        const mH = Math.min(SL.audio.maxH(oscFreq), 48);
        const SUPERSAW_DETUNES = SL.audio._SUPERSAW_DETUNES;

        for (let i = 0; i < n; i++) {
          const t = i / sr;
          const ph = TWO_PI * oscFreq * t;
          const env = envCurve[i];
          let sample = 0;

          if (os.wave === 'pulse') {
            const pw = os.pulseWidth / 100;
            for (let h = 1; h <= mH; h++) {
              const harmAmp = (2 / (h * Math.PI)) * SL.audio.fastSin(h * Math.PI * pw);
              sample += harmAmp * SL.audio.fastSin(ph * h);
            }
          } else if (os.wave === 'supersaw') {
            const spreadFactor = os.superSawSpread / 50;
            const sawTable = SL.audio.getWavetableForFreq('sawtooth', oscFreq);

            if (sawTable && SL.audio.areWavetablesReady()) {
              SUPERSAW_DETUNES.forEach(detuneCents => {
                const actualDetune = detuneCents * spreadFactor;
                const voiceFreq = oscFreq * Math.pow(2, actualDetune / 1200);
                const voicePhase = ((voiceFreq * t) % 1 + 1) % 1;
                sample += SL.audio.sampleWavetable(sawTable, voicePhase) / SUPERSAW_DETUNES.length;
              });
            } else {
              SUPERSAW_DETUNES.forEach(detuneCents => {
                const actualDetune = detuneCents * spreadFactor;
                const voiceFreq = oscFreq * Math.pow(2, actualDetune / 1200);
                const voicePh = TWO_PI * voiceFreq * t;
                const voiceMH = Math.min(SL.audio.maxH(voiceFreq), 48);
                let voiceSample = 0;
                for (let h = 1; h <= voiceMH; h++) {
                  voiceSample += SL.audio.fastSin(voicePh * h) / h;
                }
                voiceSample *= 2 / Math.PI;
                sample += voiceSample / SUPERSAW_DETUNES.length;
              });
            }
          } else {
            let sg = 1;
            for (let h = 1; h <= mH; h += 2) {
              sample += sg * Math.cos(ph * h) / (h * h);
              sg = -sg;
            }
            sample *= 8 / (Math.PI * Math.PI);
          }

          b[i] += sample * env * os.level;
        }
      });

      const ab = c.createBuffer(1, n, sr);
      ab.copyToChannel(b, 0);
      SL.audio.releaseBuffer(b);
      const src = c.createBufferSource();
      const g = c.createGain();
      g.gain.value = 0.12;
      src.buffer = ab;
      src.connect(g);

      const keyTrackedFreq = SL.audio.calcKeyTrackedFreq(filterSettings.frequency, f, filterSettings.keyTrack);
      const adjustedFilterSettings = { ...filterSettings, frequency: keyTrackedFreq };

      const filterChain = SL.audio.createFilterChain(c, adjustedFilterSettings);
      if (filterChain) {
        g.connect(filterChain.input);
        filterChain.output.connect(SL.audio.getFinalDestination());
        SL.audio.applyFilterEnvelope(filterChain, f, adjustedFilterSettings, filterEnvSettings, c);
      } else {
        g.connect(SL.audio.getFinalDestination());
      }

      if (continuousNoiseFilter && filterEnvSettings.enabled) {
        updateContinuousNoiseFilterFreq(keyTrackedFreq);
        SL.audio.applyFilterEnvelope(continuousNoiseFilter, f, adjustedFilterSettings, filterEnvSettings, c);
        setTimeout(() => {
          SL.audio.applyFilterEnvelopeRelease(continuousNoiseFilter, adjustedFilterSettings, filterEnvSettings, c);
        }, Math.max(0, (dur - filterEnvSettings.release / 1000)) * 1000);
      }

      src.start();

    } else {
      // PolyBLEP synthesis
      const n = Math.floor(sr * dur);
      const b = SL.audio.acquireBuffer(n);
      const filterEnvSettings = SL.audio.getFilterEnvSettings();
      const envCurve = SL.audio.getEnvelopeCurve(dur, adsr, sr);

      oscSet.forEach(os => {
        if (os.level <= 0) return;
        const oscFreq = f * Math.pow(2, os.oct) * Math.pow(2, os.detune / 1200);
        const dt = oscFreq / sr;
        const SUPERSAW_DETUNES = SL.audio._SUPERSAW_DETUNES;

        // Noise oscillator in PolyBLEP path
        if (os.wave === 'noise-white' || os.wave === 'noise-pink' || os.wave === 'noise-brown') {
          for (let i = 0; i < n; i++) {
            const env = envCurve[i];
            let sample = 0;
            if (os.wave === 'noise-white') {
              sample = Math.random() * 2 - 1;
            } else if (os.wave === 'noise-pink') {
              sample = (Math.random() * 2 - 1) * 0.5;
            } else {
              sample = (Math.random() * 2 - 1) * 0.3;
            }
            b[i] += sample * env * os.level * 0.01;
          }
          return;
        }

        for (let i = 0; i < n; i++) {
          const t = i / sr;
          const ph = TWO_PI * oscFreq * t;
          const phase = (t * oscFreq) % 1;
          const env = envCurve[i];
          let sample = 0;

          if (os.wave === 'sine') {
            sample = SL.audio.fastSin(ph);
          } else if (os.wave === 'square') {
            sample = SL.audio.polyBlepSquare(phase, dt);
          } else if (os.wave === 'sawtooth') {
            sample = SL.audio.polyBlepSaw(phase, dt);
          } else if (os.wave === 'triangle') {
            sample = SL.audio.polyBlepTriangle(phase, dt);
          } else if (os.wave === 'pulse') {
            const pw = os.pulseWidth / 100;
            sample = SL.audio.polyBlepPulse(phase, dt, pw);
          } else if (os.wave === 'supersaw') {
            const spreadFactor = os.superSawSpread / 50;
            SUPERSAW_DETUNES.forEach(detuneCents => {
              const actualDetune = detuneCents * spreadFactor;
              const voiceFreq = oscFreq * Math.pow(2, actualDetune / 1200);
              const voiceDt = voiceFreq / sr;
              const voicePhase = (t * voiceFreq) % 1;
              const voiceSample = SL.audio.polyBlepSaw(voicePhase, voiceDt);
              sample += voiceSample / SUPERSAW_DETUNES.length;
            });
          } else {
            sample = SL.audio.polyBlepTriangle(phase, dt);
          }

          b[i] += sample * env * os.level;
        }
      });

      const ab = c.createBuffer(1, n, sr);
      ab.copyToChannel(b, 0);
      SL.audio.releaseBuffer(b);
      const src = c.createBufferSource();
      const g = c.createGain();
      g.gain.value = 0.12;
      src.buffer = ab;
      src.connect(g);

      const keyTrackedFreq = SL.audio.calcKeyTrackedFreq(filterSettings.frequency, f, filterSettings.keyTrack);
      const adjustedFilterSettings = { ...filterSettings, frequency: keyTrackedFreq };

      const filterChain = SL.audio.createFilterChain(c, adjustedFilterSettings);
      if (filterChain) {
        g.connect(filterChain.input);
        filterChain.output.connect(SL.audio.getFinalDestination());
        SL.audio.applyFilterEnvelope(filterChain, f, adjustedFilterSettings, filterEnvSettings, c);
      } else {
        g.connect(SL.audio.getFinalDestination());
      }

      if (continuousNoiseFilter && filterEnvSettings.enabled) {
        updateContinuousNoiseFilterFreq(keyTrackedFreq);
        SL.audio.applyFilterEnvelope(continuousNoiseFilter, f, adjustedFilterSettings, filterEnvSettings, c);
        setTimeout(() => {
          SL.audio.applyFilterEnvelopeRelease(continuousNoiseFilter, adjustedFilterSettings, filterEnvSettings, c);
        }, Math.max(0, (dur - filterEnvSettings.release / 1000)) * 1000);
      }

      src.start();
    }
  }

  /**
   * Fallback synthesis when worklet is not available
   */
  function playNoteFallback(midi, dur, adsr, oscSet, filterSettings, sr, TWO_PI, c) {
    const f = SL.audio.m2f(midi);
    const n = Math.floor(sr * dur);
    const b = SL.audio.acquireBuffer(n);
    const filterEnvSettings = SL.audio.getFilterEnvSettings();
    const envCurve = SL.audio.getEnvelopeCurve(dur, adsr, sr);
    const WAVETABLE_WAVES = SL.audio._WAVETABLE_WAVES;
    const SUPERSAW_DETUNES = SL.audio._SUPERSAW_DETUNES;

    oscSet.forEach(os => {
      if (os.level <= 0) return;
      const oscFreq = f * Math.pow(2, os.oct) * Math.pow(2, os.detune / 1200);

      // Noise oscillator in fallback path
      if (os.wave === 'noise-white' || os.wave === 'noise-pink' || os.wave === 'noise-brown') {
        for (let i = 0; i < n; i++) {
          const env = envCurve[i];
          let noiseSample = (os.wave === 'noise-white') ? (Math.random() * 2 - 1) :
                            (os.wave === 'noise-pink') ? ((Math.random() * 2 - 1) * 0.5) :
                            ((Math.random() * 2 - 1) * 0.3);
          b[i] += noiseSample * env * os.level * 0.01;
        }
        return;
      }

      if (WAVETABLE_WAVES.includes(os.wave) && SL.audio.areWavetablesReady()) {
        const table = SL.audio.getWavetableForFreq(os.wave, oscFreq);
        if (table) {
          const phaseInc = oscFreq / sr;
          let phase = 0;
          for (let i = 0; i < n; i++) {
            const env = envCurve[i];
            const sample = SL.audio.sampleWavetable(table, phase);
            b[i] += sample * env * os.level;
            phase += phaseInc;
            if (phase >= 1) phase -= 1;
          }
          return;
        }
      }

      const mH = Math.min(SL.audio.maxH(oscFreq), 48);

      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const ph = TWO_PI * oscFreq * t;
        const env = envCurve[i];
        let sample = 0;

        if (os.wave === 'pulse') {
          const pw = os.pulseWidth / 100;
          for (let h = 1; h <= mH; h++) {
            const harmAmp = (2 / (h * Math.PI)) * SL.audio.fastSin(h * Math.PI * pw);
            sample += harmAmp * SL.audio.fastSin(ph * h);
          }
        } else if (os.wave === 'supersaw') {
          const spreadFactor = os.superSawSpread / 50;
          const sawTable = SL.audio.getWavetableForFreq('sawtooth', oscFreq);

          if (sawTable && SL.audio.areWavetablesReady()) {
            SUPERSAW_DETUNES.forEach(detuneCents => {
              const actualDetune = detuneCents * spreadFactor;
              const voiceFreq = oscFreq * Math.pow(2, actualDetune / 1200);
              const voicePhase = ((voiceFreq * t) % 1 + 1) % 1;
              sample += SL.audio.sampleWavetable(sawTable, voicePhase) / SUPERSAW_DETUNES.length;
            });
          }
        } else {
          let sg = 1;
          for (let h = 1; h <= mH; h += 2) {
            sample += sg * Math.cos(ph * h) / (h * h);
            sg = -sg;
          }
          sample *= 8 / (Math.PI * Math.PI);
        }

        b[i] += sample * env * os.level;
      }
    });

    const ab = c.createBuffer(1, n, sr);
    ab.copyToChannel(b, 0);
    SL.audio.releaseBuffer(b);
    const src = c.createBufferSource();
    const g = c.createGain();
    g.gain.value = 0.12;
    src.buffer = ab;
    src.connect(g);

    const keyTrackedFreq = SL.audio.calcKeyTrackedFreq(filterSettings.frequency, f, filterSettings.keyTrack);
    const adjustedFilterSettings = { ...filterSettings, frequency: keyTrackedFreq };

    const filterChain = SL.audio.createFilterChain(c, adjustedFilterSettings);
    if (filterChain) {
      g.connect(filterChain.input);
      filterChain.output.connect(SL.audio.getFinalDestination());
      SL.audio.applyFilterEnvelope(filterChain, f, adjustedFilterSettings, filterEnvSettings, c);
    } else {
      g.connect(SL.audio.getFinalDestination());
    }

    src.start();
  }

  /**
   * Fallback synthesis with custom destination
   */
  function playNoteFallbackWithDestination(midi, dur, adsr, oscSet, filterSettings, filterEnvSettings, sr, TWO_PI, c, destination) {
    const f = SL.audio.m2f(midi);
    const n = Math.floor(sr * dur);
    const b = SL.audio.acquireBuffer(n);
    const envCurve = SL.audio.getEnvelopeCurve(dur, adsr, sr);
    const WAVETABLE_WAVES = SL.audio._WAVETABLE_WAVES;
    const SUPERSAW_DETUNES = SL.audio._SUPERSAW_DETUNES;

    oscSet.forEach(os => {
      if (os.level <= 0) return;
      const oscFreq = f * Math.pow(2, os.oct) * Math.pow(2, os.detune / 1200);

      // Noise oscillator in fallback path
      if (os.wave === 'noise-white' || os.wave === 'noise-pink' || os.wave === 'noise-brown') {
        for (let i = 0; i < n; i++) {
          const env = envCurve[i];
          let noiseSample = (os.wave === 'noise-white') ? (Math.random() * 2 - 1) :
                            (os.wave === 'noise-pink') ? ((Math.random() * 2 - 1) * 0.5) :
                            ((Math.random() * 2 - 1) * 0.3);
          b[i] += noiseSample * env * os.level * 0.01;
        }
        return;
      }

      if (WAVETABLE_WAVES.includes(os.wave) && SL.audio.areWavetablesReady()) {
        const table = SL.audio.getWavetableForFreq(os.wave, oscFreq);
        if (table) {
          const phaseInc = oscFreq / sr;
          let phase = 0;
          for (let i = 0; i < n; i++) {
            const env = envCurve[i];
            const sample = SL.audio.sampleWavetable(table, phase);
            b[i] += sample * env * os.level;
            phase += phaseInc;
            if (phase >= 1) phase -= 1;
          }
          return;
        }
      }

      const mH = Math.min(SL.audio.maxH(oscFreq), 48);

      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const ph = TWO_PI * oscFreq * t;
        const env = envCurve[i];
        let sample = 0;

        if (os.wave === 'pulse') {
          const pw = os.pulseWidth / 100;
          for (let h = 1; h <= mH; h++) {
            const harmAmp = (2 / (h * Math.PI)) * SL.audio.fastSin(h * Math.PI * pw);
            sample += harmAmp * SL.audio.fastSin(ph * h);
          }
        } else if (os.wave === 'supersaw') {
          const spreadFactor = os.superSawSpread / 50;
          const sawTable = SL.audio.getWavetableForFreq('sawtooth', oscFreq);

          if (sawTable && SL.audio.areWavetablesReady()) {
            SUPERSAW_DETUNES.forEach(detuneCents => {
              const actualDetune = detuneCents * spreadFactor;
              const voiceFreq = oscFreq * Math.pow(2, actualDetune / 1200);
              const voicePhase = ((voiceFreq * t) % 1 + 1) % 1;
              sample += SL.audio.sampleWavetable(sawTable, voicePhase) / SUPERSAW_DETUNES.length;
            });
          }
        } else {
          let sg = 1;
          for (let h = 1; h <= mH; h += 2) {
            sample += sg * Math.cos(ph * h) / (h * h);
            sg = -sg;
          }
          sample *= 8 / (Math.PI * Math.PI);
        }

        b[i] += sample * env * os.level;
      }
    });

    const ab = c.createBuffer(1, n, sr);
    ab.copyToChannel(b, 0);
    SL.audio.releaseBuffer(b);
    const src = c.createBufferSource();
    const g = c.createGain();
    g.gain.value = 0.12;
    src.buffer = ab;
    src.connect(g);

    const keyTrackedFreq = SL.audio.calcKeyTrackedFreq(filterSettings.frequency, f, filterSettings.keyTrack);
    const adjustedFilterSettings = { ...filterSettings, frequency: keyTrackedFreq };

    const filterChain = SL.audio.createFilterChain(c, adjustedFilterSettings);
    if (filterChain) {
      g.connect(filterChain.input);
      filterChain.output.connect(destination);
      SL.audio.applyFilterEnvelope(filterChain, f, adjustedFilterSettings, filterEnvSettings, c);
    } else {
      g.connect(destination);
    }

    src.start();
  }

  // ============================================================
  // Sustained Note Management
  // ============================================================

  /**
   * Start a sustained note (for keyboard/mouse hold)
   * @param {number} midi - MIDI note number
   * @param {number} [velocity=100] - MIDI velocity (0-127)
   */
  function startSustainedNote(midi, velocity) {
    if (midi < 0 || midi > 127) return;
    // A-06: Reset idle auto-suspend timer on note activity
    if (SL.audio && SL.audio.resetIdleSuspendTimer) {
      SL.audio.resetIdleSuspendTimer();
    }
    // Auto-show scope on first note (Fix 24)
    if (SL.analyzer && SL.analyzer.autoShowOnFirstNote) {
      SL.analyzer.autoShowOnFirstNote();
    }
    var velLinear = (typeof velocity === 'number') ? (velocity / 127) : (100 / 127);
    var velGain = velLinear * velLinear;
    const activeOscs = SL.audio.getActiveOscillators();
    if (activeOscs.has(midi)) return;

    const currentInstrument = SL.audio.getCurrentInstrument();

    // Engine dispatch table — maps type names to their SL module
    const currentType = SL.audio.getInstrumentType(currentInstrument);
    var engines = {
      fm: SL.fm,
      physical: SL.physical,
      additive: SL.additive,
      granular: SL.granular,
      vocoderSynth: SL.vocoderSynth,
      wavefolder: SL.wavefolder,
      formant: SL.formant,
      modal: SL.modal,
      ringmod: SL.ringmod,
      chord: SL.chord,
      superwave: SL.superwave,
      wavetable: SL.wavetableSynth,
      phasedist: SL.phasedist,
      chip: SL.chip,
      vector: SL.vector,
      drumsyn: SL.drumsyn,
      pulsar: SL.pulsar,
      reed: SL.reed
    };

    // Bytebeat is special (monophonic, uses .start() not .noteOn())
    if (currentType === 'bytebeat' && SL.bytebeat && SL.bytebeat.start) {
      try {
        SL.bytebeat.start();
      } catch (bytebeatErr) {
        console.error('[note-playback] bytebeat.start() threw:', bytebeatErr);
        return;
      }
      activeOscs.set(midi, { bytebeat: true });
      highlightNote(midi, true);
      return;
    }

    // Standard engine dispatch via table
    var engine = engines[currentType];
    if (engine && engine.noteOn) {
      try {
        engine.noteOn(midi, null, currentInstrument);
      } catch (engineErr) {
        console.error('[note-playback] engine.noteOn() threw for ' + currentType + ':', engineErr);
        return;
      }
      var oscEntry = {};
      oscEntry[currentType] = true;
      activeOscs.set(midi, oscEntry);
      highlightNote(midi, true);
      return;
    }

    const c = SL.audio.getCtx();
    const f = SL.audio.m2f(midi);
    const oscSet = SL.audio.getOscSettings();
    const filterSettings = SL.audio.getFilterSettings();
    const noiseSettings = SL.audio.getNoiseSettings();
    const filterEnvSettings = SL.audio.getFilterEnvSettings();


    const adsr = SL.audio.getADSR();
    const now = c.currentTime;
    const peak = 0.12 * velGain;
    const attackTime = Math.max(0.003, adsr.a);

    // Acquire a voice from the pool
    const voice = SL.audio.acquireVoice(currentInstrument, midi);

    // Hard cap reached — no voice available, bail gracefully
    if (!voice) {
      console.warn('[note-playback] Voice pool exhausted, dropping note ' + midi);
      return;
    }

    var decayTime = Math.max(0.003, adsr.d);
    var sustainLevel = peak * adsr.s;
    var releaseTime = Math.max(0.003, adsr.r);

    // Schedule full ADSR attack + decay + sustain-hold on masterGain
    voice.masterGain.gain.setValueAtTime(0, now);
    voice.masterGain.gain.linearRampToValueAtTime(peak, now + attackTime);
    voice.masterGain.gain.setTargetAtTime(sustainLevel, now + attackTime, decayTime / 5);

    // Store ADSR release params on voice so releaseVoice can fade smoothly
    voice.adsrRelease = releaseTime;
    voice.sustainLevel = sustainLevel;

    const keyTrackedFreq = SL.audio.calcKeyTrackedFreq(filterSettings.frequency, f, filterSettings.keyTrack);
    const adjustedFilterSettings = { ...filterSettings, frequency: keyTrackedFreq };

    const filterChain = SL.audio.createFilterChain(c, adjustedFilterSettings);
    voice.filterChain = filterChain;
    voice.filterSettings = adjustedFilterSettings;
    voice.filterEnvSettings = filterEnvSettings;

    if (filterChain) {
      voice.masterGain.connect(filterChain.input);
      filterChain.output.connect(SL.audio.getFinalDestination());
      SL.audio.applyFilterEnvelope(filterChain, f, adjustedFilterSettings, filterEnvSettings, c);
    } else {
      voice.masterGain.connect(SL.audio.getFinalDestination());
    }

    // Create noise source if enabled
    if (noiseSettings.enabled) {
      const noiseNode = createNoiseSource(c, noiseSettings);
      if (noiseNode) {
        noiseNode.gain.connect(voice.masterGain);
        noiseNode.source.start();
        voice.noiseNode = noiseNode;
      }
    }

    // Create oscillators
    oscSet.forEach((os, idx) => {
      if (os.level <= 0) return;
      const oscFreq = f * Math.pow(2, os.oct) * Math.pow(2, os.detune / 1200);

      if (os.wave === 'supersaw') {
        const superSawOscs = SL.audio.createSuperSawOscillators(c, oscFreq, os.superSawSpread, voice.masterGain, os.level);
        superSawOscs.forEach(osc => {
          osc.start();
          voice.oscillators.push({ osc: osc, gain: null });
        });
      } else if (os.wave === 'pulse') {
        const o = c.createOscillator();
        const pulseWave = SL.audio.createPulseWave(c, os.pulseWidth);
        o.setPeriodicWave(pulseWave);
        o.frequency.value = oscFreq;

        const g = idx < voice.oscGains.length ? voice.oscGains[idx] : c.createGain();
        g.gain.setValueAtTime(os.level, c.currentTime);
        g.disconnect();
        g.connect(voice.masterGain);

        o.connect(g);
        o.start();
        voice.oscillators.push({ osc: o, gain: g });
      } else if (os.wave === 'noise-white' || os.wave === 'noise-pink' || os.wave === 'noise-brown') {
        // Noise oscillator: use AudioBufferSourceNode with cached noise buffer
        const noiseType = os.wave.replace('noise-', '');
        const noiseBuf = getNoiseBuffer(c, noiseType);
        const src = c.createBufferSource();
        src.buffer = noiseBuf;
        src.loop = true;

        const g = idx < voice.oscGains.length ? voice.oscGains[idx] : c.createGain();
        g.gain.setValueAtTime(os.level * 0.01, c.currentTime);
        g.disconnect();
        g.connect(voice.masterGain);

        src.connect(g);
        src.start();
        voice.oscillators.push({ osc: src, gain: g });
      } else {
        const o = c.createOscillator();
        o.type = os.wave;
        o.frequency.value = oscFreq;

        const g = idx < voice.oscGains.length ? voice.oscGains[idx] : c.createGain();
        g.gain.setValueAtTime(os.level, c.currentTime);
        g.disconnect();
        g.connect(voice.masterGain);

        o.connect(g);
        o.start();
        voice.oscillators.push({ osc: o, gain: g });
      }
    });

    // Apply LFO modulation to the new voice
    if (SL.audio.applyLFOToVoice) {
      SL.audio.applyLFOToVoice(currentInstrument, voice);
    }

    // Apply mod matrix routings to the new voice
    if (SL.audio.applyModMatrixToVoice) {
      SL.audio.applyModMatrixToVoice(currentInstrument, voice);
    }

    const instruments = SL.audio.getInstruments();
    const effectChain = SL.audio.effectChain;

    activeOscs.set(midi, {
      voice,
      oscillators: voice.oscillators,
      master: voice.masterGain,
      filterChain: voice.filterChain,
      noiseNode: voice.noiseNode,
      filterSettings: adjustedFilterSettings,
      filterEnvSettings
    });
    highlightNote(midi, true);

    if (SL.keyboard && SL.keyboard.updateNoteReadout) {
      SL.keyboard.updateNoteReadout(midi);
    }
    if (SL.ui && SL.ui.updateKeyTrackedFreqDisplay) {
      SL.ui.updateKeyTrackedFreqDisplay(f);
    }

    if (continuousNoiseFilter && filterEnvSettings.enabled) {
      updateContinuousNoiseFilterFreq(keyTrackedFreq);
      SL.audio.applyFilterEnvelope(continuousNoiseFilter, f, adjustedFilterSettings, filterEnvSettings, c);
    }
  }

  /**
   * Update continuous noise filter base frequency
   * @param {number} freq - New cutoff frequency
   */
  function updateContinuousNoiseFilterFreq(freq) {
    if (!continuousNoiseFilter || !continuousNoiseFilter.filters) return;
    continuousNoiseFilter.filters.forEach(filter => {
      if (filter instanceof BiquadFilterNode) {
        filter.frequency.value = freq;
      }
    });
  }

  /**
   * Stop a sustained note
   * @param {number} midi - MIDI note number
   */
  function stopSustainedNote(midi) {
    const activeOscs = SL.audio.getActiveOscillators();
    const node = activeOscs.get(midi);
    if (node) {
      const currentInstrument = SL.audio.getCurrentInstrument();

      if (node.fm && SL.fm && SL.fm.noteOff) {
        SL.fm.noteOff(midi, currentInstrument);
        activeOscs.delete(midi);
        highlightNote(midi, false);
        return;
      }

      if (node.physical && SL.physical && SL.physical.noteOff) {
        SL.physical.noteOff(midi, currentInstrument);
        activeOscs.delete(midi);
        highlightNote(midi, false);
        return;
      }

      if (node.additive && SL.additive && SL.additive.noteOff) {
        SL.additive.noteOff(midi, currentInstrument);
        activeOscs.delete(midi);
        highlightNote(midi, false);
        return;
      }

      if (node.granular && SL.granular && SL.granular.noteOff) {
        SL.granular.noteOff(midi, currentInstrument);
        activeOscs.delete(midi);
        highlightNote(midi, false);
        return;
      }

      if (node.vocoderSynth && SL.vocoderSynth && SL.vocoderSynth.noteOff) {
        SL.vocoderSynth.noteOff(midi, currentInstrument);
        activeOscs.delete(midi);
        highlightNote(midi, false);
        return;
      }

      if (node.wavefolder && SL.wavefolder && SL.wavefolder.noteOff) {
        SL.wavefolder.noteOff(midi, currentInstrument);
        activeOscs.delete(midi);
        highlightNote(midi, false);
        return;
      }

      if (node.formant && SL.formant && SL.formant.noteOff) {
        SL.formant.noteOff(midi, currentInstrument);
        activeOscs.delete(midi);
        highlightNote(midi, false);
        return;
      }

      if (node.modal && SL.modal && SL.modal.noteOff) {
        SL.modal.noteOff(midi, currentInstrument);
        activeOscs.delete(midi);
        highlightNote(midi, false);
        return;
      }

      if (node.ringmod && SL.ringmod && SL.ringmod.noteOff) {
        SL.ringmod.noteOff(midi, currentInstrument);
        activeOscs.delete(midi);
        highlightNote(midi, false);
        return;
      }

      if (node.chord && SL.chord && SL.chord.noteOff) {
        SL.chord.noteOff(midi, currentInstrument);
        activeOscs.delete(midi);
        highlightNote(midi, false);
        return;
      }

      if (node.superwave && SL.superwave && SL.superwave.noteOff) {
        SL.superwave.noteOff(midi, currentInstrument);
        activeOscs.delete(midi);
        highlightNote(midi, false);
        return;
      }

      if (node.wavetable && SL.wavetableSynth && SL.wavetableSynth.noteOff) {
        SL.wavetableSynth.noteOff(midi, currentInstrument);
        activeOscs.delete(midi);
        highlightNote(midi, false);
        return;
      }

      if (node.phasedist && SL.phasedist && SL.phasedist.noteOff) {
        SL.phasedist.noteOff(midi, currentInstrument);
        activeOscs.delete(midi);
        highlightNote(midi, false);
        return;
      }

      if (node.chip && SL.chip && SL.chip.noteOff) {
        SL.chip.noteOff(midi, currentInstrument);
        activeOscs.delete(midi);
        highlightNote(midi, false);
        return;
      }

      if (node.bytebeat && SL.bytebeat && SL.bytebeat.stop) {
        SL.bytebeat.stop();
        activeOscs.delete(midi);
        highlightNote(midi, false);
        return;
      }

      if (node.vector && SL.vector && SL.vector.noteOff) {
        SL.vector.noteOff(midi, currentInstrument);
        activeOscs.delete(midi);
        highlightNote(midi, false);
        return;
      }

      if (node.drumsyn && SL.drumsyn && SL.drumsyn.noteOff) {
        SL.drumsyn.noteOff(midi, currentInstrument);
        activeOscs.delete(midi);
        highlightNote(midi, false);
        return;
      }

      if (node.pulsar && SL.pulsar && SL.pulsar.noteOff) {
        SL.pulsar.noteOff(midi, currentInstrument);
        activeOscs.delete(midi);
        highlightNote(midi, false);
        return;
      }


      if (node.reed && SL.reed && SL.reed.noteOff) {
        SL.reed.noteOff(midi, currentInstrument);
        activeOscs.delete(midi);
        highlightNote(midi, false);
        return;
      }

      const c = SL.audio.getCtx();

      if (node.filterChain && node.filterSettings && node.filterEnvSettings) {
        SL.audio.applyFilterEnvelopeRelease(node.filterChain, node.filterSettings, node.filterEnvSettings, c);
      }

      // Remove LFO modulation from voice
      if (SL.audio.removeLFOFromVoice && node.voice) {
        SL.audio.removeLFOFromVoice(currentInstrument, node.voice);
      }

      // Remove mod matrix routings from voice
      if (SL.audio.removeModMatrixFromVoice && node.voice) {
        SL.audio.removeModMatrixFromVoice(currentInstrument, node.voice);
      }

      if (node.voice) {
        SL.audio.releaseVoice(node.voice, false);
      } else {
        var legacyAdsr = SL.audio.getADSR();
        var legacyRelease = Math.max(0.003, legacyAdsr.r);
        node.master.gain.cancelScheduledValues(c.currentTime);
        node.master.gain.setValueAtTime(node.master.gain.value, c.currentTime);
        node.master.gain.setTargetAtTime(0.001, c.currentTime, legacyRelease / 5);
        node.oscillators.forEach(o => o.osc.stop(c.currentTime + legacyRelease + 0.01));
        if (node.noiseNode && node.noiseNode.source) {
          try { node.noiseNode.source.stop(c.currentTime + legacyRelease + 0.01); } catch (e) { /* ignore */ }
        }
      }

      activeOscs.delete(midi);
      highlightNote(midi, false);

      if (activeOscs.size === 0 && SL.ui && SL.ui.updateKeyTrackedFreqDisplay) {
        SL.ui.updateKeyTrackedFreqDisplay(null);
      }

      if (activeOscs.size === 0 && continuousNoiseFilter && node.filterEnvSettings && node.filterEnvSettings.enabled) {
        SL.audio.applyFilterEnvelopeRelease(continuousNoiseFilter, node.filterSettings, node.filterEnvSettings, c);
      }
    }
  }

  /**
   * Start a sustained chord
   * @param {number[]} notes - Array of MIDI note numbers
   * @param {string} name - Chord name
   * @param {HTMLElement} [btn] - Button element
   */
  function startSustainedChord(notes, name, btn) {
    if (btn) btn.classList.add('playing');
    notes.forEach(midi => startSustainedNote(midi));

    const noteReadout = document.getElementById('noteReadout');
    if (noteReadout && SL.keyboard) {
      const noteNames = notes.map(midi => SL.keyboard.midiToName(midi)).join(', ');
      noteReadout.textContent = name + ' (' + noteNames + ')';
    }
  }

  /**
   * Stop all currently sustained notes
   */
  function stopAllSustained() {
    const activeOscs = SL.audio.getActiveOscillators();
    activeOscs.forEach((node, midi) => stopSustainedNote(midi));
  }

  /**
   * Refresh all active oscillators with current mixer settings
   */
  function refreshActiveOscillators() {

    // Always update FM/physical filters (they don't depend on active subtractive voices)
    const instId = SL.audio.getCurrentInstrument();
    if (SL.fm && SL.fm.updateFilter) SL.fm.updateFilter(instId);
    if (SL.physical && SL.physical.updateFilter) SL.physical.updateFilter(instId);
    if (SL.granular && SL.granular.updateFilter) SL.granular.updateFilter(instId);
    if (SL.vocoderSynth && SL.vocoderSynth.updateFilter) SL.vocoderSynth.updateFilter(instId);
    if (SL.wavefolder && SL.wavefolder.updateFilter) SL.wavefolder.updateFilter(instId);
    if (SL.formant && SL.formant.updateFilter) SL.formant.updateFilter(instId);
    if (SL.modal && SL.modal.updateFilter) SL.modal.updateFilter(instId);
    if (SL.ringmod && SL.ringmod.updateFilter) SL.ringmod.updateFilter(instId);
    if (SL.chord && SL.chord.updateFilter) SL.chord.updateFilter(instId);
    if (SL.superwave && SL.superwave.updateFilter) SL.superwave.updateFilter(instId);
    if (SL.wavetableSynth && SL.wavetableSynth.updateFilter) SL.wavetableSynth.updateFilter(instId);
    if (SL.phasedist && SL.phasedist.updateFilter) SL.phasedist.updateFilter(instId);
    if (SL.chip && SL.chip.updateFilter) SL.chip.updateFilter(instId);
    if (SL.bytebeat && SL.bytebeat.updateFilter) SL.bytebeat.updateFilter(instId);
    if (SL.vector && SL.vector.updateFilter) SL.vector.updateFilter(instId);
    if (SL.drumsyn && SL.drumsyn.updateFilter) SL.drumsyn.updateFilter(instId);
    if (SL.pulsar && SL.pulsar.updateFilter) SL.pulsar.updateFilter(instId);
    if (SL.reed && SL.reed.updateFilter) SL.reed.updateFilter(instId);

    const activeOscs = SL.audio.getActiveOscillators();
    const activeMidis = Array.from(activeOscs.keys());

    if (activeMidis.length === 0) {
      return;
    }

    const c = SL.audio.getCtx();
    activeOscs.forEach((node, midi) => {
      node.master.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.02);
      node.oscillators.forEach(o => o.osc.stop(c.currentTime + 0.03));
      if (node.noiseNode && node.noiseNode.source) {
        try { node.noiseNode.source.stop(c.currentTime + 0.03); } catch (e) { /* ignore */ }
      }
    });
    activeOscs.clear();

    const oscSet = SL.audio.getOscSettings();
    const filterSettings = SL.audio.getFilterSettings();
    const noiseSettings = SL.audio.getNoiseSettings();
    const filterEnvSettings = SL.audio.getFilterEnvSettings();

    activeMidis.forEach(midi => {
      const f = SL.audio.m2f(midi);

      const master = c.createGain();
      master.gain.value = 0.12;

      const keyTrackedFreq = SL.audio.calcKeyTrackedFreq(filterSettings.frequency, f, filterSettings.keyTrack);
      const adjustedFilterSettings = { ...filterSettings, frequency: keyTrackedFreq };

      const filterChain = SL.audio.createFilterChain(c, adjustedFilterSettings);
      if (filterChain) {
        master.connect(filterChain.input);
        filterChain.output.connect(SL.audio.getFinalDestination());
        SL.audio.applyFilterEnvelope(filterChain, f, adjustedFilterSettings, filterEnvSettings, c);
      } else {
        master.connect(SL.audio.getFinalDestination());
      }

      let noiseNode = null;
      if (noiseSettings.enabled) {
        noiseNode = createNoiseSource(c, noiseSettings);
        if (noiseNode) {
          noiseNode.gain.connect(master);
          noiseNode.source.start();
        }
      }

      const oscillators = [];
      oscSet.forEach((os, idx) => {
        if (os.level <= 0) return;
        const oscFreq = f * Math.pow(2, os.oct) * Math.pow(2, os.detune / 1200);

        if (os.wave === 'supersaw') {
          const superSawOscs = SL.audio.createSuperSawOscillators(c, oscFreq, os.superSawSpread, master, os.level);
          superSawOscs.forEach(osc => {
            osc.start();
            oscillators.push({ osc: osc, gain: null });
          });
        } else if (os.wave === 'pulse') {
          const o = c.createOscillator();
          const g = c.createGain();
          const pulseWave = SL.audio.createPulseWave(c, os.pulseWidth);
          o.setPeriodicWave(pulseWave);
          o.frequency.value = oscFreq;
          g.gain.value = os.level;
          o.connect(g);
          g.connect(master);
          o.start();
          oscillators.push({ osc: o, gain: g });
        } else {
          const o = c.createOscillator();
          const g = c.createGain();
          o.type = os.wave;
          o.frequency.value = oscFreq;
          g.gain.value = os.level;
          o.connect(g);
          g.connect(master);
          o.start();
          oscillators.push({ osc: o, gain: g });
        }
      });

      activeOscs.set(midi, {
        oscillators,
        master,
        filterChain,
        noiseNode,
        filterSettings: adjustedFilterSettings,
        filterEnvSettings
      });
      highlightNote(midi, true);
    });
  }

  /**
   * Update filter parameters on all active notes in real-time
   */
  function refreshFilter() {
    const filterSettings = SL.audio.getFilterSettings();
    const c = SL.audio.getCtx();
    const model = filterSettings.model || 'butterworth';
    const activeOscs = SL.audio.getActiveOscillators();

    activeOscs.forEach((node, midi) => {
      if (node.filterChain && node.filterChain.filters) {
        updateFilterChainParams(node.filterChain.filters, filterSettings, model, c);
      }
    });

    if (continuousNoiseFilter && continuousNoiseFilter.filters) {
      updateFilterChainParams(continuousNoiseFilter.filters, filterSettings, model, c);
    }

    // Update worklet filter for the current instrument
    var instId = SL.audio.getCurrentInstrument();
    if (SL.audio.updateWorkletFilter) {
      SL.audio.updateWorkletFilter(instId);
    }

    // Update FM, physical, and granular engine filters too
    if (SL.fm && SL.fm.updateFilter) {
      SL.fm.updateFilter(instId);
    }
    if (SL.physical && SL.physical.updateFilter) {
      SL.physical.updateFilter(instId);
    }
    if (SL.granular && SL.granular.updateFilter) {
      SL.granular.updateFilter(instId);
    }
    if (SL.vocoderSynth && SL.vocoderSynth.updateFilter) {
      SL.vocoderSynth.updateFilter(instId);
    }
    if (SL.wavefolder && SL.wavefolder.updateFilter) {
      SL.wavefolder.updateFilter(instId);
    }
    if (SL.formant && SL.formant.updateFilter) {
      SL.formant.updateFilter(instId);
    }
    if (SL.modal && SL.modal.updateFilter) {
      SL.modal.updateFilter(instId);
    }
    if (SL.ringmod && SL.ringmod.updateFilter) {
      SL.ringmod.updateFilter(instId);
    }
    if (SL.chord && SL.chord.updateFilter) {
      SL.chord.updateFilter(instId);
    }
    if (SL.superwave && SL.superwave.updateFilter) {
      SL.superwave.updateFilter(instId);
    }
    if (SL.wavetableSynth && SL.wavetableSynth.updateFilter) {
      SL.wavetableSynth.updateFilter(instId);
    }
    if (SL.phasedist && SL.phasedist.updateFilter) {
      SL.phasedist.updateFilter(instId);
    }
    if (SL.chip && SL.chip.updateFilter) {
      SL.chip.updateFilter(instId);
    }
    if (SL.bytebeat && SL.bytebeat.updateFilter) {
      SL.bytebeat.updateFilter(instId);
    }
    if (SL.vector && SL.vector.updateFilter) {
      SL.vector.updateFilter(instId);
    }
    if (SL.drumsyn && SL.drumsyn.updateFilter) {
      SL.drumsyn.updateFilter(instId);
    }
    if (SL.pulsar && SL.pulsar.updateFilter) {
      SL.pulsar.updateFilter(instId);
    }
    if (SL.reed && SL.reed.updateFilter) {
      SL.reed.updateFilter(instId);
    }
  }

  /**
   * Helper to update parameters on a filter chain
   */
  function updateFilterChainParams(filters, filterSettings, model, c) {
    filters.forEach((filter, idx) => {
      // Moog ladder ScriptProcessor: update cutoff/resonance properties directly
      if (filter.moogCutoff !== undefined) {
        filter.moogCutoff = filterSettings.frequency;
        filter.moogResonance = Math.min(4, filterSettings.resonance / 5);
      } else if (filter instanceof BiquadFilterNode) {
        filter.frequency.linearRampToValueAtTime(
          filterSettings.frequency,
          c.currentTime + 0.02
        );

        let qValue;
        switch (model) {
          case 'moog':
            const resonanceFactor = Math.pow(filterSettings.resonance / 10, 0.7);
            const biquadIndex = filters
              .slice(0, idx + 1)
              .filter(f => f instanceof BiquadFilterNode).length;
            const numBiquads = filters
              .filter(f => f instanceof BiquadFilterNode).length;
            qValue = 0.5 + (resonanceFactor * biquadIndex / numBiquads) * 8;
            qValue = Math.min(qValue, 20);
            break;

          case 'svf':
            const svfQ = 0.5 + (filterSettings.resonance * 2.5);
            qValue = idx === 0 ? svfQ : svfQ * 0.8;
            break;

          case 'ms20':
            const aggressiveQ = 0.5 + Math.pow(filterSettings.resonance / 5, 1.8) * 25;
            qValue = idx === 0 ? Math.min(aggressiveQ, 30) : Math.min(aggressiveQ * 1.2, 35);
            break;

          case 'oberheim':
            const semQ = 0.7 + Math.sqrt(filterSettings.resonance) * 2.5;
            qValue = idx === 0 ? semQ : semQ * 0.9;
            if (idx === 1) {
              filter.frequency.linearRampToValueAtTime(
                filterSettings.frequency * 0.97,
                c.currentTime + 0.02
              );
            }
            break;

          case 'butterworth':
          default:
            qValue = idx === 0 ? filterSettings.resonance : Math.max(0.1, filterSettings.resonance * 0.707);
            break;
        }

        // Clamp Q near Nyquist to prevent BiquadFilterNode NaN instability
        var sampleRate = c.sampleRate || 44100;
        var NYQUIST_THRESHOLD = 0.4;
        var MAX_Q_NEAR_NYQUIST = 20;
        if (filterSettings.frequency > sampleRate * NYQUIST_THRESHOLD && qValue > MAX_Q_NEAR_NYQUIST) {
          qValue = MAX_Q_NEAR_NYQUIST;
        }

        filter.Q.value = qValue;

        if (model !== 'moog' || idx === filters.length - 1) {
          filter.type = filterSettings.type;
        }
      }

      if (filter instanceof GainNode && model === 'ms20') {
        filter.gain.value = 1.0 + (filterSettings.resonance / 30);
      }

      if (filter instanceof WaveShaperNode && model === 'ms20') {
        filter.curve = SL.audio._createMS20SaturationCurve(filterSettings.resonance);
      }
    });
  }

  /**
   * Stop a sustained chord
   * @param {number[]} notes - Array of MIDI note numbers
   * @param {HTMLElement} [btn] - Button element
   */
  function stopSustainedChord(notes, btn) {
    if (btn) btn.classList.remove('playing');
    notes.forEach(midi => stopSustainedNote(midi));
  }

  // ============================================================
  // Continuous Noise Generator
  // ============================================================

  /**
   * Start or update the continuous noise generator
   */
  function startContinuousNoise() {
    const c = SL.audio.getCtx();
    // Never start continuous noise for the loop instrument — loop engine manages its own audio
    var curInst = SL.audio.getCurrentInstrument();
    var instType = SL.audio.getInstrumentType ? SL.audio.getInstrumentType(curInst) : 'subtractive';
    if (instType === 'loop') {
      stopContinuousNoise();
      return;
    }
    const noiseSettings = SL.audio.getNoiseSettings();
    const filterSettings = SL.audio.getFilterSettings();

    if (noiseSettings.level <= 0) {
      stopContinuousNoise();
      return;
    }

    if (continuousNoiseSource && continuousNoiseGain) {
      continuousNoiseGain.gain.setTargetAtTime(noiseSettings.level * 0.5, c.currentTime, 0.02);
      return;
    }

    const buffer = getNoiseBuffer(c, noiseSettings.type);
    continuousNoiseSource = c.createBufferSource();
    continuousNoiseSource.buffer = buffer;
    continuousNoiseSource.loop = true;

    continuousNoiseGain = c.createGain();
    continuousNoiseGain.gain.value = noiseSettings.level * 0.5;

    continuousNoiseSource.connect(continuousNoiseGain);

    if (filterSettings.enabled) {
      const filterChain = SL.audio.createFilterChain(c, filterSettings);
      if (filterChain) {
        continuousNoiseGain.connect(filterChain.input);
        filterChain.output.connect(SL.audio.getFinalDestination());
        continuousNoiseFilter = filterChain;
      } else {
        continuousNoiseGain.connect(SL.audio.getFinalDestination());
      }
    } else {
      continuousNoiseGain.connect(SL.audio.getFinalDestination());
    }

    continuousNoiseSource.start();
  }

  /**
   * Stop the continuous noise generator
   */
  function stopContinuousNoise() {
    if (continuousNoiseSource) {
      try { continuousNoiseSource.stop(); } catch (e) { /* ignore */ }
      continuousNoiseSource = null;
    }
    if (continuousNoiseGain) {
      continuousNoiseGain.disconnect();
      continuousNoiseGain = null;
    }
    continuousNoiseFilter = null;
  }

  /**
   * Update continuous noise settings
   */
  function updateContinuousNoise() {
    // Never update continuous noise for the loop instrument
    var curInst = SL.audio.getCurrentInstrument();
    var instType = SL.audio.getInstrumentType ? SL.audio.getInstrumentType(curInst) : 'subtractive';
    if (instType === 'loop') {
      stopContinuousNoise();
      return;
    }
    const noiseSettings = SL.audio.getNoiseSettings();

    if (noiseSettings.level <= 0) {
      stopContinuousNoise();
      return;
    }

    if (continuousNoiseSource) {
      if (continuousNoiseGain) {
        const c = SL.audio.getCtx();
        continuousNoiseGain.gain.setTargetAtTime(noiseSettings.level * 0.5, c.currentTime, 0.02);
      }
    } else {
      startContinuousNoise();
    }
  }

  /**
   * Restart continuous noise with new type
   */
  function restartContinuousNoise() {
    const wasRunning = continuousNoiseSource !== null;
    // Never restart continuous noise for the loop instrument
    var curInst = SL.audio.getCurrentInstrument();
    var instType = SL.audio.getInstrumentType ? SL.audio.getInstrumentType(curInst) : 'subtractive';
    if (instType === 'loop') {
      stopContinuousNoise();
      return;
    }
    stopContinuousNoise();
    if (wasRunning || SL.audio.getNoiseSettings().level > 0) {
      startContinuousNoise();
    }
  }

  /**
   * Update continuous noise filter settings
   */
  function updateContinuousNoiseFilter() {
    if (!continuousNoiseGain) return;

    const c = SL.audio.getCtx();
    const filterSettings = SL.audio.getFilterSettings();

    continuousNoiseGain.disconnect();

    if (filterSettings.enabled) {
      const filterChain = SL.audio.createFilterChain(c, filterSettings);
      if (filterChain) {
        continuousNoiseGain.connect(filterChain.input);
        filterChain.output.connect(SL.audio.getFinalDestination());
        continuousNoiseFilter = filterChain;
      } else {
        continuousNoiseGain.connect(SL.audio.getFinalDestination());
        continuousNoiseFilter = null;
      }
    } else {
      continuousNoiseGain.connect(SL.audio.getFinalDestination());
      continuousNoiseFilter = null;
    }
  }

  // ============================================================
  // Register on SL.audio
  // ============================================================

  SL.audio.playNote = playNote;
  SL.audio.playNoteOnInstrument = null; // Will be set by instrument-settings.js
  SL.audio._playNoteFallbackWithDestination = playNoteFallbackWithDestination;
  SL.audio.startSustainedNote = startSustainedNote;
  SL.audio.stopSustainedNote = stopSustainedNote;
  SL.audio.startSustainedChord = startSustainedChord;
  SL.audio.stopSustainedChord = stopSustainedChord;
  SL.audio.stopAllSustained = stopAllSustained;
  SL.audio.refreshActiveOscillators = refreshActiveOscillators;
  SL.audio.refreshFilter = refreshFilter;
  SL.audio.highlightNote = highlightNote;
  SL.audio.createNoiseSource = createNoiseSource;
  SL.audio.startContinuousNoise = startContinuousNoise;
  SL.audio.stopContinuousNoise = stopContinuousNoise;
  SL.audio.updateContinuousNoise = updateContinuousNoise;
  SL.audio.restartContinuousNoise = restartContinuousNoise;
  SL.audio.updateContinuousNoiseFilter = updateContinuousNoiseFilter;
  SL.audio.invalidateKeyCache = function() { _allKeys = null; _allIsoKeys = null; _keysByMidi = null; _isoKeysByMidi = null; };

})();
