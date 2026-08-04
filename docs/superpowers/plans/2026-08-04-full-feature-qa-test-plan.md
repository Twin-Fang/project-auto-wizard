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
- **fixture 재사용**: 마커 파일은 `tests/fixtures/e2e/<type>/*`를 그대로 복사해서 쓴다. 이 fixture는 이미 `tests/node/e2e-matrix.test.js`가 검증에 쓰는 것과 동일한 최소 마커 세트다.
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

- [ ] **Step 1: 저장소 준비 + 원격 develop 브랜치 사전 상태 기록**

```bash
source "$QA_ROOT/helpers/new-repo.sh"
d=$(new_repo h1-mode-typo)
cd "$d"
git branch -a > "$QA_ROOT/h1-mode-typo/before-branches.txt"
```

- [ ] **Step 2: 오타난 --mode 값으로 실행**

```bash
node "$CLI_BIN" --mode ful --force --type node > "$QA_ROOT/h1-mode-typo/output.log" 2>&1
echo "exit code: $?" >> "$QA_ROOT/h1-mode-typo/output.log"
```

- [ ] **Step 3: 부수효과 확인**

```bash
git branch -a > "$QA_ROOT/h1-mode-typo/after-branches.txt"
diff "$QA_ROOT/h1-mode-typo/before-branches.txt" "$QA_ROOT/h1-mode-typo/after-branches.txt"
ls -la .github/workflows/ 2>/dev/null | wc -l
cat "$QA_ROOT/h1-mode-typo/output.log"
```

Expected(문서 기준): 잘못된 mode 값이면 즉시 에러로 거부되어야 한다.
Bug 재현 조건(H1): 에러 없이 조용히 종료되고 `.github/workflows/`가 비어있는데도 exit code가 0이거나, output.log에 브랜치 관련 동작(생성/push 시도) 로그가 보이는 경우.

- [ ] **Step 4: 결과 기록**

```bash
cat >> "$QA_ROOT/findings.md" <<EOF

## [Phase1-1] H1: 잘못된 --mode 값 검증 누락
- 실행 커맨드: \`node bin/project-auto-wizard.js --mode ful --force --type node\`
- 기대 동작: 지원하지 않는 mode 값이면 명확한 에러로 즉시 거부
- 실제 동작: (output.log와 branch diff 요약을 여기에 채운다)
- 판정: (재현되면 BUG(H1), 재현 안 되면 PASS)
EOF
```

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

Expected: 이 grep 결과가 `isUnchanged` 함수 내부에서 `useDefaults:true`를 무조건 강제하는 라인을 보여주면 H4는 코드상 CONFIRMED, 이번 실행 결과와 함께 최종 판정에 반영한다.

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
- 기대 동작: 사용자가 손대지 않은 파일은 status에서 드리프트로 나오면 안 됨
- 실제 동작: (grep 결과 + status 로그 요약)
- 판정: (BUG(H4) | PASS)
EOF
```

---

### Task 4: Phase 1 — HIGH 버그 후보 재현 (H3, 최우선)

**Files:**
- Create: `$QA_ROOT/h3-common-overwrite/` (스크래치패드)

**Interfaces:**
- Consumes: Task 1의 `new_repo` 함수

- [ ] **Step 1: node 타입으로 설치**

```bash
source "$QA_ROOT/helpers/new-repo.sh"
d=$(new_repo h3-common-overwrite)
cp "$FIXTURES/node/package.json" "$d/package.json"
cd "$d"
node "$CLI_BIN" --mode full --force --type node > /dev/null 2>&1
ls .github/workflows/
```

- [ ] **Step 2: common 워크플로우(RELEASE-PUBLISH) 직접 수정**

```bash
TARGET=".github/workflows/PROJECT-COMMON-RELEASE-PUBLISH.yaml"
test -f "$TARGET" && echo "# QA-USER-EDIT-MARKER $(date +%s)" >> "$TARGET"
cp "$TARGET" "$QA_ROOT/h3-common-overwrite/before-rerun.yaml"
```

- [ ] **Step 3: 동일 명령 재실행(멱등성 트리거) — 대화형으로 실행해 3지선 프롬프트 유무 확인**

```bash
script -q "$QA_ROOT/h3-common-overwrite/rerun.log" node "$CLI_BIN" --mode full --type node <<'STDIN'


STDIN
```

- [ ] **Step 4: 덮어쓰기 여부 확인**

```bash
diff "$QA_ROOT/h3-common-overwrite/before-rerun.yaml" "$TARGET"
grep -q "QA-USER-EDIT-MARKER" "$TARGET" && echo "KEPT: 마커가 남아있음(3지선 적용됨)" || echo "OVERWRITTEN: 마커가 사라짐(무조건 덮어쓰기 재현)"
```

Expected(README 기준): 유지/백업 후 교체/참고본 추가 중 하나를 물어봐야 함(3지선).
Bug 재현 조건(H3): 질문 없이 `QA-USER-EDIT-MARKER`가 사라짐(=`OVERWRITTEN` 출력).

- [ ] **Step 5: 결과 기록**

```bash
cat >> "$QA_ROOT/findings.md" <<EOF

