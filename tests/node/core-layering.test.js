// tests/node/core-layering.test.js
// core is the bottom layer of the install logic — referencing cli/ui/commands creates a circular dependency,
// and other entry points (interactive, tests) could no longer use core alone.
// The compat path where cli/args.js re-exports CliError and the path utils must also point to the same objects.
import { test } from "node:test";
import assert from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as args from "../../src/cli/args.js";
import { CliError } from "../../src/core/errors.js";
import { normalizePath, isRepoRelativePath } from "../../src/core/paths.js";

const coreDir = join(dirname(fileURLToPath(import.meta.url)), "../../src/core");

test("src/core does not import cli, ui or commands modules", () => {
  const offenders = [];
  for (const rel of readdirSync(coreDir, { recursive: true })) {
    if (!rel.endsWith(".js")) continue;
    const text = readFileSync(join(coreDir, rel), "utf8");
    for (const m of text.matchAll(/from\s+["']([^"']+)["']/g)) {
      if (/(^|\/)(cli|ui|commands)\//.test(m[1])) offenders.push(`${rel} → ${m[1]}`);
    }
  }
  assert.deepStrictEqual(offenders, []);
});

test("CliError and path utils in cli/args.js are the same objects as the core definitions", () => {
  assert.strictEqual(args.CliError, CliError);
  assert.strictEqual(args.normalizePath, normalizePath);
  assert.strictEqual(args.isRepoRelativePath, isRepoRelativePath);
  assert.ok(new args.CliError("x") instanceof CliError);
});
