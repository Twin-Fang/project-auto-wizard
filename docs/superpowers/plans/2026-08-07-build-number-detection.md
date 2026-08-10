# 신규 통합 시 빌드 번호(version_code) 자동 감지 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flutter/react-native/react-native-expo 프로젝트에 **신규 통합**할 때 pubspec.yaml/build.gradle/app.json에 이미 기록된 빌드 번호를 감지해 `version.yml`의 `version_code`가 항상 `1`로 초기화되는 것을 막고(이슈 #41), 잘못 감지됐을 때 통합 요약에서 바로 눈에 띄게 하며, `version_code`를 낮은 값으로 덮어쓰려는 시도에 경고를 남긴다.

**Architecture:** `detectVersionFromFiles`와 나란한 새 순수 함수 `detectBuildNumberFromFiles`(타입별 정규식/JSON 파싱, 주입된 `read`/`readJson`/`warn`만 사용)를 `src/core/detect.js`에 추가하고, `src/core/detect-fs.js`에 실 파일시스템 래퍼 `detectBuildNumber`를 추가한다. 신규 통합 결정 지점(`interactive.js`/`index.js`의 `existing?.versionCode ?? 1`) 두 곳에서 `?? 1` 직전에 이 감지를 끼워 넣는다. 감지된 값은 통합 요약(`summary.js`) 출력에도 흘려보낸다. Python 쪽 `version_manager.py`의 `set_version_code()`에는 역행 시 경고만 남기는 가드를 추가한다.

**Tech Stack:** Node.js (`node --test`, ESM), Python 3 stdlib (`unittest`) — 기존 스택 그대로, 신규 의존성 없음.

## Global Constraints

- `src/core/detect.js`의 함수는 **순수 함수**여야 한다 — 파일시스템/네트워크 I/O를 직접 하지 않고 `read`/`readJson`/`has`/`warn` 등 주입된 함수만 사용한다 (기존 `detectVersionFromFiles` 관례).
- `src/core/detect-fs.js`의 실 fs 래퍼는 `warn = (m) => console.error(m)` 기본값 패턴을 따른다 (기존 `detectVersion` 관례).
- `payload/scripts/version_manager.py`는 stdlib만 사용하고, `version.yml`은 **절대 YAML 라이브러리로 재파싱/재직렬화하지 않는다** — 줄 단위 정규식 치환으로 주석/포맷을 보존한다 (파일 상단 docstring 명시 계약). `log()`는 stderr 전용, stdout 마지막 줄만 값이다.
- 신규 코드는 기존 재통합(`existing?.versionCode` 보존) 경로를 건드리지 않는다 — `?? 1` 폴백 앞에만 삽입한다.
- 커밋 메시지는 한국어로 작성하고 Conventional Commits 타입 접두사(`feat:`, `test:`, `fix:` 등)는 영어를 유지한다 (프로젝트 `CLAUDE.md`).
- 테스트: `npm run test:node`(node --test, `--test-concurrency=1`), `npm run test:py`(`python3 -m unittest discover -s tests/py -v`). 두 스위트 모두 그린이어야 각 태스크가 완료된 것으로 간주한다.

---

### Task 1: `detectBuildNumberFromFiles` 순수 함수 — `src/core/detect.js`

**Files:**
- Modify: `src/core/detect.js` (64번째 줄 끝, `extraMarkers` 함수 뒤에 추가)
- Test: `tests/node/detect-version.test.js`

**Interfaces:**
- Produces: `detectBuildNumberFromFiles({ types = [], read, readJson, warn })` → `number | null`
  - `types`: 감지된 프로젝트 타입 배열 (예: `["flutter"]`) — 이미 다른 곳에서 `detectTypes()`로 계산된 값을 그대로 전달받는다.
  - `read(rel)`: `string | null` 반환하는 파일 읽기 함수 (기존 `detectVersionFromFiles`의 `read`와 동일한 시그니처).
  - `readJson(rel)`: `object | null` 반환하는 JSON 읽기 함수.
  - `warn(msg)`: 선택적 경고 콜백.

