# .gitignore 자동 수정 범위 재정의 (issue #7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `full`/`version` 모드가 설치 시 사용자의 `.gitignore`에 마법사와 무관한 개인 개발환경 항목(`/.idea`, `/.claude/settings.local.json`)을 조용히 추가하는 것을 없애고, 대신 마법사 자신의 충돌 처리 부산물(`*.bak`, `*.template.yaml`)이 **실제로 생겼을 때만** `.gitignore`를 갱신하도록 범위를 좁힌다.

**Architecture:** `src/core/copy/gitignore.js`의 `REQUIRED_ENTRIES`/`NEW_FILE_CONTENT`를 백업 부산물 패턴으로 교체한다. `full.js`는 `copyWorkflows()`/`copyCoderabbit()`의 실제 결과(백업·템플릿 생성 여부)를 확인해 조건부로만 `ensureGitignore()`를 호출한다. `version.js`는 워크플로우/coderabbit을 복사하지 않아 애초에 백업 부산물이 생길 수 없으므로 gitignore 로직 자체를 제거한다. uninstall 모드의 `--purge-gitignore`/체크리스트 opt-in은 그대로 유지 — 여전히 "마법사가 gitignore에 자동 추가한 항목을 정리"라는 동일한 역할을 하며, 문구도 이미 범용적이라 변경이 필요 없다.

**Tech Stack:** Node.js (순수 JS, 프레임워크 없음), `node:test` + `node:assert`(내장 테스트 러너).

## Global Constraints

- 커밋 메시지는 한국어로 작성하고, 브랜치 `20260801_#7_gitignore_자동_수정_기능_폐지_마법사_책임_범위_밖`의 helper 커밋 템플릿을 그대로 사용한다: `gitignore_자동_수정_기능_폐지_마법사_책임_범위_밖 : feat : {변경 사항에 대한 설명} https://github.com/Twin-Fang/project-auto-wizard/issues/7`
- 기존 코드 스타일(세미콜론, 2-space 들여쓰기, 한국어 주석)을 그대로 따른다.
- 각 태스크는 `node --test tests/node/<파일>` 로 독립적으로 검증 가능해야 한다. 최종 태스크에서 `npm run test:node` 전체 스위트를 돌린다.
- 이슈 본문이 요구하는 "IDE 설정 파일은 각자 .gitignore에 추가하세요" 같은 README 안내 문구는 **추가하지 않는다** (브레인스토밍에서 범위 재정의 후 불필요하다고 확정).
- `--purge-gitignore` 플래그명, uninstall 체크리스트 라벨(`.gitignore 자동 추가 항목`), README/help 문구는 이미 범용적으로 서술되어 있으므로 **문구를 바꾸지 않는다** — 오직 REQUIRED_ENTRIES의 실제 값과 트리거 조건만 바뀐다.

---

### Task 1: `.gitignore` 자동 추가 대상을 백업 부산물로 좁히기

**Files:**
- Modify: `src/core/copy/gitignore.js:1-33`
- Modify: `src/commands/purge.js:83` (사용자에게 출력되는 문구 — 코드 동작 무변경)
- Test: `tests/node/gitignore-remove.test.js:48`

**Interfaces:**
- Consumes: 없음 (리프 모듈).
- Produces: `ensureGitignore(targetRoot)`, `hasAutoAddedEntries(targetRoot)`, `removeAutoAddedEntriesFromGitignore(targetRoot)` — 시그니처 무변경, 내부 `REQUIRED_ENTRIES`/`NEW_FILE_CONTENT` 값만 교체. Task 2/3에서 그대로 재사용.

- [ ] **Step 1: 실패하는 테스트로 먼저 확인 — 기존 단언이 새 값과 맞지 않음을 확인**

`tests/node/gitignore-remove.test.js:48`은 현재 다음과 같다:

```js
    assert.ok(!after.includes("/.idea"));
```

이 줄을 새 백업 패턴을 확인하도록 바꾼다:

```js
    assert.ok(!after.includes("*.bak"));
```

- [ ] **Step 2: 테스트 실행 — 아직 실패해야 함(REQUIRED_ENTRIES가 옛 값이라 "*.bak"이 애초에 없어서 이 특정 단언은 통과하지만, 목적을 검증하려면 먼저 Step 3~4로 실제 동작을 바꿔야 한다)**

Run: `node --test tests/node/gitignore-remove.test.js`
Expected: 전체 PASS (이 단언은 REQUIRED_ENTRIES를 바꾸기 전에도 우연히 통과함 — `*.bak`이 파일에 없으므로. 진짜 회귀 방지는 Step 3~4 이후 재실행에서 확인한다.)

- [ ] **Step 3: `src/core/copy/gitignore.js`의 `REQUIRED_ENTRIES`를 백업 부산물로 교체**

현재:

```js
const REQUIRED_ENTRIES = ["/.idea", "/.claude/settings.local.json"];
```

변경:

```js
// issue #7: 마법사가 설치하는 것과 무관한 개인 개발환경 항목(/.idea 등)은 마법사 책임 밖이므로 제거.
// 대신 마법사 자신의 충돌 처리(workflows.js backup/template 결정, coderabbit.js 덮어쓰기 백업)가
// 실제로 만들어내는 부산물만 gitignore 대상으로 삼는다.
const REQUIRED_ENTRIES = ["*.bak", "*.template.yaml"];
```

- [ ] **Step 4: `NEW_FILE_CONTENT`(.gitignore가 아예 없을 때 새로 쓰는 내용)를 같은 의미로 교체**

현재:

```js
const NEW_FILE_CONTENT =
  "# IDE Settings\n" +
  "/.idea\n" +
  "\n" +
  "# Claude AI Settings\n" +
  "/.claude/settings.local.json\n";
```

변경:

```js
const NEW_FILE_CONTENT =
  "# project-auto-wizard: 충돌 처리 시 생성되는 백업 파일 (안전하게 무시해도 됩니다)\n" +
  "*.bak\n" +
  "*.template.yaml\n";
```

- [ ] **Step 5: 파일 최상단 주석도 새 범위에 맞게 갱신 (레거시 항목에 대한 의도적 트레이드오프 포함)**

현재 1번째 줄:

```js
// .gitignore 보장 (.sh ensure_gitignore + normalize/check 등가) — template_integrator.sh 3996~4111.
```

변경:

```js
// .gitignore 보장 — 마법사 자신이 만드는 충돌 백업 부산물(*.bak, *.template.yaml)만 대상으로 한다.
// 마법사가 설치하는 것과 무관한 개인 개발환경 설정(IDE 등)은 마법사 책임 범위 밖 — issue #7.
// 주의(의도된 트레이드오프): 이 변경 이전 버전으로 설치해 /.idea·/.claude/settings.local.json이 이미
// 배너 블록에 남아있는 레포에서 removeAutoAddedEntriesFromGitignore()를 실행하면, 배너는 제거되지만
// REQUIRED_ENTRIES가 더 이상 옛 항목과 일치하지 않아 그 두 줄은 지워지지 않고 배너 표시 없이 남는다.
// 이슈 #7이 "이미 설치된 레포의 .gitignore는 소급 처리하지 않고 사용자 판단에 맡긴다"고 명시하므로
// 별도 마이그레이션 로직을 추가하지 않는다 — 남은 항목은 무해하며 필요하면 사용자가 직접 지운다.
```

- [ ] **Step 6: `src/commands/purge.js`의 사용자 출력 문구를 새 범위에 맞게 갱신**

