---
title: React와 Next.js
description: React·Next.js 프로젝트의 CI와 CI/CD 워크플로우.
---

`package.json`으로 감지합니다. `next` 의존성이 있으면 `next`, 아니고 `react` 의존성이 있으면 `react`입니다. [릴리스 자동화](../common/) 위에 아래가 추가로 설치됩니다.

## 설치되는 워크플로우

| 워크플로우 | 트리거 | 하는 일 |
|---|---|---|
| `PROJECT-REACT-CI` / `PROJECT-NEXT-CI` | 개발 브랜치 PR·push, `workflow_dispatch` | `npm ci`, `npm test`(`test` 스크립트가 있을 때), `npm run build`. `node_modules`와 빌드 결과(Next.js는 `.next/cache`)를 캐싱. 마지막에 `ci-gate` job. |
| `PROJECT-REACT-CICD` / `PROJECT-NEXT-CICD` | 릴리스 브랜치 push, `workflow_dispatch` | Docker 이미지 빌드 후 SSH로 배포. Next.js는 SSR을 위해 Node.js 런타임 컨테이너로 배포 |

### 배포 방식

React·Next.js도 다른 서버 배포 타입과 같은 `--deploy-style` 규칙을 따르지만, 단일 서버 배포만 있습니다:

| `--deploy-style` | 결과 |
|---|---|
| `simple` (기본) | CI/CD 설치 |
| `nginx`, `traefik` | 단일 서버 배포로 설치되고, 설치 화면에 그 사실을 알림 |
| `none` | CI만 설치, CI/CD 제외 |

React·Next.js에는 PR 프리뷰 워크플로우가 없습니다.

## Secret

CI에는 배포 Secret이 필요 없습니다.

| Secret | CI | CI/CD | 비고 |
|---|---|---|---|
| `ENV_FILE` (없으면 `ENV`) | 선택 | 선택 | 빌드 전에 `.env`로 기록 |
| `DOCKERHUB_USERNAME` | — | 필수 | Docker Hub 사용자명 |
| `DOCKERHUB_TOKEN` | — | 필수 | Docker Hub 액세스 토큰 |
| `SERVER_HOST` | — | 필수 | 배포 서버 주소 |
| `SERVER_USER` | — | 필수 | SSH 사용자명 |
| `SERVER_PASSWORD` | — | 필수 | SSH 비밀번호 |
| `PROJECT_DEPLOY_PORT` | — | 선택 | 호스트 포트, 기본 `3000` |

CI/CD 워크플로우는 체크아웃 직후 필수 Secret과 `Dockerfile`을 점검하고, 빠진 것을 오류로 알려 주고 멈춥니다. 서버에 배포하지 않는다면 CI/CD 파일을 지우거나 `--deploy-style none`으로 설치하세요.

브랜치 보호 규칙에는 **`CI Gate`** 하나만 required status check로 등록하세요. 이유는 [Spring → 브랜치 보호 규칙](../spring/#브랜치-보호-규칙)에 있습니다.
