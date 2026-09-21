# SUH-LAB 종속 네이밍 일반화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **이 플랜은 아래 "실행 제약"이 우선한다.**

**Goal:** 원작자 브랜드(`suh`)와 원본 도구명(`projectops`)에 종속된 파일명·명령어·마커·식별자·출처 표기를 일반 이름으로 바꾸고, 재유입을 막는 가드 테스트를 추가하며, 이 레포의 issue helper 브랜치 자동 생성을 켠다.

**Architecture:** 대부분 기계적 치환이다. 순서는 (1) 재유입 가드를 먼저 RED로 만든 뒤 (2) 센티널 → (3) 워크플로우 명령어·마커·파일명 → (4) 코드 식별자 → (5) 폴더 이동 → (6) 문서 → (7) issue helper 설정 순으로 GREEN을 만든다. 각 치환은 grep 카운트와 일회성 검증 스크립트로 확인한다.

**Tech Stack:** Node ≥20 (`node --test`, ESM, 의존성 0), Python 3 표준 라이브러리(`unittest`), GitHub Actions YAML(payload 템플릿), bash 3.2(정규식 검증), perl(치환), PyYAML·actionlint(구문 검증, 일회성).

**Spec:** GitHub 이슈 #128 (https://github.com/Twin-Fang/project-auto-wizard/issues/128) — 본문이 승인된 설계다. 초안: `.issue/#20260921_001_기능개선_SUH_LAB_종속_네이밍_일반화.md`(gitignore 대상).

## 실행 제약 (모든 Task에 적용)

- 작업 위치는 현재 브랜치 `20260921_#128_SUH_LAB_종속_이름_suh_lab_명령어_마커_파일명_출처_표기_을_일반_이름으로_변경`(base: `develop`)이다. **worktree를 만들지 않는다.**
- **커밋, 스테이징(`git add`), `git mv`를 하지 않는다.** 파일 이동은 일반 `mv`를 쓴다. 커밋은 마지막에 `/prp-commit`이 책임별로 나눠 수행한다.
- git의 force 계열 옵션(`--force`, `-f`, `reset --hard`, `clean -f`, `branch -D`, `--no-verify` 등)을 절대 쓰지 않는다. `.gitignore` 대상 파일은 강제로 추적시키지 않는다.
- 이슈 #128에 없는 변경을 추가하지 않는다. 문서화, 리팩터링, 인접 코드 개선 금지.
- 일회성 검증 스크립트는 `$SP`(스크래치패드)에만 만들고 저장소에 남기지 않는다.
  `SP=/private/tmp/claude-501/-Users-chuseok22-Workspace-contests-open-soruce-code-project-auto-wizard/2a34ff26-5d3b-4531-8fc4-a2b672859d1d/scratchpad`
- 저장소 루트: `/Users/chuseok22/Workspace/contests/open-soruce/code/project-auto-wizard` (이하 `ROOT`). 모든 명령은 `cd ROOT` 후 실행한다.
- 커밋 메시지는 한국어이며 타입 접두사만 영어다(이번 플랜에서는 커밋하지 않는다).

## Global Constraints

- 새 댓글 명령어 접두사는 `/wizard`다. 서브커맨드 `server build|destroy|status`, `app|apk|ios build`, 어순 무관 매칭, 대소문자 처리는 **접두사만 치환하고 그대로** 둔다.
- 새 마커는 `<!-- project-auto-wizard issue helper -->`다(이 레포 `issue_helper.py`의 `COMMENT_MARKER_DEFAULT`와 동일).
- 안내 문구의 `Guide by SUH-LAB` 댓글은 `Issue Helper` 댓글로 바꾼다.
- Flutter 트리거 파일명은 `PROJECT-FLUTTER-APP-BUILD-TRIGGER.yaml`, `name:`은 `PROJECT-Flutter-App-Build-Trigger`다.
- heredoc 센티널은 `__WIZARD_*__`다.
- `docs/suh-template/hypercortex/`는 `docs/hypercortex/`다.
- `projectops` 환경변수 `PROJECTOPS_SH_REF`는 `VERSION_MANAGER_SH_REF`다.
- 주석 예시의 `Suh-Web`은 `<모듈명>`으로 바꾼다.
- `.github/scripts/`와 `payload/scripts/`의 동일 복사본(`changelog_manager.py`, `version_manager.py`)은 **양쪽을 똑같이** 수정하고 `diff -q`로 일치를 확인한다.
- 변경하지 않는 것: `LICENSE`, 과거 spec·plan 문서 안의 옛 파일명 서술, `docs/projectops/` 폴더와 `docs/2026-07-08-projectops-oss-design.md` 파일명, `.gitignore` 대상 디렉토리(`.issue/`, `.superpowers/`, `.worktrees/`), README, `payload/`의 issue helper 템플릿 기본값.
- 하위 호환(`@suh-lab` 동시 인식)은 두지 않는다.

## File Structure

| 구분 | 파일 | 책임 |
|---|---|---|
| Create | `tests/node/legacy-naming-guard.test.js` | `payload/`, `src/`, `.github/`에 `suh`·`projectops`가 없는지 검사 |
| Modify | `tests/node/verify.test.js`, `src/core/verify.js`, `payload/workflows/common/secret-backup/PROJECT-COMMON-SECRET-FILE-UPLOAD.yaml` | 센티널 접두사 |
| Modify | `payload/workflows/{spring/server-deploy,go,python}/PROJECT-*-PR-PREVIEW.yaml` | 명령어·마커·`Suh-Web` 예시 |
| Modify + 이동 | `payload/workflows/flutter/PROJECT-FLUTTER-SUH-LAB-APP-BUILD-TRIGGER.yaml` → `PROJECT-FLUTTER-APP-BUILD-TRIGGER.yaml` | 명령어·마커·정규식·이름 |
| Modify | `payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-TEST-APK.yaml`, `PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml` | 안내 문구 |
| Modify | `{.github,payload}/scripts/{changelog_manager,version_manager}.py`, `tests/py/test_{changelog_fallback,classify_bump,sh_equivalence}.py` | `projectops`·`SUH-DEVOPS-TEMPLATE` 식별자 |
| 이동 | `docs/suh-template/hypercortex/` → `docs/hypercortex/` | 폴더명 |
| Modify | `docs/{DESIGN-SPEC,BRAINSTORMING,HANDOFF,IMPLEMENTATION-PLAN,2026-07-08-projectops-oss-design}.md`, `docs/superpowers/specs/2026-07-25-osscontest-scope-design.md` | 출처·라이선스 표기 |
| Modify | `.github/workflows/PROJECT-COMMON-ISSUE-HELPER.yaml` | 브랜치 자동 생성 켜기 |
| Modify | `tests/node/payload-yaml.test.js:528-532` | 도그푸딩 사본의 base 브랜치 단언을 `main` → `develop`으로 갱신(위 워크플로우 변경의 필연적 후속) |

