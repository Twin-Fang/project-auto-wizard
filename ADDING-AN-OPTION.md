# Adding an option

This is the checklist for adding a new on/off release option (for example `release_automerge`, which
lets you keep the release PR from merging itself). Read [ARCHITECTURE.md](ARCHITECTURE.md) first for
how `version.yml` and the workflows relate.

Boolean options live in one table, `src/core/options.js`. CLI flags, value resolution, the
`version.yml` parse and render, the `status` line and the install log line are all derived from it,
so most of the wiring needs no edit. The remaining steps are the places that cannot be derived: the
workflow that reads the option, messages, and docs.

`tests/node/options-registry-consistency.test.js` fails if you miss a place that has to list every
option, so run `npm test` early and let it point at what is left.

## 1. Registry entry — `src/core/options.js`

Add one object to `OPTIONS`.

```js
{
  key: "release_automerge", name: "releaseAutomerge", ctxField: "includeReleaseAutomerge",
  flag: "release-automerge", default: true, legacyDefault: true,
  conflictKey: "cli.args.releaseAutomergeConflict", logLabel: "release-automerge",
},
```

| Field | Meaning |
|---|---|
| `key` | The `snake_case` key under `metadata.template.options` in `version.yml`. |
| `name` / `ctxField` | camelCase name, and `include` + PascalCase context field (`includeReleaseAutomerge`). The registry test checks both. |
| `flag` | Generates `--<flag>` and `--no-<flag>`. Giving both is an error worded by `conflictKey`. |
| `default` | Value on a new install when there is no flag and no saved value. |
| `legacyDefault` | Value on an existing install whose `version.yml` lacks the key. Choose it so an upgrade never changes behavior on its own: an option that keeps today's behavior is `true` (or `false`) for both defaults; a risky new behavior stays off for existing installs. |
| `conflictKey` | i18n key of the "both flags given" error. |
| `logLabel` | Label in the install log line (`option <label> on\|off`). |
| `ask` | Optional. Add it only if the wizard should ask about the option and list it in the edit menu: `{ questionKey, initial, menuLabelKey, summaryKey, cardIcon, cardLabelKey }`. Without `ask` the option is controlled by the flag and `version.yml` only, and a saved value survives a wizard reinstall. |

Value precedence is always: explicit value (flag or wizard answer) → value saved in `version.yml` →
`default` (new install) or `legacyDefault` (existing install).

## 2. Template — `payload/version.yml.template`

Add `<key>: {{OPT_<KEY>}}` to the `options:` block (the variable name is `OPT_` + the key in upper
case) and one comment line in the header describing the option.

## 3. Messages — `src/i18n/catalog/{en,ko}/`

Add the `conflictKey` message in `cli.js`, the `--<flag> / --no-<flag>` line in `cli.help.text`
(both languages), and, with `ask`, the question, menu label, summary and card label keys. Add a
`doctor` note in `src/commands/doctor.js` if users need to see the current value.

## 4. Workflow — only if a workflow reads the option

Workflows read `version.yml` at run time. Copy the reader step of `copilot_ai` or `release_automerge`
in `payload/workflows/common/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml` and change three things: the
key, the output name, and the fallback printed when the key is missing. **The fallback must equal the
registry `legacyDefault`** — the consistency test checks it. Wire the output into the step or job
`if:`, then run `npm run sync:dogfood`.

## 5. Docs

Add the option to the `version.yml` example block and table in `reference/version-yml.md`, and a row
in `reference/cli.md` plus the copy of the `--help` block, in both `website/src/content/docs/` and
`website/src/content/docs/ko/`. `tests/node/docs-site.test.js` compares the `--help` copy with the
real output.

## 6. Verify

```bash
npm test
npm run sync:dogfood:check
```
