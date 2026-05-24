// Super Synth Lab - Drum Pads Module
// Replaces piano keyboard with a 4x4 drum pad grid when percussion/sampler is selected
(function() {
  'use strict';

  var SL = window.SynthLab;

  var _drumPadMode = false;

  var DRUM_PAD_VELOCITY = 120;

  /**
   * Check if we are currently showing drum pads
   * @returns {boolean}
   */
  function isDrumPadMode() {
    return _drumPadMode;
  }

  /**
   * Build a 4x4 drum pad grid inside the #keyboard div
   * Replaces the piano keyboard when instrument is a sampler (percussion)
   */
  function buildDrumPads() {
    var kbEl = document.getElementById('keyboard');
    if (kbEl) {
      kbEl.innerHTML = '';
      _drumPadMode = true;

      var grid = document.createElement('div');
      grid.className = 'drum-pad-grid';

      var instId = SL.audio ? SL.audio.getCurrentInstrument() : 3;

      for (var i = 0; i < 16; i++) {
        (function(padIndex) {
          var pad = document.createElement('div');
          pad.className = 'drum-pad';
          pad.dataset.pad = padIndex;
          pad.setAttribute('tabindex', '0');
          pad.setAttribute('role', 'button');

          // Get pad name from sampler if available
          var padName = 'Pad ' + (padIndex + 1);
          if (SL.sampler && SL.sampler.getPad) {
            var padData = SL.sampler.getPad(instId, padIndex);
            if (padData && padData.name) {
              padName = padData.name;
            }
          }
          pad.textContent = padName;

          // Mouse down triggers the pad
          pad.addEventListener('mousedown', function(e) {
            e.preventDefault();
            if (SL.sampler && SL.sampler.playPad) {
              SL.sampler.playPad(instId, padIndex, DRUM_PAD_VELOCITY, null);
            }
            pad.classList.add('triggered');
            setTimeout(function() {
              pad.classList.remove('triggered');
            }, 150);
          });

          // Touch with velocity from Y position: top=40, center=90, bottom=127
          pad.addEventListener('touchstart', function(e) {
            e.preventDefault();
            var touch = e.touches[0];
            var vel = 90;
            if (touch && pad.getBoundingClientRect) {
              var rect = pad.getBoundingClientRect();
              var yRatio = (touch.clientY - rect.top) / (rect.height || 1);
              yRatio = Math.max(0, Math.min(1, yRatio));
              vel = Math.round(40 + yRatio * 87); // top=40, bottom=127
            }
            if (SL.sampler && SL.sampler.playPad) {
              SL.sampler.playPad(instId, padIndex, vel, null);
            }
            pad.classList.add('triggered');
            setTimeout(function() {
              pad.classList.remove('triggered');
            }, 150);
          });

          // Keyboard: Enter/Space triggers, arrows navigate
          pad.addEventListener('keydown', function(e) {
            var PADS_PER_ROW = 4;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              pad.click();
            } else if (e.key === 'ArrowRight') {
              e.preventDefault();
              var next = pad.nextElementSibling;
              if (next) { next.focus(); }
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault();
              var prev = pad.previousElementSibling;
              if (prev) { prev.focus(); }
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              var allPads = grid.querySelectorAll('.drum-pad');
              var curIdx = padIndex;
              var nextIdx = curIdx + PADS_PER_ROW;
              if (nextIdx < allPads.length) { allPads[nextIdx].focus(); }
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              var allPadsUp = grid.querySelectorAll('.drum-pad');
              var curIdxUp = padIndex;
              var prevIdx = curIdxUp - PADS_PER_ROW;
              if (prevIdx >= 0) { allPadsUp[prevIdx].focus(); }
            }
          });

          grid.appendChild(pad);
        })(i);
      }

      kbEl.appendChild(grid);

      // Update octave range display to show "Drum Pads"
      var octRange = document.getElementById('octRange');
      if (octRange) {
        octRange.textContent = SL.t('surface.pads');
      }
    }
  }

  /**
   * Clear drum pad mode flag (called when restoring keyboard)
   */
  function clearDrumPadMode() {
    _drumPadMode = false;
  }

  // Export to SynthLab namespace
  SL.drumPads = {
    buildDrumPads: buildDrumPads,
    isDrumPadMode: isDrumPadMode,
    clearDrumPadMode: clearDrumPadMode
  };
})();
