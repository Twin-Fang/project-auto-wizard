# 이슈 헬퍼 브랜치 자동 생성 마법사 노출 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub 이슈 생성 시 main(또는 프로젝트가 실제로 쓰는 릴리스 브랜치) 기준으로 브랜치를 자동 생성하는 기존 로직(`ISSUE_HELPER_CREATE_BRANCH`)을, 대화형 설치 마법사에서 켜고 끌 수 있는 질문으로 노출한다.

**Architecture:** `src/ui/env-plan.js`의 `collectAsks()`가 지금은 `payload/workflows/{타입}/`만 스캔하고 `payload/workflows/common/`은 (secret-backup 서브폴더 제외하고는) 전혀 스캔하지 않는다. 이 스캔 범위를 common 최상위까지 무조건 확장하고, `ISSUE_HELPER_CREATE_BRANCH: "false"`에 `# @wizard ask:false` 마커를 붙인다. 마커 값이 `"true"`/`"false"` 리터럴이면 `promptEach()`가 기존 자유 텍스트 입력(`io.text`) 대신 이미 존재하는 `io.confirm()` 예/아니오 토글을 자동으로 쓰도록 분기한다. 마커 문법(`wizard-env.js`)이나 UI 엔진(`readline-engine.js`) 자체는 건드리지 않는다.

**Tech Stack:** Node.js(ESM), `node:test` + `node:assert` 테스트 러너, 기존 `@wizard ask/auto` 마커 엔진, 기존 `io.confirm()` primitive(`src/ui/readline-engine.js`).

