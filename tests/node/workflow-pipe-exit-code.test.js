// tests/node/workflow-pipe-exit-code.test.js
// `cmd | tee log` 다음 줄의 `$?`는 cmd가 아니라 마지막 명령(tee)의 종료 코드라 실패가 성공으로 보고된다.
// 파이프 직후 `$?`로 종료 코드를 읽는 워크플로우가 없는지 고정한다 (PIPESTATUS 또는 pipefail을 써야 한다).
import { test } from "node:test";
import assert from "node:assert";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

function listWorkflows(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listWorkflows(p));
    else if (/\.ya?ml$/.test(entry.name)) out.push(p);
  }
  return out;
}

// `||`가 아닌 단일 파이프가 있는 줄
const PIPE = /(^|[^|])\|(?!\|)/;

// 파이프 줄 바로 다음 명령 줄이 `$?`를 읽는데, 같은 run 블록 앞쪽에 pipefail이 없으면 위반
function findPipeExitCodeReads(text) {
  const lines = text.split(/\r?\n/);
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("#") || !PIPE.test(line) || line.startsWith("run: |")) continue;
    let j = i + 1;
    while (j < lines.length && (lines[j].trim() === "" || lines[j].trim().startsWith("#"))) j++;
    if (j >= lines.length || !/\$\?/.test(lines[j])) continue;
    const before = lines.slice(Math.max(0, i - 30), i).join("\n");
    if (/set -[a-z]*o pipefail/.test(before)) continue;
    hits.push(`${i + 1}: ${line}`);
  }
  return hits;
}

test("탐지기: tee 파이프 직후 $?는 잡고 PIPESTATUS·pipefail은 통과시킨다", () => {
  assert.equal(findPipeExitCodeReads("./gradlew test 2>&1 | tee out.txt\necho \"rc=$?\"").length, 1);
  assert.equal(findPipeExitCodeReads("./gradlew test | tee out.txt\n# 주석\necho \"rc=$?\"").length, 1);
  assert.equal(findPipeExitCodeReads("./gradlew test | tee out.txt\necho \"rc=${PIPESTATUS[0]}\"").length, 0);
  assert.equal(findPipeExitCodeReads("set -o pipefail\n./gradlew test | tee out.txt\necho \"rc=$?\"").length, 0);
  assert.equal(findPipeExitCodeReads("a || b\necho $?").length, 0);
});

test("payload·레포 워크플로우: 파이프 직후 $?로 종료 코드를 읽지 않는다", () => {
  const files = [
    ...listWorkflows(join(ROOT, "payload", "workflows")),
    ...listWorkflows(join(ROOT, ".github", "workflows")),
  ];
  assert.ok(files.length > 0, "워크플로우 파일을 찾지 못함");
  const violations = [];
  for (const file of files) {
    for (const hit of findPipeExitCodeReads(readFileSync(file, "utf8"))) {
      violations.push(`${file.slice(ROOT.length)}:${hit}`);
    }
  }
  assert.deepStrictEqual(violations, [], "파이프 뒤 $?는 마지막 명령의 종료 코드다 — PIPESTATUS[0]을 쓴다");
});
