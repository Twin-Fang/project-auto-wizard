---
title: version.yml
description: 버전과 마법사 선택값의 단일 기록인 version.yml의 필드.
---

`version.yml`은 레포 루트에 있습니다. 릴리스 워크플로우가 읽고 갱신하며, 마법사는 선택값을 여기에 저장해 다시 실행할 때 묻지 않습니다. 직접 수정해도 됩니다.

```yaml
version: "1.4.2"
version_code: 57 # app build number
project_types: ["spring", "react"] # first entry is primary
language: "en" # message language: en | ko
project_paths: # 타입별 프로젝트 폴더 (레포 루트 기준 상대경로)
  spring: "server" # server/build.gradle
  react: "client" # client/package.json
metadata:
  last_updated: "2026-09-26"
  last_updated_by: "project-auto-wizard"
  default_branch: "main"
  integration_date: "2026-07-09"
  template:
    source: "project-auto-wizard"
    version: "0.12.2"
    integrated_date: "2026-07-09"
    last_update_date: "2026-09-26"
    branches:
      main: "main"
      develop: "develop"
      mode: "pr-flow" # pr-flow | trunk-based
    options:
      semver_auto: true
      copilot_ai: false
      release_automerge: true
      deploy_style: "simple" # simple | nginx | traefik | none

deploy: # 마법사가 기억하는 배포 설정 (비민감 / 직접 수정 가능)
  spring:
    DEPLOY_PORT: "8080"
```

## 최상위 필드

| 필드 | 설명 |
|---|---|
| `version` | 현재 버전 `x.y.z`. 릴리스 워크플로우가 갱신 |
| `version_code` | 버전과 함께 올라가는 단조 증가 빌드 번호 (앱 빌드에서 사용) |
| `project_types` | 모든 프로젝트 타입. 첫 항목이 주 타입이며, 릴리스 때 이 타입의 버전 파일을 `version.yml`과 비교 |
| `language` | 메시지 언어. 설치기와 설치되는 워크플로우·스크립트가 출력하는 문구 모두에 적용되며 `en`(기본) 또는 `ko`. `--lang`으로 지정하면 저장되어 업데이트 때 유지되고, `PROJECT_AUTO_WIZARD_LANG`는 설정한 실행에만 적용되며, 저장된 유효한 `language`가 없을 때(첫 설치, 키 없음, 잘못된 값)만 저장됩니다. 이 키가 없는 기존 파일은 비대화형 실행에서 `en`으로 처리하고, 대화형 마법사는 `--lang`, 환경변수, 유효한 저장값이 모두 없으면 가장 먼저 언어를 묻고 설치 때 답을 저장합니다(메뉴에서 status, doctor, uninstall을 고르면 저장하지 않습니다) |
| `project_paths` | 레포 루트 기준 타입별 폴더. 없는 타입은 루트 |
| `deploy` | 마법사가 물은 타입별 비민감 값(예: 배포 포트). 다음 실행에서 재사용. 그런 값이 있는 타입만 기록 |

직접 추가한 알 수 없는 최상위 필드는 마법사가 파일을 다시 쓸 때 보존됩니다.

## `metadata.template.branches`

| 필드 | 설명 |
|---|---|
| `main` | 릴리스 브랜치 |
| `develop` | 개발 브랜치 |
| `mode` | `pr-flow` 또는 `trunk-based`(릴리스 브랜치 = 개발 브랜치) |

## `metadata.template.options`

| 필드 | 값 | 설명 |
|---|---|---|
| `semver_auto` | `true`(기본) / `false` | 커밋 타입 기반 승격. `false`면 매 릴리스 patch+1, major/minor는 직접 수정 |
| `copilot_ai` | `false`(기본) / `true` | 요약 워크플로우가 Copilot CLI를 호출 (AI Credits 소비) |
| `release_automerge` | `true`(기본, 키가 없어도 켜짐) / `false` | 릴리스 PR 자동 머지. `false`면 직접 머지하며 머지 커밋을 권장합니다(squash·rebase는 릴리스 워크플로우가 건너뛰어짐, [릴리스 흐름](../../understand/release-flow/) 참고) |
| `deploy_style` | `simple` / `nginx` / `traefik` / `none` | 서버 배포 방식. 서버 배포 워크플로우가 있는 타입일 때 기록 |
| `env_mode` | `dart-define` / `dotenv` | Flutter 전용. 환경변수 방식 |
| `flutter_store` | `android` / `ios` / `android,ios` / `none` | Flutter 전용. 스토어 배포 대상 |
| `android_deploy_mode` | `store_only` / `store_prepare` / `store_submit` | Flutter 전용. Play Store 배포 모드 |
| `ios_deploy_mode` | `store_only` / `store_prepare` / `store_submit` | Flutter 전용. iOS 배포 모드 |

불리언 옵션(`semver_auto`, `copilot_ai`, `release_automerge`)은 CLI와 워크플로우가 같은 규칙으로 읽습니다. 따옴표(`'false'`, `"false"`), 대소문자(`False`), 뒤의 `# 주석`은 허용하고, `true`와 `false`만 인식합니다. 그 밖의 값(`no`, `off`, `0`, `maybe`, 빈 값)은 추측하지 않고 `false`로 읽으며, 워크플로우는 경고를 출력하고 CLI는 경고한 뒤 다음 실행에서 `false`로 다시 씁니다. 키가 없는 것은 다르게 처리되어 위 표의 기본값을 씁니다(`release_automerge`는 켜짐).

나머지 `metadata` 필드(`last_updated`, `integration_date`, `template.version` 등)는 마법사와 워크플로우가 기록하는 관리용 값입니다.

## 타입별 버전 동기화 파일

| 타입 | 파일 |
|---|---|
| `spring` | `build.gradle` / `build.gradle.kts` |
| `flutter` | `pubspec.yaml` |
| `react`, `node` | `package.json` |
| `react-native` | `Info.plist`, `build.gradle` |
| `react-native-expo` | `app.json` |
| `python` | `pyproject.toml` |
| `go` | 없음 — git 태그 기반 (`go.mod`에 버전 필드가 없음) |
| `basic` | `version.yml`만 |

## README 버전 줄

`README-VERSION-UPDATE`는 `<!-- AUTO-VERSION-SECTION: DO NOT EDIT MANUALLY -->` 마커 아래 줄을 갱신합니다. 지원 형식(대소문자 무시, 공백 유연):

```
## Latest Version : v1.0.0 (2025-08-15)
## Current Version : v1.0.0
## Recent Version : v1.0.0
## Version : v1.0.0
## 최신 버전 : v1.0.0
## 버전 : v1.0.0
```

줄 안의 마크다운 굵게(`**`), 콜론 누락, 정규식 특수문자(`*`, `[`, `]`, `^`, `$`)는 지원하지 않습니다.
