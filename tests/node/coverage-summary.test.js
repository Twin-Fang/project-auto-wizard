// tests/node/coverage-summary.test.js
// The coverage table in the CI job summary is built from lcov and coverage.py JSON by hand.
// Pins the totals math so a parsing slip does not publish a wrong number.
import { test } from "node:test";
import assert from "node:assert";
import { lcovTotals, pyTotals, summaryTable } from "../../scripts/run-coverage.mjs";

test("lcovTotals sums every file's line, branch and function records", () => {
  const lcov = [
    "SF:src/a.js", "FNF:2", "FNH:1", "BRF:4", "BRH:3", "LF:10", "LH:9", "end_of_record",
    "SF:src/b.js", "FNF:1", "FNH:1", "BRF:0", "BRH:0", "LF:5", "LH:5", "end_of_record",
  ].join("\r\n");
  assert.deepStrictEqual(lcovTotals(lcov), { lines: [14, 15], branches: [3, 4], functions: [2, 3] });
});

test("lcovTotals ignores per-line records such as DA and BRDA", () => {
  assert.deepStrictEqual(lcovTotals("DA:1,1\nBRDA:1,0,0,1\nLF:1\nLH:1"), { lines: [1, 1], branches: [0, 0], functions: [0, 0] });
});

test("pyTotals reads coverage.py totals and has no function figure", () => {
  const json = { totals: { covered_lines: 9, num_statements: 10, covered_branches: 1, num_branches: 2 } };
  assert.deepStrictEqual(pyTotals(json), { lines: [9, 10], branches: [1, 2], functions: null });
});

test("summaryTable prints percentages, n/a for empty or missing metrics, and a not-measured row", () => {
  const table = summaryTable([
    { name: "Node", totals: { lines: [1, 3], branches: [0, 0], functions: null } },
    { name: "Python", totals: null },
  ]);
  assert.match(table, /\| Node \| 33\.33% \| n\/a \| n\/a \|/);
  assert.match(table, /\| Python \| not measured \| not measured \| not measured \|/);
});
