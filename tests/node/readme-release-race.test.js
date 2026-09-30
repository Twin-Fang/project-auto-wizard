// tests/node/readme-release-race.test.js
// A README-only date refresh and a release commit rewrite the same README version line. The release
// must survive that race: the push loops rebase and retry, README conflicts are resolved, and the tag
// steps do not depend on a README push.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const payloadPath = (n) => join("payload", "workflows", "common", `PROJECT-COMMON-${n}.yaml`);
const dogfoodPath = (n) => join(".github", "workflows", `PROJECT-COMMON-${n}.yaml`);
const read = (p) => readFileSync(p, "utf8");
const COMMITTING = ["RELEASE-PUBLISH", "VERSION-CONTROL", "README-VERSION-UPDATE"];

// Pull the marked retry loop out of a workflow so the real shell code is what runs here
function extractLoop(name) {
  const text = read(payloadPath(name)).replaceAll("{{MAIN_BRANCH}}", "main");
  const a = text.indexOf("# >>> push-with-retry");
  const b = text.indexOf("# <<< push-with-retry");
  assert.ok(a > 0 && b > a, `${name}: push-with-retry markers are missing`);
  return text.slice(a, b).split("\n").map((l) => l.replace(/^ {0,14}/, "")).join("\n");
}

const sh = (cwd, cmd, env = {}) =>
  spawnSync("bash", ["-c", cmd], { cwd, encoding: "utf-8", env: { ...process.env, ...env } });

const README = (line) => `# my-app\n\n<!-- AUTO-VERSION-SECTION: DO NOT EDIT MANUALLY -->\n## Latest Version : ${line}\n\nbody\n`;

// bare remote + two clones, both carrying the version scripts the loop may call
function setup() {
  const root = mkdtempSync(join(tmpdir(), "paw-race-"));
  const git = (cwd, args) => {
    const r = sh(cwd, `git ${args}`);
    assert.strictEqual(r.status, 0, `git ${args}: ${r.stderr}`);
    return r.stdout;
  };
  git(root, "init -q --bare -b main remote.git");
  git(root, "clone -q remote.git seed");
  const seed = join(root, "seed");
  git(seed, "config user.email t@example.com");
  git(seed, "config user.name t");
  mkdirSync(join(seed, ".github", "scripts"), { recursive: true });
  for (const f of ["version_manager.py", "messages.py"]) copyFileSync(join("payload", "scripts", f), join(seed, ".github", "scripts", f));
  writeFileSync(join(seed, "version.yml"), 'version: "1.0.0"\n');
  writeFileSync(join(seed, "README.md"), README("v1.0.0 (2026-09-29)"));
  git(seed, "add -A");
  git(seed, 'commit -q -m "chore: init"');
  git(seed, "push -q origin HEAD:main");
  const clone = (name) => {
    git(root, `clone -q remote.git ${name}`);
    const dir = join(root, name);
    git(dir, "config user.email t@example.com");
    git(dir, "config user.name t");
    return dir;
  };
  return { root, git, releaser: clone("releaser"), readme: clone("readme") };
}

// README side pushes the date-only refresh first; the releaser then commits version + date on the same line
function raceReleaseAgainstDateRefresh(env) {
  env.git(env.readme, "checkout -q main");
  writeFileSync(join(env.readme, "README.md"), README("v1.0.0 (2026-09-30)"));
  env.git(env.readme, 'commit -q -am "docs(readme): update version to v1.0.0 [skip ci]"');
  env.git(env.readme, "push -q origin HEAD:main");

  writeFileSync(join(env.releaser, "version.yml"), 'version: "1.0.1"\n');
  writeFileSync(join(env.releaser, "README.md"), README("v1.0.1 (2026-09-30)"));
  env.git(env.releaser, 'commit -q -am "chore(version): release v1.0.1 docs [skip ci]"');
}

const STUB = 'm() { echo "$1"; }\nset -e\n';

// Loop as it was before the fix: a plain pull --rebase that gives up on the first conflict
const LEGACY_LOOP = `${STUB}
for i in 1 2 3; do
  git push origin HEAD:main && exit 0
  git pull --rebase origin main || { git rebase --abort; exit 1; }
done
exit 1
`;

