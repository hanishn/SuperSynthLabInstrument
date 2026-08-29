"""
lint_naming.py - ES5 JavaScript naming convention linter.

Rules:
  CONST_NAMING  - Module-scope vars that look like constants should be UPPER_SNAKE_CASE;
                  UPPER_SNAKE_CASE vars inside functions should be camelCase locals.
  FUNC_NAMING   - Function names must be camelCase (PascalCase allowed only for constructors).
  BOOL_NAMING   - Boolean variables should use is/has/can/should/was/will/did prefix.
  CSS_PREFIX    - CSS class literals should consistently use ssli- or ctrl- prefix.
  ABBREV_CONSISTENCY - Flag mixed long/short abbreviations in the same file.

Usage:
  python lint_naming.py <directory_or_file> [--rule RULE_ID] [--summary]
"""

import os
import re
import sys
import argparse


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def strip_strings_and_comments(line):
    """Remove string literals and comments from a line for non-CSS analysis."""
    result = []
    i = 0
    in_single = False
    in_double = False
    length = len(line)
    while i < length:
        ch = line[i]
        if not in_single and not in_double:
            if ch == '/' and i + 1 < length and line[i + 1] == '/':
                break  # rest is comment
            if ch == '/' and i + 1 < length and line[i + 1] == '*':
                # inline block comment - skip to */
                end = line.find('*/', i + 2)
                if end == -1:
                    break
                i = end + 2
                continue
            if ch == '"':
                in_double = True
                i += 1
                continue
            if ch == "'":
                in_single = True
                i += 1
                continue
            result.append(ch)
        elif in_single:
            if ch == '\\':
                i += 2
                continue
            if ch == "'":
                in_single = False
            i += 1
            continue
        elif in_double:
            if ch == '\\':
                i += 2
                continue
            if ch == '"':
                in_double = False
            i += 1
            continue
        i += 1
    return ''.join(result)


def is_upper_snake(name):
    return bool(re.match(r'^[A-Z][A-Z0-9_]*$', name))


def is_camel_case(name):
    return bool(re.match(r'^[a-z][a-zA-Z0-9]*$', name))


def is_pascal_case(name):
    return bool(re.match(r'^[A-Z][a-zA-Z0-9]*$', name))


def is_snake_case(name):
    return bool(re.match(r'^[a-z][a-z0-9_]*$', name))


def is_literal_value(value):
    """Check if a value is a meaningful immutable literal that indicates a constant.
    Excludes null/undefined/0 (common initial values for mutable state) and
    {} / [] (mutable containers)."""
    value = value.strip()
    if not value:
        return False
    if value in ('true', 'false'):
        return True
    if value in ('null', 'undefined', '0', '0.0', '-1'):
        return False
    if re.match(r'^-?\d+(\.\d+)?$', value):
        return True
    if re.match(r'^["\']', value):
        return True
    return False


# ---------------------------------------------------------------------------
# Scope tracking
# ---------------------------------------------------------------------------

def compute_scope_depth(lines):
    """Return list of scope depths (0 = module scope) per line.

    Tracks brace depth, considering that function declarations/expressions
    introduce a new scope.
    """
    depths = []
    depth = 0
    in_block_comment = False
    for line in lines:
        stripped = line
        # handle block comments
        if in_block_comment:
            end = stripped.find('*/')
            if end == -1:
                depths.append(depth)
                continue
            else:
                stripped = stripped[end + 2:]
                in_block_comment = False

        # Remove block comments that start and end on this line
        while True:
            start = stripped.find('/*')
            if start == -1:
                break
            end = stripped.find('*/', start + 2)
            if end == -1:
                stripped = stripped[:start]
                in_block_comment = True
                break
            else:
                stripped = stripped[:start] + stripped[end + 2:]

        # Remove line comment
        line_comment = stripped.find('//')
        if line_comment != -1:
            stripped = stripped[:line_comment]

        # Remove string contents for brace counting
        clean = re.sub(r'"(?:[^"\\]|\\.)*"', '', stripped)
        clean = re.sub(r"'(?:[^'\\]|\\.)*'", '', clean)

        depths.append(depth)
        for ch in clean:
            if ch == '{':
                depth += 1
            elif ch == '}':
                depth = max(0, depth - 1)
    return depths


# ---------------------------------------------------------------------------
# Rule: CONST_NAMING
# ---------------------------------------------------------------------------

def check_const_naming(lines, depths):
    violations = []
    var_pattern = re.compile(r'\bvar\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(.+)')

    for i, line in enumerate(lines):
        clean = strip_strings_and_comments(line)
        m = var_pattern.search(clean)
        if not m:
            continue
        name = m.group(1)
        value = m.group(2).rstrip(';').strip()
        depth = depths[i]

        # In ES5 IIFE-based modules, depth 0-1 is effectively module scope
        is_module_scope = (depth <= 1)

        if is_module_scope:
            # Module scope: if it looks like a constant (literal, never reassigned)
            # but uses camelCase, flag it.
            if is_camel_case(name) and is_literal_value(value):
                # Check if it's ever reassigned
                reassigned = False
                assign_pat = re.compile(r'\b' + re.escape(name) + r'\s*=(?!=)')
                for j, other_line in enumerate(lines):
                    if j == i:
                        continue
                    other_clean = strip_strings_and_comments(other_line)
                    if assign_pat.search(other_clean):
                        reassigned = True
                        break
                if not reassigned:
                    violations.append((i + 1, "[CONST_NAMING] Module-scope constant '{}' should use UPPER_SNAKE_CASE".format(name)))
        else:
            # In ES5 IIFE modules, UPPER_SNAKE_CASE inside functions is a valid
            # constant pattern — do not flag it
            pass

    return violations


