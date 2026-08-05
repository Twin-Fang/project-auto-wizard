// tests/node/ansi-color-guard.test.js
import { test } from "node:test";
import assert from "node:assert";
import { colorEnabled, paint, A } from "../../src/ui/ansi.js";

test("colorEnabled: NO_COLOR가 설정되면 TTY 여부와 무관하게 false", () => {
  const original = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  try {
    assert.strictEqual(colorEnabled({ isTTY: true }), false);
  } finally {
    if (original === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = original;
  }
});

// no-color.org 규격: NO_COLOR는 "값과 무관하게 존재 여부"만 본다 — 빈 문자열도 설정된 것으로 취급해야 한다.
test("colorEnabled: NO_COLOR가 빈 문자열이어도(존재는 함) false", () => {
  const original = process.env.NO_COLOR;
  process.env.NO_COLOR = "";
  try {
    assert.strictEqual(colorEnabled({ isTTY: true }), false);
  } finally {
    if (original === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = original;
  }
});

test("colorEnabled: NO_COLOR 없고 스트림이 TTY면 true", () => {
  const original = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  try {
    assert.strictEqual(colorEnabled({ isTTY: true }), true);
  } finally {
    if (original !== undefined) process.env.NO_COLOR = original;
  }
});

test("colorEnabled: 비TTY 스트림이면 false", () => {
  const original = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  try {
    assert.strictEqual(colorEnabled({ isTTY: false }), false);
    assert.strictEqual(colorEnabled({}), false);
  } finally {
    if (original !== undefined) process.env.NO_COLOR = original;
  }
});

test("paint: enabled=false면 ANSI 코드 없이 원문 그대로 반환", () => {
  assert.strictEqual(paint("hello", A.green, false), "hello");
});

test("paint: enabled=true면 색상 코드로 감싼다", () => {
  assert.strictEqual(paint("hello", A.green, true), `${A.green}hello${A.reset}`);
});

// 이슈 #22 L2의 실제 재현 케이스(NO_COLOR=1 + `printBannerCompact` 출력에 ESC 바이트 혼입)를
// 그대로 회귀 테스트로 고정한다. banner.js 자체는 이 계획에서 수정하지 않지만, ansi.js의 paint()가
// 고쳐지면 banner.js도 무수정으로 함께 고쳐져야 한다.
test("printBannerCompact: NO_COLOR=1이면 TTY여도 ESC 바이트가 출력에 섞이지 않는다", async () => {
  const { printBannerCompact } = await import("../../src/ui/banner.js");
  const originalNoColor = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  try {
    let output = "";
    printBannerCompact({ version: "1.0.0", mode: "full" }, (s) => { output += s; });
    assert.ok(!output.includes("\x1b["));
    assert.ok(output.includes("project-auto-wizard"));
  } finally {
    if (originalNoColor === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = originalNoColor;
  }
});
