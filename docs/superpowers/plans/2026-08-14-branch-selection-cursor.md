# 브랜치 선택 프롬프트 커서/정렬 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 인터랙티브 마법사의 브랜치 선택 프롬프트(`pickBranch`)가 커서를 항상 기본 브랜치(`def`)에 두고, `main`/`develop`을 목록 상단에 정렬하도록 고친다.

**Architecture:** `src/core/branches.js`에 순수 정렬 함수 `sortBranchesForSelection(remoteBranches, def, priority)`을 추가한다. `src/commands/interactive.js`의 `pickBranch()`는 이 함수로 정렬된 목록에서 `options`를 구성하고, `def`의 최종 인덱스를 계산해 `select()`에 `initialIndex`로 전달한다. `pickBranch`는 직접 유닛테스트할 수 있도록 `export`한다.

**Tech Stack:** Node.js(순수 함수, ESM), `node:test` + `node:assert`(기존 테스트 러너와 동일).

**Spec:** `docs/superpowers/specs/2026-08-14-branch-selection-cursor-design.md`

## Global Constraints

- 정렬 적용 범위: `pickBranch()`를 호출하는 "릴리스 브랜치를 선택하세요"(mainB)와 "개발 브랜치를 선택하세요"(devB) 두 프롬프트 모두 — 별도 분기 없이 자동 적용.
- 우선순위 브랜치 기본값은 `["main", "develop"]`로 하드코딩(사용자 설정 불가, 스펙 §5).
- `sortBranchesForSelection`은 순수 함수 — 입력 배열(`remoteBranches`)을 변경하지 않고 새 배열을 반환한다.
- "직접 입력..." (`__custom__`) 옵션은 항상 목록 맨 끝 유지.
- `src/ui/readline-engine.js`의 `select()`는 수정하지 않는다(이미 `initialIndex` 지원).
- 라벨 문자열(`(기본값)`, `(기본값 — 없으면 새로 생성)`)은 변경하지 않는다.

---

### Task 1: `sortBranchesForSelection` 순수 함수 추가

**Files:**
- Modify: `src/core/branches.js`
- Test: `tests/node/branches.test.js`

**Interfaces:**
- Produces: `export function sortBranchesForSelection(remoteBranches, def, priority = ["main", "develop"])` → `string[]` (새 배열, `remoteBranches` 불변)
  - 동작: `def`를 최우선으로, 그다음 `priority` 목록 순서로 앞에 배치(단 `remoteBranches`에 실제로 존재하는 것만, 중복 제거). 나머지는 `remoteBranches`의 원래 상대 순서를 유지한 채 뒤에 이어붙인다.

- [ ] **Step 1: Write the failing tests**

`tests/node/branches.test.js` 파일 맨 끝(마지막 `test(...)` 블록 뒤)에 아래를 추가한다. 파일 최상단 import에 `sortBranchesForSelection`을 추가해야 한다.

```javascript
// import 줄 교체 (파일 4행):
// 기존: import { resolveBranchConfig, ensureDevelopBranch } from "../../src/core/branches.js";
// 변경 후:
import { resolveBranchConfig, ensureDevelopBranch, sortBranchesForSelection } from "../../src/core/branches.js";
```