- [ ] **Step 1: 실패하는 단위 테스트 작성**

`tests/node/detect-version.test.js`는 57줄짜리 파일이다. 7번째 줄의 기존 import에 `detectBuildNumberFromFiles`를 추가한다(신규 mid-file import를 만들지 않고 기존 import를 확장 — 파일 스타일과 일치):

```js
import { detectVersionFromFiles, detectBuildNumberFromFiles } from "../../src/core/detect.js";
```

파일 끝(57번째 줄 뒤)에 테스트를 추가:

```js
test("detectBuildNumberFromFiles: flutter — pubspec.yaml의 +N을 빌드 번호로 감지한다", () => {
  const read = (rel) => (rel === "pubspec.yaml" ? "name: x\nversion: 1.2.39+71\n" : null);
  const code = detectBuildNumberFromFiles({ types: ["flutter"], read, readJson: () => null, warn: () => {} });
  assert.strictEqual(code, 71);
});

test("detectBuildNumberFromFiles: flutter — pubspec.yaml에 +N이 없으면 null이고 warn이 호출된다", () => {
  const read = (rel) => (rel === "pubspec.yaml" ? "name: x\nversion: 1.2.39\n" : null);
  const warned = [];
  const code = detectBuildNumberFromFiles({ types: ["flutter"], read, readJson: () => null, warn: (m) => warned.push(m) });
  assert.strictEqual(code, null);
  assert.strictEqual(warned.length, 1);
});

test("detectBuildNumberFromFiles: flutter — pubspec.yaml 자체가 없으면 null이고 warn은 호출되지 않는다", () => {
  const warned = [];
  const code = detectBuildNumberFromFiles({ types: ["flutter"], read: () => null, readJson: () => null, warn: (m) => warned.push(m) });
  assert.strictEqual(code, null);
  assert.strictEqual(warned.length, 0);
});

test("detectBuildNumberFromFiles: react-native — android/app/build.gradle의 versionCode를 감지한다", () => {
  const read = (rel) => (rel === "android/app/build.gradle" ? "android {\n  defaultConfig {\n    versionCode 71\n  }\n}\n" : null);
  const code = detectBuildNumberFromFiles({ types: ["react-native"], read, readJson: () => null, warn: () => {} });
  assert.strictEqual(code, 71);
});

test("detectBuildNumberFromFiles: react-native — build.gradle에 versionCode가 없으면 null이고 warn이 호출된다", () => {
  const read = (rel) => (rel === "android/app/build.gradle" ? "android {\n  defaultConfig {\n    versionName \"1.0.0\"\n  }\n}\n" : null);
  const warned = [];
  const code = detectBuildNumberFromFiles({ types: ["react-native"], read, readJson: () => null, warn: (m) => warned.push(m) });
  assert.strictEqual(code, null);
  assert.strictEqual(warned.length, 1);
});

test("detectBuildNumberFromFiles: react-native-expo — app.json의 expo.android.versionCode를 감지한다", () => {
  const readJson = (rel) => (rel === "app.json" ? { expo: { android: { versionCode: 71 } } } : null);
  const code = detectBuildNumberFromFiles({ types: ["react-native-expo"], read: () => null, readJson, warn: () => {} });
  assert.strictEqual(code, 71);
});

test("detectBuildNumberFromFiles: react-native-expo — versionCode가 없으면 null이고 warn이 호출된다", () => {
  const readJson = (rel) => (rel === "app.json" ? { expo: { name: "x" } } : null);
  const warned = [];
  const code = detectBuildNumberFromFiles({ types: ["react-native-expo"], read: () => null, readJson, warn: (m) => warned.push(m) });
  assert.strictEqual(code, null);
  assert.strictEqual(warned.length, 1);
});

test("detectBuildNumberFromFiles: 빌드 번호 개념이 없는 타입(spring 등)은 null이고 warn 없이 조용히 넘어간다", () => {
  const warned = [];
  const code = detectBuildNumberFromFiles({ types: ["spring"], read: () => null, readJson: () => null, warn: (m) => warned.push(m) });
  assert.strictEqual(code, null);
  assert.strictEqual(warned.length, 0);
});

test("detectBuildNumberFromFiles: types 배열에서 먼저 매칭되는 첫 타입만 사용한다", () => {
  const read = (rel) => {
    if (rel === "pubspec.yaml") return "version: 1.0.0+5\n";
    if (rel === "android/app/build.gradle") return "versionCode 99\n";
    return null;
  };
  const code = detectBuildNumberFromFiles({ types: ["flutter", "react-native"], read, readJson: () => null, warn: () => {} });
  assert.strictEqual(code, 5);
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npm run test:node -- tests/node/detect-version.test.js`
Expected: FAIL — Node ESM은 존재하지 않는 named export를 모듈 인스턴스화 단계에서 잡는다: `SyntaxError: The requested module '../../src/core/detect.js' does not provide an export named 'detectBuildNumberFromFiles'`. 이 에러는 **파일 전체**를 실패시켜 이 파일의 기존 통과 테스트 5개도 이 RED 단계에서 함께 FAIL로 표시된다 — 아직 구현이 없으니 정상이며, Step 4에서 전부 PASS로 돌아온다.

