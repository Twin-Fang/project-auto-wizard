// tests/node/interactive-mode-uninstall.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { runInteractive } from "../../src/commands/interactive.js";

function installFixture() {
  const target = mkdtempSync(join(tmpdir(), "paw-interactive-uninstall-"));
  writeFileSync(join(target, "README.md"), "# Test Project\n");
  const ctx = createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(), includeCodeRabbit: true,
    now: "2026-08-01 00:00:00", today: "2026-08-01", templateVersion: "0.1.0",
  });
  runFull(ctx, resolvePayloadRoot(), target);
  return target;
}

function stubIo({ multiselectReturn, confirmReturn }) {
  const outros = [];
  return {
    io: {
      selectMode: async () => "uninstall",
      engineIo: { multiselect: async () => multiselectReturn },
      askYesNo: async () => confirmReturn,
      note: () => {},
      cancelMessage: () => {},
      outro: (text) => outros.push(text),
    },
    outros,
  };
}

test("runInteractive: selecting 완전 삭제 then confirming removes the checked items", async () => {
  const target = installFixture();
  try {
    const { io, outros } = stubIo({ multiselectReturn: ["workflows", "scripts", "coderabbit"], confirmReturn: true });
    const code = await runInteractive({}, { cwd: target, io });
    assert.strictEqual(code, 0);
    assert.ok(!existsSync(join(target, ".github/scripts/version_manager.py")));
    assert.ok(!existsSync(join(target, ".coderabbit.yaml")));
    assert.ok(existsSync(join(target, "version.yml"))); // readme/gitignore/versionYml 미선택 -> 보존
    assert.ok(outros.some((t) => t.includes("완전 삭제")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("runInteractive: declining the final uninstall confirm leaves everything installed and skips the completion outro", async () => {
  const target = installFixture();
  try {
    const { io, outros } = stubIo({ multiselectReturn: ["workflows"], confirmReturn: false });
    const code = await runInteractive({}, { cwd: target, io });
    assert.strictEqual(code, 0);
    assert.ok(existsSync(join(target, ".github/scripts/version_manager.py")));
    assert.deepStrictEqual(outros, []); // 취소했는데 "완전 삭제를 마쳤습니다"가 출력되면 안 됨
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
