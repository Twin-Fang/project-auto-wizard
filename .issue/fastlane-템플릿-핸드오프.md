# Fastlane 템플릿 배포 — 전체 정리 (조사 + 브레인스토밍 + 남은 논의)

- 작성일: 2026-09-21
- 상태: **브레인스토밍(grilling) 진행 중.** 코드 변경 없음, 이슈 미생성.
- 목적: 다른 세션에서 이어서 작업하기 위한 단일 정리본. 이 문서만 읽으면 지금까지의 조사·결정·미결 사항을 전부 파악할 수 있어야 한다.
- 이어서 할 일: **§6의 미결 질문(Q9~Q14)에 사용자 답을 받고 → 빈 곳이 없으면 사용자에게 "공유된 이해에 도달했는지" 확인 → `/issue`로 GitHub 이슈 작성.** (grilling 스킬 규칙: 사용자 확인 전에는 실행하지 않는다)

---

## 0. 한눈에 보기

| 항목 | 내용 |
|---|---|
| 발단 | "Flutter 앱을 스토어에 올리려면 fastlane도 설정돼야 할 텐데, 지금 설정돼 있나? 아니라면 파이프라인이 어떻게 돼 있는지 보고" |
| 핵심 발견 | Fastlane을 **호출하는** 워크플로우는 5종 있는데, 그 워크플로우가 필요로 하는 **Fastfile/ExportOptions.plist를 이 레포는 만들지도 배포하지도 않는다.** 안내하던 웹 마법사 HTML도 레포에 없다. |
| 결론 방향 | Fastfile 템플릿을 `payload/`에 넣어 설치기가 복사하고, 웹 마법사 안내 문구는 삭제한다. GitHub 이슈로 남긴다. |
| 확정 | Q1, Q2, Q3, Q5, Q6, Q7 (§5) |
| 미결 | Q9~Q13(추천안 있음, 답 대기) + Q14(이 문서에서 새로 발견) (§6) |

---

## 1. 조사 결과 (사실)

### 1-1. Fastlane 관련 파일이 레포에 있는가

- `git ls-files`로 확인한 결과 `Fastfile`, `Appfile`, `Matchfile`, `Deliverfile`, `Gemfile`, `Fastfile.playstore`, `ExportOptions.plist`, 마법사 HTML(`*.html`) 모두 **0개**.
- `git grep fastlane` 히트: Flutter 워크플로우 5종 + `docs/superpowers/specs/2026-08-08-flutter-root-env-rename-design.md`(과거 설계 문서, 무관).
- 워크플로우 주석은 **웹 마법사가 Fastfile을 생성한다**고 안내한다:
  - `.github/util/flutter/ios-testflight-setup-wizard/index.html` (iOS)
  - `.github/util/flutter/firebase-wizard/firebase-wizard.html` (Firebase)
- 이 마법사 HTML을 참조하거나 복사하는 코드는 워크플로우 밖에 **없다** (`git grep` 결과 0건). 즉 설치 후 그 경로에 파일이 생기지 않는다.
- 원본은 SUH-DEVOPS-TEMPLATE(Cassiiopeia/projectops v4.0.4)이며(`docs/DESIGN-SPEC.md` 등), 포팅 때 마법사와 Fastfile 템플릿이 빠졌을 가능성이 있다. **원본 레포는 확인하지 않았으므로 추정.**

### 1-2. Flutter 워크플로우 8종 (`payload/workflows/flutter/`)

| 워크플로우 | 트리거 | 배포 방식 | Fastlane 사용 |
|---|---|---|---|
| `PROJECT-FLUTTER-CI` | develop PR/push, 수동 | 없음 (`flutter build apk --debug`, `flutter build ios --release --no-codesign`) | 미사용 |
| `PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD` | main push, 수동 | Play Store internal / production | `deploy_internal` lane |
| `PROJECT-FLUTTER-ANDROID-FIREBASE-CICD` | main push, 수동 | Firebase App Distribution (`flutter build appbundle` 직접) | 미사용 |
| `PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD` | main push, 수동 | 자체 서버(SMB) | `build` lane (폴백 없음) |
| `PROJECT-FLUTTER-ANDROID-TEST-APK` | 수동, `repository_dispatch` | 테스트 APK | Fastfile 있으면 `build` lane, 없으면 `flutter build apk --release` 폴백 |
| `PROJECT-FLUTTER-IOS-TESTFLIGHT` | main push, 수동 | TestFlight / 심사 제출 (`DEPLOY_MODE`) | `deploy` lane |
| `PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT` | 수동, `repository_dispatch` | 테스트용 TestFlight | `upload_testflight` lane |
| `PROJECT-FLUTTER-SUH-LAB-APP-BUILD-TRIGGER` | (미확인) | 테스트 빌드 워크플로우들을 `repository_dispatch`로 호출 | 미사용 |

