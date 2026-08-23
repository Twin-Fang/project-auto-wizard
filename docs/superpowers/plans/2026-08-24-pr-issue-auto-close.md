# PR-이슈 자동 종료(Closes) 연결 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** feat PR과 release PR(develop→main) 양쪽에서 GitHub의 `Closes #N` 자동 이슈 종료가 실제로 동작하도록 `issue_helper.py`/`changelog_manager.py`에 이슈-브랜치/PR 연결 로직을 추가하고, `PROJECT-COMMON-AI-PR-SUMMARY.yaml`과 `PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml`에 그 로직을 호출하는 스텝을 붙인다.

**Architecture:** (A) `AI-PR-SUMMARY`가 이미 main을 향한 모든 feat PR에서 도는 트리거를 재사용해, PR head 브랜치명에서 이슈 번호를 추출하고 PR 본문에 마커 블록으로 `Closes #N`을 1회 삽입한다. (B) `AUTO-CHANGELOG-CONTROL`이 이미 계산하는 "릴리스에 포함된 커밋" 범위를, `gh pr list --base develop`로 조회한 머지 PR 목록과 머지 커밋 SHA로 교차 대조해 이번 릴리스에 실제로 포함된 이슈 번호들을 뽑아내고, 매 실행마다 release PR 본문의 마커 블록을 새로 계산한 값으로 치환한다. 두 지점 모두 실패해도 파이프라인을 막지 않는다(`continue-on-error: true`).

**Tech Stack:** Python 3 stdlib(`re`, `json`, `urllib.request`, `argparse`) — 이 저장소는 zero-dependency 원칙(`payload/scripts/`)을 지킨다. GitHub Actions bash 스텝은 `gh` CLI(러너에 기본 설치)와 위 파이썬 스크립트를 호출한다. 테스트는 `node --test`(node --test 러너, 워크플로우 YAML 콘텐츠 검증) + `unittest`(python, `tests/py/`).

**Spec:** `docs/superpowers/specs/2026-08-24-pr-issue-auto-close-design.md`

## Global Constraints

- 이 저장소는 `payload/`가 단일 진실이다 — `payload/workflows/common/*.yaml`을 먼저 수정하고, `{{MAIN_BRANCH}}` → `main`, `{{DEVELOP_BRANCH}}` → `develop` 치환만 다른 byte-identical(브랜치 리터럴 외에는 완전히 동일) 사본을 `.github/workflows/`에 만든다.
- `payload/scripts/*.py`는 `.github/scripts/*.py`와 **완전히 byte-identical**해야 한다(치환 없음 — 스크립트는 브랜치명을 인자/환경변수로 받으므로 파일 내용에 브랜치 리터럴이 없다).
- Python 쪽은 stdlib만 사용한다. 외부 패키지(PyYAML 포함)를 추가하지 않는다.
- `tests/node/payload-yaml.test.js`에 이미 있는 자동 테스트("no hardcoded branch literals outside placeholders")가 `payload/workflows/**/*.yaml`의 모든 줄을 스캔해 `branches:`/`head.ref ==` 문맥의 하드코딩된 `develop`/`main`/`master`를 금지한다 — 새로 쓰는 bash 스텝에서 브랜치명이 필요하면 반드시 `{{MAIN_BRANCH}}`/`{{DEVELOP_BRANCH}}` 플레이스홀더를 쓴다.
- 커밋 메시지는 한국어로 작성한다(`CLAUDE.md`, Conventional Commits 타입 접두사는 영어 유지).
- 기존 코드 스타일을 그대로 따른다: `issue_helper.py`는 타입 힌트를 쓰지 않는 기존 스타일을 유지하고(파일 전체가 이미 그렇다), `changelog_manager.py`는 타입 힌트를 쓰는 기존 스타일(`from __future__ import annotations`, `-> int` 등)을 유지한다 — 두 파일의 스타일을 섞지 않는다.
- 이 계획을 구현하는 워크트리는 `.worktrees/20260824_#102_feat_및_release_develop_main_PR에_이슈_자동_종료_Closes_N_연결_추가/`이며, 이미 생성되어 baseline 테스트(node 465개)가 통과한 상태다.

---

### Task 1: `issue_helper.py` — 브랜치명에서 이슈 번호 추출

**Files:**
- Modify: `payload/scripts/issue_helper.py:56-59` (바로 뒤에 추가)
- Test: `tests/py/test_issue_helper.py`

