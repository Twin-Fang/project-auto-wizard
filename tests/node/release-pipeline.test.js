// tests/node/release-pipeline.test.js
// Pins commit hygiene, idempotency and packaging of the shared release workflows installed into user repos.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmTmp } from "../helpers/tmp.mjs";

const payloadPath = (n) => join("payload", "workflows", "common", `PROJECT-COMMON-${n}.yaml`);
const dogfoodPath = (n) => join(".github", "workflows", `PROJECT-COMMON-${n}.yaml`);
const read = (p) => readFileSync(p, "utf8");
const bothCopies = (n) => [payloadPath(n), dogfoodPath(n)];

// Workflows that create bot commits: __pycache__ left behind by script runs must not end up in a commit.
const COMMITTING = ["AUTO-CHANGELOG-CONTROL", "RELEASE-PUBLISH", "VERSION-CONTROL", "README-VERSION-UPDATE"];

for (const name of COMMITTING) {
  for (const path of bothCopies(name)) {
    test(`${path}: top-level env disables Python bytecode generation`, () => {
      assert.match(read(path), /^env:\n(?:  .*\n)*  PYTHONDONTWRITEBYTECODE: "1"/m);
    });

    test(`${path}: does not commit the whole working tree via git add -A / git add .`, () => {
      assert.ok(!/git add (-A|--all|\.)(\s|$)/m.test(read(path)), "only explicitly named paths must be staged");
    });
  }
}

test("npm package files exclude __pycache__ and pyc", () => {
  const files = JSON.parse(read("package.json")).files;
  assert.ok(files.includes("!**/__pycache__/"), "missing __pycache__ exclusion pattern");
  assert.ok(files.includes("!**/*.pyc"), "missing *.pyc exclusion pattern");
});

test("the Python test launcher leaves no bytecode", () => {
  assert.ok(read(join("scripts", "run-py-tests.mjs")).includes('PYTHONDONTWRITEBYTECODE: "1"'));
});

test("npm pack does not ship pyc under payload (measured)", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "paw-pack-"));
  try {
    const pkg = JSON.parse(read("package.json"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "my-app", version: "0.0.0", files: pkg.files }));
    mkdirSync(join(dir, "payload", "scripts", "__pycache__"), { recursive: true });
    writeFileSync(join(dir, "payload", "scripts", "tool.py"), "print('ok')\n");
    writeFileSync(join(dir, "payload", "scripts", "__pycache__", "tool.cpython-312.pyc"), "x");
    const isWin = process.platform === "win32";
    const r = spawnSync(isWin ? "npm.cmd" : "npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: dir, encoding: "utf-8", shell: isWin,
    });
    if (r.error || r.status !== 0) {
      t.skip(`cannot run npm pack: ${r.error?.message || r.stderr}`);
      return;
    }
    const paths = JSON.parse(r.stdout)[0].files.map((f) => f.path);
    assert.ok(paths.includes("payload/scripts/tool.py"), `sources must be shipped: ${paths}`);
    assert.ok(!paths.some((p) => p.includes("__pycache__") || p.endsWith(".pyc")), `pyc was shipped: ${paths}`);
  } finally {
    rmTmp(dir);
  }
});

// A bot-token push cannot trigger the README update; even a default install without a PAT must keep the README in step with the release version.
for (const path of bothCopies("RELEASE-PUBLISH")) {
  test(`${path}: after publishing a release, README-VERSION-UPDATE is triggered via workflow_dispatch`, () => {
    const body = read(path);
    assert.match(body, /^permissions:[\s\S]*?^\s+actions:\s*write/m, "workflow_dispatch requires actions: write");
    const idx = body.indexOf("- name: Trigger README-VERSION-UPDATE");
    assert.ok(idx > -1, "missing README update trigger step");
    const step = body.slice(idx, idx + 1200);
    assert.ok(step.includes("steps.version.outputs.release_exists != 'true'"), "must trigger only for a newly published release");
    assert.match(step, /gh workflow run PROJECT-COMMON-README-VERSION-UPDATE\.yaml --ref (\{\{MAIN_BRANCH\}\}|main)/);
    assert.ok(step.indexOf("GH_TOKEN: ${{ github.token }}") > -1, "must work with the default token too");
  });
}

