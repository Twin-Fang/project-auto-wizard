# 이슈 헬퍼 로컬 흡수 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `.github/workflows/GITHUB-ISSUE-HELPER.yml`이 호출하는 외부 액션(`Chuseok22/github-issue-helper@v1`) 의존을 제거하고, 동일 동작(이슈에 브랜치명/커밋 메시지 댓글 안내 + 옵션 브랜치 생성)을 이 레포 안의 `payload/scripts/issue_helper.py`로 구현해 project-auto-wizard 자체 product 기능(설치 대상 레포에도 배포됨)으로 흡수한다.

**Architecture:** `payload/scripts/*.py`(stdlib only) + `payload/workflows/common/*.yaml` 패턴을 그대로 따른다(`version_manager.py`/`changelog_manager.py`/`truncate_release_notes.py`와 동일 계열). 정규화 로직(순수 함수)과 GitHub REST 호출(`urllib.request`, `GITHUB_TOKEN`)을 분리해 전자만 단위 테스트한다. 이 레포 자신도 설치 대상이므로(도그푸딩) `.github/scripts/`·`.github/workflows/`에 동일 파일을 수동 동기화한다.

**Tech Stack:** Python 3 stdlib(`re`, `json`, `unicodedata`, `urllib.request`, `datetime`), GitHub Actions YAML, `unittest`(Python 테스트), `node:test`(JS 테스트).

## Global Constraints

- 스크립트는 Python stdlib만 사용 — 서드파티 의존 금지(`docs/DESIGN-SPEC.md` §2).
- `payload/workflows/`가 단일 진실이다. `.github/workflows/`는 이 레포에 설치된 산출물(도그푸딩)이며, payload 변경 후 `{{MAIN_BRANCH}}` → `main` 치환을 수동으로 동기화해야 한다(`CONTRIBUTING.md`).
- `payload/workflows/common/*.yaml`은 반드시 최상위 `permissions:`를 선언해야 한다(`tests/node/payload-workflow-permissions.test.js`).
- 워크플로우에서 `main`/`develop`/`master`를 하드코딩하지 않는다 — `{{MAIN_BRANCH}}`/`{{DEVELOP_BRANCH}}` 플레이스홀더만 사용한다(`tests/node/payload-yaml.test.js`).
- GitHub Actions 액션 최소 메이저 버전: `actions/checkout@v7` 이상(`tests/node/workflow-action-versions.test.js`).
- 설정값은 기존 워크플로우와 동일하게 유지한다: `branch_prefix=""`, `max_branch_length=100`, `commit_template="${issueTitle} : feat : {변경 사항에 대한 설명} ${issueUrl}"`.
- 동작 변경 2건(사용자 승인됨): `create_branch` 기본값 `true`→`false`. 브랜치명 날짜는 KST 고정(`UTC+9`), 러너 로컬 시간에 의존하지 않는다.
- 브랜딩 교체: 댓글 마커 `<!-- project-auto-wizard issue helper -->`, 헤더 `## Issue Helper` (Chuseok22 브랜딩 전부 제거).
- 커밋 메시지는 한국어로 작성한다(Conventional Commits 타입 접두사는 영어) — `CLAUDE.md`.
- 브랜치는 이미 `20260810_#68_이슈_헬퍼_외부_의존_제거_로컬_흡수`로 `main`에서 체크아웃되어 있다. PR도 `main`을 향해 연다(이 레포의 실제 관행 — `CONTRIBUTING.md`가 명시하는 `develop` 기준이 아니라 최근 이슈들이 실제로 따르는 `main` 기준).

---

### Task 1: `issue_helper.py` — 정규화 로직 (순수 함수)

**Files:**
- Create: `payload/scripts/issue_helper.py`
- Test: `tests/py/test_issue_helper.py`

**Interfaces:**
- Produces:
  - `extract_issue_number(issue_url: str) -> str`
  - `extract_issue_title(raw_title: str) -> str`
  - `format_date_yyyymmdd(dt: datetime) -> str`
  - `normalize_title(title: str) -> str`
  - `create_branch_name(issue_title: str, issue_number: str, date_yyyymmdd: str, branch_prefix: str, max_branch_length: int) -> str`
  - `render_commit_message(template: str, issue_title: str, issue_url: str, issue_number: str, branch_name: str, date_yyyymmdd: str) -> str`
  - `normalize_all(title: str, issue_url: str, issue_number: str, date_yyyymmdd: str, branch_prefix: str, max_branch_length: int, commit_template: str) -> tuple[str, str]` (branch_name, commit_message)
  - 모듈 상수 `KST`(timezone), `COMMENT_MARKER_DEFAULT`(str)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/py/test_issue_helper.py` 생성:

```python
import sys
import unittest
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parents[2] / "payload" / "scripts"
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

