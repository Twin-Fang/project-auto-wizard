---
title: Spring
description: Spring Boot 프로젝트의 CI, 서버 배포 방식, PR 프리뷰.
---

`build.gradle`, `build.gradle.kts`, `pom.xml`로 감지합니다. [릴리스 자동화](../common/) 위에 아래가 추가로 설치됩니다.

## 설치되는 워크플로우

| 워크플로우 | 트리거 | 하는 일 |
|---|---|---|
| `PROJECT-SPRING-CI.yml` | 개발 브랜치 PR·push, `workflow_dispatch` | 빌드 검증. 마지막 job `ci-gate`가 결과를 모읍니다. |
| 서버 배포 (아래 넷 중 하나) | 릴리스 브랜치 push, `workflow_dispatch` | Docker 이미지 빌드 후 SSH로 배포 |
| `PROJECT-SPRING-PR-PREVIEW` | PR·이슈 댓글, PR·이슈 닫힘 | PR·이슈별 프리뷰 환경 |

### 배포 방식

서버 배포 워크플로우는 서로 대체재라 하나만 설치합니다. 대화형에서 고르면 그것만, **`push` 트리거까지 켜진 채로** 설치됩니다. 비대화형은 `--deploy-style`(기본 `simple`)을 씁니다.

| `--deploy-style` | 워크플로우 | 배포 방식 |
|---|---|---|
| `simple` | `PROJECT-SPRING-SIMPLE-CICD` | 서버 한 대에서 컨테이너를 내렸다 올림. 가장 단순, 짧은 다운타임 |
| `nginx` | `PROJECT-SPRING-NONSTOP-NGINX-CICD` | Nginx config의 `proxy_pass` 포트를 바꿔 Blue-Green 무중단 배포 |
| `traefik` | `PROJECT-SPRING-NONSTOP-TRAEFIK-CICD` | Traefik 라벨을 바꿔 Blue-Green 무중단 배포 |
| `none` | — | 서버 배포와 PR 프리뷰 모두 설치하지 않음 |

고른 방식은 `version.yml`의 `deploy_style`에 기록되어 다시 실행해도 묻지 않습니다. 방식을 바꾸면 이전 배포 워크플로우를 마법사가 정리합니다. 손대지 않은 파일은 삭제하고, 수정한 파일은 `.bak`으로 옮겨 내용을 보존합니다. 남겨 두면 배포가 두 번 돕니다.

PR 프리뷰는 배포 방식과 별개 축이라 `none`을 제외한 모든 방식에서 함께 설치됩니다.

### PR 프리뷰 명령

PR이나 이슈에 댓글로 씁니다:

```
/wizard server build     프리뷰 빌드 및 배포
/wizard server destroy   프리뷰 환경 삭제
/wizard server status    현재 상태 확인
```

PR이나 이슈가 닫히면 프리뷰도 삭제됩니다. 서버에 Traefik 컨테이너가 실행 중이어야 하고, `*.pr.example.com` 같은 와일드카드 DNS가 서버를 가리켜야 합니다.

## Secret

배포·프리뷰 워크플로우는 체크아웃 직후 필수 Secret과 `Dockerfile`을 먼저 점검합니다. 빠진 것이 있으면 이름을 오류로 알려 주고 멈춥니다.

| Secret | 필수 | 비고 |
|---|---|---|
| `DOCKERHUB_USERNAME` | 예 | Docker Hub 사용자명 |
| `DOCKERHUB_TOKEN` | 예 | Docker Hub 액세스 토큰 |
| `SERVER_HOST` | 예 | 배포 서버 주소 |
| `SERVER_USER` | 예 | SSH 사용자명 |
| `SERVER_PASSWORD` | `SSH_AUTH_METHOD=password`(기본)일 때 | SSH 비밀번호 |
| `SSH_KEY` | `SSH_AUTH_METHOD=key`일 때 | 개인키 `.pem` 내용 (AWS EC2 등) |
| `APPLICATION_PROD_YML` | 선택 | 빌드 전에 resources 폴더의 `application-prod.yml`로 기록 |

`SSH_AUTH_METHOD`, 포트, 컨테이너 이름, 볼륨 마운트, SSH 포트, 헬스체크 설정은 워크플로우의 `env` 섹션에 있습니다. 마법사가 물은 값은 `version.yml`의 `deploy` 블록에 저장됩니다.

서버에 배포하지 않는 프로젝트라면 배포 워크플로우 파일을 지우거나 `--deploy-style none`으로 설치하세요.

## 브랜치 보호 규칙

required status check에는 개별 job이 아니라 **`CI Gate`**(`ci-gate`) 하나만 등록하세요. CI 워크플로우는 항상 실행되고, 첫 job `changes`가 프로젝트 경로 변경 여부를 판별해 나머지 job을 건너뜁니다(건너뛴 job은 Success). `ci-gate`는 항상 실행되어 필수 job이 실패하거나 취소됐을 때만 실패합니다. 경로 필터로 워크플로우 자체를 건너뛰면 required check가 Pending에 머물러 머지가 막히지만, job을 건너뛰는 방식은 그렇지 않습니다.
