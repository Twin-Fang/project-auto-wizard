# CLAUDE.md

이 파일은 project-auto-wizard 저장소에서 작업하는 Claude Code 세션이 따라야 할 프로젝트 전용 규칙입니다. 사용자의 전역 `~/.claude/CLAUDE.md`보다 이 파일이 우선합니다.

## Git 커밋 규칙

- **커밋 메시지는 항상 한국어로 작성합니다.** Conventional Commits 타입 접두사(`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `perf:`, `ci:` 등)는 표준 관례에 따라 영어를 유지하되, 그 뒤에 오는 설명(및 본문)은 한국어로 작성합니다.
  - 예: `feat: 로그인 실패 시 재시도 로직 추가`
  - 예: `fix: 워크플로우 YAML의 diff-stat 요약 줄 중복 제거`
- 이 규칙은 `CONTRIBUTING.md`의 커밋 메시지 가이드와 일치합니다 — 커밋 메시지 관련 설명을 수정할 때는 두 문서를 함께 갱신하세요.
