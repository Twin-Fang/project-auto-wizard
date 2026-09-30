// tests/node/react-ci-summary.test.js
// When the tests fail the build step never runs: the summary must say so instead of printing an empty build
// status, must not point to a build-log artifact that does not exist, and must show the PR head branch.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const wf = readFileSync(join(REPO_ROOT, "payload", "workflows", "react", "PROJECT-REACT-CI.yaml"), "utf8");
const messages = readFileSync(join(REPO_ROOT, "payload", "scripts", "messages.py"), "utf8");

test("React CI summary separates a skipped build from a failed one", () => {
  assert.match(wf, /cibuild\.node_result_status_not_run/);
  assert.match(wf, /cibuild\.node_build_not_run\b/);
  // The log hint is only shown in the branch where the build actually failed
  const tail = wf.slice(wf.indexOf("cibuild.node_all_ok"));
  assert.ok(tail.indexOf("cibuild.node_build_not_run") < tail.indexOf("cibuild.node_log_hint"));
});

test("React CI does not try to upload a build log when the build step was skipped", () => {
  assert.match(wf, /name: Upload build log\n\s+if: \$\{\{ always\(\) && steps\.build\.outcome != 'skipped' \}\}/);
});

test("React CI summary shows the PR head branch, not the merge ref", () => {
  assert.match(wf, /BRANCH_NAME: \$\{\{ github\.head_ref \|\| github\.ref_name \}\}/);
  assert.doesNotMatch(wf, /branch="\$\{\{ github\.ref_name \}\}"/);
});

test("new summary messages exist in both languages", () => {
  for (const key of ["cibuild.node_result_status_not_run", "cibuild.node_build_not_run", "cibuild.node_build_not_run_hint"]) {
    assert.strictEqual(messages.split(`"${key}"`).length - 1, 2, `${key} must be defined in en and ko`);
  }
});