import issue_helper  # noqa: E402


class TestExtractIssueNumber(unittest.TestCase):
    def test_extracts_trailing_number(self):
        self.assertEqual(issue_helper.extract_issue_number("https://github.com/o/r/issues/68"), "68")

    def test_strips_trailing_slash(self):
        self.assertEqual(issue_helper.extract_issue_number("https://github.com/o/r/issues/68/"), "68")


class TestExtractIssueTitle(unittest.TestCase):
    def test_strips_leading_tag(self):
        self.assertEqual(issue_helper.extract_issue_title("[개선] 제목입니다"), "제목입니다")

    def test_strips_emoji(self):
        self.assertEqual(issue_helper.extract_issue_title("버그 발견 🐛🔥"), "버그 발견")

    def test_strips_variation_selector_and_zwj(self):
        # ZWJ(U+200D)로 연결된 이모지 시퀀스 + 변형 선택자(U+FE0F)
        raw = "가족\U0001F468‍\U0001F469‍\U0001F467 이슈️"
        self.assertEqual(issue_helper.extract_issue_title(raw), "가족 이슈")

    def test_strips_control_characters(self):
        self.assertEqual(issue_helper.extract_issue_title("제목\x00\x01끝"), "제목끝")

    def test_falls_back_to_original_when_result_is_empty(self):
        self.assertEqual(issue_helper.extract_issue_title("🐛🔥"), "🐛🔥")

    def test_no_tag_no_emoji_unchanged(self):
        self.assertEqual(issue_helper.extract_issue_title("평범한 제목"), "평범한 제목")


class TestNormalizeTitle(unittest.TestCase):
    def test_keeps_korean_english_digits(self):
        self.assertEqual(issue_helper.normalize_title("한글abc123"), "한글abc123")

    def test_replaces_special_chars_with_underscore(self):
        self.assertEqual(issue_helper.normalize_title("a-b c!d"), "a_b_c_d")

    def test_collapses_consecutive_underscores(self):
        self.assertEqual(issue_helper.normalize_title("a---b"), "a_b")

    def test_trims_leading_trailing_underscores(self):
        self.assertEqual(issue_helper.normalize_title("!!!제목!!!"), "제목")


class TestCreateBranchName(unittest.TestCase):
    def test_basic_format(self):
        name = issue_helper.create_branch_name("버그 수정", "68", "20260810", "", 100)
        self.assertEqual(name, "20260810_#68_버그_수정")

    def test_applies_prefix(self):
        name = issue_helper.create_branch_name("버그 수정", "68", "20260810", "feat/", 100)
        self.assertEqual(name, "feat/20260810_#68_버그_수정")

    def test_truncates_base_excluding_prefix(self):
        long_title = "가" * 50
        name = issue_helper.create_branch_name(long_title, "68", "20260810", "feat/", 20)
        base = name[len("feat/"):]
        self.assertEqual(len(base), 20)
        self.assertTrue(name.startswith("feat/20260810_#68_"))

    def test_zero_max_length_means_no_truncation(self):
        long_title = "가" * 50
        name = issue_helper.create_branch_name(long_title, "68", "20260810", "", 0)
        self.assertEqual(name, f"20260810_#68_{long_title}")


class TestRenderCommitMessage(unittest.TestCase):
    def test_substitutes_all_variables(self):
        msg = issue_helper.render_commit_message(
            "${issueTitle} / ${issueUrl} / ${issueNumber} / ${branchName} / ${date}",
            "정규화된_제목", "https://github.com/o/r/issues/68", "68",
            "20260810_#68_정규화된_제목", "20260810",
        )
        self.assertEqual(
            msg,
            "정규화된_제목 / https://github.com/o/r/issues/68 / 68 / 20260810_#68_정규화된_제목 / 20260810",
        )

    def test_strips_result(self):
        msg = issue_helper.render_commit_message("  ${issueTitle}  ", "제목", "u", "1", "b", "d")
        self.assertEqual(msg, "제목")

    def test_literal_braces_untouched(self):
        msg = issue_helper.render_commit_message(
            "${issueTitle} : feat : {변경 사항에 대한 설명} ${issueUrl}",
            "제목", "https://github.com/o/r/issues/68", "68", "b", "d",
        )
        self.assertEqual(msg, "제목 : feat : {변경 사항에 대한 설명} https://github.com/o/r/issues/68")


