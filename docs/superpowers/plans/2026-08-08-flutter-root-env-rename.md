# FLUTTER_ROOT → FLUTTER_PROJECT_DIR 개명 (이슈 #50) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml`와 `PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml`의 `FLUTTER_ROOT` 환경변수를 `FLUTTER_PROJECT_DIR`로 개명해 `subosito/flutter-action`의 SDK 경로 export와의 이름 충돌을 제거하고, 두 파일의 모든 `upload-artifact` 스텝에 `if-no-files-found: error`를 추가해 경로가 비는 이 버그 클래스를 빌드 잡 단계에서 즉시 드러나게 한다.

**Architecture:** 순수 텍스트 치환 + 회귀 테스트 추가. 런타임 로직(`src/`, `bin/`) 변경 없음 — `# @wizard auto:flutter-root` 마커의 리졸버 이름은 YAML 키 텍스트와 분리되어 있어 그대로 유지된다(스펙 2절에서 확인 완료).

**Tech Stack:** GitHub Actions YAML, Node.js `node:test` (기존 `tests/node/payload-yaml.test.js` 패턴).

## Global Constraints

- 변경 대상은 정확히 2개 파일: `payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml`, `payload/workflows/flutter/PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml`. 다른 5개 flutter 워크플로우 파일은 `FLUTTER_ROOT`를 정의/참조하지 않으므로 건드리지 않는다.
- 새 환경변수 이름은 `FLUTTER_PROJECT_DIR` (이슈 원안 그대로, 변경 금지).
- `# @wizard auto:flutter-root` 마커 주석은 **절대 변경하지 않는다** — 리졸버 이름은 YAML 키와 무관하다.
- `src/core/wizard-env.js`, `src/core/detect-fs.js` 등 `src/` 하위 파일은 이 플랜에서 수정하지 않는다.
- "Upload project files" 스텝의 `path:`(모노레포 경로 미접두 문제)는 이슈 #50과 무관한 별개 버그이므로 고치지 않는다 — 범위 밖.
- 커밋 메시지는 이 레포 `CLAUDE.md` 규칙에 따라 한국어로 작성한다(Conventional Commits 타입 접두사는 영어 유지).
- 각 태스크 종료 시 `npm test`로 검증한다 (레포 루트에서 실행).

---

### Task 1: 이슈 #50 회귀 테스트 작성 (RED)

**Files:**
- Modify: `tests/node/payload-yaml.test.js` (파일 끝에 추가, 389번째 줄 이후)

**Interfaces:**
- Consumes: 파일 상단에 이미 정의된 `flutterPlaystoreCicdPath`(342~345번째 줄), `flutterIosTestflightPath`(373~376번째 줄) 상수. 재정의하지 말고 그대로 재사용한다.
- Produces: `assertFlutterRootRenamedToProjectDir(path)`, `assertUploadArtifactStepsFailOnMissingFiles(path)` 헬퍼 함수 — Task 2·3에서 수정한 파일이 이 두 헬퍼를 통과해야 한다.

- [ ] **Step 1: 테스트 파일 끝에 두 헬퍼 함수와 4개 테스트를 추가한다**

`tests/node/payload-yaml.test.js` 파일 맨 끝(389번째 줄, 마지막 `test(...)` 블록 다음)에 아래 코드를 그대로 추가한다:

