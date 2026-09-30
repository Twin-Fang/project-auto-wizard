// Task 12 게이트 — payload 단일 진실 배선 검증.
// 1) resolvePayloadRoot()가 패키지 루트의 payload/를 가리킨다
// 2) listCommonWorkflows()가 RELEASE-PUBLISH 포함 common 5종을 반환한다
// 3) 제외된 모듈(ide/skills/issues/labels UI/exclusions) import가 src에 잔존하지 않는다
// 4) copyScripts가 payload/scripts/*.py를 .github/scripts/로 설치한다 (누락 시 설치물 런타임 사망)
import { test } from "node:test";
import assert from "node:assert";
import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { resolvePayloadRoot, readTemplateVersion, listCommonWorkflows, assertPayload } from "../../src/core/assets.js";
import { copyScripts, removeScriptBytecode } from "../../src/core/copy/simple.js";

test("resolvePayloadRoot points to the package payload/", () => {
  const root = resolvePayloadRoot();
  assert.strictEqual(resolve(root), resolve(join(process.cwd(), "payload")));
  assert.ok(existsSync(join(root, "workflows")), "payload/workflows missing");
  assert.ok(existsSync(join(root, "scripts")), "payload/scripts missing");
  assert.strictEqual(assertPayload(root), root);
});

test("readTemplateVersion returns the package.json version", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.strictEqual(readTemplateVersion(), pkg.version);
});

test("listCommonWorkflows returns the 6 common workflows incl. RELEASE-PUBLISH and ISSUE-HELPER", () => {
  const names = listCommonWorkflows();
  assert.strictEqual(names.length, 6, `expected 6, got ${names.length}: ${names}`);
  for (const wf of [
    "PROJECT-COMMON-AI-PR-SUMMARY.yaml",
    "PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml",
    "PROJECT-COMMON-ISSUE-HELPER.yaml",
    "PROJECT-COMMON-README-VERSION-UPDATE.yaml",
    "PROJECT-COMMON-RELEASE-PUBLISH.yaml",
    "PROJECT-COMMON-VERSION-CONTROL.yaml",
  ]) assert.ok(names.includes(wf), `${wf} missing`);
});

test("no residual imports of excluded modules in src/", () => {
  const banned = [
    "core/ide/", "commands/skills", "commands/issues",
    "skills-prompts", "exclusions.js", "acquireTemplate", "TEMPLATE_REPO",
  ];
  const files = readdirSync("src", { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".js"));
  for (const f of files) {
    const body = readFileSync(join("src", f), "utf8");
    for (const b of banned) {
      // import/호출 잔존만 검사 — 주석 속 이력 언급("구 acquireTemplate")은 허용
      for (const line of body.split("\n")) {
        const code = line.split("//")[0];
        assert.ok(!code.includes(b), `src${sep}${f}: excluded reference '${b}' → ${line.trim()}`);
      }
    }
  }
});

test("copyScripts installs payload python scripts into .github/scripts/", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-scripts-"));
  try {
    const copied = copyScripts(resolvePayloadRoot(), target);
    assert.strictEqual(copied.length, 5);
    assert.ok(copied.every((r) => r.action === "create"));
    assert.ok(existsSync(join(target, ".github", "scripts", "version_manager.py")));
    assert.ok(existsSync(join(target, ".github", "scripts", "changelog_manager.py")));
    assert.ok(existsSync(join(target, ".github", "scripts", "truncate_release_notes.py")));
    assert.ok(existsSync(join(target, ".github", "scripts", "issue_helper.py")));
    assert.ok(existsSync(join(target, ".github", "scripts", "messages.py")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// 예전 버전이 커밋한 pyc는 업데이트 때 지운다 — 마법사 스크립트 폴더 밖은 건드리지 않는다.
test("removeScriptBytecode는 .github/scripts의 pyc와 빈 __pycache__만 지운다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-pyc-"));
  try {
    const scripts = join(target, ".github", "scripts");
    mkdirSync(join(scripts, "__pycache__"), { recursive: true });
    mkdirSync(join(target, "src", "__pycache__"), { recursive: true });
    writeFileSync(join(scripts, "__pycache__", "version_manager.cpython-312.pyc"), "x");
    writeFileSync(join(scripts, "__pycache__", "changelog_manager.cpython-312.pyc"), "x");
    writeFileSync(join(scripts, "old.pyc"), "x");
    writeFileSync(join(scripts, "version_manager.py"), "print(1)\n");
    writeFileSync(join(target, "src", "__pycache__", "app.cpython-312.pyc"), "x");

    const removed = removeScriptBytecode(target);
    assert.deepStrictEqual(removed.sort(), [
      ".github/scripts/__pycache__/changelog_manager.cpython-312.pyc",
      ".github/scripts/__pycache__/version_manager.cpython-312.pyc",
      ".github/scripts/old.pyc",
    ]);
    assert.ok(!existsSync(join(scripts, "__pycache__")), "빈 __pycache__는 지운다");
    assert.ok(existsSync(join(scripts, "version_manager.py")), "스크립트는 남긴다");
    assert.ok(existsSync(join(target, "src", "__pycache__", "app.cpython-312.pyc")), "다른 경로의 pyc는 건드리지 않는다");
    assert.deepStrictEqual(removeScriptBytecode(target), [], "두 번째 실행은 할 일이 없다");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeScriptBytecode는 pyc가 아닌 파일이 남은 __pycache__는 지우지 않는다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-pyc-"));
  try {
    const cache = join(target, ".github", "scripts", "__pycache__");
    mkdirSync(cache, { recursive: true });
    writeFileSync(join(cache, "a.cpython-312.pyc"), "x");
    writeFileSync(join(cache, "notes.txt"), "keep");
    assert.deepStrictEqual(removeScriptBytecode(target), [".github/scripts/__pycache__/a.cpython-312.pyc"]);
    assert.ok(existsSync(join(cache, "notes.txt")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("scripts 폴더가 없어도 removeScriptBytecode는 조용히 빈 목록을 돌려준다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-pyc-"));
  try {
    assert.deepStrictEqual(removeScriptBytecode(target), []);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
