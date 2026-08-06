// tests/node/workflow-action-versions.test.js
// #47: 설치되는 워크플로우가 구버전 GitHub Actions를 쓰면 사용자 레포마다 deprecation 경고가
// 뜬다. 한 번 올려도 시간이 지나면 다시 뒤처지므로, 최소한 다음 둘은 테스트가 잡는다.
//   ① 알려진 하한보다 낮은 메이저를 쓰지 않는다
//   ② 같은 액션이 서로 다른 메이저로 섞이지 않는다 (setup-java가 v3·v4 혼재였다)
import { test } from "node:test";
import assert from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

// 2026-08-06 기준 최신 메이저. 액션을 올릴 때 이 값도 함께 올린다.
const MIN_MAJOR = {
  "actions/checkout": 7,
  "actions/setup-node": 7,
  "actions/setup-python": 7,
  "actions/setup-java": 5,
  "actions/cache": 6,
  "actions/upload-artifact": 7,
  "actions/download-artifact": 8,
  "actions/github-script": 9,
};

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : (/\.ya?ml$/.test(e.name) ? [p] : []);
  });
}

// payload(사용자에게 배포됨) + 이 레포의 워크플로우(도그푸딩 사본 포함) 전부를 대상으로 한다.
function allWorkflows() {
  return [...walk(join(REPO_ROOT, "payload", "workflows")), ...walk(join(REPO_ROOT, ".github", "workflows"))];
}

// "uses: actions/checkout@v7" → { action: "actions/checkout", major: 7 }
function usedActions(text) {
  const out = [];
  for (const m of text.matchAll(/uses:\s*(actions\/[a-z0-9-]+)@v(\d+)/g)) {
    out.push({ action: m[1], major: Number(m[2]) });
  }
  return out;
}

test("워크플로우가 하한보다 낮은 메이저 버전의 액션을 쓰지 않는다", () => {
  const stale = [];
  for (const file of allWorkflows()) {
    for (const { action, major } of usedActions(readFileSync(file, "utf8"))) {
      const min = MIN_MAJOR[action];
      if (min !== undefined && major < min) {
        stale.push(`${file.slice(REPO_ROOT.length)}: ${action}@v${major} (하한 v${min})`);
      }
    }
  }
  assert.deepStrictEqual(stale, [], `구버전 액션이 남아 있습니다:\n  ${stale.join("\n  ")}`);
});

test("같은 액션이 서로 다른 메이저 버전으로 섞이지 않는다", () => {
  const seen = new Map();
  for (const file of allWorkflows()) {
    for (const { action, major } of usedActions(readFileSync(file, "utf8"))) {
      if (!seen.has(action)) seen.set(action, new Set());
      seen.get(action).add(major);
    }
  }
  const mixed = [...seen.entries()]
    .filter(([, majors]) => majors.size > 1)
    .map(([action, majors]) => `${action}: v${[...majors].sort().join(", v")}`);
  assert.deepStrictEqual(mixed, [], `버전이 섞인 액션이 있습니다:\n  ${mixed.join("\n  ")}`);
});
