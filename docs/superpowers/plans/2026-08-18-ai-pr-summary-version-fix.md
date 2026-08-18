# AI PR Summary 버전 불일치 수정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** release PR(develop → main)에서 AI Summary PR 댓글이 버전 확정(bump) 이전의 구버전을 보여주는 버그를 근본 원인 수준에서 고친다.

**Architecture:** `PROJECT-COMMON-AUTO-CHANGELOG-CONTROL`이 버전을 확정한 직후, 자신이 이미 생성한 `summary.md`를 그 잡(job) 안에서 곧바로 PR 댓글로 게시하도록 스텝을 추가한다. `PROJECT-COMMON-AI-PR-SUMMARY`는 release PR(head == develop)에서는 스킵하도록 조건을 추가해, 버전이 확정되기 전에 구버전으로 댓글을 다는 경로 자체를 없앤다.

**Tech Stack:** GitHub Actions YAML(`.github/workflows/`, `payload/workflows/common/`), bash, `python3`(stdlib only), `curl`, `gh` CLI, `actionlint`(정적 검증용).

**Spec:** 별도 spec 문서 없음 — 아래 "Background / Root Cause"가 spec을 대신한다. (사용자 확인: plan 단일 문서로 진행)

## Background / Root Cause

- `PROJECT-COMMON-AI-PR-SUMMARY.yaml`과 `PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml`은 동일한 이벤트(`pull_request: opened/synchronize/reopened`, base=main)에서 서로 독립적으로 실행된다.
- release PR(head=develop)에서 AI-PR-SUMMARY는 그 순간 체크아웃된, 아직 bump되지 않은 `version.yml`을 읽어 즉시 댓글을 단다. AUTO-CHANGELOG-CONTROL은 같은 잡 안에서 버전을 bump하고 `chore(version): confirm vX.Y.Z ...` 커밋을 develop에 push한다 — AI-PR-SUMMARY보다 항상 늦게 확정된다.
- AUTO-CHANGELOG-CONTROL의 confirm 커밋 push는 checkout에 명시된 `secrets.GITHUB_TOKEN`으로 수행된다. GitHub Actions 정책상 GITHUB_TOKEN으로 만든 push는 다른 워크플로우의 `pull_request: synchronize` 재트리거를 일으키지 않는다(무한 루프 방지 정책, 이 저장소에서는 이슈 #35로 이미 알려진 문제 — `NPM-PUBLISH.yaml` 헤더 주석 참고). 따라서 confirm 커밋이 push된 뒤 AI-PR-SUMMARY가 다시 실행되어 정정된 댓글을 달 기회가 구조적으로 없다.
- `CHANGELOG.md`는 같은 AUTO-CHANGELOG-CONTROL 잡 안에서 bump *이후*에 동기적으로 생성되므로 항상 정확하다 — 이 차이가 "자동 확정 v0.0.2 / AI Summary v0.0.1 / CHANGELOG v0.0.2" 3중 불일치의 원인이다.
- 이 저장소는 `WORKFLOW_PAT` 시크릿이 등록되어 있고(`gh secret list` 확인), `version.yml`은 `mode: pr-flow`, `semver_auto: true`로 설정되어 있다(release PR 흐름을 사용하는 것이 맞다).

## Global Constraints

- `payload/workflows/common/*.yaml`이 실제 배포 템플릿(플레이스홀더 `{{MAIN_BRANCH}}`, `{{DEVELOP_BRANCH}}` 포함)이고, `.github/workflows/*.yaml`은 이 저장소가 자기 자신에게 적용한 렌더링된 사본(플레이스홀더 → `main`/`develop` 리터럴)이다. **두 파일은 항상 같은 커밋에서 함께 수정한다** (선례: 커밋 `33939f6`).
- 릴리스 확정 커밋 메시지 패턴 `"chore(release):"`, `"chore(version): confirm v...`는 `PROJECT-COMMON-VERSION-CONTROL` / `PROJECT-COMMON-RELEASE-PUBLISH`가 그대로 참조하므로 절대 바꾸지 않는다.
- `payload/` 쪽 파일에서만 `{{MAIN_BRANCH}}` / `{{DEVELOP_BRANCH}}` 플레이스홀더를 쓰고, `.github/workflows/` 쪽은 리터럴 `main` / `develop`을 쓴다(기존 관례 그대로 유지).
- 이번 수정은 "release PR AI Summary가 잘못된 버전을 보여주는 문제"만 고친다. AI-PR-SUMMARY가 PR sync마다 댓글을 반복해서 다는 기존 동작(스팸성 재게시)은 이번 범위에 포함하지 않는다 — 수정 후에도 동일하게 유지된다.

---

### Task 1: AUTO-CHANGELOG-CONTROL이 확정된 버전으로 AI Summary를 직접 게시

**Files:**
- Modify: `payload/workflows/common/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml:20-23` (헤더 주석), `:133-154` (새 스텝 삽입), `:171-177`("Commit release docs" 스텝의 `rm -f` 목록)
- Modify: `.github/workflows/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml:20-23`, `:133-154`, `:171-177` (동일 내용, 플레이스홀더 없음이라 두 파일 diff 동일)

**Interfaces:**
- Consumes: 이전 스텝("Generate summary with the AI engine chain")이 만든 `summary.md` 파일, job 이미 보유한 `permissions.pull-requests: write`.
- Produces: 없음(마지막 부수효과 — PR에 댓글 POST). 새 스텝은 `continue-on-error: true`라서 실패해도 뒤 스텝이 계속 진행되며, 스텝이 만드는 `comment_body.md`/`comment_payload.json`은 스텝 자체에서 1차로 지우고, "Commit release docs to the PR head branch" 스텝의 `rm -f` 목록에도 추가해 중간 실패로 남았을 경우까지 방어한다.

- [ ] **Step 1: 헤더 주석 갱신 — payload 템플릿**

`payload/workflows/common/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml`의 20~23행:

```
# 3. Updates CHANGELOG.json / CHANGELOG.md and commits to the PR head
#    branch with [skip ci]
# 4. Enables automerge (gh pr merge --auto --merge)
#
```

를 아래로 교체:

```
# 3. Posts the same summary as a PR comment (this replaces
#    PROJECT-COMMON-AI-PR-SUMMARY for release PRs, which skips them —
#    that workflow would otherwise post the pre-bump version, since it
#    runs before this job's version-confirm commit lands and that
#    commit's GITHUB_TOKEN push doesn't retrigger pull_request events)
# 4. Updates CHANGELOG.json / CHANGELOG.md and commits to the PR head
#    branch with [skip ci]
# 5. Enables automerge (gh pr merge --auto --merge)
#
```

- [ ] **Step 2: 동일 헤더 주석 갱신 — `.github` self-copy**

`.github/workflows/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml`의 같은 20~23행에 Step 1과 **완전히 동일한 텍스트**를 적용한다(이 구간에는 플레이스홀더가 없으므로 payload와 바이트 단위로 동일).

- [ ] **Step 3: "Post AI summary comment" 스텝 삽입 — payload 템플릿**

`payload/workflows/common/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml`에서 `- name: Generate summary with the AI engine chain` 스텝의 끝(`cp summary.md pr_body.md` 다음 줄, 153행)과 `- name: Update CHANGELOG from summary` 스텝(155행) 사이에 아래 스텝을 삽입:

```yaml
      - name: Post AI summary comment
        continue-on-error: true
        run: |
          PR_NUMBER=${{ github.event.pull_request.number }}

          {
            echo "🤖 **AI Summary (project-auto-wizard)**"
            echo ""
            cat summary.md
          } > comment_body.md

          python3 -c 'import json; print(json.dumps({"body": open("comment_body.md", encoding="utf-8").read()}))' > comment_payload.json

          curl -sf -H "Authorization: token ${{ github.token }}" \
               -H "Content-Type: application/json" \
               -X POST \
               -d @comment_payload.json \
               "https://api.github.com/repos/${{ github.repository }}/issues/${PR_NUMBER}/comments" > /dev/null \
            || echo "comment post failed — continuing (this workflow never blocks the release)"

          rm -f comment_body.md comment_payload.json
```

(`permissions.pull-requests: write`는 이미 잡 상단에 있으므로 추가 권한 변경 불필요. curl로 `${{ github.token }}`를 인라인 사용하는 패턴은 `PROJECT-COMMON-AI-PR-SUMMARY.yaml`의 기존 "Generate and post AI summary" 스텝과 동일하다. `continue-on-error: true`는 필수다 — 이 스텝은 릴리스 잡 내부에 있어서, 만약 curl 밖의 `{ ... } > comment_body.md`나 `python3` JSON 생성이 실패하면 그 실패가 이 스텝을 실패시키고, 그러면 뒤에 이어지는 "Update CHANGELOG from summary" / "Commit release docs" / "Enable automerge"까지 전부 실행되지 않아 릴리스 자체가 막힌다. AI Summary 댓글은 릴리스의 필수 조건이 아니므로 이 스텝의 실패가 릴리스를 막아서는 안 된다. — fable5 검토 지적사항 1)

- [ ] **Step 4: 동일 스텝 삽입 — `.github` self-copy**

`.github/workflows/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml`의 같은 위치(153행/155행 사이)에 Step 3과 **완전히 동일한 YAML**을 삽입한다(이 스텝 안에는 `{{MAIN_BRANCH}}`/`{{DEVELOP_BRANCH}}` 플레이스홀더가 전혀 없으므로 두 파일 내용이 동일).

- [ ] **Step 5: "Commit release docs" 스텝의 임시 파일 정리 목록 갱신 — payload 템플릿**

`payload/workflows/common/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml`의 "Commit release docs to the PR head branch" 스텝 안:

```bash
          # Working files must not land in the repo
          rm -f pr_body.md summary.md commits.txt diff_stat.txt
```

를 아래로 교체:

```bash
          # Working files must not land in the repo
          rm -f pr_body.md summary.md commits.txt diff_stat.txt comment_body.md comment_payload.json
```

(Step 3에서 추가한 "Post AI summary comment" 스텝은 `continue-on-error: true`라서, 이 스텝 안에서 `comment_body.md`/`comment_payload.json` 삭제 전에 실패하면 두 파일이 워크트리에 남을 수 있다. 여기서도 지워야 뒤이은 `git add -A`가 이 파일들을 develop 브랜치에 실수로 커밋하지 않는다. — fable5 검토 지적사항 2)

- [ ] **Step 6: 동일 정리 목록 갱신 — `.github` self-copy**

`.github/workflows/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml`의 같은 위치에 Step 5와 동일한 교체를 적용한다.

- [ ] **Step 7: 정적 검증**

```bash
actionlint .github/workflows/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml
actionlint payload/workflows/common/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml
npm test
```

actionlint는 수정 전 베이스라인(이번 조사에서 확인, 우리 변경과 무관한 기존 항목들 — SC2086 info ×2, SC2155 warning ×2, `github.event.pull_request.head.ref` untrusted-expression 경고 ×1, payload는 `{{ }}` 플레이스홀더로 인한 SC1083 warning ×4 추가)와 비교해 **새로운 finding이 없는지** 확인한다. 새 finding이 있으면 그 줄을 수정한다. `npm test`는 `tests/node/payload-yaml.test.js`(payload YAML 블록 스칼라 구조 검사 등)를 포함한 전체 노드 테스트가 이번 YAML 편집으로 깨지지 않는지 확인한다(fable5 검토 지적사항 3). 전부 통과해야 한다.

- [ ] **Step 8: 두 파일이 실제로 동일한 diff를 갖는지 확인**

```bash
diff \
  <(sed 's/{{MAIN_BRANCH}}/main/g; s/{{DEVELOP_BRANCH}}/develop/g' payload/workflows/common/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml) \
  .github/workflows/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml
```

플레이스홀더 치환 후 두 파일이 완전히 동일해야 한다(exit 0, 출력 없음).

- [ ] **Step 9: Commit**

```bash
git add payload/workflows/common/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml \
        .github/workflows/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml
git commit -m "fix: AUTO-CHANGELOG-CONTROL이 확정된 버전으로 AI Summary를 직접 게시하도록 수정"
```

---

### Task 2: AI-PR-SUMMARY가 release PR(head=develop)에서는 스킵하도록 수정

**Files:**
- Modify: `payload/workflows/common/PROJECT-COMMON-AI-PR-SUMMARY.yaml:12-18` (헤더 주석), `:36` (job `if:` 조건)
- Modify: `.github/workflows/PROJECT-COMMON-AI-PR-SUMMARY.yaml:12-18`, `:36`

**Interfaces:**
- Consumes: 없음(트리거 조건만 변경).
- Produces: 없음. Task 1과의 관계 — Task 1이 release PR의 AI Summary 댓글을 이미 책임지므로, 이 Task는 그 케이스에서 이 워크플로우가 개입하지 않도록 막는 역할.

- [ ] **Step 1: 헤더 주석 갱신 — payload 템플릿**

`payload/workflows/common/PROJECT-COMMON-AI-PR-SUMMARY.yaml`의 12~18행:

```
# Independent from PROJECT-COMMON-AUTO-CHANGELOG-CONTROL: on release
# PRs both workflows may call the AI engine once each, and when
# semver_auto is on, AUTO-CHANGELOG-CONTROL's bump classification may
# add a third AI-assisted call to resolve an ambiguous patch->minor
# escalation (up to 3 LLM calls total). This is an accepted trade-off
# for simplicity — GitHub Models is free-tier and rule-based fallback
# is instant either way.
```

를 아래로 교체:

```
# On release PRs (head branch == {{DEVELOP_BRANCH}}) this job is
# skipped. PROJECT-COMMON-AUTO-CHANGELOG-CONTROL owns that case: it
# confirms the version first, then posts the AI summary itself using
# the confirmed version. Running this workflow too would post a
# comment with the pre-bump version — it always checks out the head
# branch before AUTO-CHANGELOG-CONTROL's version-confirm commit lands,
# and that commit is pushed with GITHUB_TOKEN, which GitHub does not
# use to retrigger pull_request events, so there would be no later run
# to correct it.
```

- [ ] **Step 2: 동일 헤더 주석 갱신 — `.github` self-copy**

`.github/workflows/PROJECT-COMMON-AI-PR-SUMMARY.yaml`의 같은 12~18행에 Step 1과 동일한 텍스트를 적용하되, `{{DEVELOP_BRANCH}}`를 리터럴 `develop`으로 바꾼다.

- [ ] **Step 3: job 조건 수정 — payload 템플릿**

`payload/workflows/common/PROJECT-COMMON-AI-PR-SUMMARY.yaml`의 36행:

```yaml
    if: github.event.pull_request.head.repo.full_name == github.repository
```

를 아래로 교체:

```yaml
    if: >-
      github.event.pull_request.head.repo.full_name == github.repository &&
      github.event.pull_request.head.ref != '{{DEVELOP_BRANCH}}'
```

- [ ] **Step 4: job 조건 수정 — `.github` self-copy**

`.github/workflows/PROJECT-COMMON-AI-PR-SUMMARY.yaml`의 같은 36행에 Step 3과 동일한 조건을 적용하되 `{{DEVELOP_BRANCH}}`를 리터럴 `develop`으로 바꾼다.

- [ ] **Step 5: 정적 검증**

```bash
actionlint .github/workflows/PROJECT-COMMON-AI-PR-SUMMARY.yaml
actionlint payload/workflows/common/PROJECT-COMMON-AI-PR-SUMMARY.yaml
npm test
```

Task 1의 Step 7과 같은 방식으로, actionlint는 수정 전 베이스라인(SC1083 warning ×4는 payload에만 있던 기존 항목) 대비 새 finding이 없는지 확인한다. `npm test`는 `tests/node/ai-pr-summary.test.js` 등 관련 노드 테스트가 `if:` 조건 변경으로 깨지지 않는지 확인한다(fable5 검토 지적사항 3). 전부 통과해야 한다.

- [ ] **Step 6: 두 파일이 실제로 동일한 diff를 갖는지 확인**

```bash
diff \
  <(sed 's/{{MAIN_BRANCH}}/main/g; s/{{DEVELOP_BRANCH}}/develop/g' payload/workflows/common/PROJECT-COMMON-AI-PR-SUMMARY.yaml) \
  .github/workflows/PROJECT-COMMON-AI-PR-SUMMARY.yaml
```

- [ ] **Step 7: Commit**

```bash
git add payload/workflows/common/PROJECT-COMMON-AI-PR-SUMMARY.yaml \
        .github/workflows/PROJECT-COMMON-AI-PR-SUMMARY.yaml
git commit -m "fix: release PR(develop)에서는 AI-PR-SUMMARY를 스킵하도록 수정"
```

---

### Task 3: 실제 release PR로 수동 검증

**Files:** 없음(코드 변경 없음 — 검증 전용 태스크).

**Interfaces:**
- Consumes: Task 1·2가 커밋된 상태의 `main`/`develop`.
- Produces: 검증 결과 기록(이 태스크 완료 시 Task 1·2가 실제로 문제를 고쳤음을 확인).

GitHub Actions 워크플로우는 유닛 테스트로 재현할 수 없으므로, 실제 develop → main 릴리스 PR을 통해 검증한다(사용자 확인: 실제 release PR로 수동 검증).

- [ ] **Step 1: Task 1·2 커밋을 develop에 반영**

지금까지의 변경이 `main`에 있다면 이 저장소의 정상 릴리스 흐름(develop → main PR)을 타야 하므로, 먼저 `develop` 브랜치로 변경을 가져온다(이미 develop에서 작업 중이면 스킵):

```bash
git checkout develop
git pull origin develop
git merge --no-ff <이 수정을 담은 브랜치>
git push origin develop
```

- [ ] **Step 2: develop → main 릴리스 PR 오픈**

```bash
gh pr create --base main --head develop \
  --title "release: AI Summary 버전 표시 수정 검증" \
  --body "PROJECT-COMMON-AUTO-CHANGELOG-CONTROL / PROJECT-COMMON-AI-PR-SUMMARY 수정 검증용 릴리스 PR"
```

- [ ] **Step 3: Actions 탭에서 두 워크플로우 실행 결과 확인**

`PROJECT-AUTO-CHANGELOG-CONTROL` 실행 로그에서 "Post AI summary comment" 스텝이 성공했는지 확인하고, `PROJECT-AI-PR-SUMMARY`가 이 PR에서는 **스킵**(guard 조건에 걸려 실행되지 않음)되었는지 확인한다.

- [ ] **Step 4: PR 댓글이 정확히 1개, 정확한 버전으로 달렸는지 확인**

```bash
gh pr view <PR번호> --json comments --jq '.comments[] | select(.body | contains("AI Summary")) | {createdAt, body: .body[0:200]}'
```

- AI Summary 댓글이 정확히 1개여야 한다.
- 그 댓글 안의 버전 표기가 같은 PR의 `chore(version): confirm vX.Y.Z ...` 커밋 메시지의 버전과 **일치**해야 한다.
- 병합 후 `CHANGELOG.md`의 최신 항목 버전과도 일치해야 한다.

- [ ] **Step 5: automerge 및 GitHub Release까지 정상 완주하는지 확인**

병합 후 `PROJECT-RELEASE-PUBLISH`가 실행되어 태그와 GitHub Release가 생성되는지, `NPM-PUBLISH`가 이어서 트리거되는지 확인한다(이번 버그 수정이 기존 릴리스 파이프라인을 깨뜨리지 않았음을 확인하는 회귀 체크).

- [ ] **Step 6: 검증 완료 후 영상 재촬영 가능 상태임을 확인**

Step 4에서 확인한 "커밋 확정 버전 = AI Summary 버전 = CHANGELOG 버전" 일치가 재현되면, 원래 사용자가 지적한 제출 영상의 불일치가 해소된 것으로 보고 재촬영을 진행한다.
