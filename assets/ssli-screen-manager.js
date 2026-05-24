// SSLI Screen Manager — 5-screen navigation for Super Synth Lab Instrument
// ES5 compatible (var, no arrow functions, no template literals)

var SynthLab = window.SynthLab || {};
var SL = SynthLab;

// ============================================================
// Shared State Notification System (from SSLU)
// ============================================================
SL.state = (function () {
    var _listeners = [];

    function onChange(callback) {
        _listeners.push(callback);
    }

    function removeListener(callback) {
        for (var i = _listeners.length - 1; i >= 0; i--) {
            if (_listeners[i] === callback) {
                _listeners.splice(i, 1);
            }
        }
    }

    function notify(what) {
        for (var i = 0; i < _listeners.length; i++) {
            _listeners[i](what);
        }
    }

    return {
        onChange: onChange,
        removeListener: removeListener,
        notify: notify
    };
})();

// ============================================================
// Screen Manager
// ============================================================
SL.screens = (function () {
    'use strict';

    var STORAGE_KEY = 'ssli-current-screen';
    var SCREEN_IDS = ['play', 'sound', 'shape', 'tweak', 'effects', 'acid', 'midi'];
    var DEFAULT_SCREEN = 'play';
    var NAV_ELEMENT_ID = 'ssli-nav';
    var SCREEN_ID_PREFIX = 'ssli-screen-';
    var LANDING_ID = 'ssli-landing';
    var APP_ID = 'ssli-app';
    var PLAY_BTN_ID = 'ssliPlayBtn';
    var PHONE_MAX_DIM = 600;
    var PHONE_MAX_OTHER_DIM = 900;

    var _currentScreen = DEFAULT_SCREEN;
    var _screenModules = {};
    var _audioInitialized = false;
    var _appVisible = false;
    var _wakeLockSentinel = null;

    // --------------------------------------------------------
    // Screen Registration
    // --------------------------------------------------------

    function registerScreen(id, module) {
        _screenModules[id] = module;
    }

    // --------------------------------------------------------
    // Navigation
    // --------------------------------------------------------

    function _getNavButtons() {
        var nav = document.getElementById(NAV_ELEMENT_ID);
        if (!nav) {
            return [];
        }
        var nodeList = nav.querySelectorAll('.ssli-nav-btn');
        var arr = [];
        for (var i = 0; i < nodeList.length; i++) {
            arr.push(nodeList[i]);
        }
        return arr;
    }

    function _setActiveButton(screenId) {
        var buttons = _getNavButtons();
        for (var i = 0; i < buttons.length; i++) {
            var btn = buttons[i];
            var btnScreen = btn.getAttribute('data-screen');
            if (btnScreen === screenId) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        }
    }

    function _hideScreen(screenId) {
        var el = document.getElementById(SCREEN_ID_PREFIX + screenId);
        if (el) {
            el.style.display = 'none';
            el.classList.remove('active');
        }
    }

    function _showScreen(screenId) {
        var el = document.getElementById(SCREEN_ID_PREFIX + screenId);
        if (el) {
            el.style.opacity = '0';
            el.style.display = '';
            el.classList.add('active');
            requestAnimationFrame(function() {
                el.style.opacity = '1';
            });
        }
    }

    function _saveScreen(screenId) {
        try {
            localStorage.setItem(STORAGE_KEY, screenId);
        } catch (e) {
            // localStorage may not be available
        }
    }

    function _loadScreen() {
        try {
            var saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                // Validate it is one of our screens
                for (var i = 0; i < SCREEN_IDS.length; i++) {
                    if (SCREEN_IDS[i] === saved) {
                        return saved;
                    }
                }
            }
        } catch (e) {
            // localStorage may not be available
        }
        return DEFAULT_SCREEN;
    }

    function switchTo(screenId) {
        if (screenId === _currentScreen) {
            return;
        }

        // Ensure audio is initialized on first navigation
        _initAudioIfNeeded();

        // Deactivate old screen
        var oldMod = _screenModules[_currentScreen];
        if (oldMod && oldMod.deactivate) {
            oldMod.deactivate();
        }
        _hideScreen(_currentScreen);

        // Show new screen
        _showScreen(screenId);
        _setActiveButton(screenId);
        _currentScreen = screenId;
        _saveScreen(screenId);

        // Activate new screen
        var newMod = _screenModules[screenId];
        if (newMod && newMod.activate) {
            try {
                newMod.activate();
            } catch (activateErr) {
                console.error('[ssli-screen-manager] activate("' + screenId + '") threw:', activateErr);
            }
        }
    }

    function getCurrent() {
        return _currentScreen;
    }

    // --------------------------------------------------------
    // Audio Initialization (deferred to first user gesture)
    // --------------------------------------------------------

    function _initAudioIfNeeded() {
        if (_audioInitialized) {
            return;
        }
        _audioInitialized = true;

        try {
            // Create and resume AudioContext on this user gesture
            var ctx = null;
            if (SL.audio && SL.audio.getCtx) {
                ctx = SL.audio.getCtx();
                if (ctx && ctx.state === 'suspended') {
                    ctx.resume().catch(function(resumeErr) {
                        console.error('[ssli] AudioContext resume failed:', resumeErr);
                    });
                }
            }

            // Initialize the effect chain (audio routing) BEFORE engine inits.
            if (SL.audio && SL.audio.initEffectChain && !SL.audio.effectChain) {
                SL.audio.initEffectChain();
                if (SL.effectsUI && SL.effectsUI.init) {
                    SL.effectsUI.init();
                }
            }

            // Initialize synth engines (first pass — may partially fail if
            // AudioContext hasn't fully resumed yet; _ensureEngineReady in
            // ssli-screen-sound.js will re-init on first preset apply)
            var ENGINES = [
                'fm', 'physical', 'additive', 'granular', 'vocoderSynth',
                'wavefolder', 'formant', 'modal', 'ringmod', 'chord',
                'superwave', 'wavetableSynth', 'phasedist', 'chip',
                'bytebeat', 'vector', 'drumsyn', 'pulsar', 'bodyResonance', 'reed'
            ];
            for (var ei = 0; ei < ENGINES.length; ei++) {
                if (SL[ENGINES[ei]] && SL[ENGINES[ei]].init) {
                    try { SL[ENGINES[ei]].init(); } catch (engineErr) { /* will retry on demand */ }
                }
            }

            // Second pass after a short delay to catch engines that needed
            // the AudioContext to be fully running. Also ensure fallback
            // voices are initialized for worklet-based engines (physical,
            // FM, formant) so notes aren't dropped while worklets load.
            setTimeout(function() {
                var WORKLET_ENGINES = ['physical', 'fm', 'formant'];
                for (var ri = 0; ri < ENGINES.length; ri++) {
                    var eng = SL[ENGINES[ri]];
                    if (eng && eng.init && eng.isReady && !eng.isReady()) {
                        try { eng.init(); } catch (retryErr) { /* best effort */ }
                    }
                }
                // Note: worklet engines (physical, FM, formant) have on-demand
                // fallback init in their noteOn() — if worklet isn't ready when a
                // note fires, they auto-init fallback voices and retry.
            }, 200);
        } catch (e) {
            console.error('[ssli] Audio init error:', e);
        }

        // P1-04: Wake lock to prevent screen sleep during performance
        _acquireWakeLock();

        // Re-acquire wake lock when page becomes visible again (e.g. tab switch)
        document.addEventListener('visibilitychange', function() {
            if (document.visibilityState === 'visible' && _audioInitialized) {
                _acquireWakeLock();
            }
        });
    }

    function _acquireWakeLock() {
        if (!('wakeLock' in navigator)) {
            return;
        }
        try {
            navigator.wakeLock.request('screen').then(function(sentinel) {
                _wakeLockSentinel = sentinel;
                sentinel.addEventListener('release', function() {
                    _wakeLockSentinel = null;
                });
            }).catch(function(err) {
                console.warn('[ssli] Wake lock request failed:', err.message);
            });
        } catch (wakeLockErr) {
            console.warn('[ssli] Wake lock not supported:', wakeLockErr.message);
        }
    }

    // --------------------------------------------------------
    // Landing Page -> App Transition
    // --------------------------------------------------------

    function _hideAllScreens() {
        for (var i = 0; i < SCREEN_IDS.length; i++) {
            _hideScreen(SCREEN_IDS[i]);
        }
    }

    function _enterApp() {
        var landing = document.getElementById(LANDING_ID);
        var app = document.getElementById(APP_ID);
        if (landing) {
            landing.style.display = 'none';
        }
        if (app) {
            app.style.display = '';
        }
        _appVisible = true;

        // V-01: Mark body so CSS hides the SSLU hamburger button,
        // which overlaps SSLI nav at phone-landscape sizes.
        document.body.classList.add('ssli-app-active');

        // Initialize audio on this user gesture
        _initAudioIfNeeded();

        // Hide all screens first to prevent stacking from prior navigation
        _hideAllScreens();

        // Restore saved screen or default to play
        var savedScreen = _loadScreen();
        _currentScreen = savedScreen;
        _showScreen(savedScreen);
        _setActiveButton(savedScreen);

        // Activate screen module
        var mod = _screenModules[savedScreen];
        if (mod && mod.activate) {
            try {
                mod.activate();
            } catch (e) {
                console.error('[ssli] Screen activate error:', e);
            }
        }

        // Phone portrait rotation gate
        _checkOrientation();
    }

    function _checkOrientation() {
        var overlay = document.getElementById('ssli-rotate-overlay');
        if (!overlay) {
            return;
        }
        var isPhone = (window.innerWidth < PHONE_MAX_DIM && window.innerHeight < PHONE_MAX_OTHER_DIM) ||
                      (window.innerHeight < PHONE_MAX_DIM && window.innerWidth < PHONE_MAX_OTHER_DIM);
        var isPortrait = window.innerHeight > window.innerWidth;
        if (isPhone && isPortrait && _appVisible) {
            overlay.style.display = 'flex';
        } else {
            overlay.style.display = 'none';
        }
    }

    // --------------------------------------------------------
    // Panic — full audio clear (Issue 16)
    // --------------------------------------------------------

    function _performPanic() {
        // 1. Stop all sustained notes via audio engine
        if (SL.audio && SL.audio.stopAllSustained) {
            SL.audio.stopAllSustained();
        }

        // 2. MIDI panic (stops MIDI-triggered notes + sends All Notes Off)
        if (SL.midi && SL.midi.panic) {
            SL.midi.panic();
        }

        // 3. Clear chord pad strum timeouts and restrum intervals
        if (SL.controllers && SL.controllers.chordpads && SL.controllers.chordpads.clearStrumTimeouts) {
            SL.controllers.chordpads.clearStrumTimeouts();
        }

        // 4. Reset pitch bend and stop all tracked notes on the play screen
        if (SL.screenPlay && SL.screenPlay.stopAllNotes) {
            SL.screenPlay.stopAllNotes();
        }

        // 5. Clear any active expression (filter cutoff / gain overrides)
        if (SL.audio && SL.audio.clearExpression) {
            SL.audio.clearExpression();
        }

        // 6. Release all controller surfaces that track active pointers
        if (SL.controllers) {
            var ctrlNames = Object.keys(SL.controllers);
            for (var ci = 0; ci < ctrlNames.length; ci++) {
                var ctrl = SL.controllers[ctrlNames[ci]];
                if (ctrl && ctrl.release) {
                    try { ctrl.release(); } catch (releaseErr) { /* best effort */ }
                }
            }
        }

        // 7. Remove visual active states from all controller elements
        var activeEls = document.querySelectorAll('.ctrl-harp-active, .ctrl-chord-active, .ctrl-loom-active, .ctrl-marimba-active, .ctrl-linn-active, .perf-active, .playing, .active');
        for (var i = 0; i < activeEls.length; i++) {
            activeEls[i].classList.remove('ctrl-harp-active', 'ctrl-chord-active', 'ctrl-loom-active', 'ctrl-marimba-active', 'ctrl-linn-active', 'perf-active', 'playing');
        }

        // 8. Belt-and-suspenders: invoke PanicRegistry to catch anything the
        // above legacy branches missed. Do NOT remove the branches above.
        if (SL.PanicRegistry) { SL.PanicRegistry.executePanic(false, false); }
    }

    // --------------------------------------------------------
    // Mute / Panic Button
    // --------------------------------------------------------

    // --------------------------------------------------------
    // Universal PANIC overlay button (v1.5.804 — stage UX)
    //
    // Design decision: the old nav PANIC item is REMOVED (not merely
    // duplicated). This function now attaches a large, circular, fixed
    // top-right overlay button that is visible on EVERY screen. The
    // overlay is parented to the app container and uses position:fixed
    // so it persists across screen switches (screens are swapped inside
    // #ssli-screens, not at the app root).
    //
    // Click behavior:
    //   1. Invoke SL.PanicRegistry.executePanic(false,false) if present.
    //   2. Flash the button green for PANIC_FLASH_MS to confirm fire.
    //   3. Fall through to legacy _performPanic() for belt-and-suspenders.
    // --------------------------------------------------------

    var PANIC_OVERLAY_ID = 'ssliPanicOverlay';
    var PANIC_FLASH_MS = 300;
    var PANIC_FLASH_CLASS = 'ssli-panic-flash';

    function createMuteButton() {
        // The old left-rail Panic nav item has been removed. This function
        // now builds a universal top-right PANIC overlay button instead.
        var app = document.getElementById(APP_ID);
        if (!app) {
            return;
        }
        if (document.getElementById(PANIC_OVERLAY_ID)) {
            return;
        }
        var btn = document.createElement('button');
        btn.id = PANIC_OVERLAY_ID;
        btn.className = 'ssli-panic-overlay-btn';
        btn.type = 'button';
        btn.setAttribute('aria-label', 'PANIC - All Notes Off');
        btn.title = 'PANIC - All Notes Off';
        // Warning glyph in warm amber (per CLAUDE.md "never use red text").
        // Red is reserved for border/glow only; glyph is high-contrast amber.
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 L22 21 L2 21 Z"/><line x1="12" y1="10" x2="12" y2="15"/><circle cx="12" cy="18" r="0.8" fill="currentColor"/></svg><span class="ssli-panic-overlay-label">' + SL.t('ui.button.panic_label') + '</span>';
        btn.addEventListener('click', function() {
            var registryFired = false;
            if (SL.PanicRegistry && SL.PanicRegistry.executePanic) {
                try {
                    SL.PanicRegistry.executePanic(false, false);
                    registryFired = true;
                } catch (regErr) {
                    console.warn('[panic-overlay] registry error:', regErr);
                }
            }
            // Belt-and-suspenders: legacy sweep. _performPanic() also calls
            // PanicRegistry internally; that is fine — panic is idempotent.
            try {
                _performPanic();
            } catch (legacyErr) {
                console.warn('[panic-overlay] legacy sweep error:', legacyErr);
            }
            // Visual confirmation flash (green to confirm fire).
            btn.classList.add(PANIC_FLASH_CLASS);
            setTimeout(function() {
                btn.classList.remove(PANIC_FLASH_CLASS);
            }, PANIC_FLASH_MS);
            if (!registryFired) {
                console.warn('[panic-overlay] PanicRegistry unavailable — relied on legacy sweep only');
            }
        });
        app.appendChild(btn);
    }

    // --------------------------------------------------------
    // Stage-readable current-preset banner (v1.5.804)
    //
    // Fixed top-strip inside #ssli-app displaying engine/preset/octave
    // in bright cyan on near-black. Designed to be legible at 3 ft.
    // Updates on SL.state 'preset' / 'instrument' / 'surface' changes
    // plus a lightweight polling loop for octave changes (which happen
    // inside screenPlay closure without a state notification).
    // --------------------------------------------------------

    var STAGE_BANNER_ID = 'ssliStageBanner';
    var STAGE_BANNER_POLL_MS = 500;
    var _stageBannerPollId = null;

    // Engine type -> stage display label. Uppercased for readability.
    var ENGINE_DISPLAY = {
        'subtractive': 'SUBTRACTIVE',
        'fm': 'FM',
        'physical': 'PHYSICAL',
        'additive': 'ADDITIVE',
        'granular': 'GRANULAR',
        'vocoder': 'VOCODER',
        'wavefolder': 'WAVEFOLDER',
        'formant': 'FORMANT',
        'modal': 'MODAL',
        'ringmod': 'RING MOD',
        'chord': 'CHORD',
        'superwave': 'SUPERWAVE',
        'wavetable': 'WAVETABLE',
        'phasedist': 'PHASE DIST',
        'chip': 'CHIP',
        'bytebeat': 'BYTEBEAT',
        'vector': 'VECTOR',
        'drumsyn': 'DRUMSYN',
        'pulsar': 'PULSAR',
        'reed': 'REED'
    };

    function _resolveEngineLabel() {
        var label = 'SYNTH';
        if (SL.audio && SL.audio.getCurrentInstrument && SL.audio.getInstrumentType) {
            var instId = SL.audio.getCurrentInstrument();
            var type = SL.audio.getInstrumentType(instId);
            if (type && ENGINE_DISPLAY[type]) {
                var translated = SL.t('engine.' + type, ENGINE_DISPLAY[type]);
                label = translated.toUpperCase();
            } else if (type) {
                label = String(type).toUpperCase();
            }
        }
        return label;
    }

    function _resolvePresetName() {
        var name = 'Preset';
        if (SL.audio && SL.audio.getInstruments && SL.audio.getCurrentInstrument) {
            var insts = SL.audio.getInstruments();
            var id = SL.audio.getCurrentInstrument();
            var inst = (insts && insts[id]) ? insts[id] : null;
            if (inst) {
                if (inst.settings && inst.settings.presetName) {
                    name = inst.settings.presetName;
                } else if (inst.name) {
                    name = inst.name;
                }
            }
        }
        return name;
    }

    function _resolveOctaveRange() {
        // The Play screen renders an #ssliOctRange span. Read its text as the
        // canonical display so the banner matches what the user sees below.
        var el = document.getElementById('ssliOctRange');
        var range = '';
        if (el && el.textContent) {
            range = el.textContent;
        }
        return range;
    }

    function _refreshStageBanner() {
        var bar = document.getElementById(STAGE_BANNER_ID);
        if (!bar) { return; }
        var engineEl = bar.querySelector('.ssli-stage-engine');
        var presetEl = bar.querySelector('.ssli-stage-preset');
        var octEl = bar.querySelector('.ssli-stage-octave');
        if (engineEl) { engineEl.textContent = _resolveEngineLabel(); }
        if (presetEl) { presetEl.textContent = _resolvePresetName(); }
        if (octEl) {
            var range = _resolveOctaveRange();
            octEl.textContent = range || '';
            octEl.style.display = range ? '' : 'none';
        }
    }

    function createStageBanner() {
        var app = document.getElementById(APP_ID);
        if (!app) { return; }
        if (document.getElementById(STAGE_BANNER_ID)) { return; }
        var bar = document.createElement('div');
        bar.id = STAGE_BANNER_ID;
        bar.className = 'ssli-stage-banner';
        bar.setAttribute('aria-live', 'polite');
        bar.setAttribute('aria-label', 'Current engine and preset');
        var engineEl = document.createElement('div');
        engineEl.className = 'ssli-stage-engine';
        engineEl.textContent = _resolveEngineLabel();
        var presetEl = document.createElement('div');
        presetEl.className = 'ssli-stage-preset';
        presetEl.textContent = _resolvePresetName();
        var octEl = document.createElement('div');
        octEl.className = 'ssli-stage-octave';
        octEl.textContent = _resolveOctaveRange();
        bar.appendChild(engineEl);
        bar.appendChild(presetEl);
        bar.appendChild(octEl);
        app.appendChild(bar);

        // React to state changes emitted by preset/instrument flows.
        if (SL.state && SL.state.onChange) {
            SL.state.onChange(function(what) {
                if (what === 'preset' || what === 'instrument' || what === 'surface') {
                    _refreshStageBanner();
                }
            });
        }
        // Poll for octave range (changed inside screenPlay closure).
        if (_stageBannerPollId) { clearInterval(_stageBannerPollId); }
        _stageBannerPollId = setInterval(_refreshStageBanner, STAGE_BANNER_POLL_MS);
    }

    // --------------------------------------------------------
    // Home / Return Button
    // --------------------------------------------------------

    function createHomeButton() {
        var nav = document.getElementById(NAV_ELEMENT_ID);
        if (!nav) {
            return;
        }

        // Create home button
        var homeBtn = document.createElement('button');
        homeBtn.className = 'ssli-nav-home-btn';
        homeBtn.type = 'button';
        homeBtn.setAttribute('aria-label', 'Return to landing page');
        homeBtn.title = 'Return to landing page';
        homeBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12l9-9 9 9"/><path d="M5 10v10a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1V10"/></svg><span class="ssli-nav-label">' + SL.t('ui.button.home') + '</span>';
        homeBtn.addEventListener('click', function() {
            _returnToLanding();
        });

        // Create divider
        var divider = document.createElement('div');
        divider.className = 'ssli-nav-home-divider';

        // Insert home button and divider at the top of the nav
        nav.insertBefore(divider, nav.firstChild);
        nav.insertBefore(homeBtn, nav.firstChild);
    }

    function _returnToLanding() {
        // Deactivate current screen
        var currentMod = _screenModules[_currentScreen];
        if (currentMod && currentMod.deactivate) {
            currentMod.deactivate();
        }

        // Stop all audio
        _performPanic();

        // Hide app, show landing
        var app = document.getElementById(APP_ID);
        var landing = document.getElementById(LANDING_ID);
        if (app) {
            app.style.display = 'none';
        }
        if (landing) {
            landing.style.display = '';
        }
        _appVisible = false;

        // Remove body class that hides SSLU hamburger
        document.body.classList.remove('ssli-app-active');
    }

    // --------------------------------------------------------
    // Init
    // --------------------------------------------------------

    function init() {
        // Global iOS touch prevention — block contextmenu/selectstart on ALL elements.
        // This prevents the "Copy / Look Up / Translate / Search Web" popup on long-press.
        // Inputs/textareas are excluded so they remain interactive if ever added.
        document.addEventListener('contextmenu', function(e) {
            var tag = e.target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') { return; }
            e.preventDefault();
        });
        document.addEventListener('selectstart', function(e) {
            var tag = e.target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') { return; }
            e.preventDefault();
        });

        // Wire up Play Music button
        var playBtn = document.getElementById(PLAY_BTN_ID);
        if (playBtn) {
            playBtn.addEventListener('click', function() {
                _enterApp();
            });
        }

        // Wire up nav buttons
        var navButtons = _getNavButtons();
        for (var i = 0; i < navButtons.length; i++) {
            (function(btn) {
                btn.addEventListener('click', function() {
                    var screen = btn.getAttribute('data-screen');
                    if (screen) {
                        switchTo(screen);
                    }
                });
            })(navButtons[i]);
        }

        // Orientation change detection
        window.addEventListener('resize', _checkOrientation);
        window.addEventListener('orientationchange', _checkOrientation);

        // Initialize core non-audio modules
        if (SL.tuning && SL.tuning.init) { SL.tuning.init(); }
        if (SL.analyzer && SL.analyzer.init) { SL.analyzer.init(); }
        if (SL.midi && SL.midi.setup) { SL.midi.setup(); }

        // Register screen modules if they exist
        for (var s = 0; s < SCREEN_IDS.length; s++) {
            var name = SCREEN_IDS[s];
            // Convert to camelCase module name: 'play' -> 'screenPlay'
            var modName = 'screen' + name.charAt(0).toUpperCase() + name.slice(1);
            if (SL[modName]) {
                registerScreen(name, SL[modName]);
            }
        }

        if (SL.localization && SL.localization.onLanguageChange) {
            SL.localization.onLanguageChange(function() {
                _refreshStageBanner();
                var homeLabel = document.querySelector('.ssli-nav-home-btn .ssli-nav-label');
                if (homeLabel) { homeLabel.textContent = SL.t('ui.button.home', 'Home'); }
                var panicLabel = document.querySelector('.ssli-panic-overlay-label');
                if (panicLabel) { panicLabel.textContent = SL.t('ui.button.panic_label', 'PANIC'); }
            });
        }
    }

    return {
        init: init,
        registerScreen: registerScreen,
        switchTo: switchTo,
        getCurrent: getCurrent,
        createHomeButton: createHomeButton,
        createMuteButton: createMuteButton,
        createStageBanner: createStageBanner,
        enterApp: _enterApp,
        isAudioInitialized: function() { return _audioInitialized; },
        panic: _performPanic
    };
})();
