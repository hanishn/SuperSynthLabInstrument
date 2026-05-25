// SSLI Controller: Tonnetz Grid (harmonic hexagonal lattice)
// ES5 compatible (var, no arrow functions, no template literals)

(function() {
  'use strict';

  var SL = window.SynthLab;
  var NOTES = SL.NOTES;

  // ============================================================
  // Constants
  // ============================================================

  var SEMITONES_PER_OCTAVE = 12;

  // Tonnetz axis intervals (semitones) — defaults, can be changed by layout selector
  var FIFTH_INTERVAL = 7;
  var MAJOR_THIRD_INTERVAL = 4;
  var MINOR_THIRD_INTERVAL = 3;

  var TONNETZ_LAYOUTS = [
    { val: 'tonnetz',       lbl: 'Tonnetz',        colInterval: 7, rowInterval: 4 },
    { val: 'wicki-hayden',  lbl: 'Wicki-Hayden',   colInterval: 2, rowInterval: 7 },
    { val: 'harmonic',      lbl: 'Harmonic Table',  colInterval: 7, rowInterval: 4 },
    { val: 'janko',         lbl: 'Janko',     colInterval: 1, rowInterval: 2 },
    { val: 'park',          lbl: 'Park',            colInterval: 1, rowInterval: 3 }
  ];

  // Minimum octave floor (octave 2 = MIDI 24 = ~32Hz, often inaudible)
  var MIN_BASE_OCTAVE = 3;

  // Phone breakpoint
  var PHONE_WIDTH_THRESHOLD = 600;

  // Hex geometry constant (sqrt of 3)
  var HEX_SQRT3 = 1.7320508;

  // Hex cell minimum width (px) — actual sizes computed to fill the container
  var HEX_MIN_SIZE_DESKTOP = 90;
  var HEX_MIN_SIZE_PHONE = 66;
  var HEX_MAX_WIDTH = 120;
  var MIN_ROW_COUNT = 4;

  // Hex clip-path (pointy-top hexagon — matches hex grid in ssli-ctrl-isogrid.js)
  var HEX_CLIP_PATH = 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)';

  // Font sizes
  var FONT_SIZE_DESKTOP = 16;
  var FONT_SIZE_PHONE = 13;

  // Top bar height
  var TOPBAR_HEIGHT_PX = 26;

  // Touch
  var MAX_SIMULTANEOUS_TOUCHES = 10;
  var LEGATO_OVERLAP_MS = 15;
  var HIT_RADIUS_FACTOR = 0.55;

  // Velocity
  var DEFAULT_VELOCITY = 100;

  // Visual
  var ACTIVE_SCALE_FACTOR = 1.05;

  // Pitch class tint hues (0-11, C through B) — degrees on the color wheel
  var PC_HUES = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
  var PC_TINT_OPACITY = 0.15;

  // Triangle overlay colors
  var MAJOR_TRIANGLE_COLOR = 'rgba(76, 201, 240, 0.18)';
  var MINOR_TRIANGLE_COLOR = 'rgba(240, 100, 180, 0.18)';

  // ============================================================
  // Module state
  // ============================================================

  var _container = null;
  var _gridEl = null;
  var _hexCells = [];
  var _hexCenters = [];
  var _hexMidi = [];
  var _cols = 6;
  var _rows = 4;
  var _hexW = HEX_MIN_SIZE_DESKTOP;
  var _hexH = HEX_MIN_SIZE_DESKTOP * 2 / HEX_SQRT3;
  var _baseMidi = 48;
  var _rootPc = 0;

  var _noteOnFn = null;
  var _noteOffFn = null;

  var _activePointers = {};
  var _legatoTimers = {};
  var _triangleOverlays = [];

  // ============================================================
  // Helpers
  // ============================================================

  function _midiForCell(col, row) {
    return _baseMidi + (col * FIFTH_INTERVAL) + (row * MAJOR_THIRD_INTERVAL);
  }

  function _cellIndex(col, row) {
    return row * _cols + col;
  }

  function _findCellAtPoint(px, py) {
    var bestIdx = -1;
    var bestDistSq = Infinity;
    var maxRadiusSq = (_hexW * HIT_RADIUS_FACTOR) * (_hexW * HIT_RADIUS_FACTOR);
    var i;
    for (i = 0; i < _hexCenters.length; i++) {
      var cx = _hexCenters[i].x;
      var cy = _hexCenters[i].y;
      var dx = px - cx;
      var dy = py - cy;
      var distSq = (dx * dx) + (dy * dy);
      var isCloser = (distSq < bestDistSq);
      var isInRange = (distSq < maxRadiusSq);
      if (isCloser && isInRange) {
        bestDistSq = distSq;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  function _colRowFromIndex(idx) {
    var row = Math.floor(idx / _cols);
    var col = idx % _cols;
    return { col: col, row: row };
  }

  // ============================================================
  // Note management
  // ============================================================

  function _activateCell(idx, pointerEvent) {
    if (!((idx < 0) || (idx >= _hexCells.length))) {
      var midi = _hexMidi[idx];
      var cell = _hexCells[idx];
      if (_noteOnFn) {
        var velocity = pointerEvent ? SL.velocityFromPressure(pointerEvent, DEFAULT_VELOCITY) : DEFAULT_VELOCITY;
        _noteOnFn(midi, velocity);
      }
      cell.classList.add('tonnetz-active');
      cell.style.transform = 'scale(' + ACTIVE_SCALE_FACTOR + ')';
      _showTriangles(idx);
    }
  }

  function _deactivateCell(idx) {
    if (!((idx < 0) || (idx >= _hexCells.length))) {
      var midi = _hexMidi[idx];
      var cell = _hexCells[idx];
      if (_noteOffFn) {
        _noteOffFn(midi);
      }
      cell.classList.remove('tonnetz-active');
      cell.style.transform = '';
      _clearTriangles();
    }
  }

  function _switchCell(oldIdx, newIdx, pointerId, pointerEvent) {
    var oldMidi = _hexMidi[oldIdx];
    var newMidi = _hexMidi[newIdx];
    var oldCell = _hexCells[oldIdx];
    var newCell = _hexCells[newIdx];

    // Flush any pending legato release for this pointer before starting new note
    var timerKey = 'legato_' + pointerId;
    if (_legatoTimers[timerKey]) {
      clearTimeout(_legatoTimers[timerKey]);
      delete _legatoTimers[timerKey];
    }

    // Release the old note immediately to prevent note pileup
    if (_noteOffFn) {
      _noteOffFn(oldMidi);
    }
    oldCell.classList.remove('tonnetz-active');
    oldCell.style.transform = '';

    if (_noteOnFn) {
      var velocity = pointerEvent ? SL.velocityFromPressure(pointerEvent, DEFAULT_VELOCITY) : DEFAULT_VELOCITY;
      _noteOnFn(newMidi, velocity);
    }
    newCell.classList.add('tonnetz-active');
    newCell.style.transform = 'scale(' + ACTIVE_SCALE_FACTOR + ')';

    _clearTriangles();
    _showTriangles(newIdx);
  }

  // ============================================================
  // Triangle overlays
  // ============================================================

  function _showTriangles(idx) {
    _clearTriangles();
    if (_gridEl) {
    var cr = _colRowFromIndex(idx);
    var col = cr.col;
    var row = cr.row;

    // Upward triangle: this + right neighbor + upper-right neighbor
    var hasRight = (col + 1) < _cols;
    var hasUpperRight = (row + 1) < _rows;
    if (hasRight && hasUpperRight) {
      var idxRight = _cellIndex(col + 1, row);
      var idxUpperRight = _cellIndex(col, row + 1);
      _drawTriangleOverlay(idx, idxRight, idxUpperRight, MAJOR_TRIANGLE_COLOR);
    }

    // Downward triangle: this + left neighbor + lower-left neighbor
    var hasLeft = (col - 1) >= 0;
    var hasLowerLeft = (row - 1) >= 0;
    if (hasLeft && hasLowerLeft) {
      var idxLeft = _cellIndex(col - 1, row);
      var idxLowerLeft = _cellIndex(col, row - 1);
      _drawTriangleOverlay(idx, idxLeft, idxLowerLeft, MINOR_TRIANGLE_COLOR);
    }
    } // end if (_gridEl)
  }

  function _drawTriangleOverlay(idx0, idx1, idx2, color) {
    if (_gridEl) {
    var gridRect = _gridEl.getBoundingClientRect();
    var c0 = _hexCenters[idx0];
    var c1 = _hexCenters[idx1];
    var c2 = _hexCenters[idx2];
    var allValid = (c0 !== undefined) && (c1 !== undefined) && (c2 !== undefined);
    if (allValid) {
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'tonnetz-triangle-overlay');
      svg.style.position = 'absolute';
      svg.style.left = '0';
      svg.style.top = '0';
      svg.style.width = '100%';
      svg.style.height = '100%';
      svg.style.pointerEvents = 'none';
      svg.style.zIndex = '5';

      var poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      var gx = gridRect.left;
      var gy = gridRect.top;
      var p0x = c0.x - gx;
      var p0y = c0.y - gy;
      var p1x = c1.x - gx;
      var p1y = c1.y - gy;
      var p2x = c2.x - gx;
      var p2y = c2.y - gy;
      var points = p0x + ',' + p0y + ' ' + p1x + ',' + p1y + ' ' + p2x + ',' + p2y;
      poly.setAttribute('points', points);
      poly.setAttribute('fill', color);
      poly.setAttribute('stroke', 'none');

      svg.appendChild(poly);
      _gridEl.appendChild(svg);
      _triangleOverlays.push(svg);
    }
    } // end if (_gridEl)
  }

  function _clearTriangles() {
    var i;
    for (i = 0; i < _triangleOverlays.length; i++) {
      var overlay = _triangleOverlays[i];
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    }
    _triangleOverlays = [];
  }

  // ============================================================
  // Pointer / touch events
  // ============================================================

  function _onPointerDown(e) {
    e.preventDefault();
    var activeCount = Object.keys(_activePointers).length;
    var isAtLimit = (activeCount >= MAX_SIMULTANEOUS_TOUCHES);
    if (!isAtLimit) {
      var pid = e.pointerId !== undefined ? e.pointerId : 'mouse';
      var idx = _findCellAtPoint(e.clientX, e.clientY);
      if (idx >= 0) {
        _activePointers[pid] = idx;
        _activateCell(idx, e);
      }
    }
  }

  function _onPointerMove(e) {
    e.preventDefault();
    var pid = e.pointerId !== undefined ? e.pointerId : 'mouse';
    var hasPointer = _activePointers.hasOwnProperty(pid);
    if (hasPointer) {
      var oldIdx = _activePointers[pid];
      var newIdx = _findCellAtPoint(e.clientX, e.clientY);
      if (newIdx >= 0) {
        var isSameCell = (newIdx === oldIdx);
        if (!isSameCell) {
          _activePointers[pid] = newIdx;
          _switchCell(oldIdx, newIdx, pid, e);
        }
      }
    }
  }

  function _onPointerUp(e) {
    e.preventDefault();
    var pid = e.pointerId !== undefined ? e.pointerId : 'mouse';
    var hasPointer = _activePointers.hasOwnProperty(pid);
    if (hasPointer) {
      var idx = _activePointers[pid];
      delete _activePointers[pid];
      _deactivateCell(idx);
    }
  }

  function _onPointerCancel(e) {
    _onPointerUp(e);
  }

  // ============================================================
  // Recalculate hex centers from DOM
  // ============================================================

  function _updateHexCenters() {
    _hexCenters = [];
    var i;
    for (i = 0; i < _hexCells.length; i++) {
      var rect = _hexCells[i].getBoundingClientRect();
      _hexCenters.push({
        x: rect.left + (rect.width / 2),
        y: rect.top + (rect.height / 2)
      });
    }
  }

  // ============================================================
  // Build
  // ============================================================

  function _buildTonnetzController(container, opts) {
    _container = container;
    _noteOnFn = opts.noteOn;
    _noteOffFn = opts.noteOff;

    var baseOctave = opts.baseOctave || 3;
    if (baseOctave < MIN_BASE_OCTAVE) { baseOctave = MIN_BASE_OCTAVE; }
    _rootPc = (SL.screenPlay && SL.screenPlay.getRootPc) ? SL.screenPlay.getRootPc() : 0;
    _baseMidi = (baseOctave * SEMITONES_PER_OCTAVE) + _rootPc;

    var containerW = container.clientWidth || 800;
    var containerH = container.clientHeight || 500;
    var isPhone = (containerW < PHONE_WIDTH_THRESHOLD);

    // Compute hex sizes using same pointy-top geometry as the hex grid (isogrid):
    //   hexWidth = size * sqrt(3), hexHeight = size * 2
    //   verticalSpacing = hexHeight * 3/4
    //   odd rows offset right by hexWidth / 2
    var availW = containerW;
    var availH = containerH - TOPBAR_HEIGHT_PX;
    var minHexWidth = isPhone ? HEX_MIN_SIZE_PHONE : HEX_MIN_SIZE_DESKTOP;
    // Odd rows are offset right by hexWidth/2, so the widest row spans
    // cols * hexWidth + hexWidth/2 = hexWidth * (cols + 0.5).
    // Therefore hexWidth <= availW / (cols + 0.5).
    // Solve for cols at minimum hex size:
    //   minHexWidth * (cols + 0.5) <= availW
    //   cols <= (availW / minHexWidth) - 0.5
    _cols = Math.floor((availW / minHexWidth) - 0.5);
    if (_cols < 3) { _cols = 3; }
    // Compute hexWidth to guarantee odd-row rightmost hex fits:
    //   hexWidth * (cols + 0.5) <= availW
    _hexW = Math.floor((2 * availW) / (2 * _cols + 1));
    if (_hexW < minHexWidth) { _hexW = minHexWidth; }
    if (_hexW > HEX_MAX_WIDTH) { _hexW = HEX_MAX_WIDTH; }
    var hexSize = _hexW / HEX_SQRT3;
    _hexH = Math.floor(hexSize * 2);
    // Cap hex height so at least MIN_ROW_COUNT rows fit in available space
    // verticalSpacing = hexH * 0.75; rows need: hexH + (rows-1)*verticalSpacing <= availH
    // => hexH + (MIN_ROW_COUNT-1)*hexH*0.75 <= availH
    // => hexH * (1 + (MIN_ROW_COUNT-1)*0.75) <= availH
    var maxHexH = Math.floor(availH / (1 + (MIN_ROW_COUNT - 1) * 0.75));
    if (_hexH > maxHexH) {
      _hexH = maxHexH;
    }
    var verticalSpacing = Math.floor(_hexH * 0.75);
    // Compute rows to fill available height
    _rows = Math.floor((availH - _hexH) / verticalSpacing) + 1;
    if (_rows < MIN_ROW_COUNT) { _rows = MIN_ROW_COUNT; }

    var fontSize = isPhone ? FONT_SIZE_PHONE : FONT_SIZE_DESKTOP;

    // Wrapper
    var wrapper = document.createElement('div');
    wrapper.className = 'tonnetz-wrapper';

    // Top bar
    var topbar = document.createElement('div');
    topbar.className = 'tonnetz-topbar';

    // Root is now controlled by the global topbar (no local duplicate).

    // Layout selector
    var layoutLabel = document.createElement('span');
    layoutLabel.className = 'tonnetz-topbar-label';
    layoutLabel.textContent = SL.t('tonnetz.layout_label');

    var layoutSelect = document.createElement('select');
    layoutSelect.className = 'tonnetz-select';
    var li;
    for (li = 0; li < TONNETZ_LAYOUTS.length; li++) {
      var lOpt = document.createElement('option');
      lOpt.value = TONNETZ_LAYOUTS[li].val;
      lOpt.textContent = TONNETZ_LAYOUTS[li].lbl;
      layoutSelect.appendChild(lOpt);
    }
    layoutSelect.addEventListener('change', function() {
      var selVal = layoutSelect.value;
      var lIdx;
      for (lIdx = 0; lIdx < TONNETZ_LAYOUTS.length; lIdx++) {
        if (TONNETZ_LAYOUTS[lIdx].val === selVal) {
          FIFTH_INTERVAL = TONNETZ_LAYOUTS[lIdx].colInterval;
          MAJOR_THIRD_INTERVAL = TONNETZ_LAYOUTS[lIdx].rowInterval;
          break;
        }
      }
      _rebuildGrid(wrapper, fontSize);
    });

    var title = document.createElement('span');
    title.className = 'tonnetz-title';
    title.textContent = SL.t('tonnetz.title');

    topbar.appendChild(layoutLabel);
    topbar.appendChild(layoutSelect);
    topbar.appendChild(title);
    wrapper.appendChild(topbar);

    // Grid area
    _gridEl = document.createElement('div');
    _gridEl.className = 'tonnetz-grid';
    _gridEl.style.touchAction = 'none';
    wrapper.appendChild(_gridEl);

    _buildHexCells(_gridEl, fontSize);

    // Pointer events on grid
    _gridEl.addEventListener('pointerdown', _onPointerDown);
    _gridEl.addEventListener('pointermove', _onPointerMove);
    _gridEl.addEventListener('pointerup', _onPointerUp);
    _gridEl.addEventListener('pointercancel', _onPointerCancel);
    _gridEl.addEventListener('pointerleave', _onPointerUp);

    container.appendChild(wrapper);

    // Compute centers after layout
    requestAnimationFrame(function() {
      _updateHexCenters();
    });
  }

  function _buildHexCells(gridEl, fontSize) {
    _hexCells = [];
    _hexMidi = [];
    _hexCenters = [];
    gridEl.innerHTML = '';

    // Use absolute positioning with same pointy-top geometry as hex grid (isogrid)
    gridEl.style.position = 'relative';

    var verticalSpacing = Math.floor(_hexH * 0.75);
    var halfHexOffset = Math.floor(_hexW / 2);

    var rowIdx;
    for (rowIdx = 0; rowIdx < _rows; rowIdx++) {
      var visualRow = _rows - 1 - rowIdx;
      var isOddRow = (visualRow % 2 === 1);
      var offsetX = isOddRow ? halfHexOffset : 0;
      var topPos = rowIdx * verticalSpacing;

      var colIdx;
      for (colIdx = 0; colIdx < _cols; colIdx++) {
        var midi = _midiForCell(colIdx, visualRow);
        var pc = midi % SEMITONES_PER_OCTAVE;
        var oct = Math.floor(midi / SEMITONES_PER_OCTAVE) - 1;
        var noteNames = SL.notesForKey ? SL.notesForKey(_rootPc) : NOTES;
        var noteName = noteNames[pc];
        var isRoot = (pc === _rootPc);

        var cellEl = document.createElement('div');
        cellEl.className = 'tonnetz-hex' + (isRoot ? ' tonnetz-root' : '');
        cellEl.setAttribute('data-midi', String(midi));
        cellEl.setAttribute('data-col', String(colIdx));
        cellEl.setAttribute('data-row', String(visualRow));

        var leftPos = colIdx * _hexW + offsetX;
        cellEl.style.position = 'absolute';
        cellEl.style.left = leftPos + 'px';
        cellEl.style.top = topPos + 'px';
        cellEl.style.width = _hexW + 'px';
        cellEl.style.height = _hexH + 'px';
        cellEl.style.clipPath = HEX_CLIP_PATH;
        cellEl.style.webkitClipPath = HEX_CLIP_PATH;

        // Pitch-class CSS class (matches hex grid pattern)
        cellEl.classList.add('pc-' + pc);

        var label = document.createElement('span');
        label.className = 'tonnetz-hex-label';
        label.style.fontSize = fontSize + 'px';
        label.textContent = noteName + oct;

        cellEl.appendChild(label);
        gridEl.appendChild(cellEl);

        var cellIndexVal = _cellIndex(colIdx, visualRow);
        while (_hexCells.length <= cellIndexVal) {
          _hexCells.push(null);
          _hexMidi.push(0);
        }
        _hexCells[cellIndexVal] = cellEl;
        _hexMidi[cellIndexVal] = midi;
      }
    }
  }

  function _rebuildGrid(wrapper, fontSize) {
    if (_gridEl) {
      _releaseAll();
      _buildHexCells(_gridEl, fontSize);
      requestAnimationFrame(function() {
        _updateHexCenters();
      });
    }
  }

  // ============================================================
  // Release / cleanup
  // ============================================================

  function _releaseAll() {
    var pids = Object.keys(_activePointers);
    var i;
    for (i = 0; i < pids.length; i++) {
      var idx = _activePointers[pids[i]];
      var isValidTonnetzIdx = (idx >= 0) && (idx < _hexCells.length);
      var hasTonnetzCell = isValidTonnetzIdx && (_hexCells[idx]);
      if (hasTonnetzCell) {
        if (_noteOffFn) {
          _noteOffFn(_hexMidi[idx]);
        }
        _hexCells[idx].classList.remove('tonnetz-active');
        _hexCells[idx].style.transform = '';
      }
    }
    _activePointers = {};

    var timerKeys = Object.keys(_legatoTimers);
    var t;
    for (t = 0; t < timerKeys.length; t++) {
      clearTimeout(_legatoTimers[timerKeys[t]]);
    }
    _legatoTimers = {};

    _clearTriangles();
  }

  // ============================================================
  // Register — Tonnetz is now an alias for the unified hex controller
  // The standalone implementation above is retained but inactive.
  // ============================================================

  if (!SL.controllers) { SL.controllers = {}; }

  // Backward compatibility: tonnetz points to the unified hex controller
  // (which includes Tonnetz as a layout preset with root selector,
  // triangle overlays, and multi-touch pointer events)
  SL.controllers.tonnetz = SL.controllers.hex;

  // ============================================================
  // Panic hook (tonnetz)
  // ============================================================

  if (SL.PanicRegistry && SL.PanicRegistry.register) {
    SL.PanicRegistry.register(
      'voices',
      'tonnetz.notes',
      function() { _releaseAll(); },
      function() {
        var ids = Object.keys(_activePointers);
        var activeCount = ids.length;
        var status = null;
        if (activeCount > 0) {
          status = activeCount + ' active';
        }
        return status;
      }
    );
  }

})();
