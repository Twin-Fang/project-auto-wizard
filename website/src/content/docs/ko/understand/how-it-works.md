---
title: 동작 방식
description: 설치 시점에 마법사가 하는 일과 설치 후 GitHub Actions에서 도는 것.
---

project-auto-wizard는 실행 시점에 서로 통신하지 않는 두 부분으로 나뉩니다.

1. **마법사** — 한 번 실행하는 Node CLI(업데이트할 때 다시 실행). 감지하고, 묻고, 파일을 씁니다.
2. **설치된 워크플로우** — 레포 안의 GitHub Actions와 Python 스크립트. PR과 push마다 실제 릴리스 작업을 합니다.

설치가 끝나면 마법사는 필요 없습니다. 내 컴퓨터에서 지워도 릴리스는 계속 동작합니다.

## 설치 시점

```
npx project-auto-wizard
  │
  ├─ 감지     마커 파일 → 프로젝트 타입, 버전, 기본 브랜치
  ├─ 질문     브랜치 전략, 배포 방식, semver 자동 승격, Copilot, 타입별 값
  ├─ 치환     payload/ 파일 복사, 브랜치·프로젝트 placeholder 치환
  ├─ 쓰기     .github/workflows/*, .github/scripts/*.py, version.yml, README 버전 섹션
  └─ 기록     .github/.wizard/baseline.json (다음 업데이트용 해시)
              .github/.wizard/logs/<시각>-<동작>.log (무엇을 왜 결정했는지)
```

모든 파일은 npm 패키지 안의 `payload/` 폴더에서 나옵니다. 템플릿 레포를 clone하거나 무언가를 내려받지 않으므로, 같은 패키지 버전이면 항상 같은 파일이 설치됩니다.

`{{MAIN_BRANCH}}`, `{{DEVELOP_BRANCH}}` 같은 placeholder는 실제 브랜치 이름으로 치환됩니다. 마법사가 물은 값(예: 배포 포트)은 워크플로우의 `env` 섹션에 기록되고 `version.yml`의 `deploy` 블록에도 저장되어, 다음 실행에서 다시 묻지 않습니다.

## 실행 시점

```
.github/workflows/PROJECT-*.yaml   ──호출──▶   .github/scripts/*.py
          │                                    version_manager.py    버전 파일, 승격 규칙
          │                                    changelog_manager.py  릴리스 노트, CHANGELOG
          │                                    issue_helper.py       브랜치명 댓글
          ▼                                    truncate_release_notes.py
     version.yml   (버전, 타입, 경로, 브랜치, 옵션)
```

- `version.yml`이 단일 진실입니다. 워크플로우는 브랜치 모드, `semver_auto`, `copilot_ai`, 경로를 여기서 읽습니다.
- 버전은 타입별 파일(예: `build.gradle`, `pubspec.yaml`, `package.json`, `pyproject.toml`)에도 동기화됩니다. 목록은 [version.yml](../../reference/version-yml/)에 있습니다.
- 스크립트는 Python 표준 라이브러리만 쓰므로 `pip install` 단계가 없고 bash/PowerShell 이중 유지도 없습니다.

## 무엇이 무엇을 실행하나

| 이벤트 | 워크플로우 |
|---|---|
| 이슈 생성 또는 제목 수정 | `PROJECT-COMMON-ISSUE-HELPER`가 정규화한 브랜치명과 커밋 메시지를 댓글로 남김 |
| 릴리스 브랜치 대상 PR (릴리스 PR 제외) | `PROJECT-COMMON-AI-PR-SUMMARY`가 요약 댓글 |
| 릴리스 PR (`develop → main`) | `PROJECT-COMMON-AUTO-CHANGELOG-CONTROL`이 버전 확정, 노트·CHANGELOG 작성, automerge |
| 릴리스 브랜치 push | `PROJECT-COMMON-RELEASE-PUBLISH`가 태그와 Release 발행, 릴리스 PR을 거치지 않은 push면 `PROJECT-COMMON-VERSION-CONTROL`이 버전 승격, `PROJECT-COMMON-README-VERSION-UPDATE`가 README 버전 줄 갱신 |
| 개발 브랜치 PR / push | 타입별 CI (`PROJECT-<TYPE>-CI`) |
| 릴리스 브랜치 push | 타입별 배포 워크플로우 (서버 배포, 스토어 배포) |

자세한 내용은 [릴리스 흐름](../release-flow/)과 [브랜치 전략](../branch-strategies/)에 있습니다.

## 업데이트

마법사를 다시 실행하면 설치된 워크플로우마다 세 가지를 비교합니다: 지난번에 설치한 것(`baseline.json`), 지금 디스크에 있는 것, 새 payload가 만들어 내는 것. 손대지 않은 파일은 갱신하고, 나만 고친 파일은 유지하고, 양쪽이 다 바뀐 파일은 충돌로 보고 선택하게 합니다. [업데이트와 재실행](../../operate/updating/)을 참고하세요.
