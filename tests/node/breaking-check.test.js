// Fills coverage gaps for breaking-check.js.
// Verifies the real collectBreaking (breaking.js) combination via runBreakingCheck with an injected loader.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { runBreakingCheck, loadBreakingJson } from "../../src/core/breaking-check.js";
import { collectBreaking } from "../../src/core/breaking.js";

function makeRepo(templateVersion) {
  const dir = mkdtempSync(join(tmpdir(), "paw-bc-"));
  writeFileSync(
    join(dir, "version.yml"),
    `version: "1.0.0"\nmetadata:\n  template:\n    version: "${templateVersion}"\n`,
  );
  return dir;
}

test("no version.yml -> proceeds without loading breaking json", async () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-bc-empty-"));
  try {
    let loaderCalled = false;
    const proceed = await runBreakingCheck({
      cwd: dir, payloadRoot: "unused", templateVersion: "0.2.0",
      loader: async () => { loaderCalled = true; return {}; },
    });
    assert.strictEqual(proceed, true);
    assert.strictEqual(loaderCalled, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loader returns null -> proceeds (bundle missing or unreadable)", async () => {
  const dir = makeRepo("0.1.0");
  try {
    const proceed = await runBreakingCheck({
      cwd: dir, payloadRoot: "unused", templateVersion: "0.2.0",
      loader: async () => null,
    });
    assert.strictEqual(proceed, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no critical/warning entries for the version range -> proceeds silently", async () => {
  const dir = makeRepo("0.1.0");
  try {
    const proceed = await runBreakingCheck({
      cwd: dir, payloadRoot: "unused", templateVersion: "0.2.0",
      loader: async () => ({}),
    });
    assert.strictEqual(proceed, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("critical entry + non-interactive (askYesNo omitted) -> warns and proceeds", async () => {
  const dir = makeRepo("0.1.0");
  try {
    const json = {
      "0.2.0": { severity: "critical", title: "워크플로우 파일명 변경", message: "PROJECT-COMMON-X.yaml -> Y.yaml" },
    };
    const proceed = await runBreakingCheck({
      cwd: dir, payloadRoot: "unused", templateVersion: "0.2.0",
      loader: async () => json,
    });
    assert.strictEqual(proceed, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("critical entry + interactive confirm=false -> cancels", async () => {
  const dir = makeRepo("0.1.0");
  try {
    const json = {
      "0.2.0": { severity: "critical", title: "t", message: "m" },
    };
    const proceed = await runBreakingCheck({
      cwd: dir, payloadRoot: "unused", templateVersion: "0.2.0",
      loader: async () => json,
      askYesNo: async () => false,
    });
    assert.strictEqual(proceed, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("critical entry + interactive confirm=true -> proceeds", async () => {
  const dir = makeRepo("0.1.0");
  try {
    const json = {
      "0.2.0": { severity: "critical", title: "t", message: "m" },
    };
    const proceed = await runBreakingCheck({
      cwd: dir, payloadRoot: "unused", templateVersion: "0.2.0",
      loader: async () => json,
      askYesNo: async () => true,
    });
    assert.strictEqual(proceed, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Four notices ───────────────────────────────────────────────
const BUNDLED = JSON.parse(readFileSync(new URL("../../payload/config/breaking-changes.json", import.meta.url), "utf8"));

test("collectBreaking: an array value under one version key is expanded into one record per item", () => {
  const json = {
    "0.2.0": [
      { severity: "warning", title: "a", message: "m1" },
      { severity: "critical", title: "b", message: "m2" },
    ],
    "0.3.0": { severity: "warning", title: "c", message: "m3" },
    _meta: { severity: "critical", title: "무시" },
  };
  const { critical, warnings } = collectBreaking(json, "0.1.0", "0.3.0");
  assert.deepStrictEqual(critical.map((r) => r.title), ["b"]);
  assert.deepStrictEqual(warnings.map((r) => r.title), ["a", "c"]);
  assert.ok(critical.concat(warnings).every((r) => typeof r.version === "string"));
});

test("bundled breaking-changes.json: upgrading from 0.10.0 to 0.10.1 or later yields four 0.10.1 warnings (independent of the next release number)", () => {
  for (const target of ["0.10.1", "0.11.0", "1.0.0"]) {
    const { critical, warnings: all } = collectBreaking(BUNDLED, "0.10.0", target, ["flutter"]);
    const warnings = all.filter((w) => w.version === "0.10.1");
    assert.strictEqual(critical.length, 0, `${target}: no critical`);
    assert.strictEqual(warnings.length, 4, `${target}: four warnings`);
    for (const w of warnings) {
      assert.strictEqual(w.severity, "warning");
      assert.ok(w.title && !w.title.includes("\n"), "title is a single line");
      assert.ok(w.message && !w.message.includes("\n"), "message is printed as-is inside the box, so it must be a single line");
    }
  }
});

test("bundled breaking-changes.json: the four notices cover SELFHOSTED/TEST-APK fastlane removal, dart-define defaults, FLUTTER_PROJECT_DIR and ci-gate", () => {
  const { warnings } = collectBreaking(BUNDLED, "0.10.0", "0.10.1");
  const text = warnings.map((w) => `${w.title} ${w.message}`);
  for (const keyword of ["fastlane build", "dart-define", "FLUTTER_PROJECT_DIR", "ci-gate"]) {
    assert.strictEqual(text.filter((t) => t.includes(keyword)).length >= 1, true, `a notice for ${keyword} must exist`);
  }
  assert.ok(text.some((t) => t.includes("SELFHOSTED") && t.includes("TEST-APK")));
  assert.ok(text.some((t) => t.includes("dotenv")), "guidance that existing installs keep dotenv");
  assert.ok(text.some((t) => t.includes("--paths flutter=")), "guidance on specifying monorepo paths");
});

test("bundled breaking-changes.json: nothing is shown when already at 0.10.1+ or when only reaching 0.10.0", () => {
  assert.deepStrictEqual(collectBreaking(BUNDLED, "0.10.1", "0.11.0"), { critical: [], warnings: [] });
  assert.deepStrictEqual(collectBreaking(BUNDLED, "0.9.0", "0.10.0"), { critical: [], warnings: [] });
});

test("runBreakingCheck: the four bundled notices are all warnings, so it proceeds without interactive confirmation and shows four in the stderr box", async () => {
  const dir = makeRepo("0.10.0");
  const originalWrite = process.stderr.write.bind(process.stderr);
  let stderr = "";
  process.stderr.write = (chunk) => { stderr += chunk; return true; };
  try {
    const proceed = await runBreakingCheck({
      cwd: dir, payloadRoot: "unused", templateVersion: "0.10.1",
      loader: async () => BUNDLED,
      askYesNo: async () => { throw new Error("no confirmation prompt should appear when there are only warnings"); },
    });
    assert.strictEqual(proceed, true);
    assert.strictEqual((stderr.match(/\[WARNING\] 0\.10\.1 - /g) || []).length, 4);
    assert.ok(stderr.includes("BREAKING CHANGES (v0.10.0 → v0.10.1)"));
  } finally {
    process.stderr.write = originalWrite;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Type filter and 0.12 notices ─────────────────────────────────
test("collectBreaking: entries with types are shown only when they overlap the installed types", () => {
  const json = {
    "0.2.0": [
      { severity: "warning", types: ["flutter"], title: "flutter only" },
      { severity: "warning", types: ["spring", "go"], title: "server" },
      { severity: "warning", title: "all" },
    ],
  };
  const titles = (types) => collectBreaking(json, "0.1.0", "0.2.0", types).warnings.map((w) => w.title);
  assert.deepStrictEqual(titles(["spring"]), ["server", "all"]);
  assert.deepStrictEqual(titles(["flutter"]), ["flutter only", "all"]);
  assert.deepStrictEqual(titles([]), ["flutter only", "server", "all"], "shows everything when the types are unknown");
});

test("bundled breaking-changes.json: upgrading a spring repo from 0.8.2 shows no Flutter-only warning", () => {
  const { warnings } = collectBreaking(BUNDLED, "0.8.2", "0.12.2", ["spring"]);
  assert.ok(warnings.length > 0);
  assert.ok(!warnings.some((w) => /Flutter/.test(w.title)), "Flutter-only warnings must not leak in");
  assert.ok(warnings.some((w) => w.title.includes("ci-gate")), "the notice common to all CI types is shown");
});

test("bundled breaking-changes.json: upgrading from 0.11 announces the AI summary default change and the removed options", () => {
  const spring = collectBreaking(BUNDLED, "0.11.0", "0.12.2", ["spring"]).warnings.map((w) => `${w.title} ${w.message}`);
  assert.ok(spring.some((t) => t.includes("copilot_ai")), "notice that AI summary is now off by default");
  assert.ok(spring.some((t) => t.includes("NEXUS-PUBLISH")), "notice that the nexus option was removed");
  assert.ok(spring.some((t) => t.includes("SECRET-FILE-UPLOAD")), "notice that secret backup was removed");
  const flutter = collectBreaking(BUNDLED, "0.11.0", "0.12.2", ["flutter"]).warnings.map((w) => w.title);
  assert.ok(!flutter.some((t) => t.includes("nexus")), "spring-only notices do not appear for flutter repos");
  for (const w of collectBreaking(BUNDLED, "0.11.0", "0.12.2").warnings) {
    assert.ok(w.message && !w.message.includes("\n"), "message is printed as-is inside the box, so it must be a single line");
  }
});

test("runBreakingCheck: filters notices by project_types in version.yml", async () => {
  const dir = makeRepo("0.8.2");
  writeFileSync(join(dir, "version.yml"),
    'version: "1.0.0"\nproject_types: ["spring"]\nmetadata:\n  template:\n    version: "0.8.2"\n');
  const originalWrite = process.stderr.write.bind(process.stderr);
  let stderr = "";
  process.stderr.write = (chunk) => { stderr += chunk; return true; };
  try {
    await runBreakingCheck({ cwd: dir, payloadRoot: "unused", templateVersion: "0.12.2", loader: async () => BUNDLED });
  } finally {
    process.stderr.write = originalWrite;
    rmSync(dir, { recursive: true, force: true });
  }
  assert.doesNotMatch(stderr, /Flutter SELFHOSTED/);
  assert.match(stderr, /ci-gate/);
});

// ── Bundled copy only ─────────────────────────────────────────
test("loadBreakingJson: reads the packaged bundle as-is without using the network", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => { fetchCalled = true; throw new Error("fetch must not be called"); };
  try {
    const payloadRoot = fileURLToPath(new URL("../../payload", import.meta.url));
    assert.deepStrictEqual(await loadBreakingJson(payloadRoot), BUNDLED);
    assert.strictEqual(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("loadBreakingJson: returns null when the bundle is missing or corrupt", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-bc-payload-"));
  try {
    assert.strictEqual(loadBreakingJson(dir), null);
    mkdirSync(join(dir, "config"));
    writeFileSync(join(dir, "config", "breaking-changes.json"), "{ broken");
    assert.strictEqual(loadBreakingJson(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
