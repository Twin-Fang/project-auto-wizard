// Task 20 게이트 — 11개 fixture에 실제 CLI(subprocess)를 돌려 설치 산출물을 검증한다.
// 검증: 종료코드 0 / 타입별 워크플로우 배치 / py 스크립트 설치(배선 누락 검출) /
//       version.yml branches·options 메타 / {{ 잔존 0 / trunk-based 단독 설치 / revert 제거.
import { test } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, readdirSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const BIN = join(process.cwd(), "bin", "project-auto-wizard.js");
const FIXTURES = join(process.cwd(), "tests", "fixtures", "e2e");
// 우리 토큰 잔존 검출 — ${{ github 표현식 }}·{{.Names}}(docker format)는 제외
const TOKEN_RE = /(?<!\$)\{\{[A-Z][A-Z0-9_]*\}\}/;

function runCli(cwd, args) {
  return execFileSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function installFixture(name, args) {
  const target = mkdtempSync(join(tmpdir(), `paw-e2e-${name}-`));
  cpSync(join(FIXTURES, name), target, { recursive: true });
  runCli(target, ["--mode", "full", "--force", "--main-branch", "main", "--develop-branch", "develop", ...args]);
  return target;
}

function assertBaseline(target, label) {
  // py 스크립트 — 워크플로우 전부가 이 경로를 호출한다 (누락 = 설치물 런타임 사망)
  assert.ok(existsSync(join(target, ".github", "scripts", "version_manager.py")), `${label}: version_manager.py`);
  assert.ok(existsSync(join(target, ".github", "scripts", "changelog_manager.py")), `${label}: changelog_manager.py`);
  // version.yml + branches/options 메타
  const vy = readFileSync(join(target, "version.yml"), "utf8");
  assert.ok(/main: "main"/.test(vy) && /develop: "develop"/.test(vy) && /mode: "pr-flow"/.test(vy), `${label}: branches metadata`);
  assert.ok(/nexus: (true|false)/.test(vy) && /coderabbit: (true|false)/.test(vy), `${label}: options metadata`);
  // 공통 워크플로우 4종 (pr-flow)
  for (const wf of [
    "PROJECT-COMMON-VERSION-CONTROL.yaml", "PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml",
    "PROJECT-COMMON-RELEASE-PUBLISH.yaml", "PROJECT-COMMON-README-VERSION-UPDATE.yaml",
  ]) assert.ok(existsSync(join(target, ".github", "workflows", wf)), `${label}: ${wf}`);
  // {{ 잔존 0 (치환 무결성)
  const wfDir = join(target, ".github", "workflows");
  for (const f of readdirSync(wfDir)) {
    const body = readFileSync(join(wfDir, f), "utf8");
    for (const line of body.split("\n")) {
      assert.ok(!TOKEN_RE.test(line), `${label}: ${f} 토큰 잔존: ${line.trim()}`);
    }
  }
}

const MATRIX = [
  { name: "spring", args: ["--type", "spring"], expect: ["PROJECT-SPRING-SIMPLE-CICD.yaml"], absent: ["PROJECT-SPRING-NEXUS-PUBLISH.yml"] },
  { name: "flutter", args: ["--type", "flutter"], expect: ["PROJECT-FLUTTER-CI.yaml", "PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml"] },
  { name: "react", args: ["--type", "react"], expect: ["PROJECT-REACT-CI.yaml", "PROJECT-REACT-CICD.yaml"] },
  { name: "next", args: ["--type", "next"], expect: ["PROJECT-NEXT-CI.yaml", "PROJECT-NEXT-CICD.yaml"] },
  { name: "node", args: ["--type", "node"], expect: [] },
  { name: "python", args: ["--type", "python"], expect: ["PROJECT-PYTHON-CI.yaml", "PROJECT-PYTHON-SIMPLE-CICD.yaml"] },
  { name: "react-native", args: ["--type", "react-native"], expect: [] },
  { name: "react-native-expo", args: ["--type", "react-native-expo"], expect: [] },
  { name: "basic", args: ["--type", "basic"], expect: [] },
  { name: "multi", args: ["--type", "spring,react"], expect: ["PROJECT-SPRING-SIMPLE-CICD.yaml", "PROJECT-REACT-CICD.yaml"] },
  { name: "monorepo", args: ["--type", "flutter,react", "--paths", "flutter=app,react=client"], expect: ["PROJECT-FLUTTER-CI.yaml", "PROJECT-REACT-CICD.yaml"] },
];

for (const { name, args, expect = [], absent = [] } of MATRIX) {
  test(`e2e ${name}: full install is complete and token-free`, () => {
    const t = installFixture(name, args);
    try {
      assertBaseline(t, name);
      for (const wf of expect) assert.ok(existsSync(join(t, ".github", "workflows", wf)), `${name}: ${wf} expected`);
      for (const wf of absent) assert.ok(!existsSync(join(t, ".github", "workflows", wf)), `${name}: ${wf} must be absent`);
    } finally { rmSync(t, { recursive: true, force: true }); }
  });
}

test("e2e spring --nexus: server-deploy excluded, nexus included, option recorded", () => {
  const t = installFixture("spring", ["--type", "spring", "--nexus"]);
  try {
    assert.ok(!existsSync(join(t, ".github", "workflows", "PROJECT-SPRING-SIMPLE-CICD.yaml")));
    assert.ok(existsSync(join(t, ".github", "workflows", "PROJECT-SPRING-NEXUS-PUBLISH.yml")));
    assert.ok(/nexus: true/.test(readFileSync(join(t, "version.yml"), "utf8")));
  } finally { rmSync(t, { recursive: true, force: true }); }
});

test("e2e monorepo: project_paths recorded in version.yml", () => {
  const t = installFixture("monorepo", ["--type", "flutter,react", "--paths", "flutter=app,react=client"]);
  try {
    const vy = readFileSync(join(t, "version.yml"), "utf8");
    assert.ok(/flutter: "app"/.test(vy) && /react: "client"/.test(vy));
  } finally { rmSync(t, { recursive: true, force: true }); }
});

test("e2e trunk-based (--main-branch main --develop-branch main): RELEASE-PUBLISH only", () => {
  const t = mkdtempSync(join(tmpdir(), "paw-e2e-trunk-"));
  cpSync(join(FIXTURES, "node"), t, { recursive: true });
  try {
    runCli(t, ["--mode", "full", "--force", "--type", "node", "--main-branch", "main", "--develop-branch", "main"]);
    assert.ok(existsSync(join(t, ".github", "workflows", "PROJECT-COMMON-RELEASE-PUBLISH.yaml")));
    assert.ok(!existsSync(join(t, ".github", "workflows", "PROJECT-COMMON-VERSION-CONTROL.yaml")));
    assert.ok(!existsSync(join(t, ".github", "workflows", "PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml")));
    assert.ok(/mode: "trunk-based"/.test(readFileSync(join(t, "version.yml"), "utf8")));
  } finally { rmSync(t, { recursive: true, force: true }); }
});

test("e2e revert: removes payload-originated files, keeps user data", () => {
  const t = installFixture("spring", ["--type", "spring"]);
  try {
    // 사용자 자체 워크플로우 심기 — revert가 건드리면 안 된다
    const userWf = join(t, ".github", "workflows", "my-custom.yaml");
    writeFileSync(userWf, "name: custom\n");
    runCli(t, ["--mode", "revert", "--force"]);
    const wfDir = join(t, ".github", "workflows");
    const left = existsSync(wfDir) ? readdirSync(wfDir).filter((f) => f.startsWith("PROJECT-")) : [];
    assert.deepStrictEqual(left, [], "payload workflows must be gone");
    assert.ok(!existsSync(join(t, ".github", "scripts", "version_manager.py")));
    assert.ok(!existsSync(join(t, ".github", "scripts", "changelog_manager.py")));
    assert.ok(existsSync(userWf), "user workflow must survive");
    assert.ok(existsSync(join(t, "version.yml")), "version.yml must survive");
  } finally { rmSync(t, { recursive: true, force: true }); }
});
