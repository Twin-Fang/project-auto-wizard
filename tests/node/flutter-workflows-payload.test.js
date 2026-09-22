// #131: Flutter 워크플로우 7종(CI·FIREBASE·SELFHOSTED·TEST-APK·PLAYSTORE·IOS-TESTFLIGHT·IOS-TEST-TESTFLIGHT)의
// FLUTTER_PROJECT_DIR 정비, 환경변수 모드(dart-define|dotenv), fastlane 정리, main push paths 앵커를 고정한다.
// 파일별 Task가 이 파일에 케이스를 이어서 추가한다 — 아래 헬퍼를 재사용한다.
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

// 설치 경로와 같은 치환 파이프라인(makeSrcText → substituteEnv)을 거친 결과.
// resolvers 이름은 src/core/detect-fs.js makeResolvers와 같다 (계약 §4).
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
// actionlint는 레포 의존성이 아니다 — PATH에 없으면 해당 테스트를 건너뛴다.
// @wizard 마커·{{MAIN_BRANCH}}는 치환 후 임시 파일에 대해 돌린다(위 renderWorkflow).
// 이 변경 이전의 파일이 이미 내던 finding(actionlint 1.7.12 + shellcheck 0.11.0 실측)은 제외하고
// 신규 finding만 실패로 본다:
//   - shellcheck info/style: SC2001 SC2015 SC2086 SC2129 SC2181 (따옴표 없는 변수·개별 리다이렉트 등)
//   - PROJECT-FLUTTER-CI.yaml의 github.head_ref inline 사용 경고
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

// ---- 구조 헬퍼 ------------------------------------------------------------------------------
// "jobs:" 아래 최상위 job 블록을 Map<jobId, 블록 텍스트>로 나눈다.
function jobBlocks(text) {
  const jobsSection = text.slice(text.search(/^jobs:\s*$/m));
  const blocks = new Map();
  for (const block of jobsSection.split(/^(?=  [a-z][\w-]*:\s*$)/m).slice(1)) {
    blocks.set(block.match(/^  ([\w-]+):/)[1], block);
  }
  return blocks;
}

// `flutter build ...` 명령을 줄 이음(\)까지 이어 붙여 한 줄씩 돌려준다. echo 안의 문구는 제외.
function flutterBuildCommands(text) {
  return text
    .replace(/\\\r?\n\s*/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^flutter build \w+/.test(line));
}

function assertEveryFlutterBuildUsesDartDefine(filename, expectedBuildCount) {
  const commands = flutterBuildCommands(rawWorkflow(filename));
  assert.strictEqual(commands.length, expectedBuildCount, `${filename}: flutter build 호출 수\n  ${commands.join("\n  ")}`);
  for (const command of commands) {
    assert.ok(command.endsWith(DART_DEFINE_FLAG), `${filename}: dart-define 플래그 누락 → ${command}`);
  }
}

// flutter build 또는 build_runner를 실행하는 job은 그보다 앞에 'Prepare env file' 스텝이 있어야 한다
// (GITHUB_ENV는 job 단위라 job마다 필요하다).
function assertEnvPreparedBeforeFlutterCommands(filename, expectedJobIds) {
  const text = rawWorkflow(filename);
  const preparing = [];
  for (const [id, block] of jobBlocks(text)) {
    const firstUse = block.search(/^\s*(?:flutter build \w+|dart run build_runner)/m);
    if (firstUse === -1) continue;
    const prepareAt = block.indexOf("- name: Prepare env file");
    assert.ok(prepareAt !== -1 && prepareAt < firstUse, `${filename}: job '${id}'에 빌드보다 앞선 'Prepare env file' 스텝이 없습니다`);
    preparing.push(id);
  }
  assert.deepStrictEqual(preparing, expectedJobIds, `${filename}: Prepare env file이 필요한 job 목록`);
}

function assertLegacyEnvStepsRemoved(filename) {
  const text = rawWorkflow(filename);
  assert.ok(!/- name: Create \.env file/.test(text), `${filename}: 'Create .env file' 스텝이 남아 있습니다`);
  assert.ok(!/- name: Ensure \.env file exists/.test(text), `${filename}: 'Ensure .env file exists' 스텝이 남아 있습니다`);
  assert.ok(!text.includes("cat << 'EOF' > ${{ env.ENV_FILE_PATH }}"), `${filename}: heredoc로 .env를 쓰는 코드가 남아 있습니다`);
}

