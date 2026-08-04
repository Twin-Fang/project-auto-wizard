// tests/node/semver-auto-cli.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "../../src/cli/args.js";
import { run } from "../../src/index.js";
import { parseTemplateOptions } from "../../src/core/version-yml.js";

test("parseArgs: --semver-auto sets includeSemverAuto=true", () => {
  const opts = parseArgs(["--mode", "full", "--force", "--type", "node", "--semver-auto"]);
  assert.strictEqual(opts.includeSemverAuto, true);
});

test("parseArgs: --no-semver-auto sets includeSemverAuto=false", () => {
  const opts = parseArgs(["--mode", "full", "--force", "--type", "node", "--no-semver-auto"]);
  assert.strictEqual(opts.includeSemverAuto, false);
});

test("parseArgs: omitted defaults to null (resolved to true downstream)", () => {
  const opts = parseArgs(["--mode", "full", "--force", "--type", "node"]);
  assert.strictEqual(opts.includeSemverAuto, null);
});

test("run(): --no-semver-auto propagates to installed version.yml", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-semver-cli-"));
  writeFileSync(join(target, "package.json"), "{}\n"); // M4: 경로 후보 0개 방지용 루트 마커
  try {
    await run(
      ["--mode", "full", "--force", "--type", "node", "--no-semver-auto"],
      { cwd: target, clock: { now: "2026-07-28 00:00:00", today: "2026-07-28" } },
    );
    const opts = parseTemplateOptions(readFileSync(join(target, "version.yml"), "utf8"));
    assert.strictEqual(opts.semverAuto, false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): omitted flag defaults to semver_auto: true", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-semver-cli-"));
  writeFileSync(join(target, "package.json"), "{}\n"); // M4: 경로 후보 0개 방지용 루트 마커
  try {
    await run(
      ["--mode", "full", "--force", "--type", "node"],
      { cwd: target, clock: { now: "2026-07-28 00:00:00", today: "2026-07-28" } },
    );
    const opts = parseTemplateOptions(readFileSync(join(target, "version.yml"), "utf8"));
    assert.strictEqual(opts.semverAuto, true);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): re-installing over a version.yml predating semver_auto (no key) safely defaults to false, not true", async () => {
  // 기존 설치(semver_auto 기능 이전에 만들어진 version.yml)를 CLI로 재통합하면,
  // 애매한 커밋 하나로 조용히 major가 승격되지 않도록 false로 안전하게 폴백해야 한다
  // (완전 신규 설치만 true — 아래 "omitted flag defaults to semver_auto: true"와 대비).
  const target = mkdtempSync(join(tmpdir(), "paw-semver-cli-"));
  writeFileSync(join(target, "package.json"), "{}\n"); // M4: 경로 후보 0개 방지용 루트 마커
  try {
    await run(
      ["--mode", "full", "--force", "--type", "node"],
      { cwd: target, clock: { now: "2026-07-28 00:00:00", today: "2026-07-28" } },
    );
    const vyPath = join(target, "version.yml");
    const stripped = readFileSync(vyPath, "utf8")
      .split("\n")
      .filter((l) => !/^\s+semver_auto:/.test(l))
      .join("\n");
    writeFileSync(vyPath, stripped);
    assert.strictEqual(parseTemplateOptions(stripped).semverAuto, null, "fixture setup: key must be absent");

    // 재실행 — --semver-auto/--no-semver-auto 둘 다 지정하지 않음(사용자가 명시적으로
    // opt-in하지 않은 상태). existing이 있으므로 false로 폴백해야 한다.
    const code = await run(
      ["--mode", "full", "--force", "--type", "node"],
      { cwd: target, clock: { now: "2026-07-28 00:00:00", today: "2026-07-28" } },
    );
    assert.strictEqual(code, 0);
    const optsAfter = parseTemplateOptions(readFileSync(vyPath, "utf8"));
    assert.strictEqual(optsAfter.semverAuto, false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
