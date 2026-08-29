#!/usr/bin/env python3
"""Recovered area test runner.

Runs Python and Node tests under Tests/<Area>/ and writes aggregate JSON.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time


ROOT = os.path.abspath(os.path.dirname(__file__))
RESULTS_DIR = os.path.join(ROOT, "results")


def find_node():
    env_node = os.environ.get("NODE_EXE")
    if env_node and os.path.exists(env_node):
        return env_node
    node = shutil.which("node")
    if node:
        return node
    candidates = [
        r"C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Microsoft\VisualStudio\NodeJs\node.exe",
        r"C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Microsoft\VisualStudio\NodeJs\win-x86\node.exe",
        r"C:\Program Files (x86)\Microsoft Visual Studio\2019\Community\MSBuild\Microsoft\VisualStudio\NodeJs\node.exe",
        r"C:\Program Files (x86)\Microsoft Visual Studio\2019\Community\MSBuild\Microsoft\VisualStudio\NodeJs\win-x64\node.exe",
        r"C:\Program Files (x86)\Microsoft Visual Studio\2017\Community\MSBuild\Microsoft\VisualStudio\NodeJs\node.exe",
        r"C:\Program Files (x86)\Microsoft Visual Studio\2017\Community\MSBuild\Microsoft\VisualStudio\NodeJs\win-x64\node.exe",
        r"C:\Users\hanis\AppData\Local\atom\app-1.33.1\resources\app\apm\bin\node.exe",
    ]
    for candidate in candidates:
        if os.path.exists(candidate):
            return candidate
    return None


def area_dirs():
    result = []
    for name in sorted(os.listdir(ROOT)):
        path = os.path.join(ROOT, name)
        if os.path.isdir(path) and name != "results" and not name.startswith("_"):
            result.append(name)
    return result


def test_files(area):
    path = os.path.join(ROOT, area)
    files = []
    for name in sorted(os.listdir(path)):
        if name.startswith("test_") and (name.endswith(".py") or name.endswith(".js")):
            files.append(os.path.join(path, name))
    return files


def parse_json_line(text):
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for line in reversed(lines):
        if line.startswith("{") and line.endswith("}"):
            try:
                return json.loads(line)
            except ValueError:
                return None
    return None


def run_one(file_path):
    start = time.time()
    ext = os.path.splitext(file_path)[1].lower()
    if ext == ".py":
        cmd = [sys.executable, file_path]
    else:
        node = find_node()
        if not node:
            raise RuntimeError("Node.js executable not found")
        cmd = [node, file_path]
    proc = subprocess.run(cmd, cwd=ROOT, text=True, capture_output=True, timeout=180)
    duration_ms = int((time.time() - start) * 1000)
    parsed = parse_json_line(proc.stdout)
    if parsed is None:
        parsed = {
            "name": os.path.basename(file_path),
            "pass": proc.returncode == 0,
            "assertions": 1 if proc.returncode == 0 else 0,
            "failures": [] if proc.returncode == 0 else ["No JSON result line"],
            "duration_ms": duration_ms,
        }
    parsed["file"] = os.path.relpath(file_path, ROOT)
    parsed["exitCode"] = proc.returncode
    parsed["stdout"] = proc.stdout[-4000:]
    parsed["stderr"] = proc.stderr[-4000:]
    if parsed.get("assertions", 0) <= 0:
        parsed["pass"] = False
        parsed.setdefault("failures", []).append("Zero assertions is not a valid pass")
    return parsed


def run_area(area):
    files = test_files(area)
    if not files:
        return {
            "area": area,
            "pass": False,
            "tests": [],
            "failures": ["No tests found for area"],
            "duration_ms": 0,
        }
    start = time.time()
    tests = []
    failures = []
    for file_path in files:
        try:
            result = run_one(file_path)
        except Exception as exc:
            result = {
                "name": os.path.basename(file_path),
                "pass": False,
                "assertions": 0,
                "failures": [str(exc)],
                "file": os.path.relpath(file_path, ROOT),
            }
        tests.append(result)
        if not result.get("pass"):
            failures.append(result.get("name", result["file"]))
    return {
        "area": area,
        "pass": len(failures) == 0,
        "tests": tests,
        "failures": failures,
        "duration_ms": int((time.time() - start) * 1000),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("area", nargs="?")
    parser.add_argument("--all", action="store_true")
    args = parser.parse_args()
    targets = area_dirs() if args.all else [args.area]
    if not args.all and not args.area:
        print("ERROR: pass an area or --all")
        return 1

    os.makedirs(RESULTS_DIR, exist_ok=True)
    all_results = []
    status = 0
    for area in targets:
        result = run_area(area)
        all_results.append(result)
        out_path = os.path.join(RESULTS_DIR, area + "_results.json")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2)
        print(json.dumps({
            "area": area,
            "pass": result["pass"],
            "tests": len(result["tests"]),
            "failures": result["failures"],
            "duration_ms": result["duration_ms"],
        }))
        if not result["pass"]:
            status = 1

    with open(os.path.join(RESULTS_DIR, "_all_results.json"), "w", encoding="utf-8") as f:
        json.dump(all_results, f, indent=2)
    return status


if __name__ == "__main__":
    sys.exit(main())
