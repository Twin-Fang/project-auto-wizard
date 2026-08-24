import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { runDoctor, printDoctorReport, DOC } from "../../src/commands/doctor.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

// printDoctorReport를 out 주입으로 캡처한다(색상은 끈 상태 — 문자열 단언을 ESC로부터 보호).
function render(results, { color = false } = {}) {
  let output = "";
  printDoctorReport(results, { out: (s) => { output = s; }, color });
  return output;
}

const ALL_OK_EXEC = [
  ["gh --version", { status: 0, stdout: "gh version 2.96.0", stderr: "" }],
  ["gh auth status", { status: 0, stdout: "Logged in", stderr: "" }],
  ["git -C", { status: 0, stdout: "https://github.com/acme/widgets.git\n", stderr: "" }],
  ["actions/permissions/workflow", { status: 0, stdout: "write", stderr: "" }],
  ["secret list", { status: 0, stdout: "WORKFLOW_PAT\tUpdated 2026-01-01\n", stderr: "" }],
  [".allow_merge_commit", { status: 0, stdout: "true", stderr: "" }],
];

function fakeExec(map) {
  return (cmd, args) => {
    const key = [cmd, ...args].join(" ");
    for (const [pattern, result] of map) {
      if (key.includes(pattern)) return result;
    }
    return { status: 1, stdout: "", stderr: "unmocked command: " + key, error: null };
  };
}

