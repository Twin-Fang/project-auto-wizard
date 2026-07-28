import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runDoctor } from "../../src/commands/doctor.js";

function fakeExec(map) {
  return (cmd, args) => {
    const key = [cmd, ...args].join(" ");
    for (const [pattern, result] of map) {
      if (key.includes(pattern)) return result;
    }
    return { status: 1, stdout: "", stderr: "unmocked command: " + key, error: null };
  };
}

test("runDoctor: gh CLI missing -> WARN and stops early", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const exec = fakeExec([
      ["gh --version", { status: 1, stdout: "", stderr: "", error: new Error("not found") }],
    ]);
    const results = runDoctor(dir, { exec });
    const ghCheck = results.find((r) => r.name === "gh CLI");
    assert.strictEqual(ghCheck.status, "WARN");
    assert.ok(!results.some((r) => r.name === "gh 인증"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runDoctor: gh not authenticated -> FAIL and stops before remote checks", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const exec = fakeExec([
      ["gh --version", { status: 0, stdout: "gh version 2.0.0", stderr: "" }],
      ["gh auth status", { status: 1, stdout: "", stderr: "not logged in" }],
    ]);
    const results = runDoctor(dir, { exec });
    assert.strictEqual(results.find((r) => r.name === "gh 인증").status, "FAIL");
    assert.ok(!results.some((r) => r.name === "GitHub 원격"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runDoctor: all checks OK", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  writeFileSync(join(dir, "version.yml"), "version: \"1.0.0\"\n");
  try {
    const exec = fakeExec([
      ["gh --version", { status: 0, stdout: "gh version 2.0.0", stderr: "" }],
      ["gh auth status", { status: 0, stdout: "Logged in", stderr: "" }],
      ["git -C", { status: 0, stdout: "https://github.com/acme/widgets.git\n", stderr: "" }],
      ["actions/permissions/workflow", { status: 0, stdout: "write", stderr: "" }],
      ["secret list", { status: 0, stdout: "WORKFLOW_PAT\tUpdated 2026-01-01\n", stderr: "" }],
      [".allow_merge_commit", { status: 0, stdout: "true", stderr: "" }],
    ]);
    const results = runDoctor(dir, { exec });
    assert.strictEqual(results.find((r) => r.name === "설치 여부").status, "OK");
    assert.strictEqual(results.find((r) => r.name === "Workflow permissions").status, "OK");
    assert.strictEqual(results.find((r) => r.name === "WORKFLOW_PAT secret").status, "OK");
    assert.strictEqual(results.find((r) => r.name === "automerge 호환성(merge commit 허용)").status, "OK");
    assert.strictEqual(results.find((r) => r.name === "GitHub Models 활성화").status, "INFO");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runDoctor: missing WORKFLOW_PAT and non-write permissions -> WARN", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const exec = fakeExec([
      ["gh --version", { status: 0, stdout: "gh version 2.0.0", stderr: "" }],
      ["gh auth status", { status: 0, stdout: "Logged in", stderr: "" }],
      ["git -C", { status: 0, stdout: "git@github.com:acme/widgets.git\n", stderr: "" }],
      ["actions/permissions/workflow", { status: 0, stdout: "read", stderr: "" }],
      ["secret list", { status: 0, stdout: "AI_API_KEY\tUpdated 2026-01-01\n", stderr: "" }],
      [".allow_merge_commit", { status: 0, stdout: "false", stderr: "" }],
    ]);
    const results = runDoctor(dir, { exec });
    assert.strictEqual(results.find((r) => r.name === "Workflow permissions").status, "WARN");
    assert.strictEqual(results.find((r) => r.name === "WORKFLOW_PAT secret").status, "WARN");
    assert.strictEqual(results.find((r) => r.name === "automerge 호환성(merge commit 허용)").status, "WARN");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runDoctor: no git remote -> WARN and stops before repo-scoped checks", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const exec = fakeExec([
      ["gh --version", { status: 0, stdout: "gh version 2.0.0", stderr: "" }],
      ["gh auth status", { status: 0, stdout: "Logged in", stderr: "" }],
      ["git -C", { status: 1, stdout: "", stderr: "fatal: no such remote" }],
    ]);
    const results = runDoctor(dir, { exec });
    assert.strictEqual(results.find((r) => r.name === "GitHub 원격").status, "WARN");
    assert.ok(!results.some((r) => r.name === "Workflow permissions"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
