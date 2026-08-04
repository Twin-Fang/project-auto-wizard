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
    await assert.rejects(
      () => resolveProjectPaths({
        root, types: ["flutter"], paths: new Map(),
        existingPaths: new Map(), force: true, tty: false, io: {},
      }),
      CliError,
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
    await assert.rejects(
      () => resolveProjectPaths({
        root, types: ["react"], paths: new Map(),
        existingPaths: new Map(), force: true, tty: false, io: {},
      }),
      CliError,
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
