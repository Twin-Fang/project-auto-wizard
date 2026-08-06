# WS3 — npm 배포를 Release 트리거 + provenance로 전환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이슈 [#35](https://github.com/Twin-Fang/project-auto-wizard/issues/35) — `main` push 레이스에 의존하던 npm 배포를 GitHub Release 발행 이벤트 기반으로 옮기고, 배포 전 테스트 게이트와 provenance를 추가한다.

**Architecture:** `NPM-PUBLISH.yaml`의 트리거를 `push: main`에서 `release: published`로 옮기고, 체크아웃 대상을 `ref: main`(가변)에서 **릴리스 태그**(불변)로 바꾼다. `GITHUB_TOKEN`이 만든 이벤트는 후속 워크플로우를 트리거하지 않으므로, `RELEASE-PUBLISH`가 `WORKFLOW_PAT`으로 Release를 생성하도록 바꿔 체인을 잇는다. `npm publish --provenance`로 공급망 증명을 붙인다.

**Tech Stack:** GitHub Actions, npm CLI(provenance), GitHub OIDC.

## Global Constraints

- **WS1(CI 신설)이 선행되어야 한다.** 배포 전 테스트 게이트가 WS1의 `npm test` 안정화에 의존한다.
- `NPM-PUBLISH.yaml`은 이 레포 전용이다(`payload/`에 없음) — 자유롭게 바꿔도 마법사 사용자 프로젝트에 영향이 없다.
- `PROJECT-COMMON-RELEASE-PUBLISH.yaml`은 **payload와 이 레포 양쪽에 존재한다**. 수정 시 반드시 동기화한다(도그푸딩 레포 규칙, PR 템플릿 체크리스트).
- 사용자 레포에는 `WORKFLOW_PAT`이 없을 수 있으므로 `${{ secrets.WORKFLOW_PAT || github.token }}` 폴백을 쓴다. PAT이 없어도 릴리스 자체는 계속 동작해야 한다.
- 신규 npm 의존성 추가 금지.
- 커밋 메시지 형식: `npm_배포_Release_트리거_전환 : <타입> : <설명> https://github.com/Twin-Fang/project-auto-wizard/issues/35`
- 브랜치: `20260806_#35_npm_배포_Release_트리거_및_provenance_전환`, base는 `main`.

---

### Task 1: RELEASE-PUBLISH가 WORKFLOW_PAT으로 Release를 생성하도록 변경

**Files:**
- Modify: `payload/workflows/common/PROJECT-COMMON-RELEASE-PUBLISH.yaml` (`Create GitHub Release` 스텝의 `env`)
- Modify: `.github/workflows/PROJECT-COMMON-RELEASE-PUBLISH.yaml` (도그푸딩 사본 — 동일 변경)
- Test: `tests/node/payload-yaml.test.js` (기존 파일에 검증 추가)

**Interfaces:**
- Consumes: 없음
- Produces: `gh release create`가 `WORKFLOW_PAT`(있으면)으로 실행되어 `release: published` 이벤트가 후속 워크플로우를 트리거한다. Task 2의 `NPM-PUBLISH`가 이 이벤트에 의존한다.

**배경**: GitHub 정책상 `GITHUB_TOKEN`으로 생성한 이벤트는 다른 워크플로우를 트리거하지 않는다. 현재 `Create GitHub Release` 스텝은 `GH_TOKEN: ${{ github.token }}`을 쓰므로, Task 2에서 트리거를 옮겨도 `NPM-PUBLISH`가 영원히 뜨지 않는다. **이 태스크가 먼저 들어가야 Task 2가 의미를 갖는다.**

- [ ] **Step 1: 현재 토큰 사용 지점을 확인한다**

```bash
grep -n "GH_TOKEN\|github.token\|WORKFLOW_PAT" payload/workflows/common/PROJECT-COMMON-RELEASE-PUBLISH.yaml
```

Expected: `Create GitHub Release` 스텝을 포함해 여러 곳에서 `${{ github.token }}`을 쓴다. 이번에 바꿀 것은 **`gh release create`를 실행하는 스텝 하나**다.

- [ ] **Step 2: payload 쪽을 수정한다**

`payload/workflows/common/PROJECT-COMMON-RELEASE-PUBLISH.yaml`의 `Create GitHub Release` 스텝에서 `env` 블록을 교체한다.

