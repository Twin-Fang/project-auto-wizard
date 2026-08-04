# 이슈 #11 전체 기능 실사용 QA 테스트 실행 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `project-auto-wizard`의 로컬 CLI 산출물(설치 마법사, 8개 모드, 9개 타입 감지, 옵션 조합, 재실행 멱등성)을 실제 실행으로 검증하고, 코드 정적 분석으로 발견한 27건의 버그 후보(HIGH 4 / MEDIUM 11 / LOW 13)의 재현 여부를 확정한다.

**Architecture:** 이 계획은 코드를 작성하지 않는 QA 실행 계획이므로 TDD의 "실패 테스트 → 구현 → 통과" 사이클 대신 **"CLI 실행 → 검증 커맨드 실행 → 기대값과 실제값 비교 → 기록"** 사이클을 사용한다. 각 태스크는 스크래치패드 안에 격리된 임시 git 저장소를 만들어 `node bin/project-auto-wizard.js`를 직접 실행하고, 산출물을 파일 존재/내용/개수로 검증한 뒤 결과를 `$QA_ROOT/findings.md`에 이어붙인다.

**Tech Stack:** Node.js (project-auto-wizard CLI 자체), Bash(테스트 하네스), 기존 node --test / python unittest(베이스라인만)

## Global Constraints

- **코드 수정 금지**: `src/`, `payload/`, `tests/` 등 저장소 추적 파일은 이 계획 실행 중 절대 수정하지 않는다. 모든 산출물은 스크래치패드 안에서만 생성한다.
- **범위**: 로컬 CLI 산출물 검증까지. GitHub 실제 push/PR/automerge/tag+Release e2e는 이슈 #17로 분리되어 이 계획의 범위 밖이다.
- **격리**: 모든 테스트는 스크래치패드 하위 `$QA_ROOT`에서만 수행하고, `project-auto-wizard` 저장소 본체(`/Users/chuseok22/Workspace/contests/open-soruce/code/project-auto-wizard`)에는 어떠한 파일도 쓰지 않는다.
- **force 옵션 금지**: 이 계획을 실행하는 동안 `git push -f`, `git reset --hard`, `git clean -f` 등 force성 git 명령은 스크래치패드 안에서도 사용하지 않는다(스크래치패드 임시 저장소 자체를 지울 때는 일반 `rm -rf $QA_ROOT/<scenario>`로 충분하며 git force 명령이 필요 없다).
- **브랜치 상태 갱신 반영(2026-08-04 fable5 검토 후 수정)**: 이 계획 초안 작성 이후 작업 브랜치에 `main`(v0.1.12, purge 모드 포함)이 merge됐다. 그 결과 `src/index.js`, `src/core/copy/workflows.js`, `src/core/branches.js`, `src/commands/interactive.js` 등 핵심 파일이 대부분 변경됐다. 이 문서의 코드 인용은 merge 후 최신 상태 기준으로 재검증했지만, **실행자는 각 태스크에서 `grep -n`으로 실제 코드를 다시 확인한 뒤 진행한다** — 특정 줄 번호를 맹신하지 않는다.
- **셸 상태 공유(fable5 B7)**: 한 태스크 안에서 뒤 스텝이 앞 스텝에서 정의한 변수(`$d`, `$TARGET` 등)를 참조하는 경우, 그 스텝들은 **하나의 Bash 도구 호출(단일 셸 세션)로 묶어서 실행**한다. 별도 호출로 나누면 변수가 사라진다. 각 태스크 시작 시 항상 Global Constraints의 `export` 블록과 `source "$QA_ROOT/helpers/new-repo.sh"`를 그 세션 맨 앞에서 먼저 실행한다.
- **환경 변수**: 아래 모든 태스크는 다음 변수가 셸에 설정되어 있다고 가정한다.
  ```bash
  export REPO_ROOT="/Users/chuseok22/Workspace/contests/open-soruce/code/project-auto-wizard"
  export CLI_BIN="$REPO_ROOT/bin/project-auto-wizard.js"
  export FIXTURES="$REPO_ROOT/tests/fixtures/e2e"
  export SCRATCH="/private/tmp/claude-501/-Users-chuseok22-Workspace-contests-open-soruce-code-project-auto-wizard/06b30080-6c2f-4bd2-a25f-098ba4fbeab9/scratchpad"
  export QA_ROOT="$SCRATCH/qa-issue-11"
  mkdir -p "$QA_ROOT"
  ```
  `$SCRATCH`는 세션마다 달라질 수 있다 — 이 계획을 다른 세션에서 재실행한다면 시스템 프롬프트의 "Scratchpad Directory" 절대경로로 위 값을 교체한 뒤 이어서 진행한다.
- **fixture 재사용**: 마커 파일은 `tests/fixtures/e2e/<type>/*`를 그대로 복사해서 쓴다. 이 fixture는 9타입+multi+monorepo 디렉터리로 실제 존재를 확인했다(`tests/node/e2e-matrix.test.js`와의 참조 관계는 별도 확인 안 됨 — fixture 자체의 유효성만 보증됨).
- **findings 기록 형식**: 각 태스크의 마지막 단계는 항상 아래 형식으로 `$QA_ROOT/findings.md`에 append한다.
  ```
  ## [Phase-태스크번호] 시나리오명
  - 실행 커맨드: `...`
  - 기대 동작: ...
  - 실제 동작: ...
  - 판정: PASS | BUG(버그 후보 ID) | NEW-BUG(신규 발견)
  ```

---

### Task 1: 테스트 하네스 준비 + Phase 0 베이스라인

**Files:**
- Create: `$QA_ROOT/findings.md` (스크래치패드, 저장소 비추적)
- Create: `$QA_ROOT/helpers/new-repo.sh` (스크래치패드, 저장소 비추적 — 시나리오별 격리 저장소를 만드는 헬퍼)

**Interfaces:**
- Produces: `new_repo <name>` 셸 함수 — `$QA_ROOT/<name>`에 `git init` 후 `user.name`/`user.email`을 설정한 빈 저장소를 만들고 그 경로를 stdout으로 출력한다. 이후 모든 태스크가 이 헬퍼를 `source`해서 사용한다.

- [ ] **Step 1: 헬퍼 스크립트 작성**

```bash
mkdir -p "$QA_ROOT/helpers"
cat > "$QA_ROOT/helpers/new-repo.sh" <<'EOF'
new_repo() {
  : "${QA_ROOT:?QA_ROOT가 설정되지 않았습니다 — Global Constraints의 export 블록을 먼저 실행하세요}"
  local name="$1"
  local dir="$QA_ROOT/$name"
  rm -rf "$dir"
  mkdir -p "$dir"
  (cd "$dir" && git init -q && git config user.email "qa@example.com" && git config user.name "QA Bot" && git commit --allow-empty -q -m "init")
  echo "$dir"
}
EOF
echo "# 이슈 #11 QA findings" > "$QA_ROOT/findings.md"
```

- [ ] **Step 2: 헬퍼 동작 확인**

```bash
source "$QA_ROOT/helpers/new-repo.sh"
d=$(new_repo smoke-test)
test -d "$d/.git" && echo "OK: git repo created at $d"
rm -rf "$d"
```

Expected: `OK: git repo created at ...` 출력.

- [ ] **Step 3: Phase 0 — 기존 자동화 테스트 베이스라인 실행**

```bash
cd "$REPO_ROOT"
npm test 2>&1 | tee "$QA_ROOT/phase0-npm-test.log"
```

- [ ] **Step 4: 결과 기록**

```bash
cat >> "$QA_ROOT/findings.md" <<EOF

## [Phase0-1] npm test 베이스라인
- 실행 커맨드: \`npm test\` (저장소 루트)
- 기대 동작: node --test + python unittest 전체 통과
- 실제 동작: $(tail -20 "$QA_ROOT/phase0-npm-test.log" | tr '\n' ' ')
- 판정: (통과 시 PASS, 실패 있으면 실패 항목을 NEW-BUG로 개별 기록)
EOF
```

Verify: `$QA_ROOT/phase0-npm-test.log`에 실패(`not ok`, `FAIL`)가 있는지 `grep -E "not ok|FAIL"`로 확인하고, 있다면 실패한 테스트 이름을 findings.md에 별도 줄로 추가한다.

---

### Task 2: Phase 1 — HIGH 버그 후보 재현 (H1)

**Files:**
- Create: `$QA_ROOT/h1-mode-typo/` (스크래치패드)

**Interfaces:**
- Consumes: Task 1의 `new_repo` 함수, `$QA_ROOT/findings.md`

