# CLI 옵션 파싱/검증 비일관 5건 수정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `--paths`/`--type`/`--main-branch`/`--develop-branch`/`--nexus`류 CLI 옵션의 검증 누락·비일관 5건(이슈 #21: M3, M4, L5, L6, L7)을 모두 `CliError`로 즉시 거부(exit 1)하도록 통일한다.

**Architecture:** 변경은 `src/cli/args.js`(파싱 시점 검증: L5, L6, L7)와 `src/core/paths-resolve.js`(경로 확정 시점 검증: M3, M4) 두 파일에 국한된다. `src/index.js`는 `resolveProjectPaths()` 호출부에 `CliError` 캐치를 한 곳 추가하는 것 외에는 손대지 않는다(§Task 4 참고 — 이 캐치 추가가 M3/M4의 `CliError`가 실제로 exit 1로 이어지기 위한 전제조건).

**Tech Stack:** Node.js (ESM), `node:test`/`node:assert`(내장 테스트 러너), `node:fs`/`node:os`/`node:path`의 `mkdtempSync` 기반 임시 디렉터리 픽스처.

## Global Constraints

- 커밋 메시지: 표준 Conventional Commits, 한국어 설명 (`fix: ...`, `test: ...`) — 타입 접두사만 영어, 그 외 전부 한국어. 각 Task의 "Step: Commit"에 정확한 메시지를 명시한다.
- 에러 타입은 항상 기존 `CliError`(export from `src/cli/args.js`)를 재사용한다 — 신규 에러 클래스를 만들지 않는다.
- 대화형 모드(TTY, `--force` 없음)의 기존 UX(`resolveProjectPaths`의 ⑤-b 분기: select 메뉴, 직접 입력 루프)는 이번 계획에서 전혀 수정하지 않는다.
- 테스트는 `node --test "tests/node/**/*.test.js"`(package.json의 `test:node` 스크립트)로 실행한다.
- 참고 스펙: `docs/superpowers/specs/2026-08-04-cli-args-validation-consistency-design.md`

---

## Task 1: L5 — `--type`/`--paths` 타입명 공백 정규화 통일

**Files:**
- Modify: `src/cli/args.js:117`
- Test: `tests/node/args-validation.test.js` (신규 생성)

**Interfaces:**
- Consumes: 없음 (기존 `parsePathsCsv(csv: string): Map<string, string>` — `src/cli/args.js`에 이미 export됨)
- Produces: 없음 (동작 변경만, 시그니처 불변)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/args-validation.test.js` 파일을 새로 만든다:

```js
// tests/node/args-validation.test.js
import { test } from "node:test";
import assert from "node:assert";
import { parseArgs, parsePathsCsv, CliError } from "../../src/cli/args.js";

// ── L5: --type/--paths 타입명 내부 공백 처리 통일 ──────────────────
test("parsePathsCsv: 타입명 내부 공백은 --type과 동일하게 전부 제거되어 정규화된다", () => {
  const map = parsePathsCsv("re act=.");
  assert.strictEqual(map.get("react"), ".");
});

test("parsePathsCsv: 여러 항목 중 하나에만 내부 공백이 있어도 정상 정규화된다", () => {
  const map = parsePathsCsv("flutter=app,re act=client");
  assert.strictEqual(map.get("flutter"), "app");
  assert.strictEqual(map.get("react"), "client");
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test tests/node/args-validation.test.js`
Expected: FAIL — `parsePathsCsv("re act=.")`는 현재 `.trim()`만 적용되어 `type`이 `"re act"`로 남고, `VALID_TYPES`에 없으므로 `CliError: --paths에 지원하지 않는 타입: 're act'`가 던져져 테스트가 예외로 실패한다.

- [ ] **Step 3: 최소 구현**

`src/cli/args.js:117`을 수정한다:

```js
// 변경 전
    const type = (eq >= 0 ? pair.slice(0, eq) : pair).trim();
// 변경 후
    const type = (eq >= 0 ? pair.slice(0, eq) : pair).replace(/\s/g, "");
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/node/args-validation.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/cli/args.js tests/node/args-validation.test.js
git commit -m "$(cat <<'EOF'
fix: --paths 타입명 공백 정규화를 --type과 동일하게 통일

--type은 내부 공백을 전부 제거해 정규화하는데 --paths의 타입명 파싱은
양끝 trim만 적용해 're act' 같은 입력이 서로 다르게 처리되던 문제를 수정.
EOF
)"
```

---

## Task 2: L6 — `--main-branch`/`--develop-branch` 빈 문자열 명시 거부

**Files:**
- Modify: `src/cli/args.js:84-85`
- Test: `tests/node/args-validation.test.js`

**Interfaces:**
- Consumes: 없음
- Produces: `parseArgs(argv: string[]): { mainBranch: string, developBranch: string, ... }` — 값이 있는 경우에만 필드가 채워짐(변경 없음). 빈 값 지정 시 `CliError` throw(신규).

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/args-validation.test.js`에 추가:

```js
// ── L6: --main-branch/--develop-branch 빈 문자열 명시 거부 ──────────
test("parseArgs: --main-branch \"\"(빈 값 명시)는 CliError를 던진다", () => {
  assert.throws(() => parseArgs(["--main-branch", ""]), CliError);
});

test("parseArgs: --main-branch가 인자 없이 끝에 오면(값 누락) CliError를 던진다", () => {
  assert.throws(() => parseArgs(["--main-branch"]), CliError);
});

test("parseArgs: --develop-branch \"\"(빈 값 명시)는 CliError를 던진다", () => {
  assert.throws(() => parseArgs(["--develop-branch", ""]), CliError);
});

test("parseArgs: --main-branch/--develop-branch를 아예 지정하지 않으면 기본값 \"\"로 통과한다", () => {
  const opts = parseArgs([]);
  assert.strictEqual(opts.mainBranch, "");
  assert.strictEqual(opts.developBranch, "");
});

test("parseArgs: --main-branch/--develop-branch에 값을 지정하면 그대로 반영된다", () => {
  const opts = parseArgs(["--main-branch", "release", "--develop-branch", "dev"]);
  assert.strictEqual(opts.mainBranch, "release");
  assert.strictEqual(opts.developBranch, "dev");
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test tests/node/args-validation.test.js`
Expected: FAIL — 현재 `result.mainBranch = args.shift() ?? ""`는 빈 문자열/undefined 모두 조용히 `""`로 받아들여 `CliError`를 던지지 않는다. "빈 값 명시" 두 테스트가 실패한다.

- [ ] **Step 3: 최소 구현**

`src/cli/args.js:84-85`를 수정한다:

```js
// 변경 전
      case "--main-branch": result.mainBranch = args.shift() ?? ""; break;
      case "--develop-branch": result.developBranch = args.shift() ?? ""; break;
// 변경 후
      case "--main-branch": {
        const v = args.shift();
        if (!v) throw new CliError("--main-branch에 빈 값을 지정할 수 없습니다");
        result.mainBranch = v; break;
      }
      case "--develop-branch": {
        const v = args.shift();
        if (!v) throw new CliError("--develop-branch에 빈 값을 지정할 수 없습니다");
        result.developBranch = v; break;
      }
```

플래그 자체가 argv에 없으면 이 `case`에 전혀 진입하지 않으므로, "미지정 → 기본값 `\"\"`" 동작은 그대로 유지된다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/node/args-validation.test.js`
Expected: PASS (모든 테스트)

- [ ] **Step 5: 커밋**

```bash
git add src/cli/args.js tests/node/args-validation.test.js
git commit -m "$(cat <<'EOF'
fix: --main-branch/--develop-branch 빈 문자열 명시 지정을 거부

'--main-branch ""'처럼 빈 값을 명시해도 미지정과 동일하게 자동감지값으로
조용히 폴백되던 문제를 파싱 시점에서 즉시 거부하도록 수정.
EOF
)"
```

---

## Task 3: L7 — `--nexus`/`--secret-backup`/`--semver-auto` 상호 모순 플래그 거부

**Files:**
- Modify: `src/cli/args.js:34-37, 77-82`
- Test: `tests/node/args-validation.test.js`

**Interfaces:**
- Consumes: 없음
- Produces: `parseArgs(argv)`가 모순되는 on/off 쌍이 동시에 있으면 `CliError`를 던짐(신규). 단독 지정 시 기존 `includeNexus`/`includeSecretBackup`/`includeSemverAuto` 필드 동작은 불변.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/args-validation.test.js`에 추가:

```js
// ── L7: --nexus/--secret-backup/--semver-auto 상호 모순 플래그 거부 ──
test("parseArgs: --nexus --no-nexus 동시 지정은 CliError를 던진다", () => {
  assert.throws(() => parseArgs(["--nexus", "--no-nexus"]), CliError);
});

test("parseArgs: --no-nexus --nexus (순서 반대)도 CliError를 던진다", () => {
  assert.throws(() => parseArgs(["--no-nexus", "--nexus"]), CliError);
});

test("parseArgs: --secret-backup --no-secret-backup 동시 지정은 CliError를 던진다", () => {
  assert.throws(() => parseArgs(["--secret-backup", "--no-secret-backup"]), CliError);
});

test("parseArgs: --semver-auto --no-semver-auto 동시 지정은 CliError를 던진다", () => {
  assert.throws(() => parseArgs(["--semver-auto", "--no-semver-auto"]), CliError);
});

test("parseArgs: --nexus 단독 지정은 정상 통과한다", () => {
  const opts = parseArgs(["--nexus"]);
  assert.strictEqual(opts.includeNexus, true);
});

test("parseArgs: --no-secret-backup 단독 지정은 정상 통과한다", () => {
  const opts = parseArgs(["--no-secret-backup"]);
  assert.strictEqual(opts.includeSecretBackup, false);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test tests/node/args-validation.test.js`
Expected: FAIL — 현재 각 플래그는 `result.includeNexus`(등)를 단순 재할당하기만 해서 모순 검증 로직이 없어 `CliError`가 던져지지 않는다. 앞의 4개 "동시 지정" 테스트가 실패한다.

- [ ] **Step 3: 최소 구현**

`src/cli/args.js:34` 부근(`const args = [...argv];` 다음 줄)에 추가:

```js
  const args = [...argv];
  const seenFlags = new Set(); // L7: --nexus류 상호 모순 플래그 검증용
```

`src/cli/args.js:77-82`를 수정한다:

```js
// 변경 전
      case "--nexus": result.includeNexus = true; break;
      case "--no-nexus": result.includeNexus = false; break;
      case "--secret-backup": result.includeSecretBackup = true; break;
      case "--no-secret-backup": result.includeSecretBackup = false; break;
      case "--semver-auto": result.includeSemverAuto = true; break;
      case "--no-semver-auto": result.includeSemverAuto = false; break;
// 변경 후
      case "--nexus":
        if (seenFlags.has("--no-nexus")) throw new CliError("--nexus와 --no-nexus는 동시에 지정할 수 없습니다");
        seenFlags.add("--nexus"); result.includeNexus = true; break;
      case "--no-nexus":
        if (seenFlags.has("--nexus")) throw new CliError("--nexus와 --no-nexus는 동시에 지정할 수 없습니다");
        seenFlags.add("--no-nexus"); result.includeNexus = false; break;
      case "--secret-backup":
        if (seenFlags.has("--no-secret-backup")) throw new CliError("--secret-backup와 --no-secret-backup은 동시에 지정할 수 없습니다");
        seenFlags.add("--secret-backup"); result.includeSecretBackup = true; break;
      case "--no-secret-backup":
        if (seenFlags.has("--secret-backup")) throw new CliError("--secret-backup와 --no-secret-backup은 동시에 지정할 수 없습니다");
        seenFlags.add("--no-secret-backup"); result.includeSecretBackup = false; break;
      case "--semver-auto":
        if (seenFlags.has("--no-semver-auto")) throw new CliError("--semver-auto와 --no-semver-auto는 동시에 지정할 수 없습니다");
        seenFlags.add("--semver-auto"); result.includeSemverAuto = true; break;
      case "--no-semver-auto":
        if (seenFlags.has("--semver-auto")) throw new CliError("--semver-auto와 --no-semver-auto는 동시에 지정할 수 없습니다");
        seenFlags.add("--no-semver-auto"); result.includeSemverAuto = false; break;
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/node/args-validation.test.js`
Expected: PASS (모든 테스트)