```js

// ---------------------------------------------------------------
// #50: FLUTTER_ROOT가 subosito/flutter-action의 SDK 경로 export와
// 이름이 충돌해 아티팩트 경로가 SDK 디렉토리를 가리키고, 업로드가
// 비어 배포 잡이 실패한다. FLUTTER_PROJECT_DIR로 개명하고, 경로가
// 비었을 때 즉시 실패하도록 모든 upload-artifact 스텝에
// if-no-files-found: error를 강제한다.
// ---------------------------------------------------------------
function assertFlutterRootRenamedToProjectDir(path) {
  const body = readFileSync(path, "utf8");
  assert.ok(
    !body.includes("FLUTTER_ROOT"),
    `${path}: FLUTTER_ROOT가 남아있으면 subosito/flutter-action의 SDK 경로 export와 충돌합니다`
  );
  assert.ok(
    /^\s*FLUTTER_PROJECT_DIR:\s*"\."/m.test(body),
    `${path}: FLUTTER_PROJECT_DIR env 정의를 찾지 못했습니다`
  );
}

function assertUploadArtifactStepsFailOnMissingFiles(path) {
  const body = readFileSync(path, "utf8");
  const steps = body.split(/\n(?=      - name: )/);
  const uploadSteps = steps.filter((s) => s.includes("uses: actions/upload-artifact"));
  assert.ok(uploadSteps.length > 0, `${path}: upload-artifact 스텝을 찾지 못했습니다`);
  for (const step of uploadSteps) {
    const stepName = (step.match(/^ {6}- name: (.+)$/m) || [, "(이름 없음)"])[1];
    assert.ok(
      step.includes("if-no-files-found: error"),
      `${path}: '${stepName}' 스텝에 if-no-files-found: error가 없습니다`
    );
  }
}

test("PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD: FLUTTER_ROOT가 FLUTTER_PROJECT_DIR로 개명되었다 (#50)", () => {
  assertFlutterRootRenamedToProjectDir(flutterPlaystoreCicdPath);
});

test("PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD: upload-artifact 스텝 전부가 if-no-files-found: error를 지정한다 (#50)", () => {
  assertUploadArtifactStepsFailOnMissingFiles(flutterPlaystoreCicdPath);
});

test("PROJECT-FLUTTER-IOS-TESTFLIGHT: FLUTTER_ROOT가 FLUTTER_PROJECT_DIR로 개명되었다 (#50)", () => {
  assertFlutterRootRenamedToProjectDir(flutterIosTestflightPath);
});

test("PROJECT-FLUTTER-IOS-TESTFLIGHT: upload-artifact 스텝 전부가 if-no-files-found: error를 지정한다 (#50)", () => {
  assertUploadArtifactStepsFailOnMissingFiles(flutterIosTestflightPath);
});
```

- [ ] **Step 2: 새로 추가한 4개 테스트가 실패하는지 확인한다**

Run: `node --test tests/node/payload-yaml.test.js`
Expected: 방금 추가한 4개 테스트 모두 FAIL (`FLUTTER_ROOT`가 아직 남아있고, `if-no-files-found: error`가 아직 없으므로). 기존 테스트들은 그대로 PASS해야 한다.

- [ ] **Step 3: 커밋**

```bash
git add tests/node/payload-yaml.test.js
git commit -m "$(cat <<'EOF'
test: 이슈 #50 FLUTTER_ROOT 개명 회귀 테스트 추가 (RED)

FLUTTER_ROOT가 FLUTTER_PROJECT_DIR로 개명되고 upload-artifact
스텝 전부에 if-no-files-found: error가 있는지 검증하는 테스트를
먼저 추가. 아직 YAML을 고치지 않았으므로 4개 테스트는 실패한다.
EOF
)"
```

---

### Task 2: PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml 수정

**Files:**
- Modify: `payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml`

**Interfaces:**
- Consumes: Task 1에서 작성한 `assertFlutterRootRenamedToProjectDir`/`assertUploadArtifactStepsFailOnMissingFiles` 테스트 (이 파일 대상 2개가 통과해야 한다).
- Produces: 없음 (다음 태스크는 iOS 파일 독립 작업).

- [ ] **Step 1: `FLUTTER_ROOT`를 `FLUTTER_PROJECT_DIR`로 전부 치환한다**

