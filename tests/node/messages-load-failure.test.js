// tests/node/messages-load-failure.test.js
// When the `Load messages` step fails (messages.py missing), later steps that still run under always()/failure()
// and read PAW_MSG would die with an unrelated JSON parse error that gets mixed into the real cause. Those steps
// must be skipped when the load did not succeed. Also covers the Spring CI report for steps that did not run.
import { test } from "node:test";
import assert from "node:assert";
import { readdirSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.ya?ml$/.test(e.name) ? [p] : [];
  });
const FILES = [...walk(join(ROOT, "payload/workflows")), ...walk(join(ROOT, "templates/workflows")), ...walk(join(ROOT, ".github/workflows"))];

// Steps of one job as text chunks, split at the list items of the steps
function jobs(text) {
  const lines = text.split("\n");
  const from = lines.indexOf("jobs:");
  if (from < 0) return [];
  const heads = [];
  for (let i = from + 1; i < lines.length; i++) if (/^ {2}[\w-]+:\s*$/.test(lines[i])) heads.push(i);
  return heads.map((h, n) => {
    const seg = lines.slice(h, heads[n + 1] ?? lines.length);
    const starts = [];
    seg.forEach((l, i) => {
      if (/^ {4,6}- (name|uses|id|run):/.test(l)) starts.push(i);
    });
    const base = Math.min(...starts.map((i) => seg[i].length - seg[i].trimStart().length));
    const own = starts.filter((i) => seg[i].length - seg[i].trimStart().length === base);
    return {
      job: lines[h].trim(),
      steps: own.map((s, k) => ({ line: from + 1 + h + s + 1 - from, text: seg.slice(s, own[k + 1] ?? seg.length).join("\n") })),
    };
  });
}

const COND = "steps.load_messages.outcome == 'success'";

for (const file of FILES) {
  const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  if (!text.includes("Load messages")) continue;
  test(`${file.slice(ROOT.length)}: always()/failure() steps that read PAW_MSG are skipped when Load messages failed`, () => {
    const bad = [];
    for (const { job, steps } of jobs(text)) {
      const at = steps.findIndex((s) => /^\s*- name: Load messages\s*$/m.test(s.text.split("\n")[0]));
      if (at < 0) continue;
      const hasId = /^\s+id: load_messages$/m.test(steps[at].text);
      for (const s of steps.slice(at + 1)) {
        const cond = /^\s+if: (.*)$/m.exec(s.text)?.[1] ?? "";
        if (/\b(always|failure)\(\)/.test(cond) && /PAW_MSG|PAW_MESSAGES_PY|messages\.py/.test(s.text) && (!cond.includes(COND) || !hasId)) {
          bad.push(`${job}: ${s.text.split("\n")[0].trim()} (if: ${cond.slice(0, 50)})`);
        }
      }
    }
    assert.deepStrictEqual(bad, []);
  });
}

test("Load messages conditions are actually applied (at least the Spring CI, Flutter CI and preview steps)", () => {
  for (const f of ["payload/workflows/spring/PROJECT-SPRING-CI.yml", "payload/workflows/flutter/PROJECT-FLUTTER-CI.yaml", "payload/workflows/go/PROJECT-GO-PR-PREVIEW.yaml"]) {
    assert.ok(readFileSync(join(ROOT, f), "utf8").replace(/\r\n/g, "\n").includes(COND), f);
  }
});

// Spring CI report: run the step's shell with given gradle exit codes
const spring = readFileSync(join(ROOT, "payload/workflows/spring/PROJECT-SPRING-CI.yml"), "utf8").replace(/\r\n/g, "\n");
function reportScript() {
  const s = jobs(spring).flatMap((j) => j.steps).find((st) => /- name: Generate Build Report/.test(st.text));
  const lines = s.text.split("\n");
  const at = lines.findIndex((l) => /^\s+run: \|\s*$/.test(l));
  const body = lines.slice(at + 1);
  const pad = body[0].length - body[0].trimStart().length;
  return body.map((l) => l.slice(Math.min(pad, l.length - l.trimStart().length))).join("\n");
}

function runReport(language, compile, test_, build) {
  const dir = mkdtempSync(join(tmpdir(), "paw-spring-"));
  try {
    mkdirSync(join(dir, ".github/scripts"), { recursive: true });
    copyFileSync(join(ROOT, "payload/scripts/messages.py"), join(dir, ".github/scripts/messages.py"));
    writeFileSync(join(dir, "version.yml"), `language: "${language}"\n`);
    const out = join(dir, "out");
    writeFileSync(out, "");
    const script = reportScript()
      .replace("${{ steps.compile.outputs.compile_exit_code }}", compile)
      .replace("${{ steps.test.outputs.test_exit_code }}", test_)
      .replace("${{ steps.build.outputs.build_exit_code }}", build);
    // Windows defaults python to a legacy code page; messages.py output is UTF-8
    const env = { ...process.env, GITHUB_WORKSPACE: dir, GITHUB_OUTPUT: out, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" };
    delete env.PROJECT_AUTO_WIZARD_LANG;
    const r = spawnSync("bash", ["-e", "-c", script], { cwd: dir, env, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return Object.fromEntries(readFileSync(out, "utf8").trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("Spring CI report: a failed compile marks test and build as not run, not failed", () => {
  const en = runReport("en", "1", "1", "1");
  assert.match(en.compile_status, /Failed/);
  assert.match(en.test_status, /Not run/);
  assert.match(en.build_status, /Not run/);
  assert.equal(en.overall_ok, "false");
  const ko = runReport("ko", "1", "1", "1");
  assert.match(ko.test_status, /실행 안 됨/);
  assert.match(ko.build_status, /실행 안 됨/);
});

test("Spring CI report: real test and build failures stay failures; a clean run is ok", () => {
  const t = runReport("en", "0", "1", "0");
  assert.match(t.test_status, /Failed/);
  assert.match(t.build_status, /Success/);
  assert.equal(t.overall_ok, "false");
  const ok = runReport("en", "0", "0", "0");
  assert.match(ok.test_status, /Success/);
  assert.equal(ok.overall_ok, "true");
});

test("Spring CI report: a step that never produced an exit code is not reported as success", () => {
  const r = runReport("en", "", "", "");
  assert.match(r.compile_status, /Not run/);
  assert.match(r.test_status, /Not run/);
  assert.equal(r.overall_ok, "false");
});

test("status_not_run exists in both languages", () => {
  const m = readFileSync(join(ROOT, "payload/scripts/messages.py"), "utf8").replace(/\r\n/g, "\n");
  assert.equal(m.split('"wf_spring_ci.status_not_run"').length - 1, 2);
});

test("doctor no longer claims that some steps pass without noticing a missing messages.py", () => {
  for (const lang of ["en", "ko"]) {
    const src = readFileSync(join(ROOT, `src/i18n/catalog/${lang}/commands.js`), "utf8").replace(/\r\n/g, "\n");
    const line = src.split("\n").find((l) => l.includes('"cmd.doctor.scripts.impact"'));
    assert.ok(line, lang);
    assert.doesNotMatch(line, /without noticing|모른 채|raw python|원시 오류/);
  }
});

test("Go CI only enables the module cache when go.sum exists", () => {
  const go = readFileSync(join(ROOT, "payload/workflows/go/PROJECT-GO-CI.yaml"), "utf8").replace(/\r\n/g, "\n");
  assert.match(go, /id: gosum/);
  assert.match(go, /cache: \$\{\{ steps\.gosum\.outputs\.exists == 'true' \}\}/);
  assert.doesNotMatch(go, /^\s+cache: true$/m);
});
