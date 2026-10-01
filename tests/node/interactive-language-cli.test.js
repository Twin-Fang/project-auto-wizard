// tests/node/interactive-language-cli.test.js
// run() asks the language only in interactive mode and only when no language is known: no --lang, no
// PROJECT_AUTO_WIZARD_LANG and no usable `language` in version.yml.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../src/index.js";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { t, setLanguage, getLanguage, LANG_ENV_VAR } from "../../src/i18n/index.js";

const HANGUL = /[ㄱ-ㆎ가-힣]/;
const PROMPT = /Select language/;

delete process.env.TERM;

// setup-lang.mjs puts the process on ko (env var + module language). Each test removes the env var and starts
// from en, then restores both so later tests in this process keep their ko assumption.
async function withoutLanguageEnv(fn) {
  const savedEnv = process.env[LANG_ENV_VAR];
  const savedLanguage = getLanguage();
  delete process.env[LANG_ENV_VAR];
  setLanguage("en");
  try {
    return await fn();
  } finally {
    if (savedEnv === undefined) delete process.env[LANG_ENV_VAR]; else process.env[LANG_ENV_VAR] = savedEnv;
    setLanguage(savedLanguage);
  }
}

// Fake TTY that records everything written to stdout/stderr instead of swallowing it.
async function withFakeTty(fn) {
  const { stdin, stdout, stderr } = process;
  const saved = {
    inTTY: stdin.isTTY, outTTY: stdout.isTTY, setRawMode: stdin.setRawMode, columns: stdout.columns,
    outWrite: stdout.write, errWrite: stderr.write,
  };
  const seen = { out: "", err: "" };
  stdin.isTTY = true;
  stdout.isTTY = true;
  stdout.columns = 100;
  stdin.setRawMode = () => stdin;
  stdout.write = (chunk, ...rest) => (typeof chunk === "string" ? ((seen.out += chunk), true) : saved.outWrite.call(stdout, chunk, ...rest));
  stderr.write = (chunk) => { seen.err += String(chunk); return true; };
  try {
    await fn(seen);
  } finally {
    stdin.isTTY = saved.inTTY;
    stdout.isTTY = saved.outTTY;
    stdin.setRawMode = saved.setRawMode;
    stdout.columns = saved.columns;
    stdout.write = saved.outWrite;
    stderr.write = saved.errWrite;
  }
  return seen;
}

const ctrlC = () => process.stdin.emit("keypress", "\x03", { name: "c", ctrl: true, sequence: "\x03" });
const tick = () => new Promise((r) => setImmediate(r));

// Starts an interactive run, lets the first screen render, then aborts with Ctrl+C.
async function firstScreen(args, cwd) {
  let code;
  const seen = await withFakeTty(async () => {
    const p = run(args, { cwd });
    await tick();
    ctrlC();
    code = await p;
  });
  return { ...seen, code };
}

function emptyDir() {
  const dir = mkdtempSync(join(tmpdir(), "paw-language-cli-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "my-app", version: "1.0.0" }));
  return dir;
}

function installedDir() {
  const dir = mkdtempSync(join(tmpdir(), "paw-language-cli-installed-"));
  const ctx = createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(), now: "2026-08-05 00:00:00", today: "2026-08-05", templateVersion: "0.1.0",
  });
  runFull(ctx, resolvePayloadRoot(), dir);
  return dir;
}

function rewriteVersionYml(dir, transform) {
  const path = join(dir, "version.yml");
  writeFileSync(path, transform(readFileSync(path, "utf8")));
}

const cleanup = (dir) => rmSync(dir, { recursive: true, force: true });

test("a fresh interactive run asks the language first and leaves no file when aborted", { timeout: 5000 }, async () => {
  await withoutLanguageEnv(async () => {
    const dir = emptyDir();
    try {
      const { out, code } = await firstScreen([], dir);
      assert.strictEqual(code, 130);
      assert.match(out, PROMPT);
      assert.match(out, HANGUL);
      assert.ok(!existsSync(join(dir, "version.yml")));
      assert.ok(!existsSync(join(dir, ".github")));
    } finally { cleanup(dir); }
  });
});

