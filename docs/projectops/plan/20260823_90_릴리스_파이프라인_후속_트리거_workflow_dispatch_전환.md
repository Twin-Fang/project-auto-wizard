# 릴리스 파이프라인 후속 워크플로우 트리거를 workflow_dispatch로 전환

작성일: 2026-08-23
GitHub 이슈: https://github.com/Twin-Fang/project-auto-wizard/issues/90
대상 브랜치: 20260823_#90_릴리스_파이프라인_후속_트리거_workflow_dispatch_전환 (base: main)
우선순위/마감: enhancement 라벨, 마감 없음

## 1. 한 줄 요약

릴리스 파이프라인의 세 지점(automerge→RELEASE-PUBLISH, RELEASE-PUBLISH→NPM-PUBLISH, VERSION-CONTROL 안전망→RELEASE-PUBLISH)이 `WORKFLOW_PAT` 시크릿 없이는 후속 워크플로우가 조용히 트리거되지 않는 문제를, GITHUB_TOKEN으로도 항상 새 실행을 만드는 `workflow_dispatch` 신호를 각 지점에 추가해 구조적으로 해결한다.

## 2. 배경

GitHub Actions는 `GITHUB_TOKEN`으로 만든 push/release 이벤트로는 다른 워크플로우를 재트리거하지 않는다(재귀 방지 정책). 이 프로젝트의 릴리스 체인(`AUTO-CHANGELOG-CONTROL` → `RELEASE-PUBLISH` → `NPM-PUBLISH`)은 이 제약에 두 곳(automerge, Release 생성)에서 걸려 있고, 지금은 `secrets.WORKFLOW_PAT || github.token` 폴백으로 우회한다. `project-auto-wizard`를 설치한 모든 사용자 레포는 PAT를 별도로 발급·등록하지 않으면 "PR은 병합됐는데 릴리스도 npm 배포도 안 되는" 상태가 아무 에러 없이 남는다. 이 저장소 자신도 실제로 이 문제를 두 번 겪었다.

추가로, PR 없이 `main`에 직접 push됐을 때 patch 버전을 올리는 안전망(`VERSION-CONTROL`)도 같은 제약에 걸려 있다는 게 이번 조사에서 새로 확인됐다 — 이는 이슈 #61이 "감지만 하고 수동 복구를 요구"하는 드리프트 문제의 근본 원인과 동일하다.

`workflow_dispatch`와 `repository_dispatch`는 GitHub 공식 문서상 `GITHUB_TOKEN`이 만들어도 항상 새 실행을 만드는 예외 이벤트다. 이 프로젝트의 세 지점은 전부 "A가 끝나면 B 하나를 실행한다"는 1:1 관계이고, `RELEASE-PUBLISH`와 `NPM-PUBLISH`는 이미 `workflow_dispatch` 트리거와 그에 맞는 처리 분기(각각 "현재 버전 재발행", "받은 태그로 배포")를 갖고 있다 — 그래서 `repository_dispatch`(브로드캐스트용 커스텀 이벤트)보다 기존 `workflow_dispatch`를 재사용하는 쪽이 더 단순하다.

## 3. 사용자 시나리오 / 동작 정의

