// tests/node/deploy-style.test.js
// 배포 방식 선택 (이슈 #80) — CD 워크플로우는 서로 대체재라 하나만 설치하고 트리거를 켠다.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  deployFilter, isDeployWorkflow, activateDeployTrigger, isDeployStyle, DEFAULT_DEPLOY_STYLE,
} from "../../src/core/deploy-style.js";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { makeResolvers } from "../../src/core/detect-fs.js";
import { parseArgs } from "../../src/cli/args.js";
import { parseTemplateOptions } from "../../src/core/version-yml.js";

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

test("isDeployWorkflow: CD 본체만 선택 대상이다", () => {
  assert.ok(isDeployWorkflow(SIMPLE) && isDeployWorkflow(NGINX) && isDeployWorkflow(TRAEFIK));
  assert.ok(!isDeployWorkflow(PREVIEW));
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

test("--deploy-style: 값 검증", () => {
  assert.strictEqual(parseArgs(["--deploy-style", "nginx"]).deployStyle, "nginx");
  assert.strictEqual(parseArgs([]).deployStyle, "", "미지정은 빈값 → 저장값 또는 기본값(simple)");
  assert.throws(() => parseArgs(["--deploy-style", "k8s"]), /deploy-style/);
  assert.throws(() => parseArgs(["--deploy-style"]), /deploy-style/);
  assert.ok(isDeployStyle("traefik") && !isDeployStyle("k8s") && !isDeployStyle("all"));
  assert.strictEqual(DEFAULT_DEPLOY_STYLE, "simple");
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

test("runFull: 방식을 지정하지 않으면 기본값(단일 서버)만 설치된다", () => {
  const target = springTarget();
  try {
    install(target, "");
    const files = readdirSync(join(target, ".github/workflows")).filter((f) => f.includes("SPRING"));
    assert.deepStrictEqual(files.sort(), [PREVIEW, SIMPLE].sort(),
      "CD는 하나만 — 넷을 다 깔면 안 쓸 워크플로우가 쌓이고 질문만 늘어난다");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("runFull: 방식을 바꾸면 손대지 않은 이전 CD는 삭제한다 — 남기면 배포가 두 번 돈다", () => {
  const target = springTarget();
  try {
    install(target, "simple");
    const r = install(target, "nginx");

    assert.deepStrictEqual(r.cleanup.removed, [SIMPLE]);
    assert.deepStrictEqual(r.cleanup.backedUp, []);
    const files = readdirSync(join(target, ".github/workflows"));
    assert.ok(!files.includes(SIMPLE), "마법사가 깐 파일은 마법사가 정리한다");
    assert.ok(files.includes(NGINX));
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("runFull: 사용자가 손댄 이전 CD는 지우지 않고 .bak으로 옮긴다", () => {
  const target = springTarget();
  try {
    install(target, "simple");
    const p = join(target, ".github/workflows", SIMPLE);
    writeFileSync(p, readFileSync(p, "utf8") + "\n# 내가 고친 부분\n");

    const r = install(target, "nginx");
    assert.deepStrictEqual(r.cleanup.backedUp, [SIMPLE]);
    assert.deepStrictEqual(r.cleanup.removed, []);
    assert.match(readFileSync(`${p}.bak`, "utf8"), /내가 고친 부분/, "수정 내용은 보존해야 한다");
    assert.ok(!readdirSync(join(target, ".github/workflows")).includes(SIMPLE), "트리거는 죽어야 한다");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("runFull: 정리한 파일은 baseline에서도 빠져 다음 실행에서 '사용자가 지웠다'로 오인되지 않는다", () => {
  const target = springTarget();
  try {
    install(target, "simple");
    install(target, "nginx");
    const again = install(target, "nginx");
    assert.deepStrictEqual(again.cleanup.removed, []);
    assert.deepStrictEqual(again.workflows.removedKept, []);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("runFull: 같은 방식으로 재설치하면 가짜 충돌 없이 조용히 끝난다", () => {
  const target = springTarget();
  try {
    install(target, "nginx");
    const again = install(target, "nginx");
    assert.strictEqual(again.workflows.copiedFiles.length, 0,
      "트리거 활성화본이 baseline과 같아야 재실행이 unchanged로 떨어진다");
    assert.deepStrictEqual(again.cleanup.removed, []);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("deployFilter: 알 수 없는 값은 전부 통과가 아니라 기본값으로 수렴한다", () => {
  // endsWith("")가 항상 참이라, 빈 접미사를 돌려주면 잘못된 값이 조용히 "CD 전부 설치"로 샌다.
  const keep = deployFilter("잘못된값");
  assert.ok(keep(SIMPLE));
  assert.ok(!keep(NGINX));
  assert.ok(!keep(TRAEFIK));
});

test("version.yml의 deploy_style은 인라인 주석을 값으로 먹지 않는다", () => {
  const vy = 'metadata:\n  template:\n    options:\n      deploy_style: "nginx" # simple | nginx | traefik\n';
  assert.strictEqual(parseTemplateOptions(vy).deployStyle, "nginx");
});
