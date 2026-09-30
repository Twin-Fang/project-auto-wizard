<!-- GitHub Issue: #134 | https://github.com/Twin-Fang/project-auto-wizard/issues/134 -->
🚀[기능개선][CICD] GitHub Models 종료 대응 — AI 요약·SemVer 보조 판정을 Copilot CLI로 교체

## 어떤 문제를 해결하고 싶으신가요?

**GitHub Models(`models.github.ai`)가 2026-07-30에 완전히 종료(retired)되었습니다.** 이 프로젝트는 PR/릴리스 요약과 SemVer 보조 판정의 두 번째 티어로 이를 사용하고 있어, 현재 다음 문제가 발생합니다.

- AI 요약 체인(`AI_API_KEY` → GitHub Models → rule-based fallback)의 두 번째 티어 호출이 실패하고, 코드는 예외를 경고로만 처리한 뒤 fallback으로 넘어갑니다. 즉 `AI_API_KEY`를 설정하지 않은 모든 사용자는 AI 요약 없이 규칙 기반 요약만 받습니다.
- SemVer 보조 판정(patch → minor 승격)도 같은 이유로 동작하지 않습니다. 규칙 기반 결과(major/minor/patch)는 영향이 없습니다.
- README는 여전히 "GitHub-native AI Release Automation, zero API keys"를 표방하고 있어 실제 동작과 어긋납니다.
- `AI_API_KEY` 티어의 기본값도 함께 죽어 있습니다. 키만 설정하고 `AI_API_BASE_URL`을 비우면 사용자의 키가 종료된 `models.github.ai`로 전송되어 실패합니다. 기본 모델명(`openai/gpt-4o-mini`)도 GitHub Models 전용 명명입니다.
- PR 코멘트 헤더가 엔진과 무관하게 "🤖 AI Summary (project-auto-wizard)"로 고정되어, fallback으로 만든 요약에도 AI라고 표시됩니다.

**대안 조사 결과 (2026-09 기준)**

- GitHub 자체 대안: Copilot CLI가 2026-07-02부터 Actions에서 `GITHUB_TOKEN`(`copilot-requests: write` 권한)만으로 인증됩니다. PAT나 별도 secret이 필요 없습니다. 다만 무료가 아니라 AI Credits를 소비합니다(개인 repo는 소유자의 Copilot 좌석, 조직 repo는 조직에 직접 과금되며 "Allow use of Copilot CLI billed to the organization" 정책이 필요).
- 외부 무료 API(Groq, Google AI Studio, Cerebras, OpenRouter 등)는 모두 사용자가 키를 발급해 secret으로 등록해야 합니다.
- Microsoft Foundry는 GitHub이 안내하는 이행 경로이지만 유료(종량제)입니다.

참고 자료:
- https://github.blog/changelog/2026-07-01-github-models-is-being-fully-retired-on-july-30-2026/
- https://github.blog/changelog/2026-07-30-github-models-is-now-retired/
- https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli-in-actions
- https://docs.github.com/en/copilot/concepts/agents/copilot-cli/copilot-cli-in-github-actions

## 제안하는 해결 방법

**핵심: GitHub Models 티어를 Copilot CLI로 교체하고, 기존 rule-based fallback은 그대로 유지합니다.** (provider 추상화 리팩터링은 하지 않는 최소 변경)

### 최종 설계

