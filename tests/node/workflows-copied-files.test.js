// tests/node/workflows-copied-files.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { copyWorkflows } from "../../src/core/copy/workflows.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";

const PAYLOAD = resolvePayloadRoot();

function freshTarget(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function ctxFor(types, extra = {}) {
  return createContext({
    mode: "full", force: true, types, version: "1.0.0",
    branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(),
    ...extra,
  });
}

test("copyWorkflows: 최초 설치에서 copiedFiles는 실제 복사된 모든 파일명을 담고, 개수는 copied와 일치한다", () => {
  const target = freshTarget("paw-copied-files-init-");
  try {
    const result = copyWorkflows(ctxFor(["node"]), PAYLOAD, target);
    assert.ok(Array.isArray(result.copiedFiles));
    assert.strictEqual(result.copiedFiles.length, result.copied);
    assert.ok(result.copiedFiles.includes("PROJECT-COMMON-RELEASE-PUBLISH.yaml"));
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("copyWorkflows: 재실행 시 unchanged(skip)된 파일은 copiedFiles에 없다", () => {
  const target = freshTarget("paw-copied-files-rerun-");
  try {
    const ctx = ctxFor(["node"]);
    copyWorkflows(ctx, PAYLOAD, target); // 최초 설치
    const second = copyWorkflows(ctx, PAYLOAD, target); // 동일 조건 재실행 -> 전부 unchanged
    assert.strictEqual(second.copiedFiles.length, 0);
    assert.strictEqual(second.copied, 0);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("copyWorkflows: backup 결정은 원본 파일명을, template 결정은 .template.yaml 파일명을 copiedFiles에 담는다", () => {
  const target = freshTarget("paw-copied-files-decision-");
  try {
    // GITHUB-PACKAGES는 라이브러리 publish 계열이라 nexus/ opt-in에 속한다 (이슈 #80).
    // 여기서는 ".yaml만 strip" 규칙을 검증하려 .yml 확장자 파일이 필요해 이 파일을 쓴다.
    const ctx = ctxFor(["spring"], { includeNexus: true });
    copyWorkflows(ctx, PAYLOAD, target); // 최초 설치 (nexus 포함 spring 전용 파일 생성)

    const targetFile = join(target, ".github", "workflows", "PROJECT-SPRING-GITHUB-PACKAGES-PUBLISH.yml");
    writeFileSync(targetFile, "changed-content-that-differs-from-template\n");
    const backupResult = copyWorkflows(ctx, PAYLOAD, target, {
      decisions: new Map([["PROJECT-SPRING-GITHUB-PACKAGES-PUBLISH.yml", "backup"]]),
    });
    assert.ok(backupResult.copiedFiles.includes("PROJECT-SPRING-GITHUB-PACKAGES-PUBLISH.yml"));

    writeFileSync(targetFile, "changed-again\n");
    const templateResult = copyWorkflows(ctx, PAYLOAD, target, {
      decisions: new Map([["PROJECT-SPRING-GITHUB-PACKAGES-PUBLISH.yml", "template"]]),
    });
    // applyDecision()의 template 파일명 규칙: .yaml만 strip, .yml은 그대로 뒤에 .template.yaml이 붙는다(레거시 .sh 동일 동작).
    assert.ok(templateResult.copiedFiles.includes("PROJECT-SPRING-GITHUB-PACKAGES-PUBLISH.yml.template.yaml"));
    assert.ok(!templateResult.copiedFiles.includes("PROJECT-SPRING-GITHUB-PACKAGES-PUBLISH.yml"));
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("copyWorkflows: secret-backup opt-in 파일도 copiedFiles에 담긴다", () => {
  const target = freshTarget("paw-copied-files-secret-");
  try {
    const ctx = createContext({
      mode: "full", force: true, types: ["node"], version: "1.0.0",
      branches: { main: "main", develop: "develop", mode: "pr-flow" },
      paths: new Map(), includeSecretBackup: true,
    });
    const result = copyWorkflows(ctx, PAYLOAD, target);
    assert.ok(result.copiedFiles.includes("PROJECT-COMMON-SECRET-FILE-UPLOAD.yaml"));
  } finally { rmSync(target, { recursive: true, force: true }); }
});
