// tests/node/action-versions.test.js
// Actions pinned to a major that still runs on Node 20 or older print a deprecation warning on every run.
// This list holds the majors that were replaced by a Node 24 major; it must not come back.
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

const OUTDATED = [
  /gradle\/wrapper-validation-action@/,
  /gradle\/actions\/setup-gradle@v[1-4]\b/,
  /golangci\/golangci-lint-action@v[1-8]\b/,
  /docker\/(setup-buildx|login)-action@v[1-3]\b/,
  /docker\/build-push-action@v[1-6]\b/,
  /Apple-Actions\/import-codesign-certs@v[1-5]\b/,
];

test("workflows do not use action majors that run on Node 20 or older", () => {
  const hits = [];
  const dirs = ["payload/workflows", "templates/workflows", ".github/workflows"].map((d) => join(REPO_ROOT, d));
  for (const file of dirs.flatMap(walk)) {
    readFileSync(file, "utf8").split("\n").forEach((l, i) => {
      if (/^\s*(- )?uses:/.test(l) && OUTDATED.some((re) => re.test(l))) hits.push(`${file.slice(REPO_ROOT.length)}:${i + 1}: ${l.trim()}`);
    });
  }
  assert.deepStrictEqual(hits, [], hits.join("\n"));
});
