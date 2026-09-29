---
title: Uninstall
description: Remove what the wizard installed, optionally including the README section, .gitignore entries and version.yml.
---

```bash
npx project-auto-wizard --mode uninstall                 # interactive checklist
npx project-auto-wizard --mode uninstall --force         # workflows and scripts only
npx project-auto-wizard --mode uninstall --force --purge-readme --purge-gitignore --purge-version  # everything
```

## What can be removed

- workflows and scripts installed by the wizard
- the `AUTO-VERSION-SECTION` version section in `README.md`
- entries the wizard added to `.gitignore`
- `version.yml`
- `.github/.wizard/` (install record and logs) together with the workflows
- `.bak` and `.template.yaml` files created while resolving conflicts
- `.github/workflows` and `.github/scripts` folders left empty

A file is removed only if its name exactly matches a file the payload installs, or it carries the wizard's managed marker **and** is listed in the install record (`.github/.wizard/baseline.json`). Workflows you wrote yourself are never touched, even if you copied a wizard workflow and renamed it.

For Flutter, `Fastfile` and `ExportOptions.plist` are removed only if the wizard created them and you did not change them. Files you filled in or that existed before are kept.

## Interactive

Shows a checklist of what is actually installed. Workflows and scripts are checked by default; README, `.gitignore` and `version.yml` are opt-in (passing a `--purge-*` flag pre-checks the matching item). Nothing is deleted until you confirm the final prompt, which defaults to "No".

## Non-interactive

`--force` removes workflows and scripts only. Add `--purge-readme`, `--purge-gitignore` and `--purge-version` to remove the rest.

## Preview

```bash
npx project-auto-wizard --mode uninstall --force --dry-run
```

Lists what would be removed without deleting anything.
