// tests/node/github-script-env.test.js
// Inlining ${{ ... }} into a JS string literal of an actions/github-script step breaks the script as soon as the
// value has a newline or quote (SyntaxError), and lets a branch name or log text inject code. Values must go
// through env and be read with process.env.
import { test } from "node:test";
import assert from "node:assert";
import { readdirSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : (/\.ya?ml$/.test(e.name) ? [p] : []);
  });
}

// Returns the script bodies of the github-script steps of one workflow file: [{ line, body }]
function githubScripts(text) {
  const lines = text.split("\n");
  const out = [];
  lines.forEach((l, i) => {
    const m = /^(\s*)script:\s*\|/.exec(l);
    if (!m) return;
    const indent = m[1].length;
    // Walk back to the start of the step and check that it is a github-script step
    let isGs = false;
    for (let k = i - 1; k >= 0; k--) {
      if (lines[k].includes("actions/github-script")) isGs = true;
      const s = /^(\s*)- (name|uses|id|if):/.exec(lines[k]);
      if (s && s[1].length < indent) break;
    }
    if (!isGs) return;
    const body = [];
    for (let j = i + 1; j < lines.length; j++) {
      const cur = lines[j];
      if (cur.trim() !== "" && cur.length - cur.trimStart().length <= indent) break;
      body.push(cur);
    }
    out.push({ line: i + 1, body: body.join("\n") });
  });
  return out;
}

const SCAN_DIRS = [join(REPO_ROOT, "payload", "workflows"), join(REPO_ROOT, "templates", "workflows")];

