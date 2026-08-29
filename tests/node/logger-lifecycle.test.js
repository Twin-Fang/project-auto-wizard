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
  mkdirSync(join(target, "src/main/resources"), { recursive: true });
  writeFileSync(join(target, "src/main/resources/application.yaml"), "");
  writeFileSync(join(target, "build.gradle"), 'version = "0.0.1"\n');
  return target;
}
const logsIn = (t) => (existsSync(join(t, LOG_DIR)) ? readdirSync(join(t, LOG_DIR)).filter((f) => f.endsWith(".log")) : []);

test("full 설치는 로그를 남기고 .gitignore로 추적을 막는다", async () => {
  const target = springTarget();
  try {
    resetLogger();
    const code = await run(["--mode", "full", "--force", "--type", "spring"], { cwd: target });
    assert.strictEqual(code, 0);
    const logs = logsIn(target);
    assert.strictEqual(logs.length, 1, "로그 파일이 하나 생겨야 한다");
    assert.match(logs[0], /-install\.log$/);
    assert.strictEqual(readFileSync(join(target, LOG_DIR, ".gitignore"), "utf8"), "*\n!.gitignore\n");
    const body = readFileSync(join(target, LOG_DIR, logs[0]), "utf8");
    assert.match(body, /=== project-auto-wizard v/, "헤더");
    assert.match(body, /INFO {2}copy {6}write/, "복사 결정");
    assert.match(body, /=== 요약 ===/, "요약 블록");
  } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
});

test("--dry-run은 로그 파일을 만들지 않는다", async () => {
  const target = springTarget();
  try {
    resetLogger();
    await run(["--mode", "full", "--force", "--type", "spring", "--dry-run"], { cwd: target });
    assert.deepStrictEqual(logsIn(target), [], "dry-run은 파일을 만들지 않는 것이 계약이다");
  } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
});

test("uninstall이 예외 없이 끝나고 설치물이 사라진다", async () => {
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

test("--version / --help는 로그를 만들지 않는다", async () => {
  const target = springTarget();
  try {
    resetLogger();
    await run(["--version"], { cwd: target });
    await run(["--help"], { cwd: target });
    assert.deepStrictEqual(logsIn(target), []);
  } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
});
