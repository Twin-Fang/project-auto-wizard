// tests/node/uninstall-plan.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { planUninstall, runUninstall } from "../../src/commands/uninstall.js";
import { ensureGitignore } from "../../src/core/copy/gitignore.js";

const FULL_SELECTION = { workflows: true, scripts: true, coderabbit: true, readme: true, gitignore: true, versionYml: true };
const SAFE_SELECTION = { workflows: true, scripts: true, coderabbit: true, readme: false, gitignore: false, versionYml: false };

function installFixture() {
  const target = mkdtempSync(join(tmpdir(), "paw-uninstall-plan-"));
  writeFileSync(join(target, "README.md"), "# Test Project\n");
  const ctx = createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(), includeCodeRabbit: true,
    now: "2026-08-01 00:00:00", today: "2026-08-01", templateVersion: "0.1.0",
  });
  runFull(ctx, resolvePayloadRoot(), target);
  // full 모드는 충돌 백업이 실제로 생겼을 때만 .gitignore를 만든다(issue #7) — 이 픽스처는
  // uninstall의 gitignore 정리 동작 자체를 검증하는 것이 목적이므로 직접 만들어 둔다.
  ensureGitignore(target);
  return target;
}

test("planUninstall: full selection reports every installed item, deletes nothing", () => {
  const target = installFixture();
  try {
    const plan = planUninstall(resolvePayloadRoot(), target, FULL_SELECTION);
    assert.ok(plan.workflows.length > 0);
    assert.ok(plan.scripts.includes("version_manager.py"));
    assert.strictEqual(plan.coderabbit, true);
    assert.strictEqual(plan.readme, true);
    assert.strictEqual(plan.gitignore, true);
    assert.strictEqual(plan.versionYml, true);
    assert.ok(existsSync(join(target, "version.yml")));
    assert.ok(existsSync(join(target, ".coderabbit.yaml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planUninstall: safe selection excludes readme/gitignore/versionYml", () => {
  const target = installFixture();
  try {
    const plan = planUninstall(resolvePayloadRoot(), target, SAFE_SELECTION);
    assert.ok(plan.workflows.length > 0);
    assert.strictEqual(plan.readme, false);
    assert.strictEqual(plan.gitignore, false);
    assert.strictEqual(plan.versionYml, false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("runUninstall: full selection removes workflows/scripts/coderabbit/readme-section/gitignore/version.yml", () => {
  const target = installFixture();
  try {
    const result = runUninstall({}, resolvePayloadRoot(), target, FULL_SELECTION);
    assert.ok(result.workflows.length > 0);
    assert.ok(!existsSync(join(target, ".github/scripts/version_manager.py")));
    assert.ok(!existsSync(join(target, ".coderabbit.yaml")));
    assert.ok(!existsSync(join(target, "version.yml")));
    assert.ok(!existsSync(join(target, ".gitignore"))); // 신규생성 케이스 -> 파일 자체 삭제
    const readme = readFileSync(join(target, "README.md"), "utf8");
    assert.ok(!readme.includes("AUTO-VERSION-SECTION"));
    assert.strictEqual(readme, "# Test Project\n");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("runUninstall: safe selection leaves readme/gitignore/version.yml untouched", () => {
  const target = installFixture();
  try {
    runUninstall({}, resolvePayloadRoot(), target, SAFE_SELECTION);
    assert.ok(!existsSync(join(target, ".github/scripts/version_manager.py")));
    assert.ok(existsSync(join(target, "version.yml")));
    assert.ok(existsSync(join(target, ".gitignore")));
    const readme = readFileSync(join(target, "README.md"), "utf8");
    assert.ok(readme.includes("AUTO-VERSION-SECTION"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("runUninstall: README in unexpected format is not falsely reported as removed", () => {
  const target = installFixture();
  try {
    // 사용자가 CHANGELOG 링크 줄을 지워 removeVersionSectionFromReadme가 skip하게 만든다.
    const readmePath = join(target, "README.md");
    const content = readFileSync(readmePath, "utf8").replace("[전체 버전 기록 보기](CHANGELOG.md)\n", "");
    writeFileSync(readmePath, content);

    const result = runUninstall({}, resolvePayloadRoot(), target, FULL_SELECTION);
    assert.strictEqual(result.readme, false); // 실제로는 제거되지 않았으므로 false여야 함
    assert.strictEqual(readFileSync(readmePath, "utf8"), content); // README는 그대로 보존
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planUninstall: nothing installed -> everything false/empty", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-uninstall-empty-"));
  try {
    const plan = planUninstall(resolvePayloadRoot(), target, FULL_SELECTION);
    assert.deepStrictEqual(plan.workflows, []);
    assert.deepStrictEqual(plan.scripts, []);
    assert.strictEqual(plan.coderabbit, false);
    assert.strictEqual(plan.readme, false);
    assert.strictEqual(plan.gitignore, false);
    assert.strictEqual(plan.versionYml, false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
