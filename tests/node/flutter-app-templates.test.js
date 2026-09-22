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

// ---------------------------------------------------------------------------
// iOS: ios/fastlane/Fastfile (lane deploy, upload_testflight)
// ---------------------------------------------------------------------------
const IOS_FASTFILE = "ios/fastlane/Fastfile";
const EXPORT_OPTIONS = "ios/ExportOptions.plist";

// 공통 계약 §8 — deploy lane이 받는 환경변수 (upload_testflight lane은 이 중 일부)
const IOS_DEPLOY_ENV = [
  "APP_STORE_CONNECT_API_KEY_ID",
  "APP_STORE_CONNECT_ISSUER_ID",
  "API_KEY_PATH",
  "IPA_PATH",
  "RELEASE_NOTES",
  "APP_IDENTIFIER",
  "DEPLOY_MODE",
  "APP_VERSION",
  "BUILD_NUMBER",
  "SKIP_WAITING_FOR_BUILD_PROCESSING",
];
// APP_IDENTIFIER는 upload_testflight 쪽 워크플로우가 내보내지 않으므로 여기서 뺀다
// (있으면 사용, 없으면 fastlane이 추론).
const IOS_UPLOAD_ENV = ["API_KEY_PATH", "IPA_PATH", "RELEASE_NOTES", "APP_STORE_CONNECT_API_KEY_ID", "APP_STORE_CONNECT_ISSUER_ID"];

// `lane :<name> do` 부터 들여쓰기 2칸의 `end`까지
const laneBody = (fastfileText, laneName) => {
  const match = fastfileText.match(new RegExp(`^  lane :${laneName} do\\n([\\s\\S]*?)^  end$`, "m"));
  assert.ok(match, `lane :${laneName}을 찾을 수 없습니다`);
  return match[1];
};

test("ios Fastfile은 Ruby 문법이 유효하다", { skip: SKIP_RUBY }, () => {
  const result = spawnSync("ruby", ["-c", join(APP_DIR, IOS_FASTFILE)], { encoding: "utf8" });
  assert.strictEqual(result.status, 0, `ruby -c 실패:\n${result.stderr}`);
});

test("ios Fastfile 상단에 사용자 소유 안내와 모드 매핑 표가 있다", () => {
  const header = readApp(IOS_FASTFILE).split("default_platform")[0];
  assert.match(header, /이 파일은 사용자 소유입니다\. 모드별 동작을 여기서 수정하세요/);
  for (const mode of ["store_only", "store_prepare", "store_submit"]) {
    assert.match(header, new RegExp(mode), `모드 표에 ${mode}가 없습니다`);
  }
});

test("ios Fastfile에 lane deploy와 upload_testflight가 있다", () => {
  const text = readApp(IOS_FASTFILE);
  assert.match(text, /^  lane :deploy do$/m);
  assert.match(text, /^  lane :upload_testflight do$/m);
});

test("ios Fastfile이 읽는 환경변수는 공통 계약 §8과 정확히 같다", () => {
  const read = envNamesRead(readApp(IOS_FASTFILE));
  assert.deepStrictEqual([...read].sort(), [...IOS_DEPLOY_ENV].sort());
});

