// tests/node/spring-ci-check-run-sha.test.js
// On pull_request events context.sha is the temporary merge commit; the Build Verification check run must be
// created on the PR head commit instead.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const text = readFileSync(join(ROOT, "payload/workflows/spring/PROJECT-SPRING-CI.yml"), "utf8").replace(/\r\n/g, "\n");

test("Spring CI: the check run targets the PR head commit, not context.sha", () => {
  assert.doesNotMatch(text, /head_sha:\s*context\.sha/);
  assert.match(text, /head_sha:\s*context\.payload\.pull_request\?\.head\?\.sha \?\? context\.sha/);
});

// A check run with a job's name is listed twice in the run and twice among the required-check choices (#424).
test("Spring CI: the check run is not named like any job of the workflow", () => {
  const checkRun = text.match(/checks\.create\(\{[\s\S]*?name: '([^']+)'/)?.[1];
  assert.ok(checkRun, "checks.create name not found");
  const jobNames = [...text.matchAll(/^ {4}name: (.+)$/gm)].map((m) => m[1].trim());
  assert.ok(jobNames.length > 0);
  assert.ok(!jobNames.includes(checkRun), `check run "${checkRun}" clashes with a job name`);
});
