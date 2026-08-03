// tests/node/dry-run.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { runFull } from "../../src/commands/full.js";
import { planDryRun, printDryRun } from "../../src/commands/dry-run.js";

function baseContext(overrides = {}) {
  return createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(),
    now: "2026-07-28 00:00:00", today: "2026-07-28", templateVersion: "0.1.0",
    ...overrides,
  });
}

test("planDryRun('full', ...) on empty dir: all new, version.yml would be created, writes nothing", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  try {
    const plan = planDryRun("full", baseContext(), resolvePayloadRoot(), target);
    assert.strictEqual(plan.mode, "full");
    assert.ok(plan.workflows.newFiles.length > 0);
    assert.strictEqual(plan.versionYml.existed, false);
    assert.deepStrictEqual(readdirSync(target), []);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planDryRun('full', ...) after a real install: nothing new, version.yml unchanged", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  try {
    const ctx = baseContext();
    runFull(ctx, resolvePayloadRoot(), target);
    const plan = planDryRun("full", ctx, resolvePayloadRoot(), target);
    assert.deepStrictEqual(plan.workflows.newFiles, []);
    assert.strictEqual(plan.versionYml.existed, true);
    assert.strictEqual(plan.versionYml.changed, false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planDryRun('version', ...) only computes versionYml preview, not workflows", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  try {
    const plan = planDryRun("version", baseContext(), resolvePayloadRoot(), target);
    assert.strictEqual(plan.workflows, undefined);
    assert.ok(plan.versionYml);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("printDryRun() warns that version.yml preview may be inaccurate for deploy-block types", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  try {
    const plan = planDryRun("version", baseContext(), resolvePayloadRoot(), target);
    const originalLog = console.log;
    let output = "";
    console.log = (msg) => { output += msg; };
    try {
      printDryRun(plan);
    } finally {
      console.log = originalLog;
    }
    assert.ok(output.includes("deploy: 블록이 미리보기에 반영되지 않아"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planDryRun('full', ...) with semver_auto:false preserved -> versionYml unchanged", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  try {
    const ctx = baseContext({ includeSemverAuto: false });
    runFull(ctx, resolvePayloadRoot(), target);
    const plan = planDryRun("full", ctx, resolvePayloadRoot(), target);
    assert.strictEqual(plan.versionYml.changed, false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planDryRun('revert', ...) delegates to planRevert and writes nothing", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  try {
    const ctx = baseContext();
    runFull(ctx, resolvePayloadRoot(), target);
    const before = readdirSync(join(target, ".github/workflows")).length;
    const plan = planDryRun("revert", ctx, resolvePayloadRoot(), target);
    assert.ok(plan.revert.workflows.length > 0);
    const after = readdirSync(join(target, ".github/workflows")).length;
    assert.strictEqual(before, after);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