**fable5 검토 반영(R2)**: 원격이 아예 없는 저장소로 테스트하면 `remoteBranches=[]`가 되어 `ensureDevelopBranch` 호출 자체가 스킵되고(`src/index.js`의 `remoteBranches.length && ...` 가드), "에러 없이 조용히 무동작"까지만 관찰된다. H1의 최대 위험(오타 모드인데 원격 develop 브랜치 생성+push까지 실행)을 제대로 보이려면 origin에 main만 있고 develop은 없는 로컬 bare 원격을 붙인다. **아래 스텝들은 변수(`$d`, `$bare`)를 공유하므로 하나의 Bash 호출로 묶어서 실행한다.**

- [ ] **Step 1~4: 저장소+로컬 bare 원격 준비 → 오타 mode 실행 → 부수효과 확인 → 기록**

```bash
source "$QA_ROOT/helpers/new-repo.sh"
export QA_ROOT REPO_ROOT CLI_BIN FIXTURES  # 하위 프로세스(git)에도 노출

bare="$QA_ROOT/h1-mode-typo-origin.git"
rm -rf "$bare"; git init --bare -q "$bare"

d=$(new_repo h1-mode-typo)
cd "$d"
cp "$FIXTURES/node/package.json" package.json
git add package.json && git commit -q -m "add package.json"
git remote add origin "file://$bare"
git push -q -u origin main
git branch -a > "$QA_ROOT/h1-mode-typo/before-branches.txt"

node "$CLI_BIN" --mode ful --force --type node > "$QA_ROOT/h1-mode-typo/output.log" 2>&1
echo "exit code: $?" >> "$QA_ROOT/h1-mode-typo/output.log"

git branch -a > "$QA_ROOT/h1-mode-typo/after-branches.txt"
git -C "$bare" branch > "$QA_ROOT/h1-mode-typo/bare-remote-branches.txt"
diff "$QA_ROOT/h1-mode-typo/before-branches.txt" "$QA_ROOT/h1-mode-typo/after-branches.txt"
cat "$QA_ROOT/h1-mode-typo/bare-remote-branches.txt"
ls -la .github/workflows/ 2>/dev/null | wc -l
cat "$QA_ROOT/h1-mode-typo/output.log"

cat >> "$QA_ROOT/findings.md" <<EOF

## [Phase1-1] H1: 잘못된 --mode 값 검증 누락
- 실행 커맨드: \`node bin/project-auto-wizard.js --mode ful --force --type node\` (origin에 main만 존재하는 로컬 bare 원격 연결)
- 기대 동작: 지원하지 않는 mode 값이면 명확한 에러로 즉시 거부, 원격에 어떠한 브랜치 부수효과도 없어야 함
- 실제 동작: (output.log, branch diff, bare-remote-branches.txt 요약을 여기에 채운다 — 특히 bare 저장소에 develop 브랜치가 새로 생겼는지)
- 판정: (재현되면 BUG(H1), 재현 안 되면 PASS)
EOF
```

Expected(문서 기준): 잘못된 mode 값이면 즉시 에러로 거부되어야 한다.
Bug 재현 조건(H1): 에러 없이 조용히 종료(exit 0)되고, `.github/workflows/`는 비어있는데 `bare-remote-branches.txt`에 `develop`이 새로 생겨 있는 경우 — 오타 모드가 원격에 실제 부수효과를 낸 것.

---

### Task 3: Phase 1 — HIGH 버그 후보 재현 (H2, H4)

**Files:**
- Create: `$QA_ROOT/h2-tty-force/`, `$QA_ROOT/h4-status-drift/` (스크래치패드)

**Interfaces:**
- Consumes: Task 1의 `new_repo` 함수

- [ ] **Step 1: H2 — TTY 환경에서 --force 없이 실행**

TTY 에뮬레이션이 필요하므로 `script` 명령(macOS/BSD)으로 의사 TTY를 만든다.

```bash
source "$QA_ROOT/helpers/new-repo.sh"
d=$(new_repo h2-tty-force)
cp "$FIXTURES/node/package.json" "$d/package.json"
cd "$d"
script -q "$QA_ROOT/h2-tty-force/script.log" node "$CLI_BIN" --mode full --type node <<< ""
```

- [ ] **Step 2: H2 결과 확인**

```bash
ls -la .github/workflows/ 2>/dev/null
cat "$QA_ROOT/h2-tty-force/script.log"
```

Expected(문서 기준): TTY든 아니든 `--force` 없이 명시 모드(`full` 등)를 실행하면 확인 절차(대화형 질문 또는 명시적 거부)가 있어야 한다.
Bug 재현 조건(H2): 아무 질문 없이 `.github/workflows/`에 파일이 바로 생성됨.

- [ ] **Step 3: H4 — 대화형 설치 후 status 드리프트 오탐 확인**

`env-plan`에서 기본값이 아닌 값을 입력하는 대화형 흐름을 자동 응답(printf로 stdin 주입)한다. spring 타입은 `@wizard ask` 필드(Nexus 그룹/배포 경로 등)가 있어 이 시나리오에 적합하다.

```bash
d=$(new_repo h4-status-drift)
cp "$FIXTURES/spring/build.gradle" "$d/build.gradle"
cd "$d"
node "$CLI_BIN" --mode full --force --type spring > /dev/null 2>&1
node "$CLI_BIN" --mode status > "$QA_ROOT/h4-status-drift/status-after-force-install.log" 2>&1
cat "$QA_ROOT/h4-status-drift/status-after-force-install.log"
```

`--force` 설치는 항상 기본값으로 채워지므로 이 시퀀스 자체는 drift가 없어야 정상이다(대조군). 이어서 설치된 워크플로우 중 `# @wizard ask` 마커가 있는 파일 하나를 골라 기본값이 아닌 값으로 **수동 치환**해 "사용자가 기본값과 다른 값을 입력한 것"과 동일한 최종 상태를 재현한다.

```bash
grep -rl "@wizard ask" .github/workflows/*.yaml 2>/dev/null | head -1
```

- [ ] **Step 4: 코드로 확인한 케이스 재현 — isUnchanged 강제 useDefaults 검증**

Step 3에서 찾은 파일 안의 `@wizard ask` 대상 키 값을 비-기본값으로 직접 편집(스크래치패드 안이므로 허용)한 뒤 그 변경을 **되돌리지 않고** `status`를 실행해 "설치 직후 실제로 아무도 손대지 않았는데 이미 값이 달랐던" 상황을 만들 수 없으므로, 대신 `src/core/wizard-env.js`의 `substituteEnv(template, {...opts, useDefaults:true})` 강제 로직이 실제로 non-default 옵션값을 무시하는지는 **코드 재확인**으로 교차 검증한다.

```bash
grep -n "useDefaults" "$REPO_ROOT/src/core/wizard-env.js"
```

Expected: `isUnchanged` 내부(약 99행 부근, merge로 줄 번호가 바뀌었을 수 있으니 grep 결과 기준으로 확인)에서 `useDefaults:true`를 무조건 강제하는 라인이 있으면 코드상 CONFIRMED다. **fable5 검토로 추가 확인된 사실**: 같은 파일 상단 주석(약 48행)에 "useDefaults - true면 ask도 기본값 사용 (WF_USE_DEFAULTS=true, unchanged 비교의 전제)"라고 명시되어 있어, 이 강제 동작이 **의도된 설계일 가능성**이 있다 — 즉 "파일이 기본 템플릿과 다른가"를 판정 기준으로 삼은 것이지 "사용자가 직접 편집했는가"가 아닐 수 있다. 이 경우 H4는 버그가 아니라 **문서화 안 된 설계 결정**으로 재분류될 수 있으므로, findings에는 코드 확인 결과와 함께 이 해석도 같이 기록한다.

- [ ] **Step 5: 결과 기록**

```bash
cat >> "$QA_ROOT/findings.md" <<EOF

## [Phase1-2] H2: TTY에서 --force 없는 명시 모드 실행
- 실행 커맨드: \`node bin/project-auto-wizard.js --mode full --type node\` (TTY, --force 없음)
- 기대 동작: 확인 절차 없이 파일이 바로 써지면 안 됨
- 실제 동작: (script.log 요약)
- 판정: (BUG(H2) | PASS)

## [Phase1-3] H4: status 드리프트 오탐 (useDefaults 강제)
- 실행 커맨드: \`node bin/project-auto-wizard.js --mode status\` + wizard-env.js 코드 확인
- 기대 동작: 사용자가 손대지 않은 파일은 status에서 드리프트로 나오면 안 됨(단, "기본값 대비 비교"가 의도된 설계라면 이 기대 자체가 틀릴 수 있음 — 코드 주석 확인 결과를 함께 기록)
- 실제 동작: (grep 결과 + status 로그 요약)
- 판정: (BUG(H4) | 의도된 설계로 재분류(NOT-A-BUG) | PASS)
EOF
```

---

### Task 4: Phase 1 — HIGH 버그 후보 재현 (H3, 최우선)

