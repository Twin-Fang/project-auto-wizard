// tests/node/release-automerge-workflow.test.js
// PROJECT-COMMON-AUTO-CHANGELOG-CONTROL honours version.yml release_automerge: false by skipping the automerge step and the
// wait-for-merge job, renaming the PR so a human merge (merge commit / squash) still passes the RELEASE-PUBLISH gate,
// and leaving exactly one guidance comment. The default (key missing) must stay ON.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WF = readFileSync(join(ROOT, "payload/workflows/common/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml"), "utf8");
const MESSAGES = readFileSync(join(ROOT, "payload/scripts/messages.py"), "utf8");

// The workflow reads the option through version_manager.py; the step must pass the same default the registry declares (true).
// The full case table (quotes, case, comments, invalid values) runs in option-value-parity.test.js.
test("the release_automerge reader step uses the shared reader with default true", () => {
  assert.match(WF, /version_manager\.py" option release_automerge --default true \|\| echo "true"/);
});

function readerOutput(versionYml) {
  const dir = mkdtempSync(join(tmpdir(), "paw-reader-"));
  try {
    writeFileSync(join(dir, "version.yml"), versionYml);
    const r = spawnSync("python3", [join(ROOT, "payload/scripts/version_manager.py"), "option", "release_automerge", "--default", "true"], {
      cwd: dir, encoding: "utf8", env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
    });
    assert.strictEqual(r.status, 0, r.stderr);
    return r.stdout.trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const yml = (body) => `metadata:\n  template:\n    version: "1"\n    options:\n${body}`;

test("reader: a missing key means true; explicit false/true are honoured", () => {
  assert.strictEqual(readerOutput(yml("      semver_auto: true\n")), "true");
  assert.strictEqual(readerOutput(yml("      release_automerge: false\n")), "false");
  assert.strictEqual(readerOutput(yml("      release_automerge: true\n")), "true");
  assert.strictEqual(readerOutput(yml("      release_automerge: \"false\"\n")), "false");
});

test("reader: an unrelated release_automerge key outside metadata.template.options is ignored", () => {
  assert.strictEqual(readerOutput(`release_automerge: false\n${yml("      semver_auto: true\n")}`), "true");
});

test("reader: a commented-out or prefixed key is not read as release_automerge", () => {
  assert.strictEqual(readerOutput(yml("      # release_automerge: false\n      semver_auto: true\n")), "true");
  assert.strictEqual(readerOutput(yml("      pre_release_automerge: false\n")), "true");
  assert.strictEqual(readerOutput(yml("      semver_auto: true\n      release_automerge: false\n")), "false");
});

test("Enable automerge only runs when the option is not false", () => {
  assert.match(WF, /- name: Enable automerge\n\s+if: steps\.automerge_option\.outputs\.release_automerge != 'false'/);
});

test("the job exposes the option and the wait job is skipped when it is false", () => {
  assert.match(WF, /changelog-and-merge:[\s\S]*?outputs:\s*\n(?:\s+#[^\n]*\n)*\s+automerge: \$\{\{ steps\.automerge_option\.outputs\.release_automerge \}\}/);
  assert.match(WF, /wait-for-merge-and-trigger-release:[\s\S]*?if: needs\.changelog-and-merge\.outputs\.automerge != 'false'/);
});

test("manual-merge step: renames the PR with the release-confirm subject, warns instead of failing, dedups the comment", () => {
  const step = WF.match(/- name: Prepare manual release merge[\s\S]*?(?=\n      - name: )/);
  assert.ok(step, "the manual-merge step must exist");
  const body = step[0];
  assert.match(body, /if: steps\.automerge_option\.outputs\.release_automerge == 'false'/);
  assert.match(body, /SUBJECT="chore\(release\): v\$\{VERSION\} \(PR #\$\{PR_NUMBER\}\)"/);
  assert.match(body, /gh api -X PATCH "repos\/\$\{GITHUB_REPOSITORY\}\/pulls\/\$\{PR_NUMBER\}" -f title="\$SUBJECT"/, "the rename goes through the REST endpoint");
  assert.match(body, /<!-- release-automerge-off -->/);
  assert.match(body, /contains\(\\"\$MARKER\\"\)/, "an existing guidance comment is detected by its marker");
  assert.ok(!/gh pr merge/.test(body), "the manual-merge step must never merge");
});

test("the guidance and log messages exist in both languages and tell the user not to rebase", () => {
  for (const key of ["wf_changelog.automerge_off", "wf_changelog.automerge_off_comment", "wf_changelog.automerge_rename_failed"]) {
    assert.strictEqual(MESSAGES.split(`"${key}"`).length - 1, 2, `${key} must be defined once per language`);
  }
  assert.match(MESSAGES, /"wf_changelog\.automerge_off_comment": "[^"]*[Rr]ebase/);
});
