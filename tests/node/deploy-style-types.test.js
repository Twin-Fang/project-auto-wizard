// tests/node/deploy-style-types.test.js
// Deploy style must follow the same rules for every type.
//  - none: no type installs server-deploy workflows (CD, react single CD, PR preview)
//  - nginx/traefik: types without a zero-downtime workflow (python, go, react) install the single-server deploy and say so
//  - on a first install, a just-written file is not mistaken for a "user edit" and moved to .bak
import "../setup-lang.mjs"; // these tests assert the ko output
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "../../src/index.js";
import { cleanupOtherDeployWorkflows, fallbackStyleTypes, payloadWorkflowNames, effectiveDeployStyle } from "../../src/core/deploy-style.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";

const payload = resolvePayloadRoot();

function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), "paw-deploy-types-"));
  for (const [rel, body] of Object.entries(files)) writeFileSync(join(dir, rel), body);
  return dir;
}

async function install(dir, argv) {
  const original = process.stderr.write;
  const originalLog = console.log;
  let err = "";
  process.stderr.write = (s) => { err += String(s); return true; };
  console.log = () => {};
  try {
    const code = await run(["--mode", "full", "--force", ...argv], { cwd: dir });
    return { code, err };
  } finally {
    process.stderr.write = original;
    console.log = originalLog;
  }
}

const workflows = (dir) => readdirSync(join(dir, ".github", "workflows"));

const REACT = { "package.json": JSON.stringify({ name: "my-app", version: "1.0.0", dependencies: { react: "18" } }) };
const PYTHON = { "pyproject.toml": '[project]\nname = "my-service"\nversion = "1.0.0"\n' };
const GO = { "go.mod": "module example.com/my-service\n\ngo 1.22\n" };

for (const [type, files, ci] of [
  ["react", REACT, "PROJECT-REACT-CI.yaml"],
  ["python", PYTHON, "PROJECT-PYTHON-CI.yaml"],
  ["go", GO, "PROJECT-GO-CI.yaml"],
]) {
  test(`--deploy-style none: ${type} installs only CI and records no server-deploy settings`, async () => {
    const dir = repo(files);
    try {
      const { code } = await install(dir, ["--type", type, "--deploy-style", "none"]);
      assert.strictEqual(code, 0);
      const mine = workflows(dir).filter((f) => f.startsWith(`PROJECT-${type.toUpperCase()}-`));
      assert.deepStrictEqual(mine, [ci]);
      const vy = readFileSync(join(dir, "version.yml"), "utf8");
      assert.match(vy, /deploy_style: "none"/);
      assert.doesNotMatch(vy, /SERVER_|SSH_AUTH_METHOD|DEPLOY_PORT/, "server-deploy-only values are not recorded");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test("switching react installed with simple to none cleans up the CICD", async () => {
  const dir = repo(REACT);
  try {
    await install(dir, ["--type", "react"]);
    assert.ok(workflows(dir).includes("PROJECT-REACT-CICD.yaml"));
    await install(dir, ["--type", "react", "--deploy-style", "none"]);
    const files = workflows(dir);
    assert.ok(!files.includes("PROJECT-REACT-CICD.yaml") && !files.includes("PROJECT-REACT-CICD.yaml.bak"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

for (const [type, files, simple] of [
  ["python", PYTHON, "PROJECT-PYTHON-SIMPLE-CICD.yaml"],
  ["go", GO, "PROJECT-GO-SIMPLE-CICD.yaml"],
]) {
  test(`--deploy-style nginx first install: ${type} installs the single-server deploy and creates no .bak or .gitignore`, async () => {
    const dir = repo(files);
    try {
      const { code, err } = await install(dir, ["--type", type, "--deploy-style", "nginx"]);
      assert.strictEqual(code, 0);
      const wf = workflows(dir);
      assert.ok(wf.includes(simple), "a type without a zero-downtime workflow is installed as a single-server deploy");
      assert.ok(!wf.some((f) => f.endsWith(".bak")), "no .bak may be created on a first install");
      assert.ok(!existsSync(join(dir, ".gitignore")));
      assert.match(err, new RegExp(`${type}에는 nginx 무중단 배포 워크플로우가 없어 단일 서버 배포`));
      // The record must be the style actually installed so status and the next run's default match the installed state.
      assert.match(readFileSync(join(dir, "version.yml"), "utf8"), /deploy_style: "?simple"?/);
      // stable across reruns
      await install(dir, ["--type", type, "--deploy-style", "nginx"]);
      assert.ok(workflows(dir).includes(simple));
      assert.ok(!workflows(dir).some((f) => f.endsWith(".bak")));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test("traefik for spring,go: installs TRAEFIK for spring and SIMPLE for go", async () => {
  const dir = repo({ ...GO, "build.gradle": "version = '1.0.0'\n" });
  try {
    await install(dir, ["--type", "spring,go", "--deploy-style", "traefik"]);
    const wf = workflows(dir);
    assert.ok(wf.includes("PROJECT-SPRING-NONSTOP-TRAEFIK-CICD.yaml"));
    assert.ok(!wf.includes("PROJECT-SPRING-SIMPLE-CICD.yaml"));
    assert.ok(wf.includes("PROJECT-GO-SIMPLE-CICD.yaml"));
    assert.ok(!wf.some((f) => f.endsWith(".bak")));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("effectiveDeployStyle: falls back to simple only when the chosen zero-downtime style exists for no type", () => {
  assert.strictEqual(effectiveDeployStyle(payload, ["python"], "nginx"), "simple");
  assert.strictEqual(effectiveDeployStyle(payload, ["go", "react"], "traefik"), "simple");
  assert.strictEqual(effectiveDeployStyle(payload, ["spring", "go"], "traefik"), "traefik");
  assert.strictEqual(effectiveDeployStyle(payload, ["python"], "none"), "none");
  assert.strictEqual(effectiveDeployStyle(payload, ["python"], null), null);
});

test("fallbackStyleTypes: returns only server-deploy types without a zero-downtime workflow", () => {
  assert.deepStrictEqual(fallbackStyleTypes(payload, ["spring", "go", "python", "react", "flutter"], "nginx"), ["go", "python", "react"]);
  assert.deepStrictEqual(fallbackStyleTypes(payload, ["go"], "simple"), []);
  assert.deepStrictEqual(fallbackStyleTypes(payload, ["go"], "none"), []);
});

test("cleanupOtherDeployWorkflows: a file just written in this run is not treated as an edit even without a baseline", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-deploy-types-"));
  try {
    const f = "PROJECT-SPRING-SIMPLE-CICD.yaml";
    writeFileSync(join(dir, f), "name: simple\n");
    const r = cleanupOtherDeployWorkflows(dir, [f], "nginx", null, { available: payloadWorkflowNames(payload), justWritten: [f] });
    assert.deepStrictEqual(r.removed, [f]);
    assert.deepStrictEqual(r.backedUp, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("cleanupOtherDeployWorkflows: leaves user workflows absent from the payload alone even if the names look similar", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-deploy-types-"));
  try {
    const mine = "MY-APP-PR-PREVIEW.yaml";
    writeFileSync(join(dir, mine), "name: mine\n");
    const r = cleanupOtherDeployWorkflows(dir, [mine], "none", null, { available: payloadWorkflowNames(payload) });
    assert.deepStrictEqual(r, { removed: [], backedUp: [] });
    assert.ok(existsSync(join(dir, mine)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