**Files:**
- Create: `$QA_ROOT/h3-common-overwrite/` (스크래치패드)

**Interfaces:**
- Consumes: Task 1의 `new_repo` 함수

**fable5 검토 반영(B3)**: `--mode full`(CLI 명시 모드)은 `src/index.js`에서 `hooks`(=`decisions`) 없이 `runFull`을 호출한다 — 즉 대화형 3지선 질문 자체가 이 경로에는 없다(3지선은 `interactive.js`의 대화형 마법사 전용, Task 10에서 별도 검증). 그러므로 "질문이 안 뜬다"는 관찰은 H3 재현이 아니다. `src/core/copy/workflows.js`를 직접 읽어보면(`(1) common — unchanged면 스킵, 아니면 무조건 덮어쓰기` 주석 + 타입별 루프만 `decisions`를 참조하는 구조) H3는 이미 **코드 근거로 CONFIRMED**다. 이 태스크는 같은 `--force` 재실행 한 번으로 "타입 워크플로우 마커는 남고(미지정 파일은 기본 skip) common 마커는 사라지는(무조건 덮어쓰기)" **비대칭을 직접 관찰**하는 것으로 재구성한다. **아래는 하나의 Bash 호출로 묶어서 실행한다.**

- [ ] **Step 1~4: 설치 → 타입/common 워크플로우 동시 수정 → 재실행 → 비대칭 확인 → 기록**

```bash
source "$QA_ROOT/helpers/new-repo.sh"
d=$(new_repo h3-common-overwrite)
cp "$FIXTURES/node/package.json" "$d/package.json"
cd "$d"
node "$CLI_BIN" --mode full --force --type node > /dev/null 2>&1
ls .github/workflows/

TYPE_TARGET=$(find .github/workflows -iname "*NODE*" | head -1)
COMMON_TARGET=".github/workflows/PROJECT-COMMON-RELEASE-PUBLISH.yaml"
test -f "$TYPE_TARGET" && echo "# QA-TYPE-MARKER $(date +%s)" >> "$TYPE_TARGET"
test -f "$COMMON_TARGET" && echo "# QA-COMMON-MARKER $(date +%s)" >> "$COMMON_TARGET"

node "$CLI_BIN" --mode full --force --type node > "$QA_ROOT/h3-common-overwrite/rerun.log" 2>&1

TYPE_RESULT=$(grep -q "QA-TYPE-MARKER" "$TYPE_TARGET" 2>/dev/null && echo "KEPT(skip)" || echo "OVERWRITTEN")
COMMON_RESULT=$(grep -q "QA-COMMON-MARKER" "$COMMON_TARGET" 2>/dev/null && echo "KEPT" || echo "OVERWRITTEN(무조건 덮어쓰기)")
echo "type-level: $TYPE_RESULT / common-level: $COMMON_RESULT"

grep -n "unchanged면 스킵\|무조건 덮어쓰기" "$REPO_ROOT/src/core/copy/workflows.js"

cat >> "$QA_ROOT/findings.md" <<EOF

## [Phase1-4] H3: common 워크플로우 3지선 미적용 (최우선 확인)
- 실행 커맨드: 타입/common 워크플로우 각각 수동 편집 후 동일한 \`node bin/project-auto-wizard.js --mode full --force --type node\` 재실행
- 기대 동작: README의 "유지/백업 후 교체/참고본 추가 3지선"이 common에도 동일하게 적용되어야 함
- 실제 동작: type-level=$TYPE_RESULT, common-level=$COMMON_RESULT (코드 주석으로 무조건 덮어쓰기 확인됨)
- 판정: (type과 common 결과가 다르면 BUG(H3) CONFIRMED, 같으면 PASS)
EOF
```

Expected(README 기준): 두 카테고리 모두 유지/백업 후 교체/참고본 추가 중 하나로 동일하게 처리되어야 한다.
Bug 재현 조건(H3): `type-level: KEPT(skip)` vs `common-level: OVERWRITTEN(무조건 덮어쓰기)`처럼 두 결과가 갈리는 경우 — README가 말하는 "3지선"이 common에는 적용 안 됨을 실행으로 증명.

---

### Task 5: Phase 2 — 9개 타입 설치 매트릭스

**Files:**
- Create: `$QA_ROOT/types/<type>/` × 9 (스크래치패드)

**Interfaces:**
- Consumes: Task 1의 `new_repo` 함수, `$FIXTURES`

- [ ] **Step 1: 타입별 설치 + 산출물 목록 캡처**

아래 표의 각 행을 순서대로 실행한다(타입 → fixture 소스 경로 → 대상 상대경로).

| type | fixture 소스 | 대상 상대경로 |
|---|---|---|
| spring | `$FIXTURES/spring/build.gradle` | `build.gradle` |
| flutter | `$FIXTURES/flutter/pubspec.yaml` | `pubspec.yaml` |
| react | `$FIXTURES/react/package.json` | `package.json` |
| next | `$FIXTURES/next/package.json` | `package.json` |
| node | `$FIXTURES/node/package.json` | `package.json` |
| python | `$FIXTURES/python/pyproject.toml` | `pyproject.toml` |
| react-native | `$FIXTURES/react-native/android/app/build.gradle` + `$FIXTURES/react-native/ios/App/Info.plist` | `android/app/build.gradle` + `ios/App/Info.plist` |
| react-native-expo | `$FIXTURES/react-native-expo/app.json` | `app.json` |
| basic | `$FIXTURES/basic/README.md` | `README.md` |

```bash
source "$QA_ROOT/helpers/new-repo.sh"
mkdir -p "$QA_ROOT/types"
for t in spring flutter react next node python basic; do
  d=$(new_repo "types/$t")
done
d=$(new_repo "types/react-native")
mkdir -p "$d/android/app" "$d/ios/App"
cp "$FIXTURES/react-native/android/app/build.gradle" "$d/android/app/build.gradle"
cp "$FIXTURES/react-native/ios/App/Info.plist" "$d/ios/App/Info.plist"
d=$(new_repo "types/react-native-expo")
cp "$FIXTURES/react-native-expo/app.json" "$d/app.json"

cp "$FIXTURES/spring/build.gradle" "$QA_ROOT/types/spring/build.gradle"
cp "$FIXTURES/flutter/pubspec.yaml" "$QA_ROOT/types/flutter/pubspec.yaml"
cp "$FIXTURES/react/package.json" "$QA_ROOT/types/react/package.json"
cp "$FIXTURES/next/package.json" "$QA_ROOT/types/next/package.json"
cp "$FIXTURES/node/package.json" "$QA_ROOT/types/node/package.json"
cp "$FIXTURES/python/pyproject.toml" "$QA_ROOT/types/python/pyproject.toml"
cp "$FIXTURES/basic/README.md" "$QA_ROOT/types/basic/README.md"

for t in spring flutter react next node python react-native react-native-expo basic; do
  ( cd "$QA_ROOT/types/$t" && node "$CLI_BIN" --mode full --force --type "$t" > "$QA_ROOT/types/$t/install.log" 2>&1 )
  find "$QA_ROOT/types/$t/.github/workflows" -type f 2>/dev/null | sort > "$QA_ROOT/types/$t/workflow-files.txt"
done
```

- [ ] **Step 2: README 서술과 파일 개수 대조**

**fable5 검토 반영(R6)**: `workflow-files.txt`는 타입별 파일과 common(VERSION-CONTROL 등) 파일이 섞인 전체 목록이라, "README 8종" 같은 타입별 개수 주장은 `PROJECT-{TYPE}-` prefix로 필터링한 부분집합과 비교해야 정확하다.

```bash
echo "--- flutter (README: 타입 전용 8종, common 별도) ---"; grep -c "PROJECT-FLUTTER-" "$QA_ROOT/types/flutter/workflow-files.txt"
echo "--- flutter 전체(common 포함) 목록 ---"; cat "$QA_ROOT/types/flutter/workflow-files.txt"
echo "--- spring (GITHUB-PACKAGES-PUBLISH.yml 포함 여부, M9) ---"; grep -i "GITHUB-PACKAGES-PUBLISH" "$QA_ROOT/types/spring/workflow-files.txt"
echo "--- react (CI/CICD 분리) ---"; cat "$QA_ROOT/types/react/workflow-files.txt"
echo "--- next ---"; cat "$QA_ROOT/types/next/workflow-files.txt"
echo "--- python (README: 타입 전용 3종, CI/PR-PREVIEW/SIMPLE-CICD) ---"; grep -c "PROJECT-PYTHON-" "$QA_ROOT/types/python/workflow-files.txt"
echo "--- basic ---"; cat "$QA_ROOT/types/basic/workflow-files.txt"
```

Expected: flutter=8개, python=3개(+common 3개=6개 총합 예상), spring은 M9(GITHUB-PACKAGES-PUBLISH.yml) 포함 여부를 확인.

