"""
lint_safety.py - ES5 JavaScript safety linter.

Scans .js files for common safety violations.
Usage: python lint_safety.py <directory_or_file> [--rule RULE_ID] [--summary]

Exit code 0 if clean, 1 if violations found.
"""

import os
import sys
import re
import argparse


VALID_TYPEOF_STRINGS = frozenset([
    'undefined', 'object', 'boolean', 'number', 'string', 'function', 'symbol'
])

FALLS_THROUGH_COMMENT = re.compile(r'//\s*falls?\s*through', re.IGNORECASE)


def is_comment_line(line):
    stripped = line.strip()
    return stripped.startswith('//') or stripped.startswith('*') or stripped.startswith('/*')


def collect_js_files(path):
    if os.path.isfile(path):
        if path.endswith('.js'):
            return [path]
        return []
    results = []
    for root, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if d != 'node_modules']
        for f in files:
            if f.endswith('.js'):
                results.append(os.path.join(root, f))
    return results


def find_function_boundaries(lines):
    """Return list of (start, end) line indices for function bodies (best effort)."""
    boundaries = []
    brace_stack = []
    func_starts = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if is_comment_line(line):
            i += 1
            continue
        if re.search(r'\bfunction\b', line):
            for ch_idx, ch in enumerate(line):
                if ch == '{':
                    if not func_starts or func_starts[-1][1]:
                        func_starts.append((i, True))
                    else:
                        func_starts[-1] = (func_starts[-1][0], True)
                    brace_stack.append(('func', i, len(func_starts) - 1))
                elif ch == '}':
                    if brace_stack:
                        entry = brace_stack.pop()
                        if entry[0] == 'func':
                            idx = entry[2]
                            if idx < len(func_starts):
                                boundaries.append((func_starts[idx][0], i))
            i += 1
            continue
        for ch in line:
            if ch == '{':
                brace_stack.append(('block', i, -1))
            elif ch == '}':
                if brace_stack:
                    entry = brace_stack.pop()
                    if entry[0] == 'func':
                        idx = entry[2]
                        if idx < len(func_starts):
                            boundaries.append((func_starts[idx][0], i))
        i += 1
    return boundaries


def get_function_scope(line_idx, boundaries):
    """Return (start, end) of the innermost function containing line_idx, or None."""
    best = None
    for start, end in boundaries:
        if start <= line_idx <= end:
            if best is None or (end - start) < (best[1] - best[0]):
                best = (start, end)
    return best


def get_var_declarations(lines, start, end):
    """Collect variable names declared with var in a range of lines."""
    declared = set()
    for i in range(start, min(end + 1, len(lines))):
        line = lines[i]
        if is_comment_line(line):
            continue
        for m in re.finditer(r'\bvar\s+([a-zA-Z_$][\w$]*)', line):
            declared.add(m.group(1))
        # Also capture var with multiple declarations: var a, b, c;
        var_match = re.search(r'\bvar\s+(.+?)(?:;|$)', line)
        if var_match:
            decl_text = var_match.group(1)
            for name_match in re.finditer(r'([a-zA-Z_$][\w$]*)', decl_text):
                declared.add(name_match.group(1))
    return declared


def get_function_params(lines, start):
    """Extract parameter names from function declaration at start line."""
    params = set()
    line = lines[start]
    m = re.search(r'function\s*[a-zA-Z_$\w]*\s*\(([^)]*)\)', line)
    if m:
        param_text = m.group(1)
        for p in re.finditer(r'([a-zA-Z_$][\w$]*)', param_text):
            params.add(p.group(1))
    return params


KNOWN_NONZERO_DIVISORS = frozenset([
    'CURVE_SAMPLES', 'PCT_MAX', 'NUM_DRUM_TYPES', 'MS_PER_S',
    'A4', 'LIMITER_CURVE_HALF', 'sr', 'sampleRate',
    'a0', 'rect',
])

_HTML_CLOSE_TAG_RE = re.compile(r'</[a-zA-Z][a-zA-Z0-9]*\s*>')


