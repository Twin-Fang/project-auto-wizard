// Flutter option resolution on the non-interactive path — CLI > stored value > default; new installs get dart-define, existing ones keep dotenv.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "../../src/index.js";
import { parseExisting } from "../../src/core/version-yml.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";

const CLOCK = { now: "2026-09-21 00:00:00", today: "2026-09-21" };
const BASE_ARGS = ["--mode", "full", "--force", "--main-branch", "main", "--develop-branch", "develop"];

function flutterTarget() {
  const target = mkdtempSync(join(tmpdir(), "paw-flutter-options-"));
  writeFileSync(join(target, "pubspec.yaml"), "name: fixture\nversion: 1.0.0+1\n");
  return target;
}

const versionYmlOf = (target) => readFileSync(join(target, "version.yml"), "utf8");
const optionsOf = (target) => parseExisting(versionYmlOf(target)).options;
const install = (target, extraArgs = [], opts = {}) =>
  run([...BASE_ARGS, ...extraArgs], { cwd: target, clock: CLOCK, ...opts });

test("fresh install: env_mode is dart-define, stores are undecided (both), and deploy mode is recorded as store_only", async () => {
  const target = flutterTarget();
  try {
    assert.strictEqual(await install(target, ["--type", "flutter"]), 0);
    const options = optionsOf(target);
    assert.strictEqual(options.envMode, "dart-define");
    assert.strictEqual(options.flutterStore, "android,ios");
    assert.strictEqual(options.androidDeployMode, "store_only");
    assert.strictEqual(options.iosDeployMode, "store_only");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("existing install (version.yml present, no stored env_mode): keeps dotenv", async () => {
  const target = flutterTarget();
  try {
    // version.yml created earlier — lacks the 4 Flutter option keys.
    writeFileSync(join(target, "version.yml"), [
      'version: "1.0.0"',
      "version_code: 1",
      'project_types: ["flutter"]',
      "metadata:",
      "  template:",
      "    options:",
      "",
    ].join("\n"));
    assert.strictEqual(await install(target), 0);
    assert.strictEqual(optionsOf(target).envMode, "dotenv");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("CLI flags are saved, kept on a rerun without flags, and overwritten when specified again", async () => {
  const target = flutterTarget();
  try {
    await install(target, [
      "--type", "flutter",
      "--flutter-env-mode", "dotenv", "--flutter-store", "ios",
      "--android-deploy-mode", "store_submit", "--ios-deploy-mode", "store_prepare",
    ]);
    let options = optionsOf(target);
    assert.deepStrictEqual(
      [options.envMode, options.flutterStore, options.androidDeployMode, options.iosDeployMode],
      ["dotenv", "ios", "store_submit", "store_prepare"],
    );

    await install(target); // no flags — stored values kept
    options = optionsOf(target);
    assert.deepStrictEqual(
      [options.envMode, options.flutterStore, options.androidDeployMode, options.iosDeployMode],
      ["dotenv", "ios", "store_submit", "store_prepare"],
    );

    await install(target, ["--flutter-env-mode", "dart-define", "--flutter-store", "none"]);
    options = optionsOf(target);
    assert.deepStrictEqual(
      [options.envMode, options.flutterStore, options.androidDeployMode, options.iosDeployMode],
      ["dart-define", "none", "store_submit", "store_prepare"],
      "only the specified flags overwrite; the rest keep their stored values",
    );
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// Regression guard — the store_submit warning must appear only for the Flutter type and
// only when that store is selected. Judging by android_deploy_mode alone would wrongly show it for non-Flutter types or
// projects that did not select the android store.
test("store_submit warning: not shown for a non-Flutter project even when --android-deploy-mode is given", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-flutter-options-node-"));
  writeFileSync(join(target, "package.json"), "{}\n");
  const originalError = console.error;
  let stderr = "";
  console.error = (msg) => { stderr += msg; };
  try {
    const code = await install(target, ["--type", "node", "--android-deploy-mode", "store_submit"]);
    assert.strictEqual(code, 0);
    assert.ok(!stderr.includes("심사가 자동 제출"), `a non-Flutter type must have no store_submit warning, got: ${stderr}`);
  } finally {
    console.error = originalError;
    rmSync(target, { recursive: true, force: true });
  }
});

test("store_submit warning: for the Flutter type without the android store selected, no android warning is shown", async () => {
  const target = flutterTarget();
  const originalError = console.error;
  let stderr = "";
  console.error = (msg) => { stderr += msg; };
  try {
    const code = await install(target, [
      "--type", "flutter", "--flutter-store", "ios",
      "--android-deploy-mode", "store_submit", "--ios-deploy-mode", "store_only",
    ]);
    assert.strictEqual(code, 0);
    assert.ok(!stderr.includes("심사가 자동 제출"), `without android selected there must be no store_submit warning, got: ${stderr}`);
  } finally {
    console.error = originalError;
    rmSync(target, { recursive: true, force: true });
  }
});

test("without the Flutter type, option keys are not recorded", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-flutter-options-node-"));
  writeFileSync(join(target, "package.json"), "{}\n");
  try {
    assert.strictEqual(await install(target, ["--type", "node", "--flutter-env-mode", "dotenv"]), 0);
    assert.doesNotMatch(versionYmlOf(target), /env_mode|flutter_store|android_deploy_mode|ios_deploy_mode/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("options are passed to resolvers and the @wizard auto/fallback tokens are reflected in the installed copy", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-flutter-options-wiring-"));
  const payload = mkdtempSync(join(tmpdir(), "paw-flutter-options-payload-"));
  try {
    mkdirSync(join(target, "app"));
    writeFileSync(join(target, "app", "pubspec.yaml"), "name: fixture\nversion: 1.0.0+1\n");
    // Overlay a verification workflow holding only the 3 tokens onto the real payload copy — this checks only the wiring (index → makeResolvers).
    cpSync(resolvePayloadRoot(), payload, { recursive: true });
    writeFileSync(join(payload, "workflows", "flutter", "PROJECT-FLUTTER-WIRING-CHECK.yaml"), [
      "name: WIRING CHECK",
      "on:",
      "  workflow_dispatch:",
      "env:",
      '  PROJECT_PATH: "."  # @wizard auto:project-path',
      '  ENV_MODE: "dart-define"  # @wizard auto:flutter-env-mode',
      "  ANDROID_MODE: ${{ github.event.inputs.deploy_mode || vars.ANDROID_DEPLOY_MODE || 'store_only' }}  # @wizard fallback:android-deploy-mode",
      "  IOS_MODE: ${{ github.event.inputs.deploy_mode || vars.IOS_DEPLOY_MODE || 'store_only' }}  # @wizard fallback:ios-deploy-mode",
      "jobs:",
      "  noop:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: echo ok",
      "",
    ].join("\n"));

    const code = await install(target, [
      "--type", "flutter", "--paths", "flutter=app",
      "--flutter-env-mode", "dotenv",
      "--android-deploy-mode", "store_submit", "--ios-deploy-mode", "store_prepare",
    ], { payloadRoot: payload });
    assert.strictEqual(code, 0);

    const installed = readFileSync(join(target, ".github", "workflows", "PROJECT-FLUTTER-WIRING-CHECK.yaml"), "utf8");
    assert.match(installed, /^ {2}PROJECT_PATH: "app"$/m);
    assert.match(installed, /^ {2}ENV_MODE: "dotenv"$/m);
    assert.match(installed, /^ {2}ANDROID_MODE: \$\{\{ github\.event\.inputs\.deploy_mode \|\| vars\.ANDROID_DEPLOY_MODE \|\| 'store_submit' \}\}$/m);
    assert.match(installed, /^ {2}IOS_MODE: \$\{\{ github\.event\.inputs\.deploy_mode \|\| vars\.IOS_DEPLOY_MODE \|\| 'store_prepare' \}\}$/m);
    assert.ok(!installed.includes("@wizard"), "no marker comment may remain");
  } finally {
    rmSync(target, { recursive: true, force: true });
    rmSync(payload, { recursive: true, force: true });
  }
});

test("existing install without a stored store value: does not infer from installed store workflows and revive deleted platform files", async () => {
  const target = flutterTarget();
  try {
    mkdirSync(join(target, "lib"));
    writeFileSync(join(target, "version.yml"), 'version: "1.0.0"\nversion_code: 1\nproject_types: ["flutter"]\n');
    mkdirSync(join(target, ".github", "workflows"), { recursive: true });
    writeFileSync(join(target, ".github", "workflows", "PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml"), "# 기존 설치본\n");
    assert.strictEqual(await install(target, ["--type", "flutter"]), 0);
    assert.strictEqual(optionsOf(target).flutterStore, "android");
    assert.ok(!existsSync(join(target, "ios", "fastlane", "Fastfile")), "must not create iOS fastlane files that were not selected");
    assert.ok(!existsSync(join(target, ".github", "workflows", "PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
