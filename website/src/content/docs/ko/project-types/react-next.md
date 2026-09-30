---
title: React와 Next.js
description: React·Next.js 프로젝트의 CI와 CI/CD 워크플로우.
---

`package.json`으로 감지합니다. `react` 또는 `next` 의존성이 있으면 `react`입니다. Next.js 프로젝트는 React 프로젝트로 보고 같은 워크플로우를 설치합니다. [릴리스 자동화](../common/) 위에 아래가 추가로 설치됩니다.

`--type`, `--paths`, `version.yml`에서는 `next`를 `react`의 별칭으로 계속 받으며, 기록은 `react`로 남깁니다.

## 설치되는 워크플로우

| 워크플로우 | 트리거 | 하는 일 |
|---|---|---|
| `PROJECT-REACT-CI` | 개발 브랜치 PR·push, `workflow_dispatch` | `npm ci`, `npm test`(`test` 스크립트가 있을 때), `npm run build`. `node_modules`와 Next.js 빌드(`.next/cache`)를 캐싱하고, 빌드가 `.next`를 만들었으면 그 크기를 출력. 마지막에 `ci-gate` job. |
| `PROJECT-REACT-CICD` | 릴리스 브랜치 push, `workflow_dispatch` | Docker 이미지 빌드 후 SSH로 배포. 컨테이너는 `NODE_ENV=production`과 `--restart unless-stopped`로 실행되고 이름은 `<프로젝트>-front-deploy` |

이전 버전은 Next.js 프로젝트에 `PROJECT-NEXT-CI`·`PROJECT-NEXT-CICD`를 설치했습니다. 업데이트하면 React 워크플로우로 교체되며, 수정하지 않은 파일은 삭제되고 수정한 파일은 `.bak`으로 보존됩니다. 배포 컨테이너 이름이 `<프로젝트>-nextjs-deploy`에서 `<프로젝트>-front-deploy`로 바뀌므로, 업데이트 후 첫 배포에서 기존 컨테이너 옆에 새 컨테이너가 뜹니다. 서버에서 이전 컨테이너를 직접 정리하세요.

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
| `SERVER_PASSWORD` | — | `SSH_AUTH_METHOD=password`일 때 (기본) | SSH 비밀번호 |
| `SSH_KEY` | — | `SSH_AUTH_METHOD=key`일 때 | 개인키(`.pem` 내용) |
| `PROJECT_DEPLOY_PORT` | — | 선택 | 호스트 포트, 기본 `3000` |

CI/CD 워크플로우는 체크아웃 직후 필수 Secret과 `Dockerfile`을 점검하고, 빠진 것을 오류로 알려 주고 멈춥니다. 서버에 배포하지 않는다면 CI/CD 파일을 지우거나 `--deploy-style none`으로 설치하세요.

브랜치 보호 규칙에는 **`CI Gate`** 하나만 required status check로 등록하세요. 이유는 [Spring → 브랜치 보호 규칙](../spring/#브랜치-보호-규칙)에 있습니다.
