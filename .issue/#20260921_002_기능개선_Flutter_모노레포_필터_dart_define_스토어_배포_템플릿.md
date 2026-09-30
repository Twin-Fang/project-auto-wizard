<!-- GitHub Issue: #131 | https://github.com/Twin-Fang/project-auto-wizard/issues/131 -->
🚀[기능개선][Flutter/CICD] 모노레포 경로 필터·CI gate, dart-define 환경변수, 스토어 배포(fastlane) 템플릿과 선택지 추가

### 어떤 문제를 해결하고 싶으신가요?

모노레포에서 Spring 등은 해당 폴더가 바뀔 때만 재배포되는데 Flutter는 그렇지 않다는 제보로 시작했고, 조사하면서 같은 영역의 문제 5가지가 함께 확인되어 하나의 이슈로 묶습니다.

1. **Flutter에는 모노레포 경로 필터가 없습니다.** `# @wizard paths-anchor` 주석이 `PROJECT-SPRING-SIMPLE-CICD.yaml`, `PROJECT-NEXT-CICD.yaml`, `PROJECT-REACT-CICD.yaml`, `PROJECT-GO-SIMPLE-CICD.yaml`, `PROJECT-PYTHON-SIMPLE-CICD.yaml`의 `push` 아래에 있고, `src/core/wizard-env.js`의 `substituteEnv`가 `project_paths`가 `.`이 아닐 때 이 주석을 `paths` 필터 한 줄로 치환합니다. 그런데 main push로 도는 Flutter 배포 워크플로우 4종(`ANDROID-PLAYSTORE-CICD`, `IOS-TESTFLIGHT`, `ANDROID-SELFHOSTED-CICD`, `ANDROID-FIREBASE-CICD`)에는 이 앵커가 없어서, 백엔드만 수정해도 앱 빌드와 스토어 배포가 실행됩니다. 이 밖에도 CI(develop push·PR)는 어느 타입에도 필터가 없고, `spring/nexus`의 publish 워크플로우 2종(main push + `v*.*.*` 태그)에도 없습니다.
2. **필터를 붙일 때 required check 문제가 생깁니다.** GitHub 공식 문서(Troubleshooting required status checks)에 따르면 경로·브랜치 필터로 워크플로우 자체가 건너뛰어지면 연관 체크가 Pending에 머물러 머지가 막히고, `if` 조건으로 건너뛴 job은 Success로 보고됩니다. 또 workflow syntax 문서는 "Path filters are not evaluated for pushes of tags"라고 밝혀, 태그 push는 경로 필터의 영향을 받지 않습니다.
3. **Flutter 루트 경로 처리가 워크플로우마다 다릅니다.** `FLUTTER_PROJECT_DIR`을 쓰는 것은 `ANDROID-PLAYSTORE-CICD`와 `IOS-TESTFLIGHT`뿐이고, `ANDROID-FIREBASE-CICD`, `ANDROID-SELFHOSTED-CICD`, `PROJECT-FLUTTER-CI`, `ANDROID-TEST-APK`, `IOS-TEST-TESTFLIGHT` 5개는 `pubspec.yaml` 읽기, `flutter pub get`, keystore·`google-services.json` 생성, 빌드 산출물 경로가 모두 레포 루트 기준입니다. Flutter가 `app/` 같은 하위 폴더에 있으면 이 5개는 경로 필터와 무관하게 빌드부터 어긋납니다.
4. **환경변수는 `.env` 파일 방식만 지원합니다.** 모든 Flutter 워크플로우가 시크릿 `ENV_FILE`(없으면 `ENV`)을 `.env`로 써서 빌드에 포함시키고, `--dart-define`은 한 곳도 쓰지 않습니다. Flutter 공식 CD 문서는 CI 시크릿을 `--dart-define`으로 넘기라고 안내하고, 설치된 Flutter(3.47.5)의 `flutter build --help`에는 `.json` 또는 `.env` 파일을 받는 `--dart-define-from-file`이 있습니다. `flutter_dotenv`는 `.env`를 assets로 번들해 APK에서 값을 꺼낼 수 있다는 점이 널리 지적됩니다(공식 문서가 아닌 아티클 기준).
5. **fastlane 관련 파일이 레포에 없고, 사용 범위도 어긋나 있습니다.**
   - fastlane을 호출하는 워크플로우가 5종(`ANDROID-PLAYSTORE-CICD`, `IOS-TESTFLIGHT`, `IOS-TEST-TESTFLIGHT`, `ANDROID-SELFHOSTED-CICD`, `ANDROID-TEST-APK`)인데, 이 레포는 그 워크플로우가 필요로 하는 `Fastfile`, `ExportOptions.plist`를 만들거나 배포하지 않습니다. `git ls-files` 기준으로 Fastfile류 파일은 0개입니다.
   - 워크플로우 주석이 안내하는 웹 마법사(`.github/util/flutter/ios-testflight-setup-wizard/index.html`, `firebase-wizard/firebase-wizard.html`)도 레포에 없고 복사하는 코드도 없습니다.
   - `SELFHOSTED`와 `TEST-APK`는 스토어와 무관한데 fastlane으로 빌드합니다. `PLAYSTORE` 워크플로우는 fastlane에 패키지명을 넘기지 않습니다.
   - Flutter 워크플로우 8종이 통째로 설치되어(개별 선택 로직 없음), 스토어 시크릿이 없는 사용자도 main push마다 PLAYSTORE·TestFlight 워크플로우가 트리거됩니다. 실제 실행으로 확인한 것은 아니고 코드 구조 기반 추정입니다.

