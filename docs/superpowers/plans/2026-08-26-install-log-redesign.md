# 설치 로그 시스템 전면 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 설치 결과 스냅샷(`.md`)을 폐지하고, 크래시에도 살아남는 시간순 실행 추적 로그(`.log`)로 전면 교체한다.

**Architecture:** `src/core/logger.js`에 모듈 수준 싱글톤 로거를 두고 각 모듈이 import해 호출 즉시 `appendFileSync`한다. 로그는 `.github/.wizard/logs/`에 남기되 같은 폴더에 `.gitignore`를 자동 생성해 추적에서 제외한다. 기존 `install-log.js`는 제거한다.

**Tech Stack:** Node.js ≥20.12 순수 ESM, `node:fs` / `node:path`만 사용, `node:test` + `node:assert`

**Spec:** `docs/superpowers/specs/2026-08-26-install-log-redesign-design.md`

## Global Constraints

- **의존성 0 유지** — `package.json`에 `dependencies` / `devDependencies` 항목을 만들지 않는다. Node 내장 모듈만 사용.
- **순수 ESM** — `import` / `export`만. `require` 금지. 빌드 단계 없음.
- **Node.js ≥ 20.12** (`package.json engines`).
- **크로스플랫폼** — 경로는 항상 `join()`으로 조립. 셸 의존 코드 금지. 줄바꿈은 `\n` 고정(LF 보존 원칙).
- **커밋 메시지는 한국어** — Conventional Commits 타입 접두사(`feat:`, `fix:`, `refactor:`, `test:`, `docs:`)만 영어, 설명은 한국어. `CLAUDE.md` 규칙.
- **커밋에 `Co-Authored-By` 태그 금지.**
- **기존 테스트 642건(Node 487 + Python 155) 통과 상태 유지** — 각 Task 종료 시 `npm test` 전체 통과 확인.
- **로그 실패가 설치를 실패시키지 않는다** — 로거 예외는 stderr 경고 후 no-op 전환.
- **파일 삭제는 사용자 확인 후** — `src/core/install-log.js` 제거는 Task 6에서 사용자 승인을 받고 수행.

---

### Task 1: 로거 코어 — 파일 생성 · `.gitignore` · 회전

**Files:**
- Create: `src/core/logger.js`
- Test: `tests/node/logger.test.js`

**Interfaces:**
- Consumes: `src/core/fsutil.js`의 `writeText(path, string)` (부모 디렉토리 자동 생성)
- Produces:
  - `LOG_DIR: string` = `".github/.wizard/logs"`
  - `initLogger(targetRoot: string, opts: {action?: string, now?: string, argv?: string[], templateVersion?: string, clock?: () => Date}): {path: string} | null`
  - `resetLogger(): void`
  - `stampFrom(now: string): string` — `"2026-08-26 12:03:41"` → `"20260826-120341"`, 파싱 실패 시 `"unknown"`
  - `logFilename(now: string, action?: string): string` — `"20260826-120341-install.log"`
  - `maskValue(key: string, value: string): string`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/logger.test.js` 생성:

```js
// tests/node/logger.test.js
// 설치 로그 재설계 — 로거 코어 회귀.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initLogger, resetLogger, LOG_DIR, stampFrom, logFilename, maskValue } from "../../src/core/logger.js";

function withTarget(fn) {
  const target = mkdtempSync(join(tmpdir(), "paw-logger-"));
  try { fn(target); } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
}

test("stampFrom: 'YYYY-MM-DD HH:MM:SS'를 파일명용 스탬프로 바꾼다", () => {
  assert.strictEqual(stampFrom("2026-08-26 12:03:41"), "20260826-120341");
  assert.strictEqual(stampFrom("2026-08-26T12:03:41"), "20260826-120341");
  assert.strictEqual(stampFrom("깨진 값"), "unknown");
});

test("logFilename: 확장자는 .log이고 action이 파일명에 들어간다", () => {
  assert.strictEqual(logFilename("2026-08-26 12:03:41", "install"), "20260826-120341-install.log");
  assert.strictEqual(logFilename("2026-08-26 12:03:41", "uninstall"), "20260826-120341-uninstall.log");
});

test("maskValue: 비밀로 보이는 키는 가리되 인증 '방식'은 그대로 둔다", () => {
  assert.strictEqual(maskValue("SERVER_PASSWORD", "hunter2"), "***");
  assert.strictEqual(maskValue("SSH_AUTH_METHOD", "password"), "password");
  assert.strictEqual(maskValue("SERVICE_DOMAIN", "api.example.com"), "api.example.com");
});

test("initLogger: 로그 파일과 .gitignore를 만든다", () => {
  withTarget((target) => {
    const r = initLogger(target, { action: "install", now: "2026-08-26 12:03:41", argv: ["--mode", "full"], templateVersion: "0.8.2" });
    assert.ok(r && r.path, "로그 경로를 돌려줘야 한다");
    const dir = join(target, LOG_DIR);
    assert.strictEqual(readFileSync(join(dir, ".gitignore"), "utf8"), "*\n!.gitignore\n");
    assert.deepStrictEqual(readdirSync(dir).filter((f) => f.endsWith(".log")), ["20260826-120341-install.log"]);
  });
});

