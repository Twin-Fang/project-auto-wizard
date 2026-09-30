#!/usr/bin/env python3
"""
version_manager.py — general-purpose version management script (stdlib only).

This script is copied into user repos (.github/scripts/) by project-auto-wizard
and runs standalone on GitHub Actions ubuntu runners (python3, no third-party deps).

Design rules:
- version.yml is the single source of truth for `version` and `version_code`.
- version.yml is edited via line-based regex replacements that preserve all
  comments and formatting (never rewritten wholesale, never parsed with a YAML lib).
- Versions are synced out to type-specific project files (build.gradle,
  pubspec.yaml, package.json, pyproject.toml, Info.plist, app.json, ...).
- increment/set also rewrite the README.md version line under the
  AUTO-VERSION-SECTION marker, so the release commit (and its tag) already
  shows the new version.

Usage:
    version_manager.py get              # current version (synced)
    version_manager.py get-code         # current version_code
    version_manager.py increment        # patch+1, sync, bump version_code
    version_manager.py increment-code   # version_code+1 only
    version_manager.py set X.Y.Z        # set version explicitly, sync
    version_manager.py sync             # sync version.yml <-> project files

Contract:
    - The LAST line printed to stdout is always the value (callers do `| tail -n 1`).
    - Exit 0 on success; exit 1 on validation failure, missing version.yml,
      or when a version could not be written (e.g. invalid package.json).
"""

import argparse
import datetime
import json
import os
import re
import sys
from pathlib import Path
from typing import Callable, NamedTuple

from messages import t

VERSION_YML = "version.yml"


class VersionSyncError(Exception):
    """The version could not be written to version.yml or a project file — reported via exit 1."""
SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+$")

# How project-file versions are interpreted — must match the install-time detection (src/core/detect.js coreVersion).
# version.yml only stores and bumps x.y.z, so 1.2.3-rc.1, 1.2.3+4 and 1.2.0-SNAPSHOT in a file are read as the core x.y.z.
# Reading them differently would make the value right after install disagree with the one read at the first release.
_CORE_VERSION_RE = re.compile(r"^v?(\d+\.\d+\.\d+)(?:[-+][0-9A-Za-z.+-]*)?$")

# Gradle/Maven -SNAPSHOT is not a pre-release of a specific version but an "in-development build" marker (it selects the
# publishing repository and appears in artifact names). So it is kept and re-appended after a version bump.
# Pre-releases such as rc.1 or beta.1 belong to that version only, so they are dropped when releasing a new x.y.z.
SNAPSHOT_SUFFIX = "-SNAPSHOT"


def core_version(value):
    """x.y.z[-pre][+build] -> x.y.z. None if the value is not a version."""
    m = _CORE_VERSION_RE.match(str(value or "").strip())
    return m.group(1) if m else None


def _keep_snapshot(old_value, new_version):
    return new_version + SNAPSHOT_SUFFIX if str(old_value).endswith(SNAPSHOT_SUFFIX) else new_version


def log(message):
    """Non-value logging output, written to stderr (mirroring the bash
    script's log_* helpers). stdout is reserved for the value contract:
    its last line is always the command's result."""
    print(message, file=sys.stderr)


# ===================================================================
# Newline-preserving file I/O
# ===================================================================

def _detect_eol(raw):
    """Return the dominant line ending of raw text ("\r\n" or "\n")."""
    crlf = raw.count("\r\n")
    lf = raw.count("\n") - crlf
    return "\r\n" if crlf > lf else "\n"


def read_file(path):
    """Read a text file with newlines normalized to \\n for regex processing.
    The original dominant line ending is re-applied by write_file()."""
    with open(path, "r", encoding="utf-8", newline="") as f:
        return f.read().replace("\r\n", "\n")


def write_file(path, text):
    """Write text preserving the dominant line ending of the existing file
    on disk (LF stays LF, CRLF stays CRLF — never platform-dependent)."""
    p = Path(path)
    eol = "\n"
    if p.is_file():
        with open(p, "r", encoding="utf-8", newline="") as f:
            eol = _detect_eol(f.read())
    if eol != "\n":
        text = text.replace("\n", eol)
    with open(p, "w", encoding="utf-8", newline="") as f:
        f.write(text)


# ===================================================================
# version.yml line-based read/write helpers
# ===================================================================

def _version_yml_path():
    return Path(VERSION_YML)


def require_version_yml():
    if not _version_yml_path().is_file():
        log("ERROR: version.yml not found")
        sys.exit(1)


def read_text():
    return read_file(_version_yml_path())