- [ ] **Step 3: 결과 기록 (9개 타입 각각 1블록씩, spring/flutter/python은 개수까지 명시)**

```bash
for t in spring flutter react next node python react-native react-native-expo basic; do
cat >> "$QA_ROOT/findings.md" <<EOF

## [Phase2-1] 타입 설치: $t
- 실행 커맨드: \`node bin/project-auto-wizard.js --mode full --force --type $t\`
- 기대 동작: README "타입별 워크플로우 구성" 절 서술과 일치
- 실제 동작: $(cat "$QA_ROOT/types/$t/workflow-files.txt" | xargs -n1 basename | tr '\n' ',')
- 판정: (PASS | BUG(M9 등) | NEW-BUG)
EOF
done
```

---

### Task 6: Phase 2 — 멀티타입 + 모노레포

**Files:**
- Create: `$QA_ROOT/multi/`, `$QA_ROOT/monorepo/`, `$QA_ROOT/multi-auto-detect/` (스크래치패드)

**Interfaces:**
- Consumes: Task 1의 `new_repo` 함수

- [ ] **Step 1: 명시적 멀티타입 설치**

```bash
source "$QA_ROOT/helpers/new-repo.sh"
d=$(new_repo multi)
cp "$FIXTURES/multi/build.gradle" "$d/build.gradle"
cp "$FIXTURES/multi/package.json" "$d/package.json"
cd "$d"
node "$CLI_BIN" --mode full --force --type spring,react,python > install.log 2>&1
ls .github/workflows/ | sort
cat version.yml | grep -A5 "project_types"
```

- [ ] **Step 2: 모노레포(--paths) 설치**

```bash
d=$(new_repo monorepo)
mkdir -p "$d/app" "$d/client"
cp "$FIXTURES/monorepo/app/pubspec.yaml" "$d/app/pubspec.yaml"
cp "$FIXTURES/monorepo/client/package.json" "$d/client/package.json"
cd "$d"
node "$CLI_BIN" --mode full --force --type flutter,react --paths "flutter=app,react=client" > install.log 2>&1
cat version.yml | grep -A5 "project_paths"
```

- [ ] **Step 3: M2 — 마커 복수 존재 시 --type 미지정 자동 감지 확인**

```bash
d=$(new_repo multi-auto-detect)
cp "$FIXTURES/multi/build.gradle" "$d/build.gradle"
cp "$FIXTURES/multi/package.json" "$d/package.json"
cd "$d"
node "$CLI_BIN" --mode full --force > install.log 2>&1
cat version.yml | grep -A5 "project_types"
```

Expected: `--type` 없이 실행했을 때 자동으로 spring+react(+node 여부) 멀티타입이 감지되는지, 사용자가 예상 못 할 동작인지 확인.

- [ ] **Step 4: M3 — 존재하지 않는 --paths 경로**

```bash
d=$(new_repo paths-nonexistent)
cp "$FIXTURES/react/package.json" "$d/package.json"
cd "$d"
node "$CLI_BIN" --mode full --force --type react --paths "react=does-not-exist" > install.log 2>&1
echo "exit: $?"
cat install.log
```

Expected(README/코드 기준): 존재하지 않는 경로 검증이 없으므로 에러 없이 통과할 가능성 — 실제로 어떤 결과가 나오는지(경로가 그대로 기록되는지, 설치가 실패하는지) 기록.

- [ ] **Step 5: 결과 기록**

```bash
cat >> "$QA_ROOT/findings.md" <<'EOF'

## [Phase2-2] 멀티타입 명시 설치 (spring,react,python)
- 판정: (PASS | NEW-BUG)

## [Phase2-3] 모노레포 --paths 설치
- 판정: (PASS | NEW-BUG)

## [Phase2-4] M2: --type 미지정 시 마커 복수 자동 멀티타입 감지
- 판정: (BUG(M2) | 의도된 동작으로 확인, PASS)

## [Phase2-5] M3: 존재하지 않는 --paths 경로 검증 누락
- 판정: (BUG(M3) | PASS)
EOF
```

---

### Task 7: Phase 3 — 옵션 조합 (nexus/secret-backup/coderabbit/semver-auto) + M1

**Files:**
- Create: `$QA_ROOT/options/*` (스크래치패드)

**Interfaces:**
- Consumes: Task 1의 `new_repo` 함수

- [ ] **Step 1: spring + --nexus 단독 vs 옵션 없음 diff**

```bash
source "$QA_ROOT/helpers/new-repo.sh"
d1=$(new_repo options/spring-plain); cp "$FIXTURES/spring/build.gradle" "$d1/build.gradle"
( cd "$d1" && node "$CLI_BIN" --mode full --force --type spring > /dev/null 2>&1 )
d2=$(new_repo options/spring-nexus); cp "$FIXTURES/spring/build.gradle" "$d2/build.gradle"
( cd "$d2" && node "$CLI_BIN" --mode full --force --type spring --nexus > /dev/null 2>&1 )
diff <(find "$d1/.github/workflows" -type f | xargs -n1 basename | sort) \
     <(find "$d2/.github/workflows" -type f | xargs -n1 basename | sort)
```

Expected: nexus 관련 워크플로우 2개(`PROJECT-SPRING-NEXUS-CI.yml`, `PROJECT-SPRING-NEXUS-PUBLISH.yml`)만 추가.

- [ ] **Step 2: --secret-backup 단독**

```bash
d=$(new_repo options/secret-backup); cp "$FIXTURES/node/package.json" "$d/package.json"
( cd "$d" && node "$CLI_BIN" --mode full --force --type node --secret-backup > /dev/null 2>&1 )
find "$d/.github/workflows" -iname "*SECRET-FILE-UPLOAD*"
```

- [ ] **Step 3: M1 — --mode version --coderabbit 불일치 재현**

```bash
d=$(new_repo options/version-coderabbit); cp "$FIXTURES/node/package.json" "$d/package.json"
cd "$d"
node "$CLI_BIN" --mode full --force --type node > /dev/null 2>&1
node "$CLI_BIN" --mode version --force --coderabbit > install.log 2>&1
grep -i coderabbit version.yml
test -f .coderabbit.yaml && echo "FILE EXISTS" || echo "FILE MISSING"
node "$CLI_BIN" --mode status > status.log 2>&1
cat status.log
```

Expected(M1): `version.yml`엔 `coderabbit: true` 기록되지만 `.coderabbit.yaml`은 `FILE MISSING`.

- [ ] **Step 4: --semver-auto / --no-semver-auto**

```bash
d=$(new_repo options/semver-off); cp "$FIXTURES/node/package.json" "$d/package.json"
( cd "$d" && node "$CLI_BIN" --mode full --force --type node --no-semver-auto > /dev/null 2>&1 && grep -i semver version.yml )
```

- [ ] **Step 5: 결과 기록**

```bash
cat >> "$QA_ROOT/findings.md" <<'EOF'

## [Phase3-1] --nexus 옵션 wiring
- 판정: (PASS | NEW-BUG)

## [Phase3-2] --secret-backup 옵션 wiring
- 판정: (PASS | NEW-BUG)

## [Phase3-3] M1: --mode version --coderabbit 불일치
- 판정: (BUG(M1) | PASS)

## [Phase3-4] --semver-auto/--no-semver-auto 반영
- 판정: (PASS | NEW-BUG)
EOF
```

---

### Task 8: Phase 3 — CLI 파싱 엣지케이스 (L5, L6, L7, M4)

**Files:**
- Create: `$QA_ROOT/cli-edge/*` (스크래치패드)

**Interfaces:**
- Consumes: Task 1의 `new_repo` 함수

- [ ] **Step 1: L5 — --type 내부 공백 vs --paths 내부 공백 비일관성**

```bash
source "$QA_ROOT/helpers/new-repo.sh"
d=$(new_repo cli-edge/type-space); cp "$FIXTURES/react/package.json" "$d/package.json"
( cd "$d" && node "$CLI_BIN" --mode full --force --type "re act" > out.log 2>&1; echo "exit:$?" >> out.log )
cat "$d/out.log"

d=$(new_repo cli-edge/paths-space); cp "$FIXTURES/react/package.json" "$d/package.json"
( cd "$d" && node "$CLI_BIN" --mode full --force --type react --paths "re act=." > out.log 2>&1; echo "exit:$?" >> out.log )
cat "$d/out.log"
```

- [ ] **Step 2: L6 — --main-branch 빈 문자열**

```bash
d=$(new_repo cli-edge/empty-branch); cp "$FIXTURES/node/package.json" "$d/package.json"
( cd "$d" && node "$CLI_BIN" --mode full --force --type node --main-branch "" > out.log 2>&1 )
grep -A3 "branches" "$d/version.yml"
```

