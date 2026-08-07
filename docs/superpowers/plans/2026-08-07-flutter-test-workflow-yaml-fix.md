# Flutter 테스트 워크플로우 YAML 수정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-TEST-APK.yaml`와 `PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml`을 유효한 YAML로 고치고, 같은 버그 클래스(heredoc이 블록 스칼라를 이탈)의 재발을 막는 자체 검사기를 테스트 스위트에 추가한다.

**Architecture:** `tests/node/payload-yaml.test.js`에 순수 JS로 작성한 블록 스칼라 들여쓰기 검사기(`findBlockScalarIndentationViolations`)를 추가해 `payload/workflows/**/*.y*ml` 전체를 스캔하고, 두 파일의 heredoc 본문·종료자 들여쓰기를 블록 스칼라 기준선에 맞춰 고친다. 외부 라이브러리는 도입하지 않는다.

**Tech Stack:** Node.js 내장 `node:test`/`node:assert`, 순수 JS(정규식 기반) 검사기. `js-yaml`은 검증 전용으로만 로컬에서 1회 사용하고 리포지토리에 추가하지 않는다.

## Global Constraints

- **무의존성 정책 유지**: `package.json`에 새 `dependencies`/`devDependencies`를 추가하지 않는다 (`package-lock.json` 없음, CI에 install 단계 없음 — `.github/workflows/CI.yaml` 주석 참고).
- **커밋 메시지는 한국어로 작성**하고 Conventional Commits 타입 접두사(영어)를 사용한다 (`fix:`, `test:` 등) — 프로젝트 `CLAUDE.md` 규칙.
- **heredoc 내용은 한 글자도 바꾸지 않는다** — 들여쓰기만 조정한다. YAML이 블록 스칼라의 공통 들여쓰기를 제거하고 쉘에 넘기므로, 쉘이 실제로 보는 문자열은 수정 전후 동일해야 한다(특히 `<< EOF`처럼 `-` 없는 heredoc은 종료자 줄에 leading whitespace가 있으면 안 된다는 bash 규칙에 유의).
- **`node:test` 스타일 유지**: 새 프레임워크(mocha, jest 등)를 도입하지 않는다. 기존 `tests/node/payload-yaml.test.js`의 스타일(단일 파일, `test()`+`assert` 인라인)을 그대로 따른다.
- 이슈 #40 범위 밖(트래킹 이슈 #37 산하 #41, #42 등)은 다루지 않는다.

---

### Task 1: 블록 스칼라 들여쓰기 검사기 추가 + 자체 단위 테스트

이 태스크는 실제 payload 파일을 건드리지 않는다. 순수 함수와, 인라인 문자열 픽스처로 그 함수의 정확성을 증명하는 3개 테스트만 추가한다. 완료 후 이 태스크만으로도 전체 테스트가 GREEN 상태여야 한다.

**Files:**
- Modify: `tests/node/payload-yaml.test.js:39-47` (기존 "no .sh script references" 테스트와 "AUTO-CHANGELOG-CONTROL" 섹션 사이에 새 섹션 삽입)

**Interfaces:**
- Produces: `findBlockScalarIndentationViolations(text: string): Array<{ line: number, content: string }>` — 이 파일 안에서만 쓰는 지역 함수(export하지 않음). Task 2가 이 함수를 같은 파일 안에서 그대로 호출한다. 1-indexed 줄 번호를 반환한다.

- [ ] **Step 1: 검사기 함수 + 3개 단위 테스트를 삽입한다**

`tests/node/payload-yaml.test.js`에서 아래 old_string(39~47번째 줄, "no .sh script references in payload" 테스트의 닫는 `});`부터 "AUTO-CHANGELOG-CONTROL" 배너 주석까지)을 찾아 new_string으로 교체한다.

old_string:
```js
test("no .sh script references in payload", () => {
  for (const f of files) {
    assert.ok(!readFileSync(f, "utf8").includes("version_manager.sh"), f);
  }
});

// ---------------------------------------------------------------
// AUTO-CHANGELOG-CONTROL: summary engine chain rewrite (Task 8)
// ---------------------------------------------------------------
```

