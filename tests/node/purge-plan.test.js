// tests/node/purge-plan.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, writeFileSync, rmSync, readdirSync, readFileSync as readFile } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { planPurge, executePurge, printPurgeResult } from "../../src/commands/purge.js";

function installFixture() {
  const target = mkdtempSync(join(tmpdir(), "paw-purge-plan-"));
  writeFileSync(join(target, "README.md"), "# Test Repo\n");
  const ctx = createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(),
    now: "2026-07-28 00:00:00", today: "2026-07-28", templateVersion: "0.1.0",
  });
  runFull(ctx, resolvePayloadRoot(), target);
  return target;
}

test("planPurge: lists workflows/scripts + version.yml + readme section, deletes nothing", () => {
  const target = installFixture();
  try {
    const plan = planPurge(resolvePayloadRoot(), target);
    assert.ok(plan.workflows.length > 0);
    assert.ok(plan.scripts.includes("version_manager.py"));
    assert.strictEqual(plan.versionYml, true);
    assert.strictEqual(plan.readmeSection, true);
    assert.deepStrictEqual(plan.changelog, []);
    assert.ok(existsSync(join(target, "version.yml")));
    assert.ok(existsSync(join(target, ".github/scripts/version_manager.py")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planPurge: detects CHANGELOG.json/.md when present at root", () => {
  const target = installFixture();
  try {
    writeFileSync(join(target, "CHANGELOG.json"), "{}");
    writeFileSync(join(target, "CHANGELOG.md"), "# Changelog\n");
    const plan = planPurge(resolvePayloadRoot(), target);
    assert.deepStrictEqual(plan.changelog.sort(), ["CHANGELOG.json", "CHANGELOG.md"]);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planPurge: keepFlags excludes categories from the plan", () => {
  const target = installFixture();
  try {
    const plan = planPurge(resolvePayloadRoot(), target, {
      versionYml: true, readme: true, workflows: true, scripts: true, changelog: true,
    });
    assert.deepStrictEqual(plan.workflows, []);
    assert.deepStrictEqual(plan.scripts, []);
    assert.strictEqual(plan.versionYml, false);
    assert.strictEqual(plan.readmeSection, false);
    assert.deepStrictEqual(plan.changelog, []);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// H1 (Fable 검토, 2026-08-01) → issue #7 갱신: runFull()은 이제 충돌 백업 부산물(.bak/.template.yaml)이
// 실제로 생겼을 때만 .gitignore를 건드린다. 이 라운드트립 테스트의 설치는 충돌이 없어 .gitignore가
// 전혀 생성되지 않으므로 아래 필터는 사실상 no-op이지만, 만약 다른 테스트가 충돌을 유발하도록 바뀌더라도
// purge는 스펙 §2 비목표에 따라 .gitignore를 절대 건드리지 않으므로 안전하게 비교 대상에서 제외해 둔다.
function listAllFiles(dir, base = dir) {
  let out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === ".gitignore") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) out = out.concat(listAllFiles(full, base));
    else out.push(full.slice(base.length + 1));
  }
  return out.sort();
}

test("executePurge: round-trip returns target to its pre-install file tree", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-purge-plan-"));
  writeFileSync(join(target, "README.md"), "# Test Repo\n");
  try {
    const before = listAllFiles(target);
    const ctx = createContext({
      mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
      branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
      paths: new Map(),
      now: "2026-07-28 00:00:00", today: "2026-07-28", templateVersion: "0.1.0",
    });
    runFull(ctx, resolvePayloadRoot(), target);
    assert.ok(listAllFiles(target).length > before.length);
    const result = executePurge(resolvePayloadRoot(), target);
    assert.strictEqual(result.readmeSection, true);
    assert.deepStrictEqual(listAllFiles(target), before);
    assert.strictEqual(readFile(join(target, "README.md"), "utf8"), "# Test Repo\n");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("executePurge: --keep-version-yml preserves version.yml while removing the rest", () => {
  const target = installFixture();
  try {
    const result = executePurge(resolvePayloadRoot(), target, { versionYml: true });
    assert.ok(existsSync(join(target, "version.yml")));
    assert.ok(!existsSync(join(target, ".github/scripts/version_manager.py")));
    assert.strictEqual(result.versionYml, false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// M1 (Fable 검토): 스펙 §9-1은 "--keep-* 각각"에 대해 실행 레벨(execute) 보존 검증을 요구하는데
// 최초 초안은 --keep-version-yml 하나뿐이었다 — 나머지 5개도 각각 실행 레벨에서 검증한다.
test("executePurge: --keep-readme preserves the AUTO-VERSION-SECTION block while removing the rest", () => {
  const target = installFixture();
  try {
    const result = executePurge(resolvePayloadRoot(), target, { readme: true });
    assert.ok(readFile(join(target, "README.md"), "utf8").includes("AUTO-VERSION-SECTION"));
    assert.ok(!existsSync(join(target, "version.yml")));
    assert.strictEqual(result.readmeSection, false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("executePurge: --keep-workflows preserves workflow files while removing the rest", () => {
  const target = installFixture();
  try {
    const before = readdirSync(join(target, ".github/workflows")).sort();
    executePurge(resolvePayloadRoot(), target, { workflows: true });
    assert.deepStrictEqual(readdirSync(join(target, ".github/workflows")).sort(), before);
    assert.ok(!existsSync(join(target, "version.yml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("executePurge: --keep-scripts preserves .github/scripts/*.py while removing the rest", () => {
  const target = installFixture();
  try {
    executePurge(resolvePayloadRoot(), target, { scripts: true });
    assert.ok(existsSync(join(target, ".github/scripts/version_manager.py")));
    assert.ok(!existsSync(join(target, "version.yml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// M2 (Fable 검토): CHANGELOG 카테고리는 최초 초안에서 감지(planPurge)만 검증되고 실제 삭제가
// 어떤 테스트에서도 실행되지 않는 죽은 경로였다 — --keep-changelog 보존 테스트와 별개로
// 기본 동작(보존 플래그 없이 실제로 지워짐)도 명시적으로 검증한다.
test("executePurge: --keep-changelog preserves CHANGELOG files while removing the rest", () => {
  const target = installFixture();
  try {
    writeFileSync(join(target, "CHANGELOG.json"), "{}");
    executePurge(resolvePayloadRoot(), target, { changelog: true });
    assert.ok(existsSync(join(target, "CHANGELOG.json")));
    assert.ok(!existsSync(join(target, "version.yml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("executePurge: deletes CHANGELOG.json/.md when present and not kept", () => {
  const target = installFixture();
  try {
    writeFileSync(join(target, "CHANGELOG.json"), "{}");
    writeFileSync(join(target, "CHANGELOG.md"), "# Changelog\n");
    const result = executePurge(resolvePayloadRoot(), target);
    assert.ok(!existsSync(join(target, "CHANGELOG.json")));
    assert.ok(!existsSync(join(target, "CHANGELOG.md")));
    assert.deepStrictEqual(result.changelog.sort(), ["CHANGELOG.json", "CHANGELOG.md"]);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("printPurgeResult: lists removed filenames, not just counts (M3)", () => {
  const originalLog = console.log;
  let stdout = "";
  console.log = (msg) => { stdout += msg; };
  try {
    printPurgeResult({
      workflows: ["PROJECT-RELEASE.yaml"], scripts: ["version_manager.py"],
      versionYml: true, readmeSection: true, changelog: ["CHANGELOG.md"],
    });
  } finally {
    console.log = originalLog;
  }
  assert.ok(stdout.includes("PROJECT-RELEASE.yaml"));
  assert.ok(stdout.includes("version_manager.py"));
  assert.ok(stdout.includes("CHANGELOG.md"));
});

test("printPurgeResult: does not throw on an empty result", () => {
  printPurgeResult({ workflows: [], scripts: [], versionYml: false, readmeSection: false, changelog: [] });
});
