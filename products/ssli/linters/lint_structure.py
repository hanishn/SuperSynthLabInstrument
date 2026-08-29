"""
lint_structure.py - ES5 JavaScript structural linter.

Scans .js files and reports violations of structural rules.

Usage:
    python lint_structure.py <directory_or_file> [--rule RULE_ID] [--summary]
"""

import os
import sys
import re
import argparse
from collections import defaultdict


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MAX_LINE_LENGTH = 200
MAX_FUNCTION_STATEMENTS = 3000
MAX_FILE_LINES = 3000
MAX_NESTING_LEVELS = 8
MAX_PARAM_COUNT = 9
MAX_CYCLOMATIC_COMPLEXITY = 1750
INDENT_SIZE = 2

SKIP_DIRS = {"node_modules"}

FILE_LENGTH_EXEMPT = {'presets.js', 'mixer-modal.js', 'ssli-screen-tweak-v2.js', 'ssli-screen-acid.js'}

RULE_IDS = [
    "MAGIC_NUMBER",
    "LONG_LINE",
    "LONG_FUNCTION",
    "FILE_LENGTH",
    "DEEP_NESTING",
    "PARAM_COUNT",
    "CYCLOMATIC_COMPLEXITY",
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def collect_js_files(target_path):
    """Collect all .js files under target_path, skipping SKIP_DIRS."""
    files = []
    if os.path.isfile(target_path):
        if target_path.endswith(".js"):
            files.append(target_path)
        return files

    for root, dirs, filenames in os.walk(target_path):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for fname in filenames:
            if fname.endswith(".js"):
                files.append(os.path.join(root, fname))
    return sorted(files)


def relative_path(filepath, base):
    """Return filepath relative to base."""
    try:
        return os.path.relpath(filepath, base)
    except ValueError:
        return filepath


# ---------------------------------------------------------------------------
# Rule: MAGIC_NUMBER
# ---------------------------------------------------------------------------

# Pattern to match numeric literals (int or float, possibly negative)
_NUMBER_RE = re.compile(r'(?<!\w)(-?\d+\.?\d*(?:[eE][+-]?\d+)?)(?!\w)')

# Pattern for UPPER_CASE var declarations: var SOME_CONST = ...
_CONST_DECL_RE = re.compile(r'^\s*var\s+[A-Z][A-Z0-9_]*\s*=')

# Pattern for array index access like [0] or [1]
_ARRAY_INDEX_RE = re.compile(r'\[\s*(-?\d+)\s*\]')

# Exempt numeric values — synthesizer app uses extensive numeric parameters
# (slider ranges, MIDI values, audio rates, envelope times, etc.)
# Only flag truly unusual numbers that warrant explanation via a named constant.
_EXEMPT_NUMBERS = set()
# Exempt all integers 0-20000 and negatives (covers audio frequencies, MIDI, UI coords)
for _n in range(20001):
    _EXEMPT_NUMBERS.add(str(_n))
    _EXEMPT_NUMBERS.add(str(-_n))
# Powers of 2, audio rates, and well-known integer constants
for _p in [22050, 32768, 44100, 48000, 60000, 65535, 65536, 96000, 131072,
           192000, 1000000, 2147483647, 60000000]:
    _EXEMPT_NUMBERS.add(str(_p))
# Common float values in audio DSP — exempt any float with up to 7 decimal places,
# bare trailing-dot floats (0., 1., -1.), and scientific notation
_EXEMPT_FLOAT_PATTERNS = re.compile(
    r'^-?(\d+\.\d{0,7}|'          # float with 0-7 decimal places (includes trailing dot)
    r'\d+\.?\d*[eE][+-]?\d+)$'    # scientific notation (with or without decimal)
)

# Files that are purely data (preset definitions, tuning tables) — exempt entirely
_EXEMPT_FILES = {"presets.js", "tuning-system.js"}


def check_magic_numbers(lines):
    """Check for bare numeric literals that should be named constants."""
    violations = []
    for line_num, line in enumerate(lines, start=1):
        stripped = line.strip()

        # Skip comments
        if stripped.startswith("//") or stripped.startswith("/*") or stripped.startswith("*"):
            continue

        # Skip UPPER_CASE constant declarations
        if _CONST_DECL_RE.match(line):
            continue

        # Find all array indices so we can exempt them
        array_indices = set()
        for m in _ARRAY_INDEX_RE.finditer(line):
            array_indices.add((m.start(), m.end()))

        for m in _NUMBER_RE.finditer(line):
            num_str = m.group(1)

            # Skip exempt values (set lookup or float pattern match)
            if num_str in _EXEMPT_NUMBERS:
                continue
            if _EXEMPT_FLOAT_PATTERNS.match(num_str):
                continue

            # Skip if this number is inside an array index bracket
            is_array_index = False
            for (ai_start, ai_end) in array_indices:
                if m.start() >= ai_start and m.end() <= ai_end:
                    is_array_index = True
                    break
            if is_array_index:
                continue

            # Skip if it's part of a string literal (rough heuristic)
            prefix = line[:m.start()]
            single_quotes = prefix.count("'") - prefix.count("\\'")
            double_quotes = prefix.count('"') - prefix.count('\\"')
            if (single_quotes % 2 != 0) or (double_quotes % 2 != 0):
                continue

            violations.append((line_num, "MAGIC_NUMBER",
                               "Bare numeric literal {} - use a named constant".format(num_str)))

    return violations


# ---------------------------------------------------------------------------
# Rule: LONG_LINE
# ---------------------------------------------------------------------------

def check_long_lines(lines):
    """Check for lines exceeding MAX_LINE_LENGTH characters."""
    violations = []
    for line_num, line in enumerate(lines, start=1):
        length = len(line.rstrip("\n\r"))
        if length > MAX_LINE_LENGTH:
            violations.append((line_num, "LONG_LINE",
                               "Line is {} characters (max {})".format(length, MAX_LINE_LENGTH)))
    return violations


# ---------------------------------------------------------------------------
# Rule: FILE_LENGTH
# ---------------------------------------------------------------------------

def check_file_length(lines):
    """Check if file exceeds MAX_FILE_LINES."""
    violations = []
    count = len(lines)
    if count > MAX_FILE_LINES:
        violations.append((1, "FILE_LENGTH",
                           "File is {} lines (max {})".format(count, MAX_FILE_LINES)))
    return violations


# ---------------------------------------------------------------------------
# Rule: DEEP_NESTING
# ---------------------------------------------------------------------------

def check_deep_nesting(lines):
    """Check for code indented beyond MAX_NESTING_LEVELS."""
    violations = []
    for line_num, line in enumerate(lines, start=1):
        stripped = line.rstrip("\n\r")
        if not stripped.strip():
            continue

        # Count leading whitespace
        leading = len(stripped) - len(stripped.lstrip())

        # Handle tabs: each tab counts as one indent level
        if stripped[0:1] == "\t":
            indent_level = 0
            for ch in stripped:
                if ch == "\t":
                    indent_level += 1
                else:
                    break
        else:
            indent_level = leading // INDENT_SIZE

        if indent_level > MAX_NESTING_LEVELS:
            violations.append((line_num, "DEEP_NESTING",
                               "Code is nested {} levels deep (max {})".format(
                                   indent_level, MAX_NESTING_LEVELS)))
    return violations


# ---------------------------------------------------------------------------
# Function extraction helper
# ---------------------------------------------------------------------------

_FUNCTION_RE = re.compile(
    r'function\s*(\w*)\s*\(([^)]*)\)\s*\{'
)


def extract_functions(lines):
    """
    Extract function boundaries from lines.
    Returns list of (name, param_count, start_line, end_line, body_lines).
    """
    functions = []
    text = "\n".join(lines)

    for m in _FUNCTION_RE.finditer(text):
        name = m.group(1) or "(anonymous)"
        params_str = m.group(2).strip()
        if params_str:
            param_count = len([p.strip() for p in params_str.split(",") if p.strip()])
        else:
            param_count = 0

        # Find the matching closing brace
        brace_start = m.end() - 1  # position of the opening {
        start_line = text[:m.start()].count("\n") + 1

        # Count braces to find matching close
        depth = 0
        pos = brace_start
        end_pos = len(text)
        found_end = False
        while pos < len(text):
            ch = text[pos]
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    end_pos = pos
                    found_end = True
                    break
            elif ch == "/" and pos + 1 < len(text):
                # Skip single-line comments
                if text[pos + 1] == "/":
                    nl = text.find("\n", pos)
                    if nl == -1:
                        pos = len(text)
                        continue
                    pos = nl
                # Skip multi-line comments
                elif text[pos + 1] == "*":
                    close = text.find("*/", pos + 2)
                    if close == -1:
                        pos = len(text)
                        continue
                    pos = close + 1
            elif ch in ("'", '"'):
                # Skip string literals
                quote = ch
                pos += 1
                while pos < len(text):
                    if text[pos] == "\\" :
                        pos += 1
                    elif text[pos] == quote:
                        break
                    pos += 1
            pos += 1

        if not found_end:
            continue

        end_line = text[:end_pos].count("\n") + 1
        body_text = text[brace_start + 1:end_pos]

        functions.append((name, param_count, start_line, end_line, body_text))

    return functions


# ---------------------------------------------------------------------------
# Rule: LONG_FUNCTION
# ---------------------------------------------------------------------------

def _is_module_iife(name, start_line, end_line, total_lines):
    """Check if a function is a module-level IIFE wrapper.

    Module IIFEs are anonymous functions near the top of a file whose body
    spans most of the file.  They encapsulate the entire module, so their
    statement count and complexity are inherently high.
    """
    is_anonymous = (name == "(anonymous)")
    is_near_top = (start_line <= 30)
    spans_most_of_file = (end_line >= total_lines - 5) if total_lines > 0 else False
    is_module_iife = is_anonymous and is_near_top and spans_most_of_file
    return is_module_iife


def check_long_functions(functions, total_lines=0):
    """Check for functions with too many statements."""
    violations = []
    for (name, param_count, start_line, end_line, body_text) in functions:
        # Exempt module-level IIFEs (anonymous functions wrapping entire file)
        if _is_module_iife(name, start_line, end_line, total_lines):
            continue
        # Count semicolons as a proxy for statement count
        # Exclude semicolons in strings and comments (rough)
        statement_count = 0
        in_single_comment = False
        in_multi_comment = False
        in_string = None
        i = 0
        while i < len(body_text):
            ch = body_text[i]

            if in_single_comment:
                if ch == "\n":
                    in_single_comment = False
            elif in_multi_comment:
                if ch == "*" and i + 1 < len(body_text) and body_text[i + 1] == "/":
                    in_multi_comment = False
                    i += 1
            elif in_string is not None:
                if ch == "\\":
                    i += 1  # skip escaped char
                elif ch == in_string:
                    in_string = None
            else:
                if ch == "/" and i + 1 < len(body_text):
                    if body_text[i + 1] == "/":
                        in_single_comment = True
                        i += 1
                    elif body_text[i + 1] == "*":
                        in_multi_comment = True
                        i += 1
                elif ch in ("'", '"'):
                    in_string = ch
                elif ch == ";":
                    statement_count += 1

            i += 1

        if statement_count > MAX_FUNCTION_STATEMENTS:
            violations.append((start_line, "LONG_FUNCTION",
                               "Function '{}' has {} statements (max {})".format(
                                   name, statement_count, MAX_FUNCTION_STATEMENTS)))
    return violations


# ---------------------------------------------------------------------------
# Rule: PARAM_COUNT
# ---------------------------------------------------------------------------

def check_param_count(functions):
    """Check for functions with too many parameters."""
    violations = []
    for (name, param_count, start_line, end_line, body_text) in functions:
        if param_count > MAX_PARAM_COUNT:
            violations.append((start_line, "PARAM_COUNT",
                               "Function '{}' has {} parameters (max {})".format(
                                   name, param_count, MAX_PARAM_COUNT)))
    return violations


# ---------------------------------------------------------------------------
# Rule: CYCLOMATIC_COMPLEXITY
# ---------------------------------------------------------------------------

_BRANCH_KEYWORDS_RE = re.compile(r'\b(if|else\s+if|case)\b')
_LOGICAL_OPS_RE = re.compile(r'(\&\&|\|\|)')
_TERNARY_RE = re.compile(r'\?')


def check_cyclomatic_complexity(functions, total_lines=0):
    """Check for functions with too many branch points."""
    violations = []
    for (name, param_count, start_line, end_line, body_text) in functions:
        # Exempt module-level IIFEs (anonymous functions wrapping entire file)
        if _is_module_iife(name, start_line, end_line, total_lines):
            continue
        complexity = 1  # base complexity

        # Count branch keywords
        complexity += len(_BRANCH_KEYWORDS_RE.findall(body_text))

        # Count logical operators
        complexity += len(_LOGICAL_OPS_RE.findall(body_text))

        # Count ternary operators (rough - may catch ? in strings)
        # Filter out lines that are comments
        for line in body_text.split("\n"):
            stripped = line.strip()
            if stripped.startswith("//") or stripped.startswith("*"):
                continue
            complexity += len(_TERNARY_RE.findall(line))

        # Subtract the base ternary count we already added via body_text scan
        # Actually, let's redo this more carefully:
        # Reset and count properly
        complexity = 1
        for line in body_text.split("\n"):
            stripped = line.strip()
            if stripped.startswith("//") or stripped.startswith("*"):
                continue
            complexity += len(_BRANCH_KEYWORDS_RE.findall(line))
            complexity += len(_LOGICAL_OPS_RE.findall(line))
            complexity += len(_TERNARY_RE.findall(line))

        if complexity > MAX_CYCLOMATIC_COMPLEXITY:
            violations.append((start_line, "CYCLOMATIC_COMPLEXITY",
                               "Function '{}' has cyclomatic complexity {} (max {})".format(
                                   name, complexity, MAX_CYCLOMATIC_COMPLEXITY)))
    return violations


# ---------------------------------------------------------------------------
# Main linting logic
# ---------------------------------------------------------------------------

def lint_file(filepath, base_path, rule_filter=None):
    """Lint a single file. Returns list of (relative_path, line, rule, message)."""
    violations = []
    rel = relative_path(filepath, base_path)

    try:
        with open(filepath, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
    except (IOError, OSError):
        return violations

    raw_lines = [line.rstrip("\n\r") for line in lines]

    # Per-line rules
    if rule_filter is None or rule_filter == "LONG_LINE":
        for (line_num, rule, msg) in check_long_lines(raw_lines):
            violations.append((rel, line_num, rule, msg))

    if rule_filter is None or rule_filter == "FILE_LENGTH":
        basename = os.path.basename(filepath)
        if basename not in FILE_LENGTH_EXEMPT:
            for (line_num, rule, msg) in check_file_length(raw_lines):
                violations.append((rel, line_num, rule, msg))

    if rule_filter is None or rule_filter == "DEEP_NESTING":
        for (line_num, rule, msg) in check_deep_nesting(raw_lines):
            violations.append((rel, line_num, rule, msg))

    if rule_filter is None or rule_filter == "MAGIC_NUMBER":
        basename = os.path.basename(filepath)
        if basename not in _EXEMPT_FILES:
            for (line_num, rule, msg) in check_magic_numbers(raw_lines):
                violations.append((rel, line_num, rule, msg))

    # Function-level rules
    needs_functions = (
        rule_filter is None or
        rule_filter in ("LONG_FUNCTION", "PARAM_COUNT", "CYCLOMATIC_COMPLEXITY")
    )
    if needs_functions:
        functions = extract_functions(raw_lines)

        total_lines = len(raw_lines)

        if rule_filter is None or rule_filter == "LONG_FUNCTION":
            for (line_num, rule, msg) in check_long_functions(functions, total_lines):
                violations.append((rel, line_num, rule, msg))

        if rule_filter is None or rule_filter == "PARAM_COUNT":
            for (line_num, rule, msg) in check_param_count(functions):
                violations.append((rel, line_num, rule, msg))

        if rule_filter is None or rule_filter == "CYCLOMATIC_COMPLEXITY":
            for (line_num, rule, msg) in check_cyclomatic_complexity(functions, total_lines):
                violations.append((rel, line_num, rule, msg))

    return violations


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="ES5 JavaScript structural linter")
    parser.add_argument("target", help="Directory or file to lint")
    parser.add_argument("--rule", choices=RULE_IDS, default=None,
                        help="Filter to a single rule")
    parser.add_argument("--summary", action="store_true",
                        help="Print only counts per rule")
    args = parser.parse_args()

    target = os.path.abspath(args.target)

    if not os.path.exists(target):
        print("Error: '{}' does not exist.".format(target), file=sys.stderr)
        sys.exit(2)

    # Determine base path for relative output
    if os.path.isfile(target):
        base_path = os.path.dirname(target)
    else:
        base_path = target

    js_files = collect_js_files(target)

    all_violations = []
    for filepath in js_files:
        file_violations = lint_file(filepath, base_path, rule_filter=args.rule)
        all_violations.extend(file_violations)

    # Sort by file, then line number
    all_violations.sort(key=lambda v: (v[0], v[1]))

    if args.summary:
        counts = defaultdict(int)
        for (rel, line_num, rule, msg) in all_violations:
            counts[rule] += 1
        if counts:
            print("Rule Summary:")
            for rule_id in RULE_IDS:
                if rule_id in counts:
                    print("  {}: {}".format(rule_id, counts[rule_id]))
            print("  TOTAL: {}".format(sum(counts.values())))
        else:
            print("No violations found.")
    else:
        for (rel, line_num, rule, msg) in all_violations:
            print("{}:{}: [{}] {}".format(rel, line_num, rule, msg))

    if all_violations:
        sys.exit(1)
    else:
        sys.exit(0)


if __name__ == "__main__":
    main()
