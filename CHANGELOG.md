# Changelog

**Current version:** 0.16.0  
**Last updated:** 2026-09-30T15:36:21Z  

---

## [0.16.0] - 2026-09-30

**PR:** #394  

**✨ Features**
- release_automerge가 꺼져 있으면 릴리스 PR 자동 머지와 대기 잡을 건너뛰고 수동 머지 안내를 남김 (#365)
- release_automerge 옵션 추가 (기본 켜짐, 키가 없는 기존 설치도 켜짐) (#365)
- 옵션 레지스트리 모듈 추가 (#365)

**🐛 Fixes**
- status의 release_automerge 미설정 표기·스위치 플래그 검증·워크플로우 리더 줄 고정을 바로잡고 수동 머지 안내를 머지 커밋으로 한정 (#365)

**📝 Documentation**
- 옵션 추가 가이드와 옵션 레지스트리 일관성 테스트 추가 (#365)

**♻️ Refactoring**
- 대화형 질문·수정 메뉴·상태 카드·요약을 레지스트리 구동으로 이전하고 질문하지 않는 저장 옵션이 재설치에서 유지되게 수정 (#365)
- 옵션 해석·컨텍스트·CLI 플래그·version.yml 파싱과 렌더·status·로그를 레지스트리 기반으로 이전 (#365)

**✅ Tests**
- 옵션 해석·플래그·version.yml 파싱·표시 출력을 특성화 테스트로 고정 (#365)

**🔧 Changes**
- main 브랜치의 릴리스 버전 커밋을 develop에 병합

---

## [0.15.1] - 2026-09-30

**PR:** #392  

**🐛 Fixes**
- messages.py 누락 시 뒤따르는 스텝 오류 차단, Spring CI 미실행 단계 표기, Go 캐시 경고 정리 (#388)
- Flutter 테스트 빌드가 체크아웃한 브랜치의 실제 커밋을 표시하도록 수정 (#387)
- PR 미리보기 메시지를 설정 언어로 dump하도록 수정 (#386)
- React CI 결과의 시각 라벨을 다른 CI의 '검증 시간'(Verified at)과 통일 (#374)
- 셸 run 스텝에 직접 들어가던 브랜치명·dispatch 값·이슈 제목을 env로 전달하고 테스트 시간 빈 값 표기를 -로 통일 (#382)
- messages.py가 없으면 스텝 시작 시 명확한 오류로 즉시 실패하도록 변경 (#373)
- 경로 병합 안내를 경로 확정 뒤에 출력하고 스크립트 간접 의존까지 누락 검사 (#381)
- 진단 로그의 모순 문구와 시간·Secret 문구·테스트 소요 시간 표기를 정리 (#374)
- github-script의 남은 ${{ }} 삽입과 셸의 브랜치 이름 직접 삽입을 env 전달로 변경 (#379)
- 경로 유실 경고를 최종 폴더 기준으로 안내하고 스크립트 누락은 호출되는 것만 검사 (#372, #373)
- React CI에서 테스트 실패로 빌드가 건너뛰어진 경우를 구분해 안내 (#370)
- github-script에 여러 줄·특수문자 값이 들어가도 깨지지 않게 env로 전달 (#369)
- README 날짜 갱신과 릴리스 커밋이 충돌해도 릴리스가 끝나도록 push 재시도·충돌 해소 추가 (#371)
- status와 doctor가 설치된 스크립트 누락을 경고하도록 수정 (#373)
- react와 next 경로가 다를 때 update에서 빠지는 폴더를 경고하도록 변경 (#372)
- PR 미리보기의 메시지 sparse checkout을 별도 경로로 옮기고 destroy·status 잡에 사전 점검 추가 (#367, #368)
- next 타입 통합 안내의 breaking-changes 버전 키를 다음 릴리스 버전에 맞춤 (#362)
- 업데이트 후 첫 배포 전에 이전 nextjs 컨테이너를 정리하고 변경 안내 추가 (#362)

**📝 Documentation**
- react-next 페이지의 컨테이너·이미지 이름 변경 설명을 실제 동작에 맞게 수정 (#362)
- next 타입 통합을 문서 사이트와 README 타입 표에 반영 (#362)

**♻️ Refactoring**
- next 타입을 react 타입으로 통합 (#362)
- Flutter·Spring 배포 워크플로우의 남은 영어 echo 진단 문구를 메시지 카탈로그로 이전 (#354)

**✅ Tests**
- Windows에서 python 출력 인코딩과 경로 구분자 때문에 실패하던 테스트 수정 (#386)
- 대화형 경로 병합 안내 시점과 스크립트 간접 의존 누락 검증 추가 (#381)
- sparse checkout 순서와 PR 미리보기 사전 점검 회귀 테스트 추가 (#367, #368)
- next 타입 통합에 맞춰 타입·워크플로우 테스트 갱신 및 별칭·업데이트 마이그레이션 테스트 추가 (#362)
- 워크플로우 m 호출 키·치환자와 스텝별 m() 정의·체크아웃 순서 검증 추가 (#354)

**🔧 Changes**
- main 브랜치의 릴리스 버전 커밋을 develop에 병합
- Node 20 종료 경고를 내는 액션을 Node 24 지원 버전으로 상향 (#375)

---

## [0.15.0] - 2026-09-30

**PR:** #361  

**✨ Features**
- doctor가 문제를 찾으면 종료 코드 1을 반환 (#357)

**🐛 Fixes**
- 프로젝트 파일 동기화 실패 시 실패한 타입명을 정상 출력하도록 수정 (#354)
- README 버전 블록의 언어 교체를 마커 바로 아래로 한정하고 기록 링크 줄도 함께 교체 (#355)
- 언어를 바꿔 재실행하면 README 기본 버전 제목도 현재 언어로 교체 (#355)

**📝 Documentation**
- README에 언어 선택 방법(--lang, 환경변수, version.yml) 안내 추가 (#356)

**♻️ Refactoring**
- 스크립트 로그와 공통 워크플로우 진단 문구를 메시지 카탈로그로 이전해 language 설정을 따르도록 변경 (#354)

**🔧 Changes**
- main 브랜치의 릴리스 버전 커밋을 develop에 병합

---

## [0.14.0] - 2026-09-30

**PR:** #353  

**✨ Features**
- --name=value 형식의 옵션 값 지정을 지원 (#347)
- 언어 결정과 메시지 카탈로그 기반, --lang 옵션 추가 (#332)

**🐛 Fixes**
- 사용자 질문 문구의 언어별 필드가 작성 순서와 무관하게 유지되도록 수정 (#343)
- dry-run이 자동 갱신·유지·삭제된 워크플로우도 표시하도록 수정 (#345)
- CHANGELOG.json의 카테고리 키를 언어와 무관한 고정 키로 저장하고 제목은 표시할 때만 언어별로 사용 (#346)
- 마법사 질문·breaking-changes 안내·완료 화면 문구를 언어 설정에 맞춤 (#343)
- 워크플로우 주석의 선택 표기를 (optional)로 바꾸고 검증 파싱을 맞춤 (#343)
- messages.py의 언어 결정을 CLI 규칙과 맞추고 읽기 실패·하위 폴더 실행에서도 동작하도록 수정 (#344)
- 프리뷰 워크플로우가 PR 병합 커밋에서 메시지를 받도록 하고 언어 폴백·안내·단복수 처리 보완 (#334)
- Windows 콘솔 인코딩에서도 ko 문구가 깨지지 않도록 스크립트 출력을 UTF-8로 고정 (#334)
- 마커 없는 'Latest Version' 형식의 README 버전 제목도 인식하도록 수정 (#333)

**📝 Documentation**
- 데모 GIF·MP4를 영어 CLI 출력으로 재녹화 (#335)
- doctor 문서 링크 앵커를 영어 페이지에도 추가하고 en/ko 모두 검사 (#335)
- 언어 정책(영어 기본, 한국어는 ko 카탈로그·번역본에만) 섹션 추가 (#337)
- CLI 레퍼런스의 --help 블록을 언어별 출력에 맞추고 검사 언어를 문서별로 지정 (#333)
- 문서와 이슈·PR 템플릿을 영어 기본으로 정리 (#335)
- CLI 옵션 표와 version.yml 레퍼런스에 language·--lang 추가 (#332)

**♻️ Refactoring**
- Flutter 워크플로우와 fastlane 템플릿의 문구를 language 설정에 맞추고 주석을 영어로 변경 (#334)
- PR 프리뷰·CI·배포 워크플로우와 생성기 조각의 문구를 language 설정에 맞추고 주석을 영어로 변경 (#334)
- 공통 워크플로우와 레포 자체 워크플로우의 문구를 language 설정에 맞추고 주석을 영어로 변경 (#334)
- 스크립트 출력 문구를 메시지 카탈로그로 옮기고 language 설정을 따르도록 변경 (#334)
- 설치 파일 생성부(README·.gitignore·워크플로우)의 문구를 카탈로그로 전환 (#333)
- 로그·검증·제거 계획 메시지를 카탈로그로 전환 (#333)
- 프로젝트 감지·경로·타입 관련 메시지를 카탈로그로 전환 (#333)
- 마법사 UI·대화형 출력을 카탈로그로 전환 (#333)
- CLI 진입점·도움말·명령 출력을 카탈로그로 전환 (#333)
- 출력 문구 카탈로그(en/ko)를 영역별 파트로 추가 (#333)

**✅ Tests**
- 한글 검사를 리터럴 제외 줄 단위로 강화하고 검사 파일을 ASCII로 유지 (#337)
- 카탈로그 밖 한글 유입을 막는 검사 추가 및 테스트 주석·이름 영어화 (#337, #336, #334)
- 카테고리 고정 키 저장과 예전 언어 키 항목 병합 읽기 검증 추가 (#346)
- node 테스트의 이름과 주석을 영어로 변경 (#336)
- 파이썬 테스트와 픽스처 주석을 영어로 변경 (#336)
- ko 출력을 검사하는 테스트가 단독 실행에서도 통과하도록 언어 설정 로드 (#333)
- 기존 테스트를 ko로 실행하고 en 기본 출력·카탈로그 무결성 검증 추가 (#333)
- 언어 결정·카탈로그 키 일치·language 저장 검증 추가 (#332)

**🔧 Changes**
- .issue 폴더를 git 추적과 한글 검사 허용 목록에서 제외 (#351)
- 설정 파일의 한국어 주석을 영어로 변경 (#337)
- 개발 도구 스크립트의 주석과 메시지를 영어로 변경 (#336)

---

## [0.13.3] - 2026-09-30

**📝 Documentation**
- 이슈 초안 마크다운(.issue) 추가

**🔧 Changes**
- Playwright MCP 로그 및 페이지 스냅샷 추가

---

## [0.13.2] - 2026-09-30

**PR:** #330  

**📝 Documentation**
- 생성 대상 목록에 Go/Python 단일 서버 배포 추가 (#276)

**♻️ Refactoring**
- Flutter 옵션 해석·CLI 플래그·version.yml 옵션 블록을 타입 훅으로 이전 (#278)
- Go/Python 단일 서버 배포 워크플로우를 공통 조각과 타입별 값으로 생성 (#276)

**✅ Tests**
- 생성 대상 목록에 Go/Python 단일 서버 배포 추가 (#276)

**🔧 Changes**
- main 브랜치의 릴리스 버전 커밋을 develop에 병합

---

## [0.13.1] - 2026-09-30

**PR:** #326  

**🐛 Fixes**
- Gradle 여러 줄 문자열 안의 중괄호를 코드로 읽지 않도록 수정 (#317)
- Gradle 블록 추적이 문자열 안의 // 와 중괄호에 흔들리지 않도록 수정 (#309)
- Gradle 들여쓴 version 줄을 프로젝트 버전으로 읽지 않도록 수정하고 get 동기화 동작을 명시 (#309)
- React Native 동기화가 앱 Info.plist만 고치고 $(…) 참조는 건너뛰도록 수정 (#306)
- dry-run 미리보기가 시각 줄을 제외하고 version.yml 변경 여부를 비교하도록 수정 (#308)

**📝 Documentation**
- 생성 대상 목록에 React/Next 배포 추가 (#276)
- src 트리에 flutter-doctor.js 추가하고 훅 호출 설명을 실제 코드에 맞게 정정 (#278)
- 워크플로우 생성·검증 절차 안내 추가 (#276)

**♻️ Refactoring**
- React/Next 배포 워크플로우를 생성기 조각으로 이전 (#276)
- Flutter 전용 처리(스토어 필터·정리·앱 파일·status·doctor)를 타입 훅으로 분리 (#278)
- Go/Python PR 프리뷰 워크플로우를 공통 조각과 타입별 값으로 생성 (#276)
- CLI와 대화형의 설치 설정 해석 단계를 공통 모듈로 분리 (#277)
- 워크플로우 복사·충돌 조사·미리보기 계획의 순회를 하나로 통합 (#273)
- uninstall과 purge의 삭제 실행부를 공통 함수로 통합 (#275)

**✅ Tests**
- React/Next 생성 대상 등록과 빈 줄 렌더링 검사 추가 (#276)
- 생성 결과와 커밋된 payload 워크플로우의 일치 검사 추가 (#276)

**🔧 Changes**
- main 브랜치의 릴리스 버전 커밋을 develop에 병합

---

## [0.13.0] - 2026-09-29

**PR:** #314  

**✨ Features**
- Starlight 문서 사이트와 GitHub Pages 배포 워크플로우 추가 (#260)
- payload 기준으로 레포 .github 사본을 다시 만드는 동기화 스크립트 추가 (#271)

**🐛 Fixes**
- 설치 시 버전 감지와 릴리스 시 버전 읽기를 같은 규칙으로 맞춤 (#295)
- 링크 경로에서도 동기화 검사가 실행되고 봇 병합 판정을 정확히 일치로 좁힘 (#304)
- Flutter 스토어 배포 워크플로우가 설치 시 고른 릴리스 브랜치를 쓰도록 수정 (#288)
- Flutter 자체 배포, 스토어 배포에서 필수 Secret을 첫 단계에 점검하도록 수정 (#282)
- Flutter CI에서 flutter test를 실행해 테스트 실패를 잡도록 수정 (#281)
- React, Next 배포에 SSH 키 인증과 포트 설정 추가 (#266)
- Spring CI가 tee 대신 gradle 종료 코드로 실패를 판정하도록 수정 (#279)
- 버전 동기화 시 JSON 파일의 기존 들여쓰기 유지 (#267)
- uninstall 로그 설명을 실제 동작에 맞추고 정리로 생긴 .bak을 요약에 집계 (#267)
- 워크플로우를 남기는 삭제에서 백업 파일용 .gitignore 항목 유지 (#267)
- 값 없는 --paths를 다른 값 옵션처럼 거부 (#267)
- 외부 SIGINT·SIGTERM으로 종료돼도 커서를 복구하고 중단 메시지 출력 (#265)
- 무중단 워크플로우가 없는 타입은 실제 설치된 배포 방식(simple)을 기록 (#264)
- 자동 갱신된 워크플로우를 새로 설치됨과 구분해 표시하고 중복 집계 제거 (#263)
- dry-run 미리보기에 워크플로우 정리와 .gitignore 변경을 표시 (#262)
- 태그 README 버전·AI 설정 경고·권한 안내·pyc 정리·선택 Secret 표시 불일치 수정 (#283)
- PAT 없이 병합된 릴리스도 main 배포 워크플로우를 실행하도록 수정 (#280)
- breaking-changes 안내를 번들본만 읽도록 바꾸고 보안 문서를 실제 동작에 맞게 수정 (#161)
- 0.12 업데이트 고지를 추가하고 breaking 안내를 설치된 타입으로 거르도록 수정 (#171)
- 업데이트 때 현재 버전에 없는 이전 워크플로우를 정리하도록 수정 (#170)
- status가 저장된 배포 방식으로 비교해 무중단 배포 워크플로우 수정도 감지하도록 수정 (#188)
- 배포 방식 none이 모든 타입의 서버 배포와 PR 프리뷰를 빼고, 무중단이 없는 타입은 단일 서버 배포로 설치하도록 수정 (#169, #199, #198)
- --force 충돌로 건너뛴 파일이 다음 실행에서 업스트림 무변경으로 분류되지 않도록 수정 (#167)
- 재실행과 자동 갱신 때 저장된 배포 값을 다시 읽어 deploy 블록과 입력값이 유지되도록 수정 (#165, #166)
- 모노레포 버전을 하위 폴더에서 감지하고 version_manager가 주석 달린 project_paths를 읽도록 수정 (#191)
- application.properties 프로젝트에서도 배포 워크플로우 리소스 경로를 채우도록 수정 (#196)
- 안전망 릴리스도 커밋 내역으로 CHANGELOG와 릴리스 노트를 만들도록 수정 (#210)
- 안전망 버전 bump를 develop에 역병합하고 확정된 버전을 다시 올리지 않게 수정 (#207)
- 릴리스 PR 자동 머지가 간헐 실패하면 브랜치를 갱신하며 재시도 (#209)
- 재실행·대기 실행이 병합된 PR을 다시 처리하거나 요약 댓글을 중복으로 달지 않게 수정 (#208)
- AI PR 요약 헤더에 병합 뒤 붙을 예상 버전을 표시 (#214)
- AI 요약이 fallback되면 PR 댓글과 실행 요약에 사유를 표시 (#157)
- 커밋 본문의 BREAKING CHANGE 푸터도 버전 승격 판정에 반영 (#184)
- npm 배포본 README가 배포 버전을 표시하도록 수정 (#160)
- PAT 없이 릴리스해도 README 버전이 갱신되도록 수정 (#206)
- 릴리스 커밋과 npm 패키지에 pyc 캐시가 섞이지 않게 수정 (#181, #152)
- 직접 고른 타입을 감지 근거 없이 표시하고 설치 선택값을 로그에 남기도록 수정 (#227)
- 필요 Secret 안내에서 폴백 쌍은 하나로 묶고 선택 항목은 따로 표시 (#162)
- --dry-run 미리보기에 스크립트 덮어쓰기와 README·baseline 변경을 포함 (#163)
- 끝 개행 없는 README에 버전 섹션을 붙일 때 앞줄이 제목이 되지 않도록 수정 (#203)
- README.md가 없을 때 설치 요약이 버전 섹션을 추가했다고 표시하지 않도록 수정 (#151)
- 스크립트 덮어쓰기와 README·.gitignore 처리 결과를 실행 로그에 남기도록 수정 (#177)
- 설치 폴더에 쓸 수 없으면 쓰기 전에 읽을 수 있는 에러로 멈추도록 수정 (#178)
- uninstall이 자기 로그를 지우며 경고를 내고 로그 폴더가 남던 문제 수정 (#158)
- status·doctor와 거부된 실행이 로그 파일을 만들지 않도록 수정 (#150)
- 같은 초에 연속 실행해도 로그가 덮어써지지 않도록 수정 (#159)
- 대화형 완전 삭제에 --purge 플래그를 반영하고 끝 개행·빈 폴더를 원상 복구 (#176)
- purge가 사용자 CHANGELOG는 남기고 .gitignore 자동 추가 항목은 제거하도록 수정 (#175)
- 완전 삭제 시 마법사가 만든 미수정 Flutter 앱 파일도 제거 (#173)
- 마커가 있어도 설치 기록에 없는 사용자 워크플로우는 제거하지 않도록 수정 (#174)
- --paths에서 타입을 추론하고 루트 마커가 없으면 하위 폴더를 안내 (#195)
- Expo·React Native 감지를 의존성 키로 판정하고 app.config 구성 지원 (#193, #194)
- 터미널 폭을 넘어 접히는 줄을 세어 다시 그릴 때 화면이 복제되지 않도록 수정 (#222)
- TERM=dumb에서 색상과 커서 제어 시퀀스를 출력하지 않도록 수정 (#223)
- doctor의 Copilot 안내가 실제 copilot_ai 설정값을 보여주도록 수정 (#190)
- doctor가 이름에 점이 있는 GitHub 레포를 인식하도록 수정 (#189)
- 레포 밖을 가리키는 프로젝트 경로를 거부 (#202)
- --project-version 형식을 x.y.z로 검증 (#201)
- 포트·SSH 인증 방식·JDK 버전 입력값 형식을 검증해 다시 묻도록 수정 (#226)
- 번들 질문 문구에 빠진 ask 키 라벨·도움말 추가 (#224)
- wizard-prompts.yml 사용자 재정의를 번들 문구와 키 단위로 병합 (#220)
- 서버 배포 워크플로우가 있는 타입에서만 배포 방식을 묻고 기록하도록 수정 (#218)
- 스토어 저장값 없는 기존 Flutter 설치를 CLI로 업데이트할 때 설치된 스토어를 추론 (#172)
- 대화형 Flutter 스토어 기본 선택을 CLI 기본값(둘 다)과 맞춤 (#219)
- 대화형에서도 --copilot 플래그를 반영하고 확인·수정 화면에서 Copilot 설정을 바꿀 수 있게 수정 (#156)
- 완료 화면에 설치 파일 커밋·develop 반영과 첫 릴리스 전 CHANGELOG 링크 안내 추가 (#212)
- 브랜치 이름 입력값을 검증해 공백·잘못된 이름이 워크플로우에 기록되지 않게 수정 (#221)
- 빈 원격에서 릴리스 브랜치가 (unknown)으로 기록되지 않게 하고 develop 미생성을 안내 (#154, #225)
- 마커 파일이 없는 경로 입력 루프를 Enter로 빠져나갈 수 있게 수정 (#217)
- Ctrl+C 입력 시 기본값으로 진행하지 않고 설치를 중단하도록 수정 (#216)
- 모노레포에서 타입별 배포 이미지와 컨테이너 이름이 겹치지 않도록 접미사 추가 (#236)
- 배포, 프리뷰 워크플로우가 빠진 Secret과 Dockerfile을 먼저 점검하도록 추가 (#232, #197)
- 존재하지 않는 이슈 번호는 PR 본문 Closes 연결에서 제외 (#215)
- 테스트 빌드는 서명 시크릿이 없으면 debug 서명으로 진행 (#239)
- 한글·영문 외 제목도 브랜치명과 커밋 제목이 비지 않도록 수정 (#187)
- AI 요약 엔진이 실패해 fallback되면 사유를 Actions 경고와 결과 JSON에 남기도록 수정 (#157)
- React, Next CI에서 test 스크립트가 있으면 테스트를 실행하도록 수정 (#233)
- 규칙 기반 노트에 호환성 깨짐 섹션을 추가하고 성능·의존성·WIP를 분리 (#213)
- Flutter CI 변경 감지가 push 때 이번 push 커밋만 비교하도록 수정 (#228)
- semver 판정에서 대문자 타입·BREAKING CHANGE 푸터를 인식하고 비표준 단어의 !는 major로 보지 않도록 수정 (#184)
- Python CI가 Dockerfile 없이도 의존성 설치와 pytest로 검증하도록 변경 (#235)
- 수동 실행 배포 모드 기본값이 설치 시 선택한 모드를 따르도록 수정 (#205)
- 같은 버전 CHANGELOG 갱신 시 중복 대신 교체하고 깨진 JSON은 덮어쓰지 않도록 수정 (#183)
- 빈 서명 시크릿이면 명확히 실패하도록 변경 (#239)
- export의 CHANGELOG.md 폴백 정규식이 동작하도록 수정 (#186)
- --paths 하위 폴더에서 빌드와 Docker 빌드가 실행되도록 수정 (#192)
- 버전 감지가 주 타입을 우선하고 setup.py·prerelease 버전도 읽도록 수정 (#204)
- 버전 쓰기·동기화 실패를 exit 1로 알리도록 수정 (#185)
- iOS TestFlight 배포 전에 Secret과 ExportOptions 플레이스홀더를 먼저 검사 (#231)
- Flutter build number가 pubspec 값보다 작아지지 않도록 수정 (#182)
- gradlew·Podfile이 없는 기본 Flutter 프로젝트에서도 빌드되도록 가드 추가 (#230)
- Maven pom.xml의 프로젝트 버전도 동기화하도록 구현 (#180)
- Flutter SDK를 stable 최신으로 받도록 버전 고정 해제 (#229)
- React, Next CI가 PR에서도 실행되도록 pull_request 트리거 추가 (#234)
- Gradle의 kotlin_version 같은 변수를 앱 버전으로 감지·변경하지 않도록 수정 (#179)
- CI 변경 감지가 push에서 직전 커밋 대비로 판별하도록 수정 (#228)

**📝 Documentation**
- 한국어·중국어·일본어 README 추가 및 문서 사이트 링크 정리 (#258)
- 남은 이전 구현 참조 주석을 정리하고 모듈 구조·버전 규칙 설명을 현재 코드에 맞게 수정 (#272)
- 타입 추가 확인 명령과 일관성 테스트 설명을 실제 동작에 맞게 수정 (#272)
- 타입 추가 가이드를 핸들러 테이블·공용 픽스처·문서 사이트 절차로 갱신 (#272)
- 레포에 없는 이전 구현을 가리키는 주석 정리 (#272)
- 아키텍처 문서와 타입 추가 가이드 작성 (#272)
- 옛 버전 doctor 링크용 앵커 유지와 Release 이벤트 워크플로우의 PAT 필요 안내 추가 (#257)
- 한국어 문서에 삭제 로그 설명 변경 반영 (#257)
- README를 첫 화면 중심으로 재구성하고 영어를 기본 언어로 전환 (#257)
- React/Next 배포 Secret 표에 SSH 키 인증을 반영하고 status의 네트워크 설명을 정정 (#260)
- 데모 영상 포스터를 마법사 화면이 보이는 장면으로 변경 (#260)
- 설치 과정 데모 GIF, MP4와 재녹화용 vhs 스크립트 추가 (#259)
- 종료 코드 처리 주석을 현재 동작에 맞게 수정
- README·ROADMAP·도움말을 현재 모드와 옵션, 실제 출력에 맞게 수정 (#164)

**♻️ Refactoring**
- semver_auto·copilot 기본값 규칙을 한 함수로 합치기 (#270)
- 타입별 워크플로우 원본 폴더 경로를 typeWorkflowDirs로 모으기 (#270)
- 스크립트 목록과 payload 워크플로우 이름 수집을 한 곳에서 쓰기 (#270)
- CliError와 경로 정규화 유틸을 core로 옮기기 (#270)
- version_manager 타입별 읽기·동기화를 핸들러 테이블로 정리 (#274)
- 타입 정의를 core/types.js 레지스트리로 모으기 (#269)

**✅ Tests**
- 타입 목록 검사가 영어 README 표와 한국어 문서를 함께 확인하도록 수정 (#257)
- 문서 사이트 명령 예시·도움말·패키지 분리를 검사하는 테스트 추가 (#260)
- JS·Python 버전 파싱이 같은 예시 파일을 공유하도록 테스트 추가 (#274)
- 공통 워크플로우·스크립트 사본 전체 동일성 검사 추가 (#271)
- 지원 타입 목록 일관성 검사 추가 (#268)
- changelog 테스트가 Windows에서도 UTF-8로 출력을 읽도록 수정

**🔧 Changes**
- main 브랜치의 릴리스 버전 커밋을 develop에 병합
- 이슈 템플릿 기본 라벨을 새 라벨 체계로 변경 (#255)
- 로컬 개발 도구 설정과 개인 작업 문서를 저장소 추적에서 제외

---

## [0.12.2] - 2026-09-26

**PR:** #244  

**🐛 Fixes**
- Copilot_기본_모델_claude_haiku_4_5_이_Actions에서_거부되어_기본_상태로는_AI_요약과_SemVer_보조_판정이_동작하지_않음 — Copilot 호출을 auto 모델로 고정하고 COPILOT_MODEL 오버라이드 제거

**📝 Documentation**
- Copilot auto 모델 고정 구현 계획 작성 (#153)

**🔧 Changes**
- develop 브랜치 병합 (#153)
- Playwright MCP 산출물 디렉터리를 gitignore에 추가 (#153)

---

## [0.12.1] - 2026-09-26

**PR:** #242  

**📝 Documentation**
- 남은 코드 주석의 리뷰 식별자와 파이썬 주석 이슈번호 제거 (#240)
- README·ROADMAP 정합성 정리 및 원본 도구명 언급 제거 (#240)
- 워크플로우 주석 장식 제거 및 payload·.github 사본 동기화 (#240)
- 코드 주석에서 이슈번호와 AI 작업 흐름 잔재 제거 (#240)

**♻️ Refactoring**
- 더 이상 쓰이지 않는 optionalCopied 카운터 제거 (#240)
- Secret 서버 백업 워크플로우와 secret_backup 옵션 제거 (#240)
- Spring nexus·GitHub Packages publish opt-in 제거 및 Spring CI 상시 설치 (#240)

**🔧 Changes**
- docs/를 .gitignore에 추가하고 git 추적에서 제외 (#240)

---

## [0.12.0] - 2026-09-24

**PR:** #136  

**✨ Features**
- 워크플로우를 opt-in Copilot 게이트·엔진 표기·중립 PR Summary 라벨로 전환 (#134)
- 마법사에 Copilot AI 요약 opt-in 옵션(copilot_ai)과 --copilot 플래그 추가 (#134)
- GitHub Models 티어를 opt-in Copilot CLI로 교체하고 죽은 API 기본값 제거 (#134)

**🐛 Fixes**
- 요구 문구에서 종료된 서비스 명칭을 제거하도록 docstring 정정 (#134)

**📝 Documentation**
- GitHub Models 종료 대응 Copilot CLI 엔진 교체 구현 계획 작성 (#134)
- 표방 문구에서 기본 동작과 다른 AI 릴리스 자동화 수식을 정정 (#134)
- GitHub Models 종료와 Copilot 과금·opt-in 옵션에 맞게 안내 문구와 README 정정 (#134)

---

## [0.11.0] - 2026-09-23

**PR:** #133  

**✨ Features**
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

**🐛 Fixes**
- 실제 확인 카드(printAnalysisCard)에 Flutter 옵션 표시
- 확인 화면에 Flutter 옵션 표시·스토어 해제 시 배포 모드 초기화
- 비대화형 설치 요약에 Flutter 스토어 정리·생성 결과 표시

**📝 Documentation**
- Flutter 모노레포 필터·dart-define·스토어 배포 구현 계획 작성
- breaking-changes 고지와 README에 Flutter 스토어 배포 문서화

**✅ Tests**
- status 명령의 스토어 필터 검증 — 실제 파일 삭제 시나리오 추가
- status 명령의 스토어 필터 오탐 방지 시나리오 보강

---

## [0.10.0] - 2026-09-21

**PR:** #130  

**✨ Features**
- 댓글 명령어와 이슈 마커에서 SUH-LAB 종속 이름 제거

**📝 Documentation**
- SUH-LAB 종속 네이밍 일반화 구현 계획 작성
- 원본·라이선스 출처 표기 정리

**♻️ Refactoring**
- 원본 도구명·템플릿명 코드 식별자를 일반 이름으로 정리
- heredoc 센티널 접두사를 __SUH_에서 __WIZARD_로 변경

**✅ Tests**
- 원작자 종속 이름 재유입 방지 가드 추가

**🔧 Changes**
- 이 레포 issue helper의 브랜치 자동 생성 활성화
- docs/suh-template/hypercortex 폴더를 docs/hypercortex로 이동

---

## [0.9.0] - 2026-08-29

**PR:** #125  

**✨ Features**
- 진입점에 로거 배선 및 uninstall·purge 기록 추가
- full 파이프라인 전 구간 계측 및 요약 블록 기록
- 워크플로우 복사 결정과 사유를 실행 로그에 기록
- 로그 라인 기록·요약 블록·쓰기 실패 시 no-op 전환 추가
- 실행 추적 로거 코어 추가 — 파일 생성·gitignore 자동화·회전

**🐛 Fixes**
- 이슈_자동_종료_Closes_N_연결이_EnterWorktree류_브랜치명_없음_에서_항상_실패함 — 브랜치명 이슈 번호 추출 정규식이 EnterWorktree류 브랜치명(# 없음)을 매칭하지 못하던 문제 수정

**📝 Documentation**
- 이슈 #122 구현 완료 보고서 추가
- 이슈 #122 본문 기록
- 설치 기록을 실행 추적 로그로 교체한 내용 반영

**♻️ Refactoring**
- install-log.js 제거하고 실행 로그로 일원화
- 설치 요약을 실행 로그 안내로 교체하고 테스트 분리

---

## [0.8.2] - 2026-08-26

**PR:** #120  

**🐛 Fixes**
- 이슈헬퍼 워크플로우 브랜치 자동생성 시 contents 권한 부족 문제 수정 (#118)

---

## [0.8.1] - 2026-08-25

**PR:** #117  

**🐛 Fixes**
- version.yml deploy 블록에 __PROJECT_NAME__ 토큰이 미치환 상태로 기록되는 문제 수정 (#114)

---

## [0.8.0] - 2026-08-25

**PR:** #115  

**✨ Features**
- ENABLE_VOLUME_MOUNT가_마법사에서_질문되지_않고_항상_false로_고정_설치됨 — ENABLE_VOLUME_MOUNT·NGINX VOLUME_CONTAINER_PATH에 @wizard ask 마커 추가

**🐛 Fixes**
- env-plan.test.js 병합 충돌 오처리로 누락된 닫는 괄호 복원
- 마법사 환경설정 기본값 표시에서 __PROJECT_NAME__ 미치환 문제 수정 (#110)

**📝 Documentation**
- PROJECT_NAME 토큰 표시 버그 수정 계획 추가 (#110)

**♻️ Refactoring**
- wizard-env에 replaceProjectTokens 헬퍼 추출

**✅ Tests**
- ENABLE_VOLUME_MOUNT·VOLUME_CONTAINER_PATH 노출 회귀 테스트 추가

---

## [0.7.0] - 2026-08-25

**PR:** #115  

**✨ Features**
- ENABLE_VOLUME_MOUNT가_마법사에서_질문되지_않고_항상_false로_고정_설치됨 — ENABLE_VOLUME_MOUNT·NGINX VOLUME_CONTAINER_PATH에 @wizard ask 마커 추가

**🐛 Fixes**
- 마법사 환경설정 기본값 표시에서 __PROJECT_NAME__ 미치환 문제 수정 (#110)

**📝 Documentation**
- PROJECT_NAME 토큰 표시 버그 수정 계획 추가 (#110)

**♻️ Refactoring**
- wizard-env에 replaceProjectTokens 헬퍼 추출

**✅ Tests**
- ENABLE_VOLUME_MOUNT·VOLUME_CONTAINER_PATH 노출 회귀 테스트 추가

---

## [0.6.0] - 2026-08-24

**PR:** #109  

**✨ Features**
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

**🐛 Fixes**
- payload/version.yml.template·README 3축 표에 go 타입 누락 반영 (fable5 리뷰 발견)
- paths-resolve.js에 go 타입 등록 (--force 설치 차단 버그 수정)
- doctor의 WORKFLOW_PAT 미등록 판정을 WARN에서 INFO로 낮춤

**📝 Documentation**
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

**✅ Tests**
- go 프로젝트 타입 e2e 설치 매트릭스 추가

**🔧 Changes**
- 실수로 커밋된 package-lock.json 추적 해제
- .github/workflows/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml를 payload 사본과 동기화
- .github/workflows/PROJECT-COMMON-AI-PR-SUMMARY.yaml를 payload 사본과 동기화
- .github/scripts/changelog_manager.py를 payload 사본과 동기화
- .github/scripts/issue_helper.py를 payload 사본과 동기화
- 로컬 스크래치 폴더를 gitignore에 추가

---

## [0.5.1] - 2026-08-23

**PR:** #104  

**🐛 Fixes**
- NEXUS-PUBLISH 워크플로우 JAVA_VERSION을 @wizard 마커로 교체
- NEXUS-CI 워크플로우 JAVA_VERSION을 @wizard 마커로 교체

**📝 Documentation**
- fable5 plan 리뷰 피드백 반영
- NEXUS 워크플로우 JAVA_VERSION 마커화 계획 문서 추가

**✅ Tests**
- spring 워크플로우 java-version 하드코딩 검출 테스트 추가

---

## [0.5.0] - 2026-08-23

**PR:** #101  

**✨ Features**
- PYTHON_VERSION_하드코딩_및_미사용_정리 — Python CI/CD 워크플로우 2개에서 어디에도 참조되지 않는 PYTHON_VERSION 하드코딩 선언 제거

---

## [0.4.0] - 2026-08-23

**PR:** #98  

**✨ Features**
- 릴리스_파이프라인_후속_워크플로우_트리거를_repository_dispatch_방식으로_전환 — AUTO-CHANGELOG-CONTROL·VERSION-CONTROL·RELEASE-PUBLISH에 workflow_dispatch 기반 자동 트리거를 추가해 WORKFLOW_PAT 없이도 릴리스 파이프라인이 끊기지 않도록 함
- 이슈 생성 시 브랜치 자동 생성 여부를 설치 마법사 질문으로 노출
- trunk-based 선택 시 개발 브랜치 질문을 생략하도록 대화형 흐름 변경
- 기본값이 true/false인 ask 필드는 텍스트 대신 예/아니오 토글로 입력받기
- 브랜치 전략(pr-flow/trunk-based)을 먼저 선택하는 프롬프트 추가
- collectAsks가 payload/workflows/common 최상위를 무조건 스캔하도록 확장

**🐛 Fixes**
- 환경설정 안내 문구에서 부정확해진 '배포' 표현 제거

**📝 Documentation**
- 이슈 헬퍼 브랜치 마법사 토글 계획 문서 추가
- 이슈 #90 구현 계획 문서 추가
- 브랜치 전략 질문 관련 README/DESIGN-SPEC 문서 반영 및 note 문구 다듬기
- 브랜치 전략 명시적 선택 구현 계획 추가 (이슈 #93)

**✅ Tests**
- 릴리스 파이프라인 workflow_dispatch 트리거 회귀 테스트 추가

**🔧 Changes**
- 이 레포 자신의 ISSUE-HELPER 워크플로우 사본에도 wizard 마커 동기화

---

## [0.3.3] - 2026-08-18

**PR:** #89  

**📝 Documentation**
- AI-PR-SUMMARY 헤더 주석의 어색한 줄바꿈 정리

---

## [0.3.0] - 2026-08-12

**PR:** #84  

**✨ Features**
- 설치 마법사 출력 순서와 안내 정합성 정리 — 서버 배포 방식을 하나 고르게 하고 고른 CD만 설치하며 push 트리거까지 활성화

**🐛 Fixes**
- build.gradle.kts, pom.xml 버전 감지 누락으로 항상 0.0.1 사용 — PR 프리뷰 안내 주석의 원저자 개인 도메인을 예시 도메인으로 교체
- build.gradle.kts, pom.xml 버전 감지 누락으로 항상 0.0.1 사용 — Kotlin DSL·Maven 버전과 JDK·application.yaml 감지 수정, 미치환 검증·설치 로그·타입 확정 단계 추가 (#78 #79 #80 #81 #82)

**♻️ Refactoring**
- 설치 마법사 출력 순서와 안내 정합성 정리 — 하위호환 분기를 걷어내고 배포 방식을 항상 택1로 단순화, 이전 워크플로우는 마법사가 정리

**🔧 Changes**
- 설치 마법사 감지·치환·템플릿·UX 전면 수정 (#77 #78 #79 #80 #81 #82)

---

## [0.2.0] - 2026-08-10

**PR:** #74  

**✨ Features**
- 설치 시점 baseline 기반 3-way 분류로 업데이트 지원 (#69)

**🔧 Changes**
- develop 최신 내용을 #69 작업 브랜치에 동기화
- wip: baseline 모듈 초안 (#69)

---

## [0.1.34] - 2026-08-10

**PR:** #72  

**♻️ Refactoring**
- 부분 설치·되돌리기 모드 제거 — full/uninstall/status/doctor로 정리 (#70)

---

## [0.1.33] - 2026-08-10

**PR:** #67  

**🐛 Fixes**
- 릴리스가 스킵될 때 버전-태그 드리프트를 감지해 실패시킴 (#61)

---

## [0.1.32] - 2026-08-10

**PR:** #64  

**🐛 Fixes**
- project_types 인라인 주석 때문에 파싱이 항상 실패하던 문제 수정 (#62)

**♻️ Refactoring**
- version.yml 레거시 단수 키 project_type 제거 (#62)

**🔧 Changes**
- main 최신 릴리스(v0.1.31) 내용을 develop에 동기화

---

## [0.1.26] - 2026-08-07

**PR:** #55  

*No change information*

---

## [0.1.25] - 2026-08-06

**PR:** #53  

**🔧 Changes**
- payload_워크플로우_GitHub_Actions_최신화 — 설치되는 워크플로우의 GitHub Actions를 최신 메이저로 일괄 갱신

---

## [0.1.24] - 2026-08-06

**PR:** #49  

**📝 Documentation**
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

