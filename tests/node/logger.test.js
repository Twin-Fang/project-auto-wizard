// tests/node/logger.test.js
// Install log redesign: logger core regression.
import "../setup-lang.mjs"; // these tests assert the ko output
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

test("stampFrom: converts 'YYYY-MM-DD HH:MM:SS' into a filename stamp", () => {
  assert.strictEqual(stampFrom("2026-08-26 12:03:41"), "20260826-120341");
  assert.strictEqual(stampFrom("2026-08-26T12:03:41"), "20260826-120341");
  assert.strictEqual(stampFrom("broken value"), "unknown");
});

test("logFilename: extension is .log and the filename includes milliseconds and the action", () => {
  assert.strictEqual(logFilename("2026-08-26 12:03:41", "install", 7), "20260826-120341-007-install.log");
  assert.strictEqual(logFilename("2026-08-26 12:03:41", "uninstall", 221), "20260826-120341-221-uninstall.log");
});

test("initLogger: opening twice at the same instant (same millisecond) does not overwrite the earlier log", () => {
  withTarget((target) => {
    const a = initLogger(target, { action: "install", now: "2026-08-26 12:03:41", ms: 5 });
    log.info("copy", "write", "first run");
    resetLogger();
    const b = initLogger(target, { action: "install", now: "2026-08-26 12:03:41", ms: 5 });
    log.info("copy", "write", "second run");
    assert.notStrictEqual(a.path, b.path, "the two runs must have different log paths");
    assert.match(readFileSync(join(target, a.path), "utf8"), /first run/, "the earlier run's record must remain");
    assert.strictEqual(readdirSync(join(target, LOG_DIR)).filter((f) => f.endsWith(".log")).length, 2);
  });
});

test("maskValue: masks keys that look secret but leaves the auth 'method' as is", () => {
  assert.strictEqual(maskValue("SERVER_PASSWORD", "hunter2"), "***");
  assert.strictEqual(maskValue("SSH_AUTH_METHOD", "password"), "password");
  assert.strictEqual(maskValue("SERVICE_DOMAIN", "api.example.com"), "api.example.com");
});

test("initLogger: creates no file before anything is logged", () => {
  withTarget((target) => {
    const r = initLogger(target, { action: "install", now: "2026-08-26 12:03:41", ms: 0 });
    assert.strictEqual(r.path, "", "no file has been opened yet");
    assert.strictEqual(existsSync(join(target, ".github")), false, "a read-only run must not leave traces");
  });
});

test("initLogger: creates the log file and .gitignore on first write", () => {
  withTarget((target) => {
    const r = initLogger(target, { action: "install", now: "2026-08-26 12:03:41", ms: 0, argv: ["--mode", "full"], templateVersion: "0.8.2" });
    log.info("detect", "type", "spring");
    assert.ok(r && r.path, "must return the log path");
    const dir = join(target, LOG_DIR);
    assert.strictEqual(readFileSync(join(dir, ".gitignore"), "utf8"), "*\n!.gitignore\n");
    assert.deepStrictEqual(readdirSync(dir).filter((f) => f.endsWith(".log")), ["20260826-120341-000-install.log"]);
  });
});

test("initLogger: the header records the run context", () => {
  withTarget((target) => {
    const r = initLogger(target, { action: "install", now: "2026-08-26 12:03:41", argv: ["--mode", "full", "--type", "spring"], templateVersion: "0.8.2" });
    log.info("detect", "type", "spring");
    const body = readFileSync(join(target, r.path), "utf8");
    assert.match(body, /=== project-auto-wizard v0\.8\.2 \| install \| 2026-08-26 12:03:41 UTC ===/);
    assert.match(body, /argv\s+: project-auto-wizard --mode full --type spring/);
    assert.match(body, /node\s+: v\d+\./);
    assert.match(body, /target\s+: /);
  });
});