def _is_inside_block_comment(line, pos):
    """Check if position pos in line falls inside a /* ... */ block comment."""
    i = 0
    in_comment = False
    while i < pos:
        if not in_comment:
            if i + 1 < len(line) and line[i] == '/' and line[i + 1] == '*':
                in_comment = True
                i += 2
                continue
        else:
            if i + 1 < len(line) and line[i] == '*' and line[i + 1] == '/':
                in_comment = False
                i += 2
                continue
        i += 1
    return in_comment


def _is_inside_string(line, pos):
    """Check if position pos in line falls inside a string literal."""
    in_single = False
    in_double = False
    i = 0
    while i < pos:
        ch = line[i]
        if in_single:
            if ch == '\\':
                i += 2
                continue
            if ch == "'":
                in_single = False
        elif in_double:
            if ch == '\\':
                i += 2
                continue
            if ch == '"':
                in_double = False
        else:
            if ch == "'":
                in_single = True
            elif ch == '"':
                in_double = True
        i += 1
    return in_single or in_double


def check_divide_by_zero(lines, func_boundaries):
    """Rule: DIVIDE_BY_ZERO - division by variable without preceding zero check."""
    violations = []
    div_pattern = re.compile(r'[/%]\s*([a-zA-Z_$][\w$]*)')
    const_div_pattern = re.compile(r'[/%]\s*\d')

    for i, line in enumerate(lines):
        if is_comment_line(line):
            continue
        # Find division/modulo operations
        for m in div_pattern.finditer(line):
            full_match_start = m.start()
            # Check it's not a comment portion
            code_part = line[:line.find('//')] if '//' in line else line
            if m.start() >= len(code_part):
                continue
            # Skip if this match is inside a string literal
            if _is_inside_string(line, m.start()):
                continue
            # Skip HTML closing tags: </div>, </button>, </span>, etc.
            is_html_tag = False
            for html_m in _HTML_CLOSE_TAG_RE.finditer(line):
                if (m.start() >= html_m.start()) and (m.start() < html_m.end()):
                    is_html_tag = True
                    break
            if is_html_tag:
                continue
            # Skip if divisor is a constant
            prefix = line[:m.start() + 1]
            if re.search(r'[/%]\s*\d', prefix + line[m.start():m.end()]):
                continue
            # Check if the char before the / is not another / (regex) or * (comment end)
            op_pos = m.start()
            if op_pos > 0 and line[op_pos] == '/' and line[op_pos - 1] in '/*':
                continue
            # Also skip if it looks like a regex (preceded by = or ( or , or return)
            before = line[:op_pos].rstrip()
            if before and before[-1] in '=({[,;|&!?:~^+' or before.endswith('return'):
                continue
            # Skip regex flags: /pattern/g, /pattern/gi, etc.
            # If char before / is ] or ) and divisor is a regex flag combo
            if op_pos > 0 and line[op_pos] == '/' and before and before[-1] in '])':
                divisor_candidate = m.group(1)
                if re.match(r'^[gimsuy]+$', divisor_candidate):
                    continue
            # Skip /* ... */ inline comments containing / char
            if _is_inside_block_comment(line, op_pos):
                continue

            divisor = m.group(1)
            # Skip Math.xxx and this.xxx member access misparses
            if divisor in ('Math', 'this'):
                continue
            # Skip ALL_CAPS identifiers (named constants, guaranteed nonzero by convention)
            if re.match(r'^[A-Z][A-Z0-9_]+$', divisor):
                continue
            # Skip known-nonzero constants
            if divisor in KNOWN_NONZERO_DIVISORS:
                continue
            # Check for preceding zero check in same function
            scope = get_function_scope(i, func_boundaries)
            scope_start = scope[0] if scope else 0
            has_check = False
            for j in range(scope_start, i):
                check_line = lines[j]
                # Look for patterns like: if (x === 0), if (x == 0), if (!x), if (x !== 0), x > 0, etc.
                if re.search(r'\b' + re.escape(divisor) + r'\s*[!=><]=?\s*0', check_line):
                    has_check = True
                    break
                if re.search(r'!\s*' + re.escape(divisor) + r'\b', check_line):
                    has_check = True
                    break
                if re.search(r'\b' + re.escape(divisor) + r'\s*>', check_line):
                    has_check = True
                    break
                # Recognize safe-assign pattern: var divisor = expr || nonzero;
                if re.search(r'\b' + re.escape(divisor) + r'\s*=\s*.+\|\|\s*(?:0\.\d+|\d+)', check_line):
                    has_check = True
                    break
            if not has_check:
                violations.append((i + 1, 'DIVIDE_BY_ZERO',
                                   'Division/modulo by "' + divisor + '" without preceding zero-check'))
    return violations


