// tests/node/interactive-mode-summary.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
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
