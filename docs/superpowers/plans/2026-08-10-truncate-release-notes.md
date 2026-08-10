# truncate_release_notes 스크립트 추가 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 배포 워크플로우 3개(`PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD`, `PROJECT-FLUTTER-ANDROID-FIREBASE-CICD`, `PROJECT-FLUTTER-IOS-TESTFLIGHT`)가 스토어 업로드 직전 호출하는 `truncate_release_notes` 스크립트를 Python으로 신설하고, npm 패키지·설치 파이프라인·uninstall/summary UI까지 전 구간에 배선해 배포가 `exit 127`로 중단되는 문제(#51)를 고친다.

**Architecture:** `payload/scripts/truncate_release_notes.py` (stdlib-only, `version_manager.py`와 동일한 argparse + `main(argv) -> int` 관례)를 신설한다. 워크플로우 3곳의 호출부를 `bash .../*.sh` → `python3 .../*.py`로 바꾼다. `src/core/copy/simple.js`·`src/core/removal-plan.js`·`src/ui/summary.js`의 하드코딩된 두 스크립트 이름 배열/텍스트에 세 번째 항목을 추가해 실제 설치·제거·안내가 전부 새 스크립트를 인식하게 한다.

**Tech Stack:** Node.js(`node:test`, ESM), Python 3(stdlib only, `argparse`/`unittest`), GitHub Actions YAML.

## Global Constraints

- `payload/scripts/`는 Python 전용이다 — `.sh` 파일을 추가하지 않는다 (`docs/DESIGN-SPEC.md` §2 "sh 금지", `CONTRIBUTING.md`).
- 신규 스크립트는 서드파티 의존성을 쓰지 않는다 (stdlib only — 기존 `version_manager.py`/`changelog_manager.py`와 동일 원칙).
- 스크립트 계약: `truncate_release_notes.py <file> <limit:int> <char|byte>`. 파일 없음 → exit 0(무동작). 한도 이내 → exit 0(무변경). 한도 초과 → 제자리에서 truncate 후 exit 0. `limit <= 0` → exit 1. 인자 개수/타입/모드 오류는 `argparse` 표준 처리(exit 2)에 맡긴다.
- 파일 I/O는 `newline=""`로 열어 원본의 LF/CRLF를 보존한다 (`version_manager.py`의 기존 계약과 동일 — `test_lf_file_stays_lf_after_set` / `test_crlf_file_stays_crlf_after_set` 참고).
- 원본 파일이 UTF-8이 아니어도 읽기 단계에서 죽지 않는다 (`errors="replace"`로 읽는다, `errors="strict"`/`surrogateescape` 금지).
- 콘솔 인코딩이 non-UTF-8이어도 안내 메시지 출력이 죽지 않도록 `sys.stdout.reconfigure(errors="replace")` / `sys.stderr.reconfigure(errors="replace")`를 적용한다.
- 잘림 표시(`...` 등 마커 텍스트)는 추가하지 않는다 — 순수 하드 truncate.
- 커밋 메시지는 한국어로 작성한다 (Conventional Commits 타입 접두사는 영어 유지) — `CLAUDE.md` 프로젝트 규칙.
- 브랜치는 이미 `20260810_#51_truncate_release_notes_sh_패키지_미포함_배포_실패`로 체크아웃되어 있다 (worktree 아님, 일반 브랜치 체크아웃). 각 태스크 커밋은 이 브랜치에 쌓는다.
- 테스트 실행: Python은 `python3 -m unittest discover -s tests/py -v` (또는 `npm run test:py`), Node는 `node --test <파일 경로>` (또는 `npm run test:node`).

---

### Task 1: `truncate_release_notes.py` 스크립트 + Python 테스트

**Files:**
- Create: `payload/scripts/truncate_release_notes.py`
- Create: `tests/py/test_truncate_release_notes.py`

**Interfaces:**
- Consumes: 없음 (독립 스크립트, stdlib만 사용)
- Produces: CLI `python3 truncate_release_notes.py <file> <limit> <mode>` — exit 0/1/2 계약. Task 2(워크플로우 YAML)가 이 CLI를 그대로 호출하고, Task 3(설치 파이프라인)이 파일명 `"truncate_release_notes.py"` 문자열을 그대로 사용한다.

