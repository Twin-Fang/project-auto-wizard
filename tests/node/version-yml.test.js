// tests/node/version-yml.test.js
// Verifies that unknown top-level fields added by the user are preserved when version.yml is regenerated.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseExisting, parseExtraTopLevel, parseTemplateOptions, buildVersionYml, renderVersionYml } from "../../src/core/version-yml.js";
import { readVersionYmlTemplate, resolvePayloadRoot } from "../../src/core/assets.js";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";

const PAYLOAD = resolvePayloadRoot();

test("parseExtraTopLevel: captures an unknown scalar top-level field", () => {
  const content = [
    'version: "1.0.0"',
    "qa_custom_field: hello",
    "metadata:",
    '  last_updated: "2026-08-04"',
  ].join("\n");
  assert.deepStrictEqual(parseExtraTopLevel(content), ["qa_custom_field: hello"]);
});

test("parseExtraTopLevel: captures an unknown top-level key containing a hyphen (regex must allow hyphens)", () => {
  const content = ['version: "1.0.0"', "deploy-notes: keep this"].join("\n");
  assert.deepStrictEqual(parseExtraTopLevel(content), ["deploy-notes: keep this"]);
});

// The legacy singular key is not rendered but must stay in KNOWN_TOP_LEVEL_KEYS.
// Otherwise the singular line in an existing file is mistaken for a "user field" and revived on regeneration.
test("parseExtraTopLevel: the legacy singular project_type is absorbed, not preserved", () => {
  const content = ['version: "1.0.0"', 'project_types: ["node"]', 'project_type: "node"'].join("\n");
  assert.deepStrictEqual(parseExtraTopLevel(content), []);
});

test("buildVersionYml: never renders the legacy singular project_type", () => {
  const out = buildVersionYml({
    templateText: readVersionYmlTemplate(PAYLOAD),
    version: "1.0.0", versionCode: 1, types: ["spring", "react"],
    branch: "main", now: "2026-08-10 00:00:00", today: "2026-08-10",
  });
  assert.ok(out.includes('project_types: ["spring", "react"]'));
  assert.ok(!/^project_type:/m.test(out), `legacy singular key leaked into:\n${out}`);
});

test("parseExtraTopLevel: known top-level keys (version/project_paths/metadata/deploy) are never captured", () => {
  const content = [
    'version: "1.0.0"',
    "version_code: 1",
    'project_types: ["node"]',
    'project_type: "node"',
    "project_paths:",
    '  node: "."',
    "metadata:",
    '  last_updated: "2026-08-04"',
    "deploy:",
    "  node:",
    '    HOST: "x"',
  ].join("\n");
  assert.deepStrictEqual(parseExtraTopLevel(content), []);
});

test("parseExtraTopLevel: preserves a multi-line block belonging to an unknown top-level key", () => {
  const content = [
    'version: "1.0.0"',
    "custom_block:",
    "  nested_a: 1",
    "  nested_b: 2",
    "metadata:",
    '  last_updated: "2026-08-04"',
  ].join("\n");
  assert.deepStrictEqual(parseExtraTopLevel(content), ["custom_block:\n  nested_a: 1\n  nested_b: 2"]);
});

test("parseExisting: exposes extraTopLevel alongside known fields", () => {
  const content = ['version: "1.0.0"', "qa_custom_field: hello"].join("\n");
  const result = parseExisting(content);
  assert.deepStrictEqual(result.extraTopLevel, ["qa_custom_field: hello"]);
});

test("buildVersionYml: re-appends extraTopLevel blocks at the end, in original order", () => {
  const text = buildVersionYml({
    templateText: readVersionYmlTemplate(PAYLOAD),
    version: "1.0.0", types: ["basic"], paths: new Map(), branch: "main",
    branches: { main: "main", develop: "develop", mode: "pr-flow" },
    versionCode: 1, now: "2026-08-04 00:00:00", today: "2026-08-04",
    templateOptions: { templateVersion: "0.1.0" },
    extraTopLevel: ["first_field: a", "second_block:\n  x: 1"],
  });
  const firstIdx = text.indexOf("first_field: a");
  const secondIdx = text.indexOf("second_block:");
  assert.ok(firstIdx > 0);
  assert.ok(secondIdx > firstIdx);
});

