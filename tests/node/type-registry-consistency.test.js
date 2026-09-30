import "../setup-lang.mjs"; // these tests assert the ko output
import { test } from "node:test";
import assert from "node:assert";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { VALID_TYPES } from "../../src/context.js";
import { ALL_TYPES } from "../../src/ui/prompts.js";
import { markerForType } from "../../src/core/paths-resolve.js";
import { helpText } from "../../src/cli/help.js";
import {
  TYPES, TYPE_IDS, BUILD_NUMBER_TYPES, SINGLE_SERVER_CD_FILES,
} from "../../src/core/types.js";
import {
  markerForType as detectMarkerForType, extraMarkers, detectTypesFromMarkers, classifyPackageText,
  detectBuildNumberFromFiles,
} from "../../src/core/detect.js";
import { isServerDeployWorkflow } from "../../src/core/deploy-style.js";

// The type list is written in several files separately, so missing even one spot when adding a type fails here.
const sorted = (xs) => [...new Set(xs)].sort();
const VALID = sorted(VALID_TYPES);

// Extract only type-name tokens from a string — include hyphens so "react-native" is not cut to "react".
const typeTokens = (text) =>
  sorted((text.match(/[a-z][a-z-]*[a-z]/g) || []).filter((t) => VALID_TYPES.includes(t)));

test("VALID_TYPES has no duplicates", () => {
  assert.strictEqual(new Set(VALID_TYPES).size, VALID_TYPES.length);
});

test("interactive type choices (ALL_TYPES) equal VALID_TYPES", () => {
  assert.deepStrictEqual(sorted(ALL_TYPES), VALID);
  assert.strictEqual(new Set(ALL_TYPES).size, ALL_TYPES.length);
});

test("every type except basic has a representative marker (paths-resolve KNOWN_MARKER_TYPES)", () => {
  for (const t of VALID_TYPES) {
    if (t === "basic") assert.strictEqual(markerForType(t), "", "basic must have no marker file");
    else assert.ok(markerForType(t), `${t}: missing from the paths-resolve marker list`);
  }
});

test("the supported-type list in --help equals VALID_TYPES", () => {
  // The type list runs from the "지원:" line up to just before the next option line (starting with --).
  const m = helpText().match(/지원:([\s\S]*?)\n\s*(?:-\w, )?--/);
  assert.ok(m, "could not find the '지원:' list in --help");
  assert.deepStrictEqual(typeTokens(m[1]), VALID);
});

const template = readFileSync("payload/version.yml.template", "utf8");

