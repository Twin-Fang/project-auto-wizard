#!/usr/bin/env python3
"""
version_manager.py — general-purpose version management script (stdlib only).

This script is copied into user repos (.github/scripts/) by project-auto-wizard
and runs standalone on GitHub Actions ubuntu runners (python3, no third-party deps).

It is a Python rewrite of the battle-tested bash reference implementation
(version_manager.sh). Behavioral equivalence with that script is the design goal:
- version.yml is the single source of truth for `version` and `version_code`.
- version.yml is edited via line-based regex replacements that preserve all
  comments and formatting (never rewritten wholesale, never parsed with a YAML lib).
- Versions are synced out to type-specific project files (build.gradle,
  pubspec.yaml, package.json, pyproject.toml, Info.plist, app.json, ...).

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

VERSION_YML = "version.yml"


class VersionSyncError(Exception):
    """version.yml·프로젝트 파일에 버전을 쓰지 못했다 — exit 1로 알린다."""
SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+$")


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
    m = re.search(r'^project_paths:[ \t]*\n((?:[ \t]+.+\n?)+)', text, re.MULTILINE)
    if not m:
        return "."
    block = m.group(1)
    km = re.search(
        r'^[ \t]+["\']?' + re.escape(project_type) + r'["\']?:[ \t]*["\']?([^"\'\n]+?)["\']?[ \t]*$',
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
    """bump: 'major'|'minor'|'patch'. 생략하면 기존과 동일하게 patch(increment_patch)로 동작."""
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
        # 키가 없으면 아무것도 쓰지 않은 채 성공처럼 끝나 매번 같은 버전이 나왔다.
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
    """루트(<project>) 기준 경로의 요소 텍스트 구간 (start, end). 없으면 None.
    <parent>·<dependencies> 안의 <version>은 다른 아티팩트 버전이라 깊이로 구분한다."""
    stack = []
    start = None
    target = list(path)
    for m in _XML_TOKEN_RE.finditer(text):
        name = m.group(2)
        if not name:
            continue  # 주석·CDATA·선언
        if m.group(1):  # 닫는 태그
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
    """pom.xml의 프로젝트 자신의 <version>만 바꾼다. 하위 모듈은 루트를 가리키는
    <parent><version>(과 루트와 같던 자기 <version>)만 따라 올린다."""
    root_pom = Path(path_dir) / "pom.xml"
    if not root_pom.is_file():
        return False
    text = read_file(root_pom)
    old_version = _pom_text(text, ["version"])
    if old_version is None:
        log(f"WARNING: spring: {root_pom} has no project <version> (inherited from parent?) — skipping")
        return True
    if "${" in old_version:
        # ${revision} 같은 CI-friendly 버전은 프로퍼티 쪽에서 관리하므로 건드리지 않는다.
        log(f"WARNING: spring: {root_pom} <version> is a property ({old_version}) — skipping")
        return True
    new_text, _ = _pom_replace(text, ["version"], new_version)
    write_file(root_pom, new_text)
    log(f"updated: {root_pom}")

    root_artifact = _pom_text(text, ["artifactId"])
    for child in sorted(Path(path_dir).glob("*/pom.xml")):
        ctext = read_file(child)
        if _pom_text(ctext, ["parent", "artifactId"]) != root_artifact:
            continue
        if _pom_text(ctext, ["parent", "version"]) != old_version:
            continue
        ctext, _ = _pom_replace(ctext, ["parent", "version"], new_version)
        if _pom_text(ctext, ["version"]) == old_version:
            ctext, _ = _pom_replace(ctext, ["version"], new_version)
        write_file(child, ctext)
        log(f"updated: {child}")
    return True


_GRADLE_VERSION_RE =re.compile(r"""^([ \t]*version[ \t]*=[ \t]*)(['"])[^'"\n]*\2""", re.MULTILINE)


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
        # 줄 시작의 `version =`만 프로젝트 버전이다. 앵커가 없으면 kotlin_version 같은
        # 의존성 버전 변수까지 함께 바뀌어 빌드가 깨진다.
        new_text, count = _GRADLE_VERSION_RE.subn(
            lambda m: f"{m.group(1)}{m.group(2)}{new_version}{m.group(2)}", text,
        )
        if count == 0:
            log(f"WARNING: spring: no `version = '...'` line in {gradle_file} — skipping")
            continue
        write_file(gradle_file, new_text)
        log(f"updated: {gradle_file}")


def _pubspec_build_number(path_dir):
    """pubspec.yaml `version: x.y.z+N`의 N. 없으면 None."""
    target = Path(path_dir) / "pubspec.yaml"
    if not target.is_file():
        return None
    m = re.search(r'^version:[ \t]*[^\s#+]+\+(\d+)', read_file(target), re.MULTILINE)
    return int(m.group(1)) if m else None


def get_reconciled_version_code():
    """version.yml의 version_code와 pubspec.yaml의 +N 중 큰 값.
    로컬 수동 배포 등으로 pubspec 쪽이 앞서 있으면 스토어는 더 작은 build number를
    거부하므로, 그 값을 version.yml에 반영해 역행을 막는다."""
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


def sync_json_version(target, new_version, key_path):
    if not target.is_file():
        log(f"WARNING: {target} not found — skipping")
        return
    try:
        data = json.loads(read_file(target))
    except json.JSONDecodeError as e:
        # 건너뛰고 성공으로 끝내면 태그·version.yml과 패키지 버전이 조용히 어긋난다.
        raise VersionSyncError(f"{target} is not valid JSON ({e}) — cannot write version")
    node = data
    for k in key_path[:-1]:
        node = node.setdefault(k, {})
    node[key_path[-1]] = new_version
    write_file(target, json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    log(f"updated: {target}")


_TOML_HEADER_RE = re.compile(r'^[ \t]*\[+[ \t]*([^\]\n]+?)[ \t]*\]+[ \t]*(?:#.*)?$', re.MULTILINE)
_TOML_VERSION_RE = re.compile(r'^[ \t]*version[ \t]*=[ \t]*([\'"])([^\'"\n]*)\1', re.MULTILINE)


def _pyproject_version_span(text):
    """[project] 또는 [tool.poetry] 섹션의 version 값 구간. [tool.*] 등 다른 섹션의
    `version =`은 도구 설정이라 패키지 버전으로 쓰지 않는다."""
    headers = list(_TOML_HEADER_RE.finditer(text))
    for i, h in enumerate(headers):
        if h.group(1) not in ("project", "tool.poetry"):
            continue
        end = headers[i + 1].start() if i + 1 < len(headers) else len(text)
        m = _TOML_VERSION_RE.search(text, h.end(), end)
        if m:
            return m.start(2), m.end(2)
    return None


def sync_python(path_dir, new_version):
    target = Path(path_dir) / "pyproject.toml"
    if not target.is_file():
        log(f"WARNING: python: {target} not found — skipping")
        return
    text = read_file(target)
    span = _pyproject_version_span(text)
    if span is None:
        # dynamic = ["version"] 등 버전을 파일에 두지 않는 구성은 쓸 곳이 없다.
        log(f"WARNING: python: no version in [project]/[tool.poetry] of {target} — skipping")
        return
    write_file(target, text[:span[0]] + new_version + text[span[1]:])
    log(f"updated: {target}")


def sync_react_native(path_dir, new_version):
    ios_dir = Path(path_dir) / "ios"
    found_plist = False
    if ios_dir.is_dir():
        for plist_file in ios_dir.rglob("Info.plist"):
            text = read_file(plist_file)
            if "CFBundleShortVersionString" in text:
                new_text = re.sub(
                    r'(<key>CFBundleShortVersionString</key>\s*<string>)[^<]*(</string>)',
                    r'\g<1>' + new_version + r'\g<2>',
                    text,
                )
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
    if project_type == "spring":
        sync_spring(path_dir, new_version)
    elif project_type == "flutter":
        sync_flutter(path_dir, new_version, version_code_getter())
    elif project_type in ("react", "next", "node"):
        sync_json_version(Path(path_dir) / "package.json", new_version, ["version"])
    elif project_type == "python":
        sync_python(path_dir, new_version)
    elif project_type == "react-native":
        sync_react_native(path_dir, new_version)
    elif project_type == "react-native-expo":
        sync_json_version(Path(path_dir) / "app.json", new_version, ["expo", "version"])
    elif project_type == "basic":
        pass
    elif project_type == "go":
        pass
    else:
        log(f"WARNING: unknown project type: {project_type} — skipping")


def sync_all_project_files(new_version):
    types = get_project_types_csv()
    if not types:
        # No silent fallback: an unreadable project_types used to degrade to
        # "basic" and skip every sync without a word.
        raise SystemExit("ERROR: version.yml has no readable project_types — cannot sync project files")
    errors = []
    for t in types:
        # 한 타입이 실패해도 나머지는 맞춰 두고, 실패는 끝에서 모아 종료 코드로 알린다.
        try:
            sync_for_type(t, new_version, get_reconciled_version_code)
        except VersionSyncError as e:
            log(f"ERROR: {t}: {e}")
            errors.append(t)
    if errors:
        raise VersionSyncError(f"project file sync failed for: {', '.join(errors)}")


def update_all_versions(new_version):
    update_version_yml(new_version)
    sync_all_project_files(new_version)


# ===================================================================
# Project file -> version read-back (for sync comparison)
# ===================================================================

def get_project_file_version(project_type):
    path_dir = get_type_path(project_type)
    version = None
    try:
        if project_type == "spring":
            for name in ("build.gradle", "build.gradle.kts"):
                p = Path(path_dir) / name
                if p.is_file():
                    text = p.read_text(encoding="utf-8")
                    m = re.search(r"^\s*version\s*=\s*['\"](\d+\.\d+\.\d+)['\"]", text, re.MULTILINE)
                    if m:
                        version = m.group(1)
                    break
            pom = Path(path_dir) / "pom.xml"
            if version is None and pom.is_file():
                pom_version = _pom_text(read_file(pom), ["version"])
                if pom_version and SEMVER_RE.match(pom_version):
                    version = pom_version
        elif project_type == "flutter":
            p = Path(path_dir) / "pubspec.yaml"
            if p.is_file():
                text = p.read_text(encoding="utf-8")
                m = re.search(r'^version:\s*([^\s#]+)', text, re.MULTILINE)
                if m:
                    version = m.group(1).split("+")[0]
        elif project_type in ("react", "next", "node"):
            p = Path(path_dir) / "package.json"
            if p.is_file():
                data = json.loads(p.read_text(encoding="utf-8"))
                version = data.get("version")
        elif project_type == "react-native":
            ios_dir = Path(path_dir) / "ios"
            plist = None
            if ios_dir.is_dir():
                plists = list(ios_dir.rglob("Info.plist"))
                plist = plists[0] if plists else None
            if plist is not None:
                text = plist.read_text(encoding="utf-8")
                m = re.search(r'<key>CFBundleShortVersionString</key>\s*<string>([^<]*)</string>', text)
                if m:
                    version = m.group(1)
            else:
                gradle_file = Path(path_dir) / "android" / "app" / "build.gradle"
                if gradle_file.is_file():
                    text = gradle_file.read_text(encoding="utf-8")
                    m = re.search(r'versionName\s+"([^"]+)"', text)
                    if m:
                        version = m.group(1)
        elif project_type == "react-native-expo":
            p = Path(path_dir) / "app.json"
            if p.is_file():
                data = json.loads(p.read_text(encoding="utf-8"))
                version = (data.get("expo") or {}).get("version")
        elif project_type == "python":
            p = Path(path_dir) / "pyproject.toml"
            if p.is_file():
                text = read_file(p)
                span = _pyproject_version_span(text)
                if span and SEMVER_RE.match(text[span[0]:span[1]]):
                    version = text[span[0]:span[1]]
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
    # build number를 먼저 올려야 이어지는 pubspec 동기화에 새 값이 함께 기록된다.
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
                              help="승격 폭 (기본 patch — 지정 안 하면 기존 동작과 동일)")
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
