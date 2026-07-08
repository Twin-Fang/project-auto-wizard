# HANDOFF — 진행 상황 및 재개 가이드 (2026-07-09)

> 다른 머신/세션에서 이어서 작업할 때 이 문서 + `docs/DESIGN-SPEC.md`(승인된 설계 명세) + `docs/IMPLEMENTATION-PLAN.md`(20 Task 구현 계획)를 먼저 읽는다.
> 실행 방식: superpowers:subagent-driven-development — Task별 구현 서브에이전트 → 스펙 리뷰 → 품질 리뷰 → 수정 → 커밋+push(main). 커밋에 Claude/AI 흔적(Co-Authored-By 등) **절대 금지**. Conventional Commits(영문). 모든 커밋 후 `git push origin main` (사용자 지시: 지속 체크포인트).

## 프로젝트 정체

- **이름**: project-auto-wizard / GitHub `Twin-Fang/project-auto-wizard` / npm `project-auto-wizard` / 실행 `npx project-auto-wizard`
- 오픈소스 공모전 제출용. SUH-DEVOPS-TEMPLATE(projectops)의 슬림 파생 — 3축: ①npx 마법사(9타입+멀티+모노레포) ②payload 워크플로우 ③버전/체인지로그 Python 백엔드
- 복사 원본($SRC): `E:\github\SUH-DEVOPS-TEMPLATE` (읽기 전용 참조)

## WP 진행 상황 (플랜 20 Task → 9 WP)

| WP | Task | 상태 | 커밋 |
|---|---|---|---|
| WP1 스캐폴드 | 1 | ✅ 완료 | 9f44248 |
| WP2 version_manager.py | 2-4 | ✅ 완료 (리뷰 2회전 승인) | ff89c29, 365c176, c47c5c6, e5359bb |
| WP3 changelog_manager.py | 5-6 | ✅ 완료 (리뷰 2회전 승인) | 79e2df3, 507b14a, edec49c, de24f2f |
| WP4 common 워크플로우 | 7-9 | 🔄 **수정 중** | 9017d4f, da3c65c, 365092f + 수정 커밋 예정 |
| WP5 타입별 워크플로우+템플릿 | 10-11 | ⬜ 대기 | |
| WP6 src 선별복사+assets 수술 | 12 | ⬜ 대기 | |
| WP7 마법사 신기능 | 13-17 | ⬜ 대기 | |
| WP8 도그푸딩+README | 18-19 | ⬜ 대기 (NPM-PUBLISH는 선반영됨) | 69167cd |
| WP9 E2E+최종리뷰+push | 20 | ⬜ 대기 | |

**테스트 현황**: python 51 (47+4 env-skip, `python -m unittest discover -s tests/py`), node 14 (`npm run test:node`). sh 등가성은 `PROJECTOPS_SH_REF=<$SRC의 version_manager.sh>` 설정 시 4개 추가 실행 — 실측 통과 이력 있음.

## WP4 수정 중인 내용 (재개 시 최우선 확인)

품질 리뷰(운영 관점)에서 Important 5 + Minor 8 발견, 구현 에이전트가 수정 중이었음. 커밋 `fix(payload): workflow failure-recovery + operational hardening`이 push됐는지 확인:
- **I1**: RELEASE-PUBLISH tag-exists 가드가 release 복구 차단 → `gh release view` 추가 체크
- **I2**: README-VERSION-UPDATE 버전 빈값 가드 누락
- **I3**: re-run 시 이중 increment → confirm 커밋 패턴 idempotency 가드
- **I4**: squash-only 레포에서 automerge 실패 → allow_merge_commit 진단+명확한 에러
- **I5**: fork PR 가드 (`head.repo.full_name == github.repository`)
- M1~M8: sed 이스케이프, 키 grep 스코프, README 부재 skip, dead workflow_dispatch 제거, printf, 테스트 placeholder-strip 등

수정 커밋이 없으면 위 목록대로 다시 수정 → 리뷰어 재검 → WP5 진행.

## 미해결 이슈: npm 이름 선점 실패 (사용자 액션 필요)

- NPM_TOKEN secret은 Twin-Fang/project-auto-wizard에 등록 완료.
- CI `NPM-PUBLISH` 실행 → **npm error E404 PUT https://registry.npmjs.org/project-auto-wizard** = 토큰이 **신규 패키지 생성 권한 없음** (Granular token은 기본이 기존 패키지 scope — "Read and write" + **"All packages" 또는 신규 생성 허용** 필요).
- 로컬 whoami도 401/{} — 같은 원인.
- **해결**: npmjs.com → Access Tokens → Granular token 재발급 시 Packages and scopes: **Read and write, All packages** (또는 Classic Automation token) → secret 갱신(`github_cli.py secrets set Twin-Fang project-auto-wizard NPM_TOKEN`, 값은 env `SECRET_VALUE`) → Actions에서 NPM-PUBLISH re-run → 0.1.0 선점.

## 핵심 계약 (구현 시 불변)

- payload 스크립트: stdlib only, stdout 마지막 줄=값(`| tail -n 1`), 릴리스 절대 안 막힘(ai-summary always exit 0)
- ai-summary 엔진 체인: AI_API_KEY → GitHub Models(GITHUB_TOKEN, `models: read`) → 3단 규칙 fallback. update-from-summary 입력 채널 = cwd의 `pr_body.md` + env(VERSION 등)
- 릴리스 머지 감지 패턴: 머지 커밋 subject `chore(release): vX.Y.Z (PR #N)` — AUTO-CHANGELOG(생산) / VERSION-CONTROL(skip) / RELEASE-PUBLISH(진행) 3파일 동기 유지
- 브랜치: `{{MAIN_BRANCH}}` / `{{DEVELOP_BRANCH}}` placeholder만. 봇 커밋 `[skip ci]`
- automerge 토큰: `secrets.WORKFLOW_PAT || github.token` (GITHUB_TOKEN 머지는 후속 워크플로우 미트리거 — README에 WORKFLOW_PAT 문서화 필요, WP8)
- 브랜치 모드: `metadata.template.branches.mode` = pr-flow(3종 설치) / trunk-based(RELEASE-PUBLISH 단독)
- CodeRabbit opt-in: `metadata.template.options.coderabbit`, 기본 false, PR body 폴링 30s×10

## 재개 절차

1. `cd E:\github\project-auto-wizard && git pull && npm test` — 그린 확인
2. WP4 수정 커밋 존재 확인 (위 섹션) → 없으면 수정부터
3. `docs/IMPLEMENTATION-PLAN.md`의 Task 10부터 순서대로 WP5→WP9 (각 Task 상세 스텝·코드·테스트 전부 플랜에 있음)
4. WP9 마지막: 실제 테스트 레포 실기 검증 (플랜 Task 20 Step 4-5)
