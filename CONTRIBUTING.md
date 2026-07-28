# Contributing to project-auto-wizard

기여해 주셔서 감사합니다! 이 문서는 로컬 개발 환경 설정과 PR 규칙을 안내합니다.

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
node bin/project-auto-wizard.js --mode full --force --type node
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
- 워크플로우 YAML을 수정할 때는 **`payload/workflows/`가 단일 진실**입니다. `.github/workflows/`에 있는 것은 이 레포 자신에게 설치된 산출물(도그푸딩)이며, `payload/` 변경 후 브랜치 플레이스홀더(`{{MAIN_BRANCH}}` → `main`, `{{DEVELOP_BRANCH}}` → `develop`)를 치환해 수동으로 동기화해야 합니다.
- 커밋 메시지는 [Conventional Commits](https://www.conventionalcommits.org/) 형식을 따릅니다(`feat:`, `fix:`, `docs:`, `chore:` 등).

## PR 규칙

1. `main`이 아니라 `develop` 브랜치를 기준으로 브랜치를 따세요.
2. PR은 `develop`을 향해 엽니다(이 레포는 pr-flow 브랜치 모드를 사용합니다).
3. `npm test`가 통과하는지 확인하세요.
4. PR 설명에 "무엇을 왜 바꿨는지"를 적어 주세요.

## 이슈

버그 리포트나 기능 제안은 이슈 템플릿을 사용해 등록해 주세요. `good first issue` 라벨이 붙은 이슈는 처음 기여하기 좋은 항목들입니다.