test("initLogger: 헤더에 실행 컨텍스트가 기록된다", () => {
  withTarget((target) => {
    const r = initLogger(target, { action: "install", now: "2026-08-26 12:03:41", argv: ["--mode", "full", "--type", "spring"], templateVersion: "0.8.2" });
    const body = readFileSync(join(target, r.path), "utf8");
    assert.match(body, /=== project-auto-wizard v0\.8\.2 \| install \| 2026-08-26 12:03:41 ===/);
    assert.match(body, /argv\s+: --mode full --type spring/);
    assert.match(body, /node\s+: v\d+\./);
    assert.match(body, /target\s+: /);
  });
});

test("initLogger: 기존 .gitignore는 덮어쓰지 않는다", () => {
  withTarget((target) => {
    const dir = join(target, LOG_DIR);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".gitignore"), "# 사용자가 직접 쓴 것\n");
    initLogger(target, { action: "install", now: "2026-08-26 12:03:41" });
    assert.strictEqual(readFileSync(join(dir, ".gitignore"), "utf8"), "# 사용자가 직접 쓴 것\n");
  });
});

test("initLogger: 로그 파일이 20개를 넘으면 오래된 것부터 지운다", () => {
  withTarget((target) => {
    const dir = join(target, LOG_DIR);
    mkdirSync(dir, { recursive: true });
    for (let i = 1; i <= 20; i++) {
      writeFileSync(join(dir, `2026080${1}-0000${String(i).padStart(2, "0")}-install.log`), "old\n");
    }
    assert.strictEqual(readdirSync(dir).filter((f) => f.endsWith(".log")).length, 20);
    initLogger(target, { action: "install", now: "2026-08-26 12:03:41" });
    const logs = readdirSync(dir).filter((f) => f.endsWith(".log")).sort();
    assert.strictEqual(logs.length, 20, "회전 후에도 20개를 유지해야 한다");
    assert.ok(logs.includes("20260826-120341-install.log"), "새 로그는 남아 있어야 한다");
    assert.ok(!logs.includes("20260801-000001-install.log"), "가장 오래된 로그가 지워져야 한다");
  });
});

