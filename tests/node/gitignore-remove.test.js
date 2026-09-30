// tests/node/gitignore-remove.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureGitignore, hasAutoAddedEntries, removeAutoAddedEntriesFromGitignore } from "../../src/core/copy/gitignore.js";

test("hasAutoAddedEntries: false before ensureGitignore, true after (fresh file case)", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-gitignore-remove-"));
  try {
    assert.strictEqual(hasAutoAddedEntries(target), false);
    ensureGitignore(target);
    assert.strictEqual(hasAutoAddedEntries(target), true);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeAutoAddedEntriesFromGitignore: fresh-file case deletes the whole file", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-gitignore-remove-"));
  try {
    ensureGitignore(target); // there was no .gitignore, so the wizard creates it whole
    assert.ok(existsSync(join(target, ".gitignore")));
    const status = removeAutoAddedEntriesFromGitignore(target);
    assert.strictEqual(status, "file-deleted");
    assert.ok(!existsSync(join(target, ".gitignore")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeAutoAddedEntriesFromGitignore: existing-file case removes only the banner block", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-gitignore-remove-"));
  try {
    const original = "node_modules/\ndist/\n";
    writeFileSync(join(target, ".gitignore"), original);
    ensureGitignore(target); // only the banner block is appended to the existing file
    const appended = readFileSync(join(target, ".gitignore"), "utf8");
    assert.notStrictEqual(appended, original);
    assert.ok(appended.includes("project-auto-wizard: Auto-added entries"));

    const status = removeAutoAddedEntriesFromGitignore(target);
    assert.strictEqual(status, "removed");
    const after = readFileSync(join(target, ".gitignore"), "utf8");
    assert.ok(after.startsWith(original));
    assert.ok(!after.includes("project-auto-wizard: Auto-added entries"));
    assert.ok(!after.includes("*.bak"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeAutoAddedEntriesFromGitignore: no .gitignore -> skip-no-gitignore, no-op", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-gitignore-remove-"));
  try {
    assert.strictEqual(removeAutoAddedEntriesFromGitignore(target), "skip-no-gitignore");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeAutoAddedEntriesFromGitignore: .gitignore exists but no banner -> skip-not-found, untouched", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-gitignore-remove-"));
  try {
    writeFileSync(join(target, ".gitignore"), "node_modules/\n");
    const status = removeAutoAddedEntriesFromGitignore(target);
    assert.strictEqual(status, "skip-not-found");
    assert.strictEqual(readFileSync(join(target, ".gitignore"), "utf8"), "node_modules/\n");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeAutoAddedEntriesFromGitignore: preserves entries the user appended after the auto-added block", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-gitignore-remove-"));
  try {
    const original = "node_modules/\ndist/\n";
    writeFileSync(join(target, ".gitignore"), original);
    ensureGitignore(target);
    const installed = readFileSync(join(target, ".gitignore"), "utf8");
    // Assume the user appended their own entries at the end after install — uninstall must not delete them.
    const userAddition = ".env\nsecrets/\n";
    writeFileSync(join(target, ".gitignore"), installed + userAddition);

    const status = removeAutoAddedEntriesFromGitignore(target);
    assert.strictEqual(status, "removed");
    assert.strictEqual(readFileSync(join(target, ".gitignore"), "utf8"), original + userAddition);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeAutoAddedEntriesFromGitignore: fresh-file case with content appended later strips only the wizard-written prefix", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-gitignore-remove-"));
  try {
    ensureGitignore(target); // there was no .gitignore, so the wizard creates it whole
    const fresh = readFileSync(join(target, ".gitignore"), "utf8");
    const userAddition = "dist/\n";
    writeFileSync(join(target, ".gitignore"), fresh + userAddition);

    const status = removeAutoAddedEntriesFromGitignore(target);
    assert.strictEqual(status, "removed");
    assert.strictEqual(readFileSync(join(target, ".gitignore"), "utf8"), userAddition);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeAutoAddedEntriesFromGitignore: a user line inserted between the two required entries is preserved, both entries removed", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-gitignore-remove-"));
  try {
    const original = "node_modules/\ndist/\n";
    writeFileSync(join(target, ".gitignore"), original);
    ensureGitignore(target);
    const installed = readFileSync(join(target, ".gitignore"), "utf8");
    const withInsertedLine = installed.replace("*.bak\n*.template.yaml\n", "*.bak\nmy-own-entry/\n*.template.yaml\n");
    writeFileSync(join(target, ".gitignore"), withInsertedLine);

    const status = removeAutoAddedEntriesFromGitignore(target);
    assert.strictEqual(status, "removed");
    const after = readFileSync(join(target, ".gitignore"), "utf8");
    assert.ok(after.startsWith(original));
    assert.ok(!after.includes("*.bak"));
    assert.ok(!after.includes("*.template.yaml"));
    assert.ok(!after.includes("project-auto-wizard"));
    assert.strictEqual(after, original + "my-own-entry/\n");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeAutoAddedEntriesFromGitignore: legacy banner without an end marker falls back to consecutive-match removal (documented limitation)", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-gitignore-remove-"));
  try {
    const original = "node_modules/\ndist/\n";
    const legacyBanner =
      "\n" +
      "# ====================================================================\n" +
      "# project-auto-wizard: Auto-added entries\n" +
      "# ====================================================================\n" +
      "*.bak\n" +
      "my-own-entry/\n" +
      "*.template.yaml\n"; // no end marker — reproduces the form installed by versions before this fix
    writeFileSync(join(target, ".gitignore"), original + legacyBanner);

    const status = removeAutoAddedEntriesFromGitignore(target);
    assert.strictEqual(status, "removed");
    const after = readFileSync(join(target, ".gitignore"), "utf8");
    // Documented limitation: the consecutive match breaks at my-own-entry/, so *.template.yaml is not removed.
    assert.ok(after.includes("*.template.yaml"), "legacy fallback stops at the first mismatch (documented limitation)");
    assert.ok(!after.includes("*.bak"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
