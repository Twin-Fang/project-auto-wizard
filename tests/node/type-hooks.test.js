import { test } from "node:test";
import assert from "node:assert";
import { hooksFor, typeInfo } from "../../src/core/types.js";
import { planTypeAppFiles } from "../../src/core/copy/app-files.js";
import { buildTypeRootFilter } from "../../src/core/copy/workflows.js";

test("hooksFor: 훅을 가진 타입만 주어진 순서대로 돌려준다", () => {
  assert.deepStrictEqual(hooksFor(["spring", "flutter", "react"], "statusLabels").map((h) => h.id), ["flutter"]);
  assert.deepStrictEqual(hooksFor(["spring", "react"], "statusLabels"), []);
  assert.deepStrictEqual(hooksFor(["flutter"], "없는훅"), []);
});

test("훅이 없는 타입은 앱 파일 계획이 비어 있다", () => {
  assert.deepStrictEqual(planTypeAppFiles({ types: ["spring", "node"] }, "/none", "/none"), { created: [], kept: [] });
});

test("flutter 스토어 필터 훅은 배열일 때만 걸린다", () => {
  const hook = typeInfo("flutter").hooks.workflowFilter;
  assert.strictEqual(hook({ flutterStore: null }), null);
  assert.strictEqual(typeof hook({ flutterStore: ["android"] }), "function");
  // 다른 타입은 스토어 선택과 무관하게 모든 파일이 통과한다
  assert.strictEqual(buildTypeRootFilter("spring", "", ["android"])("PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml"), true);
  assert.strictEqual(buildTypeRootFilter("flutter", "", ["android"])("PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml"), false);
});