new_string:
```js
test("no .sh script references in payload", () => {
  for (const f of files) {
    assert.ok(!readFileSync(f, "utf8").includes("version_manager.sh"), f);
  }
});

// ---------------------------------------------------------------
// #40: heredoc이 블록 스칼라(`run: |`)를 이탈해 YAML 파싱이 깨지는
// 회귀를 막는 가드. 완전한 YAML 파서가 아니라, "블록 스칼라 본문이
// 컬럼 0 등으로 갑자기 얕아지는" 이번 버그 클래스에 특화된 검사다.
// ---------------------------------------------------------------
const COMMENT_LINE = /^\s*#/;
const STRUCTURAL_RESUME = /^\s*(-\s|[A-Za-z_][\w./-]*:(\s|$))/;

function findBlockScalarIndentationViolations(text) {
  const lines = text.split("\n");
  const violations = [];
  let keyIndent = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const indent = line.match(/^ */)[0].length;

    if (keyIndent !== null) {
      if (indent > keyIndent) continue;
      const looksStructural =
        COMMENT_LINE.test(line) || (indent > 0 && STRUCTURAL_RESUME.test(line));
      if (!looksStructural) violations.push({ line: i + 1, content: line });
      keyIndent = null;
    }

    if (keyIndent === null && !line.trim().startsWith("#")) {
      const opener = line.match(/^(\s*)\S.*:\s*[|>][+-]?\s*$/);
      if (opener) keyIndent = opener[1].length;
    }
  }

  return violations;
}

test("findBlockScalarIndentationViolations는 컬럼 0으로 이탈한 heredoc 본문을 잡아낸다", () => {
  const fixture = [
    "jobs:",
    "  test:",
    "    steps:",
    "      - name: Broken step",
    "        run: |",
    '          echo "start"',
    "storeFile=oops",
    '          echo "end"',
  ].join("\n");
  const violations = findBlockScalarIndentationViolations(fixture);
  assert.strictEqual(violations.length, 1);
  assert.strictEqual(violations[0].line, 7);
});

test("findBlockScalarIndentationViolations는 올바르게 들여쓴 heredoc에 오탐하지 않는다", () => {
  const fixture = [
    "jobs:",
    "  test:",
    "    steps:",
    "      - name: OK step",
    "        run: |",
    "          cat > file.txt << EOF",
    "          content line",
    "          EOF",
    "      - name: Next step",
    "        run: echo done",
  ].join("\n");
  assert.strictEqual(findBlockScalarIndentationViolations(fixture).length, 0);
});

test("findBlockScalarIndentationViolations는 같은 스텝의 형제 키(if: 등)로 끝나는 블록 스칼라에 오탐하지 않는다", () => {
  const fixture = [
    "jobs:",
    "  test:",
    "    steps:",
    "      - name: Step with if after run",
    "        run: |",
    "          echo hi",
    "        if: always()",
  ].join("\n");
  assert.strictEqual(findBlockScalarIndentationViolations(fixture).length, 0);
});

// ---------------------------------------------------------------
// AUTO-CHANGELOG-CONTROL: summary engine chain rewrite (Task 8)
// ---------------------------------------------------------------
```

- [ ] **Step 2: 새로 추가한 3개 테스트만 실행해 통과를 확인한다**

Run: `node --test tests/node/payload-yaml.test.js`
Expected: 새로 추가한 3개 테스트(`findBlockScalarIndentationViolations는 ...`)를 포함해 파일 내 모든 테스트가 PASS. (아직 payload YAML 파일은 건드리지 않았으므로 기존 테스트들도 그대로 통과해야 한다.)

- [ ] **Step 3: 커밋**

```bash
git add tests/node/payload-yaml.test.js
git commit -m "$(cat <<'EOF'
test: 블록 스칼라 들여쓰기 이탈 검사기 추가 (#40)

heredoc이 `run: |` 블록 스칼라를 이탈해 YAML 파싱이 깨지는 버그 클래스를
잡아내는 findBlockScalarIndentationViolations 헬퍼와 픽스처 기반 단위
테스트 3개를 추가했다. 아직 실제 payload 파일에는 연결하지 않았다.
EOF
)"
```

---

### Task 2: 회귀 통합 테스트 연결 + 두 워크플로우 파일 YAML 수정

**Files:**
- Modify: `tests/node/payload-yaml.test.js` (Task 1에서 추가한 섹션 바로 뒤에 통합 테스트 1개 추가)
- Modify: `payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-TEST-APK.yaml` (heredoc 들여쓰기 3곳)
- Modify: `payload/workflows/flutter/PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml` (heredoc 들여쓰기 2곳)

**Interfaces:**
- Consumes: `findBlockScalarIndentationViolations(text: string): Array<{ line: number, content: string }>` (Task 1에서 같은 파일에 정의됨, 그대로 호출)
- Consumes: 기존 `files` 배열 (`payload-yaml.test.js` 상단, `payload/workflows` 전체 28개 파일 경로 목록)

