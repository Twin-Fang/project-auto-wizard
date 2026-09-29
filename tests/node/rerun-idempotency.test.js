// tests/node/rerun-idempotency.test.js
// 같은 설치를 다시 돌리거나 업스트림 갱신을 받을 때 결과가 흔들리지 않아야 한다.
//  - 무변경 재실행: version.yml deploy 블록·필요 Secret·기록 파일이 그대로
//  - 자동 갱신: 설치 때 답한 배포 값(deploy 블록)이 템플릿 기본값으로 되돌아가지 않음
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull, postInstallNotices } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { makeResolvers } from "../../src/core/detect-fs.js";
import { parseExisting } from "../../src/core/version-yml.js";
import { collectAsks } from "../../src/ui/env-plan.js";
import { readSavedDeployValues } from "../../src/core/copy/workflows.js";

const PAYLOAD = resolvePayloadRoot();
const WF = ".github/workflows";
const SIMPLE = "PROJECT-SPRING-SIMPLE-CICD.yaml";

function springRepo() {
  const dir = mkdtempSync(join(tmpdir(), "paw-rerun-"));
  mkdirSync(join(dir, "src", "main", "resources"), { recursive: true });
  writeFileSync(join(dir, "build.gradle"), "version = '1.0.0'\n");
  writeFileSync(join(dir, "src", "main", "resources", "application.yml"), "a: 1\n");
  return dir;
}

