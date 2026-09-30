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
  // substituteEnv returns early when content has no "@wizard" string at all (code line 54),
  // so a file with only a global token is never substituted — it must be tested in the shape of a real
  // workflow file that also has at least one @wizard marker.
  const content = [
    `KEY: "v" # @wizard ask:x`,
    `label: __PROJECT_NAME__`,
    `artifact: __APP_ARTIFACT_NAME__`,
  ].join("\n");
  const out = substituteEnv(content, { repoName: "my-app", values: new Map() });
  assert.match(out, /label: my-app/);
  assert.match(out, /artifact: my-app/);
});

test("substituteEnv: collectAsks Map stores the repoName-substituted value, not the raw __PROJECT_NAME__ literal", () => {
  const content = `VOLUME_CONTAINER_PATH: "/mnt/__PROJECT_NAME__" # @wizard ask:/mnt/__PROJECT_NAME__`;
  const collectAsks = new Map();
  substituteEnv(content, { repoName: "my-service", useDefaults: true, collectAsks });
  assert.strictEqual(collectAsks.get("VOLUME_CONTAINER_PATH"), "/mnt/my-service");
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

test("substituteEnv: an ask value containing double quotes produces valid quoted YAML", () => {
  const content = `NAME: "default" # @wizard ask:default`;
  const values = new Map([["NAME", 'a "quoted" value']]);
  const out = substituteEnv(content, { values, useDefaults: false });
  assert.strictEqual(out, `NAME: "a \\"quoted\\" value"`);
});

// ── @wizard fallback ─────────────────────────────────
// A line whose value is a `${{ runtimeValue || 'literal' }}` expression cannot be handled by setEnvLine's quoted-value substitution.
// Only the last single-quoted literal (= the default when all runtime values are empty) is replaced.
const FALLBACK_LINE = `  DEPLOY_MODE: \${{ github.event.inputs.deploy_mode || vars.ANDROID_DEPLOY_MODE || 'store_only' }}  # @wizard fallback:android-deploy-mode`;

test("parseWizardLine: parses a fallback marker", () => {
  assert.deepStrictEqual(parseWizardLine(FALLBACK_LINE), {
    indent: "  ", key: "DEPLOY_MODE", action: "fallback", arg: "android-deploy-mode",
  });
});

test("setFallbackLine: replaces only the last single-quoted literal and removes the marker comment", () => {
  assert.strictEqual(
    setFallbackLine(FALLBACK_LINE, "store_submit"),
    `  DEPLOY_MODE: \${{ github.event.inputs.deploy_mode || vars.ANDROID_DEPLOY_MODE || 'store_submit' }}`,
  );
});

test("setFallbackLine: with several literals, changes only the last one", () => {
  const line = `  X: \${{ inputs.a == 'x' && 'y' || 'z' }}  # @wizard fallback:t`;
  assert.strictEqual(setFallbackLine(line, "w"), `  X: \${{ inputs.a == 'x' && 'y' || 'w' }}`);
});

test("setFallbackLine: an empty value leaves the line as is (same convention as setEnvLine — keeps the template default)", () => {
  assert.strictEqual(setFallbackLine(FALLBACK_LINE, ""), FALLBACK_LINE);
  assert.strictEqual(setFallbackLine(FALLBACK_LINE, undefined), FALLBACK_LINE);
});

test("setFallbackLine: removes the marker comment even when the new value equals the existing literal", () => {
  assert.ok(!setFallbackLine(FALLBACK_LINE, "store_only").includes("@wizard"));
});

test("setFallbackLine: escapes single quotes in the value as two, per expression rules", () => {
  assert.match(setFallbackLine(FALLBACK_LINE, "a'b"), /\|\| 'a''b' \}\}$/);
});

test("setFallbackLine: leaves the line as is when the expression has no single-quoted literal", () => {
  const line = `  X: \${{ vars.A }}  # @wizard fallback:t`;
  assert.strictEqual(setFallbackLine(line, "v"), line);
});

test("setFallbackLine: preserves CRLF line endings", () => {
  assert.strictEqual(
    setFallbackLine(`${FALLBACK_LINE}\r`, "store_prepare"),
    `  DEPLOY_MODE: \${{ github.event.inputs.deploy_mode || vars.ANDROID_DEPLOY_MODE || 'store_prepare' }}\r`,
  );
});