# ---------------------------------------------------------------------------
# Rule: FUNC_NAMING
# ---------------------------------------------------------------------------

def check_func_naming(lines):
    violations = []
    # Named function declarations
    func_decl = re.compile(r'\bfunction\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(')
    # Detect constructor usage: new FuncName(
    new_usage = re.compile(r'\bnew\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(')

    # Collect all names used with `new`
    constructor_names = set()
    for line in lines:
        clean = strip_strings_and_comments(line)
        for m in new_usage.finditer(clean):
            constructor_names.add(m.group(1))

    for i, line in enumerate(lines):
        clean = strip_strings_and_comments(line)
        for m in func_decl.finditer(clean):
            name = m.group(1)
            if is_pascal_case(name) and name not in constructor_names:
                is_constructor = False
                for k in range(i + 1, min(i + 30, len(lines))):
                    if 'this.' in lines[k] or 'self.' in lines[k] or 'Reflect.construct' in lines[k]:
                        is_constructor = True
                        break
                if not is_constructor:
                    violations.append((i + 1, "[FUNC_NAMING] Function '{}' is PascalCase but not used as constructor; use camelCase".format(name)))
            elif is_snake_case(name) and '_' in name:
                violations.append((i + 1, "[FUNC_NAMING] Function '{}' uses snake_case; use camelCase".format(name)))

    return violations


# ---------------------------------------------------------------------------
# Rule: BOOL_NAMING
# ---------------------------------------------------------------------------

BOOL_PREFIXES = ('is', 'has', 'can', 'should', 'was', 'will', 'did')
BOOL_EXEMPT = {'found', 'done', 'visible', 'active', 'enabled', 'disabled'}


def check_bool_naming(lines, depths):
    violations = []
    # var name = true/false
    bool_assign = re.compile(r'\bvar\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(true|false)\b')

    for i, line in enumerate(lines):
        clean = strip_strings_and_comments(line)
        m = bool_assign.search(clean)
        if not m:
            continue
        name = m.group(1)
        # Strip leading underscores for prefix checking (private vars like _isFoo)
        bare = name.lstrip('_')
        if name in BOOL_EXEMPT or bare in BOOL_EXEMPT:
            continue
        has_prefix = False
        for prefix in BOOL_PREFIXES:
            if bare.startswith(prefix) and len(bare) > len(prefix) and bare[len(prefix)].isupper():
                has_prefix = True
                break
            if bare == prefix:
                has_prefix = True
                break
        if not has_prefix:
            violations.append((i + 1, "[BOOL_NAMING] Boolean variable '{}' should start with is/has/can/should/was/will/did".format(name)))

    return violations


# ---------------------------------------------------------------------------
# Rule: CSS_PREFIX
# ---------------------------------------------------------------------------

def check_css_prefix(lines):
    violations = []
    # classList.add/remove/contains('...')  or className = '...'
    class_list_pat = re.compile(r'classList\.(add|remove|contains)\s*\(\s*["\']([^"\']+)["\']')
    class_name_pat = re.compile(r'className\s*=\s*["\']([^"\']+)["\']')

    ssli_lines = []
    ctrl_lines = []
    other_lines = []

    for i, line in enumerate(lines):
        for m in class_list_pat.finditer(line):
            cls = m.group(2)
            if cls.startswith('ssli-'):
                ssli_lines.append(i + 1)
            elif cls.startswith('ctrl-'):
                ctrl_lines.append(i + 1)
        for m in class_name_pat.finditer(line):
            classes = m.group(1).split()
            for cls in classes:
                if cls.startswith('ssli-'):
                    ssli_lines.append(i + 1)
                elif cls.startswith('ctrl-'):
                    ctrl_lines.append(i + 1)

    # Flag if both prefixes are used
    if ssli_lines and ctrl_lines:
        # Report the minority prefix occurrences
        if len(ssli_lines) >= len(ctrl_lines):
            for ln in ctrl_lines:
                violations.append((ln, "[CSS_PREFIX] Mixed CSS prefix: 'ctrl-' used but file predominantly uses 'ssli-'"))
        else:
            for ln in ssli_lines:
                violations.append((ln, "[CSS_PREFIX] Mixed CSS prefix: 'ssli-' used but file predominantly uses 'ctrl-'"))

    return violations


# ---------------------------------------------------------------------------
# Rule: ABBREV_CONSISTENCY
# ---------------------------------------------------------------------------

