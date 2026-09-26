# Copilot 모델을 `auto` 전용으로 고정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Copilot CLI 호출이 항상 `--model auto`를 쓰도록 고정해, Copilot Free/Student 계정에서도 기본 상태로 AI 요약과 SemVer 보조 판정이 동작하게 한다.

**Architecture:** 모델 선택 자체를 없앤다. `_COPILOT_DEFAULT_MODEL`(`claude-haiku-4.5`)과 `COPILOT_MODEL` 환경변수 읽기를 제거하고 `--model auto`를 상수로 전달한다. 워크플로우 3종(AI-PR-SUMMARY, AUTO-CHANGELOG-CONTROL 2곳, RELEASE-PUBLISH)의 `COPILOT_MODEL: ${{ vars.COPILOT_MODEL }}` 전달과 안내 주석·README를 함께 정리한다. 기존 저장소 변수 `COPILOT_MODEL`은 조용히 무시한다(경고·폴백 shim 없음).

**Tech Stack:** Python 3 (`unittest`), Node `node:test`, GitHub Actions YAML

**Spec:** 이슈 https://github.com/Twin-Fang/project-auto-wizard/issues/153, 근거 https://github.com/Twin-Fang/project-auto-wizard/issues/137 (QA 보고서). 브레인스토밍 합의는 아래 Global Constraints에 옮겼다.

## Global Constraints

- Copilot 호출은 `--model auto`만 사용한다. 모델명 지정 경로(환경변수, 저장소 변수, 코드 상수 기본값)를 남기지 않는다. 근거: 공식 문서 "Copilot Student and Copilot Free users have access to models through auto model selection only." (docs.github.com/en/copilot/reference/ai-models/supported-models)
- 유료 플랜 전용 동작(모델 지정)은 지원·검증 범위 밖이다.
- 기존 설치본 호환은 고려하지 않는다. 기존 `vars.COPILOT_MODEL` 값은 조용히 무시하고, 경고·폴백을 만들지 않는다.
- `payload/`와 `.github/`(도그푸딩) 사본은 반드시 같은 내용으로 맞춘다. 파이썬 테스트는 `payload/scripts`만 import하므로 `.github/scripts` 사본은 손으로 동기화해야 한다.
- 커밋 메시지는 한국어로 쓴다. Conventional Commits 타입 접두사(`fix:`, `docs:`, `chore:` 등)만 영어. 커밋과 PR은 이 plan 안에서 만들지 않는다(사용자 워크플로우의 `/prp-commit`, `/prp-pr` 단계에서 수행).
- git force 계열 옵션(`add -f`, `reset --hard`, `branch -D`, `--no-verify` 등)을 쓰지 않는다. `.gitignore`로 제외된 파일은 그대로 존중한다.
- 범위 밖: #154(빈 원격 레포), #156(대화형 플래그), #157(fallback 사유 노출), 조직 감지, 보고서의 개선 제안 5건.

## Review Focus

- 실행 환경에 `COPILOT_MODEL`이 설정돼 있어도 `--model`은 `auto`여야 한다 (오래된 저장소 변수가 남아 있는 설치본). Task 1에서 테스트로 고정한다.
- 워크플로우가 `COPILOT_MODEL`을 더 이상 전달하지 않아야 하고, 도그푸딩 사본도 동일해야 한다. Task 2에서 테스트로 고정한다.
- `.github/scripts/changelog_manager.py`가 `payload/scripts/changelog_manager.py`와 어긋나면 이 레포 자체의 도그푸딩이 옛 동작을 유지한다. Task 1 마지막 단계에서 `cmp`로 확인한다.
- README·주석에 `claude-haiku-4.5`나 `COPILOT_MODEL` 안내가 남으면 같은 결함이 재발한다. Task 3의 grep 검증으로 잡는다.

---

### Task 1: Copilot 호출을 `--model auto` 고정으로 변경 (TDD)

**Files:**
- Modify: `tests/py/test_copilot_engine.py:73-80`
- Modify: `payload/scripts/changelog_manager.py:697`, `:732`, `:739`
- Modify: `.github/scripts/changelog_manager.py` (payload 사본 복사)

