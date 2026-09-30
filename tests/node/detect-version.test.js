// tests/node/detect-version.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectVersionFromFiles, detectBuildNumberFromFiles } from "../../src/core/detect.js";
import { detectVersion, detectBuildNumber } from "../../src/core/detect-fs.js";

test("detectVersionFromFiles: the package.json version is detected immediately regardless of jq", () => {
  const read = () => null;
  const readJson = (rel) => (rel === "package.json" ? { version: "1.0.0" } : null);
  const version = detectVersionFromFiles({ read, readJson, gitTag: "" });
  assert.strictEqual(version, "1.0.0");
});

test("detectVersionFromFiles: with no other manifest and no git tag, falls back to 0.0.1 and calls warn once", () => {
  const read = () => null;
  const readJson = () => null;
  const warned = [];
  const version = detectVersionFromFiles({ read, readJson, gitTag: "", warn: (m) => warned.push(m) });
  assert.strictEqual(version, "0.0.1");
  assert.strictEqual(warned.length, 1);
  assert.ok(warned[0].includes("0.0.1"));
});

test("detectVersionFromFiles: does not call warn when detected from build.gradle", () => {
  const read = (rel) => (rel === "build.gradle" ? 'version = "2.3.4"\n' : null);
  const readJson = () => null;
  const warned = [];
  const version = detectVersionFromFiles({ read, readJson, gitTag: "", warn: (m) => warned.push(m) });
  assert.strictEqual(version, "2.3.4");
  assert.strictEqual(warned.length, 0);
});

test("detectVersion: a package.json version is detected normally regardless of whether jq is installed", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-detect-version-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "1.0.0" }));
    const version = detectVersion(dir, { warn: () => {} });
    assert.strictEqual(version, "1.0.0");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("detectVersion: with no clues, falls back to 0.0.1 and the injected warn is called", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-detect-version-empty-"));
  try {
    const warned = [];
    const version = detectVersion(dir, { warn: (m) => warned.push(m) });
    assert.strictEqual(version, "0.0.1");
    assert.strictEqual(warned.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("detectBuildNumberFromFiles: flutter — detects +N in pubspec.yaml as the build number", () => {
  const read = (rel) => (rel === "pubspec.yaml" ? "name: x\nversion: 1.2.39+71\n" : null);
  const code = detectBuildNumberFromFiles({ types: ["flutter"], read, readJson: () => null, warn: () => {} });
  assert.strictEqual(code, 71);
});

test("detectBuildNumberFromFiles: flutter — returns null and calls warn when pubspec.yaml has no +N", () => {
  const read = (rel) => (rel === "pubspec.yaml" ? "name: x\nversion: 1.2.39\n" : null);
  const warned = [];
  const code = detectBuildNumberFromFiles({ types: ["flutter"], read, readJson: () => null, warn: (m) => warned.push(m) });
  assert.strictEqual(code, null);
  assert.strictEqual(warned.length, 1);
});

test("detectBuildNumberFromFiles: flutter — returns null and does not call warn when pubspec.yaml itself is missing", () => {
  const warned = [];
  const code = detectBuildNumberFromFiles({ types: ["flutter"], read: () => null, readJson: () => null, warn: (m) => warned.push(m) });
  assert.strictEqual(code, null);
  assert.strictEqual(warned.length, 0);
});

test("detectBuildNumberFromFiles: react-native — detects versionCode in android/app/build.gradle", () => {
  const read = (rel) => (rel === "android/app/build.gradle" ? "android {\n  defaultConfig {\n    versionCode 71\n  }\n}\n" : null);
  const code = detectBuildNumberFromFiles({ types: ["react-native"], read, readJson: () => null, warn: () => {} });
  assert.strictEqual(code, 71);
});

test("detectBuildNumberFromFiles: react-native — returns null and calls warn when build.gradle has no versionCode", () => {
  const read = (rel) => (rel === "android/app/build.gradle" ? "android {\n  defaultConfig {\n    versionName \"1.0.0\"\n  }\n}\n" : null);
  const warned = [];
  const code = detectBuildNumberFromFiles({ types: ["react-native"], read, readJson: () => null, warn: (m) => warned.push(m) });
  assert.strictEqual(code, null);
  assert.strictEqual(warned.length, 1);
});

test("detectBuildNumberFromFiles: react-native-expo — detects expo.android.versionCode in app.json", () => {
  const readJson = (rel) => (rel === "app.json" ? { expo: { android: { versionCode: 71 } } } : null);
  const code = detectBuildNumberFromFiles({ types: ["react-native-expo"], read: () => null, readJson, warn: () => {} });
  assert.strictEqual(code, 71);
});

test("detectBuildNumberFromFiles: react-native-expo — returns null and calls warn when there is no versionCode", () => {
  const readJson = (rel) => (rel === "app.json" ? { expo: { name: "x" } } : null);
  const warned = [];
  const code = detectBuildNumberFromFiles({ types: ["react-native-expo"], read: () => null, readJson, warn: (m) => warned.push(m) });
  assert.strictEqual(code, null);
  assert.strictEqual(warned.length, 1);
});

test("detectBuildNumberFromFiles: types without a build number concept (spring etc.) return null and pass silently without warn", () => {
  const warned = [];
  const code = detectBuildNumberFromFiles({ types: ["spring"], read: () => null, readJson: () => null, warn: (m) => warned.push(m) });
  assert.strictEqual(code, null);
  assert.strictEqual(warned.length, 0);
});

test("detectBuildNumberFromFiles: only the first matching type in the types array is used", () => {
  const read = (rel) => {
    if (rel === "pubspec.yaml") return "version: 1.0.0+5\n";
    if (rel === "android/app/build.gradle") return "versionCode 99\n";
    return null;
  };
  const code = detectBuildNumberFromFiles({ types: ["flutter", "react-native"], read, readJson: () => null, warn: () => {} });
  assert.strictEqual(code, 5);
});

test("detectBuildNumber: detects the build number of a flutter pubspec.yaml on a real filesystem", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-detect-buildnum-"));
  try {
    writeFileSync(join(dir, "pubspec.yaml"), "name: x\nversion: 1.2.39+71\n");
    const code = detectBuildNumber(dir, { types: ["flutter"] });
    assert.strictEqual(code, 71);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("detectBuildNumber: calls the injected warn when detection fails", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-detect-buildnum-warn-"));
  try {
    writeFileSync(join(dir, "pubspec.yaml"), "name: x\nversion: 1.2.39\n");
    const warned = [];
    const code = detectBuildNumber(dir, { types: ["flutter"], warn: (m) => warned.push(m) });
    assert.strictEqual(code, null);
    assert.strictEqual(warned.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