- **체인**: 사용자 `AI_API_KEY` → Copilot CLI → rule-based fallback
- **활성화(opt-in)**: 설치 마법사에서 Copilot 사용 여부를 묻고 기본값은 No입니다. 선택은 `version.yml`에 저장하고, 워크플로우가 런타임에 읽어 `if:`로 분기합니다(`semver_auto`와 같은 방식). 비대화형 CLI에는 `--copilot`/`--no-copilot` 플래그를 추가합니다. 저장된 값이 없으면(기존 설치) 마법사 재실행 시 다시 묻습니다.
- **권한**: `models: read`를 제거하고 `copilot-requests: write`를 추가합니다. 렌더링 단계에서 조건부로 넣고 빼는 로직이 없으므로 opt-out 저장소에도 항상 선언하고, 실제 호출만 런타임에서 막습니다.
- **Copilot 호출 방식**: 텍스트 생성 전용으로만 사용합니다. 프롬프트에 필요한 정보(PR 제목, 커밋, diff 요약)가 이미 들어가므로 파일 읽기·셸·웹 접근 같은 도구는 차단합니다(`--available-tools` 허용 목록 또는 `--deny-tool`, 정확한 이름은 사전 실측으로 확정). 비대화형 옵션(`-p`, `-s`, `--no-ask-user`)을 사용하고, 타임아웃을 두며, 초과하면 fallback으로 넘깁니다.
- **모델/버전 고정**: 저비용 소형 모델을 기본으로 고정하고 환경 변수로 덮어쓸 수 있게 합니다(구체 모델과 크레딧 배율은 구현 시 확인). `@github/copilot` CLI는 정확한 버전으로 고정합니다.
- **응답 검증**: 프롬프트가 요구하는 Markdown 섹션 헤딩이 하나도 없거나 응답 전체가 코드펜스로 감싸져 있으면 fallback으로 넘깁니다(기존 티어는 비어 있지 않으면 채택). 정확한 검사 기준은 프롬프트의 출력 형식을 확인해 구현 시 정합니다.
- **SemVer 보조 판정**: `_ai_assisted_minor_upgrade`도 Copilot으로 교체합니다. `semver_auto`와 Copilot opt-in이 모두 켜져 있을 때만 동작하고, 응답이 정확히 `MINOR`일 때만 채택합니다. major는 기존처럼 `!` 마커 규칙으로만 결정하며 AI가 결정하지 못합니다.
- **PR 코멘트 라벨**: "🤖 AI Summary (project-auto-wizard)"를 엔진과 무관한 중립 이름(예: "📋 PR Summary")으로 바꾸고, 코멘트 하단에 `engine: copilot | user-api | fallback` 한 줄을 표기합니다. 코멘트를 찾아 갱신하는(upsert) 로직이 없어 이름 변경은 기존 코멘트에 영향이 없습니다.
- **`AI_API_KEY` 티어 정리**: 죽은 기본값(URL, 모델명)을 제거합니다. `AI_API_KEY`가 있으면 `AI_API_BASE_URL`과 `AI_MODEL`을 필수로 하고, 없으면 그 티어를 건너뛰며 `::warning::`을 남깁니다.
- **비용 통제**: `AI-PR-SUMMARY`에만 `concurrency`(진행 중 실행 취소)를 추가해 연속 푸시 시 중복 호출을 줄입니다. `AUTO-CHANGELOG-CONTROL`은 버전 커밋을 만드는 잡이라 기존 `cancel-in-progress: false`를 유지합니다.
- **포크 PR**: 두 PR 워크플로우에 이미 `head.repo.full_name == github.repository` 가드가 있어 포크 PR은 건너뜁니다. 추가 작업이 없습니다.

### 사전 실측 항목 (구현 전 스파이크, 문서에 없어 직접 확인 필요)

- [ ] Copilot 권한이 없는 개인 repo와 조직 repo에서의 실패 형태(오류 메시지, 종료 코드)
- [ ] Copilot Free 플랜 사용자의 동작
- [ ] 사용 가능한 `--deny-tool` 도구 이름, 또는 `--available-tools` 빈 집합의 동작
- [ ] `copilot-requests: write`를 선언했을 때, Copilot 정책이 꺼진 조직이나 Copilot이 없는 환경에서 워크플로우 자체가 실패하지 않는지
- [ ] GitHub 공식 권고("`run` 스텝에서 Copilot CLI를 직접 호출하지 말고 GitHub Agentic Workflows 사용")를 따르지 않는 이유를 문서화 (프롬프트 입력이 PR 제목·커밋 메시지이므로 도구 차단과 포크 PR 가드로 위험을 낮춘다는 근거 정리)

### 🧭 구현 가이드

- **`.github/scripts/changelog_manager.py`, `payload/scripts/changelog_manager.py`** (두 파일은 동일 내용의 사본이므로 함께 수정)
  - `cmd_ai_summary`: GitHub Models를 호출하는 두 번째 티어를 Copilot 호출로 교체하고, 엔진 이름을 `copilot`으로 변경합니다. `AI_API_BASE_URL`/`AI_MODEL`의 `or` 기본값(`_AI_DEFAULT_BASE_URL`, `_AI_DEFAULT_MODEL`)을 제거하고 미설정 시 해당 티어를 건너뜁니다.
  - `_ai_assisted_minor_upgrade`: 같은 방식으로 기본값을 제거하고 GitHub Models 폴백을 Copilot으로 교체합니다.
  - `_build_ai_prompt`: 프롬프트 입력(PR 제목, 커밋, diff 요약)은 그대로 재사용합니다. 응답 검증의 기준이 될 출력 형식이 여기에 정의되어 있습니다.
