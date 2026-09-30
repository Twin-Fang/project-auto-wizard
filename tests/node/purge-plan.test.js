// tests/node/purge-plan.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, writeFileSync, rmSync, readdirSync, readFileSync as readFile } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { planPurge, executePurge, printPurgeResult } from "../../src/commands/purge.js";

// The shape produced by changelog_manager.py — purge removes only a CHANGELOG with this structure
const GEN_JSON = JSON.stringify({ metadata: { currentVersion: "1.0.0" }, releases: [] });
const GEN_MD = "# Changelog\n\n**현재 버전:** 1.0.0  \n**마지막 업데이트:** 2026-07-28  \n\n---\n\n";

function installFixture() {
  const target = mkdtempSync(join(tmpdir(), "paw-purge-plan-"));
  writeFileSync(join(target, "README.md"), "# Test Repo\n");
  const ctx = createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(),
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
    writeFileSync(join(target, "CHANGELOG.json"), GEN_JSON);
    writeFileSync(join(target, "CHANGELOG.md"), GEN_MD);
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
      versionYml: true, readme: true, workflows: true, scripts: true, changelog: true,
    });
    assert.deepStrictEqual(plan.workflows, []);
    assert.deepStrictEqual(plan.scripts, []);
    assert.strictEqual(plan.versionYml, false);
    assert.strictEqual(plan.readmeSection, false);
    assert.deepStrictEqual(plan.changelog, []);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// runFull() now touches .gitignore only when conflict-backup byproducts (.bak/.template.yaml)
// were actually created. The install in this round-trip test has no conflicts, so no .gitignore is created at all and the filter below is effectively a no-op,
// but even if another test changes to trigger a conflict, purge never touches .gitignore,
// so it is safely excluded from the comparison.
function listAllFiles(dir, base = dir) {
  let out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === ".gitignore") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) out = out.concat(listAllFiles(full, base));
    else out.push(full.slice(base.length + 1));
  }
  return out.sort();
}

