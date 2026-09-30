// tests/node/flutter-app-copy.test.js
// Copying Flutter app files (fastlane, ExportOptions) — created only when absent, never overwritten.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { copyFlutterAppFiles, planFlutterAppFiles } from "../../src/core/copy/flutter-app.js";

const ANDROID_FASTFILE = "android/fastlane/Fastfile.playstore";
const IOS_FASTFILE = "ios/fastlane/Fastfile";
const IOS_EXPORT = "ios/ExportOptions.plist";
const ALL = [ANDROID_FASTFILE, IOS_FASTFILE, IOS_EXPORT];

// Build the source tree inside the test so it does not depend on the real payload. The iOS Fastfile uses CRLF.
function makePayload() {
  const root = mkdtempSync(join(tmpdir(), "paw-fa-payload-"));
  const contents = {
    [ANDROID_FASTFILE]: "# android fastfile\nlane :deploy_internal do\nend\n",
    [IOS_FASTFILE]: "# ios fastfile\r\nlane :deploy do\r\nend\r\n",
    [IOS_EXPORT]: "<plist>__TEAM_ID__</plist>\n",
  };
  for (const [rel, body] of Object.entries(contents)) {
    const p = join(root, "flutter-app", rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return { root, contents };
}

const freshTarget = () => mkdtempSync(join(tmpdir(), "paw-fa-target-"));
const ctx = (overrides = {}) => ({ types: ["flutter"], paths: new Map(), flutterStore: null, ...overrides });

test("fresh install: creates 3 files and the directories automatically", () => {
  const { root, contents } = makePayload();
  const target = freshTarget();
  try {
    const r = copyFlutterAppFiles(ctx(), root, target);
    assert.deepStrictEqual([...r.created].sort(), [...ALL].sort());
    assert.deepStrictEqual(r.kept, []);
    for (const rel of ALL) assert.strictEqual(readFileSync(join(target, rel), "utf8"), contents[rel]);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(target, { recursive: true, force: true }); }
});

test("existing files are not overwritten and are reported as kept", () => {
  const { root } = makePayload();
  const target = freshTarget();
  try {
    mkdirSync(join(target, "ios"), { recursive: true });
    writeFileSync(join(target, IOS_EXPORT), "내가 채운 값\n");

    const r = copyFlutterAppFiles(ctx(), root, target);
    assert.deepStrictEqual(r.kept, [IOS_EXPORT]);
    assert.deepStrictEqual([...r.created].sort(), [ANDROID_FASTFILE, IOS_FASTFILE].sort());
    assert.strictEqual(readFileSync(join(target, IOS_EXPORT), "utf8"), "내가 채운 값\n");

    const again = copyFlutterAppFiles(ctx(), root, target);
    assert.deepStrictEqual(again.created, []);
    assert.deepStrictEqual([...again.kept].sort(), [...ALL].sort());
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(target, { recursive: true, force: true }); }
});

test("monorepo: creates under paths.flutter and the returned paths carry that prefix", () => {
  const { root } = makePayload();
  const target = freshTarget();
  try {
    const r = copyFlutterAppFiles(ctx({ paths: new Map([["flutter", "app"]]) }), root, target);
    assert.deepStrictEqual([...r.created].sort(), ALL.map((rel) => `app/${rel}`).sort());
    assert.ok(existsSync(join(target, "app", ANDROID_FASTFILE)));
    assert.ok(!existsSync(join(target, "android")), "not created at the repo root");
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(target, { recursive: true, force: true }); }
});

test("selected platforms only: android / ios / none (empty array)", () => {
  const { root } = makePayload();
  try {
    const cases = [
      [["android"], [ANDROID_FASTFILE]],
      [["ios"], [IOS_FASTFILE, IOS_EXPORT]],
      [[], []],
    ];
    for (const [stores, expected] of cases) {
      const target = freshTarget();
      try {
        const r = copyFlutterAppFiles(ctx({ flutterStore: stores }), root, target);
        assert.deepStrictEqual([...r.created].sort(), [...expected].sort(), `stores=${JSON.stringify(stores)}`);
        for (const rel of ALL) assert.strictEqual(existsSync(join(target, rel)), expected.includes(rel), rel);
      } finally { rmSync(target, { recursive: true, force: true }); }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("creates nothing without a Flutter type", () => {
  const { root } = makePayload();
  const target = freshTarget();
  try {
    const r = copyFlutterAppFiles(ctx({ types: ["react"] }), root, target);
    assert.deepStrictEqual(r, { created: [], kept: [] });
    assert.ok(!existsSync(join(target, "android")) && !existsSync(join(target, "ios")));
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(target, { recursive: true, force: true }); }
});

test("a CRLF source is copied byte for byte", () => {
  const { root, contents } = makePayload();
  const target = freshTarget();
  try {
    copyFlutterAppFiles(ctx(), root, target);
    const copied = readFileSync(join(target, IOS_FASTFILE));
    assert.ok(copied.equals(Buffer.from(contents[IOS_FASTFILE], "utf8")));
    assert.ok(copied.includes(Buffer.from("\r\n")));
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(target, { recursive: true, force: true }); }
});

test("planFlutterAppFiles: computes the same result as copying but writes no files", () => {
  const { root } = makePayload();
  const target = freshTarget();
  try {
    mkdirSync(join(target, "android/fastlane"), { recursive: true });
    writeFileSync(join(target, ANDROID_FASTFILE), "기존\n");

    const planned = planFlutterAppFiles(ctx(), root, target);
    assert.deepStrictEqual(planned.kept, [ANDROID_FASTFILE]);
    assert.deepStrictEqual([...planned.created].sort(), [IOS_FASTFILE, IOS_EXPORT].sort());
    assert.ok(!existsSync(join(target, "ios")), "plan is read-only");

    const copied = copyFlutterAppFiles(ctx(), root, target);
    assert.deepStrictEqual({ created: [...copied.created].sort(), kept: copied.kept },
      { created: [...planned.created].sort(), kept: planned.kept });
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(target, { recursive: true, force: true }); }
});

test("planFlutterAppFiles: does not read the source payload, so it computes even without a payload", () => {
  const target = freshTarget();
  try {
    const planned = planFlutterAppFiles(ctx(), join(target, "no-such-payload"), target);
    assert.strictEqual(planned.created.length, 3);
  } finally { rmSync(target, { recursive: true, force: true }); }
});
