// tests/node/prompts-branch-strategy.test.js
// 이슈 #93 — 브랜치 전략을 먼저 명시적으로 선택하게 하는 프롬프트.
import { test } from "node:test";
import assert from "node:assert";
import { selectBranchStrategy } from "../../src/ui/prompts.js";

test("selectBranchStrategy: 비-TTY 환경(테스트 러너)에서는 첫 옵션인 pr-flow를 기본값으로 반환한다", async () => {
  // node --test 실행 환경은 stdin이 TTY가 아니므로 readline-engine.select()가
  // 옵션 배열의 첫 항목을 즉시 반환한다 — 옵션 순서가 곧 "질문 없이 넘어갈 때의 기본 전략"이다.
  // 기존 동작(두 질문에 각각 다른 기본값 main/develop → pr-flow)과 하위호환되려면
  // pr-flow가 반드시 첫 번째 옵션이어야 한다.
  const result = await selectBranchStrategy();
  assert.strictEqual(result, "pr-flow");
});
