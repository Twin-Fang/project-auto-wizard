// tests/node/wizard-env.test.js
import { test } from "node:test";
import assert from "node:assert";
import {
  parseWizardLine, setEnvLine, resolveToken, substituteEnv, isUnchanged, replaceProjectTokens,
} from "../../src/core/wizard-env.js";

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
