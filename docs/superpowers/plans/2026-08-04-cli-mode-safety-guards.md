# CLI 안전장치 3종 결함 수정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `--mode` 값 검증 누락, TTY 환경에서의 확인 없는 즉시 설치, 부정확한 완료 요약(`printSummary`)이라는 3개의 안전장치 결함(issue #19)을 고쳐 "CLI가 실제로 한 일"과 "화면에 뜨는 메시지"를 항상 일치시킨다.

**Architecture:** `src/cli/args.js`에서 `--mode` 값을 파싱 즉시 화이트리스트 검증해 모든 부수효과보다 앞서 차단한다. `src/index.js`의 두 TTY 게이트(`revert`, 메인 명시 모드)에서 `!process.stdout.isTTY` 조건을 제거해 `--force` 없는 실행을 TTY 여부와 무관하게 항상 거부한다. `src/core/copy/workflows.js`의 `copyWorkflows()`가 실제로 새로 쓴 파일명 목록(`copiedFiles`)을 반환하도록 확장하고, `src/ui/summary.js`가 디렉터리 재스캔 대신 이 목록을 그대로 렌더링하도록 데이터 흐름을 바꾼다.

**Tech Stack:** Node.js(ESM, `node --test` 기반 테스트), 외부 의존성 추가 없음.

## Global Constraints

