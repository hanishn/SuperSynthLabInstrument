// Super Synth Lab Universe - Quad Layout Manager
// Manages the 2x2 quad layout system for cross-platform UI.
// Each workflow registers up to 4 quads. The presenter arranges them
// based on the current platform tier.
// ES5 compatible (var, no arrow functions, no template literals)

var SynthLab = window.SynthLab || {};

SynthLab.quad = (function() {
    'use strict';

    // ========================================================================
    // Platform Tiers
    // ========================================================================
    var TIER_PHONE      = 'phone';       // < 480px
    var TIER_PHONE_LAND = 'phone-land';  // 480-767px
    var TIER_TABLET     = 'tablet';      // 768-1023px
    var TIER_TABLET_LAND= 'tablet-land'; // 1024-1199px
    var TIER_DESKTOP    = 'desktop';     // >= 1200px

    var _currentTier = TIER_DESKTOP;
    var _workflows = {};       // workflowId -> { quads: [el, el, el, el], count: N, labels: [] }
    var _activeWorkflow = null;
    var _activeQuadIndex = 0;  // For single-pane mode (phone)
    var _dotToggle = null;     // The floating dot toggle element
    var _swipeStartX = 0;
    var _swipeStartY = 0;
    var _swipeThreshold = 50;

    // ========================================================================
    // Tier Detection
    // ========================================================================

    function _detectTier() {
        var w = window.innerWidth || document.documentElement.clientWidth || 960;
        var h = window.innerHeight || document.documentElement.clientHeight || 640;
        if (w < 480) return TIER_PHONE;
        // Landscape phone: wider than 480 but height is short (phone rotated sideways)
        // Covers iPhone 14 (844x390), iPhone SE (667x375), etc.
        if (w < 768) return TIER_PHONE_LAND;
        if (h < 500 && w > h) return TIER_PHONE_LAND;
        if (w < 1024) return TIER_TABLET;
        if (w < 1200) return TIER_TABLET_LAND;
        return TIER_DESKTOP;
    }

    function _updateTier() {
        var newTier = _detectTier();
        if (newTier !== _currentTier) {
            _currentTier = newTier;
            document.documentElement.setAttribute('data-layout', _currentTier);
            _applyLayout();
        }
        // Always update rotation overlay and hamburger state
        _syncPhoneUI();
    }

    // ========================================================================
    // Phone UI: Rotate Overlay + Hamburger Button
    // ========================================================================

    var _rotateOverlay = null;
    var _hamburgerBtn = null;

    function _syncPhoneUI() {
        if (_currentTier === TIER_PHONE) {
            _showRotateOverlay();
            _hideHamburgerBtn();
        } else {
            _hideRotateOverlay();
            if (_currentTier === TIER_PHONE_LAND) {
                _showHamburgerBtn();
            } else {
                _hideHamburgerBtn();
            }
        }
    }

    function _showRotateOverlay() {
        if (!_rotateOverlay) {
            _rotateOverlay = document.getElementById('sslu-rotate-overlay');
        }
        if (_rotateOverlay) {
            _rotateOverlay.style.display = '';
        }
    }

    function _hideRotateOverlay() {
        if (!_rotateOverlay) {
            _rotateOverlay = document.getElementById('sslu-rotate-overlay');
        }
        if (_rotateOverlay) {
            _rotateOverlay.style.display = 'none';
        }
    }

    function _createHamburgerBtn() {
        if (_hamburgerBtn) return;
        _hamburgerBtn = document.createElement('button');
        _hamburgerBtn.className = 'sslu-hamburger-btn';
        _hamburgerBtn.textContent = '\u2302';
        _hamburgerBtn.setAttribute('aria-label', 'Open navigation menu');
        _hamburgerBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            _openHamburgerOverlay();
        });
        document.body.appendChild(_hamburgerBtn);
    }

    function _showHamburgerBtn() {
        _createHamburgerBtn();
        // Hide if sidebar is currently in fullscreen overlay mode
        var sb = document.getElementById('ssl-sidebar');
        if (sb && sb.classList.contains('fullscreen')) {
            _hamburgerBtn.style.display = 'none';
        } else {
            _hamburgerBtn.style.display = 'block';
        }
    }

    function _hideHamburgerBtn() {
        if (_hamburgerBtn) {
            _hamburgerBtn.style.display = 'none';
        }
    }

    function _openHamburgerOverlay() {
        var sb = document.getElementById('ssl-sidebar');
        if (!sb) return;
        // Force animation restart: remove fullscreen, force reflow, re-add
        sb.classList.remove('fullscreen');
        void sb.offsetHeight; // trigger reflow
        sb.classList.add('fullscreen');
        sb.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;width:100%;min-width:100%;z-index:10000;background:#0a0a1a;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:16px 24px 6px;overflow-x:hidden;overflow-y:auto;-webkit-overflow-scrolling:touch;';
        if (_hamburgerBtn) {
            _hamburgerBtn.style.display = 'none';
        }
        // Hide screens while overlay is open
        var screensEl = document.getElementById('ssl-screens');
        if (screensEl) {
            screensEl.style.display = 'none';
        }
        // Reset fullscreen exit flag so screen-manager can dismiss again
        if (SL.screens && SL.screens.resetFullscreenExit) {
            SL.screens.resetFullscreenExit();
        }
    }

    // ========================================================================
    // Registration
    // ========================================================================

    /**
     * Register a workflow's quads.
     * @param {string} workflowId - e.g. 'design', 'rhythm', 'kids'
     * @param {Object} opts
     * @param {HTMLElement[]} opts.quads - Array of 1-4 quad container elements
     * @param {string[]} [opts.labels] - Short labels for dot toggle tooltips
     */
    function register(workflowId, opts) {
        var quads = opts.quads || [];
        var labels = opts.labels || [];
        var count = 0;
        for (var i = 0; i < quads.length; i++) {
            if (quads[i]) {
                count++;
                quads[i].classList.add('sslu-quad');
                quads[i].setAttribute('data-quad-index', String(i));
            }
        }
        _workflows[workflowId] = {
            quads: quads,
            count: count,
            labels: labels
        };
    }

    // ========================================================================
    // Activation
    // ========================================================================

    function activate(workflowId) {
        _activeWorkflow = workflowId;
        _activeQuadIndex = 0;
        _applyLayout();
    }

    function deactivate() {
        _activeWorkflow = null;
        _hideDotToggle();
    }

    // ========================================================================
    // Layout Application
    // ========================================================================

    function _isPhoneTier() {
        return _currentTier === TIER_PHONE || _currentTier === TIER_PHONE_LAND;
    }

    function _isPhoneLandTier() {
        return _currentTier === TIER_PHONE_LAND;
    }

    /**
     * Get the active row index (0=top, 1=bottom) for phone-land 1x2 mode.
     * Row 0 shows quads 0+1, row 1 shows quads 2+3.
     */
    function _getActiveRow() {
        return _activeQuadIndex < 2 ? 0 : 1;
    }

    function _applyLayout() {
        if (!_activeWorkflow || !_workflows[_activeWorkflow]) return;

        var wf = _workflows[_activeWorkflow];
        var quads = wf.quads;

        if (_isPhoneTier()) {
            // Phone (portrait + landscape): single-pane mode, show only the active quad
            for (var j = 0; j < quads.length; j++) {
                if (quads[j]) {
                    quads[j].style.display = (j === _activeQuadIndex) ? '' : 'none';
                    quads[j].classList.toggle('sslu-quad-active', j === _activeQuadIndex);
                }
            }
            _showDotToggle(wf);
        } else {
            // Grid mode: show all quads
            for (var k = 0; k < quads.length; k++) {
                if (quads[k]) {
                    quads[k].style.display = '';
                    quads[k].classList.remove('sslu-quad-active');
                }
            }
            _hideDotToggle();
        }
    }

    // ========================================================================
    // Quad Icon Map (symbols for non-readers)
    // ========================================================================

    var QUAD_ICONS = {
        'Keyboard': '\u266B',
        'Controls': '\u2699',
        'Scope': '\u223F',
        'Mixer': '\u2261',
        'Effects': '\u2727',
        'Macros': '\u25CE',
        'Sequencer': '\u25A6',
        'Engine': '\u2699',
        'Type': '\u25B6',
        'Filter': '\u25BC',
        'Preview': '\u266B',
        'Grid': '\u25A6',
        'Euclidean': '\u25CB',
        'Patterns': '\u2630',
        'Chords': '\u266C',
        'Key': '\u266F',
        'Progression': '\u2192',
        'Presets': '\u2605',
        'Playback': '\u25B6',
        'Export': '\u21E5',
        'Radar': '\u25CE',
        'Palette': '\u25A0',
        'Sounds': '\u266B',
        'Drums': '\u25CF',
        'FX': '\u2727',
        'Transport': '\u25B6',
        'Layers': '\u2261',
        'Canvas': '\u25A1',
        'Nodes': '\u2B22',
        'Properties': '\u2699',
        'default': '\u25CF'
    };

    // ========================================================================
    // Dot Toggle (Phone Mode)
    // ========================================================================

    function _createDotToggle() {
        if (_dotToggle) return;

        _dotToggle = document.createElement('div');
        _dotToggle.className = 'sslu-dot-toggle';
        _dotToggle.setAttribute('role', 'navigation');
        _dotToggle.setAttribute('aria-label', 'Quad switcher');
        document.body.appendChild(_dotToggle);
    }

    function _showDotToggle(wf) {
        _createDotToggle();
        if (wf.count < 2) {
            _dotToggle.style.display = 'none';
            return;
        }

        var html = '';
        _dotToggle.classList.remove('sslu-dot-toggle-rows');
        for (var i = 0; i < wf.quads.length; i++) {
            if (!wf.quads[i]) continue;
            var isActive = (i === _activeQuadIndex);
            var label = (wf.labels && wf.labels[i]) ? wf.labels[i] : ('Q' + (i + 1));
            var dotIcon = QUAD_ICONS[label] || QUAD_ICONS['default'];
            html += '<button class="sslu-dot' + (isActive ? ' active' : '') +
                    '" data-quad="' + i + '" title="' + label +
                    '" aria-label="' + label + '"' +
                    (isActive ? ' aria-current="true"' : '') +
                    '>' + dotIcon + '</button>';
        }
        _dotToggle.innerHTML = html;
        _dotToggle.style.display = '';

        // Attach click handlers
        var dots = _dotToggle.querySelectorAll('.sslu-dot');
        for (var d = 0; d < dots.length; d++) {
            (function(dot) {
                dot.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var idx = parseInt(dot.getAttribute('data-quad'), 10);
                    _switchQuad(idx);
                });
            })(dots[d]);
        }
    }

    function _hideDotToggle() {
        if (_dotToggle) {
            _dotToggle.style.display = 'none';
        }
    }

    function _switchQuad(index) {
        if (!_activeWorkflow || !_workflows[_activeWorkflow]) return;
        var wf = _workflows[_activeWorkflow];
        if (index < 0 || index >= wf.quads.length || !wf.quads[index]) return;

        var oldIndex = _activeQuadIndex;

        // Slide transition on phone tiers (Fix 28)
        if (_isPhoneTier() && oldIndex !== index && wf.quads[oldIndex]) {
            var outgoing = wf.quads[oldIndex];
            var incoming = wf.quads[index];
            var slideDir = (index > oldIndex) ? -1 : 1;

            // Show incoming off-screen
            incoming.style.display = '';
            incoming.style.transition = 'none';
            incoming.style.transform = 'translateX(' + (-slideDir * 100) + '%)';

            // Animate outgoing out
            outgoing.style.transition = 'transform 150ms ease-out';
            outgoing.style.transform = 'translateX(' + (slideDir * 100) + '%)';

            // Animate incoming in
            requestAnimationFrame(function() {
                incoming.style.transition = 'transform 150ms ease-out';
                incoming.style.transform = 'translateX(0)';
            });

            // Clean up after transition
            setTimeout(function() {
                outgoing.style.display = 'none';
                outgoing.style.transition = '';
                outgoing.style.transform = '';
                incoming.style.transition = '';
                incoming.style.transform = '';
            }, 160);

            _activeQuadIndex = index;
            // Update dot toggle without full layout reapply
            _showDotToggle(wf);
        } else {
            _activeQuadIndex = index;
            _applyLayout();
        }
    }

    // ========================================================================
    // Swipe Handling (Phone Mode)
    // ========================================================================

    // Check if a touch target is an interactive element that should block swipe
    function _isInteractiveTarget(el) {
        while (el && el !== document.body) {
            var tag = el.tagName;
            if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'CANVAS') return true;
            if (tag === 'BUTTON' && !el.classList.contains('sslu-dot')) return true;
            // Piano keys, drum pads, sound buttons, sliders, knobs
            var cls = el.className || '';
            if (cls.indexOf('key') !== -1 || cls.indexOf('pad') !== -1 ||
                cls.indexOf('fader') !== -1 || cls.indexOf('knob') !== -1 ||
                cls.indexOf('slider') !== -1 || cls.indexOf('btn') !== -1 ||
                cls.indexOf('sound') !== -1 || cls.indexOf('chord') !== -1 ||
                cls.indexOf('grid-cell') !== -1 || cls.indexOf('iso-') !== -1) return true;
            el = el.parentNode;
        }
        return false;
    }

    function _initSwipe() {
        var _swipeBlocked = false;

        document.addEventListener('touchstart', function(e) {
            if (!_isPhoneTier() || !_activeWorkflow) return;
            // Block swipe if touch starts on an interactive element
            _swipeBlocked = _isInteractiveTarget(e.target);
            _swipeStartX = e.changedTouches[0].clientX;
            _swipeStartY = e.changedTouches[0].clientY;
        }, { passive: true });

        document.addEventListener('touchend', function(e) {
            if (!_isPhoneTier() || !_activeWorkflow) return;
            if (_swipeBlocked) return;
            if (!_workflows[_activeWorkflow]) return;

            var dx = e.changedTouches[0].clientX - _swipeStartX;
            var dy = e.changedTouches[0].clientY - _swipeStartY;
            var absDx = Math.abs(dx);
            var absDy = Math.abs(dy);

            // Require minimum swipe distance and dominant direction
            if (absDx < _swipeThreshold && absDy < _swipeThreshold) return;

            var wf = _workflows[_activeWorkflow];

            // Phone (both orientations): spatial 2D navigation
            var curRow = _activeQuadIndex < 2 ? 0 : 1; // 0=top, 1=bottom
            var curCol = _activeQuadIndex % 2;          // 0=left, 1=right
            var navRow = curRow;
            var navCol = curCol;

            if (absDx > absDy) {
                // Horizontal swipe
                if (dx < 0) { navCol = 1; } // swipe left -> go right
                else { navCol = 0; }         // swipe right -> go left
            } else {
                // Vertical swipe
                if (dy < 0) { navRow = 1; } // swipe up -> go down
                else { navRow = 0; }         // swipe down -> go up
            }

            var newIndex = navRow * 2 + navCol;
            if (newIndex !== _activeQuadIndex && newIndex < wf.quads.length && wf.quads[newIndex]) {
                _switchQuad(newIndex);
            }
        }, { passive: true });
    }

    // ========================================================================
    // Helper: Create Quad Container
    // ========================================================================

    /**
     * Create a quad container div with standard classes.
     * @param {string} workflowId
     * @param {number} index - 0=TL, 1=TR, 2=BL, 3=BR
     * @param {string} [extraClass] - Additional CSS class
     * @returns {HTMLElement}
     */
    function createQuad(workflowId, index, extraClass) {
        var el = document.createElement('div');
        el.className = 'sslu-quad sslu-quad-' + index;
        if (extraClass) {
            el.className += ' ' + extraClass;
        }
        el.setAttribute('data-workflow', workflowId);
        el.setAttribute('data-quad-index', String(index));
        return el;
    }

    /**
     * Create a standard quad wrapper that holds all quads for a workflow.
     * This is the parent grid container.
     * @param {string} workflowId
     * @returns {HTMLElement}
     */
    function createWrapper(workflowId) {
        var el = document.createElement('div');
        el.className = 'sslu-quad-wrapper';
        el.setAttribute('data-workflow', workflowId);
        return el;
    }

    // ========================================================================
    // Init
    // ========================================================================

    /**
     * iOS AudioContext resume on first user gesture.
     * iOS Safari suspends AudioContext until a touch/click event handler calls resume().
     */
    function _initIOSAudioResume() {
        // Resume audio on first user gesture (iOS requires this)
        var firstGestureHandled = false;
        function resumeAudioOnGesture() {
            if (firstGestureHandled) return;
            firstGestureHandled = true;
            _tryResumeAudio();
            document.removeEventListener('touchstart', resumeAudioOnGesture, true);
            document.removeEventListener('click', resumeAudioOnGesture, true);
        }
        document.addEventListener('touchstart', resumeAudioOnGesture, true);
        document.addEventListener('click', resumeAudioOnGesture, true);

        // Re-resume audio when returning from background/sleep
        document.addEventListener('visibilitychange', function() {
            if (document.visibilityState === 'visible') {
                _tryResumeAudio();
                _requestWakeLock();
            }
        });

        // Also listen for page focus
        window.addEventListener('focus', function() {
            _tryResumeAudio();
        });
    }

    function _tryResumeAudio() {
        if (window.SynthLab && SynthLab.audio && SynthLab.audio.getCtx) {
            try {
                var ctx = SynthLab.audio.getCtx();
                if (ctx && ctx.state === 'suspended') {
                    ctx.resume();
                }
                // Listen for future suspensions
                if (ctx && !ctx._ssluStateListener) {
                    ctx._ssluStateListener = true;
                    ctx.addEventListener('statechange', function() {
                        if (ctx.state === 'suspended' && document.visibilityState === 'visible') {
                            ctx.resume();
                        }
                    });
                }
            } catch (e) {
                // Context may not be ready yet
            }
        }
    }

    // Screen Wake Lock API — prevents screen from sleeping during audio playback
    var _wakeLock = null;
    function _requestWakeLock() {
        if ('wakeLock' in navigator) {
            navigator.wakeLock.request('screen').then(function(lock) {
                _wakeLock = lock;
                _wakeLock.addEventListener('release', function() {
                    _wakeLock = null;
                });
            }).catch(function() {
                // Wake lock not available or denied
            });
        }
    }

    // ========================================================================
    // Tab Visibility Manager
    // ========================================================================
    var SL = window.SynthLab || {};
    SL._tabVisible = true;

    function _initVisibilityManager() {
        document.addEventListener('visibilitychange', function() {
            SL._tabVisible = !document.hidden;
        });
    }

    // ========================================================================
    // Wake Lock Silence Detection
    // ========================================================================
    var _silenceTimerId = null;
    var SILENCE_TIMEOUT_MS = 30000;

    function _resetSilenceTimer() {
        if (_silenceTimerId) {
            clearTimeout(_silenceTimerId);
        }
        _silenceTimerId = setTimeout(function() {
            if (_wakeLock) {
                _wakeLock.release().catch(function() {});
                _wakeLock = null;
            }
        }, SILENCE_TIMEOUT_MS);
    }

    /**
     * Called externally on noteOn to re-acquire wake lock and reset silence timer.
     */
    function onNoteActivity() {
        _resetSilenceTimer();
        if (!_wakeLock && 'wakeLock' in navigator) {
            _requestWakeLock();
        }
    }

    function init() {
        _currentTier = _detectTier();
        document.documentElement.setAttribute('data-layout', _currentTier);
        _syncPhoneUI();
        window.addEventListener('resize', _updateTier);
        window.addEventListener('orientationchange', function() {
            // Delay slightly for orientation to settle
            setTimeout(_updateTier, 100);
        });
        _initSwipe();
        _initIOSAudioResume();
        _requestWakeLock();
        _initVisibilityManager();
        _resetSilenceTimer();

        // Prevent accidental tab close during performance
        window.addEventListener('beforeunload', function(e) {
            e.preventDefault();
            e.returnValue = '';
        });

        // Global panic: Escape kills all notes (delegates to screen manager if available)
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                if (SL.screens && SL.screens.panic) {
                    SL.screens.panic();
                } else {
                    if (SL.audio && SL.audio.stopAllSustained) {
                        SL.audio.stopAllSustained();
                    }
                    if (SL.midi && SL.midi.panic) {
                        SL.midi.panic();
                    }
                }
            }
        });
    }

    // ========================================================================
    // Public API
    // ========================================================================

    return {
        TIER_PHONE: TIER_PHONE,
        TIER_PHONE_LAND: TIER_PHONE_LAND,
        TIER_TABLET: TIER_TABLET,
        TIER_TABLET_LAND: TIER_TABLET_LAND,
        TIER_DESKTOP: TIER_DESKTOP,

        init: init,
        register: register,
        activate: activate,
        deactivate: deactivate,
        createQuad: createQuad,
        createWrapper: createWrapper,
        switchQuad: _switchQuad,
        getTier: function() { return _currentTier; },
        isPhone: _isPhoneTier,
        getActiveQuadIndex: function() { return _activeQuadIndex; },
        showHamburgerBtn: _showHamburgerBtn,
        hideHamburgerBtn: _hideHamburgerBtn,
        onNoteActivity: onNoteActivity
    };
})();
