// Flutter 옵션 결정 우선순위 (이슈 #131): CLI > version.yml 저장값 > 기본값.
// 기본값은 신규 설치=dart-define, 기존 설치(version.yml 있음, 저장값 없음)=dotenv 보존.
import { test } from "node:test";
import assert from "node:assert";
import { resolveFlutterOptions } from "../../src/core/flutter-options.js";
import { createContext } from "../../src/context.js";

const NO_CLI = { envMode: "", stores: null, androidDeployMode: "", iosDeployMode: "" };
// types 기본값은 "Flutter가 이미 설치된 프로젝트"를 모델링한다 — parseExisting()이 돌려주는
// 실제 모양(options 옆에 types 배열이 나란히 있음)과 맞춘다.
const existingWith = (options = {}, types = ["flutter"]) => ({
  types,
  options: { envMode: null, flutterStore: null, androidDeployMode: null, iosDeployMode: null, ...options },
});

test("신규 설치(existing=null): dart-define, 스토어 미결정(null), 배포 모드 store_only", () => {
  assert.deepStrictEqual(resolveFlutterOptions({ cli: NO_CLI, existing: null }), {
    envMode: "dart-define", stores: null, androidDeployMode: "store_only", iosDeployMode: "store_only",
  });
});

test("cli를 생략해도 동작한다", () => {
  assert.strictEqual(resolveFlutterOptions({ existing: null }).envMode, "dart-define");
  assert.strictEqual(resolveFlutterOptions({}).envMode, "dart-define");
});

test("기존 설치(version.yml 있음, 저장값 없음): dotenv를 보존한다", () => {
  const out = resolveFlutterOptions({ cli: NO_CLI, existing: existingWith() });
  assert.strictEqual(out.envMode, "dotenv");
  assert.strictEqual(out.stores, null);
  assert.strictEqual(out.androidDeployMode, "store_only");
  assert.strictEqual(out.iosDeployMode, "store_only");
});

test("저장값이 있으면 기존 설치 보존값·기본값보다 우선한다", () => {
  const out = resolveFlutterOptions({
    cli: NO_CLI,
    existing: existingWith({
      envMode: "dart-define", flutterStore: "ios", androidDeployMode: "store_prepare", iosDeployMode: "store_submit",
    }),
  });
  assert.deepStrictEqual(out, {
    envMode: "dart-define", stores: ["ios"], androidDeployMode: "store_prepare", iosDeployMode: "store_submit",
  });
});

test("저장된 flutter_store가 'none'이면 빈 배열(선택 안 함)이다", () => {
  assert.deepStrictEqual(resolveFlutterOptions({ cli: NO_CLI, existing: existingWith({ flutterStore: "none" }) }).stores, []);
});

test("기존 설치라도 Flutter가 새로 추가된 경우(타입 목록에 flutter가 없었음)는 dotenv를 보존하지 않고 dart-define이 기본이다", () => {
  const out = resolveFlutterOptions({ cli: NO_CLI, existing: existingWith({}, ["spring"]) });
  assert.strictEqual(out.envMode, "dart-define");
});

test("CLI 값이 저장값을 덮어쓴다", () => {
  const out = resolveFlutterOptions({
    cli: { envMode: "dotenv", stores: ["android"], androidDeployMode: "store_submit", iosDeployMode: "store_prepare" },
    existing: existingWith({
      envMode: "dart-define", flutterStore: "ios", androidDeployMode: "store_only", iosDeployMode: "store_only",
    }),
  });
  assert.deepStrictEqual(out, {
    envMode: "dotenv", stores: ["android"], androidDeployMode: "store_submit", iosDeployMode: "store_prepare",
  });
});

test("CLI 스토어가 빈 배열(--flutter-store none)이면 저장값이 있어도 빈 배열이다", () => {
  const out = resolveFlutterOptions({ cli: { ...NO_CLI, stores: [] }, existing: existingWith({ flutterStore: "android,ios" }) });
  assert.deepStrictEqual(out.stores, []);
});

test("CLI로 일부만 지정하면 나머지는 저장값/기본값을 유지한다", () => {
  const out = resolveFlutterOptions({
    cli: { ...NO_CLI, iosDeployMode: "store_submit" },
    existing: existingWith({ envMode: "dart-define", androidDeployMode: "store_prepare" }),
  });
  assert.strictEqual(out.envMode, "dart-define");
  assert.strictEqual(out.androidDeployMode, "store_prepare");
  assert.strictEqual(out.iosDeployMode, "store_submit");
});

test("저장값이 손으로 고쳐져 유효하지 않으면 무시하고 기본 규칙으로 되돌아간다 (워크플로우에 임의 문자열이 새지 않게)", () => {
  const out = resolveFlutterOptions({
    cli: NO_CLI,
    existing: existingWith({
      envMode: "both", flutterStore: "windows", androidDeployMode: "x' || 'y", iosDeployMode: "publish",
    }),
  });
  assert.deepStrictEqual(out, {
    envMode: "dotenv", stores: null, androidDeployMode: "store_only", iosDeployMode: "store_only",
  });
});

test("createContext: Flutter 옵션 기본값은 '미결정'이다", () => {
  const ctx = createContext();
  assert.strictEqual(ctx.envMode, "");
  assert.strictEqual(ctx.flutterStore, null);
  assert.strictEqual(ctx.androidDeployMode, "");
  assert.strictEqual(ctx.iosDeployMode, "");
});

test("createContext: overrides로 Flutter 옵션을 주입할 수 있다", () => {
  const ctx = createContext({ envMode: "dotenv", flutterStore: ["ios"], androidDeployMode: "store_prepare", iosDeployMode: "store_submit" });
  assert.strictEqual(ctx.envMode, "dotenv");
  assert.deepStrictEqual(ctx.flutterStore, ["ios"]);
  assert.strictEqual(ctx.androidDeployMode, "store_prepare");
  assert.strictEqual(ctx.iosDeployMode, "store_submit");
});