def write_text(text):
    write_file(_version_yml_path(), text)


def read_scalar_key(key, default=None):
    """Read a simple top-level `key: "value"` or `key: value` line.
    Trailing `# comment` (unquoted values only) is stripped."""
    text = read_text()
    m = re.search(
        r'^' + re.escape(key) + r':[ \t]*(.*)$',
        text,
        re.MULTILINE,
    )
    if not m:
        return default
    raw = m.group(1).strip()
    if raw.startswith('"'):
        qm = re.match(r'"([^"]*)"', raw)
        val = qm.group(1) if qm else raw.strip('"')
    else:
        # unquoted scalar: strip trailing comment
        val = raw.split("#", 1)[0].strip()
    return val if val != "" else default


def write_scalar_key(key, value, quote=True):
    """Replace a top-level `key: ...` line's value, preserving everything else.
    If the key doesn't exist, does nothing (mirrors bash's yq behavior of only
    updating existing keys for metadata fields)."""
    text = read_text()
    pattern = re.compile(r'^(' + re.escape(key) + r':)[ \t]*.*$', re.MULTILINE)
    if not pattern.search(text):
        return False
    if quote:
        replacement = r'\1 "' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'
    else:
        replacement = r'\1 ' + str(value)
    new_text = pattern.sub(replacement, text, count=1)
    write_text(new_text)
    return True


def key_exists(key):
    text = read_text()
    return re.search(r'^' + re.escape(key) + r':', text, re.MULTILINE) is not None


def get_current_version():
    return read_scalar_key("version", "0.0.0")


def get_project_types_csv():
    """Return project_types as a list. Supports both:
      project_types: ["a", "b"]
      project_types:
        - "a"
        - "b"
    Returns [] if the key is absent — project_types is the single source of
    truth (issue #62), so callers must treat [] as a hard error rather than
    falling back to a singular key."""
    text = read_text()

    # Inline array form: project_types: ["a", "b"]  # trailing comment allowed
    # The template always appends "# first entry is primary", so anchoring at
    # end-of-line made this branch never match — every install silently fell
    # through to the singular key instead.
    m = re.search(r'^project_types:[ \t]*\[(.*?)\][ \t]*(?:#.*)?$', text, re.MULTILINE)
    if m:
        inner = m.group(1)
        items = re.findall(r'"([^"]*)"|\'([^\']*)\'', inner)
        types = [a or b for a, b in items]
        return [t for t in types if t]

    # Block list form:
    # project_types:
    #   - "a"
    #   - "b"
    m = re.search(r'^project_types:[ \t]*\n((?:[ \t]+-[ \t]*.*\n?)+)', text, re.MULTILINE)
    if m:
        block = m.group(1)
        # trailing comments are allowed on list items too
        types = re.findall(r'-[ \t]*["\']?([^"\'#\n]+?)["\']?[ \t]*(?:#.*)?$', block, re.MULTILINE)
        return [t.strip() for t in types if t.strip()]

    return []


def get_type_path(project_type, project_types_list=None):
    """Return project_paths.<type> if set, else '.' (repo root)."""
    text = read_text()
    # The wizard writes trailing comments on both the key line and value lines
    # (e.g. `project_paths: # ...`, `  flutter: "app" # app/pubspec.yaml`).
    m = re.search(r'^project_paths:[ \t]*(?:#[^\n]*)?\n((?:[ \t]+.+\n?)+)', text, re.MULTILINE)
    if not m:
        return "."
    block = m.group(1)
    km = re.search(
        r'^[ \t]+["\']?' + re.escape(project_type)
        + r'["\']?:[ \t]*["\']?([^"\'#\n]+?)["\']?[ \t]*(?:#.*)?$',
        block,
        re.MULTILINE,
    )
    if km:
        val = km.group(1).strip()
        if val and val != "null":
            return val
    return "."


def get_version_code():
    require_version_yml()
    code = read_scalar_key("version_code", None)
    if code is None or code == "" or code == "null":
        log("WARNING: version_code field missing, adding default value 1")
        text = read_text()
        if re.search(r'^version:', text, re.MULTILINE):
            new_text = re.sub(
                r'^(version:[^\n]*\n)',
                r'\1version_code: 1  # app build number\n',
                text,
                count=1,
                flags=re.MULTILINE,
            )
        else:
            new_text = text.rstrip("\n") + '\nversion_code: 1  # app build number\n'
        write_text(new_text)
        return "1"
    return code.strip()