// The README in a tag snapshot precedes the README version commit, so it is always one version behind.
test("NPM-PUBLISH sets the README version line to the release version before packaging", () => {
  const body = read(join(".github", "workflows", "NPM-PUBLISH.yaml"));
  const fix = body.indexOf("- name: Align README version line to the published version");
  assert.ok(fix > -1, "missing README version fix step");
  assert.ok(fix > body.indexOf("uses: actions/checkout"), "must come after checkout");
  assert.ok(fix < body.indexOf("npm publish --dry-run"), "must come before packaging (publish)");
  const step = body.slice(fix, fix + 900);
  assert.ok(step.includes("AUTO-VERSION-SECTION"), "must fix the line after the auto-version marker");
  assert.ok(step.includes("steps.target.outputs.version"), "must use the target release version");
  assert.match(body, /^env:\n(?:  .*\n)*  PYTHONDONTWRITEBYTECODE: "1"/m, "pyc left by the publish-gate tests would be shipped in the package");
});

// A duplicate run (release + workflow_dispatch) gets E409 from the registry even though the version is published.
test("NPM-PUBLISH treats E409 as already published but still fails on other publish errors", () => {
  const body = read(join(".github", "workflows", "NPM-PUBLISH.yaml"));
  const start = body.indexOf("- name: Publish to npm");
  const end = body.indexOf("- name: Publish summary");
  assert.ok(start > -1 && end > start, "missing publish step");
  const step = body.slice(start, end);
  assert.ok(step.includes("id: publish"), "summary needs the publish step output");
  assert.ok(step.includes("npm publish --provenance --access public 2>&1"), "must keep provenance and capture the output");
  assert.ok(step.includes('echo "$OUTPUT"'), "must echo the publish output");
  assert.match(step, /grep -q "E409"[\s\S]*already_published=true[\s\S]*exit 0/, "E409 must exit 0 and expose already_published");
  assert.match(step, /exit "\$STATUS"\s*\n\s*env:/, "other failures must keep the original exit code");
  assert.ok(!step.includes("|| true"), "must not swallow every failure");
  assert.ok(step.includes("NODE_AUTH_TOKEN"), "must keep the npm token env");
  assert.ok(body.slice(end).includes("steps.publish.outputs.already_published != 'true'"), "summary must not claim a publish on E409");
});

// ---------------------------------------------------------------
// Commit collection: keep the one-subject-line-per-entry format while BREAKING CHANGE footers in the body still reach the bump decision.
// The workflow's collection lines are extracted verbatim and run in a real git repo.
// ---------------------------------------------------------------
const COLLECTORS = ["AUTO-CHANGELOG-CONTROL", "AI-PR-SUMMARY", "RELEASE-PUBLISH"];

function collectLines(name) {
  return read(payloadPath(name))
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^git log (--cherry-pick --right-only )?--pretty=%/.test(l) && /> ?commits\.txt|>> commits\.txt/.test(l));
}

for (const name of COLLECTORS) {
  // Commit text is non-ASCII (escaped) on purpose: the collection step must keep UTF-8 subjects intact
  test(`${name}: collects commit subjects plus only the BREAKING CHANGE footer from bodies`, () => {
    const lines = collectLines(name);
    assert.ok(lines.some((l) => /^git log (--cherry-pick --right-only )?--pretty=%s/.test(l) && l.includes("> commits.txt")), "missing subject collection line");
    const footer = lines.find((l) => l.includes(">> commits.txt"));
    assert.ok(footer, "missing body footer collection line");
    assert.match(footer, /^git log (--cherry-pick --right-only )?--pretty=%b/, "must be taken from the body (%b)");
    assert.ok(footer.includes("grep -E '^BREAKING[ -]CHANGE[[:space:]]*:'"), "must filter only footer lines");
    assert.ok(footer.endsWith("|| true"), "the step must not fail on grep's exit code when there is no footer");
  });
}

function findPython() {
  for (const cmd of ["python3", "python"]) {
    const r = spawnSync(cmd, ["-c", "import sys; print(sys.version_info[0])"], { encoding: "utf-8", input: "" });
    if (r.status === 0 && r.stdout.trim() === "3") return cmd;
  }
  return null;
}

