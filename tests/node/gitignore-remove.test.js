// tests/node/gitignore-remove.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureGitignore, hasAutoAddedEntries, removeAutoAddedEntriesFromGitignore } from "../../src/core/copy/gitignore.js";

test("hasAutoAddedEntries: false before ensureGitignore, true after (fresh file case)", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-gitignore-remove-"));
  try {
    assert.strictEqual(hasAutoAddedEntries(target), false);
    ensureGitignore(target);
    assert.strictEqual(hasAutoAddedEntries(target), true);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeAutoAddedEntriesFromGitignore: fresh-file case deletes the whole file", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-gitignore-remove-"));
  try {
    ensureGitignore(target); // .gitignore가 없었으므로 마법사가 통째로 새로 생성
    assert.ok(existsSync(join(target, ".gitignore")));
    const status = removeAutoAddedEntriesFromGitignore(target);
    assert.strictEqual(status, "file-deleted");
    assert.ok(!existsSync(join(target, ".gitignore")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeAutoAddedEntriesFromGitignore: existing-file case removes only the banner block", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-gitignore-remove-"));
  try {
    const original = "node_modules/\ndist/\n";
    writeFileSync(join(target, ".gitignore"), original);
    ensureGitignore(target); // 기존 파일에 배너 블록만 append
    const appended = readFileSync(join(target, ".gitignore"), "utf8");
    assert.notStrictEqual(appended, original);
    assert.ok(appended.includes("project-auto-wizard: Auto-added entries"));

    const status = removeAutoAddedEntriesFromGitignore(target);
    assert.strictEqual(status, "removed");
    const after = readFileSync(join(target, ".gitignore"), "utf8");
    assert.ok(after.startsWith(original));
    assert.ok(!after.includes("project-auto-wizard: Auto-added entries"));
    assert.ok(!after.includes("*.bak"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeAutoAddedEntriesFromGitignore: no .gitignore -> skip-no-gitignore, no-op", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-gitignore-remove-"));
  try {
    assert.strictEqual(removeAutoAddedEntriesFromGitignore(target), "skip-no-gitignore");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeAutoAddedEntriesFromGitignore: .gitignore exists but no banner -> skip-not-found, untouched", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-gitignore-remove-"));
  try {
    writeFileSync(join(target, ".gitignore"), "node_modules/\n");
    const status = removeAutoAddedEntriesFromGitignore(target);
    assert.strictEqual(status, "skip-not-found");
    assert.strictEqual(readFileSync(join(target, ".gitignore"), "utf8"), "node_modules/\n");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeAutoAddedEntriesFromGitignore: preserves entries the user appended after the auto-added block", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-gitignore-remove-"));
  try {
    const original = "node_modules/\ndist/\n";
    writeFileSync(join(target, ".gitignore"), original);
    ensureGitignore(target);
    const installed = readFileSync(join(target, ".gitignore"), "utf8");
    // 설치 후 사용자가 파일 끝에 자기 항목을 추가했다고 가정 — uninstall이 이를 지우면 안 된다.
    const userAddition = ".env\nsecrets/\n";
    writeFileSync(join(target, ".gitignore"), installed + userAddition);

    const status = removeAutoAddedEntriesFromGitignore(target);
    assert.strictEqual(status, "removed");
    assert.strictEqual(readFileSync(join(target, ".gitignore"), "utf8"), original + userAddition);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeAutoAddedEntriesFromGitignore: fresh-file case with content appended later strips only the wizard-written prefix", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-gitignore-remove-"));
  try {
    ensureGitignore(target); // .gitignore가 없었으므로 마법사가 통째로 새로 생성
    const fresh = readFileSync(join(target, ".gitignore"), "utf8");
    const userAddition = "dist/\n";
    writeFileSync(join(target, ".gitignore"), fresh + userAddition);

    const status = removeAutoAddedEntriesFromGitignore(target);
    assert.strictEqual(status, "removed");
    assert.strictEqual(readFileSync(join(target, ".gitignore"), "utf8"), userAddition);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeAutoAddedEntriesFromGitignore: a user line inserted between the two required entries is preserved, both entries removed (issue #20 M7)", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-gitignore-remove-"));
  try {
    const original = "node_modules/\ndist/\n";
    writeFileSync(join(target, ".gitignore"), original);
    ensureGitignore(target);
    const installed = readFileSync(join(target, ".gitignore"), "utf8");
    const withInsertedLine = installed.replace("*.bak\n*.template.yaml\n", "*.bak\nmy-own-entry/\n*.template.yaml\n");
    writeFileSync(join(target, ".gitignore"), withInsertedLine);

    const status = removeAutoAddedEntriesFromGitignore(target);
    assert.strictEqual(status, "removed");
    const after = readFileSync(join(target, ".gitignore"), "utf8");
    assert.ok(after.startsWith(original));
    assert.ok(!after.includes("*.bak"));
    assert.ok(!after.includes("*.template.yaml"));
    assert.ok(!after.includes("project-auto-wizard"));
    assert.strictEqual(after, original + "my-own-entry/\n");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeAutoAddedEntriesFromGitignore: legacy banner without an end marker falls back to consecutive-match removal (documented limitation)", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-gitignore-remove-"));
  try {
    const original = "node_modules/\ndist/\n";
    const legacyBanner =
      "\n" +
      "# ====================================================================\n" +
      "# project-auto-wizard: Auto-added entries\n" +
      "# ====================================================================\n" +
      "*.bak\n" +
      "my-own-entry/\n" +
      "*.template.yaml\n"; // 종료 마커 없음 — 이 수정 이전 버전이 설치한 형태를 그대로 재현
    writeFileSync(join(target, ".gitignore"), original + legacyBanner);

    const status = removeAutoAddedEntriesFromGitignore(target);
    assert.strictEqual(status, "removed");
    const after = readFileSync(join(target, ".gitignore"), "utf8");
    // 문서화된 한계: 연속 매치가 my-own-entry/에서 끊겨 *.template.yaml은 제거되지 않는다.
    assert.ok(after.includes("*.template.yaml"), "legacy fallback stops at the first mismatch (documented limitation)");
    assert.ok(!after.includes("*.bak"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
