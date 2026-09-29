---
title: How it works
description: What the wizard does at install time and what runs in GitHub Actions afterwards.
---

project-auto-wizard has two halves that never talk to each other at runtime:

1. **The wizard** — a Node CLI you run once (and again to update). It detects, asks, and writes files.
2. **The installed workflows** — GitHub Actions and Python scripts in your repository. They do the actual release work on every PR and push.

After installation the wizard is not needed. If you delete it from your machine, releases keep working.

## Install time

```
npx project-auto-wizard
  │
  ├─ detect      marker files → project types, version, default branch
  ├─ ask         branch strategy, deploy style, semver-auto, Copilot, type-specific values
  ├─ render      copy payload/ files, replace branch and project placeholders
  ├─ write       .github/workflows/*, .github/scripts/*.py, version.yml, README version section
  └─ record      .github/.wizard/baseline.json (hashes for the next update)
                 .github/.wizard/logs/<time>-<action>.log (what was decided and why)
```

Everything comes from the `payload/` folder inside the npm package. No template repository is cloned and nothing is downloaded, so a given package version always produces the same files.

Placeholders such as `{{MAIN_BRANCH}}` and `{{DEVELOP_BRANCH}}` are replaced with your branch names. Values the wizard asks for (for example a deploy port) are written into the workflow's `env` section and remembered in the `deploy` block of `version.yml`, so the next run does not ask again.

## Run time

```
.github/workflows/PROJECT-*.yaml   ──calls──▶   .github/scripts/*.py
          │                                      version_manager.py    version files, bump rules
          │                                      changelog_manager.py  release notes, CHANGELOG
          │                                      issue_helper.py       branch-name comments
          ▼                                      truncate_release_notes.py
     version.yml   (version, types, paths, branches, options)
```

- `version.yml` is the single source of truth. Workflows read the branch mode, `semver_auto`, `copilot_ai` and paths from it.
- The version is synced into each type's own file (for example `build.gradle`, `pubspec.yaml`, `package.json`, `pyproject.toml`). See [version.yml](../../reference/version-yml/) for the list.
- The scripts are Python standard library only, so there is no `pip install` step and no bash/PowerShell split.

## What triggers what

| Event | Workflow |
|---|---|
| Issue opened or retitled | `PROJECT-COMMON-ISSUE-HELPER` comments a normalized branch name and commit message |
| PR to the release branch (non-release PR) | `PROJECT-COMMON-AI-PR-SUMMARY` comments a summary |
| Release PR (`develop → main`) | `PROJECT-COMMON-AUTO-CHANGELOG-CONTROL` confirms the version, writes notes and CHANGELOG, automerges |
| Push to the release branch | `PROJECT-COMMON-RELEASE-PUBLISH` tags and publishes the Release; `PROJECT-COMMON-VERSION-CONTROL` bumps the version if the push did not come from a release PR; `PROJECT-COMMON-README-VERSION-UPDATE` updates the README version line |
| PR / push to the development branch | Type CI (`PROJECT-<TYPE>-CI`) |
| Push to the release branch | Type deploy workflows (server deploy, store deploy) |

The details are in [Release flow](../release-flow/) and [Branch strategies](../branch-strategies/).

## Updating

Running the wizard again compares three versions of every installed workflow: what it installed last time (from `baseline.json`), what is on disk now, and what the new payload renders. Files you did not touch are updated; files only you changed are kept; files both sides changed are a conflict you resolve. See [Updating and re-running](../../operate/updating/).
