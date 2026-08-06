# WS1 — CI 신설 및 테스트 결과 유실 제거 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이슈 [#33](https://github.com/Twin-Fang/project-auto-wizard/issues/33) — 테스트 결과 유실을 제거하고, GitHub에서 테스트가 실제로 실행되도록 CI를 신설한다.

**Architecture:** `package.json`의 `test:node` 스크립트에 `--test-concurrency=1`을 넣어 Node 테스트 러너의 IPC 역직렬화 실패를 회피한다. `.github/workflows/CI.yaml`을 신설해 `pull_request`·`push: main`에서 Node 20·22·24 × ubuntu·windows 6조합으로 `npm test`를 실행한다. 의존성이 0개이고 lockfile이 없으므로 설치 단계 없이 `setup-node` + `setup-python`만으로 동작한다.

**Tech Stack:** GitHub Actions, Node.js `node:test`, Python `unittest`.

## Global Constraints

- 신규 npm 의존성 추가 금지 — zero-dependency 원칙.
- `package.json`의 `engines`는 `">=20.12"`. CI 하한을 이보다 낮추지 않는다.
- `.github/workflows/CI.yaml`은 이 레포 전용이다 — `payload/`에 복제하지 않는다(마법사 사용자 프로젝트에 이 레포의 테스트 CI가 깔리면 안 된다).
- 커밋 메시지 형식: `릴리스_파이프라인_정비_CI_신설 : <타입> : <설명> https://github.com/Twin-Fang/project-auto-wizard/issues/33`
- 브랜치: `20260806_#33_CI_신설_및_테스트_결과_유실_제거`, base는 `main`.

---

### Task 1: 테스트 결과 유실 제거

**Files:**
- Modify: `package.json` (`scripts.test:node`)

**Interfaces:**
- Consumes: 없음
- Produces: `npm run test:node`가 결과 유실 없이 327개 전부를 집계한다. Task 2의 CI가 이 스크립트를 그대로 호출한다.

**배경**: 현재 `node --test "tests/node/**/*.test.js"`는 기본 병렬도로 자식 프로세스를 띄우고, Windows + Node 24 환경에서 `Unable to deserialize cloned data due to invalid or unsupported version`이 발생해 **매 실행마다 다른 3~5개 파일의 결과가 집계에서 사라진다**. 해당 파일들을 개별 실행하면 전부 통과하므로 테스트 자체의 실패가 아니다.

- [ ] **Step 1: 현재 상태를 기록한다 (변경 전 기준선)**

```bash
npm run test:node 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

Expected: `tests`가 310 안팎, `fail`이 3~5로 실행마다 흔들린다. 이 숫자를 기록해 둔다.

- [ ] **Step 2: 직렬 실행이 문제를 해소하는지 확인한다**

```bash
node --test --test-concurrency=1 "tests/node/**/*.test.js" 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

Expected: `pass 327`, `fail 0`.

- [ ] **Step 3: `package.json`의 `test:node`를 직렬로 고정한다**

`scripts.test:node`를 다음으로 교체한다.

```json
"test:node": "node --test --test-concurrency=1 \"tests/node/**/*.test.js\"",
```

- [ ] **Step 4: 스크립트를 통해 확인한다**

```bash
npm run test:node 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

Expected: `pass 327`, `fail 0`. Step 1의 숫자와 비교해 `tests` 총계가 늘어난 것(유실이 사라진 것)을 확인한다.

- [ ] **Step 5: 커밋**

```bash
git add package.json
git commit -F - <<'EOF'
릴리스_파이프라인_정비_CI_신설 : fix : 테스트 병렬 실행에서 결과 17개가 유실되던 문제 수정 https://github.com/Twin-Fang/project-auto-wizard/issues/33

node --test 기본 병렬도에서 자식 프로세스 결과가 역직렬화되지 못해
(Unable to deserialize cloned data) 매 실행마다 다른 3~5개 파일의 결과가
집계에서 사라졌다. 실패가 아니라 유실이므로 개별 실행하면 전부 통과한다.

