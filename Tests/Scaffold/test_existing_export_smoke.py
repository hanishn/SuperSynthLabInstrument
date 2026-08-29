#!/usr/bin/env python3
import json
import os
import sys


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
EXPORT = os.path.join(ROOT, "products", "ssli", "export", "SuperSynthLabInstrument.html")

assertions = 0
failures = []


def check(name, condition, detail):
    global assertions
    assertions += 1
    if not condition:
        failures.append(name + ": " + detail)


check("SCAFFOLD-001 export exists", os.path.exists(EXPORT), EXPORT)

html = ""
if os.path.exists(EXPORT):
    with open(EXPORT, "r", encoding="utf-8", errors="replace") as f:
        html = f.read()

check("SCAFFOLD-001 landing id exists", "ssli-landing" in html, "missing ssli-landing")
check("SCAFFOLD-001 app id exists", "ssli-app" in html, "missing ssli-app")
check("SCAFFOLD-001 play button id exists", "ssliPlayBtn" in html, "missing ssliPlayBtn")
check("SCAFFOLD-001 SynthLab namespace exists", "SynthLab" in html, "missing SynthLab")

result = {
    "name": "existing_export_smoke",
    "pass": len(failures) == 0,
    "assertions": assertions,
    "failures": failures,
}
print(json.dumps(result))
sys.exit(0 if result["pass"] else 1)