// 최상위 env의 @wizard 토큰 줄이 계약 표기 그대로 있는가
function assertWizardTokenLine(filename, line) {
  assert.ok(rawWorkflow(filename).split("\n").includes(line), `${filename}: 다음 줄이 없습니다 → ${line}`);
}

// job에 defaults.run.working-directory가 걸려 있는가
function assertJobsUseFlutterDir(filename, jobIds) {
  const blocks = jobBlocks(rawWorkflow(filename));
  for (const id of jobIds) {
    assert.ok(blocks.has(id), `${filename}: job '${id}'가 없습니다`);
    assert.match(
      blocks.get(id),
      /^    defaults:\n      run:\n        working-directory: \$\{\{ env\.FLUTTER_PROJECT_DIR \}\}\n/m,
      `${filename}: job '${id}'에 defaults.run.working-directory가 없습니다`,
    );
  }
}

// run: 이 아닌 스텝 경로(path/file/serviceCredentialsFile, working-directory)가 레포 루트 기준으로 남아 있지 않은가.
// defaults.run.working-directory는 run 스텝에만 적용되고, 스텝 단위 working-directory와 `with:` 경로는 워크스페이스 기준이라
// ${{ env.FLUTTER_PROJECT_DIR }}/ 를 직접 붙여야 한다. allow: 의도적으로 레포 루트 기준인 줄(trim한 원문).
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

// 글로브가 레포 전체를 훑지 않고 Flutter 루트 아래로 한정되는가 (모노레포에서 다른 폴더의 pubspec.lock·build.gradle이 캐시 키를 흔들지 않게)
function assertHashFilesScopedToFlutterRoot(filename) {
  const text = rawWorkflow(filename);
  assert.ok(!text.includes("hashFiles('**/"), `${filename}: hashFiles가 레포 전체를 훑습니다`);
  assert.ok(text.includes("hashFiles(format('{0}/**/pubspec.lock', env.FLUTTER_PROJECT_DIR))"), `${filename}: pubspec.lock 캐시 키가 Flutter 루트로 한정되지 않았습니다`);
}

