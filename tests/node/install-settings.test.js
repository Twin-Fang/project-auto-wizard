// tests/node/install-settings.test.js
// Shared install-settings resolution: the CLI (--force) and interactive (default answers) produce the same install result on the same repo,
// and the order and wording of the interactive questions stay unchanged.
import "../setup-lang.mjs"; // these tests assert the ko output
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { run } from "../../src/index.js";
import { runInteractive } from "../../src/commands/interactive.js";
import { savedDeployStyle, resolveDeployStyle } from "../../src/commands/install-settings.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";

const CLOCK = { now: "2026-01-02 03:04:05", today: "2026-01-02", ms: 1767323045000 };

const FIXTURES = {
  spring: { "build.gradle": "plugins { id 'org.springframework.boot' version '3.2.0' }\nversion = '1.2.3'\n" },
  flutter: { "pubspec.yaml": "name: my_app\nversion: 1.0.0+7\n" },
};

// The repo name ends up in the result files, so run both paths in a folder with the same name.
function project(kind) {
  const base = mkdtempSync(join(tmpdir(), "paw-settings-"));
  const dir = join(base, "my-repo");
  mkdirSync(dir);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  for (const [f, c] of Object.entries(FIXTURES[kind])) writeFileSync(join(dir, f), c);
  return { base, dir };
}

// Install logs are recorded differently per path, so exclude them from the comparison.
function snapshot(dir) {
  const out = {};
  const walk = (p) => {
    for (const e of readdirSync(p, { withFileTypes: true })) {
      if (e.name === ".git" || e.name === "logs") continue;
      const f = join(p, e.name);
      if (e.isDirectory()) walk(f); else out[relative(dir, f)] = readFileSync(f, "utf8");
    }
  };
  walk(dir);
  return out;
}

// Record every question in order and answer with the initial value (Enter).
function recordingIo() {
  const seq = [];
  const rec = (name, answer) => async (...a) => { seq.push(name); return answer(...a); };
  const io = {
    selectMode: rec("selectMode", async () => "full"),
    confirmProjectMenu: rec("confirmProjectMenu", async () => "continue"),
    confirmTypes: rec("confirmTypes", async ({ types }) => types),
    selectDeployStyle: rec("selectDeployStyle", async () => "simple"),
    selectBranchStrategy: rec("selectBranchStrategy", async () => "pr-flow"),
    selectEnvMode: rec("selectEnvMode", async (a) => a.initialValue),
    selectFlutterStores: rec("selectFlutterStores", async (a) => a.initialValues),
    selectDeployMode: rec("selectDeployMode", async (a) => a.initialValue),
    askYesNo: async (message, def) => { seq.push(`askYesNo:${message}`); return def; },
    askText: async (message, def) => { seq.push(`askText:${message}`); return def; },
    note: () => {}, cancelMessage: () => {}, summary: () => {}, outro: () => {},
    editMenu: async () => "done",
  };
  return { io, seq };
}

test("default install result is the same for CLI and interactive (spring)", async () => {
  const cli = project("spring");
  const inter = project("spring");
  try {
    assert.strictEqual(await run(["--mode", "full", "--force"], { cwd: cli.dir, clock: CLOCK }), 0);
    assert.strictEqual(await runInteractive({}, { cwd: inter.dir, clock: CLOCK, io: recordingIo().io }), 0);
    assert.deepStrictEqual(snapshot(inter.dir), snapshot(cli.dir));
  } finally {
    rmSync(cli.base, { recursive: true, force: true });
    rmSync(inter.base, { recursive: true, force: true });
  }
});

test("default install result is the same for CLI and interactive (flutter)", async () => {
  const cli = project("flutter");
  const inter = project("flutter");
  try {
    assert.strictEqual(await run(["--mode", "full", "--force"], { cwd: cli.dir, clock: CLOCK }), 0);
    assert.strictEqual(await runInteractive({}, { cwd: inter.dir, clock: CLOCK, io: recordingIo().io }), 0);
    assert.deepStrictEqual(snapshot(inter.dir), snapshot(cli.dir));
  } finally {
    rmSync(cli.base, { recursive: true, force: true });
    rmSync(inter.base, { recursive: true, force: true });
  }
});

test("interactive question order and wording: fresh spring install", async () => {
  const { dir, base } = project("spring");
  try {
    const { io, seq } = recordingIo();
    assert.strictEqual(await runInteractive({}, { cwd: dir, clock: CLOCK, io }), 0);
    assert.deepStrictEqual(seq, [
      "selectMode",
      "confirmTypes",
      "selectDeployStyle",
      "askYesNo:자동 버전 승격을 사용하시겠습니까? (커밋 타입에 따라 major/minor/patch 자동 결정)",
      "askYesNo:Copilot으로 AI 요약을 생성하시겠습니까? (GitHub Copilot AI Credits가 소비되며, 사용할 수 없으면 자동으로 규칙 기반 요약으로 전환됩니다)",
      "confirmProjectMenu",
      "selectBranchStrategy",
      "askText:릴리스 브랜치를 선택하세요 (기본: main)",
      "askText:개발 브랜치를 선택하세요 (기본: develop)",
    ]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("interactive question order and wording: fresh flutter install", async () => {
  const { dir, base } = project("flutter");
  try {
    const { io, seq } = recordingIo();
    assert.strictEqual(await runInteractive({}, { cwd: dir, clock: CLOCK, io }), 0);
    assert.deepStrictEqual(seq.slice(0, 9), [
      "selectMode",
      "confirmTypes",
      "selectEnvMode",
      "selectFlutterStores",
      "selectDeployMode",
      "selectDeployMode",
      "askYesNo:자동 버전 승격을 사용하시겠습니까? (커밋 타입에 따라 major/minor/patch 자동 결정)",
      "askYesNo:Copilot으로 AI 요약을 생성하시겠습니까? (GitHub Copilot AI Credits가 소비되며, 사용할 수 없으면 자동으로 규칙 기반 요약으로 전환됩니다)",
      "confirmProjectMenu",
    ]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("deploy method: explicit value, then stored value, then default; null for types without server deploy", () => {
  const payload = resolvePayloadRoot();
  assert.strictEqual(savedDeployStyle(null), "");
  assert.strictEqual(savedDeployStyle({ options: { deployStyle: "bogus" } }), "");
  assert.strictEqual(savedDeployStyle({ options: { deployStyle: "nginx" } }), "nginx");

  const existing = { options: { deployStyle: "traefik" } };
  assert.strictEqual(resolveDeployStyle({ payload, types: ["spring"], explicit: "nginx", existing }), "nginx");
  assert.strictEqual(resolveDeployStyle({ payload, types: ["spring"], existing }), "traefik");
  assert.strictEqual(resolveDeployStyle({ payload, types: ["spring"], existing: null }), "simple");
  assert.strictEqual(resolveDeployStyle({ payload, types: ["flutter"], explicit: "nginx", existing }), null);
});
