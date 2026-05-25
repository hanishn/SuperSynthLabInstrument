// SSLI Screen: Effects — Effects chain with drag-drop reorder and parameter modal
// ES5 compatible (var, no arrow functions, no template literals)

(function() {
  'use strict';

  var SL = window.SynthLab;

  // ============================================================
  // Constants
  // ============================================================

  /* A-16: Reduced to 300 — chain list has touch-action:none so scroll conflict is not an issue */
  var LONG_PRESS_MS = 300;
  var DRAG_ELEVATION_PX = 4;
  var MAX_MASTER_MIX = 100;
  var MODAL_BACKDROP_OPACITY = 0.85;

  function _emptyOptions() {
    return [];
  }

  // ============================================================
  // FX Preset Library — Category + Preset system
  // ============================================================

  // FX Preset Library loaded from data manifest (fx-presets.json)
  var _fxData = (SL._data && SL._data.fxPresets) ? SL._data.fxPresets : { categories: [], library: {} };
  var FX_PRESET_CATEGORIES = _fxData.categories;
  var FX_PRESET_LIBRARY = _fxData.library;

  // Expose globally for Sound screen sync
  SL.fxPresetLib = {
    categories: FX_PRESET_CATEGORIES,
    library: FX_PRESET_LIBRARY
  };

  var _FX_CAT_KEY = {
    'Clean / Natural': 'clean_natural',
    'Ambient / Atmospheric': 'ambient_atmospheric',
    'Vintage / Warm': 'vintage_warm',
    'Aggressive / Distorted': 'aggressive_distorted',
    'Rhythmic / Movement': 'rhythmic_movement',
    'Creative / Experimental': 'creative_experimental',
    'Performance / Live': 'performance_live'
  };
  var _FX_PRESET_KEY = {
    'Dry': 'dry', 'Gentle Warmth': 'gentle_warmth', 'Studio Polish': 'studio_polish',
    'Clean Shimmer': 'clean_shimmer', 'Deep Space': 'deep_space', 'Cathedral': 'cathedral',
    'Ethereal Pad': 'ethereal_pad', 'Frozen': 'frozen', 'Underwater': 'underwater',
    'Misty': 'misty', 'Warm Tape': 'warm_tape', 'Vinyl': 'vinyl',
    '70s Electric Piano': '70s_electric_piano', 'Cassette Deck': 'cassette_deck',
    'Retro Synth': 'retro_synth', 'Crunch': 'crunch', 'Fuzz Box': 'fuzz_box',
    'Bitcrushed': 'bitcrushed', 'Industrial': 'industrial', 'Acid Squelch': 'acid_squelch',
    'Tremolo Pulse': 'tremolo_pulse', 'Auto-Pan': 'auto_pan',
    'Sidechain Pump': 'sidechain_pump', 'Gated Verb': 'gated_verb',
    'Choppy Delay': 'choppy_delay', 'Ring Modulated': 'ring_modulated',
    'Pitch Shift Up': 'pitch_shift_up', 'Detuned': 'detuned', 'Vocoded': 'vocoded',
    'Glitch': 'glitch', 'Stage Keys': 'stage_keys', 'Lead Solo': 'lead_solo',
    'Big Pad': 'big_pad', 'Thick Bass': 'thick_bass', 'Pluck': 'pluck'
  };

  // Category grouping for effects
  var CATEGORY_MAP = {
    distortion: 'Distortion',
    softClip:   'Distortion',
    tape:       'Distortion',
    bitcrush:   'Distortion',
    lofi:       'Distortion',
    chorus:     'Modulation',
    flanger:    'Modulation',
    phaser:     'Modulation',
    tremolo:    'Modulation',
    ringMod:    'Modulation',
    dimension:  'Modulation',
    pitchShift: 'Modulation',
    delay:      'Space',
    reverb:     'Space',
    gatedReverb:'Space',
    widener:    'Space',
    filter:     'Modulation',
    compressor: 'Dynamics',
    gate:       'Dynamics',
    pump:       'Dynamics',
    eq:         'Dynamics',
    vocoder:    'Modulation'
  };

  var CATEGORY_ORDER = ['Distortion', 'Modulation', 'Space', 'Dynamics'];

  // ============================================================
  // State
  // ============================================================

  var isScreenInitialized = false;
  var isScreenActive = false;
  var _screenEl = null;
  var _chainListEl = null;
  var _masterMixSlider = null;
  var _masterMixVal = null;
  var _activeFxCategory = FX_PRESET_CATEGORIES[0];
  var _activeFxPresetId = 'dry';
  var _fxCategorySelect = null;
  var _fxPresetSelect = null;

  // Drag state
  var _dragState = null;
  var _longPressTimer = null;
  var isDragRafPending = false;

  // Modal state
  var _modalEl = null;
  var isModalOpen = false;

  // ============================================================
  // Helpers
  // ============================================================

  // Map internal effectId -> en.json key under "effect.*"
  var _EFFECT_I18N_KEY = {
    distortion: 'distortion', chorus: 'chorus', delay: 'delay', reverb: 'reverb',
    bitcrush: 'bitcrush', phaser: 'phaser', flanger: 'flanger', tremolo: 'tremolo',
    filter: 'autowah', compressor: 'compressor', eq: 'eq', tape: 'tape',
    widener: 'widener', lofi: 'lofi', hueShifter: 'hueshifter', driftscape: 'driftscape',
    halo: 'halo', grainfield: 'grainfield', stutterstep: 'stutterstep',
    spectralHold: 'spectralhold', gatedReverb: 'gatedreverb', dimension: 'dimension',
    ringMod: 'ringmod', pump: 'pump', softClip: 'softclip', pitchShift: 'pitchshift',
    gate: 'gate', vocoder: 'vocoder_fx'
  };

  // Map select option values to i18n keys for display labels
  var _SELECT_OPTION_I18N = {
    soft: 'distortion_type.soft', hard: 'distortion_type.hard', fuzz: 'distortion_type.fuzz',
    tube: 'distortion_type.tube', wavefold: 'distortion_type.wavefold',
    bitcrush: 'distortion_type.bitcrush', tape: 'distortion_type.tape',
    digital: 'delay_type.digital', analog: 'delay_type.analog',
    pingpong: 'delay_type.pingpong', multitap: 'delay_type.multitap',
    ducking: 'delay_type.ducking',
    convolution: 'reverb_type.convolution', room: 'reverb_type.room',
    plate: 'reverb_type.plate', hall: 'reverb_type.hall',
    spring: 'reverb_type.spring', shimmer: 'reverb_type.shimmer',
    lowpass: 'filter_type.lowpass', highpass: 'filter_type.highpass',
    bandpass: 'filter_type.bandpass',
    rhythmic: 'delay_pattern.rhythmic', golden: 'delay_pattern.golden',
    fibonacci: 'delay_pattern.fibonacci', custom: 'delay_pattern.custom'
  };

  function _optionDisplayLabel(optValue) {
    var key = _SELECT_OPTION_I18N[optValue];
    if (key) {
      var translated = SL.t(key);
      if (translated) { return translated; }
    }
    return optValue;
  }

  function _effectDisplayName(effectName, effectMeta) {
    var key = _EFFECT_I18N_KEY[effectName];
    if (key) {
      var translated = SL.t('effect.' + key);
      if (translated) { return translated; }
    }
    return (effectMeta && effectMeta.name) ? effectMeta.name : effectName;
  }

  function _getEffectMeta() {
    if (SL.effectsUI && SL.effectsUI.EFFECT_META) {
      return SL.effectsUI.EFFECT_META;
    }
    return {};
  }

  function _getChainOrder() {
    if (SL.effectsUI && SL.effectsUI.DEFAULT_CHAIN_ORDER) {
      var chain = _getCurrentChain();
      var chainOrder = (chain) ? chain.getOrder() : [];
      var defaultOrder = SL.effectsUI.DEFAULT_CHAIN_ORDER;
      /* Merge: chain order first, then any defaults not already in chain order */
      var merged = chainOrder.slice();
      var di;
      for (di = 0; di < defaultOrder.length; di++) {
        if (merged.indexOf(defaultOrder[di]) < 0) {
          merged.push(defaultOrder[di]);
        }
      }
      return merged;
    }
    return [];
  }

  function _getCurrentChain() {
    if (SL.audio && SL.audio.getEffectChainForTarget) {
      return SL.audio.getEffectChainForTarget(0);
    }
    return null;
  }

  function _isEffectEnabled(name) {
    var chain = _getCurrentChain();
    if (chain) {
      var effect = chain.getEffect(name);
      if (effect) {
        return effect.enabled;
      }
    }
    return false;
  }

  function _setEffectEnabled(name, enabled) {
    var chain = _getCurrentChain();
    if (chain) {
      // Ensure the effect is in the chain order so audio nodes are connected.
      // addToChain is a no-op if already present; it creates the instance
      // via _ensureEffect and calls rebuildChain to wire up the audio graph.
      chain.addToChain(name);
      var effect = chain.getEffect(name);
      if (effect) {
        effect.setEnabled(enabled);
      }
    }
  }

  function _getEffectParams(name) {
    var chain = _getCurrentChain();
    if (chain) {
      var effect = chain.getEffect(name);
      if (effect) {
        return effect.getParams();
      }
    }
    return {};
  }

  function _setEffectParam(name, paramName, value) {
    var chain = _getCurrentChain();
    if (chain) {
      var effect = chain.getEffect(name);
      if (effect) {
        effect.setParam(paramName, value);
      }
    }
  }

  // ============================================================
  // Chain Reorder
  // ============================================================

  function _moveEffectInChain(effectName, displayIndex, direction) {
    var chain = _getCurrentChain();
    if (chain) {
      var order = chain.getOrder();

      // Build list of indices of enabled effects only
      var enabledIndices = [];
      var f;
      for (f = 0; f < order.length; f++) {
        if (_isEffectEnabled(order[f])) {
          enabledIndices.push(f);
        }
      }

      // Find which position in the enabled list this effect occupies
      var actualIndex = -1;
      for (f = 0; f < order.length; f++) {
        if (order[f] === effectName) {
          actualIndex = f;
          break;
        }
      }
      if (actualIndex >= 0) {
        var enabledPos = enabledIndices.indexOf(actualIndex);
        if (enabledPos >= 0) {
          // Navigate to next/prev enabled effect position
          var targetEnabledPos = enabledPos + direction;
          if (targetEnabledPos >= 0 && targetEnabledPos < enabledIndices.length) {
            var newIndex = enabledIndices[targetEnabledPos];

            /* Swap with the target enabled effect */
            var temp = order[actualIndex];
            order[actualIndex] = order[newIndex];
            order[newIndex] = temp;
            chain.setOrder(order);
            _buildChainList();
          }
        }
      }
    }
  }

  // ============================================================
  // Build Effects Chain List
  // ============================================================

  function _buildChainList() {
    if (_chainListEl) {
    _chainListEl.innerHTML = '';

    var order = _getChainOrder();
    var meta = _getEffectMeta();

    // Partition into enabled (preserve chain order) and disabled (preserve chain order)
    var enabledEffects = [];
    var disabledEffects = [];
    for (var p = 0; p < order.length; p++) {
      var pName = order[p];
      if (!meta[pName]) {
        continue;
      }
      if (_isEffectEnabled(pName)) {
        enabledEffects.push(pName);
      } else {
        disabledEffects.push(pName);
      }
    }

    // Display order: enabled first, then disabled
    var displayOrder = enabledEffects.concat(disabledEffects);
    var enabledCount = enabledEffects.length;

    var frag = document.createDocumentFragment();
    for (var i = 0; i < displayOrder.length; i++) {
      var effectName = displayOrder[i];
      var effectMeta = meta[effectName];
      var enabled = (i < enabledCount);

      var row = document.createElement('div');
      row.className = 'ssli-fx-chain-row' + (enabled ? ' active' : '');
      row.setAttribute('data-effect', effectName);

      // Enable checkbox — U-01: add aria-label
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'ssli-fx-chain-cb';
      cb.checked = enabled;
      cb.setAttribute('aria-label', SL.t('screen.effects.enable') + ' ' + _effectDisplayName(effectName, effectMeta));
      (function(eName, cbEl) {
        cbEl.addEventListener('change', function() {
          _setEffectEnabled(eName, cbEl.checked);
          _buildChainList();
        });
      })(effectName, cb);
      row.appendChild(cb);

      // Effect icon + name (tappable to open modal) — U-01: add role+aria
      var infoWrap = document.createElement('div');
      infoWrap.className = 'ssli-fx-chain-info';
      infoWrap.setAttribute('role', 'button');
      infoWrap.setAttribute('aria-label', SL.t('screen.effects.open') + ' ' + _effectDisplayName(effectName, effectMeta) + ' ' + SL.t('screen.effects.parameters'));
      infoWrap.setAttribute('tabindex', '0');
      (function(eName) {
        infoWrap.addEventListener('click', function() {
          _openParamModal(eName);
        });
      })(effectName);

      var icon = document.createElement('span');
      icon.className = 'ssli-fx-chain-icon';
      icon.textContent = effectMeta.icon || '';
      infoWrap.appendChild(icon);

      var nameSpan = document.createElement('span');
      nameSpan.className = 'ssli-fx-chain-name';
      nameSpan.textContent = _effectDisplayName(effectName, effectMeta);
      infoWrap.appendChild(nameSpan);

      row.appendChild(infoWrap);

      // Reorder buttons — only for enabled effects (reordering disabled is meaningless)
      if (enabled) {
        var reorderWrap = document.createElement('div');
        reorderWrap.className = 'ssli-fx-reorder-wrap';

        var upBtn = document.createElement('button');
        upBtn.className = 'ssli-fx-reorder-btn';
        upBtn.textContent = SL.t('screen.effects.arrowLeft');
        upBtn.title = SL.t('ui.button.move_left');
        upBtn.setAttribute('aria-label', SL.t('ui.button.move_left') + ' ' + _effectDisplayName(effectName, effectMeta));
        if (i === 0) { upBtn.disabled = true; }
        (function(eName, idx) {
          upBtn.addEventListener('click', function(ev) {
            ev.stopPropagation();
            _moveEffectInChain(eName, idx, -1);
          });
        })(effectName, i);
        reorderWrap.appendChild(upBtn);

        var downBtn = document.createElement('button');
        downBtn.className = 'ssli-fx-reorder-btn';
        downBtn.textContent = SL.t('screen.effects.arrowRight');
        downBtn.title = SL.t('ui.button.move_right');
        downBtn.setAttribute('aria-label', SL.t('ui.button.move_right') + ' ' + _effectDisplayName(effectName, effectMeta));
        if (i === enabledCount - 1) { downBtn.disabled = true; }
        (function(eName, idx) {
          downBtn.addEventListener('click', function(ev) {
            ev.stopPropagation();
            _moveEffectInChain(eName, idx, 1);
          });
        })(effectName, i);
        reorderWrap.appendChild(downBtn);

        row.appendChild(reorderWrap);
      }

      frag.appendChild(row);
    }
    _chainListEl.appendChild(frag);
    } // end if (_chainListEl)
  }

  // ============================================================
  // Drag and Drop
  // ============================================================

  function _attachDragHandlers(handle, row, effectName) {
    // Mouse events
    handle.addEventListener('mousedown', function(e) {
      e.preventDefault();
      _startLongPress(row, effectName, e.clientY);
    });

    // Touch events
    handle.addEventListener('touchstart', function(e) {
      var touch = e.touches[0];
      _startLongPress(row, effectName, touch.clientY);
    }, { passive: true });
  }

  function _startLongPress(row, effectName, startY) {
    _cancelLongPress();
    _longPressTimer = setTimeout(function() {
      _beginDrag(row, effectName, startY);
    }, LONG_PRESS_MS);

    // Listen for cancel
    var cancelHandler = function() {
      _cancelLongPress();
      document.removeEventListener('mouseup', cancelHandler);
      document.removeEventListener('touchend', cancelHandler);
      document.removeEventListener('touchcancel', cancelHandler);
    };
    document.addEventListener('mouseup', cancelHandler);
    document.addEventListener('touchend', cancelHandler);
    document.addEventListener('touchcancel', cancelHandler);
  }

  function _cancelLongPress() {
    if (_longPressTimer) {
      clearTimeout(_longPressTimer);
      _longPressTimer = null;
    }
  }

  function _beginDrag(row, effectName, startY) {
    _dragState = {
      effectName: effectName,
      row: row,
      startY: startY,
      currentY: startY
    };

    row.classList.add('dragging');
    row.style.boxShadow = '0 ' + DRAG_ELEVATION_PX + 'px 16px rgba(76, 201, 240, 0.3)';
    row.style.zIndex = '100';

    // Listen for move and end
    document.addEventListener('mousemove', _onDragMove);
    document.addEventListener('mouseup', _onDragEnd);
    document.addEventListener('touchmove', _onDragMoveTouch, { passive: false });
    document.addEventListener('touchend', _onDragEndTouch);
    document.addEventListener('touchcancel', _onDragEndTouch);
  }

  function _onDragMove(e) {
    if (!_dragState) { return; }
    if (isDragRafPending) { return; }
    isDragRafPending = true;
    requestAnimationFrame(function() {
      isDragRafPending = false;
      if (!_dragState) { return; }
      _dragState.currentY = e.clientY;
      _updateDragPosition();
    });
  }

  function _onDragMoveTouch(e) {
    if (!_dragState) { return; }
    e.preventDefault();
    if (isDragRafPending) { return; }
    isDragRafPending = true;
    var touch = e.touches[0];
    var touchY = touch.clientY;
    requestAnimationFrame(function() {
      isDragRafPending = false;
      if (!_dragState) { return; }
      _dragState.currentY = touchY;
      _updateDragPosition();
    });
  }

  function _updateDragPosition() {
    if (_dragState && _chainListEl) {
    var rows = _chainListEl.querySelectorAll('.ssli-fx-chain-row');
    for (var i = 0; i < rows.length; i++) {
      var rowRect = rows[i].getBoundingClientRect();
      var rowMidY = rowRect.top + rowRect.height / 2;
      if (rows[i] !== _dragState.row) {
        if (_dragState.currentY < rowMidY && _dragState.currentY > rowRect.top - rowRect.height) {
          rows[i].classList.add('drop-target-above');
          rows[i].classList.remove('drop-target-below');
        } else if (_dragState.currentY > rowMidY && _dragState.currentY < rowRect.bottom + rowRect.height) {
          rows[i].classList.remove('drop-target-above');
          rows[i].classList.add('drop-target-below');
        } else {
          rows[i].classList.remove('drop-target-above');
          rows[i].classList.remove('drop-target-below');
        }
      }
    }
    } // end if (_dragState && _chainListEl)
  }

  function _onDragEnd() {
    _finishDrag();
    document.removeEventListener('mousemove', _onDragMove);
    document.removeEventListener('mouseup', _onDragEnd);
  }

  function _onDragEndTouch() {
    _finishDrag();
    document.removeEventListener('touchmove', _onDragMoveTouch);
    document.removeEventListener('touchend', _onDragEndTouch);
    document.removeEventListener('touchcancel', _onDragEndTouch);
  }

  function _finishDrag() {
    if (_dragState && _chainListEl) {
    // Find drop target
    var rows = _chainListEl.querySelectorAll('.ssli-fx-chain-row');
    var dropIdx = -1;
    var draggedName = _dragState.effectName;

    for (var i = 0; i < rows.length; i++) {
      if (rows[i].classList.contains('drop-target-above')) {
        dropIdx = i;
        break;
      }
      if (rows[i].classList.contains('drop-target-below')) {
        dropIdx = i + 1;
        break;
      }
    }

    // Clean up visual state
    _dragState.row.classList.remove('dragging');
    _dragState.row.style.boxShadow = '';
    _dragState.row.style.zIndex = '';
    for (var j = 0; j < rows.length; j++) {
      rows[j].classList.remove('drop-target-above');
      rows[j].classList.remove('drop-target-below');
    }

    // Apply reorder if needed
    if (dropIdx >= 0) {
      var order = _getChainOrder();
      var fromIdx = -1;
      for (var k = 0; k < order.length; k++) {
        if (order[k] === draggedName) {
          fromIdx = k;
          break;
        }
      }
      if (fromIdx >= 0 && fromIdx !== dropIdx) {
        order.splice(fromIdx, 1);
        if (dropIdx > fromIdx) {
          dropIdx--;
        }
        order.splice(dropIdx, 0, draggedName);

        // Apply to chain
        var chain = _getCurrentChain();
        if (chain) {
          chain.setOrder(order);
        }

        // Rebuild list
        _buildChainList();
      }
    }
    } // end if (_dragState && _chainListEl)
    _dragState = null;
  }

  // ============================================================
  // Parameter Modal
  // ============================================================

  function _openParamModal(effectName) {
    var meta = _getEffectMeta();
    var effectMeta = meta[effectName];
    if (effectMeta) {
    _closeParamModal();

    var params = _getEffectParams(effectName);

    // Backdrop
    _modalEl = document.createElement('div');
    _modalEl.className = 'ssli-fx-modal-backdrop';
    _modalEl.addEventListener('click', function(e) {
      if (e.target === _modalEl) {
        _closeParamModal();
      }
    });

    var panel = document.createElement('div');
    panel.className = 'ssli-fx-modal-panel';

    // Header
    var header = document.createElement('div');
    header.className = 'ssli-fx-modal-header';

    var titleEl = document.createElement('div');
    titleEl.className = 'ssli-fx-modal-title';
    titleEl.textContent = _effectDisplayName(effectName, effectMeta);
    header.appendChild(titleEl);

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'ssli-fx-modal-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', function() {
      _closeParamModal();
    });
    header.appendChild(closeBtn);

    panel.appendChild(header);

    // Parameters
    var paramsContainer = document.createElement('div');
    paramsContainer.className = 'ssli-fx-modal-params';

    var paramDefs = effectMeta.params || [];
    for (var i = 0; i < paramDefs.length; i++) {
      var pDef = paramDefs[i];

      // Check showWhen conditions
      if (pDef.showWhen) {
        var visible = true;
        var condKeys = Object.keys(pDef.showWhen);
        for (var c = 0; c < condKeys.length; c++) {
          var condKey = condKeys[c];
          var condVal = pDef.showWhen[condKey];
          if (params[condKey] !== condVal) {
            visible = false;
            break;
          }
        }
        if (!visible) {
          continue;
        }
      }

      if (pDef.type === 'select') {
        // Select dropdown
        var selectRow = document.createElement('div');
        selectRow.className = 'ssli-fx-modal-row';

        var selectLabel = document.createElement('span');
        selectLabel.className = 'ssli-shape-label';
        selectLabel.textContent = pDef.label;
        selectRow.appendChild(selectLabel);

        var select = document.createElement('select');
        select.className = 'ssli-sound-select';
        var options = pDef.options || _emptyOptions();
        var optFrag = document.createDocumentFragment();
        for (var o = 0; o < options.length; o++) {
          var optEl = document.createElement('option');
          optEl.value = options[o];
          optEl.textContent = _optionDisplayLabel(options[o]);
          optFrag.appendChild(optEl);
        }
        select.appendChild(optFrag);
        select.value = params[pDef.name] || pDef.default;
        (function(eName, pName) {
          select.addEventListener('change', function() {
            _setEffectParam(eName, pName, select.value);
            // Rebuild modal to show/hide conditional params
            _openParamModal(eName);
          });
        })(effectName, pDef.name);
        selectRow.appendChild(select);
        paramsContainer.appendChild(selectRow);
      } else {
        // Slider
        var currentVal = (params[pDef.name] !== undefined) ? params[pDef.name] : pDef.default;
        var step = pDef.step || ((pDef.max - pDef.min) <= 1 ? 0.01 : 1);
        var unit = pDef.unit || '';

        var sliderRow = _createParamSliderRow(
          pDef.label,
          pDef.min,
          pDef.max,
          currentVal,
          step,
          unit,
          effectName,
          pDef.name
        );
        paramsContainer.appendChild(sliderRow);
      }
    }

    panel.appendChild(paramsContainer);
    _modalEl.appendChild(panel);
    document.body.appendChild(_modalEl);
    isModalOpen = true;
    } // end if (effectMeta)
  }

  function _createParamSliderRow(label, min, max, value, step, unit, effectName, paramName) {
    var row = document.createElement('div');
    row.className = 'ssli-fx-modal-row';

    var lbl = document.createElement('span');
    lbl.className = 'ssli-shape-label';
    lbl.textContent = label;

    var slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'ssli-shape-slider';
    slider.min = String(min);
    slider.max = String(max);
    slider.value = String(value);
    slider.step = String(step);

    var valSpan = document.createElement('span');
    valSpan.className = 'ssli-shape-val';
    valSpan.textContent = _formatParamVal(value, unit);

    slider.addEventListener('input', function() {
      var v = parseFloat(slider.value);
      valSpan.textContent = _formatParamVal(v, unit);
      _setEffectParam(effectName, paramName, v);
    });

    row.appendChild(lbl);
    row.appendChild(slider);
    row.appendChild(valSpan);

    return row;
  }

  function _formatParamVal(val, unit) {
    if (unit === 'Hz' && val >= 1000) {
      return (val / 1000).toFixed(1) + 'kHz';
    }
    if (unit === 'ms' && val >= 1000) {
      return (val / 1000).toFixed(1) + 's';
    }
    if (typeof val === 'number') {
      if (val === Math.floor(val)) {
        return val + unit;
      }
      return val.toFixed(1) + unit;
    }
    return val + unit;
  }

  function _closeParamModal() {
    if (_modalEl && _modalEl.parentNode) {
      _modalEl.parentNode.removeChild(_modalEl);
    }
    _modalEl = null;
    isModalOpen = false;
  }

  // ============================================================
  // Effects Presets
  // ============================================================

  function _findPresetById(presetId) {
    for (var c = 0; c < FX_PRESET_CATEGORIES.length; c++) {
      var cat = FX_PRESET_CATEGORIES[c];
      var presets = FX_PRESET_LIBRARY[cat];
      for (var p = 0; p < presets.length; p++) {
        if (presets[p].id === presetId) {
          return { category: cat, preset: presets[p] };
        }
      }
    }
    return null;
  }

  function _applyFxPreset(presetId, skipNotify) {
    var found = _findPresetById(presetId);
    if (found) {
    _activeFxCategory = found.category;
    _activeFxPresetId = presetId;

    // 1. Disable all effects
    var chain = _getCurrentChain();
    var meta = _getEffectMeta();
    var allEffects = Object.keys(meta);
    for (var i = 0; i < allEffects.length; i++) {
      _setEffectEnabled(allEffects[i], false);
    }

    // 2 & 3. Enable specified effects and set params
    var presetEffects = found.preset.effects;
    var chainOrder = [];
    for (var j = 0; j < presetEffects.length; j++) {
      var fx = presetEffects[j];
      _setEffectEnabled(fx.name, true);
      chainOrder.push(fx.name);

      // Set specified parameters
      var paramKeys = Object.keys(fx.params);
      for (var k = 0; k < paramKeys.length; k++) {
        _setEffectParam(fx.name, paramKeys[k], fx.params[paramKeys[k]]);
      }
    }

    // 4. Set chain order: preset effects first, then remaining in default order
    var hasDefaultChainOrder = SL.effectsUI && SL.effectsUI.DEFAULT_CHAIN_ORDER;
    var canSetChainOrder = chain && hasDefaultChainOrder;
    if (canSetChainOrder) {
      var defaultOrder = SL.effectsUI.DEFAULT_CHAIN_ORDER;
      for (var d = 0; d < defaultOrder.length; d++) {
        if (chainOrder.indexOf(defaultOrder[d]) < 0) {
          chainOrder.push(defaultOrder[d]);
        }
      }
      chain.setOrder(chainOrder);
    }

    // 5. Update dropdowns
    _syncFxDropdowns();

    // 6. Rebuild chain list
    _buildChainList();

    // 7. Notify other screens
    var hasStateNotify = SL.state && SL.state.notify;
    var shouldNotifyFxChange = !skipNotify && hasStateNotify;
    if (shouldNotifyFxChange) {
      SL.state.notify('fxpreset');
    }
    } // end if (found)
  }

  function _syncFxDropdowns() {
    if (_fxCategorySelect) {
      _fxCategorySelect.value = _activeFxCategory;
    }
    if (_fxPresetSelect) {
      _populateFxPresetDropdown();
      _fxPresetSelect.value = _activeFxPresetId;
    }
  }

  function _populateFxPresetDropdown() {
    if (_fxPresetSelect) {
      _fxPresetSelect.innerHTML = '';
      var presets = FX_PRESET_LIBRARY[_activeFxCategory] || [];
      for (var i = 0; i < presets.length; i++) {
        var opt = document.createElement('option');
        opt.value = presets[i].id;
        opt.textContent = SL.t('fx_preset_label.' + (_FX_PRESET_KEY[presets[i].label] || ''), presets[i].label);
        _fxPresetSelect.appendChild(opt);
      }
    }
  }

  function _onFxCategoryChange() {
    if (_fxCategorySelect) {
      _activeFxCategory = _fxCategorySelect.value;
      _populateFxPresetDropdown();
      // Auto-apply first preset in category
      var presets = FX_PRESET_LIBRARY[_activeFxCategory];
      if (presets && presets.length > 0) {
        _applyFxPreset(presets[0].id);
      }
    }
  }

  function _onFxPresetChange() {
    if (_fxPresetSelect) {
      _applyFxPreset(_fxPresetSelect.value);
    }
  }

  // ============================================================
  // Build Screen
  // ============================================================

  function _buildScreen() {
    _screenEl = document.getElementById('ssli-screen-effects');
    if (_screenEl) {
    _screenEl.innerHTML = '';

    var container = document.createElement('div');
    container.className = 'ssli-fx-container';

    // Presets row — Category + Preset dropdowns (compact single row)
    var presetsSection = document.createElement('div');
    presetsSection.className = 'ssli-shape-section ssli-fx-presets-compact';

    var presetsRow = document.createElement('div');
    presetsRow.className = 'ssli-fx-presets-inline-row';

    var presetsLabel = document.createElement('span');
    presetsLabel.className = 'ssli-fx-presets-inline-label';
    presetsLabel.textContent = SL.t('ui.label.fx_preset');
    presetsRow.appendChild(presetsLabel);

    _fxCategorySelect = document.createElement('select');
    _fxCategorySelect.className = 'ssli-sound-select ssli-fx-cat-select';
    _fxCategorySelect.setAttribute('aria-label', SL.t('screen.effects.fxPresetCategory'));
    for (var ci = 0; ci < FX_PRESET_CATEGORIES.length; ci++) {
      var catOpt = document.createElement('option');
      catOpt.value = FX_PRESET_CATEGORIES[ci];
      catOpt.textContent = SL.t('fx_category.' + (_FX_CAT_KEY[FX_PRESET_CATEGORIES[ci]] || ''), FX_PRESET_CATEGORIES[ci]);
      _fxCategorySelect.appendChild(catOpt);
    }
    _fxCategorySelect.value = _activeFxCategory;
    _fxCategorySelect.addEventListener('change', _onFxCategoryChange);
    presetsRow.appendChild(_fxCategorySelect);

    _fxPresetSelect = document.createElement('select');
    _fxPresetSelect.className = 'ssli-sound-select ssli-fx-pre-select';
    _fxPresetSelect.setAttribute('aria-label', SL.t('screen.effects.fxPreset'));
    _fxPresetSelect.addEventListener('change', _onFxPresetChange);
    presetsRow.appendChild(_fxPresetSelect);

    _populateFxPresetDropdown();
    _fxPresetSelect.value = _activeFxPresetId;

    presetsSection.appendChild(presetsRow);
    container.appendChild(presetsSection);

    // Chain list
    var chainSection = document.createElement('div');
    chainSection.className = 'ssli-shape-section ssli-fx-chain-section';

    var chainTitle = document.createElement('div');
    chainTitle.className = 'ssli-shape-section-title';
    chainTitle.textContent = SL.t('ui.label.effects_chain');
    chainSection.appendChild(chainTitle);

    _chainListEl = document.createElement('div');
    _chainListEl.className = 'ssli-fx-chain-list';
    chainSection.appendChild(_chainListEl);
    container.appendChild(chainSection);

    // Master mix slider
    // Phone-land: inline the Master Mix slider at the end of the FX-Preset row
    // so it doesn't eat its own 22px strip beneath the chain list. Desktop keeps
    // the dedicated section for readability.
    var isPhoneLandFx = (document.documentElement.getAttribute('data-layout') === 'phone-land');

    var mixLabel = document.createElement('span');
    mixLabel.className = 'ssli-shape-label';
    mixLabel.textContent = isPhoneLandFx ? SL.t('param.mix') : SL.t('ui.label.master_mix');

    _masterMixSlider = document.createElement('input');
    _masterMixSlider.type = 'range';
    _masterMixSlider.className = 'ssli-shape-slider';
    _masterMixSlider.min = '0';
    _masterMixSlider.max = String(MAX_MASTER_MIX);
    var chain = _getCurrentChain();
    var currentMix = chain ? chain.getMasterMix() : MAX_MASTER_MIX;
    _masterMixSlider.value = String(currentMix);

    _masterMixVal = document.createElement('span');
    _masterMixVal.className = 'ssli-shape-val';
    _masterMixVal.textContent = currentMix + '%';

    _masterMixSlider.addEventListener('input', function() {
      var v = parseInt(_masterMixSlider.value, 10);
      _masterMixVal.textContent = v + '%';
      var c = _getCurrentChain();
      if (c) {
        c.setMasterMix(v);
      }
    });

    if (isPhoneLandFx) {
      // Append slider directly into the existing presets-inline row.
      presetsRow.appendChild(mixLabel);
      presetsRow.appendChild(_masterMixSlider);
      presetsRow.appendChild(_masterMixVal);
    } else {
      var mixSection = document.createElement('div');
      mixSection.className = 'ssli-shape-section ssli-fx-master-mix';
      var mixRow = document.createElement('div');
      mixRow.className = 'ssli-shape-row';
      mixRow.appendChild(mixLabel);
      mixRow.appendChild(_masterMixSlider);
      mixRow.appendChild(_masterMixVal);
      mixSection.appendChild(mixRow);
      container.appendChild(mixSection);
    }

    _screenEl.appendChild(container);

    // Populate chain list
    _buildChainList();
    }
  }

  // ============================================================
  // State Listener
  // ============================================================

  function _onStateChange(what) {
    if (isScreenActive) {
      if (what === 'fxpreset') {
        // Sync dropdowns when changed from another screen
        _syncFxDropdowns();
        _buildChainList();
      }
    }
  }

  // ============================================================
  // Activate / Deactivate
  // ============================================================

  function activate() {
    isScreenActive = true;
    if (!isScreenInitialized) {
      _buildScreen();
      isScreenInitialized = true;

      // Re-translate all visible text when the UI language changes
      if (SL.localization && SL.localization.onLanguageChange) {
        SL.localization.onLanguageChange(function() {
          if (isScreenActive) {
            _buildScreen();
          }
        });
      }
    } else {
      // Refresh chain list in case effects changed on other screens
      _buildChainList();
    }
    if (SL.state && SL.state.onChange) {
      SL.state.onChange(_onStateChange);
    }
  }

  function deactivate() {
    isScreenActive = false;
    _closeParamModal();
    // E-01: Clear long press timer if pending
    _cancelLongPress();
    if (SL.state && SL.state.removeListener) {
      SL.state.removeListener(_onStateChange);
    }
  }

  // ============================================================
  // Register
  // ============================================================

  SL.screenEffects = {
    activate: activate,
    deactivate: deactivate,
    getFxState: function() {
      return { category: _activeFxCategory, presetId: _activeFxPresetId };
    },
    applyPreset: function(presetId) {
      _applyFxPreset(presetId);
    }
  };

})();