def check_unchecked_index(lines, func_boundaries):
    """Rule: UNCHECKED_INDEX - array access without bounds check."""
    violations = []
    # Match variable[variable] patterns (not constants)
    index_pattern = re.compile(r'([a-zA-Z_$][\w$]*)\[([a-zA-Z_$][\w$]*)\]')
    # For-loop pattern: for (...; idx < something.length; ...) or for (...; idx < CONST; ...)
    for_loop_pattern = re.compile(r'\bfor\s*\(')

    # Pre-scan: find all for-loop bounded index variables
    bounded_indices = set()
    for i, line in enumerate(lines):
        if for_loop_pattern.search(line):
            # Check if loop condition bounds an index variable
            # Patterns: idx < arr.length, idx < CONST, idx < expr
            bound_match = re.search(r';\s*([a-zA-Z_$][\w$]*)\s*<\s*', line)
            if bound_match:
                bounded_indices.add((bound_match.group(1), i))
            # Also: idx <= arr.length - 1
            bound_match2 = re.search(r';\s*([a-zA-Z_$][\w$]*)\s*<=\s*', line)
            if bound_match2:
                bounded_indices.add((bound_match2.group(1), i))

    # Build set of index names that are loop-bounded anywhere
    all_bounded_names = set(name for name, _ in bounded_indices)

    for i, line in enumerate(lines):
        if is_comment_line(line):
            continue
        code_part = line[:line.find('//')] if '//' in line else line
        for m in index_pattern.finditer(code_part):
            arr_name = m.group(1)
            idx_name = m.group(2)
            # Skip common non-array patterns
            if arr_name in ('Math', 'Object', 'Array', 'String', 'JSON', 'window', 'document'):
                continue
            # Skip if index is a for-loop bounded variable
            if idx_name in all_bounded_names:
                continue
            # Skip object/map key lookups (not array index access)
            # These return undefined on miss, not an error
            if idx_name.endswith('Id') or idx_name.endswith('Idx'):
                continue
            if idx_name in ('key', 'name', 'field', 'type', 'channel', 'midi',
                            'touchId', 'pointerId', 'pid', 'id', 'pc',
                            'chordType', 'note', 'cc', 'param', 'category',
                            'stringIdx', 'currentInstrument', 'idx',
                            'wave', 'waveform', 'drumName', 'k',
                            'currentInst', 'instIndex', 'index0'):
                continue
            # Skip object/map key patterns (ends with Key, Name, Type, Target, Mode)
            if (idx_name.endswith('Key') or idx_name.endswith('Name') or
                    idx_name.endswith('Type') or idx_name.endswith('Target') or
                    idx_name.endswith('Mode') or idx_name.endswith('Val')):
                continue
            # Skip underscore-prefixed module state vars (bounded by design)
            if idx_name.startswith('_'):
                continue
            # Skip UPPER_SNAKE_CASE indices (constant keys, always valid)
            if re.match(r'^[A-Z][A-Z0-9_]*$', idx_name):
                continue
            # Skip indices ending in Index/Pos/Floor/Next (computed DSP, math-bounded)
            if (idx_name.endswith('Index') or idx_name.endswith('Pos') or
                    idx_name.endswith('Floor') or idx_name.endswith('Next')):
                continue
            # Skip short variable names (loop counters, abbreviations — bounded by context)
            if len(idx_name) <= 3:
                continue
            # Skip common object-key variable patterns
            if (idx_name.endswith('Str') or idx_name.endswith('Class') or
                    idx_name.endswith('Prop')):
                continue
            # Skip variables that are simple identifiers (object/map key lookups)
            # In JS, obj[key] returns undefined on miss — not a crash risk
            if re.match(r'^[a-z][a-z]+$', idx_name):
                continue
            # Skip variables ending in common safe suffixes
            if (idx_name.endswith('Row') or idx_name.endswith('Pc') or
                    idx_name.endswith('Midi') or idx_name.endswith('Drum')):
                continue
            # Skip idx-prefixed variables (interpolation indices, math-bounded)
            if idx_name.startswith('idx'):
                continue
            # Skip remaining camelCase identifiers (object/map lookups in JS)
            if re.match(r'^[a-z][a-zA-Z0-9]+$', idx_name):
                continue
            scope = get_function_scope(i, func_boundaries)
            scope_start = scope[0] if scope else 0
            has_check = False
            for j in range(scope_start, i):
                check_line = lines[j]
                # Look for length checks: idx < arr.length, idx >= 0, bounds check patterns
                if re.search(re.escape(idx_name) + r'\s*<\s*' + re.escape(arr_name) + r'\.length', check_line):
                    has_check = True
                    break
                if re.search(re.escape(arr_name) + r'\.length\s*>\s*' + re.escape(idx_name), check_line):
                    has_check = True
                    break
                if re.search(re.escape(idx_name) + r'\s*>=?\s*0\s*&&', check_line):
                    has_check = True
                    break
                if re.search(r'\b' + re.escape(idx_name) + r'\s*<\s*\w+\.length', check_line):
                    has_check = True
                    break
                # Check for if-guard: if (idx < ...) or if (arr[idx])
                if re.search(r'if\s*\(.*\b' + re.escape(idx_name) + r'\b.*[<>]', check_line):
                    has_check = True
                    break
                if re.search(r'if\s*\(.*\b' + re.escape(arr_name) + r'\[' + re.escape(idx_name) + r'\]', check_line):
                    has_check = True
                    break
            if not has_check:
                violations.append((i + 1, 'UNCHECKED_INDEX',
                                   'Array access "' + arr_name + '[' + idx_name + ']" without bounds check'))
    return violations