class TestNormalizeAll(unittest.TestCase):
    def test_end_to_end(self):
        branch_name, commit_message = issue_helper.normalize_all(
            "버그 발견", "https://github.com/o/r/issues/68", "68", "20260810", "", 100,
            "${issueTitle} : feat : {설명} ${issueUrl}",
        )
        self.assertEqual(branch_name, "20260810_#68_버그_발견")
        self.assertEqual(
            commit_message,
            "버그_발견 : feat : {설명} https://github.com/o/r/issues/68",
        )


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `python3 -m unittest tests.py.test_issue_helper -v` (레포 루트에서 실행, 모듈 경로 이슈 시 `PYTHONPATH=. python3 -m pytest tests/py/test_issue_helper.py -v` 대신 `python3 -m unittest discover -s tests/py -p "test_issue_helper.py" -v` 사용)
Expected: FAIL — `ModuleNotFoundError: No module named 'issue_helper'` (파일이 아직 없음)

- [ ] **Step 3: `payload/scripts/issue_helper.py` 정규화 로직 구현**

```python
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `python3 -m unittest discover -s tests/py -p "test_issue_helper.py" -v`
Expected: 모든 테스트 PASS (18개)

- [ ] **Step 5: 전체 Python 테스트 스위트 회귀 확인**

Run: `npm run test:py`
Expected: 기존 스위트(`test_version_manager.py` 등) 포함 전부 PASS — 새 파일이 다른 스크립트에 영향 없음 확인

- [ ] **Step 6: 커밋**

```bash
git add payload/scripts/issue_helper.py tests/py/test_issue_helper.py
git commit -m "$(cat <<'EOF'
feat: 이슈 헬퍼 정규화 로직을 issue_helper.py로 이식 (#68)

Chuseok22/github-issue-helper의 normalize.ts를 Python으로 재작성.
브랜치명/커밋 메시지 정규화 순수 함수와 단위 테스트만 포함하며,
GitHub API 연동은 다음 커밋에서 이어진다.
EOF
)"
```

---

### Task 2: `issue_helper.py` — GitHub API 연동 + CLI 진입점

**Files:**
- Modify: `payload/scripts/issue_helper.py` (append)
- Test: `tests/py/test_issue_helper.py` (append)

**Interfaces:**
- Consumes (Task 1): `extract_issue_number`, `extract_issue_title`, `format_date_yyyymmdd`, `normalize_all`, `KST`, `COMMENT_MARKER_DEFAULT`
- Produces:
  - `cmd_run() -> int` — 이벤트 1건 처리 (댓글 upsert + 옵션 브랜치 생성)
  - `main(argv=None) -> int` — argparse 진입점, `run` 서브커맨드만 지원
  - 내부: `_headers(token)`, `_api_request(method, path, token, body=None)`, `list_comments(owner, repo, issue_number, token)`, `upsert_comment(owner, repo, issue_number, token, marker, body)`, `create_branch_if_needed(owner, repo, branch_name, base_branch, create_branch, token)`

- [ ] **Step 1: 실패하는 테스트 작성 (네트워크 없이 검증 가능한 가드 경로만)**

`tests/py/test_issue_helper.py`에 추가:

```python
import json
import os
import subprocess
import sys as _sys
import tempfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "payload" / "scripts" / "issue_helper.py"


def run_cli(event_payload, env_extra=None):
    with tempfile.TemporaryDirectory() as tmp:
        event_path = Path(tmp) / "event.json"
        event_path.write_text(json.dumps(event_payload), encoding="utf-8")
        env = {
            **os.environ,
            "GITHUB_EVENT_PATH": str(event_path),
            "GITHUB_REPOSITORY": "o/r",
        }
        if env_extra:
            env.update(env_extra)
        return subprocess.run(
            [_sys.executable, str(SCRIPT), "run"],
            capture_output=True, text=True, env=env,
        )


