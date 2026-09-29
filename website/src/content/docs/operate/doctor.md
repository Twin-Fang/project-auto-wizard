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
| Flutter store files | For the selected store platforms: `Fastfile`, `ExportOptions.plist` and leftover placeholders in `ExportOptions.plist` (local files only; store secrets are not checked) |

## Reading the output

Each line shows what the setting is for. Only problems are expanded, in the order: what is wrong → what stops working if you leave it → where to click to fix it → documentation link. Healthy items are a single line. Labels that appear in GitHub's settings screens (such as `Read and write permissions`) are printed verbatim so you can search for them.

The CLI prints in Korean. A typical run (abridged):

```
◆  환경 진단 — project-auto-wizard doctor

  [✓] 설치 상태 — 이 폴더의 마법사 설치 여부          version.yml 있음
  [✓] gh CLI — 레포 설정 조회용                       gh version 2.96.0 (2026-09-01)
  [✓] GitHub 로그인 — 레포 설정 조회 권한             인증됨
  [✓] merge commit 허용 — 릴리스 PR 자동 머지 조건    허용됨

  [i] Workflow permissions — 직접 추가한 워크플로우의 기본 권한
      현재 read 입니다 — 마법사가 설치한 워크플로우는 각자 권한을 선언하므로 그대로 동작합니다.
  [i] WORKFLOW_PAT — 자동 태그·Release 발행
      secret이 없어도 폴백이 자동으로 이어받아 태그·Release 발행과 main 배포 워크플로우 실행까지 진행됩니다.
  [i] Copilot AI 요약 — AI 릴리스 노트 생성(선택)
      꺼져 있습니다 (version.yml의 copilot_ai: false)

  ✓ 문제를 찾지 못했습니다.
```

In this example everything required is fine. The `[i]` lines are informational: workflow permissions can stay at read because installed workflows declare their own, `WORKFLOW_PAT` is optional, and Copilot is off.
