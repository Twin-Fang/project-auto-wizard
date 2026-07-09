// Task 13 게이트 — 브랜치 구성 결정(순수) + develop 자동 생성(주입 exec) 검증.
import { test } from "node:test";
import assert from "node:assert";
import { resolveBranchConfig, ensureDevelopBranch } from "../../src/core/branches.js";

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
