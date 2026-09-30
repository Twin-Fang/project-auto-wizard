// tests/node/interactive-branch-picker.test.js
// Verifies pickBranch() passes sorted options and initialIndex to select().
import "../setup-lang.mjs"; // these tests assert the ko output
import { test } from "node:test";
import assert from "node:assert";
import { pickBranch } from "../../src/commands/interactive.js";

const isCancel = () => false;

function stubSelectIo(returnValue) {
  const calls = [];
  return {
    io: {
      engineIo: {
        select: async (args) => { calls.push(args); return returnValue; },
      },
    },
    calls,
  };
}

test("pickBranch: even when def is in the middle of the list, it comes first in the sorted options and initialIndex points to it", async () => {
  const { io, calls } = stubSelectIo("main");
  const remoteBranches = ["20260810_feature", "develop", "main", "zzz-old"];
  const result = await pickBranch(io, "Select the release branch (default: main)", "main", remoteBranches, isCancel);

  assert.strictEqual(result, "main");
  assert.strictEqual(calls.length, 1);
  const { options, initialIndex } = calls[0];
  assert.strictEqual(options[initialIndex].value, "main", "the option initialIndex points to must be def (main)");
  assert.deepStrictEqual(
    options.map((o) => o.value),
    ["main", "develop", "20260810_feature", "zzz-old", "__custom__"],
  );
});

test("pickBranch: the cursor points to develop on the development branch prompt (def=develop) too", async () => {
  const { io, calls } = stubSelectIo("develop");
  const remoteBranches = ["20260810_feature", "develop", "main"];
  const result = await pickBranch(io, "Select the dev branch (default: develop)", "develop", remoteBranches, isCancel);

  assert.strictEqual(result, "develop");
  const { options, initialIndex } = calls[0];
  assert.strictEqual(options[initialIndex].value, "develop");
  assert.deepStrictEqual(
    options.map((o) => o.value),
    ["develop", "main", "20260810_feature", "__custom__"],
  );
});

test("pickBranch: when def is a new branch not on the remote, the placeholder comes first (index 0) and initialIndex is also 0", async () => {
  const { io, calls } = stubSelectIo("release");
  const remoteBranches = ["20260810_feature", "develop"];
  const result = await pickBranch(io, "Select the release branch (default: release)", "release", remoteBranches, isCancel);

  assert.strictEqual(result, "release");
  const { options, initialIndex } = calls[0];
  assert.strictEqual(initialIndex, 0);
  assert.strictEqual(options[0].value, "release");
  assert.strictEqual(options[0].label, "release (기본값 — 없으면 새로 생성)");
});

test("pickBranch: when the user picks another branch, that value is returned as is (sorting does not affect the selection)", async () => {
  const { io } = stubSelectIo("develop");
  const remoteBranches = ["20260810_feature", "develop", "main"];
  const result = await pickBranch(io, "Select the release branch (default: main)", "main", remoteBranches, isCancel);
  assert.strictEqual(result, "develop");
});

test("pickBranch: without engineIo.select (non-TTY), falls back to askText as before — regression check", async () => {
  const askTextCalls = [];
  const io = { askText: async (message, def) => { askTextCalls.push({ message, def }); return def; } };
  const result = await pickBranch(io, "Select the release branch (default: main)", "main", ["develop", "main"], isCancel);
  assert.strictEqual(result, "main");
  assert.strictEqual(askTextCalls.length, 1);
});
