// tests/node/interactive-abort.test.js
// 대화형 실행 중 Ctrl+C는 어느 질문에서든 설치 없이 즉시 끝나야 한다(종료코드 130).
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../src/index.js";

function withFakeTty(fn) {
  const { stdin, stdout, stderr } = process;
  const saved = {
    inTTY: stdin.isTTY, outTTY: stdout.isTTY, setRawMode: stdin.setRawMode,
    outWrite: stdout.write, errWrite: stderr.write,
  };
  stdin.isTTY = true;
  stdout.isTTY = true;
  stdin.setRawMode = () => stdin;
  // 화면 출력(문자열)만 삼킨다 — 테스트 러너가 자식 프로세스 stdout으로 보내는 결과(Buffer)는 통과시킨다.
  stdout.write = (chunk, ...rest) => (typeof chunk === "string" ? true : saved.outWrite.call(stdout, chunk, ...rest));
  stderr.write = () => true;
  return Promise.resolve().then(fn).finally(() => {
    stdin.isTTY = saved.inTTY;
    stdout.isTTY = saved.outTTY;
    stdin.setRawMode = saved.setRawMode;
    stdout.write = saved.outWrite;
    stderr.write = saved.errWrite;
  });
}

const ctrlC = () => process.stdin.emit("keypress", "\x03", { name: "c", ctrl: true, sequence: "\x03" });
const enter = () => process.stdin.emit("keypress", "\r", { name: "return", sequence: "\r" });
const tick = () => new Promise((r) => setImmediate(r));

test("대화형: 첫 메뉴에서 Ctrl+C → 130으로 종료하고 설치 파일을 만들지 않는다", { timeout: 5000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-abort-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "my-app", version: "1.0.0" }));
    await withFakeTty(async () => {
      const p = run([], { cwd: dir });
      await tick();
      ctrlC();
      assert.strictEqual(await p, 130);
    });
    assert.strictEqual(existsSync(join(dir, "version.yml")), false);
    assert.strictEqual(existsSync(join(dir, ".github", "workflows")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("대화형: 확인 화면 이후 질문에서 Ctrl+C → 기본값으로 진행하지 않고 130으로 종료", { timeout: 5000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-abort-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "my-app", version: "1.0.0" }));
    await withFakeTty(async () => {
      const p = run([], { cwd: dir });
      // 모드 선택 → 타입 확정 → 이후 질문 몇 개를 Enter로 넘긴 뒤 Ctrl+C
      for (let i = 0; i < 4; i++) { await tick(); enter(); }
      await tick();
      ctrlC();
      assert.strictEqual(await p, 130);
    });
    assert.strictEqual(existsSync(join(dir, "version.yml")), false);
    assert.strictEqual(existsSync(join(dir, ".github", "workflows")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
