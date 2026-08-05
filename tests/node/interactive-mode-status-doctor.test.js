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
