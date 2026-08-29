"""
run_all_linters.py - Orchestrator that discovers and runs all lint_*.py linters.

Discovers all lint_*.py files in the same directory, runs each against the target,
and prints a summary table.

Usage:
  python run_all_linters.py [target_dir] [--summary] [--rule RULE_ID]
"""

import os
import sys
import subprocess
import argparse
import re
from collections import defaultdict


SKIP_DIRS = {'node_modules'}


def discover_linters(linter_dir):
    """Find all lint_*.py files in the given directory."""
    linters = []
    for f in sorted(os.listdir(linter_dir)):
        if f.startswith('lint_') and f.endswith('.py'):
            linters.append(os.path.join(linter_dir, f))
    return linters


def resolve_default_targets(linter_dir):
    """Default targets: parent directory's assets/ and .shell.html files."""
    parent = os.path.dirname(linter_dir)
    targets = []

    assets_dir = os.path.join(parent, 'assets')
    if os.path.isdir(assets_dir):
        targets.append(assets_dir)

    for f in os.listdir(parent):
        if f.endswith('.shell.html'):
            targets.append(os.path.join(parent, f))

    return targets


def run_linter(linter_path, target, rule_filter=None):
    """
    Run a single linter against a target. Returns (exit_code, output_lines).
    """
    cmd = [sys.executable, linter_path, target]
    if rule_filter:
        cmd.extend(['--rule', rule_filter])

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        output = result.stdout.strip()
        lines = output.split('\n') if output else []
        return result.returncode, lines
    except subprocess.TimeoutExpired:
        return 1, ['ERROR: linter timed out']
    except (IOError, OSError) as e:
        return 1, ['ERROR: %s' % str(e)]


def parse_violation_line(line):
    """
    Parse a violation line in format: filepath:line: [RULE_ID] message
    Returns (filepath, rule_id) or None.
    """
    match = re.match(r'^(.+?):(\d+): \[(\w+)\] (.+)$', line)
    if match:
        return {
            'filepath': match.group(1),
            'line': int(match.group(2)),
            'rule_id': match.group(3),
            'message': match.group(4),
        }
    return None


def main():
    parser = argparse.ArgumentParser(description='Run all lint_*.py linters')
    parser.add_argument('target', nargs='?', default=None,
                        help='Target directory or file (default: parent assets/ + .shell.html)')
    parser.add_argument('--summary', action='store_true',
                        help='Print counts only, no individual violations')
    parser.add_argument('--rule', default=None, help='Only check this RULE_ID')
    args = parser.parse_args()

    linter_dir = os.path.dirname(os.path.abspath(__file__))
    linters = discover_linters(linter_dir)

    if not linters:
        print('No linters found in %s' % linter_dir)
        sys.exit(0)

    # Resolve targets
    if args.target:
        targets = [os.path.abspath(args.target)]
    else:
        targets = resolve_default_targets(linter_dir)

    if not targets:
        print('No targets found. Specify a target directory or file.')
        sys.exit(2)

    # Run all linters against all targets
    linter_results = {}  # linter_name -> {violations: int, passed: bool, lines: []}
    all_violations = []
    rule_counts = defaultdict(int)
    file_counts = defaultdict(int)

    for linter_path in linters:
        linter_name = os.path.basename(linter_path)
        linter_violations = []
        linter_exit = 0

        for target in targets:
            if not os.path.exists(target):
                continue
            exit_code, output_lines = run_linter(linter_path, target, rule_filter=args.rule)
            if exit_code != 0:
                linter_exit = 1

            for line in output_lines:
                parsed = parse_violation_line(line)
                if parsed:
                    linter_violations.append(line)
                    all_violations.append(parsed)
                    rule_counts[parsed['rule_id']] += 1
                    file_counts[parsed['filepath']] += 1

        linter_results[linter_name] = {
            'violations': len(linter_violations),
            'passed': linter_exit == 0,
            'lines': linter_violations,
        }

    # Print individual violations (unless --summary)
    if not args.summary:
        for linter_name in sorted(linter_results.keys()):
            info = linter_results[linter_name]
            if info['lines']:
                for line in info['lines']:
                    print(line)

    # Print summary table
    print('')
    print('=' * 70)
    print('LINTER SUMMARY')
    print('=' * 70)

    # Per-linter table
    print('')
    print('%-30s %12s %8s' % ('Linter', 'Violations', 'Status'))
    print('-' * 52)
    for linter_name in sorted(linter_results.keys()):
        info = linter_results[linter_name]
        status = 'PASS' if info['passed'] else 'FAIL'
        print('%-30s %12d %8s' % (linter_name, info['violations'], status))

    # Per-rule table
    if rule_counts:
        print('')
        print('%-20s %8s' % ('Rule', 'Count'))
        print('-' * 30)
        for rule_id in sorted(rule_counts.keys()):
            print('%-20s %8d' % (rule_id, rule_counts[rule_id]))

    # Per-file top 10
    if file_counts:
        print('')
        print('Top files by violation count:')
        print('-' * 50)
        sorted_files = sorted(file_counts.items(), key=lambda x: x[1], reverse=True)
        for filepath, count in sorted_files[:10]:
            print('  %4d  %s' % (count, filepath))

    # Total
    print('')
    total = sum(info['violations'] for info in linter_results.values())
    print('Total violations: %d' % total)
    print('')

    # Exit code
    any_failed = any(not info['passed'] for info in linter_results.values())
    sys.exit(1 if any_failed else 0)


if __name__ == '__main__':
    main()
