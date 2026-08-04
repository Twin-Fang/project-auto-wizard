// tests/node/mode-force-gate.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "../../src/index.js";

function withStubbedTTY(value, fn) {
  const original = process.stdout.isTTY;
  process.stdout.isTTY = value;
  return Promise.resolve(fn()).finally(() => { process.stdout.isTTY = original; });
}

test("run(): TTY 환경에서 --force 없이 full 모드를 실행하면 즉시 거부되고 아무 파일도 쓰지 않는다", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-tty-full-"));
  try {
    const code = await withStubbedTTY(true, () => run(["--mode", "full", "--type", "node"], { cwd: target }));
    assert.strictEqual(code, 1);
    assert.ok(!existsSync(join(target, "version.yml")), "TTY라도 --force 없이는 파일을 쓰면 안 됩니다");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): TTY 환경에서 --force 없이 revert 모드를 실행하면 즉시 거부된다", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-tty-revert-"));
  try {
    const code = await withStubbedTTY(true, () => run(["--mode", "revert"], { cwd: target }));
    assert.strictEqual(code, 1);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): TTY 환경이라도 --force가 있으면 full 모드가 정상 진행된다", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-tty-full-force-"));
  try {
    const code = await withStubbedTTY(true, () => run(["--mode", "full", "--force", "--type", "node"], { cwd: target }));
    assert.strictEqual(code, 0);
    assert.ok(existsSync(join(target, "version.yml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): 비TTY 환경에서 --force 없이 full 모드를 실행하면 여전히 거부된다 (기존 동작 회귀 방지)", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-non-tty-full-"));
  try {
    const code = await withStubbedTTY(false, () => run(["--mode", "full", "--type", "node"], { cwd: target }));
    assert.strictEqual(code, 1);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