### 제안하는 해결 방법

논의를 거쳐 아래와 같이 확정했습니다. 하나의 이슈, 하나의 브랜치, 하나의 PR로 진행하고 커밋은 세 단계로 나눕니다: (A) 경로 필터·CI gate → (B) Flutter 루트 정비·환경변수·fastlane 빌드 제거 → (C) 스토어 배포(선택지·템플릿·status/doctor·문서).

**결정 사항 — 경로 필터와 CI gate**

- main push 배포 워크플로우에 `paths` 앵커를 추가합니다. 대상은 Flutter 4종과 Spring publish 2종(`PROJECT-SPRING-NEXUS-PUBLISH.yml`, `PROJECT-SPRING-GITHUB-PACKAGES-PUBLISH.yml`)이며, Spring과 동일하게 `<경로>/**` 하나만 넣습니다. publish의 태그 push가 필터에 막히지 않는지는 구현 전에 실제로 한 번 검증합니다.
- CI 6종(Flutter, Go, Next, Python, React, Spring NEXUS-CI)은 `push`와 `pull_request` 모두 워크플로우를 항상 실행하고, 첫 job `changes`가 변경 파일을 판별하며 나머지 job은 그 결과로 건너뜁니다(건너뛴 job은 Success). 판별에는 `dorny/paths-filter@v4`를 씁니다. 이 레포는 외부 액션을 커밋 SHA가 아닌 버전 태그로 쓰므로 같은 관례를 따르고, PR 이벤트에는 `pull-requests: read` 권한이 필요합니다.
- 집계 job `ci-gate`를 함께 넣습니다. 항상 실행되고, 필수 job이 모두 success 또는 skipped이면 통과, failure 또는 cancelled가 하나라도 있으면 실패입니다. 사용자는 `ci-gate` 하나만 required check로 등록하면 됩니다.
- 단일 레포(경로 `.`)도 같은 템플릿을 씁니다. 경로가 `.`이면 항상 변경된 것으로 판정합니다. 경로 값은 `flutter-root`와 같은 방식의 `@wizard auto:` 토큰으로 주입합니다.
- CICD(main push)에는 job 단위 필터를 쓰지 않고 기존 `paths` 앵커 방식을 유지합니다.

**결정 사항 — Flutter 루트 정비와 환경변수**