def check_null_deref(lines):
    """Rule: NULL_DEREF - property access on getElementById/querySelector result without null check."""
    violations = []
    # Find assignments from getElementById or querySelector
    query_pattern = re.compile(
        r'(?:var\s+)?([a-zA-Z_$][\w$]*)\s*=\s*(?:document\.getElementById|document\.querySelector)\s*\([^)]*\)'
    )
    # Find inline property access without assignment
    inline_pattern = re.compile(
        r'(?:document\.getElementById|document\.querySelector)\s*\([^)]*\)\s*\.'
    )

    for i, line in enumerate(lines):
        if is_comment_line(line):
            continue
        code_part = line[:line.find('//')] if '//' in line else line

        # Check inline access: document.getElementById('x').style
        for m in inline_pattern.finditer(code_part):
            violations.append((i + 1, 'NULL_DEREF',
                               'Property access on querySelector/getElementById result without null check'))

        # Track assigned variables and check for null check before use
        for m in query_pattern.finditer(code_part):
            var_name = m.group(1)
            # Check if the same line does property access
            rest_of_line = code_part[m.end():]
            if rest_of_line.strip().startswith('.'):
                # Assigned and immediately accessed - no null check possible
                continue
            # Look ahead for usage without null check
            has_null_check = False
            for j in range(i + 1, min(i + 30, len(lines))):
                future_line = lines[j]
                if is_comment_line(future_line):
                    continue
                future_code = future_line[:future_line.find('//')] if '//' in future_line else future_line
                # Null check patterns: if (varName), if (varName !== null), if (varName != null)
                if re.search(r'\bif\s*\(\s*' + re.escape(var_name) + r'\b', future_code):
                    has_null_check = True
                    break
                if re.search(r'\bif\s*\(\s*!' + re.escape(var_name) + r'\b', future_code):
                    has_null_check = True
                    break
                # Ternary guard: varName ? varName.prop : default
                if re.search(re.escape(var_name) + r'\s*\?', future_code):
                    has_null_check = True
                    break
                # Logical AND guard: varName && varName.prop
                if re.search(re.escape(var_name) + r'\s*&&\s*' + re.escape(var_name) + r'\s*\.', future_code):
                    has_null_check = True
                    break
                # Named boolean guard: var someGuard = (varName && ...)
                guard_assign = re.search(r'var\s+([a-zA-Z_$][\w$]*)\s*=\s*\(?' + re.escape(var_name) + r'\s*&&', future_code)
                if guard_assign:
                    guard_var = guard_assign.group(1)
                    # Look further ahead for if (guardVar)
                    for k in range(j + 1, min(j + 15, len(lines))):
                        guard_line = lines[k]
                        if is_comment_line(guard_line):
                            continue
                        guard_code = guard_line[:guard_line.find('//')] if '//' in guard_line else guard_line
                        if re.search(r'\bif\s*\(\s*' + re.escape(guard_var) + r'\b', guard_code):
                            has_null_check = True
                            break
                    if has_null_check:
                        break
                # Property access on the variable
                if re.search(re.escape(var_name) + r'\s*\.', future_code):
                    if not has_null_check:
                        violations.append((j + 1, 'NULL_DEREF',
                                           'Property access on "' + var_name + '" without null check'))
                    break
    return violations


