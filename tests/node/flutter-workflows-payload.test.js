// Pins the 7 Flutter workflows (CI, FIREBASE, SELFHOSTED, TEST-APK, PLAYSTORE, IOS-TESTFLIGHT, IOS-TEST-TESTFLIGHT):
// FLUTTER_PROJECT_DIR handling, env mode (dart-define|dotenv), fastlane cleanup and the main push paths anchor.
// New cases are appended per workflow file — reuse the helpers below.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { makeSrcText } from "../../src/core/copy/workflows.js";
import { substituteEnv } from "../../src/core/wizard-env.js";
import { scanUnsubstituted } from "../../src/core/verify.js";

const FLUTTER_DIR = join(resolvePayloadRoot(), "workflows", "flutter");
const BRANCHES = { main: "main", develop: "develop", mode: "pr-flow" };
const DART_DEFINE_FLAG = '${DART_DEFINE_FILE:+--dart-define-from-file="$DART_DEFINE_FILE"}';

const rawWorkflow = (filename) => readFileSync(join(FLUTTER_DIR, filename), "utf8");

// Output of the same substitution pipeline as the install path (makeSrcText → substituteEnv).
// Resolver names match makeResolvers in src/core/detect-fs.js (contract §4).
function renderWorkflow(
  filename,
  { flutterRoot = ".", envMode = "dart-define", androidDeployMode = "", iosDeployMode = "" } = {},
) {
  const source = makeSrcText(BRANCHES)(join(FLUTTER_DIR, filename));
  return substituteEnv(source, {
    type: "flutter",
    repoName: "sample-app",
    projectPath: flutterRoot,
    resolvers: {
      repo: () => "sample-app",
      jdk: () => "17",
      "flutter-root": () => flutterRoot,
      "project-path": () => flutterRoot,
      "flutter-env-mode": () => envMode,
      "android-deploy-mode": () => androidDeployMode,
      "ios-deploy-mode": () => iosDeployMode,
    },
  });
}

// ---- actionlint -----------------------------------------------------------------------------
// actionlint is not a repo dependency — tests that need it are skipped when it is not on PATH.
// @wizard markers and {{MAIN_BRANCH}} are substituted first; it runs against the temp file (renderWorkflow above).
// Findings the files already produced before this change (measured with actionlint 1.7.12 + shellcheck 0.11.0) are excluded
// and only new findings count as failures:
//   - shellcheck info/style: SC2001 SC2015 SC2086 SC2129 SC2181 (unquoted variables, individual redirects, etc.)
//   - github.head_ref inline usage warning in PROJECT-FLUTTER-CI.yaml
const HAS_ACTIONLINT = spawnSync("actionlint", ["-version"]).status === 0;
const BASELINE_SHELLCHECK = /\b(?:SC2001|SC2015|SC2086|SC2129|SC2181):(?:info|style)\b/;
const BASELINE_EXPRESSION = /"github\.head_ref" is potentially untrusted/;

