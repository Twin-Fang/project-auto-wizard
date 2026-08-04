// issue #15 회귀 게이트 — 크로스플랫폼 재현성.
//
// 이 레포는 payload/를 바이트 그대로 사용자 레포에 복사한다. Windows에서
// CRLF로 체크아웃되면 설치 산출물이 macOS와 달라지고(설치 재현성 원칙 위반),
// 워크플로우 run 블록이 CR 섞인 셸 스크립트가 되어 런타임에만 조용히 터진다.
// .gitattributes(eol=lf)가 이를 막는데, 그 보호가 벗겨지면 여기서 잡는다.
import { test } from "node:test";
import assert from "node:assert";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { runFull } from "../../src/commands/full.js";

// 줄바꿈 정규화 대상이 아닌 확장자 (.gitattributes의 binary 목록과 대응)
const BINARY_EXT = /\.(png|jpe?g|gif|ico|pdf|zip|tgz|gz|jar|keystore|pyc)$/i;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "__pycache__") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (!BINARY_EXT.test(entry)) out.push(p);
  }
  return out;
}

function crCount(path) {
  const buf = readFileSync(path);
  let n = 0;
  for (const byte of buf) if (byte === 0x0d) n++;
  return n;
}

test(".gitattributes가 존재하고 워킹트리를 LF로 고정한다", () => {
  const p = new URL("../../.gitattributes", import.meta.url);
  assert.ok(existsSync(p), ".gitattributes가 없으면 Windows 체크아웃이 CRLF가 된다");
  const body = readFileSync(p, "utf8");
  assert.match(body, /^\*\s+text=auto\s+eol=lf$/m, "`* text=auto eol=lf` 규칙이 있어야 한다");
});

test("payload/ 텍스트 자산에 CR 바이트가 하나도 없다", () => {
  const offenders = walk(resolvePayloadRoot())
    .filter((p) => crCount(p) > 0)
    .map((p) => `${p} (CR=${crCount(p)})`);
  assert.deepStrictEqual(offenders, [],
    `payload에 CRLF 혼입 — Windows에서 설치하면 macOS와 다른 산출물이 나온다:\n${offenders.join("\n")}`);
});

test("full 설치 산출물(워크플로우·스크립트·version.yml)에 CR 바이트가 없다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-eol-"));
  try {
    runFull(createContext({
      mode: "full", force: true, types: ["node"], version: "1.0.0", versionCode: 1,
      branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
      paths: new Map(),
      now: "2026-08-03 00:00:00", today: "2026-08-03", templateVersion: "0.1.11",
    }), resolvePayloadRoot(), target);

    const installed = [
      ...walk(join(target, ".github", "workflows")),
      ...walk(join(target, ".github", "scripts")),
      join(target, "version.yml"),
    ];
    const offenders = installed
      .filter((p) => crCount(p) > 0)
      .map((p) => `${p} (CR=${crCount(p)})`);
    assert.deepStrictEqual(offenders, [],
      `설치 산출물에 CRLF 혼입:\n${offenders.join("\n")}`);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
