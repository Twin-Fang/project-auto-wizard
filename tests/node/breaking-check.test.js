// Task 7 — breaking-check.js 테스트 커버리지 공백 보강.
// runBreakingCheck(loader 주입)으로 실제 collectBreaking(breaking.js) 조합 동작을 검증한다.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runBreakingCheck } from "../../src/core/breaking-check.js";

function makeRepo(templateVersion) {
  const dir = mkdtempSync(join(tmpdir(), "paw-bc-"));
  writeFileSync(
    join(dir, "version.yml"),
    `version: "1.0.0"\nmetadata:\n  template:\n    version: "${templateVersion}"\n`,
  );
  return dir;
}

test("no version.yml -> proceeds without loading breaking json", async () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-bc-empty-"));
  try {
    let loaderCalled = false;
    const proceed = await runBreakingCheck({
      cwd: dir, payloadRoot: "unused", templateVersion: "0.2.0",
      loader: async () => { loaderCalled = true; return {}; },
    });
    assert.strictEqual(proceed, true);
    assert.strictEqual(loaderCalled, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loader returns null -> proceeds (network/bundle both failed)", async () => {
  const dir = makeRepo("0.1.0");
  try {
    const proceed = await runBreakingCheck({
      cwd: dir, payloadRoot: "unused", templateVersion: "0.2.0",
      loader: async () => null,
    });
    assert.strictEqual(proceed, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no critical/warning entries for the version range -> proceeds silently", async () => {
  const dir = makeRepo("0.1.0");
  try {
    const proceed = await runBreakingCheck({
      cwd: dir, payloadRoot: "unused", templateVersion: "0.2.0",
      loader: async () => ({}),
    });
    assert.strictEqual(proceed, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("critical entry + non-interactive (askYesNo omitted) -> warns and proceeds", async () => {
  const dir = makeRepo("0.1.0");
  try {
    const json = {
      "0.2.0": { severity: "critical", title: "워크플로우 파일명 변경", message: "PROJECT-COMMON-X.yaml -> Y.yaml" },
    };
    const proceed = await runBreakingCheck({
      cwd: dir, payloadRoot: "unused", templateVersion: "0.2.0",
      loader: async () => json,
    });
    assert.strictEqual(proceed, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("critical entry + interactive confirm=false -> cancels", async () => {
  const dir = makeRepo("0.1.0");
  try {
    const json = {
      "0.2.0": { severity: "critical", title: "t", message: "m" },
    };
    const proceed = await runBreakingCheck({
      cwd: dir, payloadRoot: "unused", templateVersion: "0.2.0",
      loader: async () => json,
      askYesNo: async () => false,
    });
    assert.strictEqual(proceed, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("critical entry + interactive confirm=true -> proceeds", async () => {
  const dir = makeRepo("0.1.0");
  try {
    const json = {
      "0.2.0": { severity: "critical", title: "t", message: "m" },
    };
    const proceed = await runBreakingCheck({
      cwd: dir, payloadRoot: "unused", templateVersion: "0.2.0",
      loader: async () => json,
      askYesNo: async () => true,
    });
    assert.strictEqual(proceed, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