- 커밋 메시지는 한국어로 작성한다(Conventional Commits 타입 접두사는 영어 유지) — 프로젝트 `CLAUDE.md`.
- `git` force성 옵션(`--force`, `-f`, `--hard` 등)은 어떤 경우에도 사용하지 않는다.
- `purge` 모드는 계속 숨김 상태를 유지한다 — `--help` 출력과 이번에 추가하는 에러 메시지 힌트 어디에도 노출하지 않는다(issue #6 의도 보존).
- `uninstall`/`purge`/`status`/`doctor` 모드는 이미 올바르게 동작하므로 이번 범위에서 변경하지 않는다.
- 각 태스크는 TDD로 진행한다: 실패하는 테스트를 먼저 작성 → 실패 확인 → 최소 구현 → 통과 확인 → 커밋.
- 테스트 실행: `node --test "tests/node/**/*.test.js"` (특정 파일만 돌리려면 `node --test tests/node/<file>.test.js`).
- 참고 스펙: `docs/superpowers/specs/2026-08-04-cli-mode-safety-guards-design.md`.

---

### Task 1: `--mode` 화이트리스트 검증

**Files:**
- Modify: `src/context.js` (`VALID_TYPES` 선언 바로 아래, 2~5행 근처)
- Modify: `src/cli/args.js:1~2`(import), `parseArgs()` 리턴 직전(90~92행 근처)
- Test: `tests/node/mode-validation.test.js` (신규)

**Interfaces:**
- Consumes: 없음(독립 태스크).
- Produces: `VALID_MODES: string[]`(`src/context.js`에서 export) — Task 5가 참고용으로 알아둘 값(`interactive`, `full`, `version`, `workflows`, `revert`, `uninstall`, `status`, `doctor`, `purge`). `parseArgs()`는 이제 유효하지 않은 `--mode` 값에 대해 항상 `CliError`를 던진다.

- [ ] **Step 1: 실패하는 단위 테스트 작성**

`tests/node/mode-validation.test.js` 신규 생성:

```javascript
// tests/node/mode-validation.test.js
import { test } from "node:test";
import assert from "node:assert";
import { parseArgs, CliError } from "../../src/cli/args.js";

test("parseArgs: 알 수 없는 --mode 값은 CliError를 던진다", () => {
  assert.throws(() => parseArgs(["--mode", "ful"]), CliError);
});

test("parseArgs: --mode 뒤에 값이 없으면(빈 문자열로 해석) CliError를 던진다", () => {
  assert.throws(() => parseArgs(["--mode"]), CliError);
});

test("parseArgs: 유효한 모드는 전부 통과한다 (purge 포함)", () => {
  const modes = ["interactive", "full", "version", "workflows", "revert", "uninstall", "status", "doctor", "purge"];
  for (const m of modes) {
    const opts = parseArgs(["--mode", m]);
    assert.strictEqual(opts.mode, m);
  }
});

test("parseArgs: --mode 미지정 시 기본값 interactive는 그대로 통과한다", () => {
  const opts = parseArgs([]);
  assert.strictEqual(opts.mode, "interactive");
});

test("parseArgs: 에러 메시지는 숨김 모드(purge)를 노출하지 않는다", () => {
  try {
    parseArgs(["--mode", "ful"]);
    assert.fail("CliError가 발생해야 합니다");
  } catch (e) {
    assert.ok(!e.message.includes("purge"), "purge는 숨김 모드이므로 에러 메시지에 노출되면 안 됩니다");
  }
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test tests/node/mode-validation.test.js`
Expected: 처음 2개 테스트(`알 수 없는 --mode`, `값이 없으면`)는 FAIL(예외가 던져지지 않음 — 현재 `parseArgs`는 검증이 없으므로 `result.mode`에 `"ful"`/`""`가 그대로 담겨 통과함). 나머지는 이미 PASS.

- [ ] **Step 3: `VALID_MODES` 상수 추가**

`src/context.js`의 `VALID_TYPES` 선언 바로 아래에 추가:

```javascript
// --mode 화이트리스트 (issue #19) — 알 수 없는 값은 부수효과(브랜치 조회 등) 이전에 즉시 거부해야 한다.
// purge는 --help/대화형 메뉴에 노출하지 않는 숨김 모드(issue #6)이지만 검증 대상에는 포함한다.
export const VALID_MODES = [
  "interactive", "full", "version", "workflows",
  "revert", "uninstall", "status", "doctor", "purge",
];
```

- [ ] **Step 4: `parseArgs()`에 검증 추가**

`src/cli/args.js:2`의 import를 수정:

```javascript
// before
import { VALID_TYPES } from "../context.js";

// after
import { VALID_TYPES, VALID_MODES } from "../context.js";
```

`src/cli/args.js`의 `parseArgs()` 끝(`return result;` 직전, 현재 91행 근처)에 추가:

```javascript
  if (!VALID_MODES.includes(result.mode)) {
    throw new CliError(
      `지원하지 않는 모드: '${result.mode}'\n지원 모드: interactive full version workflows revert uninstall status doctor`
    );
  }
  return result;
```

- [ ] **Step 5: 단위 테스트 통과 확인**

Run: `node --test tests/node/mode-validation.test.js`
Expected: 전부 PASS.

- [ ] **Step 6: 부수효과 회귀 테스트 작성 (원격 develop 브랜치가 생기면 안 됨)**

`tests/node/mode-validation.test.js`에 이어서 추가(실제 git으로 origin이 있는 저장소를 구성해 이슈의 수동 재현 절차를 그대로 자동화):

```javascript
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "../../src/index.js";

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function repoWithOriginRemote() {
  const bare = mkdtempSync(join(tmpdir(), "paw-bare-"));
  git(bare, ["init", "--bare", "-q"]);

  const target = mkdtempSync(join(tmpdir(), "paw-target-"));
  git(target, ["init", "-q", "-b", "main"]);
  git(target, ["config", "user.email", "test@example.com"]);
  git(target, ["config", "user.name", "Test"]);
  writeFileSync(join(target, "README.md"), "# test\n");
  git(target, ["add", "."]);
  git(target, ["commit", "-q", "-m", "init"]);
  git(target, ["remote", "add", "origin", bare]);
  git(target, ["push", "-q", "-u", "origin", "main"]);

  return { bare, target };
}

test("run(): 잘못된 --mode 값은 exit 1이며 원격 develop 브랜치를 생성/push하지 않는다", async () => {
  const { bare, target } = repoWithOriginRemote();
  try {
    const code = await run(["--mode", "ful", "--force", "--type", "node"], { cwd: target });
    assert.strictEqual(code, 1);
    assert.ok(!git(bare, ["branch"]).includes("develop"), "원격(bare repo)에 develop 브랜치가 생기면 안 됩니다");
    assert.ok(!git(target, ["branch"]).includes("develop"), "로컬에도 develop 브랜치가 생기면 안 됩니다");
  } finally {
    rmSync(bare, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 7: 테스트 실패 확인(수정 전 동작 재현)**

Run: `node --test tests/node/mode-validation.test.js`
Expected: 이 테스트만 FAIL — 현재 코드는 `switch`의 `default` 분기에 닿기 전에 이미 `ensureDevelopBranch()`를 호출해 실제로 `develop` 브랜치를 만들고 push하므로 두 `assert.ok`가 실패한다.

> Step 3~4를 이미 적용했다면 이 테스트는 이미 PASS일 수 있다 — 그 경우 이 스텝은 "테스트가 이미 통과함을 확인"으로 대체하고 다음 스텝으로 진행한다.

- [ ] **Step 8: 전체 테스트 통과 확인**

Run: `node --test tests/node/mode-validation.test.js`
Expected: 전부 PASS(Step 3~4의 구현으로 `parseArgs`가 `run()` 최상단에서 즉시 throw하므로 브랜치 부수효과 자체가 발생하지 않는다).

- [ ] **Step 9: 커밋**

```bash
git add src/context.js src/cli/args.js tests/node/mode-validation.test.js
git commit -m "$(cat <<'EOF'
fix: 알 수 없는 --mode 값을 부수효과 이전에 즉시 거부하도록 검증 추가

잘못된 --mode 값(오타 등)이 검증 없이 통과돼 원격 develop 브랜치가
생성·push되는 부수효과가 발생하던 문제를 해결한다.
EOF
)"
```

---

### Task 2: `--force` 없는 명시 모드의 TTY 우회 제거

**Files:**
- Modify: `src/index.js:94~109`(revert 게이트), `src/index.js:223~228`(메인 게이트), `src/index.js:267~269`(`force` 하드코딩 정정)
- Test: `tests/node/mode-force-gate.test.js` (신규)

**Interfaces:**
- Consumes: 없음(Task 1과 독립 — 파일은 겹치지만 수정 위치가 다름).
- Produces: `run()`이 이제 `--force`/`--dry-run` 없이는 TTY 여부와 무관하게 `full`/`version`/`workflows`/`revert` 모드를 거부한다는 계약. Task 5가 이 계약을 전제로 통합 테스트를 작성한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/mode-force-gate.test.js` 신규 생성:

```javascript
// tests/node/mode-force-gate.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "../../src/index.js";

function withStubbedTTY(value, fn) {
  const original = process.stdout.isTTY;
  process.stdout.isTTY = value;
  return Promise.resolve(fn()).finally(() => { process.stdout.isTTY = original; });
}

test("run(): TTY 환경에서 --force 없이 full 모드를 실행하면 즉시 거부되고 아무 파일도 쓰지 않는다", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-tty-full-"));
  try {
    const code = await withStubbedTTY(true, () => run(["--mode", "full", "--type", "node"], { cwd: target }));
    assert.strictEqual(code, 1);
    assert.ok(!existsSync(join(target, "version.yml")), "TTY라도 --force 없이는 파일을 쓰면 안 됩니다");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): TTY 환경에서 --force 없이 revert 모드를 실행하면 즉시 거부된다", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-tty-revert-"));
  try {
    const code = await withStubbedTTY(true, () => run(["--mode", "revert"], { cwd: target }));
    assert.strictEqual(code, 1);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): TTY 환경이라도 --force가 있으면 full 모드가 정상 진행된다", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-tty-full-force-"));
  try {
    const code = await withStubbedTTY(true, () => run(["--mode", "full", "--force", "--type", "node"], { cwd: target }));
    assert.strictEqual(code, 0);
    assert.ok(existsSync(join(target, "version.yml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): 비TTY 환경에서 --force 없이 full 모드를 실행하면 여전히 거부된다 (기존 동작 회귀 방지)", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-non-tty-full-"));
  try {
    const code = await withStubbedTTY(false, () => run(["--mode", "full", "--type", "node"], { cwd: target }));
    assert.strictEqual(code, 1);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test tests/node/mode-force-gate.test.js`
