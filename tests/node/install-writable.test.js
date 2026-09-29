// tests/node/install-writable.test.js
// 설치 대상 폴더에 쓸 수 없으면 아무것도 쓰기 전에 읽을 수 있는 에러로 멈춰야 한다.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "../../src/index.js";
import { resetLogger } from "../../src/core/logger.js";
import { findUnwritable } from "../../src/core/fsutil.js";

// Windows는 폴더 쓰기 권한을 chmod로 막을 수 없고, root는 권한 검사를 우회한다.
const skip = process.platform === "win32" || process.getuid?.() === 0;

function springTarget() {
  const target = mkdtempSync(join(tmpdir(), "paw-writable-"));
  mkdirSync(join(target, "src/main/resources"), { recursive: true });
  writeFileSync(join(target, "src/main/resources/application.yaml"), "");
  writeFileSync(join(target, "build.gradle"), 'version = "0.0.1"\n');
  return target;
}

test("findUnwritable: 모두 쓸 수 있으면 빈 목록", () => {
  const target = springTarget();
  try {
    assert.deepStrictEqual(findUnwritable(target, [".", ".github/workflows", ".github/.wizard"], ["version.yml"]), []);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test(".github/.wizard에 쓸 수 없으면 아무 파일도 쓰지 않고 exit 1로 끝난다", { skip }, async () => {
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
      "막힌 경로를 사람이 읽을 수 있게 알려야 한다");
    assert.strictEqual(existsSync(join(target, ".github", "workflows")), false, "워크플로우를 먼저 써 두면 안 된다");
    assert.strictEqual(existsSync(join(target, "version.yml")), false, "version.yml을 먼저 써 두면 안 된다");
  } finally {
    console.error = origError;
    resetLogger();
    chmodSync(wizard, 0o755);
    rmSync(target, { recursive: true, force: true });
  }
});
