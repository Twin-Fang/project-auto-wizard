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
function stepScript() {
  const block = WF.match(/- name: Prepare manual release merge[\s\S]*?(?=\n      - name: )/)[0];
  const run = block.split("        run: |\n")[1];
  return run.split("\n").map((l) => l.replace(/^ {10}/, "")).join("\n")
    .replaceAll("${{ github.event.pull_request.number }}", "7")
    .replaceAll("${{ steps.bump.outputs.new_version }}", "1.2.3");
}

// scenario: { patchFails, listFails, existing }
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
    const r = spawnSync("bash", ["-e", "-o", "pipefail", "-c", stepScript()], {
      encoding: "utf8",
      env: {
        ...process.env, PATH: `${join(dir, "bin")}:${process.env.PATH}`, GITHUB_WORKSPACE: join(dir, "ws"),
        GITHUB_REPOSITORY: "acme/widgets", PROJECT_AUTO_WIZARD_LANG: "en",
        FAKE_PATCH_FAILS: scenario.patchFails ? "1" : "", FAKE_LIST_FAILS: scenario.listFails ? "1" : "",
        FAKE_EXISTING: scenario.existing ? "1" : "",
      },
    });
    const calls = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
    return { status: r.status, out: r.stdout + r.stderr, calls, comments: calls.filter((c) => c.startsWith("pr comment")) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

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
