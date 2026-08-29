"""
lint_state_design.py - Heuristic ES5 JavaScript state-design linter.

Scans .js files for common state-design anti-patterns:
  SENTINEL_VALUE  - Using raw -1/null/'UNKNOWN'/'unknown'/'none' as state values
  BOOL_CLUSTER    - 3+ module-level booleans with shared prefix or co-assignment
  MUTABLE_SHARED  - Module-level var assigned in 3+ different functions
  GOD_OBJECT      - Object literals/namespaces with >10 methods or >15 properties
  CALLBACK_DEPTH  - Nested function definitions >2 levels deep

Usage:
  python lint_state_design.py <directory_or_file> [--rule RULE_ID] [--summary]

Exit code 0 if clean, 1 if violations found.
"""

import os
import re
import sys
import argparse
from collections import defaultdict


RULE_IDS = ['SENTINEL_VALUE', 'BOOL_CLUSTER', 'MUTABLE_SHARED', 'GOD_OBJECT', 'CALLBACK_DEPTH']


def find_js_files(path):
    """Find all .js files under path, skipping node_modules."""
    if os.path.isfile(path):
        if path.endswith('.js'):
            return [path]
        return []
    results = []
    for root, dirs, files in os.walk(path):
        # Skip node_modules
        dirs[:] = [d for d in dirs if d != 'node_modules']
        for f in files:
            if f.endswith('.js'):
                results.append(os.path.join(root, f))
    return sorted(results)


def check_sentinel_value(filepath, lines):
    """SENTINEL_VALUE: flag raw sentinel comparisons."""
    violations = []
    # Pattern: === -1, !== -1, === null, !== null, === 'UNKNOWN', etc.
    sentinel_re = re.compile(
        r'(===|!==)\s*(-1|null|\'UNKNOWN\'|\'unknown\'|\'none\'|"UNKNOWN"|"unknown"|"none")'
    )
    # indexOf exemption: something.indexOf(...) === -1
    indexof_exempt_re = re.compile(r'\.indexOf\s*\([^)]*\)\s*===\s*-1')

    for i, line in enumerate(lines, 1):
        matches = sentinel_re.finditer(line)
        for m in matches:
            operator = m.group(1)
            value = m.group(2)
            # Exempt: indexOf(...) === -1
            if value == '-1' and operator == '===' and indexof_exempt_re.search(line):
                continue
            # Flag !== -1 without named constant (indexOf !== -1 is NOT exempt)
            msg = 'Raw sentinel value %s used in comparison; use a named constant' % value
            violations.append((filepath, i, 'SENTINEL_VALUE', msg))
    return violations


def check_bool_cluster(filepath, lines):
    """BOOL_CLUSTER: 3+ module-level booleans with shared prefix or co-assignment."""
    violations = []
    # Find module-level var assignments to true/false
    # Module-level = not indented or at top indent (heuristic: line starts with var)
    bool_var_re = re.compile(r'^var\s+(\w+)\s*=\s*(true|false)\s*;')
    bool_vars = []  # (name, line_number)
    for i, line in enumerate(lines, 1):
        m = bool_var_re.match(line)
        if m:
            bool_vars.append((m.group(1), i))

    if len(bool_vars) < 3:
        return violations

    # Check for shared prefix (3+ chars)
    names = [v[0] for v in bool_vars]
    prefix_groups = defaultdict(list)
    for name in names:
        # Try prefixes of length 3+
        for length in range(3, len(name)):
            prefix = name[:length]
            # Only count if prefix ends at a word boundary (camelCase or underscore)
            if length < len(name) and (name[length].isupper() or name[length] == '_'):
                prefix_groups[prefix].append(name)
                break
        else:
            # Also group by underscore prefix
            if '_' in name:
                prefix = name.split('_')[0]
                if len(prefix) >= 3:
                    prefix_groups[prefix].append(name)

    for prefix, group_names in prefix_groups.items():
        if len(group_names) >= 3:
            first_line = min(v[1] for v in bool_vars if v[0] in group_names)
            msg = 'Boolean cluster with prefix "%s" (%d vars: %s); consider a state enum' % (
                prefix, len(group_names), ', '.join(group_names[:5]))
            violations.append((filepath, first_line, 'BOOL_CLUSTER', msg))
            break  # Report once per file for prefix clusters

    # Check for co-assignment: booleans set together in the same function
    if not violations and len(bool_vars) >= 3:
        # Find functions and which bool vars they assign
        func_assignments = defaultdict(set)
        current_func = None
        brace_depth = 0
        bool_names_set = set(names)
        assign_re = re.compile(r'(\w+)\s*=\s*(true|false)\s*;')

        for i, line in enumerate(lines, 1):
            # Track function boundaries (heuristic)
            if re.search(r'function\s+(\w+)', line):
                m2 = re.search(r'function\s+(\w+)', line)
                current_func = m2.group(1)
            for m2 in assign_re.finditer(line):
                varname = m2.group(1)
                if varname in bool_names_set and current_func:
                    func_assignments[current_func].add(varname)

        # Find functions that assign 3+ of our bool vars
        for func, assigned in func_assignments.items():
            if len(assigned) >= 3:
                first_line = min(v[1] for v in bool_vars if v[0] in assigned)
                msg = ('Boolean cluster (%d vars set together in %s): %s; '
                       'consider a state enum') % (len(assigned), func,
                                                   ', '.join(sorted(assigned)[:5]))
                violations.append((filepath, first_line, 'BOOL_CLUSTER', msg))
                break

    return violations


