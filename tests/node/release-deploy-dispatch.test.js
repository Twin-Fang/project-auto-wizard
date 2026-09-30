// tests/node/release-deploy-dispatch.test.js
// Pin that RELEASE-PUBLISH wakes the deploy workflow via workflow_dispatch so releases merged
// with a bot token (no PAT) still run the main deploy workflow, and that PAT/human merges
// do not deploy twice by overlapping with the push event.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, existsSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";

const read = (p) => readFileSync(p, "utf8");
const PAYLOAD_RP = join("payload", "workflows", "common", "PROJECT-COMMON-RELEASE-PUBLISH.yaml");
const DOGFOOD_RP = join(".github", "workflows", "PROJECT-COMMON-RELEASE-PUBLISH.yaml");
const STEP = "- name: Trigger deploy workflows";

function stepBlock(body) {
  const idx = body.indexOf(STEP);
  assert.ok(idx > -1, "deploy trigger step is missing");
  const next = body.indexOf("\n      - name: ", idx + STEP.length);
  return body.slice(idx, next === -1 ? undefined : next);
}

// Extract the run: | block using 10-space indentation (same result as a YAML block scalar).
function runScript(body) {
  const lines = stepBlock(body).split("\n");
  const start = lines.findIndex((l) => l.trim() === "run: |");
  assert.ok(start > -1, "run block is missing");
  const out = [];
  for (const l of lines.slice(start + 1)) {
    if (l.trim() && !l.startsWith(" ".repeat(10))) break;
    out.push(l.slice(10));
  }
  return out.join("\n").replaceAll("{{MAIN_BRANCH}}", "main");
}

for (const path of [PAYLOAD_RP, DOGFOOD_RP]) {
  test(`${path}: wakes the deploy workflow only for a release newly published in pr-flow`, () => {
    const body = read(path);
    const step = stepBlock(body);
    assert.ok(step.includes("steps.version.outputs.release_exists != 'true'"), "must wake only on a newly published release");
    assert.ok(step.includes("steps.mode.outputs.mode == 'pr-flow'"), "in trunk-based the human push already wakes the deploy");
    assert.ok(step.includes("GH_TOKEN: ${{ github.token }}"), "must work without a PAT");
    assert.ok(step.includes("HAS_WORKFLOW_PAT: ${{ secrets.WORKFLOW_PAT != '' }}"), "when the merger lookup fails, decide by PAT presence");
    assert.ok(body.indexOf(STEP) > body.indexOf("- name: Create GitHub Release"), "must come after the release is published");
    assert.match(body, /^permissions:[\s\S]*?^\s+actions:\s*write/m);
    assert.match(body, /^permissions:[\s\S]*?^\s+pull-requests:\s*read/m, "merger lookup needs pull-requests: read");
  });
}

test("RELEASE-PUBLISH deploy trigger step is identical in payload and repo copy", () => {
  assert.strictEqual(runScript(read(DOGFOOD_RP)), runScript(read(PAYLOAD_RP)));
});

