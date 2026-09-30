// tests/node/flutter-full-install.test.js
// runFull integration — verifies Flutter app file creation and cleanup of deselected store workflows with the real payload.
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

// sub: Flutter project root (relative to the repo). "." means a single repo, "app" a monorepo.
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

test("fresh install: three Flutter app files are created and reported as created", () => {
  const target = flutterTarget();
  try {
    const r = install(target);
    assert.deepStrictEqual([...r.flutterApp.created].sort(), [...APP_FILES].sort());
    assert.deepStrictEqual(r.flutterApp.kept, []);
    for (const rel of APP_FILES) assert.ok(existsSync(join(target, rel)), rel);
    assert.deepStrictEqual(r.storeCleanup, { removed: [], backedUp: [] });
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("keeps existing files: existing app files are not overwritten and all are kept on rerun", () => {
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

test("monorepo: Flutter app files are created under paths.flutter", () => {
  const target = flutterTarget("app");
  try {
    const r = install(target, { paths: new Map([["flutter", "app"]]) });
    assert.deepStrictEqual([...r.flutterApp.created].sort(), APP_FILES.map((rel) => `app/${rel}`).sort());
    for (const rel of APP_FILES) assert.ok(existsSync(join(target, "app", rel)), rel);
    assert.ok(!existsSync(join(target, "android")) && !existsSync(join(target, "ios")), "must not be created at the repo root");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("non-Flutter project: no app files and no cleanup", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-flutter-full-react-"));
  try {
    writeFileSync(join(target, "package.json"), '{"name":"web","version":"1.0.0"}\n');
    const r = install(target, { types: ["react"], paths: new Map([["react", "."]]), flutterStore: [] });
    assert.deepStrictEqual(r.flutterApp, { created: [], kept: [] });
    assert.deepStrictEqual(r.storeCleanup, { removed: [], backedUp: [] });
    assert.ok(!existsSync(join(target, "android")) && !existsSync(join(target, "ios")));
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("when flutterStore is null, previously installed store workflows are not deleted (current behavior)", () => {
  const target = flutterTarget();
  try {
    install(target, { flutterStore: ["android", "ios"] });
    const r = install(target, { flutterStore: null });
    assert.deepStrictEqual(r.storeCleanup, { removed: [], backedUp: [] });
    for (const f of [PLAY, TESTFLIGHT, TESTFLIGHT_TEST]) assert.ok(workflows(target).includes(f), f);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("deselect: an untouched iOS workflow is deleted while Fastfile and ExportOptions are kept", () => {
  const target = flutterTarget();
  try {
    install(target, { flutterStore: ["android", "ios"] });
    const r = install(target, { flutterStore: ["android"] });

    assert.deepStrictEqual([...r.storeCleanup.removed].sort(), [TESTFLIGHT, TESTFLIGHT_TEST].sort());
    assert.deepStrictEqual(r.storeCleanup.backedUp, []);
    const files = workflows(target);
    assert.ok(files.includes(PLAY));
    assert.ok(!files.includes(TESTFLIGHT) && !files.includes(TESTFLIGHT_TEST));
    assert.ok(!files.some((f) => f.endsWith(".bak")), "an unmodified file is cleanly deleted without .bak");
    // User-owned files are not deleted
    assert.ok(existsSync(join(target, "ios/fastlane/Fastfile")));
    assert.ok(existsSync(join(target, "ios/ExportOptions.plist")));
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("deselect: a user-modified workflow is preserved as .bak instead of being deleted", () => {
  const target = flutterTarget();
  try {
    install(target, { flutterStore: ["android", "ios"] });
    const p = join(target, WF_DIR, TESTFLIGHT);
    writeFileSync(p, readFileSync(p, "utf8") + "\n# 내가 고친 부분\n");

    const r = install(target, { flutterStore: ["android"] });
    assert.deepStrictEqual(r.storeCleanup.backedUp, [TESTFLIGHT]);
    assert.deepStrictEqual(r.storeCleanup.removed, [TESTFLIGHT_TEST]);
    assert.match(readFileSync(`${p}.bak`, "utf8"), /내가 고친 부분/);
    assert.ok(!workflows(target).includes(TESTFLIGHT), "the trigger must be disabled");
    assert.strictEqual(r.gitignoreUpdated, true, "a .bak was created, so .gitignore must be updated");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("a deselected file is also dropped from the baseline so the next run does not mistake it for 'deleted by the user'", () => {
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

test("switching store targets to none([]) cleans up all store workflows and creates no new app files", () => {
  const target = flutterTarget();
  try {
    install(target, { flutterStore: ["android", "ios"] });
    const r = install(target, { flutterStore: [] });
    assert.deepStrictEqual([...r.storeCleanup.removed].sort(), [PLAY, TESTFLIGHT, TESTFLIGHT_TEST].sort());
    assert.deepStrictEqual(r.flutterApp.created, []);
    assert.deepStrictEqual(r.flutterApp.kept, [], "with none there is no target at all");
    assert.ok(existsSync(join(target, "android/fastlane/Fastfile.playstore")), "user files already created are kept");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("in a fresh install, choosing only flutterStore [ios] creates only iOS app files", () => {
  const target = flutterTarget();
  try {
    const r = install(target, { flutterStore: ["ios"] });
    assert.deepStrictEqual([...r.flutterApp.created].sort(), ["ios/ExportOptions.plist", "ios/fastlane/Fastfile"]);
    assert.ok(!existsSync(join(target, "android")));
    assert.ok(!workflows(target).includes(PLAY));
  } finally { rmSync(target, { recursive: true, force: true }); }
});