- [ ] **Step 1: 통합 테스트를 추가한다 (아직 RED 예상)**

Task 1에서 추가한 3개 픽스처 테스트 바로 뒤, `// AUTO-CHANGELOG-CONTROL...` 배너 주석 바로 앞에 아래 테스트를 삽입한다.

old_string:
```js
test("findBlockScalarIndentationViolations는 같은 스텝의 형제 키(if: 등)로 끝나는 블록 스칼라에 오탐하지 않는다", () => {
  const fixture = [
    "jobs:",
    "  test:",
    "    steps:",
    "      - name: Step with if after run",
    "        run: |",
    "          echo hi",
    "        if: always()",
  ].join("\n");
  assert.strictEqual(findBlockScalarIndentationViolations(fixture).length, 0);
});

// ---------------------------------------------------------------
// AUTO-CHANGELOG-CONTROL: summary engine chain rewrite (Task 8)
// ---------------------------------------------------------------
```

new_string:
```js
test("findBlockScalarIndentationViolations는 같은 스텝의 형제 키(if: 등)로 끝나는 블록 스칼라에 오탐하지 않는다", () => {
  const fixture = [
    "jobs:",
    "  test:",
    "    steps:",
    "      - name: Step with if after run",
    "        run: |",
    "          echo hi",
    "        if: always()",
  ].join("\n");
  assert.strictEqual(findBlockScalarIndentationViolations(fixture).length, 0);
});

test("payload 워크플로우 전체에 블록 스칼라 이탈(#40) 회귀가 없다", () => {
  for (const f of files) {
    const violations = findBlockScalarIndentationViolations(readFileSync(f, "utf8"));
    if (violations.length > 0) {
      const first = violations[0];
      assert.fail(`${f}:${first.line} — 블록 스칼라 본문이 이탈했습니다: ${first.content}`);
    }
  }
});

// ---------------------------------------------------------------
// AUTO-CHANGELOG-CONTROL: summary engine chain rewrite (Task 8)
// ---------------------------------------------------------------
```

- [ ] **Step 2: 새 통합 테스트가 정확히 두 파일에서 실패하는지 확인한다 (RED)**

Run: `node --test tests/node/payload-yaml.test.js`
Expected: FAIL — 실패 메시지가 `payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-TEST-APK.yaml:336 — 블록 스칼라 본문이 이탈했습니다: storeFile=keystore/key.jks` 형태여야 한다 (파일별로 첫 번째 위반만 보고하므로 한 번 실행에 한 파일만 보임 — `assert.fail`이 발생하면 그 시점에 루프가 멈춘다는 점에 유의. `files` 배열 순서상 `PROJECT-FLUTTER-ANDROID-TEST-APK.yaml`이 먼저 걸린다).

- [ ] **Step 3: `PROJECT-FLUTTER-ANDROID-TEST-APK.yaml`의 heredoc 들여쓰기 3곳을 고친다**

**3-1.** `key.properties` 생성 블록:

old_string:
```yaml
          cat > android/key.properties << EOF
storeFile=keystore/key.jks
storePassword=$STORE_PASSWORD
keyAlias=$KEY_ALIAS
keyPassword=$KEY_PASSWORD
EOF
          echo "✅ key.properties 생성 완료"
```

new_string:
```yaml
          cat > android/key.properties << EOF
          storeFile=keystore/key.jks
          storePassword=$STORE_PASSWORD
          keyAlias=$KEY_ALIAS
          keyPassword=$KEY_PASSWORD
          EOF
          echo "✅ key.properties 생성 완료"
```

**3-2.** `build-info.txt` 생성 블록 — 첫 번째 `cat >` (기본 정보):

old_string:
```yaml
          cat > build-info.txt << EOF
테스트 APK 빌드 정보

빌드 번호: #$BUILD_NUMBER
EOF
```

new_string:
```yaml
          cat > build-info.txt << EOF
          테스트 APK 빌드 정보

          빌드 번호: #$BUILD_NUMBER
          EOF
```

**3-3.** `build-info.txt` — PR 번호 추가 블록 (if 안, `cat >>` 자체 들여쓰기는 12칸 그대로 두고 본문/EOF만 10칸으로):

old_string:
```yaml
            cat >> build-info.txt << EOF
PR 번호: #$PR_NUMBER
EOF
```

new_string:
```yaml
            cat >> build-info.txt << EOF
          PR 번호: #$PR_NUMBER
          EOF
```

