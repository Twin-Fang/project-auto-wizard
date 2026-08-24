// tests/node/env-plan.test.js
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
  const secretDir = join(commonDir, "secret-backup");
  mkdirSync(secretDir, { recursive: true });
  writeFileSync(
    join(secretDir, "PROJECT-COMMON-SECRET.yaml"),
    ["name: SECRET", "env:", '  SECRET_ONLY: "x" # @wizard ask:x', ""].join("\n"),
  );
  return root;
}

test("collectAsks: common/ 최상위는 types가 비어 있어도 무조건 스캔된다", () => {
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

test("collectAsks: common/secret-backup/은 includeSecretBackup=false면 여전히 제외된다", () => {
  const root = makeFixturePayload();
  try {
    const asks = collectAsks(root, [], { includeSecretBackup: false });
    assert.ok(!asks.keys.includes("SECRET_ONLY"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("collectAsks: common/secret-backup/은 includeSecretBackup=true면 포함된다", () => {
  const root = makeFixturePayload();
  try {
    const asks = collectAsks(root, [], { includeSecretBackup: true });
    assert.ok(asks.keys.includes("SECRET_ONLY"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("collectAsks: 실제 payload의 secret-backup 전용 키(SERVER_BASE_PATH)는 기본적으로 제외된다 (회귀)", () => {
  const asks = collectAsks(resolvePayloadRoot(), [], { includeSecretBackup: false });
  assert.ok(!asks.keys.includes("SERVER_BASE_PATH"));
});

test("promptEnvPlan: 기본값이 true/false인 ask 필드는 io.text 대신 io.confirm을 사용한다", async () => {
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
    assert.strictEqual(result.values.get("FOO_FLAG"), "true"); // confirm()이 true 응답 → "true" 문자열로 변환
    assert.strictEqual(result.values.get("FOO_NAME"), "bar");  // boolean이 아닌 필드는 그대로 text() 경로
    assert.strictEqual(confirmedInitialValues.length, 1);
    assert.strictEqual(confirmedInitialValues[0], false); // FOO_FLAG 기본값 "false" → initialValue=false
    assert.strictEqual(textedDefaults.length, 1);
    assert.strictEqual(textedDefaults[0], "bar");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("promptEnvPlan: confirm에서 CANCEL을 반환하면 boolean 필드는 기본값을 유지한다", async () => {
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

test("collectAsks: 실제 payload의 ISSUE_HELPER_CREATE_BRANCH가 common 스캔으로 노출된다 (통합)", () => {
  const asks = collectAsks(resolvePayloadRoot(), []);
  assert.ok(asks.keys.includes("ISSUE_HELPER_CREATE_BRANCH"));
  assert.strictEqual(asks.defaults.get("ISSUE_HELPER_CREATE_BRANCH"), "false");
});

test("promptEnvPlan: 실제 payload에서 ISSUE_HELPER_CREATE_BRANCH를 예/아니오 토글로 물어본다 (통합)", async () => {
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

test("collectAsks: __PROJECT_NAME__ 리터럴이 박힌 ask 기본값이 실제 repoName으로 치환된다 (issue #110)", () => {
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
    const asks = collectAsks(root, [], { resolvers: { repo: () => "claude-window-keeper" } });
    assert.strictEqual(asks.defaults.get("VOLUME_CONTAINER_PATH"), "/mnt/claude-window-keeper");
    assert.strictEqual(asks.typeDefaults.get("common|VOLUME_CONTAINER_PATH"), "/mnt/claude-window-keeper");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
