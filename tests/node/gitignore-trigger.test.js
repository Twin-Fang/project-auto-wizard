// tests/node/gitignore-trigger.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
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

// issue #69 — baseline 3-way 도입 이후 "사용자만 수정"은 질문 없이 유지되므로(localOnly)
// 충돌 결정(backup/template) 경로를 검증하려면 진짜 충돌을 만들어야 한다.
// baseline의 rendered 해시를 어긋나게 해 "업스트림도 바뀐 것"으로 만든다.
function forceUpstreamChange(target, filename) {
  const bp = join(target, ".github/.wizard/baseline.json");
  const bl = JSON.parse(readFileSync(bp, "utf8"));
  bl.files[filename].rendered = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
  writeFileSync(bp, JSON.stringify(bl, null, 2));
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

// NOTE: 아래 두 테스트는 PROJECT-PYTHON-CI.yaml(타입별 워크플로우)을 예시로 쓴다 — 특정 파일로
// 고정해 테스트를 안정적으로 만든 것일 뿐, issue #20 H3 수정 이후로는 PROJECT-COMMON-*.yaml도
// 동일한 3지선(backup/template 결정)을 거치므로 common 파일로도 이 테스트가 성립한다.
// (payload/workflows/python/에 파일이 존재하는지는 확인됨.)
test("runFull: 타입별 워크플로우 충돌을 'backup'으로 처리하면 .gitignore에 *.bak이 추가된다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-full-gitignore-"));
  try {
    const ctx = baseContext({ types: ["python"] });
    const payloadRoot = resolvePayloadRoot();
    runFull(ctx, payloadRoot, target);
    const wfPath = join(target, ".github/workflows/PROJECT-PYTHON-CI.yaml");
    assert.ok(existsSync(wfPath));
    writeFileSync(wfPath, readFileSync(wfPath, "utf8") + "\n# user edit\n");
    forceUpstreamChange(target, "PROJECT-PYTHON-CI.yaml");

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
    forceUpstreamChange(target, "PROJECT-PYTHON-CI.yaml");

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

test("runFull: 설치물에 .coderabbit.yaml이 생기지 않는다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-full-gitignore-"));
  try {
    runFull(baseContext(), resolvePayloadRoot(), target);
    assert.ok(!existsSync(join(target, ".coderabbit.yaml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

