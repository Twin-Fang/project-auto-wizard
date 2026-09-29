---
title: Flutter
description: Flutter 앱의 CI, Android·iOS 배포, 환경변수 방식, 배포 모드, 필요한 Secret.
---

`pubspec.yaml`로 감지합니다. [릴리스 자동화](../common/) 위에 아래가 추가로 설치됩니다.

## 설치되는 워크플로우

| 워크플로우 | 설치 조건 | 트리거 | 하는 일 |
|---|---|---|---|
| `PROJECT-FLUTTER-CI` | 항상 | 개발 브랜치 PR·push, `workflow_dispatch` | `flutter analyze`와 Android/iOS 빌드 검증, PR에 진행 상황 댓글 |
| `PROJECT-FLUTTER-ANDROID-FIREBASE-CICD` | 항상 | 릴리스 브랜치 push, `workflow_dispatch` | AAB 빌드 후 Firebase App Distribution 업로드 |
| `PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD` | 항상 | 릴리스 브랜치 push, `workflow_dispatch` | APK 빌드 후 자체 서버의 SMB 공유 폴더에 배포 |
| `PROJECT-FLUTTER-ANDROID-TEST-APK` | 항상 | `workflow_dispatch`, `repository_dispatch` | 기능 브랜치의 테스트 APK를 아티팩트로 업로드 (설정 시 Firebase에도) |
| `PROJECT-FLUTTER-APP-BUILD-TRIGGER` | 항상 | 이슈·PR 댓글 | 댓글로 테스트 빌드 실행 (아래 참고) |
| `PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD` | Android 선택 | 릴리스 브랜치 push, `workflow_dispatch` | AAB 빌드 후 Google Play 업로드 |
| `PROJECT-FLUTTER-IOS-TESTFLIGHT` | iOS 선택 | 릴리스 브랜치 push, `workflow_dispatch` | IPA 빌드 후 TestFlight / App Store Connect 업로드 |
| `PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT` | iOS 선택 | `workflow_dispatch`, `repository_dispatch` | 기능 브랜치의 테스트 빌드를 TestFlight로 |

Android를 고르면 `android/fastlane/Fastfile.playstore`, iOS를 고르면 `ios/fastlane/Fastfile`과 `ios/ExportOptions.plist`도 함께 생성됩니다.

- fastlane은 스토어 배포 워크플로우에서만 씁니다. `SELFHOSTED`와 `TEST-APK`는 `flutter build apk --release`를 직접 실행하며 Ruby·fastlane을 설치하지 않습니다.
- `Fastfile`과 `ExportOptions.plist`는 **Flutter 루트 기준**으로(`--paths flutter=app`이면 `app/` 아래) **없을 때만 생성**합니다. 이미 있으면 덮어쓰지 않고 설치 요약과 `--dry-run`에 "기존 파일 유지"로 표시합니다.
- `--mode uninstall`은 마법사가 새로 만들었고 내용을 바꾸지 않은 파일만 지웁니다.
- 스토어 대상을 해제하고 다시 실행하면 배포 방식을 바꿀 때와 같은 규칙으로 정리합니다. 손대지 않은 워크플로우는 삭제하고, 수정한 것은 `.bak`으로 옮겨 보존합니다. `Fastfile`·`ExportOptions.plist`는 삭제하지 않습니다.

### 댓글로 빌드하기

`PROJECT-FLUTTER-APP-BUILD-TRIGGER`는 PR과 이슈의 댓글을 감지합니다:

```
/wizard app build   Android + iOS
/wizard apk build   Android만
/wizard ios build   iOS만
/wizard apk build 20260609_#349_feature   특정 브랜치 빌드
```

어순은 상관없습니다(`build app`도 동작). 브랜치명을 생략하면 PR의 head 브랜치, 이슈라면 Issue Helper 댓글의 브랜치를 씁니다.

## 마법사가 묻는 선택지

프로젝트 타입에 `flutter`가 포함되면 선택지 3개를 더 묻습니다. 고른 값은 `version.yml`의 `metadata.template.options`(`env_mode`, `flutter_store`, `android_deploy_mode`, `ios_deploy_mode`)에 기록되어 다시 실행해도 묻지 않습니다. 나중에 바꾸려면 확인 화면의 **수정하기 > 환경변수 방식 / 스토어 배포 대상 / 배포 모드**나 플래그를 쓰세요.

