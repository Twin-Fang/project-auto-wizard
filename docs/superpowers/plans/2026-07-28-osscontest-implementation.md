# 오픈소스 개발자대회 제출 범위 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `docs/superpowers/specs/2026-07-25-osscontest-scope-design.md`에서 확정한 범위(커뮤니티 거버넌스 문서, 1차 심사 보강, `status`/`doctor`/`--dry-run` 신규 명령, 자체 AI PR 요약봇, 자동 semver 승격)를 project-auto-wizard에 구현한다.

**Architecture:** 기존 아키텍처(payload 단일 진실, Node CLI + Python stdlib 워크플로우 스크립트, zero-dependency)를 그대로 따른다. 신규 명령은 `src/commands/*.js`에 기존 `runFull`/`runVersion` 패턴과 동일하게 순수 함수로 추가하고, `src/index.js`에서 배선한다. 릴리스 파이프라인 변경은 전부 `payload/scripts/*.py` + `payload/workflows/common/*.yaml`(단일 진실)에 가하고, 이 레포 자신에게 설치된 사본(`.github/scripts/`, `.github/workflows/`)에도 동일 내용을 동기화한다(도그푸딩 레포이므로).

**Tech Stack:** Node.js ≥20.12 (ESM, `node:test` + `node:assert`), Python 3(stdlib only, `unittest`), GitHub Actions YAML.

## Global Constraints

- 의존성 0개 유지 — `package.json`에 `dependencies` 추가 금지. Python 스크립트도 stdlib만 사용.
- `payload/`가 설치 자산의 단일 진실 — 워크플로우/스크립트 변경은 `payload/` 아래를 먼저 고치고, 이 레포 자신의 `.github/` 사본에 동일 내용을 수동 동기화한다(스크립트는 바이트 동일, 워크플로우는 `{{MAIN_BRANCH}}`→`main`/`{{DEVELOP_BRANCH}}`→`develop` 치환).
- 기존 함수 시그니처를 바꿀 때는 항상 하위 호환 기본값을 둔다(예: 새 옵션 인자는 optional, 기본값이 기존 동작과 동일).
- 커밋 메시지는 Conventional Commits, 코드 주석은 한국어로 "왜"만(무엇을 하는지는 코드로 설명).
- 테스트 실행: `npm run test:node`(node --test), `npm run test:py`(python -m unittest discover -s tests/py -v). 각 태스크의 "Step 4: 테스트 실행"은 이 두 커맨드 중 해당하는 것을 쓴다.
- 브레이킹 체인지 감지 인프라(`src/core/breaking-check.js`, `src/core/breaking.js`, `payload/config/breaking-changes.json`)는 이번 계획에서 **손대지 않는다** — 마법사 자체 템플릿 버전 축이라 스코프 밖(스펙 §3.3① 정정 참조).
- `doctor` 명령에는 AI 진단을 추가하지 않는다(스펙 §4에서 기각) — 규칙 기반 점검만.

---

## Phase 0 — 커뮤니티 거버넌스 문서 + README 문서화 갭

### Task 1: CONTRIBUTING.md 작성

**Files:**
- Create: `CONTRIBUTING.md`

**Interfaces:** 없음(순수 문서).

- [ ] **Step 1: 파일 작성**

```markdown
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
```

- [ ] **Step 2: 필수 섹션 존재 확인**

```bash
grep -q "^## 개발 환경 설정" CONTRIBUTING.md && grep -q "^## 테스트" CONTRIBUTING.md && grep -q "^## PR 규칙" CONTRIBUTING.md && echo OK
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "docs: add CONTRIBUTING.md"
```

### Task 2: CODE_OF_CONDUCT.md 작성

**Files:**
- Create: `CODE_OF_CONDUCT.md`

- [ ] **Step 1: 파일 작성** (Contributor Covenant v2.1 한국어 축약판)

```markdown
# 행동 강령 (Code of Conduct)

## 우리의 약속

project-auto-wizard 커뮤니티는 나이, 신체 조건, 장애, 민족, 성 정체성 및 표현, 경험 수준, 국적, 외모, 인종, 종교, 성적 정체성과 지향에 관계없이 모두에게 괴롭힘 없는 경험을 제공하는 것을 약속합니다.

## 우리의 기준

긍정적인 환경에 기여하는 행동의 예:

- 다른 관점과 경험을 존중하기
- 건설적인 비판을 정중하게 수용하기
- 커뮤니티에 가장 도움이 되는 방향에 집중하기

용납되지 않는 행동의 예:

- 성적인 언어나 이미지 사용, 원치 않는 성적 관심이나 접근
- 트롤링, 모욕적/경멸적 댓글, 인신공격 또는 정치적 공격
- 공개적·사적인 괴롭힘
- 명시적 허가 없이 타인의 개인정보(주소 등)를 공개하는 행위

## 적용 범위

이 행동 강령은 프로젝트 공간(이슈, PR, Discussions) 및 개인이 프로젝트나 커뮤니티를 대표할 때 적용됩니다.

## 신고

부적절한 행동은 이슈 또는 저장소 관리자에게 비공개로 신고할 수 있습니다. 모든 신고는 신중하고 공정하게 검토됩니다.

---
[Contributor Covenant](https://www.contributor-covenant.org) v2.1을 기반으로 작성되었습니다.
```

- [ ] **Step 2: 확인**

```bash
grep -q "행동 강령" CODE_OF_CONDUCT.md && echo OK
```

- [ ] **Step 3: Commit**

```bash
git add CODE_OF_CONDUCT.md
git commit -m "docs: add CODE_OF_CONDUCT.md"
```

### Task 3: SECURITY.md 작성

**Files:**
- Create: `SECURITY.md`

- [ ] **Step 1: 파일 작성**

```markdown
# 보안 정책

## 지원 버전

가장 최신 릴리스 버전만 보안 패치 지원 대상입니다(`npm view project-auto-wizard version` 참고).

## 취약점 신고 방법

**공개 이슈로 등록하지 마세요.** project-auto-wizard 또는 이 도구가 생성하는 GitHub Actions 워크플로우에서 보안 취약점(예: 시크릿 유출 경로, 명령 주입, 권한 상승)을 발견하면 GitHub의 [비공개 보안 권고(Private Security Advisory)](https://github.com/Twin-Fang/project-auto-wizard/security/advisories/new) 기능으로 신고해 주세요.

## 응답 기준

- 신고 접수 후 최대한 빠르게 확인하고, 심각도에 따라 우선순위를 정해 대응합니다.
- 수정이 완료되면 CHANGELOG와 GitHub Release Notes에 보안 수정 사항을 명시합니다(신고자가 원치 않으면 익명 처리).

## 설계상 보안 원칙

- project-auto-wizard는 외부 API 키가 없어도 동작합니다(GitHub Models + `GITHUB_TOKEN`). 시크릿은 `AI_API_KEY`/`WORKFLOW_PAT` 등 명시적으로 사용자가 등록한 것만 사용합니다.
- 마법사는 npm 패키지에 동봉된 `payload/`만 읽고 쓰며, 설치 중 임의의 원격 코드를 내려받아 실행하지 않습니다.
```

- [ ] **Step 2: 확인**

```bash
grep -q "취약점 신고 방법" SECURITY.md && echo OK
```

- [ ] **Step 3: Commit**

```bash
git add SECURITY.md
git commit -m "docs: add SECURITY.md"
```

### Task 4: ROADMAP.md 작성

**Files:**
- Create: `ROADMAP.md`

- [ ] **Step 1: 파일 작성**

```markdown
# 로드맵

project-auto-wizard가 다음에 어디로 향하는지 공유합니다. 우선순위는 사용자 피드백에 따라 바뀔 수 있습니다.

## 완료됨

- npx 마법사(9타입 + 멀티타입 + 모노레포 자동 감지)
- GitHub-native AI 릴리스 자동화(API 키 0개, 4단 엔진 체인)

## 진행 중

- `status` — 설치 상태·드리프트 확인 명령
- `doctor` — 설치 환경 진단 명령
- `--dry-run` — 실제 변경 없이 미리보기
- 자체 AI PR 요약봇(CodeRabbit 비의존 대안)
- 자동 semver 승격(커밋 타입 기반 major/minor/patch)

## 검토 중

- 프로젝트 타입 커버리지 확장 여부(Go, Rust, Django, Docker 등) — 현재는 깊이 우선 전략으로 보류 중
- CLI 다국어(i18n) 지원

## 기여를 환영합니다

`good first issue` 라벨이 붙은 이슈부터 시작해 보세요. 새 프로젝트 타입이나 워크플로우를 제안하고 싶다면 이슈를 먼저 열어 논의해 주세요.
```

- [ ] **Step 2: 확인**

```bash
grep -q "^# 로드맵" ROADMAP.md && echo OK
```

- [ ] **Step 3: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: add ROADMAP.md"
```

### Task 5: GitHub 이슈/PR 템플릿 추가

**Files:**
- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Create: `.github/ISSUE_TEMPLATE/feature_request.yml`
- Create: `.github/ISSUE_TEMPLATE/config.yml`
- Create: `.github/PULL_REQUEST_TEMPLATE.md`

**Interfaces:** 없음(순수 GitHub 설정 파일).

- [ ] **Step 1: `.github/ISSUE_TEMPLATE/bug_report.yml` 작성**

```yaml
name: 버그 리포트
description: 예상과 다르게 동작하는 부분을 신고합니다
labels: ["bug"]
body:
  - type: textarea
    id: what-happened
    attributes:
      label: 무슨 일이 있었나요?
      description: 실제로 어떤 일이 발생했는지 설명해 주세요.
    validations:
      required: true
  - type: textarea
    id: expected
    attributes:
      label: 기대했던 동작
    validations:
      required: true
  - type: input
    id: command
    attributes:
      label: 실행한 명령어
      placeholder: "npx project-auto-wizard --mode full --force --type node"
    validations:
      required: true
  - type: input
    id: version
    attributes:
      label: project-auto-wizard 버전
      placeholder: "npx project-auto-wizard -v 출력값"
    validations:
      required: true
  - type: dropdown
    id: os
    attributes:
      label: OS
      options:
        - macOS
        - Linux
        - Windows
    validations:
      required: true
```

- [ ] **Step 2: `.github/ISSUE_TEMPLATE/feature_request.yml` 작성**

```yaml
name: 기능 제안
description: 새로운 기능이나 개선 사항을 제안합니다
labels: ["enhancement"]
body:
  - type: textarea
    id: problem
    attributes:
      label: 어떤 문제를 해결하고 싶으신가요?
    validations:
      required: true
  - type: textarea
    id: proposal
    attributes:
      label: 제안하는 해결 방법
    validations:
      required: true
  - type: textarea
    id: alternatives
    attributes:
      label: 고려한 다른 방법(선택)
    validations:
      required: false
```

- [ ] **Step 3: `.github/ISSUE_TEMPLATE/config.yml` 작성**

```yaml
blank_issues_enabled: false
contact_links:
  - name: 질문 / 논의
    url: https://github.com/Twin-Fang/project-auto-wizard/discussions
    about: 버그도 기능 제안도 아닌 질문은 Discussions를 이용해 주세요.
```

- [ ] **Step 4: `.github/PULL_REQUEST_TEMPLATE.md` 작성**

```markdown
## 무엇을 변경했나요?

## 왜 필요한가요?

## 테스트

- [ ] `npm run test:node` 통과
- [ ] `npm run test:py` 통과
- [ ] (해당 시) 새 동작을 커버하는 테스트를 추가했습니다

## 체크리스트

- [ ] `payload/` 변경 시, 이 레포 자신의 `.github/` 사본도 동기화했습니다(도그푸딩 레포)
- [ ] 새 의존성을 추가하지 않았습니다(zero-dependency 원칙)
```

- [ ] **Step 5: YAML 문법 검증**

```bash
npx -y js-yaml .github/ISSUE_TEMPLATE/bug_report.yml > /dev/null && echo "bug_report OK"
npx -y js-yaml .github/ISSUE_TEMPLATE/feature_request.yml > /dev/null && echo "feature_request OK"
npx -y js-yaml .github/ISSUE_TEMPLATE/config.yml > /dev/null && echo "config OK"
```

Expected: 세 줄 모두 `OK`로 끝남(파싱 에러 없음).

- [ ] **Step 6: Commit**

```bash
git add .github/ISSUE_TEMPLATE .github/PULL_REQUEST_TEMPLATE.md
git commit -m "docs: add issue and PR templates"
```

### Task 6: README.md 문서화 갭 메우기

**Files:**
- Modify: `README.md`

**Interfaces:** 없음(순수 문서 편집). 이 태스크는 `README.md`의 기존 섹션 구조를 그대로 두고 세 군데만 보강한다 — 정확한 삽입 위치는 실행 시점에 `README.md`를 열어 "지원 프로젝트 타입" 표 다음, "설치 옵션" 다음에 잡는다(파일이 이후 태스크들로 계속 바뀌므로 라인 번호 대신 앵커 텍스트로 지정).

- [ ] **Step 1: "지원 프로젝트 타입" 섹션 뒤에 커스터마이징 섹션 추가**

`## 지원 프로젝트 타입` 섹션(`### 지원 프로젝트 타입` 헤더가 있는 블록) 바로 뒤에 다음 블록을 삽입:

```markdown
### 질문 문구 커스터마이징

마법사가 묻는 질문의 라벨·도움말·예시 문구는 `.github/config/wizard-prompts.yml`을 만들어 재정의할 수 있습니다(설치되지 않는 파일이라 직접 만들어야 합니다). 타입별로 다른 문구를 쓰고 싶으면 `{type}.KEY` 형태로 오버라이드합니다.

```yaml
PROJECT_NAME:
  label: "프로젝트 이름이 뭔가요?"
  help: "GitHub 레포 이름과 다르게 표시하고 싶을 때만 입력하세요."

flutter.APP_ARTIFACT_NAME:
  label: "Flutter 앱 아티팩트 이름"
```

### 타입별 워크플로우 구성

`spring`/`flutter`는 아래처럼 단일 CI 이상으로 깊게 구성되어 있습니다:

- **flutter**: Android(Firebase/Playstore/Selfhosted/TestAPK 배포), iOS(TestFlight/Test-TestFlight), CI, Lab 트리거까지 8종
- **spring**: 무중단 배포 2종(Nginx/Traefik) + 단일 서버 배포 + PR 프리뷰 + Nexus publish(opt-in)
- **react/next**: CI와 CI+CD 분리 구성
- **python**: CI / PR 프리뷰 / SimpleCICD

### 되돌리기(`--mode revert`)

`npx project-auto-wizard --mode revert`는 payload가 설치한 파일명과 **정확히 일치하는 것만** 제거합니다. 사용자가 직접 만든 워크플로우, `version.yml`, `README.md`, `.gitignore`는 건드리지 않습니다. 설치 시 충돌 처리로 생성된 `.bak`/`.template.yaml` 파생 파일도 함께 정리됩니다.
```

- [ ] **Step 2: 확인**

```bash
grep -q "질문 문구 커스터마이징" README.md && grep -q "되돌리기" README.md && echo OK
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document wizard-prompts customization, type depth, and revert mode"
```

## Phase 1 — 1차 심사 보강: 테스트 커버리지 공백 + 라이선스 리포트

### Task 7: `breaking-check.js` 테스트 추가

**Files:**
- Create: `tests/node/breaking-check.test.js`

**Interfaces:**
- Consumes: `runBreakingCheck({ cwd, payloadRoot, templateVersion, askYesNo, loader })` from `src/core/breaking-check.js` (기존 시그니처, 변경 없음). `loader`는 `async (payloadRoot) => json|null` 형태의 테스트 주입점.
- Consumes: `collectBreaking(json, current, target)` from `src/core/breaking.js` — 아직 안 읽었으므로 이 태스크의 Step 1에서 먼저 실제 시그니처를 확인한다.

- [ ] **Step 1: `src/core/breaking.js`의 `collectBreaking` 시그니처 확인**

```bash
cat src/core/breaking.js
```

`collectBreaking(json, currentVersion, targetVersion)`이 `{ critical: [...], warnings: [...] }`를 반환하는지 확인하고(다르면 아래 테스트를 실제 시그니처에 맞춰 조정), 각 항목이 `{version, title, message}` 형태인지 확인한다.

- [ ] **Step 2: 실패하는 테스트 작성**

```javascript
// tests/node/breaking-check.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runBreakingCheck } from "../../src/core/breaking-check.js";

function makeRepo(templateVersion) {
  const dir = mkdtempSync(join(tmpdir(), "paw-bc-"));
  writeFileSync(
    join(dir, "version.yml"),
    `version: "1.0.0"\nmetadata:\n  template:\n    version: "${templateVersion}"\n`,
  );
  return dir;
}

test("no version.yml -> proceeds without loading breaking json", async () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-bc-empty-"));
  try {
    let loaderCalled = false;
    const proceed = await runBreakingCheck({
      cwd: dir, payloadRoot: "unused", templateVersion: "0.2.0",
      loader: async () => { loaderCalled = true; return {}; },
    });
    assert.strictEqual(proceed, true);
    assert.strictEqual(loaderCalled, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loader returns null -> proceeds (network/bundle both failed)", async () => {
  const dir = makeRepo("0.1.0");
  try {
    const proceed = await runBreakingCheck({
      cwd: dir, payloadRoot: "unused", templateVersion: "0.2.0",
      loader: async () => null,
    });
    assert.strictEqual(proceed, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no critical/warning entries for the version range -> proceeds silently", async () => {
  const dir = makeRepo("0.1.0");
  try {
    const proceed = await runBreakingCheck({
      cwd: dir, payloadRoot: "unused", templateVersion: "0.2.0",
      loader: async () => ({}),
    });
    assert.strictEqual(proceed, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("critical entry + non-interactive (askYesNo omitted) -> warns and proceeds", async () => {
  const dir = makeRepo("0.1.0");
  try {
    const json = {
      "0.2.0": { severity: "critical", title: "워크플로우 파일명 변경", message: "PROJECT-COMMON-X.yaml -> Y.yaml" },
    };
    const proceed = await runBreakingCheck({
      cwd: dir, payloadRoot: "unused", templateVersion: "0.2.0",
      loader: async () => json,
    });
    assert.strictEqual(proceed, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("critical entry + interactive confirm=false -> cancels", async () => {
  const dir = makeRepo("0.1.0");
  try {
    const json = {
      "0.2.0": { severity: "critical", title: "t", message: "m" },
    };
    const proceed = await runBreakingCheck({
      cwd: dir, payloadRoot: "unused", templateVersion: "0.2.0",
      loader: async () => json,
      askYesNo: async () => false,
    });
    assert.strictEqual(proceed, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("critical entry + interactive confirm=true -> proceeds", async () => {
  const dir = makeRepo("0.1.0");
  try {
    const json = {
      "0.2.0": { severity: "critical", title: "t", message: "m" },
    };
    const proceed = await runBreakingCheck({
      cwd: dir, payloadRoot: "unused", templateVersion: "0.2.0",
      loader: async () => json,
      askYesNo: async () => true,
    });
    assert.strictEqual(proceed, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

> 위 `json` 픽스처는 `src/core/breaking.js`의 실제 스키마(`Object.entries(json)`의 각 값을 **단일 객체** `{severity, title, message}`로 취급 — 배열이 아님)에 맞춘 것이다. Step 1에서 실제로 열어본 `breaking.js`의 스키마가 이와 다르면, 이 스키마를 Step 1에서 읽은 실제 스키마로 맞춰 고친다.

- [ ] **Step 3: 테스트 실행해 실패 확인(만약 스키마를 잘못 짚었다면 이 시점에 드러남)**

```bash
node --test tests/node/breaking-check.test.js
```

Expected: 모두 PASS (이 테스트들은 기존 구현을 검증하는 것이지 새 동작을 요구하지 않으므로 RED 단계 없이 바로 GREEN이어야 정상. FAIL이 나오면 Step 1의 스키마 확인이 틀린 것 — `breaking.js`를 다시 읽고 고친다).

- [ ] **Step 4: Commit**

```bash
git add tests/node/breaking-check.test.js
git commit -m "test: add coverage for breaking-check.js"
```

### Task 8: `wizard-labels.js` 테스트 추가

**Files:**
- Create: `tests/node/wizard-labels.test.js`

**Interfaces:**
- Consumes: `parseWizardPrompts(text)`, `loadWizardPrompts(targetRoot, payloadRoot, fs)`, `wfField(prompts, type, key, field)`, `workflowDisplayName(prompts, filename)` from `src/core/wizard-labels.js` (기존 시그니처, 변경 없음).

- [ ] **Step 1: 테스트 작성**

```javascript
// tests/node/wizard-labels.test.js
import { test } from "node:test";
import assert from "node:assert";
import {
  parseWizardPrompts, wfField, workflowDisplayName, loadWizardPrompts,
} from "../../src/core/wizard-labels.js";

