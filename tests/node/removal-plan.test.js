// tests/node/removal-plan.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { planRemoval } from "../../src/core/removal-plan.js";
import { runUninstall } from "../../src/commands/uninstall.js";

function installFixture() {
  const target = mkdtempSync(join(tmpdir(), "paw-removal-plan-"));
  const ctx = createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(),
    now: "2026-07-28 00:00:00", today: "2026-07-28", templateVersion: "0.1.0",
  });
  runFull(ctx, resolvePayloadRoot(), target);
  return target;
}

// baseline 3-way 도입 이후 "사용자만 수정"은 질문 없이 유지되므로(localOnly)
// 충돌 결정(backup/template) 경로를 검증하려면 진짜 충돌을 만들어야 한다.
// baseline의 rendered 해시를 어긋나게 해 "업스트림도 바뀐 것"으로 만든다.
function forceUpstreamChange(target, filename) {
  const bp = join(target, ".github/.wizard/baseline.json");
  const bl = JSON.parse(readFileSync(bp, "utf8"));
  bl.files[filename].rendered = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
  writeFileSync(bp, JSON.stringify(bl, null, 2));
}

test("planRemoval: lists files without deleting anything", () => {
  const target = installFixture();
  try {
    const plan = planRemoval(resolvePayloadRoot(), target);
    assert.ok(plan.workflows.length > 0);
    assert.ok(plan.scripts.includes("version_manager.py"));
    assert.ok(plan.scripts.includes("truncate_release_notes.py"));
    assert.ok(plan.scripts.includes("issue_helper.py"));
    // 아무것도 지워지지 않았어야 함
    for (const name of plan.workflows) {
      assert.ok(existsSync(join(target, ".github/workflows", name)));
    }
    for (const name of plan.scripts) {
      assert.ok(existsSync(join(target, ".github/scripts", name)));
    }
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planRemoval output matches what uninstall actually removes", () => {
  const target = installFixture();
  try {
    const plan = planRemoval(resolvePayloadRoot(), target);
    const result = runUninstall({}, resolvePayloadRoot(), target,
      { workflows: true, scripts: true, readme: false, gitignore: false, versionYml: false });
    assert.deepStrictEqual(result.workflows, plan.workflows);
    assert.deepStrictEqual(result.scripts, plan.scripts);
    for (const name of plan.workflows) {
      assert.ok(!existsSync(join(target, ".github/workflows", name)));
    }
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planRemoval: recognizes a marker-carrying workflow file even if its name no longer exists in the current payload (issue #20 L12)", () => {
  const target = installFixture();
  try {
    const wfDir = join(target, ".github/workflows");
    const renamedPath = join(wfDir, "PROJECT-COMMON-RENAMED-IN-A-LATER-RELEASE.yaml");
    // 실측: payload에는 이 파일명이 존재하지 않는다(과거 버전에서 설치된 뒤 이름이 바뀌었다고 가정) —
    // 그래도 마커가 있으면 인식돼야 한다.
    writeFileSync(renamedPath, "# project-auto-wizard:managed-workflow\nname: old-name\n");
    // 과거 설치 때 baseline에 기록됐고 baseline은 병합으로 이어지므로 기록이 남아 있다.
    const bp = join(target, ".github/.wizard/baseline.json");
    const bl = JSON.parse(readFileSync(bp, "utf8"));
    bl.files["PROJECT-COMMON-RENAMED-IN-A-LATER-RELEASE.yaml"] = { installed: null, rendered: "sha256:0" };
    writeFileSync(bp, JSON.stringify(bl, null, 2));

    const plan = planRemoval(resolvePayloadRoot(), target);
    assert.ok(plan.workflows.includes("PROJECT-COMMON-RENAMED-IN-A-LATER-RELEASE.yaml"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planRemoval: a workflow file without the managed marker (user-authored) is never listed for removal", () => {
  const target = installFixture();
  try {
    const wfDir = join(target, ".github/workflows");
    writeFileSync(join(wfDir, "MY-OWN-CUSTOM-WORKFLOW.yaml"), "name: custom\non: push\n");

    const plan = planRemoval(resolvePayloadRoot(), target);
    assert.ok(!plan.workflows.includes("MY-OWN-CUSTOM-WORKFLOW.yaml"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planRemoval: recognizes .bak and .template.yaml variants created by a 'backup' decision", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-removal-plan-"));
  try {
    // .bak/.template.yaml 파일명 규칙 검증에 .yml 확장자 파일이 필요해 Spring CI를 쓴다.
    const ctx = createContext({
      mode: "full", force: true, types: ["spring"], version: "1.0.0", versionCode: 1,
      branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
      paths: new Map(),
      now: "2026-07-28 00:00:00", today: "2026-07-28", templateVersion: "0.1.0",
    });
    runFull(ctx, resolvePayloadRoot(), target); // spring 파일 설치

    const wfDir = join(target, ".github/workflows");
    const targetFile = join(wfDir, "PROJECT-SPRING-CI.yml");
    writeFileSync(targetFile, readFileSync(targetFile, "utf8") + "\n# edit\n");
    forceUpstreamChange(target, "PROJECT-SPRING-CI.yml");
    runFull(ctx, resolvePayloadRoot(), target, {
      decisions: new Map([["PROJECT-SPRING-CI.yml", "backup"]]),
    });

    const plan = planRemoval(resolvePayloadRoot(), target);
    assert.ok(plan.workflows.includes("PROJECT-SPRING-CI.yml.bak"));
    assert.ok(plan.workflows.includes("PROJECT-SPRING-CI.yml"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planRemoval: a pre-marker install whose filename still matches the current payload is still recognized (no regression for existing installs — issue #20 리뷰 반영)", () => {
  const target = installFixture();
  try {
    // 이 수정 이전(마커가 없던 시절)에 설치된 상태를 흉내낸다 — 첫 줄의 마커를 지운다.
    const wfDir = join(target, ".github/workflows");
    const anyFile = readdirSync(wfDir)[0];
    const p = join(wfDir, anyFile);
    const withoutMarker = readFileSync(p, "utf8").replace(/^# project-auto-wizard:managed-workflow\n/, "");
    writeFileSync(p, withoutMarker);

    const plan = planRemoval(resolvePayloadRoot(), target);
    assert.ok(plan.workflows.includes(anyFile), "filename-matching fallback must still recognize marker-less existing installs");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planRemoval: 마법사 워크플로우를 복사해 이름만 바꾼 사용자 파일은 마커가 있어도 제거하지 않는다", () => {
  const target = installFixture();
  try {
    const wfDir = join(target, ".github/workflows");
    const src = readFileSync(join(wfDir, "PROJECT-COMMON-VERSION-CONTROL.yaml"), "utf8");
    writeFileSync(join(wfDir, "my-version-control-copy.yaml"), src);

    const plan = planRemoval(resolvePayloadRoot(), target);
    assert.ok(!plan.workflows.includes("my-version-control-copy.yaml"));
    assert.ok(plan.workflows.includes("PROJECT-COMMON-VERSION-CONTROL.yaml"));

    runUninstall({}, resolvePayloadRoot(), target,
      { workflows: true, scripts: true, readme: false, gitignore: false, versionYml: false });
    assert.ok(existsSync(join(wfDir, "my-version-control-copy.yaml")), "사용자 복사본은 남아야 한다");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planRemoval: baseline이 없는 구버전 설치는 PROJECT-* 이름의 마커 파일만 인정한다", () => {
  const target = installFixture();
  try {
    rmSync(join(target, ".github/.wizard"), { recursive: true, force: true });
    const wfDir = join(target, ".github/workflows");
    const marked = "# project-auto-wizard:managed-workflow\nname: x\n";
    writeFileSync(join(wfDir, "PROJECT-COMMON-OLD-NAME.yaml"), marked);
    writeFileSync(join(wfDir, "my-copy.yaml"), marked);

    const plan = planRemoval(resolvePayloadRoot(), target);
    assert.ok(plan.workflows.includes("PROJECT-COMMON-OLD-NAME.yaml"));
    assert.ok(!plan.workflows.includes("my-copy.yaml"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
