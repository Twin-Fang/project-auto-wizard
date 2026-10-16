// tests/node/bot-commit-skip-ci.test.js
// Which bot commits carry [skip ci] (#398, #426). GitHub skips push and pull_request events whose head commit carries it.
// - The version-confirm commit keeps it: the bot pushes it to an open release PR, and without the marker GitHub queues
//   that PR's workflows for approval (seen on a real repo). Squash and rebase merges are published by
//   PROJECT-RELEASE-PR-MERGED instead.
// - The safety-net back-merge commit drops it: it lands on the development branch while no release PR is open, and as
//   that branch's head it would make GitHub skip the workflows of the release PR opened next.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (name) => readFileSync(join("payload", "workflows", "common", `PROJECT-COMMON-${name}.yaml`), "utf8");

// Commit messages written by `git commit -m "..."` / `git merge ... -m "..."` / COMMIT_MSG="..." in a workflow
function botMessages(name) {
  const text = read(name);
  return [...text.matchAll(/(?:git (?:commit|merge)[^\n]*?-m |COMMIT_MSG=)"((?:chore|docs)\([^)]+\): [^"]+)"/g)].map((m) => m[1]);
}

const find = (name, prefix) => {
  const hits = botMessages(name).filter((m) => m.startsWith(prefix));
  assert.strictEqual(hits.length, 1, `${name}: expected one bot commit starting with "${prefix}", found ${JSON.stringify(hits)}`);
  return hits[0];
};

test("the safety-net back-merge into the development branch carries no [skip ci]", () => {
  const message = find("VERSION-CONTROL", "chore(version): merge v");
  assert.ok(!message.includes("[skip ci]"), message);
});

test("the version-confirm commit and the release-branch-only bot commits keep [skip ci]", () => {
  const keep = [
    find("AUTO-CHANGELOG-CONTROL", "chore(version): confirm v"),
    find("VERSION-CONTROL", "chore(version): bump to v"),
    find("README-VERSION-UPDATE", "docs(readme): update version to v"),
    find("RELEASE-PUBLISH", "chore(version): release v"),
  ];
  for (const message of keep) assert.ok(message.includes("[skip ci]"), message);
});
