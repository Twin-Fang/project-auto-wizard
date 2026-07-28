import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { runStatus } from "../../src/commands/status.js";

function installFixture() {
  const target = mkdtempSync(join(tmpdir(), "paw-status-"));
  const ctx = createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(), includeCodeRabbit: false,
    now: "2026-07-28 00:00:00", today: "2026-07-28", templateVersion: "0.1.0",
  });
  runFull(ctx, resolvePayloadRoot(), target);
  return target;
}

test("runStatus: not installed", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-status-empty-"));
  try {
    assert.deepStrictEqual(runStatus(resolvePayloadRoot(), target), { installed: false });
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("runStatus: fresh install reports version and no modified files", () => {
  const target = installFixture();
  try {
    const status = runStatus(resolvePayloadRoot(), target);
    assert.strictEqual(status.installed, true);
    assert.strictEqual(status.version, "1.0.0");
    assert.deepStrictEqual(status.types, ["basic"]);
    assert.deepStrictEqual(status.modifiedFiles, []);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("runStatus: user-edited common workflow file appears in modifiedFiles", () => {
  const target = installFixture();
  try {
    const wfPath = join(target, ".github/workflows/PROJECT-COMMON-VERSION-CONTROL.yaml");
    assert.ok(existsSync(wfPath));
    writeFileSync(wfPath, readFileSync(wfPath, "utf8") + "\n# user edit\n");

    const status = runStatus(resolvePayloadRoot(), target);
    assert.ok(status.modifiedFiles.includes("PROJECT-COMMON-VERSION-CONTROL.yaml"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
