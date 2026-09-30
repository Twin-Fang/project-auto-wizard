// tests/node/ci-gate-payload.test.js
// The CI workflow always runs, but the first job `changes` decides whether this project's paths changed,
// and the remaining jobs are skipped based on that result (a skipped job counts as Success). Job results are aggregated
// so that only the always-running `ci-gate` needs to be registered as the required check. This file pins that skeleton in the payload.
//
// No YAML parser dependency is added — like payload-yaml.test.js, this uses indentation-based line checks,
// and leaves syntax, expression and action-input errors to actionlint (only when it is on PATH).
import { test, after } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeSrcText } from "../../src/core/copy/workflows.js";
import { substituteEnv } from "../../src/core/wizard-env.js";
import { makeResolvers } from "../../src/core/detect-fs.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WORKFLOWS_DIR = join(REPO_ROOT, "payload", "workflows");
const BRANCHES = { main: "main", develop: "develop" };
const MONOREPO_PATH = "services/api";

// jobs: every existing job id — the targets ci-gate must list in needs. If jobs are added, this list must grow too or the test fails.
const CI_TARGETS = [
  { file: "go/PROJECT-GO-CI.yaml", type: "go", jobs: ["build-check"] },
  { file: "python/PROJECT-PYTHON-CI.yaml", type: "python", jobs: ["build-check"] },
  { file: "react/PROJECT-REACT-CI.yaml", type: "react", jobs: ["build"] },
  { file: "spring/PROJECT-SPRING-CI.yml", type: "spring", jobs: ["build-check"] },
];

const EXPECTED_JOB_IF =
  "${{ github.event_name == 'workflow_dispatch' || needs.changes.outputs.project == 'true' }}";
const EXPECTED_FILTER_LINE =
  "- '${{ env.PROJECT_PATH == '.' && '**' || format('{0}/**', env.PROJECT_PATH) }}'";
// push uses the before commit as the base; new branches (before=0) and PRs get an empty value and rely on the default behavior.
const EXPECTED_BASE_LINE =
  "base: ${{ github.event_name == 'push' && github.event.before != '0000000000000000000000000000000000000000' && github.event.before || '' }}";
const PROJECT_PATH_MARKER_LINE = '  PROJECT_PATH: "."  # @wizard auto:project-path';

// Empty directory for the jdk resolver to read — keeps results independent of whether this repo has a build.gradle.
const EMPTY_ROOT = mkdtempSync(join(tmpdir(), "paw-ci-gate-root-"));
after(() => rmSync(EMPTY_ROOT, { recursive: true, force: true }));

// Reproduces the substitution that actually happens at install time (same arguments as makeSrcText + envOptsFor in copy/workflows.js).
function renderInstalled(file, type, paths = new Map()) {
  const src = makeSrcText(BRANCHES)(join(WORKFLOWS_DIR, file));
  return substituteEnv(src, {
    type,
    repoName: "demo-repo",
    projectPath: paths.get(type) || ".",
    resolvers: makeResolvers(EMPTY_ROOT, "demo-repo", paths),
  });
}

const rawText = (file) => readFileSync(join(WORKFLOWS_DIR, file), "utf8");

// ── Line-based structure helpers ───────────────────────────────────────────────

// From the line after a top-level (indent 0) `key:` up to the next top-level key (comments and blank lines included).
function topLevelBlock(text, key) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(`${key}:`));
  assert.ok(start >= 0, `top-level '${key}:' is missing`);
  const end = lines.findIndex((l, i) => i > start && /^[A-Za-z_]/.test(l));
  return lines.slice(start + 1, end === -1 ? lines.length : end);
}

// jobs block → Map<jobId, that job's lines>. A job id is an `id:` line at indent 2.
function parseJobs(text) {
  const jobs = new Map();
  let current = null;
  for (const line of topLevelBlock(text, "jobs")) {
    const header = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (header) {
      current = [];
      jobs.set(header[1], current);
    } else if (current) {
      current.push(line);
    }
  }
  return jobs;
}

