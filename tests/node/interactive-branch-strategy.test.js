// tests/node/interactive-branch-strategy.test.js
// 이슈 #93 — 브랜치 전략(pr-flow/trunk-based)을 먼저 명시적으로 선택한 뒤,
// trunk-based면 개발 브랜치 질문을 생략하는지 검증한다.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInteractive } from "../../src/commands/interactive.js";

function stubIo({ strategy = "pr-flow", askTextAnswers = {} } = {}) {
  const askTextCalls = [];
  const noteCalls = [];
  const summaryCalls = [];
  const io = {
    selectMode: async () => "full",
    confirmProjectMenu: async () => "continue",
    confirmTypes: async ({ types }) => types,
    selectDeployStyle: async () => "simple",
    selectBranchStrategy: async () => strategy,
    askYesNo: async (_m, def) => def,
    askText: async (message, def) => {
      askTextCalls.push({ message, def });
      const hit = Object.entries(askTextAnswers).find(([key]) => message.includes(key));
      return hit ? hit[1] : def;
    },
    note: (text, title) => noteCalls.push({ text, title }),
    cancelMessage: () => {},
    summary: (ctx) => summaryCalls.push(ctx),
    outro: () => {},
  };
  return { io, askTextCalls, noteCalls, summaryCalls };
}

function tmpProject() {
  return mkdtempSync(join(tmpdir(), "paw-branch-strategy-"));
}

test("trunk-based 선택 시 개발 브랜치 질문이 생략되고 branches.mode가 trunk-based가 된다", async () => {
  const target = tmpProject();
  try {
    const { io, askTextCalls, noteCalls, summaryCalls } = stubIo({ strategy: "trunk-based" });
    const code = await runInteractive({}, { cwd: target, io });
    assert.strictEqual(code, 0);

    const branchQuestions = askTextCalls.filter((c) => c.message.includes("브랜치를 선택하세요"));
    assert.strictEqual(branchQuestions.length, 1, "trunk-based면 릴리스 브랜치 질문 1개만 나와야 한다");
    assert.ok(branchQuestions[0].message.includes("릴리스 브랜치"), "생략 없이 남는 질문은 릴리스 브랜치여야 한다");

    const { branches } = summaryCalls[0];
    assert.strictEqual(branches.mode, "trunk-based");
    assert.strictEqual(branches.main, branches.develop, "trunk-based는 main과 develop이 같아야 한다");

    const strategyNote = noteCalls.find((n) => n.title === "브랜치 전략");
    assert.ok(strategyNote, "trunk-based 안내 note가 떠야 한다");
    assert.ok(strategyNote.text.includes("trunk-based"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("pr-flow 선택 시 릴리스/개발 브랜치 질문이 각각 나오고 서로 다른 이름이면 branches.mode가 pr-flow가 된다", async () => {
  const target = tmpProject();
  try {
    const { io, askTextCalls, summaryCalls } = stubIo({
      strategy: "pr-flow",
      askTextAnswers: { "릴리스 브랜치": "main", "개발 브랜치": "develop" },
    });
    const code = await runInteractive({}, { cwd: target, io });
    assert.strictEqual(code, 0);

    const branchQuestions = askTextCalls.filter((c) => c.message.includes("브랜치를 선택하세요"));
    assert.strictEqual(branchQuestions.length, 2, "pr-flow면 릴리스+개발 두 질문이 나와야 한다");

    const { branches } = summaryCalls[0];
    assert.strictEqual(branches.mode, "pr-flow");
    assert.strictEqual(branches.main, "main");
    assert.strictEqual(branches.develop, "develop");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("전략 선택이 취소(ESC)되면 pr-flow로 폴백해 기존과 동일하게 두 질문이 나온다", async () => {
  const target = tmpProject();
  try {
    const { io, askTextCalls } = stubIo({ strategy: Symbol("cancel") });
    const code = await runInteractive({}, { cwd: target, io });
    assert.strictEqual(code, 0);

    const branchQuestions = askTextCalls.filter((c) => c.message.includes("브랜치를 선택하세요"));
    assert.strictEqual(branchQuestions.length, 2, "취소 시 pr-flow 폴백이므로 두 질문 모두 나와야 한다");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
