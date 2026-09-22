// tests/node/readme-flutter-docs.test.js
// 이슈 #131 — README Flutter 문서에 빠지면 안 되는 항목과 doctor가 링크하는 앵커를 가드한다.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { DOC } from "../../src/commands/doctor.js";

const README = readFileSync(new URL("../../README.md", import.meta.url), "utf8");

test("README: doctor가 링크하는 #flutter-store 앵커가 존재한다", () => {
  assert.ok(DOC.flutterStore.endsWith("#flutter-store"));
  assert.ok(README.includes('<a id="flutter-store"></a>'));
});

test("README: Flutter 문서에 채워야 할 항목·Secrets·환경변수·배포 모드·ci-gate·Gemfile 안내가 있다", () => {
  const required = [
    "ExportOptions.plist", "__TEAM_ID__", "__BUNDLE_ID__", "__PROVISIONING_PROFILE_NAME__",
    "ANDROID_PACKAGE_NAME", "ANDROID_DEPLOY_MODE", "IOS_DEPLOY_MODE", "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64",
    "APP_STORE_CONNECT_API_KEY_ID", "IOS_PROVISIONING_PROFILE_NAME",
    "--dart-define-from-file", "flutter_dotenv", "envied",
    "store_only", "store_prepare", "store_submit",
    "ci-gate", "Gemfile.lock",
    "--flutter-env-mode", "--flutter-store", "--android-deploy-mode", "--ios-deploy-mode",
    "기존 파일 유지",
  ];
  const missing = required.filter((token) => !README.includes(token));
  assert.deepStrictEqual(missing, [], `README에 빠진 항목: ${missing.join(", ")}`);
});

test("README: .env 파서 지원 범위(Flutter 3.47.5 기준)가 명시되어 있다", () => {
  for (const token of ["DotEnvRegex", "export KEY=값", '"""', "flutter_command.dart"]) {
    assert.ok(README.includes(token), `${token} 설명이 있어야 한다`);
  }
});