이 파일에는 `FLUTTER_ROOT`가 정확히 8곳(env 정의 1곳, `working-directory: ${{ env.FLUTTER_ROOT }}` 참조 4곳, AAB 업로드/다운로드 `path:` 2곳, 한글 주석 1곳) 있고, 다른 의미로 쓰이는 곳이 없으므로 리터럴 전체 치환으로 안전하다.

Run:
```bash
sed -i '' 's/FLUTTER_ROOT/FLUTTER_PROJECT_DIR/g' payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml
```

- [ ] **Step 2: 치환이 완전한지, 마커 주석이 안 깨졌는지 확인한다**

Run:
```bash
grep -c "FLUTTER_ROOT" payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml
grep -n "FLUTTER_PROJECT_DIR" payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml | head -1
```
Expected:
- 첫 번째 명령: `0` (더 이상 `FLUTTER_ROOT` 없음)
- 두 번째 명령 결과 첫 줄: `50:  FLUTTER_PROJECT_DIR: "."  # @wizard auto:flutter-root` — 마커의 리졸버 이름(`flutter-root`, 소문자+하이픈)은 그대로 남아있어야 한다(의도된 것).

- [ ] **Step 3: "Upload release notes" 스텝에 `if-no-files-found: error`를 추가한다**

`payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml`에서:

```yaml
      - name: Upload release notes
        uses: actions/upload-artifact@v7
        with:
          name: release-notes
          path: final_release_notes.txt
          retention-days: 1
```

를 다음으로 교체:

```yaml
      - name: Upload release notes
        uses: actions/upload-artifact@v7
        with:
          name: release-notes
          path: final_release_notes.txt
          retention-days: 1
          if-no-files-found: error
```

- [ ] **Step 4: "Upload project files" 스텝에 `if-no-files-found: error`를 추가한다**

같은 파일에서:

```yaml
      - name: Upload project files
        uses: actions/upload-artifact@v7
        with:
          name: project-files
          path: |
            pubspec.yaml
            lib/
            assets/
          retention-days: 1
```

를 다음으로 교체:

```yaml
      - name: Upload project files
        uses: actions/upload-artifact@v7
        with:
          name: project-files
          path: |
            pubspec.yaml
            lib/
            assets/
          retention-days: 1
          if-no-files-found: error
```

- [ ] **Step 5: "Upload AAB artifact" 스텝에 `if-no-files-found: error`를 추가한다**

같은 파일에서(Step 1의 치환으로 `FLUTTER_ROOT`는 이미 `FLUTTER_PROJECT_DIR`로 바뀌어 있다):

```yaml
      - name: Upload AAB artifact
        uses: actions/upload-artifact@v7
        with:
          name: android-aab
          path: ${{ env.FLUTTER_PROJECT_DIR }}/build/app/outputs/bundle/release/app-release.aab
          retention-days: 1
```

를 다음으로 교체:

```yaml
      - name: Upload AAB artifact
        uses: actions/upload-artifact@v7
        with:
          name: android-aab
          path: ${{ env.FLUTTER_PROJECT_DIR }}/build/app/outputs/bundle/release/app-release.aab
          retention-days: 1
          if-no-files-found: error
```

- [ ] **Step 6: 이 파일 대상 테스트 2개가 통과하는지 확인한다**

Run: `node --test tests/node/payload-yaml.test.js`
Expected: `PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD` 관련 테스트(Task 1에서 추가한 4개 중 2개, 그리고 `#40`/`#42` 기존 테스트)가 모두 PASS. `PROJECT-FLUTTER-IOS-TESTFLIGHT` 관련 2개는 아직 FAIL(다음 태스크 대상)이어야 한다.

- [ ] **Step 7: 커밋**

