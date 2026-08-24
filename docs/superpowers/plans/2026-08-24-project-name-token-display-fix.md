# PROJECT_NAME Token Display Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the wizard's env-plan prompt cards, input-confirmation echo, completion summary, and install log show the real project name instead of the raw `__PROJECT_NAME__`/`__APP_ARTIFACT_NAME__` placeholder when an `@wizard ask` marker's literal default has that token embedded in it.

**Architecture:** Extract the existing global-token replacement logic that `substituteEnv()` already applies to installed file content into a small shared function in `src/core/wizard-env.js`, then call that same function from `collectAsks()` in `src/ui/env-plan.js` when it computes each ask key's display default. This makes the CLI's displayed defaults and the actually-installed file content derive from one shared implementation instead of two independent ones.

**Tech Stack:** Node.js (`node:test` for tests), no new dependencies.

**Spec:** GitHub issue #110 (https://github.com/Twin-Fang/project-auto-wizard/issues/110) — no separate design doc; the in-chat design approved during brainstorming is the spec for this bounded fix.

## Global Constraints

- Do not change `substituteEnv()`'s external behavior — the refactor must be a pure extraction (same output for the same input).
- Do not add a new parameter to `collectAsks()`/`promptEnvPlan()` — resolve the repo name via the `resolvers` object already passed in (`resolveToken("repo", type, resolvers)`), matching exactly what `substituteEnv()` uses today.
- Keep the fix scoped to `src/core/wizard-env.js` and `src/ui/env-plan.js` plus their tests — do not touch `src/ui/summary.js` or any payload template; they already consume the corrected values once the source (`collectAsks`) is fixed.
- All 480 existing `npm run test:node` tests must keep passing.

---

### Task 1: Extract `replaceProjectTokens()` in wizard-env.js

**Files:**
- Modify: `src/core/wizard-env.js:88-93` (the tail of `substituteEnv()`, after the per-line loop)
- Test: `tests/node/wizard-env.test.js`

**Interfaces:**
- Produces: `export function replaceProjectTokens(text: string, repoName: string): string` — replaces every `__PROJECT_NAME__` and `__APP_ARTIFACT_NAME__` occurrence in `text` with `repoName`; returns `text` unchanged if neither token is present (including when `repoName` is `""`, which still performs the replacement — same as current `substituteEnv` behavior).

- [ ] **Step 1: Write the failing test**

Add to `tests/node/wizard-env.test.js` (near the existing `substituteEnv: __PROJECT_NAME__/__APP_ARTIFACT_NAME__ global tokens...` test):

```javascript
test("replaceProjectTokens: replaces both tokens with repoName", () => {
  const out = replaceProjectTokens("host:__PROJECT_NAME__ artifact:__APP_ARTIFACT_NAME__", "my-app");
  assert.strictEqual(out, "host:my-app artifact:my-app");
});

test("replaceProjectTokens: text without tokens is returned unchanged", () => {
  const out = replaceProjectTokens("no tokens here", "my-app");
  assert.strictEqual(out, "no tokens here");
});
```

Update the import at the top of the file to include the new export:

```javascript
import {
  parseWizardLine, setEnvLine, resolveToken, substituteEnv, isUnchanged, replaceProjectTokens,
} from "../../src/core/wizard-env.js";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:node`
Expected: FAIL — `replaceProjectTokens is not a function` (not yet exported).

- [ ] **Step 3: Implement `replaceProjectTokens()` and refactor `substituteEnv()` to use it**

In `src/core/wizard-env.js`, add the new export near the other small helpers (e.g. directly above `substituteEnv`):

```javascript
// __PROJECT_NAME__/__APP_ARTIFACT_NAME__ 전역 토큰을 repoName으로 치환.
// substituteEnv()(설치 파일 본문)와 collectAsks()(마법사 화면 표시용 기본값) 양쪽에서
// 재사용한다 — 두 곳이 서로 다른 로직으로 갈라지면 issue #110과 같은 표시 불일치가 재발한다.
export function replaceProjectTokens(text, repoName) {
  if (!text.includes("__PROJECT_NAME__") && !text.includes("__APP_ARTIFACT_NAME__")) return text;
  return text.replaceAll("__PROJECT_NAME__", repoName).replaceAll("__APP_ARTIFACT_NAME__", repoName);
}
```

Then replace the existing inline block inside `substituteEnv()` (currently):

```javascript
  // 잔여 전역 토큰 (.sh 3347~3351)
  if (out.includes("__PROJECT_NAME__") || out.includes("__APP_ARTIFACT_NAME__")) {
    out = out.replaceAll("__PROJECT_NAME__", repoName).replaceAll("__APP_ARTIFACT_NAME__", repoName);
  }
```

with:

```javascript
  // 잔여 전역 토큰 (.sh 3347~3351)
  out = replaceProjectTokens(out, repoName);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:node`
Expected: PASS — all tests including the two new ones and the pre-existing `substituteEnv: __PROJECT_NAME__/__APP_ARTIFACT_NAME__ global tokens replaced with repoName` test (proves the refactor didn't change `substituteEnv`'s behavior).

- [ ] **Step 5: Commit**

```bash
git add src/core/wizard-env.js tests/node/wizard-env.test.js
git commit -m "refactor: wizard-env에 replaceProjectTokens 헬퍼 추출"
```

