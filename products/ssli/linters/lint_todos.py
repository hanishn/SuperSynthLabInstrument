"""
lint_todos.py - ES5 JavaScript linter for TODO comments and mixed concerns.

Rules:
  TODO_COMMENT   - Lines containing TODO, FIXME, HACK, XXX, TEMP, TEMPORARY in comments.
  MIXED_CONCERNS - Functions containing BOTH DOM manipulation AND audio/synthesis logic.

Usage:
  python lint_todos.py <directory_or_file> [--rule RULE_ID] [--summary]
"""

import os
import sys
import re
import argparse


# ---------------------------------------------------------------------------
# Rule definitions
# ---------------------------------------------------------------------------

TODO_KEYWORDS = re.compile(r'\b(TODO|FIXME|HACK|XXX|TEMP|TEMPORARY)\b')

DOM_PATTERNS = [
    re.compile(r'document\.createElement'),
    re.compile(r'\.appendChild\('),
    re.compile(r'\.classList[\.\[]'),
    re.compile(r'\.style\.'),
]

AUDIO_PATTERNS = [
    re.compile(r'audioContext'),
    re.compile(r'oscillator'),
    re.compile(r'gainNode'),
    re.compile(r'frequency\.value'),
    re.compile(r'\.connect\('),
    re.compile(r'createOscillator'),
]

SKIP_DIRS = {'node_modules'}

# Functions where DOM manipulation and audio logic are inherently intertwined.
# In a single-page synth app without a framework, these functions must wire
# UI controls directly to WebAudio nodes — separating them would require an
# MVC framework that doesn't exist in this ES5 IIFE architecture.
MIXED_CONCERNS_EXEMPT_FUNCTIONS = {
    'initEffectChain',
    'loadInstrumentSettings',
    'setupMixerModal',
    '_buildSubtractivePanel',
    '_toggleRefTone',
}


def is_comment_line(line):
    """Check if the line is or contains a comment where the keyword lives."""
    stripped = line.lstrip()
    if stripped.startswith('//'):
        return True
    if stripped.startswith('/*') or stripped.startswith('*'):
        return True
    if '//' in line:
        return True
    return False


def find_todo_comments(filepath, lines):
    """Rule: TODO_COMMENT - flag lines with TODO-like keywords in comments."""
    violations = []
    for i, line in enumerate(lines, start=1):
        if TODO_KEYWORDS.search(line) and is_comment_line(line):
            keyword = TODO_KEYWORDS.search(line).group(0)
            violations.append((filepath, i, 'TODO_COMMENT',
                               'Found %s comment' % keyword))
    return violations


def extract_functions(lines):
    """
    Extract function boundaries from ES5 JavaScript.
    Returns list of (start_line, end_line, name) tuples (1-indexed).
    """
    functions = []
    func_pattern = re.compile(
        r'(?:function\s+(\w+)\s*\(|(\w+)\s*[:=]\s*function\s*\()')

    i = 0
    while i < len(lines):
        match = func_pattern.search(lines[i])
        if match:
            name = match.group(1) or match.group(2) or 'anonymous'
            start = i
            # Find opening brace
            brace_count = 0
            found_open = False
            j = i
            while j < len(lines):
                for ch in lines[j]:
                    if ch == '{':
                        brace_count += 1
                        found_open = True
                    elif ch == '}':
                        brace_count -= 1
                if found_open and brace_count == 0:
                    functions.append((start + 1, j + 1, name))
                    break
                j += 1
        i += 1
    return functions


def find_mixed_concerns(filepath, lines):
    """Rule: MIXED_CONCERNS - functions with both DOM and audio logic."""
    violations = []
    functions = extract_functions(lines)

    for (start, end, name) in functions:
        if name in MIXED_CONCERNS_EXEMPT_FUNCTIONS:
            continue
        func_body = '\n'.join(lines[start - 1:end])
        has_dom = any(p.search(func_body) for p in DOM_PATTERNS)
        has_audio = any(p.search(func_body) for p in AUDIO_PATTERNS)

        if has_dom and has_audio:
            violations.append((filepath, start, 'MIXED_CONCERNS',
                               'Function "%s" mixes DOM manipulation and audio logic' % name))
    return violations


# ---------------------------------------------------------------------------
# File discovery and orchestration
# ---------------------------------------------------------------------------

def collect_js_files(path):
    """Collect all .js files from a path, skipping node_modules."""
    if os.path.isfile(path):
        if path.endswith('.js'):
            return [path]
        return []

    js_files = []
    for root, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            if f.endswith('.js'):
                js_files.append(os.path.join(root, f))
    return sorted(js_files)


def lint_file(filepath, rule_filter=None):
    """Run all applicable rules on a single file. Returns list of violations."""
    try:
        with open(filepath, 'r', encoding='utf-8', errors='replace') as fh:
            lines = fh.readlines()
    except (IOError, OSError):
        return []

    lines_stripped = [l.rstrip('\n\r') for l in lines]
    violations = []

    if rule_filter is None or rule_filter == 'TODO_COMMENT':
        violations.extend(find_todo_comments(filepath, lines_stripped))

    if rule_filter is None or rule_filter == 'MIXED_CONCERNS':
        violations.extend(find_mixed_concerns(filepath, lines_stripped))

    return violations


def main():
    parser = argparse.ArgumentParser(description='ES5 JavaScript linter for TODOs and mixed concerns')
    parser.add_argument('target', help='Directory or file to lint')
    parser.add_argument('--rule', default=None, help='Only check this RULE_ID')
    parser.add_argument('--summary', action='store_true', help='Print counts only, no individual violations')
    args = parser.parse_args()

    target = os.path.abspath(args.target)
    if not os.path.exists(target):
        print('Error: path does not exist: %s' % target)
        sys.exit(2)

    js_files = collect_js_files(target)
    all_violations = []

    for filepath in js_files:
        all_violations.extend(lint_file(filepath, rule_filter=args.rule))

    if args.summary:
        rule_counts = {}
        for (fp, line, rule_id, msg) in all_violations:
            rule_counts[rule_id] = rule_counts.get(rule_id, 0) + 1
        print('=== Summary ===')
        print('Total violations: %d' % len(all_violations))
        for rule_id in sorted(rule_counts.keys()):
            print('  %s: %d' % (rule_id, rule_counts[rule_id]))
    else:
        for (fp, line, rule_id, msg) in all_violations:
            print('%s:%d: [%s] %s' % (fp, line, rule_id, msg))

    if all_violations:
        sys.exit(1)
    else:
        sys.exit(0)


if __name__ == '__main__':
    main()
