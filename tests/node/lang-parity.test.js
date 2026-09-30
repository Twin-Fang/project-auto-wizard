// Shared case table: the Node CLI and the installed messages.py must resolve the same language.
// The Python side runs the same file in tests/py/test_messages.py.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveLanguage } from "../../src/i18n/index.js";
import { parseExisting } from "../../src/core/version-yml.js";

const cases = JSON.parse(readFileSync(join(import.meta.dirname, "../fixtures/lang-cases.json"), "utf8"));

for (const c of cases) {
  test(`lang-parity: ${c.name}`, () => {
    const saved = c.content === null ? null : parseExisting(c.content).language;
    assert.strictEqual(resolveLanguage({ env: c.env ?? undefined, saved }), c.expected);
  });
}
