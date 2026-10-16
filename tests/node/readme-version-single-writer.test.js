// tests/node/readme-version-single-writer.test.js
// The README version line has one writer (#423): the release PR's version-confirm commit writes it, and
// README-VERSION-UPDATE on main leaves it alone when it already shows the current version. When the install
// line format differs from the workflow's, main gets a date-only commit that develop lacks, and the first
// release PR conflicts on that line.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmTmp } from "../helpers/tmp.mjs";
import { addVersionSectionToReadme } from "../../src/core/copy/readme.js";

const WORKFLOW = join("payload", "workflows", "common", "PROJECT-COMMON-README-VERSION-UPDATE.yaml");

// Pull the marked block out of the workflow so the real shell code is what runs here
function extractAlreadyCurrentCheck() {
  const text = readFileSync(WORKFLOW, "utf8");
  const a = text.indexOf("# >>> readme-already-current");
  const b = text.indexOf("# <<< readme-already-current");
  assert.ok(a > 0 && b > a, "readme-already-current markers are missing");
  return text.slice(a, b).split("\n").map((l) => l.replace(/^ {0,14}/, "")).join("\n");
}

// "skipped" when the block exits the step early, "continue" when the rewrite would go on
function runCheck(versionLine, latestVersion) {
  const script = `m() { echo "$1"; }\n${extractAlreadyCurrentCheck()}\necho CONTINUE\n`;
  const r = spawnSync("bash", ["-c", script], {
    encoding: "utf-8",
    env: { ...process.env, VERSION_LINE: versionLine, LATEST_VERSION: latestVersion },
  });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout.includes("CONTINUE") ? "continue" : "skipped";
}

test("README-VERSION-UPDATE skips a line that already shows the current version, whatever its date", () => {
  assert.strictEqual(runCheck("## Latest Version : v0.0.1", "0.0.1"), "skipped");
  assert.strictEqual(runCheck("## Latest Version : v0.0.1 (2026-10-15)", "0.0.1"), "skipped");
  assert.strictEqual(runCheck("## 최신 버전 : v1.2.3 (2026-01-02)", "1.2.3"), "skipped");
  assert.strictEqual(runCheck("## Version : 1.2.3", "1.2.3"), "skipped");
});

test("README-VERSION-UPDATE goes on rewriting when the version differs", () => {
  assert.strictEqual(runCheck("## Latest Version : v0.0.1 (2026-10-15)", "0.1.0"), "continue");
  // A version that only shares a prefix (1.0.1 <-> 1.0.10) is a different version
  assert.strictEqual(runCheck("## Latest Version : v1.0.10", "1.0.1"), "continue");
  assert.strictEqual(runCheck("## Latest Version : v1.0.1", "1.0.10"), "continue");
  // The dots in the version must not match any character
  assert.strictEqual(runCheck("## Latest Version : v1x0x1", "1.0.1"), "continue");
});

test("install writes the new version line in the workflow's format, with the install date", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-readme-date-"));
  try {
    writeFileSync(join(dir, "README.md"), "# my-app\n");
    const status = addVersionSectionToReadme("0.0.1", dir, "en", new Date(2026, 9, 16, 8, 0, 0));
    assert.strictEqual(status, "added");
    const text = readFileSync(join(dir, "README.md"), "utf8");
    assert.match(text, /<!-- AUTO-VERSION-SECTION: DO NOT EDIT MANUALLY -->\n## Latest Version : v0\.0\.1 \(2026-10-16\)\n/);
  } finally {
    rmTmp(dir);
  }
});

test("main push right after install and the first version confirm do not conflict on the README line (#423)", () => {
  const root = mkdtempSync(join(tmpdir(), "paw-423-"));
  const sh = (cwd, cmd) => spawnSync("bash", ["-c", cmd], { cwd, encoding: "utf-8" });
  const git = (cwd, args) => {
    const r = sh(cwd, `git ${args}`);
    assert.strictEqual(r.status, 0, `git ${args}: ${r.stderr}`);
    return r.stdout.trim();
  };
  try {
    // Installed state committed on main, then develop branches off it
    git(root, "init -q -b main repo");
    const repo = join(root, "repo");
    git(repo, "config user.email t@example.com");
    git(repo, "config user.name t");
    writeFileSync(join(repo, "README.md"), "# my-app\n");
    addVersionSectionToReadme("0.0.1", repo, "en");
    writeFileSync(join(repo, "version.yml"), 'version: "0.0.1"\nproject_types: ["basic"]\n');
    mkdirSync(join(repo, ".github", "scripts"), { recursive: true });
    for (const f of ["version_manager.py", "messages.py"]) copyFileSync(join("payload", "scripts", f), join(repo, ".github", "scripts", f));
    git(repo, "add -A");
    git(repo, 'commit -q -m "chore: install"');
    git(repo, "branch develop");

    // main: README-VERSION-UPDATE on the install push leaves the line alone
    const versionLine = readFileSync(join(repo, "README.md"), "utf8").split("\n").find((l) => l.startsWith("## Latest Version"));
    assert.strictEqual(runCheck(versionLine, "0.0.1"), "skipped");

    // develop: the release PR's version confirm rewrites the line (date kept)
    git(repo, "checkout -q develop");
    const set = sh(repo, "python3 .github/scripts/version_manager.py set 0.1.0");
    assert.strictEqual(set.status, 0, set.stderr);
    assert.match(readFileSync(join(repo, "README.md"), "utf8"), /## Latest Version : v0\.1\.0 \(\d{4}-\d{2}-\d{2}\)\n/);
    git(repo, 'commit -q -am "chore(version): confirm v0.1.0 [skip ci]"');

    // develop -> main merges cleanly
    const merge = sh(repo, "git merge-tree --write-tree main develop");
    assert.strictEqual(merge.status, 0, merge.stdout);
  } finally {
    rmTmp(root);
  }
});