- 시나리오 1 (automerge 경로): 사용자가 `WORKFLOW_PAT`를 등록하지 않은 채로 develop→main 릴리스 PR을 automerge로 병합하면, 병합이 실제로 완료된 시점에 `RELEASE-PUBLISH`가 자동으로 실행되어 태그와 GitHub Release가 발행된다.
- 시나리오 2 (Release→npm 경로): `WORKFLOW_PAT` 없이 `RELEASE-PUBLISH`가 GitHub Release를 발행하면, 곧바로 `NPM-PUBLISH`가 그 버전 태그로 자동 실행되어 npm에 배포된다.
- 시나리오 3 (안전망 경로): PR 없이 `main`에 직접 push되어 `VERSION-CONTROL`이 patch 버전을 올리면, `RELEASE-PUBLISH`가 자동으로 실행되어 그 버전을 태그·Release로 발행한다(현재는 이슈 #61의 드리프트 에러로 수동 복구가 필요한 상태).
- 공통 회귀 시나리오: `WORKFLOW_PAT`가 등록된 레포에서는 기존 경로(push/release 트리거)와 새 경로(workflow_dispatch 호출)가 동시에 발동할 수 있는데, 이 경우에도 릴리스가 중복 발행되거나 npm에 같은 버전이 두 번 배포되지 않는다.

## 4. 요구사항

**필수 (Must)**:
- `WORKFLOW_PAT` 시크릿이 전혀 등록되지 않은 레포에서도 세 지점 모두 후속 워크플로우가 자동으로 실행된다.
- 기존 push/release/workflow_dispatch(수동 재실행) 트리거는 그대로 유지된다 — 새 경로는 보조 수단이지 대체가 아니다.
- `WORKFLOW_PAT`가 등록된 레포에서 기존 경로와 새 경로가 동시에 발동해도 중복 릴리스/중복 npm 배포가 발생하지 않는다.
- `payload/workflows/common/*.yaml`(설치 템플릿)과 `.github/workflows/*.yaml`(이 저장소의 도그푸딩 사본)이 서로 동기화된 상태를 유지한다. 단 `NPM-PUBLISH.yaml`은 이 저장소 전용이라 payload 동기화 대상이 아니다.
- automerge가 "예약"과 "실제 병합"이 시간차를 두고 일어나는 비동기 동작이라는 점을 반영해, 실제 병합이 완료된 시점에 신호를 보낸다 — 예약 시점에 너무 이르게 신호를 보내지 않는다.
- 세 지점의 신호 발행은 실패해도 기존 릴리스 흐름을 막지 않는다(non-blocking).

**원함 (Should)**:
- 자동 회귀 테스트로 "새 신호 발행 스텝이 존재하는지", "PAT 폴백이 아닌 기본 토큰을 쓰는지"를 정적으로 검증한다.
- PR 머지 이후 실제 릴리스 1회를 관찰해 새 경로가 실제로 발동하는지 확인한다.

**선택 (Nice)**:
- 자동 트리거된 실행의 로그에 "어느 지점에서 자동으로 트리거됐는지" 식별 가능한 정보를 남긴다.

## 5. 제약

- 기술: 새 npm 의존성 추가 금지. GitHub Actions 워크플로우 YAML과 `gh` CLI만 사용(신규 서드파티 GitHub Action 도입 지양 — 기존 워크플로우들이 `gh` CLI를 이미 광범위하게 사용 중).
- 환경: `GITHUB_TOKEN`으로 다른 워크플로우의 `workflow_dispatch`를 API로 호출하려면 필요한 정확한 `permissions` 스코프가 GitHub 공식 문서에 명시적으로 나와 있지 않다(커뮤니티 통설은 `actions: write`) — 실제 필요 최소 스코프는 구현 단계에서 실측 검증이 필요하다.
- 정책: `workflow_dispatch`는 대상 워크플로우 파일이 **레포의 default 브랜치**(이 레포는 `main`으로 확인됨)에 있어야만 API로 트리거 가능하다.
- 범위: 이번 작업은 워크플로우 배관(트리거 연결)에만 집중한다. `README.md`/`SECURITY.md`의 `WORKFLOW_PAT` 안내 문구, `--mode doctor`의 `WORKFLOW_PAT` 등록 여부 경고 로직, `WORKFLOW_PAT` 시크릿 자체의 완전 제거는 이번 범위에서 명시적으로 제외하고 별도 이슈로 다룬다.
- 검증 리스크: 실제 릴리스 e2e 검증은 프로덕션 npm 배포에 영향을 줄 수 있으므로, PR 머지 전 강제 실행이 아니라 머지 후 관찰로 처리한다.

## 6. 성공 기준 (Definition of Done)

- [ ] `WORKFLOW_PAT`가 없다고 가정한 상태에서도(코드 검토 기준) 세 지점 모두 후속 워크플로우를 자동으로 깨우는 신호 발행 로직이 존재한다.
- [ ] 기존 push/release/workflow_dispatch(수동) 트리거 및 그 처리 로직은 변경 없이 그대로 남아 있다.
- [ ] `payload/workflows/common/*.yaml`과 `.github/workflows/*.yaml`(NPM-PUBLISH 제외)이 동기화되어 있다.
- [ ] `npm test`(회귀 테스트 포함)가 통과한다.
- [ ] PR이 머지된 뒤 실제 릴리스가 한 번 이상 발생해, `gh run list`로 새 경로(workflow_dispatch)를 통한 실행이 관찰된다.

## 7. 가정 [ASSUMPTIONS]

- 가정 1: `GITHUB_TOKEN`으로 다른 워크플로우의 `workflow_dispatch`를 호출하려면 `permissions: actions: write`가 필요하다. (다르면 구현 단계에서 실제 실행 결과로 조정)
- 가정 2: automerge 예약 후 실제 병합 완료까지, 병합 완료 여부를 폴링으로 확인하는 방식이 허용 가능한 잡 실행 시간 증가(수 분~수십 분)를 감수할 가치가 있다. (사용자가 브레인스토밍에서 이미 동의한 방향)
- 가정 3: 이번 작업은 세 지점 모두를 한 이슈/PR로 처리한다(사용자가 브레인스토밍에서 확정). 지점별로 별도 PR로 쪼개지 않는다.
- 가정 4: 안전망 경로(`VERSION-CONTROL`)를 통한 자동 트리거는 이슈 #61의 드리프트 감지-에러 상태를 자동 복구로 승격시키는 부수 효과를 낳으며, 이는 의도된 개선으로 간주한다(별도 승인 불필요).

## 8. 미해결 질문

- 없음 — 브레인스토밍 단계 + fable5 독립 검토(아래 §11)를 거쳐 범위·메커니즘·타이밍·권한 검증 방식·동기화 예외까지 전부 확정됨.

## 9. 다음 단계

- (복잡 작업) 세 워크플로우 파일 + payload/.github 동기화 + 테스트 파일이 얽혀 있어 파일 영향 범위가 2개를 넘음 → 구현 단계에서 구체적인 스텝/명령/조건식(HOW)을 확정하며 진행한다.

## 10. [REVIEW_LOG] — Architect 자기검증

- **리스크/놓친 시나리오**: (1) automerge 폴링 스텝이 대기하는 동안 필수 체크가 실패해 PR이 끝내 병합되지 않는 경우, 폴링은 타임아웃으로 종료되어야 하며 이 실행 자체를 실패로 표시하면 안 된다(정상적인 "머지 안 됨" 상황이므로) — 구현 시 이 분기를 명시적으로 다뤄야 한다. (2) `WORKFLOW_PAT`가 등록된 레포에서 기존 경로와 새 경로가 동시에 두 번 실행되는 것이 완전히 무해한지는 기존 멱등성 가드(태그/Release/npm 존재 확인, concurrency 그룹)에 의존하는데, 이 가드들이 "동시에 큐잉된 두 실행" 상황까지 커버하는지는 구현 단계에서 재확인이 필요하다. (3) `actions: write` 권한 추정이 틀렸을 경우 세 워크플로우의 `permissions` 조정이 필요하며, 이는 실제 GitHub Actions 실행 결과로만 확정 가능하다(로컬 정적 분석으로는 검증 불가).
- **아키텍처 방향 대안**: `repository_dispatch`(커스텀 이벤트 브로드캐스트 + `client_payload`)를 대안으로 검토했으나, 이 프로젝트의 세 relay가 전부 1:1 관계이고 대상 워크플로우들이 이미 `workflow_dispatch`에 정확히 맞는 처리 분기를 갖고 있어, 새 이벤트 계약을 정의할 필요가 없는 `workflow_dispatch`(API 직접 호출)를 채택했다.

## 11. fable5 독립 검토 결과 (반영 완료)

fable5 모델이 실제 워크플로우 코드를 읽고 독립적으로 검토한 결과, 이 문서의 §7 가정과 §10 REVIEW_LOG는 대부분 코드로 확인됐다(RELEASE-PUBLISH의 `workflow_dispatch` 게이트가 무조건 통과시키는 것, NPM-PUBLISH의 `inputs.tag` 폴백 존재, 중복 실행에 대한 concurrency+멱등 가드의 안전성, `actions: write` 필요성). 다만 §10에 없던 **구조적 결함 2건**을 새로 찾아냈고, 아래와 같이 방침을 확정해 반영한다(추가 승인 절차 불필요 — 대안이 명백히 열등함):

- **NPM-PUBLISH는 payload에 없는 이 저장소 전용 워크플로우다.** `RELEASE-PUBLISH.yaml`은 payload 템플릿이므로, 여기에 `gh workflow run NPM-PUBLISH.yaml`을 그대로 넣으면 마법사로 설치된 모든 사용자 레포가 존재하지 않는 워크플로우를 매 릴리스마다 호출 시도하게 된다(non-blocking이라 실패하진 않지만 상시 경고 노이즈). **방침**: 이 dispatch 스텝은 payload 템플릿(`payload/workflows/common/PROJECT-COMMON-RELEASE-PUBLISH.yaml`)에는 넣지 않고, 이 저장소의 self-copy(`.github/workflows/PROJECT-COMMON-RELEASE-PUBLISH.yaml`)에만 추가한다. `NPM-PUBLISH.yaml` 자체가 이미 "이 저장소 전용, payload 동기화 대상 아님"이라는 기존 전례를 따르는 것이므로 새로운 종류의 예외가 아니다. 두 파일 모두에 이 의도적 비대칭을 설명하는 주석을 남기고, 회귀 테스트도 이 비대칭을 검증 대상에 명시적으로 반영한다(무비판적 diff 동일성 검사에 걸리지 않도록).
- **automerge 폴링을 같은 잡 안에서 하면 구조적 데드락 가능성이 있다.** `changelog-and-merge` 잡이 레포의 branch protection에서 `develop→main` PR의 required status check로 등록돼 있다면, "병합은 이 잡의 완료(체크 green)를 기다리고, 이 잡은 폴링으로 병합 완료를 기다리는" 상호 대기가 생긴다(현재는 잡이 automerge 예약 직후 바로 끝나 이 문제가 없었는데, 폴링을 추가하며 새로 발생하는 위험). **방침**: 폴링+dispatch 로직을 같은 잡이 아니라, `needs: changelog-and-merge`로 의존하는 **새 잡**(같은 워크플로우 파일 안의 별도 job)으로 분리한다. 이러면 `changelog-and-merge` 잡 자체의 완료 조건은 오늘과 동일하게 유지되어(자동 병합 예약 후 즉시 종료) required check로 등록돼 있어도 데드락이 생기지 않고, 새 잡은 원래 없던 잡이라 기존 branch protection 설정에 영향받지 않는다.
