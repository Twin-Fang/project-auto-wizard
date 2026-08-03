// tests/node/purge-cli.test.js
import { test } from "node:test";
import assert from "node:assert";
import { parseArgs } from "../../src/cli/args.js";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "../../src/index.js";

test("parseArgs: --mode purge with --yes sets yes=true", () => {
  const opts = parseArgs(["--mode", "purge", "--yes"]);
  assert.strictEqual(opts.mode, "purge");
  assert.strictEqual(opts.yes, true);
});

test("parseArgs: purge flags default to false", () => {
  const opts = parseArgs(["--mode", "purge"]);
  assert.strictEqual(opts.yes, false);
  assert.strictEqual(opts.allowDirty, false);
  assert.strictEqual(opts.deleteDevelopBranch, false);
  assert.strictEqual(opts.keepVersionYml, false);
  assert.strictEqual(opts.keepReadme, false);
  assert.strictEqual(opts.keepChangelog, false);
  assert.strictEqual(opts.keepWorkflows, false);
  assert.strictEqual(opts.keepScripts, false);
});

test("parseArgs: all purge-only flags parse", () => {
  const opts = parseArgs([
    "--mode", "purge", "--yes", "--allow-dirty", "--delete-develop-branch",
    "--keep-version-yml", "--keep-readme", "--keep-changelog",
    "--keep-workflows", "--keep-scripts",
  ]);
  assert.strictEqual(opts.allowDirty, true);
  assert.strictEqual(opts.deleteDevelopBranch, true);
  assert.strictEqual(opts.keepVersionYml, true);
  assert.strictEqual(opts.keepReadme, true);
  assert.strictEqual(opts.keepChangelog, true);
  assert.strictEqual(opts.keepWorkflows, true);
  assert.strictEqual(opts.keepScripts, true);
});

async function installedTarget() {
  const target = mkdtempSync(join(tmpdir(), "paw-purge-cli-"));
  mkdirSync(join(target, ".git"));
  await run(["--mode", "full", "--force", "--type", "node"], {
    cwd: target, clock: { now: "2026-07-28 00:00:00", today: "2026-07-28" },
  });
  return target;
}

const cleanExec = async (cmd, args) => {
  if (args[0] === "status") return { code: 0, stdout: "", stderr: "" };
  return { code: 0, stdout: "", stderr: "" };
};
const dirtyExec = async (cmd, args) => {
  if (args[0] === "status") return { code: 0, stdout: " M some-file.txt\n", stderr: "" };
  return { code: 0, stdout: "", stderr: "" };
};
const failingStatusExec = async (cmd, args) => {
  if (args[0] === "status") return { code: 1, stdout: "", stderr: "fatal: not a git repository" };
  return { code: 0, stdout: "", stderr: "" };
};

