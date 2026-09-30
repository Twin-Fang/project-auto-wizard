---
title: doctor
description: 설치된 워크플로우가 의존하는 레포 설정과 파일 점검.
---

```bash
npx project-auto-wizard --mode doctor
```

읽기 전용, 규칙 기반 점검입니다(AI 진단 아님). `gh api`를 호출하므로 네트워크 접근과 로그인된 `gh` CLI가 필요합니다.

## 점검 항목

| 항목 | 의미 |
|---|---|
| `version.yml` 존재 | 이 폴더에 마법사가 설치되어 있는지 |
| `gh` CLI 설치·로그인 | 레포 설정 조회에 필요 |
| Workflow permissions | `permissions`를 선언하지 않은 워크플로우의 기본 권한 |
| `WORKFLOW_PAT` secret 등록 | 선택. 태그·Release 발행을 더 빠르게 |
| merge commit 허용 | 릴리스 PR automerge 조건 |
| Copilot 요약 | `copilot_ai`가 켜져 있는지, 켜면 무엇이 소비되는지 |
| 릴리스 PR 자동 머지 | `release_automerge`가 켜져 있는지 (설치된 경우에만 표시, 키가 없으면 켜짐) |
| Flutter 스토어 파일 | 고른 스토어 플랫폼의 `Fastfile`, `ExportOptions.plist`와 `ExportOptions.plist`의 플레이스홀더 잔존 여부 (로컬 파일만 확인, 스토어 Secret 등록 여부는 점검하지 않음) |

## 출력 읽는 법

항목마다 **그 설정이 무엇을 담당하는지**를 라벨에 함께 표시하고, 문제가 있는 항목만 `현상 → 그대로 두면 무엇이 안 되는지 → 어디를 눌러 고치는지 → 문서 링크` 순으로 펼쳐 보여 줍니다. 정상 항목은 한 줄로 압축됩니다. GitHub 설정 화면에 실제로 표시되는 문자열(`Read and write permissions` 등)은 화면에서 찾을 수 있도록 원문 그대로 출력합니다.

```
◆  환경 진단 — project-auto-wizard doctor

  [✓] 설치 상태 — 이 폴더의 마법사 설치 여부          version.yml 있음
  [✓] gh CLI — 레포 설정 조회용                       gh version 2.96.0 (2026-09-01)
  [✓] GitHub 로그인 — 레포 설정 조회 권한             인증됨
  [✓] merge commit 허용 — 릴리스 PR 자동 머지 조건    허용됨

  [i] Workflow permissions — 직접 추가한 워크플로우의 기본 권한
      현재 read 입니다 — 마법사가 설치한 워크플로우는 각자 권한을 선언하므로 그대로 동작합니다.
      직접 추가한 워크플로우에서 permissions를 생략했다면 이 기본값을 따르므로, 그때만 Read and write로 올리세요.
  [i] WORKFLOW_PAT — 자동 태그·Release 발행
      secret이 없어도 폴백이 자동으로 이어받아 태그·Release 발행과 main 배포 워크플로우 실행까지 진행됩니다 — 실제 병합 후 최대 ~20초 정도 더 걸릴 뿐입니다.
      속도를 더 원한다면 PAT을 등록할 수 있습니다 — 반드시 개인 계정이 아닌 조직 bot/machine 계정으로 발급하세요 (scopes: repo, workflow).
      등록: 레포 Settings → Secrets and variables → Actions → New repository secret · 이름은 WORKFLOW_PAT
  [i] Copilot AI 요약 — AI 릴리스 노트 생성(선택)
      꺼져 있습니다 (version.yml의 copilot_ai: false) — 켜려면 --copilot으로 다시 설치하거나 대화형 '수정하기 > Copilot AI 요약'을 쓰세요.
      켜면 GitHub Copilot AI Credits가 소비됩니다 — 조직은 'Allow use of Copilot CLI billed to the organization' 정책이 필요합니다.
      꺼져 있거나 사용할 수 없으면 규칙 기반 요약으로 자동 전환되므로 그대로 두셔도 됩니다.

  ✓ 문제를 찾지 못했습니다.
```

`[i]` 줄은 안내입니다. 문제가 아니므로 그대로 둬도 됩니다.
