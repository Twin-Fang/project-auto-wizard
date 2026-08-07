# Flutter CI Android Debug 빌드 전환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `payload/workflows/flutter/PROJECT-FLUTTER-CI.yaml`의 Android 빌드가 keystore 없이도 항상 성공하도록 `flutter build apk --release`를 `--debug`로 바꾸고, 회귀를 막는 테스트를 추가한다.

**Architecture:** 순수 템플릿(YAML) 문자열 변경 1건 + 기존 `tests/node/payload-yaml.test.js`의 string-includes 검증 패턴을 그대로 따르는 테스트 3건 추가. 런타임 코드(`src/`, `bin/`)는 전혀 건드리지 않는다.

**Tech Stack:** Node.js `node:test` + `node:assert`(strict) — 이 저장소의 기존 테스트 스택 그대로 사용. 외부 의존성 추가 없음.

## Global Constraints

- 스펙 문서: `docs/superpowers/specs/2026-08-07-flutter-ci-android-debug-build-design.md` (커밋됨) — 이 계획과 상충하면 스펙이 우선한다.
- 이슈: https://github.com/Twin-Fang/project-auto-wizard/issues/38
- `payload/workflows/`가 워크플로우의 단일 진실(source of truth)이다 (`CONTRIBUTING.md`).
- 이 레포의 `.github/workflows/`에는 Flutter 관련 워크플로우가 없으므로(확인됨) 도그푸딩 동기화 대상이 없다 — 건드리지 않는다.
- `payload/workflows/flutter/PROJECT-FLUTTER-CI.yaml`의 `build-ios` 잡, 그리고 다른 모든 Flutter 워크플로우 파일(`PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml` 등)은 이 계획의 범위 밖 — 변경하지 않는다.
- CHANGELOG.md는 자동 생성되므로 수동 편집하지 않는다.
- Node 쪽(`src/`, `bin/`, `tests/`)은 외부 의존성을 추가하지 않는다(`CONTRIBUTING.md`) — `node:test`/`node:assert`/`node:fs`/`node:path`만 사용.
- 커밋 메시지는 Conventional Commits 타입 접두사(영어) + 한국어 설명 (`CLAUDE.md`, `CONTRIBUTING.md`).

---

## Task 1: Flutter CI Android 빌드를 debug로 전환 + 회귀 테스트 추가

**Files:**
- Modify: `payload/workflows/flutter/PROJECT-FLUTTER-CI.yaml` (약 401~408번째 줄, `build-android` 잡의 `Build APK` 스텝)
- Modify: `tests/node/payload-yaml.test.js` (파일 끝, 175번째 줄 이후에 새 섹션 추가)

**Interfaces:**
- 이 계획에는 Task가 하나뿐이므로 다른 태스크와의 인터페이스 없음.
- `tests/node/payload-yaml.test.js`가 이미 파일 상단(1~8번째 줄)에서 export하는 것은 없지만, 모듈 스코프에 정의해 재사용하는 `files` 배열(6~8번째 줄, `payload/workflows` 하위 전체 `.yaml`/`.yml` 목록)과 `join`(from `node:path`)/`readFileSync`(from `node:fs`)를 그대로 사용한다. 새 변수명은 기존 파일의 `changelogPath`/`releasePath` 네이밍 컨벤션을 따라 `flutterCiPath`로 짓는다.

- [ ] **Step 1: 실패하는 테스트를 먼저 작성한다**

  `tests/node/payload-yaml.test.js` 파일의 정확히 마지막 블록(175번째 줄에서 끝나는 아래 테스트)을 찾는다:

  ```js
  test("RELEASE-PUBLISH의 도그푸딩 사본도 같은 토큰 폴백을 쓴다", () => {
    const text = readFileSync(join(".github", "workflows", "PROJECT-COMMON-RELEASE-PUBLISH.yaml"), "utf8");
    const idx = text.indexOf("name: Create GitHub Release");
    assert.ok(idx > -1, "Create GitHub Release 스텝을 찾지 못했습니다");
    const block = text.slice(idx, idx + 700);
    assert.match(block, /GH_TOKEN:\s*\$\{\{\s*secrets\.WORKFLOW_PAT\s*\|\|\s*github\.token\s*\}\}/);
  });
  ```

  이 블록 바로 뒤(파일 맨 끝)에 아래 섹션을 그대로 추가한다:

  ```js

  // ---------------------------------------------------------------
  // PROJECT-FLUTTER-CI: Android 빌드는 서명 불필요한 debug APK를 사용해야
  // 한다 (issue #38 — keystore 없이 --release 실행 시 release 서명이
  // 구성된 프로젝트에서 항상 빌드 실패)
  // ---------------------------------------------------------------
  const flutterCiPath = join(
    "payload/workflows/flutter",
    "PROJECT-FLUTTER-CI.yaml"
  );

  test("PROJECT-FLUTTER-CI exists in payload", () => {
    assert.ok(files.includes(flutterCiPath), `${flutterCiPath} missing`);
  });

  test("PROJECT-FLUTTER-CI의 Android 빌드는 --release를 사용하지 않는다", () => {
    const body = readFileSync(flutterCiPath, "utf8");
    assert.ok(
      !body.includes("flutter build apk --release"),
      "keystore 없이 --release로 빌드하면 release 서명이 구성된 프로젝트에서 항상 실패한다"
    );
  });

  test("PROJECT-FLUTTER-CI의 Android 빌드는 --debug를 사용한다", () => {
    const body = readFileSync(flutterCiPath, "utf8");
    assert.ok(body.includes("flutter build apk --debug"));
  });
  ```

