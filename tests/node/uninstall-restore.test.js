// tests/node/uninstall-restore.test.js
// After a full removal the filesystem must equal its pre-install state — no trailing newline differences or leftover empty folders.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, existsSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { runUninstall } from "../../src/commands/uninstall.js";
import { executePurge } from "../../src/commands/purge.js";
import { ensureGitignore, removeAutoAddedEntriesFromGitignore } from "../../src/core/copy/gitignore.js";

const PAYLOAD = resolvePayloadRoot();
const ALL = { workflows: true, scripts: true, readme: true, gitignore: true, versionYml: true };

function install(prepare = () => {}) {
  const target = mkdtempSync(join(tmpdir(), "paw-uninstall-restore-"));
  prepare(target);
  runFull(createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(),
    now: "2026-09-01 00:00:00", today: "2026-09-01", templateVersion: "0.1.0",
  }), PAYLOAD, target);
  return target;
}

test("gitignore: a file without a trailing newline returns byte-for-byte after add and remove", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-gi-noeol-"));
  try {
    writeFileSync(join(target, ".gitignore"), "build/");
    ensureGitignore(target);
    const added = readFileSync(join(target, ".gitignore"), "utf8");
    assert.match(added, /^build\/\n# =+\n# project-auto-wizard: Auto-added entries/);
    assert.strictEqual(removeAutoAddedEntriesFromGitignore(target), "removed");
    assert.strictEqual(readFileSync(join(target, ".gitignore"), "utf8"), "build/");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("gitignore: a file with a trailing newline also returns byte-for-byte", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-gi-eol-"));
  try {
    writeFileSync(join(target, ".gitignore"), "build/\n");
    ensureGitignore(target);
    removeAutoAddedEntriesFromGitignore(target);
    assert.strictEqual(readFileSync(join(target, ".gitignore"), "utf8"), "build/\n");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("uninstall: removes the wizard-created .github folder when it becomes empty", () => {
  const target = install();
  try {
    runUninstall({}, PAYLOAD, target, ALL);
    assert.ok(!existsSync(join(target, ".github/workflows")));
    assert.ok(!existsSync(join(target, ".github/scripts")));
    assert.ok(!existsSync(join(target, ".github")));
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("uninstall: keeps a .github folder that still has user files", () => {
  const target = install((t) => {
    mkdirSync(join(t, ".github/workflows"), { recursive: true });
    writeFileSync(join(t, ".github/workflows/my-ci.yaml"), "name: my-ci\n");
    writeFileSync(join(t, ".github/CODEOWNERS"), "* @my-team\n");
  });
  try {
    runUninstall({}, PAYLOAD, target, ALL);
    assert.ok(existsSync(join(target, ".github/workflows/my-ci.yaml")));
    assert.ok(existsSync(join(target, ".github/CODEOWNERS")));
    assert.ok(!existsSync(join(target, ".github/scripts")), "a scripts folder that became empty is cleaned up");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("purge: cleans up a .github folder that became empty", () => {
  const target = install();
  try {
    executePurge(PAYLOAD, target);
    assert.ok(!existsSync(join(target, ".github")));
  } finally { rmSync(target, { recursive: true, force: true }); }
});
