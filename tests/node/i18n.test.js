// tests/node/i18n.test.js
// Language resolution, catalog lookup, catalog key parity, --lang parsing and version.yml persistence.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { t, setLanguage, getLanguage, resolveLanguage, SUPPORTED_LANGUAGES } from "../../src/i18n/index.js";
import { CATALOGS } from "../../src/i18n/catalog/index.js";
import { parseArgs, CliError } from "../../src/cli/args.js";
import { helpText } from "../../src/cli/help.js";
import { parseExisting, buildVersionYml } from "../../src/core/version-yml.js";
import { readVersionYmlTemplate } from "../../src/core/assets.js";
import { run } from "../../src/index.js";

const template = readVersionYmlTemplate(join(import.meta.dirname, "../../payload"));
const render = (extra = {}) => buildVersionYml({
  templateText: template, version: "1.0.0", types: ["node"], now: "2026-01-01 00:00:00", today: "2026-01-01", ...extra,
});

// ── catalog ──────────────────────────────────────────────
test("catalog: en and ko define the same key set", () => {
  const keys = (l) => Object.keys(CATALOGS[l]).sort();
  for (const lang of SUPPORTED_LANGUAGES) assert.ok(CATALOGS[lang], `missing catalog: ${lang}`);
  assert.deepStrictEqual(keys("ko"), keys("en"));
});

test("catalog: en and ko use the same {placeholders} per key", () => {
  const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const key of Object.keys(CATALOGS.en)) {
    assert.deepStrictEqual(ph(CATALOGS.ko[key]), ph(CATALOGS.en[key]), key);
  }
});

test("t: params are substituted, unknown placeholders stay, missing key returns the key", () => {
  assert.strictEqual(t("cli.lang.missing", { supported: "en, ko" }, "en"), "--lang requires a value. Supported: en, ko");
  assert.strictEqual(t("cli.lang.missing", {}, "en"), "--lang requires a value. Supported: {supported}");
  assert.strictEqual(t("no.such.key", {}, "en"), "no.such.key");
});

test("t: uses the current language and falls back to en for a key missing in ko", () => {
  const saved = getLanguage();
  try {
    setLanguage("ko");
    assert.match(t("cli.lang.missing", { supported: "en, ko" }), /값이 필요/);
    CATALOGS.en["test.only.en"] = "english only";
    assert.strictEqual(t("test.only.en"), "english only");
    setLanguage("zz"); // unsupported values are ignored
    assert.strictEqual(getLanguage(), "ko");
  } finally {
    delete CATALOGS.en["test.only.en"];
    setLanguage(saved);
  }
});

// ── resolution order ─────────────────────────────────────
test("resolveLanguage: flag > env > saved > en", () => {
  assert.strictEqual(resolveLanguage({}), "en");
  assert.strictEqual(resolveLanguage({ saved: "ko" }), "ko");
  assert.strictEqual(resolveLanguage({ env: "en", saved: "ko" }), "en");
  assert.strictEqual(resolveLanguage({ flag: "ko", env: "en", saved: "en" }), "ko");
  assert.strictEqual(resolveLanguage({ flag: " KO " }), "ko");
});

test("resolveLanguage: unsupported flag/env throws, unsupported saved value falls back to en", () => {
  assert.throws(() => resolveLanguage({ flag: "fr" }), CliError);
  assert.throws(() => resolveLanguage({ env: "fr" }), /PROJECT_AUTO_WIZARD_LANG/);
  assert.strictEqual(resolveLanguage({ saved: "fr" }), "en");
});

// ── --lang parsing / help ────────────────────────────────
test("parseArgs: --lang accepts en/ko (case-insensitive) and rejects the rest", () => {
  assert.strictEqual(parseArgs([]).lang, "");
  assert.strictEqual(parseArgs(["--lang", "ko"]).lang, "ko");
  assert.strictEqual(parseArgs(["--lang", "EN"]).lang, "en");
  assert.throws(() => parseArgs(["--lang"]), CliError);
  assert.throws(() => parseArgs(["--lang", ""]), CliError);
  assert.throws(() => parseArgs(["--lang", "fr"]), /Unsupported language 'fr'/);
});

test("help lists --lang", () => {
  assert.match(helpText(), /--lang LANG/);
});

// ── version.yml persistence ──────────────────────────────
test("version.yml: language defaults to en, is written and parsed back", () => {
  assert.match(render(), /^language: "en"/m);
  const ko = render({ language: "ko" });
  assert.match(ko, /^language: "ko"/m);
  assert.strictEqual(parseExisting(ko).language, "ko");
  assert.strictEqual(parseExisting(render()).language, "en");
});

test("version.yml: missing or unsupported language parses as null and does not leak into extra fields", () => {
  const legacy = render().replace(/^language:.*\n/m, "");
  assert.strictEqual(parseExisting(legacy).language, null);
  const bad = render().replace('language: "en"', 'language: "fr"');
  const parsed = parseExisting(bad);
  assert.strictEqual(parsed.language, null);
  assert.deepStrictEqual(parsed.extraTopLevel, []);
});

// ── end to end: install keeps the saved language on update ──
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "my-app-i18n-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "my-app", version: "1.0.0" }));
  return dir;
}
const install = async (dir, extra = []) => {
  const orig = [console.log, console.error];
  console.log = console.error = () => {};
  const saved = process.env.PROJECT_AUTO_WIZARD_LANG;
  delete process.env.PROJECT_AUTO_WIZARD_LANG;
  try {
    return await run(["--mode", "full", "--force", "--type", "node", "--develop-branch", "main", "--main-branch", "main", ...extra], { cwd: dir });
  } finally {
    [console.log, console.error] = orig;
    if (saved !== undefined) process.env.PROJECT_AUTO_WIZARD_LANG = saved;
  }
};

