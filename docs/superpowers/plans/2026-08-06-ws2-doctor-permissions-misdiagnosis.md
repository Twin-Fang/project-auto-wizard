# WS2 — doctor Workflow permissions 오진 수정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이슈 [#34](https://github.com/Twin-Fang/project-auto-wizard/issues/34) — 레포의 `default_workflow_permissions`가 `read`일 때 doctor가 "릴리스가 중단됩니다"라고 경고하는 오진을 바로잡는다.

**Architecture:** `src/commands/doctor.js`의 `Workflow permissions` 항목을 `WARN` → `INFO`로 낮추고, `impact`/`actions` 대신 `note`로 사실만 진술한다. 판정 근거(payload 워크플로우가 전부 `permissions:`를 선언한다)가 나중에 깨지지 않도록 회귀 테스트를 추가한다.

**Tech Stack:** Node.js(순수 ESM, 외부 의존성 0), `node:test` + `node:assert`.

## Global Constraints

- 신규 npm 의존성 추가 금지 — zero-dependency 원칙.
- 항목의 `name`(`"Workflow permissions"`)은 식별자이므로 **변경하지 않는다** — 기존 테스트와 프로그램 참조가 이 값을 쓴다.
- doctor 출력 원칙(#29에서 확립)을 유지한다 — 판정하지 않고 사실만, GitHub UI 문자열은 원문 유지.
- 커밋 메시지 형식: `doctor_Workflow_permissions_오진_수정 : <타입> : <설명> https://github.com/Twin-Fang/project-auto-wizard/issues/34`
- 브랜치: `20260806_#34_doctor_Workflow_permissions_오진_수정`, base는 `main`.

---

### Task 1: 판정 근거를 고정하는 회귀 테스트

**Files:**
- Create: `tests/node/payload-workflow-permissions.test.js`

**Interfaces:**
- Consumes: 없음
- Produces: `payload/workflows/common/*.yaml`이 전부 `permissions:`를 선언한다는 전제를 테스트로 고정한다. Task 2의 문구가 이 전제 위에 서 있다.

**배경**: doctor가 `INFO`로 낮출 수 있는 근거는 "마법사가 설치하는 워크플로우는 자체 `permissions` 선언으로 동작한다"는 사실이다. 나중에 누가 새 공통 워크플로우를 추가하면서 선언을 빠뜨리면 이 전제가 무너지고 doctor 문구가 다시 거짓이 된다. **문구를 고치기 전에 전제부터 고정한다.**

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`tests/node/payload-workflow-permissions.test.js` 신규 생성:

```js
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
```

- [ ] **Step 2: 테스트를 실행해 현재 상태를 확인한다**

```bash
node --test tests/node/payload-workflow-permissions.test.js
```

Expected: 2개 모두 PASS. 이 테스트는 **현재 사실을 고정하는 것**이므로 처음부터 통과하는 것이 정상이다. 만약 실패한다면 doctor를 INFO로 낮출 근거 자체가 없다는 뜻이므로, Task 2를 진행하지 말고 실패한 워크플로우를 먼저 조사한다.

- [ ] **Step 3: 커밋**

```bash
git add tests/node/payload-workflow-permissions.test.js
git commit -F - <<'EOF'
doctor_Workflow_permissions_오진_수정 : test : payload 워크플로우의 permissions 선언을 회귀 테스트로 고정 https://github.com/Twin-Fang/project-auto-wizard/issues/34

doctor가 Workflow permissions를 INFO로 낮출 수 있는 근거는 마법사 워크플로우가
자체 permissions를 선언한다는 사실이다. 나중에 새 공통 워크플로우가 선언을
빠뜨리면 이 전제가 무너지고 doctor 문구가 다시 거짓이 되므로 먼저 고정한다.
EOF
```

---

### Task 2: 진단 항목을 INFO로 낮추고 문구 교정

**Files:**
- Modify: `src/commands/doctor.js` (`Workflow permissions` 분기 — `perm.status !== 0` / `permValue === "write"` / else 3갈래)
- Test: `tests/node/doctor.test.js`

**Interfaces:**
- Consumes: Task 1이 고정한 전제
- Produces: `runDoctor()`가 반환하는 `Workflow permissions` 항목의 `status`가 `read`일 때 `"INFO"`. `impact`/`actions`/`doc` 대신 `note`를 갖는다.

**설계 노트**: `INFO` 렌더 경로는 `note`만 출력하고 `value`는 쓰지 않는다(`printDoctorReport`). 현재값을 계속 보여주려면 `note`의 첫 줄에 넣는다 — 렌더러를 바꾸지 않아도 되고, INFO 항목의 표시 형태가 `GitHub Models`와 일관된다.

**조회 실패(`perm.status !== 0`) 분기는 `WARN`으로 유지한다.** 그건 오진이 아니라 실제로 정보를 얻지 못한 상태이고, 관리자 확인이라는 조치가 실제로 필요하다.

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`tests/node/doctor.test.js`의 "이슈 #29: 출력 재설계 회귀 가드" 섹션 끝에 다음을 추가한다.

```js
// --- 이슈 #34: Workflow permissions 오진 수정 -----------------------------------------

// 마법사 워크플로우는 자체 permissions 선언으로 동작하므로 레포 기본값이 read여도 문제가 아니다.
// 조치가 필요 없는 항목에 WARN을 붙이면 없는 장애를 알리고 불필요한 권한 상향을 유도한다.
test("runDoctor: Workflow permissions가 read여도 경고가 아니라 INFO다", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const exec = fakeExec([
      ...ALL_OK_EXEC.filter(([k]) => !k.includes("permissions/workflow")),
      ["actions/permissions/workflow", { status: 0, stdout: "read", stderr: "" }],
    ]);
    const perm = runDoctor(dir, { exec }).find((r) => r.name === "Workflow permissions");
    assert.strictEqual(perm.status, "INFO");
    assert.ok(perm.note?.length, "INFO 항목에는 note가 있어야 합니다");
    assert.ok(perm.note.join(" ").includes("read"), "현재값이 안내에 남아 있어야 합니다");
    assert.ok(!perm.impact, "조치가 불필요하므로 impact를 붙이지 않는다");
    assert.ok(!perm.actions?.length, "조치가 불필요하므로 actions를 붙이지 않는다");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// "릴리스가 중단된다"는 거짓 진술이므로 어떤 경로에서도 나오면 안 된다.
test("runDoctor: Workflow permissions 안내에 릴리스 중단 표현을 쓰지 않는다", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const exec = fakeExec([
      ...ALL_OK_EXEC.filter(([k]) => !k.includes("permissions/workflow")),
      ["actions/permissions/workflow", { status: 0, stdout: "read", stderr: "" }],
    ]);
    const perm = runDoctor(dir, { exec }).find((r) => r.name === "Workflow permissions");
    const all = [perm.value, ...(perm.note || []), ...(perm.impact || [])].filter(Boolean).join(" ");
    assert.ok(!all.includes("중단"), `거짓 진술이 남아 있습니다: ${all}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// 조회 자체가 실패한 경우는 오진이 아니라 실제로 정보를 얻지 못한 상태다 — WARN 유지.
test("runDoctor: Workflow permissions 조회 실패는 WARN을 유지한다", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const exec = fakeExec([
      ...ALL_OK_EXEC.filter(([k]) => !k.includes("permissions/workflow")),
      ["actions/permissions/workflow", { status: 1, stdout: "", stderr: "forbidden" }],
    ]);
    const perm = runDoctor(dir, { exec }).find((r) => r.name === "Workflow permissions");
    assert.strictEqual(perm.status, "WARN");
    assert.ok(perm.actions?.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 테스트를 실행해 실패를 확인한다**

```bash
node --test tests/node/doctor.test.js
```

Expected: 새 테스트 중 최소 2개 FAIL — `status`가 `INFO`가 아니라 `WARN`이고, `"중단"` 표현이 남아 있다.

- [ ] **Step 3: `doctor.js`의 해당 분기를 수정한다**

`src/commands/doctor.js`에서 `permValue === "write"`가 아닌 경우의 `add({...})` 블록을 다음으로 교체한다.

```js
  } else {
    // 레포의 default_workflow_permissions는 "워크플로우가 permissions를 생략했을 때의 기본값"이지
    // 상한이 아니다. 마법사가 설치하는 워크플로우는 전부 자체 permissions를 선언하므로(#34,
    // tests/node/payload-workflow-permissions.test.js가 고정) read여도 정상 동작한다.
    // 조치가 필요 없는 항목이므로 WARN이 아니라 INFO다.
    add({
      name: "Workflow permissions", purpose: "직접 추가한 워크플로우의 기본 권한", status: "INFO",
      note: [
        `현재 ${permValue || "확인불가"} 입니다 — 마법사가 설치한 워크플로우는 각자 권한을 선언하므로 그대로 동작합니다.`,
        "직접 추가한 워크플로우에서 permissions를 생략했다면 이 기본값을 따르므로, 그때만 Read and write로 올리세요.",
      ],
    });
  }
```

`purpose`도 함께 바꾼다 — 기존 `"버전 커밋 자동 push"`는 이 설정이 버전 커밋을 좌우한다는 잘못된 인상을 준다.

- [ ] **Step 4: 테스트를 실행해 통과를 확인한다**

```bash
node --test tests/node/doctor.test.js
```

Expected: 전체 PASS (기존 13개 + 신규 3개 = 16개).

- [ ] **Step 5: 실제 출력을 눈으로 확인한다**

```bash
node bin/project-auto-wizard.js --mode doctor
```

Expected: 이 레포의 `default_workflow_permissions`가 `read`이므로 해당 항목이 `[i]`로 출력되고, 문제 개수가 1개 줄어든다. `"중단"`이라는 표현이 사라진다.

- [ ] **Step 6: 전체 테스트**

```bash
npm run test:node
```

Expected: 전부 통과. (WS1 적용 후라면 330 pass / 0 fail)

- [ ] **Step 7: 커밋**

```bash
git add src/commands/doctor.js tests/node/doctor.test.js
git commit -F - <<'EOF'
doctor_Workflow_permissions_오진_수정 : fix : Workflow permissions 경고 오진 수정 (WARN → INFO) https://github.com/Twin-Fang/project-auto-wizard/issues/34

레포의 default_workflow_permissions가 read여도 마법사 워크플로우는 정상 동작한다.
이 값은 워크플로우가 permissions를 생략했을 때의 기본값이지 상한이 아니고,
payload 공통 워크플로우는 전부 contents: write를 스스로 선언한다.
이 레포 자체가 반증이다 — read인데 VERSION-CONTROL이 버전 커밋 push에 성공한다.

- WARN → INFO. 조치가 불필요한 항목에 경고를 붙이면 없는 장애를 알리고
  불필요한 권한 상향을 유도해 최소 권한 원칙에 역행한다
- "릴리스가 중단됩니다" 거짓 진술 제거
- purpose를 "직접 추가한 워크플로우의 기본 권한"으로 교정
- 조회 실패(권한 부족) 분기는 실제로 조치가 필요하므로 WARN 유지
EOF
```

---

### Task 3: README 진단 예시 동기화

**Files:**
- Modify: `README.md` (`## 설치 상태 확인 · 진단 · 미리보기` 절의 doctor 출력 예시)

**Interfaces:**
- Consumes: Task 2의 새 출력
- Produces: 없음 (문서만)

**배경**: README에 doctor 출력 예시가 있고, 거기에 `Workflow permissions`가 `[!]`로 등장한다. 코드를 고치면 문서가 거짓이 된다.

- [ ] **Step 1: 현재 예시를 확인한다**

```bash
grep -n "Workflow permissions" README.md
```

Expected: 출력 예시 블록 안에 `[!] Workflow permissions — 버전 커밋 자동 push`가 있다.

- [ ] **Step 2: 예시에서 해당 블록을 교체한다**

`[!] Workflow permissions — 버전 커밋 자동 push` 블록(그 아래 `✗`·`→` 줄 포함)을 지우고, `[i] GitHub Models` 앞에 다음을 넣는다.

```
  [i] Workflow permissions — 직접 추가한 워크플로우의 기본 권한
      현재 read 입니다 — 마법사가 설치한 워크플로우는 각자 권한을 선언하므로 그대로 동작합니다.
```

예시 하단의 요약 줄도 실제와 맞춘다 — 문제 항목이 하나 줄었으므로 `! 1개 항목에서...`를 그대로 두려면 다른 `[!]` 항목이 예시에 남아 있어야 한다. 남아 있지 않다면 요약 줄을 `✓ 문제를 찾지 못했습니다.`로 바꾼다.

- [ ] **Step 3: 예시와 실제 출력이 어긋나지 않는지 대조한다**

```bash
node bin/project-auto-wizard.js --mode doctor
grep -n -A2 "\[i\] Workflow permissions" README.md
```

Expected: README 예시의 문구가 실제 출력과 일치한다.

- [ ] **Step 4: 커밋**

```bash
git add README.md
git commit -F - <<'EOF'
doctor_Workflow_permissions_오진_수정 : docs : README의 doctor 출력 예시를 실제 출력과 동기화 https://github.com/Twin-Fang/project-auto-wizard/issues/34
EOF
```

---

### Task 4: PR 생성 및 머지

**Files:** 없음 (검증 태스크)

- [ ] **Step 1: push하고 PR을 생성한다**

```bash
git push -u origin HEAD
gh pr create --repo Twin-Fang/project-auto-wizard --base main \
  --title "🐛[버그][doctor] Workflow permissions 오진 수정 — read여도 정상 동작" \
  --body "closes #34 — 근거와 재현은 이슈 #34, 설계는 docs/superpowers/specs/2026-08-06-release-pipeline-hardening-design.md §5.2 참조."
```

- [ ] **Step 2: CI 통과를 확인한다**

```bash
until [ -z "$(gh pr checks <PR번호> --repo Twin-Fang/project-auto-wizard --json state -q '.[]|select(.state=="PENDING")|.state')" ]; do sleep 10; done
gh pr checks <PR번호> --repo Twin-Fang/project-auto-wizard
```

Expected: WS1이 선행됐다면 CI 6조합이 전부 통과.

- [ ] **Step 3: 머지한다**

```bash
gh pr merge <PR번호> --repo Twin-Fang/project-auto-wizard --merge
```
