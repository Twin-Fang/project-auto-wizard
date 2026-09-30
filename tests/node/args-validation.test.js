// tests/node/args-validation.test.js
import "../setup-lang.mjs"; // these tests assert the ko output
import { test } from "node:test";
import assert from "node:assert";
import { parseArgs, parsePathsCsv, CliError } from "../../src/cli/args.js";
import { helpText } from "../../src/cli/help.js";

// ── Unified handling of inner whitespace in --type/--paths type names ──────────────────
test("parsePathsCsv: inner whitespace in type names is fully removed and normalized, same as --type", () => {
  const map = parsePathsCsv("re act=.");
  assert.strictEqual(map.get("react"), ".");
});

test("parsePathsCsv: normalizes correctly even when only one of several entries has inner whitespace", () => {
  const map = parsePathsCsv("flutter=app,re act=client");
  assert.strictEqual(map.get("flutter"), "app");
  assert.strictEqual(map.get("react"), "client");
});

test("parseArgs: --paths with a missing or empty value throws CliError like other value options", () => {
  assert.throws(() => parseArgs(["--mode", "full", "--force", "--paths"]), CliError);
  assert.throws(() => parseArgs(["--paths", ""]), CliError);
  assert.throws(() => parseArgs(["--paths", "  "]), CliError);
  assert.strictEqual(parseArgs(["--paths", "react=web"]).pathsCsv, "react=web");
});

// ── Explicit empty string rejected for --main-branch/--develop-branch ──────────
test("parseArgs: --main-branch \"\"(explicit empty value) throws CliError", () => {
  assert.throws(() => parseArgs(["--main-branch", ""]), CliError);
});

test("parseArgs: --main-branch at the end without an argument (missing value) throws CliError", () => {
  assert.throws(() => parseArgs(["--main-branch"]), CliError);
});

test("parseArgs: --develop-branch \"\"(explicit empty value) throws CliError", () => {
  assert.throws(() => parseArgs(["--develop-branch", ""]), CliError);
});

test("parseArgs: omitting --main-branch/--develop-branch entirely passes with the default \"\"", () => {
  const opts = parseArgs([]);
  assert.strictEqual(opts.mainBranch, "");
  assert.strictEqual(opts.developBranch, "");
});

test("parseArgs: values given to --main-branch/--develop-branch are applied as is", () => {
  const opts = parseArgs(["--main-branch", "release", "--develop-branch", "dev"]);
  assert.strictEqual(opts.mainBranch, "release");
  assert.strictEqual(opts.developBranch, "dev");
});

test("parseArgs: whitespace-only, whitespace-containing, or git-invalid branch names throw CliError", () => {
  for (const bad of ["   ", "dev branch", "(unknown)", "a..b", "feature/"]) {
    assert.throws(() => parseArgs(["--main-branch", bad]), CliError, `--main-branch '${bad}'`);
    assert.throws(() => parseArgs(["--develop-branch", bad]), CliError, `--develop-branch '${bad}'`);
  }
});

test("parseArgs: leading and trailing whitespace in branch names is trimmed", () => {
  assert.strictEqual(parseArgs(["--main-branch", " release "]).mainBranch, "release");
});

// ── Contradictory --semver-auto flags rejected ──

test("parseArgs: specifying --semver-auto and --no-semver-auto together throws CliError", () => {
  assert.throws(() => parseArgs(["--semver-auto", "--no-semver-auto"]), CliError);
});

test("parseArgs: the removed --nexus / --no-nexus flags are rejected as unknown options", () => {
  for (const flag of ["--nexus", "--no-nexus"]) {
    assert.throws(() => parseArgs([flag]), (e) => e instanceof CliError && e.message.includes(`알 수 없는 옵션: ${flag}`));
  }
});

