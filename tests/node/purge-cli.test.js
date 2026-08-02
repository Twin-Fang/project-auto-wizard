// tests/node/purge-cli.test.js
import { test } from "node:test";
import assert from "node:assert";
import { parseArgs } from "../../src/cli/args.js";

test("parseArgs: --mode purge with --yes sets yes=true", () => {
  const opts = parseArgs(["--mode", "purge", "--yes"]);
  assert.strictEqual(opts.mode, "purge");
  assert.strictEqual(opts.yes, true);
});

test("parseArgs: purge flags default to false", () => {
  const opts = parseArgs(["--mode", "purge"]);
  assert.strictEqual(opts.yes, false);
  assert.strictEqual(opts.allowDirty, false);
  assert.strictEqual(opts.deleteDevelopBranch, false);
  assert.strictEqual(opts.keepVersionYml, false);
  assert.strictEqual(opts.keepReadme, false);
  assert.strictEqual(opts.keepChangelog, false);
  assert.strictEqual(opts.keepWorkflows, false);
  assert.strictEqual(opts.keepScripts, false);
  assert.strictEqual(opts.keepCoderabbit, false);
});

test("parseArgs: all purge-only flags parse", () => {
  const opts = parseArgs([
    "--mode", "purge", "--yes", "--allow-dirty", "--delete-develop-branch",
    "--keep-version-yml", "--keep-readme", "--keep-changelog",
    "--keep-workflows", "--keep-scripts", "--keep-coderabbit",
  ]);
  assert.strictEqual(opts.allowDirty, true);
  assert.strictEqual(opts.deleteDevelopBranch, true);
  assert.strictEqual(opts.keepVersionYml, true);
  assert.strictEqual(opts.keepReadme, true);
  assert.strictEqual(opts.keepChangelog, true);
  assert.strictEqual(opts.keepWorkflows, true);
  assert.strictEqual(opts.keepScripts, true);
  assert.strictEqual(opts.keepCoderabbit, true);
});
