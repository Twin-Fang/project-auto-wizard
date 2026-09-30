// The 3 Flutter wizard choices (env mode, store deploy targets, deploy mode) and the edit menu items.
// Under node --test stdin is not a TTY, so readline-engine returns initialIndex/initialValues
// as is — "the value when passing without a question" is each function's default.
import "../setup-lang.mjs"; // these tests assert the ko output
import { test } from "node:test";
import assert from "node:assert";
import {
  selectEnvMode, selectFlutterStores, selectDeployMode, deployModeWarning, editMenuOptions,
} from "../../src/ui/prompts.js";

test("selectEnvMode: without an initial value, returns dart-define, the new-install default", async () => {
  assert.strictEqual(await selectEnvMode(), "dart-define");
});

test("selectEnvMode: honors initialValue (current value) as the initial cursor position", async () => {
  assert.strictEqual(await selectEnvMode({ initialValue: "dotenv" }), "dotenv");
  assert.strictEqual(await selectEnvMode({ initialValue: "dart-define" }), "dart-define");
});

test("selectFlutterStores: without an initial selection, returns an empty array (no store deploy)", async () => {
  assert.deepStrictEqual(await selectFlutterStores(), []);
});

test("selectFlutterStores: uses initialValues (platforms inferred from the existing install) as the initial selection", async () => {
  assert.deepStrictEqual(await selectFlutterStores({ initialValues: ["ios"] }), ["ios"]);
  assert.deepStrictEqual(await selectFlutterStores({ initialValues: ["android", "ios"] }), ["android", "ios"]);
});

test("selectDeployMode: default is store_only and initialValue is honored per platform", async () => {
  assert.strictEqual(await selectDeployMode({ platform: "android" }), "store_only");
  assert.strictEqual(await selectDeployMode({ platform: "ios" }), "store_only");
  assert.strictEqual(await selectDeployMode({ platform: "android", initialValue: "store_prepare" }), "store_prepare");
  assert.strictEqual(await selectDeployMode({ platform: "ios", initialValue: "store_submit" }), "store_submit");
});

test("deployModeWarning: only store_submit returns the auto-submit-on-every-main-push warning", () => {
  assert.ok(deployModeWarning("store_submit").includes("main push마다 심사가 자동 제출"));
  assert.strictEqual(deployModeWarning("store_only"), "");
  assert.strictEqual(deployModeWarning("store_prepare"), "");
  assert.strictEqual(deployModeWarning(undefined), "");
});

test("editMenuOptions: no Flutter items when showFlutter is off (existing behavior)", () => {
  assert.deepStrictEqual(editMenuOptions().map((o) => o.value), ["type", "version", "branch", "done"]);
});

test("editMenuOptions: with showFlutter, env mode, store deploy targets and deploy mode are placed right before the 'all correct' item", () => {
  const options = editMenuOptions({ showFlutter: true });
  assert.deepStrictEqual(options.map((o) => o.value),
    ["type", "version", "branch", "envMode", "flutterStore", "deployMode", "done"]);
  assert.deepStrictEqual(
    options.filter((o) => ["envMode", "flutterStore", "deployMode"].includes(o.value)).map((o) => o.label),
    ["환경변수 방식", "스토어 배포 대상", "배포 모드"]);
});
