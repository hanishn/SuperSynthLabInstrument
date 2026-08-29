"""
lint_control_flow.py - ES5 JavaScript control-flow linter.

Scans .js files for control-flow anti-patterns and reports violations.

Usage:
    python lint_control_flow.py <directory_or_file> [--rule RULE_ID] [--summary]

Exit code 0 if clean, 1 if violations found.
"""

import os
import sys
import re
import argparse


# ---------------------------------------------------------------------------
# Comment stripping
# ---------------------------------------------------------------------------

def strip_comments(lines):
    """
    Returns a list of (line_number, stripped_line) tuples where comments are
    replaced with whitespace. Handles single-line // and multi-line /* */
    comments, and avoids false positives inside string literals.
    """
    result = []
    in_block_comment = False

    for idx, raw_line in enumerate(lines):
        line = raw_line
        cleaned = []
        i = 0

        if in_block_comment:
            end_pos = line.find('*/')
            if end_pos == -1:
                result.append((idx + 1, ''))
                continue
            else:
                i = end_pos + 2
                in_block_comment = False

        while i < len(line):
            ch = line[i]

            # String literals - skip their contents
            if ch in ('"', "'"):
                quote = ch
                cleaned.append(ch)
                i += 1
                while i < len(line) and line[i] != quote:
                    if line[i] == '\\':
                        cleaned.append(line[i])
                        i += 1
                        if i < len(line):
                            cleaned.append(line[i])
                            i += 1
                    else:
                        cleaned.append(line[i])
                        i += 1
                if i < len(line):
                    cleaned.append(line[i])
                    i += 1
            elif ch == '/' and i + 1 < len(line) and line[i + 1] == '/':
                # Single-line comment - rest of line is comment
                break
            elif ch == '/' and i + 1 < len(line) and line[i + 1] == '*':
                # Block comment start
                end_pos = line.find('*/', i + 2)
                if end_pos == -1:
                    in_block_comment = True
                    break
                else:
                    i = end_pos + 2
            else:
                cleaned.append(ch)
                i += 1

        result.append((idx + 1, ''.join(cleaned)))

    return result


# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------

def strip_strings(line):
    """Remove string literal contents, leaving quotes as placeholders."""
    result = []
    i = 0
    while i < len(line):
        ch = line[i]
        if ch in ('"', "'"):
            quote = ch
            result.append(quote)
            i += 1
            while i < len(line) and line[i] != quote:
                if line[i] == '\\':
                    i += 2
                else:
                    i += 1
            if i < len(line):
                result.append(quote)
                i += 1
        else:
            result.append(ch)
            i += 1
    return ''.join(result)


def count_logical_operators(text):
    """Count && and || operators in text (with strings stripped)."""
    cleaned = strip_strings(text)
    count = len(re.findall(r'&&|\|\|', cleaned))
    return count


def extract_condition(line):
    """Extract the condition from an if/while/for statement."""
    match = re.search(r'\b(?:if|while)\s*\(', line)
    if not match:
        return None
    start = match.end() - 1  # position of opening paren
    depth = 0
    i = start
    while i < len(line):
        if line[i] == '(':
            depth += 1
        elif line[i] == ')':
            depth -= 1
            if depth == 0:
                return line[start + 1:i]
        i += 1
    return None


# ---------------------------------------------------------------------------
# Rule checks
# ---------------------------------------------------------------------------

def check_early_return(filepath, cleaned_lines):
    """EARLY_RETURN: return; or return undefined; that isn't the final statement."""
    violations = []
    # Track brace depth to identify function bodies and block endings
    brace_depth = 0
    function_depths = []  # stack of brace depths where functions start

    # We need to find return statements that are not the last statement in a function
    # Simpler heuristic: flag `return;` or `return undefined;` when followed by
    # non-closing-brace code at the same or deeper level.
    lines_text = [(ln, text.strip()) for ln, text in cleaned_lines]

    for i, (line_num, text) in enumerate(lines_text):
        # Detect early return pattern
        if re.match(r'^return\s*;', text) or re.match(r'^return\s+undefined\s*;', text):
            # Check if this is inside an if block (guard clause pattern)
            # Look ahead - if there's meaningful code after this at same level, it's early
            # Simple heuristic: if the next non-empty, non-closing-brace line exists
            is_early = False
            for j in range(i + 1, min(i + 20, len(lines_text))):
                future_ln, future_text = lines_text[j]
                if future_text == '' or future_text == '}':
                    continue
                if future_text.startswith('//'):
                    continue
                # There's code after this return - it's early
                is_early = True
                break

            if is_early:
                violations.append(
                    (filepath, line_num, 'EARLY_RETURN',
                     'Guard-clause early return detected; prefer if/else wrapping')
                )

    return violations


def check_complex_condition(filepath, cleaned_lines):
    """COMPLEX_CONDITION: if/while with 2+ logical operators without named bool."""
    violations = []

    for line_num, text in cleaned_lines:
        condition = extract_condition(text)
        if condition is None:
            continue
        op_count = count_logical_operators(condition)
        if op_count >= 2:
            # Check if the line before assigns a named bool that is used here
            # Simple heuristic: the condition itself is complex inline
            violations.append(
                (filepath, line_num, 'COMPLEX_CONDITION',
                 'Complex condition with %d logical operators; extract to named boolean' % op_count)
            )

    return violations


