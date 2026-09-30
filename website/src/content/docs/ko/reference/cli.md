---
title: CLI 옵션
description: npx project-auto-wizard의 전체 옵션.
---

```bash
npx project-auto-wizard [옵션]
```

`--mode`를 주지 않으면 대화형으로 실행합니다.

## 옵션

| 옵션 | 값 | 기본값 | 설명 |
|---|---|---|---|
| `-m`, `--mode MODE` | `full` \| `uninstall` \| `status` \| `doctor` | 대화형 | `full`은 설치 및 업데이트. `uninstall`은 완전 삭제(대화형 체크리스트, `--force` 시 `--purge-*`로 opt-in). `status`는 설치 상태·드리프트 확인(읽기 전용). `doctor`는 환경 진단(읽기 전용) |
| `-t`, `--type CSV` | `spring` `flutter` `next` `react` `react-native` `react-native-expo` `node` `python` `basic` `go` | 자동 감지 | 프로젝트 타입 csv (예: `spring,react,python`) |
| `--project-version V` | `x.y.z` | 자동 감지 | 통합 대상의 초기 버전 (예: `1.0.0`) |
| `--paths "t=p,..."` | `타입=경로` 쌍 | 레포 루트 | 모노레포 타입별 경로. 예: `flutter=app,react=client` |
| `--main-branch B` | 브랜치 이름 | 감지된 default branch | 릴리스 브랜치 |
| `--develop-branch B` | 브랜치 이름 | `develop` | 개발 브랜치. 릴리스 브랜치와 같으면 trunk-based 모드 |
| `--deploy-style STYLE` | `simple` \| `nginx` \| `traefik` \| `none` | `simple` | 서버 배포 방식 |
| `--flutter-env-mode MODE` | `dart-define` \| `dotenv` | 신규 설치 `dart-define`, 기존 설치는 저장값·`dotenv` 유지 | Flutter 환경변수 방식 |
| `--flutter-store CSV` | `android,ios` \| `android` \| `ios` \| `none` | 둘 다 설치 | Flutter 스토어 배포 대상 |
| `--android-deploy-mode MODE` | `store_only` \| `store_prepare` \| `store_submit` | `store_only` | Play Store 배포 모드 |
| `--ios-deploy-mode MODE` | `store_only` \| `store_prepare` \| `store_submit` | `store_only` | iOS 배포 모드 |
| `--semver-auto` / `--no-semver-auto` | — | 사용함 | 커밋 타입 기반 자동 major/minor/patch 승격 |
| `--copilot` / `--no-copilot` | — | 사용 안 함 | Copilot으로 AI 요약 생성 (GitHub Copilot AI Credits 소비) |
| `--lang LANG` | `en` \| `ko` | `PROJECT_AUTO_WIZARD_LANG` → `version.yml`의 `language` → `en` | 메시지 언어. 고른 값은 `version.yml`에 저장되고 업데이트 때 유지됩니다. |
| `--force` | — | — | full 실행에 필수, uninstall은 비대화형 삭제 (모든 확인 생략, 기본값 사용) |
| `--dry-run` | — | — | 실제 파일 변경 없이 무엇이 바뀔지만 미리 보여 줌 (full/uninstall 지원) |
| `--purge-readme` | — | — | `--mode uninstall --force` 시 README.md 버전 섹션도 제거 |
| `--purge-gitignore` | — | — | `--mode uninstall --force` 시 `.gitignore` 자동 추가 항목도 제거 |
| `--purge-version` | — | — | `--mode uninstall --force` 시 `version.yml`도 제거 |
| `-v`, `--version` | — | — | project-auto-wizard 버전 출력 |
| `-h`, `--help` | — | — | 도움말 표시 |

켜기/끄기 플래그를 동시에 주면(`--semver-auto --no-semver-auto`) 오류입니다.

## 종료 코드

| 코드 | 의미 |
|---|---|
| `0` | 정상 종료입니다. `--mode doctor`에서는 문제가 발견되지 않았다는 뜻입니다(`[i]` 안내는 문제로 세지 않습니다). |
| `1` | 실행이 실패했거나 거부되었습니다(잘못된 옵션, `--force` 누락 등). `--mode doctor`에서는 경고(`[!]`) 또는 오류(`[✗]`)가 하나 이상 발견되었다는 뜻입니다. |
| `130` | 질문 도중 Ctrl+C(또는 입력 종료)로 중단했습니다. 파일은 쓰지 않습니다. |
| `143` | 질문 도중 `SIGTERM`으로 종료되었습니다. 파일은 쓰지 않습니다. |

`--mode doctor`는 종료 코드로 경고와 오류를 구분하지 않습니다. 스크립트에서 경고를 허용하려면 종료 코드를 무시하세요(`npx project-auto-wizard --mode doctor || true`).

## 예시

```bash
npx project-auto-wizard --mode full --force --type spring,react
npx project-auto-wizard --mode full --force --type flutter --paths "flutter=app"
npx project-auto-wizard --mode status
npx project-auto-wizard --mode doctor
npx project-auto-wizard --mode full --force --type node --dry-run
npx project-auto-wizard --mode uninstall --force --purge-readme --purge-gitignore --purge-version
```

## `--help` 출력

`npx project-auto-wizard --lang ko --help`의 출력 그대로입니다 (`--lang`을 생략하면 영어로 출력됩니다):

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
