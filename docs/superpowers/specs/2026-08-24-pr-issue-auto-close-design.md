# PR-이슈 자동 종료(Closes) 연결 — 설계 스펙

- 날짜: 2026-08-24
- 상태: 사용자 승인된 설계 (브레인스토밍 완료)
- 관련 이슈: [Twin-Fang/project-auto-wizard#102](https://github.com/Twin-Fang/project-auto-wizard/issues/102)

## 1. 배경 / 문제

이 저장소는 `version.yml`의 `metadata.template.branches.mode`가 `pr-flow`로, `feat → develop → main` 흐름을 전제로 한다. 그런데 이 흐름의 어느 단계에서도 GitHub의 PR-이슈 자동 종료(`Closes #N`)가 실제로 동작하지 않는다.

**원인 (A) — feat PR:** GitHub은 `Closes #N` 키워드를 PR의 base 브랜치가 저장소의 **기본(default) 브랜치**일 때만 파싱해서 이슈와 연결한다([GitHub 공식 문서](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue): *"The special keywords ... are interpreted only when the pull request targets the repository's default branch."*). 이 저장소의 기본 브랜치는 `main`이다. 그런데:
- `CONTRIBUTING.md`는 "PR은 `develop`을 향해 엽니다"라고 안내하지만, `PROJECT-COMMON-ISSUE-HELPER.yaml`의 `ISSUE_HELPER_BASE_BRANCH`는 `"main"`으로 설정되어 있어 문서와 자동화 설정이 어긋나 있다.
- 설령 feat PR이 `main`을 base로 열리더라도, `.github/PULL_REQUEST_TEMPLATE.md`에는 `Closes #N`을 채워 넣을 자리가 없어 작성자가 매번 수동으로 적어야 하고, 실제로는 대부분 누락된다.

**원인 (B) — release PR(develop → main):** `pr-flow`의 실제 배포는 `AUTO-CHANGELOG-CONTROL`이 관리하는 `develop → main` 릴리스 PR을 통해서만 이뤄진다. `develop`에 먼저 머지됐던(그래서 자동 종료가 안 됐던) 이슈들은, 릴리스 PR이 `main`에 머지되는 시점에도 자동으로 닫히지 않는다. `AUTO-CHANGELOG-CONTROL`은 릴리스에 포함된 커밋 목록을 이미 계산하지만(`commits.txt`), 이 커밋들과 연결된 이슈 번호를 릴리스 PR 본문에 반영하는 로직이 없다.

**실측 확인 (2026-08-23):** PR #100(이슈 #99)은 base가 `develop`이라 본문에 `Closes #99`를 적어도 `gh pr view 100 --json closingIssuesReferences`가 빈 배열을 반환했다. 이후 릴리스 PR #101(develop → main)이 병합됐지만, PR #101의 본문은 애초에 비어 있었고(`AUTO-CHANGELOG-CONTROL`은 본문이 아니라 코멘트만 남김) 이슈 #99는 여전히 `OPEN` 상태로 남아 있다.

## 2. 적용 범위

- (A) feat PR 자동 연결과 (B) release PR 자동 취합을 하나의 계획으로 함께 구현한다.
- `payload/workflows/common/`(사용자 배포용 템플릿)과 `.github/workflows/`(이 저장소 자신의 도그푸딩 사본) 양쪽에 동일하게 반영한다. `CONTRIBUTING.md`가 명시하는 대로 **`payload/`가 단일 진실**이며, `.github/`는 `{{MAIN_BRANCH}}` → `main`, `{{DEVELOP_BRANCH}}` → `develop` 치환만 다른 byte-identical 사본이다(`issue_helper.py`처럼 브랜치명을 직접 참조하지 않는 스크립트는 두 위치가 완전히 동일해야 한다).
- 기본값은 항상 켜짐(마법사 질문/토글 없음) — `ISSUE_HELPER_CREATE_BRANCH`(부작용이 큰 브랜치 자동 생성)와 달리, 이슈 자동 종료는 원치 않을 이유가 거의 없는 기본 동작으로 판단.
- (A)는 `pr-flow`/`trunk-based` 두 모드 모두에서 자연스럽게 동작한다 — `AI-PR-SUMMARY`가 이미 두 모드 공통으로 도는 워크플로우이므로 모드 분기가 필요 없다.
- (B)는 `AUTO-CHANGELOG-CONTROL`(develop→main 릴리스 PR 전용 워크플로우)에만 붙으므로 자동으로 `pr-flow` 전용이 된다.
- PR 템플릿(`.github/PULL_REQUEST_TEMPLATE.md`)은 수정하지 않는다 — 워크플로우가 PR 본문을 직접 편집하는 방식이라 템플릿에 자리를 미리 마련해둘 필요가 없다. (참고: 이 파일은 `payload/`에 대응 파일이 없는 이 저장소 전용 자산이다.)
- 두 워크플로우 모두 이 기능이 실패해도 **PR/릴리스 파이프라인 자체를 막지 않는다** — 기존 코멘트 게시 스텝들이 이미 따르는 "이 워크플로우는 절대 PR/릴리스를 막지 않는다" 원칙과 동일하게, 실패 시 로그만 남기고 계속 진행한다.

## 3. 공유 로직: `issue_helper.py`에 브랜치명 → 이슈번호 추출 함수 신설

`issue_helper.py`는 이미 "브랜치명 ↔ 이슈번호" 도메인을 소유한다 (`create_branch_name()`이 `{date}_#{issue_number}_{title}` 형태의 브랜치명을 만드는 정방향 함수). 이번에 필요한 것은 그 역방향 — 브랜치명에서 이슈 번호를 다시 추출하는 함수다.

```
extract_issue_number_from_branch(branch_name: str) -> str | None
```

- `create_branch_name()`이 만드는 `#(\d+)` 패턴을 매칭해 이슈 번호만 반환한다.
- 패턴이 없으면(이슈 기반이 아닌 브랜치 — 과거 `worktree-issue-93-branch-strategy` 같은 예외 네이밍 포함) `None`을 반환한다. 호출부는 이를 "스킵" 신호로 사용한다.
- CLI에서 재사용할 수 있도록 새 서브커맨드를 추가한다: `python3 issue_helper.py extract-branch-issue "<branch_name>"`. 이슈 번호를 찾으면 stdout에 그 번호만 출력하고 exit 0, 못 찾으면 **정상적인 "해당 없음" 케이스**이므로 아무것도 출력하지 않고 exit 0(실패가 아니다 — exit 0 + 빈 stdout으로 호출부가 `if [ -z "$ISSUE_NUM" ]`로 분기). 기존 `version_manager.py`류의 `... | tail -n 1` 소비 관례를 따른다.
- `payload/scripts/issue_helper.py`와 `.github/scripts/issue_helper.py`에 동일하게 반영(byte-identical 유지).
- `tests/py/test_issue_helper.py`에 유닛 테스트 추가: 정상 매칭, 예외 네이밍(매칭 실패), 이슈 번호가 여러 자리 숫자인 경우, 브랜치명에 `#`이 여러 번 나오는 경우(가장 먼저 나오는 것만 사용 — `create_branch_name`의 출력 형식상 항상 두 번째 `_` 구분자 앞에 오므로 첫 매칭이 곧 정답) 등을 커버한다.

## 4. (A) feat PR 자동 연결 — `PROJECT-COMMON-AI-PR-SUMMARY.yaml` 확장

기존 트리거를 그대로 재사용한다: `pull_request: [opened, synchronize, reopened]`, `branches: ["{{MAIN_BRANCH}}"]`, `head.ref != '{{DEVELOP_BRANCH}}'`. "Generate and post AI summary" 스텝 뒤에 새 스텝 "Link related issue via branch name"을 추가한다.

동작:
1. `HEAD_REF="${{ github.event.pull_request.head.ref }}"`에서 `extract-branch-issue` 서브커맨드로 이슈 번호를 추출한다.
2. 이슈 번호가 없으면 스텝을 조용히 종료한다(`continue-on-error` 불필요 — 애초에 실패가 아니라 정상적인 "해당 없음" 케이스).
3. 이슈 번호가 있으면 `gh pr view "$PR_NUMBER" --json body --jq .body`로 현재 본문을 읽는다.
4. 본문에 `<!-- auto-issue-link -->` 마커가 이미 있으면 스킵한다(브랜치명이 PR 생애주기 동안 바뀌지 않으므로, `synchronize` 재실행 시 중복 삽입을 막기 위해 1회만 삽입하면 충분하다).
5. 마커가 없으면 본문 끝에 다음을 추가하고 `gh pr edit "$PR_NUMBER" --body-file -`로 반영한다:
   ```
   <!-- auto-issue-link -->
   Closes #<이슈번호>
   ```
6. 이 스텝은 `continue-on-error: true`로 표시해, PR 본문 편집이 실패(권한/API 오류 등)해도 AI 요약 코멘트나 PR 자체는 영향받지 않게 한다.

## 5. (B) release PR 자동 취합 — `PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml` 확장

"Collect commits since last release" 스텝 뒤에 새 스텝 "Collect issues merged into {{DEVELOP_BRANCH}}"를 추가한다.

동작:
1. `git log --pretty=%H "origin/{{MAIN_BRANCH}}..HEAD"`로 이번 릴리스에 포함된 커밋 SHA 목록을 확보한다(기존 `commits.txt`는 subject만 담으므로 SHA는 별도로 수집).
2. `gh pr list --state merged --base {{DEVELOP_BRANCH}} --json number,headRefName,mergeCommit --limit 200`으로 `{{DEVELOP_BRANCH}}`에 머지된 PR 목록을 조회한다. 200개를 넘는 경우(사실상 발생하지 않을 규모지만) 로그에 경고를 남기고 조회된 범위 내에서만 처리한다 — 조용한 누락 대신 명시적 경고.
3. 두 목록을 `mergeCommit.oid`가 커밋 SHA 목록에 포함되는지로 교차 필터링해 "이번 릴리스에 실제로 포함된 PR"만 확정한다. 커밋 메시지 텍스트가 아니라 실제 머지 커밋 SHA로 대조하므로, 커밋 메시지가 이 프로젝트의 컨벤션(이슈 URL 포함)을 따르지 않아도 정확하다.
4. 확정된 각 PR의 `headRefName`에서 `extract-branch-issue`로 이슈 번호를 추출하고 dedupe한다.
5. 이슈가 하나도 없으면(예: 릴리스에 포함된 커밋이 전부 이슈 기반이 아님) 스텝을 조용히 종료한다.
6. 이슈가 있으면 release PR 본문을 읽어 `<!-- auto-issue-link -->` 마커 블록을 찾는다:
   - 마커가 있으면 그 블록을 **새로 계산한 목록으로 치환**한다(추가가 아니라 치환 — `synchronize`마다 `{{DEVELOP_BRANCH}}`에 커밋이 더 늘어날 수 있으므로 (A)와 달리 매번 재계산이 필요하다).
   - 마커가 없으면 본문 끝에 새로 추가한다.
   - 형식:
     ```
     <!-- auto-issue-link -->
     Closes #A
     Closes #B
     ```
7. `gh pr edit "$PR_NUMBER" --body-file -`로 반영한다. 이 스텝도 `continue-on-error: true`로, 실패해도 버전 확정/체인지로그/자동머지 등 릴리스 파이프라인 본체는 계속 진행된다.

## 6. 실패 격리 원칙

두 워크플로우 모두 다음을 지킨다(기존 AI 요약 코멘트 게시 스텝이 이미 따르는 원칙과 동일):
- PR 본문 조회/편집이 실패해도 워크플로우의 나머지 스텝(AI 요약, 버전 확정, 체인지로그, 자동머지)은 계속 진행된다.
- 실패는 로그에 명확히 남기되(`echo "::warning::..."` 또는 유사), 성공한 것처럼 침묵하지 않는다.

## 7. 테스트 방침

- 신설하는 `extract_issue_number_from_branch()`는 `tests/py/test_issue_helper.py`에 유닛 테스트를 추가한다(이 프로젝트 관례상 파이썬 헬퍼 로직은 항상 테스트 대상).
- 워크플로우 YAML의 bash 스텝(PR 본문 편집, `gh pr list` 교차 필터링)은 이 저장소에 GH Actions 통합 테스트가 없는 기존 관례상 별도 테스트를 추가하지 않는다 — 실제 PR/릴리스 사이클을 통해서만 검증 가능하다.
- 이 계획을 구현하는 PR 자체가 (A)의 첫 실사용 검증이 된다(head가 `{{DEVELOP_BRANCH}}`가 아니고 `{{MAIN_BRANCH}}`를 base로 열리는 경우).
- 기존 회귀 테스트(node 465개 + python 130개)가 그대로 통과하는지 확인한다.

## 8. 범위 밖 (이번에 다루지 않음)

- `CONTRIBUTING.md`의 "PR은 develop을 향해 엽니다" 문구와 `PROJECT-COMMON-ISSUE-HELPER.yaml`의 `ISSUE_HELPER_BASE_BRANCH: "main"` 설정 간 불일치 정리 — 이슈 #102 본문에서도 "선택, 별도 이슈로 분리 가능"으로 명시된 항목이며, 문서/설정 중 무엇을 실제 관행에 맞출지는 별도 논의가 필요하다.
- feat PR을 `main`으로만 열도록 강제하는 브랜치 전략 자체의 재설계.
