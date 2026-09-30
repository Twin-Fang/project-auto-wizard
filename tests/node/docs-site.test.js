// tests/node/docs-site.test.js
// 문서 사이트(website/)가 CLI·패키지와 어긋나지 않는지 확인한다.
//   ① 사이트의 명령 예시가 현재 파서로 해석된다 (옵션 이름을 바꾸고 사이트를 잊는 경우)
//   ② CLI 레퍼런스에 옮겨 둔 --help 출력이 실제 helpText()와 같다
//   ③ 사이트 파일이 루트 `node --test` 기본 탐색 패턴에 걸리지 않는다
//   ④ 사이트가 루트 패키지(의존성 0, npm files)와 Pages 워크플로우 트리거에 섞이지 않는다
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../../src/cli/args.js";
import { helpText } from "../../src/cli/help.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DOCS_DIR = join(REPO_ROOT, "website", "src", "content", "docs");
// 설치물·빌드 산출물은 사이트 소스가 아니다
const SKIP_DIRS = new Set(["node_modules", "dist", ".astro"]);

function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, acc); }
    else acc.push(p);
  }
  return acc;
}

const docPages = () => walk(DOCS_DIR).filter((p) => /\.mdx?$/.test(p));

test("문서 사이트의 명령 예시는 모두 현재 파서로 해석된다", () => {
  let count = 0;
  for (const file of docPages()) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/npx project-auto-wizard(?:@latest)?((?:\s[^#`|]*)?)/);
      if (!m) continue;
      const args = [...m[1].matchAll(/"([^"]*)"|(\S+)/g)].map((t) => t[1] ?? t[2]);
      if (args.includes("[옵션]") || args.includes("[options]")) continue; // 사용법 줄
      count++;
      assert.doesNotThrow(() => parseArgs(args), `${relative(REPO_ROOT, file)}: 실행할 수 없는 예시: ${line.trim()}`);
    }
  }
  assert.ok(count > 0, "예시를 하나 이상 찾아야 한다");
});

test("CLI 레퍼런스의 --help 블록은 실제 도움말과 같다", () => {
  for (const [rel, lang] of [["reference/cli.md", "en"], ["ko/reference/cli.md", "ko"]]) {
    const text = readFileSync(join(DOCS_DIR, rel), "utf8");
    const m = text.match(/```text\n([\s\S]*?)\n```/);
    assert.ok(m, `${rel}: --help 코드 블록이 없다`);
    assert.strictEqual(m[1], helpText(lang).replace(/\n+$/, ""), `${rel}: --help 출력과 다르다 — 도움말을 바꿨다면 문서도 갱신하세요`);
  }
});

test("사이트 소스는 루트 node --test 기본 탐색 패턴에 걸리지 않는다", () => {
  // node --test 기본 패턴: *.test.*, *-test.*, *_test.*, test-*.*, test.*, test/ 아래 js
  const pattern = /(^|[\\/])(test|[^\\/]*[.\-_]test|test-[^\\/]*)\.[cm]?js$|[\\/]test[\\/].*\.[cm]?js$/;
  const hits = walk(join(REPO_ROOT, "website")).map((p) => relative(REPO_ROOT, p)).filter((p) => pattern.test(p));
  assert.deepStrictEqual(hits, []);
});

test("루트 패키지는 의존성 0개이고 사이트를 npm 패키지에 싣지 않는다", () => {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  assert.strictEqual(pkg.dependencies, undefined);
  assert.strictEqual(pkg.devDependencies, undefined);
  assert.ok(!pkg.files.some((f) => f.includes("website")), `files에 website가 들어 있다: ${pkg.files}`);
});

test("Pages 워크플로우는 main의 website 변경과 수동 실행에만 반응한다", () => {
  const wf = readFileSync(join(REPO_ROOT, ".github", "workflows", "DOCS-PAGES.yaml"), "utf8");
  const on = wf.slice(wf.indexOf("\non:"), wf.indexOf("\nconcurrency:"));
  assert.match(on, /push:\n\s+branches: \["main"\]\n\s+paths:\n\s+- "website\/\*\*"/);
  assert.match(on, /workflow_dispatch:/);
  assert.doesNotMatch(on, /pull_request|release:|workflow_run/);
  assert.match(wf, /pages: write/);
  assert.match(wf, /id-token: write/);
});
