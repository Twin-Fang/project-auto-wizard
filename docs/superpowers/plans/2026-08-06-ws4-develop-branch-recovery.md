# WS4 — origin/develop 복구 및 pr-flow 정상 경로 회복 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이슈 [#36](https://github.com/Twin-Fang/project-auto-wizard/issues/36) — 37커밋 뒤처진 `origin/develop`을 복구하고, `CONTRIBUTING.md`가 안내하는 pr-flow 경로가 실제로 동작하게 만든다.

**Architecture:** `origin/develop`은 `origin/main`보다 앞선 커밋이 0개이므로 fast-forward만으로 복구된다(이력 왜곡 없음). 잔재 브랜치 `origin/develop-1`의 정체를 확인하고 정리한 뒤, 문서와 실제 운영이 일치하는지 검증한다.

**Tech Stack:** git, GitHub CLI.

## Global Constraints

- **WS1·WS2·WS3이 모두 머지된 뒤에 진행한다.** 배포 파이프라인이 안정화되기 전에 릴리스 PR 경로로 전환하면, 문제가 생겼을 때 원인이 파이프라인 변경인지 경로 변경인지 구분되지 않는다.
- `origin/develop`에 **force push를 쓰지 않는다.** fast-forward가 가능하므로 이력을 다시 쓸 이유가 없다.
- 브랜치 삭제는 되돌리기 어려우므로 삭제 전에 반드시 내용을 확인하고 사용자 승인을 받는다.
- 커밋이 필요한 경우 형식: `develop_브랜치_복구 : <타입> : <설명> https://github.com/Twin-Fang/project-auto-wizard/issues/36`

---

### Task 1: 현재 브랜치 상태 확인 및 fast-forward 가능성 검증

**Files:** 없음 (검증 태스크)

**Interfaces:**
- Consumes: 없음
- Produces: `origin/develop`이 fast-forward 가능하다는 확인. Task 2가 이 결과에 의존한다.

- [ ] **Step 1: main과 develop의 격차를 확인한다**

```bash
git fetch origin
git rev-list --left-right --count origin/main...origin/develop
```

Expected: `<N>	0` 형태 — 오른쪽(develop에만 있는 커밋)이 **0이어야 한다**. 0이 아니면 develop에 고유 작업이 있다는 뜻이므로 fast-forward가 불가능하고, 이 계획을 중단하고 어떤 커밋인지 먼저 조사해야 한다.

```bash
git log --oneline origin/main..origin/develop
```

Expected: 출력 없음(빈 결과).

- [ ] **Step 2: develop-1의 정체를 확인한다**

```bash
git log --oneline -5 origin/develop-1
git rev-list --left-right --count origin/main...origin/develop-1
git log --oneline origin/main..origin/develop-1
```

Expected: `origin/main..origin/develop-1`이 비어 있거나, `chore(version): bump to v0.1.15` 같은 버전 bump 커밋만 있다. 고유한 소스 변경이 있으면 삭제하지 않고 사용자에게 보고한다.

- [ ] **Step 3: develop-1에 고유 파일 변경이 있는지 확인한다**

```bash
git diff --stat origin/main origin/develop-1
```

Expected: `version.yml`·`README.md` 등 버전 관련 파일만 차이가 나거나 차이가 없다. `src/`·`payload/` 변경이 있으면 삭제 후보에서 제외한다.

---

### Task 2: origin/develop을 main으로 fast-forward

**Files:** 없음 (git 조작)

**Interfaces:**
- Consumes: Task 1의 검증 결과
- Produces: `origin/develop == origin/main`. 이후 feature 브랜치를 develop 기준으로 딸 수 있다.

- [ ] **Step 1: 로컬 develop을 원격 상태로 맞춘다**

```bash
git checkout develop 2>/dev/null || git checkout -b develop origin/develop
git fetch origin
git reset --hard origin/develop
```

- [ ] **Step 2: main으로 fast-forward한다**

```bash
git merge --ff-only origin/main
```

Expected: fast-forward 성공. `Not possible to fast-forward`가 나오면 Task 1의 전제가 틀린 것이므로 중단하고 재조사한다.

- [ ] **Step 3: 결과를 확인한다**

```bash
git rev-list --left-right --count origin/main...HEAD
git log --oneline -1
```

Expected: `0	0` — main과 완전히 같은 지점.

- [ ] **Step 4: 원격에 push한다**

```bash
git push origin develop
```

- [ ] **Step 5: 원격 상태를 검증한다**

```bash
git fetch origin
git rev-list --left-right --count origin/main...origin/develop
```

Expected: `0	0`.

---

### Task 3: develop-1 정리

**Files:** 없음 (git 조작)

**Interfaces:**
- Consumes: Task 1 Step 2·3의 확인 결과
- Produces: 잔재 브랜치 제거

**주의**: 브랜치 삭제는 되돌리기 번거롭다. Task 1에서 고유 변경이 없음을 확인한 경우에만 진행하고, **사용자에게 삭제 여부를 확인받는다.**