class TestRunGuards(unittest.TestCase):
    def test_missing_event_path_exits_1(self):
        env = {k: v for k, v in os.environ.items() if k != "GITHUB_EVENT_PATH"}
        env["GITHUB_REPOSITORY"] = "o/r"
        r = subprocess.run([_sys.executable, str(SCRIPT), "run"], capture_output=True, text=True, env=env)
        self.assertEqual(r.returncode, 1)

    def test_irrelevant_action_exits_0_without_token(self):
        r = run_cli({"action": "closed", "issue": {"number": 1, "title": "t", "html_url": "u"}})
        self.assertEqual(r.returncode, 0)

    def test_edited_without_title_change_exits_0(self):
        r = run_cli({
            "action": "edited",
            "issue": {"number": 1, "title": "t", "html_url": "u"},
            "changes": {"body": {"from": "old"}},
        })
        self.assertEqual(r.returncode, 0)

    def test_opened_without_token_exits_1(self):
        env = {k: v for k, v in os.environ.items() if k != "GITHUB_TOKEN"}
        r = run_cli(
            {"action": "opened", "issue": {"number": 1, "title": "t", "html_url": "u"}},
            env_extra={**env, "GITHUB_TOKEN": ""},
        )
        self.assertEqual(r.returncode, 1)

    def test_malformed_repository_env_exits_1(self):
        r = run_cli(
            {"action": "opened", "issue": {"number": 1, "title": "t", "html_url": "u"}},
            env_extra={"GITHUB_REPOSITORY": "not-a-repo-slug", "GITHUB_TOKEN": "x"},
        )
        self.assertEqual(r.returncode, 1)
```

이 클래스는 파일 상단의 `import unittest`를 재사용한다(Task 1에서 이미 임포트됨). `import json`/`os`/`subprocess`/`tempfile`도 파일 상단으로 옮겨 정리한다(아래 최종 임포트 블록 참고).

- [ ] **Step 2: 테스트 실패 확인**

Run: `python3 -m unittest discover -s tests/py -p "test_issue_helper.py" -v`
Expected: FAIL — `run` 서브커맨드가 아직 없어 argparse가 `error: argument command: invalid choice` 또는 스크립트가 `sys.exit(0)`만 하고 끝나 guard 동작이 없음(현재 Step 3 이전 스텁은 인자 없이 종료하므로 어떤 인자를 줘도 무시됨 — 실제로는 exit 0을 반환해 `test_missing_event_path_exits_1` 등이 실패함)

- [ ] **Step 3: GitHub API 연동 + CLI 구현**

`payload/scripts/issue_helper.py`의 임포트 블록을 다음으로 교체(정렬 정리, 기능 추가 없음):

```python
import argparse
import json
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
```

파일 끝의 `if __name__ == "__main__": sys.exit(0)`를 제거하고, 그 자리에 아래를 추가:

```python
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


def build_parser():
    parser = argparse.ArgumentParser(prog="issue_helper.py")
    parser.add_argument("command", choices=["run"])
    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "run":
        try:
            return cmd_run()
        except Exception as e:
            log(f"실행 실패: {e}")
            return 1
    return 2


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `python3 -m unittest discover -s tests/py -p "test_issue_helper.py" -v`
Expected: 모든 테스트 PASS (23개 — Task 1의 18개 + Task 2의 5개)

- [ ] **Step 5: 수동 스모크 테스트 (네트워크 없이 guard 경로만)**

```bash
python3 -c "
import json, tempfile, subprocess, sys, os
with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
    json.dump({'action': 'labeled', 'issue': {'number': 1, 'title': 't', 'html_url': 'u'}}, f)
    path = f.name
env = {**os.environ, 'GITHUB_EVENT_PATH': path, 'GITHUB_REPOSITORY': 'o/r'}
r = subprocess.run([sys.executable, 'payload/scripts/issue_helper.py', 'run'], env=env)
print('exit code:', r.returncode)
os.unlink(path)
"
```

Expected: `exit code: 0` (labeled는 관련 없는 액션이라 조용히 종료)

- [ ] **Step 6: 전체 Python 테스트 스위트 회귀 확인**

Run: `npm run test:py`
Expected: 전부 PASS

- [ ] **Step 7: 커밋**

```bash
git add payload/scripts/issue_helper.py tests/py/test_issue_helper.py
git commit -m "$(cat <<'EOF'
feat: 이슈 헬퍼에 GitHub API 연동과 CLI 진입점 추가 (#68)

댓글 upsert(마커 기반 검색→update/create)와 옵션 브랜치 생성을
urllib.request + GITHUB_TOKEN으로 구현. run 서브커맨드 하나로
GitHub Actions 이벤트 컨텍스트를 env var로 받아 처리한다.
EOF
)"
```

---

### Task 3: `payload/workflows/common/PROJECT-COMMON-ISSUE-HELPER.yaml`

**Files:**
- Create: `payload/workflows/common/PROJECT-COMMON-ISSUE-HELPER.yaml`
- Modify: `tests/node/payload-yaml.test.js` (append regression tests)
- Modify: `tests/node/assets.test.js:27-39` (`listCommonWorkflows` 개수 5→6)

