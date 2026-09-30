// tests/node/readline-engine-stdin-end.test.js
import { test } from "node:test";
import assert from "node:assert";
import * as engine from "../../src/ui/readline-engine.js";

// To pass the raw-mode entry condition (stdin.isTTY) of keySession()/text(), override
// process.stdin's isTTY/setRawMode only for the duration of the test. The stdin.on("end"/"keypress", ...) listeners are
// registered synchronously inside the Promise executor, so emitting right after the call is safe.
function withFakeTty(fn) {
  const stdin = process.stdin;
  const stdout = process.stdout;
  const originalIsTTY = stdin.isTTY;
  const originalSetRawMode = stdin.setRawMode;
  const originalWrite = stdout.write;
  stdin.isTTY = true;
  stdin.setRawMode = () => stdin;
  stdout.write = () => true; // keep rendering output from cluttering the test log
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      stdin.isTTY = originalIsTTY;
      stdin.setRawMode = originalSetRawMode;
      stdout.write = originalWrite;
    });
}

// A timeout is required: the pre-fix code had no "end" listener, so the Promise stayed pending forever,
// and without a timeout the whole node --test run hangs instead of failing. After the fix it resolves immediately
// and passes with room to spare.
// No more input can arrive after EOF, so this must abort rather than CANCEL (stay/default).
test("text(): aborts with PromptAbortError when stdin ends (EOF)", { timeout: 2000 }, async () => {
  await withFakeTty(async () => {
    const p = engine.text({ message: "이름을 입력하세요", defaultValue: "기본값" });
    process.stdin.emit("end");
    await assert.rejects(p, engine.PromptAbortError);
  });
});

test("select(): aborts with PromptAbortError when stdin ends (EOF)", { timeout: 2000 }, async () => {
  await withFakeTty(async () => {
    const p = engine.select({
      message: "선택하세요",
      options: [{ value: "a", label: "A" }, { value: "b", label: "B" }],
    });
    process.stdin.emit("end");
    await assert.rejects(p, engine.PromptAbortError);
  });
});

test("text(): after normal completion the 'end' listener is removed so listeners do not accumulate", async () => {
  await withFakeTty(async () => {
    const before = process.stdin.listenerCount("end");
    const p = engine.text({ message: "이름을 입력하세요", defaultValue: "기본값" });
    process.stdin.emit("keypress", "h", { name: "h" });
    process.stdin.emit("keypress", "i", { name: "i" });
    process.stdin.emit("keypress", "", { name: "return" });
    const result = await p;
    assert.strictEqual(result, "hi");
    assert.strictEqual(process.stdin.listenerCount("end"), before);
  });
});

test("text(): Ctrl+D arrives as a keypress in raw mode but is handled as an abort", async () => {
  await withFakeTty(async () => {
    const p = engine.text({ message: "이름을 입력하세요", defaultValue: "기본값" });
    process.stdin.emit("keypress", "", { name: "d", ctrl: true, sequence: "" });
    await assert.rejects(p, engine.PromptAbortError);
  });
});

test("select(): Ctrl+D is handled as an abort", async () => {
  await withFakeTty(async () => {
    const p = engine.select({
      message: "선택하세요",
      options: [{ value: "a", label: "A" }, { value: "b", label: "B" }],
    });
    process.stdin.emit("keypress", "", { name: "d", ctrl: true, sequence: "" });
    await assert.rejects(p, engine.PromptAbortError);
  });
});

// Ctrl+C must differ from ESC (pick default) — treating them the same would force the install onto the repo of a user who meant to abort.
for (const [name, call] of [
  ["select", () => engine.select({ message: "m", options: [{ value: "a", label: "A" }] })],
  ["multiselect", () => engine.multiselect({ message: "m", options: [{ value: "a", label: "A" }] })],
  ["confirm", () => engine.confirm({ message: "m" })],
  ["text", () => engine.text({ message: "m", defaultValue: "d" })],
]) {
  test(`${name}(): Ctrl+C is PromptAbortError, ESC is CANCEL`, async () => {
    await withFakeTty(async () => {
      const aborted = call();
      process.stdin.emit("keypress", "\x03", { name: "c", ctrl: true, sequence: "\x03" });
      await assert.rejects(aborted, engine.PromptAbortError);
      const escaped = call();
      process.stdin.emit("keypress", "\x1b", { name: "escape", sequence: "\x1b" });
      assert.strictEqual(await escaped, engine.CANCEL);
    });
  });
}
