---
title: Updating and re-running
description: How a re-run treats files you changed, deleted or left alone.
---

Run the same command again to update to the latest payload:

```bash
npx project-auto-wizard@latest
npx project-auto-wizard@latest --mode full --force   # non-interactive
```

Saved choices in `version.yml` (types, paths, branches, deploy style, Flutter options, `semver_auto`, `copilot_ai`) are reused and not asked again. Non-interactive flags override them.

## How each workflow file is handled

The wizard compares three things for every workflow: what it installed last time (hash in `.github/.wizard/baseline.json`), what is on disk, and what the new payload renders.

| Situation | Result |
|---|---|
| Identical to the new version | Skipped |
| You did not change it, the payload did | Replaced with the new version |
| You changed it, the payload did not | Your version is kept |
| Both changed | Conflict — you choose (below) |
| Installed before, deleted by you | Not restored unless you choose to restore it |
| New in this payload version | Written |

For a conflict, the interactive wizard offers three choices:

| Choice | Result |
|---|---|
| Keep (default) | Your file stays; the upstream change is not applied |
| Back up and replace | Your file is moved to `<name>.bak`, the new version is written |
| Add alongside | Your file stays; the new version is written as `<name>.template.yaml` for you to compare |

With `--force`, conflicts default to **keep**. The run log records which files were kept, replaced or backed up, and why (see [Logs](../logs/)).

The `.bak` and `.template.yaml` files are added to `.gitignore` automatically.

## Changing the deploy style or Flutter store targets

When a re-run switches to a different deploy style or drops a store target, the workflow that no longer applies is cleaned up: an untouched file is deleted, an edited one is moved to `.bak`. Leaving both in place would deploy twice.

## Previewing an update

```bash
npx project-auto-wizard --mode full --force --dry-run
```

Shows what would be written, replaced or kept, without touching any file.

## Re-running a failed release

- `RELEASE-PUBLISH` checks the tag and the Release separately. Re-running it (or `workflow_dispatch`) finishes a half-published release instead of failing on the existing tag.
- `workflow_dispatch` on `RELEASE-PUBLISH` republishes the current version.
- A release PR run that was queued behind the run that already merged the PR exits early; that is not an error.