test("integration: qa_custom_field survives a --mode version re-run", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-version-yml-preserve-"));
  try {
    const baseCtx = createContext({
      mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
      branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
      paths: new Map(),
      now: "2026-08-04 00:00:00", today: "2026-08-04", templateVersion: "0.1.0",
    });
    runFull(baseCtx, PAYLOAD, target);

    const vyPath = join(target, "version.yml");
    writeFileSync(vyPath, readFileSync(vyPath, "utf8") + "qa_custom_field: hello\n");

    runFull(baseCtx, PAYLOAD, target);

    const after = readFileSync(vyPath, "utf8");
    assert.ok(after.includes("qa_custom_field: hello"), "user-added field must survive a re-run");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("buildVersionYml: escapes double quotes in deploy block values (second sink)", () => {
  const deployValues = new Map([["node", new Map([["HOST", 'a "quoted" host']])]]);
  const text = buildVersionYml({
    templateText: readVersionYmlTemplate(PAYLOAD),
    version: "1.0.0", types: ["node"], paths: new Map(), branch: "main",
    branches: { main: "main", develop: "develop", mode: "pr-flow" },
    versionCode: 1, now: "2026-08-04 00:00:00", today: "2026-08-04",
    templateOptions: { templateVersion: "0.1.0" },
    deployValues,
  });
  assert.ok(text.includes('HOST: "a \\"quoted\\" host"'));
});

// ── Flutter options: 4 keys ──────────────────────────────
const FLUTTER_KEYS_RE = /env_mode|flutter_store|android_deploy_mode|ios_deploy_mode/;
const BASE_BUILD = {
  version: "1.0.0", versionCode: 1, branch: "main",
  branches: { main: "main", develop: "develop", mode: "pr-flow" },
  now: "2026-09-21 00:00:00", today: "2026-09-21",
  templateOptions: { templateVersion: "0.10.0" },
};
const buildYml = (extra) => buildVersionYml({ templateText: readVersionYmlTemplate(PAYLOAD), ...BASE_BUILD, ...extra });

test("buildVersionYml: for a Flutter type, renders the 4 keys under options with the given values", () => {
  const out = buildYml({
    types: ["flutter"],
    typeOptions: { envMode: "dotenv", stores: ["ios"], androidDeployMode: "store_prepare", iosDeployMode: "store_submit" },
  });
  assert.match(out, /^      env_mode: "dotenv"/m);
  assert.match(out, /^      flutter_store: "ios"/m);
  assert.match(out, /^      android_deploy_mode: "store_prepare"/m);
  assert.match(out, /^      ios_deploy_mode: "store_submit"/m);
  assert.ok(!out.includes("{{"), `unresolved placeholder in:\n${out}`);
});

test("buildVersionYml: Flutter without typeOptions renders the same values as the template defaults", () => {
  const out = buildYml({ types: ["flutter"] });
  assert.match(out, /^      env_mode: "dart-define"/m);
  assert.match(out, /^      flutter_store: "android,ios"/m);
  assert.match(out, /^      android_deploy_mode: "store_only"/m);
  assert.match(out, /^      ios_deploy_mode: "store_only"/m);
});

test("buildVersionYml: with no store chosen (empty array), flutter_store is \"none\"", () => {
  const out = buildYml({ types: ["flutter"], typeOptions: { stores: [] } });
  assert.match(out, /^      flutter_store: "none"/m);
});

test("buildVersionYml: without a Flutter type, leaves neither the 4 keys nor a blank line", () => {
  const out = buildYml({ types: ["react"], typeOptions: { envMode: "dotenv", stores: ["ios"] } });
  assert.doesNotMatch(out, FLUTTER_KEYS_RE);
  const lastLine = out.trimEnd().split("\n").at(-1);
  assert.match(lastLine, /^      deploy_style:/, `the last line of options must be deploy_style:\n${out}`);
});

test("buildVersionYml: for multi-type (flutter+react), renders and keeps the blank-line structure before the deploy block", () => {
  const out = buildYml({
    types: ["flutter", "react"],
    deployValues: new Map([["react", new Map([["HOST", "example"]])]]),
  });
  assert.match(out, /^      ios_deploy_mode:/m);
  assert.ok(out.indexOf("ios_deploy_mode") < out.indexOf("\n\ndeploy:"), "the deploy block comes after the options");
  assert.strictEqual(parseExisting(out).options.iosDeployMode, "store_only");
});

test("parseTemplateOptions: all null when the 4 keys are absent (for detecting existing installs)", () => {
  const out = parseTemplateOptions(buildYml({ types: ["react"] }));
  assert.strictEqual(out.envMode, null);
  assert.strictEqual(out.flutterStore, null);
  assert.strictEqual(out.androidDeployMode, null);
  assert.strictEqual(out.iosDeployMode, null);
});

test("parseTemplateOptions: reads inline comments, single-quoted and unquoted values, and coexists with other options", () => {
  const text = [
    "metadata:",
    "  template:",
    "    options:",
    '      env_mode: "dotenv" # dart-define | dotenv',
    "      flutter_store: 'android'",
    "      android_deploy_mode: store_prepare",
    '      ios_deploy_mode: "store_submit"',
    "      semver_auto: true",
  ].join("\n");
  const out = parseTemplateOptions(text);
  assert.strictEqual(out.envMode, "dotenv");
  assert.strictEqual(out.flutterStore, "android");
  assert.strictEqual(out.androidDeployMode, "store_prepare");
  assert.strictEqual(out.iosDeployMode, "store_submit");
  assert.strictEqual(out.semverAuto, true);
});

test("render -> parse round trip: parseExisting restores the buildVersionYml result as is", () => {
  const cases = [
    { envMode: "dotenv", stores: ["android"], androidDeployMode: "store_submit", iosDeployMode: "store_only", flutterStore: "android" },
    { envMode: "dart-define", stores: ["android", "ios"], androidDeployMode: "store_only", iosDeployMode: "store_prepare", flutterStore: "android,ios" },
    { envMode: "dart-define", stores: [], androidDeployMode: "store_only", iosDeployMode: "store_only", flutterStore: "none" },
  ];
  for (const c of cases) {
    const { flutterStore, ...typeOptions } = c;
    const { options } = parseExisting(buildYml({ types: ["flutter"], typeOptions }));
    assert.strictEqual(options.envMode, c.envMode);
    assert.strictEqual(options.flutterStore, flutterStore);
    assert.strictEqual(options.androidDeployMode, c.androidDeployMode);
    assert.strictEqual(options.iosDeployMode, c.iosDeployMode);
  }
});

test("renderVersionYml: reflects the context's Flutter option fields in the render", () => {
  const ctx = createContext({
    mode: "full", force: true, types: ["flutter"], version: "1.0.0", versionCode: 1, branch: "main",
    branches: { main: "main", develop: "develop", mode: "pr-flow" },
    now: "2026-09-21 00:00:00", today: "2026-09-21", templateVersion: "0.10.0",
    envMode: "dotenv", flutterStore: ["android"], androidDeployMode: "store_submit", iosDeployMode: "store_only",
  });
  const out = renderVersionYml(ctx, readVersionYmlTemplate(PAYLOAD), {});
  const { options } = parseExisting(out);
  assert.strictEqual(options.envMode, "dotenv");
  assert.strictEqual(options.flutterStore, "android");
  assert.strictEqual(options.androidDeployMode, "store_submit");
  assert.strictEqual(options.iosDeployMode, "store_only");
});

test("renderVersionYml: renders an undecided context (empty envMode, null stores) with valid defaults", () => {
  const ctx = createContext({
    mode: "full", force: true, types: ["flutter"], version: "1.0.0", versionCode: 1, branch: "main",
    branches: { main: "main", develop: "develop", mode: "pr-flow" },
    now: "2026-09-21 00:00:00", today: "2026-09-21", templateVersion: "0.10.0",
  });
  const { options } = parseExisting(renderVersionYml(ctx, readVersionYmlTemplate(PAYLOAD), {}));
  assert.strictEqual(options.envMode, "dart-define");
  assert.strictEqual(options.flutterStore, "android,ios");
  assert.strictEqual(options.androidDeployMode, "store_only");
});

test("integration: runFull writes Flutter options to version.yml and preserves them on rerun", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-version-yml-flutter-"));
  try {
    const ctx = createContext({
      mode: "full", force: true, types: ["flutter"], version: "1.0.0", versionCode: 1,
      branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
      paths: new Map(), now: "2026-09-21 00:00:00", today: "2026-09-21", templateVersion: "0.10.0",
      envMode: "dotenv", flutterStore: ["ios"], androidDeployMode: "store_prepare", iosDeployMode: "store_submit",
    });
    runFull(ctx, PAYLOAD, target);
    runFull(ctx, PAYLOAD, target);
    const { options } = parseExisting(readFileSync(join(target, "version.yml"), "utf8"));
    assert.deepStrictEqual(
      [options.envMode, options.flutterStore, options.androidDeployMode, options.iosDeployMode],
      ["dotenv", "ios", "store_prepare", "store_submit"],
    );
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("parseTemplateOptions: ignores a leftover nexus key in an existing version.yml, and it disappears on re-render", () => {
  const text = [
    "metadata:", "  template:", "    options:",
    "      nexus: true", "      semver_auto: true",
  ].join("\n");
  const parsed = parseTemplateOptions(text);
  assert.strictEqual("nexus" in parsed, false);
  assert.strictEqual(parsed.semverAuto, true);
});

test("buildVersionYml: a freshly rendered version.yml has no nexus key", () => {
  const rendered = buildVersionYml({
    templateText: readVersionYmlTemplate(PAYLOAD), version: "1.0.0", types: ["basic"],
    now: "2026-09-26 00:00:00", today: "2026-09-26", templateOptions: { templateVersion: "0.12.0" },
  });
  assert.ok(!/^\s+nexus:/m.test(rendered), "the rewritten version.yml must have no nexus key");
});
