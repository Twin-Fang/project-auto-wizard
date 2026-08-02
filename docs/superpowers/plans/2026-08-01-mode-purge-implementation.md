# `--mode purge` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hidden, dev-only `--mode purge` CLI mode that removes every artifact `project-auto-wizard` creates (everything `--mode revert` removes, plus `version.yml`, the README `AUTO-VERSION-SECTION` block, and `CHANGELOG.json`/`CHANGELOG.md`), gated behind multiple safety checks, so a test repo can be returned to its pre-install state for repeatable local testing.

**Architecture:** `src/commands/purge.js` (new) exposes pure `planPurge()`/`executePurge()` that compose the existing `planRevert()` (read-only reuse, no changes to `revert.js`) with new version.yml/README/CHANGELOG handling. `src/index.js` gets a new `purge` branch (next to the existing `revert` branch) that runs six ordered safety gates before calling into `purge.js`. All git subprocess calls and the TTY confirmation prompt are injectable (`exec`, `promptRepoName`) for deterministic tests, following the existing `branches.js` `exec`-injection convention.

**Tech Stack:** Node.js built-ins only (`node:fs`, `node:path`, `node:child_process`, `node:readline/promises`) — no new dependencies, per `CONTRIBUTING.md`.

## Global Constraints

- `--mode purge` must NOT appear in `HELP_TEXT` (`src/cli/help.js`) or the interactive wizard menu — it is a hidden, CLI-arg-only mode (spec §4).
- `--mode revert`'s existing behavior and exported function signatures (`planRevert`, `runRevert` in `src/commands/revert.js`) must not change — purge only reads from them (spec §2, §6).
- `.gitignore`'s auto-added block is explicitly out of scope for this feature (spec §2).
- Remote git branches are never touched. Only the local `develop` branch may be deleted, only when `--delete-develop-branch` is explicitly passed, only via `git branch -d` (safe delete — never `-D`) (spec §3).
- No external dependencies — Node built-ins only (`CONTRIBUTING.md` code style rule).
- Every commit message must use the issue's helper template verbatim, filling only the description:
  `mode_purge_설치_이전_상태로_완전_회귀하는_숨김_모드 : feat : {변경 사항에 대한 설명} https://github.com/Twin-Fang/project-auto-wizard/issues/6`
- Run tests with `npm run test:node` (`node --test "tests/node/**/*.test.js"`).
- Spec reference: `docs/superpowers/specs/2026-08-01-mode-purge-design.md`.
- purge 전용 플래그(`--yes`, `--allow-dirty`, `--delete-develop-branch`, `--keep-*`)는 전역 파서에 등록되므로 다른 모드(`full`/`version`/`workflows`/`revert`)와 함께 지정해도 파서 에러 없이 조용히 무시된다 — 이는 기존 `--dry-run`과 동일한 전역 플래그 관례를 따른 의도된 트레이드오프이며 별도 검증 로직을 추가하지 않는다 (Fable 검토 M5).

> **2026-08-01 Fable 모델 최종 검토 반영**: 아래 계획은 최초 초안에 대해 Fable 모델로 독립 검토를 받아 HIGH 3건(H1 `.gitignore` 라운드트립 테스트 불가, H2 README 마커 제거가 EOF까지 통째로 잘라내 데이터 손실 위험 + 스펙 위반, H3 `executePurge` 반환값이 실제 삭제 결과를 반영하지 않음)과 MEDIUM 5건(keep-플래그별 실행 레벨 테스트 공백, CHANGELOG 삭제 미검증, `printPurgeResult` 파일명 미표시, dry-run에 develop 브랜치 삭제 예고 누락, purge 전용 플래그의 타 모드 조용 수용 미문서화)을 확인하고 전부 아래 태스크에 직접 반영했다. 특히 H2는 이 저장소의 `payload/workflows/common/PROJECT-COMMON-README-VERSION-UPDATE.yaml`이 "README에 사용자가 이미 버전 라인을 써둔 상태로 마법사를 설치(→ `addVersionSectionToReadme`가 skip) → 이후 릴리스가 한 번 돌면 `---` 프리앰블·CHANGELOG 링크 없이 마커만 그 버전 라인 위에 삽입"하는 실제 경로가 있음을 코드로 직접 확인해 검증됐다.
>
> **2026-08-01 Fable 모델 2차(재검토) 반영**: 위 수정 사항을 Fable 모델로 다시 독립 재검토받아 H1/H2/H3·M1~M5가 전부 올바르게 반영됐음을 확인했다(회귀 없음). 재검토에서 신규 MEDIUM 2건이 추가로 나와 반영했다: **M-N1** — `removeVersionSectionFromReadme`가 쓰던 `VERSION_LINE_RE`(최신 버전|Version|버전만 인식)가 릴리스 워크플로우가 버전 라인이 아예 없던 README에 직접 삽입하는 `## Latest Version : vX.Y.Z` 헤더를 인식하지 못해, 마커만 지우고 버전 라인을 남긴 채로도 `"removed"`를 거짓 반환하는 문제(워크플로우의 7종 패턴과 정렬한 별도의 넓은 정규식으로 해결, `addVersionSectionToReadme`의 기존 skip 판정용 정규식은 그대로 둠). **M-N2** — `.coderabbit.yaml` 실제 삭제 + `.bak` 복원 경로가 어떤 테스트에서도 실행되지 않는 죽은 코드였던 문제(M2가 CHANGELOG에 대해 고친 것과 같은 유형 — 테스트 1건 추가). 겸사겸사 `purge.js`가 마커 문자열을 중복 하드코딩하던 것도 `readme.js`의 `MARKER` 상수를 export해 재사용하도록 정리했다.

---

### Task 1: CLI flag parsing for purge

**Files:**
- Modify: `src/cli/args.js:6-22` (defaults), `src/cli/args.js:53-54` (case block)
- Test: `tests/node/purge-cli.test.js` (new)

**Interfaces:**
- Produces: `parseArgs()` result gains `yes`, `allowDirty`, `deleteDevelopBranch`, `keepVersionYml`, `keepReadme`, `keepChangelog`, `keepWorkflows`, `keepScripts`, `keepCoderabbit` — all `boolean`, default `false`. Later tasks read these off `opts`.

- [ ] **Step 1: Write the failing tests**

Create `tests/node/purge-cli.test.js`:

```js
// tests/node/purge-cli.test.js
import { test } from "node:test";
import assert from "node:assert";
import { parseArgs } from "../../src/cli/args.js";

test("parseArgs: --mode purge with --yes sets yes=true", () => {
  const opts = parseArgs(["--mode", "purge", "--yes"]);
  assert.strictEqual(opts.mode, "purge");
  assert.strictEqual(opts.yes, true);
});

test("parseArgs: purge flags default to false", () => {
  const opts = parseArgs(["--mode", "purge"]);
  assert.strictEqual(opts.yes, false);
  assert.strictEqual(opts.allowDirty, false);
  assert.strictEqual(opts.deleteDevelopBranch, false);
  assert.strictEqual(opts.keepVersionYml, false);
  assert.strictEqual(opts.keepReadme, false);
  assert.strictEqual(opts.keepChangelog, false);
  assert.strictEqual(opts.keepWorkflows, false);
  assert.strictEqual(opts.keepScripts, false);
  assert.strictEqual(opts.keepCoderabbit, false);
});

test("parseArgs: all purge-only flags parse", () => {
  const opts = parseArgs([
    "--mode", "purge", "--yes", "--allow-dirty", "--delete-develop-branch",
    "--keep-version-yml", "--keep-readme", "--keep-changelog",
    "--keep-workflows", "--keep-scripts", "--keep-coderabbit",
  ]);
  assert.strictEqual(opts.allowDirty, true);
  assert.strictEqual(opts.deleteDevelopBranch, true);
  assert.strictEqual(opts.keepVersionYml, true);
  assert.strictEqual(opts.keepReadme, true);
  assert.strictEqual(opts.keepChangelog, true);
  assert.strictEqual(opts.keepWorkflows, true);
  assert.strictEqual(opts.keepScripts, true);
  assert.strictEqual(opts.keepCoderabbit, true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/node/purge-cli.test.js`
