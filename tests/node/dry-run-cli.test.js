// tests/node/dry-run-cli.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
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
  writeFileSync(join(target, "package.json"), "{}\n"); // M4: 경로 후보 0개 방지용 루트 마커
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

test("run(): --dry-run with no --mode (interactive) errors instead of running the live wizard", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-cli-"));
  try {
    const originalError = console.error;
    let stderr = "";
    console.error = (msg) => { stderr += msg; };
    let code;
    try {
      code = await run(["--dry-run"], { cwd: target });
    } finally {
      console.error = originalError;
    }
    assert.strictEqual(code, 1);
    assert.ok(stderr.includes("--dry-run"), `expected error to mention --dry-run, got: ${stderr}`);
    assert.ok(!existsSync(join(target, "version.yml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --dry-run without --force bypasses the non-interactive --force gate", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-cli-"));
  writeFileSync(join(target, "package.json"), "{}\n"); // M4: 경로 후보 0개 방지용 루트 마커
  try {
    const code = await run(
      ["--mode", "full", "--type", "node", "--dry-run"],
      { cwd: target, clock: { now: "2026-07-28 00:00:00", today: "2026-07-28" } },
    );
    assert.strictEqual(code, 0);
    assert.ok(!existsSync(join(target, "version.yml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): non-dry-run without --force still requires --force in a non-interactive environment", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-cli-"));
  try {
    const code = await run(["--mode", "full", "--type", "node"], { cwd: target });
    assert.strictEqual(code, 1);
    assert.ok(!existsSync(join(target, "version.yml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});


