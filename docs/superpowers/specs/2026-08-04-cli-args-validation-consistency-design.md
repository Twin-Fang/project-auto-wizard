# CLI 옵션 파싱/검증 비일관 5건 수정 — 브레인스토밍 결과

- 날짜: 2026-08-04
- 상태: 브레인스토밍 완료 (사용자 승인 대기 — 코드 구현 착수 전)
- 이슈: [Twin-Fang/project-auto-wizard#21](https://github.com/Twin-Fang/project-auto-wizard/issues/21)
- 브랜치: `20260804_#21_paths_type_main_branch_nexus_옵션_파싱_검증이_서로_비일관하거나_아예_없음_5건`
- 참고: 이 문서는 **설계 스펙**이다. 실제 구현 순서/작업 단위는 별도 `writing-plans` 세션에서 다룬다.

## 1. 배경 — 문제 정의

이슈 #11(전체 기능 실사용 QA)에서 발견된, CLI 옵션 파싱 계층(`src/cli/args.js`, `src/core/paths-resolve.js`)의 5가지 결함을 묶은 이슈다. 전부 "옵션 값에 대한 검증이 없거나, 유사한 두 옵션이 서로 다른 규칙으로 처리된다"는 같은 축의 문제이며, 모두 `--force`(비대화형) 경로에서만 조용히 잘못된 값이 통과된다.

1. **M3**: `--paths`로 지정한 경로의 존재 여부를 전혀 검증하지 않는다. 존재하지 않는 디렉터리가 `version.yml`에 그대로 기록되고, 이후 CI가 그 경로를 참조하다 실패한다.
2. **M4**: 모노레포 경로 후보가 0개(감지 실패)든 2개 이상(모호함)이든 동일하게 경고만 찍고 조용히 루트(`.`)로 확정한다. 원인이 다른 두 상황이 구분 없이 처리된다.
3. **L5**: `--type`(공백 전부 제거)과 `--paths`의 타입명(양끝만 trim)이 서로 다른 정규화 규칙을 쓴다. 같은 성격의 입력에 대해 한쪽은 통과, 한쪽은 거부된다.
4. **L6**: `--main-branch ""`처럼 빈 문자열을 명시적으로 지정해도 JS의 falsy 평가(`||`)로 미지정과 동일하게 자동 감지값으로 조용히 폴백된다.
5. **L7**: `--nexus --no-nexus`처럼 상호 모순되는 플래그를 동시에 지정해도 검증 없이 마지막 값이 적용된다.

## 2. 조사 중 발견한 추가 사실

- `--develop-branch`도 `src/index.js:252`/`src/core/branches.js:33`에서 `--main-branch`(L6)와 완전히 동일한 `||` 폴백 패턴을 쓴다 — 이슈 본문엔 없지만 동일 버그다.
- `--secret-backup`/`--no-secret-backup`, `--semver-auto`/`--no-semver-auto`도 `--nexus`/`--no-nexus`(L7)와 완전히 동일한 "단순 재할당, 모순 검증 없음" 파싱 패턴이다.
- L6(main/develop 빈 문자열)의 근본 원인은 `src/index.js`/`src/core/branches.js`의 `||` 폴백 체인이 아니라, **그 이전 단계인 `src/cli/args.js`가 "플래그 미지정"과 "플래그에 빈 값 지정"을 애초에 구분하지 못하는 것**이다. 따라서 파싱 시점(`args.js`)에서 빈 값을 즉시 거부하면 `index.js`/`branches.js`는 전혀 손댈 필요가 없다 — 원인 분석에서 지목한 두 파일보다 더 상류에서 막는 더 단순한 수정이다.

## 3. 목표 / 비목표

**목표**:
- `--paths`로 지정한 경로가 실제로 존재하지 않으면 즉시 거부한다.
- 모노레포 경로 후보 0개(감지 실패)와 2개 이상(모호함)을 서로 다른 메시지로, 둘 다 거부한다(비대화형 한정 — 대화형 UX는 이미 각각 다르게 처리 중이라 변경하지 않음).
- `--type`과 `--paths`의 타입명 공백 처리를 통일한다(둘 다 `--type` 방식으로 완화).
- `--main-branch`/`--develop-branch`에 빈 문자열을 명시적으로 지정하면 즉시 거부한다.
- `--nexus`/`--secret-backup`/`--semver-auto` 각각의 on/off 쌍을 동시에 지정하면 즉시 거부한다.

**비목표**:
- 대화형 모드(`resolveProjectPaths`의 ⑤-b 분기: 후보 select, 직접 입력 루프)의 기존 UX는 변경하지 않는다 — 이미 후보 0개/1개/2개 이상을 사용자에게 다르게 안내하고 있다.
- `version.yml`에 이미 저장된(과거 실행분) `project_paths`/`branches` 값의 재검증은 하지 않는다 — 이번 이슈는 이번 실행의 CLI 입력값 검증에 한정된다.
- 새로운 프롬프트 UI(y/n 확인 등)는 추가하지 않는다 — 전부 `CliError` 즉시 거부로 처리한다(§4 결정 사항).

## 4. 결정 사항 (사용자 승인)

| 결정 | 선택 | 근거 |
|---|---|---|
| M3(`--paths` 미존재 경로) | 에러로 거부 | CI 자동화 스크립트가 잘못된 경로에 의존하고 있었다면 즉시 드러나는 게 나중에 빌드 시점에 실패하는 것보다 안전 |
| M4(후보 0개) | 에러로 거부 | 마커 파일을 아예 못 찾은 상태에서 루트로 자동 확정하는 건 잘못된 경로를 기록할 위험이 큼 |
| M4(후보 2개 이상) | 에러로 거부 | 모호한 상태에서 임의로 루트를 선택하는 것은 위험 — `--paths`로 명시하도록 요구 |
| L5(공백 정규화 방향) | 둘 다 공백 제거(완화) — `--paths`도 `--type`처럼 | 기존 `--type` 동작(관대함)을 기준으로 맞춤 |
| L6(main-branch 빈 문자열) | 에러로 거부 | 빈 브랜치명은 유효하지 않은 입력으로 간주 — M3/M4와 일관된 fail-fast 원칙 |
| L6 범위 확장 | `--develop-branch`도 동일하게 검증 | 완전히 동일한 코드 패턴의 버그 — 하나만 고치면 불일관이 남음 |
| L7(모순 플래그) | 에러로 거부 | 모순 자체가 사용자 실수일 가능성이 높음 |
| L7 범위 확장 | `--secret-backup`/`--semver-auto` 쌍도 동일하게 검증 | 완전히 동일한 파싱 패턴의 버그 — 하나만 고치면 불일관이 남음 |

## 5. 컴포넌트별 변경

### `src/cli/args.js`

- **L5**: `parsePathsCsv()`의 타입명 파싱(현재 117행, `.trim()`)을 `--type` 파서(50행)와 동일한 `t.replace(/\s/g, "")`로 교체한다.
- **L6**: `--main-branch`/`--develop-branch` case를 각각 값 검증 블록으로 확장한다. `args.shift()`로 꺼낸 값이 falsy(빈 문자열 또는 undefined — 플래그가 인자 없이 끝에 오는 경우 포함)면 `CliError`를 던진다. 플래그 자체가 argv에 없으면 이 case에 진입하지 않으므로, 기존 "미지정 → 기본값 `""`" 동작은 그대로 유지된다.
- **L7**: 파싱 루프 시작 전에 `const seenFlags = new Set();`를 선언한다. `--nexus`/`--no-nexus`, `--secret-backup`/`--no-secret-backup`, `--semver-auto`/`--no-semver-auto` 6개 case 각각에 "반대 플래그가 이미 seenFlags에 있으면 즉시 CliError, 아니면 자기 자신을 seenFlags에 추가" 로직을 추가한다(총 3쌍, 대칭 패턴).

### `src/core/paths-resolve.js`

- **M3**: 최상단 import에 `CliError`를 추가(`import { normalizePath, CliError } from "../cli/args.js";`). 우선순위 ①(`--paths`로 이미 지정된 값, 현재 148~151행) 분기에서, `say()` 출력 전에 `existsSync(join(root, result.get(t)))`를 확인하고 실패 시 `CliError`를 던진다.
- **M4**: 비대화형 분기(⑤-a, 현재 169~182행)의 `candidates.length === 1`이 아닌 나머지 `else` 한 갈래를 `candidates.length === 0`과 `> 1` 두 개의 `else if`로 나누고, 각각 다른 메시지의 `CliError`를 던진다. 기존 경고(`say`) 후 루트 확정 로직은 제거된다.

### `src/index.js`, `src/core/branches.js`

- **변경 없음**. L6의 근본 수정이 `args.js` 파싱 시점으로 이동했으므로, 여기의 `||` 폴백 체인은 이제 "명시적 빈 문자열"을 받을 일이 없어져 안전하다(§2 참고).

## 6. 에러 처리

- 5건 모두 기존 `CliError` 클래스를 그대로 재사용한다(`src/cli/args.js`에 이미 정의됨). 신규 에러 타입은 만들지 않는다.
- 발생 위치는 파싱 가능한 가장 이른 시점을 우선한다: L5/L6/L7은 `parseArgs()` 실행 중(즉 `run()` 최상단), M3/M4는 `resolveProjectPaths()` 호출 시점(`run()` 중반, 경로 확정 단계) — 두 지점 모두 `src/index.js`의 기존 `catch (e) { if (e instanceof CliError) { console.error(e.message); return 1; } }`(72행)로 자연스럽게 흡수된다. 별도 에러 핸들링 추가가 필요 없다.
- 에러 메시지는 기존 컨벤션(`--paths에 지원하지 않는 타입: '...'` 등)을 따라 한국어로, 어떤 옵션의 어떤 값이 문제인지와 가능하면 해결 방법(`--paths "타입=경로"로 직접 지정하세요` 등)을 함께 담는다.

## 7. 테스트 계획

- **신규 `tests/node/args-validation.test.js`**: L5(`parsePathsCsv`로 공백 포함 타입명이 `--type`과 동일하게 정규화되는지), L6(main/develop 각각 빈 문자열 명시 시 `CliError`, 미지정 시 기존처럼 통과), L7(3쌍 각각 순서 무관하게 동시 지정 시 `CliError`, 단독 지정 시 정상 통과) 단위 테스트. 기존 `tests/node/mode-validation.test.js`의 `assert.throws(() => parseArgs([...]), CliError)` 패턴을 재사용한다.
- **신규 `tests/node/paths-resolve.test.js`**: M3(임시 디렉터리에 실제 존재/미존재 경로를 `--paths`로 지정해 `resolveProjectPaths` 직접 호출 → 존재 시 통과, 미존재 시 `CliError`), M4(0개 후보 fixture, 2개 이상 후보 fixture를 임시 디렉터리로 구성해 `force:true, tty:false`로 호출 → 각각 다른 메시지의 `CliError`) 단위 테스트. 기존 fixture(`tests/fixtures/monorepo`, `missing-target`)는 다른 테스트 목적으로 만들어져 있어 그대로 재사용하기 어려우므로, `mkdtempSync` 기반 임시 디렉터리로 최소 구성한다(`mode-validation.test.js`의 임시 디렉터리 패턴 참고).
- **회귀 확인**: 이슈에 적힌 5개 재현 커맨드가 모두 이제 `exit 1` + `CliError` 메시지로 거부되는지 명시적으로 검증한다.

## 8. 회귀 위험

브레인스토밍 단계에서 기존 테스트 스위트를 grep으로 선확인했다:

- **M3(`--paths` 미존재 경로 거부)**: `--paths`를 실제로 쓰는 테스트는 `tests/node/e2e-matrix.test.js`(61·85행, `--paths "flutter=app,react=client"`) 하나뿐이며, `tests/fixtures/monorepo/`에 `app/pubspec.yaml`·`client/package.json`이 실존한다 — 회귀 없음.
- **M4(후보 0개/2개 이상 거부)**: `candidates`/"자동 확정" 키워드로 걸리는 테스트는 `tests/node/uninstall-dry-run.test.js`뿐이나 이는 uninstall 계획의 삭제 후보 목록으로 이번 변경(`resolveProjectPaths`의 모노레포 경로 후보)과 무관하다 — 회귀 없음.
- **L6(`--develop-branch` 빈 문자열 거부)**: `--develop-branch`를 쓰는 유일한 테스트(`tests/node/purge-cli.test.js:284`)는 `"main"`(non-empty)을 넘긴다 — 회귀 없음.
- **L7 확장(`--secret-backup`/`--semver-auto` 쌍)**: `tests/node/semver-auto-cli.test.js`/`semver-auto-option.test.js`는 CLI 플래그 문자열이 아닌 옵션 객체를 직접 주입해 테스트하며, `--secret-backup`/`--semver-auto` 계열 CLI 플래그 자체를 쓰는 기존 테스트가 없다 — 회귀 없음.

구현 단계에서 관련 스위트(`test:node`) 전체를 실행해 최종 확인한다.
