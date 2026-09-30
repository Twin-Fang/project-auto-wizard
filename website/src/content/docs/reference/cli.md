---
title: CLI options
description: Every option of npx project-auto-wizard.
---

```bash
npx project-auto-wizard [options]
```

Without `--mode`, the wizard runs interactively.

## Options

| Option | Values | Default | Description |
|---|---|---|---|
| `-m`, `--mode MODE` | `full` \| `uninstall` \| `status` \| `doctor` | interactive | `full` installs or updates. `uninstall` removes (interactive checklist; with `--force`, opt in with `--purge-*`). `status` shows install state and drift (read-only). `doctor` checks the environment (read-only). |
| `-t`, `--type CSV` | `spring` `flutter` `next` `react` `react-native` `react-native-expo` `node` `python` `basic` `go` | detected | Project types, comma-separated (for example `spring,react,python`) |
| `--project-version V` | `x.y.z` | detected | Initial version (for example `1.0.0`) |
| `--paths "t=p,..."` | `type=path` pairs | repository root | Per-type project folders for monorepos, for example `flutter=app,react=client` |
| `--main-branch B` | branch name | detected default branch | Release branch |
| `--develop-branch B` | branch name | `develop` | Development branch. The same value as the release branch means trunk-based mode. |
| `--deploy-style STYLE` | `simple` \| `nginx` \| `traefik` \| `none` | `simple` | Server deploy style |
| `--flutter-env-mode MODE` | `dart-define` \| `dotenv` | new installs: `dart-define`; existing installs keep the saved value or `dotenv` | Flutter environment variable mode |
| `--flutter-store CSV` | `android,ios` \| `android` \| `ios` \| `none` | both | Flutter store deploy targets |
| `--android-deploy-mode MODE` | `store_only` \| `store_prepare` \| `store_submit` | `store_only` | Play Store deploy mode |
| `--ios-deploy-mode MODE` | `store_only` \| `store_prepare` \| `store_submit` | `store_only` | iOS deploy mode |
| `--semver-auto` / `--no-semver-auto` | — | on | Bump major/minor/patch from commit types |
| `--copilot` / `--no-copilot` | — | off | Generate summaries with Copilot (consumes GitHub Copilot AI Credits) |
| `--lang LANG` | `en` \| `ko` | `PROJECT_AUTO_WIZARD_LANG`, then the saved `language` in `version.yml`, then `en` | Message language. The choice is saved to `version.yml` and kept on update. |
| `--force` | — | — | Required for `full`; makes `uninstall` non-interactive. Skips all confirmations and uses defaults. |
| `--dry-run` | — | — | Show what would change without changing files (`full` and `uninstall`) |
| `--purge-readme` | — | — | With `--mode uninstall --force`, also remove the README version section |
| `--purge-gitignore` | — | — | With `--mode uninstall --force`, also remove entries added to `.gitignore` |
| `--purge-version` | — | — | With `--mode uninstall --force`, also remove `version.yml` |
| `-v`, `--version` | — | — | Print the project-auto-wizard version |
| `-h`, `--help` | — | — | Show help |

Passing both forms of a toggle (`--semver-auto --no-semver-auto`) is an error.

## Examples

```bash
npx project-auto-wizard --mode full --force --type spring,react
npx project-auto-wizard --mode full --force --type flutter --paths "flutter=app"
npx project-auto-wizard --mode status
npx project-auto-wizard --mode doctor
npx project-auto-wizard --mode full --force --type node --dry-run
npx project-auto-wizard --mode uninstall --force --purge-readme --purge-gitignore --purge-version
```

## `--help` output

This is the exact output of `npx project-auto-wizard --help`. The help text is not translated yet and follows the selected language once CLI messages move to the catalog:

```text
project-auto-wizard — One command DevOps: GitHub-native 릴리스 자동화 설치 마법사

사용법:
  npx project-auto-wizard [옵션]

옵션:
  -m, --mode MODE          통합 모드 (full | uninstall | status | doctor)
                           기본: interactive (대화형). full = 설치 및 업데이트
                           uninstall = 완전 삭제(대화형 체크리스트, --force 시 --purge-*로 opt-in)
                           status = 설치 상태·드리프트 확인(읽기 전용). doctor = 환경 진단(읽기 전용)
  -t, --type CSV           프로젝트 타입 csv (예: spring,react,python)
                           지원: spring flutter next react react-native
                                 react-native-expo node python basic go
      --project-version V  통합 대상의 초기 버전 (예: 1.0.0). 미지정 시 자동 감지
      --paths "t=p,..."    타입별 프로젝트 경로 (모노레포). 예: flutter=app,react=client
      --main-branch B      릴리스 브랜치 (기본: 감지된 default branch)
      --develop-branch B   개발 브랜치 (기본: develop). 릴리스 브랜치와 같으면 trunk-based 모드
      --deploy-style STYLE           서버 배포 방식: simple | nginx | traefik | none (기본: simple)
      --flutter-env-mode MODE        Flutter 환경변수 방식: dart-define | dotenv (기본: 신규 설치 dart-define, 기존 설치는 저장값·dotenv 유지)
      --flutter-store CSV            Flutter 스토어 배포 대상: android,ios | android | ios | none (기본: 둘 다 설치)
      --android-deploy-mode MODE     Play Store 배포 모드: store_only | store_prepare | store_submit (기본: store_only)
      --ios-deploy-mode MODE         iOS 배포 모드: store_only | store_prepare | store_submit (기본: store_only)
      --semver-auto / --no-semver-auto  커밋 타입 기반 자동 major/minor/patch 승격 (기본: 사용함)
      --copilot / --no-copilot  Copilot으로 AI 요약 생성 (기본: 사용 안 함, GitHub Copilot AI Credits 소비)
      --lang LANG          메시지 언어: en | ko (기본: en)
      --force              full 실행에 필수, uninstall은 비대화형 삭제 (모든 확인 생략, 기본값 사용)
      --dry-run            실제 파일 변경 없이 무엇이 바뀔지만 미리 보여줌 (full/uninstall 지원)
      --purge-readme        --mode uninstall --force 시 README.md 버전 섹션도 제거
      --purge-gitignore     --mode uninstall --force 시 .gitignore 자동 추가 항목도 제거
      --purge-version       --mode uninstall --force 시 version.yml도 제거
  -v, --version            project-auto-wizard 버전 출력
  -h, --help               이 도움말 표시

예시:
  npx project-auto-wizard --mode full --force --type spring,react
  npx project-auto-wizard --mode full --force --type flutter --paths "flutter=app"
  npx project-auto-wizard --mode status
  npx project-auto-wizard --mode doctor
  npx project-auto-wizard --mode full --force --type node --dry-run
  npx project-auto-wizard --mode uninstall --force --purge-readme --purge-gitignore --purge-version
```
