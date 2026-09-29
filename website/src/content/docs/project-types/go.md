---
title: Go
description: CI, PR preview and server deploy for Go projects.
---

Detected from `go.mod`. Installed on top of [release automation](../common/). `go.mod` has no version field, so the version lives in `version.yml` and git tags only.

## Installed workflows

| Workflow | Trigger | What it does |
|---|---|---|
| `PROJECT-GO-CI` | PR and push to the development branch, `workflow_dispatch` | `go build`, `go vet`, `go test` and lint. Uses the Go version from the `go` directive in `go.mod`. No `Dockerfile` needed, so it suits CLIs and libraries too. |
| `PROJECT-GO-SIMPLE-CICD` | Push to the release branch, `workflow_dispatch` | Build a Docker image and deploy it over SSH. Requires a `Dockerfile`. |
| `PROJECT-GO-PR-PREVIEW` | PR/issue comments, PR or issue closed | Preview environment per PR or issue, routed by Traefik |

### Deploy style

| `--deploy-style` | Result |
|---|---|
| `simple` (default) | SIMPLE-CICD and PR preview installed |
| `nginx`, `traefik` | Installed as the single-server deploy; the wizard tells you so |
| `none` | CI only — no CI/CD and no PR preview |

For a CLI tool or library that is never deployed, install with `--deploy-style none`.

### PR preview commands

```
/wizard server build     build and deploy the preview
/wizard server destroy   remove the preview
/wizard server status    show the current state
```

Requires a running Traefik container (`traefik-network`) and wildcard DNS such as `*.pr.example.com`.

## Secrets

CI needs none.

| Secret | Deploy / preview | Notes |
|---|---|---|
| `ENV_FILE` | optional | `.env` contents |
| `DOCKERHUB_USERNAME` | required | |
| `DOCKERHUB_TOKEN` | required | |
| `SERVER_HOST` | required | |
| `SERVER_USER` | required | SSH user |
| `SERVER_PASSWORD` | when `SSH_AUTH_METHOD=password` (default) | |
| `SSH_KEY` | when `SSH_AUTH_METHOD=key` | Private key (`.pem` contents) |

Container port (default `8080`), deploy port, volume mounts, SSH port and health checks are set in the workflow's `env` section.
