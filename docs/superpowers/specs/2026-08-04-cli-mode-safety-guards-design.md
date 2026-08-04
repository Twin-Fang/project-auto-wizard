# CLI 안전장치 3종 결함 수정 — 브레인스토밍 결과

- 날짜: 2026-08-04
- 상태: 브레인스토밍 완료 (사용자 승인 대기 — 코드 구현 착수 전)
- 이슈: [Twin-Fang/project-auto-wizard#19](https://github.com/Twin-Fang/project-auto-wizard/issues/19)
- 브랜치: `20260804_#19_잘못된_mode_값이_검증_없이_통과되고_아무것도_설치_안_됐는데도_성공_화면이_뜸`
- 참고: 이 문서는 **설계 스펙**이다. 실제 구현 순서/작업 단위는 별도 `writing-plans` 세션에서 다룬다.

## 1. 배경 — 문제 정의

이슈 #11(전체 기능 실사용 QA)에서 발견된, `src/index.js`의 모드 디스패치 진입점과 `src/ui/summary.js`의 요약 출력에 몰려있는 3개의 결함을 묶은 이슈다. 전부 "CLI가 실제로 무엇을 했는지와 화면에 뜨는 메시지가 일치하지 않는다"는 같은 축의 문제다.

1. **`--mode` 값 화이트리스트 검증 누락 + 원격 부수효과**: `--mode ful`처럼 오타가 있어도 검증 없이 통과되고, 검증 실패 지점(`switch` default, `src/index.js:303`) 이전에 이미 `ensureDevelopBranch()`(`src/index.js:254~259`)가 실행돼 원격에 `develop` 브랜치를 실제로 생성·push해버린다.
2. **TTY 환경에서 `--force` 없이도 확인 없이 즉시 설치**: `src/index.js:225`의 게이트(`!opts.force && !opts.dryRun && !process.stdout.isTTY`)가 TTY일 때는 무조건 통과시킨다. `--mode full/version/workflows` 전용 대화형 확인 절차가 없다(대화형 3지선은 `--mode interactive` 전용 별도 경로에만 있음).
3. **`printSummary()`가 실제 결과를 검증하지 않고 항상 성공 화면을 출력**: ①의 오타 모드 재현 시 `result`가 `null`이어도 `printSummary()`가 무조건 호출된다. 별개로 "📦 새로 설치됨" 목록이 `.github/workflows/` 디렉터리를 **현재 시점 기준으로 재스캔**해서 만들어지기 때문에, `--force` 재실행으로 실제로는 `skip`된 파일까지 "새로 설치됨"으로 표시되고, 이 목록의 항목 수와 `counters.workflows`(카운터) 개수도 서로 다른 소스라 일치하지 않는다.

## 2. 조사 중 발견한 추가 사실

이슈 본문은 `src/index.js:268`의 `force: true` 하드코딩을 ②의 원인으로 지목하지만, 실제로 `context.force` 값은 `runFull`/`runVersion`/`copyWorkflows` 어디에서도 게이팅에 쓰이지 않는 **죽은 값**이다(구조분해만 되고 미사용 — grep으로 확인). ②의 진짜 원인은 순수하게 `src/index.js:225`의 `!process.stdout.isTTY` 조건 하나뿐이다. 하드코딩 정리는 동작에 영향 없는 정정으로만 포함한다.

## 3. 목표 / 비목표

**목표**:
- 잘못된 `--mode` 값은 어떤 부수효과도 없이 즉시 거부한다.
- `--force` 없이 `full`/`version`/`workflows`/`revert`를 실행하면 TTY 여부와 무관하게 항상 거부한다(질문 프롬프트 대신 거부 — 아래 결정 사항 참고).
- `printSummary()`가 보여주는 정보(성공 여부, "새로 설치됨" 목록·개수)가 실제로 이번 실행에서 벌어진 일과 항상 일치한다.

**비목표**:
- `uninstall`/`purge`/`status`/`doctor` 모드는 이미 올바르게 동작한다(각각 대화형 확인 절차 보유 또는 읽기 전용) — 변경하지 않는다.
- TTY에서 실제 y/n 확인 질문을 새로 만드는 방향은 채택하지 않는다(아래 결정 사항 참고) — 이번 이슈 범위에서는 신규 프롬프트 UI를 추가하지 않는다.
- `--mode interactive` 경로(대화형 3지선, 브랜치 질문 등)의 UX는 변경하지 않는다.

## 4. 결정 사항 (사용자 승인)

| 결정 | 선택 | 근거 |
|---|---|---|
| TTY 게이트 방식 | **`--force` 필수화(거부만)**, y/n 프롬프트 추가는 채택 안 함 | 이슈의 예상 동작("질문 또는 거부") 중 더 단순한 쪽. 기존 `revert`/비TTY 게이트와 동일 패턴이라 회귀 위험이 적음 |
| `revert` 모드의 동일 버그(`src/index.js:97`) | **이번 이슈에서 함께 수정** | 완전히 동일한 코드 패턴(동일 원인) — 별도 이슈로 쪼개면 같은 조사를 반복해야 하고 리뷰 맥락도 분산됨 |
| "새로 설치됨" 목록 재스캔 문제 | **이번에 함께 고침** | `counters.workflows` 카운트를 정확한 소스로 만드는 작업(§6)의 자연스러운 연장 — 반쪽짜리 수정을 남기지 않기 위함 |

## 5. 컴포넌트별 변경

### `src/context.js`
- `VALID_MODES` 상수 신설(export) — `VALID_TYPES`와 같은 위치. 값: `interactive`, `full`, `version`, `workflows`, `revert`, `uninstall`, `status`, `doctor`, `purge`.

### `src/cli/args.js`
- `parseArgs()` 리턴 직전에 `result.mode`가 `VALID_MODES`에 속하는지 검증, 아니면 `CliError` throw.
- 에러 메시지에는 **공개 모드만** 안내한다(`purge`는 `--help`에도 노출하지 않는 숨김 모드라는 기존 설계 의도를 에러 메시지에서도 유지 — `interactive`/`full`/`version`/`workflows`/`revert`/`uninstall`/`status`/`doctor`).
- 이 검증은 `run()` 최상단(`parseArgs` 호출 직후)에서 발생하므로, 이후의 모든 로직(브랜치 조회·`ensureDevelopBranch` 포함)은 유효하지 않은 모드일 때 전혀 실행되지 않는다.

### `src/index.js`
- `src/index.js:97`(revert 게이트), `src/index.js:225`(메인 게이트): `&& !process.stdout.isTTY` 조건 제거 → `--force`(또는 `--dry-run`) 없이는 TTY 여부와 무관하게 항상 거부. 에러 메시지도 "비대화형 환경에서는"이라는 TTY 전제 문구를 TTY에도 맞게 조정한다.
- `src/index.js:268`: `force: true` → `force: opts.force` (동작 무변화 — §2 참고).
- `switch (opts.mode)`의 `default` 분기(`src/index.js:303~305`) 제거 — 모드 검증이 선행되므로 도달 불가능해짐.
- `printSummary()` 호출부를 §6의 새 시그니처(`copiedFiles` 기반, `targetRoot` 인자 없음)에 맞춰 조정.

### `src/core/copy/workflows.js`
- `copyWorkflows()`의 반환 카운터 객체에 `copiedFiles: string[]`을 추가한다. 실제로 이번 실행에서 새로 쓰여진 워크플로우 파일명을 아래 지점에서 전부 수집한다:
  - common 디렉터리 신규/갱신 파일
  - 타입별 디렉터리(`copyWorkflowsForType`)의 신규 파일, `server-deploy` 신규 파일
  - `applyDecision()`의 `backup`(원본 파일명 그대로) / `template`(`*.template.yaml`로 쓰여지는 새 파일명) 결정
  - `nexus` opt-in 복사
  - `secret-backup` opt-in 복사
- `skip`된 파일(unchanged 또는 3지선 `skip` 결정)은 포함하지 않는다 — 이번 실행에서 실제로 쓰기 작업이 일어난 파일만.

### `src/ui/summary.js`
- "📦 새로 설치됨" 목록을 만들 때 `.github/workflows/` 디렉터리 재스캔(`existsSync`/`listYamlFiles` 기반) 로직을 제거하고, 전달받은 `copiedFiles` 배열을 그대로 분류(common/타입별 prefix)해서 렌더링한다.
- 표시 개수(`(N개)`)는 별도 카운터가 아니라 `copiedFiles.length`에서 직접 파생시켜, "카운터와 목록 항목 수가 서로 다른 소스라 개수가 안 맞는" 문제를 구조적으로 없앤다.
- `targetRoot` 파라미터는 재스캔 로직 제거로 더는 쓰이지 않으므로 함수 시그니처에서 제거한다.
- 더는 쓰이지 않는 import(`existsSync`, `join`, `PATHS`, `listYamlFiles`)를 정리한다.

### `src/commands/interactive.js`
- `io.summary?.(...)` 호출부(대화형 모드의 완료 요약)도 `printSummary`와 동일한 시그니처 변경(`counters` → `copiedFiles`, `targetRoot` 인자 제거)에 맞춰 함께 수정한다. `printSummary`의 두 번째 호출부이므로 여기를 놓치면 대화형 모드의 완료 요약만 깨진 채 남는다.

## 6. 데이터 흐름

```
copyWorkflows()
  └─ { copied, skipped, templateAdded, optionalCopied, backupAdded, copiedFiles[], deployValues }
       │
       ▼
runFull()/runWorkflows()  →  { workflows: <위 객체>, gitignoreUpdated }
       │
       ▼
index.js run() / interactive.js runInteractiveFlow()
       │  ctx.copiedFiles = result?.workflows?.copiedFiles ?? []
       ▼
printSummary(ctx)
       │  copiedFiles를 common/타입별로 분류 → "새로 설치됨 (copiedFiles.length개)" 렌더링
       ▼
사용자에게 보이는 완료 화면
```

## 7. 에러 처리

- **잘못된 `--mode`**: `parseArgs()`가 `run()` 최상단에서 즉시 `CliError`를 던지고, 기존 `catch` 블록이 `console.error(e.message)` 후 `return 1`. 브랜치 조회/생성 등 부수효과는 이 시점 이후에 위치하므로 전혀 실행되지 않는다.
- **`--force` 없는 명시 모드(TTY 여부 무관)**: 즉시 `console.error(...)` 후 `return 1`. `--dry-run`은 파일을 쓰지 않으므로 기존과 동일하게 이 게이트를 우회한다(변경 없음).
- **`printSummary`**: `result`가 없거나 `copiedFiles`가 없는 경우를 대비해 `?? []`로 안전하게 처리한다. 다만 §5의 `default` 분기 제거로 `full`/`version`/`workflows` 모드에서는 이제 `result`가 항상 실제 실행 결과를 담은 객체다.

## 8. 테스트 계획

- **`args.js`**: 잘못된 `--mode` 값(오타, 빈 문자열, 미지정) → `CliError`. 유효한 모드 전부(`purge` 포함) 통과.
- **`run()`(`src/index.js`)**:
  - 원격 브랜치가 있는 fixture에서 `--mode ful --force --type node` 실행 → `exit 1` + `ensureDevelopBranch`가 시도한 `git push`가 발생하지 않았는지 exec mock으로 검증.
  - `process.stdout.isTTY = true`로 스텁(기존 `purge-cli.test.js`의 패턴 재사용) + `--force` 없이 `full`/`version`/`workflows`/`revert` 실행 → `exit 1`.
  - 위 각 시나리오에 `--force`를 부여하면 정상 진행(회귀 방지).
- **`copyWorkflows`**: 신규/`backup`/`template`/`nexus`/`secret-backup` 각 케이스에서 `copiedFiles`에 올바른 파일명이 담기는지. 재실행 시 `unchanged`/`skip` 파일이 `copiedFiles`에 없는지.
- **`printSummary`**: `copiedFiles` 배열을 직접 주입해 목록·개수 렌더링을 검증. 기존 `tests/node/summary-output.test.js`는 시그니처 변경(2번째 인자 제거)에 맞춰 최소 조정.

## 9. 회귀 위험

- `printSummary`의 두 호출부(`src/index.js`, `src/commands/interactive.js`)를 동시에 수정하지 않으면 대화형 모드의 완료 요약이 깨진다 — §5에 명시.
- 기존 테스트 중 TTY 우회(비-force + TTY 성공 경로)에 의존하는 케이스는 grep으로 확인한 결과 없다 → 회귀 리스크 낮음.
- `uninstall`(`src/index.js:186~211`)은 이미 `force`가 없을 때 실제 대화형 흐름(`runUninstallFlow`)으로 분기하는 올바른 패턴이라 이번 변경 대상이 아니다.
