// Regression gate: watches that commercial SaaS (CodeRabbit) integration does not come back.
// Neither install outputs nor wizard code may contain any commercial service integration.
import { test } from "node:test";
import assert from "node:assert";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { runFull } from "../../src/commands/full.js";
import { parseArgs, CliError } from "../../src/cli/args.js";
import { parseTemplateOptions } from "../../src/core/version-yml.js";

const NEEDLE = /coderabbit/i;

function baseContext(extra = {}) {
  return createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(),
    now: "2026-08-03 00:00:00", today: "2026-08-03", templateVersion: "0.1.11",
    ...extra,
  });
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

test("no payload/ asset contains the coderabbit string", () => {
  const payloadRoot = resolvePayloadRoot();
  const offenders = walk(payloadRoot).filter((p) => NEEDLE.test(readFileSync(p, "utf8")));
  assert.deepStrictEqual(offenders, [], `CodeRabbit remains in payload: ${offenders.join(", ")}`);
});

test("the payload/coderabbit.yaml asset itself does not exist", () => {
  assert.ok(!existsSync(join(resolvePayloadRoot(), "coderabbit.yaml")));
});

test("full install output has no .coderabbit.yaml and version.yml has no coderabbit key", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-no-crk-"));
  try {
    runFull(baseContext(), resolvePayloadRoot(), target);

    assert.ok(!existsSync(join(target, ".coderabbit.yaml")), ".coderabbit.yaml must not be installed");
    assert.ok(!NEEDLE.test(readFileSync(join(target, "version.yml"), "utf8")),
      "version.yml must not keep a coderabbit key");

    const wfDir = join(target, ".github", "workflows");
    for (const f of readdirSync(wfDir)) {
      assert.ok(!NEEDLE.test(readFileSync(join(wfDir, f), "utf8")), `coderabbit remains in ${f}`);
    }
    const scriptsDir = join(target, ".github", "scripts");
    for (const f of readdirSync(scriptsDir)) {
      assert.ok(!NEEDLE.test(readFileSync(join(scriptsDir, f), "utf8")), `coderabbit remains in ${f}`);
    }
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("--coderabbit / --no-coderabbit / --keep-coderabbit flags are no longer accepted", () => {
  for (const flag of ["--coderabbit", "--no-coderabbit", "--keep-coderabbit"]) {
    assert.throws(() => parseArgs([flag]), CliError, `${flag} must be rejected`);
  }
});

test("a leftover coderabbit key in an old version.yml is ignored without a parse error", () => {
  // Backward compatibility: re-running on a repo installed by an older wizard must not crash.
  const legacy = [
    "metadata:",
    "  template:",
    "    options:",
    "      nexus: true",
    "      secret_backup: false",
    "      coderabbit: true",
    "      semver_auto: true",
  ].join("\n");

  const parsed = parseTemplateOptions(legacy);
  assert.strictEqual("nexus" in parsed, false);
  assert.strictEqual("secretBackup" in parsed, false);
  assert.strictEqual(parsed.semverAuto, true, "semver_auto after the coderabbit key must still parse");
  assert.ok(!("coderabbit" in parsed), "coderabbit must not remain in the parse result");
});