- **워크플로우 3종** (`.github/workflows`와 `payload/workflows/common`에 각각 사본 존재, 총 6개 파일)
  - `PROJECT-COMMON-AI-PR-SUMMARY.yaml`, `PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml`, `PROJECT-COMMON-RELEASE-PUBLISH.yaml`: `permissions`의 `models: read`를 `copilot-requests: write`로 교체하고, Copilot CLI 설치 스텝과 opt-in 옵션을 읽어 분기하는 조건을 추가합니다.
  - `AI-PR-SUMMARY`, `AUTO-CHANGELOG-CONTROL`: PR 코멘트 헤더 문구를 바꾸고 `engine` 표기를 추가합니다.
  - `AI-PR-SUMMARY`: `concurrency` 추가.
- **마법사 옵션** (`semver_auto`가 구현된 위치를 따라 추가): `src/ui/prompts.js`, `src/commands/interactive.js`, `src/cli/args.js`, `src/cli/help.js`, `src/commands/status.js`, `src/core/version-yml.js`(파싱), `src/index.js`(옵션 우선순위 결정), `payload/version.yml.template`(저장 키). 새 옵션의 기본값은 항상 off입니다.
- **README**: "zero API key" 표방 문구와 3단 폴백 다이어그램(README.md:192 부근)을 정정하고, Copilot 사용 시 AI Credits 소비와 과금 주체(개인 repo는 소유자 좌석, 조직 repo는 조직)를 명시합니다. 현재 README.md:197 부근은 `AI_API_BASE_URL`/`AI_MODEL`도 secret이라고 적고 있지만 워크플로우에서는 `vars`로 전달되므로 이를 바로잡습니다. `docs/` 하위 과거 설계 문서는 이력이므로 수정하지 않습니다.
- **테스트**: `tests/py/test_ai_summary.py`(`github-models` 엔진 → `copilot`, 기본값 제거 및 응답 검증 케이스), `tests/py/test_classify_bump.py`(AI minor 승격 경로), `tests/node/payload-workflow-permissions.test.js`, `tests/node/ai-pr-summary.test.js`, 그리고 `semver_auto` 관련 옵션 테스트(`tests/node/semver-auto-cli.test.js`, `semver-auto-option.test.js`)를 새 옵션에 맞게 갱신·추가합니다. Copilot CLI는 실제 호출 없이 대체(mock)해 테스트합니다.
- **범위 밖 참고**: `PROJECT-COMMON-RELEASE-PUBLISH.yaml`의 `.github` 사본에는 `actions: write` 권한이 있는데 `payload` 사본에는 없습니다. 이번 이슈와 무관한 별개 사항이므로 건드리지 않습니다.

## 고려한 다른 방법(선택)

- **Groq / Google AI Studio / Cerebras / OpenRouter (무료 API)**: 변경은 작지만 사용자가 키를 발급해 secret으로 등록해야 해서 "키 없이 동작"이라는 기존 가치를 복원하지 못합니다. 기존 `AI_API_KEY` 티어로 이미 사용할 수 있습니다.
- **Microsoft Foundry**: GitHub이 안내하는 공식 이행 경로이지만 유료 종량제입니다.
- **Local LLM (llama.cpp + 소형 GGUF 모델을 Actions 러너에서 실행)**: 키와 외부 호출이 전혀 필요 없는 유일한 대안입니다. public repo 표준 러너는 4 vCPU/16GB로 무료·무제한이라 가능성이 있지만, private repo는 2 vCPU/8GB이고 Actions 분을 소모하며, 실제 속도와 요약 품질은 측정되지 않았습니다. 이번 범위에서는 제외하고 추후 선택 provider로 별도 검토합니다.
- **Copilot API를 OpenAI 호환 서버로 감싸는 커뮤니티 프록시(`copilot-api` 등)**: 비공식이라 약관과 안정성 위험이 있어 제외합니다.
- **GitHub Agentic Workflows로 전환**: 공식 권고이지만 워크플로우 구조 변경이 커서 이번 범위에서는 제외하고, 채택하지 않는 이유를 문서화합니다.
- **AI provider 추상화 전체 리팩터링**: 이번 문제는 공급자 하나의 종료 대응이므로 제외합니다.