- [ ] **Step 5: 커밋**

```bash
git add src/cli/args.js tests/node/args-validation.test.js
git commit -m "$(cat <<'EOF'
fix: --nexus/--secret-backup/--semver-auto 모순 플래그 동시 지정 거부

각 on/off 플래그 쌍이 검증 없이 마지막 값으로 조용히 덮어써지던 문제를
수정. 이슈에 명시된 --nexus 쌍뿐 아니라 동일한 파싱 패턴을 쓰는
--secret-backup/--semver-auto 쌍도 함께 검증한다.
EOF
)"
```

---

## Task 4: `src/index.js`의 `resolveProjectPaths()` 호출부에 `CliError` 캐치 추가 (M3/M4 선행 작업)

**왜 필요한가:** `src/index.js`의 `parseArgs()` 호출(69~74행)만 `CliError`를 캐치하고 있다. `resolveProjectPaths()` 호출(현재 244~247행)과 그 인자로 인라인 호출되는 `parsePathsCsv(opts.pathsCsv)`는 이 캐치 범위 밖에 있어서, 여기서 던져지는 `CliError`(Task 5·6에서 추가할 M3/M4 검증 포함, 및 이미 존재하던 `parsePathsCsv`의 타입 검증 에러까지)는 캐치되지 않고 `run()`의 반환 Promise가 그대로 reject된다. `bin/project-auto-wizard.js`는 `run()`을 try/catch 없이 호출하므로, 이 경우 깔끔한 "에러 메시지 + exit 1" 대신 처리되지 않은 예외 스택트레이스가 출력된다. Task 5(M3)에서 새 `CliError` throw를 추가하기 전에 이 캐치를 먼저 마련해야 한다.

**Files:**
- Modify: `src/index.js:243-247`
- Test: `tests/node/paths-resolve.test.js` (신규 생성)

**Interfaces:**
- Consumes: `resolveProjectPaths()`(`src/core/paths-resolve.js`, 시그니처 불변), `CliError`(`src/cli/args.js`, 이미 `src/index.js` 8행에서 import됨)
- Produces: 없음 (동작 변경만)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/paths-resolve.test.js` 파일을 새로 만든다. 기존 `parsePathsCsv`의 타입 검증이 이 경로를 통해 깔끔하게 exit 1로 이어지는지를 먼저 확인하는 통합 테스트로 시작한다(이 버그는 이슈 #21 범위 밖의 기존 결함이지만, Task 5/6에서 추가할 검증과 정확히 같은 호출부를 지나가므로 여기서 함께 확인한다):

```js
// tests/node/paths-resolve.test.js
import { test } from "node:test";
import assert from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "../../src/index.js";
import { CliError } from "../../src/cli/args.js";
import { resolveProjectPaths } from "../../src/core/paths-resolve.js";

function tmpRepo(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(dir, ".git"));
  return dir;
}

