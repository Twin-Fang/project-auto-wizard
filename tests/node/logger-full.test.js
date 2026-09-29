// tests/node/logger-full.test.js
// full 파이프라인 전 구간이 로그에 남는지 회귀.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initLogger, resetLogger, closeLogger } from "../../src/core/logger.js";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { makeResolvers } from "../../src/core/detect-fs.js";

function ctxFor(target, now) {
  const paths = new Map([["spring", "."]]);
  return createContext({
    mode: "full", force: true, types: ["spring"], version: "0.0.1", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths, repoName: "demo", resolvers: makeResolvers(target, "demo", paths),
    now, today: now.slice(0, 10), templateVersion: "0.8.2",
    markers: new Map([["spring", "build.gradle"]]),
  });
}

test("runFull: detect·version·verify 구간이 모두 로그에 남고 요약이 붙는다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-logfull-"));
  try {
    mkdirSync(join(target, "src/main/resources"), { recursive: true });
    writeFileSync(join(target, "src/main/resources/application.yaml"), "");
    writeFileSync(join(target, "build.gradle"), 'version = "0.0.1"\n');

    resetLogger();
    const r = initLogger(target, { action: "install", now: "2026-08-26 12:03:41", templateVersion: "0.8.2" });
    runFull(ctxFor(target, "2026-08-26 12:03:41"), resolvePayloadRoot(), target);
    closeLogger();

    const body = readFileSync(join(target, r.path), "utf8");
    assert.match(body, /INFO {2}detect {4}type {8}spring \(근거: build\.gradle\)/, "감지 근거");
    assert.match(body, /INFO {2}detect {4}version {5}0\.0\.1/, "버전 감지");
    assert.match(body, /INFO {2}detect {4}branch {6}main/, "브랜치");
    assert.match(body, /INFO {2}version {3}write {7}version\.yml/, "version.yml 기록");
    assert.match(body, /INFO {2}verify {4}secret {6}SERVER_HOST/, "필요 secret");
    assert.match(body, /=== 요약 ===/, "요약 블록");
    assert.match(body, /설치\s+: \d+개 파일/);
    assert.match(body, /결과\s+: OK/);
  } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
});

test("runFull: .md 설치 로그는 더 이상 생성되지 않는다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-nomd-"));
  try {
    writeFileSync(join(target, "build.gradle"), 'version = "0.0.1"\n');
    resetLogger();
    initLogger(target, { action: "install", now: "2026-08-26 12:03:41" });
    const result = runFull(ctxFor(target, "2026-08-26 12:03:41"), resolvePayloadRoot(), target);
    closeLogger();
    assert.strictEqual(result.installLog, undefined, "installLog 반환값이 없어야 한다");
    const files = readdirSync(join(target, ".github/.wizard/logs"));
    assert.ok(!files.some((f) => f.endsWith(".md")), ".md 로그가 없어야 한다");
  } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
});

test("runFull: 스크립트 덮어쓰기와 README·.gitignore 결과가 파일별 결정으로 남는다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-logdecide-"));
  try {
    mkdirSync(join(target, "src/main/resources"), { recursive: true });
    writeFileSync(join(target, "src/main/resources/application.yaml"), "");
    writeFileSync(join(target, "build.gradle"), 'version = "0.0.1"\n');
    writeFileSync(join(target, "README.md"), "# my-service\n");
    // 사용자가 고친 스크립트 — 설치가 덮어쓴 사실이 로그에 남아야 한다
    mkdirSync(join(target, ".github/scripts"), { recursive: true });
    writeFileSync(join(target, ".github/scripts/version_manager.py"), "# my script edit\n");

    resetLogger();
    const r = initLogger(target, { action: "install", now: "2026-08-26 12:03:41" });
    const result = runFull(ctxFor(target, "2026-08-26 12:03:41"), resolvePayloadRoot(), target);
    closeLogger();

    const body = readFileSync(join(target, r.path), "utf8");
    assert.match(body, /INFO {2}script {4}overwrite {3}\.github\/scripts\/version_manager\.py \(기존 내용과 달라/, "덮어쓴 스크립트");
    assert.match(body, /INFO {2}script {4}create {6}\.github\/scripts\/changelog_manager\.py/, "새로 만든 스크립트");
    assert.match(body, /INFO {2}readme {4}append {6}README\.md 끝에 버전 섹션 추가/, "README 결과");
    assert.strictEqual(result.readme, "added");
    assert.strictEqual(result.scripts.find((s) => s.name === "version_manager.py").action, "overwrite");
  } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
});