**Interfaces:**
- Produces: `extract_issue_number_from_branch(branch_name: str) -> str | None` — 매칭 실패 시 `None`.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/py/test_issue_helper.py`의 `class TestExtractIssueNumber(unittest.TestCase):` 블록(19~23번째 줄) 바로 뒤에 새 클래스를 추가한다:

```python
class TestExtractIssueNumberFromBranch(unittest.TestCase):
    def test_extracts_from_standard_branch_name(self):
        self.assertEqual(
            issue_helper.extract_issue_number_from_branch("20260824_#102_feat_추가"),
            "102",
        )

    def test_no_hash_returns_none(self):
        self.assertIsNone(
            issue_helper.extract_issue_number_from_branch("worktree-issue-93-branch-strategy")
        )

    def test_multiple_hashes_uses_first_match(self):
        self.assertEqual(
            issue_helper.extract_issue_number_from_branch("20260824_#102_feat_#extra"),
            "102",
        )

    def test_multi_digit_issue_number(self):
        self.assertEqual(
            issue_helper.extract_issue_number_from_branch("20260101_#12345_x"),
            "12345",
        )
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd tests/py && python3 -m unittest test_issue_helper.TestExtractIssueNumberFromBranch -v`
Expected: `AttributeError: module 'issue_helper' has no attribute 'extract_issue_number_from_branch'`로 FAIL

- [ ] **Step 3: 최소 구현**

`payload/scripts/issue_helper.py`의 `extract_issue_number()` 함수(56~59번째 줄) 바로 뒤, `_TAG_RE = re.compile(...)` 줄(62번째 줄) 바로 앞에 추가:

```python
_BRANCH_ISSUE_RE = re.compile(r"#(\d+)")


def extract_issue_number_from_branch(branch_name):
    match = _BRANCH_ISSUE_RE.search(branch_name)
    return match.group(1) if match else None
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd tests/py && python3 -m unittest test_issue_helper.TestExtractIssueNumberFromBranch -v`
Expected: 4개 테스트 모두 PASS

- [ ] **Step 5: 커밋**

```bash
git add payload/scripts/issue_helper.py tests/py/test_issue_helper.py
git commit -m "feat: 브랜치명에서 이슈 번호를 추출하는 함수 추가"
```

---

### Task 2: `issue_helper.py` — PR 본문 마커 블록 삽입/치환

**Files:**
- Modify: `payload/scripts/issue_helper.py` (Task 1에서 추가한 코드 뒤, `normalize_all()` 함수 뒤)
- Test: `tests/py/test_issue_helper.py`

**Interfaces:**
- Consumes: 없음(순수 문자열 함수).
- Produces:
  - `LINK_MARKER_START: str`, `LINK_MARKER_END: str` — 모듈 상수.
  - `build_issue_links_block(issue_numbers: list[str]) -> str`
  - `upsert_issue_links_in_body(body: str, issue_numbers: list[str], replace_existing: bool) -> tuple[str, bool]` — `(새_본문, 변경여부)`.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/py/test_issue_helper.py`의 `class TestNormalizeAll(unittest.TestCase):` 블록 바로 뒤(현재 118번째 줄, `run_cli` 함수 정의 앞)에 새 클래스를 추가한다:

```python
class TestUpsertIssueLinksInBody(unittest.TestCase):
    def test_empty_issue_numbers_returns_unchanged(self):
        body, changed = issue_helper.upsert_issue_links_in_body("기존 본문", [], False)
        self.assertEqual(body, "기존 본문")
        self.assertFalse(changed)

    def test_appends_block_when_no_marker(self):
        body, changed = issue_helper.upsert_issue_links_in_body("기존 본문", ["102"], False)
        self.assertTrue(changed)
        self.assertEqual(
            body,
            "기존 본문\n\n<!-- auto-issue-link:start -->\nCloses #102\n<!-- auto-issue-link:end -->",
        )

    def test_appends_without_leading_blank_lines_when_body_empty(self):
        body, changed = issue_helper.upsert_issue_links_in_body("", ["102"], False)
        self.assertTrue(changed)
        self.assertEqual(
            body,
            "<!-- auto-issue-link:start -->\nCloses #102\n<!-- auto-issue-link:end -->",
        )

    def test_skips_when_marker_exists_and_not_replacing(self):
        existing = "설명\n\n<!-- auto-issue-link:start -->\nCloses #1\n<!-- auto-issue-link:end -->"
        body, changed = issue_helper.upsert_issue_links_in_body(existing, ["2"], False)
        self.assertEqual(body, existing)
        self.assertFalse(changed)

    def test_replaces_block_when_marker_exists_and_replacing(self):
        existing = "설명\n\n<!-- auto-issue-link:start -->\nCloses #1\n<!-- auto-issue-link:end -->\n\n뒷부분"
        body, changed = issue_helper.upsert_issue_links_in_body(existing, ["2", "3"], True)
        self.assertTrue(changed)
        self.assertEqual(
            body,
            "설명\n\n<!-- auto-issue-link:start -->\nCloses #2\nCloses #3\n<!-- auto-issue-link:end -->\n\n뒷부분",
        )


class TestBuildIssueLinksBlock(unittest.TestCase):
    def test_single_issue(self):
        self.assertEqual(
            issue_helper.build_issue_links_block(["102"]),
            "<!-- auto-issue-link:start -->\nCloses #102\n<!-- auto-issue-link:end -->",
        )

    def test_multiple_issues(self):
        self.assertEqual(
            issue_helper.build_issue_links_block(["1", "2"]),
            "<!-- auto-issue-link:start -->\nCloses #1\nCloses #2\n<!-- auto-issue-link:end -->",
        )
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd tests/py && python3 -m unittest test_issue_helper.TestUpsertIssueLinksInBody test_issue_helper.TestBuildIssueLinksBlock -v`
Expected: `AttributeError`로 FAIL

