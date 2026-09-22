// tests/node/flutter-app-templates.test.js
// payload/flutter-app/ 아래 스토어 배포 템플릿(Fastfile·ExportOptions.plist)의 계약 검증 (이슈 #131).
//
// 이 파일들은 설치 후 사용자가 직접 편집한다. 그래서 Ruby 문법, 워크플로우가 넘기는 환경변수와의
// 정합성, 배포 모드 분기, 자리표시자 규약이 깨지면 사용자 레포에서 CI가 처음 돌 때서야 드러난다 —
// 여기서 미리 고정한다. Ruby·plutil이 없는 환경(Windows·Linux CI 등)에서는 해당 검사만 건너뛴다.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const APP_DIR = join(REPO_ROOT, "payload", "flutter-app");
const WORKFLOW_DIR = join(REPO_ROOT, "payload", "workflows", "flutter");

const readApp = (relativePath) => readFileSync(join(APP_DIR, relativePath), "utf8");
const readWorkflow = (name) => readFileSync(join(WORKFLOW_DIR, `PROJECT-FLUTTER-${name}.yaml`), "utf8");

const canRun = (command, args) => spawnSync(command, args, { encoding: "utf8" }).status === 0;
const HAS_RUBY = canRun("ruby", ["-v"]);
const HAS_PLUTIL = canRun("plutil", ["-help"]);
const SKIP_RUBY = HAS_RUBY ? false : "ruby가 없어 건너뜀";

// Fastfile이 읽는 환경변수 이름 집합: ENV["NAME"] 직접 참조와 require_env("NAME") 헬퍼 호출
const envNamesRead = (fastfileText) =>
  new Set([...fastfileText.matchAll(/(?:ENV\[|require_env\()"([A-Z][A-Z0-9_]*)"[\])]/g)].map((m) => m[1]));