- Fastlane은 **업로드 단계에만** 쓰인다. 빌드는 `flutter build`, iOS 서명은 `match` 없이 GitHub Secrets의 base64 인증서·프로파일·`.p8` 키를 쓴다. iOS 파이프라인: `flutter build ios --no-codesign` → `xcodebuild archive` → `xcodebuild -exportArchive`(`ExportOptions.plist`) → `fastlane deploy`.
- 배포 모드 3종: `store_only` / `store_prepare` / `store_submit`. `workflow_dispatch` 입력 또는 저장소 변수(`ANDROID_DEPLOY_MODE`, `IOS_DEPLOY_MODE`)로 정한다. 기본값 `store_only`.

### 1-3. Fastlane 호출 위치 (파일:줄)

| 파일 | 줄 | 내용 |
|---|---|---|
| `…ANDROID-PLAYSTORE-CICD.yaml` | 559~572 | Ruby 3.4.1 설치, `printf … > Gemfile` + `bundle install` (`android/`) |
| 〃 | 575~582 | `android/fastlane/Fastfile.playstore` → `Fastfile` 복사. **없으면 실패** |
| 〃 | 662 | changelog 경로 `android/fastlane/metadata/android/ko-KR/changelogs/` |
| 〃 | 696 | `bundle exec fastlane deploy_internal` |
| `…ANDROID-SELFHOSTED-CICD.yaml` | 173~181, 200~206 | Gemfile 생성 후 `bundle exec fastlane build --verbose` |
| `…ANDROID-TEST-APK.yaml` | 427~435, 542~549 | Gemfile 생성. `android/fastlane/Fastfile` 있으면 `fastlane build \|\| flutter build apk --release` |
| `…IOS-TESTFLIGHT.yaml` | 330~336 | `ExportOptions.plist` 없으면 `exit 1` |
| 〃 | 415~421 | `ios/fastlane/Fastfile` 없으면 `exit 1` (마법사 실행 안내 출력) |
| 〃 | 423~429, 469 | Gemfile 생성, `bundle exec fastlane deploy` |
| `…IOS-TEST-TESTFLIGHT.yaml` | 797~811, 849 | Fastfile 검사, Gemfile 생성, `bundle exec fastlane upload_testflight` |

### 1-4. Fastfile이 만족해야 할 워크플로우 계약 (환경변수·경로)

- **Play Store `deploy_internal`**
  - 환경변수: `AAB_PATH`, `GOOGLE_PLAY_JSON_KEY`(`$HOME/.config/gcloud/service-account.json`), `VERSION_NAME`, `VERSION_CODE`, `DEPLOY_MODE`
  - changelog: `android/fastlane/metadata/android/ko-KR/changelogs/<VERSION_CODE>.txt` (500자 한도, 480자로 절단해 파일 작성)
  - **패키지명은 어디서도 넘어오지 않는다** (Play Store 워크플로우 전체에서 패키지명 참조 0건 재확인)