- [ ] **Step 3: L7 — 상호 모순 플래그**

```bash
d=$(new_repo cli-edge/contradict-flags); cp "$FIXTURES/spring/build.gradle" "$d/build.gradle"
( cd "$d" && node "$CLI_BIN" --mode full --force --type spring --nexus --no-nexus > out.log 2>&1 )
find "$d/.github/workflows" -iname "*NEXUS*"
```

- [ ] **Step 4: M4 — --force + 모노레포 후보 0개 / 2개 이상 각각 확인**

**fable5 검토 반영(R3)**: `tests/fixtures/e2e/monorepo/app`엔 `lib/`이 없어 flutter 후보가 `paths-resolve.js`의 필터(pubspec.yaml + lib/ 동반 확인)에서 **0개**가 된다. 그리고 `client/` 하나뿐이면 react 후보는 처음부터 1개라 자동 확정되는 정상 케이스일 뿐 "2개 이상 애매함"이 아니다. 아래에서 0개 케이스와 2개 이상 케이스를 각각 명시적으로 구성한다.

```bash
# 0개 케이스 — flutter인데 lib/ 없이 pubspec.yaml만 있어 후보 필터에서 전부 걸러짐
d=$(new_repo cli-edge/force-monorepo-zero-candidates)
mkdir -p "$d/app"
cp "$FIXTURES/monorepo/app/pubspec.yaml" "$d/app/pubspec.yaml"
( cd "$d" && node "$CLI_BIN" --mode full --force --type flutter > out.log 2>&1 )
cat "$d/out.log"
cat "$d/version.yml" | grep -A5 "project_paths"

# 2개 이상 케이스 — react 마커가 있는 디렉터리를 2개 만들어 진짜 애매한 상황을 구성
d2=$(new_repo cli-edge/force-monorepo-two-candidates)
mkdir -p "$d2/client" "$d2/admin"
cp "$FIXTURES/monorepo/client/package.json" "$d2/client/package.json"
cp "$FIXTURES/monorepo/client/package.json" "$d2/admin/package.json"
( cd "$d2" && node "$CLI_BIN" --mode full --force --type react > out2.log 2>&1 )
cat "$d2/out2.log"
cat "$d2/version.yml" | grep -A5 "project_paths"
```

Expected(M4): 두 케이스 모두 경고만 찍고 조용히 `.`(루트)로 확정되는지, 아니면 실패로 거부되는지 확인 — "0개"와 "2개 이상"이 서로 다르게 처리될 수도 있으므로 결과를 구분해서 기록한다.

- [ ] **Step 5: 결과 기록**

```bash
cat >> "$QA_ROOT/findings.md" <<'EOF'

## [Phase3-5] L5: --type/--paths 공백 처리 비일관
- 판정: (BUG(L5) | PASS)

## [Phase3-6] L6: --main-branch 빈 문자열 처리
- 판정: (BUG(L6) | PASS)

## [Phase3-7] L7: --nexus --no-nexus 상호모순 플래그
- 판정: (BUG(L7) | PASS)

## [Phase3-8] M4: --force + 모노레포 경로 애매 시 자동 루트 확정
- 판정: (BUG(M4) | PASS)
EOF
```

---

### Task 9: Phase 4 — 보조 모드 (status/doctor/dry-run/revert/uninstall/purge)

**Files:**
- Create: `$QA_ROOT/modes/*` (스크래치패드)

**Interfaces:**
- Consumes: Task 1의 `new_repo` 함수

- [ ] **Step 1: status — 정상 케이스 + M6(branches 부분 객체) 케이스**

```bash
source "$QA_ROOT/helpers/new-repo.sh"
d=$(new_repo modes/status-normal); cp "$FIXTURES/node/package.json" "$d/package.json"
( cd "$d" && node "$CLI_BIN" --mode full --force --type node > /dev/null 2>&1 && node "$CLI_BIN" --mode status > status.log 2>&1 )
cat "$d/status.log"

d=$(new_repo modes/status-partial-branches); cp "$FIXTURES/node/package.json" "$d/package.json"
( cd "$d" && node "$CLI_BIN" --mode full --force --type node > /dev/null 2>&1 )
python3 - "$d/version.yml" <<'PYEOF'
import sys, re
path = sys.argv[1]
text = open(path).read()
text = re.sub(r"(branches:\n)(\s+main:.*\n)(\s+develop:.*\n)?(\s+mode:.*\n)?", r"\1\2", text)
open(path, "w").write(text)
PYEOF
( cd "$d" && node "$CLI_BIN" --mode status > status.log 2>&1 )
cat "$d/status.log"
```

Expected(M6): develop/mode 필드가 사라진 부분 객체 상태에서 status가 거짓 drift를 보고하는지 확인.

- [ ] **Step 2: doctor — gh 미인증 시뮬레이션**

```bash
d=$(new_repo modes/doctor-no-auth); cp "$FIXTURES/node/package.json" "$d/package.json"
( cd "$d" && node "$CLI_BIN" --mode full --force --type node > /dev/null 2>&1 )
( cd "$d" && GH_TOKEN="" GH_CONFIG_DIR="$QA_ROOT/modes/doctor-no-auth/fake-gh-config" node "$CLI_BIN" --mode doctor > doctor.log 2>&1 )
cat "$d/doctor.log"
```

- [ ] **Step 3: dry-run × 5개 모드(full/version/workflows/revert/uninstall) — 파일 미변경 확인**

**fable5 검토 반영(R4)**: 원래 초안엔 uninstall dry-run이 빠져 "5개 모드" 제목과 실제 커버리지가 안 맞았다. `src/index.js`에 `uninstall --dry-run` 지원이 확인되므로 추가한다.

```bash
for mode in full version workflows; do
  d=$(new_repo "modes/dryrun-$mode"); cp "$FIXTURES/node/package.json" "$d/package.json"
  before=$(find "$d" -type f | wc -l)
  ( cd "$d" && node "$CLI_BIN" --mode "$mode" --force --type node --dry-run > dryrun.log 2>&1 )
  after=$(find "$d" -type f | wc -l)
  echo "$mode: before=$before after=$after (dryrun.log 제외하면 동일해야 함)"
done

d=$(new_repo modes/dryrun-revert); cp "$FIXTURES/node/package.json" "$d/package.json"
( cd "$d" && node "$CLI_BIN" --mode full --force --type node > /dev/null 2>&1 )
before=$(find "$d" -type f | wc -l)
( cd "$d" && node "$CLI_BIN" --mode revert --force --dry-run > dryrun.log 2>&1 )
after=$(find "$d" -type f | wc -l)
echo "revert dry-run: before=$before after=$after"

d=$(new_repo modes/dryrun-uninstall); cp "$FIXTURES/node/package.json" "$d/package.json"
( cd "$d" && node "$CLI_BIN" --mode full --force --type node > /dev/null 2>&1 )
before=$(find "$d" -type f | wc -l)
( cd "$d" && node "$CLI_BIN" --mode uninstall --force --dry-run > dryrun.log 2>&1 )
after=$(find "$d" -type f | wc -l)
echo "uninstall dry-run: before=$before after=$after"
```

- [ ] **Step 4: revert / uninstall — 미설치 상태에서 안전 종료 확인**

```bash
d=$(new_repo modes/revert-empty)
( cd "$d" && node "$CLI_BIN" --mode revert --force > revert.log 2>&1; echo "exit:$?" >> revert.log )
cat "$d/revert.log"

d=$(new_repo modes/uninstall-empty)
( cd "$d" && node "$CLI_BIN" --mode uninstall --force > uninstall.log 2>&1; echo "exit:$?" >> uninstall.log )
cat "$d/uninstall.log"
```

- [ ] **Step 5: purge — --delete-develop-branch 유무**

**참고**: 이 계획 초안 작성 당시엔 작업 브랜치에 purge 모드가 없어(main 미merge 상태) fable5가 "존재하지 않는 모드"로 지적했으나, 이후 main(v0.1.12, purge 포함)을 브랜치에 merge했으므로 `--mode purge`와 `--delete-develop-branch`는 현재 코드에 실존한다(`src/index.js`의 `opts.mode === "purge"` 분기, `src/cli/args.js`의 `--delete-develop-branch` 파싱으로 확인됨). 아래에서 플래그 유/무 두 케이스를 만든다.