- [ ] **Step 1: 삭제 전에 마지막으로 내용을 확인한다**

```bash
git log --oneline origin/main..origin/develop-1
git diff --stat origin/main origin/develop-1
```

Expected: 버전 관련 파일만 차이가 있거나 차이 없음.

- [ ] **Step 2: 사용자에게 삭제 승인을 받는다**

확인한 내용(커밋 목록과 diff 요약)을 제시하고 삭제해도 되는지 묻는다. 승인 없이 진행하지 않는다.

- [ ] **Step 3: 승인 후 원격 브랜치를 삭제한다**

```bash
git push origin --delete develop-1
```

- [ ] **Step 4: 삭제를 확인한다**

```bash
git fetch --prune origin
git branch -r | grep develop
```

Expected: `origin/develop`만 남고 `origin/develop-1`이 없다.

---

### Task 4: 문서와 실제 운영의 일치 검증

**Files:**
- Modify(필요 시): `CONTRIBUTING.md`, `README.md`

**Interfaces:**
- Consumes: Task 2의 복구된 develop
- Produces: 문서대로 따라 하면 실제로 동작하는 상태

- [ ] **Step 1: CONTRIBUTING의 PR 규칙을 확인한다**

```bash
grep -n -A6 "## PR 규칙" CONTRIBUTING.md
```

Expected: "`main`이 아니라 `develop` 브랜치를 기준으로 브랜치를 따세요", "PR은 `develop`을 향해 엽니다".

- [ ] **Step 2: 문서대로 따라 했을 때 diff가 깨끗한지 확인한다**

```bash
git checkout -b tmp-verify-develop-base origin/develop
git rev-list --left-right --count origin/develop...HEAD
git checkout - && git branch -D tmp-verify-develop-base
```

Expected: `0	0` — develop 기준으로 브랜치를 따면 무관한 커밋이 섞이지 않는다.

- [ ] **Step 3: README의 릴리스 흐름 설명이 실제와 맞는지 확인한다**

```bash
grep -n -A10 "## 릴리스 흐름" README.md
```

pr-flow 다이어그램이 `develop push → develop→main 릴리스 PR → 버전 확정 → AI 릴리스 노트 → CHANGELOG → automerge → tag + Release`로 되어 있는지 확인한다. WS3에서 배포 단계가 추가됐으므로, npm 배포가 Release 이후에 온다는 점을 반영할지 판단한다.

- [ ] **Step 4: 필요 시 README를 갱신하고 커밋한다**

릴리스 흐름 다이어그램에 npm 배포 단계를 추가하는 경우:

```markdown
        AM[automerge] --> TAG["tag vX.Y.Z + GitHub Release"]
        TAG --> NPM["npm 배포 (provenance)"]
```

```bash
git add README.md
git commit -F - <<'EOF'
develop_브랜치_복구 : docs : 릴리스 흐름 다이어그램에 npm 배포 단계 반영 https://github.com/Twin-Fang/project-auto-wizard/issues/36
EOF
```

- [ ] **Step 5: 이슈를 닫는다**

```bash
gh issue close 36 --repo Twin-Fang/project-auto-wizard --comment "origin/develop을 origin/main으로 fast-forward해 복구했습니다. develop-1 잔재도 정리했습니다."
```

---

### Task 5: 다음 작업부터 pr-flow 경로 사용 확인

**Files:** 없음 (운영 확인)

**Interfaces:**
- Consumes: Task 2~4의 결과
- Produces: 이후 작업이 정상 경로를 타는지에 대한 확인

- [ ] **Step 1: 다음 feature 작업을 develop 기준으로 시작한다**

```bash
git checkout develop && git pull --ff-only
git checkout -b <날짜>_#<이슈>_<설명>
```

- [ ] **Step 2: PR을 develop으로 연다**

```bash
gh pr create --repo Twin-Fang/project-auto-wizard --base develop --title "..." --body "..."
```

- [ ] **Step 3: 릴리스 시점에 develop→main PR을 연다**

```bash
gh pr create --repo Twin-Fang/project-auto-wizard --base main --head develop \
  --title "release: v<버전>" --body "릴리스 PR"
```

Expected: `AUTO-CHANGELOG-CONTROL`이 이 PR에서 버전을 확정하고 CHANGELOG를 생성한 뒤 automerge한다. **`VERSION-CONTROL` 안전망이 개입하지 않으므로 #35의 레이스 조건 자체가 발생하지 않는다.**

- [ ] **Step 4: 릴리스 체인이 끝까지 도는지 확인한다**

```bash
gh run list --repo Twin-Fang/project-auto-wizard --limit 8
```

Expected: `AUTO-CHANGELOG-CONTROL`(PR) → `RELEASE-PUBLISH`(main push) → `NPM-PUBLISH`(release published) 순서로 실행되고 전부 성공.