```javascript
// ── sortBranchesForSelection (순수 함수, 이슈 #85) ──────────────────
test("sortBranchesForSelection: def가 목록 중간에 있으면 맨 앞으로 온다", () => {
  const remote = ["20260810_feature", "develop", "main", "zzz-old"];
  const sorted = sortBranchesForSelection(remote, "main");
  assert.deepStrictEqual(sorted, ["main", "develop", "20260810_feature", "zzz-old"]);
});

test("sortBranchesForSelection: main/develop이 def와 다르면 def 다음 순서로 온다", () => {
  const remote = ["20260810_feature", "develop", "main", "zzz-old"];
  const sorted = sortBranchesForSelection(remote, "zzz-old");
  assert.deepStrictEqual(sorted, ["zzz-old", "main", "develop", "20260810_feature"]);
});

test("sortBranchesForSelection: priority 후보가 목록에 없으면 건너뛰고 나머지만 배치한다", () => {
  const remote = ["20260810_feature", "main"];
  const sorted = sortBranchesForSelection(remote, "main");
  assert.deepStrictEqual(sorted, ["main", "20260810_feature"]);
});

test("sortBranchesForSelection: 나머지 브랜치의 상대 순서는 원본 그대로 보존된다", () => {
  const remote = ["b-branch", "a-branch", "main", "c-branch"];
  const sorted = sortBranchesForSelection(remote, "main");
  assert.deepStrictEqual(sorted, ["main", "b-branch", "a-branch", "c-branch"]);
});

test("sortBranchesForSelection: def가 이미 priority에 포함되어도 중복 없이 한 번만 앞에 온다", () => {
  const remote = ["20260810_feature", "main", "develop"];
  const sorted = sortBranchesForSelection(remote, "develop");
  assert.deepStrictEqual(sorted, ["develop", "main", "20260810_feature"]);
});

test("sortBranchesForSelection: remoteBranches 원본 배열을 변경하지 않는다", () => {
  const remote = ["20260810_feature", "main"];
  const before = [...remote];
  sortBranchesForSelection(remote, "main");
  assert.deepStrictEqual(remote, before);
});

test("sortBranchesForSelection: def가 목록에 아예 없으면 나머지만 원래 순서로 반환한다", () => {
  const remote = ["20260810_feature", "main"];
  const sorted = sortBranchesForSelection(remote, "new-branch");
  assert.deepStrictEqual(sorted, ["20260810_feature", "main"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/node/branches.test.js`
Expected: FAIL — `sortBranchesForSelection is not a function` (아직 export되지 않음)

- [ ] **Step 3: Implement `sortBranchesForSelection`**

`src/core/branches.js`에서 `resolveBranchConfig` 함수(29~35행) 뒤, `ensureDevelopBranch` 함수(37행) 앞에 아래 함수를 추가한다.

```javascript
// 브랜치 선택 프롬프트용 정렬 (이슈 #85). def를 최우선으로, 그다음 priority(main/develop)
// 순서로 목록 앞에 배치한다. 나머지는 remoteBranches의 원래 순서(git이 준 알파벳순)를 유지한다.
// 순수 함수 — remoteBranches 원본은 변경하지 않는다.
export function sortBranchesForSelection(remoteBranches, def, priority = ["main", "develop"]) {
  const priorityOrder = [def, ...priority].filter((b, i, arr) => arr.indexOf(b) === i);
  const inPriority = priorityOrder.filter((b) => remoteBranches.includes(b));
  const rest = remoteBranches.filter((b) => !inPriority.includes(b));
  return [...inPriority, ...rest];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/node/branches.test.js`
Expected: PASS — 기존 테스트 포함 전체 통과

- [ ] **Step 5: Commit**

```bash
git add src/core/branches.js tests/node/branches.test.js
git commit -m "$(cat <<'EOF'
feat: 브랜치 선택 목록 정렬용 순수 함수 sortBranchesForSelection 추가

이슈 #85 — 기본 브랜치와 main/develop을 목록 앞으로 정렬하는 로직을
core/branches.js에 순수 함수로 분리.
EOF
)"
```

---

### Task 2: `pickBranch()`가 정렬된 목록 + `initialIndex`를 사용하도록 수정

**Files:**
- Modify: `src/commands/interactive.js`
- Test: `tests/node/interactive-branch-picker.test.js` (신규)

**Interfaces:**
- Consumes: `sortBranchesForSelection(remoteBranches, def, priority)` (Task 1, `src/core/branches.js`)
- Produces: `export async function pickBranch(io, message, def, remoteBranches, isCancel)` → `Promise<string>` (기존 시그니처 동일, `export` 키워드만 추가되어 테스트에서 직접 import 가능해짐)

- [ ] **Step 1: Write the failing test**

새 파일 `tests/node/interactive-branch-picker.test.js`를 생성한다.

