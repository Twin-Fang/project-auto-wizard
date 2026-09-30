// tests/node/status-missing-scripts.test.js
// status must not report a healthy install when a script the workflows call is gone.
import "../setup-lang.mjs"; // these tests assert the ko output
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
    // Only scripts the installed workflows call count; truncate_release_notes.py is used by Flutter workflows alone.
    assert.ok(s.missingScripts.includes("messages.py") && s.missingScripts.includes("version_manager.py"));
    assert.ok(!s.missingScripts.includes("truncate_release_notes.py"));
    const out = capture(() => printStatus(s));
    assert.match(out, /messages\.py/);
    assert.match(out, /--mode full --force/);

    runFull(ctx(), PAYLOAD, target);
    assert.ok(existsSync(join(target, ".github", "scripts", "messages.py")));
    assert.deepStrictEqual(findMissingScripts(PAYLOAD, target), []);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("findMissingScripts: a script imported by a called script is required too (issue_helper via changelog_manager)", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-scripts-"));
  try {
    runFull(ctx(), PAYLOAD, target);
    const workflows = join(target, ".github", "workflows");
    // Drop every workflow that names issue_helper.py itself, so only the import chain can require it.
    for (const f of readdirSync(workflows)) {
      if (readFileSync(join(workflows, f), "utf8").includes("issue_helper.py")) rmSync(join(workflows, f));
    }
    assert.ok(readdirSync(workflows).some((f) => readFileSync(join(workflows, f), "utf8").includes("changelog_manager.py")), "changelog_manager.py is still called");
    rmSync(join(target, ".github", "scripts", "issue_helper.py"));
    assert.deepStrictEqual(findMissingScripts(PAYLOAD, target), ["issue_helper.py"]);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("findMissingScripts: imports are followed transitively but uncalled scripts never count", () => {
  const payload = mkdtempSync(join(tmpdir(), "paw-payload-"));
  const target = mkdtempSync(join(tmpdir(), "paw-scripts-"));
  try {
    const sdir = join(payload, "scripts");
    mkdirSync(sdir, { recursive: true });
    writeFileSync(join(sdir, "changelog_manager.py"), "import os\nimport issue_helper\nfrom messages import t\n");
    writeFileSync(join(sdir, "issue_helper.py"), "import unicodedata\n");
    writeFileSync(join(sdir, "messages.py"), "");
    writeFileSync(join(sdir, "version_manager.py"), "from messages import t\n");
    writeFileSync(join(sdir, "truncate_release_notes.py"), "from messages import t\n");
    mkdirSync(join(target, ".github", "workflows"), { recursive: true });
    mkdirSync(join(target, ".github", "scripts"), { recursive: true });
    const wf = (body) => writeFileSync(join(target, ".github", "workflows", "A.yaml"), body);

    wf("run: python3 .github/scripts/changelog_manager.py\n");
    assert.deepStrictEqual(findMissingScripts(payload, target), ["changelog_manager.py", "issue_helper.py", "messages.py"]);

    // A workflow that calls only version_manager.py must not drag in issue_helper.py or truncate_release_notes.py.
    wf("run: python3 .github/scripts/version_manager.py\n");
    assert.deepStrictEqual(findMissingScripts(payload, target), ["version_manager.py", "messages.py"].sort((a, b) => SCRIPT_NAMES.indexOf(a) - SCRIPT_NAMES.indexOf(b)));

    wf("run: echo nothing\n");
    assert.deepStrictEqual(findMissingScripts(payload, target), []);
  } finally { rmSync(payload, { recursive: true, force: true }); rmSync(target, { recursive: true, force: true }); }
});
