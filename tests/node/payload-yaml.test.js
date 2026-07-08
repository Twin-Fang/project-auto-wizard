import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const files = readdirSync("payload/workflows", { recursive: true })
  .filter((f) => /\.ya?ml$/.test(String(f)))
  .map((f) => join("payload/workflows", String(f)));

// Task 7 시점엔 2개뿐 — 최종 개수(>=20)는 Task 10에서 상향
test("payload workflows exist", () => assert.ok(files.length >= 2));

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

test("@coderabbitai summary appears only inside the coderabbit-gated step", () => {
  const body = readFileSync(changelogPath, "utf8");
  const occurrences = body.split("@coderabbitai summary").length - 1;
  assert.strictEqual(occurrences, 1, "expected exactly one @coderabbitai summary occurrence");
  const lines = body.split("\n");
  const idx = lines.findIndex((l) => l.includes("@coderabbitai summary"));
  const preceding = lines.slice(Math.max(0, idx - 40), idx).join("\n");
  assert.ok(
    /if:.*coderabbit\s*==\s*'true'/.test(preceding),
    "@coderabbitai summary must sit inside a step gated on the coderabbit option"
  );
});

test("AUTO-CHANGELOG-CONTROL polls PR body 10 times x 30s (5 minutes)", () => {
  const body = readFileSync(changelogPath, "utf8");
  assert.ok(body.includes("MAX_POLLS=10"));
  assert.ok(body.includes("POLL_INTERVAL=30"));
  assert.ok(body.includes("5 minutes"));
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
