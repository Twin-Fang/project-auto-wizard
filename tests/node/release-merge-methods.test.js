// What each way of merging a release PR (release_automerge: false) does to the release, reproduced with real git history
// and the workflow's own gate and commit-collection snippets. Nothing here needs GitHub: the merge result of each method
// is built with git the way GitHub builds it (merge commit: PR title in the body; squash: PR title + the commit list;
// rebase: the PR commits replayed, the last one being the version-confirm commit).
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const PUBLISH = read("payload/workflows/common/PROJECT-COMMON-RELEASE-PUBLISH.yaml").replaceAll("{{MAIN_BRANCH}}", "main");
const CHANGELOG = read("payload/workflows/common/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml");

const CONFIRM = "chore(version): confirm v0.2.0 and update release docs [skip ci]";
const PR_TITLE = "chore(release): v0.2.0 (PR #5)";
const ENV = { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1", GIT_CONFIG_NOSYSTEM: "1", PROJECT_AUTO_WIZARD_LANG: "en" };

function gitIn(dir) {
  return (...args) => {
    const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...args],
      { cwd: dir, encoding: "utf-8", env: ENV });
    assert.strictEqual(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout;
  };
}

// A release PR worth of history: develop has two feature commits and the confirm commit on top of main.
function makeRepo() {
  const base = mkdtempSync(join(tmpdir(), "paw-merge-"));
  const origin = join(base, "origin.git");
  const work = join(base, "work");
  mkdirSync(work);
  const g0 = gitIn(base);
  g0("init", "-q", "--bare", origin);
  g0("clone", "-q", origin, work);
  const g = gitIn(work);
  const commitFile = (name, msg, more = []) => { writeFileSync(join(work, name), `${msg}\n`); g("add", name); g("commit", "-q", "-m", msg, ...more); };
  commitFile("base.txt", "chore: init");
  g("push", "-q", "origin", "HEAD:main");
  g("checkout", "-q", "-b", "develop");
  commitFile("a.txt", "feat: add a");
  commitFile("b.txt", "fix: repair b");
  commitFile("v.txt", CONFIRM);
  return { base, work, g };
}

// Applies one merge method on main and returns the resulting head commit message.
function mergeInto(repo, method) {
  const { g } = repo;
  g("checkout", "-q", "main");
  if (method === "merge") {
    g("merge", "-q", "--no-ff", "develop", "-m", "Merge pull request #5 from acme/develop", "-m", PR_TITLE);
  } else if (method === "squash") {
    g("merge", "-q", "--squash", "develop");
    g("commit", "-q", "-m", `${PR_TITLE} (#5)`, "-m", `* feat: add a\n\n* fix: repair b\n\n* ${CONFIRM}`);
  } else if (method === "rebase") {
    // A rebase merge replays the commits onto the current main; a main-only commit first keeps the replayed hashes different
    // from the originals (identical parent, tree and timestamp would otherwise reproduce the very same commits).
    writeFileSync(join(repo.work, "m.txt"), "m\n");
    g("add", "m.txt");
    g("commit", "-q", "-m", "chore: main-only");
    const commits = g("rev-list", "--reverse", "main..develop").trim().split("\n");
    for (const c of commits) g("cherry-pick", c);
  }
  return g("log", "-1", "--pretty=%B").trim();
}

// The release workflow's two checks: the job-level `[skip ci]` condition and the pr-flow gate step.
function publishes(work, headMessage) {
  const jobIf = PUBLISH.match(/^    if: "(.+)"$/m)?.[1];
  assert.strictEqual(jobIf, "!contains(github.event.head_commit.message, '[skip ci]')", "the job-level [skip ci] condition changed; update this test with it");
  const skipped = headMessage.includes("[skip ci]");
  const block = PUBLISH.match(/- name: Release gate[\s\S]*?(?=\n      - name: )/)[0];
  const script = block.split("        run: |\n")[1].split("\n").map((l) => l.replace(/^ {10}/, "")).join("\n")
    .replaceAll("${{ steps.mode.outputs.mode }}", "pr-flow").replaceAll("${{ github.event_name }}", "push");
  mkdirSync(join(work, ".github", "scripts"), { recursive: true });
  copyFileSync(join(ROOT, "payload/scripts/messages.py"), join(work, ".github", "scripts", "messages.py"));
  writeFileSync(join(work, "version.yml"), 'version: "0.2.0"\n');
  const out = join(work, "gh_output");
  writeFileSync(out, "");
  const r = spawnSync("bash", ["-e", "-c", script], {
    cwd: work, encoding: "utf-8",
    env: { ...ENV, GITHUB_WORKSPACE: work.replaceAll("\\", "/"), GITHUB_OUTPUT: out.replaceAll("\\", "/") },
  });
  assert.strictEqual(r.status, 0, r.stderr);
  const gate = readFileSync(out, "utf8").match(/^proceed=(.*)$/m)[1] === "true";
  return { skipped, gate, published: !skipped && gate };
}

