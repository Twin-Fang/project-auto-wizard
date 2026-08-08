import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const files = readdirSync("payload/workflows", { recursive: true })
  .filter((f) => /\.ya?ml$/.test(String(f)))
  .map((f) => join("payload/workflows", String(f)));

// Task 10에서 타입별 워크플로우 이식 완료 — common 4 + secret-backup 1 + 타입별 22
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
    assert.ok(!readFileSync(f, "utf8").includes("version_manager.sh"), f);
  }
});

// ---------------------------------------------------------------
// #40: heredoc이 블록 스칼라(`run: |`)를 이탈해 YAML 파싱이 깨지는
// 회귀를 막는 가드. 완전한 YAML 파서가 아니라, "블록 스칼라 본문이
// 컬럼 0 등으로 갑자기 얕아지는" 이번 버그 클래스에 특화된 검사다.
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

test("findBlockScalarIndentationViolations는 컬럼 0으로 이탈한 heredoc 본문을 잡아낸다", () => {
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

test("findBlockScalarIndentationViolations는 올바르게 들여쓴 heredoc에 오탐하지 않는다", () => {
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

test("findBlockScalarIndentationViolations는 같은 스텝의 형제 키(if: 등)로 끝나는 블록 스칼라에 오탐하지 않는다", () => {
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

test("payload 워크플로우 전체에 블록 스칼라 이탈(#40) 회귀가 없다", () => {
  for (const f of files) {
    const violations = findBlockScalarIndentationViolations(readFileSync(f, "utf8"));
    if (violations.length > 0) {
      const first = violations[0];
      assert.fail(`${f}:${first.line} — 블록 스칼라 본문이 이탈했습니다: ${first.content}`);
    }
  }
});

// ---------------------------------------------------------------
// AUTO-CHANGELOG-CONTROL: summary engine chain rewrite (Task 8)
// ---------------------------------------------------------------
const changelogPath = join(
  "payload/workflows/common",
  "PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml"
);

test("AUTO-CHANGELOG-CONTROL exists in payload", () => {
  assert.ok(files.includes(changelogPath), `${changelogPath} missing`);
});

test("AUTO-CHANGELOG-CONTROL grants models: read", () => {
  const body = readFileSync(changelogPath, "utf8");
  assert.ok(body.includes("models: read"));
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

test("AUTO-CHANGELOG-CONTROL의 AI 요약 step은 조건 없이 항상 실행된다", () => {
  const body = readFileSync(changelogPath, "utf8");
  const lines = body.split("\n");
  const idx = lines.findIndex((l) => l.includes("Generate summary with the AI engine chain"));
  assert.ok(idx >= 0, "AI 요약 step이 있어야 한다");
  const stepBlock = lines.slice(idx, idx + 4).join("\n");
  assert.ok(!/^\s*if:/m.test(stepBlock), "AI 요약 step에는 게이팅 조건이 없어야 한다");
});

test("AUTO-CHANGELOG-CONTROL에 PR body 폴링 대기 로직이 없다", () => {
  const body = readFileSync(changelogPath, "utf8");
  assert.ok(!body.includes("MAX_POLLS"), "폴링 루프가 제거되어야 한다");
  assert.ok(!body.includes("POLL_INTERVAL"), "폴링 간격이 제거되어야 한다");
});

// ---------------------------------------------------------------
// RELEASE-PUBLISH: tag + GitHub Release, dual-mode (Task 9)
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

// #35: Release는 WORKFLOW_PAT으로 발행해야 후속 워크플로우(npm 배포)가 트리거된다.
// GITHUB_TOKEN이 만든 이벤트는 GitHub 정책상 다른 워크플로우를 깨우지 못한다.
// PAT이 없는 사용자 레포에서도 릴리스 자체는 동작해야 하므로 폴백이 필수다.
test("RELEASE-PUBLISH의 Release 생성은 WORKFLOW_PAT 폴백을 쓴다", () => {
  const p = join("payload", "workflows", "common", "PROJECT-COMMON-RELEASE-PUBLISH.yaml");
  const text = readFileSync(p, "utf8");
  const idx = text.indexOf("name: Create GitHub Release");
  assert.ok(idx > -1, "Create GitHub Release 스텝을 찾지 못했습니다");
  const block = text.slice(idx, idx + 700);
  assert.match(
    block,
    /GH_TOKEN:\s*\$\{\{\s*secrets\.WORKFLOW_PAT\s*\|\|\s*github\.token\s*\}\}/,
    "Release 생성 스텝이 WORKFLOW_PAT 폴백을 쓰지 않습니다",
  );
});

// 도그푸딩 레포 규칙 — payload를 고치면 이 레포의 .github 사본도 함께 고쳐야 한다.
test("RELEASE-PUBLISH의 도그푸딩 사본도 같은 토큰 폴백을 쓴다", () => {
  const text = readFileSync(join(".github", "workflows", "PROJECT-COMMON-RELEASE-PUBLISH.yaml"), "utf8");
  const idx = text.indexOf("name: Create GitHub Release");
  assert.ok(idx > -1, "Create GitHub Release 스텝을 찾지 못했습니다");
  const block = text.slice(idx, idx + 700);
  assert.match(block, /GH_TOKEN:\s*\$\{\{\s*secrets\.WORKFLOW_PAT\s*\|\|\s*github\.token\s*\}\}/);
});

// ---------------------------------------------------------------
// PROJECT-FLUTTER-CI: Android 빌드는 서명 불필요한 debug APK를 사용해야
// 한다 (issue #38 — keystore 없이 --release 실행 시 release 서명이
// 구성된 프로젝트에서 항상 빌드 실패)
// ---------------------------------------------------------------
const flutterCiPath = join(
  "payload/workflows/flutter",
  "PROJECT-FLUTTER-CI.yaml"
);

test("PROJECT-FLUTTER-CI exists in payload", () => {
  assert.ok(files.includes(flutterCiPath), `${flutterCiPath} missing`);
});

test("PROJECT-FLUTTER-CI의 Android 빌드는 --release를 사용하지 않는다", () => {
  const body = readFileSync(flutterCiPath, "utf8");
  assert.ok(
    !body.includes("flutter build apk --release"),
    "keystore 없이 --release로 빌드하면 release 서명이 구성된 프로젝트에서 항상 실패한다"
  );
});

test("PROJECT-FLUTTER-CI의 Android 빌드는 --debug를 사용한다", () => {
  const body = readFileSync(flutterCiPath, "utf8");
  assert.ok(body.includes("flutter build apk --debug"));
});

// ---------------------------------------------------------------
// #39: build-ios 잡에 iOS 플랫폼 SDK 설치 스텝이 없어 "Platform Not
// Installed"로 빌드 실패 — Select Xcode version 직후 설치 스텝 필요.
// ---------------------------------------------------------------
test("FLUTTER-CI의 build-ios 잡은 Select Xcode version 직후 iOS 플랫폼을 설치한다", () => {
  const body = readFileSync(flutterCiPath, "utf8");
  const selectXcodeIdx = body.indexOf("name: Select Xcode version");
  const installPlatformIdx = body.indexOf("name: Install iOS device platform");
  assert.ok(selectXcodeIdx > -1, "Select Xcode version 스텝을 찾지 못했습니다");
  assert.ok(installPlatformIdx > -1, "Install iOS device platform 스텝을 찾지 못했습니다");
  assert.ok(
    installPlatformIdx > selectXcodeIdx,
    "Install iOS device platform 스텝이 Select Xcode version 스텝보다 먼저 나오면 안 됩니다",
  );
});

test("FLUTTER-CI의 iOS 플랫폼 설치 스텝은 xcodebuild -downloadPlatform iOS를 실행한다", () => {
  const body = readFileSync(flutterCiPath, "utf8");
  assert.ok(body.includes("xcodebuild -downloadPlatform iOS"));
});

// ---------------------------------------------------------------
// #42: build_runner를 쓰는 프로젝트(freezed/riverpod_generator/drift/
// json_serializable)가 CI에서 생성 파일(*.g.dart/*.freezed.dart) 부재로
// 실패하지 않도록, flutter pub get 직후 조건부 코드 생성이 있어야 한다.
// ---------------------------------------------------------------
function assertBuildRunnerGuardFollowsEveryPubGet(path) {
  const body = readFileSync(path, "utf8");
  const pattern = /flutter pub get\n( *)if grep -q "build_runner" pubspec\.yaml; then\n *dart run build_runner build --delete-conflicting-outputs\n *fi/g;
  const matches = body.match(pattern) || [];
  const pubGetCount = (body.match(/flutter pub get/g) || []).length;
  assert.strictEqual(
    matches.length,
    pubGetCount,
    `${path}: flutter pub get가 ${pubGetCount}곳인데 build_runner 조건부 코드 생성 가드는 ${matches.length}곳뿐입니다`
  );
  assert.ok(pubGetCount > 0, `${path}: flutter pub get이 존재해야 합니다`);
}

const flutterFirebaseCicdPath = join(
  "payload/workflows/flutter",
  "PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml"
);

test("PROJECT-FLUTTER-ANDROID-FIREBASE-CICD: flutter pub get 직후 build_runner 조건부 코드 생성이 있다 (#42)", () => {
  assertBuildRunnerGuardFollowsEveryPubGet(flutterFirebaseCicdPath);
});

const flutterPlaystoreCicdPath = join(
  "payload/workflows/flutter",
  "PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml"
);

test("PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD: flutter pub get 직후 build_runner 조건부 코드 생성이 있다 (#42)", () => {
  assertBuildRunnerGuardFollowsEveryPubGet(flutterPlaystoreCicdPath);
});

const flutterSelfhostedCicdPath = join(
  "payload/workflows/flutter",
  "PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD.yaml"
);

test("PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD: flutter pub get 직후 build_runner 조건부 코드 생성이 있다 (#42)", () => {
  assertBuildRunnerGuardFollowsEveryPubGet(flutterSelfhostedCicdPath);
});

const flutterTestApkPath = join(
  "payload/workflows/flutter",
  "PROJECT-FLUTTER-ANDROID-TEST-APK.yaml"
);

test("PROJECT-FLUTTER-ANDROID-TEST-APK: flutter pub get 직후 build_runner 조건부 코드 생성이 있다 (#42)", () => {
  assertBuildRunnerGuardFollowsEveryPubGet(flutterTestApkPath);
});

test("PROJECT-FLUTTER-CI: flutter pub get 직후 build_runner 조건부 코드 생성이 있다 (#42)", () => {
  assertBuildRunnerGuardFollowsEveryPubGet(flutterCiPath);
});

const flutterIosTestflightPath = join(
  "payload/workflows/flutter",
  "PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml"
);

test("PROJECT-FLUTTER-IOS-TESTFLIGHT: flutter pub get 직후 build_runner 조건부 코드 생성이 있다 (#42)", () => {
  assertBuildRunnerGuardFollowsEveryPubGet(flutterIosTestflightPath);
});

const flutterIosTestTestflightPath = join(
  "payload/workflows/flutter",
  "PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml"
);

test("PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT: flutter pub get 직후 build_runner 조건부 코드 생성이 있다 (#42)", () => {
  assertBuildRunnerGuardFollowsEveryPubGet(flutterIosTestTestflightPath);
});
