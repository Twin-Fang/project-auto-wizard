// Verify that command examples in the docs and help run as-is with the current parser.
// Removing or renaming a mode or option without updating the examples fails here.
import "../setup-lang.mjs"; // these tests assert the ko output
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { parseArgs } from "../../src/cli/args.js";
import { helpText } from "../../src/cli/help.js";

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");

// Extract only the args from "npx project-auto-wizard ..." / "node bin/project-auto-wizard.js ..." lines.
// Group double-quoted args into one and drop trailing # comments.
function extractCommands(text) {
  const cmds = [];
  for (const line of text.split("\n")) {
    const m = line.match(/(?:npx project-auto-wizard|node bin\/project-auto-wizard\.js)((?:\s[^#`|]*)?)/);
    if (!m) continue;
    const args = [...m[1].matchAll(/"([^"]*)"|(\S+)/g)].map((t) => t[1] ?? t[2]);
    if (args.includes("[옵션]")) continue; // usage line
    cmds.push({ line: line.trim(), args });
  }
  return cmds;
}

const README_FILES = ["README.md", "README.ko.md", "README.zh-CN.md", "README.ja.md"];

for (const [name, text] of [["--help", helpText()], ...README_FILES.map((f) => [f, read(f)]), ["CONTRIBUTING.md", read("CONTRIBUTING.md")]]) {
  test(`${name} command examples all parse with the current parser`, () => {
    const cmds = extractCommands(text);
    assert.ok(cmds.length > 0, "must find at least one example");
    for (const { line, args } of cmds) {
      assert.doesNotThrow(() => parseArgs(args), `example cannot run: ${line}`);
    }
  });
}

test("removed modes and options do not remain in the docs and help", () => {
  const docs = { "--help": helpText(), ...Object.fromEntries(README_FILES.map((f) => [f, read(f)])), "ROADMAP.md": read("ROADMAP.md") };
  for (const [name, text] of Object.entries(docs)) {
    for (const stale of ["--mode workflows", "--mode version", "--mode revert", "full/version/workflows", "--no-nexus", "--no-secret-backup"]) {
      assert.ok(!text.includes(stale), `'${stale}' remains in ${name}`);
    }
  }
});