```javascript
// tests/node/interactive-branch-picker.test.js
// 이슈 #85 — pickBranch()가 select()에 정렬된 options와 initialIndex를 넘기는지 검증.
import { test } from "node:test";
import assert from "node:assert";
import { pickBranch } from "../../src/commands/interactive.js";

const isCancel = () => false;

function stubSelectIo(returnValue) {
  const calls = [];
  return {
    io: {
      engineIo: {
        select: async (args) => { calls.push(args); return returnValue; },
      },
    },
    calls,
  };
}

test("pickBranch: def가 목록 중간에 있어도 정렬된 options 맨 앞에 오고 initialIndex가 그 위치를 가리킨다", async () => {
  const { io, calls } = stubSelectIo("main");
  const remoteBranches = ["20260810_feature", "develop", "main", "zzz-old"];
  const result = await pickBranch(io, "릴리스 브랜치를 선택하세요 (기본: main)", "main", remoteBranches, isCancel);

  assert.strictEqual(result, "main");
  assert.strictEqual(calls.length, 1);
  const { options, initialIndex } = calls[0];
  assert.strictEqual(options[initialIndex].value, "main", "initialIndex가 가리키는 옵션은 def(main)여야 한다");
  assert.deepStrictEqual(
    options.map((o) => o.value),
    ["main", "develop", "20260810_feature", "zzz-old", "__custom__"],
  );
});

test("pickBranch: 개발 브랜치 프롬프트(def=develop)에서도 커서가 develop을 가리킨다", async () => {
  const { io, calls } = stubSelectIo("develop");
  const remoteBranches = ["20260810_feature", "develop", "main"];
  const result = await pickBranch(io, "개발 브랜치를 선택하세요 (기본: develop)", "develop", remoteBranches, isCancel);

  assert.strictEqual(result, "develop");
  const { options, initialIndex } = calls[0];
  assert.strictEqual(options[initialIndex].value, "develop");
  assert.deepStrictEqual(
    options.map((o) => o.value),
    ["develop", "main", "20260810_feature", "__custom__"],
  );
});

test("pickBranch: def가 원격에 없는 신규 브랜치면 플레이스홀더가 맨 앞(index 0)에 오고 initialIndex도 0이다", async () => {
  const { io, calls } = stubSelectIo("release");
  const remoteBranches = ["20260810_feature", "develop"];
  const result = await pickBranch(io, "릴리스 브랜치를 선택하세요 (기본: release)", "release", remoteBranches, isCancel);

  assert.strictEqual(result, "release");
  const { options, initialIndex } = calls[0];
  assert.strictEqual(initialIndex, 0);
  assert.strictEqual(options[0].value, "release");
  assert.strictEqual(options[0].label, "release (기본값 — 없으면 새로 생성)");
});

test("pickBranch: 사용자가 다른 브랜치를 선택하면 그 값을 그대로 반환한다(정렬은 선택 결과에 영향 없음)", async () => {
  const { io } = stubSelectIo("develop");
  const remoteBranches = ["20260810_feature", "develop", "main"];
  const result = await pickBranch(io, "릴리스 브랜치를 선택하세요 (기본: main)", "main", remoteBranches, isCancel);
  assert.strictEqual(result, "develop");
});

test("pickBranch: engineIo.select가 없으면(비-TTY) 기존처럼 askText로 폴백한다 — 회귀 확인", async () => {
  const askTextCalls = [];
  const io = { askText: async (message, def) => { askTextCalls.push({ message, def }); return def; } };
  const result = await pickBranch(io, "릴리스 브랜치를 선택하세요 (기본: main)", "main", ["develop", "main"], isCancel);
  assert.strictEqual(result, "main");
  assert.strictEqual(askTextCalls.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/node/interactive-branch-picker.test.js`
Expected: FAIL — `pickBranch`가 아직 export되지 않아 `undefined`를 import(호출 시 "pickBranch is not a function")

- [ ] **Step 3: Modify `pickBranch()` to export it, sort options, and pass `initialIndex`**

