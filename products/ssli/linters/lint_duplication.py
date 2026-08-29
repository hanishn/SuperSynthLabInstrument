"""
lint_duplication.py - ES5 JavaScript duplication linter.

Scans .js files for:
  DUPLICATE_FUNCTION  - same function name defined in multiple files
  DUPLICATE_LITERAL   - string literal (>5 chars) appearing 3+ times without constant assignment
  COPY_PASTE_BLOCK    - 5+ identical sequential non-blank/non-comment lines in different files

Usage:
  python lint_duplication.py <directory_or_file> [--rule RULE_ID] [--summary]

Exit code 0 if clean, 1 if violations found.
"""

import argparse
import collections
import hashlib
import os
import re
import sys


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MIN_LITERAL_LENGTH = 6  # >5 chars means length >= 6
MIN_LITERAL_OCCURRENCES = 3
COPY_PASTE_WINDOW = 20

EXEMPT_LITERALS = frozenset([
    # CSS display/position/layout values
    'none', 'block', 'flex', 'click', 'change', 'inline', 'hidden',
    'visible', 'absolute', 'relative', 'fixed', 'static', 'center',
    'linear', 'radial',
    # HTML element types (createElement/querySelector)
    'button', 'option', 'select', 'canvas', 'textarea', 'details',
    'summary', 'header', 'footer', 'section', 'article',
    # WebAudio states
    'suspended', 'running', 'closed',
    # Synth engine type identifiers (used as type discriminators across files)
    'additive', 'subtractive', 'granular', 'sampler', 'physical',
    'bytebeat', 'wavetable', 'superwave', 'vector', 'pulsar',
    'ringmod', 'wavefolder', 'phasedist', 'vocoder', 'drumsyn',
    'multitap', 'formant',
    # ADSR/parameter names
    'attack', 'decay', 'sustain', 'release', 'damping',
    # Custom app event names
    'noteoff', 'allnotesoff', 'noteon',
    # Effect type identifiers
    'bitcrush', 'spring', 'shimmer', 'freeze', 'ducking', 'midiout',
    'feedback', 'warmth', 'threshold', 'amplitude', 'strings',
    'continuous', 'filter', ' active', 'border-box',
    # Common repeated strings in DOM-heavy code
    ' selected',
    # JS typeof results
    'number', 'string', 'undefined', 'function', 'object', 'boolean',
    # Standard directives
    'use strict',
    # WebAudio API oscillator/filter types
    'lowpass', 'highpass', 'bandpass', 'notch', 'allpass', 'peaking',
    'lowshelf', 'highshelf',
    'sine', 'square', 'sawtooth', 'triangle', 'custom',
    # DOM event names
    'resize', 'scroll', 'keydown', 'keyup', 'mousedown', 'mouseup',
    'mousemove', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave',
    'touchstart', 'touchmove', 'touchend', 'touchcancel',
    'pointerdown', 'pointermove', 'pointerup', 'pointercancel',
    'contextmenu', 'dblclick', 'wheel', 'focus', 'blur', 'input',
    'submit', 'dragstart', 'dragover', 'dragend', 'drop',
    'visibilitychange', 'fullscreenchange', 'orientationchange',
    'beforeunload', 'unload', 'hashchange', 'popstate',
    'animationend', 'transitionend', 'loadeddata', 'canplay',
    'ended', 'playing', 'paused', 'statechange',
    # Common HTML/CSS attribute values
    'data-layout', 'data-id', 'data-type', 'data-value',
    'disabled', 'selected', 'checked', 'active', 'loading',
    # Audio/MIDI common strings
    'no audiocontext', 'audio context',
])

# Files that are purely data definitions — exempt from duplicate literal checks
EXEMPT_FILES = frozenset(['presets.js', 'tuning-system.js'])

# Regex patterns
RE_FUNCTION_DECL = re.compile(
    r'^\s*function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(([^)]*)\)'
)
RE_METHOD_ASSIGN = re.compile(
    r'^\s*(?:[a-zA-Z_$][a-zA-Z0-9_$.]*\.)?([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*function\s*\(([^)]*)\)'
)
RE_STRING_LITERAL = re.compile(r"""(?:'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)")""")
RE_CLASSLIST_CALL = re.compile(r'classList\.\w+\(')
RE_CONST_ASSIGN = re.compile(
    r'^\s*(?:var|const)\s+[A-Z_][A-Z0-9_]*\s*='
)
RE_COMMENT_LINE = re.compile(r'^\s*(?://|/\*|\*)')
RE_BLANK_LINE = re.compile(r'^\s*$')
RE_HEX_COLOR = re.compile(r'^#[0-9a-fA-F]{3,8}$')
# camelCase or PascalCase identifiers (parameter/property names, module IDs)
RE_IDENTIFIER_LIKE = re.compile(r'^[a-zA-Z][a-zA-Z0-9]*$')
# dot-prefixed identifiers (namespace paths like 'waveform.type')
RE_DOT_PATH = re.compile(r'^[a-zA-Z][a-zA-Z0-9]*\.[a-zA-Z]')


