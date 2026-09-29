// tests/node/uninstall-flutter-app.test.js
// 완전 삭제·purge는 마법사가 만든 Flutter 앱 파일(Fastfile·ExportOptions.plist) 중
// 사용자가 손대지 않은 것만 지운다. 원래 있던 파일과 값을 채운 파일은 남긴다.
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

// app/ 아래 Flutter 앱이 있는 모노레포에 설치한다
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

test("uninstall: 마법사가 만든 미수정 Flutter 앱 파일과 빈 폴더를 지운다", () => {
  const target = installFlutter();
  try {
    assert.ok(existsSync(join(target, "app/ios/fastlane/Fastfile")));
    const r = runUninstall({}, PAYLOAD, target, ALL_ON);
    assert.deepStrictEqual([...r.appFiles].sort(), [
      "app/android/fastlane/Fastfile.playstore", "app/ios/ExportOptions.plist", "app/ios/fastlane/Fastfile",
    ]);
    for (const rel of r.appFiles) assert.ok(!existsSync(join(target, rel)), `${rel} 남음`);
    // 마법사가 만든 폴더(app/ios, app/android)도 비었으면 사라진다. Flutter 루트는 남는다.
    assert.ok(!existsSync(join(target, "app/ios")));
    assert.ok(!existsSync(join(target, "app/android")));
    assert.ok(existsSync(join(target, "app/pubspec.yaml")));
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("uninstall: 값을 채운 파일과 원래 있던 파일은 남긴다", () => {
  const target = installFlutter((t) => {
    mkdirSync(join(t, "app/android/fastlane"), { recursive: true });
    writeFileSync(join(t, "app/android/fastlane/Fastfile.playstore"), "# my own fastfile\n");
  });
  try {
    const plist = join(target, "app/ios/ExportOptions.plist");
    writeFileSync(plist, readFileSync(plist, "utf8").replace("__TEAM_ID__", "ABCDE12345"));
    const r = runUninstall({}, PAYLOAD, target, ALL_ON);
    assert.deepStrictEqual(r.appFiles, ["app/ios/fastlane/Fastfile"]);
    assert.ok(existsSync(plist), "값을 채운 ExportOptions.plist는 남아야 한다");
    assert.strictEqual(readFileSync(join(target, "app/android/fastlane/Fastfile.playstore"), "utf8"), "# my own fastfile\n");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("uninstall: 줄바꿈만 CRLF로 바뀐 파일은 미수정으로 본다", () => {
  const target = installFlutter();
  try {
    const p = join(target, "app/ios/fastlane/Fastfile");
    writeFileSync(p, readFileSync(p, "utf8").replace(/\r?\n/g, "\r\n"));
    assert.ok(planRemoval(PAYLOAD, target).appFiles.includes("app/ios/fastlane/Fastfile"));
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("uninstall: 워크플로우 항목을 고르지 않으면 Flutter 앱 파일도 남긴다", () => {
  const target = installFlutter();
  try {
    const r = runUninstall({}, PAYLOAD, target, { ...ALL_ON, workflows: false });
    assert.deepStrictEqual(r.appFiles, []);
    assert.ok(existsSync(join(target, "app/ios/fastlane/Fastfile")));
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("purge: 마법사가 만든 미수정 Flutter 앱 파일을 지운다", () => {
  const target = installFlutter();
  try {
    const r = executePurge(PAYLOAD, target, {});
    assert.strictEqual(r.appFiles.length, 3);
    assert.ok(!existsSync(join(target, "app/ios/fastlane/Fastfile")));
    assert.ok(!existsSync(join(target, "app/ios/ExportOptions.plist")));
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("planRemoval: baseline의 레포 밖 경로는 무시한다", () => {
  const target = installFlutter();
  try {
    const bp = join(target, ".github/.wizard/baseline.json");
    const bl = JSON.parse(readFileSync(bp, "utf8"));
    bl.appFiles["../outside.txt"] = "sha256:x";
    writeFileSync(bp, JSON.stringify(bl));
    assert.ok(!planRemoval(PAYLOAD, target).appFiles.includes("../outside.txt"));
  } finally { rmSync(target, { recursive: true, force: true }); }
});
