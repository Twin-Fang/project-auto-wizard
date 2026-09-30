// Pins that the Flutter workflows do not stall in unexpected places on a default flutter create
// project with nothing configured (SDK version, gradlew, Podfile, secret precheck, etc.).
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resolvePayloadRoot } from "../../src/core/assets.js";

const FLUTTER_DIR = join(resolvePayloadRoot(), "workflows", "flutter");
const FILES = readdirSync(FLUTTER_DIR).filter((f) => f.endsWith(".yaml")).sort();
const read = (f) => readFileSync(join(FLUTTER_DIR, f), "utf8");

// with blocks of the subosito/flutter-action steps
function flutterActionBlocks(text) {
  return [...text.matchAll(/uses: subosito\/flutter-action@v2\n        with:\n((?:          .*\n)+)/g)].map((m) => m[1]);
}

test("does not pin the Flutter SDK to a specific version and defaults to the latest stable", () => {
  let setups = 0;
  for (const f of FILES) {
    const text = read(f);
    const blocks = flutterActionBlocks(text);
    if (blocks.length === 0) continue;
    // A pinned version fails at pub get on a recent flutter create project (raised sdk constraint)
    assert.match(text, /^  FLUTTER_VERSION: ""$/m, `${f}: the FLUTTER_VERSION default must be empty`);
    for (const block of blocks) {
      setups++;
      assert.ok(block.includes("channel: stable\n"), `${f}: channel: stable is missing`);
      assert.ok(block.includes("flutter-version: ${{ env.FLUTTER_VERSION }}\n"), `${f}: cannot be overridden via FLUTTER_VERSION`);
      // A cache key built from the version string restores an old SDK even after stable moves on when the value is empty
      assert.ok(!block.includes("cache-key: flutter-${{ runner.os }}-${{ env.FLUTTER_VERSION }}"), `${f}: version-pinned cache key`);
    }
  }
  assert.strictEqual(setups, 12, "number of subosito/flutter-action steps");
});

test("steps do not fail when gradlew or Podfile is absent from the repo (default flutter create)", () => {
  let gradle = 0;
  let pods = 0;
  for (const f of FILES) {
    const lines = read(f).split("\n");
    lines.forEach((line, i) => {
      const code = line.trim();
      if (code === "chmod +x gradlew") {
        gradle++;
        assert.ok(lines.slice(Math.max(0, i - 3), i).some((l) => l.trim() === "if [ -f gradlew ]; then"), `${f}:${i + 1} chmod without checking gradlew exists`);
      }
      if (/pod install/.test(code) && !code.startsWith("echo") && !code.startsWith("#")) {
        pods++;
        assert.ok(lines.slice(Math.max(0, i - 3), i).some((l) => l.trim() === "if [ -f ios/Podfile ]; then"), `${f}:${i + 1} pod install without checking Podfile exists`);
      }
    });
  }
  assert.strictEqual(gradle, 3, "number of gradlew chmod steps");
  assert.strictEqual(pods, 4, "number of pod install steps");
});

test("both iOS TestFlight workflows check Secrets, ExportOptions placeholders and the Fastfile early in the prepare job", () => {
  for (const [f, job] of [["PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml", "prepare-build"], ["PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml", "prepare-test-build"]]) {
    const text = read(f);
    const jobStart = text.indexOf(`\n  ${job}:\n`);
    const preflight = text.indexOf("- name: Validate deploy settings", jobStart);
    assert.ok(jobStart !== -1 && preflight !== -1, `${f}: pre-check step is missing`);
    // Inside the same job and before the certificate import / Flutter install, so a default project reaches the guidance message
    const nextJob = text.slice(jobStart + 1).search(/\n  [a-z][\w-]*:\n/) + jobStart + 1;
    assert.ok(preflight < nextJob, `${f}: pre-check is outside ${job}`);
    assert.ok(preflight < text.indexOf("- name: Import Code-Signing Certificates"), `${f}: pre-check comes after the certificate import`);
    assert.ok(preflight < text.indexOf("uses: subosito/flutter-action@v2"), `${f}: pre-check comes after the Flutter install`);
    const step = text.slice(preflight, text.indexOf("\n      - name: ", preflight + 1));
    for (const secret of ["APPLE_CERTIFICATE_BASE64", "APPLE_PROVISIONING_PROFILE_BASE64", "IOS_PROVISIONING_PROFILE_NAME",
      "APP_STORE_CONNECT_API_KEY_ID", "APP_STORE_CONNECT_ISSUER_ID", "APP_STORE_CONNECT_API_KEY_BASE64"]) {
      assert.ok(step.includes(`${secret}: \${{ secrets.${secret} }}`), `${f}: ${secret} check is missing`);
    }
    assert.ok(step.includes("grep -Eq '__[A-Z][A-Z0-9_]*__' ios/ExportOptions.plist"), `${f}: placeholder check is missing`);
    assert.ok(step.includes("ios/fastlane/Fastfile"), `${f}: Fastfile check is missing`);
    assert.ok(step.includes("exit 1"), `${f}: does not stop when something is missing`);
  }
});