**3-4.** `build-info.txt` — 브랜치/커밋/빌드 날짜 블록:

old_string:
```yaml
          cat >> build-info.txt << EOF
브랜치: $BRANCH_NAME
커밋: $COMMIT_SHORT
전체 커밋 해시: $COMMIT_SHA
빌드 날짜: $BUILD_DATE

EOF
```

new_string:
```yaml
          cat >> build-info.txt << EOF
          브랜치: $BRANCH_NAME
          커밋: $COMMIT_SHORT
          전체 커밋 해시: $COMMIT_SHA
          빌드 날짜: $BUILD_DATE

          EOF
```

**3-5.** `build-info.txt` — 관련 이슈 블록 (if 안):

old_string:
```yaml
            cat >> build-info.txt << EOF
관련 이슈:
- #$ISSUE_NUMBER: $ISSUE_TITLE
- URL: $ISSUE_URL

EOF
```

new_string:
```yaml
            cat >> build-info.txt << EOF
          관련 이슈:
          - #$ISSUE_NUMBER: $ISSUE_TITLE
          - URL: $ISSUE_URL

          EOF
```

**3-6.** `build-metadata.json` 생성 블록 (JSON 내부 상대 들여쓰기 2칸은 그대로 유지하고, 전체를 블록 스칼라 기준선인 10칸만큼 밀어준다):

old_string:
```yaml
          cat > build-metadata.json << EOF
{
  "pr_number": "${{ needs.prepare-test-build.outputs.pr_number }}",
  "build_number": "${{ needs.prepare-test-build.outputs.build_number }}",
  "issue_number": "${{ needs.prepare-test-build.outputs.issue_number }}",
  "branch_name": "${{ github.event_name == 'repository_dispatch' && github.event.client_payload.branch_name || github.ref_name }}"
}
EOF
```

new_string:
```yaml
          cat > build-metadata.json << EOF
          {
            "pr_number": "${{ needs.prepare-test-build.outputs.pr_number }}",
            "build_number": "${{ needs.prepare-test-build.outputs.build_number }}",
            "issue_number": "${{ needs.prepare-test-build.outputs.issue_number }}",
            "branch_name": "${{ github.event_name == 'repository_dispatch' && github.event.client_payload.branch_name || github.ref_name }}"
          }
          EOF
```

- [ ] **Step 4: `node --test tests/node/payload-yaml.test.js`를 다시 실행해 Android 파일 관련 위반이 사라졌는지 확인한다**

Run: `node --test tests/node/payload-yaml.test.js`
Expected: 이번에는 `PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml`에서 FAIL (Android 파일은 더 이상 위반이 없으므로 `files` 배열의 다음 위반 파일로 넘어간다). 실패 메시지는 `payload/workflows/flutter/PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml:322 — ...` 형태여야 한다.

- [ ] **Step 5: `PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml`의 heredoc 들여쓰기 2곳을 고친다**

**5-1.** `final_release_notes.txt` 생성 블록 — 첫 번째 `cat >`:

old_string:
```yaml
          cat > final_release_notes.txt << EOF
테스트 빌드 #$BUILD_NUMBER

브랜치: $BRANCH_NAME
커밋: $COMMIT_SHORT
날짜: $BUILD_DATE

EOF
```

new_string:
```yaml
          cat > final_release_notes.txt << EOF
          테스트 빌드 #$BUILD_NUMBER

          브랜치: $BRANCH_NAME
          커밋: $COMMIT_SHORT
          날짜: $BUILD_DATE

          EOF
```

**5-2.** `final_release_notes.txt` — 관련 이슈 블록 (if 안):

old_string:
```yaml
            cat >> final_release_notes.txt << EOF
관련 이슈:
- #$ISSUE_NUMBER: $ISSUE_TITLE
- URL: $ISSUE_URL

EOF
```

new_string:
```yaml
            cat >> final_release_notes.txt << EOF
          관련 이슈:
          - #$ISSUE_NUMBER: $ISSUE_TITLE
          - URL: $ISSUE_URL

          EOF
```

**5-3.** `build-metadata.json` 생성 블록 (Android와 동일한 패턴):

old_string:
```yaml
          cat > build-metadata.json << EOF
{
  "pr_number": "${{ needs.prepare-test-build.outputs.pr_number }}",
  "build_number": "${{ needs.prepare-test-build.outputs.build_number }}",
  "issue_number": "${{ needs.prepare-test-build.outputs.issue_number }}",
  "branch_name": "${{ github.event_name == 'repository_dispatch' && github.event.client_payload.branch_name || github.ref_name }}"
}
EOF
```