def set_version_code(new_code):
    current = read_scalar_key("version_code", None)
    if current not in (None, "", "null"):
        try:
            if int(new_code) < int(current):
                log(f"WARNING: version_code {new_code} is lower than current {current} — writing anyway (regression?)")
        except ValueError:
            pass
    text = read_text()
    pattern = re.compile(r'^version_code:[ \t]*.*$', re.MULTILINE)
    replacement = f'version_code: {new_code}  # app build number'
    if pattern.search(text):
        new_text = pattern.sub(replacement, text, count=1)
    else:
        new_text = re.sub(
            r'^(version:[^\n]*\n)',
            r'\1' + replacement + '\n',
            text,
            count=1,
            flags=re.MULTILINE,
        )
    write_text(new_text)


def validate_version(version):
    return bool(version) and SEMVER_RE.match(version) is not None


def increment_patch(version):
    major, minor, patch = version.split(".")
    return f"{major}.{minor}.{int(patch) + 1}"


def increment_version(version, bump="patch"):
    """bump: 'major'|'minor'|'patch'. Defaults to patch when omitted."""
    if bump == "major":
        major, _minor, _patch = version.split(".")
        return f"{int(major) + 1}.0.0"
    if bump == "minor":
        major, minor, _patch = version.split(".")
        return f"{major}.{int(minor) + 1}.0"
    return increment_patch(version)


def compare_versions(v1, v2):
    """Return 1 if v1>v2, -1 if v1<v2, 0 if equal."""
    p1 = [int(x) for x in v1.split(".")]
    p2 = [int(x) for x in v2.split(".")]
    for a, b in zip(p1, p2):
        if a > b:
            return 1
        if a < b:
            return -1
    return 0


def get_higher_version(v1, v2):
    return v1 if compare_versions(v1, v2) >= 0 else v2


def update_version_yml(new_version):
    if not write_scalar_key("version", new_version):
        # Without the key nothing was written yet the call looked successful, so the same version came out every time.
        log("WARNING: version field missing in version.yml, adding it")
        text = read_text()
        line = f'version: "{new_version}"\n'
        if re.search(r'^version_code:', text, re.MULTILINE):
            new_text = re.sub(r'^(?=version_code:)', lambda _m: line, text, count=1, flags=re.MULTILINE)
        else:
            new_text = text.rstrip("\n") + "\n" + line
        write_text(new_text)
    if read_scalar_key("version") != new_version:
        raise VersionSyncError(f"failed to write version {new_version} to version.yml")
    today = datetime.date.today().isoformat()
    user = os.environ.get("GITHUB_ACTOR", "")
    if not user:
        try:
            import getpass
            user = getpass.getuser()
        except Exception:
            user = "unknown"
    if re.search(r'^\s+last_updated:', read_text(), re.MULTILINE):
        _write_nested_scalar("last_updated", today)
    if re.search(r'^\s+last_updated_by:', read_text(), re.MULTILINE):
        _write_nested_scalar("last_updated_by", user)


def _write_nested_scalar(key, value):
    """Replace an indented `  key: "value"` line anywhere in the file
    (used for metadata.* fields), preserving indentation and comments."""
    text = read_text()
    pattern = re.compile(r'^([ \t]+' + re.escape(key) + r':)[ \t]*.*$', re.MULTILINE)
    if not pattern.search(text):
        return False
    escaped = value.replace('\\', '\\\\').replace('"', '\\"')
    replacement = r'\1 "' + escaped + '"'
    new_text = pattern.sub(replacement, text, count=1)
    write_text(new_text)
    return True


# ===================================================================
# Project file sync (type-specific)
# ===================================================================

_XML_TOKEN_RE = re.compile(
    r'<!--.*?-->|<!\[CDATA\[.*?\]\]>|<\?.*?\?>|<![^>]*>|<(/?)([A-Za-z_][\w.:-]*)[^>]*?(/?)>',
    re.DOTALL,
)


def _pom_text_span(text, path):
    """Text span (start, end) of the element at `path` under the root (<project>). None if absent.
    A <version> inside <parent>/<dependencies> is another artifact's version, so depth tells them apart."""
    stack = []
    start = None
    target = list(path)
    for m in _XML_TOKEN_RE.finditer(text):
        name = m.group(2)
        if not name:
            continue  # comment / CDATA / declaration
        if m.group(1):  # closing tag
            if start is not None and stack[1:] == target:
                return start, m.start()
            if stack:
                stack.pop()
            continue
        if m.group(3):  # <tag/>
            continue
        stack.append(name)
        if stack[1:] == target:
            start = m.end()
    return None


def _pom_text(text, path):
    span = _pom_text_span(text, path)
    return text[span[0]:span[1]].strip() if span else None


