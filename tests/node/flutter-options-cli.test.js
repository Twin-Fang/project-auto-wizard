// 비대화형 경로의 Flutter 옵션 결정 — CLI > 저장값 > 기본값, 신규 dart-define / 기존 dotenv 보존.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from "node:fs";
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

test("신규 설치: env_mode는 dart-define, 스토어는 미결정(둘 다), 배포 모드는 store_only로 기록한다", async () => {
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

test("기존 설치(version.yml 있음, env_mode 저장값 없음): dotenv를 보존한다", async () => {
  const target = flutterTarget();
  try {
    // 이전에 만들어진 version.yml — Flutter 옵션 4개 키가 없다.
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

test("CLI 플래그는 저장되고, 플래그 없이 재실행해도 유지되며, 다시 지정하면 덮어쓴다", async () => {
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

    await install(target); // 플래그 없음 — 저장값 유지
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
      "지정한 플래그만 덮어쓰고 나머지는 저장값을 유지한다",
    );
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// 회귀 방지 — store_submit 경고는 Flutter 타입이고 해당 스토어를
// 선택했을 때만 떠야 한다. android_deploy_mode만 보고 판단하면 Flutter 타입이 아니거나 android
// 스토어를 선택하지 않은 프로젝트에서도 잘못 떠버린다.
test("store_submit 경고: Flutter 타입이 아닌 프로젝트에는 --android-deploy-mode를 줘도 뜨지 않는다", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-flutter-options-node-"));
  writeFileSync(join(target, "package.json"), "{}\n");
  const originalError = console.error;
  let stderr = "";
  console.error = (msg) => { stderr += msg; };
  try {
    const code = await install(target, ["--type", "node", "--android-deploy-mode", "store_submit"]);
    assert.strictEqual(code, 0);
    assert.ok(!stderr.includes("심사가 자동 제출"), `Flutter 타입이 아니면 store_submit 경고가 없어야 한다, got: ${stderr}`);
  } finally {
    console.error = originalError;
    rmSync(target, { recursive: true, force: true });
  }
});

test("store_submit 경고: Flutter 타입이지만 android 스토어를 선택하지 않으면 android 경고가 뜨지 않는다", async () => {
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
    assert.ok(!stderr.includes("심사가 자동 제출"), `android를 선택하지 않았으면 store_submit 경고가 없어야 한다, got: ${stderr}`);
  } finally {
    console.error = originalError;
    rmSync(target, { recursive: true, force: true });
  }
});

test("Flutter 타입이 없으면 옵션 키를 기록하지 않는다", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-flutter-options-node-"));
  writeFileSync(join(target, "package.json"), "{}\n");
  try {
    assert.strictEqual(await install(target, ["--type", "node", "--flutter-env-mode", "dotenv"]), 0);
    assert.doesNotMatch(versionYmlOf(target), /env_mode|flutter_store|android_deploy_mode|ios_deploy_mode/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("resolvers에 옵션이 전달되어 @wizard auto/fallback 토큰이 설치본에 반영된다", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-flutter-options-wiring-"));
  const payload = mkdtempSync(join(tmpdir(), "paw-flutter-options-payload-"));
  try {
    mkdirSync(join(target, "app"));
    writeFileSync(join(target, "app", "pubspec.yaml"), "name: fixture\nversion: 1.0.0+1\n");
    // 실제 payload 사본에 토큰 3종만 담은 검증용 워크플로우를 얹는다 — 배선(index → makeResolvers)만 본다.
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
    assert.ok(!installed.includes("@wizard"), "마커 주석이 남으면 안 된다");
  } finally {
    rmSync(target, { recursive: true, force: true });
    rmSync(payload, { recursive: true, force: true });
  }
});
