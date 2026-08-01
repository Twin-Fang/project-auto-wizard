// tests/node/uninstall-dry-run.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { planDryRun, printDryRun } from "../../src/commands/dry-run.js";

const FULL_SELECTION = { workflows: true, scripts: true, coderabbit: true, readme: true, gitignore: true, versionYml: true };

function installFixture() {
  const target = mkdtempSync(join(tmpdir(), "paw-uninstall-dry-"));
  writeFileSync(join(target, "README.md"), "# Test Project\n");
  const ctx = createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(), includeCodeRabbit: true,
    now: "2026-08-01 00:00:00", today: "2026-08-01", templateVersion: "0.1.0",
  });
  runFull(ctx, resolvePayloadRoot(), target);
  return target;
}

test("planDryRun('uninstall', ...) lists candidates without deleting anything", () => {
  const target = installFixture();
  try {
    const plan = planDryRun("uninstall", { uninstallSelection: FULL_SELECTION }, resolvePayloadRoot(), target);
    assert.strictEqual(plan.mode, "uninstall");
    assert.ok(plan.uninstall.workflows.length > 0);
    assert.strictEqual(plan.uninstall.coderabbit, true);
    assert.strictEqual(plan.uninstall.readme, true);
    assert.strictEqual(plan.uninstall.gitignore, true);
    assert.strictEqual(plan.uninstall.versionYml, true);
    assert.ok(existsSync(join(target, "version.yml")));
    assert.ok(existsSync(join(target, ".coderabbit.yaml")));
    assert.ok(existsSync(join(target, ".gitignore")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("printDryRun() for uninstall mode reports every candidate category", () => {
  const target = installFixture();
  try {
    const plan = planDryRun("uninstall", { uninstallSelection: FULL_SELECTION }, resolvePayloadRoot(), target);
    const originalLog = console.log;
    let output = "";
    console.log = (msg) => { output += msg; };
    try {
      printDryRun(plan);
    } finally {
      console.log = originalLog;
    }
    assert.ok(output.includes("제거될 워크플로우"));
    assert.ok(output.includes(".coderabbit.yaml"));
    assert.ok(output.includes("README.md 버전 섹션"));
    assert.ok(output.includes(".gitignore 자동 추가 항목"));
    assert.ok(output.includes("version.yml"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
