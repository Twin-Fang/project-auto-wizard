// tests/node/release-automerge-followup.test.js
// Follow-ups of the release_automerge option: the "manual release merge" workflow step is run for real against a fake `gh`
// (rename failure, comment API failure, re-run), doctor only reports the option for an installed repo, and the docs cover it.
import "../setup-lang.mjs"; // these tests assert the ko output
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, chmodSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { runDoctor } from "../../src/commands/doctor.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const WF = read("payload/workflows/common/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml");

// ── the manual-merge step, executed with a fake gh ─────────────────────────────────────────────
function stepScript(automerge = "false") {
  const block = WF.match(/- name: Prepare manual release merge[\s\S]*?(?=\n      - name: |\n  [a-z][\w-]*:\n)/)[0];
  const run = block.split("        run: |\n")[1];
  return run.split("\n").map((l) => l.replace(/^ {10}/, "")).join("\n")
    .replaceAll("${{ github.event.pull_request.number }}", "7")
    .replaceAll("${{ steps.bump.outputs.new_version }}", "1.2.3")
    .replaceAll("${{ steps.automerge_option.outputs.release_automerge }}", automerge);
}

// scenario: { patchFails, listFails, existing, automerge, blocked } — automerge is the option value, blocked the Enable automerge cause
function runStep(scenario = {}) {
  const dir = mkdtempSync(join(tmpdir(), "paw-step-"));
  try {
    mkdirSync(join(dir, "ws/.github/scripts"), { recursive: true });
    copyFileSync(join(ROOT, "payload/scripts/messages.py"), join(dir, "ws/.github/scripts/messages.py"));
    mkdirSync(join(dir, "bin"));
    const log = join(dir, "gh.log");
    writeFileSync(join(dir, "bin/gh"), `#!/bin/bash
echo "$*" | tr "\n" " " >> "${log}"; echo >> "${log}"
case "$*" in
  *"-X PATCH"*) [ -n "$FAKE_PATCH_FAILS" ] && exit 1; exit 0;;
  *"--paginate"*) [ -n "$FAKE_LIST_FAILS" ] && exit 1; [ -n "$FAKE_EXISTING" ] && echo 99; exit 0;;
  "pr comment"*) exit 0;;
esac
exit 0
`);
    chmodSync(join(dir, "bin/gh"), 0o755);
    const r = spawnSync("bash", ["-e", "-o", "pipefail", "-c", stepScript(scenario.automerge)], {
      encoding: "utf8",
      env: {
        ...process.env, PATH: `${join(dir, "bin")}:${process.env.PATH}`, GITHUB_WORKSPACE: join(dir, "ws"),
        GITHUB_REPOSITORY: "acme/widgets", PROJECT_AUTO_WIZARD_LANG: "en",
        FAKE_PATCH_FAILS: scenario.patchFails ? "1" : "", FAKE_LIST_FAILS: scenario.listFails ? "1" : "",
        FAKE_EXISTING: scenario.existing ? "1" : "", MERGE_BLOCKED: scenario.blocked || "",
      },
    });
    const calls = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
    return { status: r.status, out: r.stdout + r.stderr, calls, comments: calls.filter((c) => c.startsWith("pr comment")) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("blocked automerge (review required): renames the PR, posts one comment that names the cause and both options", () => {
  const r = runStep({ automerge: "true", blocked: "review" });
  assert.strictEqual(r.status, 0, r.out);
  assert.ok(r.calls.some((c) => c.includes("-X PATCH") && c.includes("pulls/7") && c.includes("chore(release): v1.2.3 (PR #7)")), r.calls.join("\n"));
  assert.strictEqual(r.comments.length, 1);
  assert.ok(r.comments[0].includes("<!-- release-merge-blocked -->"));
  assert.ok(!r.comments[0].includes("release-automerge-off"));
  assert.match(r.comments[0], /requires an approving review/);
  assert.match(r.comments[0], /release_automerge: false/);
  assert.match(r.comments[0], /Create a merge commit/);
  assert.match(r.out, /PR renamed to "chore\(release\): v1\.2\.3 \(PR #7\)"/);
  assert.ok(!/pr merge/.test(r.calls.join("\n")));
});

test("blocked automerge (other protection rule) uses the policy reason; an unknown cause uses the generic one", () => {
  assert.match(runStep({ automerge: "true", blocked: "policy" }).comments[0], /branch protection on the release branch blocks the merge/);
  assert.match(runStep({ automerge: "true", blocked: "other" }).comments[0], /GitHub rejected the merge/);
  assert.match(runStep({ automerge: "true" }).comments[0], /GitHub rejected the merge/);
});

test("blocked automerge: an existing blocked-guidance comment is not posted again, and a failed rename adds the merge-message hint", () => {
  assert.strictEqual(runStep({ automerge: "true", blocked: "review", existing: true }).comments.length, 0);
  const r = runStep({ automerge: "true", blocked: "review", patchFails: true });
  assert.strictEqual(r.status, 0, r.out);
  assert.match(r.comments[0], /could not be updated automatically/);
});

test("blocked automerge in Korean carries the same cause and options", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-ko-"));
  try {
    const r = spawnSync("python3", [join(ROOT, "payload/scripts/messages.py"), "get", "wf_changelog.merge_blocked_comment", "reason=사유"], {
      encoding: "utf8", env: { ...process.env, PROJECT_AUTO_WIZARD_LANG: "ko", PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
    });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /사유/);
    assert.match(r.stdout, /release_automerge: false/);
    assert.match(r.stdout, /Create a merge commit/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("step: renames the PR through the API and posts one guidance comment", () => {
  const r = runStep();
  assert.strictEqual(r.status, 0, r.out);
  assert.ok(r.calls.some((c) => c.includes("-X PATCH") && c.includes("pulls/7") && c.includes("chore(release): v1.2.3 (PR #7)")), r.calls.join("\n"));
  assert.strictEqual(r.comments.length, 1);
  assert.ok(r.comments[0].includes("<!-- release-automerge-off -->"));
  assert.ok(!/gh pr merge|pr merge/.test(r.calls.join("\n")));
});

test("step: an existing guidance comment is not posted again", () => {
  const r = runStep({ existing: true });
  assert.strictEqual(r.status, 0, r.out);
  assert.strictEqual(r.comments.length, 0);
});

test("step: when the comment list cannot be read, no duplicate comment is posted and the run does not fail", () => {
  const r = runStep({ listFails: true });
  assert.strictEqual(r.status, 0, r.out);
  assert.strictEqual(r.comments.length, 0);
  assert.match(r.out, /::warning::/);
});

test("step: when the rename fails the run still passes and the comment states the required merge title", () => {
  const r = runStep({ patchFails: true });
  assert.strictEqual(r.status, 0, r.out);
  assert.strictEqual(r.comments.length, 1);
  assert.ok(r.comments[0].includes("chore(release): v1.2.3 (PR #7)"), "the comment must tell the maintainer which merge message keeps the release working");
  assert.match(r.out, /::warning::/);
});

test("guidance tells the maintainer to merge only after the workflow run has finished", () => {
  const en = read("payload/scripts/messages.py").match(/"wf_changelog\.automerge_off_comment": "([^"]*)"/)[1];
  assert.match(en, /finish|complete/i);
});

// ── doctor ──────────────────────────────────────────────────────────────────────────────────────
const OK_EXEC = (cmd, args) => {
  const key = [cmd, ...args].join(" ");
  if (key.includes("git -C")) return { status: 0, stdout: "https://github.com/acme/widgets.git\n", stderr: "" };
  return { status: 0, stdout: "true", stderr: "" };
};

function doctorItems(versionYmlBody) {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    if (versionYmlBody !== null) writeFileSync(join(dir, "version.yml"), versionYmlBody);
    return runDoctor(dir, { exec: OK_EXEC });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const automergeItem = (items) => items.find((i) => i.name === "릴리스 PR 자동 머지");

test("doctor: not installed -> no release_automerge item (there is no saved setting to report)", () => {
  assert.strictEqual(automergeItem(doctorItems(null)), undefined);
});

test("doctor: installed -> reports on, and off when version.yml says false", () => {
  const yml = (line) => `metadata:\n  template:\n    version: "1"\n    options:\n${line}`;
  assert.match(String(automergeItem(doctorItems(yml("      semver_auto: true\n"))).note[0]), /켜져/);
  assert.match(String(automergeItem(doctorItems(yml("      release_automerge: false\n"))).note[0]), /꺼져/);
});

// ── docs ────────────────────────────────────────────────────────────────────────────────────────
test("docs: release flow, doctor and status pages cover release_automerge in both languages", () => {
  for (const prefix of ["website/src/content/docs", "website/src/content/docs/ko"]) {
    assert.ok(read(`${prefix}/understand/release-flow.mdx`).includes("release_automerge"), `${prefix} release-flow`);
    assert.ok(read(`${prefix}/operate/doctor.md`).includes("release_automerge"), `${prefix} doctor`);
    assert.ok(read(`${prefix}/operate/status.md`).includes("release_automerge"), `${prefix} status`);
  }
});

// ── the Enable automerge step, executed with a fake gh: which cause does a rejected merge get? ────
function enableScript() {
  const block = WF.match(/- name: Enable automerge[\s\S]*?(?=\n      - name: |\n      # Runs for)/)[0];
  const run = block.split("        run: |\n")[1];
  return run.split("\n").map((l) => l.replace(/^ {10}/, "")).join("\n")
    .replaceAll("${{ github.event.pull_request.number }}", "7")
    .replaceAll("${{ steps.bump.outputs.new_version }}", "1.2.3")
    .replaceAll("{{MAIN_BRANCH}}", "main").replaceAll("{{DEVELOP_BRANCH}}", "develop");
}

// scenario: { review, state, mergeErr, mergeable, allowMergeCommit }
function runEnable(scenario = {}) {
  const dir = mkdtempSync(join(tmpdir(), "paw-enable-"));
  try {
    mkdirSync(join(dir, "ws/.github/scripts"), { recursive: true });
    copyFileSync(join(ROOT, "payload/scripts/messages.py"), join(dir, "ws/.github/scripts/messages.py"));
    mkdirSync(join(dir, "bin"));
    // gh: every merge attempt is rejected; the PR views answer from the scenario. sleep is a no-op so the backoff does not stall the test.
    writeFileSync(join(dir, "bin/gh"), `#!/bin/bash
case "$*" in
  "pr view"*"--json state"*) echo OPEN;;
  "pr view"*"--json mergeable"*) echo "\${FAKE_MERGEABLE:-MERGEABLE}";;
  "pr view"*"--json reviewDecision"*) echo "$FAKE_REVIEW";;
  "pr view"*"--json mergeStateStatus"*) echo "$FAKE_STATE";;
  "pr merge"*) echo "$FAKE_MERGE_ERR" >&2; exit 1;;
  "api repos/"*"allow_merge_commit"*|"api repos/acme/widgets --jq"*) echo "\${FAKE_ALLOW_MERGE_COMMIT:-true}";;
esac
exit 0
`);
    writeFileSync(join(dir, "bin/sleep"), "#!/bin/bash\nexit 0\n");
    chmodSync(join(dir, "bin/gh"), 0o755);
    chmodSync(join(dir, "bin/sleep"), 0o755);
    const outFile = join(dir, "gh_output");
    writeFileSync(outFile, "");
    const r = spawnSync("bash", ["-e", "-o", "pipefail", "-c", enableScript()], {
      encoding: "utf8",
      env: {
        ...process.env, PATH: `${join(dir, "bin")}:${process.env.PATH}`, GITHUB_WORKSPACE: join(dir, "ws"),
        GITHUB_REPOSITORY: "acme/widgets", PROJECT_AUTO_WIZARD_LANG: "en", RUNNER_TEMP: dir, GITHUB_OUTPUT: outFile,
        FAKE_REVIEW: scenario.review || "", FAKE_STATE: scenario.state || "", FAKE_MERGE_ERR: scenario.mergeErr || "",
        FAKE_MERGEABLE: scenario.mergeable || "MERGEABLE", FAKE_ALLOW_MERGE_COMMIT: scenario.allowMergeCommit || "true",
      },
    });
    return { status: r.status, out: r.stdout + r.stderr, outputs: readFileSync(outFile, "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const POLICY_ERR = "X Pull request acme/widgets#7 is not mergeable: the base branch policy prohibits the merge.";

test("rejected merge, review required: the run fails with the review cause and the options, and flags it for the next step", () => {
  const r = runEnable({ review: "REVIEW_REQUIRED", state: "BLOCKED", mergeErr: POLICY_ERR });
  assert.strictEqual(r.status, 1, r.out);
  assert.match(r.outputs, /^merge_blocked=review$/m);
  assert.match(r.out, /::error::The release PR cannot be merged automatically: branch protection on main requires an approving review/);
  assert.match(r.out, /release_automerge: false/);
  assert.ok(!/check branch protection rules, required checks, and token permissions/.test(r.out));
});

test("rejected merge, another protection rule: the policy cause; no hint at all: the generic message and the other flag", () => {
  const policy = runEnable({ state: "BLOCKED", mergeErr: POLICY_ERR });
  assert.strictEqual(policy.status, 1, policy.out);
  assert.match(policy.outputs, /^merge_blocked=policy$/m);
  assert.match(policy.out, /::error::The release PR cannot be merged automatically: branch protection on main blocks the merge/);
  // the gh message alone is enough even when the merge state could not be read
  assert.match(runEnable({ mergeErr: POLICY_ERR }).outputs, /^merge_blocked=policy$/m);
  const other = runEnable({ mergeErr: "something unexpected" });
  assert.strictEqual(other.status, 1, other.out);
  assert.match(other.outputs, /^merge_blocked=other$/m);
  assert.match(other.out, /::error::PR merge failed after 4 attempts/);
});

test("rejected merge caused by a conflict or disabled merge commits is not flagged as a protection block", () => {
  const conflict = runEnable({ mergeable: "CONFLICTING", review: "REVIEW_REQUIRED", state: "BLOCKED", mergeErr: POLICY_ERR });
  assert.strictEqual(conflict.status, 1, conflict.out);
  assert.strictEqual(conflict.outputs.trim(), "");
  assert.match(conflict.out, /conflicts with main/);
  const disabled = runEnable({ allowMergeCommit: "false", review: "REVIEW_REQUIRED", mergeErr: POLICY_ERR });
  assert.strictEqual(disabled.outputs.trim(), "");
  assert.match(disabled.out, /Merge commits are disabled/);
});
