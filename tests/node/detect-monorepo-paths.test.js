// tests/node/detect-monorepo-paths.test.js
// 루트에 마커가 없는 모노레포: 옵션 없이 실행하면 하위 폴더를 안내하고,
// --paths만 주면 그 타입으로 설치해야 한다(basic + project_paths 모순 상태 금지).
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

// run()이 stderr로 내는 안내(console.error와 경로 확정 로그)를 모은다
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

test("detectTypes: 루트 마커가 없으면 하위 폴더 프로젝트와 --paths 예시를 경고한다", () => {
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

test("detectTypes: 하위 폴더에도 프로젝트가 없으면 경고하지 않는다", () => {
  const root = mkdtempSync(join(tmpdir(), "paw-mono-detect-"));
  try {
    mkdirSync(join(root, "docs"));
    const warned = [];
    assert.deepStrictEqual(detectTypes(root, { warn: (m) => warned.push(m) }), ["basic"]);
    assert.strictEqual(warned.length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("detectTypes: --paths의 타입을 순서대로 쓰고 루트 package.json의 node는 뺀다", () => {
  const root = monorepo({ "package.json": JSON.stringify({ name: "workspace", private: true }) });
  try {
    const paths = new Map([["spring", "server"], ["react", "client"]]);
    assert.deepStrictEqual(detectTypes(root, { paths }), ["spring", "react"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("run(): 옵션 없이 실행하면 basic으로 설치하되 하위 폴더 안내를 출력한다", async () => {
  const root = monorepo();
  try {
    const { code, stderr } = await runCapture(["--mode", "full", "--force"], root);
    assert.strictEqual(code, 0);
    assert.match(stderr, /하위 폴더에서 발견/);
    assert.match(stderr, /--paths "react=client,spring=server"/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("run(): --paths만 주면 그 타입으로 설치된다", async () => {
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

test("run(): --paths 경로에 그 타입의 마커가 없으면 경고한다", async () => {
  const root = monorepo();
  try {
    const { code, stderr } = await runCapture(["--mode", "full", "--force", "--paths", "flutter=client"], root);
    assert.strictEqual(code, 0);
    assert.match(stderr, /client에 flutter 프로젝트 파일\(pubspec\.yaml\)이 없습니다/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
