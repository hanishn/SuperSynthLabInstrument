/**
 * Engine x Surface Audio Sweep
 * Captures audio metrics for every engine/preset x control surface combination.
 * Fresh browser page per engine to avoid engine-switch silence bugs.
 *
 * Usage: node test_engine_surface_capture.js [--output results_engine_surface_sweep.json]
 * Run from the SSLI exhibit directory.
 */

'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ============================================================
// Configuration
// ============================================================

const EXPORT_PATH = 'file:///' + path.resolve(__dirname, 'export', 'SuperSynthLabInstrument.html').replace(/\\/g, '/');
const FFT_SIZE = 8192;
const SAMPLE_RATE = 44100;
const SETTLE_MS = 400;
const PHYSICAL_SETTLE_MS = 550;
const ENGINE_INIT_MS = 200;
const PHYSICAL_ENGINE_INIT_MS = 550;
const POST_RELEASE_WAIT_MS = 200;
const LONG_POST_RELEASE_WAIT_MS = 1000;
const PAGE_INIT_WAIT_MS = 3000;
const PLAY_BUTTON_WAIT_MS = 1500;
const MIDI_C4 = 60;
const EXPECTED_C4_HZ = 261.63;

const UNPITCHED_ENGINES = ['DrumSyn', 'Bytebeat'];
const COMPLEX_PITCH_ENGINES = ['Chord', 'Modal', 'RingMod', 'Pulsar'];

// Engines where ALL presets in ALL categories should be tested
const FULL_SWEEP_ENGINES = ['Reed'];
// Physical sub-categories to fully sweep
const PHYSICAL_FULL_CATEGORIES = ['Bowed', 'Blown', 'Plucked'];

const CONTROL_SURFACES = [
  'Piano', 'Chord Pads', 'Guitar', 'Bass', 'Drum Pads', 'Glow Keys',
  'Harp', 'Marimba', 'Isomorphic 4th', 'Isomorphic 5th', 'Hex Grid',
  'Ribbon', 'XY Pad', 'Breath Pad', 'Breath Pad Ensemble', 'Air Synth',
  'Chromatic Grid'
];

// ============================================================
// CLI args
// ============================================================

const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf('--' + name);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return defaultVal;
}
const outputFile = getArg('output', 'results_engine_surface_sweep.json');
const engineFilter = getArg('engine', '').trim();
const surfacesFilter = getArg('surfaces', '').trim();
const maxEngines = parseInt(getArg('max-engines', '0'), 10) || 0;
const maxPresetsPerEngine = parseInt(getArg('max-presets-per-engine', '0'), 10) || 0;
const settleOverrideMs = parseInt(getArg('settle-ms', '0'), 10) || 0;
const postReleaseOverrideMs = parseInt(getArg('post-release-ms', '0'), 10) || 0;
const allowFlags = args.indexOf('--allow-flags') !== -1;

