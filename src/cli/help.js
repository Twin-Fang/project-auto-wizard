// --help 텍스트.
export const HELP_TEXT = `project-auto-wizard — One command DevOps: GitHub-native AI 릴리스 자동화 설치 마법사

사용법:
  npx project-auto-wizard [옵션]

옵션:
  -m, --mode MODE          통합 모드 (full | version | workflows)
                           기본: interactive (대화형)
  -t, --type CSV           프로젝트 타입 csv (예: spring,react,python)
                           지원: spring flutter next react react-native
                                 react-native-expo node python basic
      --project-version V  통합 대상의 초기 버전 (예: 1.0.0). 미지정 시 자동 감지
      --paths "t=p,..."    타입별 프로젝트 경로 (모노레포). 예: flutter=app,react=client
      --main-branch B      릴리스 브랜치 (기본: 감지된 default branch)
      --develop-branch B   개발 브랜치 (기본: develop). 릴리스 브랜치와 같으면 trunk-based 모드
      --nexus / --no-nexus            Nexus 라이브러리 publish 워크플로우 포함/제외
      --secret-backup / --no-secret-backup   Secret 백업 워크플로우 포함/제외
      --force              모든 확인 생략, 비대화형 기본값 사용
  -v, --version            project-auto-wizard 버전 출력
  -h, --help               이 도움말 표시

예시:
  npx project-auto-wizard --mode full --force --type spring,react
  npx project-auto-wizard --mode workflows --type flutter --paths "flutter=app"
`;