def _pom_replace(text, path, value):
    span = _pom_text_span(text, path)
    if not span:
        return text, False
    return text[:span[0]] + value + text[span[1]:], True


def sync_maven(path_dir, new_version):
    """Only change the project's own <version> in pom.xml. A child module follows only the
    <parent><version> that points at the root (and its own <version> if it equaled the root's)."""
    root_pom = Path(path_dir) / "pom.xml"
    if not root_pom.is_file():
        return False
    text = read_file(root_pom)
    old_version = _pom_text(text, ["version"])
    if old_version is None:
        log(f"WARNING: spring: {root_pom} has no project <version> (inherited from parent?) — skipping")
        return True
    if "${" in old_version:
        # CI-friendly versions such as ${revision} are managed in a property, so leave them alone.
        log(f"WARNING: spring: {root_pom} <version> is a property ({old_version}) — skipping")
        return True
    new_full = _keep_snapshot(old_version, new_version)
    new_text, _ = _pom_replace(text, ["version"], new_full)
    write_file(root_pom, new_text)
    log(f"updated: {root_pom}")

    root_artifact = _pom_text(text, ["artifactId"])
    for child in sorted(Path(path_dir).glob("*/pom.xml")):
        ctext = read_file(child)
        if _pom_text(ctext, ["parent", "artifactId"]) != root_artifact:
            continue
        if _pom_text(ctext, ["parent", "version"]) != old_version:
            continue
        ctext, _ = _pom_replace(ctext, ["parent", "version"], new_full)
        if _pom_text(ctext, ["version"]) == old_version:
            ctext, _ = _pom_replace(ctext, ["version"], new_full)
        write_file(child, ctext)
        log(f"updated: {child}")
    return True


_GRADLE_VERSION_RE = re.compile(r"""^([ \t]*version[ \t]*=[ \t]*)(['"])([^'"\n]*)\2""", re.MULTILINE)
_GRADLE_SHARED_BLOCKS = ("allprojects", "subprojects")


def _gradle_code(line, quote=""):
    """Strip the comment from a line and blank out quoted text, so the `//` in a url 'https://...' or
    a brace inside a string cannot disturb block-depth counting. Same rule as detect.js.

    `quote` is the quote that was open when this line started. Triple quotes (\"\"\" ''') span lines, so
    return (code, quote still open at end of line) for the next line to continue. A single-line quote
    is treated as closed at end of line."""
    out, i = [], 0
    while i < len(line):
        ch = line[i]
        if quote:
            if ch == "\\" and i + 1 < len(line):
                out.append("  "); i += 2; continue
            if line.startswith(quote, i):
                out.append(quote); i += len(quote); quote = ""; continue
            out.append(" ")
        elif line.startswith(('"""', "'''"), i):
            quote = line[i:i + 3]; out.append(quote); i += 3; continue
        elif ch in "'\"":
            quote = ch; out.append(ch)
        elif line.startswith("//", i):
            break
        else:
            out.append(ch)
        i += 1
    return "".join(out), quote if len(quote) == 3 else ""


def _gradle_version_matches(text):
    """Matches of the project version lines. Reading and syncing share this one place so they touch the same lines.

    If an unindented `version =` exists, only that is used. Only when there is none are indented lines
    inside allprojects/subprojects blocks accepted — mistaking a plugin config block such as `node { version = '20.11.0' }`
    for the project version would make the version jump and break the build config."""
    top, shared = [], []
    stack = []  # open block names: the last word of each line ending in `{`
    quote = ""  # the open quote while inside a multi-line string; lines inside a string are not code
    pos = 0
    for line in text.splitlines(keepends=True):
        m = None if quote else _GRADLE_VERSION_RE.match(line)
        if m:
            m = _GRADLE_VERSION_RE.match(text, pos)
            if not m.group(1)[:1].isspace():
                top.append(m)
            elif any(b in _GRADLE_SHARED_BLOCKS for b in stack):
                shared.append(m)
        code, quote = _gradle_code(line, quote)
        name = re.search(r"(\w+)\s*\{[^{}]*$", code)
        for ch in code:
            if ch == "{":
                stack.append(name.group(1) if name else "")
            elif ch == "}" and stack:
                stack.pop()
        pos += len(line)
    return top or shared