// 워크플로우가 fastlane에 내보내는 환경변수 이름 집합: `export NAME=` 또는 YAML `NAME:` 키.
// (env: 블록으로 넘기든 export로 넘기든 같은 계약이므로 둘 다 인정한다)
const envNamesProvided = (workflowText) =>
  new Set([
    ...[...workflowText.matchAll(/export\s+([A-Z][A-Z0-9_]*)=/g)].map((m) => m[1]),
    ...[...workflowText.matchAll(/^\s*([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]),
  ]);

const missingFrom = (required, actualSet) => required.filter((name) => !actualSet.has(name));

// ---------------------------------------------------------------------------
// Android: android/fastlane/Fastfile.playstore (lane deploy_internal)
// ---------------------------------------------------------------------------
const ANDROID_FASTFILE = "android/fastlane/Fastfile.playstore";

// 공통 계약 §8 — 워크플로우가 내보내고 Fastfile이 읽는 환경변수
const ANDROID_ENV = ["AAB_PATH", "GOOGLE_PLAY_JSON_KEY", "VERSION_NAME", "VERSION_CODE", "DEPLOY_MODE", "PACKAGE_NAME"];

test("Fastfile.playstore는 Ruby 문법이 유효하다", { skip: SKIP_RUBY }, () => {
  const result = spawnSync("ruby", ["-c", join(APP_DIR, ANDROID_FASTFILE)], { encoding: "utf8" });
  assert.strictEqual(result.status, 0, `ruby -c 실패:\n${result.stderr}`);
});

test("Fastfile.playstore 상단에 사용자 소유 안내와 모드 매핑 표가 있다", () => {
  const text = readApp(ANDROID_FASTFILE);
  assert.match(text, /이 파일은 사용자 소유입니다\. 모드별 동작을 여기서 수정하세요/);
  for (const mode of ["store_only", "store_prepare", "store_submit"]) {
    assert.match(text.split("default_platform")[0], new RegExp(mode), `모드 표에 ${mode}가 없습니다`);
  }
});

test("Fastfile.playstore에 lane deploy_internal이 있다", () => {
  assert.match(readApp(ANDROID_FASTFILE), /^\s*lane :deploy_internal do$/m);
});

test("Fastfile.playstore가 읽는 환경변수는 공통 계약 §8과 정확히 같다", () => {
  const read = envNamesRead(readApp(ANDROID_FASTFILE));
  assert.deepStrictEqual([...read].sort(), [...ANDROID_ENV].sort());
});

test("Fastfile.playstore는 PACKAGE_NAME이 비면 한국어 안내와 함께 중단한다", () => {
  const text = readApp(ANDROID_FASTFILE);
  assert.match(
    text,
    /if package_name\.empty\?\s*\n\s*UI\.user_error!\("[^"\n]*ANDROID_PACKAGE_NAME secrets\/variables를 등록하세요/,
  );
});

test("Fastfile.playstore는 배포 모드 3종을 트랙·상태로 매핑하고 모르는 값은 store_only로 처리한다", () => {
  const text = readApp(ANDROID_FASTFILE);
  assert.match(text, /when "store_prepare"\s*\n\s*\["production", "draft"\]/);
  assert.match(text, /when "store_submit"\s*\n\s*\["production", "completed"\]/);
  assert.match(text, /when "store_only"\s*\n\s*\["internal", "completed"\]/);
  // else 분기(알 수 없는 값)도 store_only와 같은 internal 업로드
  assert.match(text, /else\s*\n\s*UI\.important\("알 수 없는 DEPLOY_MODE[^\n]*store_only[^\n]*\n\s*\["internal", "completed"\]/);
});

test("Fastfile.playstore의 upload_to_play_store 파라미터가 fastlane 공식 옵션 이름과 일치한다", () => {
  const text = readApp(ANDROID_FASTFILE);
  for (const param of [
    "package_name: package_name",
    "json_key: json_key",
    "aab: aab_path",
    "track: track",
    "release_status: release_status",
    "version_name: version_name",
    "metadata_path: metadata_path",
    "skip_upload_apk: true",
    "skip_upload_metadata: true",
    "skip_upload_images: true",
    "skip_upload_screenshots: true",
  ]) {
    assert.ok(text.includes(param), `upload_to_play_store에 ${param}가 없습니다`);
  }
  // 변경 이력은 워크플로우가 만든 changelogs/<VERSION_CODE>.txt를 올려야 하므로 건너뛰면 안 된다
  assert.doesNotMatch(text, /skip_upload_changelogs:\s*true/);
});

test("Fastfile.playstore의 metadata_path가 PLAYSTORE 워크플로우가 만드는 changelogs 경로의 상위와 일치한다", () => {
  const fastfile = readApp(ANDROID_FASTFILE);
  const workflow = readWorkflow("ANDROID-PLAYSTORE-CICD");
  // lane은 Fastfile이 있는 android/fastlane에서 실행되므로 metadata/android가 곧
  // android/fastlane/metadata/android 이다.
  assert.match(fastfile, /File\.expand_path\("metadata\/android"\)/);
  assert.match(fastfile, /File\.join\(metadata_path, "ko-KR", "changelogs", "#\{version_code\}\.txt"\)/);
  assert.ok(workflow.includes("android/fastlane/metadata/android/ko-KR/changelogs"), "워크플로우의 changelogs 경로가 바뀌었습니다");
  assert.ok(workflow.includes("cp android/fastlane/Fastfile.playstore android/fastlane/Fastfile"), "워크플로우가 Fastfile.playstore를 Fastfile로 복사하지 않습니다");
  assert.ok(workflow.includes("bundle exec fastlane deploy_internal"), "워크플로우가 deploy_internal lane을 호출하지 않습니다");
});

test("PLAYSTORE 워크플로우는 Fastfile이 읽는 환경변수를 내보낸다", () => {
  // PACKAGE_NAME은 워크플로우 쪽(D5)에서 이번 이슈로 추가하는 값이라 이 파일의 현재 상태로는
  // 검증하지 않는다 — 위의 계약 §8 상수(ANDROID_ENV)로만 고정한다.
  const provided = envNamesProvided(readWorkflow("ANDROID-PLAYSTORE-CICD"));
  const required = ANDROID_ENV.filter((name) => name !== "PACKAGE_NAME");
  assert.deepStrictEqual(missingFrom(required, provided), [], "워크플로우가 내보내지 않는 환경변수를 Fastfile이 읽습니다");
});
