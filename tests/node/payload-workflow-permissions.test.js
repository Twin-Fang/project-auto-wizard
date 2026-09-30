// tests/node/payload-workflow-permissions.test.js
// Pins the basis on which doctor can downgrade Workflow permissions to INFO.
// The wizard workflows work even when the repo's default_workflow_permissions is read
// because each workflow declares its own permissions — if this premise breaks, the doctor message becomes false too.
import { test } from "node:test";
import assert from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const COMMON_DIR = join(REPO_ROOT, "payload", "workflows", "common");

test("every payload common workflow declares permissions explicitly", () => {
  const files = readdirSync(COMMON_DIR).filter((n) => n.endsWith(".yaml") || n.endsWith(".yml"));
  assert.ok(files.length > 0, "no workflows in payload/workflows/common");
  for (const f of files) {
    const text = readFileSync(join(COMMON_DIR, f), "utf8");
    assert.match(text, /^permissions:/m, `${f} has no top-level permissions declaration`);
  }
});

// Workflows that commit and push must have contents: write.
test("common workflows that push commits declare contents: write", () => {
  const NEEDS_WRITE = [
    "PROJECT-COMMON-VERSION-CONTROL.yaml",
    "PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml",
    "PROJECT-COMMON-README-VERSION-UPDATE.yaml",
    "PROJECT-COMMON-RELEASE-PUBLISH.yaml",
  ];
  for (const f of NEEDS_WRITE) {
    const text = readFileSync(join(COMMON_DIR, f), "utf8");
    assert.match(text, /^permissions:[\s\S]*?^\s+contents:\s*write/m, `${f} lacks contents: write`);
  }
});

// The same applies to per-type workflows — writing (comments, push) with GITHUB_TOKEN without permissions
// fails under the repo default permission (read). The install summary and README claim that "default Read is enough" would become false.
const WRITE_OPS = /github\.rest\.(issues|pulls|repos)\.(create|update|delete)\w*|git push|gh (pr|issue) (comment|merge|create)|gh release create|gh workflow run/;

test("every payload workflow that performs writes declares permissions", () => {
  const root = join(REPO_ROOT, "payload", "workflows");
  const files = readdirSync(root, { recursive: true }).filter((n) => /\.ya?ml$/.test(n));
  let checked = 0;
  for (const f of files) {
    const text = readFileSync(join(root, f), "utf8");
    if (!WRITE_OPS.test(text)) continue;
    checked++;
    assert.match(text, /^\s*permissions:/m, `${f} performs writes but has no permissions declaration`);
  }
  assert.ok(checked > 0);
});
