// tests/node/logger-full.test.js
// Regression: every stage of the full pipeline is logged.
import "../setup-lang.mjs"; // these tests assert the ko output
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

test("runFull: detect, version, and verify stages are all logged with a summary", () => {
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
    assert.match(body, /INFO {2}detect {4}type {8}spring \(근거: build\.gradle\)/, "detection basis");
    assert.match(body, /INFO {2}detect {4}version {5}0\.0\.1/, "version detection");
    assert.match(body, /INFO {2}detect {4}branch {6}main/, "branch");
    assert.match(body, /INFO {2}version {3}write {7}version\.yml/, "version.yml write");
    assert.match(body, /INFO {2}verify {4}secret {6}SERVER_HOST/, "required secret");
    assert.match(body, /=== 요약 ===/, "summary block");
    assert.match(body, /설치\s+: \d+개 파일/);
    assert.match(body, /결과\s+: OK/);
  } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
});

test("runFull: .md install log is no longer generated", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-nomd-"));
  try {
    writeFileSync(join(target, "build.gradle"), 'version = "0.0.1"\n');
    resetLogger();
    initLogger(target, { action: "install", now: "2026-08-26 12:03:41" });
    const result = runFull(ctxFor(target, "2026-08-26 12:03:41"), resolvePayloadRoot(), target);
    closeLogger();
    assert.strictEqual(result.installLog, undefined, "installLog return value must be absent");
    const files = readdirSync(join(target, ".github/.wizard/logs"));
    assert.ok(!files.some((f) => f.endsWith(".md")), "no .md log must exist");
  } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
});

test("runFull: script overwrite and README/.gitignore results are recorded as per-file decisions", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-logdecide-"));
  try {
    mkdirSync(join(target, "src/main/resources"), { recursive: true });
    writeFileSync(join(target, "src/main/resources/application.yaml"), "");
    writeFileSync(join(target, "build.gradle"), 'version = "0.0.1"\n');
    writeFileSync(join(target, "README.md"), "# my-service\n");
    // User-edited script: the fact that install overwrote it must be logged
    mkdirSync(join(target, ".github/scripts"), { recursive: true });
    writeFileSync(join(target, ".github/scripts/version_manager.py"), "# my script edit\n");

    resetLogger();
    const r = initLogger(target, { action: "install", now: "2026-08-26 12:03:41" });
    const result = runFull(ctxFor(target, "2026-08-26 12:03:41"), resolvePayloadRoot(), target);
    closeLogger();

    const body = readFileSync(join(target, r.path), "utf8");
    assert.match(body, /INFO {2}script {4}overwrite {3}\.github\/scripts\/version_manager\.py \(기존 내용과 달라/, "overwritten script");
    assert.match(body, /INFO {2}script {4}create {6}\.github\/scripts\/changelog_manager\.py/, "newly created script");
    assert.match(body, /INFO {2}readme {4}append {6}README\.md 끝에 버전 섹션 추가/, "README result");
    assert.strictEqual(result.readme, "added");
    assert.strictEqual(result.scripts.find((s) => s.name === "version_manager.py").action, "overwrite");
  } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
});

test("runFull: when README.md is missing, the fact that nothing was added is logged", () => {
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

test("runFull: a type without marker files is logged as manual selection, and install choices as option lines", () => {
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
    assert.match(body, /detect {4}type {8}python \(근거: 직접 선택\)/, "must not cite a nonexistent pyproject.toml as the basis");
    assert.match(body, /mode=trunk-based/, "branch strategy");
    assert.match(body, /option {4}deploy {6}nginx/);
    assert.match(body, /option {4}semver {6}off/);
    assert.match(body, /option {4}copilot {5}on/);
  } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
});

test("runFull: Flutter option choices are logged", () => {
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

test("runFull: deletions and .bak moves from deploy-method cleanup are counted in the summary", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-logfull-"));
  try {
    mkdirSync(join(target, "src/main/resources"), { recursive: true });
    writeFileSync(join(target, "src/main/resources/application.yaml"), "");
    writeFileSync(join(target, "build.gradle"), 'version = "0.0.1"\n');
    resetLogger();
    runFull({ ...ctxFor(target, "2026-08-26 12:03:41"), deployStyle: "simple" }, resolvePayloadRoot(), target);
    const simple = join(target, ".github/workflows/PROJECT-SPRING-SIMPLE-CICD.yaml");
    writeFileSync(simple, readFileSync(simple, "utf8") + "# manual edit\n");

    const r = initLogger(target, { action: "update", now: "2026-08-26 12:10:00", templateVersion: "0.8.2" });
    runFull({ ...ctxFor(target, "2026-08-26 12:10:00"), deployStyle: "traefik" }, resolvePayloadRoot(), target);
    closeLogger();
    const body = readFileSync(join(target, r.path), "utf8");
    assert.match(body, /백업 교체\s+: 0개/, "there were no conflict backups");
    assert.match(body, /정리\s+: 삭제 0개, \.bak 이동 1개/);
  } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
});
