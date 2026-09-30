---
title: doctor
description: Check the repository settings and files the installed workflows depend on.
---

```bash
npx project-auto-wizard --mode doctor
```

Read-only and rule-based (no AI). It calls `gh api`, so it needs network access and an authenticated `gh` CLI.

## What it checks

| Check | Why it matters |
|---|---|
| `version.yml` present | Whether the wizard is installed in this folder |
| `gh` CLI installed and logged in | Needed to read the repository settings |
| Workflow permissions | Default permissions for workflows that do not declare their own |
| `WORKFLOW_PAT` secret registered | Optional; faster tag and Release |
| Merge commits allowed | Required for the release PR to automerge |
| Copilot summaries | Whether `copilot_ai` is on, and what that costs |
| Release PR automerge | Whether `release_automerge` is on (shown only when the wizard is installed; a missing key means on; a value that is not `true`/`false` is a warning and reads as off) |
| Flutter store files | For the selected store platforms: `Fastfile`, `ExportOptions.plist` and leftover placeholders in `ExportOptions.plist` (local files only; store secrets are not checked) |

## Reading the output

Each line shows what the setting is for. Only problems are expanded, in the order: what is wrong → what stops working if you leave it → where to click to fix it → documentation link. Healthy items are a single line. Labels that appear in GitHub's settings screens (such as `Read and write permissions`) are printed verbatim so you can search for them.

A typical run in English (abridged):

```
◆  Environment check — project-auto-wizard doctor

  [✓] Install state — is the wizard installed here       version.yml found
  [✓] gh CLI — used to read repo settings               gh version 2.96.0 (2026-09-01)
  [✓] GitHub login — permission to read repo settings   authenticated
  [✓] Merge commits — needed to automerge release PRs   allowed

  [i] Workflow permissions — default for workflows you add yourself
      Currently read — workflows installed by the wizard declare their own permissions, so they work as is.
  [i] WORKFLOW_PAT — automatic tag and Release publishing
      Without the secret, the fallback takes over and still publishes the tag and Release and triggers the main deploy workflow.
  [i] Copilot AI summaries — AI release notes (optional)
      Off (copilot_ai: false in version.yml)

  ✓ No problems found.
```

In this example everything required is fine. The `[i]` lines are informational: workflow permissions can stay at read because installed workflows declare their own, `WORKFLOW_PAT` is optional, and Copilot is off.