function newActionlintFindings(filename, renderOptions) {
  const dir = mkdtempSync(join(tmpdir(), "paw-flutter-actionlint-"));
  try {
    const file = join(dir, filename);
    writeFileSync(file, renderWorkflow(filename, renderOptions));
    const result = spawnSync("actionlint", ["-no-color", "-format", "{{json .}}", file], { encoding: "utf8" });
    const findings = result.stdout.trim() ? JSON.parse(result.stdout) : [];
    return findings
      .filter((f) => !(f.kind === "shellcheck" && BASELINE_SHELLCHECK.test(f.message)))
      .filter((f) => !(f.kind === "expression" && BASELINE_EXPRESSION.test(f.message)))
      .map((f) => `${filename}:${f.line}:${f.column} [${f.kind}] ${f.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function assertActionlintClean(filename) {
  for (const renderOptions of [{ flutterRoot: ".", envMode: "dart-define" }, { flutterRoot: "app", envMode: "dotenv" }]) {
    assert.deepStrictEqual(newActionlintFindings(filename, renderOptions), [], `${filename} (${JSON.stringify(renderOptions)})`);
  }
}

// ---- structure helpers ------------------------------------------------------------------------------
// Splits the top-level job blocks under "jobs:" into Map<jobId, block text>.
function jobBlocks(text) {
  const jobsSection = text.slice(text.search(/^jobs:\s*$/m));
  const blocks = new Map();
  for (const block of jobsSection.split(/^(?=  [a-z][\w-]*:\s*$)/m).slice(1)) {
    blocks.set(block.match(/^  ([\w-]+):/)[1], block);
  }
  return blocks;
}

// Returns each `flutter build ...` command as one line, joining line continuations (\). Text inside echo is excluded.
function flutterBuildCommands(text) {
  return text
    .replace(/\\\r?\n\s*/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^flutter build \w+/.test(line));
}

function assertEveryFlutterBuildUsesDartDefine(filename, expectedBuildCount) {
  const commands = flutterBuildCommands(rawWorkflow(filename));
  assert.strictEqual(commands.length, expectedBuildCount, `${filename}: flutter build call count\n  ${commands.join("\n  ")}`);
  for (const command of commands) {
    assert.ok(command.endsWith(DART_DEFINE_FLAG), `${filename}: missing dart-define flag → ${command}`);
  }
}

// A job that runs flutter build or build_runner must have a 'Prepare env file' step before it
// (GITHUB_ENV is per job, so every job needs it).
function assertEnvPreparedBeforeFlutterCommands(filename, expectedJobIds) {
  const text = rawWorkflow(filename);
  const preparing = [];
  for (const [id, block] of jobBlocks(text)) {
    const firstUse = block.search(/^\s*(?:flutter build \w+|dart run build_runner)/m);
    if (firstUse === -1) continue;
    const prepareAt = block.indexOf("- name: Prepare env file");
    assert.ok(prepareAt !== -1 && prepareAt < firstUse, `${filename}: job '${id}' has no 'Prepare env file' step before the build`);
    preparing.push(id);
  }
  assert.deepStrictEqual(preparing, expectedJobIds, `${filename}: jobs that need Prepare env file`);
}

function assertLegacyEnvStepsRemoved(filename) {
  const text = rawWorkflow(filename);
  assert.ok(!/- name: Create \.env file/.test(text), `${filename}: 'Create .env file' step is still present`);
  assert.ok(!/- name: Ensure \.env file exists/.test(text), `${filename}: 'Ensure .env file exists' step is still present`);
  assert.ok(!text.includes("cat << 'EOF' > ${{ env.ENV_FILE_PATH }}"), `${filename}: code that writes .env via heredoc is still present`);
}

// Is the top-level env @wizard token line present exactly as in the contract?
function assertWizardTokenLine(filename, line) {
  assert.ok(rawWorkflow(filename).split("\n").includes(line), `${filename}: missing line → ${line}`);
}

// Does the job set defaults.run.working-directory?
function assertJobsUseFlutterDir(filename, jobIds) {
  const blocks = jobBlocks(rawWorkflow(filename));
  for (const id of jobIds) {
    assert.ok(blocks.has(id), `${filename}: job '${id}' is missing`);
    assert.match(
      blocks.get(id),
      /^    defaults:\n      run:\n        working-directory: \$\{\{ env\.FLUTTER_PROJECT_DIR \}\}\n/m,
      `${filename}: job '${id}' has no defaults.run.working-directory`,
    );
  }
}

// Are non-run step paths (path/file/serviceCredentialsFile, working-directory) left relative to the repo root?
// defaults.run.working-directory applies only to run steps; step-level working-directory and `with:` paths are workspace-relative,
// so ${{ env.FLUTTER_PROJECT_DIR }}/ must be prefixed explicitly. allow: lines intentionally relative to the repo root (trimmed original text).
const ROOT_RELATIVE_STEP_PATHS = [
  /^(?:path|file|serviceCredentialsFile):\s*(?:\.\/)?(?:android|ios|build)\//,
  /^(?:path|file|serviceCredentialsFile):\s*(?:\.\/)?(?:pubspec\.yaml|firebase-service-account\.json)\s*$/,
  /^(?:\.\/)?(?:android\/|ios\/|build\/|lib\/|assets\/)\S*$/,
  /^(?:\.\/)?(?:pubspec\.yaml|build-info\.txt|build-metadata\.json)$/,
  /^working-directory:\s*(?:android|ios)\s*$/,
];
function rootRelativeStepPaths(filename, allow = []) {
  return rawWorkflow(filename)
    .split("\n")
    .map((line, index) => ({ line: index + 1, text: line.trim() }))
    .filter(({ text }) => ROOT_RELATIVE_STEP_PATHS.some((re) => re.test(text)) && !allow.includes(text))
    .map(({ line, text }) => `${filename}:${line}  ${text}`);
}

// Are globs scoped under the Flutter root instead of scanning the whole repo (so other folders' pubspec.lock/build.gradle in a monorepo don't disturb the cache key)?
function assertHashFilesScopedToFlutterRoot(filename) {
  const text = rawWorkflow(filename);
  assert.ok(!text.includes("hashFiles('**/"), `${filename}: hashFiles scans the whole repo`);
  assert.ok(text.includes("hashFiles(format('{0}/**/pubspec.lock', env.FLUTTER_PROJECT_DIR))"), `${filename}: pubspec.lock cache key is not scoped to the Flutter root`);
}

function assertNoUnsubstitutedPlaceholders(filename) {
  const dir = mkdtempSync(join(tmpdir(), "paw-flutter-unsubstituted-"));
  try {
    writeFileSync(join(dir, filename), renderWorkflow(filename, { flutterRoot: "app", envMode: "dotenv", androidDeployMode: "store_prepare", iosDeployMode: "store_submit" }));
    assert.deepStrictEqual(scanUnsubstituted(dir, [filename]), [], `${filename}: __TOKEN__ remains after substitution`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function assertRenderedEnvMode(filename) {
  for (const mode of ["dart-define", "dotenv"]) {
    assert.match(renderWorkflow(filename, { envMode: mode }), new RegExp(`^  ENV_MODE: "${mode}"\\s*$`, "m"), `${filename}: ENV_MODE=${mode}`);
  }
}

function assertRenderedFlutterRoot(filename) {
  assert.match(renderWorkflow(filename, { flutterRoot: "." }), /^  FLUTTER_PROJECT_DIR: "\."\s*$/m);
  assert.match(renderWorkflow(filename, { flutterRoot: "app" }), /^  FLUTTER_PROJECT_DIR: "app"\s*$/m);
}

// main push anchor → replaced by a single paths filter line in a monorepo, left as a comment in a single-repo layout.
const PATHS_ANCHOR_LINE = "    # @wizard paths-anchor (in a monorepo the installer injects a paths filter here)";
function assertPathsAnchor(filename) {
  const raw = rawWorkflow(filename);
  assert.strictEqual(raw.split("\n").filter((l) => l === PATHS_ANCHOR_LINE).length, 1, `${filename}: paths-anchor line`);
  assert.match(raw, /^  push:\n    branches: \["\{\{MAIN_BRANCH\}\}"\]\n    # @wizard paths-anchor/m, `${filename}: the anchor must sit directly below push.branches (4 spaces)`);
  assert.match(renderWorkflow(filename, { flutterRoot: "app" }), /^  push:\n    branches: \["main"\]\n    paths: \['app\/\*\*'\]\n/m, `${filename}: --paths flutter=app`);
  assert.ok(renderWorkflow(filename, { flutterRoot: "." }).includes(PATHS_ANCHOR_LINE), `${filename}: the anchor comment stays as-is in a single repo`);
}

// No dangling web wizard guidance (.github/util/flutter/... that does not exist in the repo) is left
function assertNoBrokenWebWizardGuide(filename) {
  const text = rawWorkflow(filename);
  assert.ok(!text.includes(".github/util/flutter"), `${filename}: a non-existent web wizard path is still present`);
  assert.ok(!text.includes("웹 마법사"), `${filename}: web wizard guidance is still present`);
}

// Files that limit fastlane to store deploys (SELFHOSTED, TEST-APK): no Ruby/fastlane traces allowed
function assertNoFastlane(filename) {
  const text = rawWorkflow(filename);
  for (const forbidden of ["fastlane", "setup-ruby", "Gemfile", "bundle "]) {
    assert.ok(!text.includes(forbidden), `${filename}: '${forbidden}' is still present`);
  }
}

// ---------------------------------------------------------------------------------------------
// PROJECT-FLUTTER-CI.yaml
// ---------------------------------------------------------------------------------------------
const CI = "PROJECT-FLUTTER-CI.yaml";

test("CI: top-level env has PROJECT_PATH, FLUTTER_PROJECT_DIR and ENV_MODE @wizard tokens", () => {
  assertWizardTokenLine(CI, '  PROJECT_PATH: "."  # @wizard auto:project-path');
  assertWizardTokenLine(CI, '  FLUTTER_PROJECT_DIR: "."  # @wizard auto:flutter-root');
  assertWizardTokenLine(CI, '  ENV_MODE: "dart-define"  # @wizard auto:flutter-env-mode');
});

test("CI: substitution result — path and env mode are applied", () => {
  assertRenderedFlutterRoot(CI);
  assertRenderedEnvMode(CI);
  assert.match(renderWorkflow(CI, { flutterRoot: "app" }), /^  PROJECT_PATH: "app"\s*$/m);
  assert.match(renderWorkflow(CI, { flutterRoot: "." }), /^  PROJECT_PATH: "\."\s*$/m);
});

test("CI: changes job detects PROJECT_PATH changes via dorny/paths-filter@v4", () => {
  const changes = jobBlocks(rawWorkflow(CI)).get("changes");
  assert.ok(changes, "changes job is missing");
  assert.match(changes, /uses: dorny\/paths-filter@v4/);
  assert.match(changes, /        if: \$\{\{ github\.event_name != 'workflow_dispatch' \}\}\n        uses: dorny/, "the detection step is skipped on workflow_dispatch");
  assert.match(changes, /permissions:\n      contents: read\n      pull-requests: read\n/);
  assert.match(changes, /outputs:\n      project: \$\{\{ steps\.filter\.outputs\.project \}\}/);
  assert.ok(
    changes.includes("- '${{ env.PROJECT_PATH == '.' && '**' || format('{0}/**', env.PROJECT_PATH) }}'"),
    "filter expression differs from the contract ('**' when the path is '.')",
  );
});

test("CI: existing jobs depend on changes, and workflow_dispatch ignores the detection", () => {
  const blocks = jobBlocks(rawWorkflow(CI));
  for (const id of ["prepare", "analyze", "build-android", "build-ios"]) {
    const block = blocks.get(id);
    assert.match(block, /needs: (?:changes|\[changes, prepare\])\n/, `${id}: needs does not include changes`);
    assert.ok(block.includes("github.event_name == 'workflow_dispatch' || needs.changes.outputs.project == 'true'"), `${id}: change detection condition is missing`);
  }
  // Build jobs keep their existing if (analyze_only, enable_*) and combine it with &&
  assert.ok(blocks.get("build-android").includes("needs.prepare.outputs.enable_android == 'true'"));
  assert.ok(blocks.get("build-ios").includes("needs.prepare.outputs.enable_ios == 'true'"));
  // The result report updates the comment only on runs that are PR events with detected changes
  const report = blocks.get("report");
  assert.match(report, /if: always\(\) && github\.event_name == 'pull_request' && needs\.changes\.outputs\.project == 'true'/);
  assert.match(report, /needs: \[changes, prepare, analyze, build-android, build-ios\]/);
});

test("CI: ci-gate always runs and aggregates all existing jobs via needs", () => {
  const blocks = jobBlocks(rawWorkflow(CI));
  const gate = blocks.get("ci-gate");
  assert.ok(gate, "ci-gate job is missing");
  assert.match(gate, /if: \$\{\{ always\(\) \}\}/);
  const others = [...blocks.keys()].filter((id) => id !== "ci-gate");
  const needs = gate.match(/needs: \[([^\]]+)\]/)[1].split(",").map((s) => s.trim());
  assert.deepStrictEqual([...needs].sort(), [...others].sort(), "ci-gate needs must include all jobs");
  assert.ok(gate.includes("RESULTS: ${{ toJSON(needs.*.result) }}"));
  assert.ok(gate.includes(`grep -Eq '"(failure|cancelled)"'`));
});

test("CI: env mode — analyze, build-android and build-ios all have Prepare env file, and flutter build gets the dart-define flag", () => {
  assertLegacyEnvStepsRemoved(CI);
  assertEnvPreparedBeforeFlutterCommands(CI, ["analyze", "build-android", "build-ios"]);
  assertEveryFlutterBuildUsesDartDefine(CI, 2);
  // An existing ENV_FILE_PATH customization is still honored in the dotenv branch
  assert.ok(rawWorkflow(CI).includes(`printf '%s\\n' "$ENV_CONTENT" > "$ENV_FILE_PATH"`));
});

test("CI: FLUTTER_PROJECT_DIR — build/analyze jobs use defaults and step paths get the root prefix", () => {
  assertJobsUseFlutterDir(CI, ["analyze", "build-android", "build-ios"]);
  assert.ok(rawWorkflow(CI).includes("      - name: Setup Gradle\n        working-directory: ${{ env.FLUTTER_PROJECT_DIR }}/android\n"));
  assert.deepStrictEqual(rootRelativeStepPaths(CI), []);
  assertHashFilesScopedToFlutterRoot(CI);
});

test("CI: no unsubstituted tokens after substitution and no new actionlint warnings", { skip: !HAS_ACTIONLINT && "actionlint not available" }, () => {
  assertNoUnsubstitutedPlaceholders(CI);
  assertActionlintClean(CI);
});

// ---------------------------------------------------------------------------------------------
// PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml
// ---------------------------------------------------------------------------------------------
const FIREBASE = "PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml";

test("FIREBASE: main push paths anchor — replaced by a paths filter in a monorepo", () => {
  assertPathsAnchor(FIREBASE);
});

test("FIREBASE: FLUTTER_PROJECT_DIR and ENV_MODE tokens and substitution result", () => {
  assertWizardTokenLine(FIREBASE, '  FLUTTER_PROJECT_DIR: "."  # @wizard auto:flutter-root');
  assertWizardTokenLine(FIREBASE, '  ENV_MODE: "dart-define"  # @wizard auto:flutter-env-mode');
  assertRenderedFlutterRoot(FIREBASE);
  assertRenderedEnvMode(FIREBASE);
});

test("FIREBASE: env mode — Prepare env file in every build job, dart-define flag on appbundle", () => {
  assertLegacyEnvStepsRemoved(FIREBASE);
  assertEnvPreparedBeforeFlutterCommands(FIREBASE, ["prepare-build", "build-android"]);
  assertEveryFlutterBuildUsesDartDefine(FIREBASE, 1);
});

test("FIREBASE: FLUTTER_PROJECT_DIR handling — repo-root steps use the workspace, the rest get the prefix", () => {
  assertJobsUseFlutterDir(FIREBASE, ["prepare-build", "build-android"]);
  const blocks = jobBlocks(rawWorkflow(FIREBASE));
  // version.yml and changelog are relative to the repo root
  const prepare = blocks.get("prepare-build");
  assert.match(prepare, /name: Get current version\n        id: current_version\n        working-directory: \$\{\{ github\.workspace \}\}/);
  assert.match(prepare, /name: Generate release notes\n        id: release_notes\n        working-directory: \$\{\{ github\.workspace \}\}/);
  // The deploy job does not run Flutter — no defaults, only the AAB path is prefixed
  assert.ok(!blocks.get("deploy-firebase").includes("defaults:"));
  const text = rawWorkflow(FIREBASE);
  assert.ok(text.includes("file: ${{ env.FLUTTER_PROJECT_DIR }}/build/app/outputs/bundle/release/app-release.aab"));
  assert.ok(text.includes("path: ${{ env.FLUTTER_PROJECT_DIR }}/build/app/outputs/bundle/release/\n"));
  assert.deepStrictEqual(
    rootRelativeStepPaths(FIREBASE, ["serviceCredentialsFile: firebase-service-account.json"]),
    [],
  );
  assertHashFilesScopedToFlutterRoot(FIREBASE);
});

test("FIREBASE: no dangling web wizard guidance and the required Secrets guidance remains", () => {
  assertNoBrokenWebWizardGuide(FIREBASE);
  assert.ok(rawWorkflow(FIREBASE).includes("FIREBASE_SERVICE_ACCOUNT_JSON_BASE64"));
});

test("FIREBASE: no unsubstituted tokens after substitution and no new actionlint warnings", { skip: !HAS_ACTIONLINT && "actionlint not available" }, () => {
  assertNoUnsubstitutedPlaceholders(FIREBASE);
  assertActionlintClean(FIREBASE);
});

// ---------------------------------------------------------------------------------------------
// PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD.yaml
// ---------------------------------------------------------------------------------------------
const SELFHOSTED = "PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD.yaml";

test("SELFHOSTED: main push paths anchor — replaced by a paths filter in a monorepo", () => {
  assertPathsAnchor(SELFHOSTED);
});

test("SELFHOSTED: runs flutter build apk --release directly without fastlane", () => {
  assertNoFastlane(SELFHOSTED);
  const commands = flutterBuildCommands(rawWorkflow(SELFHOSTED));
  assert.deepStrictEqual(commands, [`flutter build apk --release ${DART_DEFINE_FLAG}`]);
  assert.ok(!rawWorkflow(SELFHOSTED).includes("fastlane build"));
});

test("SELFHOSTED: FLUTTER_PROJECT_DIR and ENV_MODE tokens and substitution result", () => {
  assertWizardTokenLine(SELFHOSTED, '  FLUTTER_PROJECT_DIR: "."  # @wizard auto:flutter-root');
  assertWizardTokenLine(SELFHOSTED, '  ENV_MODE: "dart-define"  # @wizard auto:flutter-env-mode');
  assertRenderedFlutterRoot(SELFHOSTED);
  assertRenderedEnvMode(SELFHOSTED);
});

test("SELFHOSTED: env mode — Prepare env file in build-android", () => {
  assertLegacyEnvStepsRemoved(SELFHOSTED);
  assert.ok(!rawWorkflow(SELFHOSTED).includes("Create .env file from GitHub Secret"));
  assertEnvPreparedBeforeFlutterCommands(SELFHOSTED, ["build-android"]);
  assertEveryFlutterBuildUsesDartDefine(SELFHOSTED, 1);
});

test("SELFHOSTED: artifact paths follow FLUTTER_PROJECT_DIR (mv → upload → SMB upload)", () => {
  assertJobsUseFlutterDir(SELFHOSTED, ["build-android"]);
  const text = rawWorkflow(SELFHOSTED);
  // build-android (cwd = Flutter root): moves the artifact flutter produced
  assert.ok(text.includes("mv ./build/app/outputs/flutter-apk/app-release.apk ./android/app/build/outputs/apk/release/"));
  // Artifact upload is workspace-relative, so the prefix is added
  assert.ok(text.includes("path: ${{ env.FLUTTER_PROJECT_DIR }}/android/app/build/outputs/apk/release/${{ env.APP_ARTIFACT_NAME }}-v"));
  // deploy-android downloads the artifact to its own workspace path and uploads it via SMB — independent of the Flutter root
  const deploy = jobBlocks(text).get("deploy-android");
  assert.ok(!deploy.includes("FLUTTER_PROJECT_DIR"));
  assert.ok(deploy.includes("path: android/app/build/outputs/"));
  assert.deepStrictEqual(rootRelativeStepPaths(SELFHOSTED, ["path: android/app/build/outputs/"]), []);
  assertHashFilesScopedToFlutterRoot(SELFHOSTED);
});

test("SELFHOSTED: no unsubstituted tokens after substitution and no new actionlint warnings", { skip: !HAS_ACTIONLINT && "actionlint not available" }, () => {
  assertNoUnsubstitutedPlaceholders(SELFHOSTED);
  assertActionlintClean(SELFHOSTED);
});

// ---------------------------------------------------------------------------------------------
// PROJECT-FLUTTER-ANDROID-TEST-APK.yaml
// ---------------------------------------------------------------------------------------------
const TEST_APK = "PROJECT-FLUTTER-ANDROID-TEST-APK.yaml";

test("TEST-APK: runs flutter build apk --release directly without fastlane/Fastfile branches", () => {
  assertNoFastlane(TEST_APK);
  assert.deepStrictEqual(flutterBuildCommands(rawWorkflow(TEST_APK)), [`flutter build apk --release ${DART_DEFINE_FLAG}`]);
  assert.ok(!rawWorkflow(TEST_APK).includes("android/fastlane/Fastfile"));
});

test("TEST-APK: FLUTTER_PROJECT_DIR and ENV_MODE tokens and substitution result", () => {
  assertWizardTokenLine(TEST_APK, '  FLUTTER_PROJECT_DIR: "."  # @wizard auto:flutter-root');
  assertWizardTokenLine(TEST_APK, '  ENV_MODE: "dart-define"  # @wizard auto:flutter-env-mode');
  assertRenderedFlutterRoot(TEST_APK);
  assertRenderedEnvMode(TEST_APK);
});

test("TEST-APK: env mode — Prepare env file in build-android-test", () => {
  assertLegacyEnvStepsRemoved(TEST_APK);
  assertEnvPreparedBeforeFlutterCommands(TEST_APK, ["build-android-test"]);
  assertEveryFlutterBuildUsesDartDefine(TEST_APK, 1);
  assert.ok(rawWorkflow(TEST_APK).includes(`printf '%s\\n' "$ENV_CONTENT" > "$ENV_FILE_PATH"`));
});

test("TEST-APK: FLUTTER_PROJECT_DIR handling — artifact, build info and Firebase paths are relative to the Flutter root", () => {
  assertJobsUseFlutterDir(TEST_APK, ["build-android-test"]);
  const text = rawWorkflow(TEST_APK);
  assert.ok(text.includes("      - name: Setup Gradle\n        working-directory: ${{ env.FLUTTER_PROJECT_DIR }}/android\n"));
  assert.ok(text.includes("            ${{ env.FLUTTER_PROJECT_DIR }}/android/app/build/outputs/apk/release/*.apk\n"));
  assert.ok(text.includes("            ${{ env.FLUTTER_PROJECT_DIR }}/build-info.txt\n"));
  assert.ok(text.includes("            ${{ env.FLUTTER_PROJECT_DIR }}/build-metadata.json\n"));
  assert.ok(text.includes("serviceCredentialsFile: ${{ env.FLUTTER_PROJECT_DIR }}/firebase-service-account.json"));
  assert.deepStrictEqual(rootRelativeStepPaths(TEST_APK), []);
  assertHashFilesScopedToFlutterRoot(TEST_APK);
  // prepare-test-build, which reads version.yml, still runs from the repo root
  assert.ok(!jobBlocks(text).get("prepare-test-build").includes("FLUTTER_PROJECT_DIR"));
});

test("TEST-APK: no dangling web wizard guidance and the required Secrets guidance remains", () => {
  assertNoBrokenWebWizardGuide(TEST_APK);
  assert.ok(rawWorkflow(TEST_APK).includes("RELEASE_KEYSTORE_BASE64"));
});

test("TEST-APK: no unsubstituted tokens after substitution and no new actionlint warnings", { skip: !HAS_ACTIONLINT && "actionlint not available" }, () => {
  assertNoUnsubstitutedPlaceholders(TEST_APK);
  assertActionlintClean(TEST_APK);
});

// ---------------------------------------------------------------------------------------------
// PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml
// ---------------------------------------------------------------------------------------------
const PLAYSTORE = "PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml";
const GEMFILE_FASTLANE_CHECK = `if [ -f Gemfile ] && grep -Eq "['\\"]fastlane['\\"]" Gemfile; then`;
const GENERATED_GEMFILE = `printf 'source "https://rubygems.org"\\ngem "fastlane"\\ngem "multi_json"\\n' > Gemfile`;

test("PLAYSTORE: main push paths anchor — replaced by a paths filter in a monorepo", () => {
  assertPathsAnchor(PLAYSTORE);
});

test("PLAYSTORE: env mode — Prepare env file in every build job, dart-define flag on appbundle", () => {
  assertWizardTokenLine(PLAYSTORE, '  ENV_MODE: "dart-define"  # @wizard auto:flutter-env-mode');
  assertRenderedEnvMode(PLAYSTORE);
  assertLegacyEnvStepsRemoved(PLAYSTORE);
  assertEnvPreparedBeforeFlutterCommands(PLAYSTORE, ["prepare-build", "build-android"]);
  assertEveryFlutterBuildUsesDartDefine(PLAYSTORE, 1);
});

test("PLAYSTORE: deploy mode fallback marker — the value chosen at install goes into the last fallback slot of the expression", () => {
  const marker = "  DEPLOY_MODE: ${{ github.event.inputs.deploy_mode || vars.ANDROID_DEPLOY_MODE || 'store_only' }}  # @wizard fallback:android-deploy-mode";
  assertWizardTokenLine(PLAYSTORE, marker);
  const rendered = renderWorkflow(PLAYSTORE, { androidDeployMode: "store_prepare" });
  assert.match(rendered, /^  DEPLOY_MODE: \$\{\{ github\.event\.inputs\.deploy_mode \|\| vars\.ANDROID_DEPLOY_MODE \|\| 'store_prepare' \}\}\s*$/m);
  assert.ok(!rendered.includes("@wizard fallback"), "the marker comment must be removed after substitution");
  // With no chosen value (empty string), the template default stays
  assert.ok(renderWorkflow(PLAYSTORE, { androidDeployMode: "" }).includes("|| 'store_only' }}"));
});

test("PLAYSTORE: passes ANDROID_PACKAGE_NAME (secrets first, else vars) to the fastlane step as PACKAGE_NAME", () => {
  const deploy = jobBlocks(rawWorkflow(PLAYSTORE)).get("deploy-playstore");
  assert.ok(deploy.includes("PACKAGE_NAME: ${{ secrets.ANDROID_PACKAGE_NAME || vars.ANDROID_PACKAGE_NAME }}"));
  assert.ok(deploy.indexOf("PACKAGE_NAME:") < deploy.indexOf("bundle exec fastlane deploy_internal"));
});

test("PLAYSTORE: Gemfile — uses the user's Gemfile if it has fastlane, otherwise generates the multi_json workaround Gemfile", () => {
  const text = rawWorkflow(PLAYSTORE);
  assert.ok(text.includes(GEMFILE_FASTLANE_CHECK), "fastlane presence check branch is missing");
  assert.ok(text.includes(GENERATED_GEMFILE), "multi_json workaround Gemfile generation is gone");
  assert.ok(text.indexOf(GEMFILE_FASTLANE_CHECK) < text.indexOf(GENERATED_GEMFILE));
  assert.ok(text.indexOf(GENERATED_GEMFILE) < text.indexOf("bundle install"), "bundle install must come after the branch");
});

test("PLAYSTORE: project file artifacts are uploaded/downloaded under the Flutter root in a monorepo too", () => {
  const text = rawWorkflow(PLAYSTORE);
  assert.ok(text.includes("            ${{ env.FLUTTER_PROJECT_DIR }}/pubspec.yaml\n"));
  assert.ok(text.includes("          name: project-files\n          path: ${{ env.FLUTTER_PROJECT_DIR }}\n"));
  assert.deepStrictEqual(rootRelativeStepPaths(PLAYSTORE), []);
  assertHashFilesScopedToFlutterRoot(PLAYSTORE);
});

test("PLAYSTORE: no unsubstituted tokens after substitution and no new actionlint warnings", { skip: !HAS_ACTIONLINT && "actionlint not available" }, () => {
  assertNoUnsubstitutedPlaceholders(PLAYSTORE);
  assertActionlintClean(PLAYSTORE);
});

// ---------------------------------------------------------------------------------------------
// PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml
// ---------------------------------------------------------------------------------------------
const IOS_TESTFLIGHT = "PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml";

test("IOS-TESTFLIGHT: main push paths anchor — replaced by a paths filter in a monorepo", () => {
  assertPathsAnchor(IOS_TESTFLIGHT);
});

test("IOS-TESTFLIGHT: env mode — Prepare env file in every build job, dart-define flag on flutter build ios", () => {
  assertWizardTokenLine(IOS_TESTFLIGHT, '  ENV_MODE: "dart-define"  # @wizard auto:flutter-env-mode');
  assertRenderedEnvMode(IOS_TESTFLIGHT);
  assertLegacyEnvStepsRemoved(IOS_TESTFLIGHT);
  assertEnvPreparedBeforeFlutterCommands(IOS_TESTFLIGHT, ["prepare-build", "build-ios"]);
  assertEveryFlutterBuildUsesDartDefine(IOS_TESTFLIGHT, 1);
  // For security, .env is not shipped in the artifact; build-ios recreates it from secrets
  const prepare = jobBlocks(rawWorkflow(IOS_TESTFLIGHT)).get("prepare-build");
  assert.ok(!prepare.includes("ENV_FILE_PATH }}\n            ios/Flutter"), "the project-files artifact must not contain .env");
});

test("IOS-TESTFLIGHT: deploy mode fallback marker — the value chosen at install goes into the last fallback slot of the expression", () => {
  assertWizardTokenLine(IOS_TESTFLIGHT, "  DEPLOY_MODE: ${{ github.event.inputs.deploy_mode || vars.IOS_DEPLOY_MODE || 'store_only' }}  # @wizard fallback:ios-deploy-mode");
  const rendered = renderWorkflow(IOS_TESTFLIGHT, { iosDeployMode: "store_submit" });
  assert.match(rendered, /^  DEPLOY_MODE: \$\{\{ github\.event\.inputs\.deploy_mode \|\| vars\.IOS_DEPLOY_MODE \|\| 'store_submit' \}\}\s*$/m);
  assert.ok(!rendered.includes("@wizard fallback"));
  assert.ok(renderWorkflow(IOS_TESTFLIGHT, { iosDeployMode: "" }).includes("|| 'store_only' }}"));
});

// Prints a catalog message in the given language through the installed CLI entry point.
function catalogMessage(key, lang) {
  const script = join(resolvePayloadRoot(), "scripts", "messages.py");
  const r = spawnSync("python3", [script, "get", key], { encoding: "utf8", env: { ...process.env, PROJECT_AUTO_WIZARD_LANG: lang } });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout.trim();
}

test("IOS-TESTFLIGHT: stops with a clear message when ExportOptions.plist still has placeholders", () => {
  const verify = rawWorkflow(IOS_TESTFLIGHT).match(/- name: Verify ExportOptions\.plist\n[\s\S]*?(?=\n      - name: )/)[0];
  assert.ok(verify.includes("grep -Eq '__[A-Z][A-Z0-9_]*__' ExportOptions.plist"));
  // The message comes from the catalog, so it follows the configured language (English by default)
  assert.ok(verify.includes("m ios_testflight.plist_placeholders"));
  assert.match(catalogMessage("ios_testflight.plist_placeholders", "en"), /unfilled placeholders/);
  assert.ok(catalogMessage("ios_testflight.plist_placeholders", "ko").includes("채워지지 않은 플레이스홀더"));
  assert.ok(verify.includes("exit 1"));
  // A __TOKEN__ literal left on an executable line in the workflow body makes post-install validation (scanUnsubstituted) report a false 'unsubstituted' finding
  assertNoUnsubstitutedPlaceholders(IOS_TESTFLIGHT);
});

test("IOS-TESTFLIGHT: Gemfile — uses the user's Gemfile if it has fastlane, otherwise generates the multi_json workaround Gemfile", () => {
  const text = rawWorkflow(IOS_TESTFLIGHT);
  const check = `if [ -f Gemfile ] && grep -Eq "['\\"]fastlane['\\"]" Gemfile; then`;
  const generated = `printf 'source "https://rubygems.org"\\ngem "fastlane"\\ngem "multi_json"\\n' > Gemfile`;
  assert.ok(text.includes(check));
  assert.ok(text.includes(generated));
  assert.ok(text.indexOf(check) < text.indexOf(generated));
  assert.ok(text.indexOf(generated) < text.indexOf("bundle install\n          m flutter_a.fastlane_installed_bundler"));
});

test("IOS-TESTFLIGHT: project file artifacts are uploaded/downloaded under the Flutter root", () => {
  const text = rawWorkflow(IOS_TESTFLIGHT);
  assert.ok(text.includes("            ${{ env.FLUTTER_PROJECT_DIR }}/ios/Flutter/Secrets.xcconfig\n"));
  assert.ok(text.includes("          name: project-files\n          path: ${{ env.FLUTTER_PROJECT_DIR }}\n"));
  assert.deepStrictEqual(rootRelativeStepPaths(IOS_TESTFLIGHT), []);
  assertHashFilesScopedToFlutterRoot(IOS_TESTFLIGHT);
});

test("IOS-TESTFLIGHT: no dangling web wizard guidance and the required Secrets guidance remains", () => {
  assertNoBrokenWebWizardGuide(IOS_TESTFLIGHT);
  const text = rawWorkflow(IOS_TESTFLIGHT);
  for (const secret of ["APPLE_CERTIFICATE_BASE64", "APP_STORE_CONNECT_API_KEY_BASE64", "IOS_PROVISIONING_PROFILE_NAME"]) {
    assert.ok(text.includes(secret), secret);
  }
});

test("IOS-TESTFLIGHT: no new actionlint warnings", { skip: !HAS_ACTIONLINT && "actionlint not available" }, () => {
  assertActionlintClean(IOS_TESTFLIGHT);
});

// ---------------------------------------------------------------------------------------------
// PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml
// ---------------------------------------------------------------------------------------------
const IOS_TEST_TESTFLIGHT = "PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml";

test("IOS-TEST-TESTFLIGHT: FLUTTER_PROJECT_DIR and ENV_MODE tokens and substitution result", () => {
  assertWizardTokenLine(IOS_TEST_TESTFLIGHT, '  FLUTTER_PROJECT_DIR: "."  # @wizard auto:flutter-root');
  assertWizardTokenLine(IOS_TEST_TESTFLIGHT, '  ENV_MODE: "dart-define"  # @wizard auto:flutter-env-mode');
  assertRenderedFlutterRoot(IOS_TEST_TESTFLIGHT);
  assertRenderedEnvMode(IOS_TEST_TESTFLIGHT);
});

test("IOS-TEST-TESTFLIGHT: env mode — Prepare env file only in build-ios-test, which runs flutter build", () => {
  assertLegacyEnvStepsRemoved(IOS_TEST_TESTFLIGHT);
  assertEnvPreparedBeforeFlutterCommands(IOS_TEST_TESTFLIGHT, ["build-ios-test"]);
  assertEveryFlutterBuildUsesDartDefine(IOS_TEST_TESTFLIGHT, 1);
  // The prepare job does not build — .env is not shipped in the artifact
  const prepare = jobBlocks(rawWorkflow(IOS_TEST_TESTFLIGHT)).get("prepare-test-build");
  assert.ok(!prepare.includes("ENV_FILE_PATH"));
});

test("IOS-TEST-TESTFLIGHT: FLUTTER_PROJECT_DIR handling — job default path, workspace-relative steps and artifact paths", () => {
  assertJobsUseFlutterDir(IOS_TEST_TESTFLIGHT, ["prepare-test-build", "build-ios-test", "deploy-testflight-test"]);
  const blocks = jobBlocks(rawWorkflow(IOS_TEST_TESTFLIGHT));
  const prepare = blocks.get("prepare-test-build");
  assert.match(prepare, /name: Set test build version\n        id: test_version\n        working-directory: \$\{\{ github\.workspace \}\}/);
  assert.match(prepare, /name: Generate release notes\n        id: release_notes\n        working-directory: \$\{\{ github\.workspace \}\}/);
  const text = rawWorkflow(IOS_TEST_TESTFLIGHT);
  assert.ok(text.includes("            ${{ env.FLUTTER_PROJECT_DIR }}/ios/build/ipa/*.ipa\n"));
  assert.ok(text.includes("            ${{ env.FLUTTER_PROJECT_DIR }}/build-metadata.json\n"));
  assert.ok(text.includes("          name: ios-ipa\n          path: ${{ env.FLUTTER_PROJECT_DIR }}/ios/build/ipa/\n"));
  assert.ok(text.includes('find "$GITHUB_WORKSPACE/${FLUTTER_PROJECT_DIR}/ios/build/ipa"'));
  assert.ok(text.includes('if [ -f "$GITHUB_WORKSPACE/final_release_notes.txt" ]'));
  assert.ok(text.includes("      - name: Install Fastlane\n        working-directory: ${{ env.FLUTTER_PROJECT_DIR }}/ios\n"));
  assert.deepStrictEqual(rootRelativeStepPaths(IOS_TEST_TESTFLIGHT), []);
  assertHashFilesScopedToFlutterRoot(IOS_TEST_TESTFLIGHT);
});

test("IOS-TEST-TESTFLIGHT: Gemfile — uses the user's Gemfile if it has fastlane, otherwise generates the multi_json workaround Gemfile", () => {
  const text = rawWorkflow(IOS_TEST_TESTFLIGHT);
  const check = `if [ -f Gemfile ] && grep -Eq "['\\"]fastlane['\\"]" Gemfile; then`;
  const generated = `printf 'source "https://rubygems.org"\\ngem "fastlane"\\ngem "multi_json"\\n' > Gemfile`;
  assert.ok(text.includes(check));
  assert.ok(text.includes(generated));
  assert.ok(text.indexOf(check) < text.indexOf(generated));
});

test("IOS-TEST-TESTFLIGHT: no dangling web wizard guidance and the required Secrets guidance remains", () => {
  assertNoBrokenWebWizardGuide(IOS_TEST_TESTFLIGHT);
  const text = rawWorkflow(IOS_TEST_TESTFLIGHT);
  for (const secret of ["APPLE_CERTIFICATE_BASE64", "APP_STORE_CONNECT_API_KEY_BASE64", "IOS_PROVISIONING_PROFILE_NAME"]) {
    assert.ok(text.includes(secret), secret);
  }
});

test("IOS-TEST-TESTFLIGHT: no unsubstituted tokens after substitution and no new actionlint warnings", { skip: !HAS_ACTIONLINT && "actionlint not available" }, () => {
  assertNoUnsubstitutedPlaceholders(IOS_TEST_TESTFLIGHT);
  assertActionlintClean(IOS_TEST_TESTFLIGHT);
});

// ---- language-following output (test APK, TestFlight, build trigger) -------------------------
const LANGUAGE_AWARE = [
  "PROJECT-FLUTTER-ANDROID-TEST-APK.yaml",
  "PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml",
  "PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml",
  "PROJECT-FLUTTER-APP-BUILD-TRIGGER.yaml",
];

function catalogDump(lang) {
  const script = join(resolvePayloadRoot(), "scripts", "messages.py");
  const r = spawnSync("python3", [script, "dump", ""], { encoding: "utf8", env: { ...process.env, PROJECT_AUTO_WIZARD_LANG: lang } });
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test("language-aware Flutter workflows: every message key they use exists in both catalogs", () => {
  const en = catalogDump("en");
  const ko = catalogDump("ko");
  for (const filename of LANGUAGE_AWARE) {
    const text = rawWorkflow(filename);
    // bash: `m area.key ...`, github-script: msg('area.key'...), dump prefix in the Load messages step
    const keys = new Set([
      ...[...text.matchAll(/\bm ((?:apk_test|ios_testflight|ios_test_tf|app_trigger)\.\w+)/g)].map((m) => m[1]),
      ...[...text.matchAll(/msg\('((?:apk_test|ios_test_tf|app_trigger)\.\w+)'/g)].map((m) => m[1]),
    ].filter((key) => !key.endsWith("_"))); // keys ending in "_" are built dynamically (checked below)
    assert.ok(keys.size > 0, `${filename}: no catalog keys found`);
    for (const key of keys) {
      assert.ok(key in en, `${filename}: ${key} is missing from the English catalog`);
      assert.ok(key in ko, `${filename}: ${key} is missing from the Korean catalog`);
    }
    // Progress table rows are built as row('<step>', '<status>'): both parts must resolve to catalog keys
    const area = /apk_test\./.test(text) ? "apk_test" : /ios_test_tf\./.test(text) ? "ios_test_tf" : null;
    if (area) {
      for (const m of text.matchAll(/\brow\('(\w+)', '(\w+)'/g)) {
        assert.ok(`${area}.step_${m[1]}` in en, `${filename}: ${area}.step_${m[1]} is missing`);
        assert.ok(`${area}.st_${m[2]}` in en, `${filename}: ${area}.st_${m[2]} is missing`);
      }
    }
  }
});

test("language-aware Flutter workflows: no Korean text is left", () => {
  for (const filename of LANGUAGE_AWARE) {
    const offenders = rawWorkflow(filename)
      .split("\n")
      .filter((line) => /[가-힣]/.test(line));
    assert.deepStrictEqual(offenders, [], `${filename}: Korean text belongs in the message catalog`);
  }
});

test("language-aware Flutter workflows: English catalog has no Hangul and Korean keeps the original wording", () => {
  const en = catalogDump("en");
  const ko = catalogDump("ko");
  for (const [key, value] of Object.entries(en)) {
    if (!/^(apk_test|ios_testflight|ios_test_tf|app_trigger)\./.test(key)) continue;
    assert.ok(!/[가-힣]/.test(value), `${key}: English message contains Hangul`);
    assert.ok(key in ko, `${key}: missing from the Korean catalog`);
  }
  // Spot checks that the Korean texts are the previous ones
  assert.strictEqual(ko["app_trigger.hint_pushed"], "1. 브랜치가 원격 저장소에 push되었는지 확인하세요");
  assert.strictEqual(ko["ios_test_tf.log_ipa_failed"], "❌ 진행 상황 업데이트 완료: IPA 빌드 실패");
  assert.strictEqual(en["ios_test_tf.log_ipa_failed"], "❌ Progress update complete: IPA build failed");
});
