// tests/node/fixed-english-guard.test.js
// User-facing text in workflows must come from the message catalog so it follows the `language` setting.
// These phrases were once hard-coded in English and showed up in ko installs.
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
const FILES = [...walk(join(ROOT, "payload/workflows")), ...walk(join(ROOT, "templates/workflows")), ...walk(join(ROOT, ".github/workflows"))].filter(
  // The repo's own release/docs workflows are English-only and not part of the installed set
  (f) => !/[\\/](CI|DOCS-PAGES|NPM-PUBLISH)\.yaml$/.test(f),
);

const FIXED = ["PR Summary (project-auto-wizard)", "CocoaPods installed", "head branch updated from base", "GitHub SHA:", "Secret or Variable"];

for (const file of FILES) {
  test(`${file.slice(ROOT.length)}: no hard-coded English user-facing phrases`, () => {
    const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    // Comments may mention them; only code lines count
    const code = text.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    assert.deepStrictEqual(FIXED.filter((p) => code.includes(p)), []);
  });
}