--test-concurrency=1로 고정해 327개 전부가 집계되도록 한다(17초 → 46초).
EOF
```

---

### Task 2: CI 워크플로우 신설

**Files:**
- Create: `.github/workflows/CI.yaml`

**Interfaces:**
- Consumes: Task 1의 `npm run test:node`(직렬 고정), 기존 `npm run test:py`
- Produces: `CI / 테스트 (Node <N> · <OS>)` 형태의 체크 6개. WS3의 배포 전 게이트와 브랜치 보호 규칙이 이 체크 이름을 참조한다.

**설계 노트**:
- `fail-fast: false` — 한 조합이 깨져도 나머지를 봐야 "Windows만" 인지 "Node 24만" 인지 좁혀진다.
- 의존성이 0개이고 `package-lock.json`이 없으므로 `npm ci`/`npm install`을 실행하지 않는다. 실행하면 lockfile 부재로 실패하거나 불필요한 네트워크 왕복이 생긴다.
- `npm test`는 `test:node`와 `test:py`를 순차 실행한다. `scripts/run-py-tests.mjs`가 `python3`/`python`을 순서대로 탐색하므로 OS별 분기가 필요 없다.
- `permissions: contents: read` — 테스트는 쓰기 권한이 필요 없다.

- [ ] **Step 1: 워크플로우 파일을 만든다**

`.github/workflows/CI.yaml` 신규 생성:

```yaml
# ===================================================================
# CI.yaml
# 테스트 실행 워크플로우 (이 레포 전용 — payload에 복제하지 않는다)
# ===================================================================
#
# 동작:
# - PR과 main push에서 npm test(Node + Python)를 실행한다
# - Node 20·22·24 × ubuntu·windows 6조합 매트릭스
#
# Windows를 포함하는 이유: 이슈 #15가 Windows CRLF 회귀였고
# tests/node/line-endings.test.js가 그 회귀 가드다.
#
# 의존성이 0개이고 package-lock.json이 없으므로 설치 단계가 없다.
# ===================================================================

name: CI

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

on:
  pull_request:
  push:
    branches: ["main"]

permissions:
  contents: read

jobs:
  test:
    name: 테스트 (Node ${{ matrix.node }} · ${{ matrix.os }})
    runs-on: ${{ matrix.os }}

    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest]
        node: [20, 22, 24]

    steps:
      - name: 저장소 체크아웃
        uses: actions/checkout@v5

      - name: Node.js ${{ matrix.node }} 설정
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}

      - name: Python 설정 (test:py용)
        uses: actions/setup-python@v5
        with:
          python-version: '3.x'

      - name: 버전 확인
        run: |
          node --version
          npm --version
          python --version

      - name: 테스트 실행
        run: npm test
```

- [ ] **Step 2: YAML 문법을 검증한다**

```bash
node -e "const {readFileSync}=require('fs');const s=readFileSync('.github/workflows/CI.yaml','utf8');if(!/^name: CI$/m.test(s))throw new Error('name 누락');if(!/matrix:/.test(s))throw new Error('matrix 누락');console.log('CI.yaml 기본 구조 OK');"
```

Expected: `CI.yaml 기본 구조 OK`

- [ ] **Step 3: 로컬에서 CI가 실행할 명령을 그대로 돌려본다**

```bash
npm test
```

Expected: `test:node` 327 pass / 0 fail, `test:py` OK. CI에서 돌 명령이 로컬에서 통과하는지 먼저 확인한다.

- [ ] **Step 4: 커밋**

```bash
git add .github/workflows/CI.yaml
git commit -F - <<'EOF'
릴리스_파이프라인_정비_CI_신설 : feat : 테스트 CI 워크플로우 신설 https://github.com/Twin-Fang/project-auto-wizard/issues/33

테스트 327개가 GitHub에서 한 번도 실행되지 않고 작성자 로컬에서만 돌았다.
PR 체크에도, 배포 전에도 테스트가 없었다.

