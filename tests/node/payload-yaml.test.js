import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const files = readdirSync("payload/workflows", { recursive: true })
  .filter((f) => /\.ya?ml$/.test(String(f)))
  .map((f) => join("payload/workflows", String(f)));

// Per-type workflow port complete: 6 common + 23 per type
test("payload workflows exist", () => assert.ok(files.length >= 20, `expected >= 20, got ${files.length}`));

test("no hardcoded branch literals outside placeholders", () => {
  for (const f of files) {
    const body = readFileSync(f, "utf8");
    for (const line of body.split("\n")) {
      // strip placeholder tokens, then scan the remainder — a line may
      // legitimately contain a placeholder AND an illegal hardcoded branch
      const stripped = line
        .replaceAll("{{MAIN_BRANCH}}", "")
        .replaceAll("{{DEVELOP_BRANCH}}", "");
      if (/branches:.*["'\[]\s*(develop|main|master)\b|head\.ref\s*==\s*'(develop|main)'/.test(stripped))
        assert.fail(`${f}: hardcoded branch → use placeholder: ${line}`);
    }
  }
});

test("git diff --stat truncation always preserves the trailing summary line", () => {
  for (const f of files) {
    const body = readFileSync(f, "utf8");
    for (const line of body.split("\n")) {
      if (line.includes("diff --stat") && line.includes("head -50")) {
        assert.fail(`${f}: 'head -50' after 'git diff --stat' drops the aggregate summary line — use head -49 + tail -1: ${line}`);
      }
    }
  }
});

test("no .sh script references in payload", () => {
  for (const f of files) {
    const body = readFileSync(f, "utf8");
    assert.ok(!body.includes("version_manager.sh"), f);
    assert.ok(!body.includes("truncate_release_notes.sh"), f);
  }
});

// ---------------------------------------------------------------
// Guard against the regression where a heredoc escapes its block scalar (`run: |`)
// and breaks YAML parsing. Not a full YAML parser: it targets this bug class,
// where the block scalar body suddenly dedents to column 0 or similar.
// ---------------------------------------------------------------
const COMMENT_LINE = /^\s*#/;
const STRUCTURAL_RESUME = /^\s*(-\s|[A-Za-z_][\w./-]*:(\s|$))/;

function findBlockScalarIndentationViolations(text) {
  const lines = text.split("\n");
  const violations = [];
  let keyIndent = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const indent = line.match(/^ */)[0].length;

    if (keyIndent !== null) {
      if (indent > keyIndent) continue;
      const looksStructural =
        COMMENT_LINE.test(line) || (indent > 0 && STRUCTURAL_RESUME.test(line));
      if (!looksStructural) violations.push({ line: i + 1, content: line });
      keyIndent = null;
    }

    if (keyIndent === null && !line.trim().startsWith("#")) {
      const opener = line.match(/^(\s*)\S.*:\s*[|>][+-]?\s*$/);
      if (opener) keyIndent = opener[1].length;
    }
  }

  return violations;
}

test("findBlockScalarIndentationViolations catches a heredoc body that escaped to column 0", () => {
  const fixture = [
    "jobs:",
    "  test:",
    "    steps:",
    "      - name: Broken step",
    "        run: |",
    '          echo "start"',
    "storeFile=oops",
    '          echo "end"',
  ].join("\n");
  const violations = findBlockScalarIndentationViolations(fixture);
  assert.strictEqual(violations.length, 1);
  assert.strictEqual(violations[0].line, 7);
});

test("findBlockScalarIndentationViolations does not false-positive on a properly indented heredoc", () => {
  const fixture = [
    "jobs:",
    "  test:",
    "    steps:",
    "      - name: OK step",
    "        run: |",
    "          cat > file.txt << EOF",
    "          content line",
    "          EOF",
    "      - name: Next step",
    "        run: echo done",
  ].join("\n");
  assert.strictEqual(findBlockScalarIndentationViolations(fixture).length, 0);
});

test("findBlockScalarIndentationViolations does not false-positive on a block scalar ending at a sibling key of the same step (e.g. if:)", () => {
  const fixture = [
    "jobs:",
    "  test:",
    "    steps:",
    "      - name: Step with if after run",
    "        run: |",
    "          echo hi",
    "        if: always()",
  ].join("\n");
  assert.strictEqual(findBlockScalarIndentationViolations(fixture).length, 0);
});

test("no payload workflow has a block scalar escape regression", () => {
  for (const f of files) {
    const violations = findBlockScalarIndentationViolations(readFileSync(f, "utf8"));
    if (violations.length > 0) {
      const first = violations[0];
      assert.fail(`${f}:${first.line} — block scalar body escaped its indentation: ${first.content}`);
    }
  }
});

// ---------------------------------------------------------------
// AUTO-CHANGELOG-CONTROL: summary engine chain rewrite
// ---------------------------------------------------------------
const changelogPath = join(
  "payload/workflows/common",
  "PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml"
);

test("AUTO-CHANGELOG-CONTROL exists in payload", () => {
  assert.ok(files.includes(changelogPath), `${changelogPath} missing`);
});

test("AUTO-CHANGELOG-CONTROL grants copilot-requests: write (GitHub Models retired)", () => {
  const body = readFileSync(changelogPath, "utf8");
  assert.ok(body.includes("copilot-requests: write"));
  assert.ok(!body.includes("models: read"));
});

test("AUTO-CHANGELOG-CONTROL uses the ai-summary engine chain", () => {
  const body = readFileSync(changelogPath, "utf8");
  assert.ok(body.includes("ai-summary"));
});

test("AUTO-CHANGELOG-CONTROL passes PR title via --pr-title env (no inline interpolation)", () => {
  const body = readFileSync(changelogPath, "utf8");
  assert.ok(body.includes("--pr-title"));
  assert.ok(body.includes("PR_TITLE: ${{ github.event.pull_request.title }}"));
  assert.ok(!body.includes('--pr-title "${{'), "PR title must not be inline-interpolated into the shell");
});

test("the AI summary step in AUTO-CHANGELOG-CONTROL always runs unconditionally", () => {
  const body = readFileSync(changelogPath, "utf8");
  const lines = body.split("\n");
  const idx = lines.findIndex((l) => l.includes("Generate summary with the AI engine chain"));
  assert.ok(idx >= 0, "the AI summary step must exist");
  const stepBlock = lines.slice(idx, idx + 4).join("\n");
  assert.ok(!/^\s*if:/m.test(stepBlock), "the AI summary step must have no gating condition");
});

test("AUTO-CHANGELOG-CONTROL has no PR body polling wait logic", () => {
  const body = readFileSync(changelogPath, "utf8");
  assert.ok(!body.includes("MAX_POLLS"), "the polling loop must be removed");
  assert.ok(!body.includes("POLL_INTERVAL"), "the polling interval must be removed");
});

test("AUTO-CHANGELOG-CONTROL collects issues merged into develop for release PR auto-close", () => {
  const body = readFileSync(changelogPath, "utf8");
  assert.ok(body.includes("collect-issue-closes"));
  assert.ok(body.includes("gh pr list --state merged --base {{DEVELOP_BRANCH}}"));
});

test("AUTO-CHANGELOG-CONTROL also cleans up the issue-collection temp files before committing release docs (prevents leaking them into the commit on failure)", () => {
  const body = readFileSync(changelogPath, "utf8");
  const idx = body.indexOf("Commit release docs to the PR head branch");
  assert.ok(idx > -1, "Commit release docs step not found");
  const stepBlock = body.slice(idx, idx + 1100);
  assert.ok(stepBlock.includes("commit_shas.txt"), "commit_shas.txt is missing from the cleanup list");
  assert.ok(stepBlock.includes("merged_prs.json"), "merged_prs.json is missing from the cleanup list");
});

// ---------------------------------------------------------------
// RELEASE-PUBLISH: tag + GitHub Release, dual-mode
// ---------------------------------------------------------------
const releasePath = join(
  "payload/workflows/common",
  "PROJECT-COMMON-RELEASE-PUBLISH.yaml"
);

test("RELEASE-PUBLISH exists in payload", () => {
  assert.ok(files.includes(releasePath), `${releasePath} missing`);
});

test("RELEASE-PUBLISH creates a GitHub Release", () => {
  const body = readFileSync(releasePath, "utf8");
  assert.ok(body.includes("gh release create"));
});

test("RELEASE-PUBLISH supports trunk-based mode", () => {
  const body = readFileSync(releasePath, "utf8");
  assert.ok(body.includes("trunk-based"));
});

test("RELEASE-PUBLISH guards against [skip ci] commits", () => {
  const body = readFileSync(releasePath, "utf8");
  assert.ok(body.includes("contains(github.event.head_commit.message, '[skip ci]')"));
});

test("RELEASE-PUBLISH merges GitHub generate-notes into the release notes", () => {
  const body = readFileSync(releasePath, "utf8");
  assert.ok(body.includes("generate-notes"));
});

// A closed gate skipping the release is itself normal, but if version.yml
// stays ahead of the latest tag while skipped, that version never reaches npm. Versions 0.1.26 to 0.1.31
// vanished this way while every workflow stayed green.
test("RELEASE-PUBLISH fails loudly when version.yml has drifted ahead of the newest tag", () => {
  const body = readFileSync(releasePath, "utf8");
  assert.ok(body.includes("Drift guard"), "drift guard block missing");
  assert.ok(body.includes("git tag --list 'v*' --sort=-v:refname"), "newest tag lookup missing");
  assert.ok(body.includes("GITHUB_STEP_SUMMARY"), "job summary warning missing");
  // The whole point of this guard is not to pass silently — without exit 1 it is meaningless
  assert.ok(body.includes('echo "::error::$(m wf_release.drift_error'), "error annotation missing");
  // The wording lives in the message catalog; the English text must still say what went wrong
  const catalog = readFileSync(join("payload", "scripts", "messages.py"), "utf8");
  assert.ok(/"wf_release\.drift_error": "[^\n]*ahead of the newest tag/.test(catalog), "error wording missing from the catalog");
});

// ---------------------------------------------------------------
// RELEASE-PUBLISH trunk-based semver_auto + diff-stat parity with
// AUTO-CHANGELOG-CONTROL (final review fix)
// ---------------------------------------------------------------
test("RELEASE-PUBLISH reads semver_auto option from version.yml", () => {
  const body = readFileSync(releasePath, "utf8");
  assert.ok(body.includes("semver_auto:"));
  assert.ok(body.includes("steps.semver_options.outputs.semver_auto"));
});

test("RELEASE-PUBLISH calls classify-bump and passes --bump to increment when semver_auto is on", () => {
  const body = readFileSync(releasePath, "utf8");
  assert.ok(body.includes("changelog_manager.py classify-bump --commits-file commits.txt"));
  assert.ok(body.includes('version_manager.py increment --bump "$BUMP"'));
});

test("RELEASE-PUBLISH's classify-bump step has the AI env block", () => {
  const body = readFileSync(releasePath, "utf8");
  const bumpStepIndex = body.indexOf("Trunk-based version bump + changelog");
  const bumpStepBody = body.slice(bumpStepIndex, bumpStepIndex + 400);
  assert.ok(bumpStepBody.includes("AI_API_KEY"));
  assert.ok(bumpStepBody.includes("AI_API_BASE_URL"));
  assert.ok(bumpStepBody.includes("AI_MODEL"));
  assert.ok(bumpStepBody.includes("GITHUB_TOKEN"));
});

test("RELEASE-PUBLISH passes --diff-stat-file to ai-summary", () => {
  const body = readFileSync(releasePath, "utf8");
  assert.ok(body.includes("--diff-stat-file diff_stat.txt"));
});

// The Release must be published with WORKFLOW_PAT so that downstream workflows (npm publish) are triggered.
// Events created by GITHUB_TOKEN cannot wake other workflows per GitHub policy.
// The release itself must still work in user repos without a PAT, so the fallback is required.
test("RELEASE-PUBLISH creates the Release with a WORKFLOW_PAT fallback", () => {
  const p = join("payload", "workflows", "common", "PROJECT-COMMON-RELEASE-PUBLISH.yaml");
  const text = readFileSync(p, "utf8");
  const idx = text.indexOf("name: Create GitHub Release");
  assert.ok(idx > -1, "Create GitHub Release step not found");
  const block = text.slice(idx, idx + 700);
  assert.match(
    block,
    /GH_TOKEN:\s*\$\{\{\s*secrets\.WORKFLOW_PAT\s*\|\|\s*github\.token\s*\}\}/,
    "Release creation step does not use the WORKFLOW_PAT fallback",
  );
});

// Dogfooding repo rule: when the payload changes, the .github copy must change too.
test("the dogfooding copy of RELEASE-PUBLISH uses the same token fallback", () => {
  const text = readFileSync(join(".github", "workflows", "PROJECT-COMMON-RELEASE-PUBLISH.yaml"), "utf8");
  const idx = text.indexOf("name: Create GitHub Release");
  assert.ok(idx > -1, "Create GitHub Release step not found");
  const block = text.slice(idx, idx + 700);
  assert.match(block, /GH_TOKEN:\s*\$\{\{\s*secrets\.WORKFLOW_PAT\s*\|\|\s*github\.token\s*\}\}/);
});

// ---------------------------------------------------------------
// PROJECT-FLUTTER-CI: the Android build must use a debug APK, which needs no
// signing (running --release without a keystore always fails the build in
// projects with release signing configured)
// ---------------------------------------------------------------
const flutterCiPath = join(
  "payload/workflows/flutter",
  "PROJECT-FLUTTER-CI.yaml"
);

test("PROJECT-FLUTTER-CI exists in payload", () => {
  assert.ok(files.includes(flutterCiPath), `${flutterCiPath} missing`);
});

test("the Android build in PROJECT-FLUTTER-CI does not use --release", () => {
  const body = readFileSync(flutterCiPath, "utf8");
  assert.ok(
    !body.includes("flutter build apk --release"),
    "building with --release without a keystore always fails in projects with release signing configured"
  );
});

test("the Android build in PROJECT-FLUTTER-CI uses --debug", () => {
  const body = readFileSync(flutterCiPath, "utf8");
  assert.ok(body.includes("flutter build apk --debug"));
});

// ---------------------------------------------------------------
// The build-ios job has no iOS platform SDK install step, so the build fails with "Platform Not
// Installed" — an install step is needed right after Select Xcode version.
// ---------------------------------------------------------------
test("the build-ios job in FLUTTER-CI installs the iOS platform right after Select Xcode version", () => {
  const body = readFileSync(flutterCiPath, "utf8");
  const selectXcodeIdx = body.indexOf("name: Select Xcode version");
  const installPlatformIdx = body.indexOf("name: Install iOS device platform");
  assert.ok(selectXcodeIdx > -1, "Select Xcode version step not found");
  assert.ok(installPlatformIdx > -1, "Install iOS device platform step not found");
  assert.ok(
    installPlatformIdx > selectXcodeIdx,
    "the Install iOS device platform step must not come before the Select Xcode version step",
  );
});

test("the iOS platform install step in FLUTTER-CI runs xcodebuild -downloadPlatform iOS", () => {
  const body = readFileSync(flutterCiPath, "utf8");
  assert.ok(body.includes("xcodebuild -downloadPlatform iOS"));
});

// ---------------------------------------------------------------
// So that projects using build_runner (freezed/riverpod_generator/drift/
// json_serializable) do not fail in CI for missing generated files (*.g.dart/*.freezed.dart),
// conditional code generation must run right after flutter pub get.
// ---------------------------------------------------------------
function assertBuildRunnerGuardFollowsEveryPubGet(path) {
  const body = readFileSync(path, "utf8");
  const pattern = /flutter pub get\n( *)if grep -q "build_runner" pubspec\.yaml; then\n *dart run build_runner build --delete-conflicting-outputs\n *fi/g;
  const matches = body.match(pattern) || [];
  const pubGetCount = (body.match(/flutter pub get/g) || []).length;
  assert.strictEqual(
    matches.length,
    pubGetCount,
    `${path}: ${pubGetCount} flutter pub get call(s) but only ${matches.length} build_runner conditional codegen guard(s)`
  );
  assert.ok(pubGetCount > 0, `${path}: flutter pub get must exist`);
}

const flutterFirebaseCicdPath = join(
  "payload/workflows/flutter",
  "PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml"
);

test("PROJECT-FLUTTER-ANDROID-FIREBASE-CICD: conditional build_runner codegen runs right after flutter pub get", () => {
  assertBuildRunnerGuardFollowsEveryPubGet(flutterFirebaseCicdPath);
});

const flutterPlaystoreCicdPath = join(
  "payload/workflows/flutter",
  "PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml"
);

test("PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD: conditional build_runner codegen runs right after flutter pub get", () => {
  assertBuildRunnerGuardFollowsEveryPubGet(flutterPlaystoreCicdPath);
});

const flutterSelfhostedCicdPath = join(
  "payload/workflows/flutter",
  "PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD.yaml"
);

test("PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD: conditional build_runner codegen runs right after flutter pub get", () => {
  assertBuildRunnerGuardFollowsEveryPubGet(flutterSelfhostedCicdPath);
});

const flutterTestApkPath = join(
  "payload/workflows/flutter",
  "PROJECT-FLUTTER-ANDROID-TEST-APK.yaml"
);

test("PROJECT-FLUTTER-ANDROID-TEST-APK: conditional build_runner codegen runs right after flutter pub get", () => {
  assertBuildRunnerGuardFollowsEveryPubGet(flutterTestApkPath);
});

test("PROJECT-FLUTTER-CI: conditional build_runner codegen runs right after flutter pub get", () => {
  assertBuildRunnerGuardFollowsEveryPubGet(flutterCiPath);
});

const flutterIosTestflightPath = join(
  "payload/workflows/flutter",
  "PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml"
);

test("PROJECT-FLUTTER-IOS-TESTFLIGHT: conditional build_runner codegen runs right after flutter pub get", () => {
  assertBuildRunnerGuardFollowsEveryPubGet(flutterIosTestflightPath);
});

const flutterIosTestTestflightPath = join(
  "payload/workflows/flutter",
  "PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml"
);

test("PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT: conditional build_runner codegen runs right after flutter pub get", () => {
  assertBuildRunnerGuardFollowsEveryPubGet(flutterIosTestTestflightPath);
});

// ---------------------------------------------------------------
// ISSUE-HELPER: drop the dependency on the external Chuseok22/github-issue-helper action,
// absorbing it into a local payload feature
// ---------------------------------------------------------------
const issueHelperPath = join("payload/workflows/common", "PROJECT-COMMON-ISSUE-HELPER.yaml");

test("PROJECT-COMMON-ISSUE-HELPER exists in payload", () => {
  assert.ok(files.includes(issueHelperPath), `${issueHelperPath} missing`);
});

test("PROJECT-COMMON-ISSUE-HELPER does not call an external action", () => {
  const body = readFileSync(issueHelperPath, "utf8");
  // A source-attribution comment (mentioning Chuseok22/github-issue-helper) may remain — what is forbidden here is
  // "calling" that action (uses:), not "mentioning" its origin.
  assert.ok(!body.includes("uses: Chuseok22/github-issue-helper"));
  assert.ok(body.includes("python3 .github/scripts/issue_helper.py run"));
});

test("PROJECT-COMMON-ISSUE-HELPER defaults create_branch to false", () => {
  const body = readFileSync(issueHelperPath, "utf8");
  assert.match(body, /ISSUE_HELPER_CREATE_BRANCH:\s*"false"/);
});

test("PROJECT-COMMON-ISSUE-HELPER uses a placeholder for base_branch, not a hardcoded branch name", () => {
  const body = readFileSync(issueHelperPath, "utf8");
  assert.match(body, /ISSUE_HELPER_BASE_BRANCH:\s*"\{\{MAIN_BRANCH\}\}"/);
});

test("PROJECT-COMMON-ISSUE-HELPER reacts to issues opened/edited", () => {
  const body = readFileSync(issueHelperPath, "utf8");
  assert.match(body, /on:\s*\n\s*issues:\s*\n\s*types:\s*\[opened,\s*edited]/);
});

test("PROJECT-COMMON-ISSUE-HELPER pins permissions.contents to write", () => {
  const body = readFileSync(issueHelperPath, "utf8");
  // Creating a branch via the git/refs API when ISSUE_HELPER_CREATE_BRANCH="true" needs write,
  // and users can also turn this on by hand after install without rerunning the wizard, so conditional escalation is impossible — always pinned to write.
  assert.match(body, /permissions:\s*\n\s*issues:\s*write\s*\n\s*contents:\s*write/);
});

test("the dogfooding copy of PROJECT-COMMON-ISSUE-HELPER also has permissions.contents: write", () => {
  const body = readFileSync(join(".github", "workflows", "PROJECT-COMMON-ISSUE-HELPER.yaml"), "utf8");
  assert.match(body, /permissions:\s*\n\s*issues:\s*write\s*\n\s*contents:\s*write/);
});

// ---------------------------------------------------------------
// FLUTTER_ROOT collides in name with the SDK path export of subosito/flutter-action,
// so the artifact path points at the SDK directory, the upload comes up
// empty, and the deploy job fails. Rename it to FLUTTER_PROJECT_DIR and force
// if-no-files-found: error on every upload-artifact step so that an empty
// path fails immediately.
// ---------------------------------------------------------------
function assertFlutterRootRenamedToProjectDir(path) {
  const body = readFileSync(path, "utf8");
  assert.ok(
    !body.includes("FLUTTER_ROOT"),
    `${path}: a leftover FLUTTER_ROOT collides with the SDK path export of subosito/flutter-action`
  );
  assert.ok(
    /^\s*FLUTTER_PROJECT_DIR:\s*"\."/m.test(body),
    `${path}: FLUTTER_PROJECT_DIR env definition not found`
  );
}

function assertUploadArtifactStepsFailOnMissingFiles(path) {
  const body = readFileSync(path, "utf8");
  const steps = body.split(/\n(?=      - name: )/);
  const uploadSteps = steps.filter((s) => s.includes("uses: actions/upload-artifact"));
  assert.ok(uploadSteps.length > 0, `${path}: no upload-artifact step found`);
  for (const step of uploadSteps) {
    const stepName = (step.match(/^ {6}- name: (.+)$/m) || [, "(unnamed)"])[1];
    assert.ok(
      step.includes("if-no-files-found: error"),
      `${path}: step '${stepName}' is missing if-no-files-found: error`
    );
  }
}

test("PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD: FLUTTER_ROOT was renamed to FLUTTER_PROJECT_DIR", () => {
  assertFlutterRootRenamedToProjectDir(flutterPlaystoreCicdPath);
});

test("PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD: every upload-artifact step sets if-no-files-found: error", () => {
  assertUploadArtifactStepsFailOnMissingFiles(flutterPlaystoreCicdPath);
});

test("PROJECT-FLUTTER-IOS-TESTFLIGHT: FLUTTER_ROOT was renamed to FLUTTER_PROJECT_DIR", () => {
  assertFlutterRootRenamedToProjectDir(flutterIosTestflightPath);
});

test("PROJECT-FLUTTER-IOS-TESTFLIGHT: every upload-artifact step sets if-no-files-found: error", () => {
  assertUploadArtifactStepsFailOnMissingFiles(flutterIosTestflightPath);
});

// ---------------------------------------------------------------
// Dogfooding copy — when the payload changes, the .github copy must change too.
// ---------------------------------------------------------------
test("this repo no longer calls the external Chuseok22/github-issue-helper action", () => {
  const selfHostedFiles = readdirSync(".github/workflows")
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => join(".github/workflows", f));
  for (const f of selfHostedFiles) {
    const body = readFileSync(f, "utf8");
    // Source-attribution comments are allowed — only actual calls via uses: are forbidden
    assert.ok(!body.includes("uses: Chuseok22/github-issue-helper"), `${f}: external action call still present`);
  }
});

test("the dogfooding copy of PROJECT-COMMON-ISSUE-HELPER has {{MAIN_BRANCH}} substituted and develop as the base branch", () => {
  const text = readFileSync(join(".github", "workflows", "PROJECT-COMMON-ISSUE-HELPER.yaml"), "utf8");
  assert.ok(!text.includes("{{MAIN_BRANCH}}"), "placeholder was not substituted");
  assert.match(text, /ISSUE_HELPER_BASE_BRANCH:\s*"develop"/);
});

test("the dogfooding copy of issue_helper.py is identical to the payload original", () => {
  const payloadSrc = readFileSync(join("payload", "scripts", "issue_helper.py"), "utf8");
  const selfHostedSrc = readFileSync(join(".github", "scripts", "issue_helper.py"), "utf8");
  assert.strictEqual(selfHostedSrc, payloadSrc);
});

// ---------------------------------------------------------------
// So that downstream release pipeline triggers do not break without WORKFLOW_PAT,
// workflow_dispatch signals, which always create a new run even with GITHUB_TOKEN, were added at three points.
// The tests below pin that the signal-emitting logic actually exists,
// that it uses the default token rather than the WORKFLOW_PAT fallback, and that the payload and self-copy
// are in sync (except for one intended spot).
// ---------------------------------------------------------------

// Find the job definition (`\n  wait-for-merge-and-trigger-release:`) — the same name
// also appears as prose in the header comment, so a plain indexOf would hit the comment first.
const WAIT_JOB_DEFINITION = "\n  wait-for-merge-and-trigger-release:";

test("AUTO-CHANGELOG-CONTROL: the job that polls for automerge completion and triggers RELEASE-PUBLISH is separate from changelog-and-merge", () => {
  const body = readFileSync(changelogPath, "utf8");
  assert.ok(body.includes("needs: changelog-and-merge"), "a separate job depending on changelog-and-merge must exist (polling within the same job risks deadlock)");
  assert.ok(body.includes("gh workflow run PROJECT-COMMON-RELEASE-PUBLISH.yaml"), "RELEASE-PUBLISH must be triggered via workflow_dispatch (must match the actual filename PROJECT-COMMON-RELEASE-PUBLISH.yaml)");
  const idx = body.indexOf(WAIT_JOB_DEFINITION);
  assert.ok(idx > -1, "wait-for-merge-and-trigger-release job definition not found");
  const jobBlock = body.slice(idx, idx + 2000);
  assert.ok(
    /GH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/.test(jobBlock),
    "must use the default github.token, not the WORKFLOW_PAT fallback (workflow_dispatch always triggers even with GITHUB_TOKEN)"
  );
});

test("the dogfooding copy of AUTO-CHANGELOG-CONTROL has the same merge-wait + trigger job", () => {
  const body = readFileSync(join(".github", "workflows", "PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml"), "utf8");
  assert.ok(body.includes("needs: changelog-and-merge"));
  assert.ok(body.includes("gh workflow run PROJECT-COMMON-RELEASE-PUBLISH.yaml --ref main"));
  const idx = body.indexOf(WAIT_JOB_DEFINITION);
  assert.ok(idx > -1, "wait-for-merge-and-trigger-release job definition not found");
  const jobBlock = body.slice(idx, idx + 2000);
  assert.ok(/GH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/.test(jobBlock));
});

test("the dogfooding copy of AUTO-CHANGELOG-CONTROL has the same issue-collection step", () => {
  const body = readFileSync(join(".github", "workflows", "PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml"), "utf8");
  assert.ok(body.includes("collect-issue-closes"));
  assert.ok(body.includes("gh pr list --state merged --base develop"));
});

test("the dogfooding copy of AUTO-CHANGELOG-CONTROL also cleans up the issue-collection temp files before committing release docs", () => {
  const body = readFileSync(join(".github", "workflows", "PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml"), "utf8");
  const idx = body.indexOf("Commit release docs to the PR head branch");
  assert.ok(idx > -1);
  const stepBlock = body.slice(idx, idx + 1100);
  assert.ok(stepBlock.includes("commit_shas.txt"));
  assert.ok(stepBlock.includes("merged_prs.json"));
});

test("VERSION-CONTROL: triggers RELEASE-PUBLISH only when the safety-net bump was pushed", () => {
  const p = join("payload", "workflows", "common", "PROJECT-COMMON-VERSION-CONTROL.yaml");
  const body = readFileSync(p, "utf8");
  assert.ok(/^\s*actions:\s*write\s*$/m.test(body), "actions: write permission is required for the workflow_dispatch call");
  assert.ok(body.includes("gh workflow run PROJECT-COMMON-RELEASE-PUBLISH.yaml"));
  const idx = body.indexOf("name: Trigger RELEASE-PUBLISH");
  assert.ok(idx > -1, "Trigger RELEASE-PUBLISH step not found");
  const stepBlock = body.slice(idx, idx + 300);
  assert.ok(
    stepBlock.includes("steps.commit_push.outputs.pushed == 'true'"),
    "must trigger only when a push actually happened (skip when there is no change)"
  );
});

test("the dogfooding copy of VERSION-CONTROL has the same conditional trigger", () => {
  const body = readFileSync(join(".github", "workflows", "PROJECT-COMMON-VERSION-CONTROL.yaml"), "utf8");
  assert.ok(/^\s*actions:\s*write\s*$/m.test(body));
  assert.ok(body.includes("gh workflow run PROJECT-COMMON-RELEASE-PUBLISH.yaml --ref main"));
  const idx = body.indexOf("name: Trigger RELEASE-PUBLISH");
  assert.ok(idx > -1);
  const stepBlock = body.slice(idx, idx + 300);
  assert.ok(stepBlock.includes("steps.commit_push.outputs.pushed == 'true'"));
});

// NPM-PUBLISH.yaml is a workflow specific to this repository and absent from the payload — if a call to it
// leaked into the payload template, every repo installed via the wizard would try on each release to call a
// workflow that does not exist.
test("the RELEASE-PUBLISH payload template has no NPM-PUBLISH call — user repos do not have that workflow", () => {
  const body = readFileSync(releasePath, "utf8");
  // The header comment explaining the intended asymmetry may mention "NPM-PUBLISH" —
  // what is forbidden here is actually "calling" that workflow.
  assert.ok(!body.includes("gh workflow run NPM-PUBLISH"), "payload/workflows/common/PROJECT-COMMON-RELEASE-PUBLISH.yaml must not contain an NPM-PUBLISH call");
});

test("the dogfooding copy of RELEASE-PUBLISH triggers NPM-PUBLISH via workflow_dispatch right after creating the Release", () => {
  const body = readFileSync(join(".github", "workflows", "PROJECT-COMMON-RELEASE-PUBLISH.yaml"), "utf8");
  assert.ok(body.includes("gh workflow run NPM-PUBLISH.yaml"), "NPM-PUBLISH must be called via workflow_dispatch");
  assert.ok(/^\s*actions:\s*write\s*$/m.test(body), "actions: write permission is required for the workflow_dispatch call");
});
