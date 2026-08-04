# 구현된 전체 기능 실사용 버그 검증 — 테스트 계획 설계

- **관련 이슈**: #11 (🔍[시험요청][QA] 구현된 전체 기능 실사용 버그 검증)
- **분리된 후속 이슈**: #17 (🔍[시험요청][CICD] GitHub Actions 릴리스 e2e 동작 검증 — pr-flow/trunk-based)
- **작성일**: 2026-08-04
- **성격**: 코드 수정 없음. 테스트 범위/전략을 정리하고, 코드 정적 분석으로 발견한 버그 후보를 목록화하는 설계 문서.

## 1. 배경 및 목적

이슈 #11은 지금까지 구현된 `project-auto-wizard`의 전체 기능(대화형 마법사, 8개 CLI 모드, 9개 프로젝트 타입 자동 감지, 옵션 조합, 재실행 멱등성, GitHub Actions 워크플로우)에 대한 통합 실사용 버그 검증을 요청한다. 이 문서는 그 검증을 위한 테스트 범위와 계획을 정리한다.

GitHub 저장소에 실제로 push/PR을 열어 릴리스 자동화(automerge, tag+Release)까지 끝까지 확인하는 부분(이슈 #11 시나리오 13번)은 별도 세션에서 진행하기로 하고 이슈 #17로 분리했다. 이 문서가 다루는 범위는 **로컬 CLI 산출물 검증**까지다.

## 2. 범위

**포함**
- `npx project-auto-wizard` 대화형 마법사, `--mode full/version/workflows/revert/uninstall/status/doctor`, 숨김 `purge` 모드
- 9개 프로젝트 타입 자동 감지 + 멀티타입 + 모노레포 `--paths`
- 옵션 조합: `--nexus`, `--secret-backup`, `--coderabbit`, `--semver-auto`/`--no-semver-auto`, `--force`, `--dry-run`
- 브랜치 모드(pr-flow/trunk-based) 로컬 판정 로직
- 재실행 멱등성 및 충돌 3지선(유지/백업 후 교체/참고본 추가)
- 코드 정적 분석을 통한 버그 후보 발굴

**제외 (이슈 #17로 분리)**
- 실제 GitHub 저장소에서 릴리스 PR 오픈 → AI 릴리스 노트 → CHANGELOG 갱신 → automerge → tag+Release까지의 e2e 동작

## 3. 테스트 방식

1. **실제 CLI 실행(다우깅)**: 스크래치패드 하위에 시나리오별 격리된 임시 git 저장소를 만들어 `npx project-auto-wizard`를 직접 실행하고 산출물을 검증한다. 스크래치패드는 세션 전용이며 `project-auto-wizard` 저장소 본체나 다른 폴더에 영향을 주지 않는다 — CLI는 실행된 디렉터리 안에만 파일을 쓴다.
2. **코드 정적 분석**: `src/`, `payload/`를 직접 읽어 로직 결함과 문서-구현 불일치를 찾는다.
3. (참고) 기존 자동화 테스트(`npm test` = node --test + python unittest)는 베이스라인 확인 용도로 1회 실행한다.

이번 단계(코드 수정 없이 계획 수립)에서는 위 방식을 실행하지 않고, 다음 단계(writing-plans 이후 실제 실행 세션)에서 수행한다.

## 4. 코드 정적 분석으로 발견한 기존 버그 후보

6개 영역(CLI 진입점/설치 커맨드, 비설치 커맨드, 타입 감지/경로, 파일 복사 엔진, UI 레이어, payload 산출물)을 병렬로 정독하여 발견한 후보. 모두 **미검증 후보**이며, Phase 1에서 실제 CLI 실행으로 재현 여부를 확인해야 한다.

### HIGH — 실사용 영향이 크고 문서와 실제 동작이 다를 가능성

| # | 위치 | 내용 |
|---|---|---|
| H1 | `src/index.js:210-217` | 잘못된 `--mode` 값에 대한 검증이 없음. `--mode <오타> --force` 실행 시 감지·브랜치 해석·`ensureDevelopBranch`(원격 develop 브랜치 자동 생성+push)까지 전부 실행된 후에야 아무 것도 복사하지 않고 조용히 종료됨. |
| H2 | `src/index.js:135-138` | `--force` 필수 게이트가 **non-TTY일 때만** 발동. TTY 환경에서 `--mode full`(등)을 `--force` 없이 실행하면 확인 질문 없이 바로 실제 파일이 써짐. |
| H3 | `src/core/copy/workflows.js:86-92` | `common` 워크플로우(`VERSION-CONTROL`/`AUTO-CHANGELOG-CONTROL`/`RELEASE-PUBLISH`)는 사용자가 수정한 상태에서 재실행하면 3지선(유지/백업/참고본) 없이 **무조건 덮어쓰기**됨. README가 설명하는 "3지선 처리"의 실제 적용 범위와 다를 가능성. |
| H4 | `src/core/wizard-env.js:99` (`isUnchanged`) | 드리프트 판정 시 `useDefaults`를 항상 강제로 `true`로 덮어씀. 대화형 설치에서 `@wizard ask` 필드에 기본값이 아닌 값을 입력했다면, 설치 직후 `--mode status`나 재설치 시 해당 파일이 "사용자가 수정함"으로 오탐될 가능성. |

### MEDIUM

| # | 위치 | 내용 |
|---|---|---|
| M1 | `src/commands/version.js` | `--mode version --coderabbit` 조합 시 `version.yml`엔 `coderabbit: true`가 기록되지만 실제 `.coderabbit.yaml`은 설치되지 않음(coderabbit 복사 로직 부재) → `status`에서 드리프트 오탐 가능. |
| M2 | `src/core/detect.js` | 여러 타입 마커가 동시에 존재하면(예: `build.gradle`+`package.json`) `--type` 미지정 시에도 자동으로 멀티타입이 감지됨(우선순위 선택이 아니라 독립 push 구조). 의도된 동작인지 확인 필요. |
| M3 | `src/core/paths-resolve.js` | `--paths`로 지정한 경로의 실제 존재 여부를 검증하지 않음. |
| M4 | `src/index.js` (`--force` + 모노레포) | 후보 경로가 0개든 2개 이상이든 경고만 출력하고 조용히 `.`(루트)로 확정. |
| M5 | `src/core/branches.js` | `git fetch` 없이 로컬 캐시(`origin/*`)만으로 develop 브랜치 존재 여부를 판단 → 로컬 fetch가 오래되면 오판 가능. |
| M6 | `src/commands/status.js:20` | `existing.branches`가 완전히 없을 때만 기본값 폴백이 동작. `{main: "main"}`처럼 부분 객체면 폴백이 안 걸려 거짓 drift 유발 가능. |
| M7 | `src/core/copy/gitignore.js:100-104` | 제거 로직이 배너 직후 필수 항목이 "연속"되는 동안만 소비. 사용자가 배너 블록 중간에 줄을 끼워넣으면 그 지점에서 멈춰 일부만 제거됨. |
| M8 | `src/core/version-yml.js` | 정규식 기반 라인 파서 + 전체 재생성 전략. 스크립트가 모르는 임의 필드를 사용자가 추가했다면 재실행 시 소실 가능. |
| M9 | `payload/workflows/spring/PROJECT-SPRING-GITHUB-PACKAGES-PUBLISH.yml` | README에 언급 없음. `nexus/`나 `server-deploy/`가 아닌 `spring/` 타입 루트에 있어 옵션 게이팅 없이 기본 설치될 가능성. |
| M10 | `payload/workflows/spring/server-deploy/*NONSTOP*.yaml` | `push` 트리거가 주석 처리되어 있고 `workflow_dispatch`만 활성 — main push 시 자동 배포되지 않음. README의 "무중단 배포" 표현이 자동 배포를 암시하지만 실제로는 수동 트리거. 의도된 안전장치일 수 있으나 문서에 미명시. |
| M11 | `src/ui/readline-engine.js` | `stdin.on("end")` 미처리. TTY가 갑자기 끊기면(SSH 연결 끊김 등) keypress 이벤트가 더 안 와서 프로세스가 무한 대기할 가능성. |

### LOW

| # | 위치 | 내용 |
|---|---|---|
| L1 | `src/ui/readline-engine.js` | Ctrl+D가 어떤 핸들러에도 안 걸려 사실상 무반응. |
| L2 | `src/ui/ansi.js`, `banner.js`, `status-cards.js` vs `summary.js` | 색상 처리 비일관. `summary.js`는 비TTY에서 ANSI 코드를 빼지만 나머지는 TTY 체크 없이 무조건 삽입. `NO_COLOR` 미지원. |
| L3 | `src/ui/prompts.js` (`selectMode`) | 대화형 최상위 메뉴에 `status`/`doctor`가 노출되지 않음(CLI 플래그 전용인지 확인 필요). |
| L4 | `src/core/detect.js` (`hasJq` 게이트) | `package.json`의 `version` 필드는 `jq`가 PATH에 있을 때만 채택. README에 이 의존성 언급 없음. |
| L5 | `src/cli/args.js` | `--type`은 내부 공백을 조용히 전부 제거하지만 `--paths`의 타입명은 `.trim()`만 적용 — 처리 방식 비일관. |
| L6 | `src/index.js` | `--main-branch ""` 빈 문자열 명시 지정이 "미지정"과 동일하게 자동 감지값으로 폴백됨. |
| L7 | `src/cli/args.js` (switch 파싱) | `--nexus --no-nexus` 등 상호 모순 옵션 동시 지정 시 에러 없이 마지막 값이 조용히 적용됨. |
| L8 | `src/core/copy/workflows.js:129-134` | template 파일명 생성 시 `.yaml`은 확장자 strip 후 부착하지만 `.yml`은 strip 없이 붙어 `foo.yml.template.yaml`이 됨. |
| L9 | `src/core/wizard-env.js` (`setEnvLine`) | 치환 값에 큰따옴표(`"`)가 포함되면 정규식이 중간에서 끊겨 치환이 깨질 수 있음. |
| L10 | `src/core/fsutil.js` | `writeText`/`copyFileSync`가 원자적이지 않음. 쓰기 도중 프로세스가 죽으면 파일이 손상된 채 남을 가능성(발생 가능성은 낮음). |
| L11 | `src/commands/doctor.js:38-58` | `gh api` 실패를 세분화하지 않아 "토큰 스코프 부족"과 "권한 부족"을 구분하지 못함. |
| L12 | `src/commands/revert.js:11` | 설치 이후 더 최신 패키지 버전으로 `revert`를 실행하면, 이름이 바뀌었거나 제거된 구버전 워크플로우 파일이 제거되지 않을 가능성. |
| L13 | `tests/py/test_sh_equivalence.py` | `PROJECTOPS_SH_REF` 환경변수가 없으면 자동 skip — 일반 `npm test`/CI에서는 사실상 항상 스킵되는 구조. |

## 5. 테스트 실행 계획

**환경**: 스크래치패드 하위에 시나리오별 격리된 임시 git 저장소. `project-auto-wizard` 저장소 본체는 건드리지 않는다.

**Phase 0 — 자동화 테스트 베이스라인**
- `npm test`(node --test + python unittest) 실행, 통과/실패 현황 기록.

**Phase 1 — HIGH 버그 후보 재현** (H1~H4 우선 확인)

**Phase 2 — 설치 매트릭스**
- 9개 타입 개별 설치 + 멀티타입 + 모노레포. 설치된 워크플로우/스크립트를 README 서술과 1:1 대조(M9 포함 여부 확인).
- 마커 파일 복수 존재 시 자동 멀티타입 감지 여부(M2) 확인.

**Phase 3 — 옵션 조합**
- `--nexus`/`--secret-backup`/`--coderabbit`/`--semver-auto`|`--no-semver-auto` 개별+조합, M1 재현, L7 확인, `--type`/`--paths` 비정상 입력(L5, M3).

**Phase 4 — 보조 모드**
- `status`(M6, H4 재현 포함) / `doctor` / `dry-run` × 5개 모드 조합 / `revert`/`uninstall`(대화형+`--force`+`--purge-*`) / `purge`.

**Phase 5 — 재실행 멱등성 심층**
- 카테고리별(타입별/common/nexus/secret-backup/coderabbit) 재실행 동작 확인, H3 재현. `.gitignore` 배너 블록 중간 삽입 후 제거(M7). `version.yml` 임의 필드 소실 여부(M8).

**Phase 6 — UI/환경 엣지케이스**
- 비TTY 실행, ESC/Ctrl+C/Ctrl+D(L1), 좁은 터미널, `NO_COLOR`+리다이렉트(L2), 브랜치 대소문자, fetch 안 된 상태에서 develop 자동 생성(M5).

**산출물**: 각 시나리오의 재현 성공/실패와 실제 로그를 기록. 확정된 버그는 이슈 #11 하위에 개별 이슈로 분리(프로젝트 Git 규칙에 따름).

## 6. 다음 단계

이 문서 승인 후 `writing-plans` 스킬로 넘어가 Phase별 구체적 실행 순서, 각 시나리오의 스크래치패드 디렉터리 구조, 완료 판정 기준(verify 방법)을 담은 실행 계획 문서를 작성한다.
