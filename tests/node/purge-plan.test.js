// tests/node/purge-plan.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { planPurge } from "../../src/commands/purge.js";

function installFixture() {
  const target = mkdtempSync(join(tmpdir(), "paw-purge-plan-"));
  writeFileSync(join(target, "README.md"), "# Test Repo\n");
  const ctx = createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(), includeCodeRabbit: false,
    now: "2026-07-28 00:00:00", today: "2026-07-28", templateVersion: "0.1.0",
  });
  runFull(ctx, resolvePayloadRoot(), target);
  return target;
}

test("planPurge: lists workflows/scripts + version.yml + readme section, deletes nothing", () => {
  const target = installFixture();
  try {
    const plan = planPurge(resolvePayloadRoot(), target);
    assert.ok(plan.workflows.length > 0);
    assert.ok(plan.scripts.includes("version_manager.py"));
    assert.strictEqual(plan.versionYml, true);
    assert.strictEqual(plan.readmeSection, true);
    assert.deepStrictEqual(plan.changelog, []);
    assert.ok(existsSync(join(target, "version.yml")));
    assert.ok(existsSync(join(target, ".github/scripts/version_manager.py")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planPurge: detects CHANGELOG.json/.md when present at root", () => {
  const target = installFixture();
  try {
    writeFileSync(join(target, "CHANGELOG.json"), "{}");
    writeFileSync(join(target, "CHANGELOG.md"), "# Changelog\n");
    const plan = planPurge(resolvePayloadRoot(), target);
    assert.deepStrictEqual(plan.changelog.sort(), ["CHANGELOG.json", "CHANGELOG.md"]);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planPurge: keepFlags excludes categories from the plan", () => {
  const target = installFixture();
  try {
    const plan = planPurge(resolvePayloadRoot(), target, {
      versionYml: true, readme: true, workflows: true, scripts: true, coderabbit: true, changelog: true,
    });
    assert.deepStrictEqual(plan.workflows, []);
    assert.deepStrictEqual(plan.scripts, []);
    assert.strictEqual(plan.coderabbit, false);
    assert.strictEqual(plan.versionYml, false);
    assert.strictEqual(plan.readmeSection, false);
    assert.deepStrictEqual(plan.changelog, []);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
