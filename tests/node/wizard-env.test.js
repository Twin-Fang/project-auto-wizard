// tests/node/wizard-env.test.js
import { test } from "node:test";
import assert from "node:assert";
import {
  parseWizardLine, setEnvLine, setFallbackLine, resolveToken, substituteEnv, isUnchanged, replaceProjectTokens,
} from "../../src/core/wizard-env.js";
import { makeResolvers } from "../../src/core/detect-fs.js";

test("parseWizardLine: ask marker parses key/action/arg", () => {
  const line = `  PROJECT_NAME: "app" # @wizard ask:@repo`;
  const p = parseWizardLine(line);
  assert.deepStrictEqual(p, { indent: "  ", key: "PROJECT_NAME", action: "ask", arg: "@repo" });
});

test("parseWizardLine: auto marker parses", () => {
  const p = parseWizardLine(`REPO: "x" # @wizard auto:repo`);
  assert.strictEqual(p.action, "auto");
  assert.strictEqual(p.arg, "repo");
});

test("parseWizardLine: no marker -> null", () => {
  assert.strictEqual(parseWizardLine(`PROJECT_NAME: "app"`), null);
});

test("setEnvLine: replaces quoted value and strips wizard comment", () => {
  const out = setEnvLine(`  KEY: "old" # @wizard ask:x`, "KEY", "new");
  assert.strictEqual(out, `  KEY: "new"`);
});

test("setEnvLine: empty value leaves line untouched", () => {
  const line = `  KEY: "old" # @wizard ask:x`;
  assert.strictEqual(setEnvLine(line, "KEY", ""), line);
});

test("setEnvLine: preserves CRLF line ending", () => {
  const out = setEnvLine(`KEY: "old" # @wizard ask:x\r`, "KEY", "new");
  assert.strictEqual(out, `KEY: "new"\r`);
});

test("resolveToken: calls the matching resolver with type", () => {
  const resolvers = { repo: (t) => `repo-for-${t}` };
  assert.strictEqual(resolveToken("repo", "flutter", resolvers), "repo-for-flutter");
});

test("resolveToken: unknown token name -> empty string", () => {
  assert.strictEqual(resolveToken("unknown", "flutter", {}), "");
});

test("substituteEnv: no @wizard marker anywhere -> content returned unchanged", () => {
  const content = "plain: yaml\n";
  assert.strictEqual(substituteEnv(content, {}), content);
});

test("substituteEnv: auto marker resolves via resolver, ask marker uses default", () => {
  const content = [
    `REPO: "x" # @wizard auto:repo`,
    `NAME: "y" # @wizard ask:default-name`,
  ].join("\n");
  const out = substituteEnv(content, {
    resolvers: { repo: () => "my-repo" },
    useDefaults: true,
  });
  assert.match(out, /REPO: "my-repo"/);
  assert.match(out, /NAME: "default-name"/);
});

test("substituteEnv: ask marker uses provided value when useDefaults=false", () => {
  const content = `NAME: "default" # @wizard ask:default`;
  const values = new Map([["NAME", "chosen"]]);
  const out = substituteEnv(content, { values, useDefaults: false });
  assert.match(out, /NAME: "chosen"/);
});

test("substituteEnv: __PROJECT_NAME__/__APP_ARTIFACT_NAME__ global tokens replaced with repoName", () => {
  // substituteEnv는 content에 "@wizard" 문자열이 전혀 없으면 조기 반환하므로(코드 54행),
  // 전역 토큰만 단독으로 있는 파일에서는 절대 치환되지 않는다 — 최소 1개의 @wizard 마커가
  // 함께 있는 실제 워크플로우 파일 형태로 테스트해야 한다.
  const content = [
    `KEY: "v" # @wizard ask:x`,
    `label: __PROJECT_NAME__`,
    `artifact: __APP_ARTIFACT_NAME__`,
  ].join("\n");
  const out = substituteEnv(content, { repoName: "my-app", values: new Map() });
  assert.match(out, /label: my-app/);
  assert.match(out, /artifact: my-app/);
});

test("substituteEnv: collectAsks Map stores the repoName-substituted value, not the raw __PROJECT_NAME__ literal (issue #114)", () => {
  const content = `VOLUME_CONTAINER_PATH: "/mnt/__PROJECT_NAME__" # @wizard ask:/mnt/__PROJECT_NAME__`;
  const collectAsks = new Map();
  substituteEnv(content, { repoName: "claude-window-keeper", useDefaults: true, collectAsks });
  assert.strictEqual(collectAsks.get("VOLUME_CONTAINER_PATH"), "/mnt/claude-window-keeper");
});

test("replaceProjectTokens: replaces both tokens with repoName", () => {
  const out = replaceProjectTokens("host:__PROJECT_NAME__ artifact:__APP_ARTIFACT_NAME__", "my-app");
  assert.strictEqual(out, "host:my-app artifact:my-app");
});

