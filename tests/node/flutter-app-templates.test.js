// tests/node/flutter-app-templates.test.js
// Contract checks for the store deploy templates (Fastfile, ExportOptions.plist) under payload/flutter-app/.
//
// Users edit these files by hand after install, so a break in Ruby syntax, env var consistency with the
// workflows, deploy mode branching, or the placeholder convention would only surface the first time CI
// runs in their repo -- pin them here. Checks that need Ruby or plutil are skipped where those are missing
// (Windows, Linux CI, etc.).
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
const SKIP_RUBY = HAS_RUBY ? false : "skipped: ruby not available";

// Set of env var names the Fastfile reads: direct ENV["NAME"] references and require_env("NAME") helper calls
const envNamesRead = (fastfileText) =>
  new Set([...fastfileText.matchAll(/(?:ENV\[|require_env\()"([A-Z][A-Z0-9_]*)"[\])]/g)].map((m) => m[1]));

// Set of env var names the workflow exports to fastlane: `export NAME=` or a YAML `NAME:` key.
// (Passing via an env: block or via export is the same contract, so both count.)
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

// Common contract section 8: env vars the workflow exports and the Fastfile reads
const ANDROID_ENV = ["AAB_PATH", "GOOGLE_PLAY_JSON_KEY", "VERSION_NAME", "VERSION_CODE", "DEPLOY_MODE", "PACKAGE_NAME"];

test("Fastfile.playstore has valid Ruby syntax", { skip: SKIP_RUBY }, () => {
  const result = spawnSync("ruby", ["-c", join(APP_DIR, ANDROID_FASTFILE)], { encoding: "utf8" });
  assert.strictEqual(result.status, 0, `ruby -c failed:\n${result.stderr}`);
});

test("Fastfile.playstore has a user-ownership notice and a mode mapping table at the top", () => {
  const text = readApp(ANDROID_FASTFILE);
  assert.match(text, /This file is user-owned\. Edit the per-mode behavior here/);
  for (const mode of ["store_only", "store_prepare", "store_submit"]) {
    assert.match(text.split("default_platform")[0], new RegExp(mode), `mode table is missing ${mode}`);
  }
});

test("Fastfile.playstore has lane deploy_internal", () => {
  assert.match(readApp(ANDROID_FASTFILE), /^\s*lane :deploy_internal do$/m);
});

test("Fastfile.playstore reads exactly the env vars in common contract section 8", () => {
  const read = envNamesRead(readApp(ANDROID_FASTFILE));
  assert.deepStrictEqual([...read].sort(), [...ANDROID_ENV].sort());
});

test("Fastfile.playstore aborts with a catalog message when PACKAGE_NAME is empty", () => {
  const text = readApp(ANDROID_FASTFILE);
  assert.match(
    text,
    /if package_name\.empty\?\s*\n\s*UI\.user_error!\(paw_msg\("fastlane\.package_name_empty"\)\)/,
  );
});

