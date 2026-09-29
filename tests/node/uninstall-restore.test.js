// tests/node/uninstall-restore.test.js
// 완전 삭제 후 파일시스템이 설치 전과 같아야 한다 — 끝 개행 차이나 빈 폴더가 남지 않는다.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, existsSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { runUninstall } from "../../src/commands/uninstall.js";
import { executePurge } from "../../src/commands/purge.js";
import { ensureGitignore, removeAutoAddedEntriesFromGitignore } from "../../src/core/copy/gitignore.js";

const PAYLOAD = resolvePayloadRoot();
const ALL = { workflows: true, scripts: true, readme: true, gitignore: true, versionYml: true };

function install(prepare = () => {}) {
  const target = mkdtempSync(join(tmpdir(), "paw-uninstall-restore-"));
  prepare(target);
  runFull(createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(),
    now: "2026-09-01 00:00:00", today: "2026-09-01", templateVersion: "0.1.0",
  }), PAYLOAD, target);
  return target;
}

test("gitignore: 끝 개행이 없던 파일은 추가·제거 후 원문 그대로 돌아온다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-gi-noeol-"));
  try {
    writeFileSync(join(target, ".gitignore"), "build/");
    ensureGitignore(target);
    const added = readFileSync(join(target, ".gitignore"), "utf8");
    assert.match(added, /^build\/\n# =+\n# project-auto-wizard: Auto-added entries/);
    assert.strictEqual(removeAutoAddedEntriesFromGitignore(target), "removed");
    assert.strictEqual(readFileSync(join(target, ".gitignore"), "utf8"), "build/");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("gitignore: 끝 개행이 있던 파일도 원문 그대로 돌아온다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-gi-eol-"));
  try {
    writeFileSync(join(target, ".gitignore"), "build/\n");
    ensureGitignore(target);
    removeAutoAddedEntriesFromGitignore(target);
    assert.strictEqual(readFileSync(join(target, ".gitignore"), "utf8"), "build/\n");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("uninstall: 마법사가 만든 .github 폴더가 비면 함께 지운다", () => {
  const target = install();
  try {
    runUninstall({}, PAYLOAD, target, ALL);
    assert.ok(!existsSync(join(target, ".github/workflows")));
    assert.ok(!existsSync(join(target, ".github/scripts")));
    assert.ok(!existsSync(join(target, ".github")));
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("uninstall: 사용자 파일이 남은 .github 폴더는 지우지 않는다", () => {
  const target = install((t) => {
    mkdirSync(join(t, ".github/workflows"), { recursive: true });
    writeFileSync(join(t, ".github/workflows/my-ci.yaml"), "name: my-ci\n");
    writeFileSync(join(t, ".github/CODEOWNERS"), "* @my-team\n");
  });
  try {
    runUninstall({}, PAYLOAD, target, ALL);
    assert.ok(existsSync(join(target, ".github/workflows/my-ci.yaml")));
    assert.ok(existsSync(join(target, ".github/CODEOWNERS")));
    assert.ok(!existsSync(join(target, ".github/scripts")), "비게 된 scripts 폴더는 정리한다");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("purge: 비게 된 .github 폴더를 정리한다", () => {
  const target = install();
  try {
    executePurge(PAYLOAD, target);
    assert.ok(!existsSync(join(target, ".github")));
  } finally { rmSync(target, { recursive: true, force: true }); }
});
