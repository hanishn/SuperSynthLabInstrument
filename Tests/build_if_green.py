#!/usr/bin/env python3
"""Recovered gated build command."""
import argparse
import os
import subprocess
import sys


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("area", nargs="?")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--product", default="ssli", choices=["ssli"])
    parser.add_argument("--variant", default="public", choices=["internal", "public"])
    parser.add_argument("--confirm-public", action="store_true")
    parser.add_argument("--export", action="store_true", default=True)
    args = parser.parse_args()

    runner = os.path.join(ROOT, "Tests", "run_area_tests.py")
    test_cmd = [sys.executable, runner]
    if args.all:
        test_cmd.append("--all")
    elif args.area:
        test_cmd.append(args.area)
    else:
        print("ERROR: pass an area or --all")
        return 1

    print("Gate step 1: tests")
    test_rc = subprocess.run(test_cmd, cwd=ROOT).returncode
    if test_rc != 0:
        print("Gate failed: tests are not green")
        return test_rc

    print("Gate step 2: build")
    build_script = os.path.join(ROOT, "build", "build.py")
    build_cmd = [sys.executable, build_script, args.product, "--variant", args.variant, "--export"]
    if args.variant == "public":
        if not args.confirm_public:
            print("ERROR: public build requires --confirm-public")
            return 1
        build_cmd.append("--confirm-public")
    return subprocess.run(build_cmd, cwd=ROOT).returncode


if __name__ == "__main__":
    sys.exit(main())