new_string:
```yaml
          cat > build-metadata.json << EOF
          {
            "pr_number": "${{ needs.prepare-test-build.outputs.pr_number }}",
            "build_number": "${{ needs.prepare-test-build.outputs.build_number }}",
            "issue_number": "${{ needs.prepare-test-build.outputs.issue_number }}",
            "branch_name": "${{ github.event_name == 'repository_dispatch' && github.event.client_payload.branch_name || github.ref_name }}"
          }
          EOF
```

- [ ] **Step 6: 전체 GREEN 확인**

Run: `node --test tests/node/payload-yaml.test.js`
Expected: 모든 테스트 PASS (새로 추가한 통합 테스트 포함).

- [ ] **Step 7: 두 파일이 실제로 유효한 YAML로 파싱되는지 임시로 재확인한다 (커밋 대상 아님)**

이 저장소는 무의존성 정책이라 `js-yaml`을 `package.json`에 추가하지 않는다. 로컬에 이미 설치돼 있다면(예: 다른 프로젝트에서 전역/우연히 존재) 다음으로 1회성 검증만 하고 끝낸다. 없다면 이 스텝은 건너뛰어도 된다 — Step 6의 자체 검사기 통과로 충분하다.

```bash
node -e "
const yaml = require('js-yaml');
const fs = require('fs');
for (const f of [
  'payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-TEST-APK.yaml',
  'payload/workflows/flutter/PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml',
]) {
  try { yaml.load(fs.readFileSync(f, 'utf8')); console.log('OK', f); }
  catch (e) { console.log('FAIL', f, e.message); }
}
" 2>/dev/null || echo "js-yaml 없음 — 건너뜀 (Step 6의 자체 검사기로 충분)"
```

Expected: 두 파일 모두 `OK` (또는 js-yaml이 없어 건너뜀).

- [ ] **Step 8: 전체 테스트 스위트 실행**

Run: `npm test`
Expected: PASS (Node 전체 + Python 전체). 이 저장소에 다른 미완료 변경이 없다면 실패 없이 통과해야 한다.

- [ ] **Step 9: 커밋**

```bash
git add tests/node/payload-yaml.test.js \
  payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-TEST-APK.yaml \
  payload/workflows/flutter/PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml
git commit -m "$(cat <<'EOF'
fix: Flutter 테스트 워크플로우 2개의 heredoc이 블록 스칼라를 이탈하던 문제 수정

`PROJECT-FLUTTER-ANDROID-TEST-APK.yaml`과 `PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml`의
heredoc 본문·종료자가 컬럼 0에 쓰여 있어 YAML 파싱이 실패하던 문제를 고쳤다.
들여쓰기만 조정했고 heredoc이 생성하는 실제 내용은 동일하다.

같은 버그 클래스의 재발을 막기 위해 payload-yaml.test.js에
findBlockScalarIndentationViolations 검사를 연결했다.

Fixes #40
EOF
)"
```

---

## Self-Review 메모 (계획 작성자용)

- 두 파일에 대한 정확한 치환 내용은 scratch 카피본에 동일한 알고리즘을 적용해 `js-yaml`로 파싱 성공을 확인하고, 원본과의 `diff -u`로 추출한 것이다 — 수작업 공백 계산이 아니다.
- `findBlockScalarIndentationViolations`는 실제로 `payload/workflows` 전체 28개 파일에 대해 실행해, 딱 2개 파일(각각 3곳/2곳 위반)에서만 위반을 보고하고 나머지 26개에서는 오탐이 없음을 확인했다. 초기 버전은 주석 줄(`# ...`)을 "구조적이지 않음"으로 오판해 5개 파일에서 오탐을 냈고, `COMMENT_LINE` 예외를 추가해 해결했다 — 이 이력은 앞으로 검사기를 손볼 때 같은 함정에 빠지지 않도록 남겨둔다.
- Task 2 Step 2와 Step 4의 "몇 번째 파일에서 실패하는지"는 `files` 배열의 정렬 순서(`readdirSync(..., { recursive: true })`가 반환하는 순서)에 의존한다. 만약 실행 환경에 따라 순서가 달라 다른 파일이 먼저 걸리더라도, 최종적으로 두 파일 모두 고치고 나면 Step 6에서 GREEN이 되는 것이 목표이므로 순서 자체는 중요하지 않다.
