---
title: Logs
description: The run log written for every install, update and uninstall.
---

Every install, update and uninstall writes a trace to `.github/.wizard/logs/<time>-<action>.log`. It records, in order:

- detection evidence (which file led to which type)
- the decision for each file and the reason
- substituted values and anything left unsubstituted
- the GitHub secrets you need to register

A result summary is appended at the end.

```
=== project-auto-wizard v0.12.2 | install | 2026-09-29 08:01:22 UTC ===
...
08:01:22.919 INFO  detect    type        spring (근거: build.gradle)
08:01:22.921 INFO  copy      write       PROJECT-SPRING-SIMPLE-CICD.yaml (new)
08:01:22.922 INFO  copy      keep-local  PROJECT-COMMON-VERSION-CONTROL.yaml (업스트림 무변경, 사용자 수정본 유지)
08:01:22.948 WARN  verify    unresolved  PROJECT-SPRING-PR-PREVIEW.yaml:43 __APPLICATION_YML_PATH__
```

The messages are in Korean; the action keywords (`write`, `keep-local`, `auto-update`, `backup`, `template`, `skip`, `unresolved`, …) are stable and easy to grep.

## Details

- Times are UTC with milliseconds, including the file name and header.
- Use it after an update to see whether a workflow you edited was kept (`keep-local`) or replaced (`auto-update`, `backup`).
- Lines are written immediately, so an interrupted run still leaves everything up to that point.
- If writing the log fails, the install itself still completes.
- The folder has its own `.gitignore` (`*`, `!.gitignore`), so **logs are never committed**.
- Only the latest 20 logs are kept.
- `--dry-run` writes no files, so it writes no log either.

`.github/.wizard/` also holds `baseline.json`, the install record used for three-way updates. `--mode uninstall` removes it along with the workflows.
