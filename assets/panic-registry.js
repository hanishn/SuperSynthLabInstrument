// SSLI Panic Registry
// Centralized registry for teardown + assertion functions invoked by panic.
// Modules register (category, name, teardownFn, assertFn) and the registry
// executes teardowns in a deterministic category order. After teardown,
// assertClean() can be called to verify nothing leaked.
// ES5 only (var, no arrow functions, no template literals).

(function() {
  'use strict';

  var SL = window.SynthLab = window.SynthLab || {};

  // Fixed category execution order. Timers first (so no further audio
  // triggers fire during teardown), then active voices, then controllers.
  var CATEGORY_ORDER = [
    'timers',
    'intervals',
    'voices',
    'midiActive',
    'sustained',
    'controllers',
    'audioNodes',
    'workletState'
  ];

  function _makeCategoryMap() {
    return {};
  }

  var _registrations = {};
  for (var ci = 0; ci < CATEGORY_ORDER.length; ci++) {
    _registrations[CATEGORY_ORDER[ci]] = _makeCategoryMap();
  }

  var _isPanicInProgress = false;

  function register(category, name, teardownFn, assertFn) {
    if (!_registrations[category]) {
      _registrations[category] = {};
    }
    _registrations[category][name] = {
      teardown: teardownFn,
      assert: assertFn || null
    };
  }

  function unregister(category, name) {
    if (_registrations[category] && _registrations[category][name]) {
      delete _registrations[category][name];
    }
  }

  function executePanic(hardReset, dryRun) {
    var result = { errors: [] };
    if (_isPanicInProgress) {
      result.errors.push('panic re-entry blocked');
      return result;
    }
    _isPanicInProgress = true;
    try {
      var i;
      var n;
      for (i = 0; i < CATEGORY_ORDER.length; i++) {
        var category = CATEGORY_ORDER[i];
        var bucket = _registrations[category];
        if (!bucket) { continue; }
        var names = Object.keys(bucket);
        for (n = 0; n < names.length; n++) {
          var entry = bucket[names[n]];
          if (!entry || !entry.teardown) { continue; }
          if (dryRun) { continue; }
          try {
            entry.teardown();
          } catch (e) {
            var message = '[panic] ' + category + '/' + names[n] + ': ' + (e && e.message ? e.message : String(e));
            result.errors.push(message);
          }
        }
      }

      if (hardReset && !dryRun) {
        var presets = SL.presets;
        if (presets && presets.reloadCurrentPreset) {
          try {
            presets.reloadCurrentPreset();
          } catch (e2) {
            result.errors.push('[panic] presets/reloadCurrentPreset: ' + (e2 && e2.message ? e2.message : String(e2)));
          }
        }
      }
    } catch (outer) {
      result.errors.push('[panic] outer: ' + (outer && outer.message ? outer.message : String(outer)));
    }
    _isPanicInProgress = false;
    return result;
  }

  function assertClean() {
    var offenders = [];
    var i;
    var n;
    for (i = 0; i < CATEGORY_ORDER.length; i++) {
      var category = CATEGORY_ORDER[i];
      var bucket = _registrations[category];
      if (!bucket) { continue; }
      var names = Object.keys(bucket);
      for (n = 0; n < names.length; n++) {
        var entry = bucket[names[n]];
        if (!entry || !entry.assert) { continue; }
        var reason = null;
        try {
          reason = entry.assert();
        } catch (e) {
          reason = 'assertFn threw: ' + (e && e.message ? e.message : String(e));
        }
        if (reason) {
          offenders.push({ category: category, name: names[n], reason: reason });
        }
      }
    }
    return { clean: (offenders.length === 0), offenders: offenders };
  }

  function getRegistrations() {
    return _registrations;
  }

  SL.PanicRegistry = {
    register: register,
    unregister: unregister,
    executePanic: executePanic,
    assertClean: assertClean,
    getRegistrations: getRegistrations
  };

})();
