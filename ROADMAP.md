# Roadmap

Where project-auto-wizard is heading next. Priorities may change based on user feedback.

## Done

- npx wizard (10 types including Go, plus multi-type and monorepo auto-detection)
- GitHub-native release automation (three-stage summary engine chain: custom AI → GitHub Copilot CLI → rule-based; AI is optional and off by default)
- `status` — check the install state and drift
- `doctor` — diagnose the install environment
- `--dry-run` — preview without changing anything
- Automatic PR change summaries (no commercial SaaS dependency)
- Automatic semver bumps (major/minor/patch from commit types)
- CLI internationalization: English by default, Korean selectable (`--lang`, `PROJECT_AUTO_WIZARD_LANG`)
- `release_automerge` option — turn release PR auto-merge on or off
- Documentation site (Starlight, published on GitHub Pages)
- `doctor` exits with code 1 when it finds problems

## Under consideration

- Whether to add more project types (Rust, Django, Docker, ...) — on hold while depth comes first

## Contributions welcome

If you want to propose a new project type or workflow, please open an issue first to discuss it.
