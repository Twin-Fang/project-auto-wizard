// 이슈 #131 — Flutter 마법사 선택지 3개(환경변수 방식·스토어 배포 대상·배포 모드)와 수정 메뉴 항목.
// node --test 실행 환경은 stdin이 TTY가 아니므로 readline-engine이 initialIndex/initialValues를
// 그대로 돌려준다 — "질문 없이 넘어갈 때의 값"이 곧 각 함수의 기본값이다.
import { test } from "node:test";
import assert from "node:assert";
import {
  selectEnvMode, selectFlutterStores, selectDeployMode, deployModeWarning, editMenuOptions,
} from "../../src/ui/prompts.js";

test("selectEnvMode: 초기값이 없으면 신규 설치 기본값인 dart-define을 반환한다", async () => {
  assert.strictEqual(await selectEnvMode(), "dart-define");
});

test("selectEnvMode: initialValue(현재값)를 커서 초기 위치로 존중한다", async () => {
  assert.strictEqual(await selectEnvMode({ initialValue: "dotenv" }), "dotenv");
  assert.strictEqual(await selectEnvMode({ initialValue: "dart-define" }), "dart-define");
});

test("selectFlutterStores: 초기 선택이 없으면 빈 배열(스토어 배포 안 함)을 반환한다", async () => {
  assert.deepStrictEqual(await selectFlutterStores(), []);
});

test("selectFlutterStores: initialValues(기존 설치에서 추론한 플랫폼)를 그대로 초기 선택으로 쓴다", async () => {
  assert.deepStrictEqual(await selectFlutterStores({ initialValues: ["ios"] }), ["ios"]);
  assert.deepStrictEqual(await selectFlutterStores({ initialValues: ["android", "ios"] }), ["android", "ios"]);
});

test("selectDeployMode: 기본값은 store_only이고 플랫폼별로 initialValue를 존중한다", async () => {
  assert.strictEqual(await selectDeployMode({ platform: "android" }), "store_only");
  assert.strictEqual(await selectDeployMode({ platform: "ios" }), "store_only");
  assert.strictEqual(await selectDeployMode({ platform: "android", initialValue: "store_prepare" }), "store_prepare");
  assert.strictEqual(await selectDeployMode({ platform: "ios", initialValue: "store_submit" }), "store_submit");
});

test("deployModeWarning: store_submit만 'main push마다 심사가 자동 제출' 경고를 돌려준다", () => {
  assert.ok(deployModeWarning("store_submit").includes("main push마다 심사가 자동 제출"));
  assert.strictEqual(deployModeWarning("store_only"), "");
  assert.strictEqual(deployModeWarning("store_prepare"), "");
  assert.strictEqual(deployModeWarning(undefined), "");
});

test("editMenuOptions: showFlutter가 꺼져 있으면 Flutter 항목이 없다 (기존 동작 그대로)", () => {
  assert.deepStrictEqual(editMenuOptions().map((o) => o.value), ["type", "version", "branch", "done"]);
});

test("editMenuOptions: showFlutter면 '모두 맞음' 바로 앞에 환경변수 방식·스토어 배포 대상·배포 모드가 붙는다", () => {
  const options = editMenuOptions({ showFlutter: true });
  assert.deepStrictEqual(options.map((o) => o.value),
    ["type", "version", "branch", "envMode", "flutterStore", "deployMode", "done"]);
  assert.deepStrictEqual(
    options.filter((o) => ["envMode", "flutterStore", "deployMode"].includes(o.value)).map((o) => o.label),
    ["환경변수 방식", "스토어 배포 대상", "배포 모드"]);
});
