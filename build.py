#!/usr/bin/env python3
"""Build Super Synth Lab from monorepo source.

Reads product.json to resolve files from shared/assets/ and
products/<code>/assets/, then produces a single self-contained HTML.
No external dependencies beyond Python 3.6+.

Usage:
    python build.py ssli                 # Build SSLI to dist/index.html
    python build.py ssli --output X      # Build to custom path
"""
import json
import os
import re
import sys

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
SHARED_ASSETS = os.path.join(PROJECT_DIR, "shared", "assets")

WORKLET_VAR_NAMES = {
    "synth-worklet.js": "__SSL_WORKLET_CODE",
    "fm-worklet.js": "__SSL_FM_WORKLET_CODE",
    "physical-worklet.js": "__SSL_PHYSICAL_WORKLET_CODE",
    "formant-worklet.js": "__SSL_FORMANT_WORKLET_CODE",
}

WORKLET_ADDMODULE = {
    "synth-worklet.js": "await audioContext.audioWorklet.addModule('assets/synth-worklet.js')",
    "fm-worklet.js": "audioContext.audioWorklet.addModule('assets/fm-worklet.js')",
    "physical-worklet.js": "audioContext.audioWorklet.addModule('assets/physical-worklet.js')",
    "formant-worklet.js": "audioContext.audioWorklet.addModule('assets/formant-worklet.js')",
}

WORKLET_BLOB_LOAD = {
    "synth-worklet.js": (
        "var __wBlob = new Blob([window.__SSL_WORKLET_CODE], "
        "{type: 'application/javascript'});\n"
        "        var __wUrl = URL.createObjectURL(__wBlob);\n"
        "        await audioContext.audioWorklet.addModule(__wUrl);\n"
        "        URL.revokeObjectURL(__wUrl)"
    ),
    "fm-worklet.js": (
        "var __fmBlob = new Blob([window.__SSL_FM_WORKLET_CODE], "
        "{type: 'application/javascript'});\n"
        "        var __fmUrl = URL.createObjectURL(__fmBlob);\n"
        "        audioContext.audioWorklet.addModule(__fmUrl).then(function() {\n"
        "          URL.revokeObjectURL(__fmUrl);\n"
        "        })"
    ),
    "physical-worklet.js": (
        "var __physBlob = new Blob([window.__SSL_PHYSICAL_WORKLET_CODE], "
        "{type: 'application/javascript'});\n"
        "        var __physUrl = URL.createObjectURL(__physBlob);\n"
        "        audioContext.audioWorklet.addModule(__physUrl).then(function() {\n"
        "          URL.revokeObjectURL(__physUrl);\n"
        "        })"
    ),
    "formant-worklet.js": (
        "var __formBlob = new Blob([window.__SSL_FORMANT_WORKLET_CODE], "
        "{type: 'application/javascript'});\n"
        "        var __formUrl = URL.createObjectURL(__formBlob);\n"
        "        audioContext.audioWorklet.addModule(__formUrl).then(function() {\n"
        "          URL.revokeObjectURL(__formUrl);\n"
        "        })"
    ),
}


def resolve_shared(path):
    return os.path.join(SHARED_ASSETS, path)


def resolve_product(code, path):
    return os.path.join(PROJECT_DIR, "products", code, "assets", path)


def load_product(code):
    product_path = os.path.join(PROJECT_DIR, "products", code, "product.json")
    if not os.path.exists(product_path):
        print("ERROR: product.json not found at " + product_path)
        sys.exit(1)
    with open(product_path, "r", encoding="utf-8") as f:
        return json.load(f)


def build_css_list(product):
    code = product["code"]
    css_files = []
    for p in product.get("css_shared", []):
        css_files.append(resolve_shared(p))
    for p in product.get("css_product", []):
        css_files.append(resolve_product(code, p))
    return css_files


def build_js_list(product):
    code = product["code"]
    js_files = []
    for segment in ["js_shared", "js_product_early", "js_shared_2",
                     "js_product_late", "js_shared_3", "js_product_final"]:
        for p in product.get(segment, []):
            if segment.startswith("js_product"):
                js_files.append(resolve_product(code, p))
            else:
                js_files.append(resolve_shared(p))
    return js_files


