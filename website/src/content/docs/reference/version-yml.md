---
title: version.yml
description: Fields of version.yml, the single source of the version and the wizard's saved choices.
---

`version.yml` sits in the repository root. The release workflows read and update it, and the wizard stores its choices in it so re-runs do not ask again. You can edit it by hand.

```yaml
version: "1.4.2"
version_code: 57 # app build number
project_types: ["spring", "react"] # first entry is primary
language: "en" # message language: en | ko
project_paths: # project folder per type (relative to the repo root)
  spring: "server" # server/build.gradle
  react: "client" # client/package.json
metadata:
  last_updated: "2026-09-26"
  last_updated_by: "project-auto-wizard"
  default_branch: "main"
  integration_date: "2026-07-09"
  template:
    source: "project-auto-wizard"
    version: "0.12.2"
    integrated_date: "2026-07-09"
    last_update_date: "2026-09-26"
    branches:
      main: "main"
      develop: "develop"
      mode: "pr-flow" # pr-flow | trunk-based
    options:
      semver_auto: true
      copilot_ai: false
      release_automerge: true
      deploy_style: "simple" # simple | nginx | traefik | none

deploy: # deploy settings the wizard remembers (non-sensitive / safe to edit)
  spring:
    DEPLOY_PORT: "8080"
```

## Top-level fields

| Field | Description |
|---|---|
| `version` | Current version, `x.y.z`. Updated by the release workflows. |
| `version_code` | Monotonically increasing build number, bumped with every version (used by app builds). |
| `project_types` | All project types. The first entry is the primary type; its version file is compared with `version.yml` during releases. |
| `language` | Message language for both the installer and the messages printed by the installed workflows and scripts, `en` (default) or `ko`. Set with `--lang` (saved and kept on update); `PROJECT_AUTO_WIZARD_LANG` affects only the run it is set for, except on a first install where it is saved. An existing file without this key is treated as `en`; use `--lang ko` to keep Korean. |
| `project_paths` | Per-type folder relative to the repository root. Omitted types live at the root. |
| `deploy` | Non-secret values the wizard asked for per type (for example deploy ports), reused on the next run. Written only for types that have such values. |

Unknown top-level fields you add are preserved when the wizard rewrites the file.

## `metadata.template.branches`

| Field | Description |
|---|---|
| `main` | Release branch |
| `develop` | Development branch |
| `mode` | `pr-flow` or `trunk-based` (release branch = development branch) |

## `metadata.template.options`

| Field | Values | Description |
|---|---|---|
| `semver_auto` | `true` (default) / `false` | Bump from commit types. `false` means patch + 1 every release; edit major/minor by hand. |
| `copilot_ai` | `false` (default) / `true` | Let the summary workflows call the Copilot CLI (consumes AI Credits) |
| `release_automerge` | `true` (default; a missing key also means on) / `false` | Merge the release PR automatically. `false` leaves it for you to merge; use a merge commit (squash and rebase skip the release workflow, see [Release flow](../../understand/release-flow/)) |
| `deploy_style` | `simple` / `nginx` / `traefik` / `none` | Server deploy style. Written when a type has server deploy workflows. |
| `env_mode` | `dart-define` / `dotenv` | Flutter only. Environment variable mode. |
| `flutter_store` | `android` / `ios` / `android,ios` / `none` | Flutter only. Store deploy targets. |
| `android_deploy_mode` | `store_only` / `store_prepare` / `store_submit` | Flutter only. Play Store deploy mode. |
| `ios_deploy_mode` | `store_only` / `store_prepare` / `store_submit` | Flutter only. iOS deploy mode. |

Boolean options (`semver_auto`, `copilot_ai`, `release_automerge`) are read the same way by the CLI and by the workflows: quotes (`'false'`, `"false"`), upper or lower case (`False`) and a trailing `# comment` are fine, and only `true` and `false` are recognized. Any other value (`no`, `off`, `0`, `maybe`, an empty value) is not guessed: it is read as `false`, the workflows print a warning, and the CLI warns and writes `false` back on the next run. A missing key is different: it uses the default shown above (for `release_automerge` that is on).

The other `metadata` fields (`last_updated`, `integration_date`, `template.version`, …) are bookkeeping written by the wizard and the workflows.

## Version files synced per type

| Type | File |
|---|---|
| `spring` | `build.gradle` / `build.gradle.kts` |
| `flutter` | `pubspec.yaml` |
| `react`, `node` | `package.json` |
| `react-native` | `Info.plist` and `build.gradle` |
| `react-native-expo` | `app.json` |
| `python` | `pyproject.toml` |
| `go` | none — git tags only (`go.mod` has no version field) |
| `basic` | `version.yml` only |

## README version line

`README-VERSION-UPDATE` rewrites the line below the `<!-- AUTO-VERSION-SECTION: DO NOT EDIT MANUALLY -->` marker. Supported formats (case-insensitive, flexible spacing):

```
## Latest Version : v1.0.0 (2025-08-15)
## Current Version : v1.0.0
## Recent Version : v1.0.0
## Version : v1.0.0
## 최신 버전 : v1.0.0
## 버전 : v1.0.0
```

Markdown bold inside the line, a missing colon, or regex special characters (`*`, `[`, `]`, `^`, `$`) are not supported.
