// tests/node/flutter-store-filter.test.js
// Flutter 스토어 워크플로우 선택 필터 (이슈 #131) — 설치·충돌 조사·계획(status/dry-run)이 같은 파일 집합을 본다.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { copyWorkflows, planWorkflows, surveyWorkflows, listWorkflowConflicts } from "../../src/core/copy/workflows.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { writeBaseline } from "../../src/core/baseline.js";

const PAYLOAD = resolvePayloadRoot();
const WF_DIR = ".github/workflows";

const PLAY = "PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml";
const TESTFLIGHT = "PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml";
const TESTFLIGHT_TEST = "PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml";
// 스토어 선택과 무관하게 항상 설치되는 Flutter 워크플로우
const ALWAYS = [
  "PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml",
  "PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD.yaml",
  "PROJECT-FLUTTER-ANDROID-TEST-APK.yaml",
  "PROJECT-FLUTTER-APP-BUILD-TRIGGER.yaml",
  "PROJECT-FLUTTER-CI.yaml",
];

function flutterContext(overrides = {}) {
  return createContext({
    mode: "full", force: true, types: ["flutter"], version: "1.0.0",
    branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(), repoName: "app", resolvers: {},
    ...overrides,
  });
}

const freshTarget = () => mkdtempSync(join(tmpdir(), "paw-store-filter-"));
const installedFlutter = (target) =>
  readdirSync(join(target, WF_DIR)).filter((f) => f.startsWith("PROJECT-FLUTTER-")).sort();
const plannedFlutter = (plan, bucket = "newFiles") =>
  plan[bucket].filter((f) => f.type === "flutter").map((f) => f.filename).sort();

