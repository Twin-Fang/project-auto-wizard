# 브랜치 전략 명시적 선택 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대화형 마법사가 "릴리스 브랜치"/"개발 브랜치"를 순서대로 물어서 두 값이 같을 때만 암묵적으로 trunk-based가 되는 대신, 브랜치 전략(pr-flow/trunk-based)을 먼저 명시적으로 선택하게 한다. trunk-based를 선택하면 개발 브랜치 질문 자체를 생략한다.

**Architecture:** `src/ui/prompts.js`에 `selectDeployStyle()`과 동일한 패턴(`engine.note`로 설명 후 `engine.select`)의 `selectBranchStrategy()`를 추가한다. `src/commands/interactive.js`의 브랜치 질문 블록(193~207행)에서 이 함수를 먼저 호출해 전략을 정하고, 전략이 `"trunk-based"`면 개발 브랜치 질문(`pickBranch`)을 건너뛰고 `devB = mainB`로 고정한다. `resolveBranchConfig()`(`src/core/branches.js`)는 입력만 이렇게 바뀔 뿐 로직은 전혀 수정하지 않는다 — `main === develop`이면 여전히 `trunk-based`로 판정한다(사용자가 pr-flow를 고르고도 우연히 같은 이름을 입력하는 엣지 케이스까지 그대로 안전망으로 남는다).

**Tech Stack:** Node.js(ESM), `node:test` + `node:assert`(기존 테스트 러너와 동일). 새 UI 함수는 외부 의존성 없음.

