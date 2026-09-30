// tests/node/readline-engine-color-guard.test.js
import { test } from "node:test";
import assert from "node:assert";
import { intro, note } from "../../src/ui/readline-engine.js";

// Keep color expectations independent of the runtime TERM (e.g. dumb on CI). Individual tests set TERM=dumb behavior themselves.
delete process.env.TERM;

function captureStdout(fn) {
  const original = process.stdout.write.bind(process.stdout);
  let output = "";
  process.stdout.write = (chunk) => { output += chunk; return true; };
  try { fn(); } finally { process.stdout.write = original; }
  return output;
}

function withStdoutTTY(isTTY, fn) {
  const original = process.stdout.isTTY;
  process.stdout.isTTY = isTTY;
  try { return fn(); } finally { process.stdout.isTTY = original; }
}

test("intro(): includes ANSI color codes on a TTY with NO_COLOR unset", () => {
  const originalNoColor = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  try {
    const output = withStdoutTTY(true, () => captureStdout(() => intro("test")));
    assert.ok(output.includes("\x1b["));
  } finally {
    if (originalNoColor !== undefined) process.env.NO_COLOR = originalNoColor;
  }
});

test("intro(): has no ANSI color codes with NO_COLOR=1 even on a TTY", () => {
  const originalNoColor = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  try {
    const output = withStdoutTTY(true, () => captureStdout(() => intro("test")));
    assert.ok(!output.includes("\x1b["));
    assert.ok(output.includes("test"));
  } finally {
    if (originalNoColor === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = originalNoColor;
  }
});

test("note(): has no ANSI color codes when not a TTY", () => {
  const originalNoColor = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  try {
    const output = withStdoutTTY(false, () => captureStdout(() => note("body", "title")));
    assert.ok(!output.includes("\x1b["));
  } finally {
    if (originalNoColor !== undefined) process.env.NO_COLOR = originalNoColor;
  }
});

test("TERM=dumb: emits no color, cursor-move or erase sequences at all", async () => {
  const { select, text } = await import("../../src/ui/readline-engine.js");
  const stdin = process.stdin;
  const saved = { isTTY: stdin.isTTY, setRawMode: stdin.setRawMode, outTTY: process.stdout.isTTY, NO_COLOR: process.env.NO_COLOR };
  delete process.env.NO_COLOR;
  process.env.TERM = "dumb";
  stdin.isTTY = true;
  stdin.setRawMode = () => stdin;
  process.stdout.isTTY = true;
  const original = process.stdout.write;
  let output = "";
  process.stdout.write = (chunk, ...rest) => (typeof chunk === "string" ? ((output += chunk), true) : original.call(process.stdout, chunk, ...rest));
  try {
    const p = select({ message: "m", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] });
    stdin.emit("keypress", undefined, { name: "down" });
    stdin.emit("keypress", "\r", { name: "return" });
    assert.strictEqual(await p, "b");
    const t = text({ message: "name", defaultValue: "d" });
    stdin.emit("keypress", "x", { name: "x" });
    stdin.emit("keypress", undefined, { name: "backspace" });
    stdin.emit("keypress", "y", { name: "y" });
    stdin.emit("keypress", "\r", { name: "return" });
    assert.strictEqual(await t, "y");
  } finally {
    process.stdout.write = original;
    stdin.isTTY = saved.isTTY;
    stdin.setRawMode = saved.setRawMode;
    process.stdout.isTTY = saved.outTTY;
    delete process.env.TERM;
    if (saved.NO_COLOR !== undefined) process.env.NO_COLOR = saved.NO_COLOR;
  }
  assert.ok(!output.includes("\x1b"), `ESC sequence leaked in: ${JSON.stringify(output.slice(0, 200))}`);
});