- [ ] **Step 1: 실패하는 테스트부터 작성**

`tests/py/test_truncate_release_notes.py` 전체 내용:

```python
import os
import subprocess
import sys
import shutil
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "payload" / "scripts" / "truncate_release_notes.py"


def run(args, env=None):
    full_env = {**os.environ, **(env or {})}
    return subprocess.run([sys.executable, str(SCRIPT), *args],
                           capture_output=True, text=True, env=full_env)


class TestTruncateReleaseNotes(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="truncate_")
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.path = Path(self.tmp) / "final_release_notes.txt"

    def write(self, text, encoding="utf-8"):
        self.path.write_bytes(text.encode(encoding) if isinstance(text, str) else text)

    def test_char_mode_truncates_over_limit(self):
        self.write("가" * 20)
        r = run([str(self.path), "10", "char"])
        self.assertEqual(r.returncode, 0)
        text = self.path.read_text(encoding="utf-8")
        self.assertEqual(text, "가" * 10)

    def test_char_mode_leaves_under_limit_untouched(self):
        self.write("hello")
        r = run([str(self.path), "480", "char"])
        self.assertEqual(r.returncode, 0)
        self.assertEqual(self.path.read_text(encoding="utf-8"), "hello")

    def test_byte_mode_truncates_without_splitting_multibyte(self):
        # "가"는 UTF-8로 3바이트 — limit=16(3의 배수가 아님)으로 잘라도
        # 결과는 항상 완전한 문자로만 구성되고 유효한 UTF-8이어야 한다.
        self.write("가" * 10)  # 30바이트
        r = run([str(self.path), "16", "byte"])
        self.assertEqual(r.returncode, 0)
        data = self.path.read_bytes()
        self.assertLessEqual(len(data), 16)
        decoded = data.decode("utf-8")  # 깨진 바이트가 남아있으면 여기서 예외 발생
        self.assertNotIn("�", decoded)
        self.assertEqual(decoded, "가" * 5)  # 15바이트 = 완전한 5글자, 16번째 바이트부터는 버려짐

    def test_byte_mode_leaves_under_limit_untouched(self):
        self.write("hello")
        r = run([str(self.path), "4000", "byte"])
        self.assertEqual(r.returncode, 0)
        self.assertEqual(self.path.read_text(encoding="utf-8"), "hello")

    def test_missing_file_is_noop_exit_0(self):
        missing = Path(self.tmp) / "does_not_exist.txt"
        r = run([str(missing), "480", "char"])
        self.assertEqual(r.returncode, 0)
        self.assertFalse(missing.exists())

    def test_lf_preserved(self):
        self.write("line1\nline2\n" * 50)  # 넉넉히 길게 만들어 truncate 유도
        run([str(self.path), "20", "char"])
        data = self.path.read_bytes()
        self.assertNotIn(b"\r\n", data)

    def test_crlf_preserved(self):
        self.write(("line1\r\nline2\r\n" * 50))
        run([str(self.path), "20", "char"])
        data = self.path.read_bytes()
        self.assertGreater(data.count(b"\r\n"), 0)
        self.assertEqual(data.count(b"\n"), data.count(b"\r\n"))

    def test_limit_zero_rejected(self):
        self.write("hello")
        r = run([str(self.path), "0", "char"])
        self.assertEqual(r.returncode, 1)
        self.assertEqual(self.path.read_text(encoding="utf-8"), "hello")

    def test_limit_negative_rejected(self):
        self.write("hello")
        r = run([str(self.path), "-5", "char"])
        self.assertEqual(r.returncode, 1)
        self.assertEqual(self.path.read_text(encoding="utf-8"), "hello")

    def test_non_utf8_input_does_not_crash(self):
        self.write(b"\xff\xfe\x00broken")
        r = run([str(self.path), "3", "char"])
        self.assertEqual(r.returncode, 0)

    def test_idempotent_on_rerun(self):
        self.write("가" * 20)
        run([str(self.path), "10", "char"])
        first = self.path.read_text(encoding="utf-8")
        r = run([str(self.path), "10", "char"])
        self.assertEqual(r.returncode, 0)
        self.assertEqual(self.path.read_text(encoding="utf-8"), first)

    def test_survives_non_utf8_console_encoding(self):
        self.write("가" * 20)
        r = run([str(self.path), "10", "char"], env={"PYTHONIOENCODING": "ascii"})
        self.assertEqual(r.returncode, 0)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `python3 -m unittest tests.py.test_truncate_release_notes -v` (레포 루트에서 실행)
Expected: 전부 실패 또는 에러 — `payload/scripts/truncate_release_notes.py` 파일이 아직 없으므로 subprocess가 `FileNotFoundError`류로 죽거나 nonzero returncode를 반환.

- [ ] **Step 3: 최소 구현 작성**

`payload/scripts/truncate_release_notes.py` 전체 내용:

```python
#!/usr/bin/env python3
"""
truncate_release_notes.py — truncate a release notes file in place to fit a
store-imposed length limit (stdlib only).

This script is copied into user repos (.github/scripts/) by project-auto-wizard
and is called by the Flutter deploy workflows right before store upload
(Google Play, Firebase App Distribution, App Store Connect) — each of which
enforces its own release-notes length limit.

Usage:
    truncate_release_notes.py <file> <limit> <char|byte>

Behavior:
    - Missing file: no-op, exit 0 (a missing notes file is not a reason to
      block deployment).
    - File within limit: left unchanged, exit 0.
    - File over limit: truncated in place to `limit`, no marker text added.
      char mode counts Unicode code points (Google Play); byte mode counts
      UTF-8 bytes and never splits a multi-byte character (Firebase / App
      Store Connect).
    - Bytes in the input that are not valid UTF-8 are replaced, never fatal.

Contract:
    - Exit 0 on success (including the no-op cases above).
    - Exit 1 if `limit` is not a positive integer (caller bug).
    - Exit 2 on argument-parsing errors (argparse default — wrong arg count,
      non-integer limit, unknown mode).
"""

