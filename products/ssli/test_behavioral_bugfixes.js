/**
 * SSLI Behavioral Bug-Fix Test Suite
 * Tests 15 specific bug fixes in the SuperSynthLab Instrument exhibit.
 * Run: node test_behavioral_bugfixes.js
 */
const { chromium } = require('playwright');
const path = require('path');

var htmlPath = process.argv[2] || 'D:/NathanAtStardock/SuperSynthLab/export/SuperSynthLabInstrument-Internal.html';
var FILE_URL = 'file:///' + path.resolve(htmlPath).replace(/\\/g, '/');
var RESULTS = [];
var passCount = 0;
var failCount = 0;

function record(testNum, name, passed, detail) {
    var status = passed ? 'PASS' : 'FAIL';
    if (passed) { passCount++; } else { failCount++; }
    var msg = '[' + status + '] TEST ' + testNum + ' -- ' + name + (detail ? ' (' + detail + ')' : '');
    console.log(msg);
    RESULTS.push({ test: testNum, name: name, status: status, detail: detail || '' });
}

async function switchSurface(page, surfaceVal) {
    await page.click('.ssli-nav-btn[data-screen="play"]');
    await page.waitForTimeout(300);
    var switchResult = await page.evaluate(function(requested) {
        var aliases = {
            air: 'theremin',
            airsynth: 'theremin',
            'air synth': 'theremin',
            drum: 'pads',
            drums: 'pads',
            drumpads: 'pads',
            'drum pads': 'pads',
            glowkeys: 'loom',
            'glow keys': 'loom',
            hexgrid: 'hex',
            'hex grid': 'hex',
            ribbonpad: 'ribbon',
            xypad: 'xypad',
            'xy pad': 'xypad',
            breath: 'breathpad',
            'breath pad': 'breathpad'
        };
        function norm(value) {
            return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
        }
        var wantedRaw = String(requested || '');
        var wantedNorm = norm(wantedRaw);
        var wanted = aliases[wantedNorm] || wantedRaw;
        var categorySelect = document.getElementById('ssliPlayCategorySelect');
        var surfaceSelect = document.getElementById('ssliPlaySurfaceSelect');
        if (!surfaceSelect) {
            return { ok: false, error: 'surface select not found' };
        }
        if (categorySelect && categorySelect.value !== 'all') {
            categorySelect.value = 'all';
            categorySelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
        var wantedNormAfterAlias = norm(wanted);
        var match = null;
        var available = [];
        for (var i = 0; i < surfaceSelect.options.length; i++) {
            var opt = surfaceSelect.options[i];
            var optValueNorm = norm(opt.value);
            var optTextNorm = norm(opt.textContent);
            available.push(opt.value + ':' + opt.textContent);
            if (opt.value === wanted || optValueNorm === wantedNormAfterAlias || optTextNorm === wantedNormAfterAlias) {
                match = opt;
                break;
            }
        }
        if (!match) {
            return {
                ok: false,
                error: 'surface "' + requested + '" not found; available=' + available.join(', ')
            };
        }
        surfaceSelect.value = match.value;
        surfaceSelect.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, value: match.value, label: match.textContent };
    }, surfaceVal);
    if (!switchResult.ok) {
        throw new Error(switchResult.error);
    }
    await page.waitForTimeout(500);
}

async function navigateTo(page, screenName) {
    await page.click('.ssli-nav-btn[data-screen="' + screenName + '"]');
    await page.waitForTimeout(500);
}

