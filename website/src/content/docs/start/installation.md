---
title: Installation and requirements
description: Requirements, type detection, multi-type repos, monorepo paths and prompt customization.
---

## Requirements

| Where | Requirement |
|---|---|
| Your machine | Node.js **20.12 or later** (`npx` runs the wizard; it has no npm dependencies). `git` for branch detection. `gh` only for `--mode doctor`. |
| Your repository | A git repository hosted on GitHub. Run the wizard from the repository root. |
| GitHub Actions | The installed scripts are standard-library Python and run on GitHub-hosted runners without extra setup. Merge commits must be allowed for the release PR to automerge. |

There is nothing to install globally:

```bash
npx project-auto-wizard
```

## Project type detection

The wizard looks for marker files and proposes the types it found. You can accept or change them in the prompt, or pass `--type` to skip detection.

| Type | Detected from |
|---|---|
| `flutter` | `pubspec.yaml` |
| `spring` | `build.gradle`, `build.gradle.kts`, `pom.xml` |
| `python` | `pyproject.toml`, `setup.py`, `requirements.txt` |
| `go` | `go.mod` |
| `react-native-expo` | `package.json` with an `expo` dependency |
| `react-native` | `package.json` with a `react-native` dependency |
| `next` | `package.json` with a `next` dependency |
| `react` | `package.json` with a `react` dependency |
| `node` | `package.json` without the dependencies above, and no other type found |
| `basic` | nothing above matched |

`package.json` is classified by its dependency keys (`dependencies`, `devDependencies`, `peerDependencies`), not by searching the text, so a `next` keyword or an `export` script does not change the result.

### Initial version

If you do not pass `--project-version`, the wizard reads the version from the primary type's file first (`build.gradle`/`build.gradle.kts`/`pom.xml`, `pubspec.yaml`, `pyproject.toml`/`setup.py`, `package.json`, or `app.json` for Expo), then the other known files, then the latest git tag. Pre-release suffixes such as `-rc.1` are dropped. If nothing is found it uses `0.0.1` and prints a warning.

## Several types in one repository

```bash
npx project-auto-wizard --mode full --force --type spring,react,python
```

All listed types share one version in `version.yml`. The first type is the primary one: its version file is compared with `version.yml` during releases.

## Monorepo paths

When a type lives in a subfolder, map it with `--paths`:

```bash
npx project-auto-wizard --mode full --force --type flutter,react --paths "flutter=app,react=client"
```

The mapping is stored in `project_paths` in `version.yml`. Workflows run against that folder, and deploy workflows that run on pushes to the release branch only trigger when files under it change.

## Customizing prompt text

The label, help text and example of each wizard prompt can be overridden with `.github/config/wizard-prompts.yml`. The wizard does not install this file; create it yourself. To override a prompt for one type only, use a `{type}.KEY` entry:

```yaml
PROJECT_NAME:
  label: "What is the project name?"
  help: "Only needed if it should differ from the GitHub repository name."

flutter.APP_ARTIFACT_NAME:
  label: "Flutter app artifact name"
```

## Previewing without writing

`--dry-run` works with `full` and `uninstall`. It shows what would change and writes nothing, so it does not need `--force`:

```bash
npx project-auto-wizard --mode full --force --type node --dry-run
```