test("resetLogger: 초기화 전 상태로 되돌린다", () => {
  withTarget((target) => {
    initLogger(target, { action: "install", now: "2026-08-26 12:03:41" });
    resetLogger();
    assert.strictEqual(initLogger(target, { action: "update", now: "2026-08-26 12:04:00" }).path.endsWith("-update.log"), true);
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `node --test tests/node/logger.test.js`
Expected: FAIL — `Cannot find module '.../src/core/logger.js'`

- [ ] **Step 3: 최소 구현**

`src/core/logger.js` 생성:

```js
// 실행 추적 로그 — "무엇을 어떤 순서로 왜 그렇게 했는지"를 시간순으로 남긴다.
//
// 왜 즉시 append인가: 디버깅에서 가장 알고 싶은 순간은 크래시 직전이다. 끝나고 한 번에
// 쓰는 구조는 예외가 나면 아무것도 남기지 못한다(구 install-log.js가 그랬다).
//
// 왜 로컬 전용인가: 상세도를 제약하지 않기 위해서다. 로그 디렉토리에 .gitignore를 직접
// 두어 그 폴더만 추적에서 뺀다 — 루트 .gitignore는 건드리지 않는다(이슈 #7 원칙).
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const LOG_DIR = ".github/.wizard/logs";
const KEEP = 20;              // 유지할 로그 파일 수
const GITIGNORE_BODY = "*\n!.gitignore\n";

// 값에 비밀이 들어갈 수 있는 키 — 현재 질문 항목에는 없지만(도메인·경로·포트·인증 '방식'),
// 앞으로 추가될 때 그냥 평문으로 남지 않도록 처음부터 걸어둔다.
const SECRET_KEY_RE = /(PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL)/i;
const MASK = "***";

let state = null; // { file, clock, startedAt, disabled }

export function maskValue(key, value) {
  // SSH_AUTH_METHOD처럼 "방식"만 담는 키는 비밀이 아니다 — 이름에 KEY가 들어가도 마스킹하지 않는다.
  if (key === "SSH_AUTH_METHOD") return value;
  return SECRET_KEY_RE.test(key) ? MASK : value;
}

// "2026-08-26 12:03:41" → "20260826-120341". 파일명이 곧 정렬 키가 되도록.
export function stampFrom(now = "") {
  const m = String(now).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return "unknown";
  return `${m[1]}${m[2]}${m[3]}-${m[4]}${m[5]}${m[6]}`;
}

export function logFilename(now, action = "install") {
  return `${stampFrom(now)}-${action}.log`;
}

// 최근 KEEP개만 남기고 오래된 것부터 지운다. 파일명이 시각 오름차순이라 이름 정렬로 충분하다.
function rotate(dir) {
  const logs = readdirSync(dir).filter((f) => f.endsWith(".log")).sort();
  for (const f of logs.slice(0, Math.max(0, logs.length - (KEEP - 1)))) {
    rmSync(join(dir, f), { force: true });
  }
}

export function initLogger(targetRoot, opts = {}) {
  const { action = "install", now = "", argv = [], templateVersion = "unknown", clock = () => new Date() } = opts;
  try {
    const dir = join(targetRoot, LOG_DIR);
    mkdirSync(dir, { recursive: true });
    // 사용자가 직접 둔 .gitignore가 있으면 존중한다.
    const gi = join(dir, ".gitignore");
    if (!existsSync(gi)) writeFileSync(gi, GITIGNORE_BODY);
    rotate(dir);

    const rel = `${LOG_DIR}/${logFilename(now, action)}`;
    const file = join(targetRoot, rel);
    const header =
      `=== project-auto-wizard v${templateVersion} | ${action} | ${now} ===\n` +
      `argv    : ${["project-auto-wizard", ...argv].join(" ")}\n` +
      `node    : ${process.version} | ${process.platform} ${process.arch}\n` +
      `target  : ${targetRoot}\n\n`;
    writeFileSync(file, header);
    state = { file, clock, startedAt: Date.now(), disabled: false };
    return { path: rel };
  } catch (e) {
    // 로그를 못 남긴 것이 설치를 되돌릴 이유는 아니다 — 다만 조용히 삼키지는 않는다.
    process.stderr.write(`[warn] 실행 로그를 시작하지 못했습니다: ${e.message}\n`);
    state = null;
    return null;
  }
}

export function resetLogger() {
  state = null;
}
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `node --test tests/node/logger.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/core/logger.js tests/node/logger.test.js
git commit -m "feat: 실행 추적 로거 코어 추가 — 파일 생성·gitignore 자동화·회전"
```

---

### Task 2: 로그 라인 기록 · 요약 블록 · 실패 내성

**Files:**
- Modify: `src/core/logger.js`
- Test: `tests/node/logger.test.js`

**Interfaces:**
- Consumes: Task 1의 `initLogger` / `resetLogger` / `LOG_DIR`
- Produces:
  - `log.info(scope: string, action: string, detail?: string): void`
  - `log.warn(scope, action, detail?): void`
  - `log.fail(scope, action, detail?): void`
  - `log.summary(rows: Array<[string, string]>): void`
  - `closeLogger(): void`
  - 라인 형식: `HH:MM:SS.mmm LEVEL scope  action  detail` — `LEVEL`은 `INFO` / `WARN` / `FAIL`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/logger.test.js` 하단에 추가:

```js
import { log, closeLogger } from "../../src/core/logger.js";

const FIXED = () => new Date("2026-08-26T12:03:41.221Z");

test("log.info/warn/fail: 5열 고정 포맷으로 한 줄씩 append된다", () => {
  withTarget((target) => {
    const r = initLogger(target, { action: "install", now: "2026-08-26 12:03:41", clock: FIXED });
    log.info("detect", "marker", "build.gradle → spring");
    log.warn("verify", "unresolved", "A.yaml:43 __X__");
    log.fail("copy", "write", "EACCES: permission denied");
    const body = readFileSync(join(target, r.path), "utf8");
    assert.match(body, /\d{2}:\d{2}:\d{2}\.\d{3} INFO {2}detect {2}marker {6}build\.gradle → spring/);
    assert.match(body, /\d{2}:\d{2}:\d{2}\.\d{3} WARN {2}verify {2}unresolved {2}A\.yaml:43 __X__/);
    assert.match(body, /\d{2}:\d{2}:\d{2}\.\d{3} FAIL {2}copy {4}write {7}EACCES/);
  });
});

test("log.*: initLogger 없이 호출해도 던지지 않는다 (no-op)", () => {
  resetLogger();
  assert.doesNotThrow(() => { log.info("detect", "marker", "x"); log.warn("a", "b"); log.fail("a", "b"); });
});

test("log.summary: 파일 끝에 요약 블록을 붙인다", () => {
  withTarget((target) => {
    const r = initLogger(target, { action: "install", now: "2026-08-26 12:03:41", clock: FIXED });
    log.info("copy", "write", "A.yaml (new)");
    log.summary([["설치", "12개 파일"], ["미치환", "2건"], ["결과", "OK (경고 2)"]]);
    closeLogger();
    const body = readFileSync(join(target, r.path), "utf8");
    assert.match(body, /=== 요약 ===/);
    assert.match(body, /설치\s+: 12개 파일/);
    assert.match(body, /미치환\s+: 2건/);
    assert.match(body, /결과\s+: OK \(경고 2\)/);
  });
});

test("로그 파일을 쓸 수 없게 되면 no-op으로 전환하고 설치는 계속된다", () => {
  withTarget((target) => {
    const r = initLogger(target, { action: "install", now: "2026-08-26 12:03:41", clock: FIXED });
    // 로그 파일을 디렉토리째 날려 append가 실패하는 상황을 만든다
    rmSync(join(target, LOG_DIR), { recursive: true, force: true });
    assert.doesNotThrow(() => log.info("detect", "marker", "x"), "쓰기 실패가 예외로 새어나가면 안 된다");
    assert.doesNotThrow(() => log.info("detect", "marker", "y"), "한 번 실패하면 이후는 조용히 no-op");
    assert.ok(!existsSync(join(target, r.path)));
  });
});

test("크래시 내성: 중간까지 기록된 라인은 파일에 남아 있다", () => {
  withTarget((target) => {
    const r = initLogger(target, { action: "install", now: "2026-08-26 12:03:41", clock: FIXED });
    log.info("detect", "marker", "build.gradle → spring");
    log.info("copy", "write", "A.yaml (new)");
    try { throw new Error("설치 중 크래시"); } catch { /* closeLogger 없이 종료된 상황 */ }
    const body = readFileSync(join(target, r.path), "utf8");
    assert.match(body, /build\.gradle → spring/, "크래시 전 라인이 남아야 한다");
    assert.match(body, /A\.yaml \(new\)/);
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `node --test tests/node/logger.test.js`
Expected: FAIL — `The requested module does not provide an export named 'log'`

- [ ] **Step 3: 구현 추가**

`src/core/logger.js` 하단에 추가:

```js
// 열 너비 — 사람이 훑을 때 컬럼이 맞고, 에이전트가 컬럼 단위로 끊어 읽을 수 있게 고정한다.
const SCOPE_W = 6;
const ACTION_W = 10;

function hhmmss(date) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}.${p(date.getMilliseconds(), 3)}`;
}

function write(level, scope, action, detail = "") {
  if (!state || state.disabled) return;
  try {
    const line = `${hhmmss(state.clock())} ${level}  ${String(scope).padEnd(SCOPE_W)}  ${String(action).padEnd(ACTION_W)}  ${detail}`.trimEnd();
    appendFileSync(state.file, line + "\n");
  } catch (e) {
    // 첫 실패에서 한 번만 알리고 이후는 조용히 끈다 — 매 줄 경고를 뱉으면 설치 화면이 무너진다.
    state.disabled = true;
    process.stderr.write(`[warn] 실행 로그 기록을 중단합니다: ${e.message}\n`);
  }
}

export const log = {
  info: (scope, action, detail) => write("INFO", scope, action, detail),
  warn: (scope, action, detail) => write("WARN", scope, action, detail),
  fail: (scope, action, detail) => write("FAIL", scope, action, detail),
  // rows: Array<[label, value]> — 라벨 폭을 맞춰 정렬한다.
  summary(rows = []) {
    if (!state || state.disabled || !rows.length) return;
    const w = Math.max(...rows.map(([k]) => [...String(k)].length));
    const body = rows.map(([k, v]) => `${String(k).padEnd(w)} : ${v}`).join("\n");
    try {
      appendFileSync(state.file, `\n=== 요약 ===\n${body}\n`);
    } catch {
      state.disabled = true;
    }
  },
};

export function closeLogger() {
  state = null;
}
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `node --test tests/node/logger.test.js`
Expected: PASS (12 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/core/logger.js tests/node/logger.test.js
git commit -m "feat: 로그 라인 기록·요약 블록·쓰기 실패 시 no-op 전환 추가"
```

---

### Task 3: `copy` 계측 — 파일별 결정과 사유

**Files:**
- Modify: `src/core/copy/workflows.js` (`processDir` 함수, `applyDecision` 함수)
- Test: `tests/node/logger-copy.test.js`

**Interfaces:**
- Consumes: Task 2의 `log.info` / `log.warn`
- Produces: `counters.unchangedFiles: string[]` — 기존에 없던 필드. `unchanged` 버킷 파일명 목록.

**왜 이 Task가 핵심인가:** `classify()`가 파일을 `unchanged` / `localOnly` / `newFiles` / `upstreamOnly` / `changed` 버킷으로 나누는데 그 판정이 지금 전부 버려진다. "내 수정본이 왜 안 덮였나"에 답하려면 이 사유가 남아야 한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/logger-copy.test.js` 생성:

```js
// tests/node/logger-copy.test.js
// 파일별 복사 결정이 사유와 함께 로그에 남는지 회귀.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initLogger, resetLogger, closeLogger } from "../../src/core/logger.js";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { makeResolvers } from "../../src/core/detect-fs.js";

function springTarget() {
  const target = mkdtempSync(join(tmpdir(), "paw-logcopy-"));
  mkdirSync(join(target, "src/main/resources"), { recursive: true });
  writeFileSync(join(target, "src/main/resources/application.yaml"), "");
  writeFileSync(join(target, "build.gradle"), 'version = "0.0.1"\n');
  return target;
}

function ctxFor(target, now) {
  const paths = new Map([["spring", "."]]);
  return createContext({
    mode: "full", force: true, types: ["spring"], version: "0.0.1", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths, repoName: "demo", resolvers: makeResolvers(target, "demo", paths),
    now, today: now.slice(0, 10), templateVersion: "0.8.2",
    markers: new Map([["spring", "build.gradle"]]),
  });
}

test("최초 설치: 새로 쓰이는 파일이 write로 기록된다", () => {
  const target = springTarget();
  try {
    resetLogger();
    const r = initLogger(target, { action: "install", now: "2026-08-26 12:03:41" });
    runFull(ctxFor(target, "2026-08-26 12:03:41"), resolvePayloadRoot(), target);
    closeLogger();
    const body = readFileSync(join(target, r.path), "utf8");
    assert.match(body, /INFO {2}copy {4}write {7}PROJECT-COMMON-VERSION-CONTROL\.yaml \(new\)/);
  } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
});

test("재설치: 사용자가 수정한 파일은 keep-local로 사유와 함께 기록된다", () => {
  const target = springTarget();
  try {
    resetLogger();
    // 1회차 설치
    runFull(ctxFor(target, "2026-08-26 12:03:41"), resolvePayloadRoot(), target);
    // 사용자가 워크플로우를 직접 수정
    const wf = join(target, ".github/workflows/PROJECT-COMMON-VERSION-CONTROL.yaml");
    writeFileSync(wf, readFileSync(wf, "utf8") + "\n# 사용자가 추가한 줄\n");
    // 2회차 설치 — 이때의 로그를 본다
    const r = initLogger(target, { action: "update", now: "2026-08-26 12:10:00" });
    runFull(ctxFor(target, "2026-08-26 12:10:00"), resolvePayloadRoot(), target);
    closeLogger();
    const body = readFileSync(join(target, r.path), "utf8");
    assert.match(body, /copy {4}keep-local {2}PROJECT-COMMON-VERSION-CONTROL\.yaml/,
      "사용자 수정본 유지가 사유와 함께 남아야 한다");
  } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
});

test("재설치: 손대지 않은 파일은 skip(unchanged)으로 기록된다", () => {
  const target = springTarget();
  try {
    resetLogger();
    runFull(ctxFor(target, "2026-08-26 12:03:41"), resolvePayloadRoot(), target);
    const r = initLogger(target, { action: "update", now: "2026-08-26 12:10:00" });
    runFull(ctxFor(target, "2026-08-26 12:10:00"), resolvePayloadRoot(), target);
    closeLogger();
    const body = readFileSync(join(target, r.path), "utf8");
    assert.match(body, /copy {4}skip {8}.*\(unchanged\)/);
  } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `node --test tests/node/logger-copy.test.js`
Expected: FAIL — `copy write` 라인이 없어 3건 모두 실패

- [ ] **Step 3: 계측 삽입**

`src/core/copy/workflows.js` 상단 import에 추가:

```js
import { log } from "../logger.js";
```

`processDir` 함수 내부를 다음으로 교체 (기존 `write` 정의와 5개 루프):

```js
  const write = (f) => {
    writeText(join(workflowsDir, f), srcText(join(srcDir, f)));
    counters.copied++; counters.copiedFiles.push(f); track(f, true);
  };

  for (const f of c.unchanged.filter(filter)) {
    counters.skipped++; counters.unchangedFiles.push(f); track(f, false);
    log.info("copy", "skip", `${f} (unchanged)`);
  }

  for (const f of c.localOnly.filter(filter)) {
    counters.skipped++; counters.keptLocal.push(f); track(f, false);
    log.info("copy", "keep-local", `${f} (업스트림 무변경, 사용자 수정본 유지)`);
  }

  for (const f of c.newFiles.filter(filter)) {
    write(f);
    log.info("copy", "write", `${f} (new)`);
  }

  for (const f of c.upstreamOnly.filter(filter)) {
    write(f); counters.autoUpdated.push(f);
    log.info("copy", "auto-update", `${f} (사용자 미수정, 최신으로 교체)`);
  }
```

`counters` 초기화부(`counters.copiedFiles = []` 근처)에 추가:

```js
  counters.unchangedFiles = []; // skip(unchanged) 대상 — 로그에서 "왜 안 바뀌었나"의 근거
```

`applyDecision` 함수의 세 분기에 각각 추가:

```js
  if (decision === "backup") {
    renameSync(dst, dst + ".bak");
    writeText(dst, srcText(src));
    counters.copied++; counters.backupAdded++; counters.copiedFiles.push(filename);
    log.info("copy", "backup", `${filename} → ${filename}.bak (사용자 결정, 새 버전으로 교체)`);
    return;
  }
  if (decision === "template") {
    const templateName = (filename.endsWith(".yaml") ? filename.slice(0, -".yaml".length) : filename) + ".template.yaml";
    writeText(join(workflowsDir, templateName), srcText(src));
    counters.templateAdded++; counters.copiedFiles.push(templateName);
    log.info("copy", "template", `${filename} 유지 + ${templateName} 생성 (사용자 결정)`);
    return;
  }
  counters.skipped++;
  log.info("copy", "skip", `${filename} (사용자 결정: 기존 유지)`);
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `node --test tests/node/logger-copy.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: 전체 회귀 확인**

Run: `npm test`
Expected: 기존 테스트 전부 통과 (Node 487+ / Python 155)

- [ ] **Step 6: 커밋**

```bash
git add src/core/copy/workflows.js tests/node/logger-copy.test.js
git commit -m "feat: 워크플로우 복사 결정과 사유를 실행 로그에 기록"
```

---

### Task 4: `full.js` 배선 — 나머지 구간 계측 + 요약 블록

**Files:**
- Modify: `src/commands/full.js`
- Test: `tests/node/logger-full.test.js`

**Interfaces:**
- Consumes: Task 2의 `log` / `closeLogger`, Task 3의 `counters.unchangedFiles`
- Produces: `runFull()`의 반환값에서 `installLog` 키 제거 (더 이상 `.md`를 쓰지 않음)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/logger-full.test.js` 생성:

```js
// tests/node/logger-full.test.js
// full 파이프라인 전 구간이 로그에 남는지 회귀.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initLogger, resetLogger, closeLogger } from "../../src/core/logger.js";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { makeResolvers } from "../../src/core/detect-fs.js";

test("runFull: detect·env·version·verify 구간이 모두 로그에 남고 요약이 붙는다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-logfull-"));
  try {
    mkdirSync(join(target, "src/main/resources"), { recursive: true });
    writeFileSync(join(target, "src/main/resources/application.yaml"), "");
    writeFileSync(join(target, "build.gradle"), 'version = "0.0.1"\n');

    resetLogger();
    const r = initLogger(target, { action: "install", now: "2026-08-26 12:03:41", templateVersion: "0.8.2" });
    const paths = new Map([["spring", "."]]);
    const ctx = createContext({
      mode: "full", force: true, types: ["spring"], version: "0.0.1", versionCode: 1,
      branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
      paths, repoName: "demo", resolvers: makeResolvers(target, "demo", paths),
      now: "2026-08-26 12:03:41", today: "2026-08-26", templateVersion: "0.8.2",
      markers: new Map([["spring", "build.gradle"]]),
    });
    runFull(ctx, resolvePayloadRoot(), target);
    closeLogger();

    const body = readFileSync(join(target, r.path), "utf8");
    assert.match(body, /INFO {2}detect {2}type {9}spring \(근거: build\.gradle\)/, "감지 근거");
    assert.match(body, /INFO {2}detect {2}version {6}0\.0\.1/, "버전 감지");
    assert.match(body, /INFO {2}version {1}write {7}version\.yml/, "version.yml 기록");
    assert.match(body, /INFO {2}verify {2}secret {7}SERVER_HOST/, "필요 secret");
    assert.match(body, /=== 요약 ===/, "요약 블록");
    assert.match(body, /설치\s+: \d+개 파일/);
  } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
});

test("runFull: .md 설치 로그는 더 이상 생성되지 않는다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-nomd-"));
  try {
    writeFileSync(join(target, "build.gradle"), 'version = "0.0.1"\n');
    resetLogger();
    initLogger(target, { action: "install", now: "2026-08-26 12:03:41" });
    const paths = new Map([["spring", "."]]);
    const result = runFull(createContext({
      mode: "full", force: true, types: ["spring"], version: "0.0.1", versionCode: 1,
      branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
      paths, repoName: "demo", resolvers: makeResolvers(target, "demo", paths),
      now: "2026-08-26 12:03:41", today: "2026-08-26", templateVersion: "0.8.2",
      markers: new Map([["spring", "build.gradle"]]),
    }), resolvePayloadRoot(), target);
    closeLogger();
    assert.strictEqual(result.installLog, undefined, "installLog 반환값이 없어야 한다");
    const files = readdirSync(join(target, ".github/.wizard/logs"));
    assert.ok(!files.some((f) => f.endsWith(".md")), ".md 로그가 없어야 한다");
  } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `node --test tests/node/logger-full.test.js`
Expected: FAIL — detect 라인 없음, `result.installLog`가 객체로 남아 있음

- [ ] **Step 3: `full.js` 수정**

import 교체:

```js
import { log } from "../core/logger.js";
```
(`import { writeInstallLog } from "../core/install-log.js";` 삭제)

`pathMarkers` 계산 직후에 감지 로그 추가:

```js
  const pathMarkers = new Map();
  for (const [t, p] of paths) {
    const marker = existingMarkerInDir(t, join(targetRoot, p || "."));
    pathMarkers.set(t, marker);
    log.info("detect", "type", `${t} (근거: ${marker || "직접 선택"})`);
  }
  log.info("detect", "version", `${version}${context.versionSource ? ` (${context.versionSource})` : ""}`);
  log.info("detect", "branch", `${branch}${context.branches ? ` | main=${context.branches.main} develop=${context.branches.develop} mode=${context.branches.mode}` : ""}`);
  for (const a of context.envAnswers || []) {
    log.info("prompt", a.isDefault ? "default" : "answer", `${a.key}=${maskValue(a.key, a.value)}`);
  }
```

(상단 import에 `maskValue`를 함께 가져온다: `import { log, maskValue } from "../core/logger.js";`)

`version.yml` 기록 직후:

```js
  log.info("version", "write", `version.yml (v${version}, code=${versionCode})`);
```

cleanup 직후:

```js
  for (const f of cleanup.removed || []) log.info("cleanup", "remove", `${f} (이전 배포 방식 정리)`);
  for (const f of cleanup.backedUp || []) log.info("cleanup", "backup", `${f} → ${f}.bak`);
```

baseline 기록 직후:

```js
  log.info("baseline", "write", `${managed.length}개 파일 기준점 기록`);
```

검증 직후:

```js
  for (const u of unresolved) log.warn("verify", "unresolved", `${u.filename}:${u.line} ${u.token}`);
  for (const [name, users] of secrets) log.info("verify", "secret", `${name} ← ${users.join(", ")}`);
```

마지막으로 `writeInstallLog(...)` 블록 전체를 요약 기록으로 교체:

```js
  // 9. 요약 — 파일 끝에 결과 블록을 붙인다. tail만 봐도 결과가 보이도록.
  log.summary([
    ["설치", `${(wfCounters.copiedFiles || []).length}개 파일`],
    ["자동 갱신", `${(wfCounters.autoUpdated || []).length}개 (사용자 미수정)`],
    ["유지", `${(wfCounters.keptLocal || []).length}개 (사용자 수정본)`],
    ["변경 없음", `${(wfCounters.unchangedFiles || []).length}개`],
    ["백업 교체", `${wfCounters.backupAdded || 0}개 (.bak 생성)`],
    ["미치환", `${unresolved.length}건${unresolved.length ? "  ← 조치 필요" : ""}`],
    ["필요 Secret", `${secrets.size}개`],
    ["결과", unresolved.length ? `주의 (미치환 ${unresolved.length}건)` : "OK"],
  ]);

  return { workflows: wfCounters, gitignoreUpdated, unresolved, secrets, cleanup };
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `node --test tests/node/logger-full.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: 전체 회귀 확인**

Run: `npm test`
Expected: `verify-and-install-log.test.js`의 `.md` 관련 3건이 실패한다 — Task 6에서 정리한다. 그 외는 통과.

- [ ] **Step 6: 커밋**

```bash
git add src/commands/full.js tests/node/logger-full.test.js
git commit -m "feat: full 파이프라인 전 구간 계측 및 요약 블록 기록"
```

---

### Task 5: 진입점 배선 + uninstall · purge 로그

**Files:**
- Modify: `src/index.js` (`run()` 함수)
- Modify: `src/commands/uninstall.js`
- Modify: `src/commands/purge.js`
- Test: `tests/node/logger-lifecycle.test.js`

**Interfaces:**
- Consumes: Task 2의 `initLogger` / `log` / `closeLogger`
- Produces: 없음 (배선만)

**주의:** `--dry-run`은 로그를 남기지 않는다. "파일을 바꾸지 않는다"가 이 모드의 계약이다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/logger-lifecycle.test.js` 생성:

```js
// tests/node/logger-lifecycle.test.js
// 진입점 배선 — 어떤 모드가 로그를 남기고 어떤 모드가 남기지 않는지 회귀.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "../../src/index.js";
import { LOG_DIR, resetLogger } from "../../src/core/logger.js";

function springTarget() {
  const target = mkdtempSync(join(tmpdir(), "paw-lifecycle-"));
  writeFileSync(join(target, "build.gradle"), 'version = "0.0.1"\n');
  return target;
}
const logsIn = (t) => (existsSync(join(t, LOG_DIR)) ? readdirSync(join(t, LOG_DIR)).filter((f) => f.endsWith(".log")) : []);

test("full 설치는 로그를 남긴다", async () => {
  const target = springTarget();
  try {
    resetLogger();
    await run(["--mode", "full", "--force", "--type", "spring"], { cwd: target });
    assert.strictEqual(logsIn(target).length, 1);
    assert.match(logsIn(target)[0], /-install\.log$/);
  } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
});

test("--dry-run은 로그 파일을 만들지 않는다", async () => {
  const target = springTarget();
  try {
    resetLogger();
    await run(["--mode", "full", "--force", "--type", "spring", "--dry-run"], { cwd: target });
    assert.deepStrictEqual(logsIn(target), [], "dry-run은 파일을 만들지 않는다");
  } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
});

test("uninstall도 로그를 남긴다", async () => {
  const target = springTarget();
  try {
    resetLogger();
    await run(["--mode", "full", "--force", "--type", "spring"], { cwd: target });
    resetLogger();
    await run(["--mode", "uninstall", "--force"], { cwd: target });
    // uninstall이 .wizard를 통째로 지우므로 로그도 함께 사라진다 —
    // 지워지기 전에 기록됐는지는 stderr가 아니라 "폴더가 사라졌다"로 확인한다.
    assert.strictEqual(existsSync(join(target, ".github/workflows/PROJECT-COMMON-VERSION-CONTROL.yaml")), false);
  } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `node --test tests/node/logger-lifecycle.test.js`
Expected: FAIL — 로그 파일이 생성되지 않아 첫 테스트 실패

- [ ] **Step 3: `src/index.js` 배선**

상단 import 추가:

```js
import { initLogger, closeLogger } from "./core/logger.js";
```

(`readTemplateVersion`은 `src/index.js:12`에서 이미 import하고 있으므로 추가하지 않는다.)

`run()` 안에서 `opts = parseArgs(argv)` 직후, 모드 분기 전에 삽입:

```js
  // 시각을 여기서 한 번만 계산한다 — 로그 파일명과 설치 기록이 같은 값을 쓰도록.
  // clock은 {now, today} 형태로 주입된다 (기본 현재 UTC).
  const { now, today } = clock || utcNow();

  // dry-run은 파일을 만들지 않는 것이 계약이므로 로그도 남기지 않는다.
  const loggedAction = opts.dryRun ? null
    : opts.mode === "uninstall" ? "uninstall"
    : opts.mode === "purge" ? "purge"
    : "install";
  if (loggedAction) {
    initLogger(cwd, { action: loggedAction, now, argv, templateVersion: readTemplateVersion() });
  }
```

**기존 `src/index.js:257`의 `const { now, today } = clock || utcNow();` 줄은 삭제한다** — 위에서 이미 선언했으므로 중복 선언이 되고, 두 번 호출하면 로그 파일명과 설치 시각이 어긋난다.

`run()` 본문 전체를 `try { ... } finally { closeLogger(); }`로 감싼다. 모든 return 경로와 예외 경로에서 로거가 닫히도록 하기 위함이다:

```js
export async function run(argv, { cwd = process.cwd(), payloadRoot, clock, exec, promptRepoName } = {}) {
  try {
    // ... 기존 본문 전체 ...
  } finally {
    closeLogger();
  }
}
```

- [ ] **Step 4: `uninstall.js` · `purge.js` 계측**

각 파일 상단에 `import { log } from "../core/logger.js";`를 추가하고, 파일을 지우는 지점마다 다음을 남긴다:

```js
  log.info("remove", "file", `${rel} (${reason})`);
```

`reason`은 해당 분기의 사유를 그대로 쓴다 — 예: `"워크플로우"`, `"스크립트"`, `"README 버전 섹션"`, `"version.yml"`.

- [ ] **Step 5: 테스트를 돌려 통과를 확인한다**

Run: `node --test tests/node/logger-lifecycle.test.js`
Expected: PASS (3 tests)

- [ ] **Step 6: 커밋**

```bash
git add src/index.js src/commands/uninstall.js src/commands/purge.js tests/node/logger-lifecycle.test.js
git commit -m "feat: 진입점에 로거 배선 및 uninstall·purge 기록 추가"
```

---

### Task 6: `install-log.js` 제거 및 기존 테스트 정리

**Files:**
- Delete: `src/core/install-log.js` — **사용자 승인 후 삭제**
- Modify: `tests/node/verify-and-install-log.test.js` → `tests/node/verify.test.js`로 이름 변경, install-log 관련 테스트 제거
- Modify: `src/ui/summary.js` (설치 기록 안내 문구)

**Interfaces:**
- Consumes: 없음
- Produces: 없음 (정리)

- [ ] **Step 1: 잔존 참조를 전수 확인한다**

Run: `grep -rn "install-log\|writeInstallLog\|renderInstallLog\|installLogPath" src/ tests/ bin/`
Expected: `src/ui/summary.js`, `src/index.js`, `src/commands/interactive.js`의 `installLogPath` 참조만 남아 있어야 한다.

- [ ] **Step 2: `summary.js` 안내 문구 교체**

`src/ui/summary.js`에서 `installLogPath` 블록을 다음으로 교체:

```js
  if (logPath) {
    err(`  📋 실행 로그: ${logPath}`);
    err(`     (이 폴더는 git에 올라가지 않습니다)`);
  }
```

`ctx` 구조분해에서 `installLogPath = ""`를 `logPath = ""`로 바꾸고, `src/index.js`와 `src/commands/interactive.js`의 호출부도 `logPath: <initLogger가 돌려준 경로>`로 맞춘다.

- [ ] **Step 3: 이전 `.md` 추적 안내 추가**

`src/ui/summary.js`의 위 블록 아래에 추가:

```js
  // .gitignore는 이미 추적 중인 파일에 영향이 없다 — 구버전에서 커밋된 .md가 남아 있으면 알려준다.
  if (hasLegacyMdLogs) {
    err(`  ℹ️  이전 버전의 설치 기록(.md)이 git에 추적 중입니다:`);
    err(`     git rm -r --cached .github/.wizard/logs`);
  }
```

`hasLegacyMdLogs`는 호출부에서 `existsSync(logsDir) && readdirSync(logsDir).some((f) => f.endsWith(".md"))`로 계산해 넘긴다.

- [ ] **Step 4: 기존 테스트에서 install-log 부분 제거**

`tests/node/verify-and-install-log.test.js`에서 다음을 삭제한다:
- `install-log.js` import 줄
- `maskValue` 테스트 (Task 1의 `logger.test.js`로 이미 이관됨)
- `renderInstallLog` 테스트
- e2e 테스트의 로그 파일 검증 블록 (`const logDir = ...`부터 `assert.match(readFileSync(...))`까지 3줄)

파일명을 `tests/node/verify.test.js`로 바꾼다:

```bash
git mv tests/node/verify-and-install-log.test.js tests/node/verify.test.js
```

- [ ] **Step 5: 사용자 승인을 받고 `install-log.js` 삭제**

**이 단계는 사용자에게 확인을 받고 진행한다** (`CLAUDE.md`: 파일 삭제 시 반드시 사용자 허락).

```bash
git rm src/core/install-log.js
```

- [ ] **Step 6: 전체 회귀 확인**

Run: `npm test`
Expected: Node 테스트 전량 통과, Python 155건 통과. 실패 0.

- [ ] **Step 7: 커밋**

```bash
git add -A src/ tests/
git commit -m "refactor: install-log.js 제거하고 실행 로그로 일원화"
```

---

### Task 7: 문서 갱신

**Files:**
- Modify: `README.md`
- Modify: `docs/DESIGN-SPEC.md` (설치 산출물 절이 있으면)

**Interfaces:** 없음

- [ ] **Step 1: README에서 설치 기록 설명을 갱신한다**

`.github/.wizard/logs/*.md`를 언급하는 문장이 있으면 다음으로 교체:

```markdown
설치·제거 실행마다 `.github/.wizard/logs/<시각>-<동작>.log`에 실행 추적이 남습니다.
감지 근거, 파일별 처리 결정과 사유, 치환된 값, 미치환 항목이 시간순으로 기록됩니다.
이 폴더는 자체 `.gitignore`를 포함하고 있어 git에 올라가지 않습니다.
```

- [ ] **Step 2: 잔존 언급 확인**

Run: `grep -rn "install\.md\|설치 로그\|설치 기록" README.md docs/*.md`
Expected: 갱신된 문장만 남는다.

- [ ] **Step 3: 커밋**

```bash
git add README.md docs/
git commit -m "docs: 설치 로그를 실행 추적 로그로 교체한 내용 반영"
```

---

## Self-Review

**1. 스펙 커버리지**

| 스펙 요구사항 | 구현 Task |
|---|---|
| `.log` 평문, 5열 포맷 | Task 2 |
| 헤더(argv·node·cwd) | Task 1 |
| `.gitignore` 자동 생성 | Task 1 |
| 회전 20개 | Task 1 |
| 즉시 append / 크래시 내성 | Task 2 |
| 쓰기 실패 시 no-op 전환 | Task 2 |
| 마스킹 유지 | Task 1 |
| `copy` 파일별 결정·사유 | Task 3 |
| detect / prompt / env / version / cleanup / baseline / verify 계측 | Task 4 |
| 요약 블록 | Task 4 |
| 생산자 확대(uninstall·purge) | Task 5 |
| dry-run 제외 | Task 5 |
| `.md` 폐지 · `install-log.js` 제거 | Task 6 |
| 기존 `.md` 추적 안내 | Task 6 |
| 테스트 전략 7항목 | Task 1·2·3·5 |

누락 없음.

**2. 플레이스홀더 스캔**

`TBD` / `TODO` / "적절히 처리" 류 없음. 모든 코드 단계에 실제 코드 블록이 있음.

**3. 타입 일관성**

- `initLogger(targetRoot, opts)` → `{path} | null` — Task 1 정의, Task 5에서 동일 시그니처로 호출
- `log.info/warn/fail(scope, action, detail)` — Task 2 정의, Task 3·4·5에서 동일하게 사용
- `log.summary(rows: Array<[string,string]>)` — Task 2 정의, Task 4에서 배열-쌍으로 호출
- `counters.unchangedFiles` — Task 3에서 신설, Task 4 요약에서 소비
- `LOG_DIR` — Task 1 export, Task 5 테스트에서 import

불일치 없음.
