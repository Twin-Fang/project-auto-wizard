---
title: Python
description: CI, PR preview and server deploy for Python projects.
---

Detected from `pyproject.toml`, `setup.py` or `requirements.txt`. Installed on top of [release automation](../common/). The version is synced to `pyproject.toml`.

## Installed workflows

| Workflow | Trigger | What it does |
|---|---|---|
| `PROJECT-PYTHON-CI` | PR and push to the development branch, `workflow_dispatch` | Install dependencies (`requirements.txt`, otherwise `pip install .`), run `pytest` if tests exist (`tests/`, `test/`, `test_*.py`, `*_test.py`), and build the Docker image if a `Dockerfile` exists. No deploy. |
| `PROJECT-PYTHON-SIMPLE-CICD` | Push to the release branch, `workflow_dispatch` | Build a Docker image and deploy it over SSH (Synology, AWS EC2, a VPS, …) |
| `PROJECT-PYTHON-PR-PREVIEW` | PR/issue comments, PR or issue closed | Preview environment per PR or issue, routed by Traefik |

CI does not fail without a `Dockerfile`; it only skips the Docker build check. The deploy and preview workflows require one.

### Deploy style

| `--deploy-style` | Result |
|---|---|
| `simple` (default) | SIMPLE-CICD and PR preview installed |
| `nginx`, `traefik` | Installed as the single-server deploy; the wizard tells you so |
| `none` | CI only — no CI/CD and no PR preview |

### PR preview commands

```
/wizard server build     build and deploy the preview
/wizard server destroy   remove the preview
/wizard server status    show the current state
```

Requires a running Traefik container (`traefik-network`) and wildcard DNS such as `*.pr.example.com` pointing at the server. Previews are removed when the PR or issue is closed.

## Secrets

| Secret | CI | Deploy / preview | Notes |
|---|---|---|---|
| `ENV_FILE` | optional | optional | `.env` contents. CI uses an empty `.env` without it. |
| `DOCKERHUB_USERNAME` | — | required | |
| `DOCKERHUB_TOKEN` | — | required | |
| `SERVER_HOST` | — | required | |
| `SERVER_USER` | — | required | SSH user |
| `SERVER_PASSWORD` | — | when `SSH_AUTH_METHOD=password` (default) | |
| `SSH_KEY` | — | when `SSH_AUTH_METHOD=key` | Private key (`.pem` contents) |

Ports, health-check path (for example `/docs` for FastAPI) and other settings are in the workflow's `env` section.
