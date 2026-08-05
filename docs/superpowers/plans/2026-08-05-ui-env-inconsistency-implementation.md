# stdin 종료 미처리·색상 비일관·대화형 메뉴 누락·jq 폴백 무경고 (4건) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이슈 [#22](https://github.com/Twin-Fang/project-auto-wizard/issues/22)의 4가지 독립 결함(stdin EOF 미처리, NO_COLOR/TTY 색상 비일관, 대화형 메뉴 status/doctor 누락, jq 미설치 시 버전 감지 무경고 폴백)을 수정한다.

**Architecture:** 기존 io 주입/순수 함수 분리 패턴을 그대로 따른다. `readline-engine.js`에 EOF→CANCEL 처리를 추가하고, `ansi.js`에 공용 `colorEnabled()`/`paint()` 가드를 만들어 `summary.js`가 재사용하도록 리팩터링하며, `readline-engine.js`는 의존성 0 원칙을 지키기 위해 동일 가드를 자체 복제한다. `prompts.js`/`interactive.js`에 status/doctor 분기를 추가하고, `detect.js`의 `hasJq` 게이트를 제거하며 `warn` 콜백을 주입한다.

**Tech Stack:** Node.js(순수 ESM, 외부 의존성 0), `node:test` + `node:assert`.

## Global Constraints

- Node.js 20.12 이상 (`bin/project-auto-wizard.js`의 버전 게이트, 변경 없음).
- `src/ui/readline-engine.js`는 다른 내부 파일(특히 `ansi.js`)을 import하지 않는 "의존성 0" 원칙을 유지한다(파일 헤더 주석 명시).
- 신규 npm 의존성 추가 금지 — 모든 수정은 Node 내장 API(`node:process`, `node:readline` 등)만 사용한다.
- 커밋 메시지는 한국어로 작성하고 `<브랜치 설명> : <타입> : <설명> https://github.com/Twin-Fang/project-auto-wizard/issues/22` 형식을 따른다. 브랜치 설명 세그먼트는 `stdin_종료_미처리_색상_비일관_대화형_메뉴_누락_jq_폴백_무경고_4건`.
- 테스트 실행: 개별 파일은 `node --test tests/node/<file>.test.js`, 전체는 `npm run test:node`.
- 기존 호출부(`src/index.js`, `src/commands/interactive.js`)의 `detectVersion(cwd)` 호출 시그니처는 변경하지 않는다 — 새 옵션은 전부 기본값으로 하위 호환.

---

### Task 1: stdin EOF(Ctrl+D) → CANCEL 처리 (`readline-engine.js`)

**Files:**
- Modify: `src/ui/readline-engine.js:48-82` (`keySession`), `src/ui/readline-engine.js:180-217` (`text`)
- Test: `tests/node/readline-engine-stdin-end.test.js` (신규)

**Interfaces:**
- Consumes: 없음 (기존 `CANCEL` 심볼, `stdin`/`stdout`은 이미 파일 내부에 있음)
- Produces: `keySession()`/`text()`가 stdin `"end"` 이벤트 시 `CANCEL`로 resolve — 이 파일이 export하는 `select`/`multiselect`/`confirm`/`text`가 전부 이 계약을 상속받는다. 이후 태스크에서 참조할 이름 변경 없음.

**설계 노트 (스펙 §7 대비 변경)**: 스펙은 자식 프로세스 spawn 방식을 제안했지만, `readline-engine.js`가 `node:process`의 `stdin`/`stdout` 싱글턴을 직접 참조하는 구조상 **인프로세스 몽키패치가 더 간단하고 결정적**이다. `stdin.on(...)` 리스너는 `keySession`/`text`의 Promise executor 안에서 **동기적으로** 등록되므로(함수 호출이 반환되는 시점엔 이미 리스너가 붙어 있음), 호출 직후 `process.stdin.emit("end")`로 안전하게 트리거할 수 있다. `node --test`는 파일 단위로 별도 프로세스를 띄우고 파일 내부는 기본적으로 순차 실행되므로 전역 `process.stdin` 오버라이드가 다른 파일의 테스트와 경합하지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/readline-engine-stdin-end.test.js` 신규 생성:

```js
// tests/node/readline-engine-stdin-end.test.js
import { test } from "node:test";
import assert from "node:assert";
import * as engine from "../../src/ui/readline-engine.js";

// keySession()/text()의 raw-mode 진입 조건(stdin.isTTY)을 통과시키기 위해 테스트 동안만
// process.stdin의 isTTY/setRawMode를 오버라이드한다. stdin.on("end"/"keypress", ...) 리스너는
// Promise executor 내부에서 동기적으로 등록되므로, 함수 호출 직후 emit해도 안전하다.
function withFakeTty(fn) {
  const stdin = process.stdin;
  const stdout = process.stdout;
  const originalIsTTY = stdin.isTTY;
  const originalSetRawMode = stdin.setRawMode;
  const originalWrite = stdout.write;
  stdin.isTTY = true;
  stdin.setRawMode = () => stdin;
  stdout.write = () => true; // 렌더링 출력으로 테스트 로그가 지저분해지는 것 방지
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      stdin.isTTY = originalIsTTY;
      stdin.setRawMode = originalSetRawMode;
      stdout.write = originalWrite;
    });
}

