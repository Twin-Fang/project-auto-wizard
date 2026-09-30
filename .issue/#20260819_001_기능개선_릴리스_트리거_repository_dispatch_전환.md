<!-- GitHub Issue: #90 | https://github.com/Twin-Fang/project-auto-wizard/issues/90 -->
🚀[기능개선][CICD] 릴리스 파이프라인 후속 워크플로우 트리거를 repository_dispatch 방식으로 전환

### 어떤 문제를 해결하고 싶으신가요?

릴리스 파이프라인(`PROJECT-COMMON-AUTO-CHANGELOG-CONTROL` → `PROJECT-COMMON-RELEASE-PUBLISH` → `NPM-PUBLISH`)이 두 지점에서 `secrets.WORKFLOW_PAT || github.token` 폴백에 의존하고 있습니다.

- `payload/workflows/common/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml:248` — "Enable automerge" 스텝. 병합에 `WORKFLOW_PAT`가 없으면 plain `github.token`으로 병합되는데, GitHub Actions 정책상 GITHUB_TOKEN이 만든 push/이벤트는 다른 워크플로우를 재트리거하지 못해 `PROJECT-COMMON-RELEASE-PUBLISH`가 깨어나지 않습니다.
- `payload/workflows/common/PROJECT-COMMON-RELEASE-PUBLISH.yaml:357` — "Create GitHub Release" 스텝. 마찬가지로 `WORKFLOW_PAT`가 없으면 발행된 `release` 이벤트가 `NPM-PUBLISH`(`on: release: types: [published]`)를 깨우지 못합니다. `payload/workflows/common/NPM-PUBLISH.yaml:20` 헤더 주석에도 "전제: RELEASE-PUBLISH가 WORKFLOW_PAT으로 Release를 발행해야 이 워크플로우가 뜬다"고 명시돼 있고, 이슈 #35로 이미 알려진 문제입니다.

즉 `project-auto-wizard`를 설치한 모든 프로젝트가 **수동으로 PAT를 발급받아 `WORKFLOW_PAT` 시크릿으로 등록해야만** 릴리스→npm 배포 체인이 끝까지 완주합니다. 등록을 깜빡하면(또는 처음엔 필요 없어 보여 건너뛰면) 조용히 체인이 끊기고, "PR은 병합됐는데 릴리스도 npm 배포도 안 된" 상태가 아무 에러 표시 없이 남습니다. 실제로 이 저장소 자신도 이 문제로 두 번(develop 없이 main 직접 병합 시 드리프트, 그리고 WORKFLOW_PAT 미적용 구간)을 겪었습니다.

### 제안하는 해결 방법

개인적으로 운영 중인 유사 버전관리 GitHub Action인 [Chuseok22/version-management](https://github.com/Chuseok22/version-management)의 `auto-version.yml`이 쓰는 방식을 참고합니다. 이 워크플로우는 버전 bump 직후 `repository_dispatch`(`event_type: version-bumped`, `client_payload`에 new_version/new_tag/bump_level/sha 포함)를 **plain `GITHUB_TOKEN`으로** 발행해 후속 워크플로우를 깨웁니다. GitHub Actions 정책상 `workflow_dispatch`/`repository_dispatch`는 "GITHUB_TOKEN이 만든 이벤트는 다른 워크플로우를 재트리거하지 않는다"는 규칙의 **명시적 예외**이기 때문에, 별도 PAT 없이도 항상 확실하게 다음 워크플로우가 실행됩니다.

이 패턴을 project-auto-wizard에 이식하는 방향을 제안합니다:

- `PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml`의 "Enable automerge" 스텝 성공 직후, `repository_dispatch`(예: `event_type: release-confirmed`, payload에 버전/PR 번호 포함)를 plain `github.token`으로 발행하고, `PROJECT-COMMON-RELEASE-PUBLISH.yaml`이 이를 `on: repository_dispatch` 트리거로 받도록 변경 검토.
- `PROJECT-COMMON-RELEASE-PUBLISH.yaml`의 "Create GitHub Release" 스텝 직후에도 동일하게 `repository_dispatch`를 발행하고, `NPM-PUBLISH.yaml`이 이를 트리거로 받도록 변경 검토(기존 `on: release: types: [published]`는 유지하되 보조 트리거로 남기거나 대체).
- 위 변경이 안정화되면 `WORKFLOW_PAT` 시크릿 요구사항 자체를 제거하거나, 다른 목적(있다면)으로만 선택적으로 남기는 방향 검토.
- `payload/workflows/common/*.yaml`(배포 템플릿)과 `.github/workflows/*.yaml`(이 저장소 self-copy) 양쪽 모두 함께 수정이 필요합니다.

### 고려한 다른 방법(선택)

현재 방식(`secrets.WORKFLOW_PAT || github.token` 폴백)을 유지하고 설치 완료 화면에서 `WORKFLOW_PAT` 등록을 더 눈에 띄게 안내하는 방법도 있지만, 근본적으로 "시크릿을 깜빡하면 조용히 깨지는" 구조 자체는 남습니다. `repository_dispatch` 방식은 시크릿 설정 여부와 무관하게 항상 동작해 이 문제 클래스를 구조적으로 제거합니다.
