import { test } from "node:test";
import assert from "node:assert";
import { parseArgs, CliError } from "../../src/cli/args.js";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "../../src/index.js";

test("parseArgs: 알 수 없는 --mode 값은 CliError를 던진다", () => {
  assert.throws(() => parseArgs(["--mode", "ful"]), CliError);
});

test("parseArgs: --mode 뒤에 값이 없으면(빈 문자열로 해석) CliError를 던진다", () => {
  assert.throws(() => parseArgs(["--mode"]), CliError);
});

test("parseArgs: 유효한 모드는 전부 통과한다 (purge 포함)", () => {
  const modes = ["interactive", "full", "version", "workflows", "revert", "uninstall", "status", "doctor", "purge"];
  for (const m of modes) {
    const opts = parseArgs(["--mode", m]);
    assert.strictEqual(opts.mode, m);
  }
});

test("parseArgs: --mode 미지정 시 기본값 interactive는 그대로 통과한다", () => {
  const opts = parseArgs([]);
  assert.strictEqual(opts.mode, "interactive");
});

test("parseArgs: 에러 메시지는 숨김 모드(purge)를 노출하지 않는다", () => {
  try {
    parseArgs(["--mode", "ful"]);
    assert.fail("CliError가 발생해야 합니다");
  } catch (e) {
    assert.ok(!e.message.includes("purge"), "purge는 숨김 모드이므로 에러 메시지에 노출되면 안 됩니다");
  }
});

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function repoWithOriginRemote() {
  const bare = mkdtempSync(join(tmpdir(), "paw-bare-"));
  git(bare, ["init", "--bare", "-q"]);

  const target = mkdtempSync(join(tmpdir(), "paw-target-"));
  git(target, ["init", "-q", "-b", "main"]);
  git(target, ["config", "user.email", "test@example.com"]);
  git(target, ["config", "user.name", "Test"]);
  writeFileSync(join(target, "README.md"), "# test\n");
  git(target, ["add", "."]);
  git(target, ["commit", "-q", "-m", "init"]);
  git(target, ["remote", "add", "origin", bare]);
  git(target, ["push", "-q", "-u", "origin", "main"]);

  return { bare, target };
}

test("run(): 잘못된 --mode 값은 exit 1이며 원격 develop 브랜치를 생성/push하지 않는다", async () => {
  const { bare, target } = repoWithOriginRemote();
  try {
    const code = await run(["--mode", "ful", "--force", "--type", "node"], { cwd: target });
    assert.strictEqual(code, 1);
    assert.ok(!git(bare, ["branch"]).includes("develop"), "원격(bare repo)에 develop 브랜치가 생기면 안 됩니다");
    assert.ok(!git(target, ["branch"]).includes("develop"), "로컬에도 develop 브랜치가 생기면 안 됩니다");
  } finally {
    rmSync(bare, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  }
});
