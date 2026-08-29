# SSLI Master Feature List

Reconstructed from migrated references on 2026-06-07.

# SSLI Recovered Feature Index

This index is reconstructed from migrated references. It restores a feature/spec surface for test gating.

## Areas

- `Build` - source layout, build script, exhibit format, internal-build default.
- `Scaffold` - landing page, app shell, screen navigation, loading-screen handling.
- `AudioPipeline` - note output, engine availability, safety limiter, worklet fallback.
- `ControlSurfaces` - control surface registration and rendering.
- `Localization` - language data and language switch behavior.
- `Settings` - persistence, MIDI screen, project/runtime settings.
- `Ergonomics` - desktop and phone-landscape rendering checks.

## Recovered Process Rule

Every product change must map to a feature ID, an automated test assertion, a passing area test, and a green gated build.

# Build Feature List

### [BUILD-001] GitHub Baseline Build Path

Top-level builds for this clean reconstruction use the GitHub baseline monorepo build path.

**Acceptance Criteria:**
- `python build\build.py ssli --export` delegates to repository root `build.py`.
- Shared source under `shared\assets` and product source under `products\ssli\assets` are both resolved.
- The generated public export is written to `products\ssli\export\SuperSynthLabInstrument.html`.

**Affected Files:** `build\build.py`, `build.py`, `products\ssli\product.json`
**Test:** `Tests\Build\test_source_inventory.py`
### [BUILD-002] Gated Build

Builds must run through `Tests\build_if_green.py` unless explicitly doing process recovery.

**Acceptance Criteria:**
- `Tests\build_if_green.py --all` runs the test suite before building.
- Build is not invoked if any area test fails.
- Test results are written under `Tests\results`.

**Affected Files:** `Tests\build_if_green.py`, `Tests\run_area_tests.py`
**Test:** `Tests\Build\test_source_inventory.py`

# Scaffold Feature List

### [SCAFFOLD-001] Exhibit Source Exists

SSLI source must include the shell, build script, asset root, and package metadata needed to run browser tests.

**Acceptance Criteria:**
- `.shell.html` exists.
- `build_exhibit.py` exists.
- `assets\` exists.
- `acceptance_test.js` exists.
- `package.json` exists.

**Affected Files:** `products\ssli\*`
**Test:** `Tests\Build\test_source_inventory.py`

### [SCAFFOLD-002] Acceptance Harness Exists

The Day 0 acceptance harness must remain available for full browser validation.

**Acceptance Criteria:**
- `products\ssli\acceptance_test.js` exists.
- `products\ssli\node_modules\playwright` or `products\ssli\node_modules\playwright-core` exists.

**Affected Files:** `products\ssli\acceptance_test.js`
**Test:** `Tests\Build\test_source_inventory.py`
