// Flutter 옵션 (이슈 #131) — 스토어 배포 대상 선택·정리. deploy-style.test.js와 같은 구조의 검증.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ENV_MODES, DEFAULT_ENV_MODE, LEGACY_ENV_MODE, STORE_PLATFORMS, DEPLOY_MODES, DEFAULT_DEPLOY_MODE, NO_STORE,
  isEnvMode, isDeployMode, parseStoreList, formatStoreList,
  STORE_WORKFLOWS, isStoreWorkflow, storeWorkflowFilter, cleanupDeselectedStoreWorkflows,
  STORE_APP_FILES, storeAppFilesFor,
} from "../../src/core/flutter-options.js";
import { sha256 } from "../../src/core/baseline.js";

const PLAYSTORE = "PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml";
const IOS_TESTFLIGHT = "PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml";
const IOS_TEST_TESTFLIGHT = "PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml";
const CI = "PROJECT-FLUTTER-CI.yaml";
const SELFHOSTED = "PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD.yaml";

test("상수: 기본값과 기존 설치 보존값이 계약대로다", () => {
  assert.deepStrictEqual(ENV_MODES, ["dart-define", "dotenv"]);
  assert.strictEqual(DEFAULT_ENV_MODE, "dart-define");
  assert.strictEqual(LEGACY_ENV_MODE, "dotenv");
  assert.deepStrictEqual(STORE_PLATFORMS, ["android", "ios"]);
  assert.deepStrictEqual(DEPLOY_MODES, ["store_only", "store_prepare", "store_submit"]);
  assert.strictEqual(DEFAULT_DEPLOY_MODE, "store_only");
  assert.strictEqual(NO_STORE, "none");
});

test("isEnvMode / isDeployMode: 목록에 있는 값만 참이다", () => {
  assert.ok(isEnvMode("dart-define") && isEnvMode("dotenv"));
  assert.ok(!isEnvMode("both") && !isEnvMode("") && !isEnvMode(undefined));
  assert.ok(isDeployMode("store_only") && isDeployMode("store_prepare") && isDeployMode("store_submit"));
  assert.ok(!isDeployMode("publish") && !isDeployMode("") && !isDeployMode(null));
});

test("parseStoreList: 정상 입력은 STORE_PLATFORMS 순서의 배열로 정규화한다", () => {
  assert.deepStrictEqual(parseStoreList("android,ios"), ["android", "ios"]);
  assert.deepStrictEqual(parseStoreList("ios,android"), ["android", "ios"]);
  assert.deepStrictEqual(parseStoreList(" ios , ios "), ["ios"]);
  assert.deepStrictEqual(parseStoreList("android"), ["android"]);
});

test("parseStoreList: 'none'과 빈 문자열은 빈 배열이다", () => {
  assert.deepStrictEqual(parseStoreList("none"), []);
  assert.deepStrictEqual(parseStoreList(""), []);
});

test("parseStoreList: 잘못된 토큰·none 혼용·문자열이 아닌 값은 null이다", () => {
  assert.strictEqual(parseStoreList("windows"), null);
  assert.strictEqual(parseStoreList("android,windows"), null);
  assert.strictEqual(parseStoreList("android,none"), null);
  assert.strictEqual(parseStoreList(null), null);
  assert.strictEqual(parseStoreList(undefined), null);
});

test("formatStoreList: 직렬화하고 빈 배열은 'none'이며 parseStoreList와 왕복한다", () => {
  assert.strictEqual(formatStoreList(["android", "ios"]), "android,ios");
  assert.strictEqual(formatStoreList(["ios", "android"]), "android,ios");
  assert.strictEqual(formatStoreList(["ios"]), "ios");
  assert.strictEqual(formatStoreList([]), "none");
  for (const stores of [[], ["android"], ["ios"], ["android", "ios"]]) {
    assert.deepStrictEqual(parseStoreList(formatStoreList(stores)), stores);
  }
});