test("parseWizardPrompts: block form with label/help/example", () => {
  const text = `
PROJECT_NAME:
  label: "프로젝트 이름"
  help: "레포 이름과 다르게 쓰고 싶을 때만"
  example: "my-app"
`;
  const { fields } = parseWizardPrompts(text);
  assert.deepStrictEqual(fields.get("PROJECT_NAME"), {
    label: "프로젝트 이름", help: "레포 이름과 다르게 쓰고 싶을 때만", example: "my-app",
  });
});

test("parseWizardPrompts: legacy one-line form becomes label only", () => {
  const text = `PROJECT_NAME: "프로젝트 이름"\n`;
  const { fields } = parseWizardPrompts(text);
  assert.strictEqual(fields.get("PROJECT_NAME").label, "프로젝트 이름");
});

test("parseWizardPrompts: type-scoped override key is distinct from bare key", () => {
  const text = `
APP_ARTIFACT_NAME:
  label: "기본 아티팩트 이름"

flutter.APP_ARTIFACT_NAME:
  label: "Flutter 아티팩트 이름"
`;
  const { fields } = parseWizardPrompts(text);
  assert.strictEqual(fields.get("APP_ARTIFACT_NAME").label, "기본 아티팩트 이름");
  assert.strictEqual(fields.get("flutter.APP_ARTIFACT_NAME").label, "Flutter 아티팩트 이름");
});

test("parseWizardPrompts: _workflow_names block populates workflowNames", () => {
  const text = `
_workflow_names:
  REACT-CI: "React CI"
  REACT-CICD: "React CI+CD"
`;
  const { workflowNames } = parseWizardPrompts(text);
  assert.deepStrictEqual(workflowNames, [
    { key: "REACT-CI", value: "React CI" },
    { key: "REACT-CICD", value: "React CI+CD" },
  ]);
});

test("wfField: type-scoped override wins over bare key", () => {
  const prompts = parseWizardPrompts(`
APP_ARTIFACT_NAME:
  label: "기본"

flutter.APP_ARTIFACT_NAME:
  label: "Flutter 전용"
`);
  assert.strictEqual(wfField(prompts, "flutter", "APP_ARTIFACT_NAME", "label"), "Flutter 전용");
  assert.strictEqual(wfField(prompts, "react", "APP_ARTIFACT_NAME", "label"), "기본");
});

test("wfField: missing field falls back to key name for label, empty string otherwise", () => {
  assert.strictEqual(wfField(null, "react", "UNKNOWN_KEY", "label"), "UNKNOWN_KEY");
  assert.strictEqual(wfField(null, "react", "UNKNOWN_KEY", "help"), "");
});

test("workflowDisplayName: longest matching key wins (REACT-CICD over REACT-CI)", () => {
  const prompts = parseWizardPrompts(`
_workflow_names:
  REACT-CI: "React CI"
  REACT-CICD: "React CI+CD"
`);
  assert.strictEqual(workflowDisplayName(prompts, "PROJECT-REACT-CICD.yaml"), "React CI+CD");
  assert.strictEqual(workflowDisplayName(prompts, "PROJECT-REACT-CI.yaml"), "React CI");
});

test("workflowDisplayName: no match falls back to filename without extension", () => {
  assert.strictEqual(workflowDisplayName(null, "PROJECT-BASIC-CI.yaml"), "PROJECT-BASIC-CI");
});

test("loadWizardPrompts: prefers target repo override over payload bundle", () => {
  const fakeFs = {
    existsSync: (p) => String(p).includes("target"),
    readFileSync: () => `PROJECT_NAME:\n  label: "override"\n`,
  };
  const result = loadWizardPrompts("target", "payload", fakeFs);
  assert.strictEqual(result.fields.get("PROJECT_NAME").label, "override");
});

test("loadWizardPrompts: falls back to payload bundle when target has no override", () => {
  const fakeFs = {
    existsSync: (p) => String(p).includes("payload"),
    readFileSync: () => `PROJECT_NAME:\n  label: "bundled"\n`,
  };
  const result = loadWizardPrompts("target", "payload", fakeFs);
  assert.strictEqual(result.fields.get("PROJECT_NAME").label, "bundled");
});

test("loadWizardPrompts: returns null when neither exists", () => {
  const fakeFs = { existsSync: () => false, readFileSync: () => "" };
  assert.strictEqual(loadWizardPrompts("target", "payload", fakeFs), null);
});
```

- [ ] **Step 2: 테스트 실행**

```bash
node --test tests/node/wizard-labels.test.js
```

Expected: 전부 PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/node/wizard-labels.test.js
git commit -m "test: add coverage for wizard-labels.js"
```

### Task 9: `wizard-env.js` 테스트 추가

**Files:**
- Create: `tests/node/wizard-env.test.js`

**Interfaces:**
- Consumes: `parseWizardLine`, `setEnvLine`, `resolveToken`, `substituteEnv`, `isUnchanged` from `src/core/wizard-env.js` (기존 시그니처, 변경 없음).

- [ ] **Step 1: 테스트 작성**

```javascript
// tests/node/wizard-env.test.js
import { test } from "node:test";
import assert from "node:assert";
import {
  parseWizardLine, setEnvLine, resolveToken, substituteEnv, isUnchanged,
} from "../../src/core/wizard-env.js";

test("parseWizardLine: ask marker parses key/action/arg", () => {
  const line = `  PROJECT_NAME: "app" # @wizard ask:@repo`;
  const p = parseWizardLine(line);
  assert.deepStrictEqual(p, { indent: "  ", key: "PROJECT_NAME", action: "ask", arg: "@repo" });
});

test("parseWizardLine: auto marker parses", () => {
  const p = parseWizardLine(`REPO: "x" # @wizard auto:repo`);
  assert.strictEqual(p.action, "auto");
  assert.strictEqual(p.arg, "repo");
});

test("parseWizardLine: no marker -> null", () => {
  assert.strictEqual(parseWizardLine(`PROJECT_NAME: "app"`), null);
});

test("setEnvLine: replaces quoted value and strips wizard comment", () => {
  const out = setEnvLine(`  KEY: "old" # @wizard ask:x`, "KEY", "new");
  assert.strictEqual(out, `  KEY: "new"`);
});

test("setEnvLine: empty value leaves line untouched", () => {
  const line = `  KEY: "old" # @wizard ask:x`;
  assert.strictEqual(setEnvLine(line, "KEY", ""), line);
});

test("setEnvLine: preserves CRLF line ending", () => {
  const out = setEnvLine(`KEY: "old" # @wizard ask:x\r`, "KEY", "new");
  assert.strictEqual(out, `KEY: "new"\r`);
});

test("resolveToken: calls the matching resolver with type", () => {
  const resolvers = { repo: (t) => `repo-for-${t}` };
  assert.strictEqual(resolveToken("repo", "flutter", resolvers), "repo-for-flutter");
});

test("resolveToken: unknown token name -> empty string", () => {
  assert.strictEqual(resolveToken("unknown", "flutter", {}), "");
});

test("substituteEnv: no @wizard marker anywhere -> content returned unchanged", () => {
  const content = "plain: yaml\n";
  assert.strictEqual(substituteEnv(content, {}), content);
});

test("substituteEnv: auto marker resolves via resolver, ask marker uses default", () => {
  const content = [
    `REPO: "x" # @wizard auto:repo`,
    `NAME: "y" # @wizard ask:default-name`,
  ].join("\n");
  const out = substituteEnv(content, {
    resolvers: { repo: () => "my-repo" },
    useDefaults: true,
  });
  assert.match(out, /REPO: "my-repo"/);
  assert.match(out, /NAME: "default-name"/);
});

test("substituteEnv: ask marker uses provided value when useDefaults=false", () => {
  const content = `NAME: "default" # @wizard ask:default`;
  const values = new Map([["NAME", "chosen"]]);
  const out = substituteEnv(content, { values, useDefaults: false });
  assert.match(out, /NAME: "chosen"/);
});

test("substituteEnv: __PROJECT_NAME__/__APP_ARTIFACT_NAME__ global tokens replaced with repoName", () => {
  // substituteEnv는 content에 "@wizard" 문자열이 전혀 없으면 조기 반환하므로(코드 54행),
  // 전역 토큰만 단독으로 있는 파일에서는 절대 치환되지 않는다 — 최소 1개의 @wizard 마커가
  // 함께 있는 실제 워크플로우 파일 형태로 테스트해야 한다.
  const content = [
    `KEY: "v" # @wizard ask:x`,
    `label: __PROJECT_NAME__`,
    `artifact: __APP_ARTIFACT_NAME__`,
  ].join("\n");
  const out = substituteEnv(content, { repoName: "my-app", values: new Map() });
  assert.match(out, /label: my-app/);
  assert.match(out, /artifact: my-app/);
});

test("substituteEnv: paths-anchor comment replaced when projectPath != '.'", () => {
  const content = [
    `KEY: "v" # @wizard ask:x`,
    `  # @wizard paths-anchor`,
  ].join("\n");
  const out = substituteEnv(content, { projectPath: "app", values: new Map() });
  assert.match(out, /paths: \['app\/\*\*'\]/);
});

test("isUnchanged: byte-identical to a fresh default-substituted render -> true", () => {
  const template = `NAME: "default" # @wizard ask:default`;
  const installed = substituteEnv(template, { useDefaults: true });
  assert.strictEqual(isUnchanged(template, installed, {}), true);
});

test("isUnchanged: user-edited installed content -> false", () => {
  const template = `NAME: "default" # @wizard ask:default`;
  const installed = `NAME: "user-edited-value"`;
  assert.strictEqual(isUnchanged(template, installed, {}), false);
});
```

- [ ] **Step 2: 테스트 실행**

```bash
node --test tests/node/wizard-env.test.js
```

Expected: 전부 PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/node/wizard-env.test.js
git commit -m "test: add coverage for wizard-env.js"
```

### Task 10: 의존성 라이선스 스캔 리포트 생성

**Files:**
- Create: `docs/license-report.md`

**Interfaces:** 없음(생성된 정적 리포트).

- [ ] **Step 1: npm 의존성 스캔**

```bash
npx -y license-checker --production --summary
```

Expected: `package.json`에 `dependencies`가 없으므로 devDependencies만(있다면) 나열되거나 "no dependencies" 수준의 매우 짧은 출력.

- [ ] **Step 2: Python 의존성 스캔**

```bash
pip install --quiet pip-licenses 2>/dev/null; pip-licenses --format=markdown || echo "payload/scripts는 stdlib만 사용 — 외부 패키지 없음"
```

- [ ] **Step 3: `docs/license-report.md` 작성** (Step 1~2 실제 출력값을 반영해서 채운다)

```markdown
# 의존성 라이선스 리포트

생성일: (실행일로 채운다, 예: 2026-07-28)

## npm (Node.js)

`package.json`에 런타임 `dependencies`가 0개입니다(zero-dependency 설계 원칙). devDependencies가 있다면 아래에 `license-checker --production --summary` 실행 결과를 붙여넣는다.

```
(Step 1 실행 결과 붙여넣기)
```

## Python (`payload/scripts/`)

`version_manager.py`/`changelog_manager.py`는 Python 표준 라이브러리만 사용합니다(`argparse`, `json`, `re`, `urllib.request` 등). 외부 PyPI 패키지 의존성이 없습니다.

## 결론

이 프로젝트는 런타임 의존성이 0개이므로 서드파티 라이선스 충돌 리스크가 없습니다. `LICENSE` 파일(MIT)만이 이 저장소에 적용되는 라이선스입니다.
```

- [ ] **Step 4: 확인**

```bash
grep -q "의존성 라이선스 리포트" docs/license-report.md && echo OK
```

- [ ] **Step 5: Commit**

```bash
git add docs/license-report.md
git commit -m "docs: add dependency license report"
```

## Phase 2 — 공유 인프라(`planWorkflows`) + `status` 명령

### Task 11: `copy/workflows.js`에 `planWorkflows()` 추가

**Files:**
- Modify: `src/core/copy/workflows.js`
- Test: `tests/node/plan-workflows.test.js`

**Interfaces:**
- Consumes: 모듈 내부의 기존 private `classify(srcDir, workflowsDir, envOpts, srcText)`, `makeSrcText(branches)`, `TRUNK_BASED_EXCLUDED`(모두 이미 이 파일에 있음, 변경 없음).
- Produces: `planWorkflows(context, payloadRoot, targetRoot = ".") -> { newFiles: [{filename,type}], unchanged: [{filename,type}], changed: [{filename,type}] }`. `type`은 `"common"` 또는 실제 프로젝트 타입 문자열. `common`/타입별/`server-deploy`/(opt-in 시)`nexus` 전체를 포함한다는 점이 기존 `listWorkflowConflicts`(changed만, common 제외)와의 차이. `listWorkflowConflicts`는 이 태스크에서 변경하지 않는다(기존 소비처 `interactive.js` 무영향).
- Phase 4(`--dry-run`)의 `dry-run.js`가 이 함수를 그대로 재사용한다.

- [ ] **Step 1: 실패하는 테스트 작성**

```javascript
// tests/node/plan-workflows.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { planWorkflows, copyWorkflows } from "../../src/core/copy/workflows.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";

function baseContext(overrides = {}) {
  return {
    types: ["basic"], paths: new Map(), includeNexus: false, repoName: "test-repo",
    resolvers: {}, branches: { main: "main", develop: "develop", mode: "pr-flow" },
    ...overrides,
  };
}

test("planWorkflows: fresh target -> everything is newFiles, nothing changed/unchanged", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-plan-"));
  try {
    const plan = planWorkflows(baseContext(), resolvePayloadRoot(), target);
    assert.ok(plan.newFiles.length > 0);
    assert.deepStrictEqual(plan.changed, []);
    assert.deepStrictEqual(plan.unchanged, []);
    // common 워크플로우가 newFiles에 포함되는지 (listWorkflowConflicts와의 핵심 차이)
    assert.ok(plan.newFiles.some((f) => f.type === "common"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planWorkflows: after copyWorkflows, everything is unchanged", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-plan-"));
  try {
    const ctx = baseContext();
    copyWorkflows(ctx, resolvePayloadRoot(), target);
    const plan = planWorkflows(ctx, resolvePayloadRoot(), target);
    assert.deepStrictEqual(plan.newFiles, []);
    assert.deepStrictEqual(plan.changed, []);
    assert.ok(plan.unchanged.length > 0);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planWorkflows: editing an installed COMMON file surfaces it as changed (unlike listWorkflowConflicts)", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-plan-"));
  try {
    const ctx = baseContext();
    copyWorkflows(ctx, resolvePayloadRoot(), target);
    const wfPath = join(target, ".github/workflows/PROJECT-COMMON-VERSION-CONTROL.yaml");
    assert.ok(existsSync(wfPath), "fixture must install PROJECT-COMMON-VERSION-CONTROL.yaml in pr-flow mode");
    writeFileSync(wfPath, readFileSync(wfPath, "utf8") + "\n# user edit\n");

    const plan = planWorkflows(ctx, resolvePayloadRoot(), target);
    const changedNames = plan.changed.map((f) => f.filename);
    assert.ok(changedNames.includes("PROJECT-COMMON-VERSION-CONTROL.yaml"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planWorkflows: editing an installed type-specific file surfaces it as changed", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-plan-"));
  try {
    // "node"/"basic" 타입은 payload/workflows/ 아래 전용 디렉토리가 없다(common만 설치됨) —
    // 타입별 파일이 실제로 존재하는 "react"를 픽스처로 사용한다.
    const ctx = baseContext({ types: ["react"] });
    copyWorkflows(ctx, resolvePayloadRoot(), target);
    const plan = planWorkflows(ctx, resolvePayloadRoot(), target);
    const reactFile = plan.unchanged.find((f) => f.type === "react");
    assert.ok(reactFile, "expected at least one unchanged react-type workflow file after install");

    const wfPath = join(target, ".github/workflows", reactFile.filename);
    writeFileSync(wfPath, readFileSync(wfPath, "utf8") + "\n# user edit\n");

    const plan2 = planWorkflows(ctx, resolvePayloadRoot(), target);
    assert.ok(plan2.changed.some((f) => f.filename === reactFile.filename));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

```bash
node --test tests/node/plan-workflows.test.js
```

Expected: FAIL — `planWorkflows is not a function` (아직 export 안 함).

- [ ] **Step 3: `src/core/copy/workflows.js`에 `planWorkflows` 구현 추가**

파일 끝(`copyWorkflowsForType` 함수 뒤)에 추가:

```javascript
// 전체 워크플로우 분류(common + 타입별 + server-deploy + nexus opt-in) — status/dry-run 공용.
// listWorkflowConflicts와 달리 common 디렉토리도 포함하고, changed뿐 아니라
// newFiles/unchanged까지 전부 반환한다(읽기 전용 — 실제로 아무 파일도 쓰지 않는다).
export function planWorkflows(context, payloadRoot, targetRoot = ".") {
  const { types = [], paths = new Map(), includeNexus = false, includeSecretBackup = false, repoName = "", resolvers = {} } = context;
  const workflowsDir = join(targetRoot, PATHS.workflowsDir);
  const projectTypesDir = join(payloadRoot, PAYLOAD.workflowsDir);
  const srcText = makeSrcText(context.branches || null);
  const branchMode = context.branches?.mode || "pr-flow";
  const plan = { newFiles: [], unchanged: [], changed: [] };

  const merge = (result, type, excluded = null) => {
    for (const bucket of ["newFiles", "unchanged", "changed"]) {
      for (const filename of result[bucket]) {
        if (excluded && excluded.has(filename)) continue;
        plan[bucket].push({ filename, type });
      }
    }
  };

  const commonDir = join(projectTypesDir, "common");
  if (exists(commonDir)) {
    const envOpts = { type: "common", projectPath: ".", repoName, resolvers };
    merge(classify(commonDir, workflowsDir, envOpts, srcText), "common",
      branchMode === "trunk-based" ? TRUNK_BASED_EXCLUDED : null);
  }

  // secret-backup은 copyWorkflows처럼 신규 파일만 대상(기존 파일은 절대 덮어쓰지 않는 규약) —
  // classify()의 changed 판정과 무관하게, 여기서도 존재 여부만으로 new/unchanged를 가른다.
  const secretDir = join(commonDir, "secret-backup");
  if (exists(secretDir) && includeSecretBackup) {
    for (const filename of listYamlFiles(secretDir)) {
      const dst = join(workflowsDir, filename);
      plan[existsSync(dst) ? "unchanged" : "newFiles"].push({ filename, type: "common" });
    }
  }

  for (const type of types) {
    const envOpts = { type, projectPath: paths.get(type) || ".", repoName, resolvers };
    const typeDir = join(projectTypesDir, type);
    if (exists(typeDir)) merge(classify(typeDir, workflowsDir, envOpts, srcText), type);

    const serverDeployDir = join(typeDir, "server-deploy");
    if (exists(serverDeployDir) && !includeNexus) {
      merge(classify(serverDeployDir, workflowsDir, envOpts, srcText), type);
    }

    const nexusDir = join(typeDir, "nexus");
    if (exists(nexusDir) && includeNexus) {
      merge(classify(nexusDir, workflowsDir, envOpts, srcText), type);
    }
  }

  return plan;
}
```

- [ ] **Step 4: 테스트 재실행**

```bash
node --test tests/node/plan-workflows.test.js
```

Expected: 전부 PASS.

- [ ] **Step 5: 기존 테스트 회귀 확인**

```bash
npm run test:node
```

Expected: 기존 테스트 전부 PASS(신규 export 추가만 했으므로 회귀 없어야 함).

- [ ] **Step 6: Commit**

```bash
git add src/core/copy/workflows.js tests/node/plan-workflows.test.js
git commit -m "feat(core): add planWorkflows for full drift detection (common + type-specific)"
```

### Task 12: `status` 명령 구현

**Files:**
- Create: `src/commands/status.js`
- Test: `tests/node/status.test.js`
- Modify: `src/index.js` (배선)
- Modify: `src/cli/help.js` (문서화)

**Interfaces:**
- Consumes: `planWorkflows` (Task 11), `parseExisting` from `src/core/version-yml.js`, `makeResolvers`/`detectRepoName` from `src/core/detect-fs.js`, `PATHS` from `src/core/paths.js`.
- Produces: `runStatus(payloadRoot, targetRoot = ".") -> { installed: false } | { installed: true, version, templateVersion, types, branches, options, modifiedFiles: string[] }`. `printStatus(status)` — stdout에 사람이 읽는 리포트 출력, 반환값 없음.

- [ ] **Step 1: 실패하는 테스트 작성**

```javascript
// tests/node/status.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { runStatus } from "../../src/commands/status.js";

