---
title: 로그
description: 설치·업데이트·삭제마다 남는 실행 로그.
---

설치·업데이트·삭제를 실행할 때마다 `.github/.wizard/logs/<시각>-<동작>.log`에 실행 추적이 남습니다. 시간순으로 기록되는 내용:

- 감지 근거 (어떤 파일로 어떤 타입을 감지했는지)
- 파일별 처리 결정과 그 사유
- 치환된 값과 치환되지 않은 항목
- 등록해야 하는 GitHub Secret

파일 끝에 결과 요약이 붙습니다.

```
=== project-auto-wizard v0.12.2 | install | 2026-09-29 08:01:22 UTC ===
...
08:01:22.919 INFO  detect    type        spring (근거: build.gradle)
08:01:22.921 INFO  copy      write       PROJECT-SPRING-SIMPLE-CICD.yaml (new)
08:01:22.922 INFO  copy      keep-local  PROJECT-COMMON-VERSION-CONTROL.yaml (업스트림 무변경, 사용자 수정본 유지)
08:01:22.948 WARN  verify    unresolved  PROJECT-SPRING-PR-PREVIEW.yaml:43 __APPLICATION_YML_PATH__
```

## 세부 사항

- 시각은 UTC 기준이며 밀리초까지 기록합니다(파일명과 헤더도 UTC). 한국 시간과는 9시간 차이가 납니다.
- 업데이트 후 "내가 고친 워크플로우가 유지됐는지(`keep-local`) 덮였는지(`auto-update`, `backup`)"를 이 로그로 확인할 수 있습니다.
- 한 줄씩 즉시 기록하므로 도중에 중단되어도 직전까지의 흐름이 남습니다.
- 로그 기록에 실패해도 설치 자체는 정상 완료됩니다.
- 이 폴더에는 자체 `.gitignore`(`*`, `!.gitignore`)가 함께 생성되어 **로그가 git에 올라가지 않습니다**.
- 최근 20개만 보관하고 오래된 것부터 정리합니다.
- `--dry-run`은 파일을 만들지 않는 것이 계약이므로 로그도 남기지 않습니다.

`.github/.wizard/`에는 업데이트 3-way 판정에 쓰는 `baseline.json`도 함께 들어 있어, `--mode uninstall` 시 워크플로우와 함께 제거됩니다.