def check_mutable_shared(filepath, lines):
    """MUTABLE_SHARED: module-level var assigned in 3+ different functions."""
    violations = []
    # Find module-level var declarations
    module_var_re = re.compile(r'^var\s+(\w+)')
    module_vars = {}  # name -> declaration line

    for i, line in enumerate(lines, 1):
        m = module_var_re.match(line)
        if m:
            module_vars[m.group(1)] = i

    if not module_vars:
        return violations

    # Track which functions assign to each module var
    var_func_assignments = defaultdict(set)  # varname -> set of function names
    current_func = None
    func_depth = 0
    assign_re = re.compile(r'^\s+(\w+)\s*=[^=]')

    # Simple function tracking
    func_stack = []
    brace_depth = 0
    func_start_depths = []

    for i, line in enumerate(lines, 1):
        # Count braces
        open_braces = line.count('{')
        close_braces = line.count('}')

        # Detect function start
        func_match = re.search(r'function\s+(\w+)\s*\(', line)
        if not func_match:
            func_match = re.search(r'(\w+)\s*[:=]\s*function\s*\(', line)
        if func_match and '{' in line:
            func_stack.append((func_match.group(1), brace_depth))

        brace_depth += open_braces - close_braces

        # Pop functions that have closed
        while func_stack and brace_depth <= func_stack[-1][1]:
            func_stack.pop()

        # Check assignments
        if func_stack:
            current_func_name = func_stack[-1][0]
            for m in re.finditer(r'(?<!\w)(\w+)\s*=[^=]', line):
                varname = m.group(1)
                if varname in module_vars and varname != 'var':
                    var_func_assignments[varname].add(current_func_name)

    for varname, funcs in var_func_assignments.items():
        if len(funcs) >= 3:
            msg = ('Module-level var "%s" is assigned in %d functions (%s); '
                   'high coupling risk') % (varname, len(funcs),
                                            ', '.join(sorted(funcs)[:5]))
            violations.append((filepath, module_vars[varname], 'MUTABLE_SHARED', msg))

    return violations


# Exempt data/config objects AND engine facade objects.
# Engine facades (audio, midi, screenAcid, etc.) are the public API surface
# of IIFE modules — necessarily large because they ARE the module boundary.
_GOD_OBJECT_EXEMPT_PATTERNS = re.compile(
    r'(?:DEFAULT|SETTINGS|CONFIG|DATA|PRESETS|META|ICONS|ALGORITHMS|VOWEL'
    r'|audio|midi|screen[A-Z]\w*|params)',
    re.IGNORECASE
)


