#!/usr/bin/env python3
"""Top-level SSLI build wrapper for the clean GitHub reconstruction.

The GitHub baseline is monorepo-shaped. Delegate to the repository root
`build.py` so shared/assets and products/ssli/assets are both resolved.
"""
import argparse
import os
import subprocess
import sys


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("product", choices=["ssli"])
    parser.add_argument("--variant", default="public", choices=["public", "internal"])
    parser.add_argument("--confirm-public", action="store_true")
    parser.add_argument("--export", action="store_true", default=True)
    parser.add_argument("--output")
    args = parser.parse_args()

    if args.variant == "internal":
        print("ERROR: internal variant is not available in the clean GitHub baseline build.py")
        return 1

    output = args.output or os.path.join(
        ROOT, "products", args.product, "export", "SuperSynthLabInstrument.html"
    )
    os.makedirs(os.path.dirname(output), exist_ok=True)

    cmd = [sys.executable, os.path.join(ROOT, "build.py"), args.product, "--output", output]
    return subprocess.run(cmd, cwd=ROOT).returncode


if __name__ == "__main__":
    sys.exit(main())
