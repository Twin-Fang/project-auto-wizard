// Gate: verifies the payload single-source-of-truth wiring.
// 1) resolvePayloadRoot() points to payload/ at the package root
// 2) listCommonWorkflows() returns the 5 common workflows including RELEASE-PUBLISH
// 3) no imports of the removed modules (ide, skills, labels UI, exclusions and similar) remain in src
// 4) copyScripts installs payload/scripts/*.py into .github/scripts/ (if missed, the installed workflows die at runtime)
import { test } from "node:test";
import assert from "node:assert";
import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { resolvePayloadRoot, readTemplateVersion, listCommonWorkflows, assertPayload } from "../../src/core/assets.js";
import { copyScripts, removeScriptBytecode } from "../../src/core/copy/simple.js";

test("resolvePayloadRoot points to the package payload/", () => {
  const root = resolvePayloadRoot();
  assert.strictEqual(resolve(root), resolve(join(process.cwd(), "payload")));
  assert.ok(existsSync(join(root, "workflows")), "payload/workflows missing");
  assert.ok(existsSync(join(root, "scripts")), "payload/scripts missing");
  assert.strictEqual(assertPayload(root), root);
});

test("readTemplateVersion returns the package.json version", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.strictEqual(readTemplateVersion(), pkg.version);
});

test("listCommonWorkflows returns the 6 common workflows incl. RELEASE-PUBLISH and ISSUE-HELPER", () => {
  const names = listCommonWorkflows();
  assert.strictEqual(names.length, 6, `expected 6, got ${names.length}: ${names}`);
  for (const wf of [
    "PROJECT-COMMON-AI-PR-SUMMARY.yaml",
    "PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml",
    "PROJECT-COMMON-ISSUE-HELPER.yaml",
    "PROJECT-COMMON-README-VERSION-UPDATE.yaml",
    "PROJECT-COMMON-RELEASE-PUBLISH.yaml",
    "PROJECT-COMMON-VERSION-CONTROL.yaml",
  ]) assert.ok(names.includes(wf), `${wf} missing`);
});

test("no residual imports of excluded modules in src/", () => {
  const banned = [
    "core/ide/", "commands/skills", "commands/issues",
    "skills-prompts", "exclusions.js", "acquireTemplate", "TEMPLATE_REPO",
  ];
  const files = readdirSync("src", { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".js"));
  for (const f of files) {
    const body = readFileSync(join("src", f), "utf8");
    for (const b of banned) {
      // Only check leftover imports/calls — historical mentions in comments ("old acquireTemplate") are allowed
      for (const line of body.split("\n")) {
        const code = line.split("//")[0];
        assert.ok(!code.includes(b), `src${sep}${f}: excluded reference '${b}' → ${line.trim()}`);
      }
    }
  }
});

test("copyScripts installs payload python scripts into .github/scripts/", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-scripts-"));
  try {
    const copied = copyScripts(resolvePayloadRoot(), target);
    assert.strictEqual(copied.length, 5);
    assert.ok(copied.every((r) => r.action === "create"));
    assert.ok(existsSync(join(target, ".github", "scripts", "version_manager.py")));
    assert.ok(existsSync(join(target, ".github", "scripts", "changelog_manager.py")));
    assert.ok(existsSync(join(target, ".github", "scripts", "truncate_release_notes.py")));
    assert.ok(existsSync(join(target, ".github", "scripts", "issue_helper.py")));
    assert.ok(existsSync(join(target, ".github", "scripts", "messages.py")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// pyc files committed by older versions are removed on update — nothing outside the wizard script folder is touched.
test("removeScriptBytecode removes only pyc files and empty __pycache__ under .github/scripts", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-pyc-"));
  try {
    const scripts = join(target, ".github", "scripts");
    mkdirSync(join(scripts, "__pycache__"), { recursive: true });
    mkdirSync(join(target, "src", "__pycache__"), { recursive: true });
    writeFileSync(join(scripts, "__pycache__", "version_manager.cpython-312.pyc"), "x");
    writeFileSync(join(scripts, "__pycache__", "changelog_manager.cpython-312.pyc"), "x");
    writeFileSync(join(scripts, "old.pyc"), "x");
    writeFileSync(join(scripts, "version_manager.py"), "print(1)\n");
    writeFileSync(join(target, "src", "__pycache__", "app.cpython-312.pyc"), "x");

    const removed = removeScriptBytecode(target);
    assert.deepStrictEqual(removed.sort(), [
      ".github/scripts/__pycache__/changelog_manager.cpython-312.pyc",
      ".github/scripts/__pycache__/version_manager.cpython-312.pyc",
      ".github/scripts/old.pyc",
    ]);
    assert.ok(!existsSync(join(scripts, "__pycache__")), "empty __pycache__ is removed");
    assert.ok(existsSync(join(scripts, "version_manager.py")), "scripts are kept");
    assert.ok(existsSync(join(target, "src", "__pycache__", "app.cpython-312.pyc")), "pyc files in other paths are not touched");
    assert.deepStrictEqual(removeScriptBytecode(target), [], "the second run has nothing to do");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeScriptBytecode does not remove a __pycache__ that still holds non-pyc files", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-pyc-"));
  try {
    const cache = join(target, ".github", "scripts", "__pycache__");
    mkdirSync(cache, { recursive: true });
    writeFileSync(join(cache, "a.cpython-312.pyc"), "x");
    writeFileSync(join(cache, "notes.txt"), "keep");
    assert.deepStrictEqual(removeScriptBytecode(target), [".github/scripts/__pycache__/a.cpython-312.pyc"]);
    assert.ok(existsSync(join(cache, "notes.txt")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeScriptBytecode quietly returns an empty list even when the scripts folder is missing", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-pyc-"));
  try {
    assert.deepStrictEqual(removeScriptBytecode(target), []);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
