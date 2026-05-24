#!/usr/bin/env python3
"""Build Super Synth Lab Instrument from source.

Produces a single self-contained HTML file with all CSS, JS, worklets,
and data inlined. No external dependencies beyond Python 3.6+.

Usage:
    python build.py              # Build to dist/index.html
    python build.py --output X   # Build to custom path
"""
import json
import os
import re
import sys

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
ASSETS_DIR = os.path.join(PROJECT_DIR, "assets")

# These lists are extracted from the canonical build — do not reorder.
# CSS_FILES and JS_FILES are read from _build_manifest.json at runtime.

DATA_MANIFEST = "data/_manifest.json"

WORKLET_FILES = {
    "synth-worklet.js": {
        "global": "__SSL_WORKLET_CODE",
        "find": "await audioContext.audioWorklet.addModule('assets/synth-worklet.js')",
        "var_prefix": "__w",
        "is_main": True,
    },
    "fm-worklet.js": {
        "global": "__SSL_FM_WORKLET_CODE",
        "find": "audioContext.audioWorklet.addModule('assets/fm-worklet.js')",
        "var_prefix": "__fm",
        "is_main": False,
    },
    "physical-worklet.js": {
        "global": "__SSL_PHYSICAL_WORKLET_CODE",
        "find": "audioContext.audioWorklet.addModule('assets/physical-worklet.js')",
        "var_prefix": "__phys",
        "is_main": False,
    },
    "formant-worklet.js": {
        "global": "__SSL_FORMANT_WORKLET_CODE",
        "find": "audioContext.audioWorklet.addModule('assets/formant-worklet.js')",
        "var_prefix": "__form",
        "is_main": False,
    },
}


def load_manifest():
    """Load the build manifest which lists CSS and JS files in order."""
    manifest_path = os.path.join(PROJECT_DIR, "_build_manifest.json")
    with open(manifest_path, "r", encoding="utf-8") as f:
        return json.load(f)


def build():
    output_arg = None
    if "--output" in sys.argv:
        idx = sys.argv.index("--output")
        if idx + 1 < len(sys.argv):
            output_arg = sys.argv[idx + 1]

    manifest = load_manifest()
    css_files = manifest["css_files"]
    js_files = manifest["js_files"]
    init_script = manifest["init_script"]

    shell_path = os.path.join(PROJECT_DIR, ".shell.html")
    if not os.path.exists(shell_path):
        print("ERROR: .shell.html not found")
        sys.exit(1)

    with open(shell_path, "r", encoding="utf-8") as f:
        html = f.read()

    # Find and remove the asset loader script block
    loader_start = html.find("<script>const ASSETS_BASE")
    if loader_start < 0:
        print("ERROR: Cannot find asset loader script in .shell.html")
        sys.exit(1)

    loader_end = html.find("</script>", loader_start) + len("</script>")
    html_before = html[:loader_start]
    html_after = html[loader_end:]

    # Collect CSS
    css_parts = []
    for path in css_files:
        full = os.path.join(ASSETS_DIR, path)
        if os.path.exists(full):
            with open(full, "r", encoding="utf-8") as f:
                css_parts.append("/* === " + os.path.basename(path) + " === */\n" + f.read())
        else:
            print("WARNING: CSS file not found: " + path)
    all_css = "\n\n".join(css_parts)

    # Inline JSON data
    data_js_parts = []
    data_manifest_path = os.path.join(ASSETS_DIR, DATA_MANIFEST)
    if os.path.exists(data_manifest_path):
        with open(data_manifest_path, "r", encoding="utf-8") as f:
            data_manifest = json.load(f)
        data_js_parts.append("// === Inlined JSON data ===")
        data_js_parts.append("var SynthLab = window.SynthLab || {};")
        data_js_parts.append("SynthLab._data = SynthLab._data || {};")
        data_count = 0
        for entry in data_manifest.get("files", []):
            data_path = os.path.join(ASSETS_DIR, entry["file"])
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
    js_parts = []
    for path in js_files:
        full = os.path.join(ASSETS_DIR, path)
        if os.path.exists(full):
            with open(full, "r", encoding="utf-8") as f:
                js_parts.append("// === " + os.path.basename(path) + " ===\n" + f.read())
        else:
            print("WARNING: JS file not found: " + path)
    all_js = data_js + "\n\n" + "\n\n".join(js_parts) if data_js else "\n\n".join(js_parts)

    # Inline AudioWorklets as Blob URLs
    for worklet_name, cfg in WORKLET_FILES.items():
        worklet_path = os.path.join(ASSETS_DIR, worklet_name)
        if not os.path.exists(worklet_path):
            continue
        with open(worklet_path, "r", encoding="utf-8") as f:
            worklet_code = f.read()
        worklet_escaped = (worklet_code
            .replace("\\", "\\\\")
            .replace("`", "\\`")
            .replace("${", "\\${"))
        all_js = (
            "// === Inlined " + worklet_name + " ===\n"
            "window." + cfg["global"] + " = `" + worklet_escaped + "`;\n\n"
            + all_js
        )
        prefix = cfg["var_prefix"]
        if cfg["is_main"]:
            blob_load = (
                "var " + prefix + "Blob = new Blob([window." + cfg["global"] + "], "
                "{type: 'application/javascript'});\n"
                "        var " + prefix + "Url = URL.createObjectURL(" + prefix + "Blob);\n"
                "        await audioContext.audioWorklet.addModule(" + prefix + "Url);\n"
                "        URL.revokeObjectURL(" + prefix + "Url)"
            )
        else:
            blob_load = (
                "var " + prefix + "Blob = new Blob([window." + cfg["global"] + "], "
                "{type: 'application/javascript'});\n"
                "        var " + prefix + "Url = URL.createObjectURL(" + prefix + "Blob);\n"
                "        audioContext.audioWorklet.addModule(" + prefix + "Url).then(function() {\n"
                "          URL.revokeObjectURL(" + prefix + "Url);\n"
                "        })"
            )
        if cfg["find"] in all_js:
            all_js = all_js.replace(cfg["find"], blob_load)

    # Assemble
    head_close = html_before.find("</head>")
    if head_close < 0:
        print("ERROR: Could not find </head>")
        sys.exit(1)

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