**Interfaces:**
- Produces: `changelog_manager._COPILOT_MODEL: str == "auto"`. `call_copilot_cli(prompt: str) -> str` 시그니처는 불변이며 `--model auto`를 전달한다. `_COPILOT_DEFAULT_MODEL`은 삭제된다.

- [ ] **Step 1: 실패하는 테스트로 교체**

`tests/py/test_copilot_engine.py`에서 73번째 줄을 아래로 바꾼다.

```python
        self.assertEqual(args[args.index("--model") + 1], "auto")
```

그리고 `test_model_can_be_overridden_by_env`(75~80행) 전체를 아래 테스트로 교체한다.

```python
    def test_model_is_always_auto_even_if_copilot_model_env_is_set(self):
        # Copilot Free/Student는 auto만 허용하므로 모델명 오버라이드를 지원하지 않는다.
        changelog_manager.os.environ["COPILOT_MODEL"] = "my-model"
        with patch.object(changelog_manager.subprocess, "run", return_value=_completed("ok")) as mock_run:
            changelog_manager.call_copilot_cli("PROMPT")
        args = mock_run.call_args.args[0]
        self.assertEqual(args[args.index("--model") + 1], "auto")
```

- [ ] **Step 2: 실패 확인**

Run: `python3 -m unittest discover -s tests/py -p test_copilot_engine.py -v`
Expected: `test_command_is_locked_down_text_only`와 `test_model_is_always_auto_even_if_copilot_model_env_is_set`이 `'claude-haiku-4.5' != 'auto'` 또는 `'my-model' != 'auto'`로 FAIL.

- [ ] **Step 3: 최소 구현**

`payload/scripts/changelog_manager.py`:

697행을 아래로 바꾼다.

```python
# Copilot Free/Student 계정은 모델명 지정이 거부되고 auto 모델 선택만 허용된다 (#153).
_COPILOT_MODEL = "auto"
```

732행 `model = os.environ.get('COPILOT_MODEL') or _COPILOT_DEFAULT_MODEL`을 삭제하고, 739행(원본 기준) `'--model', model,`을 아래로 바꾼다.

```python
                '--model', _COPILOT_MODEL,
```

- [ ] **Step 4: 통과 확인**

Run: `python3 -m unittest discover -s tests/py -p test_copilot_engine.py -v`
Expected: 전부 PASS.

- [ ] **Step 5: 도그푸딩 사본 동기화와 확인**

Run: `cp payload/scripts/changelog_manager.py .github/scripts/changelog_manager.py && cmp payload/scripts/changelog_manager.py .github/scripts/changelog_manager.py && echo identical`
Expected: `identical`

Run: `grep -n "COPILOT_MODEL\|_COPILOT_DEFAULT_MODEL\|claude-haiku" payload/scripts/changelog_manager.py .github/scripts/changelog_manager.py tests/py/test_copilot_engine.py`
Expected: `tests/py/test_copilot_engine.py`의 새 테스트(환경변수를 무시함을 검증하는 줄들)만 출력. 스크립트 두 파일은 출력 없음. (node 테스트 파일은 이 명령의 대상이 아니다.)

---

### Task 2: 워크플로우의 `COPILOT_MODEL` 전달 제거 (TDD)

**Files:**
- Modify: `tests/node/copilot-workflows.test.js:36-40`
- Modify: `payload/workflows/common/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml:39`, `:169`, `:206`
- Modify: `payload/workflows/common/PROJECT-COMMON-RELEASE-PUBLISH.yaml:196`
- Modify: `payload/workflows/common/PROJECT-COMMON-AI-PR-SUMMARY.yaml:75`
- Modify: `.github/workflows/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml:39`, `:169`, `:206`
- Modify: `.github/workflows/PROJECT-COMMON-RELEASE-PUBLISH.yaml:196`
- Modify: `.github/workflows/PROJECT-COMMON-AI-PR-SUMMARY.yaml:75`

**Interfaces:**
- Consumes: Task 1의 스크립트는 `COPILOT_MODEL` 환경변수를 읽지 않는다.
- Produces: 워크플로우 6개 파일 어디에도 `COPILOT_MODEL` 문자열이 없다.

