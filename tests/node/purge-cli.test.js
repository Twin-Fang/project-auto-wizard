// tests/node/purge-cli.test.js
import { test } from "node:test";
import assert from "node:assert";
import { parseArgs } from "../../src/cli/args.js";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "../../src/index.js";

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

async function installedTarget() {
  const target = mkdtempSync(join(tmpdir(), "paw-purge-cli-"));
  mkdirSync(join(target, ".git"));
  await run(["--mode", "full", "--force", "--type", "node"], {
    cwd: target, clock: { now: "2026-07-28 00:00:00", today: "2026-07-28" },
  });
  return target;
}

const cleanExec = async (cmd, args) => {
  if (args[0] === "status") return { code: 0, stdout: "", stderr: "" };
  return { code: 0, stdout: "", stderr: "" };
};
const dirtyExec = async (cmd, args) => {
  if (args[0] === "status") return { code: 0, stdout: " M some-file.txt\n", stderr: "" };
  return { code: 0, stdout: "", stderr: "" };
};

test("run(): --mode purge outside a git repo is rejected even with --dry-run", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-purge-cli-"));
  try {
    const code = await run(["--mode", "purge", "--dry-run"], { cwd: target });
    assert.strictEqual(code, 1);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --mode purge --dry-run needs no --yes and writes nothing", async () => {
  const target = await installedTarget();
  try {
    const code = await run(["--mode", "purge", "--dry-run"], { cwd: target });
    assert.strictEqual(code, 0);
    assert.ok(existsSync(join(target, "version.yml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --mode purge --dry-run --delete-develop-branch mentions the pending branch deletion", async () => {
  const target = await installedTarget();
  const originalLog = console.log;
  let stdout = "";
  console.log = (msg) => { stdout += msg; };
  try {
    const code = await run(["--mode", "purge", "--dry-run", "--delete-develop-branch"], { cwd: target });
    assert.strictEqual(code, 0);
    assert.ok(stdout.includes("--delete-develop-branch"));
  } finally {
    console.log = originalLog;
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --mode purge without --yes is rejected even with --force", async () => {
  const target = await installedTarget();
  try {
    const code = await run(["--mode", "purge", "--force"], { cwd: target, exec: cleanExec });
    assert.strictEqual(code, 1);
    assert.ok(existsSync(join(target, "version.yml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --mode purge --yes rejects a dirty working tree without --allow-dirty", async () => {
  const target = await installedTarget();
  try {
    const code = await run(["--mode", "purge", "--yes", "--force"], { cwd: target, exec: dirtyExec });
    assert.strictEqual(code, 1);
    assert.ok(existsSync(join(target, "version.yml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --mode purge --yes --allow-dirty --force performs the purge", async () => {
  const target = await installedTarget();
  try {
    const code = await run(["--mode", "purge", "--yes", "--allow-dirty", "--force"], { cwd: target, exec: dirtyExec });
    assert.strictEqual(code, 0);
    assert.ok(!existsSync(join(target, "version.yml")));
    assert.ok(!existsSync(join(target, ".github/scripts/version_manager.py")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --mode purge --yes without --force in a non-TTY environment is rejected", async () => {
  const target = await installedTarget();
  try {
    const code = await run(["--mode", "purge", "--yes"], { cwd: target, exec: cleanExec });
    assert.strictEqual(code, 1);
    assert.ok(existsSync(join(target, "version.yml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --mode purge --yes with TTY and a matching typed repo name performs the purge", async () => {
  const target = await installedTarget();
  const originalIsTTY = process.stdout.isTTY;
  process.stdout.isTTY = true;
  try {
    const repoName = target.split("/").pop();
    const code = await run(["--mode", "purge", "--yes"], {
      cwd: target, exec: cleanExec, promptRepoName: async () => repoName,
    });
    assert.strictEqual(code, 0);
    assert.ok(!existsSync(join(target, "version.yml")));
  } finally {
    process.stdout.isTTY = originalIsTTY;
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --mode purge --yes with TTY and a mismatched typed repo name aborts", async () => {
  const target = await installedTarget();
  const originalIsTTY = process.stdout.isTTY;
  process.stdout.isTTY = true;
  try {
    const code = await run(["--mode", "purge", "--yes"], {
      cwd: target, exec: cleanExec, promptRepoName: async () => "definitely-wrong-name",
    });
    assert.strictEqual(code, 1);
    assert.ok(existsSync(join(target, "version.yml")));
  } finally {
    process.stdout.isTTY = originalIsTTY;
    rmSync(target, { recursive: true, force: true });
  }
});