- [ ] **Step 3: 최소 구현 작성**

`src/core/detect.js`의 `extraMarkers` 함수(64번째 줄) 뒤에 추가:

```js
// 빌드 번호 감지 (이슈 #41) — 신규 통합 시 pubspec.yaml/build.gradle/app.json에 이미 기록된
// 빌드 번호를 읽어 version_code가 항상 1로 초기화되는 걸 막는다. types 배열에서 먼저 매칭되는
// 첫 타입만 사용한다(다른 감지 로직의 types[0]=primary 관례와 동일). read(rel)=>string|null,
// readJson(rel)=>object|null 로 주입.
export function detectBuildNumberFromFiles({ types = [], read, readJson, warn }) {
  const tryFlutter = () => {
    const content = read("pubspec.yaml");
    if (content == null) return null;
    const m = content.match(/^version:\s*\d+\.\d+\.\d+\+(\d+)/m);
    if (m) return parseInt(m[1], 10);
    warn?.("⚠️  pubspec.yaml에 빌드 번호(+N)가 없어 version_code를 감지하지 못했습니다 — 기본값 1을 사용합니다. 실제 빌드 번호를 확인하세요.");
    return null;
  };
  const tryReactNative = () => {
    const content = read("android/app/build.gradle");
    if (content == null) return null;
    // 앵커 + m 플래그로 한 줄 전체가 "versionCode N"인 라인만 매칭 — 주석 처리된
    // "// versionCode 2"나 다른 블록의 versionCode 참조에 오매칭되지 않도록 함.
    const m = content.match(/^\s*versionCode\s+(\d+)\s*$/m);
    if (m) return parseInt(m[1], 10);
    warn?.("⚠️  android/app/build.gradle에 versionCode가 없어 version_code를 감지하지 못했습니다 — 기본값 1을 사용합니다. 실제 빌드 번호를 확인하세요.");
    return null;
  };
  const tryExpo = () => {
    const data = readJson?.("app.json");
    if (data == null) return null;
    const code = data?.expo?.android?.versionCode;
    if (Number.isInteger(code)) return code;
    warn?.("⚠️  app.json의 expo.android.versionCode가 없어 version_code를 감지하지 못했습니다 — 기본값 1을 사용합니다. 실제 빌드 번호를 확인하세요.");
    return null;
  };
  for (const t of types) {
    if (t === "flutter") return tryFlutter();
    if (t === "react-native") return tryReactNative();
    if (t === "react-native-expo") return tryExpo();
  }
  return null;
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npm run test:node -- tests/node/detect-version.test.js`
Expected: PASS (9개 신규 테스트 전부)

- [ ] **Step 5: 커밋**

```bash
git add src/core/detect.js tests/node/detect-version.test.js
git commit -m "feat: pubspec/build.gradle/app.json에서 빌드 번호를 감지하는 순수 함수 추가"
```

---