test("runDoctor: gh CLI missing -> WARN and stops early", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const exec = fakeExec([
      ["gh --version", { status: 1, stdout: "", stderr: "", error: new Error("not found") }],
    ]);
    const results = runDoctor(dir, { exec });
    const ghCheck = results.find((r) => r.name === "gh CLI");
    assert.strictEqual(ghCheck.status, "WARN");
    assert.ok(!results.some((r) => r.name === "gh 인증"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runDoctor: gh not authenticated -> FAIL and stops before remote checks", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const exec = fakeExec([
      ["gh --version", { status: 0, stdout: "gh version 2.0.0", stderr: "" }],
      ["gh auth status", { status: 1, stdout: "", stderr: "not logged in" }],
    ]);
    const results = runDoctor(dir, { exec });
    assert.strictEqual(results.find((r) => r.name === "gh 인증").status, "FAIL");
    assert.ok(!results.some((r) => r.name === "GitHub 원격"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runDoctor: all checks OK", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  writeFileSync(join(dir, "version.yml"), "version: \"1.0.0\"\n");
  try {
    const exec = fakeExec([
      ["gh --version", { status: 0, stdout: "gh version 2.0.0", stderr: "" }],
      ["gh auth status", { status: 0, stdout: "Logged in", stderr: "" }],
      ["git -C", { status: 0, stdout: "https://github.com/acme/widgets.git\n", stderr: "" }],
      ["actions/permissions/workflow", { status: 0, stdout: "write", stderr: "" }],
      ["secret list", { status: 0, stdout: "WORKFLOW_PAT\tUpdated 2026-01-01\n", stderr: "" }],
      [".allow_merge_commit", { status: 0, stdout: "true", stderr: "" }],
    ]);
    const results = runDoctor(dir, { exec });
    assert.strictEqual(results.find((r) => r.name === "설치 여부").status, "OK");
    assert.strictEqual(results.find((r) => r.name === "Workflow permissions").status, "OK");
    assert.strictEqual(results.find((r) => r.name === "WORKFLOW_PAT secret").status, "OK");
    assert.strictEqual(results.find((r) => r.name === "automerge 호환성(merge commit 허용)").status, "OK");
    assert.strictEqual(results.find((r) => r.name === "GitHub Models 활성화").status, "INFO");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runDoctor: missing WORKFLOW_PAT -> INFO (폴백이 자동 복구), non-write permissions -> INFO, merge commit 꺼짐 -> WARN", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const exec = fakeExec([
      ["gh --version", { status: 0, stdout: "gh version 2.0.0", stderr: "" }],
      ["gh auth status", { status: 0, stdout: "Logged in", stderr: "" }],
      ["git -C", { status: 0, stdout: "git@github.com:acme/widgets.git\n", stderr: "" }],
      ["actions/permissions/workflow", { status: 0, stdout: "read", stderr: "" }],
      ["secret list", { status: 0, stdout: "AI_API_KEY\tUpdated 2026-01-01\n", stderr: "" }],
      [".allow_merge_commit", { status: 0, stdout: "false", stderr: "" }],
    ]);
    const results = runDoctor(dir, { exec });
    // Workflow permissions는 read여도 조치가 불필요하므로 INFO다 (#34).
    assert.strictEqual(results.find((r) => r.name === "Workflow permissions").status, "INFO");
    // WORKFLOW_PAT 미등록도 폴백이 자동 복구하므로 조치가 필요 없다 — INFO다 (#105).
    const pat = results.find((r) => r.name === "WORKFLOW_PAT secret");
    assert.strictEqual(pat.status, "INFO");
    assert.ok(pat.note?.some((l) => l.includes("bot") || l.includes("machine")), "bot/machine 계정 권장 문구가 없습니다");
    assert.strictEqual(pat.doc, undefined, "INFO 항목은 doc 링크를 달지 않는다");
    assert.strictEqual(results.find((r) => r.name === "automerge 호환성(merge commit 허용)").status, "WARN");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runDoctor: no git remote -> WARN and stops before repo-scoped checks", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const exec = fakeExec([
      ["gh --version", { status: 0, stdout: "gh version 2.0.0", stderr: "" }],
      ["gh auth status", { status: 0, stdout: "Logged in", stderr: "" }],
      ["git -C", { status: 1, stdout: "", stderr: "fatal: no such remote" }],
    ]);
    const results = runDoctor(dir, { exec });
    assert.strictEqual(results.find((r) => r.name === "GitHub 원격").status, "WARN");
    assert.ok(!results.some((r) => r.name === "Workflow permissions"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- 이슈 #29: 출력 재설계 회귀 가드 --------------------------------------------------

// doctor는 설치 "전에" 돌려보는 것이 정상 사용 경로다 — 미설치를 경고로 띄우면 안 된다.
test("runDoctor: 미설치는 경고가 아니라 INFO다", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const results = runDoctor(dir, { exec: fakeExec(ALL_OK_EXEC) });
    assert.strictEqual(results.find((r) => r.name === "설치 여부").status, "INFO");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// 항목 이름만으로는 그게 무엇을 위한 설정인지 알 수 없다는 것이 이슈 #29의 핵심 불만이었다.
test("runDoctor: 모든 항목이 용도(purpose)를 가진다", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const results = runDoctor(dir, { exec: fakeExec(ALL_OK_EXEC) });
    for (const r of results) {
      assert.ok(r.purpose && r.purpose.length > 0, `${r.name}에 purpose가 없습니다`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// 문제 항목은 조치 단계와 문서 링크를 반드시 동반해야 한다(스펙 §3.3② "해결 가이드 링크").
test("runDoctor: 문제 항목은 영향·조치·문서 링크를 함께 제공한다", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const exec = fakeExec([
      ...ALL_OK_EXEC.filter(([k]) => !k.includes("actions/permissions/workflow") && !k.includes(".allow_merge_commit")),
      ["actions/permissions/workflow", { status: 1, stdout: "", stderr: "not found" }],
      [".allow_merge_commit", { status: 0, stdout: "false", stderr: "" }],
    ]);
    const problems = runDoctor(dir, { exec }).filter((r) => r.status === "WARN" || r.status === "FAIL");
    assert.ok(problems.length >= 2);
    for (const r of problems) {
      assert.ok(r.impact?.length, `${r.name}에 영향 설명이 없습니다`);
      assert.ok(r.actions?.length, `${r.name}에 조치 단계가 없습니다`);
    }
    // WORKFLOW_PAT은 #105에서 INFO로 내려갔으므로 문제 항목 표본에 없다 — 실제 조치가
    // 필요한 항목(automerge 호환성)으로 doc 링크 존재를 검증한다.
    const automerge = problems.find((r) => r.name === "automerge 호환성(merge commit 허용)");
    assert.strictEqual(automerge.doc, DOC.postInstall);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// 출력에서 링크하는 README 앵커가 실제로 README에 존재해야 한다(링크 부패 방지).
test("DOC 링크가 가리키는 앵커가 README에 실제로 존재한다", () => {
  const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf8");
  for (const url of Object.values(DOC)) {
    const anchor = url.split("#")[1];
    assert.ok(readme.includes(`<a id="${anchor}">`), `README에 #${anchor} 앵커가 없습니다`);
  }
});

test("printDoctorReport: 문제 항목은 현상·영향·조치·문서 순으로 펼쳐진다", () => {
  const output = render([{
    name: "Workflow permissions", purpose: "버전 커밋 자동 push", status: "WARN",
    value: "현재 read 입니다.",
    impact: ["릴리스가 중단됩니다."],
    actions: ["레포 Settings → Actions → General", '"Read and write permissions" 선택'],
    doc: DOC.postInstall,
  }]);
  assert.ok(output.includes("[!] Workflow permissions — 버전 커밋 자동 push"));
  const iValue = output.indexOf("현재 read 입니다.");
  const iImpact = output.indexOf("릴리스가 중단됩니다.");
  const iAction = output.indexOf("레포 Settings");
  const iDoc = output.indexOf("자세히:");
  assert.ok(iValue < iImpact && iImpact < iAction && iAction < iDoc, "현상→영향→조치→문서 순서가 아닙니다");
  assert.ok(output.includes(DOC.postInstall));
});

test("printDoctorReport: 정상 항목은 한 줄로 압축된다", () => {
  const output = render([
    { name: "gh CLI", purpose: "레포 설정 조회용", status: "OK", value: "gh version 2.96.0" },
  ]);
  const line = output.split("\n").find((l) => l.includes("gh CLI"));
  assert.ok(line.includes("[✓]"));
  assert.ok(line.includes("레포 설정 조회용"));
  assert.ok(line.includes("gh version 2.96.0"));
});

// 도구가 "설치해도 된다/안 된다"를 판정하지 않고 발견한 사실만 말하는지 고정한다.
test("printDoctorReport: 요약은 판정 대신 문제 개수를 말한다", () => {
  const clean = render([{ name: "gh CLI", purpose: "레포 설정 조회용", status: "OK", value: "설치됨" }]);
  assert.ok(clean.includes("문제를 찾지 못했습니다"));

  const warned = render([
    { name: "A", purpose: "가", status: "WARN", value: "x", impact: ["y"], actions: ["z"] },
    { name: "B", purpose: "나", status: "WARN", value: "x", impact: ["y"], actions: ["z"] },
  ]);
  assert.ok(warned.includes("2개 항목에서 문제를 찾았습니다"));
  assert.ok(warned.includes("나중에 설정해도 됩니다"));

  const failed = render([{ name: "gh 인증", purpose: "권한", status: "FAIL", value: "x", impact: ["y"], actions: ["z"] }]);
  assert.ok(failed.includes("일부 점검은 실행하지 못했습니다"));
});

test("printDoctorReport: color=false면 ESC 바이트가 섞이지 않는다", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const output = render(runDoctor(dir, { exec: fakeExec(ALL_OK_EXEC) }), { color: false });
    assert.ok(!output.includes("\x1b["));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- 이슈 #34: Workflow permissions 오진 수정 -----------------------------------------

// 마법사 워크플로우는 자체 permissions 선언으로 동작하므로 레포 기본값이 read여도 문제가 아니다.
// 조치가 필요 없는 항목에 WARN을 붙이면 없는 장애를 알리고 불필요한 권한 상향을 유도한다.
test("runDoctor: Workflow permissions가 read여도 경고가 아니라 INFO다", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const exec = fakeExec([
      ...ALL_OK_EXEC.filter(([k]) => !k.includes("permissions/workflow")),
      ["actions/permissions/workflow", { status: 0, stdout: "read", stderr: "" }],
    ]);
    const perm = runDoctor(dir, { exec }).find((r) => r.name === "Workflow permissions");
    assert.strictEqual(perm.status, "INFO");
    assert.ok(perm.note?.length, "INFO 항목에는 note가 있어야 합니다");
    assert.ok(perm.note.join(" ").includes("read"), "현재값이 안내에 남아 있어야 합니다");
    assert.ok(!perm.impact, "조치가 불필요하므로 impact를 붙이지 않는다");
    assert.ok(!perm.actions?.length, "조치가 불필요하므로 actions를 붙이지 않는다");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// "릴리스가 중단된다"는 거짓 진술이므로 어떤 경로에서도 나오면 안 된다.
test("runDoctor: Workflow permissions 안내에 릴리스 중단 표현을 쓰지 않는다", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const exec = fakeExec([
      ...ALL_OK_EXEC.filter(([k]) => !k.includes("permissions/workflow")),
      ["actions/permissions/workflow", { status: 0, stdout: "read", stderr: "" }],
    ]);
    const perm = runDoctor(dir, { exec }).find((r) => r.name === "Workflow permissions");
    const all = [perm.value, ...(perm.note || []), ...(perm.impact || [])].filter(Boolean).join(" ");
    assert.ok(!all.includes("중단"), `거짓 진술이 남아 있습니다: ${all}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// 조회 자체가 실패한 경우는 오진이 아니라 실제로 정보를 얻지 못한 상태다 — WARN 유지.
test("runDoctor: Workflow permissions 조회 실패는 WARN을 유지한다", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const exec = fakeExec([
      ...ALL_OK_EXEC.filter(([k]) => !k.includes("permissions/workflow")),
      ["actions/permissions/workflow", { status: 1, stdout: "", stderr: "forbidden" }],
    ]);
    const perm = runDoctor(dir, { exec }).find((r) => r.name === "Workflow permissions");
    assert.strictEqual(perm.status, "WARN");
    assert.ok(perm.actions?.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
