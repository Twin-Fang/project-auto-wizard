# HANDOFF — 진행 상황 및 재개 가이드 (2026-07-09 갱신)

> 다른 머신/세션에서 이어서 작업할 때 이 문서 + `docs/DESIGN-SPEC.md`(승인된 설계 명세) + `docs/IMPLEMENTATION-PLAN.md`(20 Task 구현 계획)를 먼저 읽는다.
> 커밋: Conventional Commits(영문), Claude/AI 흔적(Co-Authored-By 등) **절대 금지**. 모든 커밋 후 `git pull --rebase origin main && git push origin main` (도그푸딩된 VERSION-CONTROL이 push마다 봇 커밋을 만들므로 rebase 필수).

## 프로젝트 정체

- **이름**: project-auto-wizard / GitHub `Twin-Fang/project-auto-wizard` / npm `project-auto-wizard` / 실행 `npx project-auto-wizard`
- 오픈소스 공모전 제출용. SUH-DEVOPS-TEMPLATE(projectops)의 슬림 파생 — 3축: ①npx 마법사(9타입+멀티+모노레포) ②payload 워크플로우 ③버전/체인지로그 Python 백엔드
- 복사 원본($SRC): `D:\0-suh\project\suh-github-template` (읽기 전용 참조. 구 문서의 `E:\github\SUH-DEVOPS-TEMPLATE`는 이 경로로 이전됨)

## WP 진행 상황 — 구현 전부 완료 ✅

| WP | Task | 상태 |
|---|---|---|
| WP1 스캐폴드 | 1 | ✅ |
| WP2 version_manager.py | 2-4 | ✅ |
| WP3 changelog_manager.py | 5-6 | ✅ |
| WP4 common 워크플로우 | 7-9 | ✅ (I1~I5 + M1~M8 반영 확인) |
| WP5 타입별 워크플로우+템플릿 | 10-11 | ✅ 9eb6c55, 113a550 |
| WP6 src 선별복사+assets 수술 | 12 | ✅ 90e43bf (+오염정리 d4731b9) |
| WP7 마법사 신기능 | 13-17 | ✅ a855ecb, 99ff823, 06ab2dc, 0f27adf, 1e61488 |
| WP8 도그푸딩+README | 18-19 | ✅ 35ebba2, 615033c |
| WP9 E2E+revert+실기검증 | 20 | ✅ 1a28abc + **PR #1 풀사이클 실측 성공** |

**테스트 현황**: python 52 (OK, 4 env-skip — `python -m unittest discover -s tests/py`), node 59 (`npm run test:node`, e2e 매트릭스 15개 포함).

## 실측 완료된 것 (2026-07-09, PR #1)

- 마법사 → 자기 레포 도그푸딩 설치(pr-flow, develop 자동 생성+push) ✅
- develop→main 릴리스 PR → **AUTO-CHANGELOG(버전확정 0.1.3 + 요약 + CHANGELOG 커밋) → automerge(WORKFLOW_PAT) → RELEASE-PUBLISH(tag v0.1.3 + GitHub Release) → README-VERSION-UPDATE** 전부 success ✅
- **graceful degradation 실전 검증**: GitHub Models 403 → 규칙 fallback이 카테고리 분류된 릴리스 노트 생성, 릴리스 안 막힘 ✅ (플랜 Task 20 Step 5의 fallback 검증을 실전으로 커버)
- 실측에서 발견·수정한 버그: `changelog_manager.py update-from-summary`가 비정형 CHANGELOG.json(`{"versions": []}`)에서 KeyError → setdefault 방어 + 회귀 테스트 (f0884e6)

## 남은 항목 (사용자 액션 / 게시 전)

1. **npm 이름 선점 — NPM_TOKEN 권한** (기존 이슈): 현 토큰은 신규 패키지 생성 권한 없음(E404). npmjs.com → Granular token 재발급(Read/write, **All packages**) 또는 Classic Automation token → `github_cli.py secrets set Twin-Fang project-auto-wizard NPM_TOKEN`(값은 env `SECRET_VALUE`) → NPM-PUBLISH re-run. **현재 버전은 v0.1.3이므로 선점도 0.1.3으로 됨.**
2. **GitHub Models 403 원인 확인**: job 권한에 `Models: read`는 부여됐는데 `models.github.ai` 호출이 403. Twin-Fang **org 설정에서 GitHub Models 활성화** 여부 확인 필요(Settings → Models). 활성화 후 릴리스 1회 재실측하면 AI 요약 경로 검증 완료.
3. **데모 자산**: README의 30초 GIF + 3분 YouTube 링크 TODO 채우기 (스펙 §6 시나리오 참조).
4. WORKFLOW_PAT은 등록 완료(automerge 후속 트리거용, 실측 통과).

## 핵심 계약 (구현 시 불변 — 요약)

- payload 스크립트: stdlib only, stdout 마지막 줄=값(`| tail -n 1`), 릴리스 절대 안 막힘(ai-summary always exit 0)
- ai-summary 엔진 체인: CodeRabbit(opt-in) → AI_API_KEY → GitHub Models → 3단 규칙 fallback. 입력 = cwd `pr_body.md` + env
- 릴리스 머지 감지: 머지 커밋 subject `chore(release): vX.Y.Z (PR #N)` — 3파일 동기 유지
- 브랜치: `{{MAIN_BRANCH}}`/`{{DEVELOP_BRANCH}}` placeholder → 설치 시 `src/core/branding.js` 치환. 봇 커밋 `[skip ci]`
- payload 단일 진실: 설치 자산은 전부 `payload/` (버전 레이아웃 = `payload/version.yml.template`)
- 브랜치 모드: `metadata.template.branches.mode` = pr-flow(3종) / trunk-based(RELEASE-PUBLISH 단독)
- revert 모드: payload에 존재하는 파일명 일치분만 제거 (사용자 파일·version.yml 보존)
