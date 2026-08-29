"""
lint_i18n_es5.py - ES5/i18n linter for JavaScript files.

Scans .js files and reports violations of ES5 and localization rules.

Usage:
    python lint_i18n_es5.py <directory_or_file> [--rule RULE_ID] [--summary]

Exit code 0 if clean, 1 if violations found.
"""

import sys
import os
import re
import argparse


def is_comment_line(line):
    """Return True if the line is a single-line comment (// or leading *)."""
    stripped = line.strip()
    if stripped.startswith("//"):
        return True
    # Lines inside block comments typically start with *
    if stripped.startswith("*") or stripped.startswith("/*"):
        return True
    return False


def is_in_block_comment(line, in_block):
    """Track block comment state. Returns (skip_this_line, new_in_block)."""
    stripped = line.strip()
    if in_block:
        if "*/" in line:
            return (True, False)
        return (True, True)
    if stripped.startswith("/*"):
        if "*/" in stripped[2:]:
            return (True, False)
        return (True, True)
    return (False, False)


def check_hardcoded_string(line, line_num, filepath):
    """HARDCODED_STRING: user-visible strings not going through L() or SL.t()."""
    violations = []

    # Patterns for user-visible string assignments
    patterns = [
        r'\.\s*textContent\s*=\s*["\'](.+?)["\']',
        r'\.\s*innerText\s*=\s*["\'](.+?)["\']',
        r'\.\s*title\s*=\s*["\'](.+?)["\']',
        r'\.\s*placeholder\s*=\s*["\'](.+?)["\']',
        r'\.\s*ariaLabel\s*=\s*["\'](.+?)["\']',
        r'\.setAttribute\s*\(\s*["\']aria-label["\']\s*,\s*["\'](.+?)["\']',
    ]

    for pattern in patterns:
        matches = re.finditer(pattern, line)
        for match in matches:
            value = match.group(1)

            # Exempt: single characters
            if len(value) <= 1:
                continue
            # Exempt: empty strings
            if value.strip() == "":
                continue
            # Exempt: numbers-as-strings
            if re.match(r'^[\d.,\s%]+$', value):
                continue
            # Exempt: CSS values (colors, units, etc.)
            if re.match(r'^(#[0-9a-fA-F]+|[\d.]+(px|em|rem|%|vh|vw|ms|s)|rgba?\(|hsla?\(|none|inherit|auto|block|flex|grid|inline|hidden|visible|absolute|relative|fixed)', value):
                continue
            # Exempt: technical identifiers (no spaces, looks like a class/id/key)
            if re.match(r'^[a-zA-Z0-9_\-.:]+$', value) and ' ' not in value:
                continue

            # Check if the line uses L() or SL.t() for this assignment
            # Look for L( or SL.t( on the right side of the assignment
            assignment_area = line[match.start():]
            if 'L(' in assignment_area or 'SL.t(' in assignment_area:
                continue

            violations.append(
                (filepath, line_num, "HARDCODED_STRING",
                 "User-visible string \"%s\" not using L() or SL.t()" % value)
            )

    return violations


def check_es6_arrow(line, line_num, filepath):
    """ES6_ARROW: Arrow function syntax => used anywhere."""
    # Match => but not >= or <=  or ==> in comments
    if re.search(r'(?<!=)=>(?!=)', line):
        return [(filepath, line_num, "ES6_ARROW", "Arrow function syntax '=>' detected")]
    return []


def check_es6_template(line, line_num, filepath):
    """ES6_TEMPLATE: Template literal backtick strings."""
    # Match backtick that isn't inside a string
    if '`' in line:
        return [(filepath, line_num, "ES6_TEMPLATE", "Template literal (backtick string) detected")]
    return []


def check_es6_let_const(line, line_num, filepath):
    """ES6_LET_CONST: let or const declarations."""
    code_part = line[:line.find('//')] if '//' in line else line
    if re.search(r'\b(let|const)\s+', code_part):
        keyword = "let" if re.search(r'\blet\s+', code_part) else "const"
        return [(filepath, line_num, "ES6_LET_CONST", "'%s' declaration detected; use 'var'" % keyword)]
    return []


def check_es6_destructure(line, line_num, filepath):
    """ES6_DESTRUCTURE: Destructuring patterns."""
    if re.search(r'\bvar\s*\{', line) or re.search(r'\bvar\s*\[', line):
        return [(filepath, line_num, "ES6_DESTRUCTURE", "Destructuring assignment detected")]
    if re.search(r'function\s*\w*\s*\(\s*\{', line) or re.search(r'function\s*\w*\s*\(\s*\[', line):
        return [(filepath, line_num, "ES6_DESTRUCTURE", "Destructuring in function parameters detected")]
    return []


def check_es6_spread(line, line_num, filepath):
    """ES6_SPREAD: Spread operator ... in function calls or array literals."""
    # Match ... followed by a word character, inside parens or brackets
    if re.search(r'\.\.\.[\w]', line):
        return [(filepath, line_num, "ES6_SPREAD", "Spread operator '...' detected")]
    return []


