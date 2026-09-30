<!-- GitHub Issue: #240 | https://github.com/Twin-Fang/project-auto-wizard/issues/240 -->
🚀[기능개선][레포정비] nexus·secret_backup 옵션 제거 및 AI용 주석·docs 추적 정리

어떤 문제를 해결하고 싶으신가요?
---

- 멘토링 이후 팀 내부 논의에서, 이 도구가 가장 잘 하는 일(새 프로젝트의 배포·버전·변경기록 자동화)과 거리가 있거나 유지 부담이 큰 옵션을 정리하기로 했습니다.
  - Spring의 `nexus` opt-in(Nexus·GitHub Packages 라이브러리 배포)은 이 도구의 핵심 대상이 아니고, 켜면 서버 배포 워크플로우가 통째로 제외되는 배타 관계라 설치 결과가 달라지는 버그의 원인이 되고 있습니다.
  - `secret_backup`(GitHub Secrets를 SSH로 서버에 업로드)은 사용 범위가 좁고, 워크플로우 상단에 "AI 에이전트에게 수정 요청" 가이드 주석이 들어 있습니다.
- 코드와 워크플로우 주석에 이슈번호, 작업 리뷰 식별자(예: "fable5.1 리뷰 Important #1", "M8/H3/L7", "SP2-C", "D5"), 장식성 배너·이모지 헤더가 많이 남아 있어 사람이 읽기에 노이즈가 됩니다.
- `docs/`(77개 파일, 약 2.2MB)가 git에 추적되고 있는데, 설계·계획 작업 문서라 저장소 소비자에게 필요하지 않고 npm 패키지에도 포함되지 않습니다.
- README·ROADMAP·LICENSE 주변에 서로 어긋나는 서술, 존재하지 않는 데모 TODO, 팀이 원하지 않는 원본 도구명 언급이 남아 있습니다.

관련 이슈 (이 작업으로 해소되거나 겹침): #237, #238, #200, #168 (nexus·secret_backup 옵션 관련 버그), #164 (README/ROADMAP 문서 불일치)

제안하는 해결 방법
---

브랜치 1개에서 아래 6개 그룹으로 나눠 커밋합니다. 그룹마다 `npm test` 통과를 확인합니다.

1. **nexus 제거**: `payload/workflows/spring/nexus/`의 워크플로우 3개(NEXUS-CI, NEXUS-PUBLISH, GITHUB-PACKAGES-PUBLISH), `--nexus`/`--no-nexus` 플래그, `version.yml`의 `nexus` 키, 대화형 질문·편집 메뉴·상태 카드, `GRADLE_PROPERTIES` 안내, 관련 테스트를 삭제합니다. Spring은 항상 서버 배포 스타일(`simple`/`nginx`/`traefik`/`none`) 선택 흐름을 가집니다.
2. **secret_backup 제거**: `payload/workflows/common/secret-backup/` 워크플로우, `--secret-backup`/`--no-secret-backup` 플래그, `version.yml`의 `secret_backup` 키, 대화형 질문·편집 메뉴·상태 카드, env-plan 스캔, 관련 테스트를 삭제합니다. AI 에이전트 가이드 주석도 함께 사라집니다.
3. **코드 주석 정리 (`src/`, `tests/`)**: AI 작업 흐름 잔재(리뷰 식별자, 작업 라벨)는 삭제하고, 이슈번호 참조는 번호만 지우되 "왜 이렇게 했는지" 설명은 유지합니다. 문장 전체가 메타 정보면 주석째 삭제합니다. 코드와 사용자 화면 문자열은 바꾸지 않습니다.
4. **워크플로우 주석 간결화 (`payload/workflows/` → `.github/workflows/` 동기화)**: 이모지 섹션 헤더와 배너 장식을 제거하고, 사용자가 설정해야 하는 Secrets·vars·환경변수 설명은 유지합니다. 사람이 읽는 이유 설명 주석은 유지합니다. `RELEASE-PUBLISH`의 payload와 `.github` 불일치도 해소합니다.
5. **`docs/` 정리**: `.gitignore`에 `docs/`를 추가하고 `git rm --cached`로 인덱스에서만 제거합니다(로컬 파일 유지, 강제 플래그 미사용). `.gitignore`의 도구 이름이 들어간 주석 두 줄은 중립 표현으로 바꿉니다.
6. **문서 정리**: README·ROADMAP의 불일치와 데모 TODO 주석, nexus·secret-backup 언급을 정리하고, README에 "AI 활용 방식" 짧은 섹션을 추가합니다(문구는 팀 확정). 원본 도구명 언급은 CHANGELOG의 해당 줄과 `legacy-naming-guard.test.js`에서 제거합니다(`suh` 가드는 유지).

