// Measures test coverage for the Node engine (src/, bin/) and the shipped Python scripts
// (payload/scripts/), then prints one markdown table with both.
//
// Node uses its built-in coverage, so nothing is added to package.json. Python needs coverage.py
// (see scripts/run-py-tests.mjs --coverage). When GITHUB_STEP_SUMMARY is set (CI), the table is
// also appended to the job summary.
//
// Output: coverage/lcov.info, coverage/py-coverage.json, coverage/summary.md
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUT = "coverage";
const LCOV = `${OUT}/lcov.info`;
const PY_JSON = `${OUT}/py-coverage.json`;

// --test-coverage-include arrived in Node 22.5. Without it the tests themselves are counted.
const MIN_NODE = [22, 5];

// Sums the LF/LH (lines), BRF/BRH (branches) and FNF/FNH (functions) records of an lcov file.
export function lcovTotals(text) {
  const t = { lines: [0, 0], branches: [0, 0], functions: [0, 0] };
  const keys = { LH: ["lines", 0], LF: ["lines", 1], BRH: ["branches", 0], BRF: ["branches", 1], FNH: ["functions", 0], FNF: ["functions", 1] };
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z]+):(\d+)$/.exec(line.trim());
    if (m && keys[m[1]]) {
      const [metric, i] = keys[m[1]];
      t[metric][i] += Number(m[2]);
    }
  }
  return t;
}

// coverage.py's JSON report has no function totals, so functions stay null ("n/a").
export function pyTotals(json) {
  const t = json.totals ?? {};
  return {
    lines: [t.covered_lines ?? 0, t.num_statements ?? 0],
    branches: [t.covered_branches ?? 0, t.num_branches ?? 0],
    functions: null,
  };
}

function pct(pair) {
  if (!pair) return "n/a";
  const [hit, total] = pair;
  return total === 0 ? "n/a" : `${((hit / total) * 100).toFixed(2)}%`;
}

export function summaryTable(rows) {
  const out = ["| Target | Lines | Branches | Functions |", "| --- | --- | --- | --- |"];
  for (const { name, totals } of rows) {
    out.push(totals
      ? `| ${name} | ${pct(totals.lines)} | ${pct(totals.branches)} | ${pct(totals.functions)} |`
      : `| ${name} | not measured | not measured | not measured |`);
  }
  return out.join("\n") + "\n";
}

function main() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) {
    console.error(`Coverage needs Node ${MIN_NODE.join(".")}+ (running ${process.versions.node}). npm test still works on Node 20.`);
    process.exit(1);
  }
  // The lcov reporter does not create its destination directory.
  mkdirSync(OUT, { recursive: true });
  // A report left by an earlier run would be shown as this run's number if a step fails now.
  for (const f of [LCOV, PY_JSON]) rmSync(f, { force: true });

  // Same flags as test:node, plus coverage. Two reporters: readable progress on stdout and lcov to a file.
  const node = spawnSync(process.execPath, [
    "--test", "--test-concurrency=1", "--import", "./tests/setup-lang.mjs",
    "--experimental-test-coverage",
    "--test-coverage-include=src/**", "--test-coverage-include=bin/**",
    "--test-reporter=spec", "--test-reporter-destination=stdout",
    "--test-reporter=lcov", `--test-reporter-destination=${LCOV}`,
  ], { stdio: "inherit" });

  const py = spawnSync(process.execPath, ["scripts/run-py-tests.mjs", "--coverage"], { stdio: "inherit" });

  const table = summaryTable([
    { name: "Node (`src/`, `bin/`)", totals: existsSync(LCOV) ? lcovTotals(readFileSync(LCOV, "utf8")) : null },
    { name: "Python (`payload/scripts/`)", totals: existsSync(PY_JSON) ? pyTotals(JSON.parse(readFileSync(PY_JSON, "utf8"))) : null },
  ]);
  const report = `## Test coverage\n\n${table}`;
  writeFileSync(`${OUT}/summary.md`, report);
  console.log(`\n${report}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);

  // Coverage is reported either way, but failing tests must still fail the run.
  process.exit(node.status || py.status ? 1 : 0);
}

// Run only as a script, so tests can import the helpers above.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
