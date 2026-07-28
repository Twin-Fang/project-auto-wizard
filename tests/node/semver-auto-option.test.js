// tests/node/semver-auto-option.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { parseTemplateOptions, buildVersionYml } from "../../src/core/version-yml.js";
import { readVersionYmlTemplate } from "../../src/core/assets.js";

test("buildVersionYml: includeSemverAuto omitted defaults to true", () => {
  const text = buildVersionYml({
    templateText: readVersionYmlTemplate(resolvePayloadRoot()),
    version: "1.0.0", types: ["basic"], branch: "main",
    branches: { main: "main", develop: "develop", mode: "pr-flow" },
    versionCode: 1, now: "2026-07-28 00:00:00", today: "2026-07-28",
    templateOptions: { templateVersion: "0.1.0" },
  });
  const opts = parseTemplateOptions(text);
  assert.strictEqual(opts.semverAuto, true);
});

test("buildVersionYml: includeSemverAuto explicit false renders false", () => {
  const text = buildVersionYml({
    templateText: readVersionYmlTemplate(resolvePayloadRoot()),
    version: "1.0.0", types: ["basic"], branch: "main",
    branches: { main: "main", develop: "develop", mode: "pr-flow" },
    versionCode: 1, now: "2026-07-28 00:00:00", today: "2026-07-28",
    templateOptions: { templateVersion: "0.1.0", includeSemverAuto: false },
  });
  const opts = parseTemplateOptions(text);
  assert.strictEqual(opts.semverAuto, false);
});

test("runFull: default install has semver_auto: true in version.yml", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-semver-opt-"));
  try {
    const ctx = createContext({
      mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
      branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
      paths: new Map(), now: "2026-07-28 00:00:00", today: "2026-07-28", templateVersion: "0.1.0",
    });
    runFull(ctx, resolvePayloadRoot(), target);
    const opts = parseTemplateOptions(readFileSync(join(target, "version.yml"), "utf8"));
    assert.strictEqual(opts.semverAuto, true);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("runFull: includeSemverAuto:false in context renders false", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-semver-opt-"));
  try {
    const ctx = createContext({
      mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
      branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
      paths: new Map(), includeSemverAuto: false,
      now: "2026-07-28 00:00:00", today: "2026-07-28", templateVersion: "0.1.0",
    });
    runFull(ctx, resolvePayloadRoot(), target);
    const opts = parseTemplateOptions(readFileSync(join(target, "version.yml"), "utf8"));
    assert.strictEqual(opts.semverAuto, false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
