// tests/node/branch-empty-remote.test.js
// 빈 원격(remote add만 하고 push 전)·원격 없음에서의 릴리스/개발 브랜치 처리.
import "../setup-lang.mjs"; // these tests assert the ko output
import { test } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../src/index.js";
import { detectDefaultBranch } from "../../src/core/detect-fs.js";
import { printSummary } from "../../src/ui/summary.js";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" });

// 로컬 main에 커밋 1개 + 빈 bare 원격을 origin으로 붙인 레포
function repoWithEmptyRemote(localBranch = "main") {
  const base = mkdtempSync(join(tmpdir(), "paw-empty-remote-"));
  const bare = join(base, "o.git");
  const dir = join(base, "x");
  mkdirSync(dir);
  git(base, "init", "-q", "--bare", bare);
  git(dir, "init", "-q", "-b", localBranch);
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "my-app", version: "1.0.0" }));
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  git(dir, "remote", "add", "origin", bare);
  return { base, dir };
}

function captureStderr(fn) {
  const original = process.stderr.write;
  let out = "";
  process.stderr.write = (chunk) => { out += chunk; return true; };
  return Promise.resolve().then(fn).then((r) => ({ r, out })).finally(() => { process.stderr.write = original; });
}

test("detectDefaultBranch: 빈 원격의 '(unknown)'을 브랜치로 받지 않고 로컬 브랜치로 폴백하며 경고한다", () => {
  const { base, dir } = repoWithEmptyRemote("trunk");
  try {
    const warns = [];
    assert.strictEqual(detectDefaultBranch(dir, { warn: (m) => warns.push(m) }), "trunk");
    assert.strictEqual(warns.length, 1);
    assert.match(warns[0], /trunk/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("detectDefaultBranch: origin이 없으면 경고 없이 main", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-no-remote-"));
  try {
    git(dir, "init", "-q", "-b", "trunk");
    const warns = [];
    assert.strictEqual(detectDefaultBranch(dir, { warn: (m) => warns.push(m) }), "main");
    assert.strictEqual(warns.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("run(--force): 빈 원격이면 워크플로우·version.yml에 '(unknown)'이 없고 develop 미생성을 안내한다", async () => {
  const { base, dir } = repoWithEmptyRemote("main");
  try {
    const { r, out } = await captureStderr(() => run(["--mode", "full", "--force", "--type", "node"], { cwd: dir }));
    assert.strictEqual(r, 0);
    const vy = readFileSync(join(dir, "version.yml"), "utf8");
    assert.ok(!vy.includes("(unknown)"), "version.yml에 (unknown)이 기록되면 안 된다");
    const wfDir = join(dir, ".github", "workflows");
    for (const f of readdirSync(wfDir)) {
      assert.ok(!readFileSync(join(wfDir, f), "utf8").includes("(unknown)"), `${f}에 (unknown)이 기록되면 안 된다`);
    }
    assert.match(vy, /main: "main"/);
    assert.match(out, /원격 기본 브랜치를 확인할 수 없어/);
    assert.match(out, /git push origin main:develop/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("run(--force): 이전에 저장된 '(unknown)' 브랜치는 저장값으로 쓰지 않는다", async () => {
  const { base, dir } = repoWithEmptyRemote("main");
  try {
    await captureStderr(() => run(["--mode", "full", "--force", "--type", "node"], { cwd: dir }));
    const vyPath = join(dir, "version.yml");
    writeFileSync(vyPath, readFileSync(vyPath, "utf8").replace(/main: "main"/, 'main: "(unknown)"'));
    await captureStderr(() => run(["--mode", "full", "--force", "--type", "node"], { cwd: dir }));
    assert.ok(!readFileSync(vyPath, "utf8").includes("(unknown)"));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("printSummary: pr-flow인데 develop이 없으면 구성 줄 아래에 만드는 방법을 안내한다", async () => {
  const branches = { main: "main", develop: "develop", mode: "pr-flow" };
  const { out } = await captureStderr(() => printSummary({ mode: "full", types: ["node"], version: "1.0.0", branches, developMissing: true }));
  assert.match(out, /'develop' 브랜치가 아직 원격에 없습니다/);
  const { out: ok } = await captureStderr(() => printSummary({ mode: "full", types: ["node"], version: "1.0.0", branches }));
  assert.ok(!ok.includes("아직 원격에 없습니다"));
});

test("printSummary: 설치 파일 커밋과 develop 반영, 첫 릴리스 전 CHANGELOG 링크를 안내한다", async () => {
  const { out } = await captureStderr(() => printSummary({
    mode: "full", types: ["node"], version: "1.0.0", branches: { main: "main", develop: "develop", mode: "pr-flow" },
  }));
  assert.match(out, /설치된 파일을 커밋해 main에 push하세요/);
  assert.match(out, /git checkout develop && git merge main/);
  assert.match(out, /CHANGELOG/);
  const { out: trunk } = await captureStderr(() => printSummary({
    mode: "full", types: ["node"], version: "1.0.0", branches: { main: "main", develop: "main", mode: "trunk-based" },
  }));
  assert.ok(!trunk.includes("git merge"), "trunk-based에는 병합 안내가 없어야 한다");
});
