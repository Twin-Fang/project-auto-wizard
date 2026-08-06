// tests/node/payload-workflow-permissions.test.js
// doctor(#34)가 Workflow permissions를 INFO로 낮출 수 있는 근거를 고정한다.
// 레포의 default_workflow_permissions가 read여도 마법사 워크플로우가 정상 동작하는 이유는
// 각 워크플로우가 자체 permissions를 선언하기 때문이다 — 이 전제가 깨지면 doctor 문구도 거짓이 된다.
import { test } from "node:test";
import assert from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const COMMON_DIR = join(REPO_ROOT, "payload", "workflows", "common");

test("payload 공통 워크플로우는 모두 permissions를 명시한다", () => {
  const files = readdirSync(COMMON_DIR).filter((n) => n.endsWith(".yaml") || n.endsWith(".yml"));
  assert.ok(files.length > 0, "payload/workflows/common에 워크플로우가 없습니다");
  for (const f of files) {
    const text = readFileSync(join(COMMON_DIR, f), "utf8");
    assert.match(text, /^permissions:/m, `${f}에 최상위 permissions 선언이 없습니다`);
  }
});

// 커밋·push를 수행하는 워크플로우는 contents: write가 반드시 있어야 한다.
test("커밋을 push하는 공통 워크플로우는 contents: write를 선언한다", () => {
  const NEEDS_WRITE = [
    "PROJECT-COMMON-VERSION-CONTROL.yaml",
    "PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml",
    "PROJECT-COMMON-README-VERSION-UPDATE.yaml",
    "PROJECT-COMMON-RELEASE-PUBLISH.yaml",
  ];
  for (const f of NEEDS_WRITE) {
    const text = readFileSync(join(COMMON_DIR, f), "utf8");
    assert.match(text, /^permissions:[\s\S]*?^\s+contents:\s*write/m, `${f}에 contents: write가 없습니다`);
  }
});
