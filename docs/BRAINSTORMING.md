# BRAINSTORMING — 설계 결정 과정 기록 (2026-07-08)

> `DESIGN-SPEC.md`(확정 명세)가 나오기까지의 질문-결정 흐름. 각 결정의 **왜**를 남긴다.
> 이후 방향 변경 시 이 문서의 근거를 먼저 확인할 것.

## 출발점

- 원본: SUH-DEVOPS-TEMPLATE (Cassiiopeia/projectops) v4.0.4 — 기능이 너무 많음
- 목표: **오픈소스 공모전 제출용** 새 레포. 주요 기능만 노출. `npx` 한 줄 마법사가 주인공
- 데모 3분 유튜브 영상 필수. 심사위원에게 "개발 좀 치는 사람들" 인상이 목표

## 결정 트레일 (Q → A → 근거)

### 1. 제출물 정체 → 기존 레포 슬림 파생
fork 아님 — **새 레포 신규 생성**, 검증된 코드만 선별 복사, git 히스토리 새로 시작. (사용자: "굳이 fork하기 싫어")

### 2. 남길 범위 → 3축
npx 마법사 + GitHub Actions 워크플로우 + 버전/체인지로그 자동화. **Agent Skills 25종 완전 제거** (`skills/`, `.claude-plugin/` 등 전부). 대회 범위 명확화.

### 3. 프로젝트 타입 → 전 타입 유지 (9종+멀티+모노레포)
"모든 프로젝트 지원"이 핵심 셀링포인트라 축소 안 함.

### 4. 템플릿 레포 정체성 → 완전 제거
"Use this template" 경로·initializer·integrator sh/ps1 전부 삭제. **배포 경로는 npx CLI 유일.**
효과: 원본의 "템플릿 레포 + 배포원" 2중 정체성 관리(3곳 동기화 함정)가 **payload/ 단일 진실**로 소멸.

### 5. 체인지로그 AI → CodeRabbit 의존 제거, 4단 엔진 체인
- 사용자 요구: 돈 안 쓰는 옵션 필수, "GitHub 기본 제공 기능 없나?"
- 조사 결과: **GitHub Models** (`models.github.ai`) — Actions에서 `GITHUB_TOKEN` + `permissions: models: read`만으로 무료 호출 (rate limit 있음). 검증 완료(실제 공식 기능).
- 체인 확정: **CodeRabbit(opt-in, 기본 false, PR 폴링 30s×10=5분) → AI_API_KEY(사용자 지정) → GitHub Models(기본) → 3단 규칙 fallback**
- fallback 3단: projectops 컨벤션(`제목 : feat : 내용`) → Conventional Commits → 무형식 bullet 나열. 커밋 컨벤션 보장 없어도 **릴리스 절대 안 막힘**.
- 2·3순위는 단일 코드 경로 (OpenAI-호환 chat completions + `AI_API_BASE_URL`/`AI_MODEL` env).
- 포지셔닝 문구: **"GitHub-native AI Release Automation"** — "무료 AI changelog"보다 세게.

### 6. 릴리스 발행 → tag + GitHub Release + CHANGELOG 3종 동기화
GitHub 표준 기능 활용: `gh release create --notes-file` + `generate-notes` API(비교링크·PR목록)를 AI 요약 밑에 결합. `--generate-notes` 플래그 조합은 gh 버전별 거동 차이로 API 2-step으로 고정.

### 7. 브랜치 → 마법사가 질문 (하드코딩 제거)
- 근거: `on: push: branches:`는 YAML 정적 값 — develop 하드코딩이면 dev/staging/trunk 팀은 CI 무반응.
- 질문 2개: 릴리스 브랜치(기본=감지된 default) + 개발 브랜치(기본 develop). **없으면 생성+push** (대화형은 확인 질문, `--force`는 자동).
- payload에 `{{MAIN_BRANCH}}`/`{{DEVELOP_BRANCH}}` placeholder → 설치 시 치환. `version.yml` `metadata.template.branches`에 저장(업데이트 모드 재사용).
- **모드 분기**: pr-flow(VERSION-CONTROL+AUTO-CHANGELOG+RELEASE-PUBLISH 3종) / trunk-based(개발=릴리스 동일 → **RELEASE-PUBLISH 단독**, bump→changelog→tag→Release를 한 job 순차 처리, `[skip ci]` 루프 가드).

### 8. sh → py 전면 전환
사용자: "sh는 윈도우에서 테스트하기 그렇다, 속도 안 중요." ubuntu 러너 python3 기본 탑재. bash 3.2/BSD 크로스플랫폼 함정 통째 소멸. `version_manager.py`는 sh 등가 재작성 + 등가성 대조 테스트(실측 통과).

### 9. 라벨 → GitHub 기본만
원본의 한글 상태 라벨(작업전/작업중/작업완료…)은 비표준 — 상태는 Projects Status 필드가 정석. `SYNC-ISSUE-LABELS`·`PROJECTS-SYNC-MANAGER`(과커스텀) 제외. `good first issue`/`help wanted`는 공모전에서 기여자 유입 신호로 플러스.

### 10. 데모 3분 → 기본 기능만으로 감동
훅(20s) → `npx project-auto-wizard` 라이브(60s) → AI 릴리스 풀사이클: PR→AI changelog→automerge→tag+Release (80s) → 클로징(20s). **fallback 시연 제외** (사용자: "기본 기능으로 감동시켜야"). fallback·엔진체인은 README 설계 근거로만.

### 11. 이름 변천
`projectops-oss`(가칭) → `project-wizard` (npm 선점됨 — niraj_의 유사 용도 패키지 v1.1.0 실측 확인) → **`project-auto-wizard`** (npm 404 = 사용 가능 확인, GitHub `Twin-Fang/project-auto-wizard`).

## 심사위원 어필 포인트 6종 (README·발표 공통)

1. **API 키 0개 AI** — GitHub Models 네이티브 통합
2. **4단 엔진 체인 + graceful degradation** — 장애 설계 사고
3. 9타입+멀티+모노레포 **자동 감지** — 질문 최소화 = 제품 감각
4. **Node+Python만** — 크로스플랫폼 함정을 설계로 제거
5. **payload 단일 진실** 아키텍처
6. **표준 존중** — 기본 라벨·Projects·Releases·Conventional Commits

## 의도적 스코프 컷

- AI 프롬프트 입력 = 커밋 목록 + PR 제목까지. **diff 본문 제외** (토큰 폭발·rate limit 대비 이득 없음)
- 데모에서 fallback 시연 안 함
