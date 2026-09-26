// tests/node/flutter-full-install.test.js
// runFull 통합 — 실제 payload로 Flutter 앱 파일 생성과 선택 해제된 스토어 워크플로우 정리를 검증한다.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { makeResolvers } from "../../src/core/detect-fs.js";
import { readBaseline } from "../../src/core/baseline.js";

const WF_DIR = ".github/workflows";
const PLAY = "PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml";
const TESTFLIGHT = "PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml";
const TESTFLIGHT_TEST = "PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml";
const APP_FILES = ["android/fastlane/Fastfile.playstore", "ios/fastlane/Fastfile", "ios/ExportOptions.plist"];

// sub: Flutter 프로젝트 루트(레포 기준). "."이면 단일 레포, "app"이면 모노레포.
function flutterTarget(sub = ".") {
  const target = mkdtempSync(join(tmpdir(), "paw-flutter-full-"));
  mkdirSync(join(target, sub), { recursive: true });
  writeFileSync(join(target, sub, "pubspec.yaml"), "name: fxapp\nversion: 1.0.0+1\n");
  return target;
}

function install(target, { types = ["flutter"], paths = new Map([["flutter", "."]]), flutterStore = null } = {}) {
  return runFull(createContext({
    mode: "full", force: true, types, version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths, repoName: "app", resolvers: makeResolvers(target, "app", paths),
    now: "2026-09-21 10:00:00", today: "2026-09-21", templateVersion: "0.10.0", flutterStore,
  }), resolvePayloadRoot(), target);
}

const workflows = (target) => readdirSync(join(target, WF_DIR));