def check_es6_class(line, line_num, filepath):
    """ES6_CLASS: class keyword for class declarations.
    Exempt: worklet processors and effects extending BaseEffect."""
    basename = os.path.basename(filepath).lower()
    if 'worklet' in basename:
        return []
    if re.search(r'\bclass\s+(BaseEffect|EffectChain)\b', line):
        return []
    if re.search(r'\bclass\s+\w+\s+extends\s+(SL\.effects\.)?BaseEffect\b', line):
        return []
    if re.search(r'\bclass\s+\w+\s+extends\s+AudioWorkletProcessor\b', line):
        return []
    if re.search(r'\bclass\s+\w+', line):
        return [(filepath, line_num, "ES6_CLASS", "'class' keyword detected")]
    return []


def check_async_await(line, line_num, filepath):
    """ASYNC_AWAIT: async/await in non-worklet files.
    Exempt: worklet files and effect files (need async for AudioWorklet loading)."""
    basename = os.path.basename(filepath).lower()
    if 'worklet' in basename:
        return []
    if os.sep + 'effects' + os.sep in filepath or '/effects/' in filepath:
        return []
    if 'audio-engine' in basename:
        return []
    violations = []
    if re.search(r'\basync\s+function\b', line):
        violations.append((filepath, line_num, "ASYNC_AWAIT", "'async function' detected in non-worklet file"))
    if re.search(r'\bawait\s+', line):
        violations.append((filepath, line_num, "ASYNC_AWAIT", "'await' detected in non-worklet file"))
    return violations


def check_console_log(line, line_num, filepath):
    """CONSOLE_LOG: console.log or console.debug left in code."""
    violations = []
    if re.search(r'\bconsole\.log\s*\(', line):
        violations.append((filepath, line_num, "CONSOLE_LOG", "console.log() detected"))
    if re.search(r'\bconsole\.debug\s*\(', line):
        violations.append((filepath, line_num, "CONSOLE_LOG", "console.debug() detected"))
    return violations


ALL_CHECKS = [
    check_hardcoded_string,
    check_es6_arrow,
    check_es6_template,
    check_es6_let_const,
    check_es6_destructure,
    check_es6_spread,
    check_es6_class,
    check_async_await,
    check_console_log,
]

RULE_TO_CHECK = {
    "HARDCODED_STRING": check_hardcoded_string,
    "ES6_ARROW": check_es6_arrow,
    "ES6_TEMPLATE": check_es6_template,
    "ES6_LET_CONST": check_es6_let_const,
    "ES6_DESTRUCTURE": check_es6_destructure,
    "ES6_SPREAD": check_es6_spread,
    "ES6_CLASS": check_es6_class,
    "ASYNC_AWAIT": check_async_await,
    "CONSOLE_LOG": check_console_log,
}


def lint_file(filepath, checks):
    """Lint a single .js file with the given checks. Returns list of violations."""
    violations = []
    try:
        with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
            lines = f.readlines()
    except (IOError, OSError):
        return []

    in_block = False
    for i, line in enumerate(lines, start=1):
        skip, in_block = is_in_block_comment(line, in_block)
        if skip:
            continue
        if is_comment_line(line):
            continue

        for check in checks:
            violations.extend(check(line, i, filepath))

    return violations


def collect_js_files(path):
    """Collect all .js files under path, skipping node_modules."""
    if os.path.isfile(path):
        if path.endswith('.js'):
            return [path]
        return []

    js_files = []
    for root, dirs, files in os.walk(path):
        # Skip node_modules
        if 'node_modules' in dirs:
            dirs.remove('node_modules')
        for fname in sorted(files):
            if fname.endswith('.js'):
                js_files.append(os.path.join(root, fname))
    return js_files


def main():
    parser = argparse.ArgumentParser(description="ES5/i18n linter for JavaScript files")
    parser.add_argument("path", help="Directory or file to lint")
    parser.add_argument("--rule", dest="rule", default=None,
                        help="Only check this specific rule ID")
    parser.add_argument("--summary", action="store_true",
                        help="Print summary of violations by rule")
    args = parser.parse_args()

    if args.rule:
        rule_upper = args.rule.upper()
        if rule_upper not in RULE_TO_CHECK:
            print("Unknown rule: %s" % args.rule, file=sys.stderr)
            print("Available rules: %s" % ", ".join(sorted(RULE_TO_CHECK.keys())), file=sys.stderr)
            sys.exit(2)
        checks = [RULE_TO_CHECK[rule_upper]]
    else:
        checks = ALL_CHECKS

    js_files = collect_js_files(args.path)
    if not js_files:
        print("No .js files found at: %s" % args.path, file=sys.stderr)
        sys.exit(0)

    all_violations = []
    for filepath in js_files:
        all_violations.extend(lint_file(filepath, checks))

    if args.summary:
        counts = {}
        for (fp, ln, rule, msg) in all_violations:
            counts[rule] = counts.get(rule, 0) + 1
        if counts:
            print("--- Summary ---")
            for rule in sorted(counts.keys()):
                print("  %s: %d violation(s)" % (rule, counts[rule]))
            print("  Total: %d violation(s) in %d file(s)" % (len(all_violations), len(js_files)))
        else:
            print("Clean: 0 violations in %d file(s)" % len(js_files))
    else:
        for (fp, ln, rule, msg) in all_violations:
            print("%s:%d: [%s] %s" % (fp, ln, rule, msg))

    if all_violations:
        sys.exit(1)
    else:
        sys.exit(0)


if __name__ == "__main__":
    main()
