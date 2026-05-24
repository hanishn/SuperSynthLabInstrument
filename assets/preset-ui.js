// Synth Lab - Preset Selector UI Module
// Extracted from ui-state.js - preset category/list/apply logic
(function() {
  'use strict';
  var SL = window.SynthLab;

  // ============================================================
  // Preset Selector Logic
  // ============================================================
  var lastPresetList = []; // Cache of last getPresetsByCategory result

  function populatePresetCategories() {
    var presetRow = document.getElementById('presetSelectorRow');
    var categorySel = document.getElementById('presetCategory');
    var presetSel = document.getElementById('presetSelect');
    if (!presetRow || !categorySel || !presetSel) return;

    var instType = SL.audio.getInstrumentType
      ? SL.audio.getInstrumentType(SL.audio.getCurrentInstrument())
      : 'subtractive';

    if (instType === 'sampler') {
      presetRow.style.display = 'none';
      return;
    }

    presetRow.style.display = '';

    // Get categories for this instrument type
    var categories = SL.presets && SL.presets.getCategories
      ? SL.presets.getCategories(instType)
      : [];

    categorySel.innerHTML = '<option value="">' + SL.t('ui.placeholder.category', '-- Category --') + '</option>';
    categories.forEach(function(cat) {
      var opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      categorySel.appendChild(opt);
    });

    // Reset preset list
    presetSel.innerHTML = '<option value="">' + SL.t('ui.placeholder.preset', '-- Select Preset --') + '</option>';
    lastPresetList = [];
  }

  function populatePresetList(category) {
    var presetSel = document.getElementById('presetSelect');
    if (!presetSel) return;

    var instType = SL.audio.getInstrumentType
      ? SL.audio.getInstrumentType(SL.audio.getCurrentInstrument())
      : 'subtractive';

    lastPresetList = SL.presets && SL.presets.getPresetsByCategory
      ? SL.presets.getPresetsByCategory(instType, category)
      : [];

    presetSel.innerHTML = '<option value="">' + SL.t('ui.placeholder.preset', '-- Select Preset --') + '</option>';
    lastPresetList.forEach(function(preset, idx) {
      var opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = preset.name;
      presetSel.appendChild(opt);
    });
  }

  function setupPresetSelector() {
    var categorySel = document.getElementById('presetCategory');
    var presetApplyBtn = document.getElementById('presetApplyBtn');
    var presetSel = document.getElementById('presetSelect');

    if (categorySel) {
      categorySel.addEventListener('change', function() {
        var cat = categorySel.value;
        if (cat) {
          populatePresetList(cat);
        } else {
          if (presetSel) presetSel.innerHTML = '<option value="">' + SL.t('ui.placeholder.preset', '-- Select Preset --') + '</option>';
          lastPresetList = [];
        }
      });
    }

    if (presetApplyBtn) {
      presetApplyBtn.addEventListener('click', function() {
        if (!presetSel || presetSel.value === '') return;
        var idx = parseInt(presetSel.value);
        var preset = lastPresetList[idx];
        if (!preset) return;

        var instIndex = SL.audio.getCurrentInstrument();
        var instType = SL.audio.getInstrumentType
          ? SL.audio.getInstrumentType(instIndex)
          : 'subtractive';

        if (instType === 'subtractive' && SL.presets.applySubtractivePreset) {
          SL.presets.applySubtractivePreset(preset, instIndex);
        } else if (instType === 'fm' && SL.presets.applyFMPreset) {
          SL.presets.applyFMPreset(preset, instIndex);
        } else if (instType === 'physical' && SL.presets.applyPhysicalPreset) {
          SL.presets.applyPhysicalPreset(preset, instIndex);
        } else if (instType === 'additive' && SL.presets.applyAdditivePreset) {
          SL.presets.applyAdditivePreset(preset, instIndex);
        } else if (instType === 'granular' && SL.presets.applyGranularPreset) {
          SL.presets.applyGranularPreset(preset, instIndex);
        } else if (instType === 'vocoderSynth' && SL.presets.applyVocoderPreset) {
          SL.presets.applyVocoderPreset(preset, instIndex);
        } else if (instType === 'wavefolder' && SL.presets.applyWavefoldPreset) {
          SL.presets.applyWavefoldPreset(preset, instIndex);
        } else if (instType === 'formant' && SL.presets.applyFormantPreset) {
          SL.presets.applyFormantPreset(preset, instIndex);
        } else if (instType === 'modal' && SL.presets.applyModalPreset) {
          SL.presets.applyModalPreset(preset, instIndex);
        } else if (instType === 'ringmod' && SL.presets.applyRingmodPreset) {
          SL.presets.applyRingmodPreset(preset, instIndex);
        } else if (instType === 'chord' && SL.presets.applyChordPreset) {
          SL.presets.applyChordPreset(preset, instIndex);
        } else if (instType === 'superwave' && SL.presets.applySuperwavePreset) {
          SL.presets.applySuperwavePreset(preset, instIndex);
        } else if (instType === 'wavetable' && SL.presets.applyWavetableSynthPreset) {
          SL.presets.applyWavetableSynthPreset(preset, instIndex);
        } else if (instType === 'phasedist' && SL.presets.applyPhasedistPreset) {
          SL.presets.applyPhasedistPreset(preset, instIndex);
        } else if (instType === 'chip' && SL.presets.applyChipPreset) {
          SL.presets.applyChipPreset(preset, instIndex);
        } else if (instType === 'bytebeat' && SL.presets.applyBytebeatPreset) {
          SL.presets.applyBytebeatPreset(preset, instIndex);
        } else if (instType === 'vector' && SL.presets.applyVectorPreset) {
          SL.presets.applyVectorPreset(preset, instIndex);
        } else if (instType === 'drumsyn' && SL.presets.applyDrumsynPreset) {
          SL.presets.applyDrumsynPreset(preset, instIndex);
        } else if (instType === 'pulsar' && SL.presets.applyPulsarPreset) {
          SL.presets.applyPulsarPreset(preset, instIndex);
        } else if (instType === 'reed' && SL.presets.applyReedPreset) {
          SL.presets.applyReedPreset(preset, instIndex);
        }

      });
    }

    // Re-render placeholder text when language changes
    SL.localization.onLanguageChange(function() {
      populatePresetCategories();
    });
  }

  // Export to SynthLab namespace
  SL.presetUI = {
    setup: setupPresetSelector,
    populateCategories: populatePresetCategories
  };
})();
