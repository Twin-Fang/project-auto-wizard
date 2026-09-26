// tests/node/args-validation.test.js
import { test } from "node:test";
import assert from "node:assert";
import { parseArgs, parsePathsCsv, CliError } from "../../src/cli/args.js";
import { HELP_TEXT } from "../../src/cli/help.js";

// ── L5: --type/--paths 타입명 내부 공백 처리 통일 ──────────────────
test("parsePathsCsv: 타입명 내부 공백은 --type과 동일하게 전부 제거되어 정규화된다", () => {
  const map = parsePathsCsv("re act=.");
  assert.strictEqual(map.get("react"), ".");
});

test("parsePathsCsv: 여러 항목 중 하나에만 내부 공백이 있어도 정상 정규화된다", () => {
  const map = parsePathsCsv("flutter=app,re act=client");
  assert.strictEqual(map.get("flutter"), "app");
  assert.strictEqual(map.get("react"), "client");
});

// ── L6: --main-branch/--develop-branch 빈 문자열 명시 거부 ──────────
test("parseArgs: --main-branch \"\"(빈 값 명시)는 CliError를 던진다", () => {
  assert.throws(() => parseArgs(["--main-branch", ""]), CliError);
});

test("parseArgs: --main-branch가 인자 없이 끝에 오면(값 누락) CliError를 던진다", () => {
  assert.throws(() => parseArgs(["--main-branch"]), CliError);
});

test("parseArgs: --develop-branch \"\"(빈 값 명시)는 CliError를 던진다", () => {
  assert.throws(() => parseArgs(["--develop-branch", ""]), CliError);
});

test("parseArgs: --main-branch/--develop-branch를 아예 지정하지 않으면 기본값 \"\"로 통과한다", () => {
  const opts = parseArgs([]);
  assert.strictEqual(opts.mainBranch, "");
  assert.strictEqual(opts.developBranch, "");
});

test("parseArgs: --main-branch/--develop-branch에 값을 지정하면 그대로 반영된다", () => {
  const opts = parseArgs(["--main-branch", "release", "--develop-branch", "dev"]);
  assert.strictEqual(opts.mainBranch, "release");
  assert.strictEqual(opts.developBranch, "dev");
});

// ── L7: --semver-auto 상호 모순 플래그 거부 ──

test("parseArgs: --semver-auto --no-semver-auto 동시 지정은 CliError를 던진다", () => {
  assert.throws(() => parseArgs(["--semver-auto", "--no-semver-auto"]), CliError);
});

test("parseArgs: 제거된 --nexus / --no-nexus 플래그는 알 수 없는 옵션으로 거부된다", () => {
  for (const flag of ["--nexus", "--no-nexus"]) {
    assert.throws(() => parseArgs([flag]), (e) => e instanceof CliError && e.message.includes(`알 수 없는 옵션: ${flag}`));
  }
});

test("parseArgs: 제거된 --secret-backup / --no-secret-backup 플래그는 알 수 없는 옵션으로 거부된다", () => {
  for (const flag of ["--secret-backup", "--no-secret-backup"]) {
    assert.throws(() => parseArgs([flag]), (e) => e instanceof CliError && e.message.includes(`알 수 없는 옵션: ${flag}`));
  }
});

test("parseArgs: --type go는 지원 타입으로 통과한다", () => {
  const opts = parseArgs(["--type", "go"]);
  assert.deepStrictEqual(opts.types, ["go"]);
  assert.strictEqual(opts.primaryType, "go");
});

// ── Flutter 옵션 플래그 (이슈 #131) ─────────────────────────────
const cliErrorMatching = (re) => (e) => e instanceof CliError && re.test(e.message);

test("parseArgs: Flutter 옵션 플래그를 지정하지 않으면 '미지정' 값이다", () => {
  const opts = parseArgs([]);
  assert.strictEqual(opts.flutterEnvMode, "");
  assert.strictEqual(opts.flutterStore, null);
  assert.strictEqual(opts.androidDeployMode, "");
  assert.strictEqual(opts.iosDeployMode, "");
});

test("parseArgs: --flutter-env-mode는 dart-define/dotenv를 받는다", () => {
  assert.strictEqual(parseArgs(["--flutter-env-mode", "dart-define"]).flutterEnvMode, "dart-define");
  assert.strictEqual(parseArgs(["--flutter-env-mode", "dotenv"]).flutterEnvMode, "dotenv");
});

test("parseArgs: --flutter-env-mode에 잘못된 값·누락은 CliError (both는 만들지 않는다)", () => {
  assert.throws(() => parseArgs(["--flutter-env-mode", "both"]), cliErrorMatching(/--flutter-env-mode 값이 올바르지 않습니다: both \(dart-define \| dotenv\)/));
  assert.throws(() => parseArgs(["--flutter-env-mode"]), cliErrorMatching(/--flutter-env-mode 값이 올바르지 않습니다: \(없음\)/));
});

test("parseArgs: --flutter-store는 csv를 배열로, none은 빈 배열로 파싱한다", () => {
  assert.deepStrictEqual(parseArgs(["--flutter-store", "android,ios"]).flutterStore, ["android", "ios"]);
  assert.deepStrictEqual(parseArgs(["--flutter-store", "ios"]).flutterStore, ["ios"]);
  assert.deepStrictEqual(parseArgs(["--flutter-store", "none"]).flutterStore, []);
});

test("parseArgs: --flutter-store에 잘못된 값·빈 값·누락은 CliError", () => {
  assert.throws(() => parseArgs(["--flutter-store", "windows"]), cliErrorMatching(/--flutter-store 값이 올바르지 않습니다: windows/));
  assert.throws(() => parseArgs(["--flutter-store", "android,none"]), cliErrorMatching(/--flutter-store/));
  assert.throws(() => parseArgs(["--flutter-store", ""]), cliErrorMatching(/--flutter-store/));
  assert.throws(() => parseArgs(["--flutter-store"]), cliErrorMatching(/--flutter-store 값이 올바르지 않습니다: \(없음\)/));
});

test("parseArgs: --android-deploy-mode / --ios-deploy-mode는 세 모드를 각각 받는다", () => {
  const opts = parseArgs(["--android-deploy-mode", "store_submit", "--ios-deploy-mode", "store_prepare"]);
  assert.strictEqual(opts.androidDeployMode, "store_submit");
  assert.strictEqual(opts.iosDeployMode, "store_prepare");
  assert.strictEqual(parseArgs(["--android-deploy-mode", "store_only"]).androidDeployMode, "store_only");
});

test("parseArgs: 배포 모드 플래그에 잘못된 값·누락은 CliError", () => {
  assert.throws(() => parseArgs(["--android-deploy-mode", "publish"]),
    cliErrorMatching(/--android-deploy-mode 값이 올바르지 않습니다: publish \(store_only \| store_prepare \| store_submit\)/));
  assert.throws(() => parseArgs(["--ios-deploy-mode", "publish"]), cliErrorMatching(/--ios-deploy-mode/));
  assert.throws(() => parseArgs(["--ios-deploy-mode"]), cliErrorMatching(/--ios-deploy-mode 값이 올바르지 않습니다: \(없음\)/));
});

test("HELP_TEXT: Flutter 옵션 플래그 4종을 안내한다", () => {
  for (const flag of ["--flutter-env-mode", "--flutter-store", "--android-deploy-mode", "--ios-deploy-mode"]) {
    assert.ok(HELP_TEXT.includes(flag), `${flag}가 --help에 없다`);
  }
});