- **iOS `deploy`**
  - 환경변수: `APP_STORE_CONNECT_API_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `API_KEY_PATH`(`~/.appstoreconnect/private_keys/AuthKey_<ID>.p8`), `IPA_PATH`, `RELEASE_NOTES`(3800바이트 절단), `APP_IDENTIFIER`(`secrets.IOS_BUNDLE_ID || vars.IOS_BUNDLE_ID`), `DEPLOY_MODE`, `APP_VERSION`, `BUILD_NUMBER`, `SKIP_WAITING_FOR_BUILD_PROCESSING`
- **iOS `upload_testflight`**
  - 환경변수: `API_KEY_PATH`, `IPA_PATH`, `RELEASE_NOTES` + 스텝 env로 `APP_STORE_CONNECT_API_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`
  - **`APP_IDENTIFIER`를 넘기지 않는다** → Fastfile이 번들 ID를 IPA에서 추론(pilot)하거나 스스로 해결해야 한다
- **Android `build`**: 산출물이 `../build/app/outputs/flutter-apk/app-release.apk`에 있어야 한다 (Selfhosted가 이 경로에서 `mv`)
- **`Gemfile`**: 5개 워크플로우가 실행 중 `printf 'source "https://rubygems.org"\ngem "fastlane"\ngem "multi_json"\n' > Gemfile` 후 `bundle install`. `multi_json`은 google-apis의 upstream 의존성 누락 버그 우회

### 1-5. 설치기 구조 (`src/`) — 새 파일을 어디에 어떻게 얹을지에 대한 근거

- 설치기가 다루는 것: `workflows/`, `scripts/`(`.github/scripts/`), `version.yml`, README 버전 섹션, `.gitignore`. **앱 프로젝트 안에 파일을 놓는 경로는 없다** → 새 복사 카테고리가 필요하다.
- 실행 순서(`src/commands/full.js`): 워크플로우 복사(+env 치환) → `version.yml` → README 섹션 → scripts → gitignore → 이전 배포 방식 정리 → baseline 기록.
- **Flutter 워크플로우는 개별 선택 로직이 없다.** `copyWorkflowsForType`(`src/core/copy/workflows.js` 330행~)이 `payload/workflows/flutter/` 8종을 통째로 복사한다. `deployFilter`(`src/core/deploy-style.js`)는 `-SIMPLE-CICD.yaml`/`-NONSTOP-NGINX-CICD.yaml`/`-NONSTOP-TRAEFIK-CICD.yaml` 접미사에만 작동하고, `src`에 Playstore/TestFlight를 가르는 코드는 없다. (단 `options-ask.js`는 직접 읽지 않고 `git grep`으로만 확인했다.)
- **baseline 3-way 판정**(`src/core/baseline.js`, 저장 위치 `.github/.wizard/baseline.json`): 워크플로우 전용이다. 키가 파일명이고 `listYamlFiles`로 `.yaml`만 대상이라, `android/fastlane/Fastfile`과 `ios/fastlane/Fastfile`이 같은 키 `Fastfile`로 충돌한다. 워크플로우 밖 파일에 쓰려면 일반화가 필요하다.
- **선례**: `copyWorkflows`의 secret-backup 경로(`workflows.js` 202~217행)는 "이미 존재하면 스킵, 신규만 복사"이고 baseline 3-way를 쓰지 않는다.
- 충돌 처리 규약(워크플로우): `skip`(기본) / `backup`(.bak 후 교체) / `template`(.template.yaml 생성). 사용자가 지운 파일은 조용히 되살리지 않고 묻는다.
- `assertPayload`(`src/core/assets.js`)는 `payload/workflows`, `payload/scripts`만 필수 검사한다. `package.json`의 `files`가 `payload/` 전체를 포함하므로 새 payload 폴더를 추가해도 패키징은 그대로 된다.
- uninstall/purge의 `planRemoval`(`src/core/removal-plan.js`)은 워크플로우·스크립트·baseline만 대상으로 한다 → 새 파일은 자동으로 제거 대상이 되지 않는다.
- Flutter 루트: `paths.get("flutter")`(`src/core/detect-fs.js`의 `flutter-root` resolver, 기본 `.`). 모노레포는 `--paths "flutter=app"`.
- 워크플로우 상단 `# project-auto-wizard:managed-workflow` 마커는 uninstall이 파일을 식별하는 용도. 워크플로우 env 치환은 `@wizard ask:` / `@wizard auto:` 주석 문법(`src/core/wizard-env.js`).
- 테스트: `node --test`, `tests/node/*.test.js`, 픽스처 `tests/fixtures/flutter/`, `e2e-matrix.test.js`, `baseline-3way.test.js`, `deploy-style.test.js` 등.

---

## 2. 현재 파이프라인 요약 (사용자가 물었던 "Fastlane 없이 지금은 어떻게?")

