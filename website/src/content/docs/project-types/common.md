---
title: Release automation (all types)
description: The common workflows and scripts installed for every project type.
---

Every project type, including `basic`, gets the same release automation. The type-specific pages list what is installed on top of it.

## Workflows

| Workflow | Trigger | What it does |
|---|---|---|
| `PROJECT-COMMON-AUTO-CHANGELOG-CONTROL` | PR from the development branch to the release branch | Confirms the version, writes release notes and CHANGELOG, automerges. pr-flow only. |
| `PROJECT-COMMON-RELEASE-PUBLISH` | Push to the release branch, `workflow_dispatch` | Tag `vX.Y.Z` and GitHub Release. In trunk-based mode it also bumps the version and writes the CHANGELOG. |
| `PROJECT-COMMON-VERSION-CONTROL` | Push to the release branch (skipped when only `CHANGELOG.*` or `version.yml` changed), `workflow_dispatch` | Safety-net patch bump for direct pushes. pr-flow only. |
| `PROJECT-COMMON-README-VERSION-UPDATE` | Push to the release branch, `workflow_dispatch` | Rewrites the version line under `<!-- AUTO-VERSION-SECTION -->` in `README.md`. |
| `PROJECT-COMMON-AI-PR-SUMMARY` | PR to the release branch | Posts a summary comment. Skips release PRs. |
| `PROJECT-COMMON-ISSUE-HELPER` | Issue opened, or title edited | Comments a normalized branch name and commit message. |

`PROJECT-COMMON-ISSUE-HELPER` can also create the branch: set `ISSUE_HELPER_CREATE_BRANCH: "true"` in its `env` section. It is `"false"` by default so opening an issue does not create a branch.

## Scripts

Copied to `.github/scripts/`. Standard-library Python only.

| Script | Role |
|---|---|
| `version_manager.py` | Reads and bumps the version, syncs it to each type's version file |
| `changelog_manager.py` | Summary engine chain, `CHANGELOG.json` / `CHANGELOG.md` |
| `truncate_release_notes.py` | Trims release notes to a length limit (used by the Flutter store and Firebase workflows) |
| `issue_helper.py` | Branch name and commit message for issues |

## Secrets and variables

None are required. All of these are optional:

| Name | Kind | Used for |
|---|---|---|
| `WORKFLOW_PAT` | Secret | Faster automerge → Release, and lets `release: published` trigger other workflows. Issue it from a bot or machine account (scopes: `repo`, `workflow`). |
| `AI_API_KEY` | Secret | Your OpenAI-compatible API (needs the two variables below as well) |
| `AI_API_BASE_URL` | Variable | Endpoint base URL |
| `AI_MODEL` | Variable | Model name |

Copilot summaries need no secret; they use `GITHUB_TOKEN` when `copilot_ai: true`. See [Summary engine](../../understand/summary-engine/).

## Repository settings

- **Allow merge commits.** The release PR automerges with a merge commit.
- **Workflow permissions** can stay at Read. Every installed workflow declares its own `permissions`.

`npx project-auto-wizard --mode doctor` checks both. See [doctor](../../operate/doctor/).
