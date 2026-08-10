# Flutter 워크플로우 build_runner 코드 생성 단계 추가 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `payload/workflows/flutter/` 아래 7개 워크플로우 파일, 총 14곳의 `flutter pub get` 직후에 `build_runner` 조건부 코드 생성 단계를 추가해, `freezed`/`riverpod_generator`/`drift`/`json_serializable`을 쓰는 Flutter 프로젝트의 CI가 생성 파일(`*.g.dart`/`*.freezed.dart`) 부재로 실패하지 않게 한다.

**Architecture:** 순수 템플릿(YAML) 문자열 삽입 14건(7개 파일) + 기존 `tests/node/payload-yaml.test.js`의 정규식 카운트 비교 패턴을 따르는 회귀 테스트 7건(파일당 1개) 추가. 런타임 코드(`src/`, `bin/`)는 전혀 건드리지 않는다. 파일마다 독립적인 태스크로 분리해 파일 하나씩 TDD 사이클(실패하는 테스트 → 구현 → 통과 확인 → 커밋)을 돈다.

**Tech Stack:** Node.js `node:test` + `node:assert`(strict) — 이 저장소의 기존 테스트 스택 그대로 사용. 외부 의존성 추가 없음.

## Global Constraints

- 스펙 문서: `docs/superpowers/specs/2026-08-08-flutter-build-runner-codegen-design.md` (커밋됨) — 이 계획과 상충하면 스펙이 우선한다.
- 이슈: https://github.com/Twin-Fang/project-auto-wizard/issues/42
- `payload/workflows/`가 워크플로우의 단일 진실(source of truth)이다(`CONTRIBUTING.md`).
- 삽입할 조건부 블록은 항상 다음 두 줄(들여쓰기 제외)이다:
  ```
  if grep -q "build_runner" pubspec.yaml; then
    dart run build_runner build --delete-conflicting-outputs
  fi
  ```
  `pubspec.yaml` 파싱을 `yq` 등으로 정교화하지 않는다 — 이슈 제안 그대로 채택(사용자 확정).