```yaml
      - name: Create GitHub Release
        if: steps.gate.outputs.proceed == 'true' && steps.version.outputs.release_exists != 'true'
        env:
          # WORKFLOW_PAT으로 발행해야 release 이벤트가 후속 워크플로우(npm 배포 등)를 트리거한다.
          # GITHUB_TOKEN이 만든 이벤트는 GitHub 정책상 다른 워크플로우를 깨우지 못한다.
          # PAT이 없는 레포에서도 릴리스 자체는 계속 동작해야 하므로 기본 토큰으로 폴백한다.
          GH_TOKEN: ${{ secrets.WORKFLOW_PAT || github.token }}
        run: |
          VERSION="${{ steps.version.outputs.version }}"
          gh release create "v$VERSION" --title "v$VERSION" --notes-file notes.md
          echo "GitHub Release v$VERSION published"
```

- [ ] **Step 3: 이 레포의 도그푸딩 사본에 동일 변경을 적용한다**

`.github/workflows/PROJECT-COMMON-RELEASE-PUBLISH.yaml`에 Step 2와 같은 수정을 적용한다.

- [ ] **Step 4: 두 파일이 동기화됐는지 확인한다**

```bash
diff payload/workflows/common/PROJECT-COMMON-RELEASE-PUBLISH.yaml .github/workflows/PROJECT-COMMON-RELEASE-PUBLISH.yaml && echo "동기화 OK"
```

Expected: `동기화 OK` (차이가 없어야 한다). 차이가 있다면 브랜치 플레이스홀더 치환 때문일 수 있으므로 어느 쪽이 원본인지 확인하고 맞춘다.

- [ ] **Step 5: 회귀 테스트를 추가한다**

`tests/node/payload-yaml.test.js` 끝에 추가:

```js
// #35: Release는 WORKFLOW_PAT으로 발행해야 후속 워크플로우(npm 배포)가 트리거된다.
// GITHUB_TOKEN이 만든 이벤트는 GitHub 정책상 다른 워크플로우를 깨우지 못한다.
test("RELEASE-PUBLISH의 Release 생성은 WORKFLOW_PAT 폴백을 쓴다", () => {
  const p = join(REPO_ROOT, "payload", "workflows", "common", "PROJECT-COMMON-RELEASE-PUBLISH.yaml");
  const text = readFileSync(p, "utf8");
  const idx = text.indexOf("Create GitHub Release");
  assert.ok(idx > -1, "Create GitHub Release 스텝을 찾지 못했습니다");
  const block = text.slice(idx, idx + 600);
  assert.match(block, /GH_TOKEN:\s*\$\{\{\s*secrets\.WORKFLOW_PAT\s*\|\|\s*github\.token\s*\}\}/,
    "Release 생성 스텝이 WORKFLOW_PAT 폴백을 쓰지 않습니다");
});
```

`REPO_ROOT`·`readFileSync`·`join`이 해당 파일에 이미 import되어 있는지 확인하고, 없으면 파일 상단에 추가한다.

- [ ] **Step 6: 테스트 실행**

```bash
node --test tests/node/payload-yaml.test.js
```

Expected: PASS.

- [ ] **Step 7: 커밋**

```bash
git add payload/workflows/common/PROJECT-COMMON-RELEASE-PUBLISH.yaml .github/workflows/PROJECT-COMMON-RELEASE-PUBLISH.yaml tests/node/payload-yaml.test.js
git commit -F - <<'EOF'
npm_배포_Release_트리거_전환 : fix : Release를 WORKFLOW_PAT으로 발행해 후속 워크플로우가 트리거되도록 수정 https://github.com/Twin-Fang/project-auto-wizard/issues/35

GITHUB_TOKEN으로 만든 이벤트는 GitHub 정책상 다른 워크플로우를 트리거하지 않는다.
npm 배포를 release 이벤트로 옮기려면 Release 발행 주체가 PAT이어야 한다.
PAT이 없는 레포에서도 릴리스 자체는 동작해야 하므로 github.token으로 폴백한다.
EOF
```

---

### Task 2: NPM-PUBLISH를 Release 트리거로 전환

**Files:**
- Modify: `.github/workflows/NPM-PUBLISH.yaml` (전면 교체)

**Interfaces:**
- Consumes: Task 1이 만든 `release: published` 이벤트
- Produces: 태그 기준의 재현 가능한 npm 배포. 수동 재배포는 `workflow_dispatch`의 `tag` 입력으로 수행한다.

