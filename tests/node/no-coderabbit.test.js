// issue #8 회귀 게이트 — 상용 SaaS(CodeRabbit) 연동이 되살아나지 않는지 감시한다.
// 오픈소스 대회 제출 조건상 설치 산출물·마법사 코드 어디에도 상용 서비스 연동이 있으면 안 된다.
import { test } from "node:test";
import assert from "node:assert";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { runFull } from "../../src/commands/full.js";
import { parseArgs, CliError } from "../../src/cli/args.js";
import { parseTemplateOptions } from "../../src/core/version-yml.js";

const NEEDLE = /coderabbit/i;

function baseContext(extra = {}) {
  return createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(),
    now: "2026-08-03 00:00:00", today: "2026-08-03", templateVersion: "0.1.11",
    ...extra,
  });
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

test("payload/ 자산 어디에도 coderabbit 문자열이 없다", () => {
  const payloadRoot = resolvePayloadRoot();
  const offenders = walk(payloadRoot).filter((p) => NEEDLE.test(readFileSync(p, "utf8")));
  assert.deepStrictEqual(offenders, [], `payload에 CodeRabbit 잔존: ${offenders.join(", ")}`);
});

test("payload/coderabbit.yaml 자산 자체가 존재하지 않는다", () => {
  assert.ok(!existsSync(join(resolvePayloadRoot(), "coderabbit.yaml")));
});

test("full 설치 산출물에 .coderabbit.yaml이 없고 version.yml에 coderabbit 키가 없다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-no-crk-"));
  try {
    runFull(baseContext(), resolvePayloadRoot(), target);

    assert.ok(!existsSync(join(target, ".coderabbit.yaml")), ".coderabbit.yaml이 설치되면 안 된다");
    assert.ok(!NEEDLE.test(readFileSync(join(target, "version.yml"), "utf8")),
      "version.yml에 coderabbit 키가 남으면 안 된다");

    const wfDir = join(target, ".github", "workflows");
    for (const f of readdirSync(wfDir)) {
      assert.ok(!NEEDLE.test(readFileSync(join(wfDir, f), "utf8")), `${f}에 coderabbit 잔존`);
    }
    const scriptsDir = join(target, ".github", "scripts");
    for (const f of readdirSync(scriptsDir)) {
      assert.ok(!NEEDLE.test(readFileSync(join(scriptsDir, f), "utf8")), `${f}에 coderabbit 잔존`);
    }
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("--coderabbit / --no-coderabbit / --keep-coderabbit 플래그는 더 이상 받지 않는다", () => {
  for (const flag of ["--coderabbit", "--no-coderabbit", "--keep-coderabbit"]) {
    assert.throws(() => parseArgs([flag]), CliError, `${flag}는 거부되어야 한다`);
  }
});

test("구 version.yml에 남은 coderabbit 키는 파싱 에러 없이 무시된다", () => {
  // 하위호환: 이전 버전 마법사가 설치한 레포를 재실행해도 죽지 않아야 한다.
  const legacy = [
    "metadata:",
    "  template:",
    "    options:",
    "      nexus: true",
    "      secret_backup: false",
    "      coderabbit: true",
    "      semver_auto: true",
  ].join("\n");

  const parsed = parseTemplateOptions(legacy);
  assert.strictEqual(parsed.nexus, true);
  assert.strictEqual(parsed.secretBackup, false);
  assert.strictEqual(parsed.semverAuto, true, "coderabbit 키 뒤의 semver_auto도 정상 파싱되어야 한다");
  assert.ok(!("coderabbit" in parsed), "coderabbit은 파싱 결과에 남으면 안 된다");
});