test("STORE_WORKFLOWS / isStoreWorkflow: 스토어 묶음 파일만 참이다", () => {
  assert.deepStrictEqual(STORE_WORKFLOWS.android, [PLAYSTORE]);
  assert.deepStrictEqual(STORE_WORKFLOWS.ios, [IOS_TESTFLIGHT, IOS_TEST_TESTFLIGHT]);
  assert.ok(isStoreWorkflow(PLAYSTORE) && isStoreWorkflow(IOS_TESTFLIGHT) && isStoreWorkflow(IOS_TEST_TESTFLIGHT));
  assert.ok(!isStoreWorkflow(CI) && !isStoreWorkflow(SELFHOSTED));
  assert.ok(!isStoreWorkflow("PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml"));
  assert.ok(!isStoreWorkflow("PROJECT-COMMON-RELEASE-PUBLISH.yaml"));
});

test("storeWorkflowFilter(null): 미결정이면 전부 통과한다 (현행 동작)", () => {
  const keep = storeWorkflowFilter(null);
  assert.ok(keep(PLAYSTORE) && keep(IOS_TESTFLIGHT) && keep(IOS_TEST_TESTFLIGHT) && keep(CI));
});

test("storeWorkflowFilter(['android']): Android 묶음만 통과, 스토어가 아닌 파일은 항상 통과", () => {
  const keep = storeWorkflowFilter(["android"]);
  assert.ok(keep(PLAYSTORE));
  assert.ok(!keep(IOS_TESTFLIGHT) && !keep(IOS_TEST_TESTFLIGHT));
  assert.ok(keep(CI) && keep(SELFHOSTED) && keep("PROJECT-COMMON-RELEASE-PUBLISH.yaml"));
});

test("storeWorkflowFilter(['ios']): iOS 묶음 두 개만 통과", () => {
  const keep = storeWorkflowFilter(["ios"]);
  assert.ok(keep(IOS_TESTFLIGHT) && keep(IOS_TEST_TESTFLIGHT));
  assert.ok(!keep(PLAYSTORE));
  assert.ok(keep(CI));
});

test("storeWorkflowFilter([]): 스토어 워크플로우를 전부 거르고 나머지는 통과", () => {
  const keep = storeWorkflowFilter([]);
  assert.ok(!keep(PLAYSTORE) && !keep(IOS_TESTFLIGHT) && !keep(IOS_TEST_TESTFLIGHT));
  assert.ok(keep(CI) && keep(SELFHOSTED));
});

test("STORE_APP_FILES / storeAppFilesFor: 선택된 플랫폼의 파일만, null이면 전부", () => {
  assert.deepStrictEqual(STORE_APP_FILES.android, ["android/fastlane/Fastfile.playstore"]);
  assert.deepStrictEqual(STORE_APP_FILES.ios, ["ios/fastlane/Fastfile", "ios/ExportOptions.plist"]);
  assert.deepStrictEqual(storeAppFilesFor(null), [
    "android/fastlane/Fastfile.playstore", "ios/fastlane/Fastfile", "ios/ExportOptions.plist",
  ]);
  assert.deepStrictEqual(storeAppFilesFor(["ios", "android"]), [
    "android/fastlane/Fastfile.playstore", "ios/fastlane/Fastfile", "ios/ExportOptions.plist",
  ]);
  assert.deepStrictEqual(storeAppFilesFor(["android"]), ["android/fastlane/Fastfile.playstore"]);
  assert.deepStrictEqual(storeAppFilesFor(["ios"]), ["ios/fastlane/Fastfile", "ios/ExportOptions.plist"]);
  assert.deepStrictEqual(storeAppFilesFor([]), []);
});

function withWorkflowsDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "paw-store-cleanup-"));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("cleanupDeselectedStoreWorkflows: 선택 해제된 스토어 워크플로우 — 미수정은 삭제, 수정본은 .bak", () => {
  withWorkflowsDir((dir) => {
    const pristine = "name: testflight\n";
    writeFileSync(join(dir, IOS_TESTFLIGHT), pristine);
    writeFileSync(join(dir, IOS_TEST_TESTFLIGHT), "name: edited by user\n");
    writeFileSync(join(dir, PLAYSTORE), "name: playstore\n");
    writeFileSync(join(dir, CI), "name: ci\n");
    const baseline = { files: {
      [IOS_TESTFLIGHT]: { installed: sha256(pristine) },
      [IOS_TEST_TESTFLIGHT]: { installed: sha256("name: original\n") },
    } };

    const result = cleanupDeselectedStoreWorkflows(
      dir, [IOS_TESTFLIGHT, IOS_TEST_TESTFLIGHT, PLAYSTORE, CI], ["android"], baseline);

    assert.deepStrictEqual(result.removed, [IOS_TESTFLIGHT]);
    assert.deepStrictEqual(result.backedUp, [IOS_TEST_TESTFLIGHT]);
    assert.deepStrictEqual(readdirSync(dir).sort(), [CI, PLAYSTORE, `${IOS_TEST_TESTFLIGHT}.bak`].sort());
  });
});

test("cleanupDeselectedStoreWorkflows: baseline이 없으면 미수정 여부를 알 수 없으므로 전부 .bak으로 보존한다", () => {
  withWorkflowsDir((dir) => {
    writeFileSync(join(dir, PLAYSTORE), "name: playstore\n");
    const result = cleanupDeselectedStoreWorkflows(dir, [PLAYSTORE], ["ios"], null);
    assert.deepStrictEqual(result, { removed: [], backedUp: [PLAYSTORE] });
    assert.deepStrictEqual(readdirSync(dir), [`${PLAYSTORE}.bak`]);
  });
});

test("cleanupDeselectedStoreWorkflows: stores가 null이면 아무것도 정리하지 않는다", () => {
  withWorkflowsDir((dir) => {
    writeFileSync(join(dir, PLAYSTORE), "name: playstore\n");
    writeFileSync(join(dir, IOS_TESTFLIGHT), "name: testflight\n");
    const result = cleanupDeselectedStoreWorkflows(dir, [PLAYSTORE, IOS_TESTFLIGHT], null, { files: {} });
    assert.deepStrictEqual(result, { removed: [], backedUp: [] });
    assert.deepStrictEqual(readdirSync(dir).sort(), [IOS_TESTFLIGHT, PLAYSTORE].sort());
  });
});

test("cleanupDeselectedStoreWorkflows: 'none'([])이면 스토어 워크플로우 전체를 정리하고 CI는 남긴다", () => {
  withWorkflowsDir((dir) => {
    const contents = { [PLAYSTORE]: "a\n", [IOS_TESTFLIGHT]: "b\n", [IOS_TEST_TESTFLIGHT]: "c\n", [CI]: "d\n" };
    for (const [name, body] of Object.entries(contents)) writeFileSync(join(dir, name), body);
    const baseline = { files: Object.fromEntries(Object.entries(contents).map(([n, b]) => [n, { installed: sha256(b) }])) };
    const result = cleanupDeselectedStoreWorkflows(dir, Object.keys(contents), [], baseline);
    assert.deepStrictEqual(result.removed, [PLAYSTORE, IOS_TESTFLIGHT, IOS_TEST_TESTFLIGHT]);
    assert.deepStrictEqual(result.backedUp, []);
    assert.deepStrictEqual(readdirSync(dir), [CI]);
  });
});

test("cleanupDeselectedStoreWorkflows: 디스크에 없는 파일은 건너뛴다", () => {
  withWorkflowsDir((dir) => {
    const result = cleanupDeselectedStoreWorkflows(dir, [PLAYSTORE], ["ios"], { files: {} });
    assert.deepStrictEqual(result, { removed: [], backedUp: [] });
  });
});
