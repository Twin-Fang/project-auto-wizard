// tests/node/baseline-3way.test.js
// 3-way classification based on the install-time baseline. The goal is classification, not auto-merge:
// separate "safe to automate" from "needs a human" so the number of questions equals the number of real conflicts.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { listWorkflowConflicts, surveyWorkflows, planWorkflows } from "../../src/core/copy/workflows.js";
import { readBaseline, sha256, BASELINE_PATH } from "../../src/core/baseline.js";

const PAYLOAD = resolvePayloadRoot();
const WF = ".github/workflows";
const TARGET_WF = "PROJECT-PYTHON-CI.yaml";

function ctxFor(target) {
  return createContext({
    mode: "full", force: true, types: ["python"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(), now: "2026-08-10 00:00:00", today: "2026-08-10", templateVersion: "0.1.0",
  });
}

function install() {
  const target = mkdtempSync(join(tmpdir(), "paw-3way-"));
  runFull(ctxFor(target), PAYLOAD, target);
  return target;
}

// Skewing the baseline's rendered hash simulates "upstream changed this file".
// It is the only way to simulate an upstream change without actually modifying the payload.
function fakeUpstreamChange(target, filename) {
  const bp = join(target, BASELINE_PATH);
  const bl = JSON.parse(readFileSync(bp, "utf8"));
  bl.files[filename].rendered = "sha256:" + "0".repeat(64);
  writeFileSync(bp, JSON.stringify(bl, null, 2));
}

test("install leaves a baseline (installed/rendered hashes)", () => {
  const target = install();
  try {
    const bl = readBaseline(target);
    assert.ok(bl, "baseline.json must be created");
    const entry = bl.files[TARGET_WF];
    assert.ok(entry, `${TARGET_WF} must be in the baseline`);
    assert.match(entry.installed, /^sha256:[0-9a-f]{64}$/);
    assert.match(entry.rendered, /^sha256:[0-9a-f]{64}$/);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("user edit + upstream unchanged → 0 questions, edited copy kept as is (localOnly)", () => {
  const target = install();
  try {
    const wf = join(target, WF, TARGET_WF);
    const edited = readFileSync(wf, "utf8") + "\n# my edit\n";
    writeFileSync(wf, edited);

    // This is a real-world case — previously it asked about all 12 files here.
    assert.deepStrictEqual(listWorkflowConflicts(ctxFor(target), PAYLOAD, target), [],
      "nothing to ask when upstream is unchanged");

    runFull(ctxFor(target), PAYLOAD, target);
    assert.strictEqual(readFileSync(wf, "utf8"), edited, "the user's edited copy must be preserved");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

// Build the state "an old version is installed and upstream changed afterwards".
// Roll the disk back to the old content and align baseline.installed with it
// = the user did not touch it (installed matches) while the payload changed meanwhile (theirs ≠ ours).
function simulateOldInstall(target, filename) {
  const wf = join(target, WF, filename);
  const older = readFileSync(wf, "utf8") + "\n# trace of an old release\n";
  writeFileSync(wf, older);
  const bp = join(target, BASELINE_PATH);
  const bl = JSON.parse(readFileSync(bp, "utf8"));
  bl.files[filename].installed = sha256(older);
  writeFileSync(bp, JSON.stringify(bl, null, 2));
  return older;
}

test("user unedited + upstream changed → 0 questions, auto-replaced (upstreamOnly)", () => {
  const target = install();
  try {
    const stale = simulateOldInstall(target, TARGET_WF);
    const wf = join(target, WF, TARGET_WF);

    assert.deepStrictEqual(listWorkflowConflicts(ctxFor(target), PAYLOAD, target), [],
      "nothing to ask when the user did not touch it");

    const plan = planWorkflows(ctxFor(target), PAYLOAD, target);
    assert.ok(plan.upstreamOnly.some((f) => f.filename === TARGET_WF));

    const r = runFull(ctxFor(target), PAYLOAD, target);
    assert.ok(r.workflows.autoUpdated.includes(TARGET_WF), "must be in the auto-applied list");
    assert.notStrictEqual(readFileSync(wf, "utf8"), stale, "old content must be replaced with the latest");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("both changed → classified as a real conflict and asked (changed)", () => {
  const target = install();
  try {
    const wf = join(target, WF, TARGET_WF);
    writeFileSync(wf, readFileSync(wf, "utf8") + "\n# my edit\n");
    fakeUpstreamChange(target, TARGET_WF);

    const conflicts = listWorkflowConflicts(ctxFor(target), PAYLOAD, target);
    assert.ok(conflicts.some((c) => c.filename === TARGET_WF),
      "when both sides changed a human must look");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("an existing install without a baseline is treated as a conflict as before, and the baseline is planted in that run (fallback)", () => {
  const target = install();
  try {
    rmSync(join(target, BASELINE_PATH), { force: true }); // repo installed by a pre-baseline version
    const wf = join(target, WF, TARGET_WF);
    writeFileSync(wf, readFileSync(wf, "utf8") + "\n# my edit\n");

    const conflicts = listWorkflowConflicts(ctxFor(target), PAYLOAD, target);
    assert.ok(conflicts.some((c) => c.filename === TARGET_WF), "unknown base falls back to conflict");

    runFull(ctxFor(target), PAYLOAD, target); // skip decision (unspecified) → keep the user's edited copy
    assert.ok(readBaseline(target), "the baseline must be planted in this run");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("the installed reference of a kept (skip) file is not updated — recording the user's edit as 'what we wrote' would silently overwrite it on the next update", () => {
  const target = install();
  try {
    const before = readBaseline(target).files[TARGET_WF].installed;
    const wf = join(target, WF, TARGET_WF);
    writeFileSync(wf, readFileSync(wf, "utf8") + "\n# my edit\n");
    runFull(ctxFor(target), PAYLOAD, target); // localOnly → keep

    assert.strictEqual(readBaseline(target).files[TARGET_WF].installed, before,
      "the installed hash of a kept file must keep its install-time value");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

// ── Files deleted by the user ──────────────────────────────────────────────

test("a file deleted by the user is not silently revived", () => {
  const target = install();
  try {
    const wf = join(target, WF, TARGET_WF);
    rmSync(wf, { force: true });

    const { removed } = surveyWorkflows(ctxFor(target), PAYLOAD, target);
    assert.ok(removed.some((r) => r.filename === TARGET_WF), "the deletion must be detected");

    const r = runFull(ctxFor(target), PAYLOAD, target);
    assert.ok(!existsSync(wf), "must not be revived without asking");
    assert.ok(r.workflows.removedKept.includes(TARGET_WF));
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("only files decided for restore are reinstalled", () => {
  const target = install();
  try {
    const wf = join(target, WF, TARGET_WF);
    rmSync(wf, { force: true });

    const r = runFull(ctxFor(target), PAYLOAD, target, { restoreRemoved: new Set([TARGET_WF]) });
    assert.ok(existsSync(wf), "must be reinstalled when there is a restore decision");
    assert.ok(r.workflows.restoredFiles.includes(TARGET_WF));
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("the deleted state persists across reruns (baseline merge does not lose the reference)", () => {
  const target = install();
  try {
    const wf = join(target, WF, TARGET_WF);
    rmSync(wf, { force: true });
    runFull(ctxFor(target), PAYLOAD, target);
    runFull(ctxFor(target), PAYLOAD, target);
    assert.ok(!existsSync(wf), "must not be revived on the second rerun either");
  } finally { rmSync(target, { recursive: true, force: true }); }
});
