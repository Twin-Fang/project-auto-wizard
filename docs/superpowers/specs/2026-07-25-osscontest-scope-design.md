# 오픈소스 개발자대회 제출 범위 — 브레인스토밍 결과

- 날짜: 2026-07-25
- 상태: 브레인스토밍 완료 (사용자 승인 대기 — 코드 구현 착수 전)
- 범위: `Twin-Fang/project-auto-wizard` 오픈소스 개발자대회(osscontest.kr) 제출을 위한 기능/문서 범위 결정
- 참고: 이 문서는 **범위 결정 스펙**이다. 실제 구현 순서/작업 단위는 별도 `writing-plans` 세션에서 다룬다.

## 1. 배경 — 확인된 심사기준

출처: 제10회 공개SW개발자대회(주관 NIPA+한국오픈소스협회, `osscontest.kr`의 전신 대회) 공개 심사기준 자료. **2026년 정확한 배점은 오리엔테이션에서 별도 공지되므로 이 수치는 방증(proxy)이며 최종 확인이 필요하다** (§7 참조).

| 단계 | 기준 | 배점 |
|---|---|---|
| 1차 서면 (20) | 코딩의 적절성 및 구조의 합리성 | 5 |
| | 코드의 완성도 및 시연가능성 | 5 |
| | 개발 문서의 구체성 | 5 |
| | 프로젝트 수준 | 5 |
| 2차 시연 (80) | **커뮤니티로 발전가능성** | **20** |
| | **작품 데모** | **20** |
| | 독창성 | 15 |
| | 작품 발표 | 10 |
| | 공개SW 활용성 | 10 |
| | 기능테스트 결과 | 5 |
| | (공개SW 라이선스 검증) | 참고자료(결격 판단) |

→ "커뮤니티로 발전가능성"과 "작품 데모"가 합산 40점(전체의 40%)으로 최고 배점. 이번 스코프 결정은 이 두 항목 중 **작품 데모/발표(30점)는 이번 세션 범위에서 제외**하고, **커뮤니티 발전가능성(20점)**과 **1차 심사 20점 전체**에 잔여 리소스를 집중하는 방향으로 정했다.

## 2. 현재 구현 상태 요약 (코드 딥다이브 결과)