test("upload_testflight lane은 IPA 업로드만 하고 배포 모드·App Store 단계를 쓰지 않는다", () => {
  const body = laneBody(readApp(IOS_FASTFILE), "upload_testflight");
  assert.match(body, /upload_ipa_to_testflight\(/);
  for (const forbidden of ["DEPLOY_MODE", "APP_VERSION", "BUILD_NUMBER", "upload_to_app_store", "submit_for_review"]) {
    assert.ok(!body.includes(forbidden), `upload_testflight lane에 ${forbidden}가 있습니다`);
  }
});

test("ios Fastfile은 App Store Connect API 키로 인증한다", () => {
  const text = readApp(IOS_FASTFILE);
  assert.match(
    text,
    /app_store_connect_api_key\(\s*\n\s*key_id: require_env\("APP_STORE_CONNECT_API_KEY_ID"\),\s*\n\s*issuer_id: require_env\("APP_STORE_CONNECT_ISSUER_ID"\),\s*\n\s*key_filepath: require_env\("API_KEY_PATH"\)/,
  );
  assert.match(text, /api_key: api_key/);
});

test("ios Fastfile은 필수 환경변수가 비면 한국어 안내와 함께 중단한다", () => {
  assert.match(
    readApp(IOS_FASTFILE),
    /UI\.user_error!\("#\{name\} 환경변수가 비어 있습니다\. 워크플로우에서 값을 전달하는지 확인하세요\."\)/,
  );
});

test("upload_testflight 경로는 APP_IDENTIFIER가 있을 때만 넘기고, deploy의 store_prepare/store_submit은 필수로 요구한다", () => {
  const text = readApp(IOS_FASTFILE);
  // pilot(TestFlight 업로드) 쪽은 옵션 — IOS-TEST-TESTFLIGHT 워크플로우가 APP_IDENTIFIER를 안 보내도 된다.
  assert.match(text, /app_identifier\.empty\? \? \{\} : \{ app_identifier: app_identifier \}/);
  const upload_testflight_helper = text.split("def app_identifier_option")[1].split("def upload_ipa_to_testflight")[0];
  assert.doesNotMatch(upload_testflight_helper, /require_env\("APP_IDENTIFIER"\)/);
  // deliver(App Store 버전 연결)는 APP_IDENTIFIER가 비면 UI.input으로 멈추므로(대화형 입력 대기),
  // store_prepare/store_submit 분기는 require_env로 필수화해 CI에서 명확한 오류로 중단시킨다.
  const deployBody = laneBody(text, "deploy");
  const prepareSubmitBranch = deployBody.split('when "store_only"')[0];
  assert.match(prepareSubmitBranch, /app_identifier: require_env\("APP_IDENTIFIER"\)/);
});

test("ios Fastfile의 upload_to_testflight 파라미터가 fastlane 공식 옵션 이름과 일치한다", () => {
  const text = readApp(IOS_FASTFILE);
  for (const param of [
    "api_key: api_key",
    'ipa: require_env("IPA_PATH")',
    "skip_waiting_for_build_processing: skip_waiting_for_build_processing",
    "options[:changelog] = release_notes",
    "upload_to_testflight(**options, **app_identifier_option)",
  ]) {
    assert.ok(text.includes(param), `upload_to_testflight에 ${param}가 없습니다`);
  }
});

test("ios Fastfile은 배포 모드 3종을 분기하고 store_prepare는 심사 제출을 하지 않는다", () => {
  const body = laneBody(readApp(IOS_FASTFILE), "deploy");
  assert.match(body, /when "store_prepare", "store_submit"/);
  assert.match(body, /when "store_only"/);
  // 모르는 값과 빈 값은 store_only와 같은 TestFlight 업로드로 처리
  assert.match(body, /else\n\s*UI\.important\("알 수 없는 DEPLOY_MODE[^\n]*store_only[^\n]*\n\s*upload_ipa_to_testflight\(/);
  // 심사 제출 여부는 store_submit일 때만 true — store_prepare는 false
  assert.match(body, /submit_for_review: deploy_mode == "store_submit"/);
  // 업로드는 TestFlight(pilot)가 하고, deliver는 이미 올라간 빌드를 App Store 버전에 연결만 한다
  for (const param of [
    "skip_binary_upload: true",
    "skip_screenshots: true",
    'app_version: require_env("APP_VERSION")',
    'build_number: require_env("BUILD_NUMBER")',
    "automatic_release: false",
    "force: true",
    "precheck_include_in_app_purchases: false",
  ]) {
    assert.ok(body.includes(param), `upload_to_app_store에 ${param}가 없습니다`);
  }
  assert.match(body, /skip_metadata: Dir\.glob\("metadata\/\*"\)\.empty\?/);
});

test("upload_to_app_store는 precheck_include_in_app_purchases:false로 인앱 결제 사전 검사 크래시를 피한다", () => {
  // deliver의 precheck는 App Store Connect API 키 인증에서 인앱 결제 항목을 확인할 수 없어
  // 기본값(true)으로 두면 UI.user_error!로 중단된다 (fastlane deliver/runner.rb precheck_app).
  const body = laneBody(readApp(IOS_FASTFILE), "deploy");
  assert.match(body, /precheck_include_in_app_purchases: false/);
});

test("store_prepare/store_submit은 빌드 처리 완료를 기다린다(SKIP_WAITING 무시)", () => {
  const body = laneBody(readApp(IOS_FASTFILE), "deploy");
  const prepareBranch = body.split('when "store_only"')[0];
  assert.match(prepareBranch, /upload_ipa_to_testflight\(api_key, false\)/);
  assert.ok(!prepareBranch.includes("SKIP_WAITING_FOR_BUILD_PROCESSING"));
});

test("IOS-TESTFLIGHT 워크플로우는 deploy lane이 읽는 환경변수를 모두 내보낸다", () => {
  const workflow = readWorkflow("IOS-TESTFLIGHT");
  assert.deepStrictEqual(missingFrom(IOS_DEPLOY_ENV, envNamesProvided(workflow)), []);
  assert.ok(workflow.includes("bundle exec fastlane deploy"), "워크플로우가 deploy lane을 호출하지 않습니다");
});

test("IOS-TEST-TESTFLIGHT 워크플로우는 upload_testflight lane이 읽는 환경변수를 내보낸다", () => {
  const workflow = readWorkflow("IOS-TEST-TESTFLIGHT");
  assert.deepStrictEqual(missingFrom(IOS_UPLOAD_ENV, envNamesProvided(workflow)), []);
  assert.ok(workflow.includes("bundle exec fastlane upload_testflight"), "워크플로우가 upload_testflight lane을 호출하지 않습니다");
});

// ---------------------------------------------------------------------------
// iOS: ios/ExportOptions.plist
// ---------------------------------------------------------------------------
const PLACEHOLDER_PATTERN = /__[A-Z][A-Z0-9_]*__/g; // 공통 계약 §8의 미치환 감지 정규식(전역 플래그만 추가)
const PLIST_PLACEHOLDERS = ["__TEAM_ID__", "__BUNDLE_ID__", "__PROVISIONING_PROFILE_NAME__"];

const plutilExtract = (keyPath) => {
  const result = spawnSync("plutil", ["-extract", keyPath, "raw", "-o", "-", join(APP_DIR, EXPORT_OPTIONS)], { encoding: "utf8" });
  assert.strictEqual(result.status, 0, `plutil -extract ${keyPath} 실패:\n${result.stderr}`);
  return result.stdout.trim();
};

test("ExportOptions.plist에는 계약 §8의 플레이스홀더 3개만 있고 감지 정규식에 걸린다", () => {
  const found = [...new Set(readApp(EXPORT_OPTIONS).match(PLACEHOLDER_PATTERN) ?? [])].sort();
  assert.deepStrictEqual(found, [...PLIST_PLACEHOLDERS].sort());
});

test("ExportOptions.plist는 값을 채우면 플레이스홀더가 하나도 남지 않는다(주석에 남기지 않는다)", () => {
  let filled = readApp(EXPORT_OPTIONS);
  for (const placeholder of PLIST_PLACEHOLDERS) filled = filled.replaceAll(placeholder, "filled-value");
  assert.doesNotMatch(filled, /__[A-Z][A-Z0-9_]*__/);
});

test("ExportOptions.plist는 App Store 배포·수동 서명·프로파일 매핑을 지정한다", () => {
  const text = readApp(EXPORT_OPTIONS);
  assert.match(text, /<key>method<\/key>\s*<string>app-store-connect<\/string>/);
  assert.match(text, /<key>teamID<\/key>\s*<string>__TEAM_ID__<\/string>/);
  assert.match(text, /<key>signingStyle<\/key>\s*<string>manual<\/string>/);
  assert.match(
    text,
    /<key>provisioningProfiles<\/key>\s*<dict>\s*<key>__BUNDLE_ID__<\/key>\s*<string>__PROVISIONING_PROFILE_NAME__<\/string>\s*<\/dict>/,
  );
});

test("ExportOptions.plist는 plutil -lint를 통과하고 값이 예상대로 파싱된다", { skip: HAS_PLUTIL ? false : "plutil이 없어 건너뜀" }, () => {
  const lint = spawnSync("plutil", ["-lint", join(APP_DIR, EXPORT_OPTIONS)], { encoding: "utf8" });
  assert.strictEqual(lint.status, 0, `plutil -lint 실패:\n${lint.stdout}${lint.stderr}`);
  assert.strictEqual(plutilExtract("method"), "app-store-connect");
  assert.strictEqual(plutilExtract("teamID"), "__TEAM_ID__");
  assert.strictEqual(plutilExtract("signingStyle"), "manual");
  assert.strictEqual(plutilExtract("provisioningProfiles.__BUNDLE_ID__"), "__PROVISIONING_PROFILE_NAME__");
});

test("ExportOptions.plist는 iOS 워크플로우의 서명 설정과 모순되지 않는다", () => {
  const plist = readApp(EXPORT_OPTIONS);
  for (const name of ["IOS-TESTFLIGHT", "IOS-TEST-TESTFLIGHT"]) {
    const workflow = readWorkflow(name);
    // 워크플로우는 ios/ 디렉토리에서 이 파일을 -exportOptionsPlist로 사용한다
    assert.match(workflow, /-exportOptionsPlist ExportOptions\.plist/, `${name}: exportOptionsPlist 인자가 바뀌었습니다`);
    // 아카이브 서명 인증서와 export 서명 인증서가 같아야 한다
    const archiveIdentity = workflow.match(/CODE_SIGN_IDENTITY="([^"]+)"/)?.[1];
    assert.ok(archiveIdentity, `${name}: CODE_SIGN_IDENTITY를 찾을 수 없습니다`);
    assert.ok(plist.includes(`<string>${archiveIdentity}</string>`), `${name}: plist의 signingCertificate가 아카이브 인증서(${archiveIdentity})와 다릅니다`);
    // 프로파일 이름은 같은 Secret을 아카이브에 쓰므로 plist도 같은 이름을 안내해야 한다
    assert.ok(workflow.includes('PROVISIONING_PROFILE_SPECIFIER="$IOS_PROVISIONING_PROFILE_NAME"'), `${name}: 프로파일 Secret 사용처가 바뀌었습니다`);
  }
  assert.match(plist, /IOS_PROVISIONING_PROFILE_NAME/);
});
