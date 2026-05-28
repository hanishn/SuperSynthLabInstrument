// SSLI Controller: Tonnetz Grid (harmonic hexagonal lattice)
// ES5 compatible (var, no arrow functions, no template literals)
//
// -----------------------------------------------------------------------
// TONNETZ (German: "tone network")
//
// The Tonnetz is a 2D pitch lattice where:
//   - Horizontal axis = perfect 5ths (C -> G -> D -> A -> E ...)
//   - One diagonal axis = major 3rds (C -> E -> G# -> C ...)
//   - Other diagonal axis = minor 3rds (C -> Eb -> Gb -> A ...)
//
// Any triangle of 3 adjacent nodes forms a triad:
//   - Upward-pointing triangles = major triads
//   - Downward-pointing triangles = minor triads
//
// Chord transformations become geometric moves (neo-Riemannian theory):
//   P (parallel): C major <-> C minor (flip the 3rd)
//   R (relative): C major <-> A minor (relative minor/major)
//   L (leading-tone): C major <-> E minor
//
// History: Euler first drew this lattice in 1739 (Tentamen novae
// theoriae musicae). Hugo Riemann revived it in the 1880s for
// harmonic analysis. Richard Cohn formalized the neo-Riemannian
// operations in 1998 ("Neo-Riemannian Operations, Parsimonious
// Trichords, and Their Tonnetz Representations", J. Music Theory).
//
// References:
//   Euler, L. (1739) Tentamen novae theoriae musicae
//   Cohn, R. (1998) J. Music Theory 42(1)
//   Tymoczko, D. (2011) A Geometry of Music, Oxford University Press
//
// NOTE: This standalone implementation is retained for backward
// compatibility. The Tonnetz is now a layout preset within the
// unified hex controller (ssli-ctrl-isogrid.js).
// -----------------------------------------------------------------------

