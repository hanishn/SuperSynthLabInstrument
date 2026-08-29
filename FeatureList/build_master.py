#!/usr/bin/env python3
"""Build recovered SSLI master feature list."""
import os
import subprocess
import sys


ROOT = os.path.abspath(os.path.dirname(__file__))
OUT_PATH = os.path.join(ROOT, "SSLI-Feature-List.md")


def main():
    build_area = os.path.join(ROOT, "build_area.py")
    rc = subprocess.run([sys.executable, build_area, "--all"], cwd=ROOT).returncode
    if rc != 0:
        return rc
    with open(OUT_PATH, "w", encoding="utf-8") as out:
        out.write("# SSLI Master Feature List\n\n")
        out.write("Reconstructed from migrated references on 2026-06-07.\n\n")
        index = os.path.join(ROOT, "00-Index.md")
        if os.path.exists(index):
            with open(index, "r", encoding="utf-8") as f:
                out.write(f.read().rstrip() + "\n\n")
        for area in sorted(os.listdir(ROOT)):
            area_path = os.path.join(ROOT, area)
            if os.path.isdir(area_path):
                area_file = os.path.join(area_path, "_Area-Feature-List.md")
                if os.path.exists(area_file):
                    with open(area_file, "r", encoding="utf-8") as f:
                        out.write(f.read().rstrip() + "\n\n")
    print("Built " + OUT_PATH)
    return 0


if __name__ == "__main__":
    sys.exit(main())
