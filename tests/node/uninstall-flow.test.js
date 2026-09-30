// tests/node/uninstall-flow.test.js
import "../setup-lang.mjs"; // these tests assert the ko output
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { runUninstallFlow } from "../../src/commands/uninstall.js";
import { CANCEL } from "../../src/ui/prompts.js";
import { rmTmp } from "../helpers/tmp.mjs";

function installFixture() {
  const target = mkdtempSync(join(tmpdir(), "paw-uninstall-flow-"));
  writeFileSync(join(target, "README.md"), "# Test Project\n");
  const ctx = createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(),
    now: "2026-08-01 00:00:00", today: "2026-08-01", templateVersion: "0.1.0",
  });
  runFull(ctx, resolvePayloadRoot(), target);
  return target;
}

function stubIo({ multiselectReturn, confirmReturn }) {
  const notes = [];
  const cancels = [];
  return {
    io: {
      engineIo: { multiselect: async () => multiselectReturn },
      askYesNo: async () => confirmReturn,
      note: (text, title) => notes.push({ text, title }),
      cancelMessage: (text) => cancels.push(text),
    },
    notes, cancels,
  };
}

function stubIoWithCapture({ multiselectReturn, confirmReturn }) {
  const notes = [];
  const cancels = [];
  const multiselectCalls = [];
  return {
    io: {
      engineIo: {
        multiselect: async (args) => {
          multiselectCalls.push(args);
          return multiselectReturn;
        }
      },
      askYesNo: async () => confirmReturn,
      note: (text, title) => notes.push({ text, title }),
      cancelMessage: (text) => cancels.push(text),
    },
    notes, cancels, multiselectCalls,
  };
}

test("runUninstallFlow: no items available -> notes and returns null without prompting for a choice", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-uninstall-flow-empty-"));
  try {
    const { io, notes } = stubIo({ multiselectReturn: [], confirmReturn: true });
    const result = await runUninstallFlow(resolvePayloadRoot(), target, io);
    assert.strictEqual(result, null);
    assert.ok(notes.some((n) => n.text.includes("제거할 항목이 없습니다")));
  } finally {
    rmTmp(target);
  }
});

test("runUninstallFlow: checklist cancelled (ESC) -> nothing removed", async () => {
  const target = installFixture();
  try {
    const { io, cancels } = stubIo({ multiselectReturn: CANCEL, confirmReturn: true });
    const result = await runUninstallFlow(resolvePayloadRoot(), target, io);
    assert.strictEqual(result, null);
    assert.strictEqual(cancels.length, 1);
    assert.ok(existsSync(join(target, "version.yml")));
  } finally {
    rmTmp(target);
  }
});

test("runUninstallFlow: checklist confirmed but final confirm is 'no' -> nothing removed", async () => {
  const target = installFixture();
  try {
    const { io } = stubIo({ multiselectReturn: ["workflows", "scripts"], confirmReturn: false });
    const result = await runUninstallFlow(resolvePayloadRoot(), target, io);
    assert.strictEqual(result, null);
    assert.ok(existsSync(join(target, ".github/scripts/version_manager.py")));
  } finally {
    rmTmp(target);
  }
});

test("runUninstallFlow: selecting only readme removes just the version section", async () => {
  const target = installFixture();
  try {
    const { io } = stubIo({ multiselectReturn: ["readme"], confirmReturn: true });
    const result = await runUninstallFlow(resolvePayloadRoot(), target, io);
    assert.strictEqual(result.readme, true);
    assert.ok(existsSync(join(target, ".github/scripts/version_manager.py"))); // unselected item is kept
    assert.ok(!readFileSync(join(target, "README.md"), "utf8").includes("AUTO-VERSION-SECTION"));
  } finally {
    rmTmp(target);
  }
});

test("runUninstallFlow: multiselect returns empty array (user deselects all) -> nothing removed", async () => {
  const target = installFixture();
  try {
    const { io, cancels } = stubIo({ multiselectReturn: [], confirmReturn: true });
    const result = await runUninstallFlow(resolvePayloadRoot(), target, io);
    assert.strictEqual(result, null);
    assert.strictEqual(cancels.length, 1);
    assert.ok(existsSync(join(target, ".github/scripts/version_manager.py")));
  } finally {
    rmTmp(target);
  }
});

test("runUninstallFlow: default checked items are exactly SAFE_ITEMS", async () => {
  const target = installFixture();
  try {
    const { io, multiselectCalls } = stubIoWithCapture({ multiselectReturn: ["workflows"], confirmReturn: true });
    const result = await runUninstallFlow(resolvePayloadRoot(), target, io);

    // verify the multi-select call
    assert.strictEqual(multiselectCalls.length, 1);
    const call = multiselectCalls[0];

    // initialValues must contain exactly SAFE_ITEMS (order matters)
    assert.deepStrictEqual(call.initialValues, ["workflows", "scripts"]);

    // check that only the selected items were removed
    assert.strictEqual(result.workflows.length > 0, true);
    assert.ok(existsSync(join(target, ".github/scripts/version_manager.py"))); // scripts not selected
  } finally {
    rmTmp(target);
  }
});

test("runUninstallFlow: --purge-* flags are reflected in the checklist's initial selection", async () => {
  const target = installFixture();
  try {
    const { io, multiselectCalls } = stubIoWithCapture({ multiselectReturn: CANCEL, confirmReturn: false });
    await runUninstallFlow(resolvePayloadRoot(), target, io, { readme: true, gitignore: false, versionYml: true });
    const init = multiselectCalls[0].initialValues;
    assert.ok(init.includes("workflows") && init.includes("scripts"));
    assert.ok(init.includes("readme"), "--purge-readme must be initially selected");
    assert.ok(init.includes("versionYml"), "--purge-version must be initially selected");
  } finally {
    rmTmp(target);
  }
});

test("runUninstallFlow: without flags only the safe items are initially selected", async () => {
  const target = installFixture();
  try {
    const { io, multiselectCalls } = stubIoWithCapture({ multiselectReturn: CANCEL, confirmReturn: false });
    await runUninstallFlow(resolvePayloadRoot(), target, io);
    assert.deepStrictEqual(multiselectCalls[0].initialValues.sort(), ["scripts", "workflows"]);
  } finally {
    rmTmp(target);
  }
});
