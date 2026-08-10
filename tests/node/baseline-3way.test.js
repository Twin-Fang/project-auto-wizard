// tests/node/baseline-3way.test.js
// issue #69 — 설치 시점 baseline 기반 3-way 분류. 목적은 자동 병합이 아니라 분류다:
// "자동으로 안전한 경우"와 "사람이 봐야 하는 경우"를 갈라내 질문 수를 실제 충돌만큼으로 줄인다.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { listWorkflowConflicts, surveyWorkflows, planWorkflows } from "../../src/core/copy/workflows.js";
import { readBaseline, sha256, BASELINE_PATH } from "../../src/core/baseline.js";

const PAYLOAD = resolvePayloadRoot();
const WF = ".github/workflows";
const TARGET_WF = "PROJECT-PYTHON-CI.yaml";

function ctxFor(target) {
  return createContext({
    mode: "full", force: true, types: ["python"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(), now: "2026-08-10 00:00:00", today: "2026-08-10", templateVersion: "0.1.0",
  });
}

function install() {
  const target = mkdtempSync(join(tmpdir(), "paw-3way-"));
  runFull(ctxFor(target), PAYLOAD, target);
  return target;
}

// baseline의 rendered를 어긋나게 = "업스트림이 이 파일을 고쳤다"를 흉내낸다.
// payload를 실제로 수정하지 않고 업스트림 변경만 시뮬레이션하는 유일한 방법이다.
function fakeUpstreamChange(target, filename) {
  const bp = join(target, BASELINE_PATH);
  const bl = JSON.parse(readFileSync(bp, "utf8"));
  bl.files[filename].rendered = "sha256:" + "0".repeat(64);
  writeFileSync(bp, JSON.stringify(bl, null, 2));
}

test("설치가 baseline을 남긴다 (installed/rendered 두 해시)", () => {
  const target = install();
  try {
    const bl = readBaseline(target);
    assert.ok(bl, "baseline.json이 생성되어야 한다");
    const entry = bl.files[TARGET_WF];
    assert.ok(entry, `${TARGET_WF}가 baseline에 있어야 한다`);
    assert.match(entry.installed, /^sha256:[0-9a-f]{64}$/);
    assert.match(entry.rendered, /^sha256:[0-9a-f]{64}$/);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("사용자 수정 + 업스트림 무변경 → 질문 0건, 수정본 그대로 유지 (localOnly)", () => {
  const target = install();
  try {
    const wf = join(target, WF, TARGET_WF);
    const edited = readFileSync(wf, "utf8") + "\n# 내 수정\n";
    writeFileSync(wf, edited);

    // 이것이 이슈의 2차 실측 사례다 — 예전에는 여기서 12개 파일을 전부 물어봤다.
    assert.deepStrictEqual(listWorkflowConflicts(ctxFor(target), PAYLOAD, target), [],
      "업스트림이 그대로면 물어볼 것이 없어야 한다");

    runFull(ctxFor(target), PAYLOAD, target);
    assert.strictEqual(readFileSync(wf, "utf8"), edited, "사용자 수정본이 보존되어야 한다");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

// "옛 버전이 깔려 있고 그 뒤 업스트림이 바뀐" 상태를 만든다.
// 디스크를 예전 내용으로 되돌리고 baseline.installed를 그 값에 맞춘다
// = 사용자는 손대지 않았고(installed 일치) payload는 그새 바뀐(theirs ≠ ours) 상황.
function simulateOldInstall(target, filename) {
  const wf = join(target, WF, filename);
  const older = readFileSync(wf, "utf8") + "\n# 예전 릴리스의 흔적\n";
  writeFileSync(wf, older);
  const bp = join(target, BASELINE_PATH);
  const bl = JSON.parse(readFileSync(bp, "utf8"));
  bl.files[filename].installed = sha256(older);
  writeFileSync(bp, JSON.stringify(bl, null, 2));
  return older;
}

test("사용자 미수정 + 업스트림 변경 → 질문 0건, 자동 교체 (upstreamOnly)", () => {
  const target = install();
  try {
    const stale = simulateOldInstall(target, TARGET_WF);
    const wf = join(target, WF, TARGET_WF);

    assert.deepStrictEqual(listWorkflowConflicts(ctxFor(target), PAYLOAD, target), [],
      "사용자가 손대지 않았으면 물어볼 것이 없어야 한다");

    const plan = planWorkflows(ctxFor(target), PAYLOAD, target);
    assert.ok(plan.upstreamOnly.some((f) => f.filename === TARGET_WF));

    const r = runFull(ctxFor(target), PAYLOAD, target);
    assert.ok(r.workflows.autoUpdated.includes(TARGET_WF), "자동 적용 목록에 있어야 한다");
    assert.notStrictEqual(readFileSync(wf, "utf8"), stale, "옛 내용이 최신으로 교체되어야 한다");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("양쪽 변경 → 진짜 충돌로 분류되어 질문 대상이 된다 (changed)", () => {
  const target = install();
  try {
    const wf = join(target, WF, TARGET_WF);
    writeFileSync(wf, readFileSync(wf, "utf8") + "\n# 내 수정\n");
    fakeUpstreamChange(target, TARGET_WF);

    const conflicts = listWorkflowConflicts(ctxFor(target), PAYLOAD, target);
    assert.ok(conflicts.some((c) => c.filename === TARGET_WF),
      "양쪽이 다 바뀌면 사람이 봐야 한다");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("baseline이 없는 기존 설치는 종전대로 충돌 취급하고, 그 실행에서 baseline이 심긴다 (폴백)", () => {
  const target = install();
  try {
    rmSync(join(target, BASELINE_PATH), { force: true }); // baseline 이전 버전으로 설치된 레포
    const wf = join(target, WF, TARGET_WF);
    writeFileSync(wf, readFileSync(wf, "utf8") + "\n# 내 수정\n");

    const conflicts = listWorkflowConflicts(ctxFor(target), PAYLOAD, target);
    assert.ok(conflicts.some((c) => c.filename === TARGET_WF), "base 미상이면 충돌로 폴백");

    runFull(ctxFor(target), PAYLOAD, target); // skip 결정(미지정) → 사용자 수정본 유지
    assert.ok(readBaseline(target), "이 실행에서 baseline이 심겨야 한다");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("유지(skip)한 파일의 installed 기준점은 갱신되지 않는다 — 사용자 수정본을 '우리가 쓴 것'으로 기록하면 다음 업데이트에서 조용히 덮인다", () => {
  const target = install();
  try {
    const before = readBaseline(target).files[TARGET_WF].installed;
    const wf = join(target, WF, TARGET_WF);
    writeFileSync(wf, readFileSync(wf, "utf8") + "\n# 내 수정\n");
    runFull(ctxFor(target), PAYLOAD, target); // localOnly → 유지

    assert.strictEqual(readBaseline(target).files[TARGET_WF].installed, before,
      "유지한 파일의 installed 해시는 설치 시점 값을 지켜야 한다");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

// ── 사용자가 지운 파일 ──────────────────────────────────────────────

test("사용자가 지운 파일은 조용히 되살아나지 않는다", () => {
  const target = install();
  try {
    const wf = join(target, WF, TARGET_WF);
    rmSync(wf, { force: true });

    const { removed } = surveyWorkflows(ctxFor(target), PAYLOAD, target);
    assert.ok(removed.some((r) => r.filename === TARGET_WF), "삭제가 감지되어야 한다");

    const r = runFull(ctxFor(target), PAYLOAD, target);
    assert.ok(!existsSync(wf), "물어보지 않고 되살리면 안 된다");
    assert.ok(r.workflows.removedKept.includes(TARGET_WF));
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("복원하기로 결정한 파일만 다시 설치된다", () => {
  const target = install();
  try {
    const wf = join(target, WF, TARGET_WF);
    rmSync(wf, { force: true });

    const r = runFull(ctxFor(target), PAYLOAD, target, { restoreRemoved: new Set([TARGET_WF]) });
    assert.ok(existsSync(wf), "복원 결정이 있으면 다시 설치되어야 한다");
    assert.ok(r.workflows.restoredFiles.includes(TARGET_WF));
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("삭제 상태는 여러 번 재실행해도 유지된다 (baseline 병합이 기준점을 잃지 않는다)", () => {
  const target = install();
  try {
    const wf = join(target, WF, TARGET_WF);
    rmSync(wf, { force: true });
    runFull(ctxFor(target), PAYLOAD, target);
    runFull(ctxFor(target), PAYLOAD, target);
    assert.ok(!existsSync(wf), "두 번째 재실행에서도 되살아나면 안 된다");
  } finally { rmSync(target, { recursive: true, force: true }); }
});
