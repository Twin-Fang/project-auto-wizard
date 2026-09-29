# Adding a project type

This is the checklist for adding a new project type (for example `rust`, detected by `Cargo.toml`).
Read [ARCHITECTURE.md](ARCHITECTURE.md) first for how detection, `@wizard` markers and the
install pipeline fit together.

Most type knowledge on the Node side lives in one table, `src/core/types.js`. The type list used
by `--type` validation, the interactive picker, `--help`, marker detection, monorepo path search
and build-number handling are all derived from it. The remaining steps are the parts the
registry cannot cover: the workflows themselves, the release-time Python script, and docs.

`tests/node/type-registry-consistency.test.js` fails if you miss a place that has to list every
type, so run `npm test` early and let it point at what is left.

## 1. Registry entry — `src/core/types.js`

Add one object to `TYPES`. Array order is the display order in `--help` and the interactive picker.

```js
{
  id: "rust",
  markers: ["Cargo.toml"],          // [0] is the representative file; order = monorepo search priority
  detectBy: "markers", detectOrder: 5,
  versionSources: ["cargo"],        // keys of the version readers in core/detect.js
},
```

| Field | Meaning |
|---|---|
| `id` | Name used by `--type`, `version.yml` `project_types`, and `payload/workflows/<id>/`. |
| `markers` | Files that prove the type. Also written as the path marker in `version.yml`. |
| `detectBy` | `"markers"` (any marker file exists), `"package"` (a `package.json` dependency, set `packageDep`), `"package-fallback"` (only `node`), or omitted (never auto-detected, like `basic`). |
| `detectOrder` | Order within the same `detectBy`; unique integers, earlier wins. |
| `versionSources` | Where to read the initial version at install time, tried first when this is the primary type. |
| `buildNumberSource` | Only for mobile types with a build number (`version_code`). |
| `singleServerCd` | Only when the type has one server CD workflow with no deploy style variants (like react, next). |

If the type reads its version or build number from a file format that is not supported yet, add a
reader:

- version: a `sources` entry in `detectVersionFromFiles` (`src/core/detect.js`), plus a parser
  function next to `versionFromPom` / `versionFromPyproject`, and add the key to the generic
  fallback `order` if other types should also try it.
- build number: a reader in `detectBuildNumberFromFiles` (`readers` map).

Only if the type needs a new `@wizard auto:` token, add a resolver in
`src/core/detect-fs.js#makeResolvers`. Existing tokens (`repo`, `jdk`, `project-path`) usually
cover a new type.

## 2. Workflows — `payload/workflows/<id>/`

A type without a folder gets only the common workflows (like `node` and `basic`), which is fine.
If it needs its own CI/CD:

- Name files `PROJECT-<ID>-<NAME>.yaml`. Filenames must be unique across all types.
- The first line must be `# project-auto-wizard:managed-workflow` (uninstall and stale-file cleanup rely on it).
- Use `{{MAIN_BRANCH}}` / `{{DEVELOP_BRANCH}}` for branches, never literal branch names.
- Put `PROJECT_PATH: "."  # @wizard auto:project-path` in `env:` and run steps with
  `working-directory: ${{ env.PROJECT_PATH }}` so monorepo paths work.
- Server deploy workflows follow the deploy style suffixes (`-SIMPLE-CICD.yaml`,
  `-NONSTOP-NGINX-CICD.yaml`, `-NONSTOP-TRAEFIK-CICD.yaml`). Providing only `-SIMPLE-CICD.yaml` is
  enough; other styles fall back to it. A PR preview ends with `-PR-PREVIEW.yaml`.
- For CI, follow the existing CI files: a `changes` job with a paths filter and a final `ci-gate`
  job that `needs` every other job (checked by `tests/node/ci-gate-payload.test.js`).
- Use the same major versions of shared actions as the other files (`tests/node/workflow-action-versions.test.js`).

Starting from the closest existing type (for example `go/` or `python/`) and renaming is the
usual path.

## 3. Release-time version sync — `payload/scripts/version_manager.py`

At release time Python writes the new version back into the project files. Add the type to both
dispatchers:

- `sync_for_type` — write the version (use `pass` if the type has no version field, like `go`).
- `get_project_file_version` — read it back for the sync check (skip if there is nothing to read;
  it then falls back to `version.yml`).

Then run `npm run sync:dogfood` so `.github/scripts/version_manager.py` matches.

## 4. Question text — `payload/config/wizard-prompts.yml`

Only needed when the type's workflows introduce new `ask` keys, need a type-specific wording
(`<id>.KEY`), or when a new workflow name should get a short display name in `_workflow_names`.

## 5. Docs and templates

These must list every type (checked by the consistency test):

- `payload/version.yml.template` — "Supported project types" and "Synced files per type" comments
- `README.md` — the "지원 프로젝트 타입" list

Also describe the type's workflows in the README "타입별 워크플로우 구성" section if it has any.

Optionally add a type-specific note in `src/ui/summary.js` (install summary) and a
`payload/config/breaking-changes.json` entry if the change affects existing installs.

## 6. Tests

- `tests/fixtures/e2e/<id>/` with a minimal marker file, and a row in `MATRIX` in
  `tests/node/e2e-matrix.test.js` listing the workflows you expect to be installed.
- Detection: cases in `tests/node/detect-accuracy.test.js`, `detect-version.test.js` (if you
  added a version reader) and `paths-resolve.test.js` (monorepo subfolder).
- Workflow contracts that use a fixed type list: add the type to `TYPES` in
  `tests/node/type-workflows-project-path.test.js` and, for a CI workflow, to `CI_TARGETS` in
  `tests/node/ci-gate-payload.test.js`.
- Python: cases in `tests/py/test_version_manager.py` / `test_version_sync.py` for the new sync branch.

Finish with:

```bash
PYTHONDONTWRITEBYTECODE=1 npm test
npm run sync:dogfood:check
node bin/project-auto-wizard.js --mode full --type <id> --dry-run
```
