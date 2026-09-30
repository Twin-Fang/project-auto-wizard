---
title: React and Next.js
description: CI and CI/CD workflows for React and Next.js projects.
---

Detected from `package.json`: a `react` or `next` dependency means `react`. Next.js projects are React projects here and get the same workflows. Installed on top of [release automation](../common/).

`next` is still accepted as an alias of `react` in `--type`, `--paths` and `version.yml`; the wizard records it as `react`.

## Installed workflows

| Workflow | Trigger | What it does |
|---|---|---|
| `PROJECT-REACT-CI` | PR and push to the development branch, `workflow_dispatch` | `npm ci`, `npm test` (if a `test` script exists), `npm run build`. Caches `node_modules` and the Next.js build (`.next/cache`), and prints the size of `.next` when the build creates it. Ends with a `ci-gate` job. |
| `PROJECT-REACT-CICD` | Push to the release branch, `workflow_dispatch` | Build a Docker image and deploy it over SSH. The container runs with `NODE_ENV=production` and `--restart unless-stopped`, and is named `<project>-front-deploy`. |

Earlier versions installed `PROJECT-NEXT-CI` and `PROJECT-NEXT-CICD` for Next.js projects. Updating replaces them with the React workflows: untouched files are removed, edited ones are kept as `.bak`. The deployed container name changes from `<project>-nextjs-deploy` to `<project>-front-deploy`, so the first deploy after the update starts a new container next to the old one; remove the old container on the server.

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
