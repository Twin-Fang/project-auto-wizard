// tests/node/dry-run.test.js
import "../setup-lang.mjs"; // these tests assert the ko output
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, readdirSync, readFileSync } from "node:fs";
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

test("planDryRun('full', ...) 시각만 다른 재실행이면 version.yml 변경 없음으로 본다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  try {
    runFull(baseContext(), resolvePayloadRoot(), target);
    // 다른 시각·날짜로 미리보기 — 실제 설치는 이 경우 파일을 다시 쓰지 않는다.
    const later = baseContext({ now: "2026-08-15 12:34:56", today: "2026-08-15" });
    const plan = planDryRun("full", later, resolvePayloadRoot(), target);
    assert.strictEqual(plan.versionYml.changed, false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planDryRun('full', ...) 시각 외 값이 달라지면 version.yml 변경으로 본다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  try {
    runFull(baseContext(), resolvePayloadRoot(), target);
    const plan = planDryRun("full", baseContext({ version: "2.0.0", now: "2026-08-15 12:34:56", today: "2026-08-15" }), resolvePayloadRoot(), target);
    assert.strictEqual(plan.versionYml.changed, true);
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


test("planDryRun/printDryRun: 스크립트 덮어쓰기·README 변경·baseline도 미리보기에 나온다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  try {
    writeFileSync(join(target, "README.md"), "# my-app\n");
    mkdirSync(join(target, ".github", "scripts"), { recursive: true });
    writeFileSync(join(target, ".github", "scripts", "version_manager.py"), "# my script edit\n");
    const plan = planDryRun("full", baseContext(), resolvePayloadRoot(), target);
    assert.strictEqual(plan.scripts.find((s) => s.name === "version_manager.py").action, "overwrite");
    assert.strictEqual(plan.scripts.find((s) => s.name === "changelog_manager.py").action, "create");
    assert.strictEqual(plan.readme, "added");
    assert.strictEqual(plan.baselineExists, false);

    const originalLog = console.log;
    let output = "";
    console.log = (msg) => { output += msg; };
    try { printDryRun(plan); } finally { console.log = originalLog; }
    assert.match(output, /~ version_manager\.py \(기존 파일을 새 버전으로 덮어씀/);
    assert.match(output, /README\.md: 끝에 버전 섹션이 추가될 예정/);
    assert.match(output, /baseline\.json: 새로 생성될 예정/);
    // 미리보기는 아무것도 바꾸지 않는다
    assert.strictEqual(readdirSync(join(target, ".github", "scripts")).length, 1);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planDryRun: 실제 설치 뒤에는 스크립트가 변경 없음, README는 이미 섹션 있음으로 나온다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  try {
    writeFileSync(join(target, "README.md"), "# my-app\n");
    const ctx = baseContext();
    runFull(ctx, resolvePayloadRoot(), target);
    const plan = planDryRun("full", ctx, resolvePayloadRoot(), target);
    assert.ok(plan.scripts.every((s) => s.action === "unchanged"));
    assert.strictEqual(plan.readme, "skip-marker");
    assert.strictEqual(plan.baselineExists, true);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// 미리보기는 실제 실행과 같은 정리 판정을 보여줘야 한다 — 지워지거나 .bak으로 옮겨질 파일이 빠지면
// 사용자는 미리보기만 믿고 실행했다가 워크플로우가 사라진 것을 뒤늦게 알게 된다.
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[p] = readFileSync(p, "utf8");
    }
  };
  walk(dir);
  return out;
}

test("planDryRun: 배포 방식을 바꾸면 이전 CD 삭제가 미리보기에 나오고 실제 실행 결과와 같다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  try {
    const payload = resolvePayloadRoot();
    runFull(baseContext({ types: ["spring"], deployStyle: "simple" }), payload, target);
    const next = baseContext({ types: ["spring"], deployStyle: "traefik" });
    const before = snapshot(target);
    const plan = planDryRun("full", next, payload, target);
    assert.deepStrictEqual(snapshot(target), before, "미리보기는 아무 파일도 바꾸지 않는다");
    assert.deepStrictEqual(plan.cleanup.cleanup.removed, ["PROJECT-SPRING-SIMPLE-CICD.yaml"]);
    assert.strictEqual(plan.gitignore, null, "삭제만 있으면 .gitignore는 건드리지 않는다");

    const real = runFull(next, payload, target);
    assert.deepStrictEqual(real.cleanup, plan.cleanup.cleanup);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planDryRun: 수정한 CD는 .bak 이동과 .gitignore 생성이 미리보기에 나온다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  try {
    const payload = resolvePayloadRoot();
    runFull(baseContext({ types: ["spring"], deployStyle: "simple" }), payload, target);
    const simple = join(target, ".github/workflows/PROJECT-SPRING-SIMPLE-CICD.yaml");
    writeFileSync(simple, readFileSync(simple, "utf8") + "# 직접 수정\n");
    const next = baseContext({ types: ["spring"], deployStyle: "traefik" });
    const plan = planDryRun("full", next, payload, target);
    assert.deepStrictEqual(plan.cleanup.cleanup.backedUp, ["PROJECT-SPRING-SIMPLE-CICD.yaml"]);
    assert.deepStrictEqual(plan.gitignore, { created: true, added: ["*.bak", "*.template.yaml"] });

    const output = captureDryRun(plan);
    assert.match(output, /PROJECT-SPRING-SIMPLE-CICD\.yaml → PROJECT-SPRING-SIMPLE-CICD\.yaml\.bak/);
    assert.match(output, /\.gitignore: 새로 생성될 예정/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planDryRun: 스토어 선택을 해제하면 해당 워크플로우 삭제가 미리보기에 나온다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  try {
    const payload = resolvePayloadRoot();
    runFull(baseContext({ types: ["flutter"], flutterStore: ["android", "ios"] }), payload, target);
    const next = baseContext({ types: ["flutter"], flutterStore: ["android"] });
    const plan = planDryRun("full", next, payload, target);
    assert.deepStrictEqual(plan.cleanup.storeCleanup.removed.sort(),
      ["PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml", "PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml"]);
    assert.match(captureDryRun(plan), /PROJECT-FLUTTER-IOS-TESTFLIGHT\.yaml \(선택 해제된 스토어 워크플로우 정리\)/);

    const real = runFull(next, payload, target);
    assert.deepStrictEqual(real.storeCleanup.removed.sort(), plan.cleanup.storeCleanup.removed);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

function captureDryRun(plan) {
  const originalLog = console.log;
  let output = "";
  console.log = (msg) => { output += msg; };
  try {
    printDryRun(plan);
  } finally {
    console.log = originalLog;
  }
  return output;
}
