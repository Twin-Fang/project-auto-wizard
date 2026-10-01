import { test } from "node:test";
import assert from "node:assert";
import { parseArgs, CliError } from "../../src/cli/args.js";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "../../src/index.js";
import { rmTmp } from "../helpers/tmp.mjs";

test("parseArgs: an unknown --mode value throws CliError", () => {
  assert.throws(() => parseArgs(["--mode", "ful"]), CliError);
});

test("parseArgs: --mode with no value (parsed as an empty string) throws CliError", () => {
  assert.throws(() => parseArgs(["--mode"]), CliError);
});

test("parseArgs: all valid modes pass (including purge)", () => {
  const modes = ["interactive", "full", "uninstall", "status", "doctor", "purge"];
  for (const m of modes) {
    const opts = parseArgs(["--mode", m]);
    assert.strictEqual(opts.mode, m);
  }
});

test("parseArgs: the default interactive passes when --mode is not given", () => {
  const opts = parseArgs([]);
  assert.strictEqual(opts.mode, "interactive");
});

test("parseArgs: the error message does not expose the hidden mode (purge)", () => {
  try {
    parseArgs(["--mode", "ful"]);
    assert.fail("CliError must be thrown");
  } catch (e) {
    assert.ok(!e.message.includes("purge"), "purge is a hidden mode, so it must not appear in the error message");
  }
});

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function repoWithOriginRemote() {
  const bare = mkdtempSync(join(tmpdir(), "paw-bare-"));
  git(bare, ["init", "--bare", "-q"]);

  const target = mkdtempSync(join(tmpdir(), "paw-target-"));
  git(target, ["init", "-q", "-b", "main"]);
  git(target, ["config", "user.email", "test@example.com"]);
  git(target, ["config", "user.name", "Test"]);
  writeFileSync(join(target, "README.md"), "# test\n");
  git(target, ["add", "."]);
  git(target, ["commit", "-q", "-m", "init"]);
  git(target, ["remote", "add", "origin", bare]);
  git(target, ["push", "-q", "-u", "origin", "main"]);

  return { bare, target };
}

test("run(): an invalid --mode value exits 1 and does not create/push a remote develop branch", async () => {
  const { bare, target } = repoWithOriginRemote();
  try {
    const code = await run(["--mode", "ful", "--force", "--type", "node"], { cwd: target });
    assert.strictEqual(code, 1);
    assert.ok(!git(bare, ["branch"]).includes("develop"), "a develop branch must not appear on the remote (bare repo)");
    assert.ok(!git(target, ["branch"]).includes("develop"), "a develop branch must not appear locally either");
  } finally {
    rmTmp(bare);
    rmTmp(target);
  }
});

// Removed modes must not pass silently.
test("parseArgs: removed modes (version/workflows/revert) are rejected with CliError", () => {
  for (const m of ["version", "workflows", "revert"]) {
    assert.throws(() => parseArgs(["--mode", m]), CliError, `'${m}' mode still passes`);
  }
});