- [ ] **Step 2: 테스트를 실행해 실패를 확인한다**

  Run: `node --test tests/node/payload-yaml.test.js`

  Expected: 새로 추가한 3개 테스트 중
  - `PROJECT-FLUTTER-CI exists in payload` → PASS (파일은 이미 존재하므로)
  - `PROJECT-FLUTTER-CI의 Android 빌드는 --release를 사용하지 않는다` → **FAIL** (현재 파일이 `flutter build apk --release`를 포함하고 있으므로)
  - `PROJECT-FLUTTER-CI의 Android 빌드는 --debug를 사용한다` → **FAIL** (현재 파일에 `flutter build apk --debug`가 없으므로)

  다른 기존 테스트는 전부 그대로 PASS해야 한다(회귀 없음 확인).

- [ ] **Step 3: `payload/workflows/flutter/PROJECT-FLUTTER-CI.yaml`을 수정해 테스트를 통과시킨다**

  `build-android` 잡의 `Build APK` 스텝에서 아래 블록을 찾는다:

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

  아래로 정확히 치환한다(주석 텍스트, 로그 메시지, 빌드 커맨드 3곳 모두 변경):

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

  파일 내 다른 곳(`build-ios` 잡, 헤더 주석, 다른 잡)은 전혀 수정하지 않는다.

- [ ] **Step 4: 테스트를 다시 실행해 통과를 확인한다**

  Run: `node --test tests/node/payload-yaml.test.js`

  Expected: 새로 추가한 3개 테스트 전부 PASS, 기존 테스트도 전부 PASS.

- [ ] **Step 5: 전체 Node 테스트 스위트를 실행해 다른 회귀가 없는지 확인한다**

  Run: `npm run test:node`

  Expected: 전체 PASS (`tests/node/` 하위 모든 테스트 파일 포함). 이 변경은 `payload/workflows/flutter/PROJECT-FLUTTER-CI.yaml`과 `tests/node/payload-yaml.test.js`만 건드리므로 다른 테스트 파일에는 영향이 없어야 한다.

- [ ] **Step 6: 커밋한다**

  ```bash
  git add payload/workflows/flutter/PROJECT-FLUTTER-CI.yaml tests/node/payload-yaml.test.js
  git commit -m "$(cat <<'EOF'
  fix: Flutter CI Android 빌드가 keystore 없이 --release로 실패하던 문제 수정 (#38)

  PROJECT-FLUTTER-CI.yaml은 문서상 서명/배포 Secrets가 불필요한 PR 검증용
  CI인데 flutter build apk --release를 실행해, release 서명이 구성된
  프로젝트에서 항상 빌드가 실패했다. --debug로 전환하고 회귀 테스트를
  추가했다.
  EOF
  )"
  ```

---

## Self-Review Notes (writing-plans 단계에서 수행)

- **스펙 커버리지**: 스펙 3.1(빌드 커맨드 변경) → Step 3에서 구현. 스펙 4절(테스트 계획 3건) → Step 1에서 정확히 3개 테스트로 구현. 스펙 3.2/비목표(다른 파일 변경 없음) → Global Constraints와 Files 섹션에 명시. 갭 없음.
- **플레이스홀더 스캔**: "TBD"/"나중에"/"적절히 처리" 류 표현 없음. 모든 코드 블록이 실제로 붙여넣을 수 있는 완성된 텍스트임.
- **타입/네이밍 일관성**: `flutterCiPath` 변수명이 Step 1 선언과 이후 두 테스트에서 동일하게 사용됨. Task가 하나뿐이라 태스크 간 시그니처 불일치 위험 없음.
