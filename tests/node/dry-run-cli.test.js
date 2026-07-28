// tests/node/dry-run-cli.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "../../src/cli/args.js";
import { run } from "../../src/index.js";

test("parseArgs: --dry-run sets dryRun=true", () => {
  const opts = parseArgs(["--mode", "full", "--force", "--type", "node", "--dry-run"]);
  assert.strictEqual(opts.dryRun, true);
});

test("parseArgs: omitting --dry-run defaults to false", () => {
  const opts = parseArgs(["--mode", "full", "--force", "--type", "node"]);
  assert.strictEqual(opts.dryRun, false);
});

test("run(): --dry-run --mode full writes nothing to an empty target", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-cli-"));
  try {
    const code = await run(
      ["--mode", "full", "--force", "--type", "node", "--dry-run"],
      { cwd: target, clock: { now: "2026-07-28 00:00:00", today: "2026-07-28" } },
    );
    assert.strictEqual(code, 0);
    assert.ok(!existsSync(join(target, "version.yml")));
    assert.ok(!existsSync(join(target, ".github")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --dry-run --mode revert on an installed repo removes nothing", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-cli-"));
  try {
    await run(["--mode", "full", "--force", "--type", "node"], {
      cwd: target, clock: { now: "2026-07-28 00:00:00", today: "2026-07-28" },
    });
    const code = await run(["--mode", "revert", "--force", "--dry-run"], { cwd: target });
    assert.strictEqual(code, 0);
    assert.ok(existsSync(join(target, "version.yml")));
    assert.ok(existsSync(join(target, ".github/scripts/version_manager.py")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
