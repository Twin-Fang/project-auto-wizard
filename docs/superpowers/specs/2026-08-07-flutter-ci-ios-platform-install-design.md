# Flutter CI iOS 잡에 플랫폼 번들 설치 단계 없음 — 브레인스토밍 결과

- 날짜: 2026-08-07
- 상태: 브레인스토밍 완료 (사용자 승인 완료 — 구현 계획 단계로 진행)
- 이슈: [Twin-Fang/project-auto-wizard#39](https://github.com/Twin-Fang/project-auto-wizard/issues/39)
- 관련: [Twin-Fang/project-auto-wizard#37](https://github.com/Twin-Fang/project-auto-wizard/issues/37) (통합 후 발견한 결함 묶음 트래킹 이슈), [Twin-Fang/project-auto-wizard#38](https://github.com/Twin-Fang/project-auto-wizard/issues/38) (같은 파일의 Android 빌드 버그 — 별도 스펙에서 처리됨)
- 참고: 이 문서는 **설계 스펙**이다. 실제 구현 순서/작업 단위는 별도 `writing-plans` 세션에서 다룬다.

## 1. 배경 — 문제 정의

`payload/workflows/flutter/PROJECT-FLUTTER-CI.yaml`의 `build-ios` 잡(현재 456~457번째 줄)은 Xcode 버전을 선택(`xcode-select`)하기만 하고, iOS 플랫폼 SDK 번들을 설치하는 단계가 없다.

```yaml
      - name: Select Xcode version
        run: sudo xcode-select -s /Applications/Xcode_${{ env.XCODE_VERSION }}.app/Contents/Developer
```

Xcode 15부터 iOS 플랫폼이 Xcode 앱 번들과 분리된 별도 다운로드로 바뀌었기 때문에, 러너 이미지에 해당 플랫폼이 미리 설치돼 있지 않으면 빌드가 다음과 같이 실패한다.

```
Error (Xcode): iOS 26.0 Platform Not Installed.
Encountered error while building for device.
```

`macos-26-arm64` 러너 + `XCODE_VERSION: "26.0"` 조합에서 재현되었다(이슈 #39 보고자 확인).

이 저장소에는 이미 동일한 문제를 해결한 검증된 패턴이 존재한다. `payload/workflows/flutter/PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml`의 `build-ios` 잡(244~262번째 줄)과 `PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml`의 실제 빌드 잡(496~514번째 줄)에는 `Select Xcode version` 직후 `Install iOS device platform` 스텝이 있어, MobileDevice 패키지 설치 → 라이선스 동의 → `xcodebuild -downloadPlatform iOS` 순서로 플랫폼을 확실히 준비한다. `PROJECT-FLUTTER-CI.yaml`에만 이 스텝이 누락되어 있다.

## 2. 목표 / 비목표

**목표**: `PROJECT-FLUTTER-CI.yaml`의 `build-ios` 잡이 iOS 플랫폼 미설치로 실패하지 않도록, 이미 검증된 `Install iOS device platform` 스텝을 그대로 이식한다.

**비목표**:
- `PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml`, `PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml`은 변경하지 않는다 — 실제로 `xcodebuild`/`flutter build`를 호출하는 잡에는 이미 이 스텝이 있고, `xcode-select`만 있는 "준비" 잡(환경변수 파일 생성, 버전 정보 조회, 릴리즈 노트 생성 등)은 빌드를 수행하지 않아 이 버그의 영향을 받지 않는다.
- 이슈 #39 후반부의 "제안" — `XCODE_VERSION` 하드핀이 위험하다는 설계 논의(마법사 질문화, 러너 기본값 사용 등)는 이번 스펙의 범위 밖이다. 사용자와 합의된 바에 따라 별도 이슈로 분리해 다룬다. 이 스펙은 이슈 #39의 "(버그)" 섹션만 다룬다.
- `.github/workflows/`(이 레포 자신에게 설치된 dogfooding 산출물)에는 Flutter 관련 워크플로우가 존재하지 않으므로 CONTRIBUTING.md가 요구하는 수동 동기화 대상이 없다.

## 3. 설계

### 3.1 스텝 삽입

`payload/workflows/flutter/PROJECT-FLUTTER-CI.yaml`의 `build-ios` 잡, `Select Xcode version` 스텝(현재 456~457번째 줄) 바로 다음, `.env 파일 생성` 스텝(현재 459번째 줄) 이전에 아래 스텝을 삽입한다. 이 내용은 `PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml` 247~262번째 줄의 기존 `Install iOS device platform` 스텝을 그대로 복사한 것이다(새 로직 없음).

```yaml
      - name: Select Xcode version
        run: sudo xcode-select -s /Applications/Xcode_${{ env.XCODE_VERSION }}.app/Contents/Developer

      - name: Install iOS device platform
        env:
          # xcode-select만으로는 서브프로세스에 전파되지 않아 명시적으로 지정
          DEVELOPER_DIR: /Applications/Xcode_${{ env.XCODE_VERSION }}.app/Contents/Developer
        run: |
          echo "=== iPhoneOS.platform check ==="
          ls "$DEVELOPER_DIR/Platforms/iPhoneOS.platform/" 2>/dev/null && echo "iPhoneOS.platform EXISTS" || echo "iPhoneOS.platform NOT FOUND"
          echo "=== Installing MobileDevice packages ==="
          sudo installer -pkg /Applications/Xcode_${{ env.XCODE_VERSION }}.app/Contents/Resources/Packages/MobileDevice.pkg -target /
          sudo installer -pkg /Applications/Xcode_${{ env.XCODE_VERSION }}.app/Contents/Resources/Packages/MobileDeviceDevelopment.pkg -target /
          echo "=== Accepting Xcode license ==="
          sudo xcodebuild -license accept
          echo "=== Initializing Xcode components ==="
          xcrun simctl list >/dev/null 2>&1 || true
          echo "=== Downloading iOS platform ==="
          xcodebuild -downloadPlatform iOS
```

- 인접한 다른 스텝(.env 생성, Flutter 설정, CocoaPods 설치 등)은 이 변경과 무관하므로 손대지 않는다.
- `XCODE_VERSION` 환경변수 자체는 건드리지 않는다(2번 항목의 비목표).

### 3.2 왜 다른 파일을 건드릴 필요가 없는가

`PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml`의 `prepare-build` 잡(99~124번째 줄)과 `PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml`의 "테스트 빌드 준비" 잡도 `xcode-select`만 수행하고 플랫폼 설치 스텝이 없다. 그러나 두 잡 모두 `xcodebuild`나 `flutter build`를 호출하지 않는다(환경변수 파일 생성, `version_manager.py`로 버전 조회, 릴리즈 노트 생성만 수행) — 실제 빌드는 각각 별도의 `build-ios` 잡에서 일어나고, 그 잡들에는 이미 `Install iOS device platform` 스텝이 있다. 따라서 이 두 "준비" 잡의 `xcode-select` 호출은 이 이슈의 버그와 무관하며 수정 대상이 아니다.

## 4. 테스트 계획

`tests/node/payload-yaml.test.js`의 기존 스타일(정규식이 아닌 `String.includes()` 문자열 단언, 예: 97~147번째 줄의 `RELEASE-PUBLISH` 검증)을 따라 이 파일 전용 테스트를 추가한다.

새 테스트 케이스(개념):

1. `PROJECT-FLUTTER-CI.yaml`이 존재한다 (기존 `files` 배열 활용).
2. `build-ios` 잡 안에서 `Install iOS device platform` 스텝이 `Select Xcode version` 스텝보다 뒤에 나온다(순서 회귀 방지 — `indexOf` 비교).
3. 본문에 `xcodebuild -downloadPlatform iOS`가 포함된다(의도한 수정이 실제로 적용됐는지 확인).

## 5. 위험 및 롤백

- 위험은 낮다: 이미 다른 두 워크플로우 파일에서 실사용 중인 스텝을 그대로 복사하는 템플릿 파일 변경 + 텍스트 단언 테스트 추가뿐이며, 런타임 로직(`src/`, `bin/`)에는 영향이 없다.
- 이미 이 워크플로우로 설치된 기존 사용자 프로젝트는 이번 수정으로 자동 갱신되지 않는다(payload는 설치/업그레이드 시점에만 반영됨) — 이는 이 프로젝트의 기존 배포 모델이며 이 스펙의 범위 밖이다.
- 롤백은 단순 revert로 충분하다.
