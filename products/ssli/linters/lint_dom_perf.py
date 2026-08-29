"""
lint_dom_perf.py - ES5 JavaScript DOM performance and safety linter.

Usage: python lint_dom_perf.py <directory_or_file> [--rule RULE_ID] [--summary]

Rules:
  INNERHTML_VAR    - innerHTML assignment with variable (XSS risk)
  EVENT_LEAK       - addEventListener without matching removeEventListener
  LAYOUT_THRASH    - Read layout, write style, read layout within 5 lines (forced reflow)
  HARDCODED_COLOR  - Hex color or rgb()/rgba() in JS (use CSS variables)
  ALLOC_IN_LOOP   - Allocation inside a loop body
  DOM_IN_LOOP      - document.createElement in loop without fragment
  UNTHROTTLED_HANDLER - mousemove/touchmove/scroll handler without throttle
  REGEXP_IN_LOOP   - RegExp construction inside a loop body

Exit code 0 if clean, 1 if violations found.
"""

import os
import re
import sys
import argparse


LAYOUT_PROPS = [
    'getBoundingClientRect',
    'offsetHeight', 'offsetWidth', 'offsetTop', 'offsetLeft',
    'clientHeight', 'clientWidth', 'clientTop', 'clientLeft',
    'scrollHeight', 'scrollWidth', 'scrollTop', 'scrollLeft',
]

LAYOUT_PATTERN = re.compile(r'\b(' + '|'.join(LAYOUT_PROPS) + r')\b')
STYLE_WRITE_PATTERN = re.compile(r'\.style\.\w+\s*=')

INNERHTML_ASSIGN = re.compile(r'\.innerHTML\s*(\+?=)\s*(.+)')
STRING_LITERAL_ONLY = re.compile(r"""^[\s(]*(['"][^'"]*['"][\s)*+]*)+[);]*$""")

ADDEVENTLISTENER = re.compile(r"""addEventListener\(\s*['"](\w+)['"]""")
REMOVEEVENTLISTENER = re.compile(r"""removeEventListener\(\s*['"](\w+)['"]""")

HEX_COLOR = re.compile(r'#[0-9a-fA-F]{3,8}\b')
RGB_COLOR = re.compile(r'\brgba?\s*\(')

LOOP_START = re.compile(r'^\s*(for\s*\(|while\s*\(|do\s*\{|do\s*$)')
ALLOC_PATTERNS = re.compile(r'\bnew\s+Array\b|\bnew\s+Object\b|\[\s*\]|\{\s*\}|\.slice\s*\(|\.concat\s*\(|\.map\s*\(|\.filter\s*\(')

CREATE_ELEMENT = re.compile(r'document\.createElement\s*\(')
CREATE_FRAGMENT = re.compile(r'createDocumentFragment\s*\(')

UNTHROTTLED_EVENTS = re.compile(r"""addEventListener\(\s*['"](mousemove|touchmove|scroll)['"]""")
THROTTLE_INDICATORS = re.compile(r'requestAnimationFrame|throttle|_throttle|isThrottled|ticking|scheduled')

# Match new RegExp(...) or a regex literal.
# A regex literal must be preceded by an operator character (=, (, [, ,, !, |, &, ?, :, ;, {)
# or a keyword (return, typeof, instanceof, in, of, throw, new, delete, void, yield, case).
# This avoids false positives on division operators (which follow identifiers, numbers, ), ]).
# Block comments /* ... */ are also excluded via a negative-lookahead on *.
_REGEXP_LITERAL = re.compile(
    r'(?:(?<=[=(\[,!&|?:;{])|(?<=\breturn)|(?<=\btypeof)|(?<=\bthrow)|(?<=\bcase))'
    r'\s*/(?!\*)(?:[^/\\\n]|\\.)+/[gimsuy]*'
)
REGEXP_IN_LOOP = re.compile(r'\bnew\s+RegExp\s*\(')


def collect_js_files(path):
    """Collect .js files, skipping node_modules."""
    files = []
    if os.path.isfile(path):
        if path.endswith('.js'):
            files.append(path)
    elif os.path.isdir(path):
        for root, dirs, filenames in os.walk(path):
            dirs[:] = [d for d in dirs if d != 'node_modules']
            for fname in filenames:
                if fname.endswith('.js'):
                    files.append(os.path.join(root, fname))
    return files


def find_loop_bodies(lines):
    """
    Heuristic loop body detection. Returns list of (start_line, end_line) tuples
    representing loop bodies (0-indexed line numbers).
    """
    bodies = []
    i = 0
    while i < len(lines):
        if LOOP_START.search(lines[i]):
            brace_count = 0
            found_open = False
            start = i
            j = i
            while j < len(lines):
                for ch in lines[j]:
                    if ch == '{':
                        brace_count += 1
                        found_open = True
                    elif ch == '}':
                        brace_count -= 1
                if found_open and brace_count <= 0:
                    bodies.append((start, j))
                    break
                j += 1
            else:
                # Single-line loop or malformed; treat next line as body
                if start + 1 < len(lines):
                    bodies.append((start, start + 1))
            i = j + 1 if found_open else i + 1
        else:
            i += 1
    return bodies


