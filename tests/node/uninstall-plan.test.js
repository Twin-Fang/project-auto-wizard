// tests/node/uninstall-plan.test.js
import "../setup-lang.mjs"; // these tests assert the ko output
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { planUninstall, runUninstall } from "../../src/commands/uninstall.js";
import { ensureGitignore } from "../../src/core/copy/gitignore.js";

const FULL_SELECTION = { workflows: true, scripts: true, readme: true, gitignore: true, versionYml: true };
const SAFE_SELECTION = { workflows: true, scripts: true, readme: false, gitignore: false, versionYml: false };

function installFixture() {
  const target = mkdtempSync(join(tmpdir(), "paw-uninstall-plan-"));
  writeFileSync(join(target, "README.md"), "# Test Project\n");
  const ctx = createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(),
    now: "2026-08-01 00:00:00", today: "2026-08-01", templateVersion: "0.1.0",
    language: "ko", // the README block is written in the install language; these tests assert the ko text
  });
  runFull(ctx, resolvePayloadRoot(), target);
  // full mode creates .gitignore only when conflict backups were actually made — this fixture exists to
  // verify uninstall's gitignore cleanup itself, so it is created directly.
  ensureGitignore(target);
  return target;
}

test("planUninstall: full selection reports every installed item, deletes nothing", () => {
  const target = installFixture();
  try {
    const plan = planUninstall(resolvePayloadRoot(), target, FULL_SELECTION);
    assert.ok(plan.workflows.length > 0);
    assert.ok(plan.scripts.includes("version_manager.py"));
    assert.strictEqual(plan.readme, true);
    assert.strictEqual(plan.gitignore, true);
    assert.strictEqual(plan.versionYml, true);
    assert.ok(existsSync(join(target, "version.yml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planUninstall: safe selection excludes readme/gitignore/versionYml", () => {
  const target = installFixture();
  try {
    const plan = planUninstall(resolvePayloadRoot(), target, SAFE_SELECTION);
    assert.ok(plan.workflows.length > 0);
    assert.strictEqual(plan.readme, false);
    assert.strictEqual(plan.gitignore, false);
    assert.strictEqual(plan.versionYml, false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("runUninstall: full selection removes workflows/scripts/readme-section/gitignore/version.yml", () => {
  const target = installFixture();
  try {
    const result = runUninstall({}, resolvePayloadRoot(), target, FULL_SELECTION);
    assert.ok(result.workflows.length > 0);
    assert.ok(!existsSync(join(target, ".github/scripts/version_manager.py")));
    assert.ok(!existsSync(join(target, "version.yml")));
    assert.ok(!existsSync(join(target, ".gitignore"))); // newly-created case -> the file itself is deleted
    const readme = readFileSync(join(target, "README.md"), "utf8");
    assert.ok(!readme.includes("AUTO-VERSION-SECTION"));
    assert.strictEqual(readme, "# Test Project\n");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("runUninstall: safe selection leaves readme/gitignore/version.yml untouched", () => {
  const target = installFixture();
  try {
    runUninstall({}, resolvePayloadRoot(), target, SAFE_SELECTION);
    assert.ok(!existsSync(join(target, ".github/scripts/version_manager.py")));
    assert.ok(existsSync(join(target, "version.yml")));
    assert.ok(existsSync(join(target, ".gitignore")));
    const readme = readFileSync(join(target, "README.md"), "utf8");
    assert.ok(readme.includes("AUTO-VERSION-SECTION"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("runUninstall: README in unexpected format is not falsely reported as removed", () => {
  const target = installFixture();
  try {
    // The user deletes the CHANGELOG link line so removeVersionSectionFromReadme skips.
    const readmePath = join(target, "README.md");
    const content = readFileSync(readmePath, "utf8").replace("[전체 버전 기록 보기](CHANGELOG.md)\n", "");
    writeFileSync(readmePath, content);

    const result = runUninstall({}, resolvePayloadRoot(), target, FULL_SELECTION);
    assert.strictEqual(result.readme, false); // nothing was actually removed, so it must be false
    assert.strictEqual(readFileSync(readmePath, "utf8"), content); // README is preserved as is
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planUninstall: nothing installed -> everything false/empty", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-uninstall-empty-"));
  try {
    const plan = planUninstall(resolvePayloadRoot(), target, FULL_SELECTION);
    assert.deepStrictEqual(plan.workflows, []);
    assert.deepStrictEqual(plan.scripts, []);
    assert.strictEqual(plan.readme, false);
    assert.strictEqual(plan.gitignore, false);
    assert.strictEqual(plan.versionYml, false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