test("github-script steps do not inline step/needs/github contexts into JS string literals", () => {
  // A quote or backtick followed (on the same line) by an opening expression of these contexts
  const bad = /['"`][^'"`\n]*\$\{\{\s*(steps|needs|github)\./;
  const hits = [];
  for (const file of SCAN_DIRS.flatMap(walk)) {
    for (const { line, body } of githubScripts(readFileSync(file, "utf8"))) {
      body.split("\n").forEach((l, i) => {
        if (bad.test(l)) hits.push(`${file.slice(REPO_ROOT.length)}:${line + 1 + i}: ${l.trim()}`);
      });
    }
  }
  assert.deepStrictEqual(hits, [], `pass these through env instead:\n  ${hits.join("\n  ")}`);
});

test("github-script bodies contain no ${{ }} expression at all (numbers included)", () => {
  // A bare numeric `const x = ${{ ... }};` breaks the script with a SyntaxError when the value is empty,
  // so numbers also go through env and are read with parseInt(...) || fallback.
  const hits = [];
  for (const file of SCAN_DIRS.flatMap(walk)) {
    for (const { line, body } of githubScripts(readFileSync(file, "utf8"))) {
      body.split("\n").forEach((l, i) => {
        if (l.includes("${{")) hits.push(`${file.slice(REPO_ROOT.length)}:${line + 1 + i}: ${l.trim()}`);
      });
    }
  }
  assert.deepStrictEqual(hits, [], `pass these through env instead:\n  ${hits.join("\n  ")}`);
});

// Branch names, dispatch payload fields and issue titles are free text: inside a run script they must come from a step env variable.
const UNSAFE_IN_RUN = /\$\{\{\s*(github\.head_ref|github\.ref_name|github\.event\.pull_request\.head\.ref|github\.event\.client_payload\.|needs\.[\w-]+\.outputs\.(?:branch_name|custom_branch|issue_title)|steps\.\w+\.outputs\.(?:branch_name|branchName|issue_title))/;

// Scans the `run:` bodies (block and one-line form) of every workflow file and returns the offending lines
function inlinedInRun(text, file) {
  const hits = [];
  const lines = text.split("\n");
  let runIndent = -1;
  lines.forEach((l, i) => {
    const m = /^(\s*)(?:- )?run:\s*(.*)$/.exec(l);
    if (m) {
      runIndent = m[1].length;
      if (m[2] && !/^[|>]/.test(m[2]) && UNSAFE_IN_RUN.test(m[2])) hits.push(`${file}:${i + 1}: ${l.trim()}`);
      return;
    }
    if (runIndent >= 0 && l.trim() !== "" && l.length - l.trimStart().length <= runIndent) runIndent = -1;
    if (runIndent >= 0 && !l.trim().startsWith("#") && UNSAFE_IN_RUN.test(l)) hits.push(`${file}:${i + 1}: ${l.trim()}`);
  });
  return hits;
}

test("shell run steps do not inline branch names, dispatch payload fields or issue titles", () => {
  const hits = [];
  const dirs = [...SCAN_DIRS, join(REPO_ROOT, ".github", "workflows")];
  for (const file of dirs.flatMap(walk)) hits.push(...inlinedInRun(readFileSync(file, "utf8"), file.slice(REPO_ROOT.length)));
  assert.deepStrictEqual(hits, [], `pass these through a step env variable instead:\n  ${hits.join("\n  ")}`);
});

test("the run-step scan flags block and one-line forms of the newly covered expressions", () => {
  const sample = [
    "      - name: a",
    "        run: |",
    '          echo "ref=${{ needs.get-branch-from-issue.outputs.branch_name }}"',
    "      - name: b",
    '        run: git pull origin ${{ github.event.client_payload.branch_name }}',
    "      - name: c",
    "        env:",
    "          PAW_BRANCH_NAME: ${{ github.event.client_payload.branch_name }}",
    "        run: |",
    '          echo "$PAW_BRANCH_NAME"',
  ].join("\n");
  assert.equal(inlinedInRun(sample, "x").length, 2);
});

test("github-script bodies with their remaining expressions stubbed out are valid JavaScript", () => {
  const broken = [];
  // Templates have whole-line placeholders, so only the generated payload is syntax-checked
  for (const file of walk(SCAN_DIRS[0])) {
    for (const { line, body } of githubScripts(readFileSync(file, "utf8"))) {
      const stubbed = body.replace(/\$\{\{[\s\S]*?\}\}/g, "0");
      const r = spawnSync(process.execPath, ["--input-type=commonjs", "-e", `new (Object.getPrototypeOf(async function(){}).constructor)("github","context","core", process.argv[1])`, stubbed], { encoding: "utf8" });
      if (r.status !== 0) broken.push(`${file.slice(REPO_ROOT.length)}:${line}: ${r.stderr.split("\n").find((x) => /Error/.test(x))}`);
    }
  }
  assert.deepStrictEqual(broken, []);
});

test("Spring CI failure comment is built from multi-line error output containing quotes, backticks and $", async () => {
  const file = join(REPO_ROOT, "payload", "workflows", "spring", "PROJECT-SPRING-CI.yml");
  const text = readFileSync(file, "utf8");
  const step = githubScripts(text).find(({ body }) => body.includes("comment_failure"));
  assert.ok(step, "failure comment step not found");

  const messages = spawnSync("python3", [join(REPO_ROOT, "payload", "scripts", "messages.py"), "dump", "wf_spring_ci."], {
    encoding: "utf8",
    env: { ...process.env, PAW_LANG: "en" },
  });
  assert.strictEqual(messages.status, 0, messages.stderr);

  const hostile = "line1 'quoted'\nline2 `tick` ${not_a_template} $HOME \\n \"dq\"";
  // The catalog is read from a file under RUNNER_TEMP (not an env variable, which would be echoed in every step log)
  const tempDir = mkdtempSync(join(tmpdir(), "paw-gs-"));
  writeFileSync(join(tempDir, "paw-msg.json"), messages.stdout.trim());
  const env = {
    RUNNER_TEMP: tempDir,
    PAW_IN_STEPS_ERRORS_OUTPUTS_COMPILE_ERRORS: hostile,
    PAW_IN_STEPS_ERRORS_OUTPUTS_TEST_ERRORS: "",
    PAW_IN_STEPS_ERRORS_OUTPUTS_BUILD_ERRORS: "build 'failed'\nnext",
    PAW_IN_STEPS_REPORT_OUTPUTS_COMPILE_STATUS: "failed",
    PAW_IN_STEPS_REPORT_OUTPUTS_TEST_STATUS: "skipped",
    PAW_IN_STEPS_REPORT_OUTPUTS_BUILD_STATUS: "skipped",
    PAW_IN_STEPS_REPORT_OUTPUTS_OVERALL_STATUS: "failed",
  };
  // The env names the script reads must be wired up in the step's env block
  for (const name of Object.keys(env).filter((k) => k.startsWith("PAW_IN_"))) {
    assert.ok(text.includes(`${name}: \${{`), `${name} is not passed in the step env`);
  }

  let posted;
  const github = {
    rest: {
      issues: {
        listComments: async () => ({ data: [] }),
        createComment: async (a) => { posted = a.body; },
        updateComment: async (a) => { posted = a.body; },
      },
    },
  };
  const context = { repo: { owner: "o", repo: "r" }, issue: { number: 1 } };
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    // github-script provides `require` to the script body
    await new AsyncFunction("github", "context", "require", step.body)(github, context, createRequire(import.meta.url));
  } finally {
    for (const k of Object.keys(env)) k in saved ? (process.env[k] = saved[k]) : delete process.env[k];
    rmSync(tempDir, { recursive: true, force: true });
  }
  assert.ok(posted.includes(hostile), "compile errors are posted verbatim");
  assert.ok(posted.includes("build 'failed'\nnext"), "build errors are posted verbatim");
});