// Every deploy workflow that runs on main push needs workflow_dispatch so the fallback can wake it.
// Ones with push commented out, like the zero-downtime template, get enabled on install, so check them too.
test("every payload workflow that runs on main push has workflow_dispatch", () => {
  const root = join("payload", "workflows");
  const files = readdirSync(root, { recursive: true }).filter((f) => /\.ya?ml$/.test(f));
  let checked = 0;
  for (const f of files) {
    const body = read(join(root, f));
    const on = body.match(/^on:\n((?:[ #].*\n|\n)*)/m)?.[1] ?? "";
    if (!/^\s*#?\s*push:/m.test(on) || !on.includes("{{MAIN_BRANCH}}")) continue;
    checked++;
    assert.match(on, /^ {2}workflow_dispatch:/m, `${f} has no workflow_dispatch`);
  }
  assert.ok(checked >= 10, `too few workflows checked: ${checked}`);
});

// ---------------------------------------------------------------
// Real run: execute the step script in a real git repo with a fake gh.
// ---------------------------------------------------------------
function hasPython3() {
  const r = spawnSync("python3", ["-c", "print(1)"], { encoding: "utf-8" });
  return r.status === 0;
}

function setupRepo({ releaseMerge = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "paw-deploy-"));
  const work = join(root, "work");
  const bin = join(root, "bin");
  mkdirSync(join(work, ".github", "workflows"), { recursive: true });
  mkdirSync(bin);
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1" };
  const git = (...args) => {
    const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: work, encoding: "utf-8", env });
    assert.strictEqual(r.status, 0, r.stderr);
  };

  // Simulate an installed state: substitute placeholders and leave the zero-downtime CD with push enabled.
  const payloadRoot = join("payload", "workflows");
  for (const f of readdirSync(payloadRoot, { recursive: true }).filter((n) => /\.ya?ml$/.test(n))) {
    let body = read(join(payloadRoot, f)).replaceAll("{{MAIN_BRANCH}}", "main").replaceAll("{{DEVELOP_BRANCH}}", "develop");
    if (f.endsWith("NONSTOP-NGINX-CICD.yaml")) {
      body = body.replace("  # push:\n  #   branches:\n  #     - main", "  push:\n    branches:\n      - main");
    }
    if (basename(f) === "PROJECT-REACT-CICD.yaml") {
      body = body.replace(/^( *)# @wizard paths-anchor.*$/m, "$1paths: ['web/**']");
    }
    writeFileSync(join(work, ".github", "workflows", basename(f)), body);
  }
  // Leave user workflows not installed by the wizard untouched
  writeFileSync(join(work, ".github", "workflows", "my-deploy.yml"), "on:\n  push:\n    branches: [main]\n  workflow_dispatch:\n");

  writeFileSync(join(work, "README.md"), "x\n");
  git("init", "-q", "-b", "main");
  git("add", ".");
  git("commit", "-q", "-m", "chore: init");
  git("checkout", "-q", "-b", "develop");
  mkdirSync(join(work, "web"));
  writeFileSync(join(work, "web", "app.js"), "1\n");
  git("add", ".");
  git("commit", "-q", "-m", "feat: new screen");
  git("checkout", "-q", "main");
  if (releaseMerge) {
    git("merge", "-q", "--no-ff", "-m", "chore(release): v0.2.0 (PR #7)", "develop");
  } else {
    git("merge", "-q", "--ff-only", "develop");
    git("commit", "-q", "--allow-empty", "-m", "chore(version): bump to v0.2.0 [skip ci]");
  }

  // Fake gh: merger lookup returns FAKE_MERGED_BY (fails when empty); workflow run only records
  const log = join(root, "gh.log");
  writeFileSync(join(bin, "gh"), [
    "#!/usr/bin/env bash",
    `echo "$*" >> "${log}"`,
    'if [ "$1" = "api" ]; then',
    '  [ -n "$FAKE_MERGED_BY" ] || exit 1',
    '  echo "$FAKE_MERGED_BY"',
    "fi",
    "exit 0",
    "",
  ].join("\n"));
  chmodSync(join(bin, "gh"), 0o755);
  return { root, work, bin, log };
}

function runStep(t, { mergedBy = "", hasPat = "false", releaseMerge = true } = {}) {
  if (process.platform === "win32") {
    t.skip("workflow shell snippets assume bash on an ubuntu runner");
    return null;
  }
  if (!hasPython3()) {
    t.skip("python3 not available");
    return null;
  }
  const { root, work, bin, log } = setupRepo({ releaseMerge });
  try {
    // The step prints through the message catalog, so provide it like an installed repo does.
    mkdirSync(join(work, ".github", "scripts"), { recursive: true });
    copyFileSync(join("payload", "scripts", "messages.py"), join(work, ".github", "scripts", "messages.py"));
    const r = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", runScript(read(PAYLOAD_RP))], {
      cwd: work, encoding: "utf-8",
      env: {
        ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: root, GITHUB_WORKSPACE: work, PROJECT_AUTO_WIZARD_LANG: "en", GITHUB_REPOSITORY: "my-org/my-app",
        FAKE_MERGED_BY: mergedBy, HAS_WORKFLOW_PAT: hasPat, RELEASE_VERSION: "0.2.0", MAIN_BRANCH: "main",
        PYTHONDONTWRITEBYTECODE: "1",
      },
    });
    assert.strictEqual(r.status, 0, `${r.stdout}\n${r.stderr}`);
    const calls = existsSync(log) ? read(log).split("\n").filter(Boolean) : [];
    return {
      api: calls.filter((c) => c.startsWith("api ")),
      runs: calls.filter((c) => c.startsWith("workflow run ")).map((c) => c.split(" ")[2]),
      stdout: r.stdout,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("a release merged by a bot token wakes all main deploy workflows", (t) => {
  const r = runStep(t, { mergedBy: "github-actions[bot]" });
  if (!r) return;
  assert.deepStrictEqual(r.api, ["api repos/my-org/my-app/pulls/7 --jq .merged_by.login // \"\""]);
  assert.match(r.stdout, /PR #7 was merged with the bot token/);
  assert.deepStrictEqual(r.runs, [
    "PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml",
    "PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml",
    "PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD.yaml",
    "PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml",
    "PROJECT-GO-SIMPLE-CICD.yaml",
    "PROJECT-PYTHON-SIMPLE-CICD.yaml",
    "PROJECT-REACT-CICD.yaml",
    "PROJECT-SPRING-NONSTOP-NGINX-CICD.yaml",
    "PROJECT-SPRING-SIMPLE-CICD.yaml",
  ], "develop CI, common and user workflows, zero-downtime CD with push off, and CD with non-matching paths must be excluded");
});

test("bot merge is detected only on an exact github-actions[bot] match", (t) => {
  // An account sharing only the prefix (e.g. a machine account) counts as a human merge and is skipped
  const machine = runStep(t, { mergedBy: "github-actions-machine", hasPat: "true" });
  if (!machine) return;
  assert.deepStrictEqual(machine.runs, []);
  // Must skip even without a PAT, because the merger is a confirmed human account
  assert.deepStrictEqual(runStep(t, { mergedBy: "github-actions-machine", hasPat: "false" }).runs, []);
  assert.ok(runStep(t, { mergedBy: "github-actions[bot]", hasPat: "true" }).runs.length > 0);
});

test("when a PAT or human merged, the push event already deployed, so do not wake", (t) => {
  const r = runStep(t, { mergedBy: "my-bot-user", hasPat: "true" });
  if (!r) return;
  assert.deepStrictEqual(r.runs, []);
});

test("when the merger is unknown, skip if a PAT exists and wake if not", (t) => {
  const withPat = runStep(t, { mergedBy: "", hasPat: "true" });
  if (!withPat) return;
  assert.deepStrictEqual(withPat.runs, []);
  const noPat = runStep(t, { mergedBy: "", hasPat: "false" });
  assert.ok(noPat.runs.includes("PROJECT-SPRING-SIMPLE-CICD.yaml"), noPat.stdout);
});

test("a release not from a release PR merge (safety-net bump) does not wake", (t) => {
  const r = runStep(t, { mergedBy: "github-actions[bot]", releaseMerge: false });
  if (!r) return;
  assert.deepStrictEqual(r.api, []);
  assert.deepStrictEqual(r.runs, []);
});