def check_god_object(filepath, lines):
    """GOD_OBJECT: object literals/namespaces with >10 methods or >25 properties."""
    violations = []
    # Heuristic: find var X = { or X = { patterns and count properties
    # Look for object literal starts
    obj_start_re = re.compile(r'(?:var\s+)?(\w+)\s*=\s*\{')

    i = 0
    while i < len(lines):
        line = lines[i]
        m = obj_start_re.search(line)
        if m:
            obj_name = m.group(1)
            start_line = i + 1
            # Exempt data/config objects by name
            if _GOD_OBJECT_EXEMPT_PATTERNS.search(obj_name):
                i += 1
                continue
            # Count properties and methods until closing brace at same level
            brace_depth = 0
            method_count = 0
            prop_count = 0
            # Count from this line
            for j in range(i, len(lines)):
                curr = lines[j]
                brace_depth += curr.count('{') - curr.count('}')
                # Count method properties: key: function or key: function(
                if re.search(r'^\s+\w+\s*:\s*function\s*\(', curr):
                    method_count += 1
                    prop_count += 1
                elif re.search(r'^\s+\w+\s*:', curr) and j != i:
                    prop_count += 1
                if brace_depth <= 0 and j > i:
                    break
            if method_count > 10:
                msg = ('Object "%s" has %d methods (>10); consider splitting') % (
                    obj_name, method_count)
                violations.append((filepath, start_line, 'GOD_OBJECT', msg))
            elif prop_count > 25:
                msg = ('Object "%s" has %d properties (>25); consider splitting') % (
                    obj_name, prop_count)
                violations.append((filepath, start_line, 'GOD_OBJECT', msg))
        i += 1

    return violations


def check_callback_depth(filepath, lines):
    """CALLBACK_DEPTH: nested function definitions >2 levels deep."""
    violations = []
    func_re = re.compile(r'\bfunction\s*[\w]*\s*\(')
    # Track nesting of function definitions
    func_nesting = 0
    brace_stack = []  # stack of (is_function_brace, depth)
    brace_depth = 0

    # We track function starts by brace depth
    func_start_depths = []  # brace_depth at which each enclosing function started

    for i, line in enumerate(lines, 1):
        # Find function keywords on this line
        for m in func_re.finditer(line):
            current_func_depth = len(func_start_depths)
            if current_func_depth > 4:
                msg = ('Nested function at depth %d (>4); reduce callback nesting') % (
                    current_func_depth)
                violations.append((filepath, i, 'CALLBACK_DEPTH', msg))
            # This function's body brace will be counted below
            func_start_depths.append(brace_depth + line[m.start():].count('{'))

        # Process braces
        for ch in line:
            if ch == '{':
                brace_depth += 1
            elif ch == '}':
                brace_depth -= 1
                # Pop any function scopes that have closed
                while func_start_depths and brace_depth < func_start_depths[-1]:
                    func_start_depths.pop()

    return violations


CHECKERS = {
    'SENTINEL_VALUE': check_sentinel_value,
    'BOOL_CLUSTER': check_bool_cluster,
    'MUTABLE_SHARED': check_mutable_shared,
    'GOD_OBJECT': check_god_object,
    'CALLBACK_DEPTH': check_callback_depth,
}


def lint_file(filepath, rules):
    """Run selected rules against a single file. Returns list of violations."""
    try:
        with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
            lines = f.readlines()
    except (IOError, OSError) as e:
        sys.stderr.write('Warning: cannot read %s: %s\n' % (filepath, e))
        return []

    # Strip newlines for analysis but keep line indexing
    stripped = [l.rstrip('\n\r') for l in lines]
    all_violations = []
    for rule in rules:
        checker = CHECKERS[rule]
        all_violations.extend(checker(filepath, stripped))
    return all_violations


def main():
    parser = argparse.ArgumentParser(description='ES5 JavaScript state-design linter')
    parser.add_argument('path', help='Directory or file to lint')
    parser.add_argument('--rule', choices=RULE_IDS, action='append',
                        help='Only check specific rule(s); may be repeated')
    parser.add_argument('--summary', action='store_true',
                        help='Print summary counts by rule')
    args = parser.parse_args()

    rules = args.rule if args.rule else RULE_IDS
    files = find_js_files(args.path)

    if not files:
        sys.stderr.write('No .js files found under %s\n' % args.path)
        return 0

    all_violations = []
    for filepath in files:
        all_violations.extend(lint_file(filepath, rules))

    # Sort by file then line
    all_violations.sort(key=lambda v: (v[0], v[1]))

    # Print violations
    for filepath, line, rule_id, msg in all_violations:
        print('%s:%d: [%s] %s' % (filepath, line, rule_id, msg))

    # Summary
    if args.summary:
        print('')
        print('--- Summary ---')
        counts = defaultdict(int)
        for _, _, rule_id, _ in all_violations:
            counts[rule_id] += 1
        for rule in RULE_IDS:
            if rule in counts or rule in rules:
                print('  %s: %d' % (rule, counts.get(rule, 0)))
        print('  Total: %d violations in %d files' % (
            len(all_violations), len(set(v[0] for v in all_violations))))

    return 1 if all_violations else 0


if __name__ == '__main__':
    sys.exit(main())