## [Phase1-4] H3: common 워크플로우 3지선 미적용 (최우선 확인)
- 실행 커맨드: RELEASE-PUBLISH.yaml 수동 편집 후 \`node bin/project-auto-wizard.js --mode full --type node\` 재실행
- 기대 동작: 유지/백업/참고본 3지선 질문
- 실제 동작: $(grep -q "QA-USER-EDIT-MARKER" "$TARGET" 2>/dev/null && echo "마커 유지됨" || echo "마커 사라짐(무조건 덮어쓰기)")
- 판정: (BUG(H3) | PASS)
EOF
```

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

```bash
echo "--- flutter (README: 8종) ---"; wc -l < "$QA_ROOT/types/flutter/workflow-files.txt"
echo "--- spring (GITHUB-PACKAGES-PUBLISH.yml 포함 여부, M9) ---"; grep -i "GITHUB-PACKAGES-PUBLISH" "$QA_ROOT/types/spring/workflow-files.txt"
echo "--- react (CI/CICD 분리) ---"; cat "$QA_ROOT/types/react/workflow-files.txt"
echo "--- next ---"; cat "$QA_ROOT/types/next/workflow-files.txt"
echo "--- python (CI/PR-PREVIEW/SIMPLE-CICD 3종) ---"; wc -l < "$QA_ROOT/types/python/workflow-files.txt"
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

- [ ] **Step 4: M4 — --force + 모노레포 후보 2개 이상**

```bash
d=$(new_repo cli-edge/force-monorepo-ambiguous)
mkdir -p "$d/app" "$d/client"
cp "$FIXTURES/monorepo/app/pubspec.yaml" "$d/app/pubspec.yaml"
cp "$FIXTURES/monorepo/client/package.json" "$d/client/package.json"
( cd "$d" && node "$CLI_BIN" --mode full --force --type flutter,react > out.log 2>&1 )
cat "$d/out.log"
cat "$d/version.yml" | grep -A5 "project_paths"
```

Expected(M4): 경로가 애매한데도 경고만 찍고 조용히 `.`(루트)로 확정되는지 확인.

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

- [ ] **Step 3: dry-run × 5개 모드 — 파일 미변경 확인**

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

```bash
d=$(new_repo modes/purge-keep-branch); cp "$FIXTURES/node/package.json" "$d/package.json"
( cd "$d" && node "$CLI_BIN" --mode full --force --type node --develop-branch develop > /dev/null 2>&1 )
( cd "$d" && git branch )
( cd "$d" && node "$CLI_BIN" --mode purge --force > purge.log 2>&1 )
( cd "$d" && git branch ) > "$d/branches-after-purge.txt"
cat "$d/branches-after-purge.txt"
```

- [ ] **Step 6: 결과 기록**

```bash
cat >> "$QA_ROOT/findings.md" <<'EOF'

## [Phase4-1] status 정상 케이스
- 판정: (PASS | NEW-BUG)

## [Phase4-2] M6: status branches 부분 객체 drift 오탐
- 판정: (BUG(M6) | PASS)

## [Phase4-3] doctor gh 미인증 메시지 정확성
- 판정: (PASS | NEW-BUG)

## [Phase4-4] dry-run 5개 모드 파일 미변경 확인
- 판정: (PASS | NEW-BUG)

## [Phase4-5] revert/uninstall 미설치 상태 안전 종료
- 판정: (PASS | NEW-BUG)

