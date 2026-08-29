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
    issue_helper.py extract-branch-issue <branch_name>
    issue_helper.py link-pr-issues --pr <number> --issue-numbers <csv> [--replace]

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


_BRANCH_ISSUE_HASH_RE = re.compile(r"#(\d+)")
_BRANCH_ISSUE_WORD_RE = re.compile(r"issues?[-_/](\d+)", re.IGNORECASE)


def extract_issue_number_from_branch(branch_name):
    match = _BRANCH_ISSUE_HASH_RE.search(branch_name)
    if match:
        return match.group(1)
    match = _BRANCH_ISSUE_WORD_RE.search(branch_name)
    return match.group(1) if match else None


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


# ===================================================================
# PR 본문 이슈 연결 (Closes #N) — 마커 블록 삽입/치환
# ===================================================================

LINK_MARKER_START = "<!-- auto-issue-link:start -->"
LINK_MARKER_END = "<!-- auto-issue-link:end -->"
_LINK_BLOCK_RE = re.compile(re.escape(LINK_MARKER_START) + r".*?" + re.escape(LINK_MARKER_END), re.S)


def build_issue_links_block(issue_numbers):
    lines = "\n".join(f"Closes #{n}" for n in issue_numbers)
    return f"{LINK_MARKER_START}\n{lines}\n{LINK_MARKER_END}"


def upsert_issue_links_in_body(body, issue_numbers, replace_existing):
    if not issue_numbers:
        return body, False

    # 완전한 START...END 블록이 있을 때만 "마커 있음"으로 취급한다 — START만
    # 있고 END가 없는 손상된 상태를 마커로 오인하면 _LINK_BLOCK_RE.sub()가
    # 아무 것도 치환하지 못한 채 changed=True만 반환해, replace_existing=True
    # 경로(release PR)에서 새 이슈 목록이 영구히 반영되지 않는 채로 조용히
    # "성공"처럼 보이는 버그가 생긴다.
    has_full_block = _LINK_BLOCK_RE.search(body) is not None
    if has_full_block and not replace_existing:
        return body, False

    block = build_issue_links_block(issue_numbers)
    if has_full_block:
        new_body = _LINK_BLOCK_RE.sub(block, body)
    else:
        separator = "\n\n" if body.strip() else ""
        new_body = f"{body}{separator}{block}"
    return new_body, True


# ===================================================================
# GitHub REST API (urllib.request + GITHUB_TOKEN, 서드파티 의존 없음)
# ===================================================================

def _headers(token, has_body):
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "project-auto-wizard-issue-helper",
    }
    if has_body:
        headers["Content-Type"] = "application/json"
    return headers


def _api_request(method, url, token, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=_headers(token, data is not None))
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else None), resp.headers.get("Link")
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            parsed = json.loads(raw) if raw else None
        except json.JSONDecodeError:
            parsed = None
        return e.code, parsed, None


def _find_next_link(link_header):
    if not link_header:
        return None
    for part in link_header.split(","):
        segment = part.strip()
        if 'rel="next"' in segment and "<" in segment and ">" in segment:
            return segment[segment.index("<") + 1:segment.index(">")]
    return None


def list_comments(owner, repo, issue_number, token):
    comments = []
    url = f"{API_BASE}/repos/{owner}/{repo}/issues/{issue_number}/comments?per_page=100"
    while url:
        status, page, link = _api_request("GET", url, token)
        if status >= 400:
            raise RuntimeError(f"이슈 코멘트 조회 실패({status}): {issue_number}")
        comments.extend(page or [])
        url = _find_next_link(link)
    return comments