test("executePurge: round-trip returns target to its pre-install file tree", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-purge-plan-"));
  writeFileSync(join(target, "README.md"), "# Test Repo\n");
  try {
    const before = listAllFiles(target);
    const ctx = createContext({
      mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
      branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
      paths: new Map(),
      now: "2026-07-28 00:00:00", today: "2026-07-28", templateVersion: "0.1.0",
    });
    runFull(ctx, resolvePayloadRoot(), target);
    assert.ok(listAllFiles(target).length > before.length);
    const result = executePurge(resolvePayloadRoot(), target);
    assert.strictEqual(result.readmeSection, true);
    assert.deepStrictEqual(listAllFiles(target), before);
    assert.strictEqual(readFile(join(target, "README.md"), "utf8"), "# Test Repo\n");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("executePurge: --keep-version-yml preserves version.yml while removing the rest", () => {
  const target = installFixture();
  try {
    const result = executePurge(resolvePayloadRoot(), target, { versionYml: true });
    assert.ok(existsSync(join(target, "version.yml")));
    assert.ok(!existsSync(join(target, ".github/scripts/version_manager.py")));
    assert.strictEqual(result.versionYml, false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// Verifies execute-level preservation for each --keep-* — looking at the plan alone would miss the actual deletion result.
test("executePurge: --keep-readme preserves the AUTO-VERSION-SECTION block while removing the rest", () => {
  const target = installFixture();
  try {
    const result = executePurge(resolvePayloadRoot(), target, { readme: true });
    assert.ok(readFile(join(target, "README.md"), "utf8").includes("AUTO-VERSION-SECTION"));
    assert.ok(!existsSync(join(target, "version.yml")));
    assert.strictEqual(result.readmeSection, false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("executePurge: --keep-workflows preserves workflow files while removing the rest", () => {
  const target = installFixture();
  try {
    const before = readdirSync(join(target, ".github/workflows")).sort();
    executePurge(resolvePayloadRoot(), target, { workflows: true });
    assert.deepStrictEqual(readdirSync(join(target, ".github/workflows")).sort(), before);
    assert.ok(!existsSync(join(target, "version.yml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("executePurge: --keep-scripts preserves .github/scripts/*.py while removing the rest", () => {
  const target = installFixture();
  try {
    executePurge(resolvePayloadRoot(), target, { scripts: true });
    assert.ok(existsSync(join(target, ".github/scripts/version_manager.py")));
    assert.ok(!existsSync(join(target, "version.yml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// The CHANGELOG category was a dead path: only detection (planPurge) was verified in the first draft and the actual deletion
// was never executed by any test — separately from the --keep-changelog preservation test,
// the default behavior (actually deleted without a keep flag) is also verified explicitly.
test("executePurge: --keep-changelog preserves CHANGELOG files while removing the rest", () => {
  const target = installFixture();
  try {
    writeFileSync(join(target, "CHANGELOG.json"), GEN_JSON);
    executePurge(resolvePayloadRoot(), target, { changelog: true });
    assert.ok(existsSync(join(target, "CHANGELOG.json")));
    assert.ok(!existsSync(join(target, "version.yml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("executePurge: deletes CHANGELOG.json/.md when present and not kept", () => {
  const target = installFixture();
  try {
    writeFileSync(join(target, "CHANGELOG.json"), GEN_JSON);
    writeFileSync(join(target, "CHANGELOG.md"), GEN_MD);
    const result = executePurge(resolvePayloadRoot(), target);
    assert.ok(!existsSync(join(target, "CHANGELOG.json")));
    assert.ok(!existsSync(join(target, "CHANGELOG.md")));
    assert.deepStrictEqual(result.changelog.sort(), ["CHANGELOG.json", "CHANGELOG.md"]);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("printPurgeResult: lists removed filenames, not just counts (M3)", () => {
  const originalLog = console.log;
  let stdout = "";
  console.log = (msg) => { stdout += msg; };
  try {
    printPurgeResult({
      workflows: ["PROJECT-RELEASE.yaml"], scripts: ["version_manager.py"],
      versionYml: true, readmeSection: true, changelog: ["CHANGELOG.md"],
    });
  } finally {
    console.log = originalLog;
  }
  assert.ok(stdout.includes("PROJECT-RELEASE.yaml"));
  assert.ok(stdout.includes("version_manager.py"));
  assert.ok(stdout.includes("CHANGELOG.md"));
});

test("printPurgeResult: does not throw on an empty result", () => {
  printPurgeResult({ workflows: [], scripts: [], versionYml: false, readmeSection: false, changelog: [] });
});

test("planPurge: does not delete a user CHANGELOG.md that the wizard did not create", () => {
  const target = installFixture();
  try {
    writeFileSync(join(target, "CHANGELOG.md"), "# my changelog\n");
    const plan = planPurge(resolvePayloadRoot(), target);
    assert.deepStrictEqual(plan.changelog, []);
    executePurge(resolvePayloadRoot(), target);
    assert.strictEqual(readFile(join(target, "CHANGELOG.md"), "utf8"), "# my changelog\n");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planPurge: when a generated CHANGELOG.json exists, the regenerated CHANGELOG.md is deleted too", () => {
  const target = installFixture();
  try {
    writeFileSync(join(target, "CHANGELOG.json"), GEN_JSON);
    writeFileSync(join(target, "CHANGELOG.md"), "# Changelog\r\n\r\n## [1.0.0]\r\n");
    assert.deepStrictEqual(planPurge(resolvePayloadRoot(), target).changelog.sort(), ["CHANGELOG.json", "CHANGELOG.md"]);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("executePurge: removes the block the wizard added to .gitignore and restores the original content", async () => {
  const { ensureGitignore } = await import("../../src/core/copy/gitignore.js");
  const target = installFixture();
  try {
    writeFileSync(join(target, ".gitignore"), "node_modules/\n");
    ensureGitignore(target);
    const plan = planPurge(resolvePayloadRoot(), target);
    assert.strictEqual(plan.gitignore, true);
    const result = executePurge(resolvePayloadRoot(), target);
    assert.strictEqual(result.gitignore, true);
    assert.strictEqual(readFile(join(target, ".gitignore"), "utf8"), "node_modules/\n");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("executePurge --keep-workflows: does not remove the .gitignore entry that hides a retained .bak", async () => {
  const { planUninstall } = await import("../../src/commands/uninstall.js");
  const target = mkdtempSync(join(tmpdir(), "paw-purge-plan-"));
  try {
    const payload = resolvePayloadRoot();
    const ctx = (deployStyle) => createContext({
      mode: "full", force: true, types: ["spring"], version: "1.0.0", versionCode: 1,
      branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
      paths: new Map(), deployStyle,
      now: "2026-07-28 00:00:00", today: "2026-07-28", templateVersion: "0.1.0",
    });
    runFull(ctx("simple"), payload, target);
    const simple = join(target, ".github/workflows/PROJECT-SPRING-SIMPLE-CICD.yaml");
    writeFileSync(simple, readFile(simple, "utf8") + "# manual edit\n");
    runFull(ctx("traefik"), payload, target); // the modified copy is moved to .bak and .gitignore is created
    assert.ok(existsSync(simple + ".bak"));
    const gitignore = readFile(join(target, ".gitignore"), "utf8");

    // An uninstall choice that keeps workflows follows the same rule.
    assert.strictEqual(planUninstall(payload, target, { workflows: false, gitignore: true }).gitignore, false);

    const plan = planPurge(payload, target, { workflows: true });
    assert.strictEqual(plan.gitignore, false);
    assert.strictEqual(plan.gitignoreKept, true);
    executePurge(payload, target, { workflows: true });
    assert.ok(existsSync(simple + ".bak"));
    assert.strictEqual(readFile(join(target, ".gitignore"), "utf8"), gitignore);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("executePurge --keep-workflows: with no backup files, the auto-added .gitignore entry is still removed", async () => {
  const { ensureGitignore } = await import("../../src/core/copy/gitignore.js");
  const target = installFixture();
  try {
    writeFileSync(join(target, ".gitignore"), "node_modules/\n");
    ensureGitignore(target);
    const result = executePurge(resolvePayloadRoot(), target, { workflows: true });
    assert.strictEqual(result.gitignore, true);
    assert.strictEqual(readFile(join(target, ".gitignore"), "utf8"), "node_modules/\n");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