- pull_request + push:main 트리거
- Node 20·22·24 × ubuntu·windows 6조합 (fail-fast: false)
- Windows 포함 — 이슈 #15가 Windows CRLF 회귀였고 line-endings.test.js가 그 가드다
- 의존성 0개라 설치 단계 없이 setup-node + setup-python만으로 동작
EOF
```

---

### Task 3: README에 CI 배지 추가

**Files:**
- Modify: `README.md:14-16` (배지 블록)

**Interfaces:**
- Consumes: Task 2가 만든 워크플로우 이름 `CI`
- Produces: 없음 (문서만)

- [ ] **Step 1: 현재 배지 블록을 확인한다**

```bash
grep -n "img.shields.io" README.md | head -5
```

Expected: npm·license·node 배지 3개가 14~16행에 있다.

- [ ] **Step 2: CI 배지를 첫 번째로 추가한다**

`README.md`의 `[![npm]...` 줄 **바로 앞**에 다음 줄을 삽입한다.

```markdown
[![CI](https://github.com/Twin-Fang/project-auto-wizard/actions/workflows/CI.yaml/badge.svg)](https://github.com/Twin-Fang/project-auto-wizard/actions/workflows/CI.yaml)
```

- [ ] **Step 3: 배지 URL이 워크플로우 파일명과 일치하는지 확인한다**

```bash
node -e "const {readFileSync}=require('fs');const r=readFileSync('README.md','utf8');const m=r.match(/actions\/workflows\/([\w.-]+)\/badge\.svg/);if(!m)throw new Error('CI 배지 없음');const {existsSync}=require('fs');if(!existsSync('.github/workflows/'+m[1]))throw new Error('배지가 가리키는 워크플로우 파일 없음: '+m[1]);console.log('배지 → '+m[1]+' 일치');"
```

Expected: `배지 → CI.yaml 일치`

- [ ] **Step 4: 커밋**

```bash
git add README.md
git commit -F - <<'EOF'
릴리스_파이프라인_정비_CI_신설 : docs : README에 CI 상태 배지 추가 https://github.com/Twin-Fang/project-auto-wizard/issues/33
EOF
```

---

### Task 4: PR 생성 및 CI 실제 동작 확인

**Files:** 없음 (검증 태스크)

**Interfaces:**
- Consumes: Task 1~3의 커밋
- Produces: 머지된 `main`. WS3이 이 위에서 시작한다.

- [ ] **Step 1: 브랜치를 push한다**

```bash
git push -u origin HEAD
```

- [ ] **Step 2: PR을 생성한다**

```bash
gh pr create --repo Twin-Fang/project-auto-wizard --base main \
  --title "❗[버그][CI/테스트] 테스트 결과 유실 제거 + CI 워크플로우 신설" \
  --body "closes #33 — 상세 내용은 PR 본문 작성 시 이슈 #33과 docs/superpowers/specs/2026-08-06-release-pipeline-hardening-design.md §5.1을 참조해 채운다."
```

- [ ] **Step 3: CI 체크 6개가 뜨는지 확인한다**

```bash
gh pr checks <PR번호> --repo Twin-Fang/project-auto-wizard
```

Expected: `테스트 (Node 20 · ubuntu-latest)` 등 6개 항목이 나타난다. 이 PR 자체가 CI의 첫 실행이므로, 여기서 6개가 안 보이면 트리거 설정이 잘못된 것이다.

- [ ] **Step 4: 6조합이 모두 통과할 때까지 기다린다**

```bash
until [ -z "$(gh pr checks <PR번호> --repo Twin-Fang/project-auto-wizard --json state -q '.[]|select(.state=="PENDING")|.state')" ]; do sleep 10; done
gh pr checks <PR번호> --repo Twin-Fang/project-auto-wizard
```

Expected: 6개 전부 `pass`.

**실패 시 대응**: Windows 조합만 실패한다면 경로 구분자나 CRLF 문제일 가능성이 높다 — 실패한 잡의 로그에서 어느 테스트 파일인지 확인하고, `tests/node/line-endings.test.js`의 기존 패턴을 참고해 원인을 좁힌다. Node 24만 실패한다면 러너 버전 의존 이슈이므로 해당 테스트를 개별 실행해 재현한다.

- [ ] **Step 5: 머지한다**

```bash
gh pr merge <PR번호> --repo Twin-Fang/project-auto-wizard --merge
```

- [ ] **Step 6: 브랜치 보호에 CI를 필수 체크로 지정한다 (레포 설정, 수동)**

GitHub 웹에서 Settings → Branches → `main` 규칙에 다음을 추가한다.

- Require status checks to pass before merging
- 체크 목록에서 `테스트 (Node 20 · ubuntu-latest)` 외 5개를 선택

이 단계는 API로도 가능하지만 관리자 권한이 필요하다. 권한이 없으면 레포 소유자에게 요청하고, 이 계획에서는 완료로 표시하지 않는다.