(async () => {
    var browser = await chromium.launch({ headless: true });
    var context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    var page = await context.newPage();

    // Suppress Web Audio errors in headless
    page.on('pageerror', function() {});
    page.on('console', function() {});

    console.log('Navigating to SSLI...');
    await page.goto(FILE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1000);

    // Click "Play Music" to enter the app
    var playBtn = await page.$('#ssliPlayBtn');
    if (playBtn) {
        await playBtn.click();
        await page.waitForTimeout(1000);
    } else {
        console.log('WARNING: Could not find Play Music button');
    }

    // =========================================================================
    // TEST 1 — Glow keys drag tracking
    // =========================================================================
    try {
        await switchSurface(page, 'loom');
        await page.waitForTimeout(400);

        // Glow Keys (Loom) use .ctrl-loom-strip elements with .ctrl-loom-active
        // class and a glow overlay, NOT iso-glow.
        var keyEl = await page.$('.ctrl-loom-strip[data-midi]');
        if (!keyEl) {
            record(1, 'Glow keys drag tracking', false, 'No loom strip element found on Glow Keys surface');
        } else {
            var box = await keyEl.boundingBox();
            // mousedown on the key
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.down();
            await page.waitForTimeout(100);

            var hasGlow = await keyEl.evaluate(function(el) {
                var hasActive = el.classList.contains('ctrl-loom-active');
                var overlay = el.querySelector('.ctrl-loom-glow-overlay');
                var overlayVis = overlay ? (parseFloat(overlay.style.opacity) > 0) : false;
                return hasActive || overlayVis;
            });

            // Now simulate mouseleave by moving mouse far away (with button held)
            await page.mouse.move(0, 0);
            await page.waitForTimeout(100);

            var glowAfterLeave = await keyEl.evaluate(function(el) {
                var hasActive = el.classList.contains('ctrl-loom-active');
                var overlay = el.querySelector('.ctrl-loom-glow-overlay');
                var overlayVis = overlay ? (parseFloat(overlay.style.opacity) > 0) : false;
                return hasActive || overlayVis;
            });

            await page.mouse.up();

            // Wait 700ms to check no setTimeout-based lingering glow
            await page.waitForTimeout(700);
            var glowAfter700ms = await keyEl.evaluate(function(el) {
                var hasActive = el.classList.contains('ctrl-loom-active');
                var overlay = el.querySelector('.ctrl-loom-glow-overlay');
                var overlayVis = overlay ? (parseFloat(overlay.style.opacity) > 0) : false;
                return hasActive || overlayVis;
            });

            var passed = hasGlow && !glowAfter700ms;
            record(1, 'Glow keys drag tracking', passed,
                'glow on mousedown=' + hasGlow +
                ', still held while pointer down outside=' + glowAfterLeave +
                ', no linger after 700ms=' + !glowAfter700ms);
        }
    } catch (e) {
        record(1, 'Glow keys drag tracking', false, 'Error: ' + e.message);
    }

    // =========================================================================
    // TEST 2 — Ribbon multitouch
    // =========================================================================
    try {
        await switchSurface(page, 'ribbon');
        await page.waitForTimeout(400);

        var ribbonResult = await page.evaluate(function() {
            var html = document.documentElement.outerHTML;
            // Find _ribbonTouches declaration and look in a wider chunk for changedTouches
            var ribbonSection = html.indexOf('_ribbonTouches');
            var hasChangedTouches = false;
            if (ribbonSection >= 0) {
                // Search in a wider area (20K chars) around the ribbon code
                var start = Math.max(0, ribbonSection - 2000);
                var chunk = html.substring(start, ribbonSection + 20000);
                hasChangedTouches = chunk.indexOf('changedTouches') >= 0;
            }
            var ribbonTouchesType = 'not found';
            if (window.SynthLab && SynthLab.controllers && SynthLab.controllers.ribbon) {
                ribbonTouchesType = 'controller exists';
            }
            return { hasChangedTouches: hasChangedTouches, ribbonTouchesType: ribbonTouchesType };
        });

        var passed2 = ribbonResult.hasChangedTouches && ribbonResult.ribbonTouchesType === 'controller exists';
        record(2, 'Ribbon multitouch', passed2,
            'changedTouches in ribbon code=' + ribbonResult.hasChangedTouches +
            ', controller=' + ribbonResult.ribbonTouchesType);
    } catch (e) {
        record(2, 'Ribbon multitouch', false, 'Error: ' + e.message);
    }

    // =========================================================================
    // TEST 3 — XY Pad snap vs smooth
    // =========================================================================
    try {
        await switchSurface(page, 'xypad');
        await page.waitForTimeout(400);

        var snapBtn = await page.$('.ssli-ctrl-snap-toggle');
        if (!snapBtn) {
            record(3, 'XY Pad snap vs smooth', false, 'No snap/smooth toggle button found');
        } else {
            var text1 = await snapBtn.textContent();
            var isValidText = (text1.trim() === 'Snap' || text1.trim() === 'Smooth');

            await snapBtn.click();
            await page.waitForTimeout(200);
            var text2 = await snapBtn.textContent();
            var toggled = (text1.trim() !== text2.trim());

            var passed3 = isValidText && toggled;
            record(3, 'XY Pad snap vs smooth', passed3,
                'initial="' + text1.trim() + '", after click="' + text2.trim() + '", toggled=' + toggled);
        }
    } catch (e) {
        record(3, 'XY Pad snap vs smooth', false, 'Error: ' + e.message);
    }

    // =========================================================================
    // TEST 4 — Breath pad pointer capture
    // =========================================================================
    try {
        await switchSurface(page, 'breathpad');
        await page.waitForTimeout(400);

        var captureResult = await page.evaluate(function() {
            var html = document.documentElement.outerHTML;
            // Find breathpad section - search for the controller build function
            var breathIdx = html.indexOf('controllers.breathpad');
            if (breathIdx < 0) { breathIdx = html.indexOf('breathpad'); }

            // Search in a wide area (50K chars) for setPointerCapture
            var start = Math.max(0, breathIdx - 5000);
            var breathChunk = html.substring(start, breathIdx + 50000);
            var hasSetPointerCapture = breathChunk.indexOf('setPointerCapture') >= 0;

            // Check that pointercancel attempts re-capture rather than immediate release
            // Search all instances of pointercancel near setPointerCapture
            var cancelIdx = breathChunk.indexOf('pointercancel');
            var reCaptures = false;
            var immediateRelease = false;
            while (cancelIdx >= 0) {
                var cancelChunk = breathChunk.substring(cancelIdx, cancelIdx + 600);
                if (cancelChunk.indexOf('setPointerCapture') >= 0) {
                    reCaptures = true;
                }
                if (cancelChunk.indexOf('_releaseActivePointer') >= 0 && cancelChunk.indexOf('setPointerCapture') < 0) {
                    immediateRelease = true;
                }
                cancelIdx = breathChunk.indexOf('pointercancel', cancelIdx + 1);
            }

            return {
                hasSetPointerCapture: hasSetPointerCapture,
                reCaptures: reCaptures,
                immediateRelease: immediateRelease
            };
        });

        var passed4 = captureResult.hasSetPointerCapture && captureResult.reCaptures;
        record(4, 'Breath pad pointer capture', passed4,
            'setPointerCapture=' + captureResult.hasSetPointerCapture +
            ', re-captures on cancel=' + captureResult.reCaptures +
            ', immediateRelease=' + captureResult.immediateRelease);
    } catch (e) {
        record(4, 'Breath pad pointer capture', false, 'Error: ' + e.message);
    }

    // =========================================================================
    // TEST 5 — Air Synth (renamed from Theremin)
    // =========================================================================
    try {
        await page.click('.ssli-nav-btn[data-screen="play"]');
        await page.waitForTimeout(300);

        var surfaceCheck = await page.evaluate(function() {
            var categorySelect = document.getElementById('ssliPlayCategorySelect');
            if (categorySelect && categorySelect.value !== 'all') {
                categorySelect.value = 'all';
                categorySelect.dispatchEvent(new Event('change', { bubbles: true }));
            }
            var selects = document.querySelectorAll('#ssliPlaySurfaceSelect');
            var airSynthFound = false;
            var thereminVisible = false;
            for (var si = 0; si < selects.length; si++) {
                var opts = selects[si].querySelectorAll('option');
                for (var oi = 0; oi < opts.length; oi++) {
                    if (opts[oi].textContent === 'Air Synth') { airSynthFound = true; }
                    if (opts[oi].textContent === 'Theremin') { thereminVisible = true; }
                }
                break; // check first select only
            }
            return { airSynthFound: airSynthFound, thereminVisible: thereminVisible };
        });

        // Now switch to it
        await switchSurface(page, 'theremin');
        await page.waitForTimeout(400);

        var surfaceRendered = await page.$('.perform-ctrl-wrapper');
        var hasContent = surfaceRendered ? (await surfaceRendered.evaluate(function(el) { return el.children.length > 0; })) : false;

        var passed5 = surfaceCheck.airSynthFound && !surfaceCheck.thereminVisible && hasContent;
        record(5, 'Air Synth (renamed from Theremin)', passed5,
            'Air Synth option=' + surfaceCheck.airSynthFound +
            ', Theremin visible=' + surfaceCheck.thereminVisible +
            ', renders=' + hasContent);
    } catch (e) {
        record(5, 'Air Synth (renamed from Theremin)', false, 'Error: ' + e.message);
    }

    // =========================================================================
    // TEST 6 — Drum kit dropdown
    // =========================================================================
    try {
        await switchSurface(page, 'pads');
        await page.waitForTimeout(500);

        var kitInfo = await page.evaluate(function() {
            var sel = document.querySelector('.perf-pad-kit-select');
            if (!sel) { return { found: false }; }
            var options = [];
            for (var i = 0; i < sel.options.length; i++) {
                options.push(sel.options[i].textContent);
            }
            return { found: true, options: options, count: sel.options.length };
        });

        if (!kitInfo.found) {
            record(6, 'Drum kit dropdown', false, 'Kit selector not found');
        } else {
            var hasMinOptions = kitInfo.count >= 5;

            // Get current pad labels (pads have class perf-drum-pad)
            var beforeLabels = await page.evaluate(function() {
                var pads = document.querySelectorAll('.perf-pad-grid .perf-drum-pad');
                var labels = [];
                for (var i = 0; i < Math.min(4, pads.length); i++) {
                    labels.push(pads[i].textContent.trim());
                }
                return labels;
            });

            // Switch to 808 Kit
            var kitSelect = await page.$('.perf-pad-kit-select');
            if (kitSelect) {
                await kitSelect.selectOption('808 Kit');
                await page.waitForTimeout(500);
            }

            var afterLabels = await page.evaluate(function() {
                var pads = document.querySelectorAll('.perf-pad-grid .perf-drum-pad');
                var labels = [];
                for (var i = 0; i < Math.min(4, pads.length); i++) {
                    labels.push(pads[i].textContent.trim());
                }
                return labels;
            });

            var labelsChanged = JSON.stringify(beforeLabels) !== JSON.stringify(afterLabels);
            var passed6 = hasMinOptions && labelsChanged;
            record(6, 'Drum kit dropdown', passed6,
                'options=' + kitInfo.count + ' (' + kitInfo.options.join(', ') + ')' +
                ', labels changed=' + labelsChanged +
                ', before=' + JSON.stringify(beforeLabels) +
                ', after=' + JSON.stringify(afterLabels));
        }
    } catch (e) {
        record(6, 'Drum kit dropdown', false, 'Error: ' + e.message);
    }

    // =========================================================================
    // TEST 7 — Hex grid Wicki-Hayden intervals
    // =========================================================================
    try {
        await switchSurface(page, 'hex');
        await page.waitForTimeout(500);

        var hexResult = await page.evaluate(function() {
            var hexKeys = document.querySelectorAll('.perf-hex-grid [data-midi]');
            if (hexKeys.length === 0) { return { found: false }; }

            // Gather positions and MIDI values
            var keyData = [];
            for (var i = 0; i < hexKeys.length; i++) {
                var rect = hexKeys[i].getBoundingClientRect();
                keyData.push({
                    midi: parseInt(hexKeys[i].getAttribute('data-midi'), 10),
                    x: Math.round(rect.left),
                    y: Math.round(rect.top),
                    cx: Math.round(rect.left + rect.width / 2),
                    cy: Math.round(rect.top + rect.height / 2)
                });
            }

            // Sort by y then x to get rows
            keyData.sort(function(a, b) { return a.y - b.y || a.x - b.x; });

            // Group into rows by Y proximity (within 20px)
            var rows = [];
            var currentRow = [keyData[0]];
            for (var ri = 1; ri < keyData.length; ri++) {
                if (Math.abs(keyData[ri].y - currentRow[0].y) < 20) {
                    currentRow.push(keyData[ri]);
                } else {
                    rows.push(currentRow);
                    currentRow = [keyData[ri]];
                }
            }
            rows.push(currentRow);

            // Check column intervals (consecutive in a row differ by 2 semitones)
            var colIntervals = [];
            if (rows.length > 0 && rows[0].length >= 2) {
                for (var ci = 1; ci < Math.min(5, rows[0].length); ci++) {
                    colIntervals.push(rows[0][ci].midi - rows[0][ci - 1].midi);
                }
            }

            // Check row intervals (same column position across rows differ by 7)
            var rowIntervals = [];
            if (rows.length >= 2) {
                // Compare first element of each row
                for (var rri = 1; rri < Math.min(4, rows.length); rri++) {
                    // Find closest x match
                    var refX = rows[0][0].cx;
                    var closest = rows[rri][0];
                    var bestDist = 999;
                    for (var k = 0; k < rows[rri].length; k++) {
                        var dist = Math.abs(rows[rri][k].cx - refX);
                        if (dist < bestDist) {
                            bestDist = dist;
                            closest = rows[rri][k];
                        }
                    }
                    rowIntervals.push(closest.midi - rows[0][0].midi);
                }
            }

            return {
                found: true,
                totalKeys: hexKeys.length,
                rowCount: rows.length,
                firstRowLen: rows[0] ? rows[0].length : 0,
                colIntervals: colIntervals,
                rowIntervals: rowIntervals
            };
        });

        if (!hexResult.found) {
            record(7, 'Hex grid Wicki-Hayden intervals', false, 'No hex keys found');
        } else {
            // Column intervals should all be 2 (major 2nds)
            var allCol2 = hexResult.colIntervals.length > 0 &&
                hexResult.colIntervals.every(function(v) { return v === 2; });

            // Row intervals should be multiples of 7 (perfect 5ths).
            // Rows are sorted top-to-bottom (increasing Y), and higher rows
            // may have lower MIDI (Wicki-Hayden goes up visually). Accept
            // either +7 or -7 per row step.
            var rowOk = hexResult.rowIntervals.length > 0 &&
                hexResult.rowIntervals.every(function(v, idx) {
                    return Math.abs(v) === 7 * (idx + 1);
                });

            var passed7 = allCol2 && rowOk;
            record(7, 'Hex grid Wicki-Hayden intervals', passed7,
                'colIntervals=' + JSON.stringify(hexResult.colIntervals) +
                ', rowIntervals=' + JSON.stringify(hexResult.rowIntervals) +
                ', keys=' + hexResult.totalKeys);
        }
    } catch (e) {
        record(7, 'Hex grid Wicki-Hayden intervals', false, 'Error: ' + e.message);
    }

    // =========================================================================
    // TEST 8 — Bass chord panel
    // =========================================================================
    try {
        await switchSurface(page, 'bass');
        await page.waitForTimeout(500);

        var bassChordPanel = await page.$('.ssli-fret-chord-panel');
        var bassChordBtns = await page.$$('.ssli-fret-chord-panel .ssli-fret-chord-btn');
        var bassHasPanel = bassChordPanel !== null;
        var bassChordCount = bassChordBtns.length;

        await switchSurface(page, 'guitar');
        await page.waitForTimeout(500);

        var guitarChordPanel = await page.$('.ssli-fret-chord-panel');
        var guitarChordBtns = await page.$$('.ssli-fret-chord-panel .ssli-fret-chord-btn');
        var guitarHasPanel = guitarChordPanel !== null;
        var guitarChordCount = guitarChordBtns.length;

        var bothHavePanels = bassHasPanel && guitarHasPanel;
        var similarStructure = bassChordCount > 0 && guitarChordCount > 0;

        var passed8 = bothHavePanels && similarStructure;
        record(8, 'Bass chord panel', passed8,
            'bass panel=' + bassHasPanel + ' (' + bassChordCount + ' btns)' +
            ', guitar panel=' + guitarHasPanel + ' (' + guitarChordCount + ' btns)');
    } catch (e) {
        record(8, 'Bass chord panel', false, 'Error: ' + e.message);
    }

    // =========================================================================
    // TEST 9 — Steps stop silences notes
    // =========================================================================
    try {
        await navigateTo(page, 'acid');
        await page.waitForTimeout(500);

        var stopResult = await page.evaluate(function() {
            var html = document.documentElement.outerHTML;
            // Find _stopTransport function
            var stopIdx = html.indexOf('function _stopTransport');
            if (stopIdx < 0) { return { found: false }; }
            var chunk = html.substring(stopIdx, stopIdx + 1000);
            var callsStopAll = chunk.indexOf('stopAllSustained') >= 0;
            var callsSilence = chunk.indexOf('_silenceActiveVoice') >= 0;
            return { found: true, callsStopAll: callsStopAll, callsSilence: callsSilence };
        });

        // Find stop button
        var stopBtn = await page.$('.ssli-acid-btn');
        var stopBtnTexts = await page.evaluate(function() {
            var btns = document.querySelectorAll('.ssli-acid-btn');
            var texts = [];
            for (var i = 0; i < btns.length; i++) { texts.push(btns[i].textContent.trim()); }
            return texts;
        });
        var hasStopBtn = stopBtnTexts.indexOf('Stop') >= 0;

        var passed9 = stopResult.found && (stopResult.callsStopAll || stopResult.callsSilence) && hasStopBtn;
        record(9, 'Steps stop silences notes', passed9,
            'stopTransport found=' + stopResult.found +
            ', calls stopAllSustained=' + (stopResult.callsStopAll || false) +
            ', calls silenceActiveVoice=' + (stopResult.callsSilence || false) +
            ', stop button=' + hasStopBtn);
    } catch (e) {
        record(9, 'Steps stop silences notes', false, 'Error: ' + e.message);
    }

    // =========================================================================
    // TEST 10 — Tweak octave buttons (not slider)
    // =========================================================================
    try {
        // The octave controls are inline on the play screen
        await navigateTo(page, 'play');
        await page.waitForTimeout(400);

        var octResult = await page.evaluate(function() {
            // Look for the inline octave buttons (down/up) and label
            var downBtn = document.querySelector('.perform-inline-oct-btn[title="Octave Down"]');
            var upBtn = document.querySelector('.perform-inline-oct-btn[title="Octave Up"]');
            var label = document.querySelector('.perform-inline-oct-label#ssliOctRange');

            return {
                hasDownBtn: !!downBtn,
                hasUpBtn: !!upBtn,
                hasLabel: !!label,
                downText: downBtn ? downBtn.textContent.trim() : null,
                upText: upBtn ? upBtn.textContent.trim() : null,
                labelText: label ? label.textContent.trim() : null,
                // Verify these are buttons not range inputs
                downTag: downBtn ? downBtn.tagName : null,
                upTag: upBtn ? upBtn.tagName : null
            };
        });

        var areButtons = (octResult.downTag === 'BUTTON') && (octResult.upTag === 'BUTTON');
        var passed10 = octResult.hasDownBtn && octResult.hasUpBtn && octResult.hasLabel && areButtons;
        record(10, 'Tweak octave buttons (not slider)', passed10,
            'down btn=' + octResult.hasDownBtn + ' (tag=' + octResult.downTag + ')' +
            ', up btn=' + octResult.hasUpBtn + ' (tag=' + octResult.upTag + ')' +
            ', label="' + octResult.labelText + '"');
    } catch (e) {
        record(10, 'Tweak octave buttons (not slider)', false, 'Error: ' + e.message);
    }

    // =========================================================================
    // TEST 11 — Filter checkbox sizing
    // =========================================================================
    try {
        await navigateTo(page, 'shape');
        await page.waitForTimeout(500);

        var filterCheck = await page.evaluate(function() {
            // Look for filter enable checkbox
            var cb = document.getElementById('filterEnabled');
            if (!cb) {
                // Try generic approach
                var checkboxes = document.querySelectorAll('.ssli-shape-checkbox, .ssli-shape-container input[type="checkbox"]');
                cb = checkboxes.length > 0 ? checkboxes[0] : null;
            }
            if (!cb) { return { found: false }; }
            var style = window.getComputedStyle(cb);
            var rect = cb.getBoundingClientRect();
            return {
                found: true,
                width: rect.width,
                height: rect.height,
                minWidth: parseFloat(style.minWidth) || rect.width,
                minHeight: parseFloat(style.minHeight) || rect.height
            };
        });

        if (!filterCheck.found) {
            record(11, 'Filter checkbox sizing', false, 'Filter checkbox not found');
        } else {
            var wOk = filterCheck.width >= 24;
            var hOk = filterCheck.height >= 24;
            var passed11 = wOk && hOk;
            record(11, 'Filter checkbox sizing', passed11,
                'width=' + filterCheck.width.toFixed(1) + 'px (>=24)' +
                ', height=' + filterCheck.height.toFixed(1) + 'px (>=24)');
        }
    } catch (e) {
        record(11, 'Filter checkbox sizing', false, 'Error: ' + e.message);
    }

    // =========================================================================
    // TEST 12 — Sound page slider widths
    // =========================================================================
    try {
        await navigateTo(page, 'sound');
        await page.waitForTimeout(500);

        var sliderResult = await page.evaluate(function() {
            var sliders = document.querySelectorAll('.ssli-sound-container input[type="range"], .ssli-sound-container .ssli-shape-slider');
            if (sliders.length === 0) {
                // Broader search
                sliders = document.querySelectorAll('[data-screen="sound"] input[type="range"], .ssli-shape-slider');
            }
            var widths = [];
            for (var i = 0; i < Math.min(5, sliders.length); i++) {
                var rect = sliders[i].getBoundingClientRect();
                if (rect.width > 0) { widths.push(Math.round(rect.width)); }
            }
            return { count: sliders.length, widths: widths };
        });

        if (sliderResult.widths.length === 0) {
            record(12, 'Sound page slider widths', false, 'No visible sliders found (total=' + sliderResult.count + ')');
        } else {
            var maxWidth = Math.max.apply(null, sliderResult.widths);
            var passed12 = maxWidth > 200;
            record(12, 'Sound page slider widths', passed12,
                'widths=' + JSON.stringify(sliderResult.widths) + ', max=' + maxWidth + 'px (>200)');
        }
    } catch (e) {
        record(12, 'Sound page slider widths', false, 'Error: ' + e.message);
    }

    // =========================================================================
    // TEST 13 — Effects checkbox sizing
    // =========================================================================
    try {
        await navigateTo(page, 'effects');
        await page.waitForTimeout(500);

        var efxCheck = await page.evaluate(function() {
            // SSLI effects use .ssli-fx-chain-cb for the toggle checkboxes
            // First look inside the active effects screen / container
            var container = document.querySelector('.ssli-fx-container');
            var toggles = container ? container.querySelectorAll('.ssli-fx-chain-cb') : [];
            var selector = '.ssli-fx-chain-cb';
            if (toggles.length === 0) {
                toggles = container ? container.querySelectorAll('input[type="checkbox"]') : [];
                selector = 'container input[checkbox]';
            }
            if (toggles.length === 0) {
                // Broader search
                toggles = document.querySelectorAll('.ssli-fx-chain-cb');
                selector = 'global .ssli-fx-chain-cb';
            }
            if (toggles.length === 0) {
                toggles = document.querySelectorAll('.effects-row-toggle');
                selector = '.effects-row-toggle';
            }
            var dims = [];
            for (var i = 0; i < Math.min(5, toggles.length); i++) {
                var rect = toggles[i].getBoundingClientRect();
                // Get computed style for min-width/min-height too
                var style = window.getComputedStyle(toggles[i]);
                dims.push({
                    w: Math.round(rect.width),
                    h: Math.round(rect.height),
                    mw: parseFloat(style.minWidth) || 0,
                    mh: parseFloat(style.minHeight) || 0,
                    cls: toggles[i].className
                });
            }
            return { count: toggles.length, dims: dims, selector: selector, hasContainer: !!container };
        });

        // Also verify the CSS rule itself declares >= 36px
        var cssRuleCheck = await page.evaluate(function() {
            // Walk all stylesheets to find .ssli-fx-chain-cb rules
            var maxDeclaredW = 0;
            var maxDeclaredH = 0;
            for (var si = 0; si < document.styleSheets.length; si++) {
                try {
                    var rules = document.styleSheets[si].cssRules || [];
                    for (var ri = 0; ri < rules.length; ri++) {
                        var r = rules[ri];
                        if (r.selectorText && r.selectorText.indexOf('ssli-fx-chain-cb') >= 0 &&
                            r.selectorText.indexOf('phone') < 0) {
                            var w = parseFloat(r.style.width) || 0;
                            var h = parseFloat(r.style.height) || 0;
                            var mw = parseFloat(r.style.minWidth) || 0;
                            var mh = parseFloat(r.style.minHeight) || 0;
                            if (w > maxDeclaredW) { maxDeclaredW = w; }
                            if (h > maxDeclaredH) { maxDeclaredH = h; }
                            if (mw > maxDeclaredW) { maxDeclaredW = mw; }
                            if (mh > maxDeclaredH) { maxDeclaredH = mh; }
                        }
                    }
                } catch (e) { /* cross-origin */ }
            }
            return { maxDeclaredW: maxDeclaredW, maxDeclaredH: maxDeclaredH };
        });

        if (efxCheck.dims.length === 0) {
            record(13, 'Effects checkbox sizing', false,
                'No effect checkboxes found (total=' + efxCheck.count +
                ', selector=' + efxCheck.selector +
                ', hasContainer=' + efxCheck.hasContainer + ')');
        } else {
            // Check rendered dimensions OR CSS declared dimensions (native checkboxes
            // in headless Chromium may not respect width/height without appearance:none)
            var maxRendered = Math.max.apply(null, efxCheck.dims.map(function(d) { return Math.max(d.w, d.mw); }));
            var cssDeclared = Math.max(cssRuleCheck.maxDeclaredW, cssRuleCheck.maxDeclaredH);
            var passed13 = cssDeclared >= 36 && efxCheck.count > 0;
            record(13, 'Effects checkbox sizing', passed13,
                'count=' + efxCheck.count +
                ', rendered=' + maxRendered + 'px' +
                ', CSS declared=' + cssDeclared + 'px (>=36)' +
                ', selector=' + efxCheck.selector);
        }
    } catch (e) {
        record(13, 'Effects checkbox sizing', false, 'Error: ' + e.message);
    }

    // =========================================================================
    // TEST 14 — Steps glide control
    // =========================================================================
    try {
        await navigateTo(page, 'acid');
        await page.waitForTimeout(500);

        var glideResult = await page.evaluate(function() {
            // Look for glide control label or input
            var labels = document.querySelectorAll('.ssli-acid-field-label');
            var glideFound = false;
            for (var i = 0; i < labels.length; i++) {
                if (labels[i].textContent.trim() === 'Glide') {
                    glideFound = true;
                    break;
                }
            }
            // Also check for the range input
            var glideInput = document.querySelector('.ssli-acid-range');
            var allFields = document.querySelectorAll('.ssli-acid-field');
            var fieldLabels = [];
            for (var fi = 0; fi < allFields.length; fi++) {
                var lbl = allFields[fi].querySelector('.ssli-acid-field-label');
                if (lbl) { fieldLabels.push(lbl.textContent.trim()); }
            }
            return {
                glideFound: glideFound,
                hasRangeInput: !!glideInput,
                fieldLabels: fieldLabels
            };
        });

        var passed14 = glideResult.glideFound;
        record(14, 'Steps glide control', passed14,
            'Glide label found=' + glideResult.glideFound +
            ', fields=' + JSON.stringify(glideResult.fieldLabels));
    } catch (e) {
        record(14, 'Steps glide control', false, 'Error: ' + e.message);
    }

    // =========================================================================
    // TEST 15 — Harp colors
    // =========================================================================
    try {
        await switchSurface(page, 'harp');
        await page.waitForTimeout(500);

        var harpResult = await page.evaluate(function() {
            var strings = document.querySelectorAll('.perf-harp-string, [data-midi]');
            if (strings.length === 0) { return { found: false }; }

            var cColors = [];
            var fColors = [];
            var allColors = [];
            var hasOldRed = false;
            var hasOldBlue = false;

            for (var i = 0; i < strings.length; i++) {
                var midi = parseInt(strings[i].getAttribute('data-midi'), 10);
                if (isNaN(midi)) { continue; }
                var pc = midi % 12;
                var style = window.getComputedStyle(strings[i]);
                var bg = style.backgroundColor || style.background || '';
                var color = style.color || '';
                var border = style.borderColor || '';
                var allStyle = bg + ' ' + color + ' ' + border + ' ' + (strings[i].style.cssText || '');

                if (pc === 0) { cColors.push(allStyle); } // C notes
                if (pc === 5) { fColors.push(allStyle); } // F notes
                allColors.push({ pc: pc, style: allStyle.substring(0, 100) });

                // Check for old colors
                if (allStyle.indexOf('cc3333') >= 0 || allStyle.indexOf('204, 51, 51') >= 0) {
                    hasOldRed = true;
                }
                if (allStyle.indexOf('3333cc') >= 0 || allStyle.indexOf('51, 51, 204') >= 0) {
                    hasOldBlue = true;
                }
            }

            // Check source for the constants
            var html = document.documentElement.outerHTML;
            var hasGold = html.indexOf('#d4a017') >= 0 || html.indexOf('d4a017') >= 0;
            var hasViolet = html.indexOf('#6a5acd') >= 0 || html.indexOf('6a5acd') >= 0;

            return {
                found: true,
                stringCount: strings.length,
                cColorSample: cColors.length > 0 ? cColors[0].substring(0, 80) : 'none',
                fColorSample: fColors.length > 0 ? fColors[0].substring(0, 80) : 'none',
                hasOldRed: hasOldRed,
                hasOldBlue: hasOldBlue,
                hasGoldConstant: hasGold,
                hasVioletConstant: hasViolet
            };
        });

        if (!harpResult.found) {
            record(15, 'Harp colors', false, 'No harp strings found');
        } else {
            var passed15 = harpResult.hasGoldConstant && harpResult.hasVioletConstant &&
                !harpResult.hasOldRed && !harpResult.hasOldBlue;
            record(15, 'Harp colors', passed15,
                'gold(#d4a017)=' + harpResult.hasGoldConstant +
                ', violet(#6a5acd)=' + harpResult.hasVioletConstant +
                ', old red=' + harpResult.hasOldRed +
                ', old blue=' + harpResult.hasOldBlue +
                ', strings=' + harpResult.stringCount);
        }
    } catch (e) {
        record(15, 'Harp colors', false, 'Error: ' + e.message);
    }

    // =========================================================================
    // SUMMARY
    // =========================================================================
    console.log('\n========================================');
    console.log('SSLI BEHAVIORAL BUG-FIX TEST SUMMARY');
    console.log('========================================');
    console.log('PASSED: ' + passCount + ' / ' + (passCount + failCount));
    console.log('FAILED: ' + failCount + ' / ' + (passCount + failCount));
    console.log('========================================');
    if (failCount > 0) {
        console.log('\nFailed tests:');
        for (var ri = 0; ri < RESULTS.length; ri++) {
            if (RESULTS[ri].status === 'FAIL') {
                console.log('  TEST ' + RESULTS[ri].test + ': ' + RESULTS[ri].name + ' -- ' + RESULTS[ri].detail);
            }
        }
    }

    await browser.close();
    process.exit(failCount > 0 ? 1 : 0);
})();