test("run(): --mode purge outside a git repo is rejected even with --dry-run", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-purge-cli-"));
  try {
    const code = await run(["--mode", "purge", "--dry-run"], { cwd: target });
    assert.strictEqual(code, 1);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --mode purge --dry-run needs no --yes and writes nothing", async () => {
  const target = await installedTarget();
  try {
    const code = await run(["--mode", "purge", "--dry-run"], { cwd: target });
    assert.strictEqual(code, 0);
    assert.ok(existsSync(join(target, "version.yml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --mode purge --dry-run --delete-develop-branch mentions the pending branch deletion", async () => {
  const target = await installedTarget();
  const originalLog = console.log;
  let stdout = "";
  console.log = (msg) => { stdout += msg; };
  try {
    const code = await run(["--mode", "purge", "--dry-run", "--delete-develop-branch"], { cwd: target });
    assert.strictEqual(code, 0);
    assert.ok(stdout.includes("--delete-develop-branch"));
  } finally {
    console.log = originalLog;
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --mode purge without --yes is rejected even with --force", async () => {
  const target = await installedTarget();
  try {
    const code = await run(["--mode", "purge", "--force"], { cwd: target, exec: cleanExec });
    assert.strictEqual(code, 1);
    assert.ok(existsSync(join(target, "version.yml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --mode purge --yes rejects a dirty working tree without --allow-dirty", async () => {
  const target = await installedTarget();
  try {
    const code = await run(["--mode", "purge", "--yes", "--force"], { cwd: target, exec: dirtyExec });
    assert.strictEqual(code, 1);
    assert.ok(existsSync(join(target, "version.yml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --mode purge --yes --allow-dirty --force performs the purge", async () => {
  const target = await installedTarget();
  try {
    const code = await run(["--mode", "purge", "--yes", "--allow-dirty", "--force"], { cwd: target, exec: dirtyExec });
    assert.strictEqual(code, 0);
    assert.ok(!existsSync(join(target, "version.yml")));
    assert.ok(!existsSync(join(target, ".github/scripts/version_manager.py")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --mode purge --yes without --force in a non-TTY environment is rejected", async () => {
  const target = await installedTarget();
  try {
    const code = await run(["--mode", "purge", "--yes"], { cwd: target, exec: cleanExec });
    assert.strictEqual(code, 1);
    assert.ok(existsSync(join(target, "version.yml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --mode purge --yes with TTY and a matching typed repo name performs the purge", async () => {
  const target = await installedTarget();
  const originalIsTTY = process.stdout.isTTY;
  process.stdout.isTTY = true;
  try {
    const repoName = target.split("/").pop();
    const code = await run(["--mode", "purge", "--yes"], {
      cwd: target, exec: cleanExec, promptRepoName: async () => repoName,
    });
    assert.strictEqual(code, 0);
    assert.ok(!existsSync(join(target, "version.yml")));
  } finally {
    process.stdout.isTTY = originalIsTTY;
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --mode purge --yes with TTY and a mismatched typed repo name aborts", async () => {
  const target = await installedTarget();
  const originalIsTTY = process.stdout.isTTY;
  process.stdout.isTTY = true;
  try {
    const code = await run(["--mode", "purge", "--yes"], {
      cwd: target, exec: cleanExec, promptRepoName: async () => "definitely-wrong-name",
    });
    assert.strictEqual(code, 1);
    assert.ok(existsSync(join(target, "version.yml")));
  } finally {
    process.stdout.isTTY = originalIsTTY;
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --mode purge rejects when `git status` itself fails, even with --allow-dirty", async () => {
  const target = await installedTarget();
  try {
    const code = await run(["--mode", "purge", "--yes", "--allow-dirty", "--force"], { cwd: target, exec: failingStatusExec });
    assert.strictEqual(code, 1);
    assert.ok(existsSync(join(target, "version.yml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --delete-develop-branch deletes the local branch on success", async () => {
  const target = await installedTarget();
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push(args.join(" "));
    return { code: 0, stdout: "", stderr: "" };
  };
  try {
    const code = await run(["--mode", "purge", "--yes", "--force", "--delete-develop-branch"], { cwd: target, exec });
    assert.strictEqual(code, 0);
    assert.ok(calls.includes("branch -d develop"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --delete-develop-branch failure (unmerged) logs a warning but still exits 0", async () => {
  const target = await installedTarget();
  let stderr = "";
  const originalError = console.error;
  console.error = (msg) => { stderr += msg; };
  const exec = async (cmd, args) => {
    if (args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (args[0] === "branch") return { code: 1, stdout: "", stderr: "error: branch 'develop' is not fully merged" };
    return { code: 0, stdout: "", stderr: "" };
  };
  try {
    const code = await run(["--mode", "purge", "--yes", "--force", "--delete-develop-branch"], { cwd: target, exec });
    assert.strictEqual(code, 0);
    assert.ok(stderr.includes("삭제 실패"));
  } finally {
    console.error = originalError;
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): without --delete-develop-branch, no branch command is issued", async () => {
  const target = await installedTarget();
  const calls = [];
  const exec = async (cmd, args) => { calls.push(args.join(" ")); return { code: 0, stdout: "", stderr: "" }; };
  try {
    await run(["--mode", "purge", "--yes", "--force"], { cwd: target, exec });
    assert.ok(!calls.some((c) => c.startsWith("branch")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// H1 (Fable 검토, 2026-08-01) → issue #7 갱신: .gitignore는 이제 충돌 백업 부산물이 실제로 생겼을
// 때만 만들어지고, purge는 어떤 경우든 절대 건드리지 않으므로(스펙 §2 비목표) 라운드트립 비교에서
// .git과 함께 안전하게 제외한다 — 자세한 이유는 purge-plan.test.js의 동일 헬퍼 참고.
function listAllFilesCli(dir, base = dir) {
  let out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === ".gitignore") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) out = out.concat(listAllFilesCli(full, base));
    else out.push(full.slice(base.length + 1));
  }
  return out.sort();
}

test("run(): full round-trip — install then purge returns the target to its pre-install state", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-purge-cli-"));
  mkdirSync(join(target, ".git"));
  writeFileSync(join(target, "README.md"), "# Test\n");
  try {
    const before = listAllFilesCli(target);
    await run(["--mode", "full", "--force", "--type", "node"], {
      cwd: target, clock: { now: "2026-07-28 00:00:00", today: "2026-07-28" },
    });
    const code = await run(["--mode", "purge", "--yes", "--force"], { cwd: target, exec: cleanExec });
    assert.strictEqual(code, 0);
    assert.deepStrictEqual(listAllFilesCli(target), before);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --keep-version-yml via CLI preserves only version.yml", async () => {
  const target = await installedTarget();
  try {
    const code = await run(["--mode", "purge", "--yes", "--force", "--keep-version-yml"], { cwd: target, exec: cleanExec });
    assert.strictEqual(code, 0);
    assert.ok(existsSync(join(target, "version.yml")));
    assert.ok(!existsSync(join(target, ".github/scripts/version_manager.py")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

async function installedTrunkBasedTarget() {
  const target = mkdtempSync(join(tmpdir(), "paw-purge-cli-"));
  mkdirSync(join(target, ".git"));
  await run(["--mode", "full", "--force", "--type", "node", "--develop-branch", "main"], {
    cwd: target, clock: { now: "2026-07-28 00:00:00", today: "2026-07-28" },
  });
  return target;
}

test("run(): --delete-develop-branch skips deletion in a trunk-based install (develop === main)", async () => {
  const target = await installedTrunkBasedTarget();
  const calls = [];
  const exec = async (cmd, args) => { calls.push(args.join(" ")); return { code: 0, stdout: "", stderr: "" }; };
  try {
    const code = await run(["--mode", "purge", "--yes", "--force", "--delete-develop-branch"], { cwd: target, exec });
    assert.strictEqual(code, 0);
    assert.ok(!calls.some((c) => c.startsWith("branch")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// "purge"라는 부분 문자열 자체는 --help에 등장할 수 있다(예: uninstall의 공개 플래그
// --purge-readme/--purge-gitignore/--purge-version). 이 테스트가 검증해야 할 것은
// 오직 숨김 모드인 "--mode purge"(및 그 예시 실행문)가 노출되지 않는다는 것뿐이다.
test("run(): --mode purge is not mentioned in --help output (hidden mode)", async () => {
  const originalLog = console.log;
  let stdout = "";
  console.log = (msg) => { stdout += msg; };
  try {
    await run(["--help"], { cwd: process.cwd() });
  } finally {
    console.log = originalLog;
  }
  assert.ok(!stdout.includes("mode purge"));
  assert.ok(!stdout.includes("--mode purge"));
});
