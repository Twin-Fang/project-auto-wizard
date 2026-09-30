// tests/node/plan-workflows.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { planWorkflows, copyWorkflows } from "../../src/core/copy/workflows.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";

function baseContext(overrides = {}) {
  return {
    types: ["basic"], paths: new Map(), repoName: "test-repo",
    resolvers: {}, branches: { main: "main", develop: "develop", mode: "pr-flow" },
    ...overrides,
  };
}

test("planWorkflows: fresh target -> everything is newFiles, nothing changed/unchanged", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-plan-"));
  try {
    const plan = planWorkflows(baseContext(), resolvePayloadRoot(), target);
    assert.ok(plan.newFiles.length > 0);
    assert.deepStrictEqual(plan.changed, []);
    assert.deepStrictEqual(plan.unchanged, []);
    // Check that common workflows are also included in newFiles
    assert.ok(plan.newFiles.some((f) => f.type === "common"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planWorkflows: after copyWorkflows, everything is unchanged", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-plan-"));
  try {
    const ctx = baseContext();
    copyWorkflows(ctx, resolvePayloadRoot(), target);
    const plan = planWorkflows(ctx, resolvePayloadRoot(), target);
    assert.deepStrictEqual(plan.newFiles, []);
    assert.deepStrictEqual(plan.changed, []);
    assert.ok(plan.unchanged.length > 0);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planWorkflows: editing an installed COMMON file surfaces it as changed", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-plan-"));
  try {
    const ctx = baseContext();
    copyWorkflows(ctx, resolvePayloadRoot(), target);
    const wfPath = join(target, ".github/workflows/PROJECT-COMMON-VERSION-CONTROL.yaml");
    assert.ok(existsSync(wfPath), "fixture must install PROJECT-COMMON-VERSION-CONTROL.yaml in pr-flow mode");
    writeFileSync(wfPath, readFileSync(wfPath, "utf8") + "\n# user edit\n");

    const plan = planWorkflows(ctx, resolvePayloadRoot(), target);
    const changedNames = plan.changed.map((f) => f.filename);
    assert.ok(changedNames.includes("PROJECT-COMMON-VERSION-CONTROL.yaml"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planWorkflows: editing an installed type-specific file surfaces it as changed", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-plan-"));
  try {
    // The "node"/"basic" types have no dedicated directory under payload/workflows/ (only common is installed) —
    // so use "react", which has real per-type files, as the fixture.
    const ctx = baseContext({ types: ["react"] });
    copyWorkflows(ctx, resolvePayloadRoot(), target);
    const plan = planWorkflows(ctx, resolvePayloadRoot(), target);
    const reactFile = plan.unchanged.find((f) => f.type === "react");
    assert.ok(reactFile, "expected at least one unchanged react-type workflow file after install");

    const wfPath = join(target, ".github/workflows", reactFile.filename);
    writeFileSync(wfPath, readFileSync(wfPath, "utf8") + "\n# user edit\n");

    const plan2 = planWorkflows(ctx, resolvePayloadRoot(), target);
    assert.ok(plan2.changed.some((f) => f.filename === reactFile.filename));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

