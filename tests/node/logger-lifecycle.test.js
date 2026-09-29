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

test("같은 초에 두 번 설치해도 로그가 실행마다 하나씩 남는다", async () => {
  const target = springTarget();
  try {
    const clock = { now: "2026-08-26 12:03:41", today: "2026-08-26" };
    for (let i = 0; i < 2; i++) {
      resetLogger();
      assert.strictEqual(await run(["--mode", "full", "--force", "--type", "spring"], { cwd: target, clock }), 0);
    }
    assert.strictEqual(logsIn(target).length, 2, "두 번째 실행이 첫 실행 로그를 덮어쓰면 안 된다");
  } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
});

// 읽기 전용 모드와 거부된 실행은 대상 레포에 아무 흔적도 남기지 않아야 한다.
for (const [label, argv, empty] of [
  ["status", ["--mode", "status"]],
  ["doctor", ["--mode", "doctor"]],
  ["--force 없는 full", ["--mode", "full", "--type", "spring"]],
  // 마커가 없는 폴더라 경로를 확정하지 못해 거부된다
  ["값 없는 --paths", ["--mode", "full", "--force", "--type", "spring", "--paths"], true],
  ["비대화형 uninstall (--force 없음)", ["--mode", "uninstall"]],
]) {
  test(`${label}: 로그 폴더를 만들지 않는다`, async () => {
    const target = empty ? mkdtempSync(join(tmpdir(), "paw-lifecycle-")) : springTarget();
    const quiet = { log: console.log, error: console.error };
    console.log = () => {}; console.error = () => {};
    try {
      resetLogger();
      const code = await run(argv, { cwd: target });
      if (empty) assert.strictEqual(code, 1, "경로를 확정하지 못하면 거부돼야 한다");
    } finally {
      Object.assign(console, quiet);
    }
    try {
      assert.strictEqual(existsSync(join(target, ".github", ".wizard")), false, `${label} 실행이 .github/.wizard를 만들면 안 된다`);
    } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
  });
}

test("uninstall 두 단계(기본 → --purge-*) 뒤에 로그 폴더가 남지 않고 ENOENT 경고도 없다", async () => {
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
    assert.strictEqual(existsSync(join(target, ".github", ".wizard")), false, "1단계에서 설치 기록 폴더가 지워져야 한다");
    resetLogger();
    assert.strictEqual(await run(["--mode", "uninstall", "--force", "--purge-readme", "--purge-gitignore", "--purge-version"], { cwd: target }), 0);
    assert.strictEqual(existsSync(join(target, ".github", ".wizard")), false, "2단계가 로그 폴더를 되살리면 안 된다");
  } finally {
    process.stderr.write = origWrite;
    Object.assign(console, quiet);
    resetLogger(); rmSync(target, { recursive: true, force: true });
  }
  assert.doesNotMatch(stderr, /실행 로그 기록을 중단합니다/, "자기 로그를 지워 ENOENT 경고가 나면 안 된다");
});

test("설치 기록 폴더를 지우지 않는 uninstall은 로그를 남긴다", async () => {
  const target = springTarget();
  try {
    resetLogger();
    await run(["--mode", "full", "--force", "--type", "spring"], { cwd: target });
    resetLogger();
    // 워크플로우를 남기고 스크립트만 지우는 선택 — .github/.wizard가 그대로 남는다
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
