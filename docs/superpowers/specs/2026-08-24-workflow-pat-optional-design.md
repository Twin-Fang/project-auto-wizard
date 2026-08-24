# WORKFLOW_PAT을 선택 사항으로 격하 — 설계 문서

이슈: https://github.com/Twin-Fang/project-auto-wizard/issues/105

## 배경

`develop → main` 릴리스 PR의 automerge, GitHub Release 발행은 `secrets.WORKFLOW_PAT || github.token` 패턴을 쓴다. `WORKFLOW_PAT`을 등록하면 그 토큰의 정체성으로 커밋/머지/Release가 남는다. 이 레포는 지금 그 값이 특정 개인 계정(Cassiiopeia)의 Personal Access Token으로 등록되어 있어, 최근 develop→main 병합 PR(#104, #101, #98)의 `mergedBy`가 전부 그 개인 계정으로 기록된다.

`WORKFLOW_PAT`은 이 레포만의 설정이 아니다. project-auto-wizard가 설치하는 모든 사용자의 워크플로우가 같은 패턴을 쓰고, README는 이를 "설치 후 확인할 것 (권장)" 1순위 항목으로 안내한다. 즉 이 문제는 이 레포 하나의 설정 실수가 아니라 **도구가 개인 PAT 등록을 기본 권장 경로로 삼는 설계**에서 비롯된다.

## 조사로 확인한 사실

- `GITHUB_TOKEN`만으로 파이프라인 전체(automerge → Release 발행 → npm 배포 트리거)가 끝까지 이어지는 폴백이 이미 구현되어 있다:
  - `PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml`의 `wait-for-merge-and-trigger-release` job (`.github/workflows/`:311, `payload/workflows/common/`도 동일) — PR이 실제 병합될 때까지 20초 간격으로 폴링(`MAX_WAIT=1800`)한 뒤 `RELEASE-PUBLISH`를 `workflow_dispatch`로 깨운다.
  - `PROJECT-COMMON-RELEASE-PUBLISH.yaml`의 "Trigger NPM-PUBLISH" step(이 레포 전용 사본에만 존재, payload 사본은 NPM-PUBLISH가 레포 전용 워크플로우라 의도적으로 생략 — 주석에 명시됨) — Release 생성 직후 무조건 `workflow_dispatch`로 다음 단계를 깨운다.
- `.github/workflows/*.yaml`과 `payload/workflows/common/*.yaml`은 `{{MAIN_BRANCH}}`/`{{DEVELOP_BRANCH}}` 치환 차이를 빼면 완전히 동일하다(diff로 확인). 로직 변경은 필요 없다.
- `src/core/verify.js`의 `OPTIONAL_SECRETS`는 이미 `WORKFLOW_PAT`을 선택 항목으로 올바르게 분류하고 있다.
- `src/ui/summary.js`(설치 완료 화면)는 이미 "선택 — 없으면 GITHUB_TOKEN 사용"으로 정확하게 안내하고 있다.
- **`src/commands/doctor.js`에는 정확히 같은 논리의 선례가 있다.** `Workflow permissions` 항목은 "조치가 필요 없으므로 WARN이 아니라 INFO다. 경고로 띄우면 없는 장애를 알리고 불필요한 권한 상향을 유도해 최소 권한 원칙에 역행한다"(105-106번째 줄 주석)는 이유로 이미 WARN에서 INFO로 낮춰져 있다.
- 실측 지연: `GITHUB_TOKEN` 폴백 경로가 PAT 경로보다 추가로 걸리는 시간은 실제 병합 후 **최대 ~20초**(폴링 간격)뿐이다. `MAX_WAIT=1800`(30분)은 "CI가 비정상적으로 오래 걸릴 때 포기하는 상한선"이지, 통상적으로 걸리는 지연이 아니다.

## 결정

1. `WORKFLOW_PAT`을 "1순위 권장"에서 "속도 최적화용 선택 사항"으로 격하한다. `doctor.js`의 미등록 판정을 `WARN`에서 `INFO`로 낮추고(위 `Workflow permissions` 선례와 동일 패턴), 문구를 "폴백이 있어 자동 복구되며 최대 ~20초 더 걸릴 뿐"이라는 사실로 교체한다.
2. PAT을 **등록하고 싶은 사용자**에게는 "개인 계정이 아닌 조직 bot/machine 계정으로 발급하라"는 가이드를 `doctor.js`와 `README.md` 양쪽에 추가한다.
3. `README.md`의 doctor 예시 출력(`[!] WORKFLOW_PAT`)과 "설치 후 확인할 것" 표의 "(권장)" 문구를 결정 1·2에 맞게 갱신한다.
4. 워크플로우 YAML(`payload/workflows/common/*.yaml`, `.github/workflows/*.yaml`)과 `src/core/verify.js`는 **변경하지 않는다** — 이미 올바르다.
5. 이 레포 자신의 `WORKFLOW_PAT` 시크릿(Cassiiopeia 개인 PAT)을 교체/제거하는 것은 GitHub Settings 조작이라 **코드 변경 범위 밖**이다 — 이슈 #105에 운영 체크리스트로 이미 기록되어 있고, 이번 PR로는 처리하지 않는다.

## 상세 변경

### `src/commands/doctor.js` (114-129번째 줄, `hasPat` 분기)

**현재:**
```js
add(hasPat
  ? { name: "WORKFLOW_PAT secret", label: "WORKFLOW_PAT", purpose: "자동 태그·Release 발행", status: "OK", value: "등록됨" }
  : {
    name: "WORKFLOW_PAT secret", label: "WORKFLOW_PAT", purpose: "자동 태그·Release 발행", status: "WARN",
    value: "secret이 등록되어 있지 않습니다.",
    impact: [
      "PR 자동 머지 뒤 태그·Release 워크플로가 이어지지 않습니다.",
      "(GitHub 정책상 기본 토큰으로 만든 커밋은 다음 워크플로를 깨우지 못합니다)",
    ],
    actions: [
      "개인 액세스 토큰 발급 (scopes: repo, workflow)",
      "레포 Settings → Secrets and variables → Actions",
      "New repository secret · 이름은 WORKFLOW_PAT",
    ],
    doc: DOC.postInstall,
  });
```

**변경 후:**
```js
add(hasPat
  ? { name: "WORKFLOW_PAT secret", label: "WORKFLOW_PAT", purpose: "자동 태그·Release 발행", status: "OK", value: "등록됨" }
  : {
    // 조치가 필요 없으므로 WARN이 아니라 INFO다 — 이유는 위 Workflow permissions 항목과 동일:
    // 폴백(wait-for-merge-and-trigger-release / Trigger NPM-PUBLISH)이 GITHUB_TOKEN만으로
    // 파이프라인을 끝까지 이어가므로, 없는 장애를 경고로 띄우지 않는다(이슈 #105).
    name: "WORKFLOW_PAT secret", label: "WORKFLOW_PAT", purpose: "자동 태그·Release 발행", status: "INFO",
    note: [
      "secret이 없어도 폴백이 자동으로 이어받아 태그·Release까지 진행됩니다 — 실제 병합 후 최대 ~20초 정도 더 걸릴 뿐입니다.",
      "속도를 더 원한다면 PAT을 등록할 수 있습니다 — 반드시 개인 계정이 아닌 조직 bot/machine 계정으로 발급하세요 (scopes: repo, workflow).",
      "등록: 레포 Settings → Secrets and variables → Actions → New repository secret · 이름은 WORKFLOW_PAT",
    ],
  });
```

`status: "INFO"`인 항목은 `doc` 필드를 달지 않는 게 기존 관례(`Workflow permissions` INFO 항목 참고)이므로 `doc: DOC.postInstall`은 제거한다. `purpose` 값은 그대로 유지한다.

### `src/ui/summary.js` (158-162번째 줄)

기존 문구("선택 — 없으면 GITHUB_TOKEN 사용")는 이미 정확하다. bot/machine 계정 권장 한 줄만 추가한다:

**현재:**
```js
err(`  ${num()} 릴리스 automerge용 PAT (선택 — 없으면 GITHUB_TOKEN 사용)`);
err("     → Repository Settings > Secrets > Actions");
err("     → Secret Name: WORKFLOW_PAT (Scopes: repo, workflow)");
err("     → GITHUB_TOKEN 머지는 후속 워크플로우를 트리거하지 않습니다");
```

**변경 후:**
```js
err(`  ${num()} 릴리스 automerge용 PAT (선택 — 없으면 GITHUB_TOKEN 폴백으로 자동 진행)`);
err("     → Repository Settings > Secrets > Actions");
err("     → Secret Name: WORKFLOW_PAT (Scopes: repo, workflow)");
err("     → 등록 시 개인 계정이 아닌 조직 bot/machine 계정으로 발급하세요");
err("     → 없어도 자동 복구되며, 있으면 병합~Release 반영이 조금 더 빠릅니다");
```

### `README.md`

`printDoctorReport`(`src/commands/doctor.js:171-208`)의 실제 렌더링 규칙을 확인했다 — `INFO` 항목은 `[i] 라벨` 다음에 `note` 배열을 화살표(`→`) 없이 6칸 들여쓰기로 한 줄씩 출력하고, 항목들 사이에는 빈 줄이 없다(`→`/문서 링크는 `WARN`/`FAIL`에만 붙는다). 아래 블록은 그 규칙을 반영한 정확한 산출물이다.

1. **doctor 예시 출력** (170-193번째 줄)을 아래로 전체 교체한다:

```
◆  환경 진단 — project-auto-wizard doctor

  [✓] gh CLI — 레포 설정 조회용                    gh version 2.96.0
  [✓] GitHub 로그인 — 레포 설정 조회 권한          인증됨
  [✓] merge commit 허용 — 릴리스 PR 자동 머지 조건  허용됨

  [i] WORKFLOW_PAT — 자동 태그·Release 발행
      secret이 없어도 폴백이 자동으로 이어받아 태그·Release까지 진행됩니다 — 실제 병합 후 최대 ~20초 정도 더 걸릴 뿐입니다.
      속도를 더 원한다면 PAT을 등록할 수 있습니다 — 반드시 개인 계정이 아닌 조직 bot/machine 계정으로 발급하세요 (scopes: repo, workflow).
      등록: 레포 Settings → Secrets and variables → Actions → New repository secret · 이름은 WORKFLOW_PAT
  [i] Workflow permissions — 직접 추가한 워크플로우의 기본 권한
      현재 read 입니다 — 마법사가 설치한 워크플로우는 각자 권한을 선언하므로 그대로 동작합니다.
  [i] GitHub Models — AI 릴리스 노트 생성
      조직 정책으로 차단됐는지는 자동으로 확인할 수 없습니다 (Settings → Models).
      차단돼 있어도 규칙 기반 요약으로 자동 전환되므로 그대로 두셔도 됩니다.

  ✓ 문제를 찾지 못했습니다.
```

이 예시는 `WORKFLOW_PAT`이 유일한 문제 항목이었던 기존 예시를 대체한다 — INFO로 내려가면 이 시나리오엔 남는 `WARN`/`FAIL`이 없으므로, 마지막 요약 줄도 `summaryLine()`(`doctor.js:213-222`)의 실제 "문제 없음" 분기 문구(`✓ 문제를 찾지 못했습니다.`)로 바꾼다.

2. **"설치 후 확인할 것" 표** (226번째 줄) `WORKFLOW_PAT` 행을 아래로 교체한다:

```
| **`WORKFLOW_PAT` secret** (선택 — 속도 최적화용) | 없어도 `GITHUB_TOKEN` 폴백이 automerge부터 Release 발행까지 자동으로 이어갑니다(실제 병합 후 최대 ~20초 추가). 더 빠르게 하고 싶다면 Settings → Secrets → Actions에 `WORKFLOW_PAT` (scopes: `repo`, `workflow`) 등록 — 반드시 개인 계정이 아닌 조직 bot/machine 계정으로 발급하세요 |
```

3. `--mode doctor` 설명 행(167번째 줄)의 "`WORKFLOW_PAT` secret 등록 여부" 문구는 그대로 둔다 — doctor가 이 항목을 계속 점검한다는 사실 자체는 바뀌지 않는다(등록 안 됐을 때의 심각도만 바뀐다).

## 테스트 영향

`tests/node/doctor.test.js`에서 아래 두 테스트가 이번 변경으로 깨지므로 함께 갱신해야 한다:

1. **90번째 줄** `test("runDoctor: missing WORKFLOW_PAT and non-write permissions -> WARN", ...)` — 제목의 `WARN`을 `INFO`로, 104번째 줄 `assert.strictEqual(results.find((r) => r.name === "WORKFLOW_PAT secret").status, "WARN")`을 `"INFO"`로 변경.
2. **154번째 줄** `test("runDoctor: 문제 항목은 영향·조치·문서 링크를 함께 제공한다", ...)` — 이 테스트의 mock 설정(`secret list`에 WORKFLOW_PAT 없음)에서 현재 `WORKFLOW_PAT`(WARN) + `automerge 호환성`(WARN) = 2개를 기대하는데, WORKFLOW_PAT이 INFO로 빠지면 1개만 남아 `assert.ok(problems.length >= 2)`가 깨진다. 169-170번째 줄 `pat.doc === DOC.postInstall` 단언도 제거해야 한다(더 이상 problems 배열에 없음). 이 테스트가 "실제 조치가 필요한 항목이 최소 2개는 있다"를 검증하려는 의도라면, WORKFLOW_PAT을 표본에서 빼고 다른 실제 WARN 항목(예: `gh` 인증 실패, `automerge 호환성`)으로 표본을 재구성해야 한다 — 실제 fixture 조합은 구현 단계에서 확인.

새 테스트로 추가할 것: `WORKFLOW_PAT`이 없을 때 `status === "INFO"`이고 `note`에 "bot/machine 계정" 관련 문구가 포함되는지 확인하는 테스트(선택 — 기존 테스트를 리네임+수정하는 것으로 충분할 수도 있음, 구현 단계 판단).

## 범위 밖 (Out of scope)

- 이 레포 자신의 `WORKFLOW_PAT` 시크릿 값 교체/제거 — GitHub Settings 조작, 코드 변경 아님. 이슈 #105에 운영 체크리스트로 기록됨.
- `payload/workflows/common/*.yaml`, `.github/workflows/*.yaml`의 워크플로우 로직 변경 — 이미 올바름, 변경 불필요.
- `src/core/verify.js`의 `OPTIONAL_SECRETS` 분류 — 이미 올바름, 변경 불필요.
- GitHub App 기반 토큰 발급으로의 전환 — 브레인스토밍 중 검토했으나 설치 마찰을 우선하기로 사용자가 결정, 이번 범위에서 제외.
