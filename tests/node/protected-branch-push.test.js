// tests/node/protected-branch-push.test.js
// A push the remote rejects because of a branch protection rule (GH006 / GH013) is not a race: the retry loops of the
// workflows that commit as the bot must stop at the first rejection and say why, while a genuine race keeps retrying.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmTmp } from "../helpers/tmp.mjs";

const payloadPath = (n) => join("payload", "workflows", "common", `PROJECT-COMMON-${n}.yaml`);
const dogfoodPath = (n) => join(".github", "workflows", `PROJECT-COMMON-${n}.yaml`);
const read = (p) => readFileSync(p, "utf8");
const MARKED = ["RELEASE-PUBLISH", "VERSION-CONTROL", "README-VERSION-UPDATE"];

// The real shell code between the push-with-retry markers is what runs here
function extractLoop(name) {
  const text = read(payloadPath(name)).replaceAll("{{MAIN_BRANCH}}", "main");
  const a = text.indexOf("# >>> push-with-retry");
  const b = text.indexOf("# <<< push-with-retry");
  assert.ok(a > 0 && b > a, `${name}: push-with-retry markers are missing`);
  return text.slice(a, b).split("\n").map((l) => l.replace(/^ {0,14}/, "")).join("\n");
}

const sh = (cwd, cmd, env = {}) => spawnSync("bash", ["-c", cmd], { cwd, encoding: "utf-8", env: { ...process.env, ...env } });

// bare remote whose pre-receive hook rejects every push with the given message, and one clone holding a commit to push
function setup(rejection) {
  const root = mkdtempSync(join(tmpdir(), "paw-protected-"));
  const git = (cwd, args) => {
    const r = sh(cwd, `git ${args}`);
    assert.strictEqual(r.status, 0, `git ${args}: ${r.stderr}`);
  };
  git(root, "init -q --bare -b main remote.git");
  git(root, "clone -q remote.git work");
  const work = join(root, "work");
  git(work, "config user.email t@example.com");
  git(work, "config user.name t");
  writeFileSync(join(work, "version.yml"), 'version: "1.0.0"\n');
  git(work, "add -A");
  git(work, 'commit -q -m "chore: init"');
  git(work, "push -q origin HEAD:main");
  // the hook is installed after the seed push so only the loop's push is rejected
  const hook = join(root, "remote.git", "hooks", "pre-receive");
  writeFileSync(hook, `#!/bin/sh\necho "remote: error: ${rejection}" >&2\nexit 1\n`);
  chmodSync(hook, 0o755);
  writeFileSync(join(work, "version.yml"), 'version: "1.0.1"\n');
  git(work, 'commit -q -am "chore(version): release v1.0.1 docs [skip ci]"');
  return { root, work };
}

const STUB = 'm() { echo "$1"; }\nset -e\n';
const count = (text, needle) => text.split(needle).length - 1;

for (const name of MARKED) {
  for (const rejection of [
    "GH006: Protected branch update failed for refs/heads/main.",
    "GH013: Repository rule violations found for refs/heads/main.",
  ]) {
    test(`${name}: a rule rejection (${rejection.slice(0, 5)}) stops at the first push with the cause`, () => {
      const env = setup(rejection);
      try {
        const r = sh(env.work, `${STUB}VERSION=1.0.1\n${extractLoop(name)}\n`, { RUNNER_TEMP: env.root });
        const out = r.stdout + r.stderr;
        assert.notStrictEqual(r.status, 0, out);
        assert.strictEqual(count(out, "wf_common.push_attempt"), 1, "a rule rejection must not be retried");
        assert.match(out, /::error::wf_common\.push_protected/);
        assert.ok(!/wf_common\.push_gave_up|wf_common\.push_failed_syncing/.test(out), out);
        assert.match(out, new RegExp(rejection.slice(0, 5)), "the remote's own message stays visible in the log");
      } finally {
        rmTmp(env.root);
      }
    });
  }

  test(`${name}: a rejection that is not a rule is still retried and ends with the give-up message`, () => {
    const env = setup("some transient failure");
    try {
      const r = sh(env.work, `${STUB}VERSION=1.0.1\n${extractLoop(name)}\n`, { RUNNER_TEMP: env.root });
      const out = r.stdout + r.stderr;
      assert.notStrictEqual(r.status, 0, out);
      assert.strictEqual(count(out, "wf_common.push_attempt"), 5);
      assert.match(out, /wf_common\.push_gave_up/);
      assert.ok(!/push_protected/.test(out), out);
    } finally {
      rmTmp(env.root);
    }
  });
}

test("AUTO-CHANGELOG-CONTROL's push to the PR head branch also names a rule rejection instead of retrying", () => {
  for (const path of [payloadPath("AUTO-CHANGELOG-CONTROL"), dogfoodPath("AUTO-CHANGELOG-CONTROL")]) {
    const text = read(path);
    assert.match(text, /git push origin HEAD:\$HEAD_BRANCH 2> "\$PUSH_ERR"/);
    assert.match(text, /grep -qiE "GH006\|GH013\|protected branch\|repository rule violations" "\$PUSH_ERR"/);
    assert.match(text, /m wf_common\.push_protected branch="\$HEAD_BRANCH"/);
  }
});

test("the protected-branch message exists in both languages and names the options", () => {
  const messages = read("payload/scripts/messages.py");
  const lines = messages.split("\n").filter((l) => l.includes('"wf_common.push_protected"'));
  assert.strictEqual(lines.length, 2);
  for (const line of lines) {
    assert.match(line, /WORKFLOW_PAT/);
    assert.match(line, /trunk-based/);
  }
});