- [ ] **Step 3: 최소 구현**

`payload/scripts/issue_helper.py`의 `normalize_all()` 함수 뒤, `# GitHub REST API` 섹션 주석(현재 124번째 줄) 바로 앞에 새 섹션을 추가한다:

```python
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

    has_marker = LINK_MARKER_START in body
    if has_marker and not replace_existing:
        return body, False

    block = build_issue_links_block(issue_numbers)
    if has_marker:
        new_body = _LINK_BLOCK_RE.sub(block, body)
    else:
        separator = "\n\n" if body.strip() else ""
        new_body = f"{body}{separator}{block}"
    return new_body, True
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd tests/py && python3 -m unittest test_issue_helper.TestUpsertIssueLinksInBody test_issue_helper.TestBuildIssueLinksBlock -v`
Expected: 7개 테스트 모두 PASS

- [ ] **Step 5: 커밋**

```bash
git add payload/scripts/issue_helper.py tests/py/test_issue_helper.py
git commit -m "feat: PR 본문에 이슈 종료 마커 블록을 삽입/치환하는 함수 추가"
```

---

### Task 3: `issue_helper.py` — PR 본문 편집 API 호출 + CLI 서브커맨드

**Files:**
- Modify: `payload/scripts/issue_helper.py` (`create_branch_if_needed()` 뒤, `build_parser()`/`main()` 교체)
- Test: `tests/py/test_issue_helper.py`

**Interfaces:**
- Consumes: Task 1의 `extract_issue_number_from_branch()`, Task 2의 `upsert_issue_links_in_body()`, 기존 `_api_request()`, `API_BASE`, `log()`.
- Produces: CLI `issue_helper.py extract-branch-issue <branch_name>` (stdout에 이슈 번호, 없으면 빈 stdout, 항상 exit 0), CLI `issue_helper.py link-pr-issues --pr <number> --issue-numbers <csv> [--replace]` (성공/스킵 exit 0, 설정 오류 exit 1).

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/py/test_issue_helper.py` 파일 끝(`class TestRunGuards` 블록 뒤, `if __name__ == "__main__":` 앞)에 추가:

```python
class TestExtractBranchIssueCli(unittest.TestCase):
    def test_prints_issue_number(self):
        r = subprocess.run(
            [sys.executable, str(SCRIPT), "extract-branch-issue", "20260824_#102_feat_추가"],
            capture_output=True, text=True,
        )
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "102")

    def test_no_match_prints_nothing(self):
        r = subprocess.run(
            [sys.executable, str(SCRIPT), "extract-branch-issue", "worktree-issue-93-branch-strategy"],
            capture_output=True, text=True,
        )
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "")


class TestLinkPrIssuesCliGuards(unittest.TestCase):
    def test_missing_repository_env_exits_1(self):
        env = {k: v for k, v in os.environ.items() if k != "GITHUB_REPOSITORY"}
        r = subprocess.run(
            [sys.executable, str(SCRIPT), "link-pr-issues", "--pr", "1", "--issue-numbers", "1"],
            capture_output=True, text=True, env=env,
        )
        self.assertEqual(r.returncode, 1)

    def test_missing_token_exits_1(self):
        env = {**os.environ, "GITHUB_REPOSITORY": "o/r", "GITHUB_TOKEN": ""}
        r = subprocess.run(
            [sys.executable, str(SCRIPT), "link-pr-issues", "--pr", "1", "--issue-numbers", "1"],
            capture_output=True, text=True, env=env,
        )
        self.assertEqual(r.returncode, 1)

    def test_empty_issue_numbers_exits_0_without_api_call(self):
        env = {**os.environ, "GITHUB_REPOSITORY": "o/r", "GITHUB_TOKEN": "x"}
        r = subprocess.run(
            [sys.executable, str(SCRIPT), "link-pr-issues", "--pr", "1", "--issue-numbers", ""],
            capture_output=True, text=True, env=env,
        )
        self.assertEqual(r.returncode, 0)
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd tests/py && python3 -m unittest test_issue_helper.TestExtractBranchIssueCli test_issue_helper.TestLinkPrIssuesCliGuards -v`
Expected: `extract-branch-issue`/`link-pr-issues`가 `choices=["run"]`에 없어 argparse가 exit code 2로 실패 → FAIL (returncode 2 != 기대값 0/1)

- [ ] **Step 3: 최소 구현**

3-1. `payload/scripts/issue_helper.py`의 `create_branch_if_needed()` 함수 뒤(현재 222번째 줄), `# 이벤트 처리 / CLI` 섹션 주석(현재 225번째 줄) 바로 앞에 추가:

```python
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
```

3-2. `cmd_run()` 함수 뒤(현재 312번째 줄), `build_parser()` 앞에 추가:

```python
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
```

3-3. 기존 `build_parser()`/`main()` 전체를 아래로 교체한다:

```python
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
```

3-4. 모듈 docstring의 `Usage:` 블록(현재 15~16번째 줄)을 아래로 교체:

