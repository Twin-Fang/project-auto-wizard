#!/usr/bin/env python3
"""
version_manager.py — general-purpose version management script (stdlib only).

This script is copied into user repos (.github/scripts/) by project-auto-wizard
and runs standalone on GitHub Actions ubuntu runners (python3, no third-party deps).

It is a Python rewrite of the battle-tested bash version_manager.sh from
SUH-DEVOPS-TEMPLATE. Behavioral equivalence with that script is the design goal:
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
    - Exit 0 on success; exit 1 on validation failure or missing version.yml.
"""

import argparse
import datetime
import json
import os
import re
import sys
from pathlib import Path

VERSION_YML = "version.yml"
SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+$")


def log(message):
    """Non-value logging output. Goes to stdout but never as the last line
    (callers only care about the last line), mirroring the bash script's
    log_* helpers (which write to stderr) closely enough for CI purposes."""
    print(message, file=sys.stderr)


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
    return _version_yml_path().read_text(encoding="utf-8")


def write_text(text):
    _version_yml_path().write_text(text, encoding="utf-8")


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


def get_project_type():
    return read_scalar_key("project_type", "basic")


def get_project_types_csv():
    """Return project_types as a list. Supports both:
      project_types: ["a", "b"]
      project_types:
        - "a"
        - "b"
    Returns [] if key absent (legacy single-type mode)."""
    text = read_text()

    # Inline array form: project_types: ["a", "b"]
    m = re.search(r'^project_types:[ \t]*\[(.*?)\][ \t]*$', text, re.MULTILINE)
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
        types = re.findall(r'-\s*["\']?([^"\'\n]+?)["\']?\s*$', block, re.MULTILINE)
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
    write_scalar_key("version", new_version)
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

def sync_spring(path_dir, new_version):
    """Look for build.gradle or build.gradle.kts under path_dir (root of that dir, like bash's maxdepth 2)."""
    candidates = []
    for name in ("build.gradle", "build.gradle.kts"):
        for p in [Path(path_dir) / name] + list(Path(path_dir).glob("*/" + name)):
            if p.is_file():
                candidates.append(p)
    if not candidates:
        log(f"WARNING: spring: no build.gradle(.kts) found under {path_dir} — skipping")
        return
    for gradle_file in candidates:
        text = gradle_file.read_text(encoding="utf-8")
        new_text = re.sub(r"version\s*=\s*'[^']*'", f"version = '{new_version}'", text)
        new_text = re.sub(r'version\s*=\s*"[^"]*"', f'version = "{new_version}"', new_text)
        gradle_file.write_text(new_text, encoding="utf-8")
        log(f"updated: {gradle_file}")


def sync_flutter(path_dir, new_version, version_code):
    target = Path(path_dir) / "pubspec.yaml"
    if not target.is_file():
        log(f"WARNING: flutter: {target} not found — skipping")
        return
    text = target.read_text(encoding="utf-8")
    full_version = f"{new_version}+{version_code}"
    pattern = re.compile(r'^(version:)[ \t]*.*$', re.MULTILINE)
    if pattern.search(text):
        new_text = pattern.sub(r'\1 ' + full_version, text, count=1)
    else:
        new_text = text.rstrip("\n") + f"\nversion: {full_version}\n"
    target.write_text(new_text, encoding="utf-8")
    log(f"updated: {target}")


def sync_json_version(target, new_version, key_path):
    if not target.is_file():
        log(f"WARNING: {target} not found — skipping")
        return
    try:
        data = json.loads(target.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        log(f"WARNING: {target} invalid JSON ({e}) — skipping")
        return
    node = data
    for k in key_path[:-1]:
        node = node.setdefault(k, {})
    node[key_path[-1]] = new_version
    target.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    log(f"updated: {target}")


def sync_python(path_dir, new_version):
    target = Path(path_dir) / "pyproject.toml"
    if not target.is_file():
        log(f"WARNING: python: {target} not found — skipping")
        return
    text = target.read_text(encoding="utf-8")
    new_text = re.sub(r'^version\s*=\s*"[^"]*"', f'version = "{new_version}"', text, count=1, flags=re.MULTILINE)
    target.write_text(new_text, encoding="utf-8")
    log(f"updated: {target}")


def sync_react_native(path_dir, new_version):
    ios_dir = Path(path_dir) / "ios"
    found_plist = False
    if ios_dir.is_dir():
        for plist_file in ios_dir.rglob("Info.plist"):
            text = plist_file.read_text(encoding="utf-8")
            if "CFBundleShortVersionString" in text:
                new_text = re.sub(
                    r'(<key>CFBundleShortVersionString</key>\s*<string>)[^<]*(</string>)',
                    r'\g<1>' + new_version + r'\g<2>',
                    text,
                )
                plist_file.write_text(new_text, encoding="utf-8")
                log(f"updated: {plist_file}")
                found_plist = True
    else:
        log(f"WARNING: react-native: {ios_dir} not found — skipping")

    gradle_file = Path(path_dir) / "android" / "app" / "build.gradle"
    if gradle_file.is_file():
        text = gradle_file.read_text(encoding="utf-8")
        new_text = re.sub(r'versionName\s+"[^"]*"', f'versionName "{new_version}"', text)
        gradle_file.write_text(new_text, encoding="utf-8")
        log(f"updated: {gradle_file}")
    else:
        log(f"WARNING: react-native: {gradle_file} not found — skipping")

    if not found_plist and not gradle_file.is_file():
        log(f"WARNING: react-native: no target files found under {path_dir}")


def sync_react_native_versioncode(path_dir, version_code):
    gradle_file = Path(path_dir) / "android" / "app" / "build.gradle"
    if not gradle_file.is_file():
        return
    text = gradle_file.read_text(encoding="utf-8")
    new_text = re.sub(r'versionCode\s+\d+', f'versionCode {version_code}', text)
    gradle_file.write_text(new_text, encoding="utf-8")


def sync_expo(path_dir, new_version):
    target = Path(path_dir) / "app.json"
    if not target.is_file():
        log(f"WARNING: react-native-expo: {target} not found — skipping")
        return
    try:
        data = json.loads(target.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        log(f"WARNING: {target} invalid JSON ({e}) — skipping")
        return
    data.setdefault("expo", {})["version"] = new_version
    target.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    log(f"updated: {target}")


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
        sync_expo(path_dir, new_version)
    elif project_type == "basic":
        pass
    else:
        log(f"WARNING: unknown project type: {project_type} — skipping")


def sync_all_project_files(new_version):
    types = get_project_types_csv()
    if not types:
        types = [get_project_type()]
    for t in types:
        sync_for_type(t, new_version, get_version_code)


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
                text = p.read_text(encoding="utf-8")
                m = re.search(r'^version\s*=\s*"(\d+\.\d+\.\d+)"', text, re.MULTILINE)
                if m:
                    version = m.group(1)
    except Exception as e:
        log(f"WARNING: failed reading project file for {project_type}: {e}")
        version = None

    if not version:
        version = get_current_version()
    return version


def sync_versions():
    yml_version = get_current_version()
    primary_type = get_project_type()
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
    code = get_version_code()
    print(code)
    return 0


def cmd_increment_code(args):
    require_version_yml()
    current = int(get_version_code())
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
    new_version = increment_patch(current_version)
    update_all_versions(new_version)

    current_code = int(get_version_code())
    set_version_code(current_code + 1)

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
    sub.add_parser("increment")
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
    return handler(args)


if __name__ == "__main__":
    sys.exit(main())
