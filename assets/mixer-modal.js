// Synth Lab - Mixer Modal Module
// Extracted from ui-state.js - the entire setupMixerModal() function and nested helpers
(function() {
  'use strict';
  const SL = window.SynthLab;

  /**
   * Set up mixer modal button and sync between modal and inline controls
   */
  function setupMixerModal() {
    const mixerBtn = document.getElementById('mixerBtn');
    const mixerModal = document.getElementById('mixerModal');
    const mixerClose = document.getElementById('mixerClose');
    const instrumentSelectEl = document.getElementById('instrumentSelect');

    if (!mixerBtn || !mixerModal) {
      console.error('Mixer modal elements not found!');
      return;
    }

    // Open modal
    mixerBtn.addEventListener('click', () => {
      // Sync modal OSC controls from inline controls
      [1, 2, 3].forEach(n => {
        const inlineWave = document.querySelector('.osc-wave[data-osc="' + n + '"]');
        const inlineOct = document.querySelector('.osc-oct[data-osc="' + n + '"]');
        const inlineDetune = document.querySelector('.osc-detune[data-osc="' + n + '"]');
        const inlineLevel = document.querySelector('.osc-level[data-osc="' + n + '"]');

        const modalWave = document.querySelector('.osc-wave-lg[data-osc="' + n + '"]');
        const modalDetune = document.querySelector('.osc-detune-lg[data-osc="' + n + '"]');
        const modalDetuneVal = document.querySelector('.osc-detune-val-lg[data-osc="' + n + '"]');
        const modalLevel = document.querySelector('.osc-level-lg[data-osc="' + n + '"]');
        const modalLevelVal = document.querySelector('.osc-level-val-lg[data-osc="' + n + '"]');

        if (modalWave && inlineWave) modalWave.value = inlineWave.value;

        // Sync octave radio buttons from inline select
        if (inlineOct) {
          const octVal = inlineOct.value;
          const radioBtn = document.querySelector('input[name="osc' + n + 'oct"][value="' + octVal + '"]');
          if (radioBtn) radioBtn.checked = true;
        }

        if (modalDetune && inlineDetune) {
          modalDetune.value = inlineDetune.value;
          if (modalDetuneVal) modalDetuneVal.textContent = inlineDetune.value + ' ct';
        }
        if (modalLevel && inlineLevel) {
          modalLevel.value = inlineLevel.value;
          if (modalLevelVal) modalLevelVal.textContent = inlineLevel.value + '%';
        }
      });

      // Sync modal ADSR controls from inline controls (with log display + units)
      ['A', 'D', 'S', 'R'].forEach(p => {
        const inline = document.getElementById('adsr' + p);
        const inlineVal = document.getElementById('val' + p);
        const modal = document.getElementById('adsr' + p + '-modal');
        const modalVal = document.getElementById('val' + p + '-modal');
        if (modal && inline) {
          modal.value = inline.value;
          if (modalVal) {
            if (p === 'S') {
              modalVal.textContent = inline.value + '%';
            } else {
              modalVal.textContent = SL.ui.formatADSRTime(p, parseFloat(inline.value)) + 'ms';
            }
          }
        }
      });

      // Sync filter modal controls from inline controls
      syncFilterToModal();

      // Update debug display when modal opens
      updateDebugDisplay();

      // Initialize key-tracked frequency display
      // Show current cutoff or "(play a note)" if key tracking is enabled
      const filterSettings = SL.audio && SL.audio.getFilterSettings ? SL.audio.getFilterSettings() : null;
      const keyTrackedDisplay = document.getElementById('filterKeyTrackedFreq-val-modal');
      if (keyTrackedDisplay && filterSettings) {
        if (filterSettings.keyTrack > 0) {
          keyTrackedDisplay.textContent = SL.t('ui.label.play_a_note');
        } else {
          if (filterSettings.frequency >= 1000) {
            keyTrackedDisplay.textContent = (filterSettings.frequency / 1000).toFixed(2) + ' kHz';
          } else {
            keyTrackedDisplay.textContent = Math.round(filterSettings.frequency) + ' Hz';
          }
        }
      }

      // Initialize conditional controls visibility based on wave types
      [1, 2, 3].forEach(n => {
        const wave = document.querySelector('.osc-wave-lg[data-osc="' + n + '"]');
        if (wave) {
          updateOscConditionalControls(n, wave.value);
        }
      });

      // Sync modal instrument selector with main instrument selector
      const modalInstSelect = document.getElementById('instrumentSelect-modal');
      if (modalInstSelect && instrumentSelectEl) {
        modalInstSelect.value = instrumentSelectEl.value;
      }

      // Refresh preset categories when modal opens
      SL.presetUI.populateCategories();

      mixerModal.classList.remove('hidden');
    });

    // Modal instrument selector change handler
    const modalInstSelect = document.getElementById('instrumentSelect-modal');
    if (modalInstSelect) {
      modalInstSelect.addEventListener('change', () => {
        const newInst = parseInt(modalInstSelect.value);
        const oldInst = SL.audio.getCurrentInstrument();

        if (newInst === oldInst) return;

        // Switch instrument
        SL.audio.setCurrentInstrument(newInst);

        // Sync main instrument selector
        if (instrumentSelectEl) {
          instrumentSelectEl.value = newInst;
        }

        // Update modal UI to reflect new instrument's settings
        SL.ui.updateUIFromInstrument();

        // Re-sync modal controls
        syncAllModalControlsFromInline();

        // Sync effects UI to show the new instrument's effects
        if (SL.effectsUI && SL.effectsUI.setSelectedTarget) {
          SL.effectsUI.setSelectedTarget(newInst);
        }

        // Update type toggle buttons to reflect new instrument's type
        updateTypeToggleState();

        // Refresh preset categories for new instrument
        SL.presetUI.populateCategories();
      });
    }

    // Test tone button handler (plays A4 - concert pitch)
    const testToneBtn = document.getElementById('testToneBtn');
    if (testToneBtn) {
      testToneBtn.addEventListener('click', () => {
        // A4 = MIDI 69
        const a4Midi = 69;
        if (SL.audio && SL.audio.playNote) {
          SL.audio.playNote(a4Midi, 0.5);  // Play for 0.5 seconds
        }
      });
    }

    // Helper to sync all modal controls from inline (for instrument switching)
    function syncAllModalControlsFromInline() {
      // Sync OSC controls
      [1, 2, 3].forEach(n => {
        const inlineWave = document.querySelector('.osc-wave[data-osc="' + n + '"]');
        const inlineOct = document.querySelector('.osc-oct[data-osc="' + n + '"]');
        const inlineDetune = document.querySelector('.osc-detune[data-osc="' + n + '"]');
        const inlineLevel = document.querySelector('.osc-level[data-osc="' + n + '"]');

        const modalWave = document.querySelector('.osc-wave-lg[data-osc="' + n + '"]');
        const modalDetune = document.querySelector('.osc-detune-lg[data-osc="' + n + '"]');
        const modalDetuneVal = document.querySelector('.osc-detune-val-lg[data-osc="' + n + '"]');
        const modalLevel = document.querySelector('.osc-level-lg[data-osc="' + n + '"]');
        const modalLevelVal = document.querySelector('.osc-level-val-lg[data-osc="' + n + '"]');

        if (modalWave && inlineWave) modalWave.value = inlineWave.value;
        if (inlineOct) {
          const octVal = inlineOct.value;
          const radioBtn = document.querySelector('input[name="osc' + n + 'oct"][value="' + octVal + '"]');
          if (radioBtn) radioBtn.checked = true;
        }
        if (modalDetune && inlineDetune) {
          modalDetune.value = inlineDetune.value;
          if (modalDetuneVal) modalDetuneVal.textContent = inlineDetune.value + ' ct';
        }
        if (modalLevel && inlineLevel) {
          modalLevel.value = inlineLevel.value;
          if (modalLevelVal) modalLevelVal.textContent = inlineLevel.value + '%';
        }
      });

      // Sync ADSR controls
      ['A', 'D', 'S', 'R'].forEach(p => {
        const inline = document.getElementById('adsr' + p);
        const modal = document.getElementById('adsr' + p + '-modal');
        const modalVal = document.getElementById('val' + p + '-modal');
        if (modal && inline) {
          modal.value = inline.value;
          if (modalVal) {
            if (p === 'S') {
              modalVal.textContent = inline.value + '%';
            } else {
              modalVal.textContent = SL.ui.formatADSRTime(p, parseFloat(inline.value)) + 'ms';
            }
          }
        }
      });

      // Update conditional controls visibility
      [1, 2, 3].forEach(n => {
        const wave = document.querySelector('.osc-wave-lg[data-osc="' + n + '"]');
        if (wave) {
          updateOscConditionalControls(n, wave.value);
        }
      });

      // Sync LFO controls
      syncLFOToModal();
    }

    // Close modal
    mixerClose.addEventListener('click', () => {
      mixerModal.classList.add('hidden');
    });

    // Close on overlay click
    mixerModal.addEventListener('click', e => {
      if (e.target === mixerModal) {
        mixerModal.classList.add('hidden');
      }
    });

    // ============================================================
    // Tab Switching
    // ============================================================
    const modalTabs = document.querySelectorAll('.modal-tab');
    const mixerTabContent = document.getElementById('mixerTabContent');
    const filterTabContent = document.getElementById('filterTabContent');
    const effectsTabContent = document.getElementById('effectsTabContent');
    const samplerTabContent = document.getElementById('samplerTabContent');
    const lfoTabContent = document.getElementById('lfoTabContent');
    var modMatrixPanel = document.getElementById('modMatrixPanel');
    var modMatrixPanelContent = document.getElementById('modMatrixPanelContent');
    var modMatrixBtn = document.getElementById('modMatrixBtn');
    var modMatrixPanelClose = document.getElementById('modMatrixPanelClose');

    modalTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        // Update active tab button
        modalTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        // Show/hide tab content
        const tabName = tab.dataset.tab;
        if (mixerTabContent) mixerTabContent.classList.add('hidden');
        if (filterTabContent) filterTabContent.classList.add('hidden');
        if (effectsTabContent) effectsTabContent.classList.add('hidden');
        if (samplerTabContent) samplerTabContent.classList.add('hidden');
        if (lfoTabContent) lfoTabContent.classList.add('hidden');

        if (tabName === 'instrument') {
          if (mixerTabContent) mixerTabContent.classList.remove('hidden');
        } else if (tabName === 'sampler') {
          if (samplerTabContent) {
            samplerTabContent.classList.remove('hidden');
            // Render sampler UI when tab is shown
            if (SL.samplerUI && SL.samplerUI.renderSamplerTab) {
              SL.samplerUI.renderSamplerTab();
            }
          }
        } else if (tabName === 'filter') {
          if (filterTabContent) filterTabContent.classList.remove('hidden');
        } else if (tabName === 'effects') {
          if (effectsTabContent) effectsTabContent.classList.remove('hidden');
        } else if (tabName === 'lfo') {
          if (lfoTabContent) lfoTabContent.classList.remove('hidden');
          // Refresh LFO canvas visualizations
          [1, 2].forEach(function(n) {
            drawLFOWaveform(n);
          });
        }
      });
    });

    // ============================================================
    // Instrument Type Toggle (Subtractive / FM / Sampler)
    // ============================================================
    const typeToggleBtns = document.querySelectorAll('.instrument-type-btn');

    function updateTypeVisibility(instType) {
      var oscMixer = document.querySelector('.osc-mixer');
      var oscMixerExpanded = document.querySelector('.osc-mixer-expanded');
      var fmControls = document.getElementById('fmControlsModal');
      var physicalControls = document.getElementById('physicalControlsModal');
      var additiveControls = document.getElementById('additiveControlsModal');
      var granularControls = document.getElementById('granularControlsModal');
      var vocoderSynthControls = document.getElementById('vocoderSynthControlsModal');
      var wavefoldControls = document.getElementById('wavefoldControlsModal');
      var formantControls = document.getElementById('formantControlsModal');
      var modalControls = document.getElementById('modalControlsModal');
      var midioutControls = document.getElementById('midioutControlsModal');
      var loopControls = document.getElementById('loopControlsModal');
      var wavetableControls = document.getElementById('wavetableControlsModal');
      var phasedistControls = document.getElementById('phasedistControlsModal');
      var chipControls = document.getElementById('chipControlsModal');
      var bytebeatControls = document.getElementById('bytebeatControlsModal');
      var vectorControls = document.getElementById('vectorControlsModal');
      var drumsynControls = document.getElementById('drumsynControlsModal');
      var pulsarControls = document.getElementById('pulsarControlsModal');
      var reedControls = document.getElementById('reedControlsModal');
      var superwaveControls = document.getElementById('superwaveControlsModal');
      var chordControls = document.getElementById('chordControlsModal');
      var ringmodControls = document.getElementById('ringmodControlsModal');
      var topFreezeBtn = document.getElementById('topFreezeBtn');

      if (instType === 'subtractive') {
        if (oscMixer) oscMixer.style.display = '';
        if (oscMixerExpanded) oscMixerExpanded.style.display = '';
        if (fmControls) fmControls.style.display = 'none';
        if (physicalControls) physicalControls.style.display = 'none';
        if (additiveControls) additiveControls.style.display = 'none';
        if (granularControls) granularControls.style.display = 'none';
        if (vocoderSynthControls) vocoderSynthControls.style.display = 'none';
        if (wavefoldControls) wavefoldControls.style.display = 'none';
        if (formantControls) formantControls.style.display = 'none';
        if (modalControls) modalControls.style.display = 'none';
        if (midioutControls) midioutControls.style.display = 'none';
        if (loopControls) loopControls.style.display = 'none';
        if (wavetableControls) wavetableControls.style.display = 'none';
        if (phasedistControls) phasedistControls.style.display = 'none';
        if (chipControls) chipControls.style.display = 'none';
        if (bytebeatControls) bytebeatControls.style.display = 'none';
        if (vectorControls) vectorControls.style.display = 'none';
        if (drumsynControls) drumsynControls.style.display = 'none';
        if (pulsarControls) pulsarControls.style.display = 'none';
        if (superwaveControls) superwaveControls.style.display = 'none';
        if (chordControls) chordControls.style.display = 'none';
        if (ringmodControls) ringmodControls.style.display = 'none';
        if (reedControls) reedControls.style.display = 'none';
        if (topFreezeBtn) topFreezeBtn.style.display = 'none';
      } else if (instType === 'fm') {
        if (oscMixer) oscMixer.style.display = 'none';
        if (oscMixerExpanded) oscMixerExpanded.style.display = 'none';
        if (fmControls) fmControls.style.display = '';
        if (physicalControls) physicalControls.style.display = 'none';
        if (additiveControls) additiveControls.style.display = 'none';
        if (granularControls) granularControls.style.display = 'none';
        if (vocoderSynthControls) vocoderSynthControls.style.display = 'none';
        if (wavefoldControls) wavefoldControls.style.display = 'none';
        if (formantControls) formantControls.style.display = 'none';
        if (modalControls) modalControls.style.display = 'none';
        if (midioutControls) midioutControls.style.display = 'none';
        if (loopControls) loopControls.style.display = 'none';
        if (wavetableControls) wavetableControls.style.display = 'none';
        if (phasedistControls) phasedistControls.style.display = 'none';
        if (chipControls) chipControls.style.display = 'none';
        if (bytebeatControls) bytebeatControls.style.display = 'none';
        if (vectorControls) vectorControls.style.display = 'none';
        if (drumsynControls) drumsynControls.style.display = 'none';
        if (pulsarControls) pulsarControls.style.display = 'none';
        if (superwaveControls) superwaveControls.style.display = 'none';
        if (chordControls) chordControls.style.display = 'none';
        if (ringmodControls) ringmodControls.style.display = 'none';
        if (reedControls) reedControls.style.display = 'none';
        if (topFreezeBtn) topFreezeBtn.style.display = 'none';
      } else if (instType === 'physical') {
        if (oscMixer) oscMixer.style.display = 'none';
        if (oscMixerExpanded) oscMixerExpanded.style.display = 'none';
        if (fmControls) fmControls.style.display = 'none';
        if (physicalControls) physicalControls.style.display = '';
        if (additiveControls) additiveControls.style.display = 'none';
        if (granularControls) granularControls.style.display = 'none';
        if (vocoderSynthControls) vocoderSynthControls.style.display = 'none';
        if (wavefoldControls) wavefoldControls.style.display = 'none';
        if (formantControls) formantControls.style.display = 'none';
        if (modalControls) modalControls.style.display = 'none';
        if (midioutControls) midioutControls.style.display = 'none';
        if (loopControls) loopControls.style.display = 'none';
        if (wavetableControls) wavetableControls.style.display = 'none';
        if (phasedistControls) phasedistControls.style.display = 'none';
        if (chipControls) chipControls.style.display = 'none';
        if (bytebeatControls) bytebeatControls.style.display = 'none';
        if (vectorControls) vectorControls.style.display = 'none';
        if (drumsynControls) drumsynControls.style.display = 'none';
        if (pulsarControls) pulsarControls.style.display = 'none';
        if (superwaveControls) superwaveControls.style.display = 'none';
        if (chordControls) chordControls.style.display = 'none';
        if (ringmodControls) ringmodControls.style.display = 'none';
        if (reedControls) reedControls.style.display = 'none';
        if (topFreezeBtn) topFreezeBtn.style.display = 'none';
        updatePhysicalParamVisibility();
      } else if (instType === 'reed') {
        if (oscMixer) oscMixer.style.display = 'none';
        if (oscMixerExpanded) oscMixerExpanded.style.display = 'none';
        if (fmControls) fmControls.style.display = 'none';
        if (physicalControls) physicalControls.style.display = 'none';
        if (additiveControls) additiveControls.style.display = 'none';
        if (granularControls) granularControls.style.display = 'none';
        if (vocoderSynthControls) vocoderSynthControls.style.display = 'none';
        if (wavefoldControls) wavefoldControls.style.display = 'none';
        if (formantControls) formantControls.style.display = 'none';
        if (modalControls) modalControls.style.display = 'none';
        if (midioutControls) midioutControls.style.display = 'none';
        if (loopControls) loopControls.style.display = 'none';
        if (wavetableControls) wavetableControls.style.display = 'none';
        if (phasedistControls) phasedistControls.style.display = 'none';
        if (chipControls) chipControls.style.display = 'none';
        if (bytebeatControls) bytebeatControls.style.display = 'none';
        if (vectorControls) vectorControls.style.display = 'none';
        if (drumsynControls) drumsynControls.style.display = 'none';
        if (pulsarControls) pulsarControls.style.display = 'none';
        if (superwaveControls) superwaveControls.style.display = 'none';
        if (chordControls) chordControls.style.display = 'none';
        if (ringmodControls) ringmodControls.style.display = 'none';
        if (reedControls) reedControls.style.display = '';
        if (topFreezeBtn) topFreezeBtn.style.display = 'none';
      } else if (instType === 'additive') {
        if (oscMixer) oscMixer.style.display = 'none';
        if (oscMixerExpanded) oscMixerExpanded.style.display = 'none';
        if (fmControls) fmControls.style.display = 'none';
        if (physicalControls) physicalControls.style.display = 'none';
        if (additiveControls) additiveControls.style.display = '';
        if (granularControls) granularControls.style.display = 'none';
        if (vocoderSynthControls) vocoderSynthControls.style.display = 'none';
        if (wavefoldControls) wavefoldControls.style.display = 'none';
        if (formantControls) formantControls.style.display = 'none';
        if (modalControls) modalControls.style.display = 'none';
        if (midioutControls) midioutControls.style.display = 'none';
        if (loopControls) loopControls.style.display = 'none';
        if (wavetableControls) wavetableControls.style.display = 'none';
        if (phasedistControls) phasedistControls.style.display = 'none';
        if (chipControls) chipControls.style.display = 'none';
        if (bytebeatControls) bytebeatControls.style.display = 'none';
        if (vectorControls) vectorControls.style.display = 'none';
        if (drumsynControls) drumsynControls.style.display = 'none';
        if (pulsarControls) pulsarControls.style.display = 'none';
        if (superwaveControls) superwaveControls.style.display = 'none';
        if (chordControls) chordControls.style.display = 'none';
        if (ringmodControls) ringmodControls.style.display = 'none';
        if (reedControls) reedControls.style.display = 'none';
        if (topFreezeBtn) topFreezeBtn.style.display = 'none';
        initAdditiveControls();
      } else if (instType === 'granular') {
        if (oscMixer) oscMixer.style.display = 'none';
        if (oscMixerExpanded) oscMixerExpanded.style.display = 'none';
        if (fmControls) fmControls.style.display = 'none';
        if (physicalControls) physicalControls.style.display = 'none';
        if (additiveControls) additiveControls.style.display = 'none';
        if (granularControls) granularControls.style.display = '';
        if (vocoderSynthControls) vocoderSynthControls.style.display = 'none';
        if (wavefoldControls) wavefoldControls.style.display = 'none';
        if (formantControls) formantControls.style.display = 'none';
        if (modalControls) modalControls.style.display = 'none';
        if (midioutControls) midioutControls.style.display = 'none';
        if (loopControls) loopControls.style.display = 'none';
        if (wavetableControls) wavetableControls.style.display = 'none';
        if (phasedistControls) phasedistControls.style.display = 'none';
        if (superwaveControls) superwaveControls.style.display = 'none';
        if (chordControls) chordControls.style.display = 'none';
        if (ringmodControls) ringmodControls.style.display = 'none';
        if (reedControls) reedControls.style.display = 'none';
        if (topFreezeBtn) topFreezeBtn.style.display = '';
        initGranularControls();
        // Sync top freeze button state
        if (topFreezeBtn && SL.granular && SL.granular.isFreeze) {
          var curInst = SL.audio.getCurrentInstrument();
          if (SL.granular.isFreeze(curInst)) {
            topFreezeBtn.classList.add('active');
            topFreezeBtn.style.background = '#4a2a6e';
            topFreezeBtn.style.color = '#d0a0ff';
            topFreezeBtn.style.borderColor = '#d0a0ff';
          } else {
            topFreezeBtn.classList.remove('active');
            topFreezeBtn.style.background = '#1a1a2e';
            topFreezeBtn.style.color = '#b0b0b0';
            topFreezeBtn.style.borderColor = '#444';
          }
        }
      } else if (instType === 'vocoderSynth') {
        if (oscMixer) oscMixer.style.display = 'none';
        if (oscMixerExpanded) oscMixerExpanded.style.display = 'none';
        if (fmControls) fmControls.style.display = 'none';
        if (physicalControls) physicalControls.style.display = 'none';
        if (additiveControls) additiveControls.style.display = 'none';
        if (granularControls) granularControls.style.display = 'none';
        if (vocoderSynthControls) vocoderSynthControls.style.display = '';
        if (wavefoldControls) wavefoldControls.style.display = 'none';
        if (formantControls) formantControls.style.display = 'none';
        if (modalControls) modalControls.style.display = 'none';
        if (midioutControls) midioutControls.style.display = 'none';
        if (loopControls) loopControls.style.display = 'none';
        if (wavetableControls) wavetableControls.style.display = 'none';
        if (phasedistControls) phasedistControls.style.display = 'none';
        if (chipControls) chipControls.style.display = 'none';
        if (bytebeatControls) bytebeatControls.style.display = 'none';
        if (vectorControls) vectorControls.style.display = 'none';
        if (drumsynControls) drumsynControls.style.display = 'none';
        if (pulsarControls) pulsarControls.style.display = 'none';
        if (superwaveControls) superwaveControls.style.display = 'none';
        if (chordControls) chordControls.style.display = 'none';
        if (ringmodControls) ringmodControls.style.display = 'none';
        if (reedControls) reedControls.style.display = 'none';
        if (topFreezeBtn) topFreezeBtn.style.display = 'none';
        initVocoderSynthControls();
            } else if (instType === 'wavefolder') {
        if (oscMixer) oscMixer.style.display = 'none';
        if (oscMixerExpanded) oscMixerExpanded.style.display = 'none';
        if (fmControls) fmControls.style.display = 'none';
        if (physicalControls) physicalControls.style.display = 'none';
        if (additiveControls) additiveControls.style.display = 'none';
        if (granularControls) granularControls.style.display = 'none';
        if (vocoderSynthControls) vocoderSynthControls.style.display = 'none';
        if (wavefoldControls) wavefoldControls.style.display = '';
        if (formantControls) formantControls.style.display = 'none';
        if (modalControls) modalControls.style.display = 'none';
        if (midioutControls) midioutControls.style.display = 'none';
        if (loopControls) loopControls.style.display = 'none';
        if (wavetableControls) wavetableControls.style.display = 'none';
        if (phasedistControls) phasedistControls.style.display = 'none';
        if (chipControls) chipControls.style.display = 'none';
        if (bytebeatControls) bytebeatControls.style.display = 'none';
        if (vectorControls) vectorControls.style.display = 'none';
        if (drumsynControls) drumsynControls.style.display = 'none';
        if (pulsarControls) pulsarControls.style.display = 'none';
        if (superwaveControls) superwaveControls.style.display = 'none';
        if (chordControls) chordControls.style.display = 'none';
        if (ringmodControls) ringmodControls.style.display = 'none';
        if (reedControls) reedControls.style.display = 'none';
        if (topFreezeBtn) topFreezeBtn.style.display = 'none';
        initWavefoldControls();
      } else if (instType === 'formant') {
        if (oscMixer) oscMixer.style.display = 'none';
        if (oscMixerExpanded) oscMixerExpanded.style.display = 'none';
        if (fmControls) fmControls.style.display = 'none';
        if (physicalControls) physicalControls.style.display = 'none';
        if (additiveControls) additiveControls.style.display = 'none';
        if (granularControls) granularControls.style.display = 'none';
        if (vocoderSynthControls) vocoderSynthControls.style.display = 'none';
        if (wavefoldControls) wavefoldControls.style.display = 'none';
        if (formantControls) formantControls.style.display = '';
        if (modalControls) modalControls.style.display = 'none';
        if (midioutControls) midioutControls.style.display = 'none';
        if (loopControls) loopControls.style.display = 'none';
        if (wavetableControls) wavetableControls.style.display = 'none';
        if (phasedistControls) phasedistControls.style.display = 'none';
        if (chipControls) chipControls.style.display = 'none';
        if (bytebeatControls) bytebeatControls.style.display = 'none';
        if (vectorControls) vectorControls.style.display = 'none';
        if (drumsynControls) drumsynControls.style.display = 'none';
        if (pulsarControls) pulsarControls.style.display = 'none';
        if (superwaveControls) superwaveControls.style.display = 'none';
        if (chordControls) chordControls.style.display = 'none';
        if (ringmodControls) ringmodControls.style.display = 'none';
        if (reedControls) reedControls.style.display = 'none';
        if (topFreezeBtn) topFreezeBtn.style.display = 'none';
        initFormantControls();
      } else if (instType === 'modal') {
        if (oscMixer) oscMixer.style.display = 'none';
        if (oscMixerExpanded) oscMixerExpanded.style.display = 'none';
        if (fmControls) fmControls.style.display = 'none';
        if (physicalControls) physicalControls.style.display = 'none';
        if (additiveControls) additiveControls.style.display = 'none';
        if (granularControls) granularControls.style.display = 'none';
        if (vocoderSynthControls) vocoderSynthControls.style.display = 'none';
        if (wavefoldControls) wavefoldControls.style.display = 'none';
        if (formantControls) formantControls.style.display = 'none';
        if (modalControls) modalControls.style.display = '';
        if (midioutControls) midioutControls.style.display = 'none';
        if (loopControls) loopControls.style.display = 'none';
        if (wavetableControls) wavetableControls.style.display = 'none';
        if (phasedistControls) phasedistControls.style.display = 'none';
        if (chipControls) chipControls.style.display = 'none';
        if (bytebeatControls) bytebeatControls.style.display = 'none';
        if (vectorControls) vectorControls.style.display = 'none';
        if (drumsynControls) drumsynControls.style.display = 'none';
        if (pulsarControls) pulsarControls.style.display = 'none';
        if (superwaveControls) superwaveControls.style.display = 'none';
        if (chordControls) chordControls.style.display = 'none';
        if (ringmodControls) ringmodControls.style.display = 'none';
        if (reedControls) reedControls.style.display = 'none';
        if (topFreezeBtn) topFreezeBtn.style.display = 'none';
        initModalControls();
      } else if (instType === 'sampler') {
        if (oscMixer) oscMixer.style.display = 'none';
        if (oscMixerExpanded) oscMixerExpanded.style.display = 'none';
        if (fmControls) fmControls.style.display = 'none';
        if (physicalControls) physicalControls.style.display = 'none';
        if (additiveControls) additiveControls.style.display = 'none';
        if (granularControls) granularControls.style.display = 'none';
        if (vocoderSynthControls) vocoderSynthControls.style.display = 'none';
        if (wavefoldControls) wavefoldControls.style.display = 'none';
        if (formantControls) formantControls.style.display = 'none';
        if (modalControls) modalControls.style.display = 'none';
        if (midioutControls) midioutControls.style.display = 'none';
        if (loopControls) loopControls.style.display = 'none';
        if (wavetableControls) wavetableControls.style.display = 'none';
        if (phasedistControls) phasedistControls.style.display = 'none';
        if (chipControls) chipControls.style.display = 'none';
        if (bytebeatControls) bytebeatControls.style.display = 'none';
        if (vectorControls) vectorControls.style.display = 'none';
        if (drumsynControls) drumsynControls.style.display = 'none';
        if (pulsarControls) pulsarControls.style.display = 'none';
        if (superwaveControls) superwaveControls.style.display = 'none';
        if (chordControls) chordControls.style.display = 'none';
        if (ringmodControls) ringmodControls.style.display = 'none';
        if (reedControls) reedControls.style.display = 'none';
        if (topFreezeBtn) topFreezeBtn.style.display = 'none';
      } else if (instType === 'midiout') {
        if (oscMixer) oscMixer.style.display = 'none';
        if (oscMixerExpanded) oscMixerExpanded.style.display = 'none';
        if (fmControls) fmControls.style.display = 'none';
        if (physicalControls) physicalControls.style.display = 'none';
        if (additiveControls) additiveControls.style.display = 'none';
        if (granularControls) granularControls.style.display = 'none';
        if (vocoderSynthControls) vocoderSynthControls.style.display = 'none';
        if (wavefoldControls) wavefoldControls.style.display = 'none';
        if (formantControls) formantControls.style.display = 'none';
        if (modalControls) modalControls.style.display = 'none';
        if (midioutControls) midioutControls.style.display = '';
        if (loopControls) loopControls.style.display = 'none';
        if (wavetableControls) wavetableControls.style.display = 'none';
        if (phasedistControls) phasedistControls.style.display = 'none';
        if (chipControls) chipControls.style.display = 'none';
        if (bytebeatControls) bytebeatControls.style.display = 'none';
        if (vectorControls) vectorControls.style.display = 'none';
        if (drumsynControls) drumsynControls.style.display = 'none';
        if (pulsarControls) pulsarControls.style.display = 'none';
        if (superwaveControls) superwaveControls.style.display = 'none';
        if (chordControls) chordControls.style.display = 'none';
        if (ringmodControls) ringmodControls.style.display = 'none';
        if (reedControls) reedControls.style.display = 'none';
        if (topFreezeBtn) topFreezeBtn.style.display = 'none';
        // Load MIDIOUT panel settings for current instrument
        if (SL.midi && SL.midi.loadMidioutUI) {
          SL.midi.loadMidioutUI(SL.audio.getCurrentInstrument());
        }
      } else if (instType === 'loop') {
        if (oscMixer) oscMixer.style.display = 'none';
        if (oscMixerExpanded) oscMixerExpanded.style.display = 'none';
        if (fmControls) fmControls.style.display = 'none';
        if (physicalControls) physicalControls.style.display = 'none';
        if (additiveControls) additiveControls.style.display = 'none';
        if (granularControls) granularControls.style.display = 'none';
        if (vocoderSynthControls) vocoderSynthControls.style.display = 'none';
        if (wavefoldControls) wavefoldControls.style.display = 'none';
        if (formantControls) formantControls.style.display = 'none';
        if (modalControls) modalControls.style.display = 'none';
        if (midioutControls) midioutControls.style.display = 'none';
        if (loopControls) loopControls.style.display = '';
        if (wavetableControls) wavetableControls.style.display = 'none';
        if (phasedistControls) phasedistControls.style.display = 'none';
        if (chipControls) chipControls.style.display = 'none';
        if (bytebeatControls) bytebeatControls.style.display = 'none';
        if (vectorControls) vectorControls.style.display = 'none';
        if (drumsynControls) drumsynControls.style.display = 'none';
        if (pulsarControls) pulsarControls.style.display = 'none';
        if (superwaveControls) superwaveControls.style.display = 'none';
        if (chordControls) chordControls.style.display = 'none';
        if (ringmodControls) ringmodControls.style.display = 'none';
        if (reedControls) reedControls.style.display = 'none';
        if (topFreezeBtn) topFreezeBtn.style.display = 'none';
        // Update loop controls UI for current instrument
        updateLoopControlsUI();
      } else if (instType === 'wavetable') {
        if (oscMixer) oscMixer.style.display = 'none';
        if (oscMixerExpanded) oscMixerExpanded.style.display = 'none';
        if (fmControls) fmControls.style.display = 'none';
        if (physicalControls) physicalControls.style.display = 'none';
        if (additiveControls) additiveControls.style.display = 'none';
        if (granularControls) granularControls.style.display = 'none';
        if (vocoderSynthControls) vocoderSynthControls.style.display = 'none';
        if (wavefoldControls) wavefoldControls.style.display = 'none';
        if (formantControls) formantControls.style.display = 'none';
        if (modalControls) modalControls.style.display = 'none';
        if (midioutControls) midioutControls.style.display = 'none';
        if (loopControls) loopControls.style.display = 'none';
        if (wavetableControls) wavetableControls.style.display = '';
        if (phasedistControls) phasedistControls.style.display = 'none';
        if (chipControls) chipControls.style.display = 'none';
        if (bytebeatControls) bytebeatControls.style.display = 'none';
        if (vectorControls) vectorControls.style.display = 'none';
        if (drumsynControls) drumsynControls.style.display = 'none';
        if (pulsarControls) pulsarControls.style.display = 'none';
        if (superwaveControls) superwaveControls.style.display = 'none';
        if (chordControls) chordControls.style.display = 'none';
        if (ringmodControls) ringmodControls.style.display = 'none';
        if (reedControls) reedControls.style.display = 'none';
        if (topFreezeBtn) topFreezeBtn.style.display = 'none';
        initWavetableControls();
      } else if (instType === 'phasedist') {
        if (oscMixer) oscMixer.style.display = 'none';
        if (oscMixerExpanded) oscMixerExpanded.style.display = 'none';
        if (fmControls) fmControls.style.display = 'none';
        if (physicalControls) physicalControls.style.display = 'none';
        if (additiveControls) additiveControls.style.display = 'none';
        if (granularControls) granularControls.style.display = 'none';
        if (vocoderSynthControls) vocoderSynthControls.style.display = 'none';
        if (wavefoldControls) wavefoldControls.style.display = 'none';
        if (formantControls) formantControls.style.display = 'none';
        if (modalControls) modalControls.style.display = 'none';
        if (midioutControls) midioutControls.style.display = 'none';
        if (loopControls) loopControls.style.display = 'none';
        if (wavetableControls) wavetableControls.style.display = 'none';
        if (phasedistControls) phasedistControls.style.display = '';
        if (chipControls) chipControls.style.display = 'none';
        if (bytebeatControls) bytebeatControls.style.display = 'none';
        if (vectorControls) vectorControls.style.display = 'none';
        if (drumsynControls) drumsynControls.style.display = 'none';
        if (pulsarControls) pulsarControls.style.display = 'none';
        if (superwaveControls) superwaveControls.style.display = 'none';
        if (chordControls) chordControls.style.display = 'none';
        if (ringmodControls) ringmodControls.style.display = 'none';
        if (reedControls) reedControls.style.display = 'none';
        if (topFreezeBtn) topFreezeBtn.style.display = 'none';
        initPhasedistControls();
      } else if (instType === 'superwave') {
        if (oscMixer) oscMixer.style.display = 'none';
        if (oscMixerExpanded) oscMixerExpanded.style.display = 'none';
        if (fmControls) fmControls.style.display = 'none';
        if (physicalControls) physicalControls.style.display = 'none';
        if (additiveControls) additiveControls.style.display = 'none';
        if (granularControls) granularControls.style.display = 'none';
        if (vocoderSynthControls) vocoderSynthControls.style.display = 'none';
        if (wavefoldControls) wavefoldControls.style.display = 'none';
        if (formantControls) formantControls.style.display = 'none';
        if (modalControls) modalControls.style.display = 'none';
        if (midioutControls) midioutControls.style.display = 'none';
        if (loopControls) loopControls.style.display = 'none';
        if (wavetableControls) wavetableControls.style.display = 'none';
        if (phasedistControls) phasedistControls.style.display = 'none';
        if (superwaveControls) superwaveControls.style.display = '';
        if (chordControls) chordControls.style.display = 'none';
        if (ringmodControls) ringmodControls.style.display = 'none';
        if (reedControls) reedControls.style.display = 'none';
        if (topFreezeBtn) topFreezeBtn.style.display = 'none';
        initSuperwaveControls();
      } else if (instType === 'chord') {
        if (oscMixer) oscMixer.style.display = 'none';
        if (oscMixerExpanded) oscMixerExpanded.style.display = 'none';
        if (fmControls) fmControls.style.display = 'none';
        if (physicalControls) physicalControls.style.display = 'none';
        if (additiveControls) additiveControls.style.display = 'none';
        if (granularControls) granularControls.style.display = 'none';
        if (vocoderSynthControls) vocoderSynthControls.style.display = 'none';
        if (wavefoldControls) wavefoldControls.style.display = 'none';
        if (formantControls) formantControls.style.display = 'none';
        if (modalControls) modalControls.style.display = 'none';
        if (midioutControls) midioutControls.style.display = 'none';
        if (loopControls) loopControls.style.display = 'none';
        if (wavetableControls) wavetableControls.style.display = 'none';
        if (phasedistControls) phasedistControls.style.display = 'none';
        if (superwaveControls) superwaveControls.style.display = 'none';
        if (chordControls) chordControls.style.display = '';
        if (ringmodControls) ringmodControls.style.display = 'none';
        if (reedControls) reedControls.style.display = 'none';
        if (topFreezeBtn) topFreezeBtn.style.display = 'none';
        initChordControls();
      } else if (instType === 'ringmod') {
        if (oscMixer) oscMixer.style.display = 'none';
        if (oscMixerExpanded) oscMixerExpanded.style.display = 'none';
        if (fmControls) fmControls.style.display = 'none';
        if (physicalControls) physicalControls.style.display = 'none';
        if (additiveControls) additiveControls.style.display = 'none';
        if (granularControls) granularControls.style.display = 'none';
        if (vocoderSynthControls) vocoderSynthControls.style.display = 'none';
        if (wavefoldControls) wavefoldControls.style.display = 'none';
        if (formantControls) formantControls.style.display = 'none';
        if (modalControls) modalControls.style.display = 'none';
        if (midioutControls) midioutControls.style.display = 'none';
        if (loopControls) loopControls.style.display = 'none';
        if (wavetableControls) wavetableControls.style.display = 'none';
        if (phasedistControls) phasedistControls.style.display = 'none';
        if (superwaveControls) superwaveControls.style.display = 'none';
        if (chordControls) chordControls.style.display = 'none';
        if (ringmodControls) ringmodControls.style.display = '';
        if (topFreezeBtn) topFreezeBtn.style.display = 'none';
        initRingmodControls();
      } else if (instType === 'chip') {
        if (oscMixer) oscMixer.style.display = 'none';
        if (oscMixerExpanded) oscMixerExpanded.style.display = 'none';
        if (fmControls) fmControls.style.display = 'none';
        if (physicalControls) physicalControls.style.display = 'none';
        if (additiveControls) additiveControls.style.display = 'none';
        if (granularControls) granularControls.style.display = 'none';
        if (vocoderSynthControls) vocoderSynthControls.style.display = 'none';
        if (wavefoldControls) wavefoldControls.style.display = 'none';
        if (formantControls) formantControls.style.display = 'none';
        if (modalControls) modalControls.style.display = 'none';
        if (midioutControls) midioutControls.style.display = 'none';
        if (loopControls) loopControls.style.display = 'none';
        if (wavetableControls) wavetableControls.style.display = 'none';
        if (phasedistControls) phasedistControls.style.display = 'none';
        if (chipControls) chipControls.style.display = '';
        if (bytebeatControls) bytebeatControls.style.display = 'none';
        if (vectorControls) vectorControls.style.display = 'none';
        if (drumsynControls) drumsynControls.style.display = 'none';
        if (pulsarControls) pulsarControls.style.display = 'none';
        if (superwaveControls) superwaveControls.style.display = 'none';
        if (chordControls) chordControls.style.display = 'none';
        if (ringmodControls) ringmodControls.style.display = 'none';
        if (reedControls) reedControls.style.display = 'none';
        if (topFreezeBtn) topFreezeBtn.style.display = 'none';
        initChipControls();
      } else if (instType === 'bytebeat') {
        if (oscMixer) oscMixer.style.display = 'none';
        if (oscMixerExpanded) oscMixerExpanded.style.display = 'none';
        if (fmControls) fmControls.style.display = 'none';
        if (physicalControls) physicalControls.style.display = 'none';
        if (additiveControls) additiveControls.style.display = 'none';
        if (granularControls) granularControls.style.display = 'none';
        if (vocoderSynthControls) vocoderSynthControls.style.display = 'none';
        if (wavefoldControls) wavefoldControls.style.display = 'none';
        if (formantControls) formantControls.style.display = 'none';
        if (modalControls) modalControls.style.display = 'none';
        if (midioutControls) midioutControls.style.display = 'none';
        if (loopControls) loopControls.style.display = 'none';
        if (wavetableControls) wavetableControls.style.display = 'none';
        if (phasedistControls) phasedistControls.style.display = 'none';
        if (chipControls) chipControls.style.display = 'none';
        if (bytebeatControls) bytebeatControls.style.display = '';
        if (vectorControls) vectorControls.style.display = 'none';
        if (drumsynControls) drumsynControls.style.display = 'none';
        if (pulsarControls) pulsarControls.style.display = 'none';
        if (superwaveControls) superwaveControls.style.display = 'none';
        if (chordControls) chordControls.style.display = 'none';
        if (ringmodControls) ringmodControls.style.display = 'none';
        if (reedControls) reedControls.style.display = 'none';
        if (topFreezeBtn) topFreezeBtn.style.display = 'none';
        initBytebeatControls();
      } else if (instType === 'vector') {
        if (oscMixer) oscMixer.style.display = 'none';
        if (oscMixerExpanded) oscMixerExpanded.style.display = 'none';
        if (fmControls) fmControls.style.display = 'none';
        if (physicalControls) physicalControls.style.display = 'none';
        if (additiveControls) additiveControls.style.display = 'none';
        if (granularControls) granularControls.style.display = 'none';
        if (vocoderSynthControls) vocoderSynthControls.style.display = 'none';
        if (wavefoldControls) wavefoldControls.style.display = 'none';
        if (formantControls) formantControls.style.display = 'none';
        if (modalControls) modalControls.style.display = 'none';
        if (midioutControls) midioutControls.style.display = 'none';
        if (loopControls) loopControls.style.display = 'none';
        if (wavetableControls) wavetableControls.style.display = 'none';
        if (phasedistControls) phasedistControls.style.display = 'none';
        if (chipControls) chipControls.style.display = 'none';
        if (bytebeatControls) bytebeatControls.style.display = 'none';
        if (vectorControls) vectorControls.style.display = '';
        if (drumsynControls) drumsynControls.style.display = 'none';
        if (pulsarControls) pulsarControls.style.display = 'none';
        if (superwaveControls) superwaveControls.style.display = 'none';
        if (chordControls) chordControls.style.display = 'none';
        if (ringmodControls) ringmodControls.style.display = 'none';
        if (reedControls) reedControls.style.display = 'none';
        if (topFreezeBtn) topFreezeBtn.style.display = 'none';
        initVectorControls();
      } else if (instType === 'drumsyn') {
        if (oscMixer) oscMixer.style.display = 'none';
        if (oscMixerExpanded) oscMixerExpanded.style.display = 'none';
        if (fmControls) fmControls.style.display = 'none';
        if (physicalControls) physicalControls.style.display = 'none';
        if (additiveControls) additiveControls.style.display = 'none';
        if (granularControls) granularControls.style.display = 'none';
        if (vocoderSynthControls) vocoderSynthControls.style.display = 'none';
        if (wavefoldControls) wavefoldControls.style.display = 'none';
        if (formantControls) formantControls.style.display = 'none';
        if (modalControls) modalControls.style.display = 'none';
        if (midioutControls) midioutControls.style.display = 'none';
        if (loopControls) loopControls.style.display = 'none';
        if (wavetableControls) wavetableControls.style.display = 'none';
        if (phasedistControls) phasedistControls.style.display = 'none';
        if (chipControls) chipControls.style.display = 'none';
        if (bytebeatControls) bytebeatControls.style.display = 'none';
        if (vectorControls) vectorControls.style.display = 'none';
        if (drumsynControls) drumsynControls.style.display = '';
        if (pulsarControls) pulsarControls.style.display = 'none';
        if (superwaveControls) superwaveControls.style.display = 'none';
        if (chordControls) chordControls.style.display = 'none';
        if (ringmodControls) ringmodControls.style.display = 'none';
        if (reedControls) reedControls.style.display = 'none';
        if (topFreezeBtn) topFreezeBtn.style.display = 'none';
        initDrumsynControls();
      } else if (instType === 'pulsar') {
        if (oscMixer) oscMixer.style.display = 'none';
        if (oscMixerExpanded) oscMixerExpanded.style.display = 'none';
        if (fmControls) fmControls.style.display = 'none';
        if (physicalControls) physicalControls.style.display = 'none';
        if (additiveControls) additiveControls.style.display = 'none';
        if (granularControls) granularControls.style.display = 'none';
        if (vocoderSynthControls) vocoderSynthControls.style.display = 'none';
        if (wavefoldControls) wavefoldControls.style.display = 'none';
        if (formantControls) formantControls.style.display = 'none';
        if (modalControls) modalControls.style.display = 'none';
        if (midioutControls) midioutControls.style.display = 'none';
        if (loopControls) loopControls.style.display = 'none';
        if (wavetableControls) wavetableControls.style.display = 'none';
        if (phasedistControls) phasedistControls.style.display = 'none';
        if (chipControls) chipControls.style.display = 'none';
        if (bytebeatControls) bytebeatControls.style.display = 'none';
        if (vectorControls) vectorControls.style.display = 'none';
        if (drumsynControls) drumsynControls.style.display = 'none';
        if (pulsarControls) pulsarControls.style.display = '';
        if (superwaveControls) superwaveControls.style.display = 'none';
        if (chordControls) chordControls.style.display = 'none';
        if (ringmodControls) ringmodControls.style.display = 'none';
        if (reedControls) reedControls.style.display = 'none';
        if (topFreezeBtn) topFreezeBtn.style.display = 'none';
        initPulsarControls();
      }
    }

    typeToggleBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const instType = btn.dataset.type;
        const instId = SL.audio.getCurrentInstrument();

        // Update button states
        typeToggleBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Set instrument type
        if (SL.audio.setInstrumentType) {
          SL.audio.setInstrumentType(instId, instType);
        }

        // Show/hide sections based on type
        updateTypeVisibility(instType);

        // Auto-switch to the appropriate tab when changing instrument type
        if (instType === 'sampler') {
          var samplerTab = document.querySelector('.modal-tab[data-tab="sampler"]');
          if (samplerTab) samplerTab.click();
        } else if (instType === 'fm') {
          var fmTab = document.querySelector('.modal-tab[data-tab="fm"]');
          if (fmTab) fmTab.click();
        } else if (instType === 'physical') {
          var physTab = document.querySelector('.modal-tab[data-tab="physical"]');
          if (physTab) physTab.click();
        } else if (instType === 'reed') {
        if (oscMixer) oscMixer.style.display = 'none';
        if (oscMixerExpanded) oscMixerExpanded.style.display = 'none';
        if (fmControls) fmControls.style.display = 'none';
        if (physicalControls) physicalControls.style.display = 'none';
        if (additiveControls) additiveControls.style.display = 'none';
        if (granularControls) granularControls.style.display = 'none';
        if (vocoderSynthControls) vocoderSynthControls.style.display = 'none';
        if (wavefoldControls) wavefoldControls.style.display = 'none';
        if (formantControls) formantControls.style.display = 'none';
        if (modalControls) modalControls.style.display = 'none';
        if (midioutControls) midioutControls.style.display = 'none';
        if (loopControls) loopControls.style.display = 'none';
        if (wavetableControls) wavetableControls.style.display = 'none';
        if (phasedistControls) phasedistControls.style.display = 'none';
        if (chipControls) chipControls.style.display = 'none';
        if (bytebeatControls) bytebeatControls.style.display = 'none';
        if (vectorControls) vectorControls.style.display = 'none';
        if (drumsynControls) drumsynControls.style.display = 'none';
        if (pulsarControls) pulsarControls.style.display = 'none';
        if (superwaveControls) superwaveControls.style.display = 'none';
        if (chordControls) chordControls.style.display = 'none';
        if (ringmodControls) ringmodControls.style.display = 'none';
        if (reedControls) reedControls.style.display = '';
        if (topFreezeBtn) topFreezeBtn.style.display = 'none';
      } else if (instType === 'additive') {
          // Auto-switch to instrument tab to see additive controls
          var addMixTab = document.querySelector('.modal-tab[data-tab="instrument"]');
          if (addMixTab) addMixTab.click();
        } else if (instType === 'granular') {
          // Auto-switch to instrument tab to see granular controls
          var granMixTab = document.querySelector('.modal-tab[data-tab="instrument"]');
          if (granMixTab) granMixTab.click();
        } else if (instType === 'vocoderSynth') {
          // Auto-switch to instrument tab to see vocoder synth controls
          var vocMixTab = document.querySelector('.modal-tab[data-tab="instrument"]');
          if (vocMixTab) vocMixTab.click();
        } else {
          var mixerTab = document.querySelector('.modal-tab[data-tab="mixer"]');
          if (mixerTab) mixerTab.click();
        }

        // Refresh sequencer to show correct key labels
        if (SL.sequencer && SL.sequencer.refreshSeqScaleIndicators) {
          SL.sequencer.refreshSeqScaleIndicators();
        }

        // Refresh chord/drum patterns section
        if (SL.chords && SL.chords.buildChords) {
          SL.chords.buildChords();
        }

        // Refresh preset categories for new type
        SL.presetUI.populateCategories();
      });
    });

    // Update type toggle when instrument changes
    function updateTypeToggleState() {
      const instId = SL.audio.getCurrentInstrument();
      const instType = SL.audio.getInstrumentType ? SL.audio.getInstrumentType(instId) : 'subtractive';
      var isLoopInst = (instId === 4);
      typeToggleBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.type === instType);
        // For the loop instrument (index 4), hide all type buttons except "loop"
        if (isLoopInst) {
          if (btn.dataset.type === 'loop') {
            btn.style.display = '';
          } else {
            btn.style.display = 'none';
          }
        } else {
          // For non-loop instruments, show all type buttons except "loop"
          if (btn.dataset.type === 'loop') {
            btn.style.display = 'none';
          } else {
            btn.style.display = '';
          }
        }
      });
      updateTypeVisibility(instType);
    }

    // ============================================================
    // Loop Controls Setup
    // ============================================================

    // Guard flag: prevents programmatic .checked changes from firing change events
    var _updatingLoopUI = false;

    function updateLoopControlsUI() {
      var instId = SL.audio.getCurrentInstrument();
      var loopTextureSelect = document.getElementById('loopTextureSelect');
      var loopToggleBtn = document.getElementById('loopToggleBtn');
      var loopVolumeSlider = document.getElementById('loopVolume');
      var loopVolumeVal = document.getElementById('loopVolumeVal');
      var loopTopToggle = document.getElementById('loopTopToggle');
      var loopTopPreset = document.getElementById('loopTopPreset');

      // Populate texture selector if empty
      if (loopTextureSelect && loopTextureSelect.options.length === 0 && SL.loop) {
        var names = SL.loop.getTextureNames();
        for (var i = 0; i < names.length; i++) {
          var opt = document.createElement('option');
          opt.value = names[i];
          opt.textContent = names[i];
          loopTextureSelect.appendChild(opt);
        }
      }

      // Populate top bar preset selector if empty
      if (loopTopPreset && loopTopPreset.options.length === 0 && SL.loop) {
        var names2 = SL.loop.getTextureNames();
        for (var j = 0; j < names2.length; j++) {
          var opt2 = document.createElement('option');
          opt2.value = names2[j];
          opt2.textContent = names2[j];
          loopTopPreset.appendChild(opt2);
        }
      }

      if (SL.loop) {
        var playing = SL.loop.isPlaying(instId);
        var textureName = SL.loop.getTextureName(instId);
        if (loopTextureSelect) {
          loopTextureSelect.value = textureName;
        }
        if (loopToggleBtn) {
          loopToggleBtn.textContent = '';
          loopToggleBtn.classList.toggle('active', playing);
        }
        // Sync top bar controls (guard against programmatic change event)
        if (loopTopToggle) {
          _updatingLoopUI = true;
          loopTopToggle.checked = playing;
          _updatingLoopUI = false;
        }
        if (loopTopPreset) {
          loopTopPreset.value = textureName;
        }
        // Sync LFO controls
        var lfoState = SL.loop.getLfoState(instId);
        var lfoRateEl = document.getElementById('loopLfoRate');
        var lfoRateValEl = document.getElementById('loopLfoRateVal');
        var lfoDepthEl = document.getElementById('loopLfoDepth');
        var lfoDepthValEl = document.getElementById('loopLfoDepthVal');
        var lfoShapeEl = document.getElementById('loopLfoShape');
        if (lfoRateEl) {
          lfoRateEl.value = Math.round(lfoState.rate * 100);
        }
        if (lfoRateValEl) {
          lfoRateValEl.textContent = lfoState.rate.toFixed(2);
        }
        if (lfoDepthEl) {
          lfoDepthEl.value = lfoState.depth;
        }
        if (lfoDepthValEl) {
          lfoDepthValEl.textContent = lfoState.depth;
        }
        if (lfoShapeEl) {
          lfoShapeEl.value = lfoState.shape;
        }

        // Sync Filter controls
        var filterState = SL.loop.getFilterState(instId);
        var filterTypeEl = document.getElementById('loopFilterType');
        var filterFreqEl = document.getElementById('loopFilterFreq');
        var filterFreqValEl = document.getElementById('loopFilterFreqVal');
        var filterQEl = document.getElementById('loopFilterQ');
        var filterQValEl = document.getElementById('loopFilterQVal');
        if (filterTypeEl) {
          filterTypeEl.value = filterState.type;
        }
        if (filterFreqEl) {
          // Logarithmic slider: map freq 20-20000 to 0-1000
          var logMin = Math.log(20);
          var logMax = Math.log(20000);
          var sliderVal = Math.round((Math.log(filterState.freq) - logMin) / (logMax - logMin) * 1000);
          filterFreqEl.value = sliderVal;
        }
        if (filterFreqValEl) {
          filterFreqValEl.textContent = Math.round(filterState.freq);
        }
        if (filterQEl) {
          filterQEl.value = Math.round(filterState.q * 10);
        }
        if (filterQValEl) {
          filterQValEl.textContent = filterState.q.toFixed(1);
        }

        // Sync LFO2 controls
        var lfo2State = SL.loop.getLfo2State(instId);
        var lfo2RateEl = document.getElementById('loopLfo2Rate');
        var lfo2RateValEl = document.getElementById('loopLfo2RateVal');
        var lfo2DepthEl = document.getElementById('loopLfo2Depth');
        var lfo2DepthValEl = document.getElementById('loopLfo2DepthVal');
        var lfo2ShapeEl = document.getElementById('loopLfo2Shape');
        if (lfo2RateEl) {
          lfo2RateEl.value = Math.round(lfo2State.rate * 100);
        }
        if (lfo2RateValEl) {
          lfo2RateValEl.textContent = lfo2State.rate.toFixed(2);
        }
        if (lfo2DepthEl) {
          lfo2DepthEl.value = lfo2State.depth;
        }
        if (lfo2DepthValEl) {
          lfo2DepthValEl.textContent = lfo2State.depth;
        }
        if (lfo2ShapeEl) {
          lfo2ShapeEl.value = lfo2State.shape;
        }

        // Sync Fade controls
        var fadeState = SL.loop.getFadeState(instId);
        var fadeInEl = document.getElementById('loopFadeIn');
        var fadeInValEl = document.getElementById('loopFadeInVal');
        var fadeOutEl = document.getElementById('loopFadeOut');
        var fadeOutValEl = document.getElementById('loopFadeOutVal');
        if (fadeInEl) {
          fadeInEl.value = Math.round(fadeState.fadeIn * 10);
        }
        if (fadeInValEl) {
          fadeInValEl.textContent = fadeState.fadeIn.toFixed(1);
        }
        if (fadeOutEl) {
          fadeOutEl.value = Math.round(fadeState.fadeOut * 10);
        }
        if (fadeOutValEl) {
          fadeOutValEl.textContent = fadeState.fadeOut.toFixed(1);
        }

        // Sync modal loop volume slider
        if (loopVolumeSlider) {
          var curVol = Math.round(SL.loop.getVolume(instId) * 100);
          loopVolumeSlider.value = curVol;
          if (loopVolumeVal) loopVolumeVal.textContent = curVol;
        }

        // Sync main page loop volume slider
        var loopMainVolumeSlider = document.getElementById('loopMainVolume');
        var loopMainVolumeVal = document.getElementById('loopMainVolumeVal');
        if (loopMainVolumeSlider) {
          var mainVol = Math.round(SL.loop.getVolume(instId) * 100);
          loopMainVolumeSlider.value = mainVol;
          if (loopMainVolumeVal) loopMainVolumeVal.textContent = mainVol;
        }
      }
    }

    // Loop toggle button
    var loopToggleBtn = document.getElementById('loopToggleBtn');
    if (loopToggleBtn) {
      loopToggleBtn.addEventListener('click', function() {
        if (!SL.loop) {
          return;
        }
        var instId = SL.audio.getCurrentInstrument();
        if (SL.loop.isPlaying(instId)) {
          SL.loop.stopLoop(instId);
          loopToggleBtn.textContent = '';
          loopToggleBtn.classList.remove('active');
        } else {
          var loopTextureSelect = document.getElementById('loopTextureSelect');
          var textureName = loopTextureSelect ? loopTextureSelect.value : 'White Noise';
          SL.loop.startLoop(instId, textureName);
          loopToggleBtn.textContent = '';
          loopToggleBtn.classList.add('active');
        }
        updateLoopControlsUI();
      });
    }

    // Loop texture selector
    var loopTextureSelect = document.getElementById('loopTextureSelect');
    if (loopTextureSelect) {
      loopTextureSelect.addEventListener('change', function() {
        if (!SL.loop) {
          return;
        }
        var instId = SL.audio.getCurrentInstrument();
        // If currently playing, restart with new texture
        if (SL.loop.isPlaying(instId)) {
          SL.loop.startLoop(instId, loopTextureSelect.value);
        }
        updateLoopControlsUI();
      });
    }

    // Loop volume slider
    var loopVolumeSlider = document.getElementById('loopVolume');
    var loopVolumeVal = document.getElementById('loopVolumeVal');
    if (loopVolumeSlider) {
      loopVolumeSlider.addEventListener('input', function() {
        var vol = parseFloat(loopVolumeSlider.value) / 100;
        if (loopVolumeVal) {
          loopVolumeVal.textContent = loopVolumeSlider.value;
        }
        if (SL.loop) {
          var instId = SL.audio.getCurrentInstrument();
          SL.loop.setVolume(instId, vol);
        }
        // Sync main page loop volume slider
        var mainLoopVol = document.getElementById('loopMainVolume');
        var mainLoopVolVal = document.getElementById('loopMainVolumeVal');
        if (mainLoopVol) {
          mainLoopVol.value = loopVolumeSlider.value;
          if (mainLoopVolVal) mainLoopVolVal.textContent = loopVolumeSlider.value;
        }
      });
    }

    // Main page loop volume slider
    var loopMainVolumeSlider = document.getElementById('loopMainVolume');
    var loopMainVolumeVal = document.getElementById('loopMainVolumeVal');
    if (loopMainVolumeSlider) {
      loopMainVolumeSlider.addEventListener('input', function() {
        var vol = parseFloat(loopMainVolumeSlider.value) / 100;
        if (loopMainVolumeVal) {
          loopMainVolumeVal.textContent = loopMainVolumeSlider.value;
        }
        if (SL.loop) {
          var instId = SL.audio.getCurrentInstrument();
          SL.loop.setVolume(instId, vol);
        }
        // Sync modal loop volume slider
        var modalLoopVol = document.getElementById('loopVolume');
        var modalLoopVolVal = document.getElementById('loopVolumeVal');
        if (modalLoopVol) {
          modalLoopVol.value = loopMainVolumeSlider.value;
          if (modalLoopVolVal) modalLoopVolVal.textContent = loopMainVolumeSlider.value;
        }
      });
    }

    // Loop LFO Rate slider
    var loopLfoRateSlider = document.getElementById('loopLfoRate');
    var loopLfoRateVal = document.getElementById('loopLfoRateVal');
    if (loopLfoRateSlider) {
      loopLfoRateSlider.addEventListener('input', function() {
        var rate = parseFloat(loopLfoRateSlider.value) / 100;
        if (loopLfoRateVal) {
          loopLfoRateVal.textContent = rate.toFixed(2);
        }
        if (SL.loop) {
          var instId = SL.audio.getCurrentInstrument();
          SL.loop.setLfoRate(instId, rate);
        }
      });
    }

    // Loop LFO Depth slider
    var loopLfoDepthSlider = document.getElementById('loopLfoDepth');
    var loopLfoDepthVal = document.getElementById('loopLfoDepthVal');
    if (loopLfoDepthSlider) {
      loopLfoDepthSlider.addEventListener('input', function() {
        var depth = parseInt(loopLfoDepthSlider.value, 10);
        if (loopLfoDepthVal) {
          loopLfoDepthVal.textContent = depth;
        }
        if (SL.loop) {
          var instId = SL.audio.getCurrentInstrument();
          SL.loop.setLfoDepth(instId, depth);
        }
      });
    }

    // Loop LFO Shape selector
    var loopLfoShapeSelect = document.getElementById('loopLfoShape');
    if (loopLfoShapeSelect) {
      loopLfoShapeSelect.addEventListener('change', function() {
        if (SL.loop) {
          var instId = SL.audio.getCurrentInstrument();
          SL.loop.setLfoShape(instId, loopLfoShapeSelect.value);
        }
      });
    }

    // --- Filter Controls ---

    // Filter type selector
    var loopFilterTypeSelect = document.getElementById('loopFilterType');
    if (loopFilterTypeSelect) {
      loopFilterTypeSelect.addEventListener('change', function() {
        if (SL.loop) {
          var instId = SL.audio.getCurrentInstrument();
          SL.loop.setFilterType(instId, loopFilterTypeSelect.value);
        }
      });
    }

    // Filter frequency slider (logarithmic)
    var loopFilterFreqSlider = document.getElementById('loopFilterFreq');
    var loopFilterFreqVal = document.getElementById('loopFilterFreqVal');
    if (loopFilterFreqSlider) {
      loopFilterFreqSlider.addEventListener('input', function() {
        var logMin = Math.log(20);
        var logMax = Math.log(20000);
        var normalized = parseFloat(loopFilterFreqSlider.value) / 1000;
        var freq = Math.round(Math.exp(logMin + normalized * (logMax - logMin)));
        if (loopFilterFreqVal) {
          loopFilterFreqVal.textContent = freq;
        }
        if (SL.loop) {
          var instId = SL.audio.getCurrentInstrument();
          SL.loop.setFilterFreq(instId, freq);
        }
      });
    }

    // Filter Q slider
    var loopFilterQSlider = document.getElementById('loopFilterQ');
    var loopFilterQVal = document.getElementById('loopFilterQVal');
    if (loopFilterQSlider) {
      loopFilterQSlider.addEventListener('input', function() {
        var q = parseFloat(loopFilterQSlider.value) / 10;
        if (loopFilterQVal) {
          loopFilterQVal.textContent = q.toFixed(1);
        }
        if (SL.loop) {
          var instId = SL.audio.getCurrentInstrument();
          SL.loop.setFilterQ(instId, q);
        }
      });
    }

    // --- LFO2 Controls (Filter LFO) ---

    // LFO2 Rate slider
    var loopLfo2RateSlider = document.getElementById('loopLfo2Rate');
    var loopLfo2RateVal = document.getElementById('loopLfo2RateVal');
    if (loopLfo2RateSlider) {
      loopLfo2RateSlider.addEventListener('input', function() {
        var rate = parseFloat(loopLfo2RateSlider.value) / 100;
        if (loopLfo2RateVal) {
          loopLfo2RateVal.textContent = rate.toFixed(2);
        }
        if (SL.loop) {
          var instId = SL.audio.getCurrentInstrument();
          SL.loop.setLfo2Rate(instId, rate);
        }
      });
    }

    // LFO2 Depth slider
    var loopLfo2DepthSlider = document.getElementById('loopLfo2Depth');
    var loopLfo2DepthVal = document.getElementById('loopLfo2DepthVal');
    if (loopLfo2DepthSlider) {
      loopLfo2DepthSlider.addEventListener('input', function() {
        var depth = parseInt(loopLfo2DepthSlider.value, 10);
        if (loopLfo2DepthVal) {
          loopLfo2DepthVal.textContent = depth;
        }
        if (SL.loop) {
          var instId = SL.audio.getCurrentInstrument();
          SL.loop.setLfo2Depth(instId, depth);
        }
      });
    }

    // LFO2 Shape selector
    var loopLfo2ShapeSelect = document.getElementById('loopLfo2Shape');
    if (loopLfo2ShapeSelect) {
      loopLfo2ShapeSelect.addEventListener('change', function() {
        if (SL.loop) {
          var instId = SL.audio.getCurrentInstrument();
          SL.loop.setLfo2Shape(instId, loopLfo2ShapeSelect.value);
        }
      });
    }

    // --- Fade Controls ---

    // Fade In slider
    var loopFadeInSlider = document.getElementById('loopFadeIn');
    var loopFadeInVal = document.getElementById('loopFadeInVal');
    if (loopFadeInSlider) {
      loopFadeInSlider.addEventListener('input', function() {
        var seconds = parseFloat(loopFadeInSlider.value) / 10;
        if (loopFadeInVal) {
          loopFadeInVal.textContent = seconds.toFixed(1);
        }
        if (SL.loop) {
          var instId = SL.audio.getCurrentInstrument();
          SL.loop.setFadeIn(instId, seconds);
        }
      });
    }

    // Fade Out slider
    var loopFadeOutSlider = document.getElementById('loopFadeOut');
    var loopFadeOutVal = document.getElementById('loopFadeOutVal');
    if (loopFadeOutSlider) {
      loopFadeOutSlider.addEventListener('input', function() {
        var seconds = parseFloat(loopFadeOutSlider.value) / 10;
        if (loopFadeOutVal) {
          loopFadeOutVal.textContent = seconds.toFixed(1);
        }
        if (SL.loop) {
          var instId = SL.audio.getCurrentInstrument();
          SL.loop.setFadeOut(instId, seconds);
        }
      });
    }

    // Top bar loop toggle checkbox
    var loopTopToggle = document.getElementById('loopTopToggle');
    if (loopTopToggle) {
      loopTopToggle.addEventListener('change', function() {
        // Skip if this change was triggered programmatically (not by user click)
        if (_updatingLoopUI) {
          return;
        }
        if (!SL.loop) {
          return;
        }
        var instId = SL.audio.getCurrentInstrument();
        if (loopTopToggle.checked) {
          var loopTopPresetEl = document.getElementById('loopTopPreset');
          var textureName = loopTopPresetEl ? loopTopPresetEl.value : 'White Noise';
          SL.loop.startLoop(instId, textureName);
        } else {
          SL.loop.stopLoop(instId);
        }
        updateLoopControlsUI();
      });
    }

    // Top bar loop preset selector
    var loopTopPresetEl = document.getElementById('loopTopPreset');
    if (loopTopPresetEl) {
      loopTopPresetEl.addEventListener('change', function() {
        if (!SL.loop) {
          return;
        }
        var instId = SL.audio.getCurrentInstrument();
        if (SL.loop.isPlaying(instId)) {
          SL.loop.startLoop(instId, loopTopPresetEl.value);
          updateLoopControlsUI();
        }
      });
    }

    // Populate top bar preset on init
    updateLoopControlsUI();

    // Physical Modelling is always enabled (experimental checkbox removed)
    var physicalBtn = document.querySelector('.instrument-type-btn[data-type="physical"]');
    if (physicalBtn) {
      physicalBtn.classList.remove('pm-disabled');
    }

    // ============================================================
    // Vocoder Synth UI Builder
    // ============================================================
    // ============================================================
    // Wavefolder Controls
    // ============================================================

    var _wavefoldInitialized = false;

    function initWavefoldControls() {
      var container = document.getElementById('wavefoldControlsModal');
      if (!container) {
        return;
      }

      var instId = SL.audio.getCurrentInstrument();
      var wfSettings = (SL.wavefolder && SL.wavefolder.getSettings) ? SL.wavefolder.getSettings(instId) : null;
      if (!wfSettings) {
        wfSettings = SL.audio._DEFAULT_INSTRUMENT_SETTINGS.wavefoldSettings || {
          source: 'sine', foldAmount: 4, symmetry: 50, bias: 0, preGain: 1.0
        };
      }

      if (_wavefoldInitialized) {
        // Refresh values from engine
        var srcEl = document.getElementById('wavefoldSource');
        if (srcEl) srcEl.value = wfSettings.source || 'sine';
        var foldEl = document.getElementById('wavefoldAmount');
        var foldValEl = document.getElementById('wavefoldAmountVal');
        if (foldEl) {
          foldEl.value = wfSettings.foldAmount || 4;
          if (foldValEl) foldValEl.textContent = (wfSettings.foldAmount || 4) + 'x';
        }
        var symEl = document.getElementById('wavefoldSymmetry');
        var symValEl = document.getElementById('wavefoldSymmetryVal');
        if (symEl) {
          symEl.value = wfSettings.symmetry || 50;
          if (symValEl) symValEl.textContent = (wfSettings.symmetry || 50) + '%';
        }
        var biasEl = document.getElementById('wavefoldBias');
        var biasValEl = document.getElementById('wavefoldBiasVal');
        if (biasEl) {
          biasEl.value = wfSettings.bias || 0;
          if (biasValEl) biasValEl.textContent = wfSettings.bias || 0;
        }
        var gainEl = document.getElementById('wavefoldPreGain');
        var gainValEl = document.getElementById('wavefoldPreGainVal');
        if (gainEl) {
          gainEl.value = (wfSettings.preGain || 1.0) * 10;
          if (gainValEl) gainValEl.textContent = (wfSettings.preGain || 1.0).toFixed(1);
        }
        return;
      }

      // Build HTML
      var html = '';

      // Source waveform selector
      html += '<div class="wavefold-source-row">';
      html += '<label>Source:</label>';
      html += '<select id="wavefoldSource">';
      html += '<option value="sine"' + (wfSettings.source === 'sine' ? ' selected' : '') + '>Sine</option>';
      html += '<option value="triangle"' + (wfSettings.source === 'triangle' ? ' selected' : '') + '>Triangle</option>';
      html += '<option value="saw"' + (wfSettings.source === 'saw' ? ' selected' : '') + '>Saw</option>';
      html += '<option value="square"' + (wfSettings.source === 'square' ? ' selected' : '') + '>Square</option>';
      html += '</select>';
      html += '</div>';

      // Fold Amount slider (1-16)
      html += '<div class="wavefold-param-row">';
      html += '<label>Fold Amount:</label>';
      html += '<input type="range" aria-label="Wavefold Amount" id="wavefoldAmount" min="1" max="16" step="0.5" value="' + (wfSettings.foldAmount || 4) + '">';
      html += '<span class="wavefold-param-val" id="wavefoldAmountVal">' + (wfSettings.foldAmount || 4) + 'x</span>';
      html += '</div>';

      // Symmetry slider (0-100)
      html += '<div class="wavefold-param-row">';
      html += '<label>Symmetry:</label>';
      html += '<input type="range" aria-label="Wavefold Symmetry" id="wavefoldSymmetry" min="0" max="100" value="' + (wfSettings.symmetry || 50) + '">';
      html += '<span class="wavefold-param-val" id="wavefoldSymmetryVal">' + (wfSettings.symmetry || 50) + '%</span>';
      html += '</div>';

      // Bias slider (-100 to 100)
      html += '<div class="wavefold-param-row">';
      html += '<label>Bias:</label>';
      html += '<input type="range" aria-label="Wavefold Bias" id="wavefoldBias" min="-100" max="100" value="' + (wfSettings.bias || 0) + '">';
      html += '<span class="wavefold-param-val" id="wavefoldBiasVal">' + (wfSettings.bias || 0) + '</span>';
      html += '</div>';

      // Pre-Gain slider (0.1-10, displayed as slider 1-100 mapped to 0.1-10)
      var gainSliderVal = Math.round((wfSettings.preGain || 1.0) * 10);
      html += '<div class="wavefold-param-row">';
      html += '<label>Pre-Gain:</label>';
      html += '<input type="range" aria-label="Wavefold Pre Gain" id="wavefoldPreGain" min="1" max="100" value="' + gainSliderVal + '">';
      html += '<span class="wavefold-param-val" id="wavefoldPreGainVal">' + (wfSettings.preGain || 1.0).toFixed(1) + '</span>';
      html += '</div>';

      container.innerHTML = '<div class="wavefold-title-modal">WAVEFOLDER SYNTHESIS</div>' + html;

      // Event listeners
      var sourceEl = document.getElementById('wavefoldSource');
      if (sourceEl) {
        sourceEl.addEventListener('change', function() {
          var curInst = SL.audio.getCurrentInstrument();
          if (SL.wavefolder && SL.wavefolder.setSource) {
            SL.wavefolder.setSource(curInst, sourceEl.value);
          }
        });
      }

      var foldAmountEl = document.getElementById('wavefoldAmount');
      var foldAmountValEl = document.getElementById('wavefoldAmountVal');
      if (foldAmountEl) {
        foldAmountEl.addEventListener('input', function() {
          var val = parseFloat(foldAmountEl.value);
          if (foldAmountValEl) foldAmountValEl.textContent = val + 'x';
          var curInst = SL.audio.getCurrentInstrument();
          if (SL.wavefolder && SL.wavefolder.setFoldAmount) {
            SL.wavefolder.setFoldAmount(curInst, val);
          }
        });
      }

      var symmetryEl = document.getElementById('wavefoldSymmetry');
      var symmetryValEl = document.getElementById('wavefoldSymmetryVal');
      if (symmetryEl) {
        symmetryEl.addEventListener('input', function() {
          var val = parseInt(symmetryEl.value);
          if (symmetryValEl) symmetryValEl.textContent = val + '%';
          var curInst = SL.audio.getCurrentInstrument();
          if (SL.wavefolder && SL.wavefolder.setSymmetry) {
            SL.wavefolder.setSymmetry(curInst, val);
          }
        });
      }

      var biasEl = document.getElementById('wavefoldBias');
      var biasValEl = document.getElementById('wavefoldBiasVal');
      if (biasEl) {
        biasEl.addEventListener('input', function() {
          var val = parseInt(biasEl.value);
          if (biasValEl) biasValEl.textContent = val;
          var curInst = SL.audio.getCurrentInstrument();
          if (SL.wavefolder && SL.wavefolder.setBias) {
            SL.wavefolder.setBias(curInst, val);
          }
        });
      }

      var preGainEl = document.getElementById('wavefoldPreGain');
      var preGainValEl = document.getElementById('wavefoldPreGainVal');
      if (preGainEl) {
        preGainEl.addEventListener('input', function() {
          var val = parseFloat(preGainEl.value) / 10;
          if (preGainValEl) preGainValEl.textContent = val.toFixed(1);
          var curInst = SL.audio.getCurrentInstrument();
          if (SL.wavefolder && SL.wavefolder.setPreGain) {
            SL.wavefolder.setPreGain(curInst, val);
          }
        });
      }

      _wavefoldInitialized = true;
    }

    var _vocoderSynthInitialized = false;

    function initVocoderSynthControls() {
      var container = document.getElementById('vocoderSynthControlsModal');
      if (!container) {
        return;
      }

      var instId = SL.audio.getCurrentInstrument();
      var vocSettings = (SL.vocoderSynth && SL.vocoderSynth.getSettings) ? SL.vocoderSynth.getSettings(instId) : null;
      if (!vocSettings) {
        vocSettings = SL.audio._DEFAULT_INSTRUMENT_SETTINGS.vocoderSynthSettings || {
          carrierWaveform: 'saw', vowel: 'A', morphPosition: 0, bandCount: 16, formantShift: 0, filterQ: 8
        };
      }

      if (_vocoderSynthInitialized) {
        // Refresh values from engine
        var carrierEl = document.getElementById('vocoderSynthCarrier');
        if (carrierEl) carrierEl.value = vocSettings.carrierWaveform || 'saw';
        var morphEl = document.getElementById('vocoderSynthMorph');
        var morphValEl = document.getElementById('vocoderSynthMorphVal');
        if (morphEl) {
          morphEl.value = vocSettings.morphPosition || 0;
          if (morphValEl) morphValEl.textContent = (vocSettings.morphPosition || 0) + '%';
        }
        var formantEl = document.getElementById('vocoderSynthFormantShift');
        var formantValEl = document.getElementById('vocoderSynthFormantShiftVal');
        if (formantEl) {
          formantEl.value = vocSettings.formantShift || 0;
          if (formantValEl) formantValEl.textContent = (vocSettings.formantShift || 0) + ' st';
        }
        var fqEl = document.getElementById('vocoderSynthFilterQ');
        var fqValEl = document.getElementById('vocoderSynthFilterQVal');
        if (fqEl) {
          fqEl.value = vocSettings.filterQ || 8;
          if (fqValEl) fqValEl.textContent = vocSettings.filterQ || 8;
        }
        // Refresh vowel buttons
        var vowelBtns = document.querySelectorAll('.vocoder-synth-vowel-btn');
        for (var vi = 0; vi < vowelBtns.length; vi++) {
          if (vowelBtns[vi].dataset.vowel === (vocSettings.vowel || 'A')) {
            vowelBtns[vi].classList.add('active');
          } else {
            vowelBtns[vi].classList.remove('active');
          }
        }
        // Refresh band count buttons
        var bandBtns = document.querySelectorAll('.vocoder-synth-band-btn');
        for (var bi = 0; bi < bandBtns.length; bi++) {
          if (parseInt(bandBtns[bi].dataset.bands) === (vocSettings.bandCount || 16)) {
            bandBtns[bi].classList.add('active');
          } else {
            bandBtns[bi].classList.remove('active');
          }
        }
        return;
      }

      // Build HTML
      var html = '';

      // Carrier waveform selector
      html += '<div class="vocoder-synth-carrier-row">';
      html += '<label>Carrier:</label>';
      html += '<select id="vocoderSynthCarrier">';
      html += '<option value="saw"' + (vocSettings.carrierWaveform === 'saw' ? ' selected' : '') + '>Saw</option>';
      html += '<option value="square"' + (vocSettings.carrierWaveform === 'square' ? ' selected' : '') + '>Square</option>';
      html += '<option value="noise"' + (vocSettings.carrierWaveform === 'noise' ? ' selected' : '') + '>Noise</option>';
      html += '<option value="pulse"' + (vocSettings.carrierWaveform === 'pulse' ? ' selected' : '') + '>Pulse</option>';
      html += '</select>';
      html += '</div>';

      // Vowel selector buttons
      html += '<div class="vocoder-synth-vowel-row">';
      html += '<label>Vowel:</label>';
      var vowels = ['A', 'E', 'I', 'O', 'U'];
      for (var v = 0; v < vowels.length; v++) {
        var isActive = (vocSettings.vowel === vowels[v]) ? ' active' : '';
        html += '<button class="vocoder-synth-vowel-btn' + isActive + '" data-vowel="' + vowels[v] + '">' + vowels[v] + '</button>';
      }
      html += '</div>';

      // Morph position slider
      html += '<div class="vocoder-synth-param-row">';
      html += '<label>Morph:</label>';
      html += '<input type="range" aria-label="Vocoder Synth Morph" id="vocoderSynthMorph" min="0" max="100" value="' + (vocSettings.morphPosition || 0) + '">';
      html += '<span class="vocoder-synth-param-val" id="vocoderSynthMorphVal">' + (vocSettings.morphPosition || 0) + '%</span>';
      html += '</div>';

      // Band count selector buttons
      html += '<div class="vocoder-synth-band-row">';
      html += '<label>Bands:</label>';
      var bandCounts = [8, 16, 32];
      for (var bc = 0; bc < bandCounts.length; bc++) {
        var bcActive = (vocSettings.bandCount === bandCounts[bc]) ? ' active' : '';
        html += '<button class="vocoder-synth-band-btn' + bcActive + '" data-bands="' + bandCounts[bc] + '">' + bandCounts[bc] + '</button>';
      }
      html += '</div>';

      // Formant shift slider
      html += '<div class="vocoder-synth-param-row">';
      html += '<label>Formant Shift:</label>';
      html += '<input type="range" aria-label="Vocoder Synth Formant Shift" id="vocoderSynthFormantShift" min="-12" max="12" value="' + (vocSettings.formantShift || 0) + '">';
      html += '<span class="vocoder-synth-param-val" id="vocoderSynthFormantShiftVal">' + (vocSettings.formantShift || 0) + ' st</span>';
      html += '</div>';

      // Filter Q slider
      html += '<div class="vocoder-synth-param-row">';
      html += '<label>Filter Q:</label>';
      html += '<input type="range" aria-label="Vocoder Synth Filter Q" id="vocoderSynthFilterQ" min="1" max="30" value="' + (vocSettings.filterQ || 8) + '">';
      html += '<span class="vocoder-synth-param-val" id="vocoderSynthFilterQVal">' + (vocSettings.filterQ || 8) + '</span>';
      html += '</div>';

      container.innerHTML = '<div class="vocoder-synth-title-modal">VOCODER SYNTHESIS</div>' + html;

      // Wire up carrier waveform selector
      var carrierSelect = document.getElementById('vocoderSynthCarrier');
      if (carrierSelect) {
        carrierSelect.addEventListener('change', function() {
          var currentInstId = SL.audio.getCurrentInstrument();
          if (SL.vocoderSynth && SL.vocoderSynth.setCarrierWaveform) {
            SL.vocoderSynth.setCarrierWaveform(currentInstId, carrierSelect.value);
          }
        });
      }

      // Wire up vowel buttons
      var vowelBtns = document.querySelectorAll('.vocoder-synth-vowel-btn');
      for (var vbi = 0; vbi < vowelBtns.length; vbi++) {
        vowelBtns[vbi].addEventListener('click', function() {
          var currentInstId = SL.audio.getCurrentInstrument();
          var vowel = this.dataset.vowel;
          // Update active state
          var allBtns = document.querySelectorAll('.vocoder-synth-vowel-btn');
          for (var abi = 0; abi < allBtns.length; abi++) {
            allBtns[abi].classList.remove('active');
          }
          this.classList.add('active');
          if (SL.vocoderSynth && SL.vocoderSynth.setVowel) {
            SL.vocoderSynth.setVowel(currentInstId, vowel);
          }
        });
      }

      // Wire up morph slider
      var morphSlider = document.getElementById('vocoderSynthMorph');
      var morphValDisplay = document.getElementById('vocoderSynthMorphVal');
      if (morphSlider) {
        morphSlider.addEventListener('input', function() {
          var currentInstId = SL.audio.getCurrentInstrument();
          var val = parseInt(morphSlider.value);
          if (morphValDisplay) morphValDisplay.textContent = val + '%';
          if (SL.vocoderSynth && SL.vocoderSynth.setMorphPosition) {
            SL.vocoderSynth.setMorphPosition(currentInstId, val);
          }
        });
      }

      // Wire up band count buttons
      var bandBtns = document.querySelectorAll('.vocoder-synth-band-btn');
      for (var bbi = 0; bbi < bandBtns.length; bbi++) {
        bandBtns[bbi].addEventListener('click', function() {
          var currentInstId = SL.audio.getCurrentInstrument();
          var bands = parseInt(this.dataset.bands);
          // Update active state
          var allBandBtns = document.querySelectorAll('.vocoder-synth-band-btn');
          for (var abbi = 0; abbi < allBandBtns.length; abbi++) {
            allBandBtns[abbi].classList.remove('active');
          }
          this.classList.add('active');
          if (SL.vocoderSynth && SL.vocoderSynth.setBandCount) {
            SL.vocoderSynth.setBandCount(currentInstId, bands);
          }
        });
      }

      // Wire up formant shift slider
      var formantSlider = document.getElementById('vocoderSynthFormantShift');
      var formantValDisplay = document.getElementById('vocoderSynthFormantShiftVal');
      if (formantSlider) {
        formantSlider.addEventListener('input', function() {
          var currentInstId = SL.audio.getCurrentInstrument();
          var val = parseInt(formantSlider.value);
          if (formantValDisplay) formantValDisplay.textContent = val + ' st';
          if (SL.vocoderSynth && SL.vocoderSynth.setFormantShift) {
            SL.vocoderSynth.setFormantShift(currentInstId, val);
          }
        });
      }

      // Wire up filter Q slider
      var filterQSlider = document.getElementById('vocoderSynthFilterQ');
      var filterQValDisplay = document.getElementById('vocoderSynthFilterQVal');
      if (filterQSlider) {
        filterQSlider.addEventListener('input', function() {
          var currentInstId = SL.audio.getCurrentInstrument();
          var val = parseInt(filterQSlider.value);
          if (filterQValDisplay) filterQValDisplay.textContent = val;
          if (SL.vocoderSynth && SL.vocoderSynth.setFilterQ) {
            SL.vocoderSynth.setFilterQ(currentInstId, val);
          }
        });
      }

      _vocoderSynthInitialized = true;
    }

    // ============================================================
    // Granular UI Builder
    // ============================================================
    var _granularInitialized = false;

    function initGranularControls() {
      var container = document.getElementById('granularControlsModal');
      if (!container) {
        return;
      }

      var instId = SL.audio.getCurrentInstrument();
      var granSettings = null;
      if (SL.granular) {
        granSettings = SL.granular.getSettings(instId);
      }
      if (!granSettings) {
        granSettings = JSON.parse(JSON.stringify(SL.audio._DEFAULT_INSTRUMENT_SETTINGS.granularSettings));
      }

      if (_granularInitialized) {
        // Just refresh values from engine
        var sourceEl = document.getElementById('granularSource');
        if (sourceEl) sourceEl.value = granSettings.sourceWaveform || 'sine';
        var sizeEl = document.getElementById('granularGrainSize');
        var sizeVal = document.getElementById('granularGrainSizeVal');
        if (sizeEl) {
          sizeEl.value = granSettings.grainSize || 50;
          if (sizeVal) sizeVal.textContent = (granSettings.grainSize || 50) + ' ms';
        }
        var densityEl = document.getElementById('granularDensity');
        var densityVal = document.getElementById('granularDensityVal');
        if (densityEl) {
          densityEl.value = granSettings.density || 10;
          if (densityVal) densityVal.textContent = (granSettings.density || 10) + '/s';
        }
        var pitchEl = document.getElementById('granularPitchScatter');
        var pitchVal = document.getElementById('granularPitchScatterVal');
        if (pitchEl) {
          pitchEl.value = granSettings.pitchScatter || 0;
          if (pitchVal) pitchVal.textContent = (granSettings.pitchScatter || 0) + ' st';
        }
        var posScatEl = document.getElementById('granularPosScatter');
        var posScatVal = document.getElementById('granularPosScatterVal');
        if (posScatEl) {
          posScatEl.value = granSettings.positionScatter || 0;
          if (posScatVal) posScatVal.textContent = (granSettings.positionScatter || 0) + '%';
        }
        var windowEl = document.getElementById('granularWindow');
        if (windowEl) windowEl.value = granSettings.windowShape || 'hann';
        var posEl = document.getElementById('granularPosition');
        var posValEl = document.getElementById('granularPositionVal');
        if (posEl) {
          posEl.value = granSettings.position || 50;
          if (posValEl) posValEl.textContent = (granSettings.position || 50) + '%';
        }
        var freezeBtn = document.getElementById('granularFreezeBtn');
        if (freezeBtn) {
          if (granSettings.freeze) {
            freezeBtn.classList.add('active');
          } else {
            freezeBtn.classList.remove('active');
          }
        }
        return;
      }

      // Build the HTML content
      var html = '';

      // Source waveform selector
      html += '<div class="granular-source-row">';
      html += '<label>Source:</label>';
      html += '<select id="granularSource">';
      html += '<option value="sine"' + (granSettings.sourceWaveform === 'sine' ? ' selected' : '') + '>Sine</option>';
      html += '<option value="saw"' + (granSettings.sourceWaveform === 'saw' ? ' selected' : '') + '>Saw</option>';
      html += '<option value="square"' + (granSettings.sourceWaveform === 'square' ? ' selected' : '') + '>Square</option>';
      html += '<option value="triangle"' + (granSettings.sourceWaveform === 'triangle' ? ' selected' : '') + '>Triangle</option>';
      html += '<option value="noise"' + (granSettings.sourceWaveform === 'noise' ? ' selected' : '') + '>Noise</option>';
      html += '</select>';
      html += '</div>';

      // Grain size slider
      html += '<div class="granular-param-row">';
      html += '<label>Grain Size:</label>';
      html += '<input type="range" aria-label="Granular Grain Size" id="granularGrainSize" min="1" max="100" value="' + (granSettings.grainSize || 50) + '">';
      html += '<span class="granular-param-val" id="granularGrainSizeVal">' + (granSettings.grainSize || 50) + ' ms</span>';
      html += '</div>';

      // Density slider
      html += '<div class="granular-param-row">';
      html += '<label>Density:</label>';
      html += '<input type="range" aria-label="Granular Density" id="granularDensity" min="1" max="50" value="' + (granSettings.density || 10) + '">';
      html += '<span class="granular-param-val" id="granularDensityVal">' + (granSettings.density || 10) + '/s</span>';
      html += '</div>';

      // Pitch scatter slider
      html += '<div class="granular-param-row">';
      html += '<label>Pitch Scatter:</label>';
      html += '<input type="range" aria-label="Granular Pitch Scatter" id="granularPitchScatter" min="0" max="12" value="' + (granSettings.pitchScatter || 0) + '">';
      html += '<span class="granular-param-val" id="granularPitchScatterVal">' + (granSettings.pitchScatter || 0) + ' st</span>';
      html += '</div>';

      // Position scatter slider
      html += '<div class="granular-param-row">';
      html += '<label>Pos. Scatter:</label>';
      html += '<input type="range" aria-label="Granular Pos Scatter" id="granularPosScatter" min="0" max="100" value="' + (granSettings.positionScatter || 0) + '">';
      html += '<span class="granular-param-val" id="granularPosScatterVal">' + (granSettings.positionScatter || 0) + '%</span>';
      html += '</div>';

      // Window shape selector
      html += '<div class="granular-window-row">';
      html += '<label>Window:</label>';
      html += '<select id="granularWindow">';
      html += '<option value="hann"' + (granSettings.windowShape === 'hann' ? ' selected' : '') + '>Hann</option>';
      html += '<option value="triangle"' + (granSettings.windowShape === 'triangle' ? ' selected' : '') + '>Triangle</option>';
      html += '<option value="rectangle"' + (granSettings.windowShape === 'rectangle' ? ' selected' : '') + '>Rectangle</option>';
      html += '</select>';
      html += '</div>';

      // Position slider
      html += '<div class="granular-position-row">';
      html += '<label>Position:</label>';
      html += '<input type="range" aria-label="Granular Position" id="granularPosition" min="0" max="100" value="' + (granSettings.position || 50) + '">';
      html += '<span class="granular-position-val" id="granularPositionVal">' + (granSettings.position || 50) + '%</span>';
      html += '</div>';

      // Freeze toggle
      html += '<div class="granular-freeze-row">';
      html += '<button class="granular-freeze-btn' + (granSettings.freeze ? ' active' : '') + '" id="granularFreezeBtn">FREEZE</button>';
      html += '</div>';

      container.innerHTML = '<div class="granular-title-modal">GRANULAR SYNTHESIS</div>' + html;

      // Wire up source waveform selector
      var sourceSelect = document.getElementById('granularSource');
      if (sourceSelect) {
        sourceSelect.addEventListener('change', function() {
          var currentInstId = SL.audio.getCurrentInstrument();
          if (SL.granular && SL.granular.setSourceWaveform) {
            SL.granular.setSourceWaveform(currentInstId, sourceSelect.value);
          }
        });
      }

      // Wire up grain size slider
      var grainSizeSlider = document.getElementById('granularGrainSize');
      var grainSizeValEl = document.getElementById('granularGrainSizeVal');
      if (grainSizeSlider) {
        grainSizeSlider.addEventListener('input', function() {
          var currentInstId = SL.audio.getCurrentInstrument();
          var val = parseInt(grainSizeSlider.value);
          if (grainSizeValEl) grainSizeValEl.textContent = val + ' ms';
          if (SL.granular && SL.granular.setGrainSize) {
            SL.granular.setGrainSize(currentInstId, val);
          }
        });
      }

      // Wire up density slider
      var densitySlider = document.getElementById('granularDensity');
      var densityValEl = document.getElementById('granularDensityVal');
      if (densitySlider) {
        densitySlider.addEventListener('input', function() {
          var currentInstId = SL.audio.getCurrentInstrument();
          var val = parseInt(densitySlider.value);
          if (densityValEl) densityValEl.textContent = val + '/s';
          if (SL.granular && SL.granular.setDensity) {
            SL.granular.setDensity(currentInstId, val);
          }
        });
      }

      // Wire up pitch scatter slider
      var pitchSlider = document.getElementById('granularPitchScatter');
      var pitchValEl = document.getElementById('granularPitchScatterVal');
      if (pitchSlider) {
        pitchSlider.addEventListener('input', function() {
          var currentInstId = SL.audio.getCurrentInstrument();
          var val = parseInt(pitchSlider.value);
          if (pitchValEl) pitchValEl.textContent = val + ' st';
          if (SL.granular && SL.granular.setPitchScatter) {
            SL.granular.setPitchScatter(currentInstId, val);
          }
        });
      }

      // Wire up position scatter slider
      var posScatSlider = document.getElementById('granularPosScatter');
      var posScatValEl = document.getElementById('granularPosScatterVal');
      if (posScatSlider) {
        posScatSlider.addEventListener('input', function() {
          var currentInstId = SL.audio.getCurrentInstrument();
          var val = parseInt(posScatSlider.value);
          if (posScatValEl) posScatValEl.textContent = val + '%';
          if (SL.granular && SL.granular.setPositionScatter) {
            SL.granular.setPositionScatter(currentInstId, val);
          }
        });
      }

      // Wire up window shape selector
      var windowSelect = document.getElementById('granularWindow');
      if (windowSelect) {
        windowSelect.addEventListener('change', function() {
          var currentInstId = SL.audio.getCurrentInstrument();
          if (SL.granular && SL.granular.setWindowShape) {
            SL.granular.setWindowShape(currentInstId, windowSelect.value);
          }
        });
      }

      // Wire up position slider
      var posSlider = document.getElementById('granularPosition');
      var posValDispEl = document.getElementById('granularPositionVal');
      if (posSlider) {
        posSlider.addEventListener('input', function() {
          var currentInstId = SL.audio.getCurrentInstrument();
          var val = parseInt(posSlider.value);
          if (posValDispEl) posValDispEl.textContent = val + '%';
          if (SL.granular && SL.granular.setPosition) {
            SL.granular.setPosition(currentInstId, val);
          }
        });
      }

      // Wire up freeze button
      var freezeBtn = document.getElementById('granularFreezeBtn');
      if (freezeBtn) {
        freezeBtn.addEventListener('click', function() {
          var currentInstId = SL.audio.getCurrentInstrument();
          var isActive = freezeBtn.classList.contains('active');
          var newState = !isActive;
          if (isActive) {
            freezeBtn.classList.remove('active');
          } else {
            freezeBtn.classList.add('active');
          }
          if (SL.granular && SL.granular.setFreeze) {
            SL.granular.setFreeze(currentInstId, newState);
          }
          // Sync top bar freeze button
          syncTopFreezeButton(newState);
        });
      }

      _granularInitialized = true;
    }

    /**
     * Sync the top-bar FREEZE button appearance with freeze state
     */
    function syncTopFreezeButton(frozen) {
      var topBtn = document.getElementById('topFreezeBtn');
      if (!topBtn) {
        return;
      }
      if (frozen) {
        topBtn.classList.add('active');
        topBtn.style.background = '#4a2a6e';
        topBtn.style.color = '#d0a0ff';
        topBtn.style.borderColor = '#d0a0ff';
      } else {
        topBtn.classList.remove('active');
        topBtn.style.background = '#1a1a2e';
        topBtn.style.color = '#b0b0b0';
        topBtn.style.borderColor = '#444';
      }
    }

    // ============================================================
    // Additive UI Builder
    // ============================================================
    var _additiveInitialized = false;

    function updateAdditiveVisibility(drawbarMode) {
      var partialsSection = document.getElementById('additivePartialsSection');
      var drawbarSection = document.getElementById('additiveDrawbarSection');
      if (drawbarMode) {
        if (partialsSection) partialsSection.style.display = 'none';
        if (drawbarSection) drawbarSection.style.display = '';
      } else {
        if (partialsSection) partialsSection.style.display = '';
        if (drawbarSection) drawbarSection.style.display = 'none';
      }
    }

    function initAdditiveControls() {
      if (_additiveInitialized) {
        // Just refresh values from engine
        var instId = SL.audio.getCurrentInstrument();
        if (SL.additive) {
          var addSettings = SL.additive.getSettings(instId);
          if (addSettings) {
            for (var pi = 0; pi < 16; pi++) {
              var partialEl = document.getElementById('additivePartial' + pi);
              if (partialEl && addSettings.partials && addSettings.partials[pi]) {
                partialEl.value = Math.round(addSettings.partials[pi].amplitude * 100);
              }
            }
            for (var di = 0; di < 9; di++) {
              var drawbarEl = document.getElementById('additiveDrawbar' + di);
              var drawbarValEl = document.getElementById('additiveDrawbarVal' + di);
              if (drawbarEl && addSettings.drawbars) {
                drawbarEl.value = addSettings.drawbars[di] || 0;
                if (drawbarValEl) drawbarValEl.textContent = addSettings.drawbars[di] || 0;
              }
            }
            var drawbarModeEl = document.getElementById('additiveDrawbarMode');
            if (drawbarModeEl) {
              drawbarModeEl.checked = addSettings.drawbarMode || false;
            }
            updateAdditiveVisibility(addSettings.drawbarMode);
          }
        }
        return;
      }

      var container = document.getElementById('additiveControlsModal');
      if (!container) {
        return;
      }

      var instId = SL.audio.getCurrentInstrument();
      var addSettings = null;
      if (SL.additive) {
        addSettings = SL.additive.getSettings(instId);
      }
      if (!addSettings) {
        addSettings = JSON.parse(JSON.stringify(SL.audio._DEFAULT_INSTRUMENT_SETTINGS.additiveSettings));
      }

      // Build the HTML content
      var html = '';

      // Quick-set buttons row
      html += '<div class="additive-quickset-row">';
      html += '<span class="quickset-label">Quick:</span>';
      html += '<button class="additive-quickset-btn" data-preset="sine">Sine</button>';
      html += '<button class="additive-quickset-btn" data-preset="saw">Saw</button>';
      html += '<button class="additive-quickset-btn" data-preset="square">Square</button>';
      html += '<button class="additive-quickset-btn" data-preset="triangle">Triangle</button>';
      html += '<button class="additive-quickset-btn" data-preset="clear">Clear</button>';
      html += '</div>';

      // Mode toggle row
      html += '<div class="additive-mode-row">';
      html += '<label><input type="checkbox" id="additiveDrawbarMode"' + (addSettings.drawbarMode ? ' checked' : '') + '> Organ Drawbar Mode</label>';
      html += '</div>';

      // Partials section
      html += '<div class="additive-partials-section" id="additivePartialsSection"' + (addSettings.drawbarMode ? ' style="display:none;"' : '') + '>';
      html += '<div class="additive-partials-label">Partials (16 harmonics)</div>';
      html += '<div class="additive-partials-container">';
      for (var p = 0; p < 16; p++) {
        var ampVal = addSettings.partials[p] ? Math.round(addSettings.partials[p].amplitude * 100) : 0;
        html += '<div class="additive-partial-strip">';
        html += '<input type="range" aria-label="Additive Partial' + p + '" id="additivePartial' + p + '" min="0" max="100" value="' + ampVal + '" orient="vertical" data-partial="' + p + '">';
        html += '<span class="additive-partial-num">' + (p + 1) + '</span>';
        html += '</div>';
      }
      html += '</div>';
      html += '</div>';

      // Drawbar section
      var drawbarFootages = ["16'", "5-1/3'", "8'", "4'", "2-2/3'", "2'", "1-3/5'", "1-1/3'", "1'"];
      html += '<div class="additive-drawbar-section" id="additiveDrawbarSection"' + (addSettings.drawbarMode ? '' : ' style="display:none;"') + '>';
      html += '<div class="additive-drawbar-label">Organ Drawbars (Hammond-style)</div>';
      html += '<div class="additive-drawbar-container">';
      for (var d = 0; d < 9; d++) {
        var dbVal = addSettings.drawbars[d] || 0;
        html += '<div class="additive-drawbar-strip">';
        html += '<input type="range" aria-label="Additive Drawbar' + d + '" id="additiveDrawbar' + d + '" min="0" max="8" value="' + dbVal + '" orient="vertical" data-drawbar="' + d + '">';
        html += '<span class="additive-drawbar-val" id="additiveDrawbarVal' + d + '">' + dbVal + '</span>';
        html += '<span class="additive-drawbar-footage">' + drawbarFootages[d] + '</span>';
        html += '</div>';
      }
      html += '</div>';
      html += '</div>';

      container.innerHTML = '<div class="additive-title-modal">ADDITIVE SYNTHESIS</div>' + html;

      // Wire up quick-set buttons
      var quickBtns = container.querySelectorAll('.additive-quickset-btn');
      quickBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
          var preset = btn.dataset.preset;
          var currentInstId = SL.audio.getCurrentInstrument();
          if (SL.additive && SL.additive.applyQuickSet) {
            SL.additive.applyQuickSet(currentInstId, preset);
            // Refresh partial sliders
            var freshSettings = SL.additive.getSettings(currentInstId);
            if (freshSettings && freshSettings.partials) {
              for (var pp = 0; pp < 16; pp++) {
                var pEl = document.getElementById('additivePartial' + pp);
                if (pEl) {
                  pEl.value = Math.round(freshSettings.partials[pp].amplitude * 100);
                }
              }
            }
          }
        });
      });

      // Wire up drawbar mode toggle
      var drawbarModeEl = document.getElementById('additiveDrawbarMode');
      if (drawbarModeEl) {
        drawbarModeEl.addEventListener('change', function() {
          var currentInstId = SL.audio.getCurrentInstrument();
          var checked = drawbarModeEl.checked;
          if (SL.additive && SL.additive.setDrawbarMode) {
            SL.additive.setDrawbarMode(currentInstId, checked);
          }
          updateAdditiveVisibility(checked);
        });
      }

      // Wire up partial sliders
      for (var pi2 = 0; pi2 < 16; pi2++) {
        (function(partialIdx) {
          var pSlider = document.getElementById('additivePartial' + partialIdx);
          if (pSlider) {
            pSlider.addEventListener('input', function() {
              var currentInstId = SL.audio.getCurrentInstrument();
              var amp = parseFloat(pSlider.value) / 100;
              if (SL.additive && SL.additive.setPartial) {
                SL.additive.setPartial(currentInstId, partialIdx, { amplitude: amp });
              }
            });
          }
        })(pi2);
      }

      // Wire up drawbar sliders
      for (var di2 = 0; di2 < 9; di2++) {
        (function(drawbarIdx) {
          var dSlider = document.getElementById('additiveDrawbar' + drawbarIdx);
          var dVal = document.getElementById('additiveDrawbarVal' + drawbarIdx);
          if (dSlider) {
            dSlider.addEventListener('input', function() {
              var currentInstId = SL.audio.getCurrentInstrument();
              var val = parseInt(dSlider.value) || 0;
              if (dVal) dVal.textContent = val;
              if (SL.additive && SL.additive.setDrawbar) {
                SL.additive.setDrawbar(currentInstId, drawbarIdx, val);
              }
            });
          }
        })(di2);
      }

      _additiveInitialized = true;
    }

    // ============================================================
    // FM UI Builder
    // ============================================================
    function buildFMUI() {
      var algoSelect = document.getElementById('fmAlgorithm');
      var opsContainer = document.getElementById('fmOperators');
      var feedbackSlider = document.getElementById('fmFeedback');
      var feedbackVal = document.getElementById('fmFeedbackVal');

      if (!algoSelect || !opsContainer) return;

      // Populate algorithm dropdown (1-32)
      algoSelect.innerHTML = '';
      for (var a = 1; a <= 32; a++) {
        var opt = document.createElement('option');
        opt.value = a;
        opt.textContent = a;
        algoSelect.appendChild(opt);
      }

      // Feedback slider display update
      if (feedbackSlider && feedbackVal) {
        feedbackSlider.addEventListener('input', function() {
          feedbackVal.textContent = feedbackSlider.value;
          var instId = SL.audio.getCurrentInstrument();
          if (SL.audio.setFMSettings) {
            SL.audio.setFMSettings(instId, { feedback: parseInt(feedbackSlider.value) });
          }
        });
      }

      // Algorithm change handler
      algoSelect.addEventListener('change', function() {
        var instId = SL.audio.getCurrentInstrument();
        if (SL.audio.setFMSettings) {
          SL.audio.setFMSettings(instId, { algorithm: parseInt(algoSelect.value) });
        }
      });

      // Build 6 operator strips
      opsContainer.innerHTML = '';
      for (var op = 1; op <= 6; op++) {
        var strip = document.createElement('div');
        strip.className = 'fm-op-strip';
        strip.dataset.op = op;
        strip.innerHTML =
          '<div class="fm-op-header">OP ' + op + '</div>' +
          '<div class="fm-op-param"><label>Ratio: <input type="number" class="fm-op-ratio-coarse" data-op="' + op + '" min="0" max="31" value="1" step="1"></label>' +
          '<label>Fine: <input type="number" class="fm-op-ratio-fine" data-op="' + op + '" min="0" max="99" value="0" step="1"></label></div>' +
          '<div class="fm-op-param"><label>Level: <input type="range" aria-label="Operator ' + op + ' level" class="fm-op-level" data-op="' + op + '" min="0" max="99" value="' + (op === 1 ? 99 : 0) + '"><span class="fm-op-level-val" data-op="' + op + '">' + (op === 1 ? 99 : 0) + '</span></label></div>' +
          '<div class="fm-op-param"><label>Detune: <input type="range" aria-label="Operator ' + op + ' detune" class="fm-op-detune" data-op="' + op + '" min="0" max="14" value="7"><span class="fm-op-detune-val" data-op="' + op + '">7</span></label></div>' +
          '<div class="fm-op-param fm-op-env">' +
          '<span class="fm-op-env-label">ENV</span>' +
          '<label>R1: <input type="number" class="fm-op-env-r1" data-op="' + op + '" min="0" max="99" value="95" step="1"></label>' +
          '<label>R2: <input type="number" class="fm-op-env-r2" data-op="' + op + '" min="0" max="99" value="50" step="1"></label>' +
          '<label>R3: <input type="number" class="fm-op-env-r3" data-op="' + op + '" min="0" max="99" value="50" step="1"></label>' +
          '<label>R4: <input type="number" class="fm-op-env-r4" data-op="' + op + '" min="0" max="99" value="50" step="1"></label>' +
          '<label>L1: <input type="number" class="fm-op-env-l1" data-op="' + op + '" min="0" max="99" value="99" step="1"></label>' +
          '<label>L2: <input type="number" class="fm-op-env-l2" data-op="' + op + '" min="0" max="99" value="99" step="1"></label>' +
          '<label>L3: <input type="number" class="fm-op-env-l3" data-op="' + op + '" min="0" max="99" value="99" step="1"></label>' +
          '<label>L4: <input type="number" class="fm-op-env-l4" data-op="' + op + '" min="0" max="99" value="0" step="1"></label>' +
          '</div>';
        opsContainer.appendChild(strip);

        // Level slider display
        (function(opNum) {
          var levelSlider = strip.querySelector('.fm-op-level');
          var levelVal = strip.querySelector('.fm-op-level-val');
          if (levelSlider && levelVal) {
            levelSlider.addEventListener('input', function() {
              levelVal.textContent = levelSlider.value;
              syncFMOpToSettings(opNum);
            });
          }
          var detuneSlider = strip.querySelector('.fm-op-detune');
          var detuneVal = strip.querySelector('.fm-op-detune-val');
          if (detuneSlider && detuneVal) {
            detuneSlider.addEventListener('input', function() {
              detuneVal.textContent = detuneSlider.value;
              syncFMOpToSettings(opNum);
            });
          }
          // Sync all number inputs on change
          strip.querySelectorAll('input[type="number"]').forEach(function(inp) {
            inp.addEventListener('change', function() { syncFMOpToSettings(opNum); });
          });
        })(op);
      }
    }

    function syncFMOpToSettings(opNum) {
      var instId = SL.audio.getCurrentInstrument();
      var fmSettings = SL.audio.getFMSettings ? SL.audio.getFMSettings(instId) : null;
      if (!fmSettings) return;

      var idx = opNum - 1;
      var op = fmSettings.operators[idx];
      if (!op) return;

      var rc = document.querySelector('.fm-op-ratio-coarse[data-op="' + opNum + '"]');
      var rf = document.querySelector('.fm-op-ratio-fine[data-op="' + opNum + '"]');
      var lv = document.querySelector('.fm-op-level[data-op="' + opNum + '"]');
      var dt = document.querySelector('.fm-op-detune[data-op="' + opNum + '"]');

      if (rc) op.ratioCoarse = parseInt(rc.value) || 0;
      if (rf) op.ratioFine = parseInt(rf.value) || 0;
      if (lv) op.level = parseInt(lv.value) || 0;
      if (dt) op.detune = parseInt(dt.value) || 0;

      // Envelope
      var envFields = ['R1','R2','R3','R4','L1','L2','L3','L4'];
      envFields.forEach(function(f) {
        var el = document.querySelector('.fm-op-env-' + f.toLowerCase() + '[data-op="' + opNum + '"]');
        if (el) op.envelope[f] = parseInt(el.value) || 0;
      });

      if (SL.audio.setFMSettings) {
        SL.audio.setFMSettings(instId, { operators: fmSettings.operators });
      }
    }

    // Build FM UI on init
    buildFMUI();

    // EXPLICIT listeners for each oscillator control (more reliable than event delegation)
    [1, 2, 3].forEach(n => {
      const wave = document.querySelector('.osc-wave-lg[data-osc="' + n + '"]');
      const detune = document.querySelector('.osc-detune-lg[data-osc="' + n + '"]');
      const detuneVal = document.querySelector('.osc-detune-val-lg[data-osc="' + n + '"]');
      const level = document.querySelector('.osc-level-lg[data-osc="' + n + '"]');
      const levelVal = document.querySelector('.osc-level-val-lg[data-osc="' + n + '"]');

      // Wave dropdown
      if (wave) {
        wave.addEventListener('change', () => {
          updateOscConditionalControls(n, wave.value);
          syncModalToInline();
          triggerAudioRefresh();
          updateDebugDisplay();
        });
      } else {
        console.error('Could not find wave element for OSC ' + n);
      }

      // Pulse width slider
      const pw = document.querySelector('.osc-pw-lg[data-osc="' + n + '"]');
      const pwVal = document.querySelector('.osc-pw-val-lg[data-osc="' + n + '"]');
      if (pw) {
        pw.addEventListener('input', () => {
          if (pwVal) pwVal.textContent = pw.value + '%';
          triggerAudioRefresh();
        });
      }

      // Spread slider (for supersaw)
      const spread = document.querySelector('.osc-spread-lg[data-osc="' + n + '"]');
      const spreadVal = document.querySelector('.osc-spread-val-lg[data-osc="' + n + '"]');
      if (spread) {
        spread.addEventListener('input', () => {
          if (spreadVal) spreadVal.textContent = spread.value + '%';
          triggerAudioRefresh();
        });
      }

      // Octave radio buttons
      const octRadios = document.querySelectorAll('input[name="osc' + n + 'oct"]');
      octRadios.forEach(radio => {
        radio.addEventListener('change', () => {
          syncModalToInline();
          triggerAudioRefresh();
          updateDebugDisplay();
        });
      });

      // Detune slider
      if (detune) {
        detune.addEventListener('input', () => {
          if (detuneVal) detuneVal.textContent = detune.value + ' ct';
          syncModalToInline();
          triggerAudioRefresh();
          updateDebugDisplay();
        });
      } else {
        console.error('Could not find detune element for OSC ' + n);
      }

      // Level slider
      if (level) {
        level.addEventListener('input', () => {
          if (levelVal) levelVal.textContent = level.value + '%';
          syncModalToInline();
          triggerAudioRefresh();
          updateDebugDisplay();
        });
      } else {
        console.error('Could not find level element for OSC ' + n);
      }
    });

    // Helper to sync all modal values to inline controls
    function syncModalToInline() {
      [1, 2, 3].forEach(n => {
        const modalWave = document.querySelector('.osc-wave-lg[data-osc="' + n + '"]');
        const modalOctRadio = document.querySelector('input[name="osc' + n + 'oct"]:checked');
        const modalDetune = document.querySelector('.osc-detune-lg[data-osc="' + n + '"]');
        const modalLevel = document.querySelector('.osc-level-lg[data-osc="' + n + '"]');

        const inlineWave = document.querySelector('.osc-wave[data-osc="' + n + '"]');
        const inlineOct = document.querySelector('.osc-oct[data-osc="' + n + '"]');
        const inlineDetune = document.querySelector('.osc-detune[data-osc="' + n + '"]');
        const inlineDetuneVal = document.querySelector('.osc-detune-val[data-osc="' + n + '"]');
        const inlineLevel = document.querySelector('.osc-level[data-osc="' + n + '"]');
        const inlineLevelVal = document.querySelector('.osc-level-val[data-osc="' + n + '"]');

        if (modalWave && inlineWave) inlineWave.value = modalWave.value;
        if (modalOctRadio && inlineOct) inlineOct.value = modalOctRadio.value;
        if (modalDetune && inlineDetune) {
          inlineDetune.value = modalDetune.value;
          if (inlineDetuneVal) inlineDetuneVal.textContent = modalDetune.value + ' ct';
        }
        if (modalLevel && inlineLevel) {
          inlineLevel.value = modalLevel.value;
          if (inlineLevelVal) inlineLevelVal.textContent = modalLevel.value + '%';
        }

      });
    }

    // Helper to trigger audio refresh
    function triggerAudioRefresh() {
      if (SL.audio && SL.audio.refreshActiveOscillators) {
        SL.audio.refreshActiveOscillators();
      }
    }

    // Helper to show/hide conditional oscillator controls (pulse width, spread)
    function updateOscConditionalControls(oscNum, waveType) {
      const pwRow = document.querySelector('.osc-pw-row[data-osc="' + oscNum + '"]');
      const spreadRow = document.querySelector('.osc-spread-row[data-osc="' + oscNum + '"]');

      // Show pulse width control only for pulse wave
      if (pwRow) {
        if (waveType === 'pulse') {
          pwRow.classList.add('visible');
          pwRow.style.display = '';  // Clear inline style
        } else {
          pwRow.classList.remove('visible');
          pwRow.style.display = 'none';
        }
      }

      // Show spread control only for supersaw wave
      if (spreadRow) {
        if (waveType === 'supersaw') {
          spreadRow.classList.add('visible');
          spreadRow.style.display = '';  // Clear inline style
        } else {
          spreadRow.classList.remove('visible');
          spreadRow.style.display = 'none';
        }
      }
    }

    // Helper to update debug display in modal title (always runs, even without active notes)
    function updateDebugDisplay() {
      const title = document.querySelector('.mixer-modal-title');
      if (!title) return;

      // Wave abbreviations that are distinct
      const waveAbbr = {
        'sawtooth': 'Saw',
        'square': 'Sqr',
        'sine': 'Sin',
        'triangle': 'Tri',
        'pulse': 'Pls',
        'supersaw': 'SSaw'
      };

      const settings = [];
      for (let n = 1; n <= 3; n++) {
        const wave = document.querySelector('.osc-wave-lg[data-osc="' + n + '"]');
        const octRadio = document.querySelector('input[name="osc' + n + 'oct"]:checked');
        const detune = document.querySelector('.osc-detune-lg[data-osc="' + n + '"]');
        const level = document.querySelector('.osc-level-lg[data-osc="' + n + '"]');

        const w = wave ? (waveAbbr[wave.value] || wave.value) : '?';
        const o = octRadio ? octRadio.value : '?';
        const d = detune ? detune.value : '?';
        const l = level ? level.value : '?';
        settings.push(n + ':' + w + ' o' + o + ' d' + d + ' L' + l);
      }
      title.textContent = settings.join(' | ');
    }

    // Set up modal ADSR listeners to sync back to inline controls (with log display + units)
    ['A', 'D', 'S', 'R'].forEach(p => {
      const modal = document.getElementById('adsr' + p + '-modal');
      const modalVal = document.getElementById('val' + p + '-modal');
      const inline = document.getElementById('adsr' + p);
      const inlineVal = document.getElementById('val' + p);

      if (modal) {
        modal.addEventListener('input', () => {
          const timeVal = (p === 'S') ? modal.value : SL.ui.formatADSRTime(p, parseFloat(modal.value));
          const displayVal = (p === 'S') ? timeVal + '%' : timeVal + 'ms';
          if (modalVal) modalVal.textContent = displayVal;
          if (inline) inline.value = modal.value;
          if (inlineVal) inlineVal.textContent = displayVal;
        });
      }
    });

    // ============================================================
    // Filter Control Sync and Event Listeners
    // ============================================================

    // Helper to sync filter modal controls to inline controls
    function syncFilterToModal() {
      const inlineEnabled = document.getElementById('filterEnabled');
      const inlineType = document.getElementById('filterType');
      const inlineSlopeRadio = document.querySelector('input[name="filterSlope"]:checked');
      const inlineFreq = document.getElementById('filterFreq');
      const inlineQ = document.getElementById('filterQ');
      const inlineModel = document.getElementById('filterModel');

      const modalEnabled = document.getElementById('filterEnabled-modal');
      const modalTypeRadios = document.querySelectorAll('input[name="filterType-modal"]');
      const modalSlopeRadios = document.querySelectorAll('input[name="filterSlope-modal"]');
      const modalFreq = document.getElementById('filterFreq-modal');
      const modalFreqVal = document.getElementById('filterFreq-val-modal');
      const modalQ = document.getElementById('filterQ-modal');
      const modalQVal = document.getElementById('filterQ-val-modal');
      const modalModel = document.getElementById('filterModel-modal');

      if (modalEnabled && inlineEnabled) modalEnabled.checked = inlineEnabled.checked;

      if (inlineType) {
        modalTypeRadios.forEach(radio => {
          radio.checked = (radio.value === inlineType.value);
        });
      }

      if (inlineSlopeRadio) {
        modalSlopeRadios.forEach(radio => {
          radio.checked = (radio.value === inlineSlopeRadio.value);
        });
      }

      if (modalFreq && inlineFreq) {
        modalFreq.value = inlineFreq.value;
        const sliderVal = parseFloat(inlineFreq.value);
        const freq = SL.audio && SL.audio.sliderToFreq ? SL.audio.sliderToFreq(sliderVal) : sliderVal;
        updateFreqDisplay(freq);
      }

      if (modalQ && inlineQ) {
        modalQ.value = inlineQ.value;
        const sliderVal = parseFloat(inlineQ.value);
        const q = SL.audio && SL.audio.sliderToQ ? SL.audio.sliderToQ(sliderVal) : sliderVal;
        if (modalQVal) modalQVal.textContent = 'Q: ' + q.toFixed(1);
      }

      if (modalModel && inlineModel) modalModel.value = inlineModel.value;

      // Update disabled state
      updateFilterDisabledState();
    }

    // Helper to sync filter modal controls back to inline controls
    function syncFilterToInline() {
      const modalEnabled = document.getElementById('filterEnabled-modal');
      const modalTypeRadio = document.querySelector('input[name="filterType-modal"]:checked');
      const modalSlopeRadio = document.querySelector('input[name="filterSlope-modal"]:checked');
      const modalFreq = document.getElementById('filterFreq-modal');
      const modalQ = document.getElementById('filterQ-modal');
      const modalModel = document.getElementById('filterModel-modal');

      const inlineEnabled = document.getElementById('filterEnabled');
      const inlineType = document.getElementById('filterType');
      const inlineSlopeRadios = document.querySelectorAll('input[name="filterSlope"]');
      const inlineFreq = document.getElementById('filterFreq');
      const inlineQ = document.getElementById('filterQ');
      const inlineModel = document.getElementById('filterModel');

      if (inlineEnabled && modalEnabled) inlineEnabled.checked = modalEnabled.checked;

      if (inlineType && modalTypeRadio) inlineType.value = modalTypeRadio.value;

      if (modalSlopeRadio) {
        inlineSlopeRadios.forEach(radio => {
          radio.checked = (radio.value === modalSlopeRadio.value);
        });
      }

      if (inlineFreq && modalFreq) inlineFreq.value = modalFreq.value;
      if (inlineQ && modalQ) inlineQ.value = modalQ.value;
      if (inlineModel && modalModel) inlineModel.value = modalModel.value;
    }

    // Helper to update frequency display (Hz or Note based on radio selection)
    function updateFreqDisplay(freq) {
      const modalFreqVal = document.getElementById('filterFreq-val-modal');
      const freqUnitRadio = document.querySelector('input[name="filterFreqUnit-modal"]:checked');
      const displayMode = freqUnitRadio ? freqUnitRadio.value : 'hz';

      if (!modalFreqVal) return;

      if (displayMode === 'hz') {
        if (freq >= 1000) {
          modalFreqVal.textContent = (freq / 1000).toFixed(2) + ' kHz';
        } else {
          modalFreqVal.textContent = Math.round(freq) + ' Hz';
        }
      } else {
        const noteName = SL.audio && SL.audio.freqToNote ? SL.audio.freqToNote(freq) : '?';
        modalFreqVal.textContent = noteName + ' (' + Math.round(freq) + ' Hz)';
      }
    }

    // Helper to update filter section disabled state
    function updateFilterDisabledState() {
      const filterSection = document.querySelector('.filter-section-modal');
      const modalEnabled = document.getElementById('filterEnabled-modal');
      if (filterSection && modalEnabled) {
        if (modalEnabled.checked) {
          filterSection.classList.remove('disabled');
        } else {
          filterSection.classList.add('disabled');
        }
      }
    }

    // Set up filter control event listeners
    const filterEnabledModal = document.getElementById('filterEnabled-modal');
    if (filterEnabledModal) {
      filterEnabledModal.addEventListener('change', () => {
        syncFilterToInline();
        updateFilterDisabledState();
        // When toggling filter, need to refresh oscillators to update signal chain
        if (SL.audio && SL.audio.refreshActiveOscillators) {
          SL.audio.refreshActiveOscillators();
        }
      });
    }

    // Filter type radio buttons
    const filterTypeRadios = document.querySelectorAll('input[name="filterType-modal"]');
    filterTypeRadios.forEach(radio => {
      radio.addEventListener('change', () => {
        syncFilterToInline();
        if (SL.audio && SL.audio.refreshFilter) {
          SL.audio.refreshFilter();
        }
      });
    });

    // Filter slope radio buttons
    const filterSlopeRadios = document.querySelectorAll('input[name="filterSlope-modal"]');
    filterSlopeRadios.forEach(radio => {
      radio.addEventListener('change', () => {
        syncFilterToInline();
        // Slope change requires full oscillator refresh (different filter chain)
        if (SL.audio && SL.audio.refreshActiveOscillators) {
          SL.audio.refreshActiveOscillators();
        }
      });
    });

    // Filter frequency slider (logarithmic)
    const filterFreqModal = document.getElementById('filterFreq-modal');
    if (filterFreqModal) {
      filterFreqModal.addEventListener('input', () => {
        const sliderVal = parseFloat(filterFreqModal.value);
        const freq = SL.audio && SL.audio.sliderToFreq ? SL.audio.sliderToFreq(sliderVal) : sliderVal;
        updateFreqDisplay(freq);
        syncFilterToInline();
        if (SL.audio && SL.audio.refreshFilter) {
          SL.audio.refreshFilter();
        }
      });
    }

    // Filter Q/resonance slider (curved 0-100 -> Q 0.5-20)
    const filterQModal = document.getElementById('filterQ-modal');
    const filterQValModal = document.getElementById('filterQ-val-modal');
    if (filterQModal) {
      filterQModal.addEventListener('input', () => {
        const sliderVal = parseFloat(filterQModal.value);
        const q = SL.audio && SL.audio.sliderToQ ? SL.audio.sliderToQ(sliderVal) : sliderVal;
        if (filterQValModal) filterQValModal.textContent = 'Q: ' + q.toFixed(1);
        syncFilterToInline();
        if (SL.audio && SL.audio.refreshFilter) {
          SL.audio.refreshFilter();
        }
      });
    }

    // Filter model dropdown
    const filterModelModal = document.getElementById('filterModel-modal');
    if (filterModelModal) {
      filterModelModal.addEventListener('change', () => {
        syncFilterToInline();
        // Model change requires different filter implementation
        if (SL.audio && SL.audio.refreshActiveOscillators) {
          SL.audio.refreshActiveOscillators();
        }
      });
    }

    // Frequency unit radio buttons (Hz / Note)
    const freqUnitRadios = document.querySelectorAll('input[name="filterFreqUnit-modal"]');
    freqUnitRadios.forEach(radio => {
      radio.addEventListener('change', () => {
        const sliderVal = filterFreqModal ? parseFloat(filterFreqModal.value) : 850;
        const freq = SL.audio && SL.audio.sliderToFreq ? SL.audio.sliderToFreq(sliderVal) : sliderVal;
        updateFreqDisplay(freq);
      });
    });

    // Filter key tracking slider
    const filterKeyTrackModal = document.getElementById('filterKeyTrack-modal');
    const filterKeyTrackValModal = document.getElementById('filterKeyTrack-val-modal');
    const inlineKeyTrack = document.getElementById('filterKeyTrack');
    if (filterKeyTrackModal) {
      filterKeyTrackModal.addEventListener('input', () => {
        const val = parseInt(filterKeyTrackModal.value);
        if (filterKeyTrackValModal) filterKeyTrackValModal.textContent = val + '%';
        if (inlineKeyTrack) inlineKeyTrack.value = val;

        // Update key tracked display to show effect of new key track amount
        const keyTrackedDisplay = document.getElementById('filterKeyTrackedFreq-val-modal');
        if (keyTrackedDisplay) {
          if (val > 0) {
            keyTrackedDisplay.textContent = SL.t('ui.label.play_a_note');
          } else {
            // No key tracking - show same as base cutoff
            const filterSettings = SL.audio && SL.audio.getFilterSettings ? SL.audio.getFilterSettings() : null;
            if (filterSettings) {
              if (filterSettings.frequency >= 1000) {
                keyTrackedDisplay.textContent = (filterSettings.frequency / 1000).toFixed(2) + ' kHz';
              } else {
                keyTrackedDisplay.textContent = Math.round(filterSettings.frequency) + ' Hz';
              }
            }
          }
        }

        // Key tracking change requires refresh to apply to active notes
        if (SL.audio && SL.audio.refreshActiveOscillators) {
          SL.audio.refreshActiveOscillators();
        }
        // Also update continuous noise filter
        if (SL.audio && SL.audio.updateContinuousNoiseFilter) {
          SL.audio.updateContinuousNoiseFilter();
        }
      });
    }

    // ============================================================
    // Noise Control Sync and Event Listeners
    // ============================================================

    // Helper to sync noise modal to inline
    function syncNoiseToInline() {
      const modalTypeRadio = document.querySelector('input[name="noiseType-modal"]:checked');
      const modalLevel = document.getElementById('noiseLevel-modal');

      const inlineEnabled = document.getElementById('noiseEnabled');
      const inlineType = document.getElementById('noiseType');
      const inlineLevel = document.getElementById('noiseLevel');

      // Noise is always enabled now (no enable checkbox in modal)
      if (inlineEnabled) inlineEnabled.checked = true;
      if (inlineType && modalTypeRadio) inlineType.value = modalTypeRadio.value;
      if (inlineLevel && modalLevel) inlineLevel.value = modalLevel.value;
    }

    // Helper to convert linear level (0-100) to dB display - defined earlier, reuse
    function levelToDbDisplayForSync(level) {
      if (level <= 0) return '-\u221E dB';
      const linearLevel = level / 100;
      const db = 20 * Math.log10(linearLevel);
      if (db <= -60) return '-\u221E dB';
      return db.toFixed(1) + ' dB';
    }

    // Helper to sync noise inline to modal
    function syncNoiseToModal() {
      const inlineType = document.getElementById('noiseType');
      const inlineLevel = document.getElementById('noiseLevel');

      const modalTypeRadios = document.querySelectorAll('input[name="noiseType-modal"]');
      const modalLevel = document.getElementById('noiseLevel-modal');
      const modalLevelVal = document.getElementById('noiseLevel-val-modal');

      // Noise is always enabled now (no enable checkbox in modal)

      if (inlineType) {
        modalTypeRadios.forEach(radio => {
          radio.checked = (radio.value === inlineType.value);
        });
      }

      if (modalLevel && inlineLevel) {
        modalLevel.value = inlineLevel.value;
        if (modalLevelVal) modalLevelVal.textContent = levelToDbDisplayForSync(parseInt(inlineLevel.value));
      }
    }

    // Noise is always enabled now (no enable checkbox)
    // Noise type radio buttons
    const noiseTypeRadios = document.querySelectorAll('input[name="noiseType-modal"]');
    noiseTypeRadios.forEach(radio => {
      radio.addEventListener('change', () => {
        syncNoiseToInline();
        // Restart continuous noise with new type
        if (SL.audio && SL.audio.restartContinuousNoise) {
          SL.audio.restartContinuousNoise();
        }
      });
    });

    // Helper to convert linear level (0-100) to dB display
    function levelToDbDisplay(level) {
      if (level <= 0) return '-\u221E dB';
      const linearLevel = level / 100;
      const db = 20 * Math.log10(linearLevel);
      if (db <= -60) return '-\u221E dB';
      return db.toFixed(1) + ' dB';
    }

    // Noise level slider
    const noiseLevelModal = document.getElementById('noiseLevel-modal');
    const noiseLevelValModal = document.getElementById('noiseLevel-val-modal');
    if (noiseLevelModal) {
      noiseLevelModal.addEventListener('input', () => {
        const val = parseInt(noiseLevelModal.value);
        if (noiseLevelValModal) noiseLevelValModal.textContent = levelToDbDisplay(val);
        syncNoiseToInline();
        // Update continuous noise level
        if (SL.audio && SL.audio.updateContinuousNoise) {
          SL.audio.updateContinuousNoise();
        }
      });
    }

    // Sync noise controls when modal opens (update mixerBtn click handler)
    const origMixerClickHandler = mixerBtn.onclick;
    mixerBtn.addEventListener('click', () => {
      syncNoiseToModal();
      // Also sync key tracking
      const inlineKeyTrackEl = document.getElementById('filterKeyTrack');
      const modalKeyTrackEl = document.getElementById('filterKeyTrack-modal');
      const modalKeyTrackValEl = document.getElementById('filterKeyTrack-val-modal');
      if (modalKeyTrackEl && inlineKeyTrackEl) {
        modalKeyTrackEl.value = inlineKeyTrackEl.value;
        if (modalKeyTrackValEl) modalKeyTrackValEl.textContent = inlineKeyTrackEl.value + '%';
      }
      // Sync filter envelope controls
      syncFilterEnvToModal();
    });

    // ============================================================
    // Filter Envelope Control Sync and Event Listeners
    // ============================================================

    // Helper to sync filter envelope inline controls to modal
    function syncFilterEnvToModal() {
      const inlineEnabled = document.getElementById('filterEnvEnabled');
      const inlineAmount = document.getElementById('filterEnvAmount');
      const inlineA = document.getElementById('filterEnvA');
      const inlineD = document.getElementById('filterEnvD');
      const inlineS = document.getElementById('filterEnvS');
      const inlineR = document.getElementById('filterEnvR');
      const inlineLinkToAmp = document.getElementById('filterEnvLinkToAmp');

      const modalEnabled = document.getElementById('filterEnvEnabled-modal');
      const modalAmount = document.getElementById('filterEnvAmount-modal');
      const modalAmountVal = document.getElementById('filterEnvAmount-val-modal');
      const modalA = document.getElementById('filterEnvA-modal');
      const modalAVal = document.getElementById('filterEnvA-val-modal');
      const modalD = document.getElementById('filterEnvD-modal');
      const modalDVal = document.getElementById('filterEnvD-val-modal');
      const modalS = document.getElementById('filterEnvS-modal');
      const modalSVal = document.getElementById('filterEnvS-val-modal');
      const modalR = document.getElementById('filterEnvR-modal');
      const modalRVal = document.getElementById('filterEnvR-val-modal');
      const modalLinkToAmp = document.getElementById('filterEnvLinkToAmp-modal');

      if (modalEnabled && inlineEnabled) modalEnabled.checked = inlineEnabled.checked;

      if (modalAmount && inlineAmount) {
        modalAmount.value = inlineAmount.value;
        if (modalAmountVal) {
          const amt = parseInt(inlineAmount.value);
          modalAmountVal.textContent = (amt >= 0 ? '+' : '') + amt + ' st';
        }
      }

      if (modalA && inlineA) {
        modalA.value = inlineA.value;
        if (modalAVal) modalAVal.textContent = SL.ui.formatFilterEnvTime('A', parseFloat(inlineA.value)) + 'ms';
      }
      if (modalD && inlineD) {
        modalD.value = inlineD.value;
        if (modalDVal) modalDVal.textContent = SL.ui.formatFilterEnvTime('D', parseFloat(inlineD.value)) + 'ms';
      }
      if (modalS && inlineS) {
        modalS.value = inlineS.value;
        if (modalSVal) modalSVal.textContent = inlineS.value + '%';
      }
      if (modalR && inlineR) {
        modalR.value = inlineR.value;
        if (modalRVal) modalRVal.textContent = SL.ui.formatFilterEnvTime('R', parseFloat(inlineR.value)) + 'ms';
      }

      if (modalLinkToAmp && inlineLinkToAmp) modalLinkToAmp.checked = inlineLinkToAmp.checked;

      // Update disabled state
      updateFilterEnvDisabledState();
      updateFilterEnvADSRDisabledState();
    }

    // Helper to sync filter envelope modal controls back to inline
    function syncFilterEnvToInline() {
      const modalEnabled = document.getElementById('filterEnvEnabled-modal');
      const modalAmount = document.getElementById('filterEnvAmount-modal');
      const modalA = document.getElementById('filterEnvA-modal');
      const modalD = document.getElementById('filterEnvD-modal');
      const modalS = document.getElementById('filterEnvS-modal');
      const modalR = document.getElementById('filterEnvR-modal');
      const modalLinkToAmp = document.getElementById('filterEnvLinkToAmp-modal');

      const inlineEnabled = document.getElementById('filterEnvEnabled');
      const inlineAmount = document.getElementById('filterEnvAmount');
      const inlineA = document.getElementById('filterEnvA');
      const inlineD = document.getElementById('filterEnvD');
      const inlineS = document.getElementById('filterEnvS');
      const inlineR = document.getElementById('filterEnvR');
      const inlineLinkToAmp = document.getElementById('filterEnvLinkToAmp');

      if (inlineEnabled && modalEnabled) inlineEnabled.checked = modalEnabled.checked;
      if (inlineAmount && modalAmount) inlineAmount.value = modalAmount.value;
      if (inlineA && modalA) inlineA.value = modalA.value;
      if (inlineD && modalD) inlineD.value = modalD.value;
      if (inlineS && modalS) inlineS.value = modalS.value;
      if (inlineR && modalR) inlineR.value = modalR.value;
      if (inlineLinkToAmp && modalLinkToAmp) inlineLinkToAmp.checked = modalLinkToAmp.checked;
    }

    // Helper to update filter envelope section disabled state
    function updateFilterEnvDisabledState() {
      const filterEnvSection = document.querySelector('.filter-env-section-modal');
      const modalEnabled = document.getElementById('filterEnvEnabled-modal');
      if (filterEnvSection && modalEnabled) {
        if (modalEnabled.checked) {
          filterEnvSection.classList.remove('disabled');
        } else {
          filterEnvSection.classList.add('disabled');
        }
      }
    }

    // Helper to update filter envelope ADSR disabled state (when linked to amp)
    function updateFilterEnvADSRDisabledState() {
      const modalLinkToAmp = document.getElementById('filterEnvLinkToAmp-modal');
      const adsrContainer = document.querySelector('.filter-env-adsr-container');
      if (adsrContainer && modalLinkToAmp) {
        if (modalLinkToAmp.checked) {
          adsrContainer.classList.add('linked');
        } else {
          adsrContainer.classList.remove('linked');
        }
      }
    }

    // Filter envelope enable checkbox
    const filterEnvEnabledModal = document.getElementById('filterEnvEnabled-modal');
    if (filterEnvEnabledModal) {
      filterEnvEnabledModal.addEventListener('change', () => {
        syncFilterEnvToInline();
        updateFilterEnvDisabledState();
        // When toggling filter envelope, need to refresh oscillators
        if (SL.audio && SL.audio.refreshActiveOscillators) {
          SL.audio.refreshActiveOscillators();
        }
      });
    }

    // Filter envelope amount slider
    const filterEnvAmountModal = document.getElementById('filterEnvAmount-modal');
    const filterEnvAmountValModal = document.getElementById('filterEnvAmount-val-modal');
    if (filterEnvAmountModal) {
      filterEnvAmountModal.addEventListener('input', () => {
        const amt = parseInt(filterEnvAmountModal.value);
        if (filterEnvAmountValModal) filterEnvAmountValModal.textContent = (amt >= 0 ? '+' : '') + amt + ' st';
        syncFilterEnvToInline();
        if (SL.audio && SL.audio.refreshActiveOscillators) {
          SL.audio.refreshActiveOscillators();
        }
      });
    }

    // Filter envelope ADSR sliders (with logarithmic display + units)
    const filterEnvAModal = document.getElementById('filterEnvA-modal');
    const filterEnvAValModal = document.getElementById('filterEnvA-val-modal');
    if (filterEnvAModal) {
      filterEnvAModal.addEventListener('input', () => {
        if (filterEnvAValModal) filterEnvAValModal.textContent = SL.ui.formatFilterEnvTime('A', parseFloat(filterEnvAModal.value)) + 'ms';
        syncFilterEnvToInline();
        if (SL.audio && SL.audio.refreshActiveOscillators) {
          SL.audio.refreshActiveOscillators();
        }
      });
    }

    const filterEnvDModal = document.getElementById('filterEnvD-modal');
    const filterEnvDValModal = document.getElementById('filterEnvD-val-modal');
    if (filterEnvDModal) {
      filterEnvDModal.addEventListener('input', () => {
        if (filterEnvDValModal) filterEnvDValModal.textContent = SL.ui.formatFilterEnvTime('D', parseFloat(filterEnvDModal.value)) + 'ms';
        syncFilterEnvToInline();
        if (SL.audio && SL.audio.refreshActiveOscillators) {
          SL.audio.refreshActiveOscillators();
        }
      });
    }

    const filterEnvSModal = document.getElementById('filterEnvS-modal');
    const filterEnvSValModal = document.getElementById('filterEnvS-val-modal');
    if (filterEnvSModal) {
      filterEnvSModal.addEventListener('input', () => {
        if (filterEnvSValModal) filterEnvSValModal.textContent = filterEnvSModal.value + '%';
        syncFilterEnvToInline();
        if (SL.audio && SL.audio.refreshActiveOscillators) {
          SL.audio.refreshActiveOscillators();
        }
      });
    }

    const filterEnvRModal = document.getElementById('filterEnvR-modal');
    const filterEnvRValModal = document.getElementById('filterEnvR-val-modal');
    if (filterEnvRModal) {
      filterEnvRModal.addEventListener('input', () => {
        if (filterEnvRValModal) filterEnvRValModal.textContent = SL.ui.formatFilterEnvTime('R', parseFloat(filterEnvRModal.value)) + 'ms';
        syncFilterEnvToInline();
        if (SL.audio && SL.audio.refreshActiveOscillators) {
          SL.audio.refreshActiveOscillators();
        }
      });
    }

    // Filter envelope "Link to Amp" checkbox
    const filterEnvLinkToAmpModal = document.getElementById('filterEnvLinkToAmp-modal');
    if (filterEnvLinkToAmpModal) {
      filterEnvLinkToAmpModal.addEventListener('change', () => {
        syncFilterEnvToInline();
        updateFilterEnvADSRDisabledState();
        if (SL.audio && SL.audio.refreshActiveOscillators) {
          SL.audio.refreshActiveOscillators();
        }
      });
    }

    // ============================================================
    // Physical Modelling Controls
    // ============================================================

    function updatePhysicalParamVisibility(model) {
      if (!model) {
        var modelEl = document.getElementById('physicalModel');
        model = modelEl ? modelEl.value : 'pluck';
      }
      var pluckParams = document.getElementById('physicalPluckParams');
      var bowParams = document.getElementById('physicalBowParams');
      var blowParams = document.getElementById('physicalBlowParams');
      var strikeParams = document.getElementById('physicalStrikeParams');

      if (pluckParams) pluckParams.style.display = model === 'pluck' ? '' : 'none';
      if (bowParams) bowParams.style.display = model === 'bow' ? '' : 'none';
      if (blowParams) blowParams.style.display = model === 'blow' ? '' : 'none';
      if (strikeParams) strikeParams.style.display = model === 'strike' ? '' : 'none';
    }

    // Model selector
    var physModelSelect = document.getElementById('physicalModel');
    if (physModelSelect) {
      physModelSelect.addEventListener('change', function() {
        var instId = SL.audio.getCurrentInstrument();
        if (SL.physical && SL.physical.setModel) {
          SL.physical.setModel(instId, physModelSelect.value);
        }
        if (SL.audio.setPhysicalSettings) {
          var s = SL.audio.getPhysicalSettings(instId);
          s.model = physModelSelect.value;
          SL.audio.setPhysicalSettings(instId, s);
        }
        updatePhysicalParamVisibility(physModelSelect.value);
      });
    }

    // Physical parameter sliders
    var physicalSliders = ['damping', 'brightness', 'bodySize', 'decayTime', 'bowPressure', 'bowPosition', 'breathPressure', 'embouchure', 'strikePosition', 'hardness'];
    physicalSliders.forEach(function(name) {
      var el = document.getElementById('physical_' + name);
      var valEl = document.getElementById('physical_' + name + 'Val');
      if (el) {
        el.addEventListener('input', function() {
          if (valEl) valEl.textContent = el.value;
          var instId = SL.audio.getCurrentInstrument();
          if (SL.physical && SL.physical.setParam) {
            SL.physical.setParam(instId, name, parseFloat(el.value));
          }
        });
      }
    });

    // Excitation selector
    var excitationEl = document.getElementById('physical_excitation');
    if (excitationEl) {
      excitationEl.addEventListener('change', function() {
        var instId = SL.audio.getCurrentInstrument();
        if (SL.physical && SL.physical.setParam) {
          SL.physical.setParam(instId, 'excitation', excitationEl.value);
        }
      });
    }

    // Material selector
    var materialEl = document.getElementById('physical_material');
    if (materialEl) {
      materialEl.addEventListener('change', function() {
        var instId = SL.audio.getCurrentInstrument();
        if (SL.physical && SL.physical.setParam) {
          SL.physical.setParam(instId, 'material', materialEl.value);
        }
      });
    }

    // Strike decay slider (maps to decayTime param)
    var strikeDecayEl = document.getElementById('physical_strikeDecay');
    var strikeDecayValEl = document.getElementById('physical_strikeDecayVal');
    if (strikeDecayEl) {
      strikeDecayEl.addEventListener('input', function() {
        if (strikeDecayValEl) strikeDecayValEl.textContent = strikeDecayEl.value;
        var instId = SL.audio.getCurrentInstrument();
        if (SL.physical && SL.physical.setParam) {
          SL.physical.setParam(instId, 'decayTime', parseFloat(strikeDecayEl.value));
        }
      });
    }



    // ============================================================
    // Body Resonance Controls (Physical Modeling post-processor)
    // ============================================================

    var bodyTypeEl = document.getElementById('bodyResonanceType');
    if (bodyTypeEl) {
      bodyTypeEl.addEventListener('change', function() {
        var instId = SL.audio.getCurrentInstrument();
        if (SL.bodyResonance && SL.bodyResonance.setBody) {
          SL.bodyResonance.setBody(instId, bodyTypeEl.value);
        }
      });
    }

    var bodyResAmountEl = document.getElementById('bodyResonanceAmount');
    var bodyResAmountValEl = document.getElementById('bodyResonanceAmountVal');
    if (bodyResAmountEl) {
      bodyResAmountEl.addEventListener('input', function() {
        if (bodyResAmountValEl) bodyResAmountValEl.textContent = bodyResAmountEl.value + '%';
        var instId = SL.audio.getCurrentInstrument();
        if (SL.bodyResonance && SL.bodyResonance.setResonanceAmount) {
          SL.bodyResonance.setResonanceAmount(instId, parseFloat(bodyResAmountEl.value));
        }
      });
    }

    var bodyBrightnessEl = document.getElementById('bodyResonanceBrightness');
    var bodyBrightnessValEl = document.getElementById('bodyResonanceBrightnessVal');
    if (bodyBrightnessEl) {
      bodyBrightnessEl.addEventListener('input', function() {
        if (bodyBrightnessValEl) bodyBrightnessValEl.textContent = bodyBrightnessEl.value;
        var instId = SL.audio.getCurrentInstrument();
        if (SL.bodyResonance && SL.bodyResonance.setBrightness) {
          SL.bodyResonance.setBrightness(instId, parseFloat(bodyBrightnessEl.value));
        }
      });
    }

    var bodySizeEl = document.getElementById('bodyResonanceSize');
    var bodySizeValEl = document.getElementById('bodyResonanceSizeVal');
    if (bodySizeEl) {
      bodySizeEl.addEventListener('input', function() {
        if (bodySizeValEl) bodySizeValEl.textContent = bodySizeEl.value;
        var instId = SL.audio.getCurrentInstrument();
        if (SL.bodyResonance && SL.bodyResonance.setBodySize) {
          SL.bodyResonance.setBodySize(instId, parseFloat(bodySizeEl.value));
        }
      });
    }

    // ============================================================
    // Reed Controls
    // ============================================================

    var reedTypeEl = document.getElementById('reedType');
    if (reedTypeEl) {
      reedTypeEl.addEventListener('change', function() {
        var instId = SL.audio.getCurrentInstrument();
        if (SL.reed && SL.reed.setReedType) {
          SL.reed.setReedType(instId, reedTypeEl.value);
        }
      });
    }

    var reedStiffnessEl = document.getElementById('reedStiffness');
    var reedStiffnessValEl = document.getElementById('reedStiffnessVal');
    if (reedStiffnessEl) {
      reedStiffnessEl.addEventListener('input', function() {
        if (reedStiffnessValEl) reedStiffnessValEl.textContent = reedStiffnessEl.value;
        var instId = SL.audio.getCurrentInstrument();
        if (SL.reed && SL.reed.setReedStiffness) {
          SL.reed.setReedStiffness(instId, parseFloat(reedStiffnessEl.value));
        }
      });
    }

    var reedEmbouchureEl = document.getElementById('reedEmbouchure');
    var reedEmbouchureValEl = document.getElementById('reedEmbouchureVal');
    if (reedEmbouchureEl) {
      reedEmbouchureEl.addEventListener('input', function() {
        if (reedEmbouchureValEl) reedEmbouchureValEl.textContent = reedEmbouchureEl.value;
        var instId = SL.audio.getCurrentInstrument();
        if (SL.reed && SL.reed.setEmbouchurePressure) {
          SL.reed.setEmbouchurePressure(instId, parseFloat(reedEmbouchureEl.value));
        }
      });
    }

    var reedRegisterEl = document.getElementById('reedRegister');
    if (reedRegisterEl) {
      reedRegisterEl.addEventListener('change', function() {
        var instId = SL.audio.getCurrentInstrument();
        if (SL.reed && SL.reed.setRegister) {
          SL.reed.setRegister(instId, reedRegisterEl.value);
        }
      });
    }

    var reedVibratoRateEl = document.getElementById('reedVibratoRate');
    var reedVibratoRateValEl = document.getElementById('reedVibratoRateVal');
    if (reedVibratoRateEl) {
      reedVibratoRateEl.addEventListener('input', function() {
        var rate = parseFloat(reedVibratoRateEl.value) / 10;
        if (reedVibratoRateValEl) reedVibratoRateValEl.textContent = rate.toFixed(1) + ' Hz';
        var instId = SL.audio.getCurrentInstrument();
        if (SL.reed && SL.reed.setVibratoRate) {
          SL.reed.setVibratoRate(instId, rate);
        }
      });
    }

    var reedVibratoDepthEl = document.getElementById('reedVibratoDepth');
    var reedVibratoDepthValEl = document.getElementById('reedVibratoDepthVal');
    if (reedVibratoDepthEl) {
      reedVibratoDepthEl.addEventListener('input', function() {
        if (reedVibratoDepthValEl) reedVibratoDepthValEl.textContent = reedVibratoDepthEl.value;
        var instId = SL.audio.getCurrentInstrument();
        if (SL.reed && SL.reed.setVibratoDepth) {
          SL.reed.setVibratoDepth(instId, parseFloat(reedVibratoDepthEl.value));
        }
      });
    }

    var reedBreathNoiseEl = document.getElementById('reedBreathNoise');
    var reedBreathNoiseValEl = document.getElementById('reedBreathNoiseVal');
    if (reedBreathNoiseEl) {
      reedBreathNoiseEl.addEventListener('input', function() {
        if (reedBreathNoiseValEl) reedBreathNoiseValEl.textContent = reedBreathNoiseEl.value;
        var instId = SL.audio.getCurrentInstrument();
        if (SL.reed && SL.reed.setBreathNoise) {
          SL.reed.setBreathNoise(instId, parseFloat(reedBreathNoiseEl.value));
        }
      });
    }

    // ============================================================
    // LFO Tab UI
    // ============================================================

    /**
     * Draw LFO waveform preview on a canvas
     * @param {number} lfoNum - 1 or 2
     */
    function drawLFOWaveform(lfoNum) {
      var canvas = document.getElementById('lfo' + lfoNum + 'Canvas');
      if (!canvas) return;
      var ctx = canvas.getContext('2d');
      var w = canvas.width;
      var h = canvas.height;
      var waveformEl = document.getElementById('lfo' + lfoNum + 'Waveform');
      var waveform = waveformEl ? waveformEl.value : 'sine';

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, w, h);

      // Draw center line
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      // Draw waveform
      ctx.strokeStyle = '#00d4aa';
      ctx.lineWidth = 2;
      ctx.beginPath();

      var cycles = 2;
      var shValues = [];
      if (waveform === 'sh') {
        var steps = 16;
        for (var si = 0; si < steps; si++) {
          shValues.push(Math.random() * 2 - 1);
        }
      }

      for (var x = 0; x < w; x++) {
        var t = (x / w) * cycles;
        var phase = t % 1;
        var val = 0;

        if (waveform === 'sine') {
          val = Math.sin(phase * 2 * Math.PI);
        } else if (waveform === 'triangle') {
          val = phase < 0.25 ? phase * 4 : phase < 0.75 ? 2 - phase * 4 : phase * 4 - 4;
        } else if (waveform === 'square') {
          val = phase < 0.5 ? 1 : -1;
        } else if (waveform === 'saw') {
          val = 2 * phase - 1;
        } else if (waveform === 'sh') {
          var stepIdx = Math.floor(t * (shValues.length / cycles)) % shValues.length;
          val = shValues[stepIdx];
        }

        var y = h / 2 - val * (h / 2 - 4);
        if (x === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }

    /**
     * Build the LFO section HTML for one LFO
     * @param {number} n - LFO number (1 or 2)
     * @returns {string} HTML string
     */
    function buildLFOSectionHTML(n) {
      var defaultRate = n === 1 ? '2.0' : '0.5';
      var defaultDepth = n === 1 ? '50' : '30';
      var defaultWave = n === 1 ? 'sine' : 'triangle';
      return '<div class="lfo-section">' +
        '<div class="lfo-header">' +
          '<label class="lfo-enable-label"><input type="checkbox" id="lfo' + n + 'Enabled"> LFO ' + n + '</label>' +
        '</div>' +
        '<div class="lfo-controls">' +
          '<div class="lfo-param">' +
            '<label>Rate</label>' +
            '<input type="range" aria-label="Lfo' + n + 'Rate" id="lfo' + n + 'Rate" min="0.1" max="20" step="0.1" value="' + defaultRate + '">' +
            '<span id="lfo' + n + 'RateVal" class="lfo-val">' + parseFloat(defaultRate).toFixed(1) + ' Hz</span>' +
          '</div>' +
          '<div class="lfo-param">' +
            '<label>Depth</label>' +
            '<input type="range" aria-label="Lfo' + n + 'Depth" id="lfo' + n + 'Depth" min="0" max="100" step="1" value="' + defaultDepth + '">' +
            '<span id="lfo' + n + 'DepthVal" class="lfo-val">' + defaultDepth + '%</span>' +
          '</div>' +
          '<div class="lfo-param">' +
            '<label>Waveform</label>' +
            '<select id="lfo' + n + 'Waveform">' +
              '<option value="sine"' + (defaultWave === 'sine' ? ' selected' : '') + '>Sine</option>' +
              '<option value="triangle"' + (defaultWave === 'triangle' ? ' selected' : '') + '>Triangle</option>' +
              '<option value="square">Square</option>' +
              '<option value="saw">Saw</option>' +
              '<option value="sh">S&amp;H</option>' +
            '</select>' +
          '</div>' +
          '<div class="lfo-param">' +
            '<label>Target</label>' +
            '<select id="lfo' + n + 'Target">' +
              '<option value="none" selected>None</option>' +
              '<option value="pitch">Pitch</option>' +
              '<option value="filter">Filter</option>' +
              '<option value="amplitude">Amplitude</option>' +
              '<option value="pan">Pan</option>' +
            '</select>' +
          '</div>' +
          '<div class="lfo-canvas-wrap">' +
            '<canvas id="lfo' + n + 'Canvas" width="200" height="60"></canvas>' +
          '</div>' +
        '</div>' +
      '</div>';
    }

    // Build LFO tab content
    if (lfoTabContent) {
      lfoTabContent.innerHTML = '<div class="lfo-tab-inner">' +
        buildLFOSectionHTML(1) +
        buildLFOSectionHTML(2) +
      '</div>';

      // Wire up event listeners for LFO controls
      [1, 2].forEach(function(n) {
        var rateEl = document.getElementById('lfo' + n + 'Rate');
        var rateValEl = document.getElementById('lfo' + n + 'RateVal');
        var depthEl = document.getElementById('lfo' + n + 'Depth');
        var depthValEl = document.getElementById('lfo' + n + 'DepthVal');
        var waveformEl = document.getElementById('lfo' + n + 'Waveform');
        var targetEl = document.getElementById('lfo' + n + 'Target');
        var enabledEl = document.getElementById('lfo' + n + 'Enabled');

        if (rateEl) {
          rateEl.addEventListener('input', function() {
            if (rateValEl) rateValEl.textContent = parseFloat(rateEl.value).toFixed(1) + ' Hz';
            var instId = SL.audio.getCurrentInstrument();
            if (SL.audio.updateLFO) SL.audio.updateLFO(instId, n, 'rate', parseFloat(rateEl.value));
            drawLFOWaveform(n);
          });
        }

        if (depthEl) {
          depthEl.addEventListener('input', function() {
            if (depthValEl) depthValEl.textContent = depthEl.value + '%';
            var instId = SL.audio.getCurrentInstrument();
            if (SL.audio.updateLFO) SL.audio.updateLFO(instId, n, 'depth', parseFloat(depthEl.value));
            drawLFOWaveform(n);
          });
        }

        if (waveformEl) {
          waveformEl.addEventListener('change', function() {
            var instId = SL.audio.getCurrentInstrument();
            if (SL.audio.updateLFO) SL.audio.updateLFO(instId, n, 'waveform', waveformEl.value);
            drawLFOWaveform(n);
          });
        }

        if (targetEl) {
          targetEl.addEventListener('change', function() {
            var instId = SL.audio.getCurrentInstrument();
            if (SL.audio.updateLFO) SL.audio.updateLFO(instId, n, 'target', targetEl.value);
          });
        }

        if (enabledEl) {
          enabledEl.addEventListener('change', function() {
            var instId = SL.audio.getCurrentInstrument();
            if (SL.audio.updateLFO) SL.audio.updateLFO(instId, n, 'enabled', enabledEl.checked);
          });
        }
      });
    }

    /**
     * Sync LFO modal controls from instrument settings
     */
    function syncLFOToModal() {
      var instId = SL.audio.getCurrentInstrument();
      var instruments = SL.audio.getInstruments();
      var settings = instruments[instId].settings;
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

        drawLFOWaveform(n);
      });
    }

    // ============================================================
    // Mod Matrix UI
    // ============================================================

    /**
     * Build one mod matrix row HTML
     * @param {number} slotIndex - 0..7
     * @returns {string}
     */
    function buildModMatrixRowHTML(slotIndex) {
      var sources = SL.audio.modMatrix ? SL.audio.modMatrix.getSources() : [];
      var dests = SL.audio.modMatrix ? SL.audio.modMatrix.getDestinations() : [];

      var sourceOpts = '';
      for (var si = 0; si < sources.length; si++) {
        sourceOpts += '<option value="' + sources[si].id + '">' + SL.t(sources[si].i18n, sources[si].label) + '</option>';
      }

      var destOpts = '';
      for (var di = 0; di < dests.length; di++) {
        destOpts += '<option value="' + dests[di].id + '">' + SL.t(dests[di].i18n, dests[di].label) + '</option>';
      }

      return '<div class="mod-matrix-row" id="modMatrixRow' + slotIndex + '">' +
        '<div class="mod-matrix-enable">' +
          '<input type="checkbox" id="modMatrixEnable' + slotIndex + '">' +
        '</div>' +
        '<div class="mod-matrix-slot-num">' + (slotIndex + 1) + '</div>' +
        '<select class="mod-matrix-select" id="modMatrixSource' + slotIndex + '">' + sourceOpts + '</select>' +
        '<select class="mod-matrix-select" id="modMatrixDest' + slotIndex + '">' + destOpts + '</select>' +
        '<input type="range" aria-label="Mod Matrix Amount ' + slotIndex + '" class="mod-matrix-amount" id="modMatrixAmount' + slotIndex + '" min="-100" max="100" step="1" value="0">' +
        '<span class="mod-matrix-amount-val" id="modMatrixAmountVal' + slotIndex + '">0</span>' +
        '<div class="mod-matrix-activity" id="modMatrixActivity' + slotIndex + '"></div>' +
      '</div>';
    }

    /**
     * Build and populate the mod matrix standalone panel
     */
    if (modMatrixPanelContent) {
      var headerHTML = '<div class="mod-matrix-header">' +
        '<div class="mod-matrix-header-enable"></div>' +
        '<div class="mod-matrix-header-slot">#</div>' +
        '<div class="mod-matrix-header-source" data-i18n="mod_matrix.header_source">' + SL.t('mod_matrix.header_source', 'Source') + '</div>' +
        '<div class="mod-matrix-header-dest" data-i18n="mod_matrix.header_destination">' + SL.t('mod_matrix.header_destination', 'Destination') + '</div>' +
        '<div class="mod-matrix-header-amount" data-i18n="mod_matrix.header_amount">' + SL.t('mod_matrix.header_amount', 'Amount') + '</div>' +
        '<div class="mod-matrix-header-val"></div>' +
        '<div></div>' +
      '</div>';

      var rowsHTML = '';
      var numSlots = (SL.audio.modMatrix && SL.audio.modMatrix.NUM_SLOTS) ? SL.audio.modMatrix.NUM_SLOTS : 8;
      for (var ri = 0; ri < numSlots; ri++) {
        rowsHTML += buildModMatrixRowHTML(ri);
      }

      modMatrixPanelContent.innerHTML = '<div class="mod-matrix-tab-inner">' +
        '<div class="mod-matrix-grid">' + headerHTML + rowsHTML + '</div>' +
      '</div>';

      // Wire up event listeners for mod matrix controls
      for (var mi = 0; mi < numSlots; mi++) {
        (function(slotIdx) {
          var enableEl = document.getElementById('modMatrixEnable' + slotIdx);
          var sourceEl = document.getElementById('modMatrixSource' + slotIdx);
          var destEl = document.getElementById('modMatrixDest' + slotIdx);
          var amountEl = document.getElementById('modMatrixAmount' + slotIdx);
          var amountValEl = document.getElementById('modMatrixAmountVal' + slotIdx);
          var rowEl = document.getElementById('modMatrixRow' + slotIdx);
          var activityEl = document.getElementById('modMatrixActivity' + slotIdx);

          function updateRowState() {
            if (!rowEl) {
              return;
            }
            var isEnabled = enableEl && enableEl.checked;
            var hasSource = sourceEl && sourceEl.value !== 'none';
            var hasDest = destEl && destEl.value !== 'none';
            if (isEnabled && hasSource && hasDest) {
              rowEl.classList.add('active');
              rowEl.classList.remove('disabled');
              if (activityEl) activityEl.classList.add('active');
            } else if (isEnabled) {
              rowEl.classList.remove('active');
              rowEl.classList.remove('disabled');
              if (activityEl) activityEl.classList.remove('active');
            } else {
              rowEl.classList.remove('active');
              rowEl.classList.add('disabled');
              if (activityEl) activityEl.classList.remove('active');
            }
          }

          if (enableEl) {
            enableEl.addEventListener('change', function() {
              var instId = SL.audio.getCurrentInstrument();
              if (SL.audio.modMatrix) SL.audio.modMatrix.updateSlot(instId, slotIdx, 'enabled', enableEl.checked);
              updateRowState();
            });
          }

          if (sourceEl) {
            sourceEl.addEventListener('change', function() {
              var instId = SL.audio.getCurrentInstrument();
              if (SL.audio.modMatrix) SL.audio.modMatrix.updateSlot(instId, slotIdx, 'source', sourceEl.value);
              updateRowState();
            });
          }

          if (destEl) {
            destEl.addEventListener('change', function() {
              var instId = SL.audio.getCurrentInstrument();
              if (SL.audio.modMatrix) SL.audio.modMatrix.updateSlot(instId, slotIdx, 'destination', destEl.value);
              updateRowState();
            });
          }

          if (amountEl) {
            amountEl.addEventListener('input', function() {
              if (amountValEl) amountValEl.textContent = amountEl.value;
              var instId = SL.audio.getCurrentInstrument();
              if (SL.audio.modMatrix) SL.audio.modMatrix.updateSlot(instId, slotIdx, 'amount', parseInt(amountEl.value));
            });
          }
        })(mi);
      }
    }

    /**
     * Refresh mod matrix UI from current instrument settings
     */
    function refreshModMatrixUI() {
      if (!SL.audio.modMatrix) {
        return;
      }
      var instId = SL.audio.getCurrentInstrument();
      var slots = SL.audio.modMatrix.getSettings(instId);
      var numSlots = SL.audio.modMatrix.NUM_SLOTS || 8;

      for (var i = 0; i < numSlots; i++) {
        var slot = slots[i];
        var enableEl = document.getElementById('modMatrixEnable' + i);
        var sourceEl = document.getElementById('modMatrixSource' + i);
        var destEl = document.getElementById('modMatrixDest' + i);
        var amountEl = document.getElementById('modMatrixAmount' + i);
        var amountValEl = document.getElementById('modMatrixAmountVal' + i);
        var rowEl = document.getElementById('modMatrixRow' + i);
        var activityEl = document.getElementById('modMatrixActivity' + i);

        if (enableEl) enableEl.checked = slot.enabled;
        if (sourceEl) sourceEl.value = slot.source;
        if (destEl) destEl.value = slot.destination;
        if (amountEl) amountEl.value = slot.amount;
        if (amountValEl) amountValEl.textContent = slot.amount;

        // Update row visual state
        if (rowEl) {
          var isActive = slot.enabled && slot.source !== 'none' && slot.destination !== 'none';
          if (isActive) {
            rowEl.classList.add('active');
            rowEl.classList.remove('disabled');
            if (activityEl) activityEl.classList.add('active');
          } else if (slot.enabled) {
            rowEl.classList.remove('active');
            rowEl.classList.remove('disabled');
            if (activityEl) activityEl.classList.remove('active');
          } else {
            rowEl.classList.remove('active');
            rowEl.classList.add('disabled');
            if (activityEl) activityEl.classList.remove('active');
          }
        }
      }
    }

    // ============================================================
    // Mod Matrix Standalone Panel Open/Close
    // ============================================================

    function openModMatrixPanel() {
      if (modMatrixPanel) {
        modMatrixPanel.classList.remove('hidden');
        refreshModMatrixUI();
      }
    }

    function closeModMatrixPanel() {
      if (modMatrixPanel) {
        modMatrixPanel.classList.add('hidden');
      }
    }

    if (modMatrixBtn) {
      modMatrixBtn.addEventListener('click', function() {
        openModMatrixPanel();
      });
    }

    if (modMatrixPanelClose) {
      modMatrixPanelClose.addEventListener('click', function() {
        closeModMatrixPanel();
      });
    }

    // Close on clicking the overlay background
    if (modMatrixPanel) {
      modMatrixPanel.addEventListener('click', function(e) {
        if (e.target === modMatrixPanel) {
          closeModMatrixPanel();
        }
      });
    }

    // Close on Escape key
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && modMatrixPanel && !modMatrixPanel.classList.contains('hidden')) {
        closeModMatrixPanel();
      }
    });

    // Wire up top-bar FREEZE button
    var topFreezeBtnEl = document.getElementById('topFreezeBtn');
    if (topFreezeBtnEl) {
      topFreezeBtnEl.addEventListener('click', function() {
        var currentInstId = SL.audio.getCurrentInstrument();
        if (!SL.granular || !SL.granular.setFreeze) {
          return;
        }
        var isActive = topFreezeBtnEl.classList.contains('active');
        var newState = !isActive;
        SL.granular.setFreeze(currentInstId, newState);
        syncTopFreezeButton(newState);
        // Also sync the modal freeze button if it exists
        var modalFreezeBtn = document.getElementById('granularFreezeBtn');
        if (modalFreezeBtn) {
          if (newState) {
            modalFreezeBtn.classList.add('active');
          } else {
            modalFreezeBtn.classList.remove('active');
          }
        }
      });
      topFreezeBtnEl.addEventListener('mouseenter', function() {
        if (!topFreezeBtnEl.classList.contains('active')) {
          topFreezeBtnEl.style.background = '#2a2a4e';
          topFreezeBtnEl.style.color = '#e0e0e0';
        }
      });
      topFreezeBtnEl.addEventListener('mouseleave', function() {
        if (!topFreezeBtnEl.classList.contains('active')) {
          topFreezeBtnEl.style.background = '#1a1a2e';
          topFreezeBtnEl.style.color = '#b0b0b0';
        }
      });
    }

    // Export these functions for external access (e.g. song generator)
    SL.mixerModal.updateTypeToggleState = updateTypeToggleState;
    SL.mixerModal.updatePhysicalParamVisibility = updatePhysicalParamVisibility;
    SL.mixerModal.updateAdditiveVisibility = updateAdditiveVisibility;
    SL.mixerModal.refreshModMatrixUI = refreshModMatrixUI;

    // Re-render mod matrix labels on language change
    function refreshModMatrixLabels() {
      var sources = SL.audio.modMatrix ? SL.audio.modMatrix.getSources() : [];
      var dests = SL.audio.modMatrix ? SL.audio.modMatrix.getDestinations() : [];
      var numSlots = (SL.audio.modMatrix && SL.audio.modMatrix.NUM_SLOTS) ? SL.audio.modMatrix.NUM_SLOTS : 8;

      for (var i = 0; i < numSlots; i++) {
        var sourceEl = document.getElementById('modMatrixSource' + i);
        var destEl = document.getElementById('modMatrixDest' + i);

        if (sourceEl) {
          for (var si = 0; si < sourceEl.options.length; si++) {
            var sEntry = sources[si];
            if (sEntry) {
              sourceEl.options[si].textContent = SL.t(sEntry.i18n, sEntry.label);
            }
          }
        }

        if (destEl) {
          for (var di = 0; di < destEl.options.length; di++) {
            var dEntry = dests[di];
            if (dEntry) {
              destEl.options[di].textContent = SL.t(dEntry.i18n, dEntry.label);
            }
          }
        }
      }

      // Update header labels
      var headerSource = document.querySelector('.mod-matrix-header-source[data-i18n]');
      var headerDest = document.querySelector('.mod-matrix-header-dest[data-i18n]');
      var headerAmount = document.querySelector('.mod-matrix-header-amount[data-i18n]');
      if (headerSource) { headerSource.textContent = SL.t('mod_matrix.header_source', 'Source'); }
      if (headerDest) { headerDest.textContent = SL.t('mod_matrix.header_destination', 'Destination'); }
      if (headerAmount) { headerAmount.textContent = SL.t('mod_matrix.header_amount', 'Amount'); }
    }

    if (SL.localization && SL.localization.onLanguageChange) {
      SL.localization.onLanguageChange(function() {
        refreshModMatrixLabels();
      });
    }

    SL.mixerModal.refreshModMatrixLabels = refreshModMatrixLabels;
    SL.mixerModal.syncTopFreezeButton = syncTopFreezeButton;

    // Return for backward compat with ui-state.js
    return { updateTypeToggleState: updateTypeToggleState, updatePhysicalParamVisibility: updatePhysicalParamVisibility };
  }

  // Export to SynthLab namespace
  /**
   * Initialize formant controls event listeners
   */
  function initFormantControls() {
    var vowelBtns = document.querySelectorAll('.formant-vowel-btn');
    for (var i = 0; i < vowelBtns.length; i++) {
      vowelBtns[i].addEventListener('click', function() {
        var instId = SL.audio.getCurrentInstrument();
        for (var j = 0; j < vowelBtns.length; j++) {
          vowelBtns[j].classList.remove('active');
        }
        this.classList.add('active');
        if (SL.formant && SL.formant.setSettings) {
          SL.formant.setSettings(instId, { vowel: this.dataset.vowel });
        }
      });
    }
    var morphEl = document.getElementById('formantMorph');
    var morphVal = document.getElementById('formantMorphVal');
    if (morphEl) {
      morphEl.addEventListener('input', function() {
        if (morphVal) morphVal.textContent = morphEl.value + '%';
        var instId = SL.audio.getCurrentInstrument();
        if (SL.formant && SL.formant.setSettings) {
          SL.formant.setSettings(instId, { morphX: parseInt(morphEl.value) });
        }
      });
    }
    var shiftEl = document.getElementById('formantShift');
    var shiftVal = document.getElementById('formantShiftVal');
    if (shiftEl) {
      shiftEl.addEventListener('input', function() {
        if (shiftVal) shiftVal.textContent = shiftEl.value + ' st';
        var instId = SL.audio.getCurrentInstrument();
        if (SL.formant && SL.formant.setSettings) {
          SL.formant.setSettings(instId, { formantShift: parseInt(shiftEl.value) });
        }
      });
    }
    var breathEl = document.getElementById('formantBreathiness');
    var breathVal = document.getElementById('formantBreathinessVal');
    if (breathEl) {
      breathEl.addEventListener('input', function() {
        if (breathVal) breathVal.textContent = breathEl.value + '%';
        var instId = SL.audio.getCurrentInstrument();
        if (SL.formant && SL.formant.setSettings) {
          SL.formant.setSettings(instId, { breathiness: parseInt(breathEl.value) });
        }
      });
    }
    var glottalEl = document.getElementById('formantGlottalPW');
    var glottalVal = document.getElementById('formantGlottalPWVal');
    if (glottalEl) {
      glottalEl.addEventListener('input', function() {
        if (glottalVal) glottalVal.textContent = glottalEl.value + '%';
        var instId = SL.audio.getCurrentInstrument();
        if (SL.formant && SL.formant.setSettings) {
          SL.formant.setSettings(instId, { glottalPulseWidth: parseInt(glottalEl.value) });
        }
      });
    }
  }

  /**
   * Initialize modal controls event listeners
   */
  function initModalControls() {
    var materialEl = document.getElementById('modalMaterial');
    if (materialEl) {
      materialEl.addEventListener('change', function() {
        var instId = SL.audio.getCurrentInstrument();
        if (SL.modal && SL.modal.setSettings) {
          SL.modal.setSettings(instId, { material: materialEl.value });
        }
      });
    }
    var excitationEl = document.getElementById('modalExcitation');
    if (excitationEl) {
      excitationEl.addEventListener('change', function() {
        var instId = SL.audio.getCurrentInstrument();
        if (SL.modal && SL.modal.setSettings) {
          SL.modal.setSettings(instId, { excitation: excitationEl.value });
        }
      });
    }
    var sliderNames = ['MalletHardness', 'Damping', 'Brightness', 'BodySize', 'Inharmonicity'];
    var settingsKeys = ['malletHardness', 'damping', 'brightness', 'bodySize', 'inharmonicity'];
    for (var si = 0; si < sliderNames.length; si++) {
      (function(name, key) {
        var el = document.getElementById('modal' + name);
        var valEl = document.getElementById('modal' + name + 'Val');
        if (el) {
          el.addEventListener('input', function() {
            if (valEl) valEl.textContent = el.value;
            var instId = SL.audio.getCurrentInstrument();
            if (SL.modal && SL.modal.setSettings) {
              var upd = {};
              upd[key] = parseInt(el.value);
              SL.modal.setSettings(instId, upd);
            }
          });
        }
      })(sliderNames[si], settingsKeys[si]);
    }
  }

  // ============================================================
  // Ring Modulation Controls
  // ============================================================

  var _ringmodInitialized = false;

  function initRingmodControls() {
    var container = document.getElementById('ringmodControlsModal');
    if (!container) {
      return;
    }

    var instId = SL.audio.getCurrentInstrument();
    var rmSettings = (SL.ringmod && SL.ringmod.getSettings) ? SL.ringmod.getSettings(instId) : null;
    if (!rmSettings) {
      rmSettings = SL.audio._DEFAULT_INSTRUMENT_SETTINGS.ringmodSettings || {
        carrierWave: 'sine', modWave: 'sine', modRatioMode: 'ratio', modRatio: 2.0, modFixedHz: 440, modDepth: 80
      };
    }

    if (_ringmodInitialized) {
      return;
    }

    var html = '';
    html += '<div class="ringmod-controls-grid">';
    html += '<div class="ringmod-param-group"><label>Carrier Wave</label>';
    html += '<select id="ringmodCarrierWave">';
    html += '<option value="sine">Sine</option><option value="saw">Saw</option>';
    html += '<option value="square">Square</option><option value="triangle">Triangle</option>';
    html += '</select></div>';
    html += '<div class="ringmod-param-group"><label>Modulator Wave</label>';
    html += '<select id="ringmodModWave">';
    html += '<option value="sine">Sine</option><option value="saw">Saw</option>';
    html += '<option value="square">Square</option><option value="triangle">Triangle</option>';
    html += '</select></div>';
    html += '<div class="ringmod-param-group"><label>Mod Ratio</label>';
    html += '<input type="range" aria-label="Ringmod Mod Ratio" id="ringmodModRatio" min="5" max="160" value="' + Math.round((rmSettings.modRatio || 2.0) * 10) + '">';
    html += '<div class="param-value" id="ringmodModRatioVal">' + (rmSettings.modRatio || 2.0).toFixed(1) + 'x</div></div>';
    html += '<div class="ringmod-param-group"><label>Mod Depth</label>';
    html += '<input type="range" aria-label="Ringmod Mod Depth" id="ringmodModDepth" min="0" max="100" value="' + (rmSettings.modDepth || 80) + '">';
    html += '<div class="param-value" id="ringmodModDepthVal">' + (rmSettings.modDepth || 80) + '%</div></div>';
    html += '</div>';

    container.innerHTML = html;

    var carrierEl = document.getElementById('ringmodCarrierWave');
    var modWaveEl = document.getElementById('ringmodModWave');
    var ratioEl = document.getElementById('ringmodModRatio');
    var ratioValEl = document.getElementById('ringmodModRatioVal');
    var depthEl = document.getElementById('ringmodModDepth');
    var depthValEl = document.getElementById('ringmodModDepthVal');

    if (carrierEl) {
      carrierEl.value = rmSettings.carrierWave || 'sine';
      carrierEl.addEventListener('change', function() {
        var iid = SL.audio.getCurrentInstrument();
        if (SL.ringmod && SL.ringmod.setCarrierWave) SL.ringmod.setCarrierWave(iid, carrierEl.value);
      });
    }

    if (modWaveEl) {
      modWaveEl.value = rmSettings.modWave || 'sine';
      modWaveEl.addEventListener('change', function() {
        var iid = SL.audio.getCurrentInstrument();
        if (SL.ringmod && SL.ringmod.setModWave) SL.ringmod.setModWave(iid, modWaveEl.value);
      });
    }

    if (ratioEl) {
      ratioEl.addEventListener('input', function() {
        var val = parseFloat(ratioEl.value) / 10;
        if (ratioValEl) ratioValEl.textContent = val.toFixed(1) + 'x';
        var iid = SL.audio.getCurrentInstrument();
        if (SL.ringmod && SL.ringmod.setModRatio) SL.ringmod.setModRatio(iid, val);
      });
    }

    if (depthEl) {
      depthEl.addEventListener('input', function() {
        var val = parseInt(depthEl.value);
        if (depthValEl) depthValEl.textContent = val + '%';
        var iid = SL.audio.getCurrentInstrument();
        if (SL.ringmod && SL.ringmod.setModDepth) SL.ringmod.setModDepth(iid, val);
      });
    }

    _ringmodInitialized = true;
  }

  // ============================================================
  // Chord Controls
  // ============================================================

  var _chordInitialized = false;

  function initChordControls() {
    var container = document.getElementById('chordControlsModal');
    if (!container) {
      return;
    }

    var instId = SL.audio.getCurrentInstrument();
    var chSettings = (SL.chord && SL.chord.getSettings) ? SL.chord.getSettings(instId) : null;
    if (!chSettings) {
      chSettings = SL.audio._DEFAULT_INSTRUMENT_SETTINGS.chordSettings || {
        chordType: 'major', voicing: 'close', strum: 0, sourceWave: 'saw'
      };
    }

    if (_chordInitialized) {
      return;
    }

    var html = '';
    html += '<div class="chord-controls-grid">';
    html += '<div class="chord-param-group"><label>Chord Type</label>';
    html += '<select id="chordType">';
    html += '<option value="major">Major</option><option value="minor">Minor</option>';
    html += '<option value="dim">Dim</option><option value="aug">Aug</option>';
    html += '<option value="sus2">Sus2</option><option value="sus4">Sus4</option>';
    html += '<option value="dom7">Dom7</option><option value="maj7">Maj7</option>';
    html += '<option value="min7">Min7</option><option value="9th">9th</option>';
    html += '<option value="add9">Add9</option><option value="power">Power</option>';
    html += '</select></div>';
    html += '<div class="chord-param-group"><label>Voicing</label>';
    html += '<select id="chordVoicing">';
    html += '<option value="close">Close</option><option value="open">Open</option>';
    html += '<option value="drop2">Drop 2</option><option value="spread">Spread</option>';
    html += '</select></div>';
    html += '<div class="chord-param-group"><label>Source Wave</label>';
    html += '<select id="chordSourceWave">';
    html += '<option value="sine">Sine</option><option value="saw">Saw</option>';
    html += '<option value="square">Square</option><option value="triangle">Triangle</option>';
    html += '</select></div>';
    html += '<div class="chord-param-group"><label>Strum</label>';
    html += '<input type="range" aria-label="Chord Strum" id="chordStrum" min="0" max="100" value="' + (chSettings.strum || 0) + '">';
    html += '<div class="param-value" id="chordStrumVal">' + (chSettings.strum || 0) + ' ms</div></div>';
    html += '</div>';

    container.innerHTML = html;

    var typeEl = document.getElementById('chordType');
    var voicingEl = document.getElementById('chordVoicing');
    var waveEl = document.getElementById('chordSourceWave');
    var strumEl = document.getElementById('chordStrum');
    var strumValEl = document.getElementById('chordStrumVal');

    if (typeEl) {
      typeEl.value = chSettings.chordType || 'major';
      typeEl.addEventListener('change', function() {
        var iid = SL.audio.getCurrentInstrument();
        if (SL.chord && SL.chord.setChordType) SL.chord.setChordType(iid, typeEl.value);
      });
    }
    if (voicingEl) {
      voicingEl.value = chSettings.voicing || 'close';
      voicingEl.addEventListener('change', function() {
        var iid = SL.audio.getCurrentInstrument();
        if (SL.chord && SL.chord.setVoicing) SL.chord.setVoicing(iid, voicingEl.value);
      });
    }
    if (waveEl) {
      waveEl.value = chSettings.sourceWave || 'saw';
      waveEl.addEventListener('change', function() {
        var iid = SL.audio.getCurrentInstrument();
        if (SL.chord && SL.chord.setSourceWave) SL.chord.setSourceWave(iid, waveEl.value);
      });
    }
    if (strumEl) {
      strumEl.addEventListener('input', function() {
        var val = parseInt(strumEl.value);
        if (strumValEl) strumValEl.textContent = val + ' ms';
        var iid = SL.audio.getCurrentInstrument();
        if (SL.chord && SL.chord.setStrum) SL.chord.setStrum(iid, val);
      });
    }

    _chordInitialized = true;
  }

  // ============================================================
  // SuperWave Controls
  // ============================================================

  var _superwaveInitialized = false;

  function initSuperwaveControls() {
    var container = document.getElementById('superwaveControlsModal');
    if (!container) {
      return;
    }

    var instId = SL.audio.getCurrentInstrument();
    var swSettings = (SL.superwave && SL.superwave.getSettings) ? SL.superwave.getSettings(instId) : null;
    if (!swSettings) {
      swSettings = SL.audio._DEFAULT_INSTRUMENT_SETTINGS.superwaveSettings || {
        sourceWave: 'saw', voiceCount: 7, detuneSpread: 30, stereoSpread: 50, mixMode: 'equal'
      };
    }

    if (_superwaveInitialized) {
      return;
    }

    var html = '';
    html += '<div class="superwave-controls-grid">';
    html += '<div class="superwave-param-group"><label>Source Wave</label>';
    html += '<select id="superwaveSource">';
    html += '<option value="saw">Saw</option><option value="square">Square</option>';
    html += '<option value="triangle">Triangle</option><option value="pulse">Pulse</option>';
    html += '</select></div>';
    html += '<div class="superwave-param-group"><label>Voice Count</label>';
    html += '<select id="superwaveVoiceCount">';
    html += '<option value="2">2</option><option value="4">4</option>';
    html += '<option value="7">7</option><option value="8">8</option>';
    html += '<option value="12">12</option><option value="16">16</option>';
    html += '</select></div>';
    html += '<div class="superwave-param-group"><label>Detune Spread</label>';
    html += '<input type="range" aria-label="Superwave Detune" id="superwaveDetune" min="0" max="100" value="' + (swSettings.detuneSpread || 30) + '">';
    html += '<div class="param-value" id="superwaveDetuneVal">' + (swSettings.detuneSpread || 30) + ' cents</div></div>';
    html += '<div class="superwave-param-group"><label>Stereo Spread</label>';
    html += '<input type="range" aria-label="Superwave Stereo" id="superwaveStereo" min="0" max="100" value="' + (swSettings.stereoSpread || 50) + '">';
    html += '<div class="param-value" id="superwaveStereoVal">' + (swSettings.stereoSpread || 50) + '%</div></div>';
    html += '<div class="superwave-param-group"><label>Mix Mode</label>';
    html += '<select id="superwaveMixMode">';
    html += '<option value="equal">Equal</option>';
    html += '<option value="center-heavy">Center Heavy</option>';
    html += '<option value="edge-heavy">Edge Heavy</option>';
    html += '</select></div>';
    html += '</div>';

    container.innerHTML = html;

    var sourceEl = document.getElementById('superwaveSource');
    var vcountEl = document.getElementById('superwaveVoiceCount');
    var detuneEl = document.getElementById('superwaveDetune');
    var detuneValEl = document.getElementById('superwaveDetuneVal');
    var stereoEl = document.getElementById('superwaveStereo');
    var stereoValEl = document.getElementById('superwaveStereoVal');
    var mixModeEl = document.getElementById('superwaveMixMode');

    if (sourceEl) {
      sourceEl.value = swSettings.sourceWave || 'saw';
      sourceEl.addEventListener('change', function() {
        var iid = SL.audio.getCurrentInstrument();
        if (SL.superwave && SL.superwave.setSourceWave) SL.superwave.setSourceWave(iid, sourceEl.value);
      });
    }
    if (vcountEl) {
      vcountEl.value = String(swSettings.voiceCount || 7);
      vcountEl.addEventListener('change', function() {
        var iid = SL.audio.getCurrentInstrument();
        if (SL.superwave && SL.superwave.setVoiceCount) SL.superwave.setVoiceCount(iid, parseInt(vcountEl.value));
      });
    }
    if (detuneEl) {
      detuneEl.addEventListener('input', function() {
        var val = parseInt(detuneEl.value);
        if (detuneValEl) detuneValEl.textContent = val + ' cents';
        var iid = SL.audio.getCurrentInstrument();
        if (SL.superwave && SL.superwave.setDetuneSpread) SL.superwave.setDetuneSpread(iid, val);
      });
    }
    if (stereoEl) {
      stereoEl.addEventListener('input', function() {
        var val = parseInt(stereoEl.value);
        if (stereoValEl) stereoValEl.textContent = val + '%';
        var iid = SL.audio.getCurrentInstrument();
        if (SL.superwave && SL.superwave.setStereoSpread) SL.superwave.setStereoSpread(iid, val);
      });
    }
    if (mixModeEl) {
      mixModeEl.value = swSettings.mixMode || 'equal';
      mixModeEl.addEventListener('change', function() {
        var iid = SL.audio.getCurrentInstrument();
        if (SL.superwave && SL.superwave.setMixMode) SL.superwave.setMixMode(iid, mixModeEl.value);
      });
    }

    _superwaveInitialized = true;
  }

  var _wavetableInitialized = false;
  function initWavetableControls() {
    var container = document.getElementById('wavetableControlsModal');
    if (!container) {
      return;
    }

    var instId = SL.audio.getCurrentInstrument();
    var wtSettings = (SL.wavetableSynth && SL.wavetableSynth.getSettings) ? SL.wavetableSynth.getSettings(instId) : null;
    if (!wtSettings) {
      wtSettings = SL.audio._DEFAULT_INSTRUMENT_SETTINGS.wavetableSettings || {
        bank: 'basic', scanPosition: 0, lfoSpeed: 0.5, lfoDepth: 0, detune: 0
      };
    }

    if (_wavetableInitialized) {
      return;
    }

    var html = '';
    html += '<div class="wavetable-controls-grid">';
    html += '<div class="wavetable-param-group"><label>Bank</label>';
    html += '<select id="wavetableSynthBank">';
    html += '<option value="basic">Basic</option><option value="analog">Analog</option>';
    html += '<option value="digital">Digital</option><option value="vocal">Vocal</option>';
    html += '<option value="texture">Texture</option><option value="spectral">Spectral</option>';
    html += '</select></div>';
    html += '<div class="wavetable-param-group"><label>Scan Position</label>';
    html += '<input type="range" aria-label="Wavetable Synth Scan" id="wavetableSynthScan" min="0" max="100" value="' + (wtSettings.scanPosition || 0) + '">';
    html += '<div class="param-value" id="wavetableSynthScanVal">' + (wtSettings.scanPosition || 0) + '</div></div>';
    html += '<div class="wavetable-param-group"><label>LFO Speed</label>';
    html += '<input type="range" aria-label="Wavetable Synth Lfo Speed" id="wavetableSynthLfoSpeed" min="0" max="100" value="' + Math.round((wtSettings.lfoSpeed || 0.5) * 10) + '">';
    html += '<div class="param-value" id="wavetableSynthLfoSpeedVal">' + (wtSettings.lfoSpeed || 0.5) + ' Hz</div></div>';
    html += '<div class="wavetable-param-group"><label>LFO Depth</label>';
    html += '<input type="range" aria-label="Wavetable Synth Lfo Depth" id="wavetableSynthLfoDepth" min="0" max="100" value="' + (wtSettings.lfoDepth || 0) + '">';
    html += '<div class="param-value" id="wavetableSynthLfoDepthVal">' + (wtSettings.lfoDepth || 0) + '</div></div>';
    html += '<div class="wavetable-param-group"><label>Detune</label>';
    html += '<input type="range" aria-label="Wavetable Synth Detune" id="wavetableSynthDetune" min="-50" max="50" value="' + (wtSettings.detune || 0) + '">';
    html += '<div class="param-value" id="wavetableSynthDetuneVal">' + (wtSettings.detune || 0) + ' cents</div></div>';
    html += '</div>';

    container.innerHTML = html;

    var bankEl = document.getElementById('wavetableSynthBank');
    var scanEl = document.getElementById('wavetableSynthScan');
    var scanValEl = document.getElementById('wavetableSynthScanVal');
    var lfoSpeedEl = document.getElementById('wavetableSynthLfoSpeed');
    var lfoSpeedValEl = document.getElementById('wavetableSynthLfoSpeedVal');
    var lfoDepthEl = document.getElementById('wavetableSynthLfoDepth');
    var lfoDepthValEl = document.getElementById('wavetableSynthLfoDepthVal');
    var detuneEl = document.getElementById('wavetableSynthDetune');
    var detuneValEl = document.getElementById('wavetableSynthDetuneVal');

    if (bankEl) {
      bankEl.value = wtSettings.bank || 'basic';
      bankEl.addEventListener('change', function() {
        var iid = SL.audio.getCurrentInstrument();
        SL.audio.setWavetableSettings(iid, { bank: bankEl.value });
      });
    }
    if (scanEl) {
      scanEl.addEventListener('input', function() {
        var val = parseInt(scanEl.value);
        if (scanValEl) scanValEl.textContent = val;
        var iid = SL.audio.getCurrentInstrument();
        SL.audio.setWavetableSettings(iid, { scanPosition: val });
      });
    }
    if (lfoSpeedEl) {
      lfoSpeedEl.addEventListener('input', function() {
        var val = parseInt(lfoSpeedEl.value) / 10;
        if (lfoSpeedValEl) lfoSpeedValEl.textContent = val.toFixed(1) + ' Hz';
        var iid = SL.audio.getCurrentInstrument();
        SL.audio.setWavetableSettings(iid, { lfoSpeed: val });
      });
    }
    if (lfoDepthEl) {
      lfoDepthEl.addEventListener('input', function() {
        var val = parseInt(lfoDepthEl.value);
        if (lfoDepthValEl) lfoDepthValEl.textContent = val;
        var iid = SL.audio.getCurrentInstrument();
        SL.audio.setWavetableSettings(iid, { lfoDepth: val });
      });
    }
    if (detuneEl) {
      detuneEl.addEventListener('input', function() {
        var val = parseInt(detuneEl.value);
        if (detuneValEl) detuneValEl.textContent = val + ' cents';
        var iid = SL.audio.getCurrentInstrument();
        SL.audio.setWavetableSettings(iid, { detune: val });
      });
    }

    _wavetableInitialized = true;
  }

  var _phasedistInitialized = false;
  function initPhasedistControls() {
    var container = document.getElementById('phasedistControlsModal');
    if (!container) {
      return;
    }

    var instId = SL.audio.getCurrentInstrument();
    var pdSettings = (SL.phasedist && SL.phasedist.getSettings) ? SL.phasedist.getSettings(instId) : null;
    if (!pdSettings) {
      pdSettings = SL.audio._DEFAULT_INSTRUMENT_SETTINGS.phasedistSettings || {
        pdType: 'saw', pdAmount: 50, windowShape: 'cosine', resonantFreqRatio: 1.0,
        envAttack: 10, envDecay: 200, envSustain: 70, envRelease: 300
      };
    }

    if (_phasedistInitialized) {
      return;
    }

    var html = '';
    html += '<div class="phasedist-controls-grid">';
    html += '<div class="phasedist-param-group"><label>PD Type</label>';
    html += '<select id="phasedistType">';
    html += '<option value="saw">Saw</option><option value="square">Square</option>';
    html += '<option value="pulse">Pulse</option><option value="resonant">Resonant</option>';
    html += '<option value="doublesine">Double Sine</option>';
    html += '</select></div>';
    html += '<div class="phasedist-param-group"><label>PD Amount</label>';
    html += '<input type="range" aria-label="Phasedist Amount" id="phasedistAmount" min="0" max="100" value="' + (pdSettings.pdAmount || 50) + '">';
    html += '<div class="param-value" id="phasedistAmountVal">' + (pdSettings.pdAmount || 50) + '</div></div>';
    html += '<div class="phasedist-param-group"><label>Window Shape</label>';
    html += '<select id="phasedistWindow">';
    html += '<option value="cosine">Cosine</option><option value="hann">Hann</option>';
    html += '<option value="triangle">Triangle</option><option value="rectangular">Rectangular</option>';
    html += '</select></div>';
    html += '<div class="phasedist-param-group"><label>Resonant Freq Ratio</label>';
    html += '<input type="range" aria-label="Phasedist Resonant" id="phasedistResonant" min="1" max="16" step="0.1" value="' + (pdSettings.resonantFreqRatio || 1.0) + '">';
    html += '<div class="param-value" id="phasedistResonantVal">' + (pdSettings.resonantFreqRatio || 1.0) + '</div></div>';
    html += '<div class="phasedist-param-group"><label>PD Env Attack</label>';
    html += '<input type="range" aria-label="Phasedist Env A" id="phasedistEnvA" min="0" max="2000" value="' + (pdSettings.envAttack || 10) + '">';
    html += '<div class="param-value" id="phasedistEnvAVal">' + (pdSettings.envAttack || 10) + ' ms</div></div>';
    html += '<div class="phasedist-param-group"><label>PD Env Decay</label>';
    html += '<input type="range" aria-label="Phasedist Env D" id="phasedistEnvD" min="0" max="2000" value="' + (pdSettings.envDecay || 200) + '">';
    html += '<div class="param-value" id="phasedistEnvDVal">' + (pdSettings.envDecay || 200) + ' ms</div></div>';
    html += '<div class="phasedist-param-group"><label>PD Env Sustain</label>';
    html += '<input type="range" aria-label="Phasedist Env S" id="phasedistEnvS" min="0" max="100" value="' + (pdSettings.envSustain || 70) + '">';
    html += '<div class="param-value" id="phasedistEnvSVal">' + (pdSettings.envSustain || 70) + '</div></div>';
    html += '<div class="phasedist-param-group"><label>PD Env Release</label>';
    html += '<input type="range" aria-label="Phasedist Env R" id="phasedistEnvR" min="0" max="2000" value="' + (pdSettings.envRelease || 300) + '">';
    html += '<div class="param-value" id="phasedistEnvRVal">' + (pdSettings.envRelease || 300) + ' ms</div></div>';
    html += '</div>';

    container.innerHTML = html;

    var typeEl = document.getElementById('phasedistType');
    var amountEl = document.getElementById('phasedistAmount');
    var amountValEl = document.getElementById('phasedistAmountVal');
    var windowEl = document.getElementById('phasedistWindow');
    var resonantEl = document.getElementById('phasedistResonant');
    var resonantValEl = document.getElementById('phasedistResonantVal');
    var envAEl = document.getElementById('phasedistEnvA');
    var envAValEl = document.getElementById('phasedistEnvAVal');
    var envDEl = document.getElementById('phasedistEnvD');
    var envDValEl = document.getElementById('phasedistEnvDVal');
    var envSEl = document.getElementById('phasedistEnvS');
    var envSValEl = document.getElementById('phasedistEnvSVal');
    var envREl = document.getElementById('phasedistEnvR');
    var envRValEl = document.getElementById('phasedistEnvRVal');

    if (typeEl) {
      typeEl.value = pdSettings.pdType || 'saw';
      typeEl.addEventListener('change', function() {
        var iid = SL.audio.getCurrentInstrument();
        SL.audio.setPhasedistSettings(iid, { pdType: typeEl.value });
      });
    }
    if (amountEl) {
      amountEl.addEventListener('input', function() {
        var val = parseInt(amountEl.value);
        if (amountValEl) amountValEl.textContent = val;
        var iid = SL.audio.getCurrentInstrument();
        SL.audio.setPhasedistSettings(iid, { pdAmount: val });
      });
    }
    if (windowEl) {
      windowEl.value = pdSettings.windowShape || 'cosine';
      windowEl.addEventListener('change', function() {
        var iid = SL.audio.getCurrentInstrument();
        SL.audio.setPhasedistSettings(iid, { windowShape: windowEl.value });
      });
    }
    if (resonantEl) {
      resonantEl.addEventListener('input', function() {
        var val = parseFloat(resonantEl.value);
        if (resonantValEl) resonantValEl.textContent = val.toFixed(1);
        var iid = SL.audio.getCurrentInstrument();
        SL.audio.setPhasedistSettings(iid, { resonantFreqRatio: val });
      });
    }
    if (envAEl) {
      envAEl.addEventListener('input', function() {
        var val = parseInt(envAEl.value);
        if (envAValEl) envAValEl.textContent = val + ' ms';
        var iid = SL.audio.getCurrentInstrument();
        SL.audio.setPhasedistSettings(iid, { envAttack: val });
      });
    }
    if (envDEl) {
      envDEl.addEventListener('input', function() {
        var val = parseInt(envDEl.value);
        if (envDValEl) envDValEl.textContent = val + ' ms';
        var iid = SL.audio.getCurrentInstrument();
        SL.audio.setPhasedistSettings(iid, { envDecay: val });
      });
    }
    if (envSEl) {
      envSEl.addEventListener('input', function() {
        var val = parseInt(envSEl.value);
        if (envSValEl) envSValEl.textContent = val;
        var iid = SL.audio.getCurrentInstrument();
        SL.audio.setPhasedistSettings(iid, { envSustain: val });
      });
    }
    if (envREl) {
      envREl.addEventListener('input', function() {
        var val = parseInt(envREl.value);
        if (envRValEl) envRValEl.textContent = val + ' ms';
        var iid = SL.audio.getCurrentInstrument();
        SL.audio.setPhasedistSettings(iid, { envRelease: val });
      });
    }

    _phasedistInitialized = true;
  }

  var _chipInitialized = false;
  function initChipControls() {
    var container = document.getElementById('chipControlsModal');
    if (!container) {
      return;
    }

    var instId = SL.audio.getCurrentInstrument();
    var chipSettings = (SL.chip && SL.chip.getSettings) ? SL.chip.getSettings(instId) : null;
    if (!chipSettings) {
      chipSettings = SL.audio._DEFAULT_INSTRUMENT_SETTINGS.chipSettings || {
        chip: 'sid', waveform: 'pulse', dutyCycle: 50, bitDepth: 12,
        noiseMode: 'long', fmAlgorithm: 0, fmFeedback: 0
      };
    }

    if (_chipInitialized) {
      return;
    }

    var html = '';
    html += '<div class="chip-controls-grid">';
    html += '<div class="chip-param-group"><label>Chip</label>';
    html += '<select id="chipMode">';
    html += '<option value="sid">C64 SID</option>';
    html += '<option value="nes">NES 2A03</option>';
    html += '<option value="gameboy">Game Boy</option>';
    html += '<option value="genesis">Genesis YM2612</option>';
    html += '</select></div>';
    html += '<div class="chip-param-group"><label>Waveform</label>';
    html += '<select id="chipWaveform">';
    html += '<option value="pulse">Pulse</option>';
    html += '<option value="sawtooth">Sawtooth</option>';
    html += '<option value="triangle">Triangle</option>';
    html += '<option value="noise">Noise</option>';
    html += '<option value="wave">Wave (GB)</option>';
    html += '<option value="fm">FM (Genesis)</option>';
    html += '</select></div>';
    html += '<div class="chip-param-group"><label>Duty Cycle</label>';
    html += '<input type="range" aria-label="Chip Duty" id="chipDuty" min="0" max="100" value="' + (chipSettings.dutyCycle || 50) + '">';
    html += '<div class="param-value" id="chipDutyVal">' + (chipSettings.dutyCycle || 50) + '%</div></div>';
    html += '<div class="chip-param-group"><label>Bit Depth</label>';
    html += '<input type="range" aria-label="Chip Bit Depth" id="chipBitDepth" min="1" max="16" value="' + (chipSettings.bitDepth || 12) + '">';
    html += '<div class="param-value" id="chipBitDepthVal">' + (chipSettings.bitDepth || 12) + '-bit</div></div>';
    html += '<div class="chip-param-group"><label>Noise Mode</label>';
    html += '<select id="chipNoiseMode">';
    html += '<option value="long">Long (15-bit)</option>';
    html += '<option value="short">Short (7-bit)</option>';
    html += '</select></div>';
    html += '<div class="chip-param-group" id="chipFmAlgoGroup"><label>FM Algorithm</label>';
    html += '<input type="range" aria-label="Chip Fm Algo" id="chipFmAlgo" min="0" max="7" value="' + (chipSettings.fmAlgorithm || 0) + '">';
    html += '<div class="param-value" id="chipFmAlgoVal">Algo ' + (chipSettings.fmAlgorithm || 0) + '</div></div>';
    html += '<div class="chip-param-group" id="chipFmFbGroup"><label>FM Feedback</label>';
    html += '<input type="range" aria-label="Chip Fm Fb" id="chipFmFb" min="0" max="100" value="' + (chipSettings.fmFeedback || 0) + '">';
    html += '<div class="param-value" id="chipFmFbVal">' + (chipSettings.fmFeedback || 0) + '</div></div>';
    html += '</div>';

    container.innerHTML = html;

    var modeEl = document.getElementById('chipMode');
    var waveEl = document.getElementById('chipWaveform');
    var dutyEl = document.getElementById('chipDuty');
    var dutyValEl = document.getElementById('chipDutyVal');
    var bitDepthEl = document.getElementById('chipBitDepth');
    var bitDepthValEl = document.getElementById('chipBitDepthVal');
    var noiseModeEl = document.getElementById('chipNoiseMode');
    var fmAlgoEl = document.getElementById('chipFmAlgo');
    var fmAlgoValEl = document.getElementById('chipFmAlgoVal');
    var fmFbEl = document.getElementById('chipFmFb');
    var fmFbValEl = document.getElementById('chipFmFbVal');

    if (modeEl) {
      modeEl.value = chipSettings.chip || 'sid';
      modeEl.addEventListener('change', function() {
        var iid = SL.audio.getCurrentInstrument();
        SL.audio.setChipSettings(iid, { chip: modeEl.value });
        if (SL.chip && SL.chip.setChipMode) {
          SL.chip.setChipMode(iid, modeEl.value);
        }
      });
    }
    if (waveEl) {
      waveEl.value = chipSettings.waveform || 'pulse';
      waveEl.addEventListener('change', function() {
        var iid = SL.audio.getCurrentInstrument();
        SL.audio.setChipSettings(iid, { waveform: waveEl.value });
        if (SL.chip && SL.chip.setWaveform) {
          SL.chip.setWaveform(iid, waveEl.value);
        }
      });
    }
    if (dutyEl) {
      dutyEl.addEventListener('input', function() {
        var val = parseInt(dutyEl.value);
        if (dutyValEl) dutyValEl.textContent = val + '%';
        var iid = SL.audio.getCurrentInstrument();
        SL.audio.setChipSettings(iid, { dutyCycle: val });
        if (SL.chip && SL.chip.setDutyCycle) {
          SL.chip.setDutyCycle(iid, val);
        }
      });
    }
    if (bitDepthEl) {
      bitDepthEl.addEventListener('input', function() {
        var val = parseInt(bitDepthEl.value);
        if (bitDepthValEl) bitDepthValEl.textContent = val + '-bit';
        var iid = SL.audio.getCurrentInstrument();
        SL.audio.setChipSettings(iid, { bitDepth: val });
        if (SL.chip && SL.chip.setBitDepth) {
          SL.chip.setBitDepth(iid, val);
        }
      });
    }
    if (noiseModeEl) {
      noiseModeEl.value = chipSettings.noiseMode || 'long';
      noiseModeEl.addEventListener('change', function() {
        var iid = SL.audio.getCurrentInstrument();
        SL.audio.setChipSettings(iid, { noiseMode: noiseModeEl.value });
        if (SL.chip && SL.chip.setNoiseMode) {
          SL.chip.setNoiseMode(iid, noiseModeEl.value);
        }
      });
    }
    if (fmAlgoEl) {
      fmAlgoEl.addEventListener('input', function() {
        var val = parseInt(fmAlgoEl.value);
        if (fmAlgoValEl) fmAlgoValEl.textContent = 'Algo ' + val;
        var iid = SL.audio.getCurrentInstrument();
        SL.audio.setChipSettings(iid, { fmAlgorithm: val });
        if (SL.chip && SL.chip.setFmAlgorithm) {
          SL.chip.setFmAlgorithm(iid, val);
        }
      });
    }
    if (fmFbEl) {
      fmFbEl.addEventListener('input', function() {
        var val = parseInt(fmFbEl.value);
        if (fmFbValEl) fmFbValEl.textContent = val;
        var iid = SL.audio.getCurrentInstrument();
        SL.audio.setChipSettings(iid, { fmFeedback: val });
        if (SL.chip && SL.chip.setFmFeedback) {
          SL.chip.setFmFeedback(iid, val);
        }
      });
    }

    _chipInitialized = true;
  }

  SL.mixerModal = {
    setup: setupMixerModal,
    updateTypeToggleState: null,
    updatePhysicalParamVisibility: null,
    updateAdditiveVisibility: null,
    refreshModMatrixUI: null,
    syncTopFreezeButton: null
  };

  // ============================================================
  // Bytebeat Controls Init
  // ============================================================
  var _bytebeatInitialized = false;
  function initBytebeatControls() {
    var container = document.getElementById('bytebeatControlsModal');
    if (!container) {
      return;
    }

    var bbSettings = (SL.bytebeat && SL.bytebeat.getSettings) ? SL.bytebeat.getSettings() : null;
    if (!bbSettings) {
      bbSettings = SL.audio._DEFAULT_INSTRUMENT_SETTINGS.bytebeatSettings || {
        formula: 't*(t>>5|t>>8)', formulaIndex: 0, sampleRate: 8000,
        tIncrement: 1, bitDepth: 8, volume: 80
      };
    }

    var formulas = (SL.bytebeat && SL.bytebeat.getFormulas) ? SL.bytebeat.getFormulas() : [];

    var html = '<div class="bytebeat-controls">';
    html += '<div style="font-weight:bold;color:#0ff;margin-bottom:6px;">BYTEBEAT ENGINE</div>';

    // Formula selector
    html += '<div style="margin-bottom:6px;"><label style="color:#ccc;font-size:0.6rem;">Formula: </label>';
    html += '<select id="bytebeatFormulaSelect" style="background:#222;color:#0ff;border:1px solid #555;font-size:0.55rem;max-width:140px;">';
    for (var i = 0; i < formulas.length; i++) {
      var sel = (i === bbSettings.formulaIndex) ? ' selected' : '';
      html += '<option value="' + i + '"' + sel + '>' + formulas[i].name + '</option>';
    }
    html += '</select></div>';

    // Custom formula input
    html += '<div style="margin-bottom:6px;"><label style="color:#ccc;font-size:0.6rem;">Custom: </label>';
    html += '<input id="bytebeatCustomFormula" type="text" value="' + bbSettings.formula + '" style="background:#111;color:#0ff;border:1px solid #555;font-size:0.55rem;width:180px;" /></div>';

    // Sample rate slider
    html += '<div style="margin-bottom:4px;"><label style="color:#ccc;font-size:0.55rem;">Sample Rate: </label>';
    html += '<input id="bytebeatSampleRate" type="range" aria-label="Bytebeat Sample Rate" min="4000" max="48000" value="' + bbSettings.sampleRate + '" style="width:100px;vertical-align:middle;" />';
    html += '<span id="bytebeatSampleRateVal" style="color:#ccc;font-size:0.55rem;margin-left:4px;">' + bbSettings.sampleRate + '</span></div>';

    // T rate slider
    html += '<div style="margin-bottom:4px;"><label style="color:#ccc;font-size:0.55rem;">T Rate: </label>';
    html += '<input id="bytebeatTRate" type="range" aria-label="Bytebeat T Rate" min="1" max="16" value="' + bbSettings.tIncrement + '" style="width:80px;vertical-align:middle;" />';
    html += '<span id="bytebeatTRateVal" style="color:#ccc;font-size:0.55rem;margin-left:4px;">' + bbSettings.tIncrement + '</span></div>';

    // Bit depth toggle
    html += '<div style="margin-bottom:4px;"><label style="color:#ccc;font-size:0.55rem;">Bit Depth: </label>';
    html += '<button id="bytebeatBitDepth" class="mini-toggle" style="font-size:0.55rem;padding:2px 8px;background:' + (bbSettings.bitDepth === 16 ? '#0a5' : '#333') + ';color:#fff;border:1px solid #555;cursor:pointer;">' + bbSettings.bitDepth + '-bit</button></div>';

    html += '</div>';
    container.innerHTML = html;

    // Event handlers
    var formulaSel = document.getElementById('bytebeatFormulaSelect');
    if (formulaSel) {
      formulaSel.addEventListener('change', function() {
        var idx = parseInt(formulaSel.value);
        if (SL.bytebeat && SL.bytebeat.setFormulaByIndex) {
          SL.bytebeat.setFormulaByIndex(idx);
        }
        var customInput = document.getElementById('bytebeatCustomFormula');
        if (customInput && formulas[idx]) {
          customInput.value = formulas[idx].expr;
        }
      });
    }

    var customInput = document.getElementById('bytebeatCustomFormula');
    if (customInput) {
      customInput.addEventListener('change', function() {
        if (SL.bytebeat && SL.bytebeat.setFormula) {
          SL.bytebeat.setFormula(customInput.value);
        }
      });
    }

    var srSlider = document.getElementById('bytebeatSampleRate');
    var srVal = document.getElementById('bytebeatSampleRateVal');
    if (srSlider) {
      srSlider.addEventListener('input', function() {
        if (srVal) srVal.textContent = srSlider.value;
        if (SL.bytebeat && SL.bytebeat.setSampleRate) {
          SL.bytebeat.setSampleRate(parseInt(srSlider.value));
        }
      });
    }

    var trSlider = document.getElementById('bytebeatTRate');
    var trVal = document.getElementById('bytebeatTRateVal');
    if (trSlider) {
      trSlider.addEventListener('input', function() {
        if (trVal) trVal.textContent = trSlider.value;
        if (SL.bytebeat && SL.bytebeat.setTIncrement) {
          SL.bytebeat.setTIncrement(parseInt(trSlider.value));
        }
      });
    }

    var bdBtn = document.getElementById('bytebeatBitDepth');
    if (bdBtn) {
      bdBtn.addEventListener('click', function() {
        var current = parseInt(bdBtn.textContent);
        var next = (current === 8) ? 16 : 8;
        bdBtn.textContent = next + '-bit';
        bdBtn.style.background = (next === 16) ? '#0a5' : '#333';
        if (SL.bytebeat && SL.bytebeat.setBitDepth) {
          SL.bytebeat.setBitDepth(next);
        }
      });
    }

    _bytebeatInitialized = true;
  }

  // ============================================================
  // Vector Controls Init
  // ============================================================
  var _vectorInitialized = false;
  function initVectorControls() {
    var container = document.getElementById('vectorControlsModal');
    if (!container) {
      return;
    }

    var instId = SL.audio.getCurrentInstrument();
    var vecSettings = (SL.vector && SL.vector.getSettings) ? SL.vector.getSettings(instId) : null;
    if (!vecSettings) {
      vecSettings = SL.audio._DEFAULT_INSTRUMENT_SETTINGS.vectorSettings || {
        sources: [
          { waveform: 'saw', detune: 0 },
          { waveform: 'square', detune: 0 },
          { waveform: 'triangle', detune: 0 },
          { waveform: 'sine', detune: 0 }
        ],
        vectorX: 50, vectorY: 50,
        vectorEnvelope: { enabled: false, loop: false, points: [] }
      };
    }

    var waveOptions = ['sine', 'saw', 'square', 'triangle', 'pulse', 'noise'];

    var html = '<div class="vector-controls">';
    html += '<div style="font-weight:bold;color:#f0a;margin-bottom:6px;">VECTOR ENGINE</div>';

    // X/Y sliders
    html += '<div style="margin-bottom:4px;"><label style="color:#ccc;font-size:0.55rem;">Vector X: </label>';
    html += '<input id="vectorXSlider" type="range" aria-label="Vector X Slider" min="0" max="100" value="' + vecSettings.vectorX + '" style="width:100px;vertical-align:middle;" />';
    html += '<span id="vectorXVal" style="color:#ccc;font-size:0.55rem;margin-left:4px;">' + vecSettings.vectorX + '</span></div>';

    html += '<div style="margin-bottom:6px;"><label style="color:#ccc;font-size:0.55rem;">Vector Y: </label>';
    html += '<input id="vectorYSlider" type="range" aria-label="Vector Y Slider" min="0" max="100" value="' + vecSettings.vectorY + '" style="width:100px;vertical-align:middle;" />';
    html += '<span id="vectorYVal" style="color:#ccc;font-size:0.55rem;margin-left:4px;">' + vecSettings.vectorY + '</span></div>';

    // 4 source waveform selectors + detune
    for (var si = 0; si < 4; si++) {
      var s = vecSettings.sources[si] || { waveform: 'sine', detune: 0 };
      html += '<div style="margin-bottom:4px;"><label style="color:#ccc;font-size:0.55rem;">Src ' + (si + 1) + ': </label>';
      html += '<select id="vectorSrc' + si + 'Wave" style="background:#222;color:#f0a;border:1px solid #555;font-size:0.55rem;">';
      for (var wi = 0; wi < waveOptions.length; wi++) {
        var wsel = (waveOptions[wi] === s.waveform) ? ' selected' : '';
        html += '<option value="' + waveOptions[wi] + '"' + wsel + '>' + waveOptions[wi] + '</option>';
      }
      html += '</select>';
      html += ' <label style="color:#ccc;font-size:0.55rem;">Det:</label>';
      html += '<input id="vectorSrc' + si + 'Detune" type="range" aria-label="Vector Src' + si + 'Detune" min="-50" max="50" value="' + s.detune + '" style="width:60px;vertical-align:middle;" />';
      html += '<span id="vectorSrc' + si + 'DetuneVal" style="color:#ccc;font-size:0.55rem;margin-left:2px;">' + s.detune + '</span></div>';
    }

    // Vector envelope toggle + speed
    var envEnabled = vecSettings.vectorEnvelope && vecSettings.vectorEnvelope.enabled;
    html += '<div style="margin-bottom:4px;"><label style="color:#ccc;font-size:0.55rem;">Vec Envelope: </label>';
    html += '<button id="vectorEnvToggle" class="mini-toggle" style="font-size:0.55rem;padding:2px 8px;background:' + (envEnabled ? '#0a5' : '#333') + ';color:#fff;border:1px solid #555;cursor:pointer;">' + (envEnabled ? 'ON' : 'OFF') + '</button></div>';

    html += '</div>';
    container.innerHTML = html;

    // Event handlers
    var xSlider = document.getElementById('vectorXSlider');
    var xVal = document.getElementById('vectorXVal');
    if (xSlider) {
      xSlider.addEventListener('input', function() {
        if (xVal) xVal.textContent = xSlider.value;
        if (SL.vector && SL.vector.setVectorX) {
          SL.vector.setVectorX(parseInt(xSlider.value));
        }
      });
    }

    var ySlider = document.getElementById('vectorYSlider');
    var yVal = document.getElementById('vectorYVal');
    if (ySlider) {
      ySlider.addEventListener('input', function() {
        if (yVal) yVal.textContent = ySlider.value;
        if (SL.vector && SL.vector.setVectorY) {
          SL.vector.setVectorY(parseInt(ySlider.value));
        }
      });
    }

    for (var si2 = 0; si2 < 4; si2++) {
      (function(idx) {
        var waveSel = document.getElementById('vectorSrc' + idx + 'Wave');
        var detSlider = document.getElementById('vectorSrc' + idx + 'Detune');
        var detVal = document.getElementById('vectorSrc' + idx + 'DetuneVal');
        if (waveSel) {
          waveSel.addEventListener('change', function() {
            if (SL.vector && SL.vector.setSourceWaveform) {
              SL.vector.setSourceWaveform(idx, waveSel.value);
            }
          });
        }
        if (detSlider) {
          detSlider.addEventListener('input', function() {
            if (detVal) detVal.textContent = detSlider.value;
            if (SL.vector && SL.vector.setSourceDetune) {
              SL.vector.setSourceDetune(idx, parseInt(detSlider.value));
            }
          });
        }
      })(si2);
    }

    var envToggle = document.getElementById('vectorEnvToggle');
    if (envToggle) {
      envToggle.addEventListener('click', function() {
        var isOn = envToggle.classList.contains('active');
        envToggle.textContent = '';
        if (isOn) {
          envToggle.classList.remove('active');
        } else {
          envToggle.classList.add('active');
        }
        envToggle.style.background = isOn ? '#333' : '#0a5';
        if (SL.vector && SL.vector.setEnvelopeEnabled) {
          SL.vector.setEnvelopeEnabled(!isOn);
        }
      });
    }

    _vectorInitialized = true;
  }

  // ============================================================
  // Drum Synth Controls
  // ============================================================

  var _drumsynInitialized = false;

  function initDrumsynControls() {
    var container = document.getElementById('drumsynControlsModal');
    if (!container) {
      return;
    }

    var instId = SL.audio.getCurrentInstrument();
    var dsSettings = (SL.drumsyn && SL.drumsyn.getSettings) ? SL.drumsyn.getSettings(instId) : null;
    if (!dsSettings) {
      dsSettings = SL.audio._DEFAULT_INSTRUMENT_SETTINGS.drumsynSettings || {
        drumType: 'kick', pitch: 50, decay: 50, tone: 50, bodyNoiseMix: 70, drive: 20
      };
    }

    var drumTypes = ['kick', 'snare', 'hihat', 'clap', 'tom', 'rim', 'cowbell', 'cymbal'];

    var html = '<div class="drumsyn-controls">';
    html += '<div style="font-weight:bold;color:#FF6633;margin-bottom:6px;">DRUM SYNTH ENGINE</div>';

    // Drum type selector
    html += '<div style="margin-bottom:4px;"><label style="color:#ccc;font-size:0.55rem;">Drum Type: </label>';
    html += '<select id="drumsynType" style="background:#222;color:#FF6633;border:1px solid #555;font-size:0.55rem;">';
    for (var di = 0; di < drumTypes.length; di++) {
      var dsel = (drumTypes[di] === dsSettings.drumType) ? ' selected' : '';
      html += '<option value="' + drumTypes[di] + '"' + dsel + '>' + drumTypes[di] + '</option>';
    }
    html += '</select></div>';

    // Sliders: pitch, decay, tone, bodyNoiseMix, drive
    var params = [
      { id: 'drumsynPitch', label: 'Pitch', min: 0, max: 100, val: dsSettings.pitch },
      { id: 'drumsynDecay', label: 'Decay', min: 0, max: 100, val: dsSettings.decay },
      { id: 'drumsynTone', label: 'Tone', min: 0, max: 100, val: dsSettings.tone },
      { id: 'drumsynMix', label: 'Body/Noise', min: 0, max: 100, val: dsSettings.bodyNoiseMix },
      { id: 'drumsynDrive', label: 'Drive', min: 0, max: 100, val: dsSettings.drive }
    ];

    for (var pi = 0; pi < params.length; pi++) {
      var p = params[pi];
      html += '<div style="margin-bottom:4px;"><label style="color:#ccc;font-size:0.55rem;">' + p.label + ': </label>';
      html += '<input id="' + p.id + '" type="range" aria-label="' + p.id + '" min="' + p.min + '" max="' + p.max + '" value="' + p.val + '" style="width:100px;vertical-align:middle;" />';
      html += '<span id="' + p.id + 'Val" style="color:#ccc;font-size:0.55rem;margin-left:4px;">' + p.val + '</span></div>';
    }

    html += '</div>';
    container.innerHTML = html;

    // Event handlers
    var typeSelect = document.getElementById('drumsynType');
    if (typeSelect) {
      typeSelect.addEventListener('change', function() {
        if (SL.drumsyn && SL.drumsyn.setDrumType) {
          SL.drumsyn.setDrumType(SL.audio.getCurrentInstrument(), typeSelect.value);
        }
      });
    }

    for (var si = 0; si < params.length; si++) {
      (function(param) {
        var slider = document.getElementById(param.id);
        var valSpan = document.getElementById(param.id + 'Val');
        if (slider) {
          slider.addEventListener('input', function() {
            if (valSpan) valSpan.textContent = slider.value;
            var iid = SL.audio.getCurrentInstrument();
            if (SL.drumsyn && SL.drumsyn.setSettings) {
              var update = {};
              if (param.id === 'drumsynPitch') update.pitch = parseInt(slider.value);
              if (param.id === 'drumsynDecay') update.decay = parseInt(slider.value);
              if (param.id === 'drumsynTone') update.tone = parseInt(slider.value);
              if (param.id === 'drumsynMix') update.bodyNoiseMix = parseInt(slider.value);
              if (param.id === 'drumsynDrive') update.drive = parseInt(slider.value);
              var cur = SL.drumsyn.getSettings(iid);
              for (var k in update) { cur[k] = update[k]; }
              SL.drumsyn.setSettings(iid, cur);
            }
          });
        }
      })(params[si]);
    }

    _drumsynInitialized = true;
  }

  // ============================================================
  // Pulsar Controls
  // ============================================================

  var _pulsarInitialized = false;

  function initPulsarControls() {
    var container = document.getElementById('pulsarControlsModal');
    if (!container) {
      return;
    }

    var instId = SL.audio.getCurrentInstrument();
    var plsSettings = (SL.pulsar && SL.pulsar.getSettings) ? SL.pulsar.getSettings(instId) : null;
    if (!plsSettings) {
      plsSettings = SL.audio._DEFAULT_INSTRUMENT_SETTINGS.pulsarSettings || {
        pulsaretWaveform: 'sine', pulseRate: 100, dutyCycle: 50, pulsaretEnvelope: 'gaussian', formantFreq: 1000, masking: 0
      };
    }

    var waveOptions = ['sine', 'saw', 'square', 'triangle'];
    var envOptions = ['gaussian', 'hann', 'triangle', 'rectangle'];

    var html = '<div class="pulsar-controls">';
    html += '<div style="font-weight:bold;color:#3388FF;margin-bottom:6px;">PULSAR ENGINE</div>';

    // Waveform selector
    html += '<div style="margin-bottom:4px;"><label style="color:#ccc;font-size:0.55rem;">Pulsaret Wave: </label>';
    html += '<select id="pulsarWaveform" style="background:#222;color:#3388FF;border:1px solid #555;font-size:0.55rem;">';
    for (var wi = 0; wi < waveOptions.length; wi++) {
      var wsel = (waveOptions[wi] === plsSettings.pulsaretWaveform) ? ' selected' : '';
      html += '<option value="' + waveOptions[wi] + '"' + wsel + '>' + waveOptions[wi] + '</option>';
    }
    html += '</select></div>';

    // Envelope selector
    html += '<div style="margin-bottom:4px;"><label style="color:#ccc;font-size:0.55rem;">Envelope: </label>';
    html += '<select id="pulsarEnvelope" style="background:#222;color:#3388FF;border:1px solid #555;font-size:0.55rem;">';
    for (var ei = 0; ei < envOptions.length; ei++) {
      var esel = (envOptions[ei] === plsSettings.pulsaretEnvelope) ? ' selected' : '';
      html += '<option value="' + envOptions[ei] + '"' + esel + '>' + envOptions[ei] + '</option>';
    }
    html += '</select></div>';

    // Sliders: rate, dutyCycle, formantFreq, masking
    var params = [
      { id: 'pulsarRate', label: 'Rate (Hz)', min: 1, max: 500, val: plsSettings.pulseRate },
      { id: 'pulsarDuty', label: 'Duty %', min: 1, max: 100, val: plsSettings.dutyCycle },
      { id: 'pulsarFormant', label: 'Formant Hz', min: 50, max: 5000, val: plsSettings.formantFreq },
      { id: 'pulsarMasking', label: 'Masking %', min: 0, max: 100, val: plsSettings.masking }
    ];

    for (var pi = 0; pi < params.length; pi++) {
      var p = params[pi];
      html += '<div style="margin-bottom:4px;"><label style="color:#ccc;font-size:0.55rem;">' + p.label + ': </label>';
      html += '<input id="' + p.id + '" type="range" aria-label="' + p.id + '" min="' + p.min + '" max="' + p.max + '" value="' + p.val + '" style="width:100px;vertical-align:middle;" />';
      html += '<span id="' + p.id + 'Val" style="color:#ccc;font-size:0.55rem;margin-left:4px;">' + p.val + '</span></div>';
    }

    html += '</div>';
    container.innerHTML = html;

    // Event handlers
    var waveSelect = document.getElementById('pulsarWaveform');
    if (waveSelect) {
      waveSelect.addEventListener('change', function() {
        var iid = SL.audio.getCurrentInstrument();
        if (SL.pulsar && SL.pulsar.setSettings) {
          var cur = SL.pulsar.getSettings(iid);
          cur.pulsaretWaveform = waveSelect.value;
          SL.pulsar.setSettings(iid, cur);
        }
      });
    }

    var envSelect = document.getElementById('pulsarEnvelope');
    if (envSelect) {
      envSelect.addEventListener('change', function() {
        var iid = SL.audio.getCurrentInstrument();
        if (SL.pulsar && SL.pulsar.setSettings) {
          var cur = SL.pulsar.getSettings(iid);
          cur.pulsaretEnvelope = envSelect.value;
          SL.pulsar.setSettings(iid, cur);
        }
      });
    }

    for (var si = 0; si < params.length; si++) {
      (function(param) {
        var slider = document.getElementById(param.id);
        var valSpan = document.getElementById(param.id + 'Val');
        if (slider) {
          slider.addEventListener('input', function() {
            if (valSpan) valSpan.textContent = slider.value;
            var iid = SL.audio.getCurrentInstrument();
            if (SL.pulsar && SL.pulsar.setSettings) {
              var cur = SL.pulsar.getSettings(iid);
              if (param.id === 'pulsarRate') cur.pulseRate = parseInt(slider.value);
              if (param.id === 'pulsarDuty') cur.dutyCycle = parseInt(slider.value);
              if (param.id === 'pulsarFormant') cur.formantFreq = parseInt(slider.value);
              if (param.id === 'pulsarMasking') cur.masking = parseInt(slider.value);
              SL.pulsar.setSettings(iid, cur);
            }
          });
        }
      })(params[si]);
    }

    _pulsarInitialized = true;
  }

})();