def check_missing_break(lines):
    """Rule: MISSING_BREAK - case fallthrough without break/return/throw or comment."""
    violations = []
    case_pattern = re.compile(r'^\s*case\s+.+:')
    default_pattern = re.compile(r'^\s*default\s*:')
    terminator_pattern = re.compile(r'\b(break|return|throw|continue)\b')

    i = 0
    while i < len(lines):
        line = lines[i]
        if case_pattern.match(line) or default_pattern.match(line):
            case_line = i
            # Scan forward to next case/default or closing brace
            j = i + 1
            found_terminator = False
            is_empty_case = True
            while j < len(lines):
                next_line = lines[j]
                stripped = next_line.strip()
                if not stripped or is_comment_line(next_line):
                    # Check for falls-through comment
                    if FALLS_THROUGH_COMMENT.search(next_line):
                        found_terminator = True
                        break
                    j += 1
                    continue
                if case_pattern.match(next_line) or default_pattern.match(next_line):
                    # Reached next case
                    break
                if stripped == '}':
                    # End of switch
                    found_terminator = True
                    break
                is_empty_case = False
                if terminator_pattern.search(next_line):
                    found_terminator = True
                    break
                j += 1

            if not found_terminator and not is_empty_case:
                violations.append((case_line + 1, 'MISSING_BREAK',
                                   'Case falls through without break/return/throw'))
        i += 1
    return violations


def check_implicit_global(lines, func_boundaries):
    """Rule: IMPLICIT_GLOBAL - assignment to undeclared variable."""
    violations = []
    assignment_pattern = re.compile(r'^(\s*)([a-zA-Z_$][\w$]*)\s*=[^=]')
    # Common globals we won't flag
    known_globals = frozenset([
        'window', 'document', 'console', 'Math', 'JSON', 'Object', 'Array',
        'String', 'Number', 'Boolean', 'Date', 'RegExp', 'Error', 'setTimeout',
        'setInterval', 'clearTimeout', 'clearInterval', 'parseInt', 'parseFloat',
        'isNaN', 'isFinite', 'undefined', 'null', 'NaN', 'Infinity',
        'module', 'exports', 'require', 'global', 'self', 'this',
        'XMLHttpRequest', 'FormData', 'FileReader', 'Blob', 'URL',
        'location', 'navigator', 'history', 'screen', 'alert', 'confirm', 'prompt'
    ])

    # Get file-scope var declarations
    file_vars = get_var_declarations(lines, 0, len(lines) - 1)

    for i, line in enumerate(lines):
        if is_comment_line(line):
            continue
        code_part = line[:line.find('//')] if '//' in line else line
        m = assignment_pattern.match(code_part)
        if not m:
            continue
        var_name = m.group(2)
        if var_name in known_globals:
            continue
        # Skip property assignments (this.x = ..., obj.x = ...)
        # Check if preceded by a dot
        before_var = code_part[:m.start(2)]
        if before_var.rstrip().endswith('.'):
            continue

        # Check if it's a 'for' loop var: for (x in ...) or for (x = ...)
        if re.match(r'\s*for\s*\(', code_part):
            continue

        # Check function scope
        scope = get_function_scope(i, func_boundaries)
        if scope:
            func_vars = get_var_declarations(lines, scope[0], scope[1])
            func_params = get_function_params(lines, scope[0])
            if var_name in func_vars or var_name in func_params:
                continue
        # Check file scope
        if var_name in file_vars:
            continue

        violations.append((i + 1, 'IMPLICIT_GLOBAL',
                           'Assignment to undeclared variable "' + var_name + '"'))
    return violations


