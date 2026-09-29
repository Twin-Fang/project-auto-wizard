---
title: Spring
description: CI, server deploy styles and PR preview for Spring Boot projects.
---

Detected from `build.gradle`, `build.gradle.kts` or `pom.xml`. Installed on top of [release automation](../common/).

## Installed workflows

| Workflow | Trigger | What it does |
|---|---|---|
| `PROJECT-SPRING-CI.yml` | PR and push to the development branch, `workflow_dispatch` | Build verification. The last job, `ci-gate`, summarizes the result. |
| Server deploy (one of the four below) | Push to the release branch, `workflow_dispatch` | Build a Docker image and deploy it over SSH |
| `PROJECT-SPRING-PR-PREVIEW` | PR/issue comments, PR or issue closed | Preview environment per PR or issue |

### Deploy style

The four deploy styles are alternatives; only one is installed. In the interactive wizard you pick one, and it is installed with its `push` trigger enabled. Non-interactive runs use `--deploy-style` (default `simple`).

| `--deploy-style` | Workflow | How it deploys |
|---|---|---|
| `simple` | `PROJECT-SPRING-SIMPLE-CICD` | Stops and restarts the container on one server. Simplest, short downtime. |
| `nginx` | `PROJECT-SPRING-NONSTOP-NGINX-CICD` | Blue-green by switching the `proxy_pass` port in an Nginx config |
| `traefik` | `PROJECT-SPRING-NONSTOP-TRAEFIK-CICD` | Blue-green by switching Traefik labels |
| `none` | — | No server deploy and no PR preview |

The choice is saved as `deploy_style` in `version.yml`, so re-runs do not ask again. If you change it, the wizard cleans up the previous deploy workflow: an untouched file is deleted, an edited one is moved to `.bak` so your changes are kept. Leaving both would deploy twice.

PR preview is independent of the deploy style and is installed with any style except `none`.

### PR preview commands

Comment on a PR or an issue:

```
/wizard server build     build and deploy the preview
/wizard server destroy   remove the preview
/wizard server status    show the current state
```

The preview is removed when the PR or issue is closed. It expects a running Traefik container on the server and wildcard DNS such as `*.pr.example.com` pointing at it.

## Secrets

Deploy and preview workflows check the required secrets and the `Dockerfile` right after checkout. If something is missing they stop with an error naming it.

| Secret | Required | Notes |
|---|---|---|
| `DOCKERHUB_USERNAME` | yes | Docker Hub user |
| `DOCKERHUB_TOKEN` | yes | Docker Hub access token |
| `SERVER_HOST` | yes | Deploy server address |
| `SERVER_USER` | yes | SSH user |
| `SERVER_PASSWORD` | when `SSH_AUTH_METHOD=password` (default) | SSH password |
| `SSH_KEY` | when `SSH_AUTH_METHOD=key` | Private key (`.pem` contents), for example on AWS EC2 |
| `APPLICATION_PROD_YML` | optional | Written to `application-prod.yml` in the resources folder before the build |

`SSH_AUTH_METHOD`, ports, container name, volume mounts, SSH port and health-check settings live in the workflow's `env` section. Values the wizard asked for are remembered in the `deploy` block of `version.yml`.

If the project does not deploy to a server, delete the deploy workflow file, or install with `--deploy-style none`.

## Branch protection

Register only **`CI Gate`** (`ci-gate`) as the required status check, not the individual jobs. The CI workflow always runs; a first `changes` job decides whether the project path changed and skips the build jobs if not (skipped counts as success). `ci-gate` always runs and fails only if a required job failed or was cancelled. A workflow skipped by a `paths` filter would leave the required check pending and block the merge; a skipped job does not.
