// tests/node/interactive-abort.test.js
// Ctrl+C during an interactive run must end immediately without installing, at any question (exit code 130).
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../src/index.js";

function withFakeTty(fn) {
  const { stdin, stdout, stderr } = process;
  const saved = {
    inTTY: stdin.isTTY, outTTY: stdout.isTTY, setRawMode: stdin.setRawMode,
    outWrite: stdout.write, errWrite: stderr.write,
  };
  stdin.isTTY = true;
  stdout.isTTY = true;
  stdin.setRawMode = () => stdin;
  // Swallow only screen output (strings) — let through the results (Buffer) the test runner sends via child-process stdout.
  stdout.write = (chunk, ...rest) => (typeof chunk === "string" ? true : saved.outWrite.call(stdout, chunk, ...rest));
  stderr.write = () => true;
  return Promise.resolve().then(fn).finally(() => {
    stdin.isTTY = saved.inTTY;
    stdout.isTTY = saved.outTTY;
    stdin.setRawMode = saved.setRawMode;
    stdout.write = saved.outWrite;
    stderr.write = saved.errWrite;
  });
}

const ctrlC = () => process.stdin.emit("keypress", "\x03", { name: "c", ctrl: true, sequence: "\x03" });
const enter = () => process.stdin.emit("keypress", "\r", { name: "return", sequence: "\r" });
const tick = () => new Promise((r) => setImmediate(r));

test("interactive: Ctrl+C at the first menu exits with 130 and creates no install files", { timeout: 5000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-abort-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "my-app", version: "1.0.0" }));
    await withFakeTty(async () => {
      const p = run([], { cwd: dir });
      await tick();
      ctrlC();
      assert.strictEqual(await p, 130);
    });
    assert.strictEqual(existsSync(join(dir, "version.yml")), false);
    assert.strictEqual(existsSync(join(dir, ".github", "workflows")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("interactive: Ctrl+C at a question after the confirmation screen exits with 130 instead of proceeding with defaults", { timeout: 5000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-abort-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "my-app", version: "1.0.0" }));
    await withFakeTty(async () => {
      const p = run([], { cwd: dir });
      // Choose mode, confirm type, press Enter through a few questions, then Ctrl+C
      for (let i = 0; i < 4; i++) { await tick(); enter(); }
      await tick();
      ctrlC();
      assert.strictEqual(await p, 130);
    });
    assert.strictEqual(existsSync(join(dir, "version.yml")), false);
    assert.strictEqual(existsSync(join(dir, ".github", "workflows")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