- **CI**: `FLUTTER-CI`가 develop PR/push에서 코드 분석 + `flutter build apk --debug` / `ios --no-codesign`. 배포 없음.
- **Android 배포 경로 3가지**: Play Store(Fastlane `deploy_internal`), Firebase App Distribution(Fastlane 없이 액션 사용, `serviceCredentialsFile`), 자체 서버 SMB(Fastlane `build`).
- **iOS 배포**: TestFlight(Fastlane `deploy`). 테스트 빌드는 `repository_dispatch`로 트리거되는 별도 워크플로우(Fastlane `upload_testflight`).
- 결국 **Firebase 배포와 CI를 제외한 스토어/자체서버 경로는 Fastfile이 있어야만 돈다.** Fastlane을 쓰지 않는 스토어 배포 경로는 존재하지 않는다.

---

## 3. 브레인스토밍 이력 (질문 → 답변)

### Round 1

| # | 질문 | 사용자 답 |
|---|---|---|
| Q1 | 이 레포가 Fastfile 템플릿까지 제공할까, "사용자가 준비" 전제를 유지하고 문서·사전검증만 보강할까? | **"넣어주자"** → 템플릿 제공 |
| Q2 | 워크플로우 주석이 안내하는 웹 마법사 HTML을 복원할까, 안내를 지우고 Fastfile 템플릿으로 대체할까? | **"후자"** → 안내 삭제 + 템플릿 대체 |
| Q3 | 조사만 하고 끝낼까, 이슈로 남길까? | **"이슈 남기자"** |

### Round 2

| # | 질문 | 사용자 답 |
|---|---|---|
| Q4 | Gemfile 템플릿도 배포하고 워크플로우의 `printf` 생성을 지울까, 현재 방식을 유지할까? | **"기존 방식과 Gemfile 만드는 방식 중 더 추천하는 걸 고민해서 보고해"** → §4-1 보고 |
| Q5 | Android 파일 구성: (a) `Fastfile` + `Fastfile.playstore` 2개, 워크플로우 무수정 / (b) 단일 `Fastfile` + 복사 단계 삭제 | **a** |
| Q6 | Android 패키지명 출처: (a) `Appfile`의 `package_name` 플레이스홀더 / (b) 워크플로우에 `PACKAGE_NAME` 환경변수 추가 | **b** |
| Q7 | `ios/ExportOptions.plist`: (a) 플레이스홀더 템플릿 배포 + README 안내 / (b) 배포 안 함, 에러 메시지에서 예시 안내 | **a** |
| Q8 | 기존 파일이 있을 때 덮어쓰기 정책과 설치 조건 | **"어떤 방식이 가장 좋을까? 찾아보고 보고해"** → §4-2 보고 |

### Round 3 (사용자 답 대기 중 — §6 참고)

Q9~Q13을 제시했고, 사용자는 이후 "이 논의 전체를 md 하나로 정리해 달라"고 요청했다 (이 문서).

---

## 4. 조사·분석 보고 (사용자가 "찾아보고 보고해"라고 한 항목)

### 4-1. Q4 — Gemfile: 현재 방식 유지 추천

정정: 앞서 "`printf > Gemfile`이 사용자 Gemfile을 지운다"고 한 것은 **과장**이었다. 덮어쓰는 대상은 CI 러너에 체크아웃된 복사본이라 사용자 레포는 안전하다. 실제 문제는 사용자가 커밋해 둔 Gemfile의 버전 고정과 플러그인이 CI에서 무시된다는 점이다.

| | A. 현재 방식 (워크플로우가 생성) | B. Gemfile 템플릿 배포 | C. 혼합 (`[ -f Gemfile ] \|\| printf …`) |
|---|---|---|---|
| Fastlane 공식 권장(Gemfile + Gemfile.lock 커밋)과 부합 | 아니오 | Gemfile만 부합, **lock은 빠짐** | 사용자가 직접 커밋하면 부합 |
| 재현성 | 매 실행 최신 fastlane | A와 동일 (lock이 없음) | 사용자가 lock까지 커밋하면 확보 |
| `multi_json` 우회 관리 | 워크플로우 한 곳에서 관리, 수정은 baseline 자동 업데이트로 전파 | 사용자 레포마다 사본이 생겨 전파 안 됨 | 사용자 Gemfile에 `multi_json`이 없으면 옛 버그 재발 |
| 구현 비용 | 0 | 새 설치 경로 2개(`android/Gemfile`, `ios/Gemfile`) + 충돌 처리 | 워크플로우 5곳 한 줄씩 |

