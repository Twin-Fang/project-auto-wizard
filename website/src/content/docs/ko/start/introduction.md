---
title: 소개
description: project-auto-wizard가 무엇을 설치하고 어떤 경우에 맞는지.
---

새 프로젝트를 시작하면 코드를 작성하기 전부터 정해야 할 일이 많습니다. 버전을 어떻게 올릴지, CHANGELOG를 어떻게 관리할지, 릴리스 노트와 태그는 누가 만들지, CI/CD 워크플로우는 지난 프로젝트에서 복사해 고쳐 쓸지. 매번 반나절이 걸리고, 레포마다 조금씩 달라집니다.

project-auto-wizard는 이 준비 과정을 질문 몇 개로 한 번에 구성합니다. 그 뒤로는 릴리스 PR을 머지하는 것만으로 릴리스가 나갑니다.

```bash
npx project-auto-wizard
```

## 무엇을 설치하나

| 구성 | 내용 |
|---|---|
| **npx 마법사** | 마커 파일로 프로젝트 타입을 자동 감지합니다 — 10타입, 한 레포의 여러 타입, 모노레포 하위 폴더까지. 감지할 수 없는 것만 묻습니다. |
| **릴리스 자동화** | 릴리스 PR을 열면: 버전 확정 → 릴리스 노트 작성(기본은 규칙 기반, GitHub Copilot은 선택) → CHANGELOG 갱신 → automerge → 태그 + GitHub Release. API 키 0개. |
| **타입별 CI/CD** | Spring(무중단 배포 포함), Flutter(스토어 배포), React, Next.js, Python, Go에 맞는 워크플로우를 배치합니다. |

레포에는 다음과 같이 남습니다:

| 경로 | 용도 |
|---|---|
| `.github/workflows/PROJECT-COMMON-*.yaml` | 릴리스 자동화: 버전 승격, 릴리스 PR 노트, CHANGELOG, 태그와 GitHub Release, README 버전 줄, PR 요약 댓글, 새 이슈의 브랜치명 안내 |
| `.github/workflows/PROJECT-<TYPE>-*` | 스택별 CI/CD |
| `.github/scripts/*.py` | 워크플로우의 실제 로직. 표준 라이브러리만 사용하는 Python |
| `version.yml` | 버전·프로젝트 타입·경로·브랜치·옵션의 단일 기록 |
| `README.md` 버전 섹션 | 릴리스마다 자동 갱신 |

설치된 파일은 직접 읽고 고쳐도 됩니다. 마법사를 다시 실행해도 수정한 내용을 말없이 덮어쓰지 않습니다 — [업데이트와 재실행](../../operate/updating/)을 참고하세요.

## 도입 전과 후

| | 도입 전 | project-auto-wizard 사용 |
|---|---|---|
| 초기 셋업 | 예전 레포에서 워크플로우를 복사해 고침 | `npx project-auto-wizard`, 질문 몇 개에 답 |
| 다음 버전 | 사람이 정하고 직접 입력 | 릴리스 PR에서 커밋 타입으로 결정 |
| CHANGELOG | 손으로 작성, 자주 누락 | 릴리스 PR 머지 시 갱신 |
| 태그와 Release | 수동 생성 | 머지 후 자동 생성 |
| 스택별 CI/CD | 프로젝트마다 작성 | 감지된 타입에 맞게 설치 |
| AI 요약 | API 키와 별도 스크립트 필요 | 선택. 키 없이 규칙 기반으로 동작 |

## 이런 경우에 맞습니다

- 새 레포를 시작하면서 첫날부터 릴리스가 돌아가길 원할 때
- 팀이 `develop`을 `main`에 머지하는 방식이고, 노트와 CHANGELOG가 붙은 릴리스 PR을 원할 때
- Spring, Flutter, React, Next.js, Python, Go 프로젝트에 CI/CD와 릴리스 자동화를 한 번에 구성하고 싶을 때
- 한 레포에 여러 스택(예: Spring 백엔드 + React 프론트엔드)이 있고 버전을 공유할 때

## 이런 경우엔 맞지 않습니다

- 단일 패키지가 이미 release-please나 semantic-release로 잘 릴리스되고 있을 때
- 릴리스 자체가 패키지 레지스트리 배포까지 해야 할 때 (이 레포가 npm에 하듯 Release 이벤트에 워크플로우를 직접 추가하세요)
- 패키지마다 독립 버전이 필요할 때
- 레포가 GitHub에 있지 않을 때

release-please, semantic-release, changesets와의 차이는 [비교](../../reference/comparison/)에 정리했습니다.

## 설계 원칙

- **payload 단일 진실**: 마법사가 설치하는 모든 자산은 npm 패키지에 동봉된 `payload/` 하나에서 나옵니다. 템플릿 레포 clone이나 원격 다운로드가 없어 같은 패키지 버전이면 설치 결과가 같습니다. 마법사 자체는 네트워크 요청을 하지 않으며, 기본 브랜치 감지·develop 브랜치 push·`--mode doctor`의 `gh` 조회처럼 사용자 레포를 대상으로 한 git/gh 명령만 원격에 접속합니다.
- **크로스플랫폼**: 마법사는 Node, 설치되는 스크립트는 전부 Python입니다. bash/PowerShell을 이중으로 유지할 필요가 없습니다.
- **graceful degradation**: AI가 실패하면 다음 엔진, 마지막은 항상 성공하는 규칙 기반입니다. 요약 단계 때문에 릴리스가 막히는 일은 없습니다.
- **표준 존중**: GitHub 라벨·Releases·Conventional Commits 위에 구축합니다.
- **멱등성**: 같은 명령을 다시 실행해도 안전합니다. 바뀌지 않은 파일은 건너뛰고, 진짜 충돌은 3지선(유지 / 백업 후 교체 / 참고본 추가)으로 처리합니다.