Expected: FAIL — `opts.yes` etc. are `undefined`, not `false`/`true`.

- [ ] **Step 3: Implement the flags**

In `src/cli/args.js`, add to the `result` object (after the existing `dryRun` field, inside the object literal that starts at line 6):

```js
    dryRun: false,        // --dry-run: 실제 변경 없이 미리보기만 (full/version/workflows/revert 공통)
    // purge 전용 플래그 (숨김 모드 — HELP_TEXT에는 노출하지 않는다).
    yes: false,               // --yes: purge 실행 확인 (필수, --force로 대체 불가)
    allowDirty: false,        // --allow-dirty: git 작업트리 dirty 상태에서도 강행
    deleteDevelopBranch: false, // --delete-develop-branch: 로컬 develop 브랜치까지 삭제
    keepVersionYml: false,
    keepReadme: false,
    keepChangelog: false,
    keepWorkflows: false,
    keepScripts: false,
    keepCoderabbit: false,
```

And add cases to the `switch (a)` block (right after the existing `case "--dry-run": result.dryRun = true; break;`):

```js
      case "--dry-run": result.dryRun = true; break;
      case "--yes": result.yes = true; break;
      case "--allow-dirty": result.allowDirty = true; break;
      case "--delete-develop-branch": result.deleteDevelopBranch = true; break;
      case "--keep-version-yml": result.keepVersionYml = true; break;
      case "--keep-readme": result.keepReadme = true; break;
      case "--keep-changelog": result.keepChangelog = true; break;
      case "--keep-workflows": result.keepWorkflows = true; break;
      case "--keep-scripts": result.keepScripts = true; break;
      case "--keep-coderabbit": result.keepCoderabbit = true; break;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/node/purge-cli.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/cli/args.js tests/node/purge-cli.test.js
git commit -m "$(cat <<'EOF'
mode_purge_설치_이전_상태로_완전_회귀하는_숨김_모드 : feat : purge 전용 CLI 플래그 파싱 추가 https://github.com/Twin-Fang/project-auto-wizard/issues/6
EOF
)"
```

---

### Task 2: README AUTO-VERSION-SECTION removal

**Files:**
- Modify: `src/core/copy/readme.js` (add `writeFileSync` to the existing `node:fs` import, add new export)
- Test: `tests/node/readme-purge.test.js` (new)

**Interfaces:**
- Consumes: the existing `MARKER` constant already defined in this file (now exported — see Step 3).
- Produces: `removeVersionSectionFromReadme(targetRoot = ".")` → returns `"removed" | "skip-no-readme" | "skip-no-marker"`. Also exports `MARKER` (previously module-private) so Task 3's `purge.js` can reuse the exact same marker string instead of hardcoding a duplicate copy. Task 3 (`readmeHasVersionMarker`) and Task 4 (`executePurge`) both import from this file.

- [ ] **Step 1: Write the failing tests**

Create `tests/node/readme-purge.test.js`:

```js
// tests/node/readme-purge.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { addVersionSectionToReadme, removeVersionSectionFromReadme } from "../../src/core/copy/readme.js";

function withTempReadme(initialContent, fn) {
  const target = mkdtempSync(join(tmpdir(), "paw-readme-purge-"));
  writeFileSync(join(target, "README.md"), initialContent);
  try {
    return fn(target);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
}

test("removeVersionSectionFromReadme: round-trip restores original content", () => {
  withTempReadme("# My Project\n\nSome description.\n", (target) => {
    const original = readFileSync(join(target, "README.md"), "utf8");
    addVersionSectionToReadme("1.2.3", target);
    assert.ok(readFileSync(join(target, "README.md"), "utf8").includes("AUTO-VERSION-SECTION"));
    const result = removeVersionSectionFromReadme(target);
    assert.strictEqual(result, "removed");
    assert.strictEqual(readFileSync(join(target, "README.md"), "utf8"), original);
  });
});

test("removeVersionSectionFromReadme: no marker present -> no-op", () => {
  withTempReadme("# My Project\n\nSome description.\n", (target) => {
    const original = readFileSync(join(target, "README.md"), "utf8");
    const result = removeVersionSectionFromReadme(target);
    assert.strictEqual(result, "skip-no-marker");
    assert.strictEqual(readFileSync(join(target, "README.md"), "utf8"), original);
  });
});

test("removeVersionSectionFromReadme: no README.md -> no-op", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-readme-purge-"));
  try {
    const result = removeVersionSectionFromReadme(target);
    assert.strictEqual(result, "skip-no-readme");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// H2 (Fable 검토): 릴리스 워크플로우(payload/workflows/common/PROJECT-COMMON-README-VERSION-UPDATE.yaml)는
// README에 이미 사용자가 버전 라인을 써 둔 상태로 마법사가 설치된 경우(addVersionSectionToReadme가
// skip-version-line으로 아무것도 안 씀) 다음 릴리스에서 "---" 프리앰블·CHANGELOG 링크 없이
// 마커 라인만 그 버전 라인 바로 위에 삽입한다. 이 형태에서도 마커+버전라인만 정확히 제거되고
// 그 앞뒤 사용자 콘텐츠는 보존돼야 한다(EOF까지 통째로 자르면 안 됨).
test("removeVersionSectionFromReadme: marker-only shape (no --- preamble, inserted by the release workflow next to a pre-existing user version line) removes only the marker+version lines", () => {
  withTempReadme(
    "# My Project\n\n<!-- AUTO-VERSION-SECTION: DO NOT EDIT MANUALLY -->\n## Version : v1.0.0\n\nSome other content.\n",
    (target) => {
      const result = removeVersionSectionFromReadme(target);
      assert.strictEqual(result, "removed");
      assert.strictEqual(
        readFileSync(join(target, "README.md"), "utf8"),
        "# My Project\n\n\nSome other content.\n",
      );
    },
  );
});

// M-N1 (Fable 2차 검토): PROJECT-COMMON-README-VERSION-UPDATE.yaml은 버전 라인이 아예 없던 README에
// "## Latest Version : vX.Y.Z (날짜)" 헤더를 마커와 함께 직접 삽입한다. 기존 VERSION_LINE_RE는
// "##" 바로 뒤에 "Latest"가 오는 이 형태를 인식하지 못해 버전 라인을 남긴 채로도 "removed"를
// 거짓 반환하는 문제가 있었다 — 워크플로우의 패턴 목록과 정렬한 넓은 정규식으로 고쳐졌는지 검증한다.
test("removeVersionSectionFromReadme: recognizes a 'Latest Version' header inserted by the release workflow when no version line existed before", () => {
  withTempReadme(
    "# My Project\n\n<!-- AUTO-VERSION-SECTION: DO NOT EDIT MANUALLY -->\n## Latest Version : v1.0.0 (2025-08-15)\n\nSome other content.\n",
    (target) => {
      const result = removeVersionSectionFromReadme(target);
      assert.strictEqual(result, "removed");
      assert.strictEqual(
        readFileSync(join(target, "README.md"), "utf8"),
        "# My Project\n\n\nSome other content.\n",
      );
    },
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/node/readme-purge.test.js`
Expected: FAIL — `removeVersionSectionFromReadme` is not exported.

