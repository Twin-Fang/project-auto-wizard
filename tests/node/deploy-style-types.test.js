// tests/node/deploy-style-types.test.js
// 배포 방식은 타입마다 같은 규칙으로 동작해야 한다.
//  - none: 모든 타입에서 서버 배포 워크플로우(CD·react/next 단일 CD·PR 프리뷰)를 설치하지 않는다
//  - nginx/traefik: 무중단 워크플로우가 없는 타입(python·go·react·next)은 단일 서버 배포로 설치하고 알린다
//  - 첫 설치에서 방금 쓴 파일을 "사용자 수정본"으로 오인해 .bak으로 옮기지 않는다
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "../../src/index.js";
import { cleanupOtherDeployWorkflows, fallbackStyleTypes, payloadWorkflowNames } from "../../src/core/deploy-style.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";

const payload = resolvePayloadRoot();

function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), "paw-deploy-types-"));
  for (const [rel, body] of Object.entries(files)) writeFileSync(join(dir, rel), body);
  return dir;
}

async function install(dir, argv) {
  const original = process.stderr.write;
  const originalLog = console.log;
  let err = "";
  process.stderr.write = (s) => { err += String(s); return true; };
  console.log = () => {};
  try {
    const code = await run(["--mode", "full", "--force", ...argv], { cwd: dir });
    return { code, err };
  } finally {
    process.stderr.write = original;
    console.log = originalLog;
  }
}

const workflows = (dir) => readdirSync(join(dir, ".github", "workflows"));

const REACT = { "package.json": JSON.stringify({ name: "my-app", version: "1.0.0", dependencies: { react: "18" } }) };
const NEXT = { "package.json": JSON.stringify({ name: "my-app", version: "1.0.0", dependencies: { next: "14", react: "18" } }) };
const PYTHON = { "pyproject.toml": '[project]\nname = "my-service"\nversion = "1.0.0"\n' };
const GO = { "go.mod": "module example.com/my-service\n\ngo 1.22\n" };

for (const [type, files, ci] of [
  ["react", REACT, "PROJECT-REACT-CI.yaml"],
  ["next", NEXT, "PROJECT-NEXT-CI.yaml"],
  ["python", PYTHON, "PROJECT-PYTHON-CI.yaml"],
  ["go", GO, "PROJECT-GO-CI.yaml"],
]) {
  test(`--deploy-style none: ${type}는 CI만 설치하고 서버 배포 설정을 기록하지 않는다`, async () => {
    const dir = repo(files);
    try {
      const { code } = await install(dir, ["--type", type, "--deploy-style", "none"]);
      assert.strictEqual(code, 0);
      const mine = workflows(dir).filter((f) => f.startsWith(`PROJECT-${type.toUpperCase()}-`));
      assert.deepStrictEqual(mine, [ci]);
      const vy = readFileSync(join(dir, "version.yml"), "utf8");
      assert.match(vy, /deploy_style: "none"/);
      assert.doesNotMatch(vy, /SERVER_|SSH_AUTH_METHOD|DEPLOY_PORT/, "서버 배포 전용 값은 기록되지 않는다");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test("simple로 설치한 react를 none으로 바꾸면 CICD가 정리된다", async () => {
  const dir = repo(REACT);
  try {
    await install(dir, ["--type", "react"]);
    assert.ok(workflows(dir).includes("PROJECT-REACT-CICD.yaml"));
    await install(dir, ["--type", "react", "--deploy-style", "none"]);
    const files = workflows(dir);
    assert.ok(!files.includes("PROJECT-REACT-CICD.yaml") && !files.includes("PROJECT-REACT-CICD.yaml.bak"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

for (const [type, files, simple] of [
  ["python", PYTHON, "PROJECT-PYTHON-SIMPLE-CICD.yaml"],
  ["go", GO, "PROJECT-GO-SIMPLE-CICD.yaml"],
]) {
  test(`--deploy-style nginx 첫 설치: ${type}는 단일 서버 배포를 설치하고 .bak·.gitignore를 만들지 않는다`, async () => {
    const dir = repo(files);
    try {
      const { code, err } = await install(dir, ["--type", type, "--deploy-style", "nginx"]);
      assert.strictEqual(code, 0);
      const wf = workflows(dir);
      assert.ok(wf.includes(simple), "무중단 워크플로우가 없는 타입은 단일 서버 배포로 설치된다");
      assert.ok(!wf.some((f) => f.endsWith(".bak")), "첫 설치에서 .bak이 생기면 안 된다");
      assert.ok(!existsSync(join(dir, ".gitignore")));
      assert.match(err, new RegExp(`${type}에는 nginx 무중단 배포 워크플로우가 없어 단일 서버 배포`));
      // 재실행해도 흔들리지 않는다
      await install(dir, ["--type", type, "--deploy-style", "nginx"]);
      assert.ok(workflows(dir).includes(simple));
      assert.ok(!workflows(dir).some((f) => f.endsWith(".bak")));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test("spring,go에 traefik: spring은 TRAEFIK, go는 SIMPLE을 설치한다", async () => {
  const dir = repo({ ...GO, "build.gradle": "version = '1.0.0'\n" });
  try {
    await install(dir, ["--type", "spring,go", "--deploy-style", "traefik"]);
    const wf = workflows(dir);
    assert.ok(wf.includes("PROJECT-SPRING-NONSTOP-TRAEFIK-CICD.yaml"));
    assert.ok(!wf.includes("PROJECT-SPRING-SIMPLE-CICD.yaml"));
    assert.ok(wf.includes("PROJECT-GO-SIMPLE-CICD.yaml"));
    assert.ok(!wf.some((f) => f.endsWith(".bak")));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("fallbackStyleTypes: 무중단 워크플로우가 없는 서버 배포 타입만 돌려준다", () => {
  assert.deepStrictEqual(fallbackStyleTypes(payload, ["spring", "go", "python", "react", "flutter"], "nginx"), ["go", "python", "react"]);
  assert.deepStrictEqual(fallbackStyleTypes(payload, ["go"], "simple"), []);
  assert.deepStrictEqual(fallbackStyleTypes(payload, ["go"], "none"), []);
});

test("cleanupOtherDeployWorkflows: 이번 실행에서 방금 쓴 파일은 baseline이 없어도 수정본으로 보지 않는다", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-deploy-types-"));
  try {
    const f = "PROJECT-SPRING-SIMPLE-CICD.yaml";
    writeFileSync(join(dir, f), "name: simple\n");
    const r = cleanupOtherDeployWorkflows(dir, [f], "nginx", null, { available: payloadWorkflowNames(payload), justWritten: [f] });
    assert.deepStrictEqual(r.removed, [f]);
    assert.deepStrictEqual(r.backedUp, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("cleanupOtherDeployWorkflows: payload에 없는 사용자 워크플로우는 이름이 비슷해도 건드리지 않는다", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-deploy-types-"));
  try {
    const mine = "MY-APP-PR-PREVIEW.yaml";
    writeFileSync(join(dir, mine), "name: mine\n");
    const r = cleanupOtherDeployWorkflows(dir, [mine], "none", null, { available: payloadWorkflowNames(payload) });
    assert.deepStrictEqual(r, { removed: [], backedUp: [] });
    assert.ok(existsSync(join(dir, mine)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
