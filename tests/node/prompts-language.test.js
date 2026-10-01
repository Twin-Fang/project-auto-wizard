// tests/node/prompts-language.test.js
// The language prompt is bilingual by design: it must show every supported language no matter which
// language is active, because the user has not chosen one yet.
import { test } from "node:test";
import assert from "node:assert";
import { setLanguage, getLanguage } from "../../src/i18n/index.js";
import * as prompts from "../../src/ui/prompts.js";

const HANGUL = /[ㄱ-ㆎ가-힣]/;

delete process.env.TERM;

// Drives the real prompt through a fake TTY.
async function driveTty(fn, keys) {
  const { stdin, stdout } = process;
  const saved = { isTTY: stdin.isTTY, setRawMode: stdin.setRawMode, columns: stdout.columns, write: stdout.write };
  stdin.isTTY = true;
  stdin.setRawMode = () => stdin;
  stdout.columns = 100;
  let output = "";
  stdout.write = (chunk, ...rest) => (typeof chunk === "string" ? ((output += chunk), true) : saved.write.call(stdout, chunk, ...rest));
  let value;
  try {
    const p = fn();
    for (const k of keys) await new Promise((r) => setImmediate(() => { process.stdin.emit("keypress", k.ch, { name: k.name }); r(); }));
    value = await p;
  } finally {
    stdin.isTTY = saved.isTTY; stdin.setRawMode = saved.setRawMode; stdout.columns = saved.columns; stdout.write = saved.write;
  }
  return { output, value };
}
const ENTER = { ch: "\r", name: "return" };
const ESC = { ch: "\u001b", name: "escape" };
const key = (ch) => ({ ch, name: ch });

async function withLanguage(lang, fn) {
  const saved = getLanguage();
  setLanguage(lang);
  try {
    return await fn();
  } finally {
    setLanguage(saved);
  }
}

test("language prompt shows both languages even while the active language is en", async () => {
  await withLanguage("en", async () => {
    const { output } = await driveTty(() => prompts.selectLanguage(), [ENTER]);
    assert.match(output, /Select language/);
    assert.match(output, HANGUL);
    assert.match(output, /English/);
  });
});

test("language prompt shows both languages while the active language is ko", async () => {
  await withLanguage("ko", async () => {
    const { output } = await driveTty(() => prompts.selectLanguage(), [ENTER]);
    assert.match(output, /Select language/);
    assert.match(output, /English/);
  });
});

test("language prompt defaults to en on Enter", async () => {
  await withLanguage("ko", async () => {
    const { value } = await driveTty(() => prompts.selectLanguage(), [ENTER]);
    assert.strictEqual(value, "en");
  });
});

test("language prompt returns ko after jumping to the second option", async () => {
  await withLanguage("en", async () => {
    const { value } = await driveTty(() => prompts.selectLanguage(), [key("2"), ENTER]);
    assert.strictEqual(value, "ko");
  });
});

test("language prompt returns the CANCEL symbol on ESC", async () => {
  await withLanguage("en", async () => {
    const { value } = await driveTty(() => prompts.selectLanguage(), [ESC]);
    assert.strictEqual(value, prompts.CANCEL);
  });
});
