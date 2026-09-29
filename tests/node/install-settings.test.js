// tests/node/install-settings.test.js
// 설치 설정 해석 단계 공통화 — CLI(--force)와 대화형(기본 답변)이 같은 레포에서 같은 설치 결과를 내고,
// 대화형 질문의 순서·문구가 바뀌지 않는지 고정한다.
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

// 레포명이 결과 파일에 들어가므로 두 경로 모두 같은 이름의 폴더에서 실행한다.
function project(kind) {
  const base = mkdtempSync(join(tmpdir(), "paw-settings-"));
  const dir = join(base, "my-repo");
  mkdirSync(dir);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  for (const [f, c] of Object.entries(FIXTURES[kind])) writeFileSync(join(dir, f), c);
  return { base, dir };
}

// 설치 로그는 경로마다 남기는 방식이 달라 비교에서 뺀다.
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

// 모든 질문을 순서대로 기록하고 초기값(Enter)으로 답한다.
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

test("기본값 설치 결과가 CLI와 대화형에서 같다 (spring)", async () => {
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

test("기본값 설치 결과가 CLI와 대화형에서 같다 (flutter)", async () => {
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

test("대화형 질문 순서·문구: spring 신규 설치", async () => {
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

test("대화형 질문 순서·문구: flutter 신규 설치", async () => {
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

test("배포 방식: 명시값 → 저장값 → 기본값, 서버 배포가 없는 타입은 null", () => {
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
