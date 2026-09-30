// Regression gate: cross-platform reproducibility.
//
// This repo copies payload/ byte-for-byte into the user's repo. If checked out
// with CRLF on Windows, the install output differs from macOS (violating install reproducibility),
// and workflow run blocks become shell scripts with stray CRs that fail silently only at runtime.
// .gitattributes (eol=lf) prevents this; if that protection is removed, this test catches it.
import { test } from "node:test";
import assert from "node:assert";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { runFull } from "../../src/commands/full.js";

// Extensions excluded from line-ending normalization (matches the binary list in .gitattributes)
const BINARY_EXT = /\.(png|jpe?g|gif|ico|pdf|zip|tgz|gz|jar|keystore|pyc)$/i;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "__pycache__") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (!BINARY_EXT.test(entry)) out.push(p);
  }
  return out;
}

function crCount(path) {
  const buf = readFileSync(path);
  let n = 0;
  for (const byte of buf) if (byte === 0x0d) n++;
  return n;
}

test(".gitattributes exists and pins the working tree to LF", () => {
  const p = new URL("../../.gitattributes", import.meta.url);
  assert.ok(existsSync(p), "without .gitattributes, Windows checkouts become CRLF");
  const body = readFileSync(p, "utf8");
  assert.match(body, /^\*\s+text=auto\s+eol=lf$/m, "the `* text=auto eol=lf` rule must exist");
});

test("payload/ text assets contain no CR bytes", () => {
  const offenders = walk(resolvePayloadRoot())
    .filter((p) => crCount(p) > 0)
    .map((p) => `${p} (CR=${crCount(p)})`);
  assert.deepStrictEqual(offenders, [],
    `CRLF found in payload — installing on Windows would produce different output from macOS:\n${offenders.join("\n")}`);
});

test("full install output (workflows, scripts, version.yml) contains no CR bytes", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-eol-"));
  try {
    runFull(createContext({
      mode: "full", force: true, types: ["node"], version: "1.0.0", versionCode: 1,
      branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
      paths: new Map(),
      now: "2026-08-03 00:00:00", today: "2026-08-03", templateVersion: "0.1.11",
    }), resolvePayloadRoot(), target);

    const installed = [
      ...walk(join(target, ".github", "workflows")),
      ...walk(join(target, ".github", "scripts")),
      join(target, "version.yml"),
    ];
    const offenders = installed
      .filter((p) => crCount(p) > 0)
      .map((p) => `${p} (CR=${crCount(p)})`);
    assert.deepStrictEqual(offenders, [],
      `CRLF found in install output:\n${offenders.join("\n")}`);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
