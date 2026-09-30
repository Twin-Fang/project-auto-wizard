// tests/node/logger-copy.test.js
// Regression that per-file copy decisions are logged along with their reasons.
import "../setup-lang.mjs"; // these tests assert the ko output
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
import { sha256, BASELINE_PATH } from "../../src/core/baseline.js";

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

test("first install: newly written files are recorded as write", () => {
  const target = springTarget();
  try {
    resetLogger();
    const r = initLogger(target, { action: "install", now: "2026-08-26 12:03:41" });
    runFull(ctxFor(target, "2026-08-26 12:03:41"), resolvePayloadRoot(), target);
    closeLogger();
    const body = readFileSync(join(target, r.path), "utf8");
    assert.match(body, /INFO {2}copy {6}write {7}PROJECT-COMMON-VERSION-CONTROL\.yaml \(new\)/);
  } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
});

test("reinstall: a user-modified file is recorded as keep-local with its reason", () => {
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
    assert.match(body, /copy {6}keep-local {2}PROJECT-COMMON-VERSION-CONTROL\.yaml/,
      "keeping the user-modified copy must be logged with a reason");
  } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
});

test("reinstall: an untouched file is recorded as skip(unchanged)", () => {
  const target = springTarget();
  try {
    resetLogger();
    runFull(ctxFor(target, "2026-08-26 12:03:41"), resolvePayloadRoot(), target);
    const r = initLogger(target, { action: "update", now: "2026-08-26 12:10:00" });
    runFull(ctxFor(target, "2026-08-26 12:10:00"), resolvePayloadRoot(), target);
    closeLogger();
    const body = readFileSync(join(target, r.path), "utf8");
    assert.match(body, /copy {6}skip {8}.*\(unchanged\)/);
  } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
});

test("reinstall: an auto-updated file is not counted twice in the summary, under install and auto-update", () => {
  const target = springTarget();
  try {
    resetLogger();
    runFull(ctxFor(target, "2026-08-26 12:03:41"), resolvePayloadRoot(), target);
    // Mimics a file installed by a previous version — the content differs but matches baseline's installed, so it is unmodified by the user.
    const name = "PROJECT-COMMON-VERSION-CONTROL.yaml";
    const old = "# 이전 버전 템플릿\n";
    writeFileSync(join(target, ".github/workflows", name), old);
    const bp = join(target, BASELINE_PATH);
    const baseline = JSON.parse(readFileSync(bp, "utf8"));
    baseline.files[name].installed = sha256(old);
    writeFileSync(bp, JSON.stringify(baseline));

    const r = initLogger(target, { action: "update", now: "2026-08-26 12:10:00" });
    const result = runFull(ctxFor(target, "2026-08-26 12:10:00"), resolvePayloadRoot(), target);
    closeLogger();
    assert.deepStrictEqual(result.workflows.autoUpdated, [name]);
    const body = readFileSync(join(target, r.path), "utf8");
    assert.match(body, /설치\s+: 0개 파일/);
    assert.match(body, /자동 갱신\s+: 1개/);
  } finally { resetLogger(); rmSync(target, { recursive: true, force: true }); }
});
