// tests/node/workflow-conflicts.test.js
// issue #20 H3 — common 워크플로우도 타입별과 동일한 3지선이 적용되는지 검증.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { copyWorkflows, listWorkflowConflicts } from "../../src/core/copy/workflows.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";

const PAYLOAD = resolvePayloadRoot();

function ctxFor(overrides = {}) {
  return createContext({
    mode: "full", force: true, types: ["node"], version: "1.0.0",
    branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(),
    ...overrides,
  });
}

test("listWorkflowConflicts: an edited COMMON file is surfaced as a conflict with type 'common'", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-wf-conflicts-"));
  try {
    const ctx = ctxFor();
    copyWorkflows(ctx, PAYLOAD, target);
    const wfPath = join(target, ".github/workflows/PROJECT-COMMON-RELEASE-PUBLISH.yaml");
    writeFileSync(wfPath, readFileSync(wfPath, "utf8") + "\n# user edit\n");

    const conflicts = listWorkflowConflicts(ctx, PAYLOAD, target);
    const common = conflicts.find((c) => c.filename === "PROJECT-COMMON-RELEASE-PUBLISH.yaml");
    assert.ok(common, "edited common file must appear in conflicts");
    assert.strictEqual(common.type, "common");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("copyWorkflows: a changed COMMON file with no decision defaults to skip (keeps user edit) — matches type-specific default", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-wf-conflicts-"));
  try {
    const ctx = ctxFor();
    copyWorkflows(ctx, PAYLOAD, target);
    const wfPath = join(target, ".github/workflows/PROJECT-COMMON-RELEASE-PUBLISH.yaml");
    const edited = readFileSync(wfPath, "utf8") + "\n# user edit\n";
    writeFileSync(wfPath, edited);

    copyWorkflows(ctx, PAYLOAD, target); // decisions 미지정 -> skip 기본값
    assert.strictEqual(readFileSync(wfPath, "utf8"), edited, "changed common file must be kept when no decision is given");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("copyWorkflows: a changed COMMON file with 'backup' decision is backed up and replaced", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-wf-conflicts-"));
  try {
    const ctx = ctxFor();
    copyWorkflows(ctx, PAYLOAD, target);
    const wfPath = join(target, ".github/workflows/PROJECT-COMMON-RELEASE-PUBLISH.yaml");
    const edited = readFileSync(wfPath, "utf8") + "\n# user edit\n";
    writeFileSync(wfPath, edited);

    const result = copyWorkflows(ctx, PAYLOAD, target, {
      decisions: new Map([["PROJECT-COMMON-RELEASE-PUBLISH.yaml", "backup"]]),
    });
    assert.ok(result.copiedFiles.includes("PROJECT-COMMON-RELEASE-PUBLISH.yaml"));
    assert.strictEqual(readFileSync(wfPath + ".bak", "utf8"), edited);
    assert.notStrictEqual(readFileSync(wfPath, "utf8"), edited);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("copyWorkflows/listWorkflowConflicts: trunk-based mode excludes VERSION-CONTROL/AUTO-CHANGELOG-CONTROL from conflicts even if a stale pr-flow install differs", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-wf-conflicts-"));
  try {
    const prFlowCtx = ctxFor(); // pr-flow 기본값 -> VERSION-CONTROL 설치됨
    copyWorkflows(prFlowCtx, PAYLOAD, target);
    const wfPath = join(target, ".github/workflows/PROJECT-COMMON-VERSION-CONTROL.yaml");
    writeFileSync(wfPath, readFileSync(wfPath, "utf8") + "\n# user edit\n");

    const trunkCtx = ctxFor({ branches: { main: "main", develop: "main", mode: "trunk-based" } });
    const conflicts = listWorkflowConflicts(trunkCtx, PAYLOAD, target);
    assert.ok(!conflicts.some((c) => c.filename === "PROJECT-COMMON-VERSION-CONTROL.yaml"));
  } finally { rmSync(target, { recursive: true, force: true }); }
});
