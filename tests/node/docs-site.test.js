// tests/node/docs-site.test.js
// Verifies the docs site (website/) does not drift from the CLI and package.
//   1) command examples on the site are parsed by the current parser (catches renaming an option and forgetting the site)
//   2) the --help output copied into the CLI reference equals the actual helpText()
//   3) site files are not caught by the root `node --test` default discovery patterns
//   4) the site is not mixed into the root package (0 dependencies, npm files) or the Pages workflow trigger
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../../src/cli/args.js";
import { helpText } from "../../src/cli/help.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DOCS_DIR = join(REPO_ROOT, "website", "src", "content", "docs");
// Installed and build outputs are not site sources
const SKIP_DIRS = new Set(["node_modules", "dist", ".astro"]);

function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, acc); }
    else acc.push(p);
  }
  return acc;
}

const docPages = () => walk(DOCS_DIR).filter((p) => /\.mdx?$/.test(p));

test("all command examples on the docs site are parsed by the current parser", () => {
  let count = 0;
  for (const file of docPages()) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/npx project-auto-wizard(?:@latest)?((?:\s[^#`|]*)?)/);
      if (!m) continue;
      const args = [...m[1].matchAll(/"([^"]*)"|(\S+)/g)].map((t) => t[1] ?? t[2]);
      if (args.includes("[옵션]") || args.includes("[options]")) continue; // usage line
      count++;
      assert.doesNotThrow(() => parseArgs(args), `${relative(REPO_ROOT, file)}: unrunnable example: ${line.trim()}`);
    }
  }
  assert.ok(count > 0, "at least one example must be found");
});

test("the --help block in the CLI reference equals the actual help text", () => {
  for (const [rel, lang] of [["reference/cli.md", "en"], ["ko/reference/cli.md", "ko"]]) {
    const text = readFileSync(join(DOCS_DIR, rel), "utf8");
    const m = text.match(/```text\n([\s\S]*?)\n```/);
    assert.ok(m, `${rel}: no --help code block`);
    assert.strictEqual(m[1], helpText(lang).replace(/\n+$/, ""), `${rel}: differs from the --help output — if you changed the help, update the docs too`);
  }
});

test("site sources are not caught by the root node --test default discovery patterns", () => {
  // node --test default patterns: *.test.*, *-test.*, *_test.*, test-*.*, test.*, js under test/
  const pattern = /(^|[\\/])(test|[^\\/]*[.\-_]test|test-[^\\/]*)\.[cm]?js$|[\\/]test[\\/].*\.[cm]?js$/;
  const hits = walk(join(REPO_ROOT, "website")).map((p) => relative(REPO_ROOT, p)).filter((p) => pattern.test(p));
  assert.deepStrictEqual(hits, []);
});

test("the root package has 0 dependencies and does not ship the site in the npm package", () => {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  assert.strictEqual(pkg.dependencies, undefined);
  assert.strictEqual(pkg.devDependencies, undefined);
  assert.ok(!pkg.files.some((f) => f.includes("website")), `files contains website: ${pkg.files}`);
});

test("the Pages workflow reacts only to website changes on main and manual runs", () => {
  const wf = readFileSync(join(REPO_ROOT, ".github", "workflows", "DOCS-PAGES.yaml"), "utf8");
  const on = wf.slice(wf.indexOf("\non:"), wf.indexOf("\nconcurrency:"));
  assert.match(on, /push:\n\s+branches: \["main"\]\n\s+paths:\n\s+- "website\/\*\*"/);
  assert.match(on, /workflow_dispatch:/);
  assert.doesNotMatch(on, /pull_request|release:|workflow_run/);
  assert.match(wf, /pages: write/);
  assert.match(wf, /id-token: write/);
});
