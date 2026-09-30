// tests/node/mode-force-gate.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "../../src/index.js";

function withStubbedTTY(value, fn) {
  const original = process.stdout.isTTY;
  process.stdout.isTTY = value;
  return Promise.resolve(fn()).finally(() => { process.stdout.isTTY = original; });
}

test("run(): running full mode without --force in a TTY is rejected immediately and writes no file", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-tty-full-"));
  try {
    const code = await withStubbedTTY(true, () => run(["--mode", "full", "--type", "node"], { cwd: target }));
    assert.strictEqual(code, 1);
    assert.ok(!existsSync(join(target, "version.yml")), "must not write files without --force even in a TTY");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});


test("run(): even in a TTY, full mode proceeds normally with --force", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-tty-full-force-"));
  writeFileSync(join(target, "package.json"), "{}\n"); // root marker to avoid zero path candidates
  try {
    const code = await withStubbedTTY(true, () => run(["--mode", "full", "--force", "--type", "node"], { cwd: target }));
    assert.strictEqual(code, 0);
    assert.ok(existsSync(join(target, "version.yml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});



test("run(): running full mode without --force in a non-TTY is still rejected (guards the existing behavior)", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-non-tty-full-"));
  try {
    const code = await withStubbedTTY(false, () => run(["--mode", "full", "--type", "node"], { cwd: target }));
    assert.strictEqual(code, 1);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
