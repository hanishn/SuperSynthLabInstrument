# Recovered Audio Validation

The original `audioValidation\run_voicing_sweep.js` file was not found as a migrated standalone file.

Recovered evidence says the original audio validation process included:

- `run_voicing_sweep.js`
- `run_touch_target_test.js`
- `screenshot_surfaces.js`
- `take_screenshots.js`
- `results\`
- `reports\MASTER_REPORT.md`
- `reports\all_results.csv`

Current rebuilt process status:

- The Day 0 SSLI source contains many audio and UI validation scripts, including `test_engine_surface_sweep.py`, `test_blown_reed_regression.js`, `test_bowed_audio.js`, `test_kaoss_audio.js`, and `test_voicing_chords.js`.
- `run_voicing_sweep.js` has been rebuilt as an entrypoint that delegates to `products\ssli\test_engine_surface_capture.js`.
- Running the rebuilt JavaScript audio sweep requires Node.js. Node is not on PATH in this runtime, but Visual Studio Node is available at `C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Microsoft\VisualStudio\NodeJs\node.exe`.
- The wrapper forwards optional CLI limits to the migrated capture script. The default remains the full recovered sweep.

Quick recovered smoke command:

```powershell
& 'C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Microsoft\VisualStudio\NodeJs\node.exe' audioValidation\run_voicing_sweep.js --output audioValidation\results\voicing_smoke_one_surface.json --max-presets-per-engine 1 --surfaces Piano
```

Validated quick smoke result, 2026-06-07:

- Results: `audioValidation\results\voicing_smoke_one_surface.json`
- Coverage: 20 engines, one preset per engine, Piano surface.
- Result count: 20 records, 13 unflagged, 7 flagged.
- Flag counts: `SILENCE` 1, `WRONG_PITCH` 2, `TRANSPOSED_2OCT` 2, `TRANSPOSED_OCTAVE` 1, `EXCESSIVE_DURATION` 2.
- Surface switch method: `dropdown:#ssliPlaySurfaceSelect` for all 20 records.
- Full sweep started with explicit Node but exceeded a 10-minute command timeout. Treat full-sweep completion as a long-running validation task, not a missing-Node blocker.
