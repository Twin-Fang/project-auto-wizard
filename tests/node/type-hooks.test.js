import { test } from "node:test";
import assert from "node:assert";
import { hooksFor, typeInfo, mergeHookResults } from "../../src/core/types.js";
import { parseArgs, TYPE_CLI_FLAGS } from "../../src/cli/args.js";
import { createContext } from "../../src/context.js";
import { buildInstallContext } from "../../src/commands/install-settings.js";
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

test("옵션 훅은 해당 타입이 있을 때만 옵션·컨텍스트 필드를 만든다", () => {
  const opts = { flutterEnvMode: "dotenv", flutterStore: ["ios"], androidDeployMode: "", iosDeployMode: "store_prepare" };
  const options = mergeHookResults(["flutter", "react"], "resolveOptions", { opts, existing: null });
  assert.deepStrictEqual(options, {
    envMode: "dotenv", stores: ["ios"], androidDeployMode: "store_only", iosDeployMode: "store_prepare",
  });
  assert.deepStrictEqual(mergeHookResults(["react"], "resolveOptions", { opts, existing: null }), {});

  const flutterCtx = buildInstallContext({ payload: "/none", existing: null, templateVersion: "1", types: ["flutter"], typeOptions: options, releaseOptions: {} });
  assert.strictEqual(flutterCtx.flutterStore[0], "ios");
  assert.strictEqual(flutterCtx.envMode, "dotenv");
  const reactCtx = buildInstallContext({ payload: "/none", existing: null, templateVersion: "1", types: ["react"], typeOptions: options, releaseOptions: {} });
  assert.strictEqual(reactCtx.flutterStore, createContext().flutterStore);
  assert.strictEqual(reactCtx.envMode, "");
});

test("타입 전용 CLI 플래그는 훅 선언대로 파싱되고 미지정 값은 initial이다", () => {
  assert.deepStrictEqual(TYPE_CLI_FLAGS.map((f) => f.flag),
    ["--flutter-env-mode", "--flutter-store", "--android-deploy-mode", "--ios-deploy-mode"]);
  const none = parseArgs([]);
  assert.strictEqual(none.flutterEnvMode, "");
  assert.strictEqual(none.flutterStore, null);
  const r = parseArgs(["--flutter-store", "none", "--ios-deploy-mode", "store_submit"]);
  assert.deepStrictEqual(r.flutterStore, []);
  assert.strictEqual(r.iosDeployMode, "store_submit");
  assert.throws(() => parseArgs(["--flutter-env-mode", "x"]), /--flutter-env-mode 값이 올바르지 않습니다/);
  assert.throws(() => parseArgs(["--flutter-store"]), /--flutter-store 값이 올바르지 않습니다/);
});

test("설치 경고 훅은 선택하지 않은 스토어에는 경고를 내지 않는다", () => {
  const hook = typeInfo("flutter").hooks.installNotices;
  const base = { androidDeployMode: "store_submit", iosDeployMode: "store_submit" };
  assert.strictEqual(hook({ ...base, stores: ["ios"] }).filter(Boolean).length, 1);
  assert.strictEqual(hook({ ...base, stores: null }).filter(Boolean).length, 2);
  assert.strictEqual(hook({ ...base, stores: [] }).filter(Boolean).length, 0);
});