test("initLogger: the header does not break when argv is empty", () => {
  withTarget((target) => {
    const r = initLogger(target, { action: "install", now: "2026-08-26 12:03:41" });
    log.info("detect", "type", "spring");
    assert.match(readFileSync(join(target, r.path), "utf8"), /argv\s+: project-auto-wizard\n/);
  });
});

test("initLogger: does not overwrite an existing .gitignore", () => {
  withTarget((target) => {
    const dir = join(target, LOG_DIR);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".gitignore"), "# written by the user\n");
    initLogger(target, { action: "install", now: "2026-08-26 12:03:41" });
    log.info("detect", "type", "spring");
    assert.strictEqual(readFileSync(join(dir, ".gitignore"), "utf8"), "# written by the user\n");
  });
});

test("initLogger: deletes the oldest log files once there are more than 20", () => {
  withTarget((target) => {
    const dir = join(target, LOG_DIR);
    mkdirSync(dir, { recursive: true });
    for (let i = 1; i <= 20; i++) {
      writeFileSync(join(dir, `20260801-0000${String(i).padStart(2, "0")}-install.log`), "old\n");
    }
    assert.strictEqual(readdirSync(dir).filter((f) => f.endsWith(".log")).length, 20);
    initLogger(target, { action: "install", now: "2026-08-26 12:03:41", ms: 0 });
    log.info("detect", "type", "spring");
    const logs = readdirSync(dir).filter((f) => f.endsWith(".log")).sort();
    assert.strictEqual(logs.length, 20, "must keep 20 after rotation");
    assert.ok(logs.includes("20260826-120341-000-install.log"), "the new log must remain");
    assert.ok(!logs.includes("20260801-000001-install.log"), "the oldest log must be deleted");
  });
});

test("resetLogger: restores the pre-init state", () => {
  withTarget((target) => {
    initLogger(target, { action: "install", now: "2026-08-26 12:03:41" });
    resetLogger();
    const r = initLogger(target, { action: "update", now: "2026-08-26 12:04:00" });
    log.info("detect", "type", "spring");
    assert.strictEqual(r.path.endsWith("-update.log"), true);
  });
});

// ── Line logging, summary, failure tolerance ─────────────────────────────────────
import { log, closeLogger } from "../../src/core/logger.js";

const FIXED = () => new Date(Date.UTC(2026, 7, 26, 12, 3, 41, 221));

test("log.info/warn/fail: appends one line at a time in a fixed 5-column format", () => {
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

test("log.*: does not throw when called without initLogger (no-op)", () => {
  resetLogger();
  assert.doesNotThrow(() => { log.info("detect", "marker", "x"); log.warn("a", "b"); log.fail("a", "b"); });
});

test("log.summary: appends a summary block to the end of the file", () => {
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

test("when the log file becomes unwritable it switches to no-op and the install continues", () => {
  withTarget((target) => {
    const r = initLogger(target, { action: "install", now: "2026-08-26 12:03:41", clock: FIXED });
    log.info("detect", "marker", "first");
    // Remove the whole log directory so that append fails
    rmSync(join(target, LOG_DIR), { recursive: true, force: true });
    assert.doesNotThrow(() => log.info("detect", "marker", "x"), "a write failure must not leak out as an exception");
    assert.doesNotThrow(() => log.info("detect", "marker", "y"), "after one failure, later calls are silently no-op");
    assert.ok(!existsSync(join(target, r.path)));
  });
});

test("crash tolerance: lines logged up to that point remain in the file", () => {
  withTarget((target) => {
    const r = initLogger(target, { action: "install", now: "2026-08-26 12:03:41", clock: FIXED });
    log.info("detect", "marker", "build.gradle → spring");
    log.info("copy", "write", "A.yaml (new)");
    try { throw new Error("crash during install"); } catch { /* simulates exiting without closeLogger */ }
    const body = readFileSync(join(target, r.path), "utf8");
    assert.match(body, /build\.gradle → spring/, "lines from before the crash must remain");
    assert.match(body, /A\.yaml \(new\)/);
  });
});
