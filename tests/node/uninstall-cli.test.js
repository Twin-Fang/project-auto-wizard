// tests/node/uninstall-cli.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "../../src/cli/args.js";
import { run } from "../../src/index.js";
import { ensureGitignore } from "../../src/core/copy/gitignore.js";

test("parseArgs: --purge-readme/--purge-gitignore/--purge-version default to false", () => {
  const opts = parseArgs(["--mode", "uninstall", "--force"]);
  assert.strictEqual(opts.purgeReadme, false);
  assert.strictEqual(opts.purgeGitignore, false);
  assert.strictEqual(opts.purgeVersion, false);
});

test("parseArgs: purge flags set their respective booleans", () => {
  const opts = parseArgs(["--mode", "uninstall", "--force", "--purge-readme", "--purge-gitignore", "--purge-version"]);
  assert.strictEqual(opts.purgeReadme, true);
  assert.strictEqual(opts.purgeGitignore, true);
  assert.strictEqual(opts.purgeVersion, true);
});

function emptyTarget() {
  const target = mkdtempSync(join(tmpdir(), "paw-uninstall-cli-"));
  writeFileSync(join(target, "package.json"), "{}\n"); // M4: 경로 후보 0개 방지용 루트 마커
  return target;
}

test("run(): --mode uninstall --force removes only workflows/scripts by default", async () => {
  const target = emptyTarget();
  try {
    writeFileSync(join(target, "README.md"), "# Test Project\n");
    await run(["--mode", "full", "--force", "--type", "node"], {
      cwd: target, clock: { now: "2026-08-01 00:00:00", today: "2026-08-01" },
    });
    // full 모드는 충돌 백업이 실제로 생겼을 때만 .gitignore를 만든다(issue #7) — 이 테스트는
    // uninstall의 gitignore 정리 동작 자체를 검증하는 것이 목적이므로 직접 만들어 둔다.
    ensureGitignore(target);
    const code = await run(["--mode", "uninstall", "--force"], { cwd: target });
    assert.strictEqual(code, 0);
    assert.ok(!existsSync(join(target, ".github/scripts/version_manager.py")));
    assert.ok(existsSync(join(target, "version.yml")));
    assert.ok(existsSync(join(target, ".gitignore")));
    assert.ok(readFileSync(join(target, "README.md"), "utf8").includes("AUTO-VERSION-SECTION"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --mode uninstall --force --purge-readme --purge-gitignore --purge-version removes everything", async () => {
  const target = emptyTarget();
  try {
    writeFileSync(join(target, "README.md"), "# Test Project\n");
    await run(["--mode", "full", "--force", "--type", "node"], {
      cwd: target, clock: { now: "2026-08-01 00:00:00", today: "2026-08-01" },
    });
    // full 모드는 충돌 백업이 실제로 생겼을 때만 .gitignore를 만든다(issue #7) — 이 테스트는
    // --purge-gitignore가 실제로 지우는지를 검증하는 것이 목적이므로 직접 만들어 둔다.
    ensureGitignore(target);
    const code = await run(
      ["--mode", "uninstall", "--force", "--purge-readme", "--purge-gitignore", "--purge-version"],
      { cwd: target },
    );
    assert.strictEqual(code, 0);
    assert.ok(!existsSync(join(target, "version.yml")));
    assert.ok(!existsSync(join(target, ".gitignore")));
    assert.ok(!readFileSync(join(target, "README.md"), "utf8").includes("AUTO-VERSION-SECTION"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --mode uninstall --dry-run writes nothing even without --force", async () => {
  const target = emptyTarget();
  try {
    await run(["--mode", "full", "--force", "--type", "node"], {
      cwd: target, clock: { now: "2026-08-01 00:00:00", today: "2026-08-01" },
    });
    const code = await run(["--mode", "uninstall", "--dry-run"], { cwd: target });
    assert.strictEqual(code, 0);
    assert.ok(existsSync(join(target, ".github/scripts/version_manager.py")));
    assert.ok(existsSync(join(target, "version.yml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --mode uninstall without --force in a non-interactive environment errors", async () => {
  const target = emptyTarget();
  try {
    const code = await run(["--mode", "uninstall"], { cwd: target });
    assert.strictEqual(code, 1);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
