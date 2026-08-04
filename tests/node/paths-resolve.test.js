import { test } from "node:test";
import assert from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "../../src/index.js";
import { CliError } from "../../src/cli/args.js";
import { resolveProjectPaths } from "../../src/core/paths-resolve.js";

function tmpRepo(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(dir, ".git"));
  return dir;
}

// ── Task 4: resolveProjectPaths() 호출부 CliError 캐치 ──────────────
test("run(): --paths에 지원하지 않는 타입을 지정하면 스택트레이스 없이 exit 1로 깔끔하게 거부된다", async () => {
  const target = tmpRepo("paw-paths-resolve-");
  try {
    const code = await run(
      ["--mode", "full", "--force", "--type", "node", "--paths", "not-a-type=."],
      { cwd: target, clock: { now: "2026-08-04 00:00:00", today: "2026-08-04" } },
    );
    assert.strictEqual(code, 1);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// ── M3: --paths로 지정한 경로의 존재 여부 검증 ──────────────────────
test("resolveProjectPaths: --paths로 지정한 경로가 존재하지 않으면 CliError로 거부한다", async () => {
  const root = mkdtempSync(join(tmpdir(), "paw-paths-resolve-"));
  try {
    await assert.rejects(
      () => resolveProjectPaths({
        root, types: ["react"],
        paths: new Map([["react", "does-not-exist"]]),
        existingPaths: new Map(), force: true, tty: false, io: {},
      }),
      CliError,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveProjectPaths: --paths로 지정한 경로가 실제로 존재하면 그대로 확정된다", async () => {
  const root = mkdtempSync(join(tmpdir(), "paw-paths-resolve-"));
  try {
    mkdirSync(join(root, "client"));
    const result = await resolveProjectPaths({
      root, types: ["react"],
      paths: new Map([["react", "client"]]),
      existingPaths: new Map(), force: true, tty: false, io: {},
    });
    assert.strictEqual(result.get("react"), "client");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── M4: 모노레포 경로 후보 0개/2개 이상 구분 거부 ────────────────────
test("resolveProjectPaths: 경로 후보가 0개(감지 실패)면 CliError로 거부한다", async () => {
  const root = mkdtempSync(join(tmpdir(), "paw-paths-resolve-"));
  try {
    // pubspec.yaml은 있지만 lib/가 없어 flutter 후보 필터에서 걸러짐 → 후보 0개
    mkdirSync(join(root, "app"));
    writeFileSync(join(root, "app", "pubspec.yaml"), "name: demo\n");
    // 타입만이 아니라 "찾지 못했습니다" 메시지까지 확인해 2개 이상(모호함) 분기와
    // 뒤섞이지 않는지 검증한다 (에러 타입만 보면 두 분기 메시지를 바꿔도 통과해버림).
    await assert.rejects(
      () => resolveProjectPaths({
        root, types: ["flutter"], paths: new Map(),
        existingPaths: new Map(), force: true, tty: false, io: {},
      }),
      (err) => err instanceof CliError && /찾지 못했습니다/.test(err.message),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveProjectPaths: 경로 후보가 2개 이상(모호함)이면 CliError로 거부한다", async () => {
  const root = mkdtempSync(join(tmpdir(), "paw-paths-resolve-"));
  try {
    mkdirSync(join(root, "client"));
    writeFileSync(join(root, "client", "package.json"), "{}\n");
    mkdirSync(join(root, "admin"));
    writeFileSync(join(root, "admin", "package.json"), "{}\n");
    // "모호합니다" 메시지와 후보 목록(admin, client)까지 포함되는지 확인해 0개(감지 실패)
    // 분기와 뒤섞이지 않는지 검증한다.
    await assert.rejects(
      () => resolveProjectPaths({
        root, types: ["react"], paths: new Map(),
        existingPaths: new Map(), force: true, tty: false, io: {},
      }),
      (err) => err instanceof CliError && /모호합니다.*admin.*client/.test(err.message),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveProjectPaths: 경로 후보가 정확히 1개면 정상적으로 자동 확정된다(회귀 확인)", async () => {
  const root = mkdtempSync(join(tmpdir(), "paw-paths-resolve-"));
  try {
    mkdirSync(join(root, "client"));
    writeFileSync(join(root, "client", "package.json"), "{}\n");
    const result = await resolveProjectPaths({
      root, types: ["react"], paths: new Map(),
      existingPaths: new Map(), force: true, tty: false, io: {},
    });
    assert.strictEqual(result.get("react"), "client");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── 이슈 #21 재현 커맨드 5개 최종 회귀 확인 ──────────────────────────
test("이슈 재현 ①(M3): --paths react=does-not-exist는 exit 1로 거부된다", async () => {
  const target = tmpRepo("paw-issue21-");
  try {
    const code = await run(
      ["--mode", "full", "--force", "--type", "react", "--paths", "react=does-not-exist"],
      { cwd: target, clock: { now: "2026-08-04 00:00:00", today: "2026-08-04" } },
    );
    assert.strictEqual(code, 1);
    assert.strictEqual(existsSync(join(target, "version.yml")), false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("이슈 재현 ②(M4, 후보 0개): flutter인데 lib/ 없이 pubspec.yaml만 있으면 exit 1로 거부된다", async () => {
  const target = tmpRepo("paw-issue21-");
  try {
    mkdirSync(join(target, "app"));
    writeFileSync(join(target, "app", "pubspec.yaml"), "name: demo\n");
    const code = await run(
      ["--mode", "full", "--force", "--type", "flutter"],
      { cwd: target, clock: { now: "2026-08-04 00:00:00", today: "2026-08-04" } },
    );
    assert.strictEqual(code, 1);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("이슈 재현 ②(M4, 후보 2개 이상): react 마커가 있는 디렉터리 2개면 exit 1로 거부된다", async () => {
  const target = tmpRepo("paw-issue21-");
  try {
    mkdirSync(join(target, "client"));
    writeFileSync(join(target, "client", "package.json"), "{}\n");
    mkdirSync(join(target, "admin"));
    writeFileSync(join(target, "admin", "package.json"), "{}\n");
    const code = await run(
      ["--mode", "full", "--force", "--type", "react"],
      { cwd: target, clock: { now: "2026-08-04 00:00:00", today: "2026-08-04" } },
    );
    assert.strictEqual(code, 1);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("이슈 재현 ③(L5): --paths \"re act=.\"는 --type과 동일하게 정규화되어 정상 설치된다", async () => {
  const target = tmpRepo("paw-issue21-");
  try {
    const code = await run(
      ["--mode", "full", "--force", "--type", "react", "--paths", "re act=."],
      { cwd: target, clock: { now: "2026-08-04 00:00:00", today: "2026-08-04" } },
    );
    assert.strictEqual(code, 0);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("이슈 재현 ④(L6): --main-branch \"\"는 exit 1로 거부된다", async () => {
  const target = tmpRepo("paw-issue21-");
  try {
    const code = await run(
      ["--mode", "full", "--force", "--type", "node", "--main-branch", ""],
      { cwd: target, clock: { now: "2026-08-04 00:00:00", today: "2026-08-04" } },
    );
    assert.strictEqual(code, 1);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("이슈 재현 ⑤(L7): --nexus --no-nexus 동시 지정은 exit 1로 거부된다", async () => {
  const target = tmpRepo("paw-issue21-");
  try {
    const code = await run(
      ["--mode", "full", "--force", "--type", "spring", "--nexus", "--no-nexus"],
      { cwd: target, clock: { now: "2026-08-04 00:00:00", today: "2026-08-04" } },
    );
    assert.strictEqual(code, 1);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
