// tests/node/confirm-types.test.js
// Type confirmation step: detection is a guess, so it must be confirmed before other questions.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInteractive } from "../../src/commands/interactive.js";

function stubIo({ confirmTypes = ({ types }) => types } = {}) {
  const calls = { confirmTypes: [], summary: [] };
  const io = {
    selectMode: async () => "full",
    confirmProjectMenu: async () => "continue",
    askYesNo: async (_m, def) => def,
    askText: async (_m, def) => def,
    selectDeployStyle: async () => "simple",
    selectBranchStrategy: async () => "pr-flow",
    confirmTypes: async (arg) => { calls.confirmTypes.push(arg); return confirmTypes(arg); },
    note: () => {},
    cancelMessage: () => {},
    summary: (ctx) => calls.summary.push(ctx),
    outro: () => {},
  };
  return { io, calls };
}

function springFixture() {
  const target = mkdtempSync(join(tmpdir(), "paw-confirm-types-"));
  writeFileSync(join(target, "build.gradle.kts"), 'version = "1.0.0"\n');
  return target;
}

test("the type confirmation question receives the detection result together with its basis files", async () => {
  const target = springFixture();
  try {
    const { io, calls } = stubIo({ confirmTypes: ({ types }) => types });
    assert.strictEqual(await runInteractive({}, { cwd: target, io }), 0);

    assert.strictEqual(calls.confirmTypes.length, 1, "must ask exactly once on a fresh install");
    const { types, markers } = calls.confirmTypes[0];
    assert.deepStrictEqual(types, ["spring"]);
    assert.strictEqual(markers.get("spring"), "build.gradle.kts",
      "the basis must be shown so the user can judge whether it is right");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

// Removing over-detection: e.g. python getting pulled in by a single script-only requirements.txt.
// Previously the place to remove it was hidden two steps behind 'edit'.
test("when the user removes a detected type, that value is reflected in the install", async () => {
  const target = springFixture();
  try {
    writeFileSync(join(target, "requirements.txt"), "requests\n");
    const { io, calls } = stubIo({ confirmTypes: () => ["spring"] });
    assert.strictEqual(await runInteractive({}, { cwd: target, io }), 0);

    assert.deepStrictEqual(calls.confirmTypes[0].types, ["spring", "python"], "detection catches both");
    assert.deepStrictEqual(calls.summary[0].types, ["spring"], "only the confirmed types must be installed");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("cancel (ESC) or an empty selection keeps the detection result", async () => {
  const target = springFixture();
  try {
    const { io, calls } = stubIo({ confirmTypes: () => [] });
    assert.strictEqual(await runInteractive({}, { cwd: target, io }), 0);
    assert.deepStrictEqual(calls.summary[0].types, ["spring"], "an empty selection must not erase the types");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("an update install whose version.yml already has types does not ask again", async () => {
  const target = springFixture();
  try {
    writeFileSync(join(target, "version.yml"),
      'version: "1.0.0"\nversion_code: 1\nproject_types: ["spring"]\n');
    const { io, calls } = stubIo({ confirmTypes: ({ types }) => types });
    assert.strictEqual(await runInteractive({}, { cwd: target, io }), 0);
    assert.strictEqual(calls.confirmTypes.length, 0,
      "project_types is the single source of truth, so re-asking is unnecessary");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("a correct detection is confirmed as is (one Enter)", async () => {
  const target = springFixture();
  try {
    const { io, calls } = stubIo();
    assert.strictEqual(await runInteractive({}, { cwd: target, io }), 0);
    assert.deepStrictEqual(calls.summary[0].types, ["spring"]);
  } finally { rmSync(target, { recursive: true, force: true }); }
});
