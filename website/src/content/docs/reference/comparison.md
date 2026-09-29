---
title: Comparison
description: How project-auto-wizard compares with release-please, semantic-release and changesets.
---

These tools overlap in versioning and changelogs but are added to a repository differently and stop at different points.

| | project-auto-wizard | release-please | semantic-release | changesets |
|---|---|---|---|---|
| How it's added | Installs editable workflow files | GitHub Action + config | npm package run in CI + plugins | CLI + GitHub Action |
| Version decided by | Commit types (non-conventional commits → patch) | Conventional Commits | Conventional Commits (configurable) | Changeset files written by developers |
| Release PR | Yes (or trunk-based) | Yes | No, releases on push | Yes ("Version Packages") |
| Publishes to npm / PyPI | No | No | Yes, via plugins | Yes (npm) |
| Stack CI/CD included | Yes, per project type | No | No | No |
| Monorepo | Per-type paths, one shared version | Per-package versions | Community plugins | Per-package versions |
| Release notes | Rule-based, optional Copilot or your AI API | From commits | From commits | From changeset text |

## What the others do better

- **release-please** is mature and widely used, updates version files for many ecosystems, and handles independently versioned packages in a monorepo.
- **semantic-release** publishes to npm and other registries with no manual step and has a large plugin ecosystem.
- **changesets** is the best fit for JavaScript monorepos publishing many packages, with changelog entries written by people rather than derived from commits.

## Where project-auto-wizard fits

- You want release automation **and** CI/CD for a Spring, Flutter, React, Next.js, Python or Go project from one setup.
- One repository holds several stacks that share one version.
- You prefer plain workflow files in your repository that you can read and change over an action or package configured from outside.
- You want releases to keep working with no commit convention and no API key.

If you need independent package versions or registry publishing as part of the release, one of the tools above is a better fit. They can also be combined: this repository uses the installed release flow and a separate workflow on the Release event to publish to npm.
