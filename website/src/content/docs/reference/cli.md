---
title: CLI options
description: Every option of npx project-auto-wizard.
---

```bash
npx project-auto-wizard [options]
```

Without `--mode`, the wizard runs interactively.

## Options

| Option | Values | Default | Description |
|---|---|---|---|
| `-m`, `--mode MODE` | `full` \| `uninstall` \| `status` \| `doctor` | interactive | `full` installs or updates. `uninstall` removes (interactive checklist; with `--force`, opt in with `--purge-*`). `status` shows install state and drift (read-only). `doctor` checks the environment (read-only). |
| `-t`, `--type CSV` | `spring` `flutter` `react` `react-native` `react-native-expo` `node` `python` `basic` `go` | detected | Project types, comma-separated (for example `spring,react,python`). `next` is accepted as an alias of `react` |
| `--project-version V` | `x.y.z` | detected | Initial version (for example `1.0.0`) |
| `--paths "t=p,..."` | `type=path` pairs | repository root | Per-type project folders for monorepos, for example `flutter=app,react=client` |
| `--main-branch B` | branch name | detected default branch | Release branch |
| `--develop-branch B` | branch name | `develop` | Development branch. The same value as the release branch means trunk-based mode. |
| `--deploy-style STYLE` | `simple` \| `nginx` \| `traefik` \| `none` | `simple` | Server deploy style |
| `--flutter-env-mode MODE` | `dart-define` \| `dotenv` | new installs: `dart-define`; existing installs keep the saved value or `dotenv` | Flutter environment variable mode |
| `--flutter-store CSV` | `android,ios` \| `android` \| `ios` \| `none` | both | Flutter store deploy targets |
| `--android-deploy-mode MODE` | `store_only` \| `store_prepare` \| `store_submit` | `store_only` | Play Store deploy mode |
| `--ios-deploy-mode MODE` | `store_only` \| `store_prepare` \| `store_submit` | `store_only` | iOS deploy mode |
| `--semver-auto` / `--no-semver-auto` | — | on | Bump major/minor/patch from commit types |
| `--copilot` / `--no-copilot` | — | off | Generate summaries with Copilot (consumes GitHub Copilot AI Credits) |
| `--release-automerge` / `--no-release-automerge` | — | on | Merge the release PR automatically; off means you merge it yourself |
| `--lang LANG` | `en` \| `ko` | `PROJECT_AUTO_WIZARD_LANG`, then the saved `language` in `version.yml`, then `en` | Message language. `--lang` is saved to `version.yml` and kept on update; `PROJECT_AUTO_WIZARD_LANG` applies to that run only and never overwrites a valid saved language; it is saved only when there is none (first install, missing key, or unsupported value). |
| `--force` | — | — | Required for `full`; makes `uninstall` non-interactive. Skips all confirmations and uses defaults. |
| `--dry-run` | — | — | Show what would change without changing files (`full` and `uninstall`) |
| `--purge-readme` | — | — | With `--mode uninstall --force`, also remove the README version section |
| `--purge-gitignore` | — | — | With `--mode uninstall --force`, also remove entries added to `.gitignore` |
| `--purge-version` | — | — | With `--mode uninstall --force`, also remove `version.yml` |
| `-v`, `--version` | — | — | Print the project-auto-wizard version |
| `-h`, `--help` | — | — | Show help |

Passing both forms of a toggle (`--semver-auto --no-semver-auto`) is an error.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | The run succeeded. For `--mode doctor`, no problem was found (notes marked `[i]` do not count). |
| `1` | The run failed or was rejected (invalid options, missing `--force`, and so on). For `--mode doctor`, at least one warning (`[!]`) or error (`[✗]`) was found. |
| `130` | Interrupted with Ctrl+C (or end of input) at a prompt. Nothing is written. |
| `143` | Terminated by `SIGTERM` at a prompt. Nothing is written. |

`--mode doctor` does not separate warnings from errors in the exit code. To tolerate warnings in a script, ignore the code (`npx project-auto-wizard --mode doctor || true`).

## Examples

```bash
npx project-auto-wizard --mode full --force --type spring,react
npx project-auto-wizard --mode full --force --type flutter --paths "flutter=app"
npx project-auto-wizard --mode status
npx project-auto-wizard --mode doctor
npx project-auto-wizard --mode full --force --type node --dry-run
npx project-auto-wizard --mode uninstall --force --purge-readme --purge-gitignore --purge-version
```

## `--help` output

This is the exact output of `npx project-auto-wizard --help` (add `--lang ko` for the Korean text):

```text
project-auto-wizard — One command DevOps: GitHub-native release automation setup wizard

Usage:
  npx project-auto-wizard [options]

Options:
  -m, --mode MODE          Unified mode (full | uninstall | status | doctor)
                           Default: interactive. full = install and update
                           uninstall = full removal (interactive checklist; with --force, opt in via --purge-*)
                           status = check install state and drift (read-only). doctor = environment diagnosis (read-only)
  -t, --type CSV           Project types as csv (e.g. spring,react,python)
                           Supported: spring flutter react react-native
                                 react-native-expo node python basic go
      --project-version V  Initial version of the target (e.g. 1.0.0). Auto-detected when omitted
      --paths "t=p,..."    Per-type project paths (monorepo). e.g. flutter=app,react=client
      --main-branch B      Release branch (default: detected default branch)
      --develop-branch B   Development branch (default: develop). Same as the release branch = trunk-based mode
      --deploy-style STYLE           Server deploy style: simple | nginx | traefik | none (default: simple)
      --flutter-env-mode MODE        Flutter env var mode: dart-define | dotenv (default: dart-define for new installs; existing installs keep the saved value / dotenv)
      --flutter-store CSV            Flutter store deploy targets: android,ios | android | ios | none (default: install both)
      --android-deploy-mode MODE     Play Store deploy mode: store_only | store_prepare | store_submit (default: store_only)
      --ios-deploy-mode MODE         iOS deploy mode: store_only | store_prepare | store_submit (default: store_only)
      --semver-auto / --no-semver-auto  Auto major/minor/patch bump from commit types (default: enabled)
      --copilot / --no-copilot  Generate the AI summary with Copilot (default: off; consumes GitHub Copilot AI Credits)
      --release-automerge / --no-release-automerge  Merge the release PR automatically (default: enabled; off = you merge it yourself)
      --lang LANG          Message language: en | ko (default: en)
      --force              Required for full; non-interactive removal for uninstall (skips all confirmations, uses defaults)
      --dry-run            Preview what would change without touching any file (supported by full/uninstall)
      --purge-readme        With --mode uninstall --force, also remove the README.md version section
      --purge-gitignore     With --mode uninstall --force, also remove the auto-added .gitignore entries
      --purge-version       With --mode uninstall --force, also remove version.yml
  -v, --version            Print the project-auto-wizard version
  -h, --help               Show this help

Examples:
  npx project-auto-wizard --mode full --force --type spring,react
  npx project-auto-wizard --mode full --force --type flutter --paths "flutter=app"
  npx project-auto-wizard --mode status
  npx project-auto-wizard --mode doctor
  npx project-auto-wizard --mode full --force --type node --dry-run
  npx project-auto-wizard --mode uninstall --force --purge-readme --purge-gitignore --purge-version
```
