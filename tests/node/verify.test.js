// tests/node/verify.test.js
// Regression for post-install verification and the required-Secret notice.
// Run-log regressions were split out into logger*.test.js.
import "../setup-lang.mjs"; // these tests assert the ko output
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanUnsubstituted, collectRequiredSecrets, narrowSecretsBySshAuth, classifySecrets } from "../../src/core/verify.js";
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

// ── Scan for unsubstituted placeholders ──────────────────────
test("scanUnsubstituted: reports leftover __TOKEN__ with file and line", () => {
  const dir = wfDirWith({ "A.yaml": 'env:\n  DIR: "__APPLICATION_YML_DIR__"\n' });
  try {
    const found = scanUnsubstituted(dir, ["A.yaml"]);
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].token, "__APPLICATION_YML_DIR__");
    assert.strictEqual(found[0].line, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("scanUnsubstituted: ignores heredoc delimiters (__WIZARD_*__) since they are not substitution targets", () => {
  const dir = wfDirWith({ "A.yaml": "run: |\n  cat <<'__WIZARD_FILE_CONTENT_EOF__'\n" });
  try {
    assert.deepStrictEqual(scanUnsubstituted(dir, ["A.yaml"]), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("scanUnsubstituted: does not count commented-out lines since they never run", () => {
  const dir = wfDirWith({ "A.yaml": '#  DIR: "__APPLICATION_YML_DIR__"\n' });
  try {
    assert.deepStrictEqual(scanUnsubstituted(dir, ["A.yaml"]), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── Collect required Secrets ──────────────────────────────────
test("collectRequiredSecrets: also collects from the workflows in use", () => {
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

test("collectRequiredSecrets: excludes auto-injected (GITHUB_TOKEN) and optional secrets that have a fallback from the required set", () => {
  const dir = wfDirWith({
    "A.yaml": "a: ${{ secrets.GITHUB_TOKEN }}\nb: ${{ secrets.AI_API_KEY }}\nc: ${{ secrets.WORKFLOW_PAT }}\n",
  });
  try {
    assert.strictEqual(collectRequiredSecrets(dir, ["A.yaml"]).size, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("collectRequiredSecrets: does not count [optional] example steps inside comments as required secrets", () => {
  const dir = wfDirWith({ "A.yaml": "#     FIREBASE_KEY_JSON: ${{ secrets.FIREBASE_KEY_JSON }}\n" });
  try {
    assert.strictEqual(collectRequiredSecrets(dir, ["A.yaml"]).size, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("classifySecrets: groups `A || B` fallback pairs into one entry and treats secrets with defaults as optional", () => {
  const dir = wfDirWith({
    "A.yaml": "e: ${{ secrets.ENV_FILE || secrets.ENV }}\np: ${{ secrets.PROJECT_DEPLOY_PORT || '3000' }}\nh: ${{ secrets.SERVER_HOST }}\n",
    "B.yaml": "id: ${{ secrets.IOS_BUNDLE_ID || vars.IOS_BUNDLE_ID }}\n",
  });
  try {
    const { required, optional } = classifySecrets(dir, ["A.yaml", "B.yaml"]);
    assert.deepStrictEqual([...required.keys()], ["ENV_FILE 또는 ENV", "SERVER_HOST"], "ENV and ENV_FILE must not be counted separately");
    assert.deepStrictEqual([...optional.keys()], ["IOS_BUNDLE_ID", "PROJECT_DEPLOY_PORT"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("classifySecrets: excludes secrets marked (optional) in the header comment from required", () => {
  const dir = wfDirWith({
    "A.yaml": "# SECRETS_XCCONFIG (선택): Secrets.xcconfig 내용\n# ENV_FILE (선택): .env 파일 내용\n" +
      "x: ${{ secrets.SECRETS_XCCONFIG }}\ne: ${{ secrets.ENV_FILE || secrets.ENV }}\n",
  });
  try {
    const { required, optional } = classifySecrets(dir, ["A.yaml"]);
    assert.strictEqual(required.size, 0);
    assert.deepStrictEqual([...optional.keys()], ["ENV_FILE 또는 ENV", "SECRETS_XCCONFIG"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("classifySecrets: a name that is solely required in another workflow stays required and its pair is excluded", () => {
  const dir = wfDirWith({
    "A.yaml": "e: ${{ secrets.ENV_FILE || secrets.ENV }}\n",
    "B.yaml": "e: ${{ secrets.ENV }}\n",
  });
  try {
    const { required, optional } = classifySecrets(dir, ["A.yaml", "B.yaml"]);
    assert.deepStrictEqual([...required.keys()], ["ENV"]);
    assert.strictEqual(optional.size, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("classifySecrets: in the real flutter/react workflows, optional entries and fallback pairs do not inflate the required count", () => {
  for (const type of ["flutter", "react"]) {
    const dir = join(resolvePayloadRoot(), "workflows", type);
    const files = readdirSync(dir, { recursive: true }).filter((f) => /\.ya?ml$/.test(f));
    const { required, optional } = classifySecrets(dir, files);
    const names = [...required.keys()];
    assert.ok(!names.includes("ENV") && !names.includes("ENV_FILE"), `${type}: ENV/ENV_FILE must not be counted separately`);
    assert.ok(!names.includes("PROJECT_DEPLOY_PORT") && !names.includes("SECRETS_XCCONFIG"), `${type}: an optional entry got mixed into required`);
    if (type === "react") assert.ok(optional.has("PROJECT_DEPLOY_PORT"));
    if (type === "flutter") assert.ok(optional.has("SECRETS_XCCONFIG"));
  }
});

// Marking a secret as required when the workflow runs fine without it forces needless registration.
test("classifySecrets: Python CI ENV_FILE and the Flutter test APK signing/Firebase secrets are optional", () => {
  const python = classifySecrets(join(resolvePayloadRoot(), "workflows", "python"), ["PROJECT-PYTHON-CI.yaml"]);
  assert.deepStrictEqual([...python.required.keys()], []);
  assert.ok(python.optional.has("ENV_FILE"));

  const apk = classifySecrets(join(resolvePayloadRoot(), "workflows", "flutter"), ["PROJECT-FLUTTER-ANDROID-TEST-APK.yaml"]);
    assert.deepStrictEqual([...apk.required.keys()], [], "the test APK builds with the debug key even without secrets");
  for (const name of ["RELEASE_KEYSTORE_BASE64", "RELEASE_KEYSTORE_PASSWORD", "RELEASE_KEY_ALIAS", "RELEASE_KEY_PASSWORD", "FIREBASE_SERVICE_ACCOUNT_JSON_BASE64"]) {
    assert.ok(apk.optional.has(name), `${name} was not classified as optional`);
  }

  // Store upload needs the release key, so it stays required when installed together
  const store = classifySecrets(join(resolvePayloadRoot(), "workflows", "flutter"),
    ["PROJECT-FLUTTER-ANDROID-TEST-APK.yaml", "PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml"]);
  assert.ok(store.required.has("RELEASE_KEYSTORE_BASE64"));
});

test("narrowSecretsBySshAuth: drops the entries unused by the chosen auth method from the list", () => {
  const base = new Map([["SERVER_PASSWORD", ["A"]], ["SSH_KEY", ["A"]]]);
  assert.ok(!narrowSecretsBySshAuth(base, "key").has("SERVER_PASSWORD"));
  assert.ok(!narrowSecretsBySshAuth(base, "password").has("SSH_KEY"));
  assert.strictEqual(narrowSecretsBySshAuth(base, "").size, 2, "no narrowing when unspecified");
});

// ── Single-quote substitution ─────────────────────────────────
test("setEnvLine: also substitutes single-quoted values and normalizes the result to double quotes", () => {
  const out = setEnvLine("  SSH_PORT: '2022'  # @wizard ask:2022", "SSH_PORT", "22");
  assert.strictEqual(out, '  SSH_PORT: "22"');
});

// ── Real install path e2e ──────────────────────────────────────────
test("runFull: installs without unsubstituted tokens in a Kotlin DSL + application.yaml project", () => {
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

    assert.deepStrictEqual(result.unresolved, [], "all auto tokens must be filled");
    assert.ok(result.secrets.has("SERVER_HOST"), "the secret required by the deploy workflow must be announced");
    assert.ok(!result.secrets.has("WORKFLOW_PAT"), "optional secrets must not be in the required list");

    const wf = readFileSync(join(target, ".github/workflows/PROJECT-SPRING-SIMPLE-CICD.yaml"), "utf8");
    assert.match(wf, /JAVA_VERSION: "25"/, "the measured toolchain value must be filled in");
    assert.match(wf, /APPLICATION_YML_DIR: "src\/main\/resources"/, ".yaml must be found too");

    // The marker comment in version.yml must also be a real file (same basis as the detection log)
    assert.match(readFileSync(join(target, "version.yml"), "utf8"), /spring: "\." # build\.gradle\.kts/);
  } finally { rmSync(target, { recursive: true, force: true }); }
});