def upsert_comment(owner, repo, issue_number, token, marker, body):
    comments = list_comments(owner, repo, issue_number, token)
    existing = next((c for c in comments if marker in (c.get("body") or "")), None)
    if existing:
        status, _, _ = _api_request(
            "PATCH", f"{API_BASE}/repos/{owner}/{repo}/issues/comments/{existing['id']}", token, {"body": body},
        )
        if status >= 400:
            raise RuntimeError(f"코멘트 갱신 실패({status})")
        log("기존 코멘트를 갱신했습니다.")
    else:
        status, _, _ = _api_request(
            "POST", f"{API_BASE}/repos/{owner}/{repo}/issues/{issue_number}/comments", token, {"body": body},
        )
        if status >= 400:
            raise RuntimeError(f"코멘트 작성 실패({status})")
        log("새 코멘트를 작성했습니다.")


def create_branch_if_needed(owner, repo, branch_name, base_branch, create_branch, token):
    if not create_branch:
        return

    base = base_branch
    if not base:
        status, repo_data, _ = _api_request("GET", f"{API_BASE}/repos/{owner}/{repo}", token)
        if status >= 400:
            raise RuntimeError(f"레포 정보 조회 실패({status})")
        base = repo_data["default_branch"]

    status, ref_data, _ = _api_request("GET", f"{API_BASE}/repos/{owner}/{repo}/git/ref/heads/{base}", token)
    if status >= 400:
        raise RuntimeError(f"base 브랜치 ref 조회 실패({base}, {status})")
    sha = ref_data["object"]["sha"]

    status, _, _ = _api_request(
        "POST", f"{API_BASE}/repos/{owner}/{repo}/git/refs", token,
        {"ref": f"refs/heads/{branch_name}", "sha": sha},
    )
    if status == 422:
        log(f"브랜치가 이미 존재함, 건너뜀: {branch_name}")
        return
    if status >= 400:
        raise RuntimeError(f"브랜치 생성 실패({branch_name}, {status})")
    log(f"브랜치 생성됨: {branch_name}")


def link_pr_issues(owner, repo, pr_number, issue_numbers, token, replace_existing):
    status, pr_data, _ = _api_request("GET", f"{API_BASE}/repos/{owner}/{repo}/pulls/{pr_number}", token)
    if status >= 400:
        raise RuntimeError(f"PR 조회 실패({status}): {pr_number}")
    body = pr_data.get("body") or ""

    new_body, changed = upsert_issue_links_in_body(body, issue_numbers, replace_existing)
    if not changed:
        log(f"이슈 연결 변경 없음 — 건너뜀 (PR #{pr_number})")
        return

    status, _, _ = _api_request(
        "PATCH", f"{API_BASE}/repos/{owner}/{repo}/pulls/{pr_number}", token, {"body": new_body},
    )
    if status >= 400:
        raise RuntimeError(f"PR 본문 갱신 실패({status}): {pr_number}")
    log(f"이슈 연결 완료: {', '.join(f'#{n}' for n in issue_numbers)} (PR #{pr_number})")


# ===================================================================
# 이벤트 처리 / CLI
# ===================================================================

def _bool_env(name, default):
    val = os.environ.get(name)
    if val is None or val.strip() == "":
        return default
    return val.strip().lower() == "true"


