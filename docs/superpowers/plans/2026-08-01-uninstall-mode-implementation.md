# uninstall 모드 신설 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `--mode uninstall`을 신설해, 기존 `--mode revert`(보수적 삭제)보다 넓게 README 버전 섹션·`.gitignore` 자동 추가 항목·`version.yml`까지 사용자가 선택적으로(대화형 체크리스트 또는 `--force` + `--purge-*` 플래그) 완전히 제거할 수 있게 한다.

**Architecture:** 새 `src/commands/uninstall.js`가 읽기 전용인 기존 `planRevert()`를 재사용해 workflows/scripts/coderabbit 후보를 얻고, `readme.js`/`gitignore.js`에 새로 추가하는 대칭 제거 함수로 README/`.gitignore`를, `fsutil.remove()`로 `version.yml`을 제거한다. `plan/run` 순수 함수 쌍(`planUninstall`/`runUninstall`)과, `io` 주입 가능한 대화형 흐름(`runUninstallFlow`)을 CLI(`index.js`)와 대화형 마법사(`interactive.js`)가 공유한다. 기존 `revert.js`는 수정하지 않는다.

**Tech Stack:** Node.js (zero-dependency, ESM), `node:test` + `node:assert`, 기존 `node:readline` 기반 자체 프롬프트 엔진(`src/ui/readline-engine.js`).

## Global Constraints

- 커밋 메시지는 한국어로 작성하고, 이슈 #5 helper 코멘트의 템플릿을 그대로 사용한다: `uninstall_신설_대화형_체크리스트_기반_완전_삭제_지원 : feat : {변경 사항에 대한 설명} https://github.com/Twin-Fang/project-auto-wizard/issues/5` — `{변경 사항에 대한 설명}` 부분만 태스크별로 채운다.
- git force 옵션(`push -f`/`--force`, `reset --hard`, `checkout -f`, `clean -f`, `branch -D`, `commit --amend` 등) 절대 금지.
- `src/commands/revert.js`는 수정하지 않는다 — `planRevert()`만 읽기 전용으로 재사용한다 (브레인스토밍 결정 사항).
- 새로 작성하는 파일의 주석은 한국어로, WHY 위주로 작성한다 (기존 코드 스타일과 일치).
- 각 태스크는 `npm run test:node`(`node --test "tests/node/**/*.test.js"`)로 검증한다. Python 테스트(`npm run test:py`)는 이 기능과 무관해 영향 없음.
- Node >=20.12 (`package.json` engines) — 기존 문법 범위(ESM, optional chaining, `node:*` 프로토콜 import) 유지.
- 의존성 0개 정책 유지 — 새 npm 패키지를 추가하지 않는다.

---

## Task 1: README 버전 섹션 제거 함수 (`readme.js`)

**Files:**
- Modify: `src/core/copy/readme.js` (기존 31줄 — import에 `writeFileSync` 추가, 파일 끝에 함수 2개 추가)
- Test: `tests/node/readme-remove.test.js` (신규)

**Interfaces:**
- Produces: `hasVersionSection(targetRoot = ".") => boolean`, `removeVersionSectionFromReadme(targetRoot = ".") => 'removed' | 'skip-no-readme' | 'skip-no-marker' | 'skip-unexpected-format'`

> **검토 반영(Fable 5 정밀 검토, 2026-08-01):** 최초 설계는 "마커부터 파일 끝까지" 잘라내는 방식이었으나, 설치 이후 사용자가 그 아래에 콘텐츠를 추가하면(라이선스 절 등) 그 내용까지 삭제되는 CRITICAL 결함이 발견됐다. 아래 구현은 (a) 알려진 꼬리 문자열(`SECTION_TAIL`)까지만 바운딩해서 잘라내고 그 이후는 보존하며, (b) 설치되는 `PROJECT-COMMON-README-VERSION-UPDATE.yaml` CI가 사용자 소유 버전 라인 위에 `---` 구분자 없이 마커 주석 한 줄만 끼워넣는 실제 케이스(HIGH)까지 처리하도록 수정됐다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/readme-remove.test.js`:

```js
// tests/node/readme-remove.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { addVersionSectionToReadme, hasVersionSection, removeVersionSectionFromReadme } from "../../src/core/copy/readme.js";

