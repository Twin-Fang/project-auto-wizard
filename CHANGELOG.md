# Changelog

**현재 버전:** 0.12.2  
**마지막 업데이트:** 2026-09-26T17:25:10Z  

---

## [0.12.2] - 2026-09-26

**PR:** #244  

**🐛 수정**
- Copilot_기본_모델_claude_haiku_4_5_이_Actions에서_거부되어_기본_상태로는_AI_요약과_SemVer_보조_판정이_동작하지_않음 — Copilot 호출을 auto 모델로 고정하고 COPILOT_MODEL 오버라이드 제거

**📝 문서**
- Copilot auto 모델 고정 구현 계획 작성 (#153)

**🔧 변경사항**
- develop 브랜치 병합 (#153)
- Playwright MCP 산출물 디렉터리를 gitignore에 추가 (#153)

---

## [0.12.1] - 2026-09-26

**PR:** #242  

**📝 문서**
- 남은 코드 주석의 리뷰 식별자와 파이썬 주석 이슈번호 제거 (#240)
- README·ROADMAP 정합성 정리 및 원본 도구명 언급 제거 (#240)
- 워크플로우 주석 장식 제거 및 payload·.github 사본 동기화 (#240)
- 코드 주석에서 이슈번호와 AI 작업 흐름 잔재 제거 (#240)

**♻️ 리팩토링**
- 더 이상 쓰이지 않는 optionalCopied 카운터 제거 (#240)
- Secret 서버 백업 워크플로우와 secret_backup 옵션 제거 (#240)
- Spring nexus·GitHub Packages publish opt-in 제거 및 Spring CI 상시 설치 (#240)

**🔧 변경사항**
- docs/를 .gitignore에 추가하고 git 추적에서 제외 (#240)

---

## [0.12.0] - 2026-09-24

**PR:** #136  

**✨ 기능**
- 워크플로우를 opt-in Copilot 게이트·엔진 표기·중립 PR Summary 라벨로 전환 (#134)
- 마법사에 Copilot AI 요약 opt-in 옵션(copilot_ai)과 --copilot 플래그 추가 (#134)
- GitHub Models 티어를 opt-in Copilot CLI로 교체하고 죽은 API 기본값 제거 (#134)

**🐛 수정**
- 요구 문구에서 종료된 서비스 명칭을 제거하도록 docstring 정정 (#134)

**📝 문서**
- GitHub Models 종료 대응 Copilot CLI 엔진 교체 구현 계획 작성 (#134)
- 표방 문구에서 기본 동작과 다른 AI 릴리스 자동화 수식을 정정 (#134)
- GitHub Models 종료와 Copilot 과금·opt-in 옵션에 맞게 안내 문구와 README 정정 (#134)

---

## [0.11.0] - 2026-09-23

**PR:** #133  

**✨ 기능**
- IOS-TEST-TESTFLIGHT에 FLUTTER_PROJECT_DIR·환경변수 모드·Gemfile C-lite 적용
- IOS-TESTFLIGHT에 main push 앵커·배포 모드 폴백·ExportOptions 검증 적용
- PLAYSTORE에 main push 앵커·환경변수 모드·배포 모드 폴백·PACKAGE_NAME 적용
- TEST-APK에서 fastlane 분기 제거하고 직접 빌드로 전환
- SELFHOSTED에서 fastlane 빌드 제거하고 직접 빌드로 전환
- FIREBASE-CICD에 main push 앵커·FLUTTER_PROJECT_DIR·환경변수 모드 적용
- PROJECT-FLUTTER-CI에 ci-gate·FLUTTER_PROJECT_DIR·환경변수 모드 적용
- Spring NEXUS-CI에 changes·ci-gate, publish 2종에 paths 앵커 추가
- Go·Next·Python·React CI에 changes와 ci-gate job 추가
- dry-run과 설치 요약에 Flutter 스토어 배포 파일 표시 추가
- doctor에 Flutter 스토어 배포 필수 파일·ExportOptions 검사 추가
- status 명령에 Flutter 옵션 표시 추가
- 대화형 마법사에 Flutter 질문 흐름과 수정 메뉴 연결
- 환경변수 방식·스토어 배포 대상·배포 모드 선택 프롬프트 추가
- runFull에 스토어 워크플로우 정리와 Flutter 앱 파일 복사 연동
- Flutter iOS 배포용 Fastfile과 ExportOptions.plist 템플릿 추가
- Flutter Play Store 배포용 Fastfile.playstore 템플릿 추가
- Flutter 앱 파일(fastlane·ExportOptions) 복사 모듈 추가
- env 계획 질문에도 스토어 워크플로우 필터 적용
- 스토어 워크플로우 필터를 복사·조사·계획 경로에 일관 적용
- 비대화형 경로에 Flutter 옵션 결정 연결
- Flutter 옵션 CLI 플래그 4종 추가
- version.yml에 Flutter 옵션 4개 키 파싱·렌더 추가
- @wizard fallback 마커와 Flutter 리졸버 4종 추가
- resolveFlutterOptions 우선순위 해석 추가
- Flutter 옵션 코어 모듈(flutter-options.js) 추가

**🐛 수정**
- 실제 확인 카드(printAnalysisCard)에 Flutter 옵션 표시
- 확인 화면에 Flutter 옵션 표시·스토어 해제 시 배포 모드 초기화
- 비대화형 설치 요약에 Flutter 스토어 정리·생성 결과 표시

**📝 문서**
- Flutter 모노레포 필터·dart-define·스토어 배포 구현 계획 작성
- breaking-changes 고지와 README에 Flutter 스토어 배포 문서화

**✅ 테스트**
- status 명령의 스토어 필터 검증 — 실제 파일 삭제 시나리오 추가
- status 명령의 스토어 필터 오탐 방지 시나리오 보강

---

## [0.10.0] - 2026-09-21

**PR:** #130  

**✨ 기능**
- 댓글 명령어와 이슈 마커에서 SUH-LAB 종속 이름 제거

**📝 문서**
- SUH-LAB 종속 네이밍 일반화 구현 계획 작성
- 원본·라이선스 출처 표기 정리

**♻️ 리팩토링**
- 원본 도구명·템플릿명 코드 식별자를 일반 이름으로 정리
- heredoc 센티널 접두사를 __SUH_에서 __WIZARD_로 변경

**✅ 테스트**
- 원작자 종속 이름 재유입 방지 가드 추가

**🔧 변경사항**
- 이 레포 issue helper의 브랜치 자동 생성 활성화
- docs/suh-template/hypercortex 폴더를 docs/hypercortex로 이동

---

## [0.9.0] - 2026-08-29

**PR:** #125  

**✨ 기능**
- 진입점에 로거 배선 및 uninstall·purge 기록 추가
- full 파이프라인 전 구간 계측 및 요약 블록 기록
- 워크플로우 복사 결정과 사유를 실행 로그에 기록
- 로그 라인 기록·요약 블록·쓰기 실패 시 no-op 전환 추가
- 실행 추적 로거 코어 추가 — 파일 생성·gitignore 자동화·회전

**🐛 수정**
- 이슈_자동_종료_Closes_N_연결이_EnterWorktree류_브랜치명_없음_에서_항상_실패함 — 브랜치명 이슈 번호 추출 정규식이 EnterWorktree류 브랜치명(# 없음)을 매칭하지 못하던 문제 수정

**📝 문서**
- 이슈 #122 구현 완료 보고서 추가
- 이슈 #122 본문 기록
- 설치 기록을 실행 추적 로그로 교체한 내용 반영

**♻️ 리팩토링**
- install-log.js 제거하고 실행 로그로 일원화
- 설치 요약을 실행 로그 안내로 교체하고 테스트 분리

---

## [0.8.2] - 2026-08-26

**PR:** #120  

**🐛 수정**
- 이슈헬퍼 워크플로우 브랜치 자동생성 시 contents 권한 부족 문제 수정 (#118)

---

## [0.8.1] - 2026-08-25

**PR:** #117  

**🐛 수정**
- version.yml deploy 블록에 __PROJECT_NAME__ 토큰이 미치환 상태로 기록되는 문제 수정 (#114)

---

## [0.8.0] - 2026-08-25

**PR:** #115  

**✨ 기능**
- ENABLE_VOLUME_MOUNT가_마법사에서_질문되지_않고_항상_false로_고정_설치됨 — ENABLE_VOLUME_MOUNT·NGINX VOLUME_CONTAINER_PATH에 @wizard ask 마커 추가

**🐛 수정**
- env-plan.test.js 병합 충돌 오처리로 누락된 닫는 괄호 복원
- 마법사 환경설정 기본값 표시에서 __PROJECT_NAME__ 미치환 문제 수정 (#110)

**📝 문서**
- PROJECT_NAME 토큰 표시 버그 수정 계획 추가 (#110)

**♻️ 리팩토링**
- wizard-env에 replaceProjectTokens 헬퍼 추출

**✅ 테스트**
- ENABLE_VOLUME_MOUNT·VOLUME_CONTAINER_PATH 노출 회귀 테스트 추가

---

## [0.7.0] - 2026-08-25

**PR:** #115  

**✨ 기능**
- ENABLE_VOLUME_MOUNT가_마법사에서_질문되지_않고_항상_false로_고정_설치됨 — ENABLE_VOLUME_MOUNT·NGINX VOLUME_CONTAINER_PATH에 @wizard ask 마커 추가

**🐛 수정**
- 마법사 환경설정 기본값 표시에서 __PROJECT_NAME__ 미치환 문제 수정 (#110)

**📝 문서**
- PROJECT_NAME 토큰 표시 버그 수정 계획 추가 (#110)

**♻️ 리팩토링**
- wizard-env에 replaceProjectTokens 헬퍼 추출

**✅ 테스트**
- ENABLE_VOLUME_MOUNT·VOLUME_CONTAINER_PATH 노출 회귀 테스트 추가

---

## [0.6.0] - 2026-08-24

**PR:** #109  

**✨ 기능**
- python PR-PREVIEW 템플릿을 포팅해 Go PR-PREVIEW 워크플로우 추가
- python SIMPLE-CICD 템플릿을 포팅해 Go SIMPLE-CICD 워크플로우 추가
- Go CI 워크플로우(PROJECT-GO-CI) 추가
- CLI 검증·대화형 선택·도움말에 go 타입 등록
- version_manager.py에 go 타입 버전 동기화 no-op 분기 추가
- Go 프로젝트(go.mod) 마커 감지 추가
- AUTO-CHANGELOG-CONTROL에 develop 머지 이슈 자동 취합 스텝 추가
- AI-PR-SUMMARY에 브랜치명 기반 이슈 자동 연결 스텝 추가
- collect-issue-closes CLI 서브커맨드 추가
- develop 머지 PR 중 이번 릴리스에 포함된 이슈 번호를 필터링하는 함수 추가
- PR 본문에 이슈 연결을 반영하는 link-pr-issues CLI 서브커맨드 추가
- PR 본문에 이슈 종료 마커 블록을 삽입/치환하는 함수 추가
- 브랜치명에서 이슈 번호를 추출하는 함수 추가

**🐛 수정**
- payload/version.yml.template·README 3축 표에 go 타입 누락 반영 (fable5 리뷰 발견)
- paths-resolve.js에 go 타입 등록 (--force 설치 차단 버그 수정)
- doctor의 WORKFLOW_PAT 미등록 판정을 WARN에서 INFO로 낮춤

**📝 문서**
- version.yml·README에 go 프로젝트 타입 반영
- fable5 검토 반영해 계획 오류 수정
- Go 프로젝트 타입 지원 구현 계획 작성
- 스펙에 paths-resolve.js 차단급 버그 반영
- Go 프로젝트 타입 지원 설계 스펙 추가
- README의 WORKFLOW_PAT 안내를 '선택 사항'으로 갱신
- 설치 완료 화면의 WORKFLOW_PAT 안내에 bot 계정 권장 문구 추가
- fable5 plan 리뷰 피드백 반영
- WORKFLOW_PAT 선택 사항 격하 구현 계획 문서 추가
- WORKFLOW_PAT 선택 사항 격하 설계 문서 추가
- fable5 리뷰 반영 — 임시파일 유출 방지, 셸 인젝션 방지, 마커 정합성, limit 경고 추가
- PR-이슈 자동 종료 연결 구현 계획 추가 (이슈 #102)
- PR-이슈 자동 종료 연결 설계 스펙 추가 (이슈 #102)

**✅ 테스트**
- go 프로젝트 타입 e2e 설치 매트릭스 추가

**🔧 변경사항**
- 실수로 커밋된 package-lock.json 추적 해제
- .github/workflows/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml를 payload 사본과 동기화
- .github/workflows/PROJECT-COMMON-AI-PR-SUMMARY.yaml를 payload 사본과 동기화
- .github/scripts/changelog_manager.py를 payload 사본과 동기화
- .github/scripts/issue_helper.py를 payload 사본과 동기화
- .superpowers SDD 스크래치 워크스페이스를 gitignore에 추가

---

## [0.5.1] - 2026-08-23

**PR:** #104  

**🐛 수정**
- NEXUS-PUBLISH 워크플로우 JAVA_VERSION을 @wizard 마커로 교체
- NEXUS-CI 워크플로우 JAVA_VERSION을 @wizard 마커로 교체

**📝 문서**
- fable5 plan 리뷰 피드백 반영
- NEXUS 워크플로우 JAVA_VERSION 마커화 계획 문서 추가

**✅ 테스트**
- spring 워크플로우 java-version 하드코딩 검출 테스트 추가

---

## [0.5.0] - 2026-08-23

**PR:** #101  

**✨ 기능**
- PYTHON_VERSION_하드코딩_및_미사용_정리 — Python CI/CD 워크플로우 2개에서 어디에도 참조되지 않는 PYTHON_VERSION 하드코딩 선언 제거

---

## [0.4.0] - 2026-08-23

**PR:** #98  

**✨ 기능**
- 릴리스_파이프라인_후속_워크플로우_트리거를_repository_dispatch_방식으로_전환 — AUTO-CHANGELOG-CONTROL·VERSION-CONTROL·RELEASE-PUBLISH에 workflow_dispatch 기반 자동 트리거를 추가해 WORKFLOW_PAT 없이도 릴리스 파이프라인이 끊기지 않도록 함
- 이슈 생성 시 브랜치 자동 생성 여부를 설치 마법사 질문으로 노출
- trunk-based 선택 시 개발 브랜치 질문을 생략하도록 대화형 흐름 변경
- 기본값이 true/false인 ask 필드는 텍스트 대신 예/아니오 토글로 입력받기
- 브랜치 전략(pr-flow/trunk-based)을 먼저 선택하는 프롬프트 추가
- collectAsks가 payload/workflows/common 최상위를 무조건 스캔하도록 확장

**🐛 수정**
- 환경설정 안내 문구에서 부정확해진 '배포' 표현 제거

**📝 문서**
- 이슈 헬퍼 브랜치 마법사 토글 계획 문서 추가
- 이슈 #90 구현 계획 문서 추가
- 브랜치 전략 질문 관련 README/DESIGN-SPEC 문서 반영 및 note 문구 다듬기
- 브랜치 전략 명시적 선택 구현 계획 추가 (이슈 #93)

**✅ 테스트**
- 릴리스 파이프라인 workflow_dispatch 트리거 회귀 테스트 추가

**🔧 변경사항**
- 이 레포 자신의 ISSUE-HELPER 워크플로우 사본에도 wizard 마커 동기화

---

## [0.3.3] - 2026-08-18

**PR:** #89  

**📝 문서**
- AI-PR-SUMMARY 헤더 주석의 어색한 줄바꿈 정리

---

## [0.3.0] - 2026-08-12

**PR:** #84  

**✨ 기능**
- 설치 마법사 출력 순서와 안내 정합성 정리 — 서버 배포 방식을 하나 고르게 하고 고른 CD만 설치하며 push 트리거까지 활성화

**🐛 수정**
- build.gradle.kts, pom.xml 버전 감지 누락으로 항상 0.0.1 사용 — PR 프리뷰 안내 주석의 원저자 개인 도메인을 예시 도메인으로 교체
- build.gradle.kts, pom.xml 버전 감지 누락으로 항상 0.0.1 사용 — Kotlin DSL·Maven 버전과 JDK·application.yaml 감지 수정, 미치환 검증·설치 로그·타입 확정 단계 추가 (#78 #79 #80 #81 #82)

**♻️ 리팩토링**
- 설치 마법사 출력 순서와 안내 정합성 정리 — 하위호환 분기를 걷어내고 배포 방식을 항상 택1로 단순화, 이전 워크플로우는 마법사가 정리

**🔧 변경사항**
- 설치 마법사 감지·치환·템플릿·UX 전면 수정 (#77 #78 #79 #80 #81 #82)

---

## [0.2.0] - 2026-08-10

**PR:** #74  

**✨ 기능**
- 설치 시점 baseline 기반 3-way 분류로 업데이트 지원 (#69)

**🔧 변경사항**
- develop 최신 내용을 #69 작업 브랜치에 동기화
- wip: baseline 모듈 초안 (#69)

---

## [0.1.34] - 2026-08-10

**PR:** #72  

**♻️ 리팩토링**
- 부분 설치·되돌리기 모드 제거 — full/uninstall/status/doctor로 정리 (#70)

---

## [0.1.33] - 2026-08-10

**PR:** #67  

**🐛 수정**
- 릴리스가 스킵될 때 버전-태그 드리프트를 감지해 실패시킴 (#61)

---

## [0.1.32] - 2026-08-10

**PR:** #64  

**🐛 수정**
- project_types 인라인 주석 때문에 파싱이 항상 실패하던 문제 수정 (#62)

**♻️ 리팩토링**
- version.yml 레거시 단수 키 project_type 제거 (#62)

**🔧 변경사항**
- main 최신 릴리스(v0.1.31) 내용을 develop에 동기화

---

## [0.1.26] - 2026-08-07

**PR:** #55  

## [0.1.26]

---

## [0.1.25] - 2026-08-06

**PR:** #53  

**🔧 변경사항**
- payload_워크플로우_GitHub_Actions_최신화 — 설치되는 워크플로우의 GitHub Actions를 최신 메이저로 일괄 갱신

---

## [0.1.24] - 2026-08-06

**PR:** #49  

**📝 문서**
- 릴리스_흐름_문서에_npm_배포_단계_반영 — 릴리스 흐름에 Release 이벤트 기반 npm 배포 설명 추가

---

## [0.1.6] - 2026-07-27

**PR:** #3  

**Enhance README with project description**

---

## [0.1.3] - 2026-07-09

**PR:** #1  

**update-from-summary survives degenerate CHANGELOG.json**

**correct test counts in README (py 51 + node 59)**

---