test("Fastfile.playstore maps the 3 deploy modes to track/status and treats unknown values as store_only", () => {
  const text = readApp(ANDROID_FASTFILE);
  assert.match(text, /when "store_prepare"\s*\n\s*\["production", "draft"\]/);
  assert.match(text, /when "store_submit"\s*\n\s*\["production", "completed"\]/);
  assert.match(text, /when "store_only"\s*\n\s*\["internal", "completed"\]/);
  // the else branch (unknown value) also uploads to internal, same as store_only
  assert.match(text, /else\s*\n\s*UI\.important\(paw_msg\("fastlane\.deploy_mode_unknown"[^\n]*\n\s*\["internal", "completed"\]/);
});

test("Fastfile.playstore upload_to_play_store parameters match the official fastlane option names", () => {
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
    assert.ok(text.includes(param), `upload_to_play_store is missing ${param}`);
  }
  // The changelog must not be skipped because it uploads the changelogs/<VERSION_CODE>.txt the workflow creates
  assert.doesNotMatch(text, /skip_upload_changelogs:\s*true/);
});

test("Fastfile.playstore metadata_path matches the parent of the changelogs path the PLAYSTORE workflow creates", () => {
  const fastfile = readApp(ANDROID_FASTFILE);
  const workflow = readWorkflow("ANDROID-PLAYSTORE-CICD");
  // The lane runs from android/fastlane where the Fastfile lives, so metadata/android is
  // android/fastlane/metadata/android.
  assert.match(fastfile, /File\.expand_path\("metadata\/android"\)/);
  assert.match(fastfile, /File\.join\(metadata_path, "ko-KR", "changelogs", "#\{version_code\}\.txt"\)/);
  assert.ok(workflow.includes("android/fastlane/metadata/android/ko-KR/changelogs"), "the workflow's changelogs path changed");
  assert.ok(workflow.includes("cp android/fastlane/Fastfile.playstore android/fastlane/Fastfile"), "the workflow does not copy Fastfile.playstore to Fastfile");
  assert.ok(workflow.includes("bundle exec fastlane deploy_internal"), "the workflow does not call the deploy_internal lane");
});

test("PLAYSTORE workflow exports the env vars the Fastfile reads", () => {
  // PACKAGE_NAME is a value the workflow side adds separately, so it is not checked against the
  // workflow's current state here -- it is pinned only by the contract section 8 constant (ANDROID_ENV) above.
  const provided = envNamesProvided(readWorkflow("ANDROID-PLAYSTORE-CICD"));
  const required = ANDROID_ENV.filter((name) => name !== "PACKAGE_NAME");
  assert.deepStrictEqual(missingFrom(required, provided), [], "the Fastfile reads env vars the workflow does not export");
});

// ---------------------------------------------------------------------------
// iOS: ios/fastlane/Fastfile (lane deploy, upload_testflight)
// ---------------------------------------------------------------------------
const IOS_FASTFILE = "ios/fastlane/Fastfile";
const EXPORT_OPTIONS = "ios/ExportOptions.plist";

// Common contract section 8: env vars the deploy lane receives (upload_testflight uses a subset)
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
// APP_IDENTIFIER is left out here because the upload_testflight workflow does not export it
// (used if present, inferred by fastlane otherwise).
const IOS_UPLOAD_ENV = ["API_KEY_PATH", "IPA_PATH", "RELEASE_NOTES", "APP_STORE_CONNECT_API_KEY_ID", "APP_STORE_CONNECT_ISSUER_ID"];

// From `lane :<name> do` to the `end` indented by 2 spaces
const laneBody = (fastfileText, laneName) => {
  const match = fastfileText.match(new RegExp(`^  lane :${laneName} do\\n([\\s\\S]*?)^  end$`, "m"));
  assert.ok(match, `lane :${laneName} not found`);
  return match[1];
};

test("ios Fastfile has valid Ruby syntax", { skip: SKIP_RUBY }, () => {
  const result = spawnSync("ruby", ["-c", join(APP_DIR, IOS_FASTFILE)], { encoding: "utf8" });
  assert.strictEqual(result.status, 0, `ruby -c failed:\n${result.stderr}`);
});

test("ios Fastfile has a user-ownership notice and a mode mapping table at the top", () => {
  const header = readApp(IOS_FASTFILE).split("default_platform")[0];
  assert.match(header, /This file is user-owned\. Edit the per-mode behavior here/);
  for (const mode of ["store_only", "store_prepare", "store_submit"]) {
    assert.match(header, new RegExp(mode), `mode table is missing ${mode}`);
  }
});

test("ios Fastfile has lanes deploy and upload_testflight", () => {
  const text = readApp(IOS_FASTFILE);
  assert.match(text, /^  lane :deploy do$/m);
  assert.match(text, /^  lane :upload_testflight do$/m);
});

test("ios Fastfile reads exactly the env vars in common contract section 8", () => {
  const read = envNamesRead(readApp(IOS_FASTFILE));
  assert.deepStrictEqual([...read].sort(), [...IOS_DEPLOY_ENV].sort());
});

test("upload_testflight lane only uploads the IPA and does not use deploy modes or App Store steps", () => {
  const body = laneBody(readApp(IOS_FASTFILE), "upload_testflight");
  assert.match(body, /upload_ipa_to_testflight\(/);
  for (const forbidden of ["DEPLOY_MODE", "APP_VERSION", "BUILD_NUMBER", "upload_to_app_store", "submit_for_review"]) {
    assert.ok(!body.includes(forbidden), `upload_testflight lane contains ${forbidden}`);
  }
});

test("ios Fastfile authenticates with an App Store Connect API key", () => {
  const text = readApp(IOS_FASTFILE);
  assert.match(
    text,
    /app_store_connect_api_key\(\s*\n\s*key_id: require_env\("APP_STORE_CONNECT_API_KEY_ID"\),\s*\n\s*issuer_id: require_env\("APP_STORE_CONNECT_ISSUER_ID"\),\s*\n\s*key_filepath: require_env\("API_KEY_PATH"\)/,
  );
  assert.match(text, /api_key: api_key/);
});

test("ios Fastfile aborts with a catalog message when a required env var is empty", () => {
  assert.match(
    readApp(IOS_FASTFILE),
    /UI\.user_error!\(paw_msg\("fastlane\.env_empty", name: name\)\) if value\.empty\?/,
  );
});

test("upload_testflight passes APP_IDENTIFIER only when set, while deploy store_prepare/store_submit require it", () => {
  const text = readApp(IOS_FASTFILE);
  // pilot (TestFlight upload) is optional: the IOS-TEST-TESTFLIGHT workflow may omit APP_IDENTIFIER.
  assert.match(text, /app_identifier\.empty\? \? \{\} : \{ app_identifier: app_identifier \}/);
  const upload_testflight_helper = text.split("def app_identifier_option")[1].split("def upload_ipa_to_testflight")[0];
  assert.doesNotMatch(upload_testflight_helper, /require_env\("APP_IDENTIFIER"\)/);
  // deliver (linking the App Store version) stops at UI.input when APP_IDENTIFIER is empty (waiting for
  // interactive input), so the store_prepare/store_submit branches make it required via require_env and
  // fail with a clear error in CI.
  const deployBody = laneBody(text, "deploy");
  const prepareSubmitBranch = deployBody.split('when "store_only"')[0];
  assert.match(prepareSubmitBranch, /app_identifier: require_env\("APP_IDENTIFIER"\)/);
});

test("ios Fastfile upload_to_testflight parameters match the official fastlane option names", () => {
  const text = readApp(IOS_FASTFILE);
  for (const param of [
    "api_key: api_key",
    'ipa: require_env("IPA_PATH")',
    "skip_waiting_for_build_processing: skip_waiting_for_build_processing",
    "options[:changelog] = release_notes",
    "upload_to_testflight(**options, **app_identifier_option)",
  ]) {
    assert.ok(text.includes(param), `upload_to_testflight is missing ${param}`);
  }
});

test("ios Fastfile branches on the 3 deploy modes and store_prepare does not submit for review", () => {
  const body = laneBody(readApp(IOS_FASTFILE), "deploy");
  assert.match(body, /when "store_prepare", "store_submit"/);
  assert.match(body, /when "store_only"/);
  // unknown and empty values are handled as a TestFlight upload, same as store_only
  assert.match(body, /else\n\s*UI\.important\(paw_msg\("fastlane\.deploy_mode_unknown"[^\n]*\n\s*upload_ipa_to_testflight\(/);
  // submitting for review is true only for store_submit; false for store_prepare
  assert.match(body, /submit_for_review: deploy_mode == "store_submit"/);
  // TestFlight (pilot) does the upload; deliver only links the already-uploaded build to the App Store version
  for (const param of [
    "skip_binary_upload: true",
    "skip_screenshots: true",
    'app_version: require_env("APP_VERSION")',
    'build_number: require_env("BUILD_NUMBER")',
    "automatic_release: false",
    "force: true",
    "precheck_include_in_app_purchases: false",
  ]) {
    assert.ok(body.includes(param), `upload_to_app_store is missing ${param}`);
  }
  assert.match(body, /skip_metadata: Dir\.glob\("metadata\/\*"\)\.empty\?/);
});

test("upload_to_app_store sets precheck_include_in_app_purchases:false avoids the in-app purchase precheck crash", () => {
  // deliver's precheck cannot verify in-app purchase items with App Store Connect API key auth,
  // so leaving the default (true) aborts with UI.user_error! (fastlane deliver/runner.rb precheck_app).
  const body = laneBody(readApp(IOS_FASTFILE), "deploy");
  assert.match(body, /precheck_include_in_app_purchases: false/);
});

test("store_prepare/store_submit wait for build processing to finish (SKIP_WAITING is ignored)", () => {
  const body = laneBody(readApp(IOS_FASTFILE), "deploy");
  const prepareBranch = body.split('when "store_only"')[0];
  assert.match(prepareBranch, /upload_ipa_to_testflight\(api_key, false\)/);
  assert.ok(!prepareBranch.includes("SKIP_WAITING_FOR_BUILD_PROCESSING"));
});

test("IOS-TESTFLIGHT workflow exports all env vars the deploy lane reads", () => {
  const workflow = readWorkflow("IOS-TESTFLIGHT");
  assert.deepStrictEqual(missingFrom(IOS_DEPLOY_ENV, envNamesProvided(workflow)), []);
  assert.ok(workflow.includes("bundle exec fastlane deploy"), "the workflow does not call the deploy lane");
});

test("IOS-TEST-TESTFLIGHT workflow exports the env vars the upload_testflight lane reads", () => {
  const workflow = readWorkflow("IOS-TEST-TESTFLIGHT");
  assert.deepStrictEqual(missingFrom(IOS_UPLOAD_ENV, envNamesProvided(workflow)), []);
  assert.ok(workflow.includes("bundle exec fastlane upload_testflight"), "the workflow does not call the upload_testflight lane");
});

// ---------------------------------------------------------------------------
// iOS: ios/ExportOptions.plist
// ---------------------------------------------------------------------------
const PLACEHOLDER_PATTERN = /__[A-Z][A-Z0-9_]*__/g; // the unreplaced-placeholder detection regex from common contract section 8 (only the global flag added)
const PLIST_PLACEHOLDERS = ["__TEAM_ID__", "__BUNDLE_ID__", "__PROVISIONING_PROFILE_NAME__"];

const plutilExtract = (keyPath) => {
  const result = spawnSync("plutil", ["-extract", keyPath, "raw", "-o", "-", join(APP_DIR, EXPORT_OPTIONS)], { encoding: "utf8" });
  assert.strictEqual(result.status, 0, `plutil -extract ${keyPath} failed:\n${result.stderr}`);
  return result.stdout.trim();
};

test("ExportOptions.plist has only the 3 placeholders from contract section 8 and they match the detection regex", () => {
  const found = [...new Set(readApp(EXPORT_OPTIONS).match(PLACEHOLDER_PATTERN) ?? [])].sort();
  assert.deepStrictEqual(found, [...PLIST_PLACEHOLDERS].sort());
});

test("ExportOptions.plist has no placeholder left once values are filled in (none left in comments either)", () => {
  let filled = readApp(EXPORT_OPTIONS);
  for (const placeholder of PLIST_PLACEHOLDERS) filled = filled.replaceAll(placeholder, "filled-value");
  assert.doesNotMatch(filled, /__[A-Z][A-Z0-9_]*__/);
});

test("ExportOptions.plist specifies App Store distribution, manual signing and profile mapping", () => {
  const text = readApp(EXPORT_OPTIONS);
  assert.match(text, /<key>method<\/key>\s*<string>app-store-connect<\/string>/);
  assert.match(text, /<key>teamID<\/key>\s*<string>__TEAM_ID__<\/string>/);
  assert.match(text, /<key>signingStyle<\/key>\s*<string>manual<\/string>/);
  assert.match(
    text,
    /<key>provisioningProfiles<\/key>\s*<dict>\s*<key>__BUNDLE_ID__<\/key>\s*<string>__PROVISIONING_PROFILE_NAME__<\/string>\s*<\/dict>/,
  );
});

test("ExportOptions.plist passes plutil -lint and parses to the expected values", { skip: HAS_PLUTIL ? false : "skipped: plutil not available" }, () => {
  const lint = spawnSync("plutil", ["-lint", join(APP_DIR, EXPORT_OPTIONS)], { encoding: "utf8" });
  assert.strictEqual(lint.status, 0, `plutil -lint failed:\n${lint.stdout}${lint.stderr}`);
  assert.strictEqual(plutilExtract("method"), "app-store-connect");
  assert.strictEqual(plutilExtract("teamID"), "__TEAM_ID__");
  assert.strictEqual(plutilExtract("signingStyle"), "manual");
  assert.strictEqual(plutilExtract("provisioningProfiles.__BUNDLE_ID__"), "__PROVISIONING_PROFILE_NAME__");
});

test("ExportOptions.plist does not contradict the iOS workflow's signing settings", () => {
  const plist = readApp(EXPORT_OPTIONS);
  for (const name of ["IOS-TESTFLIGHT", "IOS-TEST-TESTFLIGHT"]) {
    const workflow = readWorkflow(name);
    // The workflow uses this file as -exportOptionsPlist from the ios/ directory
    assert.match(workflow, /-exportOptionsPlist ExportOptions\.plist/, `${name}: exportOptionsPlist argument changed`);
    // The archive signing certificate and the export signing certificate must match
    const archiveIdentity = workflow.match(/CODE_SIGN_IDENTITY="([^"]+)"/)?.[1];
    assert.ok(archiveIdentity, `${name}: CODE_SIGN_IDENTITY not found`);
    assert.ok(plist.includes(`<string>${archiveIdentity}</string>`), `${name}: plist signingCertificate differs from the archive certificate (${archiveIdentity})`);
    // The profile name uses the same Secret for the archive, so the plist must point to the same name
    assert.ok(workflow.includes('PROVISIONING_PROFILE_SPECIFIER="$IOS_PROVISIONING_PROFILE_NAME"'), `${name}: profile Secret usage changed`);
  }
  assert.match(plist, /IOS_PROVISIONING_PROFILE_NAME/);
});
