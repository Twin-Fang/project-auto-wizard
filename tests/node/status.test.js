import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { runStatus, printStatus } from "../../src/commands/status.js";

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

test("printStatus: null nexus/secretBackup/coderabbit render as '미설정(기본 false)' not raw null", () => {
  const status = {
    installed: true,
    version: "1.0.0",
    templateVersion: "0.1.0",
    types: ["basic"],
    branches: null,
    options: { nexus: null, secretBackup: null, coderabbit: null, semverAuto: null },
    modifiedFiles: [],
  };
  const originalLog = console.log;
  let output = "";
  console.log = (msg) => { output += msg; };
  try {
    printStatus(status);
  } finally {
    console.log = originalLog;
  }
  assert.ok(!output.includes("nexus=null"), "nexus=null must not leak into output");
  assert.ok(!output.includes("secret_backup=null"), "secret_backup=null must not leak into output");
  assert.ok(!output.includes("coderabbit=null"), "coderabbit=null must not leak into output");
  assert.ok(output.includes("nexus=미설정(기본 false)"));
  assert.ok(output.includes("secret_backup=미설정(기본 false)"));
  assert.ok(output.includes("coderabbit=미설정(기본 false)"));
  assert.ok(output.includes("semver_auto=미설정(기본 true)"));
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