(function() {
  'use strict';

  var SL = window.SynthLab;
  var NOTES = SL.NOTES;

  // ============================================================
  // Constants
  // ============================================================

  var SEMITONES_PER_OCTAVE = 12;

  // Tonnetz axis intervals (semitones) -- the three intervals that define
  // the lattice. P5 (7 semitones) along the horizontal, M3 (4) and m3 (3)
  // along the two diagonals. Note that M3 + m3 = P5, which is why the
  // three axes are geometrically consistent (they close the triangle).
  var FIFTH_INTERVAL = 7;
  var MAJOR_THIRD_INTERVAL = 4;
  var MINOR_THIRD_INTERVAL = 3;

  // ----------------------------------------------------------------
  // Layout presets. Each maps different intervals onto the hex axes:
  //   Tonnetz: col=P5, row=M3 (Euler's original lattice)
  //   Wicki-Hayden: col=whole step, row=P5 (diatonic runs are rows)
  //   Harmonic Table: same intervals as Tonnetz (col=P5, row=M3)
  //   Janko: col=semitone, row=whole step (piano-like, isomorphic)
  //   Park: col=semitone, row=minor 3rd (diminished columns)
  // ----------------------------------------------------------------
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

  // Hex geometry constant. sqrt(3) appears throughout pointy-top hex math
  // because the width of a regular hexagon = circumradius * sqrt(3).
  var HEX_SQRT3 = 1.7320508;

  // Hex cell minimum width (px) — actual sizes computed to fill the container
  var HEX_MIN_SIZE_DESKTOP = 90;
  var HEX_MIN_SIZE_PHONE = 66;
  var HEX_MAX_WIDTH = 120;
  var MIN_ROW_COUNT = 4;

  // Hex clip-path for CSS. The 6 vertices of a pointy-top hexagon at
  // (50%,0%), (100%,25%), (100%,75%), (50%,100%), (0%,75%), (0%,25%)
  // form the characteristic honeycomb shape. Applied via both clipPath
  // and webkitClipPath for Safari compatibility.
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

  // Pitch-class coloring: each of the 12 pitch classes gets a unique hue
  // on the color wheel (30-degree increments). This lets the player see
  // interval patterns at a glance -- notes a 5th apart are 210 degrees
  // apart in hue, while octave equivalents share the same color.
  var PC_HUES = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
  var PC_TINT_OPACITY = 0.15;

  // Triangle overlay colors. On the Tonnetz, every triad is a triangle:
  // upward-pointing = major (cyan), downward-pointing = minor (pink).
  // This is the central visual insight of neo-Riemannian theory.
  var MAJOR_TRIANGLE_COLOR = 'rgba(76, 201, 240, 0.18)';
  var MINOR_TRIANGLE_COLOR = 'rgba(240, 100, 180, 0.18)';

  // ============================================================
  // Module state
  // ============================================================
  //
  // All state is module-scoped (closure variables) rather than
  // instance-based, because only one Tonnetz controller is active
  // at a time. This avoids `this` binding issues in event handlers.

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

  // The Tonnetz MIDI formula: base + (col * colInterval) + (row * rowInterval).
  // With default Tonnetz intervals: moving one column right = +7 semitones (P5),
  // moving one row up = +4 semitones (M3). This linear mapping makes the
  // lattice isomorphic: the same geometric shape always produces the same chord.
  function _midiForCell(col, row) {
    return _baseMidi + (col * FIFTH_INTERVAL) + (row * MAJOR_THIRD_INTERVAL);
  }

  function _cellIndex(col, row) {
    return row * _cols + col;
  }

  // Nearest-cell hit detection. Uses squared distance (no sqrt) for
  // performance. The hit radius is 55% of hex width -- generous enough
  // for finger-sized touch targets but tight enough to avoid ambiguity.
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
    var safeCols = _cols || 1;
    var row = Math.floor(idx / safeCols);
    var col = idx % safeCols;
    return { col: col, row: row };
  }

  // ============================================================
  // Note management
  // ============================================================
  //
  // Cell activation triggers a MIDI noteOn and visual feedback
  // (scale transform + CSS class). Triangle overlays are shown to
  // visualize the triadic context of the active note on the Tonnetz.

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

  // Drag glissando: when a finger slides from one hex to another, the old
  // note is released immediately and the new note triggered. The old-before-new
  // ordering prevents polyphonic pileup on monophonic presets.
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
  //
  // SVG triangles drawn between hex centers to visualize triadic
  // relationships. On the Tonnetz (Euler 1739, Cohn 1998):
  //   - Upward triangle connects root + col+1 (P5) + row+1 (M3)
  //     = major triad (e.g., C-E-G)
  //   - Downward triangle connects root + col-1 + row-1
  //     = minor triad (e.g., C-Eb-Ab)
  // The SVG is overlaid with pointer-events:none so it does not
  // interfere with touch input on the hex cells beneath.

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
  //
  // Up to MAX_SIMULTANEOUS_TOUCHES (10) independent pointers, each
  // tracking its own hex cell. The Pointer Events API provides unique
  // pointerId values that persist across down/move/up, enabling true
  // polyphonic multi-touch -- essential for playing chords on the
  // Tonnetz by pressing multiple hex cells simultaneously.

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
  //
  // Hex centers are computed from live DOM bounding rects after layout.
  // This must run inside requestAnimationFrame to ensure the browser
  // has completed the layout pass. These centers drive both hit
  // detection (finding which cell a touch landed on) and triangle
  // overlay rendering (SVG polygon vertices).

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
  //
  // Constructs the Tonnetz hex grid: top bar with layout/root
  // selectors, then a grid of pointy-top hexagonal cells. Each cell
  // is absolutely positioned using the hex geometry formulas:
  //   left = col * hexWidth + (oddRow ? hexWidth/2 : 0)
  //   top  = row * (hexHeight * 0.75)
  // The 0.75 vertical spacing is what makes pointy-top hexes
  // tessellate without gaps.

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

    // Pointy-top hex geometry (same as isogrid). For circumradius s:
    //   hexWidth  = s * sqrt(3)   (distance between parallel flat edges)
    //   hexHeight = s * 2         (distance between top and bottom vertices)
    //   verticalSpacing = hexHeight * 3/4  (rows interlock at the widest point)
    //   odd rows offset right by hexWidth / 2  (honeycomb tessellation)
    var availW = containerW;
    var availH = containerH - TOPBAR_HEIGHT_PX;
    var minHexWidth = isPhone ? HEX_MIN_SIZE_PHONE : HEX_MIN_SIZE_DESKTOP;
    // Odd rows are offset right by hexWidth/2, so the widest row spans
    // cols * hexWidth + hexWidth/2 = hexWidth * (cols + 0.5).
    // Therefore hexWidth <= availW / (cols + 0.5).
    // Solve for cols at minimum hex size:
    //   minHexWidth * (cols + 0.5) <= availW
    //   cols <= (availW / minHexWidth) - 0.5
    var safeMinHexWidth = minHexWidth || 1;
    _cols = Math.floor((availW / safeMinHexWidth) - 0.5);
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
    var safeVerticalSpacing = verticalSpacing || 1;
    _rows = Math.floor((availH - _hexH) / safeVerticalSpacing) + 1;
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

    // Absolute positioning with pointy-top hex geometry. The vertical
    // spacing of 3/4 height comes from the geometry: a pointy-top hex's
    // midline is at 1/4 and 3/4 of its height, so rows interlock at
    // 3/4 intervals. Odd rows are offset horizontally by half a hex width
    // to create the honeycomb tessellation pattern.
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
  // Release / cleanup (panic)
  // ============================================================
  //
  // Releases all active notes, clears pointer tracking, cancels
  // legato timers, and removes triangle overlays. Called on panic
  // (stuck-note recovery) and before grid rebuild to prevent orphaned
  // audio or visual state.

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
  // Register -- Tonnetz is now an alias for the unified hex controller.
  // The standalone implementation above is retained for backward
  // compatibility but the actual controller is the hex grid from
  // ssli-ctrl-isogrid.js, which includes Tonnetz as a layout preset.
  // ============================================================

  if (!SL.controllers) { SL.controllers = {}; }

  // Backward compatibility: tonnetz points to the unified hex controller
  // (which includes Tonnetz as a layout preset with root selector,
  // triangle overlays, and multi-touch pointer events)
  SL.controllers.tonnetz = SL.controllers.hex;

  // ============================================================
  // Panic hook (tonnetz) -- registered with the global PanicRegistry
  // so the "all notes off" button releases any stuck Tonnetz notes.
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