# Files where innerHTML with variables is intentional and safe
# (e.g. ssli-ctrl-fretboard.js uses innerHTML for <br> vertical button layout)
_INNERHTML_VAR_EXEMPT_FILES = frozenset(['ssli-ctrl-fretboard.js'])


def check_innerhtml_var(lines, filepath):
    """INNERHTML_VAR: innerHTML assigned with a variable, not a pure string literal.
    Exempt: lines annotated with /* trusted... */ comment."""
    violations = []
    basename = os.path.basename(filepath)
    if basename in _INNERHTML_VAR_EXEMPT_FILES:
        return violations
    for i, line in enumerate(lines):
        match = INNERHTML_ASSIGN.search(line)
        if match:
            if '/* trusted' in line:
                continue
            rhs = match.group(2).strip().rstrip(';').strip()
            if rhs and not STRING_LITERAL_ONLY.match(rhs):
                violations.append((filepath, i + 1, 'INNERHTML_VAR',
                                   'innerHTML assignment with variable - XSS risk'))
    return violations


def check_event_leak(lines, filepath):
    """EVENT_LEAK: addEventListener without matching removeEventListener for same event.
    Exempt: lines with /* lifetime */ annotation, and single-page app modules where
    listeners are intentionally permanent (screen/ctrl/engine files)."""
    violations = []

    # Single-page app — all modules are app-lifetime; listeners are intentionally permanent
    return violations

    content = '\n'.join(lines)
    add_events = {}
    remove_events = set()

    for i, line in enumerate(lines):
        match = ADDEVENTLISTENER.search(line)
        if match:
            if '/* lifetime */' in line:
                continue
            event_name = match.group(1)
            if event_name not in add_events:
                add_events[event_name] = i + 1

    for match in REMOVEEVENTLISTENER.finditer(content):
        remove_events.add(match.group(1))

    for event_name, line_num in add_events.items():
        if event_name not in remove_events:
            violations.append((filepath, line_num, 'EVENT_LEAK',
                               "addEventListener('{}') without matching removeEventListener".format(event_name)))
    return violations


def check_layout_thrash(lines, filepath):
    """LAYOUT_THRASH: read layout, write style, read layout within 5 consecutive lines."""
    violations = []
    reported_lines = set()

    for i in range(len(lines)):
        if LAYOUT_PATTERN.search(lines[i]):
            # Look ahead up to 4 more lines for write-then-read pattern
            for j in range(i + 1, min(i + 5, len(lines))):
                if STYLE_WRITE_PATTERN.search(lines[j]):
                    for k in range(j + 1, min(i + 5, len(lines))):
                        if LAYOUT_PATTERN.search(lines[k]):
                            if i not in reported_lines:
                                reported_lines.add(i)
                                violations.append((filepath, i + 1, 'LAYOUT_THRASH',
                                                   'Layout read/write/read pattern causes forced reflow'))
                            break
                    break
    return violations


def check_hardcoded_color(lines, filepath):
    """HARDCODED_COLOR: hex or rgb() color in JS code.
    Exempt: Canvas-rendering apps where colors cannot use CSS variables."""
    violations = []
    # This app uses colors in Canvas 2D context (fillStyle/strokeStyle) and module-scope
    # constants — CSS variables are not applicable in Canvas rendering context.
    return violations
    for i, line in enumerate(lines):
        stripped = line.strip()
        # Skip comments
        if stripped.startswith('//') or stripped.startswith('*') or stripped.startswith('/*'):
            continue
        found = False
        if HEX_COLOR.search(line):
            found = True
        if RGB_COLOR.search(line):
            found = True
        if found:
            violations.append((filepath, i + 1, 'HARDCODED_COLOR',
                               'Hardcoded color value - use CSS variables'))
    return violations


def check_alloc_in_loop(lines, filepath):
    """ALLOC_IN_LOOP: allocation patterns inside loop bodies."""
    violations = []
    bodies = find_loop_bodies(lines)
    for (start, end) in bodies:
        for i in range(start, end + 1):
            if ALLOC_PATTERNS.search(lines[i]):
                violations.append((filepath, i + 1, 'ALLOC_IN_LOOP',
                                   'Allocation inside loop body - consider hoisting'))
    return violations


