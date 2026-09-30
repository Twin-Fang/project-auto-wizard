// tests/node/workflows-copied-files.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { copyWorkflows } from "../../src/core/copy/workflows.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";

const PAYLOAD = resolvePayloadRoot();

function freshTarget(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function ctxFor(types, extra = {}) {
  return createContext({
    mode: "full", force: true, types, version: "1.0.0",
    branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(),
    ...extra,
  });
}

test("copyWorkflows: on first install copiedFiles holds every file name actually copied and its count matches copied", () => {
  const target = freshTarget("paw-copied-files-init-");
  try {
    const result = copyWorkflows(ctxFor(["node"]), PAYLOAD, target);
    assert.ok(Array.isArray(result.copiedFiles));
    assert.strictEqual(result.copiedFiles.length, result.copied);
    assert.ok(result.copiedFiles.includes("PROJECT-COMMON-RELEASE-PUBLISH.yaml"));
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("copyWorkflows: files unchanged (skipped) on rerun are not in copiedFiles", () => {
  const target = freshTarget("paw-copied-files-rerun-");
  try {
    const ctx = ctxFor(["node"]);
    copyWorkflows(ctx, PAYLOAD, target); // first install
    const second = copyWorkflows(ctx, PAYLOAD, target); // rerun under the same conditions -> all unchanged
    assert.strictEqual(second.copiedFiles.length, 0);
    assert.strictEqual(second.copied, 0);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("copyWorkflows: a backup decision records the original file name and a template decision records the .template.yaml name in copiedFiles", () => {
  const target = freshTarget("paw-copied-files-decision-");
  try {
    // Spring CI is used because verifying the "strip only .yaml" rule needs a .yml file.
    const ctx = ctxFor(["spring"]);
    copyWorkflows(ctx, PAYLOAD, target); // first install (creates spring-only files)

    const targetFile = join(target, ".github", "workflows", "PROJECT-SPRING-CI.yml");
    writeFileSync(targetFile, "changed-content-that-differs-from-template\n");
    const backupResult = copyWorkflows(ctx, PAYLOAD, target, {
      decisions: new Map([["PROJECT-SPRING-CI.yml", "backup"]]),
    });
    assert.ok(backupResult.copiedFiles.includes("PROJECT-SPRING-CI.yml"));

    writeFileSync(targetFile, "changed-again\n");
    const templateResult = copyWorkflows(ctx, PAYLOAD, target, {
      decisions: new Map([["PROJECT-SPRING-CI.yml", "template"]]),
    });
    // applyDecision() template naming rule: only .yaml is stripped; for .yml, .template.yaml is appended as is.
    assert.ok(templateResult.copiedFiles.includes("PROJECT-SPRING-CI.yml.template.yaml"));
    assert.ok(!templateResult.copiedFiles.includes("PROJECT-SPRING-CI.yml"));
  } finally { rmSync(target, { recursive: true, force: true }); }
});
