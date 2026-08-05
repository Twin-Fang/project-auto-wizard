// tests/node/readline-engine-stdin-end.test.js
import { test } from "node:test";
import assert from "node:assert";
import * as engine from "../../src/ui/readline-engine.js";

// keySession()/text()의 raw-mode 진입 조건(stdin.isTTY)을 통과시키기 위해 테스트 동안만
// process.stdin의 isTTY/setRawMode를 오버라이드한다. stdin.on("end"/"keypress", ...) 리스너는
// Promise executor 내부에서 동기적으로 등록되므로, 함수 호출 직후 emit해도 안전하다.
function withFakeTty(fn) {
  const stdin = process.stdin;
  const stdout = process.stdout;
  const originalIsTTY = stdin.isTTY;
  const originalSetRawMode = stdin.setRawMode;
  const originalWrite = stdout.write;
  stdin.isTTY = true;
  stdin.setRawMode = () => stdin;
  stdout.write = () => true; // 렌더링 출력으로 테스트 로그가 지저분해지는 것 방지
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      stdin.isTTY = originalIsTTY;
      stdin.setRawMode = originalSetRawMode;
      stdout.write = originalWrite;
    });
}

// timeout 지정 필수: 수정 전 코드는 "end" 리스너가 없어 Promise가 영원히 pending되므로,
// timeout이 없으면 FAIL이 아니라 node --test 전체가 멈춘다(hang). 수정 후에는 즉시 resolve되어
// 여유 있게 통과한다.
test("text(): stdin이 종료(EOF)되면 CANCEL로 resolve된다", { timeout: 2000 }, async () => {
  await withFakeTty(async () => {
    const p = engine.text({ message: "이름을 입력하세요", defaultValue: "기본값" });
    process.stdin.emit("end");
    const result = await p;
    assert.strictEqual(result, engine.CANCEL);
  });
});

test("select(): stdin이 종료(EOF)되면 CANCEL로 resolve된다", { timeout: 2000 }, async () => {
  await withFakeTty(async () => {
    const p = engine.select({
      message: "선택하세요",
      options: [{ value: "a", label: "A" }, { value: "b", label: "B" }],
    });
    process.stdin.emit("end");
    const result = await p;
    assert.strictEqual(result, engine.CANCEL);
  });
});

test("text(): 정상 완료 후에는 'end' 리스너가 해제되어 리스너가 누적되지 않는다", async () => {
  await withFakeTty(async () => {
    const before = process.stdin.listenerCount("end");
    const p = engine.text({ message: "이름을 입력하세요", defaultValue: "기본값" });
    process.stdin.emit("keypress", "h", { name: "h" });
    process.stdin.emit("keypress", "i", { name: "i" });
    process.stdin.emit("keypress", "", { name: "return" });
    const result = await p;
    assert.strictEqual(result, "hi");
    assert.strictEqual(process.stdin.listenerCount("end"), before);
  });
});

test("text(): Ctrl+D 키 입력은 raw mode에서 stdin 'end'가 아니라 keypress로 들어오지만 CANCEL로 처리된다", async () => {
  await withFakeTty(async () => {
    const p = engine.text({ message: "이름을 입력하세요", defaultValue: "기본값" });
    process.stdin.emit("keypress", "", { name: "d", ctrl: true, sequence: "" });
    const result = await p;
    assert.strictEqual(result, engine.CANCEL);
  });
});

test("select(): Ctrl+D 키 입력은 CANCEL로 처리된다", async () => {
  await withFakeTty(async () => {
    const p = engine.select({
      message: "선택하세요",
      options: [{ value: "a", label: "A" }, { value: "b", label: "B" }],
    });
    process.stdin.emit("keypress", "", { name: "d", ctrl: true, sequence: "" });
    const result = await p;
    assert.strictEqual(result, engine.CANCEL);
  });
});