## [Phase4-6] purge --delete-develop-branch 유무 차이
- 판정: (PASS | NEW-BUG)
EOF
```

---

### Task 10: Phase 5 — 재실행 멱등성 심층 (H3 교차검증, M7, M8, secret-backup/coderabbit skip 규칙)

**Files:**
- Create: `$QA_ROOT/idempotency/*` (스크래치패드)

**Interfaces:**
- Consumes: Task 1의 `new_repo` 함수

- [ ] **Step 1: 타입별 워크플로우 수정 후 재실행 3지선 (대화형, skip/backup/template 각각)**

```bash
source "$QA_ROOT/helpers/new-repo.sh"
d=$(new_repo idempotency/type-conflict); cp "$FIXTURES/node/package.json" "$d/package.json"
cd "$d"
node "$CLI_BIN" --mode full --force --type node > /dev/null 2>&1
TARGET=$(find .github/workflows -iname "*NODE*CI*" | head -1)
echo "# QA-EDIT" >> "$TARGET"
script -q "$QA_ROOT/idempotency/type-conflict/rerun-skip.log" node "$CLI_BIN" --mode full --type node
```

대화형 프롬프트에서 "유지(skip)"를 선택해 마커가 남는지, "백업 후 교체"를 선택하면 `.bak` 파일이 생기는지, "참고본 추가"를 선택하면 `.template.yaml`이 생기는지 각각 별도 저장소(`idempotency/type-conflict-skip`, `-backup`, `-template`)를 만들어 3회 반복한다.

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

```bash
source "$QA_ROOT/helpers/new-repo.sh"
d=$(new_repo ui-edge/no-color); cp "$FIXTURES/node/package.json" "$d/package.json"
( cd "$d" && NO_COLOR=1 node "$CLI_BIN" --mode full --force --type node > out.log 2>&1 )
grep -P "\x1b\[" "$d/out.log" && echo "ANSI 이스케이프 섞임(L2 재현)" || echo "클린"
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

```bash
d=$(new_repo ui-edge/no-jq); cp "$FIXTURES/node/package.json" "$d/package.json"
( cd "$d" && PATH="/usr/bin:/bin" node "$CLI_BIN" --mode full --force --type node > out.log 2>&1 )
grep "version:" "$d/version.yml"
```

macOS 기본 `/usr/bin`에 jq가 없다는 전제로 PATH를 제한한다. jq가 이미 `/usr/bin`이나 `/bin`에 있다면 별도 격리된 빈 PATH 디렉터리를 만들어 재시도한다.

- [ ] **Step 5: M5 — fetch 안 된 상태에서 develop 자동 생성**

```bash
d=$(new_repo ui-edge/no-fetch); cp "$FIXTURES/node/package.json" "$d/package.json"
cd "$d"
git remote add origin "file://$QA_ROOT/ui-edge/no-fetch-bare.git" 2>/dev/null
git init --bare "$QA_ROOT/ui-edge/no-fetch-bare.git" -q 2>/dev/null || true
node "$CLI_BIN" --mode full --force --type node --main-branch main --develop-branch develop > out.log 2>&1
cat out.log
```

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

- [ ] **Step 1: findings.md 전체를 판정별로 집계**

```bash
grep -B4 "판정: BUG" "$QA_ROOT/findings.md" > "$QA_ROOT/confirmed-bugs.md"
grep -B4 "판정: NEW-BUG" "$QA_ROOT/findings.md" > "$QA_ROOT/new-bugs.md"
grep -c "판정: PASS" "$QA_ROOT/findings.md"
```

- [ ] **Step 2: 요약 리포트 작성**

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

- [ ] **Step 3: 사용자 확인 대기**

이 계획은 여기서 실행을 멈춘다. `summary-report.md`의 확정 버그/신규 발견 목록을 사용자에게 제시하고, **어떤 항목을 이슈 #11 하위 개별 이슈로 분리할지 사용자 확인을 받은 뒤에만** `issue` 스킬로 이슈를 생성한다(자동으로 다건의 GitHub 이슈를 생성하지 않는다 — 위험도가 높은 외부 작업이므로 사용자 승인 필요).

- [ ] **Step 4: (해당 시) 확정 버그를 사용자 승인 하에 이슈로 분리**

사용자가 승인한 항목에 한해 `issue` 스킬을 항목별로 호출해 이슈 #11 하위 후속 이슈를 생성한다. 이 단계는 코드 수정이 아니므로 Global Constraints의 "코드 수정 금지"에 저촉되지 않는다.

---

## Self-Review 체크리스트 (계획 작성자용, 실행자는 무시)

1. **스펙 커버리지**: 설계 문서(2026-08-04-full-feature-qa-test-plan-design.md)의 Phase 0~6이 Task 1~11에 모두 매핑됨. HIGH 4건(H1~H4)은 Task 2~4, MEDIUM 11건(M1~M11)은 Task 5~11 전역에 분산 배치, LOW 13건 중 실행으로 검증 가능한 항목(L1~L7)은 Task 8·11에 배치, 실행보다 코드 확인이 적절한 항목(L8~L13)은 이번 실행 계획에서 제외하고 결과 종합 단계에서 코드 재확인 메모로 남긴다.
2. **플레이스홀더 스캔**: 각 Task의 판정 라인은 "(BUG(ID) | PASS)" 형태로 실행자가 실제 관찰값을 채우도록 되어 있음 — 이는 계획 누락이 아니라 QA 리포트의 정상적인 기록 형식(실행 전에는 결과를 알 수 없으므로).
3. **타입/함수 일관성**: `new_repo` 함수 시그니처(`new_repo <name>` → 경로 stdout 출력, `$QA_ROOT/<name>`에 생성)가 Task 2~11에서 동일하게 사용됨.