- [ ] **Step 3: Implement the function**

In `src/core/copy/readme.js`, change the import line:

```js
import { existsSync, readFileSync, appendFileSync } from "node:fs";
```
to:
```js
import { existsSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
```

Also change the existing `const MARKER = ...` declaration to `export const MARKER = ...` (M-N1/L4 cleanup: `purge.js`'s Task 3 will reuse this exact constant instead of hardcoding a duplicate copy of the marker string):

```js
export const MARKER = "<!-- AUTO-VERSION-SECTION";
```

Then append at the end of the file. **Note (H2 fix):** the naive "marker to end-of-file" slice from the original draft was wrong — the marker isn't always at EOF (see the Fable-review callout in Global Constraints above), and slicing to EOF would delete real user content that happens to follow. Instead, match the marker line plus only its immediately-adjacent lines (the version line after it, and — only when present — the `---` preamble/CHANGELOG-link lines that `addVersionSectionToReadme` specifically creates). **Note (M-N1 fix):** the existing `VERSION_LINE_RE` (used by `addVersionSectionToReadme`'s skip-check) only recognizes `최신 버전`/`Version`/`버전` headers — but `PROJECT-COMMON-README-VERSION-UPDATE.yaml`'s "no version line found" branch inserts `## Latest Version : vX.Y.Z` directly, which that regex doesn't match. Don't touch `VERSION_LINE_RE` itself (it governs `addVersionSectionToReadme`'s existing skip behavior) — add a second, wider regex used only by the remove path, aligned with the full `VERSION_PATTERNS` list in that workflow file:

```js

// removeVersionSectionFromReadme 전용 — PROJECT-COMMON-README-VERSION-UPDATE.yaml의 VERSION_PATTERNS
// 전체와 정렬한다. VERSION_LINE_RE(=addVersionSectionToReadme의 skip 판정용)보다 넓다: 그 워크플로우는
// 버전 라인이 아예 없던 README에 "## Latest Version : vX.Y.Z"를 직접 삽입하기도 하는데,
// VERSION_LINE_RE는 이를 인식하지 못해 마커만 지우고 버전 라인을 남긴 채로 "removed"를
// 거짓 반환하는 문제가 있었다 (M-N1, Fable 2차 검토).
const REMOVE_VERSION_LINE_RE = /##\s*(최신\s*버전|최신버전|[Cc]urrent\s*[Vv]ersion|[Rr]ecent\s*[Vv]ersion|[Ll]atest\s*[Vv]ersion|Version|버전)\s*:\s*v[0-9]+\.[0-9]+\.[0-9]+/i;

// README AUTO-VERSION-SECTION 블록 제거 (addVersionSectionToReadme와 대칭, purge 모드용).
// 마커는 항상 파일 끝에 있는 게 아니다 — PROJECT-COMMON-README-VERSION-UPDATE.yaml 워크플로우가
// "사용자가 이미 버전 라인을 써 둔 레포"에서는 "---" 프리앰블·CHANGELOG 링크 없이 마커만
// 그 버전 라인 바로 위에 삽입해 두기도 한다. 그래서 "마커~EOF"를 통째로 자르지 않고,
// 마커 라인 + 그 직후 버전 라인(REMOVE_VERSION_LINE_RE 매칭)만 최소 단위로 제거하되,
// addVersionSectionToReadme가 만든 정확한 "\n---\n\n<마커>...\n\n[CHANGELOG 링크]\n" 형태일 때만
// 앞뒤의 "---" 프리앰블·CHANGELOG 링크 라인까지 함께 정리해 바이트 단위로 원본을 복원한다.
// 마커 없으면 no-op. README.md 없으면 no-op.
// 반환: 'removed' | 'skip-no-readme' | 'skip-no-marker'
export function removeVersionSectionFromReadme(targetRoot = ".") {
  const p = join(targetRoot, "README.md");
  if (!existsSync(p)) return "skip-no-readme";
  const lines = readFileSync(p, "utf8").split("\n");
  const markerIdx = lines.findIndex((l) => l.includes(MARKER));
  if (markerIdx === -1) return "skip-no-marker";

  let start = markerIdx;
  let end = markerIdx + 1; // 삭제 구간 [start, end) — 절반열림 구간

  // 마커 바로 다음 줄이 버전 라인이면 함께 제거 (설치 직후·릴리스 갱신 후 두 형태 모두 이 인접 관계를 보장한다).
  if (end < lines.length && REMOVE_VERSION_LINE_RE.test(lines[end])) end += 1;

  // addVersionSectionToReadme()가 만든 전체 블록("\n---\n\n<마커>...") 형태라면
  // 앞의 "---"·그 앞뒤 경계 빈 줄까지 함께 제거해야 원본과 바이트 단위로 복원된다.
  if (start >= 2 && lines[start - 1] === "" && lines[start - 2] === "---") {
    start -= 2;
    if (start >= 1 && lines[start - 1] === "") start -= 1;
  }

  // 블록 끝에 "빈 줄 + CHANGELOG 링크 라인"이 이어지면 함께 제거 (역시 전체 블록 형태에서만 발생).
  if (end < lines.length && lines[end] === "" &&
      end + 1 < lines.length && lines[end + 1].startsWith("[전체 버전 기록 보기]")) {
    end += 2;
  }

  lines.splice(start, end - start);
  writeFileSync(p, lines.join("\n"));
  return "removed";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/node/readme-purge.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/copy/readme.js tests/node/readme-purge.test.js
git commit -m "$(cat <<'EOF'
mode_purge_설치_이전_상태로_완전_회귀하는_숨김_모드 : feat : README AUTO-VERSION-SECTION 블록 제거 함수 추가 https://github.com/Twin-Fang/project-auto-wizard/issues/6
EOF
)"
```

---

### Task 3: `planPurge()` — pure candidate list + pre-delete summary printer

**Files:**
- Create: `src/commands/purge.js`
- Test: `tests/node/purge-plan.test.js` (new)

**Interfaces:**
- Consumes: `planRevert(payloadRoot, targetRoot)` from `src/commands/revert.js` → `{ workflows: string[], scripts: string[], coderabbit: boolean }` (existing, unchanged). `MARKER` from `src/core/copy/readme.js` (Task 2, now exported) — reused instead of hardcoding a duplicate marker string.
- Produces: `planPurge(payloadRoot, targetRoot = ".", keepFlags = {})` → `{ workflows: string[], scripts: string[], coderabbit: boolean, versionYml: boolean, readmeSection: boolean, changelog: string[] }`. `keepFlags` shape: `{ versionYml?, readme?, changelog?, workflows?, scripts?, coderabbit? }` (all optional booleans). `printPurgePlan(plan, { dryRun = false } = {})` — logs to console, no return value. Task 4 (`executePurge`) and Task 5 (`index.js`) both import `planPurge` and `printPurgePlan`.

- [ ] **Step 1: Write the failing tests**

Create `tests/node/purge-plan.test.js`:

```js
// tests/node/purge-plan.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { planPurge } from "../../src/commands/purge.js";

function installFixture() {
  const target = mkdtempSync(join(tmpdir(), "paw-purge-plan-"));
  writeFileSync(join(target, "README.md"), "# Test Repo\n");
  const ctx = createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(), includeCodeRabbit: false,
    now: "2026-07-28 00:00:00", today: "2026-07-28", templateVersion: "0.1.0",
  });
  runFull(ctx, resolvePayloadRoot(), target);
  return target;
}

test("planPurge: lists workflows/scripts + version.yml + readme section, deletes nothing", () => {
  const target = installFixture();
  try {
    const plan = planPurge(resolvePayloadRoot(), target);
    assert.ok(plan.workflows.length > 0);
    assert.ok(plan.scripts.includes("version_manager.py"));
    assert.strictEqual(plan.versionYml, true);
    assert.strictEqual(plan.readmeSection, true);
    assert.deepStrictEqual(plan.changelog, []);
    assert.ok(existsSync(join(target, "version.yml")));
    assert.ok(existsSync(join(target, ".github/scripts/version_manager.py")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planPurge: detects CHANGELOG.json/.md when present at root", () => {
  const target = installFixture();
  try {
    writeFileSync(join(target, "CHANGELOG.json"), "{}");
    writeFileSync(join(target, "CHANGELOG.md"), "# Changelog\n");
    const plan = planPurge(resolvePayloadRoot(), target);
    assert.deepStrictEqual(plan.changelog.sort(), ["CHANGELOG.json", "CHANGELOG.md"]);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planPurge: keepFlags excludes categories from the plan", () => {
  const target = installFixture();
  try {
    const plan = planPurge(resolvePayloadRoot(), target, {
      versionYml: true, readme: true, workflows: true, scripts: true, coderabbit: true, changelog: true,
    });
    assert.deepStrictEqual(plan.workflows, []);
    assert.deepStrictEqual(plan.scripts, []);
    assert.strictEqual(plan.coderabbit, false);
    assert.strictEqual(plan.versionYml, false);
    assert.strictEqual(plan.readmeSection, false);
    assert.deepStrictEqual(plan.changelog, []);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/node/purge-plan.test.js`
Expected: FAIL — `src/commands/purge.js` does not exist.

- [ ] **Step 3: Implement `planPurge` and `printPurgePlan`**

Create `src/commands/purge.js`:

```js
// purge 모드 — revert가 지우는 전부(워크플로우·스크립트·coderabbit) + version.yml·README
// AUTO-VERSION-SECTION 블록·CHANGELOG를 추가로 제거해 설치 이전 상태로 완전히 되돌린다.
// 개발·테스트 전용 숨김 모드 — DESIGN-SPEC purge #6.
// develop 브랜치 삭제는 파일 삭제와 성격이 달라(실행 시점 git 상태 판단 필요) 여기 plan에는
// 포함하지 않고 index.js의 purge 분기에서 직접 처리한다.
import { join } from "node:path";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { PATHS } from "../core/paths.js";
import { remove } from "../core/fsutil.js";
import { planRevert } from "./revert.js";
import { removeVersionSectionFromReadme, MARKER } from "../core/copy/readme.js";

const CHANGELOG_FILES = ["CHANGELOG.json", "CHANGELOG.md"];

// L4 (Fable 2차 검토): 마커 문자열을 여기서 다시 하드코딩하지 않고 readme.js의 MARKER를 그대로 재사용한다
// (진실이 두 곳으로 갈리면 한쪽만 바뀌었을 때 plan 판정과 실제 제거 조건이 어긋날 수 있다).
function readmeHasVersionMarker(targetRoot) {
  const p = join(targetRoot, "README.md");
  if (!existsSync(p)) return false;
  return readFileSync(p, "utf8").includes(MARKER);
}

// keepFlags: { versionYml, readme, changelog, workflows, scripts, coderabbit } — true인 카테고리는 후보에서 제외.
// 반환: { workflows, scripts, coderabbit, versionYml, readmeSection, changelog } — 아무것도 지우지 않는 순수 함수.
export function planPurge(payloadRoot, targetRoot = ".", keepFlags = {}) {
  const revertPlan = planRevert(payloadRoot, targetRoot);
  return {
    workflows: keepFlags.workflows ? [] : revertPlan.workflows,
    scripts: keepFlags.scripts ? [] : revertPlan.scripts,
    coderabbit: keepFlags.coderabbit ? false : revertPlan.coderabbit,
    versionYml: !keepFlags.versionYml && existsSync(join(targetRoot, PATHS.versionFile)),
    readmeSection: !keepFlags.readme && readmeHasVersionMarker(targetRoot),
    changelog: keepFlags.changelog ? [] : CHANGELOG_FILES.filter((f) => existsSync(join(targetRoot, f))),
  };
}

// 삭제 전 요약 출력 — dry-run 미리보기와 실제 실행 전 요약 양쪽에서 재사용한다.
export function printPurgePlan(plan, { dryRun = false } = {}) {
  const lines = ["",
    dryRun
      ? "project-auto-wizard --mode purge --dry-run — 미리보기, 실제 파일은 바뀌지 않았습니다"
      : "project-auto-wizard --mode purge — 아래 항목을 제거합니다",
    ""];
  lines.push(`워크플로우 (${plan.workflows.length}개):`);
  for (const f of plan.workflows) lines.push(`  - ${f}`);
  lines.push(`스크립트 (${plan.scripts.length}개):`);
  for (const f of plan.scripts) lines.push(`  - ${f}`);
  if (plan.coderabbit) lines.push("파일: .coderabbit.yaml");
  if (plan.versionYml) lines.push("파일: version.yml");
  if (plan.readmeSection) lines.push("README.md: AUTO-VERSION-SECTION 블록");
  for (const f of plan.changelog) lines.push(`파일: ${f}`);
  lines.push("");
  console.log(lines.join("\n"));
}
```

Note: `renameSync` is imported here even though `planPurge`/`printPurgePlan` don't use it yet — Task 4 adds `executePurge` to this same file and needs it. If your editor/linter flags the unused import after Step 3, that's expected and resolved by Task 4; don't remove it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/node/purge-plan.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/commands/purge.js tests/node/purge-plan.test.js
git commit -m "$(cat <<'EOF'
mode_purge_설치_이전_상태로_완전_회귀하는_숨김_모드 : feat : purge 대상 계산(planPurge)과 삭제 전 요약 출력 추가 https://github.com/Twin-Fang/project-auto-wizard/issues/6
EOF
)"
```

---

### Task 4: `executePurge()` — actual deletion + post-delete summary printer

**Files:**
- Modify: `src/commands/purge.js` (append)
- Test: `tests/node/purge-plan.test.js` (append)

**Interfaces:**
- Consumes: `planPurge()` (Task 3), `remove()` from `src/core/fsutil.js` (existing), `removeVersionSectionFromReadme()` from Task 2.
- Produces: `executePurge(payloadRoot, targetRoot = ".", keepFlags = {})` → same shape as `planPurge()`'s return value, reflecting what was actually removed. `printPurgeResult(result)` — logs to console, no return value. Task 5 (`index.js`) imports both.

- [ ] **Step 1: Write the failing tests**

Append to `tests/node/purge-plan.test.js` (add these imports to the existing import line and add the tests below the existing ones):

```js
import { readdirSync, readFileSync as readFile } from "node:fs";
import { executePurge, printPurgeResult } from "../../src/commands/purge.js";