import argparse
import sys


def log(message):
    print(message, file=sys.stderr)


def truncate_text(text, limit, mode):
    if mode == "char":
        return text[:limit]
    return text.encode("utf-8")[:limit].decode("utf-8", errors="ignore")


def run(path, limit, mode):
    try:
        with open(path, "r", encoding="utf-8", newline="", errors="replace") as f:
            text = f.read()
    except FileNotFoundError:
        log(f"릴리즈 노트 파일 없음, 건너뜀: {path}")
        return 0

    length = len(text) if mode == "char" else len(text.encode("utf-8"))
    if length <= limit:
        log(f"한도 이내 ({length}/{limit} {mode}), 자르지 않음: {path}")
        return 0

    truncated = truncate_text(text, limit, mode)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(truncated)

    log(f"한도 초과 ({length} -> {limit} {mode} 이하로 절단): {path}")
    return 0


def build_parser():
    parser = argparse.ArgumentParser(prog="truncate_release_notes.py")
    parser.add_argument("file")
    parser.add_argument("limit", type=int)
    parser.add_argument("mode", choices=["char", "byte"])
    return parser


def main(argv=None):
    sys.stdout.reconfigure(errors="replace")
    sys.stderr.reconfigure(errors="replace")

    parser = build_parser()
    args = parser.parse_args(argv)

    if args.limit <= 0:
        log(f"ERROR: limit은 양수여야 함: {args.limit}")
        return 1

    return run(args.file, args.limit, args.mode)


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `python3 -m unittest tests.py.test_truncate_release_notes -v` (레포 루트에서 실행)
Expected: 전부 PASS (13개 테스트)

전체 Python 스위트도 함께 돌려 회귀가 없는지 확인:
Run: `npm run test:py`
Expected: 전부 PASS

- [ ] **Step 5: 실행 권한 부여 및 커밋**