- `FIREBASE`, `SELFHOSTED`, `CI`, `TEST-APK`, `IOS-TEST-TESTFLIGHT` 5개를 `PLAYSTORE`와 같은 방식(`env.FLUTTER_PROJECT_DIR` + `defaults.run.working-directory`)으로 정비합니다. `run:`이 아닌 스텝의 `path:` 같은 경로에는 `FLUTTER_PROJECT_DIR`을 직접 붙이고, `.env`, keystore, `google-services.json`, 산출물 경로를 Flutter 루트 기준으로 맞춥니다.
- 환경변수 방식은 목록에서 고르는 선택지 두 개입니다. `dart-define`(신규 설치 기본)과 `dotenv`(`flutter_dotenv`와 `envied` 모두 해당)이며, 두 방식을 동시에 쓰는 `both`는 만들지 않습니다.
- `dart-define`: 시크릿 `ENV_FILE`(`.env` 형식)을 프로젝트 밖 임시 경로에 쓰고 `--dart-define-from-file`로 넘깁니다. 프로젝트 루트에는 `.env`를 만들지 않습니다. 파일 경로를 넘기므로 `--verbose`에서도 값이 명령줄에 노출되지 않습니다.
- `dotenv`: 지금처럼 Flutter 루트에 `.env`를 만든 뒤 `build_runner`가 실행되는 순서를 유지합니다.
- 이미 설치된 프로젝트(`version.yml`에 저장값이 없음)와 비대화형 실행은 기존 동작을 보존하기 위해 `dotenv`를 유지하고, 신규 설치만 `dart-define`이 기본입니다.
- 적용 대상은 모든 `flutter build` 호출부입니다(PLAYSTORE, FIREBASE, SELFHOSTED, TEST-APK, CI, IOS-TESTFLIGHT, IOS-TEST-TESTFLIGHT).
- Flutter의 `.env` 파서가 기존 `ENV_FILE` 문법(따옴표, 주석, 값 안의 `=`)을 처리하는지 설치된 Flutter로 실측하고, 지원 범위를 README에 명시합니다.

**결정 사항 — fastlane은 스토어 배포 전용**

- fastlane은 `ANDROID-PLAYSTORE-CICD`, `IOS-TESTFLIGHT`, `IOS-TEST-TESTFLIGHT`에서만 씁니다. `SELFHOSTED`와 `TEST-APK`는 Ruby 설정, fastlane 설치, `fastlane build` 스텝을 삭제하고 직접 `flutter build apk --release`를 실행하며, `TEST-APK`의 "Fastfile이 있으면 fastlane, 없으면 flutter" 분기도 없앱니다. Android `build` lane 템플릿은 만들지 않습니다.
- 템플릿 3종을 `payload/flutter-app/` 아래에 두고 설치 시 `<Flutter 루트>/` 기준으로 복사합니다(모노레포는 `paths.get("flutter")`): `android/fastlane/Fastfile.playstore`, `ios/fastlane/Fastfile`, `ios/ExportOptions.plist`(플레이스홀더 포함). "없을 때만 생성"이며 `copyWorkflows`의 secret-backup 경로와 같은 선례를 따릅니다. 이미 있으면 요약 화면에 "기존 파일 유지"로 표시하고, uninstall은 이 파일들을 건드리지 않습니다.
- 배포 모드 매핑(`store_only`/`store_prepare`/`store_submit`)은 Fastfile이 결정합니다. Play Store는 각각 internal 트랙 업로드, production 트랙에 draft 상태로 업로드, production 심사 제출입니다. iOS는 각각 TestFlight 업로드, 앱 버전과 메타데이터 준비까지(심사 제출 안 함), 심사 제출까지입니다. iOS `store_prepare`를 워크플로우가 어떻게 다루는지는 Fastfile 작성 전에 다시 확인합니다.
- `ANDROID-PLAYSTORE-CICD`에 `ANDROID_PACKAGE_NAME`(`secrets` 우선, 없으면 `vars`) 환경변수를 추가해 fastlane에 넘깁니다. iOS의 `IOS_BUNDLE_ID`, `ANDROID_DEPLOY_MODE`, `IOS_DEPLOY_MODE`와 같은 플랫폼 접두사 규칙입니다. Play 변경 이력 경로는 워크플로우가 만드는 `android/fastlane/metadata/android/ko-KR/changelogs/`와 일치시킵니다.
- iOS `upload_testflight`는 번들 ID를 넘기지 않으므로 Fastfile이 환경변수가 있으면 쓰고 없으면 fastlane 기본 추론에 맡깁니다. 워크플로우는 수정하지 않습니다.
- `IOS-TESTFLIGHT`의 `ExportOptions.plist` 검증 스텝에 플레이스홀더 잔존 검사를 추가해, 채우지 않고 실행하면 이해하기 어려운 `xcodebuild` 오류 대신 명확한 메시지로 중단시킵니다.
- Gemfile은 스토어 배포 워크플로우 3곳에서 "사용자 Gemfile에 `fastlane`이 있으면 그것을 쓰고, 없으면 지금처럼 생성(`multi_json` 우회 포함)"으로 바꿉니다. Gemfile 템플릿은 배포하지 않습니다. fastlane 공식 문서가 권장하는 Gemfile과 `Gemfile.lock` 커밋은 README로 안내합니다.
- 끊긴 웹 마법사 안내를 삭제합니다. `IOS-TESTFLIGHT`, `IOS-TEST-TESTFLIGHT`(주석과 오류 안내 출력), `FIREBASE`, `TEST-APK`가 대상이고, 대체 문구는 필요한 Secrets 목록 위주로 짧게 씁니다.