```
Usage:
    issue_helper.py run
    issue_helper.py extract-branch-issue <branch_name>
    issue_helper.py link-pr-issues --pr <number> --issue-numbers <csv> [--replace]
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd tests/py && python3 -m unittest test_issue_helper -v`
Expected: 파일 내 전체 테스트(기존 + 신규) 모두 PASS. `run` 서브커맨드 기존 테스트(`TestRunGuards`)도 회귀 없이 통과해야 한다(서브파서 전환으로 `issue_helper.py run` 호출 문법 자체는 바뀌지 않음).

- [ ] **Step 5: 커밋**

```bash
git add payload/scripts/issue_helper.py tests/py/test_issue_helper.py
git commit -m "feat: PR 본문에 이슈 연결을 반영하는 link-pr-issues CLI 서브커맨드 추가"
```

---

### Task 4: `issue_helper.py` — `.github/scripts/` 도그푸딩 사본 동기화

**Files:**
- Modify: `.github/scripts/issue_helper.py` (payload 사본으로 완전히 교체)

**Interfaces:**
- Consumes: Task 1~3에서 완성된 `payload/scripts/issue_helper.py`.
- Produces: 없음(동기화만).

- [ ] **Step 1: 두 파일이 지금 다르다는 것을 확인(diff)**

Run: `diff payload/scripts/issue_helper.py .github/scripts/issue_helper.py`
Expected: Task 1~3에서 추가한 내용만큼의 차이가 출력됨(비어있지 않음)

- [ ] **Step 2: 동기화**

```bash
cp payload/scripts/issue_helper.py .github/scripts/issue_helper.py
```

- [ ] **Step 3: byte-identical 확인**

Run: `diff payload/scripts/issue_helper.py .github/scripts/issue_helper.py`
Expected: 출력 없음(완전히 동일)

- [ ] **Step 4: 커밋**

```bash
git add .github/scripts/issue_helper.py
git commit -m "chore: .github/scripts/issue_helper.py를 payload 사본과 동기화"
```

---

### Task 5: `changelog_manager.py` — 릴리스 포함 이슈 번호 필터링 함수

**Files:**
- Modify: `payload/scripts/changelog_manager.py` (import 추가, 새 함수 추가)
- Test: `tests/py/test_changelog_manager.py`

**Interfaces:**
- Consumes: `issue_helper.extract_issue_number_from_branch()` (Task 1, 이미 `payload/scripts/`에 존재).
- Produces: `filter_release_issue_numbers(commit_shas: set[str], merged_prs: list[dict]) -> list[str]` — 순서 보존, dedupe됨.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/py/test_changelog_manager.py` 최상단(9번째 줄 `SCRIPT = ...` 정의) 바로 뒤에 direct-import 설정을 추가하고, 새 테스트 클래스를 파일 끝(마지막 클래스 뒤)에 추가한다:

```python
# (SCRIPT = ... 정의 바로 뒤에 추가)
SCRIPT_DIR = SCRIPT.parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from changelog_manager import filter_release_issue_numbers  # noqa: E402
```

```python
# 파일 끝에 추가
class TestFilterReleaseIssueNumbers(unittest.TestCase):
    def test_filters_by_merge_commit_sha_and_extracts_issue_number(self):
        commit_shas = {"abc123", "def456"}
        merged_prs = [
            {"number": 100, "headRefName": "20260823_#99_fix", "mergeCommit": {"oid": "abc123"}},
            {"number": 101, "headRefName": "20260823_#98_other", "mergeCommit": {"oid": "zzz999"}},
        ]
        self.assertEqual(filter_release_issue_numbers(commit_shas, merged_prs), ["99"])

    def test_dedupes_issue_numbers(self):
        commit_shas = {"a1", "a2"}
        merged_prs = [
            {"number": 1, "headRefName": "20260101_#5_first", "mergeCommit": {"oid": "a1"}},
            {"number": 2, "headRefName": "20260102_#5_second", "mergeCommit": {"oid": "a2"}},
        ]
        self.assertEqual(filter_release_issue_numbers(commit_shas, merged_prs), ["5"])

    def test_skips_prs_without_issue_number_in_branch(self):
        commit_shas = {"a1"}
        merged_prs = [{"number": 1, "headRefName": "worktree-issue-93-branch-strategy", "mergeCommit": {"oid": "a1"}}]
        self.assertEqual(filter_release_issue_numbers(commit_shas, merged_prs), [])

    def test_skips_prs_not_in_commit_shas(self):
        commit_shas = {"a1"}
        merged_prs = [{"number": 1, "headRefName": "20260101_#5_x", "mergeCommit": {"oid": "not-in-range"}}]
        self.assertEqual(filter_release_issue_numbers(commit_shas, merged_prs), [])

    def test_handles_missing_merge_commit_gracefully(self):
        commit_shas = {"a1"}
        merged_prs = [{"number": 1, "headRefName": "20260101_#5_x", "mergeCommit": None}]
        self.assertEqual(filter_release_issue_numbers(commit_shas, merged_prs), [])
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd tests/py && python3 -m unittest test_changelog_manager.TestFilterReleaseIssueNumbers -v`
Expected: `ImportError: cannot import name 'filter_release_issue_numbers'`로 FAIL

- [ ] **Step 3: 최소 구현**

3-1. `payload/scripts/changelog_manager.py` 최상단 import 블록(`import urllib.request` 줄, 현재 31번째 줄) 바로 뒤에 추가:

```python
import issue_helper
```

3-2. `classify_bump_level()`과 `_ai_assisted_minor_upgrade()` 뒤, `def cmd_classify_bump(commits_file: str) -> int:` (현재 408번째 줄) 바로 앞에 추가:

```python
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd tests/py && python3 -m unittest test_changelog_manager.TestFilterReleaseIssueNumbers -v`
Expected: 5개 테스트 모두 PASS

- [ ] **Step 5: 커밋**

```bash
git add payload/scripts/changelog_manager.py tests/py/test_changelog_manager.py
git commit -m "feat: develop 머지 PR 중 이번 릴리스에 포함된 이슈 번호를 필터링하는 함수 추가"
```

---

### Task 6: `changelog_manager.py` — `collect-issue-closes` CLI 서브커맨드

**Files:**
- Modify: `payload/scripts/changelog_manager.py` (`cmd_collect_issue_closes` + `main()` 서브파서)
- Test: `tests/py/test_changelog_manager.py`

**Interfaces:**
- Consumes: Task 5의 `filter_release_issue_numbers()`.
- Produces: CLI `changelog_manager.py collect-issue-closes --commit-shas-file <path> --merged-prs-file <path>` — stdout에 콤마로 구분된 이슈 번호 목록(없으면 빈 줄), exit 0.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/py/test_changelog_manager.py` 파일 끝(Task 5에서 추가한 `TestFilterReleaseIssueNumbers` 클래스 뒤)에 추가:

