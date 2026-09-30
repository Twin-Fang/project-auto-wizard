// tests/node/workflow-generator.test.js
// 템플릿 생성기의 결과가 커밋된 payload 워크플로우와 바이트 단위로 같은지, 어긋남을 잡아내는지 확인한다.
import { test } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { plan, render } from "../../scripts/generate-workflows.mjs";
import { TARGETS } from "../../templates/workflows/targets.mjs";

// 비교에 필요한 디렉터리만 복사한 임시 레포 — 실제 파일을 건드리지 않고 어긋남을 흉내 낸다.
function withRepoCopy(fn) {
  const dir = mkdtempSync(join(tmpdir(), "paw-generate-"));
  try {
    for (const rel of ["payload/workflows", "templates"]) cpSync(rel, join(dir, rel), { recursive: true });
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("generate-workflows --check: 커밋된 payload 파일은 생성 결과와 같다", () => {
  const r = spawnSync(process.execPath, ["scripts/generate-workflows.mjs", "--check"], { encoding: "utf8" });
  assert.strictEqual(r.status, 0, `어긋남 — npm run generate:workflows 로 다시 만드세요\n${r.stderr}`);
});

test("생성 대상마다 결과가 커밋된 파일과 바이트 단위로 일치한다", () => {
  const results = plan();
  assert.strictEqual(results.length, TARGETS.length);
  for (const r of results) {
    assert.strictEqual(readFileSync(r.file, "utf8"), r.expected, `${r.out} 이(가) 생성 결과와 다르다`);
  }
});

test("Go/Python 프리뷰·단일 서버 배포와 React/Next 배포가 모두 생성 대상에 들어 있다", () => {
  const outs = TARGETS.map((t) => t.out);
  for (const f of [
    "payload/workflows/go/PROJECT-GO-PR-PREVIEW.yaml",
    "payload/workflows/python/PROJECT-PYTHON-PR-PREVIEW.yaml",
    "payload/workflows/go/PROJECT-GO-SIMPLE-CICD.yaml",
    "payload/workflows/python/PROJECT-PYTHON-SIMPLE-CICD.yaml",
    "payload/workflows/react/PROJECT-REACT-CICD.yaml",
    "payload/workflows/next/PROJECT-NEXT-CICD.yaml",
  ]) {
    assert.ok(outs.includes(f), `${f} 이(가) 생성 대상에 없다`);
  }
});

test("생성된 payload 파일을 손으로 고치면 어긋남으로 잡힌다", () => {
  withRepoCopy((dir) => {
    const target = join(dir, TARGETS[0].out);
    writeFileSync(target, readFileSync(target, "utf8") + "# 손으로 추가한 줄\n");
    const stale = plan(dir).filter((r) => !r.ok);
    assert.deepStrictEqual(stale.map((r) => r.out), [TARGETS[0].out]);
  });
});

test("render: 줄 전체 자리표시자는 들여쓰기를 유지하고, 빈 배열이면 줄이 사라진다", () => {
  const tpl = "a:\n  %%BLOCK%%\n  %%NONE%%\nb: %%INLINE%%-x";
  const out = render(tpl, { BLOCK: ["# 1", "k: v"], NONE: [], INLINE: "go" });
  assert.strictEqual(out, "a:\n  # 1\n  k: v\nb: go-x");
});

test("render: 배열 값의 빈 줄에는 들여쓰기를 붙이지 않는다", () => {
  assert.strictEqual(render("a:\n  %%BLOCK%%", { BLOCK: ["x", "", "y"] }), "a:\n  x\n\n  y");
});

test("render: 값이 없거나 쓰이지 않거나 형태가 맞지 않으면 실패한다", () => {
  assert.throws(() => render("%%A%%", {}), /값이 없는 자리표시자/);
  assert.throws(() => render("x", { A: "1" }), /쓰지 않는 값/);
  assert.throws(() => render("%%A%%", { A: "1" }), /배열 값/);
  assert.throws(() => render("k: %%A%%", { A: ["1"] }), /문자열 값/);
});

test("GitHub 표현식 ${{ }} 는 자리표시자로 오인되지 않는다", () => {
  assert.strictEqual(render("x: ${{ env.A }}", {}), "x: ${{ env.A }}");
});
