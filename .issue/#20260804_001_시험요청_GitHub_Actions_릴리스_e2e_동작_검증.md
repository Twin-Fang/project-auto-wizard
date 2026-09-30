<!-- GitHub Issue: #17 | https://github.com/Twin-Fang/project-auto-wizard/issues/17 -->
🔍[시험요청][CICD] GitHub Actions 릴리스 e2e 동작 검증 (pr-flow/trunk-based)

🔗 ISSUE 정보
---

- #11 (🔍[시험요청][QA] 구현된 전체 기능 실사용 버그 검증)의 시나리오 13번에서 분리된 후속 작업입니다.
- #11 검증 세션에서는 로컬 CLI 산출물(설치되는 파일 자체) 검증까지만 다루고, 실제 GitHub 저장소 위에서 워크플로우가 끝까지 동작하는지는 이 이슈에서 별도로 진행합니다.

🔗 PR 정보
---

- 특정 PR에 종속되지 않습니다. 검증 중 버그가 발견되면 별도 이슈/PR로 분리합니다.

🧩 시험 대상
---

- `pr-flow` / `trunk-based` 두 브랜치 모드로 설치되는 릴리스 자동화 워크플로우 3종의 실제 GitHub Actions 동작
  - `payload/workflows/common/PROJECT-COMMON-VERSION-CONTROL.yaml`
  - `payload/workflows/common/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml`
  - `payload/workflows/common/PROJECT-COMMON-RELEASE-PUBLISH.yaml`
- 브랜치 모드 판단 로직 (`src/core/branches.js`) — `main === develop`이면 `trunk-based`, 다르면 `pr-flow`로 설치 매트릭스가 갈리는 부분이 실제 저장소에서도 README에 설명된 대로 동작하는지
- API 키 0개 AI 릴리스 노트 요약 엔진 체인(CodeRabbit opt-in → 사용자 지정 AI → GitHub Models → 규칙 기반 fallback)이 실제 릴리스 PR에서 순서대로 폴백되는지

📋 테스트 시나리오
---

1. 임시 GitHub 저장소를 생성하고 `npx project-auto-wizard --mode full`로 `pr-flow` 모드(기본, main ≠ develop) 설치 후 develop → main 실제 push
2. develop push 시 `VERSION-CONTROL`이 main 직접 push에 대한 안전망으로 정상 동작하는지 확인
3. `AUTO-CHANGELOG-CONTROL`이 develop→main 릴리스 PR을 자동으로 여는지, 버전이 patch+1로 확정되는지 확인
4. 릴리스 PR에서 AI 릴리스 노트가 작성되는지 확인 — `GITHUB_TOKEN` + `models: read` 권한만으로 GitHub Models 경로가 동작하는지(비용 0, 설정 0 문서 내용 검증)
5. 릴리스 PR이 automerge로 병합되는지, 병합 후 `CHANGELOG.json`/`CHANGELOG.md`가 갱신되는지 확인
6. `RELEASE-PUBLISH`가 병합 후 `vX.Y.Z` tag 생성과 GitHub Release 생성까지 끝까지 처리하는지 확인
7. 동일 저장소를 `trunk-based` 모드(main === develop)로 재설치하여 `RELEASE-PUBLISH` 단일 워크플로우가 main push마다 버전확정 → 체인지로그 → tag → Release를 순차 처리하는지 확인
8. `--coderabbit` 옵션을 켠 상태로 위 흐름을 재현하여, CodeRabbit PR 요약(30초×10 폴링)이 도착했을 때 1순위로 채택되고 미도착 시 다음 엔진으로 정상 폴백되는지 확인
9. `AI_API_KEY`/`AI_API_BASE_URL`/`AI_MODEL` secret을 등록/미등록 두 경우로 나눠 엔진 체인 폴백 순서(사용자 지정 AI → GitHub Models → 규칙 기반)가 README 설명과 일치하는지 확인
10. 위 과정에서 실제 발생한 CLI/Actions 로그, 에러, 예상과 다른 동작을 전부 기록

⚙️ 테스트 환경
---

- **프로젝트 Version**: v0.1.12 (`package.json` 기준, 진행 시점 최신 버전으로 갱신 필요)
- **저장소**: 이 검증 전용 임시 GitHub 저장소 (별도 생성, 완료 후 정리)
- **기타**: `gh` CLI 인증 상태, GitHub Actions 실행 권한(`workflow` 스코프)

🙋‍♂️ 담당자
---

- **시험담당**: 이름