**결정 사항 — 마법사 선택지 3개 (프로젝트 타입에 Flutter가 포함된 경우에만)**

- ① 환경변수 방식(`dart-define` / `dotenv`), ② 스토어 배포 대상(Android Play Store / iOS TestFlight 다중 선택), ③ 배포 모드(②에서 고른 플랫폼별 `store_only` / `store_prepare` / `store_submit`, 기본 `store_only`)입니다. `store_submit`을 고르면 main push마다 심사가 자동 제출된다는 경고를 한 줄 보여줍니다.
- ②의 기본값은 대화형 신규 설치는 아무것도 선택하지 않은 상태, 비대화형과 플래그 미지정은 현행 동작(둘 다 설치)입니다. Android는 `PLAYSTORE` + `Fastfile.playstore`, iOS는 `IOS-TESTFLIGHT` + `IOS-TEST-TESTFLIGHT` + `ios/fastlane/Fastfile` + `ExportOptions.plist`가 묶음입니다. `FIREBASE`, `SELFHOSTED`, `TEST-APK`, `APP-BUILD-TRIGGER`, `CI`는 지금처럼 항상 설치합니다.
- 저장은 `version.yml`의 `metadata.template.options` 아래 `env_mode`, `flutter_store`, `android_deploy_mode`, `ios_deploy_mode`이고, CLI 플래그는 `--flutter-env-mode`, `--flutter-store`(`android,ios,none`), `--android-deploy-mode`, `--ios-deploy-mode`입니다. 저장값이 있으면 재질문하지 않는 기존 규약(`deploy_style`)을 따릅니다.
- 나중에 바꿀 수 있도록 마법사 "수정하기" 메뉴에 Flutter 프로젝트일 때 항목 3개("환경변수 방식", "스토어 배포 대상", "배포 모드")를 추가합니다. 다시 실행하면 설치된 워크플로우는 기존 3-way 규칙(미수정 자동 갱신, 수정본 충돌 처리)을 따릅니다.
- 스토어 대상을 해제하면 배포 방식 변경 때와 같은 정리 규칙을 재사용합니다. 미수정 워크플로우는 삭제하고 수정한 것은 `.bak`으로 보존하며, 사용자 소유인 Fastfile과 `ExportOptions.plist`는 삭제하지 않습니다.
- 배포 모드 기본값은 워크플로우 표현식의 폴백 자리(현재 `store_only`가 하드코딩된 부분)에 반영합니다. 런타임의 저장소 변수(`ANDROID_DEPLOY_MODE`, `IOS_DEPLOY_MODE`)와 `workflow_dispatch` 입력이 항상 우선입니다.

**결정 사항 — 가시성, 고지, 문서**

- `status`: 옵션 줄에 `env_mode`, `flutter_store`, `android_deploy_mode`, `ios_deploy_mode`를 추가합니다.
- `doctor`(Flutter 프로젝트에서 선택한 플랫폼 기준): 필수 파일 존재 여부와 `ExportOptions.plist`의 플레이스홀더 잔존 여부를 WARN으로 진단합니다. 스토어 시크릿 등록 여부 검사는 이번 범위에서 제외합니다.
- `--dry-run`: 새로 만들 파일 목록을 포함하고, 이미 있어서 건너뛸 파일은 "기존 파일 유지"로 표시합니다.
- `payload/config/breaking-changes.json`에 `warning` 4건을 등록합니다: (1) `SELFHOSTED`·`TEST-APK`가 `fastlane build` 대신 `flutter build`를 직접 실행하고 Ruby·fastlane 설치가 사라짐, (2) 신규 설치의 환경변수 기본값이 `dart-define`으로 바뀌고 기존 설치는 `dotenv` 유지, (3) Flutter 워크플로우가 `FLUTTER_PROJECT_DIR` 기준으로 동작(모노레포는 `--paths flutter=<경로>`), (4) 모노레포에서 CI를 required check로 쓰려면 `ci-gate`만 등록. 버전 키는 릴리스 시점의 버전으로 정합니다(현재 0.10.0).
- README Flutter 섹션에 채워야 할 항목(`ExportOptions.plist`, `ANDROID_PACKAGE_NAME`, 필요한 Secrets·Variables), 환경변수 방식 설명, 배포 모드 매핑, `ci-gate` 사용법, Gemfile 안내를 추가합니다. CHANGELOG는 자동 생성이라 수동 편집하지 않습니다.