- 삽입 위치는 항상 "`flutter pub get` 명령이 있는 줄의 바로 다음 줄"이며, 그 스텝의 `run: |` 블록 스칼라와 **동일한 들여쓰기**를 유지해야 한다. 들여쓰기가 어긋나면 기존 `tests/node/payload-yaml.test.js`의 `findBlockScalarIndentationViolations` 회귀 가드(#40)가 실패한다.
- 세 형태(A/B/C) 모두 삽입 스니펫은 완전히 동일하다 — 로그 라인을 추가하지 않는다. 이슈 제안에 없는 로그 추가는 최소 변경 원칙에 어긋난다(스펙 4.2절).
- `PROJECT-FLUTTER-SUH-LAB-APP-BUILD-TRIGGER.yaml`(`flutter pub get` 0곳, 디스패처 워크플로우)은 범위 밖 — 건드리지 않는다.
- 이 계획에 포함된 7개 파일 외 다른 Flutter 워크플로우 파일이나 다른 워크플로우(`payload/workflows/common/` 등)는 범위 밖 — 건드리지 않는다.
- 이 레포의 `.github/workflows/`에는 Flutter 관련 워크플로우가 없으므로(확인됨) 도그푸딩 동기화 대상이 없다 — 건드리지 않는다.
- CHANGELOG.md는 자동 생성되므로 수동 편집하지 않는다.
- Node 쪽(`tests/`)은 외부 의존성을 추가하지 않는다(`CONTRIBUTING.md`) — `node:test`/`node:assert`/`node:fs`/`node:path`만 사용.
- 커밋 메시지는 Conventional Commits 타입 접두사(영어) + 한국어 설명(`CLAUDE.md`, `CONTRIBUTING.md`).
- 각 태스크가 끝난 뒤 `node --test tests/node/payload-yaml.test.js`를 실행해 새 테스트와 기존 테스트가 모두 통과하는지 확인한다. 마지막 태스크 뒤에는 `npm run test:node` 전체를 한 번 더 실행한다.
- **브랜치 전략**: `CONTRIBUTING.md`는 `develop` 브랜치에서 분기해 `develop`으로 PR을 열라고 명시하지만, `origin/develop`이 `origin/main`보다 크게 뒤처져 있고(v0.1.26 vs v0.1.29) 이 계획과 같은 트래킹 이슈(#37)에 묶인 최근 형제 이슈 #39/#40/#41이 모두 `worktree-*` 브랜치로 `main`에서 분기해 `main`으로 PR·머지된 실제 선례가 있다(`gh pr list --state merged`로 확인). 이 계획은 그 최근 실제 관행을 따라 **`main` 기준으로 분기하고 `main`으로 PR을 연다.**
- **Edit 시 `replace_all` 주의**: Task 1(`PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml`), Task 2(`PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml`), Task 6(`PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml`)은 형태 A의 동일한 2줄 old_string이 파일 안에 정확히 2번씩 등장한다(각 파일의 두 위치 모두 텍스트가 완전히 동일). 문자열 치환 도구로 수정할 때 두 곳 모두 동일한 new_string으로 바꿔야 하므로 `replace_all: true`(또는 동등한 일괄 치환 옵션)를 사용한다 — 유일하지 않은 old_string으로 일반 치환을 시도하면 도구가 거부하거나 첫 번째 위치만 바뀐다.

---

## Task 1: `PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml` (3곳 — 형태 A ×2, 형태 C ×1)

**Files:**
- Modify: `payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml` (115번째 줄, 268번째 줄, 330번째 줄)
- Modify: `tests/node/payload-yaml.test.js` (파일 끝에 새 섹션 추가)

**Interfaces:**
- `tests/node/payload-yaml.test.js` 상단(6~8번째 줄)에 이미 정의된 `files` 배열, `join`(`node:path`)/`readFileSync`(`node:fs`)를 재사용한다. 새 경로 상수는 기존 `flutterCiPath`(272번째 줄) 네이밍 컨벤션을 따라 `flutterFirebaseCicdPath`로 짓는다.

- [ ] **Step 1: 실패하는 테스트를 먼저 작성한다**

  `tests/node/payload-yaml.test.js` 파일 맨 끝(현재 313번째 줄, `xcodebuild -downloadPlatform iOS` 테스트 다음)에 아래 섹션을 추가한다:

  ```js

  // ---------------------------------------------------------------
  // #42: build_runner를 쓰는 프로젝트(freezed/riverpod_generator/drift/
  // json_serializable)가 CI에서 생성 파일(*.g.dart/*.freezed.dart) 부재로
  // 실패하지 않도록, flutter pub get 직후 조건부 코드 생성이 있어야 한다.
  // ---------------------------------------------------------------
  function assertBuildRunnerGuardFollowsEveryPubGet(path) {
    const body = readFileSync(path, "utf8");
    const pattern = /flutter pub get\n( *)if grep -q "build_runner" pubspec\.yaml; then\n *dart run build_runner build --delete-conflicting-outputs\n *fi/g;
    const matches = body.match(pattern) || [];
    const pubGetCount = (body.match(/flutter pub get/g) || []).length;
    assert.strictEqual(
      matches.length,
      pubGetCount,
      `${path}: flutter pub get가 ${pubGetCount}곳인데 build_runner 조건부 코드 생성 가드는 ${matches.length}곳뿐입니다`
    );
    assert.ok(pubGetCount > 0, `${path}: flutter pub get이 존재해야 합니다`);
  }

  const flutterFirebaseCicdPath = join(
    "payload/workflows/flutter",
    "PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml"
  );

  test("PROJECT-FLUTTER-ANDROID-FIREBASE-CICD: flutter pub get 직후 build_runner 조건부 코드 생성이 있다 (#42)", () => {
    assertBuildRunnerGuardFollowsEveryPubGet(flutterFirebaseCicdPath);
  });
  ```

  주의: `assertBuildRunnerGuardFollowsEveryPubGet` 헬퍼 함수는 이 태스크에서 **한 번만** 정의한다. Task 2~7은 이 함수를 재사용하며 다시 정의하지 않는다.

- [ ] **Step 2: 테스트를 실행해 실패를 확인한다**

  Run: `node --test tests/node/payload-yaml.test.js`

  Expected: `PROJECT-FLUTTER-ANDROID-FIREBASE-CICD: flutter pub get 직후...` 테스트가 **FAIL**(현재 가드가 0개이므로, `matches.length` 0 vs `pubGetCount` 3). 다른 기존 테스트는 전부 PASS.

- [ ] **Step 3: `payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml`을 수정해 테스트를 통과시킨다**

  **115번째 줄** (형태 A) — 아래 블록을 찾는다:

  ```yaml
      - name: Install dependencies
        run: flutter pub get
  ```

  아래로 치환한다(이 파일에서 115번째 줄과 268번째 줄 두 곳이 정확히 동일하므로, 두 곳 모두 이 치환을 적용한다 — `replace_all: true`로 일괄 치환한다):

  ```yaml
      - name: Install dependencies
        run: |
          flutter pub get
          if grep -q "build_runner" pubspec.yaml; then
            dart run build_runner build --delete-conflicting-outputs
          fi
  ```

  **330번째 줄** (형태 C, "Build Android App Bundle (AAB)" 스텝 내부) — 아래 블록을 찾는다:

  ```yaml
          # Flutter clean 및 pub get
          echo "🔄 Flutter clean 및 의존성 재설치..."
          flutter clean
          flutter pub get

          # local.properties에 버전 정보 추가 (Flutter 플래그가 무시되는 문제 해결)
  ```

  아래로 치환한다:

  ```yaml
          # Flutter clean 및 pub get
          echo "🔄 Flutter clean 및 의존성 재설치..."
          flutter clean
          flutter pub get
          if grep -q "build_runner" pubspec.yaml; then
            dart run build_runner build --delete-conflicting-outputs
          fi

          # local.properties에 버전 정보 추가 (Flutter 플래그가 무시되는 문제 해결)
  ```

  파일 내 다른 곳(캐시 설정, Java/Gradle 설정, bundletool 다운로드 등)은 전혀 수정하지 않는다.

- [ ] **Step 4: 테스트를 다시 실행해 통과를 확인한다**

  Run: `node --test tests/node/payload-yaml.test.js`

  Expected: 새로 추가한 테스트 PASS, 기존 테스트도 전부 PASS.

- [ ] **Step 5: 커밋한다**

  ```bash
  git add payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml tests/node/payload-yaml.test.js
  git commit -m "$(cat <<'EOF'
  fix: FIREBASE-CICD 워크플로우에 build_runner 코드 생성 단계 추가 (#42)

  flutter pub get만 실행하고 코드 생성을 하지 않아 freezed/riverpod_generator/
  drift 등을 쓰는 프로젝트가 생성 파일 부재로 CI에서 실패했다. pub get
  직후 pubspec.yaml에 build_runner가 있을 때만 코드 생성을 실행하도록
  조건부 스텝을 추가하고 회귀 테스트를 추가했다.
  EOF
  )"
  ```

---

## Task 2: `PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml` (3곳 — 형태 A ×2, 형태 C ×1)

**Files:**
- Modify: `payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml` (100번째 줄, 258번째 줄, 320번째 줄)
- Modify: `tests/node/payload-yaml.test.js` (파일 끝에 새 섹션 추가)

**Interfaces:**
- Task 1에서 정의한 `assertBuildRunnerGuardFollowsEveryPubGet` 헬퍼를 재사용한다(다시 정의하지 않음).

- [ ] **Step 1: 실패하는 테스트를 먼저 작성한다**

  `tests/node/payload-yaml.test.js` 파일 끝(Task 1에서 추가한 블록 다음)에 추가한다:

  ```js

  const flutterPlaystoreCicdPath = join(
    "payload/workflows/flutter",
    "PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml"
  );

  test("PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD: flutter pub get 직후 build_runner 조건부 코드 생성이 있다 (#42)", () => {
    assertBuildRunnerGuardFollowsEveryPubGet(flutterPlaystoreCicdPath);
  });
  ```

- [ ] **Step 2: 테스트를 실행해 실패를 확인한다**

  Run: `node --test tests/node/payload-yaml.test.js`

  Expected: 새 테스트 **FAIL**(`matches.length` 0 vs `pubGetCount` 3). 다른 테스트는 전부 PASS.

- [ ] **Step 3: `payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml`을 수정해 테스트를 통과시킨다**

  **100번째 줄과 258번째 줄** (형태 A, 두 곳 모두 동일) — 아래 블록을 찾아 두 곳 모두 치환한다(`replace_all: true`로 일괄 치환한다):

  ```yaml
      - name: Install dependencies
        run: flutter pub get
  ```

  →

  ```yaml
      - name: Install dependencies
        run: |
          flutter pub get
          if grep -q "build_runner" pubspec.yaml; then
            dart run build_runner build --delete-conflicting-outputs
          fi
  ```

  **320번째 줄** (형태 C, "Build Android App Bundle (AAB)" 스텝 내부) — 아래 블록을 찾는다:

  ```yaml
          # Flutter clean 및 pub get
          echo "🔄 Flutter clean 및 의존성 재설치..."
          flutter clean
          flutter pub get

          # local.properties에 버전 정보 추가 (Flutter 플래그가 무시되는 문제 해결)
  ```

  아래로 치환한다:

  ```yaml
          # Flutter clean 및 pub get
          echo "🔄 Flutter clean 및 의존성 재설치..."
          flutter clean
          flutter pub get
          if grep -q "build_runner" pubspec.yaml; then
            dart run build_runner build --delete-conflicting-outputs
          fi

          # local.properties에 버전 정보 추가 (Flutter 플래그가 무시되는 문제 해결)
  ```

  파일 내 다른 곳은 전혀 수정하지 않는다.

- [ ] **Step 4: 테스트를 다시 실행해 통과를 확인한다**

  Run: `node --test tests/node/payload-yaml.test.js`

  Expected: 전부 PASS.

- [ ] **Step 5: 커밋한다**

  ```bash
  git add payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml tests/node/payload-yaml.test.js
  git commit -m "$(cat <<'EOF'
  fix: PLAYSTORE-CICD 워크플로우에 build_runner 코드 생성 단계 추가 (#42)

  flutter pub get만 실행하고 코드 생성을 하지 않아 freezed/riverpod_generator/
  drift 등을 쓰는 프로젝트가 생성 파일 부재로 CI에서 실패했다. pub get
  직후 pubspec.yaml에 build_runner가 있을 때만 코드 생성을 실행하도록
  조건부 스텝을 추가하고 회귀 테스트를 추가했다.
  EOF
  )"
  ```

---

## Task 3: `PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD.yaml` (1곳 — 형태 B)

**Files:**
- Modify: `payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD.yaml` (136번째 줄)
- Modify: `tests/node/payload-yaml.test.js` (파일 끝에 새 섹션 추가)

**Interfaces:**
- Task 1에서 정의한 `assertBuildRunnerGuardFollowsEveryPubGet` 헬퍼를 재사용한다.

- [ ] **Step 1: 실패하는 테스트를 먼저 작성한다**

  `tests/node/payload-yaml.test.js` 파일 끝에 추가한다:

  ```js

  const flutterSelfhostedCicdPath = join(
    "payload/workflows/flutter",
    "PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD.yaml"
  );

  test("PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD: flutter pub get 직후 build_runner 조건부 코드 생성이 있다 (#42)", () => {
    assertBuildRunnerGuardFollowsEveryPubGet(flutterSelfhostedCicdPath);
  });
  ```

- [ ] **Step 2: 테스트를 실행해 실패를 확인한다**

  Run: `node --test tests/node/payload-yaml.test.js`

  Expected: 새 테스트 **FAIL**(`matches.length` 0 vs `pubGetCount` 1). 다른 테스트는 전부 PASS.

- [ ] **Step 3: `payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD.yaml`을 수정해 테스트를 통과시킨다**

  **133~138번째 줄** (형태 B) — 아래 블록을 찾는다:

  ```yaml
      # 프로젝트 의존성 설치
      - name: Install dependencies
        run: |
          flutter pub get
          echo "Dependencies installed"
          ls -la
  ```

  아래로 치환한다(`flutter pub get` 바로 다음 줄에 가드 삽입, 나머지 유지):

  ```yaml
      # 프로젝트 의존성 설치
      - name: Install dependencies
        run: |
          flutter pub get
          if grep -q "build_runner" pubspec.yaml; then
            dart run build_runner build --delete-conflicting-outputs
          fi
          echo "Dependencies installed"
          ls -la
  ```

  파일 내 다른 곳(Gradle 셋업 등)은 전혀 수정하지 않는다.

- [ ] **Step 4: 테스트를 다시 실행해 통과를 확인한다**

  Run: `node --test tests/node/payload-yaml.test.js`

  Expected: 전부 PASS.

- [ ] **Step 5: 커밋한다**

  ```bash
  git add payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD.yaml tests/node/payload-yaml.test.js
  git commit -m "$(cat <<'EOF'
  fix: SELFHOSTED-CICD 워크플로우에 build_runner 코드 생성 단계 추가 (#42)

  flutter pub get만 실행하고 코드 생성을 하지 않아 freezed/riverpod_generator/
  drift 등을 쓰는 프로젝트가 생성 파일 부재로 CI에서 실패했다. pub get
  직후 pubspec.yaml에 build_runner가 있을 때만 코드 생성을 실행하도록
  조건부 스텝을 추가하고 회귀 테스트를 추가했다.
  EOF
  )"
  ```

---

## Task 4: `PROJECT-FLUTTER-ANDROID-TEST-APK.yaml` (1곳 — 형태 B)

**Files:**
- Modify: `payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-TEST-APK.yaml` (390번째 줄)
- Modify: `tests/node/payload-yaml.test.js` (파일 끝에 새 섹션 추가)

**Interfaces:**
- Task 1에서 정의한 `assertBuildRunnerGuardFollowsEveryPubGet` 헬퍼를 재사용한다.

- [ ] **Step 1: 실패하는 테스트를 먼저 작성한다**

  `tests/node/payload-yaml.test.js` 파일 끝에 추가한다:

  ```js

  const flutterTestApkPath = join(
    "payload/workflows/flutter",
    "PROJECT-FLUTTER-ANDROID-TEST-APK.yaml"
  );

  test("PROJECT-FLUTTER-ANDROID-TEST-APK: flutter pub get 직후 build_runner 조건부 코드 생성이 있다 (#42)", () => {
    assertBuildRunnerGuardFollowsEveryPubGet(flutterTestApkPath);
  });
  ```

- [ ] **Step 2: 테스트를 실행해 실패를 확인한다**

  Run: `node --test tests/node/payload-yaml.test.js`

  Expected: 새 테스트 **FAIL**(`matches.length` 0 vs `pubGetCount` 1). 다른 테스트는 전부 PASS.

- [ ] **Step 3: `payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-TEST-APK.yaml`을 수정해 테스트를 통과시킨다**

  **387~391번째 줄** (형태 B) — 아래 블록을 찾는다:

  ```yaml
      # 프로젝트 의존성 설치
      - name: Install dependencies
        run: |
          flutter pub get
          echo "✅ Dependencies installed"
  ```

  아래로 치환한다:

  ```yaml
      # 프로젝트 의존성 설치
      - name: Install dependencies
        run: |
          flutter pub get
          if grep -q "build_runner" pubspec.yaml; then
            dart run build_runner build --delete-conflicting-outputs
          fi
          echo "✅ Dependencies installed"
  ```

  파일 내 다른 곳(Gradle 셋업, 버전 관리 등)은 전혀 수정하지 않는다.

- [ ] **Step 4: 테스트를 다시 실행해 통과를 확인한다**

  Run: `node --test tests/node/payload-yaml.test.js`

  Expected: 전부 PASS.

- [ ] **Step 5: 커밋한다**

  ```bash
  git add payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-TEST-APK.yaml tests/node/payload-yaml.test.js
  git commit -m "$(cat <<'EOF'
  fix: TEST-APK 워크플로우에 build_runner 코드 생성 단계 추가 (#42)

  flutter pub get만 실행하고 코드 생성을 하지 않아 freezed/riverpod_generator/
  drift 등을 쓰는 프로젝트가 생성 파일 부재로 CI에서 실패했다. pub get
  직후 pubspec.yaml에 build_runner가 있을 때만 코드 생성을 실행하도록
  조건부 스텝을 추가하고 회귀 테스트를 추가했다.
  EOF
  )"
  ```

---

## Task 5: `PROJECT-FLUTTER-CI.yaml` (3곳 — 형태 B ×3)

**Files:**
- Modify: `payload/workflows/flutter/PROJECT-FLUTTER-CI.yaml` (280번째 줄, 379번째 줄, 507번째 줄)
- Modify: `tests/node/payload-yaml.test.js` (파일 끝에 새 섹션 추가)

**Interfaces:**
- Task 1에서 정의한 `assertBuildRunnerGuardFollowsEveryPubGet` 헬퍼를 재사용한다.
- 이 파일은 이미 `tests/node/payload-yaml.test.js`에 `flutterCiPath`라는 경로 상수가 정의되어 있다(272~275번째 줄, `#38`/`#39` 테스트용). 새 테스트에서도 **그 기존 `flutterCiPath` 상수를 그대로 재사용**한다 — 새 상수를 또 만들지 않는다.

- [ ] **Step 1: 실패하는 테스트를 먼저 작성한다**

  `tests/node/payload-yaml.test.js` 파일 끝에 추가한다(새 경로 상수 선언 없이 기존 `flutterCiPath`를 참조):

  ```js

  test("PROJECT-FLUTTER-CI: flutter pub get 직후 build_runner 조건부 코드 생성이 있다 (#42)", () => {
    assertBuildRunnerGuardFollowsEveryPubGet(flutterCiPath);
  });
  ```

- [ ] **Step 2: 테스트를 실행해 실패를 확인한다**

  Run: `node --test tests/node/payload-yaml.test.js`

  Expected: 새 테스트 **FAIL**(`matches.length` 0 vs `pubGetCount` 3). 다른 테스트는 전부 PASS.

- [ ] **Step 3: `payload/workflows/flutter/PROJECT-FLUTTER-CI.yaml`을 수정해 테스트를 통과시킨다**

  이 파일의 세 위치는 모두 형태 B이며 로그 메시지만 약간 다르다. 각각 정확히 찾아 치환한다.

  **277~281번째 줄** — 아래 블록을 찾는다:

  ```yaml
      # 프로젝트 의존성 설치
      - name: Install dependencies
        run: |
          flutter pub get
          echo "✅ Dependencies installed"

      # Flutter Analyze 실행
  ```

  아래로 치환한다:

  ```yaml
      # 프로젝트 의존성 설치
      - name: Install dependencies
        run: |
          flutter pub get
          if grep -q "build_runner" pubspec.yaml; then
            dart run build_runner build --delete-conflicting-outputs
          fi
          echo "✅ Dependencies installed"

      # Flutter Analyze 실행
  ```

  **376~380번째 줄** — 아래 블록을 찾는다:

  ```yaml
      # 프로젝트 의존성 설치
      - name: Install dependencies
        run: |
          flutter pub get
          echo "✅ Dependencies installed"

      # Java 설정
  ```

  아래로 치환한다:

  ```yaml
      # 프로젝트 의존성 설치
      - name: Install dependencies
        run: |
          flutter pub get
          if grep -q "build_runner" pubspec.yaml; then
            dart run build_runner build --delete-conflicting-outputs
          fi
          echo "✅ Dependencies installed"

      # Java 설정
  ```

  **504~508번째 줄** — 아래 블록을 찾는다:

  ```yaml
      # 프로젝트 의존성 설치
      - name: Install dependencies
        run: |
          flutter pub get
          echo "✅ Dependencies installed"

      # Ruby 및 CocoaPods 설정
  ```

  아래로 치환한다:

  ```yaml
      # 프로젝트 의존성 설치
      - name: Install dependencies
        run: |
          flutter pub get
          if grep -q "build_runner" pubspec.yaml; then
            dart run build_runner build --delete-conflicting-outputs
          fi
          echo "✅ Dependencies installed"

      # Ruby 및 CocoaPods 설정
  ```

  주의: 세 블록 모두 `# 프로젝트 의존성 설치` 주석과 `flutter pub get` / `echo "✅ Dependencies installed"`가 동일해 구분이 어려우므로, **반드시 블록 뒤에 이어지는 주석 줄**(`# Flutter Analyze 실행` / `# Java 설정` / `# Ruby 및 CocoaPods 설정`)까지 포함해서 검색해 올바른 위치를 특정한다. 이 파일의 다른 곳(`build-ios`/`build-android` 잡의 빌드 스텝 등, `#38`/`#39`에서 이미 수정된 부분 포함)은 전혀 수정하지 않는다.

- [ ] **Step 4: 테스트를 다시 실행해 통과를 확인한다**

  Run: `node --test tests/node/payload-yaml.test.js`

  Expected: 전부 PASS(`#38`/`#39`의 기존 `PROJECT-FLUTTER-CI` 테스트 포함, 회귀 없음).

- [ ] **Step 5: 커밋한다**

  ```bash
  git add payload/workflows/flutter/PROJECT-FLUTTER-CI.yaml tests/node/payload-yaml.test.js
  git commit -m "$(cat <<'EOF'
  fix: FLUTTER-CI 워크플로우에 build_runner 코드 생성 단계 추가 (#42)

  flutter pub get만 실행하고 코드 생성을 하지 않아 freezed/riverpod_generator/
  drift 등을 쓰는 프로젝트가 flutter analyze/빌드 단계에서 생성 파일
  부재로 실패했다. pub get 직후 pubspec.yaml에 build_runner가 있을 때만
  코드 생성을 실행하도록 조건부 스텝을 세 잡(analyze/android/ios) 모두에
  추가하고 회귀 테스트를 추가했다.
  EOF
  )"
  ```

---

## Task 6: `PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml` (2곳 — 형태 A ×2)

**Files:**
- Modify: `payload/workflows/flutter/PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml` (157번째 줄, 293번째 줄)
- Modify: `tests/node/payload-yaml.test.js` (파일 끝에 새 섹션 추가)

**Interfaces:**
- Task 1에서 정의한 `assertBuildRunnerGuardFollowsEveryPubGet` 헬퍼를 재사용한다.

- [ ] **Step 1: 실패하는 테스트를 먼저 작성한다**

  `tests/node/payload-yaml.test.js` 파일 끝에 추가한다:

  ```js

  const flutterIosTestflightPath = join(
    "payload/workflows/flutter",
    "PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml"
  );

  test("PROJECT-FLUTTER-IOS-TESTFLIGHT: flutter pub get 직후 build_runner 조건부 코드 생성이 있다 (#42)", () => {
    assertBuildRunnerGuardFollowsEveryPubGet(flutterIosTestflightPath);
  });
  ```

- [ ] **Step 2: 테스트를 실행해 실패를 확인한다**

  Run: `node --test tests/node/payload-yaml.test.js`

  Expected: 새 테스트 **FAIL**(`matches.length` 0 vs `pubGetCount` 2). 다른 테스트는 전부 PASS.

- [ ] **Step 3: `payload/workflows/flutter/PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml`을 수정해 테스트를 통과시킨다**

  **157번째 줄과 293번째 줄** (형태 A, 두 곳 모두 동일) — 아래 블록을 찾아 두 곳 모두 치환한다(`replace_all: true`로 일괄 치환한다):

  ```yaml
      - name: Install dependencies
        run: flutter pub get
  ```

  →

  ```yaml
      - name: Install dependencies
        run: |
          flutter pub get
          if grep -q "build_runner" pubspec.yaml; then
            dart run build_runner build --delete-conflicting-outputs
          fi
  ```

  파일 내 다른 곳(Ruby/CocoaPods 설정, TestFlight 업로드 등)은 전혀 수정하지 않는다.

- [ ] **Step 4: 테스트를 다시 실행해 통과를 확인한다**

  Run: `node --test tests/node/payload-yaml.test.js`

  Expected: 전부 PASS.

- [ ] **Step 5: 커밋한다**

  ```bash
  git add payload/workflows/flutter/PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml tests/node/payload-yaml.test.js
  git commit -m "$(cat <<'EOF'
  fix: IOS-TESTFLIGHT 워크플로우에 build_runner 코드 생성 단계 추가 (#42)

  flutter pub get만 실행하고 코드 생성을 하지 않아 freezed/riverpod_generator/
  drift 등을 쓰는 프로젝트가 생성 파일 부재로 CI에서 실패했다. pub get
  직후 pubspec.yaml에 build_runner가 있을 때만 코드 생성을 실행하도록
  조건부 스텝을 추가하고 회귀 테스트를 추가했다.
  EOF
  )"
  ```

---

## Task 7: `PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml` (1곳 — 형태 A)

**Files:**
- Modify: `payload/workflows/flutter/PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml` (545번째 줄)
- Modify: `tests/node/payload-yaml.test.js` (파일 끝에 새 섹션 추가)

**Interfaces:**
- Task 1에서 정의한 `assertBuildRunnerGuardFollowsEveryPubGet` 헬퍼를 재사용한다.

- [ ] **Step 1: 실패하는 테스트를 먼저 작성한다**

  `tests/node/payload-yaml.test.js` 파일 끝에 추가한다:

  ```js

  const flutterIosTestTestflightPath = join(
    "payload/workflows/flutter",
    "PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml"
  );

  test("PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT: flutter pub get 직후 build_runner 조건부 코드 생성이 있다 (#42)", () => {
    assertBuildRunnerGuardFollowsEveryPubGet(flutterIosTestTestflightPath);
  });
  ```

- [ ] **Step 2: 테스트를 실행해 실패를 확인한다**

  Run: `node --test tests/node/payload-yaml.test.js`

  Expected: 새 테스트 **FAIL**(`matches.length` 0 vs `pubGetCount` 1). 다른 테스트는 전부 PASS.

- [ ] **Step 3: `payload/workflows/flutter/PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml`을 수정해 테스트를 통과시킨다**

  **544~545번째 줄** (형태 A) — 아래 블록을 찾는다:

  ```yaml
      - name: Install dependencies
        run: flutter pub get
  ```

  →

  ```yaml
      - name: Install dependencies
        run: |
          flutter pub get
          if grep -q "build_runner" pubspec.yaml; then
            dart run build_runner build --delete-conflicting-outputs
          fi
  ```

  파일 내 다른 곳은 전혀 수정하지 않는다.

- [ ] **Step 4: 테스트를 다시 실행해 통과를 확인한다**

  Run: `node --test tests/node/payload-yaml.test.js`

  Expected: 전부 PASS.

- [ ] **Step 5: 전체 Node 테스트 스위트를 실행해 다른 회귀가 없는지 확인한다**

  Run: `npm run test:node`

  Expected: 전체 PASS(`tests/node/` 하위 모든 테스트 파일 포함). 이 계획은 `payload/workflows/flutter/` 7개 파일과 `tests/node/payload-yaml.test.js`만 건드리므로 다른 테스트 파일에는 영향이 없어야 한다.

- [ ] **Step 6: 커밋한다**

  ```bash
  git add payload/workflows/flutter/PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml tests/node/payload-yaml.test.js
  git commit -m "$(cat <<'EOF'
  fix: IOS-TEST-TESTFLIGHT 워크플로우에 build_runner 코드 생성 단계 추가 (#42)

  flutter pub get만 실행하고 코드 생성을 하지 않아 freezed/riverpod_generator/
  drift 등을 쓰는 프로젝트가 생성 파일 부재로 CI에서 실패했다. pub get
  직후 pubspec.yaml에 build_runner가 있을 때만 코드 생성을 실행하도록
  조건부 스텝을 추가하고 회귀 테스트를 추가했다. 이슈 #42의 7개 파일
  14곳 수정을 마무리한다.
  EOF
  )"
  ```

---

## Self-Review Notes (writing-plans 단계에서 수행)

- **스펙 커버리지**: 스펙 4.1(삽입 블록 내용) → 모든 Task의 Step 3에서 세 형태 전부 동일한 두 줄만 사용(로그 라인 없음). 스펙 4.2(형태별 적용 방식) → Task 1~7에서 형태 A/B/C 전부 동일 스니펫으로 구현. 스펙 4.3(테스트 계획) → Task 1에서 헬퍼 함수 정의 후 Task 2~7에서 재사용, 총 7개 테스트로 7개 파일 모두 커버. 스펙 3절 비목표(SUH-LAB-APP-BUILD-TRIGGER 제외, yq 미사용, 캐싱 최적화 없음) → Global Constraints에 명시, 어떤 Task에도 해당 항목 없음. 갭 없음.
- **플레이스홀더 스캔**: "TBD"/"나중에"/"적절히 처리" 류 표현 없음. 모든 Step 3의 before/after YAML 블록이 실제 파일 내용을 그대로 옮긴 완성된 텍스트이며, 각 파일의 정확한 줄 번호를 명시했다.
- **타입/네이밍 일관성**: `assertBuildRunnerGuardFollowsEveryPubGet` 헬퍼 함수명과 각 파일의 경로 상수명(`flutterFirebaseCicdPath`, `flutterPlaystoreCicdPath`, `flutterSelfhostedCicdPath`, `flutterTestApkPath`, 기존 `flutterCiPath` 재사용, `flutterIosTestflightPath`, `flutterIosTestTestflightPath`)이 모든 Task에서 동일하게 사용됨. Task 5에서 기존 `flutterCiPath` 상수를 재사용하도록 명시해 중복 선언을 방지했다.
- **파일별 독립성 확인**: 7개 Task는 서로 다른 워크플로우 파일을 건드리므로 실행 순서를 바꿔도 충돌하지 않는다(단, `tests/node/payload-yaml.test.js`는 공유 파일이므로 Task 1의 헬퍼 함수 정의가 다른 Task보다 먼저 실행돼야 한다 — Task 순서를 1→7로 고정 권장).