test("full install writes language and keeps it on a later update without --lang", async () => {
  const dir = makeRepo();
  try {
    assert.strictEqual(await install(dir), 0);
    assert.strictEqual(parseExisting(readFileSync(join(dir, "version.yml"), "utf8")).language, "en");
    assert.strictEqual(await install(dir, ["--lang", "ko"]), 0);
    assert.strictEqual(parseExisting(readFileSync(join(dir, "version.yml"), "utf8")).language, "ko");
    assert.strictEqual(await install(dir), 0); // no flag: the saved value stays
    assert.strictEqual(parseExisting(readFileSync(join(dir, "version.yml"), "utf8")).language, "ko");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("invalid PROJECT_AUTO_WIZARD_LANG fails the run but not --help", async () => {
  const saved = process.env.PROJECT_AUTO_WIZARD_LANG;
  process.env.PROJECT_AUTO_WIZARD_LANG = "fr";
  const orig = [console.log, console.error];
  console.log = console.error = () => {};
  try {
    assert.strictEqual(await run(["--help"]), 0);
    assert.strictEqual(await run(["--mode", "status"], { cwd: tmpdir() }), 1);
  } finally {
    [console.log, console.error] = orig;
    if (saved === undefined) delete process.env.PROJECT_AUTO_WIZARD_LANG; else process.env.PROJECT_AUTO_WIZARD_LANG = saved;
  }
});

// ── notice for existing installs that have no saved language ──
async function capturedInstall(dir, extra = [], env = {}) {
  const errs = [];
  const orig = [console.log, console.error];
  console.log = () => {};
  console.error = (...a) => errs.push(a.join(" "));
  const saved = process.env.PROJECT_AUTO_WIZARD_LANG;
  delete process.env.PROJECT_AUTO_WIZARD_LANG;
  Object.assign(process.env, env);
  try {
    await run(["--mode", "full", "--force", "--type", "node", "--develop-branch", "main", "--main-branch", "main", ...extra], { cwd: dir });
  } finally {
    [console.log, console.error] = orig;
    delete process.env.PROJECT_AUTO_WIZARD_LANG;
    if (saved !== undefined) process.env.PROJECT_AUTO_WIZARD_LANG = saved;
  }
  return errs.join("\n");
}
const NOTICE = t("cli.lang.defaultNotice", {}, "en");

test("update of a version.yml without language prints the default-language notice once", async () => {
  const dir = makeRepo();
  try {
    assert.ok(!(await capturedInstall(dir)).includes(NOTICE), "fresh install: no notice");
    const p = join(dir, "version.yml");
    writeFileSync(p, readFileSync(p, "utf8").replace(/^language:.*\n/m, ""));
    assert.ok((await capturedInstall(dir)).includes(NOTICE), "existing install without language: notice");
    assert.ok(!(await capturedInstall(dir)).includes(NOTICE), "language is now saved: no notice");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unsupported saved language gets its own notice, not the 'now default to English' one", async () => {
  const dir = makeRepo();
  try {
    assert.strictEqual(await install(dir), 0);
    const p = join(dir, "version.yml");
    writeFileSync(p, readFileSync(p, "utf8").replace(/^language:.*$/m, 'language: "fr"'));
    const out = await capturedInstall(dir);
    assert.ok(out.includes(t("cli.lang.unsupportedSavedNotice", { value: "fr", supported: "en, ko" }, "en")), out);
    assert.ok(!out.includes(NOTICE), "must not read as if the install used to be Korean");
    assert.ok(!(await capturedInstall(dir)).includes("'fr'"), "the value is normalized on update, so the notice appears once");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the environment variable does not overwrite a saved language; --lang does; a first install saves it", async () => {
  const dir = makeRepo();
  try {
    const p = join(dir, "version.yml");
    const saved = () => /^language:\s*"?(\w+)/m.exec(readFileSync(p, "utf8").replace(/\r\n/g, "\n"))?.[1];
    // first install: nothing saved yet, so the env value is what gets stored
    await capturedInstall(dir, [], { PROJECT_AUTO_WIZARD_LANG: "ko" });
    assert.strictEqual(saved(), "ko");
    // a one-off run with another language leaves the saved choice alone
    await capturedInstall(dir, [], { PROJECT_AUTO_WIZARD_LANG: "en" });
    assert.strictEqual(saved(), "ko");
    await capturedInstall(dir);
    assert.strictEqual(saved(), "ko");
    // an explicit --lang changes it, even with the env set
    await capturedInstall(dir, ["--lang", "en"], { PROJECT_AUTO_WIZARD_LANG: "ko" });
    assert.strictEqual(saved(), "en");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no notice when --lang or the environment variable decides the language", async () => {
  const dir = makeRepo();
  try {
    assert.strictEqual(await install(dir), 0);
    const p = join(dir, "version.yml");
    const strip = () => writeFileSync(p, readFileSync(p, "utf8").replace(/^language:.*\n/m, ""));
    strip();
    assert.ok(!(await capturedInstall(dir, ["--lang", "ko"])).includes(NOTICE));
    strip();
    assert.ok(!(await capturedInstall(dir, [], { PROJECT_AUTO_WIZARD_LANG: "en" })).includes(NOTICE));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
