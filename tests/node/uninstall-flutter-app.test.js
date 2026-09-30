// tests/node/uninstall-flutter-app.test.js
// Full removal and purge delete only those wizard-created Flutter app files (Fastfile, ExportOptions.plist)
// that the user has not touched. Pre-existing files and files with filled-in values are kept.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { runUninstall } from "../../src/commands/uninstall.js";
import { executePurge } from "../../src/commands/purge.js";
import { planRemoval } from "../../src/core/removal-plan.js";

const PAYLOAD = resolvePayloadRoot();
const ALL_ON = { workflows: true, scripts: true, readme: false, gitignore: false, versionYml: false };

// Install into a monorepo with the Flutter app under app/
function installFlutter(prepare = () => {}) {
  const target = mkdtempSync(join(tmpdir(), "paw-uninstall-fa-"));
  mkdirSync(join(target, "app", "lib"), { recursive: true });
  writeFileSync(join(target, "app", "pubspec.yaml"), "name: my_app\nversion: 1.0.0+1\n");
  prepare(target);
  const ctx = createContext({
    mode: "full", force: true, types: ["flutter"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map([["flutter", "app"]]),
    now: "2026-09-01 00:00:00", today: "2026-09-01", templateVersion: "0.1.0",
  });
  runFull(ctx, PAYLOAD, target);
  return target;
}

test("uninstall: removes unmodified wizard-created Flutter app files and empty folders", () => {
  const target = installFlutter();
  try {
    assert.ok(existsSync(join(target, "app/ios/fastlane/Fastfile")));
    const r = runUninstall({}, PAYLOAD, target, ALL_ON);
    assert.deepStrictEqual([...r.appFiles].sort(), [
      "app/android/fastlane/Fastfile.playstore", "app/ios/ExportOptions.plist", "app/ios/fastlane/Fastfile",
    ]);
    for (const rel of r.appFiles) assert.ok(!existsSync(join(target, rel)), `${rel} remains`);
    // Wizard-created folders (app/ios, app/android) also disappear when empty. The Flutter root stays.
    assert.ok(!existsSync(join(target, "app/ios")));
    assert.ok(!existsSync(join(target, "app/android")));
    assert.ok(existsSync(join(target, "app/pubspec.yaml")));
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("uninstall: keeps files with filled-in values and pre-existing files", () => {
  const target = installFlutter((t) => {
    mkdirSync(join(t, "app/android/fastlane"), { recursive: true });
    writeFileSync(join(t, "app/android/fastlane/Fastfile.playstore"), "# my own fastfile\n");
  });
  try {
    const plist = join(target, "app/ios/ExportOptions.plist");
    writeFileSync(plist, readFileSync(plist, "utf8").replace("__TEAM_ID__", "ABCDE12345"));
    const r = runUninstall({}, PAYLOAD, target, ALL_ON);
    assert.deepStrictEqual(r.appFiles, ["app/ios/fastlane/Fastfile"]);
    assert.ok(existsSync(plist), "the filled-in ExportOptions.plist must remain");
    assert.strictEqual(readFileSync(join(target, "app/android/fastlane/Fastfile.playstore"), "utf8"), "# my own fastfile\n");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("uninstall: a file whose only change is CRLF line endings counts as unmodified", () => {
  const target = installFlutter();
  try {
    const p = join(target, "app/ios/fastlane/Fastfile");
    writeFileSync(p, readFileSync(p, "utf8").replace(/\r?\n/g, "\r\n"));
    assert.ok(planRemoval(PAYLOAD, target).appFiles.includes("app/ios/fastlane/Fastfile"));
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("uninstall: without selecting the workflows item, Flutter app files are kept too", () => {
  const target = installFlutter();
  try {
    const r = runUninstall({}, PAYLOAD, target, { ...ALL_ON, workflows: false });
    assert.deepStrictEqual(r.appFiles, []);
    assert.ok(existsSync(join(target, "app/ios/fastlane/Fastfile")));
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("purge: removes unmodified wizard-created Flutter app files", () => {
  const target = installFlutter();
  try {
    const r = executePurge(PAYLOAD, target, {});
    assert.strictEqual(r.appFiles.length, 3);
    assert.ok(!existsSync(join(target, "app/ios/fastlane/Fastfile")));
    assert.ok(!existsSync(join(target, "app/ios/ExportOptions.plist")));
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("planRemoval: ignores baseline paths outside the repo", () => {
  const target = installFlutter();
  try {
    const bp = join(target, ".github/.wizard/baseline.json");
    const bl = JSON.parse(readFileSync(bp, "utf8"));
    bl.appFiles["../outside.txt"] = "sha256:x";
    writeFileSync(bp, JSON.stringify(bl));
    assert.ok(!planRemoval(PAYLOAD, target).appFiles.includes("../outside.txt"));
  } finally { rmSync(target, { recursive: true, force: true }); }
});