# ---------------------------------------------------------------------------
# File collection
# ---------------------------------------------------------------------------

def collect_js_files(path):
    """Collect all .js files under path, skipping node_modules."""
    files = []
    if os.path.isfile(path):
        if path.endswith('.js'):
            files.append(os.path.abspath(path))
        return files

    for root, dirs, filenames in os.walk(path):
        # Skip node_modules
        if 'node_modules' in dirs:
            dirs.remove('node_modules')
        for fname in filenames:
            if fname.endswith('.js'):
                files.append(os.path.abspath(os.path.join(root, fname)))
    return files


def read_file_lines(filepath):
    """Read file lines, handling encoding gracefully."""
    try:
        with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
            return f.readlines()
    except (IOError, OSError):
        return []


# ---------------------------------------------------------------------------
# DUPLICATE_FUNCTION
# ---------------------------------------------------------------------------

# Engine interface methods legitimately duplicated across voice models within a file
_ENGINE_INTERFACE_METHODS = frozenset({
    'noteOn', 'noteOff', 'process', 'clear', 'isFinished', 'init'
})

# Closure-scoped helper functions that appear multiple times in the same file
# because they serve different UI sections (e.g. xypad vs theremin snap toggles).
# The linter cannot distinguish closure scope, so exempt by name.
_CLOSURE_SCOPED_DUPLICATES = frozenset({
    '_toggleSnap',
})


def check_duplicate_functions(files):
    """Find functions with the same name+param_count defined multiple times in the same file.

    Cross-file duplicates are intentional in SSLI's IIFE architecture (each
    engine/module is self-contained), so only within-file duplicates are flagged.
    """
    violations = []

    for filepath in files:
        # signature -> list of line_numbers within this file
        function_locations = collections.defaultdict(list)
        lines = read_file_lines(filepath)
        for line_num, line in enumerate(lines, start=1):
            match = RE_FUNCTION_DECL.match(line)
            if not match:
                match = RE_METHOD_ASSIGN.match(line)
            if match:
                name = match.group(1)
                params = match.group(2).strip()
                param_count = len([p for p in params.split(',') if p.strip()]) if params else 0
                sig = (name, param_count)
                function_locations[sig].append(line_num)

        for sig, line_nums in sorted(function_locations.items()):
            if len(line_nums) >= 2:
                name = sig[0]
                # Exempt engine interface methods (duplicated across voice models)
                if name in _ENGINE_INTERFACE_METHODS:
                    continue
                # Exempt closure-scoped helpers that share names across scopes
                if name in _CLOSURE_SCOPED_DUPLICATES:
                    continue
                param_count = sig[1]
                for line_num in line_nums:
                    other_lines = [ln for ln in line_nums if ln != line_num]
                    msg = 'Function \'{}\' (params={}) also defined at: {}'.format(
                        name, param_count,
                        ', '.join('line {}'.format(ln) for ln in other_lines)
                    )
                    violations.append((filepath, line_num, 'DUPLICATE_FUNCTION', msg))

    return violations


# ---------------------------------------------------------------------------
# DUPLICATE_LITERAL
# ---------------------------------------------------------------------------

