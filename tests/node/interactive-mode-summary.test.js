// tests/node/interactive-mode-summary.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInteractive } from "../../src/commands/interactive.js";

function stubIo() {
  const summaryCalls = [];
  return {
    io: {
      selectMode: async () => "workflows",
      confirmProjectMenu: async () => "continue",
      askYesNo: async (_message, def) => def,
      askText: async (_message, def) => def,
      note: () => {},
      cancelMessage: () => {},
      summary: (ctx) => summaryCalls.push(ctx),
      outro: () => {},
    },
    summaryCalls,
  };
}

test("runInteractive: on completing workflows mode, io.summary is called with copiedFiles (new signature) — not counters", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-interactive-summary-"));
  try {
    const { io, summaryCalls } = stubIo();
    const code = await runInteractive({}, { cwd: target, io });
    assert.strictEqual(code, 0);
    assert.strictEqual(summaryCalls.length, 1, "io.summary must be called exactly once");
    const ctx = summaryCalls[0];
    assert.ok(Array.isArray(ctx.copiedFiles), "ctx.copiedFiles must be an array (new signature)");
    assert.ok(ctx.copiedFiles.length > 0, "this is a fresh install, so at least the common workflows must be copied");
    assert.strictEqual(ctx.counters, undefined, "the old counters field must not remain");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// Regression guard — the detected build number must also reach ctx.versionCode on the interactive wizard path.
test("runInteractive: the build number in pubspec.yaml reaches ctx.versionCode even without edits", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-interactive-buildnumber-"));
  try {
    writeFileSync(join(target, "pubspec.yaml"), "name: sample_app\nversion: 1.2.39+71\n");
    const { io, summaryCalls } = stubIo();
    const code = await runInteractive({}, { cwd: target, io });
    assert.strictEqual(code, 0);
    assert.strictEqual(summaryCalls.length, 1, "io.summary must be called exactly once");
    const ctx = summaryCalls[0];
    assert.strictEqual(ctx.versionCode, 71, "the +71 in pubspec.yaml must be detected as versionCode");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// Regression guard — even when the project type is changed late in the wizard edit loop
// to flutter, build-number detection must use the finally confirmed types (not the stale pre-edit ones).
// If detection ran before the edit loop ended, versionCode would fall to 1 instead of 42 here.
test("runInteractive: changing type to flutter in the edit loop detects the build number with the confirmed types", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-interactive-buildnumber-edit-"));
  try {
    // At initial detection pubspec.yaml is absent, so detectTypes misses flutter (package.json -> "node").
    writeFileSync(join(target, "package.json"), JSON.stringify({ name: "sample-app", version: "1.0.0" }));

    let confirmCalls = 0;
    let editCalls = 0;
    const { io, summaryCalls } = stubIo();
    io.confirmProjectMenu = async () => {
      confirmCalls += 1;
      return confirmCalls === 1 ? "edit" : "continue";
    };
    io.editMenu = async () => {
      editCalls += 1;
      return editCalls === 1 ? "type" : "done";
    };
    io.selectTypes = async () => {
      // pubspec.yaml becomes available when the user additionally selects flutter in the edit menu
      // (reproduces flutter being reflected late in a project newly being integrated).
      writeFileSync(join(target, "pubspec.yaml"), "name: sample_app\nversion: 1.0.0+42\n");
      return ["flutter"];
    };

    const code = await runInteractive({}, { cwd: target, io });
    assert.strictEqual(code, 0);
    assert.strictEqual(summaryCalls.length, 1, "io.summary must be called exactly once");
    const ctx = summaryCalls[0];
    assert.deepStrictEqual(ctx.types, ["flutter"], "the types confirmed in the edit loop must be applied finally");
    assert.strictEqual(ctx.versionCode, 42, "the +42 in pubspec.yaml must be detected using the types confirmed after editing");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