test("substituteEnv: fallback lines are replaced with the resolver value and handled together with auto lines", () => {
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

test("substituteEnv: when the resolver returns an empty value, the fallback line keeps its template default", () => {
  const out = substituteEnv(FALLBACK_LINE, { type: "flutter", resolvers: { "android-deploy-mode": () => "" } });
  assert.strictEqual(out, FALLBACK_LINE);
});

test("substituteEnv: also handles fallback lines in CRLF files and keeps the EOL", () => {
  const content = ["env:", FALLBACK_LINE, ""].join("\r\n");
  const out = substituteEnv(content, { type: "flutter", resolvers: { "android-deploy-mode": () => "store_submit" } });
  assert.strictEqual(
    out,
    ["env:", `  DEPLOY_MODE: \${{ github.event.inputs.deploy_mode || vars.ANDROID_DEPLOY_MODE || 'store_submit' }}`, ""].join("\r\n"),
  );
});

test("isUnchanged: when the deploy mode changes, the same source differs from the installed copy (so the next run updates it as an upstream change)", () => {
  const template = FALLBACK_LINE;
  const resolversFor = (mode) => ({ "android-deploy-mode": () => mode });
  const installed = substituteEnv(template, { type: "flutter", resolvers: resolversFor("store_only") });
  assert.strictEqual(isUnchanged(template, installed, { type: "flutter", resolvers: resolversFor("store_only") }), true);
  assert.strictEqual(isUnchanged(template, installed, { type: "flutter", resolvers: resolversFor("store_submit") }), false);
});

// ── makeResolvers: project path and Flutter tokens ────────────────────
test("makeResolvers: project-path returns the per-type path, or '.' when absent", () => {
  const r = makeResolvers("/nonexistent", "repo", new Map([["flutter", "app"]]));
  assert.strictEqual(resolveToken("project-path", "flutter", r), "app");
  assert.strictEqual(resolveToken("project-path", "react", r), ".");
  assert.strictEqual(resolveToken("project-path", "common", r), ".");
});

test("makeResolvers: without flutterOptions the Flutter tokens are empty (template defaults remain)", () => {
  const r = makeResolvers("/nonexistent", "repo", new Map());
  assert.strictEqual(resolveToken("flutter-env-mode", "flutter", r), "");
  assert.strictEqual(resolveToken("android-deploy-mode", "flutter", r), "");
  assert.strictEqual(resolveToken("ios-deploy-mode", "flutter", r), "");
});

test("makeResolvers: with flutterOptions, returns the env-var mode and per-platform deploy modes", () => {
  const r = makeResolvers("/nonexistent", "repo", new Map(), {
    envMode: "dotenv", stores: ["android"], androidDeployMode: "store_prepare", iosDeployMode: "store_submit",
  });
  assert.strictEqual(resolveToken("flutter-env-mode", "flutter", r), "dotenv");
  assert.strictEqual(resolveToken("android-deploy-mode", "flutter", r), "store_prepare");
  assert.strictEqual(resolveToken("ios-deploy-mode", "flutter", r), "store_submit");
});

test("makeResolvers: the existing resolvers (repo, flutter-root) keep working", () => {
  const r = makeResolvers("/nonexistent", "my-repo", new Map([["flutter", "app"]]));
  assert.strictEqual(resolveToken("repo", "flutter", r), "my-repo");
  assert.strictEqual(resolveToken("flutter-root", "flutter", r), "app");
});

// workflow_dispatch input defaults (`default:`) must also follow the install-time choice so manual runs do not diverge from the settings.
test("substituteEnv: also substitutes auto markers on lowercase keys (dispatch input default)", () => {
  const src = ['        default: "store_only"  # @wizard auto:android-deploy-mode', '        type: choice'].join("\n");
  assert.deepStrictEqual(parseWizardLine(src.split("\n")[0]), {
    indent: "        ", key: "default", action: "auto", arg: "android-deploy-mode",
  });
  const out = substituteEnv(src, { resolvers: { "android-deploy-mode": () => "store_prepare" } });
  assert.strictEqual(out, ['        default: "store_prepare"', '        type: choice'].join("\n"));
});