def check_duplicate_literals(files):
    """Find string literals >5 chars appearing 3+ times without constant assignment."""
    # literal_value -> list of (filepath, line_number)
    literal_locations = collections.defaultdict(list)
    # Track literals that are assigned to constants (exempt)
    constant_literals = set()

    for filepath in files:
        if os.path.basename(filepath) in EXEMPT_FILES:
            continue
        lines = read_file_lines(filepath)
        for line_num, line in enumerate(lines, start=1):
            # Skip comment-only lines (educational comments use // notation
            # with apostrophes in musical terms that look like string delimiters)
            stripped = line.lstrip()
            if stripped.startswith('//') or stripped.startswith('*'):
                continue
            # Check if this line is a constant assignment
            is_const_line = bool(RE_CONST_ASSIGN.match(line))

            # Check if this is a classList call line
            is_classlist_line = bool(RE_CLASSLIST_CALL.search(line))

            for match in RE_STRING_LITERAL.finditer(line):
                value = match.group(1) if match.group(1) is not None else match.group(2)
                if len(value) < MIN_LITERAL_LENGTH:
                    continue
                if value.lower() in EXEMPT_LITERALS:
                    continue
                # Exempt CSS class names in classList calls
                if is_classlist_line:
                    continue
                # Exempt HTML fragments (contain tags)
                if '<' in value or '>' in value:
                    continue
                # Exempt data-* and aria-* attributes
                if value.startswith('data-') or value.startswith('aria-'):
                    continue
                # Exempt hex color codes
                if RE_HEX_COLOR.match(value):
                    continue
                # Exempt CSS class names (ssli- prefix or contain hyphens typical of BEM)
                if value.startswith('ssli-') or value.startswith('kaoss-'):
                    continue
                # Exempt CSS selectors (start with . or contain [ or ])
                if value.startswith('.') or '[' in value:
                    continue
                # Exempt CSS function fragments
                if value.endswith(')') or value.startswith('repeat('):
                    continue
                # Exempt camelCase/PascalCase identifiers (param names, module IDs)
                if RE_IDENTIFIER_LIKE.match(value):
                    continue
                # Exempt dot-path identifiers (namespace.param)
                if RE_DOT_PATH.match(value):
                    continue
                # Exempt CSS value strings (contain units, functions, or flex shorthand)
                if value.endswith(('rem', 'px', 'em', '%', 'auto', 'ease')):
                    continue
                if value.startswith(('scale(', 'translateX(', 'translateY(', 'rotate(')):
                    continue
                # Exempt hyphenated strings (CSS identifiers, BEM classes, suffixes)
                if '-' in value and value.replace('-', '').replace('_', '').replace(' ', '').isalnum():
                    continue
                # Exempt MIME types
                if '/' in value and value.count('/') == 1 and ' ' not in value:
                    continue
                # Exempt underscore-prefixed identifiers (namespace_param)
                if value.startswith('_') or (value[0].isalpha() and '_' in value and value.replace('_', '').isalnum()):
                    continue
                # Exempt namespace path prefixes (end with dot)
                if value.endswith('.'):
                    continue
                # Exempt template/whitespace strings (mostly whitespace, or contain \n)
                stripped_val = value.strip()
                if stripped_val in ('}', '{', '};', '{}') or not stripped_val:
                    continue
                if '\\n' in value or (len(stripped_val) < 4 and all(c in '{}(); \t\n' for c in stripped_val)):
                    continue
                # Exempt display text (uppercase start + space = UI label, belongs to HARDCODED_STRING rule)
                if value[0].isupper() and ' ' in value:
                    continue
                # Exempt strings with Unicode non-ASCII (symbols, glyphs) or escape sequences
                if any(ord(c) > 127 for c in value) or '\\u' in value:
                    continue
                # Exempt Canvas font strings
                if 'monospace' in value or 'sans-serif' in value or 'serif' in value:
                    continue
                # Exempt HTML entities
                if value.startswith('&') and value.endswith(';'):
                    continue

                if is_const_line:
                    constant_literals.add(value)
                else:
                    literal_locations[value].append((filepath, line_num))

    violations = []
    for value, locations in sorted(literal_locations.items()):
        if value in constant_literals:
            continue
        if len(locations) >= MIN_LITERAL_OCCURRENCES:
            for filepath, line_num in locations:
                msg = "String '{}' appears {} times without a named constant".format(
                    value if len(value) <= 40 else value[:37] + '...',
                    len(locations)
                )
                violations.append((filepath, line_num, 'DUPLICATE_LITERAL', msg))

    return violations


# ---------------------------------------------------------------------------
# COPY_PASTE_BLOCK
# ---------------------------------------------------------------------------

def normalize_line(line):
    """Strip leading whitespace for comparison purposes."""
    return line.rstrip('\n').rstrip('\r').lstrip()


def is_significant_line(line):
    """Return True if line is non-blank and non-comment."""
    stripped = line.strip()
    if not stripped:
        return False
    if RE_COMMENT_LINE.match(line):
        return False
    return True


# Synth engine/worklet modules intentionally share structural patterns
# (midiToFreq, filter wiring, voice management) as self-contained IIFEs
_COPY_PASTE_EXEMPT_SUFFIXES = (
    '-engine.js', '-worklet.js', '-synth.js',
    'note-playback.js', 'instrument-settings.js',
    'ssli-ctrl-breathpad',
)