| 선택지 | 값 | 기본값 | CLI 플래그 |
|---|---|---|---|
| 환경변수 방식 | `dart-define` / `dotenv` | 신규 설치는 `dart-define`. `version.yml`이 이미 있고 저장값이 없는 설치는 기존 동작을 보존하려고 `dotenv` 유지 | `--flutter-env-mode` |
| 스토어 배포 대상 | Android(Play Store) / iOS(TestFlight) 다중 선택 | 대화형 신규 설치는 아무것도 선택하지 않은 상태, 비대화형·플래그 미지정은 둘 다 설치. 저장값이 없는 기존 설치는 이미 설치된 스토어 워크플로우에서 추론 | `--flutter-store android,ios,none` |
| 배포 모드 | 플랫폼별 `store_only` / `store_prepare` / `store_submit` | `store_only` | `--android-deploy-mode`, `--ios-deploy-mode` |

### 환경변수 방식

두 방식 모두 Secret `ENV_FILE`(없으면 `ENV`)에 `.env` 형식으로 값을 넣어 두면 됩니다. 두 방식을 동시에 쓰는 모드는 없습니다.

- **`dart-define`**: `ENV_FILE`을 프로젝트 밖 임시 경로에 쓰고 모든 `flutter build`에 `--dart-define-from-file`로 넘깁니다. 프로젝트 루트에 `.env`를 만들지 않으며, 코드에서는 `String.fromEnvironment('KEY')`로 읽습니다. 값이 아닌 파일 경로를 넘기므로 `--verbose` 로그에도 값이 노출되지 않습니다.
- **`dotenv`**: Flutter 루트에 `.env`를 만든 뒤 빌드합니다(`build_runner`보다 먼저). `flutter_dotenv`·`envied`를 쓰는 프로젝트가 여기에 해당합니다. 아래 파서 제약은 적용되지 않습니다.

`dart-define` 방식에서 `ENV_FILE`은 Flutter의 `--dart-define-from-file` 파서가 읽으므로 다음 범위만 지원됩니다(근거: Flutter 3.47.5 `flutter_tools/lib/src/runner/flutter_command.dart`의 `DotEnvRegex`).

- 내용이 `{`로 시작하면 JSON으로, 아니면 `KEY=값` 줄로 해석합니다. 키는 `[a-zA-Z_][a-zA-Z0-9_]*` 형태여야 합니다.
- `#`로 시작하는 주석 줄과 빈 줄은 무시합니다.
- `"…"`, `'…'`, `` `…` `` 따옴표는 벗겨지고 뒤의 `# 주석`은 제거됩니다. 따옴표 없는 값은 공백 또는 `#` 앞까지 읽으며, 값 안의 `=`는 허용됩니다.
- `export KEY=값` 형태와 멀티라인(`"""`) 값은 지원하지 않아 빌드가 오류로 종료됩니다.

### 배포 모드

모르는 값은 `store_only`로 취급합니다. 저장소 변수 `ANDROID_DEPLOY_MODE`·`IOS_DEPLOY_MODE`와 `workflow_dispatch` 입력이 설치 기본값보다 항상 우선합니다.

| 모드 | Play Store (Android) | TestFlight / App Store (iOS) |
|---|---|---|
| `store_only` | internal 트랙에 업로드 | TestFlight 업로드 |
| `store_prepare` | production 트랙에 draft로 업로드 (Play Console에서 직접 출시) | 앱 버전·메타데이터 준비까지 (심사 제출 안 함) |
| `store_submit` | production 트랙에 심사 제출 | 심사 제출까지 |

`store_submit`을 고르면 **릴리스 브랜치 push마다 심사가 자동 제출**됩니다.

## Secret과 Variable

설치 완료 화면과 실행 로그에도 설치된 워크플로우가 실제로 요구하는 Secret 목록이 출력됩니다.

