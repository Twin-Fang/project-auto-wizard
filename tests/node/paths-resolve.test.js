import { test } from "node:test";
import assert from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "../../src/index.js";
import { CliError } from "../../src/cli/args.js";
import { resolveProjectPaths } from "../../src/core/paths-resolve.js";

function tmpRepo(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(dir, ".git"));
  return dir;
}

// ── Task 4: resolveProjectPaths() 호출부 CliError 캐치 ──────────────
test("run(): --paths에 지원하지 않는 타입을 지정하면 스택트레이스 없이 exit 1로 깔끔하게 거부된다", async () => {
  const target = tmpRepo("paw-paths-resolve-");
  try {
    const code = await run(
      ["--mode", "full", "--force", "--type", "node", "--paths", "not-a-type=."],
      { cwd: target, clock: { now: "2026-08-04 00:00:00", today: "2026-08-04" } },
    );
    assert.strictEqual(code, 1);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
