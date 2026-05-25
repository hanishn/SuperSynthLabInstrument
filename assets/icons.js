// SSLU Icon System — SVG icon helper
// Returns inline SVG markup for universally understood icons.
// Usage: SL.icon('play') or SL.icon('save', 18)
// All icons use fill:currentColor so they inherit parent text color.
// ES5 compatible (var, no arrow functions, no template literals)

var SynthLab = window.SynthLab || {};

SynthLab.icons = (function() {
    'use strict';

    // SVG path data for each icon. viewBox is 0 0 24 24 unless noted.
    var ICONS = {
        // Transport
        play:       '<polygon points="6,4 20,12 6,20"/>',
        pause:      '<rect x="5" y="4" width="4" height="16"/><rect x="15" y="4" width="4" height="16"/>',
        stop:       '<rect x="5" y="5" width="14" height="14" rx="1"/>',
        record:     '<circle cx="12" cy="12" r="7"/>',

        // File operations
        save:       '<path d="M17 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V7l-4-4z"/>' +
                    '<path d="M7 3v5h8V3" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
                    '<rect x="7" y="14" width="10" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/>',
        load:       '<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>',
        trash:      '<polyline points="3,6 5,6 21,6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
                    '<path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" fill="none" stroke="currentColor" stroke-width="2"/>',
        'import':   '<path d="M12 3v12m0 0l-4-4m4 4l4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
                    '<path d="M3 17v2a2 2 0 002 2h14a2 2 0 002-2v-2" fill="none" stroke="currentColor" stroke-width="2"/>',
        'export':   '<path d="M12 19V7m0 0l-4 4m4-4l4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
                    '<path d="M3 17v2a2 2 0 002 2h14a2 2 0 002-2v-2" fill="none" stroke="currentColor" stroke-width="2"/>',

        // Actions
        clear:      '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>' +
                    '<line x1="8" y1="8" x2="16" y2="16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
                    '<line x1="16" y1="8" x2="8" y2="16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
        dice:       '<rect x="3" y="3" width="18" height="18" rx="3" fill="none" stroke="currentColor" stroke-width="2"/>' +
                    '<circle cx="8" cy="8" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="16" cy="16" r="1.5"/>' +
                    '<circle cx="16" cy="8" r="1.5"/><circle cx="8" cy="16" r="1.5"/>',
        refresh:    '<path d="M1 4v6h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
                    '<path d="M3.51 15a9 9 0 1014.85-3.36L23 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
        settings:   '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/>' +
                    '<path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33' +
                    ' 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83' +
                    'l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82' +
                    'l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51' +
                    ' 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4' +
                    'h-.09a1.65 1.65 0 00-1.51 1z" fill="none" stroke="currentColor" stroke-width="2"/>',

        // Toggles
        loop:       '<path d="M17 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
                    '<path d="M3 11V9a4 4 0 014-4h14" fill="none" stroke="currentColor" stroke-width="2"/>' +
                    '<path d="M7 22l-4-4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
                    '<path d="M21 13v2a4 4 0 01-4 4H3" fill="none" stroke="currentColor" stroke-width="2"/>',
        metronome:  '<path d="M12 2L7 22h10L12 2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
                    '<line x1="12" y1="10" x2="18" y2="5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
        arp:        '<polyline points="3,18 7,6 11,14 15,4 19,12 23,8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
        hold:       '<rect x="4" y="12" width="16" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>' +
                    '<path d="M8 12V8a4 4 0 018 0v4" fill="none" stroke="currentColor" stroke-width="2"/>',

        // Navigation
        arrowRight: '<line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
                    '<polyline points="12,5 19,12 12,19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
        arrowUp:    '<line x1="12" y1="19" x2="12" y2="5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
                    '<polyline points="5,12 12,5 19,12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
        arrowDown:  '<line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
                    '<polyline points="5,12 12,19 19,12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',

        // Info/UI
        info:       '<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/>' +
                    '<line x1="12" y1="16" x2="12" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
                    '<circle cx="12" cy="8" r="0.5"/>',
        contrast:   '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 3a9 9 0 010 18z"/>',

        // Music-specific
        octaveUp:   '<polyline points="6,15 12,9 18,15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
                    '<text x="12" y="22" text-anchor="middle" font-size="7" fill="currentColor">8va</text>',
        octaveDown: '<polyline points="6,6 12,12 18,6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
                    '<text x="12" y="22" text-anchor="middle" font-size="7" fill="currentColor">8vb</text>',

        // Tabs / categories
        patch:      '<rect x="3" y="3" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="2"/>' +
                    '<rect x="14" y="3" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="2"/>' +
                    '<rect x="3" y="14" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="2"/>' +
                    '<line x1="17.5" y1="14" x2="17.5" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
        score:      '<path d="M9 3v18m0-18l8 2v14l-8-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',

        // Sampler
        upload:     '<path d="M12 15V3m0 0l-4 4m4-4l4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
                    '<path d="M3 17v2a2 2 0 002 2h14a2 2 0 002-2v-2" fill="none" stroke="currentColor" stroke-width="2"/>'
    };

    /**
     * Get SVG markup for an icon.
     * @param {string} name - Icon name (e.g. 'play', 'save')
     * @param {number} [size] - Icon size in px (default 16)
     * @param {string} [cls] - Optional CSS class
     * @returns {string} SVG markup string
     */
    function icon(name, size, cls) {
        var paths = ICONS[name];
        if (!paths) return '';
        var s = size || 16;
        var className = cls ? ' class="' + cls + '"' : '';
        return '<svg xmlns="http://www.w3.org/2000/svg" width="' + s + '" height="' + s +
               '" viewBox="0 0 24 24" fill="currentColor"' + className +
               ' style="vertical-align:middle;flex-shrink:0" aria-hidden="true">' +
               paths + '</svg>';
    }

    /**
     * Get SVG icon with accessible label for standalone icon buttons.
     * @param {string} name - Icon name
     * @param {string} label - Accessible text label for aria-label/title
     * @param {number} [size] - Icon size
     * @returns {string} SVG markup with role="img" and aria-label
     */
    function iconLabeled(name, label, size) {
        var paths = ICONS[name];
        if (!paths) return '';
        var s = size || 16;
        return '<svg xmlns="http://www.w3.org/2000/svg" width="' + s + '" height="' + s +
               '" viewBox="0 0 24 24" fill="currentColor"' +
               ' role="img" aria-label="' + label + '"' +
               ' style="vertical-align:middle;flex-shrink:0">' +
               '<title>' + label + '</title>' +
               paths + '</svg>';
    }

    return {
        icon: icon,
        iconLabeled: iconLabeled,
        ICONS: ICONS
    };
})();

// Shorthand on SynthLab namespace
SynthLab.icon = SynthLab.icons.icon;
SynthLab.iconLabeled = SynthLab.icons.iconLabeled;