- [ ] **Step 1: 실패하는 테스트로 교체**

`tests/node/copilot-workflows.test.js`의 36~40행(`AI 스텝이 COPILOT_AI와 COPILOT_MODEL을 전달한다` 테스트)을 아래로 교체한다.

```js
  test(`${name}: AI 스텝이 COPILOT_AI를 전달하고 모델은 지정하지 않는다`, () => {
    assert.ok(read(payloadPath(name)).includes("COPILOT_AI: ${{ steps.copilot_options.outputs.copilot_ai }}"));
    for (const path of [payloadPath(name), dogfoodPath(name)]) {
      assert.ok(!read(path).includes("COPILOT_MODEL"), `${path}: 모델 오버라이드 전달이 남아 있다 (Free/Student는 auto만 허용)`);
    }
  });
```

- [ ] **Step 2: 실패 확인**

Run: `node --test --test-concurrency=1 tests/node/copilot-workflows.test.js`
Expected: 세 워크플로우 이름 각각에서 `모델 오버라이드 전달이 남아 있다`로 FAIL.

- [ ] **Step 3: 최소 구현 (payload와 .github 양쪽 6개 파일)**

각 워크플로우에서 `          COPILOT_MODEL: ${{ vars.COPILOT_MODEL }}` 줄을 삭제한다. 삭제할 위치는 AUTO-CHANGELOG-CONTROL 169행·206행, RELEASE-PUBLISH 196행, AI-PR-SUMMARY 75행이다(payload와 .github 동일).

`PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml` 39행의 주석 `#   (only when version.yml copilot_ai is true; optional vars.COPILOT_MODEL),`을 아래로 바꾼다(payload와 .github 양쪽).

```yaml
#   (only when version.yml copilot_ai is true; always uses auto model selection),
```

- [ ] **Step 4: 통과 확인**

Run: `node --test --test-concurrency=1 tests/node/copilot-workflows.test.js`
Expected: 전부 PASS (도그푸딩 사본 일치 테스트 포함).

Run: `grep -rn "COPILOT_MODEL" payload/workflows .github/workflows`
Expected: 출력 없음.

---

### Task 3: README 안내 정정과 전체 검증

**Files:**
- Modify: `README.md:200`

**Interfaces:**
- Consumes: Task 1, 2의 동작(모델은 `auto` 고정).

- [ ] **Step 1: README 200행 교체**

`README.md` 200행

```
- Copilot 모델은 저비용 소형 모델(`claude-haiku-4.5`)로 고정되어 있고, 저장소 변수 `COPILOT_MODEL`로 바꿀 수 있습니다.
```

을 아래로 바꾼다. 199행(조직 정책 안내)은 그대로 둔다.

```
- Copilot은 항상 `auto` 모델 선택으로 호출됩니다. Copilot Free·Student 계정은 모델명을 직접 지정하는 호출이 거부되고 `auto`만 허용되기 때문에, 모델을 바꾸는 옵션은 제공하지 않습니다.
```

- [ ] **Step 2: 잔존 참조 검증**

Run: `grep -rn "COPILOT_MODEL\|_COPILOT_DEFAULT_MODEL\|claude-haiku" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.playwright-mcp --exclude-dir=.superpowers . | grep -v "docs/superpowers/plans"`
Expected: 아래 두 테스트 파일의 새 부정 검증 줄만 출력. 그 외 파일은 출력 없음.
- `tests/py/test_copilot_engine.py`: 환경변수를 무시함을 검증하는 줄(`COPILOT_MODEL` 설정 및 테스트 이름)
- `tests/node/copilot-workflows.test.js`: `!read(path).includes("COPILOT_MODEL")` 부정 검증 줄과 테스트 이름

- [ ] **Step 3: 전체 테스트**

Run: `npm test`
Expected: node·py 전부 PASS. (알려진 예외: `payload/scripts/__pycache__` 잔존으로 py 1건이 실패하는 #152가 재현되면, 원인이 이 변경과 무관함을 확인하고 결과만 보고한다. `__pycache__`는 `.gitignore` 대상이므로 커밋에 섞이지 않는다.)
