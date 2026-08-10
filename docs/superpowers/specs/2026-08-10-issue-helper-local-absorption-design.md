# 이슈 헬퍼 로컬 흡수 — 설계 스펙

- 날짜: 2026-08-10
- 상태: 사용자 승인된 설계 (브레인스토밍 완료)
- 관련 이슈: [Twin-Fang/project-auto-wizard#68](https://github.com/Twin-Fang/project-auto-wizard/issues/68)
- 원본: [Chuseok22/github-issue-helper](https://github.com/Chuseok22/github-issue-helper) (동일 작성자, `main` 브랜치 `src/normalize.ts`·`src/index.ts`·`src/branch.ts`·`action.yml` 확인 완료)

## 1. 배경 / 문제

`.github/workflows/GITHUB-ISSUE-HELPER.yml`이 `uses: Chuseok22/github-issue-helper@v1`로 이 레포 밖의 오픈소스 액션을 그대로 호출한다. 이 레포는 오픈소스 공모전 출품작인데, 실질 기능이 다른 레포에 있고 이쪽은 `uses:` 한 줄만 남는 상태는 출품 산출물로서 부적절하다. 그 액션은 License가 없는 저장소이며(현재는 동일 작성자 소유라 문제는 아니지만 문서화되어야 함), 생성되는 댓글에 `Chuseok22 issue helper`라는 외부 브랜딩이 박히고, `@v1` 태그에 저장소 존속이 묶여 있다.

## 2. 아키텍처 결정: payload 기능으로 흡수

이 레포는 이미 `payload/scripts/*.py`(stdlib only)를 워크플로우가 `python3`로 호출하는 확립된 패턴을 갖고 있다 (`version_manager.py`, `changelog_manager.py`, `truncate_release_notes.py`). 이슈 헬퍼도 같은 자리에 넣어 구조를 일관되게 유지하고, 동시에 **설치 대상 레포에도 이 기능을 제공하는 신규 product 기능**으로 승격한다.

Node 액션을 그대로 복사(포크)하지 않는 이유:
- 대상 레포는 번들 산출물(`dist/index.js`, 1.1MB+)을 커밋해 배포하며, `@actions/core`/`@actions/github` 런타임 의존이 따라온다.
- `payload/scripts/`는 stdlib(`re`, `json`, `urllib.request`, `unicodedata`)만으로 충분하고, `docs/DESIGN-SPEC.md` §2가 "스크립트는 전부 Python"을 명시한다.

### 신규/변경 파일

| 파일 | 역할 |
|---|---|
| `payload/scripts/issue_helper.py` (신규) | 정규화 로직 + GitHub REST 호출(댓글 생성/갱신, 브랜치 생성). stdlib only. |
| `payload/workflows/common/PROJECT-COMMON-ISSUE-HELPER.yaml` (신규) | 기존 `PROJECT-COMMON-*` 네이밍 컨벤션. `issues: [opened, edited]` 트리거, `python3 .github/scripts/issue_helper.py` 호출. `base_branch` 기본값에 `{{MAIN_BRANCH}}` 플레이스홀더 사용(다른 payload 워크플로우와 일관). |
| `.github/scripts/issue_helper.py` (신규, 셀프호스팅) | payload 원본과 **동일 내용** (기존 `version_manager.py` 등과 같은 관례 — `diff`로 동일함이 보장되어야 함). |
| `.github/workflows/PROJECT-COMMON-ISSUE-HELPER.yaml` (신규, 셀프호스팅) | payload 버전에서 `{{MAIN_BRANCH}}` → `main`으로 수동 치환한 최종형 (`CONTRIBUTING.md`가 명시하는 "payload가 단일 진실, `.github/workflows/`는 도그푸딩 산출물이라 수동 동기화 필요" 규칙을 따름). |
| `.github/workflows/GITHUB-ISSUE-HELPER.yml` (삭제) | 새 파일로 대체. 외부 액션 호출부 제거가 이슈의 핵심 완료 조건. |
| `src/core/copy/simple.js` (수정) | `copyScripts()`의 하드코딩 배열 `["version_manager.py", "changelog_manager.py", "truncate_release_notes.py"]`에 `"issue_helper.py"` 추가 — 없으면 payload에 파일이 있어도 사용자 레포에 설치되지 않는다(과거 #51에서 확인된 동일 함정). |
| `src/core/removal-plan.js` (수정) | 삭제 계획을 만드는 동일 배열에도 `"issue_helper.py"` 추가 (제거하지 않으면 uninstall/purge가 이 스크립트를 놓친다). |
| `src/ui/summary.js` (수정) | 설치 완료 안내에 출력되는 스크립트 목록에 `issue_helper.py` 추가. |
| `tests/py/test_issue_helper.py` (신규) | 정규화 로직 단위 테스트. |

`payload/workflows/common/`의 `.yaml` 파일 자체는 설치 엔진(`src/core/copy/workflows.js`)이 디렉토리를 스캔해 자동으로 픽업하므로(`listYamlFiles`), 워크플로우 쪽은 별도의 하드코딩 리스트 수정이 필요 없다 — **스크립트 3곳만** 수동 등록이 필요하다.

## 3. 포팅 대상 로직

`Chuseok22/github-issue-helper`의 실제 소스를 확인했다:

| 원본 (`src/*.ts`) | Python 대상 | 비고 |
|---|---|---|
| `normalize.ts::extractIssueNumber` | `extract_issue_number()` | URL 끝 세그먼트(trailing slash 제거 후) 추출 |
| `normalize.ts::extractIssueTitle` | `extract_issue_title()` | `[.*?]` 제거 → 이모지/제어문자 제거, 결과가 비면 원본 유지. **Python은 `\p{So}`/`\p{C}` 미지원** → `unicodedata.category(ch)`가 `"So"`이거나 `"C"`로 시작(`Cc`/`Cf`/`Co`/`Cs`)하면 제거 + `U+FE0F`(variation selector, 카테고리가 `Mn`이라 정규식에서 별도 명시)·`U+200D`(ZWJ, `Cf`라 이미 커버되지만 명시적으로 유지) |
| `normalize.ts::normalizeTitle` | `normalize_title()` | `[^a-zA-Z0-9가-힣]` → `_`, 연속 `_+` → `_`, 앞뒤 `_` 제거 |
| `normalize.ts::createBranchName` | `create_branch_name()` | `normalize_title(title)` 적용 후 `{date}_#{issue_number}_{normalized}`, `max_branch_length`로 자름(**prefix 제외**하고 자른 뒤 prefix를 앞에 붙임 — 원본과 동일 순서) |
| `normalize.ts::renderCommitMessage` | `render_commit_message()` | `${issueTitle}`(정규화된 제목)/`${issueUrl}`/`${issueNumber}`/`${branchName}`/`${date}` 치환 후 `.strip()` |
| `index.ts` (이벤트 처리) | `main()` / `run()` | `GITHUB_EVENT_PATH` JSON에서 `action`/`issue.title`/`issue.html_url`/`issue.number`/`changes.title` 읽음. `opened` 또는 `edited`+제목변경만 처리, 그 외는 조용히 종료 |
| `index.ts` (댓글 관리) | `upsert_comment()` | 마커(`comment_marker`)로 기존 댓글 검색(페이지네이션) → 있으면 update, 없으면 create. `urllib.request` + `GITHUB_TOKEN` |
| `branch.ts::createBranchIfNeeded` | `create_branch_if_needed()` | `create_branch=false`면 즉시 반환. `base_branch` 미지정 시 레포 `default_branch` 조회. base ref의 SHA로 `refs/heads/{branchName}` 생성, 422(이미 존재)는 조용히 스킵, 그 외 에러는 전파 |

### 설정값 (기존 워크플로우와 동일하게 유지)

- `branch_prefix`: `""`
- `max_branch_length`: `100` (원본 액션 기본값 `120`이 아니라, 기존 워크플로우가 명시적으로 넘기던 `100`을 유지)
- `commit_template`: `"${issueTitle} : feat : {변경 사항에 대한 설명} ${issueUrl}"`

이 부분은 "어디서 도는가"만 바꾸는 것이지 "무엇을 하는가"를 바꾸는 게 아니므로 그대로 이식한다.

## 4. 확정된 동작 변경

이슈 본문이 명시적으로 "결정이 필요하다"고 표시한 두 항목 — 사용자 확인 완료:

1. **`create_branch` 기본값을 `true` → `false`로 변경.** 댓글 생성/갱신은 그대로 이벤트마다 자동 실행되지만, 브랜치 자동 생성은 옵트인으로 전환한다. (현재 원격 브랜치 49개 중 상당수가 이 자동 생성으로 만들어졌다는 정황이 확인됨.)
2. **날짜 타임존을 KST로 고정.** 원본은 GitHub Actions 러너의 로컬 시간(UTC 기본)을 그대로 썼다. Python 구현은 `datetime.now(timezone(timedelta(hours=9)))`로 계산해 러너 타임존과 무관하게 항상 KST 기준 날짜(`YYYYMMDD`)를 사용한다.

## 5. 브랜딩 / 마커 교체

- 댓글 마커: `<!-- Chuseok22 issue helper -->` → `<!-- project-auto-wizard issue helper -->`
- 댓글 본문 헤더: `## Chuseok22 Issue Helper` → `## Issue Helper`
- 마커 문자열이 바뀌므로 과거 이슈에 이미 달린 댓글은 이 변경 이후에도 갱신 없이 그대로 남는다 — 이슈 본문이 이미 이 동작을 허용했다("과거 이슈는 그대로 두는 것으로 충분").
- `issue_helper.py` 상단 docstring에 `version_manager.py`(SUH-DEVOPS-TEMPLATE 유래 명시)와 같은 방식으로 출처를 표기한다: "Chuseok22/github-issue-helper(동일 작성자 소유, 라이선스 미설정 저장소)를 Python으로 재작성". 작성자가 두 저장소 모두 동일인이므로 별도의 동의 절차 없이 출처 표기로 충분하다.

## 6. 스크립트 계약

```
issue_helper.py run
```

- 인자 없이 `run` 서브커맨드 하나만 제공한다(다른 payload 스크립트처럼 `get`/`set` 등 여러 서브커맨드를 둘 이유가 없음 — 이 스크립트는 이벤트 1건을 처리하는 원샷 액션).
- 입력은 환경 변수로만 받는다: `GITHUB_EVENT_PATH`(이벤트 JSON 경로), `GITHUB_TOKEN`, `GITHUB_REPOSITORY`(`owner/repo`), 그리고 워크플로우가 채워 넣는 `ISSUE_HELPER_BRANCH_PREFIX`/`ISSUE_HELPER_MAX_BRANCH_LENGTH`/`ISSUE_HELPER_COMMIT_TEMPLATE`/`ISSUE_HELPER_CREATE_BRANCH`/`ISSUE_HELPER_BASE_BRANCH`/`ISSUE_HELPER_COMMENT_MARKER`. (`version_manager.py`류가 CLI 인자를 쓰는 것과 달리 이 스크립트는 GitHub Actions 컨텍스트 전용이라 env var가 자연스럽다 — action.yml의 `inputs:` → env 매핑과 동일한 관례.)
- `action=opened` 또는 (`action=edited` and `changes.title` 존재)가 아니면 조용히 exit 0.
- 정규화 후 댓글 upsert, 이어서 `create_branch`가 true면 브랜치 생성 시도.
- 성공 시 exit 0. GitHub API 호출 실패(네트워크/권한)는 예외를 그대로 노출해 워크플로우가 실패로 표시되게 한다(원본 액션의 `core.setFailed`와 동등한 가시성).
- stdout에 `branchName`/`commitMessage`를 `GITHUB_OUTPUT`에 기록해 워크플로우 후속 스텝에서 참조 가능하게 한다 (원본의 `core.setOutput`과 동등).

## 7. 테스트

`tests/py/test_issue_helper.py` (기존 `test_version_manager.py` 스타일, unittest 기반):

- `extract_issue_number`: 정상 URL, trailing slash
- `extract_issue_title`: `[태그]` 제거, 이모지 제거, 제어문자 제거, 변형 선택자(`U+FE0F`)·ZWJ(`U+200D`) 제거, 제거 후 빈 문자열이면 원본 유지
- `normalize_title`: 한글/영문/숫자 유지, 특수문자 `_` 치환, 연속 `_` 축약, 앞뒤 `_` 트림
- `create_branch_name`: prefix 적용, `max_branch_length` 자르기(prefix 제외하고 자름 확인)
- `render_commit_message`: 5개 변수 전부 치환, 미사용 변수는 그대로 둠(원본과 동일 — 템플릿에 없는 변수는 애초에 치환 대상이 아님)

GitHub REST 호출부(댓글 생성/갱신, 브랜치 생성)는 순수 함수가 아니므로 단위 테스트 범위에서 제외한다 — 이슈 완료 조건이 명시한 테스트 범위(정규화 로직)와 일치하며, 실제 동작 확인은 실제 이슈로 수동 검증한다(완료 조건 마지막 항목).

## 8. 완료 조건 매핑

- [x] `uses: Chuseok22/github-issue-helper@v1` 제거 → `.github/workflows/GITHUB-ISSUE-HELPER.yml` 삭제, `PROJECT-COMMON-ISSUE-HELPER.yaml`로 대체
- [x] 로직이 레포 안에 존재하고 워크플로우가 그것만 호출 → `payload/scripts/issue_helper.py`
- [x] 댓글 마커·제목에서 외부 브랜딩 제거
- [x] 정규화 로직 단위 테스트
- [x] 원저작자 동의/출처 표기 방침 확정 → 동일 작성자 확인, docstring 출처 표기로 충분
- [ ] 이슈를 열어 댓글 생성 → 제목 수정 후 댓글 갱신까지 실제 동작 확인 → 구현 완료 후 수동 검증