**설계 노트**:
- 체크아웃 대상을 **릴리스 태그**로 고정한다. `ref: main`은 "그때그때의 main"이라 무엇이 배포될지가 타이밍에 좌우됐다.
- 버전은 **태그에서 뽑는다**(`v0.1.20` → `0.1.20`). `version.yml` 값과 대조해 불일치하면 실패시킨다 — 태그와 패키지 버전이 어긋난 채로 배포되는 사고를 막는다.
- 배포 전에 `npm test`를 실행한다(WS1 선행 필요).
- `--provenance`를 붙인다. `permissions: id-token: write`는 이미 선언되어 있다.

- [ ] **Step 1: 현재 트리거를 확인한다**

```bash
grep -n -A6 "^on:" .github/workflows/NPM-PUBLISH.yaml
```

Expected: `push: branches: ["main"]` + `workflow_dispatch`. 이 `push` 트리거가 레이스의 원인이다.

- [ ] **Step 2: 파일을 전면 교체한다**

`.github/workflows/NPM-PUBLISH.yaml`을 다음 내용으로 교체한다.

```yaml
# ===================================================================
# NPM-PUBLISH.yaml
# project-auto-wizard npm 자동 배포 워크플로우 (이 레포 전용)
# ===================================================================
#
# 동작:
# - GitHub Release가 발행되면 그 태그를 체크아웃해 npm에 배포한다
# - 태그에서 버전을 뽑고 version.yml과 대조해 불일치 시 실패시킨다
# - 이미 레지스트리에 있는 버전이면 성공 종료 (멱등)
# - provenance를 첨부해 어느 커밋·워크플로우에서 빌드됐는지 검증 가능하게 한다
#
# 트리거: GitHub Release published (+ 수동 재배포는 workflow_dispatch)
#
# main push를 트리거로 쓰지 않는 이유(이슈 #35):
#   VERSION-CONTROL의 버전 bump와 동시에 시작해 경쟁하고, 지면 그 버전은
#   [skip ci] 때문에 영영 배포되지 않는다. 실제로 0.1.13·0.1.15·0.1.19가 누락됐다.
#   태그는 불변 스냅샷이라 무엇이 배포되는지가 타이밍과 무관해진다.
#
# 필요 Secret: NPM_TOKEN (npm Granular Access Token)
#   ※ npmjs.com에서 Trusted Publisher를 등록하면 이 시크릿 없이 OIDC로 배포할 수 있다.
# ===================================================================

name: NPM-PUBLISH

concurrency:
  group: npm-publish
  cancel-in-progress: false

on:
  release:
    types: [published]
  workflow_dispatch:
    inputs:
      tag:
        description: "재배포할 릴리스 태그 (예: v0.1.20)"
        required: true
        type: string

permissions:
  contents: read
  id-token: write

jobs:
  publish-npm:
    name: npm 패키지 배포
    runs-on: ubuntu-latest

    steps:
      - name: 배포 대상 태그 확정
        id: target
        run: |
          TAG="${{ github.event.release.tag_name || inputs.tag }}"
          if [ -z "$TAG" ]; then
            echo "배포 대상 태그를 확정할 수 없습니다"
            exit 1
          fi
          echo "tag=$TAG" >> $GITHUB_OUTPUT
          echo "version=${TAG#v}" >> $GITHUB_OUTPUT
          echo "배포 대상: $TAG (버전 ${TAG#v})"

      - name: 저장소 체크아웃 (릴리스 태그 기준)
        uses: actions/checkout@v5
        with:
          ref: ${{ steps.target.outputs.tag }}

      - name: Node.js 설정
        uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: https://registry.npmjs.org

      - name: Python 설정 (test:py용)
        uses: actions/setup-python@v5
        with:
          python-version: '3.x'

      - name: 태그와 version.yml 일치 확인
        run: |
          FILE_VERSION=$(python3 payload/scripts/version_manager.py get | tail -n 1)
          TAG_VERSION="${{ steps.target.outputs.version }}"
          if [ "$FILE_VERSION" != "$TAG_VERSION" ]; then
            echo "태그($TAG_VERSION)와 version.yml($FILE_VERSION)이 다릅니다 — 배포를 중단합니다"
            exit 1
          fi
          echo "버전 일치 확인: $TAG_VERSION"

      - name: 테스트 실행 (배포 게이트)
        run: npm test

      - name: package.json 버전 주입
        run: npm pkg set version=${{ steps.target.outputs.version }}

      - name: 이미 배포된 버전인지 확인 (멱등)
        id: check
        run: |
          PKG_NAME=$(npm pkg get name | tr -d '"')
          VERSION="${{ steps.target.outputs.version }}"
          if npm view "${PKG_NAME}@${VERSION}" version >/dev/null 2>&1; then
            echo "skip=true" >> $GITHUB_OUTPUT
            echo "${PKG_NAME}@${VERSION} 은 이미 배포되어 있습니다. 건너뜁니다."
          else
            echo "skip=false" >> $GITHUB_OUTPUT
          fi

      - name: 배포 내용 미리 확인
        if: steps.check.outputs.skip == 'false'
        run: npm publish --dry-run --access public

      - name: npm 배포
        if: steps.check.outputs.skip == 'false'
        run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      - name: 배포 결과 요약
        if: steps.check.outputs.skip == 'false'
        run: echo "project-auto-wizard@${{ steps.target.outputs.version }} npm 배포 완료 (provenance 첨부)"
```

