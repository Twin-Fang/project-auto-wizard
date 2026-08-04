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