> **이슈 #128 구현 가이드와 다른 점 (의도된 편차):** ① 가드는 기존 `payload-example-values.test.js`에 넣지 않고 새 파일 `legacy-naming-guard.test.js`로 분리한다 — 스캔 범위가 `payload/`·`src/`·`.github/`이고 주석 줄까지 검사해서 워크플로우 전용 헬퍼(`WF_ROOT`, `isCommented`)와 성격이 다르다. ② 파일 이동은 `git mv`가 아니라 `mv`를 쓴다 — 스테이징을 커밋 단계(`/prp-commit`)에 맡기기 위해서이며, 옛 경로 삭제와 새 경로 추가를 **같은 커밋에** 스테이징하면 rename(유사도 약 93%)으로 인식된다. ③ Task 7에서 `payload-yaml.test.js`를 함께 수정한다 — 이슈에는 "워크플로우 두 값만 변경"이라 적었으나 이 값을 단언하는 기존 테스트가 있어 같이 바꾸지 않으면 CI가 실패한다.

---

### Task 1: 재유입 가드 테스트 (RED)

**Files:**
- Create: `tests/node/legacy-naming-guard.test.js`

**Interfaces:**
- Consumes: `resolvePayloadRoot()` from `src/core/assets.js` (payload 디렉토리 절대경로 반환)
- Produces: 없음. 이후 모든 Task의 완료 판정(가드 GREEN)에 쓰인다.

- [ ] **Step 1: 기준선 확인** — 변경 전 전체 테스트가 통과하는지 기록한다.

```bash
cd ROOT && git status -sb | head -3 && npm test 2>&1 | tail -15
```
Expected: 현재 브랜치명이 출력되고 작업 트리에는 이 플랜 문서(`docs/superpowers/plans/2026-09-21-suh-naming-generalization.md`, 미추적)만 보이며, 모든 테스트가 PASS(검토 시 기준선: node 518개 pass, python 160개 OK·skipped 4). 실패가 있으면 이후 실패와 구분되도록 실패 테스트명을 기록해 두고 보고한다.

> **테스트 출력 형식 주의:** 이 환경의 Node v24는 파이프로 연결해도 spec 리포터(`ℹ pass N`)를 쓴다. 이 플랜에서 `# pass`/`# fail`/`not ok`를 grep하는 `node --test` 명령은 모두 `--test-reporter=tap`을 붙인다. `npm run test:node`는 `npm run test:node -- --test-reporter=tap`으로 실행한다.

- [ ] **Step 2: 가드 테스트 작성**

`tests/node/legacy-naming-guard.test.js`:

```js
// tests/node/legacy-naming-guard.test.js
// 원작자 종속 이름(suh)과 원본 도구명(projectops)이 설치물·소스에 다시 들어오는 것을 막는다 (이슈 #128).
//
// docs/는 과거 설계 기록이라 검사하지 않고, tests/는 이 가드 자신이 패턴 문자열을 담고 있어 제외한다.
// 주석 줄도 검사한다 — 주석에 남은 예시값도 사용자에게 그대로 설치되기 때문이다.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resolvePayloadRoot } from "../../src/core/assets.js";

const REPO_ROOT = join(resolvePayloadRoot(), "..");
const SCAN_DIRS = ["payload", "src", ".github"];
const LEGACY_NAME = /suh|projectops/i;

function allFiles(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) allFiles(path, acc);
    else acc.push(path);
  }
  return acc;
}

test("payload·src·.github에 원작자 종속 이름(suh)과 원본 도구명(projectops)이 남아 있지 않다", () => {
  const hits = [];
  for (const dir of SCAN_DIRS) {
    for (const file of allFiles(join(REPO_ROOT, dir))) {
      const rel = file.slice(REPO_ROOT.length + 1);
      if (LEGACY_NAME.test(rel)) hits.push(`${rel} — 파일 경로`);
      readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
        if (LEGACY_NAME.test(line)) hits.push(`${rel}:${i + 1}  ${line.trim()}`);
      });
    }
  }
  assert.deepStrictEqual(hits, [], `종속 이름이 남아 있습니다:\n  ${hits.join("\n  ")}`);
});
```

- [ ] **Step 3: RED 확인**

```bash
cd ROOT && node --test tests/node/legacy-naming-guard.test.js 2>&1 | tail -30
```
Expected: FAIL. 출력에 `PROJECT-FLUTTER-SUH-LAB-APP-BUILD-TRIGGER.yaml — 파일 경로`, `@suh-lab`이 든 PR-PREVIEW 줄들, `src/core/verify.js:9`, `.github/scripts/version_manager.py:9`, `.github/scripts/changelog_manager.py:280` 등이 포함된다. (PASS가 나오면 스캔 경로가 틀린 것이므로 `REPO_ROOT` 계산을 점검한다.)

**Commit group (마지막에 `/prp-commit`이 사용):** `test:` — 이 파일 단독. 다른 커밋이 모두 끝난 뒤(GREEN 상태에서) 마지막 코드 커밋으로 넣는다.

---

### Task 2: heredoc 센티널 `__SUH_*__` → `__WIZARD_*__`

**Files:**
- Modify: `tests/node/verify.test.js:34-35`, `src/core/verify.js:9-10`, `payload/workflows/common/secret-backup/PROJECT-COMMON-SECRET-FILE-UPLOAD.yaml`(12곳)

**Interfaces:**
- Consumes: `scanUnsubstituted(dir, files)` — heredoc 구분자를 치환 대상에서 제외하는 `SENTINEL_RE`
- Produces: 없음

- [ ] **Step 1: 테스트를 먼저 새 접두사로 바꾼다(RED 유도)**

```bash
cd ROOT && perl -pi -e 's/__SUH_/__WIZARD_/g' tests/node/verify.test.js && grep -n "WIZARD_\|SUH" tests/node/verify.test.js
```
Expected: 34~35행에 `__WIZARD_*__`와 `__WIZARD_FILE_CONTENT_EOF__`가 보이고 `SUH`는 없다.

