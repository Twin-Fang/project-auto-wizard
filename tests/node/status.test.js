import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { runStatus, printStatus } from "../../src/commands/status.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

function installFixture() {
  const target = mkdtempSync(join(tmpdir(), "paw-status-"));
  const ctx = createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(),
    now: "2026-07-28 00:00:00", today: "2026-07-28", templateVersion: "0.1.0",
  });
  runFull(ctx, resolvePayloadRoot(), target);
  return target;
}

test("runStatus: not installed", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-status-empty-"));
  try {
    assert.deepStrictEqual(runStatus(resolvePayloadRoot(), target), { installed: false });
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("runStatus: fresh install reports version and no modified files", () => {
  const target = installFixture();
  try {
    const status = runStatus(resolvePayloadRoot(), target);
    assert.strictEqual(status.installed, true);
    assert.strictEqual(status.version, "1.0.0");
    assert.deepStrictEqual(status.types, ["basic"]);
    assert.deepStrictEqual(status.modifiedFiles, []);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("printStatus: null nexus/secretBackup render as '미설정(기본 false)' not raw null", () => {
  const status = {
    installed: true,
    version: "1.0.0",
    templateVersion: "0.1.0",
    types: ["basic"],
    branches: null,
    options: { nexus: null, secretBackup: null, semverAuto: null },
    modifiedFiles: [],
  };
  const originalLog = console.log;
  let output = "";
  console.log = (msg) => { output += msg; };
  try {
    printStatus(status);
  } finally {
    console.log = originalLog;
  }
  assert.ok(!output.includes("nexus=null"), "nexus=null must not leak into output");
  assert.ok(!output.includes("secret_backup=null"), "secret_backup=null must not leak into output");
  assert.ok(output.includes("nexus=미설정(기본 false)"));
  assert.ok(output.includes("secret_backup=미설정(기본 false)"));
  assert.ok(output.includes("semver_auto=미설정(기본 false)"));
});

test("runStatus: version.yml without a branches block does not false-flag every workflow as modified", () => {
  // version.yml이 branches 기능 이전에 만들어졌거나 수기 편집으로 branches 블록이 빠진 경우 —
  // parseTemplateBranches가 null을 반환해도 status가 매 파일을 오탐 드리프트로 보고하면 안 된다.
  const target = installFixture();
  try {
    const vyPath = join(target, "version.yml");
    const original = readFileSync(vyPath, "utf8");
    const stripped = original
      .split("\n")
      .filter((l) => !/^\s*branches:\s*$/.test(l) && !/^\s+(main|develop|mode):\s*"?[\w-]/.test(l))
      .join("\n");
    writeFileSync(vyPath, stripped);

    const status = runStatus(resolvePayloadRoot(), target);
    assert.strictEqual(status.branches, null, "branches should be null once the block is stripped");
    assert.deepStrictEqual(status.modifiedFiles, []);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("runStatus: user-edited common workflow file appears in modifiedFiles", () => {
  const target = installFixture();
  try {
    const wfPath = join(target, ".github/workflows/PROJECT-COMMON-VERSION-CONTROL.yaml");
    assert.ok(existsSync(wfPath));
    writeFileSync(wfPath, readFileSync(wfPath, "utf8") + "\n# user edit\n");

    const status = runStatus(resolvePayloadRoot(), target);
    assert.ok(status.modifiedFiles.includes("PROJECT-COMMON-VERSION-CONTROL.yaml"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

function renderStatus(status) {
  const originalLog = console.log;
  let output = "";
  console.log = (msg) => { output += msg; };
  try {
    printStatus(status);
  } finally {
    console.log = originalLog;
  }
  return output;
}

const FLUTTER_STATUS = {
  installed: true, version: "1.0.0", templateVersion: "0.10.1", types: ["flutter"], branches: null,
  options: {
    nexus: false, secretBackup: false, semverAuto: true,
    envMode: "dotenv", flutterStore: "android", androidDeployMode: "store_prepare", iosDeployMode: "store_only",
  },
  modifiedFiles: [],
};

test("printStatus: Flutter 타입이면 옵션 줄에 env_mode·flutter_store·배포 모드가 표시된다", () => {
  const output = renderStatus(FLUTTER_STATUS);
  assert.ok(output.includes("env_mode=dotenv"));
  assert.ok(output.includes("flutter_store=android"));
  assert.ok(output.includes("android_deploy_mode=store_prepare"));
  assert.ok(output.includes("ios_deploy_mode=store_only"));
});

test("printStatus: Flutter 저장값이 없으면 실제로 적용되는 기본 동작을 함께 알려준다", () => {
  const output = renderStatus({
    ...FLUTTER_STATUS,
    options: { nexus: false, secretBackup: false, semverAuto: true, envMode: null, flutterStore: null, androidDeployMode: null, iosDeployMode: null },
  });
  assert.ok(output.includes("env_mode=미설정(dotenv 유지)"));
  assert.ok(output.includes("flutter_store=미설정(둘 다 설치)"));
  assert.ok(output.includes("android_deploy_mode=미설정(store_only)"));
  assert.ok(output.includes("ios_deploy_mode=미설정(store_only)"));
  assert.ok(!output.includes("=null"));
});

test("printStatus: Flutter 타입이 아니면 Flutter 옵션은 표시하지 않는다", () => {
  const output = renderStatus({ ...FLUTTER_STATUS, types: ["spring"] });
  assert.ok(!output.includes("env_mode="));
  assert.ok(!output.includes("flutter_store="));
});

test("runStatus: env_mode·배포 모드 치환 일치 검증", () => {
  // 설치 때 env_mode·배포 모드가 워크플로우에 치환되고 status가 같은 옵션으로 비교하지 않으면
  // PLAYSTORE가 '수정됨'으로 오탐된다. makeResolvers 4번째 인자가 없으면 여기서 실패한다.
  const target = mkdtempSync(join(tmpdir(), "paw-status-flutter-"));
  try {
    cpSync(join(REPO_ROOT, "tests/fixtures/flutter/pubspec.yaml"), join(target, "pubspec.yaml"));
    execFileSync(process.execPath, [
      join(REPO_ROOT, "bin/project-auto-wizard.js"),
      "--mode", "full", "--force", "--type", "flutter",
      "--main-branch", "main", "--develop-branch", "develop",
      "--flutter-env-mode", "dotenv", "--flutter-store", "android", "--android-deploy-mode", "store_prepare",
    ], { cwd: target, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

    const status = runStatus(resolvePayloadRoot(), target);
    assert.deepStrictEqual(status.modifiedFiles, []);
    assert.deepStrictEqual(status.buckets.removed, []);
    assert.strictEqual(status.options.envMode, "dotenv");
    assert.strictEqual(status.options.flutterStore, "android");
    assert.strictEqual(status.options.androidDeployMode, "store_prepare");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("runStatus: 스토어 선택 필터 검증 — 둘 다 설치 후 하나 해제 시 삭제 오탐 없음", () => {
  // 시나리오: (1) --flutter-store android,ios로 설치 (둘 다 baseline에 기록)
  //          (2) version.yml의 flutter_store를 "android"로 수기 편집 + iOS 워크플로우 파일 삭제
  //              (사용자가 full을 안 돌리고 직접 수정 후 iOS 파일 삭제)
  //          (3) runStatus 실행 → iOS 파일이 디스크에는 없지만 baseline에는 있는 상태
  //          (4) context.flutterStore=["android"] 필터가 있으면 iOS 파일이 스캔 대상에서 제외되어
  //              removed 버킷에 나타나지 않아야 함. 필터가 없으면 removed에 나타나야 함.
  const target = mkdtempSync(join(tmpdir(), "paw-status-flutter-filter-"));
  try {
    cpSync(join(REPO_ROOT, "tests/fixtures/flutter/pubspec.yaml"), join(target, "pubspec.yaml"));
    // (1) 두 스토어 모두 설치
    execFileSync(process.execPath, [
      join(REPO_ROOT, "bin/project-auto-wizard.js"),
      "--mode", "full", "--force", "--type", "flutter",
      "--main-branch", "main", "--develop-branch", "develop",
      "--flutter-env-mode", "dotenv", "--flutter-store", "android,ios", "--android-deploy-mode", "store_prepare", "--ios-deploy-mode", "store_only",
    ], { cwd: target, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

    const vyPath = join(target, "version.yml");
    // (2a) version.yml의 flutter_store를 "android"로만 수기 편집
    const original = readFileSync(vyPath, "utf8");
    const edited = original.replace(/flutter_store:\s*"?[\w,]+"?/, 'flutter_store: "android"');
    writeFileSync(vyPath, edited);

    // (2b) iOS 워크플로우 파일을 실제로 삭제 (baseline은 그대로 두어 "디스크엔 없고 baseline엔 있음" 상태 생성)
    const workflowsDir = join(target, ".github/workflows");
    const iosFiles = ["PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml", "PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml"];
    for (const file of iosFiles) {
      const filePath = join(workflowsDir, file);
      if (existsSync(filePath)) rmSync(filePath);
    }

    // (3) runStatus 실행 — context.flutterStore는 "android"로 해석되어 iOS 필터 적용됨
    const status = runStatus(resolvePayloadRoot(), target);

    // (4) context.flutterStore 필터가 있으면 iOS 파일이 classify 스캔 대상에서 제외되어 removed에 나타나지 않아야 함
    const iosRemoved = status.buckets.removed.filter((f) => f.includes("IOS") || f.includes("ios"));
    assert.deepStrictEqual(iosRemoved, [], `iOS 워크플로우가 removed로 오탐됨 (필터 배선 실패): ${JSON.stringify(iosRemoved)}`);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