function assertNoUnsubstitutedPlaceholders(filename) {
  const dir = mkdtempSync(join(tmpdir(), "paw-flutter-unsubstituted-"));
  try {
    writeFileSync(join(dir, filename), renderWorkflow(filename, { flutterRoot: "app", envMode: "dotenv", androidDeployMode: "store_prepare", iosDeployMode: "store_submit" }));
    assert.deepStrictEqual(scanUnsubstituted(dir, [filename]), [], `${filename}: 치환 후에도 __TOKEN__ 이 남았습니다`);
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

// main push 앵커 → 모노레포에서 paths 필터 한 줄로 치환되고, 단일 레포에서는 주석으로 남는다.
const PATHS_ANCHOR_LINE = "    # @wizard paths-anchor (모노레포일 때 integrator가 paths 필터를 여기 주입)";
function assertPathsAnchor(filename) {
  const raw = rawWorkflow(filename);
  assert.strictEqual(raw.split("\n").filter((l) => l === PATHS_ANCHOR_LINE).length, 1, `${filename}: paths-anchor 줄`);
  assert.match(raw, /^  push:\n    branches: \["\{\{MAIN_BRANCH\}\}"\]\n    # @wizard paths-anchor/m, `${filename}: 앵커는 push.branches 바로 아래(4칸)여야 합니다`);
  assert.match(renderWorkflow(filename, { flutterRoot: "app" }), /^  push:\n    branches: \["main"\]\n    paths: \['app\/\*\*'\]\n/m, `${filename}: --paths flutter=app`);
  assert.ok(renderWorkflow(filename, { flutterRoot: "." }).includes(PATHS_ANCHOR_LINE), `${filename}: 단일 레포에서는 앵커 주석이 그대로 남는다`);
}

// 끊긴 웹 마법사 안내(레포에 없는 .github/util/flutter/...)가 남지 않았는가
function assertNoBrokenWebWizardGuide(filename) {
  const text = rawWorkflow(filename);
  assert.ok(!text.includes(".github/util/flutter"), `${filename}: 존재하지 않는 웹 마법사 경로가 남아 있습니다`);
  assert.ok(!text.includes("웹 마법사"), `${filename}: '웹 마법사' 안내가 남아 있습니다`);
}

// fastlane을 스토어 배포 전용으로 한정하는 파일(SELFHOSTED·TEST-APK): Ruby/fastlane 흔적이 없어야 한다
function assertNoFastlane(filename) {
  const text = rawWorkflow(filename);
  for (const forbidden of ["fastlane", "setup-ruby", "Gemfile", "bundle "]) {
    assert.ok(!text.includes(forbidden), `${filename}: '${forbidden}'이(가) 남아 있습니다`);
  }
}

// ---------------------------------------------------------------------------------------------
// PROJECT-FLUTTER-CI.yaml
// ---------------------------------------------------------------------------------------------
const CI = "PROJECT-FLUTTER-CI.yaml";

test("CI: 최상위 env에 PROJECT_PATH·FLUTTER_PROJECT_DIR·ENV_MODE @wizard 토큰이 있다", () => {
  assertWizardTokenLine(CI, '  PROJECT_PATH: "."  # @wizard auto:project-path');
  assertWizardTokenLine(CI, '  FLUTTER_PROJECT_DIR: "."  # @wizard auto:flutter-root');
  assertWizardTokenLine(CI, '  ENV_MODE: "dart-define"  # @wizard auto:flutter-env-mode');
});

test("CI: 치환 결과 — 경로·환경변수 모드가 반영된다", () => {
  assertRenderedFlutterRoot(CI);
  assertRenderedEnvMode(CI);
  assert.match(renderWorkflow(CI, { flutterRoot: "app" }), /^  PROJECT_PATH: "app"\s*$/m);
  assert.match(renderWorkflow(CI, { flutterRoot: "." }), /^  PROJECT_PATH: "\."\s*$/m);
});

test("CI: changes job이 dorny/paths-filter@v4로 PROJECT_PATH 변경 여부를 판별한다", () => {
  const changes = jobBlocks(rawWorkflow(CI)).get("changes");
  assert.ok(changes, "changes job이 없습니다");
  assert.match(changes, /uses: dorny\/paths-filter@v4/);
  assert.match(changes, /        if: \$\{\{ github\.event_name != 'workflow_dispatch' \}\}\n        uses: dorny/, "workflow_dispatch에서는 판별 스텝을 건너뛴다");
  assert.match(changes, /permissions:\n      contents: read\n      pull-requests: read\n/);
  assert.match(changes, /outputs:\n      project: \$\{\{ steps\.filter\.outputs\.project \}\}/);
  assert.ok(
    changes.includes("- '${{ env.PROJECT_PATH == '.' && '**' || format('{0}/**', env.PROJECT_PATH) }}'"),
    "필터 표현식이 계약과 다릅니다 (경로 '.'이면 '**')",
  );
});

test("CI: 기존 job은 changes에 의존하고, workflow_dispatch는 판별을 무시한다", () => {
  const blocks = jobBlocks(rawWorkflow(CI));
  for (const id of ["prepare", "analyze", "build-android", "build-ios"]) {
    const block = blocks.get(id);
    assert.match(block, /needs: (?:changes|\[changes, prepare\])\n/, `${id}: needs에 changes가 없습니다`);
    assert.ok(block.includes("github.event_name == 'workflow_dispatch' || needs.changes.outputs.project == 'true'"), `${id}: 변경 감지 조건이 없습니다`);
  }
  // 빌드 job은 기존 if(analyze_only·enable_*)를 잃지 않고 && 로 결합한다
  assert.ok(blocks.get("build-android").includes("needs.prepare.outputs.enable_android == 'true'"));
  assert.ok(blocks.get("build-ios").includes("needs.prepare.outputs.enable_ios == 'true'"));
  // 결과 보고는 PR 이벤트이면서 변경이 감지된 실행에서만 댓글을 갱신한다
  const report = blocks.get("report");
  assert.match(report, /if: always\(\) && github\.event_name == 'pull_request' && needs\.changes\.outputs\.project == 'true'/);
  assert.match(report, /needs: \[changes, prepare, analyze, build-android, build-ios\]/);
});

test("CI: ci-gate는 항상 실행되고 기존 모든 job을 needs로 집계한다", () => {
  const blocks = jobBlocks(rawWorkflow(CI));
  const gate = blocks.get("ci-gate");
  assert.ok(gate, "ci-gate job이 없습니다");
  assert.match(gate, /if: \$\{\{ always\(\) \}\}/);
  const others = [...blocks.keys()].filter((id) => id !== "ci-gate");
  const needs = gate.match(/needs: \[([^\]]+)\]/)[1].split(",").map((s) => s.trim());
  assert.deepStrictEqual([...needs].sort(), [...others].sort(), "ci-gate needs가 모든 job을 포함해야 합니다");
  assert.ok(gate.includes("RESULTS: ${{ toJSON(needs.*.result) }}"));
  assert.ok(gate.includes(`grep -Eq '"(failure|cancelled)"'`));
});

test("CI: 환경변수 모드 — analyze·build-android·build-ios 모두 Prepare env file, flutter build에 dart-define 플래그", () => {
  assertLegacyEnvStepsRemoved(CI);
  assertEnvPreparedBeforeFlutterCommands(CI, ["analyze", "build-android", "build-ios"]);
  assertEveryFlutterBuildUsesDartDefine(CI, 2);
  // 기존 ENV_FILE_PATH 커스터마이징은 dotenv 분기에서 그대로 존중한다
  assert.ok(rawWorkflow(CI).includes(`printf '%s\\n' "$ENV_CONTENT" > "$ENV_FILE_PATH"`));
});

test("CI: FLUTTER_PROJECT_DIR — 빌드·분석 job은 defaults를 쓰고 스텝 경로는 루트 접두를 붙인다", () => {
  assertJobsUseFlutterDir(CI, ["analyze", "build-android", "build-ios"]);
  assert.ok(rawWorkflow(CI).includes("      - name: Setup Gradle\n        working-directory: ${{ env.FLUTTER_PROJECT_DIR }}/android\n"));
  assert.deepStrictEqual(rootRelativeStepPaths(CI), []);
  assertHashFilesScopedToFlutterRoot(CI);
});

test("CI: 치환 후 미치환 토큰이 없고 actionlint 신규 경고가 없다", { skip: !HAS_ACTIONLINT && "actionlint 없음" }, () => {
  assertNoUnsubstitutedPlaceholders(CI);
  assertActionlintClean(CI);
});

// ---------------------------------------------------------------------------------------------
// PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml
// ---------------------------------------------------------------------------------------------
const FIREBASE = "PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml";

test("FIREBASE: main push paths 앵커 — 모노레포에서 paths 필터로 치환된다", () => {
  assertPathsAnchor(FIREBASE);
});

test("FIREBASE: FLUTTER_PROJECT_DIR·ENV_MODE 토큰과 치환 결과", () => {
  assertWizardTokenLine(FIREBASE, '  FLUTTER_PROJECT_DIR: "."  # @wizard auto:flutter-root');
  assertWizardTokenLine(FIREBASE, '  ENV_MODE: "dart-define"  # @wizard auto:flutter-env-mode');
  assertRenderedFlutterRoot(FIREBASE);
  assertRenderedEnvMode(FIREBASE);
});

test("FIREBASE: 환경변수 모드 — 빌드 job마다 Prepare env file, appbundle에 dart-define 플래그", () => {
  assertLegacyEnvStepsRemoved(FIREBASE);
  assertEnvPreparedBeforeFlutterCommands(FIREBASE, ["prepare-build", "build-android"]);
  assertEveryFlutterBuildUsesDartDefine(FIREBASE, 1);
});

test("FIREBASE: FLUTTER_PROJECT_DIR 정비 — 레포 루트 기준 스텝은 워크스페이스로, 나머지는 접두를 붙인다", () => {
  assertJobsUseFlutterDir(FIREBASE, ["prepare-build", "build-android"]);
  const blocks = jobBlocks(rawWorkflow(FIREBASE));
  // version.yml·changelog는 레포 루트 기준
  const prepare = blocks.get("prepare-build");
  assert.match(prepare, /name: 현재 버전 정보 가져오기\n        id: current_version\n        working-directory: \$\{\{ github\.workspace \}\}/);
  assert.match(prepare, /name: 릴리즈 노트 생성\n        id: release_notes\n        working-directory: \$\{\{ github\.workspace \}\}/);
  // deploy 잡은 Flutter를 실행하지 않는다 — defaults 없이 AAB 경로에만 접두
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

test("FIREBASE: 끊긴 웹 마법사 안내가 없고 필요한 Secrets 안내가 남는다", () => {
  assertNoBrokenWebWizardGuide(FIREBASE);
  assert.ok(rawWorkflow(FIREBASE).includes("FIREBASE_SERVICE_ACCOUNT_JSON_BASE64"));
});

test("FIREBASE: 치환 후 미치환 토큰이 없고 actionlint 신규 경고가 없다", { skip: !HAS_ACTIONLINT && "actionlint 없음" }, () => {
  assertNoUnsubstitutedPlaceholders(FIREBASE);
  assertActionlintClean(FIREBASE);
});