// Value of a direct job key (indent 4). Steps start with `- ` and are indented deeper, so they are not mixed in.
function jobField(jobLines, key) {
  const prefix = `    ${key}:`;
  const line = jobLines.find((l) => l.startsWith(prefix));
  return line === undefined ? undefined : line.slice(prefix.length).trim();
}

// `[a, b, c]` → ["a","b","c"]
const parseFlowList = (value) => value.replace(/^\[|\]$/g, "").split(",").map((s) => s.trim()).filter(Boolean);

// ── Structure checks ───────────────────────────────────────────────────────────

for (const { file, type, jobs } of CI_TARGETS) {
  const text = rawText(file);

  test(`${file}: job set is only changes + existing jobs + ci-gate`, () => {
    assert.deepStrictEqual([...parseJobs(text).keys()].sort(), ["changes", ...jobs, "ci-gate"].sort());
  });

  test(`${file}: existing jobs depend on changes and are skipped when nothing changed (workflow_dispatch always runs)`, () => {
    const parsed = parseJobs(text);
    for (const id of jobs) {
      assert.strictEqual(jobField(parsed.get(id), "needs"), "changes", `${id}: needs`);
      assert.strictEqual(jobField(parsed.get(id), "if"), EXPECTED_JOB_IF, `${id}: if`);
    }
  });

  test(`${file}: changes job detects only changes under PROJECT_PATH via dorny/paths-filter`, () => {
    const changes = parseJobs(text).get("changes");
    const body = changes.join("\n");
    assert.match(body, /uses: dorny\/paths-filter@v4/);
    assert.match(body, /^ {8}if: \$\{\{ github\.event_name != 'workflow_dispatch' \}\}$/m, "the detection step is skipped on workflow_dispatch");
    assert.match(body, /^ {6}contents: read$/m);
    assert.match(body, /^ {6}pull-requests: read$/m);
    assert.match(body, /^ {6}project: \$\{\{ steps\.filter\.outputs\.project \}\}$/m);
    assert.ok(changes.some((l) => l.trim() === EXPECTED_FILTER_LINE), "filter expression differs from the contract");
  });

  test(`${file}: runs on both push and pull_request (CI Gate must be usable as a required check)`, () => {
    const on = topLevelBlock(text, "on").join("\n");
    assert.match(on, /^ {2}push:$/m);
    assert.match(on, /^ {2}pull_request:$/m);
  });

  test(`${file}: push detects changes against the previous commit (before), not the cumulative diff against the default branch`, () => {
    const changes = parseJobs(text).get("changes");
    assert.ok(changes.some((l) => l.trim() === EXPECTED_BASE_LINE), "paths-filter base is not the push range base");
  });

  test(`${file}: ci-gate always runs and aggregates every job via needs`, () => {
    const gate = parseJobs(text).get("ci-gate");
    assert.strictEqual(jobField(gate, "if"), "${{ always() }}");
    assert.deepStrictEqual(parseFlowList(jobField(gate, "needs")).sort(), ["changes", ...jobs].sort());
    const body = gate.join("\n");
    assert.match(body, /RESULTS: \$\{\{ toJSON\(needs\.\*\.result\) \}\}/);
    assert.match(body, /grep -Eq '"\(failure\|cancelled\)"'/);
    assert.match(body, /^ {12}exit 1$/m);
  });

  test(`${file}: PROJECT_PATH is declared in a single top-level env block with the auto:project-path marker`, () => {
    assert.strictEqual((text.match(/^env:/gm) || []).length, 1, "there must be exactly one top-level env:");
    assert.ok(topLevelBlock(text, "env").includes(PROJECT_PATH_MARKER_LINE), "PROJECT_PATH marker line is missing from the env block");
  });

  test(`${file}: with --paths PROJECT_PATH becomes that path, otherwise '.', and the marker disappears`, () => {
    const monorepo = renderInstalled(file, type, new Map([[type, MONOREPO_PATH]]));
    assert.ok(topLevelBlock(monorepo, "env").includes(`  PROJECT_PATH: "${MONOREPO_PATH}"`));
    assert.ok(!monorepo.includes("auto:project-path"));
    assert.ok(monorepo.includes("env.PROJECT_PATH"), "the env reference in the changes filter must stay as is");

    const single = renderInstalled(file, type);
    assert.ok(topLevelBlock(single, "env").includes('  PROJECT_PATH: "."'));
    assert.ok(!single.includes("auto:project-path"));
  });
}

