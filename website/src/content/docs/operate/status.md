---
title: status
description: Check what is installed and which workflow files drifted from the installed templates.
---

```bash
npx project-auto-wizard --mode status
```

Read-only. It compares local files. Only when an older `version.yml` has no saved branches does it look up the default branch, which may run `git remote show origin`.

It shows:

- installed template version, project types and branch mode
- options: `semver_auto`, `copilot_ai`, `deploy_style` (when a type has server deploys), and for Flutter the environment variable mode, store targets and deploy modes
- workflow files you changed since installation
- workflows left over from an older version that the current payload no longer ships
- when an install record exists, how many files the next update would apply automatically, keep, or report as conflicts

## How drift is decided

`status` checks whether each installed workflow is byte-for-byte equal to the template rendered with the install-time defaults. It does not track whether you edited the file by hand.

If you answered an `@wizard ask` prompt (for example a deploy port) with a non-default value in an interactive install, that file shows up as "changed by user" right after installation, even if you never opened it. This is expected. To tell a real edit from an answered prompt, compare the value with what you entered.