Expected: 처음 2개 테스트(TTY + `--force` 없음 → 거부되어야 함) FAIL — 현재 코드는 TTY면 게이트를 통과시켜 그대로 설치를 진행하므로 `code`가 `0`이 되거나 파일이 실제로 쓰여진다. 나머지 2개는 이미 PASS.

- [ ] **Step 3: revert 게이트 수정**

`src/index.js`의 다음 블록(94~109행 근처):

```javascript
  // revert 모드 — payload 유래 파일 제거 (감지·질문 불필요, --force 게이트만)
  if (opts.mode === "revert") {
    // --dry-run은 파일을 쓰지 않으므로 --force 게이트를 우회한다 (status/doctor와 동일한 안전성).
    if (!opts.force && !opts.dryRun && !process.stdout.isTTY) {
      console.error("비대화형 환경에서는 --force 옵션이 필요합니다.");
      return 1;
    }
```

다음으로 교체:

```javascript
  // revert 모드 — payload 유래 파일 제거 (감지·질문 불필요, --force 게이트만)
  if (opts.mode === "revert") {
    // TTY 여부와 무관하게 --force가 없으면 거부한다 (issue #19 — TTY에서 확인 없이 즉시 실행되던 결함 수정).
    // --dry-run은 파일을 쓰지 않으므로 --force 게이트를 우회한다 (status/doctor와 동일한 안전성).
    if (!opts.force && !opts.dryRun) {
      console.error("revert 모드는 --force 없이 실행할 수 없습니다 (확인 절차가 없습니다).");
      return 1;
    }
```

(이후 `if (opts.dryRun) { ... }`부터는 변경 없음.)

- [ ] **Step 4: 메인 게이트 수정**

`src/index.js`의 다음 블록(223~228행 근처):

```javascript
  // 명시 모드인데 --force 없으면 (비대화형 CLI는 --force 필요)
  // --dry-run은 파일을 쓰지 않으므로 --force 게이트를 우회한다 (status/doctor와 동일한 안전성).
  if (!opts.force && !opts.dryRun && !process.stdout.isTTY) {
    console.error("비대화형 환경에서는 --force 옵션이 필요합니다.");
    return 1;
  }
```

다음으로 교체:

```javascript
  // 명시 모드(full/version/workflows)인데 --force 없으면 TTY 여부와 무관하게 즉시 거부한다
  // (issue #19 — TTY에서 확인 없이 즉시 설치되던 결함 수정).
  // --dry-run은 파일을 쓰지 않으므로 --force 게이트를 우회한다 (status/doctor와 동일한 안전성).
  if (!opts.force && !opts.dryRun) {
    console.error("--force 없이는 이 모드를 실행할 수 없습니다 (확인 절차가 없습니다).");
    return 1;
  }
```

- [ ] **Step 5: `force` 하드코딩 정정**

`src/index.js`의 `createContext(...)` 호출(267~269행 근처):

```javascript
  const context = createContext({
    mode: opts.mode, force: true, types, version, versionCode, branch,
```

다음으로 교체:

```javascript
  const context = createContext({
    mode: opts.mode, force: opts.force, types, version, versionCode, branch,
```

(참고: `context.force`는 현재 `runFull`/`runVersion`/`copyWorkflows` 어디에서도 읽히지 않으므로 이 변경은 동작에 영향을 주지 않는다 — 의미상 정확성만 정정한다.)

- [ ] **Step 6: 테스트 통과 확인**

Run: `node --test tests/node/mode-force-gate.test.js`
Expected: 전부 PASS.

- [ ] **Step 7: 회귀 확인 — 기존 전체 테스트 스위트**

Run: `node --test "tests/node/**/*.test.js"`
Expected: 전부 PASS(특히 `tests/node/dry-run-cli.test.js`의 `--dry-run --mode revert` 케이스가 계속 통과해야 한다 — dry-run은 이번 변경으로 게이트를 우회하는 경로가 그대로 유지된다).

- [ ] **Step 8: 커밋**

```bash
git add src/index.js tests/node/mode-force-gate.test.js
git commit -m "$(cat <<'EOF'
fix: TTY 환경에서도 --force 없이는 명시 모드를 실행할 수 없도록 수정

TTY일 때 확인 절차 없이 즉시 설치가 진행되던 revert/full/version/workflows
게이트를 --force 상시 필수로 통일한다. context.force 하드코딩도 함께 정정.
EOF
)"
```

---

### Task 3: `copyWorkflows()`가 실제로 쓴 파일명 목록을 반환

**Files:**
- Modify: `src/core/copy/workflows.js`
- Test: `tests/node/workflows-copied-files.test.js` (신규)

**Interfaces:**
- Consumes: 없음(Task 1·2와 독립).
- Produces: `copyWorkflows(context, payloadRoot, targetRoot, hooks)`의 반환 객체에 `copiedFiles: string[]`이 추가된다 — 이번 호출에서 실제로 새로 쓰여진(신규 작성/backup 교체/template 추가/nexus·secret-backup opt-in) 워크플로우 파일명 전부, `unchanged`/`skip` 파일은 제외. `template` 결정은 `counters.copied`를 증가시키지 않고 `counters.templateAdded`만 증가시키면서도 `copiedFiles`에는 새 파일명을 push하므로, `copiedFiles.length === counters.copied`는 **template 결정이 없을 때만** 성립한다(fable 검토 반영). Task 5가 `result.workflows.copiedFiles`로 이 값을 그대로 소비한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/workflows-copied-files.test.js` 신규 생성:

```javascript
// tests/node/workflows-copied-files.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { copyWorkflows } from "../../src/core/copy/workflows.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";

