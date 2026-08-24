// tests/node/args-validation.test.js
import { test } from "node:test";
import assert from "node:assert";
import { parseArgs, parsePathsCsv, CliError } from "../../src/cli/args.js";

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

// ── L7: --nexus/--secret-backup/--semver-auto 상호 모순 플래그 거부 ──
test("parseArgs: --nexus --no-nexus 동시 지정은 CliError를 던진다", () => {
  assert.throws(() => parseArgs(["--nexus", "--no-nexus"]), CliError);
});

test("parseArgs: --no-nexus --nexus (순서 반대)도 CliError를 던진다", () => {
  assert.throws(() => parseArgs(["--no-nexus", "--nexus"]), CliError);
});

test("parseArgs: --secret-backup --no-secret-backup 동시 지정은 CliError를 던진다", () => {
  assert.throws(() => parseArgs(["--secret-backup", "--no-secret-backup"]), CliError);
});

test("parseArgs: --semver-auto --no-semver-auto 동시 지정은 CliError를 던진다", () => {
  assert.throws(() => parseArgs(["--semver-auto", "--no-semver-auto"]), CliError);
});

test("parseArgs: --nexus 단독 지정은 정상 통과한다", () => {
  const opts = parseArgs(["--nexus"]);
  assert.strictEqual(opts.includeNexus, true);
});

test("parseArgs: --no-secret-backup 단독 지정은 정상 통과한다", () => {
  const opts = parseArgs(["--no-secret-backup"]);
  assert.strictEqual(opts.includeSecretBackup, false);
});

test("parseArgs: --type go는 지원 타입으로 통과한다", () => {
  const opts = parseArgs(["--type", "go"]);
  assert.deepStrictEqual(opts.types, ["go"]);
  assert.strictEqual(opts.primaryType, "go");
});