test("flutterStore null: 스토어 필터가 없어 Flutter 워크플로우 8종이 전부 계획·설치된다 (현행 동작)", () => {
  const target = freshTarget();
  try {
    const all = [PLAY, TESTFLIGHT, TESTFLIGHT_TEST, ...ALWAYS].sort();
    const ctx = flutterContext({ flutterStore: null });
    assert.deepStrictEqual(plannedFlutter(planWorkflows(ctx, PAYLOAD, target)), all);
    copyWorkflows(ctx, PAYLOAD, target);
    assert.deepStrictEqual(installedFlutter(target), all);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("flutterStore 필드가 아예 없는 평범한 context도 현행 동작과 같다", () => {
  const target = freshTarget();
  try {
    const ctx = { types: ["flutter"], paths: new Map(), repoName: "app", resolvers: {}, branches: { main: "main", develop: "develop", mode: "pr-flow" } };
    copyWorkflows(ctx, PAYLOAD, target);
    assert.strictEqual(installedFlutter(target).length, 8);
    assert.strictEqual(plannedFlutter(planWorkflows(ctx, PAYLOAD, target), "unchanged").length, 8);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("flutterStore [android]: iOS 워크플로우 2종만 빠지고 나머지는 그대로다 — 설치와 계획이 일치한다", () => {
  const target = freshTarget();
  try {
    const expected = [PLAY, ...ALWAYS].sort();
    const ctx = flutterContext({ flutterStore: ["android"] });
    assert.deepStrictEqual(plannedFlutter(planWorkflows(ctx, PAYLOAD, target)), expected);
    copyWorkflows(ctx, PAYLOAD, target);
    assert.deepStrictEqual(installedFlutter(target), expected);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("flutterStore [ios]: PLAYSTORE만 빠진다", () => {
  const target = freshTarget();
  try {
    const expected = [TESTFLIGHT, TESTFLIGHT_TEST, ...ALWAYS].sort();
    const ctx = flutterContext({ flutterStore: ["ios"] });
    assert.deepStrictEqual(plannedFlutter(planWorkflows(ctx, PAYLOAD, target)), expected);
    copyWorkflows(ctx, PAYLOAD, target);
    assert.deepStrictEqual(installedFlutter(target), expected);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("flutterStore []: 스토어 워크플로우가 하나도 설치되지 않는다 (none 선택)", () => {
  const target = freshTarget();
  try {
    const ctx = flutterContext({ flutterStore: [] });
    assert.deepStrictEqual(plannedFlutter(planWorkflows(ctx, PAYLOAD, target)), [...ALWAYS].sort());
    copyWorkflows(ctx, PAYLOAD, target);
    assert.deepStrictEqual(installedFlutter(target), [...ALWAYS].sort());
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("Flutter가 아닌 타입은 flutterStore가 무엇이든 계획이 달라지지 않는다", () => {
  const target = freshTarget();
  try {
    const base = { types: ["react"], paths: new Map(), repoName: "app", resolvers: {}, branches: { main: "main", develop: "develop", mode: "pr-flow" } };
    const withStore = planWorkflows({ ...base, flutterStore: [] }, PAYLOAD, target);
    const without = planWorkflows({ ...base, flutterStore: null }, PAYLOAD, target);
    assert.deepStrictEqual(withStore, without);
    assert.ok(withStore.newFiles.some((f) => f.type === "react"));
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("surveyWorkflows/listWorkflowConflicts: 선택 해제된 스토어 워크플로우의 수정본은 충돌 질문 대상이 아니다", () => {
  const target = freshTarget();
  try {
    copyWorkflows(flutterContext({ flutterStore: null }), PAYLOAD, target);
    for (const f of [PLAY, TESTFLIGHT]) {
      const p = join(target, WF_DIR, f);
      writeFileSync(p, readFileSync(p, "utf8") + "\n# 내가 고친 부분\n");
    }
    const ctx = flutterContext({ flutterStore: ["android"] });
    const names = surveyWorkflows(ctx, PAYLOAD, target).conflicts.map((c) => c.filename);
    assert.deepStrictEqual(names, [PLAY], "선택된 PLAYSTORE 수정본만 충돌, 선택 해제된 TESTFLIGHT는 묻지 않는다");
    assert.deepStrictEqual(listWorkflowConflicts(ctx, PAYLOAD, target).map((c) => c.filename), [PLAY]);
    // 선택 미결정(null)이면 둘 다 충돌 — 현행 동작
    const nullNames = surveyWorkflows(flutterContext({ flutterStore: null }), PAYLOAD, target).conflicts.map((c) => c.filename).sort();
    assert.deepStrictEqual(nullNames, [PLAY, TESTFLIGHT].sort());
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("copyWorkflows: 선택 해제된 스토어 워크플로우 수정본은 env 치환으로도 건드리지 않는다 (바이트 보존)", () => {
  const target = freshTarget();
  try {
    copyWorkflows(flutterContext({ flutterStore: null }), PAYLOAD, target);
    // @wizard 마커가 있는 사용자 수정본 — 가드가 없으면 configureEnv가 "app"으로 덮고 마커를 지운다.
    const mine = 'name: 내 워크플로우\nenv:\n  FLUTTER_PROJECT_DIR: "."  # @wizard auto:flutter-root\n';
    const p = join(target, WF_DIR, TESTFLIGHT);
    writeFileSync(p, mine);

    const ctx = flutterContext({ flutterStore: ["android"], resolvers: { "flutter-root": () => "app" } });
    copyWorkflows(ctx, PAYLOAD, target);
    assert.strictEqual(readFileSync(p, "utf8"), mine);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("planWorkflows: 선택 해제된 스토어 워크플로우는 baseline에 있는데 디스크에 없어도 removed로 보고하지 않는다", () => {
  const target = freshTarget();
  try {
    copyWorkflows(flutterContext({ flutterStore: null }), PAYLOAD, target);
    writeBaseline(target, {
      templateVersion: "0.10.0", installedAt: "2026-09-21",
      entries: new Map([[TESTFLIGHT, { installed: "sha256:x", rendered: "sha256:y" }]]),
    });
    rmSync(join(target, WF_DIR, TESTFLIGHT));

    const removedNames = (ctx) => planWorkflows(ctx, PAYLOAD, target).removed.map((f) => f.filename);
    assert.deepStrictEqual(removedNames(flutterContext({ flutterStore: null })), [TESTFLIGHT], "현행 동작: 사용자가 지운 파일");
    assert.deepStrictEqual(removedNames(flutterContext({ flutterStore: ["android"] })), [], "선택 해제된 파일은 지운 게 아니라 원래 대상이 아니다");
  } finally { rmSync(target, { recursive: true, force: true }); }
});