test("race setup: the legacy pull --rebase loop fails on the README conflict", () => {
  const env = setup();
  try {
    raceReleaseAgainstDateRefresh(env);
    const r = sh(env.releaser, LEGACY_LOOP);
    assert.notStrictEqual(r.status, 0, "the legacy loop must fail to reproduce the conflict");
    assert.match(r.stdout + r.stderr, /CONFLICT \(content\): Merge conflict in README\.md/);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

for (const name of ["RELEASE-PUBLISH", "VERSION-CONTROL"]) {
  test(`${name}: the push loop resolves the README conflict, keeps the release and reapplies its version line`, () => {
    const env = setup();
    try {
      raceReleaseAgainstDateRefresh(env);
      const r = sh(env.releaser, `${STUB}${extractLoop(name)}\n`);
      assert.strictEqual(r.status, 0, `${r.stdout}\n${r.stderr}`);
      assert.match(r.stdout, /wf_common\.readme_conflict_resolved/);
      const remote = env.git(env.root, "--git-dir=remote.git show main:README.md");
      assert.match(remote, /v1\.0\.1 \(\d{4}-\d{2}-\d{2}\)/, "the released version must land in the README");
      assert.match(env.git(env.root, "--git-dir=remote.git show main:version.yml"), /1\.0\.1/);
      assert.strictEqual(env.git(env.root, "--git-dir=remote.git log -1 --pretty=%s main").trim(), "chore(version): release v1.0.1 docs [skip ci]");
    } finally {
      rmSync(env.root, { recursive: true, force: true });
    }
  });

  test(`${name}: an unrelated concurrent push is absorbed by fetch -> rebase -> push`, () => {
    const env = setup();
    try {
      env.git(env.readme, "checkout -q main");
      writeFileSync(join(env.readme, "other.txt"), "x\n");
      env.git(env.readme, "add other.txt");
      env.git(env.readme, 'commit -q -m "feat: other"');
      env.git(env.readme, "push -q origin HEAD:main");
      writeFileSync(join(env.releaser, "version.yml"), 'version: "1.0.1"\n');
      env.git(env.releaser, 'commit -q -am "chore(version): release v1.0.1 docs [skip ci]"');
      const r = sh(env.releaser, `${STUB}${extractLoop(name)}\n`);
      assert.strictEqual(r.status, 0, `${r.stdout}\n${r.stderr}`);
      assert.match(env.git(env.root, "--git-dir=remote.git log --pretty=%s main"), /feat: other/);
    } finally {
      rmSync(env.root, { recursive: true, force: true });
    }
  });
}

test("README-VERSION-UPDATE: a date refresh that lost the race to a release commit is skipped, not failed", () => {
  const env = setup();
  try {
    // this run read v1.0.0 and commits the date refresh...
    writeFileSync(join(env.readme, "README.md"), README("v1.0.0 (2026-09-30)"));
    env.git(env.readme, 'commit -q -am "docs(readme): update version to v1.0.0 [skip ci]"');
    // ...while a release commit already rewrote the same line on the remote
    writeFileSync(join(env.releaser, "version.yml"), 'version: "1.0.1"\n');
    writeFileSync(join(env.releaser, "README.md"), README("v1.0.1 (2026-09-30)"));
    env.git(env.releaser, 'commit -q -am "chore(version): release v1.0.1 docs [skip ci]"');
    env.git(env.releaser, "push -q origin HEAD:main");

    const r = sh(env.readme, `${STUB}VERSION=1.0.0\n${extractLoop("README-VERSION-UPDATE")}\n`);
    assert.strictEqual(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /wf_readme\.conflict_skip_stale/);
    assert.match(env.git(env.root, "--git-dir=remote.git show main:README.md"), /v1\.0\.1/);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test("README-VERSION-UPDATE: the same version already on the remote is skipped, not failed", () => {
  const env = setup();
  try {
    writeFileSync(join(env.readme, "README.md"), README("v1.0.0 (2026-09-30)"));
    env.git(env.readme, 'commit -q -am "docs(readme): update version to v1.0.0 [skip ci]"');
    // the remote README shows the same version with another date
    writeFileSync(join(env.releaser, "README.md"), README("v1.0.0 (2026-10-01)"));
    env.git(env.releaser, 'commit -q -am "docs(readme): update version to v1.0.0 [skip ci]"');
    env.git(env.releaser, "push -q origin HEAD:main");

    const r = sh(env.readme, `${STUB}VERSION=1.0.0\n${extractLoop("README-VERSION-UPDATE")}\n`);
    assert.strictEqual(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /wf_readme\.conflict_skip_same/);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

for (const name of COMMITTING) {
  for (const path of [payloadPath(name), dogfoodPath(name)]) {
    test(`${path}: serialised per workflow (concurrency group, no cancel) and retries fetch -> rebase -> push`, () => {
      const text = read(path);
      assert.match(text, /^concurrency:\n  group: \S+\n  cancel-in-progress: false$/m);
      assert.match(text, /MAX_RETRIES=5/);
      assert.match(text, /git fetch origin \S+\n\s+if git rebase origin\//);
      assert.ok(!/git pull --rebase/.test(text), "push loops must use fetch + rebase so conflicts can be inspected");
    });
  }
}

test("README-VERSION-UPDATE skips its push run in trunk-based mode", () => {
  for (const path of [payloadPath("README-VERSION-UPDATE"), dogfoodPath("README-VERSION-UPDATE")]) {
    const text = read(path);
    assert.match(text, /name: Detect branch mode/);
    assert.match(text, /\[ "\$MODE" = "trunk-based" \] && \[ "\$\{\{ github\.event_name \}\}" = "push" \]/);
    assert.match(text, /id: precheck\n\s+if: steps\.mode\.outputs\.skip != 'true'/);
  }
});

test("RELEASE-PUBLISH: tag and Release steps do not depend on a README step", () => {
  for (const path of [payloadPath("RELEASE-PUBLISH"), dogfoodPath("RELEASE-PUBLISH")]) {
    const text = read(path);
    for (const step of ["Create and push tag", "Create GitHub Release"]) {
      const i = text.indexOf(`- name: ${step}`);
      assert.ok(i > 0, `${step} step missing`);
      const cond = text.slice(i, text.indexOf("run:", i));
      assert.ok(!/readme/i.test(cond), `${step} must not be gated on README output`);
    }
    // the README dispatch runs after the Release exists and only warns when it cannot be woken
    assert.ok(text.indexOf("- name: Trigger README-VERSION-UPDATE") > text.indexOf("- name: Create GitHub Release"));
  }
});
