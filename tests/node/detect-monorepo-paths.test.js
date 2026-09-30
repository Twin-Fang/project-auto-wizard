// tests/node/detect-monorepo-paths.test.js
// Monorepo with no markers at the root: running without options points to subfolders,
// and giving only --paths must install that type (no contradictory basic + project_paths state).
import "../setup-lang.mjs"; // these tests assert the ko output
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { detectTypes } from "../../src/core/detect-fs.js";
import { run } from "../../src/index.js";

const CLOCK = { now: "2026-09-01 00:00:00", today: "2026-09-01" };

function monorepo(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), "paw-mono-detect-"));
  const files = {
    "server/build.gradle": "version = '1.2.0'\n",
    "client/package.json": JSON.stringify({ name: "my-app", dependencies: { react: "18" } }),
    ...extra,
  };
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

// Collect the notices run() writes to stderr (console.error and the path confirmation log)
async function runCapture(argv, cwd) {
  const errs = [];
  const origErr = console.error;
  const origLog = console.log;
  const origWrite = process.stderr.write;
  console.error = (...a) => errs.push(a.join(" "));
  console.log = () => {};
  process.stderr.write = (chunk) => { errs.push(String(chunk)); return true; };
  try {
    const code = await run(argv, { cwd, clock: CLOCK });
    return { code, stderr: errs.join("\n") };
  } finally {
    console.error = origErr;
    console.log = origLog;
    process.stderr.write = origWrite;
  }
}

test("detectTypes: warns about subfolder projects and a --paths example when the root has no markers", () => {
  const root = monorepo();
  try {
    const warned = [];
    const types = detectTypes(root, { warn: (m) => warned.push(m) });
    assert.deepStrictEqual(types, ["basic"]);
    assert.strictEqual(warned.length, 1);
    assert.match(warned[0], /client\(react\)/);
    assert.match(warned[0], /server\(spring\)/);
    assert.match(warned[0], /--paths "react=client,spring=server"/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("detectTypes: names the folders of the same type that the suggested --paths leaves out", () => {
  const root = monorepo({ "web/package.json": JSON.stringify({ name: "web", dependencies: { react: "18" } }) });
  try {
    const warned = [];
    detectTypes(root, { warn: (m) => warned.push(m) });
    assert.strictEqual(warned.length, 1);
    // react=client is suggested (first folder); web is reported as left out, with how to manage it instead
    assert.match(warned[0], /--paths "react=client,spring=server"/);
    assert.match(warned[0], /react=client/);
    assert.match(warned[0], /web/);
    assert.match(warned[0], /--paths react=web/);
    // a single folder per type adds no extra lines
    const single = monorepo();
    try {
      const w2 = [];
      detectTypes(single, { warn: (m) => w2.push(m) });
      assert.ok(!w2[0].includes("--paths react="));
    } finally { rmSync(single, { recursive: true, force: true }); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("detectTypes: does not warn when no subfolder has a project either", () => {
  const root = mkdtempSync(join(tmpdir(), "paw-mono-detect-"));
  try {
    mkdirSync(join(root, "docs"));
    const warned = [];
    assert.deepStrictEqual(detectTypes(root, { warn: (m) => warned.push(m) }), ["basic"]);
    assert.strictEqual(warned.length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("detectTypes: uses the --paths types in order and drops node from the root package.json", () => {
  const root = monorepo({ "package.json": JSON.stringify({ name: "workspace", private: true }) });
  try {
    const paths = new Map([["spring", "server"], ["react", "client"]]);
    assert.deepStrictEqual(detectTypes(root, { paths }), ["spring", "react"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("run(): running without options installs basic but prints the subfolder notice", async () => {
  const root = monorepo();
  try {
    const { code, stderr } = await runCapture(["--mode", "full", "--force"], root);
    assert.strictEqual(code, 0);
    assert.match(stderr, /하위 폴더에서 발견/);
    assert.match(stderr, /--paths "react=client,spring=server"/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("run(): giving only --paths installs that type", async () => {
  const root = monorepo();
  try {
    const { code } = await runCapture(["--mode", "full", "--force", "--paths", "spring=server,react=client"], root);
    assert.strictEqual(code, 0);
    const vy = readFileSync(join(root, "version.yml"), "utf8");
    assert.match(vy, /project_types:\s*\["spring",\s*"react"\]/);
    assert.match(vy, /spring:\s*"?server"?/);
    assert.match(vy, /react:\s*"?client"?/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("run(): warns when the --paths path has no marker for that type", async () => {
  const root = monorepo();
  try {
    const { code, stderr } = await runCapture(["--mode", "full", "--force", "--paths", "flutter=client"], root);
    assert.strictEqual(code, 0);
    assert.match(stderr, /client에 flutter 프로젝트 파일\(pubspec\.yaml\)이 없습니다/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
