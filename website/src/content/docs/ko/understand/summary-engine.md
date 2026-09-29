---
title: 요약 엔진
description: 릴리스 노트와 PR 요약을 만드는 방식, Copilot과 사용자 AI API의 위치.
---

릴리스 노트, CHANGELOG 항목, PR 요약 댓글은 모두 `changelog_manager.py`의 같은 엔진 체인에서 나옵니다. **어떤 단계가 실패해도 릴리스는 막히지 않습니다.**

```
사용자 지정 AI  ──미설정/실패──▶  GitHub Copilot CLI  ──꺼짐/사용 불가/실패──▶  규칙 기반
(AI_API_KEY + AI_API_BASE_URL + AI_MODEL)   (선택, GITHUB_TOKEN)                  (항상 성공)
```

프롬프트에는 PR 제목, 커밋 제목, 상한이 걸린 `git diff --stat`(파일 단위 요약, diff 본문 없음)만 들어갑니다.

## 규칙 기반 (기본)

아무것도 설정하지 않으면 규칙 기반 요약을 쓰며 키가 필요 없습니다. 규칙은 세 형식을 순서대로 시도합니다:

1. 프로젝트 자체 커밋 컨벤션
2. Conventional Commits
3. 무형식 bullet 목록

커밋 컨벤션이 없어도 동작합니다.

## GitHub Copilot (선택)

마법사에서 켜거나, `--copilot`을 주거나, `version.yml`의 `copilot_ai: true`로 켭니다. 그러면 워크플로우가 Actions의 `GITHUB_TOKEN`과 `permissions: copilot-requests: write`로 Copilot CLI를 호출합니다. 별도 API 키는 필요 없습니다.

켜기 전에 알아 둘 것:

- **GitHub Copilot AI Credits를 소비합니다.** 개인 저장소는 저장소 소유자의 Copilot 좌석에, 조직 저장소는 조직에 과금되며, 조직은 "Allow use of Copilot CLI billed to the organization" 정책을 켜야 합니다.
- PR에 push할 때마다 요약이 새로 생성되므로 그만큼 크레딧이 소비됩니다.
- Copilot은 항상 `auto` 모델 선택으로 호출됩니다. Copilot Free·Student 계정은 모델명을 직접 지정하는 호출이 거부되고 `auto`만 허용되므로, 모델을 바꾸는 옵션은 없습니다.
- 사용할 수 없으면 규칙 기반 요약으로 자동 전환됩니다.

GitHub은 Copilot CLI를 `run` 스텝에서 직접 호출하기보다 Agentic Workflows를 쓰라고 권고하지만, 이 프로젝트는 직접 호출을 택했습니다. 입력이 PR 제목·커밋 메시지·`git diff --stat`뿐이고, 빈 임시 디렉터리에서 shell/write/url 도구와 내장 MCP를 모두 막은 텍스트 생성 전용으로 호출하며, 포크 PR은 기존 가드로 건너뛰어 프롬프트 인젝션 위험을 낮췄기 때문입니다.

## 사용자 지정 AI API (선택)

아래 셋을 **모두** 설정하면 OpenAI 호환 엔드포인트(Groq, Gemini 호환 모드, Ollama 등)를 가장 먼저 사용합니다:

| 이름 | 종류 |
|---|---|
| `AI_API_KEY` | Secret |
| `AI_API_BASE_URL` | Variable |
| `AI_MODEL` | Variable |

셋 중 하나라도 없으면 이 단계는 건너뜁니다.

GitHub Models는 2026-07-30에 종료되어 더 이상 사용하지 않습니다.

## AI와 버전 승격

AI는 major 승격을 결정하지 않습니다. 규칙 결과가 patch이고 컨벤션을 따르지 않는 커밋이 있을 때, 설정된 AI(사용자 API 또는 Copilot)에게 patch를 minor로 올릴지만 묻습니다. AI가 꺼져 있으면 규칙 결과를 그대로 씁니다. [릴리스 흐름](../release-flow/#2-버전-확정)을 참고하세요.

## PR 요약봇

`PROJECT-COMMON-AI-PR-SUMMARY`는 릴리스 브랜치를 대상으로 하는 PR에 같은 엔진 체인으로 요약 댓글을 답니다. 상용 PR 리뷰 서비스가 필요 없습니다.

- **pr-flow:** 일상적인 기능 PR은 `develop`을 향하므로 `main`으로 가는 PR에서만 의미가 있습니다. 릴리스 PR(`develop → main`)은 여기서 건너뜁니다. `AUTO-CHANGELOG-CONTROL`이 확정된 버전으로 이미 요약을 남기기 때문입니다.
- **trunk-based:** 모든 PR이 릴리스 브랜치를 향하므로 매 PR마다 동작합니다.

요약 머리글에는 이미 릴리스된 버전이 아니라, 이 PR이 나갈 것으로 예상되는 버전(현재 버전 + 적용될 승격)이 표시됩니다.
