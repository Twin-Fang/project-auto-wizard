// tests/node/dry-run.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { runFull } from "../../src/commands/full.js";
import { makeResolvers } from "../../src/core/detect-fs.js";
import { planDryRun, printDryRun } from "../../src/commands/dry-run.js";

function baseContext(overrides = {}) {
  return createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(),
    now: "2026-07-28 00:00:00", today: "2026-07-28", templateVersion: "0.1.0",
    ...overrides,
  });
}

test("planDryRun('full', ...) on empty dir: all new, version.yml would be created, writes nothing", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  try {
    const plan = planDryRun("full", baseContext(), resolvePayloadRoot(), target);
    assert.strictEqual(plan.mode, "full");
    assert.ok(plan.workflows.newFiles.length > 0);
    assert.strictEqual(plan.versionYml.existed, false);
    assert.deepStrictEqual(readdirSync(target), []);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planDryRun('full', ...) after a real install: nothing new, version.yml unchanged", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  try {
    const ctx = baseContext();
    runFull(ctx, resolvePayloadRoot(), target);
    const plan = planDryRun("full", ctx, resolvePayloadRoot(), target);
    assert.deepStrictEqual(plan.workflows.newFiles, []);
    assert.strictEqual(plan.versionYml.existed, true);
    assert.strictEqual(plan.versionYml.changed, false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});


test("printDryRun() warns that version.yml preview may be inaccurate for deploy-block types", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  try {
    const plan = planDryRun("version", baseContext(), resolvePayloadRoot(), target);
    const originalLog = console.log;
    let output = "";
    console.log = (msg) => { output += msg; };
    try {
      printDryRun(plan);
    } finally {
      console.log = originalLog;
    }
    assert.ok(output.includes("deploy: 블록이 미리보기에 반영되지 않아"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planDryRun('full', ...) with semver_auto:false preserved -> versionYml unchanged", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  try {
    const ctx = baseContext({ includeSemverAuto: false });
    runFull(ctx, resolvePayloadRoot(), target);
    const plan = planDryRun("full", ctx, resolvePayloadRoot(), target);
    assert.strictEqual(plan.versionYml.changed, false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// ── Flutter 스토어 배포 파일 ──────────────────────────────
const FLUTTER_APP_TEMPLATES = ["android/fastlane/Fastfile.playstore", "ios/fastlane/Fastfile", "ios/ExportOptions.plist"];

// payload/flutter-app은 다른 작업에서 채워지므로, 임시 payload 사본에 최소 템플릿을 심어 독립적으로 검증한다.
function payloadWithFlutterApp() {
  const root = mkdtempSync(join(tmpdir(), "paw-dry-payload-"));
  cpSync(resolvePayloadRoot(), root, { recursive: true });
  for (const rel of FLUTTER_APP_TEMPLATES) {
    mkdirSync(dirname(join(root, "flutter-app", rel)), { recursive: true });
    writeFileSync(join(root, "flutter-app", rel), "stub\n");
  }
  return root;
}

function flutterContext(target, stores) {
  const paths = new Map([["flutter", "app"]]);
  const flutterOptions = { envMode: "dart-define", stores, androidDeployMode: "store_only", iosDeployMode: "store_only" };
  return baseContext({
    types: ["flutter"], paths, flutterStore: stores,
    envMode: flutterOptions.envMode, androidDeployMode: "store_only", iosDeployMode: "store_only",
    resolvers: makeResolvers(target, "sample", paths, flutterOptions),
  });
}

function captureLog(fn) {
  const originalLog = console.log;
  let output = "";
  console.log = (msg) => { output += msg; };
  try { fn(); } finally { console.log = originalLog; }
  return output;
}

test("planDryRun('full', ...) Flutter: 선택한 플랫폼의 스토어 배포 파일이 Flutter 루트(app) 기준 신규 목록에 들어가고 아무것도 쓰지 않는다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  const payload = payloadWithFlutterApp();
  try {
    const plan = planDryRun("full", flutterContext(target, ["android"]), payload, target);
    assert.deepStrictEqual(plan.flutterApp.created, ["app/android/fastlane/Fastfile.playstore"]);
    assert.deepStrictEqual(plan.flutterApp.kept, []);
    assert.deepStrictEqual(readdirSync(target), []);

    const both = planDryRun("full", flutterContext(target, ["android", "ios"]), payload, target);
    assert.deepStrictEqual(both.flutterApp.created, [
      "app/android/fastlane/Fastfile.playstore", "app/ios/fastlane/Fastfile", "app/ios/ExportOptions.plist",
    ]);
  } finally {
    rmSync(target, { recursive: true, force: true });
    rmSync(payload, { recursive: true, force: true });
  }
});

test("printDryRun: 이미 있는 스토어 배포 파일은 '기존 파일 유지'로 표시하고 신규 목록과 구분한다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  const payload = payloadWithFlutterApp();
  try {
    mkdirSync(join(target, "app/android/fastlane"), { recursive: true });
    writeFileSync(join(target, "app/android/fastlane/Fastfile.playstore"), "# 내가 고친 Fastfile\n");
    const plan = planDryRun("full", flutterContext(target, ["android", "ios"]), payload, target);
    assert.deepStrictEqual(plan.flutterApp.kept, ["app/android/fastlane/Fastfile.playstore"]);
    assert.deepStrictEqual(plan.flutterApp.created, ["app/ios/fastlane/Fastfile", "app/ios/ExportOptions.plist"]);

    const output = captureLog(() => printDryRun(plan));
    assert.ok(output.includes("Flutter 스토어 배포 파일 — 신규 (2개)"));
    assert.ok(output.includes("+ app/ios/ExportOptions.plist"));
    assert.ok(output.includes("Flutter 스토어 배포 파일 — 기존 파일 유지 (1개"));
    assert.ok(output.includes("= app/android/fastlane/Fastfile.playstore (기존 파일 유지)"));
  } finally {
    rmSync(target, { recursive: true, force: true });
    rmSync(payload, { recursive: true, force: true });
  }
});

test("printDryRun: Flutter가 아니면 스토어 배포 파일 블록을 출력하지 않는다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  try {
    const plan = planDryRun("full", baseContext(), resolvePayloadRoot(), target);
    assert.deepStrictEqual(plan.flutterApp, { created: [], kept: [] });
    assert.ok(!captureLog(() => printDryRun(plan)).includes("Flutter 스토어 배포 파일"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

