// tests/node/status-missing-scripts.test.js
// status must not report a healthy install when a script the workflows call is gone.
import "../setup-lang.mjs"; // these tests assert the ko output
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { runStatus, printStatus } from "../../src/commands/status.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { SCRIPT_NAMES, findMissingScripts } from "../../src/core/copy/simple.js";

const PAYLOAD = resolvePayloadRoot();
const ctx = () => createContext({
  mode: "full", force: true, types: ["react"], version: "1.0.0", versionCode: 1,
  branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
  paths: new Map(), now: "2026-09-01 00:00:00", today: "2026-09-01", templateVersion: "0.15.0",
});
const capture = (fn) => {
  const orig = console.log; let out = "";
  console.log = (s) => { out += `${s}\n`; };
  try { fn(); } finally { console.log = orig; }
  return out;
};

test("status: a fresh install has no missing scripts and prints no warning", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-scripts-"));
  try {
    runFull(ctx(), PAYLOAD, target);
    const s = runStatus(PAYLOAD, target);
    assert.deepStrictEqual(s.missingScripts, []);
    assert.doesNotMatch(capture(() => printStatus(s)), /--mode full --force/);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("status: every deleted script is reported with the restore command, and a full rerun restores it", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-scripts-"));
  try {
    runFull(ctx(), PAYLOAD, target);
    for (const name of SCRIPT_NAMES) rmSync(join(target, ".github", "scripts", name));
    const s = runStatus(PAYLOAD, target);
    assert.deepStrictEqual(s.missingScripts, SCRIPT_NAMES);
    const out = capture(() => printStatus(s));
    assert.match(out, /messages\.py/);
    assert.match(out, /--mode full --force/);

    runFull(ctx(), PAYLOAD, target);
    assert.ok(existsSync(join(target, ".github", "scripts", "messages.py")));
    assert.deepStrictEqual(findMissingScripts(PAYLOAD, target), []);
  } finally { rmSync(target, { recursive: true, force: true }); }
});