// H1 (Fable 검토): runFull()은 항상 ensureGitignore()를 호출해 .gitignore가 없으면 새로 만든다.
// purge는 스펙 §2 비목표에 따라 .gitignore를 절대 건드리지 않으므로, 라운드트립 비교에서
// .gitignore는 "설치 전=없음 vs 설치 후=있음" 차이가 항상 발생한다 — .git과 마찬가지로 비교 대상에서 제외한다.
function listAllFiles(dir, base = dir) {
  let out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === ".gitignore") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) out = out.concat(listAllFiles(full, base));
    else out.push(full.slice(base.length + 1));
  }
  return out.sort();
}

test("executePurge: round-trip returns target to its pre-install file tree", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-purge-plan-"));
  writeFileSync(join(target, "README.md"), "# Test Repo\n");
  try {
    const before = listAllFiles(target);
    const ctx = createContext({
      mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
      branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
      paths: new Map(), includeCodeRabbit: false,
      now: "2026-07-28 00:00:00", today: "2026-07-28", templateVersion: "0.1.0",
    });
    runFull(ctx, resolvePayloadRoot(), target);
    assert.ok(listAllFiles(target).length > before.length);
    const result = executePurge(resolvePayloadRoot(), target);
    assert.deepStrictEqual(listAllFiles(target), before);
    assert.strictEqual(readFile(join(target, "README.md"), "utf8"), "# Test Repo\n");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("executePurge: --keep-version-yml preserves version.yml while removing the rest", () => {
  const target = installFixture();
  try {
    const result = executePurge(resolvePayloadRoot(), target, { versionYml: true });
    assert.ok(existsSync(join(target, "version.yml")));
    assert.ok(!existsSync(join(target, ".github/scripts/version_manager.py")));
    assert.strictEqual(result.versionYml, false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// M1 (Fable 검토): 스펙 §9-1은 "--keep-* 각각"에 대해 실행 레벨(execute) 보존 검증을 요구하는데
// 최초 초안은 --keep-version-yml 하나뿐이었다 — 나머지 5개도 각각 실행 레벨에서 검증한다.
test("executePurge: --keep-readme preserves the AUTO-VERSION-SECTION block while removing the rest", () => {
  const target = installFixture();
  try {
    const result = executePurge(resolvePayloadRoot(), target, { readme: true });
    assert.ok(readFile(join(target, "README.md"), "utf8").includes("AUTO-VERSION-SECTION"));
    assert.ok(!existsSync(join(target, "version.yml")));
    assert.strictEqual(result.readmeSection, false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("executePurge: --keep-workflows preserves workflow files while removing the rest", () => {
  const target = installFixture();
  try {
    const before = readdirSync(join(target, ".github/workflows")).sort();
    executePurge(resolvePayloadRoot(), target, { workflows: true });
    assert.deepStrictEqual(readdirSync(join(target, ".github/workflows")).sort(), before);
    assert.ok(!existsSync(join(target, "version.yml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("executePurge: --keep-scripts preserves .github/scripts/*.py while removing the rest", () => {
  const target = installFixture();
  try {
    executePurge(resolvePayloadRoot(), target, { scripts: true });
    assert.ok(existsSync(join(target, ".github/scripts/version_manager.py")));
    assert.ok(!existsSync(join(target, "version.yml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// M2 (Fable 검토): CHANGELOG 카테고리는 최초 초안에서 감지(planPurge)만 검증되고 실제 삭제가
// 어떤 테스트에서도 실행되지 않는 죽은 경로였다 — --keep-changelog 보존 테스트와 별개로
// 기본 동작(보존 플래그 없이 실제로 지워짐)도 명시적으로 검증한다.
test("executePurge: --keep-changelog preserves CHANGELOG files while removing the rest", () => {
  const target = installFixture();
  try {
    writeFileSync(join(target, "CHANGELOG.json"), "{}");
    executePurge(resolvePayloadRoot(), target, { changelog: true });
    assert.ok(existsSync(join(target, "CHANGELOG.json")));
    assert.ok(!existsSync(join(target, "version.yml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("executePurge: deletes CHANGELOG.json/.md when present and not kept", () => {
  const target = installFixture();
  try {
    writeFileSync(join(target, "CHANGELOG.json"), "{}");
    writeFileSync(join(target, "CHANGELOG.md"), "# Changelog\n");
    const result = executePurge(resolvePayloadRoot(), target);
    assert.ok(!existsSync(join(target, "CHANGELOG.json")));
    assert.ok(!existsSync(join(target, "CHANGELOG.md")));
    assert.deepStrictEqual(result.changelog.sort(), ["CHANGELOG.json", "CHANGELOG.md"]);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("executePurge: --keep-coderabbit preserves .coderabbit.yaml while removing the rest", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-purge-plan-"));
  writeFileSync(join(target, "README.md"), "# Test Repo\n");
  try {
    const ctx = createContext({
      mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
      branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
      paths: new Map(), includeCodeRabbit: true,
      now: "2026-07-28 00:00:00", today: "2026-07-28", templateVersion: "0.1.0",
    });
    runFull(ctx, resolvePayloadRoot(), target);
    assert.ok(existsSync(join(target, ".coderabbit.yaml")));
    executePurge(resolvePayloadRoot(), target, { coderabbit: true });
    assert.ok(existsSync(join(target, ".coderabbit.yaml")));
    assert.ok(!existsSync(join(target, "version.yml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

// M-N2 (Fable 2차 검토): --keep-coderabbit 테스트는 "보존"만 검증하고, 라운드트립 테스트는
// includeCodeRabbit:false로 설치해 .coderabbit.yaml 자체가 없다 — executePurge의 실제 삭제 +
// .bak 복원 분기(runRevert가 아니라 purge.js 자체 로직)가 어떤 테스트에서도 실행되지 않는 죽은
// 경로였다. coderabbit 설치 후 사용자가 직접 수정 → 재설치(force)로 .bak이 생기는 상황을 재현해
// 삭제와 .bak 복원을 함께 검증한다.
test("executePurge: deletes .coderabbit.yaml and restores a .bak backup when present", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-purge-plan-"));
  writeFileSync(join(target, "README.md"), "# Test Repo\n");
  try {
    const ctx = createContext({
      mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
      branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
      paths: new Map(), includeCodeRabbit: true,
      now: "2026-07-28 00:00:00", today: "2026-07-28", templateVersion: "0.1.0",
    });
    runFull(ctx, resolvePayloadRoot(), target);
    writeFileSync(join(target, ".coderabbit.yaml"), "custom: true\n"); // 사용자가 직접 수정
    runFull(ctx, resolvePayloadRoot(), target); // force 재설치 → 덮어쓰기 + .bak 생성 (copyCoderabbit)
    assert.ok(existsSync(join(target, ".coderabbit.yaml.bak")));

    const result = executePurge(resolvePayloadRoot(), target);
    assert.ok(!existsSync(join(target, ".coderabbit.yaml.bak")));
    assert.strictEqual(readFile(join(target, ".coderabbit.yaml"), "utf8"), "custom: true\n");
    assert.strictEqual(result.coderabbit, true);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("printPurgeResult: lists removed filenames, not just counts (M3)", () => {
  const originalLog = console.log;
  let stdout = "";
  console.log = (msg) => { stdout += msg; };
  try {
    printPurgeResult({
      workflows: ["PROJECT-RELEASE.yaml"], scripts: ["version_manager.py"],
      coderabbit: true, versionYml: true, readmeSection: true, changelog: ["CHANGELOG.md"],
    });
  } finally {
    console.log = originalLog;
  }
  assert.ok(stdout.includes("PROJECT-RELEASE.yaml"));
  assert.ok(stdout.includes("version_manager.py"));
  assert.ok(stdout.includes("CHANGELOG.md"));
});

test("printPurgeResult: does not throw on an empty result", () => {
  printPurgeResult({ workflows: [], scripts: [], coderabbit: false, versionYml: false, readmeSection: false, changelog: [] });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/node/purge-plan.test.js`
Expected: FAIL — `executePurge`/`printPurgeResult` are not exported.

- [ ] **Step 3: Implement `executePurge` and `printPurgeResult`**

Append to `src/commands/purge.js`:

```js

// 실제 삭제 수행 — planPurge()와 동일 shape을 반환하되 실제로 제거된 항목을 반영한다.
// runRevert()를 통째로 호출하지 않는 이유: runRevert는 항상 전체를 지우므로
// --keep-* 로 선택적 카테고리만 보존하는 요구사항과 맞지 않는다.
// H3 (Fable 검토): readmeSection은 plan의 판정을 그대로 되돌려주지 않고
// removeVersionSectionFromReadme()의 실제 반환값("removed"인지)을 반영한다 — 스펙 §6이
// "반환값은 실제 삭제 결과를 반영"하라고 명시하기 때문에, plan과 실제 제거 조건이
// 이론상 어긋나는 경우에도 printPurgeResult가 거짓으로 "제거됨"을 보고하지 않는다.
export function executePurge(payloadRoot, targetRoot = ".", keepFlags = {}) {
  const plan = planPurge(payloadRoot, targetRoot, keepFlags);
  const wfDir = join(targetRoot, PATHS.workflowsDir);
  for (const name of plan.workflows) remove(join(wfDir, name));
  for (const name of plan.scripts) remove(join(targetRoot, PATHS.scriptsDir, name));
  if (plan.coderabbit) {
    const cr = join(targetRoot, ".coderabbit.yaml");
    remove(cr);
    if (existsSync(cr + ".bak")) renameSync(cr + ".bak", cr);
  }
  if (plan.versionYml) remove(join(targetRoot, PATHS.versionFile));
  const readmeSection = plan.readmeSection && removeVersionSectionFromReadme(targetRoot) === "removed";
  for (const f of plan.changelog) remove(join(targetRoot, f));
  return { ...plan, readmeSection };
}

// 삭제 후 실제 제거된 목록 출력 — printPurgePlan과 완전히 동일한 형태(파일명 나열)로
// 맞춘다 (M3, Fable 검토: 개수만 출력하면 스펙 §5-6의 "제거된 목록 재출력" 요구를 충족하지 못함).
export function printPurgeResult(result) {
  const lines = ["", "제거됨:", ""];
  lines.push(`워크플로우 (${result.workflows.length}개):`);
  for (const f of result.workflows) lines.push(`  - ${f}`);
  lines.push(`스크립트 (${result.scripts.length}개):`);
  for (const f of result.scripts) lines.push(`  - ${f}`);
  if (result.coderabbit) lines.push("파일: .coderabbit.yaml");
  if (result.versionYml) lines.push("파일: version.yml");
  if (result.readmeSection) lines.push("README.md: AUTO-VERSION-SECTION 블록");
  for (const f of result.changelog) lines.push(`파일: ${f}`);
  lines.push("");
  console.log(lines.join("\n"));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/node/purge-plan.test.js`
Expected: PASS (14 tests total — 3 from Task 3 + 11 from this task)

- [ ] **Step 5: Commit**

```bash
git add src/commands/purge.js tests/node/purge-plan.test.js
git commit -m "$(cat <<'EOF'
mode_purge_설치_이전_상태로_완전_회귀하는_숨김_모드 : feat : purge 실제 삭제(executePurge)와 삭제 후 요약 출력 추가 https://github.com/Twin-Fang/project-auto-wizard/issues/6
EOF
)"
```

---

### Task 5: `src/index.js` — purge mode routing (all safety gates + dry-run + execute)

**Files:**
- Modify: `src/core/branches.js:8` (export the existing `defaultExec`)
- Modify: `src/index.js` (imports, `run()` signature, new `purge` branch)
- Test: `tests/node/purge-cli.test.js` (append)

**Interfaces:**
- Consumes: `planPurge`, `executePurge`, `printPurgePlan`, `printPurgeResult` (Tasks 3–4); `defaultExec` (now exported from `branches.js`); `detectRepoName` (already imported in `index.js`).
- Produces: `run(argv, { cwd, payloadRoot, clock, exec, promptRepoName })` — `exec` and `promptRepoName` are new, optional, injectable dependencies (default to real implementations). `exec(cmd, args, { cwd })` → `Promise<{ code, stdout, stderr }>` (same contract as `branches.js`'s existing `defaultExec`). `promptRepoName(repoName)` → `Promise<string>`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/node/purge-cli.test.js` (add these imports alongside the existing `parseArgs` import, and add the tests below):

```js
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "../../src/index.js";

async function installedTarget() {
  const target = mkdtempSync(join(tmpdir(), "paw-purge-cli-"));
  mkdirSync(join(target, ".git"));
  await run(["--mode", "full", "--force", "--type", "node"], {
    cwd: target, clock: { now: "2026-07-28 00:00:00", today: "2026-07-28" },
  });
  return target;
}

const cleanExec = async (cmd, args) => {
  if (args[0] === "status") return { code: 0, stdout: "", stderr: "" };
  return { code: 0, stdout: "", stderr: "" };
};
const dirtyExec = async (cmd, args) => {
  if (args[0] === "status") return { code: 0, stdout: " M some-file.txt\n", stderr: "" };
  return { code: 0, stdout: "", stderr: "" };
};

test("run(): --mode purge outside a git repo is rejected even with --dry-run", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-purge-cli-"));
  try {
    const code = await run(["--mode", "purge", "--dry-run"], { cwd: target });
    assert.strictEqual(code, 1);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --mode purge --dry-run needs no --yes and writes nothing", async () => {
  const target = await installedTarget();
  try {
    const code = await run(["--mode", "purge", "--dry-run"], { cwd: target });
    assert.strictEqual(code, 0);
    assert.ok(existsSync(join(target, "version.yml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --mode purge --dry-run --delete-develop-branch mentions the pending branch deletion", async () => {
  const target = await installedTarget();
  const originalLog = console.log;
  let stdout = "";
  console.log = (msg) => { stdout += msg; };
  try {
    const code = await run(["--mode", "purge", "--dry-run", "--delete-develop-branch"], { cwd: target });
    assert.strictEqual(code, 0);
    assert.ok(stdout.includes("--delete-develop-branch"));
  } finally {
    console.log = originalLog;
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --mode purge without --yes is rejected even with --force", async () => {
  const target = await installedTarget();
  try {
    const code = await run(["--mode", "purge", "--force"], { cwd: target, exec: cleanExec });
    assert.strictEqual(code, 1);
    assert.ok(existsSync(join(target, "version.yml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --mode purge --yes rejects a dirty working tree without --allow-dirty", async () => {
  const target = await installedTarget();
  try {
    const code = await run(["--mode", "purge", "--yes", "--force"], { cwd: target, exec: dirtyExec });
    assert.strictEqual(code, 1);
    assert.ok(existsSync(join(target, "version.yml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --mode purge --yes --allow-dirty --force performs the purge", async () => {
  const target = await installedTarget();
  try {
    const code = await run(["--mode", "purge", "--yes", "--allow-dirty", "--force"], { cwd: target, exec: dirtyExec });
    assert.strictEqual(code, 0);
    assert.ok(!existsSync(join(target, "version.yml")));
    assert.ok(!existsSync(join(target, ".github/scripts/version_manager.py")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --mode purge --yes without --force in a non-TTY environment is rejected", async () => {
  const target = await installedTarget();
  try {
    const code = await run(["--mode", "purge", "--yes"], { cwd: target, exec: cleanExec });
    assert.strictEqual(code, 1);
    assert.ok(existsSync(join(target, "version.yml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --mode purge --yes with TTY and a matching typed repo name performs the purge", async () => {
  const target = await installedTarget();
  const originalIsTTY = process.stdout.isTTY;
  process.stdout.isTTY = true;
  try {
    const repoName = target.split("/").pop();
    const code = await run(["--mode", "purge", "--yes"], {
      cwd: target, exec: cleanExec, promptRepoName: async () => repoName,
    });
    assert.strictEqual(code, 0);
    assert.ok(!existsSync(join(target, "version.yml")));
  } finally {
    process.stdout.isTTY = originalIsTTY;
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --mode purge --yes with TTY and a mismatched typed repo name aborts", async () => {
  const target = await installedTarget();
  const originalIsTTY = process.stdout.isTTY;
  process.stdout.isTTY = true;
  try {
    const code = await run(["--mode", "purge", "--yes"], {
      cwd: target, exec: cleanExec, promptRepoName: async () => "definitely-wrong-name",
    });
    assert.strictEqual(code, 1);
    assert.ok(existsSync(join(target, "version.yml")));
  } finally {
    process.stdout.isTTY = originalIsTTY;
    rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/node/purge-cli.test.js`
Expected: FAIL — `--mode purge` falls through to the default no-op branch in `run()`, so files aren't removed and gate checks don't fire (several assertions fail; some may pass by accident — that's fine, the point is the suite isn't green yet).

- [ ] **Step 3: Export `defaultExec` from `branches.js`**

In `src/core/branches.js`, change:
```js
function defaultExec(cmd, args, { cwd } = {}) {
```
to:
```js
export function defaultExec(cmd, args, { cwd } = {}) {
```

- [ ] **Step 4: Wire the purge branch into `index.js`**

Add these imports to `src/index.js` (alongside the existing ones):

```js
import { createInterface } from "node:readline/promises";
```

Change:
```js
import { resolveBranchConfig, detectRemoteBranches, ensureDevelopBranch } from "./core/branches.js";
```
to:
```js
import { resolveBranchConfig, detectRemoteBranches, ensureDevelopBranch, defaultExec } from "./core/branches.js";
```

Add:
```js
import { planPurge, executePurge, printPurgePlan, printPurgeResult } from "./commands/purge.js";
```

Add a new helper function after `utcNow()` (before `export async function run(...)`):

```js
// purge TTY 확인 — 실제 stdin에서 한 줄 입력을 받는다 (테스트는 promptRepoName 주입으로 대체).
async function defaultPromptRepoName(repoName) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(`purge를 실행하려면 정확히 이 레포명을 입력하세요: ${repoName}\n> `);
  } finally {
    rl.close();
  }
}
```

Change the `run()` signature from:
```js
export async function run(argv, { cwd = process.cwd(), payloadRoot, clock } = {}) {
```
to:
```js
export async function run(argv, {
  cwd = process.cwd(), payloadRoot, clock,
  exec = defaultExec, promptRepoName = defaultPromptRepoName,
} = {}) {
```

Insert a new `purge` branch immediately after the closing `}` of the existing `revert` branch (i.e., right before the `// status 모드` comment):

```js
  // purge 모드 — 마법사가 만든 모든 산출물을 지워 설치 이전 상태로 완전히 되돌린다.
  // 개발·테스트 전용 숨김 모드 — --help/대화형 메뉴에 노출하지 않는다 (issue #6).
  if (opts.mode === "purge") {
    if (!existsSync(join(cwd, ".git"))) {
      console.error("git 레포가 아닙니다(.git 없음) — purge는 git 레포 안에서만 실행할 수 있습니다.");
      return 1;
    }
    const keepFlags = {
      versionYml: opts.keepVersionYml, readme: opts.keepReadme, changelog: opts.keepChangelog,
      workflows: opts.keepWorkflows, scripts: opts.keepScripts, coderabbit: opts.keepCoderabbit,
    };
    if (opts.dryRun) {
      printPurgePlan(planPurge(payload, cwd, keepFlags), { dryRun: true });
      // M4 (Fable 검토): develop 브랜치 삭제는 plan에 포함되지 않으므로(§6 — git 상태는 실행 시점에만
      // 판단 가능) 별도로 예고하지 않으면 dry-run 미리보기가 유일한 파괴적 동작을 사용자에게 숨기게 된다.
      if (opts.deleteDevelopBranch) {
        console.log("(--delete-develop-branch 지정됨: 실제 실행 시 로컬 develop 브랜치도 삭제를 시도합니다)");
      }
      return 0;
    }
    if (!opts.yes) {
      console.error("--yes 없이는 purge를 실행할 수 없습니다 (--force로 대체할 수 없습니다).");
      return 1;
    }
    // exec 실패(git 없음·손상된 레포 등)를 "clean"으로 오인하면 안 된다 — 실패 시 항상 거부한다.
    // --allow-dirty는 "dirty 내용을 알고도 진행"이지 "상태를 못 읽어도 진행"이 아니므로 exec 실패
    // 체크는 --allow-dirty로도 우회되지 않는다 (구현 중 SDD 태스크 리뷰에서 발견·수정 — 최초 초안엔
    // st.code 체크가 없었다).
    const st = await exec("git", ["status", "--porcelain"], { cwd });
    if (st.code !== 0) {
      console.error("git 상태를 확인할 수 없습니다 — 안전을 위해 purge를 중단합니다.");
      return 1;
    }
    if (!opts.allowDirty && st.stdout.trim() !== "") {
      console.error("작업트리에 커밋되지 않은 변경 사항이 있습니다 — purge 후 복구할 수 없습니다. 커밋하거나 --allow-dirty를 사용하세요.");
      return 1;
    }
    if (!opts.force) {
      if (!process.stdout.isTTY) {
        console.error("비대화형 환경에서는 --force 옵션이 필요합니다.");
        return 1;
      }
      const repoName = detectRepoName(cwd);
      const typed = await promptRepoName(repoName);
      if (typed !== repoName) {
        console.error("입력한 레포명이 일치하지 않습니다 — purge를 중단합니다.");
        return 1;
      }
    }
    const plan = planPurge(payload, cwd, keepFlags);
    printPurgePlan(plan, { dryRun: false });
    const result = executePurge(payload, cwd, keepFlags);
    printPurgeResult(result);
    return 0;
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/node/purge-cli.test.js`
Expected: PASS (all tests in the file, including the 3 from Task 1)

Then run the full suite to check for regressions: `npm run test:node`
Expected: PASS (no existing test broken by the `branches.js` export or `index.js` signature change — both are additive)

- [ ] **Step 6: Commit**

```bash
git add src/core/branches.js src/index.js tests/node/purge-cli.test.js
git commit -m "$(cat <<'EOF'
mode_purge_설치_이전_상태로_완전_회귀하는_숨김_모드 : feat : purge 모드 안전장치 게이트와 실행 라우팅 추가 https://github.com/Twin-Fang/project-auto-wizard/issues/6
EOF
)"
```

---

### Task 6: `--delete-develop-branch` — opt-in local branch deletion

**Files:**
- Modify: `src/index.js` (purge branch, added in Task 5)
- Test: `tests/node/purge-cli.test.js` (append)

**Interfaces:**
- Consumes: `exec` (already threaded through in Task 5), `parseExisting` (already imported in `index.js`).
- Produces: no new exports — this extends the purge branch's behavior only.

- [ ] **Step 1: Write the failing tests**

Append to `tests/node/purge-cli.test.js`:

```js
test("run(): --delete-develop-branch deletes the local branch on success", async () => {
  const target = await installedTarget();
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push(args.join(" "));
    return { code: 0, stdout: "", stderr: "" };
  };
  try {
    const code = await run(["--mode", "purge", "--yes", "--force", "--delete-develop-branch"], { cwd: target, exec });
    assert.strictEqual(code, 0);
    assert.ok(calls.includes("branch -d develop"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --delete-develop-branch failure (unmerged) logs a warning but still exits 0", async () => {
  const target = await installedTarget();
  let stderr = "";
  const originalError = console.error;
  console.error = (msg) => { stderr += msg; };
  const exec = async (cmd, args) => {
    if (args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (args[0] === "branch") return { code: 1, stdout: "", stderr: "error: branch 'develop' is not fully merged" };
    return { code: 0, stdout: "", stderr: "" };
  };
  try {
    const code = await run(["--mode", "purge", "--yes", "--force", "--delete-develop-branch"], { cwd: target, exec });
    assert.strictEqual(code, 0);
    assert.ok(stderr.includes("삭제 실패"));
  } finally {
    console.error = originalError;
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): without --delete-develop-branch, no branch command is issued", async () => {
  const target = await installedTarget();
  const calls = [];
  const exec = async (cmd, args) => { calls.push(args.join(" ")); return { code: 0, stdout: "", stderr: "" }; };
  try {
    await run(["--mode", "purge", "--yes", "--force"], { cwd: target, exec });
    assert.ok(!calls.some((c) => c.startsWith("branch")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/node/purge-cli.test.js`
Expected: FAIL — the first two new tests fail (`--delete-develop-branch` currently does nothing).

- [ ] **Step 3: Implement local `develop` branch deletion**

In `src/index.js`, inside the `purge` branch added in Task 5, replace:
```js
    const plan = planPurge(payload, cwd, keepFlags);
    printPurgePlan(plan, { dryRun: false });
    const result = executePurge(payload, cwd, keepFlags);
    printPurgeResult(result);
    return 0;
  }
```
with:
```js
    const vyPath = join(cwd, "version.yml");
    const existing = existsSync(vyPath) ? parseExisting(readFileSync(vyPath, "utf8")) : null;
    const plan = planPurge(payload, cwd, keepFlags);
    printPurgePlan(plan, { dryRun: false });
    const result = executePurge(payload, cwd, keepFlags);
    printPurgeResult(result);
    if (opts.deleteDevelopBranch) {
      const developBranch = existing?.branches?.develop || "develop";
      const br = await exec("git", ["branch", "-d", developBranch], { cwd });
      if (br.code !== 0) {
        console.error(`⚠️  로컬 '${developBranch}' 브랜치 삭제 실패 (${(br.stderr || "").trim() || "이유 확인 불가"}) — 수동으로 확인하세요.`);
      } else {
        console.error(`로컬 '${developBranch}' 브랜치를 삭제했습니다.`);
      }
    }
    return 0;
  }
```

(`existsSync`, `readFileSync`, `parseExisting`, and `join` are all already imported at the top of `index.js` — no new imports needed.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/node/purge-cli.test.js`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Commit**

```bash
git add src/index.js tests/node/purge-cli.test.js
git commit -m "$(cat <<'EOF'
mode_purge_설치_이전_상태로_완전_회귀하는_숨김_모드 : feat : --delete-develop-branch 로컬 브랜치 삭제 opt-in 추가 https://github.com/Twin-Fang/project-auto-wizard/issues/6
EOF
)"
```

---

### Task 7: End-to-end CLI round-trip verification

**Files:**
- Test: `tests/node/purge-cli.test.js` (append)

**Interfaces:**
- Consumes: everything from Tasks 1–6. No production code changes in this task — it only adds integration-level test coverage tying the pieces together through the public `run()` entrypoint.

- [ ] **Step 1: Write the tests**

Append to `tests/node/purge-cli.test.js`:

```js
import { readdirSync } from "node:fs";

// H1 (Fable 검토): .gitignore는 runFull()이 항상 새로 만들고 purge는 절대 건드리지 않으므로
// (스펙 §2 비목표) 라운드트립 비교에서 .git과 함께 제외한다 — 자세한 이유는 Task 4의 동일 헬퍼 참고.
function listAllFilesCli(dir, base = dir) {
  let out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === ".gitignore") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) out = out.concat(listAllFilesCli(full, base));
    else out.push(full.slice(base.length + 1));
  }
  return out.sort();
}

test("run(): full round-trip — install then purge returns the target to its pre-install state", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-purge-cli-"));
  mkdirSync(join(target, ".git"));
  writeFileSync(join(target, "README.md"), "# Test\n");
  try {
    const before = listAllFilesCli(target);
    await run(["--mode", "full", "--force", "--type", "node"], {
      cwd: target, clock: { now: "2026-07-28 00:00:00", today: "2026-07-28" },
    });
    const code = await run(["--mode", "purge", "--yes", "--force"], { cwd: target, exec: cleanExec });
    assert.strictEqual(code, 0);
    assert.deepStrictEqual(listAllFilesCli(target), before);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --keep-version-yml via CLI preserves only version.yml", async () => {
  const target = await installedTarget();
  try {
    const code = await run(["--mode", "purge", "--yes", "--force", "--keep-version-yml"], { cwd: target, exec: cleanExec });
    assert.strictEqual(code, 0);
    assert.ok(existsSync(join(target, "version.yml")));
    assert.ok(!existsSync(join(target, ".github/scripts/version_manager.py")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --mode purge is not mentioned in --help output (hidden mode)", async () => {
  const originalLog = console.log;
  let stdout = "";
  console.log = (msg) => { stdout += msg; };
  try {
    await run(["--help"], { cwd: process.cwd() });
  } finally {
    console.log = originalLog;
  }
  assert.ok(!stdout.includes("purge"));
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `node --test tests/node/purge-cli.test.js`
Expected: PASS (all tests)

Then run the entire suite once more for a final regression check: `npm test`
Expected: PASS (Node + Python suites both green, no pre-existing test broken)

- [ ] **Step 3: Commit**

```bash
git add tests/node/purge-cli.test.js
git commit -m "$(cat <<'EOF'
mode_purge_설치_이전_상태로_완전_회귀하는_숨김_모드 : feat : purge 라운드트립·keep-flags·숨김 검증 E2E 테스트 추가 https://github.com/Twin-Fang/project-auto-wizard/issues/6
EOF
)"
```

---

## Post-implementation checklist (manual, not a task)

- [ ] `node bin/project-auto-wizard.js --help` output does not mention `purge`.
- [ ] `npm test` passes in full (Node + Python).
- [ ] Manually smoke-test in a disposable git repo: `--mode purge --dry-run`, then `--mode purge --yes --force`, confirm the repo returns to its pre-install state.
