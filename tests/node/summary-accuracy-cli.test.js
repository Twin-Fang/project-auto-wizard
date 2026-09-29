// tests/node/summary-accuracy-cli.test.js
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

test("run(): full 모드 완료 요약의 '새로 설치됨' 목록이 실제 생성된 워크플로우 파일과 정확히 일치한다", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-summary-accuracy-"));
  writeFileSync(join(target, "build.gradle"), ""); // 경로 후보 0개 방지용 루트 마커 (spring)
  try {
    let code;
    const output = await captureStderr(async () => {
      code = await run(["--mode", "full", "--force", "--type", "spring"], { cwd: target });
    });
    assert.strictEqual(code, 0);
    const wfDir = join(target, ".github", "workflows");
    const actualFiles = readdirSync(wfDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    assert.ok(actualFiles.length > 0, "테스트 전제가 깨졌습니다 — 워크플로우가 하나도 안 만들어짐");
    for (const f of actualFiles) {
      assert.ok(output.includes(f), `실제로 생성된 ${f}가 완료 요약에 없습니다`);
    }
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): 동일 옵션으로 재실행하면(전부 unchanged) '새로 설치됨' 목록이 아예 뜨지 않는다", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-summary-rerun-"));
  writeFileSync(join(target, "build.gradle"), ""); // 경로 후보 0개 방지용 루트 마커 (spring)
  try {
    await run(["--mode", "full", "--force", "--type", "spring"], { cwd: target }); // 최초 설치
    const output = await captureStderr(async () => {
      const code = await run(["--mode", "full", "--force", "--type", "spring"], { cwd: target }); // 재실행
      assert.strictEqual(code, 0);
    });
    assert.ok(!output.includes("📦 새로 설치됨"), "재실행에서 unchanged 파일들이 '새로 설치됨'으로 표시되면 안 됩니다");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): README.md가 없으면 완료 요약이 버전 섹션을 추가했다고 말하지 않는다", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-summary-noreadme-"));
  writeFileSync(join(target, "package.json"), '{"name":"my-app","version":"1.2.3"}\n');
  try {
    let code;
    const output = await captureStderr(async () => {
      code = await run(["--mode", "full", "--force", "--type", "node"], { cwd: target });
    });
    assert.strictEqual(code, 0);
    assert.ok(!output.includes("README.md (버전 섹션 추가)"), "하지 않은 작업을 '추가됨'으로 보고하면 안 된다");
    assert.ok(!output.includes("README.md 자동 버전 업데이트"));
    assert.ok(output.includes("README.md가 없어 버전 섹션을 추가하지 않았습니다"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): README.md가 있으면 버전 섹션 추가를 알리고, 고친 스크립트를 덮어쓴 사실도 보여준다", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-summary-readme-"));
  writeFileSync(join(target, "package.json"), '{"name":"my-app","version":"1.2.3"}\n');
  writeFileSync(join(target, "README.md"), "# my-app\n");
  try {
    await run(["--mode", "full", "--force", "--type", "node"], { cwd: target });
    writeFileSync(join(target, ".github", "scripts", "issue_helper.py"), "# my edit\n");
    const output = await captureStderr(async () => {
      assert.strictEqual(await run(["--mode", "full", "--force", "--type", "node"], { cwd: target }), 0);
    });
    assert.ok(output.includes("README.md 자동 버전 업데이트"), "원래 있던 버전 섹션은 계속 자동 갱신된다");
    assert.match(output, /issue_helper\.py .*덮어씀/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): 필요 Secret 목록은 폴백 쌍을 하나로 세고 선택 Secret은 따로 보여준다", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-summary-secrets-"));
  writeFileSync(join(target, "package.json"), '{"name":"my-app","version":"1.0.0","dependencies":{"react":"18"}}\n');
  try {
    const output = await captureStderr(async () => {
      assert.strictEqual(await run(["--mode", "full", "--force", "--type", "react"], { cwd: target }), 0);
    });
    const required = output.slice(output.indexOf("GitHub Secret을 등록해야"), output.indexOf("선택 Secret"));
    assert.match(required, /ENV_FILE 또는 ENV \(둘 중 하나\)/);
    assert.doesNotMatch(required, /→ ENV /, "ENV를 따로 필수로 세면 안 된다");
    assert.doesNotMatch(required, /PROJECT_DEPLOY_PORT/, "기본값이 있는 포트는 필수가 아니다");
    assert.match(output, /선택 Secret[^\n]*\n\s+· PROJECT_DEPLOY_PORT/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
