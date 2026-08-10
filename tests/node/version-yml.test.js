// tests/node/version-yml.test.js
// issue #20 M8 — version.yml 재생성 시 사용자가 추가한 알려지지 않은 최상위 필드가 보존되는지 검증.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseExisting, parseExtraTopLevel, buildVersionYml } from "../../src/core/version-yml.js";
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

test("parseExtraTopLevel: captures an unknown top-level key containing a hyphen (issue #20 review — regex must allow hyphens)", () => {
  const content = ['version: "1.0.0"', "deploy-notes: keep this"].join("\n");
  assert.deepStrictEqual(parseExtraTopLevel(content), ["deploy-notes: keep this"]);
});

// issue #62 — 레거시 단수 키는 렌더되지 않지만 KNOWN_TOP_LEVEL_KEYS에는 남아 있어야 한다.
// 빼면 기존 파일의 단수 줄이 "사용자 필드"로 오인돼 재생성 때 되살아난다.
test("parseExtraTopLevel: the legacy singular project_type is absorbed, not preserved (issue #62)", () => {
  const content = ['version: "1.0.0"', 'project_types: ["node"]', 'project_type: "node"'].join("\n");
  assert.deepStrictEqual(parseExtraTopLevel(content), []);
});

test("buildVersionYml: never renders the legacy singular project_type (issue #62)", () => {
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

test("integration: qa_custom_field survives a --mode version re-run (issue #20 repro)", () => {
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

test("buildVersionYml: escapes double quotes in deploy block values (issue #20 L9, second sink)", () => {
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
