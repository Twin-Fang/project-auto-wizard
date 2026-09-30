// tests/node/ansi-color-guard.test.js
import { test } from "node:test";
import assert from "node:assert";
import { colorEnabled, paint, A } from "../../src/ui/ansi.js";

// Keep color expectations independent of the runtime TERM (e.g. dumb on CI). TERM=dumb behavior is set explicitly by individual tests.
delete process.env.TERM;

test("colorEnabled: false when NO_COLOR is set, regardless of TTY", () => {
  const original = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  try {
    assert.strictEqual(colorEnabled({ isTTY: true }), false);
  } finally {
    if (original === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = original;
  }
});

// no-color.org spec: NO_COLOR is checked for "presence regardless of value" — an empty string counts as set.
test("colorEnabled: false even when NO_COLOR is an empty string (present)", () => {
  const original = process.env.NO_COLOR;
  process.env.NO_COLOR = "";
  try {
    assert.strictEqual(colorEnabled({ isTTY: true }), false);
  } finally {
    if (original === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = original;
  }
});

test("colorEnabled: true when NO_COLOR is absent and the stream is a TTY", () => {
  const original = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  try {
    assert.strictEqual(colorEnabled({ isTTY: true }), true);
  } finally {
    if (original !== undefined) process.env.NO_COLOR = original;
  }
});

test("colorEnabled: false for a non-TTY stream", () => {
  const original = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  try {
    assert.strictEqual(colorEnabled({ isTTY: false }), false);
    assert.strictEqual(colorEnabled({}), false);
  } finally {
    if (original !== undefined) process.env.NO_COLOR = original;
  }
});

test("paint: with enabled=false returns the text as is without ANSI codes", () => {
  assert.strictEqual(paint("hello", A.green, false), "hello");
});

test("paint: with enabled=true wraps the text in color codes", () => {
  assert.strictEqual(paint("hello", A.green, true), `${A.green}hello${A.reset}`);
});

// Pins the real reproduction case (NO_COLOR=1 + ESC bytes leaking into `printBannerCompact` output)
// as a regression test. banner.js itself is not modified here, but once paint() in ansi.js
// is fixed, banner.js must be fixed with it without changes.
test("printBannerCompact: with NO_COLOR=1 no ESC bytes leak into the output even on a TTY", async () => {
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

test("colorEnabled: false for TERM=dumb even on a TTY", () => {
  const original = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  process.env.TERM = "dumb";
  try {
    assert.strictEqual(colorEnabled({ isTTY: true }), false);
  } finally {
    delete process.env.TERM;
    if (original !== undefined) process.env.NO_COLOR = original;
  }
});
