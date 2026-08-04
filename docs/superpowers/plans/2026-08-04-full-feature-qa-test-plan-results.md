# 이슈 #11 QA 실행 결과

- **관련 계획 문서**: `docs/superpowers/plans/2026-08-04-full-feature-qa-test-plan.md`
- **관련 설계 문서**: `docs/superpowers/specs/2026-08-04-full-feature-qa-test-plan-design.md`
- **실행 방식**: subagent-driven-development(태스크마다 구현 서브에이전트 + 리뷰 서브에이전트, 필요 시 수정 루프), 최종 결과는 fable5 모델로 별도 최종 검토 후 정정 반영
- **범위**: 로컬 CLI 산출물 검증까지(GitHub 실제 e2e는 이슈 #17 별도 진행)
- **다음 단계**: 아래 "확정된 버그 목록"과 "우선순위 요약"을 참고해 사용자가 어떤 항목을 이슈 #11 하위 개별 이슈로 분리할지 결정한다. 이 문서 자체는 자동으로 GitHub 이슈를 생성하지 않는다.

---


- 실행일: 2026-08-04
- 전체 시나리오 수: 46 (`findings.md`의 `##` 헤더 개수)
- PASS: 25
- 확정 버그(BUG): 16건 (고유 버그 ID 기준 — H1, H2, H3, M3, M4, M7, M8, M9, M10, L1, L2, L3, L4, L5, L6, L7). 관찰 블록 수는 17건(M9가 [Phase2-1](실행 관찰)과 [Phase6-6](코드 교차검증) 두 곳에서 동일 버그로 재확인됨).
- 신규 발견(NEW-BUG): 1건 (summary.js "새로 설치됨" 표시 오탐 — skip된 파일까지 새로 설치된 것처럼 표시)
- 보류/특이 케이스: 3건 — H4(설계 의도 가능성 높으나 최종 분류 보류), H3 1차 시도([Phase1-4] node, 무효/보정판으로 대체됨), L8~L13 코드 재확인 메모(Task 12 Step 1, 6개 하위 항목 중 L8=NOT-A-BUG·L9~L13=CONFIRMED-BY-CODE)
- 검산: PASS(25) + BUG 관찰(17) + NEW-BUG(1) + 보류/특이(3) = 46 = 전체 헤더 수와 일치

## 확정된 버그 목록 (이슈 분리 후보)

## [Phase1-1] H1: 잘못된 --mode 값 검증 누락
- 실행 커맨드: `node bin/project-auto-wizard.js --mode ful --force --type node` (origin에 main만 존재하는 로컬 bare 원격 연결)
- 기대 동작: 지원하지 않는 mode 값이면 명확한 에러로 즉시 거부, 원격에 어떠한 브랜치 부수효과도 없어야 함
- 실제 동작: 오타 모드값 `ful`이 검증 없이 그대로 통과됨. exit code: 0 (에러 없음). before-branches.txt는 `main`/`remotes/origin/main`만 있었으나, after-branches.txt에는 `develop`과 `remotes/origin/develop`이 새로 추가됨(diff: `0a1 > develop`, `1a3 > remotes/origin/develop`). bare-remote-branches.txt에도 `develop`이 실제로 생성되어 있음(`develop`, `* main`). **[fable5 최종 검토로 정정]** 그런데 `output.log`는 `추가된 파일: 📄 version.yml (버전: 1.0.0, 타입: node) / 📝 README.md (버전 섹션 추가)`, `.github/scripts/{version_manager.py, changelog_manager.py}` 까지 전부 정상 설치된 것처럼 "✨ Setup Complete!" 화면을 출력하지만, `h1-mode-typo/` 디렉터리를 직접 `ls -la`로 확인한 결과 **`version.yml`, `README.md`, `.github/` 어느 것도 실제로 생성되지 않았다**(디렉터리엔 `.git/`, 로그 파일들, fixture `package.json`만 존재). 즉 오타 모드는 `switch(opts.mode)`의 `default` 분기로 떨어져 아무 것도 복사하지 않은 채 무조건 `printSummary()`를 호출하고, `printSummary()`는 실제 파일 생성 여부를 검증하지 않고 "성공적으로 설치됨" 화면을 그대로 찍어낸다 — 이는 아래 NEW-BUG(summary.js 오탐)의 범위가 애초 발견된 "새로 설치됨" 목록보다 훨씬 넓다는 뜻이다(추가된 파일 섹션 전체가 무조건 출력됨). 원격 develop 브랜치 생성+push는 이 summary 출력과 무관하게 실제로 발생했다(브랜치 diff 파일로 실증됨).
- 판정: BUG(H1) — 재현됨. exit 0, `.github/workflows/` 비어있고 `version.yml`/`README.md`도 실제로는 생성되지 않았는데도(위 정정 내용 참고) bare 원격에는 `develop` 브랜치가 실제로 생김 — 문서에 정의된 "지원 모드"가 아닌 값(`ful`)이 아무 검증 없이 통과되어, 아무것도 설치하지 않았음에도 원격에 실제 부수효과(브랜치 생성+push)를 내고 화면엔 거짓 성공 메시지를 띄운 것을 실행으로 확인.

---

## [Phase1-2] H2: TTY에서 --force 없는 명시 모드 실행
- 실행 커맨드: `script -q script.log node bin/project-auto-wizard.js --mode full --type node` (의사 TTY, --force 없음, stdin 빈 줄)
- 기대 동작: 확인 절차(대화형 질문 또는 명시적 거부) 없이 파일이 바로 써지면 안 됨
- 실제 동작: 어떤 질문도 없이 즉시 `full 모드 (--force)` 배너를 출력하며 설치가 완료됨(exit 0). `.github/workflows/`에 PROJECT-COMMON-*.yaml 5개, version.yml, README.md 변경까지 전부 즉시 생성됨. 배너 자체에 실제로는 `--force`를 넘기지 않았음에도 "(--force)"라고 표시됨(printBannerCompact가 무조건 그렇게 출력 — src/ui/banner.js:28).
  - 코드 근거(src/index.js:223-228): 명시 모드 진입 가드는 `if (!opts.force && !opts.dryRun && !process.stdout.isTTY) { 에러; return 1; }` 뿐이다 — TTY이면 이 가드를 그냥 통과하고, 그 뒤 어떤 확인 절차(질문/거부)도 없이 바로 진행된다.
  - 결정적 근거(src/index.js:268): 이후 `createContext({ ..., force: true, ... })`로 **`force`가 무조건 `true`로 하드코딩**된다 — 사용자가 `--force`를 넘겼는지 여부와 무관하게 내부적으로 항상 force 경로로 실행됨. TTY 확인 절차 자체가 이 경로(명시 `--mode full` 등)에는 존재하지 않는다(대화형 3지선 질문은 `--mode interactive`/`runInteractive` 전용 별도 경로).
- 판정: BUG(H2) — 문서 기대("TTY든 아니든 --force 없이 명시 모드 실행 시 확인 절차가 있어야 함")와 달리, TTY에서 `--force` 없이 명시 모드를 실행해도 아무 질문 없이 즉시 파일이 써짐. 코드상 `force: true`가 하드코딩되어 있어 확인 절차 자체가 이 경로에 없음이 확인됨(CONFIRMED).

---

## [Phase1-4] H3: common 워크플로우 3지선 미적용 (최우선 확인) — 보정판(--type react)
- **보정 사유**: 최초 시도(--type node)는 payload/workflows/에 node 전용 디렉터리가 존재하지 않아(next/python/flutter/common/react/spring만 존재) 타입 전용 워크플로우가 아예 설치되지 않았다. 그 결과 TYPE_TARGET이 빈 문자열이 되어 "type-level=OVERWRITTEN"이라는 이전 기록은 실제 skip/overwrite 비교가 아니라 파일 부재로 인한 공허(vacuous) 결과였다. 이 값은 무효로 간주하고 아래 --type react 재실행 결과로 대체한다.
- **유효 증거 위치**: `$QA_ROOT/h3-common-overwrite-react/`(스크래치패드). package.json이 `{"name":"fx-react",...,"dependencies":{"react":"^18.0.0"}}`이고 version.yml에 `타입: react`로 기록되어 있어 이 디렉터리가 실제 react 실행 산출물임을 재확인했다. `$QA_ROOT/h3-common-overwrite/`(접미사 없는 디렉터리)는 무효화된 1차(node) 시도의 잔재만 남아있다 — 혼동 주의.
- **방법론 정정(리뷰 지적 반영)**: `h3-common-overwrite-react/rerun.log`는 마커 삽입 **이후** 재실행(2번째 `--mode full --force --type react`)의 stdout/stderr 전체를 담고 있으며, 실제로는 "새로 설치됨 (1개):" 목록에 `PROJECT-REACT-CI.yaml`/`PROJECT-REACT-CICD.yaml`(🎯 아이콘)까지 common 5종(📌 아이콘)과 함께 나열되어 있다(직접 `cat`으로 재확인 완료). 이전 리포트/findings에 인용했던 "5줄짜리 common-only" 텍스트는 실수로 `h3-common-overwrite/rerun.log`(1차 node 시도)와 동일한 내용을 잘못 인용한 것이었다 — 두 파일을 `diff`로 대조해 확인했다. **KEPT(skip)/OVERWRITTEN 최종 판정 자체는 이 CLI 출력 텍스트를 근거로 내린 것이 아니라**, 재실행 후 워크플로우 파일 내부에 마커 문자열이 실제로 남아있는지를 `grep -q "QA-TYPE-MARKER" "$TYPE_TARGET"` / `grep -q "QA-COMMON-MARKER" "$COMMON_TARGET"`로 직접 파일 내용을 검사해서 산출한 것이며, 이 grep 로직 자체는 처음부터 유효했다(재실행 스크립트 흐름상 rerun.log 캡처와 마커 grep은 독립적인 별개 스텝). 아래 "새로 발견" 절 참고 — 오히려 이 인용 오류 덕분에 `PROJECT-REACT-CI.yaml`이 실제로는 skip(마커 유지)됐음에도 요약 화면엔 "새로 설치됨"으로 잘못 표시된다는 별도 버그가 함께 드러났다.
- 실행 커맨드: `node bin/project-auto-wizard.js --mode full --force --type react` 최초 설치 → TYPE_TARGET(PROJECT-REACT-*)과 COMMON_TARGET(PROJECT-COMMON-RELEASE-PUBLISH.yaml)에 각각 마커 삽입 → 동일 커맨드로 재실행(force) → 재실행 후 두 대상 파일에 대해 마커 문자열 잔존 여부를 `grep -q`로 직접 검사
- 기대 동작: README의 "유지/백업 후 교체/참고본 추가 3지선"이 common에도 동일하게 적용되어야 함
- 실제 동작: type-level(react)=KEPT(skip) — `grep -n "QA-TYPE-MARKER" .../PROJECT-REACT-CI.yaml` → `195:# QA-TYPE-MARKER ...`로 마커가 재실행 후에도 그대로 남아있음을 직접 확인. common-level=OVERWRITTEN(무조건 덮어쓰기) — 동일 grep이 COMMON_TARGET에서는 매치되지 않음(마커 사라짐).
- 코드 근거(src/core/copy/workflows.js):
  - 76행 주석: "(1) common — unchanged면 스킵, 아니면 무조건 덮어쓰기." / 80~93행 실제 구현: decisions Map을 전혀 참조하지 않고 isUnchanged만 검사 → changed면 즉시 writeText로 덮어씀.
  - 96~100행, 177~191행(copyWorkflowsForType): 타입별 changed 파일은 190행에서 `applyDecision(decisions.get(f), ...)`로 decisions를 조회하고, 137행에서 미지정(undefined)이면 기본값 'skip'(counters.skipped++)으로 처리 — 즉 CLI 명시 모드(--mode full, decisions 항상 빈 Map)에서는 타입별 changed 파일이 구조적으로 항상 '유지(skip)'되지만 common changed 파일은 구조적으로 항상 '덮어쓰기'된다.
- 판정: type-level(KEPT) vs common-level(OVERWRITTEN)로 결과가 갈림 → **BUG(H3) CONFIRMED** — README가 말하는 "유지/백업 후 교체/참고본 추가 3지선"이 common 워크플로우에는 코드 구조상 전혀 적용되지 않으며, 이는 어떤 타입을 쓰든(단, 그 타입에 전용 워크플로우가 실존해야) 재현되는 구조적 결함이다.

---

## [Phase2-1] 타입 설치: spring
- 실행 커맨드: `node bin/project-auto-wizard.js --mode full --force --type spring`
- 기대 동작: README "타입별 워크플로우 구성" 절 서술(무중단 배포 2종(Nginx/Traefik) + 단일 서버 배포 + PR 프리뷰 + Nexus publish(opt-in))과 일치
- 실제 동작: 총 10개 워크플로우 설치됨 — common 5개(AI-PR-SUMMARY, AUTO-CHANGELOG-CONTROL, README-VERSION-UPDATE, RELEASE-PUBLISH, VERSION-CONTROL) + spring 타입 전용 5개(GITHUB-PACKAGES-PUBLISH.yml, NONSTOP-NGINX-CICD.yaml, NONSTOP-TRAEFIK-CICD.yaml, PR-PREVIEW.yaml, SIMPLE-CICD.yaml). README에 서술된 4개(무중단 Nginx/Traefik, 단일 서버 배포=SIMPLE-CICD, PR 프리뷰)는 모두 포함되지만, `PROJECT-SPRING-GITHUB-PACKAGES-PUBLISH.yml`은 --nexus 옵션 없이도(opt-in 표시 없이) 기본 설치되었고 README "타입별 워크플로우 구성" 절에는 이 파일에 대한 언급이 전혀 없음
- 판정: BUG(M9) — GITHUB-PACKAGES-PUBLISH.yml이 기본 설치되지만 README에 미문서화됨(Task 11에서 코드 근거로 교차검증 예정)

---

## [Phase2-5] M3: 존재하지 않는 --paths 경로 검증 누락
- 실행 커맨드: `node bin/project-auto-wizard.js --mode full --force --type react --paths "react=does-not-exist"` (does-not-exist 디렉터리는 실제로 생성한 적 없음)
- 기대 동작(README/코드 기준): --paths로 지정한 경로가 실제로 존재하지 않으면 설치를 거부하거나 최소한 경고해야 함
- 실제 동작: exit 0(에러 없음). 설치 로그에 `react → does-not-exist (--paths 지정)` 로 그대로 표시되며 워크플로우 7개(common 5 + react 2)가 리포 루트에 설치되고 version.yml에 `project_paths: {react: "does-not-exist"}` 가 검증 없이 그대로 기록됨. `does-not-exist` 디렉터리는 실제로 생성되지도 않았고(`ls does-not-exist` → No such file or directory) 존재 여부 확인도 없었음 — 이후 CI 워크플로우가 존재하지 않는 경로의 package.json을 참조하게 되어 실제 빌드 시점에야 실패할 것으로 예상됨.
- 판정: BUG(M3)

---

## [Phase3-5] L5: --type/--paths 공백 처리 비일관
- 실행 커맨드: `node bin/project-auto-wizard.js --mode full --force --type "re act"` (react fixture) vs `node bin/project-auto-wizard.js --mode full --force --type react --paths "re act=."`
- 기대 동작: 두 옵션 모두 타입명 내부 공백을 동일한 방식으로 처리해야 함(둘 다 거부하거나 둘 다 정규화)
- 실제 동작: `--type "re act"`는 `src/cli/args.js:50`의 `t.replace(/\s/g, "")`로 내부 공백을 전부 제거해 "react"로 조용히 정규화되어 exit 0으로 정상 설치됨(react 7개 워크플로우 생성). 반면 `--paths "re act=."`는 `src/cli/args.js:112`의 `.trim()`(앞뒤 공백만 제거)만 적용해 "re act"가 그대로 남아 `VALID_TYPES`에 없으므로 `CliError: --paths에 지원하지 않는 타입: 're act'`로 즉시 거부(exit 1)됨. 두 파싱 경로가 동일한 "타입명 문자열"에 대해 서로 다른 정규화 규칙(공백 전체 제거 vs 양끝만 trim)을 적용하는 비일관이 코드로 확인됨.
- 판정: BUG(L5)

---

## [Phase3-6] L6: --main-branch 빈 문자열 처리
- 실행 커맨드: `node bin/project-auto-wizard.js --mode full --force --type node --main-branch ""`
- 기대 동작: 사용자가 `--main-branch ""`를 명시적으로 지정했다면 미지정과는 구분되어야 함(최소한 경고라도 있어야 함)
- 실제 동작: version.yml에 `main: "main"`으로 기록됨 — 미지정 시와 동일한 자동 감지값(default branch)으로 조용히 폴백. 에러/경고 없음, exit 0. 코드 확인: `src/index.js:249`의 `opts.mainBranch || existing?.branches?.main || ""`와 `src/core/branches.js:32`의 `mainBranch || defaultBranch || "main"` 모두 JS의 falsy 평가로 빈 문자열을 "값 없음"과 동일하게 취급함. 설계 문서(`docs/superpowers/specs/2026-08-04-full-feature-qa-test-plan-design.md:73`)의 L6 정의("빈 문자열 명시 지정이 '미지정'과 동일하게 자동 감지값으로 폴백됨")와 정확히 일치.
- 판정: BUG(L6)

---

## [Phase3-7] L7: --nexus --no-nexus 상호모순 플래그
- 실행 커맨드: `node bin/project-auto-wizard.js --mode full --force --type spring --nexus --no-nexus`
- 기대 동작: 상호 모순되는 플래그를 동시에 지정하면 최소한 경고가 있거나 에러로 거부되어야 함
- 실제 동작: 에러/경고 없이 exit 0으로 정상 설치됨. `find .github/workflows -iname "*NEXUS*"` 결과 0건 — 뒤에 온 `--no-nexus`가 조용히 최종값으로 적용됨(마지막 값 우선). 코드 확인: `src/cli/args.js`의 switch 파싱이 각 플래그를 만날 때마다 `result.includeNexus`를 단순 재할당(`case "--nexus": includeNexus=true`, `case "--no-nexus": includeNexus=false`)하므로 모순 검증 로직 자체가 없음. 설계 문서 L7 정의("에러 없이 마지막 값이 조용히 적용됨")와 일치.
- 판정: BUG(L7)

---

## [Phase3-8] M4: --force + 모노레포 경로 애매 시 자동 루트 확정
- 실행 커맨드(0개 후보): `node bin/project-auto-wizard.js --mode full --force --type flutter` (app/pubspec.yaml만 존재, lib/ 없음 → flutter 후보 필터에서 0개로 걸러짐)
- 실행 커맨드(2개 이상 후보): `node bin/project-auto-wizard.js --mode full --force --type react` (client/, admin/ 양쪽에 react package.json 존재 → 후보 2개)
- 기대 동작: 후보가 0개(감지 실패)와 2개 이상(모호함)은 서로 다른 상황이므로 처리 결과가 구분되거나, 최소한 실패로 거부되어야 함
- 실제 동작: 두 케이스 모두 동일하게 처리됨 — `⚠️ flutter → 후보 0개로 자동 확정 불가, 루트(.)로 기록`, `⚠️ react → 후보 2개로 자동 확정 불가, 루트(.)로 기록`처럼 경고만 출력하고 exit 0으로 정상 설치 진행, `version.yml`의 `project_paths`엔 두 경우 모두 `"."`(루트)로 조용히 확정 기록됨. 0개와 2개 이상 사이에 처리 방식 차이 없음. 설계 문서 M4 정의("후보 경로가 0개든 2개 이상이든 경고만 출력하고 조용히 `.`로 확정")와 정확히 일치.
- 판정: BUG(M4)

---

## [Phase5-3] M7: .gitignore 배너 블록 중간 삽입 시 제거 로직 부분 동작
- 실행 커맨드: `node bin/project-auto-wizard.js --mode full --force --type react` 설치(주의: 이 설치만으로는 `.gitignore`가 생성되지 않음 — 아래 실제 동작 참고) → `ensureGitignore()` 직접 호출로 배너 블록 상태 재현 → `*.bak`과 `*.template.yaml` 사이에 사용자 줄 삽입 → `node bin/project-auto-wizard.js --mode uninstall --force --purge-gitignore` 실행
- 기대 동작: 배너 이후 REQUIRED_ENTRIES 항목이 "연속"으로만 소비되므로, 중간에 삽입된 사용자 줄 이후 항목(`*.template.yaml`)은 제거되지 않고 남아야 함
- 실제 동작(브리프 대비 보정 필요성 확인됨): (1) 평범한 `full --force` 설치 후 `.gitignore`가 전혀 생성되지 않음 — `src/commands/full.js`에서 `ensureGitignore`는 `wfCounters.backupAdded>0 || wfCounters.templateAdded>0`일 때만 호출되는데, CLI `--mode full` 경로는 `decisions` Map이 항상 빈 Map이라 backup/template이 절대 발생하지 않음(이 코드베이스가 issue #7 반영 이후 `REQUIRED_ENTRIES`를 `["*.bak", "*.template.yaml"]`로 축소하고 gitignore 생성 자체를 조건부로 바꿨기 때문 — 브리프가 가정한 "/.idea 등을 포함해 매 설치마다 생성" 동작은 현재 코드와 다름). (2) `ensureGitignore()`를 직접 호출해 배너+두 항목(`*.bak`, `*.template.yaml`)이 실제로 존재하는 상태를 만든 뒤 그 사이에 사용자 줄을 삽입하고 실제 CLI(`--mode uninstall --force --purge-gitignore`)로 제거를 실행한 결과: `*.bak`은 제거됐지만 사용자 줄과 그 뒤의 `*.template.yaml`은 그대로 남음(`uninstall.log`: "제거됨 — 워크플로우 7개, 스크립트 2개, .gitignore 자동 추가 항목"이라고 보고하지만 실제로는 부분 제거일 뿐 완전 제거가 아님)
- 판정: BUG(M7) — 배너 블록 연속 소비 로직이 중간 삽입 시 이후 항목을 남기는 부분 동작이 재현됨. 단, 재현을 위해 브리프가 가정한 "/.idea" 항목 대신 현재 REQUIRED_ENTRIES(`*.bak`/`*.template.yaml`) 및 `ensureGitignore()` 직접 호출로 전제 조건을 재구성해야 했음(별도 관찰: 평범한 `full --force` 설치만으로는 `.gitignore`가 생성되지 않는 점 자체는 issue #7의 의도된 설계로 보이며 버그로 판정하지 않음)

---

## [Phase5-4] M8: version.yml 임의 필드 재실행 시 소실
- 실행 커맨드: `node bin/project-auto-wizard.js --mode full --force --type react` 설치 → `version.yml`에 `qa_custom_field: hello` 수동 추가 → `node bin/project-auto-wizard.js --mode version --force` 재실행
- 기대 동작: 사용자가 추가한 임의 필드가 재실행 후에도 보존되어야 함
- 실제 동작: 재실행(exit 0) 후 `version.yml`에서 `qa_custom_field` 필드가 완전히 사라짐("LOST(재생성 전략으로 소실)") — version.yml이 알려진 스키마 기반으로 재생성되며 임의 필드를 보존하지 않음
- 판정: BUG(M8) — 재현됨

---

## [Phase6-1] L2: NO_COLOR/비TTY 색상 처리 비일관
- 실행 커맨드: `NO_COLOR=1 node bin/project-auto-wizard.js --mode full --force --type node > out.log 2>&1` (stdout/stderr 모두 파일로 리다이렉트 → 비TTY)
- 기대 동작: NO_COLOR=1 또는 비TTY 환경에서는 ANSI 색상 코드가 출력에 섞이면 안 됨
- 실제 동작: out.log에 ESC(0x1b) 바이트 4개 확인됨(python3 바이너리 검사로 rtk grep 후킹 우회 확인, `grep -a $'\033['`는 환경 rtk 훅이 ugrep으로 치환하며 실패해 python3로 재검증). 원인은 `src/ui/banner.js`의 `printBannerCompact()`가 `src/ui/ansi.js`의 `paint()`를 무조건 호출 — `paint()`/`ansi.js`에는 NO_COLOR나 isTTY 가드가 전혀 없음(grep 결과 0건). 반면 `src/ui/summary.js:14`는 `process.stderr.isTTY`만으로 색상을 게이팅(NO_COLOR는 여기서도 미확인). 즉 같은 실행 안에서 배너는 항상 색을 칠하고 요약은 TTY 여부만 보는 두 갈래 로직이 공존 — 비일관 확인.
- 판정: BUG(L2)

---

## [Phase6-2] L1/M11: stdin end 미처리
- 실행 커맨드: `grep -n 'stdin.on("end"' src/ui/readline-engine.js` / `grep -c keypress src/ui/readline-engine.js` (코드 확인, 실행 없음)
- 기대 동작: EOF(Ctrl+D) 시그널을 명시적으로 처리하는 `stdin.on("end", ...)` 핸들러가 있어야 함
- 실제 동작: `stdin.on("end"` 매치 0건. `keypress` 리스너는 6곳(handler 등록/해제 반복) 있으나 stdin 종료(EOF) 전용 핸들러 없음 — 브리프의 "매치 0개 → CONFIRMED" 기준 충족.
- 판정: BUG(L1) — **[fable5 최종 검토로 명확화]** 헤더가 "L1/M11"로 두 설계 문서 ID를 함께 표기하고 있으나, 두 ID는 애초에 동일한 코드 결함(stdin `"end"` 핸들러 부재)을 가리키는 중복 표기다(설계 문서 §4 HIGH/MEDIUM 목록에서 L1=Ctrl+D 무반응, M11=readline-engine.js의 stdin end 미처리 — 원인이 동일한 코드 한 곳). 이슈 분리 시 하나로 묶어 처리하면 된다.

---

## [Phase6-3] L3: 대화형 메뉴 status/doctor 노출
- 실행 커맨드: `grep -n "status\|doctor" src/ui/prompts.js` / `grep -n "status\|doctor" src/commands/interactive.js` (코드 확인)
- 기대 동작: README(127행)가 `--mode`로 `full | version | workflows | revert | uninstall | status | doctor` 7종을 문서화하고 "(기본: 대화형)"이라 명시하므로, 대화형 최상위 메뉴에서도 이 7종에 상응하는 선택지가 있어야 자연스러움
- 실제 동작: `src/ui/prompts.js` 13~17행의 최상위 메뉴 choices는 `full/version/workflows/revert/uninstall` 5개뿐. `status`/`doctor` 문자열은 메뉴 선택지에 없음(유일한 매치는 85행의 `status-cards.js` import 문). `src/commands/interactive.js`에도 매치 0건. README에는 `status`/`doctor`가 "읽기 전용" 모드로 별도 소개(146~153행)되어 있으나 대화형 메뉴에는 노출 안 됨 — 사용자가 CLI 플래그를 미리 알아야만 접근 가능.
- 판정: BUG(L3) (interactive.js/prompts.js에 status/doctor를 의도적으로 제외한다는 주석·근거는 발견되지 않음 — 문서화 안 된 노출 격차로 판단)

---

## [Phase6-4] L4: jq 미설치 시 버전 감지 폴백
- 실행 커맨드: `PATH="$d/fakebin" node bin/project-auto-wizard.js --mode full --force --type node` (fakebin에 node/git만 심링크, jq·which 등은 격리됨)
- 기대 동작: jq 없이도 package.json의 version(1.0.0, fixture 원본)이 정상 감지되거나, 최소한 실패 시 사용자에게 명확한 경고가 있어야 함
- 실제 동작: exit 0, out.log에 에러/경고 없음. version.yml에 `version: "0.0.1"`로 기록됨(fixture 원본은 1.0.0). `src/core/detect.js:38-40`의 `detectVersionFromFiles`를 보면 `readJson("package.json")`으로 이미 순수 Node `JSON.parse`로 파싱을 마친 `pkg.version`이 있음에도, `hasJq`가 false면 이 값을 버리고 build.gradle/pubspec.yaml/pyproject.toml grep → git tag → 최종 하드코딩 `"0.0.1"` 순으로 폴백. jq는 실제로 package.json 파싱에 전혀 쓰이지 않는데도 이 값을 무조건 차단하는 불필요한 게이트이며, 폴백 시 사용자에게 아무 경고도 없이 잘못된 버전이 조용히 기록됨.
- 판정: BUG(L4)

---

## [Phase6-6] M9: spring GITHUB-PACKAGES-PUBLISH.yml 미문서화
- 실행 커맨드: `find payload/workflows/spring -maxdepth 1 -type f -name "*GITHUB-PACKAGES*"` + `src/core/copy/workflows.js` 복사 로직 확인
- 기대 동작: spring 타입 설치 시 실제로 복사되는 모든 워크플로우가 README의 spring 절(68행: "무중단 배포 2종(Nginx/Traefik) + 단일 서버 배포 + PR 프리뷰 + Nexus publish(opt-in)")에 문서화되어야 함
- 실제 동작: `payload/workflows/spring/PROJECT-SPRING-GITHUB-PACKAGES-PUBLISH.yml` 파일이 실존함. `workflows.js:184` (`copyWorkflowsForType`)에서 typeDir 직하위 파일은 `includeNexus` 등 어떤 옵션 플래그와도 무관하게 spring 설치 시 무조건 복사 대상(opt-in인 nexus/, server-deploy/와 달리 조건 분기 없음). README 전체를 "PACKAGES"/"nexus" 키워드로 검색해도 이 워크플로우에 대한 언급이 전혀 없음 — 모든 spring 사용자에게 조용히 설치되는 워크플로우가 README에는 빠져 있음.
- 판정: BUG(M9)

---

## [Phase6-7] M10: Nginx/Traefik 무중단 배포 push 트리거 비활성
- 실행 커맨드: `grep -n "^\s*#.*push:\|^\s*push:" payload/workflows/spring/server-deploy/PROJECT-SPRING-NONSTOP-NGINX-CICD.yaml` + Traefik 버전/SIMPLE-CICD 대조
- 기대 동작: README가 spring 기본 제공 기능으로 "무중단 배포 2종(Nginx/Traefik)"을 소개하므로, 설치 직후 별도 조치 없이 main 브랜치 push 시 무중단 배포가 동작해야 사용자 기대에 부합
- 실제 동작: `PROJECT-SPRING-NONSTOP-NGINX-CICD.yaml`과 `PROJECT-SPRING-NONSTOP-TRAEFIK-CICD.yaml` 둘 다 `on:` 섹션에서 `push:`/`branches:`가 주석 처리되어 있고 `workflow_dispatch:`만 활성 — 즉 push해도 자동 배포되지 않고 GitHub Actions UI에서 수동 트리거해야 함. 파일 내부 헤더 주석에 "기본 배포는 PROJECT-SPRING-SIMPLE-CICD.yaml, 전환하려면 push.branches 주석 해제 + SIMPLE-CICD의 push 트리거 주석 처리"라고 안내는 되어 있으나, 이는 YAML 파일을 직접 열어봐야만 알 수 있는 정보이고 설치 완료 요약(summary.js 출력)이나 README 어디에도 "무중단 배포를 쓰려면 수동 전환이 필요하다"는 안내가 없음(SIMPLE-CICD.yaml은 반대로 push 트리거가 기본 활성).
- 판정: BUG(M10)

## 신규 발견 (스펙에 없던 케이스)

## [Phase1-4-부수발견] NEW-BUG: summary.js "새로 설치됨" 표시가 skip된 파일까지 포함
- 실행 커맨드: Task 4 H3 재실행 중 관찰(`node bin/project-auto-wizard.js --mode full --force --type react`, `h3-common-overwrite-react/rerun.log`)
- 기대 동작: "추가된 워크플로우 → 📦 새로 설치됨" 목록은 이번 실행에서 실제로 새로 쓰이거나 갱신된(copied) 파일만 나열해야 한다.
- 실제 동작: `rerun.log`(마커 삽입 후 재실행 로그)에 다음과 같이 출력됨 —
  ```
  추가된 워크플로우:
    📦 새로 설치됨 (1개):
       📌 PROJECT-COMMON-AI-PR-SUMMARY.yaml
       📌 PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml
       📌 PROJECT-COMMON-README-VERSION-UPDATE.yaml
       📌 PROJECT-COMMON-RELEASE-PUBLISH.yaml
       📌 PROJECT-COMMON-VERSION-CONTROL.yaml
       🎯 PROJECT-REACT-CI.yaml
       🎯 PROJECT-REACT-CICD.yaml
  ```
  그런데 `PROJECT-REACT-CI.yaml`은 같은 재실행에서 **실제로 skip되어 원본이 그대로 유지**됐음이 마커 grep으로 이미 확인된 파일이다(위 H3 보정판 블록 참고 — `QA-TYPE-MARKER`가 재실행 후에도 그대로 남아있음). 즉 이번 실행에서 전혀 손대지 않은(skip된) 파일이 "📦 새로 설치됨" 목록에 그대로 나타난다. 또한 "(1개)"라는 카운트 문구도 나열된 항목 수(7개)와 일치하지 않는다.
  - 코드 근거(`src/ui/summary.js:69-89`): `printSummary`는 실행 결과(counters)에서 "이번에 실제로 복사된 파일 이름"을 받아오지 않는다. 대신 69~83행에서 `.github/workflows/` 디렉터리를 **현재 시점 기준으로 다시 스캔**해 `PROJECT-` prefix로 시작하는 파일을 전부 훑고, `WORKFLOW_COMMON_PREFIX`(PROJECT-COMMON-)로 시작하면 `commonWorkflows`에, 실행에 전달된 `types` 배열의 prefix(`PROJECT-{TYPE}-`)와 매치하면 `typeWorkflows`에 무조건 담는다. 이 스캔은 skip/backup/template/신규 여부를 전혀 구분하지 않고 "현재 디렉터리에 그 prefix로 존재하는 모든 파일"을 대상으로 하므로, 85~89행에서 이 목록 전체를 "📦 새로 설치됨"으로 출력한다. 반면 `(${workflowsCopied}개)`의 카운트(86행)는 `counters.workflows`(실제 copy 카운터, 18행)를 쓰기 때문에 목록 항목 수와 근본적으로 다른 두 소스가 한 문장에 섞여 나온다.
- 판정: **NEW-BUG(신규 발견)** — `--force` 재실행마다(기존 워크플로우가 있는 저장소에 재설치하는 매우 흔한 실사용 경로) 재현되는 사용자 오도(misleading) 버그. 사용자는 "새로 설치됨" 목록을 보고 해당 파일들이 이번에 실제로 갱신됐다고 오해할 수 있으나, skip되어 사용자의 기존 커스터마이징이 그대로 보존된 타입별 changed 파일까지 "새로 설치됨"으로 표시되어 실제 파일 상태(무엇이 바뀌었고 무엇이 안 바뀌었는지)를 오도한다. "(N개)" 카운트 문구도 실제 나열 항목 수와 무관한 별개 카운터를 써서 부정확하다.
- **[fable5 최종 검토로 범위 확장]**: H1 재검증 과정에서 이 버그의 범위가 "새로 설치됨" 목록에 국한되지 않음이 추가로 확인됨 — `switch(opts.mode)`가 `default` 분기(아무 것도 복사 안 함)로 떨어져도 `printSummary()`는 무조건 호출되고, "추가된 파일: 📄 version.yml / 📝 README.md" 등 **파일 생성 여부를 전혀 검증하지 않고 항상 성공 화면을 출력**한다(H1 오타 모드 재현 시 실제로는 `version.yml`/`README.md`/`.github/`가 전혀 생성되지 않았는데도 전부 생성된 것처럼 "✨ Setup Complete!"가 출력됨). 즉 이 버그는 "일부 파일이 오분류되어 표시"되는 수준이 아니라, **아무 것도 설치되지 않은 완전 실패 상황에서도 완전 성공 화면이 뜨는** 더 심각한 사용자 오도로 확장된다.

## 보류/특이 케이스 (이슈 분리 판단 시 참고)

## [Phase1-3] H4: status 드리프트 오탐 (useDefaults 강제)
- 실행 커맨드: `node bin/project-auto-wizard.js --mode full --force --type spring` → `node bin/project-auto-wizard.js --mode status` (대조군) → `.github/workflows/PROJECT-SPRING-SIMPLE-CICD.yaml`의 `DEPLOY_PORT` 값을 `@wizard ask` 기본값(8080)이 아닌 값(9090)으로 수동 치환(대화형 설치에서 사용자가 기본값과 다른 응답을 한 것과 동일한 최종 상태 재현) → `--mode status` 재실행 + `src/core/wizard-env.js` 코드 확인
- 기대 동작: 사용자가 설치 이후 파일을 직접 손대지 않았다면(대화형 설치 시 `@wizard ask` 질문에 기본값이 아닌 값을 답했을 뿐이라면) status가 드리프트(수정됨)로 보고하면 안 됨 — 단, "기본값 대비 비교"가 의도된 설계라면 이 기대 자체가 틀릴 수 있음
- 실제 동작:
  - 대조군(`--force` 설치 직후 status): "모든 워크플로우 파일이 설치 시점 기본값과 동일합니다 (수정 없음)." — 정상, drift 없음. `--force` 설치는 useDefaults=true로 채워지므로 예상대로 baseline과 일치.
  - `@wizard ask` 필드(DEPLOY_PORT)를 기본값이 아닌 값(9090)으로 바꿔 "사용자가 대화형 설치에서 non-default 응답을 한" 상태를 재현한 뒤 status 재실행 → `사용자가 수정한 워크플로우 파일 (1개): - PROJECT-SPRING-SIMPLE-CICD.yaml` 로 **드리프트(수정됨)로 보고됨**.
  - 코드 확인(`grep -n "useDefaults" src/core/wizard-env.js`):
    - L48 주석: `useDefaults   - true면 ask도 기본값 사용 (WF_USE_DEFAULTS=true, unchanged 비교의 전제)`
    - L53: `substituteEnv(content, opts = {})`의 기본값 `useDefaults = true`
    - L69: `if (chosen != null && chosen !== "" && !useDefaults) val = chosen;` — useDefaults가 true면 사용자 선택값(chosen)을 무시하고 항상 기본값(def) 사용
    - L98-101(`isUnchanged`): `const virtual = substituteEnv(templateContent, { ...opts, useDefaults: true });` — **호출자가 넘긴 opts.useDefaults 값과 무관하게 항상 `useDefaults: true`를 강제**하여 "가상 기본값 치환본"을 만들고, 그것과 설치본을 바이트 비교한다.
  - 즉 `isUnchanged`(status/doctor의 드리프트 판정 기반)는 태생적으로 "설치본이 기본값 채운 템플릿과 같은가"만 판정하며, 사용자가 대화형 설치 중 어떤 응답을 했는지는 전혀 고려하지 않는다. `@wizard ask` 필드에 기본값이 아닌 값을 답한 순간, 설치 직후부터 이미 "드리프트"로 잡힌다.
- 판정: **의도된 설계로 재분류(NOT-A-BUG) 가능성이 높으나, 문서화 안 된 설계 결정으로 인한 실사용 혼란 위험이 있음.** L48 주석이 "useDefaults=true가 unchanged 비교의 전제"라고 명시적으로 밝히고 있어, 코드 작성자가 "파일이 기본 템플릿과 다른가"를 판정 기준으로 의도적으로 채택했다는 근거가 명확하다(사용자가 직접 편집했는지 여부를 판정하려는 의도가 아님). 다만 이 설계의 실사용 함의 — "대화형 설치에서 @wizard ask 질문에 기본값이 아닌 답을 하기만 해도 설치 직후부터 status/doctor가 항상 '사용자가 수정함'으로 표시한다" — 는 README 등 사용자 문서에 명시되어 있지 않다면 오탐(false positive)으로 체감될 소지가 크다. 코드 동작 자체는 CONFIRMED(재현됨)이며, "버그냐 설계냐"는 프로젝트 오너의 의도 확인이 필요한 영역이므로 findings에는 재현 결과와 설계 근거를 함께 기록하고 최종 분류(BUG(H4) vs NOT-A-BUG)는 보류한다.

---

## [Phase1-4] H3: common 워크플로우 3지선 미적용 (최우선 확인)
[INVALID — --type node는 payload/workflows/에 전용 디렉터리가 없어 TYPE_TARGET이 공허(空)했던 무효 시도. 아래 "보정판(--type react)" 블록이 유효한 결과다. 이 블록의 산출물은 `$QA_ROOT/h3-common-overwrite/`에 남아있으며 node용이다.]
- 실행 커맨드: 타입/common 워크플로우 각각 수동 편집 후 동일한 `node bin/project-auto-wizard.js --mode full --force --type node` 재실행
- 기대 동작: README의 "유지/백업 후 교체/참고본 추가 3지선"이 common에도 동일하게 적용되어야 함
- 실제 동작: type-level=OVERWRITTEN, common-level=OVERWRITTEN(무조건 덮어쓰기) (코드 주석으로 무조건 덮어쓰기 확인됨)
- 판정: (type과 common 결과가 다르면 BUG(H3) CONFIRMED, 같으면 PASS)

---

## [Phase-종합] L8~L13 코드 재확인 메모
- L8(template 확장자 비대칭): `src/core/copy/workflows.js:131-133` — `.yaml`만 strip하고 `.yml`은 그대로 뒤에 붙어 `xxx.yml.template.yaml`이 되는 동작을 코드 주석이 "// .sh T) `${filename%.yaml}.template.yaml` — .yaml만 strip (.yml은 그대로 뒤에 붙음, .sh 동일)"라고 명시적으로 문서화함. 즉 레거시 .sh 스크립트와 동일한 의도된 동작 — 버그가 아니라 이식 시 그대로 유지된 사양.
- L9(큰따옴표 값 치환 깨짐): `src/core/wizard-env.js:setEnvLine` (21~34행) — 치환 정규식 `^(\s*${key}:\s*")[^"]*(")`는 첫 `"` 이후 다음 `"` 전까지만 매치하고, 치환 값 `value`는 이스케이프 없이 그대로 삽입됨(`` `${p1}${value}${p2}` ``). 값에 `"`가 포함되면 YAML 문자열 구조가 깨짐(중간에 닫는 따옴표가 생겨 후속 텍스트가 밖으로 노출됨) — 코드상 이스케이프 로직 부재 확인.
- L10(fsutil 비원자적 쓰기): `src/core/fsutil.js` — `writeFileSync`(13행), `cpSync`(19, 25행)를 직접 사용, 임시파일+rename 같은 원자적 쓰기 패턴 없음. 다만 CLI가 단일 프로세스로 동기 실행되는 로컬 도구라 동시 쓰기 경합 발생 가능성은 낮음(실사용 발생 가능성 낮음으로 평가된 항목과 일치).
- L11(doctor 원인 세분화 부족): `src/commands/doctor.js` — 각 WARN 메시지 자체는 구체적 가이드(예: gh CLI 설치 링크, Settings 경로)를 포함해 세분화되어 있으나, 앞 단계 실패 시(`gh CLI` 없음 26행, `gh 인증` 실패 27행, `GitHub 원격` 파싱 실패 34행) 이후 체크(Workflow permissions/WORKFLOW_PAT/automerge 호환성)를 모두 건너뛰고 `return results`로 조기 종료함 — 뒤 단계 문제는 앞 단계가 해결되기 전까지 전혀 진단되지 않는 구조적 한계.
- L12(revert 구버전 파일명 잔존): `src/commands/revert.js:payloadWorkflowNames`(11~19행) — 제거 대상은 **현재 payload**에 존재하는 워크플로우 파일명 집합과 정확히 일치하는 것만 계산함(`planRevert` 21~40행). 과거 버전에서 설치된 뒤 이후 payload에서 파일명이 바뀌거나 삭제된 워크플로우는 현재 names 집합에 없으므로 revert가 인식하지 못하고 대상에서 누락됨 — 구버전 파일명 잔존 가능성이 코드 구조상 확인됨.
- L13(test_sh_equivalence.py 상시 skip): `tests/py/test_sh_equivalence.py` — `SH_REF = os.environ.get("PROJECTOPS_SH_REF")`(32행), 미설정 시 `SKIP_REASON = "PROJECTOPS_SH_REF not set"`(37행), `@unittest.skipIf(SKIP_REASON is not None, ...)`(62행)로 클래스 전체가 skip 처리됨. `PROJECTOPS_SH_REF` 환경변수는 일반 CI/로컬 실행에서 설정되지 않으므로 이 테스트는 기본적으로 항상 skip되며 `npm test` 등 표준 실행 경로에서 실질적으로 실행되지 않음.
- 판정: 코드 확인만 수행, 각 항목은 findings 요약에 근거와 함께 기록(재현 실행은 하지 않음). L8은 의도된 사양(NOT-A-BUG), L9/L10/L11/L12는 코드 구조상 확인된 잠재 이슈(재현 실행 없이 CONFIRMED-BY-CODE), L13은 항상 skip되는 동작이 코드상 확정적으로 확인됨(CONFIRMED-BY-CODE).
- **[fable5 최종 검토로 명확화]** L9~L13은 "확정 버그 목록(이슈 분리 후보)" 집계(16건)에는 포함되지 않고 이 절에만 남아있다 — 이는 Task 12 브리프가 "L8~L13은 재현 실행 없이 코드 확인만" 하도록 지시했기 때문이지, 이 4건이 버그가 아니라는 뜻이 아니다. 특히 **L9(치환 값에 큰따옴표 포함 시 YAML 구조 깨짐)**과 **L12(revert가 payload에서 이름이 바뀌거나 삭제된 구버전 워크플로우 파일을 인식 못해 잔존시킴)**는 코드 구조상 실재하는 결함이므로, 이슈 분리 검토 시 확정 버그 16건과 동등하게 후보로 고려할 가치가 있다. L10(비원자적 쓰기)·L11(doctor 원인 세분화 부족)은 실사용 영향이 낮아 후순위, L13은 테스트 인프라 이슈로 별도 트랙(테스트 정비)에 가깝다.

## 우선순위 요약 (이슈 분리 판단용, fable5 최종 검토 제안 반영)

- **즉시 이슈화 권장(실사용 위험 최고)**: H1(오타 모드가 원격에 develop 브랜치 생성+push, 게다가 아무것도 설치 안 됐는데 성공 화면 출력), H2(TTY에서 --force 없이도 확인 없이 즉시 설치), H3(재실행마다 common 워크플로우 커스터마이징이 조용히 소실), NEW-BUG(summary.js가 실패도 성공으로 표시)
- **다음 우선순위(문서-동작 불일치, 검증 누락)**: M3, M4, M7, M8, M9, M10 — 각각 구체적 실사용 시나리오에서 재현되는 확정 버그
- **묶음 이슈로 처리 가능(CLI 파싱 일관성)**: L5, L6, L7 — 전부 `src/cli/args.js`의 옵션 파싱 계열 결함이라 하나의 "CLI 파싱 견고성 개선" 이슈로 묶어도 무방
- **UI/저수준(영향 범위 좁음)**: L1(=M11), L2, L3, L4 — 우선순위 낮음, 묶음 이슈 가능
- **코드 확인만 완료, 이슈화 검토 필요**: L9, L12(실재하는 결함), L10·L11(후순위), L13(테스트 인프라)
- **보류(오너 판단 필요)**: H4 — 의도된 설계일 가능성이 높으나(코드 주석 근거 있음) 문서화 부재로 실사용 혼란 위험 있어 최종 분류는 프로젝트 오너 확인 필요
- **재현 불가(정보 갱신)**: M1 — CodeRabbit 연동 기능 자체가 코드베이스에서 전면 삭제되어 애초에 재현 대상이 아님. M2/M5/M6 — 실행+코드로 재검증한 결과 정상 동작(PASS)으로 확인됨
