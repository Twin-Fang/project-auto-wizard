// tests/node/ai-pr-summary.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";

function install(overrides = {}) {
  const target = mkdtempSync(join(tmpdir(), "paw-ai-pr-"));
  const ctx = createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(),
    now: "2026-07-28 00:00:00", today: "2026-07-28", templateVersion: "0.1.0",
    ...overrides,
  });
  runFull(ctx, resolvePayloadRoot(), target);
  return target;
}

test("PROJECT-COMMON-AI-PR-SUMMARY.yaml is installed as part of common workflows", () => {
  const target = install();
  try {
    const p = join(target, ".github/workflows/PROJECT-COMMON-AI-PR-SUMMARY.yaml");
    assert.ok(existsSync(p));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("installed copy has {{MAIN_BRANCH}}/{{DEVELOP_BRANCH}} placeholders substituted", () => {
  const target = install();
  try {
    const content = readFileSync(join(target, ".github/workflows/PROJECT-COMMON-AI-PR-SUMMARY.yaml"), "utf8");
    assert.ok(!content.includes("{{MAIN_BRANCH}}"));
    assert.match(content, /branches: \["main"\]/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("trunk-based mode also installs it (not in TRUNK_BASED_EXCLUDED)", () => {
  const target = install({ branches: { main: "main", develop: "main", mode: "trunk-based" } });
  try {
    assert.ok(existsSync(join(target, ".github/workflows/PROJECT-COMMON-AI-PR-SUMMARY.yaml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