**Spec:** 없음(bounded 범위 변경 — GitHub 이슈 [#93](https://github.com/Twin-Fang/project-auto-wizard/issues/93)에서 제안된 해결 방법을 브레인스토밍으로 확정, 별도 spec 문서 없이 채팅에서 설계 승인). 참고: 기존 동작에 대한 배경은 이슈 본문과 `docs/superpowers/plans/2026-08-14-branch-selection-cursor.md`(직전 `pickBranch` 개선) 참고.

## Global Constraints

- `src/core/branches.js`의 `resolveBranchConfig()` / `sortBranchesForSelection()` / `ensureDevelopBranch()`는 수정하지 않는다 — 호출부(`interactive.js`)의 질문 순서/생략 여부만 바꾼다.
- `pickBranch()`(`src/commands/interactive.js`)의 시그니처와 내부 동작(원격 브랜치 select + "직접 입력..." 폴백, 비-TTY 시 `askText` 폴백)은 변경하지 않는다 — 그대로 재사용한다.
- 새 전략 선택 질문은 `showOptional && !existing?.branches`일 때만 나온다(기존 브랜치 질문과 동일한 조건 — 업데이트 설치·workflows/version 모드에서는 나오지 않는다).
- 전략 선택이 취소(ESC)되거나 유효하지 않은 값이면 `"pr-flow"`로 폴백한다 — `selectDeployStyle()` 채택 시 `deployStyle = isDeployStyle(picked) ? picked : DEFAULT_DEPLOY_STYLE;`와 동일한 패턴.
- 비-TTY(파이프/CI) 환경에서 `engine.select()`는 `options[initialIndex]?.value`(기본 `initialIndex=0`)를 즉시 반환한다(`src/ui/readline-engine.js:97~101`, 수정하지 않음) — 옵션 배열의 **첫 번째 항목이 `"pr-flow"`**여야 기존 비대화형 기본 동작(별도 입력 없으면 pr-flow)과 하위호환된다.
- trunk-based 안내 note는 유지하되 문구만 다듬는다: `"릴리스 브랜치(${branches.main}) 하나만 사용하는 trunk-based 모드로 설치합니다 (RELEASE-PUBLISH 단독)."` (기존: `"릴리스 브랜치 = 개발 브랜치 → trunk-based 모드로 설치합니다 (RELEASE-PUBLISH 단독)."`)
- `selectMode`/`confirmProjectMenu`/`editMenu`/`selectDeployStyle` 등 기존 `prompts.js`의 select 래퍼 함수들은 별도 단위 테스트 파일이 없다(스텁 `io`를 주입하는 `interactive.js` 플로우 테스트로만 검증됨). 단, `selectBranchStrategy()`는 비-TTY 환경에서 결정적으로 첫 옵션을 반환하므로(위 항목) 직접 호출하는 단위 테스트를 추가한다 — 옵션 순서 회귀를 잡기 위한 실질적 가치가 있다.

---

### Task 1: `selectBranchStrategy()` 프롬프트 추가

**Files:**
- Modify: `src/ui/prompts.js`
- Test: `tests/node/prompts-branch-strategy.test.js` (신규)

**Interfaces:**
- Produces: `export async function selectBranchStrategy()` → `Promise<"pr-flow" | "trunk-based" | symbol>` (symbol = `CANCEL`, TTY에서 ESC 시). 옵션 배열의 순서는 `["pr-flow", "trunk-based"]` 고정(비-TTY 기본값 보장).

- [ ] **Step 1: Write the failing test**

`tests/node/prompts-branch-strategy.test.js` 신규 생성:

```javascript
// tests/node/prompts-branch-strategy.test.js
// 이슈 #93 — 브랜치 전략을 먼저 명시적으로 선택하게 하는 프롬프트.
import { test } from "node:test";
import assert from "node:assert";
import { selectBranchStrategy } from "../../src/ui/prompts.js";

test("selectBranchStrategy: 비-TTY 환경(테스트 러너)에서는 첫 옵션인 pr-flow를 기본값으로 반환한다", async () => {
  // node --test 실행 환경은 stdin이 TTY가 아니므로 readline-engine.select()가
  // 옵션 배열의 첫 항목을 즉시 반환한다 — 옵션 순서가 곧 "질문 없이 넘어갈 때의 기본 전략"이다.
  // 기존 동작(두 질문에 각각 다른 기본값 main/develop → pr-flow)과 하위호환되려면
  // pr-flow가 반드시 첫 번째 옵션이어야 한다.
  const result = await selectBranchStrategy();
  assert.strictEqual(result, "pr-flow");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/node/prompts-branch-strategy.test.js`
Expected: FAIL — ESM import 에러(`does not provide an export named 'selectBranchStrategy'`), 아직 export되지 않음.

- [ ] **Step 3: Write minimal implementation**

`src/ui/prompts.js`의 `selectDeployStyle()` 함수(85~98행) 바로 뒤, `askText()` 정의(100행) 바로 앞에 추가:

```javascript
// 브랜치 전략 선택 (이슈 #93). 종전에는 "릴리스 브랜치"/"개발 브랜치" 두 질문에
// 같은 이름을 입력해야만 trunk-based가 됐는데, 그 규칙이 사전에 안내되지 않아
// 의도치 않게 pr-flow로 흘러갔다. 전략을 먼저 명시적으로 고르게 해 이를 없앤다.
// 옵션 순서(pr-flow 먼저)는 비-TTY 환경의 기본값과 직결되므로 바꾸지 않는다.
export async function selectBranchStrategy() {
  engine.note(
    "pr-flow는 develop에서 작업해 main으로 PR을 올리는 팀 협업 흐름입니다.\n" +
    "trunk-based는 브랜치를 하나만 두고 바로 main에서 작업하는 단순한 흐름입니다.",
    "브랜치 전략",
  );
  return engine.select({
    message: "브랜치 전략을 선택하세요",
    options: [
      { value: "pr-flow", label: "develop → main PR 흐름 (pr-flow) — 팀 협업/리뷰 프로세스가 필요할 때" },
      { value: "trunk-based", label: "main 단일 브랜치 (trunk-based) — 개인/소규모 프로젝트로 브랜치 없이 단순하게 쓸 때" },
    ],
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/node/prompts-branch-strategy.test.js`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/ui/prompts.js tests/node/prompts-branch-strategy.test.js
git commit -m "feat: 브랜치 전략(pr-flow/trunk-based)을 먼저 선택하는 프롬프트 추가"
```

---

### Task 2: `interactive.js` 브랜치 질문 흐름을 전략 선택 기반으로 변경

**Files:**
- Modify: `src/commands/interactive.js:193-207`
- Modify: `tests/node/confirm-types.test.js` (stub에 `selectBranchStrategy` 추가)
- Test: `tests/node/interactive-branch-strategy.test.js` (신규)

**Interfaces:**
- Consumes: `selectBranchStrategy()` (Task 1의 `../ui/prompts.js` export, `io.selectBranchStrategy()`로 호출), `pickBranch(io, message, def, remoteBranches, isCancel)`(기존, `src/commands/interactive.js:309`), `resolveBranchConfig({ mainBranch, developBranch, defaultBranch })` → `{ main, develop, mode }`(기존, `src/core/branches.js:29`).
- Produces: 변경 없음 — `runInteractive()`가 계산하는 `branches` 객체의 모양(`{ main, develop, mode }`)과 그것이 `io.summary()`/`runFull()`에 전달되는 방식은 그대로 유지된다.

- [ ] **Step 1: Write the failing tests**

`tests/node/interactive-branch-strategy.test.js` 신규 생성:

```javascript
// tests/node/interactive-branch-strategy.test.js
// 이슈 #93 — 브랜치 전략(pr-flow/trunk-based)을 먼저 명시적으로 선택한 뒤,
// trunk-based면 개발 브랜치 질문을 생략하는지 검증한다.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInteractive } from "../../src/commands/interactive.js";

function stubIo({ strategy = "pr-flow", askTextAnswers = {} } = {}) {
  const askTextCalls = [];
  const noteCalls = [];
  const summaryCalls = [];
  const io = {
    selectMode: async () => "full",
    confirmProjectMenu: async () => "continue",
    confirmTypes: async ({ types }) => types,
    selectDeployStyle: async () => "simple",
    selectBranchStrategy: async () => strategy,
    askYesNo: async (_m, def) => def,
    askText: async (message, def) => {
      askTextCalls.push({ message, def });
      const hit = Object.entries(askTextAnswers).find(([key]) => message.includes(key));
      return hit ? hit[1] : def;
    },
    note: (text, title) => noteCalls.push({ text, title }),
    cancelMessage: () => {},
    summary: (ctx) => summaryCalls.push(ctx),
    outro: () => {},
  };
  return { io, askTextCalls, noteCalls, summaryCalls };
}

function tmpProject() {
  return mkdtempSync(join(tmpdir(), "paw-branch-strategy-"));
}

test("trunk-based 선택 시 개발 브랜치 질문이 생략되고 branches.mode가 trunk-based가 된다", async () => {
  const target = tmpProject();
  try {
    const { io, askTextCalls, noteCalls, summaryCalls } = stubIo({ strategy: "trunk-based" });
    const code = await runInteractive({}, { cwd: target, io });
    assert.strictEqual(code, 0);

    const branchQuestions = askTextCalls.filter((c) => c.message.includes("브랜치를 선택하세요"));
    assert.strictEqual(branchQuestions.length, 1, "trunk-based면 릴리스 브랜치 질문 1개만 나와야 한다");
    assert.ok(branchQuestions[0].message.includes("릴리스 브랜치"), "생략 없이 남는 질문은 릴리스 브랜치여야 한다");

    const { branches } = summaryCalls[0];
    assert.strictEqual(branches.mode, "trunk-based");
    assert.strictEqual(branches.main, branches.develop, "trunk-based는 main과 develop이 같아야 한다");

    const strategyNote = noteCalls.find((n) => n.title === "브랜치 전략");
    assert.ok(strategyNote, "trunk-based 안내 note가 떠야 한다");
    assert.ok(strategyNote.text.includes("trunk-based"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("pr-flow 선택 시 릴리스/개발 브랜치 질문이 각각 나오고 서로 다른 이름이면 branches.mode가 pr-flow가 된다", async () => {
  const target = tmpProject();
  try {
    const { io, askTextCalls, summaryCalls } = stubIo({
      strategy: "pr-flow",
      askTextAnswers: { "릴리스 브랜치": "main", "개발 브랜치": "develop" },
    });
    const code = await runInteractive({}, { cwd: target, io });
    assert.strictEqual(code, 0);

    const branchQuestions = askTextCalls.filter((c) => c.message.includes("브랜치를 선택하세요"));
    assert.strictEqual(branchQuestions.length, 2, "pr-flow면 릴리스+개발 두 질문이 나와야 한다");

    const { branches } = summaryCalls[0];
    assert.strictEqual(branches.mode, "pr-flow");
    assert.strictEqual(branches.main, "main");
    assert.strictEqual(branches.develop, "develop");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("전략 선택이 취소(ESC)되면 pr-flow로 폴백해 기존과 동일하게 두 질문이 나온다", async () => {
  const target = tmpProject();
  try {
    const { io, askTextCalls } = stubIo({ strategy: Symbol("cancel") });
    const code = await runInteractive({}, { cwd: target, io });
    assert.strictEqual(code, 0);

    const branchQuestions = askTextCalls.filter((c) => c.message.includes("브랜치를 선택하세요"));
    assert.strictEqual(branchQuestions.length, 2, "취소 시 pr-flow 폴백이므로 두 질문 모두 나와야 한다");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/node/interactive-branch-strategy.test.js`
Expected: FAIL — `io.selectBranchStrategy is not a function` (아직 `interactive.js`가 호출하지 않음).

- [ ] **Step 3: Modify `src/commands/interactive.js:193-207`**

기존 블록 전체를:

```javascript
  if (showOptional && !existing?.branches) {
    const remoteBranches = await detectRemoteBranches(cwd);
    const mainB = await pickBranch(io, `릴리스 브랜치를 선택하세요 (기본: ${branch})`, branch, remoteBranches, isCancel);
    const devB = await pickBranch(io, "개발 브랜치를 선택하세요 (기본: develop)", "develop", remoteBranches, isCancel);
    branches = resolveBranchConfig({ mainBranch: mainB, developBranch: devB, defaultBranch: branch });
    if (branches.mode === "trunk-based") {
      io.note?.("릴리스 브랜치 = 개발 브랜치 → trunk-based 모드로 설치합니다 (RELEASE-PUBLISH 단독).", "브랜치 모드");
    } else if (remoteBranches.length && !remoteBranches.includes(branches.develop)) {
      await ensureDevelopBranch({
        develop: branches.develop, remoteBranches, cwd,
        confirm: (msg) => io.askYesNo(msg, true),
        log: (m) => io.note?.(m, "브랜치"),
      });
    }
  }
```

다음으로 교체한다:

```javascript
  if (showOptional && !existing?.branches) {
    const remoteBranches = await detectRemoteBranches(cwd);
    // 이슈 #93 — 두 질문에 같은 이름을 입력해야만 trunk-based가 되는 암묵적 규칙 대신,
    // 전략을 먼저 명시적으로 고르게 한다. 취소/그 외 값은 기존 기본 동작과 같은 pr-flow로 폴백
    // (selectDeployStyle의 "ESC = 기본값" 패턴과 동일).
    const strategyPick = await io.selectBranchStrategy();
    const strategy = strategyPick === "trunk-based" ? "trunk-based" : "pr-flow";
    const mainB = await pickBranch(io, `릴리스 브랜치를 선택하세요 (기본: ${branch})`, branch, remoteBranches, isCancel);
    // trunk-based면 개발 브랜치 질문 자체를 생략 — 유일한 브랜치(main)를 그대로 develop으로 쓴다.
    const devB = strategy === "trunk-based"
      ? mainB
      : await pickBranch(io, "개발 브랜치를 선택하세요 (기본: develop)", "develop", remoteBranches, isCancel);
    branches = resolveBranchConfig({ mainBranch: mainB, developBranch: devB, defaultBranch: branch });
    if (branches.mode === "trunk-based") {
      io.note?.(`릴리스 브랜치(${branches.main}) 하나만 사용하는 trunk-based 모드로 설치합니다 (RELEASE-PUBLISH 단독).`, "브랜치 전략");
    } else if (remoteBranches.length && !remoteBranches.includes(branches.develop)) {
      await ensureDevelopBranch({
        develop: branches.develop, remoteBranches, cwd,
        confirm: (msg) => io.askYesNo(msg, true),
        log: (m) => io.note?.(m, "브랜치"),
      });
    }
  }
```

(`branches.mode === "trunk-based"` 분기는 그대로 남겨둔다 — pr-flow를 고르고도 두 질문에 우연히 같은 이름을 입력하는 엣지 케이스에서도 안내가 뜨도록 하는 기존 안전망이다.)

- [ ] **Step 4: Update `tests/node/confirm-types.test.js` stub**

4행 근처 `stubIo()`의 `io` 객체에 `selectBranchStrategy` 한 줄을 추가한다(그 외 수정 없음):

```javascript
// 기존 (16번째 줄 부근):
    askText: async (_m, def) => def,
    selectDeployStyle: async () => "simple",

// 변경 후:
    askText: async (_m, def) => def,
    selectDeployStyle: async () => "simple",
    selectBranchStrategy: async () => "pr-flow",
```

- [ ] **Step 5: Run all affected tests to verify they pass**

Run: `node --test tests/node/interactive-branch-strategy.test.js tests/node/confirm-types.test.js tests/node/interactive-branch-picker.test.js tests/node/branches.test.js tests/node/interactive-mode-summary.test.js`
Expected: PASS (all).

- [ ] **Step 6: Run the full suite**

Run: `npm run test:node`
Expected: PASS, 0 실패 (Task 1 실행 전 447개 + Task 1에서 추가한 1개 + 이번 Task에서 추가한 3개 = 451개 이상, 모두 통과).

- [ ] **Step 7: Commit**

```bash
git add src/commands/interactive.js tests/node/interactive-branch-strategy.test.js tests/node/confirm-types.test.js
git commit -m "feat: trunk-based 선택 시 개발 브랜치 질문을 생략하도록 대화형 흐름 변경"
```

---

## Post-Plan Verification (구현 완료 후 수동 확인용 체크리스트)

- [ ] `npm run test:node` 전체 통과 (신규 4개 테스트 포함).
- [ ] `git diff main --stat` 기준 변경 파일이 계획된 파일(`src/ui/prompts.js`, `src/commands/interactive.js`, 신규/수정 테스트 3개)로만 한정되는지 확인.
- [ ] `src/core/branches.js`가 수정되지 않았는지 확인(`git diff main -- src/core/branches.js`가 비어 있어야 함).