**구현 가이드 (파일 경로 + 심볼 + 변경 요약)**

- `payload/workflows/flutter/`의 `PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml`, `PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml`, `PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD.yaml`, `PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml`: `on.push` 아래에 `# @wizard paths-anchor` 추가, 환경변수 방식별 `.env` 생성·`flutter build` 플래그 분기, 웹 마법사 안내 정리. `PLAYSTORE`에는 `ANDROID_PACKAGE_NAME`과 Gemfile 분기도 추가합니다.
- 같은 폴더의 `PROJECT-FLUTTER-CI.yaml`, `PROJECT-FLUTTER-ANDROID-TEST-APK.yaml`, `PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml`: `FLUTTER_PROJECT_DIR` 정비와 환경변수 분기, CI는 `changes`·`ci-gate` 추가. `TEST-APK`는 Ruby·fastlane 스텝과 Fastfile 유무 분기 삭제.
- `payload/workflows/go/PROJECT-GO-CI.yaml`, `payload/workflows/next/PROJECT-NEXT-CI.yaml`, `payload/workflows/python/PROJECT-PYTHON-CI.yaml`, `payload/workflows/react/PROJECT-REACT-CI.yaml`, `payload/workflows/spring/nexus/PROJECT-SPRING-NEXUS-CI.yml`: `changes`·`ci-gate` 추가. Spring publish 2종(`nexus/` 폴더)에는 경로 앵커 추가.
- `src/core/wizard-env.js`의 `substituteEnv`, `PATHS_ANCHOR_RE`, `resolveToken`: 앵커 치환 방식을 재사용하고 환경변수 모드·배포 모드용 auto 토큰을 추가합니다. 배포 모드 폴백은 따옴표 값이 아닌 표현식 안에 있어 현재 치환 규칙이 그대로 적용되지 않으므로 별도 토큰 방식이 필요한 것으로 추정됩니다(구현 시 확인). `resolvers`는 `src/core/detect-fs.js`의 `flutter-root`와 같은 방식으로 추가합니다.
- `src/core/deploy-style.js`의 `deployFilter`, `cleanupOtherDeployWorkflows`: 선택 필터·정리 패턴의 기준입니다. 스토어 선택용으로 같은 구조의 모듈을 새로 만듭니다.
- `src/core/version-yml.js`의 `parseTemplateOptions`, `renderVersionYml`: 옵션 키 4개를 파싱·렌더에 추가합니다(`deploy_style`과 같은 방식).
- `src/cli/args.js`, `src/cli/help.js`, `src/index.js`, `src/commands/interactive.js`, `src/commands/full.js`, `src/ui/prompts.js`(`selectDeployStyle`을 참고한 새 선택 함수, `editMenu` 항목 추가): 플래그, 질문 흐름, 저장값 복원, "수정하기" 항목을 추가합니다.
- `src/core/copy/workflows.js`의 `copyWorkflowsForType`, `planWorkflows`와 secret-backup 스킵 경로: 앱 파일(`payload/flutter-app/`)을 없을 때만 복사하는 단계를 추가하고, `src/commands/full.js`에서 워크플로우 복사 이후에 실행합니다.
- `src/commands/status.js`, `src/commands/doctor.js`, `src/commands/dry-run.js`(`planDryRun`, `printDryRun`): 위 가시성 항목을 추가합니다.
- `src/core/breaking.js`(`collectBreaking`)와 `payload/config/breaking-changes.json`: 고지 4건 등록.
- 테스트: `tests/node/wizard-env.test.js`, `deploy-style.test.js`(패턴 참고), `version-yml.test.js`, `args-validation.test.js`, `dry-run.test.js`, `status.test.js`, `doctor.test.js`, `payload-yaml.test.js`, `e2e-matrix.test.js`, 픽스처 `tests/fixtures/flutter`와 `tests/fixtures/monorepo`. 신규 생성, 기존 파일 유지, 모노레포 경로, dry-run 목록, 선택 해제 정리를 검증합니다.
- `README.md`의 "타입별 워크플로우 구성" 아래 Flutter 설명에 위 문서 항목을 추가합니다.