function ctx(dir, extra = {}) {
  const paths = new Map([["spring", "."]]);
  return createContext({
    mode: "full", force: true, types: ["spring"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths, repoName: "my-service", resolvers: makeResolvers(dir, "my-service", paths),
    templateVersion: "0.12.2", deployStyle: "simple", ...extra,
  });
}

// 사용자가 설치 때 DEPLOY_PORT=9090, SSH_AUTH_METHOD=password로 답한 상태를 만든다.
function installWithAnswers(dir, payload = PAYLOAD) {
  const envValues = new Map([["DEPLOY_PORT", "9090"], ["SSH_AUTH_METHOD", "password"]]);
  return runFull(ctx(dir, { envValues, envUseDefaults: false, now: "2026-01-01 00:00:00", today: "2026-01-01" }), payload, dir);
}

test("무변경 재실행: deploy 블록과 필요 Secret이 그대로이고 기록 파일도 다시 쓰지 않는다", () => {
  const dir = springRepo();
  try {
    const first = installWithAnswers(dir);
    const vy1 = readFileSync(join(dir, "version.yml"), "utf8");
    const bl1 = readFileSync(join(dir, ".github", ".wizard", "baseline.json"), "utf8");
    assert.match(vy1, /^deploy:/m);
    assert.match(vy1, /DEPLOY_PORT: "9090"/);

    const second = runFull(ctx(dir, { now: "2026-01-02 00:00:00", today: "2026-01-02" }), PAYLOAD, dir);
    assert.strictEqual(readFileSync(join(dir, "version.yml"), "utf8"), vy1, "version.yml이 바뀌면 안 된다");
    assert.strictEqual(readFileSync(join(dir, ".github", ".wizard", "baseline.json"), "utf8"), bl1, "baseline이 바뀌면 안 된다");
    assert.deepStrictEqual([...second.secrets.keys()].sort(), [...first.secrets.keys()].sort());
    assert.ok(!second.secrets.has("SSH_KEY"), "password 인증이면 SSH_KEY를 요구하지 않는다");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("업스트림 자동 갱신: 설치 때 답한 배포 값이 기본값으로 되돌아가지 않는다", () => {
  const dir = springRepo();
  const payload = mkdtempSync(join(tmpdir(), "paw-rerun-payload-"));
  try {
    cpSync(PAYLOAD, payload, { recursive: true });
    installWithAnswers(dir, payload);
    const wf = join(dir, WF, SIMPLE);
    assert.match(readFileSync(wf, "utf8"), /DEPLOY_PORT: "9090"/);

    // 업스트림이 SIMPLE-CICD를 고쳤다 — 사용자는 파일에 손대지 않았으므로 자동 갱신 대상
    const tpl = join(payload, "workflows", "spring", "server-deploy", SIMPLE);
    writeFileSync(tpl, readFileSync(tpl, "utf8") + "\n# upstream change\n");
    const r = runFull(ctx(dir), payload, dir);

    assert.ok(r.workflows.autoUpdated.includes(SIMPLE), "사용자 미수정 파일은 자동 갱신되어야 한다");
    const after = readFileSync(wf, "utf8");
    assert.match(after, /# upstream change/);
    assert.match(after, /DEPLOY_PORT: "9090"/, "저장된 값이 유지되어야 한다");
    assert.match(readFileSync(join(dir, "version.yml"), "utf8"), /DEPLOY_PORT: "9090"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(payload, { recursive: true, force: true });
  }
});

test("대화형 env 질문은 저장된 deploy 값을 기본값으로 보여준다", () => {
  const dir = springRepo();
  try {
    installWithAnswers(dir);
    const paths = new Map([["spring", "."]]);
    const asks = collectAsks(PAYLOAD, ["spring"], {
      resolvers: makeResolvers(dir, "my-service", paths), deployStyle: "simple",
      saved: readSavedDeployValues(dir),
    });
    assert.strictEqual(asks.defaults.get("DEPLOY_PORT"), "9090");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("parseExisting: deploy 블록을 타입별 값으로 읽고 이스케이프를 푼다", () => {
  const vy = [
    'version: "1.0.0"',
    "",
    "deploy: # 마법사가 기억하는 배포 설정",
    "  spring:",
    '    DEPLOY_PORT: "9090"',
    '    CONTAINER_NAME: "my-\\"svc\\""',
    "  go:",
    '    SSH_AUTH_METHOD: "key"',
    "",
  ].join("\n");
  const { deploy } = parseExisting(vy);
  assert.strictEqual(deploy.get("spring").get("DEPLOY_PORT"), "9090");
  assert.strictEqual(deploy.get("spring").get("CONTAINER_NAME"), 'my-"svc"');
  assert.strictEqual(deploy.get("go").get("SSH_AUTH_METHOD"), "key");
});

test("재실행에서 값을 새로 답하면 사용자 미수정 파일과 deploy 블록에 반영된다", () => {
  const dir = springRepo();
  try {
    installWithAnswers(dir);
    const envValues = new Map([["DEPLOY_PORT", "7070"]]);
    runFull(ctx(dir, { envValues, envUseDefaults: false }), PAYLOAD, dir);
    assert.match(readFileSync(join(dir, WF, SIMPLE), "utf8"), /DEPLOY_PORT: "7070"/);
    const vy = readFileSync(join(dir, "version.yml"), "utf8");
    assert.match(vy, /DEPLOY_PORT: "7070"/);
    assert.match(vy, /SSH_AUTH_METHOD: "password"/, "새로 답하지 않은 값은 저장값을 유지한다");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("--force 충돌 스킵 파일은 다음 실행에서도 충돌로 남는다 (업스트림 무변경으로 오분류 금지)", () => {
  const dir = springRepo();
  const payload = mkdtempSync(join(tmpdir(), "paw-rerun-payload-"));
  try {
    cpSync(PAYLOAD, payload, { recursive: true });
    runFull(ctx(dir), payload, dir);
    const CI = "PROJECT-SPRING-CI.yml";
    const wf = join(dir, WF, CI);
    writeFileSync(wf, readFileSync(wf, "utf8") + "\n# my edit\n");
    const tpl = join(payload, "workflows", "spring", CI);
    writeFileSync(tpl, readFileSync(tpl, "utf8") + "\n# upstream change\n");

    const first = runFull(ctx(dir), payload, dir);
    assert.deepStrictEqual(first.workflows.conflictKept, [CI]);
    assert.match(postInstallNotices(first).join("\n"), /충돌 1개/);

    const second = runFull(ctx(dir), payload, dir);
    assert.deepStrictEqual(second.workflows.conflictKept, [CI], "두 번째 실행에서도 충돌이어야 한다");
    assert.ok(!second.workflows.keptLocal.includes(CI), "업스트림 무변경(localOnly)으로 분류되면 안 된다");
    assert.match(readFileSync(wf, "utf8"), /# my edit/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(payload, { recursive: true, force: true });
  }
});
