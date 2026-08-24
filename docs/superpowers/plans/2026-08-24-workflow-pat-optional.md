# WORKFLOW_PAT 선택 사항 격하 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `src/commands/doctor.js`의 `WORKFLOW_PAT` 미등록 판정을 `WARN`에서 `INFO`로 낮추고, `src/ui/summary.js`·`README.md`의 관련 안내 문구를 "1순위 권장"에서 "속도 최적화용 선택 사항 + bot/machine 계정 권장"으로 갱신한다.

**Architecture:** `GITHUB_TOKEN`만으로 릴리스 파이프라인 전체(automerge → Release 발행 → npm 배포 트리거)가 끝까지 이어지는 폴백이 워크플로우 YAML에 이미 구현되어 있음을 조사로 확인했다 — 코드/워크플로우 로직 변경은 없다. 이번 변경은 순수하게 **문구·심각도(status) 표현**을 실제 동작(폴백이 있어 최대 ~20초 추가 지연으로 자동 복구됨)에 맞게 정정하는 것이다. `doctor.js`에는 정확히 같은 논리로 `WARN`→`INFO`로 낮춘 선례("Workflow permissions" 항목, #34)가 있어 그 패턴을 그대로 따른다.

**Tech Stack:** Node.js 내장 테스트 러너(`node --test`), 순수 JS(외부 의존성 없음)

**Spec:** `docs/superpowers/specs/2026-08-24-workflow-pat-optional-design.md`

## Global Constraints

- `status: "INFO"`인 doctor 항목은 `doc` 필드를 달지 않는다 (기존 "Workflow permissions" INFO 항목과의 일관성 — spec §상세 변경)
- `payload/workflows/common/*.yaml`, `.github/workflows/*.yaml`, `src/core/verify.js`는 이번 변경 범위에서 **손대지 않는다** — 이미 올바름 (spec §결정 4)
- 커밋 메시지는 한국어로 작성, Conventional Commits 타입 접두사(`feat:`, `fix:`, `docs:`, `test:` 등)만 영어 유지 (프로젝트 `CLAUDE.md`)
- PR 베이스는 `develop` (이번 파이프라인 goal에 명시)
- 이 레포 자신의 `WORKFLOW_PAT` 시크릿 교체는 GitHub Settings 조작이라 이번 플랜(코드 변경) 범위 밖이다 — 이슈 #105에 운영 체크리스트로 이미 기록되어 있으므로 이 플랜에서는 아무 태스크도 만들지 않는다.

---

### Task 1: `doctor.js`의 WORKFLOW_PAT 판정을 WARN에서 INFO로 낮춘다 (TDD)

**Files:**
- Modify: `tests/node/doctor.test.js:90-109` (테스트 제목·단언 갱신)
- Modify: `tests/node/doctor.test.js:154-174` (fixture 재구성)
- Modify: `src/commands/doctor.js:114-131` (status/문구 변경)

**Interfaces:**
- Consumes: `runDoctor(cwd, { exec })` (기존 함수 시그니처, 변경 없음), `DOC.postInstall` (기존 상수, 변경 없음)
- Produces: `runDoctor()`가 반환하는 결과 배열에서 `name === "WORKFLOW_PAT secret"`인 항목의 `status`가 이제 `"INFO"`이고 `note` 배열을 가짐 (기존 `impact`/`actions`/`doc`는 없음) — 이후 태스크는 이 결과물을 직접 참조하지 않으므로 인터페이스 영향 없음

- [ ] **Step 1: 90번째 줄 테스트를 새 기대값으로 수정 (RED 준비)**

`tests/node/doctor.test.js`에서 아래 블록(90-109번째 줄)을:

```javascript
test("runDoctor: missing WORKFLOW_PAT and non-write permissions -> WARN", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const exec = fakeExec([
      ["gh --version", { status: 0, stdout: "gh version 2.0.0", stderr: "" }],
      ["gh auth status", { status: 0, stdout: "Logged in", stderr: "" }],
      ["git -C", { status: 0, stdout: "git@github.com:acme/widgets.git\n", stderr: "" }],
      ["actions/permissions/workflow", { status: 0, stdout: "read", stderr: "" }],
      ["secret list", { status: 0, stdout: "AI_API_KEY\tUpdated 2026-01-01\n", stderr: "" }],
      [".allow_merge_commit", { status: 0, stdout: "false", stderr: "" }],
    ]);
    const results = runDoctor(dir, { exec });
    // Workflow permissions는 read여도 조치가 불필요하므로 INFO다 (#34).
    assert.strictEqual(results.find((r) => r.name === "Workflow permissions").status, "INFO");
    assert.strictEqual(results.find((r) => r.name === "WORKFLOW_PAT secret").status, "WARN");
    assert.strictEqual(results.find((r) => r.name === "automerge 호환성(merge commit 허용)").status, "WARN");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

아래로 교체한다:

```javascript
test("runDoctor: missing WORKFLOW_PAT -> INFO (폴백이 자동 복구), non-write permissions -> INFO, merge commit 꺼짐 -> WARN", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const exec = fakeExec([
      ["gh --version", { status: 0, stdout: "gh version 2.0.0", stderr: "" }],
      ["gh auth status", { status: 0, stdout: "Logged in", stderr: "" }],
      ["git -C", { status: 0, stdout: "git@github.com:acme/widgets.git\n", stderr: "" }],
      ["actions/permissions/workflow", { status: 0, stdout: "read", stderr: "" }],
      ["secret list", { status: 0, stdout: "AI_API_KEY\tUpdated 2026-01-01\n", stderr: "" }],
      [".allow_merge_commit", { status: 0, stdout: "false", stderr: "" }],
    ]);
    const results = runDoctor(dir, { exec });
    // Workflow permissions는 read여도 조치가 불필요하므로 INFO다 (#34).
    assert.strictEqual(results.find((r) => r.name === "Workflow permissions").status, "INFO");
    // WORKFLOW_PAT 미등록도 폴백이 자동 복구하므로 조치가 필요 없다 — INFO다 (#105).
    const pat = results.find((r) => r.name === "WORKFLOW_PAT secret");
    assert.strictEqual(pat.status, "INFO");
    assert.ok(pat.note?.some((l) => l.includes("bot") || l.includes("machine")), "bot/machine 계정 권장 문구가 없습니다");
    assert.strictEqual(pat.doc, undefined, "INFO 항목은 doc 링크를 달지 않는다");
    assert.strictEqual(results.find((r) => r.name === "automerge 호환성(merge commit 허용)").status, "WARN");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 154번째 줄 테스트의 fixture를 WORKFLOW_PAT이 아닌 실제 WARN 조합으로 재구성 (RED 준비)**

같은 파일에서 아래 블록(153-174번째 줄)을:

```javascript
// 문제 항목은 조치 단계와 문서 링크를 반드시 동반해야 한다(스펙 §3.3② "해결 가이드 링크").
test("runDoctor: 문제 항목은 영향·조치·문서 링크를 함께 제공한다", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const exec = fakeExec([
      ...ALL_OK_EXEC.filter(([k]) => !k.includes("secret list") && !k.includes(".allow_merge_commit")),
      ["secret list", { status: 0, stdout: "AI_API_KEY\tUpdated 2026-01-01\n", stderr: "" }],
      [".allow_merge_commit", { status: 0, stdout: "false", stderr: "" }],
    ]);
    const problems = runDoctor(dir, { exec }).filter((r) => r.status === "WARN" || r.status === "FAIL");
    assert.ok(problems.length >= 2);
    for (const r of problems) {
      assert.ok(r.impact?.length, `${r.name}에 영향 설명이 없습니다`);
      assert.ok(r.actions?.length, `${r.name}에 조치 단계가 없습니다`);
    }
    // Workflow permissions는 #34에서 INFO로 내려갔으므로, 실제 조치가 필요한 항목으로 검증한다.
    const pat = problems.find((r) => r.name === "WORKFLOW_PAT secret");
    assert.strictEqual(pat.doc, DOC.postInstall);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

아래로 교체한다 — `WORKFLOW_PAT`은 #105에서 INFO로 내려갔으므로 문제 항목 표본에서 빼고, `actions/permissions/workflow` 조회 실패 + `allow_merge_commit=false` 조합으로 실제 WARN 2건을 만든다:

```javascript
// 문제 항목은 조치 단계와 문서 링크를 반드시 동반해야 한다(스펙 §3.3② "해결 가이드 링크").
test("runDoctor: 문제 항목은 영향·조치·문서 링크를 함께 제공한다", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const exec = fakeExec([
      ...ALL_OK_EXEC.filter(([k]) => !k.includes("actions/permissions/workflow") && !k.includes(".allow_merge_commit")),
      ["actions/permissions/workflow", { status: 1, stdout: "", stderr: "not found" }],
      [".allow_merge_commit", { status: 0, stdout: "false", stderr: "" }],
    ]);
    const problems = runDoctor(dir, { exec }).filter((r) => r.status === "WARN" || r.status === "FAIL");
    assert.ok(problems.length >= 2);
    for (const r of problems) {
      assert.ok(r.impact?.length, `${r.name}에 영향 설명이 없습니다`);
      assert.ok(r.actions?.length, `${r.name}에 조치 단계가 없습니다`);
    }
    // WORKFLOW_PAT은 #105에서 INFO로 내려갔으므로 문제 항목 표본에 없다 — 실제 조치가
    // 필요한 항목(automerge 호환성)으로 doc 링크 존재를 검증한다.
    const automerge = problems.find((r) => r.name === "automerge 호환성(merge commit 허용)");
    assert.strictEqual(automerge.doc, DOC.postInstall);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: 테스트 실행 후 실패(RED) 확인**

Run: `node --test tests/node/doctor.test.js`

Expected:
- Step 1에서 고친 테스트(`missing WORKFLOW_PAT -> INFO ...`)는 **FAIL**한다. 이 fixture의 `secret list`는 `AI_API_KEY`만 반환해 `WORKFLOW_PAT`이 미등록 상태인데, 소스가 아직 안 바뀌어 `pat.status`가 여전히 `"WARN"`이라 `assert.strictEqual(pat.status, "INFO")`에서 실패한다.
- Step 2에서 고친 테스트(`문제 항목은 영향·조치·문서 링크를 함께 제공한다`)는 소스 변경과 무관하게 **이미 PASS**한다 — 이 fixture는 `ALL_OK_EXEC`의 기본값(`secret list`에 `WORKFLOW_PAT` 포함)을 그대로 쓰므로 `WORKFLOW_PAT`은 수정 전후 모두 `status: "OK"`이고 `problems`에 아예 들어가지 않는다. 이 테스트는 WORKFLOW_PAT의 WARN/INFO 여부가 아니라 "문제 항목엔 impact/actions/doc이 있다"는 별개의 불변식을 `Workflow permissions`+`automerge` 조합으로 검증하도록 fixture를 바꾼 것이다 — RED가 아니어도 정상이다.

다른 기존 테스트(gh CLI 누락, 인증 실패, git 원격 없음 등)는 이번 변경과 무관하므로 계속 PASS해야 한다.

- [ ] **Step 4: `doctor.js`의 WORKFLOW_PAT 판정 수정 (GREEN)**

`src/commands/doctor.js`에서 아래 블록(114-131번째 줄)을:

```javascript
  const secrets = exec("gh", ["secret", "list", "--repo", `${owner}/${repo}`]);
  const hasPat = secrets.status === 0 && (secrets.stdout || "").split("\n").some((l) => l.startsWith("WORKFLOW_PAT"));
  add(hasPat
    ? { name: "WORKFLOW_PAT secret", label: "WORKFLOW_PAT", purpose: "자동 태그·Release 발행", status: "OK", value: "등록됨" }
    : {
      name: "WORKFLOW_PAT secret", label: "WORKFLOW_PAT", purpose: "자동 태그·Release 발행", status: "WARN",
      value: "secret이 등록되어 있지 않습니다.",
      impact: [
        "PR 자동 머지 뒤 태그·Release 워크플로가 이어지지 않습니다.",
        "(GitHub 정책상 기본 토큰으로 만든 커밋은 다음 워크플로를 깨우지 못합니다)",
      ],
      actions: [
        "개인 액세스 토큰 발급 (scopes: repo, workflow)",
        "레포 Settings → Secrets and variables → Actions",
        "New repository secret · 이름은 WORKFLOW_PAT",
      ],
      doc: DOC.postInstall,
    });
```

아래로 교체한다:

```javascript
  const secrets = exec("gh", ["secret", "list", "--repo", `${owner}/${repo}`]);
  const hasPat = secrets.status === 0 && (secrets.stdout || "").split("\n").some((l) => l.startsWith("WORKFLOW_PAT"));
  add(hasPat
    ? { name: "WORKFLOW_PAT secret", label: "WORKFLOW_PAT", purpose: "자동 태그·Release 발행", status: "OK", value: "등록됨" }
    : {
      // 조치가 필요 없으므로 WARN이 아니라 INFO다 — 위 Workflow permissions 항목과 동일 이유:
      // 폴백(wait-for-merge-and-trigger-release / Trigger NPM-PUBLISH)이 GITHUB_TOKEN만으로
      // 파이프라인을 끝까지 이어가므로, 없는 장애를 경고로 띄우지 않는다(이슈 #105).
      name: "WORKFLOW_PAT secret", label: "WORKFLOW_PAT", purpose: "자동 태그·Release 발행", status: "INFO",
      note: [
        "secret이 없어도 폴백이 자동으로 이어받아 태그·Release까지 진행됩니다 — 실제 병합 후 최대 ~20초 정도 더 걸릴 뿐입니다.",
        "속도를 더 원한다면 PAT을 등록할 수 있습니다 — 반드시 개인 계정이 아닌 조직 bot/machine 계정으로 발급하세요 (scopes: repo, workflow).",
        "등록: 레포 Settings → Secrets and variables → Actions → New repository secret · 이름은 WORKFLOW_PAT",
      ],
    });
```

- [ ] **Step 5: 테스트 실행 후 통과(GREEN) 확인**

Run: `node --test tests/node/doctor.test.js`

Expected: 전체 테스트 PASS. 특히 Step 1·Step 2에서 고친 두 테스트가 통과해야 한다.

- [ ] **Step 6: 커밋**

```bash
git add tests/node/doctor.test.js src/commands/doctor.js
git commit -m "fix: doctor의 WORKFLOW_PAT 미등록 판정을 WARN에서 INFO로 낮춤

이슈 #105 — GITHUB_TOKEN 폴백이 이미 automerge부터 Release 발행까지
자동으로 이어가므로(최대 ~20초 추가 지연), WORKFLOW_PAT 미등록은
조치가 필요한 문제가 아니다. Workflow permissions 항목(#34)과 동일한
논리로 WARN에서 INFO로 낮추고, 등록 시 개인 계정이 아닌 bot/machine
계정을 쓰라는 안내를 추가한다."
```

---

### Task 2: `summary.js`의 설치 완료 화면 문구를 보강한다

**Files:**
- Modify: `src/ui/summary.js:159-162`

**Interfaces:**
- Consumes: 없음 (독립적인 문자열 변경)
- Produces: 없음

- [ ] **Step 1: 문구 교체**

`src/ui/summary.js`에서 아래 블록(159-162번째 줄)을:

```javascript
  err(`  ${num()} 릴리스 automerge용 PAT (선택 — 없으면 GITHUB_TOKEN 사용)`);
  err("     → Repository Settings > Secrets > Actions");
  err("     → Secret Name: WORKFLOW_PAT (Scopes: repo, workflow)");
  err("     → GITHUB_TOKEN 머지는 후속 워크플로우를 트리거하지 않습니다");
```

아래로 교체한다:

```javascript
  err(`  ${num()} 릴리스 automerge용 PAT (선택 — 없으면 GITHUB_TOKEN 폴백으로 자동 진행)`);
  err("     → Repository Settings > Secrets > Actions");
  err("     → Secret Name: WORKFLOW_PAT (Scopes: repo, workflow)");
  err("     → 등록 시 개인 계정이 아닌 조직 bot/machine 계정으로 발급하세요");
  err("     → 없어도 자동 복구되며, 있으면 병합~Release 반영이 조금 더 빠릅니다");
```

- [ ] **Step 2: 관련 테스트 실행**

Run: `node --test tests/node/summary-output.test.js`

Expected: 전체 PASS (이 테스트 파일은 WORKFLOW_PAT 관련 문자열을 단언하지 않으므로 문구 변경과 무관하게 통과해야 한다).

- [ ] **Step 3: 커밋**

```bash
git add src/ui/summary.js
git commit -m "docs: 설치 완료 화면의 WORKFLOW_PAT 안내에 bot 계정 권장 문구 추가

이슈 #105 — automerge용 PAT을 등록할 때 개인 계정이 아닌 조직
bot/machine 계정으로 발급하도록 안내하고, GITHUB_TOKEN 폴백이
자동으로 진행된다는 점을 명확히 한다."
```

---

### Task 3: README.md의 WORKFLOW_PAT 관련 안내를 갱신한다

**Files:**
- Modify: `README.md:170-193` (doctor 예시 출력)
- Modify: `README.md:226` ("설치 후 확인할 것" 표)

**Interfaces:**
- Consumes: 없음
- Produces: 없음

- [ ] **Step 1: doctor 예시 출력 교체**

`README.md`에서 아래 블록(170-193번째 줄, 코드 펜스 포함)을:

````markdown
```
◆  환경 진단 — project-auto-wizard doctor

  [✓] gh CLI — 레포 설정 조회용                    gh version 2.96.0
  [✓] GitHub 로그인 — 레포 설정 조회 권한          인증됨
  [✓] merge commit 허용 — 릴리스 PR 자동 머지 조건  허용됨

  [!] WORKFLOW_PAT — 자동 태그·Release 발행
      ✗ secret이 등록되어 있지 않습니다.
        PR 자동 머지 뒤 태그·Release 워크플로가 이어지지 않습니다.
        (GitHub 정책상 기본 토큰으로 만든 커밋은 다음 워크플로를 깨우지 못합니다)
      → 개인 액세스 토큰 발급 (scopes: repo, workflow)
      → 레포 Settings → Secrets and variables → Actions
      → New repository secret · 이름은 WORKFLOW_PAT
      → 자세히: https://github.com/Twin-Fang/project-auto-wizard#post-install

  [i] Workflow permissions — 직접 추가한 워크플로우의 기본 권한
      현재 read 입니다 — 마법사가 설치한 워크플로우는 각자 권한을 선언하므로 그대로 동작합니다.
  [i] GitHub Models — AI 릴리스 노트 생성
      조직 정책으로 차단됐는지는 자동으로 확인할 수 없습니다 (Settings → Models).
      차단돼 있어도 규칙 기반 요약으로 자동 전환되므로 그대로 두셔도 됩니다.

  ! 1개 항목에서 문제를 찾았습니다.
    설치 자체는 지금 진행할 수 있고, 위 1개는 나중에 설정해도 됩니다.
```
````

아래로 교체한다:

````markdown
```
◆  환경 진단 — project-auto-wizard doctor

  [✓] gh CLI — 레포 설정 조회용                    gh version 2.96.0
  [✓] GitHub 로그인 — 레포 설정 조회 권한          인증됨
  [✓] merge commit 허용 — 릴리스 PR 자동 머지 조건  허용됨

  [i] Workflow permissions — 직접 추가한 워크플로우의 기본 권한
      현재 read 입니다 — 마법사가 설치한 워크플로우는 각자 권한을 선언하므로 그대로 동작합니다.
  [i] WORKFLOW_PAT — 자동 태그·Release 발행
      secret이 없어도 폴백이 자동으로 이어받아 태그·Release까지 진행됩니다 — 실제 병합 후 최대 ~20초 정도 더 걸릴 뿐입니다.
      속도를 더 원한다면 PAT을 등록할 수 있습니다 — 반드시 개인 계정이 아닌 조직 bot/machine 계정으로 발급하세요 (scopes: repo, workflow).
      등록: 레포 Settings → Secrets and variables → Actions → New repository secret · 이름은 WORKFLOW_PAT
  [i] GitHub Models — AI 릴리스 노트 생성
      조직 정책으로 차단됐는지는 자동으로 확인할 수 없습니다 (Settings → Models).
      차단돼 있어도 규칙 기반 요약으로 자동 전환되므로 그대로 두셔도 됩니다.

  ✓ 문제를 찾지 못했습니다.
```
````

- [ ] **Step 2: "설치 후 확인할 것" 표의 WORKFLOW_PAT 행 교체**

`README.md`에서 아래 줄(226번째 줄)을:

```markdown
| **`WORKFLOW_PAT` secret** (권장) | automerge 후 후속 워크플로우(tag/Release)가 이어지려면 PAT가 필요합니다 — `GITHUB_TOKEN`으로 머지하면 GitHub 정책상 후속 워크플로우가 트리거되지 않습니다. Settings → Secrets → Actions에 `WORKFLOW_PAT` (scopes: `repo`, `workflow`) 등록. 없으면 `GITHUB_TOKEN`으로 동작하되 Release 발행은 수동 재실행이 필요할 수 있습니다 |
```

아래로 교체한다:

```markdown
| **`WORKFLOW_PAT` secret** (선택 — 속도 최적화용) | 없어도 `GITHUB_TOKEN` 폴백이 automerge부터 Release 발행까지 자동으로 이어갑니다(실제 병합 후 최대 ~20초 추가). 더 빠르게 하고 싶다면 Settings → Secrets → Actions에 `WORKFLOW_PAT` (scopes: `repo`, `workflow`) 등록 — 반드시 개인 계정이 아닌 조직 bot/machine 계정으로 발급하세요 |
```

- [ ] **Step 3: 앵커 회귀 테스트 실행**

Run: `node --test tests/node/doctor.test.js`

Expected: 전체 PASS. 특히 `"DOC 링크가 가리키는 앵커가 README에 실제로 존재한다"` 테스트가 통과해야 한다 (`<a id="post-install">` 앵커 자체는 이번 변경으로 지우지 않았으므로 계속 존재).

- [ ] **Step 4: 커밋**

```bash
git add README.md
git commit -m "docs: README의 WORKFLOW_PAT 안내를 '선택 사항'으로 갱신

이슈 #105 — doctor 예시 출력과 설치 후 확인할 것 표에서 WORKFLOW_PAT을
1순위 권장에서 속도 최적화용 선택 사항으로 낮추고, 등록 시 개인 계정이
아닌 조직 bot/machine 계정을 쓰라는 안내를 추가한다."
```

---

### Task 4: 최종 확인 — 전체 스위트 및 회귀 없음 검증

**Files:**
- 없음 (검증 전용 태스크, 파일 수정 없음)

**Interfaces:**
- Consumes: Task 1~3의 결과물
- Produces: 없음

- [ ] **Step 1: 전체 테스트 스위트 실행**

Run: `npm test`

Expected: node/python 테스트 전부 PASS, 실패 0.

- [ ] **Step 2: 워크플로우 YAML이 변경되지 않았는지 확인**

```bash
git diff --stat origin/develop..HEAD -- payload/workflows/ .github/workflows/ src/core/verify.js
```

Expected: 출력 없음(빈 diff) — 이번 변경이 spec의 결정 4("워크플로우 YAML과 verify.js는 손대지 않는다")를 지켰는지 확인.

- [ ] **Step 3: 남은 옛 문구가 없는지 grep으로 확인**

```bash
grep -rn "WORKFLOW_PAT.*권장\|automerge 후 후속 워크플로우" README.md src/ || echo "OK: 옛 '권장' 문구 없음"
```

Expected: "OK: 옛 '권장' 문구 없음" 출력.

- [ ] **Step 4: 별도 커밋 없음**

이 태스크는 검증 전용이라 커밋할 변경사항이 없다. 모든 확인이 끝나면 태스크 완료로 표시한다.
