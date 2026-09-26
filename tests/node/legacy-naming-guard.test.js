// tests/node/legacy-naming-guard.test.js
// 원작자 종속 이름(suh)이 설치물·소스에 다시 들어오는 것을 막는다.
//
// docs/는 과거 설계 기록이라 검사하지 않고, tests/는 이 가드 자신이 패턴 문자열을 담고 있어 제외한다.
// 주석 줄도 검사한다 — 주석에 남은 예시값도 사용자에게 그대로 설치되기 때문이다.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resolvePayloadRoot } from "../../src/core/assets.js";

const REPO_ROOT = join(resolvePayloadRoot(), "..");
const SCAN_DIRS = ["payload", "src", ".github"];
const LEGACY_NAME = /suh/i;

function allFiles(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) allFiles(path, acc);
    else acc.push(path);
  }
  return acc;
}

test("payload·src·.github에 원작자 종속 이름(suh)이 남아 있지 않다", () => {
  const hits = [];
  for (const dir of SCAN_DIRS) {
    for (const file of allFiles(join(REPO_ROOT, dir))) {
      const rel = file.slice(REPO_ROOT.length + 1);
      if (LEGACY_NAME.test(rel)) hits.push(`${rel} — 파일 경로`);
      readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
        if (LEGACY_NAME.test(line)) hits.push(`${rel}:${i + 1}  ${line.trim()}`);
      });
    }
  }
  assert.deepStrictEqual(hits, [], `종속 이름이 남아 있습니다:\n  ${hits.join("\n  ")}`);
});