**Spec:** 별도 스펙 문서 없음(Bounded 경로) — 설계 근거는 GitHub 이슈 [Twin-Fang/project-auto-wizard#94](https://github.com/Twin-Fang/project-auto-wizard/issues/94)와 2026-08-23 브레인스토밍 대화(본 세션)에 있다.

## Global Constraints

- 커밋 메시지는 한국어로 작성한다. Conventional Commits 타입 프리픽스(`feat:`, `fix:`, `docs:` 등)만 영어를 유지한다 (프로젝트 CLAUDE.md).
- git force 계열 명령(`push -f`, `reset --hard`, `commit --amend` 등)은 절대 사용하지 않는다.
- 기존 코드의 스타일·주석 밀도·"왜" 중심 주석 관례를 그대로 따른다. 이번 변경과 무관한 코드는 건드리지 않는다.
- 각 태스크는 실패하는 테스트(RED) → 최소 구현(GREEN) → 커밋 순서를 지킨다.
- 최종 검증은 `npm test`(node --test + python 테스트) 전체 통과로 확인한다.
- `ISSUE_HELPER_BASE_BRANCH`는 이미 `{{MAIN_BRANCH}}` 브랜딩 치환으로 동적이므로 이번 작업 범위에 포함하지 않는다(건드리지 않음).

---

### Task 1: `collectAsks()`가 `payload/workflows/common/` 최상위를 무조건 스캔하도록 확장

**Files:**
- Modify: `src/ui/env-plan.js:51-62` (`collectAsks()` 내부 `units` 구성 블록)
- Test: `tests/node/env-plan.test.js` (신규 파일)

**Interfaces:**
- Consumes: 없음(기존 `collectAsks(payloadRoot, types, opts)` 시그니처 그대로 사용)
- Produces: `collectAsks()`가 반환하는 `{keys, defaults, typeDefaults, usages}` 중 `keys`/`defaults`/`usages`에 `payload/workflows/common/` 최상위 파일들의 `@wizard ask` 키가 `type: "common"`으로 포함됨. Task 2·Task 3이 이 동작에 의존한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/env-plan.test.js`를 새로 만든다:

```javascript
// tests/node/env-plan.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collectAsks } from "../../src/ui/env-plan.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";

function makeFixturePayload() {
  const root = mkdtempSync(join(tmpdir(), "paw-env-plan-"));
  const commonDir = join(root, "workflows", "common");
  mkdirSync(commonDir, { recursive: true });
  writeFileSync(
    join(commonDir, "PROJECT-COMMON-FOO.yaml"),
    [
      "name: FOO",
      "env:",
      '  FOO_FLAG: "false" # @wizard ask:false',
      '  FOO_NAME: "bar" # @wizard ask:bar',
      "",
    ].join("\n"),
  );
  const secretDir = join(commonDir, "secret-backup");
  mkdirSync(secretDir, { recursive: true });
  writeFileSync(
    join(secretDir, "PROJECT-COMMON-SECRET.yaml"),
    ["name: SECRET", "env:", '  SECRET_ONLY: "x" # @wizard ask:x', ""].join("\n"),
  );
  return root;
}

test("collectAsks: common/ 최상위는 types가 비어 있어도 무조건 스캔된다", () => {
  const root = makeFixturePayload();
  try {
    const asks = collectAsks(root, []);
    assert.ok(asks.keys.includes("FOO_FLAG"));
    assert.ok(asks.keys.includes("FOO_NAME"));
    assert.strictEqual(asks.defaults.get("FOO_FLAG"), "false");
    const usage = asks.usages.get("FOO_FLAG");
    assert.ok(usage.some((u) => u.type === "common"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("collectAsks: common/secret-backup/은 includeSecretBackup=false면 여전히 제외된다", () => {
  const root = makeFixturePayload();
  try {
    const asks = collectAsks(root, [], { includeSecretBackup: false });
    assert.ok(!asks.keys.includes("SECRET_ONLY"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("collectAsks: common/secret-backup/은 includeSecretBackup=true면 포함된다", () => {
  const root = makeFixturePayload();
  try {
    const asks = collectAsks(root, [], { includeSecretBackup: true });
    assert.ok(asks.keys.includes("SECRET_ONLY"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("collectAsks: 실제 payload의 secret-backup 전용 키(SERVER_BASE_PATH)는 기본적으로 제외된다 (회귀)", () => {
  const asks = collectAsks(resolvePayloadRoot(), [], { includeSecretBackup: false });
  assert.ok(!asks.keys.includes("SERVER_BASE_PATH"));
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node --test tests/node/env-plan.test.js`
Expected: 첫 번째 테스트(`common/ 최상위는 types가 비어 있어도 무조건 스캔된다`)가 FAIL — `asks.keys`가 빈 배열이라 `includes("FOO_FLAG")`가 false. 나머지 3개 테스트는 이미 통과할 수 있음(기존 동작 유지 확인용이므로 무방).

- [ ] **Step 3: 최소 구현**

`src/ui/env-plan.js`에서 아래 블록(현재 51~63행 부근, `collectAsks()` 내부)을:

```javascript
  // 스캔 단위: [타입, 폴더]. secret-backup은 타입이 아니라 공통이지만 @wizard 마커를 가지므로
  // 포함하기로 한 경우에만 질문 수집 대상이 된다 (이슈 #82) — 종전에는 스캔 대상이 아니어서
  // my-project 같은 예시값이 질문 없이 그대로 설치됐다.
  const units = [];
  for (const type of types) {
    const typeDir = join(baseDir, type);
    if (!exists(typeDir)) continue;
    // 복사 엔진과 동일한 폴더 구성: 타입 직하위 + (nexus 아니면) server-deploy + (nexus면) nexus
    units.push([type, typeDir, null]);
    units.push([type, join(typeDir, includeNexus ? "nexus" : "server-deploy"), includeNexus ? null : keepDeploy]);
  }
  if (includeSecretBackup) units.push(["common", join(baseDir, "common", "secret-backup"), null]);
```

다음으로 교체한다:

```javascript
  // 스캔 단위: [타입, 폴더]. common/ 최상위는 타입 선택과 무관하게 항상 설치되므로(복사 엔진과
  // 동일 규칙 — issue #94) 무조건 스캔한다. secret-backup은 common 최상위가 아니라 그 하위
  // 폴더고, 파일 전체가 조건부로 설치되므로 포함하기로 한 경우에만 별도로 스캔한다 (이슈 #82) —
  // 종전에는 스캔 대상이 아니어서 my-project 같은 예시값이 질문 없이 그대로 설치됐다.
  const units = [];
  const commonDir = join(baseDir, "common");
  if (exists(commonDir)) units.push(["common", commonDir, null]);
  for (const type of types) {
    const typeDir = join(baseDir, type);
    if (!exists(typeDir)) continue;
    // 복사 엔진과 동일한 폴더 구성: 타입 직하위 + (nexus 아니면) server-deploy + (nexus면) nexus
    units.push([type, typeDir, null]);
    units.push([type, join(typeDir, includeNexus ? "nexus" : "server-deploy"), includeNexus ? null : keepDeploy]);
  }
  if (includeSecretBackup) units.push(["common", join(baseDir, "common", "secret-backup"), null]);
```

(`listYamlFiles()`는 `readdirSync(..., {withFileTypes:true}).filter(e => e.isFile())`로 비재귀이므로, `commonDir`를 직접 스캔해도 하위 폴더인 `secret-backup/`은 자동으로 제외된다 — 별도 가드 불필요.)

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `node --test tests/node/env-plan.test.js`
Expected: 4개 테스트 모두 PASS.

- [ ] **Step 5: 전체 Node 테스트 회귀 확인**

Run: `npm run test:node`
Expected: 기존 테스트(특히 `tests/node/plan-workflows.test.js`, `tests/node/workflows-copied-files.test.js`) 전부 PASS — common 스캔 확장이 `copyWorkflows`/`planWorkflows` 쪽 동작을 바꾸지 않았는지 확인.

- [ ] **Step 6: 커밋**

```bash
git add src/ui/env-plan.js tests/node/env-plan.test.js
git commit -m "$(cat <<'EOF'
feat: collectAsks가 payload/workflows/common 최상위를 무조건 스캔하도록 확장

이슈 #94: common/ 워크플로우는 타입 선택과 무관하게 항상 설치되는데도
collectAsks가 이 폴더를 전혀 스캔하지 않아 @wizard ask 마커를 붙여도
설치 마법사 질문으로 노출될 수 없었다. secret-backup(조건부 설치되는
하위 폴더)은 기존처럼 opt-in 스캔을 유지한다.
EOF
)"
```

---

### Task 2: `promptEach()`가 boolean 기본값(`"true"`/`"false"`) 필드에 `io.confirm()`을 쓰도록 분기

**Files:**
- Modify: `src/ui/env-plan.js:111-149` (`printFieldCard()` 아래, `promptEach()` 함수)
- Test: `tests/node/env-plan.test.js` (Task 1에서 만든 파일에 테스트 추가)

**Interfaces:**
- Consumes: Task 1이 만든 `collectAsks()`의 common 스캔 결과(`FOO_FLAG` 같은 boolean 기본값 키가 `asks.keys`/`asks.defaults`에 들어있음). `src/ui/readline-engine.js`가 이미 내보내는 `confirm({message, initialValue}): Promise<boolean | CANCEL>` primitive(신규 구현 없음, 기존 것 재사용).
- Produces: `promptEach()`가 boolean 필드에서 사용자가 확정한 값을 항상 문자열 `"true"`/`"false"`로 `values` Map에 저장한다. Task 3의 `ISSUE_HELPER_CREATE_BRANCH` 통합 테스트가 이 동작에 의존한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/env-plan.test.js`의 import 줄을 다음으로 바꾼다:

```javascript
import { collectAsks, promptEnvPlan } from "../../src/ui/env-plan.js";
```

파일 끝에 아래 테스트 2개를 추가한다:

```javascript
test("promptEnvPlan: 기본값이 true/false인 ask 필드는 io.text 대신 io.confirm을 사용한다", async () => {
  const root = makeFixturePayload();
  try {
    const confirmedInitialValues = [];
    const textedDefaults = [];
    const io = {
      select: async () => "each",
      multiselect: async () => [],
      text: async ({ defaultValue }) => { textedDefaults.push(defaultValue); return defaultValue; },
      confirm: async ({ initialValue }) => { confirmedInitialValues.push(initialValue); return true; },
    };
    const result = await promptEnvPlan({
      payloadRoot: root, types: [], io, force: false, log: () => {},
    });
    assert.strictEqual(result.values.get("FOO_FLAG"), "true"); // confirm()이 true 응답 → "true" 문자열로 변환
    assert.strictEqual(result.values.get("FOO_NAME"), "bar");  // boolean이 아닌 필드는 그대로 text() 경로
    assert.strictEqual(confirmedInitialValues.length, 1);
    assert.strictEqual(confirmedInitialValues[0], false); // FOO_FLAG 기본값 "false" → initialValue=false
    assert.strictEqual(textedDefaults.length, 1);
    assert.strictEqual(textedDefaults[0], "bar");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("promptEnvPlan: confirm에서 CANCEL을 반환하면 boolean 필드는 기본값을 유지한다", async () => {
  const root = makeFixturePayload();
  try {
    const { CANCEL } = await import("../../src/ui/readline-engine.js");
    const io = {
      select: async () => "each",
      multiselect: async () => [],
      text: async ({ defaultValue }) => defaultValue,
      confirm: async () => CANCEL,
    };
    const result = await promptEnvPlan({
      payloadRoot: root, types: [], io, force: false, log: () => {},
    });
    assert.strictEqual(result.values.get("FOO_FLAG"), "false");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node --test tests/node/env-plan.test.js`
Expected: 새로 추가한 2개 테스트 중 첫 번째("io.text 대신 io.confirm을 사용한다")만 FAIL — 현재 `promptEach()`는 모든 ask 필드에 대해 `io.text()`만 호출하므로, `confirmedInitialValues.length`가 0이라 `assert.strictEqual(confirmedInitialValues.length, 1)`이 깨진다. 두 번째("confirm에서 CANCEL을 반환하면 기본값을 유지한다")는 지금도 우연히 PASS한다 — 수정 전에는 `io.text` 스텁이 `defaultValue`("false")를 그대로 반환하므로 결과가 이미 `"false"`이기 때문이다. 이 테스트는 회귀 방지용으로 남겨두되, "두 테스트 모두 FAIL"을 기대하지 않는다.

- [ ] **Step 3: 최소 구현**

`src/ui/env-plan.js`에서 `printFieldCard()` 함수(111~127행)와 `promptEach()` 함수(129~149행) 사이 및 `promptEach()` 본문을 수정한다.

`printFieldCard` 함수 바로 다음, `promptEach` 함수 선언 바로 위에 아래 헬퍼를 추가한다:

```javascript
// ask 필드의 기본값이 정확히 "true"/"false"면 boolean 필드로 간주한다 (이슈 #94).
// 마커 문법(@wizard ask:...)을 바꾸지 않고 리터럴 값 형태만으로 판단 — 별도 타입 표기가 필요 없다.
function isBooleanDefault(value) {
  return value === "true" || value === "false";
}
```

기존 `promptEach()` 함수:

```javascript
async function promptEach(io, prompts, asks, todoKeys, values, log) {
  const tot = todoKeys.length;
  if (tot === 0) return;
  log("");
  log("   값을 입력하세요. 그대로 두려면 아무것도 입력하지 말고 Enter를 누르면 기본값이 적용됩니다.");
  log("");
  let i = 0;
  for (const key of todoKeys) {
    i++;
    const def = asks.defaults.get(key) ?? "";
    printFieldCard(prompts, key, { default: def, usages: asks.usages.get(key) || [] }, i, tot, log);
    let input = await io.text({ message: `↳ 값 입력 (Enter=기본값 «${def}» 유지):`, defaultValue: def });
    if (input === CANCEL || input == null || input === "") input = def;
    values.set(key, input);
    const label = wfField(prompts, firstTypeFor(asks.usages, key), key, "label");
    log(`         → ${label} = ${input}`);
    log("");
  }
}
```

을 다음으로 교체한다:

```javascript
async function promptEach(io, prompts, asks, todoKeys, values, log) {
  const tot = todoKeys.length;
  if (tot === 0) return;
  log("");
  log("   값을 입력하세요. 그대로 두려면 아무것도 입력하지 말고 Enter를 누르면 기본값이 적용됩니다.");
  log("");
  let i = 0;
  for (const key of todoKeys) {
    i++;
    const def = asks.defaults.get(key) ?? "";
    printFieldCard(prompts, key, { default: def, usages: asks.usages.get(key) || [] }, i, tot, log);
    const label = wfField(prompts, firstTypeFor(asks.usages, key), key, "label");
    let input;
    if (isBooleanDefault(def)) {
      const answer = await io.confirm({ message: `↳ ${label} — 활성화할까요?`, initialValue: def === "true" });
      input = answer === CANCEL ? def : (answer ? "true" : "false");
    } else {
      input = await io.text({ message: `↳ 값 입력 (Enter=기본값 «${def}» 유지):`, defaultValue: def });
      if (input === CANCEL || input == null || input === "") input = def;
    }
    values.set(key, input);
    log(`         → ${label} = ${input}`);
    log("");
  }
}
```

(`label` 계산을 루프 앞쪽으로 옮겨 두 분기에서 재사용한다 — 기존에는 로그 출력 직전에만 계산했다.)

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `node --test tests/node/env-plan.test.js`
Expected: 6개 테스트(Task 1의 4개 + Task 2의 2개) 모두 PASS.

- [ ] **Step 5: 전체 Node 테스트 회귀 확인**

Run: `npm run test:node`
Expected: 전부 PASS. 특히 기존에 `promptEach`를 텍스트 입력으로 검증하던 시나리오가 있다면(현재는 없음을 확인했지만) 깨지지 않아야 한다.

- [ ] **Step 6: 커밋**

```bash
git add src/ui/env-plan.js tests/node/env-plan.test.js
git commit -m "$(cat <<'EOF'
feat: 기본값이 true/false인 ask 필드는 텍스트 대신 예/아니오 토글로 입력받기

이슈 #94: @wizard ask 필드는 전부 자유 텍스트(io.text)로만 입력받아,
이슈 생성 시 브랜치 자동 생성처럼 실질적으로 on/off인 값도 사용자가
"true"/"false" 문자열을 직접 타이핑해야 했다. 기본값이 정확히
"true"/"false"인 필드는 이미 존재하는 io.confirm() 예/아니오 토글을
쓰도록 promptEach()만 분기했다 — 마커 문법이나 UI 엔진은 그대로다.
EOF
)"
```

---

### Task 3: `ISSUE_HELPER_CREATE_BRANCH`에 실제 마커를 붙이고 마법사 문구를 등록

**Files:**
- Modify: `payload/workflows/common/PROJECT-COMMON-ISSUE-HELPER.yaml:39`
- Modify: `payload/config/wizard-prompts.yml`
- Test: `tests/node/env-plan.test.js` (Task 1·2에서 만든 파일에 통합 테스트 추가)

**Interfaces:**
- Consumes: Task 1의 common 무조건 스캔, Task 2의 boolean 자동 분기.
- Produces: 실제 설치 마법사에서 "이슈 생성 시 브랜치 자동 생성" 질문이 노출됨. 이후 태스크 없음(최종 태스크).

- [ ] **Step 1: 실패하는 통합 테스트 작성**

`tests/node/env-plan.test.js` 파일 끝에 추가:

```javascript
test("collectAsks: 실제 payload의 ISSUE_HELPER_CREATE_BRANCH가 common 스캔으로 노출된다 (통합)", () => {
  const asks = collectAsks(resolvePayloadRoot(), []);
  assert.ok(asks.keys.includes("ISSUE_HELPER_CREATE_BRANCH"));
  assert.strictEqual(asks.defaults.get("ISSUE_HELPER_CREATE_BRANCH"), "false");
});

test("promptEnvPlan: 실제 payload에서 ISSUE_HELPER_CREATE_BRANCH를 예/아니오 토글로 물어본다 (통합)", async () => {
  const io = {
    select: async () => "each",
    multiselect: async () => [],
    text: async ({ defaultValue }) => defaultValue,
    confirm: async ({ initialValue }) => { assert.strictEqual(initialValue, false); return true; },
  };
  const result = await promptEnvPlan({
    payloadRoot: resolvePayloadRoot(), types: [], io, force: false, log: () => {},
  });
  assert.strictEqual(result.values.get("ISSUE_HELPER_CREATE_BRANCH"), "true");
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node --test tests/node/env-plan.test.js`
Expected: 새로 추가한 2개 테스트 FAIL — 실제 payload 파일에 아직 `@wizard ask` 마커가 없어서 `ISSUE_HELPER_CREATE_BRANCH`가 `asks.keys`에 없다.

- [ ] **Step 3: 워크플로우 파일에 마커 추가**

`payload/workflows/common/PROJECT-COMMON-ISSUE-HELPER.yaml`의 39행:

```yaml
      ISSUE_HELPER_CREATE_BRANCH: "false"
```

을 다음으로 교체:

```yaml
      ISSUE_HELPER_CREATE_BRANCH: "false" # @wizard ask:false
```

- [ ] **Step 4: wizard-prompts.yml에 문구 등록**

`payload/config/wizard-prompts.yml`에서 `SSH_AUTH_METHOD` 블록(43~46행) 바로 다음, `_workflow_names:` 블록(50행) 바로 앞에 아래 블록을 추가한다:

```yaml
ISSUE_HELPER_CREATE_BRANCH:
  label: "이슈 생성 시 브랜치 자동 생성"
  help: "이슈가 열리면 base 브랜치 기준으로 브랜치를 자동으로 만듭니다. 원치 않으면 기본값(아니오)을 그대로 두세요."
  example: "true"
```

그리고 `_workflow_names:` 블록 안(현재 51~62행) 마지막 항목(`FLUTTER-ANDROID-FIREBASE: "Firebase 배포"`) 다음 줄에 아래 한 줄을 추가해, 질문 카드의 "사용처" 표시가 파일명 그대로("PROJECT-COMMON-ISSUE-HELPER") 대신 사람이 읽는 이름으로 나오게 한다:

```yaml
  ISSUE-HELPER: "이슈 헬퍼"
```

- [ ] **Step 5: 테스트 실행해서 통과 확인**

Run: `node --test tests/node/env-plan.test.js`
Expected: 파일의 모든 테스트(총 8개) PASS.

- [ ] **Step 6: 전체 테스트 스위트 실행 (최종 회귀 확인)**

Run: `npm test`
Expected: `npm run test:node`(모든 node --test 파일 — `wizard-env.test.js`, `wizard-labels.test.js`, `plan-workflows.test.js`, `workflows-copied-files.test.js`, `env-plan.test.js` 등)와 `npm run test:py` 전부 PASS. 특히 `plan-workflows.test.js`의 "everything is unchanged"류 테스트가 여전히 통과하는지 확인 — `useDefaults=true` 경로(비대화형 설치)에서는 마커 추가 전후로 최종 치환값이 `"false"`로 동일해야 한다.

- [ ] **Step 7: 커밋**

```bash
git add payload/workflows/common/PROJECT-COMMON-ISSUE-HELPER.yaml payload/config/wizard-prompts.yml tests/node/env-plan.test.js
git commit -m "$(cat <<'EOF'
feat: 이슈 생성 시 브랜치 자동 생성 여부를 설치 마법사 질문으로 노출

이슈 #94: ISSUE_HELPER_CREATE_BRANCH 로직(브랜치 자동 생성) 자체는
이미 있었지만 기본 꺼짐 + 노출 경로가 없어 존재를 모르고 지나치기
쉬웠다. @wizard ask:false 마커를 붙여 collectAsks/promptEach(이전
두 커밋에서 확장한 common 스캔·boolean 토글)가 이를 설치 마법사
질문으로 노출하도록 했다. 기본값(아니오/false)은 그대로 유지해
project-auto-wizard#68에서 opt-in으로 전환한 판단을 뒤집지 않는다.
ISSUE_HELPER_BASE_BRANCH는 이미 {{MAIN_BRANCH}} 브랜딩 치환으로
동적이라 변경하지 않았다.
EOF
)"
```

---

## Self-Review 메모 (계획 작성자용, 참고)

- **스펙 커버리지**: 브레인스토밍에서 합의한 세 가지 결정(무조건 스캔 / 진짜 Yes-No 토글 / base 브랜치는 손대지 않음)이 각각 Task 1 / Task 2 / (Task 3의 "건드리지 않음" 각주 + Global Constraints)로 반영됨.
- **플레이스홀더 스캔**: 없음 — 모든 스텝에 실제 diff·테스트 코드 포함.
- **타입 일관성**: `collectAsks(payloadRoot, types, opts)`, `promptEnvPlan({payloadRoot, types, io, force, ...})`, `io.confirm({message, initialValue}): Promise<boolean|CANCEL>` 시그니처를 Task 1~3 전체에서 동일하게 사용.
- **범위 확인**: 세 태스크 모두 `src/ui/env-plan.js` 한 파일 + payload 설정 2개 파일로 국한 — 별도 서브 프로젝트 분할 불필요.