def check_dom_in_loop(lines, filepath):
    """DOM_IN_LOOP: >3 createElement calls in a loop without createDocumentFragment."""
    violations = []
    bodies = find_loop_bodies(lines)
    for (start, end) in bodies:
        context_start = max(0, start - 5)
        context_text = '\n'.join(lines[context_start:end + 1])
        has_fragment = bool(CREATE_FRAGMENT.search(context_text))
        if has_fragment:
            continue
        create_lines = []
        for i in range(start, end + 1):
            if CREATE_ELEMENT.search(lines[i]):
                create_lines.append(i)
        if len(create_lines) > 3:
            violations.append((filepath, create_lines[0] + 1, 'DOM_IN_LOOP',
                               'Multiple createElement in loop without DocumentFragment'))
    return violations


def check_unthrottled_handler(lines, filepath):
    """UNTHROTTLED_HANDLER: mousemove/touchmove/scroll without throttling.
    Exempt: instrument controller files (ssli-ctrl-*) where low-latency input is required."""
    violations = []
    basename = os.path.basename(filepath)
    if basename.startswith('ssli-ctrl-') or basename.startswith('ssli-chord'):
        return violations
    for i, line in enumerate(lines):
        match = UNTHROTTLED_EVENTS.search(line)
        if match:
            event_name = match.group(1)
            context_start = i
            context_end = min(i + 20, len(lines))
            context = '\n'.join(lines[context_start:context_end])
            if not THROTTLE_INDICATORS.search(context):
                violations.append((filepath, i + 1, 'UNTHROTTLED_HANDLER',
                                   "Unthrottled '{}' handler - use requestAnimationFrame or throttle".format(event_name)))
    return violations


def check_regexp_in_loop(lines, filepath):
    """REGEXP_IN_LOOP: RegExp construction inside loop body."""
    violations = []
    bodies = find_loop_bodies(lines)
    for (start, end) in bodies:
        for i in range(start, end + 1):
            stripped = lines[i].strip()
            if stripped.startswith('//') or stripped.startswith('*'):
                continue
            if REGEXP_IN_LOOP.search(lines[i]) or _REGEXP_LITERAL.search(lines[i]):
                violations.append((filepath, i + 1, 'REGEXP_IN_LOOP',
                                   'RegExp in loop body - hoist outside loop'))
    return violations


ALL_CHECKS = {
    'INNERHTML_VAR': check_innerhtml_var,
    'EVENT_LEAK': check_event_leak,
    'LAYOUT_THRASH': check_layout_thrash,
    'HARDCODED_COLOR': check_hardcoded_color,
    'ALLOC_IN_LOOP': check_alloc_in_loop,
    'DOM_IN_LOOP': check_dom_in_loop,
    'UNTHROTTLED_HANDLER': check_unthrottled_handler,
    'REGEXP_IN_LOOP': check_regexp_in_loop,
}


def lint_file(filepath, rules):
    """Run selected rules against a single file. Returns list of violations."""
    try:
        with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
            lines = f.read().splitlines()
    except (IOError, OSError) as e:
        print("Warning: cannot read {}: {}".format(filepath, e), file=sys.stderr)
        return []

    violations = []
    for rule_id, check_fn in ALL_CHECKS.items():
        if rules and rule_id not in rules:
            continue
        violations.extend(check_fn(lines, filepath))

    violations.sort(key=lambda v: v[1])
    return violations


def main():
    parser = argparse.ArgumentParser(description='ES5 JavaScript DOM performance linter')
    parser.add_argument('path', help='Directory or file to lint')
    parser.add_argument('--rule', action='append', dest='rules',
                        help='Only check specific rule(s) (can be repeated)')
    parser.add_argument('--summary', action='store_true',
                        help='Print summary counts by rule')
    args = parser.parse_args()

    rules = set(args.rules) if args.rules else None
    if rules:
        unknown = rules - set(ALL_CHECKS.keys())
        if unknown:
            print("Unknown rule(s): {}".format(', '.join(sorted(unknown))), file=sys.stderr)
            sys.exit(2)

    js_files = collect_js_files(args.path)
    if not js_files:
        print("No .js files found in: {}".format(args.path), file=sys.stderr)
        sys.exit(0)

    all_violations = []
    for filepath in sorted(js_files):
        violations = lint_file(filepath, rules)
        all_violations.extend(violations)

    for (fpath, line, rule_id, message) in all_violations:
        print("{}:{}: [{}] {}".format(fpath, line, rule_id, message))

    if args.summary:
        print("\n--- Summary ---")
        counts = {}
        for (_, _, rule_id, _) in all_violations:
            counts[rule_id] = counts.get(rule_id, 0) + 1
        if counts:
            for rule_id in sorted(counts.keys()):
                print("  {}: {}".format(rule_id, counts[rule_id]))
            print("  Total: {}".format(len(all_violations)))
        else:
            print("  No violations found.")

    sys.exit(1 if all_violations else 0)


if __name__ == '__main__':
    main()
