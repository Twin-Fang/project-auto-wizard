// tests/node/monorepo-version.test.js
// In a monorepo (--paths) install, detects the version and build number from the type folder,
// and checks that the installed version_manager.py reads the project_paths the wizard wrote (inline comment included).
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { run } from "../../src/index.js";
import { detectVersion, detectBuildNumber } from "../../src/core/detect-fs.js";

function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), "paw-mono-ver-"));
  for (const [rel, body] of Object.entries(files)) {
    const p = join(dir, ...rel.split("/"));
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, body);
  }
  return dir;
}

async function quietRun(argv, cwd) {
  const original = process.stderr.write;
  const originalLog = console.log;
  process.stderr.write = () => true;
  console.log = () => {};
  try {
    return await run(argv, { cwd });
  } finally {
    process.stderr.write = original;
    console.log = originalLog;
  }
}

// Windows has no python3 and some Linux systems have no python — use whichever actually works.
function findPython() {
  for (const cmd of ["python3", "python"]) {
    const r = spawnSync(cmd, ["-c", "import sys; print(sys.version_info[0])"], { encoding: "utf-8", input: "" });
    if (r.status === 0 && r.stdout.trim() === "3") return cmd;
  }
  return null;
}

test("detectVersion/detectBuildNumber: with paths, reads files from the primary type folder", () => {
  const dir = repo({
    "app/pubspec.yaml": "name: my_app\nversion: 4.1.0+9\n",
    "client/package.json": JSON.stringify({ name: "my-app", version: "4.0.0" }),
  });
  try {
    const paths = new Map([["flutter", "app"], ["react", "client"]]);
    const types = ["flutter", "react"];
    assert.strictEqual(detectVersion(dir, { types, paths, warn: () => {} }), "4.1.0");
    assert.strictEqual(detectBuildNumber(dir, { types, paths, warn: () => {} }), 9);
    // without paths, only the root is read as before
    assert.strictEqual(detectVersion(dir, { types, warn: () => {} }), "0.0.1");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("run(--paths): builds version.yml from the version in the subfolder package.json", async () => {
  const dir = repo({ "web/package.json": JSON.stringify({ name: "my-app", version: "2.3.4", dependencies: { react: "18" } }) });
  try {
    assert.strictEqual(await quietRun(["--mode", "full", "--force", "--type", "react", "--paths", "react=web"], dir), 0);
    const vy = readFileSync(join(dir, "version.yml"), "utf8");
    assert.match(vy, /^version: "2\.3\.4"/m);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("run(--paths): takes the Flutter subfolder's build number as version_code", async () => {
  const dir = repo({
    "app/pubspec.yaml": "name: my_app\nversion: 4.1.0+9\n",
    "app/lib/main.dart": "void main(){}\n",
  });
  try {
    assert.strictEqual(await quietRun(["--mode", "full", "--force", "--type", "flutter", "--paths", "flutter=app"], dir), 0);
    const vy = readFileSync(join(dir, "version.yml"), "utf8");
    assert.match(vy, /^version: "4\.1\.0"/m);
    assert.match(vy, /^version_code: 9\b/m);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the installed version_manager.py reads the wizard-written project_paths and syncs subfolders", async (t) => {
  const python = findPython();
  if (!python) { t.skip("python 3 not available"); return; }
  const dir = repo({ "web/package.json": JSON.stringify({ name: "my-app", version: "2.3.4", dependencies: { react: "18" } }) });
  try {
    assert.strictEqual(await quietRun(["--mode", "full", "--force", "--type", "react", "--paths", "react=web"], dir), 0);
    const vy = readFileSync(join(dir, "version.yml"), "utf8");
    assert.match(vy, /^project_paths: #/m, "the wizard appends a comment to the project_paths line — this format must be readable");
    const script = join(dir, ".github", "scripts", "version_manager.py");
    const env = { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1" };
    const r = spawnSync(python, [script, "increment"], { cwd: dir, encoding: "utf-8", env });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout + r.stderr, /not found/);
    assert.strictEqual(JSON.parse(readFileSync(join(dir, "web", "package.json"), "utf8")).version, "2.3.5");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