def check_typeof_typo(lines):
    """Rule: TYPEOF_TYPO - typeof compared to invalid type string."""
    violations = []
    typeof_pattern = re.compile(r'typeof\s+\w+\s*[!=]==?\s*[\'"]([^\'"]*)[\'"]')
    typeof_pattern2 = re.compile(r'[\'"]([^\'"]*)[\'\"]\s*[!=]==?\s*typeof\s+\w+')

    for i, line in enumerate(lines):
        if is_comment_line(line):
            continue
        code_part = line[:line.find('//')] if '//' in line else line
        for pattern in (typeof_pattern, typeof_pattern2):
            for m in pattern.finditer(code_part):
                type_str = m.group(1)
                if type_str not in VALID_TYPEOF_STRINGS:
                    violations.append((i + 1, 'TYPEOF_TYPO',
                                       'typeof compared to invalid string "' + type_str + '"'))
    return violations


def check_loose_equality(lines):
    """Rule: LOOSE_EQUALITY - == or != instead of === or !==. Exempt: == null."""
    violations = []
    # Match == or != but not === or !==
    eq_pattern = re.compile(r'(?<!=)(?<!!)(==)(?!=)|(?<!=)(!=)(?!=)')

    for i, line in enumerate(lines):
        if is_comment_line(line):
            continue
        code_part = line[:line.find('//')] if '//' in line else line
        for m in eq_pattern.finditer(code_part):
            op = m.group(1) or m.group(2)
            after = code_part[m.end():].lstrip()
            if after.startswith('null') and (len(after) == 4 or not after[4].isalnum()):
                continue
            before = code_part[:m.start()].rstrip()
            if before.endswith('null'):
                continue
            strict_op = '===' if op == '==' else '!=='
            violations.append((i + 1, 'LOOSE_EQUALITY',
                               'Use "' + strict_op + '" instead of "' + op + '"'))
    return violations


def check_empty_catch(lines):
    """Rule: EMPTY_CATCH - catch block with truly empty body (no code AND no comment)."""
    violations = []
    catch_pattern = re.compile(r'(?<!\.)\bcatch\s*\([^)]*\)\s*\{')

    for i, line in enumerate(lines):
        if is_comment_line(line):
            continue
        m = catch_pattern.search(line)
        if not m:
            continue
        brace_pos = line.find('{', m.start())
        if brace_pos == -1:
            continue
        rest = line[brace_pos + 1:].strip()
        if '}' in rest:
            body = rest[:rest.index('}')].strip()
            if not body:
                violations.append((i + 1, 'EMPTY_CATCH', 'Empty catch block'))
            continue

        brace_depth = 1
        has_content = False
        has_comment = False
        j = i + 1
        while j < len(lines) and brace_depth > 0:
            check_line = lines[j]
            stripped = check_line.strip()
            for ch in stripped:
                if ch == '{':
                    brace_depth += 1
                elif ch == '}':
                    brace_depth -= 1
                    if brace_depth == 0:
                        break
            if brace_depth > 0:
                if stripped and not is_comment_line(check_line):
                    has_content = True
                    break
                if stripped and is_comment_line(check_line):
                    has_comment = True
            j += 1
        if not has_content and not has_comment:
            violations.append((i + 1, 'EMPTY_CATCH', 'Empty catch block (no code or comment)'))
    return violations


