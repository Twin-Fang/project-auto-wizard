// tests/node/readline-engine-color-guard.test.js
import { test } from "node:test";
import assert from "node:assert";
import { intro, note } from "../../src/ui/readline-engine.js";

// 색상 기대값이 실행 환경의 TERM(CI의 dumb 등)에 흔들리지 않게 한다. TERM=dumb 동작은 개별 테스트가 직접 지정한다.
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

test("intro(): TTY + NO_COLOR 미설정이면 ANSI 색상 코드를 포함한다", () => {
  const originalNoColor = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  try {
    const output = withStdoutTTY(true, () => captureStdout(() => intro("테스트")));
    assert.ok(output.includes("\x1b["));
  } finally {
    if (originalNoColor !== undefined) process.env.NO_COLOR = originalNoColor;
  }
});

test("intro(): NO_COLOR=1이면 TTY여도 ANSI 색상 코드가 없다", () => {
  const originalNoColor = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  try {
    const output = withStdoutTTY(true, () => captureStdout(() => intro("테스트")));
    assert.ok(!output.includes("\x1b["));
    assert.ok(output.includes("테스트"));
  } finally {
    if (originalNoColor === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = originalNoColor;
  }
});

test("note(): 비TTY면 ANSI 색상 코드가 없다", () => {
  const originalNoColor = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  try {
    const output = withStdoutTTY(false, () => captureStdout(() => note("본문", "제목")));
    assert.ok(!output.includes("\x1b["));
  } finally {
    if (originalNoColor !== undefined) process.env.NO_COLOR = originalNoColor;
  }
});

test("TERM=dumb: 색상·커서 이동·지우기 시퀀스를 전혀 출력하지 않는다", async () => {
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
    const t = text({ message: "이름", defaultValue: "d" });
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
  assert.ok(!output.includes("\x1b"), `ESC 시퀀스가 섞였다: ${JSON.stringify(output.slice(0, 200))}`);
});