test("parseArgs: the removed --secret-backup / --no-secret-backup flags are rejected as unknown options", () => {
  for (const flag of ["--secret-backup", "--no-secret-backup"]) {
    assert.throws(() => parseArgs([flag]), (e) => e instanceof CliError && e.message.includes(`알 수 없는 옵션: ${flag}`));
  }
});

test("parseArgs: --type go passes as a supported type", () => {
  const opts = parseArgs(["--type", "go"]);
  assert.deepStrictEqual(opts.types, ["go"]);
  assert.strictEqual(opts.primaryType, "go");
});

// ── Flutter option flags ─────────────────────────────
const cliErrorMatching = (re) => (e) => e instanceof CliError && re.test(e.message);

test("parseArgs: Flutter option flags left unspecified have the 'unset' value", () => {
  const opts = parseArgs([]);
  assert.strictEqual(opts.flutterEnvMode, "");
  assert.strictEqual(opts.flutterStore, null);
  assert.strictEqual(opts.androidDeployMode, "");
  assert.strictEqual(opts.iosDeployMode, "");
});

test("parseArgs: --flutter-env-mode accepts dart-define/dotenv", () => {
  assert.strictEqual(parseArgs(["--flutter-env-mode", "dart-define"]).flutterEnvMode, "dart-define");
  assert.strictEqual(parseArgs(["--flutter-env-mode", "dotenv"]).flutterEnvMode, "dotenv");
});

test("parseArgs: an invalid or missing --flutter-env-mode value is a CliError (both is not offered)", () => {
  assert.throws(() => parseArgs(["--flutter-env-mode", "both"]), cliErrorMatching(/--flutter-env-mode 값이 올바르지 않습니다: both \(dart-define \| dotenv\)/));
  assert.throws(() => parseArgs(["--flutter-env-mode"]), cliErrorMatching(/--flutter-env-mode 값이 올바르지 않습니다: \(없음\)/));
});

test("parseArgs: --flutter-store parses csv into an array and none into an empty array", () => {
  assert.deepStrictEqual(parseArgs(["--flutter-store", "android,ios"]).flutterStore, ["android", "ios"]);
  assert.deepStrictEqual(parseArgs(["--flutter-store", "ios"]).flutterStore, ["ios"]);
  assert.deepStrictEqual(parseArgs(["--flutter-store", "none"]).flutterStore, []);
});

test("parseArgs: an invalid, empty, or missing --flutter-store value is a CliError", () => {
  assert.throws(() => parseArgs(["--flutter-store", "windows"]), cliErrorMatching(/--flutter-store 값이 올바르지 않습니다: windows/));
  assert.throws(() => parseArgs(["--flutter-store", "android,none"]), cliErrorMatching(/--flutter-store/));
  assert.throws(() => parseArgs(["--flutter-store", ""]), cliErrorMatching(/--flutter-store/));
  assert.throws(() => parseArgs(["--flutter-store"]), cliErrorMatching(/--flutter-store 값이 올바르지 않습니다: \(없음\)/));
});

test("parseArgs: --android-deploy-mode / --ios-deploy-mode each accept the three modes", () => {
  const opts = parseArgs(["--android-deploy-mode", "store_submit", "--ios-deploy-mode", "store_prepare"]);
  assert.strictEqual(opts.androidDeployMode, "store_submit");
  assert.strictEqual(opts.iosDeployMode, "store_prepare");
  assert.strictEqual(parseArgs(["--android-deploy-mode", "store_only"]).androidDeployMode, "store_only");
});

test("parseArgs: an invalid or missing deploy-mode flag value is a CliError", () => {
  assert.throws(() => parseArgs(["--android-deploy-mode", "publish"]),
    cliErrorMatching(/--android-deploy-mode 값이 올바르지 않습니다: publish \(store_only \| store_prepare \| store_submit\)/));
  assert.throws(() => parseArgs(["--ios-deploy-mode", "publish"]), cliErrorMatching(/--ios-deploy-mode/));
  assert.throws(() => parseArgs(["--ios-deploy-mode"]), cliErrorMatching(/--ios-deploy-mode 값이 올바르지 않습니다: \(없음\)/));
});