def sync_spring(path_dir, new_version):
    """Look for build.gradle or build.gradle.kts under path_dir (root of that dir, like bash's maxdepth 2),
    and pom.xml for Maven projects."""
    candidates = []
    for name in ("build.gradle", "build.gradle.kts"):
        for p in [Path(path_dir) / name] + list(Path(path_dir).glob("*/" + name)):
            if p.is_file():
                candidates.append(p)
    has_pom = sync_maven(path_dir, new_version)
    if not candidates:
        if not has_pom:
            log(f"WARNING: spring: no build.gradle(.kts) or pom.xml found under {path_dir} — skipping")
        return
    for gradle_file in candidates:
        text = read_file(gradle_file)
        # Only a `version =` at the start of a line is the project version. Without the anchor,
        # dependency version variables such as kotlin_version would change too and break the build.
        matches = _gradle_version_matches(text)
        new_text = text
        # Replace from the end so earlier spans do not shift.
        for m in reversed(matches):
            replaced = f"{m.group(1)}{m.group(2)}{_keep_snapshot(m.group(3), new_version)}{m.group(2)}"
            new_text = new_text[:m.start()] + replaced + new_text[m.end():]
        if not matches:
            log(f"WARNING: spring: no `version = '...'` line in {gradle_file} — skipping")
            continue
        write_file(gradle_file, new_text)
        log(f"updated: {gradle_file}")


def _pubspec_build_number(path_dir):
    """N in pubspec.yaml `version: x.y.z+N`. None if absent."""
    target = Path(path_dir) / "pubspec.yaml"
    if not target.is_file():
        return None
    m = re.search(r'^version:[ \t]*[^\s#+]+\+(\d+)', read_file(target), re.MULTILINE)
    return int(m.group(1)) if m else None


def get_reconciled_version_code():
    """The larger of version.yml version_code and the +N in pubspec.yaml.
    If pubspec is ahead (e.g. after a manual local release), the store rejects a lower build number,
    so that value is adopted into version.yml to prevent a regression."""
    code = int(get_version_code())
    types = get_project_types_csv()
    pubspec_codes = [
        n for n in (_pubspec_build_number(get_type_path(t)) for t in types if t == "flutter")
        if n is not None
    ]
    if pubspec_codes and max(pubspec_codes) > code:
        log(f"pubspec.yaml build number {max(pubspec_codes)} is ahead of version_code {code} — adopting it")
        code = max(pubspec_codes)
        set_version_code(code)
    return code


def sync_flutter(path_dir, new_version, version_code):
    target = Path(path_dir) / "pubspec.yaml"
    if not target.is_file():
        log(f"WARNING: flutter: {target} not found — skipping")
        return
    text = read_file(target)
    full_version = f"{new_version}+{version_code}"
    pattern = re.compile(r'^(version:)[ \t]*.*$', re.MULTILINE)
    if pattern.search(text):
        new_text = pattern.sub(r'\1 ' + full_version, text, count=1)
    else:
        new_text = text.rstrip("\n") + f"\nversion: {full_version}\n"
    write_file(target, new_text)
    log(f"updated: {target}")


def _json_indent(text):
    """Indentation used by an existing JSON file — the first indented line after a newline
    (e.g. 4 spaces or a tab). Single-line JSON stays on one line (None).
    Rewriting with a fixed indent turns every version bump into a whole-file diff."""
    if "\n" not in text.strip():
        return None
    m = re.search(r'\n([ \t]+)\S', text)
    return m.group(1) if m else 2


def sync_json_version(target, new_version, key_path):
    if not target.is_file():
        log(f"WARNING: {target} not found — skipping")
        return
    raw = read_file(target)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        # Skipping and reporting success would silently leave the tag/version.yml and the package version out of step.
        raise VersionSyncError(f"{target} is not valid JSON ({e}) — cannot write version")
    node = data
    for k in key_path[:-1]:
        node = node.setdefault(k, {})
    node[key_path[-1]] = new_version
    write_file(target, json.dumps(data, indent=_json_indent(raw), ensure_ascii=False) + "\n")
    log(f"updated: {target}")


_TOML_HEADER_RE = re.compile(r'^[ \t]*\[+[ \t]*([^\]\n]+?)[ \t]*\]+[ \t]*(?:#.*)?$', re.MULTILINE)
_TOML_VERSION_RE = re.compile(r'^[ \t]*version[ \t]*=[ \t]*([\'"])([^\'"\n]*)\1', re.MULTILINE)


def _pyproject_version_span(text):
    """Value span of `version` in the [project] or [tool.poetry] section. A `version =` in other sections
    such as [tool.*] is tool config, not the package version."""
    headers = list(_TOML_HEADER_RE.finditer(text))
    for i, h in enumerate(headers):
        if h.group(1) not in ("project", "tool.poetry"):
            continue
        end = headers[i + 1].start() if i + 1 < len(headers) else len(text)
        m = _TOML_VERSION_RE.search(text, h.end(), end)
        if m:
            return m.start(2), m.end(2)
    return None


