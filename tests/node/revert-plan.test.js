// tests/node/revert-plan.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { planRevert, runRevert } from "../../src/commands/revert.js";

function installFixture() {
  const target = mkdtempSync(join(tmpdir(), "paw-revert-plan-"));
  const ctx = createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(), includeCodeRabbit: false,
    now: "2026-07-28 00:00:00", today: "2026-07-28", templateVersion: "0.1.0",
  });
  runFull(ctx, resolvePayloadRoot(), target);
  return target;
}

test("planRevert: lists files without deleting anything", () => {
  const target = installFixture();
  try {
    const plan = planRevert(resolvePayloadRoot(), target);
    assert.ok(plan.workflows.length > 0);
    assert.ok(plan.scripts.includes("version_manager.py"));
    // 아무것도 지워지지 않았어야 함
    for (const name of plan.workflows) {
      assert.ok(existsSync(join(target, ".github/workflows", name)));
    }
    for (const name of plan.scripts) {
      assert.ok(existsSync(join(target, ".github/scripts", name)));
    }
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planRevert output matches what runRevert actually removes", () => {
  const target = installFixture();
  try {
    const plan = planRevert(resolvePayloadRoot(), target);
    const result = runRevert({}, resolvePayloadRoot(), target);
    assert.deepStrictEqual(result, plan);
    for (const name of plan.workflows) {
      assert.ok(!existsSync(join(target, ".github/workflows", name)));
    }
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
