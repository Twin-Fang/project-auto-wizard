// Task 15 게이트 — CodeRabbit opt-in (기본 false).
// false: .coderabbit.yaml 미복사 + version.yml coderabbit: false
// true : .coderabbit.yaml 복사   + version.yml coderabbit: true
import { test } from "node:test";
import assert from "node:assert";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { parseTemplateOptions } from "../../src/core/version-yml.js";

function runWith(includeCodeRabbit) {
  const target = mkdtempSync(join(tmpdir(), "paw-cr-"));
  const ctx = createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(), includeCodeRabbit,
    now: "2026-07-09 00:00:00", today: "2026-07-09", templateVersion: "0.1.0",
  });
  runFull(ctx, resolvePayloadRoot(), target);
  return target;
}

test("opt-in false (default): no .coderabbit.yaml, version.yml records false", () => {
  const target = runWith(false);
  try {
    assert.ok(!existsSync(join(target, ".coderabbit.yaml")));
    const opts = parseTemplateOptions(readFileSync(join(target, "version.yml"), "utf8"));
    assert.strictEqual(opts.coderabbit, false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("opt-in true: .coderabbit.yaml copied, version.yml records true", () => {
  const target = runWith(true);
  try {
    assert.ok(existsSync(join(target, ".coderabbit.yaml")));
    const opts = parseTemplateOptions(readFileSync(join(target, "version.yml"), "utf8"));
    assert.strictEqual(opts.coderabbit, true);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