```python
class TestCollectIssueClosesCli(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def test_prints_comma_separated_issue_numbers(self):
        Path(self.tmp, "shas.txt").write_text("abc123\n", encoding="utf-8")
        Path(self.tmp, "prs.json").write_text(
            json.dumps([{"number": 1, "headRefName": "20260101_#7_x", "mergeCommit": {"oid": "abc123"}}]),
            encoding="utf-8",
        )
        r = run(
            ["collect-issue-closes", "--commit-shas-file", "shas.txt", "--merged-prs-file", "prs.json"],
            self.tmp,
        )
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "7")

    def test_empty_result_prints_empty_line(self):
        Path(self.tmp, "shas.txt").write_text("abc123\n", encoding="utf-8")
        Path(self.tmp, "prs.json").write_text("[]", encoding="utf-8")
        r = run(
            ["collect-issue-closes", "--commit-shas-file", "shas.txt", "--merged-prs-file", "prs.json"],
            self.tmp,
        )
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "")
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd tests/py && python3 -m unittest test_changelog_manager.TestCollectIssueClosesCli -v`
Expected: argparse가 `collect-issue-closes`를 모르는 서브커맨드로 인식해 exit code 2 → FAIL

- [ ] **Step 3: 최소 구현**

3-1. Task 5에서 추가한 `filter_release_issue_numbers()` 함수 바로 뒤에 추가:

```python
def cmd_collect_issue_closes(commit_shas_file: str, merged_prs_file: str) -> int:
    with open(commit_shas_file, encoding='utf-8') as f:
        commit_shas = {line.strip() for line in f if line.strip()}

    with open(merged_prs_file, encoding='utf-8') as f:
        merged_prs = json.load(f)

    issue_numbers = filter_release_issue_numbers(commit_shas, merged_prs)
    print(','.join(issue_numbers))
    return 0
```

3-2. `main()`의 서브파서 등록부(`p_ai_summary.add_argument('--diff-stat-file', ...)` 줄 바로 뒤, `args = parser.parse_args(argv)` 줄 바로 앞)에 추가:

```python
    p_collect = sub.add_parser('collect-issue-closes', help='develop에 머지된 PR 중 이번 릴리스에 포함된 이슈 번호 목록 추출')
    p_collect.add_argument('--commit-shas-file', required=True, help='이번 릴리스에 포함된 커밋 SHA 목록 파일 (한 줄당 1개)')
    p_collect.add_argument('--merged-prs-file', required=True, help='gh pr list --json number,headRefName,mergeCommit 출력 JSON 파일')
```

3-3. `main()`의 디스패치부(`if args.command == 'ai-summary': ...` 줄 바로 뒤)에 추가:

```python
    if args.command == 'collect-issue-closes':
        return cmd_collect_issue_closes(args.commit_shas_file, args.merged_prs_file)
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd tests/py && python3 -m unittest test_changelog_manager -v`
Expected: 파일 내 전체 테스트(기존 + 신규) 모두 PASS

- [ ] **Step 5: 커밋**

```bash
git add payload/scripts/changelog_manager.py tests/py/test_changelog_manager.py
git commit -m "feat: collect-issue-closes CLI 서브커맨드 추가"
```

---

### Task 7: `changelog_manager.py` — `.github/scripts/` 도그푸딩 사본 동기화

**Files:**
- Modify: `.github/scripts/changelog_manager.py` (payload 사본으로 완전히 교체)

**Interfaces:**
- Consumes: Task 5~6에서 완성된 `payload/scripts/changelog_manager.py`.
- Produces: 없음(동기화만).