| 대상 | Secrets | Variables |
|---|---|---|
| Flutter 빌드 공통 | `ENV_FILE` (없으면 `ENV`) — `PLAYSTORE`·`FIREBASE`·`SELFHOSTED`는 필수, CI·`TEST-APK`·iOS는 선택 | — |
| Android 서명 (`PLAYSTORE`·`FIREBASE`·`TEST-APK`) | `RELEASE_KEYSTORE_BASE64`, `RELEASE_KEYSTORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD` (`TEST-APK`는 없으면 경고 후 debug 키로 서명) | — |
| Firebase 설정 파일 (`PLAYSTORE`·`FIREBASE`·`TEST-APK`·`SELFHOSTED`) | `GOOGLE_SERVICES_JSON` (선택) | — |
| Play Store (`PLAYSTORE`) | `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64`, `ANDROID_PACKAGE_NAME` (Secret 또는 Variable) | `ANDROID_PACKAGE_NAME` (Secret이 없을 때 대신 사용), `ANDROID_DEPLOY_MODE` (선택) |
| iOS (`IOS-TESTFLIGHT`·`IOS-TEST-TESTFLIGHT`) | `APP_STORE_CONNECT_API_KEY_BASE64`, `APP_STORE_CONNECT_API_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `APPLE_CERTIFICATE_BASE64`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_PROVISIONING_PROFILE_BASE64`, `IOS_PROVISIONING_PROFILE_NAME`, `IOS_BUNDLE_ID` (`IOS-TESTFLIGHT`만, Secret 또는 Variable), `SECRETS_XCCONFIG` (선택) | `IOS_BUNDLE_ID` (Secret이 없을 때 대신 사용), `IOS_DEPLOY_MODE` (선택) |
| Firebase App Distribution (`FIREBASE`·`TEST-APK`) | `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` (`TEST-APK`는 선택 — 있을 때만 업로드) | — |
| Selfhosted 배포 (`SELFHOSTED`) | `SERVER_HOST`, `SERVER_USER`, `SERVER_PASSWORD`, `DEBUG_KEYSTORE` (선택 — 없으면 빌드마다 새 debug 키로 서명) | — |

`ANDROID_PACKAGE_NAME`은 `PLAYSTORE` 워크플로우가 fastlane에 패키지명으로 넘깁니다(`secrets` 우선, 없으면 `vars`). iOS의 `IOS_BUNDLE_ID`와 같은 규칙입니다.

`FIREBASE_APP_ID`와 `FIREBASE_TESTER_GROUP`은 Secret이 아니라 Firebase 워크플로우의 `env` 섹션 값을 직접 수정합니다.

### ExportOptions.plist에 채워야 할 값

마법사가 만든 `ios/ExportOptions.plist`에는 아래 플레이스홀더가 들어 있어 실제 값으로 바꿔야 합니다. 채우지 않고 `IOS-TESTFLIGHT`를 실행하면 `xcodebuild`의 알기 어려운 오류 대신 플레이스홀더가 남았다는 메시지로 검증 단계에서 중단되며, `--mode doctor`도 같은 항목을 WARN으로 알려 줍니다.

| 플레이스홀더 | 채울 값 |
|---|---|
| `__TEAM_ID__` | Apple Developer Team ID |
| `__BUNDLE_ID__` | 앱 번들 ID (`IOS_BUNDLE_ID`와 같은 값) |
| `__PROVISIONING_PROFILE_NAME__` | 프로비저닝 프로파일 이름 (`IOS_PROVISIONING_PROFILE_NAME`과 같은 값) |

## 모노레포와 ci-gate

- `--paths flutter=app`처럼 하위 폴더를 지정하면 모든 Flutter 워크플로우가 그 폴더(`FLUTTER_PROJECT_DIR`)를 기준으로 동작하고, 릴리스 브랜치 배포 워크플로우(`PLAYSTORE`·`IOS-TESTFLIGHT`·`SELFHOSTED`·`FIREBASE`)는 `app/**`가 바뀔 때만 실행됩니다.
- CI는 트리거마다 항상 실행되고, 첫 job `changes`가 나머지 job을 건너뛸지 판별합니다(건너뛴 job은 Success). 마지막 job `ci-gate`는 항상 실행되어 실패하거나 취소된 job이 있을 때만 실패합니다.
- 브랜치 보호 규칙의 required status check에는 **`CI Gate`**(`ci-gate`) 하나만 등록하세요.
- 워크플로우 `paths` 필터는 태그 push에 적용되지 않습니다(GitHub 동작).

## Gemfile

스토어 배포 워크플로우(`PLAYSTORE`·`IOS-TESTFLIGHT`·`IOS-TEST-TESTFLIGHT`)는 `Gemfile`에 `fastlane`이 있으면 그것을 쓰고, 없으면 실행할 때 생성합니다. 마법사는 Gemfile 템플릿을 배포하지 않습니다. fastlane 공식 문서가 권장하는 대로 `Gemfile`(`gem "fastlane"`)과 `Gemfile.lock`을 커밋해 두면 버전이 고정되어 재현성이 좋아집니다.
