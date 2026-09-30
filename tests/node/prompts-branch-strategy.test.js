// tests/node/prompts-branch-strategy.test.js
// Prompt that makes the user explicitly choose the branch strategy first.
import { test } from "node:test";
import assert from "node:assert";
import { selectBranchStrategy } from "../../src/ui/prompts.js";

test("selectBranchStrategy: in a non-TTY environment (test runner) returns the first option, pr-flow, as the default", async () => {
  // The node --test environment has a non-TTY stdin, so readline-engine.select()
  // returns the first option immediately: the option order is the "default strategy when no question is asked".
  // To stay backward compatible with the old behavior (two questions with separate defaults main/develop, i.e. pr-flow),
  // pr-flow must be the first option.
  const result = await selectBranchStrategy();
  assert.strictEqual(result, "pr-flow");
});