```bash
d=$(new_repo modes/purge-keep-branch); cp "$FIXTURES/node/package.json" "$d/package.json"
( cd "$d" && git checkout -q -b develop && git checkout -q -)
( cd "$d" && node "$CLI_BIN" --mode full --force --type node --develop-branch develop > /dev/null 2>&1 )
( cd "$d" && git branch ) > "$d/branches-before-purge.txt"
( cd "$d" && node "$CLI_BIN" --mode purge --force > purge.log 2>&1 )
( cd "$d" && git branch ) > "$d/branches-after-purge-no-flag.txt"
cat "$d/branches-after-purge-no-flag.txt"

d2=$(new_repo modes/purge-delete-branch); cp "$FIXTURES/node/package.json" "$d2/package.json"
( cd "$d2" && git checkout -q -b develop && git checkout -q -)
( cd "$d2" && node "$CLI_BIN" --mode full --force --type node --develop-branch develop > /dev/null 2>&1 )
( cd "$d2" && node "$CLI_BIN" --mode purge --force --delete-develop-branch > purge.log 2>&1 )
( cd "$d2" && git branch ) > "$d2/branches-after-purge-with-flag.txt"
cat "$d2/branches-after-purge-with-flag.txt"
diff "$d/branches-after-purge-no-flag.txt" "$d2/branches-after-purge-with-flag.txt"
```

Expected: `--delete-develop-branch` 없이는 로컬 `develop` 브랜치가 남고, 있으면 삭제된다(trunk-based 구성이 아닌 경우 — `src/commands/purge.js` 주석에 trunk-based에서는 릴리스 브랜치 보호를 위한 안전장치가 있다고 되어 있으니 실제 결과가 안전장치 설명과 맞는지도 함께 확인).

- [ ] **Step 6: 결과 기록**

```bash
cat >> "$QA_ROOT/findings.md" <<'EOF'

## [Phase4-1] status 정상 케이스
- 판정: (PASS | NEW-BUG)

## [Phase4-2] M6: status branches 부분 객체 drift 오탐
- 판정: (BUG(M6) | PASS)

## [Phase4-3] doctor gh 미인증 메시지 정확성
- 판정: (PASS | NEW-BUG)

## [Phase4-4] dry-run 5개 모드(full/version/workflows/revert/uninstall) 파일 미변경 확인
- 판정: (PASS | NEW-BUG)

## [Phase4-5] revert/uninstall 미설치 상태 안전 종료
- 판정: (PASS | NEW-BUG)

## [Phase4-6] purge --delete-develop-branch 유무 차이
- 실제 동작: (branches-after-purge-no-flag.txt vs branches-after-purge-with-flag.txt diff 요약)
- 판정: (PASS | NEW-BUG)
EOF
```

---

### Task 10: Phase 5 — 재실행 멱등성 심층 (H3 교차검증, M7, M8, secret-backup/coderabbit skip 규칙)

**Files:**
- Create: `$QA_ROOT/idempotency/*` (스크래치패드)

**Interfaces:**
- Consumes: Task 1의 `new_repo` 함수

- [ ] **Step 1: 타입별 워크플로우 3지선 (skip/backup/template) — 엔진 직접 호출로 결정론적 검증**

**fable5 검토 반영(B2)**: 3지선(`decisions` Map)은 `src/commands/interactive.js`의 대화형 마법사가 `listWorkflowConflicts`로 충돌을 수집하고 사용자의 실제 선택을 모아 만든다. `--mode full`(CLI 명시 모드)은 `hooks` 없이 `runFull`을 호출해 `decisions`가 항상 빈 Map이라 **모든 changed 파일이 무조건 'skip'**된다 — 즉 `script`로 readline 키 입력을 흉내내 backup/template 분기를 재현하는 것은 신뢰할 수 없다(키 입력 스크립팅이 성공해도 실패해도 결론을 낼 수 없음). 대신 `src/core/copy/workflows.js`가 export하는 `copyWorkflows(context, payloadRoot, targetRoot, {decisions})`를 스크래치패드 전용 Node 드라이버 스크립트로 **직접 호출**해 세 가지 decision을 결정론적으로 검증한다. 이 드라이버는 저장소 파일을 수정하지 않고 프로덕션 코드를 그대로 가져와 호출만 하므로 Global Constraints의 "코드 수정 금지"에 저촉되지 않는다.

```bash
source "$QA_ROOT/helpers/new-repo.sh"
mkdir -p "$QA_ROOT/idempotency"
cat > "$QA_ROOT/idempotency/decision-driver.mjs" <<'EOF'
import { pathToFileURL } from "node:url";
const repoRoot = process.env.REPO_ROOT;
const { copyWorkflows } = await import(pathToFileURL(`${repoRoot}/src/core/copy/workflows.js`).href);
const [, , targetDir, filename, decision] = process.argv;
const payloadRoot = `${repoRoot}/payload`;
const decisions = new Map([[filename, decision]]);
const context = {
  types: ["node"], paths: new Map([["node", "."]]),
  includeNexus: false, includeSecretBackup: false,
  repoName: "qa-test", resolvers: {}, branches: { mode: "pr-flow" },
};
const result = copyWorkflows(context, payloadRoot, targetDir, { decisions });
console.log(JSON.stringify(result));
EOF

for decision in skip backup template; do
  d=$(new_repo "idempotency/type-conflict-$decision")
  cp "$FIXTURES/node/package.json" "$d/package.json"
  ( cd "$d" && node "$CLI_BIN" --mode full --force --type node > /dev/null 2>&1 )
  TARGET_NAME=$(basename "$(find "$d/.github/workflows" -iname "*NODE*CI*" | head -1)")
  echo "# QA-EDIT" >> "$d/.github/workflows/$TARGET_NAME"
  node "$QA_ROOT/idempotency/decision-driver.mjs" "$d" "$TARGET_NAME" "$decision"
  echo "--- $decision 결과 ---"
  grep -q "QA-EDIT" "$d/.github/workflows/$TARGET_NAME" && echo "원본 유지됨" || echo "원본 덮어써짐"
  ls "$d/.github/workflows/" | grep -i "$TARGET_NAME"
done
```

Expected: `skip`은 마커가 남고 새 파일 없음, `backup`은 원본이 최신 템플릿으로 교체되고 `.bak` 파생 파일 생성(원래 사용자 수정본이 `.bak`에 보존), `template`은 원본(마커 포함)이 유지되고 `.template.yaml` 파생 파일이 새로 생김.

- [ ] **Step 2: secret-backup — 내용 달라도 항상 skip 확인**

```bash
d=$(new_repo idempotency/secret-backup-skip); cp "$FIXTURES/node/package.json" "$d/package.json"
cd "$d"
node "$CLI_BIN" --mode full --force --type node --secret-backup > /dev/null 2>&1
TARGET=$(find .github/workflows -iname "*SECRET-FILE-UPLOAD*")
echo "# QA-EDIT" >> "$TARGET"
node "$CLI_BIN" --mode full --force --type node --secret-backup > rerun.log 2>&1
grep -q "QA-EDIT" "$TARGET" && echo "KEPT(예상대로 skip)" || echo "OVERWRITTEN(문서와 다름)"
```

- [ ] **Step 3: M7 — .gitignore 배너 블록 중간 삽입 후 제거**

```bash
d=$(new_repo idempotency/gitignore-mid-insert); cp "$FIXTURES/node/package.json" "$d/package.json"
cd "$d"
node "$CLI_BIN" --mode full --force --type node > /dev/null 2>&1
grep -n "AUTO-ADDED\|/.idea\|/.claude/settings.local.json" .gitignore
sed -i.orig '/\/.idea/a\
# 사용자가 끼워넣은 줄
' .gitignore
cat .gitignore
node "$CLI_BIN" --mode uninstall --force --purge-gitignore > uninstall.log 2>&1
cat .gitignore
```

Expected(M7): 배너 이후 필수 항목이 "연속"으로 소비되므로, 중간에 삽입된 사용자 줄 이후 항목이 제거 안 되고 남는지 확인.

- [ ] **Step 4: M8 — version.yml 임의 필드 소실 확인**

```bash
d=$(new_repo idempotency/version-yml-custom-field); cp "$FIXTURES/node/package.json" "$d/package.json"
cd "$d"
node "$CLI_BIN" --mode full --force --type node > /dev/null 2>&1
echo "qa_custom_field: hello" >> version.yml
node "$CLI_BIN" --mode version --force > rerun.log 2>&1
grep -q "qa_custom_field" version.yml && echo "KEPT" || echo "LOST(재생성 전략으로 소실)"
```

- [ ] **Step 5: 결과 기록**

```bash
cat >> "$QA_ROOT/findings.md" <<'EOF'

## [Phase5-1] H3 교차검증: 타입별 워크플로우 3지선 (skip/backup/template)
- 판정: (PASS | NEW-BUG)

## [Phase5-2] secret-backup 항상 skip 규칙
- 판정: (PASS | NEW-BUG)

## [Phase5-3] M7: .gitignore 배너 블록 중간 삽입 시 제거 로직 부분 동작
- 판정: (BUG(M7) | PASS)

## [Phase5-4] M8: version.yml 임의 필드 재실행 시 소실
- 판정: (BUG(M8) | PASS)
EOF
```

