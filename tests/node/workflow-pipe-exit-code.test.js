// tests/node/workflow-pipe-exit-code.test.js
// `$?` on the line after `cmd | tee log` is the exit code of the last command (tee), not cmd, so failures are reported as success.
// Pins that no workflow reads the exit code via `$?` right after a pipe (use PIPESTATUS or pipefail).
import { test } from "node:test";
import assert from "node:assert";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

function listWorkflows(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listWorkflows(p));
    else if (/\.ya?ml$/.test(entry.name)) out.push(p);
  }
  return out;
}

// Lines with a single pipe rather than `||`
const PIPE = /(^|[^|])\|(?!\|)/;

// A violation when the command line right after a pipe line reads `$?` and no pipefail appears earlier in the same run block
function findPipeExitCodeReads(text) {
  const lines = text.split(/\r?\n/);
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("#") || !PIPE.test(line) || line.startsWith("run: |")) continue;
    let j = i + 1;
    while (j < lines.length && (lines[j].trim() === "" || lines[j].trim().startsWith("#"))) j++;
    if (j >= lines.length || !/\$\?/.test(lines[j])) continue;
    const before = lines.slice(Math.max(0, i - 30), i).join("\n");
    if (/set -[a-z]*o pipefail/.test(before)) continue;
    hits.push(`${i + 1}: ${line}`);
  }
  return hits;
}

test("detector: catches $? right after a tee pipe and lets PIPESTATUS and pipefail pass", () => {
  assert.equal(findPipeExitCodeReads("./gradlew test 2>&1 | tee out.txt\necho \"rc=$?\"").length, 1);
  assert.equal(findPipeExitCodeReads("./gradlew test | tee out.txt\n# comment\necho \"rc=$?\"").length, 1);
  assert.equal(findPipeExitCodeReads("./gradlew test | tee out.txt\necho \"rc=${PIPESTATUS[0]}\"").length, 0);
  assert.equal(findPipeExitCodeReads("set -o pipefail\n./gradlew test | tee out.txt\necho \"rc=$?\"").length, 0);
  assert.equal(findPipeExitCodeReads("a || b\necho $?").length, 0);
});

test("payload and repo workflows: do not read the exit code via $? right after a pipe", () => {
  const files = [
    ...listWorkflows(join(ROOT, "payload", "workflows")),
    ...listWorkflows(join(ROOT, ".github", "workflows")),
  ];
  assert.ok(files.length > 0, "no workflow files found");
  const violations = [];
  for (const file of files) {
    for (const hit of findPipeExitCodeReads(readFileSync(file, "utf8"))) {
      violations.push(`${file.slice(ROOT.length)}:${hit}`);
    }
  }
  assert.deepStrictEqual(violations, [], "$? after a pipe is the exit code of the last command — use PIPESTATUS[0]");
});