test("--lang skips the language question", { timeout: 5000 }, async () => {
  await withoutLanguageEnv(async () => {
    const dir = emptyDir();
    try {
      const { out, code } = await firstScreen(["--lang", "en"], dir);
      assert.strictEqual(code, 130);
      assert.doesNotMatch(out, PROMPT);
    } finally { cleanup(dir); }
  });
});

test("the environment variable skips the language question", { timeout: 5000 }, async () => {
  await withoutLanguageEnv(async () => {
    process.env[LANG_ENV_VAR] = "en";
    const dir = emptyDir();
    try {
      const { out, code } = await firstScreen([], dir);
      assert.strictEqual(code, 130);
      assert.doesNotMatch(out, PROMPT);
    } finally { cleanup(dir); }
  });
});

test("a saved language skips the language question", { timeout: 5000 }, async () => {
  await withoutLanguageEnv(async () => {
    const dir = installedDir();
    try {
      rewriteVersionYml(dir, (text) => text.replace(/^language:.*$/m, 'language: "ko"'));
      const { out, code } = await firstScreen([], dir);
      assert.strictEqual(code, 130);
      assert.doesNotMatch(out, PROMPT);
    } finally { cleanup(dir); }
  });
});

test("an install without a saved language is asked, and the silent-fallback notice is not printed", { timeout: 5000 }, async () => {
  await withoutLanguageEnv(async () => {
    const dir = installedDir();
    try {
      rewriteVersionYml(dir, (text) => text.replace(/^language:.*\n/m, ""));
      const { out, err, code } = await firstScreen([], dir);
      assert.strictEqual(code, 130);
      assert.match(out, PROMPT);
      assert.ok(!err.includes(t("cli.lang.defaultNotice", {}, "en")));
    } finally { cleanup(dir); }
  });
});

test("an unsupported saved language is asked, and its notice is still printed", { timeout: 5000 }, async () => {
  await withoutLanguageEnv(async () => {
    const dir = installedDir();
    try {
      rewriteVersionYml(dir, (text) => text.replace(/^language:.*$/m, 'language: "fr"'));
      const { out, err, code } = await firstScreen([], dir);
      assert.strictEqual(code, 130);
      assert.match(out, PROMPT);
      assert.ok(err.includes(t("cli.lang.unsupportedSavedNotice", { value: "fr", supported: "en, ko" }, "en")));
    } finally { cleanup(dir); }
  });
});

test("--dry-run without --mode is rejected without asking anything", async () => {
  await withoutLanguageEnv(async () => {
    const dir = emptyDir();
    try {
      let code;
      const seen = await (async () => {
        const out = []; const err = [];
        const { stdout, stderr } = process;
        const saved = { out: stdout.write, err: stderr.write };
        stdout.write = (chunk, ...rest) => (typeof chunk === "string" ? (out.push(chunk), true) : saved.out.call(stdout, chunk, ...rest));
        stderr.write = (chunk) => { err.push(String(chunk)); return true; };
        try { code = await run(["--dry-run"], { cwd: dir }); } finally { stdout.write = saved.out; stderr.write = saved.err; }
        return out.join("") + err.join("");
      })();
      assert.strictEqual(code, 1);
      assert.doesNotMatch(seen, HANGUL);
      assert.doesNotMatch(seen, PROMPT);
    } finally { cleanup(dir); }
  });
});

test("explicit modes never ask the language, even on a TTY", { timeout: 15000 }, async () => {
  await withoutLanguageEnv(async () => {
    const dir = emptyDir();
    try {
      for (const args of [["--mode", "full", "--force", "--type", "node"], ["--mode", "status"], ["--mode", "doctor"]]) {
        let code;
        const seen = await withFakeTty(async () => { code = await run(args, { cwd: dir }); });
        assert.doesNotMatch(seen.out + seen.err, PROMPT, `${args.join(" ")} must not ask`);
        assert.ok([0, 1].includes(code));
      }
      assert.match(readFileSync(join(dir, "version.yml"), "utf8"), /^language: "en"/m);
    } finally { cleanup(dir); }
  });
});
