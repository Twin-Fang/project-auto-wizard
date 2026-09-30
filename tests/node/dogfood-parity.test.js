// tests/node/dogfood-parity.test.js
// Verify this repo's .github/ copy exactly equals the payload original plus the declared PATCHES.
// Editing only the payload and forgetting to sync the copy (or hand-editing only the copy) fails here.
import { test } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildExpected, findDrift, PATCHES, REPO_BRANCHES, SCRIPTS } from "../../scripts/sync-dogfood.mjs";

// Temp repo with only the directories needed for comparison; simulates drift without touching the real copy.
function withRepoCopy(fn) {
  const dir = mkdtempSync(join(tmpdir(), "paw-dogfood-"));
  try {
    for (const rel of ["payload/workflows/common", "payload/scripts", ".github/workflows", ".github/scripts"]) {
      cpSync(rel, join(dir, rel), { recursive: true });
    }
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("sync-dogfood --check: the current .github/ copy matches payload", () => {
  const r = spawnSync(process.execPath, ["scripts/sync-dogfood.mjs", "--check"], { encoding: "utf8" });
  assert.strictEqual(r.status, 0, `drift found: run npm run sync:dogfood to fix\n${r.stderr}`);
});

test("all common workflows and script copies are in the comparison set", () => {
  const rels = buildExpected().map((e) => e.rel);
  const common = readdirSync(join("payload", "workflows", "common")).filter((f) => f.endsWith(".yaml"));
  assert.ok(common.length >= 6, `too few common workflows: ${common}`);
  for (const f of common) assert.ok(rels.includes(`workflows/${f}`), f);
  // No file in the copy directory may be missing from the comparison (prevents one-sided leftovers)
  for (const f of readdirSync(join(".github", "workflows")).filter((n) => n.startsWith("PROJECT-COMMON-"))) {
    assert.ok(rels.includes(`workflows/${f}`), `common workflow copy not in payload: ${f}`);
  }
  for (const f of readdirSync(join(".github", "scripts")).filter((n) => n.endsWith(".py"))) {
    assert.ok(SCRIPTS.includes(f), `script copy not in comparison set: ${f}`);
  }
});

test("REPO_BRANCHES matches the branch setup in version.yml", () => {
  const yml = readFileSync("version.yml", "utf8");
  assert.match(yml, new RegExp(`^\\s+main: "${REPO_BRANCHES.main}"`, "m"));
  assert.match(yml, new RegExp(`^\\s+develop: "${REPO_BRANCHES.develop}"`, "m"));
});

test("the only intended differences are the ISSUE-HELPER values and the NPM-PUBLISH step in RELEASE-PUBLISH", () => {
  assert.deepStrictEqual(
    [...new Set(PATCHES.map((p) => p.file))].sort(),
    ["workflows/PROJECT-COMMON-ISSUE-HELPER.yaml", "workflows/PROJECT-COMMON-RELEASE-PUBLISH.yaml"],
  );
  for (const p of PATCHES) assert.ok(p.reason, `${p.file}: a reason for the difference is required`);
});

test("even a one-line difference in the copy counts as drift", () => {
  withRepoCopy((dir) => {
    assert.deepStrictEqual(findDrift(dir), []);
    const wf = join(dir, ".github", "workflows", "PROJECT-COMMON-VERSION-CONTROL.yaml");
    writeFileSync(wf, readFileSync(wf, "utf8").replace('branches: ["main"]', 'branches: ["master"]'));
    const script = join(dir, ".github", "scripts", "version_manager.py");
    writeFileSync(script, readFileSync(script, "utf8") + "\n# local edit\n");
    assert.deepStrictEqual(
      findDrift(dir).map((e) => e.rel).sort(),
      ["scripts/version_manager.py", "workflows/PROJECT-COMMON-VERSION-CONTROL.yaml"],
    );
  });
});

test("a missing copy or a payload-only change counts as drift", () => {
  withRepoCopy((dir) => {
    unlinkSync(join(dir, ".github", "workflows", "PROJECT-COMMON-AI-PR-SUMMARY.yaml"));
    const src = join(dir, "payload", "scripts", "issue_helper.py");
    writeFileSync(src, readFileSync(src, "utf8") + "\n# payload change\n");
    assert.deepStrictEqual(
      findDrift(dir).map((e) => e.rel).sort(),
      ["scripts/issue_helper.py", "workflows/PROJECT-COMMON-AI-PR-SUMMARY.yaml"],
    );
  });
});

test("when payload changes and the patch anchor text disappears, it fails instead of passing silently", () => {
  withRepoCopy((dir) => {
    const src = join(dir, "payload", "workflows", "common", "PROJECT-COMMON-ISSUE-HELPER.yaml");
    writeFileSync(src, readFileSync(src, "utf8").replace('ISSUE_HELPER_CREATE_BRANCH: "false"', 'ISSUE_HELPER_CREATE_BRANCH: "no"'));
    assert.throws(() => buildExpected(dir), /패치 기준 문구/);
  });
});

// Guards the regression where running via a symlinked path made argv[1] differ from the real path and skipped main().
test("sync-dogfood --check: running through a symlink path still detects drift and exits 1", (t) => {
  withRepoCopy((dir) => {
    // The script finds the root relative to its own location, so also copy the files needed to run
    for (const rel of ["scripts", "src", "package.json"]) cpSync(rel, join(dir, rel), { recursive: true });
    const wf = join(dir, ".github", "workflows", "PROJECT-COMMON-VERSION-CONTROL.yaml");
    writeFileSync(wf, readFileSync(wf, "utf8") + "\n# local edit\n");

    const link = `${dir}-link`;
    try {
      symlinkSync(dir, link, "dir");
    } catch (e) {
      t.skip(`cannot create symlink: ${e.code}`);
      return;
    }
    try {
      const r = spawnSync(process.execPath, [join(link, "scripts", "sync-dogfood.mjs"), "--check"], { encoding: "utf8" });
      assert.strictEqual(r.status, 1, `check was skipped via the link path\n${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /dogfood 불일치/);
    } finally {
      unlinkSync(link);
    }
  });
});
