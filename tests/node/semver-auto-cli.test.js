// tests/node/semver-auto-cli.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "../../src/cli/args.js";
import { run } from "../../src/index.js";
import { parseTemplateOptions } from "../../src/core/version-yml.js";

test("parseArgs: --semver-auto sets includeSemverAuto=true", () => {
  const opts = parseArgs(["--mode", "full", "--force", "--type", "node", "--semver-auto"]);
  assert.strictEqual(opts.includeSemverAuto, true);
});

test("parseArgs: --no-semver-auto sets includeSemverAuto=false", () => {
  const opts = parseArgs(["--mode", "full", "--force", "--type", "node", "--no-semver-auto"]);
  assert.strictEqual(opts.includeSemverAuto, false);
});

test("parseArgs: omitted defaults to null (resolved to true downstream)", () => {
  const opts = parseArgs(["--mode", "full", "--force", "--type", "node"]);
  assert.strictEqual(opts.includeSemverAuto, null);
});

test("run(): --no-semver-auto propagates to installed version.yml", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-semver-cli-"));
  try {
    await run(
      ["--mode", "full", "--force", "--type", "node", "--no-semver-auto"],
      { cwd: target, clock: { now: "2026-07-28 00:00:00", today: "2026-07-28" } },
    );
    const opts = parseTemplateOptions(readFileSync(join(target, "version.yml"), "utf8"));
    assert.strictEqual(opts.semverAuto, false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): omitted flag defaults to semver_auto: true", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-semver-cli-"));
  try {
    await run(
      ["--mode", "full", "--force", "--type", "node"],
      { cwd: target, clock: { now: "2026-07-28 00:00:00", today: "2026-07-28" } },
    );
    const opts = parseTemplateOptions(readFileSync(join(target, "version.yml"), "utf8"));
    assert.strictEqual(opts.semverAuto, true);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
