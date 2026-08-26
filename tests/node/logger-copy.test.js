// tests/node/logger-copy.test.js
// 파일별 복사 결정이 사유와 함께 로그에 남는지 회귀.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initLogger, resetLogger, closeLogger } from "../../src/core/logger.js";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { makeResolvers } from "../../src/core/detect-fs.js";

function springTarget() {
  const target = mkdtempSync(join(tmpdir(), "paw-logcopy-"));
  mkdirSync(join(target, "src/main/resources"), { recursive: true });
  writeFileSync(join(target, "src/main/resources/application.yaml"), "");
  writeFileSync(join(target, "build.gradle"), 'version = "0.0.1"\n');
  return target;
}

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

test("최초 설치: 새로 쓰이는 파일이 write로 기록된다", () => {
  const target = springTarget();
  try {
    resetLogger();
    const r = initLogger(target, { action: "install", now: "2026-08-26 12:03:41" });
    runFull(ctxFor(target, "2026-08-26 12:03:41"), resolvePayloadRoot(), target);
    closeLogger();
    const body = readFileSync(join(target, r.path), "utf8");
    assert.match(body, /INFO {2}copy {4}write {7}PROJECT-COMMON-VERSION-CONTROL\.yaml \(new\)/);
  } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
});

test("재설치: 사용자가 수정한 파일은 keep-local로 사유와 함께 기록된다", () => {
  const target = springTarget();
  try {
    resetLogger();
    runFull(ctxFor(target, "2026-08-26 12:03:41"), resolvePayloadRoot(), target);
    const wf = join(target, ".github/workflows/PROJECT-COMMON-VERSION-CONTROL.yaml");
    writeFileSync(wf, readFileSync(wf, "utf8") + "\n# 사용자가 추가한 줄\n");
    const r = initLogger(target, { action: "update", now: "2026-08-26 12:10:00" });
    runFull(ctxFor(target, "2026-08-26 12:10:00"), resolvePayloadRoot(), target);
    closeLogger();
    const body = readFileSync(join(target, r.path), "utf8");
    assert.match(body, /copy {4}keep-local {2}PROJECT-COMMON-VERSION-CONTROL\.yaml/,
      "사용자 수정본 유지가 사유와 함께 남아야 한다");
  } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
});

test("재설치: 손대지 않은 파일은 skip(unchanged)으로 기록된다", () => {
  const target = springTarget();
  try {
    resetLogger();
    runFull(ctxFor(target, "2026-08-26 12:03:41"), resolvePayloadRoot(), target);
    const r = initLogger(target, { action: "update", now: "2026-08-26 12:10:00" });
    runFull(ctxFor(target, "2026-08-26 12:10:00"), resolvePayloadRoot(), target);
    closeLogger();
    const body = readFileSync(join(target, r.path), "utf8");
    assert.match(body, /copy {4}skip {8}.*\(unchanged\)/);
  } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
});