def check_string_chain(filepath, cleaned_lines):
    """STRING_CHAIN: 3+ === 'literal' comparisons in if/else-if chain."""
    violations = []
    chain_count = 0
    chain_start_line = 0

    for line_num, text in cleaned_lines:
        stripped = text.strip()
        if re.match(r'^(}\s*else\s+)?if\s*\(', stripped) or re.match(r'^if\s*\(', stripped):
            matches = re.findall(r'===\s*["\']', strip_strings_keep_quotes(text))
            if matches:
                if chain_count == 0:
                    chain_start_line = line_num
                chain_count += len(matches)
            else:
                if chain_count >= 3:
                    violations.append(
                        (filepath, chain_start_line, 'STRING_CHAIN',
                         'Chain of %d string comparisons; use a lookup table or switch' % chain_count)
                    )
                chain_count = 0
        elif re.match(r'^}\s*else\s*{', stripped) or stripped == '}':
            # end of chain possibly
            pass
        else:
            if chain_count >= 3:
                violations.append(
                    (filepath, chain_start_line, 'STRING_CHAIN',
                     'Chain of %d string comparisons; use a lookup table or switch' % chain_count)
                )
            chain_count = 0

    if chain_count >= 3:
        violations.append(
            (filepath, chain_start_line, 'STRING_CHAIN',
             'Chain of %d string comparisons; use a lookup table or switch' % chain_count)
        )

    return violations


def strip_strings_keep_quotes(text):
    """Strip string contents but keep the === 'X' pattern detectable."""
    # We actually want to detect === followed by a quote; the content doesn't matter
    return text


def check_negation_complexity(filepath, cleaned_lines):
    """NEGATION_COMPLEXITY: !!, if(!x){} else{}, !(!x)."""
    violations = []

    for line_num, text in cleaned_lines:
        stripped = strip_strings(text)

        # Double negation !!
        if '!!' in stripped:
            violations.append(
                (filepath, line_num, 'NEGATION_COMPLEXITY',
                 'Double negation !! detected; use explicit boolean conversion')
            )
            continue

        # !(!x) pattern
        if re.search(r'!\s*\(\s*!', stripped):
            violations.append(
                (filepath, line_num, 'NEGATION_COMPLEXITY',
                 'Negated negation !(!x) detected; simplify condition')
            )
            continue

        # if (!condition) { } else { ... } - inverted logic
        # Detect: if (!...) followed by else with content
        # We check for the pattern across lines
        if re.match(r'^\s*if\s*\(\s*!', stripped):
            # Look ahead for empty then-block followed by else
            # This is a simplified check - look for } else on nearby lines
            pass  # Handled in multi-line check below

    # Multi-line inverted logic check
    lines_text = [(ln, text) for ln, text in cleaned_lines]
    for i, (line_num, text) in enumerate(lines_text):
        stripped = strip_strings(text.strip())
        if re.match(r'^if\s*\(\s*!', stripped):
            # Look for pattern: if (!x) { } else { ... }
            # Scan ahead for `} else {` with empty/minimal body before it
            brace_count = 0
            body_lines = 0
            found_else = False
            for j in range(i, min(i + 10, len(lines_text))):
                future_text = strip_strings(lines_text[j][1].strip())
                brace_count += future_text.count('{') - future_text.count('}')
                if j > i:
                    body_lines += 1
                if re.search(r'}\s*else\s*{', future_text) and body_lines <= 2:
                    # Empty or near-empty if-body with else = inverted logic
                    if body_lines <= 1:
                        found_else = True
                    break
                if brace_count <= 0 and j > i:
                    break

            if found_else:
                violations.append(
                    (filepath, line_num, 'NEGATION_COMPLEXITY',
                     'Inverted if(!x) {} else {} pattern; swap branches and remove negation')
                )

    return violations


def check_nested_ternary(filepath, cleaned_lines):
    """NESTED_TERNARY: Ternary inside another ternary."""
    violations = []

    for line_num, text in cleaned_lines:
        stripped = strip_strings(text)
        # Count ? that look like ternary operators (not ?. optional chaining)
        # Find ternary: look for ? followed eventually by :
        ternary_count = 0
        i = 0
        while i < len(stripped):
            if stripped[i] == '?' and i + 1 < len(stripped) and stripped[i + 1] != '.':
                ternary_count += 1
            i += 1
        if ternary_count >= 2:
            violations.append(
                (filepath, line_num, 'NESTED_TERNARY',
                 'Nested ternary expression detected; use if/else for clarity')
            )

    return violations


