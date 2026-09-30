// Verify that install-time version detection (detect.js) reads the shared version file examples as expected.
// tests/py/test_version_files_shared.py uses the same examples and expectations, so a parsing change on one side shows up here.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { detectVersionFromFiles, detectBuildNumberFromFiles } from "../../src/core/detect.js";

const ROOT = join(process.cwd(), "tests", "fixtures", "version-files");
const { cases } = JSON.parse(readFileSync(join(ROOT, "expected.json"), "utf8"));

test("shared version files: case folders and expected.json entries match", () => {
  const dirs = readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  assert.deepStrictEqual(dirs.sort(), Object.keys(cases).sort());
});

test("shared version files: both implementations use the same expectations with no per-language exceptions", () => {
  for (const [name, c] of Object.entries(cases)) assert.ok(!("knownDifference" in c), name);
});

for (const [name, c] of Object.entries(cases)) {
  test(`shared version files (JS): ${name}`, () => {
    const dir = join(ROOT, name);
    const read = (rel) => { try { return readFileSync(join(dir, rel), "utf8"); } catch { return null; } };
    const readJson = (rel) => { const s = read(rel); try { return s ? JSON.parse(s) : null; } catch { return null; } };
    const list = (rel) => {
      try { return readdirSync(join(dir, rel), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return null; }
    };
    const warned = [];
    // The git tag fallback is unrelated to file parsing, so clear it. A fallback warning means "not found in file" (null).
    const detected = detectVersionFromFiles({ read, readJson, list, gitTag: "", warn: (m) => warned.push(m), types: [c.type] });
    const buildNumber = detectBuildNumberFromFiles({ types: [c.type], read, readJson, warn: () => {} });
    assert.deepStrictEqual(
      { version: warned.length ? null : detected, buildNumber },
      { version: c.version, buildNumber: c.buildNumber },
    );
  });
}
