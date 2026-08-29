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
