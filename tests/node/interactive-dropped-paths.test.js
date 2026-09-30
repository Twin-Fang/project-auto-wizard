// tests/node/interactive-dropped-paths.test.js
// The "react and next were merged" note must follow the folder chosen in the path questions,
// not the folder saved in version.yml before the user answered.
import "../setup-lang.mjs";
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInteractive } from "../../src/commands/interactive.js";
import { setLanguage } from "../../src/i18n/index.js";

const VY = [
  'version: "1.0.0"',
  'project_types: ["react", "next"]',
  "project_paths:",
  '  react: "client"',
  '  next: "web"',
  "",
].join("\n");

// Two React folders exist, so the path question is asked; `pick` is the answer.
async function runWith(pick) {
  const target = mkdtempSync(join(tmpdir(), "paw-dropped-"));
  const notes = [];
  const ttyDesc = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  try {
    for (const d of ["client", "web"]) {
      mkdirSync(join(target, d));
      writeFileSync(join(target, d, "package.json"), JSON.stringify({ dependencies: { react: "18.0.0" } }));
    }
    writeFileSync(join(target, "version.yml"), VY);
    const io = {
      selectMode: async () => "full",
      confirmProjectMenu: async () => "continue",
      confirmTypes: async ({ types }) => types,
      selectDeployStyle: async () => "simple",
      selectBranchStrategy: async () => "pr-flow",
      askYesNo: async (_m, def) => def,
      askText: async (_m, def) => def,
      note: (text, title) => notes.push({ text, title }),
      cancelMessage: () => {},
      summary: () => {},
      outro: () => {},
      editMenu: async () => "done",
      engineIo: { log: () => {}, select: async ({ options }) => (options.some((o) => o.value === pick) ? pick : "all"), multiselect: async () => [], text: async () => pick, confirm: async () => true },
    };
    // The path questions only run on a real terminal.
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    await runInteractive({}, { cwd: target, io });
    return notes;
  } finally {
    if (ttyDesc) Object.defineProperty(process.stdout, "isTTY", ttyDesc); else delete process.stdout.isTTY;
    rmSync(target, { recursive: true, force: true });
  }
}

const mergedNote = (notes) => notes.filter((n) => /client|web/.test(n.text) && /react/.test(n.text));

for (const lang of ["en", "ko"]) {
  test(`interactive (${lang}): the merge note reflects the folder picked later, not the saved one`, async () => {
    setLanguage(lang);
    try {
      const keepSaved = mergedNote(await runWith("client"));
      const pickOther = mergedNote(await runWith("web"));
      assert.strictEqual(keepSaved.length, 1);
      assert.strictEqual(pickOther.length, 1);
      assert.match(keepSaved[0].text, /react=client/);
      assert.match(pickOther[0].text, /react=web/);
      assert.doesNotMatch(pickOther[0].text, /react=client/);
    } finally { setLanguage("ko"); }
  });
}