`printPurgeResult()`가 매 purge 실행 시 사용자에게 출력하는 안내 줄이 지금은 "별도 이슈에서 다룸"이라고 되어 있는데, 이 변경으로 그 이슈(#7)가 해결되므로 더는 맞지 않는 문구다. 동작(purge가 `.gitignore`를 절대 건드리지 않는다는 사실)은 그대로이므로 텍스트만 갱신한다. `tests/node/purge-cli.test.js`/`tests/node/purge-plan.test.js`를 포함해 이 문자열을 단언하는 테스트는 없다(확인 완료).

현재 (83번째 줄):

```js
  lines.push("(.gitignore 자동 추가 블록은 보존됩니다 — 별도 이슈에서 다룸)");
```

변경:

```js
  lines.push("(.gitignore에 추가된 백업 파일 제외 항목(*.bak/*.template.yaml)은 purge 대상에서 제외되어 그대로 보존됩니다)");
```

- [ ] **Step 7: 테스트 재실행 — 전체 통과 확인**

Run: `node --test tests/node/gitignore-remove.test.js tests/node/purge-cli.test.js tests/node/purge-plan.test.js`
Expected: 모든 테스트 PASS. 특히 `hasAutoAddedEntries`/`removeAutoAddedEntriesFromGitignore` 관련 테스트는 REQUIRED_ENTRIES 값이 바뀌어도 로직이 제네릭(배너 뒤 라인을 REQUIRED_ENTRIES와 비교)하므로 그대로 통과해야 하고, purge 관련 테스트는 이 문구를 단언하지 않으므로 영향 없어야 한다.

- [ ] **Step 8: 커밋**

```bash
git add src/core/copy/gitignore.js src/commands/purge.js tests/node/gitignore-remove.test.js
git commit -m "gitignore_자동_수정_기능_폐지_마법사_책임_범위_밖 : feat : .gitignore 자동 추가 대상을 개인 개발환경 항목에서 마법사 충돌 백업 부산물(*.bak/*.template.yaml)로 좁힘 https://github.com/Twin-Fang/project-auto-wizard/issues/7"
```

---

### Task 2: `full` 모드 — 충돌 백업이 실제로 생겼을 때만 `.gitignore` 갱신

**Files:**
- Modify: `src/core/copy/workflows.js:61-69,119-137,205-221`
- Modify: `src/commands/full.js` (전체)
- Test: `tests/node/gitignore-trigger.test.js` (신규 생성)

**Interfaces:**
- Consumes: Task 1의 `ensureGitignore(targetRoot)` (시그니처 무변경).
- Produces: `copyWorkflows()` 반환 객체에 `backupAdded: number` 필드 추가 (`copied`/`skipped`/`templateAdded`/`optionalCopied`와 동급). `runFull()` 반환 객체가 `{ workflows, gitignoreUpdated: boolean }` 형태로 바뀜 — Task 4가 `result.gitignoreUpdated`를 소비한다.

**범위 밖(의도적으로 손대지 않음):** `src/commands/workflows.js`(`--mode workflows`)의 `runWorkflows()`도 내부적으로 `copyWorkflows()`를 호출하므로 이론적으로는 backup/template 부산물을 만들 수 있지만, 이 명령은 애초에(변경 전에도) `ensureGitignore()`를 한 번도 호출한 적이 없다 — issue #7 이전부터 존재하던 별개의 동작이다. 이번 이슈는 `full`/`version` 모드의 gitignore 처리를 다루는 것이므로 `workflows.js`에 새 동작을 추가하지 않는다(스코프 확장 방지).

- [ ] **Step 1: 실패하는 테스트 작성 — `tests/node/gitignore-trigger.test.js` 신규 생성**

```js
// tests/node/gitignore-trigger.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";

function baseContext(overrides = {}) {
  return createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(),
    now: "2026-08-02 00:00:00", today: "2026-08-02", templateVersion: "0.1.0",
    ...overrides,
  });
}

test("runFull: 충돌 없는 최초 설치는 .gitignore를 전혀 만들지 않는다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-full-gitignore-"));
  try {
    const result = runFull(baseContext(), resolvePayloadRoot(), target);
    assert.strictEqual(result.gitignoreUpdated, false);
    assert.ok(!existsSync(join(target, ".gitignore")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// NOTE (Fable 검토 반영): PROJECT-COMMON-*.yaml은 "common" 워크플로우라 copyWorkflows()의
// common 분기(workflows.js:80-93)에서 changed여도 decisions Map을 거치지 않고 무조건 덮어쓴다 —
// backup/template 결정은 오직 타입별(copyWorkflowsForType) 워크플로우에서만 적용된다.
// 그래서 아래 두 테스트는 타입별 파일(PROJECT-PYTHON-CI.yaml, payload/workflows/python/에 존재 확인)을 써야 한다.
test("runFull: 타입별 워크플로우 충돌을 'backup'으로 처리하면 .gitignore에 *.bak이 추가된다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-full-gitignore-"));
  try {
    const ctx = baseContext({ types: ["python"] });
    const payloadRoot = resolvePayloadRoot();
    runFull(ctx, payloadRoot, target);
    const wfPath = join(target, ".github/workflows/PROJECT-PYTHON-CI.yaml");
    assert.ok(existsSync(wfPath));
    writeFileSync(wfPath, readFileSync(wfPath, "utf8") + "\n# user edit\n");

    const result = runFull(ctx, payloadRoot, target, {
      decisions: new Map([["PROJECT-PYTHON-CI.yaml", "backup"]]),
    });

    assert.ok(existsSync(wfPath + ".bak"));
    assert.strictEqual(result.gitignoreUpdated, true);
    assert.ok(existsSync(join(target, ".gitignore")));
    assert.ok(readFileSync(join(target, ".gitignore"), "utf8").includes("*.bak"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("runFull: 타입별 워크플로우 충돌을 'template'으로 처리하면 .gitignore에 *.template.yaml이 추가된다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-full-gitignore-"));
  try {
    const ctx = baseContext({ types: ["python"] });
    const payloadRoot = resolvePayloadRoot();
    runFull(ctx, payloadRoot, target);
    const wfPath = join(target, ".github/workflows/PROJECT-PYTHON-CI.yaml");
    writeFileSync(wfPath, readFileSync(wfPath, "utf8") + "\n# user edit\n");

    const result = runFull(ctx, payloadRoot, target, {
      decisions: new Map([["PROJECT-PYTHON-CI.yaml", "template"]]),
    });

    assert.ok(existsSync(join(target, ".github/workflows/PROJECT-PYTHON-CI.template.yaml")));
    assert.strictEqual(result.gitignoreUpdated, true);
    assert.ok(readFileSync(join(target, ".gitignore"), "utf8").includes("*.template.yaml"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("runFull: .coderabbit.yaml을 백업하며 덮어쓰면 .gitignore가 갱신된다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-full-gitignore-"));
  try {
    const payloadRoot = resolvePayloadRoot();
    const ctx = baseContext({ includeCodeRabbit: true });
    runFull(ctx, payloadRoot, target);
    assert.ok(existsSync(join(target, ".coderabbit.yaml")));
    assert.ok(!existsSync(join(target, ".gitignore")));

    // force:true 상태로 재설치 — 기존 .coderabbit.yaml을 .bak으로 백업 후 덮어쓴다.
    const result = runFull(ctx, payloadRoot, target);

    assert.ok(existsSync(join(target, ".coderabbit.yaml.bak")));
    assert.strictEqual(result.gitignoreUpdated, true);
    assert.ok(readFileSync(join(target, ".gitignore"), "utf8").includes("*.bak"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `node --test tests/node/gitignore-trigger.test.js`
Expected: FAIL — `result.gitignoreUpdated`가 `undefined`이거나(현재 `runFull`은 `{ workflows }`만 반환), 첫 번째 테스트는 현재 구현이 항상 `ensureGitignore`를 호출하므로 `.gitignore`가 이미 생성되어 있어 실패한다.

- [ ] **Step 3: `src/core/copy/workflows.js`에 `backupAdded` 카운터 추가**

`copyWorkflows` 반환 형태 주석(현재 61번째 줄):

```js
// 반환: {copied, skipped, templateAdded, optionalCopied}
```

변경:

```js
// 반환: {copied, skipped, templateAdded, optionalCopied, backupAdded}
```

카운터 초기화(현재 69번째 줄):

```js
  const counters = { copied: 0, skipped: 0, templateAdded: 0, optionalCopied: 0 };
```

변경:

```js
  const counters = { copied: 0, skipped: 0, templateAdded: 0, optionalCopied: 0, backupAdded: 0 };
```

`applyDecision`의 `'backup'` 분기(현재):

```js
  if (decision === "backup") {
    // .sh O) mv → cp: 기존을 .bak으로 백업 후 새 버전으로 교체
    renameSync(dst, dst + ".bak");
    writeText(dst, srcText(src));
    counters.copied++;
    return;
  }
```

변경:

```js
  if (decision === "backup") {
    // .sh O) mv → cp: 기존을 .bak으로 백업 후 새 버전으로 교체
    renameSync(dst, dst + ".bak");
    writeText(dst, srcText(src));
    counters.copied++;
    counters.backupAdded++;
    return;
  }
```

nexus opt-in 강제 백업 분기(현재):

```js
      if (existsSync(dst)) renameSync(dst, dst + ".bak");
      writeText(dst, body);
      counters.optionalCopied++;
      counters.copied++;
```

변경:

```js
      if (existsSync(dst)) { renameSync(dst, dst + ".bak"); counters.backupAdded++; }
      writeText(dst, body);
      counters.optionalCopied++;
      counters.copied++;
```

- [ ] **Step 4: `src/commands/full.js`를 조건부 gitignore 호출로 재작성**

파일 전체를 다음으로 교체:

```js
// full 모드 오케스트레이터 (.sh execute_integration full case 등가).
// 복사 순서: workflows(+env 치환) → version.yml → readme → scripts → coderabbit → gitignore(조건부)
// gitignore는 충돌 백업 부산물(.bak/.template.yaml)이 이번 실행에서 실제로 생겼을 때만 갱신한다 — issue #7.
// (원본의 util/issue/discussion/setup-guide/config 설치는 project-auto-wizard 스코프에서 제외 — DESIGN-SPEC §2)
import { join } from "node:path";
import { writeText } from "../core/fsutil.js";
import { PATHS } from "../core/paths.js";
import { buildVersionYml } from "../core/version-yml.js";
import { readVersionYmlTemplate } from "../core/assets.js";
import { markerForType } from "../core/detect.js";
import { addVersionSectionToReadme } from "../core/copy/readme.js";
import { copyWorkflows } from "../core/copy/workflows.js";
import { copyScripts } from "../core/copy/simple.js";
import { copyCoderabbit } from "../core/copy/coderabbit.js";
import { ensureGitignore } from "../core/copy/gitignore.js";

// context: { version, types, paths:Map, branch, versionCode, includeNexus, includeSecretBackup,
//            force, repoName, resolvers, now, today }
// payloadRoot: 패키지 payload/ 루트. targetRoot: 통합 대상.
export function runFull(context, payloadRoot, targetRoot = ".", hooks = {}) {
  const { version, types = [], paths = new Map(), branch = "main", versionCode = 1,
    force = true, now, today, templateVersion = "unknown",
    includeNexus = false, includeSecretBackup = false, includeCodeRabbit = false,
    includeSemverAuto } = context;

  // project_paths 마커 계산 (.sh existing_marker_in_dir 등가 — 대표 마커명)
  const pathMarkers = new Map();
  for (const [t] of paths) pathMarkers.set(t, markerForType(t));

  // 1. 워크플로우 복사 (+ env 치환) — deploy 블록에 쓸 ask 값을 수집한다.
  //    hooks.decisions: 대화형 충돌 3지선 결정 Map (미지정=skip — 현행 force 동작)
  const wfCounters = copyWorkflows(context, payloadRoot, targetRoot, hooks);
  const deployValues = wfCounters.deployValues || new Map(); // Map<type, Map<key,value>>

  // 2. version.yml 생성 (payload/version.yml.template 렌더링 — 전체 재생성 전략 D4)
  writeText(join(targetRoot, PATHS.versionFile),
    buildVersionYml({
      templateText: readVersionYmlTemplate(payloadRoot),
      version, types, paths, pathMarkers, branch, branches: context.branches, versionCode, now, today,
      deployValues,
      templateOptions: { templateVersion, includeNexus, includeSecretBackup, includeCodeRabbit: includeCodeRabbit === true, includeSemverAuto: includeSemverAuto !== false, optionsDate: today },
    }));

  // 3. README 버전 섹션
  addVersionSectionToReadme(version, targetRoot);

  // 4. scripts (payload/scripts/*.py → .github/scripts/)
  copyScripts(payloadRoot, targetRoot);

  // 5. coderabbit (opt-in true일 때만 — DESIGN-SPEC §4 질문②)
  const coderabbitResult = includeCodeRabbit === true ? copyCoderabbit(payloadRoot, { force }, targetRoot) : null;

  // 6. gitignore — 워크플로우/coderabbit 충돌 처리가 .bak나 .template.yaml을 실제로 만든 경우에만 갱신한다.
  //    충돌 없는 설치(대부분의 최초 설치)는 .gitignore를 전혀 건드리지 않는다 — issue #7.
  const gitignoreUpdated = wfCounters.backupAdded > 0 || wfCounters.templateAdded > 0 || coderabbitResult === "overwritten-backup";
  if (gitignoreUpdated) ensureGitignore(targetRoot);

  return { workflows: wfCounters, gitignoreUpdated };
}
```

- [ ] **Step 5: 테스트 재실행 — 전체 통과 확인**

Run: `node --test tests/node/gitignore-trigger.test.js`
Expected: 4개 테스트 모두 PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/core/copy/workflows.js src/commands/full.js tests/node/gitignore-trigger.test.js
git commit -m "gitignore_자동_수정_기능_폐지_마법사_책임_범위_밖 : feat : full 모드가 충돌 백업 부산물이 실제로 생겼을 때만 .gitignore를 갱신하도록 변경 https://github.com/Twin-Fang/project-auto-wizard/issues/7"
```

---

### Task 3: `version` 모드에서 gitignore 로직 완전 제거

**Files:**
- Modify: `src/commands/version.js` (전체)
- Test: `tests/node/gitignore-trigger.test.js` (Task 2에서 만든 파일에 테스트 추가)

**Interfaces:**
- Consumes: 없음 (이 태스크는 `version.js`에서 `ensureGitignore` 참조를 제거하는 것뿐).
- Produces: `runVersion()`의 동작 불변(반환값 없음, 기존과 동일) — 단 `.gitignore`를 절대 건드리지 않음.

- [ ] **Step 1: 실패하는 테스트 추가 — `tests/node/gitignore-trigger.test.js` 끝에 추가**

```js
import { runVersion } from "../../src/commands/version.js";

test("runVersion: 반복 설치해도 .gitignore를 절대 만들지 않는다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-version-gitignore-"));
  try {
    const payloadRoot = resolvePayloadRoot();
    const ctx = baseContext({ mode: "version" });
    runVersion(ctx, payloadRoot, target);
    runVersion(ctx, payloadRoot, target);
    assert.ok(!existsSync(join(target, ".gitignore")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

(`import { runVersion } ...` 줄은 파일 상단의 기존 import 블록에 함께 추가한다.)

- [ ] **Step 2: 테스트 실행 — 실패 확인 (RED)**

Run: `node --test tests/node/gitignore-trigger.test.js`
Expected: 새 테스트 FAIL — 현재 `version.js`는 아직 무조건 `ensureGitignore()`를 호출하므로 `.gitignore`가 생성되어 `assert.ok(!existsSync(...))`가 실패한다. 다음 Step에서 실제로 고친다.

- [ ] **Step 3: `src/commands/version.js`에서 gitignore 관련 코드 전부 제거**

파일 전체를 다음으로 교체:

```js
// version 모드 (.sh execute_integration version case 등가).
// 순서: version.yml → readme → scripts.
// (워크플로우/coderabbit을 복사하지 않으므로 충돌 백업 부산물이 생길 수 없다 — gitignore 갱신 대상 없음, issue #7.
//  util·issue·coderabbit·setup-guide는 스코프 제외.)
import { join } from "node:path";
import { writeText } from "../core/fsutil.js";
import { PATHS } from "../core/paths.js";
import { buildVersionYml } from "../core/version-yml.js";
import { readVersionYmlTemplate } from "../core/assets.js";
import { markerForType } from "../core/detect.js";
import { addVersionSectionToReadme } from "../core/copy/readme.js";
import { copyScripts } from "../core/copy/simple.js";

export function runVersion(context, payloadRoot, targetRoot = ".") {
  const { version, types = [], paths = new Map(), branch = "main", versionCode = 1,
    now, today, templateVersion = "unknown",
    includeNexus = false, includeSecretBackup = false, includeCodeRabbit = false,
    includeSemverAuto } = context;

  const pathMarkers = new Map();
  for (const [t] of paths) pathMarkers.set(t, markerForType(t));

  writeText(join(targetRoot, PATHS.versionFile),
    buildVersionYml({
      templateText: readVersionYmlTemplate(payloadRoot),
      version, types, paths, pathMarkers, branch, branches: context.branches, versionCode, now, today,
      templateOptions: { templateVersion, includeNexus, includeSecretBackup, includeCodeRabbit: includeCodeRabbit === true, includeSemverAuto: includeSemverAuto !== false, optionsDate: today },
    }));
  addVersionSectionToReadme(version, targetRoot);
  copyScripts(payloadRoot, targetRoot);
}
```

- [ ] **Step 4: 테스트 재실행 — 통과 확인**

Run: `node --test tests/node/gitignore-trigger.test.js`
Expected: 5개 테스트 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/commands/version.js tests/node/gitignore-trigger.test.js
git commit -m "gitignore_자동_수정_기능_폐지_마법사_책임_범위_밖 : feat : version 모드에서 .gitignore 자동 생성 로직 제거 https://github.com/Twin-Fang/project-auto-wizard/issues/7"
```

---

### Task 4: 완료 요약(summary)에 실제 gitignore 갱신 여부 반영

**Files:**
- Modify: `src/ui/summary.js:10-45`
- Modify: `src/index.js:309-314`
- Modify: `src/commands/interactive.js:249-252`
- Test: `tests/node/summary-output.test.js` (신규 생성)

**Interfaces:**
- Consumes: Task 2의 `runFull()` 반환값 `{ workflows, gitignoreUpdated }`.
- Produces: `printSummary(ctx, targetRoot)`가 `ctx.gitignoreUpdated`(boolean, 기본 false)를 받아 `full` 모드에서만 조건부로 체크리스트 줄을 출력. `version` 모드는 해당 줄을 아예 출력하지 않음.

**중요(Fable 검토 반영):** 실제로 backup/template 결정이 일어나는 유일한 경로는 **대화형(interactive) full 모드**의 충돌 3지선 메뉴다(비대화형 `--force` CLI는 항상 결정이 없어 `'skip'`으로 처리되므로 백업/템플릿이 생기지 않는다). 따라서 `src/index.js`뿐 아니라 `src/commands/interactive.js:249`의 `io.summary?.(...)` 호출도 반드시 함께 고쳐야 한다 — 여기를 빠뜨리면 새 요약 줄이 실제로는 절대 보이지 않는 죽은 코드가 된다.

- [ ] **Step 1: 실패하는 테스트 작성 — `tests/node/summary-output.test.js` 신규 생성**

```js
// tests/node/summary-output.test.js
import { test } from "node:test";
import assert from "node:assert";
import { printSummary } from "../../src/ui/summary.js";

function captureStderr(fn) {
  const original = process.stderr.write.bind(process.stderr);
  let output = "";
  process.stderr.write = (chunk) => { output += chunk; return true; };
  try {
    fn();
  } finally {
    process.stderr.write = original;
  }
  return output;
}

test("printSummary: full 모드 + gitignoreUpdated:true -> .gitignore 줄 출력", () => {
  const output = captureStderr(() => {
    printSummary({ mode: "full", types: ["basic"], version: "1.0.0", gitignoreUpdated: true });
  });
  assert.ok(output.includes(".gitignore"));
});

test("printSummary: full 모드 + gitignoreUpdated:false(기본값) -> .gitignore 줄 없음", () => {
  const output = captureStderr(() => {
    printSummary({ mode: "full", types: ["basic"], version: "1.0.0" });
  });
  assert.ok(!output.includes(".gitignore"));
});

test("printSummary: version 모드는 .gitignore를 절대 언급하지 않는다", () => {
  const output = captureStderr(() => {
    printSummary({ mode: "version", types: ["basic"], version: "1.0.0" });
  });
  assert.ok(!output.includes(".gitignore"));
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `node --test tests/node/summary-output.test.js`
Expected: FAIL — 첫 번째 테스트는 현재 `gitignoreUpdated`를 읽지 않아 무조건 줄이 나오므로 우연히 통과할 수 있으나, 세 번째(`version` 모드) 테스트가 현재 무조건 ".gitignore 필수 항목" 줄을 출력하므로 FAIL한다.

- [ ] **Step 3: `src/ui/summary.js` 수정**

현재 (10-11번째 줄):

```js
export function printSummary(ctx, targetRoot = ".") {
  const { mode, types = [], version = "", counters = {}, branches = null, includeCodeRabbit = false } = ctx || {};
```

변경:

```js
export function printSummary(ctx, targetRoot = ".") {
  const { mode, types = [], version = "", counters = {}, branches = null, includeCodeRabbit = false, gitignoreUpdated = false } = ctx || {};
```

현재 (모드별 체크리스트, 30-45번째 줄):

```js
  switch (mode) {
    case "full":
      err("  ✅ 버전 관리 시스템 (version.yml)");
      err("  ✅ README.md 자동 버전 업데이트");
      err("  ✅ GitHub Actions 워크플로우 (AI 릴리스 자동화 포함)");
      err("  ✅ .gitignore 필수 항목");
      break;
    case "version":
      err("  ✅ 버전 관리 시스템 (version.yml)");
      err("  ✅ README.md 자동 버전 업데이트");
      err("  ✅ .gitignore 필수 항목");
      break;
    case "workflows":
      err("  ✅ GitHub Actions 워크플로우 (AI 릴리스 자동화 포함)");
      break;
  }
```

변경:

```js
  switch (mode) {
    case "full":
      err("  ✅ 버전 관리 시스템 (version.yml)");
      err("  ✅ README.md 자동 버전 업데이트");
      err("  ✅ GitHub Actions 워크플로우 (AI 릴리스 자동화 포함)");
      if (gitignoreUpdated) err("  ✅ .gitignore 백업 파일 제외 항목 (*.bak/*.template.yaml)");
      break;
    case "version":
      err("  ✅ 버전 관리 시스템 (version.yml)");
      err("  ✅ README.md 자동 버전 업데이트");
      break;
    case "workflows":
      err("  ✅ GitHub Actions 워크플로우 (AI 릴리스 자동화 포함)");
      break;
  }
```

- [ ] **Step 4: `src/index.js`에서 `printSummary` 호출에 `gitignoreUpdated` 전달**

현재 (309-314번째 줄):

```js
  printSummary({
    mode: opts.mode, types, version, branches,
    includeCodeRabbit: context.includeCodeRabbit === true,
    counters: { workflows: result?.workflows?.copied ?? 0 },
  }, cwd);
```

변경:

```js
  printSummary({
    mode: opts.mode, types, version, branches,
    includeCodeRabbit: context.includeCodeRabbit === true,
    counters: { workflows: result?.workflows?.copied ?? 0 },
    gitignoreUpdated: result?.gitignoreUpdated === true,
  }, cwd);
```

- [ ] **Step 5: `src/commands/interactive.js`의 요약 호출에도 `gitignoreUpdated` 전달**

현재 (249-252번째 줄):

```js
  io.summary?.({
    mode, types, version, branches, includeCodeRabbit,
    counters: { workflows: result?.workflows?.copied ?? 0 },
  }, cwd);
```

변경:

```js
  io.summary?.({
    mode, types, version, branches, includeCodeRabbit,
    counters: { workflows: result?.workflows?.copied ?? 0 },
    gitignoreUpdated: result?.gitignoreUpdated === true,
  }, cwd);
```

- [ ] **Step 6: 테스트 재실행 — 전체 통과 확인**

Run: `node --test tests/node/summary-output.test.js`
Expected: 3개 테스트 모두 PASS.

- [ ] **Step 7: 기존 인터랙티브 테스트 스위트가 여전히 통과하는지 확인 (회귀 없음 검증)**

Run: `node --test tests/node/interactive-mode-uninstall.test.js tests/node/wizard-labels.test.js`
Expected: 모든 테스트 PASS (이 두 파일은 `.gitignore`를 단언하지 않으므로 영향 없어야 한다).

- [ ] **Step 8: 커밋**

```bash
git add src/ui/summary.js src/index.js src/commands/interactive.js tests/node/summary-output.test.js
git commit -m "gitignore_자동_수정_기능_폐지_마법사_책임_범위_밖 : feat : 완료 요약(CLI·대화형 모두)이 실제 gitignore 갱신 여부를 반영하도록 수정 https://github.com/Twin-Fang/project-auto-wizard/issues/7"
```

---

### Task 5: 기존 uninstall/dry-run 테스트 픽스처 보정

**배경:** Task 2 이후 `runFull()`은 충돌이 없는 최초 설치에서 더 이상 `.gitignore`를 만들지 않는다. `tests/node/uninstall-plan.test.js`, `tests/node/uninstall-dry-run.test.js`, `tests/node/uninstall-cli.test.js`는 (충돌 없는) 신선한 임시 디렉터리에 `runFull`/`--mode full`을 실행한 뒤 `.gitignore`가 이미 존재한다고 가정하고 uninstall의 gitignore 정리 동작(`plan.gitignore`, `--purge-gitignore` 등)을 검증한다. 이 태스크는 각 픽스처에 `ensureGitignore()`를 직접 호출해 "마법사가 이전에 백업 항목을 추가해 둔 상태"를 명시적으로 만들어, uninstall의 정리 로직 자체는 계속 같은 방식으로 검증되게 한다.

**Files:**
- Modify: `tests/node/uninstall-plan.test.js:1-26`
- Modify: `tests/node/uninstall-dry-run.test.js:1-25`
- Modify: `tests/node/uninstall-cli.test.js:1-66`
- Modify: `tests/node/purge-plan.test.js:70-72` (주석만 — 동작 무변경)
- Modify: `tests/node/purge-cli.test.js:240-241` (주석만 — 동작 무변경)

**Interfaces:**
- Consumes: `ensureGitignore(targetRoot)` from `src/core/copy/gitignore.js` (Task 1에서 시그니처 무변경).
- Produces: 없음 (테스트 전용 변경).

- [ ] **Step 1: `tests/node/uninstall-plan.test.js` 픽스처 수정**

현재 (1-26번째 줄):

```js
// tests/node/uninstall-plan.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { planUninstall, runUninstall } from "../../src/commands/uninstall.js";

const FULL_SELECTION = { workflows: true, scripts: true, coderabbit: true, readme: true, gitignore: true, versionYml: true };
const SAFE_SELECTION = { workflows: true, scripts: true, coderabbit: true, readme: false, gitignore: false, versionYml: false };

function installFixture() {
  const target = mkdtempSync(join(tmpdir(), "paw-uninstall-plan-"));
  writeFileSync(join(target, "README.md"), "# Test Project\n");
  const ctx = createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(), includeCodeRabbit: true,
    now: "2026-08-01 00:00:00", today: "2026-08-01", templateVersion: "0.1.0",
  });
  runFull(ctx, resolvePayloadRoot(), target);
  return target;
}
```

변경:

```js
// tests/node/uninstall-plan.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { planUninstall, runUninstall } from "../../src/commands/uninstall.js";
import { ensureGitignore } from "../../src/core/copy/gitignore.js";

const FULL_SELECTION = { workflows: true, scripts: true, coderabbit: true, readme: true, gitignore: true, versionYml: true };
const SAFE_SELECTION = { workflows: true, scripts: true, coderabbit: true, readme: false, gitignore: false, versionYml: false };

function installFixture() {
  const target = mkdtempSync(join(tmpdir(), "paw-uninstall-plan-"));
  writeFileSync(join(target, "README.md"), "# Test Project\n");
  const ctx = createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(), includeCodeRabbit: true,
    now: "2026-08-01 00:00:00", today: "2026-08-01", templateVersion: "0.1.0",
  });
  runFull(ctx, resolvePayloadRoot(), target);
  // full 모드는 충돌 백업이 실제로 생겼을 때만 .gitignore를 만든다(issue #7) — 이 픽스처는
  // uninstall의 gitignore 정리 동작 자체를 검증하는 것이 목적이므로 직접 만들어 둔다.
  ensureGitignore(target);
  return target;
}
```

- [ ] **Step 2: `tests/node/uninstall-dry-run.test.js` 픽스처 수정 — 동일 패턴**

현재 (1-25번째 줄):

```js
// tests/node/uninstall-dry-run.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { planDryRun, printDryRun } from "../../src/commands/dry-run.js";

