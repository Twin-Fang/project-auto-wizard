import "../setup-lang.mjs"; // these tests assert the ko output
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

test("printStatus: a null option is shown as unset", () => {
  const status = {
    installed: true,
    version: "1.0.0",
    templateVersion: "0.1.0",
    types: ["basic"],
    branches: null,
    options: { semverAuto: null },
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
  assert.ok(!output.includes("semver_auto=null"), "semver_auto=null must not leak into output");
  assert.ok(output.includes("semver_auto=미설정(기본 false)"));
});

test("runStatus: version.yml without a branches block does not false-flag every workflow as modified", () => {
  // version.yml was created before the branches feature, or the branches block was removed by hand —
  // even if parseTemplateBranches returns null, status must not report every file as a false-positive drift.
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
    semverAuto: true,
    envMode: "dotenv", flutterStore: "android", androidDeployMode: "store_prepare", iosDeployMode: "store_only",
  },
  modifiedFiles: [],
};

test("printStatus: for the Flutter type the option line shows env_mode, flutter_store and deploy modes", () => {
  const output = renderStatus(FLUTTER_STATUS);
  assert.ok(output.includes("env_mode=dotenv"));
  assert.ok(output.includes("flutter_store=android"));
  assert.ok(output.includes("android_deploy_mode=store_prepare"));
  assert.ok(output.includes("ios_deploy_mode=store_only"));
});

test("printStatus: with no stored Flutter values, also reports the default behavior actually applied", () => {
  const output = renderStatus({
    ...FLUTTER_STATUS,
    options: { semverAuto: true, envMode: null, flutterStore: null, androidDeployMode: null, iosDeployMode: null },
  });
  assert.ok(output.includes("env_mode=미설정(dotenv 유지)"));
  assert.ok(output.includes("flutter_store=미설정(둘 다 설치)"));
  assert.ok(output.includes("android_deploy_mode=미설정(store_only)"));
  assert.ok(output.includes("ios_deploy_mode=미설정(store_only)"));
  assert.ok(!output.includes("=null"));
});

test("printStatus: Flutter options are not shown for non-Flutter types", () => {
  const output = renderStatus({ ...FLUTTER_STATUS, types: ["spring"] });
  assert.ok(!output.includes("env_mode="));
  assert.ok(!output.includes("flutter_store="));
});

test("runStatus: env_mode and deploy mode substitution consistency", () => {
  // env_mode and deploy mode are substituted into the workflow at install; if status does not compare with the same options,
  // PLAYSTORE is falsely flagged as modified. Without the 4th argument of makeResolvers this fails here.
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

test("runStatus: store selection filter — no false deletion report after installing both and deselecting one", () => {
  // Scenario: (1) install with --flutter-store android,ios (both recorded in the baseline)
  //          (2) hand-edit flutter_store in version.yml to "android" + delete the iOS workflow file
  //              (the user edits directly without running full, then deletes the iOS file)
  //          (3) run runStatus → the iOS file is absent on disk but present in the baseline
  //          (4) with the context.flutterStore=["android"] filter the iOS file is excluded from the scan
  //              and must not appear in the removed bucket. Without the filter it must appear in removed.
  const target = mkdtempSync(join(tmpdir(), "paw-status-flutter-filter-"));
  try {
    cpSync(join(REPO_ROOT, "tests/fixtures/flutter/pubspec.yaml"), join(target, "pubspec.yaml"));
    // (1) install both stores
    execFileSync(process.execPath, [
      join(REPO_ROOT, "bin/project-auto-wizard.js"),
      "--mode", "full", "--force", "--type", "flutter",
      "--main-branch", "main", "--develop-branch", "develop",
      "--flutter-env-mode", "dotenv", "--flutter-store", "android,ios", "--android-deploy-mode", "store_prepare", "--ios-deploy-mode", "store_only",
    ], { cwd: target, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

    const vyPath = join(target, "version.yml");
    // (2a) hand-edit only flutter_store in version.yml to "android"
    const original = readFileSync(vyPath, "utf8");
    const edited = original.replace(/flutter_store:\s*"?[\w,]+"?/, 'flutter_store: "android"');
    writeFileSync(vyPath, edited);

    // (2b) actually delete the iOS workflow file (leave the baseline as is to create "absent on disk, present in baseline")
    const workflowsDir = join(target, ".github/workflows");
    const iosFiles = ["PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml", "PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml"];
    for (const file of iosFiles) {
      const filePath = join(workflowsDir, file);
      if (existsSync(filePath)) rmSync(filePath);
    }

    // (3) run runStatus — context.flutterStore resolves to "android" so the iOS filter applies
    const status = runStatus(resolvePayloadRoot(), target);

    // (4) with the context.flutterStore filter the iOS file is excluded from the classify scan and must not appear in removed
    const iosRemoved = status.buckets.removed.filter((f) => f.includes("IOS") || f.includes("ios"));
    assert.deepStrictEqual(iosRemoved, [], `iOS workflow falsely reported as removed (filter wiring failed): ${JSON.stringify(iosRemoved)}`);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// Edits to the CD of the deploy style chosen at install (nginx, traefik) must be caught as drift too.
for (const style of ["nginx", "traefik"]) {
  test(`runStatus: editing the CD installed with deploy_style=${style} is shown as a modified file`, async () => {
    const target = mkdtempSync(join(tmpdir(), "paw-status-deploy-"));
    const original = process.stderr.write;
    const originalLog = console.log;
    try {
      writeFileSync(join(target, "build.gradle"), "version = '1.0.0'\n");
      const { run } = await import("../../src/index.js");
      process.stderr.write = () => true;
      console.log = () => {};
      assert.strictEqual(await run(["--mode", "full", "--force", "--type", "spring", "--deploy-style", style], { cwd: target }), 0);
      process.stderr.write = original;
      console.log = originalLog;

      const file = `PROJECT-SPRING-NONSTOP-${style.toUpperCase()}-CICD.yaml`;
      assert.deepStrictEqual(runStatus(resolvePayloadRoot(), target).modifiedFiles, []);
      const p = join(target, ".github", "workflows", file);
      writeFileSync(p, readFileSync(p, "utf8") + "\n# edit\n");
      const status = runStatus(resolvePayloadRoot(), target);
      assert.deepStrictEqual(status.modifiedFiles, [file]);
      assert.strictEqual(status.options.deployStyle, style);
    } finally {
      process.stderr.write = original;
      console.log = originalLog;
      rmSync(target, { recursive: true, force: true });
    }
  });
}