---

### Task 2: Apply `replaceProjectTokens()` in `collectAsks()`'s default computation

**Files:**
- Modify: `src/ui/env-plan.js:11` (import), `src/ui/env-plan.js:76-82` (inside `collectAsks()`'s per-line loop)
- Test: `tests/node/env-plan.test.js`

**Interfaces:**
- Consumes: `replaceProjectTokens(text, repoName)` from Task 1 (`src/core/wizard-env.js`), `resolveToken(name, type, resolvers)` (already imported in this file).
- Produces: no new exports — `collectAsks()`'s existing return shape (`{ keys, defaults, typeDefaults, usages }`) is unchanged, only the *values* stored in `defaults`/`typeDefaults` for keys whose default contains `__PROJECT_NAME__`/`__APP_ARTIFACT_NAME__` now come back resolved. Everything downstream (`printFieldCard`, `promptEach`, `buildAnswers`, and by extension `src/ui/summary.js`) reads from these two maps and needs no changes.

- [ ] **Step 1: Write the failing test**

Add to `tests/node/env-plan.test.js`, following the existing `makeFixturePayload()` pattern in that file:

```javascript
test("collectAsks: __PROJECT_NAME__ 리터럴이 박힌 ask 기본값이 실제 repoName으로 치환된다 (issue #110)", () => {
  const root = mkdtempSync(join(tmpdir(), "paw-env-plan-"));
  const commonDir = join(root, "workflows", "common");
  mkdirSync(commonDir, { recursive: true });
  writeFileSync(
    join(commonDir, "PROJECT-COMMON-FOO.yaml"),
    [
      "name: FOO",
      "env:",
      '  VOLUME_CONTAINER_PATH: "/mnt/__PROJECT_NAME__" # @wizard ask:/mnt/__PROJECT_NAME__',
      "",
    ].join("\n"),
  );
  try {
    const asks = collectAsks(root, [], { resolvers: { repo: () => "claude-window-keeper" } });
    assert.strictEqual(asks.defaults.get("VOLUME_CONTAINER_PATH"), "/mnt/claude-window-keeper");
    assert.strictEqual(asks.typeDefaults.get("common|VOLUME_CONTAINER_PATH"), "/mnt/claude-window-keeper");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:node`
Expected: FAIL — `asks.defaults.get("VOLUME_CONTAINER_PATH")` is `"/mnt/__PROJECT_NAME__"`, not `"/mnt/claude-window-keeper"`.

- [ ] **Step 3: Write minimal implementation**

In `src/ui/env-plan.js`, update the import on line 11 to pull in the new helper:

```javascript
import { parseWizardLine, resolveToken, replaceProjectTokens } from "../core/wizard-env.js";
```

Then inside `collectAsks()`, replace:

```javascript
        // 타입별 기본값: @접두면 resolver 해석, 아니면 리터럴 (.sh _type_default 등가)
        const typeDefault = p.arg.startsWith("@")
          ? resolveToken(p.arg.slice(1), type, resolvers)
          : p.arg;
        typeDefaults.set(`${type}|${p.key}`, typeDefault);
```

with:

```javascript
        // 타입별 기본값: @접두면 resolver 해석, 아니면 리터럴 (.sh _type_default 등가)
        const rawDefault = p.arg.startsWith("@")
          ? resolveToken(p.arg.slice(1), type, resolvers)
          : p.arg;
        // 리터럴 기본값 안에 __PROJECT_NAME__ 등이 박혀 있으면(issue #110) 실제 repoName으로
        // 풀어준다 — substituteEnv()가 설치 파일에 적용하는 것과 동일한 치환이라야 마법사
        // 화면 표시와 실제 설치 결과가 어긋나지 않는다.
        const typeDefault = replaceProjectTokens(rawDefault, resolveToken("repo", type, resolvers));
        typeDefaults.set(`${type}|${p.key}`, typeDefault);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:node`
Expected: PASS — the new test plus all other `env-plan.test.js` and `wizard-env.test.js` tests (including the pre-existing `collectAsks: 실제 payload의 ISSUE_HELPER_CREATE_BRANCH가 common 스캔으로 노출된다 (통합)` test, which uses a boolean literal default with no `__PROJECT_NAME__` in it and must be unaffected).

- [ ] **Step 5: Run full test suite**

Run: `npm run test:node`
Expected: `ℹ pass 484` (480 pre-existing + 4 new from Task 1 and Task 2), `ℹ fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/ui/env-plan.js tests/node/env-plan.test.js
git commit -m "fix: 마법사 환경설정 기본값 표시에서 __PROJECT_NAME__ 미치환 문제 수정 (#110)"
```

---

## Manual Verification (optional, after both tasks)

The automated tests fully cover the logic change. If you want to see it end-to-end: run `node bin/project-auto-wizard.js` inside a scratch git repo with a `go.mod` (or any supported project marker), choose the go type + 단일 서버 배포, and confirm the "컨테이너 내부 마운트 경로" question card's "기본값:" line, the `→ ... = ...` confirmation echo, and the final "⚙️ 적용된 환경설정" summary all show the scratch repo's actual folder name instead of `__PROJECT_NAME__`.
