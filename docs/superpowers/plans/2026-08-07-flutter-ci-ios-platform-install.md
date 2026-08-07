# Flutter CI iOS 플랫폼 설치 스텝 추가 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `payload/workflows/flutter/PROJECT-FLUTTER-CI.yaml`의 `build-ios` 잡이 iOS 플랫폼 SDK 미설치로 실패(`Platform Not Installed`)하지 않도록, 이미 검증된 `Install iOS device platform` 스텝을 이식한다.

**Architecture:** 단일 YAML 템플릿 파일의 `build-ios` 잡에 `Select Xcode version` 스텝 직후 새 스텝 하나를 삽입한다. 새 로직 없음 — `PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml`에 이미 있는 검증된 스텝을 그대로 복사한다. 테스트는 `tests/node/payload-yaml.test.js`의 기존 `String.includes()` 문자열 단언 스타일을 따른다.

**Tech Stack:** GitHub Actions YAML, Node.js 내장 테스트 러너(`node --test`).

## Global Constraints

- 스펙 문서: `docs/superpowers/specs/2026-08-07-flutter-ci-ios-platform-install-design.md`
- 수정 대상 파일은 `payload/workflows/flutter/PROJECT-FLUTTER-CI.yaml` 단 하나뿐이다 — 다른 Flutter iOS 워크플로우 파일(`PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml`, `PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml`)은 절대 수정하지 않는다.
- 삽입할 스텝 내용은 `PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml` 247~262번째 줄(`Install iOS device platform` 스텝 자체)에 이미 존재하는 스텝을 바이트 단위로 그대로 복사한다 — 새로운 셸 로직을 작성하지 않는다.
- `XCODE_VERSION` 환경변수나 다른 스텝(`.env` 생성, Flutter 설정, CocoaPods 설치 등)은 건드리지 않는다.
- 이 레포 자신의 `.github/workflows/`에는 Flutter 워크플로우가 설치되어 있지 않으므로(확인됨) 도그푸딩 동기화 작업은 없다.
- 테스트 실행 명령: `npm run test:node -- tests/node/payload-yaml.test.js` (현재 기준 21개 테스트 전부 통과 상태).

---

### Task 1: `build-ios` 잡에 iOS 플랫폼 설치 스텝 추가 + 회귀 테스트

**Files:**
- Modify: `payload/workflows/flutter/PROJECT-FLUTTER-CI.yaml:456-457` (build-ios 잡의 `Select Xcode version` 스텝 직후에 새 스텝 삽입)
- Test: `tests/node/payload-yaml.test.js` (파일 끝에 새 테스트 3개 추가)

**Interfaces:**
- Consumes: 없음 (독립 작업, 이전 태스크 없음).
- Produces: `payload/workflows/flutter/PROJECT-FLUTTER-CI.yaml`의 `build-ios` 잡에 `Install iOS device platform`이라는 이름의 새 스텝. 이후 태스크는 없음 — 이 플랜은 단일 태스크로 완결된다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/payload-yaml.test.js` 파일 끝(현재 175번째 줄, 마지막 `});` 다음)에 아래 블록을 추가한다:

```javascript

// ---------------------------------------------------------------
// #39: build-ios 잡에 iOS 플랫폼 SDK 설치 스텝이 없어 "Platform Not
// Installed"로 빌드 실패 — Select Xcode version 직후 설치 스텝 필요.
// ---------------------------------------------------------------
const flutterCiPath = join("payload", "workflows", "flutter", "PROJECT-FLUTTER-CI.yaml");

test("FLUTTER-CI exists in payload", () => {
  assert.ok(files.includes(flutterCiPath), `${flutterCiPath} missing`);
});

test("FLUTTER-CI의 build-ios 잡은 Select Xcode version 직후 iOS 플랫폼을 설치한다", () => {
  const body = readFileSync(flutterCiPath, "utf8");
  const selectXcodeIdx = body.indexOf("name: Select Xcode version");
  const installPlatformIdx = body.indexOf("name: Install iOS device platform");
  assert.ok(selectXcodeIdx > -1, "Select Xcode version 스텝을 찾지 못했습니다");
  assert.ok(installPlatformIdx > -1, "Install iOS device platform 스텝을 찾지 못했습니다");
  assert.ok(
    installPlatformIdx > selectXcodeIdx,
    "Install iOS device platform 스텝이 Select Xcode version 스텝보다 먼저 나오면 안 됩니다",
  );
});

test("FLUTTER-CI의 iOS 플랫폼 설치 스텝은 xcodebuild -downloadPlatform iOS를 실행한다", () => {
  const body = readFileSync(flutterCiPath, "utf8");
  assert.ok(body.includes("xcodebuild -downloadPlatform iOS"));
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm run test:node -- tests/node/payload-yaml.test.js`

Expected: 새로 추가한 2개 테스트(`FLUTTER-CI의 build-ios 잡은...`, `FLUTTER-CI의 iOS 플랫폼 설치 스텝은...`)가 FAIL. (`FLUTTER-CI exists in payload`는 파일이 이미 존재하므로 PASS해야 정상 — 만약 이것도 실패하면 `flutterCiPath` 경로 오타를 의심할 것.)

- [ ] **Step 3: `PROJECT-FLUTTER-CI.yaml`에 최소 구현 작성**

`payload/workflows/flutter/PROJECT-FLUTTER-CI.yaml`에서 아래 블록을 찾는다(현재 456~459번째 줄):

```yaml
      - name: Select Xcode version
        run: sudo xcode-select -s /Applications/Xcode_${{ env.XCODE_VERSION }}.app/Contents/Developer

      # .env 파일 생성
```

다음으로 교체한다(`Select Xcode version` 스텝은 그대로 두고, 그 사이에 새 스텝만 삽입):

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

      # .env 파일 생성
```

- [ ] **Step 4: 테스트가 통과하는지 확인**

Run: `npm run test:node -- tests/node/payload-yaml.test.js`

Expected: 전체 24개 테스트(기존 21개 + 신규 3개) PASS, 0 fail.

- [ ] **Step 5: 전체 테스트 스위트 실행 (회귀 확인)**

Run: `npm run test:node`

Expected: 모든 Node 테스트 PASS (다른 워크플로우 파일에 영향 없음을 확인).

- [ ] **Step 6: Commit**

```bash
git add payload/workflows/flutter/PROJECT-FLUTTER-CI.yaml tests/node/payload-yaml.test.js
git commit -m "fix: Flutter CI iOS 빌드에 플랫폼 SDK 설치 단계 추가

xcode-select만으로는 Xcode 15+ 러너에서 iOS 플랫폼 번들이 자동 설치되지
않아 'Platform Not Installed'로 빌드가 실패했다. PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml에
이미 있는 검증된 Install iOS device platform 스텝을 build-ios 잡에 이식했다.

Closes #39"
```

## Non-goals (스펙 3.2 근거, 재확인용)

- `PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml`, `PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml`은 수정하지 않는다 — 실제 빌드 잡에는 이미 이 스텝이 있고, "준비" 잡은 `xcodebuild`를 호출하지 않아 영향받지 않는다.
- 이슈 #39 후반부의 `XCODE_VERSION` 하드핀 설계 제안은 별도 이슈로 분리되어 이 플랜의 범위 밖이다.