function installFixture() {
  const target = mkdtempSync(join(tmpdir(), "paw-status-"));
  const ctx = createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(), includeCodeRabbit: false,
    now: "2026-07-28 00:00:00", today: "2026-07-28", templateVersion: "0.1.0",
  });
  runFull(ctx, resolvePayloadRoot(), target);
  return target;
}

test("runStatus: not installed", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-status-empty-"));
  try {
    assert.deepStrictEqual(runStatus(resolvePayloadRoot(), target), { installed: false });
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("runStatus: fresh install reports version and no modified files", () => {
  const target = installFixture();
  try {
    const status = runStatus(resolvePayloadRoot(), target);
    assert.strictEqual(status.installed, true);
    assert.strictEqual(status.version, "1.0.0");
    assert.deepStrictEqual(status.types, ["basic"]);
    assert.deepStrictEqual(status.modifiedFiles, []);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("runStatus: user-edited common workflow file appears in modifiedFiles", () => {
  const target = installFixture();
  try {
    const wfPath = join(target, ".github/workflows/PROJECT-COMMON-VERSION-CONTROL.yaml");
    assert.ok(existsSync(wfPath));
    writeFileSync(wfPath, readFileSync(wfPath, "utf8") + "\n# user edit\n");

    const status = runStatus(resolvePayloadRoot(), target);
    assert.ok(status.modifiedFiles.includes("PROJECT-COMMON-VERSION-CONTROL.yaml"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

```bash
node --test tests/node/status.test.js
```

Expected: FAIL — `Cannot find module '../../src/commands/status.js'`.

- [ ] **Step 3: `src/commands/status.js` 구현**

```javascript
// status 명령 — 읽기 전용 설치 상태 확인. 네트워크 접근 없음(로컬 파일 비교만).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseExisting } from "../core/version-yml.js";
import { planWorkflows } from "../core/copy/workflows.js";
import { makeResolvers, detectRepoName } from "../core/detect-fs.js";
import { PATHS } from "../core/paths.js";

// payloadRoot: 패키지 payload/ 루트. targetRoot: 상태를 확인할 대상 레포.
export function runStatus(payloadRoot, targetRoot = ".") {
  const vyPath = join(targetRoot, PATHS.versionFile);
  if (!existsSync(vyPath)) return { installed: false };

  const existing = parseExisting(readFileSync(vyPath, "utf8"));
  const repoName = detectRepoName(targetRoot);
  const resolvers = makeResolvers(targetRoot, repoName, existing.paths);
  const context = {
    types: existing.types, paths: existing.paths,
    includeNexus: existing.options.nexus === true,
    includeSecretBackup: existing.options.secretBackup === true,
    repoName, resolvers, branches: existing.branches,
  };
  const plan = planWorkflows(context, payloadRoot, targetRoot);

  return {
    installed: true,
    version: existing.version,
    templateVersion: existing.templateVersion,
    types: existing.types,
    branches: existing.branches,
    options: existing.options,
    modifiedFiles: plan.changed.map((f) => f.filename),
  };
}

export function printStatus(status) {
  const lines = ["", "project-auto-wizard status — 설치 상태", ""];
  if (!status.installed) {
    lines.push("이 디렉터리에 project-auto-wizard가 설치되어 있지 않습니다 (version.yml 없음).", "");
    console.log(lines.join("\n"));
    return;
  }
  lines.push(`버전            : ${status.version}`);
  lines.push(`템플릿 버전      : ${status.templateVersion}`);
  lines.push(`프로젝트 타입    : ${status.types.join(", ") || "(없음)"}`);
  if (status.branches) {
    lines.push(`브랜치 모드      : ${status.branches.mode} (${status.branches.main} / ${status.branches.develop})`);
  }
  lines.push(`옵션            : nexus=${status.options.nexus} secret_backup=${status.options.secretBackup} coderabbit=${status.options.coderabbit}`);
  if (status.modifiedFiles.length) {
    lines.push("", `사용자가 수정한 워크플로우 파일 (${status.modifiedFiles.length}개):`);
    for (const f of status.modifiedFiles) lines.push(`  - ${f}`);
  } else {
    lines.push("", "모든 워크플로우 파일이 설치 시점 기본값과 동일합니다 (수정 없음).");
  }
  lines.push("");
  console.log(lines.join("\n"));
}
```

- [ ] **Step 4: 테스트 재실행**

```bash
node --test tests/node/status.test.js
```

Expected: 전부 PASS.

- [ ] **Step 5: `src/index.js`에 `status` 모드 배선**

`src/index.js`의 `if (opts.mode === "revert") { ... }` 블록 바로 뒤, `// 명시 모드인데 --force 없으면` 가드 앞에 삽입(읽기 전용이라 `--force` 불필요):

```javascript
  // status 모드 — 읽기 전용, TTY/--force 무관하게 항상 동작
  if (opts.mode === "status") {
    const { runStatus, printStatus } = await import("./commands/status.js");
    printStatus(runStatus(payload, cwd));
    return 0;
  }
```

파일 상단 import 블록에 정적 import를 추가해도 되지만, 다른 커맨드들과의 import 순서 일관성을 위해 여기서는 동적 import로 최소 침습 변경한다. (일관성을 더 중시한다면 이 Step에서 `import { runStatus, printStatus } from "./commands/status.js";`를 파일 상단 기존 `import { runRevert } ...` 옆에 정적으로 추가하고, 위 블록은 `printStatus(runStatus(payload, cwd));`로 단순화해도 동일하게 동작한다 — 이 계획에서는 후자를 채택한다.)

- [ ] **Step 6: Step 5을 정적 import 버전으로 확정**

`src/index.js` 상단 import 블록:

```javascript
import { runRevert } from "./commands/revert.js";
import { runInteractive } from "./commands/interactive.js";
import { runStatus, printStatus } from "./commands/status.js";
```

그리고 `if (opts.mode === "revert") { ... }` 블록 뒤에:

```javascript
  // status 모드 — 읽기 전용, TTY/--force 무관하게 항상 동작
  if (opts.mode === "status") {
    printStatus(runStatus(payload, cwd));
    return 0;
  }
```

- [ ] **Step 7: `src/cli/help.js`에 문서화 추가**

`-m, --mode MODE` 라인의 설명을 확장:

```javascript
  -m, --mode MODE          통합 모드 (full | version | workflows | revert | status | doctor)
                           기본: interactive (대화형). revert = 설치물 제거(되돌리기)
                           status = 설치 상태·드리프트 확인(읽기 전용). doctor = 환경 진단(읽기 전용)
```

예시 섹션에도 추가:

```javascript
  npx project-auto-wizard --mode status
```

- [ ] **Step 8: 전체 회귀 테스트**

```bash
npm run test:node
```

Expected: 전부 PASS.

- [ ] **Step 9: Commit**

```bash
git add src/commands/status.js tests/node/status.test.js src/index.js src/cli/help.js
git commit -m "feat(cli): add status command (install state + drift report)"
```

## Phase 3 — `doctor` 명령 (규칙 기반, AI 진단 없음)

### Task 13: `doctor` 명령 구현

**Files:**
- Create: `src/commands/doctor.js`
- Test: `tests/node/doctor.test.js`
- Modify: `src/index.js` (배선)
- Modify: `src/cli/help.js` (문서화)

**Interfaces:**
- Produces: `runDoctor(cwd = process.cwd(), { exec } = {}) -> Array<{name, status: "OK"|"WARN"|"FAIL"|"INFO", detail}>`. `exec(cmd, args) -> {status, stdout, stderr, error?}`는 `node:child_process`의 `spawnSync` 반환 형태를 흉내낸 테스트 주입점(기본값은 실제 `spawnSync`).
- Produces: `printDoctorReport(results)` — stdout 출력, 반환값 없음.

- [ ] **Step 1: 실패하는 테스트 작성**

```javascript
// tests/node/doctor.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runDoctor } from "../../src/commands/doctor.js";

function fakeExec(map) {
  return (cmd, args) => {
    const key = [cmd, ...args].join(" ");
    for (const [pattern, result] of map) {
      if (key.includes(pattern)) return result;
    }
    return { status: 1, stdout: "", stderr: "unmocked command: " + key, error: null };
  };
}

test("runDoctor: gh CLI missing -> WARN and stops early", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const exec = fakeExec([
      ["gh --version", { status: 1, stdout: "", stderr: "", error: new Error("not found") }],
    ]);
    const results = runDoctor(dir, { exec });
    const ghCheck = results.find((r) => r.name === "gh CLI");
    assert.strictEqual(ghCheck.status, "WARN");
    assert.ok(!results.some((r) => r.name === "gh 인증"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runDoctor: gh not authenticated -> FAIL and stops before remote checks", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const exec = fakeExec([
      ["gh --version", { status: 0, stdout: "gh version 2.0.0", stderr: "" }],
      ["gh auth status", { status: 1, stdout: "", stderr: "not logged in" }],
    ]);
    const results = runDoctor(dir, { exec });
    assert.strictEqual(results.find((r) => r.name === "gh 인증").status, "FAIL");
    assert.ok(!results.some((r) => r.name === "GitHub 원격"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runDoctor: all checks OK", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  writeFileSync(join(dir, "version.yml"), "version: \"1.0.0\"\n");
  try {
    const exec = fakeExec([
      ["gh --version", { status: 0, stdout: "gh version 2.0.0", stderr: "" }],
      ["gh auth status", { status: 0, stdout: "Logged in", stderr: "" }],
      ["git -C", { status: 0, stdout: "https://github.com/acme/widgets.git\n", stderr: "" }],
      ["actions/permissions/workflow", { status: 0, stdout: "write", stderr: "" }],
      ["secret list", { status: 0, stdout: "WORKFLOW_PAT\tUpdated 2026-01-01\n", stderr: "" }],
      [".allow_merge_commit", { status: 0, stdout: "true", stderr: "" }],
    ]);
    const results = runDoctor(dir, { exec });
    assert.strictEqual(results.find((r) => r.name === "설치 여부").status, "OK");
    assert.strictEqual(results.find((r) => r.name === "Workflow permissions").status, "OK");
    assert.strictEqual(results.find((r) => r.name === "WORKFLOW_PAT secret").status, "OK");
    assert.strictEqual(results.find((r) => r.name === "automerge 호환성(merge commit 허용)").status, "OK");
    assert.strictEqual(results.find((r) => r.name === "GitHub Models 활성화").status, "INFO");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runDoctor: missing WORKFLOW_PAT and non-write permissions -> WARN", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const exec = fakeExec([
      ["gh --version", { status: 0, stdout: "gh version 2.0.0", stderr: "" }],
      ["gh auth status", { status: 0, stdout: "Logged in", stderr: "" }],
      ["git -C", { status: 0, stdout: "git@github.com:acme/widgets.git\n", stderr: "" }],
      ["actions/permissions/workflow", { status: 0, stdout: "read", stderr: "" }],
      ["secret list", { status: 0, stdout: "AI_API_KEY\tUpdated 2026-01-01\n", stderr: "" }],
      [".allow_merge_commit", { status: 0, stdout: "false", stderr: "" }],
    ]);
    const results = runDoctor(dir, { exec });
    assert.strictEqual(results.find((r) => r.name === "Workflow permissions").status, "WARN");
    assert.strictEqual(results.find((r) => r.name === "WORKFLOW_PAT secret").status, "WARN");
    assert.strictEqual(results.find((r) => r.name === "automerge 호환성(merge commit 허용)").status, "WARN");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runDoctor: no git remote -> WARN and stops before repo-scoped checks", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-"));
  try {
    const exec = fakeExec([
      ["gh --version", { status: 0, stdout: "gh version 2.0.0", stderr: "" }],
      ["gh auth status", { status: 0, stdout: "Logged in", stderr: "" }],
      ["git -C", { status: 1, stdout: "", stderr: "fatal: no such remote" }],
    ]);
    const results = runDoctor(dir, { exec });
    assert.strictEqual(results.find((r) => r.name === "GitHub 원격").status, "WARN");
    assert.ok(!results.some((r) => r.name === "Workflow permissions"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

```bash
node --test tests/node/doctor.test.js
```

Expected: FAIL — 모듈 없음.

- [ ] **Step 3: `src/commands/doctor.js` 구현**

```javascript
// doctor 명령 — 로컬 환경 진단(읽기 전용, 규칙 기반). gh CLI에 위임해 원격 상태를 점검한다.
// AI 진단은 포함하지 않는다(스펙 §4에서 검토 후 기각 — 복잡도 대비 이득 낮음).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const defaultExec = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" });

export function runDoctor(cwd = process.cwd(), { exec = defaultExec } = {}) {
  const results = [];
  const add = (name, status, detail) => { results.push({ name, status, detail }); return results; };

  const installed = existsSync(join(cwd, "version.yml"));
  add("설치 여부", installed ? "OK" : "WARN",
    installed ? "version.yml 발견" : "이 디렉터리에 project-auto-wizard가 설치되어 있지 않습니다 (version.yml 없음)");

  const ghVersion = exec("gh", ["--version"]);
  if (ghVersion.error || ghVersion.status !== 0) {
    add("gh CLI", "WARN", "gh CLI를 찾을 수 없습니다 — 원격 점검을 건너뜁니다 (https://cli.github.com/ 설치 권장)");
    return results;
  }
  add("gh CLI", "OK", (ghVersion.stdout || "").split("\n")[0] || "설치됨");

  const auth = exec("gh", ["auth", "status"]);
  const authOk = !auth.error && auth.status === 0;
  add("gh 인증", authOk ? "OK" : "FAIL", authOk ? "인증됨" : "`gh auth login`이 필요합니다");
  if (!authOk) return results;

  const remote = exec("git", ["-C", cwd, "remote", "get-url", "origin"]);
  const url = remote.status === 0 ? (remote.stdout || "").trim() : "";
  const match = url.match(/github\.com[:/]([^/]+)\/([^/.]+?)(\.git)?$/);
  if (!match) {
    add("GitHub 원격", "WARN", "origin 리모트에서 GitHub owner/repo를 확인하지 못했습니다");
    return results;
  }
  const [, owner, repo] = match;

  const perm = exec("gh", ["api", `repos/${owner}/${repo}/actions/permissions/workflow`, "--jq", ".default_workflow_permissions"]);
  const permValue = (perm.stdout || "").trim();
  add("Workflow permissions", perm.status === 0 && permValue === "write" ? "OK" : "WARN",
    perm.status === 0
      ? `현재값: ${permValue || "확인불가"} (Settings → Actions → General → Workflow permissions: Read and write 권장)`
      : "조회 실패 — repo 관리자 권한이 필요할 수 있습니다");

  const secrets = exec("gh", ["secret", "list", "--repo", `${owner}/${repo}`]);
  const hasPat = secrets.status === 0 && (secrets.stdout || "").split("\n").some((l) => l.startsWith("WORKFLOW_PAT"));
  add("WORKFLOW_PAT secret", hasPat ? "OK" : "WARN",
    hasPat
      ? "등록됨"
      : "미등록 — automerge 후 후속 워크플로우(tag/Release)가 트리거되지 않을 수 있습니다. Settings → Secrets → Actions에 등록 (scopes: repo, workflow)");

  const mergeSettings = exec("gh", ["api", `repos/${owner}/${repo}`, "--jq", ".allow_merge_commit"]);
  const automergeOk = mergeSettings.status === 0 && mergeSettings.stdout.trim() === "true";
  add("automerge 호환성(merge commit 허용)", automergeOk ? "OK" : "WARN",
    mergeSettings.status === 0
      ? (automergeOk
        ? "머지 커밋 허용됨"
        : "이 레포는 merge commit이 비활성화되어 있습니다 — automerge/RELEASE-PUBLISH가 머지 커밋 subject를 감지하는 방식과 충돌할 수 있습니다. Settings → General → Pull Requests → Allow merge commits 활성화 권장")
      : "조회 실패 — repo 관리자 권한이 필요할 수 있습니다");

  add("GitHub Models 활성화", "INFO",
    "자동 확인 불가 — Settings → Models에서 조직 정책으로 차단되지 않았는지 직접 확인하세요 (차단 시 규칙 기반 fallback으로 자동 전환됩니다)");

  return results;
}

export function printDoctorReport(results) {
  const icon = { OK: "✅", WARN: "⚠️ ", FAIL: "❌", INFO: "ℹ️ " };
  const lines = ["", "project-auto-wizard doctor — 환경 진단 결과", ""];
  for (const r of results) lines.push(`${icon[r.status] || "  "} [${r.status}] ${r.name} — ${r.detail}`);
  lines.push("");
  console.log(lines.join("\n"));
}
```

- [ ] **Step 4: 테스트 재실행**

```bash
node --test tests/node/doctor.test.js
```

Expected: 전부 PASS.

- [ ] **Step 5: `src/index.js`에 `doctor` 모드 배선**

Import 블록에 추가:

```javascript
import { runDoctor, printDoctorReport } from "./commands/doctor.js";
```

`status` 분기(Task 12 Step 6) 바로 뒤에 추가:

```javascript
  // doctor 모드 — 읽기 전용, TTY/--force 무관하게 항상 동작
  if (opts.mode === "doctor") {
    printDoctorReport(runDoctor(cwd));
    return 0;
  }
```

- [ ] **Step 6: `src/cli/help.js` 문서화**

Task 12 Step 7에서 이미 `doctor`를 모드 목록에 언급했으므로, 예시 섹션에 한 줄만 추가:

```javascript
  npx project-auto-wizard --mode doctor
```

- [ ] **Step 7: 전체 회귀 테스트**

```bash
npm run test:node
```

Expected: 전부 PASS.

- [ ] **Step 8: Commit**

```bash
git add src/commands/doctor.js tests/node/doctor.test.js src/index.js src/cli/help.js
git commit -m "feat(cli): add doctor command (rule-based environment diagnostics)"
```

## Phase 4 — `--dry-run` 미리보기 모드

### Task 14: `revert.js`를 `planRevert`/`runRevert`로 분리

**Files:**
- Modify: `src/commands/revert.js`
- Test: `tests/node/revert-plan.test.js`

**Interfaces:**
- Produces: `planRevert(payloadRoot, targetRoot = ".") -> { workflows: string[], scripts: string[], coderabbit: boolean }` — 순수 읽기 전용(파일 시스템에 아무것도 쓰거나 지우지 않음).
- `runRevert(context, payloadRoot, targetRoot)`의 **반환값 형태는 기존과 100% 동일** — 기존 소비처(`src/index.js`, `src/commands/interactive.js`)는 변경 없음.

- [ ] **Step 1: 실패하는 테스트 작성**

```javascript
// tests/node/revert-plan.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { planRevert, runRevert } from "../../src/commands/revert.js";

function installFixture() {
  const target = mkdtempSync(join(tmpdir(), "paw-revert-plan-"));
  const ctx = createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(), includeCodeRabbit: false,
    now: "2026-07-28 00:00:00", today: "2026-07-28", templateVersion: "0.1.0",
  });
  runFull(ctx, resolvePayloadRoot(), target);
  return target;
}

test("planRevert: lists files without deleting anything", () => {
  const target = installFixture();
  try {
    const plan = planRevert(resolvePayloadRoot(), target);
    assert.ok(plan.workflows.length > 0);
    assert.ok(plan.scripts.includes("version_manager.py"));
    // 아무것도 지워지지 않았어야 함
    for (const name of plan.workflows) {
      assert.ok(existsSync(join(target, ".github/workflows", name)));
    }
    for (const name of plan.scripts) {
      assert.ok(existsSync(join(target, ".github/scripts", name)));
    }
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planRevert output matches what runRevert actually removes", () => {
  const target = installFixture();
  try {
    const plan = planRevert(resolvePayloadRoot(), target);
    const result = runRevert({}, resolvePayloadRoot(), target);
    assert.deepStrictEqual(result, plan);
    for (const name of plan.workflows) {
      assert.ok(!existsSync(join(target, ".github/workflows", name)));
    }
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

```bash
node --test tests/node/revert-plan.test.js
```

Expected: FAIL — `planRevert is not exported`.

- [ ] **Step 3: `src/commands/revert.js`를 `planRevert` + 얇은 `runRevert`로 리팩터**

`runRevert` 함수 전체를 아래로 교체:

```javascript
// payload에 존재하는 파일명과 정확히 일치하는 것만 제거 대상으로 계획한다.
// 아무것도 지우지 않는 순수 함수 — --dry-run과 status류 기능에서 재사용.
export function planRevert(payloadRoot, targetRoot = ".") {
  const removedWf = [];
  const removedScripts = [];
  const wfDir = join(targetRoot, PATHS.workflowsDir);
  const names = payloadWorkflowNames(payloadRoot);
  if (existsSync(wfDir)) {
    for (const name of names) {
      const p = join(wfDir, name);
      if (existsSync(p)) removedWf.push(name);
      const templateName = (name.endsWith(".yaml") ? name.slice(0, -".yaml".length) : name) + ".template.yaml";
      if (existsSync(join(wfDir, templateName))) removedWf.push(templateName);
      if (existsSync(p + ".bak")) removedWf.push(name + ".bak");
    }
  }
  for (const s of ["version_manager.py", "changelog_manager.py"]) {
    if (existsSync(join(targetRoot, PATHS.scriptsDir, s))) removedScripts.push(s);
  }
  let coderabbit = false;
  const cr = join(targetRoot, ".coderabbit.yaml");
  const crSrc = join(payloadRoot, "coderabbit.yaml");
  if (existsSync(cr) && existsSync(crSrc) && readFileSync(cr, "utf8") === readFileSync(crSrc, "utf8")) {
    coderabbit = true;
  }
  return { workflows: removedWf, scripts: removedScripts, coderabbit };
}

// 반환: { workflows: [...제거된 파일명], scripts: [...], coderabbit: bool } — planRevert와 동일한 형태.
export function runRevert(context, payloadRoot, targetRoot = ".") {
  const plan = planRevert(payloadRoot, targetRoot);
  const wfDir = join(targetRoot, PATHS.workflowsDir);
  for (const name of plan.workflows) remove(join(wfDir, name));
  for (const name of plan.scripts) remove(join(targetRoot, PATHS.scriptsDir, name));
  if (plan.coderabbit) {
    const cr = join(targetRoot, ".coderabbit.yaml");
    remove(cr);
    if (existsSync(cr + ".bak")) renameSync(cr + ".bak", cr);
  }
  return plan;
}
```

`payloadWorkflowNames` 헬퍼 함수는 그대로 둔다(변경 없음). 파일 상단 import는 이미 `existsSync, readdirSync, readFileSync, renameSync`를 가져오고 있으므로 추가 import 불필요.

- [ ] **Step 4: 테스트 재실행**

```bash
node --test tests/node/revert-plan.test.js
```

Expected: 전부 PASS.

- [ ] **Step 5: 기존 revert 관련 회귀 테스트 확인**

```bash
npm run test:node
```

Expected: `install-matrix.test.js`/`e2e-matrix.test.js` 등 기존 revert 관련 테스트 포함 전부 PASS(반환 형태가 100% 동일하므로 회귀 없어야 함).

- [ ] **Step 6: Commit**

```bash
git add src/commands/revert.js tests/node/revert-plan.test.js
git commit -m "refactor(cli): split revert into pure planRevert + thin runRevert"
```

### Task 15: `--dry-run` 명령 구현

**Files:**
- Create: `src/commands/dry-run.js`
- Test: `tests/node/dry-run.test.js`

**Interfaces:**
- Consumes: `planWorkflows`(Task 11), `planRevert`(Task 14), `buildVersionYml`/`readVersionYmlTemplate`/`markerForType`(기존, 변경 없음).
- Produces: `planDryRun(mode, context, payloadRoot, targetRoot) -> object`(모드별 형태는 아래 구현 참조). `printDryRun(plan)` — stdout 출력.

- [ ] **Step 1: 실패하는 테스트 작성**

```javascript
// tests/node/dry-run.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { runFull } from "../../src/commands/full.js";
import { planDryRun } from "../../src/commands/dry-run.js";

function baseContext(overrides = {}) {
  return createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(), includeCodeRabbit: false,
    now: "2026-07-28 00:00:00", today: "2026-07-28", templateVersion: "0.1.0",
    ...overrides,
  });
}

test("planDryRun('full', ...) on empty dir: all new, version.yml would be created, writes nothing", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  try {
    const plan = planDryRun("full", baseContext(), resolvePayloadRoot(), target);
    assert.strictEqual(plan.mode, "full");
    assert.ok(plan.workflows.newFiles.length > 0);
    assert.strictEqual(plan.versionYml.existed, false);
    // 실제로 아무 파일도 안 생겼어야 함
    assert.deepStrictEqual([...require("node:fs").readdirSync(target)], []);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planDryRun('full', ...) after a real install: nothing new, version.yml unchanged", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  try {
    const ctx = baseContext();
    runFull(ctx, resolvePayloadRoot(), target);
    const plan = planDryRun("full", ctx, resolvePayloadRoot(), target);
    assert.deepStrictEqual(plan.workflows.newFiles, []);
    assert.strictEqual(plan.versionYml.existed, true);
    assert.strictEqual(plan.versionYml.changed, false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planDryRun('version', ...) only computes versionYml preview, not workflows", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  try {
    const plan = planDryRun("version", baseContext(), resolvePayloadRoot(), target);
    assert.strictEqual(plan.workflows, undefined);
    assert.ok(plan.versionYml);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planDryRun('revert', ...) delegates to planRevert and writes nothing", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  try {
    const ctx = baseContext();
    runFull(ctx, resolvePayloadRoot(), target);
    const before = require("node:fs").readdirSync(join(target, ".github/workflows")).length;
    const plan = planDryRun("revert", ctx, resolvePayloadRoot(), target);
    assert.ok(plan.revert.workflows.length > 0);
    const after = require("node:fs").readdirSync(join(target, ".github/workflows")).length;
    assert.strictEqual(before, after);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

> 위 테스트는 CommonJS `require`를 ESM 파일에서 쓸 수 없으므로(이 프로젝트는 `"type": "module"`), Step 1에서 실제로 작성할 때는 파일 상단에 `import { readdirSync } from "node:fs";`를 추가하고 `require("node:fs").readdirSync(...)` 대신 `readdirSync(...)`를 쓴다. 아래는 그 형태로 고친 최종본이다 — 이 최종본으로 파일을 작성한다.

```javascript
// tests/node/dry-run.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { runFull } from "../../src/commands/full.js";
import { planDryRun } from "../../src/commands/dry-run.js";

function baseContext(overrides = {}) {
  return createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(), includeCodeRabbit: false,
    now: "2026-07-28 00:00:00", today: "2026-07-28", templateVersion: "0.1.0",
    ...overrides,
  });
}

test("planDryRun('full', ...) on empty dir: all new, version.yml would be created, writes nothing", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  try {
    const plan = planDryRun("full", baseContext(), resolvePayloadRoot(), target);
    assert.strictEqual(plan.mode, "full");
    assert.ok(plan.workflows.newFiles.length > 0);
    assert.strictEqual(plan.versionYml.existed, false);
    assert.deepStrictEqual(readdirSync(target), []);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planDryRun('full', ...) after a real install: nothing new, version.yml unchanged", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  try {
    const ctx = baseContext();
    runFull(ctx, resolvePayloadRoot(), target);
    const plan = planDryRun("full", ctx, resolvePayloadRoot(), target);
    assert.deepStrictEqual(plan.workflows.newFiles, []);
    assert.strictEqual(plan.versionYml.existed, true);
    assert.strictEqual(plan.versionYml.changed, false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planDryRun('version', ...) only computes versionYml preview, not workflows", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  try {
    const plan = planDryRun("version", baseContext(), resolvePayloadRoot(), target);
    assert.strictEqual(plan.workflows, undefined);
    assert.ok(plan.versionYml);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("planDryRun('revert', ...) delegates to planRevert and writes nothing", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  try {
    const ctx = baseContext();
    runFull(ctx, resolvePayloadRoot(), target);
    const before = readdirSync(join(target, ".github/workflows")).length;
    const plan = planDryRun("revert", ctx, resolvePayloadRoot(), target);
    assert.ok(plan.revert.workflows.length > 0);
    const after = readdirSync(join(target, ".github/workflows")).length;
    assert.strictEqual(before, after);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

```bash
node --test tests/node/dry-run.test.js
```

Expected: FAIL — 모듈 없음.

- [ ] **Step 3: `src/commands/dry-run.js` 구현**

```javascript
// --dry-run 미리보기 — 실제 파일을 쓰지 않고 무엇이 바뀔지 계산한다.
// full/version/workflows/revert 4개 모드 전체 지원.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "../core/paths.js";
import { planWorkflows } from "../core/copy/workflows.js";
import { planRevert } from "./revert.js";
import { buildVersionYml } from "../core/version-yml.js";
import { readVersionYmlTemplate } from "../core/assets.js";
import { markerForType } from "../core/detect.js";

function versionYmlPreview(context, payloadRoot, targetRoot) {
  const { version, types = [], paths = new Map(), branch = "main", versionCode = 1,
    now, today, templateVersion = "unknown",
    includeNexus = false, includeSecretBackup = false, includeCodeRabbit = false } = context;
  const pathMarkers = new Map();
  for (const [t] of paths) pathMarkers.set(t, markerForType(t));
  const wouldBe = buildVersionYml({
    templateText: readVersionYmlTemplate(payloadRoot),
    version, types, paths, pathMarkers, branch, branches: context.branches, versionCode, now, today,
    templateOptions: { templateVersion, includeNexus, includeSecretBackup, includeCodeRabbit: includeCodeRabbit === true, optionsDate: today },
  });
  const vyPath = join(targetRoot, PATHS.versionFile);
  const existing = existsSync(vyPath) ? readFileSync(vyPath, "utf8") : null;
  return { existed: existing !== null, changed: existing !== wouldBe };
}

// mode: "full" | "version" | "workflows" | "revert". 읽기 전용 — 아무 파일도 쓰지 않는다.
export function planDryRun(mode, context, payloadRoot, targetRoot = ".") {
  if (mode === "revert") return { mode, revert: planRevert(payloadRoot, targetRoot) };

  const result = { mode };
  if (mode === "full" || mode === "workflows") {
    result.workflows = planWorkflows(context, payloadRoot, targetRoot);
  }
  if (mode === "full" || mode === "version") {
    result.versionYml = versionYmlPreview(context, payloadRoot, targetRoot);
  }
  return result;
}

export function printDryRun(plan) {
  const lines = ["", `project-auto-wizard --dry-run (mode: ${plan.mode}) — 미리보기, 실제 파일은 바뀌지 않았습니다`, ""];
  if (plan.mode === "revert") {
    const r = plan.revert;
    lines.push(`제거될 워크플로우 (${r.workflows.length}개):`);
    for (const f of r.workflows) lines.push(`  - ${f}`);
    lines.push(`제거될 스크립트 (${r.scripts.length}개):`);
    for (const f of r.scripts) lines.push(`  - ${f}`);
    if (r.coderabbit) lines.push("제거될 파일: .coderabbit.yaml");
  } else {
    if (plan.workflows) {
      const w = plan.workflows;
      lines.push(`신규 파일 (${w.newFiles.length}개):`);
      for (const f of w.newFiles) lines.push(`  + ${f.filename} [${f.type}]`);
      lines.push(`변경될 파일 (${w.changed.length}개, 기존 설치가 사용자 수정본이면 충돌):`);
      for (const f of w.changed) lines.push(`  ~ ${f.filename} [${f.type}]`);
      lines.push(`동일한 파일 (${w.unchanged.length}개, 변경 없음)`);
    }
    if (plan.versionYml) {
      lines.push(plan.versionYml.existed
        ? (plan.versionYml.changed ? "version.yml: 갱신될 예정" : "version.yml: 변경 없음")
        : "version.yml: 새로 생성될 예정");
    }
  }
  lines.push("");
  console.log(lines.join("\n"));
}
```

- [ ] **Step 4: 테스트 재실행**

```bash
node --test tests/node/dry-run.test.js
```

Expected: 전부 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/dry-run.js tests/node/dry-run.test.js
git commit -m "feat(cli): add dry-run planner for full/version/workflows/revert"
```

### Task 16: `--dry-run` CLI 배선

**Files:**
- Modify: `src/cli/args.js`
- Modify: `src/cli/help.js`
- Modify: `src/index.js`
- Test: `tests/node/dry-run-cli.test.js`

**Interfaces:**
- Consumes: `planDryRun`, `printDryRun`(Task 15).
- `parseArgs(argv)`의 반환 객체에 `dryRun: boolean` 필드 추가(기본 `false`) — 기존 필드는 전부 그대로.

- [ ] **Step 1: 실패하는 테스트 작성**

```javascript
// tests/node/dry-run-cli.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "../../src/cli/args.js";
import { run } from "../../src/index.js";

test("parseArgs: --dry-run sets dryRun=true", () => {
  const opts = parseArgs(["--mode", "full", "--force", "--type", "node", "--dry-run"]);
  assert.strictEqual(opts.dryRun, true);
});

test("parseArgs: omitting --dry-run defaults to false", () => {
  const opts = parseArgs(["--mode", "full", "--force", "--type", "node"]);
  assert.strictEqual(opts.dryRun, false);
});

test("run(): --dry-run --mode full writes nothing to an empty target", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-cli-"));
  try {
    const code = await run(
      ["--mode", "full", "--force", "--type", "node", "--dry-run"],
      { cwd: target, clock: { now: "2026-07-28 00:00:00", today: "2026-07-28" } },
    );
    assert.strictEqual(code, 0);
    assert.ok(!existsSync(join(target, "version.yml")));
    assert.ok(!existsSync(join(target, ".github")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): --dry-run --mode revert on an installed repo removes nothing", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-cli-"));
  try {
    await run(["--mode", "full", "--force", "--type", "node"], {
      cwd: target, clock: { now: "2026-07-28 00:00:00", today: "2026-07-28" },
    });
    const code = await run(["--mode", "revert", "--force", "--dry-run"], { cwd: target });
    assert.strictEqual(code, 0);
    assert.ok(existsSync(join(target, "version.yml")));
    assert.ok(existsSync(join(target, ".github/scripts/version_manager.py")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

```bash
node --test tests/node/dry-run-cli.test.js
```

Expected: FAIL — `dryRun`이 항상 `undefined`, `--dry-run`이 "알 수 없는 옵션" 에러를 던짐.

- [ ] **Step 3: `src/cli/args.js`에 `--dry-run` 플래그 추가**

`result` 초기값 객체에 필드 추가:

```javascript
    dryRun: false,        // --dry-run: 실제 변경 없이 미리보기만 (full/version/workflows/revert 공통)
```

`switch (a)` 안, `case "--force": result.force = true; break;` 바로 뒤에 추가:

```javascript
      case "--dry-run": result.dryRun = true; break;
```

- [ ] **Step 4: `src/index.js`에 dry-run 분기 배선**

Import 블록에 추가:

```javascript
import { planDryRun, printDryRun } from "./commands/dry-run.js";
```

**먼저 원격 부수효과 차단**: `src/index.js`에는 `switch (opts.mode)` 훨씬 앞, pr-flow 브랜치 구성 직후에 원격에 develop 브랜치가 없으면 **실제로 생성 + push하는** 블록이 있다:

```javascript
  if (branches.mode === "pr-flow") {
    const remoteBranches = await detectRemoteBranches(cwd);
    if (remoteBranches.length && !remoteBranches.includes(branches.develop)) {
      await ensureDevelopBranch({
        develop: branches.develop, remoteBranches, confirm: null, cwd,
        log: (m) => console.error(m),
      });
    }
  }
```

`--dry-run`은 "실제 쓰기는 수행하지 않는다"는 계약이므로, 이 블록이 dry-run에서도 원격 브랜치를 만들고 push해버리면 계약 위반이다. 이 블록을 아래로 교체해 dry-run일 때는 건너뛴다:

```javascript
  if (branches.mode === "pr-flow" && !opts.dryRun) {
    const remoteBranches = await detectRemoteBranches(cwd);
    if (remoteBranches.length && !remoteBranches.includes(branches.develop)) {
      await ensureDevelopBranch({
        develop: branches.develop, remoteBranches, confirm: null, cwd,
        log: (m) => console.error(m),
      });
    }
  }
```

`revert` 모드 블록을 아래로 교체(dry-run 시 실제 제거를 건너뛰고 미리보기만 출력):

```javascript
  // revert 모드 — payload 유래 파일 제거 (감지·질문 불필요, --force 게이트만)
  if (opts.mode === "revert") {
    if (!opts.force && !process.stdout.isTTY) {
      console.error("비대화형 환경에서는 --force 옵션이 필요합니다.");
      return 1;
    }
    if (opts.dryRun) {
      printDryRun(planDryRun("revert", {}, payload, cwd));
      return 0;
    }
    const r = runRevert({}, payload, cwd);
    console.error(`제거됨 — 워크플로우 ${r.workflows.length}개, 스크립트 ${r.scripts.length}개${r.coderabbit ? ", .coderabbit.yaml" : ""}`);
    console.error("version.yml·README·.gitignore는 보존됩니다 (사용자 데이터).");
    return 0;
  }
```

`switch (opts.mode) { case "full": ... }` 블록 바로 앞(Breaking Changes 게이트 이후, context 생성 이후)에 삽입:

```javascript
  if (opts.dryRun) {
    printDryRun(planDryRun(opts.mode, context, payload, cwd));
    return 0;
  }

  let result = null;
  switch (opts.mode) {
```

(기존 `let result = null; switch (opts.mode) {` 줄 앞에 위 `if (opts.dryRun)` 블록을 끼워 넣는 형태.)

- [ ] **Step 5: `src/cli/help.js` 문서화**

```javascript
      --dry-run             실제 파일 변경 없이 무엇이 바뀔지만 미리 보여줌 (full/version/workflows/revert 전체 지원)
```

예시 섹션에 추가:

```javascript
  npx project-auto-wizard --mode full --force --type node --dry-run
```

- [ ] **Step 6: 테스트 재실행**

```bash
node --test tests/node/dry-run-cli.test.js
```

Expected: 전부 PASS.

- [ ] **Step 7: 전체 회귀 테스트**

```bash
npm test
```

Expected: node + python 전부 PASS.

- [ ] **Step 8: Commit**

```bash
git add src/cli/args.js src/cli/help.js src/index.js tests/node/dry-run-cli.test.js
git commit -m "feat(cli): wire --dry-run flag across full/version/workflows/revert"
```

> **범위 명시**: `--dry-run`은 비대화형 CLI 플래그로만 지원한다. `src/commands/interactive.js`의 대화형 흐름(확인 루프)에는 통합하지 않는다 — 대화형은 이미 자체 확인 단계(analysisCard → confirm/edit)가 있어 dry-run과 UX가 겹치고, 통합하려면 확인 루프 리디자인이 필요해 범위가 커진다(스펙에 없는 확장이므로 이번 계획에서 제외).

## Phase 5 — AI 프롬프트 입력 확장 (`git diff --stat`)

### Task 17: `changelog_manager.py`에 diff-stat 프롬프트 입력 추가

**Files:**
- Modify: `payload/scripts/changelog_manager.py`
- Test: `tests/py/test_ai_summary.py` (추가 테스트)
- Modify: `.github/scripts/changelog_manager.py` (동기화 — Step 5)

**Interfaces:**
- Produces: `_build_ai_prompt(commit_lines, pr_title, version, diff_stat=None)` — 기존 3-인자 호출부는 `diff_stat` 생략 시 동작 100% 동일(하위 호환).
- Produces: `cmd_ai_summary(commits_file, version, output_path, pr_title, diff_stat_file=None)` — 신규 `diff_stat_file` optional 인자.

- [ ] **Step 1: 실패하는 테스트 작성** (`tests/py/test_ai_summary.py` 파일 끝, `TestAiSummary` 클래스 안에 메서드 추가)

```python
    def test_diff_stat_included_when_provided(self):
        changelog_manager.os.environ["AI_API_KEY"] = "sk-user-key"
        diff_stat_file = Path(self.tmp) / "diff_stat.txt"
        diff_stat_file.write_text(" src/foo.js | 12 +++++++\n src/bar.js |  3 +--\n", encoding="utf-8")

        mock_resp = _mock_response({"choices": [{"message": {"content": "summary text"}}]})

        with patch.object(changelog_manager.urllib.request, "urlopen", return_value=mock_resp) as mock_urlopen:
            rc, payload, _ = self._run_main_capture(["--diff-stat-file", str(diff_stat_file)])

        self.assertEqual(rc, 0)
        req = mock_urlopen.call_args[0][0]
        body = json.loads(req.data.decode("utf-8"))
        self.assertIn("src/foo.js", body["messages"][0]["content"])

    def test_missing_diff_stat_file_is_tolerated(self):
        changelog_manager.os.environ["AI_API_KEY"] = "sk-user-key"
        mock_resp = _mock_response({"choices": [{"message": {"content": "summary text"}}]})

        with patch.object(changelog_manager.urllib.request, "urlopen", return_value=mock_resp):
            rc, payload, _ = self._run_main_capture(["--diff-stat-file", str(Path(self.tmp) / "missing.txt")])

        self.assertEqual(rc, 0)
        self.assertTrue(payload["ok"])

    def test_no_diff_stat_flag_behaves_exactly_as_before(self):
        with patch.object(changelog_manager.urllib.request, "urlopen") as mock_urlopen:
            rc, payload, _ = self._run_main_capture()
        self.assertEqual(rc, 0)
        self.assertEqual(payload["engine"], "fallback")
        mock_urlopen.assert_not_called()
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

```bash
python -m unittest tests.py.test_ai_summary -v
```

Expected: `test_diff_stat_included_when_provided`, `test_missing_diff_stat_file_is_tolerated`가 FAIL — `--diff-stat-file`은 아직 모르는 인자.

- [ ] **Step 3: `payload/scripts/changelog_manager.py` 수정**

`_build_ai_prompt` 함수 전체를 아래로 교체:

```python
def _build_ai_prompt(commit_lines: list[str], pr_title: str | None, version: str, diff_stat: str | None = None) -> str:
    """AI에게 보낼 한국어 릴리즈 요약 프롬프트를 구성.

    요청하는 출력 형식은 규칙 기반 폴백 렌더러(render_fallback_md)와 동일한
    형식으로 맞춘다 — 다운스트림(릴리즈 노트 소비자)이 엔진과 무관하게 단일
    형식만 보게 하기 위함이다.
    """
    parts = [
        "아래 커밋 목록을 바탕으로 한국어 릴리즈 요약을 작성해줘.",
        f"출력 형식: 첫 줄은 '## [{version}]' 헤더로 시작하고,",
        "해당 항목이 있는 섹션만 다음 이름으로 작성해줘:",
        "'### ✨ 기능', '### 🐛 수정', '### 📝 문서', '### ♻️ 리팩토링', '### ✅ 테스트', '### 🔧 변경사항'.",
        "각 항목은 '- '로 시작하는 불릿으로 작성해줘.",
    ]
    if pr_title:
        parts.append(f"PR 제목: {pr_title}")
    if diff_stat and diff_stat.strip():
        parts.append("파일별 변경 요약:")
        parts.append(diff_stat.strip())
    parts.append("커밋 목록:")
    parts.extend(f"- {line}" for line in commit_lines)
    return "\n".join(parts)
```

`cmd_ai_summary` 함수 시그니처와 본문 시작 부분을 아래로 교체:

```python
def cmd_ai_summary(commits_file: str, version: str, output_path: str, pr_title: str | None, diff_stat_file: str | None = None) -> int:
    """커밋 목록을 읽어 AI(우선) 또는 규칙 기반 폴백으로 릴리즈 요약을 생성."""
    try:
        with open(commits_file, 'r', encoding='utf-8') as f:
            commit_lines = [line.rstrip('\n').rstrip('\r') for line in f]
    except Exception:
        commit_lines = []

    diff_stat = None
    if diff_stat_file:
        try:
            with open(diff_stat_file, 'r', encoding='utf-8') as f:
                diff_stat = f.read()
        except Exception:
            diff_stat = None

    ai_api_key = os.environ.get('AI_API_KEY')
    ai_base_url = os.environ.get('AI_API_BASE_URL') or _AI_DEFAULT_BASE_URL
    ai_model = os.environ.get('AI_MODEL') or _AI_DEFAULT_MODEL
    github_token = os.environ.get('GITHUB_TOKEN')

    engine = None
    summary_text = None
    prompt = _build_ai_prompt(commit_lines, pr_title, version, diff_stat)
```

(이 아래 나머지 본문 — `if ai_api_key: ...`부터 `return 0`까지 — 는 기존 그대로 손대지 않는다.)

`main()`의 `p_ai_summary` argparse 설정과 dispatch를 아래로 교체:

```python
    p_ai_summary = sub.add_parser('ai-summary', help='커밋 목록으로 AI/규칙 기반 릴리즈 요약 생성')
    p_ai_summary.add_argument('--commits-file', required=True, help='커밋 제목 목록 파일 (한 줄당 1개)')
    p_ai_summary.add_argument('--version', required=True, help='버전 번호')
    p_ai_summary.add_argument('--output', required=True, help='요약 결과를 저장할 파일 경로')
    p_ai_summary.add_argument('--pr-title', help='PR 제목 (프롬프트 컨텍스트로 사용, 선택)')
    p_ai_summary.add_argument('--diff-stat-file', help='git diff --stat 출력 파일 (프롬프트 컨텍스트 확장, 선택)')
```

```python
    if args.command == 'ai-summary':
        return cmd_ai_summary(args.commits_file, args.version, args.output, args.pr_title, args.diff_stat_file)
```

- [ ] **Step 4: 테스트 재실행**

```bash
python -m unittest tests.py.test_ai_summary -v
```

Expected: 전부 PASS.

- [ ] **Step 5: `.github/scripts/changelog_manager.py`에 동일 변경 동기화**

이 레포는 자기 자신에게 설치된 사본(`.github/scripts/`)을 갖고 있고, 두 파일은 바이트 동일해야 한다(`payload/scripts/*.py`가 단일 진실). Step 3과 동일한 변경을 `.github/scripts/changelog_manager.py`에도 적용한다.

```bash
diff payload/scripts/changelog_manager.py .github/scripts/changelog_manager.py && echo "already identical" || cp payload/scripts/changelog_manager.py .github/scripts/changelog_manager.py
```

- [ ] **Step 6: 전체 Python 테스트 회귀 확인**

```bash
npm run test:py
```

Expected: 전부 PASS(`test_sh_equivalence.py` 포함 — 시그니처를 optional 인자로만 확장했으므로 회귀 없어야 함).

- [ ] **Step 7: Commit**

```bash
git add payload/scripts/changelog_manager.py .github/scripts/changelog_manager.py tests/py/test_ai_summary.py
git commit -m "feat(ai): extend release summary prompt with git diff --stat context"
```

### Task 18: `AUTO-CHANGELOG-CONTROL` 워크플로우에 diff --stat 수집 단계 추가

**Files:**
- Modify: `payload/workflows/common/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml`
- Modify: `.github/workflows/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml` (동기화, 브랜치 플레이스홀더 치환)

**Interfaces:** 없음(YAML 워크플로우 스텝 편집). `changelog_manager.py ai-summary`에 Task 17에서 추가한 `--diff-stat-file` 옵션을 소비한다.

- [ ] **Step 1: `payload/workflows/common/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml`의 "Generate summary with the AI engine chain" 스텝 수정**

`run: |` 블록을 아래로 교체:

```yaml
        run: |
          VERSION=$(python3 .github/scripts/version_manager.py get | tail -n 1)

          git fetch origin {{MAIN_BRANCH}}
          git log --pretty=%s "origin/{{MAIN_BRANCH}}..HEAD" > commits.txt
          git diff --stat "origin/{{MAIN_BRANCH}}...HEAD" | head -50 > diff_stat.txt
          echo "commits to summarize: $(wc -l < commits.txt)"

          python3 .github/scripts/changelog_manager.py ai-summary \
            --commits-file commits.txt \
            --version "$VERSION" \
            --output summary.md \
            --pr-title "$PR_TITLE" \
            --diff-stat-file diff_stat.txt

          # Feed the generated summary through the same channel the
          # CodeRabbit path uses: update-from-summary reads ./pr_body.md
          cp summary.md pr_body.md
```

- [ ] **Step 2: 파일 상단 주석의 엔진 설명에도 diff-stat 언급 추가**

`# 2. Acquires a release summary:` 아래 주석 블록에 한 줄 추가:

```yaml
#    - The AI prompt includes commit subjects plus a capped
#      `git diff --stat` (file-level change summary, no diff body)
#      for richer context without token-cost blowup.
```

- [ ] **Step 3: `.github/workflows/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml`에 동기화**

이 파일은 payload 버전과 브랜치 플레이스홀더만 다르다({{MAIN_BRANCH}}→main, {{DEVELOP_BRANCH}}→develop). Step 1의 변경을 아래처럼 치환해 적용한다:

```yaml
        run: |
          VERSION=$(python3 .github/scripts/version_manager.py get | tail -n 1)

          git fetch origin main
          git log --pretty=%s "origin/main..HEAD" > commits.txt
          git diff --stat "origin/main...HEAD" | head -50 > diff_stat.txt
          echo "commits to summarize: $(wc -l < commits.txt)"

          python3 .github/scripts/changelog_manager.py ai-summary \
            --commits-file commits.txt \
            --version "$VERSION" \
            --output summary.md \
            --pr-title "$PR_TITLE" \
            --diff-stat-file diff_stat.txt

          cp summary.md pr_body.md
```

- [ ] **Step 3.5: "Commit release docs" 스텝의 임시파일 정리 목록에 `diff_stat.txt` 추가**

이 워크플로우 뒷부분에 릴리스 커밋을 만드는 "Commit release docs" 스텝이 있고, 거기서 `rm -f pr_body.md summary.md commits.txt`로 임시 산출물을 지운 뒤 `git add -A`로 커밋한다. 새로 만든 `diff_stat.txt`를 이 rm 목록에 추가하지 않으면 **매 릴리스마다 이 파일이 사용자 레포(및 이 레포 자신)의 릴리스 커밋에 섞여 들어간다** — `commits.txt`를 지우는 것과 동일한 이유로 반드시 지워야 한다.

`payload/workflows/common/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml`과 `.github/workflows/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml` 양쪽에서 "Commit release docs" 스텝을 찾아:

```bash
rm -f pr_body.md summary.md commits.txt
```

를 아래로 교체:

```bash
rm -f pr_body.md summary.md commits.txt diff_stat.txt
```

- [ ] **Step 4: YAML 문법 검증**

```bash
npx -y js-yaml payload/workflows/common/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml > /dev/null && echo "payload OK"
npx -y js-yaml .github/workflows/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml > /dev/null && echo ".github OK"
```

- [ ] **Step 5: payload YAML 관련 기존 테스트 회귀 확인**

```bash
node --test tests/node/payload-yaml.test.js tests/node/e2e-matrix.test.js tests/node/install-matrix.test.js
```

Expected: 전부 PASS. 만약 `payload-yaml.test.js`가 이 파일 내용을 스냅샷/구조 검증하고 있다면(예: 특정 스텝 개수를 assert), 실패 내용을 보고 그 assertion을 이번 변경(신규 diff --stat 라인 추가)에 맞춰 갱신한다 — 이 계획에서는 정확한 assertion 내용을 미리 알 수 없으므로 실행 시점에 확인한다.

- [ ] **Step 6: Commit**

```bash
git add payload/workflows/common/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml .github/workflows/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml
git commit -m "feat(ai): collect git diff --stat for release summary generation"
```

## Phase 6 — 자체 AI PR 요약봇 (CodeRabbit과 상호 배타적)

### Task 19: `PROJECT-COMMON-AI-PR-SUMMARY.yaml` 신규 워크플로우

**Files:**
- Create: `payload/workflows/common/PROJECT-COMMON-AI-PR-SUMMARY.yaml`
- Create: `.github/workflows/PROJECT-COMMON-AI-PR-SUMMARY.yaml` (이 레포 자신에게 동기화, 브랜치 치환)
- Test: `tests/node/ai-pr-summary.test.js`

**Interfaces:** 없음(신규 YAML). `copyWorkflows`(`src/core/copy/workflows.js`)는 `payload/workflows/common/` 아래 `*.yaml` 파일을 전부 제네릭하게 순회하므로(파일명 하드코딩 없음, `TRUNK_BASED_EXCLUDED` 집합에도 포함 안 시킴) **이 파일을 추가하는 것만으로 기존 마법사 코드 변경 없이 자동 설치 대상이 된다.**

- [ ] **Step 1: 실패하는 테스트 작성**

```javascript
// tests/node/ai-pr-summary.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";

function install(overrides = {}) {
  const target = mkdtempSync(join(tmpdir(), "paw-ai-pr-"));
  const ctx = createContext({
    mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(), includeCodeRabbit: false,
    now: "2026-07-28 00:00:00", today: "2026-07-28", templateVersion: "0.1.0",
    ...overrides,
  });
  runFull(ctx, resolvePayloadRoot(), target);
  return target;
}

test("PROJECT-COMMON-AI-PR-SUMMARY.yaml is installed as part of common workflows", () => {
  const target = install();
  try {
    const p = join(target, ".github/workflows/PROJECT-COMMON-AI-PR-SUMMARY.yaml");
    assert.ok(existsSync(p));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("installed copy has {{MAIN_BRANCH}}/{{DEVELOP_BRANCH}} placeholders substituted", () => {
  const target = install();
  try {
    const content = readFileSync(join(target, ".github/workflows/PROJECT-COMMON-AI-PR-SUMMARY.yaml"), "utf8");
    assert.ok(!content.includes("{{MAIN_BRANCH}}"));
    assert.match(content, /branches: \["main"\]/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("trunk-based mode also installs it (not in TRUNK_BASED_EXCLUDED)", () => {
  const target = install({ branches: { main: "main", develop: "main", mode: "trunk-based" } });
  try {
    assert.ok(existsSync(join(target, ".github/workflows/PROJECT-COMMON-AI-PR-SUMMARY.yaml")));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

```bash
node --test tests/node/ai-pr-summary.test.js
```

Expected: FAIL — 파일이 아직 없어 `existsSync`가 false.

- [ ] **Step 3: `payload/workflows/common/PROJECT-COMMON-AI-PR-SUMMARY.yaml` 작성**

```yaml
# ===================================================================
# PROJECT-COMMON-AI-PR-SUMMARY.yaml
# Self-hosted AI PR summary bot — CodeRabbit-independent alternative.
# ===================================================================
#
# Posts an AI-generated summary comment on PRs targeting the default
# branch, using the same zero-API-key engine chain as the release
# changelog (user API key -> GitHub Models -> rule-based fallback).
# The prompt includes commit subjects plus a capped `git diff --stat`.
#
# Mutually exclusive with CodeRabbit by design: if version.yml
# metadata.template.options.coderabbit is true, this workflow no-ops
# immediately — CodeRabbit already covers PR summaries, and posting
# both on the same PR would be redundant/confusing.
#
# Independent from PROJECT-COMMON-AUTO-CHANGELOG-CONTROL: on release
# PRs both workflows may call the AI engine once each (up to 2 LLM
# calls total). This is an accepted trade-off for simplicity — GitHub
# Models is free-tier and rule-based fallback is instant either way.
# ===================================================================

name: PROJECT-AI-PR-SUMMARY

on:
  pull_request:
    types: [opened, synchronize, reopened]
    branches: ["{{MAIN_BRANCH}}"]

permissions:
  contents: read
  pull-requests: write
  models: read

jobs:
  ai-pr-summary:
    name: Post AI summary comment
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    steps:
      - name: Checkout PR head
        uses: actions/checkout@v5
        with:
          fetch-depth: 0
          ref: ${{ github.event.pull_request.head.ref }}

      - name: Read coderabbit option from version.yml
        id: options
        run: |
          CODERABBIT=$(python3 -c 'import re; t=open("version.yml",encoding="utf-8").read(); m=re.search(r"metadata:.*?template:.*?options:.*?coderabbit:\s*\"?(true|false)", t, re.S); print(m.group(1) if m else "false")' 2>/dev/null || echo "false")
          echo "coderabbit=$CODERABBIT" >> $GITHUB_OUTPUT

      - name: Generate and post AI summary
        if: steps.options.outputs.coderabbit != 'true'
        env:
          PR_TITLE: ${{ github.event.pull_request.title }}
          AI_API_KEY: ${{ secrets.AI_API_KEY }}
          AI_API_BASE_URL: ${{ vars.AI_API_BASE_URL }}
          AI_MODEL: ${{ vars.AI_MODEL }}
          GITHUB_TOKEN: ${{ github.token }}
        run: |
          PR_NUMBER=${{ github.event.pull_request.number }}
          VERSION=$(python3 .github/scripts/version_manager.py get 2>/dev/null | tail -n 1)
          VERSION=${VERSION:-unreleased}

          git fetch origin {{MAIN_BRANCH}}
          git log --pretty=%s "origin/{{MAIN_BRANCH}}..HEAD" > commits.txt
          git diff --stat "origin/{{MAIN_BRANCH}}...HEAD" | head -50 > diff_stat.txt

          python3 .github/scripts/changelog_manager.py ai-summary \
            --commits-file commits.txt \
            --version "$VERSION" \
            --output summary.md \
            --pr-title "$PR_TITLE" \
            --diff-stat-file diff_stat.txt

          {
            echo "🤖 **AI Summary (project-auto-wizard)**"
            echo ""
            cat summary.md
          } > comment_body.md

          python3 -c 'import json; print(json.dumps({"body": open("comment_body.md", encoding="utf-8").read()}))' > comment_payload.json

          curl -s -H "Authorization: token ${{ github.token }}" \
               -H "Content-Type: application/json" \
               -X POST \
               -d @comment_payload.json \
               "https://api.github.com/repos/${{ github.repository }}/issues/${PR_NUMBER}/comments" > /dev/null \
            || echo "comment post failed — continuing (this workflow never blocks the PR)"
```

- [ ] **Step 4: 브랜치 플레이스홀더를 치환한 사본을 `.github/workflows/PROJECT-COMMON-AI-PR-SUMMARY.yaml`로 생성**

Step 3 내용에서 `{{MAIN_BRANCH}}` → `main`으로 전부 치환한 동일 파일을 만든다(`{{DEVELOP_BRANCH}}`는 이 워크플로우에 등장하지 않는다).

```bash
sed 's/{{MAIN_BRANCH}}/main/g' payload/workflows/common/PROJECT-COMMON-AI-PR-SUMMARY.yaml > .github/workflows/PROJECT-COMMON-AI-PR-SUMMARY.yaml
```

- [ ] **Step 5: YAML 문법 검증**

```bash
npx -y js-yaml payload/workflows/common/PROJECT-COMMON-AI-PR-SUMMARY.yaml > /dev/null && echo "payload OK"
npx -y js-yaml .github/workflows/PROJECT-COMMON-AI-PR-SUMMARY.yaml > /dev/null && echo ".github OK"
```

- [ ] **Step 6: 테스트 재실행**

```bash
node --test tests/node/ai-pr-summary.test.js
```

Expected: 전부 PASS.

- [ ] **Step 7: 기존 카운트 기반 테스트 확인**

```bash
npm run test:node
```

`e2e-matrix.test.js`/`install-matrix.test.js`/`payload-yaml.test.js`가 common 워크플로우 개수를 하드코딩해 assert하고 있다면 이 시점에 FAIL한다 — 실패 메시지를 보고 해당 assertion을 "+1"로 갱신한다(정확한 라인은 실행 시점에 확인).

- [ ] **Step 8: Commit**

```bash
git add payload/workflows/common/PROJECT-COMMON-AI-PR-SUMMARY.yaml .github/workflows/PROJECT-COMMON-AI-PR-SUMMARY.yaml tests/node/ai-pr-summary.test.js
git commit -m "feat(ai): add self-hosted PR summary bot as a CodeRabbit-independent alternative"
```

> 릴리스 PR(pr-flow의 develop→main)에서 CodeRabbit이 꺼져 있으면 이 워크플로우와 `AUTO-CHANGELOG-CONTROL`이 각각 별도로 AI 엔진을 호출한다(설계 결정 — 스펙 §3.4⑤ 참조). 통합하지 않기로 확정했으므로 이 태스크에서 추가 조치는 필요 없다.

## Phase 7 — 자동 semver 승격 (major/minor/patch + AI 보조판단)

> `breaking-check.js`/`breaking-changes.json`(마법사 자체 템플릿 버전 축)은 이 Phase에서 전혀 건드리지 않는다 — 스펙 §3.3① 정정 참조.

### Task 20: `classify_bump_level()` 규칙 기반 분류 + `classify-bump` 서브커맨드

**Files:**
- Modify: `payload/scripts/changelog_manager.py`
- Test: Create `tests/py/test_classify_bump.py`
- Modify: `.github/scripts/changelog_manager.py` (동기화)

**Interfaces:**
- Produces: `classify_bump_level(lines: list[str]) -> str` — `"major"|"minor"|"patch"`. 내부적으로 기존 `classify_commits()`를 재사용(`feat` 버킷 존재 여부로 minor 판단), `!` 마커는 별도 정규식으로 판단. `classify_commits()`의 반환 계약은 변경하지 않는다.
- `classify-bump` CLI 서브커맨드: `changelog_manager.py classify-bump --commits-file <path>` → stdout 마지막 줄에 `major`/`minor`/`patch` 출력.

- [ ] **Step 1: 실패하는 테스트 작성**

```python
# tests/py/test_classify_bump.py
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[2] / "payload" / "scripts"
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import changelog_manager  # noqa: E402


class TestClassifyBumpLevel(unittest.TestCase):
    def test_feat_conventional_commit_is_minor(self):
        self.assertEqual(changelog_manager.classify_bump_level(["feat: add login flow"]), "minor")

    def test_feat_projectops_convention_is_minor(self):
        self.assertEqual(changelog_manager.classify_bump_level(["로그인 기능 : feat : 소셜 로그인 추가"]), "minor")

    def test_bang_marker_on_any_type_is_major(self):
        self.assertEqual(changelog_manager.classify_bump_level(["feat!: drop legacy config format"]), "major")
        self.assertEqual(changelog_manager.classify_bump_level(["fix!: change default timeout unit"]), "major")
        self.assertEqual(changelog_manager.classify_bump_level(["chore!: remove deprecated CLI flag"]), "major")

    def test_bang_with_scope_is_major(self):
        self.assertEqual(changelog_manager.classify_bump_level(["feat(api)!: change response shape"]), "major")

    def test_fix_only_is_patch(self):
        self.assertEqual(changelog_manager.classify_bump_level(["fix: crash on start", "chore: bump deps"]), "patch")

    def test_unmatched_freeform_commits_are_patch(self):
        self.assertEqual(changelog_manager.classify_bump_level(["updated stuff", "wip"]), "patch")

    def test_empty_list_is_patch(self):
        self.assertEqual(changelog_manager.classify_bump_level([]), "patch")

    def test_major_wins_over_minor_in_same_release(self):
        lines = ["feat: add dashboard", "feat!: remove v1 API"]
        self.assertEqual(changelog_manager.classify_bump_level(lines), "major")

    def test_skip_ci_and_merge_lines_are_ignored(self):
        lines = ["[skip ci] chore(version): bump to v1.2.3", "Merge pull request #1"]
        self.assertEqual(changelog_manager.classify_bump_level(lines), "patch")


class TestCmdClassifyBump(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.env_patcher = None

    def _run(self, commit_lines, capsys_lines):
        commits_file = Path(self.tmp) / "commits.txt"
        commits_file.write_text("\n".join(commit_lines) + "\n", encoding="utf-8")
        import io
        import contextlib
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            rc = changelog_manager.main(["classify-bump", "--commits-file", str(commits_file)])
        return rc, out.getvalue().strip().splitlines()[-1]

    def test_cli_prints_bump_as_last_stdout_line(self):
        rc, last_line = self._run(["feat: add login"], [])
        self.assertEqual(rc, 0)
        self.assertEqual(last_line, "minor")

    def test_cli_missing_commits_file_treated_as_empty(self):
        import contextlib
        import io
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            rc = changelog_manager.main(["classify-bump", "--commits-file", str(Path(self.tmp) / "missing.txt")])
        self.assertEqual(rc, 0)
        self.assertEqual(out.getvalue().strip().splitlines()[-1], "patch")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

```bash
python -m unittest tests.py.test_classify_bump -v
```

Expected: FAIL — `classify_bump_level` 없음, `classify-bump` 서브커맨드 없음.

- [ ] **Step 3: `payload/scripts/changelog_manager.py`에 구현 추가**

`_FALLBACK_BUCKET_KEYS` 정의 바로 아래, `def classify_commits(...)` 함수 앞에 정규식 추가:

```python
# 승격 폭 판단 전용 — 타입 뒤 `!` 마커(어떤 타입이든)는 breaking 신호.
# BREAKING CHANGE: 본문 푸터는 지원하지 않는다(커밋 수집이 제목 한 줄만
# 가져오는 구조라 본문에 접근 불가 — Conventional Commits 스펙 조항 13에
# 따르면 `!` 마커 단독으로도 표준을 만족하므로 이는 표준이 허용하는 부분집합).
_BREAKING_MARKER_RE = re.compile(r'^[a-zA-Z]+(\([^)]*\))?!:')
```

`render_fallback_md` 함수 뒤, `# ------------------------ 서브커맨드 구현부 ------------------------` 주석 앞에 추가:

```python
def classify_bump_level(lines: list[str]) -> str:
    """커밋 제목 목록에서 semver 승격 폭을 규칙 기반으로 판단.

    - 타입 뒤 `!` 마커 포함 -> major
    - `feat:`(classify_commits의 feat 버킷과 동일 판정 기준) 포함 -> minor
    - 그 외(매칭 실패 포함) -> patch
    """
    for raw_line in lines:
        line = raw_line.strip()
        if not line or '[skip ci]' in line or line.startswith('Merge '):
            continue
        if _BREAKING_MARKER_RE.match(line):
            return 'major'
    classified = classify_commits(lines)
    return 'minor' if classified.get('feat') else 'patch'


def cmd_classify_bump(commits_file: str) -> int:
    """커밋 목록 파일을 읽어 semver 승격 폭(major/minor/patch)을 stdout 마지막 줄에 출력."""
    try:
        with open(commits_file, 'r', encoding='utf-8') as f:
            commit_lines = [line.rstrip('\n').rstrip('\r') for line in f]
    except Exception:
        commit_lines = []
    print(classify_bump_level(commit_lines))
    return 0
```

`main()`의 `sub.add_parser('generate-md', ...)` 줄 뒤에 추가:

```python
    p_classify_bump = sub.add_parser('classify-bump', help='커밋 목록으로 semver 승격 폭(major/minor/patch) 판단')
    p_classify_bump.add_argument('--commits-file', required=True, help='커밋 제목 목록 파일 (한 줄당 1개)')
```

`main()`의 dispatch(`if args.command == 'export': ...`) 뒤에 추가:

```python
    if args.command == 'classify-bump':
        return cmd_classify_bump(args.commits_file)
```

- [ ] **Step 4: 테스트 재실행**

```bash
python -m unittest tests.py.test_classify_bump -v
```

Expected: 전부 PASS.

- [ ] **Step 5: 전체 Python 회귀 확인 + `.github/` 동기화**

```bash
npm run test:py
cp payload/scripts/changelog_manager.py .github/scripts/changelog_manager.py
```

- [ ] **Step 6: Commit**

```bash
git add payload/scripts/changelog_manager.py .github/scripts/changelog_manager.py tests/py/test_classify_bump.py
git commit -m "feat(release): add rule-based semver bump classification (feat->minor, !->major)"
```

### Task 21: 애매한 커밋에 대한 AI 보조판단 (patch→minor 상한)

**Files:**
- Modify: `payload/scripts/changelog_manager.py`
- Test: `tests/py/test_classify_bump.py` (추가)
- Modify: `.github/scripts/changelog_manager.py` (동기화)

**Interfaces:**
- Consumes: 기존 `call_openai_compatible(base_url, token, model, prompt)`(변경 없음), `classify_commits()`의 `changes` 버킷(미분류 자유형식 커밋).
- `cmd_classify_bump`의 동작이 확장됨: 규칙 결과가 patch이고 `classify_commits()`의 `changes` 버킷이 비어있지 않을 때만 AI 호출을 시도. **AI는 절대 major를 만들 수 없고, 응답이 정확히 `MINOR`가 아니면 무조건 patch로 확정.**

- [ ] **Step 1: 실패하는 테스트 작성** (`tests/py/test_classify_bump.py`에 클래스 추가)

```python
class TestAiAssistedBumpUpgrade(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.env_patcher = unittest.mock.patch.dict(changelog_manager.os.environ, {}, clear=True)
        self.env_patcher.start()
        self.addCleanup(self.env_patcher.stop)

    def _run(self, commit_lines):
        import contextlib
        import io
        commits_file = Path(self.tmp) / "commits.txt"
        commits_file.write_text("\n".join(commit_lines) + "\n", encoding="utf-8")
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            rc = changelog_manager.main(["classify-bump", "--commits-file", str(commits_file)])
        return rc, out.getvalue().strip().splitlines()[-1]

    def _mock_response(self, content):
        m = unittest.mock.MagicMock()
        m.read.return_value = ('{"choices":[{"message":{"content":"%s"}}]}' % content).encode("utf-8")
        m.__enter__.return_value = m
        m.__exit__.return_value = False
        return m

    def test_ai_upgrades_patch_to_minor_when_response_is_MINOR(self):
        changelog_manager.os.environ["AI_API_KEY"] = "sk-test"
        with unittest.mock.patch.object(
            changelog_manager.urllib.request, "urlopen", return_value=self._mock_response("MINOR"),
        ):
            rc, last_line = self._run(["add dark mode toggle to settings screen"])
        self.assertEqual(rc, 0)
        self.assertEqual(last_line, "minor")

    def test_ai_keeps_patch_when_response_is_PATCH(self):
        changelog_manager.os.environ["AI_API_KEY"] = "sk-test"
        with unittest.mock.patch.object(
            changelog_manager.urllib.request, "urlopen", return_value=self._mock_response("PATCH"),
        ):
            rc, last_line = self._run(["tweak internal logging format"])
        self.assertEqual(rc, 0)
        self.assertEqual(last_line, "patch")

    def test_ai_never_produces_major(self):
        changelog_manager.os.environ["AI_API_KEY"] = "sk-test"
        with unittest.mock.patch.object(
            changelog_manager.urllib.request, "urlopen", return_value=self._mock_response("MAJOR"),
        ):
            rc, last_line = self._run(["completely rewrite the public API"])
        self.assertEqual(rc, 0)
        # 응답이 형식을 안 지키면(정확히 MINOR가 아니면) 규칙 결과 patch로 확정 — major는 나올 수 없음.
        self.assertEqual(last_line, "patch")

    def test_ai_call_failure_falls_back_to_rule_result(self):
        changelog_manager.os.environ["AI_API_KEY"] = "sk-test"
        with unittest.mock.patch.object(
            changelog_manager.urllib.request, "urlopen", side_effect=URLError("timed out"),
        ):
            rc, last_line = self._run(["random freeform commit message"])
        self.assertEqual(rc, 0)
        self.assertEqual(last_line, "patch")

    def test_no_api_key_no_token_skips_ai_and_stays_patch(self):
        rc, last_line = self._run(["random freeform commit message"])
        self.assertEqual(rc, 0)
        self.assertEqual(last_line, "patch")

    def test_feat_result_never_calls_ai(self):
        with unittest.mock.patch.object(changelog_manager.urllib.request, "urlopen") as mock_urlopen:
            rc, last_line = self._run(["feat: add login"])
        self.assertEqual(last_line, "minor")
        mock_urlopen.assert_not_called()
```

파일 상단 import에 `unittest.mock`과 `URLError`가 필요하다 — 이미 `test_ai_summary.py` 스타일과 동일하게 파일 최상단에 아래를 추가한다:

```python
import unittest.mock
from urllib.error import URLError
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

```bash
python -m unittest tests.py.test_classify_bump -v
```

Expected: `TestAiAssistedBumpUpgrade`의 전 테스트 FAIL — 아직 AI 보조판단 없음(항상 규칙 결과만 나옴).

- [ ] **Step 3: `payload/scripts/changelog_manager.py`에 AI 보조판단 추가**

`cmd_classify_bump` 함수를 아래로 교체하고, 그 앞에 헬퍼 2개를 추가:

```python
_BUMP_AI_PROMPT_PREFIX = (
    "다음은 정해진 커밋 컨벤션을 따르지 않는 자유형식 커밋 메시지들이다.\n"
    "이 중 사용자 대상 새로운 기능(feature) 추가로 보이는 것이 하나라도 있으면 정확히 MINOR라고만 답하고,\n"
    "없으면 정확히 PATCH라고만 답해라. 다른 말은 절대 덧붙이지 마라.\n"
    "커밋 목록:\n"
)


def _ai_assisted_minor_upgrade(unclassified_lines: list[str]) -> bool:
    """규칙 분류가 patch일 때, 미분류 자유형식 커밋에 한해 AI에게 minor 업그레이드
    여부만 보조 판단시킨다. AI는 절대 major를 만들 수 없다 — major는 항상 명시적
    `!` 마커만 신뢰한다(classify_bump_level에서 이미 확정됨). 응답이 정확히
    'MINOR'가 아니거나 호출이 실패하면 무조건 False(규칙 결과 patch 유지)."""
    if not unclassified_lines:
        return False
    prompt = _BUMP_AI_PROMPT_PREFIX + "\n".join(f"- {line}" for line in unclassified_lines)

    ai_api_key = os.environ.get('AI_API_KEY')
    github_token = os.environ.get('GITHUB_TOKEN')
    candidates = [
        (ai_api_key, os.environ.get('AI_API_BASE_URL') or _AI_DEFAULT_BASE_URL, os.environ.get('AI_MODEL') or _AI_DEFAULT_MODEL),
        (github_token, _AI_DEFAULT_BASE_URL, _AI_DEFAULT_MODEL),
    ]
    for token, base_url, model in candidates:
        if not token:
            continue
        try:
            response = call_openai_compatible(base_url, token, model, prompt)
            return response.strip() == 'MINOR'
        except Exception as e:
            print(f"[warn] bump AI assist failed: {e}", file=sys.stderr)
            continue
    return False


def cmd_classify_bump(commits_file: str) -> int:
    """커밋 목록 파일을 읽어 semver 승격 폭(major/minor/patch)을 stdout 마지막 줄에 출력.

    규칙 우선(feat->minor, !마커->major, 그외->patch). 규칙 결과가 patch이고
    분류 안 된 자유형식 커밋이 있으면, AI에게 patch->minor 업그레이드 여부만
    보조 판단시킨다(major는 AI가 절대 만들 수 없음).
    """
    try:
        with open(commits_file, 'r', encoding='utf-8') as f:
            commit_lines = [line.rstrip('\n').rstrip('\r') for line in f]
    except Exception:
        commit_lines = []

    bump = classify_bump_level(commit_lines)
    if bump == 'patch':
        classified = classify_commits(commit_lines)
        if _ai_assisted_minor_upgrade(classified.get('changes') or []):
            bump = 'minor'

    print(bump)
    return 0
```

> `test_ai_never_produces_major`가 요구하는 동작: 응답이 `MAJOR`처럼 형식을 안 지키면 `response.strip() == 'MINOR'`가 `False`이므로 자동으로 patch 유지 — 별도 분기 불필요, 위 구현이 이미 이 요구를 만족한다.

- [ ] **Step 4: 테스트 재실행**

```bash
python -m unittest tests.py.test_classify_bump -v
```

Expected: 전부 PASS.

- [ ] **Step 5: 전체 Python 회귀 확인 + `.github/` 동기화**

```bash
npm run test:py
cp payload/scripts/changelog_manager.py .github/scripts/changelog_manager.py
```

- [ ] **Step 6: Commit**

```bash
git add payload/scripts/changelog_manager.py .github/scripts/changelog_manager.py tests/py/test_classify_bump.py
git commit -m "feat(release): AI-assisted patch->minor upgrade for unclassified commits (major stays rule-only)"
```

### Task 22: `version_manager.py`에 major/minor/patch 승격 반영

**Files:**
- Modify: `payload/scripts/version_manager.py`
- Test: Create `tests/py/test_increment_bump.py`
- Modify: `.github/scripts/version_manager.py` (동기화)

**Interfaces:**
- Produces: `increment_version(version: str, bump: str = 'patch') -> str`. `bump` 생략 시 기존 `increment_patch(version)`과 100% 동일 동작(하위 호환).
- `increment` CLI 서브커맨드에 `--bump {major,minor,patch}` optional 인자 추가(기본 `patch`) — 기존 `version_manager.py increment`(인자 없음) 호출은 그대로 patch+1로 동작.

- [ ] **Step 1: 실패하는 테스트 작성**

```python
# tests/py/test_increment_bump.py
import contextlib
import io
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[2] / "payload" / "scripts"
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import version_manager  # noqa: E402


class TestIncrementVersion(unittest.TestCase):
    def test_default_bump_is_patch(self):
        self.assertEqual(version_manager.increment_version("1.2.3"), "1.2.4")

    def test_explicit_patch(self):
        self.assertEqual(version_manager.increment_version("1.2.3", "patch"), "1.2.4")

    def test_minor_resets_patch_to_zero(self):
        self.assertEqual(version_manager.increment_version("1.2.3", "minor"), "1.3.0")

    def test_major_resets_minor_and_patch_to_zero(self):
        self.assertEqual(version_manager.increment_version("1.2.3", "major"), "2.0.0")

    def test_matches_increment_patch_for_default(self):
        self.assertEqual(version_manager.increment_version("0.1.5"), version_manager.increment_patch("0.1.5"))


class TestCmdIncrementBumpFlag(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.cwd = Path.cwd()
        import os
        os.chdir(self.tmp)
        self.addCleanup(os.chdir, self.cwd)
        Path("version.yml").write_text('version: "1.0.0"\nversion_code: 1\n', encoding="utf-8")

    def _run(self, extra_args=None):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            rc = version_manager.main(["increment"] + (extra_args or []))
        return rc, out.getvalue().strip().splitlines()[-1]

    def test_no_bump_flag_defaults_to_patch(self):
        rc, last_line = self._run()
        self.assertEqual(rc, 0)
        self.assertEqual(last_line, "1.0.1")

    def test_bump_minor(self):
        rc, last_line = self._run(["--bump", "minor"])
        self.assertEqual(rc, 0)
        self.assertEqual(last_line, "1.1.0")

    def test_bump_major(self):
        rc, last_line = self._run(["--bump", "major"])
        self.assertEqual(rc, 0)
        self.assertEqual(last_line, "2.0.0")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

```bash
python -m unittest tests.py.test_increment_bump -v
```

Expected: FAIL — `increment_version` 없음, `--bump` 알 수 없는 인자.

- [ ] **Step 3: `payload/scripts/version_manager.py` 수정**

`increment_patch` 함수 뒤에 추가:

```python
def increment_version(version, bump="patch"):
    """bump: 'major'|'minor'|'patch'. 생략하면 기존과 동일하게 patch(increment_patch)로 동작."""
    if bump == "major":
        major, _minor, _patch = version.split(".")
        return f"{int(major) + 1}.0.0"
    if bump == "minor":
        major, minor, _patch = version.split(".")
        return f"{major}.{int(minor) + 1}.0"
    return increment_patch(version)
```

`cmd_increment` 함수를 아래로 교체:

```python
def cmd_increment(args):
    require_version_yml()
    current_version = sync_versions()
    if not validate_version(current_version):
        log(f"ERROR: invalid version format: {current_version}")
        return 1
    bump = getattr(args, "bump", None) or "patch"
    new_version = increment_version(current_version, bump)
    update_all_versions(new_version)

    current_code = int(get_version_code())
    set_version_code(current_code + 1)

    print(new_version)
    return 0
```

`build_parser()`의 `sub.add_parser("increment")` 줄을 아래로 교체:

```python
    p_increment = sub.add_parser("increment")
    p_increment.add_argument("--bump", choices=["major", "minor", "patch"], default="patch",
                              help="승격 폭 (기본 patch — 지정 안 하면 기존 동작과 동일)")
```

- [ ] **Step 4: 테스트 재실행**

```bash
python -m unittest tests.py.test_increment_bump -v
```

Expected: 전부 PASS.

- [ ] **Step 5: 전체 Python 회귀 확인 + `.github/` 동기화**

```bash
npm run test:py
cp payload/scripts/version_manager.py .github/scripts/version_manager.py
```

- [ ] **Step 6: Commit**

```bash
git add payload/scripts/version_manager.py .github/scripts/version_manager.py tests/py/test_increment_bump.py
git commit -m "feat(release): support major/minor/patch bump in version_manager.py increment --bump"
```

### Task 23: `version.yml` 스키마에 `semver_auto` 옵션 추가 + 마법사 배선

**Files:**
- Modify: `payload/version.yml.template`
- Modify: `src/core/version-yml.js`
- Modify: `src/commands/full.js`
- Modify: `src/commands/version.js`
- Modify: `src/commands/status.js` (출력에 semver_auto 노출)
- Modify: `src/commands/dry-run.js` (Task 15에서 만든 `versionYmlPreview`가 `includeSemverAuto`를 안 넘기면 항상 기본값 true로 렌더해, `semver_auto: false`로 설치된 레포에서 `--dry-run`이 실제로는 변경이 없는데도 "갱신될 예정"으로 오판한다)
- Test: `tests/node/semver-auto-option.test.js`

**Interfaces:**
- Modifies: `parseTemplateOptions(content)` 반환 객체에 `semverAuto: bool|null` 필드 추가.
- Modifies: `buildVersionYml({..., templateOptions})`가 `templateOptions.includeSemverAuto`(기본 **true** — 다른 옵션들과 달리 기본 ON)를 받아 `OPT_SEMVER_AUTO` 스칼라로 렌더링.

- [ ] **Step 1: 실패하는 테스트 작성**

```javascript
// tests/node/semver-auto-option.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { parseTemplateOptions, buildVersionYml } from "../../src/core/version-yml.js";
import { readVersionYmlTemplate } from "../../src/core/assets.js";

test("buildVersionYml: includeSemverAuto omitted defaults to true", () => {
  const text = buildVersionYml({
    templateText: readVersionYmlTemplate(resolvePayloadRoot()),
    version: "1.0.0", types: ["basic"], branch: "main",
    branches: { main: "main", develop: "develop", mode: "pr-flow" },
    versionCode: 1, now: "2026-07-28 00:00:00", today: "2026-07-28",
    templateOptions: { templateVersion: "0.1.0" },
  });
  const opts = parseTemplateOptions(text);
  assert.strictEqual(opts.semverAuto, true);
});

test("buildVersionYml: includeSemverAuto explicit false renders false", () => {
  const text = buildVersionYml({
    templateText: readVersionYmlTemplate(resolvePayloadRoot()),
    version: "1.0.0", types: ["basic"], branch: "main",
    branches: { main: "main", develop: "develop", mode: "pr-flow" },
    versionCode: 1, now: "2026-07-28 00:00:00", today: "2026-07-28",
    templateOptions: { templateVersion: "0.1.0", includeSemverAuto: false },
  });
  const opts = parseTemplateOptions(text);
  assert.strictEqual(opts.semverAuto, false);
});

test("runFull: default install has semver_auto: true in version.yml", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-semver-opt-"));
  try {
    const ctx = createContext({
      mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
      branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
      paths: new Map(), now: "2026-07-28 00:00:00", today: "2026-07-28", templateVersion: "0.1.0",
    });
    runFull(ctx, resolvePayloadRoot(), target);
    const opts = parseTemplateOptions(readFileSync(join(target, "version.yml"), "utf8"));
    assert.strictEqual(opts.semverAuto, true);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("runFull: includeSemverAuto:false in context renders false", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-semver-opt-"));
  try {
    const ctx = createContext({
      mode: "full", force: true, types: ["basic"], version: "1.0.0", versionCode: 1,
      branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
      paths: new Map(), includeSemverAuto: false,
      now: "2026-07-28 00:00:00", today: "2026-07-28", templateVersion: "0.1.0",
    });
    runFull(ctx, resolvePayloadRoot(), target);
    const opts = parseTemplateOptions(readFileSync(join(target, "version.yml"), "utf8"));
    assert.strictEqual(opts.semverAuto, false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

```bash
node --test tests/node/semver-auto-option.test.js
```

Expected: FAIL — `semverAuto`가 항상 `null`, `{{OPT_SEMVER_AUTO}}` 플레이스홀더 미해결로 `buildVersionYml`이 에러 던짐.

- [ ] **Step 3: `payload/version.yml.template` 수정**

파일 최상단 주석 블록의 아래 부분:

```
# - patch: auto-incremented by the release workflows
# - version_code: monotonically increasing build number, bumped alongside version
# - major/minor: NOT bumped automatically — edit this file manually
#   (e.g., 1.0.5 -> 1.1.0 or 2.0.0)
```

을 아래로 교체:

```
# - patch: auto-incremented by the release workflows
# - version_code: monotonically increasing build number, bumped alongside version
# - major/minor: auto-bumped when metadata.template.options.semver_auto is true
#   (default) — feat: commits bump minor, a `!` breaking marker on any commit
#   type bumps major. Set semver_auto: false to always patch-bump instead
#   (then edit major/minor manually, e.g., 1.0.5 -> 1.1.0 or 2.0.0).
```

`options:` 블록:

```
    options:
      nexus: {{OPT_NEXUS}}
      secret_backup: {{OPT_SECRET_BACKUP}}
      coderabbit: {{OPT_CODERABBIT}}
```

을 아래로 교체:

```
    options:
      nexus: {{OPT_NEXUS}}
      secret_backup: {{OPT_SECRET_BACKUP}}
      coderabbit: {{OPT_CODERABBIT}}
      semver_auto: {{OPT_SEMVER_AUTO}}
```

- [ ] **Step 4: `src/core/version-yml.js` 수정**

`parseTemplateOptions` 함수의 `const out = { nexus: null, secretBackup: null, coderabbit: null };`를 교체:

```javascript
  const out = { nexus: null, secretBackup: null, coderabbit: null, semverAuto: null };
```

같은 함수 안, `coderabbit:` 매칭 블록(`m = line.match(/^\s+coderabbit:\s*(.+)/); ...`) 바로 뒤에 추가:

```javascript
      m = line.match(/^\s+semver_auto:\s*(.+)/);
      if (m) {
        const v = strip(m[1]);
        if (v === "true") out.semverAuto = true;
        if (v === "false") out.semverAuto = false;
        continue;
      }
```

`buildVersionYml` 함수의 구조분해 할당:

```javascript
  const {
    templateVersion = "unknown", includeNexus = false, includeSecretBackup = false,
    includeCodeRabbit = false, optionsDate = today,
  } = templateOptions || {};
```

를 아래로 교체(**`includeSemverAuto` 기본값이 `true`인 것에 주의** — 다른 옵션들과 다름):

```javascript
  const {
    templateVersion = "unknown", includeNexus = false, includeSecretBackup = false,
    includeCodeRabbit = false, includeSemverAuto = true, optionsDate = today,
  } = templateOptions || {};
```

`scalars` 객체:

```javascript
    OPT_NEXUS: String(includeNexus), OPT_SECRET_BACKUP: String(includeSecretBackup),
    OPT_CODERABBIT: String(includeCodeRabbit),
```

를 아래로 교체:

```javascript
    OPT_NEXUS: String(includeNexus), OPT_SECRET_BACKUP: String(includeSecretBackup),
    OPT_CODERABBIT: String(includeCodeRabbit), OPT_SEMVER_AUTO: String(includeSemverAuto),
```

- [ ] **Step 5: `src/commands/full.js`와 `src/commands/version.js`에 배선**

두 파일 모두 구조분해 할당에 `includeSemverAuto` 추가하고, `templateOptions`에 전달한다. `src/commands/full.js`의 구조분해:

```javascript
  const { version, types = [], paths = new Map(), branch = "main", versionCode = 1,
    force = true, now, today, templateVersion = "unknown",
    includeNexus = false, includeSecretBackup = false, includeCodeRabbit = false } = context;
```

를 아래로 교체:

```javascript
  const { version, types = [], paths = new Map(), branch = "main", versionCode = 1,
    force = true, now, today, templateVersion = "unknown",
    includeNexus = false, includeSecretBackup = false, includeCodeRabbit = false,
    includeSemverAuto } = context;
```

`templateOptions:` 라인:

```javascript
      templateOptions: { templateVersion, includeNexus, includeSecretBackup, includeCodeRabbit: includeCodeRabbit === true, optionsDate: today },
```

를 아래로 교체(`includeSemverAuto !== false`로 기본 ON, 명시적 `false`만 OFF):

```javascript
      templateOptions: { templateVersion, includeNexus, includeSecretBackup, includeCodeRabbit: includeCodeRabbit === true, includeSemverAuto: includeSemverAuto !== false, optionsDate: today },
```

`src/commands/version.js`도 동일한 패턴으로 구조분해 할당과 `templateOptions:` 라인을 똑같이 고친다(두 파일의 해당 라인은 서로 동일한 형태).

- [ ] **Step 6: `src/commands/status.js`의 `printStatus` 출력에 semver_auto 추가**

`옵션            : nexus=${status.options.nexus} secret_backup=${status.options.secretBackup} coderabbit=${status.options.coderabbit}` 줄을 아래로 교체(`semverAuto`가 구버전 설치에서 `null`일 수 있으므로 사람이 읽기 좋은 문구로 폴백):

```javascript
  const semverAutoLabel = status.options.semverAuto === null ? "미설정(기본 true)" : status.options.semverAuto;
  lines.push(`옵션            : nexus=${status.options.nexus} secret_backup=${status.options.secretBackup} coderabbit=${status.options.coderabbit} semver_auto=${semverAutoLabel}`);
```

- [ ] **Step 7: `src/commands/dry-run.js`의 `versionYmlPreview`에 `includeSemverAuto` 전달**

Task 15에서 만든 `versionYmlPreview` 함수의 구조분해 할당(`includeNexus = false, includeSecretBackup = false, includeCodeRabbit = false } = context;`)에 `includeSemverAuto`를 추가하고, `buildVersionYml` 호출의 `templateOptions`에도 반영한다. `versionYmlPreview` 함수 전체를 아래로 교체:

```javascript
function versionYmlPreview(context, payloadRoot, targetRoot) {
  const { version, types = [], paths = new Map(), branch = "main", versionCode = 1,
    now, today, templateVersion = "unknown",
    includeNexus = false, includeSecretBackup = false, includeCodeRabbit = false,
    includeSemverAuto } = context;
  const pathMarkers = new Map();
  for (const [t] of paths) pathMarkers.set(t, markerForType(t));
  const wouldBe = buildVersionYml({
    templateText: readVersionYmlTemplate(payloadRoot),
    version, types, paths, pathMarkers, branch, branches: context.branches, versionCode, now, today,
    templateOptions: {
      templateVersion, includeNexus, includeSecretBackup,
      includeCodeRabbit: includeCodeRabbit === true,
      includeSemverAuto: includeSemverAuto !== false,
      optionsDate: today,
    },
  });
  const vyPath = join(targetRoot, PATHS.versionFile);
  const existing = existsSync(vyPath) ? readFileSync(vyPath, "utf8") : null;
  return { existed: existing !== null, changed: existing !== wouldBe };
}
```

이 변경으로 기존 `semver-auto-option.test.js`(Step 1)의 시나리오뿐 아니라, `semver_auto: false`로 이미 설치된 레포에서 `--dry-run --mode full`을 돌렸을 때도 정확히 "변경 없음"으로 판정되는지 아래 테스트를 `tests/node/dry-run.test.js`에 추가한다:

```javascript
test("planDryRun('full', ...) with semver_auto:false preserved -> versionYml unchanged", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  try {
    const ctx = baseContext({ includeSemverAuto: false });
    runFull(ctx, resolvePayloadRoot(), target);
    const plan = planDryRun("full", ctx, resolvePayloadRoot(), target);
    assert.strictEqual(plan.versionYml.changed, false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 8: 테스트 재실행**

```bash
node --test tests/node/semver-auto-option.test.js tests/node/dry-run.test.js
```

Expected: 전부 PASS.

- [ ] **Step 9: 전체 회귀 테스트**

```bash
npm run test:node
```

Expected: 전부 PASS(기존 `templateOptions` 소비처가 `includeSemverAuto`를 안 넘겨도 기본값 `true`로 안전하게 채워지므로 회귀 없어야 함 — 단, `coderabbit-optin.test.js` 등 기존 테스트가 `version.yml` 내용을 정확히 문자열 비교하고 있다면 새 `semver_auto:` 줄 때문에 실패할 수 있다. 실패 시 해당 assertion을 `parseTemplateOptions` 기반 비교로 바꾸거나 새 줄을 반영해 갱신한다).

- [ ] **Step 10: Commit**

```bash
git add payload/version.yml.template src/core/version-yml.js src/commands/full.js src/commands/version.js src/commands/status.js src/commands/dry-run.js tests/node/semver-auto-option.test.js tests/node/dry-run.test.js
git commit -m "feat(release): add semver_auto option to version.yml schema (default ON)"
```

### Task 24: 마법사 질문/플래그 배선 (`--semver-auto`/`--no-semver-auto`)

**Files:**
- Modify: `src/context.js`
- Modify: `src/cli/args.js`
- Modify: `src/index.js`
- Modify: `src/commands/interactive.js`
- Modify: `src/cli/help.js`
- Test: `tests/node/semver-auto-cli.test.js`

**Interfaces:**
- Modifies: `createContext()` 기본 필드에 `includeSemverAuto: null` 추가.
- Modifies: `parseArgs(argv)` 반환 객체에 `includeSemverAuto: null` 추가, `--semver-auto`/`--no-semver-auto` 플래그로 `true`/`false` 설정.

- [ ] **Step 1: 실패하는 테스트 작성**

```javascript
// tests/node/semver-auto-cli.test.js
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "../../src/cli/args.js";
import { run } from "../../src/index.js";
import { parseTemplateOptions } from "../../src/core/version-yml.js";

test("parseArgs: --semver-auto sets includeSemverAuto=true", () => {
  const opts = parseArgs(["--mode", "full", "--force", "--type", "node", "--semver-auto"]);
  assert.strictEqual(opts.includeSemverAuto, true);
});

test("parseArgs: --no-semver-auto sets includeSemverAuto=false", () => {
  const opts = parseArgs(["--mode", "full", "--force", "--type", "node", "--no-semver-auto"]);
  assert.strictEqual(opts.includeSemverAuto, false);
});

test("parseArgs: omitted defaults to null (resolved to true downstream)", () => {
  const opts = parseArgs(["--mode", "full", "--force", "--type", "node"]);
  assert.strictEqual(opts.includeSemverAuto, null);
});

test("run(): --no-semver-auto propagates to installed version.yml", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-semver-cli-"));
  try {
    await run(
      ["--mode", "full", "--force", "--type", "node", "--no-semver-auto"],
      { cwd: target, clock: { now: "2026-07-28 00:00:00", today: "2026-07-28" } },
    );
    const opts = parseTemplateOptions(readFileSync(join(target, "version.yml"), "utf8"));
    assert.strictEqual(opts.semverAuto, false);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("run(): omitted flag defaults to semver_auto: true", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-semver-cli-"));
  try {
    await run(
      ["--mode", "full", "--force", "--type", "node"],
      { cwd: target, clock: { now: "2026-07-28 00:00:00", today: "2026-07-28" } },
    );
    const opts = parseTemplateOptions(readFileSync(join(target, "version.yml"), "utf8"));
    assert.strictEqual(opts.semverAuto, true);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

```bash
node --test tests/node/semver-auto-cli.test.js
```

Expected: FAIL — `--semver-auto`/`--no-semver-auto`가 "알 수 없는 옵션" 에러.

- [ ] **Step 3: `src/context.js` 수정**

`createContext`의 기본 필드에 추가(`includeCodeRabbit: null,` 바로 뒤):

```javascript
    includeSemverAuto: null, // null=미설정(다운스트림에서 true로 해석), true/false=명시
```

- [ ] **Step 4: `src/cli/args.js` 수정**

`result` 초기값에 추가(`includeCodeRabbit: null, // ...` 바로 뒤):

```javascript
    includeSemverAuto: null,  // --semver-auto / --no-semver-auto (기본 true — 미지정 시 다운스트림에서 해석)
```

`switch (a)` 안, `case "--no-coderabbit": result.includeCodeRabbit = false; break;` 바로 뒤에 추가:

```javascript
      case "--semver-auto": result.includeSemverAuto = true; break;
      case "--no-semver-auto": result.includeSemverAuto = false; break;
```

- [ ] **Step 5: `src/index.js`의 비대화형 경로 수정**

`createContext({...})` 호출 안, `includeCodeRabbit: opts.includeCodeRabbit ?? existing?.options?.coderabbit ?? false,` 바로 뒤에 추가:

```javascript
    includeSemverAuto: opts.includeSemverAuto ?? existing?.options?.semverAuto ?? true,
```

- [ ] **Step 6: `src/commands/interactive.js` 수정**

옵션 초기값 선언부(`let includeCodeRabbit = existing?.options?.coderabbit ?? null;` 바로 뒤)에 추가:

```javascript
  let includeSemverAuto = existing?.options?.semverAuto ?? null;
```

`if (showOptional) { ... }` 블록 안, CodeRabbit 질문 뒤(`includeCodeRabbit = y === true; }` 바로 뒤, `}` 로 블록이 닫히기 전)에 추가:

```javascript

    // 신규 질문 — 자동 semver 승격 (기본 ON). 저장값 있으면 재질문 생략.
    if (includeSemverAuto === null) {
      const y2 = await io.askYesNo("자동 버전 승격을 사용하시겠습니까? (커밋 타입에 따라 major/minor/patch 자동 결정)", true);
      includeSemverAuto = y2 === true;
    }
```

바로 뒤 `includeCodeRabbit = includeCodeRabbit === true;` 줄을 아래로 교체:

```javascript
  includeCodeRabbit = includeCodeRabbit === true;
  includeSemverAuto = includeSemverAuto !== false; // 기본 ON — 명시적으로 false만 OFF
```

`createContext({...})` 호출 안, `includeNexus, includeSecretBackup, includeCodeRabbit,` 바로 뒤에 추가:

```javascript
    includeSemverAuto,
```

- [ ] **Step 7: `src/cli/help.js` 수정**

`--coderabbit / --no-coderabbit` 라인 바로 뒤에 추가:

```javascript
      --semver-auto / --no-semver-auto  커밋 타입 기반 자동 major/minor/patch 승격 (기본: 사용함)
```

- [ ] **Step 8: 테스트 재실행**

```bash
node --test tests/node/semver-auto-cli.test.js
```

Expected: 전부 PASS.

- [ ] **Step 9: 전체 회귀 테스트**

```bash
npm test
```

Expected: node + python 전부 PASS.

- [ ] **Step 10: Commit**

```bash
git add src/context.js src/cli/args.js src/index.js src/commands/interactive.js src/cli/help.js tests/node/semver-auto-cli.test.js
git commit -m "feat(cli): wire --semver-auto/--no-semver-auto flag and interactive question"
```

### Task 25: `AUTO-CHANGELOG-CONTROL` 워크플로우에 승격 폭 분류 연동

**Files:**
- Modify: `payload/workflows/common/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml`
- Modify: `.github/workflows/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml` (동기화)

**Interfaces:** 없음(YAML). `classify-bump`(Task 20-21)와 `version_manager.py increment --bump`(Task 22)를 연결한다.

- [ ] **Step 1: `payload/workflows/common/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml` 재구성**

`Read coderabbit option from version.yml` 스텝 뒤(`Request CodeRabbit summary` 스텝 앞)에 새 스텝 2개를 삽입:

```yaml
      - name: Read semver_auto option from version.yml
        id: semver_options
        run: |
          SEMVER_AUTO=$(python3 -c 'import re; t=open("version.yml",encoding="utf-8").read(); m=re.search(r"metadata:.*?template:.*?options:.*?semver_auto:\s*\"?(true|false)", t, re.S); print(m.group(1) if m else "true")' 2>/dev/null || echo "true")
          echo "semver_auto=$SEMVER_AUTO" >> $GITHUB_OUTPUT
          echo "semver_auto option: $SEMVER_AUTO"

      - name: Collect commits since last release
        id: collect
        run: |
          git fetch origin {{MAIN_BRANCH}}
          git log --pretty=%s "origin/{{MAIN_BRANCH}}..HEAD" > commits.txt
          git diff --stat "origin/{{MAIN_BRANCH}}...HEAD" | head -50 > diff_stat.txt
          echo "commits to summarize: $(wc -l < commits.txt)"
```

`Confirm release version (patch +1 and sync)` 스텝 전체를 아래로 교체(이름도 변경):

**중요**: `classify-bump`의 AI 보조판단(patch→minor)은 `AI_API_KEY`/`GITHUB_TOKEN` 환경변수가 있어야 동작한다. GitHub Actions는 `env:`에 명시적으로 넣지 않으면 시크릿/토큰이 프로세스 환경에 없으므로, 아래처럼 이 스텝에도 "Generate summary" 스텝과 동일한 `env:` 블록을 반드시 추가한다 — 빠뜨리면 AI 보조판단이 항상 조용히 스킵되어 규칙 결과만 나오는 죽은 기능이 된다(테스트는 env를 직접 주입하므로 이 누락을 잡지 못한다).

```yaml
      - name: Confirm release version (bump + sync)
        id: bump
        env:
          AI_API_KEY: ${{ secrets.AI_API_KEY }}
          AI_API_BASE_URL: ${{ vars.AI_API_BASE_URL }}
          AI_MODEL: ${{ vars.AI_MODEL }}
          GITHUB_TOKEN: ${{ github.token }}
        run: |
          HEAD_MSG=$(git log -1 --pretty=%s)
          if printf '%s\n' "$HEAD_MSG" | grep -q "^chore(version): confirm v.* \[skip ci\]"; then
            NEW_VERSION=$(python3 .github/scripts/version_manager.py get | tail -n 1)
            echo "version already confirmed by a previous run — reusing $NEW_VERSION (no re-increment)"
          else
            if [ "${{ steps.semver_options.outputs.semver_auto }}" = "true" ]; then
              BUMP=$(python3 .github/scripts/changelog_manager.py classify-bump --commits-file commits.txt | tail -n 1)
            else
              BUMP="patch"
            fi
            echo "bump level: $BUMP"
            NEW_VERSION=$(python3 .github/scripts/version_manager.py increment --bump "$BUMP" | tail -n 1)
            if [ -z "$NEW_VERSION" ]; then
              echo "version bump failed"
              exit 1
            fi
            python3 .github/scripts/version_manager.py sync
            echo "release version confirmed: $NEW_VERSION ($BUMP)"
          fi
          echo "new_version=$NEW_VERSION" >> $GITHUB_OUTPUT
```

`Generate summary with the AI engine chain (fallback path)` 스텝의 `run: |` 블록에서, 이미 `Collect commits since last release` 스텝이 `commits.txt`/`diff_stat.txt`를 만들어뒀으므로 중복 수집 라인을 제거한다 — 아래로 교체:

```yaml
        run: |
          VERSION=$(python3 .github/scripts/version_manager.py get | tail -n 1)

          python3 .github/scripts/changelog_manager.py ai-summary \
            --commits-file commits.txt \
            --version "$VERSION" \
            --output summary.md \
            --pr-title "$PR_TITLE" \
            --diff-stat-file diff_stat.txt

          # Feed the generated summary through the same channel the
          # CodeRabbit path uses: update-from-summary reads ./pr_body.md
          cp summary.md pr_body.md
```

- [ ] **Step 2: 상단 주석 블록 갱신**

`# 1. Confirms the release version (patch +1 and sync of every version file)` 줄을 아래로 교체:

```yaml
# 1. Confirms the release version and syncs every version file:
#    - If version.yml metadata.template.options.semver_auto is true
#      (default): classifies commits (feat -> minor, `!` marker -> major,
#      else patch; AI-assisted patch->minor upgrade for unclassified
#      commits) and bumps accordingly.
#    - Otherwise: always patch+1 (legacy behavior).
```

- [ ] **Step 3: `.github/workflows/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml`에 동기화**

Step 1~2의 변경을 브랜치 플레이스홀더 치환(`{{MAIN_BRANCH}}`→`main`)해서 동일하게 적용한다.

- [ ] **Step 4: YAML 문법 검증**

```bash
npx -y js-yaml payload/workflows/common/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml > /dev/null && echo "payload OK"
npx -y js-yaml .github/workflows/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml > /dev/null && echo ".github OK"
```

- [ ] **Step 5: 관련 회귀 테스트**

```bash
node --test tests/node/payload-yaml.test.js tests/node/e2e-matrix.test.js tests/node/install-matrix.test.js
npm run test:py
```

Expected: 전부 PASS. `payload-yaml.test.js`가 이 워크플로우의 스텝 개수/이름을 하드코딩해 assert하고 있다면 실행 시점에 실패 내용을 보고 갱신한다.

- [ ] **Step 6: Commit**

```bash
git add payload/workflows/common/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml .github/workflows/PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml
git commit -m "feat(release): wire semver bump classification into the release PR pipeline"
```

### Task 26: `ROADMAP.md` 갱신 — "진행 중" 항목을 "완료됨"으로 이동

**Files:**
- Modify: `ROADMAP.md`

Task 4에서 `status`/`doctor`/`--dry-run`/AI PR 요약봇/자동 semver 승격을 "진행 중"으로 적어뒀다(Task 4 시점에는 실제로 아직 구현 전이었으므로). Task 11~25로 전부 구현이 끝났으므로 이제 사실과 일치시킨다.

- [ ] **Step 1: `ROADMAP.md`의 "진행 중" 섹션 항목 5개를 "완료됨" 섹션으로 이동**

```markdown
## 완료됨

- npx 마법사(9타입 + 멀티타입 + 모노레포 자동 감지)
- GitHub-native AI 릴리스 자동화(API 키 0개, 4단 엔진 체인)
- `status` — 설치 상태·드리프트 확인 명령
- `doctor` — 설치 환경 진단 명령
- `--dry-run` — 실제 변경 없이 미리보기
- 자체 AI PR 요약봇(CodeRabbit 비의존 대안)
- 자동 semver 승격(커밋 타입 기반 major/minor/patch)

## 검토 중

- 프로젝트 타입 커버리지 확장 여부(Go, Rust, Django, Docker 등) — 현재는 깊이 우선 전략으로 보류 중
- CLI 다국어(i18n) 지원
```

- [ ] **Step 2: 확인**

```bash
grep -q "^## 진행 중" ROADMAP.md && echo "FAIL: 진행 중 섹션이 남아있음" || echo OK
```

- [ ] **Step 3: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: mark shipped features as completed in ROADMAP.md"
```

---

## Self-Review 기록

- **스펙 커버리지**: §3.1(커뮤니티 문서, Phase 0) / §3.2(1차 심사 보강, Phase 1) / §3.3②③④(doctor/status/dry-run, Phase 2-4) / §3.4⑤⑥(AI PR 요약봇/prompt 확장, Phase 5-6) / §3.3①(자동 semver 승격, Phase 7) 전부 태스크로 매핑됨. §3.1 "실사용 트랙션 확보"·"기여 유도용 이슈"는 코드 작업이 아닌 활동 항목이라 이 구현계획 범위 밖(스펙 §6에 별도 트랙으로 명시됨) — 태스크화하지 않음(의도적).
- **Placeholder 스캔**: "TBD"/"TODO" 없음. Task 6·18·19·25에 "실행 시점에 확인"이라고 쓴 부분은 미리 알 수 없는 기존 테스트의 정확한 assertion 내용(파일을 열어봐야 아는 것)이라 남겨둔 것 — 실제 확인 방법(어떤 명령을 돌려서 무엇을 보고 어떻게 고치는지)까지 구체적으로 적었으므로 "무엇을 할지 설명 없이 냅둔" 플레이스홀더가 아니다.
- **타입/시그니처 일관성**: `planWorkflows`(Task 11)를 `status.js`(Task 12)와 `dry-run.js`(Task 15)가 동일한 반환 형태(`{newFiles, unchanged, changed}`, 각 항목 `{filename, type}`)로 일관되게 소비. `planRevert`/`runRevert`(Task 14)의 반환 형태가 `dry-run.js`(Task 15)와 기존 `src/index.js`/`interactive.js` 소비처 양쪽에서 동일하게 유지됨. `includeSemverAuto`의 "기본 true" 규약이 `context.js`(Task 24)·`version-yml.js`(Task 23)·`full.js`/`version.js`(Task 23)·`interactive.js`(Task 24)·`index.js`(Task 24) 전체에서 일관됨(다른 opt-in 옵션들의 "기본 false"와 의도적으로 다름을 각 지점에 주석으로 명시).
- **범위 경계**: `--dry-run`은 CLI 플래그로만(대화형 미통합, Task 16 말미에 명시). `doctor`는 규칙 기반만(AI 진단 제외, Global Constraints에 명시). `breaking-check.js`/`breaking-changes.json`은 전 Phase에서 미접촉(Global Constraints에 명시).
- **Fable 모델 최종 검토(2026-07-28) 반영 완료**: 발견된 CRITICAL 0건. HIGH 4건(H1 dry-run의 원격 브랜치 push 부수효과, H2 `diff_stat.txt` 릴리스 커밋 오염, H3 classify-bump env 블록 누락으로 AI 보조판단이 죽은 기능이 되는 문제, H4 존재하지 않는 `node` 타입 워크플로우를 전제한 테스트)와 MEDIUM 5건(M1 `planWorkflows`의 secret-backup 누락, M2 dry-run의 semver_auto 미반영, M3 `collectBreaking` 픽스처 스키마 오류, M4 `changelog_manager.URLError` 오타, M5 `git log` 3점 범위 오류) 전부 이 문서에 직접 수정 반영함. M6(doctor의 automerge/merge-commit 호환성 점검 누락)도 반영(Task 13에 `.allow_merge_commit` 체크 추가). M7(ROADMAP.md 미구현 기능 선기재)은 Task 4를 "진행 중"으로 낮추고 Task 26(전체 구현 완료 후 "완료됨"으로 이동)을 신설해 해결.
- **의도적으로 남겨둔 갭(Fable 리뷰 M6 일부·M8)**: (1) `doctor`의 `WORKFLOW_PAT` scope(repo/workflow) 검증 — `gh secret list`는 시크릿 존재 여부만 노출하고 PAT 생성 시 부여된 OAuth scope는 API로 조회할 수 없어(GitHub 시크릿은 값·스코프 모두 비공개) 기술적으로 구현 불가, 존재 여부 확인으로 대체. (2) doctor 결과에 README 앵커 링크 삽입 — 저비용이지만 이번 계획에서는 텍스트 안내로 대체(추후 별도 태스크로 가능). (3) §3.2 "커버리지 리포트 배지화" — Phase 1은 커버리지를 추가할 뿐 배지 자동화(예: codecov 연동)는 별도 CI 작업이 필요해 범위 밖. (4) §3.2 "HANDOFF.md의 GitHub Models 403 이슈 실제 해결 여부 확인" — 실제 GitHub Actions 실행 로그를 봐야 하는 검증 활동이라 코드 태스크로 표현할 수 없음(사용자가 릴리스 1회 실측 후 HANDOFF.md를 직접 갱신). (5) §3.3① "동작 변경을 마법사 완료 요약에 안내" — Task 24는 질문 흐름만 추가하고 `printSummary`/`io.summary` 출력 문구는 갱신하지 않음(요약 UI 포맷 확장이 필요해 범위가 커짐 — 특히 `--force` 비대화형 업데이트 경로는 질문 없이 기본 ON으로 전환되므로, 사용자에게 가장 중요한 것은 `status` 명령(Task 12)으로 언제든 현재 semver_auto 값을 확인할 수 있다는 점 — 완료 요약 문구보다 상시 조회 가능한 `status` 쪽이 실질적 안전판).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-28-osscontest-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** - 태스크마다 새 서브에이전트를 디스패치, 태스크 사이마다 리뷰, 빠른 반복.

**2. Inline Execution** - 이 세션에서 executing-plans로 배치 실행, 체크포인트마다 검토.

Which approach?