- WP1~9 전체 구현 완료, v0.1.5, npm 정상 퍼블리시 확인(`npm view project-auto-wizard version` → 0.1.5), 자기 레포 도그푸딩 풀사이클 실측 검증 완료(PR #1).
- 3축: ①npx 마법사(9타입+멀티+모노레포) ②GitHub-native AI 릴리스 자동화(API 키 0개, 4단 엔진체인) ③타입별 CI/CD 워크플로우.
- 의존성 0개(zero-dependency) — 라이선스 리스크 최소화에 유리한 특성.
- 테스트: Python 52 + Node 59 (E2E 매트릭스 포함).
- **표면 문서(README/HANDOFF)에 드러나지 않은 완성된 기능들**:
  - `wizard-env.js`: YAML 파서 없이 라인 단위 안전 토큰 치환 + `isUnchanged()` 기반 사용자 수정 파일 보호.
  - `wizard-labels.js` + `payload/config/wizard-prompts.yml`: 질문 문구를 사용자가 YAML로 재정의 가능한 커스터마이징 시스템. **README에 전혀 언급 없음 — 문서화 갭.**
  - `breaking-check.js`/`breaking.js`: 원격 우선(3초 타임아웃) `breaking-changes.json` fetch + 버전 범위 비교 + critical/warning 표시. **메커니즘은 완성됐지만 `breaking-changes.json`이 빈 파일(`{}`)이라 사실상 죽어있음.**
  - Flutter 8종, Spring 무중단배포 2종 등 타입별 워크플로우가 README 표가 시사하는 것보다 훨씬 두터움.
- **테스트 커버리지 공백**: `breaking-check.js`, `wizard-labels.js`, `wizard-env.js`에 전용 테스트 파일 없음 (tests/node에 7개 파일 중 미포함).
- **커뮤니티 거버넌스 파일 전무**: CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md, ROADMAP.md, 이슈/PR 템플릿 없음. GitHub 스타/포크 0.
- **TODO/FIXME 등 미완성 스텁 없음** — 코드베이스는 깨끗함.

## 3. 스코프 — 포함 (In)

### 3.1 커뮤니티 발전가능성 (2차 심사 20점, 최우선)

**A. GitHub 표준 거버넌스/커뮤니티 파일 (신규 작성)**

| 파일 | 내용 |
|---|---|
| `CONTRIBUTING.md` | 개발 환경 셋업, `npm test` 실행법, PR 규칙, 코드 스타일 |
| `CODE_OF_CONDUCT.md` | Contributor Covenant 표준 채택 |
| `SECURITY.md` | 취약점 신고 절차 |
| `.github/ISSUE_TEMPLATE/*.yml` | bug_report, feature_request + config.yml |
| `.github/PULL_REQUEST_TEMPLATE.md` | PR 체크리스트 |
| `ROADMAP.md` | v1.0 목표, 향후 방향 — 커뮤니티가 참여할 자리를 보여주는 문서 |

레포 설정: GitHub Discussions 활성화, Topics 등록(`devops`, `cli`, `github-actions`, `changelog-automation` 등), About 섹션·소셜 미리보기 정비.

> 기존 설계 원칙("커스텀 라벨 체계 전부 제외")과 충돌 없음 — `good first issue`는 GitHub 기본 제공 라벨.

**B. 실사용 트랙션 확보**

- "저자 외 실사용" 사례 최소 2~3개 확보 (본인의 다른 사이드 프로젝트에 실제 설치) → README에 **"Used by"** 섹션으로 링크 노출.
- 외부 홍보(GeekNews·OKKY·velog/dev.to·X 등)로 실제 스타/이슈 유입 시도.
- README에 npm 다운로드·GitHub 스타 배지 노출.
- (선택, 시간 소요 크지만 임팩트 최대) 타 오픈소스 프로젝트에 실제 채택 시도.

**C. 기여 유도용 이슈**

- `good first issue` 라벨을 붙인 초보자 친화 이슈 5~10개 사전 등록 (새 마커 감지 케이스, 오탈자, 테스트 보강 등).

### 3.2 1차 심사 보강 (20점 안전마진)

| 기준 | 액션 |
|---|---|
| 코딩 적절성/구조 합리성, 코드 완성도 | `breaking-check.js`/`wizard-labels.js`/`wizard-env.js` 테스트 커버리지 공백 메우기. 커버리지 리포트 배지화 |
| 개발 문서의 구체성 | README에 `wizard-prompts.yml` 커스터마이징 기능 문서화(이미 있는데 미문서화된 기능 — 저비용 고가치), 타입별 지원 표에 Flutter/Spring 실제 깊이 반영, `revert` 모드 동작 상세 문서화 |
| 프로젝트 수준 | 액션 불필요 (이미 README에 충분히 반영) |

**라이선스 검증 사전 준비**: 의존성 0개이므로 리스크가 낮으나, `license-checker`(npm)/`pip-licenses`(python) 스캔 리포트를 사전 생성해 "깨끗한 리포트" 한 장을 첨부용으로 준비. 원본 `SUH-DEVOPS-TEMPLATE`(Cassiiopeia/projectops)에서 포팅한 코드가 본인 소유임을 확인해 라이선스 충돌 없음을 명시.

**미해결 기술 부채**: HANDOFF.md에 남아있던 GitHub Models 403 이슈 실제 해결 여부 확인 — AI 엔진 체인이 실제 동작함을 증명.

### 3.3 신규 기능 4종

#### ① 자동 semver 승격 (major/minor/patch)

- **배경**: 현재 릴리스는 항상 patch+1.
- **⚠️ 정정(2026-07-26)**: 최초 스펙 작성 시 이 기능을 `breaking-check.js`/`breaking-changes.json` 인프라와 연결지었으나 **오판이었음**. `breaking-changes.json`은 project-auto-wizard **마법사 자체의 템플릿 버전**(사용자가 마법사를 재실행해 업데이트할 때, 이전 설치 버전과 새 마법사 버전 사이의 호환성 파괴를 경고하는 용도) 호환성을 추적하는 파일이며, `BC_URL`도 `Twin-Fang/project-auto-wizard` 저장소를 가리킨다. **사용자 프로젝트 자체의 릴리스 버전(이 기능이 다루는 축)과는 완전히 무관** — 이 기능은 `breaking-changes.json`을 전혀 건드리지 않는다. 마법사 자체 템플릿 버전 축은 이번 스코프에서 손대지 않는다(사용자 명시 요청).
- **승격 폭 결정 방식(리서치 근거)**: semantic-release/release-please/Conventional Commits 공식 스펙(v1.0.0 조항 13) 조사 결과, `!` 마커 단독 감지는 "표준이 허용하는 부분집합"이며 표준 위반이 아님을 확인. 다만 커밋 본문(`BREAKING CHANGE:` footer)은 현재 `git log --pretty=%s`(제목만 수집)로는 접근 불가하고, 이를 지원하려면 커밋 수집·파싱 구조 전체를 다줄 처리로 재설계해야 하는 큰 변경이라 **이번 스코프에서는 제외**.
  - `feat:` 커밋 포함 → **minor**
  - 타입 뒤 `!` 마커(`feat!:`, `fix!:`, `chore!:` 등, 어떤 타입이든) 포함 → **major**
  - 그 외 → **patch** (매칭 실패 시에도 안전하게 patch 유지)
  - 기존 `changelog_manager.py`의 3단 규칙 파서(projectops 컨벤션 → Conventional Commits → 무형식)와 별도로, 승격 폭만 판단하는 경량 분류 함수를 신설(`classify_commits`의 반환 계약은 그대로 둠 — 기존 소비처 영향 없음).
- **애매한 커밋에 대한 AI 보조판단(상한 minor)**: 규칙 분류 결과가 patch이고 미분류(자유형식) 커밋이 존재할 때만, 기존 AI 엔진 체인(사용자 API 키 → GitHub Models)에 단답형 프롬프트("사용자 대상 새 기능으로 보이면 정확히 `MINOR`, 아니면 정확히 `PATCH`만 답하라")를 보내 patch→minor 업그레이드 여부만 보조 판단. **AI는 절대 major를 만들 수 없다** — major는 항상 명시적 `!` 마커만 신뢰. AI 응답이 모호하거나 호출 실패 시 무조건 규칙 결과(patch) 유지 — 기존 graceful degradation 철학과 동일.
- **기본값**: **ON**. 마법사가 설치/업데이트 시 "자동 버전 승격을 사용하시겠습니까?" 질문을 추가하고, 응답을 `version.yml`의 `metadata.template.options`에 저장해 재질문 없이 유지. 기존 사용자에게 동작 변경이 있을 수 있음을 마법사 완료 요약에서 안내.
- **적용 위치**: `.github/scripts/version_manager.py`(승격 폭 반영) + `.github/scripts/changelog_manager.py`(분류 함수 + AI 보조판단 서브커맨드 신설) + `PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml`(분류 결과 연동). **`breaking-changes.json`/`breaking-check.js`는 건드리지 않음.**

#### ② `doctor` 환경 진단 명령

- **배경**: 온보딩 실패(권한 누락 등)로 이탈하는 사용자를 줄여 "실사용 트랙션" 목표에 직결.
- **동작**: `npx project-auto-wizard doctor` 단독 실행. 점검 항목 — `GITHUB_TOKEN`/`WORKFLOW_PAT` 존재 및 scope(`repo`, `workflow`), GitHub Models 조직 활성화 여부, Repo Settings의 Workflow permissions(Read/write), 브랜치 보호 규칙과 automerge 충돌 여부.
- **실행 시점**: **독립 명령으로만 동작** — 기존 마법사 흐름(`full`/`interactive`)에는 자동으로 끼워 넣지 않아 복잡도를 낮게 유지.
- **출력**: 항목별 OK/WARN/FAIL + 각 실패 항목에 대한 해결 가이드 링크(README 앵커).

#### ③ `status` 설치 상태 확인 명령

- **배경**: 이미 구현된 `isUnchanged()` 드리프트 감지 로직을 새 커맨드로 재노출하는 저비용·고가치 기능.
- **동작**: `npx project-auto-wizard status`. `version.yml`에서 현재 설치된 버전/타입/브랜치 모드/옵션(nexus, secret-backup, coderabbit, semver-auto)을 요약하고, `isUnchanged()`를 각 설치 파일에 재적용해 "사용자가 수동으로 수정한 파일" 목록을 표시.
- **네트워크 접근**: 로컬 파일 비교만 수행(오프라인). 최신 릴리스 정보 등 원격 조회는 포함하지 않음 — "네트워크 접근 0" 설계 원칙과의 일관성 유지(단, `breaking-check.js`는 이미 원격 fetch 선례가 있으므로 추후 필요 시 확장 여지는 남겨둠).

#### ④ `--dry-run` 미리보기 모드

- **배경**: 실제 파일 변경 전에 무엇이 바뀔지 보여주는 안전장치. 기존 충돌 3지선(유지/백업후교체/참고본추가) 로직과 자연스럽게 연결.
- **적용 범위**: **`full`/`version`/`workflows`/`revert` 4가지 모드 전체**에 일관 적용 — 모드별로 다르게 동작하면 예측 가능성이 떨어지므로 통일.
- **출력**: 생성/수정/삭제될 파일 목록 + 각 파일의 충돌 판정 결과(신규/동일/충돌)를 표시하고 실제 쓰기는 수행하지 않음.

### 3.4 AI 기능 확장 (2026-07-26 세션 추가 — "AI 요소 부족" 피드백 대응)

**배경**: 팀원 피드백 — 지금 AI가 하는 일은 릴리스 노트 텍스트 생성 하나뿐(커밋 제목만 프롬프트에 넣는 단발 LLM 호출). CodeRabbit(opt-in)에 대한 실질적 의존도 낮추고 싶다는 요구와 함께 검토.

#### ⑤ 자체 PR 요약봇 (신규 워크플로우, CodeRabbit과 상호 배타적)

- **신규 파일**: `payload/workflows/common/PROJECT-COMMON-AI-PR-SUMMARY.yaml`. 트리거: `pull_request: [opened, synchronize, reopened]`, `branches: ["{{MAIN_BRANCH}}"]` — default 브랜치를 향하는 모든 PR(pr-flow에서는 사실상 릴리스 PR만, trunk-based에서는 모든 feature PR).
- **CodeRabbit과 택1 강제**: 새 config를 추가하지 않고 **기존 `coderabbit` 옵션을 그대로 XOR 스위치로 재사용**한다. 워크플로우 자체가 `metadata.template.options.coderabbit` 값을 읽어 `true`면 즉시 종료(no-op), `false`(기본값)면 자체 봇이 동작. 동일 PR에 CodeRabbit 코멘트와 자체 AI 코멘트가 동시에 달리는 충돌을 원천 차단.
- **동작**: 커밋 목록 + `git diff --stat`(최대 50줄 캡)을 모아 `changelog_manager.py ai-summary`(§3.4⑥ 확장판) 호출 → `🤖 AI Summary (project-auto-wizard)` 헤더를 붙여 PR 코멘트로 게시. CodeRabbit 코멘트와 시각적으로 구분.
- **릴리스 PR과의 관계**: 체인지로그 생성 단계(AUTO-CHANGELOG-CONTROL)와 **통합하지 않고 완전히 독립적으로 동작**한다. 릴리스 PR에서는 LLM 호출이 최대 2회(요약봇 1회 + 체인지로그용 1회) 발생할 수 있으나, GitHub Models가 무료라 비용 문제 없음. 구현 단순성을 우선.
- **실패 처리**: AI 호출 실패 시 규칙 기반 폴백 요약을 그대로 코멘트로 게시(코멘트는 항상 달림, 품질만 낮아짐). 코멘트 게시 자체가 실패해도 워크플로우는 계속 진행(PR을 막지 않음).

#### ⑥ AI 프롬프트 입력 확장 (`git diff --stat`)

- `_build_ai_prompt()`에 diff-stat 텍스트를 선택 인자로 추가, `cmd_ai_summary`가 `--diff-stat-file` 옵션을 새로 받도록 확장. 기존에 "토큰 폭발 대비 이득 없음"으로 의도적으로 제외했던 부분(`docs/BRAINSTORMING.md`)이나, 파일별 변경 라인 수만(본문 제외) 넣는 수준이라 토큰 비용은 거의 안 늘면서 커밋 제목만 볼 때보다 훨씬 풍부한 컨텍스트를 제공.
- ⑤(PR 요약봇)과 기존 체인지로그 생성 양쪽에서 **공용 재사용** — 릴리스 노트 품질도 함께 개선됨.

## 4. 스코프 — 제외 (Out, 이번 세션 결정)

- 신규 프로젝트 타입 확장(Go/Rust/Django/Docker 등) — 답변: "현행 유지, 깊이에 집중".
- 기존 유사 도구(semantic-release/changesets/release-please) 대비 명시적 비교표/벤치마크 자료 제작 — 답변: "현재 스토리로 충분".
- 데모 영상/PT 발표자료 제작(작품 발표 10점 + 작품 데모 20점, 합산 30점) — 답변: "제외, 별도 세션".
- 사용자 정의 프로젝트 타입 플러그인 시스템(완전 신규 확장 아키텍처) — 타입 확장 자체를 보류했으므로 함께 보류.
- **`infra-automation`(Chuseok22/infra-automation) 흡수/병합 — 검토 후 기각**. Docker Compose 기반 로컬 DB(PostgreSQL/MongoDB/Redis) 컨테이너 자동화 CLI로, 별도 npm 패키지(`@chuseok22/infra-automation`)·자체 커뮤니티 파일(이슈템플릿·라벨·릴리스)을 갖춘 독립 완성 프로젝트. 기각 사유:
  - **문제 영역 불일치**: project-auto-wizard는 "레포 생성 이후 CI/CD·버전관리·릴리스"를 파일만 심는 선언적 도구(네트워크 접근 0 설계 원칙)인 반면, infra-automation은 Docker daemon과 실시간 상호작용하는 런타임 도구 — 실행 모델 자체가 다름.
  - **기술 스택 불일치**: project-auto-wizard는 "의존성 0개(Node+Python stdlib)"가 독창성 포인트인데 infra-automation은 TypeScript+의존성 기반이라 병합 시 구조적 모순 발생.
  - **피치 희석**: 15분 PT에서 "이 프로젝트가 정확히 뭘 하는가"를 한 문장으로 설명해야 하는데 서로 다른 두 도메인을 합치면 설득력이 떨어짐. 기존 `docs/BRAINSTORMING.md`의 "의도적 스코프 컷" 결정(SUH-DEVOPS-TEMPLATE에서 무관 기능 제거)과도 배치.
  - **대안**: 코드 병합 없이 완전히 별개로 유지. (README 상호 언급이나 별개 출품작 제출 등 경량 대안도 검토했으나 이번 세션에서는 결정 보류 — 필요 시 별도 논의)
- **`doctor` 명령의 AI 진단(실패 워크플로우 로그를 AI가 읽고 자연어로 원인 설명) — 검토 후 기각**. `doctor`는 사용자 **로컬 머신**에서 실행되는 명령이라 GitHub Actions와 달리 Python이 로컬에 없을 수 있어 `changelog_manager.py`의 AI 호출 로직을 재사용하기 어렵고, JS 쪽에 별도의 OpenAI 호환 호출 함수를 하나 더 두어야 해 언어 간 로직 중복이 생김. 복잡도 대비 이득이 낮다고 판단해 제외. **규칙 기반 `doctor` 명령(§3.3②, GITHUB_TOKEN/WORKFLOW_PAT/Workflow permissions 점검) 자체는 그대로 스코프에 유지** — 빠진 건 AI 진단 부분뿐.

## 5. 사용자 확인 필요 사항 (대회 측 — 이 세션에서 확정 불가)

- 2026년 정확한 심사기준/배점 — 오리엔테이션 공지에서 재확인 (현재는 명칭 변경 전 대회의 방증 자료).
- 참가 부문(학생/일반), 자유과제 접수 여부.
- **최종 제출 마감일**(소스코드+시연영상 제출 시점 — 접수 마감 2026-07-17과는 별개일 가능성 높음).
- 제출 서류 양식(결과보고서 hwp/ppt 등) — 확정되면 §3.2의 "개발 문서의 구체성" 대응 방식이 달라질 수 있음(예: 별도 결과보고서 신규 작성 필요).

## 6. 실행 우선순위 제안

1. **커뮤니티 거버넌스 파일 + README 문서화 갭 메우기** — 코드 변경 없이 가장 빠르게 점수에 반영 가능.
2. **신규 기능 구현** — ②doctor·③status(저비용, 기존 인프라 재사용) 먼저, ④dry-run, ⑥prompt 확장(diff --stat, 독립적으로 먼저 넣어두면 ①·⑤가 그 위에 올라탐), ⑤AI PR 요약봇, ①자동 semver 승격(AI 보조판단 포함, 가장 리스크 큰 동작 변경이라 마지막에 충분히 테스트하며 진행) 순서 권장.
3. **테스트 커버리지 공백 메우기 + 라이선스 리포트 준비** — 신규 기능 구현과 병행 가능.
4. **실사용 트랙션 확보 활동** — 코드 작업과 무관하게 상시 진행(다른 프로젝트 설치, 외부 홍보).
5. **대회 요강 최종 확인** — 사용자 액션, 최대한 빨리 확인해 §3.2 문서 요건 리스크 해소.

## 7. 리스크 및 미결정 사항

- 심사기준 수치는 방증 자료 — 실제 배점과 다를 수 있음.
- 자동 semver 승격 기본값 ON이 기존 (가상의) 사용자 워크플로우에 예상치 못한 major 승격을 유발할 가능성 — 마법사 안내 문구로 완화하되, 실제 구현 시 커밋 분류 정확도 테스트가 중요.
- "저자 외 실사용 사례"·"외부 홍보를 통한 실제 트랙션"은 구현 항목이 아니라 활동성 항목이라 코드 스펙만으로 완결되지 않음 — 별도 액션 트래킹 필요.
- ⑤AI PR 요약봇과 체인지로그 생성이 릴리스 PR에서 LLM을 최대 2회 호출하는 중복이 있음 — 비용은 무료 티어라 문제없지만, 두 호출 결과가 미묘하게 다른 톤으로 보일 수 있다는 점은 감안.
- ①자동 semver 승격의 AI 보조판단(patch→minor)은 단답형 프롬프트·엄격 파싱으로 설계했지만, 실제 구현 시 AI가 형식을 안 지키는 응답을 반환할 가능성에 대비한 방어적 파싱(정확히 `MINOR`/`PATCH`가 아니면 무조건 규칙 결과 유지)이 반드시 필요 — 구현 단계에서 빠뜨리기 쉬운 지점이라 명시.
