// tests/node/verify-and-install-log.test.js
// 설치 후 검증(이슈 #81)·필요 Secret 안내(이슈 #80)·설치 로그(이슈 #79) 회귀.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanUnsubstituted, collectRequiredSecrets, narrowSecretsBySshAuth } from "../../src/core/verify.js";
import { stampFrom, logFilename, renderInstallLog, maskValue, LOG_DIR } from "../../src/core/install-log.js";
import { setEnvLine } from "../../src/core/wizard-env.js";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { makeResolvers } from "../../src/core/detect-fs.js";

function wfDirWith(files) {
  const root = mkdtempSync(join(tmpdir(), "paw-verify-"));
  mkdirSync(root, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(root, name), body);
  return root;
}

// ── 미치환 플레이스홀더 스캔 (#81) ──────────────────────────────────
test("scanUnsubstituted: 남아 있는 __TOKEN__을 파일·줄과 함께 보고한다", () => {
  const dir = wfDirWith({ "A.yaml": 'env:\n  DIR: "__APPLICATION_YML_DIR__"\n' });
  try {
    const found = scanUnsubstituted(dir, ["A.yaml"]);
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].token, "__APPLICATION_YML_DIR__");
    assert.strictEqual(found[0].line, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("scanUnsubstituted: heredoc 구분자(__SUH_*__)는 치환 대상이 아니므로 무시한다", () => {
  const dir = wfDirWith({ "A.yaml": "run: |\n  cat <<'__SUH_FILE_CONTENT_EOF__'\n" });
  try {
    assert.deepStrictEqual(scanUnsubstituted(dir, ["A.yaml"]), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("scanUnsubstituted: 주석 처리된 줄은 실행되지 않으므로 세지 않는다", () => {
  const dir = wfDirWith({ "A.yaml": '#  DIR: "__APPLICATION_YML_DIR__"\n' });
  try {
    assert.deepStrictEqual(scanUnsubstituted(dir, ["A.yaml"]), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── 필요 Secret 수집 (#80) ──────────────────────────────────────────
test("collectRequiredSecrets: 사용하는 워크플로우까지 함께 모은다", () => {
  const dir = wfDirWith({
    "A.yaml": "x: ${{ secrets.SERVER_HOST }}\n",
    "B.yaml": "y: ${{ secrets.SERVER_HOST }}\nz: ${{ secrets.DOCKERHUB_TOKEN }}\n",
  });
  try {
    const s = collectRequiredSecrets(dir, ["A.yaml", "B.yaml"]);
    assert.deepStrictEqual(s.get("SERVER_HOST"), ["A.yaml", "B.yaml"]);
    assert.deepStrictEqual(s.get("DOCKERHUB_TOKEN"), ["B.yaml"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("collectRequiredSecrets: 자동 주입(GITHUB_TOKEN)과 폴백이 있는 선택 secret은 필수에서 뺀다", () => {
  const dir = wfDirWith({
    "A.yaml": "a: ${{ secrets.GITHUB_TOKEN }}\nb: ${{ secrets.AI_API_KEY }}\nc: ${{ secrets.WORKFLOW_PAT }}\n",
  });
  try {
    assert.strictEqual(collectRequiredSecrets(dir, ["A.yaml"]).size, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("collectRequiredSecrets: 주석 안의 [선택] 예시 스텝은 필수 secret으로 세지 않는다", () => {
  const dir = wfDirWith({ "A.yaml": "#     FIREBASE_KEY_JSON: ${{ secrets.FIREBASE_KEY_JSON }}\n" });
  try {
    assert.strictEqual(collectRequiredSecrets(dir, ["A.yaml"]).size, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("narrowSecretsBySshAuth: 고른 인증 방식에 안 쓰이는 쪽을 목록에서 뺀다", () => {
  const base = new Map([["SERVER_PASSWORD", ["A"]], ["SSH_KEY", ["A"]]]);
  assert.ok(!narrowSecretsBySshAuth(base, "key").has("SERVER_PASSWORD"));
  assert.ok(!narrowSecretsBySshAuth(base, "password").has("SSH_KEY"));
  assert.strictEqual(narrowSecretsBySshAuth(base, "").size, 2, "미지정이면 좁히지 않는다");
});

// ── 홑따옴표 치환 (#81) ─────────────────────────────────────────────
test("setEnvLine: 홑따옴표 값도 치환하고 결과는 겹따옴표로 통일한다", () => {
  const out = setEnvLine("  SSH_PORT: '2022'  # @wizard ask:2022", "SSH_PORT", "22");
  assert.strictEqual(out, '  SSH_PORT: "22"');
});

// ── 설치 로그 (#79) ─────────────────────────────────────────────────
test("stampFrom/logFilename: 시각이 곧 정렬 가능한 파일명이 된다", () => {
  assert.strictEqual(stampFrom("2026-08-12 18:15:30"), "20260812-181530");
  assert.strictEqual(logFilename("2026-08-12 18:15:30", "install"), "20260812-181530-install.md");
});

test("maskValue: 비밀로 보이는 키는 가리되 인증 '방식'은 그대로 둔다", () => {
  assert.strictEqual(maskValue("SERVER_PASSWORD", "hunter2"), "***");
  assert.strictEqual(maskValue("SSH_AUTH_METHOD", "password"), "password");
  assert.strictEqual(maskValue("SERVICE_DOMAIN", "api.example.com"), "api.example.com");
});

test("renderInstallLog: 감지 근거·답변·미치환·필요 secret이 모두 기록된다", () => {
  const md = renderInstallLog({
    action: "install", at: "2026-08-12 18:15:30", templateVersion: "0.2.2", mode: "full",
    types: ["spring"], markers: new Map([["spring", "build.gradle.kts"]]),
    version: "1.4.2", branch: "main", paths: new Map([["spring", "."]]),
    options: { nexus: false, secretBackup: true, semverAuto: true },
    answers: [{ key: "SERVICE_DOMAIN", label: "서비스 도메인", value: "api.example.com", isDefault: false, scope: "spring" }],
    result: { copiedFiles: ["PROJECT-SPRING-SIMPLE-CICD.yaml"] },
    unresolved: [{ filename: "A.yaml", line: 3, token: "__X__" }],
    secrets: new Map([["SERVER_HOST", ["A.yaml"]]]),
  });
  assert.match(md, /^---\n/, "에이전트가 파싱할 front matter로 시작해야 한다");
  assert.match(md, /build\.gradle\.kts/, "감지 근거 파일");
  assert.match(md, /api\.example\.com/, "사용자 답변");
  assert.match(md, /__X__/, "미치환 항목");
  assert.match(md, /SERVER_HOST/, "등록해야 할 secret");
  assert.match(md, /unresolved_count: 1/);
});

// ── 실제 설치 경로 e2e ──────────────────────────────────────────────
test("runFull: Kotlin DSL + application.yaml 프로젝트에서 미치환 없이 설치되고 로그가 남는다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-e2e-detect-"));
  try {
    mkdirSync(join(target, "src/main/resources"), { recursive: true });
    writeFileSync(join(target, "src/main/resources/application.yaml"), "");
    writeFileSync(join(target, "build.gradle.kts"),
      'version = "3.2.1"\njava { toolchain { languageVersion = JavaLanguageVersion.of(25) } }\n');

    const paths = new Map([["spring", "."]]);
    const ctx = createContext({
      mode: "full", force: true, types: ["spring"], version: "3.2.1", versionCode: 1,
      branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
      paths, repoName: "acme-svc", resolvers: makeResolvers(target, "acme-svc", paths),
      now: "2026-08-12 18:15:30", today: "2026-08-12", templateVersion: "0.2.2",
      markers: new Map([["spring", "build.gradle.kts"]]),
    });
    const result = runFull(ctx, resolvePayloadRoot(), target);

    assert.deepStrictEqual(result.unresolved, [], "auto 토큰이 전부 채워져야 한다");
    assert.ok(result.secrets.has("SERVER_HOST"), "배포 워크플로우가 요구하는 secret이 안내돼야 한다");
    assert.ok(!result.secrets.has("WORKFLOW_PAT"), "선택 secret은 필수 목록에 없어야 한다");

    const wf = readFileSync(join(target, ".github/workflows/PROJECT-SPRING-SIMPLE-CICD.yaml"), "utf8");
    assert.match(wf, /JAVA_VERSION: "25"/, "toolchain 실측값이 들어가야 한다");
    assert.match(wf, /APPLICATION_YML_DIR: "src\/main\/resources"/, ".yaml도 찾아야 한다");

    const logDir = join(target, LOG_DIR);
    assert.ok(existsSync(logDir), "설치 로그 폴더가 생성돼야 한다");
    const logs = readdirSync(logDir);
    assert.deepStrictEqual(logs, ["20260812-181530-install.md"]);
    assert.match(readFileSync(join(logDir, logs[0]), "utf8"), /build\.gradle\.kts/);

    // version.yml의 마커 주석도 실제 파일이어야 한다 (감지 로그와 같은 근거)
    assert.match(readFileSync(join(target, "version.yml"), "utf8"), /spring: "\." # build\.gradle\.kts/);
  } finally { rmSync(target, { recursive: true, force: true }); }
});
