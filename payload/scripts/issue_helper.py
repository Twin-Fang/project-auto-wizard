#!/usr/bin/env python3
"""
issue_helper.py — normalizes a GitHub issue's title/URL into a branch name
and commit message, posts/updates a comment on the issue with both, and
optionally creates the branch (stdlib only).

This script is copied into user repos (.github/scripts/) by
project-auto-wizard and is triggered by the `issues: [opened, edited]`
event via PROJECT-COMMON-ISSUE-HELPER.yaml.

Python rewrite of Chuseok22/github-issue-helper (same author, a repo
without a LICENSE file) — ported to remove the external Action dependency
(project-auto-wizard#68) and drop the Chuseok22-branded comment output.

Usage:
    issue_helper.py run

Reads GITHUB_EVENT_PATH (issues event JSON), GITHUB_TOKEN,
GITHUB_REPOSITORY (all auto-provided by the Actions runner except
GITHUB_TOKEN, which the workflow wires from secrets.GITHUB_TOKEN), and
ISSUE_HELPER_* env vars set by the workflow (branch_prefix,
max_branch_length, commit_template, create_branch, base_branch,
comment_marker).

Contract:
    - Exit 0 on success, including the no-op case (event isn't a
      relevant issues action).
    - Exit 1 on a configuration/runtime failure (missing token, GitHub
      API error, etc.) — mirrors the original Action's core.setFailed.
    - Exit 2 on argument-parsing errors (argparse default).
"""

import argparse
import json
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
COMMENT_MARKER_DEFAULT = "<!-- project-auto-wizard issue helper -->"
API_BASE = "https://api.github.com"


def log(message):
    print(message, file=sys.stderr)


# ===================================================================
# 정규화 (순수 함수 — GitHub API 호출 없음)
# ===================================================================

def extract_issue_number(issue_url):
    trimmed = issue_url.strip().rstrip("/")
    parts = trimmed.split("/")
    return parts[-1] if parts and parts[-1] else ""


_TAG_RE = re.compile(r"\[.*?]")
_VARIATION_SELECTOR = "️"
_ZWJ = "‍"


def _is_removable_char(ch):
    # 원본(TS) 정규식 \p{So}|\p{C}|️|‍ 이식.
    # Python re는 \p{...}를 지원하지 않으므로 unicodedata.category()로 대체:
    # "So"(Symbol, other) 또는 "C"로 시작(Cc/Cf/Co/Cs/Cn)하면 제거 대상.
    # 변형 선택자(U+FE0F, 카테고리 Mn)는 위 두 조건에 안 걸리므로 명시적으로 추가.
    if ch in (_VARIATION_SELECTOR, _ZWJ):
        return True
    category = unicodedata.category(ch)
    return category == "So" or category.startswith("C")


def extract_issue_title(raw_title):
    title = _TAG_RE.sub("", raw_title).strip()
    title = "".join(ch for ch in title if not _is_removable_char(ch)).strip()
    return title if title else raw_title.strip()


def format_date_yyyymmdd(dt):
    return dt.strftime("%Y%m%d")


_NON_ALNUM_KO_RE = re.compile(r"[^a-zA-Z0-9가-힣]")
_MULTI_UNDERSCORE_RE = re.compile(r"_+")


def normalize_title(title):
    normalized = _NON_ALNUM_KO_RE.sub("_", title)
    normalized = _MULTI_UNDERSCORE_RE.sub("_", normalized)
    return normalized.strip("_")


def create_branch_name(issue_title, issue_number, date_yyyymmdd, branch_prefix, max_branch_length):
    normalized_title = normalize_title(issue_title)
    base = f"{date_yyyymmdd}_#{issue_number}_{normalized_title}"
    limited_base = base[:max_branch_length] if max_branch_length > 0 else base
    return f"{branch_prefix}{limited_base}"


def render_commit_message(template, issue_title, issue_url, issue_number, branch_name, date_yyyymmdd):
    result = template
    result = result.replace("${issueTitle}", issue_title)
    result = result.replace("${issueUrl}", issue_url)
    result = result.replace("${issueNumber}", issue_number)
    result = result.replace("${branchName}", branch_name)
    result = result.replace("${date}", date_yyyymmdd)
    return result.strip()


def normalize_all(title, issue_url, issue_number, date_yyyymmdd, branch_prefix, max_branch_length, commit_template):
    normalized_title = normalize_title(title)
    branch_name = create_branch_name(title, issue_number, date_yyyymmdd, branch_prefix, max_branch_length)
    commit_message = render_commit_message(
        commit_template, normalized_title, issue_url, issue_number, branch_name, date_yyyymmdd,
    )
    return branch_name, commit_message


if __name__ == "__main__":
    sys.exit(0)
