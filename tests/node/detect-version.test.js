// tests/node/detect-version.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectVersionFromFiles, detectBuildNumberFromFiles } from "../../src/core/detect.js";
import { detectVersion, detectBuildNumber } from "../../src/core/detect-fs.js";

test("detectVersionFromFiles: package.json의 버전은 jq 여부와 무관하게 즉시 감지된다", () => {
  const read = () => null;
  const readJson = (rel) => (rel === "package.json" ? { version: "1.0.0" } : null);
  const version = detectVersionFromFiles({ read, readJson, gitTag: "" });
  assert.strictEqual(version, "1.0.0");
});

test("detectVersionFromFiles: 다른 매니페스트도 git tag도 없으면 0.0.1로 폴백하며 warn을 1회 호출한다", () => {
  const read = () => null;
  const readJson = () => null;
  const warned = [];
  const version = detectVersionFromFiles({ read, readJson, gitTag: "", warn: (m) => warned.push(m) });
  assert.strictEqual(version, "0.0.1");
  assert.strictEqual(warned.length, 1);
  assert.ok(warned[0].includes("0.0.1"));
});

test("detectVersionFromFiles: build.gradle에서 감지되면 warn을 호출하지 않는다", () => {
  const read = (rel) => (rel === "build.gradle" ? 'version = "2.3.4"\n' : null);
  const readJson = () => null;
  const warned = [];
  const version = detectVersionFromFiles({ read, readJson, gitTag: "", warn: (m) => warned.push(m) });
  assert.strictEqual(version, "2.3.4");
  assert.strictEqual(warned.length, 0);
});

test("detectVersion: package.json 버전이 있으면 jq 설치 여부와 무관하게 정상 감지된다", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-detect-version-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "1.0.0" }));
    const version = detectVersion(dir, { warn: () => {} });
    assert.strictEqual(version, "1.0.0");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("detectVersion: 아무 단서도 없으면 0.0.1로 폴백하며 주입한 warn이 호출된다", () => {
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

test("detectBuildNumberFromFiles: flutter — pubspec.yaml의 +N을 빌드 번호로 감지한다", () => {
  const read = (rel) => (rel === "pubspec.yaml" ? "name: x\nversion: 1.2.39+71\n" : null);
  const code = detectBuildNumberFromFiles({ types: ["flutter"], read, readJson: () => null, warn: () => {} });
  assert.strictEqual(code, 71);
});

test("detectBuildNumberFromFiles: flutter — pubspec.yaml에 +N이 없으면 null이고 warn이 호출된다", () => {
  const read = (rel) => (rel === "pubspec.yaml" ? "name: x\nversion: 1.2.39\n" : null);
  const warned = [];
  const code = detectBuildNumberFromFiles({ types: ["flutter"], read, readJson: () => null, warn: (m) => warned.push(m) });
  assert.strictEqual(code, null);
  assert.strictEqual(warned.length, 1);
});

test("detectBuildNumberFromFiles: flutter — pubspec.yaml 자체가 없으면 null이고 warn은 호출되지 않는다", () => {
  const warned = [];
  const code = detectBuildNumberFromFiles({ types: ["flutter"], read: () => null, readJson: () => null, warn: (m) => warned.push(m) });
  assert.strictEqual(code, null);
  assert.strictEqual(warned.length, 0);
});

test("detectBuildNumberFromFiles: react-native — android/app/build.gradle의 versionCode를 감지한다", () => {
  const read = (rel) => (rel === "android/app/build.gradle" ? "android {\n  defaultConfig {\n    versionCode 71\n  }\n}\n" : null);
  const code = detectBuildNumberFromFiles({ types: ["react-native"], read, readJson: () => null, warn: () => {} });
  assert.strictEqual(code, 71);
});

test("detectBuildNumberFromFiles: react-native — build.gradle에 versionCode가 없으면 null이고 warn이 호출된다", () => {
  const read = (rel) => (rel === "android/app/build.gradle" ? "android {\n  defaultConfig {\n    versionName \"1.0.0\"\n  }\n}\n" : null);
  const warned = [];
  const code = detectBuildNumberFromFiles({ types: ["react-native"], read, readJson: () => null, warn: (m) => warned.push(m) });
  assert.strictEqual(code, null);
  assert.strictEqual(warned.length, 1);
});

test("detectBuildNumberFromFiles: react-native-expo — app.json의 expo.android.versionCode를 감지한다", () => {
  const readJson = (rel) => (rel === "app.json" ? { expo: { android: { versionCode: 71 } } } : null);
  const code = detectBuildNumberFromFiles({ types: ["react-native-expo"], read: () => null, readJson, warn: () => {} });
  assert.strictEqual(code, 71);
});

test("detectBuildNumberFromFiles: react-native-expo — versionCode가 없으면 null이고 warn이 호출된다", () => {
  const readJson = (rel) => (rel === "app.json" ? { expo: { name: "x" } } : null);
  const warned = [];
  const code = detectBuildNumberFromFiles({ types: ["react-native-expo"], read: () => null, readJson, warn: (m) => warned.push(m) });
  assert.strictEqual(code, null);
  assert.strictEqual(warned.length, 1);
});

test("detectBuildNumberFromFiles: 빌드 번호 개념이 없는 타입(spring 등)은 null이고 warn 없이 조용히 넘어간다", () => {
  const warned = [];
  const code = detectBuildNumberFromFiles({ types: ["spring"], read: () => null, readJson: () => null, warn: (m) => warned.push(m) });
  assert.strictEqual(code, null);
  assert.strictEqual(warned.length, 0);
});

test("detectBuildNumberFromFiles: types 배열에서 먼저 매칭되는 첫 타입만 사용한다", () => {
  const read = (rel) => {
    if (rel === "pubspec.yaml") return "version: 1.0.0+5\n";
    if (rel === "android/app/build.gradle") return "versionCode 99\n";
    return null;
  };
  const code = detectBuildNumberFromFiles({ types: ["flutter", "react-native"], read, readJson: () => null, warn: () => {} });
  assert.strictEqual(code, 5);
});

test("detectBuildNumber: 실 파일시스템에서 flutter pubspec.yaml의 빌드 번호를 감지한다", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-detect-buildnum-"));
  try {
    writeFileSync(join(dir, "pubspec.yaml"), "name: x\nversion: 1.2.39+71\n");
    const code = detectBuildNumber(dir, { types: ["flutter"] });
    assert.strictEqual(code, 71);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("detectBuildNumber: 감지 실패 시 주입한 warn이 호출된다", () => {
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