- [ ] **Step 2: RED 확인**

```bash
cd ROOT && node --test --test-reporter=tap tests/node/verify.test.js 2>&1 | grep -E "^(not ok|# (pass|fail))"
```
Expected: `heredoc 구분자(__WIZARD_*__)` 테스트가 `not ok`(아직 `SENTINEL_RE`가 `__SUH_`만 인식하므로 `__WIZARD_FILE_CONTENT_EOF__`가 미치환 토큰으로 잡힘).

- [ ] **Step 3: 구현** — `src/core/verify.js`의 주석과 정규식, 워크플로우의 heredoc 구분자를 함께 바꾼다.

```bash
cd ROOT && perl -pi -e 's/__SUH_/__WIZARD_/g' src/core/verify.js payload/workflows/common/secret-backup/PROJECT-COMMON-SECRET-FILE-UPLOAD.yaml
sed -n 8,10p src/core/verify.js
grep -n "__WIZARD_" payload/workflows/common/secret-backup/PROJECT-COMMON-SECRET-FILE-UPLOAD.yaml | wc -l
```
Expected: `verify.js`에 `(예: cat <<'__WIZARD_FILE_CONTENT_EOF__')`와 `const SENTINEL_RE = /^__WIZARD_[A-Z0-9_]*__$/;`. 워크플로우의 `__WIZARD_` 줄 수는 12.

- [ ] **Step 4: GREEN 확인**

```bash
cd ROOT && node --test --test-reporter=tap tests/node/verify.test.js 2>&1 | grep -E "^# (pass|fail)" && grep -rn "__SUH_" src tests payload .github || echo "잔존 없음"
```
Expected: `# fail 0`, `잔존 없음`.

- [ ] **Step 5: 전체 node 테스트로 회귀 확인**

```bash
cd ROOT && node --test --test-concurrency=1 --test-reporter=tap --test-skip-pattern="원작자 종속" 2>&1 | grep -E "^(not ok|# (pass|fail))"
```
Expected: `# fail 0`(가드 테스트는 아직 RED이므로 `--test-skip-pattern`으로 제외한다).

**Commit group:** `refactor:` — `verify.js`, `verify.test.js`, `PROJECT-COMMON-SECRET-FILE-UPLOAD.yaml`.

---

### Task 3: 워크플로우 명령어·마커·파일명 교체

**Files:**
- Modify: `payload/workflows/spring/server-deploy/PROJECT-SPRING-PR-PREVIEW.yaml`, `payload/workflows/go/PROJECT-GO-PR-PREVIEW.yaml`, `payload/workflows/python/PROJECT-PYTHON-PR-PREVIEW.yaml`
- Modify + 이동: `payload/workflows/flutter/PROJECT-FLUTTER-SUH-LAB-APP-BUILD-TRIGGER.yaml` → `payload/workflows/flutter/PROJECT-FLUTTER-APP-BUILD-TRIGGER.yaml`
- Modify: `payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-TEST-APK.yaml`, `payload/workflows/flutter/PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml`

**Interfaces:**
- Consumes: `.github/scripts/issue_helper.py`가 만드는 댓글 형식 — 첫 줄 `<!-- project-auto-wizard issue helper -->`, 본문에 `### 브랜치명` 다음 줄 ``` 코드블록에 브랜치명
- Produces: 없음

- [ ] **Step 1: 기준선 기록**

```bash
cd ROOT && for f in payload/workflows/spring/server-deploy/PROJECT-SPRING-PR-PREVIEW.yaml payload/workflows/go/PROJECT-GO-PR-PREVIEW.yaml payload/workflows/python/PROJECT-PYTHON-PR-PREVIEW.yaml payload/workflows/flutter/PROJECT-FLUTTER-SUH-LAB-APP-BUILD-TRIGGER.yaml payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-TEST-APK.yaml payload/workflows/flutter/PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml; do printf "%-95s %s\n" "$f" "$(grep -ci suh "$f")"; done
```
Expected: 줄 수 — spring 39, go 40, python 40, flutter 트리거 37, android 1, ios 1.

- [ ] **Step 2: 마커 값 교체(산문 치환보다 먼저 한다)**

```bash
cd ROOT && WF=payload/workflows
for f in $WF/spring/server-deploy/PROJECT-SPRING-PR-PREVIEW.yaml $WF/go/PROJECT-GO-PR-PREVIEW.yaml $WF/python/PROJECT-PYTHON-PR-PREVIEW.yaml; do
  perl -pi -e 's{ISSUE_HELPER_MARKER: \x27Guide by SUH-LAB\x27}{ISSUE_HELPER_MARKER: \x27<!-- project-auto-wizard issue helper -->\x27}' "$f"
  grep -n "ISSUE_HELPER_MARKER:" "$f"
done
perl -pi -e 's{c\.body\.includes\(\x27Guide by SUH-LAB\x27\)}{c.body.includes(\x27<!-- project-auto-wizard issue helper -->\x27)}' $WF/flutter/PROJECT-FLUTTER-SUH-LAB-APP-BUILD-TRIGGER.yaml
grep -n "includes('<!--" $WF/flutter/PROJECT-FLUTTER-SUH-LAB-APP-BUILD-TRIGGER.yaml
```
Expected: 세 PR-PREVIEW에 `ISSUE_HELPER_MARKER: '<!-- project-auto-wizard issue helper -->'`, Flutter 트리거에 `c.body.includes('<!-- project-auto-wizard issue helper -->')` 1줄.

- [ ] **Step 3: 명령어 접두사 교체** — JS 정규식 리터럴 안의 `/`는 이스케이프해야 하므로 리터럴을 먼저 처리한다.

```bash
cd ROOT && WF=payload/workflows
perl -pi -e 's{/\@suh-lab}{/\\/wizard}g; s{\@suh-lab}{/wizard}g' \
  $WF/spring/server-deploy/PROJECT-SPRING-PR-PREVIEW.yaml $WF/go/PROJECT-GO-PR-PREVIEW.yaml \
  $WF/python/PROJECT-PYTHON-PR-PREVIEW.yaml $WF/flutter/PROJECT-FLUTTER-SUH-LAB-APP-BUILD-TRIGGER.yaml