const FULL_SELECTION = { workflows: true, scripts: true, coderabbit: true, readme: true, gitignore: true, versionYml: true };

function installFixture() {
  const target = mkdtempSync(join(tmpdir(), "paw-uninstall-dry-"));
  writeFileSync(join(target, "README.md"), "# Test Project\n");
  const ctx = createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(), includeCodeRabbit: true,
    now: "2026-08-01 00:00:00", today: "2026-08-01", templateVersion: "0.1.0",
  });
  runFull(ctx, resolvePayloadRoot(), target);
  return target;
}
```

변경:

```js
// tests/node/uninstall-dry-run.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { planDryRun, printDryRun } from "../../src/commands/dry-run.js";
import { ensureGitignore } from "../../src/core/copy/gitignore.js";

const FULL_SELECTION = { workflows: true, scripts: true, coderabbit: true, readme: true, gitignore: true, versionYml: true };

function installFixture() {
  const target = mkdtempSync(join(tmpdir(), "paw-uninstall-dry-"));
  writeFileSync(join(target, "README.md"), "# Test Project\n");
  const ctx = createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(), includeCodeRabbit: true,
    now: "2026-08-01 00:00:00", today: "2026-08-01", templateVersion: "0.1.0",
  });
  runFull(ctx, resolvePayloadRoot(), target);
  // full 모드는 충돌 백업이 실제로 생겼을 때만 .gitignore를 만든다(issue #7) — 이 픽스처는
  // dry-run의 gitignore 미리보기 자체를 검증하는 것이 목적이므로 직접 만들어 둔다.
  ensureGitignore(target);
  return target;
}
```

- [ ] **Step 3: `tests/node/uninstall-cli.test.js`에 `ensureGitignore` import 및 호출 추가**

현재 (1-8번째 줄):

```js
// tests/node/uninstall-cli.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "../../src/cli/args.js";
import { run } from "../../src/index.js";
```

변경:

```js
// tests/node/uninstall-cli.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "../../src/cli/args.js";
import { run } from "../../src/index.js";
import { ensureGitignore } from "../../src/core/copy/gitignore.js";
```

첫 번째 관련 테스트 현재:

```js
test("run(): --mode uninstall --force removes only workflows/scripts/coderabbit by default", async () => {
  const target = emptyTarget();
  try {
    writeFileSync(join(target, "README.md"), "# Test Project\n");
    await run(["--mode", "full", "--force", "--type", "node", "--coderabbit"], {
      cwd: target, clock: { now: "2026-08-01 00:00:00", today: "2026-08-01" },
    });
    const code = await run(["--mode", "uninstall", "--force"], { cwd: target });
```

변경:

```js
test("run(): --mode uninstall --force removes only workflows/scripts/coderabbit by default", async () => {
  const target = emptyTarget();
  try {
    writeFileSync(join(target, "README.md"), "# Test Project\n");
    await run(["--mode", "full", "--force", "--type", "node", "--coderabbit"], {
      cwd: target, clock: { now: "2026-08-01 00:00:00", today: "2026-08-01" },
    });
    // full 모드는 충돌 백업이 실제로 생겼을 때만 .gitignore를 만든다(issue #7) — 이 테스트는
    // uninstall의 gitignore 정리 동작 자체를 검증하는 것이 목적이므로 직접 만들어 둔다.
    ensureGitignore(target);
    const code = await run(["--mode", "uninstall", "--force"], { cwd: target });
```

두 번째 관련 테스트 현재:

```js
test("run(): --mode uninstall --force --purge-readme --purge-gitignore --purge-version removes everything", async () => {
  const target = emptyTarget();
  try {
    writeFileSync(join(target, "README.md"), "# Test Project\n");
    await run(["--mode", "full", "--force", "--type", "node", "--coderabbit"], {
      cwd: target, clock: { now: "2026-08-01 00:00:00", today: "2026-08-01" },
    });
    const code = await run(
```

변경:

```js
test("run(): --mode uninstall --force --purge-readme --purge-gitignore --purge-version removes everything", async () => {
  const target = emptyTarget();
  try {
    writeFileSync(join(target, "README.md"), "# Test Project\n");
    await run(["--mode", "full", "--force", "--type", "node", "--coderabbit"], {
      cwd: target, clock: { now: "2026-08-01 00:00:00", today: "2026-08-01" },
    });
    // full 모드는 충돌 백업이 실제로 생겼을 때만 .gitignore를 만든다(issue #7) — 이 테스트는
    // --purge-gitignore가 실제로 지우는지를 검증하는 것이 목적이므로 직접 만들어 둔다.
    ensureGitignore(target);
    const code = await run(
```

(나머지 두 테스트 — `--mode uninstall --dry-run` 과 비대화형 에러 테스트 — 는 `.gitignore`를 단언하지 않으므로 변경하지 않는다.)

- [ ] **Step 4: `purge-plan.test.js`/`purge-cli.test.js`의 이제 틀린 주석 갱신 (동작 무변경, 주석만)**

이 두 파일의 round-trip 테스트는 `.gitignore`를 비교 대상에서 제외하는 방어 필터를 갖고 있는데, 그 이유를 설명하는 주석이 "runFull()은 항상 ensureGitignore()를 호출한다"고 적혀 있어 Task 2 이후 더 이상 사실이 아니다. 필터 자체(동작)는 그대로 두되(신선한 설치는 애초에 `.gitignore`를 만들지 않으므로 필터가 무해한 no-op이 됨) 주석만 정확하게 고친다.

`tests/node/purge-plan.test.js`의 현재 (70-72번째 줄):

```js
// H1 (Fable 검토): runFull()은 항상 ensureGitignore()를 호출해 .gitignore가 없으면 새로 만든다.
// purge는 스펙 §2 비목표에 따라 .gitignore를 절대 건드리지 않으므로, 라운드트립 비교에서
// .gitignore는 "설치 전=없음 vs 설치 후=있음" 차이가 항상 발생한다 — .git과 마찬가지로 비교 대상에서 제외한다.
```

변경:

```js
// H1 (Fable 검토, 2026-08-01) → issue #7 갱신: runFull()은 이제 충돌 백업 부산물(.bak/.template.yaml)이
// 실제로 생겼을 때만 .gitignore를 건드린다. 이 라운드트립 테스트의 설치는 충돌이 없어 .gitignore가
// 전혀 생성되지 않으므로 아래 필터는 사실상 no-op이지만, 만약 다른 테스트가 충돌을 유발하도록 바뀌더라도
// purge는 스펙 §2 비목표에 따라 .gitignore를 절대 건드리지 않으므로 안전하게 비교 대상에서 제외해 둔다.
```

`tests/node/purge-cli.test.js`의 현재 (240-241번째 줄):

```js
// H1 (Fable 검토): .gitignore는 runFull()이 항상 새로 만들고 purge는 절대 건드리지 않으므로
// (스펙 §2 비목표) 라운드트립 비교에서 .git과 함께 제외한다 — 자세한 이유는 Task 4의 동일 헬퍼 참고.
```

변경:

```js
// H1 (Fable 검토, 2026-08-01) → issue #7 갱신: .gitignore는 이제 충돌 백업 부산물이 실제로 생겼을
// 때만 만들어지고, purge는 어떤 경우든 절대 건드리지 않으므로(스펙 §2 비목표) 라운드트립 비교에서
// .git과 함께 안전하게 제외한다 — 자세한 이유는 purge-plan.test.js의 동일 헬퍼 참고.
```

- [ ] **Step 5: 5개 파일 전체 테스트 실행 — 통과 확인**

Run: `node --test tests/node/uninstall-plan.test.js tests/node/uninstall-dry-run.test.js tests/node/uninstall-cli.test.js tests/node/purge-plan.test.js tests/node/purge-cli.test.js`
Expected: 모든 테스트 PASS.

- [ ] **Step 6: 커밋**

```bash
git add tests/node/uninstall-plan.test.js tests/node/uninstall-dry-run.test.js tests/node/uninstall-cli.test.js tests/node/purge-plan.test.js tests/node/purge-cli.test.js
git commit -m "gitignore_자동_수정_기능_폐지_마법사_책임_범위_밖 : test : full 모드의 조건부 gitignore 갱신에 맞춰 uninstall/dry-run 테스트 픽스처 보정 및 관련 주석 갱신 https://github.com/Twin-Fang/project-auto-wizard/issues/7"
```

---

### Task 6: 전체 테스트 스위트 최종 검증

**Files:** 없음 (검증 전용 태스크).

**Interfaces:** 없음.

- [ ] **Step 1: 전체 Node 테스트 스위트 실행**

Run: `npm run test:node`
Expected: 모든 테스트 PASS. 실패가 있으면 원인을 파악해 관련 태스크의 파일을 수정하고 재실행한다 (특히 `purge-cli.test.js`/`purge-plan.test.js`의 round-trip 테스트가 `.gitignore`를 비교 대상에서 제외하는 방어 로직을 이미 갖고 있어 영향받지 않아야 함을 확인).

- [ ] **Step 2: 이슈 본문에서 언급된 두 항목이 더 이상 코드 어디에도 등장하지 않는지 확인**

Run: `grep -rn "/\.idea\|settings\.local\.json" --include="*.js" . | grep -v node_modules`
Expected: 결과 없음 (0줄).

- [ ] **Step 3: 최종 확인 커밋(변경 사항이 있는 경우에만)**

이 태스크에서 코드 수정이 발생했다면 해당 파일들을 커밋한다. 검증만 하고 수정이 없었다면 커밋하지 않는다.
