---
title: Introduction
description: What project-auto-wizard installs and when it is a good fit.
---

Every new project starts with the same chores before the first feature: decide how versions are bumped, keep a CHANGELOG, write release notes, tag releases, and copy CI/CD workflows over from the last project and fix them up. It takes hours, and each repo ends up slightly different.

project-auto-wizard does that setup once, with a few prompts. After that, merging a release PR is all it takes to cut a release.

```bash
npx project-auto-wizard
```

## What it installs

| Part | What it does |
|---|---|
| **The wizard** (`npx`) | Detects the project type from marker files — 10 types, several types in one repo, and monorepo subfolders. Asks only what it cannot detect. |
| **Release automation** | When a release PR is opened: confirm the version → write release notes (rule-based by default, GitHub Copilot optional) → update CHANGELOG → automerge → tag and GitHub Release. No API keys. |
| **CI/CD per project type** | Spring (including zero-downtime deploys), Flutter (store deployment), React, Next.js, Python and Go get workflows for their stack. |

In your repository this ends up as:

| Path | Purpose |
|---|---|
| `.github/workflows/PROJECT-COMMON-*.yaml` | Release automation: version bump, release PR notes, CHANGELOG, tag and GitHub Release, README version line, PR summary comments, branch-name suggestions on new issues |
| `.github/workflows/PROJECT-<TYPE>-*` | CI/CD for your stack |
| `.github/scripts/*.py` | The logic behind the workflows, standard-library Python only |
| `version.yml` | Single source of the version, project types, paths, branches and options |
| `README.md` version section | Kept up to date after every release |

The files are yours to read and edit. Running the wizard again updates them without overwriting your changes silently — see [Updating and re-running](../../operate/updating/).

## Without and with

| | Without | With project-auto-wizard |
|---|---|---|
| Initial setup | Copy workflows from an older repo and adapt them | `npx project-auto-wizard`, answer a few prompts |
| Next version | Decided and typed by hand | Derived from commit types in the release PR |
| CHANGELOG | Written by hand, often skipped | Updated when the release PR merges |
| Tags and Releases | Created manually | Created after merge |
| CI/CD per stack | Written per project | Installed for the detected types |
| AI summaries | Need an API key and custom scripting | Optional; rule-based works with no keys |

## When to use it, and when not to

Use it if:

- you are starting a repo and want releases working from day one
- your team merges `develop` into `main` and wants a release PR with notes and a CHANGELOG
- you have a Spring, Flutter, React, Next.js, Python or Go project and want CI/CD and release automation from one setup
- one repo holds several stacks (for example a Spring backend and a React frontend) that share a version

Skip it if:

- a single package already releases fine with release-please or semantic-release
- the release itself must publish to a package registry (add your own workflow on the Release event, as this repository does for npm)
- your packages need independent versions
- the repository is not on GitHub

See [Comparison](../../reference/comparison/) for how it differs from release-please, semantic-release and changesets.

## Design principles

- **One source of files.** Everything the wizard installs comes from the `payload/` folder shipped in the npm package. No template repo is cloned and nothing is downloaded, so the same package version always installs the same result. The wizard itself makes no network requests; only git/gh commands against your own repository reach the network (default-branch detection, pushing a new `develop` branch, and the `gh` queries in `--mode doctor`).
- **Cross-platform.** The wizard is Node; every installed script is Python. There is no bash/PowerShell pair to keep in sync.
- **Graceful degradation.** If an AI engine fails, the next one runs, and the rule-based fallback always succeeds. A release is never blocked by the summary step.
- **Standards first.** GitHub labels, Releases and Conventional Commits instead of custom inventions.
- **Idempotent.** Re-running is safe: unchanged files are skipped, and real conflicts are resolved with a three-way choice.
