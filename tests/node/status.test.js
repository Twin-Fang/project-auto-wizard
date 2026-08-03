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
    paths: new Map(),
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

test("printStatus: null nexus/secretBackup render as '미설정(기본 false)' not raw null", () => {
  const status = {
    installed: true,
    version: "1.0.0",
    templateVersion: "0.1.0",
    types: ["basic"],
    branches: null,
    options: { nexus: null, secretBackup: null, semverAuto: null },
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
  assert.ok(output.includes("nexus=미설정(기본 false)"));
  assert.ok(output.includes("secret_backup=미설정(기본 false)"));
  assert.ok(output.includes("semver_auto=미설정(기본 false)"));
});

test("runStatus: version.yml without a branches block does not false-flag every workflow as modified", () => {
  // version.yml이 branches 기능 이전에 만들어졌거나 수기 편집으로 branches 블록이 빠진 경우 —
  // parseTemplateBranches가 null을 반환해도 status가 매 파일을 오탐 드리프트로 보고하면 안 된다.
  const target = installFixture();
  try {
    const vyPath = join(target, "version.yml");
    const original = readFileSync(vyPath, "utf8");
    const stripped = original
      .split("\n")
      .filter((l) => !/^\s*branches:\s*$/.test(l) && !/^\s+(main|develop|mode):\s*"?[\w-]/.test(l))
      .join("\n");
    writeFileSync(vyPath, stripped);

    const status = runStatus(resolvePayloadRoot(), target);
    assert.strictEqual(status.branches, null, "branches should be null once the block is stripped");
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