def check_unreachable_code(filepath, cleaned_lines):
    """UNREACHABLE_CODE: Statements after unconditional return/throw/break/continue."""
    violations = []
    lines_text = [(ln, text.strip()) for ln, text in cleaned_lines]

    for i, (line_num, text) in enumerate(lines_text):
        # Check for unconditional flow-ending statements
        if re.match(r'^(return\b|throw\b|break\s*;|continue\s*;)', text):
            # Skip multi-line returns (return followed by a value on same line)
            if re.match(r'^return\s+\S', text) and not re.match(r'^return\s*;', text):
                continue
            # Skip throw with expression
            if re.match(r'^throw\s+\S', text):
                continue
            # Look ahead for code in the same block
            brace_depth = 0
            for j in range(i + 1, len(lines_text)):
                future_ln, future_text = lines_text[j]
                if future_text == '':
                    continue
                if future_text.startswith('}'):
                    break  # End of block - no unreachable code
                if future_text.startswith('//'):
                    continue
                # Check we haven't entered a new block
                if brace_depth > 0:
                    brace_depth += future_text.count('{') - future_text.count('}')
                    continue
                # Found code after flow-ending statement in same block
                # Make sure it's not a case label
                if re.match(r'^(case\b|default\s*:)', future_text):
                    break
                violations.append(
                    (filepath, future_ln, 'UNREACHABLE_CODE',
                     'Unreachable code after %s' % text.split('(')[0].split(';')[0].strip())
                )
                break

    return violations


def check_assignment_in_condition(filepath, cleaned_lines):
    """ASSIGNMENT_IN_CONDITION: if (x = y) pattern."""
    violations = []

    for line_num, text in cleaned_lines:
        condition = extract_condition(text)
        if condition is None:
            continue
        cleaned_cond = strip_strings(condition)
        # Look for = that is not ==, ===, !=, !==, <=, >=
        # Pattern: word/bracket followed by single = followed by non-=
        if re.search(r'[^!=<>]=[^=]', cleaned_cond):
            # Exclude false positives from arrow functions or default params
            # (not relevant in ES5, but be safe)
            violations.append(
                (filepath, line_num, 'ASSIGNMENT_IN_CONDITION',
                 'Assignment operator in condition; use === for comparison')
            )

    return violations


# ---------------------------------------------------------------------------
# File processing
# ---------------------------------------------------------------------------

ALL_RULES = {
    'EARLY_RETURN': check_early_return,
    'COMPLEX_CONDITION': check_complex_condition,
    'STRING_CHAIN': check_string_chain,
    'NEGATION_COMPLEXITY': check_negation_complexity,
    'NESTED_TERNARY': check_nested_ternary,
    'UNREACHABLE_CODE': check_unreachable_code,
    'ASSIGNMENT_IN_CONDITION': check_assignment_in_condition,
}


def lint_file(filepath, rules):
    """Lint a single file, returning list of violation tuples."""
    try:
        with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
            raw_lines = f.readlines()
    except (IOError, OSError):
        return []

    cleaned_lines = strip_comments(raw_lines)
    violations = []

    for rule_id, check_fn in ALL_RULES.items():
        if rules and rule_id not in rules:
            continue
        violations.extend(check_fn(filepath, cleaned_lines))

    violations.sort(key=lambda v: v[1])
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
        for fname in files:
            if fname.endswith('.js'):
                js_files.append(os.path.join(root, fname))

    js_files.sort()
    return js_files


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description='ES5 JavaScript control-flow linter')
    parser.add_argument('path', help='Directory or file to lint')
    parser.add_argument('--rule', dest='rule', action='append', default=None,
                        help='Only check specific rule(s) (can be repeated)')
    parser.add_argument('--summary', action='store_true',
                        help='Print summary counts by rule')
    args = parser.parse_args()

    target_path = os.path.abspath(args.path)
    if not os.path.exists(target_path):
        print('Error: path does not exist: %s' % target_path, file=sys.stderr)
        sys.exit(2)

    rules = set(args.rule) if args.rule else None
    if rules:
        invalid_rules = rules - set(ALL_RULES.keys())
        if invalid_rules:
            print('Error: unknown rule(s): %s' % ', '.join(sorted(invalid_rules)),
                  file=sys.stderr)
            print('Valid rules: %s' % ', '.join(sorted(ALL_RULES.keys())),
                  file=sys.stderr)
            sys.exit(2)

    js_files = collect_js_files(target_path)
    all_violations = []

    for filepath in js_files:
        violations = lint_file(filepath, rules)
        all_violations.extend(violations)

    # Output violations
    for filepath, line_num, rule_id, message in all_violations:
        print('%s:%d: [%s] %s' % (filepath, line_num, rule_id, message))

    # Summary
    if args.summary:
        print('')
        print('--- Summary ---')
        counts = {}
        for _, _, rule_id, _ in all_violations:
            counts[rule_id] = counts.get(rule_id, 0) + 1
        if counts:
            for rule_id in sorted(counts.keys()):
                print('  %s: %d' % (rule_id, counts[rule_id]))
            print('  Total: %d violations in %d files' % (
                len(all_violations), len(set(v[0] for v in all_violations))))
        else:
            print('  No violations found.')

    sys.exit(1 if all_violations else 0)


if __name__ == '__main__':
    main()
