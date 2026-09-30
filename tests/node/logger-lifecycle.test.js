// tests/node/logger-lifecycle.test.js
// Entry-point wiring — regression on which modes write a log and which do not.
import "../setup-lang.mjs"; // these tests assert the ko output
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "../../src/index.js";
import { LOG_DIR, resetLogger } from "../../src/core/logger.js";

function springTarget() {
  const target = mkdtempSync(join(tmpdir(), "paw-lifecycle-"));
  mkdirSync(join(target, "src/main/resources"), { recursive: true });
  writeFileSync(join(target, "src/main/resources/application.yaml"), "");
  writeFileSync(join(target, "build.gradle"), 'version = "0.0.1"\n');
  return target;
}
const logsIn = (t) => (existsSync(join(t, LOG_DIR)) ? readdirSync(join(t, LOG_DIR)).filter((f) => f.endsWith(".log")) : []);

test("a full install writes a log and keeps it untracked via .gitignore", async () => {
  const target = springTarget();
  try {
    resetLogger();
    const code = await run(["--mode", "full", "--force", "--type", "spring"], { cwd: target });
    assert.strictEqual(code, 0);
    const logs = logsIn(target);
    assert.strictEqual(logs.length, 1, "exactly one log file must be created");
    assert.match(logs[0], /-install\.log$/);
    assert.strictEqual(readFileSync(join(target, LOG_DIR, ".gitignore"), "utf8"), "*\n!.gitignore\n");
    const body = readFileSync(join(target, LOG_DIR, logs[0]), "utf8");
    assert.match(body, /=== project-auto-wizard v/, "header");
    assert.match(body, /INFO {2}copy {6}write/, "copy decision");
    assert.match(body, /=== 요약 ===/, "summary block");
  } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
});

test("--dry-run does not create a log file", async () => {
  const target = springTarget();
  try {
    resetLogger();
    await run(["--mode", "full", "--force", "--type", "spring", "--dry-run"], { cwd: target });
    assert.deepStrictEqual(logsIn(target), [], "the dry-run contract is that it creates no files");
  } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
});

test("uninstall finishes without exceptions and the installed files disappear", async () => {
  const target = springTarget();
  try {
    resetLogger();
    await run(["--mode", "full", "--force", "--type", "spring"], { cwd: target });
    resetLogger();
    const code = await run(["--mode", "uninstall", "--force"], { cwd: target });
    assert.strictEqual(code, 0);
    assert.strictEqual(existsSync(join(target, ".github/workflows/PROJECT-COMMON-VERSION-CONTROL.yaml")), false);
  } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
});

test("--version / --help do not create a log", async () => {
  const target = springTarget();
  try {
    resetLogger();
    await run(["--version"], { cwd: target });
    await run(["--help"], { cwd: target });
    assert.deepStrictEqual(logsIn(target), []);
  } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
});

test("installing twice within the same second still leaves one log per run", async () => {
  const target = springTarget();
  try {
    const clock = { now: "2026-08-26 12:03:41", today: "2026-08-26" };
    for (let i = 0; i < 2; i++) {
      resetLogger();
      assert.strictEqual(await run(["--mode", "full", "--force", "--type", "spring"], { cwd: target, clock }), 0);
    }
    assert.strictEqual(logsIn(target).length, 2, "the second run must not overwrite the first run's log");
  } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
});

// Read-only modes and rejected runs must leave no trace in the target repo.
for (const [label, argv, empty] of [
  ["status", ["--mode", "status"]],
  ["doctor", ["--mode", "doctor"]],
  ["full without --force", ["--mode", "full", "--type", "spring"]],
  // --paths without a value is rejected at the argument stage like other value options
  ["--paths without a value", ["--mode", "full", "--force", "--type", "spring", "--paths"], true],
  ["non-interactive uninstall (no --force)", ["--mode", "uninstall"]],
]) {
  test(`${label}: does not create a log folder`, async () => {
    const target = empty ? mkdtempSync(join(tmpdir(), "paw-lifecycle-")) : springTarget();
    const quiet = { log: console.log, error: console.error };
    console.log = () => {}; console.error = () => {};
    try {
      resetLogger();
      const code = await run(argv, { cwd: target });
      if (empty) assert.strictEqual(code, 1, "--paths without a value must be rejected");
    } finally {
      Object.assign(console, quiet);
    }
    try {
      assert.strictEqual(existsSync(join(target, ".github", ".wizard")), false, `the ${label} run must not create .github/.wizard`);
    } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
  });
}

test("after both uninstall stages (default -> --purge-*), no log folder remains and there is no ENOENT warning", async () => {
  const target = springTarget();
  writeFileSync(join(target, "README.md"), "# my-app\n");
  const origWrite = process.stderr.write.bind(process.stderr);
  let stderr = "";
  const quiet = { log: console.log, error: console.error };
  try {
    resetLogger();
    await run(["--mode", "full", "--force", "--type", "spring"], { cwd: target });
    console.log = () => {}; console.error = () => {};
    process.stderr.write = (s) => { stderr += s; return true; };
    resetLogger();
    assert.strictEqual(await run(["--mode", "uninstall", "--force"], { cwd: target }), 0);
    assert.strictEqual(existsSync(join(target, ".github", ".wizard")), false, "the install-record folder must be removed in stage 1");
    resetLogger();
    assert.strictEqual(await run(["--mode", "uninstall", "--force", "--purge-readme", "--purge-gitignore", "--purge-version"], { cwd: target }), 0);
    assert.strictEqual(existsSync(join(target, ".github", ".wizard")), false, "stage 2 must not resurrect the log folder");
  } finally {
    process.stderr.write = origWrite;
    Object.assign(console, quiet);
    resetLogger(); rmSync(target, { recursive: true, force: true });
  }
  assert.doesNotMatch(stderr, /실행 로그 기록을 중단합니다/, "deleting its own log must not cause an ENOENT warning");
});

test("an uninstall that keeps the install-record folder writes a log", async () => {
  const target = springTarget();
  try {
    resetLogger();
    await run(["--mode", "full", "--force", "--type", "spring"], { cwd: target });
    resetLogger();
    // The choice to keep workflows and delete only scripts — .github/.wizard stays
    const { runUninstall } = await import("../../src/commands/uninstall.js");
    const { initLogger } = await import("../../src/core/logger.js");
    const { resolvePayloadRoot } = await import("../../src/core/assets.js");
    initLogger(target, { action: "uninstall", now: "2026-08-26 12:03:41", ms: 0 });
    runUninstall({}, resolvePayloadRoot(), target, { workflows: false, scripts: true });
    const logs = logsIn(target).filter((f) => f.endsWith("-uninstall.log"));
    assert.strictEqual(logs.length, 1);
    assert.match(readFileSync(join(target, LOG_DIR, logs[0]), "utf8"), /remove\s+script\s+version_manager\.py/);
  } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
});
