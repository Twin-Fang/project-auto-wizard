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
