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
    assert.match(body, /argv\s+: project-auto-wizard --mode full --type spring/);
    assert.match(body, /node\s+: v\d+\./);
    assert.match(body, /target\s+: /);
  });
});

test("initLogger: argv가 비어도 헤더가 깨지지 않는다", () => {
  withTarget((target) => {
    const r = initLogger(target, { action: "install", now: "2026-08-26 12:03:41" });
    assert.match(readFileSync(join(target, r.path), "utf8"), /argv\s+: project-auto-wizard\n/);
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
      writeFileSync(join(dir, `20260801-0000${String(i).padStart(2, "0")}-install.log`), "old\n");
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

// ── 라인 기록 · 요약 · 실패 내성 ─────────────────────────────────────
import { log, closeLogger } from "../../src/core/logger.js";

const FIXED = () => new Date(2026, 7, 26, 12, 3, 41, 221);

test("log.info/warn/fail: 5열 고정 포맷으로 한 줄씩 append된다", () => {
  withTarget((target) => {
    const r = initLogger(target, { action: "install", now: "2026-08-26 12:03:41", clock: FIXED });
    log.info("detect", "marker", "build.gradle → spring");
    log.warn("verify", "unresolved", "A.yaml:43 __X__");
    log.fail("copy", "write", "EACCES: permission denied");
    const body = readFileSync(join(target, r.path), "utf8");
    assert.match(body, /12:03:41\.221 INFO {2}detect {4}marker {6}build\.gradle → spring/);
    assert.match(body, /12:03:41\.221 WARN {2}verify {4}unresolved {2}A\.yaml:43 __X__/);
    assert.match(body, /12:03:41\.221 FAIL {2}copy {6}write {7}EACCES: permission denied/);
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
    // 로그 디렉토리를 통째로 날려 append가 실패하는 상황을 만든다
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