test("feeding the collected output to classify-bump makes a body-footer commit major and keeps other body lines out", (t) => {
  if (process.platform === "win32") {
    t.skip("the workflow shell snippet assumes bash on an ubuntu runner");
    return;
  }
  const python = findPython();
  if (!python) {
    t.skip("python3 not available");
    return;
  }
  const scriptPath = join(process.cwd(), "payload", "scripts", "changelog_manager.py");
  const dir = mkdtempSync(join(tmpdir(), "paw-collect-"));
  const env = { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1", GIT_CONFIG_NOSYSTEM: "1" };
  const git = (...args) => {
    const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf-8", env });
    assert.strictEqual(r.status, 0, r.stderr);
  };
  try {
    git("init", "-q");
    git("commit", "-q", "--allow-empty", "-m", "chore: init");
    git("branch", "base");
    git("commit", "-q", "--allow-empty", "-m", "fix: \ub85c\uadf8\uc778 \uc624\ub958 \uc218\uc815", "-m", "\uc6d0\uc778 \uc124\uba85 \ud55c \uc904");
    git("commit", "-q", "--allow-empty", "-m", "feat: \uc778\uc99d API \uad50\uccb4", "-m", "BREAKING CHANGE: \ud1a0\ud070 \ud615\uc2dd\uc774 \ubc14\ub01d\ub2c8\ub2e4");
    const snippet = collectLines("AUTO-CHANGELOG-CONTROL").map((l) => l.replaceAll("origin/{{MAIN_BRANCH}}", "base")).join("\n");
    const r = spawnSync("bash", ["-e", "-c", snippet], { cwd: dir, encoding: "utf-8", env });
    assert.strictEqual(r.status, 0, r.stderr);
    const collected = readFileSync(join(dir, "commits.txt"), "utf-8").split("\n").filter(Boolean);
    assert.deepStrictEqual(collected, ["feat: \uc778\uc99d API \uad50\uccb4", "fix: \ub85c\uadf8\uc778 \uc624\ub958 \uc218\uc815", "BREAKING CHANGE: \ud1a0\ud070 \ud615\uc2dd\uc774 \ubc14\ub01d\ub2c8\ub2e4"]);

    const bump = spawnSync(python, [scriptPath, "classify-bump", "--commits-file", "commits.txt"], {
      cwd: dir, encoding: "utf-8", env: { ...env, AI_API_KEY: "", COPILOT_AI: "false" },
    });
    assert.strictEqual(bump.status, 0, bump.stderr);
    assert.strictEqual(bump.stdout.trim().split("\n").pop(), "major");
  } finally {
    rmTmp(dir);
  }
});

// If the fallback reason is only in the job log, users who only read the PR comment cannot see the cause.
for (const name of ["AI-PR-SUMMARY", "AUTO-CHANGELOG-CONTROL"]) {
  for (const path of bothCopies(name)) {
    test(`${path}: the engine line and run summary include the fallback reason`, () => {
      const body = read(path);
      assert.ok(body.includes('.get("fallback_reason")'), "must read fallback_reason from the result JSON");
      assert.ok(body.includes("html.escape("), "must be escaped because it goes into comment HTML");
      assert.ok(body.includes('m wf_aisum.engine_label engine="$ENGINE_LINE" >> "$GITHUB_STEP_SUMMARY"'), "must also be recorded in the run summary");
      assert.match(body, /<sub>\$\(m wf_aisum\.engine_label engine="\$\{ENGINE[^}]*\}\$\{FALLBACK_REASON:\+ \(\$FALLBACK_REASON\)\}"\)<\/sub>|<sub>\$\(m wf_aisum\.engine_label engine="\$ENGINE_LINE"\)<\/sub>/, "the reason must be attached to the engine line of the PR comment");
    });
  }
}

// ---------------------------------------------------------------
// AI-PR-SUMMARY header: the expected version after merge, not the already-published current version
// ---------------------------------------------------------------
function expectedVersionSnippet() {
  const lines = read(payloadPath("AI-PR-SUMMARY")).split("\n").map((l) => l.replace(/^ {10}/, ""));
  const start = lines.findIndex((l) => l.startsWith("CURRENT_VERSION="));
  const end = lines.findIndex((l) => l.startsWith('echo "$(m wf_aisum.expected_version'));
  assert.ok(start > -1 && end > start, "could not find the expected-version calculation block");
  return lines.slice(start, end).join("\n") + '\nprintf "%s" "$VERSION"';
}

function runExpectedVersion(t, { mode, semverAuto, commits, withVersionYml = true }) {
  if (process.platform === "win32") {
    t.skip("the workflow shell snippet assumes bash on an ubuntu runner");
    return null;
  }
  const python = findPython();
  if (python !== "python3") {
    t.skip("the workflow snippet assumes the python3 command");
    return null;
  }
  const dir = mkdtempSync(join(tmpdir(), "paw-nextver-"));
  try {
    mkdirSync(join(dir, ".github", "scripts"), { recursive: true });
    for (const f of ["version_manager.py", "changelog_manager.py", "issue_helper.py", "messages.py"]) {
      writeFileSync(join(dir, ".github", "scripts", f), read(join("payload", "scripts", f)));
    }
    if (withVersionYml) {
      writeFileSync(join(dir, "version.yml"), [
        'version: "0.2.3"',
        "version_code: 1",
        'project_types: ["basic"]',
        "metadata:",
        "  template:",
        "    branches:",
        `      mode: "${mode}"`,
        "    options:",
        `      semver_auto: ${semverAuto}`,
        "",
      ].join("\n"));
    }
    writeFileSync(join(dir, "commits.txt"), commits.join("\n") + "\n");
    const r = spawnSync("bash", ["-e", "-c", expectedVersionSnippet()], {
      cwd: dir, encoding: "utf-8",
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1", AI_API_KEY: "should-not-be-used", COPILOT_AI: "true" },
    });
    assert.strictEqual(r.status, 0, r.stderr);
    return r.stdout;
  } finally {
    rmTmp(dir);
  }
}

test("AI-PR-SUMMARY: with trunk-based + semver_auto, the header shows the next version reflecting the commit bump level", (t) => {
  const v = runExpectedVersion(t, { mode: "trunk-based", semverAuto: true, commits: ["feat: new screen"] });
  if (v !== null) assert.strictEqual(v, "0.3.0");
});

test("AI-PR-SUMMARY: in pr-flow, a PR going straight to main uses the same next patch version as the safety net", (t) => {
  const v = runExpectedVersion(t, { mode: "pr-flow", semverAuto: true, commits: ["feat: new screen"] });
  if (v !== null) assert.strictEqual(v, "0.2.4");
});

test("AI-PR-SUMMARY: shows Unreleased when the version cannot be read", (t) => {
  const v = runExpectedVersion(t, { mode: "pr-flow", semverAuto: true, commits: ["fix: x"], withVersionYml: false });
  if (v !== null) assert.strictEqual(v, "Unreleased");
});

// ---------------------------------------------------------------
// Idempotency of reruns and queued runs: an already merged PR is not processed again, and the summary comment is replaced rather than accumulated.
// ---------------------------------------------------------------
for (const path of bothCopies("AUTO-CHANGELOG-CONTROL")) {
  test(`${path}: skips the pipeline if the PR was merged or closed at run time`, () => {
    const body = read(path);
    const pre = body.indexOf("\n  precheck:");
    const main = body.indexOf("\n  changelog-and-merge:");
    assert.ok(pre > -1 && main > pre, "a precheck job must precede changelog-and-merge");
    const preJob = body.slice(pre, main);
    assert.ok(preJob.includes("head.repo.full_name == github.repository"), "the precheck handles the fork and misfired-PR guard");
    assert.match(preJob, /gh pr view "\$PR_NUMBER" --json state/);
    assert.ok(preJob.includes('"$STATE" = "MERGED"'));
    const mainJob = body.slice(main, main + 400);
    assert.ok(mainJob.includes("needs: precheck"));
    assert.ok(mainJob.includes("if: needs.precheck.outputs.open == 'true'"));
  });

  test(`${path}: does not push the confirm commit if the PR was merged during a rerun`, () => {
    const body = read(path);
    const idx = body.indexOf("- name: Commit release docs to the PR head branch");
    const step = body.slice(idx, body.indexOf("- name: Enable automerge"));
    const guard = step.indexOf('if [ "$PR_STATE" = "MERGED" ]');
    assert.ok(guard > -1, "must re-check the PR state before pushing");
    assert.ok(guard < step.indexOf("git push origin"), "must check before the push");
  });
}

for (const name of ["AUTO-CHANGELOG-CONTROL", "AI-PR-SUMMARY"]) {
  for (const path of bothCopies(name)) {
    test(`${path}: the summary comment is found by marker and replaced, created only if absent`, () => {
      const body = read(path);
      assert.ok(body.includes('MARKER="<!-- project-auto-wizard:pr-summary -->"'));
      assert.ok(body.includes('echo "$MARKER"'), "the marker must go on the first line of the comment body");
      assert.ok(body.includes('select(.user.login == \\"github-actions[bot]\\"'), "must replace only this bot's comments");
      assert.match(body, /gh api -X PATCH "repos\/\$\{\{ github\.repository \}\}\/issues\/comments\/\$\{COMMENT_ID\}"/);
      assert.ok(!body.includes("-X POST \\\n               -d @comment_payload.json"), "a path that always posts a new comment remains");
    });
  }
}

// A merge right after pushing the confirm commit can fail intermittently due to GitHub propagation delay; one failure must not end the pipeline.
for (const path of bothCopies("AUTO-CHANGELOG-CONTROL")) {
  test(`${path}: auto-merge retries with backoff and updates the branch when out of date`, () => {
    const body = read(path);
    const idx = body.indexOf("- name: Enable automerge");
    const step = body.slice(idx, body.indexOf("\n  wait-for-merge-and-trigger-release:"));
    assert.match(step, /for ATTEMPT in \$\(seq 1 \$MAX_ATTEMPTS\)/, "missing retry loop");
    assert.ok(step.includes('sleep "$WAIT"'), "must wait between retries");
    assert.ok(step.includes('grep -qi "out of date"'));
    assert.ok(step.includes("/update-branch"), "a stale head must be updated from base");
    assert.ok(step.indexOf('= "MERGED"') < step.indexOf("gh pr merge"), "an already merged PR counts as success");
    assert.ok(step.includes("exit 1"), "a final failure must not pass as success");
  });
}

// ---------------------------------------------------------------
// Release after the safety net (direct push to main): back-merge into develop plus version/tag-based idempotency check
// ---------------------------------------------------------------
for (const path of bothCopies("VERSION-CONTROL")) {
  test(`${path}: back-merges into develop after pushing the safety-net bump`, () => {
    const body = read(path);
    const idx = body.indexOf("- name: Back-merge the safety-net bump into");
    assert.ok(idx > -1, "missing back-merge step");
    const step = body.slice(idx, body.indexOf("- name: Summary"));
    assert.ok(step.includes("steps.commit_push.outputs.pushed == 'true'"), "only when the bump was actually pushed");
    assert.match(step, /git merge --no-edit -m "chore\(version\): merge v\$\{NEW_VERSION\} safety-net bump into \$\{DEVELOP_BRANCH\} \[skip ci\]"/);
    assert.ok(step.includes('git push origin "HEAD:$DEVELOP_BRANCH"'));
    assert.ok(step.includes("git merge --abort"), "on conflict, clean up the working tree and only leave guidance");
    assert.ok(!/^\s+exit 1\s*$/m.test(step), "a back-merge failure must not fail the safety-net release");
  });
}

for (const path of bothCopies("AUTO-CHANGELOG-CONTROL")) {
  test(`${path}: if the merge fails due to a conflict, guides the develop back-merge`, () => {
    const body = read(path);
    assert.ok(body.includes('if [ "$MERGEABLE" = "CONFLICTING" ]; then'));
    // The error text now lives in the message catalog; the workflow only references its key.
    assert.match(body, /::error::\$\(m wf_changelog\.merge_conflict /);
    const say = (lang) => spawnSync("python3", [join("payload", "scripts", "messages.py"), "get", "wf_changelog.merge_conflict", "prod=main", "dev=develop"], {
      encoding: "utf-8", env: { ...process.env, PROJECT_AUTO_WIZARD_LANG: lang },
    }).stdout;
    assert.match(say("en"), /^The release PR conflicts with main/);
    assert.match(say("ko"), /^릴리스 PR이 main와 충돌합니다/);
  });
}

function bumpSnippet() {
  const body = read(payloadPath("AUTO-CHANGELOG-CONTROL"));
  const s = body.slice(body.indexOf("- name: Confirm release version"), body.indexOf("- name: Generate summary"));
  return s.slice(s.indexOf("run: |") + 7).split("\n").map((l) => l.replace(/^ {10}/, "")).join("\n")
    .replaceAll("{{MAIN_BRANCH}}", "main").replaceAll("{{DEVELOP_BRANCH}}", "develop")
    .replaceAll("${{ steps.semver_options.outputs.semver_auto }}", "true");
}

test("release PR version confirmation does not skip versions across reruns, extra pushes or back-merges of main", (t) => {
  if (process.platform === "win32") {
    t.skip("the workflow shell snippet assumes bash on an ubuntu runner");
    return;
  }
  if (findPython() !== "python3") {
    t.skip("the workflow snippet assumes the python3 command");
    return;
  }
  const root = mkdtempSync(join(tmpdir(), "paw-confirm-"));
  const work = join(root, "work");
  const env = { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1", AI_API_KEY: "", COPILOT_AI: "false", GIT_CONFIG_NOSYSTEM: "1", GITHUB_WORKSPACE: work };
  const run = (cmd, args, cwd = work) => {
    const r = spawnSync(cmd, args, { cwd, encoding: "utf-8", env });
    assert.strictEqual(r.status, 0, `${cmd} ${args.join(" ")}\n${r.stdout}\n${r.stderr}`);
    return r.stdout;
  };
  const git = (...args) => run("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args]);
  const version = () => read(join(work, "version.yml")).match(/^version: "([^"]+)"/m)[1];
  const confirm = () => {
    writeFileSync(join(work, "commits.txt"), git("log", "--pretty=%s", "origin/main..HEAD"));
    writeFileSync(join(work, "out.txt"), "");
    run("bash", ["-e", "-c", bumpSnippet()], work);
    rmSync(join(work, "commits.txt"));
    rmSync(join(work, "out.txt"));
    git("commit", "-q", "--allow-empty", "-am", `chore(version): confirm v${version()} and update release docs [skip ci]`);
    return version();
  };
  try {
    run("git", ["init", "-q", "--bare", join(root, "remote.git")], root);
    mkdirSync(join(work, ".github", "scripts"), { recursive: true });
    git("init", "-q");
    git("remote", "add", "origin", join(root, "remote.git"));
    for (const f of ["version_manager.py", "changelog_manager.py", "issue_helper.py", "messages.py"]) {
      writeFileSync(join(work, ".github", "scripts", f), read(join("payload", "scripts", f)));
    }
    writeFileSync(join(work, "version.yml"), 'version: "0.3.0"\nversion_code: 1\nproject_types: ["basic"]\n');
    git("add", ".");
    git("commit", "-q", "-m", "chore: init");
    git("push", "-q", "origin", "HEAD:main");
    git("tag", "v0.3.0");
    git("push", "-q", "origin", "v0.3.0");
    git("fetch", "-q", "origin");
    env.GITHUB_OUTPUT = join(work, "out.txt");

    git("commit", "-q", "--allow-empty", "-m", "fix: login error");
    assert.strictEqual(confirm(), "0.3.1", "first confirmation");
    assert.strictEqual(confirm(), "0.3.1", "a rerun does not bump again");

    git("commit", "-q", "--allow-empty", "-m", "fix: change added after confirmation");
    assert.strictEqual(confirm(), "0.3.1", "commits stacked on top of the confirm commit do not bump the unpublished version again");

    git("commit", "-q", "--allow-empty", "-m", "feat: feature added after confirmation");
    assert.strictEqual(confirm(), "0.4.0", "a feat after confirmation is recalculated against main (does not jump to 0.4.1)");

    // The next release after a release was merged into main and published
    git("push", "-q", "origin", "HEAD:main");
    git("tag", "v0.4.0");
    git("push", "-q", "origin", "v0.4.0");
    git("fetch", "-q", "origin");
    git("commit", "-q", "--allow-empty", "-m", "fix: change after publish");
    assert.strictEqual(confirm(), "0.4.1", "bumps fresh from the published version");
  } finally {
    rmTmp(root);
  }
});

// Build the CHANGELOG entry so safety-net release notes do not go out as a fixed phrase.
test("the VERSION-CONTROL safety-net path updates CHANGELOG from commits since the last tag and export emits that content", (t) => {
  if (process.platform === "win32") {
    t.skip("the workflow shell snippet assumes bash on an ubuntu runner");
    return;
  }
  if (findPython() !== "python3") {
    t.skip("the workflow snippet assumes the python3 command");
    return;
  }
  const body = read(payloadPath("VERSION-CONTROL"));
  const s = body.slice(body.indexOf("- name: Update CHANGELOG for the safety-net release"), body.indexOf("- name: Commit and push changes"));
  assert.ok(s.includes("if: steps.release_guard.outputs.skip != 'true'"));
  const snippet = s.slice(s.indexOf("run: |") + 7).split("\n").map((l) => l.replace(/^ {10}/, "")).join("\n")
    .replaceAll("{{MAIN_BRANCH}}", "main")
    .replaceAll("${{ steps.version.outputs.new_version }}", "0.3.1")
    .replaceAll("${{ steps.project_info.outputs.project_types }}", "node");

  const dir = mkdtempSync(join(tmpdir(), "paw-safety-"));
  const env = { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1", AI_API_KEY: "", COPILOT_AI: "false", GIT_CONFIG_NOSYSTEM: "1", GITHUB_WORKSPACE: dir };
  const run = (cmd, args) => {
    const r = spawnSync(cmd, args, { cwd: dir, encoding: "utf-8", env });
    assert.strictEqual(r.status, 0, `${cmd} ${args.join(" ")}\n${r.stdout}\n${r.stderr}`);
    return r.stdout;
  };
  const git = (...args) => run("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args]);
  try {
    mkdirSync(join(dir, ".github", "scripts"), { recursive: true });
    for (const f of ["version_manager.py", "changelog_manager.py", "issue_helper.py", "messages.py"]) {
      writeFileSync(join(dir, ".github", "scripts", f), read(join("payload", "scripts", f)));
    }
    git("init", "-q");
    git("commit", "-q", "--allow-empty", "-m", "feat: feature shipped in the previous release");
    git("tag", "v0.3.0");
    git("commit", "-q", "--allow-empty", "-m", "fix: direct hotfix on main");
    run("bash", ["-e", "-c", snippet]);

    const changelog = JSON.parse(read(join(dir, "CHANGELOG.json")));
    assert.strictEqual(changelog.releases[0].version, "0.3.1");
    assert.ok(read(join(dir, "CHANGELOG.md")).includes("## [0.3.1]"));
    for (const f of ["commits.txt", "summary.md", "pr_body.md"]) {
      assert.throws(() => readFileSync(join(dir, f)), `${f} working file was left behind`);
    }

    const notes = run("python3", [join(".github", "scripts", "changelog_manager.py"), "export", "--version", "0.3.1"]);
    assert.ok(notes.includes("direct hotfix on main"), `release notes lack the actual commit:\n${notes}`);
    assert.ok(!notes.includes("feature shipped in the previous release"), "a commit from before the last tag leaked in");
    assert.ok(!notes.includes("앱 안정성"), "fell back to the fixed phrase");
  } finally {
    rmTmp(dir);
  }
});

for (const path of bothCopies("VERSION-CONTROL")) {
  test(`${path}: the safety-net commit also stages a newly created CHANGELOG`, () => {
    const body = read(path);
    const idx = body.indexOf("- name: Commit and push changes");
    const step = body.slice(idx, idx + 1200);
    assert.ok(step.includes("git ls-files -z --others --exclude-standard -- CHANGELOG.json CHANGELOG.md"));
  });
}