test("the supported-types comment in the version.yml template equals VALID_TYPES", () => {
  const m = template.match(/# Supported project types:([\s\S]*?)\n# (?!\s)/);
  assert.ok(m, "could not find the 'Supported project types' comment in the template");
  assert.deepStrictEqual(typeTokens(m[1]), VALID);
});

test("the per-type synced-files comment in the version.yml template lists every type", () => {
  const m = template.match(/# Synced files per type:\n((?:# - .*\n)+)/);
  assert.ok(m, "could not find the 'Synced files per type' comment in the template");
  // Only the part before "- a/b/c:" in each entry is treated as the type name.
  const listed = m[1].split("\n").flatMap((line) => {
    const head = line.match(/^# - ([^:]+):/);
    return head ? head[1].split("/").map((s) => s.trim()) : [];
  });
  assert.deepStrictEqual(sorted(listed), VALID);
});

// Section heading of the supported-project-types table in each language's README (the table runs to the next H2)
const SUPPORTED_TYPES_HEADING = {
  "README.md": "Supported project types",
  "README.ko.md": "지원 프로젝트 타입",
  "README.zh-CN.md": "支持的项目类型",
  "README.ja.md": "対応するプロジェクトタイプ",
};

for (const [file, heading] of Object.entries(SUPPORTED_TYPES_HEADING)) {
  test(`${file} supported-types table equals VALID_TYPES`, () => {
    const readme = readFileSync(file, "utf8");
    const m = readme.match(new RegExp(`## ${heading}\\n([\\s\\S]*?)\\n## `));
    assert.ok(m, `could not find section '${heading}' in ${file}`);
    // Collect only backtick values in the table's first column (type name) — exclude file names in other columns
    const listed = [];
    for (const [, cell] of m[1].matchAll(/^\| ([^|]+) \|/gm)) {
      for (const [, t] of cell.matchAll(/`([^`]+)`/g)) listed.push(t);
    }
    assert.deepStrictEqual(sorted(listed), VALID);
  });
}

test("version_manager.py TYPE_HANDLERS covers every type", () => {
  const py = readFileSync("payload/scripts/version_manager.py", "utf8");
  const body = py.match(/\nTYPE_HANDLERS = \{\n([\s\S]*?)\n\}/);
  assert.ok(body, "could not find the TYPE_HANDLERS table");
  // Collect only top-level table keys (4-space-indented "type":) — exclude strings inside values.
  const handled = [...body[1].matchAll(/^ {4}"([^"]+)":/gm)].map((x) => x[1]);
  assert.deepStrictEqual(sorted(handled), VALID);
});

test("every type folder under payload/workflows is a valid type", () => {
  const dirs = readdirSync("payload/workflows", { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "common")
    .map((d) => d.name);
  assert.ok(dirs.length > 0);
  for (const d of dirs) assert.ok(VALID_TYPES.includes(d), `payload/workflows/${d}: unknown type folder`);
});

// ── Whether the registry (core/types.js) is the single source ──
// Re-hardcoding type knowledge breaks the comparisons below and fails.

test("VALID_TYPES and ALL_TYPES are the registry list as is (same order)", () => {
  assert.deepStrictEqual([...VALID_TYPES], TYPES.map((t) => t.id));
  assert.strictEqual(VALID_TYPES, TYPE_IDS);
  assert.strictEqual(ALL_TYPES, TYPE_IDS);
  assert.ok(Object.isFrozen(TYPE_IDS), "the shared array must be frozen so one side cannot mutate it");
});

test("primary and secondary markers come from the registry markers", () => {
  for (const t of TYPES) {
    if (t.markers.length === 0) continue;
    assert.strictEqual(detectMarkerForType(t.id), t.markers[0], t.id);
    assert.deepStrictEqual(extraMarkers(t.id), t.markers.slice(1), t.id);
    assert.strictEqual(markerForType(t.id), t.markers[0], t.id);
  }
});

test("detectBy and detectOrder declarations are intact", () => {
  for (const by of ["markers", "package"]) {
    const orders = TYPES.filter((t) => t.detectBy === by).map((t) => t.detectOrder);
    assert.ok(orders.every(Number.isInteger), `${by}: detectOrder must be an integer`);
    assert.strictEqual(new Set(orders).size, orders.length, `${by}: duplicate detectOrder`);
  }
  assert.strictEqual(TYPES.filter((t) => t.detectBy === "package-fallback").length, 1);
  for (const t of TYPES.filter((x) => x.detectBy === "package")) assert.ok(t.packageDep, `${t.id}: packageDep missing`);
  // A type without a detection method must have no marker either — a marker without detection is silently skipped by auto-detection.
  for (const t of TYPES.filter((x) => !x.detectBy)) assert.deepStrictEqual(t.markers, [], t.id);
});

test("each type is auto-detected as declared in the registry", () => {
  for (const t of TYPES.filter((x) => x.detectBy === "markers")) {
    for (const m of t.markers) {
      assert.ok(detectTypesFromMarkers({ has: (f) => f === m }).includes(t.id), `${t.id}: ${m}alone must be enough to detect it`);
    }
  }
  for (const t of TYPES.filter((x) => x.detectBy === "package")) {
    const raw = JSON.stringify({ dependencies: { [t.packageDep]: "1" } });
    assert.strictEqual(classifyPackageText(raw), t.id);
  }
});

test("build-number types come from the registry buildNumberSource", () => {
  for (const t of TYPES) {
    let reads = 0;
    detectBuildNumberFromFiles({ types: [t.id], read: () => { reads++; return null; }, readJson: () => { reads++; return null; } });
    assert.strictEqual(reads > 0, Boolean(t.buildNumberSource), `${t.id}: whether the build-number file is read`);
    assert.strictEqual(BUILD_NUMBER_TYPES.has(t.id), Boolean(t.buildNumberSource), t.id);
  }
});

test("the single-server CD file exists in that type's payload and is classified as a server deploy", () => {
  assert.ok(SINGLE_SERVER_CD_FILES.size > 0);
  for (const t of TYPES.filter((x) => x.singleServerCd)) {
    assert.ok(existsSync(join("payload/workflows", t.id, t.singleServerCd)), `${t.id}: ${t.singleServerCd} missing`);
    assert.ok(isServerDeployWorkflow(t.singleServerCd));
  }
});
