// tests/node/version-yml-reinstall-stable.test.js
// A reinstall must leave version.yml alone when nothing changed: the comment spacing on version_code is the same
// in the installer and in version_manager.py, and metadata.last_updated_by recorded by the release scripts is kept.
import "../setup-lang.mjs";
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { parseExisting, sameIgnoringTimestamps } from "../../src/core/version-yml.js";
import { run } from "../../src/index.js";

const ROOT = join(import.meta.dirname, "..", "..");
const CLOCK = { now: "2026-09-01 00:00:00", today: "2026-09-01" };

async function install(dir) {
  const orig = [console.log, console.error];
  console.log = console.error = () => {};
  try {
    return await run(["--mode", "full", "--force", "--type", "node", "--main-branch", "main", "--develop-branch", "main"], { cwd: dir, clock: CLOCK });
  } finally {
    [console.log, console.error] = orig;
  }
}

test("parseExisting: reads last_updated_by (quoted, escaped, unquoted) and null when absent", () => {
  assert.strictEqual(parseExisting('metadata:\n  last_updated_by: "octocat"\n').lastUpdatedBy, "octocat");
  assert.strictEqual(parseExisting('metadata:\n  last_updated_by: "a \\"b\\" c" # note\n').lastUpdatedBy, 'a "b" c');
  assert.strictEqual(parseExisting("metadata:\n  last_updated_by: octocat\n").lastUpdatedBy, "octocat");
  assert.strictEqual(parseExisting('version: "1.0.0"\n').lastUpdatedBy, null);
});

test("reinstall after a release-script bump keeps version_code spacing and last_updated_by, and does not rewrite the file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "my-app-stable-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "my-app", version: "1.0.0" }));
    assert.strictEqual(await install(dir), 0);
    const vy = join(dir, "version.yml");
    const fresh = readFileSync(vy, "utf8").replace(/\r\n/g, "\n");
    assert.match(fresh, /^version_code: \d+ # app build number$/m);
    assert.match(fresh, /^ {2}last_updated_by: "project-auto-wizard"$/m);

    // What the release workflow does: bump the build number and record the acting user
    mkdirSync(join(dir, ".github", "scripts"), { recursive: true });
    for (const f of ["version_manager.py", "messages.py"]) copyFileSync(join(ROOT, "payload/scripts", f), join(dir, ".github", "scripts", f));
    writeFileSync(vy, fresh.replace('last_updated_by: "project-auto-wizard"', 'last_updated_by: "octocat"'));
    const env = { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1", PROJECT_AUTO_WIZARD_LANG: "en" };
    const r = spawnSync("python3", [join(dir, ".github", "scripts", "version_manager.py"), "increment-code"], { cwd: dir, env, encoding: "utf-8" });
    assert.strictEqual(r.status, 0, `${r.stdout}${r.stderr}`);
    const bumped = readFileSync(vy, "utf8").replace(/\r\n/g, "\n");
    assert.match(bumped, /^version_code: 2 # app build number$/m);

    assert.strictEqual(await install(dir), 0);
    const after = readFileSync(vy, "utf8").replace(/\r\n/g, "\n");
    assert.match(after, /^ {2}last_updated_by: "octocat"$/m);
    assert.match(after, /^version_code: 2 # app build number$/m);
    assert.ok(sameIgnoringTimestamps(bumped, after), "a no-op reinstall should not change anything but the timestamps");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