grep -c "@suh-lab" $WF/spring/server-deploy/PROJECT-SPRING-PR-PREVIEW.yaml $WF/go/PROJECT-GO-PR-PREVIEW.yaml $WF/python/PROJECT-PYTHON-PR-PREVIEW.yaml $WF/flutter/PROJECT-FLUTTER-SUH-LAB-APP-BUILD-TRIGGER.yaml
grep -n 'match(/\\/wizard' $WF/flutter/PROJECT-FLUTTER-SUH-LAB-APP-BUILD-TRIGGER.yaml | head -3
```
Expected: `@suh-lab` 개수 전부 0, 그리고 `match(/\/wizard[^\S\r\n]+apk...` 형태(슬래시 이스케이프됨)의 줄이 보인다.

- [ ] **Step 4: 산문 문구 교체** — 남은 `Guide by SUH-LAB`은 모두 안내 문구·주석이다.

```bash
cd ROOT && WF=payload/workflows
perl -pi -e 's{Guide by SUH-LAB}{Issue Helper}g' \
  $WF/flutter/PROJECT-FLUTTER-SUH-LAB-APP-BUILD-TRIGGER.yaml \
  $WF/flutter/PROJECT-FLUTTER-ANDROID-TEST-APK.yaml $WF/flutter/PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml
grep -n "Issue Helper" $WF/flutter/PROJECT-FLUTTER-ANDROID-TEST-APK.yaml $WF/flutter/PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml
```
Expected: ANDROID/IOS 각 1줄 — `'2. "Issue Helper" 댓글의 브랜치명이 올바른지 확인하세요',`.

- [ ] **Step 5: Flutter 트리거의 브랜치 파싱 정규식 보정** — Edit 도구로 정확히 아래 한 줄만 바꾼다.

old:
```
                const branchMatch = guideComment.body.match(/### 브랜치\s*```\s*([\s\S]*?)\s*```/);
```
new:
```
                const branchMatch = guideComment.body.match(/### 브랜치(?:명)?\s*```\s*([\s\S]*?)\s*```/);
```

- [ ] **Step 6: Flutter 트리거 헤더·`name:` 정리 후 파일 이동** — 이동은 `mv`(스테이징 금지).

```bash
cd ROOT && F=payload/workflows/flutter/PROJECT-FLUTTER-SUH-LAB-APP-BUILD-TRIGGER.yaml
perl -pi -e 's{ \(SUH-LAB\)$}{}; s{PROJECT-Flutter-SUH-LAB-App-Build-Trigger}{PROJECT-Flutter-App-Build-Trigger}' "$F"
mv "$F" payload/workflows/flutter/PROJECT-FLUTTER-APP-BUILD-TRIGGER.yaml
sed -n 3p payload/workflows/flutter/PROJECT-FLUTTER-APP-BUILD-TRIGGER.yaml
grep -n "^name:" payload/workflows/flutter/PROJECT-FLUTTER-APP-BUILD-TRIGGER.yaml
ls payload/workflows/flutter | grep -i "trigger"
```
Expected: 3행 `# Flutter 테스트 앱 빌드 트리거 워크플로우`, `name: PROJECT-Flutter-App-Build-Trigger`, 파일 목록에 새 이름만 존재.

- [ ] **Step 7: 주석 예시의 `Suh-Web` 교체**

```bash
cd ROOT && perl -pi -e 's{\./Suh-Web/}{./<모듈명>/}g' payload/workflows/spring/server-deploy/PROJECT-SPRING-PR-PREVIEW.yaml
sed -n '295p;301p' payload/workflows/spring/server-deploy/PROJECT-SPRING-PR-PREVIEW.yaml
```
Expected: 두 줄 모두 `> ./<모듈명>/src/main/resources/...json`.

- [ ] **Step 8: 잔존 확인**

```bash
cd ROOT && grep -rniE "suh" payload/workflows || echo "payload/workflows 잔존 없음"
grep -rn "Guide by" payload/workflows || echo "Guide by 잔존 없음"
grep -rn "App-Build-Trigger\|APP-BUILD-TRIGGER" payload .github src tests README.md | grep -v "PROJECT-FLUTTER-APP-BUILD-TRIGGER.yaml:" || echo "다른 파일의 옛 이름 참조 없음"
```
Expected: 세 줄 모두 "없음" 메시지.

- [ ] **Step 9: 구문 검증(일회성)** — 변경 전(HEAD)과 변경 후가 같은 결과여야 한다.

`$SP/check_yaml.py`:
```python
import subprocess, sys, yaml
pairs = [
  ("payload/workflows/spring/server-deploy/PROJECT-SPRING-PR-PREVIEW.yaml",) * 2,
  ("payload/workflows/go/PROJECT-GO-PR-PREVIEW.yaml",) * 2,
  ("payload/workflows/python/PROJECT-PYTHON-PR-PREVIEW.yaml",) * 2,
  ("payload/workflows/flutter/PROJECT-FLUTTER-SUH-LAB-APP-BUILD-TRIGGER.yaml", "payload/workflows/flutter/PROJECT-FLUTTER-APP-BUILD-TRIGGER.yaml"),
  ("payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-TEST-APK.yaml",) * 2,
  ("payload/workflows/flutter/PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml",) * 2,
  ("payload/workflows/common/secret-backup/PROJECT-COMMON-SECRET-FILE-UPLOAD.yaml",) * 2,
]
def load(text):
    try:
        yaml.safe_load(text); return "ok"
    except Exception as e:
        return "error:" + type(e).__name__
bad = 0
for old, new in pairs:
    before = load(subprocess.check_output(["git", "show", f"HEAD:{old}"], text=True))
    after = load(open(new, encoding="utf8").read())
    flag = "OK " if before == after else "DIFF"
    bad += before != after
    print(flag, new.split("/")[-1], before, "->", after)
sys.exit(1 if bad else 0)
```
```bash
cd ROOT && python3 $SP/check_yaml.py
```
Expected: 모든 줄이 `OK `이고 종료 코드 0.

- [ ] **Step 10: 새 정규식 동작 검증(일회성, 커밋하지 않음)**

`$SP/check_prefix.mjs`:
```js
import { readFileSync } from "node:fs";
import assert from "node:assert";

const text = readFileSync("payload/workflows/flutter/PROJECT-FLUTTER-APP-BUILD-TRIGGER.yaml", "utf8");
const literals = [...text.matchAll(/match\((\/(?:\\.|[^\/\\])*\/[a-z]*)\)/g)].map((m) => m[1]);
const wizardLiterals = literals.filter((l) => l.includes("\\/wizard"));
assert.strictEqual(wizardLiterals.length, 12, `wizard 정규식 12개 기대, 실제 ${wizardLiterals.length}`);
const regexes = wizardLiterals.map((l) => new Function(`return ${l}`)());
const anyMatch = (s) => regexes.some((r) => r.test(s));

for (const ok of ["/wizard apk build", "/wizard build apk", "/wizard ios build feat_x", "/wizard build ios", "/wizard app build 20260921_#1_x", "/wizard build app"]) {
  assert.ok(anyMatch(ok), `매칭되어야 함: ${ok}`);
}
for (const no of ["@suh-lab apk build", "/wizard deploy apk", "wizard apk build"]) {
  assert.ok(!anyMatch(no), `매칭되면 안 됨: ${no}`);
}
const apk = regexes.find((r) => r.test("/wizard apk build my-branch"));
assert.strictEqual("/wizard apk build my-branch".match(/\/wizard[^\S\r\n]+apk[^\S\r\n]+build(?:[^\S\r\n]+(\S+))?/i)[1], "my-branch");

const branchRe = /### 브랜치(?:명)?\s*```\s*([\s\S]*?)\s*```/;
const helperBody = "<!-- project-auto-wizard issue helper -->\n## Issue Helper\n### 브랜치명\n```\n20260921_#128_x\n```\n\n### 커밋 메시지\n```\nmsg\n```";
assert.strictEqual(helperBody.match(branchRe)[1].trim(), "20260921_#128_x");
assert.ok(text.includes("### 브랜치(?:명)?"), "Flutter 트리거의 파싱 정규식이 보정되어야 함");
console.log("check_prefix OK");
```
```bash
cd ROOT && node $SP/check_prefix.mjs
```
Expected: `check_prefix OK`. (12개가 아니라면 `grep -c 'match(/\\/wizard'`로 실제 개수를 다시 세고, 변경 전 `/@suh-lab` 정규식 리터럴 개수 12와 같아야 한다.)

- [ ] **Step 11: PR-PREVIEW bash 명령어 파싱 검증(일회성, bash 3.2)**

`$SP/check_bash_regex.sh`:
```bash
#!/bin/bash
# 세 PR-PREVIEW의 `=~ /wizard...` 줄을 그대로 실행해 접두사 변경이 파싱을 깨지 않았는지 확인한다.
fail=0
for f in payload/workflows/spring/server-deploy/PROJECT-SPRING-PR-PREVIEW.yaml payload/workflows/go/PROJECT-GO-PR-PREVIEW.yaml payload/workflows/python/PROJECT-PYTHON-PR-PREVIEW.yaml; do
  for cmd in build destroy status; do
    line=$(grep -m1 "=~ /wizard\[\[:space:\]\]+server\[\[:space:\]\]+$cmd" "$f" | sed 's/^ *elif/if/')
    [ -z "$line" ] && { echo "FAIL 줄 없음: $f $cmd"; fail=1; continue; }
    run() { COMMENT="$1"; eval "$line echo \"MATCH:\${BASH_REMATCH[2]}\"; fi"; }
    [ "$(run "/wizard server $cmd my-branch")" = "MATCH:my-branch" ] || { echo "FAIL 브랜치 지정: $f $cmd"; fail=1; }
    [ "$(run "/wizard server $cmd")" = "MATCH:" ] || { echo "FAIL 브랜치 생략: $f $cmd"; fail=1; }
    [ -z "$(run "@suh-lab server $cmd")" ] || { echo "FAIL 옛 접두사가 매칭됨: $f $cmd"; fail=1; }
  done
done
[ $fail -eq 0 ] && echo "check_bash_regex OK"
exit $fail
```
```bash
cd ROOT && bash $SP/check_bash_regex.sh
```
Expected: `check_bash_regex OK`.

- [ ] **Step 12: 워크플로우 조건식 확인**

```bash
cd ROOT && grep -n "contains(github.event.comment.body, '/wizard')" payload/workflows/*/PROJECT-*-PR-PREVIEW.yaml payload/workflows/spring/server-deploy/PROJECT-SPRING-PR-PREVIEW.yaml payload/workflows/flutter/PROJECT-FLUTTER-APP-BUILD-TRIGGER.yaml | wc -l
```
Expected: 0보다 큼(각 파일에 `if:` 조건이 존재). 0이면 조건식이 다른 형태로 바뀐 것이므로 해당 파일의 `if:` 블록을 직접 확인한다.

**Commit group:** `feat:` — 위 6개 파일 + 이동된 Flutter 트리거. 본문에 breaking(명령어 `@suh-lab` → `/wizard`, 이슈 마커 교체, 옛 Flutter 트리거 파일은 재설치 후 수동 정리)을 명시한다. `!` 마커는 쓰지 않는다.

---

### Task 4: `projectops`·`SUH-DEVOPS-TEMPLATE` 코드 식별자

**Files:**
- Modify: `.github/scripts/changelog_manager.py`, `payload/scripts/changelog_manager.py`, `.github/scripts/version_manager.py`, `payload/scripts/version_manager.py`, `tests/py/test_changelog_fallback.py`, `tests/py/test_classify_bump.py`, `tests/py/test_sh_equivalence.py`

**Interfaces:**
- Consumes/Produces: 없음(주석, docstring, 테스트 함수명, 환경변수명만 변경)

- [ ] **Step 1: 기준선** — python 테스트 통과 확인

```bash
cd ROOT && npm run test:py 2>&1 | tail -5
```
Expected: 통과(실패 시 테스트명을 기록).

- [ ] **Step 2: `changelog_manager.py` 두 복사본의 주석·docstring**

```bash
cd ROOT && perl -pi -e 's/1단계: projectops 컨벤션/1단계: 제목 컨벤션/; s/projectops 컨벤션 레포에서는 이것이 의도된 우선순위다/이 컨벤션을 쓰는 레포에서는 이것이 의도된 우선순위다/' .github/scripts/changelog_manager.py payload/scripts/changelog_manager.py
grep -n "제목 컨벤션\|이 컨벤션을 쓰는" .github/scripts/changelog_manager.py payload/scripts/changelog_manager.py
```
Expected: 파일마다 2줄(280행, 301행 근처).

- [ ] **Step 3: `version_manager.py` 두 복사본의 docstring** — Edit 도구로 두 파일에 똑같이 적용한다.

old:
```
It is a Python rewrite of the battle-tested bash version_manager.sh from
SUH-DEVOPS-TEMPLATE. Behavioral equivalence with that script is the design goal:
```
new:
```
It is a Python rewrite of the battle-tested bash reference implementation
(version_manager.sh). Behavioral equivalence with that script is the design goal:
```

- [ ] **Step 4: 테스트 함수명·환경변수·docstring**

```bash
cd ROOT && perl -pi -e 's/test_tier1_projectops_convention/test_tier1_title_convention/' tests/py/test_changelog_fallback.py
perl -pi -e 's/test_feat_projectops_convention_is_minor/test_feat_title_convention_is_minor/' tests/py/test_classify_bump.py
perl -pi -e 's/PROJECTOPS_SH_REF/VERSION_MANAGER_SH_REF/g; s/version_manager\.sh \(SUH-DEVOPS-TEMPLATE\)\./version_manager.sh./' tests/py/test_sh_equivalence.py
sed -n 1,6p tests/py/test_sh_equivalence.py; grep -n "VERSION_MANAGER_SH_REF" tests/py/test_sh_equivalence.py | wc -l
```
Expected: 2행이 `against the bash reference version_manager.sh.`, `VERSION_MANAGER_SH_REF` 5곳.

- [ ] **Step 5: 복사본 일치와 잔존 확인**

```bash
cd ROOT && diff -q .github/scripts/changelog_manager.py payload/scripts/changelog_manager.py && diff -q .github/scripts/version_manager.py payload/scripts/version_manager.py && echo "복사본 일치"
grep -rniE "projectops|suh" .github/scripts payload/scripts tests/py || echo "잔존 없음"
```
Expected: `복사본 일치`, `잔존 없음`.

- [ ] **Step 6: 회귀 확인**

```bash
cd ROOT && npm run test:py 2>&1 | tail -5
```
Expected: Step 1과 같은 결과(통과).

**Commit group:** `refactor:` — 위 7개 파일.

---

### Task 5: 폴더 이동 `docs/suh-template/hypercortex/` → `docs/hypercortex/`

**Files:**
- 이동: `docs/suh-template/hypercortex/{DESIGN,REQUIREMENT,SPECIFICATION,TODO}.md`

- [ ] **Step 1: 이동** — 참조가 없음은 조사로 확인했다(`git grep "suh-template\|hypercortex"`가 자기 자신만 반환).

```bash
cd ROOT && git grep -n "suh-template" -- . ':!docs/suh-template' || echo "외부 참조 없음"
mv docs/suh-template/hypercortex docs/hypercortex && rmdir docs/suh-template
ls docs/hypercortex && test ! -e docs/suh-template && echo "옛 폴더 제거됨"
```
Expected: `외부 참조 없음`, 4개 파일 목록, `옛 폴더 제거됨`.

**Commit group:** `chore:` — 폴더 이동(`git add docs/`가 rename으로 인식).

---

### Task 6: 원본·라이선스 출처 표기 정리 (docs)

**Files:**
- Modify: `docs/DESIGN-SPEC.md`, `docs/BRAINSTORMING.md`, `docs/2026-07-08-projectops-oss-design.md`, `docs/HANDOFF.md`, `docs/IMPLEMENTATION-PLAN.md`, `docs/superpowers/specs/2026-07-25-osscontest-scope-design.md`

각 편집은 Edit 도구로 아래 문자열을 정확히 바꾼다. 나머지 `projectops`·`SUH-DEVOPS-TEMPLATE` 서술은 과거 기록이므로 유지한다.

- [ ] **Step 1: `docs/DESIGN-SPEC.md`** — 줄 삭제

old:
```
- 상태: 사용자 승인된 설계 (브레인스토밍 완료)
- 원본: SUH-DEVOPS-TEMPLATE (Cassiiopeia/projectops) v4.0.4
```
new:
```
- 상태: 사용자 승인된 설계 (브레인스토밍 완료)
```

- [ ] **Step 2: `docs/2026-07-08-projectops-oss-design.md`** — Step 1과 동일한 old/new를 적용한다.

- [ ] **Step 3: `docs/BRAINSTORMING.md`** — 줄 삭제

old:
```
- 원본: SUH-DEVOPS-TEMPLATE (Cassiiopeia/projectops) v4.0.4 — 기능이 너무 많음
- 목표: **오픈소스 공모전 제출용** 새 레포.
```
new:
```
- 목표: **오픈소스 공모전 제출용** 새 레포.
```

- [ ] **Step 4: `docs/HANDOFF.md`** — 정체 서술 정리, 원본 경로 줄 삭제

old:
```
- 오픈소스 공모전 제출용. SUH-DEVOPS-TEMPLATE(projectops)의 슬림 파생 — 3축: ①npx 마법사(9타입+멀티+모노레포) ②payload 워크플로우 ③버전/체인지로그 Python 백엔드
- 복사 원본($SRC): `D:\0-suh\project\suh-github-template` (읽기 전용 참조. 구 문서의 `E:\github\SUH-DEVOPS-TEMPLATE`는 이 경로로 이전됨)
```
new:
```
- 오픈소스 공모전 제출용 — 3축: ①npx 마법사(9타입+멀티+모노레포) ②payload 워크플로우 ③버전/체인지로그 Python 백엔드
```

- [ ] **Step 5: `docs/IMPLEMENTATION-PLAN.md`** — Spec 경로는 저장소 내 경로로, 원본 레포 줄은 대상 레포 줄로, LICENSE 줄에서 저자 표기 제거

old:
```
**Spec:** `E:\github\SUH-DEVOPS-TEMPLATE\docs\superpowers\specs\2026-07-08-projectops-oss-design.md` (승인됨)

**Source repo (복사 원본):** `E:\github\SUH-DEVOPS-TEMPLATE` — 아래에서 `$SRC`로 표기. 신규 레포는 `$DST` = `E:\github\project-auto-wizard`.
```
new:
```
**Spec:** `docs/2026-07-08-projectops-oss-design.md` (승인됨)

**대상 레포:** 신규 레포는 `$DST` = `E:\github\project-auto-wizard`. (이 문서의 `$SRC`는 당시 작업에서 참조하던 복사 원본 경로이며 현재는 사용하지 않는다.)
```
old:
```
- [ ] **Step 3: LICENSE(MIT, author Cassiiopeia), .gitignore(
```
new:
```
- [ ] **Step 3: LICENSE(MIT), .gitignore(
```

- [ ] **Step 6: `docs/superpowers/specs/2026-07-25-osscontest-scope-design.md`** — 81행 끝의 라이선스 서술 문장만 삭제

old:
```
"깨끗한 리포트" 한 장을 첨부용으로 준비. 원본 `SUH-DEVOPS-TEMPLATE`(Cassiiopeia/projectops)에서 포팅한 코드가 본인 소유임을 확인해 라이선스 충돌 없음을 명시.
```
new:
```
"깨끗한 리포트" 한 장을 첨부용으로 준비.
```

- [ ] **Step 7: 확인**

```bash
cd ROOT && grep -rn "Cassiiopeia" docs --exclude=2026-09-21-suh-naming-generalization.md | grep -v "workflow-pat-optional" || echo "Cassiiopeia 출처 표기 잔존 없음"
grep -n "원본:" docs/DESIGN-SPEC.md docs/BRAINSTORMING.md docs/2026-07-08-projectops-oss-design.md || echo "'원본:' 헤더 없음"
```
Expected: 두 줄 모두 "없음" 메시지. (`2026-08-24-workflow-pat-optional-design.md`의 `Cassiiopeia 개인 PAT` 언급은 출처 표기가 아니라 계정 서술이므로 유지하며, 위 `grep -v`가 제외한다.)

**Commit group:** `docs:` — 위 6개 파일.

---

### Task 7: 이 레포의 issue helper 브랜치 자동 생성 켜기

**Files:**
- Modify: `.github/workflows/PROJECT-COMMON-ISSUE-HELPER.yaml:41-42`
- Modify: `tests/node/payload-yaml.test.js:528-532` (도그푸딩 사본 base 브랜치 단언)

- [ ] **Step 1: 두 값만 변경** — Edit 도구로 정확히 바꾼다(`# @wizard ask:false` 마커 주석과 `contents: write` 권한은 그대로).

old:
```
      ISSUE_HELPER_CREATE_BRANCH: "false" # @wizard ask:false
      ISSUE_HELPER_BASE_BRANCH: "main"
```
new:
```
      ISSUE_HELPER_CREATE_BRANCH: "true" # @wizard ask:false
      ISSUE_HELPER_BASE_BRANCH: "develop"
```

- [ ] **Step 2: RED 확인 — 기존 테스트가 이 변경을 잡는다**

```bash
cd ROOT && node --test --test-reporter=tap tests/node/payload-yaml.test.js 2>&1 | grep -E "^(not ok|# (pass|fail))"
```
Expected: `not ok ... 도그푸딩 사본 PROJECT-COMMON-ISSUE-HELPER는 {{MAIN_BRANCH}}가 main으로 치환되어 있다`, `# fail 1`. (`tests/node/payload-yaml.test.js:531`이 `ISSUE_HELPER_BASE_BRANCH:\s*"main"`을 단언하기 때문이다.)

- [ ] **Step 3: 테스트 갱신** — Edit 도구로 `tests/node/payload-yaml.test.js`의 해당 테스트를 정확히 바꾼다. 플레이스홀더 미치환 단언은 그대로 두고 base 브랜치 단언만 `develop`으로 바꾼다.

old:
```js
test("도그푸딩 사본 PROJECT-COMMON-ISSUE-HELPER는 {{MAIN_BRANCH}}가 main으로 치환되어 있다", () => {
  const text = readFileSync(join(".github", "workflows", "PROJECT-COMMON-ISSUE-HELPER.yaml"), "utf8");
  assert.ok(!text.includes("{{MAIN_BRANCH}}"), "플레이스홀더가 치환되지 않았습니다");
  assert.match(text, /ISSUE_HELPER_BASE_BRANCH:\s*"main"/);
});
```
new:
```js
test("도그푸딩 사본 PROJECT-COMMON-ISSUE-HELPER는 {{MAIN_BRANCH}}가 치환되어 있고 base 브랜치가 develop이다", () => {
  const text = readFileSync(join(".github", "workflows", "PROJECT-COMMON-ISSUE-HELPER.yaml"), "utf8");
  assert.ok(!text.includes("{{MAIN_BRANCH}}"), "플레이스홀더가 치환되지 않았습니다");
  assert.match(text, /ISSUE_HELPER_BASE_BRANCH:\s*"develop"/);
});
```

- [ ] **Step 4: GREEN 및 검증**

```bash
cd ROOT && node --test --test-reporter=tap tests/node/payload-yaml.test.js 2>&1 | grep -E "^(not ok|# (pass|fail))"
grep -n "ISSUE_HELPER_CREATE_BRANCH:\|ISSUE_HELPER_BASE_BRANCH:" .github/workflows/PROJECT-COMMON-ISSUE-HELPER.yaml && actionlint .github/workflows/PROJECT-COMMON-ISSUE-HELPER.yaml && echo "actionlint OK"
git diff --stat -- payload/workflows/common/PROJECT-COMMON-ISSUE-HELPER.yaml | tail -1 || true
```
Expected: `# fail 0`, 두 줄이 새 값으로 출력되고 `actionlint OK`. `payload/` 템플릿은 diff가 없어야 한다(출력 없음). `tests/node/payload-yaml.test.js:440-445`와 `tests/node/env-plan.test.js:116-132`는 payload 템플릿 기본값(`"false"`, `{{MAIN_BRANCH}}`)을 보므로 영향이 없다.

**Commit group:** `ci:` — `.github/workflows/PROJECT-COMMON-ISSUE-HELPER.yaml` + `tests/node/payload-yaml.test.js`(두 파일을 같은 커밋에 넣어야 커밋 단독 GREEN).

---

### Task 8: 최종 검증

- [ ] **Step 1: 가드 GREEN**

```bash
cd ROOT && node --test --test-reporter=tap tests/node/legacy-naming-guard.test.js 2>&1 | grep -E "^# (pass|fail)"
```
Expected: `# pass 1`, `# fail 0`.

- [ ] **Step 2: 전체 테스트**

```bash
cd ROOT && npm run test:node -- --test-reporter=tap 2>&1 | grep -E "^(not ok|# (tests|pass|fail))"; npm run test:py 2>&1 | tail -4
```
Expected: node는 기준선 518 + 가드 1 = 519개 전부 pass(`# fail 0`), python은 160개 OK(skipped 4). 실패가 있으면 Task 1 Step 1의 기준선과 비교해 이번 변경이 원인인지 판단하고 보고한다.

- [ ] **Step 3: 잔존 이름 목록 대조**

```bash
cd ROOT && git grep -il -E "suh|projectops" -- . ':!docs' | sort; echo "---untracked new files---"; git status --short | grep '^??'
```
Expected: 추적 파일 중 docs 밖의 매치는 `tests/node/payload-example-values.test.js`(기존 `suhsaechan.kr`·`Suh-Web/` 금지 패턴)와 `tests/node/legacy-naming-guard.test.js`(가드 자신, 아직 미추적이라 목록에 안 나올 수 있음)뿐이어야 한다. 그 외 파일이 나오면 잔존 치환 누락이다. 미추적 목록에는 `PROJECT-FLUTTER-APP-BUILD-TRIGGER.yaml`, `docs/hypercortex/`, `tests/node/legacy-naming-guard.test.js`, 이 플랜 문서가 보인다.

- [ ] **Step 4: 변경 범위 확인**

```bash
cd ROOT && git status --short | sed 's/^/  /'
```
Expected: 이 플랜의 "File Structure" 표에 없는 파일이 변경 목록에 없어야 한다(`LICENSE`, `README.md`, `package.json`, `version.yml`, `CHANGELOG.*` 변경 없음).

---

## 커밋 그룹 (구현 완료 후 `/prp-commit`이 사용)

각 커밋이 단독으로 GREEN이 되도록 아래 순서로 만든다. 메시지는 한국어이며 타입 접두사만 영어다. 이번 PR에서 `feat:`는 3번 하나뿐이다(자동 버전 로직이 minor로 승격, `!` 사용 금지).

| 순서 | 타입 | 대상 | 비고 |
|---|---|---|---|
| 1 | `refactor:` | `src/core/verify.js`, `tests/node/verify.test.js`, `PROJECT-COMMON-SECRET-FILE-UPLOAD.yaml` | 센티널 `__WIZARD_*__` |
| 2 | `chore:` | `docs/hypercortex/`(이동) | `git add docs/suh-template docs/hypercortex`로 rename 인식 |
| 3 | `refactor:` | `{.github,payload}/scripts/*.py`, `tests/py/*` | `projectops`·`SUH-DEVOPS-TEMPLATE` 식별자 |
| 4 | `feat:` | PR-PREVIEW 3종, Flutter 트리거(이동 포함), ANDROID/IOS 안내 문구 | **breaking 본문 필수.** rename 인식을 위해 `git add payload/workflows/flutter/`처럼 옛 경로 삭제와 새 경로 추가를 **같은 커밋에** 스테이징한다 |
| 5 | `ci:` | `.github/workflows/PROJECT-COMMON-ISSUE-HELPER.yaml`, `tests/node/payload-yaml.test.js` | 자동 생성 켜기(테스트 단언 갱신 포함, 둘을 함께 커밋해야 단독 GREEN) |
| 6 | `docs:` | 출처·라이선스 표기 6개 문서 | |
| 7 | `test:` | `tests/node/legacy-naming-guard.test.js` | 모든 이름 정리 후라 GREEN |
| 8 | `docs:` | 이 플랜 문서 | #127 선례 |

## PR (구현 검토 후 `/prp-pr`)

- base는 `develop`, head는 이 브랜치다. 본문에 다음을 넣는다: 변경 요약, breaking 안내(옛 `@suh-lab` 명령어 미지원, 옛 Flutter 트리거 파일이 설치된 저장소는 재설치 후 `PROJECT-FLUTTER-SUH-LAB-APP-BUILD-TRIGGER.yaml`을 직접 삭제), `Refs #128`(자동 종료 `Closes`는 기존 방식대로 `develop`→`main` 릴리스 PR에서 연결), 자동 생성 설정이 `main` 릴리스 이후부터 적용된다는 안내, 검증 결과.

## 알려진 위험과 범위 밖 항목

1. **마커 문자열이 PR-PREVIEW의 "브랜치 없음" 안내 댓글에도 출력된다.** 이 댓글은 마커를 코드 스팬으로 그대로 보여 준다(`| **마커** | \`${marker}\` |`). 이슈 제목을 나중에 수정하면 `issue_helper.py`의 `upsert_comment`가 "마커가 본문에 포함된 첫 댓글"을 갱신 대상으로 삼으므로, 이 안내 댓글이 먼저 있으면 그 댓글이 helper 본문으로 덮어써질 수 있다. 발생 조건이 좁고(이슈에 helper 댓글이 없는 상태에서 `/wizard server build`를 쓴 뒤 제목 수정) 이번 이슈 범위 밖이라 **코드는 바꾸지 않고** 최종 보고에 남긴다.
2. `contains()`는 대소문자를 구분하지 않고 bash 정규식은 구분하는 기존 불일치는 그대로 둔다.
3. `/wizard`는 경로 문자열(`src/wizard/...` 등)이 댓글에 있으면 `if:` 1차 조건을 통과할 수 있으나, 뒤이은 정규식이 걸러 "server 명령어가 아님" 로그로 끝난다. 기존 `@suh-lab`과 같은 성격이다.
4. 봇이 남긴 안내 댓글이 다시 트리거를 깨우지 않게 하는 방어(`user.type != 'Bot'`)는 원래 없었고 이번에도 추가하지 않는다.
5. 자동 브랜치 생성은 `issues` 이벤트가 기본 브랜치(`main`)의 워크플로우 버전으로 실행되므로, 이번 PR이 `main`에 릴리스된 뒤 생성되는 이슈부터 적용된다.
6. **자동 생성이 켜지면 이슈 제목을 수정할 때마다 새 브랜치가 추가로 만들어진다.** `issue_helper.py`가 `issues: [opened, edited(제목 변경)]`마다 새 브랜치명을 계산해 `create_branch_if_needed`를 호출하고, 옛 브랜치는 남는다(이미 존재하면 422로 건너뜀). `develop`은 원격에 있고 보호 규칙이 없어 `GITHUB_TOKEN`(`contents: write`)으로 생성 가능하다. 의도된 동작이므로 코드는 바꾸지 않고 최종 보고에 남긴다.
7. Flutter 트리거와 PR-PREVIEW 3종의 오류 안내 문구("댓글에 `### 브랜치` 섹션이 있는지 확인하세요")는 `### 브랜치`만 언급한다. 정규식은 `### 브랜치명`도 받도록 보정하지만 문구는 이번 범위 밖이라 그대로 둔다.
8. 가드 테스트(`legacy-naming-guard.test.js`)는 `readdirSync`로 작업 트리를 읽으므로 `.DS_Store`·`__pycache__` 같은 미추적 파일도 검사한다. 현재 해당 파일이 없고 CI는 깨끗한 체크아웃이라 영향이 없다. 오탐이 생기면 `git ls-files` 기반으로 바꾸는 방안을 쓴다.
