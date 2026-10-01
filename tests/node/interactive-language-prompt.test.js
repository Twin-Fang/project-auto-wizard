// tests/node/interactive-language-prompt.test.js
// runInteractive asks the language before the banner when the caller says none is known yet (askLanguage),
// and the pick wins over every other source when the install is written.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInteractive } from "../../src/commands/interactive.js";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { parseExisting } from "../../src/core/version-yml.js";
import { setLanguage, getLanguage } from "../../src/i18n/index.js";
import { CANCEL } from "../../src/ui/prompts.js";

function springFixture() {
  const target = mkdtempSync(join(tmpdir(), "paw-language-prompt-"));
  writeFileSync(join(target, "build.gradle.kts"), 'version = "1.0.0"\n');
  return target;
}

function installedBasicFixture() {
  const target = mkdtempSync(join(tmpdir(), "paw-language-prompt-installed-"));
  const ctx = createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(), now: "2026-08-05 00:00:00", today: "2026-08-05", templateVersion: "0.1.0",
  });
  runFull(ctx, resolvePayloadRoot(), target);
  return target;
}

function rewriteVersionYml(target, transform) {
  const path = join(target, "version.yml");
  writeFileSync(path, transform(readFileSync(path, "utf8")));
}

const installedLanguage = (target) => parseExisting(readFileSync(join(target, "version.yml"), "utf8")).language;

// A full-install stub. selectLanguage is optional on purpose: the existing stubs do not have it.
function stubIo({ selectLanguage, selectMode = async () => "full" } = {}) {
  const order = [];
  const io = {
    selectMode: async (arg) => { order.push("selectMode"); return selectMode(arg); },
    intro: () => order.push("intro"),
    banner: () => order.push("banner"),
    confirmProjectMenu: async () => "continue",
    askYesNo: async (_m, def) => def,
    askText: async (_m, def) => def,
    selectDeployStyle: async () => "simple",
    selectBranchStrategy: async () => "pr-flow",
    confirmTypes: async ({ types }) => types,
    note: () => {},
    cancelMessage: () => {},
    summary: () => {},
    outro: () => {},
  };
  if (selectLanguage) io.selectLanguage = async () => { order.push("selectLanguage"); return selectLanguage(); };
  return { io, order };
}

// setup-lang.mjs puts the process on ko; start from en so a fallback to the module language cannot pass by accident.
async function withLanguageRestored(fn) {
  const saved = getLanguage();
  setLanguage("en");
  try {
    return await fn();
  } finally {
    setLanguage(saved);
  }
}

test("a picked language is asked once before the banner and stored in version.yml", async () => {
  await withLanguageRestored(async () => {
    const target = springFixture();
    try {
      const { io, order } = stubIo({ selectLanguage: () => "ko" });
      assert.strictEqual(await runInteractive({ askLanguage: true, language: null }, { cwd: target, io }), 0);
      assert.strictEqual(order.filter((s) => s === "selectLanguage").length, 1);
      assert.ok(order.indexOf("selectLanguage") < order.findIndex((s) => s === "banner" || s === "intro"));
      assert.strictEqual(installedLanguage(target), "ko");
    } finally { rmSync(target, { recursive: true, force: true }); }
  });
});

test("the pick wins over a language the caller already carried", async () => {
  await withLanguageRestored(async () => {
    const target = springFixture();
    try {
      const { io } = stubIo({ selectLanguage: () => "ko" });
      await runInteractive({ askLanguage: true, language: "en" }, { cwd: target, io });
      assert.strictEqual(installedLanguage(target), "ko");
    } finally { rmSync(target, { recursive: true, force: true }); }
  });
});

test("cancelling the language question falls back to en", async () => {
  await withLanguageRestored(async () => {
    const target = springFixture();
    try {
      const { io } = stubIo({ selectLanguage: () => CANCEL });
      assert.strictEqual(await runInteractive({ askLanguage: true, language: null }, { cwd: target, io }), 0);
      assert.strictEqual(installedLanguage(target), "en");
    } finally { rmSync(target, { recursive: true, force: true }); }
  });
});

test("the language is not asked when askLanguage is not set", async () => {
  await withLanguageRestored(async () => {
    const target = springFixture();
    try {
      const { io, order } = stubIo({ selectLanguage: () => "ko" });
      await runInteractive({ language: "en" }, { cwd: target, io });
      assert.ok(!order.includes("selectLanguage"));
      assert.strictEqual(installedLanguage(target), "en");
    } finally { rmSync(target, { recursive: true, force: true }); }
  });
});

test("an io without a language prompt still works when askLanguage is set", async () => {
  await withLanguageRestored(async () => {
    const target = springFixture();
    try {
      const { io } = stubIo();
      assert.strictEqual(await runInteractive({ askLanguage: true, language: null }, { cwd: target, io }), 0);
    } finally { rmSync(target, { recursive: true, force: true }); }
  });
});

test("returning to the menu after status and doctor does not ask the language again", async () => {
  await withLanguageRestored(async () => {
    const target = installedBasicFixture();
    try {
      const answers = ["status", "doctor"];
      const { io, order } = stubIo({
        selectLanguage: () => "en",
        selectMode: async () => answers.shift() ?? null,
      });
      assert.strictEqual(await runInteractive({ askLanguage: true, language: null }, { cwd: target, io }), 0);
      assert.strictEqual(order.filter((s) => s === "selectLanguage").length, 1);
      assert.strictEqual(order.filter((s) => s === "selectMode").length, 3);
    } finally { rmSync(target, { recursive: true, force: true }); }
  });
});

test("choosing uninstall from the menu asks the language once and does not write the pick", async () => {
  await withLanguageRestored(async () => {
    const target = installedBasicFixture();
    try {
      const before = readFileSync(join(target, "version.yml"), "utf8");
      const { io, order } = stubIo({ selectLanguage: () => "ko", selectMode: async () => "uninstall" });
      io.engineIo = { multiselect: async () => [] };
      io.askYesNo = async () => false;
      await runInteractive({ askLanguage: true, language: null }, { cwd: target, io });
      assert.strictEqual(order.filter((s) => s === "selectLanguage").length, 1);
      assert.strictEqual(readFileSync(join(target, "version.yml"), "utf8"), before);
    } finally { rmSync(target, { recursive: true, force: true }); }
  });
});

test("reinstalling an install that has no language line stores the pick", async () => {
  await withLanguageRestored(async () => {
    const target = installedBasicFixture();
    try {
      rewriteVersionYml(target, (text) => text.replace(/^language:.*\n/m, ""));
      assert.strictEqual(installedLanguage(target), null);
      const { io } = stubIo({ selectLanguage: () => "ko" });
      await runInteractive({ askLanguage: true, language: null }, { cwd: target, io });
      assert.strictEqual(installedLanguage(target), "ko");
    } finally { rmSync(target, { recursive: true, force: true }); }
  });
});

test("an unsupported saved language is replaced by the pick", async () => {
  await withLanguageRestored(async () => {
    const target = installedBasicFixture();
    try {
      rewriteVersionYml(target, (text) => text.replace(/^language:.*$/m, 'language: "fr"'));
      assert.strictEqual(installedLanguage(target), null);
      const { io } = stubIo({ selectLanguage: () => "ko" });
      await runInteractive({ askLanguage: true, language: null }, { cwd: target, io });
      assert.strictEqual(installedLanguage(target), "ko");
    } finally { rmSync(target, { recursive: true, force: true }); }
  });
});
