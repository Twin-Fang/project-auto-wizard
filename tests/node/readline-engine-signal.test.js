// tests/node/readline-engine-signal.test.js
// 입력 대기 중 외부 신호(kill -INT·kill -TERM)로 끝나도 커서를 복구하고 중단 경로(PromptAbortError)로 빠져나오는지 회귀.
import { test } from "node:test";
import assert from "node:assert";
import * as engine from "../../src/ui/readline-engine.js";

// raw-mode 진입 조건(stdin.isTTY)을 통과시키고 출력은 모아서 확인한다.
function withFakeTty(fn) {
  const stdin = process.stdin;
  const stdout = process.stdout;
  const originalIsTTY = stdin.isTTY;
  const originalSetRawMode = stdin.setRawMode;
  const originalWrite = stdout.write;
  const originalTerm = process.env.TERM;
  const out = [];
  stdin.isTTY = true;
  stdin.setRawMode = () => stdin;
  stdout.write = (s) => { out.push(String(s)); return true; };
  process.env.TERM = "xterm-256color";
  return Promise.resolve()
    .then(() => fn(out))
    .finally(() => {
      stdin.isTTY = originalIsTTY;
      stdin.setRawMode = originalSetRawMode;
      stdout.write = originalWrite;
      if (originalTerm === undefined) delete process.env.TERM; else process.env.TERM = originalTerm;
    });
}

const OPTIONS = [{ value: "a", label: "A" }, { value: "b", label: "B" }];

for (const sig of ["SIGINT", "SIGTERM"]) {
  test(`select(): ${sig}를 받으면 커서를 되돌리고 PromptAbortError로 중단한다`, { timeout: 2000 }, async () => {
    await withFakeTty(async (out) => {
      const before = process.listenerCount(sig);
      const p = engine.select({ message: "선택하세요", options: OPTIONS });
      assert.strictEqual(process.listenerCount(sig), before + 1, "입력 대기 중에는 신호를 직접 처리한다");
      process.emit(sig, sig);
      await assert.rejects(p, (e) => e instanceof engine.PromptAbortError && e.signal === sig);
      const joined = out.join("");
      assert.ok(joined.lastIndexOf("\x1b[?25h") > joined.lastIndexOf("\x1b[?25l"), "숨긴 커서를 다시 보이게 한다");
      assert.strictEqual(process.listenerCount(sig), before, "끝나면 신호 리스너를 해제한다");
    });
  });
}

test("text(): SIGINT를 받으면 PromptAbortError로 중단하고 리스너를 남기지 않는다", { timeout: 2000 }, async () => {
  await withFakeTty(async () => {
    const before = process.listenerCount("SIGINT");
    const p = engine.text({ message: "이름을 입력하세요", defaultValue: "my-app" });
    process.emit("SIGINT", "SIGINT");
    await assert.rejects(p, (e) => e instanceof engine.PromptAbortError && e.signal === "SIGINT");
    assert.strictEqual(process.listenerCount("SIGINT"), before);
  });
});

test("select(): 정상 선택 뒤에는 신호 리스너가 남지 않는다", async () => {
  await withFakeTty(async () => {
    const before = process.listenerCount("SIGINT");
    const p = engine.select({ message: "선택하세요", options: OPTIONS });
    process.stdin.emit("keypress", "", { name: "return" });
    assert.strictEqual(await p, "a");
    assert.strictEqual(process.listenerCount("SIGINT"), before);
  });
});
