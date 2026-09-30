#!/usr/bin/env python3
"""
changelog_manager.py

Unified changelog manager script.

Subcommands:
  - update-from-summary: parse the release summary Markdown and update CHANGELOG.json
  - generate-md        : regenerate CHANGELOG.md from CHANGELOG.json
  - export             : build the release notes of one version and write them to stdout or a file
  - ai-summary         : build a release summary from a commit list (language model, or the rule-based fallback)

Examples:
  python3 changelog_manager.py update-from-summary
  python3 changelog_manager.py generate-md
  python3 changelog_manager.py export --version 0.0.2 --output release_notes.txt
  python3 changelog_manager.py ai-summary --commits-file commits.txt --version 1.2.3 --output summary.md

Input file:
  - pr_body.md: GitHub PR body (Markdown)
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import subprocess
import sys
import tempfile
import traceback
import urllib.error
import urllib.request

import issue_helper
from messages import t


# ----------------------------- Common utilities -----------------------------

def _normalize_text(text: str) -> str:
    """Normalize text: decode HTML entities and trim whitespace."""
    return html.unescape(text).strip()


def _clean_summary_noise(text: str) -> str:
    """
    Remove unwanted noise from summary text.

    Removed:
    1. HTML comments (<!-- ... -->)
    2. Remaining HTML tags
    3. Runs of blank lines
    """
    if not text:
        return text

    # 1. Remove HTML comments
    text = re.sub(r'<!--.*?-->', '', text, flags=re.DOTALL)

    # 2. Remove remaining HTML tags
    text = re.sub(r'<[^>]+>', '', text)

    # 3. Collapse runs of blank lines (3 or more -> 2)
    text = re.sub(r'\n{3,}', '\n\n', text)

    return text.strip()


def _strip_version_headings(text: str) -> str:
    """Drop `## [1.2.3]` version heading lines from the summary body — CHANGELOG.md
    writes its own heading per release, so keeping them would print the heading twice
    for a release without commits."""
    if not text:
        return text
    kept = []
    for line in text.split('\n'):
        heading = _HEADING_RE.match(line)
        if heading and _VERSION_HEADING_RE.match(heading.group(2).strip()):
            continue
        kept.append(line)
    return '\n'.join(kept).strip()


def _make_safe_key(title: str, idx: int) -> str:
    """Convert a category title into a safe key."""
    # \uac00-\ud7a3 is the Hangul syllable block; titles in either language keep their letters
    safe_key = re.sub(r'[^a-zA-Z0-9\uac00-\ud7a3]', '_', title.lower()).strip('_')
    return safe_key if safe_key else f"category_{idx}"


# ----------------------- Markdown parser (unified) -----------------------

def _parse_summary_markdown(md_content: str) -> dict:
    """
    Parse release summary Markdown into categories/items.

    Three-stage fallback strategy:
    1. Section parsing (the format the engine chain and rule-based fallback emit)
    2. Lenient parsing (tolerates variants such as nested bullets)
    3. Heuristic parsing (last resort)

    Expected format (as defined by _build_ai_prompt / render_fallback_md); headings in
    any language are accepted because titles are taken verbatim:
    ## [1.2.3]

    ### ✨ Features
    - Add user login
    - Add dashboard widget

    ### 🐛 Fixes
    - Fix null pointer exception
    """
    # Stage 1: section parsing
    detected = _parse_markdown_sections(md_content)
    if detected:
        print(t("changelog.parser_section_ok"))
        return detected

    # Stage 2: lenient parsing
    detected = _parse_markdown_lenient(md_content)
    if detected:
        print(t("changelog.parser_lenient_ok"))
        return detected

    # Stage 3: heuristic parsing
    detected = _parse_markdown_heuristic(md_content)
    if detected:
        print(t("changelog.parser_heuristic_ok"))
    return detected


# Headings such as `## [1.2.3]` / `## v1.2.3` point at the release version, not a category
_VERSION_HEADING_RE = re.compile(r'^\[?\s*v?\d+(?:\.\d+)*\s*\]?$')

_HEADING_RE = re.compile(r'^\s{0,3}(#{2,6})\s+(.+?)\s*#*\s*$')
_BULLET_RE = re.compile(r'^\s*[\*\-\+]\s+(.+?)\s*$')


def _parse_markdown_sections(md_content: str) -> dict:
    """
    Section parser: `### Category` heading + `- item` bullet format.

    The engine chain (user API -> Copilot CLI) and the rule-based fallback emit
    the same format, so it is tried first.
    """
    detected: dict[str, dict] = {}
    order: list[str] = []
    current_key = None

    for line in md_content.split('\n'):
        heading = _HEADING_RE.match(line)
        if heading:
            title = heading.group(2).strip()
            # A version heading (`## [1.2.3]`) is not a category
            if not title or _VERSION_HEADING_RE.match(title):
                current_key = None
                continue
            key = _make_safe_key(title, len(order))
            if key not in detected:
                detected[key] = {'title': title, 'items': []}
                order.append(key)
            current_key = key
            continue

        if current_key is None:
            continue

        bullet = _BULLET_RE.match(line)
        if bullet:
            item = bullet.group(1).strip()
            if item:
                detected[current_key]['items'].append(item)

    # Headings without a single item mean this is not the format; hand over to the next parser
    if not any(entry['items'] for entry in detected.values()):
        return {}

    return detected


def _parse_markdown_lenient(md_content: str) -> dict:
    """
    Lenient parser: copes with format variants.

    Supports:
    - 1-8 spaces of indentation (tabs included)
    - optional bold (**Title** or Title)
    - various list markers (*, -, +)
    """
    content = md_content.replace('\t', '    ')
    detected: dict[str, dict] = {}

    # Pattern: category + nested items
    pattern = r'(?:^|\n)([\*\-\+])\s*(\*\*)?([^\*\n]+?)(\*\*)?\s*\n((?:(?:^|\n)\s{1,8}[\*\-\+]\s+.+)*)'
    matches = re.findall(pattern, content, re.MULTILINE)

    for idx, (marker, bold_start, category_title, bold_end, items_text) in enumerate(matches):
        category_title = category_title.strip()

        # Extract items
        items = re.findall(r'(?:^|\n)\s{1,8}[\*\-\+]\s+(.+)', items_text, re.MULTILINE)
        items = [item.strip() for item in items if item.strip()]

        if not category_title and not items:
            continue

        # A title that long is not a category
        if len(category_title) > 100:
            continue

        safe_key = _make_safe_key(category_title, idx)
        detected[safe_key] = {
            'title': category_title,
            'items': items,
        }

    return detected


def _parse_markdown_heuristic(md_content: str) -> dict:
    """
    Heuristic parser: infer categories/items line by line.

    Rules:
    1. Bold text (**...**) -> category
    2. Indented line -> item
    """
    lines = md_content.split('\n')
    detected: dict[str, dict] = {}
    current_key = None

    for line in lines:
        stripped = line.strip()

        if not stripped or stripped.startswith('<!--') or stripped.startswith('##'):
            continue

        # Bold text -> category
        bold_match = re.search(r'\*\*([^\*]+)\*\*', stripped)
        if bold_match:
            title = bold_match.group(1).strip()
            title = re.sub(r'^[\*\-\+\d\.]+\s*', '', title).strip()

            if title and len(title) < 100:
                current_key = _make_safe_key(title, len(detected))
                detected[current_key] = {'title': title, 'items': []}
            continue

        # Indented line -> item
        if line.startswith((' ', '\t')) and stripped:
            item = re.sub(r'^[\*\-\+\d\.]+\s*', '', stripped).strip()
            item = re.sub(r'<[^>]+>', '', item).strip()

            if current_key and item and len(item) > 3:
                detected[current_key]['items'].append(item)

    # Drop empty categories
    return {k: v for k, v in detected.items() if v.get('items')}


# ------------------------ 3-tier rule-based fallback parser ------------------------

# The tier-1 pattern captures the title in the same regex — the " : type : " marker
# (the colon before the type must be preceded by a space) is the only separator, so a
# bare colon inside the title ("v1:2" etc.) does not cut it short. Do not re-split.
# Types are case-insensitive (per Conventional Commits). `!` marks a breaking change.
_TIER1_RE = re.compile(r'^(.+?)\s:\s*(feat|fix|chore|docs|refactor|test)\s*(!)?\s*:\s*(.+)$', re.IGNORECASE)
_TRAILING_URL_RE = re.compile(r'\s*https?://\S+$')
# A space before the colon, as in `feat : text`, is common, so it is allowed.
_TIER2_RE = re.compile(
    r'^(feat|fix|chore|docs|refactor|test|perf|style|build|ci)(\([^)]*\))?\s*(!)?\s*:\s*(.+)$',
    re.IGNORECASE,
)
_TIER2_BUCKET_MAP = {
    'feat': 'feat',
    'fix': 'fix',
    'chore': 'chore',
    'docs': 'docs',
    'refactor': 'refactor',
    'test': 'test',
    'perf': 'perf',
    'style': 'chore',
    'build': 'chore',
    'ci': 'chore',
}

_FALLBACK_BUCKET_KEYS = ('breaking', 'feat', 'fix', 'perf', 'chore', 'docs', 'refactor', 'test', 'deps', 'changes', 'wip')

# Dependency updates (Dependabot, Renovate, ...) and work-in-progress commits blur the notes when mixed with regular changes.
_DEPS_SCOPE_RE = re.compile(r'^\(deps(?:-dev)?\)$', re.IGNORECASE)
_DEPS_FREEFORM_RE = re.compile(r'^Bump \S+ from \S+ to \S+', re.IGNORECASE)
_WIP_RE = re.compile(r'^\[?wip\b', re.IGNORECASE)

# Used only for the bump level — a `!` marker after a standard type and a body footer
# `BREAKING CHANGE:` are the breaking signals.
# A `!` after a non-standard word such as `hotfix!:` / `WIP!:` is not accepted, since it would
# cause a hard-to-undo major bump.
# The footer is only visible when body lines are part of the commit list (with subjects only, just the `!` marker counts).
_BREAKING_FOOTER_RE = re.compile(r'^BREAKING[ -]CHANGE\s*:\s*(.*)$')


def _is_breaking(line: str) -> bool:
    if _BREAKING_FOOTER_RE.match(line):
        return True
    tier1 = _TIER1_RE.match(line)
    if tier1:
        return bool(tier1.group(3))
    tier2 = _TIER2_RE.match(line)
    return bool(tier2 and tier2.group(3))


def classify_commits(lines: list[str]) -> dict:
    """
    Classify commit subjects with a 3-tier rule set.

    Tier 1: title convention — "title : type : text [URL]"
    Tier 2: Conventional Commits — "type(scope)!: text"
            (style/build/ci -> chore, chore(deps)/build(deps) -> deps bucket)
    Tier 3: lines matching neither go to the "changes" bucket (free form, Bump... -> deps, WIP -> wip)
    `!` markers and BREAKING CHANGE footers are collected in the "breaking" bucket.

    Excluded (filtered before matching): lines containing [skip ci], lines starting with "Merge ", blank lines.
    """
    classified: dict[str, list[str]] = {key: [] for key in _FALLBACK_BUCKET_KEYS}

    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            continue
        if '[skip ci]' in line:
            continue
        if line.startswith('Merge '):
            continue
        footer = _BREAKING_FOOTER_RE.match(line)
        if footer:
            if footer.group(1).strip():
                classified['breaking'].append(footer.group(1).strip())
            continue

        # Tier 1 runs before tier 2 — trade-off: the "title : feat : text" format cannot
        # overlap with "feat: ..." Conventional Commits (a title must precede the type),
        # but a line with a title that happens to contain " : type : " is settled as
        # tier 1 with no chance for tier-2 interpretation. For repos using this
        # convention that is the intended priority.
        tier1 = _TIER1_RE.match(line)
        if tier1:
            title = tier1.group(1).strip()
            commit_type = tier1.group(2).lower()
            desc = tier1.group(4).strip()
            # A trailing issue URL on a commit is noise in the release notes — remove it.
            desc = _TRAILING_URL_RE.sub('', desc).strip()
            # A breaking commit justifies a major bump, so it gets its own section.
            bucket = 'breaking' if tier1.group(3) else commit_type
            classified[bucket].append(f"{title} — {desc}")
            continue

        tier2 = _TIER2_RE.match(line)
        if tier2:
            commit_type, scope, desc = tier2.group(1).lower(), tier2.group(2), tier2.group(4)
            if tier2.group(3):
                bucket = 'breaking'
            elif commit_type in ('chore', 'build') and scope and _DEPS_SCOPE_RE.match(scope):
                bucket = 'deps'
            else:
                bucket = _TIER2_BUCKET_MAP[commit_type]
            classified[bucket].append(desc.strip())
            continue

        if _DEPS_FREEFORM_RE.match(line):
            classified['deps'].append(line)
        elif _WIP_RE.match(line):
            classified['wip'].append(line)
        else:
            classified['changes'].append(line)

    return classified


# Section titles come from the message catalog so they follow the configured language;
# resolved lazily (not at import time) so the language can be switched per run.
_FALLBACK_SECTION_KEYS = ('breaking', 'feat', 'fix', 'perf', 'docs', 'refactor', 'test', 'deps', 'changes', 'wip')


def _section_title(bucket_key: str) -> str:
    return t(f"changelog.section_{bucket_key}")


def render_fallback_md(classified: dict, version: str) -> str:
    """Render the classified commit dict as Markdown release notes."""
    lines: list[str] = [f"## [{version}]", ""]

    def add_section(bucket_key):
        items = classified.get(bucket_key) or []
        if not items:
            return
        lines.append(_section_title(bucket_key))
        for item in items:
            lines.append(f"- {item}")
        lines.append("")

    for bucket_key in ('breaking', 'feat', 'fix', 'perf', 'docs', 'refactor', 'test', 'deps'):
        add_section(bucket_key)

    chore_items = list(classified.get('chore') or [])
    changes_items = list(classified.get('changes') or [])
    merged = chore_items + changes_items
    if merged:
        lines.append(_section_title('changes'))
        for item in merged:
            lines.append(f"- {item}")
        lines.append("")

    add_section('wip')

    return "\n".join(lines).rstrip() + "\n"


def classify_bump_level(lines: list[str]) -> str:
    """Decide the semver bump level from commit subjects, rule-based.

    - a `!` marker after a standard type, or a `BREAKING CHANGE:` footer -> major
    - `feat:` (same criterion as the feat bucket of classify_commits) -> minor
    - anything else (including no match) -> patch
    """
    for raw_line in lines:
        line = raw_line.strip()
        if not line or '[skip ci]' in line or line.startswith('Merge '):
            continue
        if _is_breaking(line):
            return 'major'
    classified = classify_commits(lines)
    return 'minor' if classified.get('feat') else 'patch'


def _bump_ai_prompt_prefix() -> str:
    # The reply tokens MINOR/PATCH are parsed by code, so every language must ask for exactly those.
    return t("changelog.bump_prompt_prefix")


def _ai_assisted_minor_upgrade(unclassified_lines: list[str]) -> bool:
    """When the rules say patch, ask the model only whether the unclassified free-form
    commits justify a minor upgrade. The model can never produce a major — major only ever
    trusts an explicit `!` marker (already settled in classify_bump_level). If the reply
    is not exactly 'MINOR' or the call fails, always return False (keep the rule result, patch)."""
    if not unclassified_lines:
        return False
    prompt = _bump_ai_prompt_prefix() + "\n".join(f"- {line}" for line in unclassified_lines)

    settings = _user_api_settings()
    if settings:
        api_key, base_url, model = settings
        try:
            return call_openai_compatible(base_url, api_key, model, prompt).strip() == 'MINOR'
        except Exception as e:
            _warn_engine_failure(f"[warn] bump AI assist failed: {e}")

    if _copilot_enabled():
        try:
            return call_copilot_cli(prompt).strip() == 'MINOR'
        except Exception as e:
            _warn_engine_failure(f"[warn] bump AI assist (copilot) failed: {e}")
    return False


def filter_release_issue_numbers(commit_shas: set[str], merged_prs: list[dict]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for pr in merged_prs:
        merge_commit = pr.get('mergeCommit') or {}
        oid = merge_commit.get('oid')
        if not oid or oid not in commit_shas:
            continue
        head_ref = pr.get('headRefName') or ''
        issue_num = issue_helper.extract_issue_number_from_branch(head_ref)
        if not issue_num or issue_num in seen:
            continue
        seen.add(issue_num)
        result.append(issue_num)
    return result


def cmd_collect_issue_closes(commit_shas_file: str, merged_prs_file: str) -> int:
    with open(commit_shas_file, encoding='utf-8') as f:
        commit_shas = {line.strip() for line in f if line.strip()}

    with open(merged_prs_file, encoding='utf-8') as f:
        merged_prs = json.load(f)

    issue_numbers = filter_release_issue_numbers(commit_shas, merged_prs)
    print(','.join(issue_numbers))
    return 0


def cmd_classify_bump(commits_file: str) -> int:
    """Read a commit list file and print the semver bump level (major/minor/patch) as the last stdout line.

    Rules first (feat->minor, ! marker->major, else patch). If the rule result is patch
    and there are unclassified free-form commits, ask the model only whether to upgrade
    patch->minor (the model can never produce a major).
    """
    try:
        with open(commits_file, 'r', encoding='utf-8') as f:
            commit_lines = [line.rstrip('\n').rstrip('\r') for line in f]
    except Exception:
        commit_lines = []

    bump = classify_bump_level(commit_lines)
    if bump == 'patch':
        classified = classify_commits(commit_lines)
        if _ai_assisted_minor_upgrade(classified.get('changes') or []):
            bump = 'minor'

    print(bump)
    return 0


# ------------------------ Subcommand implementations ------------------------

def cmd_update_from_summary() -> int:
    """Parse Markdown from pr_body.md and update CHANGELOG.json."""
    version = os.environ.get('VERSION')
    # PROJECT_TYPES (csv) is the only input — the singular PROJECT_TYPE fallback is gone
    project_types_csv = os.environ.get('PROJECT_TYPES', '')
    project_types = [t.strip() for t in project_types_csv.split(',') if t.strip()]
    today = os.environ.get('TODAY')
    pr_number_raw = os.environ.get('PR_NUMBER')
    timestamp = os.environ.get('TIMESTAMP')

    try:
        pr_number = int(pr_number_raw) if pr_number_raw else None
    except ValueError:
        pr_number = None

    # Find the input file (pr_body.md first, summary_section.html as fallback)
    input_file = None
    for filename in ['pr_body.md', 'summary_section.html']:
        if os.path.isfile(filename):
            input_file = filename
            break

    if not input_file:
        print(t("changelog.err_no_input"))
        return 1

    try:
        with open(input_file, 'r', encoding='utf-8') as f:
            content = f.read()

        print(t("changelog.input_file", input_file=input_file))
        print(t("changelog.file_size", size=len(content)))

        # Markdown parsing (unified)
        print(t("changelog.parse_start"))
        categories = _parse_summary_markdown(content)

        parse_method = 'markdown' if categories else 'markdown_failed'
        if categories:
            print(t("changelog.parse_ok", n=len(categories)))
        else:
            print(t("changelog.parse_failed"))

        # Build raw_summary (noise removed)
        raw_summary = _strip_version_headings(_clean_summary_noise(content))

        # Build the release record
        new_release = {
            "version": version,
            "project_types": project_types,
            "date": today,
            "pr_number": pr_number,
            "raw_summary": raw_summary,
            "parsed_changes": categories or {},
            "parse_method": parse_method,
        }

        # Print the parse result
        print(t("changelog.result_header"))
        print(t("changelog.result_method", method=parse_method))
        print(t("changelog.result_raw_len", n=len(raw_summary)))
        print(t("changelog.result_categories", n=len(categories)))
        for key, value in categories.items():
            title = value.get('title', key)
            items_count = len(value.get('items', []))
            print(t("changelog.result_category_item", title=title, n=items_count))

        # Update CHANGELOG.json
        try:
            with open('CHANGELOG.json', 'r', encoding='utf-8') as f:
                changelog_data = json.load(f)
        except json.JSONDecodeError as e:
            # Overwriting a file broken by e.g. merge-conflict markers with a fresh structure would erase all history.
            print(t("changelog.err_json_unreadable", error=e))
            print(t("changelog.err_json_annotation", error=e), file=sys.stderr)
            return 1
        except FileNotFoundError:
            changelog_data = {
                "metadata": {
                    "lastUpdated": timestamp,
                    "currentVersion": version,
                    "projectTypes": project_types,
                    "totalReleases": 0,
                },
                "releases": [],
            }

        # Defensive: the file may exist in an irregular scaffold structure ({"versions": []})
        # without metadata/releases keys — never block a release because of it
        if not isinstance(changelog_data, dict):
            changelog_data = {}
        changelog_data.setdefault("metadata", {})

        changelog_data["metadata"]["lastUpdated"] = timestamp
        changelog_data["metadata"]["currentVersion"] = version
        changelog_data["metadata"]["projectTypes"] = project_types
        # Replace the same version — so re-running the workflow does not pile up duplicates.
        releases = [
            r for r in (changelog_data.get("releases") or [])
            if not (isinstance(r, dict) and str(r.get("version")) == str(version))
        ]
        releases.insert(0, new_release)
        changelog_data["releases"] = releases
        changelog_data["metadata"]["totalReleases"] = len(releases)

        with open('CHANGELOG.json', 'w', encoding='utf-8') as f:
            json.dump(changelog_data, f, indent=2, ensure_ascii=False)

        print(t("changelog.json_updated"))
        return 0

    except Exception as e:
        print(t("changelog.err_update_failed", error=e))
        traceback.print_exc()
        return 1


def cmd_generate_md() -> int:
    """Regenerate CHANGELOG.md from CHANGELOG.json."""
    try:
        with open('CHANGELOG.json', 'r', encoding='utf-8') as f:
            data = json.load(f)

        with open('CHANGELOG.md', 'w', encoding='utf-8') as f:
            f.write("# Changelog\n\n")

            metadata = data.get('metadata', {})
            current_version = metadata.get('currentVersion', 'Unknown')
            last_updated = metadata.get('lastUpdated', 'Unknown')

            f.write(t("changelog.md_current_version", version=current_version) + "  \n")
            f.write(t("changelog.md_last_updated", updated=last_updated) + "  \n\n")
            f.write("---\n\n")

            for release in data.get('releases', []):
                version = release.get('version', 'Unknown')
                date = release.get('date', 'Unknown')
                pr_number = release.get('pr_number')

                f.write(f"## [{version}] - {date}\n\n")

                if pr_number is not None:
                    f.write(f"**PR:** #{pr_number}  \n\n")

                parsed = release.get('parsed_changes') or {}

                if parsed:
                    # Print the structured data
                    for _, items in parsed.items():
                        if not items:
                            continue
                        if isinstance(items, dict) and 'items' in items:
                            actual_items = items.get('items') or []
                            title = items.get('title') or ''
                        else:
                            actual_items = items
                            title = _normalize_text(_)

                        f.write(f"**{title}**\n")
                        for item in actual_items:
                            f.write(f"- {item}\n")
                        f.write("\n")
                else:
                    # On parse failure, print raw_summary
                    raw_summary = release.get('raw_summary', '').strip()
                    if raw_summary:
                        raw_summary = _strip_version_headings(_clean_summary_noise(raw_summary))
                        if raw_summary:
                            f.write(raw_summary + "\n\n")
                        else:
                            f.write(t("changelog.md_no_changes") + "\n\n")
                    else:
                        f.write(t("changelog.md_no_changes") + "\n\n")

                f.write("---\n\n")

        print(t("changelog.md_regenerated"))
        return 0

    except Exception as e:
        print(t("changelog.err_md_failed", error=e))
        traceback.print_exc()
        return 1


def cmd_export_release_notes(version: str, output_path: str | None) -> int:
    """Build the release notes of the given version from the CHANGELOG."""
    notes_text = ""

    # 1) Try CHANGELOG.json
    try:
        if os.path.isfile('CHANGELOG.json'):
            with open('CHANGELOG.json', 'r', encoding='utf-8') as f:
                changelog = json.load(f)
            releases = changelog.get('releases') or []
            matched = next((r for r in releases if str(r.get('version')) == str(version)), None)
            if matched:
                header = t("changelog.export_header", version=matched.get('version')) + "\n\n"
                parsed_changes = matched.get('parsed_changes') or {}
                if parsed_changes:
                    category_blocks: list[str] = []
                    for _, value in parsed_changes.items():
                        title = (value.get('title') or '').strip()
                        items = [it for it in (value.get('items') or []) if it]
                        if title and items:
                            block = "**" + title + "**\n" + "\n".join("- " + it for it in items)
                            category_blocks.append(block)
                    body = "\n\n".join(category_blocks) if category_blocks else _strip_version_headings((matched.get('raw_summary') or '').strip())
                else:
                    body = _strip_version_headings((matched.get('raw_summary') or '').strip())
                notes_text = (header + (body or "")).strip()
    except Exception as e:
        print(t("changelog.warn_json_notes", version=version, error=e), file=sys.stderr)

    # 2) CHANGELOG.md fallback
    if not notes_text and os.path.isfile('CHANGELOG.md'):
        try:
            with open('CHANGELOG.md', 'r', encoding='utf-8') as f:
                md = f.read()
            pattern = re.compile(rf"^## \[{re.escape(str(version))}\].*$", re.MULTILINE)
            m = pattern.search(md)
            if m:
                start = m.end()
                next_m = re.search(r"^## \[", md[start:], re.MULTILINE)
                section = md[start: start + next_m.start()] if next_m else md[start:]
                # The separator generate-md puts between releases is not note content
                body = re.sub(r'(?:\n\s*-{3,}\s*)+$', '', '\n' + section.strip()).strip()
                notes_text = (t("changelog.export_header", version=version) + "\n\n" + body).strip()
        except Exception as e:
            # Swallowing it silently would make the fixed-text fallback look like normal output with no visible cause.
            print(t("changelog.warn_md_notes", version=version, error=e), file=sys.stderr)

    # 3) Final fallback
    if not notes_text:
        notes_text = t("changelog.export_fallback", version=version)

    if output_path:
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(notes_text)
    else:
        sys.stdout.write(notes_text + "\n")
    return 0


# ------------------------ ai-summary engine chain ------------------------

# Copilot Free/Student accounts reject an explicit model name and only allow auto model selection.
_COPILOT_MODEL = "auto"
_COPILOT_TIMEOUT_SECONDS = 90


def _warn_engine_failure(message: str) -> str:
    """Surface an engine failure as a warning in the Actions run summary (Annotations).
    With plain logs only, the fallback reason stays hidden until the job log is opened.
    stdout is reserved for the result JSON contract, so this writes to stderr. Returns the reason squeezed onto one line."""
    reason = " ".join(str(message).split())[:200]
    escaped = reason.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
    print(f"::warning::{escaped}", file=sys.stderr)
    return reason


def _user_api_settings() -> tuple[str, str, str] | None:
    """Settings for the user-supplied model tier. AI_API_KEY, AI_API_BASE_URL and AI_MODEL must all be present.

    If only the key is set and URL/model are empty, the key is sent nowhere: warn and skip
    (prevents the user's key from flowing to a retired default endpoint)."""
    api_key = os.environ.get('AI_API_KEY')
    base_url = os.environ.get('AI_API_BASE_URL')
    model = os.environ.get('AI_MODEL')
    if not api_key:
        # If only the variables are registered and the secret is missing, it falls to the rule summary unnoticed and the user thinks the setup worked
        if base_url or model:
            print(t("changelog.warn_missing_key"), file=sys.stderr)
        return None
    if not base_url or not model:
        print(t("changelog.warn_missing_url_model"), file=sys.stderr)
        return None
    return api_key, base_url, model


def _copilot_enabled() -> bool:
    """True only when copilot_ai is on in version.yml (passed by the workflow as COPILOT_AI) and a token is present."""
    return os.environ.get('COPILOT_AI', '').strip().lower() == 'true' and bool(os.environ.get('GITHUB_TOKEN'))


def call_copilot_cli(prompt: str) -> str:
    """Call the Copilot CLI for text generation only and return the response text.

    The prompt already carries all needed information, so every tool capability is blocked:
    run in an empty temp directory, deny the shell/write/url tools, and turn off the
    built-in MCPs and custom-instruction loading.
    Failures (non-zero exit, timeout, missing CLI) are raised so the caller falls back."""
    with tempfile.TemporaryDirectory() as workdir:
        result = subprocess.run(
            [
                'copilot', '-p', prompt, '-s',
                '--no-ask-user', '--no-color', '--no-custom-instructions', '--disable-builtin-mcps',
                '--deny-tool=shell', '--deny-tool=write', '--deny-tool=url',
                '--model', _COPILOT_MODEL,
            ],
            cwd=workdir, stdin=subprocess.DEVNULL,
            capture_output=True, text=True, timeout=_COPILOT_TIMEOUT_SECONDS,
        )
    if result.returncode != 0:
        raise RuntimeError(f"copilot exited with {result.returncode}: {result.stderr.strip()[:200]}")
    return result.stdout


def _is_valid_copilot_summary(text: str) -> bool:
    """Minimal check that the text is the Markdown format the prompt asked for.

    A response with no section heading ('### ') at all, or one starting with a code fence
    (wrapped as a whole), is not used as release notes."""
    stripped = text.strip()
    if not stripped or stripped.startswith('```'):
        return False
    return any(line.startswith('### ') for line in stripped.splitlines())


def _build_ai_prompt(commit_lines: list[str], pr_title: str | None, version: str, diff_stat: str | None = None) -> str:
    """Build the release-summary prompt sent to the model (in the configured language).

    The requested output format matches the rule-based fallback renderer
    (render_fallback_md) — so downstream consumers of the release notes see a single
    format regardless of the engine.
    """
    titles = {key: _section_title(key) for key in _FALLBACK_SECTION_KEYS}
    parts = [
        t("changelog.prompt_intro"),
        t("changelog.prompt_format", version=version),
        t("changelog.prompt_sections_intro"),
        t("changelog.prompt_names_1", **titles),
        t("changelog.prompt_names_2", **titles),
        t("changelog.prompt_breaking", **titles),
        t("changelog.prompt_bullets"),
    ]
    if pr_title:
        parts.append(t("changelog.prompt_pr_title", title=pr_title))
    if diff_stat and diff_stat.strip():
        parts.append(t("changelog.prompt_diff_stat"))
        parts.append(diff_stat.strip())
    parts.append(t("changelog.prompt_commits"))
    parts.extend(f"- {line}" for line in commit_lines)
    return "\n".join(parts)


def call_openai_compatible(base_url: str, token: str, model: str, prompt: str) -> str:
    """Call an OpenAI-compatible /chat/completions endpoint and return the response text."""
    url = base_url.rstrip('/') + "/chat/completions"
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    return body["choices"][0]["message"]["content"]


def cmd_ai_summary(commits_file: str, version: str, output_path: str, pr_title: str | None, diff_stat_file: str | None = None) -> int:
    """Read the commit list and build a release summary with the model (preferred) or the rule-based fallback."""
    try:
        with open(commits_file, 'r', encoding='utf-8') as f:
            commit_lines = [line.rstrip('\n').rstrip('\r') for line in f]
    except Exception as e:
        print(t("changelog.warn_commits_unreadable", error=e), file=sys.stderr)
        commit_lines = []

    diff_stat = None
    if diff_stat_file:
        try:
            with open(diff_stat_file, 'r', encoding='utf-8') as f:
                diff_stat = f.read()
        except Exception:
            diff_stat = None

    engine = None
    summary_text = None
    failures: list[str] = []
    prompt = _build_ai_prompt(commit_lines, pr_title, version, diff_stat)

    settings = _user_api_settings()
    if settings:
        ai_api_key, ai_base_url, ai_model = settings
        try:
            candidate = call_openai_compatible(ai_base_url, ai_api_key, ai_model, prompt)
            if candidate and candidate.strip():
                summary_text = candidate
                engine = "user-api"
            else:
                failures.append(_warn_engine_failure("[warn] user-api failed: empty content in response"))
        except Exception as e:
            failures.append(_warn_engine_failure(f"[warn] user-api failed: {e}"))

    if summary_text is None and _copilot_enabled():
        try:
            candidate = call_copilot_cli(prompt)
            if _is_valid_copilot_summary(candidate):
                summary_text = candidate
                engine = "copilot"
            else:
                failures.append(_warn_engine_failure("[warn] copilot failed: empty or not in the requested Markdown format"))
        except Exception as e:
            failures.append(_warn_engine_failure(f"[warn] copilot failed: {e}"))

    if summary_text is None:
        classified = classify_commits(commit_lines)
        summary_text = render_fallback_md(classified, version)
        engine = "fallback"

    write_ok = True
    try:
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(summary_text)
    except Exception as e:
        # Do not hide that the file could not be written — report ok=false and
        # rescue-print the summary text to stderr. Keep exit code 0
        # (contract so the workflow pipeline is not cut).
        write_ok = False
        print(f"[warn] output write failed: {e}", file=sys.stderr)
        print(summary_text, file=sys.stderr)

    result = {"ok": write_ok, "engine": engine, "output": output_path}
    if engine == "fallback" and failures:
        # Passed along so the workflow can append the reason to the engine line of the PR comment.
        result["fallback_reason"] = "; ".join(r.replace("[warn] ", "", 1) for r in failures)
    print(json.dumps(result))
    return 0


# ------------------------------- CLI -------------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog='changelog_manager',
        description=t('changelog.cli_description'),
        add_help=True
    )
    sub = parser.add_subparsers(dest='command', required=True)

    sub.add_parser('update-from-summary', help=t('changelog.cli_update_help'))
    sub.add_parser('generate-md', help=t('changelog.cli_generate_help'))

    p_classify_bump = sub.add_parser('classify-bump', help=t('changelog.cli_classify_help'))
    p_classify_bump.add_argument('--commits-file', required=True, help=t('changelog.cli_commits_file_help'))

    p_export = sub.add_parser('export', help=t('changelog.cli_export_help'))
    p_export.add_argument('--version', required=True, help=t('changelog.cli_version_help'))
    p_export.add_argument('--output', help=t('changelog.cli_output_help'))

    p_ai_summary = sub.add_parser('ai-summary', help=t('changelog.cli_ai_summary_help'))
    p_ai_summary.add_argument('--commits-file', required=True, help=t('changelog.cli_commits_file_help'))
    p_ai_summary.add_argument('--version', required=True, help=t('changelog.cli_version_help'))
    p_ai_summary.add_argument('--output', required=True, help=t('changelog.cli_summary_output_help'))
    p_ai_summary.add_argument('--pr-title', help=t('changelog.cli_pr_title_help'))
    p_ai_summary.add_argument('--diff-stat-file', help=t('changelog.cli_diff_stat_help'))

    p_collect = sub.add_parser('collect-issue-closes', help=t('changelog.cli_collect_help'))
    p_collect.add_argument('--commit-shas-file', required=True, help=t('changelog.cli_shas_help'))
    p_collect.add_argument('--merged-prs-file', required=True, help=t('changelog.cli_prs_help'))

    args = parser.parse_args(argv)

    if args.command == 'update-from-summary':
        return cmd_update_from_summary()
    if args.command == 'generate-md':
        return cmd_generate_md()
    if args.command == 'export':
        return cmd_export_release_notes(args.version, args.output)
    if args.command == 'classify-bump':
        return cmd_classify_bump(args.commits_file)
    if args.command == 'ai-summary':
        return cmd_ai_summary(args.commits_file, args.version, args.output, args.pr_title, args.diff_stat_file)
    if args.command == 'collect-issue-closes':
        return cmd_collect_issue_closes(args.commit_shas_file, args.merged_prs_file)
    return 2


if __name__ == '__main__':
    sys.exit(main())