// ── Task 4: resolveProjectPaths() 호출부 CliError 캐치 ──────────────
test("run(): --paths에 지원하지 않는 타입을 지정하면 스택트레이스 없이 exit 1로 깔끔하게 거부된다", async () => {
  const target = tmpRepo("paw-paths-resolve-");
  try {
    const code = await run(
      ["--mode", "full", "--force", "--type", "node", "--paths", "not-a-type=."],
      { cwd: target, clock: { now: "2026-08-04 00:00:00", today: "2026-08-04" } },
    );
    assert.strictEqual(code, 1);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test tests/node/paths-resolve.test.js`
Expected: FAIL — `parsePathsCsv("not-a-type=.")`가 `CliError`를 던지지만 `resolveProjectPaths()` 호출부가 캐치하지 않아 `run()`의 Promise가 reject되고, `await run(...)`가 테스트 안에서 예외를 던져 테스트가 실패한다(assert 실패가 아니라 uncaught rejection으로 실패).

- [ ] **Step 3: 최소 구현**

`src/index.js:243-247`을 수정한다:

```js
// 변경 전
  // 경로 확정 (.sh resolve_project_paths 비대화형 경로 — --paths 우선 → 저장값 → 후보 1개 자동 → 루트 폴백)
  const paths = await resolveProjectPaths({
    root: cwd, types, paths: parsePathsCsv(opts.pathsCsv),
    existingPaths: existing?.paths ?? new Map(), force: true, tty: false, io: {},
  });
// 변경 후
  // 경로 확정 (.sh resolve_project_paths 비대화형 경로 — --paths 우선 → 저장값 → 후보 1개 자동 → 루트 폴백)
  let paths;
  try {
    paths = await resolveProjectPaths({
      root: cwd, types, paths: parsePathsCsv(opts.pathsCsv),
      existingPaths: existing?.paths ?? new Map(), force: true, tty: false, io: {},
    });
  } catch (e) {
    if (e instanceof CliError) { console.error(e.message); return 1; }
    throw e;
  }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/node/paths-resolve.test.js`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/index.js tests/node/paths-resolve.test.js
git commit -m "$(cat <<'EOF'
fix: resolveProjectPaths() 호출부의 CliError를 exit 1로 정상 캐치

parseArgs() 호출만 CliError를 캐치하고 있어, --paths 처리 중 던져지는
CliError(기존 타입 검증 및 이후 추가될 경로 존재/후보 검증 포함)가
처리되지 않은 예외로 새어나가던 문제를 수정.
EOF
)"
```

---

## Task 5: M3 — `--paths`로 지정한 경로의 존재 여부 검증

**Files:**
- Modify: `src/core/paths-resolve.js:13, 147-151`
- Test: `tests/node/paths-resolve.test.js`

**Interfaces:**
- Consumes: `CliError`(`src/cli/args.js`, 신규 import), `existsSync`/`join`(이미 import됨)
- Produces: `resolveProjectPaths(opts): Promise<Map<string, string>>` — `paths` 인자로 전달된 경로가 실제 디스크에 없으면 `CliError`로 reject(신규). 존재하면 기존과 동일하게 동작.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/paths-resolve.test.js`에 추가:

```js
// ── M3: --paths로 지정한 경로의 존재 여부 검증 ──────────────────────
test("resolveProjectPaths: --paths로 지정한 경로가 존재하지 않으면 CliError로 거부한다", async () => {
  const root = mkdtempSync(join(tmpdir(), "paw-paths-resolve-"));
  try {
    await assert.rejects(
      () => resolveProjectPaths({
        root, types: ["react"],
        paths: new Map([["react", "does-not-exist"]]),
        existingPaths: new Map(), force: true, tty: false, io: {},
      }),
      CliError,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveProjectPaths: --paths로 지정한 경로가 실제로 존재하면 그대로 확정된다", async () => {
  const root = mkdtempSync(join(tmpdir(), "paw-paths-resolve-"));
  try {
    mkdirSync(join(root, "client"));
    const result = await resolveProjectPaths({
      root, types: ["react"],
      paths: new Map([["react", "client"]]),
      existingPaths: new Map(), force: true, tty: false, io: {},
    });
    assert.strictEqual(result.get("react"), "client");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test tests/node/paths-resolve.test.js`
Expected: FAIL — 첫 번째 테스트: 현재 우선순위 ① 분기(`if (result.get(t)) { say(...); continue; }`)는 존재 여부를 확인하지 않아 `CliError`가 던져지지 않고 정상적으로 `.set()`까지 진행돼 `assert.rejects`가 실패한다.

- [ ] **Step 3: 최소 구현**

`src/core/paths-resolve.js:13`을 수정한다:

```js
// 변경 전
import { normalizePath } from "../cli/args.js";
// 변경 후
import { normalizePath, CliError } from "../cli/args.js";
```

`src/core/paths-resolve.js:147-151`을 수정한다:

```js
// 변경 전
    // ① --paths 등으로 이미 지정됨 → 최우선 (.sh L1441~1446)
    if (result.get(t)) {
      say(`  ${t} → ${result.get(t)} (--paths 지정)`);
      continue;
    }
// 변경 후
    // ① --paths 등으로 이미 지정됨 → 최우선 (.sh L1441~1446)
    if (result.get(t)) {
      const p = result.get(t);
      if (!existsSync(join(root, p))) {
        throw new CliError(`--paths로 지정한 경로가 존재하지 않습니다: '${t}=${p}'`);
      }
      say(`  ${t} → ${p} (--paths 지정)`);
      continue;
    }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/node/paths-resolve.test.js`
Expected: PASS (모든 테스트)

- [ ] **Step 5: 커밋**

```bash
git add src/core/paths-resolve.js tests/node/paths-resolve.test.js
git commit -m "$(cat <<'EOF'
fix: --paths로 지정한 경로가 존재하지 않으면 거부하도록 수정

--paths로 지정한 경로의 존재 여부를 전혀 검증하지 않아 존재하지 않는
경로가 version.yml에 그대로 기록되던 문제를 수정. 경로가 실제로 없으면
CliError로 즉시 거부한다.
EOF
)"
```

---

## Task 6: M4 — 모노레포 경로 후보 0개(감지 실패)/2개 이상(모호함) 구분 거부

**Files:**
- Modify: `src/core/paths-resolve.js:169-182`
- Test: `tests/node/paths-resolve.test.js`

**Interfaces:**
- Consumes: `CliError`(Task 5에서 이미 import 완료), `findTypePathCandidates`(같은 파일 내 기존 함수, 시그니처 불변)
- Produces: `resolveProjectPaths(opts)` — 비대화형(`force: true` 또는 `tty: false`) 경로에서 후보가 0개 또는 2개 이상이면 `CliError`로 reject(신규, 기존 "경고 후 루트로 폴백" 동작 제거). 후보 1개 또는 기존 저장값이 있는 경우는 기존과 동일.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/paths-resolve.test.js`에 추가:

```js
// ── M4: 모노레포 경로 후보 0개/2개 이상 구분 거부 ────────────────────
test("resolveProjectPaths: 경로 후보가 0개(감지 실패)면 CliError로 거부한다", async () => {
  const root = mkdtempSync(join(tmpdir(), "paw-paths-resolve-"));
  try {
    // pubspec.yaml은 있지만 lib/가 없어 flutter 후보 필터에서 걸러짐 → 후보 0개
    mkdirSync(join(root, "app"));
    writeFileSync(join(root, "app", "pubspec.yaml"), "name: demo\n");
    await assert.rejects(
      () => resolveProjectPaths({
        root, types: ["flutter"], paths: new Map(),
        existingPaths: new Map(), force: true, tty: false, io: {},
      }),
      CliError,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveProjectPaths: 경로 후보가 2개 이상(모호함)이면 CliError로 거부한다", async () => {
  const root = mkdtempSync(join(tmpdir(), "paw-paths-resolve-"));
  try {
    mkdirSync(join(root, "client"));
    writeFileSync(join(root, "client", "package.json"), "{}\n");
    mkdirSync(join(root, "admin"));
    writeFileSync(join(root, "admin", "package.json"), "{}\n");
    await assert.rejects(
      () => resolveProjectPaths({
        root, types: ["react"], paths: new Map(),
        existingPaths: new Map(), force: true, tty: false, io: {},
      }),
      CliError,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveProjectPaths: 경로 후보가 정확히 1개면 정상적으로 자동 확정된다(회귀 확인)", async () => {
  const root = mkdtempSync(join(tmpdir(), "paw-paths-resolve-"));
  try {
    mkdirSync(join(root, "client"));
    writeFileSync(join(root, "client", "package.json"), "{}\n");
    const result = await resolveProjectPaths({
      root, types: ["react"], paths: new Map(),
      existingPaths: new Map(), force: true, tty: false, io: {},
    });
    assert.strictEqual(result.get("react"), "client");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test tests/node/paths-resolve.test.js`
Expected: FAIL — 앞의 두 테스트(0개/2개 이상)는 현재 코드가 경고만 출력하고 `chosen = "."`으로 정상 확정해버려 `assert.rejects`가 실패한다.

- [ ] **Step 3: 최소 구현**

`src/core/paths-resolve.js:169-182`를 수정한다:

```js
// 변경 전
    if (force || !tty) {
      if (existing) {
        chosen = existing;
        say(`  ${t} → ${chosen} (기존 project_paths 유지)`);
      } else if (candidates.length === 1) {
        chosen = candidates[0];
        say(`  ${t} → ${chosen} (자동 감지)`);
      } else {
        chosen = ".";
        say(`  ⚠️ ${t} → 후보 ${candidates.length}개로 자동 확정 불가, 루트(.)로 기록 (--paths "${t}=경로"로 지정 가능)`);
      }
      result.set(t, chosen);
      continue;
    }
// 변경 후
    if (force || !tty) {
      if (existing) {
        chosen = existing;
        say(`  ${t} → ${chosen} (기존 project_paths 유지)`);
      } else if (candidates.length === 1) {
        chosen = candidates[0];
        say(`  ${t} → ${chosen} (자동 감지)`);
      } else if (candidates.length === 0) {
        throw new CliError(`${t}: 프로젝트 경로를 찾지 못했습니다. --paths "${t}=경로"로 직접 지정하세요.`);
      } else {
        throw new CliError(`${t}: 경로 후보가 ${candidates.length}개로 모호합니다(${candidates.join(", ")}). --paths "${t}=경로"로 직접 지정하세요.`);
      }
      result.set(t, chosen);
      continue;
    }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/node/paths-resolve.test.js`
Expected: PASS (모든 테스트)

- [ ] **Step 5: 기존 테스트가 "후보 0개 → 루트 폴백"에 암묵적으로 의존하고 있었는지 전체 스위트로 확인**

Run: `npm run test:node`
Expected: **FAIL** — Step 3의 변경 전에는 몰랐던 광범위한 회귀가 여기서 드러난다. 마커 파일(예: `package.json`) 없는 bare 임시 디렉터리에 `--force --type node`(또는 `spring`)로 설치하던 기존 테스트들은, 과거엔 "후보 0개 → 경고 후 루트(.)로 자동 확정"이라는 관대한 폴백 덕분에 통과했다. 이 폴백이 Step 3에서 `CliError`로 바뀌었으므로, 그 관대함에 의존하던 테스트들이 이제 실패한다. 전체 스위트를 grep(`--force`+`--type` 동시 사용 파일)해 아래 8개 파일을 특정했다:

- `tests/node/e2e-matrix.test.js` — `tests/fixtures/e2e/react-native/` fixture에 루트 마커(package.json)가 없어서 실패 (영향 있음)
- `tests/node/dry-run-cli.test.js` — 4개 테스트 영향 (아래 Step 6-1)
- `tests/node/mode-force-gate.test.js` — 1개 테스트 영향 (아래 Step 6-2)
- `tests/node/semver-auto-cli.test.js` — 3개 테스트 영향 (아래 Step 6-3)
- `tests/node/summary-accuracy-cli.test.js` — 2개 테스트 영향 (아래 Step 6-4)
- `tests/node/uninstall-cli.test.js` — 헬퍼 1곳 수정으로 3개 테스트 해결 (아래 Step 6-5)
- `tests/node/purge-cli.test.js` — 헬퍼 2곳 + 독립 테스트 1곳 (아래 Step 6-6)
- `tests/node/mode-validation.test.js` — **영향 없음** (유일한 `run()` 호출이 잘못된 `--mode` 값 검증용이라 경로 해석 이전에 이미 거부됨 — 수정 불필요, 확인만)

각 파일에서 "마커 없는 bare 디렉터리 + `--force --type <t>` + 설치 성공(`code === 0`) 기대"인 테스트만 영향받는다. `--force` 없이 거부를 기대하는 테스트(예: `mode-force-gate.test.js`의 나머지 5개)는 경로 해석 이전 단계(`--force` 게이트)에서 이미 걸러지므로 영향이 없다 — 아래 Step 6에서 정확히 그 구분대로만 수정한다.

- [ ] **Step 6: 영향받는 fixture/헬퍼에 루트 마커 파일 추가**

**6-1. `tests/node/dry-run-cli.test.js`** — import에 `writeFileSync` 추가:

```js
// 변경 전
import { mkdtempSync, existsSync, rmSync } from "node:fs";
// 변경 후
import { mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
```

아래 4개 테스트 각각에 `mkdtempSync` 직후 마커 라인을 추가한다(패턴 동일, 테스트명으로 구분):

```js
// 변경 전 (4곳 공통 패턴)
  const target = mkdtempSync(join(tmpdir(), "paw-dry-cli-"));
  try {
// 변경 후 (4곳 공통 패턴)
  const target = mkdtempSync(join(tmpdir(), "paw-dry-cli-"));
  writeFileSync(join(target, "package.json"), "{}\n"); // M4: 경로 후보 0개 방지용 루트 마커
  try {
```

적용 대상(각 `test(...)` 선언 바로 다음 줄의 위 패턴에 적용 — 4곳 모두 동일 패턴이므로 각 `test("...")` 이름으로 위치를 구분해 개별 적용한다):
- `"run(): --dry-run --mode full writes nothing to an empty target"`
- `"run(): --dry-run without --force bypasses the non-interactive --force gate"`
- `"run(): --dry-run --mode revert on an installed repo removes nothing"`
- `"run(): --dry-run --mode revert without --force also bypasses the --force gate"`

다음 2곳은 **적용하지 않는다**(경로 해석 이전에 거부되므로 영향 없음):
- `"run(): --dry-run with no --mode (interactive) errors instead of running the live wizard"` (`--mode` 미지정 → interactive 분기로 조기 반환)
- `"run(): non-dry-run without --force still requires --force in a non-interactive environment"` (`--force`/`--dry-run` 둘 다 없어 게이트에서 즉시 거부)

**6-2. `tests/node/mode-force-gate.test.js`** — import에 `writeFileSync` 추가:

```js
// 변경 전
import { mkdtempSync, rmSync, existsSync } from "node:fs";
// 변경 후
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
```

`"run(): TTY 환경이라도 --force가 있으면 full 모드가 정상 진행된다"` 테스트 1곳만 수정(나머지 5개는 `--force` 없이 거부를 기대하는 테스트라 영향 없음):

```js
// 변경 전
test("run(): TTY 환경이라도 --force가 있으면 full 모드가 정상 진행된다", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-tty-full-force-"));
  try {
// 변경 후
test("run(): TTY 환경이라도 --force가 있으면 full 모드가 정상 진행된다", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-tty-full-force-"));
  writeFileSync(join(target, "package.json"), "{}\n"); // M4: 경로 후보 0개 방지용 루트 마커
  try {
```

**6-3. `tests/node/semver-auto-cli.test.js`** — `writeFileSync`는 이미 import되어 있음. 3개 테스트 각각에 추가:

```js
// 변경 전
test("run(): --no-semver-auto propagates to installed version.yml", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-semver-cli-"));
  try {
// 변경 후
test("run(): --no-semver-auto propagates to installed version.yml", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-semver-cli-"));
  writeFileSync(join(target, "package.json"), "{}\n"); // M4: 경로 후보 0개 방지용 루트 마커
  try {
```

```js
// 변경 전
test("run(): omitted flag defaults to semver_auto: true", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-semver-cli-"));
  try {
// 변경 후
test("run(): omitted flag defaults to semver_auto: true", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-semver-cli-"));
  writeFileSync(join(target, "package.json"), "{}\n"); // M4: 경로 후보 0개 방지용 루트 마커
  try {
```

```js
// 변경 전
test("run(): re-installing over a version.yml predating semver_auto (no key) safely defaults to false, not true", async () => {
  // 기존 설치(semver_auto 기능 이전에 만들어진 version.yml)를 CLI로 재통합하면,
  // 애매한 커밋 하나로 조용히 major가 승격되지 않도록 false로 안전하게 폴백해야 한다
  // (완전 신규 설치만 true — 아래 "omitted flag defaults to semver_auto: true"와 대비).
  const target = mkdtempSync(join(tmpdir(), "paw-semver-cli-"));
  try {
// 변경 후
test("run(): re-installing over a version.yml predating semver_auto (no key) safely defaults to false, not true", async () => {
  // 기존 설치(semver_auto 기능 이전에 만들어진 version.yml)를 CLI로 재통합하면,
  // 애매한 커밋 하나로 조용히 major가 승격되지 않도록 false로 안전하게 폴백해야 한다
  // (완전 신규 설치만 true — 아래 "omitted flag defaults to semver_auto: true"와 대비).
  const target = mkdtempSync(join(tmpdir(), "paw-semver-cli-"));
  writeFileSync(join(target, "package.json"), "{}\n"); // M4: 경로 후보 0개 방지용 루트 마커
  try {
```

**6-4. `tests/node/summary-accuracy-cli.test.js`** — import에 `writeFileSync` 추가, 마커는 `spring` 타입이므로 `build.gradle`:

```js
// 변경 전
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
// 변경 후
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from "node:fs";
```

```js
// 변경 전
test("run(): full 모드 완료 요약의 '새로 설치됨' 목록이 실제 생성된 워크플로우 파일과 정확히 일치한다", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-summary-accuracy-"));
  try {
// 변경 후
test("run(): full 모드 완료 요약의 '새로 설치됨' 목록이 실제 생성된 워크플로우 파일과 정확히 일치한다", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-summary-accuracy-"));
  writeFileSync(join(target, "build.gradle"), ""); // M4: 경로 후보 0개 방지용 루트 마커 (spring)
  try {
```

```js
// 변경 전
test("run(): 동일 옵션으로 재실행하면(전부 unchanged) '새로 설치됨' 목록이 아예 뜨지 않는다", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-summary-rerun-"));
  try {
// 변경 후
test("run(): 동일 옵션으로 재실행하면(전부 unchanged) '새로 설치됨' 목록이 아예 뜨지 않는다", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-summary-rerun-"));
  writeFileSync(join(target, "build.gradle"), ""); // M4: 경로 후보 0개 방지용 루트 마커 (spring)
  try {
```

**6-5. `tests/node/uninstall-cli.test.js`** — 공용 헬퍼 1곳만 고치면 이 헬퍼를 쓰는 3개 테스트가 전부 해결된다(`writeFileSync`는 이미 import되어 있음):

```js
// 변경 전
function emptyTarget() {
  return mkdtempSync(join(tmpdir(), "paw-uninstall-cli-"));
}
// 변경 후
function emptyTarget() {
  const target = mkdtempSync(join(tmpdir(), "paw-uninstall-cli-"));
  writeFileSync(join(target, "package.json"), "{}\n"); // M4: 경로 후보 0개 방지용 루트 마커
  return target;
}
```

**6-6. `tests/node/purge-cli.test.js`** — `writeFileSync`는 이미 import되어 있음. 헬퍼 2곳 + 독립 테스트 1곳:

```js
// 변경 전
async function installedTarget() {
  const target = mkdtempSync(join(tmpdir(), "paw-purge-cli-"));
  mkdirSync(join(target, ".git"));
  await run(["--mode", "full", "--force", "--type", "node"], {
    cwd: target, clock: { now: "2026-07-28 00:00:00", today: "2026-07-28" },
  });
  return target;
}
// 변경 후
async function installedTarget() {
  const target = mkdtempSync(join(tmpdir(), "paw-purge-cli-"));
  mkdirSync(join(target, ".git"));
  writeFileSync(join(target, "package.json"), "{}\n"); // M4: 경로 후보 0개 방지용 루트 마커
  await run(["--mode", "full", "--force", "--type", "node"], {
    cwd: target, clock: { now: "2026-07-28 00:00:00", today: "2026-07-28" },
  });
  return target;
}
```

```js
// 변경 전
async function installedTrunkBasedTarget() {
  const target = mkdtempSync(join(tmpdir(), "paw-purge-cli-"));
  mkdirSync(join(target, ".git"));
  await run(["--mode", "full", "--force", "--type", "node", "--develop-branch", "main"], {
    cwd: target, clock: { now: "2026-07-28 00:00:00", today: "2026-07-28" },
  });
  return target;
}
// 변경 후
async function installedTrunkBasedTarget() {
  const target = mkdtempSync(join(tmpdir(), "paw-purge-cli-"));
  mkdirSync(join(target, ".git"));
  writeFileSync(join(target, "package.json"), "{}\n"); // M4: 경로 후보 0개 방지용 루트 마커
  await run(["--mode", "full", "--force", "--type", "node", "--develop-branch", "main"], {
    cwd: target, clock: { now: "2026-07-28 00:00:00", today: "2026-07-28" },
  });
  return target;
}
```

```js
// 변경 전
test("run(): full round-trip — install then purge returns the target to its pre-install state", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-purge-cli-"));
  mkdirSync(join(target, ".git"));
  writeFileSync(join(target, "README.md"), "# Test\n");
  try {
    const before = listAllFilesCli(target);
// 변경 후
test("run(): full round-trip — install then purge returns the target to its pre-install state", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-purge-cli-"));
  mkdirSync(join(target, ".git"));
  writeFileSync(join(target, "README.md"), "# Test\n");
  writeFileSync(join(target, "package.json"), "{}\n"); // M4: 루트 마커 — before 스냅샷에 포함시켜야 라운드트립이 성립
  try {
    const before = listAllFilesCli(target);
```

**6-7. `tests/fixtures/e2e/react-native/package.json`** (신규 파일) — 이 fixture는 `ios/`·`android/`만 있고 실제 React Native 프로젝트라면 항상 있어야 할 루트 `package.json`이 원래 빠져 있었다:

```json
{
  "name": "demo-react-native"
}
```

(버전 필드는 의도적으로 넣지 않는다 — `detectVersion()`은 `package.json`에 유효한 `version` 필드가 없으면 기존과 동일하게 `build.gradle`/`pubspec.yaml`/`pyproject.toml`/git 태그를 거쳐 `"0.0.1"`로 폴백하므로, 버전 감지 동작은 이번 수정과 무관하게 그대로 유지된다.)

- [ ] **Step 7: 전체 스위트 재실행으로 회귀 해소 확인**

Run: `npm run test:node`
Expected: PASS (전체) — Step 5에서 실패했던 8개 파일 모두 통과해야 한다. 하나라도 여전히 실패하면 Step 6에서 놓친 마커 추가 위치가 있는지 실패 메시지의 파일:테스트명으로 다시 추적한다.

- [ ] **Step 8: 커밋**

```bash
git add src/core/paths-resolve.js tests/node/paths-resolve.test.js \
  tests/node/dry-run-cli.test.js tests/node/mode-force-gate.test.js \
  tests/node/semver-auto-cli.test.js tests/node/summary-accuracy-cli.test.js \
  tests/node/uninstall-cli.test.js tests/node/purge-cli.test.js \
  tests/fixtures/e2e/react-native/package.json
git commit -m "$(cat <<'EOF'
fix: 모노레포 경로 후보 0개/2개 이상을 구분해 거부하도록 수정

후보 0개(감지 실패)와 2개 이상(모호함)이 원인이 다른데도 동일하게
경고만 출력하고 조용히 루트(.)로 확정되던 문제를 수정. 비대화형
경로에서는 두 경우 모두 서로 다른 메시지의 CliError로 거부한다.

이 변경으로 마커 파일 없는 bare 디렉터리에서 "후보 0개 → 루트 폴백"에
암묵적으로 의존하던 기존 테스트(dry-run-cli, mode-force-gate,
semver-auto-cli, summary-accuracy-cli, uninstall-cli, purge-cli)와
react-native e2e fixture가 함께 깨져 있어, 각각에 루트 마커 파일을
추가해 원래 검증 의도를 유지하면서 회귀를 해소했다.
EOF
)"
```

---

## Task 7: 통합 회귀 검증 — 이슈 #21의 5개 재현 커맨드 + 전체 테스트 스위트

**Files:**
- Modify: `tests/node/paths-resolve.test.js` (이슈 재현 커맨드를 `run()` 레벨로 명시 검증하는 테스트 추가)
- Test: 전체 `tests/node/**/*.test.js`, `tests/py` (기존 스위트, 회귀 확인용 — 신규 작성 없음)

**Interfaces:**
- Consumes: `run()`(`src/index.js`, Task 1~6에서 이미 구현 완료)
- Produces: 없음 (검증 전용 Task)

- [ ] **Step 1: 이슈 재현 커맨드 5개를 `run()` 레벨 통합 테스트로 작성**

`tests/node/paths-resolve.test.js` 끝에 추가한다(각 테스트는 이슈 본문의 "🔄 재현 방법" 섹션의 실제 커맨드를 그대로 재현한다):

```js
// ── 이슈 #21 재현 커맨드 5개 최종 회귀 확인 ──────────────────────────
test("이슈 재현 ①(M3): --paths react=does-not-exist는 exit 1로 거부된다", async () => {
  const target = tmpRepo("paw-issue21-");
  try {
    const code = await run(
      ["--mode", "full", "--force", "--type", "react", "--paths", "react=does-not-exist"],
      { cwd: target, clock: { now: "2026-08-04 00:00:00", today: "2026-08-04" } },
    );
    assert.strictEqual(code, 1);
    assert.strictEqual(existsSync(join(target, "version.yml")), false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("이슈 재현 ②(M4, 후보 0개): flutter인데 lib/ 없이 pubspec.yaml만 있으면 exit 1로 거부된다", async () => {
  const target = tmpRepo("paw-issue21-");
  try {
    mkdirSync(join(target, "app"));
    writeFileSync(join(target, "app", "pubspec.yaml"), "name: demo\n");
    const code = await run(
      ["--mode", "full", "--force", "--type", "flutter"],
      { cwd: target, clock: { now: "2026-08-04 00:00:00", today: "2026-08-04" } },
    );
    assert.strictEqual(code, 1);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("이슈 재현 ②(M4, 후보 2개 이상): react 마커가 있는 디렉터리 2개면 exit 1로 거부된다", async () => {
  const target = tmpRepo("paw-issue21-");
  try {
    mkdirSync(join(target, "client"));
    writeFileSync(join(target, "client", "package.json"), "{}\n");
    mkdirSync(join(target, "admin"));
    writeFileSync(join(target, "admin", "package.json"), "{}\n");
    const code = await run(
      ["--mode", "full", "--force", "--type", "react"],
      { cwd: target, clock: { now: "2026-08-04 00:00:00", today: "2026-08-04" } },
    );
    assert.strictEqual(code, 1);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("이슈 재현 ③(L5): --paths \"re act=.\"는 --type과 동일하게 정규화되어 정상 설치된다", async () => {
  const target = tmpRepo("paw-issue21-");
  try {
    const code = await run(
      ["--mode", "full", "--force", "--type", "react", "--paths", "re act=."],
      { cwd: target, clock: { now: "2026-08-04 00:00:00", today: "2026-08-04" } },
    );
    assert.strictEqual(code, 0);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("이슈 재현 ④(L6): --main-branch \"\"는 exit 1로 거부된다", async () => {
  const target = tmpRepo("paw-issue21-");
  try {
    const code = await run(
      ["--mode", "full", "--force", "--type", "node", "--main-branch", ""],
      { cwd: target, clock: { now: "2026-08-04 00:00:00", today: "2026-08-04" } },
    );
    assert.strictEqual(code, 1);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("이슈 재현 ⑤(L7): --nexus --no-nexus 동시 지정은 exit 1로 거부된다", async () => {
  const target = tmpRepo("paw-issue21-");
  try {
    const code = await run(
      ["--mode", "full", "--force", "--type", "spring", "--nexus", "--no-nexus"],
      { cwd: target, clock: { now: "2026-08-04 00:00:00", today: "2026-08-04" } },
    );
    assert.strictEqual(code, 1);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 새 테스트만 먼저 통과하는지 확인**

Run: `node --test tests/node/paths-resolve.test.js`
Expected: PASS (Task 1~6이 모두 구현된 상태이므로 이 시점엔 바로 PASS해야 한다 — 실패하면 Task 1~6 중 누락된 변경이 있는지 확인한다)

- [ ] **Step 3: 전체 Node 테스트 스위트 실행**

Run: `npm run test:node`
Expected: PASS — 전체 스위트. 특히 다음 기존 파일들이 이번 변경으로 회귀하지 않는지 확인한다:
- `tests/node/e2e-matrix.test.js` (`--paths "flutter=app,react=client"` 사용 — fixture 경로가 실존하므로 M3 영향 없어야 함)
- `tests/node/purge-cli.test.js` (`--develop-branch "main"` 사용 — non-empty이므로 L6 영향 없어야 함)
- `tests/node/mode-validation.test.js`, `tests/node/semver-auto-cli.test.js`, `tests/node/semver-auto-option.test.js`

- [ ] **Step 4: 전체 테스트 스위트(Python 포함) 실행**

Run: `npm test`
Expected: PASS (`test:node` + `test:py` 모두)

- [ ] **Step 5: 커밋**

```bash
git add tests/node/paths-resolve.test.js
git commit -m "$(cat <<'EOF'
test: 이슈 #21 재현 커맨드 5건에 대한 run() 레벨 회귀 테스트 추가

M3/M4/L5/L6/L7 각각의 실제 재현 커맨드를 run() 통합 테스트로 고정해
이후 회귀를 방지한다.
EOF
)"
```

---

## 완료 후 확인 사항 (구현자 참고용, 별도 커밋 아님)

- 이슈 #21의 "✅ 예상 동작" 5개 항목이 모두 충족되는지 최종 확인:
  1. `--paths` 미존재 경로 → 거부 (Task 5)
  2. 후보 0개/2개 이상 → 구분되어 거부 (Task 6)
  3. `--type`/`--paths` 타입명 정규화 통일 (Task 1)
  4. `--main-branch ""` 명시 지정 → 미지정과 구분되어 거부 (Task 2)
  5. `--nexus --no-nexus` 모순 → 거부 (Task 3)
- 브랜치 `20260804_#21_paths_type_main_branch_nexus_옵션_파싱_검증이_서로_비일관하거나_아예_없음_5건`에서 PR을 만들 때, 이 계획 문서와 스펙 문서(`docs/superpowers/specs/2026-08-04-cli-args-validation-consistency-design.md`)를 함께 참조로 링크한다.
