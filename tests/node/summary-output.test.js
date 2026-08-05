// tests/node/summary-output.test.js
import { test } from "node:test";
import assert from "node:assert";
import { printSummary } from "../../src/ui/summary.js";

function captureStderr(fn) {
  const original = process.stderr.write.bind(process.stderr);
  let output = "";
  process.stderr.write = (chunk) => { output += chunk; return true; };
  try {
    fn();
  } finally {
    process.stderr.write = original;
  }
  return output;
}

test("printSummary: full 모드 + gitignoreUpdated:true -> .gitignore 줄 출력", () => {
  const output = captureStderr(() => {
    printSummary({ mode: "full", types: ["basic"], version: "1.0.0", gitignoreUpdated: true });
  });
  assert.ok(output.includes(".gitignore"));
});

test("printSummary: full 모드 + gitignoreUpdated:false(기본값) -> .gitignore 줄 없음", () => {
  const output = captureStderr(() => {
    printSummary({ mode: "full", types: ["basic"], version: "1.0.0" });
  });
  assert.ok(!output.includes(".gitignore"));
});

test("printSummary: version 모드는 .gitignore를 절대 언급하지 않는다", () => {
  const output = captureStderr(() => {
    printSummary({ mode: "version", types: ["basic"], version: "1.0.0" });
  });
  assert.ok(!output.includes(".gitignore"));
});

function withStderrTTY(isTTY, fn) {
  const original = process.stderr.isTTY;
  process.stderr.isTTY = isTTY;
  try { return fn(); } finally { process.stderr.isTTY = original; }
}

test("printSummary: TTY + NO_COLOR 미설정 -> ANSI 색상 코드 포함", () => {
  const originalNoColor = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  try {
    const output = withStderrTTY(true, () => captureStderr(() => {
      printSummary({ mode: "full", types: ["basic"], version: "1.0.0" });
    }));
    assert.ok(output.includes("\x1b["));
  } finally {
    if (originalNoColor !== undefined) process.env.NO_COLOR = originalNoColor;
  }
});

test("printSummary: NO_COLOR=1이면 TTY여도 ANSI 색상 코드가 전혀 섞이지 않는다", () => {
  const originalNoColor = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  try {
    const output = withStderrTTY(true, () => captureStderr(() => {
      printSummary({ mode: "full", types: ["basic"], version: "1.0.0" });
    }));
    assert.ok(!output.includes("\x1b["));
  } finally {
    if (originalNoColor === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = originalNoColor;
  }
});

test("printSummary: 비TTY면 NO_COLOR 미설정이어도 ANSI 색상 코드가 없다", () => {
  const originalNoColor = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  try {
    const output = withStderrTTY(false, () => captureStderr(() => {
      printSummary({ mode: "full", types: ["basic"], version: "1.0.0" });
    }));
    assert.ok(!output.includes("\x1b["));
  } finally {
    if (originalNoColor !== undefined) process.env.NO_COLOR = originalNoColor;
  }
});