```bash
chmod +x payload/scripts/truncate_release_notes.py
git add payload/scripts/truncate_release_notes.py tests/py/test_truncate_release_notes.py
git commit -m "feat: truncate_release_notes.py 스크립트 추가 (#51)

배포 워크플로우가 호출하는 스크립트가 패키지에 없어 배포가 exit 127로
중단되던 문제. Python으로 신설 — sh 금지 설계 원칙(DESIGN-SPEC §2) 준수.
char/byte 두 모드, 한도 이내·파일 없음 시 무동작, 멀티바이트 경계 안전,
LF/CRLF 보존, non-UTF-8 입력·콘솔 인코딩에도 죽지 않도록 방어."
```

---

### Task 2: 워크플로우 호출부 전환 + payload YAML 가드 테스트

**Files:**
- Modify: `payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml:668`
- Modify: `payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml:567`
- Modify: `payload/workflows/flutter/PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml:448`
- Modify: `tests/node/payload-yaml.test.js` (기존 `"no .sh script references in payload"` 테스트, 39-43번째 줄 부근)

**Interfaces:**
- Consumes: Task 1이 만든 `payload/scripts/truncate_release_notes.py`의 CLI 계약 (`<file> <limit> <char|byte>`, exit 0/1/2)
- Produces: 워크플로우 3곳이 이제 `bash *.sh` 대신 `python3 *.py`를 호출 — Task 3과는 무관(설치 파이프라인은 파일명만 알면 됨)

- [ ] **Step 1: 워크플로우 3곳의 호출부를 bash → python3로 교체**

`payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml:668`, 정확히 이 줄만 교체:

```diff
-            bash "$GITHUB_WORKSPACE/.github/scripts/truncate_release_notes.sh" "$GITHUB_WORKSPACE/final_release_notes.txt" 480 char
+            python3 "$GITHUB_WORKSPACE/.github/scripts/truncate_release_notes.py" "$GITHUB_WORKSPACE/final_release_notes.txt" 480 char
```

`payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml:567`, 정확히 이 줄만 교체:

```diff
-            bash ./.github/scripts/truncate_release_notes.sh final_release_notes.txt 4000 char
+            python3 ./.github/scripts/truncate_release_notes.py final_release_notes.txt 4000 char
```

`payload/workflows/flutter/PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml:448`, 정확히 이 줄만 교체:

```diff
-            bash "$GITHUB_WORKSPACE/.github/scripts/truncate_release_notes.sh" "$GITHUB_WORKSPACE/final_release_notes.txt" 3800 byte
+            python3 "$GITHUB_WORKSPACE/.github/scripts/truncate_release_notes.py" "$GITHUB_WORKSPACE/final_release_notes.txt" 3800 byte
```

각 파일의 다른 줄은 건드리지 않는다 (인접 주석·따옴표 스타일 그대로 유지).

- [ ] **Step 2: payload YAML 가드 테스트에 신규 스크립트 assertion 추가**

`tests/node/payload-yaml.test.js`의 기존 테스트:

```js
test("no .sh script references in payload", () => {
  for (const f of files) {
    assert.ok(!readFileSync(f, "utf8").includes("version_manager.sh"), f);
  }
});
```

를 다음으로 교체 (동일 스타일로 두 번째 assertion 추가):

```js
test("no .sh script references in payload", () => {
  for (const f of files) {
    const body = readFileSync(f, "utf8");
    assert.ok(!body.includes("version_manager.sh"), f);
    assert.ok(!body.includes("truncate_release_notes.sh"), f);
  }
});
```

- [ ] **Step 3: 회귀 테스트 먼저 실행해 가드가 잡아내는지 확인 (아직 워크플로우 안 고쳤다면 실패해야 정상이지만, Step 1을 먼저 했으므로 이미 통과할 것 — 통과 확인)**

Run: `node --test tests/node/payload-yaml.test.js`
Expected: 전부 PASS

- [ ] **Step 4: YAML 유효성 및 관련 워크플로우 스위트 실행**

Run: `node --test tests/node/payload-yaml.test.js tests/node/workflow-action-versions.test.js`
Expected: 전부 PASS (YAML 문법이 깨지지 않았는지, 액션 버전 규칙에 위배되지 않는지 확인)

- [ ] **Step 5: 커밋**