const PAYLOAD = resolvePayloadRoot();

function freshTarget(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function ctxFor(types) {
  return createContext({
    mode: "full", force: true, types, version: "1.0.0",
    branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(),
  });
}

test("copyWorkflows: 최초 설치에서 copiedFiles는 실제 복사된 모든 파일명을 담고, 개수는 copied와 일치한다", () => {
  const target = freshTarget("paw-copied-files-init-");
  try {
    const result = copyWorkflows(ctxFor(["node"]), PAYLOAD, target);
    assert.ok(Array.isArray(result.copiedFiles));
    assert.strictEqual(result.copiedFiles.length, result.copied);
    assert.ok(result.copiedFiles.includes("PROJECT-COMMON-RELEASE-PUBLISH.yaml"));
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("copyWorkflows: 재실행 시 unchanged(skip)된 파일은 copiedFiles에 없다", () => {
  const target = freshTarget("paw-copied-files-rerun-");
  try {
    const ctx = ctxFor(["node"]);
    copyWorkflows(ctx, PAYLOAD, target); // 최초 설치
    const second = copyWorkflows(ctx, PAYLOAD, target); // 동일 조건 재실행 -> 전부 unchanged
    assert.strictEqual(second.copiedFiles.length, 0);
    assert.strictEqual(second.copied, 0);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("copyWorkflows: backup 결정은 원본 파일명을, template 결정은 .template.yaml 파일명을 copiedFiles에 담는다", () => {
  const target = freshTarget("paw-copied-files-decision-");
  try {
    const ctx = ctxFor(["spring"]);
    copyWorkflows(ctx, PAYLOAD, target); // 최초 설치 (server-deploy 포함 spring 전용 파일 생성)

    const targetFile = join(target, ".github", "workflows", "PROJECT-SPRING-GITHUB-PACKAGES-PUBLISH.yml");
    writeFileSync(targetFile, "changed-content-that-differs-from-template\n");
    const backupResult = copyWorkflows(ctx, PAYLOAD, target, {
      decisions: new Map([["PROJECT-SPRING-GITHUB-PACKAGES-PUBLISH.yml", "backup"]]),
    });
    assert.ok(backupResult.copiedFiles.includes("PROJECT-SPRING-GITHUB-PACKAGES-PUBLISH.yml"));

    writeFileSync(targetFile, "changed-again\n");
    const templateResult = copyWorkflows(ctx, PAYLOAD, target, {
      decisions: new Map([["PROJECT-SPRING-GITHUB-PACKAGES-PUBLISH.yml", "template"]]),
    });
    // applyDecision()의 template 파일명 규칙: .yaml만 strip, .yml은 그대로 뒤에 .template.yaml이 붙는다(레거시 .sh 동일 동작).
    assert.ok(templateResult.copiedFiles.includes("PROJECT-SPRING-GITHUB-PACKAGES-PUBLISH.yml.template.yaml"));
    assert.ok(!templateResult.copiedFiles.includes("PROJECT-SPRING-GITHUB-PACKAGES-PUBLISH.yml"));
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("copyWorkflows: secret-backup opt-in 파일도 copiedFiles에 담긴다", () => {
  const target = freshTarget("paw-copied-files-secret-");
  try {
    const ctx = createContext({
      mode: "full", force: true, types: ["node"], version: "1.0.0",
      branches: { main: "main", develop: "develop", mode: "pr-flow" },
      paths: new Map(), includeSecretBackup: true,
    });
    const result = copyWorkflows(ctx, PAYLOAD, target);
    assert.ok(result.copiedFiles.includes("PROJECT-COMMON-SECRET-FILE-UPLOAD.yaml"));
  } finally { rmSync(target, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test tests/node/workflows-copied-files.test.js`
Expected: 전부 FAIL(`result.copiedFiles`가 `undefined`이므로 `Array.isArray`/`.includes` 단계에서 실패) — `copyWorkflows()`가 아직 `copiedFiles`를 반환하지 않는다.

- [ ] **Step 3: `copyWorkflows()` 본체에 `copiedFiles` 배열 추가**

`src/core/copy/workflows.js`의 `copyWorkflows()` 함수(현재 62~115행 근처) 시작부:

```javascript
  const counters = { copied: 0, skipped: 0, templateAdded: 0, optionalCopied: 0, backupAdded: 0 };
  const deployValues = new Map(); // Map<type, Map<key,value>> — deploy 블록용 ask 값
  counters.deployValues = deployValues;
```

다음으로 교체(한 줄 추가):

```javascript
  const counters = { copied: 0, skipped: 0, templateAdded: 0, optionalCopied: 0, backupAdded: 0 };
  const deployValues = new Map(); // Map<type, Map<key,value>> — deploy 블록용 ask 값
  counters.deployValues = deployValues;
  counters.copiedFiles = []; // 이번 실행에서 실제로 새로 쓰여진 파일명 (issue #19 — printSummary 정확성용)
```

- [ ] **Step 4: common 루프에서 파일명 push**

같은 함수 안, common 루프(현재 80~93행 근처):

```javascript
      const body = srcText(src);
      if (existsSync(dst) && isUnchanged(body, readFileSync(dst, "utf8"), envOptsFor("common"))) {
        counters.skipped++;
        continue;
      }
      writeText(dst, body);
      counters.copied++;
```

다음으로 교체:

```javascript
      const body = srcText(src);
      if (existsSync(dst) && isUnchanged(body, readFileSync(dst, "utf8"), envOptsFor("common"))) {
        counters.skipped++;
        continue;
      }
      writeText(dst, body);
      counters.copied++;
      counters.copiedFiles.push(filename);
```

- [ ] **Step 5: secret-backup 루프에서 파일명 push**

같은 함수 안, secret-backup 루프(현재 104~112행 근처):

```javascript
      if (existsSync(dst)) continue; // 이미 존재하면 스킵
      writeText(dst, srcText(join(secretDir, filename)));
      counters.optionalCopied++;
      counters.copied++;
```

다음으로 교체:

```javascript
      if (existsSync(dst)) continue; // 이미 존재하면 스킵
      writeText(dst, srcText(join(secretDir, filename)));
      counters.optionalCopied++;
      counters.copied++;
      counters.copiedFiles.push(filename);
```

- [ ] **Step 6: `applyDecision()`에서 backup/template 파일명 push**

`applyDecision()` 함수(현재 119~138행 근처) 전체:

```javascript
function applyDecision(decision, srcDir, workflowsDir, filename, counters, srcText) {
  const src = join(srcDir, filename);
  const dst = join(workflowsDir, filename);
  if (decision === "backup") {
    // .sh O) mv → cp: 기존을 .bak으로 백업 후 새 버전으로 교체
    renameSync(dst, dst + ".bak");
    writeText(dst, srcText(src));
    counters.copied++;
    counters.backupAdded++;
    return;
  }
  if (decision === "template") {
    // .sh T) `${filename%.yaml}.template.yaml` — .yaml만 strip (.yml은 그대로 뒤에 붙음, .sh 동일)
    const templateName = (filename.endsWith(".yaml") ? filename.slice(0, -".yaml".length) : filename) + ".template.yaml";
    writeText(join(workflowsDir, templateName), srcText(src)); // 기존 .template.yaml 덮어씀(.sh rm -f + cp 등가)
    counters.templateAdded++;
    return;
  }
  counters.skipped++; // 'skip'/미지정/ESC → 기존 유지 (.sh S)·force 기본)
}
```

다음으로 교체:

```javascript
function applyDecision(decision, srcDir, workflowsDir, filename, counters, srcText) {
  const src = join(srcDir, filename);
  const dst = join(workflowsDir, filename);
  if (decision === "backup") {
    // .sh O) mv → cp: 기존을 .bak으로 백업 후 새 버전으로 교체
    renameSync(dst, dst + ".bak");
    writeText(dst, srcText(src));
    counters.copied++;
    counters.backupAdded++;
    counters.copiedFiles.push(filename);
    return;
  }
  if (decision === "template") {
    // .sh T) `${filename%.yaml}.template.yaml` — .yaml만 strip (.yml은 그대로 뒤에 붙음, .sh 동일)
    const templateName = (filename.endsWith(".yaml") ? filename.slice(0, -".yaml".length) : filename) + ".template.yaml";
    writeText(join(workflowsDir, templateName), srcText(src)); // 기존 .template.yaml 덮어씀(.sh rm -f + cp 등가)
    counters.templateAdded++;
    counters.copiedFiles.push(templateName);
    return;
  }
  counters.skipped++; // 'skip'/미지정/ESC → 기존 유지 (.sh S)·force 기본)
}
```

- [ ] **Step 7: `copyWorkflowsForType()`의 신규 파일 루프(타입 직하위·server-deploy·nexus)에서 파일명 push**

`copyWorkflowsForType()` 함수(현재 177~234행 근처) 안의 세 지점을 각각 수정한다.

타입 직하위(현재):
```javascript
    for (const f of newFiles) { writeText(join(workflowsDir, f), srcText(join(typeDir, f))); counters.copied++; }
```
교체:
```javascript
    for (const f of newFiles) {
      writeText(join(workflowsDir, f), srcText(join(typeDir, f)));
      counters.copied++;
      counters.copiedFiles.push(f);
    }
```

server-deploy(현재):
```javascript
      for (const f of newFiles) { writeText(join(workflowsDir, f), srcText(join(serverDeployDir, f))); counters.copied++; }
```
교체:
```javascript
      for (const f of newFiles) {
        writeText(join(workflowsDir, f), srcText(join(serverDeployDir, f)));
        counters.copied++;
        counters.copiedFiles.push(f);
      }
```

nexus opt-in(현재):
```javascript
      if (existsSync(dst)) { renameSync(dst, dst + ".bak"); counters.backupAdded++; }
      writeText(dst, body);
      counters.optionalCopied++;
      counters.copied++;
```
교체:
```javascript
      if (existsSync(dst)) { renameSync(dst, dst + ".bak"); counters.backupAdded++; }
      writeText(dst, body);
      counters.optionalCopied++;
      counters.copied++;
      counters.copiedFiles.push(filename);
```

- [ ] **Step 8: 테스트 통과 확인**

Run: `node --test tests/node/workflows-copied-files.test.js`
Expected: 전부 PASS.

- [ ] **Step 9: 회귀 확인**

Run: `node --test "tests/node/**/*.test.js"`
Expected: 전부 PASS(특히 `tests/node/install-matrix.test.js`처럼 `copyWorkflows()`를 직접 호출하는 기존 테스트들이 `copiedFiles` 필드 추가로 깨지지 않아야 한다).

- [ ] **Step 10: 커밋**

```bash
git add src/core/copy/workflows.js tests/node/workflows-copied-files.test.js
git commit -m "$(cat <<'EOF'
feat: copyWorkflows()가 실제로 새로 쓴 파일명 목록(copiedFiles)을 반환

printSummary()가 디렉터리 재스캔 대신 실제 복사 결과를 그대로 표시할 수
있도록, 신규/backup/template/nexus/secret-backup으로 쓰여진 파일명을
counters.copiedFiles로 수집한다.
EOF
)"
```

---

### Task 4: `printSummary()`가 `copiedFiles`를 직접 렌더링하도록 리팩터링

**Files:**
- Modify: `src/ui/summary.js`
- Test: `tests/node/summary-output.test.js` (기존 파일에 추가)

**Interfaces:**
- Consumes: `copiedFiles: string[]`(Task 3에서 정의된 필드명과 동일해야 함 — 필드명이 다르면 Task 5의 배선이 조용히 깨진다).
- Produces: `printSummary(ctx)` — **2번째 인자(`targetRoot`) 제거**. `ctx`는 이제 `{ mode, types, version, copiedFiles, branches?, gitignoreUpdated? }` 형태(기존 `counters` 필드는 더 이상 쓰지 않는다). Task 5가 이 새 시그니처로 두 호출부(`src/index.js`, `src/commands/interactive.js`)를 배선한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/summary-output.test.js`에 이어서 추가(기존 3개 테스트는 그대로 둔다):

```javascript
test("printSummary: copiedFiles를 common/타입별로 분류해서 목록과 정확한 개수를 렌더링한다", () => {
  const output = captureStderr(() => {
    printSummary({
      mode: "full", types: ["spring"], version: "1.0.0",
      copiedFiles: ["PROJECT-COMMON-RELEASE-PUBLISH.yaml", "PROJECT-SPRING-GITHUB-PACKAGES-PUBLISH.yml"],
    });
  });
  assert.ok(output.includes("📦 새로 설치됨 (2개):"));
  assert.ok(output.includes("PROJECT-COMMON-RELEASE-PUBLISH.yaml"));
  assert.ok(output.includes("PROJECT-SPRING-GITHUB-PACKAGES-PUBLISH.yml"));
});

test("printSummary: copiedFiles가 비어 있으면(전부 skip) '새로 설치됨' 줄 자체를 출력하지 않는다", () => {
  const output = captureStderr(() => {
    printSummary({ mode: "full", types: ["spring"], version: "1.0.0", copiedFiles: [] });
  });
  assert.ok(!output.includes("📦 새로 설치됨"));
});

test("printSummary: copiedFiles 미지정 시에도 예외 없이 동작한다(기본값 빈 배열)", () => {
  const output = captureStderr(() => {
    printSummary({ mode: "version", types: ["basic"], version: "1.0.0" });
  });
  assert.ok(!output.includes("📦 새로 설치됨"));
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test tests/node/summary-output.test.js`
Expected: 새로 추가한 3개 중 첫 번째("...정확한 개수를 렌더링...")는 FAIL — 현재 구현은 `copiedFiles`를 무시하고 `targetRoot`(기본 `"."`) 아래 `.github/workflows/`를 재스캔하므로, 테스트 프로세스의 실제 작업 디렉터리 상태에 따라 다르게(대개 빈 목록으로) 렌더링된다. 나머지 2개는 이미 우연히 PASS일 수 있다.

- [ ] **Step 3: `printSummary()` 리팩터링**

`src/ui/summary.js` 전체 교체:

```javascript
// 완료 요약 출력 (.sh print_summary 등가). 전부 stderr.
// ctx: { mode, types:[], version, copiedFiles:[], branches?, gitignoreUpdated? }
import { WORKFLOW_PREFIX, WORKFLOW_COMMON_PREFIX } from "../core/paths.js";

const SEPARATOR = "────────────────────────────────────────";

export function printSummary(ctx) {
  const { mode, types = [], version = "", copiedFiles = [], branches = null, gitignoreUpdated = false } = ctx || {};
  const err = (s = "") => process.stderr.write(`${s}\n`);
  // 색상은 TTY일 때만 (.sh YELLOW/CYAN/NC 등가)
  const isTty = !!process.stderr.isTTY;
  const YELLOW = isTty ? "\x1b[1;33m" : "";
  const CYAN = isTty ? "\x1b[0;36m" : "";
  const NC = isTty ? "\x1b[0m" : "";

  err("");
  err(SEPARATOR);
  err("");
  err("✨ project-auto-wizard Setup Complete!");
  err("");
  err(SEPARATOR);
  err("");
  err("통합된 기능:");

  // 모드별 체크리스트
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

  // 브랜치 모드 + 릴리스 요약 엔진 안내 (DESIGN-SPEC §4~5)
  if (branches) {
    err("");
    err("브랜치 구성:");
    if (branches.mode === "trunk-based") {
      err(`  🌿 ${branches.main} 단일 브랜치 (trunk-based) — RELEASE-PUBLISH 하나가 버전확정→체인지로그→tag→Release를 순차 처리`);
    } else {
      err(`  🌿 개발 ${branches.develop} → 릴리스 ${branches.main} (pr-flow) — 릴리스 PR에서 버전확정·AI 체인지로그·automerge`);
    }
  }
  if (mode === "full" || mode === "workflows") {
    err("");
    err("릴리스 노트 요약 엔진:");
    err("  🤖 AI_API_KEY(선택) → GitHub Models(기본·무료·API 키 불필요) → 규칙 fallback — 릴리스는 절대 막히지 않음");
  }

  err("");
  err("추가된 파일:");
  err(`  📄 version.yml (버전: ${version}, 타입: ${types.join(",")})`);
  err("  📝 README.md (버전 섹션 추가)");
  err("");
  err("추가된 워크플로우:");

  // 실제로 이번 실행에서 복사된 파일만 분류한다 (copyWorkflows()가 반환한 copiedFiles —
  // 디렉터리 재스캔은 재실행 시 skip된 파일까지 "새로 설치됨"으로 보여주는 결함이 있었다, issue #19).
  const commonWorkflows = [];
  const typeWorkflows = [];
  const typePrefixes = types.map((t) => `${WORKFLOW_PREFIX}-${t.toUpperCase()}-`);
  for (const filename of copiedFiles) {
    if (!filename.startsWith(`${WORKFLOW_PREFIX}-`)) continue; // PROJECT-*만
    if (filename.startsWith(`${WORKFLOW_COMMON_PREFIX}-`)) {
      commonWorkflows.push(filename);
    } else if (typePrefixes.some((p) => filename.startsWith(p))) {
      typeWorkflows.push(filename);
    }
  }

  if (commonWorkflows.length > 0 || typeWorkflows.length > 0) {
    err(`  📦 새로 설치됨 (${copiedFiles.length}개):`);
    for (const wf of commonWorkflows) err(`     📌 ${wf}`);
    for (const wf of typeWorkflows) err(`     🎯 ${wf}`);
  }

  err("");
  err("  🔧 .github/scripts/");
  err("     ├─ version_manager.py");
  err("     └─ changelog_manager.py");
  err("");

  // 프로젝트 타입별 안내
  if (types.includes("spring")) {
    err("  💡 Spring 프로젝트 추가 설정:");
    err("     • build.gradle의 버전 정보가 자동 동기화됩니다");
    err("     • CI/CD 워크플로우에서 GitHub Secrets 설정이 필요합니다");
    err("");
  }

  err("  📖 REPO: https://github.com/Twin-Fang/project-auto-wizard");
  err("");

  // 필수 작업 안내
  err(SEPARATOR);
  err("");
  err(`${YELLOW}⚠️  다음 작업을 확인해주세요:${NC}`);
  err("");
  err("  1️⃣  릴리스 automerge용 PAT (선택 — 없으면 GITHUB_TOKEN 사용)");
  err("     → Repository Settings > Secrets > Actions");
  err("     → Secret Name: WORKFLOW_PAT (Scopes: repo, workflow)");
  err("     → GITHUB_TOKEN 머지는 후속 워크플로우를 트리거하지 않습니다");
  err("");
  err("  2️⃣  GitHub Actions 권한 확인");
  err("     → Settings > Actions > Workflow permissions: Read and write");
  err("");
  err(SEPARATOR);
  err("");
  err(`${CYAN}📖 워크플로우 구성과 릴리스 흐름은 README를 참고하세요.${NC}`);
  err("");
}
```

(변경 요약: `targetRoot` 파라미터·`existsSync`/`join`/`PATHS`/`listYamlFiles` import·디렉터리 재스캔 블록·`workflowsCopied` 변수를 전부 제거하고, `copiedFiles` 배열을 직접 분류해 렌더링한다.)

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/node/summary-output.test.js`
Expected: 전부 PASS(기존 3개 + 신규 3개).

- [ ] **Step 5: 커밋**

```bash
git add src/ui/summary.js tests/node/summary-output.test.js
git commit -m "$(cat <<'EOF'
fix: printSummary가 디렉터리 재스캔 대신 실제 복사 결과를 표시하도록 수정

재실행 시 skip된 파일까지 "새로 설치됨"으로 표시되고 카운터-목록 개수가
어긋나던 문제를 copiedFiles 기반 렌더링으로 해결한다. printSummary는 이제
targetRoot 인자를 받지 않는다(호출부 배선은 다음 태스크에서 진행).
EOF
)"
```

---

### Task 5: 호출부 배선 — `index.js`/`interactive.js`/`prompts.js` 통합

**Files:**
- Modify: `src/index.js:296~314`(switch + `printSummary` 호출부)
- Modify: `src/commands/interactive.js:235~245`(`io.summary` 호출부)
- Modify: `src/ui/prompts.js:92`(`summary()` 래퍼)
- Test: `tests/node/summary-accuracy-cli.test.js` (신규)

**Interfaces:**
- Consumes: Task 1의 모드 검증 보장(`opts.mode`는 이 지점에서 항상 유효), Task 3의 `result.workflows.copiedFiles: string[]`, Task 4의 `printSummary(ctx)` 새 시그니처.
- Produces: `run()`이 반환하는 완료 요약이 실제 설치 결과와 항상 일치한다는 최종 계약. 이후 태스크 없음(마지막 태스크).

- [ ] **Step 1: 실패하는 통합 테스트 작성**

`tests/node/summary-accuracy-cli.test.js` 신규 생성:

```javascript
// tests/node/summary-accuracy-cli.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "../../src/index.js";

function captureStderr(fn) {
  const original = process.stderr.write.bind(process.stderr);
  let output = "";
  process.stderr.write = (chunk) => { output += chunk; return true; };
  return Promise.resolve(fn()).finally(() => { process.stderr.write = original; }).then(() => output);
}

test("run(): full 모드 완료 요약의 '새로 설치됨' 목록이 실제 생성된 워크플로우 파일과 정확히 일치한다", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-summary-accuracy-"));
  try {
    let code;
    const output = await captureStderr(async () => {
      code = await run(["--mode", "full", "--force", "--type", "spring"], { cwd: target });
    });
    assert.strictEqual(code, 0);
    const wfDir = join(target, ".github", "workflows");
    const actualFiles = readdirSync(wfDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    assert.ok(actualFiles.length > 0, "테스트 전제가 깨졌습니다 — 워크플로우가 하나도 안 만들어짐");
    for (const f of actualFiles) {
      assert.ok(output.includes(f), `실제로 생성된 ${f}가 완료 요약에 없습니다`);
    }
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): 동일 옵션으로 재실행하면(전부 unchanged) '새로 설치됨' 목록이 아예 뜨지 않는다", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-summary-rerun-"));
  try {
    await run(["--mode", "full", "--force", "--type", "spring"], { cwd: target }); // 최초 설치
    const output = await captureStderr(async () => {
      const code = await run(["--mode", "full", "--force", "--type", "spring"], { cwd: target }); // 재실행
      assert.strictEqual(code, 0);
    });
    assert.ok(!output.includes("📦 새로 설치됨"), "재실행에서 unchanged 파일들이 '새로 설치됨'으로 표시되면 안 됩니다");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test tests/node/summary-accuracy-cli.test.js`
Expected: 첫 번째 테스트 FAIL — `src/index.js`가 아직 `printSummary`에 `counters: { workflows: result?.workflows?.copied ?? 0 }`(개수만)를 전달하고 있어 실제 파일명이 요약에 등장하지 않는다. 두 번째 테스트는 이미 우연히 PASS일 수 있다(재스캔 로직이 대상 디렉터리에 파일이 있으면 항상 목록을 보여주므로 실제로는 이 케이스도 FAIL 가능성이 높다).

- [ ] **Step 3: `src/index.js`의 switch·`printSummary` 호출부 수정**

현재(296~314행 근처):

```javascript
  let result = null;
  switch (opts.mode) {
    case "full": result = runFull(context, payload, cwd); break;
    case "version": result = runVersion(context, payload, cwd); break;
    case "workflows": result = runWorkflows(context, payload, cwd); break;
    default:
      // 알 수 없는 모드 → .sh와 동일하게 복사 0건, 에러 아님
      break;
  }

  // 완료 요약 (.sh print_summary — CLI 모드에서도 출력)
  printSummary({
    mode: opts.mode, types, version, branches,
    counters: { workflows: result?.workflows?.copied ?? 0 },
    gitignoreUpdated: result?.gitignoreUpdated === true,
  }, cwd);
  return 0;
```

다음으로 교체:

```javascript
  // opts.mode는 parseArgs()에서 화이트리스트 검증을 통과했고, interactive/revert/purge/uninstall/status/doctor는
  // 전부 위에서 조기 반환했으므로 이 시점엔 full/version/workflows 중 하나로 보장된다(issue #19 — default 분기 제거).
  let result = null;
  switch (opts.mode) {
    case "full": result = runFull(context, payload, cwd); break;
    case "version": result = runVersion(context, payload, cwd); break;
    case "workflows": result = runWorkflows(context, payload, cwd); break;
  }

  // 완료 요약 (.sh print_summary — CLI 모드에서도 출력)
  printSummary({
    mode: opts.mode, types, version, branches,
    copiedFiles: result?.workflows?.copiedFiles ?? [],
    gitignoreUpdated: result?.gitignoreUpdated === true,
  });
  return 0;
```

- [ ] **Step 4: `src/commands/interactive.js`의 `io.summary` 호출부 수정**

현재(235~245행 근처):

```javascript
  let result = null;
  if (mode === "full") result = runFull(ctx, payload, cwd, hooks);
  else if (mode === "version") result = runVersion(ctx, payload, cwd);
  else if (mode === "workflows") result = runWorkflows(ctx, payload, cwd, hooks);

  // 완료 요약 (.sh print_summary L5438)
  io.summary?.({
    mode, types, version, branches,
    counters: { workflows: result?.workflows?.copied ?? 0 },
    gitignoreUpdated: result?.gitignoreUpdated === true,
  }, cwd);
  io.outro?.(`통합 완료 — ${mode} 모드로 설치했습니다.`);
  return 0;
```

다음으로 교체:

```javascript
  let result = null;
  if (mode === "full") result = runFull(ctx, payload, cwd, hooks);
  else if (mode === "version") result = runVersion(ctx, payload, cwd);
  else if (mode === "workflows") result = runWorkflows(ctx, payload, cwd, hooks);

  // 완료 요약 (.sh print_summary L5438)
  io.summary?.({
    mode, types, version, branches,
    copiedFiles: result?.workflows?.copiedFiles ?? [],
    gitignoreUpdated: result?.gitignoreUpdated === true,
  });
  io.outro?.(`통합 완료 — ${mode} 모드로 설치했습니다.`);
  return 0;
```

- [ ] **Step 5: `src/ui/prompts.js`의 `summary()` 래퍼 정리**

현재(92행):

```javascript
export function summary(ctx, targetRoot) { _summary(ctx, targetRoot); }
```

다음으로 교체:

```javascript
export function summary(ctx) { _summary(ctx); }
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `node --test tests/node/summary-accuracy-cli.test.js`
Expected: 전부 PASS.

- [ ] **Step 7: 전체 회귀 테스트**

Run: `node --test "tests/node/**/*.test.js"`
Expected: 전부 PASS. 실패하는 테스트가 있다면 어떤 호출부가 옛 `counters`/`targetRoot` 시그니처를 아직 쓰고 있는지 `grep -rn "printSummary\|io.summary" src/`로 다시 확인한다.

- [ ] **Step 8: 커밋**

```bash
git add src/index.js src/commands/interactive.js src/ui/prompts.js tests/node/summary-accuracy-cli.test.js
git commit -m "$(cat <<'EOF'
fix: 완료 요약의 새 copiedFiles 시그니처를 모든 호출부에 배선

src/index.js·src/commands/interactive.js·src/ui/prompts.js를 printSummary()의
새 시그니처(copiedFiles, targetRoot 인자 제거)에 맞춰 동기화하고,
검증된 --mode에서는 도달 불가능해진 switch default 분기를 제거한다.
EOF
)"
```

---

## 최종 검증

모든 태스크 완료 후:

- [ ] `node --test "tests/node/**/*.test.js"` 전체 통과
- [ ] `npm run test:py` 통과(파이썬 테스트는 이번 변경과 무관하지만 회귀 확인 차원에서 실행)
- [ ] `grep -rn "targetRoot" src/ui/summary.js src/ui/prompts.js`로 남은 참조가 없는지 확인
- [ ] `docs/superpowers/specs/2026-08-04-cli-mode-safety-guards-design.md`의 목표 3가지가 각각 어느 태스크에서 구현됐는지 한 번 더 대조(①→Task1, ②→Task2, ③→Task3+4+5)
