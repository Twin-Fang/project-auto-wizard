// tests/node/gitignore-trigger.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { runVersion } from "../../src/commands/version.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";

function baseContext(overrides = {}) {
  return createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(),
    now: "2026-08-02 00:00:00", today: "2026-08-02", templateVersion: "0.1.0",
    ...overrides,
  });
}

test("runFull: 충돌 없는 최초 설치는 .gitignore를 전혀 만들지 않는다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-full-gitignore-"));
  try {
    const result = runFull(baseContext(), resolvePayloadRoot(), target);
    assert.strictEqual(result.gitignoreUpdated, false);
    assert.ok(!existsSync(join(target, ".gitignore")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// NOTE (Fable 검토 반영): PROJECT-COMMON-*.yaml은 "common" 워크플로우라 copyWorkflows()의
// common 분기(workflows.js:80-93)에서 changed여도 decisions Map을 거치지 않고 무조건 덮어쓴다 —
// backup/template 결정은 오직 타입별(copyWorkflowsForType) 워크플로우에서만 적용된다.
// 그래서 아래 두 테스트는 타입별 파일(PROJECT-PYTHON-CI.yaml, payload/workflows/python/에 존재 확인)을 써야 한다.
test("runFull: 타입별 워크플로우 충돌을 'backup'으로 처리하면 .gitignore에 *.bak이 추가된다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-full-gitignore-"));
  try {
    const ctx = baseContext({ types: ["python"] });
    const payloadRoot = resolvePayloadRoot();
    runFull(ctx, payloadRoot, target);
    const wfPath = join(target, ".github/workflows/PROJECT-PYTHON-CI.yaml");
    assert.ok(existsSync(wfPath));
    writeFileSync(wfPath, readFileSync(wfPath, "utf8") + "\n# user edit\n");

    const result = runFull(ctx, payloadRoot, target, {
      decisions: new Map([["PROJECT-PYTHON-CI.yaml", "backup"]]),
    });

    assert.ok(existsSync(wfPath + ".bak"));
    assert.strictEqual(result.gitignoreUpdated, true);
    assert.ok(existsSync(join(target, ".gitignore")));
    assert.ok(readFileSync(join(target, ".gitignore"), "utf8").includes("*.bak"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("runFull: 타입별 워크플로우 충돌을 'template'으로 처리하면 .gitignore에 *.template.yaml이 추가된다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-full-gitignore-"));
  try {
    const ctx = baseContext({ types: ["python"] });
    const payloadRoot = resolvePayloadRoot();
    runFull(ctx, payloadRoot, target);
    const wfPath = join(target, ".github/workflows/PROJECT-PYTHON-CI.yaml");
    writeFileSync(wfPath, readFileSync(wfPath, "utf8") + "\n# user edit\n");

    const result = runFull(ctx, payloadRoot, target, {
      decisions: new Map([["PROJECT-PYTHON-CI.yaml", "template"]]),
    });

    assert.ok(existsSync(join(target, ".github/workflows/PROJECT-PYTHON-CI.template.yaml")));
    assert.strictEqual(result.gitignoreUpdated, true);
    assert.ok(readFileSync(join(target, ".gitignore"), "utf8").includes("*.template.yaml"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("runFull: .coderabbit.yaml을 백업하며 덮어쓰면 .gitignore가 갱신된다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-full-gitignore-"));
  try {
    const payloadRoot = resolvePayloadRoot();
    const ctx = baseContext({ includeCodeRabbit: true });
    runFull(ctx, payloadRoot, target);
    assert.ok(existsSync(join(target, ".coderabbit.yaml")));
    assert.ok(!existsSync(join(target, ".gitignore")));

    // force:true 상태로 재설치 — 기존 .coderabbit.yaml을 .bak으로 백업 후 덮어쓴다.
    const result = runFull(ctx, payloadRoot, target);

    assert.ok(existsSync(join(target, ".coderabbit.yaml.bak")));
    assert.strictEqual(result.gitignoreUpdated, true);
    assert.ok(readFileSync(join(target, ".gitignore"), "utf8").includes("*.bak"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("runVersion: 반복 설치해도 .gitignore를 절대 만들지 않는다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-version-gitignore-"));
  try {
    const payloadRoot = resolvePayloadRoot();
    const ctx = baseContext({ mode: "version" });
    runVersion(ctx, payloadRoot, target);
    runVersion(ctx, payloadRoot, target);
    assert.ok(!existsSync(join(target, ".gitignore")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
