// tests/node/messages-missing-guard.test.js
// A step that reads .github/scripts/messages.py must stop with a clear, fixed-language error when the file is
// missing. Without the guard, `echo "$(python3 missing.py)"` and steps that only call m() on error paths pass
// silently and the first real failure shows up much later as a raw python traceback.
import { test } from "node:test";
import assert from "node:assert";
import { readdirSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
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
const FILES = [
  ...walk(join(ROOT, "payload/workflows")),
  ...walk(join(ROOT, "templates/workflows")),
  ...walk(join(ROOT, ".github/workflows")),
];

// As written in the YAML (backticks escaped inside the double-quoted echo)
const GUARD_MARK = "messages.py is missing; rerun \\`npx project-auto-wizard --mode full --force\\`";

// Where the script is read from decides which path the guard must test
function requiredPath(line) {
  const s = line.trim();
  if (s.includes(GUARD_MARK) || s.startsWith("#") || s === ".github/scripts/messages.py" || s.startsWith("- .github/scripts/messages.py")) return null;
  // $RUNNER_TEMP copies are made by an earlier, guarded `cp .paw-msg/...` step of the same job
  if (/RUNNER_TEMP/.test(s) && !/^cp /.test(s)) return null;
  if (/^cp \.paw-msg\/\.github\/scripts\/messages\.py/.test(s)) return ".paw-msg/.github/scripts/messages.py";
  if (/\$GITHUB_WORKSPACE/.test(s)) return '"$GITHUB_WORKSPACE/.github/scripts/messages.py"';
  if (/^python3 \.github\/scripts\/messages\.py/.test(s)) return ".github/scripts/messages.py";
  return "UNKNOWN:" + s;
}

// Start line of the step that contains line i (nearest `- ` list item with a smaller indent)
function stepStart(lines, i) {
  const indent = lines[i].length - lines[i].trimStart().length;
  for (let k = i; k >= 0; k--) {
    const m = /^(\s*)- /.exec(lines[k]);
    if (m && m[1].length < indent) return k;
  }
  return 0;
}

function unguarded(text) {
  const lines = text.split("\n");
  const bad = [];
  lines.forEach((l, i) => {
    if (!l.includes("messages.py")) return;
    const need = requiredPath(l);
    if (need === null) return;
    if (need.startsWith("UNKNOWN:")) return bad.push(`line ${i + 1}: unclassified messages.py use`);
    const seg = lines.slice(stepStart(lines, i), i).join("\n");
    if (!seg.includes(`[ -f ${need} ]`) || !seg.includes(GUARD_MARK)) bad.push(`line ${i + 1}: no guard for ${need}`);
  });
  return bad;
}

for (const file of FILES) {
  const text = readFileSync(file, "utf8");
  if (!text.includes("messages.py")) continue;
  test(`${file.slice(ROOT.length)}: every messages.py reader checks the file first`, () => {
    assert.deepStrictEqual(unguarded(text), []);
  });
}

test("guard detector catches a reader without a check", () => {
  const sample = ["jobs:", "  a:", "    steps:", "      - name: x", "        run: |", '          m() { python3 "$GITHUB_WORKSPACE/.github/scripts/messages.py" get "$@"; }'].join("\n");
  assert.equal(unguarded(sample).length, 1);
});

// Extract every distinct guard line as written in the workflows and run it in a repo without messages.py
const GUARDS = new Set();
for (const f of FILES) for (const l of readFileSync(f, "utf8").split("\n")) if (l.includes(GUARD_MARK) && l.trim().startsWith("[ -f ")) GUARDS.add(l.trim());

test("guard lines fail clearly without messages.py and pass with it", () => {
  assert.ok(GUARDS.size >= 3, "expected the workspace, relative and .paw-msg variants");
  const dir = mkdtempSync(join(tmpdir(), "paw-guard-"));
  try {
    for (const g of GUARDS) {
      const env = { ...process.env, GITHUB_WORKSPACE: dir };
      const miss = spawnSync("bash", ["-c", `${g}\necho reached`], { cwd: dir, env, encoding: "utf8" });
      assert.equal(miss.status, 1, g);
      assert.match(miss.stdout, /^::error::messages\.py is missing; rerun `npx project-auto-wizard --mode full --force`$/m);
      assert.ok(!miss.stdout.includes("reached"), g);

      mkdirSync(join(dir, ".github/scripts"), { recursive: true });
      mkdirSync(join(dir, ".paw-msg/.github/scripts"), { recursive: true });
      writeFileSync(join(dir, ".github/scripts/messages.py"), "");
      writeFileSync(join(dir, ".paw-msg/.github/scripts/messages.py"), "");
      const ok = spawnSync("bash", ["-c", `${g}\necho reached`], { cwd: dir, env, encoding: "utf8" });
      assert.equal(ok.status, 0, g);
      assert.match(ok.stdout, /reached/);
      rmSync(join(dir, ".github"), { recursive: true, force: true });
      rmSync(join(dir, ".paw-msg"), { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
