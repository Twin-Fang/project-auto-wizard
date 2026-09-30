// tests/node/readme-flutter-docs.test.js
// Guards the items the Flutter docs must not omit and the anchor that doctor links to.
// Flutter details live in the docs site's (Korean) Flutter page and the CLI reference.
import "../setup-lang.mjs"; // these tests assert the ko output
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { DOC } from "../../src/commands/doctor.js";

const DOCS_DIR = new URL("../../website/src/content/docs/ko/", import.meta.url);
const FLUTTER_PAGE = readFileSync(new URL("project-types/flutter.md", DOCS_DIR), "utf8");
// Option names also appear on the CLI reference page, so the two pages are checked together.
const README = FLUTTER_PAGE + readFileSync(new URL("reference/cli.md", DOCS_DIR), "utf8");

test("Flutter docs: the #flutter-store anchor that doctor links to exists", () => {
  assert.ok(DOC.flutterStore.endsWith("/ko/project-types/flutter/#flutter-store"));
  assert.ok(FLUTTER_PAGE.includes('<a id="flutter-store"></a>'));
});

test("Flutter docs: the Flutter docs cover the required items, Secrets, env vars, deploy modes, ci-gate and Gemfile notes", () => {
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
  assert.deepStrictEqual(missing, [], `items missing from README: ${missing.join(", ")}`);
});

test("Flutter docs: the .env parser support scope (as of Flutter 3.47.5) is stated", () => {
  for (const token of ["DotEnvRegex", "export KEY=값", '"""', "flutter_command.dart"]) {
    assert.ok(README.includes(token), `${token} must be explained`);
  }
});
