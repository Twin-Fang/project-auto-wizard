// tests/node/log-format.test.js
// Keeps the wording and format of user-facing log/comment output consistent across workflows.
import { test } from "node:test";
import assert from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : (/\.ya?ml$/.test(e.name) ? [p] : []);
  });
}

const WORKFLOW_DIRS = ["payload/workflows", "templates/workflows"].map((d) => join(REPO_ROOT, d));

test("displayed timestamps are UTC with an explicit UTC suffix", () => {
  const hits = [];
  for (const file of WORKFLOW_DIRS.flatMap(walk)) {
    readFileSync(file, "utf8").split("\n").forEach((l, i) => {
      // A displayed time (with seconds) must come from `date -u ... UTC`; machine timestamps end in Z and are exempt.
      if (/date\s+'\+%Y-%m-%d %H:%M:%S( UTC)?'/.test(l) && !/date -u '\+%Y-%m-%d %H:%M:%S UTC'/.test(l)) hits.push(`${file.slice(REPO_ROOT.length)}:${i + 1}`);
      if (l.includes("toLocaleString")) hits.push(`${file.slice(REPO_ROOT.length)}:${i + 1}: locale-formatted time`);
    });
  }
  assert.deepStrictEqual(hits, []);
});

test("secret precheck messages use one wording", () => {
  const src = readFileSync(join(REPO_ROOT, "payload", "scripts", "messages.py"), "utf8");
  assert.ok(!/GitHub [Ss]ecrets not registered/.test(src), "use 'Required GitHub Secrets are empty:'");
  assert.ok(!src.includes("등록되지 않은 GitHub Secret"), "use the same Korean wording everywhere");
});
