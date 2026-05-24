// feedback.js - User Feedback System & About Panel for Super Synth Lab Universe
// ES5 only (var, no arrow functions, no template literals)

var SynthLab = window.SynthLab || {};

(function() {
    "use strict";

    var SSL_FEEDBACK_KEY = "ssl_feedback";
    var SSL_VERSION = "v1.0.12";
    SynthLab.SSL_VERSION = SSL_VERSION;

    // =========================================================================
    // Element name lookup — maps data-ssl-id to human-readable names
    // =========================================================================

    var ELEMENT_NAMES = {
        "header.title": "Title",
        "header.version": "Version Badge",
        "controls.root": "Root Note Selector",
        "controls.scale": "Scale Selector",
        "controls.instrument": "Instrument Selector",
        "controls.method": "Tuning Method",
        "controls.refhz": "Reference Hz",
        "controls.volume": "Volume Slider",
        "controls.loop": "Loop Toggle",
        "controls.loopPreset": "Loop Preset",
        "controls.loopVolume": "Loop Volume",
        "controls.clearInst": "Clear Instrument",
        "controls.clearAll": "Clear All Instruments",
        "controls.settings": "Settings Button",
        "controls.saveload": "Save/Load Button",
        "controls.patch": "Patch Screen Button",
        "controls.freeze": "Freeze Button",
        "controls.stretch": "Stretch Button",
        "controls.latency": "Latency Mode",
        "controls.about": "About Button",
        "keyboard.octaves": "Octave Controls",
        "keyboard.main": "Keyboard",
        "keyboard.readout": "Note Readout",
        "midi.bar": "MIDI Bar",
        "midi.toggle": "MIDI Toggle",
        "midi.panel": "MIDI Panel",
        "midi.config": "MIDI Config",
        "isomorphic.layout": "Isomorphic Layout",
        "isomorphic.grid": "Isomorphic Grid",
        "controls.adsr": "ADSR (Inline)",
        "controls.filter": "Filter (Inline)",
        "controls.noise": "Noise (Inline)",
        "sequencer.pages": "Sequencer Pages",
        "sequencer.transport": "Sequencer Transport",
        "sequencer.grid": "Sequencer Note Grid",
        "sequencer.rhythm": "Sequencer Rhythm Grid",
        "sequencer.bpm": "BPM Control",
        "sequencer.poly": "Poly Toggle",
        "arp.toggle": "Arpeggiator Toggle",
        "arp.panel": "Arpeggiator Panel",
        "tabs.progs": "Progressions Tab",
        "tabs.euclid": "Euclidean Tab",
        "tabs.melody": "Melody Tab",
        "tabs.arrange": "Arrange Tab",
        "tabs.rhythm": "Rhythm Tab",
        "tabs.song": "Song Tab",
        "generator.progressions": "Progressions Panel",
        "generator.euclidean": "Euclidean Panel",
        "generator.melody": "Melody Panel",
        "generator.arrange": "Arrange Panel",
        "generator.rhythm": "Rhythm Panel",
        "generator.song": "Song Panel",
        "settings.modal": "Settings Modal",
        "settings.tabs": "Settings Tabs",
        "settings.types": "Instrument Type Buttons",
        "settings.adsr": "ADSR Section (Modal)",
        "settings.noise": "Noise Section (Modal)",
        "settings.filter": "Filter Section (Modal)",
        "settings.humanize": "Humanize Section",
        "effects.chain": "Effects Tab",
        "lfo.tab": "LFO Tab",
        "sampler.tab": "Sampler Tab",
        "analyzer.toggle": "Analyzer Toggle",
        "analyzer.panel": "Analyzer Panel",
        "debug.panel": "Debug Panel",
        "debug.toggle": "Debug Toggle",
        "modmatrix.btn": "Mod Matrix Button",
        "modmatrix.panel": "Mod Matrix Panel",
        "patch.screen": "Patch Screen",
        "patch.toolbar": "Patch Toolbar",
        "patch.canvas": "Patch Canvas",
        "patch.palette": "Patch Palette",
        "patch.params": "Patch Parameters",
        "patch.macros": "Patch Macros"
    };

    // =========================================================================
    // Utility: read/write feedback from localStorage
    // =========================================================================

    function getFeedback() {
        var raw = localStorage.getItem(SSL_FEEDBACK_KEY);
        if (raw) {
            try {
                return JSON.parse(raw);
            } catch (e) {
                return [];
            }
        }
        return [];
    }

    function saveFeedback(items) {
        localStorage.setItem(SSL_FEEDBACK_KEY, JSON.stringify(items));
    }

    // =========================================================================
    // Context Menu
    // =========================================================================

    var contextMenuEl = null;
    var currentTargetId = null;

    function showContextMenu(x, y, sslId) {
        if (!contextMenuEl) {
            contextMenuEl = document.getElementById("sslContextMenu");
        }
        if (!contextMenuEl) {
            return;
        }
        currentTargetId = sslId;
        var displayName = ELEMENT_NAMES[sslId] || sslId;
        var itemEl = contextMenuEl.querySelector(".ssl-context-menu-item");
        if (itemEl) {
            itemEl.textContent = SynthLab.t('feedback.provide_on') + displayName;
        }
        contextMenuEl.style.display = "block";

        // Position — keep on screen
        var menuW = contextMenuEl.offsetWidth;
        var menuH = contextMenuEl.offsetHeight;
        var winW = window.innerWidth;
        var winH = window.innerHeight;
        var posX = x;
        var posY = y;
        if (posX + menuW > winW) {
            posX = winW - menuW - 4;
        }
        if (posY + menuH > winH) {
            posY = winH - menuH - 4;
        }
        contextMenuEl.style.left = posX + "px";
        contextMenuEl.style.top = posY + "px";
    }

    function hideContextMenu() {
        if (contextMenuEl) {
            contextMenuEl.style.display = "none";
        }
    }

    // =========================================================================
    // Feedback Modal
    // =========================================================================

    var feedbackOverlay = null;
    var selectedRating = null;

    function openFeedbackModal(sslId) {
        hideContextMenu();
        if (!feedbackOverlay) {
            feedbackOverlay = document.getElementById("sslFeedbackOverlay");
        }
        if (!feedbackOverlay) {
            return;
        }

        var displayName = ELEMENT_NAMES[sslId] || sslId;
        var elIdDiv = feedbackOverlay.querySelector(".ssl-feedback-element-id");
        if (elIdDiv) {
            elIdDiv.textContent = sslId + " (" + displayName + ")";
        }

        // Reset state
        selectedRating = null;
        var btns = feedbackOverlay.querySelectorAll(".ssl-feedback-rating-btn");
        for (var i = 0; i < btns.length; i++) {
            btns[i].className = "ssl-feedback-rating-btn";
        }
        var textarea = feedbackOverlay.querySelector(".ssl-feedback-textarea");
        if (textarea) {
            textarea.value = "";
        }
        var successEl = feedbackOverlay.querySelector(".ssl-feedback-success");
        if (successEl) {
            successEl.style.display = "none";
        }
        var submitBtn = feedbackOverlay.querySelector(".ssl-feedback-submit");
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = SynthLab.t('ui.button.submit_feedback');
        }

        feedbackOverlay.className = "ssl-feedback-overlay visible";
    }

    function closeFeedbackModal() {
        if (feedbackOverlay) {
            feedbackOverlay.className = "ssl-feedback-overlay";
        }
    }

    function submitFeedback() {
        if (!selectedRating) {
            return;
        }
        var textarea = feedbackOverlay.querySelector(".ssl-feedback-textarea");
        var comment = textarea ? textarea.value.trim() : "";

        var record = {
            elementId: currentTargetId,
            rating: selectedRating,
            comment: comment,
            timestamp: new Date().toISOString(),
            sslVersion: SSL_VERSION
        };

        var items = getFeedback();
        items.push(record);
        saveFeedback(items);

        var submitBtn = feedbackOverlay.querySelector(".ssl-feedback-submit");
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = SynthLab.t('feedback.submitted');
        }
        var successEl = feedbackOverlay.querySelector(".ssl-feedback-success");
        if (successEl) {
            successEl.style.display = "block";
        }

        // Auto-close after brief pause
        setTimeout(function() {
            closeFeedbackModal();
        }, 1200);
    }

    // =========================================================================
    // About Panel
    // =========================================================================

    var aboutOverlay = null;

    function openAbout() {
        if (!aboutOverlay) {
            aboutOverlay = document.getElementById("sslAboutOverlay");
        }
        if (!aboutOverlay) {
            return;
        }
        // Update feedback count
        var countEl = aboutOverlay.querySelector(".ssl-about-feedback-count");
        if (countEl) {
            var items = getFeedback();
            countEl.textContent = SynthLab.t('feedback.count_prefix') + items.length + (items.length !== 1 ? SynthLab.t('feedback.count_suffix_plural') : SynthLab.t('feedback.count_suffix_singular'));
        }
        // Must clear inline style AND set class — inline display:none overrides CSS
        aboutOverlay.style.display = "flex";
        aboutOverlay.className = "ssl-about-overlay visible";
    }

    function closeAbout() {
        if (aboutOverlay) {
            aboutOverlay.style.display = "none";
            aboutOverlay.className = "ssl-about-overlay";
        }
        // Also hide donate panel
        var donatePanel = document.getElementById("sslDonatePanel");
        if (donatePanel) {
            donatePanel.className = "ssl-donate-panel";
        }
    }

    function exportFeedback() {
        var items = getFeedback();
        if (items.length === 0) {
            alert(SynthLab.t('feedback.no_items_to_export'));
            return;
        }
        var jsonStr = JSON.stringify(items, null, 2);
        var blob = new Blob([jsonStr], { type: "application/json" });
        var url = URL.createObjectURL(blob);
        var now = new Date();
        var y = now.getFullYear();
        var m = ("0" + (now.getMonth() + 1)).slice(-2);
        var d = ("0" + now.getDate()).slice(-2);
        var filename = "SSL_Feedback_" + y + "-" + m + "-" + d + ".json";

        var a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function toggleDonate() {
        var panel = document.getElementById("sslDonatePanel");
        if (panel) {
            if (panel.className.indexOf("visible") >= 0) {
                panel.className = "ssl-donate-panel";
            } else {
                panel.className = "ssl-donate-panel visible";
            }
        }
    }

    // =========================================================================
    // Init — wire up events
    // =========================================================================

    function initFeedback() {
        // Context menu on right-click for elements with data-ssl-id
        document.addEventListener("contextmenu", function(e) {
            var target = e.target;
            var sslId = null;

            // Walk up to find nearest data-ssl-id
            while (target && target !== document.body) {
                if (target.getAttribute && target.getAttribute("data-ssl-id")) {
                    sslId = target.getAttribute("data-ssl-id");
                    break;
                }
                target = target.parentElement;
            }

            if (sslId) {
                e.preventDefault();
                e.stopPropagation();
                showContextMenu(e.clientX, e.clientY, sslId);
            } else {
                hideContextMenu();
            }
        });

        // Click elsewhere dismisses context menu
        document.addEventListener("click", function() {
            hideContextMenu();
        });

        // Context menu item click
        var menuItem = document.querySelector("#sslContextMenu .ssl-context-menu-item");
        if (menuItem) {
            menuItem.addEventListener("click", function(e) {
                e.stopPropagation();
                openFeedbackModal(currentTargetId);
            });
        }

        // Feedback rating buttons
        var feedbackOvl = document.getElementById("sslFeedbackOverlay");
        if (feedbackOvl) {
            var ratingBtns = feedbackOvl.querySelectorAll(".ssl-feedback-rating-btn");
            for (var i = 0; i < ratingBtns.length; i++) {
                (function(btn) {
                    btn.addEventListener("click", function() {
                        // Deselect all
                        var allBtns = feedbackOvl.querySelectorAll(".ssl-feedback-rating-btn");
                        for (var j = 0; j < allBtns.length; j++) {
                            allBtns[j].className = "ssl-feedback-rating-btn";
                        }
                        btn.className = "ssl-feedback-rating-btn selected";
                        selectedRating = btn.getAttribute("data-rating");
                    });
                })(ratingBtns[i]);
            }
        }

        // Submit button
        var submitBtn = document.querySelector("#sslFeedbackOverlay .ssl-feedback-submit");
        if (submitBtn) {
            submitBtn.addEventListener("click", function() {
                submitFeedback();
            });
        }

        // Feedback overlay click-to-close (on backdrop)
        if (feedbackOvl) {
            feedbackOvl.addEventListener("click", function(e) {
                if (e.target === feedbackOvl) {
                    closeFeedbackModal();
                }
            });
        }

        // About button
        var aboutBtn = document.getElementById("sslAboutBtn");
        if (aboutBtn) {
            aboutBtn.addEventListener("click", function() {
                openAbout();
            });
        }

        // About overlay click-to-close
        var aboutOvl = document.getElementById("sslAboutOverlay");
        if (aboutOvl) {
            aboutOvl.addEventListener("click", function(e) {
                if (e.target === aboutOvl) {
                    closeAbout();
                }
            });
        }

        // About close button
        var aboutCloseBtn = document.getElementById("sslAboutClose");
        if (aboutCloseBtn) {
            aboutCloseBtn.addEventListener("click", function() {
                closeAbout();
            });
        }

        // Export feedback button
        var exportBtn = document.getElementById("sslExportFeedback");
        if (exportBtn) {
            exportBtn.addEventListener("click", function() {
                exportFeedback();
            });
        }

        // Donate button
        var donateBtn = document.getElementById("sslDonateBtn");
        if (donateBtn) {
            donateBtn.addEventListener("click", function() {
                toggleDonate();
            });
        }
    }

    // Run init when DOM is ready
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initFeedback);
    } else {
        initFeedback();
    }

    // Expose for testing
    SynthLab.feedback = {
        getFeedback: getFeedback,
        saveFeedback: saveFeedback,
        openAbout: openAbout,
        closeAbout: closeAbout,
        exportFeedback: exportFeedback
    };

})();
