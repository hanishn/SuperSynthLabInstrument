/**
 * SSLI Localization Infrastructure
 *
 * Provides SL.t(key, fallback) for universal string lookup with
 * dot-notation key resolution and multi-language fallback chain:
 *   current language -> English -> fallback param -> key itself
 *
 * ES5 only. No arrow functions, no const/let, no template literals.
 */
(function() {
    var SL = window.SynthLab = window.SynthLab || {};

    var STORAGE_KEY = 'ssli-lang';
    var DEFAULT_LANG = 'en';

    var _currentLang = DEFAULT_LANG;
    var _strings = {};
    var _changeCallbacks = [];

    /**
     * Resolve a dot-notation key against an object tree.
     * e.g. resolve('ui.panic', {ui: {panic: 'Stop'}}) => 'Stop'
     * Returns undefined if any segment is missing.
     */
    function _resolve(key, obj) {
        var result;
        if (obj) {
            var parts = key.split('.');
            var cursor = obj;
            var found = true;
            var partIndex = 0;
            while (partIndex < parts.length && found) {
                if (cursor !== null && typeof cursor === 'object' && parts[partIndex] in cursor) {
                    cursor = cursor[parts[partIndex]];
                } else {
                    found = false;
                }
                partIndex = partIndex + 1;
            }
            if (found) {
                result = cursor;
            }
        }
        return result;
    }

    /**
     * Look up a localized string by dot-notation key.
     * Fallback chain: current language -> English -> fallback -> key.
     */
    function t(key, fallback) {
        var value;
        var langData = _strings[_currentLang];
        var enData = _strings[DEFAULT_LANG];

        // Try current language first
        value = _resolve(key, langData);

        // Fall back to English if current language didn't have it
        if (value === undefined && _currentLang !== DEFAULT_LANG) {
            value = _resolve(key, enData);
        }

        // Fall back to explicit fallback parameter
        if (value === undefined && fallback !== undefined) {
            value = fallback;
        }

        // Last resort: return the key itself
        if (value === undefined) {
            value = key;
        }

        return value;
    }

    SL.localization = {
        _currentLang: _currentLang,
        _strings: _strings,

        /**
         * Register a language's string map.
         * @param {string} langCode - Language code (e.g. 'en', 'ja', 'de')
         * @param {object} data - The string map object
         */
        loadLanguage: function(langCode, data) {
            _strings[langCode] = data;
        },

        /**
         * Switch the active language.
         * Stores preference in localStorage and fires change callbacks.
         * @param {string} langCode - Language code to switch to
         */
        setLanguage: function(langCode) {
            _currentLang = langCode;
            SL.localization._currentLang = langCode;

            try {
                localStorage.setItem(STORAGE_KEY, langCode);
            } catch (e) {
                // localStorage may be unavailable in some contexts
            }

            var callbackIndex = 0;
            while (callbackIndex < _changeCallbacks.length) {
                try {
                    _changeCallbacks[callbackIndex](langCode);
                } catch (e) {
                    console.error('Localization change callback error:', e);
                }
                callbackIndex = callbackIndex + 1;
            }
        },

        /**
         * Returns the current language code.
         * @returns {string}
         */
        getLanguage: function() {
            return _currentLang;
        },

        /**
         * Register a callback to be fired when the language changes.
         * @param {function} callback - Function receiving the new langCode
         */
        onLanguageChange: function(callback) {
            if (typeof callback === 'function') {
                _changeCallbacks.push(callback);
            }
        },

        /**
         * Look up a localized string. Shorthand also available as SL.t().
         */
        t: t
    };

    // Top-level shortcut
    SL.t = t;

    // Restore saved language preference on init
    try {
        var savedLang = localStorage.getItem(STORAGE_KEY);
        if (savedLang && typeof savedLang === 'string') {
            _currentLang = savedLang;
            SL.localization._currentLang = savedLang;
        }
    } catch (e) {
        // localStorage unavailable
    }

    // Auto-load inlined English strings if available (build script inlines
    // data before JS files, so SynthLab._data.langEn exists at this point)
    if (window.SynthLab && SynthLab._data && SynthLab._data.langEn) {
        SL.localization.loadLanguage('en', SynthLab._data.langEn);
    }

    if (window.SynthLab && SynthLab._data && SynthLab._data.langEs) {
        SL.localization.loadLanguage('es', SynthLab._data.langEs);
    }

    if (window.SynthLab && SynthLab._data && SynthLab._data.langFr) {
        SL.localization.loadLanguage('fr', SynthLab._data.langFr);
    }

    if (window.SynthLab && SynthLab._data && SynthLab._data.langIt) {
        SL.localization.loadLanguage('it', SynthLab._data.langIt);
    }

    if (window.SynthLab && SynthLab._data && SynthLab._data.langDe) {
        SL.localization.loadLanguage('de', SynthLab._data.langDe);
    }

    if (window.SynthLab && SynthLab._data && SynthLab._data.langPt) {
        SL.localization.loadLanguage('pt', SynthLab._data.langPt);
    }

    if (window.SynthLab && SynthLab._data && SynthLab._data.langNl) {
        SL.localization.loadLanguage('nl', SynthLab._data.langNl);
    }

    if (window.SynthLab && SynthLab._data && SynthLab._data.langPl) {
        SL.localization.loadLanguage('pl', SynthLab._data.langPl);
    }

    if (window.SynthLab && SynthLab._data && SynthLab._data.langSv) {
        SL.localization.loadLanguage('sv', SynthLab._data.langSv);
    }

    if (window.SynthLab && SynthLab._data && SynthLab._data.langNo) {
        SL.localization.loadLanguage('no', SynthLab._data.langNo);
    }

    if (window.SynthLab && SynthLab._data && SynthLab._data.langDa) {
        SL.localization.loadLanguage('da', SynthLab._data.langDa);
    }

    if (window.SynthLab && SynthLab._data && SynthLab._data.langFi) {
        SL.localization.loadLanguage('fi', SynthLab._data.langFi);
    }

    if (window.SynthLab && SynthLab._data && SynthLab._data.langCs) {
        SL.localization.loadLanguage('cs', SynthLab._data.langCs);
    }

    if (window.SynthLab && SynthLab._data && SynthLab._data.langHu) {
        SL.localization.loadLanguage('hu', SynthLab._data.langHu);
    }

    if (window.SynthLab && SynthLab._data && SynthLab._data.langRo) {
        SL.localization.loadLanguage('ro', SynthLab._data.langRo);
    }

    if (window.SynthLab && SynthLab._data && SynthLab._data.langEl) {
        SL.localization.loadLanguage('el', SynthLab._data.langEl);
    }

    if (window.SynthLab && SynthLab._data && SynthLab._data.langTr) {
        SL.localization.loadLanguage('tr', SynthLab._data.langTr);
    }

    if (window.SynthLab && SynthLab._data && SynthLab._data.langRu) {
        SL.localization.loadLanguage('ru', SynthLab._data.langRu);
    }

    if (window.SynthLab && SynthLab._data && SynthLab._data.langKo) {
        SL.localization.loadLanguage('ko', SynthLab._data.langKo);
    }

    if (window.SynthLab && SynthLab._data && SynthLab._data.langTh) {
        SL.localization.loadLanguage('th', SynthLab._data.langTh);
    }

    if (window.SynthLab && SynthLab._data && SynthLab._data.langZhCN) {
        SL.localization.loadLanguage('zh-CN', SynthLab._data.langZhCN);
    }

    if (window.SynthLab && SynthLab._data && SynthLab._data.langJa) {
        SL.localization.loadLanguage('ja', SynthLab._data.langJa);
    }

    if (window.SynthLab && SynthLab._data && SynthLab._data.langAr) {
        SL.localization.loadLanguage('ar', SynthLab._data.langAr);
    }

    if (window.SynthLab && SynthLab._data && SynthLab._data.langHe) {
        SL.localization.loadLanguage('he', SynthLab._data.langHe);
    }

    if (window.SynthLab && SynthLab._data && SynthLab._data.langHi) {
        SL.localization.loadLanguage('hi', SynthLab._data.langHi);
    }

    if (window.SynthLab && SynthLab._data && SynthLab._data.langId) {
        SL.localization.loadLanguage('id', SynthLab._data.langId);
    }

    if (window.SynthLab && SynthLab._data && SynthLab._data.langVi) {
        SL.localization.loadLanguage('vi', SynthLab._data.langVi);
    }

    if (window.SynthLab && SynthLab._data && SynthLab._data.langUk) {
        SL.localization.loadLanguage('uk', SynthLab._data.langUk);
    }

    /**
     * Apply translations to all DOM elements with data-i18n attributes.
     * Called whenever the language changes.
     */
    SL.localization._applyDomTranslations = function() {
        var elements = document.querySelectorAll('[data-i18n]');
        var idx = 0;
        while (idx < elements.length) {
            var el = elements[idx];
            var key = el.getAttribute('data-i18n');
            if (key) {
                var translated = SL.t(key);
                if (translated !== key) {
                    el.textContent = translated;
                }
            }
            idx = idx + 1;
        }
    };

    /**
     * Wire up the landing-screen language selector buttons.
     * Each button has data-lang="xx" and gets an active highlight.
     */
    function _initLangSelector() {
        var container = document.getElementById('sslLangSelector');
        if (!container) {
            return;
        }

        var buttons = container.querySelectorAll('.ssl-lang-btn');

        // Set initial active state from saved language
        var currentLang = SL.localization.getLanguage();
        var btnIdx = 0;
        while (btnIdx < buttons.length) {
            var btnLang = buttons[btnIdx].getAttribute('data-lang');
            if (btnLang === currentLang) {
                buttons[btnIdx].classList.add('ssl-lang-active');
            } else {
                buttons[btnIdx].classList.remove('ssl-lang-active');
            }
            btnIdx = btnIdx + 1;
        }

        // Click handler — delegated on the container
        container.addEventListener('click', function(e) {
            var target = e.target;
            // Walk up to find the button element
            while (target && target !== container) {
                if (target.classList && target.classList.contains('ssl-lang-btn')) {
                    break;
                }
                target = target.parentElement;
            }

            if (!target || !target.classList || !target.classList.contains('ssl-lang-btn')) {
                return;
            }

            var lang = target.getAttribute('data-lang');
            if (!lang) {
                return;
            }

            // Update active class on all buttons
            var allBtns = container.querySelectorAll('.ssl-lang-btn');
            var i = 0;
            while (i < allBtns.length) {
                allBtns[i].classList.remove('ssl-lang-active');
                i = i + 1;
            }
            target.classList.add('ssl-lang-active');

            // Set the language (fires callbacks, stores to localStorage)
            SL.localization.setLanguage(lang);

            // Refresh data-i18n elements in the DOM
            SL.localization._applyDomTranslations();
        });

        // Also listen for programmatic language changes to keep selector in sync
        SL.localization.onLanguageChange(function(newLang) {
            var allBtns = container.querySelectorAll('.ssl-lang-btn');
            var j = 0;
            while (j < allBtns.length) {
                var bl = allBtns[j].getAttribute('data-lang');
                if (bl === newLang) {
                    allBtns[j].classList.add('ssl-lang-active');
                } else {
                    allBtns[j].classList.remove('ssl-lang-active');
                }
                j = j + 1;
            }
        });
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _initLangSelector);
    } else {
        _initLangSelector();
    }
})();