- [ ] **Step 1: 두 파일이 지금 다르다는 것을 확인(diff)**

Run: `diff payload/scripts/changelog_manager.py .github/scripts/changelog_manager.py`
Expected: Task 5~6에서 추가한 내용만큼의 차이가 출력됨

- [ ] **Step 2: 동기화**

```bash
cp payload/scripts/changelog_manager.py .github/scripts/changelog_manager.py
```

- [ ] **Step 3: byte-identical 확인**

Run: `diff payload/scripts/changelog_manager.py .github/scripts/changelog_manager.py`
Expected: 출력 없음

- [ ] **Step 4: 이 저장소 자신의 `.github/scripts/issue_helper.py` import가 정상 동작하는지 확인**

Run: `python3 .github/scripts/changelog_manager.py collect-issue-closes --commit-shas-file /dev/null --merged-prs-file <(echo '[]')`
Expected: exit 0, 빈 줄 출력(`.github/scripts/` 디렉토리에서 `import issue_helper`가 sibling 파일을 정상적으로 찾음)

- [ ] **Step 5: 커밋**

```bash
git add .github/scripts/changelog_manager.py
git commit -m "chore: .github/scripts/changelog_manager.py를 payload 사본과 동기화"
```

---

### Task 8: `PROJECT-COMMON-AI-PR-SUMMARY.yaml` — feat PR 자동 이슈 연결 (payload)

**Files:**
- Modify: `payload/workflows/common/PROJECT-COMMON-AI-PR-SUMMARY.yaml`
- Test: `tests/node/ai-pr-summary.test.js`