test("hasVersionSection: false before add, true after add", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-readme-remove-"));
  try {
    writeFileSync(join(target, "README.md"), "# Test Project\n");
    assert.strictEqual(hasVersionSection(target), false);
    addVersionSectionToReadme("1.0.0", target);
    assert.strictEqual(hasVersionSection(target), true);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeVersionSectionFromReadme: round-trips back to the original content", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-readme-remove-"));
  try {
    const original = "# Test Project\n\nSome docs.\n";
    writeFileSync(join(target, "README.md"), original);
    addVersionSectionToReadme("1.0.0", target);
    assert.notStrictEqual(readFileSync(join(target, "README.md"), "utf8"), original);

    const status = removeVersionSectionFromReadme(target);
    assert.strictEqual(status, "removed");
    assert.strictEqual(readFileSync(join(target, "README.md"), "utf8"), original);
    assert.strictEqual(hasVersionSection(target), false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeVersionSectionFromReadme: no README.md -> skip-no-readme, no-op", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-readme-remove-"));
  try {
    assert.strictEqual(removeVersionSectionFromReadme(target), "skip-no-readme");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeVersionSectionFromReadme: README.md exists but no marker -> skip-no-marker, content untouched", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-readme-remove-"));
  try {
    writeFileSync(join(target, "README.md"), "# Plain readme\n");
    const status = removeVersionSectionFromReadme(target);
    assert.strictEqual(status, "skip-no-marker");
    assert.strictEqual(readFileSync(join(target, "README.md"), "utf8"), "# Plain readme\n");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeVersionSectionFromReadme: preserves content the user appended after the auto section", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-readme-remove-"));
  try {
    const original = "# Test Project\n\nSome docs.\n";
    writeFileSync(join(target, "README.md"), original);
    addVersionSectionToReadme("1.0.0", target);
    // 설치 후 사용자가 파일 끝에 라이선스 절을 추가했다고 가정 — uninstall이 이 내용을 지우면 안 된다.
    const userAddition = "\n## License\n\nMIT\n";
    const installed = readFileSync(join(target, "README.md"), "utf8");
    writeFileSync(join(target, "README.md"), installed + userAddition);

    const status = removeVersionSectionFromReadme(target);
    assert.strictEqual(status, "removed");
    assert.strictEqual(readFileSync(join(target, "README.md"), "utf8"), original + userAddition);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeVersionSectionFromReadme: CI-inserted standalone marker (no '---' divider) removes only the marker line", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-readme-remove-"));
  try {
    // PROJECT-COMMON-README-VERSION-UPDATE.yaml이 사용자가 이미 가진 버전 라인 위에
    // '---' 구분자 없이 마커 주석 한 줄만 끼워넣는 실제 케이스를 재현.
    const content = "# Test Project\n\n<!-- AUTO-VERSION-SECTION: DO NOT EDIT MANUALLY -->\n## Version : v1.2.0\n\nMore docs.\n";
    writeFileSync(join(target, "README.md"), content);
    assert.strictEqual(hasVersionSection(target), true);

    const status = removeVersionSectionFromReadme(target);
    assert.strictEqual(status, "removed");
    const after = readFileSync(join(target, "README.md"), "utf8");
    assert.strictEqual(after, "# Test Project\n\n## Version : v1.2.0\n\nMore docs.\n");
    assert.strictEqual(hasVersionSection(target), false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeVersionSectionFromReadme: marker block present but tail line missing (edited by user) -> skip-unexpected-format, untouched", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-readme-remove-"));
  try {
    writeFileSync(join(target, "README.md"), "# Test Project\n");
    addVersionSectionToReadme("1.0.0", target);
    // 사용자가 CHANGELOG 링크 줄을 지웠다고 가정 — 꼬리를 못 찾으면 보수적으로 아무것도 하지 않는다.
    const withSection = readFileSync(join(target, "README.md"), "utf8");
    const edited = withSection.replace("[전체 버전 기록 보기](CHANGELOG.md)\n", "");
    writeFileSync(join(target, "README.md"), edited);

    const status = removeVersionSectionFromReadme(target);
    assert.strictEqual(status, "skip-unexpected-format");
    assert.strictEqual(readFileSync(join(target, "README.md"), "utf8"), edited);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test tests/node/readme-remove.test.js`
Expected: FAIL — `hasVersionSection`/`removeVersionSectionFromReadme`가 정의되지 않음 (import 에러)

- [ ] **Step 3: `readme.js`에 최소 구현 추가**

`src/core/copy/readme.js` 1번째 줄의 import를 다음으로 교체:

```js
import { existsSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
```

파일 끝(현재 30번째 줄 `}` 뒤)에 추가:

```js

// addVersionSectionToReadme가 항상 파일 맨 끝에 붙이는 접두/접미 시퀀스.
// 접두(SECTION_PREFIX)가 있으면 마법사가 append한 "블록"이다 — 이 블록은 항상 SECTION_TAIL
// 라인으로 끝나므로, 그 지점까지만 잘라내야 그 뒤에 사용자가 나중에 덧붙인 내용(라이선스 절 등)을
// 지우지 않는다("파일 끝까지" 자르면 사용자 콘텐츠가 소실된다).
const SECTION_PREFIX = "\n---\n\n" + MARKER;
const SECTION_TAIL = "[전체 버전 기록 보기](CHANGELOG.md)\n";
// PROJECT-COMMON-README-VERSION-UPDATE.yaml(설치되는 CI)은 설치 시점에 이미 사용자가 자기 버전
// 라인을 갖고 있던 README(addVersionSectionToReadme가 'skip-version-line'으로 건너뛴 경우)에는
// '---' 구분자 없이 마커 주석 한 줄만 그 버전 라인 위에 끼워넣는다. 이 경우 버전 라인 자체는
// 사용자 소유이므로 지우지 않고 마커 주석 한 줄만 제거한다.
const MARKER_LINE = "<!-- AUTO-VERSION-SECTION: DO NOT EDIT MANUALLY -->\n";

// README.md에 마법사(또는 설치된 CI)가 추가한 흔적이 있는지 확인 (체크리스트 노출 판단용).
export function hasVersionSection(targetRoot = ".") {
  const p = join(targetRoot, "README.md");
  if (!existsSync(p)) return false;
  const content = readFileSync(p, "utf8");
  return content.includes(SECTION_PREFIX) || content.includes(MARKER_LINE);
}

// 반환: 'removed' | 'skip-no-readme' | 'skip-no-marker' | 'skip-unexpected-format'
export function removeVersionSectionFromReadme(targetRoot = ".") {
  const p = join(targetRoot, "README.md");
  if (!existsSync(p)) return "skip-no-readme";
  const content = readFileSync(p, "utf8");

  const idx = content.indexOf(SECTION_PREFIX);
  if (idx !== -1) {
    // 마법사가 append한 전체 블록 케이스 — SECTION_TAIL 라인까지만 잘라내고 그 이후는 보존한다.
    // tail을 못 찾으면(사용자가 그 줄을 지웠다면) 어디까지가 "마법사 구간"인지 알 수 없으므로
    // 안전하게 포기한다.
    const tailIdx = content.indexOf(SECTION_TAIL, idx);
    if (tailIdx === -1) return "skip-unexpected-format";
    const cutEnd = tailIdx + SECTION_TAIL.length;
    writeFileSync(p, content.slice(0, idx) + content.slice(cutEnd));
    return "removed";
  }

  const markerIdx = content.indexOf(MARKER_LINE);
  if (markerIdx !== -1) {
    // CI가 사용자의 기존 버전 라인 위에 마커만 끼워넣은 케이스 — 버전 라인은 건드리지 않는다.
    writeFileSync(p, content.slice(0, markerIdx) + content.slice(markerIdx + MARKER_LINE.length));
    return "removed";
  }

  return "skip-no-marker";
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/node/readme-remove.test.js`
Expected: PASS (7개 테스트 전부)

- [ ] **Step 5: 전체 노드 테스트 스위트 회귀 확인**

Run: `npm run test:node`
Expected: 기존 테스트 전부 PASS (기존 `addVersionSectionToReadme` 동작 미변경 확인)

- [ ] **Step 6: 커밋**

```bash
git add src/core/copy/readme.js tests/node/readme-remove.test.js
git commit -m "$(cat <<'EOF'
uninstall_신설_대화형_체크리스트_기반_완전_삭제_지원 : feat : README 버전 섹션 제거 함수(removeVersionSectionFromReadme) 추가 https://github.com/Twin-Fang/project-auto-wizard/issues/5
EOF
)"
```

---

## Task 2: `.gitignore` 자동 추가 항목 제거 함수 (`gitignore.js`)

**Files:**
- Modify: `src/core/copy/gitignore.js` (기존 56줄 — import에 `rmSync` 추가, 파일 끝에 함수 2개 추가)
- Test: `tests/node/gitignore-remove.test.js` (신규)

**Interfaces:**
- Produces: `hasAutoAddedEntries(targetRoot = ".") => boolean`, `removeAutoAddedEntriesFromGitignore(targetRoot = ".") => 'removed' | 'file-deleted' | 'skip-no-gitignore' | 'skip-not-found'`

> **검토 반영(Fable 5 정밀 검토, 2026-08-01):** README와 동일한 CRITICAL 결함 — 최초 설계는 배너부터 파일 끝까지 잘라내, 설치 이후 사용자가 `.gitignore` 끝에 추가한 항목(`.env`, `secrets/` 등)까지 삭제할 수 있었다(설계 스펙 §6이 정의한 "배너+항목 라인만" 제거와도 불일치). 아래 구현은 배너 직후 `REQUIRED_ENTRIES`와 일치하는 라인이 연속되는 동안만 제거하고, 그 뒤는 보존한다. 신규생성 파일 케이스도 완전 일치(`===`) 대신 `startsWith`로 넓혀, 사용자가 신규생성된 `.gitignore` 끝에 항목을 추가한 경우에도 마법사가 쓴 부분만 벗겨내도록 수정했다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/gitignore-remove.test.js`:

```js
// tests/node/gitignore-remove.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureGitignore, hasAutoAddedEntries, removeAutoAddedEntriesFromGitignore } from "../../src/core/copy/gitignore.js";

test("hasAutoAddedEntries: false before ensureGitignore, true after (fresh file case)", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-gitignore-remove-"));
  try {
    assert.strictEqual(hasAutoAddedEntries(target), false);
    ensureGitignore(target);
    assert.strictEqual(hasAutoAddedEntries(target), true);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeAutoAddedEntriesFromGitignore: fresh-file case deletes the whole file", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-gitignore-remove-"));
  try {
    ensureGitignore(target); // .gitignore가 없었으므로 마법사가 통째로 새로 생성
    assert.ok(existsSync(join(target, ".gitignore")));
    const status = removeAutoAddedEntriesFromGitignore(target);
    assert.strictEqual(status, "file-deleted");
    assert.ok(!existsSync(join(target, ".gitignore")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeAutoAddedEntriesFromGitignore: existing-file case removes only the banner block", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-gitignore-remove-"));
  try {
    const original = "node_modules/\ndist/\n";
    writeFileSync(join(target, ".gitignore"), original);
    ensureGitignore(target); // 기존 파일에 배너 블록만 append
    const appended = readFileSync(join(target, ".gitignore"), "utf8");
    assert.notStrictEqual(appended, original);
    assert.ok(appended.includes("project-auto-wizard: Auto-added entries"));

    const status = removeAutoAddedEntriesFromGitignore(target);
    assert.strictEqual(status, "removed");
    const after = readFileSync(join(target, ".gitignore"), "utf8");
    assert.ok(after.startsWith(original));
    assert.ok(!after.includes("project-auto-wizard: Auto-added entries"));
    assert.ok(!after.includes("/.idea"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeAutoAddedEntriesFromGitignore: no .gitignore -> skip-no-gitignore, no-op", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-gitignore-remove-"));
  try {
    assert.strictEqual(removeAutoAddedEntriesFromGitignore(target), "skip-no-gitignore");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeAutoAddedEntriesFromGitignore: .gitignore exists but no banner -> skip-not-found, untouched", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-gitignore-remove-"));
  try {
    writeFileSync(join(target, ".gitignore"), "node_modules/\n");
    const status = removeAutoAddedEntriesFromGitignore(target);
    assert.strictEqual(status, "skip-not-found");
    assert.strictEqual(readFileSync(join(target, ".gitignore"), "utf8"), "node_modules/\n");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeAutoAddedEntriesFromGitignore: preserves entries the user appended after the auto-added block", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-gitignore-remove-"));
  try {
    const original = "node_modules/\ndist/\n";
    writeFileSync(join(target, ".gitignore"), original);
    ensureGitignore(target);
    const installed = readFileSync(join(target, ".gitignore"), "utf8");
    // 설치 후 사용자가 파일 끝에 자기 항목을 추가했다고 가정 — uninstall이 이를 지우면 안 된다.
    const userAddition = ".env\nsecrets/\n";
    writeFileSync(join(target, ".gitignore"), installed + userAddition);

    const status = removeAutoAddedEntriesFromGitignore(target);
    assert.strictEqual(status, "removed");
    assert.strictEqual(readFileSync(join(target, ".gitignore"), "utf8"), original + userAddition);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("removeAutoAddedEntriesFromGitignore: fresh-file case with content appended later strips only the wizard-written prefix", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-gitignore-remove-"));
  try {
    ensureGitignore(target); // .gitignore가 없었으므로 마법사가 통째로 새로 생성
    const fresh = readFileSync(join(target, ".gitignore"), "utf8");
    const userAddition = "dist/\n";
    writeFileSync(join(target, ".gitignore"), fresh + userAddition);

    const status = removeAutoAddedEntriesFromGitignore(target);
    assert.strictEqual(status, "removed");
    assert.strictEqual(readFileSync(join(target, ".gitignore"), "utf8"), userAddition);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test tests/node/gitignore-remove.test.js`
Expected: FAIL — `hasAutoAddedEntries`/`removeAutoAddedEntriesFromGitignore`가 정의되지 않음

- [ ] **Step 3: `gitignore.js`에 최소 구현 추가**

`src/core/copy/gitignore.js` 3번째 줄의 import를 다음으로 교체:

```js
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
```

파일 끝(현재 55번째 줄 `}` 뒤)에 추가:

```js

// ensureGitignore가 기존 파일에 배너 블록을 추가할 때 항상 이 정확한 시퀀스로 시작한다
// (빈 줄 하나 + 3줄 배너). 배너 직후, REQUIRED_ENTRIES와 일치하는 라인이 연속되는 동안만
// "마법사가 추가한 항목"이다 — 그 뒤에 사용자가 나중에 추가한 항목은 절대 건드리지 않는다.
const BANNER =
  "\n" +
  "# ====================================================================\n" +
  "# project-auto-wizard: Auto-added entries\n" +
  "# ====================================================================\n";

// .gitignore에 마법사가 추가한 항목이 있는지 확인 (체크리스트 노출 판단용).
// 두 케이스: (1) 원래 없던 파일을 통째로(또는 그 뒤에 사용자가 이어 쓴 형태로) 새로 만든 경우
// (2) 기존 파일에 배너 블록을 붙인 경우.
export function hasAutoAddedEntries(targetRoot = ".") {
  const p = join(targetRoot, ".gitignore");
  if (!existsSync(p)) return false;
  const content = readFileSync(p, "utf8");
  return content.startsWith(NEW_FILE_CONTENT) || content.includes(BANNER);
}

// 반환: 'removed' | 'file-deleted' | 'skip-no-gitignore' | 'skip-not-found'
export function removeAutoAddedEntriesFromGitignore(targetRoot = ".") {
  const p = join(targetRoot, ".gitignore");
  if (!existsSync(p)) return "skip-no-gitignore";
  const content = readFileSync(p, "utf8");

  // 원래 파일이 없었는데 마법사가 통째로 만든 경우 — 그 뒤에 사용자가 이어서 추가한 내용만 보존.
  if (content.startsWith(NEW_FILE_CONTENT)) {
    const remainder = content.slice(NEW_FILE_CONTENT.length);
    if (remainder === "") {
      rmSync(p);
      return "file-deleted";
    }
    writeFileSync(p, remainder);
    return "removed";
  }

  // 기존 파일에 배너 블록이 붙은 경우 — 배너 직후 REQUIRED_ENTRIES와 일치하는 라인이 연속되는
  // 동안만 제거하고, 그 뒤(사용자가 나중에 추가한 항목)는 그대로 둔다.
  const idx = content.indexOf(BANNER);
  if (idx === -1) return "skip-not-found";
  const afterBanner = idx + BANNER.length;
  const lines = content.slice(afterBanner).split("\n");
  let consumed = 0;
  for (const line of lines) {
    const isKnownEntry = REQUIRED_ENTRIES.some((e) => normalizeGitignoreEntry(line) === normalizeGitignoreEntry(e));
    if (!isKnownEntry) break;
    consumed += line.length + 1; // +1: split이 삼킨 "\n"
  }
  writeFileSync(p, content.slice(0, idx) + content.slice(afterBanner + consumed));
  return "removed";
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/node/gitignore-remove.test.js`
Expected: PASS (7개 테스트 전부)

- [ ] **Step 5: 전체 노드 테스트 스위트 회귀 확인**

Run: `npm run test:node`
Expected: 기존 테스트 전부 PASS

- [ ] **Step 6: 커밋**

```bash
git add src/core/copy/gitignore.js tests/node/gitignore-remove.test.js
git commit -m "$(cat <<'EOF'
uninstall_신설_대화형_체크리스트_기반_완전_삭제_지원 : feat : .gitignore 자동 추가 항목 제거 함수(removeAutoAddedEntriesFromGitignore) 추가 https://github.com/Twin-Fang/project-auto-wizard/issues/5
EOF
)"
```

---

## Task 3: uninstall 코어 — `planUninstall`/`runUninstall`

**Files:**
- Create: `src/commands/uninstall.js`
- Test: `tests/node/uninstall-plan.test.js` (신규)

**Interfaces:**
- Consumes: `planRevert(payloadRoot, targetRoot)` from `./revert.js`(기존, 미변경) → `{workflows:string[], scripts:string[], coderabbit:boolean}`; `hasVersionSection`/`removeVersionSectionFromReadme` from `../core/copy/readme.js`(Task 1); `hasAutoAddedEntries`/`removeAutoAddedEntriesFromGitignore` from `../core/copy/gitignore.js`(Task 2); `PATHS` from `../core/paths.js`; `remove` from `../core/fsutil.js`
- Produces: `planUninstall(payloadRoot, targetRoot, selection) => {workflows, scripts, coderabbit, readme, gitignore, versionYml}` (읽기 전용), `runUninstall(context, payloadRoot, targetRoot, selection) => 위와 동일한 형태` (실제 삭제 수행). `selection`은 `{workflows, scripts, coderabbit, readme, gitignore, versionYml}` 형태의 boolean 6개.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/uninstall-plan.test.js`:

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

test("planUninstall: full selection reports every installed item, deletes nothing", () => {
  const target = installFixture();
  try {
    const plan = planUninstall(resolvePayloadRoot(), target, FULL_SELECTION);
    assert.ok(plan.workflows.length > 0);
    assert.ok(plan.scripts.includes("version_manager.py"));
    assert.strictEqual(plan.coderabbit, true);
    assert.strictEqual(plan.readme, true);
    assert.strictEqual(plan.gitignore, true);
    assert.strictEqual(plan.versionYml, true);
    assert.ok(existsSync(join(target, "version.yml")));
    assert.ok(existsSync(join(target, ".coderabbit.yaml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planUninstall: safe selection excludes readme/gitignore/versionYml", () => {
  const target = installFixture();
  try {
    const plan = planUninstall(resolvePayloadRoot(), target, SAFE_SELECTION);
    assert.ok(plan.workflows.length > 0);
    assert.strictEqual(plan.readme, false);
    assert.strictEqual(plan.gitignore, false);
    assert.strictEqual(plan.versionYml, false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("runUninstall: full selection removes workflows/scripts/coderabbit/readme-section/gitignore/version.yml", () => {
  const target = installFixture();
  try {
    const result = runUninstall({}, resolvePayloadRoot(), target, FULL_SELECTION);
    assert.ok(result.workflows.length > 0);
    assert.ok(!existsSync(join(target, ".github/scripts/version_manager.py")));
    assert.ok(!existsSync(join(target, ".coderabbit.yaml")));
    assert.ok(!existsSync(join(target, "version.yml")));
    assert.ok(!existsSync(join(target, ".gitignore"))); // 신규생성 케이스 -> 파일 자체 삭제
    const readme = readFileSync(join(target, "README.md"), "utf8");
    assert.ok(!readme.includes("AUTO-VERSION-SECTION"));
    assert.strictEqual(readme, "# Test Project\n");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("runUninstall: safe selection leaves readme/gitignore/version.yml untouched", () => {
  const target = installFixture();
  try {
    runUninstall({}, resolvePayloadRoot(), target, SAFE_SELECTION);
    assert.ok(!existsSync(join(target, ".github/scripts/version_manager.py")));
    assert.ok(existsSync(join(target, "version.yml")));
    assert.ok(existsSync(join(target, ".gitignore")));
    const readme = readFileSync(join(target, "README.md"), "utf8");
    assert.ok(readme.includes("AUTO-VERSION-SECTION"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planUninstall: nothing installed -> everything false/empty", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-uninstall-empty-"));
  try {
    const plan = planUninstall(resolvePayloadRoot(), target, FULL_SELECTION);
    assert.deepStrictEqual(plan.workflows, []);
    assert.deepStrictEqual(plan.scripts, []);
    assert.strictEqual(plan.coderabbit, false);
    assert.strictEqual(plan.readme, false);
    assert.strictEqual(plan.gitignore, false);
    assert.strictEqual(plan.versionYml, false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test tests/node/uninstall-plan.test.js`
Expected: FAIL — `src/commands/uninstall.js` 모듈이 존재하지 않음

- [ ] **Step 3: `uninstall.js` 최소 구현 작성**

`src/commands/uninstall.js` (신규 파일):

```js
// uninstall 모드 — revert(payload 파일명 일치분)보다 넓게, README/.gitignore/version.yml까지 선택적으로 제거.
// 대화형 체크리스트 또는 --force + --purge-* 로 항목별 opt-in. revert.js는 건드리지 않고 읽기 전용으로만 재사용한다.
import { join } from "node:path";
import { existsSync, renameSync } from "node:fs";
import { PATHS } from "../core/paths.js";
import { remove } from "../core/fsutil.js";
import { planRevert } from "./revert.js";
import { removeVersionSectionFromReadme, hasVersionSection } from "../core/copy/readme.js";
import { removeAutoAddedEntriesFromGitignore, hasAutoAddedEntries } from "../core/copy/gitignore.js";

// selection: { workflows, scripts, coderabbit, readme, gitignore, versionYml } (모두 boolean).
// 반환: 위와 동일한 키의 boolean/배열 — 실제로 제거 "대상"인지 여부(순수 함수, 아무것도 지우지 않음).
export function planUninstall(payloadRoot, targetRoot, selection) {
  const revertPlan = planRevert(payloadRoot, targetRoot);
  return {
    workflows: selection.workflows ? revertPlan.workflows : [],
    scripts: selection.scripts ? revertPlan.scripts : [],
    coderabbit: selection.coderabbit ? revertPlan.coderabbit : false,
    readme: selection.readme ? hasVersionSection(targetRoot) : false,
    gitignore: selection.gitignore ? hasAutoAddedEntries(targetRoot) : false,
    versionYml: selection.versionYml ? existsSync(join(targetRoot, PATHS.versionFile)) : false,
  };
}

// 반환: planUninstall과 동일한 형태 — 실제로 제거된 항목.
export function runUninstall(context, payloadRoot, targetRoot, selection) {
  const plan = planUninstall(payloadRoot, targetRoot, selection);
  const wfDir = join(targetRoot, PATHS.workflowsDir);
  for (const name of plan.workflows) remove(join(wfDir, name));
  for (const name of plan.scripts) remove(join(targetRoot, PATHS.scriptsDir, name));
  if (plan.coderabbit) {
    const cr = join(targetRoot, ".coderabbit.yaml");
    remove(cr);
    if (existsSync(cr + ".bak")) renameSync(cr + ".bak", cr);
  }
  if (plan.readme) removeVersionSectionFromReadme(targetRoot);
  if (plan.gitignore) removeAutoAddedEntriesFromGitignore(targetRoot);
  if (plan.versionYml) remove(join(targetRoot, PATHS.versionFile));
  return plan;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/node/uninstall-plan.test.js`
Expected: PASS (5개 테스트 전부)

- [ ] **Step 5: 전체 노드 테스트 스위트 회귀 확인**

Run: `npm run test:node`
Expected: 기존 테스트 전부 PASS

- [ ] **Step 6: 커밋**

```bash
git add src/commands/uninstall.js tests/node/uninstall-plan.test.js
git commit -m "$(cat <<'EOF'
uninstall_신설_대화형_체크리스트_기반_완전_삭제_지원 : feat : uninstall 코어 plan/run 함수(planUninstall/runUninstall) 추가 https://github.com/Twin-Fang/project-auto-wizard/issues/5
EOF
)"
```

---

## Task 4: 대화형 체크리스트 흐름 — `runUninstallFlow`

**Files:**
- Modify: `src/commands/uninstall.js` (Task 3에서 만든 파일 — import 1줄 추가 + 파일 끝에 함수 추가)
- Test: `tests/node/uninstall-flow.test.js` (신규)

**Interfaces:**
- Consumes: `CANCEL` from `../ui/prompts.js`(기존); `runUninstall`/`planUninstall`(Task 3, 같은 파일 내부 함수 재사용); `planRevert` from `./revert.js`; `hasVersionSection`/`hasAutoAddedEntries`(Task 1/2)
- Produces: `runUninstallFlow(payloadRoot, targetRoot, io) => Promise<planUninstall 반환형 | null>`. `io` 계약: `io.engineIo.multiselect({message,options,initialValues}) => Promise<string[] | CANCEL>`, `io.askYesNo(message, initial) => Promise<boolean>`, `io.note?.(text, title)`, `io.cancelMessage?.(text)`. `SAFE_ITEMS = ["workflows","scripts","coderabbit"]`(export, Task 6/7에서 재사용 가능하도록 노출)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/uninstall-flow.test.js`:

```js
// tests/node/uninstall-flow.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { runUninstallFlow } from "../../src/commands/uninstall.js";
import { CANCEL } from "../../src/ui/prompts.js";

function installFixture() {
  const target = mkdtempSync(join(tmpdir(), "paw-uninstall-flow-"));
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

function stubIo({ multiselectReturn, confirmReturn }) {
  const notes = [];
  const cancels = [];
  return {
    io: {
      engineIo: { multiselect: async () => multiselectReturn },
      askYesNo: async () => confirmReturn,
      note: (text, title) => notes.push({ text, title }),
      cancelMessage: (text) => cancels.push(text),
    },
    notes, cancels,
  };
}

test("runUninstallFlow: no items available -> notes and returns null without prompting for a choice", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-uninstall-flow-empty-"));
  try {
    const { io, notes } = stubIo({ multiselectReturn: [], confirmReturn: true });
    const result = await runUninstallFlow(resolvePayloadRoot(), target, io);
    assert.strictEqual(result, null);
    assert.ok(notes.some((n) => n.text.includes("제거할 항목이 없습니다")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("runUninstallFlow: checklist cancelled (ESC) -> nothing removed", async () => {
  const target = installFixture();
  try {
    const { io, cancels } = stubIo({ multiselectReturn: CANCEL, confirmReturn: true });
    const result = await runUninstallFlow(resolvePayloadRoot(), target, io);
    assert.strictEqual(result, null);
    assert.strictEqual(cancels.length, 1);
    assert.ok(existsSync(join(target, "version.yml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("runUninstallFlow: checklist confirmed but final confirm is 'no' -> nothing removed", async () => {
  const target = installFixture();
  try {
    const { io } = stubIo({ multiselectReturn: ["workflows", "scripts", "coderabbit"], confirmReturn: false });
    const result = await runUninstallFlow(resolvePayloadRoot(), target, io);
    assert.strictEqual(result, null);
    assert.ok(existsSync(join(target, ".github/scripts/version_manager.py")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("runUninstallFlow: selecting only readme removes just the version section", async () => {
  const target = installFixture();
  try {
    const { io } = stubIo({ multiselectReturn: ["readme"], confirmReturn: true });
    const result = await runUninstallFlow(resolvePayloadRoot(), target, io);
    assert.strictEqual(result.readme, true);
    assert.ok(existsSync(join(target, ".github/scripts/version_manager.py"))); // 미선택 항목은 유지
    assert.ok(!readFileSync(join(target, "README.md"), "utf8").includes("AUTO-VERSION-SECTION"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test tests/node/uninstall-flow.test.js`
Expected: FAIL — `runUninstallFlow`가 정의되지 않음

- [ ] **Step 3: `uninstall.js`에 최소 구현 추가**

`src/commands/uninstall.js` 상단 import 블록 마지막(`import { removeAutoAddedEntriesFromGitignore, hasAutoAddedEntries } from "../core/copy/gitignore.js";` 다음 줄)에 추가:

```js
import { CANCEL } from "../ui/prompts.js";
```

파일 끝에 추가:

```js

// ── 대화형 체크리스트 흐름 ────────────────────────────────────────────
const ITEM_DEFS = [
  { key: "workflows", label: "워크플로우 (.github/workflows/PROJECT-*.yaml)" },
  { key: "scripts", label: "스크립트 (.github/scripts/*.py)" },
  { key: "coderabbit", label: ".coderabbit.yaml" },
  { key: "readme", label: "README.md 버전 섹션 (AUTO-VERSION-SECTION)" },
  { key: "gitignore", label: ".gitignore 자동 추가 항목" },
  { key: "versionYml", label: "version.yml (버전/브랜치 설정 전체)" },
];

// 기본 체크 상태 — 설치 시 옵션(nexus/secret-backup/coderabbit)이 opt-in인 것과 대칭으로,
// 여기서는 "안전 삭제" 3종만 기본 체크하고 나머지(readme/gitignore/versionYml)는 opt-in.
export const SAFE_ITEMS = ["workflows", "scripts", "coderabbit"];

function detectAvailableItems(payloadRoot, targetRoot) {
  const revertPlan = planRevert(payloadRoot, targetRoot);
  const presence = {
    workflows: revertPlan.workflows.length > 0,
    scripts: revertPlan.scripts.length > 0,
    coderabbit: revertPlan.coderabbit,
    readme: hasVersionSection(targetRoot),
    gitignore: hasAutoAddedEntries(targetRoot),
    versionYml: existsSync(join(targetRoot, PATHS.versionFile)),
  };
  return ITEM_DEFS.filter((d) => presence[d.key]).map((d) => ({ value: d.key, label: d.label }));
}

function toSelection(checkedKeys) {
  const set = new Set(checkedKeys);
  return {
    workflows: set.has("workflows"), scripts: set.has("scripts"), coderabbit: set.has("coderabbit"),
    readme: set.has("readme"), gitignore: set.has("gitignore"), versionYml: set.has("versionYml"),
  };
}

function summarizeSelection(selection) {
  const labelOf = Object.fromEntries(ITEM_DEFS.map((d) => [d.key, d.label]));
  const chosen = Object.keys(selection).filter((k) => selection[k]).map((k) => `- ${labelOf[k]}`);
  return chosen.length ? chosen.join("\n") : "(선택된 항목 없음)";
}

function summarizeResult(result) {
  const lines = [];
  if (result.workflows.length) lines.push(`워크플로우 ${result.workflows.length}개 제거`);
  if (result.scripts.length) lines.push(`스크립트 ${result.scripts.length}개 제거`);
  if (result.coderabbit) lines.push(".coderabbit.yaml 제거");
  if (result.readme) lines.push("README.md 버전 섹션 제거");
  if (result.gitignore) lines.push(".gitignore 자동 추가 항목 제거");
  if (result.versionYml) lines.push("version.yml 제거");
  return lines.length ? lines.join("\n") : "제거된 항목이 없습니다.";
}

// io 계약: engineIo.multiselect({message,options,initialValues}), askYesNo(msg,def),
// note(text,title)?, cancelMessage(text)? — src/ui/prompts.js가 실물, 테스트는 스텁 주입.
export async function runUninstallFlow(payloadRoot, targetRoot, io) {
  const available = detectAvailableItems(payloadRoot, targetRoot);
  if (available.length === 0) {
    io.note?.("제거할 항목이 없습니다.", "완전 삭제");
    return null;
  }

  const checked = await io.engineIo.multiselect({
    message: "삭제할 항목을 선택하세요 (Space 토글, Enter 확정)",
    options: available,
    initialValues: available.map((o) => o.value).filter((v) => SAFE_ITEMS.includes(v)),
  });
  if (checked === CANCEL || !Array.isArray(checked) || checked.length === 0) {
    io.cancelMessage?.("완전 삭제를 취소했습니다.");
    return null;
  }

  const selection = toSelection(checked);
  io.note?.(summarizeSelection(selection), "삭제 예정 항목");
  const ok = await io.askYesNo("정말 삭제할까요? 되돌릴 수 없습니다.", false);
  if (ok !== true) {
    io.cancelMessage?.("완전 삭제를 취소했습니다.");
    return null;
  }

  const result = runUninstall({}, payloadRoot, targetRoot, selection);
  io.note?.(summarizeResult(result), "완전 삭제 완료");
  return result;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/node/uninstall-flow.test.js`
Expected: PASS (4개 테스트 전부)

- [ ] **Step 5: 전체 노드 테스트 스위트 회귀 확인**

Run: `npm run test:node`
Expected: 기존 테스트 전부 PASS

- [ ] **Step 6: 커밋**

```bash
git add src/commands/uninstall.js tests/node/uninstall-flow.test.js
git commit -m "$(cat <<'EOF'
uninstall_신설_대화형_체크리스트_기반_완전_삭제_지원 : feat : 대화형 체크리스트 흐름(runUninstallFlow) 추가 https://github.com/Twin-Fang/project-auto-wizard/issues/5
EOF
)"
```

---

## Task 5: `--dry-run` 미리보기 지원 (`dry-run.js`)

**Files:**
- Modify: `src/commands/dry-run.js` (기존 77줄 — import 1줄 추가, `planDryRun`/`printDryRun`에 분기 추가)
- Test: `tests/node/uninstall-dry-run.test.js` (신규)

**Interfaces:**
- Consumes: `planUninstall`(Task 3) from `./uninstall.js`
- Produces: `planDryRun("uninstall", { uninstallSelection }, payloadRoot, targetRoot) => { mode: "uninstall", uninstall: planUninstall 반환형 }`; `printDryRun(plan)`이 `mode === "uninstall"`일 때 워크플로우/스크립트/coderabbit/README/gitignore/version.yml 각각을 라인으로 출력

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/uninstall-dry-run.test.js`:

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

test("planDryRun('uninstall', ...) lists candidates without deleting anything", () => {
  const target = installFixture();
  try {
    const plan = planDryRun("uninstall", { uninstallSelection: FULL_SELECTION }, resolvePayloadRoot(), target);
    assert.strictEqual(plan.mode, "uninstall");
    assert.ok(plan.uninstall.workflows.length > 0);
    assert.strictEqual(plan.uninstall.coderabbit, true);
    assert.strictEqual(plan.uninstall.readme, true);
    assert.strictEqual(plan.uninstall.gitignore, true);
    assert.strictEqual(plan.uninstall.versionYml, true);
    assert.ok(existsSync(join(target, "version.yml")));
    assert.ok(existsSync(join(target, ".coderabbit.yaml")));
    assert.ok(existsSync(join(target, ".gitignore")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("printDryRun() for uninstall mode reports every candidate category", () => {
  const target = installFixture();
  try {
    const plan = planDryRun("uninstall", { uninstallSelection: FULL_SELECTION }, resolvePayloadRoot(), target);
    const originalLog = console.log;
    let output = "";
    console.log = (msg) => { output += msg; };
    try {
      printDryRun(plan);
    } finally {
      console.log = originalLog;
    }
    assert.ok(output.includes("제거될 워크플로우"));
    assert.ok(output.includes(".coderabbit.yaml"));
    assert.ok(output.includes("README.md 버전 섹션"));
    assert.ok(output.includes(".gitignore 자동 추가 항목"));
    assert.ok(output.includes("version.yml"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test tests/node/uninstall-dry-run.test.js`
Expected: FAIL — `planDryRun("uninstall", ...)` 이 `plan.uninstall`을 만들지 않음 (undefined 관련 assertion 실패)

- [ ] **Step 3: `dry-run.js`에 최소 구현 추가**

`src/commands/dry-run.js` 2번째 줄(헤더 주석)을 교체 — 기존:

```js
// full/version/workflows/revert 4개 모드 전체 지원.
```

다음으로 교체:

```js
// full/version/workflows/revert/uninstall 5개 모드 전체 지원.
```

`src/commands/dry-run.js` 7번째 줄(`import { planRevert } from "./revert.js";`) 다음에 추가:

```js
import { planUninstall } from "./uninstall.js";
```

`planDryRun` 함수 내 `if (mode === "revert") return { mode, revert: planRevert(payloadRoot, targetRoot) };` 줄 바로 다음에 추가:

```js
  if (mode === "uninstall") {
    return { mode, uninstall: planUninstall(payloadRoot, targetRoot, context.uninstallSelection) };
  }
```

`printDryRun` 함수의 `if (plan.mode === "revert") { ... } else { ... }` 구조를 `else if`로 확장 — 기존:

```js
  if (plan.mode === "revert") {
    const r = plan.revert;
    lines.push(`제거될 워크플로우 (${r.workflows.length}개):`);
    for (const f of r.workflows) lines.push(`  - ${f}`);
    lines.push(`제거될 스크립트 (${r.scripts.length}개):`);
    for (const f of r.scripts) lines.push(`  - ${f}`);
    if (r.coderabbit) lines.push("제거될 파일: .coderabbit.yaml");
  } else {
```

다음으로 교체:

```js
  if (plan.mode === "revert") {
    const r = plan.revert;
    lines.push(`제거될 워크플로우 (${r.workflows.length}개):`);
    for (const f of r.workflows) lines.push(`  - ${f}`);
    lines.push(`제거될 스크립트 (${r.scripts.length}개):`);
    for (const f of r.scripts) lines.push(`  - ${f}`);
    if (r.coderabbit) lines.push("제거될 파일: .coderabbit.yaml");
  } else if (plan.mode === "uninstall") {
    const u = plan.uninstall;
    lines.push(`제거될 워크플로우 (${u.workflows.length}개):`);
    for (const f of u.workflows) lines.push(`  - ${f}`);
    lines.push(`제거될 스크립트 (${u.scripts.length}개):`);
    for (const f of u.scripts) lines.push(`  - ${f}`);
    if (u.coderabbit) lines.push("제거될 파일: .coderabbit.yaml");
    if (u.readme) lines.push("제거될 항목: README.md 버전 섹션 (AUTO-VERSION-SECTION)");
    if (u.gitignore) lines.push("제거될 항목: .gitignore 자동 추가 항목");
    if (u.versionYml) lines.push("제거될 파일: version.yml");
  } else {
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/node/uninstall-dry-run.test.js`
Expected: PASS (2개 테스트 전부)

- [ ] **Step 5: 전체 노드 테스트 스위트 회귀 확인**

Run: `npm run test:node`
Expected: 기존 테스트 전부 PASS (특히 `tests/node/dry-run.test.js`의 `revert`/`full`/`version` 분기 미변경 확인)

- [ ] **Step 6: 커밋**

```bash
git add src/commands/dry-run.js tests/node/uninstall-dry-run.test.js
git commit -m "$(cat <<'EOF'
uninstall_신설_대화형_체크리스트_기반_완전_삭제_지원 : feat : --dry-run에 uninstall 모드 미리보기 지원 추가 https://github.com/Twin-Fang/project-auto-wizard/issues/5
EOF
)"
```

---

## Task 6: CLI 비대화형 배선 (`args.js` + `index.js` + `help.js`)

**Files:**
- Modify: `src/cli/args.js` (기존 101줄 — `result` 초기값 3개 필드 + `switch` 케이스 3개 추가)
- Modify: `src/index.js` (기존 196줄 — import 2개 추가, revert 분기 뒤에 uninstall 분기 추가)
- Modify: `src/cli/help.js` (기존 33줄 — 모드 설명·플래그 설명·예시 추가)
- Test: `tests/node/uninstall-cli.test.js` (신규)

**Interfaces:**
- Consumes: `runUninstall`, `runUninstallFlow`(Task 3/4) from `./commands/uninstall.js`; `planDryRun`, `printDryRun`(Task 5, 기존 import 그대로) from `./commands/dry-run.js`; `prompts` module(기존) from `./ui/prompts.js`
- Produces: `parseArgs()` 결과에 `purgeReadme`, `purgeGitignore`, `purgeVersion` (boolean, 기본 false) 추가. CLI에서 `--mode uninstall` 지원(`--dry-run`/`--force`/TTY/비TTY 4갈래).

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/uninstall-cli.test.js`:

```js
// tests/node/uninstall-cli.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "../../src/cli/args.js";
import { run } from "../../src/index.js";

test("parseArgs: --purge-readme/--purge-gitignore/--purge-version default to false", () => {
  const opts = parseArgs(["--mode", "uninstall", "--force"]);
  assert.strictEqual(opts.purgeReadme, false);
  assert.strictEqual(opts.purgeGitignore, false);
  assert.strictEqual(opts.purgeVersion, false);
});

test("parseArgs: purge flags set their respective booleans", () => {
  const opts = parseArgs(["--mode", "uninstall", "--force", "--purge-readme", "--purge-gitignore", "--purge-version"]);
  assert.strictEqual(opts.purgeReadme, true);
  assert.strictEqual(opts.purgeGitignore, true);
  assert.strictEqual(opts.purgeVersion, true);
});

function emptyTarget() {
  return mkdtempSync(join(tmpdir(), "paw-uninstall-cli-"));
}

test("run(): --mode uninstall --force removes only workflows/scripts/coderabbit by default", async () => {
  const target = emptyTarget();
  try {
    writeFileSync(join(target, "README.md"), "# Test Project\n");
    await run(["--mode", "full", "--force", "--type", "node", "--coderabbit"], {
      cwd: target, clock: { now: "2026-08-01 00:00:00", today: "2026-08-01" },
    });
    const code = await run(["--mode", "uninstall", "--force"], { cwd: target });
    assert.strictEqual(code, 0);
    assert.ok(!existsSync(join(target, ".github/scripts/version_manager.py")));
    assert.ok(!existsSync(join(target, ".coderabbit.yaml")));
    assert.ok(existsSync(join(target, "version.yml")));
    assert.ok(existsSync(join(target, ".gitignore")));
    assert.ok(readFileSync(join(target, "README.md"), "utf8").includes("AUTO-VERSION-SECTION"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --mode uninstall --force --purge-readme --purge-gitignore --purge-version removes everything", async () => {
  const target = emptyTarget();
  try {
    writeFileSync(join(target, "README.md"), "# Test Project\n");
    await run(["--mode", "full", "--force", "--type", "node", "--coderabbit"], {
      cwd: target, clock: { now: "2026-08-01 00:00:00", today: "2026-08-01" },
    });
    const code = await run(
      ["--mode", "uninstall", "--force", "--purge-readme", "--purge-gitignore", "--purge-version"],
      { cwd: target },
    );
    assert.strictEqual(code, 0);
    assert.ok(!existsSync(join(target, "version.yml")));
    assert.ok(!existsSync(join(target, ".coderabbit.yaml")));
    assert.ok(!existsSync(join(target, ".gitignore")));
    assert.ok(!readFileSync(join(target, "README.md"), "utf8").includes("AUTO-VERSION-SECTION"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --mode uninstall --dry-run writes nothing even without --force", async () => {
  const target = emptyTarget();
  try {
    await run(["--mode", "full", "--force", "--type", "node"], {
      cwd: target, clock: { now: "2026-08-01 00:00:00", today: "2026-08-01" },
    });
    const code = await run(["--mode", "uninstall", "--dry-run"], { cwd: target });
    assert.strictEqual(code, 0);
    assert.ok(existsSync(join(target, ".github/scripts/version_manager.py")));
    assert.ok(existsSync(join(target, "version.yml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --mode uninstall without --force in a non-interactive environment errors", async () => {
  const target = emptyTarget();
  try {
    const code = await run(["--mode", "uninstall"], { cwd: target });
    assert.strictEqual(code, 1);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test tests/node/uninstall-cli.test.js`
Expected: FAIL — `purgeReadme` 등이 `undefined`이고, `--mode uninstall`이 아무 동작도 하지 않아(알 수 없는 모드) 파일이 삭제되지 않음

- [ ] **Step 3: `args.js`/`index.js`/`help.js`에 최소 구현 추가**

`src/cli/args.js`의 `result` 객체 초기값에서 `dryRun: false,` 줄 다음에 추가:

```js
    purgeReadme: false,       // --purge-readme: uninstall --force 시 README 버전 섹션도 제거
    purgeGitignore: false,    // --purge-gitignore: uninstall --force 시 .gitignore 자동 추가 항목도 제거
    purgeVersion: false,      // --purge-version: uninstall --force 시 version.yml도 제거
```

`switch (a) {` 블록의 `case "--dry-run": result.dryRun = true; break;` 다음에 추가:

```js
      case "--purge-readme": result.purgeReadme = true; break;
      case "--purge-gitignore": result.purgeGitignore = true; break;
      case "--purge-version": result.purgeVersion = true; break;
```

`src/index.js` 상단 import 블록의 `import { runRevert } from "./commands/revert.js";` 다음 줄에 추가:

```js
import { runUninstall, runUninstallFlow } from "./commands/uninstall.js";
import * as prompts from "./ui/prompts.js";
```

`src/index.js`의 revert 분기(`if (opts.mode === "revert") { ... }`)가 끝나는 `}` 바로 다음, `// status 모드` 주석 이전에 추가:

```js

  // uninstall 모드 — revert보다 넓게 README·gitignore·version.yml까지 선택적으로 제거.
  if (opts.mode === "uninstall") {
    const safeSelection = {
      workflows: true, scripts: true, coderabbit: true,
      readme: opts.purgeReadme, gitignore: opts.purgeGitignore, versionYml: opts.purgeVersion,
    };
    if (opts.dryRun) {
      printDryRun(planDryRun("uninstall", { uninstallSelection: safeSelection }, payload, cwd));
      return 0;
    }
    if (opts.force) {
      const r = runUninstall({}, payload, cwd, safeSelection);
      const removed = [
        `워크플로우 ${r.workflows.length}개`, `스크립트 ${r.scripts.length}개`,
        r.coderabbit && ".coderabbit.yaml", r.readme && "README 버전 섹션",
        r.gitignore && ".gitignore 자동 추가 항목", r.versionYml && "version.yml",
      ].filter(Boolean).join(", ");
      console.error(`제거됨 — ${removed}`);
      return 0;
    }
    if (!process.stdout.isTTY) {
      console.error("비대화형 환경에서는 --force 옵션이 필요합니다.");
      return 1;
    }
    await runUninstallFlow(payload, cwd, prompts);
    return 0;
  }
```

`src/index.js`의 대화형 모드 분기(63~74행 부근) 안, `--dry-run`/비TTY 에러 메시지 2곳을 교체 — 기존:

```js
      console.error("--dry-run은 --mode <full|version|workflows|revert>와 함께 사용하세요 (대화형 모드에서는 지원하지 않습니다).");
```

다음으로 교체:

```js
      console.error("--dry-run은 --mode <full|version|workflows|revert|uninstall>와 함께 사용하세요 (대화형 모드에서는 지원하지 않습니다).");
```

기존:

```js
      console.error("대화형 입력이 불가능한 환경입니다. --mode <full|version|workflows|revert> 와 --force 를 지정하세요.");
```

다음으로 교체:

```js
      console.error("대화형 입력이 불가능한 환경입니다. --mode <full|version|workflows|revert|uninstall> 와 --force 를 지정하세요.");
```

`src/cli/help.js`의 `-m, --mode MODE` 줄부터 3줄을 교체 — 기존:

```
  -m, --mode MODE          통합 모드 (full | version | workflows | revert | status | doctor)
                           기본: interactive (대화형). revert = 설치물 제거(되돌리기)
                           status = 설치 상태·드리프트 확인(읽기 전용). doctor = 환경 진단(읽기 전용)
```

다음으로 교체:

```
  -m, --mode MODE          통합 모드 (full | version | workflows | revert | uninstall | status | doctor)
                           기본: interactive (대화형). revert = 설치물 제거(되돌리기)
                           uninstall = 완전 삭제(대화형 체크리스트, --force 시 --purge-*로 opt-in)
                           status = 설치 상태·드리프트 확인(읽기 전용). doctor = 환경 진단(읽기 전용)
```

`--dry-run` 옵션 설명 줄을 교체 — 기존:

```
      --dry-run            실제 파일 변경 없이 무엇이 바뀔지만 미리 보여줌 (full/version/workflows/revert 전체 지원)
```

다음으로 교체:

```
      --dry-run            실제 파일 변경 없이 무엇이 바뀔지만 미리 보여줌 (full/version/workflows/revert/uninstall 전체 지원)
      --purge-readme        --mode uninstall --force 시 README.md 버전 섹션도 제거
      --purge-gitignore     --mode uninstall --force 시 .gitignore 자동 추가 항목도 제거
      --purge-version       --mode uninstall --force 시 version.yml도 제거
```

예시 목록 마지막 줄(`  npx project-auto-wizard --mode full --force --type node --dry-run`) 다음에 추가:

```
  npx project-auto-wizard --mode uninstall --force --purge-readme --purge-gitignore --purge-version
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/node/uninstall-cli.test.js`
Expected: PASS (6개 테스트 전부)

- [ ] **Step 5: 전체 노드 테스트 스위트 회귀 확인**

Run: `npm run test:node`
Expected: 기존 테스트 전부 PASS (특히 `dry-run-cli.test.js`의 기존 revert/full 분기 미변경 확인)

- [ ] **Step 6: 커밋**

```bash
git add src/cli/args.js src/index.js src/cli/help.js tests/node/uninstall-cli.test.js
git commit -m "$(cat <<'EOF'
uninstall_신설_대화형_체크리스트_기반_완전_삭제_지원 : feat : CLI --mode uninstall 및 --purge-* 플래그 배선 https://github.com/Twin-Fang/project-auto-wizard/issues/5
EOF
)"
```

---

## Task 7: 대화형 마법사 배선 (`prompts.js` + `interactive.js`)

**Files:**
- Modify: `src/ui/prompts.js` (기존 99줄 — `selectMode()` 옵션 1개 추가)
- Modify: `src/commands/interactive.js` (기존 246줄 — import 1개, mode 분기 1개 추가)
- Test: `tests/node/interactive-mode-uninstall.test.js` (신규)

**Interfaces:**
- Consumes: `runUninstallFlow`(Task 4) from `./uninstall.js`
- Produces: `selectMode()`가 `"uninstall"`을 반환할 수 있게 됨. `runInteractive()`에서 `mode === "uninstall"`이면 `runUninstallFlow`로 위임 후 종료.

> **검토 반영(Fable 5 정밀 검토, 2026-08-01):** 최초 설계는 `runUninstallFlow`의 반환값(취소/항목없음 시 `null`)을 무시하고 항상 "완전 삭제를 마쳤습니다" outro를 출력했다 — 사용자가 최종 확인에서 "아니오"를 눌러도 삭제가 완료된 것처럼 보이는 HIGH 등급 메시지 버그. 아래 구현은 반환값이 있을 때만(=실제로 무언가 지웠을 때만) outro를 출력한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/interactive-mode-uninstall.test.js`:

```js
// tests/node/interactive-mode-uninstall.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { runInteractive } from "../../src/commands/interactive.js";

function installFixture() {
  const target = mkdtempSync(join(tmpdir(), "paw-interactive-uninstall-"));
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

function stubIo({ multiselectReturn, confirmReturn }) {
  const outros = [];
  return {
    io: {
      selectMode: async () => "uninstall",
      engineIo: { multiselect: async () => multiselectReturn },
      askYesNo: async () => confirmReturn,
      note: () => {},
      cancelMessage: () => {},
      outro: (text) => outros.push(text),
    },
    outros,
  };
}

test("runInteractive: selecting 완전 삭제 then confirming removes the checked items", async () => {
  const target = installFixture();
  try {
    const { io, outros } = stubIo({ multiselectReturn: ["workflows", "scripts", "coderabbit"], confirmReturn: true });
    const code = await runInteractive({}, { cwd: target, io });
    assert.strictEqual(code, 0);
    assert.ok(!existsSync(join(target, ".github/scripts/version_manager.py")));
    assert.ok(!existsSync(join(target, ".coderabbit.yaml")));
    assert.ok(existsSync(join(target, "version.yml"))); // readme/gitignore/versionYml 미선택 -> 보존
    assert.ok(outros.some((t) => t.includes("완전 삭제")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("runInteractive: declining the final uninstall confirm leaves everything installed and skips the completion outro", async () => {
  const target = installFixture();
  try {
    const { io, outros } = stubIo({ multiselectReturn: ["workflows"], confirmReturn: false });
    const code = await runInteractive({}, { cwd: target, io });
    assert.strictEqual(code, 0);
    assert.ok(existsSync(join(target, ".github/scripts/version_manager.py")));
    assert.deepStrictEqual(outros, []); // 취소했는데 "완전 삭제를 마쳤습니다"가 출력되면 안 됨
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test tests/node/interactive-mode-uninstall.test.js`
Expected: FAIL — `runInteractive`가 `mode === "uninstall"`을 처리하지 않아, breaking-check/감지 경로로 빠지며 스텁 io에 없는 메서드(`banner`/`detectionLog` 등은 optional이라 통과하지만 `askYesNo` 등 이후 흐름에서 예외 또는 잘못된 동작) 발생 — 최소한 워크플로우가 제거되지 않아 assertion 실패

- [ ] **Step 3: `prompts.js`/`interactive.js`에 최소 구현 추가**

`src/ui/prompts.js`의 `selectMode()` 내 `options` 배열 마지막 항목(`{ value: "revert", label: "되돌리기 — 마법사가 설치한 워크플로우·스크립트 제거" },`) 다음에 추가:

```js
      { value: "uninstall", label: "완전 삭제 — 마법사가 설치·수정한 모든 항목 제거(확인 후, README·gitignore·version.yml 포함)" },
```

`src/commands/interactive.js` 상단 import 블록의 `import { runRevert } from "./revert.js";` 다음 줄에 추가:

```js
import { runUninstallFlow } from "./uninstall.js";
```

`runInteractive()` 내 revert 분기(`if (mode === "revert") { ... }`)가 끝나는 `}` 바로 다음, `// Breaking Changes 게이트` 주석 이전에 추가:

```js

  // uninstall 모드 — 대화형 체크리스트로 항목별 opt-in 후 삭제. 감지·breaking 게이트 불필요.
  // runUninstallFlow는 취소/항목없음 시 null을 반환한다 — 그때는 완료 outro를 찍지 않는다.
  if (mode === "uninstall") {
    const result = await runUninstallFlow(payload, cwd, io);
    if (result) io.outro?.("완전 삭제를 마쳤습니다.");
    return 0;
  }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/node/interactive-mode-uninstall.test.js`
Expected: PASS (2개 테스트 전부)

- [ ] **Step 5: 전체 노드 테스트 스위트 회귀 확인**

Run: `npm run test:node`
Expected: 기존 테스트 전부 PASS

- [ ] **Step 6: 커밋**

```bash
git add src/ui/prompts.js src/commands/interactive.js tests/node/interactive-mode-uninstall.test.js
git commit -m "$(cat <<'EOF'
uninstall_신설_대화형_체크리스트_기반_완전_삭제_지원 : feat : 대화형 마법사 최상위 메뉴에 완전 삭제 옵션 배선 https://github.com/Twin-Fang/project-auto-wizard/issues/5
EOF
)"
```

---

## Task 8: README 문서화 + 전체 테스트 스위트 최종 확인

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: 없음 (문서만)
- Produces: 없음 (문서만)

- [ ] **Step 1: "완전 삭제" 절 추가**

`README.md`의 "### 되돌리기(`--mode revert`)" 절(`npx project-auto-wizard --mode revert는 payload가 설치한...` 문단이 끝나는 지점, `## API 키 0개 AI` 절 바로 이전) 뒤에 추가:

```markdown

### 완전 삭제(`--mode uninstall`)

`npx project-auto-wizard --mode uninstall`은 `revert`보다 넓게 제거합니다 — 워크플로우·스크립트·`.coderabbit.yaml`은 물론, README.md의 `AUTO-VERSION-SECTION` 버전 섹션과 `.gitignore`에 자동 추가된 항목, `version.yml`까지 선택적으로 제거할 수 있습니다.

- **대화형(TTY)**: 실제로 설치된 항목만 체크리스트로 보여줍니다. 워크플로우/스크립트/`.coderabbit.yaml`은 기본 체크, README·`.gitignore`·`version.yml`은 opt-in입니다. 선택 후 최종 확인(기본 "아니오")을 거쳐야 실제로 삭제됩니다.
- **비대화형(`--force`)**: 워크플로우·스크립트·`.coderabbit.yaml`만 기본 삭제합니다. README·`.gitignore`·`version.yml`까지 지우려면 `--purge-readme`/`--purge-gitignore`/`--purge-version`을 함께 지정하세요.
- `--dry-run`과 함께 쓰면 무엇이 지워질지 미리 볼 수 있습니다.

```bash
npx project-auto-wizard --mode uninstall                 # 대화형 체크리스트
npx project-auto-wizard --mode uninstall --force         # 워크플로우·스크립트·coderabbit만 안전 삭제
npx project-auto-wizard --mode uninstall --force --purge-readme --purge-gitignore --purge-version  # 완전 삭제
```
```

- [ ] **Step 2: 옵션 표에 `uninstall`/`--purge-*` 추가**

`README.md`의 옵션 목록에서 다음 줄:

```
  -m, --mode MODE          full | version | workflows | revert | status | doctor  (기본: 대화형)
```

다음으로 교체:

```
  -m, --mode MODE          full | version | workflows | revert | uninstall | status | doctor  (기본: 대화형)
```

같은 옵션 목록의 `      --dry-run            실제 파일 변경 없이 무엇이 바뀔지만 미리 보여줌` 줄 다음에 추가:

```
      --purge-readme        --mode uninstall --force 시 README.md 버전 섹션도 제거
      --purge-gitignore     --mode uninstall --force 시 .gitignore 자동 추가 항목도 제거
      --purge-version       --mode uninstall --force 시 version.yml도 제거
```

- [ ] **Step 3: 전체 테스트 스위트 최종 확인**

Run: `npm test`
Expected: `npm run test:node`(Node 전체 — 이번에 추가한 6개 파일 포함) + `npm run test:py` 전부 PASS

- [ ] **Step 4: 커밋**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
uninstall_신설_대화형_체크리스트_기반_완전_삭제_지원 : docs : README에 완전 삭제(--mode uninstall) 절 및 --purge-* 옵션 문서화 https://github.com/Twin-Fang/project-auto-wizard/issues/5
EOF
)"
```

---

## Self-Review 결과

- **스펙 커버리지**: `docs/superpowers/specs/2026-08-01-uninstall-mode-design.md`의 §3(파일 구조)~§8(테스트 계획)이 Task 1~8과 1:1로 대응됨. §9의 5가지 결정 사항(진입 경로 옵션 B, 백업 없음, version.yml 전체 삭제, CLI 게이트, gitignore 2케이스)이 각각 Task 6/7(진입경로), Task 1/2(백업 없음), Task 3(version.yml 삭제), Task 6(게이트), Task 2(gitignore 케이스)에 반영됨.
- **플레이스홀더 스캔**: 전 태스크 코드 블록에 `TBD`/`TODO`/"나중에" 표현 없음. 모든 스텝이 실행 가능한 실제 코드.
- **타입/시그니처 일관성**: `selection`/`plan` 객체의 6개 키(`workflows, scripts, coderabbit, readme, gitignore, versionYml`)가 Task 3(정의)→Task 4(재사용)→Task 5(dry-run 소비)→Task 6(CLI 소비)에서 동일하게 사용됨. `runUninstallFlow(payloadRoot, targetRoot, io)` 시그니처가 Task 4(정의)→Task 6(index.js에서 `prompts` 전달)→Task 7(interactive.js에서 `io` 전달)까지 일관됨.

## Fable 5 정밀 검토 반영 이력 (2026-08-01)

계획 최초 작성 후 Fable 5 모델로 별도 에이전트를 띄워 스펙·계획·실제 소스(`readme.js`/`gitignore.js`/`revert.js`/`index.js`/`interactive.js`/`readline-engine.js`/설치되는 CI 워크플로우 등)를 대조 검토했다. 발견된 문제와 반영 결과:

| 등급 | 문제 | 반영 위치 | 조치 |
|---|---|---|---|
| CRITICAL | README 제거가 마커부터 "파일 끝까지" 잘라내 설치 이후 사용자가 덧붙인 콘텐츠(라이선스 절 등)까지 삭제될 수 있음 | Task 1 | `SECTION_TAIL`까지만 바운딩해서 제거하도록 수정 + 회귀 테스트 추가 |
| CRITICAL | `.gitignore` 제거도 배너부터 파일 끝까지 잘라내 설치 이후 사용자가 추가한 항목(`.env` 등)까지 삭제될 수 있음(설계 스펙 §6과도 불일치) | Task 2 | 배너 직후 `REQUIRED_ENTRIES`와 일치하는 라인만 소비하도록 수정 + 신규생성 케이스도 `startsWith`로 확장 + 회귀 테스트 추가 |
| HIGH | 설치되는 `PROJECT-COMMON-README-VERSION-UPDATE.yaml` CI가 사용자 소유 버전 라인 위에 `---` 구분자 없이 마커 주석만 끼워넣는 실제 케이스를 감지·제거하지 못함 | Task 1 | `MARKER_LINE` 단독 케이스 감지·제거 로직 추가(버전 라인 자체는 보존) + 테스트 추가 |
| HIGH | 대화형 흐름에서 삭제를 취소해도 "완전 삭제를 마쳤습니다" outro가 무조건 출력됨 | Task 7 | `runUninstallFlow` 반환값이 있을 때만 outro 출력하도록 수정 + 테스트에 outro 미출력 검증 추가 |
| MEDIUM | `dry-run.js`/`help.js`/`index.js`의 안내 문구가 uninstall을 언급하지 않음 | Task 5, 6 | 헤더 주석·`--dry-run` 설명·비TTY/대화형 에러 메시지에 uninstall 추가 |

검토에서 "문제 없음"으로 확인된 부분(재검증 불필요): `planRevert` 재사용 안전성, coderabbit `.bak` 복원 로직 일치, CLI 4갈래 게이트가 감지 파이프라인보다 항상 먼저 `return`하는지, `interactive.js` 분기 위치, `io` 계약 충족 여부, 각 태스크의 테스트 픽스처가 기존 테스트 파일들과 시그니처가 일치하는지, 태스크 순서대로 실행했을 때 중간에 `npm run test:node`가 깨지는 시점이 없는지, import 순환 참조 없음.

의도적으로 반영하지 않은 MEDIUM/저위험 항목(스코프 초과로 판단): 코더래빗 삭제 루프가 `revert.js`와 중복되는 것(구조적 결정 — `revert.js` 미수정 원칙 유지가 우선), 사용자가 `.coderabbit.yaml`을 수정했거나 신규생성 `.gitignore`를 편집한 경우 체크리스트에서 안내 없이 조용히 제외되는 것(기능은 안전하게 보수적으로 동작하므로 이번 이슈 범위에서는 허용, 필요 시 후속 이슈로 분리).

---

**Plan complete and saved to `docs/superpowers/plans/2026-08-01-uninstall-mode-implementation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