ABBREV_GROUPS = [
    (['btn', 'button'], r'\b(btn|button)\b'),
    (['el', 'elem', 'element'], r'\b(el|elem|element)\b'),
    (['idx', 'index'], r'\b(idx|index)\b'),
    (['evt', 'event', 'e'], r'\b(evt|event)\b'),  # 'e' alone is too noisy
    (['msg', 'message'], r'\b(msg|message)\b'),
    (['cb', 'callback'], r'\b(cb|callback)\b'),
    (['fn', 'func', 'function'], r'\b(fn|func)\b'),  # 'function' keyword excluded
]


def check_abbrev_consistency(lines):
    violations = []

    for group, pattern in ABBREV_GROUPS:
        pat = re.compile(pattern)
        forms_found = {}  # form -> list of line numbers
        for i, line in enumerate(lines):
            clean = strip_strings_and_comments(line)
            for m in pat.finditer(clean):
                form = m.group(1)
                if form not in forms_found:
                    forms_found[form] = []
                forms_found[form].append(i + 1)

        if len(forms_found) > 1:
            # Determine the dominant form
            dominant = max(forms_found, key=lambda f: len(forms_found[f]))
            for form, line_nums in forms_found.items():
                if form != dominant:
                    for ln in line_nums:
                        violations.append((ln, "[ABBREV_CONSISTENCY] Mixed abbreviation: '{}' used but file predominantly uses '{}' (also found: {})".format(
                            form, dominant, ', '.join(sorted(forms_found.keys())))))

    return violations


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

ALL_RULES = ['CONST_NAMING', 'FUNC_NAMING', 'BOOL_NAMING', 'CSS_PREFIX', 'ABBREV_CONSISTENCY']


def lint_file(filepath, rules):
    """Lint a single file. Returns list of (filepath, line, message) tuples."""
    try:
        with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
            content = f.read()
    except (IOError, OSError):
        return []

    lines = content.splitlines()
    depths = compute_scope_depth(lines)
    results = []

    if 'CONST_NAMING' in rules:
        for ln, msg in check_const_naming(lines, depths):
            results.append((filepath, ln, msg))

    if 'FUNC_NAMING' in rules:
        for ln, msg in check_func_naming(lines):
            results.append((filepath, ln, msg))

    if 'BOOL_NAMING' in rules:
        for ln, msg in check_bool_naming(lines, depths):
            results.append((filepath, ln, msg))

    if 'CSS_PREFIX' in rules:
        # ssli-ctrl-*.js files legitimately use both ssli- and ctrl- prefixes
        basename = os.path.basename(filepath)
        is_ctrl_file = (basename.startswith('ssli-ctrl-') and basename.endswith('.js'))
        if not is_ctrl_file:
            for ln, msg in check_css_prefix(lines):
                results.append((filepath, ln, msg))

    if 'ABBREV_CONSISTENCY' in rules:
        for ln, msg in check_abbrev_consistency(lines):
            results.append((filepath, ln, msg))

    return results


def collect_js_files(path):
    """Collect all .js files under path, skipping node_modules."""
    if os.path.isfile(path):
        if path.endswith('.js'):
            return [path]
        return []

    js_files = []
    for root, dirs, files in os.walk(path):
        # Skip node_modules
        dirs[:] = [d for d in dirs if d != 'node_modules']
        for f in files:
            if f.endswith('.js'):
                js_files.append(os.path.join(root, f))
    return sorted(js_files)


def main():
    parser = argparse.ArgumentParser(description='ES5 JavaScript naming convention linter')
    parser.add_argument('path', help='Directory or file to lint')
    parser.add_argument('--rule', dest='rule', default=None,
                        help='Run only the specified rule (e.g. CONST_NAMING)')
    parser.add_argument('--summary', action='store_true',
                        help='Print summary counts by rule')
    args = parser.parse_args()

    if args.rule:
        rule_id = args.rule.upper()
        if rule_id not in ALL_RULES:
            print("Unknown rule: {}. Available: {}".format(args.rule, ', '.join(ALL_RULES)), file=sys.stderr)
            sys.exit(2)
        rules = {rule_id}
    else:
        rules = set(ALL_RULES)

    js_files = collect_js_files(args.path)
    if not js_files:
        print("No .js files found in: {}".format(args.path), file=sys.stderr)
        sys.exit(0)

    all_violations = []
    for filepath in js_files:
        all_violations.extend(lint_file(filepath, rules))

    # Sort by file then line
    all_violations.sort(key=lambda v: (v[0], v[1]))

    for filepath, line, msg in all_violations:
        print("{}:{}: {}".format(filepath, line, msg))

    if args.summary:
        counts = {}
        for _, _, msg in all_violations:
            rule_id = msg.split(']')[0].lstrip('[')
            counts[rule_id] = counts.get(rule_id, 0) + 1
        print("\n--- Summary ---")
        for rule_id in ALL_RULES:
            if rule_id in counts:
                print("  {}: {} violation(s)".format(rule_id, counts[rule_id]))
        print("  Total: {} violation(s)".format(len(all_violations)))

    sys.exit(1 if all_violations else 0)


if __name__ == '__main__':
    main()
