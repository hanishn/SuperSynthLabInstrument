#!/usr/bin/env python3
import json
import os
import sys


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PRODUCT = os.path.join(ROOT, "products", "ssli")
TESTS = os.path.join(ROOT, "Tests")
FEATURES = os.path.join(ROOT, "FeatureList")


assertions = 0
failures = []


def check(name, condition, detail):
    global assertions
    assertions += 1
    if not condition:
        failures.append(name + ": " + detail)


def exists(rel):
    return os.path.exists(os.path.join(ROOT, rel))


check("BUILD-001 root monorepo build script", exists("build.py"), "missing root build.py")
check("BUILD-001 top-level build wrapper", exists("build/build.py"), "missing build/build.py")
check("BUILD-001 product manifest", exists("products/ssli/product.json"), "missing products/ssli/product.json")
check("BUILD-001 shared assets root", exists("shared/assets"), "missing shared/assets directory")
check("BUILD-001 shell source", exists("products/ssli/.shell.html"), "missing .shell.html")
check("BUILD-001 assets root", exists("products/ssli/assets"), "missing assets directory")
check("BUILD-002 test runner", exists("Tests/run_area_tests.py"), "missing run_area_tests.py")
check("BUILD-002 gated builder", exists("Tests/build_if_green.py"), "missing build_if_green.py")
check("BUILD-002 test harness", exists("Tests/test_harness.js"), "missing test_harness.js")
check("SCAFFOLD-001 acceptance harness", exists("products/ssli/acceptance_test.js"), "missing acceptance_test.js")
check("SCAFFOLD-002 playwright dependency",
      os.path.exists(os.path.join(PRODUCT, "node_modules", "playwright")) or
      os.path.exists(os.path.join(PRODUCT, "node_modules", "playwright-core")),
      "missing Playwright dependency in product node_modules")
check("FEATURE-001 build_area", exists("FeatureList/build_area.py"), "missing FeatureList/build_area.py")
check("FEATURE-001 build_master", exists("FeatureList/build_master.py"), "missing FeatureList/build_master.py")
check("FEATURE-001 index", exists("FeatureList/00-Index.md"), "missing FeatureList/00-Index.md")

result = {
    "name": "source_inventory",
    "pass": len(failures) == 0,
    "assertions": assertions,
    "failures": failures,
}
print(json.dumps(result))
sys.exit(0 if result["pass"] else 1)
