# Flutter CI Android 빌드가 keystore 없이 --release 실행 — 브레인스토밍 결과

- 날짜: 2026-08-07
- 상태: 브레인스토밍 완료 (사용자 승인 완료 — 구현 계획 단계로 진행)
- 이슈: [Twin-Fang/project-auto-wizard#38](https://github.com/Twin-Fang/project-auto-wizard/issues/38)
- 관련: [Twin-Fang/project-auto-wizard#37](https://github.com/Twin-Fang/project-auto-wizard/issues/37) (통합 후 발견한 결함 묶음 트래킹 이슈)
- 참고: 이 문서는 **설계 스펙**이다. 실제 구현 순서/작업 단위는 별도 `writing-plans` 세션에서 다룬다.

## 1. 배경 — 문제 정의

`payload/workflows/flutter/PROJECT-FLUTTER-CI.yaml`의 `build-android` 잡이 keystore를 구성하지 않은 채 `flutter build apk --release`를 실행한다(현재 402~408번째 줄). `android/app/build.gradle.kts`에 릴리스 서명이 설정된 Flutter 프로젝트 — 즉 스토어 배포를 하는 거의 모든 프로젝트 — 에서 항상 실패한다.

```
FAILURE: Build failed with an exception.
> SigningConfig "release" is missing required property "storeFile".
BUILD FAILED in 7m 30s
```

Kotlin/Dart 컴파일은 전부 통과하고 패키징 단계에서만 실패하므로, 로그 앞부분만 보면 앱 코드 문제로 보여 진단이 오래 걸린다.

이 워크플로우 파일 자체의 헤더 문서(38~42번째 줄)에는 다음과 같이 명시되어 있다:

```
# 🔑 필수 GitHub Secrets
# ENV_FILE (선택): .env 파일 내용
# ※ CI는 빌드 검증 목적이므로 서명/배포 관련 Secrets 불필요
```

즉 이 워크플로우는 설계 의도상 서명 Secrets를 요구하지 않는 PR 검증용 CI인데, 실제 빌드 스텝은 서명이 필요한 `--release`를 쓰고 있어 **문서화된 설계 의도와 실제 동작이 모순**된다. 이슈 #37의 실사용자가 실제 프로젝트(`freezed`/`riverpod_generator`/`drift` 사용, 릴리스 서명 구성됨)에 v0.1.18을 통합한 뒤 재현을 확인했다.

## 2. 목표 / 비목표

**목표**: `PROJECT-FLUTTER-CI.yaml`의 Android 빌드가 서명 Secrets 없이도 항상 성공하도록, 헤더 문서에 이미 명시된 "서명/배포 Secrets 불필요" 설계 의도에 실제 빌드 커맨드를 맞춘다.

**비목표**:
- iOS 잡(`build-ios`)은 이미 `flutter build ios --release --no-codesign`으로 서명을 건너뛰고 있어 이 버그의 영향을 받지 않는다 — 변경하지 않는다.
- 다른 배포용 Flutter 워크플로우(`PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml`, `-FIREBASE-CICD.yaml`, `-ANDROID-TEST-APK.yaml`, `-ANDROID-SELFHOSTED-CICD.yaml`)는 이미 `RELEASE_KEYSTORE_BASE64`/`RELEASE_KEYSTORE_PASSWORD`/`RELEASE_KEY_ALIAS`/`RELEASE_KEY_PASSWORD` 4개 시크릿으로 keystore + `key.properties`를 올바르게 구성하고 있다 — 변경하지 않는다.
- `.github/workflows/`(이 레포 자신에게 설치된 dogfooding 산출물)에는 Flutter 관련 워크플로우가 존재하지 않는다(확인됨) — CONTRIBUTING.md가 요구하는 수동 동기화 대상이 없다.
- 이슈 #37에 함께 묶인 다른 개별 이슈(#39, #40, #41, #42)는 이 스펙의 범위 밖 — 별도 이슈에서 다룬다.
- 이 CI에서 실제 release 서명 빌드를 검증하고 싶다는 요구(이슈 제안의 대안 B)는 채택하지 않는다 — 사용자가 브레인스토밍에서 "--debug 전환" 방향을 선택했다.

## 3. 설계

### 3.1 빌드 커맨드 변경

`payload/workflows/flutter/PROJECT-FLUTTER-CI.yaml`의 `build-android` 잡, `Build APK` 스텝(현재 402~408번째 줄):

```yaml
      # APK 빌드
      - name: Build APK
        id: build
        run: |
          echo "📦 Flutter APK 빌드 시작..."
          flutter build apk --release
          echo "✅ APK 빌드 완료"
          ls -la ./build/app/outputs/flutter-apk/ || true
```

다음과 같이 변경한다:

```yaml
      # APK 빌드 (CI는 빌드 검증 목적이므로 서명 불필요한 debug 빌드 사용)
      - name: Build APK
        id: build
        run: |
          echo "📦 Flutter APK 빌드 시작 (debug)..."
          flutter build apk --debug
          echo "✅ APK 빌드 완료"
          ls -la ./build/app/outputs/flutter-apk/ || true
```

- `--release` → `--debug`만 바꾸면 서명 요구가 사라져 항상 성공한다.
- 로그 메시지에 `(debug)`를 명시해, 이후 이 파일을 보는 사람이 "release 서명이 통과했다"고 오인하지 않게 한다.
- `ls -la ./build/app/outputs/flutter-apk/` 경로는 debug/release 빌드 모두 동일한 디렉터리에 산출물을 쓰므로 변경할 필요가 없다.
- 인접한 다른 스텝(Java/Gradle 설정, 캐시, 의존성 설치 등)은 이 변경과 무관하므로 손대지 않는다.

### 3.2 왜 다른 파일을 건드릴 필요가 없는가

CONTRIBUTING.md에 따르면 `payload/workflows/`가 워크플로우의 단일 진실(source of truth)이고, `.github/workflows/`는 이 레포 자신에게 설치된 산출물이라 `payload/` 변경 후 수동 동기화가 필요하다. 그러나 `find .github/workflows -iname "*flutter*"` 결과가 0건이므로 이 레포 자체는 Flutter 프로젝트가 아니라 동기화 대상이 없다.

CHANGELOG.md는 `payload/workflows/common/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml` 워크플로우가 PR 머지 시 자동 생성하므로 수동 편집 대상이 아니다.

## 4. 테스트 계획

CONTRIBUTING.md("새 기능을 추가하거나 버그를 고칠 때는 반드시 해당 동작을 커버하는 테스트를 함께 추가")에 따라, `tests/node/payload-yaml.test.js`에 이 파일 전용 테스트를 추가한다. 이 파일은 이미 특정 워크플로우 YAML을 문자열 단언으로 검증하는 패턴(예: 92~148번째 줄의 `RELEASE-PUBLISH` 검증)을 갖고 있으므로 동일한 스타일을 따른다.

새 테스트 케이스(개념):

1. `PROJECT-FLUTTER-CI.yaml`이 존재한다 (기존 `files` 배열 활용).
2. `build-android` 잡의 빌드 커맨드가 `flutter build apk --release`를 포함하지 **않는다**(회귀 방지 — 이 이슈의 근본 원인 재발 차단).
3. `flutter build apk --debug`를 포함한다(의도한 수정이 실제로 적용됐는지 확인).

정규식이 아닌 `String.includes()`로 단순 문자열 매칭하는 기존 파일의 스타일을 따른다.

## 5. 위험 및 롤백

- 위험은 낮다: 템플릿 파일 한 줄 변경 + 텍스트 단언 테스트 추가뿐이며, 런타임 로직(`src/`, `bin/`)에는 영향이 없다.
- 이미 이 워크플로우로 설치된 기존 사용자 프로젝트는 이번 수정으로 자동 갱신되지 않는다(payload는 설치/업그레이드 시점에만 반영됨) — 이는 이 프로젝트의 기존 배포 모델이며 이 스펙의 범위 밖이다.
- 롤백은 단순 revert로 충분하다.
