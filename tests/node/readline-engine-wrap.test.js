// tests/node/readline-engine-wrap.test.js
// 터미널 폭을 넘어 접히는 줄도 다시 그릴 때 한 벌만 남아야 한다.
import { test } from "node:test";
import assert from "node:assert";
import * as engine from "../../src/ui/readline-engine.js";
import { printBanner } from "../../src/ui/banner.js";

delete process.env.TERM;

function withFakeTty(columns, fn) {
  const { stdin, stdout } = process;
  const saved = { isTTY: stdin.isTTY, setRawMode: stdin.setRawMode, columns: stdout.columns, write: stdout.write };
  stdin.isTTY = true;
  stdin.setRawMode = () => stdin;
  stdout.columns = columns;
  let output = "";
  stdout.write = (chunk, ...rest) => (typeof chunk === "string" ? ((output += chunk), true) : saved.write.call(stdout, chunk, ...rest));
  return Promise.resolve().then(fn).then(() => output).finally(() => {
    stdin.isTTY = saved.isTTY;
    stdin.setRawMode = saved.setRawMode;
    stdout.columns = saved.columns;
    stdout.write = saved.write;
  });
}

test("physicalRows: 폭을 넘는 줄은 접힌 행 수를 센다 (한글 2칸)", () => {
  assert.strictEqual(engine.physicalRows("a".repeat(80), 80), 1);
  assert.strictEqual(engine.physicalRows("a".repeat(81), 80), 2);
  assert.strictEqual(engine.physicalRows("가".repeat(50), 80), 2);
  assert.strictEqual(engine.physicalRows("", 80), 1);
  assert.strictEqual(engine.physicalRows("abc", undefined), 1);
});

test("select(): 다시 그릴 때 접힌 행까지 포함해 위로 올라간다", async () => {
  const long = "x".repeat(90); // 40열에서 3행으로 접힌다
  const out = await withFakeTty(40, async () => {
    const p = engine.select({ message: "m", options: [{ value: "a", label: long }, { value: "b", label: "B" }] });
    process.stdin.emit("keypress", undefined, { name: "down" });
    process.stdin.emit("keypress", "\r", { name: "return" });
    await p;
  });
  const ups = [...out.matchAll(/\x1b\[(\d+)A/g)].map((m) => Number(m[1]));
  // 첫 화면: 빈 막대, 질문, 긴 옵션(3행), B, 안내(접힘 여부는 폭에 따름) — 논리 줄 수(5)보다 많아야 한다
  assert.ok(ups.length >= 1);
  assert.ok(ups[0] > 5, `접힌 행을 세지 않았다: ${ups[0]}`);
});

test("text(): 긴 프롬프트를 다시 그릴 때 접힌 첫 행까지 올라가 지운다", async () => {
  const out = await withFakeTty(40, async () => {
    const p = engine.text({ message: "y".repeat(60), defaultValue: "" });
    process.stdin.emit("keypress", "a", { name: "a" });
    process.stdin.emit("keypress", "\r", { name: "return" });
    await p;
  });
  assert.match(out, /\r\x1b\[1A\x1b\[0J/);
});

test("printBanner: 상자보다 좁은 터미널에서는 상자 테두리를 그리지 않는다", () => {
  let narrow = "";
  printBanner({ version: "1.0.0", modeLabel: "m" }, (s) => { narrow += s; }, 40);
  assert.ok(!narrow.includes("╔"));
  let wide = "";
  printBanner({ version: "1.0.0", modeLabel: "m" }, (s) => { wide += s; }, 120);
  assert.ok(wide.includes("╔"));
});