def build():
    if len(sys.argv) < 2 or sys.argv[1].startswith("-"):
        print("Usage: python build.py <product-code> [--output <path>]")
        print("  e.g. python build.py ssli")
        sys.exit(1)

    code = sys.argv[1]
    output_arg = None
    if "--output" in sys.argv:
        idx = sys.argv.index("--output")
        if idx + 1 < len(sys.argv):
            output_arg = sys.argv[idx + 1]

    product = load_product(code)

    shell_path = os.path.join(PROJECT_DIR, "products", code, ".shell.html")
    if not os.path.exists(shell_path):
        print("ERROR: .shell.html not found at " + shell_path)
        sys.exit(1)

    with open(shell_path, "r", encoding="utf-8") as f:
        html = f.read()

    loader_start = html.find("<script>const ASSETS_BASE")
    if loader_start < 0:
        print("ERROR: Cannot find asset loader script in .shell.html")
        sys.exit(1)

    loader_end = html.find("</script>", loader_start) + len("</script>")
    html_before = html[:loader_start]
    html_after = html[loader_end:]

    # Collect CSS
    css_files = build_css_list(product)
    css_parts = []
    for full in css_files:
        if os.path.exists(full):
            with open(full, "r", encoding="utf-8") as f:
                css_parts.append("/* === " + os.path.basename(full) + " === */\n" + f.read())
        else:
            print("WARNING: CSS file not found: " + full)
    all_css = "\n\n".join(css_parts)

    # Inline JSON data
    data_js_parts = []
    data_manifest_path = resolve_shared(product.get("data_manifest", "data/_manifest.json"))
    if os.path.exists(data_manifest_path):
        with open(data_manifest_path, "r", encoding="utf-8") as f:
            data_manifest = json.load(f)
        data_js_parts.append("// === Inlined JSON data ===")
        data_js_parts.append("var SynthLab = window.SynthLab || {};")
        data_js_parts.append("SynthLab._data = SynthLab._data || {};")
        data_count = 0
        for entry in data_manifest.get("files", []):
            data_path = resolve_shared(entry["file"])
            if os.path.exists(data_path):
                with open(data_path, "r", encoding="utf-8") as f:
                    data_content = f.read()
                json.loads(data_content)  # validate
                data_js_parts.append(
                    "SynthLab._data." + entry["key"] + " = " + data_content.strip() + ";"
                )
                data_count += 1
        print("Inlined " + str(data_count) + " JSON data files")
    data_js = "\n".join(data_js_parts)

    # Collect JS
    js_files = build_js_list(product)
    js_parts = []
    for full in js_files:
        if os.path.exists(full):
            with open(full, "r", encoding="utf-8") as f:
                js_parts.append("// === " + os.path.basename(full) + " ===\n" + f.read())
        else:
            print("WARNING: JS file not found: " + full)
    all_js = data_js + "\n\n" + "\n\n".join(js_parts) if data_js else "\n\n".join(js_parts)

    # Inline AudioWorklets
    for worklet_name in product.get("worklets", []):
        worklet_path = resolve_shared("worklets/" + worklet_name)
        if not os.path.exists(worklet_path):
            continue
        with open(worklet_path, "r", encoding="utf-8") as f:
            worklet_code = f.read()
        worklet_escaped = (worklet_code
            .replace("\\", "\\\\")
            .replace("`", "\\`")
            .replace("${", "\\${"))

        var_name = WORKLET_VAR_NAMES.get(worklet_name)
        if not var_name:
            continue

        all_js = (
            "// === Inlined " + worklet_name + " ===\n"
            "window." + var_name + " = `" + worklet_escaped + "`;\n\n"
            + all_js
        )

        addmodule_str = WORKLET_ADDMODULE.get(worklet_name)
        if addmodule_str and addmodule_str in all_js:
            all_js = all_js.replace(addmodule_str, WORKLET_BLOB_LOAD[worklet_name])

    # Assemble
    head_close = html_before.find("</head>")
    if head_close < 0:
        print("ERROR: Could not find </head>")
        sys.exit(1)

    init_script = product.get("init_script", "")

    unified = (
        html_before[:head_close]
        + "<style>\n" + all_css + "\n</style>\n"
        + html_before[head_close:]
        + "<script>\n" + all_js + "\n</script>\n"
        + "<script>" + init_script + "</script>\n"
        + html_after
    )

    # Write output
    if output_arg:
        output_path = output_arg
    else:
        dist_dir = os.path.join(PROJECT_DIR, "dist")
        os.makedirs(dist_dir, exist_ok=True)
        output_path = os.path.join(dist_dir, "index.html")

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(unified)

    size_kb = os.path.getsize(output_path) / 1024
    print("Built: " + output_path + " (" + str(round(size_kb, 1)) + " KB)")


if __name__ == "__main__":
    build()
