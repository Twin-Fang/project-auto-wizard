// tests/node/version-yml-install-date.test.js
// A reinstall keeps the original install date (metadata.integration_date / template.integrated_date);
// the reinstall itself is still recorded by last_updated / last_update_date.
import "../setup-lang.mjs";
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseExisting } from "../../src/core/version-yml.js";
import { run } from "../../src/index.js";

const FIRST = { now: "2026-09-30 00:00:00", today: "2026-09-30" };
const SECOND = { now: "2026-10-01 00:00:00", today: "2026-10-01" };

async function install(dir, clock, branchArgs = ["--develop-branch", "main"]) {
  const orig = [console.log, console.error];
  console.log = console.error = () => {};
  try {
    return await run(["--mode", "full", "--force", "--type", "node", "--main-branch", "main", ...branchArgs],{ cwd: dir, clock });
  } finally {
    [console.log, console.error] = orig;
  }
}

test("parseExisting: reads the install dates and null when absent", () => {
  const parsed = parseExisting('metadata:\n  integration_date: "2026-07-09"\n  template:\n    integrated_date: "2026-07-10"\n');
  assert.strictEqual(parsed.integrationDate, "2026-07-09");
  assert.strictEqual(parsed.integratedDate, "2026-07-10");
  assert.strictEqual(parseExisting('version: "1.0.0"\n').integrationDate, null);
  assert.strictEqual(parseExisting('version: "1.0.0"\n').integratedDate, null);
});

test("fresh install writes today; reinstall keeps the install dates but refreshes last_update_date", async () => {
  const dir = mkdtempSync(join(tmpdir(), "my-app-install-date-"));
  try {
    writeFileSync(join(dir, "package.json"),JSON.stringify({ name: "my-app", version: "1.0.0" }));
    assert.strictEqual(await install(dir, FIRST), 0);
    const vy = join(dir, "version.yml");
    const fresh = readFileSync(vy, "utf8");
    assert.match(fresh, /^ {2}integration_date: "2026-09-30"$/m);
    assert.match(fresh, /^ {4}integrated_date: "2026-09-30"$/m);

    // A real change (the develop branch) forces the rewrite, so the date lines are re-rendered
    assert.strictEqual(await install(dir, SECOND, ["--develop-branch", "develop"]), 0);
    const after = readFileSync(vy, "utf8");
    assert.match(after, /^ {6}develop: "develop"$/m);
    assert.match(after, /^ {2}integration_date: "2026-09-30"$/m);
    assert.match(after, /^ {4}integrated_date: "2026-09-30"$/m);
    assert.match(after, /^ {4}last_update_date: "2026-10-01"$/m);
    assert.match(after, /^ {2}last_updated: "2026-10-01 00:00:00"$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