`src/commands/interactive.js` 12행의 import를 교체한다:

```javascript
// 기존:
import { resolveBranchConfig, detectRemoteBranches, ensureDevelopBranch } from "../core/branches.js";
// 변경 후:
import { resolveBranchConfig, detectRemoteBranches, ensureDevelopBranch, sortBranchesForSelection } from "../core/branches.js";
```

`pickBranch()` 함수 전체(현재 267~282행, 위 두 신규 함수 추가로 줄 번호는 밀리지만 함수 본문 자체를 아래로 교체)를 다음으로 교체한다:

```javascript
// 브랜치 선택 — 원격 목록이 있으면 select(+직접 입력), 없으면 텍스트 입력. ESC/빈값 = 기본값.
// 이슈 #85: def를 최우선으로, main/develop을 그다음으로 정렬하고 커서를 def에 고정한다.
export async function pickBranch(io, message, def, remoteBranches, isCancel) {
  if (io.engineIo?.select && remoteBranches.length) {
    const sorted = sortBranchesForSelection(remoteBranches, def);
    const options = [];
    if (!sorted.includes(def)) options.push({ value: def, label: `${def} (기본값 — 없으면 새로 생성)` });
    for (const b of sorted) options.push({ value: b, label: b === def ? `${b} (기본값)` : b });
    options.push({ value: "__custom__", label: "직접 입력..." });
    const initialIndex = Math.max(0, options.findIndex((o) => o.value === def));
    const sel = await io.engineIo.select({ message, options, initialIndex });
    if (sel === "__custom__") {
      const v = await io.askText("브랜치 이름", def);
      return isCancel(v) || !v ? def : v;
    }
    return isCancel(sel) || sel == null ? def : sel;
  }
  const v = await io.askText(message, def);
  return isCancel(v) || !v ? def : v;
}
```

(변경점: 함수 앞에 `export` 추가, `remoteBranches` 순회를 `sortBranchesForSelection(remoteBranches, def)` 결과인 `sorted`로 교체, `select()` 호출에 `initialIndex` 추가. 그 외 로직/라벨 문자열은 동일.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/node/interactive-branch-picker.test.js`
Expected: PASS — 5개 테스트 모두 통과

Run: `node --test tests/node/` (또는 프로젝트의 npm test 스크립트 — `package.json`의 `scripts.test` 확인 후 사용)
Expected: 기존 `interactive-mode-*.test.js`, `branches.test.js` 등 전체 회귀 없이 PASS

- [ ] **Step 5: Commit**

```bash
git add src/commands/interactive.js tests/node/interactive-branch-picker.test.js
git commit -m "$(cat <<'EOF'
fix: 브랜치 선택 프롬프트가 기본 브랜치에 커서를 고정하도록 수정

이슈 #85 — pickBranch()가 sortBranchesForSelection()으로 정렬된 목록을
쓰고 def의 인덱스를 select()의 initialIndex로 전달한다. main/develop이
목록 상단에 오고, 프롬프트를 열자마자 커서가 기본 브랜치를 가리킨다.
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage**: §2(정렬 책임 분리) → Task 1, §3.1(`sortBranchesForSelection` 시그니처/동작) → Task 1, §3.2(`pickBranch` 수정) → Task 2, §3.3(mainB/devB 양쪽 적용) → Task 2 테스트 2건이 각각 커버, §4(테스트 계획) → Task 1/2 테스트가 그대로 대응. §5(범위 밖)는 코드 변경 대상이 아니므로 해당 없음.
- **Placeholder scan**: 없음 — 모든 스텝에 실행 가능한 코드/명령을 포함.
- **Type consistency**: `sortBranchesForSelection(remoteBranches, def, priority)` 시그니처가 Task 1(정의)과 Task 2(호출부 — `priority` 생략, 기본값 사용)에서 일치. `pickBranch(io, message, def, remoteBranches, isCancel)` 시그니처는 기존과 동일하게 Task 2에서 유지.
