// Task 12 게이트 — payload 단일 진실 배선 검증.
// 1) resolvePayloadRoot()가 패키지 루트의 payload/를 가리킨다
// 2) listCommonWorkflows()가 RELEASE-PUBLISH 포함 common 4종을 반환한다
// 3) 제외된 모듈(ide/skills/issues/labels UI/exclusions) import가 src에 잔존하지 않는다
// 4) copyScripts가 payload/scripts/*.py를 .github/scripts/로 설치한다 (누락 시 설치물 런타임 사망)
import { test } from "node:test";
import assert from "node:assert";
import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { resolvePayloadRoot, readTemplateVersion, listCommonWorkflows, assertPayload } from "../../src/core/assets.js";
import { copyScripts } from "../../src/core/copy/simple.js";

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

test("listCommonWorkflows returns the 4 common workflows incl. RELEASE-PUBLISH", () => {
  const names = listCommonWorkflows();
  assert.strictEqual(names.length, 4, `expected 4, got ${names.length}: ${names}`);
  for (const wf of [
    "PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml",
    "PROJECT-COMMON-README-VERSION-UPDATE.yaml",
    "PROJECT-COMMON-RELEASE-PUBLISH.yaml",
    "PROJECT-COMMON-VERSION-CONTROL.yaml",
  ]) assert.ok(names.includes(wf), `${wf} missing`);
  // secret-backup은 하위 폴더 — 직하위 목록엔 포함되지 않는다 (opt-in 별도 복사 규약)
  assert.ok(!names.includes("PROJECT-COMMON-SECRET-FILE-UPLOAD.yaml"));
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
    assert.strictEqual(copied, 2);
    assert.ok(existsSync(join(target, ".github", "scripts", "version_manager.py")));
    assert.ok(existsSync(join(target, ".github", "scripts", "changelog_manager.py")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