- [ ] **Step 3: `push` 트리거가 완전히 제거됐는지 확인한다**

```bash
node -e "const s=require('fs').readFileSync('.github/workflows/NPM-PUBLISH.yaml','utf8');const on=s.slice(s.indexOf('\non:'), s.indexOf('\npermissions:'));if(/push:/.test(on))throw new Error('push 트리거가 남아 있습니다');if(!/release:/.test(on))throw new Error('release 트리거가 없습니다');console.log('트리거 전환 OK');"
```

Expected: `트리거 전환 OK`

- [ ] **Step 4: provenance 플래그가 들어갔는지 확인한다**

```bash
grep -n "npm publish" .github/workflows/NPM-PUBLISH.yaml
```

Expected: `--dry-run --access public` 한 줄과 `--provenance --access public` 한 줄.

- [ ] **Step 5: 커밋**

```bash
git add .github/workflows/NPM-PUBLISH.yaml
git commit -F - <<'EOF'
npm_배포_Release_트리거_전환 : feat : npm 배포를 Release 트리거로 옮기고 테스트 게이트·provenance 추가 https://github.com/Twin-Fang/project-auto-wizard/issues/35

main push 트리거는 VERSION-CONTROL의 버전 bump와 경쟁했고, 지면 [skip ci] 때문에
재트리거되지 않아 그 버전이 영영 배포되지 않았다(0.1.13·0.1.15·0.1.19 누락).

- 트리거를 release: published로 이동, main push 제거
- 체크아웃을 가변 ref:main에서 불변 릴리스 태그로 변경
- 태그와 version.yml 버전 대조 — 불일치 시 배포 중단
- 배포 전 npm test 게이트 추가
- npm publish --dry-run으로 내용 확인 후 --provenance로 배포
- 수동 재배포는 workflow_dispatch의 tag 입력으로
EOF
```

---

### Task 3: PR 생성·머지 및 실제 릴리스 검증

**Files:** 없음 (검증 태스크)

**Interfaces:**
- Consumes: Task 1·2의 커밋
- Produces: 검증된 배포 경로. Task 4의 Trusted Publishing 전환이 이 위에서 진행된다.

- [ ] **Step 1: push하고 PR을 생성한다**

```bash
git push -u origin HEAD
gh pr create --repo Twin-Fang/project-auto-wizard --base main \
  --title "⚙️[개선][배포] npm 배포를 Release 트리거 + provenance로 전환" \
  --body "closes #35 — 레이스 실측과 누락 증거는 이슈 #35, 설계는 docs/superpowers/specs/2026-08-06-release-pipeline-hardening-design.md §5.3 참조."
```

- [ ] **Step 2: CI 통과 후 머지한다**

```bash
until [ -z "$(gh pr checks <PR번호> --repo Twin-Fang/project-auto-wizard --json state -q '.[]|select(.state=="PENDING")|.state')" ]; do sleep 10; done
gh pr checks <PR번호> --repo Twin-Fang/project-auto-wizard
gh pr merge <PR번호> --repo Twin-Fang/project-auto-wizard --merge
```

- [ ] **Step 3: 릴리스 체인이 끝까지 도는지 확인한다**

머지 후 `VERSION-CONTROL`이 버전을 올리고 `RELEASE-PUBLISH`가 태그·Release를 발행한다. Release 발행이 `NPM-PUBLISH`를 깨우는지 확인한다.

```bash
gh run list --repo Twin-Fang/project-auto-wizard --workflow NPM-PUBLISH.yaml --limit 3
```

Expected: `release` 이벤트로 트리거된 실행이 나타난다. **`push` 이벤트가 아니어야 한다.**