test("runFull: README.md가 없으면 추가하지 않았다는 사실이 로그에 남는다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-lognoreadme-"));
  try {
    writeFileSync(join(target, "build.gradle"), 'version = "0.0.1"\n');
    resetLogger();
    const r = initLogger(target, { action: "install", now: "2026-08-26 12:03:41" });
    runFull(ctxFor(target, "2026-08-26 12:03:41"), resolvePayloadRoot(), target);
    closeLogger();
    assert.match(readFileSync(join(target, r.path), "utf8"), /INFO {2}readme {4}skip {8}README\.md가 없어/);
  } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
});

test("runFull: 마커 파일이 없는 타입은 '직접 선택'으로, 설치 선택값은 option 줄로 남는다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-logchoice-"));
  try {
    writeFileSync(join(target, "build.gradle"), 'version = "0.0.1"\n');
    const paths = new Map([["spring", "."], ["python", "."]]);
    const ctx = createContext({
      mode: "full", force: true, types: ["spring", "python"], version: "0.0.1", versionCode: 1,
      branch: "main", branches: { main: "main", develop: "main", mode: "trunk-based" },
      paths, repoName: "my-service", resolvers: makeResolvers(target, "my-service", paths),
      now: "2026-08-26 12:03:41", today: "2026-08-26", templateVersion: "0.8.2",
      deployStyle: "nginx", includeSemverAuto: false, includeCopilotAi: true,
    });
    resetLogger();
    const r = initLogger(target, { action: "install", now: "2026-08-26 12:03:41" });
    runFull(ctx, resolvePayloadRoot(), target);
    closeLogger();
    const body = readFileSync(join(target, r.path), "utf8");
    assert.match(body, /detect {4}type {8}spring \(근거: build\.gradle\)/);
    assert.match(body, /detect {4}type {8}python \(근거: 직접 선택\)/, "없는 pyproject.toml을 근거로 적으면 안 된다");
    assert.match(body, /mode=trunk-based/, "브랜치 전략");
    assert.match(body, /option {4}deploy {6}nginx/);
    assert.match(body, /option {4}semver {6}off/);
    assert.match(body, /option {4}copilot {5}on/);
  } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
});

test("runFull: Flutter 옵션 선택이 로그에 남는다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-logflutter-"));
  try {
    writeFileSync(join(target, "pubspec.yaml"), "name: my_app\nversion: 1.0.0+1\n");
    const paths = new Map([["flutter", "."]]);
    const opts = { envMode: "dotenv", stores: ["android"], androidDeployMode: "store_prepare", iosDeployMode: "" };
    const ctx = createContext({
      mode: "full", force: true, types: ["flutter"], version: "1.0.0", versionCode: 1,
      branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
      paths, repoName: "my-app", resolvers: makeResolvers(target, "my-app", paths, opts),
      now: "2026-08-26 12:03:41", today: "2026-08-26", templateVersion: "0.8.2",
      envMode: "dotenv", flutterStore: ["android"], androidDeployMode: "store_prepare", iosDeployMode: "store_only",
    });
    resetLogger();
    const r = initLogger(target, { action: "install", now: "2026-08-26 12:03:41" });
    runFull(ctx, resolvePayloadRoot(), target);
    closeLogger();
    assert.match(readFileSync(join(target, r.path), "utf8"),
      /option {4}flutter {5}env=dotenv stores=android android=store_prepare ios=store_only/);
  } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
});
