// tests/node/safety-net-guard.test.js
// The safety net (PROJECT-VERSION-CONTROL) bumps a patch version only for a direct push to the release branch. Its guard
// step is run here as-is against real git history: a release merge and the first commit of a new repository (a copy made
// with "Use this template", whose push has no "before" and whose commit has no parent) must not be bumped (#429).
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { rmTmp } from "../helpers/tmp.mjs";

const ROOT = join(import.meta.dirname, "..", "..");
const WORKFLOW = readFileSync(join(ROOT, "payload/workflows/common/PROJECT-COMMON-VERSION-CONTROL.yaml"), "utf8").replace(/\r\n/g, "\n");
const ENV = { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1", GIT_CONFIG_NOSYSTEM: "1", PROJECT_AUTO_WIZARD_LANG: "en" };
const ZERO = "0000000000000000000000000000000000000000";

function guardScript(before) {
  const block = WORKFLOW.match(/- name: Release merge \/ mode guard[\s\S]*?(?=\n      - name: )/)?.[0];
  assert.ok(block, "the guard step in VERSION-CONTROL changed; update this test with it");
  return block.split("        run: |\n")[1].split("\n").map((l) => l.replace(/^ {10}/, "")).join("\n")
    .replaceAll("${{ github.event.before }}", before).replaceAll("{{MAIN_BRANCH}}", "main");
}

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "paw-guard-"));
  const git = (...args) => {
    const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...args],
      { cwd: dir, encoding: "utf-8", env: ENV });
    assert.strictEqual(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  git("init", "-q");
  mkdirSync(join(dir, ".github", "scripts"), { recursive: true });
  copyFileSync(join(ROOT, "payload/scripts/messages.py"), join(dir, ".github", "scripts", "messages.py"));
  writeFileSync(join(dir, "version.yml"), 'version: "0.1.0"\n');
  writeFileSync(join(dir, "README.md"), "# app\n");
  git("add", "-A");
  git("commit", "-q", "-m", "Initial commit");
  return { dir, git };
}

function runGuard(dir, before) {
  const out = join(dir, "gh_output");
  writeFileSync(out, "");
  const r = spawnSync("bash", ["-e", "-c", guardScript(before)], {
    cwd: dir, encoding: "utf-8",
    env: { ...ENV, GITHUB_WORKSPACE: dir.replaceAll("\\", "/"), GITHUB_OUTPUT: out.replaceAll("\\", "/") },
  });
  assert.strictEqual(r.status, 0, r.stderr);
  return readFileSync(out, "utf8").match(/^skip=(.*)$/m)[1];
}

const posix = process.platform !== "win32";
const maybe = posix ? test : test.skip;

maybe("first commit of a new repository (template copy): the safety net skips it", () => {
  const { dir } = makeRepo();
  try {
    assert.strictEqual(runGuard(dir, ZERO), "true");
  } finally { rmTmp(dir); }
});

maybe("direct push of a fix to the release branch: the safety net bumps", () => {
  const { dir, git } = makeRepo();
  try {
    const before = git("rev-parse", "HEAD");
    writeFileSync(join(dir, "fix.txt"), "fix\n");
    git("add", "fix.txt");
    git("commit", "-q", "-m", "fix: hotfix on main");
    assert.strictEqual(runGuard(dir, before), "false");
  } finally { rmTmp(dir); }
});

maybe("push that changes version.yml (a release merge): the safety net skips it", () => {
  const { dir, git } = makeRepo();
  try {
    const before = git("rev-parse", "HEAD");
    writeFileSync(join(dir, "version.yml"), 'version: "0.2.0"\n');
    git("commit", "-q", "-am", "chore(version): confirm v0.2.0 and update release docs [skip ci]");
    assert.strictEqual(runGuard(dir, before), "true");
  } finally { rmTmp(dir); }
});
