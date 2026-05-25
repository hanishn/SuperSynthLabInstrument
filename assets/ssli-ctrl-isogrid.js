// SSLI Controller: Isomorphic Grid (4th, 5th) + Hex Grid (Wicki-Hayden)
// ES5 compatible (var, no arrow functions, no template literals)

(function() {
  'use strict';

  var SL = window.SynthLab;
  var NOTES = SL.NOTES;

  // ============================================================
  // Constants
  // ============================================================

  var ISO_DEFAULT_INTERVAL = 5;
  var ISOGRID_DEFAULT_VELOCITY = 100;

  var NO_NODE = null;

  var DEFAULT_CONTAINER_WIDTH = 800;
  var DEFAULT_CONTAINER_HEIGHT = 300;
  var GRID_GAP = 3;
  var SEMITONES_PER_OCTAVE = 12;
  var MIDI_MAX = 127;
  var MAX_BEND_CENTS = 200;
  var CENTS_PER_SEMITONE = 100;

  // Chromatic 12-col layout constants
  var CHROMATIC_FIXED_COLS = 12;
  var CHROMATIC_ROW_INTERVAL = 12;

  // V-06: Colorblind-safe pitch class colors (index = pitch class 0..11)
  var CHROMATIC_NOTE_COLORS = [
    '#3080c0', '#606080', '#d08030', '#505070', '#c0a020',
    '#d08030', '#505070', '#3080c0', '#505070', '#8040c0',
    '#505070', '#6060a0'
  ];

  // Hex grid constants
  var HEX_SQRT3 = 1.7320508;
  var HEX_MIN_SIZE_DESKTOP = 90;
  var HEX_MIN_SIZE_PHONE = 66;
  var PHONE_WIDTH_THRESHOLD = 600;

  // Hex edge/vertex hold zone thresholds (pointy-top geometry)
  var HEX_CENTER_ZONE_FRAC = 0.50;   // touch within 50% of radius = single note
  var HEX_EDGE_ZONE_FRAC = 0.85;     // touch between 50-85% = edge (2 notes)
  var HEX_VERTEX_RADIUS_PX = 18;     // touch within 18px of vertex = vertex (3 notes)
  var HEX_VERTEX_COUNT = 6;          // pointy-top hex has 6 vertices
  var HEX_ANGLE_OFFSET_RAD = 0.5236; // pi/6 = 30 degrees for pointy-top vertex angles
  var TWO_PI = 6.2831853;            // 2 * pi

  // Hex max width cap
  var HEX_MAX_WIDTH = 120;
  var MIN_HEX_ROW_COUNT = 4;

  // Multi-touch pointer event constants
  var MAX_SIMULTANEOUS_POINTERS = 10;
  var POINTER_HIT_RADIUS_FACTOR = 0.55;

  // Hex active cell visual
  var ACTIVE_SCALE_FACTOR = 1.05;
  var DEFAULT_NOTE_VELOCITY = 100;

  // Triangle harmonic overlay colors
  var MAJOR_TRIANGLE_COLOR = 'rgba(76, 201, 240, 0.18)';
  var MINOR_TRIANGLE_COLOR = 'rgba(240, 100, 180, 0.18)';

  // Monotonic triangle ID counter for orphan detection
  var _triangleIdCounter = 0;

  // Top bar height for hex grid
  var HEX_TOPBAR_HEIGHT_PX = 28;

  // Hex font sizes
  var HEX_FONT_SIZE_DESKTOP = 16;
  var HEX_FONT_SIZE_PHONE = 13;

  // Rectangular grid constants
  var RECT_MIN_CELL_SIZE = 66;
  var RECT_PHONE_MAX_COLS = 5;
  var RECT_DESKTOP_COLS = 7;
  var RECT_DEFAULT_ROWS = 4;
  var RECT_FONT_MIN = 12;
  var RECT_OCTAVE_FONT_SCALE = 1.4;

  // Wicki-Hayden intervals
  var WICKI_HAYDEN_ROW_INTERVAL = 7;
  var WICKI_HAYDEN_COL_INTERVAL = 2;

  // Layout presets for isomorphic keyboards
  var ISO_LAYOUT_PRESETS = [
    { val: 'chromatic-12',  lbl: 'Chromatic (12-col)', rowInterval: CHROMATIC_ROW_INTERVAL, colInterval: 1, hex: false, fixedCols: CHROMATIC_FIXED_COLS, chromatic: true },
    { val: 'chromatic',     lbl: 'Chromatic',     rowInterval: 6, colInterval: 1, hex: false },
    { val: 'fourths',       lbl: 'Fourths',       rowInterval: 1, colInterval: 5, hex: false },
    { val: 'fifths',        lbl: 'Fifths',        rowInterval: 7, colInterval: 1, hex: false },
    { val: 'wholetone',     lbl: 'Whole Tone',    rowInterval: 2, colInterval: 1, hex: false },
    { val: 'minor-thirds',  lbl: 'Minor 3rds',    rowInterval: 3, colInterval: 1, hex: false }
  ];

  var HEX_LAYOUT_PRESETS = [
    { val: 'wicki-hayden',  lbl: 'Wicki-Hayden',   rowInterval: 7, colInterval: 2 },
    { val: 'harmonic',      lbl: 'Harmonic Table',  rowInterval: 4, colInterval: 7 },
    { val: 'tonnetz',       lbl: 'Tonnetz',         rowInterval: 3, colInterval: 4 },
    { val: 'janko',         lbl: 'Jankó',      rowInterval: 2, colInterval: 1 },
    { val: 'park',          lbl: 'Park',             rowInterval: 3, colInterval: 1 },
    { val: 'gerhard',       lbl: 'Gerhard',          rowInterval: 5, colInterval: 2 }
  ];

  // Module state for rebuild
  var _currentContainer = null;
  var _currentOpts = null;
  var _currentMode = 'rect';
  var _currentRectInterval = ISO_DEFAULT_INTERVAL;
  var _currentRectPreset = null;
  var _currentHexRowInterval = WICKI_HAYDEN_ROW_INTERVAL;
  var _currentHexColInterval = WICKI_HAYDEN_COL_INTERVAL;

  // ============================================================
  // Hex cell registry for edge/vertex detection
  // ============================================================

  // Stores all hex cells: array of { cx, cy, midi, el, row, col }
  var _hexCells = [];
  // Current hex geometry for hit-testing
  var _hexGridGeom = { hexWidth: 0, hexHeight: 0, hexSize: 0 };
  // Currently active MIDI notes from hex hold (keyed by midi number, value = refcount)
  var _hexActiveNotes = {};

  // Root note pitch class for hex grid (0 = C, default)
  var _hexRootPc = 0;
  // Hex grid DOM element (for triangle overlays and pointer events)
  var _hexGridEl = null;
  // Hex layout state for rebuild
  var _hexCurrentLayoutVal = 'wicki-hayden';
  // Cached base octave and base midi for hex rebuild
  var _hexBaseOctave = 3;
  var _hexBaseMidi = 48;
  // Hex cell data arrays for pointer-based multi-touch (indexed by cellIndex)
  var _hexPtrCells = [];
  var _hexPtrMidi = [];
  var _hexPtrCenters = [];
  var _hexPtrCols = 6;
  var _hexPtrRows = 4;
  // Active pointer map (pointerId -> cellIndex for single-cell tracking)
  var _activePointers = {};
  // Active pointer MIDI lists (pointerId -> array of midi notes from hit test)
  var _activePointerMidiLists = {};
  // Legato timers for pointer transitions
  var _legatoTimers = {};
  // Triangle overlay SVG elements (keyed by pointer ID, each value is an array of SVGs)
  var _triangleOverlays = {};
  // Hex noteOn/noteOff references for pointer events
  var _hexNoteOnFn = null;
  var _hexNoteOffFn = null;

  // Flag to ignore pointer events during layout rebuild
  var _isHexLayoutChanging = false;

  // Compute the 6 vertex positions of a pointy-top hex centered at (cx, cy).
  // Uses the actual hexWidth and hexHeight from grid geometry rather than
  // theoretical circular positions, so vertices are correct even when the
  // hex height has been capped (non-regular hex).
  //
  // Pointy-top vertex order (clockwise from top):
  //   0: top, 1: upper-right, 2: lower-right, 3: bottom, 4: lower-left, 5: upper-left
  function _hexVerticesActual(cx, cy) {
    var halfW = _hexGridGeom.hexWidth / 2;
    var halfH = _hexGridGeom.hexHeight / 2;
    var quarterH = _hexGridGeom.hexHeight / 4;
    var verts = [
      { x: cx,         y: cy - halfH },      // top
      { x: cx + halfW, y: cy - quarterH },    // upper-right
      { x: cx + halfW, y: cy + quarterH },    // lower-right
      { x: cx,         y: cy + halfH },       // bottom
      { x: cx - halfW, y: cy + quarterH },    // lower-left
      { x: cx - halfW, y: cy - quarterH }     // upper-left
    ];
    return verts;
  }

  // Distance squared between two points (avoids sqrt for comparisons)
  function _distSq(ax, ay, bx, by) {
    var dx = ax - bx;
    var dy = ay - by;
    return (dx * dx) + (dy * dy);
  }

  // Find the nearest hex cell to a point. Returns index into _hexCells or -1.
  function _findNearestHexCell(px, py) {
    var bestIdx = -1;
    var bestDistSq = Infinity;
    var hi;
    for (hi = 0; hi < _hexCells.length; hi++) {
      var dsq = _distSq(px, py, _hexCells[hi].cx, _hexCells[hi].cy);
      if (dsq < bestDistSq) {
        bestDistSq = dsq;
        bestIdx = hi;
      }
    }
    return bestIdx;
  }

  // Determine which MIDI notes should play for a touch at (px, py).
  // Returns an array of midi numbers (1 for center, 2 for edge, 2-3 for vertex).
  function _hexHitTest(px, py) {
    var nearestIdx = _findNearestHexCell(px, py);
    if (nearestIdx < 0) {
      return [];
    }

    var cell = _hexCells[nearestIdx];
    // Use the smaller of half-width and half-height as effective radius for zone
    // thresholds. This is correct even when hexHeight has been capped (non-regular hex).
    var effectiveRadius = Math.min(_hexGridGeom.hexWidth / 2, _hexGridGeom.hexHeight / 2);
    var distFromCenter = Math.sqrt(_distSq(px, py, cell.cx, cell.cy));

    // Check vertex zone first (highest priority, smallest target)
    var verts = _hexVerticesActual(cell.cx, cell.cy);
    var closestVertIdx = -1;
    var closestVertDistSq = Infinity;
    var vvi;
    for (vvi = 0; vvi < verts.length; vvi++) {
      var vdsq = _distSq(px, py, verts[vvi].x, verts[vvi].y);
      if (vdsq < closestVertDistSq) {
        closestVertDistSq = vdsq;
        closestVertIdx = vvi;
      }
    }

    var vertexThresholdSq = HEX_VERTEX_RADIUS_PX * HEX_VERTEX_RADIUS_PX;
    var isInVertexZone = (closestVertDistSq <= vertexThresholdSq);

    if (isInVertexZone) {
      // Vertex: find all hex cells that share this vertex point
      var vertX = verts[closestVertIdx].x;
      var vertY = verts[closestVertIdx].y;
      return _findCellsSharingVertex(vertX, vertY, effectiveRadius);
    }

    // Check if within center zone
    var centerThreshold = effectiveRadius * HEX_CENTER_ZONE_FRAC;
    var isInCenterZone = (distFromCenter <= centerThreshold);

    if (isInCenterZone) {
      return [cell.midi];
    }

    // Check if within edge zone (between center and edge boundary)
    var edgeThreshold = effectiveRadius * HEX_EDGE_ZONE_FRAC;
    var isInEdgeZone = (distFromCenter <= edgeThreshold);

    if (isInEdgeZone) {
      // Edge: find the second-nearest cell to the touch point
      return _findCellsSharingEdge(px, py, cell, effectiveRadius);
    }

    // Beyond edge zone but still closest to this cell -- treat as center
    return [cell.midi];
  }

  // Find all hex cells sharing a vertex at (vx, vy).
  // A vertex is shared by up to 3 hexes. We find the 3 closest cells to the
  // vertex point, filtering by a maximum distance threshold to avoid picking
  // up far-away cells when the vertex is at the grid boundary.
  var VERTEX_MAX_CELLS = 3;
  function _findCellsSharingVertex(vx, vy, size) {
    // Collect distances for all cells
    var candidates = [];
    var hi;
    for (hi = 0; hi < _hexCells.length; hi++) {
      var dsq = _distSq(vx, vy, _hexCells[hi].cx, _hexCells[hi].cy);
      candidates.push({ idx: hi, dsq: dsq });
    }

    // Sort by distance (ascending)
    candidates.sort(function(a, b) { return a.dsq - b.dsq; });

    // Accept up to 3 closest cells, but only if within a generous threshold.
    // In a regular hex, vertex-to-center distance = size. With potential height
    // capping, use hexWidth as a more reliable bound (hexWidth >= size always).
    var hexW = _hexGridGeom.hexWidth;
    var maxVertexDistSq = hexW * hexW * 1.2;
    var results = [];
    var ci;
    for (ci = 0; ci < candidates.length; ci++) {
      var isWithinThreshold = (candidates[ci].dsq <= maxVertexDistSq);
      var isUnderLimit = (results.length < VERTEX_MAX_CELLS);
      if (isWithinThreshold && isUnderLimit) {
        results.push(_hexCells[candidates[ci].idx].midi);
      } else {
        break;
      }
    }
    return results;
  }

  // Find the neighbor cell across the closest edge to the touch point.
  // Returns [current midi, neighbor midi] or just [current midi] if no neighbor.
  //
  // Strategy: find the second-nearest hex cell to the touch point. If the touch
  // is in the edge zone, it is geometrically between the nearest and second-nearest
  // cells. This approach is robust to non-regular hex geometry (e.g. capped height)
  // and works correctly regardless of row parity in offset/Janko grids.
  function _findCellsSharingEdge(px, py, cell, size) {
    var nearestDsq = Infinity;
    var secondDsq = Infinity;
    var nearestIdx = -1;
    var secondIdx = -1;
    var hi;

    for (hi = 0; hi < _hexCells.length; hi++) {
      var dsq = _distSq(px, py, _hexCells[hi].cx, _hexCells[hi].cy);
      if (dsq < nearestDsq) {
        secondDsq = nearestDsq;
        secondIdx = nearestIdx;
        nearestDsq = dsq;
        nearestIdx = hi;
      } else if (dsq < secondDsq) {
        secondDsq = dsq;
        secondIdx = hi;
      }
    }

    // Validate that the second-nearest cell is a plausible neighbor.
    // In a hex grid, adjacent centers are at most hexWidth apart horizontally
    // or sqrt(hexWidth^2/4 + verticalSpacing^2) diagonally. Use a generous
    // threshold of 2x the horizontal spacing squared.
    var hexW = _hexGridGeom.hexWidth;
    var maxAdjacentDistSq = hexW * hexW * 2;
    var hasValidSecond = ((secondIdx >= 0) && (secondDsq <= maxAdjacentDistSq));

    if (hasValidSecond) {
      return [cell.midi, _hexCells[secondIdx].midi];
    }
    return [cell.midi];
  }

  // Activate a set of MIDI notes, tracking refcounts and glow
  function _hexActivateNotes(midiList, noteOn, grid) {
    var mi;
    for (mi = 0; mi < midiList.length; mi++) {
      var m = midiList[mi];
      if (!_hexActiveNotes[m]) {
        _hexActiveNotes[m] = 0;
        noteOn(m);
        var el = grid.querySelector('[data-midi="' + m + '"]');
        if (el) {
          el.classList.add('iso-glow');
        }
      }
      _hexActiveNotes[m] = _hexActiveNotes[m] + 1;
    }
  }

  // Deactivate a set of MIDI notes, tracking refcounts and glow
  function _hexDeactivateNotes(midiList, noteOff, grid) {
    var mi;
    for (mi = 0; mi < midiList.length; mi++) {
      var m = midiList[mi];
      if (_hexActiveNotes[m]) {
        _hexActiveNotes[m] = _hexActiveNotes[m] - 1;
        if (_hexActiveNotes[m] <= 0) {
          delete _hexActiveNotes[m];
          noteOff(m);
          var el = grid.querySelector('[data-midi="' + m + '"]');
          if (el) {
            el.classList.remove('iso-glow');
          }
        }
      }
    }
  }

  // Deactivate ALL currently active hex notes
  function _hexDeactivateAll(noteOff, grid) {
    var keys = Object.keys(_hexActiveNotes);
    var ki;
    for (ki = 0; ki < keys.length; ki++) {
      var m = Number(keys[ki]);
      noteOff(m);
      var el = grid.querySelector('[data-midi="' + m + '"]');
      if (el) {
        el.classList.remove('iso-glow');
      }
    }
    _hexActiveNotes = {};
  }

  // NOTE: Legacy _wireHexGridEvents (mouse/touch per-grid) was REMOVED.
  // It duplicated note activation without pointer-scoped triangle cleanup,
  // causing stray triangle overlays. All hex interaction is now handled
  // exclusively by the pointer event system (_hexOnPointerDown/Move/Up).

  // ============================================================
  // Shared event wiring
  // ============================================================

  function _wireIsoKeyEvents(midi, el, noteOn, noteOff) {
    (function(m, keyEl) {
      keyEl.addEventListener('mousedown', function(e) {
        e.preventDefault();
        var vel = SL.velocityFromPressure(e, ISOGRID_DEFAULT_VELOCITY);
        noteOn(m, vel);
        keyEl.classList.add('iso-glow');
      });
      keyEl.addEventListener('mouseup', function() {
        noteOff(m);
        keyEl.classList.remove('iso-glow');
      });
      keyEl.addEventListener('mouseleave', function(e) {
        keyEl.classList.remove('iso-glow');
        if (e.buttons === 0) {
          noteOff(m);
        }
      });
      keyEl.addEventListener('mouseenter', function(e) {
        if (e.buttons > 0) {
          var enterVel = SL.velocityFromPressure(e, ISOGRID_DEFAULT_VELOCITY);
          noteOn(m, enterVel);
          keyEl.classList.add('iso-glow');
        }
      });
      keyEl.addEventListener('touchstart', function(e) {
        e.preventDefault();
        var firstTouch = (e.changedTouches && e.changedTouches.length > 0) ? e.changedTouches[0] : null;
        var touchPressureEvt = firstTouch ? { pointerType: 'touch', pressure: firstTouch.force } : null;
        var touchVel = touchPressureEvt ? SL.velocityFromPressure(touchPressureEvt, ISOGRID_DEFAULT_VELOCITY) : ISOGRID_DEFAULT_VELOCITY;
        noteOn(m, touchVel);
        keyEl.classList.add('iso-glow');
      });
      keyEl.addEventListener('touchend', function(e) {
        e.preventDefault();
        noteOff(m);
        keyEl.classList.remove('iso-glow');
      });
    })(midi, el);
  }

  // ============================================================
  // Hex pointer-based multi-touch helpers (ported from tonnetz)
  // ============================================================

  function _hexPtrMidiForCell(col, row) {
    return _hexBaseMidi + (col * _currentHexColInterval) + (row * _currentHexRowInterval);
  }

  function _hexPtrCellIndex(col, row) {
    return row * _hexPtrCols + col;
  }

  function _hexPtrFindCellAtPoint(px, py) {
    var bestIdx = -1;
    var bestDistSq = Infinity;
    var maxRadiusSq = (_hexGridGeom.hexWidth * POINTER_HIT_RADIUS_FACTOR) * (_hexGridGeom.hexWidth * POINTER_HIT_RADIUS_FACTOR);
    var i;
    for (i = 0; i < _hexPtrCenters.length; i++) {
      if (!_hexPtrCenters[i]) { continue; }
      var cx = _hexPtrCenters[i].x;
      var cy = _hexPtrCenters[i].y;
      var dx = px - cx;
      var dy = py - cy;
      var dsq = (dx * dx) + (dy * dy);
      var isCloser = (dsq < bestDistSq);
      var isInRange = (dsq < maxRadiusSq);
      if (isCloser && isInRange) {
        bestDistSq = dsq;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  function _hexPtrColRowFromIndex(idx) {
    var row = Math.floor(idx / _hexPtrCols);
    var col = idx % _hexPtrCols;
    return { col: col, row: row };
  }

  // ============================================================
  // Hex pointer note activation (with triangle overlays)
  // ============================================================

  function _hexPtrActivateCell(idx, pointerId, pointerEvent) {
    if (!((idx < 0) || (idx >= _hexPtrCells.length))) {
      var midi = _hexPtrMidi[idx];
      var cell = _hexPtrCells[idx];
      if (cell !== NO_NODE) {
        if (_hexNoteOnFn) {
          var vel = pointerEvent ? SL.velocityFromPressure(pointerEvent, DEFAULT_NOTE_VELOCITY) : DEFAULT_NOTE_VELOCITY;
          _hexNoteOnFn(midi, vel);
        }
        cell.classList.add('hex-active');
        cell.classList.add('iso-glow');
        cell.style.transform = 'scale(' + ACTIVE_SCALE_FACTOR + ')';
        _hexShowTriangles(idx, pointerId);
      }
    }
  }

  function _hexPtrDeactivateCell(idx, pointerId) {
    if (!((idx < 0) || (idx >= _hexPtrCells.length))) {
      var midi = _hexPtrMidi[idx];
      var cell = _hexPtrCells[idx];
      if (cell !== NO_NODE) {
        if (_hexNoteOffFn) {
          _hexNoteOffFn(midi);
        }
        cell.classList.remove('hex-active');
        cell.classList.remove('iso-glow');
        cell.style.transform = '';
        _hexClearTriangles(pointerId);
      }
    }
  }

  function _hexPtrSwitchCell(oldIdx, newIdx, pointerId, pointerEvent) {
    var oldMidi = _hexPtrMidi[oldIdx];
    var oldCell = _hexPtrCells[oldIdx];
    var newMidi = _hexPtrMidi[newIdx];
    var newCell = _hexPtrCells[newIdx];

    // Flush any pending legato release for this pointer
    var timerKey = 'legato_' + pointerId;
    if (_legatoTimers[timerKey]) {
      clearTimeout(_legatoTimers[timerKey]);
      delete _legatoTimers[timerKey];
    }

    // Release old note immediately
    if (oldCell) {
      if (_hexNoteOffFn) {
        _hexNoteOffFn(oldMidi);
      }
      oldCell.classList.remove('hex-active');
      oldCell.classList.remove('iso-glow');
      oldCell.style.transform = '';
    }

    if (newCell) {
      if (_hexNoteOnFn) {
        var vel = pointerEvent ? SL.velocityFromPressure(pointerEvent, DEFAULT_NOTE_VELOCITY) : DEFAULT_NOTE_VELOCITY;
        _hexNoteOnFn(newMidi, vel);
      }
      newCell.classList.add('hex-active');
      newCell.classList.add('iso-glow');
      newCell.style.transform = 'scale(' + ACTIVE_SCALE_FACTOR + ')';
    }

    _hexClearTriangles(pointerId);
    _hexShowTriangles(newIdx, pointerId);
  }

  // ============================================================
  // Triangle harmonic overlays (ported from tonnetz)
  // ============================================================

  function _hexShowTriangles(idx, pointerId) {
    var pid = (pointerId !== undefined) ? pointerId : '_default';
    _hexClearTriangles(pid);
    if (_hexGridEl) {
    if (!_triangleOverlays[pid]) {
      _triangleOverlays[pid] = [];
    }
    var cr = _hexPtrColRowFromIndex(idx);
    var col = cr.col;
    var row = cr.row;

    // In a pointy-top hex grid with staggered rows, the neighbors differ
    // based on whether the row is even or odd.
    // Even row: upper-right = (col, row+1), upper-left = (col-1, row+1)
    // Odd row:  upper-right = (col+1, row+1), upper-left = (col, row+1)
    var isOddRow = (row % 2 === 1);
    var upperRightCol = isOddRow ? (col + 1) : col;
    var upperLeftCol = isOddRow ? col : (col - 1);
    var lowerRightCol = isOddRow ? (col + 1) : col;
    var lowerLeftCol = isOddRow ? col : (col - 1);

    // Upward triangle: this + right neighbor + upper-right neighbor
    var hasRight = ((col + 1) < _hexPtrCols);
    var hasUpperRight = ((upperRightCol >= 0) && (upperRightCol < _hexPtrCols) && ((row + 1) < _hexPtrRows));
    if (hasRight && hasUpperRight) {
      var idxRight = _hexPtrCellIndex(col + 1, row);
      var idxUpperRight = _hexPtrCellIndex(upperRightCol, row + 1);
      var upAllValid = (idx >= 0) && (idx < _hexPtrCells.length) && (_hexPtrCells[idx]) &&
                       (idxRight >= 0) && (idxRight < _hexPtrCells.length) && (_hexPtrCells[idxRight]) &&
                       (idxUpperRight >= 0) && (idxUpperRight < _hexPtrCells.length) && (_hexPtrCells[idxUpperRight]);
      if (upAllValid) {
        _hexDrawTriangleOverlay(idx, idxRight, idxUpperRight, MAJOR_TRIANGLE_COLOR, pid);
      }
    }

    // Downward triangle: this + left neighbor + lower-left neighbor
    var hasLeft = ((col - 1) >= 0);
    var hasLowerLeft = ((lowerLeftCol >= 0) && (lowerLeftCol < _hexPtrCols) && ((row - 1) >= 0));
    if (hasLeft && hasLowerLeft) {
      var idxLeft = _hexPtrCellIndex(col - 1, row);
      var idxLowerLeft = _hexPtrCellIndex(lowerLeftCol, row - 1);
      var downAllValid = (idx >= 0) && (idx < _hexPtrCells.length) && (_hexPtrCells[idx]) &&
                         (idxLeft >= 0) && (idxLeft < _hexPtrCells.length) && (_hexPtrCells[idxLeft]) &&
                         (idxLowerLeft >= 0) && (idxLowerLeft < _hexPtrCells.length) && (_hexPtrCells[idxLowerLeft]);
      if (downAllValid) {
        _hexDrawTriangleOverlay(idx, idxLeft, idxLowerLeft, MINOR_TRIANGLE_COLOR, pid);
      }
    }
    } // end if (_hexGridEl)
  }

  function _hexDrawTriangleOverlay(idx0, idx1, idx2, color, pointerId) {
    if (_hexGridEl) {
    var gridRect = _hexGridEl.getBoundingClientRect();
    var c0 = _hexPtrCenters[idx0];
    var c1 = _hexPtrCenters[idx1];
    var c2 = _hexPtrCenters[idx2];
    var allValid = (c0 !== undefined) && (c1 !== undefined) && (c2 !== undefined);
    if (allValid) {
      var gridW = _hexGridEl.offsetWidth || gridRect.width;
      var gridH = _hexGridEl.offsetHeight || gridRect.height;

      _triangleIdCounter = _triangleIdCounter + 1;
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'hex-triangle-overlay');
      svg.setAttribute('data-tri-id', String(_triangleIdCounter));
      svg.setAttribute('viewBox', '0 0 ' + gridW + ' ' + gridH);
      svg.style.position = 'absolute';
      svg.style.left = '0';
      svg.style.top = '0';
      svg.style.width = gridW + 'px';
      svg.style.height = gridH + 'px';
      svg.style.overflow = 'visible';
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
      poly.setAttribute('stroke', color.replace('0.18', '0.45'));
      poly.setAttribute('stroke-width', '1.5');

      svg.appendChild(poly);
      _hexGridEl.appendChild(svg);
      var pid = (pointerId !== undefined) ? pointerId : '_default';
      if (!_triangleOverlays[pid]) {
        _triangleOverlays[pid] = [];
      }
      _triangleOverlays[pid].push(svg);
    }
    } // end if (_hexGridEl)
  }

  function _hexClearTriangles(pointerId) {
    var pid = (pointerId !== undefined) ? pointerId : undefined;
    if (pid !== undefined) {
      // Clear only this pointer's triangles
      var arr = _triangleOverlays[pid];
      if (arr) {
        var i;
        for (i = 0; i < arr.length; i++) {
          var overlay = arr[i];
          if (overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
          }
        }
        delete _triangleOverlays[pid];
      }
    } else {
      // Clear ALL triangles (used by panic/release)
      var keys = Object.keys(_triangleOverlays);
      var ki;
      for (ki = 0; ki < keys.length; ki++) {
        var pidArr = _triangleOverlays[keys[ki]];
        var si;
        for (si = 0; si < pidArr.length; si++) {
          var svgEl = pidArr[si];
          if (svgEl.parentNode) {
            svgEl.parentNode.removeChild(svgEl);
          }
        }
      }
      _triangleOverlays = {};
    }
  }

  // ============================================================
  // Hex pointer event handlers (multi-touch, ported from tonnetz)
  // ============================================================

  // Convert pointer event to grid-relative coordinates for _hexHitTest
  function _hexPointerToGridCoords(e) {
    var result = { x: 0, y: 0, valid: false };
    if (_hexGridEl) {
      var rect = _hexGridEl.getBoundingClientRect();
      result.x = e.clientX - rect.left;
      result.y = e.clientY - rect.top;
      result.valid = true;
    }
    return result;
  }

  // Check if two MIDI arrays have the same contents (order-independent)
  function _midiListsEqual(listA, listB) {
    if (listA.length !== listB.length) {
      return false;
    }
    var isAllMatch = true;
    var ai;
    for (ai = 0; ai < listA.length; ai++) {
      var found = false;
      var bi;
      for (bi = 0; bi < listB.length; bi++) {
        if (listA[ai] === listB[bi]) {
          found = true;
          break;
        }
      }
      if (!found) {
        isAllMatch = false;
        break;
      }
    }
    return isAllMatch;
  }

  // Activate all MIDI notes in a list via pointer system (with glow + triangle)
  function _hexPtrActivateMidiList(midiList, pointerId, pointerEvent) {
    var mi;
    for (mi = 0; mi < midiList.length; mi++) {
      var m = midiList[mi];
      if (_hexNoteOnFn) {
        var vel = pointerEvent ? SL.velocityFromPressure(pointerEvent, DEFAULT_NOTE_VELOCITY) : DEFAULT_NOTE_VELOCITY;
        _hexNoteOnFn(m, vel);
      }
      // Find the cell element for this MIDI and add visual feedback
      var cellEl = _hexGridEl ? _hexGridEl.querySelector('[data-midi="' + m + '"]') : null;
      if (cellEl) {
        cellEl.classList.add('hex-active');
        cellEl.classList.add('iso-glow');
        cellEl.style.transform = 'scale(' + ACTIVE_SCALE_FACTOR + ')';
      }
    }
    // Show triangle for the primary (first) cell if present
    if (midiList.length > 0) {
      var primaryIdx = _hexPtrFindCellByMidi(midiList[0]);
      if (primaryIdx >= 0) {
        _hexShowTriangles(primaryIdx, pointerId);
      }
    }
  }

  // Deactivate all MIDI notes in a list via pointer system
  function _hexPtrDeactivateMidiList(midiList, pointerId) {
    var mi;
    for (mi = 0; mi < midiList.length; mi++) {
      var m = midiList[mi];
      if (_hexNoteOffFn) {
        _hexNoteOffFn(m);
      }
      var cellEl = _hexGridEl ? _hexGridEl.querySelector('[data-midi="' + m + '"]') : null;
      if (cellEl) {
        cellEl.classList.remove('hex-active');
        cellEl.classList.remove('iso-glow');
        cellEl.style.transform = '';
      }
    }
    _hexClearTriangles(pointerId);
  }

  // Find cell index in _hexPtrCells/_hexPtrMidi by MIDI number
  function _hexPtrFindCellByMidi(midi) {
    var idx = -1;
    var i;
    for (i = 0; i < _hexPtrMidi.length; i++) {
      if (_hexPtrMidi[i] === midi) {
        idx = i;
        break;
      }
    }
    return idx;
  }

  // Guard: check if pointer event target is a hex cell or the grid background itself.
  // Prevents topbar button clicks from triggering note activation / triangle overlays.
  var HEX_TARGET_WALK_LIMIT = 5;
  function _isHexCellTarget(el) {
    var node = el;
    var remaining = HEX_TARGET_WALK_LIMIT;
    var isNodeInGrid = node && node !== _hexGridEl;
    while (isNodeInGrid && remaining > 0) {
      if (node.classList && node.classList.contains('perf-iso-key')) {
        return true;
      }
      node = node.parentNode;
      remaining = remaining - 1;
    }
    return false;
  }

  function _hexOnPointerDown(e) {
    e.preventDefault();
    if (!_isHexLayoutChanging && _isHexCellTarget(e.target)) {
    var activeCount = Object.keys(_activePointers).length;
    var isAtLimit = (activeCount >= MAX_SIMULTANEOUS_POINTERS);
    if (!isAtLimit) {
      var pid = (e.pointerId !== undefined) ? e.pointerId : 'mouse';
      var coords = _hexPointerToGridCoords(e);
      if (coords.valid) {
        var midiList = _hexHitTest(coords.x, coords.y);
        if (midiList.length > 0) {
          // Also track primary cell index for legacy compat
          var primaryIdx = _hexPtrFindCellAtPoint(e.clientX, e.clientY);
          _activePointers[pid] = (primaryIdx >= 0) ? primaryIdx : 0;
          _activePointerMidiLists[pid] = midiList;
          _hexPtrActivateMidiList(midiList, pid, e);
        }
      }
    }
    } // end if (!_isHexLayoutChanging && _isHexCellTarget)
  }

  function _hexOnPointerMove(e) {
    e.preventDefault();
    if (!_isHexLayoutChanging) {
    var pid = (e.pointerId !== undefined) ? e.pointerId : 'mouse';
    var hasPointer = _activePointerMidiLists.hasOwnProperty(pid);
    var isOverCell = _isHexCellTarget(e.target);
    if ((!isOverCell) && hasPointer) {
      // Pointer slid off hex cells -- release all notes for this pointer
      var escapedMidiList = _activePointerMidiLists[pid];
      _hexPtrDeactivateMidiList(escapedMidiList, pid);
      delete _activePointerMidiLists[pid];
      delete _activePointers[pid];
    } else if (isOverCell && hasPointer) {
      var coords = _hexPointerToGridCoords(e);
      if (coords.valid) {
        var newMidiList = _hexHitTest(coords.x, coords.y);
        var oldMidiList = _activePointerMidiLists[pid];
        var isSame = _midiListsEqual(oldMidiList, newMidiList);
        if (!isSame && (newMidiList.length > 0)) {
          // Diff: deactivate notes no longer in list, activate new ones
          var toDeactivate = [];
          var toActivate = [];
          var di;
          var ai;

          for (di = 0; di < oldMidiList.length; di++) {
            var hasFoundInNew = false;
            var ni;
            for (ni = 0; ni < newMidiList.length; ni++) {
              if (oldMidiList[di] === newMidiList[ni]) {
                hasFoundInNew = true;
                break;
              }
            }
            if (!hasFoundInNew) {
              toDeactivate.push(oldMidiList[di]);
            }
          }

          for (ai = 0; ai < newMidiList.length; ai++) {
            var hasFoundInOld = false;
            var oi;
            for (oi = 0; oi < oldMidiList.length; oi++) {
              if (newMidiList[ai] === oldMidiList[oi]) {
                hasFoundInOld = true;
                break;
              }
            }
            if (!hasFoundInOld) {
              toActivate.push(newMidiList[ai]);
            }
          }

          _hexPtrDeactivateMidiList(toDeactivate, pid);
          _hexPtrActivateMidiList(toActivate, pid, e);

          _activePointerMidiLists[pid] = newMidiList;
          var primaryIdx = _hexPtrFindCellAtPoint(e.clientX, e.clientY);
          if (primaryIdx >= 0) {
            _activePointers[pid] = primaryIdx;
          }
        }
      }
    }
    } // end if (!_isHexLayoutChanging)
  }

  function _hexOnPointerUp(e) {
    e.preventDefault();
    if (!_isHexLayoutChanging) {
    var pid = (e.pointerId !== undefined) ? e.pointerId : 'mouse';
    var hasPointer = _activePointerMidiLists.hasOwnProperty(pid);
    if (hasPointer) {
      var midiList = _activePointerMidiLists[pid];
      _hexPtrDeactivateMidiList(midiList, pid);
      delete _activePointerMidiLists[pid];
      delete _activePointers[pid];
    } else {
      // Pointer not tracked (missed pointerdown or duplicate up/leave) --
      // still clear any triangles that might be associated with this pid
      _hexClearTriangles(pid);
    }
    // Safety sweep: remove ALL orphaned triangle overlay SVGs that are not
    // referenced by any currently-active pointer. Previous sweep only ran when
    // ALL pointers were gone -- this version removes truly orphaned SVGs even
    // when other pointers remain active.
    if (_hexGridEl) {
      var allDomSvgs = _hexGridEl.querySelectorAll('.hex-triangle-overlay');
      // Build a lookup of all data-tri-id values that are currently tracked
      var trackedIds = {};
      var trackedKeys = Object.keys(_triangleOverlays);
      var tk;
      for (tk = 0; tk < trackedKeys.length; tk++) {
        var trackedArr = _triangleOverlays[trackedKeys[tk]];
        var ti;
        for (ti = 0; ti < trackedArr.length; ti++) {
          var trackedId = trackedArr[ti].getAttribute('data-tri-id');
          if (trackedId) {
            trackedIds[trackedId] = true;
          }
        }
      }
      var oi;
      for (oi = 0; oi < allDomSvgs.length; oi++) {
        var svgNode = allDomSvgs[oi];
        var nodeTriId = svgNode.getAttribute('data-tri-id');
        var isTracked = (nodeTriId && trackedIds.hasOwnProperty(nodeTriId));
        if (!isTracked) {
          svgNode.parentNode.removeChild(svgNode);
        }
      }
    }
    } // end if (!_isHexLayoutChanging)
  }

  function _hexOnPointerCancel(e) {
    // pointercancel must ALWAYS clean up regardless of _isHexLayoutChanging,
    // because the browser has forcibly ended this pointer -- if we skip
    // cleanup, the triangles and tracking for this pointer become orphaned.
    var pid = (e.pointerId !== undefined) ? e.pointerId : 'mouse';
    var hasPointer = _activePointerMidiLists.hasOwnProperty(pid);
    if (hasPointer) {
      var midiList = _activePointerMidiLists[pid];
      _hexPtrDeactivateMidiList(midiList, pid);
      delete _activePointerMidiLists[pid];
      delete _activePointers[pid];
    } else {
      _hexClearTriangles(pid);
    }
  }

  // ============================================================
  // Recalculate hex pointer centers from DOM
  // ============================================================

  function _hexUpdatePtrCenters() {
    _hexPtrCenters = [];
    var maxIdx = _hexPtrCells.length;
    var i;
    for (i = 0; i < maxIdx; i++) {
      if (_hexPtrCells[i]) {
        var rect = _hexPtrCells[i].getBoundingClientRect();
        _hexPtrCenters[i] = {
          x: rect.left + (rect.width / 2),
          y: rect.top + (rect.height / 2)
        };
      }
    }
  }

  // ============================================================
  // Release all hex pointer notes
  // ============================================================

  function _hexReleaseAll() {
    // Release all MIDI notes tracked by pointer midi lists
    var midiPids = Object.keys(_activePointerMidiLists);
    var mp;
    for (mp = 0; mp < midiPids.length; mp++) {
      var midiList = _activePointerMidiLists[midiPids[mp]];
      _hexPtrDeactivateMidiList(midiList, midiPids[mp]);
    }
    _activePointerMidiLists = {};

    // Also release any legacy single-cell pointers
    var pids = Object.keys(_activePointers);
    var i;
    for (i = 0; i < pids.length; i++) {
      var idx = _activePointers[pids[i]];
      var isValidHexIdx = (idx >= 0) && (idx < _hexPtrCells.length);
      var hasHexCell = isValidHexIdx && (_hexPtrCells[idx]);
      if (hasHexCell) {
        if (_hexNoteOffFn) {
          _hexNoteOffFn(_hexPtrMidi[idx]);
        }
        _hexPtrCells[idx].classList.remove('hex-active');
        _hexPtrCells[idx].classList.remove('iso-glow');
        _hexPtrCells[idx].style.transform = '';
      }
    }
    _activePointers = {};

    var timerKeys = Object.keys(_legatoTimers);
    var t;
    for (t = 0; t < timerKeys.length; t++) {
      clearTimeout(_legatoTimers[timerKeys[t]]);
    }
    _legatoTimers = {};

    _hexClearTriangles();

    // Also clear refcount-based active notes (from edge/vertex hold system)
    if (_hexGridEl) {
      _hexDeactivateAll(function(m) {
        if (_hexNoteOffFn) { _hexNoteOffFn(m); }
      }, _hexGridEl);
    }
  }

  // ============================================================
  // Build hex topbar with root selector + layout selector
  // ============================================================

  function _buildHexTopbar(wrapper, onLayoutChange, onRootChange) {
    var topbar = document.createElement('div');
    topbar.className = 'iso-layout-bar hex-topbar';
    topbar.style.display = 'flex';
    topbar.style.alignItems = 'center';
    topbar.style.justifyContent = 'center';
    topbar.style.gap = '8px';
    topbar.style.padding = '4px 8px';
    topbar.style.height = HEX_TOPBAR_HEIGHT_PX + 'px';
    topbar.style.flexShrink = '0';
    topbar.style.position = 'relative';
    topbar.style.zIndex = '10';
    topbar.style.background = 'rgba(0,0,0,0.3)';
    topbar.style.borderBottom = '1px solid rgba(76,201,240,0.2)';

    // Root pitch class is read from the global topbar state
    // instead of a local dropdown. Sync on build.
    var globalRoot = (SL.screenPlay && SL.screenPlay.getRootPc) ? SL.screenPlay.getRootPc() : _hexRootPc;
    if (globalRoot !== _hexRootPc) {
      _hexRootPc = globalRoot;
      onRootChange(globalRoot);
    }

    // Layout selector
    var layoutLabel = document.createElement('span');
    layoutLabel.textContent = SL.t('isogrid.layout_label');
    layoutLabel.style.color = 'rgba(200,210,220,0.7)';
    layoutLabel.style.fontSize = '0.75rem';
    topbar.appendChild(layoutLabel);

    var layoutSelect = document.createElement('select');
    layoutSelect.className = 'hex-layout-select';
    layoutSelect.style.background = 'rgba(20,20,30,0.8)';
    layoutSelect.style.color = '#c8d2dc';
    layoutSelect.style.border = '1px solid rgba(76,201,240,0.3)';
    layoutSelect.style.borderRadius = '4px';
    layoutSelect.style.padding = '2px 6px';
    layoutSelect.style.fontSize = '0.75rem';

    var pi;
    for (pi = 0; pi < HEX_LAYOUT_PRESETS.length; pi++) {
      var opt = document.createElement('option');
      opt.value = HEX_LAYOUT_PRESETS[pi].val;
      opt.textContent = HEX_LAYOUT_PRESETS[pi].lbl;
      if (HEX_LAYOUT_PRESETS[pi].val === _hexCurrentLayoutVal) {
        opt.selected = true;
      }
      layoutSelect.appendChild(opt);
    }
    layoutSelect.addEventListener('change', function() {
      onLayoutChange(layoutSelect.value);
    });
    topbar.appendChild(layoutSelect);

    wrapper.insertBefore(topbar, wrapper.firstChild);
    return topbar;
  }

  // ============================================================
  // Build hex cells (shared by hex grid builder and rebuild)
  // ============================================================

  function _buildHexPtrCells(gridEl, fontSize) {
    _hexPtrCells = [];
    _hexPtrMidi = [];
    _hexPtrCenters = [];
    gridEl.innerHTML = '';

    gridEl.style.position = 'relative';

    var verticalSpacing = Math.floor(_hexGridGeom.hexHeight * 0.75);
    var halfHexOffset = Math.floor(_hexGridGeom.hexWidth / 2);
    var hexClipPath = 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)';

    var rowIdx;
    for (rowIdx = 0; rowIdx < _hexPtrRows; rowIdx++) {
      var visualRow = _hexPtrRows - 1 - rowIdx;
      var isOddRow = (visualRow % 2 === 1);
      var offsetX = isOddRow ? halfHexOffset : 0;
      var topPos = rowIdx * verticalSpacing;

      var colIdx;
      for (colIdx = 0; colIdx < _hexPtrCols; colIdx++) {
        var midi = _hexPtrMidiForCell(colIdx, visualRow);
        var pc = midi % SEMITONES_PER_OCTAVE;
        var oct = Math.floor(midi / SEMITONES_PER_OCTAVE) - 1;
        var noteNames = SL.notesForKey ? SL.notesForKey(_hexRootPc) : NOTES;
        var noteName = noteNames[pc];
        var isRoot = (pc === _hexRootPc);

        var cellEl = document.createElement('div');
        cellEl.className = 'perf-iso-key hex pc-' + pc + (isRoot ? ' root' : '');
        cellEl.setAttribute('data-midi', String(midi));
        cellEl.setAttribute('data-col', String(colIdx));
        cellEl.setAttribute('data-row', String(visualRow));
        cellEl.setAttribute('role', 'button');
        cellEl.setAttribute('aria-label', noteName + oct);

        var leftPos = colIdx * _hexGridGeom.hexWidth + offsetX;
        cellEl.style.position = 'absolute';
        cellEl.style.left = leftPos + 'px';
        cellEl.style.top = topPos + 'px';
        cellEl.style.width = _hexGridGeom.hexWidth + 'px';
        cellEl.style.height = _hexGridGeom.hexHeight + 'px';
        cellEl.style.clipPath = hexClipPath;
        cellEl.style.webkitClipPath = hexClipPath;
        cellEl.style.transition = 'transform 0.08s ease, filter 0.08s ease, box-shadow 0.08s ease';

        // Note name
        var nameSpan = document.createElement('span');
        nameSpan.className = 'hex-note-name';
        nameSpan.style.fontSize = fontSize + 'px';
        nameSpan.textContent = noteName;

        // Octave number
        var octSpan = document.createElement('span');
        octSpan.className = 'hex-octave-num';
        octSpan.style.fontSize = Math.floor(fontSize * RECT_OCTAVE_FONT_SCALE) + 'px';
        octSpan.textContent = String(oct);

        cellEl.appendChild(nameSpan);
        cellEl.appendChild(octSpan);

        gridEl.appendChild(cellEl);

        var cellIndexVal = _hexPtrCellIndex(colIdx, visualRow);
        while (_hexPtrCells.length <= cellIndexVal) {
          _hexPtrCells.push(null);
          _hexPtrMidi.push(0);
        }
        _hexPtrCells[cellIndexVal] = cellEl;
        _hexPtrMidi[cellIndexVal] = midi;

        // Also register in edge/vertex registry
        var cxPos = leftPos + (_hexGridGeom.hexWidth / 2);
        var cyPos = topPos + (_hexGridGeom.hexHeight / 2);
        _hexCells.push({ cx: cxPos, cy: cyPos, midi: midi, el: cellEl, row: visualRow, col: colIdx });
      }
    }
  }

  // ============================================================
  // Rebuild hex grid cells after layout or root change
  // ============================================================

  function _hexRebuildCells() {
    if (_hexGridEl) {
      _isHexLayoutChanging = true;
      // Clear ALL triangle overlays for ALL pointers before rebuild
      _hexClearTriangles();
      _activePointerMidiLists = {};
      _triangleOverlays = {};
      _hexReleaseAll();
      _hexCells = [];
      var isPhone = ((_currentContainer ? _currentContainer.clientWidth : DEFAULT_CONTAINER_WIDTH) < PHONE_WIDTH_THRESHOLD);
      var fontSize = isPhone ? HEX_FONT_SIZE_PHONE : HEX_FONT_SIZE_DESKTOP;
      _buildHexPtrCells(_hexGridEl, fontSize);
      requestAnimationFrame(function() {
        _hexUpdatePtrCenters();
        _isHexLayoutChanging = false;
      });
    }
  }

  // ============================================================
  // Build Hex Grid (unified: Wicki-Hayden, Tonnetz, Harmonic, etc.)
  // ============================================================

  function _buildLayoutSelector(container, presets, currentVal, onChange) {
    var bar = document.createElement('div');
    bar.className = 'iso-layout-bar';
    bar.style.display = 'flex';
    bar.style.alignItems = 'center';
    bar.style.justifyContent = 'center';
    bar.style.gap = '8px';
    bar.style.padding = '4px 8px';
    bar.style.height = '28px';
    bar.style.flexShrink = '0';
    bar.style.position = 'relative';
    bar.style.zIndex = '10';
    bar.style.background = 'rgba(0,0,0,0.3)';
    bar.style.borderBottom = '1px solid rgba(76,201,240,0.2)';

    var lbl = document.createElement('span');
    lbl.textContent = SL.t('isogrid.layout_label');
    lbl.style.color = 'rgba(200,210,220,0.7)';
    lbl.style.fontSize = '0.75rem';
    bar.appendChild(lbl);

    var sel = document.createElement('select');
    sel.className = 'iso-layout-select';
    sel.style.background = 'rgba(20,20,30,0.8)';
    sel.style.color = '#c8d2dc';
    sel.style.border = '1px solid rgba(76,201,240,0.3)';
    sel.style.borderRadius = '4px';
    sel.style.padding = '2px 6px';
    sel.style.fontSize = '0.75rem';

    var pi;
    for (pi = 0; pi < presets.length; pi++) {
      var opt = document.createElement('option');
      opt.value = presets[pi].val;
      opt.textContent = presets[pi].lbl;
      if (presets[pi].val === currentVal) { opt.selected = true; }
      sel.appendChild(opt);
    }

    sel.addEventListener('change', function() {
      onChange(sel.value);
    });

    bar.appendChild(sel);
    container.insertBefore(bar, container.firstChild);
    return bar;
  }

  function _rebuildGrid() {
    if (!_currentContainer || !_currentOpts) { return; }
    var children = _currentContainer.children;
    var ci;
    for (ci = children.length - 1; ci >= 0; ci--) {
      _currentContainer.removeChild(children[ci]);
    }
    if (_currentMode === 'hex') {
      _buildHexGrid(_currentContainer, _currentOpts);
    } else {
      _buildRectGrid(_currentContainer, _currentOpts);
    }
  }

  function _buildHexGrid(container, opts) {
    var baseOctave = opts.baseOctave || 3;
    var noteOn = opts.noteOn;
    var noteOff = opts.noteOff;

    _currentContainer = container;
    _currentOpts = opts;
    _currentMode = 'hex';
    _hexNoteOnFn = noteOn;
    _hexNoteOffFn = noteOff;
    _hexBaseOctave = baseOctave;
    _hexBaseMidi = (baseOctave + 1) * SEMITONES_PER_OCTAVE + _hexRootPc;

    var containerW = container.clientWidth || DEFAULT_CONTAINER_WIDTH;
    var containerH = container.clientHeight || DEFAULT_CONTAINER_HEIGHT;
    var isPhone = (containerW < PHONE_WIDTH_THRESHOLD);

    // Compute hex geometry
    var availW = containerW;
    var availH = containerH - HEX_TOPBAR_HEIGHT_PX;
    var minHexWidth = isPhone ? HEX_MIN_SIZE_PHONE : HEX_MIN_SIZE_DESKTOP;

    // Pointy-top hex geometry:
    //   hexWidth = size * sqrt(3), hexHeight = size * 2
    //   vertical spacing = hexHeight * 3/4
    //   odd rows offset right by hexWidth / 2
    var cols = Math.floor((availW / minHexWidth) - 0.5);
    if (cols < 3) { cols = 3; }

    var hexWidth = Math.floor((2 * availW) / (2 * cols + 1));
    if (hexWidth < minHexWidth) { hexWidth = minHexWidth; }
    if (hexWidth > HEX_MAX_WIDTH) { hexWidth = HEX_MAX_WIDTH; }

    var hexSize = hexWidth / HEX_SQRT3;
    var hexHeight = Math.floor(hexSize * 2);

    // Cap hex height so at least MIN_HEX_ROW_COUNT rows fit
    var maxHexH = Math.floor(availH / (1 + (MIN_HEX_ROW_COUNT - 1) * 0.75));
    if (hexHeight > maxHexH) {
      hexHeight = maxHexH;
    }

    var verticalSpacing = Math.floor(hexHeight * 0.75);
    var rows = Math.floor((availH - hexHeight) / verticalSpacing) + 1;
    if (rows < MIN_HEX_ROW_COUNT) { rows = MIN_HEX_ROW_COUNT; }

    var fontSize = isPhone ? HEX_FONT_SIZE_PHONE : HEX_FONT_SIZE_DESKTOP;

    // Store grid dimensions for pointer-based multi-touch
    _hexPtrCols = cols;
    _hexPtrRows = rows;

    // Store geometry for hit-testing (edge/vertex and pointer)
    _hexCells = [];
    _hexActiveNotes = {};
    _hexGridGeom.hexWidth = hexWidth;
    _hexGridGeom.hexHeight = hexHeight;
    _hexGridGeom.hexSize = hexSize;

    // Actual hex grid width = widest row (odd rows: cols*hexWidth + hexWidth/2)
    var actualHexGridW = (cols * hexWidth) + Math.floor(hexWidth / 2);

    // Wrapper
    var gridWrapper = document.createElement('div');
    gridWrapper.className = 'perf-iso-grid-wrapper hex-wrapper';
    gridWrapper.style.position = 'relative';
    gridWrapper.style.width = '100%';
    gridWrapper.style.height = '100%';

    // Build topbar with root + layout selectors
    _buildHexTopbar(gridWrapper,
      function onLayoutChange(val) {
        var pi;
        for (pi = 0; pi < HEX_LAYOUT_PRESETS.length; pi++) {
          if (HEX_LAYOUT_PRESETS[pi].val === val) {
            _currentHexRowInterval = HEX_LAYOUT_PRESETS[pi].rowInterval;
            _currentHexColInterval = HEX_LAYOUT_PRESETS[pi].colInterval;
            _hexCurrentLayoutVal = val;
            break;
          }
        }
        _hexRebuildCells();
      },
      function onRootChange(rootPc) {
        _hexRootPc = rootPc;
        _hexBaseMidi = (_hexBaseOctave + 1) * SEMITONES_PER_OCTAVE + _hexRootPc;
        _hexRebuildCells();
      }
    );

    // Grid area
    _hexGridEl = document.createElement('div');
    _hexGridEl.className = 'perf-iso-grid perf-hex-grid';
    _hexGridEl.style.padding = '0';
    _hexGridEl.style.touchAction = 'none';
    _hexGridEl.setAttribute('role', 'application');
    _hexGridEl.setAttribute('aria-label', SL.t('isogrid.hex_keyboard'));
    _hexGridEl.style.position = 'relative';
    _hexGridEl.style.width = actualHexGridW + 'px';
    _hexGridEl.style.height = availH + 'px';

    _buildHexPtrCells(_hexGridEl, fontSize);

    // Prevent iOS long-press popup and text selection on hex grid
    _hexGridEl.addEventListener('contextmenu', function(e) { e.preventDefault(); });
    _hexGridEl.addEventListener('selectstart', function(e) { e.preventDefault(); });

    // Pointer events on grid (multi-touch)
    _hexGridEl.addEventListener('pointerdown', _hexOnPointerDown);
    _hexGridEl.addEventListener('pointermove', _hexOnPointerMove);
    _hexGridEl.addEventListener('pointerup', _hexOnPointerUp);
    _hexGridEl.addEventListener('pointercancel', _hexOnPointerCancel);
    _hexGridEl.addEventListener('pointerleave', _hexOnPointerUp);

    gridWrapper.appendChild(_hexGridEl);
    container.appendChild(gridWrapper);

    // Compute centers after layout
    requestAnimationFrame(function() {
      _hexUpdatePtrCenters();
    });
  }

  // ============================================================
  // Preset lookup helpers
  // ============================================================

  function _findPresetByVal(val) {
    var pi;
    for (pi = 0; pi < ISO_LAYOUT_PRESETS.length; pi++) {
      if (ISO_LAYOUT_PRESETS[pi].val === val) {
        return ISO_LAYOUT_PRESETS[pi];
      }
    }
    return null;
  }

  function _findPresetByInterval(interval) {
    var pi;
    for (pi = 0; pi < ISO_LAYOUT_PRESETS.length; pi++) {
      if (ISO_LAYOUT_PRESETS[pi].rowInterval === interval) {
        return ISO_LAYOUT_PRESETS[pi];
      }
    }
    return null;
  }

  // ============================================================
  // Multi-touch + pitch-bend helpers for rect grid
  // ============================================================

  /** Walk up from el to find nearest data-midi ancestor inside boundary. */
  function _findMidiTarget(el, boundary) {
    var target = el;
    while (target && (target !== boundary)) {
      var attr = target.getAttribute('data-midi');
      if (attr !== NO_NODE) {
        return { midi: parseInt(attr, 10), el: target };
      }
      target = target.parentNode;
    }
    return null;
  }

  /**
   * Wire multi-touch + pitch-bend events on a rect grid wrapper.
   * Pitch bend fires only when opts.applyPitchBend is available.
   */
  function _wireRectGridTouchEvents(gridWrapper, cellW, opts) {
    var noteOn = opts.noteOn;
    var noteOff = opts.noteOff;
    var applyPitchBend = opts.applyPitchBend;
    var resetPitchBendFn = opts.resetPitchBendFn;
    var hasBend = (typeof applyPitchBend === 'function');
    var hasReset = (typeof resetPitchBendFn === 'function');

    // Per-touch state keyed by touch identifier
    var _touches = {};

    gridWrapper.addEventListener('touchstart', function(e) {
      e.preventDefault();
      var ti;
      for (ti = 0; ti < e.changedTouches.length; ti++) {
        var t = e.changedTouches[ti];
        var hit = _findMidiTarget(
          document.elementFromPoint(t.clientX, t.clientY),
          gridWrapper
        );
        if (hit) {
          var touchPressureEvt = { pointerType: 'touch', pressure: t.force };
          var touchVel = SL.velocityFromPressure(touchPressureEvt, ISOGRID_DEFAULT_VELOCITY);
          noteOn(hit.midi, touchVel);
          hit.el.classList.add('iso-glow');
          _touches[t.identifier] = { midi: hit.midi, el: hit.el, startX: t.clientX };
        }
      }
    }, { passive: false });

    gridWrapper.addEventListener('touchmove', function(e) {
      e.preventDefault();
      var ti;
      for (ti = 0; ti < e.changedTouches.length; ti++) {
        var t = e.changedTouches[ti];
        var info = _touches[t.identifier];
        if (!info) { continue; }

        // Pitch bend from horizontal drag
        if (hasBend) {
          var dx = t.clientX - info.startX;
          var bendCents = (dx / cellW) * CENTS_PER_SEMITONE;
          bendCents = Math.max(-MAX_BEND_CENTS, Math.min(MAX_BEND_CENTS, bendCents));
          applyPitchBend(bendCents);
        }

        // Check if finger slid to a new cell
        var newHit = _findMidiTarget(
          document.elementFromPoint(t.clientX, t.clientY),
          gridWrapper
        );
        if (newHit && (newHit.midi !== info.midi)) {
          noteOff(info.midi);
          if (info.el) { info.el.classList.remove('iso-glow'); }
          var movePressureEvt = { pointerType: 'touch', pressure: t.force };
          var moveVel = SL.velocityFromPressure(movePressureEvt, ISOGRID_DEFAULT_VELOCITY);
          noteOn(newHit.midi, moveVel);
          newHit.el.classList.add('iso-glow');
          info.midi = newHit.midi;
          info.el = newHit.el;
          info.startX = t.clientX;
          if (hasBend && hasReset) { resetPitchBendFn(); }
        }
      }
    }, { passive: false });

    gridWrapper.addEventListener('touchend', function(e) {
      e.preventDefault();
      var ti;
      for (ti = 0; ti < e.changedTouches.length; ti++) {
        var t = e.changedTouches[ti];
        var info = _touches[t.identifier];
        if (info) {
          noteOff(info.midi);
          if (info.el) { info.el.classList.remove('iso-glow'); }
          if (hasBend && hasReset) { resetPitchBendFn(); }
          delete _touches[t.identifier];
        }
      }
    }, { passive: false });

    gridWrapper.addEventListener('touchcancel', function(e) {
      var ti;
      for (ti = 0; ti < e.changedTouches.length; ti++) {
        var t = e.changedTouches[ti];
        var info = _touches[t.identifier];
        if (info) {
          noteOff(info.midi);
          if (info.el) { info.el.classList.remove('iso-glow'); }
          if (hasBend && hasReset) { resetPitchBendFn(); }
          delete _touches[t.identifier];
        }
      }
    });

    // Mouse support (single pointer, with pitch bend)
    var _isMouseDown = false;
    var _mouseMidi = -1;
    var _mouseStartX = 0;
    var _mouseEl = null;

    gridWrapper.addEventListener('mousedown', function(e) {
      e.preventDefault();
      _isMouseDown = true;
      var hit = _findMidiTarget(
        document.elementFromPoint(e.clientX, e.clientY),
        gridWrapper
      );
      if (hit) {
        _mouseMidi = hit.midi;
        _mouseStartX = e.clientX;
        _mouseEl = hit.el;
        var mouseVel = SL.velocityFromPressure(e, ISOGRID_DEFAULT_VELOCITY);
        noteOn(_mouseMidi, mouseVel);
        hit.el.classList.add('iso-glow');
      }
    });

    gridWrapper.addEventListener('mousemove', function(e) {
      if (!_isMouseDown || (_mouseMidi < 0)) { return; }
      if (hasBend) {
        var dx = e.clientX - _mouseStartX;
        var bendCents = (dx / cellW) * CENTS_PER_SEMITONE;
        bendCents = Math.max(-MAX_BEND_CENTS, Math.min(MAX_BEND_CENTS, bendCents));
        applyPitchBend(bendCents);
      }
    });

    function _mouseRelease() {
      if (_mouseMidi >= 0) {
        noteOff(_mouseMidi);
        if (_mouseEl) { _mouseEl.classList.remove('iso-glow'); }
        if (hasBend && hasReset) { resetPitchBendFn(); }
      }
      _isMouseDown = false;
      _mouseMidi = -1;
      _mouseEl = null;
    }

    gridWrapper.addEventListener('mouseup', _mouseRelease);
    gridWrapper.addEventListener('mouseleave', _mouseRelease);
  }

  // ============================================================
  // Build Rectangular Iso Keyboard (unified: iso4, iso5, chromatic)
  // ============================================================

  function _buildRectGrid(container, opts) {
    var interval = opts.interval || _currentRectInterval;
    var baseOctave = opts.baseOctave;

    _currentContainer = container;
    _currentOpts = opts;
    _currentMode = 'rect';
    _currentRectInterval = interval;

    // Determine initial preset
    var initialPreset = _currentRectPreset;
    if (!initialPreset) {
      initialPreset = _findPresetByInterval(interval);
    }
    if (!initialPreset) {
      initialPreset = _findPresetByVal('fourths');
    }
    _currentRectPreset = initialPreset;

    // Add layout selector if not already present
    var existingBar = container.querySelector('.iso-layout-bar');
    if (!existingBar) {
      _buildLayoutSelector(container, ISO_LAYOUT_PRESETS, initialPreset.val, function(val) {
        var picked = _findPresetByVal(val);
        if (picked) {
          _currentRectPreset = picked;
          _currentRectInterval = picked.rowInterval;
          _currentOpts.interval = picked.rowInterval;
        }
        _rebuildGrid();
      });
    }

    var preset = _currentRectPreset;
    var isChromatic = Boolean(preset && preset.chromatic);
    var fixedCols = (preset && preset.fixedCols) ? preset.fixedCols : 0;

    var baseNote = (baseOctave + 1) * SEMITONES_PER_OCTAVE;
    var containerW = container.clientWidth || DEFAULT_CONTAINER_WIDTH;
    var containerH = container.clientHeight || DEFAULT_CONTAINER_HEIGHT;

    // Subtract layout bar height so grid cells don't overflow
    var layoutBar = container.querySelector('.iso-layout-bar');
    if (layoutBar) {
      containerH = containerH - layoutBar.offsetHeight;
    }

    var isPhone = (containerW < PHONE_WIDTH_THRESHOLD);
    var cols;
    var rows;
    var cellW;
    var cellH;

    if (fixedCols > 0) {
      // Fixed-column layout (e.g. Chromatic 12-col): no gap, fill exactly
      cols = fixedCols;
      cellW = Math.floor(containerW / cols);
      rows = Math.max(2, Math.floor(containerH / cellW));
      cellH = Math.floor(containerH / rows);
    } else {
      // Normal isomorphic layout with gaps
      cols = isPhone ? RECT_PHONE_MAX_COLS : RECT_DESKTOP_COLS;
      rows = RECT_DEFAULT_ROWS;

      cellW = Math.floor((containerW - ((cols - 1) * GRID_GAP)) / cols);
      cellH = Math.floor((containerH - ((rows - 1) * GRID_GAP)) / rows);

      while ((cellW < RECT_MIN_CELL_SIZE) && (cols > 3)) {
        cols = cols - 1;
        cellW = Math.floor((containerW - ((cols - 1) * GRID_GAP)) / cols);
      }
      while ((cellH < RECT_MIN_CELL_SIZE) && (rows > 2)) {
        rows = rows - 1;
        cellH = Math.floor((containerH - ((rows - 1) * GRID_GAP)) / rows);
      }

      if (cellW < RECT_MIN_CELL_SIZE) { cellW = RECT_MIN_CELL_SIZE; }
      if (cellH < RECT_MIN_CELL_SIZE) { cellH = RECT_MIN_CELL_SIZE; }
    }

    var fontSize = Math.max(RECT_FONT_MIN, Math.floor(Math.min(cellW, cellH) / 3.5));
    var octaveFontSize = Math.floor(fontSize * RECT_OCTAVE_FONT_SCALE);

    // Actual grid dimensions depend on layout mode
    var actualGridW;
    if (fixedCols > 0) {
      actualGridW = cols * cellW;
    } else {
      actualGridW = (cols * cellW) + ((cols - 1) * GRID_GAP);
    }

    // Wrapper ensures the grid area fits within available space after the layout bar
    var gridWrapper = document.createElement('div');
    gridWrapper.className = 'perf-iso-grid-wrapper';
    gridWrapper.style.position = 'relative';
    gridWrapper.style.width = actualGridW + 'px';
    gridWrapper.style.height = containerH + 'px';

    var grid = document.createElement('div');
    grid.className = 'perf-iso-grid';
    grid.style.padding = '0';
    grid.setAttribute('role', 'application');
    grid.setAttribute('aria-label', SL.t('isogrid.grid_keyboard'));

    if (isChromatic) {
      // Absolute-positioned cells (chromatic 12-col style)
      grid.style.position = 'relative';
      grid.style.width = actualGridW + 'px';
      grid.style.height = containerH + 'px';

      var rIdx;
      for (rIdx = 0; rIdx < rows; rIdx++) {
        var visualRow = rows - 1 - rIdx;
        var rowStartMidi = baseNote + (rIdx * interval);

        var cIdx;
        for (cIdx = 0; cIdx < cols; cIdx++) {
          var midi = rowStartMidi + cIdx;
          if (midi > MIDI_MAX) { continue; }
          var pc = midi % SEMITONES_PER_OCTAVE;
          var oct = Math.floor(midi / SEMITONES_PER_OCTAVE) - 1;
          var isRoot = (pc === 0);

          var keyEl = document.createElement('div');
          keyEl.className = 'perf-iso-key pc-' + pc + (isRoot ? ' root' : '');
          keyEl.setAttribute('data-midi', midi);
          keyEl.setAttribute('role', 'button');
          keyEl.setAttribute('aria-label', NOTES[pc] + oct);
          keyEl.style.position = 'absolute';
          keyEl.style.left = (cIdx * cellW) + 'px';
          keyEl.style.top = (visualRow * cellH) + 'px';
          keyEl.style.width = cellW + 'px';
          keyEl.style.height = cellH + 'px';
          keyEl.style.background = CHROMATIC_NOTE_COLORS[pc];
          keyEl.style.transition = 'transform 0.08s ease, filter 0.08s ease, box-shadow 0.08s ease';

          var nameSpan = document.createElement('span');
          nameSpan.className = 'iso-note-name';
          nameSpan.style.fontSize = fontSize + 'px';
          nameSpan.textContent = NOTES[pc];

          var octSpan = document.createElement('span');
          octSpan.className = 'iso-octave-num';
          octSpan.style.fontSize = octaveFontSize + 'px';
          if (isRoot) { octSpan.style.fontWeight = '800'; }
          octSpan.textContent = String(oct);

          keyEl.appendChild(nameSpan);
          keyEl.appendChild(octSpan);

          grid.appendChild(keyEl);
        }
      }
    } else {
      // Normal row-based layout with CSS flex/gap
      var frag = document.createDocumentFragment();
      var rIdx2;
      for (rIdx2 = 0; rIdx2 < rows; rIdx2++) {
        var row = document.createElement('div');
        row.className = 'perf-iso-row';
        var rowNoteIdx = rows - 1 - rIdx2;

        var cIdx2;
        for (cIdx2 = 0; cIdx2 < cols; cIdx2++) {
          var midi2 = baseNote + (rowNoteIdx * interval) + cIdx2;
          var pc2 = midi2 % SEMITONES_PER_OCTAVE;
          var oct2 = Math.floor(midi2 / SEMITONES_PER_OCTAVE) - 1;
          var isRoot2 = (pc2 === 0);

          var keyEl2 = document.createElement('div');
          keyEl2.className = 'perf-iso-key pc-' + pc2 + (isRoot2 ? ' root' : '');
          keyEl2.setAttribute('data-midi', midi2);
          keyEl2.setAttribute('role', 'button');
          keyEl2.setAttribute('aria-label', NOTES[pc2] + oct2);
          keyEl2.style.width = cellW + 'px';
          keyEl2.style.height = cellH + 'px';
          keyEl2.style.transition = 'transform 0.08s ease, filter 0.08s ease, box-shadow 0.08s ease';

          var nameSpan2 = document.createElement('span');
          nameSpan2.className = 'iso-note-name';
          nameSpan2.style.fontSize = fontSize + 'px';
          nameSpan2.textContent = NOTES[pc2];

          var octSpan2 = document.createElement('span');
          octSpan2.className = 'iso-octave-num';
          octSpan2.style.fontSize = octaveFontSize + 'px';
          if (isRoot2) { octSpan2.style.fontWeight = '800'; }
          octSpan2.textContent = String(oct2);

          keyEl2.appendChild(nameSpan2);
          keyEl2.appendChild(octSpan2);

          row.appendChild(keyEl2);
        }
        frag.appendChild(row);
      }
      grid.appendChild(frag);
    }

    gridWrapper.appendChild(grid);

    // Prevent iOS long-press popup and text selection on rect grid
    gridWrapper.addEventListener('contextmenu', function(e) { e.preventDefault(); });
    gridWrapper.addEventListener('selectstart', function(e) { e.preventDefault(); });

    // Wire unified multi-touch + pitch-bend events on the wrapper
    _wireRectGridTouchEvents(gridWrapper, cellW, opts);

    container.appendChild(gridWrapper);
  }

  // ============================================================
  // Register
  // ============================================================

  if (!SL.controllers) { SL.controllers = {}; }

  SL.controllers.grid = {
    build: function(container, opts) {
      _buildRectGrid(container, opts);
    }
  };

  // Alias -- iso5 is now handled by the unified grid with layout presets
  SL.controllers.iso5 = SL.controllers.grid;

  SL.controllers.hex = {
    build: function(container, opts) {
      _buildHexGrid(container, opts);
    },
    release: _hexReleaseAll
  };

  // ============================================================
  // Panic hook (hex/tonnetz)
  // ============================================================

  if (SL.PanicRegistry && SL.PanicRegistry.register) {
    SL.PanicRegistry.register(
      'voices',
      'hex.notes',
      function() { _hexReleaseAll(); },
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