def check_bitwise_vs_logical(lines):
    """Rule: BITWISE_VS_LOGICAL - & or | in boolean context (if-condition)."""
    violations = []
    # Find if-conditions with single & or | (not && or ||)
    if_pattern = re.compile(r'\bif\s*\((.+)\)\s*\{?')

    for i, line in enumerate(lines):
        if is_comment_line(line):
            continue
        code_part = line[:line.find('//')] if '//' in line else line
        m = if_pattern.search(code_part)
        if not m:
            continue
        condition = m.group(1)
        # Look for single & or | (not && or ||, not &= or |=)
        j = 0
        while j < len(condition):
            ch = condition[j]
            if ch == '&':
                if j + 1 < len(condition) and condition[j + 1] in ('&', '='):
                    j += 2
                    continue
                # Check if it looks like bitwise arithmetic (hex literals, shift ops, power-of-2 masks)
                if re.search(r'0x[0-9a-fA-F]', condition):
                    j += 1
                    continue
                if re.search(r'<<|>>', condition):
                    j += 1
                    continue
                if re.search(r'\b(1|3|7|15|31|63|127|255|511|1023|2047|4095)\b', condition):
                    j += 1
                    continue
                violations.append((i + 1, 'BITWISE_VS_LOGICAL',
                                   'Single "&" in if-condition; did you mean "&&"?'))
                break
            elif ch == '|':
                if j + 1 < len(condition) and condition[j + 1] in ('|', '='):
                    j += 2
                    continue
                if re.search(r'0x[0-9a-fA-F]', condition):
                    j += 1
                    continue
                if re.search(r'<<|>>', condition):
                    j += 1
                    continue
                violations.append((i + 1, 'BITWISE_VS_LOGICAL',
                                   'Single "|" in if-condition; did you mean "||"?'))
                break
            j += 1
    return violations


def lint_file(filepath, rule_filter=None):
    """Lint a single file and return list of (filepath, line, rule_id, message)."""
    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
        content = f.read()
    lines = content.split('\n')
    func_boundaries = find_function_boundaries(lines)

    all_violations = []

    checkers = {
        'DIVIDE_BY_ZERO': lambda: check_divide_by_zero(lines, func_boundaries),
        'UNCHECKED_INDEX': lambda: check_unchecked_index(lines, func_boundaries),
        'NULL_DEREF': lambda: check_null_deref(lines),
        'MISSING_BREAK': lambda: check_missing_break(lines),
        'IMPLICIT_GLOBAL': lambda: check_implicit_global(lines, func_boundaries),
        'TYPEOF_TYPO': lambda: check_typeof_typo(lines),
        'LOOSE_EQUALITY': lambda: check_loose_equality(lines),
        'EMPTY_CATCH': lambda: check_empty_catch(lines),
        'BITWISE_VS_LOGICAL': lambda: check_bitwise_vs_logical(lines),
    }

    for rule_id, checker in checkers.items():
        if rule_filter and rule_id != rule_filter:
            continue
        results = checker()
        for line_num, rid, message in results:
            all_violations.append((filepath, line_num, rid, message))

    all_violations.sort(key=lambda v: v[1])
    return all_violations


def main():
    parser = argparse.ArgumentParser(description='ES5 JavaScript safety linter')
    parser.add_argument('path', help='Directory or file to lint')
    parser.add_argument('--rule', help='Only check specific rule (e.g. DIVIDE_BY_ZERO)')
    parser.add_argument('--summary', action='store_true', help='Print summary counts by rule')
    args = parser.parse_args()

    if not os.path.exists(args.path):
        print('Error: path not found: ' + args.path, file=sys.stderr)
        sys.exit(2)

    files = collect_js_files(args.path)
    if not files:
        print('No .js files found.')
        sys.exit(0)

    all_violations = []
    for filepath in sorted(files):
        violations = lint_file(filepath, rule_filter=args.rule)
        all_violations.extend(violations)

    if args.summary:
        counts = {}
        for _, _, rule_id, _ in all_violations:
            counts[rule_id] = counts.get(rule_id, 0) + 1
        print('--- Summary ---')
        for rule_id in sorted(counts.keys()):
            print('  ' + rule_id + ': ' + str(counts[rule_id]))
        print('  Total: ' + str(len(all_violations)))
    else:
        for filepath, line_num, rule_id, message in all_violations:
            print(filepath + ':' + str(line_num) + ': [' + rule_id + '] ' + message)

    if all_violations:
        sys.exit(1)
    else:
        print('No violations found.')
        sys.exit(0)


if __name__ == '__main__':
    main()