def cmd_run():
    event_path = os.environ.get("GITHUB_EVENT_PATH")
    if not event_path:
        log("ERROR: GITHUB_EVENT_PATH가 없습니다.")
        return 1
    try:
        with open(event_path, "r", encoding="utf-8") as f:
            payload = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        log(f"ERROR: 이벤트 페이로드를 읽을 수 없습니다: {e}")
        return 1

    action = payload.get("action")
    issue = payload.get("issue") or {}
    changes = payload.get("changes") or {}
    is_opened = action == "opened"
    is_edited_with_title = action == "edited" and "title" in changes

    if not is_opened and not is_edited_with_title:
        log("열림 또는 제목 변경 이벤트가 아님 → 종료")
        return 0

    repo_full = os.environ.get("GITHUB_REPOSITORY", "")
    if "/" not in repo_full or repo_full.count("/") != 1 or not all(repo_full.split("/")):
        log(f"ERROR: GITHUB_REPOSITORY 형식이 올바르지 않습니다: {repo_full!r}")
        return 1
    owner, repo = repo_full.split("/", 1)

    token = os.environ.get("GITHUB_TOKEN", "").strip()
    if not token:
        log("ERROR: GITHUB_TOKEN이 없습니다.")
        return 1

    raw_title = issue.get("title", "")
    issue_url = issue.get("html_url", "")
    issue_number_str = extract_issue_number(issue_url) or str(issue.get("number", ""))

    date_yyyymmdd = format_date_yyyymmdd(datetime.now(KST))

    comment_marker = os.environ.get("ISSUE_HELPER_COMMENT_MARKER") or COMMENT_MARKER_DEFAULT
    branch_prefix = os.environ.get("ISSUE_HELPER_BRANCH_PREFIX", "")
    max_branch_length = int(os.environ.get("ISSUE_HELPER_MAX_BRANCH_LENGTH") or "120")
    commit_template = (
        os.environ.get("ISSUE_HELPER_COMMIT_TEMPLATE")
        or "${issueTitle} : feat : {변경 사항에 대한 설명} ${issueUrl}"
    )
    create_branch = _bool_env("ISSUE_HELPER_CREATE_BRANCH", False)
    base_branch = os.environ.get("ISSUE_HELPER_BASE_BRANCH", "").strip()

    title = extract_issue_title(raw_title)
    branch_name, commit_message = normalize_all(
        title, issue_url, issue_number_str, date_yyyymmdd, branch_prefix, max_branch_length, commit_template,
    )

    body = (
        f"{comment_marker}\n"
        "## Issue Helper\n"
        "### 브랜치명\n"
        "```\n"
        f"{branch_name}\n"
        "```\n\n"
        "### 커밋 메시지\n"
        "```\n"
        f"{commit_message}\n"
        "```"
    )

    upsert_comment(owner, repo, issue["number"], token, comment_marker, body)

    github_output = os.environ.get("GITHUB_OUTPUT")
    if github_output:
        with open(github_output, "a", encoding="utf-8") as f:
            f.write(f"branchName={branch_name}\n")
            f.write(f"commitMessage={commit_message}\n")

    create_branch_if_needed(owner, repo, branch_name, base_branch, create_branch, token)
    return 0


def cmd_link_pr_issues(pr_number, issue_numbers_csv, replace_existing):
    repo_full = os.environ.get("GITHUB_REPOSITORY", "")
    if "/" not in repo_full or repo_full.count("/") != 1 or not all(repo_full.split("/")):
        log(f"ERROR: GITHUB_REPOSITORY 형식이 올바르지 않습니다: {repo_full!r}")
        return 1
    owner, repo = repo_full.split("/", 1)

    token = os.environ.get("GITHUB_TOKEN", "").strip()
    if not token:
        log("ERROR: GITHUB_TOKEN이 없습니다.")
        return 1

    issue_numbers = [n.strip() for n in issue_numbers_csv.split(",") if n.strip()]
    if not issue_numbers:
        log("이슈 번호가 없음 — 건너뜀")
        return 0

    link_pr_issues(owner, repo, pr_number, issue_numbers, token, replace_existing)
    return 0


def build_parser():
    parser = argparse.ArgumentParser(prog="issue_helper.py")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("run")

    p_extract = sub.add_parser("extract-branch-issue")
    p_extract.add_argument("branch_name")

    p_link = sub.add_parser("link-pr-issues")
    p_link.add_argument("--pr", required=True, type=int)
    p_link.add_argument("--issue-numbers", required=True)
    p_link.add_argument("--replace", action="store_true")

    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "run":
            return cmd_run()
        if args.command == "extract-branch-issue":
            result = extract_issue_number_from_branch(args.branch_name)
            if result:
                print(result)
            return 0
        if args.command == "link-pr-issues":
            return cmd_link_pr_issues(args.pr, args.issue_numbers, args.replace)
    except Exception as e:
        log(f"실행 실패: {e}")
        return 1
    return 2


if __name__ == "__main__":
    sys.exit(main())
