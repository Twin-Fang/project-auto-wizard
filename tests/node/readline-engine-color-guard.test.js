// tests/node/readline-engine-color-guard.test.js
import { test } from "node:test";
import assert from "node:assert";
import { intro, note } from "../../src/ui/readline-engine.js";

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