test("replaceProjectTokens: text without tokens is returned unchanged", () => {
  const out = replaceProjectTokens("no tokens here", "my-app");
  assert.strictEqual(out, "no tokens here");
});

test("substituteEnv: paths-anchor comment replaced when projectPath != '.'", () => {
  const content = [
    `KEY: "v" # @wizard ask:x`,
    `  # @wizard paths-anchor`,
  ].join("\n");
  const out = substituteEnv(content, { projectPath: "app", values: new Map() });
  assert.match(out, /paths: \['app\/\*\*'\]/);
});

test("isUnchanged: byte-identical to a fresh default-substituted render -> true", () => {
  const template = `NAME: "default" # @wizard ask:default`;
  const installed = substituteEnv(template, { useDefaults: true });
  assert.strictEqual(isUnchanged(template, installed, {}), true);
});

test("isUnchanged: user-edited installed content -> false", () => {
  const template = `NAME: "default" # @wizard ask:default`;
  const installed = `NAME: "user-edited-value"`;
  assert.strictEqual(isUnchanged(template, installed, {}), false);
});

test("setEnvLine: escapes double quotes in the substituted value so YAML structure stays intact", () => {
  const out = setEnvLine(`KEY: "old" # @wizard ask:x`, "KEY", 'value with "quotes"');
  assert.strictEqual(out, `KEY: "value with \\"quotes\\""`);
});

test("setEnvLine: escapes backslashes so a literal backslash isn't consumed by the quote-escape", () => {
  const out = setEnvLine(`KEY: "old" # @wizard ask:x`, "KEY", "back\\slash");
  assert.strictEqual(out, `KEY: "back\\\\slash"`);
});

test("substituteEnv: an ask value containing double quotes produces valid quoted YAML (issue #20 L9)", () => {
  const content = `NAME: "default" # @wizard ask:default`;
  const values = new Map([["NAME", 'a "quoted" value']]);
  const out = substituteEnv(content, { values, useDefaults: false });
  assert.strictEqual(out, `NAME: "a \\"quoted\\" value"`);
});

// ── @wizard fallback (이슈 #131) ─────────────────────────────────
// 값이 `${{ 런타임값 || 'literal' }}` 표현식인 줄은 setEnvLine의 따옴표 값 치환으로는 다룰 수 없다.
// 마지막 홑따옴표 리터럴(= 런타임 값이 모두 비었을 때의 기본값)만 바꾼다.
const FALLBACK_LINE = `  DEPLOY_MODE: \${{ github.event.inputs.deploy_mode || vars.ANDROID_DEPLOY_MODE || 'store_only' }}  # @wizard fallback:android-deploy-mode`;

test("parseWizardLine: fallback 마커를 파싱한다", () => {
  assert.deepStrictEqual(parseWizardLine(FALLBACK_LINE), {
    indent: "  ", key: "DEPLOY_MODE", action: "fallback", arg: "android-deploy-mode",
  });
});

test("setFallbackLine: 마지막 홑따옴표 리터럴만 교체하고 마커 주석을 제거한다", () => {
  assert.strictEqual(
    setFallbackLine(FALLBACK_LINE, "store_submit"),
    `  DEPLOY_MODE: \${{ github.event.inputs.deploy_mode || vars.ANDROID_DEPLOY_MODE || 'store_submit' }}`,
  );
});

test("setFallbackLine: 리터럴이 여러 개면 마지막 것만 바꾼다", () => {
  const line = `  X: \${{ inputs.a == 'x' && 'y' || 'z' }}  # @wizard fallback:t`;
  assert.strictEqual(setFallbackLine(line, "w"), `  X: \${{ inputs.a == 'x' && 'y' || 'w' }}`);
});

test("setFallbackLine: 값이 빈 문자열이면 줄을 그대로 둔다 (setEnvLine과 같은 규약 — 템플릿 기본값 유지)", () => {
  assert.strictEqual(setFallbackLine(FALLBACK_LINE, ""), FALLBACK_LINE);
  assert.strictEqual(setFallbackLine(FALLBACK_LINE, undefined), FALLBACK_LINE);
});

test("setFallbackLine: 새 값이 기존 리터럴과 같아도 마커 주석은 제거한다", () => {
  assert.ok(!setFallbackLine(FALLBACK_LINE, "store_only").includes("@wizard"));
});

test("setFallbackLine: 값 안의 홑따옴표는 표현식 규칙대로 두 개로 이스케이프한다", () => {
  assert.match(setFallbackLine(FALLBACK_LINE, "a'b"), /\|\| 'a''b' \}\}$/);
});

test("setFallbackLine: 표현식에 홑따옴표 리터럴이 없으면 줄을 그대로 둔다", () => {
  const line = `  X: \${{ vars.A }}  # @wizard fallback:t`;
  assert.strictEqual(setFallbackLine(line, "v"), line);
});

