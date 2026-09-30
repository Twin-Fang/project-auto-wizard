// tests/node/stale-workflows.test.js
// Old workflows renamed or removed in the payload are cleaned up on update — left alone they keep running on old triggers.
// Same rule as deploy style cleanup: untouched files are deleted, edited files become .bak, files with no wizard install record are left as is.
import "../setup-lang.mjs"; // these tests assert the ko output
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull, postInstallNotices } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { runStatus } from "../../src/commands/status.js";
import { sha256, BASELINE_PATH } from "../../src/core/baseline.js";
import { MANAGED_WORKFLOW_MARKER } from "../../src/core/removal-plan.js";

const PAYLOAD = resolvePayloadRoot();
const WF = join(".github", "workflows");

function ctx() {
  return createContext({
    mode: "full", force: true, types: ["python"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(), now: "2026-09-01 00:00:00", today: "2026-09-01", templateVersion: "0.12.2",
  });
}

// Simulates a file installed by an old version — managed marker + baseline record.
function plantOld(target, name, body, { recorded = true } = {}) {
  const text = `${MANAGED_WORKFLOW_MARKER}\nname: ${body}\non: push\n`;
  writeFileSync(join(target, WF, name), text);
  if (recorded) {
    const bp = join(target, BASELINE_PATH);
    const bl = JSON.parse(readFileSync(bp, "utf8"));
    bl.files[name] = { installed: sha256(text), rendered: sha256(text) };
    writeFileSync(bp, JSON.stringify(bl, null, 2));
  }
  return join(target, WF, name);
}

test("update: old workflows absent from the payload — unedited deleted, edited copies .bak, files without a record kept", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-stale-"));
  try {
    runFull(ctx(), PAYLOAD, target);
    const untouched = plantOld(target, "PROJECT-PYTHON-OLD-TRIGGER.yaml", "old-trigger");
    const edited = plantOld(target, "PROJECT-COMMON-SECRET-FILE-UPLOAD.yaml", "secret-upload");
    writeFileSync(edited, readFileSync(edited, "utf8") + "# my edit\n");
    const userCopy = plantOld(target, "MY-APP-DEPLOY.yaml", "my-copy", { recorded: false });

    // status reports it before the update
    assert.deepStrictEqual(runStatus(PAYLOAD, target).staleFiles,
      ["PROJECT-COMMON-SECRET-FILE-UPLOAD.yaml", "PROJECT-PYTHON-OLD-TRIGGER.yaml"]);

    const r = runFull(ctx(), PAYLOAD, target);
    assert.deepStrictEqual(r.staleCleanup.removed, ["PROJECT-PYTHON-OLD-TRIGGER.yaml"]);
    assert.deepStrictEqual(r.staleCleanup.backedUp, ["PROJECT-COMMON-SECRET-FILE-UPLOAD.yaml"]);
    assert.ok(!existsSync(untouched));
    assert.ok(!existsSync(edited) && existsSync(`${edited}.bak`));
    assert.ok(existsSync(userCopy), "a file with no wizard install record is not touched");
    assert.ok(r.gitignoreUpdated, "a .bak was created so .gitignore is updated");
    assert.match(postInstallNotices(r).join("\n"), /PROJECT-PYTHON-OLD-TRIGGER\.yaml — 삭제/);

    const bl = JSON.parse(readFileSync(join(target, BASELINE_PATH), "utf8"));
    assert.ok(!bl.files["PROJECT-PYTHON-OLD-TRIGGER.yaml"] && !bl.files["PROJECT-COMMON-SECRET-FILE-UPLOAD.yaml"],
      "the reference of a cleaned-up file is also removed from the baseline");
    assert.deepStrictEqual(runStatus(PAYLOAD, target).staleFiles, []);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("update: files present in the current payload are not treated as old workflows", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-stale-"));
  try {
    runFull(ctx(), PAYLOAD, target);
    const r = runFull(ctx(), PAYLOAD, target);
    assert.deepStrictEqual(r.staleCleanup, { removed: [], backedUp: [] });
    assert.deepStrictEqual(postInstallNotices(r), []);
  } finally { rmSync(target, { recursive: true, force: true }); }
});
