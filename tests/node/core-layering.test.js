// tests/node/core-layering.test.js
// core는 설치 로직의 바닥 계층이다 — cli·ui·commands를 참조하면 순환 의존이 생기고,
// 다른 진입점(대화형·테스트)에서 core만 가져다 쓸 수 없게 된다.
// cli/args.js가 CliError·경로 유틸을 다시 내보내는 호환 경로도 같은 객체를 가리켜야 한다.
import { test } from "node:test";
import assert from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as args from "../../src/cli/args.js";
import { CliError } from "../../src/core/errors.js";
import { normalizePath, isRepoRelativePath } from "../../src/core/paths.js";

const coreDir = join(dirname(fileURLToPath(import.meta.url)), "../../src/core");

test("src/core는 cli·ui·commands 모듈을 import하지 않는다", () => {
  const offenders = [];
  for (const rel of readdirSync(coreDir, { recursive: true })) {
    if (!rel.endsWith(".js")) continue;
    const text = readFileSync(join(coreDir, rel), "utf8");
    for (const m of text.matchAll(/from\s+["']([^"']+)["']/g)) {
      if (/(^|\/)(cli|ui|commands)\//.test(m[1])) offenders.push(`${rel} → ${m[1]}`);
    }
  }
  assert.deepStrictEqual(offenders, []);
});

test("cli/args.js의 CliError·경로 유틸은 core 정의와 같은 객체다", () => {
  assert.strictEqual(args.CliError, CliError);
  assert.strictEqual(args.normalizePath, normalizePath);
  assert.strictEqual(args.isRepoRelativePath, isRepoRelativePath);
  assert.ok(new args.CliError("x") instanceof CliError);
});