- 근거(Context7 Fastlane 공식 문서): Gemfile + `Gemfile.lock`을 버전 관리에 커밋하고 `bundle exec fastlane`을 쓰는 것이 권장 관행이다. 그러나 **lock은 설치기가 만들 수 없다**(사용자 머신에서 `bundle lock` 필요, 플랫폼별). 그래서 B는 재현성 이득 없이 관리 지점만 늘린다.
- 추천: **A 유지**, C는 후속 개선 이슈로 기록.

### 4-2. Q8 — 설치 정책: "없을 때만 생성" + "Flutter 타입 설치 시 항상 설치" 추천

**설치 조건**
- Flutter 워크플로우 개별 선택 로직이 없으므로 "스토어 워크플로우를 골랐을 때만 설치"는 새 선택 기능이 필요하다 → 범위 초과.
- Fastfile은 워크플로우가 없으면 쓰이지 않는 파일이라 함께 설치해도 무해하다.

**덮어쓰기 정책**

| 방식 | 평가 |
|---|---|
| 항상 덮어씀 | 사용자가 직접 커스터마이징하는 파일이라 파괴적. **탈락** |
| 워크플로우와 같은 baseline 3-way | 파일명 키 충돌(`Fastfile` ×2), `.yaml` 전용 로직 등 일반화 비용이 큼. 이번 범위 밖 |
| **없을 때만 생성** | secret-backup 경로라는 선례가 있고 구현이 작다. 템플릿 개선이 기존 사용자에게 전파되지 않는 점은 수용 |

- uninstall은 새 파일을 건드리지 않는다(사용자 소유 파일이므로 오히려 안전).

---

## 5. 확정된 결정

