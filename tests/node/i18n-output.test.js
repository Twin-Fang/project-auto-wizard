// tests/node/i18n-output.test.js
// Message catalog integrity and end-to-end output language: default (en) output has no Hangul,
// --lang ko output uses the ko catalog, and src/ keeps Hangul only inside the ko catalog.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CATALOGS } from "../../src/i18n/catalog/index.js";
import { PARTS as EN_PARTS } from "../../src/i18n/catalog/en.js";
import { PARTS as KO_PARTS } from "../../src/i18n/catalog/ko.js";
import { setLanguage, getLanguage } from "../../src/i18n/index.js";
import { run } from "../../src/index.js";
import * as prompts from "../../src/ui/prompts.js";

const HANGUL = /[ㄱ-ㆎ가-힣]/;
const root = join(import.meta.dirname, "../..");

delete process.env.TERM;

// ── catalog integrity ────────────────────────────────────
test("catalog: a key is defined in one part only, and en/ko parts have the same keys", () => {
  const seen = new Map();
  for (const [part, msgs] of Object.entries(EN_PARTS)) {
    for (const key of Object.keys(msgs)) {
      assert.ok(!seen.has(key), `duplicate key ${key} in parts ${seen.get(key)} and ${part}`);
      seen.set(key, part);
    }
    assert.deepStrictEqual(Object.keys(KO_PARTS[part]).sort(), Object.keys(msgs).sort(), `part ${part}`);
  }
  assert.strictEqual(Object.keys(CATALOGS.en).length, seen.size);
});

test("catalog: en messages contain no Hangul and no message is empty", () => {
  for (const [key, text] of Object.entries(CATALOGS.en)) {
    assert.ok(!HANGUL.test(text), `en has Hangul: ${key}`);
    assert.ok(text.length > 0 || CATALOGS.ko[key].length === 0, `empty en message: ${key}`);
  }
});

// ── src/ keeps Hangul inside the ko catalog only ──────────
test("src/ and bin/ contain Hangul only in the ko catalog", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) { if (p !== join(root, "src/i18n/catalog/ko")) walk(p); continue; }
      if (p === join(root, "src/i18n/catalog/ko.js")) continue; // entry file of the ko catalog
      if (!/\.(js|mjs)$/.test(ent.name)) continue;
      if (HANGUL.test(readFileSync(p, "utf8"))) offenders.push(p.slice(root.length + 1));
    }
  };
  walk(join(root, "src"));
  walk(join(root, "bin"));
  assert.deepStrictEqual(offenders, []);
});

// ── CLI output language ──────────────────────────────────
async function cli(args, cwd, lang) {
  const out = [];
  const orig = [console.log, console.error, process.stderr.write, process.stdout.write];
  const push = (...a) => { out.push(a.join(" ")); };
  console.log = console.error = push;
  process.stderr.write = process.stdout.write = (chunk) => { out.push(String(chunk)); return true; };
  let code;
  try {
    code = await run(lang ? [...args, "--lang", lang] : args, { cwd });
  } finally {
    [console.log, console.error, process.stderr.write, process.stdout.write] = orig;
  }
  return { code, text: out.join("\n") };
}

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "my-app-i18n-out-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "my-app", version: "1.0.0" }));
  return dir;
}

