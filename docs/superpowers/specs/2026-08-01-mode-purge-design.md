# `--mode purge` — 설치 이전 상태로 완전 회귀하는 숨김 모드 — 브레인스토밍 결과

- 날짜: 2026-08-01
- 상태: 브레인스토밍 완료 (사용자 승인 대기 — 코드 구현 착수 전)
- 이슈: [Twin-Fang/project-auto-wizard#6](https://github.com/Twin-Fang/project-auto-wizard/issues/6)
- 브랜치: `20260801_#6_mode_purge_설치_이전_상태로_완전_회귀하는_숨김_모드`
- 참고: 이 문서는 **설계 스펙**이다. 실제 구현 순서/작업 단위는 별도 `writing-plans` 세션에서 다룬다.

## 1. 배경 — 문제 정의

- 실전 테스트를 위해 각 레포에 `npx project-auto-wizard`를 반복 설치하는데, 테스트가 끝난 뒤 설치 직전 상태로 되돌릴 방법이 없다.
- 현행 `--mode revert`(`src/commands/revert.js`)는 의도적으로 보수적이라, payload 유래 파일(워크플로우·스크립트·coderabbit)만 제거하고 `version.yml`, README `AUTO-VERSION-SECTION` 블록, `CHANGELOG.json`/`CHANGELOG.md`, 자동 생성된 `develop` 브랜치는 보존한다.
- `version.yml`이 남아 있으면 재실행 시 버전 SSoT(`src/index.js`의 `existing?.version` 최우선 규칙)로 읽혀 깨끗한 초기 설치 시나리오를 재현할 수 없다 — 테스트가 오염된다.

## 2. 목표 / 비목표

**목표**: 마법사가 만든 모든 산출물을 제거해 설치 이전 상태로 완전히 되돌리는 `--mode purge`를 신설한다. 개발·테스트 전용이므로 대화형 마법사 메뉴와 `--help` 출력에는 노출하지 않고 CLI 인자로만 접근한다.

**비목표**:
- `.gitignore`의 `# project-auto-wizard: Auto-added entries` 블록 제거는 이 이슈 범위에서 **제외**한다(`.gitignore` 자동 수정 기능 자체를 폐지하는 별도 이슈에서 다룸).
- 원격 브랜치 삭제는 어떤 경우에도 하지 않는다(로컬 `develop` 브랜치만 opt-in 삭제).
- 기존 `--mode revert`의 동작·시그니처는 변경하지 않는다(하위호환) — purge는 revert의 로직을 재사용만 한다.

## 3. 제거 대상

`--mode revert`가 지우는 전부(워크플로우, `.github/scripts/version_manager.py`·`changelog_manager.py`, `.coderabbit.yaml` — payload와 바이트 일치 시) + 아래를 추가:

| 대상 | 기본 동작 | 보존 플래그 |
|---|---|---|
| `version.yml` | 파일 통째로 삭제 | `--keep-version-yml` |
| README `AUTO-VERSION-SECTION` 블록 | 마커~블록 끝만 정확히 잘라냄. 마커 없으면 no-op(사용자가 직접 쓴 버전 라인은 건드리지 않음) | `--keep-readme` |
| `CHANGELOG.json` / `CHANGELOG.md` (루트) | 존재하면 삭제 | `--keep-changelog` |
| 워크플로우 (revert 재사용) | — | `--keep-workflows` |
| `.github/scripts/*.py` (revert 재사용) | — | `--keep-scripts` |
| `.coderabbit.yaml` (revert 재사용, `.bak` 있으면 복원) | — | `--keep-coderabbit` |
| 로컬 `develop` 브랜치 | **기본 보존**. `--delete-develop-branch`로만 opt-in 삭제, `git branch -d`(safe delete)만 사용 — merge 안 된 커밋 있으면 git이 자체 거부, non-fatal 경고 로그로 넘어감. 원격은 절대 건드리지 않음 | (opt-in 플래그 자체가 게이트) |

## 4. CLI 인터페이스

**신규 플래그** (`src/cli/args.js`에 파싱 추가, `src/cli/help.js`의 `HELP_TEXT`에는 **추가하지 않음** — 숨김 유지가 요구사항):

```
--yes                      purge 실행 확인 (필수, --force로 대체 불가)
--dry-run                  실제 삭제 없이 미리보기 (기존 플래그 재사용)
--allow-dirty               git 작업트리 dirty 상태에서도 강행
--delete-develop-branch     로컬 develop 브랜치까지 삭제 (git branch -d)
--keep-version-yml
--keep-readme
--keep-changelog
--keep-workflows
--keep-scripts
--keep-coderabbit
```

## 5. 안전장치 게이트 순서 (`src/index.js`, `revert` 분기 옆에 `purge` 분기 추가)

1. **`.git` 존재 확인** (`existsSync(join(cwd, ".git"))`) — 실패 시 exit 1. **`--dry-run` 포함 항상 적용** (되돌릴 수단이 없는 곳에서의 오작동 방지가 dry-run에도 유효하므로).
2. **`--dry-run`이면 여기서 분기** → `planPurge()` 결과를 카테고리별로 출력하고 return 0. 아래 ③~⑤ 게이트는 전부 건너뜀(`--yes`도 불필요 — 실제 부수효과가 0이므로).
3. **`--yes` 필수** — 없으면 무조건 거부, exit 1. `--force`만으로는 절대 우회 불가.
4. **작업트리 clean 확인** (`git status --porcelain`) — dirty면 거부, `--allow-dirty`로만 우회.
5. **TTY 확인**: `--force`면 이 단계 생략. TTY면 레포명 타이핑 확인 — **불일치 시 재시도 없이 즉시 exit 1**(rm -rf 스타일 엄격함). 비TTY이고 `--force` 없으면 기존 다른 모드와 동일한 메시지로 거부("비대화형 환경에서는 --force 옵션이 필요합니다").
6. **삭제 전 요약 출력**(카테고리별) → `executePurge()` 실행 → **삭제 후 실제 제거된 목록 재출력**. `--delete-develop-branch`가 있으면 이 시점에 로컬 브랜치 삭제 시도 결과도 리포트.

## 6. `src/commands/purge.js` (신규) 내부 설계

`planPurge()` / `executePurge()` 2단 구조 — 기존 `planRevert()`/`runRevert()`(#4 Phase 4에서 확립된 패턴)와 시그니처 형태를 맞춘다.

**`planPurge(payloadRoot, targetRoot, keepFlags)`** — 순수 함수, 아무것도 지우지 않음:
- 내부에서 `planRevert(payloadRoot, targetRoot)`를 호출해 워크플로우/스크립트/coderabbit 후보를 재사용 (`revert.js` 수정 없음, 중복 구현 없음)
- 추가로 `version.yml` 존재 여부, README 마커 존재 여부, `CHANGELOG.json`/`CHANGELOG.md`(루트) 존재 여부를 계산
- `keepFlags`로 해당 카테고리를 후보에서 제외 → `--dry-run` 미리보기와 실제 삭제가 항상 동일한 목록을 보게 됨

**`executePurge(payloadRoot, targetRoot, keepFlags)`**:
- `planPurge()` 결과 기반으로 실제 삭제 수행
- 워크플로우/스크립트/coderabbit 삭제는 `remove()`(`fsutil.js`)를 필터링된 목록에 대해 직접 호출 — `runRevert()`를 통째로 호출하지 않는다(`runRevert`는 항상 전체를 지우므로 `--keep-*` 선택적 보존과 맞지 않음)
- README는 신규 `removeVersionSectionFromReadme()` 호출 (아래 §7)
- 반환값은 `planPurge()`와 동일한 shape에 실제 삭제 결과를 반영

**`develop` 브랜치 삭제는 `purge.js`가 아니라 `index.js`의 purge 분기에서 직접 처리** — plan에는 포함하지 않는다(브랜치 존재 여부는 실행 시점 git 상태 문제라 파일 삭제 후보 목록과 성격이 다름). git 호출(`git status --porcelain`, `git branch -d`)은 `branches.js`의 `exec` 주입 패턴을 재사용해 테스트에서 실제 프로세스 스폰 없이 mock 가능하게 만든다.

## 7. `src/core/copy/readme.js` — `removeVersionSectionFromReadme()` (신규)

`addVersionSectionToReadme()`와 대칭으로 같은 파일에 배치. 마커 시작(`\n---\n\n<!-- AUTO-VERSION-SECTION`)부터 블록 끝까지만 정확히 잘라내고, 마커가 없으면 no-op. README의 나머지 내용과 파일 자체는 보존.

## 8. TTY 레포명 확인 UX

- `src/ui/readline-engine.js`의 `text()`(raw-mode keypress 기반, 대화형 위자드 파이프라인 전용)는 **재사용하지 않는다** — purge는 그 파이프라인을 타지 않는 독립 경로이고, 화려한 UI가 hidden/dev-only 명령에 불필요하게 무겁다.
- 대신 `node:readline`(promises API) 기반의 간단한 단일 라인 입력을 사용한다: `정확히 이 레포명을 입력하세요: <repoName>` 프롬프트 후 한 줄 입력. `rm -rf` 스타일 확인 패턴과 동일.
- 테스트 가능하도록 confirm 함수를 주입 가능하게 설계(`branches.js`의 `confirm` 주입 패턴과 동일 스타일).
- 레포명은 기존 `detectRepoName()`(`core/detect-fs.js`)으로 감지.

## 9. 테스트 전략

기존 코드베이스 관례상 git 관련 로직은 실제 `git init`으로 픽스처를 만들지 않고 **`exec` 함수 주입**으로 mock 처리한다(`branches.js`의 `ensureDevelopBranch({ exec })` 패턴). purge도 이 관례를 따른다.

1. **`planPurge`/`executePurge` 순수 함수 테스트** (`tests/node/purge-plan.test.js`, `revert-plan.test.js` 스타일)
   - 라운드트립: `runFull()` 설치 → `planPurge()`가 전체 산출물을 후보로 나열 → `executePurge()` 실행 → 설치 전 파일 트리와 일치
   - `--keep-*` 각각에 대해 해당 카테고리만 보존되고 나머지는 지워짐 검증
   - README 마커 제거 라운드트립: `addVersionSectionToReadme()` → `removeVersionSectionFromReadme()` → 원본 내용 복원 확인, 마커 없을 때 no-op 확인
2. **CLI 레벨 게이트 테스트** (`tests/node/purge-cli.test.js`, `dry-run-cli.test.js` 스타일로 `run()` 호출)
   - `.git` 없는 디렉터리 → dry-run 포함 거부, exit 1
   - `--dry-run`(git 레포 + `--yes` 없이) → 파일 변경 없음, exit 0
   - `--yes` 없이 실제 실행 → 거부, exit 1(`--force` 있어도)
   - dirty 작업트리(주입된 git 상태로 시뮬레이션) → 거부, `--allow-dirty`로 통과
   - `--yes --force`(비TTY) → 실제 삭제 수행, 카테고리별 결과 출력
   - `--delete-develop-branch`: `git branch -d` 실패(unmerged) 시 non-fatal 경고 로그, exit 0 유지
3. git 연동부(`status --porcelain`, `branch -d`)는 `exec` 주입 가능하게 설계 → 결정적 테스트.

## 10. 변경 파일 목록

| 파일 | 변경 내용 |
|---|---|
| `src/cli/args.js` | `purge` 관련 신규 플래그 10종 파싱 |
| `src/cli/help.js` | **변경 없음** (숨김 유지) |
| `src/commands/purge.js` | 신규 — `planPurge()`/`executePurge()` |
| `src/commands/revert.js` | **변경 없음** (읽기 전용 재사용만) |
| `src/core/copy/readme.js` | `removeVersionSectionFromReadme()` 추가 |
| `src/index.js` | `revert` 분기 옆에 `purge` 분기 추가, 게이트 순서(§5) 구현, TTY 레포명 확인, develop 브랜치 삭제 |
| `tests/node/purge-plan.test.js` | 신규 |
| `tests/node/purge-cli.test.js` | 신규 |

## 11. 관련 이슈

- #4 (완료) — Phase 4에서 `revert.js` plan/execute 분리 + 전 모드 `--dry-run` 도입. purge의 plan/execute 구조는 이 패턴을 그대로 계승한다.
