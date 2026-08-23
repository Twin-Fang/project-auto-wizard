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
    const body = readFileSync(f, "utf8");
    assert.ok(!body.includes("version_manager.sh"), f);
    assert.ok(!body.includes("truncate_release_notes.sh"), f);
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

// issue #61 — 게이트가 닫혀 릴리스가 스킵되는 것 자체는 정상이지만, version.yml이
// 최신 태그보다 앞선 채 스킵되면 그 버전은 npm에 영영 닿지 않는다. 0.1.26~0.1.31
// 여섯 버전이 모든 워크플로우가 초록불인 채로 이렇게 사라졌다.
test("RELEASE-PUBLISH fails loudly when version.yml has drifted ahead of the newest tag (issue #61)", () => {
  const body = readFileSync(releasePath, "utf8");
  assert.ok(body.includes("Drift guard"), "drift guard block missing");
  assert.ok(body.includes("git tag --list 'v*' --sort=-v:refname"), "newest tag lookup missing");
  assert.ok(body.includes("GITHUB_STEP_SUMMARY"), "job summary warning missing");
  // 조용히 넘어가지 않는다는 것이 이 가드의 전부다 — exit 1이 빠지면 의미가 없다
  assert.ok(/::error::[^\n]*ahead of the newest tag/.test(body), "error annotation missing");
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

// ---------------------------------------------------------------
// ISSUE-HELPER: 외부 Chuseok22/github-issue-helper 액션 의존 제거,
// 로컬 payload 기능으로 흡수 (issue #68)
// ---------------------------------------------------------------
const issueHelperPath = join("payload/workflows/common", "PROJECT-COMMON-ISSUE-HELPER.yaml");

test("PROJECT-COMMON-ISSUE-HELPER exists in payload", () => {
  assert.ok(files.includes(issueHelperPath), `${issueHelperPath} missing`);
});

test("PROJECT-COMMON-ISSUE-HELPER는 외부 액션을 호출하지 않는다", () => {
  const body = readFileSync(issueHelperPath, "utf8");
  // 출처 표기 주석(Chuseok22/github-issue-helper 언급)은 남아도 된다 — 여기서 금지하는 것은
  // 그 액션을 "호출"(uses:)하는 것이지, 출처를 "언급"하는 것이 아니다.
  assert.ok(!body.includes("uses: Chuseok22/github-issue-helper"));
  assert.ok(body.includes("python3 .github/scripts/issue_helper.py run"));
});

test("PROJECT-COMMON-ISSUE-HELPER의 create_branch 기본값은 false다", () => {
  const body = readFileSync(issueHelperPath, "utf8");
  assert.match(body, /ISSUE_HELPER_CREATE_BRANCH:\s*"false"/);
});

test("PROJECT-COMMON-ISSUE-HELPER의 base_branch는 하드코딩된 브랜치명이 아니라 플레이스홀더를 쓴다", () => {
  const body = readFileSync(issueHelperPath, "utf8");
  assert.match(body, /ISSUE_HELPER_BASE_BRANCH:\s*"\{\{MAIN_BRANCH\}\}"/);
});

test("PROJECT-COMMON-ISSUE-HELPER는 issues opened/edited에 반응한다", () => {
  const body = readFileSync(issueHelperPath, "utf8");
  assert.match(body, /on:\s*\n\s*issues:\s*\n\s*types:\s*\[opened,\s*edited]/);
});

// ---------------------------------------------------------------
// #50: FLUTTER_ROOT가 subosito/flutter-action의 SDK 경로 export와
// 이름이 충돌해 아티팩트 경로가 SDK 디렉토리를 가리키고, 업로드가
// 비어 배포 잡이 실패한다. FLUTTER_PROJECT_DIR로 개명하고, 경로가
// 비었을 때 즉시 실패하도록 모든 upload-artifact 스텝에
// if-no-files-found: error를 강제한다.
// ---------------------------------------------------------------
function assertFlutterRootRenamedToProjectDir(path) {
  const body = readFileSync(path, "utf8");
  assert.ok(
    !body.includes("FLUTTER_ROOT"),
    `${path}: FLUTTER_ROOT가 남아있으면 subosito/flutter-action의 SDK 경로 export와 충돌합니다`
  );
  assert.ok(
    /^\s*FLUTTER_PROJECT_DIR:\s*"\."/m.test(body),
    `${path}: FLUTTER_PROJECT_DIR env 정의를 찾지 못했습니다`
  );
}

function assertUploadArtifactStepsFailOnMissingFiles(path) {
  const body = readFileSync(path, "utf8");
  const steps = body.split(/\n(?=      - name: )/);
  const uploadSteps = steps.filter((s) => s.includes("uses: actions/upload-artifact"));
  assert.ok(uploadSteps.length > 0, `${path}: upload-artifact 스텝을 찾지 못했습니다`);
  for (const step of uploadSteps) {
    const stepName = (step.match(/^ {6}- name: (.+)$/m) || [, "(이름 없음)"])[1];
    assert.ok(
      step.includes("if-no-files-found: error"),
      `${path}: '${stepName}' 스텝에 if-no-files-found: error가 없습니다`
    );
  }
}

test("PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD: FLUTTER_ROOT가 FLUTTER_PROJECT_DIR로 개명되었다 (#50)", () => {
  assertFlutterRootRenamedToProjectDir(flutterPlaystoreCicdPath);
});

test("PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD: upload-artifact 스텝 전부가 if-no-files-found: error를 지정한다 (#50)", () => {
  assertUploadArtifactStepsFailOnMissingFiles(flutterPlaystoreCicdPath);
});

test("PROJECT-FLUTTER-IOS-TESTFLIGHT: FLUTTER_ROOT가 FLUTTER_PROJECT_DIR로 개명되었다 (#50)", () => {
  assertFlutterRootRenamedToProjectDir(flutterIosTestflightPath);
});

test("PROJECT-FLUTTER-IOS-TESTFLIGHT: upload-artifact 스텝 전부가 if-no-files-found: error를 지정한다 (#50)", () => {
  assertUploadArtifactStepsFailOnMissingFiles(flutterIosTestflightPath);
});

// ---------------------------------------------------------------
// 도그푸딩 사본 — payload를 고치면 .github 사본도 함께 고쳐야 한다.
// ---------------------------------------------------------------
test("이 레포에는 더 이상 외부 Chuseok22/github-issue-helper 액션 호출이 없다", () => {
  const selfHostedFiles = readdirSync(".github/workflows")
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => join(".github/workflows", f));
  for (const f of selfHostedFiles) {
    const body = readFileSync(f, "utf8");
    // 출처 표기 주석은 허용 — uses:로 실제 호출하는 것만 금지
    assert.ok(!body.includes("uses: Chuseok22/github-issue-helper"), `${f}: 외부 액션 호출이 남아있음`);
  }
});

test("도그푸딩 사본 PROJECT-COMMON-ISSUE-HELPER는 {{MAIN_BRANCH}}가 main으로 치환되어 있다", () => {
  const text = readFileSync(join(".github", "workflows", "PROJECT-COMMON-ISSUE-HELPER.yaml"), "utf8");
  assert.ok(!text.includes("{{MAIN_BRANCH}}"), "플레이스홀더가 치환되지 않았습니다");
  assert.match(text, /ISSUE_HELPER_BASE_BRANCH:\s*"main"/);
});

test("도그푸딩 사본 issue_helper.py는 payload 원본과 동일하다", () => {
  const payloadSrc = readFileSync(join("payload", "scripts", "issue_helper.py"), "utf8");
  const selfHostedSrc = readFileSync(join(".github", "scripts", "issue_helper.py"), "utf8");
  assert.strictEqual(selfHostedSrc, payloadSrc);
});

// ---------------------------------------------------------------
// #90: WORKFLOW_PAT 없이도 릴리스 파이프라인 후속 트리거가 끊기지 않도록,
// GITHUB_TOKEN으로도 항상 새 실행을 만드는 workflow_dispatch 신호를 세 지점에
// 추가했다. 아래 테스트는 그 신호 발행 로직이 실제로 존재하는지,
// WORKFLOW_PAT 폴백이 아닌 기본 토큰을 쓰는지, payload와 self-copy가
// (의도된 1곳 제외) 동기화됐는지를 고정한다.
// ---------------------------------------------------------------

// 잡 정의(`\n  wait-for-merge-and-trigger-release:`)를 찾는다 — 헤더 주석에도
// 같은 이름이 산문으로 등장하므로 plain indexOf는 주석을 먼저 잡아버린다.
const WAIT_JOB_DEFINITION = "\n  wait-for-merge-and-trigger-release:";

test("AUTO-CHANGELOG-CONTROL: automerge 병합 완료를 폴링해 RELEASE-PUBLISH를 트리거하는 잡이 changelog-and-merge와 분리되어 있다 (#90)", () => {
  const body = readFileSync(changelogPath, "utf8");
  assert.ok(body.includes("needs: changelog-and-merge"), "changelog-and-merge에 의존하는 별도 잡이 있어야 한다 (같은 잡 내 폴링은 데드락 위험)");
  assert.ok(body.includes("gh workflow run PROJECT-COMMON-RELEASE-PUBLISH.yaml"), "RELEASE-PUBLISH를 workflow_dispatch로 트리거해야 한다 (실제 파일명 PROJECT-COMMON-RELEASE-PUBLISH.yaml과 일치해야 함)");
  const idx = body.indexOf(WAIT_JOB_DEFINITION);
  assert.ok(idx > -1, "wait-for-merge-and-trigger-release 잡 정의를 찾지 못했습니다");
  const jobBlock = body.slice(idx, idx + 2000);
  assert.ok(
    /GH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/.test(jobBlock),
    "WORKFLOW_PAT 폴백이 아니라 기본 github.token을 써야 한다 (GITHUB_TOKEN으로도 workflow_dispatch는 항상 트리거된다)"
  );
});

test("도그푸딩 사본 AUTO-CHANGELOG-CONTROL에도 동일한 병합 대기 + 트리거 잡이 있다 (#90)", () => {
  const body = readFileSync(join(".github", "workflows", "PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml"), "utf8");
  assert.ok(body.includes("needs: changelog-and-merge"));
  assert.ok(body.includes("gh workflow run PROJECT-COMMON-RELEASE-PUBLISH.yaml --ref main"));
  const idx = body.indexOf(WAIT_JOB_DEFINITION);
  assert.ok(idx > -1, "wait-for-merge-and-trigger-release 잡 정의를 찾지 못했습니다");
  const jobBlock = body.slice(idx, idx + 2000);
  assert.ok(/GH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/.test(jobBlock));
});

test("VERSION-CONTROL: safety-net bump이 push된 경우에만 RELEASE-PUBLISH를 트리거한다 (#90, 이슈 #61 자동 복구)", () => {
  const p = join("payload", "workflows", "common", "PROJECT-COMMON-VERSION-CONTROL.yaml");
  const body = readFileSync(p, "utf8");
  assert.ok(/^\s*actions:\s*write\s*$/m.test(body), "workflow_dispatch 호출을 위한 actions: write 권한이 필요하다");
  assert.ok(body.includes("gh workflow run PROJECT-COMMON-RELEASE-PUBLISH.yaml"));
  const idx = body.indexOf("name: Trigger RELEASE-PUBLISH");
  assert.ok(idx > -1, "Trigger RELEASE-PUBLISH 스텝을 찾지 못했습니다");
  const stepBlock = body.slice(idx, idx + 300);
  assert.ok(
    stepBlock.includes("steps.commit_push.outputs.pushed == 'true'"),
    "실제로 push가 일어난 경우에만(변경 없음일 때는 스킵) 트리거해야 한다"
  );
});

test("도그푸딩 사본 VERSION-CONTROL에도 동일한 조건부 트리거가 있다 (#90)", () => {
  const body = readFileSync(join(".github", "workflows", "PROJECT-COMMON-VERSION-CONTROL.yaml"), "utf8");
  assert.ok(/^\s*actions:\s*write\s*$/m.test(body));
  assert.ok(body.includes("gh workflow run PROJECT-COMMON-RELEASE-PUBLISH.yaml --ref main"));
  const idx = body.indexOf("name: Trigger RELEASE-PUBLISH");
  assert.ok(idx > -1);
  const stepBlock = body.slice(idx, idx + 300);
  assert.ok(stepBlock.includes("steps.commit_push.outputs.pushed == 'true'"));
});

// NPM-PUBLISH.yaml은 payload에 없는 이 저장소 전용 워크플로우다 — payload
// 템플릿에 그 호출이 섞여 들어가면 마법사로 설치된 모든 레포가 존재하지
// 않는 워크플로우를 매 릴리스마다 호출 시도하게 된다 (fable5 독립 검토, #90).
test("RELEASE-PUBLISH payload 템플릿에는 NPM-PUBLISH 호출이 없다 (#90) — 사용자 레포에는 그 워크플로우가 없다", () => {
  const body = readFileSync(releasePath, "utf8");
  // 의도된 비대칭을 설명하는 헤더 주석은 "NPM-PUBLISH"를 언급해도 된다 —
  // 여기서 금지하는 것은 그 워크플로우를 실제로 "호출"하는 것이다.
  assert.ok(!body.includes("gh workflow run NPM-PUBLISH"), "payload/workflows/common/PROJECT-COMMON-RELEASE-PUBLISH.yaml에 NPM-PUBLISH 호출이 있으면 안 된다");
});

test("도그푸딩 사본 RELEASE-PUBLISH는 Release 생성 직후 NPM-PUBLISH를 workflow_dispatch로 트리거한다 (#90)", () => {
  const body = readFileSync(join(".github", "workflows", "PROJECT-COMMON-RELEASE-PUBLISH.yaml"), "utf8");
  assert.ok(body.includes("gh workflow run NPM-PUBLISH.yaml"), "NPM-PUBLISH를 workflow_dispatch로 호출해야 한다");
  assert.ok(/^\s*actions:\s*write\s*$/m.test(body), "workflow_dispatch 호출을 위한 actions: write 권한이 필요하다");
});
