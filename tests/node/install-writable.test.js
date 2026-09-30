// tests/node/install-writable.test.js
// If the install target folder is not writable, stop with a readable error before writing anything.
import "../setup-lang.mjs"; // these tests assert the ko output
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "../../src/index.js";
import { resetLogger } from "../../src/core/logger.js";
import { findUnwritable } from "../../src/core/fsutil.js";

// Windows cannot block folder writes via chmod, and root bypasses permission checks.
const skip = process.platform === "win32" || process.getuid?.() === 0;

function springTarget() {
  const target = mkdtempSync(join(tmpdir(), "paw-writable-"));
  mkdirSync(join(target, "src/main/resources"), { recursive: true });
  writeFileSync(join(target, "src/main/resources/application.yaml"), "");
  writeFileSync(join(target, "build.gradle"), 'version = "0.0.1"\n');
  return target;
}

test("findUnwritable: empty list when everything is writable", () => {
  const target = springTarget();
  try {
    assert.deepStrictEqual(findUnwritable(target, [".", ".github/workflows", ".github/.wizard"], ["version.yml"]), []);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test(".github/.wizard is unwritable: writes nothing and exits with 1", { skip }, async () => {
  const target = springTarget();
  const wizard = join(target, ".github", ".wizard");
  mkdirSync(wizard, { recursive: true });
  chmodSync(wizard, 0o555);
  const errors = [];
  const origError = console.error;
  console.error = (...a) => errors.push(a.join(" "));
  try {
    resetLogger();
    const code = await run(["--mode", "full", "--force", "--type", "spring"], { cwd: target });
    assert.strictEqual(code, 1);
    assert.ok(errors.some((e) => /쓰기 권한이 없어 설치를 시작하지 않았습니다/.test(e) && e.includes(".github/.wizard")),
      "the blocked path must be reported in a human-readable way");
    assert.strictEqual(existsSync(join(target, ".github", "workflows")), false, "workflows must not be written first");
    assert.strictEqual(existsSync(join(target, "version.yml")), false, "version.yml must not be written first");
  } finally {
    console.error = origError;
    resetLogger();
    chmodSync(wizard, 0o755);
    rmSync(target, { recursive: true, force: true });
  }
});
