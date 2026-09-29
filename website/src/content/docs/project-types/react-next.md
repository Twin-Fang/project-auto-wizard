---
title: React and Next.js
description: CI and CI/CD workflows for React and Next.js projects.
---

Detected from `package.json`: a `next` dependency means `next`, otherwise a `react` dependency means `react`. Installed on top of [release automation](../common/).

## Installed workflows

| Workflow | Trigger | What it does |
|---|---|---|
| `PROJECT-REACT-CI` / `PROJECT-NEXT-CI` | PR and push to the development branch, `workflow_dispatch` | `npm ci`, `npm test` (if a `test` script exists), `npm run build`. Caches `node_modules` and build output (`.next/cache` for Next.js). Ends with a `ci-gate` job. |
| `PROJECT-REACT-CICD` / `PROJECT-NEXT-CICD` | Push to the release branch, `workflow_dispatch` | Build a Docker image and deploy it over SSH. Next.js runs as a Node.js runtime container for SSR. |

### Deploy style

React and Next.js follow the same `--deploy-style` rule as other server-deploy types, but only the single-server deploy exists:

| `--deploy-style` | Result |
|---|---|
| `simple` (default) | CI/CD installed |
| `nginx`, `traefik` | Installed as the single-server deploy; the wizard tells you so on the install screen |
| `none` | CI only, no CI/CD |

There is no PR preview workflow for React or Next.js.

## Secrets

CI needs no deploy secrets.

| Secret | CI | CI/CD | Notes |
|---|---|---|---|
| `ENV_FILE` (or `ENV`) | optional | optional | Written to `.env` before the build |
| `DOCKERHUB_USERNAME` | — | required | Docker Hub user |
| `DOCKERHUB_TOKEN` | — | required | Docker Hub access token |
| `SERVER_HOST` | — | required | Deploy server address |
| `SERVER_USER` | — | required | SSH user |
| `SERVER_PASSWORD` | — | when `SSH_AUTH_METHOD=password` (default) | SSH password |
| `SSH_KEY` | — | when `SSH_AUTH_METHOD=key` | Private key (`.pem` contents) |
| `PROJECT_DEPLOY_PORT` | — | optional | Host port, default `3000` |

The CI/CD workflow checks the required secrets and the `Dockerfile` right after checkout and stops with an error naming what is missing. If you do not deploy to a server, delete the CI/CD file or install with `--deploy-style none`.

Register only **`CI Gate`** as the required status check in branch protection. See [Spring → Branch protection](../spring/#branch-protection) for why.
