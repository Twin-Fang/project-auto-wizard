import "../setup-lang.mjs"; // these tests assert the ko output
import { test } from "node:test";
import assert from "node:assert";
import { hooksFor, typeInfo, mergeHookResults } from "../../src/core/types.js";
import { parseArgs, TYPE_CLI_FLAGS } from "../../src/cli/args.js";
import { createContext } from "../../src/context.js";
import { buildInstallContext } from "../../src/commands/install-settings.js";
import { planTypeAppFiles } from "../../src/core/copy/app-files.js";
import { buildTypeRootFilter } from "../../src/core/copy/workflows.js";

test("hooksFor: returns only types that have hooks, in the given order", () => {
  assert.deepStrictEqual(hooksFor(["spring", "flutter", "react"], "statusLabels").map((h) => h.id), ["flutter"]);
  assert.deepStrictEqual(hooksFor(["spring", "react"], "statusLabels"), []);
  assert.deepStrictEqual(hooksFor(["flutter"], "없는훅"), []);
});

test("a type without hooks has an empty app file plan", () => {
  assert.deepStrictEqual(planTypeAppFiles({ types: ["spring", "node"] }, "/none", "/none"), { created: [], kept: [] });
});

test("the flutter store filter hook applies only for an array", () => {
  const hook = typeInfo("flutter").hooks.workflowFilter;
  assert.strictEqual(hook({ flutterStore: null }), null);
  assert.strictEqual(typeof hook({ flutterStore: ["android"] }), "function");
  // Other types pass every file regardless of the store selection
  assert.strictEqual(buildTypeRootFilter("spring", "", ["android"])("PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml"), true);
  assert.strictEqual(buildTypeRootFilter("flutter", "", ["android"])("PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml"), false);
});

test("the option hook creates option/context fields only when that type is present", () => {
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

test("type-specific CLI flags are parsed as the hook declares and unspecified values are initial", () => {
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

test("the install warning hook does not warn for a store that was not selected", () => {
  const hook = typeInfo("flutter").hooks.installNotices;
  const base = { androidDeployMode: "store_submit", iosDeployMode: "store_submit" };
  assert.strictEqual(hook({ ...base, stores: ["ios"] }).filter(Boolean).length, 1);
  assert.strictEqual(hook({ ...base, stores: null }).filter(Boolean).length, 2);
  assert.strictEqual(hook({ ...base, stores: [] }).filter(Boolean).length, 0);
});
