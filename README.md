<div align="center">

**English** · [한국어](README.ko.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

# project-auto-wizard

**One command sets up versioning, CHANGELOG, GitHub Releases and CI/CD in your repo.**

Everything it installs is plain GitHub Actions in your own repository. No API keys, no hosted service.

[Docs](https://twin-fang.github.io/project-auto-wizard/) · [Quickstart](#quickstart) · [Changelog](CHANGELOG.md)

[![CI](https://github.com/Twin-Fang/project-auto-wizard/actions/workflows/CI.yaml/badge.svg)](https://github.com/Twin-Fang/project-auto-wizard/actions/workflows/CI.yaml)
[![npm version](https://img.shields.io/npm/v/project-auto-wizard)](https://www.npmjs.com/package/project-auto-wizard)
[![npm downloads](https://img.shields.io/npm/dm/project-auto-wizard)](https://www.npmjs.com/package/project-auto-wizard)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20.12-brightgreen)](package.json)

<img src="https://raw.githubusercontent.com/Twin-Fang/project-auto-wizard/main/assets/demo/install.gif" alt="Installing release automation into a Spring project with the wizard" width="800">

</div>

<!-- AUTO-VERSION-SECTION: DO NOT EDIT MANUALLY -->
## Latest Version : v0.16.2 (2026-10-01)

[Full release history](CHANGELOG.md)

## Why

Every new project starts with the same chores before the first feature: decide how versions are bumped, keep a CHANGELOG, write release notes, tag releases, and copy CI/CD workflows over from the last project and fix them up. It takes hours, and each repo ends up slightly different.

project-auto-wizard does that setup once, with a few prompts. After that, merging a release PR is all it takes to cut a release.

<a id="quickstart"></a>

## Quickstart

Run it in the root of your repository (Node.js 20.12 or later):

```bash
npx project-auto-wizard
```

It detects your project type, asks a few questions (branch strategy, deploy style, whether to use Copilot for summaries) and writes the files. For CI or scripts, run it non-interactively:

```bash
npx project-auto-wizard --mode full --force --type spring,react
npx project-auto-wizard --mode full --force --type node --dry-run   # preview only, writes nothing
```

Commit the generated files and push. `npx project-auto-wizard --mode doctor` checks the repository settings the workflows depend on.

Messages are in English or Korean (`en` | `ko`). The interactive wizard asks for the language first when nothing says which one to use; you can also pick one with `--lang`, the `PROJECT_AUTO_WIZARD_LANG` environment variable, or `language` in `version.yml`, in that order of precedence. The environment variable applies to that run only and does not overwrite a valid saved `language` (it is saved only when there is none); `--lang` does.

## What you get

| Installed | Purpose |
|---|---|
| `.github/workflows/PROJECT-COMMON-*.yaml` | Release automation: version bump, release PR notes, CHANGELOG, tag and GitHub Release, README version line, PR summary comments, branch-name suggestions on new issues |
| `.github/workflows/PROJECT-<TYPE>-*` | CI/CD for your stack (Spring, Flutter, React, Next.js, Python, Go) |
| `.github/scripts/*.py` | The logic behind the workflows, standard-library Python only |
| `version.yml` | Single source of the version, project types, paths, branches and options |
| `README.md` version section | Kept up to date after every release |

The files are yours to read and edit. Running the wizard again updates them: files you changed are kept when the upstream version did not change, and when both changed it asks whether to keep yours, replace with a backup, or add the new version alongside.

How a release flows with the default `pr-flow` strategy:

```
feature PRs ──▶ develop ──▶ release PR (develop → main)
                              │  next version from commit types: feat → minor, ! → major, else patch
                              │  release notes written, CHANGELOG.md / CHANGELOG.json updated
                              ▼
                           automerge ──▶ tag vX.Y.Z + GitHub Release ──▶ README version updated
```

With `trunk-based` (release branch = development branch), every push to the release branch runs the same steps in one workflow.

Release notes are rule-based by default. You can turn on GitHub Copilot (uses your Copilot AI Credits) or point it at any OpenAI-compatible API. If a model is unavailable or fails, it falls back to the rules, so a release is never blocked by the summary step.

## Without / with

| | Without | With project-auto-wizard |
|---|---|---|
| Initial setup | Copy workflows from an older repo and adapt them | `npx project-auto-wizard`, answer a few prompts |
| Next version | Decided and typed by hand | Derived from commit types in the release PR |
| CHANGELOG | Written by hand, often skipped | Updated when the release PR merges |
| Tags and Releases | Created manually | Created after merge |
| CI/CD per stack | Written per project | Installed for the detected types |
| AI summaries | Need an API key and custom scripting | Optional; rule-based works with no keys |

## Compared to other tools

| | project-auto-wizard | release-please | semantic-release | changesets |
|---|---|---|---|---|
| How it's added | Installs editable workflow files | GitHub Action + config | npm package run in CI + plugins | CLI + GitHub Action |
| Version decided by | Commit types (non-conventional commits → patch) | Conventional Commits | Conventional Commits (configurable) | Changeset files written by developers |
| Release PR | Yes (or trunk-based) | Yes | No, releases on push | Yes ("Version Packages") |
| Publishes to npm / PyPI | No | No | Yes, via plugins | Yes (npm) |
| Stack CI/CD included | Yes, per project type | No | No | No |
| Monorepo | Per-type paths, one shared version | Per-package versions | Community plugins | Per-package versions |

What the others do better:

- **release-please** is mature and widely used, updates version files for many ecosystems, and handles independently versioned packages in a monorepo.
- **semantic-release** publishes to npm and other registries with no manual step and has a large plugin ecosystem.
- **changesets** is the best fit for JavaScript monorepos publishing many packages, with changelog entries written by people rather than derived from commits.

## When to use it, and when not to

Use it if:

- you are starting a repo and want releases working from day one
- your team merges `develop` into `main` and wants a release PR with notes and a CHANGELOG
- you have a Spring, Flutter, React, Next.js, Python or Go project and want CI/CD and release automation from one setup
- one repo holds several stacks (for example a Spring backend and a React frontend) that share a version

Skip it if:

- a single package already releases fine with release-please or semantic-release
- the release itself must publish to a package registry (add your own workflow on the Release event, as this repo does for npm; this needs `WORKFLOW_PAT`, because releases created with `GITHUB_TOKEN` don't trigger other workflows)
- your packages need independent versions
- the repository is not on GitHub

## Supported project types

| Type | Detected from | Installed on top of release automation |
|---|---|---|
| `spring` | `build.gradle`, `build.gradle.kts`, `pom.xml` | CI, server deploy (single server / zero-downtime Nginx or Traefik), PR preview |
| `flutter` | `pubspec.yaml` | CI, Android (Firebase, Play Store, self-hosted, test APK), iOS TestFlight |
| `react` (React / Next.js) | `package.json` with a `react` or `next` dependency | CI, CI + CD |
| `python` | `pyproject.toml`, `setup.py`, `requirements.txt` | CI, PR preview, server deploy |
| `go` | `go.mod` | CI, PR preview, server deploy |
| `node`, `react-native`, `react-native-expo`, `basic` | `package.json` / fallback | Release automation only |

Several types can live in one repo (`--type spring,react`), and monorepo subfolders are set with `--paths "flutter=app,react=client"`.

<a id="post-install"></a>

## After installing

| Item | What to do |
|---|---|
| Workflow permissions | The installed workflows declare their own permissions. Set Settings → Actions → General → Workflow permissions to **Read and write permissions** only if your own workflows rely on the default |
| Merge commits | Allow merge commits so the release PR can automerge |
| `WORKFLOW_PAT` (optional) | Without it, a `GITHUB_TOKEN` fallback finishes the release, including the deploy workflows on the release branch, about 20 seconds later. Required only if you add your own workflows triggered by the Release event. Issue it from a bot or machine account (scopes: `repo`, `workflow`) |
| Copilot summaries (optional) | Off by default. Uses Copilot AI Credits; organizations must allow Copilot CLI billed to the organization |

<a id="flutter-store"></a>

Flutter store deployment (Play Store, Firebase, TestFlight) setup is described in the [Flutter page of the docs site](https://twin-fang.github.io/project-auto-wizard/project-types/flutter/).

## Documentation

The full documentation is at [twin-fang.github.io/project-auto-wizard](https://twin-fang.github.io/project-auto-wizard/), in English and Korean. Simplified Chinese and Japanese cover the landing page and quickstart; other pages fall back to English. It covers:

- every CLI option, `--mode status`, `--mode doctor`, `--dry-run` and `--mode uninstall`
- Flutter store deployment, deploy modes, required secrets and `ExportOptions.plist`
- the release notes engine chain and Copilot billing
- per-type workflow details, run logs, design principles and architecture

## Contributing

Issues and pull requests are welcome. Branch from `develop` and open PRs against `develop`; see [CONTRIBUTING.md](CONTRIBUTING.md) for setup and tests (`npm test`). This repository releases itself with the workflows it installs.

- [ARCHITECTURE.md](ARCHITECTURE.md) — module map, install pipeline, `@wizard` marker grammar, how updates compare files
- [ADDING-A-PROJECT-TYPE.md](ADDING-A-PROJECT-TYPE.md) — step-by-step guide to adding a project type
- [CONTRIBUTING.md](CONTRIBUTING.md) — dev setup and pull request rules

## License

[MIT](LICENSE)
