---
title: 릴리스 자동화 (전 타입 공통)
description: 모든 프로젝트 타입에 설치되는 공통 워크플로우와 스크립트.
---

`basic`을 포함한 모든 타입에 같은 릴리스 자동화가 설치됩니다. 타입별 문서에는 그 위에 추가로 설치되는 것만 적었습니다.

## 워크플로우

| 워크플로우 | 트리거 | 하는 일 |
|---|---|---|
| `PROJECT-COMMON-AUTO-CHANGELOG-CONTROL` | 개발 브랜치 → 릴리스 브랜치 PR | 버전 확정, 릴리스 노트와 CHANGELOG 작성, automerge. pr-flow 전용. |
| `PROJECT-COMMON-RELEASE-PUBLISH` | 릴리스 브랜치 push, `workflow_dispatch` | 태그 `vX.Y.Z`와 GitHub Release. trunk-based에서는 버전 승격과 CHANGELOG 작성까지 합니다. |
| `PROJECT-COMMON-VERSION-CONTROL` | 릴리스 브랜치 push (`CHANGELOG.*`, `version.yml`만 바뀐 push 제외), `workflow_dispatch` | 직접 push에 대한 patch 승격 안전망. pr-flow 전용. |
| `PROJECT-COMMON-README-VERSION-UPDATE` | 릴리스 브랜치 push, `workflow_dispatch` | `README.md`의 `<!-- AUTO-VERSION-SECTION -->` 아래 버전 줄 갱신 |
| `PROJECT-COMMON-AI-PR-SUMMARY` | 릴리스 브랜치 대상 PR | 요약 댓글. 릴리스 PR은 건너뜀. |
| `PROJECT-COMMON-ISSUE-HELPER` | 이슈 생성, 제목 수정 | 정규화한 브랜치명과 커밋 메시지를 댓글로 안내 |

`PROJECT-COMMON-ISSUE-HELPER`는 브랜치도 만들 수 있습니다. `env` 섹션의 `ISSUE_HELPER_CREATE_BRANCH`를 `"true"`로 바꾸세요. 이슈를 열 때마다 브랜치가 생기지 않도록 기본값은 `"false"`입니다.

## 스크립트

`.github/scripts/`에 복사됩니다. 표준 라이브러리만 쓰는 Python입니다.

| 스크립트 | 역할 |
|---|---|
| `version_manager.py` | 버전 읽기·승격, 타입별 버전 파일 동기화 |
| `changelog_manager.py` | 요약 엔진 체인, `CHANGELOG.json` / `CHANGELOG.md` |
| `truncate_release_notes.py` | 릴리스 노트를 길이 제한에 맞게 자름 (Flutter 스토어·Firebase 워크플로우에서 사용) |
| `issue_helper.py` | 이슈의 브랜치명과 커밋 메시지 |

## Secret과 Variable

필수는 없습니다. 아래는 모두 선택입니다:

| 이름 | 종류 | 용도 |
|---|---|---|
| `WORKFLOW_PAT` | Secret | automerge → Release를 더 빠르게, `release: published`로 다른 워크플로우를 트리거. 조직 bot/machine 계정으로 발급 (scopes: `repo`, `workflow`) |
| `AI_API_KEY` | Secret | OpenAI 호환 API (아래 Variable 둘도 필요) |
| `AI_API_BASE_URL` | Variable | 엔드포인트 base URL |
| `AI_MODEL` | Variable | 모델 이름 |

Copilot 요약은 Secret이 필요 없습니다. `copilot_ai: true`일 때 `GITHUB_TOKEN`을 씁니다. [요약 엔진](../../understand/summary-engine/)을 참고하세요.

## 레포 설정

- **merge commit 허용.** 릴리스 PR은 merge commit으로 automerge됩니다.
- **Workflow permissions**는 Read로 둬도 됩니다. 설치된 워크플로우는 모두 `permissions`를 직접 선언합니다.

`npx project-auto-wizard --mode doctor`가 둘 다 점검합니다. [doctor](../../operate/doctor/)를 참고하세요.
