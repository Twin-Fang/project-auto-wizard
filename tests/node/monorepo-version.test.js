// tests/node/monorepo-version.test.js
// 모노레포(--paths) 설치에서 버전·빌드 번호를 타입 폴더에서 감지하고,
// 설치된 version_manager.py가 마법사가 쓴 project_paths(인라인 주석 포함)를 읽는지 확인한다.
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

// Windows에는 python3가 없고 일부 Linux에는 python이 없다 — 실제로 동작하는 쪽을 쓴다.
function findPython() {
  for (const cmd of ["python3", "python"]) {
    const r = spawnSync(cmd, ["-c", "import sys; print(sys.version_info[0])"], { encoding: "utf-8", input: "" });
    if (r.status === 0 && r.stdout.trim() === "3") return cmd;
  }
  return null;
}

test("detectVersion/detectBuildNumber: paths가 있으면 주 타입 폴더의 파일을 읽는다", () => {
  const dir = repo({
    "app/pubspec.yaml": "name: my_app\nversion: 4.1.0+9\n",
    "client/package.json": JSON.stringify({ name: "my-app", version: "4.0.0" }),
  });
  try {
    const paths = new Map([["flutter", "app"], ["react", "client"]]);
    const types = ["flutter", "react"];
    assert.strictEqual(detectVersion(dir, { types, paths, warn: () => {} }), "4.1.0");
    assert.strictEqual(detectBuildNumber(dir, { types, paths, warn: () => {} }), 9);
    // 경로가 없으면 종전대로 루트만 본다
    assert.strictEqual(detectVersion(dir, { types, warn: () => {} }), "0.0.1");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("run(--paths): 하위 폴더 package.json의 버전으로 version.yml을 만든다", async () => {
  const dir = repo({ "web/package.json": JSON.stringify({ name: "my-app", version: "2.3.4", dependencies: { react: "18" } }) });
  try {
    assert.strictEqual(await quietRun(["--mode", "full", "--force", "--type", "react", "--paths", "react=web"], dir), 0);
    const vy = readFileSync(join(dir, "version.yml"), "utf8");
    assert.match(vy, /^version: "2\.3\.4"/m);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("run(--paths): Flutter 하위 폴더의 빌드 번호를 version_code로 가져온다", async () => {
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

test("설치된 version_manager.py가 마법사가 쓴 project_paths를 읽어 하위 폴더를 동기화한다", async (t) => {
  const python = findPython();
  if (!python) { t.skip("python 3 없음"); return; }
  const dir = repo({ "web/package.json": JSON.stringify({ name: "my-app", version: "2.3.4", dependencies: { react: "18" } }) });
  try {
    assert.strictEqual(await quietRun(["--mode", "full", "--force", "--type", "react", "--paths", "react=web"], dir), 0);
    const vy = readFileSync(join(dir, "version.yml"), "utf8");
    assert.match(vy, /^project_paths: #/m, "마법사는 project_paths 줄에 주석을 붙인다 — 이 형식을 읽어야 한다");
    const script = join(dir, ".github", "scripts", "version_manager.py");
    const env = { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1" };
    const r = spawnSync(python, [script, "increment"], { cwd: dir, encoding: "utf-8", env });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout + r.stderr, /not found/);
    assert.strictEqual(JSON.parse(readFileSync(join(dir, "web", "package.json"), "utf8")).version, "2.3.5");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