**검증**

- `npm test`와 수정한 워크플로우 전체에 `actionlint`(로컬 설치됨, 레포 의존성으로는 추가하지 않음)를 실행합니다. `.env` 파서는 설치된 Flutter로 실측합니다.
- 실제 GitHub Actions 실행은 로컬에서 할 수 없으므로 PR 이후 테스트 레포에서 확인할 항목으로 남깁니다: 모노레포에서 경로 필터 동작, `ci-gate`가 required check로 동작, 태그 배포가 필터에 막히지 않는지.
- 커밋 메시지는 한국어로 작성합니다.

**범위 밖 (후속 이슈)**

- `FIREBASE`, `SELFHOSTED`, `TEST-APK` 등 스토어 외 배포 대상의 개별 선택
- Spring 등 다른 타입의 루트 기준 빌드 경로(`./gradlew`, `Dockerfile` 등) 모노레포 정비
- Fastfile 템플릿 개선의 기존 사용자 전파(baseline 3-way를 워크플로우 밖 파일로 일반화)
- uninstall 시 Fastfile 처리 정책
- `doctor`의 스토어 시크릿 등록 검사
- 필요해질 때 환경변수 방식 등 새 선택지의 확장

### 고려한 다른 방법(선택)

- **환경변수 `both`(`.env` 생성 + dart-define 병행)**: 환경변수를 두 곳에서 관리하게 되고, 과도기는 `dotenv`로 두었다가 옮기면 되므로 제외했습니다.
- **`.env` 완전 폐지(하드 컷)**: `flutter_dotenv`를 쓰는 기존 사용자가 업데이트 한 번에 조용히 깨질 수 있어, 기존 설치는 `dotenv`를 유지합니다.
- **`--dart-define KEY=VALUE`로 값을 직접 전달**: `--verbose` 로그에 값이 남을 수 있어 파일을 넘기는 `--dart-define-from-file`을 택했습니다.
- **경로 필터를 워크플로우 `paths`로만 처리(CI 포함)**: required check가 Pending에 머무는 부작용이 있어 CI는 job 단위 필터로 나눴습니다. 동명 워크플로우를 하나 더 두는 우회법은 파일이 2배가 되고 이름이 어긋나기 쉬워 제외했습니다.
- **변경 판별을 `git diff --name-only` 셸로 직접 구현**: push 전 커밋 SHA, 체크아웃 깊이, PR 기준 브랜치 처리를 직접 짜야 해서 검증된 액션(`dorny/paths-filter`)을 택했습니다.
- **Gemfile 템플릿 배포 / 현행(매번 생성) 유지**: 템플릿은 설치기가 `Gemfile.lock`을 만들 수 없어 재현성 이득이 없고 사용자 Gemfile과 충돌합니다. 현행 유지는 재현성이 없어, 사용자 Gemfile이 있으면 우선하는 방식으로 정했습니다.
- **fastlane으로 빌드 유지 + `DART_DEFINE_FILE` 전달 계약**: 빌드까지 fastlane에 맡기면 워크플로우가 빌드 플래그를 통제할 수 없어, fastlane을 스토어 배포 전용으로 한정했습니다.
- **웹 마법사 HTML 복원**: 이 프로젝트는 CLI 설치기라 HTML 마법사를 유지할 이유가 약해 안내 문구를 삭제하고 Fastfile 템플릿으로 대체합니다.
- **PR을 3개로 분리**: 세 단계가 같은 Flutter 워크플로우 파일을 겹쳐 수정해 병합 충돌과 리뷰 맥락 단절이 생겨 하나의 PR로 정했습니다. 리뷰 부담이 크면 병합 직전에 분리할 수 있습니다.
- **스토어 외 배포 대상까지 포함한 전체 개별 선택**: 범위가 크게 늘어 후속으로 남겼습니다.
