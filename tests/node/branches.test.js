// Gate: verifies branch config resolution (pure) and automatic develop creation (injected exec).
import { test } from "node:test";
import assert from "node:assert";
import { resolveBranchConfig, ensureDevelopBranch, sortBranchesForSelection } from "../../src/core/branches.js";

// ── resolveBranchConfig (pure function) ────────────────────────────────
test("resolveBranchConfig: defaults — detected default + develop, pr-flow", () => {
  const c = resolveBranchConfig({ defaultBranch: "main" });
  assert.deepStrictEqual(c, { main: "main", develop: "develop", mode: "pr-flow" });
});

test("resolveBranchConfig: same branch -> trunk-based", () => {
  const c = resolveBranchConfig({ mainBranch: "main", developBranch: "main", defaultBranch: "main" });
  assert.strictEqual(c.mode, "trunk-based");
  assert.strictEqual(c.main, "main");
  assert.strictEqual(c.develop, "main");
});

test("resolveBranchConfig: flags take precedence over detection", () => {
  const c = resolveBranchConfig({ mainBranch: "master", developBranch: "dev", defaultBranch: "main" });
  assert.deepStrictEqual(c, { main: "master", develop: "dev", mode: "pr-flow" });
});

test("resolveBranchConfig: no detection at all falls back to main/develop", () => {
  const c = resolveBranchConfig({});
  assert.deepStrictEqual(c, { main: "main", develop: "develop", mode: "pr-flow" });
});

// ── ensureDevelopBranch (injected exec — verifies git call order) ───────────
test("ensureDevelopBranch: no-op when the branch already exists on the remote", async () => {
  const calls = [];
  const exec = async (cmd, args) => { calls.push([cmd, ...args].join(" ")); return { code: 0 }; };
  const r = await ensureDevelopBranch({ develop: "develop", remoteBranches: ["main", "develop"], confirm: null, exec });
  assert.strictEqual(r.created, false);
  assert.strictEqual(calls.length, 0);
});

test("ensureDevelopBranch: creates then pushes when missing and confirmed", async () => {
  const calls = [];
  const exec = async (cmd, args) => { calls.push([cmd, ...args].join(" ")); return { code: 0 }; };
  const r = await ensureDevelopBranch({ develop: "develop", remoteBranches: ["main"], confirm: async () => true, exec });
  assert.strictEqual(r.created, true);
  assert.deepStrictEqual(calls, ["git branch develop", "git push -u origin develop"]);
});

test("ensureDevelopBranch: confirm=null (force) auto-creates without asking", async () => {
  const calls = [];
  const exec = async (cmd, args) => { calls.push([cmd, ...args].join(" ")); return { code: 0 }; };
  const r = await ensureDevelopBranch({ develop: "dev", remoteBranches: [], confirm: null, exec });
  assert.strictEqual(r.created, true);
  assert.deepStrictEqual(calls, ["git branch dev", "git push -u origin dev"]);
});

test("ensureDevelopBranch: declined confirm -> skipped, no git calls", async () => {
  const calls = [];
  const exec = async (cmd, args) => { calls.push([cmd, ...args].join(" ")); return { code: 0 }; };
  const r = await ensureDevelopBranch({ develop: "develop", remoteBranches: [], confirm: async () => false, exec });
  assert.strictEqual(r.created, false);
  assert.strictEqual(r.skipped, true);
  assert.strictEqual(calls.length, 0);
});

test("ensureDevelopBranch: push failure is reported, not thrown", async () => {
  const exec = async (cmd, args) => ({ code: args[0] === "push" ? 1 : 0, stderr: "no remote" });
  const r = await ensureDevelopBranch({ develop: "develop", remoteBranches: [], confirm: null, exec });
  assert.strictEqual(r.created, true);
  assert.strictEqual(r.pushed, false);
});

// ── sortBranchesForSelection (pure function) ──────────────────
test("sortBranchesForSelection: def in the middle of the list moves to the front", () => {
  const remote = ["20260810_feature", "develop", "main", "zzz-old"];
  const sorted = sortBranchesForSelection(remote, "main");
  assert.deepStrictEqual(sorted, ["main", "develop", "20260810_feature", "zzz-old"]);
});

test("sortBranchesForSelection: main/develop that differ from def come right after def", () => {
  const remote = ["20260810_feature", "develop", "main", "zzz-old"];
  const sorted = sortBranchesForSelection(remote, "zzz-old");
  assert.deepStrictEqual(sorted, ["zzz-old", "main", "develop", "20260810_feature"]);
});

test("sortBranchesForSelection: priority candidates missing from the list are skipped and only the rest are placed", () => {
  const remote = ["20260810_feature", "main"];
  const sorted = sortBranchesForSelection(remote, "main");
  assert.deepStrictEqual(sorted, ["main", "20260810_feature"]);
});

test("sortBranchesForSelection: the relative order of the remaining branches is preserved", () => {
  const remote = ["b-branch", "a-branch", "main", "c-branch"];
  const sorted = sortBranchesForSelection(remote, "main");
  assert.deepStrictEqual(sorted, ["main", "b-branch", "a-branch", "c-branch"]);
});

test("sortBranchesForSelection: even if def is already in priority, it appears once at the front without duplication", () => {
  const remote = ["20260810_feature", "main", "develop"];
  const sorted = sortBranchesForSelection(remote, "develop");
  assert.deepStrictEqual(sorted, ["develop", "main", "20260810_feature"]);
});

test("sortBranchesForSelection: does not mutate the original remoteBranches array", () => {
  const remote = ["20260810_feature", "main"];
  const before = [...remote];
  sortBranchesForSelection(remote, "main");
  assert.deepStrictEqual(remote, before);
});

test("sortBranchesForSelection: priority (main/develop) ordering still applies even when def is not in the list", () => {
  const remote = ["20260810_feature", "main"];
  const sorted = sortBranchesForSelection(remote, "new-branch");
  assert.deepStrictEqual(sorted, ["main", "20260810_feature"]);
});
