// tests/node/type-alias-next.test.js
// `next` was folded into `react`: the old name is still accepted as an alias at every input point,
// and installs made while it was a separate type are migrated on update.
import "../setup-lang.mjs"; // these tests assert the ko output
import { test } from "node:test";
import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { parseArgs, parsePathsCsv, CliError } from "../../src/cli/args.js";
import { setLanguage } from "../../src/i18n/index.js";
import { parseExisting, droppedPathLines } from "../../src/core/version-yml.js";
import { canonicalTypeId, canonicalTypeIds, TYPE_IDS } from "../../src/core/types.js";
import { runFull } from "../../src/commands/full.js";
import { runStatus } from "../../src/commands/status.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { sha256, BASELINE_PATH } from "../../src/core/baseline.js";

const PAYLOAD = resolvePayloadRoot();
const WF = join(".github", "workflows");

test("next is an alias, not a registry type", () => {
  assert.ok(!TYPE_IDS.includes("next"));
  assert.strictEqual(canonicalTypeId("next"), "react");
  assert.strictEqual(canonicalTypeId("spring"), "spring");
  assert.deepStrictEqual(canonicalTypeIds(["next", "spring", "react"]), ["react", "spring"]);
});

test("--type next and --type react,next both resolve to react", () => {
  assert.deepStrictEqual(parseArgs(["--type", "next"]).types, ["react"]);
  assert.strictEqual(parseArgs(["--type", "next"]).primaryType, "react");
  assert.deepStrictEqual(parseArgs(["--type", "spring,next,react"]).types, ["spring", "react"]);
});

test("--type still reports unknown names as typed", () => {
  assert.throws(() => parseArgs(["--type", "nuxt"]), (e) => e instanceof CliError && e.message.includes("nuxt"));
});

test("--paths next=web is read as react=web; two different folders for the pair are refused", () => {
  assert.deepStrictEqual([...parsePathsCsv("next=web,flutter=app")], [["react", "web"], ["flutter", "app"]]);
  assert.deepStrictEqual([...parsePathsCsv("react=web,next=web")], [["react", "web"]]);
  assert.throws(() => parsePathsCsv("react=web,next=site"), CliError);
});

test("version.yml: next in project_types, project_paths and deploy is read as react", () => {
  const vy = [
    'version: "1.0.0"',
    'project_types: ["next", "spring"]',
    "project_paths:",
    '  next: "web"',
    '  spring: "api"',
    "deploy:",
    "  next:",
    '    DEPLOY_PORT: "3100"',
    "",
  ].join("\n");
  const r = parseExisting(vy);
  assert.deepStrictEqual(r.types, ["react", "spring"]);
  assert.deepStrictEqual([...r.paths], [["react", "web"], ["spring", "api"]]);
  assert.strictEqual(r.deploy.get("react").get("DEPLOY_PORT"), "3100");
  assert.ok(!r.deploy.has("next"));
});

const ctx = (types = ["react"]) => createContext({
  mode: "full", force: true, types, version: "1.0.0", versionCode: 1,
  branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
  paths: new Map(), now: "2026-09-01 00:00:00", today: "2026-09-01", templateVersion: "0.15.0",
});

// Turns a fresh react install into what the previous version left for a Next.js project:
// PROJECT-NEXT-* files with the managed marker + baseline records, and `next` in version.yml.
function toLegacyNextInstall(target) {
  const bp = join(target, BASELINE_PATH);
  const baseline = JSON.parse(readFileSync(bp, "utf8"));
  for (const name of ["PROJECT-REACT-CI.yaml", "PROJECT-REACT-CICD.yaml"]) {
    const legacy = name.replace("REACT", "NEXT");
    const text = readFileSync(join(target, WF, name), "utf8").replace(`name: ${name.replace(".yaml", "")}`, `name: ${legacy.replace(".yaml", "")}`);
    writeFileSync(join(target, WF, legacy), text);
    baseline.files[legacy] = { installed: sha256(text), rendered: sha256(text) };
  }
  writeFileSync(bp, JSON.stringify(baseline, null, 2));
  const vyPath = join(target, "version.yml");
  writeFileSync(vyPath, readFileSync(vyPath, "utf8").replace('project_types: ["react"]', 'project_types: ["next"]'));
}

