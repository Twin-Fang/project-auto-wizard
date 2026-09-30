// tests/node/interactive-mode-status-doctor.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { runInteractive } from "../../src/commands/interactive.js";

function installFixture() {
  const target = mkdtempSync(join(tmpdir(), "paw-interactive-status-"));
  const ctx = createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(),
    now: "2026-08-05 00:00:00", today: "2026-08-05", templateVersion: "0.1.0",
  });
  runFull(ctx, resolvePayloadRoot(), target);
  return target;
}

async function captureConsoleLogAsync(fn) {
  const original = console.log;
  let output = "";
  console.log = (s = "") => { output += String(s) + "\n"; };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return output;
}

// Read-only modes return to the menu, so the stub must not return the same value every time (infinite loop).
// It answers in a fixed order and returns null (cancel) when the script ends, breaking out of the loop.
function scriptedSelectMode(...modes) {
  const calls = [];
  const fn = async (opts) => {
    calls.push(opts);
    return calls.length <= modes.length ? modes[calls.length - 1] : null;
  };
  fn.calls = calls;
  return fn;
}

test("runInteractive: choosing status mode prints the install state and returns to the menu", async () => {
  const target = installFixture();
  try {
    let code;
    const selectMode = scriptedSelectMode("status");
    const io = { selectMode, cancelMessage: () => {}, outro: () => {} };
    const output = await captureConsoleLogAsync(async () => {
      code = await runInteractive({}, { cwd: target, io });
    });
    assert.strictEqual(code, 0);
    assert.ok(output.includes("project-auto-wizard status"));
    assert.ok(output.includes("1.0.0"));
    // The menu must appear once more after printing results (cancel on the second call, then exit).
    assert.strictEqual(selectMode.calls.length, 2);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("runInteractive: choosing doctor mode prints the environment diagnosis and returns to the menu", async () => {
  const target = installFixture();
  try {
    let code;
    const selectMode = scriptedSelectMode("doctor");
    const io = { selectMode, cancelMessage: () => {}, outro: () => {} };
    const output = await captureConsoleLogAsync(async () => {
      code = await runInteractive({}, { cwd: target, io });
    });
    assert.strictEqual(code, 0);
    assert.ok(output.includes("project-auto-wizard doctor"));
    assert.strictEqual(selectMode.calls.length, 2);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// Running the diagnosis repeatedly is normal use: it must keep returning to the menu with no limit.
test("runInteractive: choosing read-only modes back to back returns to the menu every time", async () => {
  const target = installFixture();
  try {
    const selectMode = scriptedSelectMode("doctor", "status", "doctor");
    const io = { selectMode, cancelMessage: () => {}, outro: () => {} };
    const code = await captureConsoleLogAsync(async () => runInteractive({}, { cwd: target, io }))
      .then(() => 0);
    assert.strictEqual(code, 0);
    assert.strictEqual(selectMode.calls.length, 4); // 3 runs + 1 call that exited via cancel
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// On re-entry it must ask "what next?" rather than "what to install?".
test("runInteractive: the again flag is passed on menu re-entry", async () => {
  const target = installFixture();
  try {
    const selectMode = scriptedSelectMode("doctor");
    const io = { selectMode, cancelMessage: () => {}, outro: () => {} };
    await captureConsoleLogAsync(async () => runInteractive({}, { cwd: target, io }));
    assert.strictEqual(selectMode.calls[0]?.again, false);
    assert.strictEqual(selectMode.calls[1]?.again, true);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// Cancelling on the first screen must exit without re-showing the menu (the return loop must not swallow the cancel).
test("runInteractive: cancelling at the first menu exits immediately", async () => {
  const target = installFixture();
  try {
    const selectMode = scriptedSelectMode();
    let cancelled = false;
    const io = { selectMode, cancelMessage: () => { cancelled = true; }, outro: () => {} };
    const code = await runInteractive({}, { cwd: target, io });
    assert.strictEqual(code, 0);
    assert.ok(cancelled);
    assert.strictEqual(selectMode.calls.length, 1);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
