---
title: Python
description: Python 프로젝트의 CI, PR 프리뷰, 서버 배포.
---

`pyproject.toml`, `setup.py`, `requirements.txt`로 감지합니다. [릴리스 자동화](../common/) 위에 아래가 추가로 설치됩니다. 버전은 `pyproject.toml`에 동기화됩니다.

## 설치되는 워크플로우

| 워크플로우 | 트리거 | 하는 일 |
|---|---|---|
| `PROJECT-PYTHON-CI` | 개발 브랜치 PR·push, `workflow_dispatch` | 의존성 설치(`requirements.txt`, 없으면 `pip install .`), 테스트가 있으면 `pytest`(`tests/`, `test/`, `test_*.py`, `*_test.py`), `Dockerfile`이 있으면 Docker 빌드 검증. 배포는 하지 않음 |
| `PROJECT-PYTHON-SIMPLE-CICD` | 릴리스 브랜치 push, `workflow_dispatch` | Docker 이미지 빌드 후 SSH로 배포 (Synology, AWS EC2, VPS 등) |
| `PROJECT-PYTHON-PR-PREVIEW` | PR·이슈 댓글, PR·이슈 닫힘 | PR·이슈별 프리뷰 환경, Traefik으로 라우팅 |

CI는 `Dockerfile`이 없어도 실패하지 않고 Docker 빌드 검증만 건너뜁니다. 배포와 프리뷰에는 `Dockerfile`이 필요합니다.

### 배포 방식

| `--deploy-style` | 결과 |
|---|---|
| `simple` (기본) | SIMPLE-CICD와 PR 프리뷰 설치 |
| `nginx`, `traefik` | 단일 서버 배포로 설치되고, 설치 화면에 그 사실을 알림 |
| `none` | CI만 설치 — CI/CD와 PR 프리뷰 제외 |

### PR 프리뷰 명령

```
/wizard server build     프리뷰 빌드 및 배포
/wizard server destroy   프리뷰 환경 삭제
/wizard server status    현재 상태 확인
```

서버에 Traefik 컨테이너(`traefik-network`)가 실행 중이어야 하고, `*.pr.example.com` 같은 와일드카드 DNS가 서버를 가리켜야 합니다. PR이나 이슈가 닫히면 프리뷰도 삭제됩니다.

## Secret

| Secret | CI | 배포 / 프리뷰 | 비고 |
|---|---|---|---|
| `ENV_FILE` | 선택 | 선택 | `.env` 내용. CI는 없으면 빈 `.env`로 검증 |
| `DOCKERHUB_USERNAME` | — | 필수 | |
| `DOCKERHUB_TOKEN` | — | 필수 | |
| `SERVER_HOST` | — | 필수 | |
| `SERVER_USER` | — | 필수 | SSH 사용자명 |
| `SERVER_PASSWORD` | — | `SSH_AUTH_METHOD=password`(기본)일 때 | |
| `SSH_KEY` | — | `SSH_AUTH_METHOD=key`일 때 | 개인키 `.pem` 내용 |

포트, 헬스체크 경로(예: FastAPI는 `/docs`) 등은 워크플로우의 `env` 섹션에서 설정합니다.