test("update: a repo installed with the next type gets PROJECT-REACT-* and the PROJECT-NEXT-* files are cleaned up", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-next-"));
  try {
    runFull(ctx(), PAYLOAD, target);
    toLegacyNextInstall(target);
    // The old version never installed the React files for this repo
    const bp = join(target, BASELINE_PATH);
    const bl = JSON.parse(readFileSync(bp, "utf8"));
    for (const f of ["PROJECT-REACT-CI.yaml", "PROJECT-REACT-CICD.yaml"]) {
      rmSync(join(target, WF, f));
      delete bl.files[f];
    }
    writeFileSync(bp, JSON.stringify(bl, null, 2));

    // The CLI reads types from version.yml, which still says next
    const status = runStatus(PAYLOAD, target);
    assert.deepStrictEqual(status.types, ["react"]);
    assert.deepStrictEqual(status.staleFiles, ["PROJECT-NEXT-CI.yaml", "PROJECT-NEXT-CICD.yaml"]);

    const r = runFull(ctx(status.types), PAYLOAD, target);
    assert.deepStrictEqual(r.staleCleanup.removed, ["PROJECT-NEXT-CI.yaml", "PROJECT-NEXT-CICD.yaml"]);
    const left = readdirSync(join(target, WF)).filter((f) => f.startsWith("PROJECT-"));
    assert.ok(left.includes("PROJECT-REACT-CI.yaml") && left.includes("PROJECT-REACT-CICD.yaml"));
    assert.ok(!left.some((f) => f.includes("NEXT")), "no orphaned PROJECT-NEXT-* file is left");
    assert.match(readFileSync(join(target, "version.yml"), "utf8"), /project_types: \["react"\]/);
    assert.ok(!existsSync(join(target, WF, "PROJECT-NEXT-CI.yaml.bak")));
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("the React workflows carry the former Next.js differences: conditional .next size, NODE_ENV, restart policy, front container name", () => {
  const ci = readFileSync(join(PAYLOAD, "workflows", "react", "PROJECT-REACT-CI.yaml"), "utf8");
  // The .next output lines appear only inside an existence check
  const guarded = ci.match(/if \[ -d "\.next" \]; then\n([\s\S]*?)\n\s*fi\n/);
  assert.ok(guarded, ".next existence check missing");
  assert.match(guarded[1], /cibuild\.node_build_next_dir/);
  assert.match(guarded[1], /du -sh \.next\//);
  assert.strictEqual(ci.split("node_build_next_dir").length, 2, ".next output must not be printed outside the check");

  const cd = readFileSync(join(PAYLOAD, "workflows", "react", "PROJECT-REACT-CICD.yaml"), "utf8");
  assert.match(cd, /-e NODE_ENV=production \\/);
  assert.match(cd, /--restart unless-stopped \\/);
  assert.match(cd, /CONTAINER_NAME="\$\{PROJECT_NAME\}-front-deploy"/);
  assert.doesNotMatch(cd, /CONTAINER_NAME="[^"]*nextjs/);
  // Containers of the former Next.js deploy are removed before the new one starts (they hold the same host port)
  const legacy = cd.match(/for LEGACY_NAME in ([^;]*); do\n([\s\S]*?)\n\s*done\n/);
  assert.ok(legacy, "legacy container cleanup missing");
  assert.match(legacy[1], /\$\{PROJECT_NAME\}-nextjs-deploy/);
  assert.match(legacy[2], /docker rm -f "\$LEGACY_NAME" >\/dev\/null 2>&1 \|\| true/);
  assert.ok(cd.indexOf("for LEGACY_NAME") < cd.indexOf("SUDO docker run -d"), "cleanup must run before docker run");
});

// A monorepo that listed react and next with different folders while they were separate types.
const MONO_VY = [
  'version: "1.0.0"',
  'project_types: ["react", "next", "python"]',
  "project_paths:",
  '  react: "client"',
  '  next: "web"',
  '  python: "api"',
  "",
].join("\n");

test("version.yml: react and next with different folders report the folded-away folder", () => {
  const r = parseExisting(MONO_VY);
  assert.deepStrictEqual(r.types, ["react", "python"]);
  assert.deepStrictEqual([...r.paths], [["react", "client"], ["python", "api"]]);
  assert.deepStrictEqual(r.droppedPaths, [{ type: "react", keptName: "react", kept: "client", name: "next", path: "web" }]);
  // Same folder written two ways, or no duplicate at all, loses nothing.
  assert.deepStrictEqual(parseExisting(MONO_VY.replace('next: "web"', 'next: "./client/"')).droppedPaths, []);
  // next listed without a folder sits at the repo root, which differs from react's folder.
  assert.deepStrictEqual(parseExisting(MONO_VY.replace('  next: "web"\n', "")).droppedPaths,
    [{ type: "react", keptName: "react", kept: "client", name: "next", path: "." }]);
});

test("update of a react + next monorepo: status and dry-run warn before the folder drops, the install log records it", async () => {
  const { planDryRun, printDryRun } = await import("../../src/commands/dry-run.js");
  const { printStatus } = await import("../../src/commands/status.js");
  const { initLogger, closeLogger, resetLogger, currentLogPath } = await import("../../src/core/logger.js");
  const target = mkdtempSync(join(tmpdir(), "paw-mono-"));
  const capture = (fn) => {
    const orig = console.log; let out = "";
    console.log = (s) => { out += `${s}\n`; };
    try { fn(); } finally { console.log = orig; }
    return out;
  };
  try {
    writeFileSync(join(target, "version.yml"), MONO_VY);
    mkdirSync(join(target, "client"));
    writeFileSync(join(target, "client", "package.json"), '{"name":"c","version":"1.0.0","dependencies":{"react":"^18"}}');
    mkdirSync(join(target, "web"));
    writeFileSync(join(target, "web", "package.json"), '{"name":"w","version":"1.0.0","dependencies":{"next":"^14"}}');

    const status = runStatus(PAYLOAD, target);
    assert.strictEqual(status.droppedPaths.length, 1);
    const statusOut = capture(() => printStatus(status));
    assert.match(statusOut, /web/);
    assert.match(statusOut, /--paths react=web/);

    const c = { ...ctx(["react", "python"]), paths: new Map([["react", "client"], ["python", "api"]]) };
    const plan = planDryRun("full", c, PAYLOAD, target);
    assert.strictEqual(plan.droppedPathLines.length, 2);
    const dryOut = capture(() => printDryRun(plan));
    assert.match(dryOut, /web/);
    assert.match(dryOut, /--paths react=web/);

    initLogger(target, { action: "install" });
    runFull(c, PAYLOAD, target);
    const logPath = join(target, currentLogPath());
    closeLogger();
    assert.match(readFileSync(logPath, "utf8"), /WARN.*web/);
    // After the rewrite the folder is gone from version.yml and the next run no longer warns.
    const vy = readFileSync(join(target, "version.yml"), "utf8");
    assert.ok(!/^\s+next:/m.test(vy));
    assert.deepStrictEqual(runStatus(PAYLOAD, target).droppedPaths, []);
  } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
});

test("a normal react install prints no folder warning anywhere", () => {
  const r = parseExisting('version: "1.0.0"\nproject_types: ["react"]\nproject_paths:\n  react: "client"\n');
  assert.deepStrictEqual(r.droppedPaths, []);
});

test("folder warning follows the final folders and the original names", () => {
  setLanguage("en");
  try { foldedWarningAssertions(); } finally { setLanguage("ko"); }
});

function foldedWarningAssertions() {
  const lines = (vy, finalPaths) => droppedPathLines(parseExisting(vy).droppedPaths, finalPaths);
  // Saved winner stays: web drops out and the re-run hint is offered.
  const kept = lines(MONO_VY);
  assert.match(kept[0], /Keeping react=client; web drops out/);
  assert.match(kept[1], /--paths react=web/);
  // --paths react=web: client is what drops out, and no hint points back to web.
  const flipped = lines(MONO_VY, new Map([["react", "web"]]));
  assert.match(flipped[0], /Keeping react=web; client drops out/);
  assert.strictEqual(flipped.length, 1);
  // next written first: the message names next and react, never react twice.
  const nextFirst = lines('version: "1.0.0"\nproject_types: ["next", "react"]\nproject_paths:\n  next: "web"\n  react: "."\n');
  assert.match(nextFirst[0], /'next' \(folder web\) and 'react' \(folder \.\)/);
  assert.match(nextFirst[0], /Keeping react=web; \. drops out/);
  // A root react that has no project_paths entry is the folder that drops out.
  const implicit = lines('version: "1.0.0"\nproject_types: ["react", "next"]\nproject_paths:\n  next: "web"\n');
  assert.match(implicit[0], /Keeping react=web; \. drops out/);
  // A single react entry or both at the root lose nothing.
  assert.deepStrictEqual(parseExisting('version: "1.0.0"\nproject_types: ["react", "next"]\n').droppedPaths, []);
}

test("update with --paths react=web reports client as the dropped folder in dry-run and stderr", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-mono-"));
  try {
    writeFileSync(join(target, "version.yml"), MONO_VY);
    for (const [d, dep] of [["client", "react"], ["web", "next"], ["api", null]]) {
      mkdirSync(join(target, d));
      if (dep) writeFileSync(join(target, d, "package.json"), `{"name":"x","version":"1.0.0","dependencies":{"${dep}":"^1"}}`);
    }
    const run = (...a) => spawnSync(process.execPath, [join(process.cwd(), "bin", "project-auto-wizard.js"), "--mode", "full", "--type", "react", "--paths", "react=web", ...a], {
      cwd: target, encoding: "utf8", env: { ...process.env, PROJECT_AUTO_WIZARD_LANG: "en" },
    });
    const dry = run("--dry-run");
    assert.match(dry.stdout, /Keeping react=web; client drops out/);
    assert.doesNotMatch(dry.stdout, /Keeping react=client/);
    const real = run("--force");
    assert.match(real.stderr, /Keeping react=web; client drops out/);
    assert.doesNotMatch(real.stderr, /rerun with --paths react=web/);
  } finally { rmSync(target, { recursive: true, force: true }); }
});