**Interfaces:**
- Consumes: `python3 .github/scripts/issue_helper.py run` (Task 2 산출물의 설치 대상 경로)
- Produces: `payload/workflows/common/PROJECT-COMMON-ISSUE-HELPER.yaml` — `src/core/copy/workflows.js`의 `listYamlFiles(commonDir)`가 자동으로 스캔하므로 별도 등록 코드 불필요

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/payload-yaml.test.js` 끝에 추가:

```javascript
// ---------------------------------------------------------------
// ISSUE-HELPER: 외부 Chuseok22/github-issue-helper 액션 의존 제거,
// 로컬 payload 기능으로 흡수 (issue #68)
// ---------------------------------------------------------------
const issueHelperPath = join("payload/workflows/common", "PROJECT-COMMON-ISSUE-HELPER.yaml");

test("PROJECT-COMMON-ISSUE-HELPER exists in payload", () => {
  assert.ok(files.includes(issueHelperPath), `${issueHelperPath} missing`);
});

test("PROJECT-COMMON-ISSUE-HELPER는 외부 액션을 참조하지 않는다", () => {
  const body = readFileSync(issueHelperPath, "utf8");
  assert.ok(!body.includes("Chuseok22/github-issue-helper"));
  assert.ok(body.includes("python3 .github/scripts/issue_helper.py run"));
});

test("PROJECT-COMMON-ISSUE-HELPER의 create_branch 기본값은 false다", () => {
  const body = readFileSync(issueHelperPath, "utf8");
  assert.match(body, /ISSUE_HELPER_CREATE_BRANCH:\s*"false"/);
});

test("PROJECT-COMMON-ISSUE-HELPER의 base_branch는 하드코딩된 브랜치명이 아니라 플레이스홀더를 쓴다", () => {
  const body = readFileSync(issueHelperPath, "utf8");
  assert.match(body, /ISSUE_HELPER_BASE_BRANCH:\s*"\{\{MAIN_BRANCH\}\}"/);
});

test("PROJECT-COMMON-ISSUE-HELPER는 issues opened/edited에 반응한다", () => {
  const body = readFileSync(issueHelperPath, "utf8");
  assert.match(body, /on:\s*\n\s*issues:\s*\n\s*types:\s*\[opened,\s*edited]/);
});
```

`tests/node/assets.test.js`의 `listCommonWorkflows` 테스트를 수정:

```javascript
test("listCommonWorkflows returns the 6 common workflows incl. RELEASE-PUBLISH and ISSUE-HELPER", () => {
  const names = listCommonWorkflows();
  assert.strictEqual(names.length, 6, `expected 6, got ${names.length}: ${names}`);
  for (const wf of [
    "PROJECT-COMMON-AI-PR-SUMMARY.yaml",
    "PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml",
    "PROJECT-COMMON-ISSUE-HELPER.yaml",
    "PROJECT-COMMON-README-VERSION-UPDATE.yaml",
    "PROJECT-COMMON-RELEASE-PUBLISH.yaml",
    "PROJECT-COMMON-VERSION-CONTROL.yaml",
  ]) assert.ok(names.includes(wf), `${wf} missing`);
  // secret-backup은 하위 폴더 — 직하위 목록엔 포함되지 않는다 (opt-in 별도 복사 규약)
  assert.ok(!names.includes("PROJECT-COMMON-SECRET-FILE-UPLOAD.yaml"));
});
```
(기존 5개짜리 테스트를 교체하는 것 — 새 테스트로 덮어쓴다.)

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test tests/node/payload-yaml.test.js tests/node/assets.test.js`
Expected: FAIL — `payload-yaml.test.js`는 파일 없음(`ENOENT`)으로 실패, `assets.test.js`는 `expected 6, got 5`로 실패

- [ ] **Step 3: 워크플로우 YAML 작성**

`payload/workflows/common/PROJECT-COMMON-ISSUE-HELPER.yaml` 생성:

```yaml
# project-auto-wizard:managed-workflow
# ===================================================================
# PROJECT-COMMON-ISSUE-HELPER.yaml
# 이슈 생성/제목 수정 시 브랜치명·커밋 메시지를 댓글로 안내
# ===================================================================
#
# 이슈가 열리거나(opened) 제목이 수정되면(edited + 제목 변경),
# 정규화된 브랜치명과 커밋 메시지를 이슈 댓글로 생성/갱신한다.
# ISSUE_HELPER_CREATE_BRANCH=true로 바꾸면 브랜치도 함께 생성한다
# (기본값은 false — 이슈를 열 때마다 브랜치가 자동 생성되는 것을
# 막기 위해 옵트인으로 전환됨, project-auto-wizard#68).
#
# 로직 본체는 .github/scripts/issue_helper.py (Chuseok22/github-issue-helper의
# Python 재작성, 동일 작성자 — project-auto-wizard#68).
# ===================================================================

name: PROJECT-ISSUE-HELPER

on:
  issues:
    types: [opened, edited]

permissions:
  issues: write
  contents: write

jobs:
  issue-helper:
    name: 브랜치명 & 커밋 메시지 안내
    if: github.event.action == 'opened' || (github.event.action == 'edited' && github.event.changes.title)
    runs-on: ubuntu-latest
    env:
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      ISSUE_HELPER_BRANCH_PREFIX: ""
      ISSUE_HELPER_MAX_BRANCH_LENGTH: "100"
      ISSUE_HELPER_COMMIT_TEMPLATE: "${issueTitle} : feat : {변경 사항에 대한 설명} ${issueUrl}"
      ISSUE_HELPER_CREATE_BRANCH: "false"
      ISSUE_HELPER_BASE_BRANCH: "{{MAIN_BRANCH}}"
    steps:
      - name: Checkout repository
        uses: actions/checkout@v7

      - name: 브랜치명 & 커밋 메시지 생성
        run: python3 .github/scripts/issue_helper.py run
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/node/payload-yaml.test.js tests/node/assets.test.js tests/node/payload-workflow-permissions.test.js tests/node/workflow-action-versions.test.js`
Expected: 전부 PASS

- [ ] **Step 5: 전체 Node 테스트 스위트 회귀 확인**

Run: `npm run test:node`
Expected: 전부 PASS (다른 워크플로우 카운트 관련 테스트가 없는지 재확인)

- [ ] **Step 6: 커밋**

```bash
git add payload/workflows/common/PROJECT-COMMON-ISSUE-HELPER.yaml tests/node/payload-yaml.test.js tests/node/assets.test.js
git commit -m "$(cat <<'EOF'
feat: 이슈 헬퍼 워크플로우를 payload 공통 기능으로 추가 (#68)

PROJECT-COMMON-* 네이밍 컨벤션을 따라 payload/workflows/common에
추가. 설치 대상 레포에도 배포되어 issue_helper.py 실행을 트리거한다.
EOF
)"
```

---

### Task 4: 도그푸딩 동기화 — `.github/scripts`·`.github/workflows` + 외부 액션 워크플로우 삭제

**Files:**
- Create: `.github/scripts/issue_helper.py` (payload와 동일 내용)
- Create: `.github/workflows/PROJECT-COMMON-ISSUE-HELPER.yaml` (`{{MAIN_BRANCH}}` → `main` 치환)
- Delete: `.github/workflows/GITHUB-ISSUE-HELPER.yml`
- Modify: `tests/node/payload-yaml.test.js` (append)

**Interfaces:**
- Consumes: Task 2의 `payload/scripts/issue_helper.py`, Task 3의 `payload/workflows/common/PROJECT-COMMON-ISSUE-HELPER.yaml`
- Produces: 없음(터미널 산출물 — 이 레포 자신에 설치된 최종형)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/payload-yaml.test.js` 끝에 추가:

```javascript
// ---------------------------------------------------------------
// 도그푸딩 사본 — payload를 고치면 .github 사본도 함께 고쳐야 한다.
// ---------------------------------------------------------------
test("이 레포에는 더 이상 외부 Chuseok22/github-issue-helper 액션 참조가 없다", () => {
  const selfHostedFiles = readdirSync(".github/workflows")
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => join(".github/workflows", f));
  for (const f of selfHostedFiles) {
    const body = readFileSync(f, "utf8");
    assert.ok(!body.includes("Chuseok22/github-issue-helper"), `${f}: 외부 액션 참조가 남아있음`);
  }
});

test("도그푸딩 사본 PROJECT-COMMON-ISSUE-HELPER는 {{MAIN_BRANCH}}가 main으로 치환되어 있다", () => {
  const text = readFileSync(join(".github", "workflows", "PROJECT-COMMON-ISSUE-HELPER.yaml"), "utf8");
  assert.ok(!text.includes("{{MAIN_BRANCH}}"), "플레이스홀더가 치환되지 않았습니다");
  assert.match(text, /ISSUE_HELPER_BASE_BRANCH:\s*"main"/);
});

