---
title: 비교
description: release-please, semantic-release, changesets와의 비교.
---

버전 관리와 체인지로그라는 영역은 겹치지만, 레포에 들어가는 방식과 멈추는 지점이 다릅니다.

| | project-auto-wizard | release-please | semantic-release | changesets |
|---|---|---|---|---|
| 도입 방식 | 수정 가능한 워크플로우 파일 설치 | GitHub Action + 설정 | CI에서 실행하는 npm 패키지 + 플러그인 | CLI + GitHub Action |
| 버전 결정 | 커밋 타입 (컨벤션 외 커밋 → patch) | Conventional Commits | Conventional Commits (설정 가능) | 개발자가 쓰는 changeset 파일 |
| 릴리스 PR | 있음 (또는 trunk-based) | 있음 | 없음, push 시 릴리스 | 있음 ("Version Packages") |
| npm / PyPI 배포 | 안 함 | 안 함 | 플러그인으로 함 | 함 (npm) |
| 스택별 CI/CD 포함 | 프로젝트 타입별로 포함 | 없음 | 없음 | 없음 |
| 모노레포 | 타입별 경로, 버전 하나 공유 | 패키지별 버전 | 커뮤니티 플러그인 | 패키지별 버전 |
| 릴리스 노트 | 규칙 기반, Copilot·사용자 AI API 선택 | 커밋에서 생성 | 커밋에서 생성 | changeset 본문에서 생성 |

## 다른 도구가 더 나은 점

- **release-please**는 성숙하고 널리 쓰이며, 여러 생태계의 버전 파일을 갱신하고, 모노레포에서 패키지별 독립 버전을 다룹니다.
- **semantic-release**는 수동 단계 없이 npm 등 레지스트리에 배포하고 플러그인 생태계가 큽니다.
- **changesets**는 많은 패키지를 배포하는 JavaScript 모노레포에 가장 잘 맞으며, 체인지로그를 커밋에서 뽑지 않고 사람이 씁니다.

## project-auto-wizard가 맞는 경우

- Spring, Flutter, React, Next.js, Python, Go 프로젝트에 릴리스 자동화 **와** CI/CD를 한 번에 구성하고 싶을 때
- 한 레포에 여러 스택이 있고 버전 하나를 공유할 때
- 외부에서 설정하는 액션·패키지보다 레포 안에서 읽고 고칠 수 있는 워크플로우 파일을 선호할 때
- 커밋 컨벤션이나 API 키 없이도 릴리스가 돌아가길 원할 때

패키지별 독립 버전이나 릴리스 과정의 레지스트리 배포가 필요하면 위 도구가 더 맞습니다. 함께 쓸 수도 있습니다. 이 레포는 설치된 릴리스 흐름을 쓰고, npm 배포는 Release 이벤트에 붙인 별도 워크플로우로 합니다.