---

### Task 11: Phase 6 — UI/환경 엣지케이스 (L1, L2, L3, L4, M5, M9, M10)

**Files:**
- Create: `$QA_ROOT/ui-edge/*` (스크래치패드)

**Interfaces:**
- Consumes: Task 1의 `new_repo` 함수

- [ ] **Step 1: 비TTY 실행 + NO_COLOR — L2 색상 처리 비일관 확인**

**fable5 검토 반영(B5)**: macOS의 BSD `grep`은 `-P`(PCRE)를 지원하지 않아 `grep -P "\x1b\["`는 즉시 실패한다. ANSI-C 따옴표(`$'...'`)로 실제 ESC 바이트를 만들고 `grep -a`로 바이너리 취급 없이 검색한다.

```bash
source "$QA_ROOT/helpers/new-repo.sh"
d=$(new_repo ui-edge/no-color); cp "$FIXTURES/node/package.json" "$d/package.json"
( cd "$d" && NO_COLOR=1 node "$CLI_BIN" --mode full --force --type node > out.log 2>&1 )
grep -a $'\033\[' "$d/out.log" && echo "ANSI 이스케이프 섞임(L2 재현)" || echo "클린"
```

- [ ] **Step 2: L1 — Ctrl+D 무반응 (readline-engine.js 코드 확인으로 대체)**

TTY 신호(EOF)는 스크립트로 안전하게 재현하기 어려우므로 코드 경로 확인으로 대체한다.

```bash
grep -n "stdin.on(\"end\"" "$REPO_ROOT/src/ui/readline-engine.js"
grep -c "keypress" "$REPO_ROOT/src/ui/readline-engine.js"
```

Expected: `stdin.on("end"...)` 매치가 0개면 L1/M11 CONFIRMED.

- [ ] **Step 3: L3 — 대화형 최상위 메뉴에 status/doctor 노출 여부**

```bash
grep -n "status\|doctor" "$REPO_ROOT/src/ui/prompts.js" | head -10
grep -n "status\|doctor" "$REPO_ROOT/src/commands/interactive.js" | head -10
```

- [ ] **Step 4: L4 — jq 미설치 환경에서 package.json 버전 감지**

**fable5 검토 반영(B6)**: `PATH="/usr/bin:/bin"`는 두 가지로 깨진다 — ① 이 머신의 `node`가 homebrew/nvm 경로에 있으면 제한된 PATH에서 `node: command not found`가 난다. ② 최신 macOS는 `/usr/bin/jq`를 기본 동봉해 jq가 제거되지 않는다. 격리된 `fakebin/`에 `node`와 `git`만 심링크해서 PATH를 그 디렉터리 하나로 제한한다.

```bash
d=$(new_repo ui-edge/no-jq); cp "$FIXTURES/node/package.json" "$d/package.json"
mkdir -p "$d/fakebin"
ln -sf "$(command -v node)" "$d/fakebin/node"
ln -sf "$(command -v git)" "$d/fakebin/git"
command -v jq && echo "주의: jq가 fakebin 밖에서도 발견되지만 PATH 제한으로 격리됨"
( cd "$d" && PATH="$d/fakebin" node "$CLI_BIN" --mode full --force --type node > out.log 2>&1 )
cat "$d/out.log"
grep "version:" "$d/version.yml"
```

- [ ] **Step 5: M5 — fetch 안 된 상태에서 develop 자동 생성**

**fable5 검토 반영(B4)**: `detectRemoteBranches`(`src/core/branches.js`)는 `git branch -r`, 즉 **로컬에 캐시된 remote-tracking refs만** 본다. `git remote add`만 하고 fetch를 한 번도 안 하면 애초에 refs가 비어있어 `src/index.js`의 `remoteBranches.length && ...` 가드에서 `ensureDevelopBranch` 호출 자체가 스킵되고 "아무 일도 안 일어남"만 관찰된다 — 이건 M5(스테일 캐시로 인한 오판)가 아니라 그냥 원격 정보가 없는 케이스다. M5를 제대로 재현하려면 "로컬은 fetch를 했지만 그 이후 원격에 develop이 새로 생겼고 로컬은 그걸 모르는" 상황을 만들어야 한다: ① bare 원격 생성 ② 저장소 A에서 main push(→ A는 origin/main을 앎) ③ **별도 클론 B**에서 그 bare에 develop push(→ 원격엔 이제 진짜 develop이 있음) ④ A로 돌아와 **fetch 없이** CLI 실행 → A는 여전히 origin/develop을 모르므로 "없다"고 오판하고 로컬 develop을 새로 만들어 push를 시도한다. 이 push는 원격에 이미 다른 이력의 develop이 있으므로 non-fast-forward로 거절되어야 정상이다 — 이 거절이 사용자에게 명확히 보고되는지가 관찰 포인트다.

```bash
bare="$QA_ROOT/ui-edge/no-fetch-bare.git"
rm -rf "$bare"; git init --bare -q "$bare"

# A: 메인 저장소 — main만 push, develop은 아직 모름
d=$(new_repo ui-edge/no-fetch); cp "$FIXTURES/node/package.json" "$d/package.json"
( cd "$d" && git remote add origin "file://$bare" && git push -q -u origin main )

# B: 별도 클론 — origin에 develop을 먼저 만들어 push (A 입장에선 "원격에 이미 있는데 모르는" 상태를 만드는 역할)
b=$(new_repo ui-edge/no-fetch-other-clone)
rm -rf "$b" && git clone -q "file://$bare" "$b"
( cd "$b" && git checkout -q -b develop && git commit -q --allow-empty -m "develop init from clone B" && git push -q -u origin develop )

# A로 복귀 — fetch 하지 않고 바로 CLI 실행 (A의 remote-tracking엔 origin/develop이 없음)
( cd "$d" && git branch -r > "$QA_ROOT/ui-edge/no-fetch/remote-tracking-before.txt" )
( cd "$d" && node "$CLI_BIN" --mode full --force --type node --main-branch main --develop-branch develop > out.log 2>&1 )
cat "$d/out.log"
git -C "$bare" branch > "$QA_ROOT/ui-edge/no-fetch/bare-branches-after.txt"
cat "$QA_ROOT/ui-edge/no-fetch/bare-branches-after.txt"
```

Expected(M5): `out.log`에 push 거절(non-fast-forward 등) 관련 에러/경고가 사용자에게 명확히 보이거나, 설치 자체가 안전하게 중단되어야 한다.
Bug 재현 조건(M5): 에러 메시지 없이 조용히 넘어가거나(사용자가 원격에 실제로 무슨 일이 있었는지 알 수 없음), CLI가 강제로 덮어쓰려 시도하는 로그가 보이는 경우.

- [ ] **Step 6: M9, M10 — payload 산출물 코드 재확인**

```bash
find "$REPO_ROOT/payload/workflows/spring" -maxdepth 1 -type f -name "*GITHUB-PACKAGES*"
grep -n "^\s*#.*push:\|^\s*push:" "$REPO_ROOT/payload/workflows/spring/server-deploy/PROJECT-SPRING-NONSTOP-NGINX-CICD.yaml"
```

- [ ] **Step 7: 결과 기록**

```bash
cat >> "$QA_ROOT/findings.md" <<'EOF'

## [Phase6-1] L2: NO_COLOR/비TTY 색상 처리 비일관
- 판정: (BUG(L2) | PASS)

## [Phase6-2] L1/M11: stdin end 미처리
- 판정: (grep 결과에 따라 BUG(L1) | PASS)

## [Phase6-3] L3: 대화형 메뉴 status/doctor 노출
- 판정: (의도된 설계 확인 | BUG(L3))

## [Phase6-4] L4: jq 미설치 시 버전 감지 폴백
- 판정: (BUG(L4) | PASS)

## [Phase6-5] M5: fetch 안 된 상태 develop 자동 생성
- 판정: (BUG(M5) | PASS)

## [Phase6-6] M9: spring GITHUB-PACKAGES-PUBLISH.yml 미문서화
- 판정: (BUG(M9) | PASS)

## [Phase6-7] M10: Nginx/Traefik 무중단 배포 push 트리거 비활성
- 판정: (BUG(M10) | PASS)
EOF
```

---

### Task 12: 결과 종합 및 버그 리포트 작성

**Files:**
- Create: `$QA_ROOT/summary-report.md` (스크래치패드)

**Interfaces:**
- Consumes: `$QA_ROOT/findings.md` (Task 1~11이 append한 전체 기록)

- [ ] **Step 1: L8~L13 코드 재확인 메모 (fable5 검토 반영 R5 — 실행 계획에서 생략된 항목)**

