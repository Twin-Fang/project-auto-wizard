---
title: Go
description: Go 프로젝트의 CI, PR 프리뷰, 서버 배포.
---

`go.mod`로 감지합니다. [릴리스 자동화](../common/) 위에 아래가 추가로 설치됩니다. `go.mod`에는 버전 필드가 없어 버전은 `version.yml`과 git 태그에만 남습니다.

## 설치되는 워크플로우

| 워크플로우 | 트리거 | 하는 일 |
|---|---|---|
| `PROJECT-GO-CI` | 개발 브랜치 PR·push, `workflow_dispatch` | `go build`, `go vet`, `go test`, lint. `go.mod`의 `go` 지시자 버전을 사용. `Dockerfile`이 필요 없어 CLI·라이브러리에도 맞음 |
| `PROJECT-GO-SIMPLE-CICD` | 릴리스 브랜치 push, `workflow_dispatch` | Docker 이미지 빌드 후 SSH로 배포. `Dockerfile` 필요 |
| `PROJECT-GO-PR-PREVIEW` | PR·이슈 댓글, PR·이슈 닫힘 | PR·이슈별 프리뷰 환경, Traefik으로 라우팅 |

### 배포 방식

| `--deploy-style` | 결과 |
|---|---|
| `simple` (기본) | SIMPLE-CICD와 PR 프리뷰 설치 |
| `nginx`, `traefik` | 단일 서버 배포로 설치되고, 설치 화면에 그 사실을 알림 |
| `none` | CI만 설치 — CI/CD와 PR 프리뷰 제외 |

배포하지 않는 CLI 도구나 라이브러리라면 `--deploy-style none`으로 설치하세요.

### PR 프리뷰 명령

```
/wizard server build     프리뷰 빌드 및 배포
/wizard server destroy   프리뷰 환경 삭제
/wizard server status    현재 상태 확인
```

서버에 Traefik 컨테이너(`traefik-network`)가 실행 중이어야 하고, `*.pr.example.com` 같은 와일드카드 DNS가 필요합니다.

## Secret

CI에는 필요 없습니다.

| Secret | 배포 / 프리뷰 | 비고 |
|---|---|---|
| `ENV_FILE` | 선택 | `.env` 내용 |
| `DOCKERHUB_USERNAME` | 필수 | |
| `DOCKERHUB_TOKEN` | 필수 | |
| `SERVER_HOST` | 필수 | |
| `SERVER_USER` | 필수 | SSH 사용자명 |
| `SERVER_PASSWORD` | `SSH_AUTH_METHOD=password`(기본)일 때 | |
| `SSH_KEY` | `SSH_AUTH_METHOD=key`일 때 | 개인키 `.pem` 내용 |

컨테이너 포트(기본 `8080`), 배포 포트, 볼륨 마운트, SSH 포트, 헬스체크는 워크플로우의 `env` 섹션에서 설정합니다.
