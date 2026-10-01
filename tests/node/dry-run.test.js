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

test("planDryRun('full', ...) treats a rerun that differs only in timestamp as no version.yml change", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  try {
    runFull(baseContext(), resolvePayloadRoot(), target);
    // Preview with a different time/date — a real install does not rewrite the file in this case.
    const later = baseContext({ now: "2026-08-15 12:34:56", today: "2026-08-15" });
    const plan = planDryRun("full", later, resolvePayloadRoot(), target);
    assert.strictEqual(plan.versionYml.changed, false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planDryRun('full', ...) treats a change in any value other than the timestamp as a version.yml change", () => {
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

// ── Flutter store deploy files ──────────────────────────────
const FLUTTER_APP_TEMPLATES = ["android/fastlane/Fastfile.playstore", "ios/fastlane/Fastfile", "ios/ExportOptions.plist"];

// payload/flutter-app is populated elsewhere, so seed a minimal template into a temporary payload copy to verify independently.
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

test("planDryRun('full', ...) Flutter: store deploy files of the selected platforms go in the new list relative to the Flutter root (app) and nothing is written", () => {
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

test("printDryRun: existing store deploy files are marked as kept and separated from the new list", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  const payload = payloadWithFlutterApp();
  try {
    mkdirSync(join(target, "app/android/fastlane"), { recursive: true });
    writeFileSync(join(target, "app/android/fastlane/Fastfile.playstore"), "# my edited Fastfile\n");
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

test("printDryRun: does not print the store deploy files block for non-Flutter projects", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  try {
    const plan = planDryRun("full", baseContext(), resolvePayloadRoot(), target);
    assert.deepStrictEqual(plan.flutterApp, { created: [], kept: [] });
    assert.ok(!captureLog(() => printDryRun(plan)).includes("Flutter 스토어 배포 파일"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});


test("planDryRun/printDryRun: script overwrite, README change and baseline also show up in the preview", () => {
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
    // The preview changes nothing
    assert.strictEqual(readdirSync(join(target, ".github", "scripts")).length, 1);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planDryRun: after a real install, scripts show as unchanged and README as already having the section", () => {
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

// The preview must show the same cleanup decisions as a real run — if files that will be deleted or moved to .bak are missing,
// the user trusts the preview, runs it, and only later discovers the workflow is gone.
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

test("planDryRun: changing the deploy method shows the previous CD deletion in the preview, matching the real run", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  try {
    const payload = resolvePayloadRoot();
    runFull(baseContext({ types: ["spring"], deployStyle: "simple" }), payload, target);
    const next = baseContext({ types: ["spring"], deployStyle: "traefik" });
    const before = snapshot(target);
    const plan = planDryRun("full", next, payload, target);
    assert.deepStrictEqual(snapshot(target), before, "the preview changes no files");
    assert.deepStrictEqual(plan.cleanup.cleanup.removed, ["PROJECT-SPRING-SIMPLE-CICD.yaml"]);
    assert.strictEqual(plan.gitignore, null, "with deletions only, .gitignore is left untouched");

    const real = runFull(next, payload, target);
    assert.deepStrictEqual(real.cleanup, plan.cleanup.cleanup);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planDryRun: a modified CD shows the .bak move and .gitignore creation in the preview", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  try {
    const payload = resolvePayloadRoot();
    runFull(baseContext({ types: ["spring"], deployStyle: "simple" }), payload, target);
    const simple = join(target, ".github/workflows/PROJECT-SPRING-SIMPLE-CICD.yaml");
    writeFileSync(simple, readFileSync(simple, "utf8") + "# manual edit\n");
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

test("planDryRun: deselecting a store shows that workflow's deletion in the preview", () => {
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

// ── Baseline buckets (auto-updated / kept / deleted) ─────────
test("dry-run lists the files an update would auto-replace, the ones it keeps and the ones the user deleted", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  const payload = mkdtempSync(join(tmpdir(), "paw-dry-payload-"));
  try {
    cpSync(resolvePayloadRoot(), payload, { recursive: true });
    runFull(baseContext(), payload, target);

    // Upstream changes two files; the user edits one of them plus an unrelated third and deletes a fourth.
    const wfDir = join(target, ".github/workflows");
    const upstream = (f) => { const p = join(payload, "workflows/common", f); writeFileSync(p, readFileSync(p, "utf8") + "\n# newer upstream text\n"); };
    upstream("PROJECT-COMMON-VERSION-CONTROL.yaml");
    upstream("PROJECT-COMMON-ISSUE-HELPER.yaml");
    const edited = join(wfDir, "PROJECT-COMMON-ISSUE-HELPER.yaml");
    writeFileSync(edited, readFileSync(edited, "utf8") + "\n# my edit\n");
    const localFile = join(wfDir, "PROJECT-COMMON-AI-PR-SUMMARY.yaml");
    writeFileSync(localFile, readFileSync(localFile, "utf8") + "\n# my edit\n");
    rmSync(join(wfDir, "PROJECT-COMMON-README-VERSION-UPDATE.yaml"));

    const plan = planDryRun("full", baseContext(), payload, target);
    const names = (bucket) => plan.workflows[bucket].map((f) => f.filename);
    assert.deepStrictEqual(names("upstreamOnly"), ["PROJECT-COMMON-VERSION-CONTROL.yaml"]);
    assert.deepStrictEqual(names("localOnly"), ["PROJECT-COMMON-AI-PR-SUMMARY.yaml"]);
    assert.deepStrictEqual(names("removed"), ["PROJECT-COMMON-README-VERSION-UPDATE.yaml"]);

    const out = captureLog(() => printDryRun(plan));
    assert.match(out, /자동 갱신될 파일 \(1개[^\n]*\n  ~ PROJECT-COMMON-VERSION-CONTROL\.yaml \[common\]/);
    assert.match(out, /그대로 유지할 파일 \(1개[^\n]*\n  = PROJECT-COMMON-AI-PR-SUMMARY\.yaml \[common\]/);
    assert.match(out, /복원하지 않는 파일 \(1개[^\n]*\n  - PROJECT-COMMON-README-VERSION-UPDATE\.yaml \[common\]/);

    // The real run replaces exactly the files the preview named as auto-updated.
    const real = runFull(baseContext(), payload, target);
    assert.deepStrictEqual(real.workflows.autoUpdated, ["PROJECT-COMMON-VERSION-CONTROL.yaml"]);
  } finally {
    rmSync(target, { recursive: true, force: true });
    rmSync(payload, { recursive: true, force: true });
  }
});

test("dry-run prints no baseline bucket headings when nothing falls into them", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  try {
    runFull(baseContext(), resolvePayloadRoot(), target);
    const out = captureLog(() => printDryRun(planDryRun("full", baseContext(), resolvePayloadRoot(), target)));
    assert.doesNotMatch(out, /자동 갱신될 파일|그대로 유지할 파일|복원하지 않는 파일/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("dry-run in English names the auto-updated files", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  const payload = mkdtempSync(join(tmpdir(), "paw-dry-payload-"));
  return import("../../src/i18n/index.js").then(({ setLanguage, getLanguage }) => {
    const before = getLanguage();
    try {
      cpSync(resolvePayloadRoot(), payload, { recursive: true });
      runFull(baseContext(), payload, target);
      const p = join(payload, "workflows/common/PROJECT-COMMON-VERSION-CONTROL.yaml");
      writeFileSync(p, readFileSync(p, "utf8") + "\n# newer upstream text\n");
      setLanguage("en");
      const out = captureLog(() => printDryRun(planDryRun("full", baseContext(), payload, target)));
      assert.match(out, /Auto-updated files \(1;[^\n]*\n  ~ PROJECT-COMMON-VERSION-CONTROL\.yaml \[common\]/);
      assert.doesNotMatch(out, /[가-힣]/);
    } finally {
      setLanguage(before);
      rmSync(target, { recursive: true, force: true });
      rmSync(payload, { recursive: true, force: true });
    }
  });
});

test("planDryRun: a default heading from another language is previewed as switched and nothing is written", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  try {
    const text = "# my-app\n\n<!-- AUTO-VERSION-SECTION: DO NOT EDIT MANUALLY -->\n## Latest Version : v1.0.0\n";
    writeFileSync(join(target, "README.md"), text);
    const plan = planDryRun("full", { ...baseContext(), language: "ko" }, resolvePayloadRoot(), target);
    assert.strictEqual(plan.readme, "heading-updated");
    const lines = [];
    const orig = console.log;
    console.log = (s) => lines.push(s);
    try { printDryRun(plan); } finally { console.log = orig; }
    assert.ok(lines.join("\n").includes("버전 제목이 현재 언어로 교체"));
    assert.strictEqual(readFileSync(join(target, "README.md"), "utf8"), text);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