### Task 2: `detectBuildNumber` 실 fs 래퍼 — `src/core/detect-fs.js`

**Files:**
- Modify: `src/core/detect-fs.js:6` (import 문), 30번째 줄 `detectVersion` 함수 뒤에 추가
- Test: `tests/node/detect-version.test.js`

**Interfaces:**
- Consumes: `detectBuildNumberFromFiles({ types, read, readJson, warn })` (Task 1에서 정의)
- Produces: `detectBuildNumber(root, { types = [], warn = (m) => console.error(m) } = {})` → `number | null`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/detect-version.test.js`의 기존 `detect-fs.js` import(8번째 줄, `import { detectVersion } from "../../src/core/detect-fs.js";`)에 `detectBuildNumber`를 추가:

```js
import { detectVersion, detectBuildNumber } from "../../src/core/detect-fs.js";
```

같은 파일에 테스트 추가 (기존 `detectVersion` 실fs 테스트들과 같은 스타일):

```js
test("detectBuildNumber: 실 파일시스템에서 flutter pubspec.yaml의 빌드 번호를 감지한다", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-detect-buildnum-"));
  try {
    writeFileSync(join(dir, "pubspec.yaml"), "name: x\nversion: 1.2.39+71\n");
    const code = detectBuildNumber(dir, { types: ["flutter"] });
    assert.strictEqual(code, 71);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("detectBuildNumber: 감지 실패 시 주입한 warn이 호출된다", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-detect-buildnum-warn-"));
  try {
    writeFileSync(join(dir, "pubspec.yaml"), "name: x\nversion: 1.2.39\n");
    const warned = [];
    const code = detectBuildNumber(dir, { types: ["flutter"], warn: (m) => warned.push(m) });
    assert.strictEqual(code, null);
    assert.strictEqual(warned.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npm run test:node -- tests/node/detect-version.test.js`
Expected: FAIL — Node ESM은 존재하지 않는 named export를 모듈 인스턴스화 단계에서 잡는다: `SyntaxError: The requested module '../../src/core/detect-fs.js' does not provide an export named 'detectBuildNumber'`. 이 에러는 파일 전체를 실패시켜 이 파일의 기존 통과 테스트들도 이 RED 단계에서 함께 FAIL로 표시된다 — 아직 구현이 없으니 정상이며, Step 4에서 전부 PASS로 돌아온다.

- [ ] **Step 3: 최소 구현 작성**

`src/core/detect-fs.js:6`의 import를 수정:

```js
import { detectTypesFromMarkers, detectVersionFromFiles, detectBuildNumberFromFiles } from "./detect.js";
```

`detectVersion` 함수(30-36번째 줄) 바로 뒤에 추가:

```js
// 빌드 번호 감지 — 신규 통합 시 pubspec.yaml/build.gradle/app.json에서 실제 빌드 번호를 읽는다 (이슈 #41).
export function detectBuildNumber(root, { types = [], warn = (m) => console.error(m) } = {}) {
  const read = readFile(root);
  const readJson = (rel) => { const c = read(rel); try { return c ? JSON.parse(c) : null; } catch { return null; } };
  return detectBuildNumberFromFiles({ types, read, readJson, warn });
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npm run test:node -- tests/node/detect-version.test.js`
Expected: PASS (11개 신규 테스트 전부, Task 1 + Task 2 합산)

- [ ] **Step 5: 커밋**

```bash
git add src/core/detect-fs.js tests/node/detect-version.test.js
git commit -m "feat: 실 파일시스템에서 빌드 번호를 감지하는 detectBuildNumber 래퍼 추가"
```

---

### Task 3: 신규 통합 호출부에 감지 연결 — `interactive.js` / `index.js`

**Files:**
- Modify: `src/commands/interactive.js:8` (import), `:88` (versionCode 결정)
- Modify: `src/index.js:12` (import), `:240` (versionCode 결정)
- Test: `tests/node/e2e-matrix.test.js` (Task 5에서 최종 검증 — 이 태스크에서는 정적 확인만)

**Interfaces:**
- Consumes: `detectBuildNumber(root, { types, warn })` (Task 2에서 정의)

- [ ] **Step 1: `src/commands/interactive.js` 수정**

8번째 줄:

```js
import { detectTypes, detectVersion, detectDefaultBranch, detectRepoName, makeResolvers, detectBuildNumber } from "../core/detect-fs.js";
```

88번째 줄:

```js
  const versionCode = existing?.versionCode ?? detectBuildNumber(cwd, { types }) ?? 1; // 기존 빌드번호 보존, 신규 통합 시 프로젝트 파일에서 감지 (이슈 #41)
```

- [ ] **Step 2: `src/index.js` 수정**

12번째 줄:

```js
import { detectTypes, detectVersion, detectDefaultBranch, detectRepoName, makeResolvers, detectBuildNumber } from "./core/detect-fs.js";
```

240번째 줄:

```js
  const versionCode = existing?.versionCode ?? detectBuildNumber(cwd, { types }) ?? 1; // 기존 빌드번호 보존, 신규 통합 시 프로젝트 파일에서 감지 (.sh L2208~2221, 이슈 #41)
```

- [ ] **Step 3: 기존 스위트가 깨지지 않는지 확인**

Run: `npm run test:node`
Expected: PASS (기존 전체 스위트 그린 — 이 태스크는 아직 전용 테스트가 없고, Task 5의 e2e 테스트가 실제 동작을 검증한다)

- [ ] **Step 4: 커밋**

```bash
git add src/commands/interactive.js src/index.js
git commit -m "feat: 신규 통합 시 pubspec/build.gradle/app.json에서 빌드 번호를 감지해 version_code에 반영"
```

---

### Task 4: 통합 요약에 빌드 번호 표시

**Files:**
- Modify: `src/commands/interactive.js:252-256` (`io.summary?.({...})`)
- Modify: `src/index.js:316-320` (`printSummary({...})`)
- Modify: `src/ui/summary.js:9` (ctx 구조분해), 58번째 줄 뒤
- Test: `tests/node/summary-output.test.js`

**Interfaces:**
- Consumes: Task 3에서 각 파일의 로컬 스코프에 이미 있는 `versionCode` 변수
- Produces: `printSummary(ctx)`가 `ctx.versionCode`를 받아 `types`가 `flutter`/`react-native`/`react-native-expo` 중 하나를 포함하면 빌드 번호 줄을 출력

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/summary-output.test.js` 끝에 추가:

```js
test("printSummary: flutter 타입 + versionCode 지정 시 빌드 번호 줄을 출력한다", () => {
  const output = captureStderr(() => {
    printSummary({ mode: "full", types: ["flutter"], version: "1.2.39", versionCode: 71 });
  });
  assert.ok(output.includes("빌드 번호: 71"));
});

test("printSummary: react-native-expo 타입도 빌드 번호 줄을 출력한다", () => {
  const output = captureStderr(() => {
    printSummary({ mode: "full", types: ["react-native-expo"], version: "1.0.0", versionCode: 5 });
  });
  assert.ok(output.includes("빌드 번호: 5"));
});

test("printSummary: 빌드 번호 개념이 없는 타입(spring)은 versionCode가 있어도 줄을 출력하지 않는다", () => {
  const output = captureStderr(() => {
    printSummary({ mode: "full", types: ["spring"], version: "1.0.0", versionCode: 1 });
  });
  assert.ok(!output.includes("빌드 번호"));
});

test("printSummary: versionCode 미지정 시에도 예외 없이 동작하고 빌드 번호 줄이 없다", () => {
  const output = captureStderr(() => {
    printSummary({ mode: "full", types: ["flutter"], version: "1.2.39" });
  });
  assert.ok(!output.includes("빌드 번호"));
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npm run test:node -- tests/node/summary-output.test.js`
Expected: FAIL — `output.includes("빌드 번호: 71")` assertion false (아직 출력하지 않음)

- [ ] **Step 3: 최소 구현 작성**

`src/ui/summary.js:9`:

```js
  const { mode, types = [], version = "", versionCode = null, copiedFiles = [], branches = null, gitignoreUpdated = false } = ctx || {};
```

58번째 줄(`err(\`  📄 version.yml (버전: ${version}, 타입: ${types.join(",")})\`);`) 바로 뒤에 추가:

```js
  const BUILD_NUMBER_TYPES = new Set(["flutter", "react-native", "react-native-expo"]);
  if (versionCode != null && types.some((t) => BUILD_NUMBER_TYPES.has(t))) {
    err(`     빌드 번호: ${versionCode}`);
  }
```

`src/commands/interactive.js:252-256`을 다음으로 교체:

```js
  io.summary?.({
    mode, types, version, versionCode, branches,
    copiedFiles: result?.workflows?.copiedFiles ?? [],
    gitignoreUpdated: result?.gitignoreUpdated === true,
  });
```

`src/index.js:316-320`을 다음으로 교체:

```js
  printSummary({
    mode: opts.mode, types, version, versionCode, branches,
    copiedFiles: result?.workflows?.copiedFiles ?? [],
    gitignoreUpdated: result?.gitignoreUpdated === true,
  });
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npm run test:node -- tests/node/summary-output.test.js`
Expected: PASS (4개 신규 테스트 전부)

- [ ] **Step 5: 기존 스위트가 깨지지 않는지 확인**

Run: `npm run test:node`
Expected: PASS (전체 그린 — `tests/node/interactive-mode-summary.test.js`는 `io.summary` 호출에 필드가 추가되는 것만 확인하므로 영향 없음)

- [ ] **Step 6: 커밋**

```bash
git add src/ui/summary.js src/commands/interactive.js src/index.js tests/node/summary-output.test.js
git commit -m "feat: 통합 요약에 감지된 빌드 번호 표시"
```

---

### Task 5: E2E 재현 테스트 — `tests/node/e2e-matrix.test.js`

**Files:**
- Modify: `tests/fixtures/e2e/flutter/pubspec.yaml`
- Modify: `tests/node/e2e-matrix.test.js`

**Interfaces:**
- Consumes: Task 3에서 연결된 `src/commands/interactive.js`/`src/index.js`의 신규 통합 경로 (CLI를 subprocess로 실행하므로 함수 시그니처가 아니라 CLI 인자/`version.yml` 출력이 인터페이스)

- [ ] **Step 1: e2e 테스트 작성**

`tests/fixtures/e2e/flutter/pubspec.yaml`을 다음으로 교체 (기존 `version: 1.0.0+1` → 이슈의 실제 재현값):

```yaml
name: fixture
version: 1.2.39+71
```

`tests/node/e2e-matrix.test.js`의 `MATRIX` 루프(64-73번째 줄) 뒤에 신규 테스트 추가. `installFixture(name, args)`의 첫 인자는 `join(FIXTURES, name)`으로 fixture 디렉터리를 찾는 키이므로(20-25번째 줄), 반드시 실제 fixture 디렉터리명인 `"flutter"`를 그대로 써야 한다:

```js
test("e2e flutter: 신규 통합 시 pubspec.yaml의 빌드 번호(+71)가 version_code에 반영된다 (issue #41)", () => {
  const t = installFixture("flutter", ["--type", "flutter"]);
  try {
    const vy = readFileSync(join(t, "version.yml"), "utf8");
    assert.ok(/version_code:\s*71\b/.test(vy), `version_code가 71이어야 함:\n${vy}`);
  } finally { rmSync(t, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: 테스트 실행 → 통과 확인**

이 플랜은 Task 3에서 감지 로직을 이미 연결했으므로, 이 e2e 테스트는 RED 없이 바로 PASS한다 — 이 태스크의 목적은 새 동작을 TDD로 만드는 것이 아니라, 이슈 #41의 정확한 재현 시나리오(신규 flutter 통합 + `pubspec.yaml`의 `+71`)를 고정된 회귀 테스트로 박아 넣는 것이다(트래킹 이슈 #37이 명시적으로 요청한 테스트). Task 1·2의 단위 테스트가 이미 감지 로직 자체의 RED→GREEN을 증명했으므로, 여기서 다시 RED를 재현할 필요는 없다.

Run: `npm run test:node -- tests/node/e2e-matrix.test.js`
Expected: PASS — 기존 `e2e flutter: full install is complete and token-free` 테스트를 포함해 전부 통과 (fixture의 `pubspec.yaml` 버전 문자열만 바뀌었을 뿐 다른 단언은 영향받지 않음)

- [ ] **Step 3: 전체 node 스위트 확인**

Run: `npm run test:node`
Expected: PASS (전체 그린)

- [ ] **Step 4: 커밋**

```bash
git add tests/fixtures/e2e/flutter/pubspec.yaml tests/node/e2e-matrix.test.js
git commit -m "test: 신규 flutter 통합 시 pubspec 빌드 번호가 version_code에 반영되는지 검증하는 e2e 테스트 추가"
```

---

### Task 6: `set_version_code()` 역행 경고 가드 — `payload/scripts/version_manager.py`

**Files:**
- Modify: `payload/scripts/version_manager.py:223-237` (`set_version_code`)
- Test: `tests/py/test_version_manager.py`

**Interfaces:**
- Consumes: `get_version_code()` (기존 함수, 문자열 반환), `log(message)` (기존 헬퍼, stderr 출력)
- Produces: `set_version_code(new_code)` — 시그니처는 그대로, 역행 시 `log()`로 WARNING만 추가 출력

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/py/test_version_manager.py` 상단 import 구역에 직접 임포트 방식을 추가하고(기존 subprocess 방식 `run()`은 CLI에 `set_version_code`를 임의 값으로 호출할 서브커맨드가 없으므로 함수를 직접 호출해야 한다 — `tests/py/test_increment_bump.py`가 이미 쓰는 `sys.path.insert` + `import version_manager` 패턴을 그대로 따른다), 파일 끝에 새 테스트 클래스를 추가:

```python
import contextlib
import io as _io
import sys as _sys
from pathlib import Path as _Path

_SCRIPT_DIR = _Path(__file__).resolve().parents[2] / "payload" / "scripts"
if str(_SCRIPT_DIR) not in _sys.path:
    _sys.path.insert(0, str(_SCRIPT_DIR))

import version_manager  # noqa: E402


class TestSetVersionCodeRegressionGuard(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.cwd = Path.cwd()
        import os
        os.chdir(self.tmp)
        self.addCleanup(os.chdir, self.cwd)
        Path("version.yml").write_text('version: "1.0.0"\nversion_code: 71\n', encoding="utf-8")

    def test_lower_code_still_written_but_warns(self):
        stderr = _io.StringIO()
        with contextlib.redirect_stderr(stderr):
            version_manager.set_version_code(2)
        self.assertIn("version_code: 2", Path("version.yml").read_text(encoding="utf-8"))
        self.assertIn("WARNING", stderr.getvalue())
        self.assertIn("71", stderr.getvalue())

    def test_higher_code_written_without_warning(self):
        stderr = _io.StringIO()
        with contextlib.redirect_stderr(stderr):
            version_manager.set_version_code(72)
        self.assertIn("version_code: 72", Path("version.yml").read_text(encoding="utf-8"))
        self.assertNotIn("WARNING", stderr.getvalue())
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `python3 -m unittest tests.py.test_version_manager.TestSetVersionCodeRegressionGuard -v`
Expected: FAIL — `test_lower_code_still_written_but_warns`에서 `"WARNING" in stderr.getvalue()`가 거짓

- [ ] **Step 3: 최소 구현 작성**

`payload/scripts/version_manager.py:223-237`의 `set_version_code`를 다음으로 교체:

```python
def set_version_code(new_code):
    current = read_scalar_key("version_code", None)
    if current not in (None, "", "null"):
        try:
            if int(new_code) < int(current):
                log(f"WARNING: version_code {new_code} is lower than current {current} — writing anyway (regression?)")
        except ValueError:
            pass
    text = read_text()
    pattern = re.compile(r'^version_code:[ \t]*.*$', re.MULTILINE)
    replacement = f'version_code: {new_code}  # app build number'
    if pattern.search(text):
        new_text = pattern.sub(replacement, text, count=1)
    else:
        new_text = re.sub(
            r'^(version:[^\n]*\n)',
            r'\1' + replacement + '\n',
            text,
            count=1,
            flags=re.MULTILINE,
        )
    write_text(new_text)
```

(`read_scalar_key`는 `get_version_code()`가 이미 내부적으로 쓰는 기존 헬퍼 함수다 — 새로 만들 필요 없다.)

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `python3 -m unittest tests.py.test_version_manager.TestSetVersionCodeRegressionGuard -v`
Expected: PASS (2개 신규 테스트)

- [ ] **Step 5: 전체 python 스위트 확인**

Run: `npm run test:py`
Expected: PASS (전체 그린 — 특히 `test_get_code_and_increment_code`, `test_increment_also_bumps_version_code`처럼 기존에 `set_version_code`를 항상 증가 방향으로만 호출하던 테스트들이 깨지지 않는지 확인)

- [ ] **Step 6: 커밋**

```bash
git add payload/scripts/version_manager.py tests/py/test_version_manager.py
git commit -m "feat: version_code를 낮은 값으로 덮어쓸 때 경고 로그를 남기도록 set_version_code에 가드 추가"
```

---

## 알려진 한계 (Fable 5 리뷰에서 확인 — 이번 스코프에서 고치지 않음)

- **요약 줄 표현이 스펙 예시와 다르다.** 스펙 3.3의 예시는 `빌드 번호: 71 (pubspec.yaml에서 감지)`처럼 출처를 명시하지만, Task 4의 실제 구현은 `빌드 번호: ${versionCode}`만 출력한다. 감지값/기존값 보존/기본값(1) 폴백을 요약 단계에서 구분할 방법이 없어 의도적으로 단순화한 것이다 — 출처 라벨이 꼭 필요하면 별도 후속 작업으로 다룬다.
- **모노레포는 감지 대상이 아니다.** 감지는 레포 루트의 `pubspec.yaml`/`android/app/build.gradle`/`app.json`만 읽는다. `--paths flutter=app`처럼 타입별 하위 경로가 있는 모노레포에서는 루트에 해당 파일이 없으므로 조용히 `null`(경고 없이 — "이 타입이 아님"과 구분이 안 됨)로 폴백해 결국 `1`이 된다. 기존 `monorepo` e2e fixture(예: `tests/fixtures/e2e/monorepo/app/pubspec.yaml`)로는 이 사실이 드러나지 않으므로 테스트가 깨지진 않지만, 실제 모노레포 사용자는 이슈 #41과 동일한 결함을 여전히 겪는다. 별도 이슈로 다룬다.
- **react-native-expo의 기존 e2e 테스트에 새 stderr 경고가 추가된다.** `tests/fixtures/e2e/react-native-expo/app.json`에 `expo.android.versionCode`가 없으므로, Task 3 적용 후 기존 `e2e react-native-expo` 매트릭스 테스트 실행 시 stderr에 새 경고가 찍힌다. 어떤 테스트도 stderr 내용을 단언하지 않으므로 테스트는 깨지지 않지만, CI 로그에 새 경고 줄이 보이는 것은 정상 동작이다.

## 최종 확인

- [ ] **전체 스위트 실행**

Run: `npm test`
Expected: PASS (`test:node` + `test:py` 모두 그린)

- [ ] **이슈 #41 원본 재현 시나리오 수동 확인 (선택, 권장)**

```bash
mkdir -p /tmp/paw-issue41-check && cd /tmp/paw-issue41-check
git init -q
printf 'name: check\nversion: 1.2.39+71\n' > pubspec.yaml
node <path-to-repo>/bin/project-auto-wizard.js --mode full --force --type flutter --main-branch main --develop-branch develop
grep version_code version.yml
```

Expected: `version_code: 71` (기존에는 `version_code: 1`이었던 것이 이슈의 핵심 결함)