# setup(version="x.y.z"). Other keys such as python_requires / python_version are filtered out by the preceding character.
_SETUP_PY_VERSION_RE = re.compile(r"""(?<![\w.])version\s*=\s*(['"])([^'"]+)\1""")


def _python_version_spans(path_dir):
    """Files and value spans for reading/writing the version. When reading, earlier entries win (pyproject.toml -> setup.py).
    Projects using only setup.py also have their version read at install time, so releases must read and write the same file."""
    spans = []
    pyproject = Path(path_dir) / "pyproject.toml"
    if pyproject.is_file():
        span = _pyproject_version_span(read_file(pyproject))
        if span:
            spans.append((pyproject, span))
    setup_py = Path(path_dir) / "setup.py"
    if setup_py.is_file():
        m = _SETUP_PY_VERSION_RE.search(read_file(setup_py))
        if m:
            spans.append((setup_py, (m.start(2), m.end(2))))
    return spans


def sync_python(path_dir, new_version):
    spans = _python_version_spans(path_dir)
    if not spans:
        # Setups that keep the version out of the file (e.g. dynamic = ["version"]) have nowhere to write it.
        log(f"WARNING: python: no version in pyproject.toml [project]/[tool.poetry] or setup.py under {path_dir} — skipping")
        return
    for target, (start, end) in spans:
        text = read_file(target)
        write_file(target, text[:start] + new_version + text[end:])
        log(f"updated: {target}")


_PLIST_VERSION_RE = re.compile(r'(<key>CFBundleShortVersionString</key>\s*<string>)([^<]*)(</string>)')


def _rn_app_plists(ios_dir):
    """Only the app target Info.plist files, sorted by name. Pods, build output and test targets do not carry our version.
    Chosen in one place so reading and syncing see the same set of files."""
    skip = {"Pods", "build"}
    return [
        p for p in sorted(ios_dir.glob("*/Info.plist"))
        if p.parent.name not in skip and not p.parent.name.endswith("Tests")
    ]


def sync_react_native(path_dir, new_version):
    ios_dir = Path(path_dir) / "ios"
    found_plist = False
    if ios_dir.is_dir():
        for plist_file in _rn_app_plists(ios_dir):
            text = read_file(plist_file)
            m = _PLIST_VERSION_RE.search(text)
            if not m:
                continue
            # A build-variable reference such as $(MARKETING_VERSION) is owned by the Xcode settings, so do not overwrite it.
            if m.group(2).strip().startswith("$("):
                log(f"skipped: {plist_file} — CFBundleShortVersionString references a build variable")
                continue
            new_text = _PLIST_VERSION_RE.sub(lambda mm: mm.group(1) + new_version + mm.group(3), text)
            write_file(plist_file, new_text)
            log(f"updated: {plist_file}")
            found_plist = True
    else:
        log(f"WARNING: react-native: {ios_dir} not found — skipping")

    gradle_file = Path(path_dir) / "android" / "app" / "build.gradle"
    if gradle_file.is_file():
        text = read_file(gradle_file)
        new_text = re.sub(r'versionName\s+"[^"]*"', f'versionName "{new_version}"', text)
        write_file(gradle_file, new_text)
        log(f"updated: {gradle_file}")
    else:
        log(f"WARNING: react-native: {gradle_file} not found — skipping")

    if not found_plist and not gradle_file.is_file():
        log(f"WARNING: react-native: no target files found under {path_dir}")


def sync_for_type(project_type, new_version, version_code_getter):
    path_dir = get_type_path(project_type)
    handler = TYPE_HANDLERS.get(project_type)
    if handler is None:
        log(f"WARNING: unknown project type: {project_type} — skipping")
        return
    handler.sync(path_dir, new_version, version_code_getter)


def sync_all_project_files(new_version):
    types = get_project_types_csv()
    if not types:
        # No silent fallback: an unreadable project_types used to degrade to
        # "basic" and skip every sync without a word.
        raise SystemExit("ERROR: version.yml has no readable project_types — cannot sync project files")
    errors = []
    for t in types:
        # Keep syncing the other types when one fails; collect failures and report them via the exit code at the end.
        try:
            sync_for_type(t, new_version, get_reconciled_version_code)
        except VersionSyncError as e:
            log(f"ERROR: {t}: {e}")
            errors.append(t)
    if errors:
        raise VersionSyncError(f"project file sync failed for: {', '.join(errors)}")


