// SSLI External API Facade
// ES5 only. No arrow functions, no template literals, no `let`/`const`.
//
// Exposes window.SSLI (and mirrored window.SynthLab.api) as a documented,
// minimal surface for external agents / LLM composers / host pages.
//
// Also defines SL.safe.escapeName for sanitizing user-supplied preset names
// before they are rendered via innerHTML.
(function() {
  'use strict';

  var SL = window.SynthLab = window.SynthLab || {};

  // Sentinel constants
  var NO_NODE = null;

  // ============================================================
  // Name Sanitization (Task 2)
  // ============================================================

  var MAX_NAME_LEN = 80;
  // Control chars [\x00-\x1f\x7f] (bidi-safe via character class)
  var RE_CONTROL = /[\x00-\x1f\x7f]/g;
  // Unicode direction overrides (LRE/RLE/PDF/LRO/RLO/LRI/RLI/FSI/PDI)
  var RE_DIRECTION_OVERRIDES = /[\u202a-\u202e\u2066-\u2069]/g;
  var HTML_ESCAPES = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  var RE_HTML = /[&<>"']/g;

  /**
   * Strip control chars + direction overrides, HTML-escape, clamp to 80 chars.
   * @param {*} s - Candidate name (coerced to string).
   * @returns {string} Safe-to-innerHTML preset name.
   */
  function escapeName(s) {
    var str = (s === NO_NODE || s === undefined) ? '' : String(s);
    str = str.replace(RE_CONTROL, '');
    str = str.replace(RE_DIRECTION_OVERRIDES, '');
    str = str.replace(RE_HTML, function(ch) { return HTML_ESCAPES[ch]; });
    if (str.length > MAX_NAME_LEN) {
      str = str.substring(0, MAX_NAME_LEN);
    }
    return str;
  }

  SL.safe = SL.safe || {};
  SL.safe.escapeName = escapeName;

  // ============================================================
  // Internal helpers
  // ============================================================

  function _getPresets() {
    return SL.presets || null;
  }

  function _getCurrentInstId() {
    if (SL.audio && SL.audio.getCurrentInstrument) {
      return SL.audio.getCurrentInstrument();
    }
    return 0;
  }

  function _getCurrentSettings() {
    if (!SL.audio || !SL.audio.getInstruments) {
      return null;
    }
    var instruments = SL.audio.getInstruments();
    var instId = _getCurrentInstId();
    var inst = instruments && instruments[instId];
    if (!inst) {
      return null;
    }
    return inst.settings || null;
  }

  // Deep-ish clone for getState snapshot (JSON round-trip drops functions
  // but settings are pure data, which is what we want).
  function _snapshot(obj) {
    if (obj === NO_NODE || obj === undefined) {
      return null;
    }
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch (e) {
      return null;
    }
  }

  function _makeIntermediateNode() {
    return {};
  }
  function _emptyList() {
    return [];
  }
  function _makePresetEntry(name, eng, cat) {
    return { name: name, engine: eng, category: cat };
  }
  function _makePresetCopy() {
    return {};
  }

  // Dotted-path setter. Writes into `target` by walking keys; creates
  // intermediate objects only if they already exist as objects/arrays.
  function _setByPath(target, path, value) {
    var hasNoTarget = !target || typeof path !== 'string';
    var isInvalidPath = hasNoTarget || path.length === 0;
    if (isInvalidPath) {
      return false;
    }
    var parts = path.split('.');
    var node = target;
    var i;
    for (i = 0; i < parts.length - 1; i++) {
      var key = parts[i];
      if (node[key] === NO_NODE || node[key] === undefined) {
        node[key] = _makeIntermediateNode();
      }
      if (typeof node[key] !== 'object') {
        return false;
      }
      node = node[key];
    }
    node[parts[parts.length - 1]] = value;
    return true;
  }

  // ============================================================
  // Param-change listener registry
  // ============================================================

  var _paramListeners = [];

  function _fireParamChange(path, value) {
    var i;
    var safeListeners = _paramListeners.slice();
    for (i = 0; i < safeListeners.length; i++) {
      try {
        safeListeners[i](path, value);
      } catch (e) { /* listener errors are swallowed; never break the setter for a bad callback */ }
    }
  }

  /**
   * Register a cb invoked on every setParam write.
   * @param {function(string, *)} cb - Receives (path, newValue).
   * @returns {function()} Unregister function.
   */
  function onParamChange(cb) {
    if (typeof cb !== 'function') {
      return function() {};
    }
    _paramListeners.push(cb);
    return function() {
      var idx = _paramListeners.indexOf(cb);
      if (idx >= 0) {
        _paramListeners.splice(idx, 1);
      }
    };
  }

  // ============================================================
  // API implementations
  // ============================================================

  /**
   * List the available engine display names.
   * @returns {string[]} Array of engine names (e.g. 'Subtractive', 'FM').
   */
  function listEngines() {
    var p = _getPresets();
    if (p && p.getEngines) {
      return p.getEngines();
    }
    return [];
  }

  /**
   * List all presets, optionally scoped to a single engine.
   * @param {string} [engine] - Engine display name (case-sensitive).
   * @returns {Array<{name:string, engine:string, category:string}>}
   */
  function listPresets(engine) {
    var p = _getPresets();
    if (!p) {
      return [];
    }
    var engines = engine ? [engine] : listEngines();
    var out = [];
    var ei;
    var ci;
    var pi;
    for (ei = 0; ei < engines.length; ei++) {
      var eng = engines[ei];
      var cats = (p.getCategoriesForEngine ? p.getCategoriesForEngine(eng) : _emptyList()) || _emptyList();
      for (ci = 0; ci < cats.length; ci++) {
        var cat = cats[ci];
        var list = (p.getPresetsForEngineCategory ? p.getPresetsForEngineCategory(eng, cat) : _emptyList()) || _emptyList();
        for (pi = 0; pi < list.length; pi++) {
          out.push(_makePresetEntry(
            list[pi] && list[pi].name ? String(list[pi].name) : '',
            eng,
            cat
          ));
        }
      }
    }
    return out;
  }

  /**
   * Load a preset by name. Optionally scoped to a single engine.
   * @param {string} name - Preset name (exact match).
   * @param {string} [engine] - Restrict lookup to this engine.
   * @returns {boolean} True if found and applied, false otherwise.
   */
  function loadPreset(name, engine) {
    var p = _getPresets();
    if (!p || !name) {
      return false;
    }
    var engines = engine ? [engine] : listEngines();
    var ei;
    var ci;
    var pi;
    for (ei = 0; ei < engines.length; ei++) {
      var eng = engines[ei];
      var cats = (p.getCategoriesForEngine ? p.getCategoriesForEngine(eng) : _emptyList()) || _emptyList();
      for (ci = 0; ci < cats.length; ci++) {
        var list = (p.getPresetsForEngineCategory ? p.getPresetsForEngineCategory(eng, cats[ci]) : _emptyList()) || _emptyList();
        for (pi = 0; pi < list.length; pi++) {
          if (list[pi] && list[pi].name === name) {
            var preset = list[pi];
            // Ensure preset carries engine tag for apply dispatch.
            if (!preset.engine && p.engineNameToType) {
              preset = _makePresetCopy();
              var src = list[pi];
              for (var k in src) {
                if (Object.prototype.hasOwnProperty.call(src, k)) {
                  preset[k] = src[k];
                }
              }
              preset.engine = p.engineNameToType(eng);
            }
            if (p.apply) {
              p.apply(preset, _getCurrentInstId());
              return true;
            }
            return false;
          }
        }
      }
    }
    return false;
  }

  var DEFAULT_DURATION_MS = 400;
  var MIN_MIDI = 0;
  var MAX_MIDI = 127;

  /**
   * Trigger a note via the active instrument path.
   * @param {number} midi - MIDI note number (0-127).
   * @param {number} [velocity] - Currently informational; engine uses its own.
   * @param {number} [durationMs] - Note length in milliseconds.
   */
  function playNote(midi, velocity, durationMs) {
    var isPlayNoteOutOfRange = typeof midi !== 'number' || midi < MIN_MIDI || midi > MAX_MIDI;
    if (isPlayNoteOutOfRange) {
      return false;
    }
    var durSec = (typeof durationMs === 'number' && durationMs > 0)
      ? (durationMs / 1000)
      : undefined;
    if (SL.audio && SL.audio.playNote) {
      SL.audio.playNote(midi, durSec);
      return true;
    }
    return false;
  }

  /**
   * Release a currently-held note (sustained path).
   * @param {number} midi - MIDI note number (0-127).
   */
  function stopNote(midi) {
    var isStopNoteOutOfRange = typeof midi !== 'number' || midi < MIN_MIDI || midi > MAX_MIDI;
    if (isStopNoteOutOfRange) {
      return false;
    }
    if (SL.audio && SL.audio.stopSustainedNote) {
      SL.audio.stopSustainedNote(midi);
      return true;
    }
    return false;
  }

  /**
   * Set a live setting on the current instrument via dotted path (e.g. 'adsr.a').
   * @param {string} path - Dotted path into the settings object.
   * @param {*} value - New value (primitive or object).
   * @returns {boolean} True on success.
   */
  function setParam(path, value) {
    var settings = _getCurrentSettings();
    var isOk = false;
    if (settings) {
      isOk = _setByPath(settings, path, value);
    }
    if (isOk) {
      _fireParamChange(path, value);
    }
    return isOk;
  }

  /**
   * Read-only snapshot of the current instrument's settings.
   * @returns {Object|null}
   */
  function getState() {
    return _snapshot(_getCurrentSettings());
  }

  /**
   * Invoke the existing panic registry teardown path.
   * @returns {Object} Result object from PanicRegistry.executePanic.
   */
  function panic() {
    if (SL.PanicRegistry && SL.PanicRegistry.executePanic) {
      return SL.PanicRegistry.executePanic(false, false);
    }
    return { errors: ['PanicRegistry unavailable'] };
  }

  // ============================================================
  // Patch the save-as-new-preset path to sanitize user input
  // ============================================================

  // ssli-screen-tweak.js stores user-entered names in localStorage via
  // a prompt(). Harden that path: wrap localStorage.setItem writes of the
  // user-preset key so names are always escaped before persistence.
  var USER_PRESETS_STORAGE_KEY = 'ssli-user-presets';

  function _sanitizeUserPresetArray(arr) {
    if (!arr || typeof arr.length !== 'number') {
      return arr;
    }
    var i;
    for (i = 0; i < arr.length; i++) {
      if (arr[i] && typeof arr[i].name === 'string') {
        arr[i].name = escapeName(arr[i].name);
      }
    }
    return arr;
  }

  try {
    var _origSetItem = window.localStorage && window.localStorage.setItem;
    if (_origSetItem) {
      window.localStorage.setItem = function(key, val) {
        if (key === USER_PRESETS_STORAGE_KEY) {
          try {
            var parsed = JSON.parse(val);
            _sanitizeUserPresetArray(parsed);
            val = JSON.stringify(parsed);
          } catch (e) { /* payload is not valid JSON; fall through unchanged */ }
        }
        return _origSetItem.call(window.localStorage, key, val);
      };
    }
  } catch (eLs) { /* localStorage may throw in private-browsing contexts */ }

  // ============================================================
  // Attach facade
  // ============================================================

  var facade = {
    loadPreset: loadPreset,
    listPresets: listPresets,
    listEngines: listEngines,
    playNote: playNote,
    stopNote: stopNote,
    setParam: setParam,
    getState: getState,
    panic: panic,
    onParamChange: onParamChange
  };

  window.SSLI = facade;
  SL.api = facade;

})();
