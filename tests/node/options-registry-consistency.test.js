// tests/node/options-registry-consistency.test.js
// The option registry (src/core/options.js) drives most wiring, but a few places still have to list every option by hand
// (template, docs, workflow readers). Missing one fails here, so adding an option is "add the entry, then let this test
// point at what is left" - the same approach as type-registry-consistency.test.js.
import "../setup-lang.mjs";
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { OPTIONS, optionVar } from "../../src/core/options.js";
import { helpText } from "../../src/cli/help.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const DOCS = "website/src/content/docs";

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test("version.yml template has a {{OPT_*}} line for every option", () => {
  const tpl = read("payload/version.yml.template");
  for (const o of OPTIONS) {
    assert.ok(tpl.includes(`${o.key}: {{${optionVar(o)}}}`), `${o.key}: missing from payload/version.yml.template`);
  }
});

test("--help lists both flags of every option, in both languages", () => {
  for (const lang of ["en", "ko"]) {
    const h = helpText(lang);
    for (const o of OPTIONS) {
      assert.ok(h.includes(`--${o.flag}`) && h.includes(`--no-${o.flag}`), `${lang}: --help lacks --${o.flag} / --no-${o.flag}`);
    }
  }
});

test("docs list every option: version.yml reference and CLI reference, en and ko", () => {
  for (const prefix of [DOCS, `${DOCS}/ko`]) {
    const versionYml = read(`${prefix}/reference/version-yml.md`);
    const cli = read(`${prefix}/reference/cli.md`);
    for (const o of OPTIONS) {
      assert.ok(versionYml.includes(`| \`${o.key}\` |`), `${prefix}/reference/version-yml.md: no table row for ${o.key}`);
      assert.ok(versionYml.includes(`      ${o.key}: `), `${prefix}/reference/version-yml.md: example block lacks ${o.key}`);
      assert.ok(cli.includes(`\`--${o.flag}\` / \`--no-${o.flag}\``), `${prefix}/reference/cli.md: no table row for --${o.flag}`);
    }
  }
});

// A workflow reads an option with `... options:.*?<key>:\s*\"?(true|false) ... print(m.group(1) if m else "<default>")`.
// The default printed when the key is missing must be the registry's legacyDefault: an existing install lacking the key
// has to behave exactly as the CLI resolves it.
test("workflow readers only read registry keys and fall back to the registry legacyDefault", () => {
  const readers = [];
  for (const f of walk(join(ROOT, "payload/workflows")).filter((p) => /\.ya?ml$/.test(p))) {
    for (const m of readFileSync(f, "utf8").matchAll(/options:\.\*\?(?:\^\\s\+)?(\w+):[^\n]*?print\(m\.group\(1\) if m else "(true|false)"\)/g)) {
      readers.push({ file: f, key: m[1], fallback: m[2] });
    }
  }
  assert.ok(readers.length >= 2, "expected the copilot_ai and release_automerge readers to be found");
  for (const r of readers) {
    const o = OPTIONS.find((x) => x.key === r.key);
    assert.ok(o, `${r.file}: reads "${r.key}" which is not in the option registry`);
    assert.strictEqual(r.fallback, String(o.legacyDefault), `${r.file}: fallback for ${r.key} must equal the registry legacyDefault`);
  }
});
