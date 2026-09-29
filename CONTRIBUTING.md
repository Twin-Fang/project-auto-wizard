# Contributing to project-auto-wizard

기여해 주셔서 감사합니다! 이 문서는 로컬 개발 환경 설정과 PR 규칙을 안내합니다.

코드 구조와 설치 흐름은 [ARCHITECTURE.md](ARCHITECTURE.md), 새 프로젝트 타입을 추가하는 절차는 [ADDING-A-PROJECT-TYPE.md](ADDING-A-PROJECT-TYPE.md)를 참고하세요.

## 개발 환경 설정

```bash
git clone https://github.com/Twin-Fang/project-auto-wizard.git
cd project-auto-wizard
npm install --no-save   # 런타임 의존성은 0개지만 devDependencies가 있다면 설치
```

Node.js 20.12 이상, Python 3(테스트 실행용)이 필요합니다.

## 로컬에서 마법사 실행하기

```bash
node bin/project-auto-wizard.js --help
node bin/project-auto-wizard.js --mode full --force --type node --dry-run   # 이 레포에서는 미리보기만
```

## 테스트

```bash
npm test          # node --test + python unittest 전체
npm run test:node # Node 테스트만 (tests/node/**/*.test.js)
npm run test:py   # Python 테스트만 (tests/py)
```

새 기능을 추가하거나 버그를 고칠 때는 반드시 해당 동작을 커버하는 테스트를 함께 추가해 주세요.

## 코드 스타일

- **Node 쪽(`src/`, `bin/`)**: 외부 의존성을 추가하지 않습니다. `node:*` 내장 모듈만 사용합니다.
- **Python 쪽(`payload/scripts/`)**: stdlib만 사용합니다(GitHub Actions ubuntu 러너에 기본 탑재된 python3만으로 동작해야 함).
- 워크플로우 YAML과 파이썬 스크립트를 수정할 때는 **`payload/`가 단일 진실**입니다. `.github/workflows/PROJECT-COMMON-*.yaml`과 `.github/scripts/*.py`는 이 레포 자신에게 설치된 사본(도그푸딩)이므로 직접 고치지 말고, `payload/`를 고친 뒤 `npm run sync:dogfood`로 다시 만드세요. 브랜치 플레이스홀더(`{{MAIN_BRANCH}}` → `main`, `{{DEVELOP_BRANCH}}` → `develop`)는 스크립트가 치환합니다.
  - 사본에만 필요한 차이(ISSUE-HELPER 기본값, RELEASE-PUBLISH의 NPM-PUBLISH 트리거 스텝)는 `scripts/sync-dogfood.mjs`의 `PATCHES`에 선언합니다. 새 차이가 필요하면 사본을 손으로 고치지 말고 이 목록에 추가하세요.
  - `npm run sync:dogfood:check`는 파일을 쓰지 않고 비교만 하며, 어긋나면 실패합니다. `npm test`에도 같은 검사(`tests/node/dogfood-parity.test.js`)가 들어 있습니다.
- 커밋 메시지는 [Conventional Commits](https://www.conventionalcommits.org/) 형식을 따릅니다(`feat:`, `fix:`, `docs:`, `chore:` 등 타입 접두사는 영어). 단, 접두사 뒤 설명 부분은 **한국어로 작성**합니다. 예: `feat: 로그인 실패 시 재시도 로직 추가`

## PR 규칙

1. `main`이 아니라 `develop` 브랜치를 기준으로 브랜치를 따세요.
2. PR은 `develop`을 향해 엽니다(이 레포는 pr-flow 브랜치 모드를 사용합니다).
3. `npm test`가 통과하는지 확인하세요.
4. PR 설명에 "무엇을 왜 바꿨는지"를 적어 주세요.

## 이슈

버그 리포트나 기능 제안은 이슈 템플릿을 사용해 등록해 주세요. `good first issue` 라벨이 붙은 이슈는 처음 기여하기 좋은 항목들입니다.
