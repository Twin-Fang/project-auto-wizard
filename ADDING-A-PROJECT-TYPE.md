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
| `hooks` | Optional type-specific behavior (workflow filter, deselected-workflow cleanup, app files, status labels, doctor checks). Shared code calls them through `hooksFor()`, so a type without hooks needs nothing here. `flutter` is the reference (`src/core/flutter-hooks.js`). |

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

At release time Python reads and writes the version in the project files through the
`TYPE_HANDLERS` table. Add one entry:

```python
"rust": TypeHandler(read=_read_rust, sync=lambda d, v, _code: sync_rust(d, v)),
```

- `read(path_dir)` returns the version found in the project file, or `None` (then the sync check
  falls back to `version.yml`).
- `sync(path_dir, new_version, version_code_getter)` writes the new version. Only types with a
  build number call `version_code_getter()`.
- A type with no version file (like `go` and `basic`) uses `TypeHandler(read=_read_none, sync=_sync_none)`.

Then run `npm run sync:dogfood` so `.github/scripts/version_manager.py` matches.

Install-time (Node, `detect.js`) and release-time (Python) both parse the same files, so they
share fixtures: add a case folder under `tests/fixtures/version-files/<case>/` with the sample
file, and an entry in `tests/fixtures/version-files/expected.json` (`type`, `version`,
`buildNumber`). `tests/node/version-files-shared.test.js` and `tests/py/test_version_files_shared.py`
both run every case, so the two sides must agree: the version in the file is read as its core
`x.y.z` (`1.2.3-rc.1`, `1.2.3+4` and `1.2.0-SNAPSHOT` all read as their core), and a
`-SNAPSHOT` suffix is preserved when the release bumps the file. A `null` version means the file has
no usable version (Node falls back to `0.0.1` with a warning, Python to the `version.yml` value).

## 4. Question text — `payload/config/wizard-prompts.yml`

Only needed when the type's workflows introduce new `ask` keys, need a type-specific wording
(`<id>.KEY`), or when a new workflow name should get a short display name in `_workflow_names`.

## 5. Docs and templates

These must list every type (checked by `tests/node/type-registry-consistency.test.js`):

- `payload/version.yml.template` — "Supported project types" and "Synced files per type" comments
- `README.md` — the "Supported project types" table
- `README.ko.md` — the "지원 프로젝트 타입" list

Also document the type on the docs site: add `website/src/content/docs/project-types/<id>.md`
(model it on `go.md`), register it in the `project-types/...` sidebar list in
`website/astro.config.mjs`, and add the Korean page under `website/src/content/docs/ko/project-types/` if you
can. Types that only get release automation share `release-only.md` — list the type there instead.

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
- Version files: the shared fixture case from step 3, plus cases in `tests/py/test_version_manager.py` / `test_version_sync.py` for the write path.
- Run `tests/node/type-registry-consistency.test.js` first — it lists everything that must mention the new type.

Finish with:

```bash
PYTHONDONTWRITEBYTECODE=1 npm test
npm run sync:dogfood:check
node bin/project-auto-wizard.js --mode full --type <id> --paths "<id>=tests/fixtures/e2e/<id>" --dry-run
```
