// tests/node/type-alias-next.test.js
// `next` was folded into `react`: the old name is still accepted as an alias at every input point,
// and installs made while it was a separate type are migrated on update.
import "../setup-lang.mjs"; // these tests assert the ko output
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs, parsePathsCsv, CliError } from "../../src/cli/args.js";
import { parseExisting } from "../../src/core/version-yml.js";
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
  assert.doesNotMatch(cd, /-nextjs"/);
});
