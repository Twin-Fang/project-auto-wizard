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

VERSION_YML = "version.yml"


class VersionSyncError(Exception):
    """version.yml·프로젝트 파일에 버전을 쓰지 못했다 — exit 1로 알린다."""
SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+$")

# 프로젝트 파일 버전 해석 규칙 — 설치 시 감지(src/core/detect.js coreVersion)와 같아야 한다.
# version.yml은 x.y.z만 저장·증가시키므로 파일의 1.2.3-rc.1·1.2.3+4·1.2.0-SNAPSHOT은 코어 x.y.z로 읽는다.
# 다르게 읽으면 설치 직후 version.yml 값과 첫 릴리스 때 읽은 값이 어긋난다.
_CORE_VERSION_RE = re.compile(r"^v?(\d+\.\d+\.\d+)(?:[-+][0-9A-Za-z.+-]*)?$")

# Gradle·Maven의 -SNAPSHOT은 특정 버전의 프리릴리스가 아니라 "개발 중 빌드" 표식이다(배포 저장소 선택,
# 산출물 이름에 쓰인다). 그래서 버전을 올려도 떼지 않고 새 버전 뒤에 그대로 붙인다.
# rc.1·beta.1 같은 프리릴리스는 그 버전 전용 표식이라 새 x.y.z로 릴리스할 때 버린다.
SNAPSHOT_SUFFIX = "-SNAPSHOT"


def core_version(value):
    """x.y.z[-pre][+build] → x.y.z. 버전 형식이 아니면 None."""
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
    """한 줄에서 주석을 떼고 따옴표 안 글자는 공백으로 바꾼다. url 'https://…'의 `//`나
    문자열 속 중괄호가 블록 깊이 계산을 흐트러뜨리지 않게 한다. detect.js와 같은 규칙.

    quote는 이 줄이 시작될 때 열려 있던 따옴표다. 삼중따옴표(\"\"\" ''')는 여러 줄에 걸치므로
    (코드, 줄 끝에서 열려 있는 따옴표)를 돌려줘 다음 줄이 이어받게 한다. 한 줄짜리 따옴표는
    줄 끝에서 닫힌 것으로 본다."""
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
    """프로젝트 버전 줄의 match 목록. 읽기와 동기화가 이 한 곳을 공유해 같은 줄만 다룬다.

    들여쓰지 않은 `version =`이 있으면 그것만 쓴다. 없을 때만 allprojects/subprojects 블록 안의
    들여쓴 줄을 인정한다 — `node { version = '20.11.0' }` 같은 플러그인 설정 블록을
    프로젝트 버전으로 오인하면 버전이 뛰고 빌드 설정이 깨진다."""
    top, shared = [], []
    stack = []  # 열린 블록 이름. 줄 끝이 `{`로 끝나는 줄의 마지막 단어
    quote = ""  # 여러 줄 문자열 안이면 그 따옴표. 문자열 속 줄은 코드가 아니다
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
        # 줄 시작의 `version =`만 프로젝트 버전이다. 앵커가 없으면 kotlin_version 같은
        # 의존성 버전 변수까지 함께 바뀌어 빌드가 깨진다.
        matches = _gradle_version_matches(text)
        new_text = text
        # 뒤에서부터 바꿔 앞쪽 span이 밀리지 않게 한다.
        for m in reversed(matches):
            replaced = f"{m.group(1)}{m.group(2)}{_keep_snapshot(m.group(3), new_version)}{m.group(2)}"
            new_text = new_text[:m.start()] + replaced + new_text[m.end():]
        if not matches:
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
        # 건너뛰고 성공으로 끝내면 태그·version.yml과 패키지 버전이 조용히 어긋난다.
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


# setup(version="x.y.z"). python_requires·python_version 같은 다른 키는 앞 글자로 거른다.
_SETUP_PY_VERSION_RE = re.compile(r"""(?<![\w.])version\s*=\s*(['"])([^'"]+)\1""")


def _python_version_spans(path_dir):
    """버전을 읽고 쓰는 파일과 값 구간 목록. 읽을 때는 앞쪽(pyproject.toml → setup.py)이 우선이다.
    setup.py만 쓰는 프로젝트도 설치 때 버전을 읽으므로, 릴리스 때도 같은 파일을 읽고 써야 한다."""
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
        # dynamic = ["version"] 등 버전을 파일에 두지 않는 구성은 쓸 곳이 없다.
        log(f"WARNING: python: no version in pyproject.toml [project]/[tool.poetry] or setup.py under {path_dir} — skipping")
        return
    for target, (start, end) in spans:
        text = read_file(target)
        write_file(target, text[:start] + new_version + text[end:])
        log(f"updated: {target}")


_PLIST_VERSION_RE = re.compile(r'(<key>CFBundleShortVersionString</key>\s*<string>)([^<]*)(</string>)')


def _rn_app_plists(ios_dir):
    """앱 타깃의 Info.plist만 이름순으로. Pods·빌드 산출물·테스트 타깃은 우리 버전이 아니다.
    읽기와 동기화가 같은 파일 집합을 보도록 한 곳에서 고른다."""
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
            # $(MARKETING_VERSION) 같은 빌드 변수 참조는 Xcode 설정이 원본이라 덮어쓰지 않는다.
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
        # 한 타입이 실패해도 나머지는 맞춰 두고, 실패는 끝에서 모아 종료 코드로 알린다.
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
    """AUTO-VERSION-SECTION 마커 바로 아래 버전 줄만 새 버전으로 바꾼다.

    README 갱신 워크플로우는 태그를 만든 뒤에 돌기 때문에, 버전 확정 커밋에 README가 함께
    들어가지 않으면 태그 시점 README가 한 버전 전을 가리킨다. 마커·줄 삽입 같은 나머지 일은
    그 워크플로우에 맡기고, 여기서는 이미 있는 줄만 고친다(날짜 표기 여부도 그대로 둔다)."""
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
    # build.gradle에 버전이 없으면(allprojects 설정만 있는 경우 등) build.gradle.kts → pom.xml 순으로 이어 본다.
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
    """릴리스 때 쓰는 파일(ios/<앱>/Info.plist, android/app/build.gradle)에서 읽는다.
    package.json version은 동기화하지 않으므로 기준으로 삼으면 매 릴리스마다 어긋난다.
    $(MARKETING_VERSION) 참조나 템플릿 기본값 "1.0"처럼 x.y.z가 아닌 값은 건너뛴다."""
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
    """타입별 버전 파일 처리. read(path_dir)는 파일의 버전(없으면 None),
    sync(path_dir, new_version, version_code_getter)는 새 버전을 파일에 쓴다."""
    read: Callable
    sync: Callable


_PACKAGE_JSON = TypeHandler(
    read=_read_package_json,
    sync=lambda d, v, _code: sync_json_version(Path(d) / "package.json", v, ["version"]),
)

# 새 타입은 여기 한 줄만 추가하면 읽기(sync 비교)와 쓰기가 함께 따라온다.
# 버전 파일이 없는 타입(basic·go)은 version.yml만 쓰도록 빈 핸들러를 둔다.
TYPE_HANDLERS = {
    "spring": TypeHandler(read=_read_spring, sync=lambda d, v, _code: sync_spring(d, v)),
    # build number가 필요한 타입만 version_code를 계산한다 (pubspec 조정 부수효과가 있다).
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
