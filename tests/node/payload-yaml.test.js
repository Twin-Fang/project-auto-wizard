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
