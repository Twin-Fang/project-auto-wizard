// Task 13 게이트 — 브랜치 구성 결정(순수) + develop 자동 생성(주입 exec) 검증.
import { test } from "node:test";
import assert from "node:assert";
import { resolveBranchConfig, ensureDevelopBranch, sortBranchesForSelection } from "../../src/core/branches.js";

// ── resolveBranchConfig (순수 함수) ────────────────────────────────
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

// ── ensureDevelopBranch (exec 주입 — git 호출 순서 검증) ───────────
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

// ── sortBranchesForSelection (순수 함수, 이슈 #85) ──────────────────
test("sortBranchesForSelection: def가 목록 중간에 있으면 맨 앞으로 온다", () => {
  const remote = ["20260810_feature", "develop", "main", "zzz-old"];
  const sorted = sortBranchesForSelection(remote, "main");
  assert.deepStrictEqual(sorted, ["main", "develop", "20260810_feature", "zzz-old"]);
});

test("sortBranchesForSelection: main/develop이 def와 다르면 def 다음 순서로 온다", () => {
  const remote = ["20260810_feature", "develop", "main", "zzz-old"];
  const sorted = sortBranchesForSelection(remote, "zzz-old");
  assert.deepStrictEqual(sorted, ["zzz-old", "main", "develop", "20260810_feature"]);
});

test("sortBranchesForSelection: priority 후보가 목록에 없으면 건너뛰고 나머지만 배치한다", () => {
  const remote = ["20260810_feature", "main"];
  const sorted = sortBranchesForSelection(remote, "main");
  assert.deepStrictEqual(sorted, ["main", "20260810_feature"]);
});

test("sortBranchesForSelection: 나머지 브랜치의 상대 순서는 원본 그대로 보존된다", () => {
  const remote = ["b-branch", "a-branch", "main", "c-branch"];
  const sorted = sortBranchesForSelection(remote, "main");
  assert.deepStrictEqual(sorted, ["main", "b-branch", "a-branch", "c-branch"]);
});

test("sortBranchesForSelection: def가 이미 priority에 포함되어도 중복 없이 한 번만 앞에 온다", () => {
  const remote = ["20260810_feature", "main", "develop"];
  const sorted = sortBranchesForSelection(remote, "develop");
  assert.deepStrictEqual(sorted, ["develop", "main", "20260810_feature"]);
});

test("sortBranchesForSelection: remoteBranches 원본 배열을 변경하지 않는다", () => {
  const remote = ["20260810_feature", "main"];
  const before = [...remote];
  sortBranchesForSelection(remote, "main");
  assert.deepStrictEqual(remote, before);
});

test("sortBranchesForSelection: def가 목록에 없어도 priority(main/develop) 정렬은 그대로 적용된다", () => {
  const remote = ["20260810_feature", "main"];
  const sorted = sortBranchesForSelection(remote, "new-branch");
  assert.deepStrictEqual(sorted, ["main", "20260810_feature"]);
});
