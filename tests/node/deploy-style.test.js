// tests/node/deploy-style.test.js
// 배포 방식 선택 (이슈 #80) — CD 워크플로우는 서로 대체재라 하나만 설치하고 트리거를 켠다.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  deployFilter, isDeployWorkflow, competingDeployWorkflows, activateDeployTrigger, isDeployStyle,
} from "../../src/core/deploy-style.js";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { makeResolvers } from "../../src/core/detect-fs.js";
import { parseArgs } from "../../src/cli/args.js";

const SIMPLE = "PROJECT-SPRING-SIMPLE-CICD.yaml";
const NGINX = "PROJECT-SPRING-NONSTOP-NGINX-CICD.yaml";
const TRAEFIK = "PROJECT-SPRING-NONSTOP-TRAEFIK-CICD.yaml";
const PREVIEW = "PROJECT-SPRING-PR-PREVIEW.yaml";

test("deployFilter: 고른 방식의 CD만 통과시키고 PR 프리뷰는 항상 통과한다", () => {
  const keep = deployFilter("nginx");
  assert.ok(keep(NGINX));
  assert.ok(!keep(SIMPLE));
  assert.ok(!keep(TRAEFIK));
  assert.ok(keep(PREVIEW), "PR 프리뷰는 배포 방식과 직교하는 축이다");
  assert.ok(keep("PROJECT-COMMON-RELEASE-PUBLISH.yaml"));
});

test("deployFilter: 미지정/all은 전부 통과 — 종전 동작 그대로", () => {
  for (const style of ["", undefined, "all"]) {
    const keep = deployFilter(style);
    assert.ok([SIMPLE, NGINX, TRAEFIK, PREVIEW].every(keep), `style=${style}`);
  }
});

test("isDeployWorkflow: CD 본체만 선택 대상이다", () => {
  assert.ok(isDeployWorkflow(SIMPLE) && isDeployWorkflow(NGINX) && isDeployWorkflow(TRAEFIK));
  assert.ok(!isDeployWorkflow(PREVIEW));
});

test("competingDeployWorkflows: 고른 방식이 아닌데 이미 깔린 CD를 짚어낸다", () => {
  const installed = [SIMPLE, NGINX, PREVIEW, "PROJECT-COMMON-RELEASE-PUBLISH.yaml"];
  assert.deepStrictEqual(competingDeployWorkflows(installed, "nginx"), [SIMPLE]);
  assert.deepStrictEqual(competingDeployWorkflows(installed, "all"), [], "all이면 경합 자체가 없다");
});

test("activateDeployTrigger: on 블록의 주석 처리된 push 트리거만 되살린다", () => {
  const before = `name: X\n\non:\n  # push:\n  #   branches:\n  #     - main\n  workflow_dispatch:\n\nenv:\n  # 설명 주석은 그대로\n  A: "1"\n`;
  const after = activateDeployTrigger(before);
  assert.match(after, /^on:\n  push:\n    branches:\n      - main\n  workflow_dispatch:$/m,
    "안쪽 들여쓰기 계층이 보존돼야 한다");
  assert.match(after, /  # 설명 주석은 그대로/, "on 블록 밖 주석은 건드리면 안 된다");
});

test("activateDeployTrigger: 이미 켜져 있으면 그대로 둔다 (멱등)", () => {
  const already = `on:\n  push:\n    branches:\n      - main\n`;
  assert.strictEqual(activateDeployTrigger(already), already);
});

test("--deploy-style: 값 검증과 기본값", () => {
  assert.strictEqual(parseArgs(["--deploy-style", "nginx"]).deployStyle, "nginx");
  assert.strictEqual(parseArgs([]).deployStyle, "", "미지정은 빈값 → 다운스트림에서 all로 해석");
  assert.throws(() => parseArgs(["--deploy-style", "k8s"]), /deploy-style/);
  assert.throws(() => parseArgs(["--deploy-style"]), /deploy-style/);
  assert.ok(isDeployStyle("traefik") && !isDeployStyle("k8s"));
});

function springTarget() {
  const target = mkdtempSync(join(tmpdir(), "paw-deploy-style-"));
  mkdirSync(join(target, "src/main/resources"), { recursive: true });
  writeFileSync(join(target, "src/main/resources/application.yaml"), "");
  writeFileSync(join(target, "build.gradle.kts"), 'version = "1.0.0"\n');
  return target;
}

function install(target, deployStyle) {
  const paths = new Map([["spring", "."]]);
  return runFull(createContext({
    mode: "full", force: true, types: ["spring"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths, repoName: "svc", resolvers: makeResolvers(target, "svc", paths),
    now: "2026-08-12 10:00:00", today: "2026-08-12", templateVersion: "0.2.2", deployStyle,
  }), resolvePayloadRoot(), target);
}

test("runFull: nginx를 고르면 그 CD만 설치되고 push 트리거가 켜진 채로 깔린다", () => {
  const target = springTarget();
  try {
    install(target, "nginx");
    const files = readdirSync(join(target, ".github/workflows")).filter((f) => f.includes("SPRING"));
    assert.deepStrictEqual(files.sort(), [NGINX, PREVIEW].sort());

    const wf = readFileSync(join(target, ".github/workflows", NGINX), "utf8");
    assert.match(wf, /^on:\n  push:\n    branches:\n      - main/m,
      "고른 방식은 자동 실행돼야 한다 — 안 켜주면 설치해도 아무 일이 없다");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("runFull: 기본값(all)은 종전대로 CD 3종 + PR 프리뷰를 모두 설치한다", () => {
  const target = springTarget();
  try {
    install(target, "");
    const files = readdirSync(join(target, ".github/workflows")).filter((f) => f.includes("SPRING"));
    assert.deepStrictEqual(files.sort(), [NGINX, PREVIEW, SIMPLE, TRAEFIK].sort());
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("runFull: 방식을 바꿔 재설치하면 남은 CD를 삭제하지 않고 경고로 알린다", () => {
  const target = springTarget();
  try {
    install(target, "simple");           // 먼저 단일 서버 배포로 설치
    const r = install(target, "nginx");  // 무중단으로 바꿔 재설치

    assert.deepStrictEqual(r.competing, [SIMPLE],
      "이전 방식이 남아 있으면 배포가 두 번 도므로 반드시 알려야 한다");
    assert.ok(readdirSync(join(target, ".github/workflows")).includes(SIMPLE),
      "사용자가 손댔을 수 있는 파일이므로 지우지 않는다");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("runFull: 같은 방식으로 재설치하면 가짜 충돌 없이 조용히 끝난다", () => {
  const target = springTarget();
  try {
    install(target, "nginx");
    const again = install(target, "nginx");
    assert.strictEqual(again.workflows.copiedFiles.length, 0,
      "트리거 활성화본이 baseline과 같아야 재실행이 unchanged로 떨어진다");
    assert.deepStrictEqual(again.competing, []);
  } finally { rmSync(target, { recursive: true, force: true }); }
});
