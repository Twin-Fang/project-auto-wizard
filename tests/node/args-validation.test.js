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