test("setFallbackLine: CRLF 줄 끝을 보존한다", () => {
  assert.strictEqual(
    setFallbackLine(`${FALLBACK_LINE}\r`, "store_prepare"),
    `  DEPLOY_MODE: \${{ github.event.inputs.deploy_mode || vars.ANDROID_DEPLOY_MODE || 'store_prepare' }}\r`,
  );
});

test("substituteEnv: fallback 줄은 resolver 값으로 교체되고 auto 줄과 함께 처리된다", () => {
  const content = [
    `env:`,
    `  ENV_MODE: "dart-define"  # @wizard auto:flutter-env-mode`,
    FALLBACK_LINE,
  ].join("\n");
  const out = substituteEnv(content, {
    type: "flutter",
    resolvers: { "flutter-env-mode": () => "dotenv", "android-deploy-mode": () => "store_prepare" },
  });
  assert.strictEqual(out, [
    `env:`,
    `  ENV_MODE: "dotenv"`,
    `  DEPLOY_MODE: \${{ github.event.inputs.deploy_mode || vars.ANDROID_DEPLOY_MODE || 'store_prepare' }}`,
  ].join("\n"));
});

test("substituteEnv: resolver가 빈 값을 주면 fallback 줄의 템플릿 기본값이 남는다", () => {
  const out = substituteEnv(FALLBACK_LINE, { type: "flutter", resolvers: { "android-deploy-mode": () => "" } });
  assert.strictEqual(out, FALLBACK_LINE);
});

test("substituteEnv: CRLF 파일의 fallback 줄도 처리하고 EOL을 유지한다", () => {
  const content = ["env:", FALLBACK_LINE, ""].join("\r\n");
  const out = substituteEnv(content, { type: "flutter", resolvers: { "android-deploy-mode": () => "store_submit" } });
  assert.strictEqual(
    out,
    ["env:", `  DEPLOY_MODE: \${{ github.event.inputs.deploy_mode || vars.ANDROID_DEPLOY_MODE || 'store_submit' }}`, ""].join("\r\n"),
  );
});

test("isUnchanged: 배포 모드가 바뀌면 같은 원본이라도 설치본과 달라진다 (다음 실행이 upstream 변경으로 갱신하도록)", () => {
  const template = FALLBACK_LINE;
  const resolversFor = (mode) => ({ "android-deploy-mode": () => mode });
  const installed = substituteEnv(template, { type: "flutter", resolvers: resolversFor("store_only") });
  assert.strictEqual(isUnchanged(template, installed, { type: "flutter", resolvers: resolversFor("store_only") }), true);
  assert.strictEqual(isUnchanged(template, installed, { type: "flutter", resolvers: resolversFor("store_submit") }), false);
});

// ── makeResolvers: 프로젝트 경로·Flutter 토큰 ────────────────────
test("makeResolvers: project-path는 타입별 경로를 돌려주고 없으면 '.'이다", () => {
  const r = makeResolvers("/nonexistent", "repo", new Map([["flutter", "app"]]));
  assert.strictEqual(resolveToken("project-path", "flutter", r), "app");
  assert.strictEqual(resolveToken("project-path", "react", r), ".");
  assert.strictEqual(resolveToken("project-path", "common", r), ".");
});

test("makeResolvers: flutterOptions가 없으면 Flutter 토큰은 빈 값이다 (템플릿 기본값이 남는다)", () => {
  const r = makeResolvers("/nonexistent", "repo", new Map());
  assert.strictEqual(resolveToken("flutter-env-mode", "flutter", r), "");
  assert.strictEqual(resolveToken("android-deploy-mode", "flutter", r), "");
  assert.strictEqual(resolveToken("ios-deploy-mode", "flutter", r), "");
});

test("makeResolvers: flutterOptions가 있으면 환경변수 방식·플랫폼별 배포 모드를 돌려준다", () => {
  const r = makeResolvers("/nonexistent", "repo", new Map(), {
    envMode: "dotenv", stores: ["android"], androidDeployMode: "store_prepare", iosDeployMode: "store_submit",
  });
  assert.strictEqual(resolveToken("flutter-env-mode", "flutter", r), "dotenv");
  assert.strictEqual(resolveToken("android-deploy-mode", "flutter", r), "store_prepare");
  assert.strictEqual(resolveToken("ios-deploy-mode", "flutter", r), "store_submit");
});

test("makeResolvers: 기존 resolver(repo, flutter-root)는 그대로 동작한다", () => {
  const r = makeResolvers("/nonexistent", "my-repo", new Map([["flutter", "app"]]));
  assert.strictEqual(resolveToken("repo", "flutter", r), "my-repo");
  assert.strictEqual(resolveToken("flutter-root", "flutter", r), "app");
});
