---
title: 완전 삭제
description: 마법사가 설치한 것 제거. README 섹션, .gitignore 항목, version.yml까지 선택 가능.
---

```bash
npx project-auto-wizard --mode uninstall                 # 대화형 체크리스트
npx project-auto-wizard --mode uninstall --force         # 워크플로우·스크립트만 안전 삭제
npx project-auto-wizard --mode uninstall --force --purge-readme --purge-gitignore --purge-version  # 완전 삭제
```

## 제거할 수 있는 것

- 마법사가 설치한 워크플로우와 스크립트
- `README.md`의 `AUTO-VERSION-SECTION` 버전 섹션
- `.gitignore`에 자동 추가된 항목
- `version.yml`
- `.github/.wizard/` (설치 기록과 로그, 워크플로우와 함께 제거)
- 충돌 처리로 생긴 `.bak`, `.template.yaml` 파일
- 삭제 후 비게 된 `.github/workflows`, `.github/scripts` 폴더

제거 대상은 payload가 설치한 파일명과 정확히 일치하는 것, 그리고 마법사 관리 마커가 있으면서 **동시에** 설치 기록(`.github/.wizard/baseline.json`)에 남은 파일뿐입니다. 사용자가 직접 만든 워크플로우는 마법사 워크플로우를 복사해 이름만 바꾼 것이라도 건드리지 않습니다.

Flutter의 `Fastfile`과 `ExportOptions.plist`는 마법사가 새로 만들었고 내용을 바꾸지 않은 경우에만 지웁니다. 값을 채워 넣었거나 원래 있던 파일은 남깁니다.

## 대화형

실제로 설치된 항목만 체크리스트로 보여 줍니다. 워크플로우·스크립트는 기본 체크, README·`.gitignore`·`version.yml`은 opt-in입니다(`--purge-*`를 함께 주면 해당 항목이 미리 체크됩니다). 최종 확인(기본 "아니오")을 거쳐야 실제로 삭제됩니다.

## 비대화형

`--force`는 워크플로우·스크립트만 지웁니다. 나머지까지 지우려면 `--purge-readme`, `--purge-gitignore`, `--purge-version`을 함께 지정하세요.

## 미리보기

```bash
npx project-auto-wizard --mode uninstall --force --dry-run
```

아무것도 지우지 않고 무엇이 지워질지 보여 줍니다.
