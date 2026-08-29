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
