// tests/node/summary-accuracy-cli.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "../../src/index.js";

function captureStderr(fn) {
  const original = process.stderr.write.bind(process.stderr);
  let output = "";
  process.stderr.write = (chunk) => { output += chunk; return true; };
  return Promise.resolve(fn()).finally(() => { process.stderr.write = original; }).then(() => output);
}

test("run(): full 모드 완료 요약의 '새로 설치됨' 목록이 실제 생성된 워크플로우 파일과 정확히 일치한다", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-summary-accuracy-"));
  writeFileSync(join(target, "build.gradle"), ""); // M4: 경로 후보 0개 방지용 루트 마커 (spring)
  try {
    let code;
    const output = await captureStderr(async () => {
      code = await run(["--mode", "full", "--force", "--type", "spring"], { cwd: target });
    });
    assert.strictEqual(code, 0);
    const wfDir = join(target, ".github", "workflows");
    const actualFiles = readdirSync(wfDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    assert.ok(actualFiles.length > 0, "테스트 전제가 깨졌습니다 — 워크플로우가 하나도 안 만들어짐");
    for (const f of actualFiles) {
      assert.ok(output.includes(f), `실제로 생성된 ${f}가 완료 요약에 없습니다`);
    }
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): 동일 옵션으로 재실행하면(전부 unchanged) '새로 설치됨' 목록이 아예 뜨지 않는다", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-summary-rerun-"));
  writeFileSync(join(target, "build.gradle"), ""); // M4: 경로 후보 0개 방지용 루트 마커 (spring)
  try {
    await run(["--mode", "full", "--force", "--type", "spring"], { cwd: target }); // 최초 설치
    const output = await captureStderr(async () => {
      const code = await run(["--mode", "full", "--force", "--type", "spring"], { cwd: target }); // 재실행
      assert.strictEqual(code, 0);
    });
    assert.ok(!output.includes("📦 새로 설치됨"), "재실행에서 unchanged 파일들이 '새로 설치됨'으로 표시되면 안 됩니다");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