test("helpText(): documents the 4 Flutter option flags", () => {
  for (const flag of ["--flutter-env-mode", "--flutter-store", "--android-deploy-mode", "--ios-deploy-mode"]) {
    assert.ok(helpText().includes(flag), `${flag} is missing from --help`);
  }
});

// ── --project-version format validation ──
test("parseArgs: --project-version accepts only x.y.z and strips a v prefix", () => {
  assert.strictEqual(parseArgs(["--project-version", "1.2.3"]).version, "1.2.3");
  assert.strictEqual(parseArgs(["--project-version", "v1.2.3"]).version, "1.2.3");
  for (const bad of ["abc", "1.2", "1.2.3.4", "", "1.2.x"]) {
    assert.throws(() => parseArgs(["--project-version", bad]), CliError, bad);
  }
  assert.throws(() => parseArgs(["--project-version"]), CliError);
});

// ── --paths outside the repo rejected ──
test("parsePathsCsv: paths pointing outside the repo ('..', absolute) throw CliError", () => {
  for (const bad of ["flutter=../other-repo", "flutter=app/../../x", "flutter=/tmp/x", "flutter=C:\\\\work\\\\x"]) {
    assert.throws(() => parsePathsCsv(bad), CliError, bad);
  }
  assert.strictEqual(parsePathsCsv("flutter=./apps/mobile/").get("flutter"), "apps/mobile");
  assert.strictEqual(parsePathsCsv("flutter=apps/..hidden").get("flutter"), "apps/..hidden");
});

// ── --name=value form ──────────────────────────────────────
test("parseArgs: --name=value is the same as --name value for every value option", () => {
  const pairs = [
    [["--mode=status"], ["--mode", "status"]],
    [["--lang=ko"], ["--lang", "ko"]],
    [["--type=react,spring"], ["--type", "react,spring"]],
    [["--deploy-style=nginx"], ["--deploy-style", "nginx"]],
    [["--main-branch=release", "--develop-branch=dev"], ["--main-branch", "release", "--develop-branch", "dev"]],
    [["--project-version=v1.2.3"], ["--project-version", "v1.2.3"]],
    [["--flutter-store=android"], ["--flutter-store", "android"]],
  ];
  for (const [inline, spaced] of pairs) assert.deepStrictEqual(parseArgs(inline), parseArgs(spaced), inline.join(" "));
});

test("parseArgs: only the first '=' splits, so --paths=flutter=app keeps its value", () => {
  assert.strictEqual(parseArgs(["--paths=flutter=app,react=client"]).pathsCsv, "flutter=app,react=client");
});

test("parseArgs: --name= with an empty value reports the same error as an empty space-separated value", () => {
  assert.throws(() => parseArgs(["--paths="]), /--paths/);
  assert.throws(() => parseArgs(["--main-branch="]), CliError);
  assert.throws(() => parseArgs(["--lang="]), CliError);
});

test("parseArgs: a value option's value is never expanded, and the space and inline forms mix", () => {
  assert.strictEqual(parseArgs(["--paths", "react=a=b", "--lang=ko"]).pathsCsv, "react=a=b");
  assert.strictEqual(parseArgs(["--lang=ko", "--mode", "full"]).mode, "full");
});

test("parseArgs: a switch given a value is a clear error naming the option", () => {
  for (const flag of ["--force", "--dry-run", "--help", "--version", "--yes", "--no-copilot"]) {
    assert.throws(() => parseArgs([`${flag}=true`]), (e) => e instanceof CliError && e.message.includes(flag) && e.message.includes(`${flag}=true`), flag);
  }
});

test("parseArgs: an unknown option with '=' is still reported as unknown", () => {
  assert.throws(() => parseArgs(["--nope=1"]), (e) => e instanceof CliError && e.message.includes("--nope=1"));
});