1. **Q1**: Fastfile 템플릿을 `payload/`에 넣어 설치기가 복사한다.
2. **Q2**: 워크플로우 주석의 웹 마법사 안내는 삭제하고 Fastfile 템플릿으로 대체한다. (마법사 HTML은 복원하지 않는다.)
3. **Q3**: 조사에서 끝내지 않고 GitHub 이슈로 남긴다. 진행 중인 SUH LAB 네이밍 정리(#128)와는 **분리**한다.
4. **Q5**: Android 2파일 구성 — `android/fastlane/Fastfile`(`build` lane) + `android/fastlane/Fastfile.playstore`(`deploy_internal` lane). 워크플로우의 복사 단계는 수정하지 않는다.
5. **Q6**: Android 패키지명은 워크플로우에 `PACKAGE_NAME` 환경변수를 추가해 GitHub Secrets/Variables에서 읽는다 (iOS `IOS_BUNDLE_ID`와 대칭). 변수명은 Q13에서 확정.
6. **Q7**: `ios/ExportOptions.plist`는 플레이스홀더가 든 템플릿을 배포하고, README에 채울 항목(팀 ID, 번들 ID, 프로파일 이름 등)을 안내한다.

---

## 6. 미결 — 다음 세션에서 사용자에게 물어볼 것

> 전부 추천안이 있다. 사용자가 "추천대로"라고 하면 그대로 확정.

| # | 질문 | 추천 |
|---|---|---|
| **Q9** | Gemfile: 현재 방식(워크플로우가 생성)을 유지하고, 혼합 방식(C)은 후속 이슈로 남길까? | 네 (§4-1) |
| **Q10** | 설치 방식: "없을 때만 생성 + Flutter 타입 설치 시 항상 설치"로 갈까? 배치는 `payload/flutter-app/{android/fastlane/{Fastfile,Fastfile.playstore}, ios/fastlane/Fastfile, ios/ExportOptions.plist}` → 설치 위치 `<Flutter 루트>/android/…`, `<Flutter 루트>/ios/…`. 기존 파일이 있으면 요약에 "기존 파일 유지" 표시 | 네 (§4-2) |
| **Q11** | 배포 모드 매핑 확정: Play — `store_only`=internal 트랙 업로드 / `store_prepare`=production 초안 / `store_submit`=production 심사 제출. iOS — `store_only`=TestFlight / `store_prepare`=심사 제출 직전까지 준비 / `store_submit`=심사 제출까지. Android `build` lane = `flutter build apk --release` | 네. iOS 워크플로우 옵션 설명("store_only=TestFlight까지 / store_prepare=ASC 제출직전 / store_submit=심사 자동제출")과 일치함을 확인 |
| **Q12** | 가시성: `--dry-run`에는 새 파일 포함, `status`/`doctor`는 이번엔 제외(후속)? | 네 |
| **Q13** | Play Store 워크플로우에 추가할 변수명: (a) `ANDROID_PACKAGE_NAME` (`secrets.X \|\| vars.X` 패턴) / (b) `PACKAGE_NAME` | (a) — 이미 `IOS_BUNDLE_ID`, `ANDROID_DEPLOY_MODE`, `IOS_DEPLOY_MODE`가 플랫폼 접두사 규칙을 쓴다 |
| **Q14** (신규) | Q2의 "웹 마법사 안내 삭제" 범위: `firebase-wizard.html`을 안내하는 Firebase/Test-APK 워크플로우 주석도 이번에 함께 정리할까? 그쪽은 Fastfile이 아니라 Firebase 설정 안내이고 그 마법사 HTML도 레포에 없다(같은 원인의 끊긴 참조) | 포함 추천. 대체 문구는 "필요한 Secrets 목록" 위주로 짧게. 사용자에게 확인 필요 |

### 아직 질문으로 만들지 않은 논의 후보 (이슈 작성 전에 훑어볼 것)

1. **#128과의 충돌 위험**: #128(SUH LAB 종속 이름 일반화)이 `PROJECT-FLUTTER-SUH-LAB-APP-BUILD-TRIGGER` 등 같은 워크플로우 파일을 건드릴 수 있다. 이 작업의 브랜치 시점을 #128 머지 이후로 잡을지, 충돌을 감수할지 정해야 한다. (#128 진행 상태는 이 세션에서 확인하지 않았다.)
2. **`ExportOptions.plist` 플레이스홀더 미치환 감지**: 사용자가 값을 안 채우고 돌리면 `xcodebuild -exportArchive`에서 난해한 에러로 실패한다. 워크플로우의 `Verify ExportOptions.plist` 스텝(330~336행)에서 플레이스홀더 잔존 검사를 추가할지 여부.
3. **iOS Fastfile의 번들 ID 처리**: `deploy`는 `APP_IDENTIFIER`를 받지만 `upload_testflight`는 안 받는다. lane별로 다르게 쓸지, 공용 헬퍼로 통일할지.
4. **Android `Fastfile` vs `Fastfile.playstore` 내용 중복**: 두 파일이 공통 설정(`default_platform` 등)을 중복 가진다. Q5에서 (a)를 택했으므로 중복은 수용하되 주석으로 관계를 명시할지.
5. **Play changelog 디렉토리**: 워크플로우가 `android/fastlane/metadata/android/ko-KR/changelogs/`를 직접 만든다. Fastfile이 이 경로를 `metadata_path`로 쓰도록 맞춰야 한다.
6. **Play Store `DEPLOY_MODE=store_prepare`의 "production draft"**: Fastlane `supply`로 draft 릴리스를 만들 때 필요한 옵션(`release_status: "draft"`, `track: "production"`)을 이슈 본문에 명시할지.
7. **테스트 범위**: 없을 때만 생성 / 기존 파일 유지 / 모노레포 경로(`--paths flutter=app`) / dry-run 목록. 워크플로우 주석 삭제가 기존 테스트(문자열 매칭)를 깨는지 확인 필요.
8. **README Flutter 섹션 문서화**: 채워야 할 항목(ExportOptions.plist, 필요한 Secrets/Variables 목록).
9. **CHANGELOG**: 이 레포는 `CHANGELOG.md/json`을 자동 생성(workflow)하므로 수동 편집 대상인지 확인.

---

## 7. 이슈에 담을 후속/범위 밖 항목 (초안)

**범위 밖 (별도 이슈로 남김)**
- 혼합 Gemfile 방식(사용자 Gemfile 우선) + `Gemfile.lock` 안내
- Fastfile 템플릿 개선의 기존 사용자 전파 (baseline 3-way를 워크플로우 밖 파일로 일반화)
- `status`/`doctor`의 Fastfile 인식
- uninstall 시 Fastfile 처리 정책
- Flutter 워크플로우 개별 선택 기능 (스토어 워크플로우를 고른 경우에만 Fastfile 설치)

**이번 범위에 포함**
- Fastfile 템플릿 4종 + 설치기 복사 단계
- Play Store 워크플로우 `PACKAGE_NAME` 추가
- 웹 마법사 안내 문구 삭제/대체

## 8. 구현 시 예상 작업 목록 (이슈 본문 초안)

1. `payload/flutter-app/` 템플릿 작성
   - `android/fastlane/Fastfile` — `build` lane (`flutter build apk --release`)
   - `android/fastlane/Fastfile.playstore` — `deploy_internal` lane (`store_only`/`store_prepare`/`store_submit` 분기, changelog 경로 맞춤)
   - `ios/fastlane/Fastfile` — `deploy`, `upload_testflight` lane (API 키 인증, `DEPLOY_MODE` 분기, 번들 ID 처리)
   - `ios/ExportOptions.plist` — 플레이스홀더 템플릿
2. 설치기: 새 복사 단계 추가 (없을 때만 생성, Flutter 루트 기준 경로, 요약 출력, `--dry-run` 반영). 워크플로우 복사 이후 단계로 `full.js`에 삽입.
3. `PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml`에 `PACKAGE_NAME` env 추가 (변수명 Q13)
4. Flutter 워크플로우의 웹 마법사 안내 문구 삭제/대체 (`IOS-TESTFLIGHT`, `IOS-TEST-TESTFLIGHT`, + Q14 결과에 따라 `FIREBASE-CICD`, `TEST-APK`)
5. 테스트: 신규 생성 / 기존 파일 유지 / 모노레포 경로 / dry-run 목록 (`tests/node/`, `tests/fixtures/flutter`, `e2e-matrix.test.js` 참고)
6. README(Flutter 섹션)에 채워야 할 항목 안내

## 9. 이 프로젝트 작업 규칙 (재확인)

- 사용자에게는 **한국어**로 답한다. 커밋 메시지는 `type:` 영어 접두사 + **한국어 설명** (`CONTRIBUTING.md`와 함께 갱신).
- 브랜치는 `develop`에서 분기하고 PR도 `develop`으로. `Closes #N` 자동 연결은 develop→main 릴리스 PR 시점.
- 이슈에서 제안한 수정은 **그대로** 구현한다 (추가 로깅·기능 덧붙이지 않기).
- git force 계열 플래그 절대 금지. `.gitignore`로 제외된 파일(`.issue/` 등)은 강제 추적하지 않는다 — 이 문서도 `.issue/` 아래라 커밋되지 않는다.
- 브레인스토밍/grilling 시작 전에 Obsidian 볼트 검색 (`Projects/project-auto-wizard.md`가 검색됨, 이 주제와 직접 일치하는 결정 기록은 발견 못 함).
- 설계 확정 전에 코드를 짜지 않는다. grilling 스킬은 "사용자가 공유된 이해에 도달했다고 확인하기 전까지 실행하지 않는다"고 규정한다.
- 이슈 작성은 `/issue` 스킬 (프로젝트 루트 `.issue/` 폴더에 저장 후 생성).

## 10. 다음 세션 시작 방법

1. 이 문서를 읽는다.
2. §6의 Q9~Q14를 사용자에게 다시 제시한다. (추천안이 있으니 "추천대로" 한 마디로 확정 가능)
3. §6 하단의 "아직 질문으로 만들지 않은 논의 후보" 중 이슈에 반영할 것을 고른다. 특히 **#128과의 충돌 위험**, **`ExportOptions.plist` 미치환 감지**는 이슈 본문 범위에 영향을 준다.
4. 빈 곳이 없으면 사용자에게 "공유된 이해에 도달했는지" 확인받는다.
5. 확인되면 `/issue`로 이슈를 작성한다 (§7, §8을 본문 바탕으로 사용).
