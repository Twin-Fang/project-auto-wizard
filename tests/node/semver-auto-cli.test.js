// tests/node/semver-auto-cli.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
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
  writeFileSync(join(target, "package.json"), "{}\n"); // root marker to avoid 0 path candidates
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
  writeFileSync(join(target, "package.json"), "{}\n"); // root marker to avoid 0 path candidates
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

test("run(): re-installing over a version.yml predating semver_auto (no key) safely defaults to false, not true", async () => {
  // Re-integrating an existing install (a version.yml created before the semver_auto feature) via the CLI
  // must safely fall back to false so that one ambiguous commit does not silently promote major
  // (only a completely fresh install gets true — contrast with "omitted flag defaults to semver_auto: true" below).
  const target = mkdtempSync(join(tmpdir(), "paw-semver-cli-"));
  writeFileSync(join(target, "package.json"), "{}\n"); // root marker to avoid 0 path candidates
  try {
    await run(
      ["--mode", "full", "--force", "--type", "node"],
      { cwd: target, clock: { now: "2026-07-28 00:00:00", today: "2026-07-28" } },
    );
    const vyPath = join(target, "version.yml");
    const stripped = readFileSync(vyPath, "utf8")
      .split("\n")
      .filter((l) => !/^\s+semver_auto:/.test(l))
      .join("\n");
    writeFileSync(vyPath, stripped);
    assert.strictEqual(parseTemplateOptions(stripped).semverAuto, null, "fixture setup: key must be absent");

    // Rerun — neither --semver-auto nor --no-semver-auto is given (the user has not explicitly
    // opted in). Since an existing install is present, it must fall back to false.
    const code = await run(
      ["--mode", "full", "--force", "--type", "node"],
      { cwd: target, clock: { now: "2026-07-28 00:00:00", today: "2026-07-28" } },
    );
    assert.strictEqual(code, 0);
    const optsAfter = parseTemplateOptions(readFileSync(vyPath, "utf8"));
    assert.strictEqual(optsAfter.semverAuto, false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