test("default (en) output: help, errors, status, dry-run, install, re-run, uninstall have no Hangul", async () => {
  const dir = repo();
  const saved = getLanguage();
  const savedEnv = process.env.PROJECT_AUTO_WIZARD_LANG;
  delete process.env.PROJECT_AUTO_WIZARD_LANG; // no flag, no env, no saved value: the built-in default applies
  setLanguage("en");
  try {
    const steps = [
      [["--help"], 0, /Usage:/],
      [["--bogus"], 1, /./],
      [["--mode", "zzz"], 1, /./],
      [["--mode", "full"], 1, /--force/],
      [["--dry-run"], 1, /--dry-run/],
      [["--mode", "status"], 0, /not installed/i],
      [["--mode", "full", "--force", "--type", "node", "--main-branch", "main", "--develop-branch", "main", "--dry-run"], 0, /dry-run/],
      [["--mode", "full", "--force", "--type", "node", "--main-branch", "main", "--develop-branch", "main"], 0, /./],
      [["--mode", "full", "--force", "--type", "node", "--main-branch", "main", "--develop-branch", "main"], 0, /./],
      [["--mode", "status"], 0, /Version/],
      [["--mode", "doctor"], null, /./],
      [["--mode", "uninstall", "--force", "--dry-run"], 0, /./],
      [["--mode", "uninstall", "--force", "--purge-readme", "--purge-gitignore", "--purge-version"], 0, /./],
    ];
    for (const [args, code, re] of steps) {
      const r = await cli(args, dir);
      if (code !== null) assert.strictEqual(r.code, code, `${args.join(" ")}\n${r.text}`);
      assert.doesNotMatch(r.text, HANGUL, `Hangul in en output of: ${args.join(" ")}\n${r.text}`);
      assert.match(r.text, re, args.join(" "));
    }
    // Files written by the install (README section, .gitignore, logs) are English too.
    const files = ["README.md", ".gitignore"];
    for (const f of files) {
      try { assert.doesNotMatch(readFileSync(join(dir, f), "utf8"), HANGUL, f); } catch (e) { if (e.code !== "ENOENT") throw e; }
    }
  } finally {
    setLanguage(saved);
    if (savedEnv !== undefined) process.env.PROJECT_AUTO_WIZARD_LANG = savedEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--lang ko output uses the ko catalog for help, errors, status and install", async () => {
  const dir = repo();
  const saved = getLanguage();
  try {
    assert.match((await cli(["--help"], dir, "ko")).text, /사용법:/);
    const bad = await cli(["--bogus"], dir, "ko");
    assert.strictEqual(bad.code, 1);
    assert.match(bad.text, HANGUL);
    assert.match((await cli(["--mode", "status"], dir, "ko")).text, /설치되어 있지 않/);
    const r = await cli(["--mode", "full", "--force", "--type", "node", "--main-branch", "main", "--develop-branch", "main"], dir, "ko");
    assert.strictEqual(r.code, 0);
    assert.match(r.text, HANGUL);
  } finally {
    setLanguage(saved);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the language flag also applies to argument errors (parse happens before language resolution)", async () => {
  const saved = getLanguage();
  try {
    const en = await cli(["--bogus"], tmpdir(), "en");
    const ko = await cli(["--bogus"], tmpdir(), "ko");
    assert.doesNotMatch(en.text, HANGUL);
    assert.match(ko.text, HANGUL);
    assert.notStrictEqual(en.text, ko.text);
  } finally {
    setLanguage(saved);
  }
});

// ── interactive prompts ──────────────────────────────────
// Drives the real prompt functions through a fake TTY, once per language.
async function driveTty(fn, keys) {
  const { stdin, stdout } = process;
  const saved = { isTTY: stdin.isTTY, setRawMode: stdin.setRawMode, columns: stdout.columns, write: stdout.write };
  stdin.isTTY = true;
  stdin.setRawMode = () => stdin;
  stdout.columns = 100;
  let output = "";
  stdout.write = (chunk, ...rest) => (typeof chunk === "string" ? ((output += chunk), true) : saved.write.call(stdout, chunk, ...rest));
  try {
    const p = fn();
    for (const k of keys) await new Promise((r) => setImmediate(() => { process.stdin.emit("keypress", k.ch, { name: k.name }); r(); }));
    await p;
  } finally {
    stdin.isTTY = saved.isTTY; stdin.setRawMode = saved.setRawMode; stdout.columns = saved.columns; stdout.write = saved.write;
  }
  return output;
}
const ENTER = { ch: "\r", name: "return" };

test("interactive prompts render in the selected language (en: no Hangul, ko: Hangul)", async () => {
  const saved = getLanguage();
  const flows = [
    () => prompts.selectMode(),
    () => prompts.confirmProjectMenu(),
    () => prompts.editMenu({ showFlutter: true, showOptions: true }),
    () => prompts.selectDeployStyle(),
    () => prompts.selectBranchStrategy(),
    () => prompts.askYesNo("Continue?", true),
  ];
  try {
    for (const flow of flows) {
      setLanguage("en");
      const en = await driveTty(flow, [ENTER]);
      assert.ok(en.length > 0);
      assert.doesNotMatch(en, HANGUL, `en prompt has Hangul:\n${en}`);
    }
    for (const flow of flows.slice(0, 5)) {
      setLanguage("ko");
      assert.match(await driveTty(flow, [ENTER]), HANGUL);
    }
  } finally {
    setLanguage(saved);
  }
});

test("--lang=ko (inline form) selects the language for argument errors and output", async () => {
  const dir = repo();
  const saved = getLanguage();
  const savedEnv = process.env.PROJECT_AUTO_WIZARD_LANG;
  delete process.env.PROJECT_AUTO_WIZARD_LANG;
  try {
    const ko = await cli(["--lang=ko", "--bogus"], dir);
    assert.strictEqual(ko.code, 1);
    assert.match(ko.text, /알 수 없는 옵션/);
    const en = await cli(["--lang=en", "--bogus"], dir);
    assert.match(en.text, /Unknown option/);
  } finally {
    setLanguage(saved);
    if (savedEnv === undefined) delete process.env.PROJECT_AUTO_WIZARD_LANG; else process.env.PROJECT_AUTO_WIZARD_LANG = savedEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});
