// tests/node/interactive-branch-strategy.test.js
// Verify that after explicitly choosing the branch strategy (pr-flow/trunk-based),
// trunk-based skips the development branch question.
import "../setup-lang.mjs"; // these tests assert the ko output
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

test("choosing trunk-based skips the dev branch question and sets branches.mode to trunk-based", async () => {
  const target = tmpProject();
  try {
    const { io, askTextCalls, noteCalls, summaryCalls } = stubIo({ strategy: "trunk-based" });
    const code = await runInteractive({}, { cwd: target, io });
    assert.strictEqual(code, 0);

    const branchQuestions = askTextCalls.filter((c) => c.message.includes("브랜치를 선택하세요"));
    assert.strictEqual(branchQuestions.length, 1, "trunk-based must ask only the one release branch question");
    assert.ok(branchQuestions[0].message.includes("릴리스 브랜치"), "the question that remains must be the release branch");

    const { branches } = summaryCalls[0];
    assert.strictEqual(branches.mode, "trunk-based");
    assert.strictEqual(branches.main, branches.develop, "trunk-based requires main and develop to be the same");

    const strategyNote = noteCalls.find((n) => n.title === "브랜치 모드");
    assert.ok(strategyNote, "the trunk-based guidance note must appear");
    assert.ok(strategyNote.text.includes("trunk-based"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("choosing pr-flow asks release and dev branch questions separately, and distinct names set branches.mode to pr-flow", async () => {
  const target = tmpProject();
  try {
    const { io, askTextCalls, summaryCalls } = stubIo({
      strategy: "pr-flow",
      askTextAnswers: { "릴리스 브랜치": "main", "개발 브랜치": "develop" },
    });
    const code = await runInteractive({}, { cwd: target, io });
    assert.strictEqual(code, 0);

    const branchQuestions = askTextCalls.filter((c) => c.message.includes("브랜치를 선택하세요"));
    assert.strictEqual(branchQuestions.length, 2, "pr-flow must ask both release and dev questions");

    const { branches } = summaryCalls[0];
    assert.strictEqual(branches.mode, "pr-flow");
    assert.strictEqual(branches.main, "main");
    assert.strictEqual(branches.develop, "develop");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("cancelling (ESC) the strategy falls back to pr-flow and asks the same two questions as before", async () => {
  const target = tmpProject();
  try {
    const { io, askTextCalls } = stubIo({ strategy: Symbol("cancel") });
    const code = await runInteractive({}, { cwd: target, io });
    assert.strictEqual(code, 0);

    const branchQuestions = askTextCalls.filter((c) => c.message.includes("브랜치를 선택하세요"));
    assert.strictEqual(branchQuestions.length, 2, "cancel falls back to pr-flow, so both questions must appear");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("pr-flow with no remote: says develop was not created and passes developMissing to the summary", async () => {
  const target = tmpProject();
  try {
    const { io, noteCalls, summaryCalls } = stubIo({ strategy: "pr-flow" });
    const code = await runInteractive({}, { cwd: target, io });
    assert.strictEqual(code, 0);
    const notice = noteCalls.find((n) => n.title === "브랜치" && n.text.includes("git push origin main:develop"));
    assert.ok(notice, "the note explaining how to create develop must appear");
    assert.strictEqual(summaryCalls[0].developMissing, true);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("branch input: trims surrounding whitespace, uses the default for blank, re-asks for an unusable name", async () => {
  const target = tmpProject();
  try {
    const answers = { "릴리스 브랜치": ["   "], "개발 브랜치": ["dev branch", " dev "] };
    const { io, noteCalls, summaryCalls } = stubIo({ strategy: "pr-flow" });
    io.askText = async (message, def) => {
      const key = Object.keys(answers).find((k) => message.includes(k));
      return key && answers[key].length ? answers[key].shift() : def;
    };
    const code = await runInteractive({}, { cwd: target, io });
    assert.strictEqual(code, 0);
    const { branches } = summaryCalls[0];
    assert.strictEqual(branches.main, "main");
    assert.strictEqual(branches.develop, "dev");
    assert.ok(noteCalls.some((n) => n.text.includes("'dev branch'")), "must report the invalid name");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
