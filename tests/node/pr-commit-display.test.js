// tests/node/pr-commit-display.test.js
// On pull_request runs github.sha is the temporary merge commit, which differs from the PR head commit that
// users see. Workflows that run on pull_request must show the head sha (falling back to github.sha elsewhere).
import { test } from "node:test";
import assert from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.ya?ml$/.test(e.name) ? [p] : [];
  });
const read = (f) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");

const PR_FILES = [...walk(join(ROOT, "payload/workflows")), ...walk(join(ROOT, "templates/workflows"))].filter((f) =>
  /^ {2}pull_request:/m.test(read(f)),
);

test("the pull_request-triggered CI workflows are covered", () => {
  const names = PR_FILES.map((f) => f.split(/[\\/]/).pop());
  for (const n of ["PROJECT-FLUTTER-CI.yaml", "PROJECT-GO-CI.yaml", "PROJECT-PYTHON-CI.yaml", "PROJECT-REACT-CI.yaml"]) {
    assert.ok(names.includes(n), `${n} should be covered`);
  }
});

for (const file of PR_FILES) {
  test(`${file.slice(ROOT.length)}: a displayed commit never uses the merge ref sha`, () => {
    const hits = read(file)
      .split("\n")
      .map((l, i) => [i + 1, l])
      // checkout refs, comments and the head-sha fallback expression are allowed
      .filter(([, l]) => /github\.sha|GITHUB_SHA/.test(l) && !/^\s*(#|ref:)/.test(l) && !/pull_request\.head\.sha \|\| github\.sha/.test(l));
    assert.deepStrictEqual(hits, []);
  });
}
