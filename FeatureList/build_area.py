#!/usr/bin/env python3
"""Build recovered per-area feature documents."""
import argparse
import os
import sys


ROOT = os.path.abspath(os.path.dirname(__file__))


def area_dirs():
    result = []
    for name in sorted(os.listdir(ROOT)):
        path = os.path.join(ROOT, name)
        if os.path.isdir(path):
            result.append(name)
    return result


def build_area(area):
    path = os.path.join(ROOT, area)
    if not os.path.isdir(path):
        print("ERROR: unknown area " + area)
        return 1
    files = []
    for name in sorted(os.listdir(path)):
        if name.lower().endswith(".md") and not name.startswith("_"):
            files.append(os.path.join(path, name))
    if not files:
        print("ERROR: no feature docs in " + path)
        return 1
    out_path = os.path.join(path, "_Area-Feature-List.md")
    with open(out_path, "w", encoding="utf-8") as out:
        out.write("# " + area + " Feature List\n\n")
        for file_path in files:
            with open(file_path, "r", encoding="utf-8") as f:
                out.write(f.read().rstrip() + "\n\n")
    print("Built " + out_path)
    return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("area", nargs="?", help="Area name")
    parser.add_argument("--all", action="store_true")
    args = parser.parse_args()

    targets = area_dirs() if args.all else [args.area]
    if not args.all and not args.area:
        print("ERROR: pass an area or --all")
        return 1
    status = 0
    for area in targets:
        rc = build_area(area)
        if rc != 0:
            status = rc
    return status


if __name__ == "__main__":
    sys.exit(main())
