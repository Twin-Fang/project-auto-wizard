// tests/node/load-messages-lang.test.js
// Steps that fetch messages.py into .paw-msg resolve the language there (version.yml is only in that clone), but the
// later `dump` runs from the workspace root where no version.yml exists. Without passing the resolved language along,
// a ko repo gets English PAW_MSG / PAW_REMOTE. These tests check both the YAML shape and the real shell output.
import { test } from "node:test";
import assert from "node:assert";
import { readdirSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힣]/;

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.ya?ml$/.test(e.name) ? [p] : [];
  });
const FILES = [...walk(join(ROOT, "payload/workflows")), ...walk(join(ROOT, "templates/workflows")), ...walk(join(ROOT, ".github/workflows"))];

// Steps (as text chunks) whose run script reads messages.py from the .paw-msg sparse clone
function pawMsgSteps(text) {
  const lines = text.split("\n");
  const starts = [];
  lines.forEach((l, i) => {
    if (/^\s*- name:/.test(l)) starts.push(i);
  });
  const steps = [];
  starts.forEach((s, n) => {
    const indent = lines[s].length - lines[s].trimStart().length;
    let end = lines.length;
    for (let k = s + 1; k < lines.length; k++) {
      const l = lines[k];
      if (l.trim() === "") continue;
      if (l.length - l.trimStart().length <= indent) {
        end = k;
        break;
      }
    }
    const chunk = lines.slice(s, end);
    const runAt = chunk.findIndex((l) => /^\s*run: \|\s*$/.test(l));
    if (runAt < 0) return;
    const body = chunk.slice(runAt + 1);
    const first = body.find((l) => l.trim() !== "");
    if (!first) return;
    const pad = first.length - first.trimStart().length;
    const script = body.map((l) => l.slice(Math.min(pad, l.length - l.trimStart().length))).join("\n");
    if (/messages\.py/.test(script) && /\.paw-msg/.test(script) && /\blang\b/.test(script)) {
      steps.push({ line: s + 1, script, name: lines[s].trim() });
    }
  });
  return steps;
}

// Every messages.py call that runs after `lang` must carry the language: an inline assignment on the call
// or an `export PROJECT_AUTO_WIZARD_LANG=` earlier in the same step
function unlangDumps(script) {
  const out = [];
  const src = script.split("\n");
  let exported = false;
  src.forEach((l, i) => {
    if (/^\s*export PROJECT_AUTO_WIZARD_LANG=/.test(l)) exported = true;
    if (/^\s*#/.test(l)) return;
    if (/messages\.py"? dump/.test(l) || /"dump"/.test(l)) {
      // the python heredoc runs dump through subprocess, so only an earlier export can cover it
      const inline = /PROJECT_AUTO_WIZARD_LANG=\S+ python3/.test(l);
      if (!exported && !inline) out.push(`line ${i + 1}: ${l.trim()}`);
    }
  });
  return out;
}

const all = [];
for (const file of FILES) {
  const text = readFileSync(file, "utf8");
  if (!text.includes(".paw-msg")) continue;
  const steps = pawMsgSteps(text);
  test(`${file.slice(ROOT.length)}: has .paw-msg Load messages steps`, () => {
    assert.ok(steps.length > 0);
  });
  for (const st of steps) {
    all.push({ file, ...st });
    test(`${file.slice(ROOT.length)}:${st.line}: dump runs with the resolved language`, () => {
      assert.deepStrictEqual(unlangDumps(st.script), []);
    });
  }
}

// Run each extracted step the way the runner does: cwd = workspace root (no version.yml), version.yml only in .paw-msg
function runStep(script, language) {
  const dir = mkdtempSync(join(tmpdir(), "paw-lang-"));
  try {
    const ws = join(dir, "ws");
    const temp = join(dir, "tmp");
    mkdirSync(join(ws, ".paw-msg/.github/scripts"), { recursive: true });
    mkdirSync(temp, { recursive: true });
    copyFileSync(join(ROOT, "payload/scripts/messages.py"), join(ws, ".paw-msg/.github/scripts/messages.py"));
    writeFileSync(join(ws, ".paw-msg/version.yml"), `language: "${language}"\n`);
    const envFile = join(dir, "github_env");
    writeFileSync(envFile, "");
    const env = { ...process.env, GITHUB_WORKSPACE: ws, RUNNER_TEMP: temp, GITHUB_ENV: envFile };
    delete env.PROJECT_AUTO_WIZARD_LANG;
    const r = spawnSync("bash", ["-eo", "pipefail", "-c", script], { cwd: ws, env, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return readFileSync(envFile, "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("Load messages steps produce ko PAW_MSG / PAW_REMOTE for a ko version.yml and en for en", () => {
  assert.ok(all.length >= 20, `expected many .paw-msg steps, got ${all.length}`);
  for (const st of all) {
    assert.ok(!st.script.includes("${{"), `${st.file}:${st.line} uses an expression; the extractor cannot run it`);
    const ko = runStep(st.script, "ko");
    const en = runStep(st.script, "en");
    assert.match(ko, /^PROJECT_AUTO_WIZARD_LANG=ko$/m, `${st.file}:${st.line}`);
    assert.match(en, /^PROJECT_AUTO_WIZARD_LANG=en$/m, `${st.file}:${st.line}`);
    const koMsg = /^PAW_MSG=(.*)$/m.exec(ko);
    const enMsg = /^PAW_MSG=(.*)$/m.exec(en);
    assert.ok(koMsg && HANGUL.test(koMsg[1]), `${st.file}:${st.line}: PAW_MSG is not Korean for ko`);
    assert.ok(enMsg && !HANGUL.test(enMsg[1]), `${st.file}:${st.line}: PAW_MSG is not English for en`);
    const remote = (s) => /^PAW_REMOTE<<PAW_EOF\n([\s\S]*?)\nPAW_EOF$/m.exec(s);
    if (remote(ko) || remote(en)) {
      assert.ok(remote(ko) && HANGUL.test(remote(ko)[1]), `${st.file}:${st.line}: PAW_REMOTE is not Korean for ko`);
      assert.ok(remote(en) && !HANGUL.test(remote(en)[1]), `${st.file}:${st.line}: PAW_REMOTE is not English for en`);
    }
  }
});
