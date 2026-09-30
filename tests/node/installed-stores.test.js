// tests/node/installed-stores.test.js
// An existing install without a stored flutter_store infers platforms from the installed store workflows.
// (Prevents a working store workflow from being cleaned up because it is mistaken for a deselection.)
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inferInstalledStores } from "../../src/core/installed-stores.js";

function workflowsDirWith(files) {
  const root = mkdtempSync(join(tmpdir(), "paw-installed-stores-"));
  const dir = join(root, ".github", "workflows");
  mkdirSync(dir, { recursive: true });
  for (const f of files) writeFileSync(join(dir, f), "");
  return { root, dir };
}

test("inferInstalledStores: infers installed platforms from store workflow file names", () => {
  const { root, dir } = workflowsDirWith(["PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml"]);
  try {
    assert.deepStrictEqual(inferInstalledStores(dir), ["ios"]);
    writeFileSync(join(dir, "PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml"), "");
    assert.deepStrictEqual(inferInstalledStores(dir), ["android", "ios"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("inferInstalledStores: empty array when only non-store Flutter workflows exist", () => {
  const { root, dir } = workflowsDirWith([
    "PROJECT-FLUTTER-CI.yaml", "PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml", "PROJECT-COMMON-VERSION-CONTROL.yaml",
  ]);
  try {
    assert.deepStrictEqual(inferInstalledStores(dir), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("inferInstalledStores: empty array when the workflows folder is missing", () => {
  const root = mkdtempSync(join(tmpdir(), "paw-installed-stores-empty-"));
  try {
    assert.deepStrictEqual(inferInstalledStores(join(root, ".github", "workflows")), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
