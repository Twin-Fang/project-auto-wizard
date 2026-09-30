// tests/node/readline-engine-wrap.test.js
// Lines that wrap past the terminal width must also leave only one copy after a redraw.
import { test } from "node:test";
import assert from "node:assert";
import * as engine from "../../src/ui/readline-engine.js";
import { printBanner } from "../../src/ui/banner.js";

delete process.env.TERM;

function withFakeTty(columns, fn) {
  const { stdin, stdout } = process;
  const saved = { isTTY: stdin.isTTY, setRawMode: stdin.setRawMode, columns: stdout.columns, write: stdout.write };
  stdin.isTTY = true;
  stdin.setRawMode = () => stdin;
  stdout.columns = columns;
  let output = "";
  stdout.write = (chunk, ...rest) => (typeof chunk === "string" ? ((output += chunk), true) : saved.write.call(stdout, chunk, ...rest));
  return Promise.resolve().then(fn).then(() => output).finally(() => {
    stdin.isTTY = saved.isTTY;
    stdin.setRawMode = saved.setRawMode;
    stdout.columns = saved.columns;
    stdout.write = saved.write;
  });
}

test("physicalRows: a line wider than the terminal counts its wrapped rows (Hangul is 2 columns wide)", () => {
  assert.strictEqual(engine.physicalRows("a".repeat(80), 80), 1);
  assert.strictEqual(engine.physicalRows("a".repeat(81), 80), 2);
  assert.strictEqual(engine.physicalRows("가".repeat(50), 80), 2);
  assert.strictEqual(engine.physicalRows("", 80), 1);
  assert.strictEqual(engine.physicalRows("abc", undefined), 1);
});

test("select(): on redraw, moves up including the wrapped rows", async () => {
  const long = "x".repeat(90); // wraps to 3 rows at 40 columns
  const out = await withFakeTty(40, async () => {
    const p = engine.select({ message: "m", options: [{ value: "a", label: long }, { value: "b", label: "B" }] });
    process.stdin.emit("keypress", undefined, { name: "down" });
    process.stdin.emit("keypress", "\r", { name: "return" });
    await p;
  });
  const ups = [...out.matchAll(/\x1b\[(\d+)A/g)].map((m) => Number(m[1]));
  // First screen: empty bar, question, long option (3 rows), B, hint (wrapping depends on width) — must exceed the logical line count (5)
  assert.ok(ups.length >= 1);
  assert.ok(ups[0] > 5, `wrapped rows were not counted: ${ups[0]}`);
});

test("text(): on redraw of a long prompt, moves up to the first wrapped row and erases", async () => {
  const out = await withFakeTty(40, async () => {
    const p = engine.text({ message: "y".repeat(60), defaultValue: "" });
    process.stdin.emit("keypress", "a", { name: "a" });
    process.stdin.emit("keypress", "\r", { name: "return" });
    await p;
  });
  assert.match(out, /\r\x1b\[1A\x1b\[0J/);
});

test("printBanner: does not draw the box border in a terminal narrower than the box", () => {
  let narrow = "";
  printBanner({ version: "1.0.0", modeLabel: "m" }, (s) => { narrow += s; }, 40);
  assert.ok(!narrow.includes("╔"));
  let wide = "";
  printBanner({ version: "1.0.0", modeLabel: "m" }, (s) => { wide += s; }, 120);
  assert.ok(wide.includes("╔"));
});
