// tests/node/confirm-types.test.js
// 타입 확정 단계 (이슈 #78) — 감지는 추정이므로 다른 질문보다 먼저 확인받아야 한다.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInteractive } from "../../src/commands/interactive.js";

function stubIo({ confirmTypes = ({ types }) => types } = {}) {
  const calls = { confirmTypes: [], summary: [] };
  const io = {
    selectMode: async () => "full",
    confirmProjectMenu: async () => "continue",
    askYesNo: async (_m, def) => def,
    askText: async (_m, def) => def,
    selectDeployStyle: async () => "simple",
    confirmTypes: async (arg) => { calls.confirmTypes.push(arg); return confirmTypes(arg); },
    note: () => {},
    cancelMessage: () => {},
    summary: (ctx) => calls.summary.push(ctx),
    outro: () => {},
  };
  return { io, calls };
}

function springFixture() {
  const target = mkdtempSync(join(tmpdir(), "paw-confirm-types-"));
  writeFileSync(join(target, "build.gradle.kts"), 'version = "1.0.0"\n');
  return target;
}

test("타입 확정 질문에 감지 결과와 그 근거 파일이 함께 전달된다", async () => {
  const target = springFixture();
  try {
    const { io, calls } = stubIo({ confirmTypes: ({ types }) => types });
    assert.strictEqual(await runInteractive({}, { cwd: target, io }), 0);

    assert.strictEqual(calls.confirmTypes.length, 1, "신규 설치에서 정확히 한 번 물어야 한다");
    const { types, markers } = calls.confirmTypes[0];
    assert.deepStrictEqual(types, ["spring"]);
    assert.strictEqual(markers.get("spring"), "build.gradle.kts",
      "근거가 보여야 사용자가 맞는지 틀린지 판단할 수 있다");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

// 과잉 감지 걷어내기 — 스크립트용 requirements.txt 하나 때문에 python이 딸려 들어오는 식.
// 종전에는 이걸 걷어낼 자리가 '수정하기' 두 단계 뒤에 숨어 있었다.
test("사용자가 감지된 타입을 걷어내면 그 값이 설치에 반영된다", async () => {
  const target = springFixture();
  try {
    writeFileSync(join(target, "requirements.txt"), "requests\n");
    const { io, calls } = stubIo({ confirmTypes: () => ["spring"] });
    assert.strictEqual(await runInteractive({}, { cwd: target, io }), 0);

    assert.deepStrictEqual(calls.confirmTypes[0].types, ["spring", "python"], "감지는 둘 다 잡는다");
    assert.deepStrictEqual(calls.summary[0].types, ["spring"], "확정한 타입만 설치되어야 한다");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("취소(ESC)나 빈 선택이면 감지 결과를 그대로 유지한다", async () => {
  const target = springFixture();
  try {
    const { io, calls } = stubIo({ confirmTypes: () => [] });
    assert.strictEqual(await runInteractive({}, { cwd: target, io }), 0);
    assert.deepStrictEqual(calls.summary[0].types, ["spring"], "빈 선택으로 타입이 사라지면 안 된다");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("version.yml에 타입이 이미 있는 업데이트 설치에서는 다시 묻지 않는다", async () => {
  const target = springFixture();
  try {
    writeFileSync(join(target, "version.yml"),
      'version: "1.0.0"\nversion_code: 1\nproject_types: ["spring"]\n');
    const { io, calls } = stubIo({ confirmTypes: ({ types }) => types });
    assert.strictEqual(await runInteractive({}, { cwd: target, io }), 0);
    assert.strictEqual(calls.confirmTypes.length, 0,
      "project_types가 단일 진실이므로 재질문은 불필요하다");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("감지 결과가 맞으면 그대로 확정된다 (Enter 한 번)", async () => {
  const target = springFixture();
  try {
    const { io, calls } = stubIo();
    assert.strictEqual(await runInteractive({}, { cwd: target, io }), 0);
    assert.deepStrictEqual(calls.summary[0].types, ["spring"]);
  } finally { rmSync(target, { recursive: true, force: true }); }
});
