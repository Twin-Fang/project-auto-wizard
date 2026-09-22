// tests/node/installed-stores.test.js
// 이슈 #131 — flutter_store 저장값이 없는 기존 설치는 설치된 스토어 워크플로우로 플랫폼을 추론한다.
// (선택 해제로 오인해 잘 쓰던 스토어 워크플로우가 정리되는 사고를 막는다.)
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inferInstalledStores } from "../../src/core/installed-stores.js";

function workflowsDirWith(files) {
  const root = mkdtempSync(join(tmpdir(), "paw-installed-stores-"));
  const dir = join(root, ".github", "workflows");
  mkdirSync(dir, { recursive: true });
  for (const f of files) writeFileSync(join(dir, f), "");
  return { root, dir };
}

test("inferInstalledStores: 스토어 워크플로우 파일명으로 설치된 플랫폼을 추론한다", () => {
  const { root, dir } = workflowsDirWith(["PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml"]);
  try {
    assert.deepStrictEqual(inferInstalledStores(dir), ["ios"]);
    writeFileSync(join(dir, "PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml"), "");
    assert.deepStrictEqual(inferInstalledStores(dir), ["android", "ios"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("inferInstalledStores: 스토어와 무관한 Flutter 워크플로우만 있으면 빈 배열", () => {
  const { root, dir } = workflowsDirWith([
    "PROJECT-FLUTTER-CI.yaml", "PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml", "PROJECT-COMMON-VERSION-CONTROL.yaml",
  ]);
  try {
    assert.deepStrictEqual(inferInstalledStores(dir), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("inferInstalledStores: 워크플로우 폴더가 없으면 빈 배열", () => {
  const root = mkdtempSync(join(tmpdir(), "paw-installed-stores-empty-"));
  try {
    assert.deepStrictEqual(inferInstalledStores(join(root, ".github", "workflows")), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
