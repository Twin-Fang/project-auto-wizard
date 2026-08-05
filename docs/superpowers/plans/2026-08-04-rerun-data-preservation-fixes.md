# 재실행/되돌리기 데이터 보존 결함 5건 수정 (issue #20) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 재실행(재설치)·되돌리기(revert/uninstall) 시 "사용자 데이터·설정을 보존해야 한다"는 공통 계약이 깨지는 5건(issue #20: H3/M7/M8/L9/L12)을 모두 고친다.

**Architecture:** 5건은 서로 다른 파일(`workflows.js`/`gitignore.js`/`version-yml.js`/`wizard-env.js`/`revert.js`)에 위치한 독립적인 버그이며, 이슈 본문이 이미 5건을 하나로 묶어 놓았고 브랜치명도 "_5건"으로 체크아웃되어 있다. 이 계획 문서 하나·이 브랜치 하나에서 5개의 독립 태스크로 순차 처리한다(각 태스크는 개별적으로 테스트 가능하고 개별적으로 커밋된다).

**Tech Stack:** Node.js(`node:*` 내장 모듈만, 외부 의존성 0개), `node:test` + `node:assert` 테스트, payload는 GitHub Actions 워크플로우 YAML 템플릿.

## Global Constraints

- 외부 npm 의존성을 추가하지 않는다 — `src/`, `bin/`은 `node:*` 내장 모듈만 사용한다(CONTRIBUTING.md).
- 모든 새 테스트는 `node:test` + `node:assert`로 작성하고 `tests/node/` 아래에 둔다(기존 전 파일과 동일한 스타일).
- 각 태스크 완료 후 `npm run test:node`(최소) — 전 태스크 완료 후 `npm test`(node + python) 전체가 통과해야 한다.
- **H3 결정:** common 워크플로우의 3지선은 타입별 워크플로우와 완전히 동일한 규칙을 따른다 — `decisions` Map에 값이 없으면(대화형 미노출·CLI `--force` 등 비대화형 경로) 기본값은 **skip**(기존 파일 유지)이다. README가 말하는 "3지선이 common에도 동일 적용"을 문자 그대로 따른 것이며, 타입별 파일의 기존 기본값(코드 142행 `counters.skipped++ // 'skip'/미지정/ESC`)과 일치시킨다.
- **M7 결정:** `.gitignore` 배너 블록에 종료 마커를 새로 추가한다. 종료 마커가 있는 배너(이 수정 이후 설치분)는 그 범위 안에서 `REQUIRED_ENTRIES`를 순서·연속 여부 무관하게 개별 제거한다. 종료 마커가 없는 배너(이 수정 이전 설치분)는 기존의 "연속 매치" 방식으로 폴백한다 — 이미 설치된 레포는 소급 처리하지 않는다는 기존 원칙(issue #7)과 동일선상.
- **M8 결정:** `version.yml`의 **최상위 레벨** 알려지지 않은 필드만 보존 대상이다. `metadata`/`project_paths`/`deploy` 같은 이미 아는 블록 **내부**의 알려지지 않은 하위 키는 대상이 아니다. 보존된 필드는 재생성 시 파일 맨 끝에 원래 순서 그대로 이어붙인다.
- **L12 결정(fable5 리뷰 반영 — 하이브리드로 수정):** `payload/workflows/**/*.yaml` 전체(및 이 레포 자신에게 dogfooding된 `.github/workflows/*.yaml` 사본, CONTRIBUTING.md 동기화 규칙)에 고정 마커 주석 한 줄(`# project-auto-wizard:managed-workflow`)을 추가한다. `revert`는 기존 방식(현재 payload 파일명과 정확히 일치하는 설치본 — `.bak`/`.template.yaml` 파생 포함)과 신규 방식(설치된 워크플로우 디렉토리에서 마커로 시작하는 파일)의 **합집합**으로 관리 대상을 판별한다. **애초에 "마커 전용으로 완전히 전환"은 채택하지 않는다** — 그렇게 하면 이 수정 이전에 설치되어 마커가 없는(하지만 파일명은 현재 payload와 여전히 일치하는) 기존 설치 전체에서 revert/uninstall/purge가 아무것도 못 지우는 회귀가 발생하기 때문이다(1차 초안의 실수, 리뷰에서 지적됨). 파일명 일치 판별은 기존 설치에 대해 100% 그대로 유지되고, 마커 판별은 payload에서 이름이 바뀌거나 삭제된 파일(L12가 원래 고치려는 케이스)만 추가로 잡아낸다.
- **범위 밖(관찰만, 수정 안 함):** `runVersion`(`--mode version`)은 `copyWorkflows`를 호출하지 않아 `deployValues`가 항상 빈 Map이다 — 기존 `deploy:` 블록이 있는 상태에서 `--mode version`만 재실행하면 `deploy:` 블록 자체가 사라지는 별도 갭이 있다. issue #20의 5건에 포함되지 않으므로 이 계획에서 고치지 않는다.
- **범위 밖(관찰만, 수정 안 함):** `.gitignore`를 마법사가 새로 생성한 케이스(`NEW_FILE_CONTENT`)에서 사용자가 `*.bak`과 `*.template.yaml` 사이에 줄을 끼워넣으면 `startsWith(NEW_FILE_CONTENT)` 매칭이 깨져 `removeAutoAddedEntriesFromGitignore`가 통째로 아무것도 못 지운다. 이슈 #20의 M7 재현 시나리오는 "기존 파일 + 배너 블록" 케이스만 다루므로 이 계획에서 고치지 않는다.

---

### Task 1: H3 — common 워크플로우에 3지선 적용

**Files:**
- Modify: `src/core/copy/workflows.js:62-118` (`copyWorkflows` 본체의 common 처리 루프)
- Modify: `src/core/copy/workflows.js:147-165` (`listWorkflowConflicts`)
- Modify: `tests/node/plan-workflows.test.js:25,46` (더 이상 사실이 아닌 주석/테스트명 수정)
- Create: `tests/node/workflow-conflicts.test.js`

**Interfaces:**
- Consumes: 기존 `classify(srcDir, workflowsDir, envOpts, srcText)`, `applyDecision(decision, srcDir, workflowsDir, filename, counters, srcText)` (모두 같은 파일의 기존 함수, 시그니처 무변경).
- Produces: `copyWorkflows`/`listWorkflowConflicts`의 공개 시그니처는 무변경. `listWorkflowConflicts`가 반환하는 배열에 `{ filename, type: "common" }` 항목이 추가로 섞여 나올 수 있다는 점만 호출부(`src/commands/interactive.js`)가 이미 `type`을 그대로 라벨링하므로 호출부 코드 변경은 필요 없다.

- [ ] **Step 1: 실패하는 테스트 작성 — `tests/node/workflow-conflicts.test.js` 새로 생성**

```javascript
// tests/node/workflow-conflicts.test.js
// issue #20 H3 — common 워크플로우도 타입별과 동일한 3지선이 적용되는지 검증.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { copyWorkflows, listWorkflowConflicts } from "../../src/core/copy/workflows.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";

const PAYLOAD = resolvePayloadRoot();

function ctxFor(overrides = {}) {
  return createContext({
    mode: "full", force: true, types: ["node"], version: "1.0.0",
    branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(),
    ...overrides,
  });
}

test("listWorkflowConflicts: an edited COMMON file is surfaced as a conflict with type 'common'", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-wf-conflicts-"));
  try {
    const ctx = ctxFor();
    copyWorkflows(ctx, PAYLOAD, target);
    const wfPath = join(target, ".github/workflows/PROJECT-COMMON-RELEASE-PUBLISH.yaml");
    writeFileSync(wfPath, readFileSync(wfPath, "utf8") + "\n# user edit\n");

    const conflicts = listWorkflowConflicts(ctx, PAYLOAD, target);
    const common = conflicts.find((c) => c.filename === "PROJECT-COMMON-RELEASE-PUBLISH.yaml");
    assert.ok(common, "edited common file must appear in conflicts");
    assert.strictEqual(common.type, "common");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("copyWorkflows: a changed COMMON file with no decision defaults to skip (keeps user edit) — matches type-specific default", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-wf-conflicts-"));
  try {
    const ctx = ctxFor();
    copyWorkflows(ctx, PAYLOAD, target);
    const wfPath = join(target, ".github/workflows/PROJECT-COMMON-RELEASE-PUBLISH.yaml");
    const edited = readFileSync(wfPath, "utf8") + "\n# user edit\n";
    writeFileSync(wfPath, edited);

    copyWorkflows(ctx, PAYLOAD, target); // decisions 미지정 -> skip 기본값
    assert.strictEqual(readFileSync(wfPath, "utf8"), edited, "changed common file must be kept when no decision is given");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("copyWorkflows: a changed COMMON file with 'backup' decision is backed up and replaced", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-wf-conflicts-"));
  try {
    const ctx = ctxFor();
    copyWorkflows(ctx, PAYLOAD, target);
    const wfPath = join(target, ".github/workflows/PROJECT-COMMON-RELEASE-PUBLISH.yaml");
    const edited = readFileSync(wfPath, "utf8") + "\n# user edit\n";
    writeFileSync(wfPath, edited);

    const result = copyWorkflows(ctx, PAYLOAD, target, {
      decisions: new Map([["PROJECT-COMMON-RELEASE-PUBLISH.yaml", "backup"]]),
    });
    assert.ok(result.copiedFiles.includes("PROJECT-COMMON-RELEASE-PUBLISH.yaml"));
    assert.strictEqual(readFileSync(wfPath + ".bak", "utf8"), edited);
    assert.notStrictEqual(readFileSync(wfPath, "utf8"), edited);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("copyWorkflows/listWorkflowConflicts: trunk-based mode excludes VERSION-CONTROL/AUTO-CHANGELOG-CONTROL from conflicts even if a stale pr-flow install differs", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-wf-conflicts-"));
  try {
    const prFlowCtx = ctxFor(); // pr-flow 기본값 -> VERSION-CONTROL 설치됨
    copyWorkflows(prFlowCtx, PAYLOAD, target);
    const wfPath = join(target, ".github/workflows/PROJECT-COMMON-VERSION-CONTROL.yaml");
    writeFileSync(wfPath, readFileSync(wfPath, "utf8") + "\n# user edit\n");

    const trunkCtx = ctxFor({ branches: { main: "main", develop: "main", mode: "trunk-based" } });
    const conflicts = listWorkflowConflicts(trunkCtx, PAYLOAD, target);
    assert.ok(!conflicts.some((c) => c.filename === "PROJECT-COMMON-VERSION-CONTROL.yaml"));
  } finally { rmSync(target, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `node --test tests/node/workflow-conflicts.test.js`
Expected: FAIL — `common.type`가 없거나(`listWorkflowConflicts`가 common을 아예 안 봄), `backup` 결정을 줘도 `.bak`이 생기지 않고 파일이 무조건 덮어써짐(현재는 decisions를 안 봄).

- [ ] **Step 3: `src/core/copy/workflows.js`의 `copyWorkflows` common 처리 루프를 타입별과 동일한 패턴으로 재작성**

`(1) common — unchanged면 스킵, 아니면 무조건 덮어쓰기.` 블록(현재 77~95행)을 다음으로 교체:

```javascript
  // (1) common — 타입별 워크플로우와 동일한 3지선(README 계약, issue #20 H3): unchanged면 스킵,
  //     changed면 decisions Map 결정에 따름(미지정 시 skip — 기존 사용자 수정 보존).
  //     trunk-based 모드는 VERSION-CONTROL·AUTO-CHANGELOG 미설치 (RELEASE-PUBLISH 단독).
  const branchMode = context.branches?.mode || "pr-flow";
  const commonDir = join(projectTypesDir, "common");
  if (exists(commonDir)) {
    const notExcluded = (filename) => !(branchMode === "trunk-based" && TRUNK_BASED_EXCLUDED.has(filename));
    const { newFiles, unchanged, changed } = classify(commonDir, workflowsDir, envOptsFor("common"), srcText);
    for (const f of unchanged.filter(notExcluded)) counters.skipped++;
    for (const f of newFiles.filter(notExcluded)) {
      writeText(join(workflowsDir, f), srcText(join(commonDir, f)));
      counters.copied++;
      counters.copiedFiles.push(f);
    }
    for (const f of changed.filter(notExcluded)) applyDecision(decisions.get(f), commonDir, workflowsDir, f, counters, srcText);
  }
```

- [ ] **Step 4: `listWorkflowConflicts`에 common 스캔 추가**

`listWorkflowConflicts` 함수(현재 145~165행) 전체를 다음으로 교체:

```javascript
// 대상 워크플로우 디렉토리에서 changed(충돌) 파일 목록만 뽑는다 — copyWorkflowsInteractive의 사전 조사용.
// copyWorkflows 본체와 동일한 classify 기준을 써야 결정 Map이 실제 처리 대상과 1:1로 맞는다.
// common도 타입별과 동일하게 스캔한다 (issue #20 H3 — 이전에는 common 충돌이 질문조차 되지 않았다).
export function listWorkflowConflicts(context, payloadRoot, targetRoot = ".") {
  const { types = [], paths = new Map(), includeNexus = false, repoName = "", resolvers = {} } = context;
  const workflowsDir = join(targetRoot, PATHS.workflowsDir);
  const projectTypesDir = join(payloadRoot, PAYLOAD.workflowsDir);
  const srcText = makeSrcText(context.branches || null);
  const branchMode = context.branches?.mode || "pr-flow";
  const conflicts = []; // [{ filename, type }] — 엔진 처리 순서와 동일 (common → 타입 순회 → 직하위 → server-deploy)

  const commonDir = join(projectTypesDir, "common");
  if (exists(commonDir)) {
    const envOpts = { type: "common", projectPath: ".", repoName, resolvers };
    for (const f of classify(commonDir, workflowsDir, envOpts, srcText).changed) {
      if (branchMode === "trunk-based" && TRUNK_BASED_EXCLUDED.has(f)) continue;
      conflicts.push({ filename: f, type: "common" });
    }
  }

  for (const type of types) {
    const envOpts = { type, projectPath: paths.get(type) || ".", repoName, resolvers };
    const typeDir = join(projectTypesDir, type);
    if (exists(typeDir)) {
      for (const f of classify(typeDir, workflowsDir, envOpts, srcText).changed) conflicts.push({ filename: f, type });
    }
    const serverDeployDir = join(typeDir, "server-deploy");
    if (exists(serverDeployDir) && !includeNexus) {
      for (const f of classify(serverDeployDir, workflowsDir, envOpts, srcText).changed) conflicts.push({ filename: f, type });
    }
  }
  return conflicts;
}
```

- [ ] **Step 5: 테스트 재실행 → 통과 확인**

Run: `node --test tests/node/workflow-conflicts.test.js`
Expected: PASS

- [ ] **Step 6: `tests/node/plan-workflows.test.js`의 이제 사실이 아닌 주석/테스트명 정리**

`tests/node/plan-workflows.test.js:25`의 주석을 교체:

```javascript
    // common 워크플로우도 newFiles에 포함되는지 확인
```

`tests/node/plan-workflows.test.js:46`의 테스트명을 교체:

```javascript
test("planWorkflows: editing an installed COMMON file surfaces it as changed", () => {
```

- [ ] **Step 7: 이제 사실이 아닌 나머지 주석 2곳 정리 (fable5 리뷰 반영)**

`src/core/copy/workflows.js`의 `planWorkflows` 함수 위 주석(현재 250~252행) 교체:

```javascript
// 전체 워크플로우 분류(common + 타입별 + server-deploy + nexus opt-in) — status/dry-run 공용.
// changed뿐 아니라 newFiles/unchanged까지 전부 반환한다는 점이 listWorkflowConflicts(changed만
// 반환)와 다르다(읽기 전용 — 실제로 아무 파일도 쓰지 않는다).
```

`tests/node/gitignore-trigger.test.js`의 NOTE 주석(현재 33~36행) 교체:

```javascript
// NOTE: 아래 두 테스트는 PROJECT-PYTHON-CI.yaml(타입별 워크플로우)을 예시로 쓴다 — 특정 파일로
// 고정해 테스트를 안정적으로 만든 것일 뿐, issue #20 H3 수정 이후로는 PROJECT-COMMON-*.yaml도
// 동일한 3지선(backup/template 결정)을 거치므로 common 파일로도 이 테스트가 성립한다.
// (payload/workflows/python/에 파일이 존재하는지는 확인됨.)
```

- [ ] **Step 8: 전체 워크플로우 관련 테스트 실행 → 회귀 확인**

Run: `node --test tests/node/workflow-conflicts.test.js tests/node/workflows-copied-files.test.js tests/node/plan-workflows.test.js tests/node/gitignore-trigger.test.js`
Expected: PASS (전부)

- [ ] **Step 9: 커밋**

```bash
git add src/core/copy/workflows.js tests/node/workflow-conflicts.test.js tests/node/plan-workflows.test.js tests/node/gitignore-trigger.test.js
git commit -m "fix: common 워크플로우 재설치 시 3지선 없이 무조건 덮어써지던 문제 수정 (issue #20 H3)"
```

---

### Task 2: M7 — `.gitignore` 배너 제거가 중간 삽입 줄에서 멈추던 문제

**Files:**
- Modify: `src/core/copy/gitignore.js` (전체 — 상단 주석, `BANNER_END` 상수 추가, `ensureGitignore`, `removeAutoAddedEntriesFromGitignore`)
- Modify: `tests/node/gitignore-remove.test.js` (새 테스트 2개 추가)

**Interfaces:**
- Consumes: 없음(자기 완결 모듈).
- Produces: `ensureGitignore`/`hasAutoAddedEntries`/`removeAutoAddedEntriesFromGitignore` 공개 시그니처·반환값 형태(`{created, added}` / `boolean` / `'removed'|'file-deleted'|'skip-no-gitignore'|'skip-not-found'`) 전부 무변경 — 내부 판별 로직만 정교해진다.

- [ ] **Step 1: 실패하는 테스트 작성 — `tests/node/gitignore-remove.test.js` 끝에 추가**

```javascript
test("removeAutoAddedEntriesFromGitignore: a user line inserted between the two required entries is preserved, both entries removed (issue #20 M7)", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-gitignore-remove-"));
  try {
    const original = "node_modules/\ndist/\n";
    writeFileSync(join(target, ".gitignore"), original);
    ensureGitignore(target);
    const installed = readFileSync(join(target, ".gitignore"), "utf8");
    const withInsertedLine = installed.replace("*.bak\n*.template.yaml\n", "*.bak\nmy-own-entry/\n*.template.yaml\n");
    writeFileSync(join(target, ".gitignore"), withInsertedLine);

    const status = removeAutoAddedEntriesFromGitignore(target);
    assert.strictEqual(status, "removed");
    const after = readFileSync(join(target, ".gitignore"), "utf8");
    assert.ok(after.startsWith(original));
    assert.ok(!after.includes("*.bak"));
    assert.ok(!after.includes("*.template.yaml"));
    assert.ok(!after.includes("project-auto-wizard"));
    assert.strictEqual(after, original + "my-own-entry/\n");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeAutoAddedEntriesFromGitignore: legacy banner without an end marker falls back to consecutive-match removal (documented limitation)", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-gitignore-remove-"));
  try {
    const original = "node_modules/\ndist/\n";
    const legacyBanner =
      "\n" +
      "# ====================================================================\n" +
      "# project-auto-wizard: Auto-added entries\n" +
      "# ====================================================================\n" +
      "*.bak\n" +
      "my-own-entry/\n" +
      "*.template.yaml\n"; // 종료 마커 없음 — 이 수정 이전 버전이 설치한 형태를 그대로 재현
    writeFileSync(join(target, ".gitignore"), original + legacyBanner);

    const status = removeAutoAddedEntriesFromGitignore(target);
    assert.strictEqual(status, "removed");
    const after = readFileSync(join(target, ".gitignore"), "utf8");
    // 문서화된 한계: 연속 매치가 my-own-entry/에서 끊겨 *.template.yaml은 제거되지 않는다.
    assert.ok(after.includes("*.template.yaml"), "legacy fallback stops at the first mismatch (documented limitation)");
    assert.ok(!after.includes("*.bak"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 테스트 실행 → 첫 번째 신규 테스트 실패 확인**

Run: `node --test tests/node/gitignore-remove.test.js`
Expected: 첫 번째("a user line inserted...") FAIL — 현재 로직은 `my-own-entry/`에서 연속 매치가 끊겨 `*.template.yaml`이 안 지워짐. 두 번째("legacy banner...")는 현재 로직 자체가 이미 그 동작이므로 PASS할 수 있음(그래도 실행해서 확인).

- [ ] **Step 3: `src/core/copy/gitignore.js` 상단 주석 교체**

파일 1~7행을 다음으로 교체:

```javascript
// .gitignore 보장 — 마법사 자신이 만드는 충돌 백업 부산물(*.bak, *.template.yaml)만 대상으로 한다.
// 마법사가 설치하는 것과 무관한 개인 개발환경 설정(IDE 등)은 마법사 책임 범위 밖 — issue #7.
// 배너 블록은 종료 마커(BANNER_END)로 범위가 명확히 구분되어 있어, 그 안에 사용자가 다른 줄을
// 끼워넣어도 REQUIRED_ENTRIES만 정확히 개별 제거하고 나머지는 보존한다 (issue #20 M7).
// 주의(의도된 트레이드오프): 이 수정 이전 버전으로 설치되어 종료 마커가 없는 배너가 이미 있는
// 레포에서는, 배너 직후 REQUIRED_ENTRIES가 연속으로 이어지는 동안만 제거하는 구 방식으로
// 폴백한다 — issue #7이 "이미 설치된 레포의 .gitignore는 소급 처리하지 않고 사용자 판단에
// 맡긴다"고 명시하므로 별도 마이그레이션 로직을 추가하지 않는다.
```

- [ ] **Step 4: `BANNER_END` 상수 추가 및 `ensureGitignore`에서 사용**

`BANNER` 상수 정의(현재 67~71행) 바로 뒤에 추가:

```javascript
// REQUIRED_ENTRIES 뒤에 오는 종료 마커 — 배너 블록의 "끝"을 명확히 구분해, 그 사이에 사용자가
// 다른 줄을 끼워넣어도 removeAutoAddedEntriesFromGitignore가 정확한 범위 안에서 개별 제거할 수
// 있게 한다 (issue #20 M7). ensureGitignore가 기존 파일에 배너를 추가할 때만 함께 쓴다
// (신규 파일 생성 케이스는 NEW_FILE_CONTENT를 통째로 쓰고 종료 마커는 쓰지 않는다 —
// startsWith 전체 prefix 매칭이라 별도 마커가 필요 없다).
const BANNER_END = "# ==== project-auto-wizard: end of auto-added entries ====\n";
```

`ensureGitignore`의 엔트리 작성 루프(현재 59행) 바로 뒤에 한 줄 추가:

```javascript
  for (const e of toAdd) content += e + "\n";
  content += BANNER_END;
  writeFileSync(p, content);
```

- [ ] **Step 5: `removeAutoAddedEntriesFromGitignore` 재작성**

기존 파일에 배너가 붙은 경우를 처리하는 블록(현재 100~113행: `const idx = content.indexOf(BANNER);` 이후 전체)을 다음으로 교체:

```javascript
  // 기존 파일에 배너 블록이 붙은 경우.
  const idx = content.indexOf(BANNER);
  if (idx === -1) return "skip-not-found";
  const afterBanner = idx + BANNER.length;

  // 종료 마커가 있으면(이 수정 이후 설치분) 그 범위 안에서 REQUIRED_ENTRIES만 개별적으로
  // 제거하고, 사용자가 그 사이에 끼워넣은 줄은 순서·연속 여부와 무관하게 그대로 보존한다
  // (issue #20 M7).
  const endIdx = content.indexOf(BANNER_END, afterBanner);
  if (endIdx !== -1) {
    const region = content.slice(afterBanner, endIdx).split("\n");
    const kept = region.filter((line) =>
      !REQUIRED_ENTRIES.some((e) => normalizeGitignoreEntry(line) === normalizeGitignoreEntry(e)));
    const afterEndMarker = content.slice(endIdx + BANNER_END.length);
    writeFileSync(p, content.slice(0, idx) + kept.join("\n") + afterEndMarker);
    return "removed";
  }

  // 종료 마커가 없는 구버전 설치(이 수정 이전) — 배너 직후 REQUIRED_ENTRIES가 연속으로
  // 이어지는 동안만 제거하는 기존 방식으로 폴백한다 (issue #7과 동일한 소급 미처리 원칙).
  const lines = content.slice(afterBanner).split("\n");
  let consumed = 0;
  for (const line of lines) {
    const isKnownEntry = REQUIRED_ENTRIES.some((e) => normalizeGitignoreEntry(line) === normalizeGitignoreEntry(e));
    if (!isKnownEntry) break;
    consumed += line.length + 1; // +1: split이 삼킨 "\n"
  }
  writeFileSync(p, content.slice(0, idx) + content.slice(afterBanner + consumed));
  return "removed";
```

`BANNER` 정의 위 주석(현재 64~66행)도 갱신:

```javascript
// ensureGitignore가 기존 파일에 배너 블록을 추가할 때 항상 이 정확한 시퀀스로 시작한다
// (빈 줄 하나 + 3줄 배너), 그리고 REQUIRED_ENTRIES 뒤에 BANNER_END로 끝난다. 배너~BANNER_END
// 범위 안에서 REQUIRED_ENTRIES와 일치하는 줄만 개별 제거하고, 사용자가 그 사이/뒤에 추가한
// 줄은 절대 건드리지 않는다 (issue #20 M7).
```

- [ ] **Step 6: 테스트 재실행 → 전부 통과 확인**

Run: `node --test tests/node/gitignore-remove.test.js tests/node/gitignore-trigger.test.js`
Expected: PASS (gitignore-remove: 기존 7개 + 신규 2개 = 9개, gitignore-trigger: 기존 그대로)

- [ ] **Step 7: 커밋**

```bash
git add src/core/copy/gitignore.js tests/node/gitignore-remove.test.js
git commit -m "fix: gitignore 배너 블록에 종료 마커를 도입해 중간 삽입 줄에서도 정확히 제거되도록 수정 (issue #20 M7)"
```

---

### Task 3: M8 — `version.yml`의 사용자 임의 최상위 필드가 재실행마다 소실됨

**Files:**
- Modify: `src/core/version-yml.js` (`parseExtraTopLevel` 신규 함수, `parseExisting`, `buildVersionYml`)
- Modify: `src/commands/version.js` (`runVersion`)
- Modify: `src/commands/full.js` (`runFull`)
- Modify: `src/commands/dry-run.js` (`versionYmlPreview`)
- Create: `tests/node/version-yml.test.js`

**Interfaces:**
- Consumes: 없음(순수 함수 확장).
- Produces: `parseExisting(content)`가 반환하는 객체에 `extraTopLevel: string[]` 필드 추가(기존 필드는 무변경 — 호출부가 구조분해로 일부만 꺼내 쓰는 기존 코드는 영향 없음). `buildVersionYml(opts)`의 `opts`에 `extraTopLevel = []`(옵션, 기본값 있음) 추가 — 기존 호출부는 수정 없이도 동작(빈 배열 기본값). `parseExtraTopLevel(content): string[]`은 새 공개 함수.

- [ ] **Step 1: 실패하는 테스트 작성 — `tests/node/version-yml.test.js` 새로 생성**

```javascript
// tests/node/version-yml.test.js
// issue #20 M8 — version.yml 재생성 시 사용자가 추가한 알려지지 않은 최상위 필드가 보존되는지 검증.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseExisting, parseExtraTopLevel, buildVersionYml } from "../../src/core/version-yml.js";
import { readVersionYmlTemplate, resolvePayloadRoot } from "../../src/core/assets.js";
import { runFull } from "../../src/commands/full.js";
import { runVersion } from "../../src/commands/version.js";
import { createContext } from "../../src/context.js";

const PAYLOAD = resolvePayloadRoot();

test("parseExtraTopLevel: captures an unknown scalar top-level field", () => {
  const content = [
    'version: "1.0.0"',
    "qa_custom_field: hello",
    "metadata:",
    '  last_updated: "2026-08-04"',
  ].join("\n");
  assert.deepStrictEqual(parseExtraTopLevel(content), ["qa_custom_field: hello"]);
});

test("parseExtraTopLevel: captures an unknown top-level key containing a hyphen (issue #20 review — regex must allow hyphens)", () => {
  const content = ['version: "1.0.0"', "deploy-notes: keep this"].join("\n");
  assert.deepStrictEqual(parseExtraTopLevel(content), ["deploy-notes: keep this"]);
});

test("parseExtraTopLevel: known top-level keys (version/project_paths/metadata/deploy) are never captured", () => {
  const content = [
    'version: "1.0.0"',
    "version_code: 1",
    'project_types: ["node"]',
    'project_type: "node"',
    "project_paths:",
    '  node: "."',
    "metadata:",
    '  last_updated: "2026-08-04"',
    "deploy:",
    "  node:",
    '    HOST: "x"',
  ].join("\n");
  assert.deepStrictEqual(parseExtraTopLevel(content), []);
});

test("parseExtraTopLevel: preserves a multi-line block belonging to an unknown top-level key", () => {
  const content = [
    'version: "1.0.0"',
    "custom_block:",
    "  nested_a: 1",
    "  nested_b: 2",
    "metadata:",
    '  last_updated: "2026-08-04"',
  ].join("\n");
  assert.deepStrictEqual(parseExtraTopLevel(content), ["custom_block:\n  nested_a: 1\n  nested_b: 2"]);
});

test("parseExisting: exposes extraTopLevel alongside known fields", () => {
  const content = ['version: "1.0.0"', "qa_custom_field: hello"].join("\n");
  const result = parseExisting(content);
  assert.deepStrictEqual(result.extraTopLevel, ["qa_custom_field: hello"]);
});

test("buildVersionYml: re-appends extraTopLevel blocks at the end, in original order", () => {
  const text = buildVersionYml({
    templateText: readVersionYmlTemplate(PAYLOAD),
    version: "1.0.0", types: ["basic"], paths: new Map(), branch: "main",
    branches: { main: "main", develop: "develop", mode: "pr-flow" },
    versionCode: 1, now: "2026-08-04 00:00:00", today: "2026-08-04",
    templateOptions: { templateVersion: "0.1.0" },
    extraTopLevel: ["first_field: a", "second_block:\n  x: 1"],
  });
  const firstIdx = text.indexOf("first_field: a");
  const secondIdx = text.indexOf("second_block:");
  assert.ok(firstIdx > 0);
  assert.ok(secondIdx > firstIdx);
});

test("integration: qa_custom_field survives a --mode version re-run (issue #20 repro)", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-version-yml-preserve-"));
  try {
    const baseCtx = createContext({
      mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
      branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
      paths: new Map(),
      now: "2026-08-04 00:00:00", today: "2026-08-04", templateVersion: "0.1.0",
    });
    runFull(baseCtx, PAYLOAD, target);

    const vyPath = join(target, "version.yml");
    writeFileSync(vyPath, readFileSync(vyPath, "utf8") + "qa_custom_field: hello\n");

    runVersion(baseCtx, PAYLOAD, target);

    const after = readFileSync(vyPath, "utf8");
    assert.ok(after.includes("qa_custom_field: hello"), "user-added field must survive a version-mode re-run");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `node --test tests/node/version-yml.test.js`
Expected: FAIL — `parseExtraTopLevel`가 아직 export되지 않아 import 자체가 깨짐.

- [ ] **Step 3: `src/core/version-yml.js`에 `parseExtraTopLevel` 추가 및 `parseExisting`에 연결**

파일 상단(`export function parseTemplateOptions` 앞, 4행 이후)에 상수와 함수 추가:

```javascript
// version.yml.template이 아는 최상위 키 — 이 밖의 최상위 키는 사용자가 직접 추가한 것으로 간주한다.
const KNOWN_TOP_LEVEL_KEYS = new Set([
  "version", "version_code", "project_types", "project_type", "project_paths", "metadata", "deploy",
]);

// 최상위 레벨의 알려지지 않은 필드(사용자가 직접 추가한 임의 필드)를 원본 그대로 보존한다
// (issue #20 M8). 각 알려지지 않은 최상위 키부터 다음 최상위 키 직전까지를 통째로 한 블록으로
// 캡처한다(중첩 구조가 있어도 유효한 YAML로 남기기 위함). metadata/project_paths/deploy처럼
// 이 모듈이 이미 아는 블록 "내부"의 알려지지 않은 하위 키는 대상이 아니다(범위 밖 — issue #20 결정).
export function parseExtraTopLevel(content) {
  const blocks = [];
  let current = null;
  for (const line of String(content || "").split("\n")) {
    // 최상위 키는 하이픈을 포함할 수 있다(YAML 관례) — issue #20 M8 리뷰에서 지적된 놓침 방지.
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):/);
    if (m) {
      if (current) blocks.push(current.join("\n"));
      current = KNOWN_TOP_LEVEL_KEYS.has(m[1]) ? null : [line];
      continue;
    }
    if (current) current.push(line);
  }
  if (current) blocks.push(current.join("\n"));
  return blocks;
}
```

`parseExisting`의 반환문(현재 `return { version, versionCode, types, paths, templateVersion, options, branches };`)을 교체:

```javascript
  return { version, versionCode, types, paths, templateVersion, options, branches, extraTopLevel: parseExtraTopLevel(text) };
```

- [ ] **Step 4: `buildVersionYml`이 `extraTopLevel`을 받아 재부착하도록 수정**

함수 시그니처(현재):

```javascript
export function buildVersionYml({
  templateText, version, types = [], primaryType, paths = new Map(), pathMarkers = new Map(),
  branch = "main", branches = null, versionCode = 1, now, today,
  templateOptions = null, deployValues = new Map(),
}) {
```

교체:

```javascript
export function buildVersionYml({
  templateText, version, types = [], primaryType, paths = new Map(), pathMarkers = new Map(),
  branch = "main", branches = null, versionCode = 1, now, today,
  templateOptions = null, deployValues = new Map(), extraTopLevel = [],
}) {
```

함수 위 JSDoc 주석의 `opts:` 목록에 항목 추가:

```javascript
// opts: { templateText, version, types:[], primaryType?, paths:Map, pathMarkers?:Map,
//         branch, branches?, versionCode, now, today, templateOptions?, deployValues?,
//         extraTopLevel?:string[] }  ← 기존 version.yml의 알려지지 않은 최상위 필드 보존 (issue #20 M8)
```

함수 말미(현재):

```javascript
  let text = out.join("\n");
  if (!text.endsWith("\n")) text += "\n";
  return text.replace(/\n{3,}$/, "\n"); // 말미 과잉 빈 줄 정리
```

교체:

```javascript
  let text = out.join("\n");
  if (extraTopLevel.length) {
    if (!text.endsWith("\n")) text += "\n";
    text += "\n" + extraTopLevel.join("\n\n");
  }
  if (!text.endsWith("\n")) text += "\n";
  return text.replace(/\n{3,}$/, "\n"); // 말미 과잉 빈 줄 정리
```

- [ ] **Step 5: 테스트 재실행 → unit 테스트 통과, integration 테스트는 아직 실패 확인**

Run: `node --test tests/node/version-yml.test.js`
Expected: `parseExtraTopLevel`/`parseExisting`/`buildVersionYml` 관련 6개 PASS. "integration: qa_custom_field survives..." 는 아직 FAIL(호출부가 `extraTopLevel`을 안 넘김).

- [ ] **Step 6: `src/commands/version.js`(`runVersion`)가 기존 파일을 읽어 `extraTopLevel`을 넘기도록 수정**

파일 전체를 다음으로 교체:

```javascript
// version 모드 (.sh execute_integration version case 등가).
// 순서: version.yml → readme → scripts.
// (워크플로우를 복사하지 않으므로 충돌 백업 부산물이 생길 수 없다 — gitignore 갱신 대상 없음, issue #7.
//  util·issue·setup-guide는 스코프 제외.)
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { writeText } from "../core/fsutil.js";
import { PATHS } from "../core/paths.js";
import { buildVersionYml, parseExisting } from "../core/version-yml.js";
import { readVersionYmlTemplate } from "../core/assets.js";
import { markerForType } from "../core/detect.js";
import { addVersionSectionToReadme } from "../core/copy/readme.js";
import { copyScripts } from "../core/copy/simple.js";

export function runVersion(context, payloadRoot, targetRoot = ".") {
  const { version, types = [], paths = new Map(), branch = "main", versionCode = 1,
    now, today, templateVersion = "unknown",
    includeNexus = false, includeSecretBackup = false,
    includeSemverAuto } = context;

  const pathMarkers = new Map();
  for (const [t] of paths) pathMarkers.set(t, markerForType(t));

  // 기존 version.yml의 알려지지 않은 최상위 필드를 재생성 시 보존한다 (issue #20 M8).
  const vyPath = join(targetRoot, PATHS.versionFile);
  const extraTopLevel = existsSync(vyPath) ? parseExisting(readFileSync(vyPath, "utf8")).extraTopLevel : [];

  writeText(join(targetRoot, PATHS.versionFile),
    buildVersionYml({
      templateText: readVersionYmlTemplate(payloadRoot),
      version, types, paths, pathMarkers, branch, branches: context.branches, versionCode, now, today,
      extraTopLevel,
      templateOptions: { templateVersion, includeNexus, includeSecretBackup, includeSemverAuto: includeSemverAuto !== false, optionsDate: today },
    }));
  addVersionSectionToReadme(version, targetRoot);
  copyScripts(payloadRoot, targetRoot);
}
```

- [ ] **Step 7: 테스트 재실행 → integration 테스트 통과 확인**

Run: `node --test tests/node/version-yml.test.js`
Expected: PASS (전체 7개)

- [ ] **Step 8: `src/commands/full.js`(`runFull`)도 동일하게 수정 (full 모드 재실행 시에도 보존되어야 함)**

파일 전체를 다음으로 교체:

```javascript
// full 모드 오케스트레이터 (.sh execute_integration full case 등가).
// 복사 순서: workflows(+env 치환) → version.yml → readme → scripts → gitignore(조건부)
// gitignore는 충돌 백업 부산물(.bak/.template.yaml)이 이번 실행에서 실제로 생겼을 때만 갱신한다 — issue #7.
// (원본의 util/issue/discussion/setup-guide/config 설치는 project-auto-wizard 스코프에서 제외 — DESIGN-SPEC §2)
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { writeText } from "../core/fsutil.js";
import { PATHS } from "../core/paths.js";
import { buildVersionYml, parseExisting } from "../core/version-yml.js";
import { readVersionYmlTemplate } from "../core/assets.js";
import { markerForType } from "../core/detect.js";
import { addVersionSectionToReadme } from "../core/copy/readme.js";
import { copyWorkflows } from "../core/copy/workflows.js";
import { copyScripts } from "../core/copy/simple.js";
import { ensureGitignore } from "../core/copy/gitignore.js";

// context: { version, types, paths:Map, branch, versionCode, includeNexus, includeSecretBackup,
//            force, repoName, resolvers, now, today }
// payloadRoot: 패키지 payload/ 루트. targetRoot: 통합 대상.
export function runFull(context, payloadRoot, targetRoot = ".", hooks = {}) {
  const { version, types = [], paths = new Map(), branch = "main", versionCode = 1,
    force = true, now, today, templateVersion = "unknown",
    includeNexus = false, includeSecretBackup = false,
    includeSemverAuto } = context;

  // project_paths 마커 계산 (.sh existing_marker_in_dir 등가 — 대표 마커명)
  const pathMarkers = new Map();
  for (const [t] of paths) pathMarkers.set(t, markerForType(t));

  // 1. 워크플로우 복사 (+ env 치환) — deploy 블록에 쓸 ask 값을 수집한다.
  //    hooks.decisions: 대화형 충돌 3지선 결정 Map (미지정=skip — 현행 force 동작)
  const wfCounters = copyWorkflows(context, payloadRoot, targetRoot, hooks);
  const deployValues = wfCounters.deployValues || new Map(); // Map<type, Map<key,value>>

  // 기존 version.yml의 알려지지 않은 최상위 필드를 재생성 시 보존한다 (issue #20 M8).
  const vyPath = join(targetRoot, PATHS.versionFile);
  const extraTopLevel = existsSync(vyPath) ? parseExisting(readFileSync(vyPath, "utf8")).extraTopLevel : [];

  // 2. version.yml 생성 (payload/version.yml.template 렌더링 — 전체 재생성 전략 D4)
  writeText(join(targetRoot, PATHS.versionFile),
    buildVersionYml({
      templateText: readVersionYmlTemplate(payloadRoot),
      version, types, paths, pathMarkers, branch, branches: context.branches, versionCode, now, today,
      deployValues, extraTopLevel,
      templateOptions: { templateVersion, includeNexus, includeSecretBackup, includeSemverAuto: includeSemverAuto !== false, optionsDate: today },
    }));

  // 3. README 버전 섹션
  addVersionSectionToReadme(version, targetRoot);

  // 4. scripts (payload/scripts/*.py → .github/scripts/)
  copyScripts(payloadRoot, targetRoot);

  // 5. gitignore — 워크플로우 충돌 처리가 .bak나 .template.yaml을 실제로 만든 경우에만 갱신한다.
  //    충돌 없는 설치(대부분의 최초 설치)는 .gitignore를 전혀 건드리지 않는다 — issue #7.
  const gitignoreUpdated = wfCounters.backupAdded > 0 || wfCounters.templateAdded > 0;
  if (gitignoreUpdated) ensureGitignore(targetRoot);

  return { workflows: wfCounters, gitignoreUpdated };
}
```

- [ ] **Step 9: `src/commands/dry-run.js`(`versionYmlPreview`)도 동일한 실제 렌더링 결과를 미리보기에 반영하도록 수정**

`versionYmlPreview` 함수 전체(현재 13~32행)를 다음으로 교체:

```javascript
function versionYmlPreview(context, payloadRoot, targetRoot) {
  const { version, types = [], paths = new Map(), branch = "main", versionCode = 1,
    now, today, templateVersion = "unknown",
    includeNexus = false, includeSecretBackup = false,
    includeSemverAuto } = context;
  const pathMarkers = new Map();
  for (const [t] of paths) pathMarkers.set(t, markerForType(t));

  const vyPath = join(targetRoot, PATHS.versionFile);
  const existingRaw = existsSync(vyPath) ? readFileSync(vyPath, "utf8") : null;
  const extraTopLevel = existingRaw !== null ? parseExisting(existingRaw).extraTopLevel : [];

  const wouldBe = buildVersionYml({
    templateText: readVersionYmlTemplate(payloadRoot),
    version, types, paths, pathMarkers, branch, branches: context.branches, versionCode, now, today,
    extraTopLevel,
    templateOptions: {
      templateVersion, includeNexus, includeSecretBackup,
      includeSemverAuto: includeSemverAuto !== false,
      optionsDate: today,
    },
  });
  return { existed: existingRaw !== null, changed: existingRaw !== wouldBe };
}
```

이 파일 상단 import에 `parseExisting`을 추가:

```javascript
import { buildVersionYml, parseExisting } from "../core/version-yml.js";
```

- [ ] **Step 10: 전체 테스트 재실행 → 회귀 확인**

Run: `node --test tests/node/version-yml.test.js tests/node/dry-run.test.js tests/node/dry-run-cli.test.js tests/node/install-matrix.test.js`
Expected: PASS (전부)

- [ ] **Step 11: 커밋**

```bash
git add src/core/version-yml.js src/commands/version.js src/commands/full.js src/commands/dry-run.js tests/node/version-yml.test.js
git commit -m "fix: version.yml의 사용자 임의 최상위 필드가 재실행마다 사라지던 문제 수정 (issue #20 M8)"
```

---

### Task 4: L9 — env 치환 값에 큰따옴표가 있으면 YAML 구조가 깨짐

**fable5 리뷰 반영:** 같은 버그(따옴표 무이스케이프 삽입)가 `src/core/version-yml.js`의 `buildVersionYml` deploy 블록 생성(`` `    ${k}: "${v}"` ``)에도 그대로 있다 — `@wizard ask`로 수집된 값이 `deployValues`를 거쳐 이 경로로도 삽입되므로, `setEnvLine`만 고치면 절반만 고치는 셈이다. 이 태스크에서 두 지점을 함께 고친다.

**Files:**
- Modify: `src/core/wizard-env.js` (`setEnvLine`, 새 공개 함수 `escapeYamlDoubleQuoted` 추출)
- Modify: `src/core/version-yml.js` (`buildVersionYml`의 deploy 블록 — 동일 이스케이프 재사용)
- Modify: `tests/node/wizard-env.test.js` (새 테스트 3개 추가)
- Modify: `tests/node/version-yml.test.js` (새 테스트 1개 추가 — Task 3에서 이미 생성된 파일)

**Interfaces:**
- Consumes: 없음.
- Produces: `setEnvLine(line, key, value)` 시그니처·정상 케이스 동작 무변경. 새 공개 함수 `escapeYamlDoubleQuoted(value): string`(`src/core/wizard-env.js`에서 export) — `src/core/version-yml.js`가 이를 import해 재사용한다. `buildVersionYml`의 공개 시그니처는 무변경.

- [ ] **Step 1: 실패하는 테스트 작성 — `tests/node/wizard-env.test.js` 끝에 추가**

```javascript
test("setEnvLine: escapes double quotes in the substituted value so YAML structure stays intact", () => {
  const out = setEnvLine(`KEY: "old" # @wizard ask:x`, "KEY", 'value with "quotes"');
  assert.strictEqual(out, `KEY: "value with \\"quotes\\""`);
});

test("setEnvLine: escapes backslashes so a literal backslash isn't consumed by the quote-escape", () => {
  const out = setEnvLine(`KEY: "old" # @wizard ask:x`, "KEY", "back\\slash");
  assert.strictEqual(out, `KEY: "back\\\\slash"`);
});

test("substituteEnv: an ask value containing double quotes produces valid quoted YAML (issue #20 L9)", () => {
  const content = `NAME: "default" # @wizard ask:default`;
  const values = new Map([["NAME", 'a "quoted" value']]);
  const out = substituteEnv(content, { values, useDefaults: false });
  assert.strictEqual(out, `NAME: "a \\"quoted\\" value"`);
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `node --test tests/node/wizard-env.test.js`
Expected: FAIL — 현재는 값이 이스케이프 없이 그대로 삽입되어 `KEY: "value with "quotes""`처럼 따옴표가 중간에 끊긴 결과가 나온다.

- [ ] **Step 3: `src/core/wizard-env.js`에 `escapeYamlDoubleQuoted`를 추출하고 `setEnvLine`이 재사용하도록 수정**

`setEnvLine` 함수 전체(현재 21~34행)를 다음으로 교체(새 함수 하나를 그 앞에 추가):

```javascript
// YAML 큰따옴표 문자열 안에 안전하게 넣기 위한 이스케이프(백슬래시 우선 — 그래야 그 다음에 붙이는
// 큰따옴표 이스케이프가 깨지지 않는다). @wizard 치환(setEnvLine)과 version.yml의 deploy 블록
// (buildVersionYml, src/core/version-yml.js) 양쪽에서 재사용한다 — issue #20 L9는 두 지점 모두에서
// 발생하는 동일한 버그다.
export function escapeYamlDoubleQuoted(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// .sh _wf_set_env 등가: `KEY: "..."` 따옴표 안 값 치환 + 그 줄 끝 `# @wizard ...` 주석 제거.
// 라인 하나에 대해 수행. value가 빈문자면 (.sh는 [ -n "$_val" ] 가드) 치환 스킵.
export function setEnvLine(line, key, value) {
  if (value === "" || value == null) return line;
  // CRLF 안전: 라인 끝 \r을 분리해 처리 후 복원 (autocrlf 프로젝트 대응)
  const cr = line.endsWith("\r") ? "\r" : "";
  const body = cr ? line.slice(0, -1) : line;
  const escaped = escapeYamlDoubleQuoted(value);
  // 값 치환: KEY: "기존값" → KEY: "value"
  let out = body.replace(
    new RegExp(`^(\\s*${key}:\\s*")[^"]*(")`),
    (_m, p1, p2) => `${p1}${escaped}${p2}`,
  );
  // 그 줄 끝 # @wizard ... 주석 제거 (앞 공백째)
  out = out.replace(/(\S)[^\S\r\n]*#[^\S\r\n]*@wizard[^\S\r\n].*$/, "$1");
  return out + cr;
}
```

- [ ] **Step 4: 테스트 재실행 → wizard-env 전체 통과 확인**

Run: `node --test tests/node/wizard-env.test.js`
Expected: PASS (기존 15개 + 신규 3개, 총 18개)

- [ ] **Step 5: 실패하는 테스트 작성 — `tests/node/version-yml.test.js`(Task 3에서 생성됨) 끝에 추가**

```javascript
test("buildVersionYml: escapes double quotes in deploy block values (issue #20 L9, second sink)", () => {
  const deployValues = new Map([["node", new Map([["HOST", 'a "quoted" host']])]]);
  const text = buildVersionYml({
    templateText: readVersionYmlTemplate(PAYLOAD),
    version: "1.0.0", types: ["node"], paths: new Map(), branch: "main",
    branches: { main: "main", develop: "develop", mode: "pr-flow" },
    versionCode: 1, now: "2026-08-04 00:00:00", today: "2026-08-04",
    templateOptions: { templateVersion: "0.1.0" },
    deployValues,
  });
  assert.ok(text.includes('HOST: "a \\"quoted\\" host"'));
});
```

- [ ] **Step 6: 테스트 실행 → 실패 확인**

Run: `node --test tests/node/version-yml.test.js`
Expected: FAIL — 현재 deploy 블록은 `` `    ${k}: "${v}"` ``로 값을 무이스케이프 삽입해 `HOST: "a "quoted" host"`처럼 깨진 결과가 나온다.

- [ ] **Step 7: `src/core/version-yml.js`가 `escapeYamlDoubleQuoted`를 재사용하도록 수정**

파일 맨 위(1행)에 import 추가(기존 최상단 주석 블록보다 앞에):

```javascript
import { escapeYamlDoubleQuoted } from "./wizard-env.js";

```

`buildVersionYml`의 deploy 블록 생성 부분을 교체:

```javascript
    for (const t of deployTypes) {
      rows.push(`  ${t}:`);
      for (const [k, v] of deployValues.get(t)) rows.push(`    ${k}: "${v}"`);
    }
```

교체:

```javascript
    for (const t of deployTypes) {
      rows.push(`  ${t}:`);
      // 동일한 이스케이프를 재사용 — deploy 값도 @wizard ask 값과 같은 경로로 들어오므로
      // 큰따옴표가 섞이면 setEnvLine과 동일하게 YAML이 깨진다 (issue #20 L9, 두 번째 지점).
      for (const [k, v] of deployValues.get(t)) rows.push(`    ${k}: "${escapeYamlDoubleQuoted(v)}"`);
    }
```

- [ ] **Step 8: 테스트 재실행 → 전체 통과 확인**

Run: `node --test tests/node/wizard-env.test.js tests/node/version-yml.test.js`
Expected: PASS (wizard-env 18개 + version-yml 기존 6개 + 신규 1개 = 7개, 총 25개)

- [ ] **Step 9: 커밋**

```bash
git add src/core/wizard-env.js src/core/version-yml.js tests/node/wizard-env.test.js tests/node/version-yml.test.js
git commit -m "fix: env 치환 값에 큰따옴표가 있으면 YAML 구조가 깨지던 문제 수정 (issue #20 L9)"
```

---

### Task 5: L12 — `revert`가 구버전에서 이름이 바뀐/삭제된 워크플로우 파일을 인식 못함

**Files:**
- Modify: `payload/workflows/**/*.yaml`, `payload/workflows/**/*.yml` (전체 28개 파일 — 첫 줄에 관리 마커 추가)
- Modify: `.github/workflows/PROJECT-COMMON-{AUTO-CHANGELOG-CONTROL,VERSION-CONTROL,RELEASE-PUBLISH,AI-PR-SUMMARY,README-VERSION-UPDATE}.yaml` (5개 — CONTRIBUTING.md 동기화 규칙에 따른 이 레포 자신의 dogfooding 사본)
- Modify: `src/commands/revert.js` (전체 재작성)
- Modify: `tests/node/revert-plan.test.js` (새 테스트 4개 추가, import 보강)

**Interfaces:**
- Consumes: 없음.
- Produces: `planRevert(payloadRoot, targetRoot): {workflows:string[], scripts:string[]}` / `runRevert(context, payloadRoot, targetRoot)` 공개 시그니처 무변경(호출부인 `src/index.js`, `src/commands/uninstall.js`, `src/commands/dry-run.js` 수정 불필요). 새 공개 상수 `MANAGED_WORKFLOW_MARKER: string`.

- [ ] **Step 1: 모든 payload 워크플로우 템플릿과 이 레포 자신의 dogfooding 사본에 관리 마커 추가**

아래 one-liner를 실행한다(멱등 — 이미 마커가 있는 파일은 건너뜀). 레포 루트에서 실행:

```bash
node -e '
const { readFileSync, writeFileSync, readdirSync, statSync } = require("node:fs");
const { join } = require("node:path");
const MARKER = "# project-auto-wizard:managed-workflow\n";
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ya?ml$/.test(entry)) out.push(p);
  }
  return out;
}
const targets = [
  ...walk("payload/workflows"),
  ".github/workflows/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml",
  ".github/workflows/PROJECT-COMMON-VERSION-CONTROL.yaml",
  ".github/workflows/PROJECT-COMMON-RELEASE-PUBLISH.yaml",
  ".github/workflows/PROJECT-COMMON-AI-PR-SUMMARY.yaml",
  ".github/workflows/PROJECT-COMMON-README-VERSION-UPDATE.yaml",
];
let n = 0;
for (const p of targets) {
  const body = readFileSync(p, "utf8");
  if (body.startsWith(MARKER)) continue;
  writeFileSync(p, MARKER + body);
  n++;
}
console.log(`marker added to ${n}/${targets.length} files`);
'
```

Expected 출력: `marker added to 33/33 files` (payload 28개 + dogfooding 사본 5개).

`.github/workflows/GITHUB-ISSUE-HELPER.yml`과 `.github/workflows/NPM-PUBLISH.yaml`은 payload가 아니라 이 레포 자체 전용 워크플로우이므로 마커를 붙이지 않는다(대상 목록에서 의도적으로 제외).

- [ ] **Step 2: 마커가 실제로 붙었는지, payload 관련 기존 테스트가 여전히 통과하는지 확인**

Run: `grep -rl "^# project-auto-wizard:managed-workflow" payload/workflows | wc -l`
Expected: `28`

Run: `node --test tests/node/payload-yaml.test.js tests/node/no-coderabbit.test.js tests/node/line-endings.test.js`
Expected: PASS (마커 추가는 순수 텍스트 추가라 기존 substring 기반 assertion에 영향 없음)

- [ ] **Step 3: 실패하는 테스트 작성 — `tests/node/revert-plan.test.js` 수정**

파일 상단 import 교체:

```javascript
// tests/node/revert-plan.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { planRevert, runRevert } from "../../src/commands/revert.js";
```

파일 끝에 새 테스트 4개 추가:

```javascript
test("planRevert: recognizes a marker-carrying workflow file even if its name no longer exists in the current payload (issue #20 L12)", () => {
  const target = installFixture();
  try {
    const wfDir = join(target, ".github/workflows");
    const renamedPath = join(wfDir, "PROJECT-COMMON-RENAMED-IN-A-LATER-RELEASE.yaml");
    // 실측: payload에는 이 파일명이 존재하지 않는다(과거 버전에서 설치된 뒤 이름이 바뀌었다고 가정) —
    // 그래도 마커가 있으면 인식돼야 한다.
    writeFileSync(renamedPath, "# project-auto-wizard:managed-workflow\nname: old-name\n");

    const plan = planRevert(resolvePayloadRoot(), target);
    assert.ok(plan.workflows.includes("PROJECT-COMMON-RENAMED-IN-A-LATER-RELEASE.yaml"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planRevert: a workflow file without the managed marker (user-authored) is never listed for removal", () => {
  const target = installFixture();
  try {
    const wfDir = join(target, ".github/workflows");
    writeFileSync(join(wfDir, "MY-OWN-CUSTOM-WORKFLOW.yaml"), "name: custom\non: push\n");

    const plan = planRevert(resolvePayloadRoot(), target);
    assert.ok(!plan.workflows.includes("MY-OWN-CUSTOM-WORKFLOW.yaml"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planRevert: recognizes .bak and .template.yaml variants created by a 'backup' decision", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-revert-plan-"));
  try {
    const ctx = createContext({
      mode: "full", force: true, types: ["spring"], version: "1.0.0", versionCode: 1,
      branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
      paths: new Map(),
      now: "2026-07-28 00:00:00", today: "2026-07-28", templateVersion: "0.1.0",
    });
    runFull(ctx, resolvePayloadRoot(), target); // spring server-deploy 파일 설치

    const wfDir = join(target, ".github/workflows");
    const targetFile = join(wfDir, "PROJECT-SPRING-GITHUB-PACKAGES-PUBLISH.yml");
    writeFileSync(targetFile, readFileSync(targetFile, "utf8") + "\n# edit\n");
    runFull(ctx, resolvePayloadRoot(), target, {
      decisions: new Map([["PROJECT-SPRING-GITHUB-PACKAGES-PUBLISH.yml", "backup"]]),
    });

    const plan = planRevert(resolvePayloadRoot(), target);
    assert.ok(plan.workflows.includes("PROJECT-SPRING-GITHUB-PACKAGES-PUBLISH.yml.bak"));
    assert.ok(plan.workflows.includes("PROJECT-SPRING-GITHUB-PACKAGES-PUBLISH.yml"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planRevert: a pre-marker install whose filename still matches the current payload is still recognized (no regression for existing installs — issue #20 리뷰 반영)", () => {
  const target = installFixture();
  try {
    // 이 수정 이전(마커가 없던 시절)에 설치된 상태를 흉내낸다 — 첫 줄의 마커를 지운다.
    const wfDir = join(target, ".github/workflows");
    const anyFile = readdirSync(wfDir)[0];
    const p = join(wfDir, anyFile);
    const withoutMarker = readFileSync(p, "utf8").replace(/^# project-auto-wizard:managed-workflow\n/, "");
    writeFileSync(p, withoutMarker);

    const plan = planRevert(resolvePayloadRoot(), target);
    assert.ok(plan.workflows.includes(anyFile), "filename-matching fallback must still recognize marker-less existing installs");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 4: 테스트 실행 → 실패 확인**

Run: `node --test tests/node/revert-plan.test.js`
Expected: FAIL — 현재 `payloadWorkflowNames`는 payload 파일명 집합과 정확히 일치하는 것만 보므로, 이름이 다른 `PROJECT-COMMON-RENAMED-IN-A-LATER-RELEASE.yaml`을 인식하지 못한다. 마지막 회귀 테스트("a pre-marker install...")는 현재 코드에서 이미 통과할 것(기존 파일명 매칭 로직 자체는 원래 이 케이스를 다뤘음) — 하이브리드로 재작성한 뒤에도 계속 통과해야 함을 고정하기 위한 것.

- [ ] **Step 5: `src/commands/revert.js` 전체 재작성**

파일 전체를 다음으로 교체:

```javascript
// revert 모드 — payload 유래 파일 + 마커로 식별되는 파일을 제거 (DESIGN-SPEC §4 되돌리기).
// 원칙: (a) 현재 payload에 존재하는 파일명과 정확히 일치하는 것, (b) 설치된 워크플로우 파일 중
// 마법사 관리 마커(MANAGED_WORKFLOW_MARKER)로 시작하는 것 — 이 둘의 합집합을 제거 대상으로 삼는다.
// (a)만으로는 과거 버전에서 설치된 뒤 이후 릴리스에서 payload 파일명이 바뀌거나 삭제된 파일을
// 인식하지 못했다 (issue #20 L12 원래 버그). 반대로 (b)만으로는 이 수정 이전에 설치되어 마커가
// 없는(그러나 파일명은 여전히 현재 payload와 일치하는) 기존 설치 전체를 인식하지 못하는 회귀가
// 생긴다 — 그래서 두 방식을 합집합으로 병행한다. 마커는 이 수정 이후 배포되는 payload 템플릿부터
// 포함되므로, (b) 경로가 실제로 새로 잡아내는 것은 "이름이 바뀌거나 삭제된, 마커가 있는" 파일뿐이다.
// 사용자가 직접 만든 워크플로우·version.yml·README·.gitignore는 건드리지 않는다
// (version.yml은 사용자 버전 데이터 — 제거 대상이 아니라 산출물이다).
import { join } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { PATHS, PAYLOAD } from "../core/paths.js";
import { remove } from "../core/fsutil.js";

// payload/workflows/**/*.yaml 첫 줄에 심어둔 고정 마커 — 이 값이 바뀌면 과거 설치분과의 매칭이 끊긴다.
export const MANAGED_WORKFLOW_MARKER = "# project-auto-wizard:managed-workflow";

// payload/workflows/** 전체(하위 폴더 포함)의 yaml 파일명 집합.
function payloadWorkflowNames(payloadRoot) {
  const names = new Set();
  const root = join(payloadRoot, PAYLOAD.workflowsDir);
  if (!existsSync(root)) return names;
  for (const e of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (e.isFile() && /\.(ya?ml)$/.test(e.name)) names.add(e.name);
  }
  return names;
}

// 설치된 워크플로우 디렉토리(평면 구조)에서 관리 마커로 시작하는 파일명 집합.
// .bak/.template.yaml 백업본도 원본 텍스트를 그대로 복사한 것이라 마커를 그대로 갖고 있어
// 확장자나 파일명 유추 없이 동일한 방식으로 인식된다 (issue #20 L12).
function markedWorkflowNames(wfDir) {
  const names = new Set();
  if (!existsSync(wfDir)) return names;
  for (const entry of readdirSync(wfDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const firstLine = readFileSync(join(wfDir, entry.name), "utf8").split("\n", 1)[0];
    if (firstLine === MANAGED_WORKFLOW_MARKER) names.add(entry.name);
  }
  return names;
}

// 아무것도 지우지 않는 순수 함수 — --dry-run과 status류 기능에서 재사용.
export function planRevert(payloadRoot, targetRoot = ".") {
  const removedWf = new Set();
  const removedScripts = [];
  const wfDir = join(targetRoot, PATHS.workflowsDir);
  if (existsSync(wfDir)) {
    // (a) 현재 payload와 파일명이 일치하는 것 — 기존 동작 그대로(마커 유무 무관, 기존 설치 회귀 방지).
    for (const name of payloadWorkflowNames(payloadRoot)) {
      const p = join(wfDir, name);
      if (existsSync(p)) removedWf.add(name);
      const templateName = (name.endsWith(".yaml") ? name.slice(0, -".yaml".length) : name) + ".template.yaml";
      if (existsSync(join(wfDir, templateName))) removedWf.add(templateName);
      if (existsSync(p + ".bak")) removedWf.add(name + ".bak");
    }
    // (b) 관리 마커로 시작하는 것 — payload에서 이름이 바뀌거나 삭제된 파일도 인식 (issue #20 L12).
    for (const name of markedWorkflowNames(wfDir)) removedWf.add(name);
  }
  for (const s of ["version_manager.py", "changelog_manager.py"]) {
    if (existsSync(join(targetRoot, PATHS.scriptsDir, s))) removedScripts.push(s);
  }
  return { workflows: [...removedWf], scripts: removedScripts };
}

// 반환: { workflows: [...제거된 파일명], scripts: [...] } — planRevert와 동일한 형태.
export function runRevert(context, payloadRoot, targetRoot = ".") {
  const plan = planRevert(payloadRoot, targetRoot);
  const wfDir = join(targetRoot, PATHS.workflowsDir);
  for (const name of plan.workflows) remove(join(wfDir, name));
  for (const name of plan.scripts) remove(join(targetRoot, PATHS.scriptsDir, name));
  return plan;
}
```

- [ ] **Step 6: 테스트 재실행 → 전부 통과 확인**

Run: `node --test tests/node/revert-plan.test.js`
Expected: PASS (기존 2개 + 신규 4개, 총 6개)

- [ ] **Step 7: uninstall 관련 테스트도 회귀 확인 (`planUninstall`이 `planRevert`를 재사용함)**

Run: `node --test tests/node/uninstall-plan.test.js tests/node/uninstall-cli.test.js tests/node/uninstall-flow.test.js tests/node/uninstall-dry-run.test.js tests/node/interactive-mode-uninstall.test.js`
Expected: PASS

- [ ] **Step 8: 전체 테스트 스위트 실행**

Run: `npm test`
Expected: PASS (node --test 전체 + python unittest 전체)

- [ ] **Step 9: 커밋**

```bash
git add payload/workflows .github/workflows/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml \
  .github/workflows/PROJECT-COMMON-VERSION-CONTROL.yaml .github/workflows/PROJECT-COMMON-RELEASE-PUBLISH.yaml \
  .github/workflows/PROJECT-COMMON-AI-PR-SUMMARY.yaml .github/workflows/PROJECT-COMMON-README-VERSION-UPDATE.yaml \
  src/commands/revert.js tests/node/revert-plan.test.js
git commit -m "fix: revert가 구버전에서 이름이 바뀌거나 삭제된 워크플로우 파일을 인식하지 못하던 문제 수정 (issue #20 L12)"
```

---

## Final Verification

- [ ] **전체 테스트 스위트 재실행**

Run: `npm test`
Expected: PASS (node:test 전체 + python unittest 전체 — 5개 태스크가 추가한 테스트를 모두 포함)

- [ ] **이슈 본문의 재현 시나리오 5개를 실제로 손으로 재현해 최종 확인** (선택 — 자동화된 통합 테스트가 이미 각 시나리오를 커버하므로 회귀 게이트로는 충분하지만, PR 설명에 "직접 재현 확인함"을 적으려면 수행)

```bash
# H3
node bin/project-auto-wizard.js --mode full --force --type react   # (임시 디렉터리에서)
echo "# marker" >> .github/workflows/PROJECT-REACT-CI.yaml
echo "# marker" >> .github/workflows/PROJECT-COMMON-RELEASE-PUBLISH.yaml
node bin/project-auto-wizard.js --mode full --force --type react
grep -q "# marker" .github/workflows/PROJECT-REACT-CI.yaml && echo "타입 파일 유지: OK"
grep -q "# marker" .github/workflows/PROJECT-COMMON-RELEASE-PUBLISH.yaml && echo "common 파일 유지: OK"
```
