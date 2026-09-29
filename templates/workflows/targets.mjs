// 생성 대상 목록: 어떤 조각(template)에 어떤 값(vars)을 채워 payload의 어느 파일(out)을 만드는지 선언한다.
// 값 규칙은 scripts/generate-workflows.mjs 머리말 참고 — 문자열은 인라인 치환, 배열은 자리표시자 한 줄 전체를 대체한다.
//
// 이 파일이나 조각을 고쳤다면 `npm run generate:workflows`로 payload를 다시 만들고 함께 커밋한다.

// Go/Python PR 프리뷰가 공유하는 조각. 타입별로 다른 곳만 vars에 둔다.
const PR_PREVIEW = "pr-preview.base.yaml";

export const TARGETS = [
  {
    out: "payload/workflows/go/PROJECT-GO-PR-PREVIEW.yaml",
    template: PR_PREVIEW,
    vars: {
      TYPE_UPPER: "GO",
      SUFFIX: "go",
      INTERNAL_PORT: "8080",
      HEADER_TITLE: [
        "# Go PR Preview (SSH + Docker + Traefik)",
        "# PR 또는 Issue 코멘트 명령어를 통해 Preview 환경을 자동으로 관리합니다. Traefik 리버스 프록시로 동적 라우팅됩니다.",
      ],
      HEADER_SECRETS: [
        "# DOCKERHUB_USERNAME / DOCKERHUB_TOKEN: Docker Hub 사용자명 / 액세스 토큰",
        "# SERVER_HOST / SERVER_USER: 서버 호스트(SSH 접속 주소) / SSH 사용자명",
      ],
      SETTINGS_TITLE: ["# [영역 1] 프로젝트별 설정 - 다른 프로젝트에서 사용 시 이 섹션만 수정하세요"],
      HEALTH_BLOCK: [
        "#   Go (net/http 등): '/health', 'listening on'",
        "HEALTH_CHECK_PATH: '/health'",
        "HEALTH_CHECK_LOG_PATTERN: 'listening on'",
        "API_DOCS_PATH: ''",
      ],
      BUILD_FAIL_HINTS: [
        "'- Docker 이미지 빌드 실패 (Go 의존성/빌드 문제)',",
        "'- 컨테이너 시작 실패 (애플리케이션 기동 오류)',",
      ],
      PR_CHECK_COMMENT: ["# PR인지 Issue인지 확인"],
      PARSE_COMMENT: ["# 명령어 파싱 (브랜치 파라미터 지원)"],
      SHA_COMMENT: ["# 브랜치의 최신 커밋 SHA 가져오기"],
      HEALTH_COMMENT: ["# Health Check"],
      ENV_OPEN: ["# [영역 2] 환경변수 파일 생성"],
      ENV_CLOSE: ["# [영역 2 끝] 환경변수 파일 생성 끝"],
    },
  },
  {
    out: "payload/workflows/python/PROJECT-PYTHON-PR-PREVIEW.yaml",
    template: PR_PREVIEW,
    vars: {
      TYPE_UPPER: "PYTHON",
      SUFFIX: "python",
      INTERNAL_PORT: "8000",
      HEADER_TITLE: [
        "# Python/FastAPI PR Preview (SSH + Docker + Traefik)",
        "# PR 또는 Issue 코멘트 명령어를 통해 Preview 환경을 자동으로 관리합니다.",
        "# Traefik 리버스 프록시를 통해 동적 라우팅됩니다.",
      ],
      HEADER_SECRETS: [
        "# DOCKERHUB_USERNAME: Docker Hub 사용자명",
        "# DOCKERHUB_TOKEN: Docker Hub 액세스 토큰",
        "# SERVER_HOST: 서버 호스트(SSH 접속 주소)",
        "# SERVER_USER: SSH 사용자명",
      ],
      SETTINGS_TITLE: ["# 프로젝트별 설정: 다른 프로젝트에서 사용 시 이 섹션만 수정하세요"],
      HEALTH_BLOCK: [
        "HEALTH_CHECK_PATH: '/docs'",
        "HEALTH_CHECK_LOG_PATTERN: 'Uvicorn running on|Application startup complete'",
        "API_DOCS_PATH: '/docs'",
      ],
      BUILD_FAIL_HINTS: [
        "'- Docker 이미지 빌드 실패 (Python 의존성 문제)',",
        "'- 컨테이너 시작 실패 (FastAPI/Uvicorn 기동 오류)',",
      ],
      // Python 쪽에는 없는 안내 주석이라 빈 배열로 줄 자체를 없앤다
      PR_CHECK_COMMENT: [],
      PARSE_COMMENT: [],
      SHA_COMMENT: [],
      HEALTH_COMMENT: [],
      ENV_OPEN: ["# 환경변수 파일 생성 (프로젝트별 수정 영역)"],
      ENV_CLOSE: [],
    },
  },
];