test("신규 설치: Flutter 앱 파일 3개가 만들어지고 created로 보고된다", () => {
  const target = flutterTarget();
  try {
    const r = install(target);
    assert.deepStrictEqual([...r.flutterApp.created].sort(), [...APP_FILES].sort());
    assert.deepStrictEqual(r.flutterApp.kept, []);
    for (const rel of APP_FILES) assert.ok(existsSync(join(target, rel)), rel);
    assert.deepStrictEqual(r.storeCleanup, { removed: [], backedUp: [] });
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("기존 파일 유지: 이미 있는 앱 파일은 덮어쓰지 않고 재실행하면 전부 kept다", () => {
  const target = flutterTarget();
  try {
    mkdirSync(join(target, "ios"), { recursive: true });
    writeFileSync(join(target, "ios/ExportOptions.plist"), "내가 채운 값\n");

    const first = install(target);
    assert.deepStrictEqual(first.flutterApp.kept, ["ios/ExportOptions.plist"]);
    assert.strictEqual(readFileSync(join(target, "ios/ExportOptions.plist"), "utf8"), "내가 채운 값\n");

    const second = install(target);
    assert.deepStrictEqual(second.flutterApp.created, []);
    assert.strictEqual(second.flutterApp.kept.length, 3);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("모노레포: Flutter 앱 파일이 paths.flutter 아래에 만들어진다", () => {
  const target = flutterTarget("app");
  try {
    const r = install(target, { paths: new Map([["flutter", "app"]]) });
    assert.deepStrictEqual([...r.flutterApp.created].sort(), APP_FILES.map((rel) => `app/${rel}`).sort());
    for (const rel of APP_FILES) assert.ok(existsSync(join(target, "app", rel)), rel);
    assert.ok(!existsSync(join(target, "android")) && !existsSync(join(target, "ios")), "레포 루트에는 만들지 않는다");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("Flutter가 아닌 프로젝트: 앱 파일도 정리도 없다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-flutter-full-react-"));
  try {
    writeFileSync(join(target, "package.json"), '{"name":"web","version":"1.0.0"}\n');
    const r = install(target, { types: ["react"], paths: new Map([["react", "."]]), flutterStore: [] });
    assert.deepStrictEqual(r.flutterApp, { created: [], kept: [] });
    assert.deepStrictEqual(r.storeCleanup, { removed: [], backedUp: [] });
    assert.ok(!existsSync(join(target, "android")) && !existsSync(join(target, "ios")));
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("flutterStore가 null이면 이전에 깐 스토어 워크플로우를 지우지 않는다 (현행 동작)", () => {
  const target = flutterTarget();
  try {
    install(target, { flutterStore: ["android", "ios"] });
    const r = install(target, { flutterStore: null });
    assert.deepStrictEqual(r.storeCleanup, { removed: [], backedUp: [] });
    for (const f of [PLAY, TESTFLIGHT, TESTFLIGHT_TEST]) assert.ok(workflows(target).includes(f), f);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("선택 해제: 손대지 않은 iOS 워크플로우는 삭제하고 Fastfile·ExportOptions는 남긴다", () => {
  const target = flutterTarget();
  try {
    install(target, { flutterStore: ["android", "ios"] });
    const r = install(target, { flutterStore: ["android"] });

    assert.deepStrictEqual([...r.storeCleanup.removed].sort(), [TESTFLIGHT, TESTFLIGHT_TEST].sort());
    assert.deepStrictEqual(r.storeCleanup.backedUp, []);
    const files = workflows(target);
    assert.ok(files.includes(PLAY));
    assert.ok(!files.includes(TESTFLIGHT) && !files.includes(TESTFLIGHT_TEST));
    assert.ok(!files.some((f) => f.endsWith(".bak")), "미수정이면 .bak 없이 깔끔히 삭제");
    // 사용자 소유 파일은 삭제하지 않는다
    assert.ok(existsSync(join(target, "ios/fastlane/Fastfile")));
    assert.ok(existsSync(join(target, "ios/ExportOptions.plist")));
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("선택 해제: 사용자가 수정한 워크플로우는 지우지 않고 .bak으로 보존한다", () => {
  const target = flutterTarget();
  try {
    install(target, { flutterStore: ["android", "ios"] });
    const p = join(target, WF_DIR, TESTFLIGHT);
    writeFileSync(p, readFileSync(p, "utf8") + "\n# 내가 고친 부분\n");

    const r = install(target, { flutterStore: ["android"] });
    assert.deepStrictEqual(r.storeCleanup.backedUp, [TESTFLIGHT]);
    assert.deepStrictEqual(r.storeCleanup.removed, [TESTFLIGHT_TEST]);
    assert.match(readFileSync(`${p}.bak`, "utf8"), /내가 고친 부분/);
    assert.ok(!workflows(target).includes(TESTFLIGHT), "트리거는 죽어야 한다");
    assert.strictEqual(r.gitignoreUpdated, true, ".bak이 생겼으므로 .gitignore 갱신 대상이다");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("선택 해제한 파일은 baseline에서도 빠져 다음 실행에서 '사용자가 지웠다'로 오인되지 않는다", () => {
  const target = flutterTarget();
  try {
    install(target, { flutterStore: ["android", "ios"] });
    install(target, { flutterStore: ["android"] });
    const files = readBaseline(target).files;
    assert.ok(!(TESTFLIGHT in files) && !(TESTFLIGHT_TEST in files));
    assert.ok(PLAY in files);

    const again = install(target, { flutterStore: ["android"] });
    assert.deepStrictEqual(again.storeCleanup, { removed: [], backedUp: [] });
    assert.deepStrictEqual(again.workflows.removedKept, []);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("스토어 대상을 none([])으로 바꾸면 스토어 워크플로우가 전부 정리되고 앱 파일은 새로 만들지 않는다", () => {
  const target = flutterTarget();
  try {
    install(target, { flutterStore: ["android", "ios"] });
    const r = install(target, { flutterStore: [] });
    assert.deepStrictEqual([...r.storeCleanup.removed].sort(), [PLAY, TESTFLIGHT, TESTFLIGHT_TEST].sort());
    assert.deepStrictEqual(r.flutterApp.created, []);
    assert.deepStrictEqual(r.flutterApp.kept, [], "none이면 대상 자체가 없다");
    assert.ok(existsSync(join(target, "android/fastlane/Fastfile.playstore")), "이미 만든 사용자 파일은 남긴다");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("신규 설치에서 flutterStore [ios]만 고르면 iOS 앱 파일만 만들어진다", () => {
  const target = flutterTarget();
  try {
    const r = install(target, { flutterStore: ["ios"] });
    assert.deepStrictEqual([...r.flutterApp.created].sort(), ["ios/ExportOptions.plist", "ios/fastlane/Fastfile"]);
    assert.ok(!existsSync(join(target, "android")));
    assert.ok(!workflows(target).includes(PLAY));
  } finally { rmSync(target, { recursive: true, force: true }); }
});