**뜨지 않는 경우**: `WORKFLOW_PAT`이 등록되어 있는지, Task 1의 변경이 실제로 머지됐는지 확인한다. `gh release view <태그> --json author`로 Release 작성자가 `github-actions[bot]`이 아닌지도 확인한다 — bot이면 폴백이 걸린 것이다.

- [ ] **Step 4: npm에 실제로 배포됐는지 확인한다**

```bash
gh run view <run-id> --repo Twin-Fang/project-auto-wizard --log | grep -iE "배포 대상|버전 일치|npm 배포 완료|provenance"
```

Expected: `버전 일치 확인`, `npm 배포 완료 (provenance 첨부)`.

- [ ] **Step 5: provenance가 붙었는지 확인한다**

```bash
npm view project-auto-wizard --json 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('dist.attestations:', JSON.stringify(j.dist?.attestations ?? null));});"
```

Expected: `attestations` 객체가 존재한다. 사내 미러를 거치면 캐시 때문에 보이지 않을 수 있으므로, 그 경우 npmjs.com 패키지 페이지에서 "Provenance" 섹션을 직접 확인한다.

---

### Task 4: Trusted Publishing 전환 (NPM_TOKEN 제거)

**Files:**
- Modify: `.github/workflows/NPM-PUBLISH.yaml` (`npm 배포` 스텝의 `env` 제거)

**Interfaces:**
- Consumes: Task 3에서 검증된 배포 경로
- Produces: 시크릿 없는 배포. `NPM_TOKEN` 시크릿을 레포에서 삭제할 수 있게 된다.

**중요**: 이 태스크는 **npmjs.com에서 사람이 Trusted Publisher를 등록한 뒤에만** 진행한다. 등록 전에 `NODE_AUTH_TOKEN`을 지우면 배포가 즉시 깨진다.

- [ ] **Step 1: npmjs.com에서 Trusted Publisher를 등록한다 (수동)**

npmjs.com → `project-auto-wizard` 패키지 → Settings → Trusted Publisher → GitHub Actions를 선택하고 다음을 입력한다.

- Organization or user: `Twin-Fang`
- Repository: `project-auto-wizard`
- Workflow filename: `NPM-PUBLISH.yaml`
- Environment: (비워 둠)

- [ ] **Step 2: 등록이 반영됐는지 확인한다**

등록 직후 `workflow_dispatch`로 이미 배포된 태그를 지정해 실행한다. 멱등 가드가 있어 실제 배포는 건너뛰지만, 인증 경로가 바뀌었는지는 로그로 확인할 수 없으므로 **이 단계는 등록 화면에서 설정이 저장됐는지 눈으로 확인하는 것으로 갈음한다.**

- [ ] **Step 3: 워크플로우에서 `NODE_AUTH_TOKEN`을 제거한다**

```yaml
      - name: npm 배포
        if: steps.check.outputs.skip == 'false'
        run: npm publish --provenance --access public
```

`env:` 블록 전체를 삭제한다. 파일 상단 주석의 `필요 Secret: NPM_TOKEN` 줄도 다음으로 교체한다.

```
# 인증: npm Trusted Publishing (OIDC) — 시크릿 불필요
#   npmjs.com → 패키지 Settings → Trusted Publisher에 이 워크플로우가 등록되어 있어야 한다.
```

- [ ] **Step 4: 커밋하고 PR을 올린다**

```bash
git add .github/workflows/NPM-PUBLISH.yaml
git commit -F - <<'EOF'
npm_배포_Release_트리거_전환 : feat : Trusted Publishing(OIDC)으로 전환해 NPM_TOKEN 제거 https://github.com/Twin-Fang/project-auto-wizard/issues/35

npmjs.com에 Trusted Publisher를 등록해 OIDC로 인증한다.
토큰 유출·만료·회전 관리가 사라지고, 2025년 npm 공급망 공격 이후
npm이 공식 권장하는 방식이다.
EOF
git push
```

- [ ] **Step 5: 다음 릴리스에서 배포가 성공하는지 확인한다**

머지 후 다음 릴리스가 npm까지 도달하는지 확인한다. 실패하면 즉시 되돌린다.

```bash
git revert <커밋해시>
```

- [ ] **Step 6: 레포에서 `NPM_TOKEN` 시크릿을 삭제한다 (수동, 배포 2회 성공 후)**

한 번의 성공으로 판단하지 않는다. Trusted Publishing으로 두 번 연속 배포가 성공한 뒤에 삭제한다.

```bash
gh secret delete NPM_TOKEN --repo Twin-Fang/project-auto-wizard
```
