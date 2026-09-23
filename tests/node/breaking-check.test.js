// Task 7 — breaking-check.js 테스트 커버리지 공백 보강.
// runBreakingCheck(loader 주입)으로 실제 collectBreaking(breaking.js) 조합 동작을 검증한다.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runBreakingCheck } from "../../src/core/breaking-check.js";
import { collectBreaking } from "../../src/core/breaking.js";

function makeRepo(templateVersion) {
  const dir = mkdtempSync(join(tmpdir(), "paw-bc-"));
  writeFileSync(
    join(dir, "version.yml"),
    `version: "1.0.0"\nmetadata:\n  template:\n    version: "${templateVersion}"\n`,
  );
  return dir;
}

test("no version.yml -> proceeds without loading breaking json", async () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-bc-empty-"));
  try {
    let loaderCalled = false;
    const proceed = await runBreakingCheck({
      cwd: dir, payloadRoot: "unused", templateVersion: "0.2.0",
      loader: async () => { loaderCalled = true; return {}; },
    });
    assert.strictEqual(proceed, true);
    assert.strictEqual(loaderCalled, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loader returns null -> proceeds (network/bundle both failed)", async () => {
  const dir = makeRepo("0.1.0");
  try {
    const proceed = await runBreakingCheck({
      cwd: dir, payloadRoot: "unused", templateVersion: "0.2.0",
      loader: async () => null,
    });
    assert.strictEqual(proceed, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no critical/warning entries for the version range -> proceeds silently", async () => {
  const dir = makeRepo("0.1.0");
  try {
    const proceed = await runBreakingCheck({
      cwd: dir, payloadRoot: "unused", templateVersion: "0.2.0",
      loader: async () => ({}),
    });
    assert.strictEqual(proceed, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("critical entry + non-interactive (askYesNo omitted) -> warns and proceeds", async () => {
  const dir = makeRepo("0.1.0");
  try {
    const json = {
      "0.2.0": { severity: "critical", title: "워크플로우 파일명 변경", message: "PROJECT-COMMON-X.yaml -> Y.yaml" },
    };
    const proceed = await runBreakingCheck({
      cwd: dir, payloadRoot: "unused", templateVersion: "0.2.0",
      loader: async () => json,
    });
    assert.strictEqual(proceed, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("critical entry + interactive confirm=false -> cancels", async () => {
  const dir = makeRepo("0.1.0");
  try {
    const json = {
      "0.2.0": { severity: "critical", title: "t", message: "m" },
    };
    const proceed = await runBreakingCheck({
      cwd: dir, payloadRoot: "unused", templateVersion: "0.2.0",
      loader: async () => json,
      askYesNo: async () => false,
    });
    assert.strictEqual(proceed, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("critical entry + interactive confirm=true -> proceeds", async () => {
  const dir = makeRepo("0.1.0");
  try {
    const json = {
      "0.2.0": { severity: "critical", title: "t", message: "m" },
    };
    const proceed = await runBreakingCheck({
      cwd: dir, payloadRoot: "unused", templateVersion: "0.2.0",
      loader: async () => json,
      askYesNo: async () => true,
    });
    assert.strictEqual(proceed, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 이슈 #131 고지 4건 ───────────────────────────────────────────────
const BUNDLED = JSON.parse(readFileSync(new URL("../../payload/config/breaking-changes.json", import.meta.url), "utf8"));

test("collectBreaking: 같은 버전 키의 값이 배열이면 항목마다 별도 레코드로 펼친다", () => {
  const json = {
    "0.2.0": [
      { severity: "warning", title: "a", message: "m1" },
      { severity: "critical", title: "b", message: "m2" },
    ],
    "0.3.0": { severity: "warning", title: "c", message: "m3" },
    _meta: { severity: "critical", title: "무시" },
  };
  const { critical, warnings } = collectBreaking(json, "0.1.0", "0.3.0");
  assert.deepStrictEqual(critical.map((r) => r.title), ["b"]);
  assert.deepStrictEqual(warnings.map((r) => r.title), ["a", "c"]);
  assert.ok(critical.concat(warnings).every((r) => typeof r.version === "string"));
});

test("번들 breaking-changes.json: 0.10.0에서 0.10.1 이상으로 올라가면 warning 4건이 나온다 (다음 릴리스 번호와 무관)", () => {
  for (const target of ["0.10.1", "0.11.0", "1.0.0"]) {
    const { critical, warnings } = collectBreaking(BUNDLED, "0.10.0", target);
    assert.strictEqual(critical.length, 0, `${target}: critical 없음`);
    assert.strictEqual(warnings.length, 4, `${target}: warning 4건`);
    for (const w of warnings) {
      assert.strictEqual(w.severity, "warning");
      assert.ok(w.title && !w.title.includes("\n"), "제목은 한 줄");
      assert.ok(w.message && !w.message.includes("\n"), "박스에 그대로 찍히므로 메시지는 한 줄");
    }
  }
});

test("번들 breaking-changes.json: 4건은 SELFHOSTED·TEST-APK fastlane 제거 / dart-define 기본값 / FLUTTER_PROJECT_DIR / ci-gate를 각각 알린다", () => {
  const { warnings } = collectBreaking(BUNDLED, "0.10.0", "0.10.1");
  const text = warnings.map((w) => `${w.title} ${w.message}`);
  for (const keyword of ["fastlane build", "dart-define", "FLUTTER_PROJECT_DIR", "ci-gate"]) {
    assert.strictEqual(text.filter((t) => t.includes(keyword)).length >= 1, true, `${keyword} 고지가 있어야 한다`);
  }
  assert.ok(text.some((t) => t.includes("SELFHOSTED") && t.includes("TEST-APK")));
  assert.ok(text.some((t) => t.includes("dotenv")), "기존 설치는 dotenv 유지라는 안내");
  assert.ok(text.some((t) => t.includes("--paths flutter=")), "모노레포 경로 지정 안내");
});

test("번들 breaking-changes.json: 이미 0.10.1 이상이거나 아직 0.10.0까지만 올라가는 경우는 표시하지 않는다", () => {
  assert.deepStrictEqual(collectBreaking(BUNDLED, "0.10.1", "0.11.0"), { critical: [], warnings: [] });
  assert.deepStrictEqual(collectBreaking(BUNDLED, "0.9.0", "0.10.0"), { critical: [], warnings: [] });
});

test("runBreakingCheck: 번들 고지 4건은 모두 warning이라 대화형 확인 없이 진행하고 stderr 박스에 4건이 표시된다", async () => {
  const dir = makeRepo("0.10.0");
  const originalWrite = process.stderr.write.bind(process.stderr);
  let stderr = "";
  process.stderr.write = (chunk) => { stderr += chunk; return true; };
  try {
    const proceed = await runBreakingCheck({
      cwd: dir, payloadRoot: "unused", templateVersion: "0.10.1",
      loader: async () => BUNDLED,
      askYesNo: async () => { throw new Error("warning만 있으면 확인 질문이 나오면 안 된다"); },
    });
    assert.strictEqual(proceed, true);
    assert.strictEqual((stderr.match(/\[WARNING\] 0\.10\.1 - /g) || []).length, 4);
    assert.ok(stderr.includes("BREAKING CHANGES (v0.10.0 → v0.10.1)"));
  } finally {
    process.stderr.write = originalWrite;
    rmSync(dir, { recursive: true, force: true });
  }
});