test("도그푸딩 사본 issue_helper.py는 payload 원본과 동일하다", () => {
  const payloadSrc = readFileSync(join("payload", "scripts", "issue_helper.py"), "utf8");
  const selfHostedSrc = readFileSync(join(".github", "scripts", "issue_helper.py"), "utf8");
  assert.strictEqual(selfHostedSrc, payloadSrc);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test tests/node/payload-yaml.test.js`
Expected: FAIL — `.github/workflows/PROJECT-COMMON-ISSUE-HELPER.yaml`와 `.github/scripts/issue_helper.py`가 아직 없어 `ENOENT`, 또는 첫 번째 테스트는 `GITHUB-ISSUE-HELPER.yml`이 아직 외부 액션을 참조하므로 실패

- [ ] **Step 3: 도그푸딩 파일 생성 및 기존 워크플로우 삭제**

```bash
cp payload/scripts/issue_helper.py .github/scripts/issue_helper.py
chmod 755 .github/scripts/issue_helper.py
sed 's/{{MAIN_BRANCH}}/main/' payload/workflows/common/PROJECT-COMMON-ISSUE-HELPER.yaml > .github/workflows/PROJECT-COMMON-ISSUE-HELPER.yaml
rm .github/workflows/GITHUB-ISSUE-HELPER.yml
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/node/payload-yaml.test.js`
Expected: 전부 PASS

- [ ] **Step 5: 전체 스위트 회귀 확인**

Run: `npm test`
Expected: 전부 PASS

- [ ] **Step 6: 커밋**

```bash
git add .github/scripts/issue_helper.py .github/workflows/PROJECT-COMMON-ISSUE-HELPER.yaml .github/workflows/GITHUB-ISSUE-HELPER.yml tests/node/payload-yaml.test.js
git commit -m "$(cat <<'EOF'
fix: 외부 Chuseok22/github-issue-helper 액션 의존 제거 (#68)

GITHUB-ISSUE-HELPER.yml을 삭제하고 PROJECT-COMMON-ISSUE-HELPER.yaml +
.github/scripts/issue_helper.py로 대체. 로직이 이 레포 안에 존재하며,
워크플로우는 로컬 스크립트만 호출한다.
EOF
)"
```

---

### Task 5: 설치 파이프라인에 `issue_helper.py` 배선

**Files:**
- Modify: `src/core/copy/simple.js:11`
- Modify: `src/core/removal-plan.js:66`
- Modify: `src/ui/summary.js:89-91`
- Modify: `tests/node/assets.test.js:61-72`
- Modify: `tests/node/removal-plan.test.js:40-41`

**Interfaces:**
- Consumes: 없음(기존 배열에 문자열 하나 추가하는 수정)
- Produces: 없음

**배경(과거 #51에서 확인된 함정):** `payload/scripts/*.py`에 파일이 있어도 `copyScripts()`의 하드코딩 배열에 없으면 사용자 레포 `.github/scripts/`에 설치되지 않는다. `removal-plan.js`도 동일 배열을 별도로 갖고 있어, 여기 없으면 uninstall/purge가 이 스크립트를 지우지 못하고 남긴다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/assets.test.js`의 `copyScripts installs...` 테스트를 교체:

```javascript
test("copyScripts installs payload python scripts into .github/scripts/", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-scripts-"));
  try {
    const copied = copyScripts(resolvePayloadRoot(), target);
    assert.strictEqual(copied, 4);
    assert.ok(existsSync(join(target, ".github", "scripts", "version_manager.py")));
    assert.ok(existsSync(join(target, ".github", "scripts", "changelog_manager.py")));
    assert.ok(existsSync(join(target, ".github", "scripts", "truncate_release_notes.py")));
    assert.ok(existsSync(join(target, ".github", "scripts", "issue_helper.py")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

`tests/node/removal-plan.test.js`의 `planRemoval: lists files without deleting anything` 테스트 안에 한 줄 추가:

```javascript
    assert.ok(plan.scripts.includes("version_manager.py"));
    assert.ok(plan.scripts.includes("truncate_release_notes.py"));
    assert.ok(plan.scripts.includes("issue_helper.py"));
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test tests/node/assets.test.js tests/node/removal-plan.test.js`
Expected: FAIL — `assets.test.js`는 `copied`가 여전히 3, `issue_helper.py` existsSync가 false. `removal-plan.test.js`는 `plan.scripts.includes("issue_helper.py")`가 false

- [ ] **Step 3: 세 곳에 `issue_helper.py` 추가**

`src/core/copy/simple.js:11`:
```javascript
  const scripts = ["version_manager.py", "changelog_manager.py", "truncate_release_notes.py", "issue_helper.py"];
```

`src/core/removal-plan.js:66`:
```javascript
  for (const s of ["version_manager.py", "changelog_manager.py", "truncate_release_notes.py", "issue_helper.py"]) {
```

`src/ui/summary.js:89-91`:
```javascript
  err("     ├─ version_manager.py");
  err("     ├─ changelog_manager.py");
  err("     ├─ truncate_release_notes.py");
  err("     └─ issue_helper.py");
```
(기존 `truncate_release_notes.py` 줄의 `└─`를 `├─`로 바꾸고, `issue_helper.py`를 마지막 `└─`로 추가.)

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/node/assets.test.js tests/node/removal-plan.test.js`
Expected: 전부 PASS

- [ ] **Step 5: 전체 스위트 회귀 확인**

Run: `npm test`
Expected: 전부 PASS — 특히 `e2e-matrix.test.js`, `purge-plan.test.js`, `uninstall-*.test.js` 등 `version_manager.py`를 canary로 쓰는 기존 테스트들이 `issue_helper.py` 추가로 깨지지 않는지 확인(이들은 특정 파일명을 지정해 검사하므로 개수 무관하게 안전할 것으로 예상되나, 실행으로 확정)

- [ ] **Step 6: 커밋**

```bash
git add src/core/copy/simple.js src/core/removal-plan.js src/ui/summary.js tests/node/assets.test.js tests/node/removal-plan.test.js
git commit -m "$(cat <<'EOF'
fix: 설치·제거·안내 파이프라인에 issue_helper.py 배선 (#68)

payload/scripts/issue_helper.py가 사용자 레포 .github/scripts/에
실제로 설치되도록 copyScripts()/removal-plan.js/summary.js의
하드코딩 배열에 등록한다 (#51에서 확인된 동일 함정).
EOF
)"
```

---

### Task 6: 전체 검증 및 완료 조건 재확인

**Files:** 없음(검증 전용 태스크)

- [ ] **Step 1: 전체 테스트 스위트 실행**

Run: `npm test`
Expected: `test:node` + `test:py` 전부 PASS

- [ ] **Step 2: 이슈 완료 조건 체크리스트 대조**

`docs/superpowers/specs/2026-08-10-issue-helper-local-absorption-design.md` §8과 대조:

- [x] `uses: Chuseok22/github-issue-helper@v1` 제거 — Task 4에서 `.github/workflows/GITHUB-ISSUE-HELPER.yml` 삭제로 확인
- [x] 로직이 레포 안에 존재, 워크플로우는 로컬 스크립트만 호출 — `payload/scripts/issue_helper.py` + `python3 .github/scripts/issue_helper.py run`
- [x] 댓글 마커·제목에서 외부 브랜딩 제거 — `<!-- project-auto-wizard issue helper -->`, `## Issue Helper`
- [x] 정규화 로직 단위 테스트 — Task 1의 18개 테스트(한글/이모지/`[태그]`/길이 제한/특수문자 전부 커버)
- [x] 원저작자 동의/출처 표기 — `issue_helper.py` docstring에 명시(Task 1 Step 3)
- [ ] 실제 이슈로 동작 확인 — **PR 머지 후 실제 GitHub 이슈로 수동 검증 필요** (아래 Step 3)

- [ ] **Step 3: 수동 검증 절차 기록 (PR 본문에 포함할 테스트 플랜)**

이 스텝은 코드 변경이 아니라, PR 설명에 담을 수동 검증 절차를 정리하는 것이다:

1. PR 머지 후 이 레포에 새 이슈를 하나 연다.
2. `PROJECT-ISSUE-HELPER` 워크플로우가 트리거되어 댓글이 달리는지 확인 — 마커가 `<!-- project-auto-wizard issue helper -->`이고 헤더가 `## Issue Helper`인지, `Chuseok22` 문자열이 어디에도 없는지 확인.
3. 이슈 제목을 수정한다 — 댓글이 새로 추가되지 않고 기존 댓글이 갱신되는지 확인.
4. `create_branch` 기본값이 `false`이므로 브랜치가 자동 생성되지 않았는지 확인(원격 브랜치 목록에 새 브랜치가 안 생김).
5. 댓글에 적힌 브랜치명의 날짜가 KST 기준 오늘 날짜인지 확인.