```bash
git add payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml \
        payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml \
        payload/workflows/flutter/PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml \
        tests/node/payload-yaml.test.js
git commit -m "fix: 배포 워크플로우 3곳의 릴리스 노트 절단 호출을 python3로 전환 (#51)

존재하지 않는 truncate_release_notes.sh(bash)를 호출해 배포가 exit 127로
중단되던 문제. Task 1에서 추가한 truncate_release_notes.py를 호출하도록
변경. 재발 방지를 위해 payload .sh 참조 금지 가드 테스트에도 추가."
```

---

### Task 3: 설치 파이프라인 배선 (copyScripts / removal-plan / summary)

**Files:**
- Modify: `src/core/copy/simple.js:11`
- Modify: `src/core/removal-plan.js:65`
- Modify: `src/ui/summary.js:88-90`
- Modify: `src/core/paths.js:10` (주석)
- Modify: `tests/node/assets.test.js:61-70`

**Interfaces:**
- Consumes: Task 1이 만든 파일명 `"truncate_release_notes.py"` (문자열 리터럴로만 참조, import 없음)
- Produces: `copyScripts()`가 3개 스크립트를 설치, `planRemoval()`이 3개를 제거 대상으로 인식, 안내 텍스트가 3개를 표시 — 이 태스크로 #51의 실제 배포 실패(설치 파이프라인 누락)가 완전히 해소됨

- [ ] **Step 1: 실패하는 테스트부터 수정 (assets.test.js)**

`tests/node/assets.test.js`의 기존 테스트:

```js
test("copyScripts installs payload python scripts into .github/scripts/", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-scripts-"));
  try {
    const copied = copyScripts(resolvePayloadRoot(), target);
    assert.strictEqual(copied, 2);
    assert.ok(existsSync(join(target, ".github", "scripts", "version_manager.py")));
    assert.ok(existsSync(join(target, ".github", "scripts", "changelog_manager.py")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

를 다음으로 교체:

```js
test("copyScripts installs payload python scripts into .github/scripts/", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-scripts-"));
  try {
    const copied = copyScripts(resolvePayloadRoot(), target);
    assert.strictEqual(copied, 3);
    assert.ok(existsSync(join(target, ".github", "scripts", "version_manager.py")));
    assert.ok(existsSync(join(target, ".github", "scripts", "changelog_manager.py")));
    assert.ok(existsSync(join(target, ".github", "scripts", "truncate_release_notes.py")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인 (아직 simple.js를 안 고쳤으므로 3 assertion과 파일 존재 assertion이 실패해야 정상)**

Run: `node --test tests/node/assets.test.js`
Expected: `copyScripts installs payload python scripts into .github/scripts/` 테스트 FAIL (`copied`가 여전히 2, `truncate_release_notes.py` 파일 미존재)

- [ ] **Step 3: `copyScripts()` 배열에 추가**

`src/core/copy/simple.js`의:

```js
export function copyScripts(payloadRoot, targetRoot = ".") {
  const scripts = ["version_manager.py", "changelog_manager.py"];
```

를:

```js
export function copyScripts(payloadRoot, targetRoot = ".") {
  const scripts = ["version_manager.py", "changelog_manager.py", "truncate_release_notes.py"];
```

로 교체.

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `node --test tests/node/assets.test.js`
Expected: 전부 PASS

- [ ] **Step 5: `planRemoval()` 배열에 추가 (uninstall/purge가 여기서 파생됨)**

`src/core/removal-plan.js`의:

```js
  for (const s of ["version_manager.py", "changelog_manager.py"]) {
    if (existsSync(join(targetRoot, PATHS.scriptsDir, s))) removedScripts.push(s);
  }
```

를:

```js
  for (const s of ["version_manager.py", "changelog_manager.py", "truncate_release_notes.py"]) {
    if (existsSync(join(targetRoot, PATHS.scriptsDir, s))) removedScripts.push(s);
  }
```

로 교체.

- [ ] **Step 6: `removal-plan.test.js`에 새 스크립트가 제거 대상으로 인식되는지 확인하는 assertion 추가**

`tests/node/removal-plan.test.js`의:

```js
    const plan = planRemoval(resolvePayloadRoot(), target);
    assert.ok(plan.workflows.length > 0);
    assert.ok(plan.scripts.includes("version_manager.py"));
```

를:

```js
    const plan = planRemoval(resolvePayloadRoot(), target);
    assert.ok(plan.workflows.length > 0);
    assert.ok(plan.scripts.includes("version_manager.py"));
    assert.ok(plan.scripts.includes("truncate_release_notes.py"));
```

로 교체 (첫 번째 테스트 `"planRemoval: lists files without deleting anything"` 안).

- [ ] **Step 7: 안내 텍스트(summary.js)에 추가**

`src/ui/summary.js`의:

```js
  err("  🔧 .github/scripts/");
  err("     ├─ version_manager.py");
  err("     └─ changelog_manager.py");
```

를:

```js
  err("  🔧 .github/scripts/");
  err("     ├─ version_manager.py");
  err("     ├─ changelog_manager.py");
  err("     └─ truncate_release_notes.py");
```

로 교체 (마지막 줄의 `├─`/`└─` 트리 문자 위치가 항목 추가로 바뀌는 것에 주의 — 마지막 항목만 `└─`).

- [ ] **Step 8: `summary-output.test.js`가 이 텍스트를 검증하는지 확인하고, 검증한다면 갱신**

Run: `grep -n "version_manager.py\|changelog_manager.py" tests/node/summary-output.test.js tests/node/summary-accuracy-cli.test.js`

해당 문자열을 assert하는 줄이 있다면 `truncate_release_notes.py`를 반영해 갱신한다. 없다면 이 스텝은 건너뛴다.

- [ ] **Step 9: `paths.js` 주석 갱신**

`src/core/paths.js`의:

```js
  scriptsDir: "scripts",       // payload/scripts/*.py
```

주석은 이미 글롭 패턴(`*.py`)이라 파일 하나 추가로는 부정확해지지 않는다 — **수정 불필요**. (기존 스펙 문서의 "주석 갱신" 항목은 이 확인으로 대체한다.)

- [ ] **Step 10: 관련 Node 테스트 스위트 전체 실행**

Run: `node --test tests/node/assets.test.js tests/node/removal-plan.test.js tests/node/uninstall-plan.test.js tests/node/uninstall-cli.test.js tests/node/uninstall-flow.test.js tests/node/interactive-mode-uninstall.test.js tests/node/purge-plan.test.js tests/node/purge-cli.test.js tests/node/dry-run-cli.test.js tests/node/summary-output.test.js tests/node/summary-accuracy-cli.test.js tests/node/e2e-matrix.test.js`
Expected: 전부 PASS

- [ ] **Step 11: 전체 테스트 스위트 실행 (Node + Python)**

Run: `npm test`
Expected: 전부 PASS

- [ ] **Step 12: 커밋**

```bash
git add src/core/copy/simple.js src/core/removal-plan.js src/ui/summary.js \
        tests/node/assets.test.js tests/node/removal-plan.test.js
git commit -m "fix: 설치·제거·안내 파이프라인에 truncate_release_notes.py 배선 (#51)

payload에 스크립트가 있어도 copyScripts()·planRemoval()의 하드코딩된
목록에 없으면 사용자 프로젝트에 설치/제거/안내되지 않던 문제. 세
스크립트 모두 동일하게 인식되도록 배열과 안내 텍스트에 추가."
```

---

## Self-Review Notes (완료 후 확인용)

- **스펙 커버리지**: §4 계약(파일 없음/한도 이내/한도 초과/인자 오류/개행 보존/디코드 정책/콘솔 인코딩) → Task 1. §5 변경 범위(워크플로우 3곳, 설치 파이프라인 4곳, 테스트 3곳) → Task 2·3에 전부 매핑됨. §6 테스트 전략(subprocess 방식, PYTHONIOENCODING 검증) → Task 1 Step 1에 반영됨.
- **플레이스홀더 없음**: 모든 스텝에 실행 가능한 실제 코드/명령이 포함됨.
- **타입/이름 일관성**: 파일명 `truncate_release_notes.py`가 Task 1(생성)·Task 2(워크플로우 호출)·Task 3(설치 배열)에서 동일하게 사용됨. 함수 시그니처 변경 없음(순수 문자열 배열 추가이므로 타입 불일치 리스크 없음).
