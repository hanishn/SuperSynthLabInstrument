// SSLI Controller: Drum Pads
// ES5 compatible (var, no arrow functions, no template literals)

(function() {
  'use strict';

  var SL = window.SynthLab;

  // ============================================================
  // Kit Presets
  // ============================================================

  // ============================================================
  // Per-kit synthesis parameters
  // Each kit has distinct pitch, decay, tone, bodyNoiseMix, drive
  // values that shape the drumsyn engine character.
  // ============================================================

  var KIT_SETTINGS = {
    'GM Standard': { pitch: 50, decay: 50, tone: 50, bodyNoiseMix: 70, drive: 20 },
    '808 Kit':     { pitch: 45, decay: 75, tone: 60, bodyNoiseMix: 50, drive: 50 },
    'Jazz Kit':    { pitch: 55, decay: 35, tone: 40, bodyNoiseMix: 80, drive: 10 },
    'Latin Kit':   { pitch: 65, decay: 40, tone: 70, bodyNoiseMix: 30, drive: 15 },
    'Electronic Kit': { pitch: 40, decay: 60, tone: 80, bodyNoiseMix: 40, drive: 65 }
  };

  var DRUM_KITS = {
    'GM Standard': [
      { midi: 36, name: 'Kick' },
      { midi: 38, name: 'Snare' },
      { midi: 42, name: 'Hi-Hat Cl' },
      { midi: 46, name: 'Hi-Hat Op' },
      { midi: 45, name: 'Low Tom' },
      { midi: 48, name: 'Mid Tom' },
      { midi: 50, name: 'High Tom' },
      { midi: 49, name: 'Crash' },
      { midi: 51, name: 'Ride' },
      { midi: 53, name: 'Ride Bell' },
      { midi: 39, name: 'Clap' },
      { midi: 56, name: 'Cowbell' },
      { midi: 37, name: 'Sidestick' },
      { midi: 54, name: 'Tambourine' },
      { midi: 44, name: 'Pedal HH' },
      { midi: 57, name: 'Crash 2' }
    ],
    '808 Kit': [
      { midi: 36, name: '808 Kick' },
      { midi: 38, name: '808 Snare' },
      { midi: 42, name: '808 HH Cl' },
      { midi: 46, name: '808 HH Op' },
      { midi: 39, name: '808 Clap' },
      { midi: 56, name: '808 Cowbell' },
      { midi: 75, name: '808 Clave' },
      { midi: 67, name: '808 Agogo' },
      { midi: 70, name: '808 Maracas' },
      { midi: 62, name: '808 Mt Conga' },
      { midi: 63, name: '808 Op Conga' },
      { midi: 45, name: '808 Lo Tom' },
      { midi: 48, name: '808 Mid Tom' },
      { midi: 50, name: '808 Hi Tom' },
      { midi: 37, name: '808 Rimshot' },
      { midi: 49, name: '808 Cymbal' }
    ],
    'Jazz Kit': [
      { midi: 36, name: 'Jazz Kick' },
      { midi: 38, name: 'Brush Snare' },
      { midi: 40, name: 'Brush Slap' },
      { midi: 42, name: 'HH Closed' },
      { midi: 44, name: 'HH Pedal' },
      { midi: 46, name: 'HH Open' },
      { midi: 51, name: 'Ride' },
      { midi: 53, name: 'Ride Bell' },
      { midi: 59, name: 'Ride Cym 2' },
      { midi: 49, name: 'Crash' },
      { midi: 45, name: 'Low Tom' },
      { midi: 48, name: 'Mid Tom' },
      { midi: 50, name: 'High Tom' },
      { midi: 37, name: 'Sidestick' },
      { midi: 39, name: 'Snap' },
      { midi: 55, name: 'Splash' }
    ],
    'Latin Kit': [
      { midi: 63, name: 'Hi Conga Op' },
      { midi: 62, name: 'Hi Conga Mt' },
      { midi: 64, name: 'Lo Conga' },
      { midi: 60, name: 'Hi Bongo' },
      { midi: 61, name: 'Lo Bongo' },
      { midi: 65, name: 'Hi Timbale' },
      { midi: 66, name: 'Lo Timbale' },
      { midi: 75, name: 'Claves' },
      { midi: 76, name: 'Hi Woodblk' },
      { midi: 77, name: 'Lo Woodblk' },
      { midi: 70, name: 'Maracas' },
      { midi: 73, name: 'Guiro Short' },
      { midi: 74, name: 'Guiro Long' },
      { midi: 69, name: 'Cabasa' },
      { midi: 67, name: 'Hi Agogo' },
      { midi: 68, name: 'Lo Agogo' }
    ],
    'Electronic Kit': [
      { midi: 36, name: 'Synth Kick' },
      { midi: 38, name: 'Synth Snare' },
      { midi: 40, name: 'Elec Snare' },
      { midi: 42, name: 'Elec HH Cl' },
      { midi: 46, name: 'Elec HH Op' },
      { midi: 39, name: 'Elec Clap' },
      { midi: 52, name: 'China Cym' },
      { midi: 49, name: 'Crash' },
      { midi: 45, name: 'Elec Lo Tom' },
      { midi: 48, name: 'Elec Mid Tom' },
      { midi: 50, name: 'Elec Hi Tom' },
      { midi: 37, name: 'Noise Click' },
      { midi: 54, name: 'Tambourine' },
      { midi: 56, name: 'Cowbell' },
      { midi: 58, name: 'Vibraslap' },
      { midi: 51, name: 'Ride' }
    ]
  };

  var KIT_NAMES = Object.keys(DRUM_KITS);
  var _currentKitName = KIT_NAMES[0];

  // ============================================================
  // Kit Settings Application
  // ============================================================

  /**
   * Push the current kit's synthesis parameters to the drumsyn engine.
   * This is what makes each kit sound distinct.
   */
  function _applyKitSettings(kitName) {
    var settings = KIT_SETTINGS[kitName];
    if (settings) {
      var instId = (SL.audio && SL.audio.getCurrentInstrument) ? SL.audio.getCurrentInstrument() : 0;
      if (SL.audio && SL.audio.setDrumsynSettings) {
        SL.audio.setDrumsynSettings(instId, settings);
      } else if (SL.drumsyn && SL.drumsyn.setSettings) {
        SL.drumsyn.setSettings(instId, settings);
      }
    }
  }

  // ============================================================
  // Velocity Constants
  // ============================================================

  var PAD_VELOCITY_MIN = 40;
  var PAD_VELOCITY_MAX = 127;
  var PAD_DEFAULT_VELOCITY = 100;

  // ============================================================
  // Velocity Calculation
  // ============================================================

  /**
   * Compute velocity from pointer event pressure or Y-position fallback.
   * pressure 0.0-1.0 maps linearly to PAD_VELOCITY_MIN..PAD_VELOCITY_MAX.
   * If pressure is unavailable (mouse/zero), use Y-position within the pad:
   * top of pad = softer, bottom of pad = harder.
   */
  function _computePadVelocity(e, padEl) {
    var pressure = e.pressure || 0;
    var hasPressure = (pressure > 0);
    var velocity;
    if (hasPressure) {
      velocity = Math.round(PAD_VELOCITY_MIN + (pressure * (PAD_VELOCITY_MAX - PAD_VELOCITY_MIN)));
    } else {
      var rect = padEl.getBoundingClientRect();
      var padHeight = rect.height;
      var hasHeight = (padHeight > 0);
      if (hasHeight) {
        var yWithinPad = e.clientY - rect.top;
        var yFraction = yWithinPad / padHeight;
        velocity = Math.round(PAD_VELOCITY_MIN + (yFraction * (PAD_VELOCITY_MAX - PAD_VELOCITY_MIN)));
      } else {
        velocity = PAD_DEFAULT_VELOCITY;
      }
    }
    return velocity;
  }

  // ============================================================
  // Build
  // ============================================================

  function _buildDrumPadsController(container, opts) {
    var noteOn = opts.noteOn;
    var noteOff = opts.noteOff;

    var padDefs = DRUM_KITS[_currentKitName];

    // Ensure container is flex-column so toolbar + grid stack vertically
    container.style.display = 'flex';
    container.style.flexDirection = 'column';

    // Kit selector dropdown
    var toolbar = document.createElement('div');
    toolbar.className = 'perf-pad-toolbar';

    var kitLabel = document.createElement('span');
    kitLabel.className = 'perf-pad-kit-label';
    kitLabel.textContent = SL.t('pads.kit_label');
    toolbar.appendChild(kitLabel);

    var kitSelect = document.createElement('select');
    kitSelect.className = 'ssli-fret-select perf-pad-kit-select';
    kitSelect.title = SL.t('pads.kit_select_title');
    var kitIdx;
    for (kitIdx = 0; kitIdx < KIT_NAMES.length; kitIdx++) {
      var kitOpt = document.createElement('option');
      kitOpt.value = KIT_NAMES[kitIdx];
      kitOpt.textContent = KIT_NAMES[kitIdx];
      if (KIT_NAMES[kitIdx] === _currentKitName) {
        kitOpt.selected = true;
      }
      kitSelect.appendChild(kitOpt);
    }
    kitSelect.addEventListener('change', function() {
      _currentKitName = kitSelect.value;
      _applyKitSettings(_currentKitName);
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
      _buildDrumPadsController(container, opts);
    });
    toolbar.appendChild(kitSelect);
    container.appendChild(toolbar);

    // Apply kit synthesis settings on every build (including initial)
    _applyKitSettings(_currentKitName);

    // Pad grid
    var grid = document.createElement('div');
    grid.className = 'perf-pad-grid';
    grid.style.flex = '1 1 0';
    grid.style.minHeight = '0';
    grid.style.overflow = 'hidden';
    grid.style.boxSizing = 'border-box';
    grid.style.gridTemplateRows = 'repeat(4, 1fr)';

    var padIdx;
    for (padIdx = 0; padIdx < padDefs.length; padIdx++) {
      var pad = padDefs[padIdx];
      var padEl = document.createElement('div');
      padEl.className = 'perf-drum-pad';
      padEl.setAttribute('data-midi', pad.midi);
      padEl.textContent = pad.name;

      (function(m, el) {
        el.addEventListener('mousedown', function(e) {
          e.preventDefault();
          var velocity = _computePadVelocity(e, el);
          noteOn(m, velocity);
          el.classList.add('active');
        });
        el.addEventListener('mouseup', function() {
          noteOff(m);
          el.classList.remove('active');
        });
        el.addEventListener('mouseleave', function() {
          noteOff(m);
          el.classList.remove('active');
        });
        el.addEventListener('mouseenter', function(e) {
          var isButtonDown = (e.buttons !== 0);
          if (isButtonDown) {
            var velocity = _computePadVelocity(e, el);
            noteOn(m, velocity);
            el.classList.add('active');
          }
        });
        el.addEventListener('touchstart', function(e) {
          e.preventDefault();
          var touch = e.touches[0];
          var velocity = _computePadVelocity(touch, el);
          noteOn(m, velocity);
          el.classList.add('active');
        });
        el.addEventListener('touchend', function(e) {
          e.preventDefault();
          noteOff(m);
          el.classList.remove('active');
        });
      })(pad.midi, padEl);

      grid.appendChild(padEl);
    }
    container.appendChild(grid);
  }

  // ============================================================
  // PanicRegistry Registration
  // ============================================================

  if (SL.PanicRegistry && SL.PanicRegistry.register) {
    SL.PanicRegistry.register(
      'voices',
      'pads.activeNotes',
      function teardownPadNotes() {
        var activePads = document.querySelectorAll('.perf-drum-pad.active');
        var i;
        for (i = 0; i < activePads.length; i++) {
          activePads[i].classList.remove('active');
        }
      },
      function assertPadNotes() {
        var activePads = document.querySelectorAll('.perf-drum-pad.active');
        var hasActive = (activePads.length > 0);
        if (hasActive) {
          return activePads.length + ' pad notes still active';
        }
        return null;
      }
    );
  }

  // ============================================================
  // Register
  // ============================================================

  if (!SL.controllers) { SL.controllers = {}; }
  SL.controllers.pads = {
    build: _buildDrumPadsController,
    release: function(noteOff) {
      var activePads = document.querySelectorAll('.perf-drum-pad.active');
      var i;
      for (i = 0; i < activePads.length; i++) {
        var midi = parseInt(activePads[i].getAttribute('data-midi'), 10);
        activePads[i].classList.remove('active');
        if (noteOff) {
          noteOff(midi);
        }
      }
    }
  };

})();
