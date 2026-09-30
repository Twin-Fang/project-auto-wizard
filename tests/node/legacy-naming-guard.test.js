// tests/node/legacy-naming-guard.test.js
// Prevents the original-author-specific name (suh) from re-entering installed output and source.
//
// docs/ is past design records and is not checked; tests/ is excluded because this guard itself holds the pattern string.
// Comment lines are checked too — example values left in comments are installed to users as is.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resolvePayloadRoot } from "../../src/core/assets.js";

const REPO_ROOT = join(resolvePayloadRoot(), "..");
const SCAN_DIRS = ["payload", "src", ".github"];
const LEGACY_NAME = /suh/i;

function allFiles(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    // Bytecode caches are excluded via .gitignore and packaging, so they are neither installed output nor source
    if (entry.isDirectory()) {
      if (entry.name !== "__pycache__") allFiles(path, acc);
    }
    else acc.push(path);
  }
  return acc;
}

test("no original-author-specific name (suh) remains in payload, src, or .github", () => {
  const hits = [];
  for (const dir of SCAN_DIRS) {
    for (const file of allFiles(join(REPO_ROOT, dir))) {
      const rel = file.slice(REPO_ROOT.length + 1);
      if (LEGACY_NAME.test(rel)) hits.push(`${rel} — file path`);
      readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
        if (LEGACY_NAME.test(line)) hits.push(`${rel}:${i + 1}  ${line.trim()}`);
      });
    }
  }
  assert.deepStrictEqual(hits, [], `author-specific name remains:\n  ${hits.join("\n  ")}`);
});