// timeout 지정 필수: 수정 전 코드는 "end" 리스너가 없어 Promise가 영원히 pending되므로,
// timeout이 없으면 FAIL이 아니라 node --test 전체가 멈춘다(hang). 수정 후에는 즉시 resolve되어
// 여유 있게 통과한다.
test("text(): stdin이 종료(EOF)되면 CANCEL로 resolve된다", { timeout: 2000 }, async () => {
  await withFakeTty(async () => {
    const p = engine.text({ message: "이름을 입력하세요", defaultValue: "기본값" });
    process.stdin.emit("end");
    const result = await p;
    assert.strictEqual(result, engine.CANCEL);
  });
});

test("select(): stdin이 종료(EOF)되면 CANCEL로 resolve된다", { timeout: 2000 }, async () => {
  await withFakeTty(async () => {
    const p = engine.select({
      message: "선택하세요",
      options: [{ value: "a", label: "A" }, { value: "b", label: "B" }],
    });
    process.stdin.emit("end");
    const result = await p;
    assert.strictEqual(result, engine.CANCEL);
  });
});

test("text(): 정상 완료 후에는 'end' 리스너가 해제되어 리스너가 누적되지 않는다", async () => {
  await withFakeTty(async () => {
    const before = process.stdin.listenerCount("end");
    const p = engine.text({ message: "이름을 입력하세요", defaultValue: "기본값" });
    process.stdin.emit("keypress", "h", { name: "h" });
    process.stdin.emit("keypress", "i", { name: "i" });
    process.stdin.emit("keypress", "", { name: "return" });
    const result = await p;
    assert.strictEqual(result, "hi");
    assert.strictEqual(process.stdin.listenerCount("end"), before);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test tests/node/readline-engine-stdin-end.test.js`
Expected: 앞 두 테스트가 **FAIL with a timeout error**(`"end"` 리스너가 아직 없어 `text()`/`select()`의 Promise가 `emit("end")`에 반응하지 않고 pending 상태로 남기 때문 — `{ timeout: 2000 }`이 없으면 FAIL 대신 테스트 러너 자체가 멈추므로 반드시 필요하다). 세 번째 테스트("정상 완료 후...")는 이미 통과한다(회귀 아님, 리스너 정리 자체는 기존 로직에도 있었음).

- [ ] **Step 3: `keySession()`에 `"end"` 핸들러 추가**

`src/ui/readline-engine.js`의 `keySession` 함수(46~82행)를 다음으로 교체:

```js
// raw keypress 세션 공통 래퍼. onKey(str,key) → true 반환 시 종료.
// 반환값은 finalize()가 만든다. 취소 시 CANCEL.
function keySession(renderFn, onKey) {
  return new Promise((resolve) => {
    const wasRaw = stdin.isTTY ? stdin.isRaw : false;
    emitKeypressEvents(stdin);
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    hideCursor();

    const cleanup = () => {
      stdin.removeListener("keypress", handler);
      stdin.removeListener("end", onEnd);
      if (stdin.isTTY) stdin.setRawMode(wasRaw);
      stdin.pause();
      showCursor();
    };

    // stdin 종료(EOF/Ctrl+D, SSH 연결 끊김 등) — 취소(ESC/Ctrl+C)와 동일하게 처리해 무한 대기를 방지한다.
    const onEnd = () => {
      cleanup();
      resolve(CANCEL);
    };

    const handler = (str, key) => {
      key = key || {};
      // 취소: Ctrl+C / ESC
      if ((key.ctrl && key.name === "c") || key.name === "escape") {
        cleanup();
        resolve(CANCEL);
        return;
      }
      const done = onKey(str, key);
      if (done !== undefined) {
        cleanup();
        resolve(done);
      } else {
        renderFn();
      }
    };
    stdin.on("keypress", handler);
    stdin.on("end", onEnd);
    renderFn(); // 최초 렌더
  });
}
```

- [ ] **Step 4: `text()`에 `"end"` 핸들러 추가**

`src/ui/readline-engine.js`의 `text` 함수(178~217행)를 다음으로 교체:

```js
// ── 텍스트 입력 (Enter 확정, 빈 입력=기본값) ─────────────────────────
// 반환: 입력 문자열(빈 입력 시 defaultValue) 또는 CANCEL.
export async function text({ message, defaultValue = "" }) {
  if (!stdin.isTTY) return defaultValue;
  return new Promise((resolve) => {
    const wasRaw = stdin.isTTY ? stdin.isRaw : false;
    emitKeypressEvents(stdin);
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    let buf = "";

    const prompt = () => {
      stdout.write(`\r${ESC}0K`); // 줄 초기화
      const shown = buf.length ? buf : paint(defaultValue || "", c.dim);
      stdout.write(`${S_Q}  ${paint(message, c.bold)} ${shown}`);
    };

    const cleanup = () => {
      stdin.removeListener("keypress", handler);
      stdin.removeListener("end", onEnd);
      if (stdin.isTTY) stdin.setRawMode(wasRaw);
      stdin.pause();
      stdout.write("\n");
    };

    // stdin 종료(EOF/Ctrl+D) — 취소와 동일하게 처리해 무한 대기를 방지한다.
    const onEnd = () => {
      cleanup();
      resolve(CANCEL);
    };

    const handler = (str, key) => {
      key = key || {};
      if ((key.ctrl && key.name === "c") || key.name === "escape") { cleanup(); resolve(CANCEL); return; }
      if (key.name === "return" || key.name === "enter") {
        cleanup();
        resolve(buf.length ? buf : defaultValue);
        return;
      }
      if (key.name === "backspace") { buf = buf.slice(0, -1); prompt(); return; }
      // 일반 문자 (제어문자 제외)
      if (str && !key.ctrl && !key.meta && str.length === 1 && str >= " ") { buf += str; prompt(); return; }
    };
    stdin.on("keypress", handler);
    stdin.on("end", onEnd);
    prompt();
  });
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `node --test tests/node/readline-engine-stdin-end.test.js`
Expected: PASS (3 tests)

- [ ] **Step 6: 전체 회귀 확인 후 커밋**

Run: `npm run test:node`
Expected: 기존 테스트 전부 PASS (readline-engine.js를 사용하는 다른 대화형 테스트에 영향 없는지 확인)

```bash
git add src/ui/readline-engine.js tests/node/readline-engine-stdin-end.test.js
git commit -m "$(cat <<'EOF'
stdin_종료_미처리_색상_비일관_대화형_메뉴_누락_jq_폴백_무경고_4건 : fix : stdin EOF(Ctrl+D) 시 대화형 프롬프트가 취소로 처리되도록 수정 https://github.com/Twin-Fang/project-auto-wizard/issues/22
EOF
)"
```

---

### Task 2: `ansi.js` 공용 `colorEnabled()`/`paint()` 가드

**Files:**
- Modify: `src/ui/ansi.js`
- Test: `tests/node/ansi-color-guard.test.js` (신규)

**Interfaces:**
- Consumes: 없음
- Produces: `colorEnabled(stream = process.stdout): boolean`, `paint(s, color, enabled = colorEnabled()): string` — Task 3(`summary.js`)이 `paint`, `A`, `colorEnabled`를 그대로 import해서 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/ansi-color-guard.test.js` 신규 생성:

```js
// tests/node/ansi-color-guard.test.js
import { test } from "node:test";
import assert from "node:assert";
import { colorEnabled, paint, A } from "../../src/ui/ansi.js";

test("colorEnabled: NO_COLOR가 설정되면 TTY 여부와 무관하게 false", () => {
  const original = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  try {
    assert.strictEqual(colorEnabled({ isTTY: true }), false);
  } finally {
    if (original === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = original;
  }
});

test("colorEnabled: NO_COLOR 없고 스트림이 TTY면 true", () => {
  const original = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  try {
    assert.strictEqual(colorEnabled({ isTTY: true }), true);
  } finally {
    if (original !== undefined) process.env.NO_COLOR = original;
  }
});

test("colorEnabled: 비TTY 스트림이면 false", () => {
  const original = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  try {
    assert.strictEqual(colorEnabled({ isTTY: false }), false);
    assert.strictEqual(colorEnabled({}), false);
  } finally {
    if (original !== undefined) process.env.NO_COLOR = original;
  }
});

test("paint: enabled=false면 ANSI 코드 없이 원문 그대로 반환", () => {
  assert.strictEqual(paint("hello", A.green, false), "hello");
});

test("paint: enabled=true면 색상 코드로 감싼다", () => {
  assert.strictEqual(paint("hello", A.green, true), `${A.green}hello${A.reset}`);
});

// 이슈 #22 L2의 실제 재현 케이스(NO_COLOR=1 + `printBannerCompact` 출력에 ESC 바이트 혼입)를
// 그대로 회귀 테스트로 고정한다. banner.js 자체는 이 계획에서 수정하지 않지만, ansi.js의 paint()가
// 고쳐지면 banner.js도 무수정으로 함께 고쳐져야 한다.
test("printBannerCompact: NO_COLOR=1이면 TTY여도 ESC 바이트가 출력에 섞이지 않는다", async () => {
  const { printBannerCompact } = await import("../../src/ui/banner.js");
  const originalNoColor = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  try {
    let output = "";
    printBannerCompact({ version: "1.0.0", mode: "full" }, (s) => { output += s; });
    assert.ok(!output.includes("\x1b["));
    assert.ok(output.includes("project-auto-wizard"));
  } finally {
    if (originalNoColor === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = originalNoColor;
  }
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test tests/node/ansi-color-guard.test.js`
Expected: FAIL — `colorEnabled`가 `ansi.js`에서 export되지 않아 `undefined is not a function` 에러(첫 5개 테스트). 마지막 `printBannerCompact` 테스트는 이슈의 원래 재현 케이스 그대로이므로, `paint()`가 무조건 색을 칠하는 현재 코드에서는 `out` 문자열에 ESC 바이트가 포함돼 FAIL한다.

- [ ] **Step 3: `ansi.js`에 가드 추가**

`src/ui/ansi.js` 전체를 다음으로 교체:

```js
// 공용 ANSI 헬퍼 — banner/status-cards/summary가 공유 (readline-engine 내부 헬퍼와 독립, 의존성 0)
const E = "\x1b[";
export const A = {
  reset: `${E}0m`,
  bold: `${E}1m`,
  dim: `${E}2m`,
  cyan: `${E}36m`,
  green: `${E}32m`,
  yellow: `${E}33m`,
  magenta: `${E}35m`,
  gray: `${E}90m`,
};

// NO_COLOR(https://no-color.org) 환경변수 또는 대상 스트림이 TTY가 아니면 색상을 끈다.
export function colorEnabled(stream = process.stdout) {
  return !process.env.NO_COLOR && !!stream.isTTY;
}

export const paint = (s, color, enabled = colorEnabled()) => (enabled ? `${color}${s}${A.reset}` : String(s));

// 대략적 표시 폭 (CJK 2칸 · ANSI 시퀀스 0칸) — 박스 우변 정렬용
export function visualWidth(s) {
  const plain = String(s).replace(/\x1b\[[0-9;]*m/g, "");
  let w = 0;
  for (const ch of plain) {
    const cp = ch.codePointAt(0);
    // 한글·CJK·이모지 대략 2칸 (터미널 관례)
    w += (cp >= 0x1100 && (cp <= 0x115f || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3)
      || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xff00 && cp <= 0xff60) || cp >= 0x1f300)) ? 2 : 1;
  }
  return w;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/node/ansi-color-guard.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: 전체 회귀 확인 후 커밋**

Run: `npm run test:node`
Expected: 기존 `paint(s, color)` 2-인자 호출부(banner.js/status-cards.js) 전부 그대로 PASS — 기본 `enabled` 파라미터가 `process.stdout` 기준으로 동작하므로 시그니처 호환 유지.

```bash
git add src/ui/ansi.js tests/node/ansi-color-guard.test.js
git commit -m "$(cat <<'EOF'
stdin_종료_미처리_색상_비일관_대화형_메뉴_누락_jq_폴백_무경고_4건 : fix : ansi.js에 NO_COLOR/TTY 공용 색상 가드(colorEnabled) 추가 https://github.com/Twin-Fang/project-auto-wizard/issues/22
EOF
)"
```

---

### Task 3: `summary.js` — 공용 색상 가드로 리팩터링

**Files:**
- Modify: `src/ui/summary.js:1-18`, `src/ui/summary.js:111`, `src/ui/summary.js:123`
- Test: `tests/node/summary-output.test.js` (기존 파일 확장)

**Interfaces:**
- Consumes: Task 2가 만든 `src/ui/ansi.js`의 `paint(s, color, enabled)`, `A`, `colorEnabled(stream)`
- Produces: 없음 (최종 소비자 — `printSummary(ctx, targetRoot)` 시그니처 변경 없음)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/summary-output.test.js`에 기존 내용 아래로 추가(파일 상단 import에 필요한 헬퍼도 추가):

```js
function withStderrTTY(isTTY, fn) {
  const original = process.stderr.isTTY;
  process.stderr.isTTY = isTTY;
  try { return fn(); } finally { process.stderr.isTTY = original; }
}

test("printSummary: TTY + NO_COLOR 미설정 -> ANSI 색상 코드 포함", () => {
  const originalNoColor = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  try {
    const output = withStderrTTY(true, () => captureStderr(() => {
      printSummary({ mode: "full", types: ["basic"], version: "1.0.0" });
    }));
    assert.ok(output.includes("\x1b["));
  } finally {
    if (originalNoColor !== undefined) process.env.NO_COLOR = originalNoColor;
  }
});

test("printSummary: NO_COLOR=1이면 TTY여도 ANSI 색상 코드가 전혀 섞이지 않는다", () => {
  const originalNoColor = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  try {
    const output = withStderrTTY(true, () => captureStderr(() => {
      printSummary({ mode: "full", types: ["basic"], version: "1.0.0" });
    }));
    assert.ok(!output.includes("\x1b["));
  } finally {
    if (originalNoColor === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = originalNoColor;
  }
});

test("printSummary: 비TTY면 NO_COLOR 미설정이어도 ANSI 색상 코드가 없다", () => {
  const originalNoColor = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  try {
    const output = withStderrTTY(false, () => captureStderr(() => {
      printSummary({ mode: "full", types: ["basic"], version: "1.0.0" });
    }));
    assert.ok(!output.includes("\x1b["));
  } finally {
    if (originalNoColor !== undefined) process.env.NO_COLOR = originalNoColor;
  }
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test tests/node/summary-output.test.js`
Expected: **두 번째** 신규 테스트("NO_COLOR=1이면 TTY여도...")가 FAIL — 현재 `summary.js`는 `process.stderr.isTTY`만 보고 `NO_COLOR`를 전혀 확인하지 않으므로, TTY를 강제하면 `NO_COLOR=1`이어도 `\x1b[`가 그대로 포함돼 `!output.includes("\x1b[")` assertion이 깨진다. (첫 번째 테스트는 TTY만 강제하고 NO_COLOR는 안 건드리므로 현재 코드에서도 이미 통과한다 — 회귀 방지용으로 남겨둔다. 세 번째 테스트도 비TTY 조건은 기존 로직이 이미 처리하므로 통과한다.)

- [ ] **Step 3: `summary.js`를 공용 가드로 리팩터링**

`src/ui/summary.js` 1~18행을 다음으로 교체:

```js
// 완료 요약 출력 (.sh print_summary 등가). 전부 stderr.
// ctx: { mode, types:[], version, counters:{ workflows }, branches? }
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PATHS, WORKFLOW_PREFIX, WORKFLOW_COMMON_PREFIX } from "../core/paths.js";
import { listYamlFiles } from "../core/fsutil.js";
import { paint, A, colorEnabled } from "./ansi.js";

const SEPARATOR = "────────────────────────────────────────";

export function printSummary(ctx, targetRoot = ".") {
  const { mode, types = [], version = "", counters = {}, branches = null, gitignoreUpdated = false } = ctx || {};
  const err = (s = "") => process.stderr.write(`${s}\n`);
  // 색상은 ansi.js의 공용 가드로 통일 (NO_COLOR + stderr TTY 여부)
  const enabled = colorEnabled(process.stderr);
  const workflowsCopied = counters.workflows ?? 0;
```

그리고 111행(`err(\`${YELLOW}⚠️  다음 작업을 확인해주세요:${NC}\`);`)을 아래로 교체:

```js
  err(paint(paint("⚠️  다음 작업을 확인해주세요:", A.yellow, enabled), A.bold, enabled));
```

그리고 123행(`err(\`${CYAN}📖 워크플로우 구성과 릴리스 흐름은 README를 참고하세요.${NC}\`);`)을 아래로 교체:

```js
  err(paint("📖 워크플로우 구성과 릴리스 흐름은 README를 참고하세요.", A.cyan, enabled));
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/node/summary-output.test.js`
Expected: PASS (기존 3개 + 신규 3개 = 6 tests)

- [ ] **Step 5: 전체 회귀 확인 후 커밋**

Run: `npm run test:node`
Expected: 전부 PASS

```bash
git add src/ui/summary.js tests/node/summary-output.test.js
git commit -m "$(cat <<'EOF'
stdin_종료_미처리_색상_비일관_대화형_메뉴_누락_jq_폴백_무경고_4건 : fix : summary.js가 NO_COLOR를 무시하던 문제를 ansi.js 공용 가드 재사용으로 수정 https://github.com/Twin-Fang/project-auto-wizard/issues/22
EOF
)"
```

---

### Task 4: `readline-engine.js` — 자체 NO_COLOR/TTY 가드 (의존성 0 유지)

**Files:**
- Modify: `src/ui/readline-engine.js:12-18`
- Test: `tests/node/readline-engine-color-guard.test.js` (신규)

**Interfaces:**
- Consumes: 없음 (`ansi.js`를 import하지 않음 — 의도적으로 로직만 동일하게 복제)
- Produces: 없음 (내부 `paint()` 헬퍼만 영향, export 표면 변경 없음)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/readline-engine-color-guard.test.js` 신규 생성:

```js
// tests/node/readline-engine-color-guard.test.js
import { test } from "node:test";
import assert from "node:assert";
import { intro, note } from "../../src/ui/readline-engine.js";

function captureStdout(fn) {
  const original = process.stdout.write.bind(process.stdout);
  let output = "";
  process.stdout.write = (chunk) => { output += chunk; return true; };
  try { fn(); } finally { process.stdout.write = original; }
  return output;
}

function withStdoutTTY(isTTY, fn) {
  const original = process.stdout.isTTY;
  process.stdout.isTTY = isTTY;
  try { return fn(); } finally { process.stdout.isTTY = original; }
}

test("intro(): TTY + NO_COLOR 미설정이면 ANSI 색상 코드를 포함한다", () => {
  const originalNoColor = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  try {
    const output = withStdoutTTY(true, () => captureStdout(() => intro("테스트")));
    assert.ok(output.includes("\x1b["));
  } finally {
    if (originalNoColor !== undefined) process.env.NO_COLOR = originalNoColor;
  }
});

test("intro(): NO_COLOR=1이면 TTY여도 ANSI 색상 코드가 없다", () => {
  const originalNoColor = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  try {
    const output = withStdoutTTY(true, () => captureStdout(() => intro("테스트")));
    assert.ok(!output.includes("\x1b["));
    assert.ok(output.includes("테스트"));
  } finally {
    if (originalNoColor === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = originalNoColor;
  }
});

test("note(): 비TTY면 ANSI 색상 코드가 없다", () => {
  const originalNoColor = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  try {
    const output = withStdoutTTY(false, () => captureStdout(() => note("본문", "제목")));
    assert.ok(!output.includes("\x1b["));
  } finally {
    if (originalNoColor !== undefined) process.env.NO_COLOR = originalNoColor;
  }
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test tests/node/readline-engine-color-guard.test.js`
Expected: 2번째, 3번째 테스트가 FAIL — 현재 `paint()`는 가드 없이 무조건 색을 칠하므로 `NO_COLOR=1`/비TTY여도 `\x1b[`가 포함됨.

- [ ] **Step 3: `readline-engine.js`에 자체 가드 추가**

`src/ui/readline-engine.js` 12~18행을 다음으로 교체:

```js
// ── ANSI 헬퍼 (picocolors 대체 — 의존성 0) ───────────────────────────
const ESC = "\x1b[";
const c = {
  reset: `${ESC}0m`, dim: `${ESC}2m`, bold: `${ESC}1m`,
  cyan: `${ESC}36m`, green: `${ESC}32m`, gray: `${ESC}90m`, yellow: `${ESC}33m`,
};
// NO_COLOR(https://no-color.org)/비TTY 가드 — ansi.js와 동일한 규칙이지만 의존성 0 유지를 위해 자체 구현.
const colorEnabled = () => !process.env.NO_COLOR && !!stdout.isTTY;
const paint = (s, color, enabled = colorEnabled()) => (enabled ? `${color}${s}${c.reset}` : String(s));
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/node/readline-engine-color-guard.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: 전체 회귀 확인 후 커밋**

Run: `npm run test:node`
Expected: Task 1에서 추가한 `readline-engine-stdin-end.test.js` 포함 전부 PASS

```bash
git add src/ui/readline-engine.js tests/node/readline-engine-color-guard.test.js
git commit -m "$(cat <<'EOF'
stdin_종료_미처리_색상_비일관_대화형_메뉴_누락_jq_폴백_무경고_4건 : fix : readline-engine.js도 NO_COLOR/비TTY를 무시하던 문제를 자체 가드로 수정 https://github.com/Twin-Fang/project-auto-wizard/issues/22
EOF
)"
```

---

### Task 5: 대화형 최상위 메뉴에 status/doctor 노출

**Files:**
- Modify: `src/ui/prompts.js:8-20`
- Modify: `src/commands/interactive.js` (import 구간 + 모드 분기)
- Test: `tests/node/interactive-mode-status-doctor.test.js` (신규)

**Interfaces:**
- Consumes: `src/commands/status.js`의 `runStatus(payloadRoot, targetRoot)`/`printStatus(status)` (기존, 변경 없음), `src/commands/doctor.js`의 `runDoctor(cwd, opts?)`/`printDoctorReport(results)` (기존, 변경 없음)
- Produces: `selectMode()`가 `"status"`/`"doctor"`를 반환할 수 있게 됨 — `runInteractive()`가 이 두 값을 처리.

**테스트 노트**: `interactive.js`의 doctor 분기는 `src/index.js`의 CLI `--mode doctor` 경로와 동일하게 `runDoctor(cwd)`를 exec 주입 없이 호출한다(`tests/node/doctor.test.js`의 `fakeExec` 주입 패턴과 달리 실제 `gh`/`git` 서브프로세스를 스폰함). 아래 doctor 테스트는 개별 점검 항목의 OK/WARN/FAIL 상태를 단언하지 않고 헤더 문자열만 확인하므로, `gh` CLI 설치/인증 여부와 무관하게 항상 통과한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/interactive-mode-status-doctor.test.js` 신규 생성:

```js
// tests/node/interactive-mode-status-doctor.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { runInteractive } from "../../src/commands/interactive.js";

function installFixture() {
  const target = mkdtempSync(join(tmpdir(), "paw-interactive-status-"));
  const ctx = createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(),
    now: "2026-08-05 00:00:00", today: "2026-08-05", templateVersion: "0.1.0",
  });
  runFull(ctx, resolvePayloadRoot(), target);
  return target;
}

async function captureConsoleLogAsync(fn) {
  const original = console.log;
  let output = "";
  console.log = (s = "") => { output += String(s) + "\n"; };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return output;
}

test("runInteractive: status 모드를 선택하면 설치 상태를 출력하고 즉시 종료한다", async () => {
  const target = installFixture();
  try {
    let code;
    const io = { selectMode: async () => "status", cancelMessage: () => {}, outro: () => {} };
    const output = await captureConsoleLogAsync(async () => {
      code = await runInteractive({}, { cwd: target, io });
    });
    assert.strictEqual(code, 0);
    assert.ok(output.includes("project-auto-wizard status"));
    assert.ok(output.includes("1.0.0"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("runInteractive: doctor 모드를 선택하면 환경 진단 결과를 출력하고 즉시 종료한다", async () => {
  const target = installFixture();
  try {
    let code;
    const io = { selectMode: async () => "doctor", cancelMessage: () => {}, outro: () => {} };
    const output = await captureConsoleLogAsync(async () => {
      code = await runInteractive({}, { cwd: target, io });
    });
    assert.strictEqual(code, 0);
    assert.ok(output.includes("project-auto-wizard doctor"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test tests/node/interactive-mode-status-doctor.test.js`
Expected: FAIL — `runInteractive`가 `"status"`/`"doctor"` 분기를 모르므로 이후 코드(감지/breaking-check 등)로 흘러 들어가 다른 io 메서드(`intro`, `detectionLog` 등)를 옵셔널 체이닝으로 건너뛰다가 결국 `code`가 0이 아니거나 예외가 발생하거나, 출력에 `"project-auto-wizard status"`/`"doctor"` 문자열이 없어 assert 실패.

- [ ] **Step 3: `prompts.js`에 메뉴 항목 추가**

`src/ui/prompts.js` 8~20행(선행 주석 1줄 + `selectMode` 함수 전체)을 다음으로 교체:

```js
// 모드 선택 — 한국어 라벨, 내부 키 반환. 취소 시 CANCEL.
export async function selectMode() {
  return engine.select({
    message: "무엇을 설치할까요?",
    options: [
      { value: "full", label: "전체 설치 — 버전관리 + 자동화 워크플로우 (처음이라면 추천)" },
      { value: "version", label: "버전 관리만 — 버전 자동 증가·동기화 시스템만 설치" },
      { value: "workflows", label: "워크플로우만 — 빌드·배포 GitHub Actions만 설치" },
      { value: "revert", label: "되돌리기 — 마법사가 설치한 워크플로우·스크립트 제거" },
      { value: "uninstall", label: "완전 삭제 — 마법사가 설치·수정한 모든 항목 제거(확인 후, README·gitignore·version.yml 포함)" },
      { value: "status", label: "설치 상태 확인 — 읽기 전용, 버전·타입·드리프트 확인" },
      { value: "doctor", label: "환경 진단 — 읽기 전용, gh CLI·권한·secret 설정 점검" },
    ],
  });
}
```

- [ ] **Step 4: `interactive.js`에 import 및 분기 추가**

`src/commands/interactive.js`의 import 구간에서 아래 줄(현재 파일 상단부)을 찾는다:

```js
import * as prompts from "../ui/prompts.js";
```

바로 아래에 두 줄을 추가:

```js
import { runStatus, printStatus } from "./status.js";
import { runDoctor, printDoctorReport } from "./doctor.js";
```

그리고 아래 코드(모드 선택 직후):

```js
  // 1) 모드 선택
  const mode = await io.selectMode();
  if (mode === CANCEL || mode == null) { io.cancelMessage?.("설치를 취소했습니다."); return 0; }

  // revert 모드 — 확인 질문(기본 아니오) 후 payload 유래 파일 제거. 감지·breaking 게이트 불필요.
  if (mode === "revert") {
```

를 다음으로 교체(status/doctor 분기를 revert 분기 앞에 삽입):

```js
  // 1) 모드 선택
  const mode = await io.selectMode();
  if (mode === CANCEL || mode == null) { io.cancelMessage?.("설치를 취소했습니다."); return 0; }

  // status/doctor — 읽기 전용, 감지·breaking 게이트 불필요. CLI --mode status/doctor(index.js)와 동일하게 즉시 종료.
  if (mode === "status") { printStatus(runStatus(payload, cwd)); return 0; }
  if (mode === "doctor") { printDoctorReport(runDoctor(cwd)); return 0; }

  // revert 모드 — 확인 질문(기본 아니오) 후 payload 유래 파일 제거. 감지·breaking 게이트 불필요.
  if (mode === "revert") {
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `node --test tests/node/interactive-mode-status-doctor.test.js`
Expected: PASS (2 tests)

- [ ] **Step 6: 전체 회귀 확인 후 커밋**

Run: `npm run test:node`
Expected: 전부 PASS (특히 `tests/node/interactive-mode-uninstall.test.js`가 여전히 통과하는지 확인 — `selectMode` 변경이 다른 모드 흐름에 영향 없어야 함)

```bash
git add src/ui/prompts.js src/commands/interactive.js tests/node/interactive-mode-status-doctor.test.js
git commit -m "$(cat <<'EOF'
stdin_종료_미처리_색상_비일관_대화형_메뉴_누락_jq_폴백_무경고_4건 : feat : 대화형 최상위 메뉴에 status/doctor 읽기 전용 모드 노출 https://github.com/Twin-Fang/project-auto-wizard/issues/22
EOF
)"
```

---

### Task 6: jq 미설치 시 버전 감지 폴백 수정

**Files:**
- Modify: `src/core/detect.js:35-54` (`VERSION_RE` + `detectVersionFromFiles`)
- Modify: `src/core/detect-fs.js:30-37` (`detectVersion`), `src/core/detect-fs.js:59-64` (`hasCommand` 제거)
- Test: `tests/node/detect-version.test.js` (신규)

**Interfaces:**
- Consumes: 없음
- Produces: `detectVersionFromFiles({ read, readJson, gitTag, warn })` — `hasJq` 파라미터 제거됨. `detectVersion(root, { warn } = {})` — `hasJq` 옵션 제거, `warn` 옵션 추가(기본값 `console.error`). `src/index.js`/`src/commands/interactive.js`의 `detectVersion(cwd)` 호출부는 옵션을 생략하므로 무수정.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/detect-version.test.js` 신규 생성:

```js
// tests/node/detect-version.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectVersionFromFiles } from "../../src/core/detect.js";
import { detectVersion } from "../../src/core/detect-fs.js";

test("detectVersionFromFiles: package.json의 버전은 jq 여부와 무관하게 즉시 감지된다", () => {
  const read = () => null;
  const readJson = (rel) => (rel === "package.json" ? { version: "1.0.0" } : null);
  const version = detectVersionFromFiles({ read, readJson, gitTag: "" });
  assert.strictEqual(version, "1.0.0");
});

test("detectVersionFromFiles: 다른 매니페스트도 git tag도 없으면 0.0.1로 폴백하며 warn을 1회 호출한다", () => {
  const read = () => null;
  const readJson = () => null;
  const warned = [];
  const version = detectVersionFromFiles({ read, readJson, gitTag: "", warn: (m) => warned.push(m) });
  assert.strictEqual(version, "0.0.1");
  assert.strictEqual(warned.length, 1);
  assert.ok(warned[0].includes("0.0.1"));
});

test("detectVersionFromFiles: build.gradle에서 감지되면 warn을 호출하지 않는다", () => {
  const read = (rel) => (rel === "build.gradle" ? 'version = "2.3.4"\n' : null);
  const readJson = () => null;
  const warned = [];
  const version = detectVersionFromFiles({ read, readJson, gitTag: "", warn: (m) => warned.push(m) });
  assert.strictEqual(version, "2.3.4");
  assert.strictEqual(warned.length, 0);
});

test("detectVersion: package.json 버전이 있으면 jq 설치 여부와 무관하게 정상 감지된다", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-detect-version-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "1.0.0" }));
    const version = detectVersion(dir, { warn: () => {} });
    assert.strictEqual(version, "1.0.0");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("detectVersion: 아무 단서도 없으면 0.0.1로 폴백하며 주입한 warn이 호출된다", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-detect-version-empty-"));
  try {
    const warned = [];
    const version = detectVersion(dir, { warn: (m) => warned.push(m) });
    assert.strictEqual(version, "0.0.1");
    assert.strictEqual(warned.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test tests/node/detect-version.test.js`
Expected: 첫 번째 테스트("package.json의 버전은 jq 여부와 무관하게...")가 FAIL — 현재 코드는 `hasJq`가 `undefined`(전달 안 함)라 `pkg?.version` 조건까지 못 가고 `null` 통과, 결국 `0.0.1` 반환. 나머지 `warn` 관련 테스트도 `warn` 파라미터 자체가 무시되므로 FAIL.

- [ ] **Step 3: `detect.js`에서 `hasJq` 게이트 제거, `warn` 콜백 추가**

`src/core/detect.js` 35~54행(`VERSION_RE` 상수 선언부터 `detectVersionFromFiles` 끝까지)을 다음으로 교체:

```js
const VERSION_RE = /^\d+\.\d+\.\d+$/;

// 버전 감지 (동작명세 §3.3) — 순서대로 첫 성공. read(relpath)=>string|null 주입.
// package.json은 이미 Node JSON.parse로 파싱을 마친 값이므로 jq 설치 여부와 무관하게 항상 사용한다(이슈 #22 L4).
export function detectVersionFromFiles({ read, readJson, gitTag, warn }) {
  const pkg = readJson?.("package.json");
  if (pkg?.version && VERSION_RE.test(pkg.version)) return pkg.version;
  const grab = (content, re) => {
    for (const line of (content || "").split("\n")) {
      const m = line.match(re);
      if (m && VERSION_RE.test(m[1])) return m[1];
    }
    return null;
  };
  let v;
  if ((v = grab(read("build.gradle"), /version\s*=\s*["']?(\d+\.\d+\.\d+)/))) return v;
  if ((v = grab(read("pubspec.yaml"), /^version:\s*(\d+\.\d+\.\d+)/))) return v;
  if ((v = grab(read("pyproject.toml"), /version\s*=\s*["']?(\d+\.\d+\.\d+)/))) return v;
  if (gitTag) { const t = String(gitTag).replace(/^v/, ""); if (VERSION_RE.test(t)) return t; }
  warn?.("⚠️  버전을 자동 감지하지 못해 기본값 0.0.1을 사용합니다 — --project-version으로 직접 지정하거나 version.yml을 확인하세요.");
  return "0.0.1";
}
```

- [ ] **Step 4: `detect-fs.js`에서 `hasJq`/`hasCommand` 제거, `warn` 배선**

`src/core/detect-fs.js` 30~37행(선행 주석 + `detectVersion` 함수 전체)을 다음으로 교체:

```js
// 버전 감지 — .sh detect_version 순서. jq는 package.json 파싱에 쓰인 적이 없어 게이트를 제거했다(이슈 #22 L4).
export function detectVersion(root, { warn = (m) => console.error(m) } = {}) {
  const read = readFile(root);
  const readJson = (rel) => { const c = read(rel); try { return c ? JSON.parse(c) : null; } catch { return null; } };
  const gitTag = gitOut(root, ["describe", "--tags", "--abbrev=0"]);
  return detectVersionFromFiles({ read, readJson, gitTag, warn });
}
```

그리고 파일 하단의 아래 함수(59~64행)를 완전히 삭제:

```js
function hasCommand(cmd) {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore" });
    return true;
  } catch { return false; }
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `node --test tests/node/detect-version.test.js`
Expected: PASS (5 tests)

- [ ] **Step 6: 전체 회귀 확인 후 커밋**

Run: `npm run test:node`
Expected: 전부 PASS. `detect-fs.js` 상단의 `import { execFileSync } from "node:child_process";`는 `gitOut()` 함수(`execFileSync("git", args, ...)`)에서도 쓰이므로 `hasCommand` 삭제와 무관하게 그대로 유지한다(제거하면 `gitOut` import 에러 발생).

```bash
git add src/core/detect.js src/core/detect-fs.js tests/node/detect-version.test.js
git commit -m "$(cat <<'EOF'
stdin_종료_미처리_색상_비일관_대화형_메뉴_누락_jq_폴백_무경고_4건 : fix : jq 미설치 시에도 package.json 버전이 정상 감지되도록 불필요한 게이트 제거, 완전 폴백 시 경고 추가 https://github.com/Twin-Fang/project-auto-wizard/issues/22
EOF
)"
```

---

## 최종 검증 (모든 태스크 완료 후)

- [ ] **전체 테스트 스위트 실행**

Run: `npm test`
Expected: `test:node`, `test:py` 모두 PASS

- [ ] **`--help`/README 대조 확인**

`README.md`가 문서화한 `--mode` 7종(`full | version | workflows | revert | uninstall | status | doctor`)이 대화형 메뉴에도 전부 노출되는지 눈으로 재확인 (`src/ui/prompts.js`의 `selectMode()` choices 7개).

- [ ] **실사용 스모크 테스트 (수동, 선택)**

```bash
NO_COLOR=1 node bin/project-auto-wizard.js --mode full --force --type node > /tmp/paw-smoke.log 2>&1
python3 -c "print(b'\x1b' in open('/tmp/paw-smoke.log','rb').read())"
```
Expected: `False` (ESC 바이트 없음)