```bash
git add payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml
git commit -m "$(cat <<'EOF'
fix: Android Play Store 배포 워크플로우 FLUTTER_ROOT 이름 충돌 수정

FLUTTER_ROOT가 subosito/flutter-action이 내보내는 SDK 경로와
이름이 같아 아티팩트 경로가 SDK 디렉토리를 가리키던 문제를
FLUTTER_PROJECT_DIR로 개명해 해결. 아티팩트 업로드 3곳에는
if-no-files-found: error를 추가해 경로가 비면 빌드 잡에서 즉시
실패하도록 함.

https://github.com/Twin-Fang/project-auto-wizard/issues/50
EOF
)"
```

---

### Task 3: PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml 수정

**Files:**
- Modify: `payload/workflows/flutter/PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml`

**Interfaces:**
- Consumes: Task 1에서 작성한 두 헬퍼 함수(이 파일 대상 2개 테스트가 통과해야 한다).
- Produces: 없음 (이 태스크로 이슈 #50의 YAML 변경이 완료된다).

- [ ] **Step 1: `FLUTTER_ROOT`를 `FLUTTER_PROJECT_DIR`로 전부 치환한다**

이 파일에는 `FLUTTER_ROOT`가 정확히 9곳 있다: env 정의 1곳, `working-directory: ${{ env.FLUTTER_ROOT }}` 참조 4곳, IPA 업로드/다운로드 `path:` 2곳, **셸 레벨** `${FLUTTER_ROOT}` 1곳(435번째 줄 — `run:` 블록 안 bash 변수, `${{ }}` GH Actions 표현식이 아니다), 한글 주석 1곳. `sed`의 리터럴 문자열 치환은 `${{ env.FLUTTER_ROOT }}`와 `${FLUTTER_ROOT}` 양쪽 형태 모두 동일하게 잡아낸다(둘 다 `FLUTTER_ROOT`라는 부분 문자열을 포함하므로).

Run:
```bash
sed -i '' 's/FLUTTER_ROOT/FLUTTER_PROJECT_DIR/g' payload/workflows/flutter/PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml
```

- [ ] **Step 2: 치환이 완전한지, 셸 변수와 마커 주석이 올바른지 확인한다**

Run:
```bash
grep -c "FLUTTER_ROOT" payload/workflows/flutter/PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml
grep -n "FLUTTER_PROJECT_DIR" payload/workflows/flutter/PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml | head -1
grep -n '\${FLUTTER_PROJECT_DIR}' payload/workflows/flutter/PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml
```
Expected:
- 첫 번째 명령: `0`
- 두 번째 명령 결과 첫 줄: `78:  FLUTTER_PROJECT_DIR: "."  # @wizard auto:flutter-root`
- 세 번째 명령: 435번째 줄이 출력되어야 한다 — `IPA_PATH=$(find "$GITHUB_WORKSPACE/${FLUTTER_PROJECT_DIR}/ios/build/ipa" -name "*.ipa" | head -1)` 형태로 셸 변수도 정상 치환됐는지 육안 확인.

- [ ] **Step 3: "Upload release notes" 스텝에 `if-no-files-found: error`를 추가한다**

`payload/workflows/flutter/PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml`에서:

```yaml
      - name: Upload release notes
        uses: actions/upload-artifact@v7
        with:
          name: release-notes
          path: final_release_notes.txt
          retention-days: 1
```

를 다음으로 교체:

```yaml
      - name: Upload release notes
        uses: actions/upload-artifact@v7
        with:
          name: release-notes
          path: final_release_notes.txt
          retention-days: 1
          if-no-files-found: error
```

- [ ] **Step 4: "Upload project files" 스텝에 `if-no-files-found: error`를 추가한다**

같은 파일에서:

```yaml
      - name: Upload project files
        uses: actions/upload-artifact@v7
        with:
          name: project-files
          path: |
            ${{ env.ENV_FILE_PATH }}
            ios/Flutter/Secrets.xcconfig
            pubspec.yaml
            lib/
            assets/
          retention-days: 1
```

를 다음으로 교체:

```yaml
      - name: Upload project files
        uses: actions/upload-artifact@v7
        with:
          name: project-files
          path: |
            ${{ env.ENV_FILE_PATH }}
            ios/Flutter/Secrets.xcconfig
            pubspec.yaml
            lib/
            assets/
          retention-days: 1
          if-no-files-found: error
```

- [ ] **Step 5: "Upload IPA artifact" 스텝에 `if-no-files-found: error`를 추가한다**

같은 파일에서(Step 1의 치환으로 `FLUTTER_ROOT`는 이미 `FLUTTER_PROJECT_DIR`로 바뀌어 있다):

```yaml
      - name: Upload IPA artifact
        uses: actions/upload-artifact@v7
        with:
          name: ios-ipa
          path: ${{ env.FLUTTER_PROJECT_DIR }}/ios/build/ipa/*.ipa
          retention-days: 1
```

를 다음으로 교체:

```yaml
      - name: Upload IPA artifact
        uses: actions/upload-artifact@v7
        with:
          name: ios-ipa
          path: ${{ env.FLUTTER_PROJECT_DIR }}/ios/build/ipa/*.ipa
          retention-days: 1
          if-no-files-found: error
```

- [ ] **Step 6: 전체 테스트 스위트가 통과하는지 확인한다**

Run: `npm test`
Expected: 전체 스위트 PASS (Task 1에서 추가한 4개 포함, `#38`/`#39`/`#40`/`#42` 기존 회귀 테스트 전부 포함). 하나라도 FAIL하면 다음 태스크로 넘어가지 않는다.

- [ ] **Step 7: 레포 전체에서 `FLUTTER_ROOT` 잔존이 없는지 최종 확인한다**

`tests/`는 검색 범위에서 **제외한다** — Task 1에서 추가한 회귀 테스트 자체가 주석·단언문·테스트 이름에 리터럴 `FLUTTER_ROOT` 문자열을 의도적으로 포함하므로(예: `!body.includes("FLUTTER_ROOT")`, "FLUTTER_ROOT가 FLUTTER_PROJECT_DIR로 개명되었다"), `tests/`를 포함해 검색하면 그 코드 자체가 매치되어 오탐한다.

Run:
```bash
grep -rn "FLUTTER_ROOT" payload/ src/ .github/ 2>/dev/null
```
Expected: 출력 없음(exit code 1). `flutter-root`(소문자, 리졸버 이름)는 검색 대상에 없으므로 매치되지 않는다.

- [ ] **Step 8: 커밋**

```bash
git add payload/workflows/flutter/PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml
git commit -m "$(cat <<'EOF'
fix: iOS TestFlight 배포 워크플로우 FLUTTER_ROOT 이름 충돌 수정

FLUTTER_ROOT가 subosito/flutter-action이 내보내는 SDK 경로와
이름이 같아 아티팩트 경로가 SDK 디렉토리를 가리키던 문제를
FLUTTER_PROJECT_DIR로 개명해 해결(run: 블록 안 셸 변수 참조 포함).
아티팩트 업로드 3곳에는 if-no-files-found: error를 추가해 경로가
비면 빌드 잡에서 즉시 실패하도록 함.

https://github.com/Twin-Fang/project-auto-wizard/issues/50
EOF
)"
```

---

## Spec Coverage Checklist (self-review 완료)

- 목표 1 (17곳 개명): Task 2 Step 1(8곳) + Task 3 Step 1(9곳) — 커버.
- 목표 2 (upload-artifact 6곳에 if-no-files-found): Task 2 Step 3~5(3곳) + Task 3 Step 3~5(3곳) — 커버.
- 목표 3 (회귀 테스트): Task 1 — 커버.
- 마법사 엔진 미변경 확인: Global Constraints에 명시, Task 2/3 Step 2에서 마커 주석 보존을 육안 확인 — 커버.
- 비목표(모노레포 project-files 경로 버그 미수정, download-artifact 미변경, src/ 미변경): Global Constraints에 명시 — 커버.
