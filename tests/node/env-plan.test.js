// tests/node/env-plan.test.js
import "../setup-lang.mjs"; // these tests assert the ko output
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collectAsks, promptEnvPlan } from "../../src/ui/env-plan.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";

function makeFixturePayload() {
  const root = mkdtempSync(join(tmpdir(), "paw-env-plan-"));
  const commonDir = join(root, "workflows", "common");
  mkdirSync(commonDir, { recursive: true });
  writeFileSync(
    join(commonDir, "PROJECT-COMMON-FOO.yaml"),
    [
      "name: FOO",
      "env:",
      '  FOO_FLAG: "false" # @wizard ask:false',
      '  FOO_NAME: "bar" # @wizard ask:bar',
      "",
    ].join("\n"),
  );
  return root;
}

test("collectAsks: the top level of common/ is always scanned even when types is empty", () => {
  const root = makeFixturePayload();
  try {
    const asks = collectAsks(root, []);
    assert.ok(asks.keys.includes("FOO_FLAG"));
    assert.ok(asks.keys.includes("FOO_NAME"));
    assert.strictEqual(asks.defaults.get("FOO_FLAG"), "false");
    const usage = asks.usages.get("FOO_FLAG");
    assert.ok(usage.some((u) => u.type === "common"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("collectAsks: no common ask key contains SERVER_BASE_PATH (regression)", () => {
  const asks = collectAsks(resolvePayloadRoot(), []);
  assert.ok(!asks.keys.includes("SERVER_BASE_PATH"));
});

test("promptEnvPlan: ask fields whose default is true/false use io.confirm instead of io.text", async () => {
  const root = makeFixturePayload();
  try {
    const confirmedInitialValues = [];
    const textedDefaults = [];
    const io = {
      select: async () => "each",
      multiselect: async () => [],
      text: async ({ defaultValue }) => { textedDefaults.push(defaultValue); return defaultValue; },
      confirm: async ({ initialValue }) => { confirmedInitialValues.push(initialValue); return true; },
    };
    const result = await promptEnvPlan({
      payloadRoot: root, types: [], io, force: false, log: () => {},
    });
    assert.strictEqual(result.values.get("FOO_FLAG"), "true"); // confirm() answers true → converted to the "true" string
    assert.strictEqual(result.values.get("FOO_NAME"), "bar");  // non-boolean fields keep the text() path
    assert.strictEqual(confirmedInitialValues.length, 1);
    assert.strictEqual(confirmedInitialValues[0], false); // FOO_FLAG default "false" → initialValue=false
    assert.strictEqual(textedDefaults.length, 1);
    assert.strictEqual(textedDefaults[0], "bar");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("promptEnvPlan: when confirm returns CANCEL, boolean fields keep their default", async () => {
  const root = makeFixturePayload();
  try {
    const { CANCEL } = await import("../../src/ui/readline-engine.js");
    const io = {
      select: async () => "each",
      multiselect: async () => [],
      text: async ({ defaultValue }) => defaultValue,
      confirm: async () => CANCEL,
    };
    const result = await promptEnvPlan({
      payloadRoot: root, types: [], io, force: false, log: () => {},
    });
    assert.strictEqual(result.values.get("FOO_FLAG"), "false");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("collectAsks: ISSUE_HELPER_CREATE_BRANCH from the real payload is exposed by the common scan (integration)", () => {
  const asks = collectAsks(resolvePayloadRoot(), []);
  assert.ok(asks.keys.includes("ISSUE_HELPER_CREATE_BRANCH"));
  assert.strictEqual(asks.defaults.get("ISSUE_HELPER_CREATE_BRANCH"), "false");
});

test("promptEnvPlan: ISSUE_HELPER_CREATE_BRANCH from the real payload is asked as a yes/no toggle (integration)", async () => {
  const io = {
    select: async () => "each",
    multiselect: async () => [],
    text: async ({ defaultValue }) => defaultValue,
    confirm: async ({ initialValue }) => { assert.strictEqual(initialValue, false); return true; },
  };
  const result = await promptEnvPlan({
    payloadRoot: resolvePayloadRoot(), types: [], io, force: false, log: () => {},
  });
  assert.strictEqual(result.values.get("ISSUE_HELPER_CREATE_BRANCH"), "true");
});

test("collectAsks: an ask default containing the __PROJECT_NAME__ literal is replaced with the real repoName", () => {
  const root = mkdtempSync(join(tmpdir(), "paw-env-plan-"));
  const commonDir = join(root, "workflows", "common");
  mkdirSync(commonDir, { recursive: true });
  writeFileSync(
    join(commonDir, "PROJECT-COMMON-FOO.yaml"),
    [
      "name: FOO",
      "env:",
      '  VOLUME_CONTAINER_PATH: "/mnt/__PROJECT_NAME__" # @wizard ask:/mnt/__PROJECT_NAME__',
      "",
    ].join("\n"),
  );
  try {
    const asks = collectAsks(root, [], { resolvers: { repo: () => "my-service" } });
    assert.strictEqual(asks.defaults.get("VOLUME_CONTAINER_PATH"), "/mnt/my-service");
    assert.strictEqual(asks.typeDefaults.get("common|VOLUME_CONTAINER_PATH"), "/mnt/my-service");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("collectAsks: ENABLE_VOLUME_MOUNT from the real payload is exposed by the go workflow scan (integration)", () => {
  const asks = collectAsks(resolvePayloadRoot(), ["go"]);
  assert.ok(asks.keys.includes("ENABLE_VOLUME_MOUNT"));
  assert.strictEqual(asks.defaults.get("ENABLE_VOLUME_MOUNT"), "false");
  // It is more natural to ask this before VOLUME_HOST_PATH/VOLUME_CONTAINER_PATH.
  assert.ok(asks.keys.indexOf("ENABLE_VOLUME_MOUNT") < asks.keys.indexOf("VOLUME_HOST_PATH"));
});

test("promptEnvPlan: ENABLE_VOLUME_MOUNT from the real payload is asked as a yes/no toggle (integration)", async () => {
  const io = {
    select: async () => "each",
    multiselect: async () => [],
    text: async ({ defaultValue }) => defaultValue,
    confirm: async ({ message, initialValue }) => {
      if (message.includes("볼륨 마운트")) {
        assert.strictEqual(initialValue, false);
        return true;
      }
      return initialValue;
    },
  };
  const result = await promptEnvPlan({
    payloadRoot: resolvePayloadRoot(), types: ["go"], io, force: false, log: () => {},
  });
  assert.strictEqual(result.values.get("ENABLE_VOLUME_MOUNT"), "true");
});

test("collectAsks: VOLUME_CONTAINER_PATH of the real payload's NGINX zero-downtime deploy is exposed by the scan (integration)", () => {
  const asks = collectAsks(resolvePayloadRoot(), ["spring"], { deployStyle: "nginx" });
  assert.ok(asks.keys.includes("VOLUME_CONTAINER_PATH"));
  assert.strictEqual(asks.defaults.get("VOLUME_CONTAINER_PATH"), "/app");
});

test("collectAsks: when deployStyle is 'none' the whole server-deploy folder (including PR preview) is not scanned", () => {
  const asks = collectAsks(resolvePayloadRoot(), ["spring"], { deployStyle: "none" });
  assert.ok(!asks.keys.includes("VOLUME_CONTAINER_PATH"), "nginx/traefik-only keys must not be scanned");
  assert.ok(!asks.keys.includes("SSH_AUTH_METHOD"),
    "ask key common to the 4 server-deploy files (SIMPLE/NGINX/TRAEFIK/PR preview) — its absence proves the whole folder was skipped");
});

test("collectAsks: for the go type with deployStyle 'none', the type-root CD and PR preview keys are not scanned", () => {
  const asks = collectAsks(resolvePayloadRoot(), ["go"], { deployStyle: "none" });
  assert.ok(!asks.keys.includes("DEPLOY_PORT"), "go SIMPLE-CICD-only keys must not be scanned");
  assert.ok(!asks.keys.includes("ENABLE_VOLUME_MOUNT"), "go SIMPLE-CICD-only keys must not be scanned");
  assert.ok(!asks.keys.includes("SSH_AUTH_METHOD"), "PR preview is not installed either, so its key is not asked");
});

test("collectAsks: for the go type, single-server deploy keys are scanned even when nginx is chosen (type has no zero-downtime workflow)", () => {
  const asks = collectAsks(resolvePayloadRoot(), ["go"], { deployStyle: "nginx" });
  assert.ok(asks.keys.includes("DEPLOY_PORT"));
});

test("collectAsks: @wizard fallback/auto lines are not collected as questions (only ask is collected)", () => {
  const root = mkdtempSync(join(tmpdir(), "paw-env-plan-fallback-"));
  try {
    const flutterDir = join(root, "workflows", "flutter");
    mkdirSync(flutterDir, { recursive: true });
    writeFileSync(join(flutterDir, "PROJECT-FLUTTER-SAMPLE.yaml"), [
      "name: SAMPLE",
      "env:",
      '  PROJECT_PATH: "."  # @wizard auto:project-path',
      '  ENV_MODE: "dart-define"  # @wizard auto:flutter-env-mode',
      "  DEPLOY_MODE: ${{ github.event.inputs.deploy_mode || vars.ANDROID_DEPLOY_MODE || 'store_only' }}  # @wizard fallback:android-deploy-mode",
      '  ASK_ONLY: "x"  # @wizard ask:x',
      "",
    ].join("\n"));
    const asks = collectAsks(root, ["flutter"]);
    assert.deepStrictEqual(asks.keys, ["ASK_ONLY"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Flutter store workflow selection — questions for workflows that will not be installed are not asked.
function makeFlutterFixturePayload() {
  const root = mkdtempSync(join(tmpdir(), "paw-env-plan-flutter-"));
  const dir = join(root, "workflows", "flutter");
  mkdirSync(dir, { recursive: true });
  const files = {
    "PROJECT-FLUTTER-CI.yaml": "CI_ONLY",
    "PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml": "PLAY_ONLY",
    "PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml": "TESTFLIGHT_ONLY",
    "PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml": "TEST_TESTFLIGHT_ONLY",
  };
  for (const [name, key] of Object.entries(files)) {
    writeFileSync(join(dir, name), ["name: X", "env:", `  ${key}: "v" # @wizard ask:v`, ""].join("\n"));
  }
  return root;
}

test("collectAsks: when flutterStore is null/unspecified, all ask keys of the store workflows are collected too (current behavior)", () => {
  const root = makeFlutterFixturePayload();
  try {
    for (const opts of [{ flutterStore: null }, {}]) {
      const asks = collectAsks(root, ["flutter"], opts);
      for (const k of ["CI_ONLY", "PLAY_ONLY", "TESTFLIGHT_ONLY", "TEST_TESTFLIGHT_ONLY"]) {
        assert.ok(asks.keys.includes(k), `${k} (${JSON.stringify(opts)})`);
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("collectAsks: ask keys of deselected store workflows are not collected", () => {
  const root = makeFlutterFixturePayload();
  try {
    const android = collectAsks(root, ["flutter"], { flutterStore: ["android"] });
    assert.deepStrictEqual([...android.keys].sort(), ["CI_ONLY", "PLAY_ONLY"]);

    const ios = collectAsks(root, ["flutter"], { flutterStore: ["ios"] });
    assert.deepStrictEqual([...ios.keys].sort(), ["CI_ONLY", "TESTFLIGHT_ONLY", "TEST_TESTFLIGHT_ONLY"]);

    const none = collectAsks(root, ["flutter"], { flutterStore: [] });
    assert.deepStrictEqual(none.keys, ["CI_ONLY"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("collectAsks: non-Flutter types are not affected by flutterStore", () => {
  const root = makeFlutterFixturePayload();
  try {
    const dir = join(root, "workflows", "react");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "PROJECT-REACT-CI.yaml"), ["name: R", "env:", '  REACT_ONLY: "v" # @wizard ask:v', ""].join("\n"));
    const asks = collectAsks(root, ["react"], { flutterStore: [] });
    assert.deepStrictEqual(asks.keys, ["REACT_ONLY"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("promptEnvPlan: flutterStore is passed through to collectAsks so the answer list has no keys of deselected workflows", async () => {
  const root = makeFlutterFixturePayload();
  try {
    const result = await promptEnvPlan({ payloadRoot: root, types: ["flutter"], force: true, flutterStore: ["android"], log: () => {} });
    assert.deepStrictEqual(result.answers.map((a) => a.key).sort(), ["CI_ONLY", "PLAY_ONLY"]);
    const all = await promptEnvPlan({ payloadRoot: root, types: ["flutter"], force: true, log: () => {} });
    assert.strictEqual(all.answers.length, 4, "unspecified (null) keeps current behavior");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("validateAskValue: validates port, SSH auth method and JDK version formats", async () => {
  const { validateAskValue } = await import("../../src/ui/env-plan.js");
  for (const ok of [["DEPLOY_PORT", "8080"], ["SSH_PORT", "22"], ["SSH_AUTH_METHOD", "key"], ["JAVA_VERSION", "21"], ["PROJECT_NAME", "any value"]]) {
    assert.strictEqual(validateAskValue(...ok), "", ok.join("="));
  }
  for (const bad of [["DEPLOY_PORT", 'key"#: x'], ["SSH_PORT", "0"], ["BLUE_PORT", "70000"], ["SSH_AUTH_METHOD", "pw"], ["JAVA_VERSION", "latest"]]) {
    assert.notStrictEqual(validateAskValue(...bad), "", bad.join("="));
  }
});

test("promptEnvPlan: rejects a malformed value and asks again", async () => {
  const answers = { DEPLOY_PORT: ['key"#: x', "9090"], SSH_AUTH_METHOD: ["pw", " key "] };
  const io = {
    select: async () => "some",
    multiselect: async () => ["DEPLOY_PORT", "SSH_AUTH_METHOD"],
    text: async () => answers[current].shift(),
    confirm: async ({ initialValue }) => initialValue,
  };
  let current = "";
  const logs = [];
  const result = await promptEnvPlan({
    payloadRoot: resolvePayloadRoot(), types: ["spring"], io, force: false, deployStyle: "simple",
    // Find the key being asked from the field card title printed right before input.
    log: (l = "") => {
      logs.push(l);
      if (/▸ \(\d+\/\d+\) 외부 노출 포트/.test(l)) current = "DEPLOY_PORT";
      if (/▸ \(\d+\/\d+\) SSH 인증 방식/.test(l)) current = "SSH_AUTH_METHOD";
    },
  });
  assert.strictEqual(result.values.get("DEPLOY_PORT"), "9090");
  assert.strictEqual(result.values.get("SSH_AUTH_METHOD"), "key");
  assert.ok(logs.some((l) => l.includes("1~65535")));
});