function browserLaunchOptions() {
  const candidates = [
    process.env.SSL_BROWSER_EXE,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(Boolean);
  for (let i = 0; i < candidates.length; i++) {
    if (fs.existsSync(candidates[i])) {
      return { executablePath: candidates[i] };
    }
  }
  return {};
}

// ============================================================
// Page management
// ============================================================

async function launchPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(EXPORT_PATH, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(PAGE_INIT_WAIT_MS);
  await page.evaluate(() => {
    const ls = document.getElementById('ssliLoadingScreen');
    if (ls) ls.style.display = 'none';
    if (window._ssliLoadInterval) clearInterval(window._ssliLoadInterval);
  });
  await page.click('#ssliPlayBtn');
  await page.waitForTimeout(PLAY_BUTTON_WAIT_MS);
  return page;
}

// ============================================================
// Inventory: engines, categories, presets, surfaces
// ============================================================

async function getInventory(page) {
  return page.evaluate(() => {
    const SL = window.SynthLab;
    if (!SL || !SL.presets) return { error: 'SL.presets not available' };
    const engines = SL.presets.getEngines();
    const info = {};
    for (let i = 0; i < engines.length; i++) {
      const cats = SL.presets.getCategoriesForEngine(engines[i]);
      const categories = {};
      for (let c = 0; c < cats.length; c++) {
        const ps = SL.presets.getPresetsForEngineCategory(engines[i], cats[c]);
        categories[cats[c]] = ps.map(p => ({
          name: p.name,
          category: cats[c],
          settings: p.settings || {}
        }));
      }
      info[engines[i]] = { categoryNames: cats, categories };
    }

    // Get available surface names from the dropdown
    let surfaces = [];
    const sel = document.getElementById('surfaceSelect') || document.querySelector('[data-surface-select]');
    if (sel) {
      for (let o = 0; o < sel.options.length; o++) {
        surfaces.push(sel.options[o].text || sel.options[o].value);
      }
    }
    // Fallback: check SL.CONTROL_SURFACES
    if (surfaces.length === 0 && SL.CONTROL_SURFACES) {
      surfaces = SL.CONTROL_SURFACES.slice();
    }

    return { engines, info, surfaces };
  });
}

// ============================================================
// Surface switching
// ============================================================

async function switchSurface(page, surfaceName) {
  return page.evaluate((name) => {
    const SL = window.SynthLab;
    const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const aliases = {
      chordpads: ['chordpad', 'chordpads'],
      drumpads: ['drumpad', 'pads'],
      glowkeys: ['glowkeys', 'loom'],
      isomorphic4th: ['grid', 'iso4', 'isomorphic4th'],
      isomorphic5th: ['iso5', 'isomorphic5th'],
      hexgrid: ['hex', 'hexgrid'],
      xypad: ['xypad'],
      breathpad: ['breathpad'],
      breathpadensemble: ['breathpadens', 'breathpadensemble'],
      airsynth: ['airsynth', 'theremin'],
      chromaticgrid: ['chromaticgrid']
    };
    const wanted = normalize(name);
    const wantedValues = aliases[wanted] || [wanted];
    const selectors = [
      '#ssliPlaySurfaceSelect',
      '#ssliBarSurfaceSelect',
      '#ssliSurface',
      '.ssli-inline-surface-select',
      '.ssli-surface-select',
      'select[data-surface]',
      'select[data-ssl-id="ctrl-surface-select"]',
      'select.perf-surface-select',
      '[data-surface-select]'
    ];
    for (let s = 0; s < selectors.length; s++) {
      const selects = document.querySelectorAll(selectors[s]);
      for (let si = 0; si < selects.length; si++) {
        const sel = selects[si];
        if (!sel || !sel.options) continue;
        for (let i = 0; i < sel.options.length; i++) {
          const opt = sel.options[i];
          const optText = normalize(opt.text);
          const optValue = normalize(opt.value);
          const matched = wantedValues.some(v => optValue === v || optText === v || optText.indexOf(v) >= 0 || v.indexOf(optText) >= 0);
          if (matched) {
            sel.selectedIndex = i;
            sel.value = opt.value;
            sel.dispatchEvent(new Event('input', { bubbles: true }));
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            return { switched: true, method: 'dropdown:' + selectors[s], index: i, value: opt.value, text: opt.text };
          }
        }
      }
    }
    // Try SL.surfaces API
    if (SL.surfaces && SL.surfaces.switchTo) {
      SL.surfaces.switchTo(name);
      return { switched: true, method: 'api' };
    }
    // Try screen API
    if (SL.screenPlay && SL.screenPlay.setSurface) {
      SL.screenPlay.setSurface(name);
      return { switched: true, method: 'screenPlay' };
    }
    return { switched: false, error: 'No surface switching mechanism found' };
  }, surfaceName);
}

// ============================================================
// Audio capture for one note
// ============================================================

async function captureNote(page, midi, settleMs, postReleaseMs, expectedMidi) {
  return page.evaluate(async (params) => {
    const { midi, settleMs, postReleaseMs, expectedMidi, fftSize, sampleRate } = params;
    const SL = window.SynthLab;
    try {
      const analyser = SL.audio.getAnalyser ? SL.audio.getAnalyser() : null;
      if (!analyser) return { error: 'No analyser' };

      analyser.fftSize = fftSize;
      const timeBuf = new Float32Array(fftSize);
      const freqBuf = new Float32Array(fftSize / 2);

      // Play note
      SL.audio.startSustainedNote(midi, 100);
      await new Promise(r => setTimeout(r, settleMs));

      // Capture while note is held
      analyser.getFloatTimeDomainData(timeBuf);
      analyser.getFloatFrequencyData(freqBuf);

      // Stop note
      SL.audio.stopSustainedNote(midi);

      // Wait for release
      await new Promise(r => setTimeout(r, postReleaseMs));

      // Capture post-release
      const postBuf = new Float32Array(fftSize);
      analyser.getFloatTimeDomainData(postBuf);

      // --- Time-domain metrics (note on) ---
      let peak = 0, sumSq = 0, sum = 0, zeroCrossings = 0;
      for (let i = 0; i < timeBuf.length; i++) {
        const abs = Math.abs(timeBuf[i]);
        if (abs > peak) peak = abs;
        sum += timeBuf[i];
        sumSq += timeBuf[i] * timeBuf[i];
        if (i > 0 && ((timeBuf[i] >= 0) !== (timeBuf[i - 1] >= 0))) zeroCrossings++;
      }
      const rms = Math.sqrt(sumSq / timeBuf.length);
      const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -100;

      // --- FFT dominant freq ---
      let maxBin = 0, maxMag = -Infinity;
      for (let i = 1; i < freqBuf.length; i++) {
        if (freqBuf[i] > maxMag) { maxMag = freqBuf[i]; maxBin = i; }
      }
      const fftFreq = maxBin * (sampleRate / fftSize);
      const binHz = sampleRate / fftSize;

      // --- Autocorrelation pitch ---
      const acLen = Math.min(timeBuf.length / 2, Math.floor(sampleRate / 25) * 2);
      let energy = 0;
      for (let e = 0; e < acLen; e++) energy += timeBuf[e] * timeBuf[e];
      let acBestCorr = -1, acBestLag = 0, foundDip = false;
      if (energy > 0.0001) {
        const minLag = Math.floor(sampleRate / 4000);
        const maxLag = Math.floor(sampleRate / 25);
        for (let lag = minLag; lag < Math.min(maxLag, acLen); lag++) {
          let corr = 0;
          for (let s = 0; s < acLen - lag; s++) corr += timeBuf[s] * timeBuf[s + lag];
          const normalized = corr / energy;
          if (!foundDip && normalized < 0.5) foundDip = true;
          if (foundDip && normalized > acBestCorr) { acBestCorr = normalized; acBestLag = lag; }
        }
      }
      const acFreq = (acBestLag > 0 && acBestCorr > 0.3) ? sampleRate / acBestLag : 0;
      const expected = 440 * Math.pow(2, (expectedMidi - 69) / 12);
      function centsBetween(a, b) {
        return a > 0 && b > 0 ? 1200 * Math.log2(a / b) : null;
      }
      function localPeakNear(targetHz, centsWindow) {
        const ratio = Math.pow(2, centsWindow / 1200);
        const lo = Math.max(1, Math.floor((targetHz / ratio) / binHz));
        const hi = Math.min(freqBuf.length - 1, Math.ceil((targetHz * ratio) / binHz));
        let bestBin = 0;
        let bestMag = -Infinity;
        for (let i = lo; i <= hi; i++) {
          if (freqBuf[i] > bestMag) { bestMag = freqBuf[i]; bestBin = i; }
        }
        const freq = bestBin > 0 ? bestBin * binHz : 0;
        return {
          freq,
          db: bestMag,
          cents: centsBetween(freq, expected),
          deltaFromDominantDb: Number.isFinite(bestMag) && Number.isFinite(maxMag) ? bestMag - maxMag : null
        };
      }
      const expectedBand = localPeakNear(expected, 150);
      const dominantFreq = (acFreq > 20 && acFreq < 5000) ? acFreq : fftFreq;
      const pitchCents = dominantFreq > 0 && expected > 0
        ? 1200 * Math.log2(dominantFreq / expected) : null;

      // --- Post-release metrics ---
      let postSumSq = 0;
      for (let i = 0; i < postBuf.length; i++) postSumSq += postBuf[i] * postBuf[i];
      const postRms = Math.sqrt(postSumSq / postBuf.length);
      const postRmsDb = postRms > 0 ? 20 * Math.log10(postRms) : -100;

      return {
        peak, rms, rmsDb,
        dominantFreq, fftFreq, acFreq, acCorr: acBestCorr,
        maxFftDb: maxMag,
        expectedBandFreq: expectedBand.freq,
        expectedBandDb: expectedBand.db,
        expectedBandCents: expectedBand.cents,
        expectedBandDeltaDb: expectedBand.deltaFromDominantDb,
        expectedFreq: expected, pitchCents,
        postRmsDb
      };
    } catch (e) {
      return { error: e.message || String(e) };
    }
  }, { midi, settleMs, postReleaseMs, expectedMidi, fftSize: FFT_SIZE, sampleRate: SAMPLE_RATE });
}

// ============================================================
// Flag classification
// ============================================================

function isZeroSustainPercussivePreset(preset) {
  const settings = preset && preset.settings ? preset.settings : {};
  const adsr = settings.adsr || {};
  const sustain = Number(adsr.s);
  const decay = Number(adsr.d);
  return Number.isFinite(sustain) && sustain <= 5 && Number.isFinite(decay) && decay <= 500;
}

function inferSubtractiveOctaveOffset(preset) {
  const settings = preset && preset.settings ? preset.settings : {};
  const oscs = Array.isArray(settings.osc) ? settings.osc : [];
  let loudest = null;
  for (let i = 0; i < oscs.length; i++) {
    const level = Number(oscs[i].level);
    const oct = Number(oscs[i].oct);
    if (!Number.isFinite(level) || level <= 0 || !Number.isFinite(oct)) continue;
    if (!loudest || level > loudest.level) loudest = { level, oct };
  }
  return loudest ? loudest.oct * 12 : 0;
}

function validationProfile(engineName, preset) {
  const profile = {
    expectedMidi: MIDI_C4,
    settleMs: SETTLE_MS,
    postReleaseMs: POST_RELEASE_WAIT_MS,
    pitchPolicy: 'strict',
    pitchToleranceCents: 100,
    driftToleranceCents: 50,
    expectedBandToleranceCents: 180,
    expectedBandMinRelativeDb: -48,
    minAutocorr: 0.3,
    notes: []
  };

  if (engineName === 'Physical' || engineName === 'Reed') {
    profile.settleMs = PHYSICAL_SETTLE_MS;
  }

  if (engineName === 'Subtractive') {
    profile.expectedMidi = MIDI_C4 + inferSubtractiveOctaveOffset(preset);
    profile.pitchToleranceCents = 150;
    profile.driftToleranceCents = 90;
    profile.expectedBandToleranceCents = 180;
    if (isZeroSustainPercussivePreset(preset)) {
      profile.settleMs = 80;
      profile.pitchPolicy = 'transient';
      profile.driftToleranceCents = 120;
      profile.minAutocorr = 0;
      profile.notes.push('short zero-sustain envelope');
    }
  }

  if (engineName === 'FM' && isZeroSustainPercussivePreset(preset)) {
    profile.postReleaseMs = LONG_POST_RELEASE_WAIT_MS;
    profile.notes.push('short/tail-sensitive preset');
  }

  if (UNPITCHED_ENGINES.includes(engineName)) {
    profile.pitchPolicy = 'unpitched';
    profile.postReleaseMs = LONG_POST_RELEASE_WAIT_MS;
    profile.notes.push('unpitched engine');
  }

  if (COMPLEX_PITCH_ENGINES.includes(engineName)) {
    profile.pitchPolicy = 'complex';
    profile.minAutocorr = 0;
    profile.notes.push('complex harmonic/inharmonic engine');
  }

  if (['Wavetable', 'SuperWave', 'Additive', 'Granular', 'Formant', 'PhaseDist', 'Vector', 'Wavefolder', 'Vocoder', 'Chip'].includes(engineName)) {
    profile.expectedBandToleranceCents = 220;
    profile.expectedBandMinRelativeDb = -48;
    profile.notes.push('expected-note spectral-band fallback');
  }

  if (engineName === 'Modal' && isTransientModalPreset(preset)) {
    profile.settleMs = 80;
    profile.pitchPolicy = 'transient';
    profile.minAutocorr = 0;
    profile.notes.push('struck modal transient');
  }

  return profile;
}

function isTransientModalPreset(preset) {
  const settings = preset && preset.settings ? preset.settings : {};
  const excitation = settings.excitation || 'mallet';
  const adsr = settings.adsr || {};
  const sustain = Number(adsr.s);
  return (
    excitation === 'mallet' ||
    excitation === 'impulse' ||
    excitation === 'noise' ||
    !Number.isFinite(sustain) ||
    sustain <= 5
  );
}

function flagResult(result, engineName, profile) {
  const flags = [];
  if (result.error) { flags.push('ERROR'); return flags; }

  if (result.rmsDb < -60) flags.push('SILENCE');
  if (result.peak > 0.99) flags.push('CLIPPING');
  if (result.rmsDb > -3) flags.push('EXCESSIVE_VOLUME');

  const isUnpitched = profile.pitchPolicy === 'unpitched';
  const isComplexPitch = profile.pitchPolicy === 'complex' || profile.pitchPolicy === 'transient';
  let measuredPitchCents = result.pitchCents;
  const expectedBandUsable =
    result.expectedBandCents !== null &&
    result.expectedBandCents !== undefined &&
    Math.abs(result.expectedBandCents) <= profile.expectedBandToleranceCents &&
    result.expectedBandDeltaDb !== null &&
    result.expectedBandDeltaDb >= profile.expectedBandMinRelativeDb;
  if (!isUnpitched && !isComplexPitch && expectedBandUsable) {
    measuredPitchCents = 0;
  }

  if (!isUnpitched && !isComplexPitch && measuredPitchCents !== null) {
    const absCents = Math.abs(measuredPitchCents);
    if (absCents > 1000 && absCents < 1400) {
      flags.push('TRANSPOSED_OCTAVE');
    } else if (absCents > 2200 && absCents < 2600) {
      flags.push('TRANSPOSED_2OCT');
    } else if (absCents > profile.pitchToleranceCents) {
      flags.push('WRONG_PITCH');
    } else if (absCents > profile.driftToleranceCents) {
      flags.push('PITCH_DRIFT');
    }
  }

  if (!isUnpitched && !isComplexPitch && result.acCorr < profile.minAutocorr && result.rmsDb > -60) {
    flags.push('EXCESSIVE_NOISE');
  }

  if (result.postRmsDb > -30) flags.push('EXCESSIVE_DURATION');

  return flags;
}

function writeIncrementalResults(results, file) {
  fs.writeFileSync(file, JSON.stringify(results, null, 2));
}

// ============================================================
// Preset selection logic
// ============================================================

function selectPresetsForEngine(engineName, engineInfo) {
  const presets = [];
  const catNames = engineInfo.categoryNames;

  if (FULL_SWEEP_ENGINES.includes(engineName)) {
    // ALL presets for full-sweep engines
    for (const cat of catNames) {
      const catPresets = engineInfo.categories[cat] || [];
      for (const p of catPresets) {
        presets.push(p);
      }
    }
  } else if (engineName === 'Physical') {
    // ALL presets for Bowed/Blown/Plucked, first preset for others
    for (const cat of catNames) {
      const catPresets = engineInfo.categories[cat] || [];
      if (catPresets.length === 0) continue;
      if (PHYSICAL_FULL_CATEGORIES.includes(cat)) {
        for (const p of catPresets) presets.push(p);
      } else {
        presets.push(catPresets[0]);
      }
    }
  } else {
    // First preset per category
    for (const cat of catNames) {
      const catPresets = engineInfo.categories[cat] || [];
      if (catPresets.length > 0) presets.push(catPresets[0]);
    }
  }

  return presets;
}

// ============================================================
// Main sweep
// ============================================================

async function main() {
  const startTime = Date.now();
  const browser = await chromium.launch(browserLaunchOptions());

  console.log('Loading SSLI to get inventory...');
  let invPage = await launchPage(browser);
  const inventory = await getInventory(invPage);
  await invPage.close();

  if (inventory.error) {
    console.error('ERROR:', inventory.error);
    await browser.close();
    process.exit(1);
  }

  console.log(`Found ${inventory.engines.length} engines`);
  if (inventory.surfaces.length > 0) {
    console.log(`Surfaces from page: ${inventory.surfaces.join(', ')}`);
  } else {
    console.log(`Using hardcoded surface list (${CONTROL_SURFACES.length} surfaces)`);
  }

  let surfaceList = inventory.surfaces.length > 0 ? inventory.surfaces : CONTROL_SURFACES;
  if (surfacesFilter) {
    const wanted = surfacesFilter.split(',').map(s => s.trim()).filter(Boolean);
    surfaceList = surfaceList.filter(surface => wanted.some(w => surface === w || surface.indexOf(w) >= 0 || w.indexOf(surface) >= 0));
    if (surfaceList.length === 0) {
      console.error(`ERROR: --surfaces filter matched no surfaces: ${surfacesFilter}`);
      await browser.close();
      process.exit(1);
    }
  }

  // Build test plan
  const testPlan = [];
  for (const engineName of inventory.engines) {
    if (engineFilter && engineName !== engineFilter) continue;
    const engineInfo = inventory.info[engineName];
    let presets = selectPresetsForEngine(engineName, engineInfo);
    if (maxPresetsPerEngine > 0) presets = presets.slice(0, maxPresetsPerEngine);
    testPlan.push({ engine: engineName, presets });
    if (maxEngines > 0 && testPlan.length >= maxEngines) break;
  }
  if (testPlan.length === 0) {
    console.error(`ERROR: no engines matched requested filters`);
    await browser.close();
    process.exit(1);
  }

  let totalTests = 0;
  for (const ep of testPlan) totalTests += ep.presets.length * surfaceList.length;
  console.log(`\nTest plan: ${testPlan.length} engines, ${surfaceList.length} surfaces, ${totalTests} total tests\n`);

  const allResults = [];
  let testIdx = 0;

  for (const ep of testPlan) {
    const engineName = ep.engine;
    const presets = ep.presets;
    if (presets.length === 0) continue;

    const isPhysicalOrReed = (engineName === 'Physical' || engineName === 'Reed');
    const initMs = isPhysicalOrReed ? PHYSICAL_ENGINE_INIT_MS : ENGINE_INIT_MS;

    console.log(`=== ${engineName} (${presets.length} presets x ${surfaceList.length} surfaces = ${presets.length * surfaceList.length} tests) ===`);
    const page = await launchPage(browser);

    for (const preset of presets) {
      // Apply preset
      const applyResult = await page.evaluate((params) => {
        const SL = window.SynthLab;
        const presets = SL.presets.getPresetsForEngineCategory(params.engine, params.category);
        let presetObj = null;
        for (let i = 0; i < presets.length; i++) {
          if (presets[i].name === params.name) { presetObj = presets[i]; break; }
        }
        if (!presetObj) return { error: 'Preset not found' };
        const engineType = SL.presets.engineNameToType
          ? SL.presets.engineNameToType(params.engine)
          : params.engine.toLowerCase();
        presetObj.engine = engineType;
        SL.presets.apply(presetObj);
        return { ok: true };
      }, { engine: engineName, name: preset.name, category: preset.category });

      if (applyResult.error) {
        console.log(`  SKIP ${preset.name}: ${applyResult.error}`);
        for (const surface of surfaceList) {
          allResults.push({
            engine: engineName, preset: preset.name, category: preset.category,
            surface, midi: MIDI_C4, error: applyResult.error, flags: ['ERROR']
          });
          testIdx++;
        }
        continue;
      }

      await page.waitForTimeout(initMs);

      // Sweep all surfaces for this preset
      for (const surface of surfaceList) {
        testIdx++;
        const switchResult = await switchSurface(page, surface);
        await page.waitForTimeout(100);

        const profile = validationProfile(engineName, preset);
        const settleMs = settleOverrideMs || profile.settleMs;
        const postReleaseMs = postReleaseOverrideMs || profile.postReleaseMs;
        const result = await captureNote(page, MIDI_C4, settleMs, postReleaseMs, profile.expectedMidi);
        const flags = flagResult(result, engineName, profile);

        const testResult = {
          engine: engineName,
          preset: preset.name,
          category: preset.category,
          surface,
          midi: MIDI_C4,
          expectedMidi: profile.expectedMidi,
          expectedFreqHz: result.expectedFreq || EXPECTED_C4_HZ,
          validationProfile: {
            settleMs,
            postReleaseMs,
            pitchPolicy: profile.pitchPolicy,
            pitchToleranceCents: profile.pitchToleranceCents,
            driftToleranceCents: profile.driftToleranceCents,
            expectedBandToleranceCents: profile.expectedBandToleranceCents,
            expectedBandMinRelativeDb: profile.expectedBandMinRelativeDb,
            notes: profile.notes
          },
          surfaceSwitchMethod: switchResult.method || 'failed',
          ...result,
          flags
        };
        allResults.push(testResult);

        const realIssues = flags.filter(f => f !== 'TRANSPOSED_OCTAVE' && f !== 'TRANSPOSED_2OCT' && f !== 'PITCH_DRIFT');
        if (realIssues.length > 0) {
          const severity = flags.some(f => ['SILENCE', 'CLIPPING', 'ERROR', 'EXCESSIVE_DURATION'].includes(f)) ? 'CRITICAL' : 'WARN';
          console.log(`  [${severity}] ${preset.name} / ${surface}: ${flags.join(', ')} (rms=${result.rmsDb?.toFixed(1)}dB freq=${result.dominantFreq?.toFixed(0)}Hz post=${result.postRmsDb?.toFixed(1)}dB)`);
        }

        await page.waitForTimeout(20);
      }

      // Progress update every preset
      const pct = ((testIdx / totalTests) * 100).toFixed(0);
      console.log(`  ${preset.name}: done (${pct}% overall)`);
    }

    await page.close();

    // Engine summary
    const engineResults = allResults.filter(r => r.engine === engineName);
    const enginePass = engineResults.filter(r => r.flags.length === 0).length;
    const engineFail = engineResults.length - enginePass;
    console.log(`  >> ${engineName}: ${enginePass} pass, ${engineFail} flagged\n`);

    // Incremental save after each engine
    writeIncrementalResults(allResults, outputFile);
  }

  // Write results
  fs.writeFileSync(outputFile, JSON.stringify(allResults, null, 2));

  // Summary
  const total = allResults.length;
  const passed = allResults.filter(r => r.flags.length === 0).length;
  const byFlag = {};
  for (const r of allResults) {
    for (const f of r.flags) byFlag[f] = (byFlag[f] || 0) + 1;
  }

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== SWEEP COMPLETE ===`);
  console.log(`Total: ${total} | Passed: ${passed} | Flagged: ${total - passed}`);
  console.log(`Flags: ${JSON.stringify(byFlag)}`);
  console.log(`Elapsed: ${elapsedSec}s`);
  console.log(`Results: ${outputFile}`);

  await browser.close();

  if (!allowFlags && total - passed > 0) {
    console.error(`AUDIO GATE FAILED: ${total - passed} flagged record(s). Re-run with --allow-flags only for exploratory, non-gate sweeps.`);
    process.exit(2);
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
