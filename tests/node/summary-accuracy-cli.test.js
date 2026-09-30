// tests/node/summary-accuracy-cli.test.js
import "../setup-lang.mjs"; // these tests assert the ko output
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "../../src/index.js";

function captureStderr(fn) {
  const original = process.stderr.write.bind(process.stderr);
  let output = "";
  process.stderr.write = (chunk) => { output += chunk; return true; };
  return Promise.resolve(fn()).finally(() => { process.stderr.write = original; }).then(() => output);
}

test("run(): the 'newly installed' list in the full-mode completion summary exactly matches the workflow files actually generated", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-summary-accuracy-"));
  writeFileSync(join(target, "build.gradle"), ""); // root marker to avoid 0 path candidates (spring)
  try {
    let code;
    const output = await captureStderr(async () => {
      code = await run(["--mode", "full", "--force", "--type", "spring"], { cwd: target });
    });
    assert.strictEqual(code, 0);
    const wfDir = join(target, ".github", "workflows");
    const actualFiles = readdirSync(wfDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    assert.ok(actualFiles.length > 0, "test precondition broken — no workflow was created at all");
    for (const f of actualFiles) {
      assert.ok(output.includes(f), `${f}, which was actually generated, is missing from the completion summary`);
    }
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): rerunning with the same options (everything unchanged) shows no 'newly installed' list at all", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-summary-rerun-"));
  writeFileSync(join(target, "build.gradle"), ""); // root marker to avoid 0 path candidates (spring)
  try {
    await run(["--mode", "full", "--force", "--type", "spring"], { cwd: target }); // initial install
    const output = await captureStderr(async () => {
      const code = await run(["--mode", "full", "--force", "--type", "spring"], { cwd: target }); // rerun
      assert.strictEqual(code, 0);
    });
    assert.ok(!output.includes("📦 새로 설치됨"), "on a rerun, unchanged files must not be shown as 'newly installed'");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): without README.md the completion summary does not claim a version section was added", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-summary-noreadme-"));
  writeFileSync(join(target, "package.json"), '{"name":"my-app","version":"1.2.3"}\n');
  try {
    let code;
    const output = await captureStderr(async () => {
      code = await run(["--mode", "full", "--force", "--type", "node"], { cwd: target });
    });
    assert.strictEqual(code, 0);
    assert.ok(!output.includes("README.md (버전 섹션 추가)"), "an action that was not done must not be reported as 'added'");
    assert.ok(!output.includes("README.md 자동 버전 업데이트"));
    assert.ok(output.includes("README.md가 없어 버전 섹션을 추가하지 않았습니다"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): with README.md it announces the version section addition and also shows that the fixed script was overwritten", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-summary-readme-"));
  writeFileSync(join(target, "package.json"), '{"name":"my-app","version":"1.2.3"}\n');
  writeFileSync(join(target, "README.md"), "# my-app\n");
  try {
    await run(["--mode", "full", "--force", "--type", "node"], { cwd: target });
    writeFileSync(join(target, ".github", "scripts", "issue_helper.py"), "# my edit\n");
    const output = await captureStderr(async () => {
      assert.strictEqual(await run(["--mode", "full", "--force", "--type", "node"], { cwd: target }), 0);
    });
    assert.ok(output.includes("README.md 자동 버전 업데이트"), "the pre-existing version section is still auto-updated");
    assert.match(output, /issue_helper\.py .*덮어씀/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): the required Secret list counts a fallback pair as one and shows optional Secrets separately", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-summary-secrets-"));
  writeFileSync(join(target, "package.json"), '{"name":"my-app","version":"1.0.0","dependencies":{"react":"18"}}\n');
  try {
    const output = await captureStderr(async () => {
      assert.strictEqual(await run(["--mode", "full", "--force", "--type", "react"], { cwd: target }), 0);
    });
    const required = output.slice(output.indexOf("GitHub Secret을 등록해야"), output.indexOf("선택 Secret"));
    assert.match(required, /ENV_FILE 또는 ENV \(둘 중 하나\)/);
    assert.doesNotMatch(required, /→ ENV /, "ENV must not be counted separately as required");
    assert.doesNotMatch(required, /PROJECT_DEPLOY_PORT/, "a port with a default is not required");
    assert.match(output, /선택 Secret[^\n]*\n\s+· PROJECT_DEPLOY_PORT/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