const posix = process.platform !== "win32";
const maybe = posix ? test : test.skip;

maybe("merge commit: the release gate opens and no [skip ci] is in the message", () => {
  const repo = makeRepo();
  try {
    const head = mergeInto(repo, "merge");
    assert.deepStrictEqual(publishes(repo.work, head), { skipped: false, gate: true, published: true });
  } finally { rmSync(repo.base, { recursive: true, force: true }); }
});

maybe("squash merge: the gate would open but the [skip ci] of the confirm commit skips the push workflows", () => {
  const repo = makeRepo();
  try {
    const head = mergeInto(repo, "squash");
    assert.deepStrictEqual(publishes(repo.work, head), { skipped: true, gate: true, published: false });
  } finally { rmSync(repo.base, { recursive: true, force: true }); }
});

maybe("rebase merge: the head commit is the confirm commit, so it is skipped and the gate is closed", () => {
  const repo = makeRepo();
  try {
    const head = mergeInto(repo, "rebase");
    assert.deepStrictEqual(publishes(repo.work, head), { skipped: true, gate: false, published: false });
  } finally { rmSync(repo.base, { recursive: true, force: true }); }
});

// ── the next release's commit list ──────────────────────────────────────────────────────────────
function nextCommits(method, { backMerge = false } = {}) {
  const repo = makeRepo();
  try {
    mergeInto(repo, method);
    // The install summary tells users to merge the release branch back into develop after a release.
    if (backMerge) { repo.g("checkout", "-q", "develop"); repo.g("merge", "-q", "--no-edit", "main"); }
    repo.g("checkout", "-q", "develop");
    writeFileSync(join(repo.work, "c.txt"), "c\n");
    repo.g("add", "c.txt");
    repo.g("commit", "-q", "-m", "feat: add c");
    const lines = CHANGELOG.split("\n").map((l) => l.trim())
      .filter((l) => /^git log --cherry-pick --right-only --pretty=%s/.test(l) && l.includes("> commits.txt"))
      .map((l) => l.replaceAll("origin/{{MAIN_BRANCH}}", "main"));
    assert.strictEqual(lines.length, 1, "the collection line in AUTO-CHANGELOG-CONTROL changed; update this test with it");
    const r = spawnSync("bash", ["-e", "-c", lines[0]], { cwd: repo.work, encoding: "utf-8", env: ENV });
    assert.strictEqual(r.status, 0, r.stderr);
    return readFileSync(join(repo.work, "commits.txt"), "utf8").split("\n").filter(Boolean);
  } finally { rmSync(repo.base, { recursive: true, force: true }); }
}

maybe("next release notes after a merge commit list only the new commit", () => {
  assert.deepStrictEqual(nextCommits("merge"), ["feat: add c"]);
});

maybe("next release notes after a rebase merge do not list the rebased commits again", () => {
  assert.deepStrictEqual(nextCommits("rebase"), ["feat: add c"]);
});

// Known limit, kept visible: once develop merges main back, the rebased copies are on develop too and are listed again.
maybe("next release notes after a rebase merge list the rebased commits again once develop has merged main back (documented limit)", () => {
  const listed = nextCommits("rebase", { backMerge: true });
  assert.ok(listed.includes("feat: add c"));
  assert.ok(listed.includes("feat: add a") && listed.includes("fix: repair b"));
});

// Known limit, kept visible: a squash commit has no patch in common with the originals, so they are listed again.
maybe("next release notes after a squash merge still list the squashed commits (documented limit)", () => {
  const listed = nextCommits("squash");
  assert.ok(listed.includes("feat: add c"));
  assert.ok(listed.includes("feat: add a") && listed.includes("fix: repair b"));
});

// Both workflows that feed release notes use the same collection rule.
test("the release-PR collector drops patch-equivalent commits; the safety-net keeps its tag-based range", () => {
  // git describe only returns a tag reachable from HEAD, so a cherry-pick comparison there would always have an empty left side.
  const safety = read("payload/workflows/common/PROJECT-COMMON-VERSION-CONTROL.yaml");
  assert.match(safety, /LOG_RANGE="\$\{LAST_TAG:\+\$\{LAST_TAG\}\.\.\}HEAD"/);
  assert.ok(!safety.includes("--cherry-pick"));
  assert.match(CHANGELOG, /git log --cherry-pick --right-only --pretty=%s "origin\/\{\{MAIN_BRANCH\}\}\.\.\.HEAD" > commits\.txt/);
});
