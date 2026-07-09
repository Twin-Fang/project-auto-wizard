// Task 14 게이트 — 브랜치 플레이스홀더 치환 + version.yml 렌더링/branches 왕복.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { substitute } from "../../src/core/branding.js";
import { buildVersionYml, parseExisting } from "../../src/core/version-yml.js";

test("substitutes all branch placeholders", () => {
  const out = substitute('branches: ["{{MAIN_BRANCH}}"]\nref == \'{{DEVELOP_BRANCH}}\'',
    { main: "master", develop: "dev" });
  assert.ok(!out.includes("{{"));
  assert.ok(out.includes('"master"') && out.includes("'dev'"));
});

test("throws on unknown placeholder left behind", () => {
  assert.throws(() => substitute("x {{TYPO_BRANCH}}", { main: "m", develop: "d" }));
});

test("does not touch GitHub Actions expressions", () => {
  const src = 'ref: ${{ github.ref }} name: ${{ secrets.TOKEN }} b: "{{MAIN_BRANCH}}"';
  const out = substitute(src, { main: "main", develop: "develop" });
  assert.ok(out.includes("${{ github.ref }}"));
  assert.ok(out.includes("${{ secrets.TOKEN }}"));
  assert.ok(out.includes('"main"'));
});

// ── version.yml 렌더링 (payload/version.yml.template 소스) ─────────
const TEMPLATE = readFileSync("payload/version.yml.template", "utf8");

const BASE = {
  templateText: TEMPLATE,
  version: "1.2.3", versionCode: 7, types: ["spring", "react"],
  paths: new Map([["spring", "api"], ["react", "web"]]),
  pathMarkers: new Map([["spring", "build.gradle"], ["react", "package.json"]]),
  branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
  now: "2026-07-09 00:00:00", today: "2026-07-09",
  templateOptions: { templateVersion: "0.1.0", includeNexus: true, includeSecretBackup: false, optionsDate: "2026-07-09" },
};

test("buildVersionYml renders the payload template with branches metadata", () => {
  const out = buildVersionYml(BASE);
  assert.ok(out.includes('version: "1.2.3"'));
  assert.ok(out.includes("version_code: 7"));
  assert.ok(out.includes('project_types: ["spring", "react"]'));
  assert.ok(out.includes('project_type: "spring"'));
  assert.ok(out.includes('spring: "api"'));
  assert.ok(out.includes('main: "main"'));
  assert.ok(out.includes('develop: "develop"'));
  assert.ok(out.includes('mode: "pr-flow"'));
  assert.ok(out.includes("nexus: true"));
  assert.ok(out.includes("secret_backup: false"));
  assert.ok(out.includes("coderabbit: false"));
  assert.ok(!out.includes("{{"), `unresolved placeholder in:\n${out}`);
});

test("buildVersionYml omits project_paths/deploy lines when empty", () => {
  const out = buildVersionYml({ ...BASE, paths: new Map(), deployValues: new Map() });
  assert.ok(!/^project_paths:/m.test(out), "project_paths key must be absent");
  assert.ok(!/^deploy:/m.test(out), "deploy key must be absent");
  assert.ok(!out.includes("{{"));
});

test("buildVersionYml appends deploy block from collected ask values", () => {
  const out = buildVersionYml({
    ...BASE,
    deployValues: new Map([["spring", new Map([["DEPLOY_PORT", "8080"]])]]),
  });
  assert.ok(/deploy:/.test(out));
  assert.ok(out.includes('DEPLOY_PORT: "8080"'));
});

test("parseExisting round-trips branches metadata", () => {
  const out = buildVersionYml({ ...BASE, branches: { main: "master", develop: "dev", mode: "pr-flow" } });
  const parsed = parseExisting(out);
  assert.deepStrictEqual(parsed.branches, { main: "master", develop: "dev", mode: "pr-flow" });
  assert.strictEqual(parsed.version, "1.2.3");
  assert.strictEqual(parsed.versionCode, 7);
  assert.strictEqual(parsed.options.nexus, true);
});

test("parseExisting returns null branches when metadata absent", () => {
  const parsed = parseExisting('version: "1.0.0"\nversion_code: 1\n');
  assert.strictEqual(parsed.branches, null);
});
