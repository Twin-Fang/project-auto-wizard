# 브랜치 선택 프롬프트 커서 고정 + main/develop 상단 정렬 — 설계 스펙

- 날짜: 2026-08-14
- 상태: 사용자 승인된 설계 (브레인스토밍 완료, `/goal` 자동 진행)
- 관련 이슈: [Twin-Fang/project-auto-wizard#85](https://github.com/Twin-Fang/project-auto-wizard/issues/85)

## 1. 배경 / 문제

인터랙티브 마법사에서 릴리스/개발 브랜치를 고르는 두 프롬프트("릴리스 브랜치를 선택하세요", "개발 브랜치를 선택하세요")는 `src/commands/interactive.js`의 `pickBranch()`(307~323행 — 파일 편집 이력에 따라 줄 번호는 달라질 수 있음)가 만든다.

두 가지 문제가 있다.

1. **커서가 기본값에 위치하지 않음** — `pickBranch()`는 `io.engineIo.select({ message, options })`를 호출할 때 `initialIndex`를 넘기지 않는다. `src/ui/readline-engine.js`의 `select({ message, options, initialIndex = 0 })`(97행)는 이 값이 없으면 항상 옵션 배열의 0번째에 커서를 둔다. 즉 프롬프트에 "(기본: main)"이라고 안내가 떠도 커서는 목록에서 가장 먼저 나열된 임의의 브랜치에 위치한다.
2. **목록 순서가 알파벳순** — 옵션 목록은 `src/core/branches.js`의 `detectRemoteBranches()`(18~27행)가 `git branch -r --format=%(refname:short)` 결과를 그대로 반환한 순서를 따른다. git은 refname 알파벳순으로 정렬하므로, 날짜 접두사 브랜치명(`20260810_...`)처럼 숫자로 시작하는 브랜치가 `main`/`develop`보다 앞에 오는 경우가 흔하다. 브랜치가 많은 프로젝트에서는 원하는 기본 브랜치를 찾아 여러 번 방향키를 눌러야 한다.

## 2. 설계 결정: 정렬은 순수 함수로 분리, 커서 위치는 계산해서 명시적으로 전달

`src/core/branches.js`는 이미 브랜치 목록/구성에 관한 순수 함수(`resolveBranchConfig`, `detectRemoteBranches`)를 모아두는 자리다. 여기에 정렬 전담 순수 함수를 추가하고, `pickBranch()`는 그 결과로 `options`를 구성한 뒤 `def`의 최종 인덱스를 계산해 `select()`에 넘긴다.

`detectRemoteBranches()` 자체를 정렬하지 않는 이유: 이 함수는 `src/index.js:248`에서도 호출되며, 그 호출부의 브랜치 목록 순서까지 암묵적으로 바뀌는 부수효과를 피하기 위해 정렬 책임을 프롬프트 구성 쪽(호출부)에 국한한다.

### 신규/변경 파일

| 파일 | 역할 |
|---|---|
| `src/core/branches.js` (수정) | 순수 함수 `sortBranchesForSelection(remoteBranches, def, priority)` 추가 |
| `src/commands/interactive.js` (수정) | `pickBranch()`가 정렬된 목록으로 `options`를 구성하고, `def`의 인덱스를 `initialIndex`로 `select()`에 전달 |
| `tests/node/branches.test.js` (수정) | `sortBranchesForSelection()` 유닛테스트 추가 |
| `tests/node/interactive-branch-picker.test.js` (신규) | `pickBranch()`가 `select()`에 전달하는 `options` 순서와 `initialIndex`를 검증하는 통합 테스트 |

`src/ui/readline-engine.js`는 이미 `initialIndex` 파라미터를 지원하므로(97행) 수정하지 않는다.

부수효과(의도된 개선): `select()`는 비-TTY(파이프) 환경에서 `options[initialIndex]?.value`를 즉시 반환한다(98~101행). 지금은 `initialIndex`가 전달되지 않아 알파벳순 첫 브랜치가 반환됐지만, 이번 변경 후에는 `def`가 반환된다.

## 3. 상세 설계

### 3.1 `sortBranchesForSelection` (신규, `src/core/branches.js`)

```
sortBranchesForSelection(remoteBranches, def, priority = ["main", "develop"])
```

- 입력: `remoteBranches`(문자열 배열, git이 준 원본 순서), `def`(현재 프롬프트의 기본값), `priority`(선택, 기본 `["main", "develop"]`)
- 우선순위 후보 = `[def, ...priority]`에서 중복 제거(첫 등장 유지 — `def`가 항상 최우선)
- 우선순위 후보 중 `remoteBranches`에 실제로 존재하는 것만, 그 순서 그대로 결과 배열 맨 앞에 배치
- 나머지 브랜치는 `remoteBranches`에서의 상대 순서(=git이 준 알파벳순)를 그대로 유지하며 뒤에 이어붙임
- 새 배열을 반환하고 `remoteBranches` 원본은 변경하지 않는다 (불변성 원칙)
- `remoteBranches`에 `def`가 없는 경우(신규 브랜치, 아직 원격에 없음) 이 함수는 아무 것도 추가하지 않는다 — 그 처리는 기존과 동일하게 `pickBranch()`가 담당(플레이스홀더 옵션을 맨 앞에 push)

### 3.2 `pickBranch()` 수정 (`src/commands/interactive.js`, `pickBranch()` 함수 전체)

현재:
```js
async function pickBranch(io, message, def, remoteBranches, isCancel) {
  if (io.engineIo?.select && remoteBranches.length) {
    const options = [];
    if (!remoteBranches.includes(def)) options.push({ value: def, label: `${def} (기본값 — 없으면 새로 생성)` });
    for (const b of remoteBranches) options.push({ value: b, label: b === def ? `${b} (기본값)` : b });
    options.push({ value: "__custom__", label: "직접 입력..." });
    const sel = await io.engineIo.select({ message, options });
    ...
  }
  ...
}
```

변경 후 동작:
- `remoteBranches`를 그대로 순회하는 대신 `sortBranchesForSelection(remoteBranches, def)` 결과를 순회
- "직접 입력..." 옵션은 기존과 동일하게 항상 맨 끝
- `def`가 옵션 배열에 없으면(신규 브랜치) 기존처럼 맨 앞에 플레이스홀더를 추가 — 이 경우도 자연히 index 0
- `options` 구성이 끝난 뒤 `options.findIndex((o) => o.value === def)`로 `initialIndex`를 계산(찾지 못하면 0으로 폴백)해 `io.engineIo.select({ message, options, initialIndex })`로 전달
- 라벨 텍스트(`(기본값)`, `(기본값 — 없으면 새로 생성)`)는 변경하지 않음 — 정렬/커서 위치만 바뀐다

### 3.3 적용 범위

`mainB`(릴리스 브랜치, 195행)와 `devB`(개발 브랜치, 196행) 두 호출 모두 `pickBranch()`를 그대로 재사용하므로 자동으로 동일하게 적용된다. 별도 분기 불필요.

## 4. 테스트 계획

1. **`sortBranchesForSelection` 유닛테스트** (`tests/node/branches.test.js`, 순수 함수라 io 스텁 불필요)
   - `def`가 목록 중간에 있을 때 맨 앞으로 오는지
   - `main`/`develop`이 `def`와 다를 때 `def` 다음 순서로 오는지
   - 우선순위 후보가 목록에 없으면(예: 원격에 `develop` 없음) 건너뛰고 나머지만 배치되는지
   - 나머지 브랜치의 상대 순서가 원본 그대로 보존되는지
   - `def`가 이미 `priority`에 포함된 경우(예: devB 호출에서 `def === "develop"`) 중복 없이 한 번만 앞에 오는지
2. **`pickBranch()` 통합 테스트** (신규 `tests/node/interactive-branch-picker.test.js`)
   - `io.engineIo.select` 스텁이 호출 인자로 받은 `options`의 순서와 `initialIndex`를 캡처해 검증
   - `def`가 원격에 없는 신규 브랜치인 케이스도 회귀 확인 (index 0 유지)

## 5. 범위 밖

- `select()`/`multiselect()` 등 `readline-engine.js`의 다른 프롬프트 종류는 이번 변경과 무관 — 건드리지 않는다.
- 우선순위 브랜치 목록(`["main", "develop"]`)을 사용자가 설정 가능하게 만드는 것은 이슈 범위 밖 — 하드코딩된 상수로 충분하다.
- README/CHANGELOG 등 문서 갱신은 사용자 체감 UX 변경이 크지 않아(내부 프롬프트 동작) 스펙 범위에서 제외한다.
