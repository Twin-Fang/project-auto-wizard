// tests/node/interactive-mode-summary.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInteractive } from "../../src/commands/interactive.js";

function stubIo() {
  const summaryCalls = [];
  return {
    io: {
      selectMode: async () => "workflows",
      confirmProjectMenu: async () => "continue",
      askYesNo: async (_message, def) => def,
      askText: async (_message, def) => def,
      note: () => {},
      cancelMessage: () => {},
      summary: (ctx) => summaryCalls.push(ctx),
      outro: () => {},
    },
    summaryCalls,
  };
}

test("runInteractive: workflows 모드 완료 시 io.summary가 copiedFiles(새 시그니처)로 호출된다 — counters가 아니다", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-interactive-summary-"));
  try {
    const { io, summaryCalls } = stubIo();
    const code = await runInteractive({}, { cwd: target, io });
    assert.strictEqual(code, 0);
    assert.strictEqual(summaryCalls.length, 1, "io.summary가 정확히 한 번 호출되어야 합니다");
    const ctx = summaryCalls[0];
    assert.ok(Array.isArray(ctx.copiedFiles), "ctx.copiedFiles는 배열이어야 합니다(새 시그니처)");
    assert.ok(ctx.copiedFiles.length > 0, "신규 설치이므로 최소 common 워크플로우가 복사되어야 합니다");
    assert.strictEqual(ctx.counters, undefined, "옛 counters 필드가 남아있으면 안 됩니다");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// 이슈 #41 회귀 방지 — 대화형 마법사 경로에서도 감지된 빌드 번호가 ctx.versionCode에 반영돼야 한다.
test("runInteractive: pubspec.yaml의 빌드 번호가 편집 없이도 ctx.versionCode에 반영된다", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-interactive-buildnumber-"));
  try {
    writeFileSync(join(target, "pubspec.yaml"), "name: sample_app\nversion: 1.2.39+71\n");
    const { io, summaryCalls } = stubIo();
    const code = await runInteractive({}, { cwd: target, io });
    assert.strictEqual(code, 0);
    assert.strictEqual(summaryCalls.length, 1, "io.summary가 정확히 한 번 호출되어야 합니다");
    const ctx = summaryCalls[0];
    assert.strictEqual(ctx.versionCode, 71, "pubspec.yaml의 +71이 versionCode로 감지되어야 합니다");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// 이슈 #41 파이널 리뷰 Finding 1 회귀 방지 — 마법사 편집 루프에서 프로젝트 타입을 뒤늦게
// flutter로 바꾼 경우에도, 빌드 번호 감지가 (수정 전 stale이 아닌) 최종 확정된 types를 써야 한다.
// 편집 루프 종료 전에 감지가 실행되면 여기서 versionCode가 42가 아닌 1로 떨어진다.
test("runInteractive: 편집 루프에서 type을 flutter로 바꾸면 확정된 types로 빌드 번호를 감지한다", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-interactive-buildnumber-edit-"));
  try {
    // 초기 감지 시점에는 pubspec.yaml이 없어 detectTypes가 flutter를 놓친다 (package.json → "node").
    writeFileSync(join(target, "package.json"), JSON.stringify({ name: "sample-app", version: "1.0.0" }));

    let confirmCalls = 0;
    let editCalls = 0;
    const { io, summaryCalls } = stubIo();
    io.confirmProjectMenu = async () => {
      confirmCalls += 1;
      return confirmCalls === 1 ? "edit" : "continue";
    };
    io.editMenu = async () => {
      editCalls += 1;
      return editCalls === 1 ? "type" : "done";
    };
    io.selectTypes = async () => {
      // 사용자가 편집 메뉴에서 flutter를 추가로 선택하는 시점에 pubspec.yaml이 준비된다
      // (신규 통합 대상 프로젝트에 flutter가 뒤늦게 반영되는 상황을 재현).
      writeFileSync(join(target, "pubspec.yaml"), "name: sample_app\nversion: 1.0.0+42\n");
      return ["flutter"];
    };

    const code = await runInteractive({}, { cwd: target, io });
    assert.strictEqual(code, 0);
    assert.strictEqual(summaryCalls.length, 1, "io.summary가 정확히 한 번 호출되어야 합니다");
    const ctx = summaryCalls[0];
    assert.deepStrictEqual(ctx.types, ["flutter"], "편집 루프에서 확정한 types가 최종 반영되어야 합니다");
    assert.strictEqual(ctx.versionCode, 42, "편집 후 확정된 types로 pubspec.yaml의 +42가 감지되어야 합니다");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