test("does not let empty signing or credential Secrets pass as success", () => {
  for (const f of FILES) {
    const text = read(f);
    // There must be no `|| echo "... failed"` pattern that swallows failures
    assert.ok(!/\|\| echo "[^"]*failed"/i.test(text), `${f}: code that swallows failures with echo remains`);
    // Expanding a Secret directly in the run body and base64-decoding it turns an empty value silently into an empty file
    assert.ok(!/echo "\$\{\{ secrets\.[A-Z_]+ \}\}" \| base64/.test(text), `${f}: decodes a Secret without checking it`);
    assert.ok(!text.includes("${{ secrets.GOOGLE_SERVICES_JSON }}\n          EOF"), `${f}: can create an empty google-services.json`);
  }
  // Store deploys must not diverge from the key registered with the store, so an empty signing Secret fails
  for (const f of ["PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml", "PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml"]) {
    const text = read(f);
    const start = text.indexOf("- name: Setup Release Keystore");
    const step = text.slice(start, text.indexOf("\n      - name: ", start));
    assert.ok(step.includes("for name in RELEASE_KEYSTORE_BASE64 RELEASE_KEYSTORE_PASSWORD RELEASE_KEY_ALIAS RELEASE_KEY_PASSWORD; do"), `${f}: signing Secret check missing`);
    // the message text lives in the catalog; the step must fail through the signing_secrets_empty key
    assert.ok(step.includes("::error::$(m flutter_a.signing_secrets_empty"), `${f}: does not fail on an empty signing Secret`);
    assert.ok(step.indexOf("exit 1") < step.indexOf("m flutter_a.release_keystore_created"), `${f}: prints a success message before the check`);
  }
  const selfhosted = read("PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD.yaml");
  assert.ok(selfhosted.includes('if [ -z "$DEBUG_KEYSTORE" ]; then'), "SELFHOSTED: DEBUG_KEYSTORE check missing");
  assert.ok(selfhosted.includes("# DEBUG_KEYSTORE (optional):"), "SELFHOSTED: the DEBUG_KEYSTORE actually used is not in the header notes");
});