// ── actionlint ────────────────────────────────────────────────────────────────
// The original has the `{{MAIN_BRANCH}}` placeholder and the `@wizard` marker, so checking it as-is is unsuitable;
// check a temporary copy that went through the same substitution as install (renderInstalled).
//
// Baseline (2026-09-21, actionlint 1.7.12): the original CI/publish workflows have 0 syntax, expression or action-input errors,
// and only pre-existing shellcheck findings (SC2086 info, SC2129 style, SC2193 warning) (React 4, Spring CI 35,
// Spring publish 2 kinds x 2 each). Those findings are out of scope here and tolerated; only new ones count as failures:
//   1) findings other than shellcheck fail regardless of location (needs typos, expression errors, unknown action inputs, etc.)
//   2) shellcheck findings fail only inside the newly added jobs (changes, ci-gate)
// Distinguish by location rather than count so the test stays stable when the number of existing findings varies with the shellcheck version.
const ACTIONLINT_AVAILABLE = spawnSync("actionlint", ["-version"], { encoding: "utf8" }).status === 0;
const SKIP_ACTIONLINT = ACTIONLINT_AVAILABLE ? false : "skipped: actionlint is not on PATH";

// Job id → start line (1-based) in the rendered text. Used to decide which job a finding's line belongs to.
function jobStartLines(text) {
  const starts = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const header = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (header) starts.push({ id: header[1], line: i + 1 });
  });
  return starts;
}

function jobOfLine(starts, line) {
  return starts.filter((s) => s.line <= line).at(-1)?.id ?? null;
}

// Runs actionlint on the rendered workflow and returns the list of findings to be treated as newly introduced.
function actionlintNewFindings(renderedText, fileName, newJobIds) {
  const dir = mkdtempSync(join(tmpdir(), "paw-actionlint-"));
  try {
    const target = join(dir, fileName);
    writeFileSync(target, renderedText);
    const result = spawnSync("actionlint", ["-no-color", "-format", "{{json .}}", target], { encoding: "utf8" });
    // 0 = no findings, 1 = findings, anything else means the run itself failed
    assert.ok(result.status === 0 || result.status === 1, `actionlint run failed: ${result.stderr}`);
    const findings = JSON.parse(result.stdout.trim() || "[]") ?? [];
    const starts = jobStartLines(renderedText);
    return findings
      .filter((f) => f.kind !== "shellcheck" || newJobIds.includes(jobOfLine(starts, f.line)))
      .map((f) => `${fileName}:${f.line}:${f.column} [${f.kind}] ${f.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const { file, type } of CI_TARGETS) {
  const fileName = file.split("/").pop();
  for (const [label, paths] of [["single repo", new Map()], ["monorepo", new Map([[type, MONOREPO_PATH]])]]) {
    test(`${file}: the substituted copy passes actionlint (${label}, 0 new findings)`, { skip: SKIP_ACTIONLINT }, () => {
      const findings = actionlintNewFindings(renderInstalled(file, type, paths), fileName, ["changes", "ci-gate"]);
      assert.deepStrictEqual(findings, [], `new actionlint findings:\n  ${findings.join("\n  ")}`);
    });
  }
}

test("actionlint helper catches a needs on a nonexistent job (proof the helper is not a no-op)", { skip: SKIP_ACTIONLINT }, () => {
  const { file, type } = CI_TARGETS[0];
  const broken = renderInstalled(file, type).replace("needs: [changes, build-check]", "needs: [changes, no-such-job]");
  assert.notStrictEqual(broken, renderInstalled(file, type), "could not find the line to substitute");
  assert.ok(actionlintNewFindings(broken, "broken.yaml", ["changes", "ci-gate"]).length > 0);
});