README_VERSION_LINE_RE = re.compile(
    r"^(##[^:\n]*:[ \t]*)v?\d+\.\d+\.\d+([ \t]*\(\d{4}-\d{2}-\d{2}\))?[ \t]*$", re.MULTILINE)


def update_readme_version(new_version, path="README.md"):
    """Rewrite only the version line right below the AUTO-VERSION-SECTION marker.

    The README update workflow runs after the tag is created, so unless the README is part of the
    version-confirm commit, the README at the tag points one version behind. Everything else, such as
    inserting the marker or line, is left to that workflow; here only an existing line is fixed (date presence is kept)."""
    p = Path(path)
    if not p.is_file():
        return False
    text = read_file(p)
    lines = text.split("\n")
    for i, line in enumerate(lines[:-1]):
        if "AUTO-VERSION-SECTION" not in line:
            continue
        m = README_VERSION_LINE_RE.match(lines[i + 1])
        if not m:
            return False
        date = f" ({datetime.date.today().isoformat()})" if m.group(2) else ""
        new_line = f"{m.group(1)}v{new_version}{date}"
        if new_line == lines[i + 1]:
            return False
        lines[i + 1] = new_line
        write_file(p, "\n".join(lines))
        log(f"README.md version line -> v{new_version}")
        return True
    return False


def update_all_versions(new_version):
    update_version_yml(new_version)
    sync_all_project_files(new_version)
    update_readme_version(new_version)


# ===================================================================
# Project file -> version read-back, and the per-type handler table
# ===================================================================

def _read_spring(path_dir):
    # If build.gradle has no version (e.g. only an allprojects config), try build.gradle.kts, then pom.xml.
    for name in ("build.gradle", "build.gradle.kts"):
        p = Path(path_dir) / name
        if p.is_file():
            for m in _gradle_version_matches(read_file(p)):
                version = core_version(m.group(3))
                if version:
                    return version
    pom = Path(path_dir) / "pom.xml"
    if pom.is_file():
        return core_version(_pom_text(read_file(pom), ["version"]))
    return None


def _read_flutter(path_dir):
    p = Path(path_dir) / "pubspec.yaml"
    if p.is_file():
        text = p.read_text(encoding="utf-8")
        m = re.search(r'^version:\s*([^\s#]+)', text, re.MULTILINE)
        if m:
            return core_version(m.group(1))
    return None


def _read_package_json(path_dir):
    p = Path(path_dir) / "package.json"
    if p.is_file():
        data = json.loads(p.read_text(encoding="utf-8"))
        return core_version(data.get("version"))
    return None


def _read_react_native(path_dir):
    """Read from the files used at release time (ios/<app>/Info.plist, android/app/build.gradle).
    package.json version is not synced, so using it as the reference would drift on every release.
    Values that are not x.y.z, such as a $(MARKETING_VERSION) reference or the template default "1.0", are skipped."""
    ios_dir = Path(path_dir) / "ios"
    if ios_dir.is_dir():
        for plist in _rn_app_plists(ios_dir):
            m = _PLIST_VERSION_RE.search(read_file(plist))
            version = core_version(m.group(2)) if m else None
            if version:
                return version
    gradle_file = Path(path_dir) / "android" / "app" / "build.gradle"
    if gradle_file.is_file():
        m = re.search(r'versionName\s+"([^"]+)"', read_file(gradle_file))
        if m:
            return core_version(m.group(1))
    return None


def _read_expo(path_dir):
    p = Path(path_dir) / "app.json"
    if p.is_file():
        data = json.loads(p.read_text(encoding="utf-8"))
        return core_version((data.get("expo") or {}).get("version"))
    return None


def _read_python(path_dir):
    for target, (start, end) in _python_version_spans(path_dir):
        version = core_version(read_file(target)[start:end])
        if version:
            return version
    return None


def _read_none(path_dir):
    return None


def _sync_none(path_dir, new_version, version_code_getter):
    pass


class TypeHandler(NamedTuple):
    """Per-type version file handling. read(path_dir) returns the version in the file (None if absent),
    sync(path_dir, new_version, version_code_getter) writes the new version to the file."""
    read: Callable
    sync: Callable


_PACKAGE_JSON = TypeHandler(
    read=_read_package_json,
    sync=lambda d, v, _code: sync_json_version(Path(d) / "package.json", v, ["version"]),
)

