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

// 읽기 전용 모드는 메뉴로 복귀하므로 스텁도 매번 같은 값을 주면 안 된다(무한 루프).
// 정해둔 순서대로 응답하고, 대본이 끝나면 null(취소)을 반환해 루프를 빠져나간다.
function scriptedSelectMode(...modes) {
  const calls = [];
  const fn = async (opts) => {
    calls.push(opts);
    return calls.length <= modes.length ? modes[calls.length - 1] : null;
  };
  fn.calls = calls;
  return fn;
}

test("runInteractive: status 모드를 선택하면 설치 상태를 출력하고 메뉴로 돌아온다", async () => {
  const target = installFixture();
  try {
    let code;
    const selectMode = scriptedSelectMode("status");
    const io = { selectMode, cancelMessage: () => {}, outro: () => {} };
    const output = await captureConsoleLogAsync(async () => {
      code = await runInteractive({}, { cwd: target, io });
    });
    assert.strictEqual(code, 0);
    assert.ok(output.includes("project-auto-wizard status"));
    assert.ok(output.includes("1.0.0"));
    // 결과 출력 후 메뉴가 한 번 더 떴어야 한다(두 번째 호출에서 취소 → 종료).
    assert.strictEqual(selectMode.calls.length, 2);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("runInteractive: doctor 모드를 선택하면 환경 진단 결과를 출력하고 메뉴로 돌아온다", async () => {
  const target = installFixture();
  try {
    let code;
    const selectMode = scriptedSelectMode("doctor");
    const io = { selectMode, cancelMessage: () => {}, outro: () => {} };
    const output = await captureConsoleLogAsync(async () => {
      code = await runInteractive({}, { cwd: target, io });
    });
    assert.strictEqual(code, 0);
    assert.ok(output.includes("project-auto-wizard doctor"));
    assert.strictEqual(selectMode.calls.length, 2);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// 진단을 여러 번 돌려보는 것도 정상 사용이다 — 횟수 제한 없이 계속 메뉴로 돌아와야 한다.
test("runInteractive: 읽기 전용 모드를 연달아 골라도 매번 메뉴로 돌아온다", async () => {
  const target = installFixture();
  try {
    const selectMode = scriptedSelectMode("doctor", "status", "doctor");
    const io = { selectMode, cancelMessage: () => {}, outro: () => {} };
    const code = await captureConsoleLogAsync(async () => runInteractive({}, { cwd: target, io }))
      .then(() => 0);
    assert.strictEqual(code, 0);
    assert.strictEqual(selectMode.calls.length, 4); // 3회 실행 + 취소로 빠져나온 1회
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// 재진입 시에는 "무엇을 설치할까요?"가 아니라 "다음으로 무엇을 할까요?"를 물어야 한다.
test("runInteractive: 메뉴 재진입에는 again 플래그가 전달된다", async () => {
  const target = installFixture();
  try {
    const selectMode = scriptedSelectMode("doctor");
    const io = { selectMode, cancelMessage: () => {}, outro: () => {} };
    await captureConsoleLogAsync(async () => runInteractive({}, { cwd: target, io }));
    assert.strictEqual(selectMode.calls[0]?.again, false);
    assert.strictEqual(selectMode.calls[1]?.again, true);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// 첫 화면에서 바로 취소하면 메뉴를 다시 띄우지 않고 종료해야 한다(복귀 루프가 취소를 삼키면 안 됨).
test("runInteractive: 첫 메뉴에서 취소하면 즉시 종료한다", async () => {
  const target = installFixture();
  try {
    const selectMode = scriptedSelectMode();
    let cancelled = false;
    const io = { selectMode, cancelMessage: () => { cancelled = true; }, outro: () => {} };
    const code = await runInteractive({}, { cwd: target, io });
    assert.strictEqual(code, 0);
    assert.ok(cancelled);
    assert.strictEqual(selectMode.calls.length, 1);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