검증 기준
- `npm test`(node 테스트와 py 테스트) 전체 통과.
- JS 주석 정리는 변경 전후에서 주석을 제거한 결과가 동일한지 확인합니다.
- YAML 주석 정리는 변경 전후 파싱 결과가 동일한지 확인하고, `run:` 셸 블록의 차이는 개별 확인합니다.

구현 가이드
---

- nexus 제거 대상:
  - 삭제: `payload/workflows/spring/nexus/` 전체.
  - 수정: `src/cli/args.js`(플래그와 충돌 검사), `src/cli/help.js`, `src/context.js`(`includeNexus`), `src/index.js`(CLI 값과 저장값 병합), `src/core/version-yml.js`(파싱과 `OPT_NEXUS` 렌더), `src/core/options-ask.js`, `src/commands/interactive.js`(질문, 편집, `includeNexus`에 따라 배포 스타일 질문을 건너뛰는 조건), `src/ui/prompts.js`(편집 메뉴), `src/ui/status-cards.js`, `src/commands/status.js`, `src/commands/uninstall.js`, `src/ui/env-plan.js`(nexus 폴더 스캔), `src/core/copy/workflows.js`(nexus 폴더 include와 `server-deploy` 제외 로직), `payload/version.yml.template`(`nexus` 키), 저장소 루트 `version.yml`, `payload/config/breaking-changes.json`의 NEXUS-CI 언급.
  - 테스트: `install-matrix`, `e2e-matrix`, `args-validation`, `paths-resolve`, `workflows-copied-files`, `removal-plan`, `ci-gate-payload`, `payload-example-values`, `branding`, `status`, `plan-workflows`, `prompts-flutter`, `status-cards-flutter`, `no-coderabbit`, `doctor`, `copilot-ai-option`, `flutter-options-cli`.
- secret_backup 제거 대상:
  - 삭제: `payload/workflows/common/secret-backup/PROJECT-COMMON-SECRET-FILE-UPLOAD.yaml`.
  - 수정: `src/cli/args.js`, `src/cli/help.js`, `src/context.js`, `src/index.js`, `src/core/version-yml.js`, `src/core/options-ask.js`, `src/commands/interactive.js`, `src/ui/prompts.js`, `src/ui/status-cards.js`, `src/commands/status.js`, `src/core/copy/workflows.js`(신규 설치 전용 복사), `src/ui/env-plan.js`, `src/core/assets.js`(common 목록 제외 처리), `src/core/copy/flutter-app.js`(선례로 인용한 주석), `payload/version.yml.template`, 루트 `version.yml`, README 플래그 목록.
  - 테스트: `install-matrix`, `env-plan`, `args-validation`, `status`, `workflows-copied-files`, `copilot-ai-option`, `no-coderabbit`, `branding`, `assets`, `payload-yaml`, `status-cards-flutter`.
- 주석 정리 참고 위치(예): `src/ui/status-cards.js`, `src/ui/prompts.js`, `src/ui/summary.js`, `src/ui/env-plan.js`, `src/ui/banner.js`, `tests/node/version-yml.test.js`, `tests/node/flutter-app-templates.test.js`.
- 워크플로우 간결화 대상: `payload/workflows/` 아래 각 타입 폴더(spring, go, python, react, next, flutter, common)와 `.github/workflows/`. 파일별 헤더 배너와 이모지 섹션이 주요 대상이며, `PR-PREVIEW` 계열은 2,000줄대에 주석 160줄 이상입니다.
- docs·문서: `.gitignore`, `README.md`(nexus·secret-backup 플래그 서술, 데모 TODO 주석), `ROADMAP.md`, `CHANGELOG.md`·`CHANGELOG.json`(원본 도구명 줄), `tests/node/legacy-naming-guard.test.js`.

고려한 다른 방법(선택)
---

- 이슈·PR을 3개로 나누는 방법은 리뷰가 쉬워지지만, 이번에는 이슈 1개와 커밋 6그룹으로 진행하기로 했습니다.
- 주석 정리를 스크립트로 일괄 치환하는 방법은 사용자에게 보이는 "이슈" 문구를 잘못 건드릴 수 있어, 후보 검색은 스크립트로 하고 수정은 디렉터리 단위 서브에이전트가 읽고 하는 방식을 택했습니다.
- 이번 범위에서 제외: deploy style 개편(값과 `deploy_style` 이름 유지), 기존 설치본 호환, 비대화형 모드 삭제(추후 별도 작업), git 히스토리 재작성, 이미 배포된 Release 본문 수정.