# Adding one line here is enough for a new type: both reading (sync comparison) and writing follow.
# Types without a version file (basic, go) get an empty handler so only version.yml is written.
TYPE_HANDLERS = {
    "spring": TypeHandler(read=_read_spring, sync=lambda d, v, _code: sync_spring(d, v)),
    # Only types that need a build number compute version_code (this has a pubspec-adjusting side effect).
    "flutter": TypeHandler(read=_read_flutter, sync=lambda d, v, code: sync_flutter(d, v, code())),
    "react": _PACKAGE_JSON,
    "next": _PACKAGE_JSON,
    "node": _PACKAGE_JSON,
    "python": TypeHandler(read=_read_python, sync=lambda d, v, _code: sync_python(d, v)),
    "react-native": TypeHandler(read=_read_react_native, sync=lambda d, v, _code: sync_react_native(d, v)),
    "react-native-expo": TypeHandler(
        read=_read_expo,
        sync=lambda d, v, _code: sync_json_version(Path(d) / "app.json", v, ["expo", "version"]),
    ),
    "basic": TypeHandler(read=_read_none, sync=_sync_none),
    "go": TypeHandler(read=_read_none, sync=_sync_none),
}


def get_project_file_version(project_type):
    path_dir = get_type_path(project_type)
    handler = TYPE_HANDLERS.get(project_type)
    version = None
    try:
        if handler is not None:
            version = handler.read(path_dir)
    except Exception as e:
        log(f"WARNING: failed reading project file for {project_type}: {e}")
        version = None

    if not version:
        version = get_current_version()
    return version


def sync_versions():
    yml_version = get_current_version()
    types = get_project_types_csv()
    if not types:
        raise SystemExit("ERROR: version.yml has no readable project_types — cannot sync versions")
    primary_type = types[0]
    project_version = get_project_file_version(primary_type)

    log("Version sync check")
    log(f"  version.yml: {yml_version}")
    log(f"  project file: {project_version}")

    if yml_version != project_version:
        if validate_version(yml_version) and validate_version(project_version):
            higher = get_higher_version(yml_version, project_version)
            log(f"Version mismatch detected, syncing to higher version: {higher}")
            if higher != yml_version:
                update_version_yml(higher)
            if higher != project_version:
                sync_all_project_files(higher)
            return higher
        else:
            log("WARNING: version format invalid, cannot sync")
            return yml_version
    else:
        types = get_project_types_csv()
        if types:
            log(f"Multi-type — reconciling all type files to version.yml version: {yml_version}")
            sync_all_project_files(yml_version)
        log(f"Version already in sync: {yml_version}")
        return yml_version


# ===================================================================
# Commands
# ===================================================================

def cmd_get(args):
    require_version_yml()
    version = sync_versions()
    print(version)
    return 0


def cmd_get_code(args):
    require_version_yml()
    code = get_reconciled_version_code()
    print(code)
    return 0


def cmd_increment_code(args):
    require_version_yml()
    current = get_reconciled_version_code()
    new_code = current + 1
    set_version_code(new_code)
    print(new_code)
    return 0


def cmd_increment(args):
    require_version_yml()
    current_version = sync_versions()
    if not validate_version(current_version):
        log(f"ERROR: invalid version format: {current_version}")
        return 1
    bump = getattr(args, "bump", None) or "patch"
    new_version = increment_version(current_version, bump)
    # Bump the build number first so the following pubspec sync writes the new value too.
    set_version_code(get_reconciled_version_code() + 1)
    update_all_versions(new_version)

    print(new_version)
    return 0


def cmd_set(args):
    require_version_yml()
    new_version = args.version
    if not validate_version(new_version):
        log(f"ERROR: invalid version format: {new_version} (must be x.y.z)")
        return 1
    update_all_versions(new_version)
    print(new_version)
    return 0


def cmd_sync(args):
    require_version_yml()
    synced = sync_versions()
    print(synced)
    return 0


def build_parser():
    parser = argparse.ArgumentParser(prog="version_manager.py")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("get")
    sub.add_parser("get-code")
    p_increment = sub.add_parser("increment")
    p_increment.add_argument("--bump", choices=["major", "minor", "patch"], default="patch",
                              help=t("version.bump_help"))
    sub.add_parser("increment-code")
    sub.add_parser("sync")

    p_set = sub.add_parser("set")
    p_set.add_argument("version")

    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)

    handlers = {
        "get": cmd_get,
        "get-code": cmd_get_code,
        "increment": cmd_increment,
        "increment-code": cmd_increment_code,
        "set": cmd_set,
        "sync": cmd_sync,
    }
    handler = handlers[args.command]
    try:
        return handler(args)
    except VersionSyncError as e:
        log(f"ERROR: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
