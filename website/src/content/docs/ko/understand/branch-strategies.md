---
title: 브랜치 전략
description: pr-flow와 trunk-based, 각각 설치되는 워크플로우와 고르는 기준.
---

마법사는 브랜치 전략을 먼저 묻습니다. 선택은 `version.yml`의 `metadata.template.branches`에 저장되고 업데이트할 때 다시 묻지 않습니다.

```yaml
metadata:
  template:
    branches:
      main: "main"        # 릴리스 브랜치
      develop: "develop"  # 개발 브랜치
      mode: "pr-flow"     # pr-flow | trunk-based
```

## pr-flow (기본)

작업은 개발 브랜치(기본 `develop`)에 쌓이고, 릴리스는 `develop`에서 릴리스 브랜치(`main`)로 가는 PR입니다.

설치되는 릴리스 워크플로우:

| 워크플로우 | 역할 |
|---|---|
| `PROJECT-COMMON-AUTO-CHANGELOG-CONTROL` | 릴리스 PR: 버전 확정, 노트, CHANGELOG, automerge |
| `PROJECT-COMMON-RELEASE-PUBLISH` | 머지 후 태그와 GitHub Release |
| `PROJECT-COMMON-VERSION-CONTROL` | `main` 직접 push 안전망 |

타입별 CI는 `develop`의 PR과 push에서, 배포 워크플로우는 `main` push에서 실행됩니다.

태그를 찍기 전에 버전과 노트를 리뷰할 수 있는 릴리스 PR을 원할 때 씁니다.

## trunk-based

릴리스 브랜치가 곧 개발 브랜치입니다. 릴리스 PR이 없고, 릴리스 브랜치 push 하나하나가 릴리스입니다.

릴리스용으로는 `PROJECT-COMMON-RELEASE-PUBLISH` 하나만 설치됩니다(`AUTO-CHANGELOG-CONTROL`, `VERSION-CONTROL`은 설치하지 않음). push마다 버전 확정 → 마지막 태그 이후 커밋 요약 → CHANGELOG 갱신 → `[skip ci]` 커밋 → 태그와 Release 발행을 순서대로 처리합니다. pr-flow와 같은 단계를 워크플로우 하나에서 합니다.

이 모드에서는 모든 PR이 릴리스 브랜치를 향하므로 AI PR 요약봇이 매 PR마다 동작합니다.

`main`에 머지할 때마다 배포되어야 하는 작은 프로젝트나 라이브러리에 맞습니다.

## 브랜치 지정

| | 대화형 | 비대화형 |
|---|---|---|
| 릴리스 브랜치 | 브랜치 목록에서 선택, 기본값은 감지된 default branch | `--main-branch B` (기본: 감지된 default branch) |
| 개발 브랜치 | pr-flow일 때만 질문 | `--develop-branch B` (기본: `develop`) |
| trunk-based | 전략 질문에서 선택 | `--main-branch`와 `--develop-branch`에 같은 값 |

개발 브랜치가 없으면 마법사가 생성해 push합니다.

대화형으로 다시 실행하면 저장된 브랜치를 묻지 않고 그대로 씁니다. 바꾸려면 플래그로 비대화형 실행을 하세요 — 플래그가 저장값보다 우선합니다:

```bash
npx project-auto-wizard --mode full --force --main-branch main --develop-branch main --dry-run
```

먼저 `--dry-run`으로 미리 보고, 그다음 빼고 실행하세요. 실행 후에는 `.github/workflows/`에 새 전략에서 쓰지 않는 릴리스 워크플로우가 남아 있지 않은지 확인하세요.
