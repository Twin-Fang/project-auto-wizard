// tests/node/flutter-store-filter.test.js
// Flutter store workflow selection filter: install, conflict survey, and planning (status/dry-run) all see the same file set.
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
// Flutter workflows always installed regardless of store selection
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

test("flutterStore null: no store filter, so all 8 Flutter workflows are planned and installed (current behavior)", () => {
  const target = freshTarget();
  try {
    const all = [PLAY, TESTFLIGHT, TESTFLIGHT_TEST, ...ALWAYS].sort();
    const ctx = flutterContext({ flutterStore: null });
    assert.deepStrictEqual(plannedFlutter(planWorkflows(ctx, PAYLOAD, target)), all);
    copyWorkflows(ctx, PAYLOAD, target);
    assert.deepStrictEqual(installedFlutter(target), all);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("flutterStore a plain context without the field behaves like the current behavior", () => {
  const target = freshTarget();
  try {
    const ctx = { types: ["flutter"], paths: new Map(), repoName: "app", resolvers: {}, branches: { main: "main", develop: "develop", mode: "pr-flow" } };
    copyWorkflows(ctx, PAYLOAD, target);
    assert.strictEqual(installedFlutter(target).length, 8);
    assert.strictEqual(plannedFlutter(planWorkflows(ctx, PAYLOAD, target), "unchanged").length, 8);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("flutterStore [android]: only the 2 iOS workflows drop out and the rest stay; install and plan agree", () => {
  const target = freshTarget();
  try {
    const expected = [PLAY, ...ALWAYS].sort();
    const ctx = flutterContext({ flutterStore: ["android"] });
    assert.deepStrictEqual(plannedFlutter(planWorkflows(ctx, PAYLOAD, target)), expected);
    copyWorkflows(ctx, PAYLOAD, target);
    assert.deepStrictEqual(installedFlutter(target), expected);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("flutterStore [ios]: only PLAYSTORE drops out", () => {
  const target = freshTarget();
  try {
    const expected = [TESTFLIGHT, TESTFLIGHT_TEST, ...ALWAYS].sort();
    const ctx = flutterContext({ flutterStore: ["ios"] });
    assert.deepStrictEqual(plannedFlutter(planWorkflows(ctx, PAYLOAD, target)), expected);
    copyWorkflows(ctx, PAYLOAD, target);
    assert.deepStrictEqual(installedFlutter(target), expected);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("flutterStore []: no store workflow is installed (none selected)", () => {
  const target = freshTarget();
  try {
    const ctx = flutterContext({ flutterStore: [] });
    assert.deepStrictEqual(plannedFlutter(planWorkflows(ctx, PAYLOAD, target)), [...ALWAYS].sort());
    copyWorkflows(ctx, PAYLOAD, target);
    assert.deepStrictEqual(installedFlutter(target), [...ALWAYS].sort());
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("for non-Flutter types the plan is unchanged whatever flutterStore is", () => {
  const target = freshTarget();
  try {
    const base = { types: ["react"], paths: new Map(), repoName: "app", resolvers: {}, branches: { main: "main", develop: "develop", mode: "pr-flow" } };
    const withStore = planWorkflows({ ...base, flutterStore: [] }, PAYLOAD, target);
    const without = planWorkflows({ ...base, flutterStore: null }, PAYLOAD, target);
    assert.deepStrictEqual(withStore, without);
    assert.ok(withStore.newFiles.some((f) => f.type === "react"));
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("surveyWorkflows/listWorkflowConflicts: a modified copy of a deselected store workflow is not a conflict question target", () => {
  const target = freshTarget();
  try {
    copyWorkflows(flutterContext({ flutterStore: null }), PAYLOAD, target);
    for (const f of [PLAY, TESTFLIGHT]) {
      const p = join(target, WF_DIR, f);
      writeFileSync(p, readFileSync(p, "utf8") + "\n# my edit\n");
    }
    const ctx = flutterContext({ flutterStore: ["android"] });
    const names = surveyWorkflows(ctx, PAYLOAD, target).conflicts.map((c) => c.filename);
    assert.deepStrictEqual(names, [PLAY], "only the selected PLAYSTORE edit conflicts; the deselected TESTFLIGHT is not asked");
    assert.deepStrictEqual(listWorkflowConflicts(ctx, PAYLOAD, target).map((c) => c.filename), [PLAY]);
    // When selection is undecided (null), both conflict: current behavior
    const nullNames = surveyWorkflows(flutterContext({ flutterStore: null }), PAYLOAD, target).conflicts.map((c) => c.filename).sort();
    assert.deepStrictEqual(nullNames, [PLAY, TESTFLIGHT].sort());
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("copyWorkflows: a modified deselected store workflow is not touched even by env substitution (bytes preserved)", () => {
  const target = freshTarget();
  try {
    copyWorkflows(flutterContext({ flutterStore: null }), PAYLOAD, target);
    // User-edited copy with a @wizard marker: without the guard, configureEnv would overwrite it with "app" and erase the marker.
    const mine = 'name: my workflow\nenv:\n  FLUTTER_PROJECT_DIR: "."  # @wizard auto:flutter-root\n';
    const p = join(target, WF_DIR, TESTFLIGHT);
    writeFileSync(p, mine);

    const ctx = flutterContext({ flutterStore: ["android"], resolvers: { "flutter-root": () => "app" } });
    copyWorkflows(ctx, PAYLOAD, target);
    assert.strictEqual(readFileSync(p, "utf8"), mine);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("planWorkflows: a deselected store workflow in the baseline but missing on disk is not reported as removed", () => {
  const target = freshTarget();
  try {
    copyWorkflows(flutterContext({ flutterStore: null }), PAYLOAD, target);
    writeBaseline(target, {
      templateVersion: "0.10.0", installedAt: "2026-09-21",
      entries: new Map([[TESTFLIGHT, { installed: "sha256:x", rendered: "sha256:y" }]]),
    });
    rmSync(join(target, WF_DIR, TESTFLIGHT));

    const removedNames = (ctx) => planWorkflows(ctx, PAYLOAD, target).removed.map((f) => f.filename);
    assert.deepStrictEqual(removedNames(flutterContext({ flutterStore: null })), [TESTFLIGHT], "current behavior: file the user deleted");
    assert.deepStrictEqual(removedNames(flutterContext({ flutterStore: ["android"] })), [], "a deselected file was not deleted; it was never a target");
  } finally { rmSync(target, { recursive: true, force: true }); }
});
