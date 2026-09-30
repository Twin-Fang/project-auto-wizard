// tests/node/removal-plan.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { planRemoval } from "../../src/core/removal-plan.js";
import { runUninstall } from "../../src/commands/uninstall.js";

function installFixture() {
  const target = mkdtempSync(join(tmpdir(), "paw-removal-plan-"));
  const ctx = createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(),
    now: "2026-07-28 00:00:00", today: "2026-07-28", templateVersion: "0.1.0",
  });
  runFull(ctx, resolvePayloadRoot(), target);
  return target;
}

// Since the baseline 3-way merge, "user-only edits" are kept without asking (localOnly),
// so verifying the conflict-decision (backup/template) path needs a real conflict.
// Skew the baseline rendered hash to make it look like "upstream changed too".
function forceUpstreamChange(target, filename) {
  const bp = join(target, ".github/.wizard/baseline.json");
  const bl = JSON.parse(readFileSync(bp, "utf8"));
  bl.files[filename].rendered = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
  writeFileSync(bp, JSON.stringify(bl, null, 2));
}

test("planRemoval: lists files without deleting anything", () => {
  const target = installFixture();
  try {
    const plan = planRemoval(resolvePayloadRoot(), target);
    assert.ok(plan.workflows.length > 0);
    assert.ok(plan.scripts.includes("version_manager.py"));
    assert.ok(plan.scripts.includes("truncate_release_notes.py"));
    assert.ok(plan.scripts.includes("issue_helper.py"));
    // nothing should have been deleted
    for (const name of plan.workflows) {
      assert.ok(existsSync(join(target, ".github/workflows", name)));
    }
    for (const name of plan.scripts) {
      assert.ok(existsSync(join(target, ".github/scripts", name)));
    }
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planRemoval output matches what uninstall actually removes", () => {
  const target = installFixture();
  try {
    const plan = planRemoval(resolvePayloadRoot(), target);
    const result = runUninstall({}, resolvePayloadRoot(), target,
      { workflows: true, scripts: true, readme: false, gitignore: false, versionYml: false });
    assert.deepStrictEqual(result.workflows, plan.workflows);
    assert.deepStrictEqual(result.scripts, plan.scripts);
    for (const name of plan.workflows) {
      assert.ok(!existsSync(join(target, ".github/workflows", name)));
    }
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planRemoval: recognizes a marker-carrying workflow file even if its name no longer exists in the current payload", () => {
  const target = installFixture();
  try {
    const wfDir = join(target, ".github/workflows");
    const renamedPath = join(wfDir, "PROJECT-COMMON-RENAMED-IN-A-LATER-RELEASE.yaml");
    // Measured: this file name does not exist in the payload (assume it was installed by an older version and later renamed) —
    // it must still be recognized if the marker is present.
    writeFileSync(renamedPath, "# project-auto-wizard:managed-workflow\nname: old-name\n");
    // It was recorded in the baseline at install time and the baseline carries over via merges, so the record remains.
    const bp = join(target, ".github/.wizard/baseline.json");
    const bl = JSON.parse(readFileSync(bp, "utf8"));
    bl.files["PROJECT-COMMON-RENAMED-IN-A-LATER-RELEASE.yaml"] = { installed: null, rendered: "sha256:0" };
    writeFileSync(bp, JSON.stringify(bl, null, 2));

    const plan = planRemoval(resolvePayloadRoot(), target);
    assert.ok(plan.workflows.includes("PROJECT-COMMON-RENAMED-IN-A-LATER-RELEASE.yaml"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planRemoval: a workflow file without the managed marker (user-authored) is never listed for removal", () => {
  const target = installFixture();
  try {
    const wfDir = join(target, ".github/workflows");
    writeFileSync(join(wfDir, "MY-OWN-CUSTOM-WORKFLOW.yaml"), "name: custom\non: push\n");

    const plan = planRemoval(resolvePayloadRoot(), target);
    assert.ok(!plan.workflows.includes("MY-OWN-CUSTOM-WORKFLOW.yaml"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planRemoval: recognizes .bak and .template.yaml variants created by a 'backup' decision", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-removal-plan-"));
  try {
    // Spring CI is used because verifying the .bak/.template.yaml naming rule needs a file with a .yml extension.
    const ctx = createContext({
      mode: "full", force: true, types: ["spring"], version: "1.0.0", versionCode: 1,
      branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
      paths: new Map(),
      now: "2026-07-28 00:00:00", today: "2026-07-28", templateVersion: "0.1.0",
    });
    runFull(ctx, resolvePayloadRoot(), target); // install spring files

    const wfDir = join(target, ".github/workflows");
    const targetFile = join(wfDir, "PROJECT-SPRING-CI.yml");
    writeFileSync(targetFile, readFileSync(targetFile, "utf8") + "\n# edit\n");
    forceUpstreamChange(target, "PROJECT-SPRING-CI.yml");
    runFull(ctx, resolvePayloadRoot(), target, {
      decisions: new Map([["PROJECT-SPRING-CI.yml", "backup"]]),
    });

    const plan = planRemoval(resolvePayloadRoot(), target);
    assert.ok(plan.workflows.includes("PROJECT-SPRING-CI.yml.bak"));
    assert.ok(plan.workflows.includes("PROJECT-SPRING-CI.yml"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planRemoval: a pre-marker install whose filename still matches the current payload is still recognized (no regression for existing installs)", () => {
  const target = installFixture();
  try {
    // Simulate an install from before this change (when there was no marker) — remove the marker on the first line.
    const wfDir = join(target, ".github/workflows");
    const anyFile = readdirSync(wfDir)[0];
    const p = join(wfDir, anyFile);
    const withoutMarker = readFileSync(p, "utf8").replace(/^# project-auto-wizard:managed-workflow\n/, "");
    writeFileSync(p, withoutMarker);

    const plan = planRemoval(resolvePayloadRoot(), target);
    assert.ok(plan.workflows.includes(anyFile), "filename-matching fallback must still recognize marker-less existing installs");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planRemoval: a user file copied from a wizard workflow and merely renamed is not removed even if it has the marker", () => {
  const target = installFixture();
  try {
    const wfDir = join(target, ".github/workflows");
    const src = readFileSync(join(wfDir, "PROJECT-COMMON-VERSION-CONTROL.yaml"), "utf8");
    writeFileSync(join(wfDir, "my-version-control-copy.yaml"), src);

    const plan = planRemoval(resolvePayloadRoot(), target);
    assert.ok(!plan.workflows.includes("my-version-control-copy.yaml"));
    assert.ok(plan.workflows.includes("PROJECT-COMMON-VERSION-CONTROL.yaml"));

    runUninstall({}, resolvePayloadRoot(), target,
      { workflows: true, scripts: true, readme: false, gitignore: false, versionYml: false });
    assert.ok(existsSync(join(wfDir, "my-version-control-copy.yaml")), "the user copy must remain");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planRemoval: an old install without a baseline recognizes only marker files named PROJECT-*", () => {
  const target = installFixture();
  try {
    rmSync(join(target, ".github/.wizard"), { recursive: true, force: true });
    const wfDir = join(target, ".github/workflows");
    const marked = "# project-auto-wizard:managed-workflow\nname: x\n";
    writeFileSync(join(wfDir, "PROJECT-COMMON-OLD-NAME.yaml"), marked);
    writeFileSync(join(wfDir, "my-copy.yaml"), marked);

    const plan = planRemoval(resolvePayloadRoot(), target);
    assert.ok(plan.workflows.includes("PROJECT-COMMON-OLD-NAME.yaml"));
    assert.ok(!plan.workflows.includes("my-copy.yaml"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
