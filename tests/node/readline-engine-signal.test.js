// tests/node/readline-engine-signal.test.js
// Regression: even when ended by an external signal (kill -INT, kill -TERM) while waiting for input, the cursor is restored and the abort path (PromptAbortError) is taken.
import { test } from "node:test";
import assert from "node:assert";
import * as engine from "../../src/ui/readline-engine.js";

// Pass the raw-mode entry condition (stdin.isTTY) and collect output for checking.
function withFakeTty(fn) {
  const stdin = process.stdin;
  const stdout = process.stdout;
  const originalIsTTY = stdin.isTTY;
  const originalSetRawMode = stdin.setRawMode;
  const originalWrite = stdout.write;
  const originalTerm = process.env.TERM;
  const out = [];
  stdin.isTTY = true;
  stdin.setRawMode = () => stdin;
  stdout.write = (s) => { out.push(String(s)); return true; };
  process.env.TERM = "xterm-256color";
  return Promise.resolve()
    .then(() => fn(out))
    .finally(() => {
      stdin.isTTY = originalIsTTY;
      stdin.setRawMode = originalSetRawMode;
      stdout.write = originalWrite;
      if (originalTerm === undefined) delete process.env.TERM; else process.env.TERM = originalTerm;
    });
}

const OPTIONS = [{ value: "a", label: "A" }, { value: "b", label: "B" }];

for (const sig of ["SIGINT", "SIGTERM"]) {
  test(`select(): ${sig} restores the cursor and aborts with PromptAbortError`, { timeout: 2000 }, async () => {
    await withFakeTty(async (out) => {
      const before = process.listenerCount(sig);
      const p = engine.select({ message: "Choose one", options: OPTIONS });
      assert.strictEqual(process.listenerCount(sig), before + 1, "handles the signal directly while waiting for input");
      process.emit(sig, sig);
      await assert.rejects(p, (e) => e instanceof engine.PromptAbortError && e.signal === sig);
      const joined = out.join("");
      assert.ok(joined.lastIndexOf("\x1b[?25h") > joined.lastIndexOf("\x1b[?25l"), "shows the hidden cursor again");
      assert.strictEqual(process.listenerCount(sig), before, "removes the signal listener when done");
    });
  });
}

test("text(): SIGINT aborts with PromptAbortError and leaves no listener", { timeout: 2000 }, async () => {
  await withFakeTty(async () => {
    const before = process.listenerCount("SIGINT");
    const p = engine.text({ message: "Enter a name", defaultValue: "my-app" });
    process.emit("SIGINT", "SIGINT");
    await assert.rejects(p, (e) => e instanceof engine.PromptAbortError && e.signal === "SIGINT");
    assert.strictEqual(process.listenerCount("SIGINT"), before);
  });
});

test("select(): no signal listener remains after a normal selection", async () => {
  await withFakeTty(async () => {
    const before = process.listenerCount("SIGINT");
    const p = engine.select({ message: "Choose one", options: OPTIONS });
    process.stdin.emit("keypress", "", { name: "return" });
    assert.strictEqual(await p, "a");
    assert.strictEqual(process.listenerCount("SIGINT"), before);
  });
});