설계 문서의 LOW 등급 중 L8~L13은 실행 재현 비용 대비 코드 확인이 더 합리적이라 Phase 1~6에 별도 실행 스텝을 두지 않기로 했다(설계 문서 §4, 계획 Self-Review 참고). 이 스텝에서 그 코드 확인을 실제로 수행하고 findings에 메모로 남긴다.

```bash
echo "--- L8: template 파일명 확장자 비대칭 ---"
grep -n "template.yaml\|\.yml\b" "$REPO_ROOT/src/core/copy/workflows.js" | grep -i template
echo "--- L9: wizard-env 값에 큰따옴표 포함 시 치환 깨짐 ---"
grep -n "setEnvLine\|\[\^\"\]" "$REPO_ROOT/src/core/wizard-env.js"
echo "--- L10: fsutil 비원자적 쓰기 ---"
grep -n "writeFileSync\|cpSync" "$REPO_ROOT/src/core/fsutil.js"
echo "--- L11: doctor 진단 원인 세분화 부족 ---"
grep -n "WARN\|gh api" "$REPO_ROOT/src/commands/doctor.js" | head -10
echo "--- L12: revert 구버전 파일명 잔존 가능성 ---"
grep -n "payloadWorkflowNames\|planRevert" "$REPO_ROOT/src/commands/revert.js" | head -10
echo "--- L13: test_sh_equivalence.py 상시 skip ---"
grep -n "PROJECTOPS_SH_REF\|skip" "$REPO_ROOT/tests/py/test_sh_equivalence.py" | head -10

cat >> "$QA_ROOT/findings.md" <<'EOF'

## [Phase-종합] L8~L13 코드 재확인 메모
- L8(template 확장자 비대칭): (grep 결과 요약 — .sh 원본과 동일한 의도적 동작인지 코드 주석 확인)
- L9(큰따옴표 값 치환 깨짐): (grep 결과 요약)
- L10(fsutil 비원자적 쓰기): (grep 결과 요약 — 실사용 발생 가능성 낮음으로 평가된 항목)
- L11(doctor 원인 세분화 부족): (grep 결과 요약)
- L12(revert 구버전 파일명 잔존): (grep 결과 요약)
- L13(test_sh_equivalence.py 상시 skip): (grep 결과 요약 — PROJECTOPS_SH_REF 미설정 시 skip 여부)
- 판정: 코드 확인만 수행, 각 항목은 findings 요약에 근거와 함께 기록(재현 실행은 하지 않음)
EOF
```

- [ ] **Step 2: findings.md 전체를 판정별로 집계**

```bash
grep -B4 "판정: BUG" "$QA_ROOT/findings.md" > "$QA_ROOT/confirmed-bugs.md"
grep -B4 "판정: NEW-BUG" "$QA_ROOT/findings.md" > "$QA_ROOT/new-bugs.md"
grep -c "판정: PASS" "$QA_ROOT/findings.md"
```

- [ ] **Step 3: 요약 리포트 작성**

```bash
cat > "$QA_ROOT/summary-report.md" <<EOF
# 이슈 #11 QA 실행 결과 요약

- 실행일: (실행 시점 날짜)
- 전체 시나리오 수: (findings.md의 "##" 헤더 개수)
- PASS: (개수)
- 확정 버그(BUG): (confirmed-bugs.md 참조)
- 신규 발견(NEW-BUG): (new-bugs.md 참조)

## 확정된 버그 목록 (이슈 분리 후보)

$(cat "$QA_ROOT/confirmed-bugs.md")

## 신규 발견 (스펙에 없던 케이스)

$(cat "$QA_ROOT/new-bugs.md")
EOF
cat "$QA_ROOT/summary-report.md"
```

- [ ] **Step 4: 사용자 확인 대기**

이 계획은 여기서 실행을 멈춘다. `summary-report.md`의 확정 버그/신규 발견 목록을 사용자에게 제시하고, **어떤 항목을 이슈 #11 하위 개별 이슈로 분리할지 사용자 확인을 받은 뒤에만** `issue` 스킬로 이슈를 생성한다(자동으로 다건의 GitHub 이슈를 생성하지 않는다 — 위험도가 높은 외부 작업이므로 사용자 승인 필요).

- [ ] **Step 5: (해당 시) 확정 버그를 사용자 승인 하에 이슈로 분리**

사용자가 승인한 항목에 한해 `issue` 스킬을 항목별로 호출해 이슈 #11 하위 후속 이슈를 생성한다. 이 단계는 코드 수정이 아니므로 Global Constraints의 "코드 수정 금지"에 저촉되지 않는다.

---

## Self-Review 체크리스트 (계획 작성자용, 실행자는 무시)

1. **스펙 커버리지**: 설계 문서(2026-08-04-full-feature-qa-test-plan-design.md)의 Phase 0~6이 Task 1~12에 모두 매핑됨. HIGH 4건(H1~H4)은 Task 2~4, MEDIUM 11건(M1~M11)은 Task 5~11 전역에 분산 배치, LOW 13건 중 실행으로 검증 가능한 항목(L1~L7)은 Task 8·11에 배치, 실행보다 코드 확인이 적절한 항목(L8~L13)은 Task 12 Step 1에서 코드 재확인 메모로 남긴다.
2. **플레이스홀더 스캔**: 각 Task의 판정 라인은 "(BUG(ID) | PASS)" 형태로 실행자가 실제 관찰값을 채우도록 되어 있음 — 이는 계획 누락이 아니라 QA 리포트의 정상적인 기록 형식(실행 전에는 결과를 알 수 없으므로).
3. **타입/함수 일관성**: `new_repo` 함수 시그니처(`new_repo <name>` → 경로 stdout 출력, `$QA_ROOT/<name>`에 생성)가 Task 2~11에서 동일하게 사용됨.

## fable5 최종 검토 반영 이력 (2026-08-04)

이 계획은 작성 직후 `fable` 모델로 코드 대조 검토를 받았고, 그 사이 작업 브랜치에 `main`(v0.1.12, purge 모드 포함)이 merge되어 핵심 파일 대부분이 바뀌었다. 아래는 그 검토에서 지적된 항목과 반영 여부다.

| ID | 지적 내용 | 반영 |
|---|---|---|
| B1 | `--mode purge`가 존재하지 않는 모드였음 | merge로 purge 모드가 실제로 추가되어 **해소됨** — Task 9 Step 5에 merge 사실과 코드 근거(`opts.mode === "purge"`)를 명시 |
| B2 | `--mode full`은 TTY라도 3지선 프롬프트를 띄우지 않음(대화형 전용) | Task 10 Step 1을 `copyWorkflows` 직접 호출 드라이버 스크립트로 재작성 |
| B3 | H3 재현 방법론이 검증 대상과 어긋남 | Task 4를 "타입 vs common 마커 비대칭 관찰" 방식으로 재구성, 코드 주석 근거 추가 |
| B4 | M5(fetch 스테일 캐시) 시나리오가 아무것도 재현 못함 | Task 11 Step 5를 bare 원격 + 별도 클론 2단계 시나리오로 재작성 |
| B5 | macOS `grep -P` 미지원으로 실패 | Task 11 Step 1을 `grep -a $'\033\['`로 교체 |
| B6 | PATH 제한 방식이 node 실행 실패/jq 미제거로 깨짐 | Task 11 Step 4를 `fakebin/` 심링크 격리 방식으로 교체 |
| B7 | 스텝 간 셸 변수 공유가 보장되지 않음 | Global Constraints에 "변수를 공유하는 스텝은 하나의 Bash 호출로 묶는다" 명시, Task 2·4에서 실제로 단일 블록으로 병합 |
| R1 | `new_repo`의 `rm -rf` 가드 부재 | 헬퍼에 `QA_ROOT` 미설정 가드 추가 |
| R2 | H1이 원격 없는 저장소에서는 최대 심각도를 못 보임 | Task 2에 로컬 bare 원격 연결 추가 |
| R3 | M4의 모노레포 fixture가 0개/2개 이상을 제대로 구분 못함 | Task 8 Step 4를 0개 케이스와 2개 이상 케이스로 분리 |
| R4 | dry-run 커버리지에 uninstall 누락 | Task 9 Step 3에 `uninstall --dry-run` 추가 |
| R5 | L8~L13 코드 확인 스텝이 실제로 없었음 | Task 12에 Step 1로 추가 |
| R6 | 사소한 glob/개수 표기 부정확 | Task 5 Step 2를 타입 prefix 필터링 방식으로 수정(Task 3의 `.yaml`/`.yml` glob 문제는 목적상 무해하다는 fable5 판단에 따라 그대로 둠) |

**최종 판정**: 위 항목 반영 후 실행 가능. 실행 중 코드 상태가 이 문서 작성 시점(merge 직후)과 달라졌다면, Global Constraints의 지침대로 `grep -n`으로 현재 코드를 다시 확인한다.
