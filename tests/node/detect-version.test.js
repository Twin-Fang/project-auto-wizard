// tests/node/detect-version.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectVersionFromFiles } from "../../src/core/detect.js";
import { detectVersion } from "../../src/core/detect-fs.js";

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