**Interfaces:**
- Consumes: Task 3의 `issue_helper.py extract-branch-issue`/`link-pr-issues` CLI(설치 후 `.github/scripts/issue_helper.py`로 존재).
- Produces: 없음(워크플로우 스텝 추가만).

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/ai-pr-summary.test.js`의 마지막 테스트("trunk-based mode also installs it...") 뒤에 추가:

```javascript
test("PROJECT-COMMON-AI-PR-SUMMARY.yaml links the related issue via branch name", () => {
  const target = install();
  try {
    const content = readFileSync(join(target, ".github/workflows/PROJECT-COMMON-AI-PR-SUMMARY.yaml"), "utf8");
    assert.ok(content.includes("extract-branch-issue"));
    assert.ok(content.includes("link-pr-issues"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test tests/node/ai-pr-summary.test.js`
Expected: 새 테스트가 `content.includes("extract-branch-issue")`에서 FAIL

- [ ] **Step 3: 최소 구현**

`payload/workflows/common/PROJECT-COMMON-AI-PR-SUMMARY.yaml` 파일 끝(현재 마지막 줄, `"comment post failed — continuing (this workflow never blocks the PR)"` 다음)에 새 스텝을 추가한다:

```yaml

      - name: Link related issue via branch name
        continue-on-error: true
        env:
          GITHUB_TOKEN: ${{ github.token }}
        run: |
          HEAD_REF="${{ github.event.pull_request.head.ref }}"
          ISSUE_NUM=$(python3 .github/scripts/issue_helper.py extract-branch-issue "$HEAD_REF")

          if [ -z "$ISSUE_NUM" ]; then
            echo "브랜치명에서 이슈 번호를 찾지 못함 — 건너뜀: $HEAD_REF"
            exit 0
          fi

          python3 .github/scripts/issue_helper.py link-pr-issues \
            --pr ${{ github.event.pull_request.number }} \
            --issue-numbers "$ISSUE_NUM"
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/node/ai-pr-summary.test.js`
Expected: 4개 테스트 모두 PASS

- [ ] **Step 5: 커밋**

```bash
git add payload/workflows/common/PROJECT-COMMON-AI-PR-SUMMARY.yaml tests/node/ai-pr-summary.test.js
git commit -m "feat: AI-PR-SUMMARY에 브랜치명 기반 이슈 자동 연결 스텝 추가"
```

---

### Task 9: `PROJECT-COMMON-AI-PR-SUMMARY.yaml` — `.github/workflows/` 도그푸딩 사본 동기화

**Files:**
- Modify: `.github/workflows/PROJECT-COMMON-AI-PR-SUMMARY.yaml`
- Test: `tests/node/ai-pr-summary.test.js`

**Interfaces:**
- Consumes: Task 8에서 완성된 `payload/workflows/common/PROJECT-COMMON-AI-PR-SUMMARY.yaml`.
- Produces: 없음(동기화만).

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/ai-pr-summary.test.js` 파일 끝에 추가:

```javascript
test("도그푸딩 사본 AI-PR-SUMMARY에도 동일한 이슈 자동 연결 스텝이 있다", () => {
  const body = readFileSync(join(".github", "workflows", "PROJECT-COMMON-AI-PR-SUMMARY.yaml"), "utf8");
  assert.ok(body.includes("extract-branch-issue"));
  assert.ok(body.includes("link-pr-issues"));
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test tests/node/ai-pr-summary.test.js`
Expected: 새 테스트가 FAIL(`.github/workflows/PROJECT-COMMON-AI-PR-SUMMARY.yaml`에는 아직 이 스텝이 없음)

- [ ] **Step 3: 최소 구현**

`.github/workflows/PROJECT-COMMON-AI-PR-SUMMARY.yaml` 파일 끝에 Task 8과 **완전히 동일한** 스텝을 추가한다(이 새 스텝은 `{{MAIN_BRANCH}}`/`{{DEVELOP_BRANCH}}` 플레이스홀더를 전혀 참조하지 않으므로 payload 버전과 글자 그대로 동일하다):

```yaml

      - name: Link related issue via branch name
        continue-on-error: true
        env:
          GITHUB_TOKEN: ${{ github.token }}
        run: |
          HEAD_REF="${{ github.event.pull_request.head.ref }}"
          ISSUE_NUM=$(python3 .github/scripts/issue_helper.py extract-branch-issue "$HEAD_REF")

          if [ -z "$ISSUE_NUM" ]; then
            echo "브랜치명에서 이슈 번호를 찾지 못함 — 건너뜀: $HEAD_REF"
            exit 0
          fi

          python3 .github/scripts/issue_helper.py link-pr-issues \
            --pr ${{ github.event.pull_request.number }} \
            --issue-numbers "$ISSUE_NUM"
```

- [ ] **Step 4: 테스트 통과 확인 + 동기화 재검증**

Run: `node --test tests/node/ai-pr-summary.test.js`
Expected: 5개 테스트 모두 PASS

Run: `diff <(sed 's/{{MAIN_BRANCH}}/main/g; s/{{DEVELOP_BRANCH}}/develop/g' payload/workflows/common/PROJECT-COMMON-AI-PR-SUMMARY.yaml) .github/workflows/PROJECT-COMMON-AI-PR-SUMMARY.yaml`
Expected: 출력 없음(플레이스홀더 치환 후 완전히 동일)

- [ ] **Step 5: 커밋**

```bash
git add .github/workflows/PROJECT-COMMON-AI-PR-SUMMARY.yaml tests/node/ai-pr-summary.test.js
git commit -m "chore: .github/workflows/PROJECT-COMMON-AI-PR-SUMMARY.yaml를 payload 사본과 동기화"
```

---

### Task 10: `PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml` — release PR 자동 이슈 취합 (payload)

**Files:**
- Modify: `payload/workflows/common/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml`
- Test: `tests/node/payload-yaml.test.js`

**Interfaces:**
- Consumes: Task 6의 `changelog_manager.py collect-issue-closes` CLI, Task 3의 `issue_helper.py link-pr-issues` CLI.
- Produces: 없음(워크플로우 스텝 추가만).

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/payload-yaml.test.js`의 `changelogPath` 관련 테스트 블록 안(예: "AUTO-CHANGELOG-CONTROL grants models: read" 테스트 뒤 아무 곳)에 추가:

```javascript
test("AUTO-CHANGELOG-CONTROL collects issues merged into develop for release PR auto-close", () => {
  const body = readFileSync(changelogPath, "utf8");
  assert.ok(body.includes("collect-issue-closes"));
  assert.ok(body.includes("gh pr list --state merged --base {{DEVELOP_BRANCH}}"));
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test tests/node/payload-yaml.test.js`
Expected: 새 테스트가 `body.includes("collect-issue-closes")`에서 FAIL

- [ ] **Step 3: 최소 구현**

`payload/workflows/common/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml`의 "Collect commits since last release" 스텝(현재 97~109번째 줄, `echo "commits to summarize: $(wc -l < commits.txt)"`로 끝남) 바로 뒤, "Confirm release version (bump + sync)" 스텝(현재 111번째 줄) 바로 앞에 새 스텝을 삽입한다:

```yaml

      - name: Collect issues merged into {{DEVELOP_BRANCH}}
        continue-on-error: true
        env:
          GH_TOKEN: ${{ github.token }}
          GITHUB_TOKEN: ${{ github.token }}
        run: |
          git log --pretty=%H "origin/{{MAIN_BRANCH}}..HEAD" > commit_shas.txt

          gh pr list --state merged --base {{DEVELOP_BRANCH}} \
            --json number,headRefName,mergeCommit --limit 200 > merged_prs.json

          ISSUE_NUMBERS=$(python3 .github/scripts/changelog_manager.py collect-issue-closes \
            --commit-shas-file commit_shas.txt \
            --merged-prs-file merged_prs.json)

          rm -f commit_shas.txt merged_prs.json

          if [ -z "$ISSUE_NUMBERS" ]; then
            echo "이번 릴리스에 연결할 이슈 없음 — 건너뜀"
            exit 0
          fi

          python3 .github/scripts/issue_helper.py link-pr-issues \
            --pr ${{ github.event.pull_request.number }} \
            --issue-numbers "$ISSUE_NUMBERS" \
            --replace

          echo "이슈 연결: $ISSUE_NUMBERS"
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/node/payload-yaml.test.js`
Expected: 새 테스트 포함 전체 PASS(특히 "no hardcoded branch literals outside placeholders" 테스트도 여전히 PASS — 새 스텝은 `{{MAIN_BRANCH}}`/`{{DEVELOP_BRANCH}}` 플레이스홀더만 사용하고 리터럴 `develop`/`main`을 쓰지 않는다)

- [ ] **Step 5: 커밋**

```bash
git add payload/workflows/common/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml tests/node/payload-yaml.test.js
git commit -m "feat: AUTO-CHANGELOG-CONTROL에 develop 머지 이슈 자동 취합 스텝 추가"
```

---

### Task 11: `PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml` — `.github/workflows/` 도그푸딩 사본 동기화

**Files:**
- Modify: `.github/workflows/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml`
- Test: `tests/node/payload-yaml.test.js`

**Interfaces:**
- Consumes: Task 10에서 완성된 `payload/workflows/common/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml`.
- Produces: 없음(동기화만).

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/payload-yaml.test.js`의 "도그푸딩 사본 AUTO-CHANGELOG-CONTROL에도 동일한 병합 대기 + 트리거 잡이 있다" 테스트(현재 538~546번째 줄) 뒤에 추가:

```javascript
test("도그푸딩 사본 AUTO-CHANGELOG-CONTROL에도 동일한 이슈 취합 스텝이 있다", () => {
  const body = readFileSync(join(".github", "workflows", "PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml"), "utf8");
  assert.ok(body.includes("collect-issue-closes"));
  assert.ok(body.includes("gh pr list --state merged --base develop"));
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test tests/node/payload-yaml.test.js`
Expected: 새 테스트가 FAIL

- [ ] **Step 3: 최소 구현**

`.github/workflows/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml`의 "Collect commits since last release" 스텝(현재 97~109번째 줄) 바로 뒤에 Task 10과 동일한 스텝을, `{{MAIN_BRANCH}}` → `main`, `{{DEVELOP_BRANCH}}` → `develop`로 치환해 삽입한다:

```yaml

      - name: Collect issues merged into develop
        continue-on-error: true
        env:
          GH_TOKEN: ${{ github.token }}
          GITHUB_TOKEN: ${{ github.token }}
        run: |
          git log --pretty=%H "origin/main..HEAD" > commit_shas.txt

          gh pr list --state merged --base develop \
            --json number,headRefName,mergeCommit --limit 200 > merged_prs.json

          ISSUE_NUMBERS=$(python3 .github/scripts/changelog_manager.py collect-issue-closes \
            --commit-shas-file commit_shas.txt \
            --merged-prs-file merged_prs.json)

          rm -f commit_shas.txt merged_prs.json

          if [ -z "$ISSUE_NUMBERS" ]; then
            echo "이번 릴리스에 연결할 이슈 없음 — 건너뜀"
            exit 0
          fi

          python3 .github/scripts/issue_helper.py link-pr-issues \
            --pr ${{ github.event.pull_request.number }} \
            --issue-numbers "$ISSUE_NUMBERS" \
            --replace

          echo "이슈 연결: $ISSUE_NUMBERS"
```

- [ ] **Step 4: 테스트 통과 확인 + 동기화 재검증**

Run: `node --test tests/node/payload-yaml.test.js`
Expected: 전체 PASS

Run: `diff <(sed 's/{{MAIN_BRANCH}}/main/g; s/{{DEVELOP_BRANCH}}/develop/g' payload/workflows/common/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml) .github/workflows/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml`
Expected: 출력 없음(플레이스홀더 치환 후 완전히 동일)

- [ ] **Step 5: 커밋**

```bash
git add .github/workflows/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml tests/node/payload-yaml.test.js
git commit -m "chore: .github/workflows/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml를 payload 사본과 동기화"
```

---

### Task 12: 전체 회귀 테스트 및 최종 검증

**Files:**
- 없음(검증 전용 태스크, 코드 변경 없음)

**Interfaces:**
- Consumes: Task 1~11의 모든 변경.
- Produces: 없음.

- [ ] **Step 1: node 전체 테스트 실행**

Run: `npm run test:node`
Expected: 기존 465개 + 이번 계획에서 추가한 노드 테스트(Task 8: 1개, Task 9: 1개, Task 10: 1개, Task 11: 1개 = +4개, 총 469개) 모두 PASS, 0 fail

- [ ] **Step 2: python 전체 테스트 실행**

Run: `npm run test:py`
Expected: 기존 130개 + 이번 계획에서 추가한 파이썬 테스트(Task 1: 4개, Task 2: 7개, Task 3: 5개, Task 5: 5개, Task 6: 2개 = +23개, 총 153개) 모두 PASS, 0 fail

- [ ] **Step 3: `payload/scripts/*.py`와 `.github/scripts/*.py` 최종 byte-identical 재확인**

Run: `diff payload/scripts/issue_helper.py .github/scripts/issue_helper.py && diff payload/scripts/changelog_manager.py .github/scripts/changelog_manager.py && echo "OK: 완전히 동일"`
Expected: `OK: 완전히 동일` 출력

- [ ] **Step 4: 커밋 로그 확인**

Run: `git log --oneline origin/main..HEAD`
Expected: Task 1~11의 11개 커밋이 순서대로 보임(Task 12는 코드 변경이 없으므로 커밋하지 않음)