test("test and internal deploy builds warn and proceed with default debug signing when signing Secrets are absent", () => {
  const cases = [
    ["PROJECT-FLUTTER-ANDROID-TEST-APK.yaml", "Setup Release Keystore", "Create key.properties", "release", "mode=debug"],
    ["PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD.yaml", "Setup Debug Keystore", "Setup Keystore and key.properties", "keystore", "mode=default"],
  ];
  for (const [f, signingStep, propsStep, mode, fallback] of cases) {
    const text = read(f);
    const start = text.indexOf(`- name: ${signingStep}\n        id: signing\n`);
    assert.ok(start !== -1, `${f}: the signing step has no id: signing`);
    const step = text.slice(start, text.indexOf("\n      - name: ", start));
    // when empty, warn and use debug signing instead of failing
    assert.ok(step.includes("::warning::"), `${f}: no warning for an empty Secret`);
    assert.ok(!/::error::\$\(m [\w.]*signing_secrets_empty/.test(step), `${f}: fails on an empty Secret`);
    assert.ok(step.indexOf(fallback) < step.indexOf("exit 0"), `${f}: no exit after the fallback`);
    // A corrupt value aborts because base64 decoding fails (not swallowed with ||)
    assert.ok(/printf '%s' "\$\w+" \| base64 -d > \S+\n/.test(step), `${f}: swallows a decoding failure`);
    // If no keystore was created, key.properties is not created either (so an empty config does not override the project's default signing)
    assert.ok(text.includes(`- name: ${propsStep}\n        if: steps.signing.outputs.mode == '${mode}'\n`), `${f}: key.properties creation condition missing`);
  }
});

test("the manual run (workflow_dispatch) deploy mode default follows the mode chosen at install", async () => {
  const { makeSrcText } = await import("../../src/core/copy/workflows.js");
  const { substituteEnv } = await import("../../src/core/wizard-env.js");
  for (const [f, token] of [["PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml", "android-deploy-mode"], ["PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml", "ios-deploy-mode"]]) {
    assert.ok(read(f).includes(`        default: "store_only"  # @wizard auto:${token}\n`), `${f}: dispatch default marker missing`);
    const source = makeSrcText({ main: "main", develop: "develop", mode: "pr-flow" })(join(FLUTTER_DIR, f));
    const rendered = substituteEnv(source, { type: "flutter", resolvers: { [token]: () => "store_submit" } });
    assert.ok(rendered.includes('        default: "store_submit"\n'), `${f}: dispatch default was not replaced with the chosen value`);
    assert.ok(rendered.includes("|| 'store_submit' }}"), `${f}: the fallback and the dispatch default disagree`);
  }
});

test("the CI changes job compares only the commits of the current push on push (no accumulated diff against the default branch)", () => {
  const text = read("PROJECT-FLUTTER-CI.yaml");
  const filter = text.slice(text.indexOf("uses: dorny/paths-filter@v4"), text.indexOf("filters: |"));
  assert.ok(
    filter.includes("base: ${{ github.event_name == 'push' && github.event.before != '0000000000000000000000000000000000000000' && github.event.before || '' }}"),
    "the push event base is not github.event.before",
  );
});

// Without Secrets, a run used to fail only after minutes of building (or against an empty SMB address).
// Check every required Secret right after checkout in the first job, and do not check optional Secrets.
test("Android deploy workflows check all required Secrets at once right after checkout", () => {
  const STEP = "- name: Pre-deploy check (Secrets)";
  const SIGN = ["RELEASE_KEYSTORE_BASE64", "RELEASE_KEYSTORE_PASSWORD", "RELEASE_KEY_ALIAS", "RELEASE_KEY_PASSWORD"];
  const cases = [
    ["PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD.yaml", ["SERVER_HOST", "SERVER_USER", "SERVER_PASSWORD"], ["DEBUG_KEYSTORE", "GOOGLE_SERVICES_JSON"]],
    ["PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml", [...SIGN, "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64", "ANDROID_PACKAGE_NAME"], ["GOOGLE_SERVICES_JSON", "ENV_FILE"]],
    ["PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml", [...SIGN, "FIREBASE_SERVICE_ACCOUNT_JSON_BASE64"], ["GOOGLE_SERVICES_JSON", "ENV_FILE"]],
  ];
  for (const [f, required, optional] of cases) {
    const lines = read(f).split("\n");
    const at = lines.findIndex((l) => l.trim() === STEP);
    assert.ok(at > 0, `${f}: precheck step missing`);
    // The first step in the file must be checkout, immediately followed by the precheck
    const steps = lines.flatMap((l, i) => (/^      - name: /.test(l) ? [i] : []));
    assert.match(lines[steps[0]], /Check ?out repository/, `${f}: the first step is not checkout`);
    assert.strictEqual(steps[1], at, `${f}: the precheck does not directly follow checkout`);
    const block = lines.slice(at, steps[2]).join("\n");
    for (const name of required) assert.ok(block.includes(`${name}: \${{ secrets.${name}`), `${f}: ${name} check missing`);
    for (const name of optional) assert.ok(!block.includes(`secrets.${name} `), `${f}: optional Secret ${name} is checked as required`);
    assert.match(block, /::error title=\$\(m flutter_a\.precheck_missing_title\)::\$\(m flutter_a\.precheck_missing_body missing="\$MISSING"\)/);
    assert.match(block, /exit 1/);
  }
});
