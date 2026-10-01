// Shared case table: the Node CLI reader (parseExisting) and the readers the installed workflows use must give the same
// answer for every version.yml value. The Python reader (version_manager.py option) runs the same file in
// tests/py/test_option_value.py; here the workflow step itself is also extracted from the YAML and run.
import "../setup-lang.mjs";
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { parseExisting, invalidOptionLines } from "../../src/core/version-yml.js";
import { parseOptionValue } from "../../src/core/options.js";

const ROOT = join(import.meta.dirname, "..", "..");
const cases = JSON.parse(readFileSync(join(import.meta.dirname, "../fixtures/option-value-cases.json"), "utf8"));
const WF = readFileSync(join(ROOT, "payload/workflows/common/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml"), "utf8").replace(/\r\n/g, "\n");

for (const c of cases) {
  test(`option-value parity (CLI): ${c.name}`, () => {
    const parsed = parseExisting(c.content);
    // A missing key is null and resolves to the default; a written-but-unrecognized value is already false here.
    const value = parsed.options.releaseAutomerge ?? c.default;
    assert.strictEqual(String(value), c.expected);
    const bad = parsed.invalidOptions.filter((i) => i.key === c.key);
    assert.deepStrictEqual(bad.map((i) => i.value), c.invalid === null ? [] : [c.invalid]);
  });
}

// ── the workflow step, executed ─────────────────────────────────────────────────────────────────
function readerScript() {
  const block = WF.match(/- name: Read release_automerge option from version\.yml[\s\S]*?(?=\n      - name: )/)[0];
  return block.split("        run: |\n")[1].split("\n").map((l) => l.replace(/^ {10}/, "")).join("\n");
}

function runWorkflowReader(content) {
  const dir = mkdtempSync(join(tmpdir(), "paw-opt-"));
  try {
    mkdirSync(join(dir, ".github", "scripts"), { recursive: true });
    for (const f of ["version_manager.py", "messages.py"]) copyFileSync(join(ROOT, "payload/scripts", f), join(dir, ".github", "scripts", f));
    // "wb" semantics: keep CRLF exactly as the table has it
    writeFileSync(join(dir, "version.yml"), content);
    const out = join(dir, "gh_output");
    writeFileSync(out, "");
    const r = spawnSync("bash", ["-e", "-c", readerScript()], {
      encoding: "utf-8", cwd: dir,
      env: { ...process.env, GITHUB_WORKSPACE: dir.replaceAll("\\", "/"), GITHUB_OUTPUT: out.replaceAll("\\", "/"),
        PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", PROJECT_AUTO_WIZARD_LANG: "en" },
    });
    const written = readFileSync(out, "utf8").replace(/\r\n/g, "\n");
    return { status: r.status, output: written.match(/^release_automerge=(.*)$/m)?.[1], log: `${r.stdout}${r.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const c of cases) {
  test(`option-value parity (workflow step): ${c.name}`, () => {
    const r = runWorkflowReader(c.content);
    assert.strictEqual(r.status, 0, r.log);
    assert.strictEqual(r.output, c.expected, r.log);
    assert.strictEqual(r.log.includes("::warning::"), c.invalid !== null, r.log);
  });
}

test("option-value: the workflow step falls back to ON when version.yml is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-opt-"));
  try {
    mkdirSync(join(dir, ".github", "scripts"), { recursive: true });
    for (const f of ["version_manager.py", "messages.py"]) copyFileSync(join(ROOT, "payload/scripts", f), join(dir, ".github", "scripts", f));
    const out = join(dir, "gh_output");
    writeFileSync(out, "");
    const r = spawnSync("bash", ["-e", "-c", readerScript()], {
      encoding: "utf-8", cwd: dir,
      env: { ...process.env, GITHUB_WORKSPACE: dir.replaceAll("\\", "/"), GITHUB_OUTPUT: out.replaceAll("\\", "/"), PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
    });
    assert.strictEqual(r.status, 0);
    assert.match(readFileSync(out, "utf8"), /^release_automerge=true$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("option-value: a missing script (old install) also falls back to the default instead of failing the step", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-opt-"));
  try {
    const out = join(dir, "gh_output");
    writeFileSync(out, "");
    const r = spawnSync("bash", ["-e", "-c", readerScript()], {
      encoding: "utf-8", cwd: dir,
      env: { ...process.env, GITHUB_WORKSPACE: dir.replaceAll("\\", "/"), GITHUB_OUTPUT: out.replaceAll("\\", "/") },
    });
    assert.strictEqual(r.status, 0);
    assert.match(readFileSync(out, "utf8"), /^release_automerge=true$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── the rule itself ─────────────────────────────────────────────────────────────────────────────
test("parseOptionValue: recognized values and everything else", () => {
  for (const [raw, want] of [["true", true], ["FALSE", false], ["'true'", true], ['"False" # x', false], [" false ", false],
    ["yes", null], ["", null], ["0", null], ["null", null], ["true#x", null], [undefined, null]]) {
    assert.strictEqual(parseOptionValue(raw), want, String(raw));
  }
});

test("invalidOptionLines: one warning per unrecognized value, none when everything is fine", () => {
  assert.deepStrictEqual(invalidOptionLines([]), []);
  const lines = invalidOptionLines(parseExisting("metadata:\n  template:\n    options:\n      release_automerge: maybe\n").invalidOptions);
  assert.strictEqual(lines.length, 1);
  assert.match(lines[0], /release_automerge/);
  assert.match(lines[0], /maybe/);
});
