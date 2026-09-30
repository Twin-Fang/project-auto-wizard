# Contributing to project-auto-wizard

Thanks for contributing! This document covers local setup and pull request rules.

For the code structure and install flow, see [ARCHITECTURE.md](ARCHITECTURE.md). For the steps to add a new project type, see [ADDING-A-PROJECT-TYPE.md](ADDING-A-PROJECT-TYPE.md).

## Development setup

```bash
git clone https://github.com/Twin-Fang/project-auto-wizard.git
cd project-auto-wizard
npm install --no-save   # zero runtime dependencies; installs devDependencies if there are any
```

You need Node.js 20.12 or later and Python 3 (to run the tests).

## Running the wizard locally

```bash
node bin/project-auto-wizard.js --help
node bin/project-auto-wizard.js --mode full --force --type node --dry-run   # preview only in this repo
```

## Tests

```bash
npm test          # everything: node --test + python unittest
npm run test:node # Node tests only (tests/node/**/*.test.js)
npm run test:py   # Python tests only (tests/py)
```

When you add a feature or fix a bug, add a test that covers the behavior in the same PR.

## Code style

- **Node side (`src/`, `bin/`)**: do not add external dependencies. Use only built-in `node:*` modules.
- **Python side (`payload/scripts/`)**: standard library only (the scripts must run with the python3 that ships on GitHub Actions ubuntu runners).
- When you change workflow YAML or Python scripts, **`payload/` is the single source of truth**. `.github/workflows/PROJECT-COMMON-*.yaml` and `.github/scripts/*.py` are copies installed into this repo itself (dogfooding), so do not edit them by hand. Edit `payload/`, then regenerate them with `npm run sync:dogfood`. The script substitutes the branch placeholders (`{{MAIN_BRANCH}}` → `main`, `{{DEVELOP_BRANCH}}` → `develop`).
  - Differences that only the copies need (the ISSUE-HELPER defaults, the NPM-PUBLISH trigger step in RELEASE-PUBLISH) are declared in `PATCHES` in `scripts/sync-dogfood.mjs`. If you need a new difference, add it to that list instead of editing a copy by hand.
  - `npm run sync:dogfood:check` only compares and writes nothing; it fails when a copy has drifted. `npm test` runs the same check (`tests/node/dogfood-parity.test.js`).
- **Generated payload workflows** (files registered in `templates/workflows/targets.mjs`), such as the Go/Python PR preview, the single-server deploy (SIMPLE-CICD) and the React/Next deploy (CICD), must not be edited directly. Edit the fragments or values under `templates/workflows/`, run `npm run generate:workflows`, and commit the regenerated files together. `npm run generate:workflows:check` only compares and writes nothing; `npm test` runs the same check (`tests/node/workflow-generator.test.js`).
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, ...). English is preferred for the description. Example: `feat: retry login on failure`

## Language policy

English is the default language of this repo: code comments, test names and messages, workflow YAML
comments, scripts and documentation are written in English. Korean is allowed only where it is
product content:

- the `ko` message catalogs (`src/i18n/catalog/ko/`, the `ko` catalog in `payload/scripts/messages.py`)
  and the `_ko` fields in `payload/config/` (`wizard-prompts.yml`, `breaking-changes.json`)
- translated documents (`README.ko.md`, the `ko` locale of the docs site under `website/src/content/docs/ko/`)
- past entries of `CHANGELOG.md` / `CHANGELOG.json` and the historical notes in `.issue/`
- test literals that check `ko` output or Korean input data

`tests/node/no-stray-hangul.test.js` scans every tracked file and fails on Hangul outside this
allow-list. The failure message shows the file and line; translate the text, or, if the Korean is
legitimate product content, add the path (or a line pattern) to the allow-list in that test.

## Pull request rules

1. Branch from `develop`, not `main`.
2. Open pull requests against `develop` (this repo uses the pr-flow branch mode).
3. Make sure `npm test` passes.
4. Describe what changed and why in the PR description.
5. If you change `README.md` (English), update `README.ko.md`, `README.zh-CN.md` and `README.ja.md` in the same PR. If translating is hard, open a follow-up issue with the `type: docs` label. `tests/node/readme-translations.test.js` checks the section count and the language switcher line.
   - The version section that the release workflow updates automatically (`AUTO-VERSION-SECTION`) exists only in `README.md`. The translations link to [CHANGELOG.md](CHANGELOG.md) and do not list version numbers.

## Issues

Please use the issue templates for bug reports and feature requests. Issues labeled `good first issue` are a good place to start.
