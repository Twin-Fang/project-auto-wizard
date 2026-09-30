// tests/node/gitignore-trigger.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";

function baseContext(overrides = {}) {
  return createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(),
    now: "2026-08-02 00:00:00", today: "2026-08-02", templateVersion: "0.1.0",
    ...overrides,
  });
}

// Since the baseline 3-way merge, "user-only edits" are kept without asking (localOnly),
// so verifying the conflict-decision (backup/template) path needs a real conflict.
// Skew the baseline rendered hash to make it look like "upstream changed too".
function forceUpstreamChange(target, filename) {
  const bp = join(target, ".github/.wizard/baseline.json");
  const bl = JSON.parse(readFileSync(bp, "utf8"));
  bl.files[filename].rendered = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
  writeFileSync(bp, JSON.stringify(bl, null, 2));
}

test("runFull: a first install without conflicts creates no .gitignore at all", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-full-gitignore-"));
  try {
    const result = runFull(baseContext(), resolvePayloadRoot(), target);
    assert.strictEqual(result.gitignoreUpdated, false);
    assert.ok(!existsSync(join(target, ".gitignore")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// NOTE: the two tests below use PROJECT-PYTHON-CI.yaml (a per-type workflow) as an example — pinning a specific file
// only keeps the tests stable; since the fix, PROJECT-COMMON-*.yaml also goes through
// the same three-way choice (backup/template decision), so these tests hold with a common file too.
// (The file's existence in payload/workflows/python/ has been verified.)
test("runFull: resolving a per-type workflow conflict with 'backup' adds *.bak to .gitignore", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-full-gitignore-"));
  try {
    const ctx = baseContext({ types: ["python"] });
    const payloadRoot = resolvePayloadRoot();
    runFull(ctx, payloadRoot, target);
    const wfPath = join(target, ".github/workflows/PROJECT-PYTHON-CI.yaml");
    assert.ok(existsSync(wfPath));
    writeFileSync(wfPath, readFileSync(wfPath, "utf8") + "\n# user edit\n");
    forceUpstreamChange(target, "PROJECT-PYTHON-CI.yaml");

    const result = runFull(ctx, payloadRoot, target, {
      decisions: new Map([["PROJECT-PYTHON-CI.yaml", "backup"]]),
    });

    assert.ok(existsSync(wfPath + ".bak"));
    assert.strictEqual(result.gitignoreUpdated, true);
    assert.ok(existsSync(join(target, ".gitignore")));
    assert.ok(readFileSync(join(target, ".gitignore"), "utf8").includes("*.bak"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("runFull: resolving a per-type workflow conflict with 'template' adds *.template.yaml to .gitignore", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-full-gitignore-"));
  try {
    const ctx = baseContext({ types: ["python"] });
    const payloadRoot = resolvePayloadRoot();
    runFull(ctx, payloadRoot, target);
    const wfPath = join(target, ".github/workflows/PROJECT-PYTHON-CI.yaml");
    writeFileSync(wfPath, readFileSync(wfPath, "utf8") + "\n# user edit\n");
    forceUpstreamChange(target, "PROJECT-PYTHON-CI.yaml");

    const result = runFull(ctx, payloadRoot, target, {
      decisions: new Map([["PROJECT-PYTHON-CI.yaml", "template"]]),
    });

    assert.ok(existsSync(join(target, ".github/workflows/PROJECT-PYTHON-CI.template.yaml")));
    assert.strictEqual(result.gitignoreUpdated, true);
    assert.ok(readFileSync(join(target, ".gitignore"), "utf8").includes("*.template.yaml"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("runFull: no .coderabbit.yaml appears in the installed output", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-full-gitignore-"));
  try {
    runFull(baseContext(), resolvePayloadRoot(), target);
    assert.ok(!existsSync(join(target, ".coderabbit.yaml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

