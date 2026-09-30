// tests/node/workflow-generator.test.js
// Verifies the template generator's output is byte-identical to the committed payload workflows, and that it catches drift.
import { test } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { plan, render } from "../../scripts/generate-workflows.mjs";
import { TARGETS } from "../../templates/workflows/targets.mjs";

// Temp repo with only the directories needed for comparison - simulates drift without touching real files.
function withRepoCopy(fn) {
  const dir = mkdtempSync(join(tmpdir(), "paw-generate-"));
  try {
    for (const rel of ["payload/workflows", "templates"]) cpSync(rel, join(dir, rel), { recursive: true });
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("generate-workflows --check: committed payload files match the generated output", () => {
  const r = spawnSync(process.execPath, ["scripts/generate-workflows.mjs", "--check"], { encoding: "utf8" });
  assert.strictEqual(r.status, 0, `Out of date - regenerate with npm run generate:workflows\n${r.stderr}`);
});

test("each generation target is byte-identical to the committed file", () => {
  const results = plan();
  assert.strictEqual(results.length, TARGETS.length);
  for (const r of results) {
    assert.strictEqual(readFileSync(r.file, "utf8"), r.expected, `${r.out} differs from the generated output`);
  }
});

test("Go/Python preview, single-server deploy, and React/Next deploy are all generation targets", () => {
  const outs = TARGETS.map((t) => t.out);
  for (const f of [
    "payload/workflows/go/PROJECT-GO-PR-PREVIEW.yaml",
    "payload/workflows/python/PROJECT-PYTHON-PR-PREVIEW.yaml",
    "payload/workflows/go/PROJECT-GO-SIMPLE-CICD.yaml",
    "payload/workflows/python/PROJECT-PYTHON-SIMPLE-CICD.yaml",
    "payload/workflows/react/PROJECT-REACT-CICD.yaml",
    "payload/workflows/next/PROJECT-NEXT-CICD.yaml",
  ]) {
    assert.ok(outs.includes(f), `${f} is not a generation target`);
  }
});

test("hand-editing a generated payload file is caught as drift", () => {
  withRepoCopy((dir) => {
    const target = join(dir, TARGETS[0].out);
    writeFileSync(target, readFileSync(target, "utf8") + "# hand-added line\n");
    const stale = plan(dir).filter((r) => !r.ok);
    assert.deepStrictEqual(stale.map((r) => r.out), [TARGETS[0].out]);
  });
});

test("render: a whole-line placeholder keeps indentation, and an empty array removes the line", () => {
  const tpl = "a:\n  %%BLOCK%%\n  %%NONE%%\nb: %%INLINE%%-x";
  const out = render(tpl, { BLOCK: ["# 1", "k: v"], NONE: [], INLINE: "go" });
  assert.strictEqual(out, "a:\n  # 1\n  k: v\nb: go-x");
});

test("render: empty lines in an array value get no indentation", () => {
  assert.strictEqual(render("a:\n  %%BLOCK%%", { BLOCK: ["x", "", "y"] }), "a:\n  x\n\n  y");
});

test("render: fails when a value is missing, unused, or of the wrong shape", () => {
  assert.throws(() => render("%%A%%", {}), /has no value/);
  assert.throws(() => render("x", { A: "1" }), /not used/);
  assert.throws(() => render("%%A%%", { A: "1" }), /array value/);
  assert.throws(() => render("k: %%A%%", { A: ["1"] }), /string value/);
});

test("GitHub expression ${{ }} is not mistaken for a placeholder", () => {
  assert.strictEqual(render("x: ${{ env.A }}", {}), "x: ${{ env.A }}");
});