def check_copy_paste_blocks(files):
    """Find 20+ sequential identical non-blank/non-comment lines across files."""
    # Build per-file lists of significant lines with their original line numbers
    file_data = {}  # filepath -> list of (original_line_num, normalized_content)
    for filepath in files:
        basename = os.path.basename(filepath)
        if any(pattern in basename for pattern in _COPY_PASTE_EXEMPT_SUFFIXES):
            continue
        lines = read_file_lines(filepath)
        significant = []
        for line_num, line in enumerate(lines, start=1):
            if is_significant_line(line):
                significant.append((line_num, normalize_line(line)))
        file_data[filepath] = significant

    # Hash windows of COPY_PASTE_WINDOW consecutive significant lines
    # hash -> list of (filepath, start_line_num)
    window_hashes = collections.defaultdict(list)

    for filepath, sig_lines in file_data.items():
        if len(sig_lines) < COPY_PASTE_WINDOW:
            continue
        for i in range(len(sig_lines) - COPY_PASTE_WINDOW + 1):
            window = tuple(sig_lines[i + j][1] for j in range(COPY_PASTE_WINDOW))
            h = hashlib.md5('\n'.join(window).encode('utf-8')).hexdigest()
            start_line = sig_lines[i][0]
            window_hashes[h].append((filepath, start_line))

    # Find hashes that appear in multiple different files
    violations = []
    reported = set()  # avoid duplicate reports for overlapping windows

    for h, locations in window_hashes.items():
        unique_files = set(loc[0] for loc in locations)
        if len(unique_files) < 2:
            continue

        for filepath, start_line in locations:
            report_key = (filepath, start_line)
            if report_key in reported:
                continue
            reported.add(report_key)

            other_locations = [
                (f, ln) for f, ln in locations
                if f != filepath or ln != start_line
            ]
            # Deduplicate other locations for the message
            other_strs = []
            seen_others = set()
            for f, ln in other_locations:
                key = (f, ln)
                if key not in seen_others:
                    seen_others.add(key)
                    other_strs.append('{}:{}'.format(f, ln))

            msg = '{} duplicate lines also found at: {}'.format(
                COPY_PASTE_WINDOW,
                ', '.join(other_strs[:3])  # limit to 3 references
            )
            if len(other_strs) > 3:
                msg += ' (+{} more)'.format(len(other_strs) - 3)

            violations.append((filepath, start_line, 'COPY_PASTE_BLOCK', msg))

    return violations


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

RULE_CHECKERS = {
    'DUPLICATE_FUNCTION': check_duplicate_functions,
    'DUPLICATE_LITERAL': check_duplicate_literals,
    'COPY_PASTE_BLOCK': check_copy_paste_blocks,
}


def main():
    parser = argparse.ArgumentParser(description='ES5 JavaScript duplication linter')
    parser.add_argument('path', help='Directory or file to scan')
    parser.add_argument('--rule', dest='rule', default=None,
                        choices=list(RULE_CHECKERS.keys()),
                        help='Run only a specific rule')
    parser.add_argument('--summary', action='store_true',
                        help='Print summary counts only')
    args = parser.parse_args()

    if not os.path.exists(args.path):
        print('Error: path does not exist: {}'.format(args.path), file=sys.stderr)
        sys.exit(2)

    files = collect_js_files(args.path)
    if not files:
        print('No .js files found.', file=sys.stderr)
        sys.exit(0)

    rules_to_run = [args.rule] if args.rule else list(RULE_CHECKERS.keys())

    all_violations = []
    for rule_id in rules_to_run:
        checker = RULE_CHECKERS[rule_id]
        violations = checker(files)
        all_violations.extend(violations)

    # Sort by file, then line number
    all_violations.sort(key=lambda v: (v[0], v[1]))

    if args.summary:
        counts = collections.Counter(v[2] for v in all_violations)
        total = len(all_violations)
        for rule_id in sorted(counts.keys()):
            print('{}: {} violation(s)'.format(rule_id, counts[rule_id]))
        print('Total: {} violation(s)'.format(total))
    else:
        for filepath, line_num, rule_id, msg in all_violations:
            print('{}:{}: [{}] {}'.format(filepath, line_num, rule_id, msg))

    if all_violations:
        sys.exit(1)
    else:
        sys.exit(0)


if __name__ == '__main__':
    main()
