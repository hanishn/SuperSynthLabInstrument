// SSLI Shared Chord Panel Helper
// ES5 compatible (var, no arrow functions, no template literals).
//
// Provides reusable diatonic chord-panel logic used by multiple Play
// surfaces (guitar/bass fretboard, breath pad ensemble, ...):
//   - Build a list of diatonic chords for a given root + mode.
//   - Build a chord button element that:
//       * Short-press (tap / short click): calls onSelect(chord).
//       * Long-press (hold >= LONG_PRESS_MS) or right-click: shows a
//         variant popup that lets the user swap to sus2 / sus4 / 7 /
//         maj7 / add9 / power (5). Picking a variant REPLACES the
//         anchor button's current chord type so subsequent short
//         presses play the chosen variant.
//
// The CSS class names match the fretboard controller's existing
// classes (.ssli-fret-chord-btn / .ssli-fret-chord-panel /
// .ssli-fret-variation-popup / .ssli-fret-var-btn) so styling is
// shared across surfaces.

(function() {
  'use strict';

  var SL = window.SynthLab = window.SynthLab || {};
  var NOTES = SL.NOTES || ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var NOTES_FLAT = SL.NOTES_FLAT || NOTES;

  var SEMITONES_PER_OCTAVE = 12;
  var LONG_PRESS_MS = 500;

  var NO_TIMER = null;
  var POPUP_AUTO_DISMISS_MS = 2000;

  // Variation types offered in the popup. 'root' replays the button's
  // current chord; the rest override the chord type.
  var VARIATION_TYPES = ['root', 'sus2', 'sus4', '7', 'maj7', 'add9', '5'];
  var VARIATION_LABELS = {
    'root': 'Root',
    'sus2': 'sus2',
    'sus4': 'sus4',
    '7':    '7th',
    'maj7': 'maj7',
    'add9': 'add9',
    '5':    'Power'
  };

  // Local interval / suffix tables for types that SL.CHORD_INT may not
  // define. Mirrors ssli-ctrl-fretboard.js so behavior is consistent.
  var LOCAL_CHORD_INT = {
    'minMaj7': [0, 3, 7, 11],
    'add9':    [0, 4, 7, 14],
    '5':       [0, 7]
  };
  var LOCAL_CHORD_NAME = {
    'minMaj7': 'mM7',
    'add9':    'add9',
    '5':       '5'
  };

  function _getChordIntervals(chordType) {
    var result = null;
    if (SL.CHORD_INT && SL.CHORD_INT[chordType]) {
      result = SL.CHORD_INT[chordType];
    } else if (LOCAL_CHORD_INT[chordType]) {
      result = LOCAL_CHORD_INT[chordType];
    }
    return result;
  }

  function _getChordSuffix(chordType) {
    var result = chordType;
    if (SL.CHORD_NAME && (SL.CHORD_NAME[chordType] !== undefined)) {
      result = SL.CHORD_NAME[chordType];
    } else if (LOCAL_CHORD_NAME[chordType] !== undefined) {
      result = LOCAL_CHORD_NAME[chordType];
    }
    return result;
  }

  function _pickNoteNames(rootPc) {
    var shouldUseFlats = false;
    if (typeof SL.useFlatNaming === 'function') {
      shouldUseFlats = SL.useFlatNaming(rootPc);
    }
    var names;
    if (shouldUseFlats) {
      names = NOTES_FLAT;
    } else {
      names = NOTES;
    }
    return names;
  }

  // --------------------------------------------------------------
  // Diatonic chord list for (rootPc, modeKey).
  // Returns [{ rootPc, type, name, degree, isV7? }, ...] including the
  // extra V7 entry when the mode has a 5th degree.
  // --------------------------------------------------------------
  function getDiatonicChords(rootPc, modeKey) {
    var chords = [];
    var MODES = SL.MODES;
    var modeData = MODES ? MODES[modeKey] : null;
    var hasModeTriads = modeData && modeData.scale && modeData.triads;
    if (hasModeTriads) {
      var scale = modeData.scale;
      var triads = modeData.triads;
      var degIdx;
      for (degIdx = 0; degIdx < triads.length; degIdx++) {
        var chordRootPc = (rootPc + scale[degIdx]) % SEMITONES_PER_OCTAVE;
        var chordType = triads[degIdx];
        var noteNames = _pickNoteNames(rootPc);
        var chordName = noteNames[chordRootPc] + _getChordSuffix(chordType);
        chords.push({
          rootPc: chordRootPc,
          type: chordType,
          name: chordName,
          degree: degIdx
        });
      }
      var fifthDegreeIdx = 4;
      if (scale.length > fifthDegreeIdx) {
        var v7RootPc = (rootPc + scale[fifthDegreeIdx]) % SEMITONES_PER_OCTAVE;
        var v7Names = _pickNoteNames(rootPc);
        var v7Name = v7Names[v7RootPc] + '7';
        chords.push({
          rootPc: v7RootPc,
          type: '7',
          name: v7Name,
          degree: fifthDegreeIdx,
          isV7: true
        });
      }
    }
    return chords;
  }

  // --------------------------------------------------------------
  // Variation popup.
  // --------------------------------------------------------------
  var _openPopup = null;
  var _popupDismissTimerId = null;

  function _clearPopupDismissTimer() {
    if (_popupDismissTimerId !== NO_TIMER) {
      clearTimeout(_popupDismissTimerId);
      _popupDismissTimerId = null;
    }
  }

  function _closePopup() {
    _clearPopupDismissTimer();
    if (_openPopup && _openPopup.parentNode) {
      _openPopup.parentNode.removeChild(_openPopup);
    }
    _openPopup = null;
  }

  function _showVariationPopup(anchorEl, chord, onVariantChosen) {
    _closePopup();
    var popup = document.createElement('div');
    popup.className = 'ssli-fret-variation-popup';
    var rect = anchorEl.getBoundingClientRect();
    popup.style.position = 'fixed';
    popup.style.left = rect.left + 'px';
    popup.style.top = (rect.bottom + 2) + 'px';
    popup.style.zIndex = '9999';

    if (!chord._baseType) {
      chord._baseType = chord.type;
      chord._baseName = chord.name;
    }

    var varIdx;
    for (varIdx = 0; varIdx < VARIATION_TYPES.length; varIdx++) {
      var varType = VARIATION_TYPES[varIdx];
      var varBtn = document.createElement('button');
      varBtn.className = 'ssli-fret-var-btn';

      var actualType;
      if (varType === 'root') {
        actualType = chord._baseType;
      } else {
        actualType = varType;
      }

      var noteNames = _pickNoteNames(chord.rootPc);
      var varLabel = noteNames[chord.rootPc] + _getChordSuffix(actualType);
      if (varType === 'root') {
        varLabel = chord._baseName;
      }
      varBtn.textContent = varLabel;
      varBtn.title = VARIATION_LABELS[varType];

      (function(capturedType, capturedLabel) {
        varBtn.addEventListener('click', function(clickEv) {
          clickEv.stopPropagation();
          // Replace the anchor button's chord with the chosen variant
          // so subsequent short presses play this variant.
          chord.type = capturedType;
          chord.name = capturedLabel;
          chord.isV7 = false;
          if (anchorEl) {
            anchorEl.textContent = capturedLabel;
          }
          _closePopup();
          if (onVariantChosen) {
            onVariantChosen(chord);
          }
        });
      })(actualType, varLabel);

      popup.appendChild(varBtn);
    }

    document.body.appendChild(popup);
    _openPopup = popup;
  }

  // --------------------------------------------------------------
  // Build a single chord button.
  //   chord          — { rootPc, type, name, degree, isV7? } from getDiatonicChords
  //   highlightScope — element whose descendant chord buttons share
  //                    active-state highlighting. Pass null to skip.
  //   activeState    — { activeDegree } mutated by this helper so
  //                    callers can track which button is active. Pass
  //                    null if you don't care.
  //   onSelect       — function(chord). Called on short-press and
  //                    after variant selection. Receives the
  //                    (possibly mutated) chord object.
  // --------------------------------------------------------------
  function buildChordButton(chord, highlightScope, activeState, onSelect) {
    var chordBtn = document.createElement('button');
    chordBtn.className = 'ssli-fret-chord-btn';
    if (activeState && chord.degree === activeState.activeDegree) {
      chordBtn.classList.add('ssli-fret-chord-active');
    }
    chordBtn.setAttribute('data-degree', chord.degree);
    var initialLabel;
    if (chord.isV7) {
      initialLabel = chord.name + '7';
    } else {
      initialLabel = chord.name;
    }
    chordBtn.textContent = initialLabel;

    var longPressTimer = null;

    function _clearLongPress() {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    }

    function _updateHighlight() {
      if (!highlightScope || !activeState) { return; }
      var allBtns = highlightScope.querySelectorAll('.ssli-fret-chord-btn[data-degree]');
      var btnIdx;
      for (btnIdx = 0; btnIdx < allBtns.length; btnIdx++) {
        var deg = parseInt(allBtns[btnIdx].getAttribute('data-degree'), 10);
        var isActive = (deg === activeState.activeDegree);
        allBtns[btnIdx].classList.toggle('ssli-fret-chord-active', isActive);
      }
    }

    function _activate() {
      /* Pressing a different base chord dismisses any open popup */
      _closePopup();
      if (activeState) {
        activeState.activeDegree = chord.degree;
      }
      _updateHighlight();
      if (onSelect) {
        onSelect(chord);
      }
    }

    function _onVariantChosen() {
      _activate();
    }

    chordBtn.addEventListener('mousedown', function(mdEv) {
      mdEv.stopPropagation();
      _clearPopupDismissTimer();
      longPressTimer = setTimeout(function() {
        longPressTimer = null;
        _showVariationPopup(chordBtn, chord, _onVariantChosen);
      }, LONG_PRESS_MS);
    });
    chordBtn.addEventListener('mouseup', function(muEv) {
      muEv.stopPropagation();
      if (longPressTimer) {
        _clearLongPress();
        _activate();
      } else if (_openPopup) {
        /* Finger lifted after long-press opened the popup; auto-dismiss after delay */
        _clearPopupDismissTimer();
        _popupDismissTimerId = setTimeout(function() { _closePopup(); }, POPUP_AUTO_DISMISS_MS);
      }
    });
    chordBtn.addEventListener('mouseleave', function() {
      _clearLongPress();
    });
    chordBtn.addEventListener('contextmenu', function(ctxEv) {
      ctxEv.preventDefault();
      ctxEv.stopPropagation();
      _clearLongPress();
      _showVariationPopup(chordBtn, chord, _onVariantChosen);
    });
    chordBtn.addEventListener('touchstart', function(tsEv) {
      tsEv.stopPropagation();
      _clearPopupDismissTimer();
      longPressTimer = setTimeout(function() {
        longPressTimer = null;
        _showVariationPopup(chordBtn, chord, _onVariantChosen);
      }, LONG_PRESS_MS);
    }, { passive: true });
    chordBtn.addEventListener('touchend', function(teEv) {
      teEv.stopPropagation();
      if (longPressTimer) {
        _clearLongPress();
        _activate();
      } else if (_openPopup) {
        /* Finger lifted after long-press opened the popup; auto-dismiss after delay */
        _clearPopupDismissTimer();
        _popupDismissTimerId = setTimeout(function() { _closePopup(); }, POPUP_AUTO_DISMISS_MS);
      }
    }, { passive: true });
    chordBtn.addEventListener('touchmove', function() {
      _clearLongPress();
    }, { passive: true });

    return chordBtn;
  }

  // --------------------------------------------------------------
  // Expose
  // --------------------------------------------------------------
  SL.chordPanel = {
    getDiatonicChords: getDiatonicChords,
    buildChordButton: buildChordButton,
    getChordIntervals: _getChordIntervals,
    getChordSuffix: _getChordSuffix,
    LONG_PRESS_MS: LONG_PRESS_MS,
    VARIATION_TYPES: VARIATION_TYPES
  };

})();
